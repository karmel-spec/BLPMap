// /api/tuningcheck — saves the marks on the 🎵 Showroom Tuning Check
// worksheet (Brigham 10/9): Korban walks the floor, marks each for-sale
// piano Good or Needs tuning and jots service notes; the sheet is shared,
// so a phone on the floor and the desk see the same marks.
//   POST {op:'mark', serial, mark:'good'|'tune'|'skip'|'', note, priority?, idToken} -> {ok, by}
//        priority (⚡ ASAP) only sticks on a 'tune' mark — it puts the piano at the top of the Tuning Queue
//   POST {op:'clear', idToken}                                      -> {ok, cleared}
// Stored in Supabase tuning_check (supabase/tuning_check.sql) with the
// service-role key; browsers read it back with the publishable key.
//
// Any signed-in BLP Google account may mark — it's a worksheet, not a
// queue — but the ID token is still verified with Google so nobody can
// write without being signed in to the app.

const SB_URL = (process.env.SUPABASE_URL || 'https://ismacawxfvvllfinibbf.supabase.co').replace(/\/$/, '');
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GOOGLE_CLIENT_ID = '110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com';
const MARKS = ['good', 'tune', 'skip', ''];   // skip = not a piano to check (reason required)

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

const sb = (path, init) => fetch(SB_URL + '/rest/v1/' + path, {
  ...init,
  headers: { apikey: SB_SERVICE_KEY, Authorization: 'Bearer ' + SB_SERVICE_KEY,
    'content-type': 'application/json', ...(init && init.headers || {}) },
  signal: AbortSignal.timeout(8000),
});

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SB_SERVICE_KEY) return json({ error: 'tuning check storage not configured — set SUPABASE_SERVICE_KEY in Netlify env vars' }, 501);
  let body;
  try { body = await req.json(); } catch (e) { body = {}; }
  const op = String(body.op || 'mark');
  const who = await verify(body.idToken);
  if (!who) return json({ error: 'Sign in with your BLP Google account first.' }, 401);

  try {
    if (op === 'clear') {
      const r = await sb('tuning_check?serial=not.is.null', { method: 'DELETE', headers: { Prefer: 'return=representation' } });
      if (!r.ok) return json({ error: 'Supabase ' + r.status + ': ' + (await r.text()).slice(0, 160) }, 502);
      const gone = await r.json().catch(() => []);
      return json({ ok: true, cleared: Array.isArray(gone) ? gone.length : 0, by: who.name });
    }
    if (op !== 'mark') return json({ error: 'unknown op' }, 400);
    const serial = String(body.serial || '').trim().slice(0, 40);
    if (!serial) return json({ error: 'serial required' }, 400);
    const mark = String(body.mark || '').toLowerCase();
    if (!MARKS.includes(mark)) return json({ error: 'mark must be good, tune, skip or empty' }, 400);
    const note = String(body.note || '').trim().slice(0, 300);
    if (mark === 'skip' && note.length < 3) return json({ error: 'say why the piano was skipped' }, 400);
    const priority = mark === 'tune' && body.priority === true;
    const r = await sb('tuning_check?on_conflict=serial', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ serial, mark, note, priority, marked_by: who.name, marked_at: new Date().toISOString() }]),
    });
    if (!r.ok) return json({ error: 'Supabase ' + r.status + ': ' + (await r.text()).slice(0, 160) }, 502);
    return json({ ok: true, by: who.name });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 502);
  }
};
