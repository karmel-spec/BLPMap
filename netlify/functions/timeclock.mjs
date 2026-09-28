// /api/timeclock — the Work Clock state every open Store Map tab polls.
//
// Until 9/28 each tab asked the Apps Script bridge directly (fn=timeclock)
// once a minute, background tabs included: with a shop full of phones that was
// most of the bridge's baseline traffic, and once Google slowed down those
// requests stacked past its simultaneous-execution cap — HTML error pages and
// Planner timeouts all day 9/25 (Walter). This function asks the bridge at
// most once every CACHE_MS per Netlify instance and hands every tab the same
// answer. ?fresh=1 bypasses the cache — the app uses it right after a punch so
// the tech sees their own change at once. A bridge failure serves the last
// good copy (stale:true) rather than nothing.
const BRIDGE_URL =
  'https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec';
const CACHE_MS = 25000;
const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
let cache = { at: 0, body: null };
let inflight = null;

async function fromBridge() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 40000);
  try {
    const r = await fetch(BRIDGE_URL + '?fn=timeclock', { redirect: 'follow', signal: ctl.signal });
    const j = await r.json();                       // Google's HTML error page throws here
    if (!j || !Array.isArray(j.open)) throw new Error('bridge answered without a clock');
    return j;
  } finally { clearTimeout(t); }
}

export default async (req) => {
  const url = new URL(req.url);
  const fresh = url.searchParams.get('fresh') === '1';
  const now = Date.now();
  if (!fresh && cache.body && now - cache.at < CACHE_MS) {
    return Response.json({ ...cache.body, cached: true, age: Math.round((now - cache.at) / 1000) }, { headers: CORS });
  }
  try {
    // one bridge call per instance at a time — a burst of tabs shares it
    if (!inflight) inflight = fromBridge().finally(() => { inflight = null; });
    const j = await inflight;
    cache = { at: Date.now(), body: j };
    return Response.json({ ...j, cached: false }, { headers: CORS });
  } catch (e) {
    if (cache.body) return Response.json({ ...cache.body, stale: true, age: Math.round((now - cache.at) / 1000) }, { headers: CORS });
    return Response.json({ error: 'bridge unreachable: ' + String(e && e.message || e).slice(0, 120) }, { status: 502, headers: CORS });
  }
};
