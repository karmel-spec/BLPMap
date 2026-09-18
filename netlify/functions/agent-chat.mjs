// /api/agent — in-app chat with a BLP Hermes agent (Lindsay, Melody, Carla,
// Chris, …) through the BLP Agent Gateway on the agents' Mac, the same bridge
// the Marketing app uses for Marcus. The gateway URL + key live in Netlify
// env vars so they never reach browsers.
//
//   POST {slug, message, transcript?, idToken}   -> {run_id, session_id}
//   GET  ?slug=lindsay&run=<run_id>  (x-blp-idtoken header)
//                                              -> {status, output, error}
//
// Only a signed-in BLP Google account may talk to an agent: the ID token the
// map already holds is verified against Google's tokeninfo endpoint, and the
// agent is told who is writing. If the gateway cannot be reached the request
// fails with a clear error — nothing is ever answered on the agent's behalf.

const GATEWAY_URL = (process.env.BLP_GATEWAY_URL || 'https://agents.brighamlarsonpianos.com').replace(/\/$/, '');
const GATEWAY_KEY = process.env.BLP_GATEWAY_KEY || '';
// public web client of the "BLP Store Map" Google Cloud project (same as app.js)
const GOOGLE_CLIENT_ID = '110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com';
const AGENTS = ['lindsay', 'melody', 'carla', 'chris', 'clara', 'arnold', 'ivory', 'marcus'];
const NAMES = { lindsay: 'Lindsay', melody: 'Melody', carla: 'Carla', chris: 'Chris', clara: 'Clara', arnold: 'Arnold', ivory: 'Ivory', marcus: 'Marcus' };
const GATEWAY_DOWN = 'Could not reach the agent gateway (the Hermes agents on the agents\' Mac). Check that the Mac is awake, the gateway is up and the Cloudflare tunnel is connected, then try again. Nothing was answered on the agent\'s behalf.';

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

async function gateway(path, init) {
  let r;
  try {
    r = await fetch(GATEWAY_URL + path, {
      ...init,
      headers: { 'x-blp-gateway-key': GATEWAY_KEY, 'content-type': 'application/json', ...(init && init.headers || {}) },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new Error(GATEWAY_DOWN + ' (' + (e && e.message || e) + ')');
  }
  const raw = await r.text();
  let out = {};
  try { out = JSON.parse(raw); } catch (e) { out = {}; }
  if (!r.ok) throw new Error(out.error || ('Agent gateway ' + r.status + ': ' + raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)));
  return out;
}

export default async (req) => {
  if (!GATEWAY_KEY) return json({ error: 'agent chat not configured — set BLP_GATEWAY_KEY (and BLP_GATEWAY_URL) in Netlify env vars' }, 501);
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const slug = String(url.searchParams.get('slug') || '').toLowerCase();
    const run = String(url.searchParams.get('run') || '');
    if (!AGENTS.includes(slug) || !/^[\w.-]{1,80}$/.test(run)) return json({ error: 'slug and run required' }, 400);
    const who = await verify(req.headers.get('x-blp-idtoken'));
    if (!who) return json({ error: 'Sign in with your BLP Google account first.' }, 401);
    try {
      const st = await gateway('/agents/' + slug + '/runs/' + encodeURIComponent(run));
      return json({ status: st.status, output: st.output || null, error: st.error || null });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502);
    }
  }

  if (req.method !== 'POST') return json({ error: 'GET or POST only' }, 405);
  let body;
  try { body = await req.json(); } catch (e) { body = {}; }
  const slug = String(body.slug || '').toLowerCase();
  if (!AGENTS.includes(slug)) return json({ error: 'unknown agent' }, 400);
  const message = String(body.message || '').trim();
  if (!message) return json({ error: 'Type a message first' }, 400);
  if (message.length > 4000) return json({ error: 'Keep a message under 4,000 characters' }, 400);
  const who = await verify(body.idToken);
  if (!who) return json({ error: 'Sign in with your BLP Google account first.' }, 401);

  const first = String(who.name).split(/\s+/)[0];
  const transcript = String(body.transcript || '').slice(0, 12000);
  const input = [
    'You are being messaged from the BLP Store Map web app (blpstoremap.netlify.app) by ' + who.name + ' <' + who.email + '>. '
      + 'Answer as yourself — the same ' + NAMES[slug] + ' as on Telegram — using your vault files and memory as usual. '
      + 'Reply in plain text for a small chat window: short paragraphs, no markdown tables or headings. '
      + 'You never post, send or change anything on their behalf from here unless they ask you to.',
    transcript ? 'RECENT THREAD (this chat window):\n' + transcript : '',
    first + ': ' + message,
  ].filter(Boolean).join('\n\n');

  try {
    const rec = await gateway('/agents/' + slug + '/runs', {
      method: 'POST',
      body: JSON.stringify({ input, requester: first + ' <store map>' }),
    });
    if (!rec.run_id) throw new Error('gateway accepted the message but returned no run id');
    return json({ run_id: rec.run_id, session_id: rec.session_id || null, status: rec.status || 'started' });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 502);
  }
};
