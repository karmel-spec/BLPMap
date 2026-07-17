// /api/move — proxies piano location lookups/updates to the Apps Script
// bridge (apps-script/DailyReport.gs doPost). The bridge URL and shared
// secret live in Netlify env vars so they never reach browsers.
//   POST {serial}                      -> current location
//   POST {serial, newLocation}        -> update Piano Log col U
//   POST {serial, newLocation, row}   -> disambiguate duplicate serials

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405 });
  }
  const url = process.env.BLP_BRIDGE_URL;
  const secret = process.env.BLP_BRIDGE_SECRET;
  if (!url || !secret) {
    return Response.json({ error: 'move bridge not configured' }, { status: 501 });
  }
  let body;
  try { body = await req.json(); } catch { body = {}; }
  if (!body.serial) return Response.json({ error: 'serial required' }, { status: 400 });
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'follow',
      body: JSON.stringify({
        secret,
        serial: String(body.serial),
        action: body.newLocation ? 'move' : 'lookup',
        newLocation: body.newLocation != null ? String(body.newLocation) : undefined,
        row: body.row,
      }),
    });
    const text = await r.text();
    try { return Response.json(JSON.parse(text)); }
    catch {
      return Response.json({ error: 'bridge returned non-JSON: ' + text.slice(0, 120) },
        { status: 502 });
    }
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
};
