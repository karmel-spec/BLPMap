// /api/queue — saves a hand-set order (drag & drop) and manual additions (＋)
// for the map's queue boxes: Keytop Q, Refinish Q, Plate Q (Karmel 9/18).
//   POST {q, order: [serial…], manual: [{serial, by, at}…], idToken} -> {ok}
// Stored in Supabase queue_order (supabase/queue_order.sql) with the
// service-role key; browsers read it back with the publishable key.
//
// Only owners, managers and admins may change a queue: the signed-in Google
// ID token is verified with Google, then the email must be on the editor
// list below (extend it with the QUEUE_EDITORS env var, comma-separated).

const SB_URL = (process.env.SUPABASE_URL || 'https://ismacawxfvvllfinibbf.supabase.co').replace(/\/$/, '');
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GOOGLE_CLIENT_ID = '110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com';
const QUEUES = ['keytop', 'refin', 'plates'];
// mirrors OWNER_EMAILS / ADMIN_EMAILS / TIMELOG_ADMIN_EMAILS (managers) in app.js
const EDITORS = new Set([
  'brigham@brighamlarsonpianos.com', 'karmel@brighamlarsonpianos.com', 'brighamlarson@gmail.com',
  'melissa@brighamlarsonpianos.com', 'alisa@brighamlarsonpianos.com', 'susie@brighamlarsonpianos.com',
  'walter@brighamlarsonpianos.com',
  'markhales.blp@gmail.com', 'matthewwessman.blp@gmail.com', 'jacobmower.blp@gmail.com',
  ...String(process.env.QUEUE_EDITORS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function verify(idToken) {
  const tok = String(idToken || '');
  if (!tok) return null;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tok), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const info = await r.json();
    if (info.aud !== GOOGLE_CLIENT_ID || String(info.email_verified) !== 'true') return null;
    return { email: String(info.email).toLowerCase(), name: info.name || info.email };
  } catch (e) { return null; }
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SB_SERVICE_KEY) return json({ error: 'queue order storage not configured — set SUPABASE_SERVICE_KEY in Netlify env vars' }, 501);
  let body;
  try { body = await req.json(); } catch (e) { body = {}; }
  const q = String(body.q || '').toLowerCase();
  if (!QUEUES.includes(q)) return json({ error: 'unknown queue' }, 400);
  const who = await verify(body.idToken);
  if (!who) return json({ error: 'Sign in with your BLP Google account first.' }, 401);
  if (!EDITORS.has(who.email)) return json({ error: 'Only owners, managers and admins can change a queue.' }, 403);

  const clean = (s) => String(s || '').trim().slice(0, 40);
  const order = Array.isArray(body.order) ? body.order.map(clean).filter(Boolean).slice(0, 500) : [];
  const manual = Array.isArray(body.manual) ? body.manual.slice(0, 200).map((m) => ({
    serial: clean(m && m.serial), by: String(m && m.by || who.name).slice(0, 80),
    at: m && m.at ? String(m.at).slice(0, 40) : new Date().toISOString(),
  })).filter((m) => m.serial) : [];

  try {
    const r = await fetch(SB_URL + '/rest/v1/queue_order?on_conflict=queue', {
      method: 'POST',
      headers: { apikey: SB_SERVICE_KEY, Authorization: 'Bearer ' + SB_SERVICE_KEY,
        'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ queue: q, ord: order, manual, updated_by: who.name, updated_at: new Date().toISOString() }]),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return json({ error: 'Supabase ' + r.status + ': ' + (await r.text()).slice(0, 160) }, 502);
    return json({ ok: true, by: who.name });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 502);
  }
};
