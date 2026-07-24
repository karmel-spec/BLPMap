// /api/data on Netlify — JS port of server.py's parser.
// Piano Log CSV is public; the moving calendar's SECRET iCal URL comes from
// the BLP_MOVING_ICS env var (Netlify site settings) and must never be
// committed. Without it the app still works, just with no move events.

const PIANO_LOG_CSV =
  'https://docs.google.com/spreadsheets/d/1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc/export?format=csv';
// Apps Script bridge: serves calendar events via public GET (the secret
// iCal address lives inside the script, not here) and takes PIN-gated
// move requests. URL is not sensitive — writes require the PIN.
const BRIDGE_URL =
  'https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec';
const TZ = 'America/Denver';
const CACHE_MS = 120000;

let cache = { at: 0, payload: null };

/* ---------- small utils ---------- */
const denverDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g;
function parseDates(s) {
  const out = [];
  for (const m of (s || '').matchAll(DATE_RE)) {
    let y = +m[3]; if (y < 100) y += 2000;
    const d = new Date(Date.UTC(y, +m[1] - 1, +m[2]));
    if (!isNaN(d)) out.push(d);
  }
  return out;
}

function pianoType(cat) {
  const c = (cat || '').toLowerCase();
  if (c.startsWith('grand') || c.includes(', grand')) return 'grand';
  if (c.includes('digital')) return 'digital';
  if (/(upright|console|spinet|studio)/.test(c)) return 'upright';
  return 'other';
}

/* ---------- piano log ---------- */
const SLOT_RE = /^\d+[a-zA-Z]?$/;
function parsePianos(text) {
  const rows = parseCSV(text);
  const pianos = [];
  const phaseIdx = rows[1]
    ? rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'CURRENT PHASE') : -1;
  const priceIdx = rows[1]
    ? rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'PRICE') : -1;
  // CUSTOM SHOPWORK queue bounds (1-based rows)
  let qHdr = 0, qEnd = 0;
  for (let k = 0; k < rows.length; k++) {
    const b = (rows[k][1] || '').trim(), c = (rows[k][2] || '').trim(), d = (rows[k][3] || '').trim();
    if (!qHdr) { if (b.toUpperCase() === 'CUSTOM SHOPWORK' && !c && !d) qHdr = k + 1; }
    else if (!qEnd && !b && !c && !d) qEnd = k + 1;
  }
  const qTotal = (qHdr && qEnd) ? qEnd - qHdr - 1 : 0;
  const todayUTC = new Date(denverDay() + 'T00:00:00Z');
  let section = '', soldZone = false;
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const col = j => (r[j] || '').trim();
    const serial = col(2), summary = col(3);
    if (!serial && !summary) {
      const head = col(1);
      if (head) {
        section = head;
        if (head.trim().toUpperCase() === 'SOLD') soldZone = true;
      }
      continue;
    }
    if (soldZone) continue;
    if (['SHOPIFY', 'ADMIN', 'WEB'].includes(summary.toUpperCase())
        || ['ADMIN', 'LOCATION / STATUS'].includes(col(20).toUpperCase())
        || col(21).includes('Arrival Date')) continue;
    const status = col(18), loc = col(20), ol = col(1).toLowerCase();
    const dates = parseDates(col(21)).filter(d => d <= todayUTC);
    const entered = dates.length ? new Date(Math.max(...dates)) : null;
    const isNew = !!entered && (todayUTC - entered) / 86400000 <= 7;
    const active = !ol.includes('never received')
      && !status.toLowerCase().includes('never received')
      && !ol.includes('duplicate');
    pianos.push({
      row: i + 1, section, owner: col(1), serial,
      summary: summary || [col(4), col(5), col(6)].filter(Boolean).join(' '),
      year: col(4), make: col(5), model: col(6), size: col(7),
      type: pianoType(col(9)), status, location: loc,
      isSlot: SLOT_RE.test(loc),
      entered: entered ? entered.toISOString().slice(0, 10) : null,
      phase: phaseIdx >= 0 ? col(phaseIdx) : '',
      price: priceIdx >= 0 ? col(priceIdx) : '',
      bphoto: !!col(13), aphoto: !!col(15), bvideo: !!col(16), avideo: !!col(17),
      queuePos: (qHdr && qEnd && (i + 1) > qHdr && (i + 1) < qEnd) ? (i + 1) - qHdr : 0,
      queueTotal: qTotal,
      isNew, active,
    });
  }
  return pianos;
}

/* ---------- moving calendar ---------- */
function parseEvents(ics) {
  const text = ics.replace(/\r?\n[ \t]/g, '');
  const today = new Date(denverDay() + 'T12:00:00Z');
  const lo = new Date(today - 86400000), hi = new Date(+today + 14 * 86400000);
  const events = [];
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const props = {};
    for (const line of body.split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      props[line.slice(0, idx).split(';')[0].toUpperCase()] = line.slice(idx + 1).trim();
    }
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(props.DTSTART || '');
    if (!m) continue;
    let day, hhmm = m[4] ? `${m[4]}:${m[5]}` : null;
    if (hhmm && m[7] === 'Z') {
      const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
      day = utc.toLocaleDateString('en-CA', { timeZone: TZ });
      hhmm = utc.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    } else {
      day = `${m[1]}-${m[2]}-${m[3]}`;
    }
    const dd = new Date(day + 'T12:00:00Z');
    if (dd < lo || dd > hi) continue;
    const raw = (props.SUMMARY || '').replace(/\\,/g, ',');
    const done = /^\s*x\s+/i.test(raw);
    const clean = raw.replace(/^\s*x\s+/i, '').trim();
    if (['OFF', 'NO MOVES', ''].includes(clean.toUpperCase())) continue;
    events.push({
      date: day, time: hhmm, summary: clean, done,
      description: (props.DESCRIPTION || '').replace(/\\n/g, ' ').replace(/\\,/g, ',').slice(0, 400),
    });
  }
  events.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
  return events;
}

const NAME_RE = /^[A-Za-z .,'&/+]{2,40}$/;
function crewToday(events) {
  const today = denverDay(), names = [];
  for (const e of events) {
    if (e.date !== today || !e.summary.includes(':')) continue;
    const head = e.summary.split(':', 1)[0].trim();
    if (!NAME_RE.test(head) || head.split(/\s+/).length > 4) continue;
    for (let n of head.split(/[/&+]| and /)) {
      n = n.trim().replace(/\b\w/g, c => c.toUpperCase());
      if (n && n.length < 20 && !names.includes(n)
          && !['Piano', 'Pickup', 'Pick Up', 'Delivery', 'In Store', 'Upright', 'Grand']
            .includes(n)) names.push(n);
    }
  }
  return names;
}

/* ---------- handler ---------- */
export default async () => {
  const now = Date.now();
  if (cache.payload && now - cache.at < CACHE_MS) {
    return Response.json({ ...cache.payload, cached: true });
  }
  try {
    const csv = await (await fetch(PIANO_LOG_CSV)).text();
    const pianos = parsePianos(csv);
    let events = [];
    const icsUrl = process.env.BLP_MOVING_ICS;
    try {
      if (icsUrl) {
        events = parseEvents(await (await fetch(icsUrl)).text());
      } else {
        const j = await (await fetch(BRIDGE_URL + '?fn=events', { redirect: 'follow' })).json();
        events = j.events || [];
      }
    } catch { /* calendar down: pianos still ship */ }
    let tunings = { upcoming: [], past: [] };
    try {
      const t = await (await fetch(BRIDGE_URL + '?fn=tunings', { redirect: 'follow' })).json();
      if (t.upcoming) tunings = t;
    } catch { /* tuning calendar unavailable: feature degrades gracefully */ }
    const payload = {
      pianos, events, crew: crewToday(events), tunings,
      fetchedAt: new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T'),
      stale: false, calendarConfigured: events.length > 0 || !!icsUrl,
    };
    cache = { at: now, payload };
    return Response.json(payload);
  } catch (err) {
    if (cache.payload) return Response.json({ ...cache.payload, stale: true });
    return Response.json({ error: String(err), pianos: [], events: [], crew: [] },
      { status: 502 });
  }
};
