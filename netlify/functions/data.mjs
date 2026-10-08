// /api/data on Netlify — pianos from the Supabase READ MIRROR of the Piano
// Log (lib/pianolog-mirror.mjs, refreshed every ≤3 min + after every app
// write; the sheet stays the authority) with the public CSV export as the
// fallback, merged with the moving calendar and tuning calendar.
// Staff only: a verified @brighamlarsonpianos.com Google ID token, or the
// x-blp-data-key server secret (BLP_DATA_SECRET). See lib/blp-auth.mjs.
// The moving calendar's SECRET iCal URL comes from the BLP_MOVING_ICS env
// var (Netlify site settings) and must never be committed. Without it the
// app still works, just with no move events.
import { loadPianos, PIANO_LOG_CSV } from './lib/pianolog-mirror.mjs';
import parser from './lib/pianolog-parse.cjs';
import { authorizeDataRequest, denyResponse } from './lib/blp-auth.mjs';

// Apps Script bridge: serves calendar events via public GET (the secret
// iCal address lives inside the script, not here) and takes PIN-gated
// move requests. URL is not sensitive — writes require the PIN.
const BRIDGE_URL =
  'https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec';
const TZ = 'America/Denver';
// pianos: the mirror answers in ~0.3 s, so the per-instance copy is kept
// only long enough to absorb a burst of tabs (the realtime ping re-fetches
// right after a change lands, and must see it)
const CACHE_MS = 8000;
// calendars: the bridge takes 3–30 s, so events/tunings are served from a
// per-instance copy and refreshed in the background once it is older than
// this — the pianos never wait on Google
const CAL_FRESH_MS = 5 * 60000;

let cache = { active: null, full: null };
let calCache = { at: 0, events: null, tunings: null, refreshing: null, icsConfigured: false };

/* ---------- small utils ---------- */
const denverDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });
// the shared parser's helpers (same code the mirror sync runs)
const { pianoType } = parser;
// legacy export for anything that still parses CSV text itself
const parsePianos = text => parser.parseStoreMap(parser.parseCSV(text)).pianos;

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
// No CORS header. This payload is customer data (names, phones, emails,
// addresses). Same-origin Store Map requests do not need one, and a
// wildcard let any website read it. Other servers send x-blp-data-key.
const jsonRes = (body, init = {}) =>
  Response.json(body, { ...init, headers: { 'cache-control': 'private, no-store', ...(init.headers || {}) } });

async function loadCalendars() {
  const icsUrl = process.env.BLP_MOVING_ICS;
  const [eventsR, tuningsR] = await Promise.allSettled([
    icsUrl
      ? fetch(icsUrl, { signal: AbortSignal.timeout(40000) }).then(r => r.text()).then(parseEvents)
      : fetch(BRIDGE_URL + '?fn=events', { redirect: 'follow', signal: AbortSignal.timeout(40000) }).then(r => r.json()).then(j => j.events || []),
    fetch(BRIDGE_URL + '?fn=tunings', { redirect: 'follow', signal: AbortSignal.timeout(40000) }).then(r => r.json()),
  ]);
  const events = eventsR.status === 'fulfilled' ? eventsR.value : null;     // calendar down: pianos still ship
  const tunings = (tuningsR.status === 'fulfilled' && tuningsR.value.upcoming) ? tuningsR.value : null;
  if (events) calCache.events = events;
  if (tunings) calCache.tunings = tunings;
  if (events || tunings) calCache.at = Date.now();
  calCache.icsConfigured = !!icsUrl;
}

// calendars: fresh copy if we have one; otherwise refresh — but never let
// the (slow) bridge hold the pianos hostage: at most `waitMs`, and the
// refresh keeps running so the next call gets it
async function calendars(waitMs) {
  const age = Date.now() - calCache.at;
  if (!calCache.refreshing && (age > CAL_FRESH_MS || !calCache.events)) {
    calCache.refreshing = loadCalendars().catch(() => {}).finally(() => { calCache.refreshing = null; });
  }
  if (calCache.refreshing && !calCache.events) {
    await Promise.race([calCache.refreshing, new Promise(res => setTimeout(res, waitMs))]);
  }
  return { events: calCache.events || [], tunings: calCache.tunings || { upcoming: [], past: [] } };
}

export async function handleData(req, deps = {}) {
  const auth = await authorizeDataRequest(req, deps.authOpts);
  if (!auth.ok) return denyResponse(auth);
  const now = Date.now();
  const testing = typeof deps.loadPianos === 'function';
  // ?scope=active → only in-shop pianos (~750KB instead of ~6MB with the
  // full sold/delivered history) — the app boots on this and lazily pulls
  // the full set in the background (Brigham 8/29: make the app faster)
  let activeOnly = false, fresh = false;
  try { const u = new URL(req.url); activeOnly = u.searchParams.get('scope') === 'active'; fresh = u.searchParams.get('fresh') === '1'; } catch (e) {}
  const trim = payload => activeOnly
    ? { ...payload, pianos: (payload.pianos || []).filter(p => p.active), scope: 'active' }
    : payload;
  // one short-lived copy per scope — the active-only boot payload and the
  // full archive pull are different reads of the mirror
  const scopeKey = activeOnly ? 'active' : 'full';
  const hit = cache[scopeKey];
  // ?fresh=1: a realtime ping said the mirror changed — never answer from the copy
  if (!testing && hit && now - hit.at < CACHE_MS && !fresh) return jsonRes({ ...hit.payload, cached: true });
  try {
    const t0 = Date.now();
    // pianos (mirror, ~0.3 s; CSV fallback) and the calendars run together;
    // the calendars wait at most 1.5 s when there is no copy yet
    const load = deps.loadPianos || loadPianos;
    const cals = deps.calendars || calendars;
    const coming = deps.fetchComing || fetchComing;
    const [pr, cal, comingRows] = await Promise.all([
      load(activeOnly), cals(1500),
      coming().catch(e => { console.warn('[data] won_coming merge skipped:', String(e).slice(0, 120)); return []; }),
    ]);
    const pianos = pr.pianos;
    try { mergeComing(pianos, comingRows); } catch (e) { console.warn('[data] won_coming merge skipped:', String(e).slice(0, 120)); }
    const { events, tunings } = cal;
    const payload = {
      pianos, events, crew: crewToday(events), tunings,
      fetchedAt: new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T'),
      stale: false, calendarConfigured: events.length > 0 || calCache.icsConfigured,
      source: pr.source, mirrorSyncedAt: pr.lastSync, readMs: Date.now() - t0,
      full: !activeOnly, scope: activeOnly ? 'active' : 'full',
    };
    if (!testing) cache[scopeKey] = { at: now, payload };
    return jsonRes(payload);
  } catch (err) {
    const any = cache[scopeKey] || cache.full;
    if (any) return jsonRes({ ...trim(any.payload), stale: true });
    return jsonRes({ error: String(err), pianos: [], events: [], crew: [] },
      { status: 502 });
  }
}

export default (req) => handleData(req);

// shared with top10.mjs (Brigham's Top 10 brief)
/* ---------- "piano coming" from Sales App WON handoffs ----------
 * Shop projects sold in the Sales App (public.won_coming view in Supabase:
 * branch=shop, not yet arrived) show in the FRONT DOOR / PARKING LOT zone
 * as "Coming Soon" pianos until the serial shows up in the Piano Log. */
const SB_URL = (process.env.SUPABASE_URL || 'https://ismacawxfvvllfinibbf.supabase.co').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_MamcjSX0CHTdYlpKDWSkmQ_-nbuQ1z-';
async function fetchComing() {
  const r = await fetch(SB_URL + '/rest/v1/won_coming?select=*&order=created_at.desc', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('won_coming ' + r.status);
  return r.json();
}
// rows fetched alongside the mirror read (10/7) so the handoff lookup never
// adds to the response time
function mergeComing(pianos, rows) {
  if (!rows || !rows.length || !pianos.length) return;
  const have = new Set(pianos.filter(p => p.active && p.serial).map(p => p.serial.trim().toLowerCase()));
  const tmpl = pianos[0];
  const blank = Object.fromEntries(Object.keys(tmpl).map(k => {
    const v = tmpl[k];
    return [k, typeof v === 'boolean' ? false : typeof v === 'number' ? 0 : v && typeof v === 'object' ? (Array.isArray(v) ? [] : {}) : ''];
  }));
  rows.forEach((h, i) => {
    if (h.serial && have.has(String(h.serial).trim().toLowerCase())) return; // it's here — the real row shows instead
    const sold = h.created_at ? new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const promise = [h.track && h.track !== 'nd' ? h.track : '', h.queue_start && h.queue_start !== 'nd' ? 'starts in ' + h.queue_start : '', h.complete_by && h.complete_by !== 'nd' ? 'done in ' + h.complete_by : ''].filter(Boolean).join(' · ');
    pianos.push({
      ...blank, row: 900000 + i, section: 'WON — PIANO COMING', owner: h.lead_name || 'Client',
      serial: h.serial || '', summary: (h.piano || (h.lead_name + "'s piano")) + ' — ' + (h.lead_name || ''),
      type: pianoType(h.piano_type || '', (h.piano_type || '') + ' ' + (h.piano || '')),
      status: 'Sold — piano coming', location: 'Coming Soon — sold ' + sold + (h.closed_by ? ' by ' + h.closed_by : ''),
      phase: '', phasesDone: '', track: h.track && h.track !== 'nd' ? h.track : '', archived: false, active: true, isSlot: false, isNew: false,
      entered: h.created_at ? String(h.created_at).slice(0, 10) : null,
      waitNote: promise, phaseNotes: '🏆 Sold ' + sold + (h.closed_by ? ' by ' + h.closed_by : '') + (promise ? ' · ' + promise : '') + (h.summary_text ? '\n' + String(h.summary_text).slice(0, 500) : ''),
      scopeNotes: h.summary_text ? String(h.summary_text).slice(0, 500) : '',
      tasks: { ...blank.tasks }, logExtras: {}, queuePos: 0, queueTotal: 0,
      coming: true, handoffId: h.id, leadId: h.lead_id || '', portalProjectId: h.portal_project_id || '',
    });
  });
}

export { parsePianos, PIANO_LOG_CSV };
