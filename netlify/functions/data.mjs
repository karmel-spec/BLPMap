// /api/data on Netlify — JS port of server.py's parser.
// Piano Log CSV is public; the moving calendar's SECRET iCal URL comes from
// the BLP_MOVING_ICS env var (Netlify site settings) and must never be
// committed. Without it the app still works, just with no move events.

const PIANO_LOG_CSV =
  'https://docs.google.com/spreadsheets/d/1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc/export?format=csv&gid=970727205';
// Apps Script bridge: serves calendar events via public GET (the secret
// iCal address lives inside the script, not here) and takes PIN-gated
// move requests. URL is not sensitive — writes require the PIN.
const BRIDGE_URL =
  'https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec';
const TZ = 'America/Denver';
// must stay comfortably above app.js's 150s poll interval — a shorter
// window guarantees every poll is a cache miss and pays full fetch latency
const CACHE_MS = 170000;

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

function pianoType(cat, name) {
  const c = (cat || '').toLowerCase();
  if (c.startsWith('grand') || c.includes(', grand')) return 'grand';
  if (c.includes('digital')) return 'digital';
  if (/(upright|console|spinet|studio)/.test(c)) return 'upright';
  // category blank/unhelpful: fall back to the piano's own name text
  const n = (name || '').toLowerCase();
  if (/(upright|console|spinet|studio|vertical)/.test(n)) return 'upright';
  if (/grand/.test(n)) return 'grand';
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
    ? (() => {
        const i = rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'TAG / INVOICE PRICE');
        return i >= 0 ? i : rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'PRICE');
      })() : -1;
  const trackIdx = rows[1]
    ? rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'TRACK') : -1;
  const doneIdx = rows[1]
    ? rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'PHASES DONE') : -1;
  const waitIdx = rows[1]
    ? rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'WAITING NOTE') : -1;
  const crIdx = rows[1]
    ? rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'CLIENT REPORTS') : -1;
  const cbIdx = rows[1]
    ? rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'CHECK BACK') : -1;
  const cabIdx = rows[1]
    ? rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'CABINETRY') : -1;
  const typeOvIdx = rows[1]
    ? rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'TYPE OVERRIDE') : -1;
  const payPlanIdx = rows[1]
    ? rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'PAYMENT PLAN') : -1;
  const payMsIdx = rows[1]
    ? rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'PAY MILESTONE') : -1;
  const adminStIdx = rows[1]
    ? rows[1].findIndex(h => (h || '').trim().toUpperCase() === 'ADMIN STEPS') : -1;
  // CUSTOM SHOPWORK queue bounds (1-based rows)
  let qHdr = 0, qEnd = 0;
  for (let k = 0; k < rows.length; k++) {
    const b = (rows[k][1] || '').trim(), c = (rows[k][2] || '').trim(), d = (rows[k][3] || '').trim();
    if (!qHdr) { if (b.toUpperCase() === 'CUSTOM SHOPWORK' && !c && !d) qHdr = k + 1; }
    else if (!qEnd && !b && !c && !d) qEnd = k + 1;
  }
  const todayUTC = new Date(denverDay() + 'T00:00:00Z');
  let section = '', soldZone = false;
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const col = j => (r[j] || '').trim();
    const serial = col(2), summary = col(3);
    // Section banner. Most are blank except the label in col B, but a few
    // ("SOLD OR COMPLETED BUT NOT DELIVERED YET") also carry a note in the
    // summary column — so an ALL-CAPS one-line label with no serial and no
    // year/make/model counts as a banner too, not as a piano.
    const head = col(1);
    const capsBanner = !col(4) && !col(5) && !col(6) && head && !head.includes('\n')
      && head.length < 60 && /[A-Z]/.test(head) && !/[a-z]/.test(head);
    if (!serial && (!summary || capsBanner)) {
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
    // keyboard stands are inventory, not pianos — keep them off the map
    if (/\bstand\b/i.test(summary) || serial.trim().toLowerCase() === 'stand') continue;
    // section-header/status-note rows with no serial (room labels, "go to X
    // section" pointers, "Piano is [not] at BLP..." shop-follow-up notes) —
    // not a piano, just a divider or note row that slipped a summary in
    if (!col(4) && !col(5)
        && (/^haydn room$/i.test(summary.trim()) || /go to .* section/i.test(summary + ' ' + serial)
            || /^piano is /i.test(summary.trim()))) continue;
    // media cells: empty=needed, "Skipped ..."=deliberately skipped, else have
    // media cells: empty=needed, "Skipped ..."=deliberately skipped,
    // a bare "x"=not applicable to this piano (never needed), else done
    const med = j => {
      const v = col(j);
      if (!v) return false;
      if (/^x$/i.test(v.trim())) return 'na';
      return /^skip/i.test(v) ? 'skip' : true;
    };
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
      type: (typeOvIdx >= 0 && col(typeOvIdx)) || pianoType(col(9), summary + ' ' + col(6)),
      typeOverride: (typeOvIdx >= 0 && col(typeOvIdx)) || '', status, location: loc,
      // shop-tag statics: BENCH, PROJECT CATEGORY (plan), NOTES, REPLATING ORDERED
      bench: col(19).slice(0, 60), plan: col(23).slice(0, 220),
      planNotes: col(26).slice(0, 300), replate: col(50).slice(0, 20),
      // admin section: payment plan, last-emailed pay milestone, admin steps done
      payPlan: payPlanIdx >= 0 ? col(payPlanIdx) : '',
      payMilestone: payMsIdx >= 0 ? col(payMsIdx) : '',
      adminSteps: adminStIdx >= 0 ? col(adminStIdx) : '',
      isSlot: SLOT_RE.test(loc),
      entered: entered ? entered.toISOString().slice(0, 10) : null,
      phase: phaseIdx >= 0 ? col(phaseIdx) : '',
      // only $-amounts count; notes like "In-Store"/"TBD" aren't prices
      price: priceIdx >= 0 && /\d/.test(col(priceIdx)) ? col(priceIdx) : '',
      track: trackIdx >= 0 ? col(trackIdx) : '',
      phasesDone: doneIdx >= 0 ? col(doneIdx) : '',
      waitNote: waitIdx >= 0 ? col(waitIdx) : '',
      clientReports: crIdx >= 0 ? col(crIdx) : '',
      checkBack: cbIdx >= 0 ? col(cbIdx) : '',
      cabinetry: cabIdx >= 0 ? col(cabIdx) : '',
      bphoto: med(13), aphoto: med(15), bvideo: med(16), avideo: med(17),
      queuePos: 0, queueTotal: 0,
      isNew, active,
    });
  }
  // Queue numbers count PIANOS in row order (not raw row offsets), so they
  // stay a contiguous 1..N even if a label or junk row sits inside the
  // section — and match the Piano Log app's queue numbering.
  const q = pianos.filter(p => qHdr && qEnd && p.row > qHdr && p.row < qEnd);
  q.forEach((p, k) => { p.queuePos = k + 1; p.queueTotal = q.length; });
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
// CORS open for reads: the BLP Shop app (blpshop.netlify.app) pulls live
// phases from here so both apps agree on every piano's stage
const CORS = { 'access-control-allow-origin': '*' };
const jsonRes = (body, init = {}) =>
  Response.json(body, { ...init, headers: { ...CORS, ...(init.headers || {}) } });

export default async () => {
  const now = Date.now();
  if (cache.payload && now - cache.at < CACHE_MS) {
    return jsonRes({ ...cache.payload, cached: true });
  }
  try {
    const icsUrl = process.env.BLP_MOVING_ICS;
    // independent upstream calls (sheet export, moving calendar, tuning
    // calendar) — run them concurrently so total latency is the slowest
    // one, not the sum of all three
    const [csvR, eventsR, tuningsR] = await Promise.allSettled([
      fetch(PIANO_LOG_CSV).then(r => r.text()),
      icsUrl
        ? fetch(icsUrl).then(r => r.text()).then(parseEvents)
        : fetch(BRIDGE_URL + '?fn=events', { redirect: 'follow' }).then(r => r.json()).then(j => j.events || []),
      fetch(BRIDGE_URL + '?fn=tunings', { redirect: 'follow' }).then(r => r.json()),
    ]);
    if (csvR.status === 'rejected') throw csvR.reason;
    const pianos = parsePianos(csvR.value);
    const events = eventsR.status === 'fulfilled' ? eventsR.value : [];   // calendar down: pianos still ship
    const tunings = (tuningsR.status === 'fulfilled' && tuningsR.value.upcoming)
      ? tuningsR.value : { upcoming: [], past: [] };                     // tuning calendar unavailable: degrade gracefully
    const payload = {
      pianos, events, crew: crewToday(events), tunings,
      fetchedAt: new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T'),
      stale: false, calendarConfigured: events.length > 0 || !!icsUrl,
    };
    cache = { at: now, payload };
    return jsonRes(payload);
  } catch (err) {
    if (cache.payload) return jsonRes({ ...cache.payload, stale: true });
    return jsonRes({ error: String(err), pianos: [], events: [], crew: [] },
      { status: 502 });
  }
};
