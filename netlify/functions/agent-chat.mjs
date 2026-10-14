// /api/agent — in-app chat with a BLP agent (Chris, Lindsay, Melody, Carla,
// Clarence (slug clara), Arnold, Ivory, Marcus) through the BLP Agent Console
// (blpagents.netlify.app), which is every agent's switchboard since
// 2026-10-08: it stores the thread (Supabase agent_messages), wakes the
// agent's Grok Bot (or runs the in-app vault runner for an agent whose Bot
// isn't wired yet) and delivers the reply. No Mac, no Hermes, no tunnel.
//
//   POST {slug, message, idToken}                 -> {run_id, status, engine}
//   POST {slug, import: [{r, t, by, at}], idToken} -> {imported}   (one-time copy of a browser thread)
//   GET  ?slug=lindsay&run=<job id>  (x-blp-idtoken header)
//                                              -> {status, output, error}
//   GET  ?health=1                               -> {ok, agents: {slug: up}, engines}
//
// Only a signed-in BLP Google account may talk to an agent: the ID token the
// map already holds is verified against Google's tokeninfo endpoint, and the
// console is told who is writing. If the console cannot be reached the request
// fails with a clear error — nothing is ever answered on the agent's behalf.
// Env: BLP_AGENTS_URL (default https://blpagents.netlify.app), BLP_AGENTS_KEY
// (the console's team passcode, BLP_APP_ACCESS_KEY on the blpagents site).

const AGENTS_URL = (process.env.BLP_AGENTS_URL || 'https://blpagents.netlify.app').replace(/\/$/, '');
const AGENTS_KEY = process.env.BLP_AGENTS_KEY || '';
// public web client of the "BLP Store Map" Google Cloud project (same as app.js)
const GOOGLE_CLIENT_ID = '110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com';
const AGENTS = ['lindsay', 'melody', 'carla', 'chris', 'clara', 'arnold', 'ivory', 'marcus'];
const NAMES = { lindsay: 'Lindsay', melody: 'Melody', carla: 'Carla', chris: 'Chris', clara: 'Clarence', arnold: 'Arnold', ivory: 'Ivory', marcus: 'Marcus' };
const SB_URL = (process.env.SUPABASE_URL || 'https://ismacawxfvvllfinibbf.supabase.co').replace(/\/$/, '');
// either spelling works — Supabase's dashboard calls it the service_role key
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CONSOLE_DOWN = 'Could not reach the BLP Agent Console (blpagents.netlify.app), which relays messages to the agents. Try again in a moment. Nothing was answered on the agent\'s behalf.';

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function blpAccount(email) {
  const e = String(email || '').toLowerCase();
  return /@brighamlarsonpianos\.com$/.test(e) || /\.blp@gmail\.com$/.test(e) || e === 'brighamlarson@gmail.com';
}

// verified tokens, remembered until they expire, so polling does not hit
// Google's tokeninfo endpoint every 2.5 seconds
const seen = new Map();
const HEALTH = { at: 0, body: null };
async function verify(idToken) {
  const tok = String(idToken || '');
  if (!tok) return null;
  const hit = seen.get(tok);
  if (hit && hit.exp * 1000 > Date.now()) return hit;
  let info;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tok), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    info = await r.json();
  } catch (e) { return null; }
  if (info.aud !== GOOGLE_CLIENT_ID) return null;
  if (String(info.email_verified) !== 'true' || !blpAccount(info.email)) return null;
  const u = { email: String(info.email).toLowerCase(), name: info.name || info.email, exp: Number(info.exp) || 0 };
  if (seen.size > 500) seen.clear();
  seen.set(tok, u);
  return u;
}

async function console_(path, init) {
  let r;
  try {
    r = await fetch(AGENTS_URL + path, {
      ...init,
      headers: { 'x-blp-key': AGENTS_KEY, 'content-type': 'application/json', ...(init && init.headers || {}) },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new Error(CONSOLE_DOWN + ' (' + (e && e.message || e) + ')');
  }
  const raw = await r.text();
  let out = {};
  try { out = JSON.parse(raw); } catch (e) { out = {}; }
  if (!r.ok) {
    if (out && out.error) throw new Error(out.error);
    const text = raw.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error('Agent Console ' + r.status + (text ? ': ' + text : ''));
  }
  return out;
}

// one-time import of a browser-only thread into agent_messages; never throws
async function store(rows) {
  if (!SB_SERVICE_KEY || !rows.length) return false;
  try {
    const r = await fetch(SB_URL + '/rest/v1/agent_messages?on_conflict=run_id', {
      method: 'POST',
      headers: { apikey: SB_SERVICE_KEY, Authorization: 'Bearer ' + SB_SERVICE_KEY,
        'content-type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch (e) { return false; }
}

export default async (req) => {
  if (!AGENTS_KEY) return json({ error: 'agent chat not configured — set BLP_AGENTS_KEY (the Agent Console team passcode) and optionally BLP_AGENTS_URL in Netlify env vars' }, 501);
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.has('health')) {
    // which agents have an engine answering right now (Grok Bot relay or the
    // console runner) — drives the green / red rings on the faces (Brigham 9/22).
    // Cached 30 s so a busy store doesn't hammer the console.
    if (HEALTH.at && Date.now() - HEALTH.at < 30000) return json(HEALTH.body);
    try {
      const h = await console_('/api/agents/live');
      const agents = {}; const engines = {};
      Object.entries(h.agents || {}).forEach(([k, v]) => { agents[k.toLowerCase()] = !!(v && v.up); engines[k.toLowerCase()] = v && v.engine || ''; });
      HEALTH.body = { ok: !!h.configured, machine: h.machine || 'cloud', agents, engines, at: new Date().toISOString() };
    } catch (e) {
      HEALTH.body = { ok: false, agents: {}, engines: {}, error: String(e && e.message || e), at: new Date().toISOString() };
    }
    HEALTH.at = Date.now();
    return json(HEALTH.body);
  }
  if (req.method === 'GET') {
    const slug = String(url.searchParams.get('slug') || '').toLowerCase();
    const run = String(url.searchParams.get('run') || '');
    if (!AGENTS.includes(slug) || !/^\d{1,12}$/.test(run)) return json({ error: 'slug and run required' }, 400);
    const who = await verify(req.headers.get('x-blp-idtoken'));
    if (!who) return json({ error: 'Sign in with your BLP Google account first.' }, 401);
    try {
      const st = await console_('/api/agents/' + slug + '/chat/jobs/' + run);
      const status = st.status === 'done' ? 'completed' : st.status === 'failed' ? 'failed' : 'running';
      return json({ status, output: status === 'completed' ? (st.reply || '') : null, error: st.error || null, engine: st.engine || null, stored: status === 'completed' });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502);
    }
  }

  if (req.method !== 'POST') return json({ error: 'GET or POST only' }, 405);
  let body;
  try { body = await req.json(); } catch (e) { body = {}; }
  const slug = String(body.slug || '').toLowerCase();
  if (!AGENTS.includes(slug)) return json({ error: 'unknown agent' }, 400);
  if (Array.isArray(body.import)) {
    // one-time copy of a thread that so far lived only in a browser
    const who = await verify(body.idToken);
    if (!who) return json({ error: 'Sign in with your BLP Google account first.' }, 401);
    const rows = body.import.slice(0, 500).map((m) => ({
      agent: slug, role: m.r === 'me' ? 'user' : 'agent',
      who: m.r === 'me' ? String(m.by || who.name).slice(0, 80) : NAMES[slug],
      who_email: m.r === 'me' ? who.email : '',
      body: String(m.t || '').slice(0, 20000),
      created_at: new Date(Number(m.at) || Date.now()).toISOString(),
    })).filter((r) => r.body);
    if (!SB_SERVICE_KEY) return json({ error: 'history storage not configured — set SUPABASE_SERVICE_KEY in this site\'s Netlify env vars (all scopes) and redeploy' }, 501);
    const ok = await store(rows);
    return json({ imported: ok ? rows.length : 0, error: ok ? undefined : 'Supabase rejected the import' }, ok ? 200 : 502);
  }
  const message = String(body.message || '').trim();
  if (!message) return json({ error: 'Type a message first' }, 400);
  if (message.length > 4000) return json({ error: 'Keep a message under 4,000 characters' }, 400);
  const who = await verify(body.idToken);
  if (!who) return json({ error: 'Sign in with your BLP Google account first.' }, 401);

  // The console stores both turns in agent_messages (the thread the map reads
  // back) and tells the agent who wrote and from where.
  const context = 'You are being messaged from the BLP Store Map web app (blpstoremap.netlify.app) — a small chat window beside the live shop map. '
    + 'Answer as yourself, the same ' + NAMES[slug] + ' as on Telegram. Reply in plain text for a small chat window: short paragraphs, no markdown tables or headings. '
    + 'You never post, send or change anything on their behalf from here unless they ask you to.';
  try {
    const rec = await console_('/api/agents/' + slug + '/chat', {
      method: 'POST',
      body: JSON.stringify({ message, who: who.name, email: who.email, channelNote: context }),
    });
    if (!rec.jobId) throw new Error('the console accepted the message but returned no job id');
    return json({ run_id: String(rec.jobId), status: rec.status || 'pending', engine: rec.engine || null, stored: true });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 502);
  }
};
