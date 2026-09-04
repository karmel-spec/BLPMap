/* BLP Store Map — front-end */

// localStorage can be blocked entirely (installed-app mode, strict cookie
// settings) — every storage touch goes through these, falling back to an
// in-memory store so the app still works for the session
const __mem = {};
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return k in __mem ? __mem[k] : null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { __mem[k] = String(v); } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { delete __mem[k]; } }
const PIANOLOG_URL = 'https://pianologapp.netlify.app/';
// Brigham priority list (Shop Manager "Brigham" tab) — task requests land there
const BRIGHAM_API = 'https://blpsalesapp.netlify.app/.netlify/functions/brigham-tasks';
// shop pipeline phases (shared with the BLP Shop app via the Piano Log's
// CURRENT PHASE column). Q/P are the parking states. Brigham's July 2026
// rework — 14 phases.
const PHASES = ['New Arrival - Admin', 'Assessment', 'CAP',
  'PRSB & Plate Refinishing', 'Lacquer Soundboard', 'Restringing',
  'Chip Tuning', 'DHRT', '1st Tuning', 'Refinishing', 'QC & Assembly',
  '2nd Tuning', 'Exit Prep - Admin', 'Delivered'];
const PHASE_STATES = ['In Queue', 'Paused', 'For Sale',
  'Waiting on Brigham', 'Waiting on Curtis Harper', 'Waiting on Customer', 'Waiting on OTHER'];
// work tracks (multi-select, stored comma-separated in the TRACK column)
const TRACKS = ['Rebuild', 'Hybrid', 'Refurbish', 'Refinish', 'Technology', 'Old Player', 'Storage', 'Misc'];   // unnumbered states; For Sale turns the icon green
// Admin section: client payment plans, the shop-progress milestones that
// trigger a payment email to info@, and the client's admin-experience steps
const KEY_SERVICE = ['Ivory', 'Plastic', 'Ebony'];   // key-top service, multi-select
const PAY_PLANS = ['Pd in Full', '12 Month', '24 Month', '4 Progress Payments', 'Financed'];
const PAY_MILESTONES = [25, 50, 75, 100];
const ADMIN_STEPS = ['$1000 Queue Payment', 'Selections Made (Google Form)', 'Welcome Email',
  'Before Photos', 'Plan Entered to Shop Tag & Printed',
  'Upsell Offers — Brigham Call (after 50%)',
  '100% Payment Collected Prior to Delivery', 'Delivery Scheduled'];
// icon letter for each numbered phase (QC & Assembly gets two letters)
const PHASE_ABBR = {
  'New Arrival - Admin': 'N', 'Assessment': 'A', 'CAP': 'C',
  'PRSB & Plate Refinishing': 'P', 'Lacquer Soundboard': 'L',
  'Restringing': 'R', 'Chip Tuning': 'C', 'DHRT': 'D', '1st Tuning': 'T',
  'Refinishing': 'R', 'QC & Assembly': 'QC', '2nd Tuning': 'T',
  'Exit Prep - Admin': 'E',
};
// what an icon should read: {full:'6R', short:'6'} — or null for none.
// In Queue shows the queue position ("Q-7") when the piano has one.
function phaseLabels(phase, p) {
  if (!phase) return null;
  if (phase === 'In Queue') {
    const q = p && p.queuePos ? 'Q-' + p.queuePos : 'Q';
    return {full: q, short: 'Q'};
  }
  if (phase === 'Paused') return {full: 'P', short: 'P'};
  if (phase === 'Waiting on Brigham') return {full: 'WB', short: 'W'};
  if (phase === 'Waiting on Curtis Harper') return {full: 'WC', short: 'W'};
  if (phase === 'Waiting on Customer') return {full: 'WCu', short: 'W'};
  if (phase === 'Waiting on OTHER') return {full: 'WO', short: 'W'};
  if (phase === 'Delivered' || phase === 'For Sale') return null;
  const i = PHASES.indexOf(phase);
  if (i < 0) return null;
  const num = String(i + 1);
  return {full: num + (PHASE_ABBR[phase] || ''), short: num};
}
// Apps Script bridge for piano moves. The URL is public; writes require
// the team PIN (asked once, remembered on this device).
const BRIDGE_URL =
  'https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec';

/* EVERY write to the Google bridge goes through this guard (Brigham 9/3:
 * "ENSURE every change is SAVED"). Google's Apps Script serving has been
 * intermittently answering POSTs with its generic ping ({ok:true,
 * service:…}) WITHOUT running the action — which reads as success while
 * the change silently vanishes (lost cards 8/31-9/1, lost clock
 * adjustments, Lupita's lost phase change 9/3). This wrapper detects the
 * imposter, retries with backoff, and if Google still won't execute,
 * returns an honest error so no caller can ever report a fake save. */
// ops that set absolute values are resend-safe — they ride the durable
// relay (Netlify → Supabase queue → bridge), which survives any Google
// outage and never fakes a save. Everything else keeps the ping guard.
const RELAY_ACTIONS = /^(set[a-z]+|move|unmarkduplicate|tempresolve)$/;
const RELAY_URL = 'https://blpsalesapp.netlify.app/.netlify/functions/pianolog-write';
// fetch with a hard deadline — shop Wi-Fi + a stalled connection used to
// hang uploads forever ("Sending…" stuck, Melissa/Brigham 9/3). A timeout
// aborts the socket so the caller can fail honestly or retry.
function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 25000);
  return fetch(url, {...opts, signal: ctrl.signal}).finally(() => clearTimeout(t));
}
async function bridgeFetch(url, opts) {
  // durable-relay branch: whitelisted piano-log writes
  try {
    const body = JSON.parse(opts && opts.body || '{}');
    if (body.action && RELAY_ACTIONS.test(body.action)) {
      const rr = await fetchT(RELAY_URL, {method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({...body, relayKey: 'pianoman'})}, 20000);
      if (rr.ok || rr.status === 502) return rr;   // real result, queued-ack, or honest error
      // relay itself unreachable/misconfigured — fall through to the bridge
    }
  } catch (e) { /* non-JSON body or relay down — use the bridge directly */ }
  for (let a = 0; a < 4; a++) {
    let r;
    try { r = await fetchT(url, opts, 25000); }
    catch (e) {
      if (a === 3) throw e;
      await new Promise(res => setTimeout(res, 1000 * (a + 1)));
      continue;
    }
    let j = null;
    // non-JSON = Google's HTML error page (mid-deploy or overloaded) — never
    // hand that to a caller's r.json() ("Unexpected token '<'" popups, 9/3):
    // treat it like a failed attempt and retry
    try { j = await r.clone().json(); }
    catch (e) { await new Promise(res => setTimeout(res, 1200 * (a + 1))); continue; }
    if (!(j && j.service && !j.error)) return r;   // real action result
    await new Promise(res => setTimeout(res, 1200 * (a + 1)));
  }
  return new Response(JSON.stringify({error:
    'the Google bridge hiccuped and this change did NOT save — try again in a minute'}),
    {status: 502, headers: {'content-type': 'application/json'}});
}
// "Sign in with Google" (identity for the activity log — who changed what).
// Public web client in karmel@'s "BLP Store Map" Google Cloud project;
// empty string hides the sign-in UI entirely.
const GOOGLE_CLIENT_ID = '110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com';
const PRICETAGS_URL = 'https://blppricetags.netlify.app/';
const SLOT_RE = /^\d+(?:\.\d)?[a-zA-Z]?$/;
// named areas in col U that are legitimate (not "unplaced") even though
// they aren't numbered slots on the map
const KNOWN_AREAS = ['showroom', 'pre-sale showroom', 'third floor', 'storage',
  'shop', 'vestibule', 'wing room', 'holding room', 'attic', 'sold floor',
  'rebuilding line', 'refinishing', 'back shop', 'middle shop', 'basement',
  'warehouse', 'rental', 'rented', 'out for delivery', 'customer', 'sanding', 'coming soon',
  'conference room', 'larson home'];

// standard "big" icon scale, matching what a normal single-piano numbered
// slot renders at (e.g. spot 60) — every virtual zone (refinishing/sanding
// overflow rows, coming-soon, out-for-service, rented, conference room)
// targets this size, only shrinking a row when it genuinely can't fit
const BIGICON_SC = 4;
const BIGICON_PITCH = 27;   // icon+gap footprint at scale 1 (matches the numbered-slot convention)
// how many icons fit per row at BIGICON_SC within maxWidth, and the scale
// to actually use (BIGICON_SC, unless even ONE icon can't fit that width —
// then shrink just enough for one column to fit)
function bigIconLayout(maxWidth) {
  const fullPitch = BIGICON_PITCH * BIGICON_SC;
  const cols = Math.max(1, Math.floor(maxWidth / fullPitch));
  const sc = cols >= 1 && maxWidth < fullPitch ? Math.max(0.7, maxWidth / BIGICON_PITCH) : BIGICON_SC;
  return {cols, sc, pitch: BIGICON_PITCH * sc};
}
// same idea, but also bounded by a fixed available height (e.g. a real
// walled room) — shrinks below BIGICON_SC only as much as needed so every
// icon still fits inside both dimensions
// nearest real wall directly below [x1,x2] and below y=belowY, on this
// floor — used to stop a "below the label" piano stack before it runs into
// whatever equipment/room sits just past the room's open-plan boundary
function wallBelow(floorIdx, x1, x2, belowY) {
  const hits = S.map.floors[floorIdx].walls.filter(w =>
    w.y1 === w.y2 && w.y1 > belowY &&
    Math.max(w.x1, w.x2) >= x1 && Math.min(w.x1, w.x2) <= x2);
  return hits.length ? Math.min(...hits.map(w => w.y1)) : null;
}
// 4-directional raycast from a point to the nearest enclosing walls on this
// floor — used to fit icons inside an actual walled room (not just an
// open-plan labeled zone) without spilling past its real boundary
function wallBoundsAround(floorIdx, cx, cy) {
  const walls = S.map.floors[floorIdx].walls;
  const hz = walls.filter(w => w.y1 === w.y2 && Math.min(w.x1, w.x2) <= cx && Math.max(w.x1, w.x2) >= cx);
  const vt = walls.filter(w => w.x1 === w.x2 && Math.min(w.y1, w.y2) <= cy && Math.max(w.y1, w.y2) >= cy);
  const top = hz.filter(w => w.y1 < cy).sort((a, b) => b.y1 - a.y1)[0];
  const bot = hz.filter(w => w.y1 > cy).sort((a, b) => a.y1 - b.y1)[0];
  const topY = top ? top.y1 : cy - 300, botY = bot ? bot.y1 : cy + 300;
  const midY = (topY + botY) / 2;
  const vt2 = walls.filter(w => w.x1 === w.x2 && Math.min(w.y1, w.y2) <= midY && Math.max(w.y1, w.y2) >= midY);
  const left = vt2.filter(w => w.x1 < cx).sort((a, b) => b.x1 - a.x1)[0];
  const right = vt2.filter(w => w.x1 > cx).sort((a, b) => a.x1 - b.x1)[0];
  return {top: topY, bot: botY, left: left ? left.x1 : cx - 300, right: right ? right.x1 : cx + 300};
}
function fitIconsInBox(count, maxWidth, maxHeight) {
  let lay = bigIconLayout(maxWidth);
  let rows = Math.max(1, Math.ceil(count / lay.cols));
  const scByHeight = maxHeight / (rows * BIGICON_PITCH);
  if (scByHeight < lay.sc) {
    const sc = Math.max(0.6, scByHeight);
    const pitch = BIGICON_PITCH * sc;
    const cols = Math.max(1, Math.floor(maxWidth / pitch));
    rows = Math.max(1, Math.ceil(count / cols));
    return {cols, rows, sc, pitch};
  }
  return {cols: lay.cols, rows, sc: lay.sc, pitch: lay.pitch};
}

// pianos parked in a named work area are drawn INSIDE that zone on the map
// (not in the holding grid). location text -> map zone label to place them in.
const AREA_BINS = [
  {test: l => l.includes('refinish'), zones: ['refinishing shop', 'refinishing room'], below: true},
  {test: l => l.includes('sanding'), zones: ['sanding shop', 'back shop', 'sanding room'], below: true},
  {test: l => /conference room|larson home/i.test(l), zones: ['conference room'], key: 'conference'},
  {test: l => /\bwing room 4\b/i.test(l), zones: ['recital hall wing room 4']},
];
// Every destination a tech may type into "new spot #": real map slots plus
// the named work areas. Anything else gets rejected before the bridge call.
const MOVE_AREAS = ['Attic', 'Refinishing Shop', 'Sanding Shop', 'Conference Room',
  'Larson Home', 'Recital Hall Wing Room 4'];
function moveDests() {
  const out = [];
  for (const f of ((S.map && S.map.floors) || []))
    for (const sl of (f.slots || [])) out.push(sl.id);
  out.sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
  return out.concat(MOVE_AREAS);
}
function isValidDest(v) {
  const n = String(v || '').trim().toLowerCase();
  return S.slotFloor.has(n) || MOVE_AREAS.some(a => a.toLowerCase() === n);
}
// which bin (if any) a piano's location assigns it to
function areaBinFor(p) {
  if (p.isSlot && S.slotFloor.has((p.location || '').toLowerCase())) return null;
  const l = (p.location || '').toLowerCase();
  return AREA_BINS.find(b => b.test(l)) || null;
}
// which floor actually has a zone label matching this bin (bins live on
// whichever floor the Store Map sheet drew their room on — not assumed)
function floorForBin(bin) {
  for (let i = 0; i < S.map.floors.length; i++) {
    if (S.map.floors[i].labels.some(z => bin.zones.includes(z.text.trim().toLowerCase()))) return i;
  }
  return 0;
}
// the bin whose zones list includes this zone-label (or null)
function binForZone(normLabel) {
  return AREA_BINS.find(b => b.zones.includes(normLabel)) || null;
}
// display relabels for zone labels (sheet may still say "Back Shop")
const ZONE_RELABEL = {'back shop': 'Sanding Shop', 'upstairs office 3': '3D Printing Lab', 'admin office': 'Bench Room',
  'recital hall wing room 3': "Alisa's Office", 'upstairs office 2': "Melissa's Office"};

const S = {
  map: null, data: null, floor: 0, search: '', view: 'map',
  bySlot: new Map(), slotFloor: new Map(),
  zoom: 1,        // 1 = map fills the card width; scroll down to explore
  feedOpen: false, // map opens full width; the truck button opens the feed
  focusRow: null, // piano row highlighted by search / NEW-chip focus
  // Media Needed report: each of the 4 categories collapses/expands on its
  // own, so a user can shrink three and print just the one they need
  mediaOpen: {bp: true, bv: true, ap: true, av: true},
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g,
  c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

const EMPTY = {pianos: [], events: [], crew: [], fetchedAt: null, stale: true};
async function fetchData(scope) {
  const r = await fetch('/api/data' + (scope === 'active' ? '?scope=active' : ''));
  if (!r.ok) throw new Error('api ' + r.status);
  return r.json();
}
/* speed: boot + refresh use the ~640KB active-only payload; the ~5MB
 * sold/delivered history loads ONCE in the background a few seconds after
 * first paint (the archive view + delivered search need it) and is kept
 * merged in on every later refresh (Brigham 8/29) */
let inactiveCache = null, inactiveLoading = false;
function mergeInactive(d) {
  if (d && d.scope === 'active' && inactiveCache) {
    d.pianos = d.pianos.concat(inactiveCache);
  }
  return d;
}
async function loadInactive() {
  if (inactiveCache || inactiveLoading) return;
  inactiveLoading = true;
  try {
    const full = await fetchData();
    inactiveCache = (full.pianos || []).filter(p => !p.active);
    if (S.data && S.data.scope === 'active') {
      S.data.pianos = S.data.pianos.filter(p => p.active).concat(inactiveCache);
      index(); renderAll();
    }
  } catch (e) { /* archive stays lazy — retried on demand */ }
  inactiveLoading = false;
}
async function fetchSlots() {
  // live geometry regenerated from the Store Map sheet; committed
  // snapshot as fallback (local dev, or the sheet being unreachable)
  try {
    const r = await fetch('/api/slots');
    if (r.ok) {
      const doc = await r.json();
      if (doc.floors) return doc;
    }
  } catch (e) { /* fall through */ }
  return fetch('data/slots.json', {cache: 'no-cache'}).then(r => r.json());
}
// last-known map + pianos, remembered on this device so repeat visits paint
// instantly; the sidebar shows "⚠ offline snapshot" until fresh data lands
const CACHE_KEY = 'blpMapCache';
function readCache() {
  try {
    const c = JSON.parse(lsGet(CACHE_KEY) || 'null');
    if (c && c.map && c.map.floors && c.data && c.data.pianos) return c;
  } catch (e) { /* corrupt cache — ignore */ }
  return null;
}
function writeCache() {
  try {
    lsSet(CACHE_KEY,
      JSON.stringify({map: S.map, data: S.data, at: Date.now()}));
  } catch (e) { /* quota / private mode — caching is best-effort */ }
}

async function boot() {
  const cached = readCache();
  if (cached) {                     // repeat visit: full map on screen instantly
    S.map = cached.map;
    S.data = {...cached.data, stale: true};
    index(); renderAll();
  }
  // kick both requests off together, and draw the floor plan the moment
  // the geometry lands — pianos pop in as soon as their data arrives
  const dataP = fetchData('active').catch(() => null);
  try {
    const m = await fetchSlots();
    if (m && m.floors) S.map = m;
  } catch (e) { if (!cached) throw e; }   // cached geometry keeps us alive
  if (!cached) { S.data = EMPTY; index(); renderAll(); }
  const d = await dataP;
  if (d && d.pianos) S.data = d;
  index(); renderAll();
  if (!S.data.stale && S.data.pianos.length) writeCache();
  tryDeepLink();   // #piano=SERIAL from a scanned shop tag → open that card
  tryReportLink(); // #report=<id> from a shared link → open that report
  tryCardLink();   // #card=<id> from a task-board notification text/email
  tryFixClockLink(); // #fixclock from a late-clock text → the time-fix form
  setTimeout(loadInactive, 4000);   // sold/delivered history, off the critical path
  setInterval(async () => {
    try {
      const [m, d2] = await Promise.all([fetchSlots(), fetchData('active')]);
      S.map = m; S.data = mergeInactive(d2);
      index(); renderAll();
      if (!d2.stale && d2.pianos.length) writeCache();
    } catch (e) { /* keep last */ }
  }, 150000);
}


/* ================= TRACK PLANS & CONCURRENT TASKS =================
   data/tracks.json (scripts/fetch_tracks.py) mirrors the track tabs of the
   "Sequence by Piano technician" sheet: each track's phase list plus its
   concurrent tasks and the phase window each task must happen within.
   A piano's card loads the phases for ITS track(s) (union, in order) and
   lists the tasks with mark-off pills; per-piano marks live on the Piano
   Log's "Task Status" tab via the piano-tasks bridge. */
const PIANO_TASKS_API = 'https://blpsalesapp.netlify.app/.netlify/functions/piano-tasks';
const PLATING_REQUEST_API = 'https://blpsalesapp.netlify.app/.netlify/functions/plating-request';
let TRACKDEFS = null;
// live from the Sequence sheet (10-min server cache) so Brigham's tab edits
// apply automatically; the committed snapshot is the offline fallback
fetch('https://blpsalesapp.netlify.app/.netlify/functions/track-defs')
  .then(r => r.json())
  .then(d => { if (d && d.tracks) { TRACKDEFS = d; return; } throw 0; })
  .catch(() => fetch('data/tracks.json', {cache: 'no-cache'}).then(r => r.json())
    .then(d => { TRACKDEFS = d; }).catch(() => {}));

// track-tab phase wording -> the master PHASES vocabulary (order matters:
// "chip tuning if new strings" must hit Chip Tuning before the string test)
function normTrackPhase(s) {
  const t = String(s || '').toLowerCase();
  if (t.includes('new arrival')) return 'New Arrival - Admin';
  if (t.includes('assessment')) return 'Assessment';
  if (t.startsWith('add-ons')) return 'Add-ons';
  // track-sheet steps outside the master 14 — canonical names the bridge
  // also accepts (082726hales17: "unknown phase" saving Key Servicing)
  if (t.includes('key servic')) return 'Key Service';
  if (t.includes('refurb')) return 'Refurb Checklist';
  if (t.includes('repair')) return 'Repair Work';
  if (t.includes('chip tuning')) return 'Chip Tuning';
  if (t.includes('string')) return 'Restringing';
  if (t.includes('cap')) return 'CAP';
  if (t.includes('prsb')) return 'PRSB & Plate Refinishing';
  if (t.includes('lacquer')) return 'Lacquer Soundboard';
  if (t.includes('dhrt')) return 'DHRT';
  if (t.includes('1st tuning')) return '1st Tuning';
  if (t.includes('2nd tuning')) return '2nd Tuning';
  if (t.startsWith('(refinishing')) return 'Refinishing';
  if (t.includes('qc')) return 'QC & Assembly';
  if (t.includes('exit prep')) return 'Exit Prep - Admin';
  if (t.includes('delivered')) return 'Delivered';
  if (t === 'tuning') return '1st Tuning';
  return String(s).trim().replace(/\s+/g, ' ').replace(/^./, c => c.toUpperCase());
}
function trackKeysFor(p) {
  if (!TRACKDEFS) return [];
  const have = trackParts(p.track).list.map(t => t.toLowerCase());
  const alias = {rebuild: 'rebuild', hybrid: 'hybrid', refurbish: 'refurbishing',
                 refurbishing: 'refurbishing', repair: 'repair'};
  const keys = [];
  for (const t of have) {
    const k = alias[t];
    if (k && TRACKDEFS.tracks[k] && !keys.includes(k)) keys.push(k);
  }
  return keys;
}
// union of the piano's tracks' phases, keeping each track's order (extra
// tracks merge in after their nearest shared predecessor)
function pianoPhases(p) {
  const keys = trackKeysFor(p);
  if (!keys.length) return null;
  const lists = keys.map(k => TRACKDEFS.tracks[k].phases.map(normTrackPhase));
  const seq = lists[0].filter((x, i, a) => a.indexOf(x) === i);
  for (const list of lists.slice(1)) {
    let anchor = -1;
    for (const ph of list) {
      const at = seq.indexOf(ph);
      if (at >= 0) { anchor = at; continue; }
      seq.splice(anchor + 1, 0, ph);
      anchor += 1;
    }
  }
  return seq;
}
function phaseOptions(p, effPh) {
  const list = pianoPhases(p) || PHASES;
  return (effPh && !list.includes(effPh) && !PHASE_STATES.includes(effPh))
    ? list.concat(effPh) : list;
}

/* ---- concurrent tasks ---- */
const taskId = n => String(n).toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
function taskSteps(name) {
  const t = name.toLowerCase();
  if (t.includes('decal')) return ['Ordered', 'Received'];
  if (t.includes('electroplat')) return ['Submitted', 'Received'];
  if (t.includes('order parts')) return ['Ordered', 'Received'];  // per part
  return [null, 'Done'];
}
function pianoTaskDefs(p) {
  const keys = trackKeysFor(p);
  const plist = pianoPhases(p) || [];
  const byId = new Map();
  for (const k of keys) for (const task of TRACKDEFS.tracks[k].tasks) {
    const id = taskId(task.name);
    const s = plist.indexOf(normTrackPhase(task.startPhase));
    const e = plist.indexOf(normTrackPhase(task.endPhase));
    const got = byId.get(id);
    if (!got) byId.set(id, {id, name: task.name.replace(/\s*\(if applicable\)/i, '').trim(), s, e});
    else { got.s = Math.min(got.s, s); got.e = Math.max(got.e, e < 0 ? got.e : e); }
  }
  return [...byId.values()];
}
// keytop status (Brigham 8/27): dropdown in the Concurrent section; the
// "In Key Queue" choice carries a queue-position number ("In Key Queue #3")
const KEYTOP_STATES = ['Evaluate', 'In Key Queue', 'In Progress', 'Done'];
function keytopParts(p) {
  const raw = String(p.keytopStatus || '').trim().replace(/^In Process$/i, 'In Progress');
  const m = /^(Evaluate|In Key Queue|In Progress|Done)(?:\s*#?\s*(\d+))?$/i.exec(raw);
  if (!m) return {state: '', num: ''};
  return {state: KEYTOP_STATES.find(s => s.toLowerCase() === m[1].toLowerCase()),
          num: m[2] || ''};
}
function tasksBox(p) {
  if (!p.serial) return '';
  const kt = keytopParts(p);
  return `<div class="taskbox"><div class="taskhead">Concurrent tasks
      <span class="taskmsg"></span></div>
    <div class="row phrow platerow">Plate
      <select class="platesel">
        <option value="" ${!(p.plateStatus || '').trim() ? 'selected' : ''}>— not tracked —</option>
        ${PLATE_STAGES.map(v =>
          `<option ${p.plateStatus === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
      </select></div><div class="platemsg phmsg"></div>
    <div class="row phrow keystatrow">Keytops
      <select class="keystatsel">
        <option value="" ${!kt.state ? 'selected' : ''}>— not tracked —</option>
        ${KEYTOP_STATES.map(v =>
          `<option value="${v}" ${kt.state === v ? 'selected' : ''}>${v === 'In Key Queue' ? 'In Key Queue #' : v}</option>`).join('')}
      </select>
      <input class="keyqnum" type="number" min="1" max="99" placeholder="#"
        title="place in the key queue" value="${esc(kt.num)}" ${kt.state === 'In Key Queue' ? '' : 'hidden'}>
    </div><div class="keystatmsg phmsg"></div>
    ${orderChipsRow(p, 'bass', 'Bass strings')}
    ${decalsRow(p)}
    ${trackKeysFor(p).length ? '<div class="taskbody">loading…</div>' : ''}</div>`;
}
// Date marks live in the same Piano Log cells the Concurrent Work report
// reads — "Ordered 8/27/26 · Received 9/3/26 · Installed 9/10/26 · note"
const DECAL_MARKS = ['Ordered', 'Received', 'In Stock', 'Installed'];
function taskCellMarks(p, key, names) {
  const v = String((p.tasks || {})[key] || '');
  const out = {rest: v};
  for (const n of names) {
    // value may carry a date and who did it: "Ordered 8/21/26 (Mark)"
    const m = new RegExp(n.replace(' ', '\\s+') + '\\s*([\\d/.-]+)?\\s*(\\(([^)]*)\\))?', 'i').exec(out.rest);
    out[n] = m ? (m[1] || '✓') : '';
    out[n + 'By'] = m && m[3] ? m[3].trim() : '';
    out.rest = out.rest.replace(new RegExp(n.replace(' ', '\\s+') + '\\s*[\\d/.-]*\\s*(\\([^)]*\\))?', 'gi'), '');
  }
  out.rest = out.rest.replace(/\s*·\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return out;
}
function taskCellValue(marks, names) {
  return names.map(n => marks[n] ? n + (marks[n] === '✓' ? '' : ' ' + marks[n]) : '')
    .concat(marks.rest).filter(Boolean).join(' · ');
}
function orderMarks(p, key) {
  const m = taskCellMarks(p, key, ['Ordered', 'Received']);
  return {ordered: m['Ordered'], received: m['Received'], rest: m.rest};
}
function decalsRow(p) {
  const ms = taskCellMarks(p, 'decals', DECAL_MARKS);
  const have = DECAL_MARKS.filter(n => ms[n]);
  return `<div class="row phrow bassrow">Decals
      <span class="decalcur">${have.length
        ? have.map(n => `${n === 'Installed' ? '✅' : n === 'In Stock' ? '📥' : n === 'Received' ? '📬' : '📦'} ${n}${ms[n] === '✓' ? '' : ' ' + esc(ms[n])}`).join(' · ')
        : '<i class="mna">— not tracked —</i>'}</span>
      <select class="decalsel">
        <option value="" selected>set…</option>
        ${DECAL_MARKS.map(n => `<option value="${n}">${ms[n] ? '✕ clear ' : ''}${n}</option>`).join('')}
        ${have.length ? '<option value="__clear__">clear all</option>' : ''}
      </select>
    </div><div class="bassmsg bassmsg-decals phmsg"></div>`;
}
function orderChipsRow(p, key, label) {
  const ms = taskCellMarks(p, key, ['Ordered', 'Received']);
  // set marks show date · who and open the editor (date + who are editable —
  // parts often arrive before anyone marks them, and the marker isn't always
  // the receiver — Brigham 8/28)
  const chip = (k, ico) => ms[k]
    ? `<button class="bassbtn on" data-task="${key}" data-k="${k}" title="tap to edit the date or who">
        ${ico} ${k} ${esc(ms[k] === '✓' ? '' : ms[k])}${ms[k + 'By'] ? ' · ' + esc(ms[k + 'By']) : ''} ✎</button>`
    : `<button class="bassbtn" data-task="${key}" data-k="${k}">${ico} ${k}</button>`;
  return `<div class="row phrow bassrow">${label}
      <span class="bassbtns">${chip('Ordered', '📦')}${chip('Received', '📬')}</span>
    </div><div class="bassmsg bassmsg-${key} phmsg"></div>`;
}
async function loadTasks(p, pop) {
  const body = pop.querySelector('.taskbody');
  if (!body) return;
  let state = [];
  try {
    const r = await fetch(PIANO_TASKS_API + '?serial=' + encodeURIComponent(p.serial));
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    state = j.rows || [];
  } catch (e) {
    body.innerHTML = `<span class="mno">task status unavailable: ${esc(String(e.message || e).slice(0, 90))}</span>`;
    return;
  }
  renderTasksInto(p, pop, state);
}
function renderTasksInto(p, pop, state) {
  const body = pop.querySelector('.taskbody');
  if (!body) return;
  const plist = pianoPhases(p) || [];
  const curIdx = plist.indexOf(effectivePhase(p));
  const find = (id, part) => state.find(r => taskId(r.task) === id &&
    String(r.part || '').toLowerCase() === String(part || '').toLowerCase());
  const pill = (t, part, step, label, stamp) =>
    `<button class="tpill ${stamp ? 'on' : ''}" data-task="${esc(t)}" data-part="${esc(part || '')}"
      data-step="${step}" data-label="${esc(label)}" title="${esc(stamp || '')}">${esc(label)}${stamp ? ' ✓' : ''}</button>`;
  let html = '';
  for (const def of pianoTaskDefs(p)) {
    const isParts = def.id.includes('order parts');
    const [s1, s2] = taskSteps(def.name);
    const win = (def.s >= 0 && def.e >= 0)
      ? `${plist[def.s]} – ${plist[def.e]}` : '';
    const row = find(def.id, '');
    const complete = isParts
      ? state.filter(r => taskId(r.task) === def.id && r.part).every(r => r.step2At) &&
        state.some(r => taskId(r.task) === def.id && r.part)
      : !!(row && row.step2At);
    let cls = '';
    if (curIdx >= 0 && def.e >= 0 && curIdx > def.e && !complete) cls = 'overdue';
    else if (curIdx >= 0 && def.s >= 0 && curIdx < def.s) cls = 'tdim';
    html += `<div class="taskrow ${cls}"><div class="tname">${esc(def.name)}
        ${win ? `<span class="twin">${esc(win)}</span>` : ''}${cls === 'overdue' ? '<span class="tdue">due!</span>' : ''}</div>`;
    if (isParts) {
      for (const r of state.filter(x => taskId(x.task) === def.id && x.part)) {
        html += `<div class="tpart"><span>${esc(r.part)}</span><span class="tpills">
          ${pill(def.id, r.part, 1, s1 || 'Ordered', r.step1At)}${pill(def.id, r.part, 2, s2, r.step2At)}</span></div>`;
      }
      html += `<div class="tpart partadd"><input placeholder="+ part to order (e.g. Abel Hammers)" maxlength="60">
        <button class="tpill padd" data-task="${esc(def.id)}">+ add</button></div>`;
    } else {
      const reqBtn = def.id.includes('electroplat')
        ? `<button class="tpill preq" data-task="${esc(def.id)}">✉ request form</button>` : '';
      html += `<div class="tpills">${s1 ? pill(def.id, '', 1, s1, row && row.step1At) : ''}${pill(def.id, '', 2, s2, row && row.step2At)}${reqBtn}</div>`;
    }
    html += `</div>`;
  }
  body.innerHTML = html || '<span class="mna">no concurrent tasks for this track</span>';
  body.querySelectorAll('.tpill:not(.padd):not(.preq)').forEach(b => b.onclick = ev => {
    ev.stopPropagation(); markTask(p, b, pop);
  });
  const rq = body.querySelector('.preq');
  if (rq) rq.onclick = ev => { ev.stopPropagation(); openPlatingModal(p, pop); };
  const addBtn = body.querySelector('.padd');
  if (addBtn) addBtn.onclick = async ev => {
    ev.stopPropagation();
    const inp = addBtn.parentElement.querySelector('input');
    const part = inp.value.trim();
    if (!part) { inp.focus(); return; }
    addBtn.disabled = true;
    const ok = await postTask(p, pop, {task: addBtn.dataset.task, part, step: 1, label: 'Ordered', on: false});
    addBtn.disabled = false;
    if (ok) loadTasks(p, pop);
  };
  body.querySelectorAll('.partadd input').forEach(i => i.onclick = ev => ev.stopPropagation());
}
async function markTask(p, btn, pop) {
  const on = !btn.classList.contains('on');
  btn.disabled = true;
  const ok = await postTask(p, pop, {task: btn.dataset.task, part: btn.dataset.part || '',
    step: +btn.dataset.step, label: btn.dataset.label, on});
  btn.disabled = false;
  if (ok) {
    btn.classList.toggle('on', on);
    btn.textContent = btn.dataset.label + (on ? ' ✓' : '');
  }
}
async function postTask(p, pop, fields) {
  const msg = pop.querySelector('.taskmsg');
  const af = authFields();
  const key = (localStorage.getItem('blp.appkey') || '').trim();
  if (!af.idToken && !key) {
    msg.textContent = '— sign in (menu) so marks are saved under your name';
    return false;
  }
  msg.textContent = '…';
  try {
    const headers = {'content-type': 'application/json'};
    if (af.idToken) headers.authorization = 'Bearer ' + af.idToken;
    const r = await fetch(PIANO_TASKS_API, {method: 'POST', headers,
      body: JSON.stringify({key, serial: p.serial,
        by: (af.user && (af.user.name || af.user.email)) || 'Team', ...fields})});
    const j = await r.json();
    if (j.ok) { msg.textContent = ''; return true; }
    if (r.status === 401) localStorage.removeItem('blp.appkey');
    msg.textContent = '✗ ' + (j.error || ('HTTP ' + r.status));
  } catch (e) { msg.textContent = '✗ ' + (e.message || e); }
  return false;
}

/* ---- tech specialties: who to assign for the current phase ---- */
const PHASE_TO_AREA = {
  'CAP': 'CAP', 'PRSB & Plate Refinishing': 'PRSB', 'Lacquer Soundboard': 'lacquer soundboard',
  'Restringing': 'restringing', 'Chip Tuning': 'chip tuning', '1st Tuning': 'tuning',
  '2nd Tuning': 'tuning', 'Refinishing': 'refinishing', 'QC & Assembly': 'QC and assembly',
  'Key service': 'keys', 'Refurb checklist': 'refurbishing', 'Repair work': 'repairs',
};
// team-wide recent Time Log (fast feed) so cards can show who actually has
// the piano — assigned/working beats the generic specialist list (Brigham 9/3)
const TEAMTL = {at: 0, last: null, loading: false};
function loadTeamTl(p) {
  if (TEAMTL.loading || (TEAMTL.last && Date.now() - TEAMTL.at < 300000)) return;
  TEAMTL.loading = true;
  fetch('https://blpsalesapp.netlify.app/.netlify/functions/clock-history?key=pianoman&days=14')
    .then(r => r.json()).then(j => {
      const m = new Map();
      (j.tl || []).forEach(r => {
        const k = String(r.serial || '');
        if (!k) return;
        const prev = m.get(k);
        if (!prev || new Date(r.start) > new Date(prev.start)) m.set(k, r);
      });
      TEAMTL.last = m; TEAMTL.at = Date.now(); TEAMTL.loading = false;
      // repaint the open card so the line upgrades from Go-to to the real name
      if (p && !$('#pop').hidden) openPop(p.row, S.popAnchor, true);
    }).catch(() => { TEAMTL.loading = false; });
}
function gotoLine(p, effPh) {
  // 1 · someone is clocked in on this piano RIGHT NOW
  const live = (CLOCK.all || []).find(o => o.serial === p.serial);
  if (live) {
    const first = (live.tech || '').split(/\s+/)[0] || live.tech;
    return `<div class="gotoline" style="color:#2f7d4f"><b>● On it now: ${esc(first)}</b> — ${esc(live.phase || 'working')}</div>`;
  }
  // 2 · the most recent tech in the Time Log has it (assigned in practice)
  if (!TEAMTL.last) loadTeamTl(p);
  const last = TEAMTL.last && TEAMTL.last.get(String(p.serial));
  if (last) {
    const first = (last.tech || '').split(/\s+/)[0] || last.tech;
    const when = new Date(last.start).toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'});
    return `<div class="gotoline"><b>Working it: ${esc(first)}</b> · last ${esc(when)}${last.phase ? ' · ' + esc(last.phase.slice(0, 26)) : ''}</div>`;
  }
  // 3 · nobody yet — fall back to the specialist go-to list
  if (!TRACKDEFS || !effPh) return '';
  let area = PHASE_TO_AREA[effPh];
  if (effPh === 'DHRT') area = p.type === 'grand' ? 'DHRT for grands' : 'DHRT for uprights';
  if (!area) return '';
  const folks = (TRACKDEFS.specialties.people || [])
    .filter(x => x.role !== 'intern' && (x.skills[area] || 0) >= 2)
    .sort((a, b) => (b.skills[area] || 0) - (a.skills[area] || 0)).slice(0, 4);
  if (!folks.length) return '';
  return `<div class="gotoline" title="tech specialties (★ = go-to expert)">Go-to: ${
    folks.map(x => esc(x.name) + ((x.skills[area] === 3) ? ' ★' : '')).join(', ')}</div>`;
}


// edits confirmed by the bridge but maybe not yet reflected in the 2-min
// cached /api/data — re-applied after every poll so a refresh can't revert
// a just-saved change. Keyed by piano row. {phase, location}
const pendingEdits = new Map();
// survive reloads: a fresh edit outranks the server's 2-minute-stale cache,
// so what you just saved never LOOKS reverted after a refresh
const EDITS_KEY = 'blpPendingEdits';
const _pset = pendingEdits.set.bind(pendingEdits);
const _pdel = pendingEdits.delete.bind(pendingEdits);
function persistEdits() {
  lsSet(EDITS_KEY, JSON.stringify({t: Date.now(), edits: [...pendingEdits.entries()]}));
}
pendingEdits.set = (k, v) => { const r = _pset(k, v); persistEdits(); return r; };
pendingEdits.delete = k => { const r = _pdel(k); persistEdits(); return r; };
(() => {
  try {
    const saved = JSON.parse(lsGet(EDITS_KEY) || 'null');
    if (saved && Date.now() - saved.t < 360000) saved.edits.forEach(([k, v]) => _pset(k, v));
  } catch (e) { /* corrupted cache — start clean */ }
})();
function applyPending() {
  if (!pendingEdits.size) return;
  const byRow = new Map(S.data.pianos.map(p => [p.row, p]));
  for (const [row, edit] of pendingEdits) {
    const p = byRow.get(row);
    if (!p) continue;
    // once the server agrees, stop overriding
    let stillPending = false;
    if ('phase' in edit) {
      if ((p.phase || '') === edit.phase) delete edit.phase;
      else { p.phase = edit.phase; stillPending = true; }
    }
    if ('location' in edit) {
      if ((p.location || '') === edit.location) delete edit.location;
      else { p.location = edit.location; p.isSlot = SLOT_RE.test(edit.location); stillPending = true; }
    }
    for (const f of ['bphoto', 'bvideo', 'aphoto', 'avideo']) {
      if (!(f in edit)) continue;
      if (p[f]) delete edit[f];               // server caught up
      else { p[f] = edit[f]; stillPending = true; }
    }
    if ('price' in edit) {
      if ((p.price || '') === edit.price) delete edit.price;
      else { p.price = edit.price; stillPending = true; }
    }
    if ('track' in edit) {
      if ((p.track || '') === edit.track) delete edit.track;
      else { p.track = edit.track; stillPending = true; }
    }
    if ('phasesDone' in edit) {
      if ((p.phasesDone || '') === edit.phasesDone) delete edit.phasesDone;
      else { p.phasesDone = edit.phasesDone; stillPending = true; }
    }
    if ('clientReports' in edit) {
      if ((p.clientReports || '') === edit.clientReports) delete edit.clientReports;
      else { p.clientReports = edit.clientReports; stillPending = true; }
    }
    if ('checkBack' in edit) {
      if ((p.checkBack || '') === edit.checkBack) delete edit.checkBack;
      else { p.checkBack = edit.checkBack; stillPending = true; }
    }
    if (!stillPending) pendingEdits.delete(row);
  }
  persistEdits();
}

function index() {
  applyPending();
  applyAdds();
  S.bySlot.clear(); S.slotFloor.clear();
  S.map.floors.forEach((f, fi) =>
    f.slots.forEach(sl => S.slotFloor.set(sl.id.toLowerCase(), fi)));
  for (const p of S.data.pianos) {
    if (!p.active || !p.isSlot) continue;
    const key = p.location.toLowerCase();
    if (!S.bySlot.has(key)) S.bySlot.set(key, []);
    S.bySlot.get(key).push(p);
  }
}

/* ---------- derived ---------- */
function placed(fi) {
  let n = 0;
  for (const [slot, ps] of S.bySlot) if (S.slotFloor.get(slot) === fi) n += ps.length;
  return n;
}
function unplaced() {
  return S.data.pianos.filter(p => {
    if (!p.active) return false;
    if (!p.location) return true;
    if (p.isSlot) return !S.slotFloor.has(p.location.toLowerCase());
    const l = p.location.toLowerCase();
    return !KNOWN_AREAS.some(a => l.includes(a));
  });
}
function duplicates() {
  const out = [];
  for (const [slot, ps] of S.bySlot) if (ps.length > 1) out.push({slot, pianos: ps});
  return out.sort((a, b) => b.pianos.length - a.pianos.length);
}
// active pianos that aren't on any numbered map spot — shown in the
// second-floor holding zone so nothing is invisible
function unplacedPianos() {
  return S.data.pianos.filter(p => p.active
    && !(p.isSlot && S.slotFloor.has((p.location || '').toLowerCase()))
    && !areaBinFor(p)     // area-bin pianos (incl. conference/Larson-home) drawn in their zone
    && !isRented(p)       // rented pianos live in the rented zone
    && !comingSoon(p)     // coming-soon pianos live in the front-door/parking-lot zone
    && !outForService(p)); // out at an external shop live in that same area
}
function rentedPianos() {
  return S.data.pianos.filter(p => p.active && isRented(p));
}
function comingSoonPianos() {
  return S.data.pianos.filter(p => p.active && comingSoon(p));
}
function outForServicePianos() {
  return S.data.pianos.filter(p => p.active && outForService(p));
}
const localDay = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
function todaysMoves() {
  const t = localDay();
  return S.data.events.filter(e => e.date === t);
}
// tuning calendar info for a piano: next scheduled + most recent past
function tuningInfo(p) {
  const t = S.data.tunings;
  if (!t || !p.serial || p.serial.length < 5) return {};
  // match case-insensitively, and fall back to the digit run alone —
  // calendar titles write serials like "g118620" or drop the letter prefix
  const sn = p.serial.toUpperCase();
  const dig = p.serial.replace(/\D/g, '');
  const hit = list => list.filter(r => {
    const t = r[2].toUpperCase();
    return t.includes(sn) || (dig.length >= 5 && t.includes(dig));
  });
  const up = hit(t.upcoming || [])[0];
  const hist = hit(t.past || []);
  // the raw past[] list is capped at 800 events; lastBySerial covers the
  // full 540-day window so old tunings still show a date
  const lb = (t.lastBySerial && dig.length >= 5 && t.lastBySerial[dig]) || null;
  const lastHist = hist.length ? hist[hist.length - 1][0] : null;
  return {next: up ? {date: up[0], time: up[1]} : null,
          last: (lastHist && lb) ? (lastHist > lb ? lastHist : lb) : (lastHist || lb),
          hist};
}
// days since an ISO date (for tuning-age chips and the tuning queue)
function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso + 'T12:00')) / 86400000);
}

// out on rental: accounted for on the map (recital-seating rented zone)
// but physically out of the building
function isRented(p) {
  return /rent/i.test((p.location || '').trim());
}
// under the Piano Log's PRIVATE FINANCING section header — colored lime
// green wherever they render so they stay visually distinct
function isPrivateFinancing(p) {
  return (p.section || '').trim().toUpperCase() === 'PRIVATE FINANCING';
}
function finClass(p) {
  return isPrivateFinancing(p) ? 'financed' : '';
}
function finBadge(p, cx, cy, sc) {
  if (!isPrivateFinancing(p)) return '';
  return `<text x="${cx + 8.5 * sc}" y="${cy - 6 * sc}" text-anchor="middle"
          class="finbadge" font-size="${11 * sc}">$</text>`;
}
// Sold/finished but still physically here — lives under the Piano Log's
// "SOLD OR COMPLETED BUT NOT DELIVERED YET" banner, so it follows the sheet
// no matter which row the section moves to.
function soldPending(p) {
  return /sold or completed but not delivered/i.test(p.section || '');
}
function soldClass(p) { return soldPending(p) ? 'soldpend' : ''; }
// 🆕 temp entries: amber TEMP tag until an admin approves
function tempBadge(p, cx, cy, sc) {
  if (!(p.tempEntry || '').trim()) return '';
  return `<text x="${cx}" y="${cy + 13 * sc}" text-anchor="middle"
          class="tempbadge" font-size="${7.5 * sc}" font-weight="800"
          fill="#9a6a00" stroke="#fdf6e3" stroke-width="${2.5 * sc}" paint-order="stroke">TEMP</text>`;
}
function soldBadge(p, cx, cy, sc) {
  if (!soldPending(p)) return '';
  return `<text x="${cx - 8.5 * sc}" y="${cy - 6 * sc}" text-anchor="middle"
          class="soldbadge" font-size="${11 * sc}">✓</text>`;
}
// Pre-Queue: piano is AT BLP for shopwork but the $1,000 queue deposit
// hasn't been received — verbal commitment only, NO work may start.
// Source of truth: "Pre-Queue" in the Piano Log's status column (S).
function preQueue(p) { return /pre[\s-]?queue/i.test(p.status || ''); }
/* Manager tier — granted ONLY through Google sign-in with these exact BLP
 * gmails; a typed PIN name never elevates anyone.
 *   Mark (lead manager): FULL — everything the admins can do here.
 *   Matthew, Jacob (assistant managers): full EDIT of the Store Map
 *   (moves, phases, media, clocking — no approval powers). */
const MANAGER_ROLES = {
  'markhales.blp@gmail.com': 'full',
  'matthewwessman.blp@gmail.com': 'edit',
  'jacobmower.blp@gmail.com': 'edit',
};
function userRole() {
  const u = authUser();
  const em = (u && u.email ? u.email : '').toLowerCase();
  if (!em) return '';
  if (ADMINS.some(a => a.email.toLowerCase() === em)) return 'admin';
  return MANAGER_ROLES[em] || '';
}
function isAdminUser() {
  const r = userRole();
  return r === 'admin' || r === 'full';
}
function ghostBadge(p, cx, cy, sc) {
  if (!preQueue(p)) return '';
  return `<g class="ghostb" pointer-events="none">
    <circle cx="${cx + 8.5 * sc}" cy="${cy - 6 * sc}" r="${6.6 * sc}" class="gbc"/>
    <text x="${cx + 8.5 * sc}" y="${cy - 3.4 * sc}" text-anchor="middle" font-size="${7.4 * sc}">🔧</text>
    <line x1="${cx + 3.9 * sc}" y1="${cy - 1.4 * sc}" x2="${cx + 13.1 * sc}" y2="${cy - 10.6 * sc}" class="gbl"/>
  </g>`;
}
function comingSoon(p) {
  return (p.location || '').trim().replace(/\s+/g, ' ').toLowerCase().startsWith('coming soon');
}
// out at an external tech's shop for service (David Hyde today; the name
// match is easy to extend if other outside shops come up later)
function outForService(p) {
  return /david hyde/i.test((p.location || '').trim());
}
function pianoStatus(p) {
  const today = localDay();
  if (comingSoon(p)) return 'coming';   // not yet at the store — yellow
  if (isRented(p)) return 'rented';     // out on rental — orange
  if (p.serial && p.serial.length > 4) {
    // note: the calendar's "x " prefix is admin bookkeeping (reminder
    // calls), NOT completion — so any mention today counts as in transit
    const ev = S.data.events.find(e => (e.summary + e.description).includes(p.serial));
    if (ev) return ev.date === today ? 'move' : 'sched';
  }
  if ((p.phase || '') === 'For Sale') return 'sale';
  if (tuningInfo(p).next) return 'tune';
  if (p.isNew) return 'new';
  return 'in';
}
function ownerClass(p) {
  const o = (p.owner || '').toLowerCase();
  if (o.includes('consign')) return 'csgn';
  if (!o || o.includes('blp') || o.includes('reno') || o.includes('brigham')) return 'blp';
  return 'client';
}
function matches(p, q) {
  return (p.summary + ' ' + p.serial + ' ' + p.make + ' ' + p.model + ' '
          + p.year + ' ' + p.location + ' ' + (p.owner || '')).toLowerCase().includes(q);
}
function logLink(p) {
  // ?q= is the Piano Log's deep link: it pre-filters the list and, when the
  // serial pinpoints one piano, opens its drawer directly (survives login)
  return PIANOLOG_URL + '?q=' + encodeURIComponent(p.serial || p.summary);
}
// shop-tag QR target: THIS app, deep-linked to the piano's own card. Always
// the production origin so a tag printed from a dev machine still scans right.
function mapLink(p) {
  return 'https://blpstoremap.netlify.app/#piano=' + encodeURIComponent(p.serial || '');
}
/* ---------- share (↗) — text a piano or report to a teammate ---------- */
let phonesCache = null;
// Tech Phones through the glitchy bridge (9/1): a ping-imposter answer has
// no `phones` array — retry instead of caching an empty team list, and
// never cache a failure (082926larson03: tboard texting "not working").
async function fetchPhones() {
  const wa = writeAuth();
  if (!wa.ok) return null;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'phones', ...authFields()})});
      const j = await r.json();
      if (j && Array.isArray(j.phones) && j.phones.length) { phonesCache = j.phones; return phonesCache; }
    } catch (e) { /* retry */ }
    await new Promise(res => setTimeout(res, 900 * (a + 1)));
  }
  return null;
}
function shareSheet(title, url) {
  const text = title + ' — ' + url;
  const old = document.querySelector('.shov');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.className = 'shov';
  ov.innerHTML = `<div class="shcard">
    <div class="shhead"><b>↗ Share</b><span class="shx" title="close">✕</span></div>
    <div class="shwhat">${esc(title)}</div>
    ${navigator.share ? `<button class="shbtn shnative">📲 Share… (text, email, AirDrop)</button>` : ''}
    <button class="shbtn shcopy">📋 Copy link</button>
    <div class="shteam"><b>💬 Text it to a teammate</b><div class="shlist"><i>loading the team list…</i></div></div>
  </div>`;
  document.body.appendChild(ov);
  ov.onclick = ev => {
    if (ev.target === ov || ev.target.closest('.shx')) ov.remove();
  };
  const nb = ov.querySelector('.shnative');
  if (nb) nb.onclick = async () => {
    try { await navigator.share({title, text, url}); ov.remove(); } catch (e) { /* user cancelled */ }
  };
  ov.querySelector('.shcopy').onclick = async ev => {
    try { await navigator.clipboard.writeText(url); ev.target.textContent = '✓ Link copied'; }
    catch (e) { prompt('Copy the link:', url); }
  };
  const list = ov.querySelector('.shlist');
  const sel = new Set();
  const renderPh = () => {
    if (!phonesCache.length) {
      list.innerHTML = '<i>no team phone numbers on file yet (Tech Phones tab)</i>';
      return;
    }
    const all = sel.size === phonesCache.length;
    const picked = [...sel].map(i => phonesCache[i]);
    const emails = picked.map(t => t.email).filter(Boolean);
    list.innerHTML = `<button class="shper shall ${all ? 'on' : ''}">${all ? '✓ ' : ''}Everyone</button>`
      + phonesCache.map((t, i) =>
          `<button class="shper ${sel.has(i) ? 'on' : ''}" data-i="${i}">${sel.has(i) ? '✓ ' : ''}${esc(t.name)}</button>`).join('')
      + `<div class="shacts">${sel.size
          ? `<a class="shbtn shgo" href="sms:${picked.map(t => esc(t.phone)).join(',')}?&body=${encodeURIComponent(text)}">💬 Text ${sel.size === 1 ? picked[0].name.split(' ')[0] : sel.size + ' people'}</a>`
            + (emails.length
              ? `<a class="shbtn shgo" href="mailto:${emails.map(esc).join(',')}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}">✉️ Email ${emails.length === 1 ? picked.find(t => t.email).name.split(' ')[0] : emails.length + ' people'}</a>`
              : '')
          : '<i>tap names to pick who gets it — then text or email them all at once</i>'}</div>`;
    list.querySelectorAll('.shper').forEach(b => b.onclick = () => {
      if (b.classList.contains('shall')) {
        if (all) sel.clear();
        else phonesCache.forEach((t, i) => sel.add(i));
      } else {
        const i = +b.dataset.i;
        if (sel.has(i)) sel.delete(i); else sel.add(i);
      }
      renderPh();
    });
  };
  if (phonesCache) { renderPh(); return; }
  const wa = writeAuth();
  if (!wa.ok) {
    list.innerHTML = `<i>${wa.renewing ? 'sign-in renewing — reopen in a moment'
      : 'sign in first to text teammates directly'} — Share / Copy above still work</i>`;
    return;
  }
  fetchPhones().then(ph => {
    if (ph) renderPh();
    else list.innerHTML = '<i>couldn’t load the team list — use Share / Copy above</i>';
  });
}
function sharePiano(p) {
  const name = [p.year, p.make, p.model].filter(Boolean).join(' ') || p.summary || 'Piano';
  shareSheet(`${name} · serial ${p.serial || '—'}${p.location ? ' · spot ' + p.location : ''}`, mapLink(p));
}

/* Deep link from a scanned shop tag: #piano=SERIAL finds the piano, jumps
 * the map to its spot and opens its data card pinned. Re-fires on hashchange
 * so scanning a second tag while the app is open also works. */
let deepLinkDone = '';
function tryDeepLink() {
  const m = /[#?&]piano=([^&]+)/.exec(location.hash || '');
  let ser = m ? decodeURIComponent(m[1]).trim().toLowerCase() : '';
  // the Google sign-in redirect strips the hash — remember a scanned piano
  // for 10 minutes so the card still opens after the round trip
  if (ser) lsSet('blpDL', ser + '|' + Date.now());
  else {
    const st = (lsGet('blpDL') || '').split('|');
    if (st[0] && Date.now() - (+st[1] || 0) < 600000) ser = st[0];
  }
  if (!ser || ser === deepLinkDone) return;
  const ps = (S.data && S.data.pianos) || [];
  const p = ps.find(x => (x.serial || '').toLowerCase() === ser && x.active)
    || ps.find(x => (x.serial || '').toLowerCase().includes(ser) && x.active);
  if (!p) return;
  deepLinkDone = ser;
  lsDel('blpDL');
  S.scanArrived = p.serial;   // spotlight the Work Clock on this card
  setTimeout(() => focusPiano(p), 250);
}
/* #report=<id> deep link — a shared report link opens straight to that report */
function tryReportLink() {
  const m = /[#&]report=([a-z]+)/.exec(location.hash || '');
  if (!m || !REPORT_DEFS().some(r => r.id === m[1])) return;
  S.openReport = m[1];
  if (m[1] === 'activity' && !S.activityRows) loadActivity();
  if (m[1] === 'briefs' && !S.briefRows) loadBriefs();
  switchView('report');
  renderReport();
}
/* #card=<id> deep link — task-board notification links open straight to the card */
let cardLinkDone = '';
function tryCardLink() {
  const m = /[#&]card=([A-Za-z0-9]+)/.exec(location.hash || '');
  let cid = m ? m[1] : '';
  // the Google sign-in redirect strips the hash — remember for 10 minutes
  if (cid) lsSet('blpTC', cid + '|' + Date.now());
  else {
    const st = (lsGet('blpTC') || '').split('|');
    if (st[0] && Date.now() - (+st[1] || 0) < 600000) cid = st[0];
  }
  if (!cid || cid === cardLinkDone || !tbMe()) return;
  cardLinkDone = cid;
  lsDel('blpTC');
  showView('tboard');
  (async () => {
    if (TB.rows === null && !TB.loading) tbFetch();
    let t = 0;
    while (TB.rows === null && t++ < 60) await new Promise(r => setTimeout(r, 250));
    const c = (TB.rows || []).find(r => r.id === cid);
    if (!c) return;
    TB.person = c.owner;
    renderTaskBoard();
    openCardModal(c, tbNorm(c.owner) === tbNorm(tbMe()) || tbAdmin());
  })();
}
/* #fixclock deep link — the late-clock nudge text links straight to the
 * time-fix form. Survives the sign-in redirect via the same 10-min stash. */
let fixLinkDone = false;
function tryFixClockLink() {
  const hit = /[#&]fixclock\b/.test(location.hash || '');
  if (hit) lsSet('blpFC', String(Date.now()));
  const st = +(lsGet('blpFC') || 0);
  if (!hit && (!st || Date.now() - st > 600000)) return;
  if (fixLinkDone || !authUser()) return;
  fixLinkDone = true;
  lsDel('blpFC');
  clockFixModal();
}
window.addEventListener('hashchange', () => { deepLinkDone = ''; tryDeepLink(); tryReportLink(); tryCardLink(); tryFixClockLink(); });

/* ---------- rendering ---------- */
function renderAll() {
  renderTabs(); renderKpis(); renderCrew(); renderMoves();
  renderMap(); renderReport(); renderBoard(); renderCal(); renderMedia(); showView(S.view); syncFeed();
}

function renderTabs() {
  // the header floor tabs are gone (Brigham 8/26) — the KPI strip's
  // 1st/2nd-floor chips are the one floor selector now; refresh them
  const el = $('#floorTabs');
  if (el) el.remove();
  try { renderKpis(); } catch (e) { /* first paint: data not loaded yet */ }
}

function renderKpis() {
  const un = unplaced().length, du = duplicates().length;
  const act = S.data.pianos.filter(p => p.active);
  // total counts each physical piano once: unique serials + serial-less rows
  const seen = new Set();
  const total = act.filter(p =>
    !p.serial || (!seen.has(p.serial) && seen.add(p.serial))).length;
  const newWeek = act.filter(p => p.isNew).length;
  const tm = todaysMoves().length;
  const own = {blp: 0, csgn: 0, client: 0};
  act.forEach(p => own[ownerClass(p)]++);
  const mediaCount = act.filter(p => { const m = mediaNeeds(p); return m.photo || m.video; }).length;
  $('#movesBadge').textContent = tm;
  // header floor chips (Brigham 9/3) — the one floor selector
  const f0 = $('#fchip0'), f1 = $('#fchip1');
  if (f0) {
    f0.classList.toggle('on', S.floor === 0);
    f1.classList.toggle('on', S.floor === 1);
    f0.title = placed(0) + ' pianos on the 1st floor';
    f1.title = placed(1) + ' pianos on the 2nd floor';
    f0.onclick = () => gotoFloor(0);
    f1.onclick = () => gotoFloor(1);
  }
  // the stats strip moved from the second header row to the top of
  // Reports (Brigham 9/3) — same numbers, same tap-through drill-ins
  S.kpiHTML = `<div class="kpistrip">
    <div class="kpi click ${S.floor === 0 ? 'on' : ''}" id="kpiF1"><span class="n">${placed(0)}</span><span class="l">1ST FLOOR</span></div>
    <div class="kpi click ${S.floor === 1 ? 'on' : ''}" id="kpiF2"><span class="n">${placed(1)}</span><span class="l">2ND FLOOR</span></div>
    <div class="kpi"><span class="n">${total}</span><span class="l">TOTAL PIANOS</span></div>
    <div class="kpi"><span class="n">${own.blp}<small> / ${own.csgn} / ${own.client}</small></span><span class="l">BLP / CONSIGN / CLIENT</span></div>
    <div class="kpi"><span class="n">${tm}</span><span class="l">MOVES TODAY</span></div>
    <div class="kpi click" id="kpiNew"><span class="n">${newWeek}</span><span class="l">NEW THIS WEEK →</span></div>
    <div class="kpi click" id="kpiMedia"><span class="n">${mediaCount} 📷</span><span class="l">MEDIA NEEDED →</span></div>
    <div class="kpi red" id="kpiReport"><span class="n">${un} <small>+ ${du} dup</small></span><span class="l">UNPLACED / ERRORS →</span></div></div>`;
  const rk = document.getElementById('rptKpis');
  if (rk) { rk.innerHTML = S.kpiHTML; wireKpis(rk); }
}
function wireKpis(scope) {
  const q = id => scope.querySelector('#' + id);
  if (q('kpiReport')) q('kpiReport').onclick = () => switchView('report');
  if (q('kpiMedia')) q('kpiMedia').onclick = () => switchView('media');
  if (q('kpiF1')) q('kpiF1').onclick = () => gotoFloor(0);
  if (q('kpiF2')) q('kpiF2').onclick = () => gotoFloor(1);
  if (q('kpiNew')) q('kpiNew').onclick = () => {
    const news = S.data.pianos.filter(p => p.active && p.isNew);
    if (!news.length) return;
    focusPiano(news[S.newIdx = ((S.newIdx || 0) + 1) % news.length]);
  };
}

function gotoFloor(fi) {
  S.floor = fi;
  if (S.view !== 'map') switchView('map');
  renderTabs(); renderMap();
  $('#mapscroll').scrollTop = 0;
}

// zoom the map onto a piano, highlight it, and open its card
function focusPiano(p) {
  if (S.view !== 'map') switchView('map');
  S.focusRow = p.row;
  const placed = p.isSlot && S.slotFloor.has(p.location.toLowerCase());
  const inBin = areaBinFor(p);   // parked in a named work-area zone
  const tmpm = /^temp spot @([12])f/i.exec((p.location || '').trim());
  const fi = tmpm ? +tmpm[1] - 1
    : placed ? S.slotFloor.get(p.location.toLowerCase())
    : inBin ? floorForBin(inBin)
    : (comingSoon(p) || outForService(p)) ? 0   // front-door/parking-lot zones live on floor 0
    : 1;                   // attic/rented live on floor 1
  if (fi !== S.floor) { S.floor = fi; renderTabs(); }
  renderMap();
  const f = S.map.floors[S.floor];
  const sl = placed ? f.slots.find(x => x.id.toLowerCase() === p.location.toLowerCase()) : null;
  const target = sl ? {x: sl.x + sl.w / 2, y: sl.y + sl.h / 2}
    : (S.tempXY || {})[p.row] || (S.binXY || {})[p.row] || (S.rentXY || {})[p.row] || (S.comingXY || {})[p.row] || (S.serviceXY || {})[p.row] || (S.holdingXY || {})[p.row];
  if (target) {
    S.zoom = Math.max(S.zoom, 2.4); sizePlan();
    const sc = $('#mapscroll');
    const k = sc.querySelector('svg').clientWidth / (S.drawW || f.width);
    sc.scrollLeft = target.x * k - sc.clientWidth / 2;
    sc.scrollTop = target.y * k - sc.clientHeight / 2;
  }
  const el = document.querySelector(`.piano[data-row="${p.row}"], .holdcell[data-row="${p.row}"]`);
  openPop(p.row, el, true);
}

function focusSpot(id) {
  if (S.view !== 'map') switchView('map');
  const fi = S.slotFloor.get(id.toLowerCase());
  if (fi === undefined) return;
  if (fi !== S.floor) { S.floor = fi; renderTabs(); renderMap(); }
  const f = S.map.floors[S.floor];
  const sl = f.slots.find(x => x.id.toLowerCase() === id.toLowerCase());
  if (!sl) return;
  S.zoom = Math.max(S.zoom, 2.4); sizePlan();
  const sc = $('#mapscroll');
  const k = sc.querySelector('svg').clientWidth / (S.drawW || f.width);
  sc.scrollLeft = (sl.x + sl.w / 2) * k - sc.clientWidth / 2;
  sc.scrollTop = (sl.y + sl.h / 2) * k - sc.clientHeight / 2;
  openSlotPop(sl.id);
}

function renderCrew() {
  $('#crew').textContent = (S.data.crew || []).join(' · ') || 'none listed';
  const tm = todaysMoves().length;
  $('#crewMoves').textContent = `${tm} Move${tm === 1 ? '' : 's'} Today`;
  const at = S.data.fetchedAt ? S.data.fetchedAt.replace('T', ' ').slice(5, 16) : '?';
  $('#synced').textContent = (S.data.stale ? '⚠ offline snapshot · ' : '') + at;
}

const CAL_EMBED = 'https://calendar.google.com/calendar/embed?src=pianomoving.blp%40gmail.com'
  + '&ctz=America%2FDenver&mode=WEEK&showTitle=0&showPrint=0&showTz=0&showCalendars=0&wkst=2&bgcolor=%23FFFFFF';
function renderCal() {
  const evs = todaysMoves();
  $('#calToday').innerHTML = evs.length
    ? evs.map(e => {
        const p = moveEventPiano(e);
        return `<div class="tmv">
        <span>TODAY · ${e.time || 'ALL DAY'}</span>
        <b>${esc(e.summary)}</b>
        ${p ? `<i class="tmvpiano">🎹 ${esc(((p.year ? p.year + ' ' : '') + [p.make, p.model].filter(Boolean).join(' ')).slice(0, 34))} · SER ${esc(p.serial)} · 📍 ${esc(String(p.location || 'no spot'))}</i>` : ''}</div>`;
      }).join('')
    : '<div class="tmv none">No moves on today’s calendar.</div>';
  const fr = $('#calFrame');
  if (!fr.src) fr.src = CAL_EMBED;
}

/* 🚚 mover clock-out verification (Brigham 8/27): before a mover's day
 * clock-out, walk today's calendar moves and confirm the map is honest —
 * pianos added, spots set, delivered phases flipped, plate data updated. */
async function moverChecklistNeeded() {
  const evs = todaysMoves();
  if (!evs.length) return false;
  const u = authUser();
  const first = u && u.name ? u.name.split(/\s+/)[0].toLowerCase() : '';
  if (!first) return false;
  const crew = (S.data.crew || []).map(c => String(c).toLowerCase());
  if (crew.some(c => c.includes(first))) return true;
  // no crew list? fall back to their name appearing on today's events
  return evs.some(e => ((e.summary || '') + (e.description || '')).toLowerCase().includes(first));
}
function moverChecklist() {
  return new Promise(resolve => {
    document.querySelectorAll('.mvchk').forEach(el => el.remove());
    const evs = todaysMoves();
    const ov = document.createElement('div');
    ov.className = 'tagview mvchk';
    ov.innerHTML = `<div class="tvbox mvchkbox">
      <div class="tvhead"><div><b>🚚 Before you clock out…</b>
        <span>today's moves — is the map honest about each one?</span></div>
        <span class="x mvchkx">✕</span></div>
      <div class="mvchklist">${evs.map((e, i) => {
        const p = moveEventPiano(e);
        const nm = p ? ((p.year ? p.year + ' ' : '')
          + ([p.make, p.model].filter(Boolean).join(' ') || p.summary || '')).slice(0, 34) : '';
        return `<label class="mvchkrow">
          <input type="checkbox" class="mvchkbox2" data-i="${i}">
          <span><b>${esc(String(e.summary || '').slice(0, 80))}</b><small>${esc(e.time || 'all day')}</small>
            ${p ? `<i>🎹 ${esc(nm)} · SER ${esc(p.serial)} · 📍 ${esc(String(p.location || 'no spot'))}</i>`
                : `<i class="mvchkwarn">⚠ no piano matched — if it came to the shop, add it (➕ below)</i>`}
          </span></label>`;
      }).join('')}</div>
      <div class="mvchkhint">Check each move once you've verified:
        map spot updated · new pianos added (➕ Request menu) · delivered
        pianos set to <b>Delivered</b> · plates delivered or returned have
        their <b>Plate</b> dropdown updated.</div>
      <button class="ccfmyes mvchkgo" disabled>✓ All verified — clock out</button>
      <div class="ccfmbtns" style="margin-top:8px">
        <button class="ccfmno mvchkfix">Let me fix things first</button>
      </div></div>`;
    document.body.appendChild(ov);
    const go = ov.querySelector('.mvchkgo');
    const sync = () => {
      go.disabled = [...ov.querySelectorAll('.mvchkbox2')].some(c => !c.checked);
    };
    ov.querySelectorAll('.mvchkbox2').forEach(c => c.onchange = sync);
    sync();
    const done = v => { ov.remove(); resolve(v); };
    go.onclick = () => done(true);
    ov.querySelector('.mvchkx').onclick = () => done(false);
    ov.querySelector('.mvchkfix').onclick = () => done(false);
  });
}
// the piano a calendar move belongs to — same serial-in-title convention
// the map's scheduled/in-transit colors use
function moveEventPiano(e) {
  const blob = (e.summary || '') + (e.description || '');
  return S.data.pianos.find(p => p.active && p.serial && p.serial.length > 4
    && blob.includes(p.serial)) || null;
}
function renderMoves() {
  const evs = todaysMoves();
  $('#moves').innerHTML = evs.length ? evs.map(e => {
    const p = moveEventPiano(e);
    const nm = p ? ((p.year ? p.year + ' ' : '')
      + ([p.make, p.model].filter(Boolean).join(' ') || p.summary || '')).slice(0, 36) : '';
    return `
    <div class="mv ${p ? 'mvlink' : ''}" ${p ? `data-row="${p.row}"` : ''} ${p ? 'title="tap to see it on the map"' : ''}>
      <b>${esc(e.summary)}</b>
      <span>${e.time || 'all day'}</span>
      ${p ? `<div class="mvpiano">🎹 ${esc(nm)} · SER <b>${esc(p.serial)}</b>
        · 📍 ${esc(String(p.location || 'no spot'))} <i class="mvgo2">show on map ›</i></div>` : ''}
    </div>`;
  }).join('') : '<div class="empty">No moves on today’s calendar.</div>';
  $('#moves').querySelectorAll('.mvlink').forEach(el => el.onclick = () => {
    const p = S.data.pianos.find(x => x.row === +el.dataset.row);
    if (!p) return;
    S.feedOpen = false; syncFeed();
    if (S.view !== 'map') switchView('map');
    focusPiano(p);
    openPop(p.row, S.popAnchor, true);
  });
}

// phase number/letter drawn dead-center on the icon (always upright,
// even when the piano glyph itself is rotated against a wall)
function phaseText(p, cx, cy, sc) {
  // a piano sitting in the shop queue (has a row position in CUSTOM
  // SHOPWORK) but with no phase assigned yet still reads as "in the
  // queue" — same Q-# badge as an explicit "In Queue" phase, not blank
  const lab = phaseLabels(effectivePhase(p), p) || (p.queuePos ? phaseLabels('In Queue', p) : null);
  if (!lab) return '';
  // fit the full "6R"/"10QC" label to the icon width; shrink font as needed,
  // and if it would get too tiny fall back to the number/letter only
  let text = lab.full;
  let fs = Math.min(11 * sc, (26 * sc) / Math.max(text.length, 1.6));
  if (fs < 6.5) { text = lab.short; fs = Math.min(11 * sc, (26 * sc) / Math.max(text.length, 1.6)); }
  return `<text x="${cx}" y="${cy + fs * 0.36}" text-anchor="middle" class="phnum"
          font-size="${fs}">${text}</text>`;
}

// ---- media (before/after photos + videos) --------------------------------
// after-media only becomes relevant once a piano reaches QC & Assembly
// (phase 11), i.e. it looks finished
const AFTER_MIN = PHASES.indexOf('QC & Assembly') + 1;   // 11 — piano looks final from here
function phaseNum(p) { const i = PHASES.indexOf(effectivePhase(p)); return i >= 0 ? i + 1 : 0; }
function effectivePhase(p) {
  if (p.phase) return p.phase;
  return (p.isNew && !comingSoon(p)) ? 'New Arrival - Admin' : '';   // not-yet-arrived stays unphased
}
// four media lines for the data card (✓ have it / mark-done button / — n/a).
// "mark done" writes a dated ✓ into the Piano Log and clears the red icon.
function mediaCard(p) {
  const late = isLate(p);
  const line = (label, field, have, active) => {
    const mark = have === 'na' ? '<b class="mna">— not required</b>'
      : !active ? '<b class="mna">— after QC &amp; Assembly</b>'
      : have === 'skip' ? '<b class="mskip">— skipped</b>'
      : have ? '<b class="myes">✓ have</b>'
      : (p.serial ? `<span class="mopts"><i class="mno">✗</i>
           <button class="mmark" data-f="${field}">✓ done</button>
           <button class="mmark mskipbtn" data-f="${field}" data-skip="1">skip</button></span>`
                  : '<b class="mno">✗ needed</b>');
    return `<div class="row rowflex"><span>${label}</span>${mark}</div>`;
  };
  // Drive folders: the media cells hold links once someone pastes one in, and
  // progress photos land in a "Tech" subfolder of the piano's main folder
  const links = [
    ['\ud83d\udcf7 Before photos', p.bphotoUrl],
    ['\ud83c\udfa5 Before video', p.bvideoUrl],
    ['\ud83d\udcf7 After photos', p.aphotoUrl],
    ['\ud83c\udfa5 After video', p.avideoUrl],
    ['\ud83d\udcc1 Main folder', p.mainFolder],
  ].filter(x => x[1]);
  const folderRow = (links.length || p.serial)
    ? `<div class="drivelinks">${links.map(([t, u]) =>
        `<a class="dlink" href="${esc(u)}" target="_blank" rel="noopener">${t} \u2197</a>`).join('')}
        ${p.serial ? `<a class="dlink dtech" href="#" data-serial="${esc(p.serial)}">\ud83d\udd27 Tech photos \u2197</a>` : ''}
      </div>`
    : '';
  return `<div class="mediabox">
    ${line('Before photos', 'bphoto', p.bphoto, true)}
    ${line('Before video', 'bvideo', p.bvideo, true)}
    ${line('After photos', 'aphoto', p.aphoto, late)}
    ${line('After video', 'avideo', p.avideo, late)}
    ${folderRow}
    ${p.serial ? `<div class="tagbtns mediaadd">
      <button class="tagbtn maddbtn" data-kind="before">📷 Add before photos</button>
      <button class="tagbtn maddbtn" data-kind="after">📷 Add after photos</button>
      <input type="file" class="maddin" accept="image/*" multiple hidden>
    </div>
    <div class="tagbtns mediaadd">
      <button class="tagbtn wizbtn" data-kind="before">🧭 Before shot list (13)</button>
      <button class="tagbtn wizbtn" data-kind="after">🧭 After shot list (13)</button>
    </div>` : ''}
    <div class="mdmsg"></div>
  </div>`;
}

/* ---------- 13-shot before/after camera wizard ----------
 * Steps through Brigham's photo guide one shot at a time. Every photo is
 * SQUARE and each AFTER must match its BEFORE angle, so in After mode the
 * matching Before photo is shown as a ghost inside the framing box.
 * Shots upload through the normal bridge `photo` action; the shot number
 * rides in the `stage` label ("Before S04 · Music desk plate pins"), which
 * lands in both the Drive filename and the PHOTO LOG — that's how the
 * wizard knows on any device which shots are already done. */
// img = the matching sample photo from Brigham's guide doc (assets/photoguide/)
const SHOT_LISTS = {
  upright: [
    {t: 'Main image — straight front', h: 'Slightly angled front, cabinetry on, keys showing. Angle up enough to hide the top lid. Bench only if new / included in sale.', i: '🎹', c: 'MAIN', img: 'u01'},
    {t: 'Entire piano — side angle 1', h: 'Whole piano from one side angle.', i: '◀️', c: 'FULL PIANO', img: 'u02'},
    {t: 'Entire piano — side angle 2', h: 'Whole piano from the other side angle.', i: '▶️', c: 'FULL PIANO', img: 'u03'},
    {t: 'Music desk / panel detail', h: 'Close-up of the music desk or front panel detail.', i: '🎼', c: 'EXTERIOR CLOSE-UP', img: 'u04'},
    {t: 'Corner arm, cheek block, keyslip, keys', h: 'Front corner detail with keys showing.', i: '📐', c: 'EXTERIOR CLOSE-UP', img: 'u05'},
    {t: 'Decal, keys, hardware, pedals', h: 'Fallboard decal down to the pedals.', i: '✨', c: 'EXTERIOR CLOSE-UP', img: 'u06'},
    {t: 'Pedals & hardware', h: 'Angled or straight on is fine — just match the before & after.', i: '🥇', c: 'EXTERIOR CLOSE-UP', img: 'u07'},
    {t: 'Toe block, caster, kneeboard & pedals', h: 'Low shot: toe block, caster, leg detail, kneeboard and pedals.', i: '🦶', c: 'EXTERIOR CLOSE-UP', img: 'u08'},
    {t: 'Pedals & trapwork from inside', h: 'Bottom board open: pedals, trapwork, felts.', i: '🔧', c: 'INTERIOR', img: 'u09'},
    {t: 'Lower interior — bridges, plate, soundboard', h: 'Low inside shot: plate, bridges, soundboard refinishing.', i: '🪵', c: 'INTERIOR', img: 'u10'},
    {t: 'Hammer line', h: 'Straight shot down the hammer line.', i: '🔨', c: 'INTERIOR', img: 'u11'},
    {t: 'Cabinetry, plate corner & entire action', h: 'Action brackets and the whole action; straight corner shot for a spinet/console.', i: '⚙️', c: 'INTERIOR', img: 'u12'},
    {t: 'Top view — pins, strings, hammers', h: 'Shoot straight down featuring pins, strings and hammers.', i: '⬇️', c: 'INTERIOR', img: 'u13'},
  ],
  grand: [
    {t: 'Main image — straight', h: 'Plate reflection on the lid is the dream; otherwise angled front on the open-lid side showing the plate. Bench only if new / included.', i: '🎹', c: 'MAIN', img: 'g01'},
    {t: 'Entire piano — side angle 1', h: 'Whole piano from one side angle, lid open.', i: '◀️', c: 'FULL PIANO', img: 'g02'},
    {t: 'Entire piano — side angle 2', h: 'Whole piano from the other side angle, showing the plate.', i: '▶️', c: 'FULL PIANO', img: 'g03'},
    {t: 'Music desk, plate & pins', h: 'Music desk with plate and tuning pins in frame.', i: '🎼', c: 'EXTERIOR CLOSE-UP', img: 'g04'},
    {t: 'Corner arm, cheek block, keyslip, keys', h: 'Front corner detail with keys showing.', i: '📐', c: 'EXTERIOR CLOSE-UP', img: 'g05'},
    {t: 'Keyslip, keys, felt, hardware, decal', h: 'Along the keyslip: keys, felt, hardware and decal.', i: '✨', c: 'EXTERIOR CLOSE-UP', img: 'g06'},
    {t: 'Lyre & pedals', h: 'The lyre and pedals.', i: '🦶', c: 'EXTERIOR CLOSE-UP', img: 'g07'},
    {t: 'Leg & caster', h: 'One leg and caster detail.', i: '🦵', c: 'EXTERIOR CLOSE-UP', img: 'g08'},
    {t: 'Wood corner, plate, pins, dampers, strings', h: 'Interior corner: refinished wood, plate, pins, felts, dampers, strings.', i: '🪵', c: 'INTERIOR', img: 'g09'},
    {t: 'Plate, pins & refinished wood detail', h: 'Include the wood refinishing, plate, pins, felts, dampers, strings, bridge.', i: '📌', c: 'INTERIOR', img: 'g10'},
    {t: 'Straight top view of entire inside', h: 'Shoot straight down into the whole inside.', i: '⬇️', c: 'INTERIOR', img: 'g11'},
    {t: 'Bass strings, felts & plate circles', h: 'Bass strings with the felts and plate circles.', i: '🎻', c: 'INTERIOR', img: 'g12'},
    {t: 'Entire plate, angled from the front', h: 'The whole plate at an angle from the front.', i: '🏆', c: 'INTERIOR', img: 'g13'},
  ],
};
const shotSampleUrl = s => 'assets/photoguide/' + s.img + '.jpg';
function shotStage(kind, idx, shot) {
  const k = kind === 'before' ? 'Before' : 'After';
  return `${k} S${String(idx + 1).padStart(2, '0')} ${shot.t.replace(/[^\w &-]+/g, ' ').replace(/\s+/g, ' ').trim()}`.slice(0, 80);
}
// parse "Before S04 …" (or a filename slug "Before-S04-…") back to [kind, idx]
function parseShotStage(s) {
  const m = /^(Before|After)[ \-_]?S(\d{2})/i.exec(String(s || '').trim());
  return m ? {kind: m[1].toLowerCase(), idx: parseInt(m[2], 10) - 1} : null;
}
async function fetchShots(serial) {
  try {
    const r = await fetch(BRIDGE_URL + '?fn=shots&serial=' + encodeURIComponent(serial),
      {redirect: 'follow'});
    const j = await r.json();
    return j.rows || [];
  } catch (e) { return []; }
}
/* 📸 keytop photo gate (Brigham 8/28): marking keytops Done needs a progress
 * photo first, and the first keys/keytops clock-in on a piano needs a BEFORE
 * photo of the keytops. Photos file to the Tech folder + PHOTO LOG. */
function keytopPhotoGate(p, o) {
  const old = document.querySelector('.dsheetov'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.className = 'dsheetov';
  ov.innerHTML = `<div class="dsheet"><button class="dsx">✕</button>
    <h3>${o.title}</h3>
    <div class="dssub">${o.sub}</div>
    <div class="rfbar">
      <label class="csvbtn" style="cursor:pointer">📷 Take the keytop photo
        <input type="file" accept="image/*" hidden class="pg-file"></label>
      <span class="pg-shot phmsg">photo required</span></div>
    <div class="rfbar">
      <button class="csvbtn pg-go" disabled>${o.goLabel}</button>
      ${o.cancelLabel ? `<button class="csvbtn pg-cancel" style="background:none;border:1px solid #cfc9bf;color:inherit">${o.cancelLabel}</button>` : ''}
      <span class="pg-msg phmsg"></span></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); if (o.onCancel) o.onCancel(); };
  ov.querySelector('.dsx').onclick = close;
  const pc = ov.querySelector('.pg-cancel');
  if (pc) pc.onclick = close;
  const shotMsg = ov.querySelector('.pg-shot'), go = ov.querySelector('.pg-go');
  ov.querySelector('.pg-file').onchange = async ev => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const wa = writeAuth();
    if (!wa.ok) { shotMsg.className = 'pg-shot phmsg err'; shotMsg.textContent = 'Sign in first.'; return; }
    shotMsg.className = 'pg-shot phmsg'; shotMsg.textContent = 'Uploading…';
    try {
      const dataUrl = await downscalePhoto(f, 2048, 0.85);
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'photo', kind: 'progress', serial: p.serial,
          row: p.row, stage: o.stage, mime: 'image/jpeg',
          data: dataUrl.split(',')[1], ...authFields()})});
      const j = await r.json();
      if (!j.saved) throw new Error(j.error || 'upload failed');
      shotMsg.className = 'pg-shot phmsg ok'; shotMsg.textContent = '✓ photo filed';
      go.disabled = false;
    } catch (e) { shotMsg.className = 'pg-shot phmsg err'; shotMsg.textContent = '✗ ' + e.message; }
  };
  go.onclick = () => { ov.remove(); if (o.onGo) o.onGo(); };
}
// first keys clock-in on this piano → require the keytop BEFORE photo
async function keytopBeforeGate(p) {
  const rows = await fetchShots(p.serial);
  if (rows.some(r2 => /keytop/i.test(r2.stage || ''))) return;   // already shot
  keytopPhotoGate(p, {
    title: '📸 Keytop BEFORE photo',
    sub: `First key-service clock-in on <b>${pianoLabel(p)}</b> — take a BEFORE photo of
      the keytops now, before any work starts. It files to the piano's Tech folder
      and backs the before/after story.`,
    stage: 'Keytops before',
    goLabel: 'Done — photo filed ✓',
  });
}
function openShotWizard(p, kind) {
  document.querySelectorAll('.shotwiz').forEach(el => el.remove());
  const list = SHOT_LISTS[p.type === 'grand' ? 'grand' : 'upright'];
  const listName = p.type === 'grand' ? 'GRAND' : 'UPRIGHT';
  const W = {kind, idx: 0, done: {}, beforeIds: {}, beforeFolder: [], busy: false, stream: null, noCam: false};
  const ov = document.createElement('div');
  ov.className = 'tagview shotwiz';
  document.body.appendChild(ov);
  const doneCount = () => Object.keys(W.done).length;
  const stopCam = () => {
    if (W.stream) { W.stream.getTracks().forEach(t => t.stop()); W.stream = null; }
  };
  const close = () => { stopCam(); ov.remove(); };

  // live viewfinder inside the dotted square, with the reference photo
  // (sample from the guide, or the matching BEFORE) kept visible on top
  const ensureCam = async () => {
    if (W.stream || W.noCam) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { W.noCam = true; return; }
    try {
      W.stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: 'environment', width: {ideal: 2048}, height: {ideal: 2048}},
        audio: false});
    } catch (e) { W.noCam = true; }
  };
  const attachCam = () => {
    const v = ov.querySelector('.swvideo');
    if (v && W.stream) { v.srcObject = W.stream; v.play().catch(() => {}); }
  };

  const render = () => {
    const s = list[W.idx];
    const isDone = !!W.done[W.idx];
    const beforeId = W.beforeIds[W.idx];
    const sample = shotSampleUrl(s);
    // the reference to match: AFTER shots match their BEFORE when we have
    // one; everything else matches the guide's sample photo
    const refUrl = (kind === 'after' && beforeId)
      ? `https://drive.google.com/thumbnail?id=${beforeId}&sz=w480` : sample;
    const refLabel = (kind === 'after' && beforeId) ? 'the BEFORE you’re matching' : 'sample from the photo guide';
    const live = !W.noCam;
    ov.innerHTML = `<div class="tvbox swbox">
      <div class="tvhead"><div><b>🧭 ${kind === 'before' ? 'BEFORE' : 'AFTER'} shots — ${esc(p.serial)}</b>
        <span>${esc((p.make || '') + ' ' + (p.model || ''))} · ${listName} list · square photos</span></div>
        <span class="x swx">✕</span></div>
      <div class="swstep">SHOT ${W.idx + 1} OF ${list.length} · ${s.c}</div>
      <div class="swtitle">${s.i} ${esc(s.t)}</div>
      <div class="swframe ${isDone ? 'swdone' : ''}">
        ${live ? `<video class="swvideo" autoplay playsinline muted></video>
                  <img class="swghost" alt="" src="${refUrl}">`
               : `<img class="swsampleimg" alt="" src="${refUrl}">`}
        ${isDone ? '<span class="swdonelbl">✓ already taken — shooting again adds another photo</span>' : ''}
      </div>
      <div class="swrefrow">
        <img class="swref" alt="" src="${refUrl}">
        <span>← ${refLabel}${live ? '<br>ghosted over your live camera — line it up' : ''}<br>${esc(s.h)}</span>
      </div>
      ${kind === 'after' && !beforeId ? (W.beforeFolder.length
        ? `<div class="swmatch">No tagged BEFORE for this shot — tap the matching photo from the piano's Before folder to ghost it:</div>
           <div class="swpickrow">${W.beforeFolder.map(f =>
             `<img class="swpick" data-id="${esc(f.id)}" loading="lazy" alt="" title="${esc(f.name)}"
                   src="https://drive.google.com/thumbnail?id=${esc(f.id)}&sz=w160">`).join('')}</div>`
        : '<div class="swmatch swnone">No tagged BEFORE for this shot yet — match the sample and the Before folder.</div>') : ''}
      <div class="swmsg"></div>
      <button class="swsnap">${live ? '⚪ CAPTURE' : '📷 TAKE THIS SHOT'}</button>
      <div class="swalt">
        ${live ? '<button class="swcambtn">📷 use the phone camera app</button> · ' : ''}
        <button class="swlib">🖼 photo library</button>
      </div>
      <input type="file" class="swcam" accept="image/*" hidden>
      <input type="file" class="swfile" accept="image/*" hidden>
      <div class="swnav">
        <button class="swprev" ${W.idx === 0 ? 'disabled' : ''}>‹ back</button>
        <span class="swcount">${doneCount()}/${list.length} done</span>
        <button class="swnext">${W.idx === list.length - 1 ? 'finish' : 'skip ›'}</button>
      </div>
      <div class="swdots">${list.map((x, i) =>
        `<i data-i="${i}" class="${W.done[i] ? 'ok' : ''} ${i === W.idx ? 'on' : ''}" title="${esc(x.t)}"></i>`).join('')}</div>
    </div>`;
    wire();
    attachCam();
  };

  const advance = () => {
    for (let i = W.idx + 1; i < list.length; i++) if (!W.done[i]) { W.idx = i; render(); return; }
    for (let i = 0; i < list.length; i++) if (!W.done[i]) { W.idx = i; render(); return; }
    finishScreen();
  };
  const finishScreen = () => {
    stopCam();
    ov.innerHTML = `<div class="tvbox swbox">
      <div class="tvhead"><div><b>🧭 ${kind === 'before' ? 'BEFORE' : 'AFTER'} shots — ${esc(p.serial)}</b></div>
        <span class="x swx">✕</span></div>
      <div class="swfin">${doneCount() >= list.length ? '🎉' : '👍'}</div>
      <div class="swtitle" style="text-align:center">${doneCount()}/${list.length} shots in the ${kind} folder</div>
      <div class="swhint" style="text-align:center">${doneCount() >= list.length
        ? 'Full set! The photos are filed in the piano’s Drive folder.'
        : 'The missing shots stay on the list — reopen the wizard any time to finish.'}</div>
      <button class="swsnap swclose2">Done</button>
    </div>`;
    ov.querySelector('.swx').onclick = close;
    ov.querySelector('.swclose2').onclick = close;
  };

  // square center-crop capture straight from the live viewfinder
  const captureFrame = () => {
    const v = ov.querySelector('.swvideo');
    if (!v || !v.videoWidth) return null;
    const side = Math.min(v.videoWidth, v.videoHeight);
    const c = document.createElement('canvas');
    const out = Math.min(2048, side);
    c.width = out; c.height = out;
    c.getContext('2d').drawImage(v,
      (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side,
      0, 0, out, out);
    return c.toDataURL('image/jpeg', 0.85);
  };

  const upload = async dataUrl => {
    if (!dataUrl || W.busy) return;
    const wa = writeAuth();
    const msg = ov.querySelector('.swmsg');
    if (!wa.ok) { msg.className = 'swmsg err'; msg.textContent = wa.renewing ? 'Sign-in expired — renewing, retry in a moment.' : 'Sign in first.'; return; }
    W.busy = true;
    msg.className = 'swmsg'; msg.textContent = 'Uploading…';
    const snapBtn = ov.querySelector('.swsnap');
    if (snapBtn) snapBtn.disabled = true;
    try {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'photo', kind, serial: p.serial, row: p.row,
          stage: shotStage(kind, W.idx, list[W.idx]), share: 1, mime: 'image/jpeg',
          data: dataUrl.split(',')[1], ...authFields()})});
      const j = await r.json();
      if (!j.saved) throw new Error(j.error || 'upload failed');
      W.done[W.idx] = true;
      if (kind === 'before' && j.id) W.beforeIds[W.idx] = j.id;
      if (kind === 'before') p.bphoto = p.bphoto || true; else p.aphoto = p.aphoto || true;
      W.busy = false;
      advance();
    } catch (e) {
      W.busy = false;
      msg.className = 'swmsg err'; msg.textContent = '✗ ' + e.message;
      if (snapBtn) snapBtn.disabled = false;
    }
  };
  const uploadFile = async f => {
    if (!f) return;
    try { upload(await downscalePhoto(f, 2048, 0.85)); }
    catch (e) {
      const msg = ov.querySelector('.swmsg');
      if (msg) { msg.className = 'swmsg err'; msg.textContent = '✗ ' + e.message; }
    }
  };

  function wire() {
    const cam = ov.querySelector('.swcam'), lib = ov.querySelector('.swfile');
    ov.querySelector('.swx').onclick = close;
    ov.querySelectorAll('.swpick').forEach(im => im.onclick = () => {
      W.beforeIds[W.idx] = im.dataset.id;   // this shot now ghosts that photo
      render(); attachCam();
    });
    ov.querySelector('.swsnap').onclick = () => {
      if (!W.noCam) {
        const shot = captureFrame();
        if (shot) { upload(shot); return; }
      }
      cam.click();   // no live camera — the OS camera app instead
    };
    const cb = ov.querySelector('.swcambtn');
    if (cb) cb.onclick = () => cam.click();
    ov.querySelector('.swlib').onclick = () => lib.click();
    cam.onchange = () => { uploadFile(cam.files[0]); cam.value = ''; };
    lib.onchange = () => { uploadFile(lib.files[0]); lib.value = ''; };
    ov.querySelector('.swprev').onclick = () => { if (W.idx > 0) { W.idx--; render(); } };
    ov.querySelector('.swnext').onclick = () =>
      W.idx === list.length - 1 ? finishScreen() : (W.idx++, render());
    ov.querySelectorAll('.swdots i').forEach(d =>
      d.addEventListener('click', ev => { W.idx = +ev.target.closest('i').dataset.i; render(); }));
  }

  ov.innerHTML = `<div class="tvbox swbox"><div class="swhint" style="padding:30px;text-align:center">
    Loading the shot list…</div></div>`;
  Promise.all([fetchShots(p.serial), ensureCam()]).then(([rows]) => {
    // photos the shop photographer put straight into the piano's Before
    // folder (no wizard tags) — offered as tap-to-match references
    W.beforeFolder = rows.filter(r => r.folder === 'before' && r.id)
      .map(r => ({id: r.id, name: r.file || ''}));
    rows.forEach(row => {
      const ps = parseShotStage(row.stage || row.file);
      if (!ps) return;
      if (ps.kind === kind && ps.idx >= 0 && ps.idx < list.length) W.done[ps.idx] = true;
      if (ps.kind === 'before' && row.id) W.beforeIds[ps.idx] = row.id;
    });
    for (let i = 0; i < list.length; i++) if (!W.done[i]) { W.idx = i; break; }
    render();
  });
}
const techFolderCache = new Map();
// The Tech subfolder has no link in the sheet — the bridge knows where it is
// (it is where progress photos get uploaded), so resolve it on demand.
async function openTechFolder(serial, a) {
  if (techFolderCache.has(serial)) {
    const u = techFolderCache.get(serial);
    if (u) window.open(u, '_blank', 'noopener');
    return;
  }
  const was = a.textContent;
  a.textContent = 'opening\u2026';
  try {
    const r = await fetch(BRIDGE_URL + '?fn=techfolder&serial=' + encodeURIComponent(serial),
      {redirect: 'follow'});
    const j = await r.json();
    techFolderCache.set(serial, j.url || '');
    a.textContent = was;
    if (j.url) window.open(j.url, '_blank', 'noopener');
    else a.textContent = '\ud83d\udd27 no Tech folder yet';
  } catch (e) {
    a.textContent = '\ud83d\udd27 Tech folder unavailable';
  }
}
/* Paperwork — the physical sheets that travel with a piano, attached as
 * Drive links: QC checklist scans (auto-findable — they live in one shared
 * folder filed by year, named "Make Serial") plus manual slots for bass
 * string orders, tear down sheets and plating orders. Stored per piano in
 * the PAPERWORK column as JSON via the bridge. */
const PW_KINDS = [
  ['qc', '📋 QC Checklist'],
  ['bass', '🎼 Bass String Order'],
  ['teardown', '🔩 Tear Down Sheet'],
  ['plating', '✨ Plating Order'],
  ['other', '🗂 Other'],
];
function pwOf(p) {
  try { return JSON.parse(p.paperwork || '{}') || {}; } catch (e) { return {}; }
}
function paperworkCard(p) {
  if (!p.serial) return '';
  const pw = pwOf(p);
  const rows = PW_KINDS.map(([k, label]) => {
    const it = pw[k];
    if (!it && k === 'other') return '';   // Other only shows once attached
    return `<div class="row rowflex"><span>${label}</span>
      ${it ? `<span class="pwhave"><a class="dlink" href="${esc(it.url)}" target="_blank"
                rel="noopener" title="${esc(it.name || '')}">open ↗</a>
              <button class="pwdel" data-k="${k}" title="remove link">✕</button></span>`
           : `<span class="pwhave"><label class="pwshoot" title="photograph the sheet">📷 scan
                <input type="file" accept="image/*" capture="environment" hidden class="pwshootfile" data-k="${k}" data-label="${esc(label.replace(/^\S+\s/, ''))}"></label>
              <button class="pwadd" data-k="${k}">＋ link</button></span>`}
    </div>`;
  }).join('');
  return `<div class="pwbox">${rows}
    <div class="row rowflex"><span class="pwscanlbl">Scans folder</span>
      <button class="pwscan" data-serial="${esc(p.serial)}">🔎 find this piano's scans</button></div>
    <div class="pwfound"></div><div class="pwmsg phmsg"></div>
  </div>`;
}
const pwScanCache = new Map();
async function scanPaperwork(p, pop) {
  const btn = pop.querySelector('.pwscan');
  const out = pop.querySelector('.pwfound');
  let files = pwScanCache.get(p.serial);
  if (files == null) {
    btn.textContent = 'searching…';
    try {
      const r = await fetch(BRIDGE_URL + '?fn=paperwork&serial=' + encodeURIComponent(p.serial),
        {redirect: 'follow'});
      files = (await r.json()).files || [];
      pwScanCache.set(p.serial, files);
    } catch (e) { files = null; }
    btn.textContent = '🔎 find this piano’s scans';
  }
  if (files == null) { out.innerHTML = '<i class="pwnone">Drive unavailable — try again</i>'; return; }
  out.innerHTML = files.length
    ? files.map((f, i) => `<div class="pwfrow"><a class="dlink" href="${esc(f.url)}" target="_blank"
        rel="noopener">${esc(f.name)} ↗</a>
        <button class="pwuse" data-i="${i}" title="attach as QC Checklist">→ QC</button></div>`).join('')
    : `<i class="pwnone">No scans matching serial ${esc(p.serial)} in the QC folder yet.</i>`;
  out.querySelectorAll('.pwuse').forEach(b => {
    b.onclick = ev => {
      ev.stopPropagation();
      const f = files[+b.dataset.i];
      setPaperwork(p, 'qc', f.url, f.name, pop);
    };
  });
}
async function setPaperwork(p, kind, url, name, pop) {
  const msg = pop.querySelector('.pwmsg');
  popPinned = true;
  const wa = writeAuth();
  if (!wa.ok) { if (msg) { msg.className = 'pwmsg phmsg err'; msg.textContent = wa.renewing ? 'Sign-in expired — renewing, retry in a moment.' : 'Sign in with Google (menu) first.'; } return; }
  const pin = wa.pin;
  if (msg) { msg.className = 'pwmsg phmsg'; msg.textContent = 'Saving…'; }
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'setpaperwork',
        kind, url: url || '', name: name || '', row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized'); }
    if (!j.ok) throw new Error(j.error || 'save failed');
    p.paperwork = JSON.stringify(j.paperwork || {});
    if (!$('#pop').hidden) openPop(p.row, S.popAnchor, true);
    const m2 = $('#pop').querySelector('.pwmsg');
    if (m2) { m2.className = 'pwmsg phmsg ok'; m2.textContent = '✓ saved'; }
  } catch (e) {
    const m2 = $('#pop').querySelector('.pwmsg');
    if (m2) { m2.className = 'pwmsg phmsg err'; m2.textContent = '✗ ' + e.message; }
  }
}
function isLate(p) { return phaseNum(p) >= AFTER_MIN; }
// on the books but physically not in the building yet — no media possible
function notYetArrived(p) {
  return /coming soon|not here|on order|ordered|never came|in moving truck/i.test(p.location || '');
}
// parked in a *STORAGE Piano Log section — not being worked on, so no
// media is expected until it moves elsewhere (e.g. into the shop queue)
function inStorage(p) {
  return /storage/i.test((p.section || '').trim());
}
function mediaNeeds(p) {
  const NONE = {needBP: false, needBV: false, needAP: false, needAV: false, photo: false, video: false};
  // not-yet-arrived pianos aren't photographed until they're here (NEW / 1N)
  if (comingSoon(p) || inStorage(p)) return NONE;
  const late = isLate(p);
  // 'na' ("x" in the sheet cell) means not applicable to this piano — never needed
  const needBP = p.bphoto !== 'na' && !p.bphoto, needBV = p.bvideo !== 'na' && !p.bvideo;
  const needAP = late && p.aphoto !== 'na' && !p.aphoto, needAV = late && p.avideo !== 'na' && !p.avideo;
  return {needBP, needBV, needAP, needAV,
          photo: needBP || needAP, video: needBV || needAV};
}
// price shown under green For Sale pianos: "$49,998.00" -> "$49,998"
function priceLabel(p) {
  if (effectivePhase(p) !== 'For Sale' || !p.price) return '';
  return String(p.price).replace(/\.\d{2}\s*$/, '').trim();
}
function priceText(p, cx, cy, sc) {
  const t = priceLabel(p);
  if (!t) return '';
  const fs = Math.max(6, Math.min(8.5 * sc, (30 * sc) / Math.max(t.length * 0.55, 2)));
  return `<text x="${cx}" y="${cy + 13.5 * sc}" text-anchor="middle" class="pricetag"
          font-size="${fs}">${esc(t)}</text>`;
}

// small-print serial under every occupied spot (Brigham request
// 083126larson09) — saves clicking into spots while hunting a piano
function serialText(p, cx, cy, sc) {
  const t = String(p.serial || '').trim();
  if (!t) return '';
  const below = priceLabel(p) ? 19.5 : 14;
  const fs = Math.max(4.6, Math.min(6.2 * sc, (30 * sc) / Math.max(t.length * 0.58, 3)));
  return `<text x="${cx}" y="${cy + below * sc}" text-anchor="middle" class="serialsm"
          font-size="${fs}">${esc(t)}</text>`;
}

/* ---------- printable tags ---------- */
// hand the piano to the BLP Price Tag Maker, prefilled via its URL params
function priceTagUrl(p) {
  const model = [(p.year || ''), p.make, p.model].filter(Boolean).join(' ')
    + (p.size ? ' / ' + p.size : '');
  const digits = String(p.price || '').replace(/\.\d{2}\s*$/, '').replace(/[^0-9]/g, '');
  const q = new URLSearchParams();
  if (model.trim()) q.set('model', model.trim());
  if (digits) q.set('price', digits);
  if (p.serial) q.set('serial', p.serial);
  return PRICETAGS_URL + '?' + q.toString();
}
/* ---- owner privacy helpers: pull "First Last" and "City, ST" out of the
   owner blob (which is full of phones/emails/addresses that should never
   show on the card or the shop tag) ---- */
function ownerNameOf(p) {
  const blob = p.owner || '';
  const badLine = /sold|consign|paid|add |qrs|pick.?up|deliver|steps|@|http|\d{3}[-.)\s]\d{3}|\*\*?/i;
  for (const ln of blob.split('\n').map(s => s.trim()).filter(Boolean)) {
    if (badLine.test(ln)) continue;
    if (/^[A-Za-z][A-Za-z .,'&-]+$/.test(ln) && ln.split(/\s+/).length >= 2 && ln.length < 40) {
      return ln.replace(/,+$/, '');
    }
  }
  // second pass: name hiding behind a role prefix ("Consignment Mike Smith",
  // "SOLD TO: STEPHEN JONES (deliver fall 2026)")
  for (const ln of blob.split('\n').map(s => s.trim()).filter(Boolean)) {
    const t = ln.replace(/^(consignment|sold to:?|owner:?)\s*/i, '')
      .replace(/\s*\(.*$/, '').trim();
    if (t !== ln.trim() && /^[A-Za-z][A-Za-z .,'&-]+$/.test(t)
        && t.split(/\s+/).length >= 2 && t.length < 40) return t;
  }
  return (blob.split('\n')[0] || '').trim().slice(0, 34);
}
function ownerCityStateOf(p) {
  const blob = p.owner || '';
  // prefer a match vouched by a zip code
  const csZip = blob.match(/([A-Za-z][A-Za-z .'-]{2,}),?\s*([A-Z]{2})[,.]?\s+\d{5}/);
  const csAny = blob.match(/([A-Za-z][A-Za-z .'-]{2,}),\s*([A-Z]{2})\b/);
  let city = (csZip || csAny) ? (csZip || csAny)[1].trim() : '';
  if (!city) return '';
  // comma-less addresses leak the street in ("Glen Canyon Dr Laguna Hills") —
  // drop everything through a street-suffix word when a real city remains
  const deStreet = city.replace(
    /^.*\b(?:dr|drive|rd|road|ave|avenue|ln|lane|blvd|ct|court|way|cir|circle|pl|place|run|pike|hwy|street|st)\.?\s+/i, '');
  if (deStreet !== city && deStreet.split(/\s+/).length >= 2) city = deStreet;
  return `${city}, ${(csZip || csAny)[2]}`;
}
// client email, for prepared payment-milestone drafts (never shown on the card)
function ownerEmailOf(p) {
  return ((p.owner || '').match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [''])[0];
}

// Shop tag — "The Rail": half-letter (8.5×5.5), prints 2-up on one letter
// sheet (cut at the midline — one tag per side of the piano). Every field
// auto-fills from the Piano Log and is click-to-edit before printing.
/* ---- printed-tag snapshot: what is physically taped to the piano ---- */
function tagSnapOf(p) {
  try {
    const o = JSON.parse(p.tagSnapshot || 'null');
    return (o && o.d) ? o : null;
  } catch (e) { return null; }
}
async function saveTagSnapshot(p, d) {
  if (!p.serial) return;
  const u = authUser();
  const snap = {d: d, at: new Date().toISOString(), by: (u && u.name) || 'unknown'};
  const {pin, ok} = writeAuth();
  if (!ok) return;                       // printing still works, just unrecorded
  p.tagSnapshot = JSON.stringify(snap);   // optimistic so the thumb appears now
  try {
    await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'tagsnapshot',
        snapshot: p.tagSnapshot, row: p.row, ...authFields()}),
    });
  } catch (e) { /* best effort — never block the print */ }
  if (!$('#pop').hidden) openPop(p.row, S.popAnchor, true);
}
// which fields have changed on the piano since that tag was printed
function tagSnapDrift(p, snap) {
  const now = shopTagFields(p), was = snap.d, out = [];
  const LBL = {track: 'Track', plan: 'Plan', refin: 'Refinishing', lvl: 'Refinishing level',
               tech: 'Technology', keys: 'Keys', plating: 'Plating', bench: 'Bench',
               notes: 'Notes', owner: 'Owner', serial: 'Serial'};
  for (const k in LBL) { if (String(now[k] || '') !== String(was[k] || '')) out.push(LBL[k]); }
  return out;
}
function openTagSnapshot(p) {
  const snap = tagSnapOf(p);
  if (!snap) return;
  popPinned = true;
  const when = new Date(snap.at);
  const drift = tagSnapDrift(p, snap);
  const ov = document.createElement('div');
  ov.className = 'tagview';
  ov.innerHTML = `<div class="tvbox">
    <div class="tvhead">
      <div><b>Printed tag on this piano</b>
        <span>printed ${esc(when.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}))}
        at ${esc(when.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'}))}
        by ${esc(snap.by || 'unknown')}</span></div>
      <button class="tvx">\u2715</button>
    </div>
    ${drift.length
      ? `<div class="tvdrift">\u26a0 Changed since this was printed: <b>${esc(drift.join(', '))}</b>
           \u2014 reprint to bring the piano's tag up to date.</div>`
      : `<div class="tvok">\u2713 Still matches the piano's current data.</div>`}
    <div class="tagrender tvtag">${shopTagInner(snap.d)}</div>
  </div>`;
  ov.onclick = ev => {
    if (ev.target === ov || ev.target.closest('.tvx')) ov.remove();
  };
  document.body.appendChild(ov);
}

// Everything the tag shows, as a plain object — so the same values can be
// printed, snapshotted to the sheet, and re-rendered later as the thumbnail
// of "what is actually taped to this piano right now".
/* Same content rules as the batch-PDF set (gen_tags.py): pricing never
 * prints on a shop tag, and note lines about keys/bench/plating/tech/
 * refinishing land on their own scope row instead of the Notes blob. */
const TAG_PRICE_RE = /\$\s?\d|\b\d+\s?k\b|price|payment|paid|deposit|invoice|qbo|\bbill\b|\/mo\b|payout|credit card|financ|\b\d{1,3}%/i;
const TAG_ROUTES = [
  ['keys', /\bkey(s|top|work)?\b|ivor(y|ies)|ebony key|plastic key/i],
  ['bench', /\bbench\b|upholst/i],
  ['plating', /replat|plating|chrome|nickel/i],
  ['tech', /\bqrs\b|player system|pianodisc|self.?play/i],
  ['refin', /refinish|lacquer|satin\b|high gloss/i],
];
function tagWcut(t, n) { return t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, '') + '\u2026'; }
function tagSplitNotes(raw) {
  const segs = (raw || '').split(/\s*\n+\s*|\s+\u00b7\s+/)
    .map(x => x.trim().replace(/\.+$/, '')).filter(Boolean)
    .filter(x => !TAG_PRICE_RE.test(x));
  const routed = {}, rest = [];
  for (const x of segs) {
    const hit = TAG_ROUTES.find(r => r[1].test(x));
    if (hit) (routed[hit[0]] = routed[hit[0]] || []).push(tagWcut(x, 120));
    else rest.push(x);
  }
  return {routed, rest: rest.join(' \u00b7 ')};
}
function shopTagFields(p) {
  const blob = p.owner || '';
  const plan = (p.plan || '').trim();
  const notes = (p.planNotes || '').trim().replace(/\s*\n+\s*/g, '  \u00b7  ');
  const sn = tagSplitNotes(notes);
  const xtra = k => sn.routed[k] ? ' \u2014 ' + tagWcut(sn.routed[k].join(' \u00b7 '), 140) : '';
  const kt = keyTokens(p);
  const mark = k => kt.length ? (kt.includes(k) ? 'Yes' : 'No') : '\u2014';
  return {
    serial: p.serial || '\u2014',
    h1: p.make || (p.summary || 'Piano').slice(0, 26),
    sub: [p.model ? 'Model ' + p.model : '', p.year, p.size].filter(Boolean).join(' \u00b7 '),
    owner: (ownerNameOf(p) || '\u2014') + ' \u2014 ' + (ownerCityStateOf(p) || '\u2014'),
    arrived: p.entered
      ? new Date(p.entered + 'T00:00:00').toLocaleDateString('en-US',
          {month: 'long', day: 'numeric', year: 'numeric'})
      : '\u2014',
    track: trackParts(p.track).list.join(' \u00b7 ') || '\u2014',
    plan: plan.slice(0, 90) || '\u2014',
    refin: ((/refinish/i.test(p.track || '') || /refinish/i.test(plan)) ? 'Yes' : 'No') + xtra('refin'),
    lvl: (/level\s*([1-3])/i.exec(plan) || [])[1] || '',
    tech: (/tech/i.test(p.track || '') ? 'Yes' : 'No')
      + ((/qrs/i.test(blob + ' ' + plan + ' ' + notes)
          ? (/(upgrade|update)/i.test(blob + ' ' + plan) ? ' \u2014 QRS upgrade' : ' \u2014 QRS') : '')) + xtra('tech'),
    keys: (() => {
      if (kt.length) return KEY_SERVICE.map(k => k + ' ' + mark(k)).join(' \u00b7 ');
      const kw = (p.keywork || '').trim();
      if (kw && !/^(done|\u2713|x+|completed?)[.!\s]*$/i.test(kw)) return kw;   // requested work, verbatim
      if (kw) return 'Done \u2713';
      return '\u2610 Ivory \u00b7 \u2610 Plastic \u00b7 \u2610 Ebony';        // unknown: mark by hand
    })() + xtra('keys'),
    plating: (/^y/i.test(p.replate || '') ? 'Yes'
      : /^n/i.test(p.replate || '') ? 'No'
      : /replat|plating/i.test(plan + ' ' + notes) ? 'Yes' : '\u2014') + xtra('plating'),
    bench: (/^y/i.test(p.bench || '') ? 'Yes'
      : /^n/i.test(p.bench || '') ? 'No'
      : (p.bench ? p.bench.slice(0, 26) : '\u2014')) + xtra('bench'),
    notes: tagWcut(sn.rest, 300) || '\u2014',
    qr: mapLink(p),
  };
}
// The tag itself. Identical markup for print, thumbnail and the popup — only
// the surrounding CSS scale differs.
function shopTagInner(d) {
  const logo = location.origin + '/assets/blp-logo.png';
  const qrImg = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data='
    + encodeURIComponent(d.qr || '');
  const lvBox = n => `<i class="${d.lvl === String(n) ? 'on' : ''}">${n}</i>`;
  return `<div class="tag">
    <div class="main">
      <div class="id"><img src="${logo}" alt="Brigham Larson Pianos">
        <div class="nm"><h1>${esc(d.h1)} &nbsp;·&nbsp; #${esc(d.serial)}</h1><div class="sub">${esc(d.sub || '\u2014')}</div></div></div>
      <div class="rows">
        <div class="rw"><span class="lb">Serial #</span><b>${esc(d.serial)}</b></div>
        <div class="rw"><span class="lb">Owner</span><b>${esc(d.owner)}</b></div>
        <div class="rw"><span class="lb">Arrived</span><b>${esc(d.arrived)}</b></div>
        <div class="divider"><em>SCOPE OF WORK</em></div>
        <div class="rw spec"><span class="lb">Track</span><b>${esc(d.track)}</b></div>
        <div class="rw spec"><span class="lb">Plan</span><b>${esc(d.plan)}</b></div>
        <div class="rw spec"><span class="lb">Refinishing</span><b>${esc(d.refin)}
          <span class="lv">${lvBox(1)}${lvBox(2)}${lvBox(3)}</span></b></div>
        <div class="rw spec"><span class="lb">Technology</span><b>${esc(d.tech)}</b></div>
        <div class="rw spec"><span class="lb">Keys</span><b>${esc(d.keys)}</b></div>
        <div class="rw spec"><span class="lb">Plating</span><b>${esc(d.plating)}</b></div>
        <div class="rw spec"><span class="lb">Bench</span><b>${esc(d.bench)}</b></div>
        <div class="rw spec note"><span class="lb">Notes</span><b>${esc(d.notes)}</b></div>
      </div>
    </div>
    <div class="band">
      <img class="q" src="${qrImg}" alt="QR">
      <div class="scan"><b>SCAN FOR UPDATES</b><ul>
        <li>Queue #</li><li>Map Spot</li><li>Cabinetry Shelf</li><li>Phase Checklists</li>
        <li>Concurrent Work</li><li>Progress Photos</li><li>Tech Reports</li>
        <li>Client Reports</li><li>Media</li><li>QC &amp; Tuning</li><li>Notes</li>
        <li>Records &amp; Files</li></ul></div>
    </div>
  </div>`;
}

/* ---------- 🪑 Bench tag — hang tag, 3.5 × 5.5 portrait ----------
 * A bench gets separated from its piano the moment it goes on a shelf, so
 * the tag answers "whose is this, where did it come from, which piano does
 * it match" without opening anything. Optional admin note rides along, and
 * the QR opens the piano's card. Note lives in the piano's BENCH NOTE cell. */
function benchTagFields(p) {
  return {
    serial: p.serial || '—',
    piano: ((p.year ? p.year + ' ' : '') + (p.make || '')
      + (p.model ? ' ' + p.model : '')).trim() || (p.summary || 'Piano').slice(0, 34),
    sub: [p.size, p.colorFinal || p.colorPick].filter(Boolean).join(' · '),
    client: ownerNameOf(p) || '—',
    from: ownerCityStateOf(p) || '—',
    arrived: p.entered
      ? new Date(p.entered + 'T00:00:00').toLocaleDateString('en-US',
          {month: 'long', day: 'numeric', year: 'numeric'})
      : '—',
    note: (p.benchNote || '').trim(),
    qr: mapLink(p),
  };
}
function benchTagInner(d) {
  const logo = location.origin + '/assets/blp-logo.png';
  const qrImg = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data='
    + encodeURIComponent(d.qr || '');
  return `<div class="btag">
    <div class="bt-head">
      <img class="bt-logo" src="${logo}" alt="Brigham Larson Pianos">
      <div class="bt-kind">BENCH TAG</div>
    </div>
    <div class="bt-sn"><small>MATCHES PIANO SERIAL</small>#${esc(d.serial)}</div>
    <div class="bt-piano"><b>${esc(d.piano)}</b>${d.sub ? `<span>${esc(d.sub)}</span>` : ''}</div>
    <div class="bt-mid">
      <div class="bt-rows">
        <div class="bt-kv"><span class="k">Client</span><span class="v">${esc(d.client)}</span></div>
        <div class="bt-kv"><span class="k">From</span><span class="v">${esc(d.from)}</span></div>
        <div class="bt-kv"><span class="k">Arrived</span><span class="v">${esc(d.arrived)}</span></div>
      </div>
      <img class="bt-qr" src="${qrImg}" alt="">
    </div>
    ${d.note ? `<div class="bt-note"><b>NOTE:</b> ${esc(d.note)}</div>` : ''}
  </div>`;
}
const BENCH_TAG_CSS = `
  .btag { width: 3.5in; height: 4.25in; background: #fff; border: 2.5px solid #0d0d0d;
          border-radius: 9px; display: flex; flex-direction: column; overflow: hidden;
          font: 10pt/1.35 Helvetica, Arial, sans-serif; color: #1a1a1a; }
  /* top strip stays clear for tape — just enough, not a whole inch */
  .bt-head { padding: 0.34in 14px 8px; text-align: center; border-bottom: 2.5px solid #0d0d0d; }
  .bt-logo { width: 100%; max-width: 165px; display: block; margin: 0 auto; }
  .bt-kind { font: 800 11px/1 Helvetica; letter-spacing: 4.5px; color: #9e2020; margin-top: 7px; }
  .bt-sn { background: #0d0d0d; color: #fff; text-align: center; padding: 7px 0;
           font: 800 20px/1 Helvetica; letter-spacing: 2px; }
  .bt-sn small { display: block; font: 700 7.5px/1 Helvetica; letter-spacing: 2.5px;
                 opacity: .65; margin-bottom: 3px; }
  .bt-piano { padding: 8px 14px 7px; text-align: center; border-bottom: 1px dashed #c9c3b8; }
  .bt-piano b { display: block; font-size: 15px; line-height: 1.2; }
  .bt-piano span { font-size: 11px; color: #6b645c; }
  .bt-mid { display: flex; align-items: center; gap: 11px; padding: 9px 14px; }
  .bt-rows { flex: 1; display: flex; flex-direction: column; gap: 7px; min-width: 0; }
  .bt-kv { display: flex; gap: 6px; font-size: 11.5px; line-height: 1.35; }
  .bt-kv .k { color: #8a8178; text-transform: uppercase; letter-spacing: .6px; font-size: 8.5px;
              font-weight: 700; min-width: 48px; padding-top: 2px; }
  .bt-kv .v { font-weight: 600; flex: 1; word-break: break-word; }
  .bt-qr { width: 1.02in; height: 1.02in; flex: none; }
  .bt-note { margin: 0 14px 10px; background: #fdf6e3; border: 1px solid #e8d9a8;
             border-radius: 6px; padding: 6px 9px; font-size: 10.5px; line-height: 1.35;
             color: #5c4d1e; }
  /* no note? close the tag up instead of leaving a gap */
  .bt-mid:last-child { padding-bottom: 13px; }`;
function printBenchTag(p) {
  const d = benchTagFields(p);
  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked — allow pop-ups to print bench tags.'); return; }
  w.document.write(`<!doctype html><html><head><title>Bench tag — #${esc(d.serial)}</title><style>
    * { box-sizing: border-box; margin: 0; }
    body { font: 10pt/1.4 Helvetica, Arial, sans-serif; background: #f2efe9; color: #121212;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .bar { display: flex; align-items: center; gap: 14px; padding: 10px 16px; background: #17171b;
           color: #e8e4dd; font-size: 13px; position: sticky; top: 0; }
    .bar button { background: #B43333; color: #fff; border: 0; border-radius: 6px;
                  padding: 8px 18px; font: inherit; font-weight: 700; cursor: pointer; }
    .xclose { margin-left: auto; background: #3a3f45 !important; }

    .bar input { flex: 1; min-width: 120px; padding: 7px 10px; border-radius: 6px; border: 0;
                 font: inherit; }
    .sheet { display: flex; gap: 0.3in; padding: 0.35in; }
    ${BENCH_TAG_CSS}
    @media print { .bar { display: none; } body { background: #fff; }
                   .sheet { padding: 0.25in; } @page { size: letter; margin: 0.25in; } }
  </style></head><body>
    <div class="bar">
      <b>Bench tag</b>
      <input id="bn" placeholder="add a note for this bench (optional)" value="${esc(d.note)}">
      <button onclick="applyNote()">Update note</button>
      <button onclick="print()">🖨 Print</button>
      <button class="xclose" onclick="window.close()" title="close this preview">✕ Close</button>
    </div>
    <div class="sheet" id="sheet">${benchTagInner(d)}${benchTagInner(d)}</div>
    <script>
      const D = ${JSON.stringify(d)};
      function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => (
        {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
      function tag(d){ return ${JSON.stringify(benchTagInner({}).slice(0, 0))} + render(d); }
      function render(d){
        const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data='
          + encodeURIComponent(d.qr || '');
        return '<div class="btag"><div class="bt-head">'
          + '<img class="bt-logo" src="${logoUrlForPrint()}" alt="Brigham Larson Pianos">'
          + '<div class="bt-kind">BENCH TAG</div></div>'
          + '<div class="bt-sn"><small>MATCHES PIANO SERIAL</small>#' + esc(d.serial) + '</div>'
          + '<div class="bt-piano"><b>' + esc(d.piano) + '</b>'
          + (d.sub ? '<span>' + esc(d.sub) + '</span>' : '') + '</div>'
          + '<div class="bt-mid"><div class="bt-rows">'
          + kv('Client', d.client) + kv('From', d.from) + kv('Arrived', d.arrived)
          + '</div><img class="bt-qr" src="' + qr + '" alt=""></div>'
          + (d.note ? '<div class="bt-note"><b>NOTE:</b> ' + esc(d.note) + '</div>' : '')
          + '</div>';
      }
      function kv(k, v){ return '<div class="bt-kv"><span class="k">' + k
        + '</span><span class="v">' + esc(v) + '</span></div>'; }
      function applyNote(){
        D.note = document.getElementById('bn').value.trim();
        document.getElementById('sheet').innerHTML = render(D) + render(D);
        if (window.opener && !window.opener.closed) {
          try { window.opener.postMessage({benchNote: D.note, serial: D.serial, row: ${p.row}}, '*'); } catch(e) {}
        }
      }
    <\/script>
  </body></html>`);
  w.document.close();
}
function logoUrlForPrint() { return location.origin + '/assets/blp-logo.png'; }
// tag prints leave an activity-log breadcrumb (with the note, when there is
// one) — the activity log is the automatic record; notes stay in 📝 Notes
async function logTagPrint(p, kind, note) {
  const wa = writeAuth();
  if (!wa.ok) return;
  try {
    await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin: wa.pin, action: 'tagprinted', kind,
        serial: p.serial, row: p.row, note: note || '', ...authFields()})});
  } catch (e) { /* the tag printed either way */ }
}
// the print window sends the edited note back; persist it so a reprint (and
// everyone else's card) keeps it
addEventListener('message', async ev => {
  const m = ev.data;
  if (!m || typeof m !== 'object' || m.benchNote === undefined || !m.serial) return;
  const p = S.data.pianos.find(x => x.row === m.row)
    || S.data.pianos.find(x => (x.serial || '') === m.serial);
  if (!p) return;
  p.benchNote = m.benchNote;
  const wa = writeAuth();
  if (!wa.ok) return;
  try {
    await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin: wa.pin, action: 'setbenchnote', serial: p.serial, row: p.row,
        value: m.benchNote, ...authFields()})});
    if (!$('#pop').hidden && S.popRow === p.row) openPop(p.row, S.popAnchor, true);
  } catch (e) { /* the tag still prints — the note just isn't saved */ }
});
function printShopTag(p) {
  const d = shopTagFields(p);
  const h1 = d.h1;
  const tag = shopTagInner(d);
  saveTagSnapshot(p, d);   // remember what went on the piano

  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked — allow pop-ups to print shop tags.'); return; }
  w.document.write(`<!doctype html><html><head><title>Shop tag — ${esc(h1)}</title><style>
    * { box-sizing: border-box; margin: 0; }
    body { font: 10pt/1.4 Helvetica, Arial, sans-serif; color: #121212; background: #f2efe9;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .bar { display: flex; align-items: center; gap: 14px; padding: 10px 16px; background: #17171b;
           color: #e8e4dd; font-size: 13px; position: sticky; top: 0; }
    .bar button { background: #B43333; color: #fff; border: 0; border-radius: 6px;
                  padding: 8px 18px; font: inherit; font-weight: 700; cursor: pointer; }
    .xclose { margin-left: auto; background: #3a3f45 !important; }

    .sheet { width: 8.2in; margin: 0 auto; padding: 14px 0; }
    .tag { width: 8.06in; height: 4.72in; background: #fff; display: flex; overflow: hidden;
           box-shadow: 0 4px 14px rgba(0,0,0,.18); page-break-inside: avoid; }
    .cut { display: none; align-items: center; color: #999; font-size: 8pt; gap: 6px; height: .24in; }
    .cut::before, .cut::after { content: ""; flex: 1; border-top: 1px dashed #bbb; }
    .copy2 { display: none; }
    .rail { width: .55in; background: #9E2020; color: #fff; position: relative; flex: none; }
    .rail span { position: absolute; top: .2in; left: 50%; transform: translateX(-50%) rotate(180deg);
                 writing-mode: vertical-rl; font-size: 15pt; font-weight: 800; letter-spacing: 3px;
                 white-space: nowrap; }
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: .13in .18in .11in; }
    .id { display: flex; align-items: center; gap: .18in; margin-bottom: .05in; }
    .id img { width: 1.8in; height: auto; }
    .nm h1 { font-family: Georgia, serif; font-size: 18pt; line-height: 1.05; }
    .nm .sub { font-size: 10pt; color: #555; margin-top: 2px; }
    .rows { flex: 1; display: flex; flex-direction: column; justify-content: space-evenly; }
    .rw { display: flex; align-items: baseline; gap: .12in; border-top: 1px solid #e4e0d8;
          padding: 3pt 0; font-size: 10pt; }
    .rw .lb { color: #999; font-size: 6.5pt; letter-spacing: 1.5px; text-transform: uppercase;
              width: .95in; flex: none; }
    .rw b { line-height: 1.3; min-width: 0; }
    .rw.note b { font-weight: 400; font-style: italic; color: #444; font-size: 8.5pt; }
    .divider { border-top: 2.5pt solid #121212; margin-top: 3pt; padding-top: 2pt;
               display: flex; justify-content: flex-end; }
    .divider em { font-style: normal; font-size: 6.5pt; letter-spacing: 3px; color: #9E2020;
                  font-weight: 800; }
    .rw.spec { border-top-color: #f4f1ec; }
    .lv { display: inline-flex; gap: 3pt; margin-left: 6pt; vertical-align: -2pt; }
    .lv i { font-style: normal; width: 13pt; height: 13pt; border: 1pt solid #121212;
            display: inline-grid; place-items: center; font-size: 8pt; font-weight: 700; cursor: pointer; }
    .lv i.on { background: #9E2020; border-color: #9E2020; color: #fff; }
    .band { width: 2.2in; flex: none; background: #0d0d0d; color: #fff; display: flex;
            flex-direction: column; align-items: center; padding: .16in .13in; }
    .band img.q { width: 1.28in; height: 1.28in; background: #fff; padding: .05in; }
    .scan { align-self: stretch; margin-top: .09in; }
    .scan b { display: block; font-size: 8pt; letter-spacing: 2px; color: #e9b8b8;
              margin-bottom: 3pt; text-align: center; }
    .scan ul { list-style: none; font-size: 7.6pt; line-height: 1.85; color: #ddd; padding: 0; }
    .scan li { border-bottom: 1px solid #232323; }
    .scan li::before { content: "• "; color: #B43333; }
    [contenteditable] { border-radius: 2px; }
    [contenteditable]:hover { background: #fdf3ec; outline: none; }
    [contenteditable]:focus { background: #fdf3ec; outline: 1.5px solid #B43333; }
    .rail [contenteditable]:hover, .rail [contenteditable]:focus
      { background: rgba(255,255,255,.15); outline: none; }
    @page { size: letter; margin: 0.22in; }
    .sheet.s2 { display: none; }
    @media print {
      body { background: #fff; }
      .bar { display: none; }
      .sheet { width: auto; margin: 0; padding: 0; }
      /* blank margin above and below each half — room for the black
         mounting tape once the sheet is cut (Melissa's request) */
      .tag { box-shadow: none; margin: .3in auto; }
      .cut { display: flex; }
      .copy2 { display: flex; }
      /* double-sided (Lisa 8/31): a second identical page so a duplex
         print puts the tag on BOTH faces of each cut half */
      body.duplex .sheet.s2 { display: block; page-break-before: always; }
    }
  </style></head><body class="duplex">
    <div class="bar"><b>Shop tag</b> — click any field to edit, tap 1·2·3 to set the refinishing level
      <label style="display:flex;align-items:center;gap:5px;font-weight:400"><input type="checkbox" id="dup" checked onchange="document.body.classList.toggle('duplex',this.checked);document.querySelector('.bar button').textContent=this.checked?'🖨 Print double-sided':'🖨 Print — 2 per page'"> double-sided <small style="color:#9aa">(pick “two-sided” in the print dialog)</small></label>
      <button onclick="doPrint()">🖨 Print double-sided</button><button class="xclose" onclick="window.close()" title="close this preview">✕ Close</button></div>
    <div class="sheet">${tag}<div class="cut">✂ cut</div>${tag.replace('class="tag"', 'class="tag copy2"')}</div>
    <div class="sheet s2">${tag.replace('class="tag"', 'class="tag copy2"')}<div class="cut">✂ cut</div>${tag.replace('class="tag"', 'class="tag copy2"')}</div>
    <script>
      const t1 = document.querySelectorAll('.tag')[0];
      const sync = () => { document.querySelectorAll('.tag').forEach(t => { if (t !== t1) t.innerHTML = t1.innerHTML; }); };
      // wait for every image (both QR copies + logos) to be fully decoded
      // before printing — otherwise the re-created copy prints as a blank box
      async function doPrint() {
        sync();
        const b = document.querySelector('.bar button');
        if (b) b.textContent = 'Preparing…';
        await Promise.all([...document.images].map(im =>
          im.decode ? im.decode().catch(() => {})
                    : (im.complete ? Promise.resolve()
                                   : new Promise(r => { im.onload = im.onerror = r; }))));
        if (b) b.textContent = document.getElementById('dup').checked ? '🖨 Print double-sided' : '🖨 Print — 2 per page';
        print();
      }
      window.onbeforeprint = sync;
      t1.querySelectorAll('.rw b, .nm h1, .nm .sub, .rail span').forEach(el => {
        el.contentEditable = 'true'; el.spellcheck = false;
      });
      t1.addEventListener('click', e => {
        const i = e.target.closest('.lv i');
        if (!i) return;
        [...i.parentElement.children].forEach(x => x.classList.toggle('on', x === i));
      });
    <\/script>
  </body></html>`);
  w.document.close();
}

// small red photo-camera glyph centred at (x,y), width ~s
function camGlyph(x, y, s) {
  const k = s / 12;
  return `<g class="micon" transform="translate(${x - 6 * k},${y - 4.5 * k}) scale(${k})">
    <rect x="0" y="2.4" width="12" height="7.4" rx="1.5"/>
    <rect x="3.4" y="0.5" width="4" height="2.4" rx="0.6"/>
    <circle cx="6" cy="6.1" r="2.3" class="mlens"/></g>`;
}
// small red video-camera glyph
function vidGlyph(x, y, s) {
  const k = s / 13;
  return `<g class="micon" transform="translate(${x - 6.5 * k},${y - 4 * k}) scale(${k})">
    <rect x="0" y="1.4" width="9" height="7" rx="1.3"/>
    <path d="M9 3.1 L13 1.1 L13 8.9 L9 6.9 Z"/></g>`;
}
// red 📷/🎥 badge above the icon when media is outstanding; a gap between
// the two when both are shown and there's room
function mediaBadge(p, cx, cy, sc) {
  const m = mediaNeeds(p);
  const items = [];
  if (m.photo) items.push('cam');
  if (m.video) items.push('vid');
  if (!items.length) return '';
  const s = 11 * sc, gap = 3.2 * sc;
  const totalW = items.length * s + (items.length - 1) * gap;
  let x = cx - totalW / 2 + s / 2;
  const by = cy - 10 * sc;
  let out = '';
  for (const it of items) {
    out += it === 'cam' ? camGlyph(x, by, s) : vidGlyph(x, by, s);
    x += s + gap;
  }
  return out;
}

function glyph(type, cx, cy, sc) {
  // digitals render as uprights on the map
  if (type === 'upright' || type === 'digital')
    return `<g transform="translate(${cx - 10 * sc},${cy - 9 * sc}) scale(${sc})">
    <rect x="0" y="3" width="20" height="8" rx="1.5" class="pbody"/>
    <rect x="1.5" y="11" width="17" height="3.5" rx="1" class="pk"/></g>`;
  return `<g transform="translate(${cx - 10 * sc},${cy - 10 * sc}) scale(${sc})">
    <path d="M2 1 h9 c6 0 9 3.5 9 8.5 C20 16 15.5 19 9 19 H2 Z" class="pbody"/>
    <rect x="0" y="1" width="3" height="18" rx="1" class="pk"/></g>`;
}

// sheet fill -> theme class: light gray / dark gray stay gray, blue becomes red
function fillClass(hex) {
  if (!hex) return '';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
  if (b > r + 30 && b > g + 10) return 'accent';
  return (r + g + b) / 3 < 200 ? 'dark' : 'light';
}

// size the SVG like a document: card width x true sheet proportions,
// so the user scrolls down through the building exactly like the sheet
function sizePlan() {
  const f = S.map && S.map.floors[S.floor];
  if (!f) return;
  const W = S.drawW || f.width, H = S.drawH || f.height;
  const sc = $('#mapscroll');
  const w = Math.max(320, sc.clientWidth - 2) * S.zoom;
  const svg = $('#plan');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.width = w + 'px';
  svg.style.height = (w * H / W) + 'px';
}
window.addEventListener('resize', sizePlan);

// wrap a zone label into up to 3 lines that fit its box
function wrapWords(text, w, fs) {
  const maxc = Math.max(4, Math.floor((w - 8) / (fs * 0.58 + 1.4)));
  const lines = [];
  let cur = '';
  for (const wd of text.split(/\s+/)) {
    if (!cur) cur = wd;
    else if ((cur + ' ' + wd).length <= maxc) cur += ' ' + wd;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines;
}
// wrap to at most maxLines; ellipsize the last line if it overflows
function wrapCap(text, w, fs, maxLines) {
  const maxc = Math.max(4, Math.floor((w - 8) / (fs * 0.58 + 1.4)));
  let lines = wrapWords(text, w, fs).map(L => L.length > maxc ? L.slice(0, maxc - 1) + '…' : L);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    if (last.length > maxc - 1) last = last.slice(0, maxc - 1);
    lines[maxLines - 1] = last.replace(/…?$/, '…');
  }
  return lines;
}
function zoneLabelSVG(z, cls) {
  const cx = z.x + (z.w || 0) / 2, cy = z.y + (z.h || 0) / 2;
  // tall narrow zones (rebuilding-line tables etc.) read better rotated
  // 90° — swap which dimension wraps/caps the text, then rotate the <text>
  // about the box's own center so it still sits inside the rect.
  const vertical = z.w && z.h && z.h > z.w * 1.35 && z.w < 90;
  const boxW = vertical ? z.h : z.w;
  const boxH = vertical ? z.w : z.h;

  let fs = Math.min(13, Math.max(9, boxH * 0.5));
  const fits = t => t.length * (fs * 0.58 + 1.4) + 8 <= boxW;
  const rot = vertical ? ` transform="rotate(-90 ${cx} ${cy})"` : '';
  if (!boxW || fits(z.text)) {
    return `<text x="${cx}" y="${cy + (boxH ? fs * 0.35 : 0)}" text-anchor="middle"
            class="zlabel ${cls}" font-size="${fs}"${rot}>${esc(z.text)}</text>`;
  }
  let lines = wrapWords(z.text, boxW, fs);
  while ((lines.length > 3 || lines.length * fs * 1.2 > boxH + 6) && fs > 7.5) {
    fs -= 0.75;
    lines = wrapWords(z.text, boxW, fs);
  }
  lines = lines.slice(0, 3);
  const lh = fs * 1.2;
  const y0 = cy - ((lines.length - 1) / 2) * lh + fs * 0.35;
  return `<text x="${cx}" y="${y0}" text-anchor="middle" class="zlabel ${cls}" font-size="${fs}"${rot}>`
    + lines.map((L, i) => `<tspan x="${cx}" dy="${i ? lh : 0}">${esc(L)}</tspan>`).join('')
    + '</text>';
}

function renderMap() {
  const f = S.map.floors[S.floor];
  const q = S.search.trim().toLowerCase();
  let s = '';
  // pianos to draw inside named work-area zones on this floor, keyed by bin
  const binPianos = new Map();
  for (const p of S.data.pianos) {
    if (!p.active) continue;
    const b = areaBinFor(p);
    if (b) { if (!binPianos.has(b)) binPianos.set(b, []); binPianos.get(b).push(p); }
  }
  S.binXY = {};
  for (const z of f.labels) {
    const cls = fillClass(z.fill);
    const norm = z.text.trim().toLowerCase();
    const disp = ZONE_RELABEL[norm] || z.text;
    const bin = binForZone(norm);
    const list = bin ? binPianos.get(bin) : null;
    const isExpandedConf = bin && bin.key === 'conference' && list && list.length;
    if (z.w > 4 && z.h > 4)
      s += `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" class="zonebox ${cls}"/>`;
    if (isExpandedConf) {
      // keep the real room's rectangle exactly as drawn (it's the actual
      // room, not a fabricated zone) — the label lives inside it as usual.
      // Larson Family pianos (sky blue) float ABOVE the room in a single
      // row; the lime-green financed pianos get their own single row
      // BELOW it. Neither group ever sits inside the room's own box.
      s += `<text x="${z.x + z.w / 2}" y="${z.y + z.h / 2 + 4}" text-anchor="middle" class="zlabel ${cls}" font-size="${Math.min(12, Math.max(9, z.h * 0.28))}">${esc(disp)}</text>`;
      const larsonFam = list.filter(p => !isPrivateFinancing(p));
      const financed = list.filter(p => isPrivateFinancing(p));
      // fit both groups inside the room's ACTUAL walls (raycast from the
      // label's center) — never past them, shrinking only if they don't fit
      const room = wallBoundsAround(S.floor, z.x + z.w / 2, z.y + z.h / 2);
      const roomW = room.right - room.left - 20;
      const layGroup = (arr, anchorY, grow, maxH, extra) => {
        if (!arr.length) return anchorY;
        const lay = fitIconsInBox(arr.length, roomW, maxH);
        const cols = lay.cols, sc = lay.sc, rowH = lay.pitch;
        const rows = Math.ceil(arr.length / cols);
        arr.forEach((p, i) => {
          const row = Math.floor(i / cols), col = i % cols;
          const rowCount = Math.min(cols, arr.length - row * cols);
          const rowW = rowCount * rowH;
          const cx = z.x + z.w / 2 - rowW / 2 + col * rowH + rowH / 2;
          const cy = grow === 'up'
            ? anchorY - (rows - row - 0.5) * rowH
            : anchorY + (row + 0.5) * rowH;
          S.binXY[p.row] = {x: cx, y: cy};
          const hl = S.focusRow === p.row || (q && matches(p, q));
          const dim = q && !matches(p, q);
          s += `<g class="piano ${extra(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
                data-row="${p.row}">${glyph(p.type, cx, cy, sc)}${phaseText(p, cx, cy, sc)}${mediaBadge(p, cx, cy, sc)}${finBadge(p, cx, cy, sc)}${soldBadge(p, cx, cy, sc)}${tempBadge(p, cx, cy, sc)}${ghostBadge(p, cx, cy, sc)}</g>`;
        });
        return grow === 'up' ? anchorY - rows * rowH : anchorY + rows * rowH;
      };
      const aboveH = z.y - 10 - room.top, belowH = room.bot - 10 - (z.y + z.h);
      layGroup(larsonFam, z.y - 10, 'up', aboveH, p => `larsonfam ${pianoStatus(p)} own-${ownerClass(p)}`);
      layGroup(financed, z.y + z.h + 10, 'down', belowH, p => `${finClass(p)} ${soldClass(p)} own-${ownerClass(p)}`);
    } else if (bin && bin.below && list && list.length) {
      // room label stays untouched inside its box; the pianos line up in
      // rows just BELOW the box (Brigham: never over the room label)
      s += zoneLabelSVG(disp === z.text ? z : {...z, text: disp}, cls);
      // stop before whatever wall/equipment sits past this open-plan area
      // (e.g. the storage bins under Refinishing Shop) — shrink only if
      // the full stack of rows genuinely can't fit above that wall
      const bTop = z.y + z.h + 16;
      const bWall = wallBelow(S.floor, z.x, z.x + z.w, z.y + z.h);
      const bMaxH = bWall ? Math.max(BIGICON_PITCH * 0.6, bWall - bTop - 10) : Infinity;
      const bFit = fitIconsInBox(list.length, z.w + 40, bMaxH);
      const bCols = bFit.cols, bSc = bFit.sc, bGap = bFit.pitch, bRowH = bGap;
      list.forEach((p, i) => {
        const row = Math.floor(i / bCols), colI = i % bCols;
        const rowCount = Math.min(bCols, list.length - row * bCols);
        const rowW = rowCount * bGap;
        const cx = z.x + z.w / 2 - rowW / 2 + colI * bGap + bGap / 2;
        const cy = bTop + row * bRowH + bRowH / 2;
        S.binXY[p.row] = {x: cx, y: cy};
        const st = pianoStatus(p);
        const hl = S.focusRow === p.row || (q && matches(p, q));
        const dim = q && !matches(p, q);
        s += `<g class="piano ${finClass(p)} ${soldClass(p)} ${st} own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
              data-row="${p.row}">${glyph(p.type, cx, cy, bSc)}${phaseText(p, cx, cy, bSc)}${mediaBadge(p, cx, cy, bSc)}${finBadge(p, cx, cy, bSc)}${tempBadge(p, cx, cy, bSc)}</g>`;
      });
    } else if (list && list.length) {
      // label rides the top; pianos fill the rest of the zone in a row
      const fs = Math.min(12, Math.max(9, z.h * 0.28));
      s += `<text x="${z.x + z.w / 2}" y="${z.y + fs + 3}" text-anchor="middle" class="zlabel ${cls}" font-size="${fs}">${esc(disp)}</text>`;
      const top = z.y + fs + 8, availH = z.y + z.h - top - 4;
      const sc = Math.max(1, Math.min(availH / 22, (z.w - 12) / (list.length * 27)));
      const iy = top + availH / 2, totalW = list.length * 27 * sc;
      let ix = z.x + (z.w - totalW) / 2 + 13.5 * sc;
      list.forEach((p, i) => {
        const cx = ix + i * 27 * sc, cy = iy;
        S.binXY[p.row] = {x: cx, y: cy};
        const st = pianoStatus(p);
        const hl = S.focusRow === p.row || (q && matches(p, q));
        const dim = q && !matches(p, q);
        s += `<g class="piano ${finClass(p)} ${soldClass(p)} ${st} own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
              data-row="${p.row}">${glyph(p.type, cx, cy, sc)}${phaseText(p, cx, cy, sc)}${mediaBadge(p, cx, cy, sc)}${finBadge(p, cx, cy, sc)}${soldBadge(p, cx, cy, sc)}${tempBadge(p, cx, cy, sc)}${ghostBadge(p, cx, cy, sc)}</g>`;
      });
    } else {
      s += zoneLabelSVG(disp === z.text ? z : {...z, text: disp}, cls);
      if (norm === 'cabinetry storage') {
        // the 9 shelf units drawn in walk-in order under the room label:
        // left wall 1·3·5·7·9 (door → back), right wall junk·2·4·6·8
        const counts = {};
        for (const p of S.data.pianos) {
          if (!p.active) continue;
          for (const t of cabTokens(p)) {
            const mm = /^(\d)-/.exec(t);
            if (mm) counts[mm[1]] = (counts[mm[1]] || 0) + 1;
          }
        }
        // the room door is at the EAST (right) end — walking in, the left
        // wall (units 1·3·5·7·9) is the map's south side, the right wall
        // (junk, 2·4·6·8) the north. Each unit is a deep rack drawn as a
        // tall rectangle stretching from its wall to the room label, the
        // door-nearest unit at the east (right) end of each row.
        const roomCx = z.x + z.w / 2;
        const rowW = 1020, bw = 172, bgap = (rowW - 5 * bw) / 4;
        const cx0 = roomCx - rowW / 2;
        const topH = 130, botH = 215;
        const rowsCab = [
          {y: z.y - 14 - topH, h: topH, units: ['8', '6', '4', '2', 'junk']},
          {y: z.y + z.h + 14, h: botH, units: ['9', '7', '5', '3', '1']},
        ];
        for (const c of rowsCab) {
          c.units.forEach((u, i) => {
            const bx = cx0 + i * (bw + bgap);
            const by = c.y, mid = by + c.h / 2;
            if (u === 'junk') {
              s += `<rect x="${bx}" y="${by}" width="${bw}" height="${c.h}" rx="6" class="cabjunkbox"/>
                    <text x="${bx + bw / 2}" y="${mid + 3.5}" text-anchor="middle" class="cabjunktxt" font-size="11">JUNK PARTS</text>`;
            } else {
              const n = counts[u] || 0;
              s += `<rect x="${bx}" y="${by}" width="${bw}" height="${c.h}" rx="6" class="cabunitbox" data-unit="${u}"/>
                    <text x="${bx + bw / 2}" y="${mid + 8}" text-anchor="middle" class="cabunitnum" data-unit="${u}" font-size="24">${u}</text>`;
              // red count bubble pinned in the rack's top-left corner
              if (n) s += `<circle cx="${bx + 17}" cy="${by + 17}" r="12" class="cabcntc" data-unit="${u}"/>
                    <text x="${bx + 17}" y="${by + 21}" text-anchor="middle" class="cabcnt2" data-unit="${u}" font-size="11">${n}</text>`;
            }
          });
        }
      }
    }
  }
  // drop leftover spreadsheet cell-border fragments inside filled fixture
  // boxes: a segment counts as interior clutter when it lies within the box
  // and is strictly inside along its perpendicular axis (edge walls survive)
  const solidZones = f.labels.filter(z => z.w > 4 && z.h > 4 && z.fill);
  const clutter = w => solidZones.some(z => {
    const inX = Math.min(w.x1, w.x2) >= z.x - 1 && Math.max(w.x1, w.x2) <= z.x + z.w + 1;
    const inY = Math.min(w.y1, w.y2) >= z.y - 1 && Math.max(w.y1, w.y2) <= z.y + z.h + 1;
    if (!inX || !inY) return false;
    if (w.y1 === w.y2) return w.y1 > z.y + 2 && w.y1 < z.y + z.h - 2;   // horizontal
    if (w.x1 === w.x2) return w.x1 > z.x + 2 && w.x1 < z.x + z.w - 2;   // vertical
    return false;
  });
  for (const w of f.walls) {
    if (clutter(w)) continue;
    s += `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" class="wall"/>`;
  }
  // plate rack slats (1p-18p): which piano's plate sits on each slat
  const PLATES = new Map();
  for (const px of S.data.pianos) {
    if (!px.active) continue;
    for (const tok of cabTokens(px)) {
      if (/^\d+p$/.test(tok)) {
        if (!PLATES.has(tok)) PLATES.set(tok, []);
        PLATES.get(tok).push(px);
      }
    }
  }
  for (const sl of f.slots) {
    const ps = S.bySlot.get(sl.id.toLowerCase()) || [];
    const hit = q && (sl.id.toLowerCase() === q || ps.some(p => matches(p, q)));
    const dim = q && !hit;
    s += `<rect x="${sl.x}" y="${sl.y}" width="${sl.w}" height="${sl.h}" rx="3"
          class="slot hit ${fillClass(sl.fill)} ${hit ? 'hl' : ''} ${dim ? 'dim' : ''}" data-slot="${esc(sl.id)}"/>`;
    const n = ps.length;
    const portrait = sl.h > sl.w * 1.25;
    const per = 27;                         // icon (20) + gap (7) at scale 1
    if (portrait) {
      // tall slot: number on top, pianos stacked and rotated 90° so
      // uprights sit flat against the wall — and get to be bigger
      const fs = Math.max(11, Math.min(30, sl.w * 0.42, (sl.h * 0.9) / (sl.id.length + 0.5)));
      s += `<text x="${sl.x + sl.w / 2}" y="${sl.y + fs + 2}" text-anchor="middle"
            class="snum" font-size="${fs}">${esc(sl.id)}</text>`;
      if (n) {
        const numH = fs + 8;
        const availH = sl.h - numH - 10;
        // rotated 90°, the glyph's long side (21u) runs vertically, its
        // depth (~17u) horizontally — so width caps the depth, not length
        const sc = Math.max(0.75, Math.min((sl.w - 8) / 17, availH / (n * per), 4.5));
        const y0 = sl.y + numH + (availH - n * per * sc) / 2 + (per * sc) / 2;
        ps.forEach((p, i) => {
          const st = pianoStatus(p);
          const cx = sl.x + sl.w / 2, cy = y0 + i * per * sc;
          const hl = S.focusRow === p.row || (q && matches(p, q));
          s += `<g class="piano ${finClass(p)} ${soldClass(p)} ${st} own-${ownerClass(p)} ${q && !matches(p, q) ? 'dim' : ''} ${hl ? 'hl' : ''}"
                data-slot="${esc(sl.id)}" data-row="${p.row}">
                <g transform="rotate(90 ${cx} ${cy})">${glyph(p.type, cx, cy, sc)}</g>${phaseText(p, cx, cy, sc)}${mediaBadge(p, cx, cy, sc)}${priceText(p, cx, cy, sc)}${finBadge(p, cx, cy, sc)}${soldBadge(p, cx, cy, sc)}${tempBadge(p, cx, cy, sc)}${ghostBadge(p, cx, cy, sc)}${serialText(p, cx, cy, sc)}</g>`;
        });
      } else {
        const pfs = Math.max(10, Math.min(20, sl.w * 0.4));
        s += `<text x="${sl.x + sl.w / 2}" y="${(sl.y + fs + 2 + sl.y + sl.h) / 2 + pfs * 0.36}"
              text-anchor="middle" class="addplus" data-slot="${esc(sl.id)}" font-size="${pfs}">＋</text>`;
      }
    } else {
      // wide slot: number on the left, pianos in a row. Rack rows (short
      // heights, like spots 214-248) get compact numbers, left-aligned
      // icons, and near-full-height glyphs so the shelf reads cleanly.
      const thin = sl.h <= 26;
      const rack = sl.h < 50;
      const fs = thin ? Math.max(9, sl.h * 0.55)
        : Math.max(11, Math.min(34, sl.h * 0.42, (sl.w * 0.9) / (sl.id.length + 0.5)));
      const numW = fs * 0.62 * sl.id.length + 8;
      s += `<text x="${sl.x + 6}" y="${sl.y + sl.h / 2 + fs * 0.36}" class="snum"
            font-size="${fs}">${esc(sl.id)}</text>`;
      const plates = /^\d+p$/.test(sl.id) ? (PLATES.get(sl.id) || []) : [];
      if (plates.length) {
        const pt = '⚙ ' + plates.map(px => px.serial || '?').join(' · ');
        const pfs2 = Math.max(7, Math.min(sl.h * 0.5, ((sl.w - numW - 8) * 1.7) / Math.max(pt.length, 4)));
        s += `<text x="${sl.x + numW + (sl.w - numW) / 2}" y="${sl.y + sl.h / 2 + pfs2 * 0.36}"
              text-anchor="middle" class="phnum" font-size="${pfs2}">${esc(pt)}</text>`;
      }
      if (n) {
        const availW = sl.w - numW - 10;
        const pad = thin ? 3 : 8;
        const sc = Math.max(0.7, Math.min((sl.h - pad) / 21, availW / (n * per), 4.5));
        const x0 = rack
          ? sl.x + numW + (per * sc) / 2 + 2
          : sl.x + numW + (availW - n * per * sc) / 2 + (per * sc) / 2;
        ps.forEach((p, i) => {
          const st = pianoStatus(p);
          const cx = x0 + i * per * sc;
          const cy = sl.y + sl.h / 2;
          const hl = S.focusRow === p.row || (q && matches(p, q));
          s += `<g class="piano ${finClass(p)} ${soldClass(p)} ${st} own-${ownerClass(p)} ${q && !matches(p, q) ? 'dim' : ''} ${hl ? 'hl' : ''}"
                data-slot="${esc(sl.id)}" data-row="${p.row}">${glyph(p.type, cx, cy, sc)}${phaseText(p, cx, cy, sc)}${mediaBadge(p, cx, cy, sc)}${priceText(p, cx, cy, sc)}${finBadge(p, cx, cy, sc)}${soldBadge(p, cx, cy, sc)}${tempBadge(p, cx, cy, sc)}${ghostBadge(p, cx, cy, sc)}${serialText(p, cx, cy, sc)}</g>`;
        });
      } else if (!thin) {
        const pfs = Math.max(9, Math.min(20, sl.h * 0.45));
        s += `<text x="${sl.x + numW + (sl.w - numW) / 2}" y="${sl.y + sl.h / 2 + pfs * 0.36}"
              text-anchor="middle" class="addplus" data-slot="${esc(sl.id)}" font-size="${pfs}">＋</text>`;
      }
    }
  }
  // ---- RENTED zone (2nd floor): pianos out on rental, parked virtually in
  // the recital-hall seating area so they stay accounted for
  S.rentXY = {};
  if (S.floor === 1) {
    const rl = rentedPianos();
    if (rl.length) {
      const RZ = {x: 80, y: 875, x2: 1050};
      const zw = RZ.x2 - RZ.x;
      const headH = 38, nameH = 22;
      const rLay = bigIconLayout(zw - 12);
      const cols = rLay.cols, rsc = rLay.sc, rch = rLay.pitch + nameH;
      const rrows = Math.ceil(rl.length / cols);
      const zh = headH + rrows * rch + 10;
      s += `<rect x="${RZ.x}" y="${RZ.y}" width="${zw}" height="${zh}" rx="8" class="rentzone"/>`;
      s += `<text x="${RZ.x + zw / 2}" y="${RZ.y + 26}" text-anchor="middle" class="renttitle" font-size="19">RENTED — OUT ON RENTAL (${rl.length})</text>`;
      const rcw = zw / cols;
      rl.forEach((p, idx) => {
        const cx0 = RZ.x + (idx % cols) * rcw;
        const cy0 = RZ.y + headH + Math.floor(idx / cols) * rch;
        const cx = cx0 + rcw / 2;
        const hl = S.focusRow === p.row || (q && matches(p, q));
        const dim = q && !matches(p, q);
        const nm = (p.year ? p.year + ' ' : '')
          + ([p.make, p.model].filter(Boolean).join(' ') || p.summary || '');
        const nameLines = wrapCap(nm, rcw - 8, 9.5, 1);
        const iconCy = cy0 + (rch - nameH) / 2;
        S.rentXY[p.row] = {x: cx, y: cy0 + rch / 2};
        s += `<g class="piano ${finClass(p)} ${soldClass(p)} rented own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
              data-row="${p.row}">${glyph(p.type, cx, iconCy, rsc)}${phaseText(p, cx, iconCy, rsc)}${finBadge(p, cx, iconCy, rsc)}</g>`;
        s += `<text x="${cx}" y="${cy0 + rch - 6}" text-anchor="middle" class="rentname" font-size="9.5">`
          + nameLines.map(L => esc(L)).join('') + `</text>`;
      });
    }
  }

  // ---- COMING SOON zone (1st floor): pianos not yet at the store, parked
  // virtually in the blank area outside the building (front door / parking
  // lot) rather than mixed in with pianos that are actually here
  S.comingXY = {};
  let csnBottom = 2000;   // Out For Service (below) chains off wherever this box ends
  if (S.floor === 0) {
    const csl = comingSoonPianos();
    if (csl.length) {
      const CZ = {x: 1480, y: 2000, x2: 2020};
      const czw = CZ.x2 - CZ.x;
      const chH = 34, nameH = 26;
      const cLay = bigIconLayout(czw - 12);
      const ccols = cLay.cols, csc = cLay.sc, cch = cLay.pitch + nameH;
      const crows = Math.ceil(csl.length / ccols);
      const czh = chH + crows * cch + 10;
      s += `<rect x="${CZ.x}" y="${CZ.y}" width="${czw}" height="${czh}" rx="8" class="csnzone"/>`;
      s += `<text x="${CZ.x + czw / 2}" y="${CZ.y + 24}" text-anchor="middle" class="csntitle" font-size="16">FRONT DOOR / PARKING LOT — COMING SOON (${csl.length})</text>`;
      const ccw = czw / ccols;
      csl.forEach((p, idx) => {
        const cx0 = CZ.x + (idx % ccols) * ccw;
        const cy0 = CZ.y + chH + Math.floor(idx / ccols) * cch;
        const cx = cx0 + ccw / 2;
        const st = pianoStatus(p);
        const hl = S.focusRow === p.row || (q && matches(p, q));
        const dim = q && !matches(p, q);
        const nm = (p.year ? p.year + ' ' : '')
          + ([p.make, p.model].filter(Boolean).join(' ') || p.summary || '');
        const nameLines = wrapCap(nm, ccw - 8, 9, 1);
        const iconCy = cy0 + (cch - nameH) / 2;
        S.comingXY[p.row] = {x: cx, y: cy0 + cch / 2};
        s += `<g class="piano ${st} own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
              data-row="${p.row}">${glyph(p.type, cx, iconCy, csc)}${phaseText(p, cx, iconCy, csc)}</g>`;
        s += `<text x="${cx}" y="${cy0 + cch - 6}" text-anchor="middle" class="csnname" font-size="9">`
          + nameLines.map(L => esc(L)).join('') + `</text>`;
      });
      csnBottom = CZ.y + czh;
    }
  }
  // gold cast-iron plate glyph — a harp-shaped outline with string holes,
  // used when a piano's PLATE (not the piano) is out at Curtis Harper's
  function plateGlyph(cx, cy, sc) {
    const w = 24 * sc, h = 20 * sc;
    return `<path d="M ${cx - w / 2} ${cy + h / 2} L ${cx - w / 2} ${cy - h / 5}
        Q ${cx - w / 2} ${cy - h / 2} ${cx - w / 5} ${cy - h / 2}
        L ${cx + w / 2.6} ${cy - h / 2} Q ${cx + w / 2} ${cy - h / 2} ${cx + w / 2} ${cy - h / 4}
        L ${cx + w / 7} ${cy + h / 2} Z"
        fill="#c9a227" stroke="#8a6f1a" stroke-width="${1.3 * sc}" stroke-linejoin="round"/>`
      + [[-w / 4, h / 8], [-w / 24, -h / 24], [w / 6, -h / 5]].map(([dx, dy]) =>
          `<circle cx="${cx + dx}" cy="${cy + dy}" r="${1.9 * sc}" fill="#f4efe2"/>`).join('');
  }
  // ---- OUT FOR SERVICE zone (1st floor): pianos out at an external tech's
  // shop, parked in the same front-door/parking-lot area, just below
  // Coming Soon
  S.serviceXY = {};
  if (S.floor === 0) {
    const ofl = outForServicePianos();
    // plates out at Curtis Harper's ride along (Brigham 8/26): the PIANO keeps
    // its real map spot — only a gold plate icon shows here, marking that its
    // plate has left the building
    const plateOut = S.data.pianos.filter(p => p.active && p.serial
      && /curtis harper/i.test(p.plateStatus || '') && !outForService(p));
    const items = [...ofl.map(p => ({p, plate: false})), ...plateOut.map(p => ({p, plate: true}))];
    if (items.length) {
      const SZ = {x: 1480, y: csnBottom + 16, x2: 2020};
      const szw = SZ.x2 - SZ.x;
      const shH = 34, nameH = 26;
      const sLay = bigIconLayout(szw - 12);
      const scols = sLay.cols, ssc = sLay.sc, sch = sLay.pitch + nameH;
      const srows = Math.ceil(items.length / scols);
      const szh = shH + srows * sch + 10;
      s += `<rect x="${SZ.x}" y="${SZ.y}" width="${szw}" height="${szh}" rx="8" class="ofszone"/>`;
      s += `<text x="${SZ.x + szw / 2}" y="${SZ.y + 24}" text-anchor="middle" class="ofstitle" font-size="16">OUT FOR SERVICE (${items.length})</text>`;
      const scw = szw / scols;
      items.forEach(({p, plate}, idx) => {
        const cx0 = SZ.x + (idx % scols) * scw;
        const cy0 = SZ.y + shH + Math.floor(idx / scols) * sch;
        const cx = cx0 + scw / 2;
        const hl = S.focusRow === p.row || (q && matches(p, q));
        const dim = q && !matches(p, q);
        const nm = ((p.year ? p.year + ' ' : '')
          + ([p.make, p.model].filter(Boolean).join(' ') || p.summary || ''))
          + (plate ? ' — PLATE' : '');
        const nameLines = wrapCap(nm, scw - 8, 9, 1);
        const iconCy = cy0 + (sch - nameH) / 2;
        if (!plate) S.serviceXY[p.row] = {x: cx, y: cy0 + sch / 2};
        s += `<g class="piano own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
              data-row="${p.row}">${plate ? plateGlyph(cx, iconCy, ssc) : glyph(p.type, cx, iconCy, ssc)}${tempBadge(p, cx, iconCy, ssc)}</g>`;
        s += `<text x="${cx}" y="${cy0 + sch - 6}" text-anchor="middle" class="ofsname" font-size="9">`
          + nameLines.map(L => esc(L)).join('') + `</text>`;
      });
    }
  }
  // ---- ATTIC holding zone (2nd floor): every active piano not on a spot,
  // drawn inside the map's empty lower-right region as a full rectangle
  // flush with the map's right and bottom edges
  let drawW = f.width, drawH = f.height;
  S.holdingXY = {};
  if (S.floor === 1) {
    const list = unplacedPianos();
    if (list.length) {
      const AT = {x: 1412, y: 2620, x2: 2082, y2: 3818};   // attic rectangle
      const zoneW = AT.x2 - AT.x, zoneH = AT.y2 - AT.y;
      s += `<rect x="${AT.x}" y="${AT.y}" width="${zoneW}" height="${zoneH}" rx="8" class="holdzone"/>`;
      s += `<text x="${AT.x + zoneW / 2}" y="${AT.y + 34}" text-anchor="middle" class="holdtitle" font-size="24">ATTIC — NOT ON THE MAP (${list.length})</text>`;
      s += `<text x="${AT.x + zoneW / 2}" y="${AT.y + 56}" text-anchor="middle" class="holdsub" font-size="13">click a piano, then “new spot #” to place it</text>`;
      const headH = 68;
      const cols = 6;
      const rows = Math.ceil(list.length / cols);
      const cw = (zoneW - 16) / cols;
      const ch = Math.min(120, (zoneH - headH - 12) / rows);
      const iw = cw - 8, ih = ch - 8;
      list.forEach((p, idx) => {
        const cx0 = AT.x + 8 + (idx % cols) * cw, cy0 = AT.y + headH + Math.floor(idx / cols) * ch;
        const cx = cx0 + iw / 2;
        const st = pianoStatus(p);
        const hl = S.focusRow === p.row || (q && matches(p, q));
        const dim = q && !matches(p, q);
        const nm = (p.year ? p.year + ' ' : '')
          + ([p.make, p.model].filter(Boolean).join(' ') || p.summary || '');
        const loc = p.location ? p.location.replace(/\s+/g, ' ') : 'no spot yet';
        const nameLines = wrapCap(nm, iw - 6, 10.5, ih > 92 ? 2 : 1);
        const locLines = wrapCap(loc, iw - 6, 9.5, 1);
        const NLH = 12, LLH = 11;
        const textH = nameLines.length * NLH + 2 + locLines.length * LLH;
        const textTop = cy0 + ih - 6 - textH;
        const iconCy = (cy0 + 5 + textTop - 3) / 2;
        const sc = Math.max(1.0, Math.min(2.0, (textTop - cy0 - 8) / 22));
        S.holdingXY[p.row] = {x: cx, y: cy0 + ih / 2};
        s += `<rect x="${cx0}" y="${cy0}" width="${iw}" height="${ih}" rx="8"
              class="holdcell ${hl ? 'hl' : ''} ${dim ? 'dim' : ''}" data-row="${p.row}"/>`;
        s += `<g class="piano ${finClass(p)} ${soldClass(p)} ${st} own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
              data-row="${p.row}">${glyph(p.type, cx, iconCy, sc)}${phaseText(p, cx, iconCy, sc)}${mediaBadge(p, cx, iconCy, sc)}${finBadge(p, cx, iconCy, sc)}${soldBadge(p, cx, iconCy, sc)}${tempBadge(p, cx, iconCy, sc)}${ghostBadge(p, cx, iconCy, sc)}</g>`;
        let ty = textTop + 9;
        s += `<text x="${cx}" y="${ty}" text-anchor="middle" class="holdname" font-size="10.5">`
          + nameLines.map((L, li) => `<tspan x="${cx}" ${li ? `dy="${NLH}"` : ''}>${esc(L)}</tspan>`).join('')
          + `</text>`;
        ty += (nameLines.length - 1) * NLH + LLH;
        s += `<text x="${cx}" y="${ty}" text-anchor="middle" class="holdloc" font-size="9.5">`
          + locLines.map((L, li) => `<tspan x="${cx}" ${li ? `dy="${LLH}"` : ''}>${esc(L)}</tspan>`).join('')
          + `</text>`;
      });
    }
  }
  // temporary map spots: pianos parked on open floor space by a manager.
  // location format "Temp spot @1F 512,340" — they draw as dashed boxes and
  // vanish the moment the piano moves to a real spot or is delivered.
  S.tempXY = {};
  S.data.pianos.forEach(p => {
    if (!p.active) return;
    const m = /^temp spot @([12])f\s+(\d+),(\d+)/i.exec((p.location || '').trim());
    if (!m) return;
    const fl = +m[1] - 1, x = +m[2], y = +m[3];
    S.tempXY[p.row] = {x, y, floor: fl};
    if (fl !== S.floor) return;
    const hl = S.focusRow === p.row || (q && matches(p, q));
    const dim = q && !matches(p, q);
    s += `<g class="piano tempspot ${pianoStatus(p)} own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}" data-row="${p.row}">
      <rect x="${x - 30}" y="${y - 26}" width="60" height="52" rx="7" class="temprect"/>
      <text x="${x}" y="${y - 30}" text-anchor="middle" class="templbl" font-size="9">TEMP</text>
      ${glyph(p.type, x, y + 3, 1.05)}${phaseText(p, x, y + 3, 1.05)}${ghostBadge(p, x, y + 3, 1.05)}</g>`;
  });
  S.drawW = drawW; S.drawH = drawH;

  const svg = $('#plan');
  svg.innerHTML = s;
  // temp-spot placement mode (Brigham 8/26): a draggable gold TEMP square —
  // tap anywhere to jump it there, drag to fine-tune, ✓ Place on the bar
  // commits. Floor tabs stay usable; the ghost re-appears after re-renders.
  if (S.tempPlace) {
    svg.style.cursor = 'crosshair';
    // at least ~52 screen-px wide no matter the zoom — at phone fit-width a
    // piano-footprint square renders around 13px, effectively invisible
    const pxScale = (svg.clientWidth || drawW) / drawW;
    const boost = Math.max(1, 52 / (74 * pxScale));
    const GW = 74 * boost, GH = 116 * boost;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'tempghost');
    // spawn the square in the middle of whatever the user is LOOKING AT —
    // a fixed spawn point can be far outside their scrolled view
    let c0 = S.tempPlace.ghost;
    if (!c0) {
      const sc = document.querySelector('.mapscroll');
      const pxW = svg.clientWidth || (sc ? sc.clientWidth : 0);
      if (sc && pxW) {
        const scale = S.drawW / pxW;
        c0 = {x: Math.max(60, Math.min(S.drawW - 60, (sc.scrollLeft + sc.clientWidth / 2) * scale)),
              y: Math.max(80, Math.min(S.drawH - 80, (sc.scrollTop + sc.clientHeight / 2) * scale))};
      } else {
        c0 = {x: S.drawW / 2, y: Math.min(S.drawH / 2, 600)};
      }
    }
    S.tempPlace.ghost = c0;
    g.innerHTML = `<rect x="${c0.x - GW / 2}" y="${c0.y - GH / 2}" width="${GW}" height="${GH}" rx="8"
        fill="#c99a2e" fill-opacity=".55" stroke="#c99a2e" stroke-width="3" stroke-dasharray="7 5"></rect>
      <text x="${c0.x}" y="${c0.y}" text-anchor="middle" dominant-baseline="middle"
        font-size="${Math.round(22 * boost)}" font-weight="800" fill="#241c00">TEMP</text>`;
    svg.appendChild(g);
    const svgPt = ev => {
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    };
    const moveGhost = c => {
      S.tempPlace.ghost = {x: c.x, y: c.y};
      const r = g.querySelector('rect'), t = g.querySelector('text');
      r.setAttribute('x', c.x - GW / 2); r.setAttribute('y', c.y - GH / 2);
      t.setAttribute('x', c.x); t.setAttribute('y', c.y);
    };
    // tap anywhere on open map = jump the square there
    svg.addEventListener('click', ev => {
      if (!S.tempPlace) return;
      if (ev.target.closest('.piano')) return;
      ev.stopPropagation();
      moveGhost(svgPt(ev));
    }, true);
    // drag the square itself for fine placement
    let dragging = false;
    g.addEventListener('pointerdown', ev => {
      dragging = true; ev.preventDefault(); ev.stopPropagation();
      try { g.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    g.addEventListener('pointermove', ev => { if (dragging) moveGhost(svgPt(ev)); });
    ['pointerup', 'pointercancel'].forEach(t => g.addEventListener(t, () => { dragging = false; }));
  }
  svg.querySelectorAll('.cabunitbox, .cabunitnum, .cabcntc, .cabcnt2').forEach(el =>
    el.addEventListener('click', ev => { ev.stopPropagation(); openCabUnitModal(el.dataset.unit); }));
  sizePlan();
  // cards open on CLICK only (082726hales16) — hover-open made panning the
  // map spray cards everywhere; hover now just shows the cursor affordance
  svg.querySelectorAll('.piano').forEach(el => {
    el.addEventListener('click', ev => { ev.stopPropagation(); openPop(+el.dataset.row, el, true); });
  });
  svg.querySelectorAll('.holdcell[data-row]').forEach(el => {
    el.addEventListener('click', () => openPop(+el.dataset.row, el, true));
  });
  svg.querySelectorAll('.slot').forEach(el =>
    el.addEventListener('click', () => openSlotPop(el.dataset.slot)));
  svg.querySelectorAll('.addplus').forEach(el =>
    el.addEventListener('click', ev => { ev.stopPropagation(); openAssignModal(el.dataset.slot); }));
}

/* ---------- hover / tap card ---------- */
let hideTimer = null, popPinned = false;
function scheduleHide() {
  if (popPinned) return;
  // long enough to cross the gap to the card itself before it vanishes
  hideTimer = setTimeout(() => { $('#pop').hidden = true; }, 500);
}
function cancelHide() { clearTimeout(hideTimer); }
$('#pop').addEventListener('mouseenter', cancelHide);
$('#pop').addEventListener('mouseleave', scheduleHide);

/* ===================== SUGGESTION BOX =====================
 * 💡 in the top bar: team members file bugs / edits / ideas about the web
 * apps, with an optional screenshot and auto-captured context. Requests
 * live on the report sheet; status flows Requested -> In progress -> Live
 * -> Tested, and the requester confirms "Tested" from their own list here. */
function openSuggestBox() {
  const old = document.querySelector('.sgbox');
  if (old) { old.remove(); return; }
  const openSerial = (!$('#pop').hidden && S.popRow)
    ? (S.data.pianos.find(x => x.row === S.popRow) || {}).serial : '';
  const ov = document.createElement('div');
  ov.className = 'tagview sgbox';
  ov.innerHTML = `<div class="tvbox sgwrap">
    <div class="tvhead"><div><b>💡 Suggest an improvement</b>
      <span>bugs, edits, ideas — goes straight onto the fix list</span></div>
      <button class="tvx">✕</button></div>
    <div class="sgform">
      <div class="sgtypes">
        <button class="sgt on" data-t="edit">✏️ Edit</button>
        <button class="sgt" data-t="idea">💡 Idea</button>
      </div>
      <textarea class="sgtext" maxlength="1500" placeholder="What's wrong / what would make it better? A sentence or two is plenty."></textarea>
      <div class="sgrow">
        <label class="sgshot">📷 Attach screenshot<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
        <span class="sgshotname"></span>
        <button class="sgsend">Send it 🚀</button>
      </div>
      <div class="sgprev" hidden><img alt="screenshot preview"><button class="sgprevx" title="remove screenshot">✕</button></div>
      <div class="sgmsg"></div>
    </div>
    <div class="sgmine"><b>My requests</b><div class="sgminelist">loading…</div></div>
  </div>`;
  document.body.appendChild(ov);
  ov.onclick = ev => { if (ev.target === ov || ev.target.closest('.tvx')) ov.remove(); };
  let type = 'edit', shotFile = null;
  ov.querySelectorAll('.sgt').forEach(b => b.onclick = () => {
    ov.querySelectorAll('.sgt').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); type = b.dataset.t;
  });
  const fin = ov.querySelector('.sgshot input');
  const prev = ov.querySelector('.sgprev'), prevImg = prev.querySelector('img');
  const clearShot = () => {
    shotFile = null; fin.value = '';
    ov.querySelector('.sgshotname').textContent = '';
    prevImg.removeAttribute('src'); prev.hidden = true;
  };
  fin.onchange = () => {
    shotFile = fin.files && fin.files[0];
    ov.querySelector('.sgshotname').textContent = shotFile ? shotFile.name.slice(0, 22) : '';
    if (shotFile) {   // inline thumbnail so you can see what you're sending
      const rd = new FileReader();
      rd.onload = () => { if (shotFile) { prevImg.src = rd.result; prev.hidden = false; } };
      rd.readAsDataURL(shotFile);
    } else { prevImg.removeAttribute('src'); prev.hidden = true; }
  };
  prev.querySelector('.sgprevx').onclick = clearShot;
  const msg = ov.querySelector('.sgmsg');
  ov.querySelector('.sgsend').onclick = async ev => {
    const sendBtn = ev.currentTarget;
    if (sendBtn.disabled) return;   // power-clicks file duplicates (Karmel 8/27)
    const text = ov.querySelector('.sgtext').value.trim();
    if (!text) { msg.className = 'sgmsg err'; msg.textContent = 'Write a sentence first.'; return; }
    const wa = writeAuth();
    if (!wa.ok) {
      if (wa.renewing) {
        lsSet('sgDraft', JSON.stringify({type, text}));
        msg.className = 'sgmsg';
        msg.textContent = 'Your sign-in expired — renewing it now, back in a second…';
      } else {
        msg.className = 'sgmsg err'; msg.textContent = 'Sign in first so we know who to thank.';
      }
      return;
    }
    const pin = wa.pin;
    let shotFailed = '';   // '' = fine, otherwise the why + what-to-do text
    sendBtn.disabled = true;
    const sendWas = sendBtn.textContent;
    sendBtn.textContent = 'Sending…';
    msg.className = 'sgmsg'; msg.textContent = shotFile ? 'Uploading screenshot…' : 'Sending…';
    const body = {pin, action: 'suggest', type, text,
      context: 'view:' + (S.view || 'map') + (openSerial ? ' · piano #' + openSerial : ''),
      ...authFields()};
    try {
      if (shotFile) {
        // upload through the sales-app service account — the bridge's own
        // Drive token has no Drive scope in the anonymous web app, which
        // silently ate every screenshot the team attached (fixed 8/25)
        // an undecodable image (HEIC on desktop, corrupt file) must not
        // sink the whole request — file it without the picture instead
        const dataUrl = await downscalePhoto(shotFile, 1600, 0.85).catch(() => null);
        if (!dataUrl) {
          shotFailed = 'this browser can\u2019t read that image format'
            + (/\.heic$|\.heif$/i.test(shotFile.name || '') || /heic|heif/i.test(shotFile.type || '')
               ? ' (it\u2019s a HEIC photo from an iPhone)' : '')
            + ' \u2014 take a screenshot (that saves as PNG) or convert it to JPG/PNG, then attach it to a follow-up suggestion';
        }
        else {
        // 45s hard deadline + one retry: a stalled connection must never
        // leave the button stuck on "Sending…" — worst case the suggestion
        // files WITHOUT the picture and says so plainly
        let uj = null;
        for (let ua = 0; ua < 2 && !(uj && uj.url); ua++) {
          try {
            const up = await fetchT('https://blpsalesapp.netlify.app/.netlify/functions/request-shot', {
              method: 'POST', headers: {'content-type': 'application/json'},
              // team key, not the user's pin: Google-signed-in users have no
              // pin, and an empty key made this endpoint reject every
              // screenshot (found 8/29) — same pattern as the card uploads
              body: JSON.stringify({key: 'pianoman', id: Date.now().toString(36),
                photo: dataUrl.split(',')[1], photoType: 'image/jpeg',
                photoName: (shotFile.name || 'screenshot.png').replace(/[^\w.-]+/g, '_').slice(0, 40)})}, 45000);
            uj = await up.json().catch(() => ({}));
          } catch (eUp) { uj = null; }
          if (!(uj && uj.url) && ua === 0) msg.textContent = 'Upload is slow — retrying the screenshot…';
        }
        if (uj && uj.url) body.screenshotUrl = uj.url;
        else shotFailed = 'the upload timed out (slow connection or a service hiccup) \u2014 your suggestion still went in; attach the picture to a follow-up when the connection is better';
        }
      }
      // Google sometimes answers the generic service ping without running
      // the action (9/1) — j.ok without an id means nothing was filed. Retry.
      let j = null;
      for (let a = 0; a < 3; a++) {
        const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
          headers: {'content-type': 'text/plain;charset=utf-8'}, body: JSON.stringify(body)});
        j = await r.json().catch(() => null);
        if (j && j.ok && j.id) break;
        if (j && j.error) break;                    // real rejection — don't retry
        await new Promise(res => setTimeout(res, 1000 * (a + 1)));
      }
      if (!j || !j.ok || !j.id) throw new Error((j && j.error) || 'the Google bridge hiccuped — try again in a few seconds');
      msg.className = 'sgmsg ok';
      msg.textContent = '✓ Filed as ' + j.id + (shotFailed
        ? ' — but it went in WITHOUT the picture: ' + shotFailed + '.'
        : ' — thank you! You\u2019ll see it move to Live here when it ships.');
      ov.querySelector('.sgtext').value = ''; clearShot();
      loadMyRequests(ov);
    } catch (e) { msg.className = 'sgmsg err'; msg.textContent = '✗ ' + e.message; }
    sendBtn.disabled = false; sendBtn.textContent = sendWas;
  };
  loadMyRequests(ov);
}
async function loadMyRequests(ov) {
  const box = ov.querySelector('.sgminelist');
  try {
    const r = await fetch(BRIDGE_URL + '?fn=requests', {redirect: 'follow'});
    const j = await r.json();
    const me = clockName().toLowerCase();
    const mine = (j.requests || []).filter(x => (x.who || '').toLowerCase() === me).slice(0, 12);
    if (!mine.length) { box.innerHTML = '<i>none yet — be the first!</i>'; return; }
    const ICONS = {bug: '🐛', edit: '✏️', idea: '💡'};
    box.innerHTML = mine.map(x => `<div class="sgreq">
      <span class="sgst s${esc(x.status.replace(/\s/g, ''))}">${esc(x.status)}</span>
      <span class="sgtxt">${ICONS[x.type] || '💡'} ${esc(x.text.slice(0, 220))}${x.text.length > 220 ? '…' : ''}</span>
      ${x.status === 'Live' ? `<button class="sgok" data-id="${esc(x.id)}">✅ It works</button>` : ''}
    </div>`).join('');
    box.querySelectorAll('.sgok').forEach(b => b.onclick = async () => {
      const {pin, ok} = writeAuth(); if (!ok) return;
      b.textContent = '…';
      await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin, action: 'requeststatus', id: b.dataset.id, status: 'Tested', ...authFields()})});
      loadMyRequests(ov);
    });
  } catch (e) { box.innerHTML = '<i>couldn\u2019t load</i>'; }
}
setTimeout(() => {
  const btn = document.getElementById('suggestBtn');
  if (btn) btn.onclick = openSuggestBox;
  // 🔄 hard refresh — reload the whole app past every cache so the newest
  // features and data come down, from any screen (Brigham 8/28)
  /* stale-build self-healing (9/1): three team devices ran week-old cached
   * builds today and their task-board writes silently detoured through the
   * slow Google path. The app now checks the server's version and shows a
   * tap-to-update banner whenever it's behind — checked on load, every
   * 15 min, and each time the app comes back to the foreground. */
  const hardRefreshNow = async () => {
    try {
      if ('caches' in window) {
        const ks = await caches.keys();
        await Promise.all(ks.map(k => caches.delete(k)));
      }
    } catch (e) {}
    const u = new URL(location.href);
    u.searchParams.set('r', Date.now().toString(36));
    location.replace(u.toString());
  };
  const runningVer = (() => {
    const sc = document.querySelector('script[src*="app.js?v="]');
    const m = sc && /v=(\d+)/.exec(sc.src);
    return m ? +m[1] : 0;
  })();
  const checkAppVersion = async () => {
    if (!runningVer || document.getElementById('updbanner')) return;
    try {
      const r = await fetch('/?vercheck=' + Date.now().toString(36), {cache: 'no-store'});
      const m = /app\.js\?v=(\d+)/.exec(await r.text());
      if (m && +m[1] > runningVer) {
        const d = document.createElement('div');
        d.id = 'updbanner';
        d.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:9999;'
          + 'background:#9e2020;color:#fff;padding:11px 20px;border-radius:999px;font:700 14px Helvetica,Arial;'
          + 'box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer;white-space:nowrap';
        d.textContent = '🚀 App update ready — tap to refresh';
        d.onclick = hardRefreshNow;
        document.body.appendChild(d);
      }
    } catch (e) { /* offline — check again later */ }
  };
  setTimeout(checkAppVersion, 15000);
  setInterval(checkAppVersion, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(checkAppVersion, 1500); });

  const hrb = document.getElementById('hardRefreshBtn');
  if (hrb) hrb.onclick = async () => {
    hrb.textContent = '⏳';
    try {
      if (window.caches) {
        const ks = await caches.keys();
        await Promise.all(ks.map(k => caches.delete(k)));
      }
    } catch (e) {}
    const u = new URL(location.href);
    u.searchParams.set('r', Date.now().toString(36));
    location.replace(u.toString());
  };
  // 🔢 one-tap Shop Queue report (Brigham 8/25) — same path as a shared link
  const qb = document.getElementById('queueBtn');
  if (qb) qb.onclick = () => {
    S.openReport = 'queue';
    if (!S.tlRows) loadTimeLog();          // ASSIGNED TO column
    switchView('report');
    renderReport();
  };
  // a draft stashed before a sign-in renewal: reopen the box, text intact
  const d = lsGet('sgDraft');
  if (d && authUser()) {
    lsDel('sgDraft');
    try {
      const {type, text} = JSON.parse(d);
      openSuggestBox();
      const ov = document.querySelector('.sgbox');
      if (ov) {
        ov.querySelector('.sgtext').value = text || '';
        ov.querySelectorAll('.sgt').forEach(x => x.classList.toggle('on', x.dataset.t === type));
        const m = ov.querySelector('.sgmsg');
        if (m) { m.className = 'sgmsg ok'; m.textContent = 'Signed back in — hit Send it 🚀 to file your request.'; }
      }
    } catch (e) {}
  }
}, 500);

/* ===================== WORK CLOCK =====================
 * Four punch surfaces (card button, QR scan banner, My Day dock, Shop Board)
 * all write the same bridge Time Log. One open session per tech — the
 * bridge closes the previous one on every clockin and tells us what closed.
 * Phase selection is MANDATORY before clocking in ("Other" allows write-in). */
const NUDGE_MIN = 15;             // quiet minutes before the dock asks "still on it?"
const CLOCK = {open: null, all: [], today: {}, lastAct: Date.now(), nudged: false};
function clockName() { const u = authUser(); return u ? String(u.name || '').trim() : ''; }
function clockElapsed(startIso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(startIso)) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(ss).padStart(2, '0');
}
async function fetchClock() {
  try {
    const r = await fetch(BRIDGE_URL + '?fn=timeclock', {redirect: 'follow'});
    const j = await r.json();
    if (!j.open) return;
    CLOCK.all = j.open; CLOCK.today = j.todayMinutes || {};
    const me = clockName().toLowerCase();
    const was = CLOCK.open && CLOCK.open.serial;
    CLOCK.open = j.open.find(o => (o.tech || '').toLowerCase() === me) || null;
    if ((CLOCK.open && CLOCK.open.serial) !== was) { renderClockChip(); renderDock(); }
  } catch (e) { /* offline — keep last */ }
}
/* Confirmation popup before any piano clock change (Brigham 8/27) — a DOM
 * modal (not confirm()) so Google-translate renders it for ES mode. */
function clockConfirm(icon, title, lines) {
  return new Promise(resolve => {
    document.querySelectorAll('.ccfm').forEach(el => el.remove());
    const ov = document.createElement('div');
    ov.className = 'tagview ccfm';
    ov.innerHTML = `<div class="tvbox ccfmbox">
      <div class="ccfmicon">${icon}</div>
      <h3>${title}</h3>
      <div class="ccfmlines">${lines}</div>
      <div class="ccfmbtns">
        <button class="ccfmyes">✓ Yes, that's right</button>
        <button class="ccfmno">Cancel</button>
      </div></div>`;
    document.body.appendChild(ov);
    const done = v => { ov.remove(); resolve(v); };
    ov.querySelector('.ccfmyes').onclick = ev => { ev.stopPropagation(); done(true); };
    ov.querySelector('.ccfmno').onclick = ev => { ev.stopPropagation(); done(false); };
    ov.onclick = ev => { ev.stopPropagation(); if (ev.target === ov) done(false); };
  });
}
const pianoLabel = p => esc(((p.summary || [p.make, p.model].filter(Boolean).join(' ')) || '').slice(0, 34))
  + ' · #' + esc(p.serial || '');
/* clock-in ↔ phase sync (Brigham 8/28): job costing means every clock-in
 * names the work — when that work is a real shop phase and the map says
 * something else, invite the tech to update the phase right there. Forward
 * moves still pass through the progress-photo gate, same as the dropdown. */
async function maybeClockPhaseSync(p, ph) {
  const seq = pianoPhases(p) || PHASES;
  if (seq.indexOf(ph) < 0) return;                  // Moving, Admin, write-ins, states — skip
  const cur = String(p.phase || '').trim();
  if (!cur || cur === ph) return;
  const ok = await clockConfirm('🔄', 'Update the shop phase?',
    `<div class="ccfmrow">You clocked in to do <b>${esc(ph)}</b> — but this piano's shop
       phase is still <b>${esc(cur)}</b>.</div>
     <div class="ccfmrow">Approve updating the shop phase to <b>${esc(ph)}</b>?
       <small>a forward move asks for the finished-work progress photo, same as the
       phase dropdown — Cancel leaves it at ${esc(cur)}</small></div>`);
  if (ok) setPhase(p, ph, $('#pop'));
}
/* 💼 LEADS on a piano card (Melissa 8/29): attach sales leads from the
 * Leads Log to a showroom piano. The link is stored ON THE LEAD (a "Piano
 * Serial" column in the Leads Log, via the storemap-leads bridge), so the
 * sales app stays the owner of lead data. Owners + Melissa only (tbAdmin). */
const LEADS_API = 'https://blpsalesapp.netlify.app/.netlify/functions/storemap-leads';
const LD = {list: null, loading: false, at: 0};
async function leadsFetch(force) {
  if (LD.loading) return;
  if (!force && LD.list && Date.now() - LD.at < 120000) return;
  LD.loading = true;
  try {
    const r = await fetch(LEADS_API + '?key=' + encodeURIComponent('pianoman'));
    const j = await r.json();
    if (j && j.leads) { LD.list = j.leads; LD.at = Date.now(); }
  } catch (e) { /* the row shows a retry hint */ }
  LD.loading = false;
}
async function leadAttach(id, serial) {
  const r = await fetch(LEADS_API, {method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({key: 'pianoman', id, serial, by: clockName()})});
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.error || 'failed');
}
function wireLeadsRow(pop, p) {
  const box = pop.querySelector('.leadchips');
  if (!box) return;
  const msg = pop.querySelector('.leadmsg');
  const paint = () => {
    if (!LD.list) { box.innerHTML = '<i class="lite">couldn’t load leads — reopen the card to retry</i>'; return; }
    const mine = LD.list.filter(l => l.serial && l.serial === p.serial);
    box.innerHTML = mine.map(l =>
      `<span class="cabchip leadchip" data-id="${esc(l.id)}" title="${esc([l.headline, l.status, l.rep && 'rep: ' + l.rep].filter(Boolean).join(' · '))}">💼 ${esc(l.name)}<i class="leaddel" data-id="${esc(l.id)}" title="detach from this piano">✕</i></span>`).join('')
      + '<button class="cabadd leadadd">＋ lead</button>';
    box.querySelectorAll('.leadchip').forEach(ch => ch.onclick = ev => {
      ev.stopPropagation();
      if (ev.target.closest('.leaddel')) return;
      window.open('https://blpsalesapp.netlify.app/leads/' + encodeURIComponent(ch.dataset.id), '_blank', 'noopener');
    });
    box.querySelectorAll('.leaddel').forEach(x => x.onclick = async ev => {
      ev.stopPropagation();
      msg.className = 'leadmsg phmsg'; msg.textContent = 'Detaching…';
      try {
        await leadAttach(x.dataset.id, '');
        const l = LD.list.find(v => v.id === x.dataset.id); if (l) l.serial = '';
        msg.textContent = ''; paint();
      } catch (e) { msg.className = 'leadmsg phmsg err'; msg.textContent = '✗ ' + e.message; }
    });
    box.querySelector('.leadadd').onclick = ev => { ev.stopPropagation(); openLeadModal(p, paint, msg); };
  };
  if (LD.list) paint();
  else { box.innerHTML = '<i class="lite">loading…</i>'; leadsFetch().then(paint); }
}
function openLeadModal(p, done, msg) {
  const ov = modalShell('leadmodal', `
    <span class="x">✕</span>
    <h3>💼 Attach a lead — ${esc((p.summary || p.make || 'piano').slice(0, 30))} #${esc(p.serial)}</h3>
    <input class="lm-q" placeholder="search leads — name, headline, rep…">
    <div class="arch-list lm-list"></div>`);
  const list = ov.querySelector('.lm-list'), qIn = ov.querySelector('.lm-q');
  const paint = () => {
    const q = qIn.value.trim().toLowerCase();
    const hits = (LD.list || []).filter(l => !l.serial || l.serial !== p.serial)
      .filter(l => !q || (l.name + ' ' + l.headline + ' ' + l.rep + ' ' + l.status).toLowerCase().includes(q));
    list.innerHTML = hits.slice(0, 40).map(l => `<div class="archrow" data-id="${esc(l.id)}">
        <div><b>${esc(l.name)}</b>${l.serial ? ` <small>→ #${esc(l.serial)}</small>` : ''}
          <small>${esc([l.headline, l.status, l.rep].filter(Boolean).join(' · ').slice(0, 90))}</small></div>
        <button class="arch-restore lm-go" data-id="${esc(l.id)}">＋ Attach</button>
      </div>`).join('')
      + (hits.length > 40 ? '<div class="pwnone" style="display:block;padding:6px 0">…more — narrow the search</div>' : '')
      || '<div class="pwnone" style="display:block;padding:8px 0">No leads match.</div>';
    list.querySelectorAll('.lm-go').forEach(b => b.onclick = async ev => {
      ev.stopPropagation();
      b.disabled = true; b.textContent = '…';
      try {
        await leadAttach(b.dataset.id, p.serial);
        const l = (LD.list || []).find(v => v.id === b.dataset.id); if (l) l.serial = p.serial;
        ov.hidden = true; done();
      } catch (e) {
        b.disabled = false; b.textContent = '＋ Attach';
        msg.className = 'leadmsg phmsg err'; msg.textContent = '✗ ' + e.message;
      }
    });
  };
  qIn.oninput = paint;
  leadsFetch().then(paint);
  paint();
  qIn.focus();
}

/* ❗ IMPORTANT-note acknowledgment (Karmel 8/29): before clocking into work
 * an important note concerns ("keep the ivory on the key sticks"), the tech
 * checks a box saying they've read it — the acknowledgment is logged with
 * their name in the ACTIVITY LOG. Keyword scopes decide which phases a note
 * concerns; a note that matches no scope gates EVERY phase (safe default). */
function impNoteScopes(note) {
  const t = String(note || '').toLowerCase();
  const scopes = [];
  if (/ivor|keytop|key ?stick|key ?servic|keywork|\bkeys?\b/.test(t)) scopes.push(/key|dhrt/i);
  if (/string|bass/.test(t)) scopes.push(/string|chip/i);
  if (/refinish|lacquer|colou?r|sheen|decal|finish/.test(t)) scopes.push(/refinish|lacquer/i);
  if (/plate|plating/.test(t)) scopes.push(/plate|prsb|plating/i);
  if (/soundboard/.test(t)) scopes.push(/soundboard|lacquer|prsb/i);
  if (/\btun(e|ing)?\b|pitch/.test(t)) scopes.push(/tuning/i);
  if (/bench/.test(t)) scopes.push(/bench/i);
  return scopes;
}
function impNoteGate(p, ph) {
  const note = String(p.importantNote || '').trim();
  if (!note) return Promise.resolve({ok: true});
  const scopes = impNoteScopes(note);
  if (scopes.length && !scopes.some(re => re.test(ph))) return Promise.resolve({ok: true});
  return new Promise(resolve => {
    document.querySelectorAll('.ccfm').forEach(el => el.remove());
    const ov = document.createElement('div');
    ov.className = 'tagview ccfm';
    ov.innerHTML = `<div class="tvbox ccfmbox">
      <div class="ccfmicon">❗</div>
      <h3>Important note on this piano</h3>
      <div class="ccfmlines"><div class="ccfmrow" style="border-color:#9e2020;background:#fdf3f3">
        <b>${esc(note)}</b></div>
      <label class="ccfmrow" style="display:flex;gap:9px;align-items:flex-start;cursor:pointer">
        <input type="checkbox" class="impack" style="margin-top:3px;width:18px;height:18px">
        <span>I've read this and will follow it while doing <b>${esc(ph)}</b></span></label></div>
      <div class="ccfmbtns">
        <button class="ccfmyes" disabled>✓ Acknowledge &amp; clock in</button>
        <button class="ccfmno">Cancel</button>
      </div></div>`;
    document.body.appendChild(ov);
    const yes = ov.querySelector('.ccfmyes');
    ov.querySelector('.impack').onchange = ev => { yes.disabled = !ev.target.checked; };
    const done = v => { ov.remove(); resolve(v); };
    yes.onclick = ev => { ev.stopPropagation(); done({ok: true, note}); };
    ov.querySelector('.ccfmno').onclick = ev => { ev.stopPropagation(); done({ok: false}); };
    ov.onclick = ev => { ev.stopPropagation(); if (ev.target === ov) done({ok: false}); };
  });
}
async function punch(action, p, phase, source, endAt, ackNote) {
  const {pin, ok} = writeAuth();
  if (!ok) return {error: 'Sign in first — hours are logged under your name.'};
  const body = {pin, action, source: source || 'card', ...authFields()};
  if (p) { body.serial = p.serial; body.row = p.row; body.phase = phase || ''; }
  if (ackNote) body.ackNote = String(ackNote).slice(0, 200);
  if (endAt) body.endAt = endAt;
  try {
    let j = null;
    // Google occasionally misroutes a POST and answers the generic service
    // ping without running the action — the punch would silently vanish
    // from payroll (found 9/1). Retry through the glitch.
    for (let a = 0; a < 3; a++) {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'}, body: JSON.stringify(body)});
      j = await r.json();
      if (!(j && j.service && !j.error)) break;
      await new Promise(res => setTimeout(res, 1200 * (a + 1)));
    }
    if (j && j.service && !j.error) return {error: 'the Google bridge hiccuped — the punch did NOT record; try again in a minute'};
    if (j.ok) {
      CLOCK.open = action === 'clockin'
        ? (j.open || {tech: clockName(), serial: p.serial, phase, start: new Date().toISOString()})
        : null;
      CLOCK.nudged = false; CLOCK.lastAct = Date.now();
      renderClockChip(); renderDock();
    }
    return j;
  } catch (e) {
    // the bridge can answer with a non-JSON error page for a few seconds
    // mid-deploy — the punch often DID land, so re-sync before complaining
    setTimeout(fetchClock, 2500);
    return {error: 'the punch may not have recorded — give it a few seconds, the clock will re-sync'};
  }
}
/* ========= PHASE CHECKLISTS + MINI-QC (CAP pilot, Brigham 9/3) =========
 * Steps live on the 'Phase Checklists' sheet tab; state is per piano+phase
 * in Supabase via phase-qc (salesapp2). Coach mode (one step at a time,
 * handbook detail inline) for Training clock-ins; bench sheet for trained
 * techs. Advancing OUT of a checklist phase requires a manager mini-QC:
 * request → text to Mark (30-min escalation to Mark+Karmel) → C-rail
 * inspection → pass advances the phase, fail creates a 🔁 Rework card. */
const QC_PHASES = ['CAP'];   // pilot — add phases here as checklists are seeded
// acronym school (Brigham 9/3): TRAINING mode spells acronyms out so newbies
// learn them; trained techs see the acronyms alone everywhere else.
const PHASE_LONG = {
  'CAP': 'Cleaning & Action Prep',
  'PRSB & Plate Refinishing': 'Perimeter, Ribs, Soundboard & Bridges — plus plate refinishing',
  'PRSB': 'Perimeter, Ribs, Soundboard & Bridges',
  'DHRT': 'Dampers, Hammers, Regulation & Trapwork',
  'QC & Assembly': 'Quality Control & Assembly',
};
function trainPhaseName(phase) {
  const long = PHASE_LONG[String(phase || '').trim()];
  return esc(phase) + (long ? ` <span style="font-weight:600;font-size:.72em;color:#6f6a63">(${esc(long)})</span>` : '');
}
// TRAINING MONTH (Brigham 9/3 → 10/3): EVERY real phase advance goes through
// a Brigham-performed mini-QC (Karmel videos it for manager training). After
// 10/3 the gate falls back to QC_PHASES. Waiting/queue/sale states never gate.
const QC_ALL_UNTIL = new Date('2026-10-04T00:00:00-06:00').getTime();
function qcGated(was) {
  const w = String(was || '').trim();
  if (!w || /^(waiting|in queue|paused|for sale|delivered)/i.test(w)) return false;
  return QC_PHASES.includes(w) || Date.now() < QC_ALL_UNTIL;
}
const PHASEQC_URL = 'https://blpsalesapp.netlify.app/.netlify/functions/phase-qc';
const CL = {cache: {}};   // (serial|phase) -> {items, checks:Set, request}
async function clFetch(serial, phase, force) {
  const k = serial + '|' + phase;
  const hit = CL.cache[k];
  if (!force && hit && Date.now() - hit.at < 60000) return hit;
  try {
    const r = await fetch(`${PHASEQC_URL}?key=pianoman&serial=${encodeURIComponent(serial)}&phase=${encodeURIComponent(phase)}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'load failed');
    if (j.glossary) CL.glossary = j.glossary;
    const done = new Set((j.checks || []).filter(c => !c.skipped).map(c => c.step));
    const skips = new Map((j.checks || []).filter(c => c.skipped).map(c => [c.step, c.note || '']));
    CL.cache[k] = {at: Date.now(), items: j.items || [], done, skips, request: j.request || null};
  } catch (e) { CL.cache[k] = CL.cache[k] || {at: 0, items: [], done: new Set(), skips: new Map(), request: null}; }
  return CL.cache[k];
}
/* 📖 tap-to-learn glossary (Brigham 9/3): terms from the Glossary sheet tab
 * become links inside the TRAINING text; tapping pops the definition and,
 * when the sheet has an image URL, a picture (like the escutcheon). */
function glossLinkify(html) {
  const gl = CL.glossary || [];
  if (!gl.length) return html;
  const terms = gl.map((g, gi) => ({...g, gi})).sort((a, b) => b.term.length - a.term.length);
  // walk only TEXT segments so attributes/tags are never touched
  return html.split(/(<[^>]+>)/).map(seg => {
    if (seg.startsWith('<')) return seg;
    let out = seg;
    for (const t of terms) {
      const re = new RegExp('\\b(' + t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?)\\b', 'i');
      if (re.test(out)) out = out.replace(re, `<a class="glterm" data-g="${t.gi}">$1</a>`);
    }
    return out;
  }).join('');
}
function openGloss(gi) {
  const g = (CL.glossary || [])[gi];
  if (!g) return;
  const old = document.getElementById('glpop'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'glpop';
  ov.style.cssText = 'position:fixed;inset:0;z-index:340;background:rgba(20,22,25,.45);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;max-height:80vh;overflow:auto;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.35)">
    <button class="dsx">✕</button>
    <h3 style="margin:0 0 6px;font-size:16px;text-transform:capitalize">📖 ${esc(g.term)}</h3>
    ${g.img ? `<img src="${esc(g.img)}" alt="${esc(g.term)}" style="width:100%;border-radius:10px;margin:6px 0">` : ''}
    <div style="font-size:14px;line-height:1.55">${esc(g.def)}</div>
    <div style="font-size:11px;color:#8a847b;margin-top:10px">from the shop Glossary — ask a manager to add a photo or fix a definition</div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.dsx').onclick = () => ov.remove();
  ov.onclick = ev => { if (ev.target === ov) ov.remove(); };
}
document.addEventListener('click', ev => {
  const a = ev.target.closest && ev.target.closest('.glterm');
  if (a) { ev.preventDefault(); ev.stopPropagation(); openGloss(+a.dataset.g); }
}, true);
function clVariantItems(items, p, kind) {
  const want = p && p.type === 'grand' ? 'grand' : 'upright';
  return items.filter(it => it.kind === kind && (it.variant === 'all' || it.variant === want));
}
async function clToggle(serial, phase, stepIdx, done, skipped, note) {
  fetch(PHASEQC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({key: 'pianoman', op: 'check', serial, phase, step: stepIdx, done,
      skipped: !!skipped, note: note || '', by: clockName()})})
    .catch(() => {});
}
// floating pill while clocked into a checklist phase
async function updateClPill() {
  let pill = document.getElementById('clPill');
  const o = CLOCK.open;
  // a 🎓 Training punch stores just "Training" — the checklist phase is then
  // the PIANO's current phase (Hunter/CAP pilot, 9/3), and coach mode kicks in
  let ph = o && (o.phase || '').replace(/^Training:?\s*/i, '').replace(/\s*[—-]\s*w\/.*$/i, '').trim();
  if (o && !ph && /^training/i.test(o.phase || '')) {
    const pp = S.data.pianos.find(x => x.serial === o.serial);
    ph = pp ? String(pp.phase || '').trim() : '';
  }
  const active = o && o.serial && o.serial !== 'MGMT' && QC_PHASES.includes(ph || o.phase) ? (ph || o.phase) : null;
  if (!active) { if (pill) pill.hidden = true; return; }
  const st = await clFetch(o.serial, active);
  const work = clVariantItems(st.items, S.data.pianos.find(x => x.serial === o.serial) || {}, 'work');
  const doneN = work.filter(it => st.done.has(it.i) || st.skips.has(it.i)).length;
  if (!pill) {
    pill = document.createElement('button');
    pill.id = 'clPill';
    pill.style.cssText = 'position:fixed;bottom:74px;left:12px;z-index:70;background:#9e2020;color:#fff;'
      + 'border:none;border-radius:999px;padding:9px 14px;font:700 12.5px Helvetica,Arial;'
      + 'box-shadow:0 6px 18px rgba(0,0,0,.3);cursor:pointer';
    document.body.appendChild(pill);
  }
  pill.hidden = false;
  pill.textContent = `📋 ${active} checklist · ${doneN}/${work.length}`;
  pill.onclick = () => openWorkChecklist(o.serial, active);
}
async function openWorkChecklist(serial, phase) {
  const p = S.data.pianos.find(x => x.serial === serial) || {serial};
  const st = await clFetch(serial, phase, true);
  const work = clVariantItems(st.items, p, 'work');
  if (!work.length) { alert('No checklist steps found for ' + phase + ' yet.'); return; }
  const coach = /^training/i.test((CLOCK.open && CLOCK.open.phase) || '');
  const old = document.querySelector('.dsheetov'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.className = 'dsheetov';
  document.body.appendChild(ov);
  const close = () => { ov.remove(); updateClPill(); };
  const save = (idx, done) => { st.skips.delete(idx); done ? st.done.add(idx) : st.done.delete(idx); clToggle(serial, phase, idx, done); };
  // a skipped step needs the WHY — it shows amber here and on the mini-QC rail
  const saveSkip = (idx, note) => { st.done.delete(idx); st.skips.set(idx, note); clToggle(serial, phase, idx, true, true, note); };
  let skipAsk = null;   // step index currently being asked for a skip reason
  if (!coach) {
    // A · bench sheet — the whole list, tap to check, ⏭ to skip with a reason
    const render = () => {
      const doneN = work.filter(it => st.done.has(it.i) || st.skips.has(it.i)).length;
      ov.innerHTML = `<div class="dsheet" style="max-height:82vh;overflow:auto"><button class="dsx">✕</button>
        <h3>📋 ${esc(phase)} — ${esc(p.summary || '#' + serial)}</h3>
        <div class="dssub">${doneN}/${work.length} steps · shared with the whole team · from the Restoration Handbook</div>
        <div style="height:8px;background:#efece6;border-radius:4px;overflow:hidden;margin:6px 0 10px">
          <div style="height:100%;width:${work.length ? doneN / work.length * 100 : 0}%;background:linear-gradient(90deg,#c9a227,#2f7d4f)"></div></div>
        ${work.map(it => {
          const isDone = st.done.has(it.i), isSkip = st.skips.has(it.i);
          return `<div style="border-top:1px solid #f0ece5">
          <div class="clstep" data-i="${it.i}" style="display:flex;gap:10px;padding:9px 2px;cursor:pointer">
          <div style="width:20px;height:20px;border-radius:6px;flex:0 0 auto;margin-top:1px;
            ${isDone ? 'background:#2f7d4f;color:#fff;text-align:center;font-weight:700'
              : isSkip ? 'background:#c9a227;color:#fff;text-align:center;font-weight:700'
              : 'border:2px solid #c9c2b6'}">${isDone ? '✓' : isSkip ? '⏭' : ''}</div>
          <div style="flex:1;${isDone ? 'color:#8a847b;text-decoration:line-through' : ''}">
            <span style="font-size:10px;letter-spacing:1px;color:#9e2020;text-transform:uppercase">${esc(it.section)}</span><br>
            ${esc(it.text)}${it.detail && !isDone && !isSkip ? `<div style="font-size:11.5px;color:#9a5b13">⚠ ${esc(it.detail)}</div>` : ''}
            ${isSkip ? `<div style="font-size:11.5px;color:#9a5b13">⏭ skipped — ${esc(st.skips.get(it.i))} <u>undo</u></div>` : ''}</div>
          ${!isDone && !isSkip ? `<button class="clskip" data-i="${it.i}" style="border:1px solid #cfc9bf;background:none;border-radius:8px;padding:3px 8px;color:#9a5b13;font-size:11px;flex:0 0 auto;height:26px">Skip</button>` : ''}
          </div>
          ${skipAsk === it.i ? `<div style="display:flex;gap:6px;padding:0 2px 10px 30px">
            <input class="clskipwhy" placeholder="why can't this step be done here?" maxlength="180"
              style="flex:1;font:500 12.5px/1.3 inherit;padding:6px 8px;border:1.5px solid #c9a227;border-radius:8px">
            <button class="clskipgo csvbtn" style="background:#c9a227">Skip</button></div>` : ''}
          </div>`;
        }).join('')}`;
      ov.querySelector('.dsx').onclick = close;
      ov.onclick = ev => { if (ev.target === ov) close(); };
      ov.querySelectorAll('.clstep').forEach(el => el.onclick = () => {
        const i = +el.dataset.i;
        if (st.skips.has(i)) { save(i, false); skipAsk = null; render(); return; }   // undo skip
        save(i, !st.done.has(i)); skipAsk = null; render();
      });
      ov.querySelectorAll('.clskip').forEach(b => b.onclick = ev => {
        ev.stopPropagation(); skipAsk = +b.dataset.i; render();
        const inp = ov.querySelector('.clskipwhy'); if (inp) inp.focus();
      });
      const sgo = ov.querySelector('.clskipgo');
      if (sgo) sgo.onclick = ev => {
        ev.stopPropagation();
        const inp = ov.querySelector('.clskipwhy');
        const why = (inp.value || '').trim();
        if (!why) { inp.style.borderColor = '#9e2020'; inp.focus(); return; }
        saveSkip(skipAsk, why); skipAsk = null; render();
      };
    };
    render();
  } else {
    // B · coach mode — one step at a time, details front and center
    let idx = work.findIndex(it => !st.done.has(it.i) && !st.skips.has(it.i)); if (idx < 0) idx = work.length - 1;
    let asking = false;   // skip-reason input showing?
    const render = () => {
      const it = work[idx];
      // training shows Brigham's handbook wording VERBATIM (col G), with the
      // short label as a header on top — never a paraphrase (Brigham 9/3)
      const vids = String(it.video || '').split(';;').map(x => x.trim()).filter(Boolean)
        .map(x => { const m = /^([\w-]+)@(\d+)\|?(.*)$/.exec(x); return m ? {id: m[1], t: +m[2], title: m[3]} : null; })
        .filter(Boolean);
      ov.innerHTML = `<div class="dsheet" style="min-height:70vh;max-height:88vh;overflow:auto;display:flex;flex-direction:column"><button class="dsx">✕</button>
        <h3>🎓 ${trainPhaseName(phase)} — ${esc(p.summary || '#' + serial)}</h3>
        <div class="dssub">Step ${idx + 1} of ${work.length} · training mode · from the Restoration Handbook, word for word</div>
        <div style="display:flex;gap:4px;margin:8px 0">${work.map((w, j) =>
          `<i style="height:5px;flex:1;border-radius:2px;background:${st.done.has(w.i) ? '#2f7d4f' : st.skips.has(w.i) ? '#c9a227' : j === idx ? '#c9a227' : '#e4dfd5'}"></i>`).join('')}</div>
        <div style="flex:1">
          <div style="font-size:11px;letter-spacing:1.5px;color:#9e2020;text-transform:uppercase">${esc(it.section)}</div>
          <div style="font-size:17px;line-height:1.35;margin:8px 0;font-weight:800;text-transform:uppercase">${esc(it.text)}</div>
          ${it.handbook
            ? `<div class="clhb" style="font-size:14.5px;line-height:1.6">${glossLinkify(it.handbook)}</div>`
            : `<div style="font-size:15px;line-height:1.5">${glossLinkify(esc(it.text))}</div>`}
          ${vids.map(v => `<div style="margin:10px 0">
            <div style="font-size:11px;letter-spacing:1px;color:#8a847b;text-transform:uppercase;margin-bottom:4px">▶ ${esc(v.title || 'watch')}</div>
            <iframe width="100%" height="200" style="border:0;border-radius:10px"
              src="https://www.youtube-nocookie.com/embed/${esc(v.id)}?start=${v.t}" allowfullscreen
              allow="accelerometer; encrypted-media; picture-in-picture"></iframe></div>`).join('')}
          ${it.detail ? `<div style="background:#fdf3ec;border-left:3px solid #c9a227;padding:8px 10px;border-radius:0 8px 8px 0;font-size:13px;color:#6b5030">⚠ ${esc(it.detail)}</div>` : ''}
          ${/\b(pics?|pictures?|photograph|photos?)\b/i.test((it.handbook || it.text).replace(/<[^>]+>/g, ' '))
            ? `<div style="margin-top:10px"><label class="csvbtn" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px">📷 Take the photo now
                 <input type="file" accept="image/*" capture="environment" hidden class="clshotfile"></label>
               <span class="clshotmsg phmsg" style="display:inline-block;margin-left:8px"></span>
               <div style="font-size:11px;color:#8a847b;margin-top:3px">files straight into this piano's Tech photo folder</div></div>` : ''}
        </div>
        ${st.skips.has(it.i) ? `<div style="background:#fdf6e3;border-radius:8px;padding:8px 10px;font-size:12.5px;color:#9a5b13;margin-top:8px">⏭ This step is skipped — ${esc(st.skips.get(it.i))}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="csvbtn clback" style="background:none;border:1px solid #cfc9bf;color:inherit" ${idx === 0 ? 'disabled' : ''}>‹ Back</button>
          <button class="csvbtn cldone" style="flex:1">${st.done.has(it.i) || st.skips.has(it.i) ? 'Next ›' : '✓ Done — next step'}</button>
        </div>
        ${asking ? `<div style="display:flex;gap:6px;margin-top:8px">
            <input class="clskipwhy" placeholder="why can't this step be done here?" maxlength="180"
              style="flex:1;font:500 12.5px/1.3 inherit;padding:7px 9px;border:1.5px solid #c9a227;border-radius:8px">
            <button class="clskipgo csvbtn" style="background:#c9a227">Skip it</button></div>`
          : !st.done.has(it.i) && !st.skips.has(it.i)
            ? `<button class="clskipask" style="background:none;border:none;color:#9a5b13;font-size:12px;margin-top:8px;text-decoration:underline;cursor:pointer">⏭ Skip</button>` : ''}`;
      ov.querySelector('.dsx').onclick = close;
      const shot = ov.querySelector('.clshotfile');
      if (shot) shot.onchange = async ev2 => {
        const f = ev2.target.files && ev2.target.files[0];
        if (!f) return;
        const sm = ov.querySelector('.clshotmsg');
        const wa = writeAuth();
        if (!wa.ok) { sm.className = 'clshotmsg phmsg err'; sm.textContent = 'Sign in first (☰ menu).'; return; }
        sm.className = 'clshotmsg phmsg'; sm.textContent = 'Uploading…';
        try {
          const dataUrl = await downscalePhoto(f, 2048, 0.85);
          const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
            headers: {'content-type': 'text/plain;charset=utf-8'},
            body: JSON.stringify({pin: wa.pin, action: 'photo', serial, row: p.row,
              stage: phase + ' — ' + it.text.slice(0, 40), mime: 'image/jpeg',
              data: dataUrl.split(',')[1], ...authFields()})});
          const j2 = await r.json();
          if (!j2.saved) throw new Error(j2.error || 'upload failed');
          sm.className = 'clshotmsg phmsg ok'; sm.textContent = '✓ filed to the Tech folder';
        } catch (e2) { sm.className = 'clshotmsg phmsg err'; sm.textContent = '✗ ' + e2.message; }
      };
      ov.querySelector('.clback').onclick = () => { if (idx > 0) { asking = false; idx--; render(); } };
      ov.querySelector('.cldone').onclick = () => {
        if (!st.done.has(it.i) && !st.skips.has(it.i)) save(it.i, true);
        asking = false;
        if (idx < work.length - 1) { idx++; render(); } else close();
      };
      const ask = ov.querySelector('.clskipask');
      if (ask) ask.onclick = () => { asking = true; render(); const i2 = ov.querySelector('.clskipwhy'); if (i2) i2.focus(); };
      const sgo = ov.querySelector('.clskipgo');
      if (sgo) sgo.onclick = () => {
        const inp = ov.querySelector('.clskipwhy');
        const why = (inp.value || '').trim();
        if (!why) { inp.style.borderColor = '#9e2020'; inp.focus(); return; }
        saveSkip(it.i, why); asking = false;
        if (idx < work.length - 1) { idx++; render(); } else close();
      };
    };
    render();
  }
}
/* ---- mini-QC request + C-rail inspection ---- */
async function requestMiniQc(p, nextPhase, was) {
  const r = await fetch(PHASEQC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({key: 'pianoman', op: 'request', serial: p.serial,
      piano: p.summary || '', phase: was, next_phase: nextPhase, by: clockName()})});
  return r.json();
}
async function openQcRail(id) {
  const K = 'sb_publishable_MamcjSX0CHTdYlpKDWSkmQ_-nbuQ1z-';
  const hq = {apikey: K, Authorization: 'Bearer ' + K};
  const reqs = await (await fetch(`https://ismacawxfvvllfinibbf.supabase.co/rest/v1/qc_requests?id=eq.${+id}`, {headers: hq})).json();
  const q = reqs[0];
  if (!q) { alert('QC request not found.'); return; }
  const p = S.data.pianos.find(x => x.serial === q.serial) || {serial: q.serial};
  const st = await clFetch(q.serial, q.phase, true);
  const workItems = clVariantItems(st.items, p, 'work');
  const skippedWork = workItems.filter(it => st.skips.has(it.i));
  let items = clVariantItems(st.items, p, 'qc');
  // phases without a seeded checklist still get inspected — one overall verdict
  if (!items.length) items = [{section: 'Overall', text: q.phase + ' work meets BLP standard'}];
  const canJudge = isOwner() || isTimelogAdmin();
  const old = document.querySelector('.dsheetov'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.className = 'dsheetov';
  document.body.appendChild(ov);
  let live = q;
  let poll = null;
  const close = () => { clearInterval(poll); ov.remove(); };
  const render = () => {
    const v = live.verdicts || {};
    const all = items.length && items.every(it => v[it.text] && v[it.text].verdict === 'pass');
    const anyFail = items.some(it => v[it.text] && v[it.text].verdict === 'fail');
    const settled = live.status !== 'pending';
    ov.innerHTML = `<div class="dsheet" style="max-height:86vh;overflow:auto"><button class="dsx">✕</button>
      <h3>🔍 Mini-QC — ${esc(q.phase)}</h3>
      <div class="dssub">${esc(q.piano || '#' + q.serial)} · requested by ${esc((q.requested_by || '').split(' ')[0])}
        ${settled ? ` · <b style="color:${live.status === 'passed' ? '#2f7d4f' : '#9e2020'}">${live.status.toUpperCase()}</b>` : ''}</div>
      ${skippedWork.length ? `<div style="background:#fdf6e3;border-radius:10px;padding:8px 10px;margin:8px 0">
        <b style="font-size:12px;color:#9a5b13">⏭ Skipped work steps — check the reasons hold up:</b>
        ${skippedWork.map(it => `<div style="font-size:12px;margin-top:4px">• ${esc(it.text)}<br>
          <span style="color:#9a5b13">↳ ${esc(st.skips.get(it.i))}</span></div>`).join('')}</div>` : ''}
      ${items.map(it => {
        const vd = v[it.text];
        return `<div style="padding:9px 2px;border-top:1px solid #f0ece5">
          <div style="display:flex;gap:8px;align-items:flex-start">
            <div style="flex:1"><span style="font-size:10px;letter-spacing:1px;color:#8a847b;text-transform:uppercase">${esc(it.section)}</span><br>${esc(it.text)}</div>
            ${canJudge && !settled ? `<button class="qcp" data-t="${esc(it.text)}" style="border:1.5px solid ${vd && vd.verdict === 'pass' ? '#2f7d4f' : '#cfc9bf'};background:${vd && vd.verdict === 'pass' ? '#eaf5ec' : '#fff'};border-radius:8px;padding:5px 9px;color:#2f7d4f;font-weight:700">✓</button>
              <button class="qcf" data-t="${esc(it.text)}" style="border:1.5px solid ${vd && vd.verdict === 'fail' ? '#9e2020' : '#cfc9bf'};background:${vd && vd.verdict === 'fail' ? '#fdecec' : '#fff'};border-radius:8px;padding:5px 9px;color:#9e2020;font-weight:700">✗</button>`
              : vd ? `<b style="color:${vd.verdict === 'pass' ? '#2f7d4f' : '#9e2020'}">${vd.verdict === 'pass' ? '✓' : '✗'}</b>` : '<span style="color:#c9c2b6">·</span>'}
          </div>
          ${vd && vd.note ? `<div style="font-size:11.5px;color:#9e2020;margin:3px 0 0 2px">↳ ${esc(vd.note)}</div>` : ''}</div>`;
      }).join('')}
      ${canJudge && !settled ? `<div style="display:flex;gap:8px;margin-top:14px">
        <button class="csvbtn qcpass" ${all ? '' : 'disabled style="opacity:.45"'}>✅ Approve — advance to ${esc(q.next_phase)}</button>
        <button class="csvbtn qcback" ${anyFail ? '' : 'disabled'} style="background:#9e2020;${anyFail ? '' : 'opacity:.45'}">🔁 Send back</button></div>` : ''}
      ${!canJudge && !settled ? '<div class="dssub" style="margin-top:10px">Waiting on a manager — this updates live.</div>' : ''}`;
    ov.querySelector('.dsx').onclick = close;
    if (!canJudge || settled) return;
    const sendVerdict = async (item, verdict) => {
      let note = '';
      if (verdict === 'fail') { note = prompt('What needs rework on: ' + item) || ''; if (!note.trim()) return; }
      const r = await fetch(PHASEQC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({key: 'pianoman', op: 'verdict', id: q.id, item, verdict, note, manager: clockName()})});
      const j = await r.json();
      if (j.verdicts) { live.verdicts = j.verdicts; render(); }
    };
    ov.querySelectorAll('.qcp').forEach(b => b.onclick = () => sendVerdict(b.dataset.t, 'pass'));
    ov.querySelectorAll('.qcf').forEach(b => b.onclick = () => sendVerdict(b.dataset.t, 'fail'));
    const fp = ov.querySelector('.qcpass'), fb = ov.querySelector('.qcback');
    const finalize = async outcome => {
      const r = await fetch(PHASEQC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({key: 'pianoman', op: 'finalize', id: q.id, outcome, manager: clockName(), pin: writeAuth().pin || 'pianoman'})});
      const j = await r.json();
      if (j.ok) { live.status = j.status; render(); setTimeout(() => { close(); location.reload(); }, 1600); }
    };
    if (fp && all) fp.onclick = () => finalize('pass');
    if (fb && anyFail) fb.onclick = () => finalize('rework');
  };
  render();
  poll = setInterval(async () => {
    if (live.status !== 'pending') return;
    try {
      const rr = await (await fetch(`https://ismacawxfvvllfinibbf.supabase.co/rest/v1/qc_requests?id=eq.${+id}`, {headers: hq})).json();
      if (rr[0] && JSON.stringify(rr[0]) !== JSON.stringify(live)) { live = rr[0]; render(); }
    } catch (e) {}
  }, 8000);
}
function tryQcLink() {
  const m = /[#&]qc=(\d+)/.exec(location.hash || '');
  if (m) { location.hash = ''; setTimeout(() => openQcRail(+m[1]), 800); }
}
window.addEventListener('hashchange', tryQcLink);
setTimeout(tryQcLink, 2500);

function renderClockChip() {
  try { updateClPill(); } catch (e) {}
  let chip = document.getElementById('clockchip');
  if (!chip) {
    const bar = document.querySelector('.bar');
    if (!bar) return;
    chip = document.createElement('button');
    chip.id = 'clockchip'; chip.className = 'clockchip';
    bar.insertBefore(chip, document.querySelector('.drawerbtn'));
    chip.onclick = () => {
      const o = CLOCK.open; if (!o) return;
      const p = S.data.pianos.find(x => x.serial === o.serial);
      if (p) focusPiano(p);
    };
  }
  const o = CLOCK.open;
  chip.hidden = !o;
  if (o) chip.innerHTML = `<i></i><span class="cctime" data-start="${esc(o.start)}">${clockElapsed(o.start)}</span>
    <span class="ccser">${esc(o.serial)}</span>`;
}
let dockMin = false;   // dock collapsed to a slim pill (so it doesn't cover the zoom controls)
function renderDock() {
  let dock = document.getElementById('mydock');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'mydock'; dock.hidden = true;
    document.body.appendChild(dock);
  }
  const o = CLOCK.open;
  if (!o) { dock.hidden = true; return; }
  dock.hidden = false;
  if (dockMin && !CLOCK.nudged) {   // an idle nudge always expands so it's seen
    dock.classList.add('dockmini');
    dock.innerHTML = `<button class="dockpill" title="expand the work clock">⏱
      <span class="cctime" data-start="${esc(o.start)}">${clockElapsed(o.start)}</span> ▴</button>`;
    dock.querySelector('.dockpill').onclick = () => { dockMin = false; renderDock(); };
    return;
  }
  dock.classList.remove('dockmini');
  const recents = (S.recentRows || []).map(r => S.data.pianos.find(x => x.row === r))
    .filter(x => x && x.serial && x.serial !== o.serial).slice(0, 4);
  dock.innerHTML = `
    ${CLOCK.nudged ? `<div class="docknudge">😴 Quiet for ${NUDGE_MIN} min — still on <b>${esc(o.serial)}</b>?
      <button class="dn-yes">Yes, working</button>
      <button class="dn-out">Clock out at last activity</button></div>` : ''}
    <div class="dockrow">
      <div class="dockinfo"><small>${esc(clockName().split(/\s+/)[0] || 'You')} · ${esc(o.phase || 'working')}</small>
        <b>${esc(o.piano ? o.piano.slice(0, 30) : o.serial)} · #${esc(o.serial)}</b></div>
      <span class="docktimer cctime" data-start="${esc(o.start)}">${clockElapsed(o.start)}</span>
      <button class="dockswitch">Switch ▾</button>
      <button class="dockout">■ Out</button>
      <button class="dockfold" title="minimize — shrink to just the timer">▾</button>
    </div>
    <div class="dockmenu" hidden>
      ${recents.map(x => `<div class="dockopt" data-row="${x.row}">📌 ${esc(x.summary.slice(0, 34))} · #${esc(x.serial)}</div>`).join('')}
      <input class="dockfindin" placeholder="🔍 type a serial, name or spot…" autocomplete="off"
        style="width:100%;box-sizing:border-box;margin:6px 0 2px;padding:8px 10px;border:2px solid #c9a227;border-radius:8px;font:inherit;font-size:13px">
      <div class="dockfindres"></div>
    </div>`;
  const menu = dock.querySelector('.dockmenu');
  dock.querySelector('.dockfold').onclick = () => { dockMin = true; renderDock(); };
  dock.querySelector('.dockswitch').onclick = () => {
    menu.hidden = !menu.hidden;
    // typing happens RIGHT HERE in the menu, not up in the header search
    // (Mark 8/25: keystrokes were landing in the top bar)
    if (!menu.hidden) setTimeout(() => { const i = menu.querySelector('.dockfindin'); if (i) i.focus(); }, 50);
  };
  const dfin = menu.querySelector('.dockfindin'), dres = menu.querySelector('.dockfindres');
  if (dfin) dfin.oninput = () => {
    const q = dfin.value.trim().toLowerCase();
    if (q.length < 2) { dres.innerHTML = ''; return; }
    const hits = S.data.pianos.filter(p => p.active && p.serial && matches(p, q)).slice(0, 6);
    dres.innerHTML = hits.map(x => `<div class="dockopt" data-row="${x.row}">🎹 ${esc(String(x.summary || '').slice(0, 32))} · #${esc(x.serial)}${x.location ? ' · ' + esc(String(x.location)) : ''}</div>`).join('')
      || '<div class="dockopt" style="cursor:default;color:#999">no match</div>';
    dres.querySelectorAll('.dockopt[data-row]').forEach(el => el.onclick = () => {
      menu.hidden = true;
      const p = S.data.pianos.find(x => x.row === +el.dataset.row);
      if (p) { focusPiano(p); lsSet('sec_clock', 'open'); }
    });
  };
  dock.querySelector('.dockout').onclick = async () => {
    const cur = CLOCK.open || {};
    const okOut = await clockConfirm('■', 'Clock out?',
      `<div class="ccfmrow">■ Clock OUT of <b>${esc(String(cur.piano || cur.serial || '').slice(0, 34))} · #${esc(cur.serial || '')}</b>
         <small>${cur.start ? clockElapsed(cur.start) + ' will be logged' : ''}</small></div>`);
    if (!okOut) return;
    const j = await punch('clockout', null, '', 'dock');
    if (j.error) alert(j.error);
  };
  menu.querySelectorAll('.dockopt[data-row]').forEach(el => el.onclick = () => {
    menu.hidden = true;
    const p = S.data.pianos.find(x => x.row === +el.dataset.row);
    if (p) { focusPiano(p); lsSet('sec_clock', 'open'); }
  });
  const ny = dock.querySelector('.dn-yes');
  if (ny) ny.onclick = () => { CLOCK.nudged = false; CLOCK.lastAct = Date.now(); renderDock(); };
  const no = dock.querySelector('.dn-out');
  if (no) no.onclick = async () => {
    const j = await punch('clockout', null, '', 'dock', new Date(CLOCK.lastAct).toISOString());
    if (j.error) alert(j.error); else CLOCK.nudged = false;
  };
}
// live tickers + idle nudge
setInterval(() => {
  document.querySelectorAll('.cctime').forEach(el => { el.textContent = clockElapsed(el.dataset.start); });
  if (CLOCK.open && !CLOCK.nudged && Date.now() - CLOCK.lastAct > NUDGE_MIN * 60000) {
    CLOCK.nudged = true; renderDock();
  }
}, 1000);
['pointerdown', 'keydown'].forEach(ev =>
  addEventListener(ev, () => { CLOCK.lastAct = Date.now(); }, {passive: true}));
setInterval(fetchClock, 60000);
setTimeout(fetchClock, 2500);

/* ---------- 💵 payroll day clock (separate from the per-piano Work Clock) ----
 * One punch for the whole paid day: in on arrival, out when leaving. The
 * bridge keeps a "Payroll Clock" tab; the dashboard card is the only punch
 * surface. State refreshes when the dashboard opens and after every punch. */
const PAY = {open: null, today: [], at: 0};
async function fetchPayroll(force) {
  if (!force && Date.now() - PAY.at < 60000) return;
  try {
    const r = await fetch(BRIDGE_URL + '?fn=payroll', {redirect: 'follow'});
    const j = await r.json();
    if (!j.ok) return;
    PAY.at = Date.now();
    const me = clockName().toLowerCase();
    PAY.open = (j.open || []).find(o => (o.tech || '').toLowerCase() === me) || null;
    PAY.today = (j.today || []).filter(t => (t.tech || '').toLowerCase() === me);
    if (S.view === 'dash') renderDash();
  } catch (e) { /* offline — keep last */ }
}
// soft geofence: grab the phone's location for the punch (6s budget) — the
// punch always goes through; the bridge just notes how far from the store it
// was, and away punches get flagged on the payroll report
function punchGeo() {
  return new Promise(res => {
    if (!navigator.geolocation) return res('unavailable');
    const t = setTimeout(() => res('timeout'), 6000);
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(t); res({lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy}); },
      () => { clearTimeout(t); res('denied'); },
      {enableHighAccuracy: false, timeout: 5500, maximumAge: 120000});
  });
}
async function dayPunch(action) {
  const {pin, ok} = writeAuth();
  if (!ok) return {error: 'Sign in first — payroll hours are logged under your name.'};
  const geo = await punchGeo();
  try {
    const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, action, source: 'dash', geo, ...authFields()})});
    const j = await r.json();
    if (j.ok) {
      PAY.open = action === 'dayin'
        ? (j.open || {tech: clockName(), start: new Date().toISOString()}) : null;
      PAY.at = 0;
      fetchPayroll(true);
    }
    return j;
  } catch (e) { return {error: 'offline — punch not recorded, try again'}; }
}
function payMins() {   // today's closed minutes + the open session so far
  let m = PAY.today.reduce((a, t) => a + (t.minutes || 0), 0);
  if (PAY.open) m += Math.max(0, Math.floor((Date.now() - new Date(PAY.open.start)) / 60000));
  return m;
}
function fmtHM(mins) {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
/* 🏖 Time Off + 🎓 Training requests — Request menu popups. Both file to
 * the report sheet via the bridge, which emails shop@ and texts the
 * managers (Mark; training also texts Jacob). */
const TRAIN_TOPICS = ['Other', 'Store Map app', 'Tuning', 'Chip Tuning', 'DHRT / Regulation',
  'Restringing', 'PRSB & Plate Refinishing', 'Lacquer / Soundboard', 'Refinishing',
  'Key work / Keytops', 'Cabinetry', 'QC & Assembly', 'Piano Moving', 'Safety'];
function startTempPlace(p, floor) {
  S.tempPlace = {row: p.row, serial: p.serial, ghost: null};
  if (S.view !== 'map') switchView('map');
  if (floor != null && floor !== S.floor) { S.floor = floor; renderTabs(); }
  let bar = document.getElementById('tempbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'tempbar';
    document.body.appendChild(bar);
  }
  bar.innerHTML = `📍 Drag the gold square where <b>#${esc(p.serial)}</b> goes
    <button id="tempgo">✓ Place</button><button id="tempcancel">cancel</button>`;
  bar.querySelector('#tempcancel').onclick = () => {
    S.tempPlace = null; bar.remove(); renderMap();
  };
  bar.querySelector('#tempgo').onclick = async () => {
    const job = S.tempPlace;
    if (!job || !job.ghost) return;
    const wa = writeAuth();
    if (!wa.ok) return;
    const btn = bar.querySelector('#tempgo');
    btn.disabled = true; btn.textContent = 'Placing…';
    const locStr = 'Temp spot @' + (S.floor + 1) + 'F ' + Math.round(job.ghost.x) + ',' + Math.round(job.ghost.y);
    try {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'move', serial: p.serial, row: p.row,
          newLocation: locStr, ...authFields()})});
      const j = await r.json();
      if (!j.moved) throw new Error(j.error || 'move failed');
      p.location = locStr;
      S.tempPlace = null; bar.remove();
      renderMap();
      setTimeout(() => focusPiano(p), 200);
    } catch (e) {
      alert('✗ ' + e.message);
      btn.disabled = false; btn.textContent = '✓ Place';
    }
  };
  renderMap();
}
// top-menu version: no piano context, so ask for the serial first
function tempSpotModal() {
  if (!(isAdminUser() || userRole())) { alert('Temp map spots are for managers and admins.'); return; }
  const old = document.querySelector('.dsheetov'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.className = 'dsheetov';
  ov.innerHTML = `<div class="dsheet"><button class="dsx">✕</button>
    <h3>📍 Temp map spot</h3>
    <div class="dssub">Pick the piano and the floor — then drag the gold square where it goes.</div>
    <div class="rfbar"><input type="text" class="ts-serial" placeholder="type the piano's serial #" autocomplete="off" style="flex:1"></div>
    <div class="ts-ac"></div>
    <div class="ts-pick"></div>
    <div class="rfbar">
      <select class="ts-floor">
        <option value="0" ${S.floor === 0 ? 'selected' : ''}>1st floor</option>
        <option value="1" ${S.floor === 1 ? 'selected' : ''}>2nd floor</option>
      </select>
      <button class="csvbtn ts-go" disabled>Place on the map</button></div>
    <div class="ts-msg phmsg"></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.dsx').onclick = () => ov.remove();
  const inp = ov.querySelector('.ts-serial'), ac = ov.querySelector('.ts-ac'),
    pick = ov.querySelector('.ts-pick'), goBtn = ov.querySelector('.ts-go');
  let chosen = null;   // only a real, active piano enables the button
  const choose = p => {
    chosen = p;
    inp.value = p.serial;
    ac.innerHTML = '';
    pick.innerHTML = `<div class="dline">✓ <b>${esc(p.summary || p.serial)}</b>
      <span class="lite" style="color:#8a929a">#${esc(p.serial)} · now at ${esc(p.location || '—')}</span></div>`;
    goBtn.disabled = false;
  };
  inp.oninput = () => {
    const q = inp.value.trim().toLowerCase();
    chosen = null; goBtn.disabled = true; pick.innerHTML = '';
    if (!q) { ac.innerHTML = ''; return; }
    const hits = S.data.pianos
      .filter(p => p.active && p.serial && ((p.serial + ' ' + p.summary).toLowerCase().includes(q)))
      .sort((a, b) => a.serial.toLowerCase().startsWith(q) === b.serial.toLowerCase().startsWith(q)
        ? 0 : a.serial.toLowerCase().startsWith(q) ? -1 : 1)
      .slice(0, 8);
    const exact = hits.find(p => p.serial.toLowerCase() === q);
    if (exact && hits.length === 1) { choose(exact); return; }
    ac.innerHTML = hits.map((p, i) => `<div class="acrow" data-i="${i}">
        <span class="acname">${esc((p.summary || '').slice(0, 34))}</span>
        <span class="acmeta">#${esc(p.serial)}</span></div>`).join('')
      || '<div class="acrow" style="color:#8a929a;cursor:default">no matching piano — serials only</div>';
    ac.querySelectorAll('.acrow[data-i]').forEach(el =>
      el.onmousedown = ev => { ev.preventDefault(); choose(hits[+el.dataset.i]); });
  };
  goBtn.onclick = () => {
    if (!chosen) return;   // typing something not on the list never submits
    const floor = +ov.querySelector('.ts-floor').value;
    ov.remove();
    startTempPlace(chosen, floor);
  };
}
function timeOffModal() {
  const old = document.querySelector('.dsheetov'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.className = 'dsheetov';
  const today = new Date().toLocaleDateString('en-CA');
  ov.innerHTML = `<div class="dsheet"><button class="dsx">✕</button>
    <h3>🏖 Request time off</h3>
    <div class="dssub">Goes to shop@ and texts Mark. Time off is unpaid — get it approved by your supervisor.</div>
    <div class="rfbar"><span class="rfd">first day <input type="date" class="to-start" value="${today}"></span>
      <span class="rfd">last day <input type="date" class="to-end" value="${today}"></span></div>
    <div class="rfbar"><input type="text" class="to-times" placeholder="times, if not the whole day (e.g. 8–noon)" style="flex:1"></div>
    <textarea class="cf-note to-note" rows="3" placeholder="optional notes"></textarea>
    <div class="rfbar"><button class="csvbtn to-send">Send request</button><span class="to-msg phmsg"></span></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.dsx').onclick = () => ov.remove();
  ov.querySelector('.to-send').onclick = async () => {
    const v = c => ov.querySelector(c).value.trim();
    const msg = ov.querySelector('.to-msg');
    if (!v('.to-start')) { msg.textContent = 'pick the first day'; return; }
    msg.textContent = 'sending…';
    const j = await adjustPost({action: 'timeoff', start: v('.to-start'),
      end: v('.to-end') || v('.to-start'), times: v('.to-times'), note: v('.to-note')});
    if (j.error) { msg.textContent = j.error; return; }
    TO.rows = null;
    ov.querySelector('.dsheet').innerHTML =
      '<h3>✅ Request sent</h3><div class="dssub">shop@ has it and Mark got a text — it also shows on your dashboard.</div>';
    setTimeout(() => ov.remove(), 2600);
  };
}
function trainReqModal() {
  const old = document.querySelector('.dsheetov'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.className = 'dsheetov';
  ov.innerHTML = `<div class="dsheet"><button class="dsx">✕</button>
    <h3>🎓 Request training</h3>
    <div class="dssub">Goes to shop@ and texts Mark and Jacob so they can plan it with you.</div>
    <div class="rfbar"><select class="tr-topic">${TRAIN_TOPICS.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
    <textarea class="cf-note tr-note" rows="3" placeholder="optional — what do you want to learn or get better at?"></textarea>
    <div class="rfbar"><button class="csvbtn tr-send">Send request</button><span class="tr-msg phmsg"></span></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.dsx').onclick = () => ov.remove();
  ov.querySelector('.tr-send').onclick = async () => {
    const msg = ov.querySelector('.tr-msg');
    msg.textContent = 'sending…';
    const j = await adjustPost({action: 'trainreq',
      topic: ov.querySelector('.tr-topic').value, note: ov.querySelector('.tr-note').value.trim()});
    if (j.error) { msg.textContent = j.error; return; }
    ov.querySelector('.dsheet').innerHTML =
      '<h3>✅ Request sent</h3><div class="dssub">Mark and Jacob got a text — they\u2019ll line it up in the morning meeting or your queue.</div>';
    setTimeout(() => ov.remove(), 2600);
  };
}
const TO = {rows: null, at: 0};
async function loadTimeOff() {
  try {
    const r = await fetch(BRIDGE_URL + '?fn=timeoffrows', {redirect: 'follow'});
    TO.rows = (await r.json()).rows || [];
    TO.at = Date.now();
  } catch (e) { TO.rows = TO.rows || []; }
  if (S.view === 'dash') renderDash();
  if (S.view === 'report') renderReport();
}
// "my clock is wrong" request — any team member; lands on the 🛠 Time Clock
// Adjustments list for Melissa / the shop managers to correct
function clockFixModal(prefill) {
  const old = document.querySelector('.dsheetov'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.className = 'dsheetov';
  ov.innerHTML = `<div class="dsheet"><button class="dsx">✕</button>
    <h3>🛠 Request a time fix</h3>
    <div class="dssub">Goes straight to the adjustments list — include the day and the correct times.</div>
    <div class="rfbar"><select class="cf-clock">
      <option value="pay">My day clock (payroll)</option>
      <option value="piano">A piano work clock</option></select>
      <input type="text" class="cf-serial" placeholder="piano serial" style="display:none"></div>
    <textarea class="cf-note" rows="4" placeholder="e.g. Forgot to clock out Tuesday — I actually left at 4:30 PM">${esc(prefill || '')}</textarea>
    <div class="rfbar"><button class="csvbtn cf-send">Send request</button><span class="cf-msg phmsg"></span></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.dsx').onclick = () => ov.remove();
  const sel = ov.querySelector('.cf-clock'), ser = ov.querySelector('.cf-serial');
  sel.onchange = () => { ser.style.display = sel.value === 'piano' ? '' : 'none'; };
  ov.querySelector('.cf-send').onclick = async () => {
    const note = ov.querySelector('.cf-note').value.trim();
    const msg = ov.querySelector('.cf-msg');
    if (!note) { msg.textContent = 'describe what needs fixing'; return; }
    msg.textContent = 'sending…';
    const j = await adjustPost({action: 'clockfix', clock: sel.value, serial: ser.value.trim(), note});
    if (j.error) { msg.textContent = j.error; return; }
    ov.querySelector('.dsheet').innerHTML =
      '<h3>✅ Request sent</h3><div class="dssub">It’s on the adjustments list — the fix will show on your dashboard once it’s made.</div>';
    setTimeout(() => ov.remove(), 2600);
  };
}

/* Collapsible Bold Banner sections — header click toggles the body; the
 * open/closed choice is remembered per section for this device, so a tech
 * who never wants Media open keeps it collapsed on every card. */
function secOpen(key, def = true) {
  const v = lsGet('sec_' + key);
  return v == null ? def : v !== 'closed';
}
function secWrap(key, label, content, defOpen = true) {
  const open = secOpen(key, defOpen);
  return `<div class="sechead${open ? '' : ' shut'}" data-sec="${key}">${label}
      <i class="secarrow">${open ? '▾' : '▸'}</i></div>
    <div class="secbody${open ? '' : ' closed'}" data-sec="${key}">${content}</div>`;
}
function popHTML(p) {
  const st = pianoStatus(p);
  const ti = tuningInfo(p);
  const tags = {in: 'IN PLACE', new: 'NEW', sched: 'SCHEDULED', move: 'IN TRANSIT',
                coming: 'COMING SOON', rented: 'RENTED',
                tune: 'TUNING CAL', sale: 'FOR SALE'};
  // title: year (col E) then make/model; fall back to the summary as-is
  const base = [p.make, p.model].filter(Boolean).join(' ');
  const makeModel = base ? (p.year ? p.year + ' ' + base : base) : p.summary;
  const queueChip = p.queuePos
    ? `<span class="qchip" title="Custom Shop Work queue">Queue #${p.queuePos}/${p.queueTotal}</span>`
    : '';
  const mover = p.serial
    ? `<div class="movebox">
         <input class="mvin" placeholder="new spot #" maxlength="12">
         <button class="mvgo">Update</button>
       </div><div class="mvmsg"></div>
       <div class="movebox cabbox">
         <input class="cabin" placeholder="cabinetry # — 8-3, 5-RF…" maxlength="6">
         <button class="mvgo cabgo2">Add</button>
       </div>`
    : `<div class="mvmsg">No serial # — change location in the Piano Log.</div>`;
  // shop queue reorder: row order in Custom Shopwork IS the queue, so setting
  // a new number physically moves the piano's row in the Piano Log
  const queuer = p.queuePos
    ? (p.serial
      ? `<div class="movebox">
           <input class="mvin qin" type="number" min="1" max="${p.queueTotal}" step="1"
                  value="${p.queuePos}" title="Shop queue position (1 = next up)">
           <button class="mvgo qgo">Set queue #</button>
         </div><div class="mvmsg qmsg"></div>`
      : `<div class="mvmsg">No serial # — reorder the queue in the Piano Log.</div>`)
    : '';
  const tuner = '';   // tuning now lives in the Request menu
  const photo = p.serial
    ? `<button class="photobtn">📸 Add progress photo</button>
       <input type="file" class="photoin" accept="image/*" hidden>
       <div class="photomsg"></div>`
    : '';
  const effPh = effectivePhase(p);
  const tp = trackParts(p.track);
  const cur = tp.list;
  const tracker = p.serial
    ? `<div class="row trkrow">Track
         <span class="trkchips">${TRACKS.map(t =>
           `<button class="trk ${cur.includes(t) ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}
         </span></div>${cur.includes('Misc') ? `<div class="miscsum">Misc: ${esc(tp.miscNote || '—')}
           <button class="miscedit" title="edit">✎</button></div>` : ''}<div class="trkmsg phmsg"></div>`
    : '';
  const phaser = p.serial
    ? `<div class="row phrow">Shop phase
         <select class="phsel">
           <option value="">— none —</option>
           <option value="In Queue" ${effPh === 'In Queue' ? 'selected' : ''}>0 · In Queue</option>
           ${phaseOptions(p, effPh).map((ph, i) =>
             `<option value="${esc(ph)}" ${effPh === ph ? 'selected' : ''}>${i + 1} · ${esc(ph)}</option>`).join('')}
           ${PHASE_STATES.filter(ph => ph !== 'In Queue').map(ph =>
             `<option value="${esc(ph)}" ${effPh === ph ? 'selected' : ''}>${esc(ph)}</option>`).join('')}
         </select></div>${gotoLine(p, effPh)}<div class="phmsg"></div>
       ${(p.phaseNotes || '').trim() ? `<div class="phnhist" style="font-size:11px;color:#6f6a63;background:#faf8f4;border-radius:6px;padding:6px 9px;margin:4px 0;white-space:pre-wrap">📝 ${esc(String(p.phaseNotes).slice(0, 500))}</div>` : ''}
       <div class="row phrow colorow">Colors
         <span style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">
           <input class="colorpick" maxlength="80" placeholder="first pick — refinish/plating color + sheen"
             value="${esc(p.colorPick || '')}">
           <input class="colorfinal" maxlength="80" placeholder="FINAL color — after the client approves"
             value="${esc(p.colorFinal || '')}">
         </span></div><div class="colormsg phmsg"></div>`
    : '';
  // opt-IN: blank asks, Yes shows the history button, No shows nothing at all
  const crVal = (p.clientReports || '').trim().toLowerCase();
  let crAsk = '';
  if (crVal === 'yes') {
    crAsk = `<div class="crask"><span class="croff">✕ no client reports</span><span class="crmsg"></span></div>`;
  } else if (crVal !== 'no') {
    crAsk = `<div class="crask">Client reports for this piano?
      <button class="crbtn cryes">Yes</button><button class="crbtn crno">No</button>
      <span class="crmsg"></span></div>`;
  }
  const ownerLine = [ownerNameOf(p), ownerCityStateOf(p)].filter(Boolean).join(' — ') || '—';
  const pct = shopProgressPct(p);
  const payBar = (p.serial && inShopwork(p)) ? (() => {
    const next = PAY_MILESTONES.find(m => pct < m);
    return `<div class="row rowflex"><span>Shop progress</span><b>${pct}%</b></div>
      <div class="pbar"><i style="width:${pct}%"></i><s style="left:25%"></s><s style="left:50%"></s><s style="left:75%"></s></div>
      <div class="pbarlbl">${next ? `next payment milestone at ${next}%` : 'all payment milestones reached'}${+p.payMilestone ? ` · last emailed at ${esc(p.payMilestone)}%` : ''}</div>`;
  })() : '';
  const asDone = adminStepsOf(p);
  const admin = p.serial ? secWrap('admin', '🔐 Admin', `
    ${crVal === 'yes' ? `<div class="tagbtns histbtns"><button class="tagbtn creports">🤝 Client Reports History</button></div>` : ''}
    ${crAsk}
    <div class="row rowflex payrow"><span>Payment plan</span>
      <select class="paysel"><option value="">— not set —</option>
        ${PAY_PLANS.map(o => `<option ${p.payPlan === o ? 'selected' : ''}>${o}</option>`).join('')}
      </select></div><div class="paymsg phmsg"></div>
    <div class="row" title="the client's admin journey — tap a step to mark it done">Admin steps
      <b>${asDone.length}/${ADMIN_STEPS.length}</b></div>
    <div class="adminsteps">${ADMIN_STEPS.map((s, i) => {
      const on = asDone.includes(s);
      return `<button class="astep ${on ? 'on' : ''}" data-as="${esc(s)}"><i>${on ? '✓' : i + 1}</i>${esc(s)}</button>`;
    }).join('')}</div><div class="asmsg phmsg"></div>
    ${payBar}`) : '';
  const typeBtns = p.serial
    ? `<span class="trkchips hdrtype" title="wrong icon on the map? tap the correct type — digitals are marked as uprights">
        ${['grand', 'upright'].map(t =>
          `<button class="trk typebtn ${p.type === t ? 'on' : ''}" data-type="${t}">${t === 'grand' ? '🎹 Grand' : '🎼 Upright'}</button>`).join('')}
        ${p.typeOverride ? `<button class="trk typebtn typeclear" data-type="" title="clear override">✕</button>` : ''}
      </span>`
    : '';
  return `<div class="popgrip l" title="drag to resize"></div><div class="popgrip r" title="drag to resize"></div>
    <div class="popsticky">
    <span class="x">✕</span>
    <span class="shr" title="share this piano — text it to a teammate">↗</span>
    <span class="tag ${st}">${tags[st]}</span>
    <h3>${esc(makeModel)}</h3>
    <div class="row rowflex"><span>Serial # <b>${esc(p.serial || '—')}</b></span>${typeBtns}</div>
    <div class="typemsg phmsg"></div>
    ${preQueue(p) ? `<div class="pqwarn">⚠️ <b>PRE-QUEUE</b> — deposit not received. No work is approved on this piano yet.
      ${isAdminUser() ? `<button class="pqapprove">✅ Approve for queue</button>` : `<i>admin / manager approval required to start work</i>`}
      <span class="pqmsg"></span></div>` : ''}
    ${(p.tempEntry || '').trim() ? `<div class="tempbanner">🆕 <b>TEMP ENTRY</b> — ${esc(p.tempEntry)} · awaiting admin approval
      ${(isPayrollAdmin() || isTimelogAdmin()) ? `<span class="tempbtns">
        <button class="tempok">✅ Approve</button>
        <button class="tempno">🗑 Not real</button></span>` : ''}
      <span class="tempmsg"></span></div>` : ''}
    ${p.serial ? ((p.importantNote || '').trim()
      ? `<div class="impnote">❗ <b>IMPORTANT</b> <span class="imptxt">${esc(p.importantNote)}</span>
           <button class="impedit" title="edit / clear">✎</button><span class="impmsg"></span></div>`
      : `<div class="impadd"><button class="impedit">❗ Add IMPORTANT note</button><span class="impmsg"></span></div>`) : ''}
    ${p.serial ? (() => {
      // at-a-glance status strip (Brigham 9/3): current phase + wait note +
      // check-back + freshest phase note, visible without scrolling
      const waiting = /^waiting/i.test(effPh || '');
      const lastNote = String(p.phaseNotes || '').trim().split('\n').filter(Boolean).pop() || '';
      return `<div class="statstrip" style="background:${waiting ? '#fdf3ec' : '#f4f1ec'};border:1px solid ${waiting ? '#eecfae' : '#dfe3e8'};border-radius:8px;padding:7px 10px;margin:6px 0;font-size:12.5px;line-height:1.5">
        <b style="color:${waiting ? '#9a5b13' : '#2b2f33'}">${waiting ? '⏳ ' : '🔧 '}${esc(effPh || (p.queuePos ? 'In Queue' : 'no phase'))}</b>
        ${waiting && (p.waitNote || '').trim() ? ' — ' + esc(p.waitNote) : ''}
        ${waiting && (p.checkBack || '').trim() ? ` · <b>check back ${esc(p.checkBack)}</b>` : ''}
        ${!waiting && lastNote ? `<span style="color:#6f6a63"> — 📝 ${esc(lastNote.slice(0, 140))}</span>` : ''}
      </div>`;
    })() : ''}
    </div>
    <div class="row">Owner <b>${esc(ownerLine)}</b></div>
    <div class="row">Status <b>${esc(p.status || '—')}</b></div>
    ${p.serial && tbAdmin() && effectivePhase(p) === 'For Sale' ? `<div class="row trkrow">💼 Leads
      <span class="trkchips leadchips"><i class="lite">…</i></span></div>
      <div class="leadmsg phmsg"></div>` : ''}
    ${effectivePhase(p) === 'For Sale'
      ? `<div class="row rowflex"><span>Price <b class="pricecard">${priceLabel(p) ? esc(priceLabel(p)) : '—'}</b></span>
           ${p.serial && isAdminUser() ? `<button class="predit">${p.price ? '✎ Edit price' : '＋ Add price'}</button>` : ''}</div>`
      : (priceLabel(p) ? `<div class="row">Price <b class="pricecard">${esc(priceLabel(p))}</b></div>` : '')}

    ${p.serial ? (() => {
      const mine = CLOCK.open;
      const onThis = mine && mine.serial === p.serial;
      // everyone ELSE with an open session on this piano — pairing up is
      // fine (training, two-person jobs), but flag it so a missed switch
      // is easy to spot (Brigham 8/28)
      const others = (CLOCK.all || []).filter(o => o.serial === p.serial
        && (o.tech || '').toLowerCase() !== clockName().toLowerCase());
      const together = others.length ? `<div class="clkothers">👥 Also clocked in here:
          ${others.map(o => `<b>${esc((o.tech || '').split(/\s+/)[0] || o.tech)}</b>
            <span class="cctime" data-start="${esc(o.start)}">${clockElapsed(o.start)}</span>`).join(' · ')}
          <small>working together is fine — if this looks like a missed switch, tell a manager</small></div>` : '';
      if (onThis) return secWrap('clock', '⏱ Work Clock', `
        <div class="row rowflex"><span>Working on</span><b>${esc(mine.phase || '—')}</b></div>
        ${together}
        <button class="clkbtn clkout">■ Clock out — <span class="cctime" data-start="${esc(mine.start)}">${clockElapsed(mine.start)}</span></button>
        <div class="clkmsg phmsg"></div>`);
      const opts = (pianoPhases(p) || PHASES).concat(PHASE_STATES);
      return secWrap('clock', '⏱ Work Clock', `
        ${together}
        ${mine ? `<div class="clkwarn">⏱ You're on <b>#${esc(mine.serial)}</b>
          <span class="cctime" data-start="${esc(mine.start)}">${clockElapsed(mine.start)}</span> — clocking in here closes it.</div>` : ''}
        <div class="row rowflex"><span>What work?</span>
          <select class="clkphase">
            <option value="">— select the work —</option>
            <option value="__other__">✏️ Other — write it in…</option>
            <option value="Admin / Misc">📋 Admin / Misc</option>
            <option value="Moving">🚚 Moving</option>
            <option value="Rework">🔁 Rework — fixing earlier work</option>
            <option value="" disabled>— shop phases —</option>
            ${opts.map(ph => `<option value="${esc(ph)}">${esc(ph)}</option>`).join('')}
          </select></div>
        <input class="clkother" placeholder="what are you doing on this piano?" maxlength="60" hidden>
        <label class="row clktrainrow" style="gap:8px;cursor:pointer;align-items:center">
          <input type="checkbox" class="clktrain" style="width:17px;height:17px">
          <span>🎓 Training clock-in <small class="lite">— trainer AND trainee both check this</small></span></label>
        <input class="clktrainee" placeholder="training with whom? (name)" maxlength="40" autocomplete="off" hidden>
        <button class="clkbtn clkin off">▶ ${mine ? 'Switch here' : 'Clock in'}</button>
        <div class="clkmsg phmsg"></div>`);
    })() : ''}
    ${secWrap('loc', '📍 Locations', `
    <div class="row rowflex"><span>Map #</span><b class="mapnum">${esc(p.location || '—')}</b></div>
    ${p.queuePos ? `<div class="row rowflex"><span>Queue #</span>${queueChip}</div>` : ''}
    ${mover}
    ${queuer}
    ${p.serial ? `<div class="row trkrow">Cabinetry
        <span class="trkchips cabchips">${cabTokens(p).map(t =>
          `<span class="cabchip" title="${esc(cabPretty(t))}">${esc(t)}<i class="cabdel" data-t="${esc(t)}">✕</i></span>`).join('')}
          <button class="cabadd">＋ shelf</button>
        </span></div><div class="cabmsg phmsg"></div>` : ''}
    ${p.serial ? `<div class="row rowflex"><span>🪑 Bench</span><b class="benchloc">${esc(p.benchLoc || '—')}</b></div>
    <div class="movebox benchbox">
        <input class="bnin" placeholder="bench location — spot #, shelf…" maxlength="40"
          value="${esc(p.benchLoc || '')}">
        <button class="mvgo bnshot" title="photo of the bench → Tech folder">📸</button>
        <button class="mvgo benchtag" title="printable bench tag">🖨</button>
      </div><div class="bnmsg phmsg"></div>
      <input type="file" class="bnfile" accept="image/*" hidden>` : ''}
    ${p.serial ? `<button class="lhbtn">🕘 Location history</button><div class="lhout"></div>` : ''}`)}

    ${(body => p.serial ? secWrap('shop', '🔨 Shop Progress', body) : body)(`
    ${tracker}
    ${p.serial ? `<div class="row trkrow" title="key-top service — tap each that applies">Keys
        <span class="trkchips">${KEY_SERVICE.map(t =>
          `<button class="trk keybtn ${keyTokens(p).includes(t) ? 'on' : ''}" data-k="${t}">${esc(t)}</button>`).join('')}
        </span></div><div class="keymsg phmsg"></div>` : ''}
    ${phaser}
    ${tasksBox(p)}
    ${(p.phase || '').startsWith('Waiting') ? `<div class="row waitnote">Waiting on
        <b>${esc(p.waitNote || p.phase.replace('Waiting on ', ''))}</b>
        ${p.checkBack ? `<span class="wncb">· check back <b class="snzcur">${esc(p.checkBack)}</b></span>` : ''}
      </div>
      ${p.serial ? `<div class="row rowflex snzrow"><span class="snzlbl">${p.checkBack ? 'Re-snooze' : 'Check back in'}</span>
        <span class="snzbtns"><button class="snz" data-d="3">+3d</button><button class="snz" data-d="7">+1w</button><button class="snz" data-d="14">+2w</button><button class="snz" data-d="30">+1m</button></span>
      </div><div class="snzmsg phmsg"></div>` : ''}` : ''}
    ${p.serial ? `<div class="tagbtns histbtns"><button class="tagbtn rreports">📄 Tech Reports History</button></div>` : ''}`)}

    ${p.serial ? secWrap('tune', '🎵 Tuning', `
      <div class="row">Last tuned <b>${ti.last ? esc(fmtDayYear(ti.last)) + ' · ' + daysSince(ti.last) + 'd ago' : '— none on record (18-mo calendar scan)'}</b></div>
      ${ti.next ? `<div class="row">Scheduled <b class="tunesched">🎵 ${esc(fmtDay(ti.next.date))} · ${esc(ti.next.time)}</b></div>`
                : `<div class="row" style="opacity:.75">Nothing scheduled</div>`}
      ${(ti.hist || []).length ? `<div class="row" style="margin-top:6px;font-size:12px;opacity:.85">History:</div>
        <div style="font-size:12px;line-height:1.7">${ti.hist.slice(-8).reverse().map(r =>
          `<div>${esc(fmtDayYear(r[0]))} — ${esc(r[2])}</div>`).join('')}</div>` : ''}`) : ''}

    ${(body => p.serial ? secWrap('media', '📷 Media', body) : body)(`
    ${mediaCard(p)}
    ${photo}`)}

    ${p.serial ? secWrap('pw', '📁 Paperwork', paperworkCard(p)) : ''}

    ${admin}

    ${p.serial ? `<button class="tunebtn reqbtn" style="margin-top:10px">📨 Request… ▾</button>
      <div class="reqmenu" hidden>
        <button data-req="move">🚚 Move</button>
        <button data-req="tune">🎵 Tuning</button>
        <button data-req="service">🔧 Service</button>
        <button data-req="curtis">🎨 Curtis Harper</button>
        <button data-req="admin">📋 Admin</button>
        <button data-req="touchup">🖌 Touch Up</button>
        <button data-req="price">💲 Price Change</button>
        <button data-req="priority">⚡ Priority Scheduling</button>
        <button data-req="brigham">🗒 Brigham Task</button>
        ${(isAdminUser() || userRole()) ? `<button data-req="tempspot">📍 Temp map spot</button>` : ''}
        <button data-req="dup" class="reqdanger">🗑 Mark as Duplicate</button>
      </div>` : ''}
    <div class="tagbtns">
      ${priceLabel(p) ? `<a class="tagbtn" target="_blank" rel="noopener"
        href="${priceTagUrl(p)}">🏷 Price tag ↗</a>` : ''}
      ${p.serial ? `<button class="tagbtn shoptag">🖨 Shop tag</button>` : ''}
      ${p.serial ? `<button class="tagbtn benchtag">🪑 Bench tag</button>` : ''}
      ${(() => {
        const sn = tagSnapOf(p);
        if (!sn) return '';
        const drift = tagSnapDrift(p, sn).length;
        return `<button class="tagthumb ${drift ? 'stale' : ''}"
          title="${drift ? 'Tag on the piano is out of date \u2014 click to see it' : 'The tag currently taped to this piano \u2014 click to enlarge'}">
          <span class="tagrender">${shopTagInner(sn.d)}</span>
          ${drift ? '<i>\u26a0</i>' : ''}</button>`;
      })()}
    </div>
    ${p.serial ? secWrap('notes', '📝 Notes', `
      <div class="movebox notebox">
        <input class="pnin" placeholder="add a note about this piano…" maxlength="240">
        <button class="mvgo pngo">Add</button>
      </div><div class="pnmsg phmsg"></div>
      <div class="noteslist">${(() => {
        const lines = String(p.pianoNotes || '').split('\n').map(s => s.trim()).filter(Boolean);
        if (!lines.length) return '<div class="pwnone" style="display:block;padding:3px 0 4px">No notes yet — anything typed here stays on the piano.</div>';
        return lines.slice(0, 30).map(L => {
          const m = /^(\d{1,2}\/\d{1,2})\s+([^:]{1,40}):\s*([\s\S]*)$/.exec(L);
          return m ? `<div class="noterow"><b>${esc(m[3])}</b><small>${esc(m[2])} · ${esc(m[1])}</small></div>`
                   : `<div class="noterow"><b>${esc(L)}</b></div>`;
        }).join('');
      })()}</div>`, false) : ''}
    ${p.serial ? secWrap('act', '🕘 Activity Log', `
      <p class="pd" style="margin:0 0 6px">Automatic record of work on this piano — phases, moves,
        photos, tags printed. Typed notes live in 📝 Notes above.</p>
      <div class="actlist"></div>
      <button class="tagbtn actload">🕘 Load this piano's activity log</button>`, false) : ''}
    ${isAdminUser() ? secWrap('log', '📖 Piano Log', logExtrasBody(p), false) : ''}`;
}
/* Everything the Piano Log row holds that the card doesn't already show,
 * keyed by the sheet's own column headers (server sends only non-empty
 * cells). Default-collapsed — it can be a long list. */
function logExtrasBody(p) {
  const ex = p.logExtras || {};
  const rows = Object.keys(ex).map(k => {
    const v = String(ex[k]);
    return (v.length > 58 || v.includes('\n'))
      ? `<div class="lxrow lxlong"><div class="lxk">${esc(k)}</div><div class="lxv">${esc(v)}</div></div>`
      : `<div class="row rowflex"><span class="lxk">${esc(k)}</span><b class="lxv1">${esc(v)}</b></div>`;
  }).join('');
  return `<div class="lxbox">
    ${rows || '<div class="pwnone" style="display:block;padding:3px 0 6px">Nothing else is recorded in the Piano Log for this piano.</div>'}
    <div class="tagbtns"><span class="btn">Open Piano Log row ↗</span></div>
  </div>`;
}
const fmtDay = iso => new Date(iso + 'T12:00')
  .toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'});
// last-tuned dates can be a year+ back, so they always carry the year
const fmtDayYear = iso => new Date(iso + 'T12:00')
  .toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'});
function wirePop(p) {
  const pop = $('#pop');
  pop.onclick = ev => {
    if (ev.target.closest('.x')) { pop.hidden = true; popPinned = false; return; }
    if (ev.target.closest('.shr')) { sharePiano(p); return; }
    // only the explicit "Open Piano Log" button navigates — every other
    // control on the card (tuning, phases, media, tags, move) stays put
    if (!ev.target.closest('.btn')) return;
    window.open(logLink(p), '_blank', 'noopener');
  };
  const cgo = pop.querySelector('.cabgo2');
  if (cgo) cgo.onclick = ev => {
    ev.stopPropagation();
    const inp = pop.querySelector('.cabin');
    const tok = parseCabToken(inp.value);
    const msg = pop.querySelector('.cabmsg');
    if (!tok) {
      if (msg) { msg.className = 'cabmsg phmsg err'; msg.textContent = 'Format: rack‑shelf, e.g. 8‑3 · or rack‑side‑shelf, e.g. 5‑RF (racks 6 & 8 have no side).'; }
      return;
    }
    const list = cabTokens(p);
    if (!list.includes(tok)) list.push(tok);
    inp.value = '';
    saveCabinetry(p, list, pop);
  };
  const go = pop.querySelector('.mvgo:not(.qgo)');
  if (go) go.onclick = () => movePiano(p, pop.querySelector('.mvin:not(.qin)').value.trim(), pop);
  const inp = pop.querySelector('.mvin:not(.qin)');
  if (inp) {
    // only-real-spots autocomplete: suggest as they type, reject the rest
    const mbox = inp.closest('.movebox');
    let ac = mbox && mbox.querySelector('.spotac');
    if (mbox && !ac) { ac = document.createElement('div'); ac.className = 'spotac'; ac.hidden = true; mbox.appendChild(ac); }
    const renderAc = () => {
      const q = inp.value.trim().toLowerCase();
      if (!q || !ac) { if (ac) ac.hidden = true; return; }
      const all = moveDests();
      const hits = all.filter(d => d.toLowerCase().startsWith(q))
        .concat(all.filter(d => !d.toLowerCase().startsWith(q) && d.toLowerCase().includes(q)))
        .slice(0, 8);
      ac.innerHTML = hits.length
        ? hits.map(h => `<div class="spotopt" data-v="${esc(h)}">${esc(h)}</div>`).join('')
        : '<div class="spotnone">no spot matches \u2014 check the number</div>';
      ac.hidden = false;
    };
    inp.addEventListener('input', renderAc);
    inp.addEventListener('focus', renderAc);
    inp.addEventListener('blur', () => setTimeout(() => { if (ac) ac.hidden = true; }, 250));
    if (ac) ac.onmousedown = e => {
      const o = e.target.closest('.spotopt');
      if (!o) return;
      e.preventDefault();
      inp.value = o.dataset.v;
      ac.hidden = true;
    };
  }
  if (inp) inp.onkeydown = e => {
    if (e.key === 'Enter') movePiano(p, inp.value.trim(), pop);
  };
  const qgo = pop.querySelector('.qgo');
  if (qgo) qgo.onclick = () => queuePiano(p, parseInt(pop.querySelector('.qin').value, 10), pop);
  const qin = pop.querySelector('.qin');
  if (qin) {
    qin.onclick = ev => ev.stopPropagation();
    qin.onkeydown = e => { if (e.key === 'Enter') queuePiano(p, parseInt(qin.value, 10), pop); };
  }

  // color selections (Brigham 8/26): first pick + client-approved final —
  // admin-entered, mirrored into the Concurrent Work report categories
  pop.querySelectorAll('.colorpick, .colorfinal').forEach(ci => {
    ci.onclick = ev => ev.stopPropagation();
    ci.onchange = async () => {
      const msg = pop.querySelector('.colormsg');
      const {pin, ok} = writeAuth();
      if (!ok) { msg.textContent = 'Sign in first.'; return; }
      msg.textContent = 'Saving…';
      try {
        const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
          headers: {'content-type': 'text/plain;charset=utf-8'},
          body: JSON.stringify({pin, action: 'setcolor', serial: p.serial, row: p.row,
            which: ci.classList.contains('colorfinal') ? 'final' : 'pick',
            value: ci.value.trim(), ...authFields()})});
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'save failed');
        if (ci.classList.contains('colorfinal')) p.colorFinal = ci.value.trim();
        else p.colorPick = ci.value.trim();
        msg.className = 'colormsg phmsg ok'; msg.textContent = '✓ saved';
        setTimeout(() => { if (msg.isConnected) msg.textContent = ''; }, 1600);
      } catch (e) { msg.className = 'colormsg phmsg err'; msg.textContent = '✗ ' + e.message; }
    };
  });

  const plsel = pop.querySelector('.platesel');
  if (plsel) plsel.onchange = async () => {
    const msg = pop.querySelector('.platemsg');
    const {pin, ok} = writeAuth();
    if (!ok) { msg.textContent = 'Sign in first.'; return; }
    plsel.disabled = true; msg.textContent = 'Saving…';
    try {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin, action: 'setplatestatus', serial: p.serial, row: p.row,
          plateStatus: plsel.value, ...authFields()})});
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      p.plateStatus = plsel.value;
      msg.textContent = '✓ saved';
      setTimeout(() => { if (msg.isConnected) msg.textContent = ''; }, 1800);
    } catch (e) { msg.textContent = '✗ ' + e.message; }
    plsel.disabled = false;
  };
  // keytop status dropdown (+ queue position when "In Key Queue")
  const ksel = pop.querySelector('.keystatsel');
  const knum = pop.querySelector('.keyqnum');
  if (ksel) {
    const saveKeytop = async () => {
      const msg = pop.querySelector('.keystatmsg');
      const {pin, ok} = writeAuth();
      if (!ok) { msg.textContent = 'Sign in with Google (menu) first.'; return; }
      const n = knum && !knum.hidden ? String(knum.value || '').trim() : '';
      const val = ksel.value === 'In Key Queue'
        ? 'In Key Queue' + (n ? ' #' + n : '') : ksel.value;
      msg.textContent = 'saving…';
      ksel.disabled = true;
      try {
        const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
          headers: {'content-type': 'text/plain;charset=utf-8'},
          body: JSON.stringify({pin, action: 'setkeystatus', serial: p.serial, row: p.row,
            value: val, ...authFields()})});
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        p.keytopStatus = val;
        msg.textContent = '✓ saved';
        setTimeout(() => { if (msg.isConnected) msg.textContent = ''; }, 1800);
      } catch (e) { msg.textContent = '✗ ' + e.message; }
      ksel.disabled = false;
    };
    ksel.onclick = ev => ev.stopPropagation();
    ksel.onchange = () => {
      if (knum) {
        knum.hidden = ksel.value !== 'In Key Queue';
        if (!knum.hidden && !knum.value) { knum.focus(); return; }  // saves once the # is typed
      }
      // 📸 keytops can't be marked Done without a progress photo (Brigham 8/28)
      if (ksel.value === 'Done') {
        keytopPhotoGate(p, {
          title: '📸 Keytops — finish with a photo',
          sub: `Add a progress photo of the finished keytops on <b>${pianoLabel(p)}</b>
            before marking them <b>Done</b> — it files to the Tech folder for QC,
            marketing and the client's progress updates.`,
          stage: 'Keytops done',
          goLabel: 'Mark keytops Done ✓',
          cancelLabel: 'Cancel',
          onGo: saveKeytop,
          onCancel: () => { ksel.value = keytopParts(p).state || ''; },
        });
        return;
      }
      saveKeytop();
    };
    if (knum) {
      knum.onclick = ev => ev.stopPropagation();
      knum.onchange = saveKeytop;
    }
  }
  // shared saver for the bass/decals Piano Log cells
  const saveTaskCell = async (key, val) => {
    const msg = pop.querySelector('.bassmsg-' + key);
    msg.textContent = 'saving…';
    try {
      const wa = writeAuth();
      if (!wa.ok) throw new Error('Sign in with Google (menu) first.');
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'settaskcell', which: key,
          serial: p.serial, row: p.row, value: val, ...authFields()})});
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'failed');
      p.tasks = p.tasks || {}; p.tasks[key] = val;
      openPop(p.row, S.popAnchor, true);
    } catch (e) { msg.textContent = '✗ ' + e.message; }
  };
  // 🏷 decals — dropdown marks Ordered / Received / In Stock / Installed
  const dsel = pop.querySelector('.decalsel');
  if (dsel) {
    dsel.onclick = ev => ev.stopPropagation();
    dsel.onchange = () => {
      const pick = dsel.value;
      dsel.value = '';
      if (!pick) return;
      popPinned = true;
      const ms = taskCellMarks(p, 'decals', DECAL_MARKS);
      if (pick === '__clear__') DECAL_MARKS.forEach(n => { ms[n] = ''; });
      else {
        const today = new Date().toLocaleDateString('en-US',
          {month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'America/Denver'});
        ms[pick] = ms[pick] ? '' : today;          // toggle: stamp today / un-mark
      }
      saveTaskCell('decals', taskCellValue(ms, DECAL_MARKS));
    };
  }
  // 🎼 bass strings — Ordered / Received open a small editor: pick the real
  // date (parts often arrive before they're marked) and who did it (the
  // marker isn't always the receiver) — Brigham 8/28
  const bassSave = async (key, val, msg) => {
    const wa = writeAuth();
    if (!wa.ok) { msg.textContent = 'Sign in with Google (menu) first.'; return; }
    msg.textContent = 'saving…';
    try {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'settaskcell', which: key,
          serial: p.serial, row: p.row, value: val, ...authFields()})});
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'failed');
      p.tasks = p.tasks || {}; p.tasks[key] = val;
      openPop(p.row, S.popAnchor, true);
    } catch (e) { msg.textContent = '✗ ' + e.message; }
  };
  pop.querySelectorAll('.bassbtn').forEach(b => b.onclick = ev => {
    ev.stopPropagation(); popPinned = true;
    const key = b.dataset.task, k = b.dataset.k;
    const msg = pop.querySelector('.bassmsg-' + key);
    const ms = taskCellMarks(p, key, ['Ordered', 'Received']);
    // M/D/YY ↔ ISO for the date input
    const toIso = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(s || '').trim());
      if (!m) return new Date().toLocaleDateString('sv-SE', {timeZone: 'America/Denver'});
      return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); };
    const toShort = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
      return m ? (+m[2]) + '/' + (+m[3]) + '/' + m[1].slice(2) : iso; };
    const me = (clockName() || '').split(/\s+/)[0];
    const names = [...new Set([me, ...Object.keys(TB_HEADSHOTS).map(n =>
      n.split(' ')[0].replace(/^./, c => c.toUpperCase()))])].filter(Boolean).sort();
    const ov2 = modalShell('bassmodal', `
      <span class="x">✕</span>
      <h3>${k === 'Ordered' ? '📦' : '📬'} Bass strings — ${k.toLowerCase()}</h3>
      <div class="cm-grid">
        <div><label>Date ${k.toLowerCase()}</label><input type="date" class="bm-date" value="${esc(toIso(ms[k] === '✓' ? '' : ms[k]))}"></div>
        <div><label>By whom</label><input class="bm-who" maxlength="20" list="bmNames" value="${esc(ms[k + 'By'] || me)}">
          <datalist id="bmNames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
      </div>
      <div class="rfbar" style="margin-top:12px">
        <button class="ccfmyes bm-save">Save</button>
        ${ms[k] ? '<button class="csvbtn bm-clear" style="background:none;border:1px solid #d3a0a0;color:#9e2020">✕ Clear</button>' : ''}
      </div>`);
    const build = () => {
      // fold each mark's "(who)" back in so editing one never drops the other's
      ['Ordered', 'Received'].forEach(n => {
        if (ms[n] && ms[n] !== '✓' && ms[n + 'By'] && !ms[n].includes('(')) {
          ms[n] += ' (' + ms[n + 'By'] + ')';
        }
      });
      return taskCellValue(ms, ['Ordered', 'Received']);
    };
    const withBy = (dateShort, who) => dateShort + (who ? ' (' + who + ')' : '');
    ov2.querySelector('.bm-save').onclick = () => {
      const dIso = ov2.querySelector('.bm-date').value;
      const who = ov2.querySelector('.bm-who').value.trim();
      if (!dIso) { ov2.querySelector('.bm-date').focus(); return; }
      ms[k] = withBy(toShort(dIso), who);
      ov2.hidden = true;
      bassSave(key, build(), msg);
    };
    const bc = ov2.querySelector('.bm-clear');
    if (bc) bc.onclick = () => { ms[k] = ''; ms[k + 'By'] = ''; ov2.hidden = true; bassSave(key, build(), msg); };
  });
  // 🆕 temp-entry approve / reject (owners, Melissa, managers)
  const tempResolve = async approve => {
    const msg = pop.querySelector('.tempmsg');
    const wa = writeAuth();
    if (!wa.ok) { msg.textContent = ' sign in first'; return; }
    if (!approve && !confirm('Reject this temp entry?\n\nThe row is marked DUPLICATE (recoverable from Reports → Marked Duplicates).')) return;
    msg.textContent = approve ? ' approving…' : ' rejecting…';
    try {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'tempresolve', serial: p.serial, row: p.row,
          approve: approve ? 1 : 0, ...authFields()})});
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'failed');
      p.tempEntry = '';
      if (!approve) p.active = false;
      renderMap();
      if (approve) openPop(p.row, S.popAnchor, true);
      else { $('#pop').hidden = true; popPinned = false; }
    } catch (e) { msg.textContent = ' ✗ ' + e.message; }
  };
  const tok = pop.querySelector('.tempok');
  if (tok) tok.onclick = ev => { ev.stopPropagation(); popPinned = true; tempResolve(true); };
  const tno = pop.querySelector('.tempno');
  if (tno) tno.onclick = ev => { ev.stopPropagation(); popPinned = true; tempResolve(false); };
  // ❗ IMPORTANT note in the sticky card header
  const impBtn = pop.querySelector('.impedit');
  if (impBtn) impBtn.onclick = async ev => {
    ev.stopPropagation(); popPinned = true;
    const msg = pop.querySelector('.impmsg');
    const wa = writeAuth();
    if (!wa.ok) { if (msg) msg.textContent = ' sign in first'; return; }
    const cur = (p.importantNote || '').trim();
    const txt = prompt('IMPORTANT note — shows in red at the top of this piano’s card for everyone.\nLeave empty to clear it.', cur);
    if (txt === null) return;
    const val = txt.trim().slice(0, 200);
    if (msg) msg.textContent = ' saving…';
    try {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'setimportant', serial: p.serial, row: p.row,
          value: val, ...authFields()})});
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'failed');
      p.importantNote = val;
      openPop(p.row, S.popAnchor, true);
    } catch (e) { if (msg) msg.textContent = ' ✗ ' + e.message; }
  };
  // 📝 Activity & Notes — general per-piano notes + the activity log
  const loadActivity = async () => {
    const list = pop.querySelector('.actlist');
    if (!list) return;
    list.innerHTML = '<div class="empty">loading…</div>';
    try {
      const r = await fetch(BRIDGE_URL + '?fn=history&serial=' + encodeURIComponent(p.serial)
        + '&row=' + p.row, {redirect: 'follow'});
      const j = await r.json();
      const rows = j.all || [];
      list.innerHTML = rows.length ? rows.map(a =>
        `<div class="actrow"><b>${esc(a.action || '')}</b> ${esc(a.detail || '')}
           <small>${esc(a.when || '')} · ${esc(a.who || '')}</small></div>`).join('')
        : '<div class="empty">No activity recorded for this piano yet.</div>';
    } catch (e) { list.innerHTML = `<div class="empty">✗ ${esc(e.message)}</div>`; }
  };
  const alBtn = pop.querySelector('.actload');
  if (alBtn) alBtn.onclick = ev => { ev.stopPropagation(); popPinned = true; loadActivity(); };
  const pngo = pop.querySelector('.pngo');
  if (pngo) pngo.onclick = async ev => {
    ev.stopPropagation(); popPinned = true;
    const inp = pop.querySelector('.pnin');
    const msg = pop.querySelector('.pnmsg');
    const note = (inp.value || '').trim();
    if (!note) { msg.textContent = 'type the note first'; return; }
    const wa = writeAuth();
    if (!wa.ok) { msg.textContent = wa.renewing ? 'Sign-in expired — retry in a moment.' : 'Sign in first.'; return; }
    msg.textContent = 'saving…';
    try {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'pianonote', serial: p.serial, row: p.row,
          note, ...authFields()})});
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'failed');
      inp.value = '';
      msg.textContent = '✓ noted';
      // keep the card's notes list in step without a full data refetch
      p.pianoNotes = (j.line ? j.line + '\n' : '') + (p.pianoNotes || '');
      setTimeout(() => { if (!$('#pop').hidden) openPop(p.row, S.popAnchor, true); }, 700);
    } catch (e) { msg.textContent = '✗ ' + e.message; }
  };
  const pnin = pop.querySelector('.pnin');
  if (pnin) { pnin.onclick = ev => ev.stopPropagation(); }
  const ps = pop.querySelector('.phsel');
  if (ps) {
    ps.onclick = ev => ev.stopPropagation();
    ps.onchange = () => setPhase(p, ps.value, pop);
  }
  pop.querySelectorAll('.mmark').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    setMedia(p, b.dataset.f, pop, !!b.dataset.skip);
  });
  pop.querySelectorAll('.trk:not(.dn):not(.typebtn)').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    if (b.dataset.t === 'Misc' && !b.classList.contains('on')) { openMiscModal(p, pop); return; }
    toggleTrack(p, b.dataset.t, pop);
  });
  pop.querySelectorAll('.typebtn').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    setTypeOverride(p, b.dataset.type, pop);
  });
  pop.querySelectorAll('.keybtn').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const list = keyTokens(p);
    const k = b.dataset.k;
    setKeyService(p, list.includes(k) ? list.filter(x => x !== k) : list.concat(k), pop);
  });
  const pay = pop.querySelector('.paysel');
  if (pay) {
    pay.onclick = ev => ev.stopPropagation();
    pay.onchange = () => setPayPlan(p, pay.value, pop);
  }
  pop.querySelectorAll('.astep').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    toggleAdminStep(p, b.dataset.as, pop);
  });
  // drag either side edge to resize (for the shop Chromebooks' big screens);
  // width is remembered on this device
  const savedW = parseInt(lsGet('popW') || '', 10);
  if (savedW) pop.style.width = Math.max(246, Math.min(640, savedW)) + 'px';
  pop.querySelectorAll('.popgrip').forEach(g => g.onpointerdown = ev => {
    ev.preventDefault(); ev.stopPropagation();
    popPinned = true;
    const startX = ev.clientX, startW = pop.offsetWidth;
    const startL = parseFloat(pop.style.left) || pop.offsetLeft;
    const side = g.classList.contains('l') ? -1 : 1;
    const move = e => {
      const w = Math.max(246, Math.min(640, startW + (e.clientX - startX) * side));
      pop.style.width = w + 'px';
      if (side < 0) pop.style.left = (startL + startW - w) + 'px';
      lsSet('popW', String(w));
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
  const me = pop.querySelector('.miscedit');
  if (me) me.onclick = ev => { ev.stopPropagation(); openMiscModal(p, pop); };
  const ca = pop.querySelector('.cabadd');
  if (ca) ca.onclick = ev => { ev.stopPropagation(); openCabModal(p, pop); };
  wireLeadsRow(pop, p);
  pop.querySelectorAll('.cabdel').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    saveCabinetry(p, cabTokens(p).filter(t => t !== b.dataset.t), pop);
  });
  const pe = pop.querySelector('.predit');
  if (pe) pe.onclick = ev => { ev.stopPropagation(); openPriceModal(p); };
  const rr = pop.querySelector('.rreports');
  if (rr) rr.onclick = ev => {
    ev.stopPropagation();
    window.open('https://blpshop.netlify.app/#history=' + encodeURIComponent(p.serial),
      '_blank', 'noopener');
  };
  pop.querySelectorAll('.snz').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const d = new Date(Date.now() + (+b.dataset.d) * 86400000);
    setSnooze(p, `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`, pop);
  });
  const cy = pop.querySelector('.cryes');
  if (cy) cy.onclick = ev => { ev.stopPropagation(); setClientReports(p, true, pop); };
  pop.querySelectorAll('.crno, .croff').forEach(b =>
    b.onclick = ev => { ev.stopPropagation(); setClientReports(p, false, pop); });
  const cr = pop.querySelector('.creports');
  if (cr) cr.onclick = ev => {
    ev.stopPropagation();
    window.open('https://blpshop.netlify.app/manager.html#client-' + encodeURIComponent(p.serial),
      '_blank', 'noopener');
  };
  const rqb = pop.querySelector('.reqbtn');
  if (rqb) rqb.onclick = ev => {
    ev.stopPropagation();
    const m = pop.querySelector('.reqmenu');
    m.hidden = !m.hidden;
    if (!m.hidden) place(pop, S.popAnchor);   // card grew
  };
  pop.querySelectorAll('.reqmenu button').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const kind = b.dataset.req;
    if (kind === 'move') openMoveModal(p);
    else if (kind === 'tune') openTuneModal(p);
    else if (kind === 'service') openServiceModal(p);
    else if (kind === 'curtis') openCurtisModal(p);
    else if (kind === 'price') openPriceModal(p);
    else if (kind === 'admin') openAdminModal(p);
    else if (kind === 'touchup') openGenericModal(p, 'Touch Up');
    else if (kind === 'priority') openGenericModal(p, 'Priority Scheduling');
    else if (kind === 'brigham') openBrighamModal(p);
    else if (kind === 'dup') openDuplicateModal(p);
  });
  if (pop.querySelector('.taskbox')) loadTasks(p, pop);
  const pb = pop.querySelector('.photobtn');
  const pi = pop.querySelector('.photoin');
  if (pb) pb.onclick = ev => { ev.stopPropagation(); popPinned = true; pi.click(); };
  if (pi) {
    pi.onclick = ev => ev.stopPropagation();
    pi.onchange = () => uploadPhoto(p, pi, pop);
  }
  const st = pop.querySelector('.shoptag');
  if (st) st.onclick = ev => {
    ev.stopPropagation(); printShopTag(p);
    logTagPrint(p, 'shop', '');
  };
  // 🪑 bench tag — same print flow from the Locations row and the tag row
  pop.querySelectorAll('.benchtag').forEach(b => b.onclick = ev => {
    ev.stopPropagation(); popPinned = true;
    S.benchTagFor = p.row;
    printBenchTag(p);
    logTagPrint(p, 'bench', (p.benchNote || '').trim());
  });
  const dt = pop.querySelector('.dtech');
  if (dt) dt.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); openTechFolder(dt.dataset.serial, dt); };
  const tt = pop.querySelector('.tagthumb');
  if (tt) tt.onclick = ev => { ev.stopPropagation(); openTagSnapshot(p); };
  (() => {   // Work Clock wiring: phase is mandatory, "Other" allows write-in
    const sel = pop.querySelector('.clkphase');
    const oth = pop.querySelector('.clkother');
    // no datalist here: iOS dismisses the keyboard after every keystroke on
    // datalist-backed inputs (Myrrhanda, 9/1) — a plain input types fine
    const trn = pop.querySelector('.clktrainee');
    const inBtn = pop.querySelector('.clkin');
    const outBtn = pop.querySelector('.clkout');
    const cmsg = pop.querySelector('.clkmsg');
    const trainBox = pop.querySelector('.clktrain');
    // training is a CHECKBOX on top of the phase now (Brigham 9/3: "Hunter
    // needs to clock into his piano and select training AND cap") — the punch
    // records "Training: <phase> — w/ <partner>" so training hours, coach-mode
    // checklists and job costing all know the real phase being trained
    const chosen = () => {
      if (!sel) return '';
      const base = sel.value === '__other__' ? (oth.value || '').trim() : sel.value;
      if (!base) return '';
      if (trainBox && trainBox.checked) {
        const w = trn ? trn.value.trim() : '';
        return 'Training: ' + base + (w ? ' — w/ ' + w : '');
      }
      return base;
    };
    const refresh = () => {
      if (!inBtn) return;
      if (oth) oth.hidden = sel.value !== '__other__';
      if (trn) trn.hidden = !(trainBox && trainBox.checked);
      inBtn.classList.toggle('off', !chosen());
    };
    if (sel) { sel.onchange = () => { refresh(); if (sel.value === '__other__' && oth) oth.focus(); }; sel.onclick = ev => ev.stopPropagation(); }
    if (trainBox) { trainBox.onchange = refresh; trainBox.onclick = ev => ev.stopPropagation(); }
    if (oth) { oth.oninput = refresh; oth.onclick = ev => ev.stopPropagation(); }
    if (inBtn) inBtn.onclick = async ev => {
      ev.stopPropagation(); popPinned = true;
      if (preQueue(p) && !isAdminUser()) {
        alert('🚫 This piano is PRE-QUEUE \u2014 the deposit hasn\u2019t been received, so no work can start yet. Ask a manager.');
        return;
      }
      if ((p.tempEntry || '').trim() && !(isAdminUser() || isTimelogAdmin())) {
        alert('🆕 This is a TEMP entry — an admin needs to approve it before work is clocked on it. It shows in the admin morning brief.');
        return;
      }
      const ph = chosen();
      if (!ph) {
        alert(sel && sel.value === '__other__'
          ? 'Write in a word or two for what you\u2019re doing on this piano, then clock in.'
          : 'Pick the phase you\u2019re about to work on first \u2014 or choose \u201cOther\u201d and write it in.');
        (sel && sel.value === '__other__' ? oth : sel).focus();
        return;
      }
      // confirm exactly what's about to happen before the punch lands
      const cur = CLOCK.open;
      const isSwitch = cur && cur.serial && cur.serial !== p.serial;
      const already = (CLOCK.all || []).filter(o => o.serial === p.serial
        && (o.tech || '').toLowerCase() !== clockName().toLowerCase());
      const okGo = await clockConfirm(
        isSwitch ? '\ud83d\udd01' : '\u25b6',
        isSwitch ? 'Switch pianos?' : 'Clock in?',
        (already.length ? `<div class="ccfmrow" style="border-color:#c9a227;background:#fdf6e3">\ud83d\udc65
           <b>${esc(already.map(o => (o.tech || '').split(/\s+/)[0]).join(' & '))}</b>
           ${already.length > 1 ? 'are' : 'is'} already clocked in on this piano \u2014
           you'll BOTH be on it (fine for training / two-person work).</div>` : '') +
        (isSwitch ? `<div class="ccfmrow">\u25a0 Clock OUT of <b>${esc(String(cur.piano || cur.serial).slice(0, 34))} \u00b7 #${esc(cur.serial)}</b>
             <small>${clockElapsed(cur.start)} will be logged</small></div>` : '') +
        `<div class="ccfmrow">\u25b6 Clock IN on <b>${pianoLabel(p)}</b>
           <small>phase: ${esc(ph)}</small></div>`);
      if (!okGo) { cmsg.className = 'clkmsg phmsg'; cmsg.textContent = ''; return; }
      // \u2757 important-note acknowledgment when the note concerns this work
      const ack = await impNoteGate(p, ph);
      if (!ack.ok) { cmsg.className = 'clkmsg phmsg'; cmsg.textContent = ''; return; }
      cmsg.className = 'clkmsg phmsg'; cmsg.textContent = 'Clocking in\u2026';
      const j = await punch('clockin', p, ph, S.scanArrived === p.serial ? 'scan' : 'card', undefined, ack.note);
      if (j.error) { cmsg.className = 'clkmsg phmsg err'; cmsg.textContent = '\u2717 ' + j.error; return; }
      S.scanArrived = null;
      openPop(p.row, S.popAnchor, true);
      // clocked-in work vs map phase: offer to sync the shop phase (Brigham 8/28)
      await maybeClockPhaseSync(p, ph);
      // first keys/keytops clock-in on this piano \u2192 require the BEFORE photo
      if (/key\s*(service|top|work)|^keys?\b/i.test(ph)) keytopBeforeGate(p);
    };
    if (outBtn) outBtn.onclick = async ev => {
      ev.stopPropagation(); popPinned = true;
      const cur = CLOCK.open || {};
      const okOut = await clockConfirm('\u25a0', 'Clock out?',
        `<div class="ccfmrow">\u25a0 Clock OUT of <b>${esc(String(cur.piano || cur.serial || p.serial).slice(0, 34))} \u00b7 #${esc(cur.serial || p.serial)}</b>
           <small>${cur.start ? clockElapsed(cur.start) + ' will be logged' : ''}</small></div>`);
      if (!okOut) return;
      cmsg.className = 'clkmsg phmsg'; cmsg.textContent = 'Clocking out\u2026';
      const j = await punch('clockout', null, '', 'card');
      if (j.error) { cmsg.className = 'clkmsg phmsg err'; cmsg.textContent = '\u2717 ' + j.error; return; }
      openPop(p.row, S.popAnchor, true);
    };
    // arrived by QR scan and not clocked in here: open + spotlight the section
    if (S.scanArrived === p.serial && sel) {
      const head = pop.querySelector('.sechead[data-sec="clock"]');
      const bodyEl = pop.querySelector('.secbody[data-sec="clock"]');
      if (bodyEl && bodyEl.classList.contains('closed')) {
        bodyEl.classList.remove('closed');
        if (head) { head.classList.remove('shut'); const ar = head.querySelector('.secarrow'); if (ar) ar.textContent = '\u25be'; }
      }
      if (head) head.classList.add('pulse');
    }
  })();
  const tsBtn = pop.querySelector('[data-req="tempspot"]');
  if (tsBtn) tsBtn.onclick = ev => {
    ev.stopPropagation();
    if (!(isAdminUser() || userRole())) return;
    $('#pop').hidden = true; popPinned = false;
    startTempPlace(p);
  };
  pop.querySelectorAll('.sechead[data-sec]').forEach(h => {
    h.onclick = ev => {
      ev.stopPropagation(); popPinned = true;
      const body = pop.querySelector(`.secbody[data-sec="${h.dataset.sec}"]`);
      if (!body) return;
      const closed = body.classList.toggle('closed');
      h.classList.toggle('shut', closed);
      const ar = h.querySelector('.secarrow');
      if (ar) ar.textContent = closed ? '▸' : '▾';
      lsSet('sec_' + h.dataset.sec, closed ? 'closed' : 'open');
    };
  });
  const lhb = pop.querySelector('.lhbtn');
  if (lhb) lhb.onclick = async ev => {
    ev.stopPropagation(); popPinned = true;
    const out = pop.querySelector('.lhout');
    if (!out.hidden && out.innerHTML) { out.innerHTML = ''; return; }
    lhb.textContent = '🕘 loading…';
    try {
      if (!S.histCache) S.histCache = new Map();
      let h = S.histCache.get(p.serial);
      if (!h) {
        const r = await fetch(BRIDGE_URL + '?fn=history&serial=' + encodeURIComponent(p.serial)
          + '&row=' + p.row, {redirect: 'follow'});
        h = await r.json();
        S.histCache.set(p.serial, h);
      }
      lhb.textContent = '🕘 Location history';
      const li = x => `<div class="lhrow"><b>${esc(x.detail)}</b><span>${esc(x.when)} · ${esc(x.who)}</span></div>`;
      // one location its whole life = no history to show
      out.innerHTML =
        (h.loc && h.loc.length
          ? `<div class="lhsec">Spots</div>` + h.loc.map(li).join('')
          : `<div class="lhnone">No moves recorded — this piano has stayed put.</div>`)
        + (h.cab && h.cab.length > 1
          ? `<div class="lhsec">Cabinetry</div>` + h.cab.map(li).join('') : '');
    } catch (e) {
      lhb.textContent = '🕘 Location history';
      out.innerHTML = '<div class="lhnone">history unavailable — try again</div>';
    }
  };
  const pqa = pop.querySelector('.pqapprove');
  if (pqa) pqa.onclick = async ev => {
    ev.stopPropagation(); popPinned = true;
    if (!isAdminUser()) return;
    if (!confirm('Approve ' + (p.serial || 'this piano') + ' for the queue?\n\nThis confirms the $1,000 queue deposit is in — the no-work sign comes off the map and techs may begin.')) return;
    const pqm = pop.querySelector('.pqmsg');
    if (pqm) pqm.textContent = ' approving…';
    const {pin, ok} = writeAuth();
    if (!ok) return;
    try {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin, action: 'prequeueapprove', serial: p.serial, row: p.row, ...authFields()})});
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'failed');
      p.status = j.status;   // optimistic: banner + ghost drop immediately
      renderMap();
      openPop(p.row, S.popAnchor, true);
    } catch (e) { if (pqm) pqm.textContent = ' ✗ ' + e.message; }
  };
  pop.querySelectorAll('.wizbtn').forEach(b => b.onclick = ev => {
    ev.stopPropagation(); popPinned = true;
    openShotWizard(p, b.dataset.kind);
  });
  (() => {
    const fin = pop.querySelector('.maddin');
    if (!fin) return;
    let kind = 'before';
    pop.querySelectorAll('.maddbtn').forEach(b => b.onclick = ev => {
      ev.stopPropagation(); popPinned = true;
      kind = b.dataset.kind; fin.click();
    });
    fin.onclick = ev => ev.stopPropagation();
    fin.onchange = async () => {
      const files = [...(fin.files || [])].slice(0, 8);
      if (!files.length) return;
      const msg = pop.querySelector('.mdmsg');
      const wa = writeAuth();
      if (!wa.ok) { msg.className = 'mdmsg err'; msg.textContent = wa.renewing ? 'Sign-in expired — renewing, retry in a moment.' : 'Sign in first.'; return; }
      let done = 0;
      for (const f of files) {
        msg.className = 'mdmsg'; msg.textContent = `Uploading ${kind} photo ${done + 1}/${files.length}…`;
        try {
          const dataUrl = await downscalePhoto(f, 2048, 0.85);   // web/Shopify-ready JPEG
          const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
            headers: {'content-type': 'text/plain;charset=utf-8'},
            body: JSON.stringify({pin: wa.pin, action: 'photo', kind, serial: p.serial, row: p.row,
              stage: kind === 'before' ? 'Before' : 'After', mime: 'image/jpeg',
              data: dataUrl.split(',')[1], ...authFields()})});
          const j = await r.json();
          if (!j.saved) throw new Error(j.error || 'upload failed');
          done++;
        } catch (e) {
          msg.className = 'mdmsg err'; msg.textContent = '✗ ' + e.message + (done ? ` (${done} uploaded)` : '');
          fin.value = ''; return;
        }
      }
      fin.value = '';
      msg.className = 'mdmsg ok';
      msg.textContent = `✓ ${done} ${kind} photo${done > 1 ? 's' : ''} filed to the ${kind === 'before' ? 'Before' : 'After'} folder`;
      if (kind === 'before') { p.bphoto = true; } else { p.aphoto = true; }
      setTimeout(() => { if (!$('#pop').hidden) openPop(p.row, S.popAnchor, true); }, 1200);
    };
  })();
  // 🪑 bench: location text via the bridge, photo straight to the Tech folder
  // bench location autosaves — debounced while typing, instantly on
  // blur/Enter; no Set button (Brigham 8/28)
  const bnin = pop.querySelector('.bnin');
  if (bnin) {
    let bnTimer = null, bnLast = (p.benchLoc || '').trim();
    const bnSave = async () => {
      const val = bnin.value.trim();
      if (val === bnLast) return;
      const msg = pop.querySelector('.bnmsg');
      const wa = writeAuth();
      if (!wa.ok) { msg.textContent = wa.renewing ? 'Sign-in expired — retry in a moment.' : 'Sign in first.'; return; }
      msg.textContent = 'saving…';
      try {
        const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
          headers: {'content-type': 'text/plain;charset=utf-8'},
          body: JSON.stringify({pin: wa.pin, action: 'setbench', serial: p.serial, row: p.row,
            value: val, ...authFields()})});
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'failed');
        bnLast = val;
        p.benchLoc = val;
        msg.textContent = '✓ saved';
        setTimeout(() => { if (msg.isConnected && msg.textContent === '✓ saved') msg.textContent = ''; }, 1600);
        const bl = pop.querySelector('.benchloc'); if (bl) bl.textContent = val || '—';
      } catch (e) { msg.textContent = '✗ ' + e.message; }
    };
    bnin.onclick = ev => ev.stopPropagation();
    bnin.oninput = () => { popPinned = true; clearTimeout(bnTimer); bnTimer = setTimeout(bnSave, 1200); };
    bnin.onblur = () => { clearTimeout(bnTimer); bnSave(); };
    bnin.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(bnTimer); bnSave(); } };
  }
  const bnshot = pop.querySelector('.bnshot');
  const bnfile = pop.querySelector('.bnfile');
  if (bnshot && bnfile) {
    bnshot.onclick = ev => { ev.stopPropagation(); popPinned = true; bnfile.click(); };
    bnfile.onclick = ev => ev.stopPropagation();
    bnfile.onchange = async () => {
      const f = bnfile.files[0]; bnfile.value = '';
      if (!f) return;
      const msg = pop.querySelector('.bnmsg');
      const wa = writeAuth();
      if (!wa.ok) { msg.textContent = wa.renewing ? 'Sign-in expired — retry in a moment.' : 'Sign in first.'; return; }
      msg.textContent = 'uploading bench photo…';
      try {
        const dataUrl = await downscalePhoto(f, 2048, 0.85);
        const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
          headers: {'content-type': 'text/plain;charset=utf-8'},
          body: JSON.stringify({pin: wa.pin, action: 'photo', kind: 'tech', serial: p.serial,
            row: p.row, stage: 'Bench photo', mime: 'image/jpeg',
            data: dataUrl.split(',')[1], ...authFields()})});
        const j = await r.json();
        if (!j.saved) throw new Error(j.error || 'upload failed');
        msg.textContent = '✓ bench photo filed to the Tech folder';
      } catch (e) { msg.textContent = '✗ ' + e.message; }
    };
  }
  const pws = pop.querySelector('.pwscan');
  if (pws) pws.onclick = ev => { ev.stopPropagation(); popPinned = true; scanPaperwork(p, pop); };
  // 📷 photograph a paperwork sheet → piano's Paperwork Drive folder, then
  // auto-attach the file link on the matching row (Curtis, 9/3)
  pop.querySelectorAll('.pwshootfile').forEach(inp => inp.onchange = async ev => {
    ev.stopPropagation(); popPinned = true;
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const k = inp.dataset.k, label = inp.dataset.label || 'Paperwork';
    const msg = pop.querySelector('.pwmsg');
    const wa = writeAuth();
    if (!wa.ok) { if (msg) { msg.className = 'pwmsg phmsg err'; msg.textContent = 'Sign in first.'; } return; }
    if (msg) { msg.className = 'pwmsg phmsg'; msg.textContent = 'Uploading scan…'; }
    try {
      const dataUrl = await downscalePhoto(f, 2048, 0.85);
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'photo', kind: 'paperwork',
          serial: p.serial, row: p.row, stage: 'Paperwork ' + label,
          mime: 'image/jpeg', data: dataUrl.split(',')[1], ...authFields()})});
      const j = await r.json();
      if (!j.saved) throw new Error(j.error || 'upload failed');
      await setPaperwork(p, k, j.link, j.name, pop);
    } catch (e) { if (msg) { msg.className = 'pwmsg phmsg err'; msg.textContent = '✗ ' + e.message; } }
  });
  pop.querySelectorAll('.pwadd').forEach(b => {
    b.onclick = ev => {
      ev.stopPropagation(); popPinned = true;
      const label = (PW_KINDS.find(x => x[0] === b.dataset.k) || ['', b.dataset.k])[1];
      const url = prompt('Paste the Drive link for ' + label.replace(/^\S+\s/, '') + ':');
      if (url && /^https?:\/\//i.test(url.trim())) setPaperwork(p, b.dataset.k, url.trim(), '', pop);
      else if (url) alert('That does not look like a link — paste the full https:// URL.');
    };
  });
  pop.querySelectorAll('.pwdel').forEach(b => {
    b.onclick = ev => {
      ev.stopPropagation(); popPinned = true;
      if (confirm('Remove this paperwork link? (The Drive file itself is untouched.)'))
        setPaperwork(p, b.dataset.k, '', '', pop);
    };
  });
  const pt = pop.querySelector('.tagbtns a');
  if (pt) pt.onclick = ev => ev.stopPropagation();
}

/* Phase-advance gate: photo required + optional routed notes, then the
 * advance goes through setPhase with {gated:true}. */
function openPhaseGateModal(p, phase, was, pop) {
  // photo is optional when finishing phases with nothing photo-worthy
  // (Mark, 083126hales18) — the mini-QC tap still records, so these
  // phases keep counting in the scorecard's productivity index
  const photoOptional = /^(assessment|chip tuning|1st tuning|2nd tuning|qc & assembly)$/i
    .test((was || '').trim());
  const old = document.querySelector('.dsheetov'); if (old) old.remove();
  const sel = pop && pop.querySelector('.phsel');
  const ov = document.createElement('div');
  ov.className = 'dsheetov';
  ov.innerHTML = `<div class="dsheet"><button class="dsx">✕</button>
    <h3>📸 Finishing ${esc(was)} → ${esc(phase)}</h3>
    <div class="dssub">Take a progress photo of the piano first — these photos feed
      <b>Quality Control</b>, <b>marketing content</b>, and the <b>progress emails the
      piano's owner receives</b>.</div>
    <div class="rfbar">
      <label class="csvbtn" style="cursor:pointer">📷 Take / attach the photo
        <input type="file" accept="image/*" hidden class="pg-file"></label>
      <span class="pg-shot phmsg">${photoOptional ? 'optional for ' + esc(was) : 'required before advancing'}</span></div>
    <div class="rfbar pg-qc" style="gap:14px;align-items:center">
      <b style="font-size:13px">Mini-QC on the ${esc(was)} work:</b>
      <label style="cursor:pointer"><input type="radio" name="pgqc" value="pass"> ✅ Passes</label>
      <label style="cursor:pointer"><input type="radio" name="pgqc" value="fix"> 🔧 Needs fixes</label>
    </div>
    <input class="pg-qcnote" placeholder="what needs fixing?" maxlength="200" hidden>
    <textarea class="pg-note" rows="3" placeholder="Notes about the ${esc(was)} work you just finished (optional) — anything the next tech, the managers or Brigham should know"></textarea>
    <div class="rfbar"><select class="pg-route">
        <option value="card">📌 put the note on the piano's data card (all team)</option>
        <option value="managers">👔 send the note to the managers</option>
        <option value="brigham">🗒 send the note to Brigham</option>
      </select></div>
    <div class="rfbar">
      <button class="csvbtn pg-go" ${photoOptional ? '' : 'disabled'}>Advance to ${esc(phase)} →</button>
      <button class="csvbtn pg-cancel" style="background:none;border:1px solid #cfc9bf;color:inherit">Cancel</button>
      <span class="pg-msg phmsg"></span></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); if (sel) sel.value = was; };
  ov.querySelector('.dsx').onclick = close;
  ov.querySelector('.pg-cancel').onclick = close;
  const shotMsg = ov.querySelector('.pg-shot'), go = ov.querySelector('.pg-go');
  ov.querySelector('.pg-file').onchange = async ev => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const wa = writeAuth();
    if (!wa.ok) { shotMsg.className = 'pg-shot phmsg err'; shotMsg.textContent = 'Sign in first.'; return; }
    shotMsg.className = 'pg-shot phmsg'; shotMsg.textContent = 'Uploading…';
    try {
      const dataUrl = await downscalePhoto(f, 2048, 0.85);
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'photo', kind: 'progress', serial: p.serial,
          row: p.row, stage: was || 'progress', mime: 'image/jpeg',
          data: dataUrl.split(',')[1], ...authFields()})});
      const j = await r.json();
      if (!j.saved) throw new Error(j.error || 'upload failed');
      shotMsg.className = 'pg-shot phmsg ok'; shotMsg.textContent = '✓ photo filed';
      go.disabled = false;
    } catch (e) { shotMsg.className = 'pg-shot phmsg err'; shotMsg.textContent = '✗ ' + e.message; }
  };
  // QC-gated phases: advancing requires an inspector's mini-QC
  if (qcGated(was)) {
    const qcBlock = ov.querySelector('.pg-qc');
    if (qcBlock) {
      qcBlock.innerHTML = `<b style="font-size:13px">🔍 This phase needs a manager mini-QC before it advances.</b>
        <span style="font-size:12px;color:#6f6a63">A manager gets a text with the inspection link — 100% pass moves the piano to ${esc(phase)}; anything less comes back as a 🔁 Rework card.</span>`;
      ov.querySelector('.pg-qcnote').remove();
      const noteEl = ov.querySelector('.pg-note'), routeEl = ov.querySelector('.pg-route');
      if (noteEl) noteEl.remove();
      if (routeEl) routeEl.closest('.rfbar').remove();
      go.textContent = '📨 Request Mini-QC (' + esc(was) + ' → ' + esc(phase) + ')';
      go.onclick = async () => {
        go.disabled = true; go.textContent = 'Requesting…';
        const j = await requestMiniQc(p, phase, was);
        const pm = ov.querySelector('.pg-msg');
        if (j.ok) {
          pm.className = 'pg-msg phmsg ok';
          pm.textContent = j.existing ? '✓ Already requested — the inspector has the link.' : '✓ Requested — Brigham just got a text with the inspection link (Karmel copied). The phase advances when it passes.';
          setTimeout(close, 2600);
        } else { pm.className = 'pg-msg phmsg err'; pm.textContent = '✗ ' + (j.error || 'failed'); go.disabled = false; }
      };
      return;   // note routing + old advance flow don't apply on QC phases
    }
  }
  const qcNote = ov.querySelector('.pg-qcnote');
  ov.querySelectorAll('input[name=pgqc]').forEach(r =>
    r.onchange = () => { qcNote.hidden = r.value !== 'fix' || !r.checked; if (!qcNote.hidden) qcNote.focus(); });
  go.onclick = async () => {
    const qcPick = ov.querySelector('input[name=pgqc]:checked');
    if (!qcPick) {
      ov.querySelector('.pg-msg').className = 'pg-msg phmsg err';
      ov.querySelector('.pg-msg').textContent = 'Mark the mini-QC first — passes, or needs fixes.';
      return;
    }
    go.disabled = true; go.textContent = 'Advancing…';
    const note = ov.querySelector('.pg-note').value.trim();
    const route = ov.querySelector('.pg-route').value;
    const wa = writeAuth();
    // mini-QC record → QC Log tab (first-pass rate feeds the manager scorecard)
    if (wa.ok) {
      bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'miniqc', serial: p.serial, row: p.row,
          phase: was, result: qcPick.value, note: qcNote.value.trim().slice(0, 200),
          ...authFields()})}).catch(() => {});
    }
    if (note && wa.ok) {
      try {
        if (route === 'card') {
          await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
            headers: {'content-type': 'text/plain;charset=utf-8'},
            body: JSON.stringify({pin: wa.pin, action: 'phasenote', serial: p.serial, row: p.row,
              phase: was, note, ...authFields()})});
        } else {
          await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
            headers: {'content-type': 'text/plain;charset=utf-8'},
            body: JSON.stringify({pin: wa.pin, action: 'teamreq',
              kind: route === 'brigham' ? 'Phase note for Brigham' : 'Phase note for the managers',
              serial: p.serial, row: p.row,
              notes: `finished ${was} on #${p.serial}: ${note}`, ...authFields()})});
        }
      } catch (e) { /* the advance still goes through */ }
    }
    ov.remove();
    setPhase(p, phase, pop, {gated: true});
  };
}
async function setPhase(p, phase, pop, extra) {
  const msg = pop.querySelector('.phmsg');
  const sel = pop.querySelector('.phsel');
  const was = p.phase || '';
  if (phase === was) return;
  if (phase.startsWith('Waiting') && extra == null) {
    openWaitNoteModal(p, phase, pop);   // ask for details + check-back first
    return;
  }
  // 📸 phase-advance gate (Brigham 8/26): moving FORWARD in the sequence
  // requires a tech progress photo first (QC, marketing, client updates),
  // plus optional phase notes routed to the card / managers / Brigham
  const gseq = pianoPhases(p) || PHASES;
  if (!(extra && extra.gated)
      && gseq.indexOf(phase) >= 0 && gseq.indexOf(was) >= 0
      && gseq.indexOf(phase) > gseq.indexOf(was)) {
    openPhaseGateModal(p, phase, was, pop);
    return;
  }
  const note = extra && extra.note;
  const checkBack = extra && extra.checkBack;
  popPinned = true;
  const {pin, ok} = writeAuth();   // signed-in users skip the PIN
  if (!ok) {
    msg.className = 'phmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.';
    if (sel) sel.value = was;   // revert the dropdown so it matches reality
    return;
  }
  // optimistic: paint immediately, remember until the server confirms
  p.phase = phase;
  const edit = pendingEdits.get(p.row) || {};
  edit.phase = phase; pendingEdits.set(p.row, edit);
  renderMap();
  msg.className = 'phmsg'; msg.textContent = 'Saving…';
  if (sel) sel.disabled = true;
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'setphase', phase,
        note: note || '', checkBack: checkBack || '', row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') {
      lsDel('blpPin');
      revertPhase(p, was, sel, edit);
      msg.className = 'phmsg err'; msg.textContent = '✗ Wrong PIN — change it again to retry.';
    } else if (j.ok) {
      p.phase = j.phase != null ? j.phase : phase;
      edit.phase = p.phase;   // keep protecting until /api/data catches up
      msg.className = 'phmsg ok';
      msg.textContent = p.phase ? `✓ Saved — ${p.phase}` : '✓ Phase cleared';
      renderMap();
      if (p.phase === 'For Sale') openPriceModal(p);
      if (j.note != null) p.waitNote = j.note;
      if (j.checkBack != null) p.checkBack = j.checkBack;
      // For Sale auto-ticks every shop phase (bridge-side) — take the new
      // list so the Done row and progress bar update without a refetch
      if (j.done != null) { p.phasesDone = j.done; edit.phasesDone = j.done; }
      openPop(p.row, S.popAnchor, true);   // refresh the card rows
      if (j.autoCompleted) {
        const m = $('#pop').querySelector('.dnmsg');
        if (m) { m.className = 'dnmsg phmsg ok'; m.textContent = '\u2713 For Sale \u2014 all shop phases marked complete'; }
      }
      checkPayMilestone(p, $('#pop'));     // payment milestone crossed?
    } else {
      revertPhase(p, was, sel, edit);
      msg.className = 'phmsg err'; msg.textContent = '✗ ' + (j.error || 'update failed');
    }
  } catch (e) {
    revertPhase(p, was, sel, edit);
    msg.className = 'phmsg err'; msg.textContent = '✗ ' + e.message + ' — not saved';
  } finally {
    if (sel) sel.disabled = false;
  }
}
// mark a media item done: optimistic (icon clears immediately), reverted
// with a message if the bridge says no
async function setMedia(p, field, pop, skip) {
  const msg = pop.querySelector('.mdmsg');
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'mdmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  p[field] = skip ? 'skip' : true;
  const edit = pendingEdits.get(p.row) || {};
  edit[field] = p[field]; pendingEdits.set(p.row, edit);
  renderMap(); renderKpis();
  const btn = pop.querySelector(`.mmark[data-f="${field}"]${skip ? '.mskipbtn' : ':not(.mskipbtn)'}`);
  const wrap = btn && btn.closest('.mopts');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'setmedia', field, skip: !!skip, row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.ok) {
      if (wrap) wrap.outerHTML = skip ? '<b class="mskip">— skipped</b>' : '<b class="myes">✓ have</b>';
      msg.className = 'mdmsg ok';
      msg.textContent = skip ? '✓ Skipped — removed from the media reports' : '✓ Saved to the Piano Log';
      // before photos done ⇒ tick "Before Photos" on the admin checklist too
      // (Brigham 8/27) — one action, both records honest
      if (field === 'bphoto' && !skip && !adminStepsOf(p).includes('Before Photos')) {
        try {
          const steps = ADMIN_STEPS.filter(s =>
            adminStepsOf(p).includes(s) || s === 'Before Photos').join(' | ');
          const ra = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
            headers: {'content-type': 'text/plain;charset=utf-8'},
            body: JSON.stringify({pin, serial: p.serial, action: 'setadminsteps',
              steps, row: p.row, ...authFields()})});
          if ((await ra.json()).ok) {
            p.adminSteps = steps;
            msg.textContent = '✓ Saved — and ticked “Before Photos” on the admin checklist';
          }
        } catch (e2) { /* the media save already succeeded; don't undo it */ }
      }
    } else {
      throw new Error(j.error === 'unauthorized' ? 'Wrong PIN' : (j.error || 'update failed'));
    }
  } catch (e) {
    if (e.message === 'Wrong PIN') lsDel('blpPin');
    p[field] = false;
    delete edit[field]; if (!Object.keys(edit).length) pendingEdits.delete(p.row);
    if (btn) { btn.disabled = false; btn.textContent = skip ? 'skip' : '✓ done'; }
    msg.className = 'mdmsg err'; msg.textContent = '✗ ' + e.message + ' — not saved';
    renderMap(); renderKpis();
  }
}

// toggle one track chip on/off; the full list is saved to the TRACK column

/* ---------- Cabinetry Storage shelving (units 1-9) ----------
   Parts stripped from a piano are shelved in the Cabinetry Storage room.
   Each slot is a compact token stored comma-separated in the CABINETRY
   column: "7-L3" = unit 7, Left side, 3rd shelf; "9-RF" = unit 9, Right,
   Floor; "8-5" = unit 8 (single-sided), 5th shelf. */
const CAB_UNITS = {
  1: 'double', 2: 'double', 3: 'double', 4: 'double', 5: 'double',
  6: 'single', 7: 'double', 8: 'single', 9: 'double',
};
const CAB_DBL_LEVELS = [['T', 'Top shelf'], ['3', '3rd shelf'], ['2', '2nd shelf'], ['1', '1st shelf'], ['F', 'Floor']];
const CAB_SGL_LEVELS = [['6', '6th (top)'], ['5', '5th shelf'], ['4', '4th shelf'], ['3', '3rd shelf'], ['2', '2nd shelf'], ['1', '1st (bottom)']];
// normalize hand-typed shelf codes: "5rf" / "5 RF" / "5-rf" -> "5-RF",
// "83" is invalid but "8-3" / "83rd"-style typos aren't guessed at
function parseCabToken(str) {
  const m = /^([1-9])\s*-?\s*([LR])?\s*-?\s*(T|F|[1-6])$/i.exec(String(str || '').trim());
  if (!m) return null;
  const unit = m[1], side = (m[2] || '').toUpperCase(), lvl = m[3].toUpperCase();
  if (CAB_UNITS[unit] === 'single') {
    if (side || !/^[1-6]$/.test(lvl)) return null;   // single racks: shelf 1-6, no side
    return unit + '-' + lvl;
  }
  if (!side || !/^[T3210F]$/.test(lvl) || lvl === '0') return null;  // double: side + T/3/2/1/F
  return unit + '-' + side + lvl;
}
function cabTokens(p) {
  return (p.cabinetry || '').split(',').map(t => t.trim()).filter(Boolean);
}
function cabPretty(tok) {
  const m = /^(\d)-(?:([LR])?([TF1-6]))$/i.exec(tok.trim());
  if (!m) return tok;
  const unit = m[1], side = (m[2] || '').toUpperCase(), lvl = m[3].toUpperCase();
  const levels = CAB_UNITS[unit] === 'single' ? CAB_SGL_LEVELS : CAB_DBL_LEVELS;
  const lname = (levels.find(l => l[0] === lvl) || [lvl, lvl])[1];
  return `Unit ${unit}${side ? (side === 'L' ? ' · Left' : ' · Right') : ''} · ${lname}`;
}

// TRACK col entries are comma-separated; Misc carries its write-in summary
// as "Misc (summary)" — commas in the summary are stored as ';'
function trackParts(str) {
  const raw = (str || '').split(',').map(t => t.trim()).filter(Boolean);
  const m = raw.map(t => t.match(/^Misc\s*\((.*)\)$/)).find(Boolean);
  return {list: raw.map(t => (/^Misc\b/.test(t) ? 'Misc' : t)), miscNote: m ? m[1] : ''};
}
async function toggleTrack(p, track, pop, miscNote) {
  const msg = pop.querySelector('.trkmsg');
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'trkmsg phmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  const was = p.track || '';
  const parts = trackParts(was);
  let list = parts.list;
  if (track === 'Misc' && miscNote != null) {
    if (!list.includes('Misc')) list = list.concat('Misc');   // (re)saving the summary keeps it on
  } else {
    list = list.includes(track) ? list.filter(t => t !== track) : list.concat(track);
  }
  list = TRACKS.filter(t => list.includes(t));   // canonical order
  const note = (miscNote != null ? miscNote : parts.miscNote).replace(/,/g, ';');
  p.track = list.map(t => (t === 'Misc' && note ? `Misc (${note})` : t)).join(', ');
  const edit = pendingEdits.get(p.row) || {};
  edit.track = p.track; pendingEdits.set(p.row, edit);
  const btn = pop.querySelector(`.trk[data-t="${track}"]`);
  if (btn) btn.classList.toggle('on');
  msg.className = 'trkmsg phmsg'; msg.textContent = 'Saving…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'settrack',
        tracks: list, miscNote: note, row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized'); }
    if (!j.ok) throw new Error(j.error || 'save failed');
    p.track = j.track; edit.track = j.track;
    msg.className = 'trkmsg phmsg ok';
    msg.textContent = j.track ? `✓ Track: ${j.track}` : '✓ Tracks cleared';
    if (track === 'Misc') openPop(p.row, S.popAnchor, true);   // summary line appears/disappears
  } catch (e) {
    p.track = was;
    delete edit.track; if (!Object.keys(edit).length) pendingEdits.delete(p.row);
    if (btn) btn.classList.toggle('on');
    msg.className = 'trkmsg phmsg err'; msg.textContent = '✗ ' + e.message + ' — not saved';
  }
}

// Cabinetry shelf picker: unit 1-9, side for double units, level
function openCabModal(p, pop) {
  const unitOpts = Object.keys(CAB_UNITS).map(u =>
    `<option value="${u}">Unit ${u}${CAB_UNITS[u] === 'single' ? ' (single-sided)' : ''}</option>`).join('');
  const ov = modalShell('cabmodal', `
    <span class="x">\u2715</span>
    <h3>🗄 Add cabinetry shelf</h3>
    ${pianoHeader(p)}
    <label>Shelf unit</label>
    <select class="cbunit">${unitOpts}</select>
    <label class="cbsidelbl">Side</label>
    <select class="cbside"><option value="L">Left</option><option value="R">Right</option></select>
    <label>Shelf</label>
    <select class="cblvl"></select>
    <button class="tmgo cbgo">Add shelf location</button>
    <div class="tmmsg"></div>`);
  const unitSel = ov.querySelector('.cbunit');
  const lvlSel = ov.querySelector('.cblvl');
  const sync = () => {
    const single = CAB_UNITS[unitSel.value] === 'single';
    ov.querySelector('.cbsidelbl').style.display = single ? 'none' : '';
    ov.querySelector('.cbside').style.display = single ? 'none' : '';
    lvlSel.innerHTML = (single ? CAB_SGL_LEVELS : CAB_DBL_LEVELS)
      .map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
  };
  unitSel.onchange = sync; sync();
  ov.querySelector('.cbgo').onclick = () => {
    const single = CAB_UNITS[unitSel.value] === 'single';
    const tok = unitSel.value + '-' + (single ? '' : ov.querySelector('.cbside').value) + lvlSel.value;
    const list = cabTokens(p);
    if (!list.includes(tok)) list.push(tok);
    ov.hidden = true;
    saveCabinetry(p, list, pop);
  };
}
async function saveCabinetry(p, list, pop) {
  const msg = pop.querySelector('.cabmsg');
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { if (msg) { msg.className = 'cabmsg phmsg err'; msg.textContent = 'Sign in with Google (☰ menu) first.'; } return; }
  const was = p.cabinetry || '';
  p.cabinetry = list.join(', ');
  const edit = pendingEdits.get(p.row) || {};
  edit.cabinetry = p.cabinetry; pendingEdits.set(p.row, edit);
  if (msg) { msg.className = 'cabmsg phmsg'; msg.textContent = 'Saving\u2026'; }
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'setcabinetry',
        cabinetry: p.cabinetry, row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized'); }
    if (!j.ok) throw new Error(j.error || 'save failed');
    p.cabinetry = j.cabinetry; edit.cabinetry = j.cabinetry;
    if (!$('#pop').hidden) openPop(p.row, S.popAnchor, true);   // refresh card if visible
  } catch (e) {
    p.cabinetry = was;
    delete edit.cabinetry; if (!Object.keys(edit).length) pendingEdits.delete(p.row);
    if (msg) { msg.className = 'cabmsg phmsg err'; msg.textContent = '\u2717 ' + e.message; }
  }
}
function keyTokens(p) {
  return String(p.keyService || '').split(',').map(t => t.trim())
    .filter(t => KEY_SERVICE.some(k => k.toLowerCase() === t.toLowerCase()))
    .map(t => KEY_SERVICE.find(k => k.toLowerCase() === t.toLowerCase()));
}
async function setKeyService(p, list, pop) {
  const msg = pop.querySelector('.keymsg');
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { if (msg) { msg.className = 'keymsg phmsg err'; msg.textContent = 'Sign in with Google (menu) first.'; } return; }
  const was = p.keyService || '';
  p.keyService = KEY_SERVICE.filter(k => list.includes(k)).join(', ');
  if (!$('#pop').hidden) openPop(p.row, S.popAnchor, true);
  const m = $('#pop').querySelector('.keymsg');
  if (m) { m.className = 'keymsg phmsg'; m.textContent = 'Saving...'; }
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'setkeys',
        keys: p.keyService, row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized'); }
    if (!j.ok) throw new Error(j.error || 'save failed');
    const m2 = $('#pop').querySelector('.keymsg');
    if (m2) { m2.className = 'keymsg phmsg ok'; m2.textContent = '\u2713 saved'; }
  } catch (e) {
    p.keyService = was;
    if (!$('#pop').hidden) openPop(p.row, S.popAnchor, true);
    const m2 = $('#pop').querySelector('.keymsg');
    if (m2) { m2.className = 'keymsg phmsg err'; m2.textContent = 'Error: ' + e.message; }
  }
}
async function setTypeOverride(p, type, pop) {
  const msg = pop.querySelector('.typemsg');
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { if (msg) { msg.className = 'typemsg phmsg err'; msg.textContent = 'Sign in with Google (menu) first.'; } return; }
  const wasType = p.type, wasOv = p.typeOverride;
  p.typeOverride = type; if (type) p.type = type;
  if (msg) { msg.className = 'typemsg phmsg'; msg.textContent = 'Saving...'; }
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'settype',
        type, row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized'); }
    if (!j.ok) throw new Error(j.error || 'save failed');
    p.typeOverride = j.type || ''; p.type = j.type || p.type;
    if (!$('#pop').hidden) openPop(p.row, S.popAnchor, true);
    renderMap();
  } catch (e) {
    p.type = wasType; p.typeOverride = wasOv;
    if (msg) { msg.className = 'typemsg phmsg err'; msg.textContent = 'Error: ' + e.message; }
  }
}
/* ---- Admin section: shop progress %, payment plan, admin steps, milestones ---- */
// % of this piano's own track phases complete (explicit Done checks plus
// everything ordered before the current phase); Delivered excluded
function shopProgressPct(p) {
  const list = (pianoPhases(p) || PHASES).filter(ph => ph !== 'Delivered');
  if (!list.length || !p.serial) return 0;
  const dl = (p.phasesDone || '').split(',').map(t => t.trim()).filter(Boolean);
  const effIdx = list.indexOf(effectivePhase(p));
  let done = 0;
  list.forEach((ph, i) => { if (dl.includes(ph) || (effIdx >= 0 && i < effIdx)) done++; });
  return Math.min(100, Math.round(done / list.length * 100));
}
async function setPayPlan(p, plan, pop) {
  const msg = pop.querySelector('.paymsg');
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { if (msg) { msg.className = 'paymsg phmsg err'; msg.textContent = 'Sign in with Google (menu) first.'; } return; }
  const was = p.payPlan;
  p.payPlan = plan;
  if (msg) { msg.className = 'paymsg phmsg'; msg.textContent = 'Saving...'; }
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'setpayplan',
        plan, row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized'); }
    if (!j.ok) throw new Error(j.error || 'save failed');
    if (msg) { msg.className = 'paymsg phmsg ok'; msg.textContent = '✓ saved'; }
  } catch (e) {
    p.payPlan = was;
    if (msg) { msg.className = 'paymsg phmsg err'; msg.textContent = 'Error: ' + e.message; }
  }
}
function adminStepsOf(p) {
  return (p.adminSteps || '').split('|').map(t => t.trim()).filter(Boolean);
}
async function toggleAdminStep(p, step, pop) {
  const msg = pop.querySelector('.asmsg');
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { if (msg) { msg.className = 'asmsg phmsg err'; msg.textContent = 'Sign in with Google (menu) first.'; } return; }
  const was = p.adminSteps || '';
  const list = adminStepsOf(p);
  const next = list.includes(step) ? list.filter(s => s !== step) : list.concat(step);
  // keep sheet order canonical regardless of click order
  p.adminSteps = ADMIN_STEPS.filter(s => next.includes(s)).join(' | ');
  if (!$('#pop').hidden) openPop(p.row, S.popAnchor, true);
  const m2 = $('#pop').querySelector('.asmsg');
  if (m2) { m2.className = 'asmsg phmsg'; m2.textContent = 'Saving...'; }
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'setadminsteps',
        steps: p.adminSteps, row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized'); }
    if (!j.ok) throw new Error(j.error || 'save failed');
    const m3 = $('#pop').querySelector('.asmsg');
    if (m3) { m3.className = 'asmsg phmsg ok'; m3.textContent = '✓ saved'; }
  } catch (e) {
    p.adminSteps = was;
    if (!$('#pop').hidden) openPop(p.row, S.popAnchor, true);
    const m3 = $('#pop').querySelector('.asmsg');
    if (m3) { m3.className = 'asmsg phmsg err'; m3.textContent = 'Error: ' + e.message; }
  }
}
// after any phase change: if shop progress crossed a 25/50/75/100 marker the
// admin hasn't been emailed about yet, tell the bridge — it emails info@ a
// shop update + progress-photo folder link + a prepared client email asking
// for the next progress payment, then records the milestone in the sheet
async function checkPayMilestone(p, pop) {
  if (!p.serial || !inShopwork(p)) return;
  const pct = shopProgressPct(p);
  const last = +String(p.payMilestone || '').replace(/\D/g, '') || 0;
  const crossed = PAY_MILESTONES.filter(m => pct >= m && m > last);
  if (!crossed.length || !p.payPlan) return;   // no plan set → no payment emails
  const milestone = Math.max(...crossed);
  const {pin, ok} = writeAuth();
  if (!ok) return;
  const first = (ownerNameOf(p) || 'there').split(/\s+/)[0];
  const nmYr = [p.year, p.make, p.model].filter(Boolean).join(' ') || p.summary;
  const payAsk = p.payPlan === 'Pd in Full' ? ''
    : p.payPlan === '4 Progress Payments'
      ? `\n\nWith the ${milestone}% milestone reached, this is also the point in your payment plan where the next progress payment comes due. We'll send the invoice separately — and as always, reach out with any questions.`
      : `\n\nA friendly note that per your ${p.payPlan} plan, this milestone is a great time for the next payment — we'll send the details separately.`;
  const clientDraft = `Subject: Your ${nmYr} — ${milestone}% complete at Brigham Larson Pianos\n\n`
    + `Hi ${first},\n\nGreat news from the shop — your ${nmYr} has reached ${milestone}% completion. `
    + `The piano is currently in ${effectivePhase(p) || 'the shop'}, and the work is moving along beautifully.${payAsk}\n\n`
    + `We'll keep the updates coming as we move into the next phase.\n\nWarmly,\nBrigham Larson Pianos\n(801) 763-7967`;
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'paymilestone',
        row: p.row, milestone, pct, phase: effectivePhase(p) || '',
        plan: p.payPlan, summary: p.summary, ownerName: ownerNameOf(p),
        clientEmail: ownerEmailOf(p), clientDraft, ...authFields()}),
    });
    const j = await r.json();
    if (j.ok) {
      p.payMilestone = String(milestone);
      const msg = pop && pop.querySelector('.paymsg');
      if (msg) { msg.className = 'paymsg phmsg ok'; msg.textContent = `📧 ${milestone}% milestone email sent to info@`; }
    }
  } catch (e) { /* milestone email is best-effort — phase save already succeeded */ }
}

// one shelf unit, drawn as a digital twin of its physical whiteboard —
// same LEFT/RIGHT columns and shelf rows the techs see in the room
function openCabUnitModal(u) {
  const single = CAB_UNITS[u] === 'single';
  const levels = single ? CAB_SGL_LEVELS : CAB_DBL_LEVELS;
  const items = [];
  for (const p of S.data.pianos) {
    if (!p.active) continue;
    for (const t of cabTokens(p)) {
      const m = /^(\d)-(?:([LR])?([TF1-6]))$/i.exec(t);
      if (m && m[1] === String(u)) items.push({p, side: (m[2] || '').toUpperCase(), lvl: m[3].toUpperCase()});
    }
  }
  const shName = {T: 'TOP SHELF', 3: single ? '3. THIRD SHELF' : '3rd SHELF', 2: single ? '2. SECOND SHELF' : '2nd SHELF',
                  1: single ? '1. BOTTOM SHELF' : '1st SHELF', F: 'FLOOR', 6: '6. TOP SHELF', 5: '5. FIFTH SHELF', 4: '4. FOURTH SHELF'};
  const cell = (lvl, side) => {
    const here = items.filter(x => x.lvl === lvl && (single || x.side === side));
    const tok = u + '-' + (single ? '' : side) + lvl;
    return `<span class="wbcell">${here.length
      ? here.map(x => `<a class="cabp" data-row="${x.p.row}">${esc(pianoName(x.p))}${x.p.serial ? `<small> ${esc(x.p.serial)}</small>` : ''}</a>`).join('')
      : `<a class="wbassign" data-tok="${tok}">+ assign</a>`}</span>`;
  };
  const rows = levels.map(([v]) => `
    <div class="wbrow"><div class="wbshname">${shName[v] || v}</div>
      ${single ? cell(v) : cell(v, 'L') + cell(v, 'R')}</div>`).join('');
  const ov = modalShell('cabroommodal', `
    <span class="x">\u2715</span>
    <div class="wbboard">
      <div class="wbhead"><span class="wbnum">${esc(String(u))}</span>
        ${single ? '<span class="wbside" style="flex:2">SINGLE SHELF</span>'
                 : '<span class="wbside">LEFT SIDE</span><span class="wbside">RIGHT SIDE</span>'}</div>
      ${rows}
    </div>
    <p class="cabnote">Click a piano to jump to it · click “+ assign” to shelve a piano's parts there.</p>`);
  ov.querySelectorAll('.cabp').forEach(a => a.onclick = () => {
    ov.hidden = true;
    const p = S.data.pianos.find(x => x.row === +a.dataset.row);
    if (p) focusPiano(p);
  });
  ov.querySelectorAll('.wbassign').forEach(a => a.onclick = () => {
    ov.hidden = true;
    openCabAssignModal(a.dataset.tok, u);
  });
}
// assign a piano (by serial, with autocomplete) to a specific shelf token
function openCabAssignModal(tok, unit) {
  serialDatalist();
  const ov = modalShell('cabassignmodal', `
    <span class="x">\u2715</span>
    <h3>🗄 Shelve parts — ${esc(cabPretty(tok))}</h3>
    <label>Piano serial #</label>
    <input class="casn" list="serialList" placeholder="type a serial…">
    <button class="tmgo cago">Assign this shelf</button>
    <div class="tmmsg"></div>`);
  ov.querySelector('.cago').onclick = async () => {
    const msg = ov.querySelector('.tmmsg');
    const sn = ov.querySelector('.casn').value.trim().split(' — ')[0].trim();
    if (!sn) { msg.className = 'tmmsg err'; msg.textContent = 'Type a serial number first.'; return; }
    const p = S.data.pianos.find(x => (x.serial || '').toLowerCase() === sn.toLowerCase());
    if (!p) { msg.className = 'tmmsg err'; msg.textContent = 'No active piano with that serial.'; return; }
    const list = cabTokens(p);
    if (!list.includes(tok)) list.push(tok);
    msg.className = 'tmmsg'; msg.textContent = 'Saving\u2026';
    await saveCabinetry(p, list, {querySelector: () => null});
    ov.hidden = true;
    openCabUnitModal(unit);
  };
  attachSerialSuggest(ov.querySelector('.casn'));
  ov.querySelector('.casn').focus();
}

// Misc is a one-off track: ask what it is when it's switched on
function openMiscModal(p, pop) {
  const cur = trackParts(p.track).miscNote;
  const ov = modalShell('miscmodal', `
    <span class="x">\u2715</span>
    <h3>Misc track — what is it?</h3>
    ${pianoHeader(p)}
    <label>Summary of this track</label>
    <textarea class="miscnotes" rows="2" placeholder="one-of-a-kind work\u2026">${esc(cur)}</textarea>
    <button class="tmgo miscgo">Save Misc track</button>
    <div class="tmmsg"></div>`);
  ov.querySelector('.miscgo').onclick = () => {
    const note = ov.querySelector('.miscnotes').value.trim();
    if (!note) {
      ov.querySelector('.tmmsg').className = 'tmmsg err';
      ov.querySelector('.tmmsg').textContent = 'Describe the track first.';
      return;
    }
    ov.hidden = true;
    toggleTrack(p, 'Misc', pop, note);
  };
  ov.querySelector('.miscnotes').focus();
}

/* ---------- plating request form (replaces the handwritten pad) ----------
   Mirrors the Category 3b survey columns. Submit = save a 3b row on the
   plating sheet + email the request from info@ + stamp the card's
   electroplating task "Submitted". */
function openPlatingModal(p, pop) {
  const yn = cls => `<select class="pf ${cls}" style="padding:6px;border:1px solid #cfc9bf;border-radius:6px;font:inherit">
      <option value=""></option><option>Y</option><option>N</option><option>N/A</option></select>`;
  const num = (cls, w) => `<input class="pf ${cls}" maxlength="20" style="width:${w || 58}px;padding:6px;border:1px solid #cfc9bf;border-radius:6px;font:inherit">`;
  const txt = (cls, ph) => `<input class="pf ${cls}" maxlength="200" placeholder="${ph || ''}"
      style="flex:1;min-width:150px;padding:6px;border:1px solid #cfc9bf;border-radius:6px;font:inherit">`;
  const grp = (label, inner) => `<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;padding:5px 0;border-bottom:1px dotted #e4dfd5">
      <b style="min-width:170px;font-size:12.5px">${label}</b>${inner}</div>`;
  const sm = s => `<small style="color:#8a8378">${s}</small>`;
  const ov = modalShell('platmodal', `
    <span class="x">✕</span>
    <h3>Plating / buffing request</h3>
    ${pianoHeader(p)}
    <div style="max-height:62vh;overflow:auto;margin:6px 0;font-size:13px">
      ${grp('Location / spot', num('f-location', 70))}
      ${grp('Pedals', `${sm('how many')}${num('f-pedalsCount')} ${sm('brass?')}${yn('f-pedalsBrass')} ${sm('repair?')}${txt('f-pedalsRepair', 'holes, etc')} ${txt('f-pedalsNotes', 'toe buttons? other?')}`)}
      ${grp('Pedal rods (external)', `${sm('how many')}${num('f-rodsCount')} ${sm('brass?')}${yn('f-rodsBrass')}`)}
      ${grp('Lyre support rods', `${sm('how many')}${num('f-lyreCount')} ${sm('brass?')}${yn('f-lyreBrass')}`)}
      ${grp('Pedal trim', `${sm('brass?')}${yn('f-trimBrass')}`)}
      ${grp('Continuous hinges', `${sm('how many')}${num('f-chCount')} ${sm('brass?')}${yn('f-chBrass')} ${sm('length')}${num('f-chLength', 80)}`)}
      ${grp('Lid hinges', `${sm('how many')}${num('f-lhCount')} ${sm('brass?')}${yn('f-lhBrass')} ${txt('f-lhNotes', 'decorative? bent butt? missing?')}`)}
      ${grp('Fallboard lock', yn('f-fbLock'))}
      ${grp('Top lid lock (grands)', yn('f-topLock'))}
      ${grp('Escutcheon', yn('f-escutcheon'))}
      ${grp('Fallboard strike plate', yn('f-strike'))}
      ${grp('Fallboard hinges', `${sm('how many')}${num('f-fbhCount')} ${sm('brass?')}${yn('f-fbhBrass')}`)}
      ${grp('Fallboard hardware', `${txt('f-fbHardware', 'what is it? how many?')} ${sm('brass?')}${yn('f-fbHwBrass')}`)}
      ${grp('Agraffes', `${sm('tumble?')}${yn('f-agraffes')}`)}
      ${grp('Other (candelabras…)', `${txt('f-otherItems', 'what items?')} ${sm('brass?')}${yn('f-otherBrass')}`)}
      ${grp('Screws', `${txt('f-screwTypes', 'head type / diameter / length')} ${txt('f-screwCounts', 'ex: OH #4 5/8": 8')}`)}
      ${grp('Photos folder', txt('f-photos', 'Drive link — hardware on white posterboard'))}
      <label style="margin-top:8px">General notes</label>
      <textarea class="pf f-notes" rows="2" placeholder="anything else the platers should know…"></textarea>
      <label style="display:flex;gap:7px;align-items:center;margin-top:6px;font-size:13px">
        <input type="checkbox" class="platmail" checked> Email this request to the plating company (from info@)</label>
    </div>
    <button class="tmgo platgo">Submit plating request</button>
    <div class="tmmsg"></div>`);
  ov.querySelector('.platgo').onclick = () => submitPlatingRequest(p, pop, ov);
}
async function submitPlatingRequest(p, pop, ov) {
  const msg = ov.querySelector('.tmmsg');
  const af = authFields();
  const key = (localStorage.getItem('blp.appkey') || '').trim();
  if (!af.idToken && !key) {
    msg.className = 'tmmsg err';
    msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.';
    return;
  }
  const f = {};
  ov.querySelectorAll('.pf').forEach(el => {
    const k = [...el.classList].find(c => c.startsWith('f-'));
    if (k && el.value.trim()) f[k.slice(2)] = el.value.trim();
  });
  const nm = [(p.year || ''), p.make, p.model].filter(Boolean).join(' ') || p.summary || 'Piano';
  if (!f.location && p.location) f.location = p.location;
  const go = ov.querySelector('.platgo');
  go.disabled = true;
  msg.className = 'tmmsg';
  msg.textContent = 'Submitting…';
  try {
    const headers = {'content-type': 'application/json'};
    if (af.idToken) headers.authorization = 'Bearer ' + af.idToken;
    const r = await fetch(PLATING_REQUEST_API, {method: 'POST', headers,
      body: JSON.stringify({key, piano: nm, serial: p.serial, f,
        sendEmail: ov.querySelector('.platmail').checked,
        by: (af.user && (af.user.name || af.user.email)) || 'Team'})});
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || j.note || ('HTTP ' + r.status));
    await postTask(p, pop, {task: 'pedals/cabinetry hardware electroplating and polishing',
      part: '', step: 1, label: 'Submitted', on: true});
    loadTasks(p, pop);
    msg.textContent = '✓ ' + [j.saved ? 'saved to Category 3b' : '', j.emailed ? 'emailed' : '',
      'card marked Submitted'].filter(Boolean).join(' · ') + (j.note ? ' — ' + j.note : '');
    go.textContent = 'Submitted ✓';
  } catch (e) {
    msg.className = 'tmmsg err';
    msg.textContent = '✗ ' + (e.message || e);
    go.disabled = false;
  }
}

// toggle a completed-phase checkmark; the list is saved to PHASES DONE
async function toggleDone(p, phase, pop) {
  const msg = pop.querySelector('.dnmsg');
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'dnmsg phmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  const was = p.phasesDone || '';
  let list = was.split(',').map(t => t.trim()).filter(Boolean);
  list = list.includes(phase) ? list.filter(t => t !== phase) : list.concat(phase);
  list = PHASES.filter(ph => list.includes(ph));
  p.phasesDone = list.join(', ');
  const edit = pendingEdits.get(p.row) || {};
  edit.phasesDone = p.phasesDone; pendingEdits.set(p.row, edit);
  const btn = pop.querySelector(`.trk.dn[data-ph="${phase}"]`);
  if (btn) btn.classList.toggle('on');
  msg.className = 'dnmsg phmsg'; msg.textContent = 'Saving…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'setdone',
        phases: list, row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized'); }
    if (!j.ok) throw new Error(j.error || 'save failed');
    p.phasesDone = j.done; edit.phasesDone = j.done;
    msg.className = 'dnmsg phmsg ok';
    msg.textContent = j.done ? `✓ Completed: ${j.done}` : '✓ Cleared';
    checkPayMilestone(p, pop);   // payment milestone crossed?
  } catch (e) {
    p.phasesDone = was;
    delete edit.phasesDone; if (!Object.keys(edit).length) pendingEdits.delete(p.row);
    if (btn) btn.classList.toggle('on');
    msg.className = 'dnmsg phmsg err'; msg.textContent = '✗ ' + e.message + ' — not saved';
  }
}

// per-piano client-reports switch — hides/shows the Client Reports History
// button and removes the piano from the Shop manager's Client Reports list
async function setClientReports(p, enabled, pop) {
  const msg = pop.querySelector('.crmsg');
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'crmsg phmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  const was = p.clientReports || '';
  p.clientReports = enabled ? 'Yes' : 'No';
  const edit = pendingEdits.get(p.row) || {};
  edit.clientReports = p.clientReports; pendingEdits.set(p.row, edit);
  msg.className = 'crmsg phmsg'; msg.textContent = 'Saving…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'setclientreports',
        enabled, row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized'); }
    if (!j.ok) throw new Error(j.error || 'save failed');
    p.clientReports = j.clientReports; edit.clientReports = j.clientReports;
    msg.className = 'crmsg phmsg ok';
    msg.textContent = enabled ? '✓ Client reports on' : '✓ Client reports off';
    openPop(p.row, S.popAnchor, true);   // re-render so the button appears/disappears
  } catch (e) {
    p.clientReports = was;
    delete edit.clientReports; if (!Object.keys(edit).length) pendingEdits.delete(p.row);
    msg.className = 'crmsg phmsg err'; msg.textContent = '✗ ' + e.message;
  }
}

// snooze: when to check whether this piano's wait is over
async function setSnooze(p, date, pop) {
  const msg = pop.querySelector('.snzmsg');
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'snzmsg phmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  const was = p.checkBack || '';
  p.checkBack = date;
  const edit = pendingEdits.get(p.row) || {};
  edit.checkBack = date; pendingEdits.set(p.row, edit);
  let cur = pop.querySelector('.snzcur');
  if (cur) cur.textContent = date;
  msg.className = 'snzmsg phmsg'; msg.textContent = 'Saving…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'setsnooze',
        date, row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized'); }
    if (!j.ok) throw new Error(j.error || 'save failed');
    msg.className = 'snzmsg phmsg ok'; msg.textContent = `✓ Check back ${j.checkBack}`;
  } catch (e) {
    p.checkBack = was;
    delete edit.checkBack; if (!Object.keys(edit).length) pendingEdits.delete(p.row);
    if (cur) cur.textContent = was || '—';
    msg.className = 'snzmsg phmsg err'; msg.textContent = '✗ ' + e.message;
  }
}

function revertPhase(p, was, sel, edit) {
  p.phase = was;
  if (edit) { delete edit.phase; if (!Object.keys(edit).length) pendingEdits.delete(p.row); }
  if (sel) sel.value = was;
  renderMap();
}

/* ---------- add-a-piano modal (the ＋ on empty spots) ---------- */
// freshly added pianos, re-inserted after every poll until the cached
// /api/data catches up and serves them itself
const pendingAdds = [];
function applyAdds() {
  for (let i = pendingAdds.length - 1; i >= 0; i--) {
    const pa = pendingAdds[i];
    if (S.data.pianos.some(p => (p.serial || '').toLowerCase() === pa.serial.toLowerCase())) {
      pendingAdds.splice(i, 1);          // server caught up
    } else {
      S.data.pianos.push(pa);
    }
  }
}
// spot collision: the bridge bumped prior occupants to the attic — mirror
// that locally so the map updates without waiting for the next poll
function applyBumps(bumped) {
  (bumped || []).forEach(b => {
    const bp = S.data.pianos.find(x => x.row === b.row);
    if (!bp) return;
    bp.location = 'Attic — bumped from ' + (bp.location || '');
    bp.isSlot = false;
    const be = pendingEdits.get(bp.row) || {};
    be.location = bp.location; pendingEdits.set(bp.row, be);
  });
}
// suggestion list for serial inputs: every active piano's serial, with its
// name and spot as the hint — typing "189" offers every 189… serial
function serialDatalist() {
  let dl = document.getElementById('serialList');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'serialList';
    document.body.appendChild(dl);
  }
  dl.innerHTML = S.data.pianos
    .filter(p => p.active && p.serial)
    .map(p => `<option value="${esc(p.serial)}">${esc(pianoName(p))}${p.location ? ' · ' + esc(p.location) : ''}</option>`)
    .join('');
}

/* datalists never show suggestions on iOS / installed-app browsers, so
   every serial input also gets this tap-friendly dropdown: matches by
   serial or piano name as you type, tap a row to fill it in. */
function attachSerialSuggest(inp, onPick) {
  if (!inp || inp._snsug) return;
  inp._snsug = 1;
  inp.setAttribute('autocomplete', 'off');
  const box = document.createElement('div');
  box.className = 'snsuggest';
  box.hidden = true;
  // anchor the dropdown to the input's parent
  if (getComputedStyle(inp.parentNode).position === 'static') inp.parentNode.style.position = 'relative';
  inp.parentNode.insertBefore(box, inp.nextSibling);
  const hide = () => { box.hidden = true; };
  const show = () => {
    const q = inp.value.trim().toLowerCase();
    if (q.length < 2) { hide(); return; }
    const pool = S.data.pianos.filter(p => p.active && p.serial);
    const starts = [], within = [];
    for (const p of pool) {
      const sn = p.serial.toLowerCase();
      if (sn.startsWith(q)) starts.push(p);
      else if (sn.includes(q) || pianoName(p).toLowerCase().includes(q)) within.push(p);
      if (starts.length >= 8) break;
    }
    const hits = starts.concat(within).slice(0, 8);
    if (!hits.length) { hide(); return; }
    box.innerHTML = hits.map(p =>
      `<div class="snrow" data-sn="${esc(p.serial)}"><b>${esc(p.serial)}</b> — ${esc(pianoName(p))}${p.location ? ' <span>· ' + esc(p.location) + '</span>' : ''}</div>`).join('');
    box.hidden = false;
    box.querySelectorAll('.snrow').forEach(r => {
      // pointerdown so the pick lands before the input's blur hides the box
      r.onpointerdown = e => {
        e.preventDefault();
        inp.value = r.dataset.sn;
        hide();
        if (onPick) onPick(r.dataset.sn);
      };
    });
  };
  inp.addEventListener('input', show);
  inp.addEventListener('focus', show);
  inp.addEventListener('blur', () => setTimeout(hide, 150));
}

/* ＋ on a plate rack slat (1p-18p): the plate is assigned by the piano's
   serial — the piano itself stays wherever it is on the floor */
function openPlateAssignModal(slotId) {
  serialDatalist();
  const ov = modalShell('platemodal', `
    <span class="x">\u2715</span>
    <h3>⚙️ Put a plate at ${esc(slotId)}</h3>
    <label>Which piano's plate? (serial)</label>
    <input class="plsn" maxlength="20" placeholder="type the serial…">
    <button class="tmgo plgo">Store the plate at ${esc(slotId)}</button>
    <div class="tmmsg"></div>`);
  attachSerialSuggest(ov.querySelector('.plsn'));
  ov.querySelector('.plgo').onclick = async () => {
    const msg = ov.querySelector('.tmmsg');
    const sn = ov.querySelector('.plsn').value.trim().split(' — ')[0].trim();
    if (!sn) { msg.className = 'tmmsg err'; msg.textContent = 'Type a serial number first.'; return; }
    const p = S.data.pianos.find(x => x.active && (x.serial || '').toLowerCase() === sn.toLowerCase());
    if (!p) { msg.className = 'tmmsg err'; msg.textContent = 'No active piano with that serial.'; return; }
    const list = cabTokens(p);
    if (!list.includes(slotId)) list.push(slotId);
    msg.className = 'tmmsg'; msg.textContent = 'Saving\u2026';
    await saveCabinetry(p, list, {querySelector: () => null});
    ov.hidden = true;
    renderMap();
  };
  ov.querySelector('.plsn').focus();
}

/* the ＋ on an empty spot: type a serial, the piano is found in the Piano
   Log and moved to this spot (existing occupants get bumped to the attic).
   Unknown serials fall back to the full add-a-piano form. */
function openAssignModal(slotId) {
  popPinned = false; $('#pop').hidden = true;
  const ov = modalShell('assignmodal', `
    <span class="x">✕</span>
    <h3>＋ Put a Piano at Spot ${esc(slotId)}</h3>
    <label>Serial number</label>
    <input class="asserial" maxlength="20" list="serialList" placeholder="type the piano's serial #">
    <button class="tmgo asgo">Find it and move it to spot ${esc(slotId)}</button>
    <div class="tmmsg"></div>`);
  serialDatalist();
  const go = () => submitAssign(slotId, ov);
  ov.querySelector('.asgo').onclick = go;
  const inp = ov.querySelector('.asserial');
  attachSerialSuggest(inp);
  inp.onkeydown = e => { if (e.key === 'Enter') go(); };
  inp.focus();
}
async function submitAssign(slotId, ov) {
  const msg = ov.querySelector('.tmmsg');
  const btn = ov.querySelector('.asgo');
  const serial = ov.querySelector('.asserial').value.trim();
  if (!serial) { msg.className = 'tmmsg err'; msg.textContent = 'Type a serial number first.'; return; }
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = 'Looking it up in the Piano Log…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial, action: 'move', newLocation: slotId, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') {
      lsDel('blpPin');
      throw new Error('Not authorized — sign in again from the ☰ menu.');
    }
    if (j.error && /not found/i.test(j.error)) {
      msg.className = 'tmmsg err';
      msg.innerHTML = `That serial isn't in the Piano Log.`;
      btn.outerHTML = `<button class="tmgo asnew">＋ Add it as a NEW piano at spot ${esc(slotId)}</button>`;
      ov.querySelector('.asnew').onclick = () => { ov.hidden = true; openAddModal(slotId, serial); };
      return;
    }
    if (j.error && j.rows) {   // several active rows share the serial — take the first
      const r2 = await fetch(BRIDGE_URL, {
        method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin, serial, action: 'move', newLocation: slotId, row: j.rows[0], ...authFields()}),
      });
      const j2 = await r2.json();
      if (!j2.moved) throw new Error(j2.error || 'move failed');
      finishAssign(j2, serial, slotId, ov, msg);
      return;
    }
    if (!j.moved) throw new Error(j.error || 'move failed');
    finishAssign(j, serial, slotId, ov, msg);
  } catch (e) {
    msg.className = 'tmmsg err'; msg.textContent = '✗ ' + e.message;
    const b = ov.querySelector('.asgo'); if (b) b.disabled = false;
  }
}
function finishAssign(j, serial, slotId, ov, msg) {
  const p = S.data.pianos.find(x => x.row === j.row)
    || S.data.pianos.find(x => (x.serial || '').toLowerCase() === serial.toLowerCase());
  if (p) {
    p.location = j.location; p.isSlot = SLOT_RE.test(j.location);
    const edit = pendingEdits.get(p.row) || {};
    edit.location = j.location; pendingEdits.set(p.row, edit);
  }
  applyBumps(j.bumped);
  index(); renderAll();
  msg.className = 'tmmsg ok';
  msg.textContent = `✓ ${j.summary || 'Piano'} moved from ${j.previous || '—'} to spot ${j.location}`
    + (j.bumped && j.bumped.length ? ` — bumped ${j.bumped.map(b => b.summary || 'a piano').join(', ')} to the attic` : '');
  setTimeout(() => { ov.hidden = true; if (p) focusPiano(p); }, 2000);
}

function openAddModal(slotId, prefillSerial) {
  popPinned = false;
  $('#pop').hidden = true;
  let ov = $('#addmodal');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'addmodal';
    document.body.appendChild(ov);
  }
  const isAdm = isAdminUser() || isTimelogAdmin();
  ov.innerHTML = `<div class="tmcard">
    <span class="x">✕</span>
    <h3>＋ Add a Piano${slotId ? ` — Spot ${esc(slotId)}` : ''}</h3>
    <label>Serial number <small>(enter what's legible)</small></label>
    <input class="adserial" maxlength="20" list="serialList" placeholder="e.g. 546310"${''}
      value="${esc(prefillSerial || '')}">
    <label class="adnosn"><input type="checkbox" class="adnoserial"> serial not found / not legible</label>
    <div class="adgrid">
      <div><label>Year</label><input class="adyear" maxlength="4" placeholder="1996"></div>
      <div><label>Make</label><input class="admake" maxlength="30" placeholder="Yamaha"></div>
    </div>
    <div class="adgrid">
      <div><label>Model</label><input class="admodel" maxlength="30" placeholder="C3"></div>
      <div><label>Type</label><select class="adtype">
        <option value="Grand">Grand</option><option value="Upright">Upright</option>
        <option value="Digital">Digital</option></select></div>
    </div>
    <div class="adgrid">
      <div><label>Size <small>(if known)</small></label><input class="adsize" maxlength="14" placeholder="5'8&quot; / 48&quot;"></div>
      ${slotId ? '' : `<div><label>Spot # <small>(optional)</small></label><input class="adspot" maxlength="12" placeholder="e.g. 84"></div>`}
    </div>
    <label>Owner <small>(client name if known)</small></label>
    <input class="adowner" maxlength="60" value="BLP">
    <button class="adgo">${isAdm ? 'Add to the Piano Log' : 'Add as a TEMP entry'}${slotId ? ` at spot ${esc(slotId)}` : ''}</button>
    ${isAdm ? '' : `<div class="adtempnote">🆕 Saved as a <b>TEMP entry</b> — it shows on the map right away,
      and an admin approves it from tomorrow's brief. Enter what you know; blanks are fine.</div>`}
    <div class="tmmsg admsg"></div>
  </div>`;
  const nos = ov.querySelector('.adnoserial'), asn = ov.querySelector('.adserial');
  nos.onchange = () => {
    asn.disabled = nos.checked;
    asn.value = nos.checked ? '' : asn.value;
    asn.placeholder = nos.checked ? 'a temp ID will be created' : 'e.g. 546310';
  };
  ov.hidden = false;
  ov.onclick = ev => {
    if (ev.target === ov || ev.target.closest('.x')) ov.hidden = true;
  };
  serialDatalist();
  ov.querySelector('.adgo').onclick = () => submitAdd(slotId, ov);
  attachSerialSuggest(ov.querySelector('.adserial'));
  ov.querySelector('.adserial').focus();
}
async function submitAdd(slotId, ov) {
  const msg = ov.querySelector('.admsg');
  const btn = ov.querySelector('.adgo');
  const v = c => { const el = ov.querySelector(c); return el ? el.value.trim() : ''; };
  const noSerial = ov.querySelector('.adnoserial')?.checked;
  let serial = v('.adserial');
  if (noSerial && !serial) {
    // placeholder id so every card feature works; admin swaps in the real
    // serial once it's found (NOSN = "no serial number")
    const d = new Date();
    serial = 'NOSN-' + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
      + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  }
  if (!serial) { msg.className = 'tmmsg err'; msg.textContent = 'Type the serial — or check "serial not found".'; return; }
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = 'Adding to the Piano Log…';
  const loc = slotId || v('.adspot');
  const isTemp = !(isAdminUser() || isTimelogAdmin());
  const fields = {serial, year: v('.adyear'), make: v('.admake'), model: v('.admodel'),
                  size: v('.adsize'), category: v('.adtype'), owner: v('.adowner') || 'BLP',
                  location: loc, temp: isTemp ? 1 : 0};
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, action: 'addpiano', ...fields, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') {
      lsDel('blpPin');
      throw new Error('Not authorized — sign in again from the ☰ menu, then retry.');
    }
    if (j.duplicate) {
      // same serial already in the log — offer to move it here instead
      msg.className = 'tmmsg err';
      msg.innerHTML = `⚠️ That serial appears to be a <b>duplicate</b> — the log already has
        <b>${esc(j.summary || 'a piano')}</b> (SN ${esc(serial)}) at
        <b>${esc(j.location || 'no spot')}</b>.<br>Update its map location to
        <b>spot ${esc(slotId)}</b> instead?`;
      btn.outerHTML = `<button class="adgo admove">Yes — move it to spot ${esc(slotId)}</button>`;
      ov.querySelector('.admove').onclick = async () => {
        const mbtn = ov.querySelector('.admove');
        mbtn.disabled = true; msg.className = 'tmmsg'; msg.textContent = 'Moving it…';
        try {
          const r2 = await fetch(BRIDGE_URL, {
            method: 'POST', redirect: 'follow',
            headers: {'content-type': 'text/plain;charset=utf-8'},
            body: JSON.stringify({pin, action: 'move', serial, row: j.row,
              newLocation: slotId, ...authFields()}),
          });
          const j2 = await r2.json();
          if (!j2.moved) throw new Error(j2.error || 'move failed');
          const p = S.data.pianos.find(x => x.row === j.row)
            || S.data.pianos.find(x => (x.serial || '').toLowerCase() === serial.toLowerCase());
          if (p) {
            p.location = j2.location; p.isSlot = SLOT_RE.test(j2.location);
            const edit = pendingEdits.get(p.row) || {};
            edit.location = j2.location; pendingEdits.set(p.row, edit);
          }
          index(); renderAll();
          msg.className = 'tmmsg ok';
          msg.textContent = `✓ Moved from ${j2.previous || '—'} to spot ${j2.location}.`;
          setTimeout(() => { ov.hidden = true; }, 1800);
        } catch (e2) {
          msg.className = 'tmmsg err'; msg.textContent = '✗ ' + e2.message;
          mbtn.disabled = false;
        }
      };
      return;
    }
    if (!j.added) throw new Error(j.error || 'add failed');
    msg.className = 'tmmsg ok';
    msg.textContent = isTemp
      ? `✓ Added as a TEMP entry${loc ? ' at spot ' + loc : ''} — an admin will approve it from the morning brief.`
      : `✓ Added to the Piano Log (row ${j.row})${loc ? ' at spot ' + loc : ''}.`;
    applyBumps(j.bumped);
    const nu = {row: j.row, section: '', owner: fields.owner, serial,
      summary: j.summary, year: fields.year, make: fields.make, model: fields.model,
      size: fields.size, type: fields.category.toLowerCase(), status: '', location: loc,
      isSlot: SLOT_RE.test(loc), entered: localDay(),
      phase: 'New Arrival - Admin', price: '', bphoto: false, aphoto: false,
      bvideo: false, avideo: false, queuePos: 0, queueTotal: 0,
      tempEntry: isTemp ? 'Pending · you · just now' : '',
      isNew: true, active: true};
    pendingAdds.push(nu);
    applyAdds(); index(); renderAll();
    setTimeout(() => { ov.hidden = true; focusPiano(nu); openPop(nu.row, S.popAnchor, true); }, 1600);
  } catch (e) {
    msg.className = 'tmmsg err';
    msg.textContent = '✗ ' + e.message;
    if (ov.querySelector('.adgo')) ov.querySelector('.adgo').disabled = false;
  }
}

/* ---------- shared modal helper ---------- */
function modalShell(id, inner) {
  let ov = document.getElementById(id);
  if (!ov) {
    ov = document.createElement('div');
    ov.id = id;
    ov.className = 'blpmodal';
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="tmcard">${inner}</div>`;
  ov.hidden = false;
  ov.onclick = ev => {
    if (ev.target === ov || ev.target.closest('.x')) ov.hidden = true;
  };
  return ov;
}
function pianoHeader(p) {
  if (!p) {
    return `<div class="tmpiano"><b>General request</b>
      <span>not tied to a specific piano</span></div>
      <label>Piano / area <small>(optional)</small></label>
      <input class="gpiano" maxlength="60" list="serialList" placeholder="serial, spot, or area — if it applies">`;
  }
  const nm = [(p.year || ''), p.make, p.model].filter(Boolean).join(' ') || p.summary || 'Piano';
  return `<div class="tmpiano"><b>${esc(nm)}</b>
    <span>Serial ${esc(p.serial)}${p.location ? ' · Spot ' + esc(p.location) : ''}</span></div>`;
}
// request fields shared by every submitter: works with or without a piano
function reqIdent(p, ov) {
  const out = {serial: p ? p.serial : ''};
  if (p) out.row = p.row;
  else {
    const g = ov.querySelector('.gpiano');
    attachSerialSuggest(g);
    if (g && g.value.trim()) out.pianoText = g.value.trim();
  }
  return out;
}

/* ---------- in-store move request (batched Monday 7am) ---------- */
function openMoveModal(p) {
  popPinned = false; $('#pop').hidden = true;
  const ov = modalShell('movemodal', `
    <span class="x">✕</span>
    <h3>🚚 Request an In-Store Move</h3>
    ${pianoHeader(p)}
    <label>Move to <small>(spot # or area)</small></label>
    <input class="mvspot" maxlength="24" placeholder="e.g. 123a, Showroom…">
    <label>Notes for the move crew <small>(optional)</small></label>
    <textarea class="mvnotes" rows="2" placeholder="careful — fresh lacquer, needs 2 people…"></textarea>
    <button class="tmgo mvgo2">Add to Monday's 7:00 AM in-store moves</button>
    <div class="tmmsg"></div>`);
  ov.querySelector('.mvgo2').onclick = () => submitMoveReq(p, ov);
  ov.querySelector('.mvspot').focus();
}
async function submitMoveReq(p, ov) {
  const msg = ov.querySelector('.tmmsg');
  const btn = ov.querySelector('.mvgo2');
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = 'Adding to the Monday move list…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'movereq', row: p.row,
        newSpot: ov.querySelector('.mvspot').value.trim(),
        notes: ov.querySelector('.mvnotes').value.trim(), ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in again from the ☰ menu.'); }
    if (!j.scheduled) throw new Error(j.error || 'request failed');
    msg.className = 'tmmsg ok';
    msg.textContent = `✓ On the moving calendar: grouped into the ${j.date} 7:00 AM in-store moves.`;
    setTimeout(() => { ov.hidden = true; }, 2200);
  } catch (e) {
    msg.className = 'tmmsg err'; msg.textContent = '✗ ' + e.message;
    btn.disabled = false;
  }
}

/* ---------- showroom service / repair request ---------- */
const ADMINS = [
  {name: 'Melissa', email: 'melissa@brighamlarsonpianos.com'},
  {name: 'Brigham', email: 'brigham@brighamlarsonpianos.com'},
  {name: 'Karmel', email: 'karmel@brighamlarsonpianos.com'},
  {name: 'Alisa', email: 'alisa@brighamlarsonpianos.com'},
  {name: 'Susie', email: 'susie@brighamlarsonpianos.com'},
  {name: 'Walter', email: 'walter@brighamlarsonpianos.com'},
];
const SERVICE_TECHS = [
  {id: 'jakepulver.blp@gmail.com', name: 'Jake Pulver'},
  {id: 'mckinlylopp.blp@gmail.com', name: 'McKinly Lopp'},
  {id: 'curtisbiggs.blp@gmail.com', name: 'Curtis Biggs'},
];
function openServiceModal(p) {
  popPinned = false; $('#pop').hidden = true;
  const durs = [30, 60, 90, 120, 150, 180, 210, 240].map(m =>
    `<option value="${m}" ${m === 60 ? 'selected' : ''}>${m < 60 ? m + ' minutes'
      : (m / 60) + (m % 60 ? '½' : '') + (m === 60 ? ' hour' : ' hours')}</option>`).join('');
  const ov = modalShell('svcmodal', `
    <span class="x">✕</span>
    <h3>🔧 Request Service / Repair</h3>
    ${pianoHeader(p)}
    <label>Assign to technician</label>
    <select class="svtech">${SERVICE_TECHS.map((t, i) =>
      `<option value="${esc(t.id)}" ${i === 0 ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <label>What needs service / repair?</label>
    <textarea class="svnotes" rows="3" placeholder="sticky key in the middle octave, pedal squeak…"></textarea>
    <label>Time to allot</label>
    <select class="svmins">${durs}</select>
    <div class="svbtns">
      <button class="tmgo svgo">Schedule next open slot</button>
      <button class="tmgo svgoasap">Schedule ASAP</button>
    </div>
    <div class="tmmsg"></div>`);
  ov.querySelector('.svgo').onclick = () => submitService(p, ov, false);
  ov.querySelector('.svgoasap').onclick = () => submitService(p, ov, true);
}
async function submitService(p, ov, asap) {
  const msg = ov.querySelector('.tmmsg');
  const btns = ov.querySelectorAll('.svgo, .svgoasap');
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  const sel = ov.querySelector('.svtech');
  const techName = sel.options[sel.selectedIndex].text;
  btns.forEach(b => b.disabled = true);
  msg.className = 'tmmsg';
  msg.textContent = asap ? `Booking ${techName} ASAP (tomorrow, or Monday if that's a weekend)…`
    : `Finding ${techName}’s next open slot…`;
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'service', row: p.row,
        techId: sel.value, techName, asap,
        minutes: +ov.querySelector('.svmins').value,
        notes: ov.querySelector('.svnotes').value.trim(), ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in again from the ☰ menu.'); }
    if (!j.scheduled) throw new Error(j.error || 'scheduling failed');
    msg.className = 'tmmsg ok';
    msg.textContent = (asap ? `✓ ASAP booking with ${j.tech}: ` : `✓ Scheduled with ${j.tech}: `)
      + `${j.date} at ${j.time} (${j.minutes} min) — on the QC & Showroom repairs calendar, invite sent to ${j.tech.split(' ')[0]}.`;
    setTimeout(() => { ov.hidden = true; }, 3000);
  } catch (e) {
    msg.className = 'tmmsg err'; msg.textContent = '✗ ' + e.message;
    btns.forEach(b => b.disabled = false);
  }
}

/* ---------- Curtis Harper request (work-orders spreadsheet) ---------- */
function openCurtisModal(p) {
  popPinned = false; $('#pop').hidden = true;
  serialDatalist();
  const ov = modalShell('curtismodal', `
    <span class="x">✕</span>
    <h3>🎨 Curtis Harper Request</h3>
    ${pianoHeader(p)}
    <label>What is it?</label>
    <select class="chtype">
      <option value="Plate" selected>Plate</option>
      <option value="Touch up">Touch up</option>
      <option value="Decal">Decal</option>
      <option value="Other">Other</option>
    </select>
    <label>Notes</label>
    <textarea class="chnotes" rows="3" placeholder="what needs doing — refinish plate, gold decal, chip on the lid…"></textarea>
    <button class="tmgo chgo">Add to Curtis Harper's work orders</button>
    <div class="tmmsg"></div>`);
  ov.querySelector('.chgo').onclick = () => submitCurtis(p, ov);
}
async function submitCurtis(p, ov) {
  const msg = ov.querySelector('.tmmsg');
  const btn = ov.querySelector('.chgo');
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = 'Adding to the work orders sheet…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, action: 'curtis', ...reqIdent(p, ov),
        ctype: ov.querySelector('.chtype').value,
        notes: ov.querySelector('.chnotes').value.trim(), ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in again from the ☰ menu.'); }
    if (!j.ok) throw new Error(j.error || 'request failed');
    msg.className = 'tmmsg ok';
    msg.textContent = `✓ Added to Curtis Harper's work orders (${j.tab || 'Requested'} tab) and the activity log.`;
    setTimeout(() => { ov.hidden = true; }, 2200);
  } catch (e) {
    msg.className = 'tmmsg err'; msg.textContent = '✗ ' + e.message;
    btn.disabled = false;
  }
}

/* ---------- admin request (pick an admin; now or Monday batch) --------- */
function openAdminModal(p) {
  popPinned = false; $('#pop').hidden = true;
  serialDatalist();
  const ov = modalShell('adminmodal', `
    <span class="x">✕</span>
    <h3>📋 Admin Request</h3>
    ${pianoHeader(p)}
    <label>Send to</label>
    <select class="amwho">${ADMINS.map((a, i) =>
      `<option value="${esc(a.email)}" ${i === 0 ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
    <label>What do you need?</label>
    <textarea class="amnotes" rows="3" placeholder="describe the admin request…"></textarea>
    <label>When</label>
    <div class="amwhen">
      <label class="amopt"><input type="radio" name="amwhen" value="now" checked> Email now</label>
      <label class="amopt"><input type="radio" name="amwhen" value="monday"> Add to Monday morning batch (emailed to the selected admin, 8 AM)</label>
    </div>
    <button class="tmgo amgo">Send request</button>
    <div class="tmmsg"></div>`);
  ov.querySelector('.amgo').onclick = () => submitAdmin(p, ov);
  ov.querySelector('.amnotes').focus();
}
async function submitAdmin(p, ov) {
  const msg = ov.querySelector('.tmmsg');
  const btn = ov.querySelector('.amgo');
  const notes = ov.querySelector('.amnotes').value.trim();
  if (!notes) { msg.className = 'tmmsg err'; msg.textContent = 'Describe the request first.'; return; }
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  const sel = ov.querySelector('.amwho');
  const when = ov.querySelector('input[name=amwhen]:checked').value;
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = when === 'monday' ? 'Adding to the Monday batch…' : 'Emailing…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, action: 'adminreq', ...reqIdent(p, ov),
        adminEmail: sel.value, adminName: sel.options[sel.selectedIndex].text,
        notes, when, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in again from the ☰ menu.'); }
    if (!j.ok) throw new Error(j.error || 'request failed');
    msg.className = 'tmmsg ok';
    msg.textContent = j.batched
      ? `✓ Saved to the Monday batch — ${sel.options[sel.selectedIndex].text} gets it Monday at 8 AM.`
      : `✓ Emailed to ${sel.options[sel.selectedIndex].text}.`;
    setTimeout(() => { ov.hidden = true; }, 2200);
  } catch (e) {
    msg.className = 'tmmsg err'; msg.textContent = '✗ ' + e.message;
    btn.disabled = false;
  }
}

/* ---------- generic team requests (Touch Up / Priority) -------- */
function openGenericModal(p, kind) {
  popPinned = false; $('#pop').hidden = true;
  serialDatalist();
  const icons = {'Admin': '📋', 'Touch Up': '🖌', 'Priority Scheduling': '⚡'};
  const ov = modalShell('genmodal', `
    <span class="x">✕</span>
    <h3>${icons[kind] || '📌'} ${esc(kind)} Request</h3>
    ${pianoHeader(p)}
    <label>What do you need?</label>
    <textarea class="gnotes" rows="3" placeholder="describe the ${esc(kind.toLowerCase())} request…"></textarea>
    <button class="tmgo ggo">Send to Brigham</button>
    <div class="tmmsg"></div>`);
  ov.querySelector('.ggo').onclick = () => submitGeneric(p, kind, ov);
  ov.querySelector('.gnotes').focus();
}
async function submitGeneric(p, kind, ov) {
  const msg = ov.querySelector('.tmmsg');
  const btn = ov.querySelector('.ggo');
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = 'Sending…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, action: 'teamreq', ...reqIdent(p, ov),
        kind, notes: ov.querySelector('.gnotes').value.trim(), ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in again from the ☰ menu.'); }
    if (!j.ok) throw new Error(j.error || 'request failed');
    msg.className = 'tmmsg ok';
    msg.textContent = `✓ ${kind} request emailed to Brigham and logged.`;
    setTimeout(() => { ov.hidden = true; }, 2000);
  } catch (e) {
    msg.className = 'tmmsg err'; msg.textContent = '✗ ' + e.message;
    btn.disabled = false;
  }
}

/* ---------- Waiting-on-OTHER note popup ---------- */
function openWaitNoteModal(p, phase, pop) {
  const who = phase.replace('Waiting on ', '');
  const other = who === 'OTHER';
  const ov = modalShell('waitmodal', `
    <span class="x">✕</span>
    <h3>⏳ ${esc(phase)} — details</h3>
    ${pianoHeader(p)}
    <label>${other ? 'What is being waited on?' : `Notes <small>(optional — what are we waiting on ${esc(who)} for?)</small>`}</label>
    <textarea class="wnotes" rows="3" placeholder="${other ? 'parts from supplier, customer decision, insurance…' : 'decision, approval, parts…'}"></textarea>
    <label>Check back on this piano in…</label>
    <select class="wsnooze">
      <option value="3">3 days</option>
      <option value="7" selected>1 week</option>
      <option value="14">2 weeks</option>
      <option value="30">1 month</option>
      <option value="">no reminder date</option>
    </select>
    <button class="tmgo wgo">Set phase to ${esc(phase)}</button>
    <div class="tmmsg"></div>`);
  const sel = pop.querySelector('.phsel');
  ov.onclick = ev => {
    if (ev.target === ov || ev.target.closest('.x')) {
      ov.hidden = true;
      if (sel) sel.value = p.phase || '';   // cancelled — revert the dropdown
    }
  };
  ov.querySelector('.wgo').onclick = () => {
    const note = ov.querySelector('.wnotes').value.trim();
    if (other && !note) {
      ov.querySelector('.tmmsg').className = 'tmmsg err';
      ov.querySelector('.tmmsg').textContent = 'Say what is being waited on first.';
      return;
    }
    const days = ov.querySelector('.wsnooze').value;
    let checkBack = '';
    if (days) {
      const d = new Date(Date.now() + (+days) * 86400000);
      checkBack = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    }
    ov.hidden = true;
    setPhase(p, phase, pop, {note, checkBack});
  };
  ov.querySelector('.wnotes').focus();
}

/* ---------- For Sale price popup ---------- */
function openPriceModal(p) {
  const ov = modalShell('pricemodal', `
    <span class="x">✕</span>
    <h3>💲 What is the sale price?</h3>
    ${pianoHeader(p)}
    <label>Sale price <small>(optional — you can add it later in the Piano Log)</small></label>
    <input class="prin" inputmode="decimal" placeholder="e.g. 14998" ${p.price ? `value="${esc(String(p.price).replace(/[^0-9.]/g, ''))}"` : ''}>
    <div class="prbtns">
      <button class="tmgo prgo">Save price</button>
      <button class="prskip">📧 Request Price</button>
    </div>
    <div class="tmmsg"></div>`);
  ov.querySelector('.prskip').onclick = () => submitPriceRequest(p, ov);
  ov.querySelector('.prgo').onclick = () => submitPrice(p, ov);
  ov.querySelector('.prin').focus();
}
async function submitPrice(p, ov) {
  const msg = ov.querySelector('.tmmsg');
  const btn = ov.querySelector('.prgo');
  const raw = ov.querySelector('.prin').value.trim();
  if (!raw) { ov.hidden = true; return; }   // empty = same as skip
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = 'Saving the price…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'setprice', row: p.row,
        price: raw, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in again from the ☰ menu.'); }
    if (!j.ok) throw new Error(j.error || 'save failed');
    p.price = j.price;
    const edit = pendingEdits.get(p.row) || {};
    edit.price = j.price; pendingEdits.set(p.row, edit);
    renderMap();
    msg.className = 'tmmsg ok';
    msg.textContent = `✓ Price saved: ${j.price} — a printable tag was emailed to info@ to put on the piano.`;
    setTimeout(() => { ov.hidden = true; }, 2600);
  } catch (e) {
    msg.className = 'tmmsg err'; msg.textContent = '✗ ' + e.message;
    btn.disabled = false;
  }
}

// "Request Price" on the For Sale popup: emails Brigham to price this piano
async function submitPriceRequest(p, ov) {
  const msg = ov.querySelector('.tmmsg');
  const btn = ov.querySelector('.prskip');
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = 'Emailing Brigham…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'requestprice', row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in again from the ☰ menu.'); }
    if (!j.ok) throw new Error(j.error || 'request failed');
    msg.className = 'tmmsg ok';
    msg.textContent = '✓ Emailed AND texted to Brigham — his reply sets the price automatically.';
    setTimeout(() => { ov.hidden = true; }, 2400);
  } catch (e) {
    msg.className = 'tmmsg err'; msg.textContent = '✗ ' + e.message;
    btn.disabled = false;
  }
}

/* ---------- tuning request modal ---------- */
const KORBAN_CAL = 'korbangreenhalgh.blp@gmail.com';
function openTuneModal(p) {
  popPinned = true;
  let ov = $('#tunemodal');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'tunemodal';
    document.body.appendChild(ov);
  }
  const nm = [(p.year || ''), p.make, p.model].filter(Boolean).join(' ') || p.summary || 'Piano';
  ov.innerHTML = `<div class="tmcard">
    <span class="x">✕</span>
    <h3>🎵 Request a Tuning</h3>
    <div class="tmpiano"><b>${esc(nm)}</b>
      <span>Serial ${esc(p.serial)}${p.location ? ' · Spot ' + esc(p.location) : ''}</span></div>
    <label>Assign to technician</label>
    <select class="tmtech"><option value="${KORBAN_CAL}">Korban Greenhalgh</option></select>
    <label>Additional repair requests <small>(optional)</small></label>
    <textarea class="tmrepairs" rows="2" placeholder="sticky keys, buzzing damper, pedal squeak…"></textarea>
    <label>Notes <small>(optional)</small></label>
    <textarea class="tmnotes" rows="2" placeholder="anything the technician should know"></textarea>
    <button class="tmgo">Schedule next open slot</button>
    <div class="tmmsg"></div>
  </div>`;
  ov.hidden = false;
  ov.onclick = ev => {
    if (ev.target === ov || ev.target.closest('.x')) ov.hidden = true;
  };
  fillTechs(ov);
  ov.querySelector('.tmgo').onclick = () => submitTune(p, ov);
}
// technician dropdown, from the bridge's calendar list (Korban preselected)
async function fillTechs(ov) {
  if (!S.techs) {
    try {
      const j = await (await fetch(BRIDGE_URL + '?fn=techs', {redirect: 'follow'})).json();
      if (j.techs && j.techs.length) S.techs = j.techs;
    } catch (e) { /* dropdown falls back to Korban only */ }
  }
  const sel = ov.querySelector('.tmtech');
  if (!S.techs || !sel) return;
  sel.innerHTML = S.techs.map(t =>
    `<option value="${esc(t.id)}" ${t.isDefault || t.id === KORBAN_CAL ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}
async function submitTune(p, ov) {
  const msg = ov.querySelector('.tmmsg');
  const btn = ov.querySelector('.tmgo');
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  const sel = ov.querySelector('.tmtech');
  const techId = sel.value;
  const techName = sel.options[sel.selectedIndex].text;
  btn.disabled = true;
  msg.className = 'tmmsg';
  msg.textContent = `Finding ${techName}’s next open slot…`;
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'tune', techId, techName,
        repairs: ov.querySelector('.tmrepairs').value.trim(),
        notes: ov.querySelector('.tmnotes').value.trim(),
        row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') {
      lsDel('blpPin');
      throw new Error('Not authorized — sign in again (☰ menu), then click Schedule.');
    }
    if (!j.scheduled) throw new Error(j.error || 'scheduling failed');
    msg.className = 'tmmsg ok';
    msg.textContent = `✓ Scheduled with ${j.tech || techName}: ${j.date} at ${j.time} — `
      + `on their calendar and the master tuning calendar.`;
    // reflect immediately: piano turns blue, card gains its scheduled row
    S.data.tunings = S.data.tunings || {upcoming: [], past: []};
    S.data.tunings.upcoming.push([j.iso || localDay(), j.hhmm || j.time,
      `${j.title || 'Tuning'} SN ${p.serial}`]);
    renderMap(); renderKpis();
    setTimeout(() => { ov.hidden = true; openPop(p.row, null, true); }, 2200);
  } catch (e) {
    msg.className = 'tmmsg err';
    msg.textContent = '✗ ' + e.message;
    btn.disabled = false;
  }
}

// "Request Brigham Task": note → the Brigham Tasks tab on the report sheet,
// which the Shop Manager's "Brigham" view renders as his priority list.
// Auth: the map's Google sign-in (company account), else the BLP app
// passcode (asked once, stored on this device).
// Accidental duplicate cleanup: an admin mistypes/misses a serial, adds a
// SECOND row for a piano already on the map. Rather than a destructive
// hard-delete, this prefixes the OWNER column with "(DUPLICATE)" — the
// data parsers already exclude any row whose owner text contains that
// word (same rule as "NEVER RECEIVED"), so it vanishes from the map and
// every report immediately, but the row itself, and full history, stay in
// the Piano Log — reversible any time by removing that prefix in the sheet.
function openDuplicateModal(p) {
  popPinned = false; $('#pop').hidden = true;
  const ov = modalShell('dupmodal', `
    <span class="x">✕</span>
    <h3>🗑 Mark as Duplicate</h3>
    ${pianoHeader(p)}
    <p class="tmwarn">This removes <b>this specific row</b> (row ${p.row}, serial ${esc(p.serial || '—')})
      from the map and every report — use it when the SAME piano got added twice by mistake.
      It stays in the Piano Log with an "(DUPLICATE)" tag on Owner, so nothing is actually deleted
      and Brigham/Karmel can undo it by removing that tag.</p>
    <label>Which row is the REAL one? <small>(optional — goes in the activity log)</small></label>
    <input class="dupreal" placeholder="e.g. the other row's serial, or a spot number">
    <label><input type="checkbox" class="dupconfirm"> I've checked — this row really is a duplicate</label>
    <button class="tmgo dupgo">Mark this row as duplicate</button>
    <div class="tmmsg"></div>`);
  ov.querySelector('.dupgo').onclick = () => submitDuplicate(p, ov);
}
async function submitDuplicate(p, ov) {
  const msg = ov.querySelector('.tmmsg');
  const btn = ov.querySelector('.dupgo');
  if (!ov.querySelector('.dupconfirm').checked) {
    msg.className = 'tmmsg err'; msg.textContent = 'Check the confirmation box first.';
    return;
  }
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in with Google (☰ menu) or enter the team PIN first.'; return; }
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = 'Marking…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, row: p.row, action: 'markduplicate',
        realRef: ov.querySelector('.dupreal').value.trim(), ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in again from the ☰ menu.'); }
    if (!j.ok) throw new Error(j.error || 'failed');
    msg.className = 'tmmsg ok';
    msg.textContent = '✓ Marked as duplicate — it will drop off the map on the next refresh.';
    setTimeout(() => { ov.hidden = true; }, 2200);
  } catch (e) {
    msg.className = 'tmmsg err'; msg.textContent = '✗ ' + e.message;
    btn.disabled = false;
  }
}

function openBrighamModal(p) {
  popPinned = false; $('#pop').hidden = true;
  serialDatalist();
  const ov = modalShell('brigmodal', `
    <span class="x">✕</span>
    <h3>🗒 Brigham Task</h3>
    ${pianoHeader(p)}
    <label>Note for Brigham <small>— lands on his priority list (Shop Manager → Brigham)</small></label>
    <textarea class="gnotes" rows="3" placeholder="what does Brigham need to do?"></textarea>
    <input class="brigkey" type="password" placeholder="BLP app passcode (once on this device)" hidden
      style="width:100%;border:1px solid #d9dde1;border-radius:7px;padding:7px 9px;font-size:12.5px;margin-top:6px">
    <button class="tmgo bgo">Add to Brigham's priority list</button>
    <div class="tmmsg"></div>`);
  ov.querySelector('.bgo').onclick = () => submitBrigham(p, ov);
  ov.querySelector('.gnotes').focus();
}

async function submitBrigham(p, ov) {
  const msg = ov.querySelector('.tmmsg');
  const btn = ov.querySelector('.bgo');
  const note = ov.querySelector('.gnotes').value.trim();
  if (!note) { msg.className = 'tmmsg err'; msg.textContent = 'Write the task first.'; return; }
  const af = authFields();
  const keyIn = ov.querySelector('.brigkey');
  const key = (lsGet('blp.appkey') || '').trim() || keyIn.value.trim();
  if (!af.idToken) {
    msg.className = 'tmmsg err';
    msg.textContent = 'Sign in with Google (☰ menu) first — requests are logged under your name.';
    return;
  }
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = 'Sending…';
  const gp = ov.querySelector('.gpiano');
  const nm = p ? ([p.make, p.model].filter(Boolean).join(' ') || p.summary || '') : ((gp && gp.value.trim()) || '');
  const label = (nm + (p && p.serial ? ' SN ' + p.serial : '') + (p && p.location ? ' @ ' + p.location : '')).trim();
  try {
    const headers = {'content-type': 'application/json'};
    if (af.idToken) headers.authorization = 'Bearer ' + af.idToken;
    const r = await fetch(BRIGHAM_API, {method: 'POST', headers,
      body: JSON.stringify({key, add: {piano: label.slice(0, 80), note,
        from: (af.user && (af.user.name || af.user.email)) || 'Store Map'}})});
    const j = await r.json();
    if (j.ok) {
      if (keyIn.value.trim()) lsSet('blp.appkey', keyIn.value.trim());
      msg.className = 'tmmsg ok';
      msg.textContent = '✓ On Brigham’s priority list.';
      setTimeout(() => { ov.hidden = true; }, 1800);
    } else if (r.status === 401) {
      lsDel('blp.appkey');
      keyIn.hidden = false; keyIn.value = ''; keyIn.focus();
      msg.className = 'tmmsg err'; msg.textContent = '✗ ' + (j.error || 'not authorized');
      btn.disabled = false;
    } else {
      msg.className = 'tmmsg err'; msg.textContent = '✗ ' + (j.error || 'failed');
      btn.disabled = false;
    }
  } catch (e) {
    msg.className = 'tmmsg err'; msg.textContent = '✗ ' + (e.message || e);
    btn.disabled = false;
  }
}

// one-tap progress photo: camera → downscale → the piano's Tech Drive folder
// (named serial__phase__date so client updates can pull photos per stage)
async function uploadPhoto(p, input, pop) {
  const f = input.files && input.files[0];
  if (!f) return;
  const msg = pop.querySelector('.photomsg');
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'photomsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  try {
    msg.className = 'photomsg'; msg.textContent = 'Preparing photo…';
    const dataUrl = await downscalePhoto(f, 1800, 0.85);
    msg.textContent = 'Uploading to the piano’s Tech folder…';
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, action: 'photo', serial: p.serial, row: p.row,
        stage: effectivePhase(p) || '', mime: 'image/jpeg',
        data: dataUrl.split(',')[1], ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') {
      lsDel('blpPin');
      msg.className = 'photomsg err'; msg.textContent = '✗ Not authorized — sign in again (☰ menu), then retry.';
    } else if (j.error) {
      msg.className = 'photomsg err'; msg.textContent = '✗ ' + j.error;
    } else if (!j.saved) {
      msg.className = 'photomsg err';
      msg.textContent = '✗ The bridge needs an update — paste the repo’s DailyReport.gs into Apps Script and deploy a new version.';
    } else {
      msg.className = 'photomsg ok'; msg.textContent = `✓ Saved as ${j.name}`;
    }
  } catch (e) {
    msg.className = 'photomsg err'; msg.textContent = '✗ ' + (e.message || e);
  }
  input.value = '';   // allow taking another photo right away
}

function downscalePhoto(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    // watchdog: a file the browser can't decode sometimes never fires
    // onload OR onerror — don't let the whole submit hang on it
    setTimeout(() => reject(new Error('image took too long to read')), 20000);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const sc = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read image')); };
    img.src = url;
  });
}

function teamPin(forceAsk) {
  let pin = lsGet('blpPin') || '';
  if (!pin || forceAsk) {
    pin = (prompt('BLP team PIN (needed once on this device to move pianos):') || '').trim();
    if (pin) lsSet('blpPin', pin);
  }
  return pin;
}
// Changes REQUIRE a Google sign-in so every action is logged by name —
// the PIN alone no longer unlocks writes (it still rides along for the
// bridge's legacy check). Signed-out users are pointed at the menu.
function writeAuth() {
  const u = authUser();
  if (u) {
    const pin = lsGet('blpPin') || '';
    // Google session past its hour and no PIN to fall back on: renew the
    // token via the redirect flow (login_hint skips the account chooser,
    // so it's a ~2s round trip). The caller's message shows meanwhile.
    if (!u.pinOnly && !pin && u.exp * 1000 < Date.now() + 30000) {
      setTimeout(() => oidcLogin(u.email), 400);
      return {pin: '', ok: false, renewing: true};
    }
    return {pin, ok: true};
  }
  try {
    // surface the sign-in box so "why can't I edit?" answers itself
    $('#side').classList.add('open');
    $('#scrim').classList.add('show');
    const box = $('#authbox');
    if (box) box.scrollIntoView({block: 'nearest'});
  } catch (e) {}
  return {pin: '', ok: false};
}

/* ---------- Google sign-in (identity + PIN-free writes) ---------------- */
// Signing in attaches a verified name to every change AND replaces the
// team PIN (the bridge trusts verified BLP accounts). Tokens expire
// hourly, so GIS auto-refreshes on page load.
function authUser() {
  try { return JSON.parse(lsGet('blpUser') || 'null'); }
  catch (e) { return null; }
}
// fields sent with every bridge write: fresh token when we have one,
// plus name/email so attribution still works if the token just expired
function authFields() {
  const u = authUser();
  if (!u) return {};
  const out = {user: {name: u.name, email: u.email}};
  if (u.exp * 1000 > Date.now() + 30000) out.idToken = u.tok;
  return out;
}

/* ---------- permissions — mirrors the bridge's lists (UI gating only;
 * the bridge re-verifies the Google token on every gated write) ---------- */
const OWNER_EMAILS = ['brigham@brighamlarsonpianos.com', 'karmel@brighamlarsonpianos.com'];
const ADMIN_EMAILS = OWNER_EMAILS.concat(['melissa@brighamlarsonpianos.com',
  'alisa@brighamlarsonpianos.com', 'susie@brighamlarsonpianos.com', 'walter@brighamlarsonpianos.com']);
const PAYROLL_ADMIN_EMAILS = OWNER_EMAILS.concat(['melissa@brighamlarsonpianos.com']);
const TIMELOG_ADMIN_EMAILS = OWNER_EMAILS.concat(
  ['markhales.blp@gmail.com', 'matthewwessman.blp@gmail.com', 'jacobmower.blp@gmail.com']);
function userEmail() { const u = authUser(); return u && u.email ? String(u.email).toLowerCase() : ''; }
function isOwner() { return OWNER_EMAILS.includes(userEmail()); }
function isAdminUser() { return ADMIN_EMAILS.includes(userEmail()); }
function isPayrollAdmin() { return PAYROLL_ADMIN_EMAILS.includes(userEmail()); }
function isTimelogAdmin() { return TIMELOG_ADMIN_EMAILS.includes(userEmail()); }
// 📊 Manager console — the owners and the Lead Manager only (Brigham 9/1)
function isManagerConsole() { return isOwner() || userEmail() === 'markhales.blp@gmail.com'; }
// only BLP accounts may sign in — a personal Gmail gets bounced back to
// Google's account chooser instead of silently half-working
function blpAccount(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return true;   // PIN-gate identities carry no email
  return /@brighamlarsonpianos\.com$/.test(e) || /\.blp@gmail\.com$/.test(e)
    || e === 'brighamlarson@gmail.com';
}
function onGoogleCred(resp) {
  try {
    const claims = JSON.parse(atob(resp.credential.split('.')[1]
      .replace(/-/g, '+').replace(/_/g, '/')));
    if (claims.email && !blpAccount(claims.email)) {
      lsSet('blpBadAcct', claims.email);   // gate explains + offers the chooser
      lsDel('blpUser');
      renderAuth();
      return;
    }
    lsDel('blpBadAcct');
    lsSet('blpUser', JSON.stringify({
      tok: resp.credential, exp: claims.exp,
      name: claims.name || claims.email, email: claims.email, pic: claims.picture || '',
    }));
  } catch (e) { /* malformed credential — stay signed out */ }
  renderAuth();
}
function signOut() {
  ['blpUser', 'blpNonce', 'blpGsiCred'].forEach(lsDel);
  try { sessionStorage.removeItem('blp.oauth.silent'); } catch (e) { /* storage unavailable */ }
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  renderAuth();
}
// someone already stored a personal account (before the rule above existed):
// clear it on load so their next tap gets the account chooser fresh
(() => {
  try {
    const u = JSON.parse(lsGet('blpUser') || 'null');
    if (u && u.email && !blpAccount(u.email)) {
      lsSet('blpBadAcct', u.email);
      ['blpUser', 'blpNonce', 'blpGsiCred'].forEach(lsDel);
    }
  } catch (e) { /* unreadable — leave it */ }
})();
// Sign-in is REQUIRED: the map stays behind a full-screen Google gate until
// we know who's clicking. A signed-in user whose hourly token lapsed mid-
// session is NOT locked back out — the silent refresh handles that, and
// attribution falls back to their stored name/email meanwhile.
function authGate() {
  const ov = document.getElementById('authgate');
  if (!ov) return;
  if (!GOOGLE_CLIENT_ID) { ov.hidden = true; return; }
  const signedIn = !!authUser();
  ov.hidden = signedIn;
  if (!signedIn) {
    const gb = document.getElementById('gateBtn');
    if (gb) {
      gb.innerHTML = '<button class="goauth" type="button">Sign in with Google</button>';
      // no arg: always offer Google's account chooser (passing the click
      // event here used to become login_hint and skip the chooser)
      gb.querySelector('.goauth').onclick = () => { lsDel('blpBadAcct'); oidcLogin(); };
    }
    const bad = lsGet('blpBadAcct');
    const msg = document.getElementById('agMsg');
    if (msg) {
      msg.className = bad ? 'agmsg err' : 'agmsg';
      msg.textContent = bad
        ? bad + ' is a personal account and won\u2019t work here — tap Sign in and pick your BLP account (or "Use another account").'
        : '';
    }
  }
}
function renderAuth() {
  authGate();
  // 📅 Scheduling (management dashboard) — managers & owners only
  const ns = $('#navSched');
  if (ns) ns.hidden = !isTimelogAdmin();
  // 👥 Team + 🛡 Admin dashboards — admin + managers + owners
  const nt = $('#navTeam');
  if (nt) nt.hidden = !isTeamAdmin();
  const na = $('#navAdmDash');
  if (na) na.hidden = !isTeamAdmin();
  // 📊 Manager console — Brigham, Karmel & Mark only
  const nm = $('#navManager');
  if (nm) nm.hidden = !isManagerConsole();
  // top-bar identity chip — who's signed in, always visible
  const tw = $('#topWho');
  if (tw && !tw.dataset.wired) {
    tw.dataset.wired = '1';
    // tap your name for a small account menu — who's signed in (name, email,
    // role) plus Sign out. Signing out brings the gate back for the next
    // person, so everything they do is logged under THEIR name.
    tw.onclick = () => {
      const m = $('#whoTopMenu');
      const u = authUser();
      if (!u) return;
      if (!m) {   // menu container missing — fall back to the old direct flow
        if (confirm('Sign out ' + (u.name || 'this user') + '?\n\nThe sign-in screen comes back so the next person can log in as themselves.')) signOut();
        return;
      }
      if (!m.hidden) { m.hidden = true; return; }
      const role = userRole();
      const roleTag = role === 'admin' ? 'ADMIN' : role === 'full' ? 'MANAGER · FULL' : role === 'edit' ? 'MANAGER · EDIT' : '';
      const expired = !u.pinOnly && u.exp * 1000 < Date.now();
      m.innerHTML = `<div class="whohead">
          ${u.pic ? `<img class="authpic" src="${esc(u.pic)}" alt="">` : '<span>👤</span>'}
          <div><b>${esc(u.name || '')}</b>
            ${u.email ? `<small>${esc(u.email)}</small>` : ''}
            ${roleTag ? `<small><i class="rolechip">${roleTag}</i></small>` : (u.pinOnly ? '<small>signed in · team PIN</small>' : '')}
            ${expired ? '<small class="whoexp">session expired — sign in again (☰ menu)</small>' : ''}</div>
        </div>
        <button class="whoout">⏻ Sign out</button>`;
      m.querySelector('.whoout').onclick = () => {
        m.hidden = true;
        if (confirm('Sign out ' + (u.name || 'this user') + '?\n\nThe sign-in screen comes back so the next person can log in as themselves.')) signOut();
      };
      m.hidden = false;
      const r = tw.getBoundingClientRect();   // pin under the chip, clamped in the viewport
      const menuW = Math.max(190, m.offsetWidth || 0);
      const right = Math.min(
        Math.max(8, window.innerWidth - r.right),
        Math.max(8, window.innerWidth - menuW - 8));
      m.style.position = 'fixed';
      m.style.top = (r.bottom + 6) + 'px';
      m.style.right = right + 'px';
      m.style.left = 'auto';
    };
    document.addEventListener('click', e => {
      if (!e.target.closest('#topWho') && !e.target.closest('#whoTopMenu')) {
        const m = $('#whoTopMenu'); if (m) m.hidden = true;
      }
    });
  }
  if (tw) {
    const tu = authUser();
    tw.innerHTML = tu
      ? `${tu.pic ? `<img src="${esc(tu.pic)}" alt="">` : '👤'}<span>${esc((tu.name || '').split(/\s+/)[0])}</span>`
      : '';
  }
  const box = $('#authbox');
  if (!box) return;
  if (!GOOGLE_CLIENT_ID) { box.hidden = true; return; }
  box.hidden = false;
  const u = authUser();
  if (u && u.pinOnly) {
    // PIN + name entry from the gate (Google button unavailable on that device)
    box.innerHTML = `<b>Signed in · team PIN</b>
      <span class="authname">👤 ${esc(u.name)}</span>
      <button class="authout" id="authOut">sign out</button>`;
    $('#authOut').onclick = signOut;
    return;
  }
  const expired = u && u.exp * 1000 < Date.now();
  if (u && expired) {
    // hourly Google token ran out and the silent refresh didn't come back —
    // surface it instead of looking "stuck" on Signed in
    box.innerHTML = `<b>Session expired</b>
      <div class="authhint">${esc(u.name)} — sign in again so changes save under your name</div>
      <div id="gsiBtn"></div>
      <button class="authout" id="authOut">sign out</button>`;
    $('#authOut').onclick = signOut;
    $('#gsiBtn').innerHTML = '<button class="goauth sm" type="button">Sign in with Google</button>';
    $('#gsiBtn').querySelector('.goauth').onclick = () => oidcLogin();
  } else if (u) {
    const role = userRole();
    const roleTag = role === 'admin' ? 'ADMIN' : role === 'full' ? 'MANAGER · FULL' : role === 'edit' ? 'MANAGER · EDIT' : '';
    box.innerHTML = `<b>Signed in${roleTag ? ` <i class="rolechip">${roleTag}</i>` : ''}</b>
      <span class="authname">${u.pic ? `<img class="authpic" src="${esc(u.pic)}" alt="">` : '👤 '}${esc(u.name)}</span>
      <button class="authout" id="authOut">sign out</button>`;
    $('#authOut').onclick = signOut;
  } else {
    box.innerHTML = `<b>Team member</b>
      <div class="authhint">Sign in so changes are logged under your name — no team PIN needed</div>
      <div id="gsiBtn"></div>`;
    $('#gsiBtn').innerHTML = '<button class="goauth sm" type="button">Sign in with Google</button>';
    $('#gsiBtn').querySelector('.goauth').onclick = () => oidcLogin();
  }
}
function initAuth() {
  if (!GOOGLE_CLIENT_ID) { renderAuth(); return; }
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.onerror = () => renderAuth();   // GIS blocked/offline — the gate still offers the PIN
  s.onload = () => {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID, callback: onGoogleCred,
      auto_select: true, use_fedcm_for_prompt: true, itp_support: true,
      // full-page redirect instead of a popup: iOS Safari's tracking
      // prevention breaks the popup flow (400 at accounts.google.com after
      // a QR scan). Google form_posts the credential to gsi-callback, which
      // stashes it and bounces home; boot() consumes it (blpGsiCred).
      ux_mode: 'redirect',
      login_uri: 'https://blpstoremap.netlify.app/.netlify/functions/gsi-callback',
    });
    renderAuth();
    // silently refresh the hourly token for already-signed-in users —
    // on load and every 5 minutes while the page stays open
    const refresh = () => {
      const u = authUser();
      if (!u || u.pinOnly) return;   // PIN users have no Google token to refresh
      if (u.exp * 1000 < Date.now() + 600000) { try { google.accounts.id.prompt(); } catch (ig) {} }
      if (u.exp * 1000 < Date.now()) renderAuth();   // flip the box to "Session expired"
    };
    refresh();
    setInterval(refresh, 300000);
  };
  document.head.appendChild(s);
  renderAuth();
}
/* Google's own sign-in button (GIS) 400s on iOS Safari in both its popup
 * and redirect modes, so the visible sign-in controls navigate to Google's
 * plain OAuth page instead — out and back with the ID token in the hash.
 * Same JWT, same onGoogleCred, works identically in every browser. */
function oidcLogin(hintEmail) {
  const nonce = (crypto.randomUUID ? crypto.randomUUID()
    : String(Math.random()).slice(2) + Date.now());
  lsSet('blpNonce', nonce);
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: 'https://blpstoremap.netlify.app/',
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
  });
  // re-auth of a known account: skip the chooser, Google bounces right back
  if (hintEmail) q.set('login_hint', hintEmail);
  else q.set('prompt', 'select_account');
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}
function consumeOidcHash() {
  const m = /[#&]id_token=([^&]+)/.exec(location.hash || '');
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const tok = m[1];
    const claims = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    // nonce must round-trip — rejects any token we didn't just ask for
    if (claims.nonce && claims.nonce === lsGet('blpNonce')) {
      lsDel('blpNonce');
      onGoogleCred({credential: tok});
    }
  } catch (e) { /* malformed token — stay signed out */ }
}
consumeOidcHash();
// finish a redirect sign-in: gsi-callback leaves the credential here
try {
  const redirCred = localStorage.getItem('blpGsiCred');
  if (redirCred) { localStorage.removeItem('blpGsiCred'); onGoogleCred({credential: redirCred}); }
} catch (e) { /* storage unavailable — sign-in will be offered again */ }
initAuth();
// gate fallback: name + team PIN for devices where the Google button
// won't load (Safari tracking prevention, ad blockers) — attribution
// still works because every write carries the typed name
{
  const agGo = document.getElementById('agGo');
  const agTry = () => {
    const name = (document.getElementById('agName').value || '').trim();
    const pin = (document.getElementById('agPin').value || '').trim();
    const m = document.getElementById('agMsg');
    if (!name) { m.className = 'agmsg err'; m.textContent = 'Enter your name first.'; return; }
    if (!pin) { m.className = 'agmsg err'; m.textContent = 'Enter the team PIN.'; return; }
    lsSet('blpPin', pin);
    lsSet('blpUser', JSON.stringify({tok: '', exp: 0, name, email: '', pic: '', pinOnly: true}));
    renderAuth();
  };
  if (agGo) {
    agGo.onclick = agTry;
    ['agName', 'agPin'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.onkeydown = e => { if (e.key === 'Enter') agTry(); };
    });
  }
}

async function movePiano(p, dest, pop, confirmed) {
  const msg = pop.querySelector('.mvmsg');
  if (!dest) { msg.textContent = 'Type a spot number or area name first.'; return; }
  if (!isValidDest(dest)) {
    msg.textContent = '\u201c' + dest + '\u201d isn\u2019t a spot on the map \u2014 pick one from the suggestion list.';
    return;
  }
  const known = S.slotFloor.has(dest.toLowerCase());
  // moving onto a numbered spot someone else holds bumps them to the attic
  // (the bridge's bumpOthers_) \u2014 confirm inline first. Inline, not
  // window.confirm, which is blocked in some embedded browsers.
  const occupants = (known && SLOT_RE.test(dest))
    ? (S.bySlot.get(dest.toLowerCase()) || []).filter(x => x.row !== p.row)
    : [];
  if (occupants.length && !confirmed) {
    popPinned = true;
    const names = occupants.map(x => (x.summary || (x.serial ? '#' + x.serial : 'a piano')).slice(0, 34)).join(', ');
    const mine = (p.summary || (p.serial ? '#' + p.serial : 'this piano')).slice(0, 34);
    msg.className = 'mvmsg';
    msg.innerHTML = `Spot ${esc(dest)} currently holds <b>${esc(names)}</b>. `
      + `Move <b>${esc(mine)}</b> there and bump ${occupants.length > 1 ? 'them' : 'it'} to the Attic?`
      + `<span class="mvconfirm"><button class="mvyes">\u2713 Move &amp; bump</button><button class="mvno">Cancel</button></span>`;
    msg.querySelector('.mvyes').onclick = ev => { ev.stopPropagation(); movePiano(p, dest, pop, true); };
    msg.querySelector('.mvno').onclick = ev => { ev.stopPropagation(); msg.className = 'mvmsg'; msg.textContent = ''; };
    return;
  }
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { msg.textContent = 'A team PIN is required to move pianos.'; return; }
  msg.textContent = 'Updating Piano Log…';
  try {
    // straight to the Apps Script bridge; text/plain avoids CORS preflight
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'move', newLocation: dest, row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') {
      lsDel('blpPin');
      msg.className = 'mvmsg err'; msg.textContent = '✗ Wrong PIN — click Move to try again.';
      return;
    }
    if (j.moved) {
      msg.className = 'mvmsg ok';
      msg.textContent = `✓ Moved from ${j.previous || '—'} to ${j.location}`
        + (known ? '' : ' (not a numbered map spot — it will show in reports)');
      applyBumps(j.bumped);
      if (j.bumped && j.bumped.length) {
        msg.textContent += ` — bumped ${j.bumped.map(b => b.summary || 'a piano').join(', ')} to the attic`;
      }
      p.location = j.location;
      p.isSlot = SLOT_RE.test(j.location);
      const edit = pendingEdits.get(p.row) || {};
      edit.location = j.location; pendingEdits.set(p.row, edit);
      index(); renderKpis(); renderMap(); renderReport();
    } else {
      msg.className = 'mvmsg err'; msg.textContent = '✗ ' + (j.error || 'update failed');
    }
  } catch (e) {
    msg.className = 'mvmsg err'; msg.textContent = '✗ ' + e.message + ' — not saved';
  }
}
/* Shop queue reorder. The queue is the row order of the Custom Shopwork
   section, so the bridge physically moves the piano's row — anchored by the
   SERIAL of the piano currently at the target position ("put S before/after
   T"), never by row numbers, which shift constantly. Every other queue
   number adjusts organically because they all derive from row order. */
async function queuePiano(p, newPos, pop) {
  const msg = pop.querySelector('.qmsg');
  const members = S.data.pianos.filter(x => x.queuePos > 0)
    .sort((a, b) => a.queuePos - b.queuePos);
  const total = members.length;
  if (!Number.isInteger(newPos) || newPos < 1 || newPos > total) {
    msg.className = 'mvmsg qmsg err';
    msg.textContent = `Queue number must be 1–${total}.`;
    return;
  }
  if (newPos === p.queuePos) {
    msg.className = 'mvmsg qmsg ok';
    msg.textContent = `Already queue #${newPos}.`;
    return;
  }
  const anchor = members[newPos - 1];
  if (!anchor || !anchor.serial) {
    msg.className = 'mvmsg qmsg err';
    msg.textContent = `The piano at #${newPos} has no serial — reorder in the Piano Log.`;
    return;
  }
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { msg.textContent = 'A team PIN is required to reorder the queue.'; return; }
  msg.className = 'mvmsg qmsg';
  msg.textContent = 'Reordering the shop queue…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, action: 'queue', serial: p.serial,
        anchor_serial: anchor.serial,
        where: newPos > p.queuePos ? 'after' : 'before',
        from_pos: p.queuePos, to_pos: newPos, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') {
      lsDel('blpPin');
      msg.className = 'mvmsg qmsg err';
      msg.textContent = '✗ Wrong PIN — click Set queue # to try again.';
      return;
    }
    if (!j.ok) {
      msg.className = 'mvmsg qmsg err';
      msg.textContent = '✗ ' + (j.error || 'queue update failed');
      return;
    }
    // renumber locally so the map reflects the new order before the next poll
    members.splice(p.queuePos - 1, 1);
    members.splice(newPos - 1, 0, p);
    members.forEach((x, k) => { x.queuePos = k + 1; });
    msg.className = 'mvmsg qmsg ok';
    msg.textContent = `✓ Now queue #${newPos} of ${total}`;
    const chip = pop.querySelector('.qchip');
    if (chip) chip.textContent = `Queue #${p.queuePos}/${p.queueTotal}`;
    const qin = pop.querySelector('.qin');
    if (qin) qin.value = p.queuePos;
  } catch (e) {
    msg.className = 'mvmsg qmsg err';
    msg.textContent = '✗ ' + e.message + ' — not saved';
  }
}
function openPop(row, el, pinned) {
  S.recentRows = [row].concat((S.recentRows || []).filter(r => r !== row)).slice(0, 8);
  cancelHide();
  const p = S.data.pianos.find(x => x.row === row);
  if (!p) return;
  popPinned = pinned;
  const pop = $('#pop');
  pop.innerHTML = popHTML(p);
  wirePop(p);
  place(pop, el);
}
function openSlotPop(id) {
  const ps = S.bySlot.get(id.toLowerCase()) || [];
  const pop = $('#pop');
  popPinned = true;
  if (ps.length === 1) { pop.innerHTML = popHTML(ps[0]); wirePop(ps[0]); }
  else if (ps.length) {
    pop.innerHTML = `<span class="x">✕</span>
      <span class="tag">SPOT ${esc(id)} · ${ps.length} PIANOS</span>` +
      ps.map(p => `<div class="row">• ${esc(p.summary)}</div>`).join('') +
      `<div class="row" style="color:#9e2020;font-weight:700">Multiple pianos on one spot — see Reports.</div>`;
    pop.onclick = ev => {
      if (ev.target.closest('.x')) { pop.hidden = true; popPinned = false; } };
  } else if (/^\d+p$/.test(id)) {
    // plate rack slat (stairs conversion, 9/1): the piano keeps its floor
    // spot — its PLATE lives here, tracked as a cabinetry token
    const holders = S.data.pianos.filter(x => x.active && cabTokens(x).includes(id));
    pop.innerHTML = `<span class="x">✕</span>
      <span class="tag">PLATE SPOT ${esc(id)}</span>
      ${holders.length ? `<h3>⚙️ Plate stored here</h3>` + holders.map(x =>
          `<div class="row">• <b>${esc(x.summary || x.serial)}</b>${x.location ? ' — piano at spot ' + esc(x.location) : ''}
             <i class="platedel" data-row="${x.row}" style="cursor:pointer;color:#9e2020">✕ remove</i></div>`).join('')
        : `<h3>Empty</h3><div class="row">No plate yet assigned here.</div>`}
      <button class="tagbtn addhere">＋ Put a plate here</button>`;
    pop.onclick = ev => {
      if (ev.target.closest('.x')) { pop.hidden = true; popPinned = false; return; }
      const del = ev.target.closest('.platedel');
      if (del) {
        const px = S.data.pianos.find(x => x.row === +del.dataset.row);
        if (px) saveCabinetry(px, cabTokens(px).filter(t => t !== id), {querySelector: () => null})
          .then(() => { pop.hidden = true; renderMap(); });
        return;
      }
      if (ev.target.closest('.addhere')) { pop.hidden = true; openPlateAssignModal(id); } };
  } else {
    pop.innerHTML = `<span class="x">✕</span>
      <span class="tag">SPOT ${esc(id)}</span><h3>Empty</h3>
      <div class="row">No piano assigned in the Piano Log.</div>
      <button class="tagbtn addhere">＋ Put a piano here</button>`;
    pop.onclick = ev => {
      if (ev.target.closest('.x')) { pop.hidden = true; popPinned = false; return; }
      if (ev.target.closest('.addhere')) { pop.hidden = true; openAssignModal(id); } };
  }
  const el = document.querySelector(`.slot[data-slot="${CSS.escape(id)}"]`);
  place(pop, el);
}
function place(pop, el) {
  pop.hidden = false;
  S.popAnchor = el || null;   // remembered so the card can re-clamp if it grows
  const card = $('.mapcard').getBoundingClientRect();
  const r = el ? el.getBoundingClientRect() : card;
  const pw = pop.offsetWidth || 260, ph = pop.offsetHeight || 220;
  let x = r.left - card.left + r.width + 10;
  let y = r.top - card.top - 10;
  if (x + pw > card.width - 8) x = r.left - card.left - pw - 10;  // flip to the left side
  x = Math.max(8, Math.min(x, card.width - pw - 8));
  y = Math.max(8, Math.min(y, card.height - ph - 8));   // never hang off the bottom
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
}

/* ---------- reports (accordion of printable reports) ---------- */
// pianos that have arrived but carry no CURRENT PHASE at all
// only the shop's actual work queue is expected to carry a phase/track —
// storage, rentals, financing, staged-elsewhere sections etc. are exempt
function inShopwork(p) {
  return (p.section || '').trim().toUpperCase() === 'CUSTOM SHOPWORK';
}
function missingStage() {
  return S.data.pianos.filter(p => p.active && !comingSoon(p) && !p.isNew
    && inShopwork(p) && (!p.phase || !p.track));
}
function pianoName(p) {
  return (p.year ? p.year + ' ' : '')
    + ([p.make, p.model].filter(Boolean).join(' ') || p.summary || '');
}
function unplacedTable() {
  const un = unplaced();
  return `<table><tr><th>PIANO</th><th>SERIAL</th><th>LOG SECTION</th><th>STATUS</th><th>COL U SAYS</th><th></th></tr>` +
    (un.map(p => `<tr><td>${esc(p.summary)}</td><td>${esc(p.serial)}</td>
      <td>${esc((p.section || '—').slice(0, 38))}</td><td>${esc(p.status)}</td>
      <td class="locraw">${esc(p.location || '(blank)')}</td>
      <td><a target="_blank" rel="noopener" href="${logLink(p)}">open ↗</a></td></tr>`).join('')
     || '<tr><td colspan="6" class="empty">None — every active piano has a valid map location. 🎉</td></tr>') + '</table>';
}
function dupTable() {
  const du = duplicates();
  return `<table><tr><th>SLOT</th><th>PIANOS CLAIMING IT</th></tr>` +
    (du.map(d => `<tr><td class="locraw">${esc(d.slot)}</td>
      <td>${d.pianos.map(p => esc(p.summary) + (p.serial ? ` (SN ${esc(p.serial)})` : '')).join(' &nbsp;•&nbsp; ')}</td></tr>`).join('')
     || '<tr><td colspan="2" class="empty">No duplicate slot assignments. 🎉</td></tr>') + '</table>';
}
function missingStageTable() {
  const ms = missingStage();
  const missing = p => [!p.phase && 'Phase', !p.track && 'Track'].filter(Boolean).join(' & ');
  return `<table><tr><th>PIANO</th><th>SERIAL</th><th>LOCATION</th><th>MISSING</th><th></th></tr>` +
    (ms.map(p => `<tr class="mrow" data-row="${p.row}"><td>${esc(pianoName(p))}</td>
      <td>${esc(p.serial)}</td><td class="locraw">${esc(p.location || '(blank)')}</td>
      <td>${esc(missing(p))}</td>
      <td><a target="_blank" rel="noopener" href="${logLink(p)}">log ↗</a></td></tr>`).join('')
     || '<tr><td colspan="5" class="empty">None — every Custom Shopwork piano has a phase and track. 🎉</td></tr>') + '</table>';
}
// one bare table of pianos (no "still needed" column — the section
// heading already says which category this is)
function mediaRowsTable(list) {
  return `<table><tr><th>PIANO</th><th>SERIAL</th><th>LOCATION</th><th>PHASE</th><th></th></tr>` +
    (list.map(p => `<tr class="mrow" data-row="${p.row}"><td>${esc(pianoName(p))}</td>
      <td>${esc(p.serial)}</td><td class="locraw">${esc(p.location || 'no spot')}</td>
      <td>${esc(effectivePhase(p) || '—')}</td>
      <td><a target="_blank" rel="noopener" href="${logLink(p)}">log ↗</a></td></tr>`).join('')
     || '<tr><td colspan="5" class="empty">Nothing needed here. 🎉</td></tr>') + '</table>';
}
const MEDIA_CATS = [
  {key: 'bp', label: 'Before Photos', icon: '📷', need: 'needBP'},
  {key: 'bv', label: 'Before Video', icon: '🎥', need: 'needBV'},
  {key: 'ap', label: 'After Photos', icon: '📷', need: 'needAP'},
  {key: 'av', label: 'After Video', icon: '🎥', need: 'needAV'},
];
function mediaTable() {
  const act = S.data.pianos.filter(p => p.active && !notYetArrived(p))
    .map(p => ({p, m: mediaNeeds(p)})).filter(x => x.m.photo || x.m.video);
  return MEDIA_CATS.map(cat => {
    const list = act.filter(x => x.m[cat.need]).map(x => x.p);
    const open = S.mediaOpen[cat.key];
    return `<div class="mdsec ${open ? 'open' : ''}" data-cat="${cat.key}">
      <button class="mdsecbtn">
        <span class="chev">${open ? '▾' : '▸'}</span>
        <span>${cat.icon} ${esc(cat.label)}</span>
        <span class="pc ${list.length ? '' : 'zero'}">${list.length}</span>
        <button class="printbtn mdsecprint" data-cat="${cat.key}">🖨 Print</button>
      </button>
      <div class="mdsecbody" ${open ? '' : 'hidden'}>${open ? mediaRowsTable(list) : ''}</div>
    </div>`;
  }).join('');
}
/* ---------- Shop Work Map: geocode CUSTOM SHOPWORK pianos from free-text
   owner/notes, same technique as the Sales App's Lead Map (US Census
   Gazetteer, no API key, no per-piano network call) ---------- */
const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const NAME_TO_ABBR = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([abbr, name]) => [name.toLowerCase(), abbr]));
const STATE_CENTROIDS = {
  AL: [32.79, -86.83], AK: [64.07, -152.28], AZ: [34.27, -111.66],
  AR: [34.89, -92.44], CA: [37.18, -119.47], CO: [38.99, -105.55],
  CT: [41.62, -72.73], DE: [38.99, -75.51], DC: [38.91, -77.01],
  FL: [28.63, -82.45], GA: [32.64, -83.44], HI: [20.29, -156.37],
  ID: [44.35, -114.61], IL: [40.04, -89.2], IN: [39.89, -86.28],
  IA: [42.08, -93.5], KS: [38.49, -98.38], KY: [37.53, -85.3],
  LA: [31.07, -92.0], ME: [45.37, -69.24], MD: [39.06, -76.8],
  MA: [42.26, -71.81], MI: [44.35, -85.41], MN: [46.28, -94.31],
  MS: [32.74, -89.67], MO: [38.35, -92.46], MT: [47.05, -109.63],
  NE: [41.54, -99.8], NV: [39.33, -116.63], NH: [43.68, -71.58],
  NJ: [40.19, -74.67], NM: [34.41, -106.11], NY: [42.95, -75.53],
  NC: [35.56, -79.39], ND: [47.45, -100.47], OH: [40.29, -82.79],
  OK: [35.58, -97.51], OR: [43.93, -120.56], PA: [40.88, -77.8],
  RI: [41.68, -71.56], SC: [33.92, -80.9], SD: [44.44, -100.23],
  TN: [35.86, -86.35], TX: [31.48, -99.33], UT: [39.31, -111.67],
  VT: [44.07, -72.67], VA: [37.52, -78.85], WA: [47.38, -120.45],
  WV: [38.64, -80.62], WI: [44.62, -89.99], WY: [43.0, -107.55],
};
const HOME_STATE = 'ut';   // BLP is Utah-based — breaks ties on ambiguous city names
const ABBRS = Object.keys(STATE_NAMES);
function normCity(raw) {
  return raw.toLowerCase().replace(/[.'’]/g, '')
    .replace(/^saint\s+/, 'st ').replace(/^ft\.?\s+/, 'fort ')
    .replace(/\s+/g, ' ').trim();
}
let GEO_READY = null;   // Promise resolving once PLACE_INDEX/CITY_STATES/ZIPS are built
let PLACE_INDEX = null, CITY_STATES = null, ZIPS = null;
function loadGeoData() {
  if (GEO_READY) return GEO_READY;
  GEO_READY = Promise.all([
    fetch('data/us-places.json').then(r => r.json()),
    fetch('data/us-zips.json').then(r => r.json()),
  ]).then(([places, zips]) => {
    ZIPS = zips;
    PLACE_INDEX = new Map(); CITY_STATES = new Map();
    for (const [key, coords] of Object.entries(places)) {
      const [city, st] = key.split('|');
      const norm = normCity(city);
      PLACE_INDEX.set(`${norm}|${st}`, coords);
      const states = CITY_STATES.get(norm);
      if (states) { if (!states.includes(st)) states.push(st); }
      else CITY_STATES.set(norm, [st]);
    }
  });
  return GEO_READY;
}
function precedingTokens(text, end) {
  const before = text.slice(0, end).replace(/[,\s]+$/, '');
  const m = before.match(/((?:[A-Za-z][\w.'’-]*)(?:[ \t][A-Za-z][\w.'’-]*){0,3})$/);
  return m ? m[1].split(/[ \t]+/) : [];
}
const CITY_STOPWORDS = new Set(['north', 'south', 'east', 'west', 'center', 'central']);
function lookupCity(tokens, st) {
  for (let take = Math.min(4, tokens.length); take >= 1; take--) {
    const words = tokens.slice(tokens.length - take);
    const probe = normCity(words.join(' '));
    if (!probe || (take === 1 && CITY_STOPWORDS.has(probe))) continue;
    const coords = PLACE_INDEX.get(`${probe}|${st.toLowerCase()}`);
    if (coords) return {coords, city: words.join(' ')};
  }
  return null;
}
function titleCase(s) { return s.replace(/\b\w/g, c => c.toUpperCase()); }
const ABBR_RE = new RegExp(`\\b(${ABBRS.filter(a => a !== 'OK').join('|')})\\b`, 'g');
const FULL_NAMES = Object.values(STATE_NAMES).sort((a, b) => b.length - a.length);
const FULL_NAME_RE = new RegExp(`\\b(${FULL_NAMES.join('|')})\\b`, 'gi');
const STATE_ZIP_RE = new RegExp(`\\b(${ABBRS.join('|')})\\.?,?\\s+(\\d{5})(?:-\\d{4})?\\b`, 'g');
function extractFromText(text) {
  if (!text || !text.trim()) return null;
  for (const m of text.matchAll(ABBR_RE)) {
    const st = m[1];
    const city = lookupCity(precedingTokens(text, m.index), st);
    if (city) return {lat: city.coords[0], lng: city.coords[1],
      place: `${titleCase(city.city)}, ${st}`, state: st, precision: 'city'};
  }
  for (const m of text.matchAll(FULL_NAME_RE)) {
    const st = NAME_TO_ABBR[m[1].toLowerCase()];
    if (!st) continue;
    const city = lookupCity(precedingTokens(text, m.index), st);
    if (city) return {lat: city.coords[0], lng: city.coords[1],
      place: `${titleCase(city.city)}, ${st}`, state: st, precision: 'city'};
  }
  for (const m of text.matchAll(STATE_ZIP_RE)) {
    const coords = ZIPS[m[2]];
    if (coords) return {lat: coords[0], lng: coords[1], place: `${m[1]} ${m[2]}`, state: m[1], precision: 'zip'};
  }
  const CUE_CITY_RE = /\b(in|near|from|at|to|around|outside)\s+([A-Z][\w.'’-]*(?:[ \t][A-Z][\w.'’-]*){0,3})/g;
  const PLACE_ONLY_CUES = new Set(['in', 'near', 'around', 'outside']);
  for (const m of text.matchAll(CUE_CITY_RE)) {
    const tokens = m[2].split(/[ \t]+/);
    for (let take = tokens.length; take >= 1; take--) {
      if (take === 1 && !PLACE_ONLY_CUES.has(m[1].toLowerCase())) continue;
      const words = tokens.slice(0, take).join(' ');
      if (words.length < 4) continue;
      const norm = normCity(words);
      if (take === 1 && CITY_STOPWORDS.has(norm)) continue;
      const states = CITY_STATES.get(norm);
      let key = null;
      if (PLACE_INDEX.has(`${norm}|${HOME_STATE}`)) key = `${norm}|${HOME_STATE}`;
      else if (PLACE_INDEX.has(`${norm} city|${HOME_STATE}`)) key = `${norm} city|${HOME_STATE}`;
      else if (states && states.length === 1) key = `${norm}|${states[0]}`;
      if (key) {
        const st = key.split('|')[1].toUpperCase();
        const coords = PLACE_INDEX.get(key);
        return {lat: coords[0], lng: coords[1], place: `${titleCase(words)}, ${st}`, state: st, precision: 'city'};
      }
    }
  }
  const CONTEXT_STATE_RE = new RegExp(
    `(?:^|[,(\u2013\u2014-]|\\bin\\b|\\bnear\\b|\\bfrom\\b|\\bto\\b|\\boutside\\b|\\barea of\\b)\\s*(${FULL_NAMES.join('|')})\\b`, 'i');
  const sm = text.match(CONTEXT_STATE_RE);
  if (sm) {
    const st = NAME_TO_ABBR[sm[1].toLowerCase()];
    const c = st && STATE_CENTROIDS[st];
    if (c) return {lat: c[0], lng: c[1], place: `${STATE_NAMES[st]} (state)`, state: st, precision: 'state'};
  }
  return null;
}
const PRECISION_RANK = {city: 0, zip: 1, state: 2};
function extractPianoGeo(...texts) {
  let best = null;
  for (const text of texts) {
    const hit = extractFromText(text);
    if (!hit) continue;
    if (hit.precision === 'city') return hit;
    if (!best || PRECISION_RANK[hit.precision] < PRECISION_RANK[best.precision]) best = hit;
  }
  return best;
}

const SHOPMAP_VW = 975, SHOPMAP_VH = 610;
let SHOPMAP_STATES = null;   // cached lower-48+DC path data
function shopMapProjection(bbox) {
  const pad = 30;
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const cos = Math.cos(midLat * Math.PI / 180);
  const sx = (SHOPMAP_VW - pad * 2) / ((bbox.maxLng - bbox.minLng) * cos);
  const sy = (SHOPMAP_VH - pad * 2) / (bbox.maxLat - bbox.minLat);
  const scale = Math.min(sx, sy);
  const cx = (bbox.minLng + bbox.maxLng) / 2, cy = (bbox.minLat + bbox.maxLat) / 2;
  return (lng, lat) => [
    SHOPMAP_VW / 2 + (lng - cx) * cos * scale,
    SHOPMAP_VH / 2 - (lat - cy) * scale,
  ];
}
function shopMapStatePath(geometry, project) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  let d = '';
  for (const rings of polys) {
    for (const ring of rings) {
      const pts = ring.map(c => project(c[0], c[1]));
      if (pts.length < 3) continue;
      d += 'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L') + 'Z';
    }
  }
  return d;
}
async function loadShopMapStates() {
  if (SHOPMAP_STATES) return SHOPMAP_STATES;
  const fc = await fetch('data/us-states.json').then(r => r.json());
  // lower 48 + DC only — Alaska/Hawaii/territories sit far outside this
  // bounding box and would otherwise squash the whole map
  const EXCLUDE = new Set(['Alaska', 'Hawaii', 'Puerto Rico']);
  const feats = fc.features.filter(f => !EXCLUDE.has(f.properties.name));
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const f of feats) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
      : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const rings of polys) for (const ring of rings) for (const [lng, lat] of ring) {
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    }
  }
  SHOPMAP_STATES = {feats, bbox: {minLat, maxLat, minLng, maxLng}};
  return SHOPMAP_STATES;
}
function shopWorkPianos() {
  return S.data.pianos.filter(p => p.active && inShopwork(p));
}
async function renderShopMap() {
  const canvas = $('#shopMapCanvas'), list = $('#shopMapList');
  if (!canvas || canvas.dataset.rendered === S.data.fetchedAt) return;   // don't rebuild on every nav click
  canvas.innerHTML = '<div class="empty">Loading map…</div>';
  list.innerHTML = '';
  try {
    const [, {feats, bbox}] = await Promise.all([loadGeoData(), loadShopMapStates()]);
    const project = shopMapProjection(bbox);
    const pianos = shopWorkPianos();
    const pins = [];
    for (const p of pianos) {
      const geo = extractPianoGeo(p.owner || '', p.summary || '');
      if (geo) pins.push({p, geo});
    }
    const outOfFrame = pins.filter(x => x.geo.state === 'AK' || x.geo.state === 'HI');
    const onFrame = pins.filter(x => x.geo.state !== 'AK' && x.geo.state !== 'HI');

    let svg = `<svg viewBox="0 0 ${SHOPMAP_VW} ${SHOPMAP_VH}" role="img" aria-label="US map of shop-work pianos">`;
    for (const f of feats) {
      const d = shopMapStatePath(f.geometry, project);
      if (d) svg += `<path d="${d}" fill-rule="evenodd" class="smstate"><title>${esc(f.properties.name)}</title></path>`;
    }
    onFrame.sort((a, b) => (a.geo.precision === 'state') - (b.geo.precision === 'state'));   // city pins drawn last/on-top
    onFrame.forEach(({p, geo}) => {
      const xy = project(geo.lng, geo.lat);
      const r = geo.precision === 'state' ? 6 : 5.5;
      svg += `<circle cx="${xy[0].toFixed(1)}" cy="${xy[1].toFixed(1)}" r="${r}" class="smpin ${geo.precision === 'state' ? 'smstatepin' : ''}"
              data-row="${p.row}"><title>${esc(pianoName(p))} — ${esc(geo.place)}</title></circle>`;
    });
    svg += '</svg>';
    canvas.innerHTML = svg;
    canvas.dataset.rendered = S.data.fetchedAt;
    canvas.querySelectorAll('.smpin').forEach(el => el.addEventListener('click', () => {
      const p = S.data.pianos.find(x => x.row === +el.dataset.row);
      if (p) { switchView('map'); focusPiano(p); }
    }));

    const rows = pianos.map(p => {
      const hit = pins.find(x => x.p.row === p.row);
      return {p, place: hit ? hit.geo.place : null};
    }).sort((a, b) => (a.place ? 0 : 1) - (b.place ? 0 : 1));
    list.innerHTML = `<div class="smlisthead">${pianos.length} in Custom Shopwork ·
        ${pins.length} pinned${outOfFrame.length ? ` (+${outOfFrame.length} in AK/HI, listed below the map only)` : ''} ·
        ${pianos.length - pins.length} with no address found</div>` +
      rows.map(({p, place}) => `<div class="smrow ${place ? '' : 'nogeo'}" data-row="${p.row}">
        <span class="smname">${esc(pianoName(p))}</span>
        <span class="smplace">${place ? '📍 ' + esc(place) : 'no address found in owner/notes'}</span>
      </div>`).join('');
    list.querySelectorAll('.smrow').forEach(el => el.addEventListener('click', () => {
      const p = S.data.pianos.find(x => x.row === +el.dataset.row);
      if (p) { switchView('map'); focusPiano(p); }
    }));
  } catch (e) {
    canvas.innerHTML = `<div class="empty">⚠ ${esc(e.message)}</div>`;
  }
}

function duplicateMarkedPianos() {
  return S.data.pianos.filter(p => !p.active && (p.owner || '').toLowerCase().includes('duplicate'));
}
function duplicatesTable() {
  const dl = duplicateMarkedPianos();
  return `<table><tr><th>PIANO</th><th>SERIAL</th><th>LAST SPOT</th><th>OWNER TEXT</th><th></th></tr>` +
    (dl.map(p => `<tr><td>${esc(pianoName(p))}</td><td>${esc(p.serial)}</td>
      <td class="locraw">${esc(p.location || '—')}</td>
      <td class="locraw">${esc((p.owner || '').slice(0, 70))}</td>
      <td><button class="tagbtn duprestore" data-row="${p.row}" data-serial="${esc(p.serial)}">↩ Restore</button></td></tr>`).join('')
     || '<tr><td colspan="5" class="empty">None marked as duplicates. 🎉</td></tr>') + '</table>';
}
async function restoreDuplicate(row, serial, btn) {
  const {pin, ok} = writeAuth();
  if (!ok) { alert('Sign in with Google (☰ menu) or enter the team PIN first.'); return; }
  btn.disabled = true; btn.textContent = 'Restoring…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial, row, action: 'unmarkduplicate', ...authFields()}),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'failed');
    btn.textContent = '✓ Restored'; btn.closest('tr').style.opacity = 0.5;
  } catch (e) {
    btn.disabled = false; btn.textContent = '✗ ' + e.message;
  }
}
function cabinetryTable() {
  const rows = [];
  for (const p of S.data.pianos) {
    if (!p.active) continue;
    for (const t of cabTokens(p)) {
      const m = /^(\d)-(?:([LR])?([TF1-6]))$/i.exec(t);
      rows.push({p, tok: t, unit: m ? +m[1] : 99, side: m ? (m[2] || '') : '', lvl: m ? m[3].toUpperCase() : ''});
    }
  }
  const lvlOrd = {T: 0, 6: 0, 5: 1, 4: 2, 3: 3, 2: 4, 1: 5, F: 6};
  rows.sort((a, b) => a.unit - b.unit || a.side.localeCompare(b.side) || (lvlOrd[a.lvl] ?? 9) - (lvlOrd[b.lvl] ?? 9));
  return `<table><tr><th>UNIT</th><th>SIDE</th><th>SHELF</th><th>PIANO</th><th>SERIAL</th><th>MAP SPOT</th><th></th></tr>` +
    (rows.map(r => `<tr class="mrow" data-row="${r.p.row}"><td><b>${r.unit === 99 ? esc(r.tok) : r.unit}</b></td>
      <td>${r.side === 'L' ? 'Left' : r.side === 'R' ? 'Right' : '—'}</td>
      <td>${esc(((CAB_UNITS[r.unit] === 'single' ? CAB_SGL_LEVELS : CAB_DBL_LEVELS).find(l => l[0] === r.lvl) || [r.lvl, r.tok])[1])}</td>
      <td>${esc(pianoName(r.p))}</td><td>${esc(r.p.serial)}</td>
      <td class="locraw">${esc(r.p.location || '—')}</td>
      <td><a target="_blank" rel="noopener" href="${logLink(r.p)}">log ↗</a></td></tr>`).join('')
     || '<tr><td colspan="7" class="empty">No cabinetry shelved yet — assign from a piano card.</td></tr>') + '</table>';
}
function waitingPianos() {
  return S.data.pianos.filter(p => p.active && (p.phase || '').startsWith('Waiting'));
}
function parseCheck(d) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(d || '');
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}
function waitingTable() {
  const today = localDay();
  const ws = waitingPianos().map(p => {
    const iso = parseCheck(p.checkBack);
    return {p, iso, overdue: !iso || iso <= today};
  }).sort((a, b) => (a.iso || '0') < (b.iso || '0') ? -1 : 1);
  return `<table><tr><th>PIANO</th><th>SERIAL</th><th>SPOT</th><th>WAITING ON</th><th>NOTE</th><th>CHECK BACK</th><th></th></tr>` +
    (ws.map(({p, iso, overdue}) => `<tr class="mrow" data-row="${p.row}">
      <td>${esc(pianoName(p))}</td><td>${esc(p.serial)}</td>
      <td class="locraw">${esc(p.location || '—')}</td>
      <td>${esc((p.phase || '').replace('Waiting on ', ''))}</td>
      <td>${esc(p.waitNote || '—')}</td>
      <td>${overdue ? `<b style="color:#c03636">${p.checkBack ? esc(p.checkBack) + ' — check now' : 'no date — set one'}</b>` : esc(p.checkBack)}</td>
      <td><a target="_blank" rel="noopener" href="${logLink(p)}">log ↗</a></td></tr>`).join('')
     || '<tr><td colspan="7" class="empty">No pianos are waiting on anything. 🎉</td></tr>') + '</table>';
}
/* Activity report with filters: person, action type, piano, date window,
 * and free-text search across every column. */
function actFiltered(rows) {
  const f = S.actF || (S.actF = {who: '', act: '', piano: '', q: '', days: 0});
  const cutoff = f.days ? Date.now() - f.days * 86400000 : 0;
  return rows.filter(r => {
    if (f.who && r[1] !== f.who) return false;
    if (f.act && r[2] !== f.act) return false;
    if (f.piano && !(String(r[3]) + ' ' + String(r[4])).toLowerCase().includes(f.piano.toLowerCase())) return false;
    if (f.q && !r.join(' ').toLowerCase().includes(f.q.toLowerCase())) return false;
    if (cutoff) {
      const d = new Date(r[0]);
      if (!isNaN(d) && d.getTime() < cutoff) return false;
    }
    return true;
  });
}
function activityTable(rows) {
  if (!rows) return '<div class="empty">Loading the activity log…</div>';
  const f = S.actF || (S.actF = {who: '', act: '', piano: '', q: '', days: 0});
  const whos = [...new Set(rows.map(r => r[1]).filter(Boolean))].sort();
  const acts = [...new Set(rows.map(r => r[2]).filter(Boolean))].sort();
  const shown = actFiltered(rows);
  const sel = (id, label, opts, cur) => `<select class="actf" data-f="${id}">
    <option value="">${label}</option>
    ${opts.map(o => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  return `<div class="actbar">
      ${sel('who', 'everyone', whos, f.who)}
      ${sel('act', 'all actions', acts, f.act)}
      <input class="actf" data-f="piano" placeholder="piano / serial…" value="${esc(f.piano)}">
      <input class="actf" data-f="q" placeholder="search anything…" value="${esc(f.q)}">
      <span class="actdays">${[[0, 'all'], [1, '24h'], [7, '7d'], [30, '30d']].map(([d, l]) =>
        `<button class="actd ${f.days === d ? 'on' : ''}" data-d="${d}">${l}</button>`).join('')}</span>
      <span class="actcount">${shown.length}${shown.length !== rows.length ? ' of ' + rows.length : ''} entries</span>
      ${(f.who || f.act || f.piano || f.q || f.days) ? '<button class="actclear">✕ clear</button>' : ''}
    </div>
    <table><tr><th>WHEN</th><th>WHO</th><th>ACTION</th><th>PIANO</th><th>DETAILS</th></tr>` +
    (shown.map(r => `<tr><td style="white-space:nowrap">${esc(r[0])}</td><td>${esc(r[1])}</td>
      <td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td></tr>`).join('')
     || `<tr><td colspan="5" class="empty">${rows.length ? 'Nothing matches these filters.' : 'No activity yet — changes made in the map will appear here.'}</td></tr>`) + '</table>';
}

/* Concurrent-work report: hardware/order tasks per piano, queue order,
 * filterable by category (keytops, plating, bass strings…) and status. */
/* Plate lifecycle (mirrors the bridge's PLATE_STATUSES) — plates leave for
 * Curtis Harper's shop and come back; tracked in the Piano Log's
 * PLATE STATUS column, set from the card's Shop Progress section. */
const PLATE_STAGES = ['In piano', 'Removed', 'Plate storage — BEFORE',
                      'At Curtis Harper', 'Plate storage — AFTER', 'Back in piano'];
function plateBadge(v) {
  v = (v || '').trim();
  if (!v) return '<span class="lite" style="color:#8a929a">not tracked</span>';
  const c = /curtis/i.test(v) ? ['#f3ecfd', '#6b3fa0']
    : /before/i.test(v) ? ['#fdf3ec', '#9a5b13']
    : /after/i.test(v) ? ['#eaf2fd', '#2c5d96']
    : /back in/i.test(v) ? ['#eaf5ec', '#2f7d4f']
    : /removed/i.test(v) ? ['#fdecec', '#a03030'] : ['#eee', '#555'];
  return `<span style="background:${c[0]};color:${c[1]};border-radius:999px;padding:2px 9px;font-size:11px;font-weight:700;white-space:nowrap">${esc(v)}</span>`;
}
const TASK_CATS = [
  ['keys', '🎹 Keytops / key service'],
  ['plating', '✨ Plating'],
  ['bass', '🎼 Bass strings'],
  ['decals', '🏷 Decals'],
  ['parts', '🔩 Parts'],
  ['pedals', 'Pedals'],
  ['pedaltrim', 'Pedal trim'],
  ['lock', 'Lock'],
  ['strikeplate', 'Strike plate'],
  ['escutcheon', 'Escutcheon'],
  ['decor', 'Decor'],
  ['hinges', 'Hinges'],
  ['screws', 'Screws'],
  ['otherhw', 'Other hardware'],
  ['colorpick', '🎨 Color — first pick'],
  ['colorfinal', '✅ Color — FINAL approved'],
];
function taskVal(p, k) {
  if (k === 'keys') return (p.keywork || p.keyService || '').trim();
  if (k === 'plating') return (p.replate || '').trim();
  if (k === 'colorpick') return (p.colorPick || '').trim();
  if (k === 'colorfinal') return (p.colorFinal || '').trim();
  return ((p.tasks || {})[k] || '').trim();
}
/* Phase-inferred completion: the shop's own sequence proves some tasks.
 *   bass strings — done once Restringing is completed or passed
 *   decals      — done once Refinishing is completed or passed
 *   keytops     — done once the piano reaches QC & Assembly or farther */
function taskAutoDone(p, cat) {
  const seq = pianoPhases(p) || PHASES;
  const eff = effectivePhase(p);
  const cur = seq.indexOf(eff);
  const doneList = (p.phasesDone || '').toLowerCase();
  const completed = name => doneList.includes(name.toLowerCase());
  const past = name => { const i = seq.indexOf(name); return (i >= 0 && cur > i) || completed(name); };
  // at/past QC & Assembly — or already For Sale / Delivered — proves EVERY
  // concurrent task is behind it (Brigham 8/26)
  const qi = seq.indexOf('QC & Assembly');
  if ((qi >= 0 && cur >= qi) || completed('QC & Assembly')
      || eff === 'For Sale' || eff === 'Delivered') return true;
  if (cat === 'bass') return past('Restringing');       // strings are on
  if (cat === 'decals') return past('Refinishing');     // decal under the lacquer
  // keys, plating, parts, pedals and the rest of the hardware must be on the
  // piano before DHRT can finish — past DHRT proves them
  return past('DHRT');
}
function taskStatus(v) {
  if (!v) return 'needed';
  if (/^(x|n\/?a|no)[.!\s]*$/i.test(v)) return 'n/a';
  if (/receiv|done|complete|installed|finished|✓|arrived|back from/i.test(v)) return 'done';
  if (/order|sent|shipp|out to|out for|waiting|in progress|at plater/i.test(v)) return 'ordered';
  if (/^y(es)?[.!\s]*$/i.test(v)) return 'needed';
  return 'noted';
}
const TASK_ST = [['', 'all statuses'], ['needed', '🔴 needs attention'], ['noted', '📝 noted'],
  ['ordered', '📦 ordered / out'], ['done', '✅ completed / received'], ['n/a', '— not applicable']];
function taskRows() {
  const f = S.tkF || (S.tkF = {cat: 'keys', st: '', q: ''});
  return S.data.pianos
    .filter(p => p.active && p.serial && (p.queuePos || p.phase)
      && (p.phase || '') !== 'For Sale')   // showroom pianos are past all of this
    .map(p => {
      const v = taskVal(p, f.cat);
      const auto = taskAutoDone(p, f.cat);
      return {p, v: auto && !/receiv|done|complete|installed|finished|✓/i.test(v)
        ? (v ? v + ' · ' : '') + '✓ auto — phase confirms it' : v,
        st: auto ? 'done' : taskStatus(v)};
    })
    .filter(r => (!f.st || r.st === f.st)
      && (f.cat !== 'plating' || !f.pl
          || (f.pl === '__none__' ? !(r.p.plateStatus || '').trim() : r.p.plateStatus === f.pl))
      && (!f.q || (r.p.summary + ' ' + r.p.serial + ' ' + r.v).toLowerCase().includes(f.q.toLowerCase())))
    .sort((a, b) => (a.p.queuePos || 999) - (b.p.queuePos || 999) || a.p.row - b.p.row);
}
function tasksTable() {
  const f = S.tkF || (S.tkF = {cat: 'keys', st: '', q: ''});
  const rows = taskRows();
  const PILL = {needed: ['#fdecec', '#a03030'], noted: ['#fdf3ec', '#9a5b13'],
    ordered: ['#eaf2fd', '#2c5d96'], done: ['#eaf5ec', '#2f7d4f'], 'n/a': ['#eee', '#888']};
  return `<div class="actbar tkbar">
      <select class="tkf" data-f="cat">${TASK_CATS.map(([k, l]) =>
        `<option value="${k}" ${f.cat === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select class="tkf" data-f="st">${TASK_ST.map(([k, l]) =>
        `<option value="${k}" ${f.st === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      ${f.cat === 'plating' ? `<select class="tkf" data-f="pl">
        <option value="">plate: anywhere</option>
        ${PLATE_STAGES.map(v => `<option ${f.pl === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        <option value="__none__" ${f.pl === '__none__' ? 'selected' : ''}>plate: not tracked yet</option></select>` : ''}
      <input class="tkf" data-f="q" placeholder="search piano / note…" value="${esc(f.q)}">
      <span class="actcount">${rows.length} piano${rows.length === 1 ? '' : 's'}, queue order</span>
      ${(f.st || f.q || f.pl) ? '<button class="tkclear">✕ clear</button>' : ''}
    </div>
    <table><tr><th>QUEUE</th><th>PIANO</th><th>SPOT</th><th>PHASE</th>${f.cat === 'plating' ? '<th>PLATE LOCATION</th>' : ''}${f.cat === 'keys' ? '<th>KEYTOPS</th>' : ''}<th>STATUS</th><th>NOTE ON FILE</th></tr>
    ${rows.map(({p, v, st}) => {
      const c = PILL[st];
      return `<tr class="mrow" data-row="${p.row}">
        <td>${p.queuePos ? '#' + p.queuePos : '—'}</td>
        <td>${esc(((p.year ? p.year + ' ' : '') + ([p.make, p.model].filter(Boolean).join(' ') || p.summary)).slice(0, 36))}<br>
            <span class="lite" style="color:#8a929a;font-size:11px">${esc(p.serial)}</span></td>
        <td>${esc(String(p.location || '—').slice(0, 14))}</td>
        <td>${esc((p.phase || '—').slice(0, 22))}</td>
        ${f.cat === 'plating' ? `<td>${plateBadge(p.plateStatus)}</td>` : ''}
        ${f.cat === 'keys' ? `<td>${esc(p.keytopStatus || '—')}</td>` : ''}
        <td><span style="background:${c[0]};color:${c[1]};border-radius:999px;padding:2px 9px;font-size:11px;font-weight:800;white-space:nowrap">${st === 'needed' ? 'NEEDS ATTENTION' : st.toUpperCase()}</span></td>
        <td>${esc(v || '—')}</td></tr>`;
    }).join('') || `<tr><td colspan="${f.cat === 'plating' || f.cat === 'keys' ? 7 : 6}" class="empty">Nothing matches.</td></tr>`}
    </table>`;
}

/* Concurrent-task QUEUES (Brigham 8/26): six ordered mini-queues — who's NEXT
 * and everyone after them in shop-queue order — one per task, so each stream
 * (keytops, plates out, refinishing, plating+buffing, decals, bass strings)
 * has a clean, accurate to-do list. */
function refinPending(p) {
  const tr = (p.track || '').toLowerCase();
  if (!/refinish|rebuild|hybrid/.test(tr)) return false;
  const seq = pianoPhases(p) || PHASES;
  const ri = seq.indexOf('Refinishing');
  if (ri < 0) return false;
  if ((p.phasesDone || '').toLowerCase().includes('refinishing')) return false;
  const cur = seq.indexOf(effectivePhase(p));
  return cur < ri;   // parking states (cur = -1) count as not-there-yet
}
const TQ_DEFS = [
  {key: 'keys', icon: '🎹', title: 'KEY SERVICE / KEYTOPS',
   // the keytop selector is the authority: Done drops a piano off this
   // queue even when the old key-work note still reads like a request (8/28)
   need: p => !taskAutoDone(p, 'keys') && !/^Done/i.test(p.keytopStatus || '')
     && ['needed', 'noted'].includes(taskStatus(taskVal(p, 'keys'))),
   note: p => [p.keytopStatus, taskVal(p, 'keys')].filter(Boolean).join(' · ')},
  {key: 'plates', icon: '⚙️', title: 'PLATES TO CURTIS HARPER',
   need: p => ['Removed', 'Plate storage — BEFORE'].includes((p.plateStatus || '').trim()),
   note: p => p.plateStatus},
  {key: 'refin', icon: '🎨', title: 'REFINISHING — ON DECK',
   need: refinPending,
   note: p => 'now: ' + (effectivePhase(p) || '—')},
  {key: 'plating', icon: '✨', title: 'PLATING TO ORDER + BUFFING',
   need: p => ['needed', 'noted'].includes(taskStatus(taskVal(p, 'plating'))),
   note: p => taskVal(p, 'plating')},
  {key: 'decals', icon: '🏷', title: 'DECALS TO ORDER',
   need: p => !taskAutoDone(p, 'decals') && ['needed', 'noted'].includes(taskStatus(taskVal(p, 'decals'))),
   note: p => taskVal(p, 'decals')},
  {key: 'bass', icon: '🎼', title: 'BASS STRINGS TO ORDER',
   need: p => !taskAutoDone(p, 'bass') && ['needed', 'noted'].includes(taskStatus(taskVal(p, 'bass'))),
   note: p => taskVal(p, 'bass')},
  /* tuning queue: showroom for-sale pianos ranked most-overdue first.
   * Its own pool (the shared one excludes For Sale). Order:
   *   1. no tuning on record & been here 6+ months (most overdue)
   *   2. known last tuning, oldest first
   *   3. no record but arrived recently (likely prepped on arrival)
   * Pianos with a tuning already on the calendar drop off. */
  {key: 'tuning', icon: '🎵', title: 'TUNING QUEUE — KORBAN',
   pool: () => {
     const rows = S.data.pianos.filter(p => {
       if (!p.active || !p.serial) return false;
       // "currently for sale" = phase For Sale — the status tags also say
       // "For Sale" on shop-work and restoration-candidate pianos (8/29)
       if ((p.phase || '') !== 'For Sale') return false;
       const loc = (p.location || '').trim();
       if (!loc || /rent|attic|sold|deliver|storage|shop|where did/i.test(loc)) return false;
       // digitals never need tuning
       if (/digital|realpiano|clavinova|keyboard/i.test([p.make, p.model, p.summary, p.type].join(' '))) return false;
       return !tuningInfo(p).next;
     });
     const rank = p => {
       const ti = tuningInfo(p);
       if (ti.last) return 100000 - daysSince(ti.last);
       const ent = (p.entered || '').slice(0, 10);
       // clamp: garbage entered dates (a 1900 typo) must not dominate
       const here = /^\d{4}-/.test(ent) ? Math.min(daysSince(ent), 9999) : 9999;
       return here >= 180 ? -here : 200000 - here;
     };
     return rows.sort((x, y) => rank(x) - rank(y));
   },
   need: () => true,
   note: p => {
     const ti = tuningInfo(p);
     if (ti.last) return 'last tuned ' + fmtDayYear(ti.last) + ' · ' + daysSince(ti.last) + 'd ago';
     const ent = (p.entered || '').slice(0, 10);
     return 'no tuning on record' + (/^\d{4}-/.test(ent) ? ' · entered ' + fmtDayYear(ent) : '');
   }},
];
function taskQueueLists() {
  const pool = S.data.pianos
    .filter(p => p.active && p.serial && (p.queuePos || p.phase)
      && (p.phase || '') !== 'For Sale' && (p.phase || '') !== 'Delivered')
    .sort((a, b) => (a.queuePos || 999) - (b.queuePos || 999) || a.row - b.row);
  return TQ_DEFS.map(d => ({d, list: (d.pool ? d.pool() : pool).filter(d.need)}));
}
function taskQueuesTable() {
  const qs = taskQueueLists();
  const pianoName = p => ((p.year ? p.year + ' ' : '')
    + ([p.make, p.model].filter(Boolean).join(' ') || p.summary || '')).slice(0, 34);
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px">` +
    qs.map(({d, list}) => {
      const next = list[0];
      return `<div style="border:1px solid #dfe3e8;border-radius:10px;padding:12px 14px;background:#fff">
        <h4 style="margin:0 0 8px;font-size:13px;letter-spacing:.5px">${d.icon} ${d.title}
          <span class="pc ${list.length ? '' : 'zero'}" style="margin-left:6px">${list.length}</span></h4>
        ${next ? `<div class="mrow" data-row="${next.row}" style="cursor:pointer;background:#fdf6e3;border:1.5px solid #c9a227;border-radius:8px;padding:8px 10px;margin-bottom:8px">
            <b style="font-size:12.5px">NEXT UP${next.queuePos ? ' · queue #' + next.queuePos : ''}:</b>
            ${esc(pianoName(next))} <span style="color:#33383e">#${esc(next.serial)}
            · spot ${esc(String(next.location || '—'))}</span>
            ${d.note(next) ? `<div style="font-size:11px;color:#6f6a63">${esc(String(d.note(next)).slice(0, 60))}</div>` : ''}
          </div>` : `<div style="color:#8a929a;font-size:12px;padding:6px 0">Queue is clear. 🎉</div>`}
        ${list.slice(1).map((p, i) => `<div class="mrow" data-row="${p.row}"
            style="cursor:pointer;display:flex;gap:7px;padding:4px 2px;border-top:1px solid #f0f2f4;font-size:11.5px;align-items:baseline">
            <b style="min-width:22px;color:#33383e">${i + 2}.</b>
            <span style="min-width:34px;color:#33383e;font-weight:600">${p.queuePos ? 'Q-' + p.queuePos : '—'}</span>
            <span style="flex:1">${esc(pianoName(p))}</span>
            <span style="color:#33383e">#${esc(p.serial)}</span>
          </div>`).join('')}
      </div>`;
    }).join('') + `</div>`;
}

/* 🐢 sitting longer than the standard — mirrors the (retired) briefing
 * section: days in the building vs 2× the typical span for the phase. */
const STALL_DAYS = {
  'CAP': 21, 'PRSB & Plate Refinishing': 21, 'Lacquer Soundboard': 10,
  'Restringing': 14, 'Chip Tuning': 5, 'DHRT': 30, '1st Tuning': 5,
  'Refinishing': 30, 'QC & Assembly': 10, '2nd Tuning': 5,
  'Exit Prep - Admin': 7, 'Assessment': 7, 'New Arrival - Admin': 5,
};
function stalledPianos() {
  return S.data.pianos
    .filter(p => p.active && inShopwork(p) && STALL_DAYS[p.phase] && p.entered)
    .map(p => ({p, lim: STALL_DAYS[p.phase],
      age: Math.floor((Date.now() - new Date(p.entered + 'T12:00')) / 86400000)}))
    .filter(x => x.age > x.lim * 2)
    .sort((a, b) => b.age - a.age);
}
function stalledTable() {
  const rows = stalledPianos();
  return `<table><tr><th>PIANO</th><th>SPOT</th><th>PHASE</th><th>DAYS IN BUILDING</th><th>PHASE STANDARD</th></tr>
    ${rows.map(({p, age, lim}) => `<tr class="mrow" data-row="${p.row}">
      <td>${esc(((p.year ? p.year + ' ' : '') + ([p.make, p.model].filter(Boolean).join(' ') || p.summary)).slice(0, 36))}<br>
          <span class="lite" style="color:#8a929a;font-size:11px">${esc(p.serial)}</span></td>
      <td>${esc(String(p.location || '—').slice(0, 14))}</td>
      <td>${esc(p.phase)}</td>
      <td><b style="color:#9e2020">${age} days</b></td>
      <td>~${lim} days</td></tr>`).join('')
    || '<tr><td colspan="5" class="empty">Nothing is sitting past its standard — great pace. 🎉</td></tr>'}
    </table>`;
}

/* Shop queue, in order — the answer to "who's next?" for any user. */
function queueMembers() {
  return S.data.pianos.filter(p => p.active && p.queuePos > 0)
    .sort((a, b) => a.queuePos - b.queuePos);
}
function queueTable() {
  const f = S.quF || (S.quF = {q: ''});
  const all = queueMembers();
  const rows = all.filter(p => !f.q ||
    (p.summary + ' ' + p.serial + ' ' + (p.track || '') + ' ' + (p.location || ''))
      .toLowerCase().includes(f.q.toLowerCase()));
  const pending = S.data.pianos.filter(p => p.active && preQueue(p) && !p.queuePos);
  // ASSIGNED TO: live open work-clock session first, else the most recent
  // tech in the Time Log for that serial (loaded lazily when this report opens)
  const assignedCell = p => {
    const live = (CLOCK.all || []).find(o => o.serial === p.serial);
    if (live) return `<td><span class="qulive">● ${esc((live.tech || '').split(/\s+/)[0] || live.tech)} now</span></td>`;
    if (!S.tlRows) return '<td>…</td>';
    let last = null;
    S.tlRows.forEach(r => {
      if (r.serial === p.serial && r.tech && (!last || new Date(r.start) > new Date(last.start))) last = r;
    });
    return last ? `<td><span class="qurecent">recent: ${esc(last.tech)}</span></td>` : '<td>—</td>';
  };
  const row = p => `<tr class="mrow" data-row="${p.row}" ${p.queuePos === 1
      ? 'style="background:#eaf5ec"' : ''}>
      <td style="font-weight:800;white-space:nowrap">#${p.queuePos}${p.queuePos === 1 ? ' · next up' : ''}</td>
      <td>${esc(((p.year ? p.year + ' ' : '') + ([p.make, p.model].filter(Boolean).join(' ') || p.summary)).slice(0, 36))}<br>
          <span class="lite" style="color:#8a929a;font-size:11px">${esc(p.serial)}</span></td>
      <td>${esc(trackParts(p.track).list.join(' · ') || '—')}</td>
      <td>${esc((effectivePhase(p) || '—').slice(0, 24))}</td>
      ${assignedCell(p)}
      <td>${esc(String(p.location || '—').slice(0, 14))}</td></tr>`;
  return `<div class="actbar qubar">
      <input class="quf" data-f="q" placeholder="search piano / serial / track…" value="${esc(f.q)}">
      <span class="actcount">${rows.length}${f.q ? ' of ' + all.length : ''} in queue</span>
      ${f.q ? '<button class="quclear">✕ clear</button>' : ''}
    </div>
    <table><tr><th>QUEUE</th><th>PIANO</th><th>TRACK</th><th>CURRENT PHASE</th><th>ASSIGNED TO</th><th>SPOT</th></tr>
    ${rows.map(row).join('') || '<tr><td colspan="6" class="empty">Nothing matches.</td></tr>'}
    </table>
    ${pending.length ? `<p class="pd" style="margin:14px 0 6px">⚠️ <b>Pending shop work — not in the queue yet</b> (deposit not received):</p>
      <table><tr><th>PIANO</th><th>SPOT</th></tr>
      ${pending.map(p => `<tr class="mrow" data-row="${p.row}">
        <td>${esc(((p.year ? p.year + ' ' : '') + ([p.make, p.model].filter(Boolean).join(' ') || p.summary)).slice(0, 36))}
            <span class="lite" style="color:#8a929a;font-size:11px"> ${esc(p.serial)}</span></td>
        <td>${esc(String(p.location || '—').slice(0, 14))}</td></tr>`).join('')}</table>` : ''}`;
}

function briefsTable(kindOnly) {
  if (!S.briefRows) return '<div class="empty">Loading the brief archive\u2026</div>';
  const list = (kind, label, note) => {
    const rows = S.briefRows.filter(b => (b.kind || 'shop') === kind);
    return `<h4 class="bfhd">${label}</h4>
      <p class="pd bfnote">${note}</p>
      <table><tr><th>DATE</th><th>BRIEFING</th><th></th></tr>
      ${rows.map(b => {
        const docId = ((b.url || '').match(/\/d\/([-\w]{20,80})/) || [])[1];
        return `<tr>
        <td style="white-space:nowrap">${esc((b.date || '').slice(0, 10))}</td>
        <td>${esc(b.subject)}</td>
        <td style="white-space:nowrap"><a target="_blank" rel="noopener" href="${esc(b.url)}">open doc \u2197</a>
          ${docId ? `<a target="_blank" rel="noopener" title="printable copy \u2014 opens the print dialog"
            href="https://blpstoremap.netlify.app/api/print?id=${docId}">\ud83d\udda8 print</a>` : ''}
          <button class="bfshare" data-url="${esc(b.url)}" data-title="${esc(b.subject)}"
            title="share just this briefing">\u2197 share</button></td></tr>`;
      }).join('')
       || '<tr><td colspan="3" class="empty">Nothing archived yet \u2014 the next one lands with this evening\u2019s 7PM send.</td></tr>'}
      </table>`;
  };
  const shop = list('shop', '\ud83c\udf05 Shop Manager Briefings',
      'Emailed by 7PM the night before to shop@, brigham@ and karmel@ \u2014 opens with the next morning\u2019s standup.');
  const admin = list('admin', '\ud83d\udcbc Admin Morning Briefings',
      'Emailed by 7PM the night before to info@, karmel@ and brigham@ \u2014 payments, media and delivery logistics.');
  return kindOnly === 'shop' ? shop : kindOnly === 'admin' ? admin : shop + admin;
}
async function loadBriefs() {
  try {
    const r = await fetch(BRIDGE_URL + '?fn=briefs', {redirect: 'follow'});
    S.briefRows = (await r.json()).briefs || [];
  } catch (e) { S.briefRows = []; }
  renderReport();
}

/* ---------- payroll + job-costing reports (Time Log + Payroll Clock) ------ */
async function loadPayroll() {
  try {
    const r = await fetch(BRIDGE_URL + '?fn=payrollrows&days=190', {redirect: 'follow'});
    S.payRows = (await r.json()).rows || [];
  } catch (e) { S.payRows = []; }
  if (!S.tlRows) loadTimeLog(); else renderReport();
  if (S.view === 'manager') renderManager();
}
async function loadTimeLog() {
  try {
    const r = await fetch(BRIDGE_URL + '?fn=timelog&days=365', {redirect: 'follow'});
    S.tlRows = (await r.json()).rows || [];
  } catch (e) { S.tlRows = []; }
  renderReport();
  if (S.view === 'manager') renderManager();
}
function denverDay(iso) {   // yyyy-mm-dd in Denver for a session start
  return new Date(iso).toLocaleDateString('en-CA', {timeZone: 'America/Denver'});
}
function weekKey(day) {   // Monday of that week
  const d = new Date(day + 'T12:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function monthKey(day) { return day.slice(0, 7); }
function hDec(mins) { return (mins / 60).toFixed(2); }
function inRange(day, f) { return (!f.from || day >= f.from) && (!f.to || day <= f.to); }
function fmtT(iso) {
  return iso ? new Date(iso).toLocaleTimeString('en-US',
    {hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver'}) : '—';
}
let CSV_EXPORTS = {};   // id -> () => [filename, rows[][]] — rebuilt with each table
function downloadCsv(name, rows) {
  const csv = rows.map(r => r.map(c => {
    c = String(c == null ? '' : c);
    return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv'}));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function filterBar(scope, fields) {
  return `<div class="rfbar">${fields.join('')}</div>`;
}
function fSel(scope, f, cur, opts, label) {
  return `<select class="rptf" data-scope="${scope}" data-f="${f}">
    <option value="">${label}</option>
    ${opts.map(o => `<option ${cur === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
}
function fDate(scope, f, cur, title) {
  return `<label class="rfd">${title} <input type="date" class="rptf" data-scope="${scope}" data-f="${f}" value="${esc(cur || '')}"></label>`;
}

function payTimeTable() {
  if (!S.payRows || !S.tlRows) return '<div class="empty">Loading payroll punches…</div>';
  const f = S.payF || (S.payF = {who: '', from: '', to: '', group: 'day'});
  const techs = [...new Set([...S.payRows.map(r => r.tech), ...S.tlRows.map(r => r.tech)])].sort();
  const rows = S.payRows.filter(r =>
    (!f.who || r.tech === f.who) && inRange(r.date, f));
  const bar = filterBar('pay', [
    fSel('pay', 'who', f.who, techs, 'All team members'),
    fDate('pay', 'from', f.from, 'from'), fDate('pay', 'to', f.to, 'to'),
    `<select class="rptf" data-scope="pay" data-f="group">
       <option value="day" ${f.group === 'day' ? 'selected' : ''}>Daily punches</option>
       <option value="week" ${f.group === 'week' ? 'selected' : ''}>Weekly totals</option>
       <option value="month" ${f.group === 'month' ? 'selected' : ''}>Monthly totals</option></select>`,
    `<button class="csvbtn" data-csv="paydays">⬇ CSV — punches</button>`,
    `<button class="csvbtn" data-csv="paytotals">⬇ CSV — totals</button>`,
  ]);
  // day rows + grouped totals
  let main;
  if (f.group === 'day') {
    main = `<table><tr><th>DATE</th><th>TEAM MEMBER</th><th>CLOCK IN</th><th>CLOCK OUT</th><th>HOURS</th><th>NOTE</th></tr>
      ${rows.map(r => `<tr${/auto|mi from store/.test(r.note) ? ' style="color:#a33"' : ''}>
        <td>${esc(r.date)}</td><td>${esc(r.tech)}</td><td>${fmtT(r.start)}</td>
        <td>${r.end ? fmtT(r.end) : '<b style="color:#2e7d4f">on the clock</b>'}</td>
        <td>${r.minutes ? fmtHM(r.minutes) : '—'}</td><td>${esc(r.note || '')}</td></tr>`).join('')
       || '<tr><td colspan="6" class="empty">No payroll punches in this range yet.</td></tr>'}</table>`;
  } else {
    const key = f.group === 'week' ? r => weekKey(r.date) : r => monthKey(r.date);
    const agg = {};
    rows.forEach(r => {
      const k = key(r.date) + '|' + r.tech;
      (agg[k] = agg[k] || {period: key(r.date), tech: r.tech, mins: 0, days: new Set()});
      agg[k].mins += r.minutes || 0;
      agg[k].days.add(r.date);
    });
    const list = Object.values(agg).sort((a, b) =>
      b.period.localeCompare(a.period) || a.tech.localeCompare(b.tech));
    const plabel = f.group === 'week' ? 'WEEK OF' : 'MONTH';
    main = `<table><tr><th>${plabel}</th><th>TEAM MEMBER</th><th>DAYS</th><th>HOURS</th><th>HOURS (DECIMAL)</th></tr>
      ${list.map(g => `<tr><td>${esc(g.period)}</td><td>${esc(g.tech)}</td>
        <td>${g.days.size}</td><td>${fmtHM(g.mins)}</td><td>${hDec(g.mins)}</td></tr>`).join('')
       || '<tr><td colspan="5" class="empty">No payroll punches in this range yet.</td></tr>'}</table>`;
  }
  // per-member range totals
  const tot = {};
  rows.forEach(r => { tot[r.tech] = (tot[r.tech] || 0) + (r.minutes || 0); });
  const totals = Object.entries(tot).sort((a, b) => b[1] - a[1]);
  // per-piano / per-category hours from the Work Clock, same member + range
  const tl = S.tlRows.filter(r =>
    (!f.who || r.tech === f.who) && inRange(denverDay(r.start), f));
  const byPhase = {}, byPiano = {};
  tl.forEach(r => {
    byPhase[r.phase || '(no phase)'] = (byPhase[r.phase || '(no phase)'] || 0) + r.minutes;
    const pk = (r.piano || '?') + ' #' + r.serial;
    byPiano[pk] = (byPiano[pk] || 0) + r.minutes;
  });
  const phaseRows = Object.entries(byPhase).sort((a, b) => b[1] - a[1]);
  const pianoRows = Object.entries(byPiano).sort((a, b) => b[1] - a[1]).slice(0, 40);
  CSV_EXPORTS.paydays = () => ['payroll-punches.csv',
    [['Date', 'Team member', 'Clock in', 'Clock out', 'Minutes', 'Hours (decimal)', 'Note'],
     ...rows.map(r => [r.date, r.tech, fmtT(r.start), r.end ? fmtT(r.end) : 'OPEN', r.minutes, hDec(r.minutes), r.note])]];
  CSV_EXPORTS.paytotals = () => ['payroll-totals.csv',
    [['Team member', 'Minutes', 'Hours (decimal)'],
     ...totals.map(([t, m]) => [t, m, hDec(m)])]];
  return bar + main + `
    <h4 class="bfhd">Range totals per team member</h4>
    <table><tr><th>TEAM MEMBER</th><th>HOURS</th><th>HOURS (DECIMAL)</th></tr>
    ${totals.map(([t, m]) => `<tr><td>${esc(t)}</td><td>${fmtHM(m)}</td><td>${hDec(m)}</td></tr>`).join('')
     || '<tr><td colspan="3" class="empty">—</td></tr>'}</table>
    <h4 class="bfhd">Hours by category of work — same filters, from the piano Work Clock</h4>
    <table><tr><th>PHASE / CATEGORY</th><th>HOURS</th></tr>
    ${phaseRows.map(([p, m]) => `<tr><td>${esc(p)}</td><td>${fmtHM(m)}</td></tr>`).join('')
     || '<tr><td colspan="2" class="empty">No piano work-clock sessions in this range.</td></tr>'}</table>
    <h4 class="bfhd">Hours by piano — same filters (top 40)</h4>
    <table><tr><th>PIANO</th><th>HOURS</th></tr>
    ${pianoRows.map(([p, m]) => `<tr><td>${esc(p)}</td><td>${fmtHM(m)}</td></tr>`).join('')
     || '<tr><td colspan="2" class="empty">No piano work-clock sessions in this range.</td></tr>'}</table>`;
}

function jobCostTable() {
  if (!S.tlRows) return '<div class="empty">Loading the Work Clock ledger…</div>';
  const f = S.jcF || (S.jcF = {q: '', tech: '', phase: '', from: '', to: ''});
  const techs = [...new Set(S.tlRows.map(r => r.tech))].sort();
  const phases = [...new Set(S.tlRows.map(r => r.phase).filter(Boolean))].sort();
  const q = f.q.trim().toLowerCase();
  const rows = S.tlRows.filter(r =>
    (!q || (r.serial + ' ' + r.piano).toLowerCase().includes(q))
    && (!f.tech || r.tech === f.tech)
    && (!f.phase || r.phase === f.phase)
    && inRange(denverDay(r.start), f));
  const bar = filterBar('jc', [
    `<input type="text" class="rptf" data-scope="jc" data-f="q" placeholder="🔍 serial, make, model…" value="${esc(f.q)}">`,
    fSel('jc', 'tech', f.tech, techs, 'All technicians'),
    fSel('jc', 'phase', f.phase, phases, 'All phases'),
    fDate('jc', 'from', f.from, 'from'), fDate('jc', 'to', f.to, 'to'),
    `<button class="csvbtn" data-csv="jcsummary">⬇ CSV — summary</button>`,
    `<button class="csvbtn" data-csv="jcsessions">⬇ CSV — raw sessions</button>`,
  ]);
  // group by piano, then tech × phase inside
  const pianos = {};
  rows.forEach(r => {
    const k = r.serial;
    const g = pianos[k] = pianos[k] || {serial: r.serial, piano: r.piano, mins: 0, n: 0, parts: {}};
    g.mins += r.minutes; g.n++;
    const pk = r.tech + '|' + (r.phase || '(no phase)');
    g.parts[pk] = (g.parts[pk] || 0) + r.minutes;
  });
  const list = Object.values(pianos).sort((a, b) => b.mins - a.mins);
  const totalM = rows.reduce((a, r) => a + r.minutes, 0);
  CSV_EXPORTS.jcsummary = () => ['job-costing-summary.csv',
    [['Serial', 'Piano', 'Technician', 'Phase', 'Minutes', 'Hours (decimal)'],
     ...list.flatMap(g => Object.entries(g.parts).map(([pk, m]) => {
       const [tech, phase] = pk.split('|');
       return [g.serial, g.piano, tech, phase, m, hDec(m)];
     }))]];
  CSV_EXPORTS.jcsessions = () => ['job-costing-sessions.csv',
    [['Serial', 'Piano', 'Technician', 'Phase', 'Start', 'End', 'Minutes', 'Hours (decimal)', 'Source'],
     ...rows.map(r => [r.serial, r.piano, r.tech, r.phase, r.start, r.end, r.minutes, hDec(r.minutes), r.source])]];
  return bar + `
    <p class="pd">${list.length} piano${list.length === 1 ? '' : 's'} · ${fmtHM(totalM)} total ·
      ${rows.length} session${rows.length === 1 ? '' : 's'} ·
      <a target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I/edit">open the Time Log sheet ↗</a></p>
    <table><tr><th>PIANO</th><th>TECHNICIAN × PHASE</th><th>HOURS</th></tr>
    ${list.map(g => `
      <tr class="jcp"><td><b>${esc(g.piano || '—')}</b><br><small>#${esc(g.serial)} · ${g.n} session${g.n === 1 ? '' : 's'}</small></td>
        <td></td><td><b>${fmtHM(g.mins)}</b> <small>(${hDec(g.mins)})</small></td></tr>
      ${Object.entries(g.parts).sort((a, b) => b[1] - a[1]).map(([pk, m]) => {
        const [tech, phase] = pk.split('|');
        return `<tr><td></td><td>${esc(tech)} — ${esc(phase)}</td><td>${fmtHM(m)}</td></tr>`;
      }).join('')}`).join('')
     || '<tr><td colspan="3" class="empty">No work-clock sessions match these filters.</td></tr>'}</table>`;
}

/* ---------- 🛠 time clock adjustments (permission-gated edit surface) ------ */
async function loadClockFixes() {
  try {
    const r = await fetch(BRIDGE_URL + '?fn=clockfixes', {redirect: 'follow'});
    S.fixRows = (await r.json()).rows || [];
  } catch (e) { S.fixRows = []; }
  renderReport();
}
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function adjustPost(body) {
  const {pin, ok} = writeAuth();
  if (!ok) return {error: 'Sign in first.'};
  // Google's Apps Script serving occasionally misroutes a POST and answers
  // with the generic service ping ({ok:true, service:…}) WITHOUT running
  // the action — that reads as success and the change silently vanishes
  // (found 9/1: time-clock adjustments "saving" but not saved). Detect the
  // imposter and retry; if it persists, say so instead of pretending.
  for (let a = 0; a < 3; a++) {
    try {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin, ...authFields(), ...body})});
      const j = await r.json();
      if (j && j.service && !j.error) {   // ping imposter — action never ran
        await new Promise(res => setTimeout(res, 1200 * (a + 1)));
        continue;
      }
      return j;
    } catch (e) {
      await new Promise(res => setTimeout(res, 1200 * (a + 1)));
    }
  }
  return {error: 'the Google bridge hiccuped and the change did NOT save — try again in a minute'};
}
function adjRow(clock, r, label, sub) {
  const ed = S.adjEdit && S.adjEdit.clock === clock && S.adjEdit.row === r.row;
  if (!ed) {
    return `<tr><td>${label}</td><td>${sub}</td>
      <td>${fmtT(r.start)} → ${r.end ? fmtT(r.end) : '<b style="color:#2e7d4f">open</b>'}</td>
      <td>${r.minutes ? fmtHM(r.minutes) : '—'}</td>
      <td><button class="adjedit" data-clock="${clock}" data-row="${r.row}">✎ adjust</button></td></tr>`;
  }
  return `<tr class="adjediting"><td>${label}</td><td>${sub}</td>
    <td colspan="3"><span class="rfd">start <input type="datetime-local" class="adjstart" value="${toLocalInput(r.start)}"></span>
      <span class="rfd">end <input type="datetime-local" class="adjend" value="${toLocalInput(r.end)}"></span>
      <button class="csvbtn adjsave" data-clock="${clock}" data-row="${r.row}">Save</button>
      <button class="adjedit adjcancel">cancel</button>
      <span class="adjmsg phmsg"></span></td></tr>`;
}
function clockAdjustTable() {
  if (!S.fixRows || !S.payRows || !S.tlRows) return '<div class="empty">Loading clocks…</div>';
  const canPay = isPayrollAdmin(), canTl = isTimelogAdmin();
  const cutoff = Date.now() - 14 * 86400000;
  const openFix = S.fixRows.filter(r => r.status === 'open');
  const doneFix = S.fixRows.filter(r => r.status !== 'open').slice(0, 8);
  const fixes = `<h4 class="bfhd">Fix requests from the team</h4>
    <table><tr><th>WHEN</th><th>WHO</th><th>CLOCK</th><th>WHAT NEEDS FIXING</th><th></th></tr>
    ${openFix.map(r => `<tr><td style="white-space:nowrap">${esc(r.when)}</td><td>${esc(r.who.replace(/<[^>]*>/g, ''))}</td>
       <td>${esc(r.clock)}${r.serial ? ' #' + esc(r.serial) : ''}</td><td>${esc(r.note)}</td>
       <td><button class="csvbtn cfxres" data-row="${r.row}">✓ Resolved</button></td></tr>`).join('')
     || '<tr><td colspan="5" class="empty">No open requests 🎉</td></tr>'}
    ${doneFix.map(r => `<tr style="color:#8a929a"><td style="white-space:nowrap">${esc(r.when)}</td>
       <td>${esc(r.who.replace(/<[^>]*>/g, ''))}</td><td>${esc(r.clock)}</td><td>${esc(r.note)}</td><td>${esc(r.status)}</td></tr>`).join('')}
    </table>`;
  let pay = '';
  if (canPay) {
    const rows = S.payRows.filter(r => new Date(r.start) >= cutoff);
    pay = `<h4 class="bfhd">Payroll day punches — last 14 days (owners & Melissa)</h4>
      <table><tr><th>DATE</th><th>TEAM MEMBER</th><th>IN → OUT</th><th>HOURS</th><th></th></tr>
      ${rows.map(r => adjRow('pay', r, esc(r.date), esc(r.tech))).join('')
       || '<tr><td colspan="5" class="empty">No punches yet.</td></tr>'}</table>
      <div class="rfbar adjaddbar" data-clock="pay"><b>+ missed day punch:</b>
        <input type="text" class="a-tech" placeholder="team member name">
        <span class="rfd">in <input type="datetime-local" class="a-start"></span>
        <span class="rfd">out <input type="datetime-local" class="a-end"></span>
        <button class="csvbtn adjaddbtn">Add</button><span class="adjmsg phmsg"></span></div>`;
  }
  let tl = '';
  if (canTl) {
    const rows = S.tlRows.filter(r => new Date(r.start) >= cutoff);
    tl = `<h4 class="bfhd">Piano Work Clock sessions — last 14 days (owners & shop managers)</h4>
      <table><tr><th>PIANO</th><th>TECH · PHASE</th><th>IN → OUT</th><th>HOURS</th><th></th></tr>
      ${rows.map(r => adjRow('piano', r,
          `${esc(r.piano || '—')}<br><small>#${esc(r.serial)}</small>`,
          `${esc(r.tech)}<br><small>${esc(r.phase || '')}</small>`)).join('')
       || '<tr><td colspan="5" class="empty">No sessions yet.</td></tr>'}</table>
      <div class="rfbar adjaddbar" data-clock="piano"><b>+ missed piano session:</b>
        <input type="text" class="a-tech" placeholder="tech name">
        <input type="text" class="a-serial" placeholder="piano serial">
        <input type="text" class="a-phase" placeholder="phase">
        <span class="rfd">in <input type="datetime-local" class="a-start"></span>
        <span class="rfd">out <input type="datetime-local" class="a-end"></span>
        <button class="csvbtn adjaddbtn">Add</button><span class="adjmsg phmsg"></span></div>`;
  }
  return fixes + pay + tl;
}

/* 📦 Delivered-archive report — same rows as the old sidebar view (click a
 * row to open the piano's card), now living in Reports; searching an
 * archived serial from the top bar lands here with the row filtered. */
function archiveRows(q) {
  return (S.data.pianos || []).filter(p => p.archived)
    .filter(p => !q || (p.summary + ' ' + p.serial + ' ' + p.make + ' ' + p.model + ' '
      + p.year + ' ' + (p.owner || '')).toLowerCase().includes(q));
}
function archiveTable() {
  const f = S.arF || (S.arF = {q: ''});
  const q = f.q.trim().toLowerCase();
  const rows = archiveRows(q);
  return `<div class="actbar">
      <input class="arf" data-f="q" placeholder="search serial, make, owner…" value="${esc(f.q)}">
      <span class="actcount">${rows.length} archived piano${rows.length === 1 ? '' : 's'}${q ? ' matching' : ''}</span>
      ${f.q ? '<button class="arclear">✕ clear</button>' : ''}
    </div>
    <table><tr><th>PIANO</th><th>SERIAL</th><th>OWNER</th><th>LAST LOCATION</th><th></th></tr>
    ${rows.slice(0, 400).map(p => `<tr class="archrow" data-row="${p.row}">
      <td>${esc((p.year ? p.year + ' ' : '') + ([p.make, p.model].filter(Boolean).join(' ') || p.summary).slice(0, 40))}</td>
      <td>${esc(p.serial)}</td>
      <td>${esc(ownerNameOf(p) || '—')}</td>
      <td>${esc((p.location || '—').slice(0, 26))}</td>
      <td><a target="_blank" rel="noopener" href="${logLink(p)}">log ↗</a></td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Nothing here yet.</td></tr>'}
    </table>`;
}
// top-bar search landed on an archived piano: open the archive report
// (admin card) filtered to it, with the piano's card popped open
function openArchived(p) {
  switchView('report');
  S.openReport = 'archive';
  S.arF = {q: p.serial || p.summary || ''};
  renderReport();
  const body = document.querySelector('.rpt[data-r="archive"] .rptbody');
  if (body) { popPinned = true; openPop(p.row, body, true); }
}

function canApproveTimeOff() {
  return isOwner() || ['markhales.blp@gmail.com', 'melissa@brighamlarsonpianos.com'].includes(userEmail());
}
function timeOffTable() {
  if (!TO.rows) { loadTimeOff(); return '<div class="empty">Loading time off…</div>'; }
  const f = S.toF || (S.toF = {who: '', from: '', to: ''});
  const whos = [...new Set(TO.rows.map(r => r.who))].sort();
  const rows = TO.rows.filter(r =>
    (!f.who || r.who === f.who)
    && (!f.from || r.end >= f.from)
    && (!f.to || r.start <= f.to));
  const today = new Date().toLocaleDateString('en-CA');
  return `<div class="rfbar">
      <select class="rptf" data-scope="to" data-f="who"><option value="">All team members</option>
        ${whos.map(w => `<option ${f.who === w ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select>
      <label class="rfd">from <input type="date" class="rptf" data-scope="to" data-f="from" value="${esc(f.from || '')}"></label>
      <label class="rfd">to <input type="date" class="rptf" data-scope="to" data-f="to" value="${esc(f.to || '')}"></label>
    </div>
    <table><tr><th>TEAM MEMBER</th><th>DATES</th><th>TIMES</th><th>NOTES</th><th>REQUESTED</th><th>STATUS</th></tr>
    ${rows.map(r => {
      const st = (r.status || 'requested');
      const chip = /^approved/i.test(st)
        ? `<span style="background:#eaf5ec;color:#2f7d4f;border-radius:5px;padding:2px 8px;font-size:11px;font-weight:700">✓ ${esc(st)}</span>`
        : /^denied/i.test(st)
          ? `<span style="background:#fdecec;color:#9e2020;border-radius:5px;padding:2px 8px;font-size:11px;font-weight:700">✗ ${esc(st)}</span>`
          : canApproveTimeOff()
            ? `<button class="tobtn" data-row="${r.row}" data-st="approved" style="color:#2f7d4f">✓ Approve</button>
               <button class="tobtn" data-row="${r.row}" data-st="denied" style="color:#9e2020">✗ Deny</button>`
            : '<span style="color:#8a929a;font-size:11px">requested</span>';
      return `<tr${r.end >= today ? ' style="font-weight:600"' : ''}>
      <td>${esc(r.who)}</td>
      <td style="white-space:nowrap">${esc(r.start)}${r.end !== r.start ? ' → ' + esc(r.end) : ''}${r.end >= today ? ' <span style="color:#2e7d4f;font-size:10px">UPCOMING</span>' : ''}</td>
      <td>${esc(r.times || 'all day')}</td><td>${esc(r.note || '')}</td>
      <td style="white-space:nowrap;color:#8a929a">${esc((r.at || '').slice(0, 10))}</td>
      <td style="white-space:nowrap">${chip}</td></tr>`;
    }).join('')
     || '<tr><td colspan="6" class="empty">No time-off requests yet.</td></tr>'}</table>`;
}
function myTimeOffLines() {
  if (!TO.rows) { if (Date.now() - TO.at > 60000) loadTimeOff(); return '<div class="dline dim">loading…</div>'; }
  const me = clockName().toLowerCase();
  const mine = TO.rows.filter(r => r.who.toLowerCase() === me);
  if (!mine.length) return '<div class="dline dim">None on file — request some from the 📨 Request menu.</div>';
  const today = new Date().toLocaleDateString('en-CA');
  const up = mine.filter(r => r.end >= today);
  const yr = today.slice(0, 4);
  const dayspan = r => Math.round((new Date(r.end) - new Date(r.start)) / 86400000) + 1;
  const taken = mine.filter(r => r.end < today && r.start.startsWith(yr)).reduce((a, r) => a + dayspan(r), 0);
  return (up.map(r => `<div class="dline"><b>${esc(r.start)}${r.end !== r.start ? ' → ' + esc(r.end) : ''}</b>
      ${r.times ? '· ' + esc(r.times) : ''} <span style="color:#2e7d4f;font-size:11px">upcoming</span></div>`).join('')
    || '') + `<div class="dline dim">${taken} day${taken === 1 ? '' : 's'} taken so far in ${yr}</div>`;
}
/* 📣 App Updates — Brigham logs what changed; one button texts everything
 * since the last share to the chosen audience (team / managers / admins). */
async function loadAppUpdates() {
  try {
    const r = await fetch(BRIDGE_URL + '?fn=appupdates', {redirect: 'follow'});
    S.auRows = (await r.json()).rows || [];
  } catch (e) { S.auRows = S.auRows || []; }
  renderReport();
}
function appUpdatesTable() {
  if (!S.auRows) { loadAppUpdates(); return '<div class="empty">Loading updates…</div>'; }
  const unshared = S.auRows.filter(r => !r.sharedAt);
  const shared = S.auRows.filter(r => r.sharedAt);
  const lastShare = shared.length ? shared[0].sharedAt.slice(0, 10) : null;
  const AUD = [['team', '👥 Everyone (Tech Phones list)'], ['managers', '🔧 Managers (Mark · Matthew · Jacob)'], ['admins', '🗂 Admins (Melissa · Lisa)']];
  return `<div class="rfbar">
      <input type="text" class="auin" maxlength="400" placeholder="write an update the team should hear about…" style="flex:1">
      <button class="csvbtn auadd">＋ Add</button></div>
    <div class="aumsg phmsg"></div>
    <h4 class="bfhd">Not yet shared ${lastShare ? `<span class="lite" style="color:#8a929a">— since the last text on ${esc(lastShare)}</span>` : ''}</h4>
    ${unshared.length ? `<ul class="aulist">${unshared.map(r =>
        `<li><b>${esc(r.text)}</b> <span class="lite" style="color:#8a929a">· ${esc(r.at.slice(0, 10))} · ${esc(r.by.replace(/<[^>]*>/g, ''))}</span></li>`).join('')}</ul>
      <div class="rfbar">
        <select class="auaud">${AUD.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
        <button class="csvbtn aushare">📱 Text ${unshared.length} update${unshared.length === 1 ? '' : 's'}</button>
      </div>`
      : '<div class="empty">Nothing new since the last share — add updates above.</div>'}
    <h4 class="bfhd">Already shared</h4>
    <table><tr><th>UPDATE</th><th>LOGGED</th><th>TEXTED</th><th>TO</th></tr>
    ${shared.slice(0, 60).map(r => `<tr><td>${esc(r.text)}</td>
      <td style="white-space:nowrap;color:#8a929a">${esc(r.at.slice(0, 10))}</td>
      <td style="white-space:nowrap">${esc(r.sharedAt.slice(0, 10))}</td>
      <td>${esc(r.audience || '—')}</td></tr>`).join('')
     || '<tr><td colspan="4" class="empty">No shares yet.</td></tr>'}</table>`;
}

/* =============== MANAGER SCORECARD (Brigham 8/31) ===============
 * The monthly pay-for-performance dashboard: converts Work Clock +
 * mini-QC + payroll data into the bonus formula agreed with Brigham —
 * productivity 50% / quality 35% / management 15%, quality as a
 * multiplier, and a clock-coverage gate so the index can't be gamed
 * by under-punching. Standards come from the Aug 2026 job-costing
 * analysis (expert midpoints; recalibrates as clock data grows). */
const SC_STD = {'New Arrival - Admin': 3, 'Assessment': 3, 'CAP': 40,
  'PRSB & Plate Refinishing': 40, 'Lacquer Soundboard': 12, 'Restringing': 40,
  'Chip Tuning': 2, 'DHRT': 48, 'Refinishing': 62, 'QC & Assembly': 17,
  '1st Tuning': 2, '2nd Tuning': 2, 'Key service': 22, 'Full key set': 22,
  'Refurb checklist': 48, 'Exit Prep - Admin': 3};
async function loadScoreLog() {
  try {
    const r = await fetch(BRIDGE_URL + '?fn=scorelog', {redirect: 'follow'});
    S.slRows = (await r.json()).rows || [];
  } catch (e) { S.slRows = []; }
  renderReport();
  if (S.view === 'manager') renderManager();
}
async function loadQcLog() {
  try {
    const r = await fetch(BRIDGE_URL + '?fn=qclog', {redirect: 'follow'});
    S.qcRows = (await r.json()).rows || [];
  } catch (e) { S.qcRows = []; }
  renderReport();
  if (S.view === 'manager') renderManager();
}
function scorecardTable() {
  if (!S.tlRows || !S.payRows || !S.qcRows || !S.slRows) return '<div class="empty">Crunching the clock, QC, payroll and snapshot ledgers…</div>';
  const cut = Date.now() - 30 * 86400000;
  const inWin = iso => iso && new Date(iso).getTime() >= cut;
  const tl = S.tlRows.filter(r => inWin(r.start) && !/test/i.test(r.phase) && !/FAKE/.test(r.serial || ''));
  const mins = rows => rows.reduce((a, r) => a + (r.minutes || 0), 0);
  const pianoRows = tl.filter(r => !/^(Moving|Admin \/ Misc|Management)/.test(r.phase) && r.serial !== 'MGMT');
  const trainRows = tl.filter(r => /^Training/.test(r.phase));
  const reworkRows = tl.filter(r => /^Rework|re-?do|fix(ing)? (earlier|previous)/i.test(r.phase));
  const workH = mins(pianoRows) / 60, trainH = mins(trainRows) / 60, reworkH = mins(reworkRows) / 60;
  const payMin = (S.payRows || []).filter(r => inWin(r.date || r.start)).reduce((a, r) => a + (r.minutes || 0), 0);
  const coverage = payMin ? Math.min(100, Math.round(100 * mins(tl) / payMin)) : null;
  // mini-QC first pass
  const qc = (S.qcRows || []).filter(r => inWin(r.when));
  const qcPass = qc.filter(r => r.result === 'pass').length;
  const firstPass = qc.length ? Math.round(100 * qcPass / qc.length) : null;
  // provisional productivity: phases that PASSED mini-QC in window earn standard hours
  let earned = 0, actual = 0, phasesDone = 0;
  const doneKeys = new Set(qc.filter(r => r.result === 'pass').map(r => (r.serial || '') + '|' + (r.phase || '')));
  doneKeys.forEach(k => {
    const [sn, ph] = k.split('|');
    const std = SC_STD[ph];
    if (!std) return;
    const spent = mins((S.tlRows || []).filter(r => r.serial === sn && r.phase === ph)) / 60;
    if (spent < 1) return;   // phase never clocked — no basis to score it
    earned += std; actual += spent; phasesDone++;
  });
  const prodIdx = actual ? Math.round(100 * earned / actual) : null;
  const stalled = (() => { try { return stalledPianos().length; } catch (e) { return null; } })();
  /* Management 15% — fully app-governed, no human scoring (Brigham 9/1):
   * M1 stalled-piano trend (7d avg vs prior 21d, from daily snapshots)
   * M2 check-back hygiene (overdue/missing check-backs on Waiting pianos)
   * M3 throughput cadence (QC-passed advances: this week vs 30d weekly avg)
   * M4 clock coverage level (the 85% deliverable, scored continuously)  */
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const snaps = (S.slRows || []).slice().sort((x, y) => x.date < y.date ? -1 : 1);
  let m1 = null, m1txt = 'collecting baseline (' + snaps.length + '/8 days)';
  if (snaps.length >= 8) {
    const rec = snaps.slice(-7), prior = snaps.slice(0, -7).slice(-21);
    const avg = a2 => a2.reduce((x, y) => x + y.stalled, 0) / a2.length;
    const chg = prior.length ? (avg(rec) - avg(prior)) / Math.max(avg(prior), 1) : 0;
    m1 = clamp01(.6 - chg * 4);   // −10% trend → 100 · flat → 60 → +15% → 0
    m1txt = 'stalled ' + avg(rec).toFixed(0) + ' avg vs ' + avg(prior).toFixed(0) + ' prior';
  }
  const waiting = S.data.pianos.filter(p => p.active && /^waiting/i.test(p.phase || ''));
  const wBad = waiting.filter(p => {
    const cb = (p.checkBack || '').trim();
    return !cb || isNaN(new Date(cb).getTime()) || new Date(cb).getTime() < Date.now() - 86400000;
  }).length;
  const m2 = waiting.length ? clamp01(1 - (wBad / waiting.length) * 2) : 1;
  const wk = Date.now() - 7 * 86400000;
  const passRec = qc.filter(r => r.result === 'pass');
  const thisWk = passRec.filter(r => new Date(r.when).getTime() >= wk).length;
  const wkAvg = passRec.length / (30 / 7);
  const m3 = passRec.length >= 4 ? clamp01(thisWk / Math.max(wkAvg, 1) * .6) : null;
  const m4 = coverage == null ? null : clamp01(coverage >= 85 ? 1 : (coverage - 50) / 35);
  const mParts = [m1, m2, m3, m4].filter(v => v != null);
  const mgmtScore = mParts.length ? mParts.reduce((x, y) => x + y, 0) / mParts.length : null;
  const mgmtBonus = mgmtScore == null ? null : 1.2 * mgmtScore;
  const mSub = 'M1 trend: ' + (m1 == null ? m1txt : Math.round(m1 * 100) + '% (' + m1txt + ')')
    + ' · M2 check-backs: ' + Math.round(m2 * 100) + '% (' + wBad + '/' + waiting.length + ' overdue/missing)'
    + ' · M3 cadence: ' + (m3 == null ? 'needs QC history' : Math.round(m3 * 100) + '% (' + thisWk + ' passes this wk)')
    + ' · M4 coverage: ' + (m4 == null ? '—' : Math.round(m4 * 100) + '%');
  // ---- bonus translation (base $22, pool $0-8/hr) ----
  const prodScore = prodIdx == null ? null : prodIdx >= 105 ? 1 : prodIdx >= 100 ? .75 : prodIdx >= 95 ? .5 : prodIdx >= 90 ? .25 : 0;
  const qMult = firstPass == null ? null : firstPass >= 98 ? 1 : firstPass >= 95 ? .9 : firstPass >= 90 ? .75 : .5;
  const gated = coverage != null && coverage < 85;
  const prodBonus = (prodScore == null || qMult == null || gated) ? null : 4 * prodScore * qMult;
  const qualBonus = qMult == null ? null : 2.8 * (firstPass >= 98 ? 1 : firstPass >= 95 ? .7 : firstPass >= 90 ? .4 : 0);
  const kpi = (label, val, sub, tone) => `<div style="border:1px solid #dfe3e8;border-radius:10px;padding:12px 16px;background:#fff;min-width:150px">
    <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8a847b">${label}</div>
    <div style="font-size:26px;font-weight:800;color:${tone || '#2b2f33'}">${val}</div>
    <div style="font-size:11.5px;color:#8a847b">${sub}</div></div>`;
  const pct = v => v == null ? '—' : v + '%';
  // Design A + the Control Room hero (Brigham 9/1): the index leads,
  // drawn on an 80→110 scale with the 90 baseline and 105 target marked
  const heroPos = v => Math.max(0, Math.min(100, (v - 80) / 30 * 100));
  const hero = `<div style="display:flex;gap:26px;align-items:center;flex-wrap:wrap;background:#fff;border:1px solid #dfe3e8;border-radius:12px;padding:18px 22px;margin-bottom:12px">
    <div><div style="font-size:52px;font-weight:800;line-height:1;color:${prodIdx == null ? '#8a847b' : prodIdx >= 105 ? '#2f7d4f' : prodIdx >= 95 ? '#9a5b13' : '#9e2020'}">${prodIdx == null ? '—' : prodIdx}<span style="font-size:20px;color:#8a847b">${prodIdx == null ? '' : '%'}</span></div>
      <div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#8a847b;margin-top:4px">Productivity index</div></div>
    <div style="flex:1;min-width:230px">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#8a847b;margin-bottom:6px"><span>baseline 90</span><span>target 105</span></div>
      <div style="height:14px;background:#efece6;border-radius:7px;position:relative;overflow:visible">
        ${prodIdx == null ? '' : `<div style="position:absolute;inset:0 auto 0 0;width:${heroPos(prodIdx)}%;background:linear-gradient(90deg,#c9a227,#9e2020);border-radius:7px"></div>`}
        <div style="position:absolute;top:-3px;bottom:-3px;width:2px;background:#2b2f33;left:${heroPos(105)}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#8a847b;margin-top:6px">
        <span>earned ${earned ? earned.toFixed(0) + 'h std' : '—'}</span><span>actual ${actual ? actual.toFixed(0) + 'h clocked' : '—'} · ${phasesDone} QC-passed phases</span></div>
    </div></div>`;
  const bonusAll = (prodBonus == null || qualBonus == null || mgmtBonus == null) ? null : prodBonus + qualBonus + mgmtBonus;
  const money = `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px">
    ${kpi('Bonus estimate', bonusAll == null ? '—' : '$' + bonusAll.toFixed(2) + '/hr', 'productivity × quality + management, all app-computed', '#2f7d4f')}
    ${kpi('Month value', bonusAll == null ? '—' : '$' + Math.round(bonusAll * 173), 'on a 173-hour month over base')}
    ${kpi('Effective rate', bonusAll == null ? '—' : '$' + (18 + bonusAll).toFixed(2), '$18 base (\u2192$19 at 85% baseline) + bonus', '#2f7d4f')}
  </div>`;
  /* ---- ladder progress strip (Brigham 9/1): each rung's gates as live
   * chips — green when currently met, red when not, grey when the data
   * isn't there yet. Hold-streaks accrue from the monthly archives that
   * began with the Scorecard Log on 2026-08-31. ---- */
  const reworkPct = workH ? 100 * reworkH / workH : 0;
  const chip = (label, state) => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700;
    background:${state == null ? '#efece6' : state ? '#eaf5ec' : '#fdecec'};
    color:${state == null ? '#8a847b' : state ? '#2f7d4f' : '#9e2020'}">${state == null ? '· ' : state ? '✓ ' : '✗ '}${label}</span>`;
  const rung = (pay, title, hold, chips, note) => `<div style="flex:1;min-width:220px;background:#fff;border:1px solid #dfe3e8;border-radius:10px;padding:11px 14px">
    <div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:14px">${pay}</b>
      <span style="font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:#8a847b">${title}</span></div>
    <div style="font-size:10.5px;color:#8a847b;margin:2px 0 6px">${hold}</div>
    <div>${chips}</div>${note ? `<div style="font-size:10.5px;color:#8a847b;margin-top:5px">${note}</div>` : ''}</div>`;
  const g25 = [
    chip('coverage ≥85%', coverage == null ? null : coverage >= 85),
    chip('mgmt ≥80%', mgmtScore == null ? null : mgmtScore >= .8),
    chip('first pass ≥95%', firstPass == null ? null : firstPass >= 95),
    chip('stalled ≤25 (now ' + (stalled == null ? '—' : stalled) + ')', stalled == null ? null : stalled <= 25),
    chip('index ≥ baseline', prodIdx == null ? null : prodIdx >= 95),
  ].join('');
  const g28 = [
    chip('index ≥105', prodIdx == null ? null : prodIdx >= 105),
    chip('first pass ≥97%', firstPass == null ? null : firstPass >= 97),
    chip('rework ≤3%', workH ? reworkPct <= 3 : null),
    chip('stalled ≤15', stalled == null ? null : stalled <= 15),
    chip('earned hrs +10%', null),
    chip('trainee converging', null),
  ].join('');
  const ladder = `<div style="border:1px solid #dfe3e8;border-radius:12px;background:#f4f1ec;padding:13px 16px;margin-bottom:14px">
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#6f6a63;margin-bottom:9px">🪜 Career ladder — live gate status</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px">
      ${rung('$19', 'next raise', 'hold ≥85% coverage for 1 full month',
        chip('coverage ≥85% (now ' + pct(coverage) + ')', coverage == null ? null : coverage >= 85),
        'hold-tracking began Sep 1')}
      ${rung('$25', 'Shop Manager', 'all five held for 3 consecutive months', g25, '')}
      ${isOwner() ? `
      ${rung('$28', 'Production Manager 📝 DRAFT', 'held for 2 consecutive quarters — owners only until finalized', g28, 'draft — not yet shown to Mark')}
      ${rung('$30+', 'Operations Leader 📝 DRAFT', 'annual — hours, production & quality only',
        chip('index ≥110 held 1yr', null) + chip('earned hrs +2,000/yr', null)
        + chip('rework ≤2% + final QC ≥98%', null) + chip('vacation test', null),
        'draft — not yet shown to Mark')}` : ''}
    </div></div>`;
  return hero + money + ladder + `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px">
    ${kpi('Clock coverage', pct(coverage), 'work-clock ÷ payroll · gate ≥85%', coverage != null && coverage < 85 ? '#9e2020' : '#2f7d4f')}
    ${kpi('Mini-QC first pass', pct(firstPass), qc.length + ' phase advances · 30d', firstPass != null && firstPass >= 95 ? '#2f7d4f' : undefined)}
    ${kpi('Rework', reworkH.toFixed(1) + 'h', workH ? (100 * reworkH / workH).toFixed(1) + '% of ' + workH.toFixed(0) + 'h piano work' : '', reworkH / Math.max(workH, 1) > .05 ? '#9e2020' : '#2f7d4f')}
    ${kpi('Training invested', trainH.toFixed(1) + 'h', 'trainer+trainee punches · neutral in index')}
    ${kpi('Sitting too long', stalled == null ? '—' : stalled, 'pianos past 2× typical phase span', stalled > 5 ? '#9e2020' : undefined)}
  </div>
  <div style="border:1.5px solid #c9a227;border-radius:10px;padding:14px 18px;background:#fdf6e3">
    <b>Bonus translation (last 30 days${gated ? ' — ⛔ COVERAGE GATE: below 85%, productivity bonus paused' : ''})</b>
    <table style="margin-top:8px"><tr><th style="text-align:left">Component</th><th>Result</th><th>$/hr</th></tr>
    <tr><td>Productivity (50%) — index ${pct(prodIdx)} × quality multiplier ${qMult == null ? '—' : qMult}</td><td>${prodScore == null ? '—' : Math.round(prodScore * 100) + '%'}</td><td><b>${prodBonus == null ? '—' : '$' + prodBonus.toFixed(2)}</b></td></tr>
    <tr><td>Quality (35%) — mini-QC first pass ${pct(firstPass)}</td><td></td><td><b>${qualBonus == null ? '—' : '$' + qualBonus.toFixed(2)}</b></td></tr>
    <tr><td>Management (15%) — app-computed: stalled trend, check-back hygiene, throughput cadence, coverage<br><span style="font-size:11px;color:#8a847b">${mSub}</span></td><td>${mgmtScore == null ? '—' : Math.round(mgmtScore * 100) + '%'}</td><td><b>${mgmtBonus == null ? '—' : '$' + mgmtBonus.toFixed(2)}</b></td></tr></table>
    <div style="margin-top:8px;font-size:13px">Estimated bonus: <b>${bonusAll == null ? '— (needs more data)' : '$' + bonusAll.toFixed(2) + '/hr'}</b>
      &nbsp;→ on a 173-hour month that's <b>${bonusAll == null ? '—' : '$' + Math.round(bonusAll * 173)}</b> over base.</div>

  </div>`;
}

const REPORT_DEFS = () => [
  // ---- ADMIN REPORTS ----
  {id: 'adminbriefs', sec: 'admin', icon: '💼', title: 'ADMIN DAILY BRIEF', count: null,
   desc: 'The nightly Admin briefing, archived as Google Docs — payments, media and delivery logistics. Each row has its own ↗ share button.',
   html: () => briefsTable('admin')},
  {id: 'paytime', sec: 'admin', show: isPayrollAdmin, icon: '⏰', title: 'TIME CLOCK — PAYROLL', count: null,
   desc: 'Team clock-in / clock-out for payroll: every arrival-and-exit punch from the dashboard Payroll Clock, filterable by team member and date, with daily punches or weekly/monthly totals, plus that member\u2019s hours by piano and by category of work from the piano Work Clock. Red rows were auto-closed (forgot to clock out) — review before running payroll. The CSV buttons export spreadsheets.',
   html: payTimeTable},
  {id: 'jobcost', sec: 'admin', show: isOwner, icon: '💰', title: 'JOB COSTING — PER PIANO', count: null,
   desc: 'Shop hours per piano from the Work Clock ledger, broken down by technician and phase — filter by piano, technician, phase, or date range, then export CSV spreadsheets (summary or raw sessions) for job costing.',
   html: jobCostTable},
  {id: 'clockadjust', sec: 'admin', show: () => isPayrollAdmin() || isTimelogAdmin(), icon: '🛠', title: 'TIME CLOCK ADJUSTMENTS', count: (() => {
     try { return S.fixRows ? S.fixRows.filter(r => r.status === 'open').length : null; } catch (e) { return null; } })(),
   desc: 'Fix mistakes and forgotten punches. Team fix requests land here; payroll day punches are editable by owners & Melissa, piano Work Clock sessions by owners & the shop managers (Mark, Matthew, Jacob). Every adjustment is stamped with who changed it.',
   html: clockAdjustTable},
  {id: 'appupdates', sec: 'admin', show: () => isPayrollAdmin() || isTimelogAdmin(), icon: '📣', title: 'APP UPDATES — TEAM TEXTS', count: (() => {
     try { return S.auRows ? S.auRows.filter(r => !r.sharedAt).length : null; } catch (e) { return null; } })(),
   desc: 'Log what changed in the apps, then text everything since the last share to the whole team, the managers, or the admins — one tap. Shared updates keep their history below.',
   html: appUpdatesTable},
  // ---- SHOP REPORTS ----
  {id: 'briefs', sec: 'shop', icon: '📰', title: 'SHOP MANAGER DAILY BRIEF', count: null,
   desc: 'The nightly Shop Manager briefing, archived as Google Docs — opens with the next morning\u2019s standup. Each row has its own ↗ share button, so you can send one day\u2019s briefing without sharing the whole archive.',
   html: () => briefsTable('shop')},
  {id: 'queue', sec: 'shop', icon: '🎹', title: 'SHOP QUEUE', count: (() => {
     try { return queueMembers().length; } catch (e) { return null; } })(),
   desc: 'Every piano in the Custom Shop Work queue, in order — #1 is next up. Click a row to jump to that piano on the map. Pre-Queue pianos (deposit not received) are listed below the queue; they don’t hold a place until approved.',
   html: queueTable},
  {id: 'tasks', sec: 'shop', icon: '🧩', title: 'CONCURRENT WORK', count: (() => {
     try { const f = S.tkF || {cat: 'keys'}; return S.data.pianos.filter(p =>
       p.active && p.serial && (p.queuePos || p.phase) && !taskAutoDone(p, f.cat)
       && taskStatus(taskVal(p, f.cat)) === 'needed').length; }
     catch (e) { return null; } })(),
   desc: 'Hardware and order tasks per piano, in queue order. Pick a category (keytops, plating, bass strings…) and a status — "needs attention" is the to-do list, top of the queue first. The count badge tracks the selected category.',
   html: tasksTable},
  {id: 'taskqueues', sec: 'shop', icon: '🎯', title: 'TASK QUEUES', count: (() => {
     try { return taskQueueLists().reduce((s, q) => s + q.list.length, 0); } catch (e) { return null; } })(),
   desc: 'Seven ordered to-do queues — key service, plates to Curtis Harper, refinishing on deck, plating + buffing, decals, bass strings, and the showroom tuning queue for Korban (most-overdue first, from the tuning calendars). Each shows who’s NEXT and everyone behind them. Click any row to jump to the piano.',
   html: taskQueuesTable},
  {id: 'stalled', sec: 'shop', icon: '🐢', title: 'SITTING TOO LONG', count: (() => {
     try { return stalledPianos().length; } catch (e) { return null; } })(),
   desc: 'Custom Shopwork pianos in the building more than twice the typical span for their current phase — the 🐢 list that used to live inside the daily brief. Click a row to jump to the piano.',
   html: stalledTable},
  {id: 'unplaced', sec: 'shop', icon: '⚠️', title: 'UNPLACED PIANOS', count: unplaced().length,
   desc: 'Active pianos whose Piano Log location (column U) is empty or doesn’t match any spot or known area.',
   html: unplacedTable},
  {id: 'dups', sec: 'shop', icon: '🔁', title: 'DUPLICATE SPOT NUMBERS', count: duplicates().length,
   desc: 'Two or more active pianos claim the same map spot — one of them is wrong.',
   html: dupTable},
  {id: 'stage', sec: 'shop', icon: '🔧', title: 'MISSING SHOP STAGE', count: missingStage().length,
   desc: 'Pianos in the Custom Shopwork section missing a CURRENT PHASE or TRACK — storage, rentals, financing, and other non-shopwork sections are exempt. Click a row to jump to the piano.',
   html: missingStageTable},
  {id: 'media', sec: 'admin', icon: '📸', title: 'MEDIA NEEDED', count: S.data.pianos.filter(p =>
     p.active && !notYetArrived(p) && (mediaNeeds(p).photo || mediaNeeds(p).video)).length,
   desc: 'Before photos/video for every arrived piano; after photos/video once it reaches Tuning or later. Pianos that haven\'t arrived yet join once they\'re here.',
   html: mediaTable},
  {id: 'timeoffrep', sec: 'admin', icon: '🏖', title: 'TIME OFF', count: (() => {
     try { const t = new Date().toLocaleDateString('en-CA');
       return TO.rows ? TO.rows.filter(r => r.end >= t).length : null; } catch (e) { return null; } })(),
   desc: 'Every time-off request from the Request menu — filter by team member and date range. Mark, Melissa and the owners approve or deny right here; the requester gets a text with the decision. Upcoming time off counts on the badge; each person also sees their own on their dashboard.',
   html: timeOffTable},
  {id: 'shopwork', sec: 'admin', icon: '📍', title: 'SHOP WORK MAP — DELIVERY / ORIGIN', count: null,
   desc: 'Every piano in the Custom Shopwork queue, pinned by where it’s headed for delivery or where it came from. Click a pin (or a row) to open that piano.',
   html: () => '<div id="shopmapMount"></div>'},
  {id: 'archive', sec: 'admin', icon: '📦', title: 'DELIVERED ARCHIVE', count: (() => {
     try { return archiveRows('').length; } catch (e) { return null; } })(),
   desc: 'Delivered pianos leave the map but live here — searchable, cards still open. Click a row for the piano’s full card.',
   html: archiveTable},
  {id: 'cabinetry', sec: 'shop', icon: '🗄', title: 'CABINETRY AUDIT REPORT', count: S.data.pianos.filter(p =>
     p.active && cabTokens(p).length).length,
   desc: 'Which Cabinetry Storage shelves hold each piano\'s stripped cabinetry and hardware. Assign from the piano card (Cabinetry → ＋ shelf); click a unit box on the map for one unit\'s contents.',
   html: cabinetryTable},
  {id: 'duplicates', sec: 'shop', icon: '🗑', title: 'MARKED DUPLICATES', count: duplicateMarkedPianos().length,
   desc: 'Rows marked "Mark as Duplicate" from a piano card — hidden from the map/reports but never deleted. Restore one here if it was flagged by mistake.',
   html: duplicatesTable},
  {id: 'waiting', sec: 'shop', icon: '⏳', title: 'WAITING ON', count: waitingPianos().length,
   desc: 'Every piano parked in a Waiting phase — what it’s waiting on, and when to check whether the wait is over (set with the card’s +3d/+1w/+2w/+1m snooze buttons). Overdue or dateless waits show in red.',
   html: waitingTable},
  {id: 'activity', sec: 'shop', icon: '📝', title: 'ACTIVITY LOG', count: null,
   desc: 'Who changed what — every move, phase change, media checkoff, and tuning request made through the map.',
   html: () => activityTable(S.activityRows)},
  {id: 'archiveshop', sec: 'shop', icon: '📦', title: 'DELIVERED ARCHIVE', count: (() => {
     try { return archiveRows('').length; } catch (e) { return null; } })(),
   desc: 'Delivered pianos leave the map but live here — searchable, cards still open. Click a row for the piano’s full card.',
   html: archiveTable},
];

function renderReport() {
  const body = $('#reportsBody');
  if (!body) return;
  // the Shop Work Map is ONE live DOM node — park it back in its hidden home
  // view before this innerHTML rebuild destroys it
  const smw = document.querySelector('.shopmapwrap');
  if (smw && body.contains(smw)) {
    const home = document.querySelector('#view-shopmap .panel');
    if (home) home.appendChild(smw);
  }
  const open = S.openReport;
  const defs = REPORT_DEFS().filter(r => !r.show || r.show());
  const opened = open && defs.find(r => r.id === open);
  if (opened) {
    // FULL-PAGE report (Brigham 8/26): one report at a time, ✕ top-right
    // returns to the reports list — no more accordion scrolling
    body.innerHTML = `
      <div class="rpt open rptfull" data-r="${opened.id}">
        <div class="rptfullhead">
          <span class="ric">${opened.icon}</span><span class="rtitle">${opened.title}</span>
          <button class="sharebtn" data-r="${opened.id}">↗ Share</button>
          <button class="printbtn" data-r="${opened.id}">🖨 Print</button>
          <button class="rptx" title="close — back to all reports">✕</button>
        </div>
        <p class="pd">${opened.desc}</p>
        <div class="tscroll">${opened.html()}</div>
      </div>`;
    body.querySelector('.rptx').onclick = () => {
      S.openReport = null;
      renderReport();
      const v = $('#view-report'); if (v) v.scrollTop = 0;
    };
  } else {
    const rptCard = r => `
      <div class="rpt" data-r="${r.id}">
        <button class="rptbtn">
          <span class="ric">${r.icon}</span><span class="rtitle">${r.title}</span>
          ${r.count != null ? `<span class="pc ${r.count ? '' : 'zero'}">${r.count}</span>` : ''}
          <span class="chev">▸</span>
        </button>
      </div>`;
    const admin = defs.filter(r => r.sec === 'admin'), shop = defs.filter(r => r.sec !== 'admin');
    // section groups collapse like the piano card's red banners; state
    // remembered per device
    const secOpen = k => lsGet('rptsec_' + k) !== 'shut';
    const secHTML = (key, label, cards) => `
      <div class="sechead rptsechead ${secOpen(key) ? '' : 'shut'}" data-rsec="${key}">${label}
        <i class="secarrow">${secOpen(key) ? '▾' : '▸'}</i></div>
      <div class="rsecbody" ${secOpen(key) ? '' : 'hidden'}>${cards}</div>`;
    body.innerHTML =
      `<div id="rptKpis">${S.kpiHTML || ''}</div>`
      + (admin.length ? secHTML('admin', '🔑 Admin Reports', admin.map(rptCard).join('')) : '')
      + secHTML('shop', '🔧 Shop Reports', shop.map(rptCard).join(''));
    const rk0 = body.querySelector('#rptKpis');
    if (rk0 && rk0.firstChild) wireKpis(rk0);
    body.querySelectorAll('.rptsechead').forEach(h => h.onclick = () => {
      lsSet('rptsec_' + h.dataset.rsec, secOpen(h.dataset.rsec) ? 'shut' : 'open');
      renderReport();
    });
  }
  body.querySelectorAll('.rptbtn').forEach(b => b.onclick = () => {
    const id = b.closest('.rpt').dataset.r;
    S.openReport = id;
    if (S.openReport === 'activity' && !S.activityRows) loadActivity();
    if ((S.openReport === 'briefs' || S.openReport === 'adminbriefs') && !S.briefRows) loadBriefs();
    if (S.openReport === 'paytime' && !S.payRows) loadPayroll();
    if (S.openReport === 'jobcost' && !S.tlRows) loadTimeLog();
    if (S.openReport === 'queue' && !S.tlRows) loadTimeLog();   // ASSIGNED TO column
    if (S.openReport === 'appupdates' && !S.auRows) loadAppUpdates();
    if (S.openReport === 'clockadjust') {
      if (!S.fixRows) loadClockFixes();
      if (!S.payRows) loadPayroll();
      if (!S.tlRows) loadTimeLog();
    }
    renderReport();
    const v = $('#view-report'); if (v) v.scrollTop = 0;
  });
  // 🛠 adjustments wiring: resolve requests, inline start/end edits, add-missed forms
  const auAdd = body.querySelector('.auadd');
  if (auAdd) auAdd.onclick = async () => {
    const inp = body.querySelector('.auin'), msg = body.querySelector('.aumsg');
    const text = inp.value.trim();
    if (!text) { msg.textContent = 'write the update first'; return; }
    auAdd.disabled = true; msg.textContent = 'saving…';
    const j = await adjustPost({action: 'addupdate', text});
    if (j.error) { msg.textContent = j.error; auAdd.disabled = false; return; }
    S.auRows = null; loadAppUpdates();
  };
  const auShare = body.querySelector('.aushare');
  if (auShare) auShare.onclick = async () => {
    const aud = body.querySelector('.auaud').value;
    const msg = body.querySelector('.aumsg');
    const n = (S.auRows || []).filter(r => !r.sharedAt).length;
    const who = aud === 'team' ? 'EVERYONE on the Tech Phones list' : 'the ' + aud;
    if (!confirm('Text ' + n + ' update' + (n === 1 ? '' : 's') + ' to ' + who + ' right now?')) return;
    auShare.disabled = true; msg.textContent = 'sending texts…';
    const j = await adjustPost({action: 'shareupdates', audience: aud});
    if (j.error) { msg.textContent = j.error; auShare.disabled = false; return; }
    msg.textContent = '✓ texted ' + j.updates + ' updates to ' + j.sent + ' people';
    S.auRows = null; loadAppUpdates();
  };
  body.querySelectorAll('.tobtn').forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = '…';
    const j = await adjustPost({action: 'timeoffstatus', row: +b.dataset.row, status: b.dataset.st});
    if (j.error) { alert(j.error); b.disabled = false; return; }
    TO.rows = null; loadTimeOff();
  });
  body.querySelectorAll('.cfxres').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const j = await adjustPost({action: 'resolveclockfix', row: +b.dataset.row});
    if (j.error) { alert(j.error); b.disabled = false; return; }
    S.fixRows = null; loadClockFixes();
  });
  body.querySelectorAll('.adjedit').forEach(b => b.onclick = () => {
    S.adjEdit = b.classList.contains('adjcancel') ? null
      : {clock: b.dataset.clock, row: +b.dataset.row};
    renderReport();
  });
  body.querySelectorAll('.adjsave').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr');
    const start = tr.querySelector('.adjstart').value, end = tr.querySelector('.adjend').value;
    const msg = tr.querySelector('.adjmsg');
    if (!start) { msg.textContent = 'start time required'; return; }
    b.disabled = true; msg.textContent = 'saving…';
    const j = await adjustPost({action: 'adjustclock', clock: b.dataset.clock, row: +b.dataset.row,
      start: new Date(start).toISOString(), end: end ? new Date(end).toISOString() : ''});
    if (j.error) { msg.textContent = j.error; b.disabled = false; return; }
    S.adjEdit = null; S.payRows = null; S.tlRows = null;
    loadPayroll();
  });
  body.querySelectorAll('.adjaddbar .adjaddbtn').forEach(b => b.onclick = async () => {
    const bar = b.closest('.adjaddbar'), clock = bar.dataset.clock;
    const val = c => { const el = bar.querySelector(c); return el ? el.value.trim() : ''; };
    const msg = bar.querySelector('.adjmsg');
    const tech = val('.a-tech'), start = val('.a-start'), end = val('.a-end');
    if (!tech || !start) { msg.textContent = 'name and start time required'; return; }
    if (clock === 'piano' && !val('.a-serial')) { msg.textContent = 'piano serial required'; return; }
    b.disabled = true; msg.textContent = 'adding…';
    const j = await adjustPost({action: 'adjustclock', clock, add: true, tech,
      serial: val('.a-serial'), phase: val('.a-phase'),
      start: new Date(start).toISOString(), end: end ? new Date(end).toISOString() : ''});
    if (j.error) { msg.textContent = j.error; b.disabled = false; return; }
    S.payRows = null; S.tlRows = null;
    loadPayroll();
  });
  body.querySelectorAll('.rptf').forEach(el => {
    const apply = () => {
      const scope = el.dataset.scope === 'pay' ? (S.payF || (S.payF = {}))
        : el.dataset.scope === 'to' ? (S.toF || (S.toF = {}))
        : (S.jcF || (S.jcF = {}));
      scope[el.dataset.f] = el.value;
      renderReport();
      const again = body.querySelector(`.rptf[data-scope="${el.dataset.scope}"][data-f="${el.dataset.f}"]`);
      if (again && again.tagName === 'INPUT' && again.type === 'text') {
        again.focus(); again.setSelectionRange(again.value.length, again.value.length);
      }
    };
    if (el.tagName === 'SELECT' || el.type === 'date') el.onchange = apply;
    else el.oninput = () => { clearTimeout(el._t); el._t = setTimeout(apply, 350); };
  });
  body.querySelectorAll('.arf').forEach(el => {
    el.oninput = () => {
      clearTimeout(el._t);
      el._t = setTimeout(() => {
        (S.arF = S.arF || {q: ''}).q = el.value;
        renderReport();
        const again = body.querySelector('.arf');
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 300);
    };
  });
  const arc = body.querySelector('.arclear');
  if (arc) arc.onclick = () => { S.arF = {q: ''}; renderReport(); };
  body.querySelectorAll('.archrow').forEach(tr => tr.onclick = ev => {
    if (ev.target.closest('a')) return;
    const p = S.data.pianos.find(x => x.row === +tr.dataset.row);
    const rb = tr.closest('.rptbody');
    if (p && rb) { popPinned = true; openPop(p.row, rb, true); }
  });
  body.querySelectorAll('.csvbtn').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const mk = CSV_EXPORTS[b.dataset.csv];
    if (mk) { const [name, rows] = mk(); downloadCsv(name, rows); }
  });
  body.querySelectorAll('.actf').forEach(el => {
    const apply = () => {
      S.actF[el.dataset.f] = el.value;
      renderReport();
      const again = body.querySelector(`.actf[data-f="${el.dataset.f}"]`);
      if (again && again.tagName === 'INPUT') { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    };
    if (el.tagName === 'SELECT') el.onchange = apply;
    else el.oninput = () => { clearTimeout(el._t); el._t = setTimeout(apply, 350); };
  });
  body.querySelectorAll('.actd').forEach(b => b.onclick = () => { S.actF.days = +b.dataset.d; renderReport(); });
  body.querySelectorAll('.tkf').forEach(el => {
    const apply = () => {
      S.tkF[el.dataset.f] = el.value;
      renderReport();
      const again = body.querySelector(`.tkf[data-f="${el.dataset.f}"]`);
      if (again && again.tagName === 'INPUT') { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    };
    if (el.tagName === 'SELECT') el.onchange = apply;
    else el.oninput = () => { clearTimeout(el._t); el._t = setTimeout(apply, 350); };
  });
  const tkc = body.querySelector('.tkclear');
  if (tkc) tkc.onclick = () => { S.tkF = {cat: S.tkF.cat, st: '', q: '', pl: ''}; renderReport(); };
  body.querySelectorAll('.quf').forEach(el => {
    el.oninput = () => {
      clearTimeout(el._t);
      el._t = setTimeout(() => {
        S.quF[el.dataset.f] = el.value;
        renderReport();
        const again = body.querySelector(`.quf[data-f="${el.dataset.f}"]`);
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 350);
    };
  });
  const quc = body.querySelector('.quclear');
  if (quc) quc.onclick = () => { S.quF = {q: ''}; renderReport(); };
  body.querySelectorAll('.bfshare').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    shareSheet(b.dataset.title, b.dataset.url);
  });
  const ac = body.querySelector('.actclear');
  if (ac) ac.onclick = () => { S.actF = {who: '', act: '', piano: '', q: '', days: 0}; renderReport(); };
  if (S.openReport === 'shopwork') {
    const mt = document.getElementById('shopmapMount');
    const wrap = document.querySelector('.shopmapwrap');
    if (mt && wrap) { mt.appendChild(wrap); renderShopMap(); }
  }
  body.querySelectorAll('.sharebtn').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const def = REPORT_DEFS().find(r => r.id === b.dataset.r);
    shareSheet(def.icon + ' ' + def.title + ' — BLP Store Map report',
      'https://blpstoremap.netlify.app/#report=' + def.id);
  });
  body.querySelectorAll('.printbtn').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const def = REPORT_DEFS().find(r => r.id === b.dataset.r);
    let html = def.html();
    if (['activity', 'tasks', 'queue', 'paytime', 'jobcost'].includes(def.id)) {
      const i = html.indexOf('<table');
      if (i > 0) html = html.slice(i);   // drop the filter bar from print
    }
    printReport(def.icon + ' ' + def.title, html);
  });
  body.querySelectorAll('.mrow').forEach(tr => tr.onclick = ev => {
    if (ev.target.closest('a')) return;
    const p = S.data.pianos.find(x => x.row === +tr.dataset.row);
    if (p) focusPiano(p);
  });
  body.querySelectorAll('.mdsecbtn').forEach(b => b.onclick = ev => {
    if (ev.target.closest('.mdsecprint')) return;
    const key = b.closest('.mdsec').dataset.cat;
    S.mediaOpen[key] = !S.mediaOpen[key];
    renderReport();
  });
  body.querySelectorAll('.mdsecprint').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const cat = MEDIA_CATS.find(c => c.key === b.dataset.cat);
    const act = S.data.pianos.filter(p => p.active && !notYetArrived(p))
      .map(p => ({p, m: mediaNeeds(p)})).filter(x => x.m[cat.need]).map(x => x.p);
    printReport(`${cat.icon} ${cat.label} Needed`, mediaRowsTable(act));
  });
  body.querySelectorAll('.duprestore').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    restoreDuplicate(+b.dataset.row, b.dataset.serial, b);
  });
}

/* Delivered archive: sold-section rows, searchable, cards still open */
function renderArchive() {
  const el = $('#archBody');
  if (!el) return;
  // delivered history loads lazily — pull it now if the archive opened early
  if (S.data && S.data.scope === 'active' && !inactiveCache) {
    loadInactive().then(() => { if (inactiveCache) renderArchive(); });
    if (inactiveLoading) { el.innerHTML = '<div class="empty">Loading the delivered archive…</div>'; return; }
  }
  const q = ($('#archSearch').value || '').trim().toLowerCase();
  const rows = (S.data.pianos || []).filter(p => p.archived)
    .filter(p => !q || (p.summary + ' ' + p.serial + ' ' + p.make + ' ' + p.model + ' '
      + p.year + ' ' + (p.owner || '')).toLowerCase().includes(q));
  el.innerHTML = `<div class="curmsg">${rows.length} archived piano${rows.length === 1 ? '' : 's'}${q ? ' matching' : ''}</div>
    <div class="tscroll"><table>
    <tr><th>PIANO</th><th>SERIAL</th><th>OWNER</th><th>LAST LOCATION</th><th></th></tr>
    ${rows.slice(0, 400).map(p => `<tr class="archrow" data-row="${p.row}">
      <td>${esc((p.year ? p.year + ' ' : '') + ([p.make, p.model].filter(Boolean).join(' ') || p.summary).slice(0, 40))}</td>
      <td>${esc(p.serial)}</td>
      <td>${esc(ownerNameOf(p) || '—')}</td>
      <td>${esc((p.location || '—').slice(0, 26))}</td>
      <td><a target="_blank" rel="noopener" href="${logLink(p)}">log ↗</a></td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Nothing here yet.</td></tr>'}
    </table></div>`;
  el.querySelectorAll('.archrow').forEach(tr => tr.onclick = ev => {
    if (ev.target.closest('a')) return;
    const p = S.data.pianos.find(x => x.row === +tr.dataset.row);
    if (p) { popPinned = true; openPop(p.row, $('#archBody'), true); }
  });
}
setTimeout(() => {
  const asrch = $('#archSearch');
  if (asrch) asrch.oninput = () => { clearTimeout(asrch._t); asrch._t = setTimeout(renderArchive, 250); };
}, 600);

async function loadActivity() {
  try {
    const r = await fetch(BRIDGE_URL + '?fn=activity', {redirect: 'follow'});
    const j = await r.json();
    S.activityRows = j.rows || [];
  } catch (e) { S.activityRows = []; }
  renderReport();
}

// clean printable copy: BLP letterhead + the report table, then print()
function printReport(title, html) {
  const day = new Date().toLocaleDateString('en-US',
    {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'});
  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked — allow pop-ups to print reports.'); return; }
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    body { font: 12px/1.45 Helvetica, Arial, sans-serif; color: #121212; margin: 28px; }
    .hd { border-bottom: 3px solid #0d0d0d; padding-bottom: 10px; margin-bottom: 14px; }
    .brand { font-family: Georgia, serif; letter-spacing: 4px; font-size: 17px; }
    .sub { font-size: 10px; letter-spacing: 2px; color: #777; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 9px; letter-spacing: 1px; color: #777;
         border-bottom: 2px solid #ccc; padding: 4px 8px 4px 0; }
    td { border-bottom: 1px solid #eee; padding: 5px 8px 5px 0; vertical-align: top; }
    a { color: inherit; text-decoration: none; }
    .empty { color: #777; }
    @media print { .noprint { display: none; } }
  </style></head><body>
    <div class="noprint" style="position:fixed;top:10px;right:12px;display:flex;gap:8px;z-index:9">
      <button onclick="print()" style="background:#B43333;color:#fff;border:0;border-radius:6px;padding:8px 16px;font:inherit;font-weight:700;cursor:pointer">🖨 Print</button>
      <button onclick="window.close()" title="close this preview" style="background:#3a3f45;color:#fff;border:0;border-radius:6px;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer">✕ Close</button>
    </div>
    <div class="hd"><div class="brand">BRIGHAM LARSON PIANOS</div>
    <div class="sub">${esc(title)} · ${esc(day)} · blpstoremap.netlify.app</div></div>
    ${html}
    <script>onload = () => setTimeout(() => print(), 250)<\/script>
  </body></html>`);
  w.document.close();
}

/* ---------- media report ---------- */
function renderMedia() {
  const el = $('#mediaBody');
  if (!el) return;
  const act = S.data.pianos.filter(p => p.active);
  const lists = {
    'Need BEFORE photos 📷': act.filter(p => mediaNeeds(p).needBP),
    'Need BEFORE video 🎥': act.filter(p => mediaNeeds(p).needBV),
    'Ready — need AFTER photos 📷': act.filter(p => mediaNeeds(p).needAP),
    'Ready — need AFTER video 🎥': act.filter(p => mediaNeeds(p).needAV),
  };
  const rowFor = p => {
    const nm = (p.year ? p.year + ' ' : '') + ([p.make, p.model].filter(Boolean).join(' ') || p.summary);
    const where = p.location || 'no spot';
    const ph = p.phase ? ` · ${esc(p.phase)}` : '';
    return `<tr class="mrow" data-row="${p.row}"><td>${esc(nm)}</td>
      <td>${esc(p.serial)}</td><td class="locraw">${esc(where)}</td><td>${ph}</td>
      <td><a target="_blank" rel="noopener" href="${logLink(p)}">log ↗</a></td></tr>`;
  };
  el.innerHTML = Object.entries(lists).map(([title, ps]) =>
    `<h3 class="msec">${title} <span class="pc">${ps.length}</span></h3>
     <div class="tscroll"><table>${
       ps.length ? ps.map(rowFor).join('')
       : '<tr><td class="empty">None 🎉</td></tr>'}</table></div>`).join('');
  el.querySelectorAll('.mrow').forEach(tr => tr.onclick = () => {
    const p = S.data.pianos.find(x => x.row === +tr.dataset.row);
    if (p) focusPiano(p);
  });
}

/* ---------- move board ---------- */
function renderBoard() {
  const evs = S.data.events;
  $('#boardCount').textContent = evs.length;
  const today = localDay();
  const byDay = {};
  evs.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  $('#board').innerHTML = Object.keys(byDay).sort().map(d => {
    const label = new Date(d + 'T12:00').toLocaleDateString('en-US',
      {weekday: 'long', month: 'short', day: 'numeric'});
    return `<div class="boardday ${d === today ? 'today' : ''}">${d === today ? 'TODAY — ' : ''}${label}</div>` +
      byDay[d].map(e => `<div class="bev">
        <span class="t">${e.time || '—'}</span><span>${esc(e.summary)}</span>
      </div>`).join('');
  }).join('');
}

/* ---------- 👤 My Dashboard — the tech's locker-room roster card ----------
 * Celebrations → black roster card (live clock pill, 🏆 PR badges, tappable
 * pianos-touched) → on the bench → the four tools (My Week / Friday Report /
 * Calendar open the shop app in place; Paylogics is external) → personal
 * records → PR watch. Per-tech numbers come from the bridge (techdash). */
const SHOP_APP = 'https://blpshop.netlify.app/';
function dashFrame(hash, title) {
  // the shop app needs its own sign-in, and Google refuses to run OAuth
  // inside an iframe (Mark hit its 403 page, 9/1) — iOS also hides the
  // iframe's saved login. A real tab is the only reliable container.
  window.open(SHOP_APP + hash, '_blank', 'noopener');
}
async function loadTechDash(name) {
  if (S.dashData && S.dashData.forName === name && Date.now() - S.dashData.at < 300000) return S.dashData;
  const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
    headers: {'content-type': 'text/plain;charset=utf-8'},
    // techdash is read-only personal stats; fall back to the shared shop
    // key (already public in this file) so teammates signed in with a
    // personal Google account (Lisa, 9/3) aren't refused their own numbers
    body: JSON.stringify({pin: lsGet('blpPin') || 'pianoman', action: 'techdash',
      user: {name}, ...authFields()})});
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'dashboard load failed');
  S.dashData = {...j, forName: name, at: Date.now()};
  return S.dashData;
}
function dashInitials(name) {
  return name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
}
/* 🕘 personal clock history + 40-hour watch (Brigham 9/3): every team
 * member can verify their own punches and see how close the week is to
 * 40 h — overtime needs Brigham's approval AHEAD of time. */
const MYCLOCK = {at: 0, forName: '', pay: null, tl: null};
function myClockMatch(rowTech, myName) {
  const AL = {guadalupe: 'lupita'};
  const norm = x => String(x || '').trim().toLowerCase();
  const first = x => { const f = norm(x).split(/\s+/)[0]; return AL[f] || f; };
  return norm(rowTech) === norm(myName) || first(rowTech) === first(myName);
}
async function loadMyClock(name) {
  if (MYCLOCK.pay && MYCLOCK.forName === name && Date.now() - MYCLOCK.at < 300000) return;
  MYCLOCK.at = Date.now(); MYCLOCK.forName = name;
  try {
    // fast path: service-account sheet read (~0.5s) — Google's Apps Script
    // can take 30s+ when it's moody, and punch verification can't wait
    const fr = await fetch('https://blpsalesapp.netlify.app/.netlify/functions/clock-history?key=pianoman&days=16');
    const fj = await fr.json();
    if (!fj.ok) throw new Error(fj.error || 'fast feed down');
    MYCLOCK.pay = (fj.pay || []).filter(r => myClockMatch(r.tech, name));
    MYCLOCK.tl = (fj.tl || []).filter(r => myClockMatch(r.tech, name));
  } catch (e0) {
    try {
      const [pr, tr] = await Promise.all([
        fetch(BRIDGE_URL + '?fn=payrollrows&days=16', {redirect: 'follow'}).then(r => r.json()),
        fetch(BRIDGE_URL + '?fn=timelog&days=16', {redirect: 'follow'}).then(r => r.json()),
      ]);
      MYCLOCK.pay = (pr.rows || []).filter(r => myClockMatch(r.tech, name));
      MYCLOCK.tl = (tr.rows || []).filter(r => myClockMatch(r.tech, name));
    } catch (e) { MYCLOCK.pay = MYCLOCK.pay || []; MYCLOCK.tl = MYCLOCK.tl || []; }
  }
  // payroll day-clock officially began 9/1/2026 — trial punches before
  // that never show on dashboards (piano Time Log keeps full history)
  const PAY_EPOCH = new Date('2026-09-01T00:00:00-06:00').getTime();
  MYCLOCK.pay = (MYCLOCK.pay || []).filter(r => {
    const t = new Date(r.start).getTime();
    return !isNaN(t) && t >= PAY_EPOCH;
  });
  if (S.view === 'dash') renderDash();
}
// per-person approved weekly hours (Brigham 9/3): Lisa 28, Ezzy 20;
// everyone else (Melissa included) is on the standard 40.
const WEEK_CAP = {lisa: 28, ezzy: 20};
function myWeekCap(name) {
  return WEEK_CAP[String(name || '').trim().split(/\s+/)[0].toLowerCase()] || 40;
}
function myWeekCard() {
  const cap = myWeekCap(MYCLOCK.forName || clockName());
  if (!MYCLOCK.pay) return `<div class="dbench"><h4>⏳ My week vs ${cap} hours</h4><div class="dline dim">loading your punches…</div></div>`;
  const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Denver'});
  const monday = weekKey(today);
  let mins = 0;
  for (const r of MYCLOCK.pay) {
    const day = denverDay(r.start);
    if (day < monday) continue;
    mins += r.end ? (r.minutes || 0) : Math.max(0, (Date.now() - new Date(r.start)) / 60000);
  }
  const h = mins / 60, left = cap - h;
  const pctBar = Math.min(100, h / cap * 100);
  const tone = h >= cap ? '#9e2020' : h >= cap - 6 ? '#9a5b13' : '#2f7d4f';
  const msg = h >= cap
    ? `<b style="color:#9e2020">You've hit ${h.toFixed(1)} h — your approved week is ${cap} h. Stop and check with Brigham.</b>`
    : h >= cap - 6
      ? `<b style="color:#9a5b13">${left.toFixed(1)} h left before ${cap}</b> — plan the rest of the week so you don't go over. Going past ${cap} h needs Brigham's OK <u>ahead of time</u>.`
      : `<b>${h.toFixed(1)} h</b> this week · ${left.toFixed(1)} h until ${cap}.`;
  return `<div class="dbench db-forty">
    <h4>⏳ My week vs ${cap} hours</h4>
    <div style="height:12px;background:#efece6;border-radius:6px;overflow:hidden;margin:6px 0">
      <div style="height:100%;width:${pctBar}%;background:${tone};border-radius:6px"></div></div>
    <div class="dline">${msg}</div>
    <div class="dline dim">Week runs Monday–Sunday, from your Payroll Clock punches (live punch included).</div>
  </div>`;
}
function myClockHistory() {
  if (!MYCLOCK.pay) return `<div class="dbench"><h4>🕘 My clock history — last 2 weeks</h4>
    <div class="dline dim">loading your punches… (Google's sheets can take a moment)</div></div>`;
  const days = {};
  for (const r of MYCLOCK.pay) {
    const d = denverDay(r.start);
    (days[d] = days[d] || {pay: [], tl: []}).pay.push(r);
  }
  for (const r of (MYCLOCK.tl || [])) {
    const d = denverDay(r.start);
    (days[d] = days[d] || {pay: [], tl: []}).tl.push(r);
  }
  const keys = Object.keys(days).sort().reverse().slice(0, 14);
  if (!keys.length) return `<div class="dbench"><h4>🕘 My clock history</h4><div class="dline dim">No punches in the last two weeks.</div></div>`;
  const dayLabel = d => new Date(d + 'T12:00').toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'});
  const rows = keys.map(d => {
    const g = days[d];
    const payMin = g.pay.reduce((a, r) => a + (r.end ? (r.minutes || 0) : Math.max(0, (Date.now() - new Date(r.start)) / 60000)), 0);
    const punches = g.pay.map(r => `<span style="white-space:nowrap">${fmtT(r.start)} → ${r.end ? fmtT(r.end) : '<b style="color:#2f7d4f">on clock</b>'}${!r.end || (r.minutes || 0) > 1 ? '' : ' <b style="color:#9e2020">(0 min?)</b>'}</span>`).join(' · ');
    const pianos = g.tl.map(r => `<div style="margin-left:14px;color:#6f6a63;font-size:11.5px">🎹 ${esc(r.phase || '')} — #${esc(r.serial || '')} · ${fmtHM(r.minutes || 0)}${r.end ? '' : ' <b style="color:#2f7d4f">open</b>'}</div>`).join('');
    return `<div style="padding:6px 0;border-top:1px solid #f0ece5">
      <div style="display:flex;gap:8px;align-items:baseline"><b style="min-width:86px">${dayLabel(d)}</b>
        <span style="flex:1">${punches || '<span class="dim">no day punch</span>'}</span>
        <b>${fmtHM(payMin)}</b></div>${pianos}</div>`;
  }).join('');
  return `<div class="dbench db-clockhist">
    <h4>🕘 My clock history — last 2 weeks</h4>
    <div class="dline dim">Day-clock punches with your piano sessions under each day. Spot something wrong?
      <a class="tact cfixlink2" href="#">🛠 Request a time fix</a></div>
    ${rows}
  </div>`;
}
function renderDash() {
  const body = $('#dashBody');
  if (!body) return;
  const name = clockName();
  if (!name) {
    body.innerHTML = `<h2 class="ph">👤 MY DASHBOARD</h2>
      <p class="pd">Sign in (Google or team PIN, ☰ menu) and your dashboard builds itself —
      live Work Clock, personal records, your pianos, and your week.</p>`;
    return;
  }
  fetchPayroll();   // refresh the payroll card whenever the dashboard opens
  const o = CLOCK.open;
  const pill = o
    ? `<span class="dlive on">● ON CLOCK <span class="cctime" data-start="${esc(o.start)}">${clockElapsed(o.start)}</span></span>`
    : `<span class="dlive">○ off the clock</span>`;
  const po = PAY.open;
  const payCard = `<div class="dbench db-pay">
      <h4>💵 Payroll Clock — your paid day</h4>
      ${po ? `<div class="dline now"><b>On the clock for payroll</b> since ${fmtT(po.start)} —
                <span class="cctime" data-start="${esc(po.start)}">${clockElapsed(po.start)}</span></div>`
           : PAY.today.length
             ? `<div class="dline">Clocked out — <b>${fmtHM(payMins())}</b> on the day clock today.</div>`
             : `<div class="dline">Not clocked in for the day yet.</div>`}
      ${po ? `<button class="paybtn payout">■ Clock out for the day</button>`
           : `<button class="paybtn payin">▶ Clock in for the day</button>`}
      <div class="paymsg"></div>
      <div class="dline"><a class="tact cfixlink" href="#">🛠 Request a time fix</a>
        <span class="dim" style="font-size:11.5px">— forgot a punch, or a time is wrong (day clock or piano clock)</span></div>
      <div class="dline dim">Arrival-to-exit for payroll — separate from the per-piano ⏱ Work Clock.
        Punches note your location, so clock in at the store.</div>
    </div>`;
  const d = (S.dashData && S.dashData.forName === name) ? S.dashData : null;
  const prs = d ? d.prs : null;
  const anniv = d ? d.anniv : null;

  const celebrate = anniv && anniv.days <= 45
    ? `<div class="danno">🥂 <b>Work anniversary in ${anniv.days} day${anniv.days === 1 ? '' : 's'}</b> — ${anniv.years} year${anniv.years === 1 ? '' : 's'} at BLP on ${esc(anniv.date)}</div>`
    : '';

  const prWatch = (() => {
    if (!prs || !o || !prs.bestDayH) return '';
    const gap = Math.round((prs.bestDayH - prs.todayH) * 10) / 10;
    if (gap <= 0) return `<div class="dprband">🏆 <b>New personal best day — ${prs.todayH} h and still on the clock!</b></div>`;
    if (gap <= 3) return `<div class="dprband">🏆 <b>PR watch:</b> ${gap} h more today beats your best day (${prs.bestDayH} h). Go get it.</div>`;
    return '';
  })();

  body.innerHTML = `
    ${celebrate}
    <div class="dcard">
      <div class="dcardtop">
        <div><div class="dwho">${esc(name)}</div>
        <div class="dmeta">${esc((((d && d.title) || 'Piano Technician')
          .replace(/^larson family\s*\/\s*/i, '') || 'Piano Technician').toUpperCase())} · BLP</div></div>
        ${pill}
      </div>
      <div class="dprrow">
        <div class="dpr"><b>${prs ? '🏆 ' + prs.bestDayH + 'h' : '…'}</b><span>best day</span></div>
        <div class="dpr"><b>${prs ? '🏆 ' + prs.longestSessionH + 'h' : '…'}</b><span>longest session</span></div>
        <div class="dpr tap" id="dashPianos"><b>${prs ? prs.pianosTouched : '…'}</b><span>pianos touched ›</span></div>
      </div>
    </div>
    ${payCard}
    ${isTimelogAdmin() ? (() => {
      // 🧑‍💼 management time (Brigham 9/3): managers clock time that isn't
      // attached to a piano, and toggle piano ↔ management in one tap.
      // Rides the normal Work Clock under the pseudo-serial MGMT.
      const onMgmt = o && o.serial === 'MGMT';
      return `<div class="dbench db-mgmt">
        <h4>🧑‍💼 Management time</h4>
        ${onMgmt ? `<div class="dline now"><b>On management time</b> since ${fmtT(o.start)} —
              <span class="cctime" data-start="${esc(o.start)}">${clockElapsed(o.start)}</span></div>
            <button class="paybtn mgmtoff">■ End management time</button>
            <div class="dline dim">Opening a piano card and clocking in there switches you back to piano time automatically.</div>`
          : o ? `<div class="dline">You're on <b>#${esc(o.serial)}</b> — one tap moves you to management time and closes the piano session.</div>
            <button class="paybtn mgmton">🧑‍💼 Switch to management time</button>`
          : `<button class="paybtn mgmton">▶ Clock into management time</button>
            <div class="dline dim">For meetings, planning, scheduling — anything not attached to one piano.</div>`}
        <div class="mgmtmsg phmsg"></div>
      </div>`;
    })() : ''}
    ${myWeekCard()}
    <div class="dbench db-timeoff">
      <h4>🏖 Time off</h4>
      ${myTimeOffLines()}
    </div>
    <div class="dbench db-bench">
      <h4>⏱ On the bench right now</h4>
      ${o ? `<div class="dline now"><b>${esc(o.phase || 'Working')} — ${esc(o.piano || '')} #${esc(o.serial)}</b>
               · <span class="cctime" data-start="${esc(o.start)}">${clockElapsed(o.start)}</span> and counting</div>`
          : `<div class="dline">Not clocked in — open a piano's card and hit ▶ Clock in.</div>`}
      <div class="dline dim">Your queue for the week lives in <a class="dlink2" data-h="#myweek">📋 My Week ›</a></div>
    </div>
    ${myClockHistory()}
    <div class="dlockers">
      <div class="dlocker" data-h="#myweek"><span class="ic">📋</span><b>My Week</b><span>work items · carries into your report</span></div>
      <div class="dlocker" data-h="#report"><span class="ic">📝</span><b>Weekly Report</b><span>due Thursday 6pm</span></div>
      <div class="dlocker" data-h="#calendars"><span class="ic">📅</span><b>My Calendar</b><span>assigned vs. reported</span></div>
      <div class="dlocker" data-pay="1"><span class="ic">💵</span><b>Paylogics ↗</b><span>paystubs · time off</span></div>
    </div>
    ${prs ? `<div class="dbench db-recs">
      <h4>🏆 Personal records</h4>
      <div class="dline">Best day on the clock: <b>${prs.bestDayH} h</b>${prs.bestDayWhen ? ' (' + esc(prs.bestDayWhen.slice(5)) + ')' : ''}</div>
      <div class="dline">Best week: <b>${prs.bestWeekH} h</b> · Most pianos in a week: <b>${prs.mostPianosWeek}</b></div>
      <div class="dline">Longest focused session: <b>${prs.longestSessionH} h</b>${prs.longestSessionPhase ? ' on ' + esc(prs.longestSessionPhase) : ''}</div>
      <div class="dline">Today so far: <b>${prs.todayH} h</b></div>
    </div>` : '<div class="dbench db-recs"><h4>🏆 Personal records</h4><div class="dline dim">crunching your Time Log…</div></div>'}
    ${prWatch}
    <p class="dsoon">coming soon: report history · phase-time PRs as the Work Clock fills in</p>`;

  loadMyClock(name);
  const mOn = body.querySelector('.mgmton'), mOff = body.querySelector('.mgmtoff');
  if (mOn) mOn.onclick = async () => {
    mOn.disabled = true; mOn.textContent = 'Clocking in…';
    const j = await punch('clockin', {serial: 'MGMT', row: ''}, 'Management', 'dash');
    const mm = body.querySelector('.mgmtmsg');
    if (j.error) { if (mm) { mm.className = 'mgmtmsg phmsg err'; mm.textContent = j.error; } mOn.disabled = false; mOn.textContent = '🧑‍💼 Management time'; }
    else renderDash();
  };
  if (mOff) mOff.onclick = async () => {
    mOff.disabled = true; mOff.textContent = 'Clocking out…';
    const j = await punch('clockout', null, '', 'dash');
    const mm = body.querySelector('.mgmtmsg');
    if (j.error) { if (mm) { mm.className = 'mgmtmsg phmsg err'; mm.textContent = j.error; } mOff.disabled = false; mOff.textContent = '■ End management time'; }
    else renderDash();
  };
  const cfx2 = body.querySelector('.cfixlink2');
  if (cfx2) cfx2.onclick = ev => { ev.preventDefault(); const l = body.querySelector('.cfixlink'); if (l) l.click(); };
  const cfx = body.querySelector('.cfixlink');
  if (cfx) cfx.onclick = e => { e.preventDefault(); clockFixModal(); };
  const pb = body.querySelector('.paybtn');
  if (pb) pb.onclick = async () => {
    const dirPeek = pb.classList.contains('payin') ? 'in' : 'out';
    // movers verify today's calendar against the map before clocking out
    if (dirPeek === 'out' && await moverChecklistNeeded() && !(await moverChecklist())) return;
    pb.disabled = true;
    pb.textContent = pb.classList.contains('payin') ? 'Clocking in…' : 'Clocking out…';
    const dir = dirPeek;
    const j = await dayPunch(dir === 'in' ? 'dayin' : 'dayout');
    if (j && j.error === 'geofence') {
      // outside the fence with a confident GPS fix: the punch was refused —
      // offer the manager time-adjustment path instead (Brigham 8/26)
      const pm = body.querySelector('.paymsg');
      if (pm) {
        pm.className = 'paymsg err';
        pm.innerHTML = `📍 You're ${esc(String(j.awayMiles))} mi from the shop — you need to be at
          work to clock ${dir}. <a href="#" class="geo-fix" style="font-weight:700">Request a
          manager time adjustment ›</a>`;
        pm.querySelector('.geo-fix').onclick = e => {
          e.preventDefault();
          clockFixModal(`I tried to clock ${dir} at `
            + new Date().toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})
            + ` but was away from the shop (${j.awayMiles} mi). My actual clock-${dir} time should be: `);
        };
      }
      pb.disabled = false;
      pb.textContent = dir === 'in' ? '▶ Clock in for the day' : '■ Clock out for the day';
    } else if (j && j.error) {
      const pm = body.querySelector('.paymsg');
      if (pm) { pm.className = 'paymsg err'; pm.textContent = j.error; }
      pb.disabled = false;
      pb.textContent = dir === 'in' ? '▶ Clock in for the day' : '■ Clock out for the day';
    } else renderDash();
  };
  body.querySelectorAll('.dlocker[data-h], .dlink2').forEach(el => el.onclick = () => {
    const h = el.dataset.h;
    const titles = {'#myweek': '📋 My Week', '#report': '📝 My Weekly Report (due Thursday)', '#calendars': '📅 My Calendar'};
    dashFrame(h, titles[h] || 'Shop App');
  });
  const pay = body.querySelector('[data-pay]');
  if (pay) pay.onclick = () => window.open('https://identity.myisolved.com', '_blank', 'noopener');
  const pt = body.querySelector('#dashPianos');
  if (pt) pt.onclick = () => {
    if (!d || !d.pianos) return;
    const old = document.querySelector('.dsheetov'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.className = 'dsheetov';
    ov.innerHTML = `<div class="dsheet"><button class="dsx">✕</button>
      <h3>🎹 Pianos ${esc(name.split(' ')[0])} has worked on</h3>
      <div class="dssub">${d.pianos.length} piano${d.pianos.length === 1 ? '' : 's'} · from the Work Clock · newest first</div>
      <table><tr><th>PIANO</th><th>PHASES</th><th>HOURS</th></tr>
      ${d.pianos.map(p => `<tr><td>${esc(p.piano || '—')}<br><small>#${esc(p.serial)}</small></td>
        <td>${esc(p.phases || '—')}</td><td>${p.hours}</td></tr>`).join('')
       || '<tr><td colspan="3">No clocked pianos yet — they appear as you clock in.</td></tr>'}
      </table></div>`;
    document.body.appendChild(ov);
    ov.querySelector('.dsx').onclick = () => ov.remove();
    ov.onclick = ev => { if (ev.target === ov) ov.remove(); };
  };

  if (!d) {
    loadTechDash(name)
      .then(() => { if (S.view === 'dash') renderDash(); })
      .catch(e => {
        const pr = body.querySelector('.dbench:last-of-type .dline');
        if (pr) pr.textContent = 'couldn’t load your Time Log — ' + e.message;
      });
  }
}

/* ---------- training ---------- */
// Guides & handbooks shown on the 🎓 Training view. Docs open IN-APP via
// openTrainingDoc(): content lives in data/training/<doc>.json + <doc>.es.json
// (the .es file is served when the 🌐 language is Español, marked
// translate="no" so Google page-translate leaves the curated Spanish alone).
// Regenerate the JSON with scripts/build-training-docs.py. To add a training:
// add its two JSON files and one {doc, title, desc} entry here — `video` is
// optional and adds a "▶ watch video" link.
const TRAININGS = [
  {
    doc: 'guide',
    title: 'Store Map User Guide',
    desc: 'How to use the BLP Store Map: signing in, finding pianos, clocking work time, paperwork & photos.',
    readLabel: 'training handout',
    video: 'https://youtu.be/1zDlnks5CC0',
  },
  {
    doc: 'handbook',
    title: 'BLP Restoration Handbook',
    desc: 'The complete BLP restoration handbook.',
  },
  {
    doc: 'policies',
    title: 'Professional Standards & Team Culture',
    desc: 'BLP professional standards: punctuality, dress code, safety, workplace conduct & cleanliness.',
  },
];
// the training-video transcript opens as its own in-app doc, in either
// language explicitly (EN and ES links sit next to the video link)
function transcriptDoc(lang) {
  return {doc: 'video-transcript', title: 'Training Video — Transcript', forceLang: lang};
}
function transcriptLinks() {
  return `<a class="tact" href="#" data-tdoc="en">📄 English Transcript</a>
          <a class="tact" href="#" data-tdoc="es">📄 Spanish Transcript</a>`;
}
function wireDocLinks(el) {
  el.querySelectorAll('[data-doc]').forEach(a => a.onclick = e => {
    e.preventDefault();
    openTrainingDoc(TRAININGS[+a.dataset.doc]);
  });
  el.querySelectorAll('[data-tdoc]').forEach(a => a.onclick = e => {
    e.preventDefault();
    openTrainingDoc(transcriptDoc(a.dataset.tdoc));
  });
}
function renderTraining() {
  const el = $('#trainingBody');
  if (!el) return;
  el.innerHTML = TRAININGS.map((t, i) =>
    `<div class="trainrow">
       <b>${esc(t.title)}</b><span>${esc(t.desc)}</span>
       <a class="tact" href="#" data-doc="${i}">📖 ${esc(t.readLabel || 'read')}</a>${
       t.video ? `<a class="tact" href="${esc(t.video)}" target="_blank" rel="noopener">▶ watch video</a>` + transcriptLinks() : ''
     }</div>`).join('');
  wireDocLinks(el);
}
renderTraining();

const trainDocCache = {};
async function fetchTrainingDoc(id, lang) {
  const key = id + '.' + lang;
  if (trainDocCache[key]) return trainDocCache[key];
  const file = 'data/training/' + id + (lang === 'es' ? '.es' : '') + '.json';
  const r = await fetch(file);
  if (!r.ok) throw new Error(file + ' → HTTP ' + r.status);
  return (trainDocCache[key] = await r.json());
}
async function openTrainingDoc(t) {
  const body = $('#trainingDocBody');
  switchView('trainingdoc');
  const close = $('#view-trainingdoc .viewclose');
  if (close) { close.onclick = () => switchView('training'); close.title = 'Back to Training'; }
  const es = t.forceLang ? t.forceLang === 'es' : lsGet('blpLang') === 'es';
  body.innerHTML = '<p class="pd">Loading…</p>';
  let doc;
  try { doc = await fetchTrainingDoc(t.doc, es ? 'es' : 'en'); }
  catch (e) {
    try { doc = await fetchTrainingDoc(t.doc, 'en'); }
    catch (e2) { body.innerHTML = `<p class="pd">Couldn’t load this doc — ${esc(e2.message)}</p>`; return; }
  }
  const secs = doc.sections.filter(s => s.html);
  const usingEs = doc.lang === 'es';
  const toc = secs.filter(s => s.title).length > 4
    ? `<div class="tdtoc">${secs.map((s, i) => s.title
        ? `<button class="tdchip" data-sec="td-${i}">${esc(s.title)}</button>` : '').join('')}</div>`
    : '';
  body.innerHTML =
    `<div class="tdwrap${usingEs ? ' notranslate' : ''}"${usingEs ? ' translate="no"' : ''}>
       <a class="tact tdback" href="#">← ${usingEs ? 'Todas las capacitaciones' : 'All trainings'}</a>
       <h2 class="ph">${esc(doc.title || t.title)}</h2>
       ${t.video ? `<p class="pd"><a class="tact" href="${esc(t.video)}" target="_blank" rel="noopener">▶ ${usingEs ? 'ver el video de capacitación' : 'watch the training video'}</a> ${transcriptLinks()}</p>` : ''}
       ${toc}
       ${secs.map((s, i) => `<section class="tdsec" id="td-${i}">${s.title ? `<h3>${esc(s.title)}</h3>` : ''}${s.html}</section>`).join('')}
     </div>`;
  body.querySelector('.tdback').onclick = e => { e.preventDefault(); switchView('training'); };
  wireDocLinks(body);
  body.querySelectorAll('.tdchip').forEach(c => c.onclick = () => {
    const s = document.getElementById(c.dataset.sec);
    if (s) s.scrollIntoView({behavior: 'smooth', block: 'start'});
  });
  // handbook video embeds: click-to-play thumbnails, iframe only on demand
  body.querySelectorAll('.hbvid').forEach(v => {
    const yt = v.dataset.yt, start = v.dataset.start || 0, title = v.dataset.title || '';
    if (!yt) return;
    v.innerHTML = `<img src="https://i.ytimg.com/vi/${esc(yt)}/hqdefault.jpg" alt="${esc(title)}" loading="lazy"><span class="tdplay">▶</span>${title ? `<span class="tdvtitle">${esc(title)}</span>` : ''}`;
    v.onclick = () => {
      const f = document.createElement('iframe');
      f.className = 'tdiframe';
      f.src = `https://www.youtube-nocookie.com/embed/${yt}?start=${start}&autoplay=1`;
      f.allow = 'autoplay; encrypted-media; picture-in-picture';
      f.allowFullscreen = true;
      v.replaceWith(f);
    };
  });
  $('#view-trainingdoc').scrollTop = 0;
  const panel = $('#view-trainingdoc .panel');
  if (panel) panel.scrollTop = 0;
}

/* ===================== WHITEBOARD (parts / supplies / tools requests) =====
 * The shop's wall board, digital — same Netlify function + sheet tab as the
 * Shop App's Whiteboard, so both apps (and the Shop Manager) see one board.
 * Lifecycle: requested → Ordered (waiting area) → Arrived.
 * Auth: the function's shop password; changes attributed to the signed-in
 * Store Map user (clockName), falling back to "Team". */
const WHITEBOARD_API = 'https://blpsalesapp.netlify.app/.netlify/functions/whiteboard';
const WB_KEY = 'pianoman';
const WB = {rows: null, loading: false, err: null, busy: false, showArrived: false};
const WB_COLS = [['Parts', 'running low on'], ['Supplies', ''], ['Tools', 'suggestions & upgrades']];
const wbWho = () => clockName() || 'Team';
async function wbFetch(bg) {
  if (WB.loading) return;
  WB.loading = true; WB.err = null;
  if (!bg) renderWhiteboard();
  try {
    const r = await fetch(WHITEBOARD_API + '?key=' + encodeURIComponent(WB_KEY));
    const j = await r.json();
    if (j.error) WB.err = 'Couldn’t reach the whiteboard: ' + j.error;
    else WB.rows = j.rows;
  } catch (e) { if (!bg) WB.err = 'Couldn’t reach the whiteboard: ' + String(e.message || e); }
  WB.loading = false; renderWhiteboard();
}
async function wbPost(body) {
  const r = await fetch(WHITEBOARD_API, {method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({key: WB_KEY, by: wbWho(), ...body})});
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status));
}
function wbItemHTML(r) {
  return `<div class="wbitem ${r.arrived ? 'done' : ''}" data-row="${r.row}">
    <span style="flex:1"><span class="wtxt">${esc(r.item)}</span>
      ${r.note ? `<span class="wnote">${esc(r.note)}</span>` : ''}
      <span class="wmeta">${esc(r.by)}${r.added ? ' · ' + esc(r.added) : ''}</span></span>
    <span style="display:flex;gap:5px;flex-direction:column;align-items:flex-end">
      <button class="tpillw ${r.ordered ? 'on' : ''}" data-row="${r.row}" data-act="ordered" data-on="${r.ordered ? '1' : ''}"
        title="${esc(r.orderedAt)}">Ordered${r.ordered ? ' ✓' : ''}</button>
      <button class="tpillw ${r.arrived ? 'on' : ''}" data-row="${r.row}" data-act="arrived" data-on="${r.arrived ? '1' : ''}"
        title="${esc(r.arrivedAt)}">Arrived${r.arrived ? ' ✓' : ''}</button>
    </span></div>`;
}
function wbBoardHTML() {
  const rows = WB.rows || [];
  return `<div class="wbgrid">
    ${WB_COLS.map(([col, note]) => {
      const inCol = rows.filter(r => r.column.toLowerCase() === col.toLowerCase());
      const open = inCol.filter(r => !r.ordered && !r.arrived);
      const ordered = inCol.filter(r => r.ordered && !r.arrived);
      const arrived = inCol.filter(r => r.arrived);
      return `<div class="wbcol"><h3>${esc(col)}${note ? `<small>${esc(note)}</small>` : ''}</h3>
        <div class="wbadd"><input maxlength="200" placeholder="what do we need?" data-col="${esc(col)}">
          <button data-col="${esc(col)}">+ add</button></div>
        ${open.map(wbItemHTML).join('') || `<div class="wbnone">nothing on the board</div>`}
        ${ordered.length ? `<div class="wbsect">📦 Ordered — waiting to arrive</div>` + ordered.map(wbItemHTML).join('') : ''}
        ${WB.showArrived && arrived.length ? `<div class="wbsect">✓ Arrived</div>` + arrived.map(wbItemHTML).join('') : ''}
      </div>`;
    }).join('')}
  </div>`;
}
function wbWire(v) {
  const rerender = renderWhiteboard, refetch = () => wbFetch(true);
  v.querySelectorAll('.wbadd button').forEach(b => b.onclick = async () => {
    const inp = v.querySelector(`.wbadd input[data-col="${b.dataset.col}"]`);
    const item = inp.value.trim(); if (!item) { inp.focus(); return; }
    b.disabled = true;
    try {
      await wbPost({action: 'add', column: b.dataset.col, item});
      WB.rows.push({row: 0, column: b.dataset.col, item, note: '', by: wbWho(),
        added: new Date().toLocaleDateString('en-US'), ordered: false, orderedAt: '', arrived: false, arrivedAt: ''});
      inp.value = ''; rerender(); refetch();
    } catch (e) { const m = v.querySelector('.wbmsg'); if (m) { m.className = 'wbmsg err'; m.textContent = '✗ ' + (e.message || e); } b.disabled = false; }
  });
  v.querySelectorAll('.tpillw').forEach(btn => btn.onclick = async ev => {
    ev.stopPropagation();
    if (WB.busy) return;
    const row = +btn.dataset.row; if (!row) return;
    WB.busy = true;
    const rec = WB.rows.find(r => r.row === row);
    const act = btn.dataset.act, on = !btn.dataset.on;
    const stamp = new Date().toLocaleDateString('en-US') + ' · ' + wbWho();
    const prev = rec && {ordered: rec.ordered, orderedAt: rec.orderedAt, arrived: rec.arrived, arrivedAt: rec.arrivedAt};
    if (rec) { if (act === 'ordered') { rec.ordered = on; rec.orderedAt = on ? stamp : ''; } else { rec.arrived = on; rec.arrivedAt = on ? stamp : ''; } }
    rerender();
    try { await wbPost({action: act, row, on}); }
    catch (e) {
      if (rec && prev) Object.assign(rec, prev);
      rerender();
      const m = v.querySelector('.wbmsg'); if (m) { m.className = 'wbmsg err'; m.textContent = '✗ ' + (e.message || e); }
    }
    WB.busy = false;
  });
}
function renderWhiteboard() {
  const v = $('#wbBody'); if (!v) return;
  // don't clobber a column input someone is typing in (background refreshes)
  if (document.activeElement && v.contains(document.activeElement) &&
      /^(SELECT|INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
  const y = window.scrollY;
  v.innerHTML = `
    <div class="wbtop">
      <span class="wbjump">${WB_COLS.map(([c]) =>
        `<button class="wbctl wbjumpbtn" data-c="${esc(c)}">＋ ${esc(c)}</button>`).join('')}</span>
      <button class="wbctl wbToggleDone">${WB.showArrived ? 'Hide arrived items' : 'Show arrived items'}</button>
      <button class="wbctl wbRefresh">Refresh</button>
    </div>
    <div class="wbmsg${WB.err ? ' err' : ''}">${WB.err ? esc(WB.err) : (WB.loading && !WB.rows ? 'Loading…' : '')}</div>
    ${WB.rows ? wbBoardHTML() : ''}`;
  window.scrollTo(0, y);
  v.querySelector('.wbRefresh').onclick = () => { WB.err = null; wbFetch(true); };
  v.querySelector('.wbToggleDone').onclick = () => { WB.showArrived = !WB.showArrived; renderWhiteboard(); };
  // mobile (Karmel 8/27): columns stack, so jump straight to a column's
  // add-input instead of scrolling past the whole board
  v.querySelectorAll('.wbjumpbtn').forEach(b => b.onclick = () => {
    const inp = v.querySelector(`.wbadd input[data-col="${b.dataset.c}"]`);
    if (!inp) return;
    inp.closest('.wbcol').scrollIntoView({behavior: 'smooth', block: 'start'});
    setTimeout(() => inp.focus(), 350);
  });
  if (WB.rows) wbWire(v);
  if (!WB.rows && !WB.loading && !WB.err) wbFetch();
}
setTimeout(() => {
  const b = document.getElementById('wbBtn');
  if (b) b.onclick = () => switchView('whiteboard');
  const tb = document.getElementById('boardBtn');
  if (tb) tb.onclick = () => switchView('tboard');
}, 0);

/* ---------- 👥 TEAM dashboard (admin + managers + owners) ----------
 * Three tabs fed by the same sources the Shop App uses: the Store Map
 * bridge (piano clock / day clock / where-is) and the salesapp2 team
 * bridges (roster safe-columns, Team Schedule tab). Read-only v1 — edits
 * still happen in the Shop Manager app / the sheets themselves. */
const TEAM_ROSTER_API = 'https://blpsalesapp.netlify.app/.netlify/functions/team-roster';
const TEAM_SCHEDULE_API = 'https://blpsalesapp.netlify.app/.netlify/functions/team-schedule';
function isTeamAdmin() { return isAdminUser() || isTimelogAdmin(); }
const TEAM = {tab: 'board', roster: null, sched: null, clock: null, pay: null, where: null, loading: false};
async function teamFetchAll() {
  if (TEAM.loading) return;
  TEAM.loading = true;
  const j = async pr => { try { const r = await pr; return await r.json(); } catch (e) { return null; } };
  const key = '?key=' + encodeURIComponent('pianoman');
  const [ros, sch, clk, pay, whr] = await Promise.all([
    j(fetch(TEAM_ROSTER_API + key)),
    j(fetch(TEAM_SCHEDULE_API + key)),
    j(fetch(BRIDGE_URL + '?fn=timeclock', {redirect: 'follow'})),
    j(fetch(BRIDGE_URL + '?fn=payroll', {redirect: 'follow'})),
    j(fetch(BRIDGE_URL + '?fn=whereis', {redirect: 'follow'})),
  ]);
  TEAM.roster = ros && ros.tabs ? ros.tabs : null;
  TEAM.sched = sch && sch.tabs ? sch.tabs['Team Schedule'] : null;
  try { lsSet('blpTeam1', JSON.stringify({roster: TEAM.roster, sched: TEAM.sched, at: Date.now()})); } catch (e) {}
  TEAM.clock = clk && clk.open ? clk : {open: [], todayMinutes: {}};
  TEAM.pay = pay && pay.open ? pay : {open: [], today: (pay && pay.today) || []};
  TEAM.where = (whr && whr.who) || {};
  TEAM.loading = false;
  renderTeam();
}
function teamClockFmt(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
}
// Brigham's board membership edits (8/27) — hides and group overrides sit on
// top of the roster's Position column, matched on the full name
const BOARD_HIDE = ['ben larson', 'karmel larson', 'brielle larson',
  'susie marinez', 'susie martinez', 'louis larson', 'loius larson', 'abby larson'];
const BOARD_GROUP = {'josh larson': 'Movers', 'lisa litton': 'Admin'};
// on the board even though they're not on the roster's Current Team tab
const BOARD_SEED = [{full: 'Lisa Litton', pos: 'Administrative', group: 'Admin'}];
function teamBoardHTML() {
  const rows = (TEAM.roster && TEAM.roster['Current Team']) || [];
  const cat = pos => /intern/i.test(pos) ? 'Interns' : /refinish/i.test(pos) ? 'Refinishers'
    : /admin/i.test(pos) ? 'Admin' : /mover/i.test(pos) ? 'Movers' : 'Technicians';
  const groups = {Technicians: [], Interns: [], Refinishers: [], Admin: [], Movers: []};
  rows.slice(1).forEach(r => {
    const full = (String(r[0] || '').trim() + ' ' + String(r[1] || '').trim()).trim();
    if (!full) return;
    const key = full.toLowerCase().replace(/\s+/g, ' ');
    if (BOARD_HIDE.includes(key)) return;
    groups[BOARD_GROUP[key] || cat(String(r[2] || ''))].push({full, pos: String(r[2] || '')});
  });
  BOARD_SEED.forEach(s => {
    const there = Object.values(groups).some(l => l.some(m => m.full.toLowerCase() === s.full.toLowerCase()));
    if (!there) groups[s.group].push({full: s.full, pos: s.pos});
  });
  const norm = s => String(s || '').trim().toLowerCase();
  // nicknames: the roster's Current Team tab uses legal names, but punches
  // carry the Google profile name — Guadalupe clocks in as Lupita (9/3).
  // Canonicalize first names on BOTH sides of every match.
  const ALIAS = {guadalupe: 'lupita'};
  const firstOf = s => { const f = norm(s).split(/\s+/)[0]; return ALIAS[f] || f; };
  const openFor = full => (TEAM.clock.open || []).find(o =>
    norm(o.tech) === norm(full) || firstOf(o.tech) === firstOf(full));
  const payFor = full => {
    const openP = (TEAM.pay.open || []).find(o => norm(o.tech) === norm(full) || firstOf(o.tech) === firstOf(full));
    if (openP) return {on: true, start: openP.start};
    const done = (TEAM.pay.today || []).filter(t => (norm(t.tech) === norm(full) || firstOf(t.tech) === firstOf(full)) && t.end);
    const mins = done.reduce((s, t) => s + (t.minutes || 0), 0);
    return {on: false, mins};
  };
  // whereis: {st: off|part|field, why, until} keyed by lowercase first name —
  // tile priority mirrors the Shop App: 🎹 piano → 🕔 day-only → 🏖/🚗/🌗
  // away → and only then a genuine "not clocked in" (Brigham's V71 notes)
  const whereFor = full => {
    const f = firstOf(full);
    const w = TEAM.where[f] || TEAM.where[full.toLowerCase()] || null;
    return w && typeof w === 'object' ? w : (w ? {st: 'off', why: String(w)} : null);
  };
  const tile = m => {
    const o = openFor(m.full), pw = payFor(m.full);
    const w = (!o && !pw.on) ? whereFor(m.full) : null;
    const away = w ? (w.st === 'off' ? '🏖 ' + esc(w.why || 'day off')
      : w.st === 'field' ? '🚗 field — ' + esc(w.why || 'appointment') + (w.until ? ' · until ' + esc(w.until) : '')
      : '🌗 ' + esc(w.why || 'partial day')) : '';
    const mins = o ? Math.max(0, Math.round((Date.now() - new Date(o.start)) / 60000)) : 0;
    const flag = o && !pw.on ? '<div class="tmflag">⚠ on a piano, no day punch</div>' : '';
    // more than one open session on the same piano: fine for training or
    // two-person jobs, but surfaced so a missed switch is easy to catch
    const mates = o ? (TEAM.clock.open || []).filter(x => x.serial === o.serial
      && norm(x.tech) !== norm(o.tech)) : [];
    const shared = mates.length ? `<div class="tmshared">👥 with ${esc(mates.map(x =>
      String(x.tech || '').split(/\s+/)[0]).join(', '))} — together or a missed switch?</div>` : '';
    return `<div class="tmtile ${o ? 'onpiano' : pw.on ? 'onday' : w ? 'away' : ''} ${mates.length ? 'shared' : ''}">
      <b>${esc(m.full)}</b><small>${esc(m.pos)}</small>
      ${w ? `<div class="tmaway">${away}</div>` : `
      <div>🎹 ${o ? esc((o.piano || o.serial || '').slice(0, 26)) + ' · ' + esc(o.phase || '') +
        ' · ' + Math.floor(mins / 60) + ':' + String(mins % 60).padStart(2, '0') : '—'}</div>
      <div>🕔 ${pw.on ? 'in since ' + teamClockFmt(pw.start)
        : pw.mins ? 'done · ' + (pw.mins / 60).toFixed(1) + 'h today' : 'not clocked in'}</div>`}
      ${shared}${flag}
    </div>`;
  };
  return Object.entries(groups).filter(([, l]) => l.length).map(([g, l]) =>
    `<h4 class="tmsec">${g} <span class="pc">${l.length}</span></h4>
     <div class="tmgrid">${l.map(tile).join('')}</div>`).join('')
    || '<div class="empty">Roster unavailable.</div>';
}
function teamScheduleHTML() {
  const v = TEAM.sched;
  if (!v || !v.length) return '<div class="empty">Schedule unavailable.</div>';
  const dowIdx = {Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7}[
    new Date().toLocaleDateString('en-US', {weekday: 'short', timeZone: 'America/Denver'})];
  const cell = (c, ri, ci) => `<td class="${ci === dowIdx - 1 ? 'tmtoday' : ''}">${esc(String(c || ''))}</td>`;
  return `<div class="tmscroll"><table class="tmtable">
    ${v.map((row, ri) => `<tr>${row.map((c, ci) =>
      ri === 0 ? `<th class="${ci === dowIdx - 1 ? 'tmtoday' : ''}">${esc(String(c || ''))}</th>` : cell(c, ri, ci)).join('')}</tr>`).join('')}
  </table></div>
  <p class="pd">Today's column is highlighted. Edit in the
    <a href="https://docs.google.com/spreadsheets/d/11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I/edit#gid=1355785595" target="_blank" rel="noopener">Team Schedule sheet ↗</a>
    or the <a href="https://blpshop.netlify.app/manager.html#schedule" target="_blank" rel="noopener">Shop Manager ↗</a>.</p>`;
}
function teamRosterHTML() {
  if (!TEAM.roster) return '<div class="empty">Roster unavailable.</div>';
  const table = (name, rows) => {
    if (!rows || rows.length < 2) return '';
    return `<h4 class="tmsec">${esc(name)} <span class="pc">${rows.length - 1}</span></h4>
      <div class="tmscroll"><table class="tmtable">
      <tr>${rows[0].map(h => `<th>${esc(String(h || ''))}</th>`).join('')}</tr>
      ${rows.slice(1).map(r => `<tr>${rows[0].map((_, i) => `<td>${esc(String(r[i] || ''))}</td>`).join('')}</tr>`).join('')}
      </table></div>`;
  };
  return table('Current Team', TEAM.roster['Current Team'])
    + table('Subcontractors / INS', TEAM.roster['Subcontractors/INS'])
    + table('Former BLP', TEAM.roster['Former BLP'])
    + `<p class="pd">Edit in the <a href="https://blpshop.netlify.app/manager.html#roster" target="_blank" rel="noopener">Shop Manager roster ↗</a>.</p>`;
}
function renderTeam() {
  const el = $('#teamBody');
  if (!el) return;
  if (!isTeamAdmin()) { el.innerHTML = '<div class="empty">Admin, managers &amp; owners only.</div>'; return; }
  // 🔄 managers/owners refresh the live board data on demand (Brigham 8/28)
  const tt = $('#teamTabs');
  if (tt && !tt.querySelector('.teamrefresh')) {
    const rb = document.createElement('button');
    rb.className = 'teamrefresh';
    rb.textContent = '🔄 Refresh';
    rb.onclick = async () => {
      rb.disabled = true; rb.textContent = '🔄 Refreshing…';
      TEAM.roster = TEAM.sched = TEAM.clock = TEAM.pay = TEAM.where = null;
      TEAM.loading = false;
      await teamFetchAll();
      rb.disabled = false; rb.textContent = '🔄 Refresh';
    };
    tt.appendChild(rb);
  }
  document.querySelectorAll('#teamTabs button[data-tt]').forEach(b => {
    b.classList.toggle('on', b.dataset.tt === TEAM.tab);
    if (!b.dataset.wired) { b.dataset.wired = '1'; b.onclick = () => { TEAM.tab = b.dataset.tt; renderTeam(); }; }
  });
  if (TEAM.tab === 'shopteam') { el.innerHTML = shopFrameHTML('team'); return; }
  if (!TEAM.roster) {
    if (!TEAM.loading) teamFetchAll();
    // paint the cached roster/schedule instantly while the live data loads
    try {
      const c = JSON.parse(lsGet('blpTeam1') || 'null');
      if (c && c.roster) {
        TEAM.roster = c.roster; TEAM.sched = TEAM.sched || c.sched;
        TEAM.clock = TEAM.clock || {open: [], todayMinutes: {}};
        TEAM.pay = TEAM.pay || {open: [], today: []};
        TEAM.where = TEAM.where || {};
      }
    } catch (e) {}
    if (!TEAM.roster) { el.innerHTML = '<div class="empty">Loading the team…</div>'; return; }
  }
  el.innerHTML = TEAM.tab === 'board' ? teamBoardHTML()
    : TEAM.tab === 'schedule' ? teamScheduleHTML() : teamRosterHTML();
}

/* ---------- 🗒 BLP Kanban task boards (Brigham 8/28, design B) ----------
 * Everyone has a personal board (To Do / Doing / Done). Owners get the face
 * strip and can open any team member's board. Cards can carry a piano
 * serial (tap → its map card), a due date, and a "from" chip when someone
 * else added it to your board. Rows live on the report sheet's Task Boards
 * tab via the bridge. */
const TB = {rows: null, loading: false, person: '', faces: null, cols: {}};
const TB_COLS = [['todo', 'TO DO'], ['doing', 'DOING'], ['done', 'DONE']];
// off the strip (Brigham 8/28: Brigham Jr won't be working here anymore)
const TB_EXCLUDE = ['brigham jr larson', 'brig jr. larson',
  'abby larson', 'brielle larson', 'ben larson', 'susie martinez', 'susie marinez',
  'louis larson', 'loius larson'];
// on the strip even though not on the roster's Current Team tab
const TB_SEED = ['Lisa Litton'];
// black & white headshots from the website's team page (Shopify CDN)
const TB_HEADSHOTS = {
  "brigham larson": "https://www.brighamlarsonpianos.com/cdn/shop/files/Brigham.Larson.BW.jpg?v=1709675863&width=240",
  "karmel larson": "https://www.brighamlarsonpianos.com/cdn/shop/files/Copy_of_999A8339-Edit_e9215d62-9f45-4050-9554-f4e2f78cdfcb.jpg?v=1735944534&width=240",
  "mckinly lopp": "https://www.brighamlarsonpianos.com/cdn/shop/files/McKinly.Lopp.BW_129ac078-af8a-43c7-8f6b-289dcd5a3c8c.jpg?v=1725655625&width=240",
  "curtis biggs": "https://www.brighamlarsonpianos.com/cdn/shop/files/Curtis.Biggs.BW_1.jpg?v=1735942281&width=240",
  "matthew wessman": "https://www.brighamlarsonpianos.com/cdn/shop/files/IMG_0550_1_8ffe567c-f80c-4f25-bd13-6612fcae0870.jpg?v=1735942280&width=240",
  "jake pulver": "https://www.brighamlarsonpianos.com/cdn/shop/files/5U4A1089_2.jpg?v=1775244857&width=240",
  "korban greenhalgh": "https://www.brighamlarsonpianos.com/cdn/shop/files/Korban.Greenhalgh.BW_5229d778-dd21-4a40-826d-6abd075d2503.jpg?v=1735947374&width=240",
  "marcelo cornejo": "https://www.brighamlarsonpianos.com/cdn/shop/files/MARCE-BW_2.jpg?v=1735947379&width=240",
  "doris arancibia": "https://www.brighamlarsonpianos.com/cdn/shop/files/DORIS-BW_2.jpg?v=1735946727&width=240",
  "guadalupe chavoya": "https://www.brighamlarsonpianos.com/cdn/shop/files/O2A0765-2.jpg?v=1735948643&width=240",
  "carlos bombela perez": "https://www.brighamlarsonpianos.com/cdn/shop/files/O2A0789-2.jpg?v=1735948900&width=240",
  "thayne larson": "https://www.brighamlarsonpianos.com/cdn/shop/files/Thayne.Larson.BW_d6685ac0-6746-4c41-98b5-57b3e19bcfbb.jpg?v=1735947791&width=240",
  "melissa terry": "https://www.brighamlarsonpianos.com/cdn/shop/files/5U4A1257.jpg?v=1775246484&width=240",
  "ezzy lopp": "https://www.brighamlarsonpianos.com/cdn/shop/files/Ezaray.Lopp.BW_cc6b4562-389e-4c78-b1fe-3dcd2590bd86.jpg?v=1777569159&width=240",
  "alisa merrill": "https://www.brighamlarsonpianos.com/cdn/shop/files/Alisa.Merrill.BW_1.jpg?v=1735949942&width=240",
  "lisa litton": "assets/headshots/lisa-litton.jpg?v=2"
  };
const tbNorm = n => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
// full access to every board: the face strip + open/edit/add on anyone's
// board — owners (Brigham, Karmel) plus Melissa (Brigham 8/28)
const TB_ADMIN_EMAILS = OWNER_EMAILS.concat(['melissa@brighamlarsonpianos.com']);
function tbAdmin() { return TB_ADMIN_EMAILS.includes(userEmail()); }
const TB_AV_COLORS = ['#9e2020', '#2c5d96', '#2f7d4f', '#8a6d3b', '#6a3aa0', '#a05a2c', '#3a7a8a', '#b4536b'];
function tbAvColor(name) {
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 997;
  return TB_AV_COLORS[h % TB_AV_COLORS.length];
}
function tbMe() { const u = authUser(); return (u && u.name) || ''; }
function tbPeople() {
  const me = tbMe();
  const owners = [...new Set((TB.rows || []).map(r => r.owner).filter(Boolean))];
  const set = new Map();
  [me, ...TB_SEED, ...(TB.faces || []), ...owners].forEach(n => {
    const k = tbNorm(n);
    if (!k || TB_EXCLUDE.includes(k)) return;
    if (!set.has(k)) set.set(k, n);
  });
  return [...set.values()].sort((a, b) => a.localeCompare(b));
}
/* speed step 5: the board lives in Supabase (sub-200ms reads, instant
 * writes via the taskboard-write proxy which mirrors to the sheet+bridge
 * so notifications and reports keep working). Read order: Supabase →
 * fast Netlify sheet read (step 4) → Apps Script bridge. */
const SB_URL = 'https://ismacawxfvvllfinibbf.supabase.co';
const SB_KEY = 'sb_publishable_MamcjSX0CHTdYlpKDWSkmQ_-nbuQ1z-';   // publishable: safe in browser, read-only via RLS
async function tbFetchSupabase() {
  const h = {apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY};
  const [cr, kr] = await Promise.all([
    fetch(SB_URL + '/rest/v1/tb_cards?select=*', {headers: h}),
    fetch(SB_URL + '/rest/v1/tb_cols?select=*', {headers: h}),
  ]);
  if (!cr.ok || !kr.ok) throw new Error('supabase read failed');
  const cards = await cr.json();
  if (!cards.length) throw new Error('supabase empty (not migrated yet)');
  const cols = {};
  (await kr.json()).forEach(r => { cols[String(r.owner).toLowerCase()] = r.cols || []; });
  return {rows: cards.map(c => ({
    id: c.id, owner: c.owner || '', col: c.col || 'todo', text: c.text || '',
    serial: c.serial || '', due: c.due || '', from: c.from_who || '',
    created: c.created || '', done: c.done_at || '',
    order: c.ord == null ? null : Number(c.ord),
    notes: c.notes || '', snooze: c.snooze || '',
  })), cols};
}
/* live board updates: Supabase realtime over a plain websocket (no lib).
   Any insert/update on tb_cards from another device re-fetches (~150ms)
   and re-renders — unless the user is mid-drag or has a modal open. If
   the socket is down, a 45s poll covers it while the board is visible. */
const tbRT = {ws: null, timer: null, ref: 0, backoff: 2000};
function tbVisible() {
  const el = document.getElementById('tboardBody');
  return !!(el && el.offsetParent !== null);
}
function tbUiBusy() {
  return document.body.classList.contains('kdragging')
    || [...document.querySelectorAll('.blpmodal')].some(m => !m.hidden);
}
let tbRefreshT = null;
function tbLiveRefresh() {
  clearTimeout(tbRefreshT);
  tbRefreshT = setTimeout(async () => {
    if (tbUiBusy()) { tbLiveRefresh(); return; }
    await tbFetch();
    if (tbVisible()) renderTaskBoard();
  }, 400);
}
function tbRealtime() {
  if (tbRT.ws || !('WebSocket' in window)) return;
  try {
    const ws = new WebSocket(SB_URL.replace('https', 'wss')
      + '/realtime/v1/websocket?apikey=' + SB_KEY + '&vsn=1.0.0');
    tbRT.ws = ws;
    ws.onopen = () => {
      tbRT.backoff = 2000;
      ws.send(JSON.stringify({topic: 'realtime:tbcards', event: 'phx_join', ref: String(++tbRT.ref),
        payload: {config: {postgres_changes: [{event: '*', schema: 'public', table: 'tb_cards'},
                                              {event: '*', schema: 'public', table: 'tb_cols'}]}}}));
      clearInterval(tbRT.timer);
      tbRT.timer = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({topic: 'phoenix', event: 'heartbeat', ref: String(++tbRT.ref), payload: {}}));
      }, 25000);
    };
    ws.onmessage = ev => {
      try {
        const m = JSON.parse(ev.data);
        if (m.event === 'postgres_changes') tbLiveRefresh();
      } catch (e) { /* ignore */ }
    };
    ws.onclose = ws.onerror = () => {
      clearInterval(tbRT.timer);
      if (tbRT.ws === ws) tbRT.ws = null;
      setTimeout(tbRealtime, tbRT.backoff = Math.min(tbRT.backoff * 2, 60000));
    };
  } catch (e) { tbRT.ws = null; }
}
// poll fallback: only when the socket is down and the board is on screen
setInterval(() => {
  if (!tbRT.ws && tbVisible() && !document.hidden && !tbUiBusy()) tbLiveRefresh();
}, 45000);

async function tbFetch() {
  TB.loading = true;
  try {
    let j = null;
    try { j = await tbFetchSupabase(); } catch (e0) { j = null; }
    if (!j) {
      try {
        const rf = await fetch('https://blpsalesapp.netlify.app/.netlify/functions/storemap-taskboard?key='
          + encodeURIComponent('pianoman'));
        if (rf.ok) j = await rf.json();
        if (j && j.error) j = null;
      } catch (e2) { j = null; }
    }
    if (!j) {
      const r = await fetch(BRIDGE_URL + '?fn=taskboard', {redirect: 'follow'});
      j = await r.json();
    }
    TB.rows = j.rows || [];
    TB.cols = j.cols || {};
  } catch (e) { TB.rows = TB.rows || []; }
  // owners' face strip: current team + anyone who already has cards
  if (tbAdmin() && !TB.faces) {
    try {
      const r2 = await fetch(TEAM_ROSTER_API + '?key=' + encodeURIComponent('pianoman'));
      const j2 = await r2.json();
      TB.faces = ((j2.tabs && j2.tabs['Current Team']) || []).slice(1)
        .map(row => (String(row[0] || '').trim() + ' ' + String(row[1] || '').trim()).trim())
        .filter(Boolean);
    } catch (e) { TB.faces = []; }
  }
  TB.loading = false;
  // cache-first: next open paints instantly from the last-known board
  try { lsSet('blpTB1', JSON.stringify({rows: TB.rows, cols: TB.cols, faces: TB.faces, at: Date.now()})); } catch (e) {}
  renderTaskBoard();
}
async function tbSend(body) {
  const wa = writeAuth();
  if (!wa.ok) { alert('Sign in with Google (☰ menu) first — cards are saved under your name.'); return null; }
  // fast write (step 5): Supabase-first proxy — instant save, and it
  // forwards the same op to the bridge in the background (sheet mirror,
  // notifications, activity log). 503 = not configured yet → bridge.
  try {
    const pr = await fetch('https://blpsalesapp.netlify.app/.netlify/functions/taskboard-write', {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({pin: wa.pin, key: wa.pin, ...body, ...authFields()})});
    if (pr.ok) {
      const pj = await pr.json();
      if (pj && pj.ok) return pj;
    }
  } catch (e0) { /* fall through to the bridge */ }
  // the Apps Script bridge occasionally answers with an HTML error page
  // (over-capacity blip) — retry a couple of times before bothering anyone
  let lastErr = '';
  for (let a = 0; a < 3; a++) {
    try {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'taskcard', ...body, ...authFields()})});
      const txt = await r.text();
      let j;
      try { j = JSON.parse(txt); }
      catch (e2) { lastErr = 'the Google bridge hiccuped'; await new Promise(res => setTimeout(res, 1200 * (a + 1))); continue; }
      if (!j.ok) { lastErr = j.error || 'failed'; break; }   // real rejection — don't retry
      return j;
    } catch (e) { lastErr = e.message; await new Promise(res => setTimeout(res, 1200 * (a + 1))); }
  }
  alert('✗ ' + lastErr + ' — give it a second and try again.');
  return null;
}
function tbDueChip(due, col) {
  if (!due) return '';
  const d = new Date(due + 'T12:00:00');
  if (isNaN(d)) return `<span class="chip c-dueok">${esc(due)}</span>`;
  const days = Math.floor((d - new Date()) / 86400000);
  const lbl = d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
  if (col === 'done') return `<span class="chip c-dueok">${esc(lbl)}</span>`;
  return `<span class="chip ${days <= 1 ? 'c-due' : 'c-dueok'}">due ${esc(lbl)}</span>`;
}
function renderTaskBoard() {
  const el = $('#tboardBody');
  if (!el) return;
  tbRealtime();   // live cross-device updates while the board is in use
  const me = tbMe();
  if (!me) { el.innerHTML = '<div class="empty">Sign in with Google (☰ menu) to see your board.</div>'; return; }
  if (!TB.person) TB.person = me;
  if (TB.rows === null) {
    if (!TB.loading) tbFetch();
    // show the last-known board instantly while the fresh one loads
    try {
      const c = JSON.parse(lsGet('blpTB1') || 'null');
      if (c && c.rows) { TB.rows = c.rows; TB.cols = c.cols || {}; if (!TB.faces) TB.faces = c.faces || null; }
    } catch (e) {}
    if (TB.rows === null) { el.innerHTML = '<div class="empty">Loading your board…</div>'; return; }
  }
  // the face strip needs the roster — if sign-in resolved AFTER the first
  // board fetch (or the roster call failed), pick it up now and repaint
  // instead of silently showing a stripped-down strip (Brigham 8/29)
  if (tbAdmin() && TB.faces == null && !TB.facesLoading) {
    TB.facesLoading = true;
    fetch(TEAM_ROSTER_API + '?key=' + encodeURIComponent('pianoman'))
      .then(r => r.json())
      .then(j2 => {
        TB.faces = ((j2.tabs && j2.tabs['Current Team']) || []).slice(1)
          .map(row => (String(row[0] || '').trim() + ' ' + String(row[1] || '').trim()).trim())
          .filter(Boolean);
      })
      .catch(() => { TB.faces = null; })   // stays null → retried on next render
      .then(() => { TB.facesLoading = false; if (TB.faces) renderTaskBoard(); });
  }
  // full-name matching (two Brighams taught us first-name matching lies)
  const sameOwner = (a, b) => tbNorm(a) === tbNorm(b);
  const people = tbAdmin() ? tbPeople() : [me];
  const strip = tbAdmin() ? `<div class="faces">${people.map(n => {
      const cnt = TB.rows.filter(r => sameOwner(r.owner, n) && r.col !== 'done' && r.col !== 'archived').length;
      const on = sameOwner(n, TB.person);
      const initials = n.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
      const hs = TB_HEADSHOTS[tbNorm(n)];
      return `<div class="face ${on ? 'on' : ''}" data-p="${esc(n)}">
        <span class="n"><span class="av" style="background:${tbAvColor(n)}">${hs
          ? `<img src="${esc(hs)}" alt="" loading="lazy">` : esc(initials)}</span>
        ${cnt ? `<i class="cnt">${cnt}</i>` : ''}</span>
        <small>${esc(n.split(/\s+/)[0])}</small></div>`;
    }).join('')}</div>` : '';
  const today = localDay();
  const isSnoozed = r => r.snooze && r.snooze > today && r.col !== 'done';
  const allMine = TB.rows.filter(r => sameOwner(r.owner, TB.person) && r.col !== 'archived');
  const snoozedN = allMine.filter(isSnoozed).length;
  // "unresponded" (Brigham 8/29): the newest note is someone else's — or the
  // card came from someone else and has no notes yet. Notes lines look like
  // "M/D First: text", newest first.
  const ownerFirst = tbNorm(TB.person).split(' ')[0];
  const noteAuthor = r => {
    const m = /^\d{1,2}\/\d{1,2}\s+(\S+):/.exec(String(r.notes || '').split('\n')[0] || '');
    return m ? m[1].toLowerCase() : '';
  };
  const isUnresp = r => r.col !== 'done' && !isSnoozed(r)
    && ((noteAuthor(r) && noteAuthor(r) !== ownerFirst)
        || (!String(r.notes || '').trim() && r.from && tbNorm(r.from).split(' ')[0] !== ownerFirst));
  const unrespN = allMine.filter(isUnresp).length;
  let mine = allMine.filter(r => TB.showSnoozed || !isSnoozed(r));
  if (TB.unresp) mine = mine.filter(isUnresp);
  const tq = String(TB.q || '').trim().toLowerCase();
  if (tq) mine = mine.filter(r =>
    (r.text + ' ' + r.serial + ' ' + (r.notes || '') + ' ' + (r.from || '')).toLowerCase().includes(tq));
  const canEdit = sameOwner(TB.person, me) || tbAdmin();
  const boardCols = (TB.cols[tbNorm(TB.person)] || TB_COLS.map(([k, l]) => [k, l]))
    .map(c => Array.isArray(c) ? c : [c.key, c.label]);
  const colKeys = boardCols.map(c => c[0]);
  const homeCol = r => colKeys.includes(r.col) ? r.col : (r.col === 'archived' ? 'archived' : colKeys[0]);
  const ordVal = r => (r.order === null || r.order === undefined || r.order === '')
    ? 1e9 - Date.parse(r.created || 0) / 1e6 : Number(r.order);
  const col = (key, label) => {
    const cards = mine.filter(r => homeCol(r) === key)
      .sort((a, b) => ordVal(a) - ordVal(b));
    return `<div class="kcol ${key === 'done' ? 'kdone' : ''}" data-col="${key}">
      <h4><span>${esc(label)}${canEdit ? ` <button class="kcolren" data-k="${esc(key)}" title="rename column">✎</button>` : ''}</span> <i>${cards.length}</i></h4>
      ${cards.map(c => `<div class="kcard" draggable="${canEdit}" data-id="${esc(c.id)}">
        <b>${esc(c.text)}</b>
        <div class="chips">
          ${c.serial ? `<span class="chip c-piano" data-serial="${esc(c.serial)}">🎹 ${esc(c.serial)}</span>` : ''}
          ${tbDueChip(c.due, c.col)}
          ${c.from ? `<span class="chip c-from">from ${esc(c.from.split(/\s+/)[0])}</span>` : ''}
          ${isSnoozed(c) ? `<span class="chip c-snooze">💤 until ${esc(c.snooze.slice(5))}</span>` : ''}
          ${(c.notes || '').trim() ? `<span class="chip c-notes">🗒 ${String(c.notes).split('\n').filter(Boolean).length}</span>` : ''}
          ${tbAgeChip(c)}
        </div>
        ${canEdit ? `<div class="kmove"><span class="kgrab">⠿ drag</span>
          <button class="kreassign" data-id="${esc(c.id)}" title="hand this card to someone else's board">↪ Reassign</button>
          <button class="karch" data-id="${esc(c.id)}" title="archive — done and off the board (never deleted)">✔ Done</button>
        </div>` : ''}
      </div>`).join('') || '<div class="kempty">—</div>'}
    </div>`;
  };
  const bhs = TB_HEADSHOTS[tbNorm(TB.person)];
  const binit = TB.person.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  el.innerHTML = `${strip}
    <div class="khead"><span class="khav" style="background:${tbAvColor(TB.person)}">${bhs
        ? `<img src="${esc(bhs)}" alt="">` : esc(binit)}</span>
      <b>${esc(TB.person.split(/\s+/)[0])}'s Board</b>
      <span>${allMine.filter(r => r.col !== 'done' && !isSnoozed(r)).length} open · ${snoozedN} snoozed · ${allMine.length} total</span>
      ${snoozedN ? `<button class="ksnoozetog">💤 ${snoozedN} snoozed${TB.showSnoozed ? ' — hide' : ''}</button>` : ''}
      ${unrespN ? `<button class="kunresp${TB.unresp ? ' on' : ''}" title="cards waiting on your reply — the newest note is someone else's">✉ ${unrespN} unresponded${TB.unresp ? ' — show all' : ''}</button>` : ''}
      <input class="ksearch" type="search" placeholder="🔎 search cards" value="${esc(TB.q || '')}">
      ${canEdit ? '<button class="kadd">＋ Card</button><button class="kaddcol" title="add a column">＋ Column</button>' : ''}
      <button class="karchbtn" title="archived cards — search & restore">🗂</button></div>
    <div class="kan">${boardCols.map(([k, l]) => col(k, l)).join('')}</div>`;
  // wiring
  el.querySelectorAll('.face').forEach(f => f.onclick = () => { TB.person = f.dataset.p; renderTaskBoard(); });
  const ka = el.querySelector('.kadd');
  if (ka) ka.onclick = () => {
    serialDatalist();
    const first = TB.person.split(/\s+/)[0];
    const ov2 = modalShell('composemodal', `
      <span class="x">✕</span>
      <h3>＋ New card — ${esc(first)}'s board</h3>
      <input class="kc-text" maxlength="2000" placeholder="what needs doing?">
      <div class="cm-grid">
        <div><label>Column</label><select class="kc-col">
          ${boardCols.map(([k2, l2], i2) => `<option value="${esc(k2)}" ${i2 === 0 ? 'selected' : ''}>${esc(l2)}</option>`).join('')}
        </select></div>
        <div><label>Due (optional)</label><input class="kc-due" type="date"></div>
        <div><label>Piano serial (optional)</label><input class="kc-serial" maxlength="20" list="serialList"></div>
      </div>
      <div class="rfbar" style="margin-top:8px">
        <label class="csvbtn" style="cursor:pointer">📸 Photo / screenshot
          <input type="file" accept="image/*" class="kc-file" hidden></label>
        <label class="csvbtn" style="cursor:pointer">🎬 Video
          <input type="file" accept="video/*" class="kc-vfile" hidden></label>
        <span class="kc-pmsg phmsg">optional</span></div>
      <button class="ccfmyes kc-go" style="width:100%;margin-top:12px">Add card</button>`);
    const txtIn = ov2.querySelector('.kc-text');
    attachSerialSuggest(ov2.querySelector('.kc-serial'));
    let photoFile = null, videoFile = null;
    const pmsg = () => {
      const parts = [];
      if (photoFile) parts.push('📸 ' + (photoFile.name || 'photo'));
      if (videoFile) parts.push('🎬 ' + (videoFile.name || 'video'));
      ov2.querySelector('.kc-pmsg').textContent = parts.length ? '✓ ' + parts.join(' + ') : 'optional';
    };
    ov2.querySelector('.kc-file').onchange = ev2 => { photoFile = ev2.target.files && ev2.target.files[0]; pmsg(); };
    ov2.querySelector('.kc-vfile').onchange = ev2 => {
      const f2 = ev2.target.files && ev2.target.files[0];
      if (f2 && f2.size > 30 * 1024 * 1024) {
        ov2.querySelector('.kc-pmsg').textContent = '✗ video too big (' + Math.round(f2.size / 1048576) + 'MB) — keep it under 30MB (~30s)';
        return;
      }
      videoFile = f2; pmsg();
    };
    const go = async () => {
      const text = txtIn.value.trim();
      if (!text) { txtIn.focus(); return; }
      const gb = ov2.querySelector('.kc-go');
      gb.disabled = true; gb.textContent = 'Adding…';
      const minOrd = Math.min(0, ...mine.map(ordVal).filter(isFinite));
      const col2 = ov2.querySelector('.kc-col').value;
      const j = await tbSend({op: 'add', owner: TB.person, text,
        serial: ov2.querySelector('.kc-serial').value.trim(),
        due: ov2.querySelector('.kc-due').value, order: minOrd - 1});
      if (!j) { gb.disabled = false; gb.textContent = 'Add card'; return; }
      // cards are born in the first column — move if another was picked
      if (j.id && col2 && col2 !== boardCols[0][0]) {
        await tbSend({op: 'move', id: j.id, col: col2, order: minOrd - 1});
      }
      // photo chosen at creation: blob-store it, note the link on the card
      if (j.id && photoFile) {
        gb.textContent = 'Uploading photo…';
        try {
          const dataUrl = await downscalePhoto(photoFile, 1600, 0.82);
          const r2 = await fetch('https://blpsalesapp.netlify.app/.netlify/functions/request-shot', {
            method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({key: 'pianoman', id: 'card-' + j.id,
              photo: dataUrl.split(',')[1], photoType: 'image/jpeg',
              photoName: 'card-photo.jpg'})});
          const j2 = await r2.json();
          if (j2.url) await tbSend({op: 'note', id: j.id, text: '📷 ' + j2.url});
        } catch (e2) { /* the card is in — photo is best-effort */ }
      }
      // video chosen at creation → Drive via the bridge, link noted (8/28)
      if (j.id && videoFile) {
        gb.textContent = 'Uploading video… (' + Math.round(videoFile.size / 1048576) + 'MB)';
        try {
          const wa2 = writeAuth();
          const b64 = await new Promise((res, rej) => {
            const rd = new FileReader();
            rd.onload = () => res(String(rd.result).split(',')[1]);
            rd.onerror = () => rej(new Error('read failed'));
            rd.readAsDataURL(videoFile);
          });
          const r3 = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
            headers: {'content-type': 'text/plain;charset=utf-8'},
            body: JSON.stringify({pin: wa2.pin, action: 'cardmedia', cardId: j.id,
              mime: videoFile.type || 'video/mp4', data: b64, ...authFields()})});
          const j3 = await r3.json();
          if (j3.url) await tbSend({op: 'note', id: j.id, text: '🎬 ' + j3.url});
        } catch (e3) { /* best-effort */ }
      }
      ov2.hidden = true; TB.rows = null; renderTaskBoard();
    };
    ov2.querySelector('.kc-go').onclick = go;
    txtIn.onkeydown = ev2 => { if (ev2.key === 'Enter') go(); };
    txtIn.focus();
  };

  el.querySelectorAll('.kreassign').forEach(b => b.onclick = () => {
    const c = TB.rows.find(r => r.id === b.dataset.id);
    if (c) openReassignModal(c);
  });
  // optimistic (Brigham 8/28: "a lot of waiting") — the card leaves the
  // board instantly; the bridge write happens behind it and rolls back on failure
  el.querySelectorAll('.karch').forEach(b => b.onclick = async () => {
    const c = TB.rows.find(r => r.id === b.dataset.id);
    if (!c) return;
    const was = c.col;
    c.col = 'archived';
    renderTaskBoard();
    const j = await tbSend({op: 'archive', id: c.id});
    if (!j) { c.col = was; renderTaskBoard(); }
  });
  const saveCols = async cols => {
    const j = await tbSend({op: 'setcols', owner: TB.person, cols});
    if (j) { TB.cols[tbNorm(TB.person)] = cols; renderTaskBoard(); }
  };
  // prompt() is suppressed in the installed-app context — use a real modal
  const colNameModal = (title, initial, onGo) => {
    const ov = modalShell('colnamemodal', `
      <span class="x">✕</span>
      <h3>${title}</h3>
      <input class="cnm-in" maxlength="24" placeholder="column name" value="${esc(initial || '')}">
      <button class="ccfmyes cnm-go" style="width:100%;margin-top:10px">Save</button>`);
    const inp = ov.querySelector('.cnm-in');
    const go = () => { const v = inp.value.trim(); if (!v) return; ov.hidden = true; onGo(v.slice(0, 24)); };
    ov.querySelector('.cnm-go').onclick = go;
    inp.onkeydown = ev2 => { if (ev2.key === 'Enter') go(); };
    inp.focus(); inp.select();
  };
  const kac = el.querySelector('.kaddcol');
  if (kac) kac.onclick = () => {
    if (boardCols.length >= 20) { alert('Twenty columns is plenty — archive or merge first.'); return; }
    colNameModal('＋ New column', '', label =>
      saveCols([...boardCols, ['c' + Date.now().toString(36), label]]));
  };
  el.querySelectorAll('.kcolren').forEach(b => b.onclick = ev2 => {
    ev2.stopPropagation();
    const cur = boardCols.find(c => c[0] === b.dataset.k);
    colNameModal('✎ Rename column', cur ? cur[1] : '', label =>
      saveCols(boardCols.map(c => c[0] === b.dataset.k ? [c[0], label] : c)));
  });
  const stog = el.querySelector('.ksnoozetog');
  if (stog) stog.onclick = () => { TB.showSnoozed = !TB.showSnoozed; renderTaskBoard(); };
  const ku = el.querySelector('.kunresp');
  if (ku) ku.onclick = () => { TB.unresp = !TB.unresp; renderTaskBoard(); };
  const ks = el.querySelector('.ksearch');
  if (ks) ks.oninput = () => {
    clearTimeout(ks._t);
    ks._t = setTimeout(() => {
      TB.q = ks.value;
      renderTaskBoard();
      const again = el.querySelector('.ksearch');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }, 300);
  };
  // 🗂 archive: search everything ever done on this board, restore if needed
  el.querySelector('.karchbtn').onclick = () => {
    const arch = TB.rows.filter(r => sameOwner(r.owner, TB.person) && r.col === 'archived')
      .sort((a2, b2) => String(b2.done || '').localeCompare(String(a2.done || '')));
    const ov2 = modalShell('archmodal', `
      <span class="x">✕</span>
      <h3>🗂 ${esc(TB.person.split(/\s+/)[0])}'s archive
        <small class="cm-added">${arch.length} card${arch.length === 1 ? '' : 's'} — never deleted</small></h3>
      <input class="arch-q" placeholder="search archived cards — text, serial, notes…">
      <div class="arch-list"></div>`);
    const list = ov2.querySelector('.arch-list'), qIn = ov2.querySelector('.arch-q');
    const paint = () => {
      const q = qIn.value.trim().toLowerCase();
      const hits = arch.filter(r => !q
        || (r.text + ' ' + r.serial + ' ' + (r.notes || '') + ' ' + (r.from || '')).toLowerCase().includes(q));
      list.innerHTML = hits.slice(0, 80).map(r => `<div class="archrow" data-id="${esc(r.id)}">
          <div><b>${esc(r.text.slice(0, 110))}</b>
            <small>${r.serial ? '🎹 ' + esc(r.serial) + ' · ' : ''}archived ${r.done ? esc(String(r.done).slice(0, 10)) : '—'}</small></div>
          ${canEdit ? `<button class="arch-restore" data-id="${esc(r.id)}">↩ Restore</button>` : ''}
        </div>`).join('')
        + (hits.length > 80 ? `<div class="pwnone" style="display:block;padding:6px 0">…${hits.length - 80} more — narrow the search</div>` : '')
        || '<div class="pwnone" style="display:block;padding:8px 0">No archived cards match.</div>';
      list.querySelectorAll('.archrow').forEach(el2 => el2.onclick = ev2 => {
        if (ev2.target.closest('button')) return;
        const c = TB.rows.find(r => r.id === el2.dataset.id);
        if (c) { ov2.hidden = true; openCardModal(c, canEdit); }
      });
      list.querySelectorAll('.arch-restore').forEach(b => b.onclick = ev2 => {
        ev2.stopPropagation();
        const c = TB.rows.find(r => r.id === b.dataset.id);
        if (!c) return;
        const home = (boardCols[0] || ['todo'])[0];
        c.col = home; c.order = -(Date.now() / 1e6);   // instant
        ov2.hidden = true; renderTaskBoard();
        tbSend({op: 'move', id: c.id, col: home, order: c.order}).then(j => {
          if (!j) { c.col = 'archived'; renderTaskBoard(); }
        });
      });
    };
    qIn.oninput = paint;
    paint();
    qIn.focus();
  };
  el.querySelectorAll('.kcard').forEach(card => card.addEventListener('click', ev => {
    if (ev.target.closest('button, .chip, .kgrab')) return;
    if (TB.dragJustHappened) return;
    const c = TB.rows.find(r => r.id === card.dataset.id);
    if (c) openCardModal(c, canEdit);
  }));
  el.querySelectorAll('.chip.c-piano').forEach(ch => ch.onclick = () => {
    const p = S.data.pianos.find(x => (x.serial || '') === ch.dataset.serial);
    if (p) { switchView('map'); focusPiano(p); openPop(p.row, S.popAnchor, true); }
  });
  // pointer-based drag & drop (mouse AND touch): drag cards between
  // columns and up/down within a column to prioritize (Brigham 8/28).
  // On touch the card body needs a 350ms LONG-PRESS before it lifts —
  // a moving thumb scrolls the column instead of grabbing the card
  // (Brigham 8/28); the ⠿ handle still drags instantly.
  if (canEdit) el.querySelectorAll('.kcard').forEach(card => {
    card.addEventListener('pointerdown', ev => {
      if (ev.target.closest('button, .chip')) return;
      const id = card.dataset.id;
      const startX = ev.clientX, startY = ev.clientY;
      const isTouch = ev.pointerType !== 'mouse';
      const onHandle = !!ev.target.closest('.kgrab');
      let dragging = false, ghost = null, ph = null, holdT = null;
      let armed = !isTouch || onHandle;   // touch on the card body must hold first
      const lift = (x, y) => {
        dragging = true;
        document.body.classList.add('kdragging');
        ghost = card.cloneNode(true);
        ghost.className = 'kcard kghost';
        ghost.style.width = card.offsetWidth + 'px';
        document.body.appendChild(ghost);
        ghost.style.left = (x - ghost.offsetWidth / 2) + 'px';
        ghost.style.top = (y - 18) + 'px';
        ph = document.createElement('div');
        ph.className = 'kplace';
        card.style.opacity = '.35';
        if (navigator.vibrate) try { navigator.vibrate(15); } catch (e2) {}
      };
      // once lifted, keep the finger from scrolling the page mid-drag
      const blockScroll = e => { if (dragging) e.preventDefault(); };
      if (isTouch) addEventListener('touchmove', blockScroll, {passive: false});
      if (isTouch && !onHandle) holdT = setTimeout(() => { armed = true; lift(startX, startY); }, 350);
      // edge auto-scroll while dragging — on phones only one column fits on
      // screen, so dragging to the screen edge must scroll the board sideways
      // to reach the other columns (and columns scroll vertically) — 8/28
      let scrollRAF = null, lastPt = null;
      const autoScroll = () => {
        if (!dragging || !lastPt) { scrollRAF = null; return; }
        const kan = el.querySelector('.kan');
        if (kan) {
          const kr = kan.getBoundingClientRect();
          const EDGE = 56, SPD = 13;
          if (lastPt.x < kr.left + EDGE) kan.scrollLeft -= SPD;
          else if (lastPt.x > kr.right - EDGE) kan.scrollLeft += SPD;
          const colEl = document.elementsFromPoint(lastPt.x, lastPt.y)
            .find(n => n.classList && n.classList.contains('kcol'));
          if (colEl) {
            const rr = colEl.getBoundingClientRect();
            if (lastPt.y < rr.top + 70) colEl.scrollTop -= SPD;
            else if (lastPt.y > rr.bottom - EDGE) colEl.scrollTop += SPD;
          }
        }
        scrollRAF = requestAnimationFrame(autoScroll);
      };
      const move = e => {
        if (!dragging) {
          if (!armed) {
            // finger travelled before the hold finished — it's a scroll
            if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) {
              clearTimeout(holdT);
              removeEventListener('pointermove', move);
              removeEventListener('pointerup', up);
              removeEventListener('pointercancel', up);
              removeEventListener('touchmove', blockScroll);
            }
            return;
          }
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < 8) return;
          lift(e.clientX, e.clientY);
        }
        e.preventDefault();
        lastPt = {x: e.clientX, y: e.clientY};
        if (!scrollRAF) scrollRAF = requestAnimationFrame(autoScroll);
        ghost.style.left = (e.clientX - ghost.offsetWidth / 2) + 'px';
        ghost.style.top = (e.clientY - 18) + 'px';
        const colEl = document.elementsFromPoint(e.clientX, e.clientY)
          .find(n => n.classList && n.classList.contains('kcol'));
        el.querySelectorAll('.kcol').forEach(c2 => c2.classList.toggle('kover', c2 === colEl));
        if (!colEl) { if (ph.parentNode) ph.remove(); return; }
        const cards = [...colEl.querySelectorAll('.kcard')].filter(c2 => c2 !== card);
        let before = null;
        for (const c2 of cards) {
          const r2 = c2.getBoundingClientRect();
          if (e.clientY < r2.top + r2.height / 2) { before = c2; break; }
        }
        if (before) colEl.insertBefore(ph, before);
        else colEl.appendChild(ph);
      };
      const up = async e => {
        clearTimeout(holdT);
        if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        removeEventListener('touchmove', blockScroll);
        document.body.classList.remove('kdragging');
        el.querySelectorAll('.kcol').forEach(c2 => c2.classList.remove('kover'));
        if (!dragging) return;
        ghost.remove();
        card.style.opacity = '';
        const colEl = ph.parentNode ? ph.closest('.kcol') : null;
        if (!colEl) { ph.remove(); return; }
        // order = midpoint between the placeholder's neighbors
        const sibs = [...colEl.querySelectorAll('.kcard')].filter(c2 => c2 !== card);
        const idx = [...colEl.children].filter(n => n.classList.contains('kcard') || n === ph)
          .filter(n => n !== card).indexOf(ph);
        const oOf = n => { const r2 = TB.rows.find(x => x.id === n.dataset.id); return r2 ? ordVal(r2) : 0; };
        const prev = idx > 0 ? oOf(sibs[idx - 1]) : null;
        const next = idx < sibs.length ? oOf(sibs[idx]) : null;
        let order;
        if (prev === null && next === null) order = 0;
        else if (prev === null) order = next - 1;
        else if (next === null) order = prev + 1;
        else order = (prev + next) / 2;
        ph.remove();
        const newCol = colEl.dataset.col;
        const c = TB.rows.find(r => r.id === id);
        if (c) { c.col = newCol; c.order = order; }
        TB.dragJustHappened = true;
        setTimeout(() => { TB.dragJustHappened = false; }, 250);
        renderTaskBoard();
        tbSend({op: 'move', id, col: newCol, order});
      };
      addEventListener('pointermove', move, {passive: false});
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    });
  });
}


/* card detail popup: edit text/due/serial, notes with auto-links, photos
 * (stored via the salesapp2 request-shot blob store), snooze, delete */
function tbLinkify(t) {
  return esc(t).replace(/(https?:\/\/[^\s<]+)/g,
    u => `<a href="${u}" target="_blank" rel="noopener">${u.length > 46 ? u.slice(0, 44) + '…' : u}</a>`);
}
/* hand a card to another team member's board — the receiver sees a
 * "from <you>" chip and the trail lands in the card's notes */
function openReassignModal(c) {
  const people = tbPeople().filter(n => !sameName(n, c.owner));
  function sameName(a, b) { return tbNorm(a) === tbNorm(b); }
  const ov = modalShell('reassignmodal', `
    <span class="x">✕</span>
    <h3>↪ Reassign card</h3>
    <div class="admreqtext" style="margin:4px 0 10px"><b>${esc(c.text)}</b></div>
    <label>To whose board?</label>
    <select class="ra-who">${people.map(n =>
      `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>
    <label>Note <small>(optional — travels with the card)</small></label>
    <input class="ra-note" maxlength="200" placeholder="why it's theirs / what's needed…">
    <button class="ccfmyes ra-go" style="width:100%;margin-top:12px">↪ Move it to their board</button>
    <div class="ra-msg phmsg"></div>`);
  ov.querySelector('.ra-go').onclick = () => {
    const who = ov.querySelector('.ra-who').value;
    const note = ov.querySelector('.ra-note').value.trim();
    if (!who) return;
    const was = {owner: c.owner, col: c.col, from: c.from, notes: c.notes};
    c.owner = who; c.col = 'todo'; c.from = tbMe();   // instant
    ov.hidden = true;
    const cm = document.getElementById('cardmodal');
    if (cm) cm.hidden = true;
    renderTaskBoard();
    tbSend({op: 'reassign', id: c.id, owner: who, note}).then(j => {
      if (j) { c.notes = (j.line || '') + '\n' + (was.notes || ''); }
      else { Object.assign(c, was); renderTaskBoard(); }
    });
  };
}
/* 🕓 how old a card is — from its Created stamp; done/archived cards skip it */
function tbAgeChip(c) {
  const t = Date.parse(c.created || '');
  if (!t || c.col === 'done' || c.col === 'archived') return '';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 2) return '';
  const d = new Date(t);
  return `<span class="chip c-age" title="added ${d.toLocaleDateString()}">🕓 ${days}d old</span>`;
}
/* 💬 text a card's answer / next steps to teammates (Brigham 8/28) — the
 * same team-picker as sharing a report by text: tap names, then one sms:
 * link opens the user's Messages app with everything prefilled. */
function openCardTextModal(c) {
  const ov = modalShell('cardtextmodal', `
    <span class="x">✕</span>
    <h3>💬 Text about this card</h3>
    <div class="dssub" style="font-size:12px;margin:4px 0 8px">“${esc(c.text.slice(0, 90))}${c.text.length > 90 ? '…' : ''}”</div>
    <textarea class="ct-msg" rows="3" maxlength="500" placeholder="the answer / next steps…"></textarea>
    <div class="shteam" style="margin-top:10px"><b>💬 To</b>
      <div class="shlist"><i>loading the team list…</i></div></div>`);
  const list = ov.querySelector('.shlist');
  const msgIn = ov.querySelector('.ct-msg');
  const sel = new Set();
  const body = () => (msgIn.value.trim() ? msgIn.value.trim() + '\n' : '')
    + '🗒 ' + c.text.slice(0, 80) + (c.text.length > 80 ? '…' : '') + '\n'
    + APP_URL + '/#card=' + encodeURIComponent(c.id);
  const paint = () => {
    if (!phonesCache || !phonesCache.length) {
      list.innerHTML = '<i>no team phone numbers on file yet (Tech Phones tab)</i>';
      return;
    }
    const all = sel.size === phonesCache.length;
    const picked = [...sel].map(i => phonesCache[i]);
    list.innerHTML = `<button class="shper shall ${all ? 'on' : ''}">${all ? '✓ ' : ''}Everyone</button>`
      + phonesCache.map((t, i) =>
          `<button class="shper ${sel.has(i) ? 'on' : ''}" data-i="${i}">${sel.has(i) ? '✓ ' : ''}${esc(t.name)}</button>`).join('')
      + `<div class="shacts">${sel.size
          ? `<a class="shbtn shgo ct-go" href="#">💬 Text ${sel.size === 1 ? esc(picked[0].name.split(' ')[0]) : sel.size + ' people'}</a>`
          : '<i>tap who should get it — then one text goes to them all</i>'}</div>`;
    list.querySelectorAll('.shper').forEach(b => b.onclick = () => {
      if (b.classList.contains('shall')) {
        if (all) sel.clear();
        else phonesCache.forEach((t, i) => sel.add(i));
      } else {
        const i = +b.dataset.i;
        if (sel.has(i)) sel.delete(i); else sel.add(i);
      }
      paint();
    });
    const go = list.querySelector('.ct-go');
    if (go) go.onclick = ev2 => {
      ev2.preventDefault();   // build at tap time so the latest message rides along
      location.href = 'sms:' + picked.map(t => t.phone).join(',')
        + '?&body=' + encodeURIComponent(body());
    };
  };
  if (phonesCache) { paint(); msgIn.focus(); return; }
  const wa = writeAuth();
  if (!wa.ok) { list.innerHTML = '<i>sign in first to load the team list</i>'; return; }
  fetchPhones().then(ph => {
    if (ph) paint();
    else list.innerHTML = '<i>couldn’t load the team list — try again in a moment</i>';
  });
  msgIn.focus();
}
function openCardModal(c, canEdit) {
  const added = Date.parse(c.created || '');
  const ov = modalShell('cardmodal', `
    <span class="x">✕</span>
    <h3>🗒 Card${added ? ` <small class="cm-added">added ${new Date(added).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'})}</small>` : ''}</h3>
    <textarea class="cm-text" maxlength="2000" rows="2" ${canEdit ? '' : 'readonly'}>${esc(c.text)}</textarea>
    <div class="cm-grid">
      <div><label>Due</label><input type="date" class="cm-due" value="${esc(c.due || '')}" ${canEdit ? '' : 'disabled'}></div>
      <div><label>Piano serial</label><input class="cm-serial" maxlength="20" list="serialList" value="${esc(c.serial || '')}" ${canEdit ? '' : 'disabled'}></div>
    </div>
    ${canEdit ? `<div class="cm-snooze"><span>💤 Snooze</span>
      <button data-sz="1">+1d</button><button data-sz="3">+3d</button>
      <button data-sz="7">+1w</button><button data-sz="30">+1m</button>
      <button class="cm-szpick">📅 pick date</button><input type="date" class="cm-szdate" tabindex="-1">
      ${c.snooze ? `<button data-sz="0">✕ wake up (${esc(c.snooze)})</button>` : ''}</div>` : ''}
    <label style="margin-top:10px">Notes & links ${canEdit ? '<small>— paste links, they become clickable</small>' : ''}</label>
    ${canEdit ? `<div class="movebox"><input class="cm-note" maxlength="300" placeholder="add a note or paste a link…">
      <button class="mvgo cm-noteadd">Add</button>
      <button class="mvgo cm-photo" title="attach a photo">📸</button>
      <button class="mvgo cm-video" title="attach a video (up to ~30 seconds)">🎬</button>
      <input type="file" class="cm-file" accept="image/*" hidden>
      <input type="file" class="cm-vfile" accept="video/*" hidden></div>` : ''}
    <div class="cm-notes">${(c.notes || '').split('\n').filter(Boolean).map(L => {
      const m = /^(\d{1,2}\/\d{1,2})\s+([^:]{1,40}):\s*([\s\S]*)$/.exec(L.trim());
      return m ? `<div class="noterow"><b>${tbLinkify(m[3])}</b><small>${esc(m[2])} · ${esc(m[1])}</small></div>`
               : `<div class="noterow"><b>${tbLinkify(L)}</b></div>`;
    }).join('') || '<div class="pwnone" style="display:block;padding:4px 0">No notes yet.</div>'}</div>
    <div class="cm-msg phmsg"></div>
    ${canEdit ? `<div class="cm-actions">
      <button class="cm-reassign">↪ Reassign</button>
      <button class="cm-sms">💬 Text</button>
      <button class="cm-del">✔ Done — archive</button></div>` : ''}`);
  const msg = ov.querySelector('.cm-msg');
  const save = async patch => {
    msg.textContent = 'saving…';
    const j = await tbSend({op: 'edit', id: c.id, ...patch});
    if (j) { Object.assign(c, patch); msg.textContent = '✓ saved';
      setTimeout(() => { if (msg.isConnected) msg.textContent = ''; }, 1500); renderTaskBoard(); }
    else msg.textContent = '';
  };
  const txt = ov.querySelector('.cm-text');
  if (canEdit) {
    let t;
    txt.oninput = () => { clearTimeout(t); t = setTimeout(() => save({text: txt.value.trim()}), 1200); };
    txt.onblur = () => { clearTimeout(t); if (txt.value.trim() !== c.text) save({text: txt.value.trim()}); };
    ov.querySelector('.cm-due').onchange = ev2 => save({due: ev2.target.value});
    ov.querySelector('.cm-serial').onchange = ev2 => save({serial: ev2.target.value.trim()});
    if (canEdit) attachSerialSuggest(ov.querySelector('.cm-serial'));
    ov.querySelectorAll('[data-sz]').forEach(b => b.onclick = () => {
      const d = +b.dataset.sz;
      const until = d ? new Date(Date.now() + d * 86400000).toISOString().slice(0, 10) : '';
      const was = c.snooze;
      c.snooze = until; ov.hidden = true; renderTaskBoard();   // instant
      tbSend({op: 'snooze', id: c.id, until}).then(j => {
        if (!j) { c.snooze = was; renderTaskBoard(); }
      });
    });
    // 📅 custom snooze — pick any wake-up date
    const szd = ov.querySelector('.cm-szdate');
    ov.querySelector('.cm-szpick').onclick = () => {
      szd.min = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      try { szd.showPicker(); }
      catch (e) { szd.classList.add('open'); szd.focus(); szd.click(); }
    };
    szd.onchange = () => {
      if (!szd.value) return;
      const was = c.snooze;
      c.snooze = szd.value; ov.hidden = true; renderTaskBoard();   // instant
      tbSend({op: 'snooze', id: c.id, until: szd.value}).then(j => {
        if (!j) { c.snooze = was; renderTaskBoard(); }
      });
    };
    const addNote = async text => {
      if (!text) return;
      // instant: pin the note locally with today's stamp, sync behind it
      const stamp = new Date().toLocaleDateString('en-US',
        {month: 'numeric', day: 'numeric', timeZone: 'America/Denver'});
      const localLine = stamp + ' ' + ((tbMe() || 'me').split(/\s+/)[0]) + ': ' + text;
      const was = c.notes;
      c.notes = localLine + '\n' + (c.notes || '');
      ov.hidden = true; openCardModal(c, canEdit); renderTaskBoard();
      tbSend({op: 'note', id: c.id, text}).then(j => {
        if (j) { c.notes = (j.line || localLine) + '\n' + (was || ''); }
        else { c.notes = was; const cm2 = document.getElementById('cardmodal');
          if (cm2 && !cm2.hidden) { cm2.hidden = true; openCardModal(c, canEdit); } }
      });
    };
    ov.querySelector('.cm-noteadd').onclick = () => addNote(ov.querySelector('.cm-note').value.trim());
    ov.querySelector('.cm-note').onkeydown = ev2 => {
      if (ev2.key === 'Enter') addNote(ov.querySelector('.cm-note').value.trim()); };
    const pf = ov.querySelector('.cm-file');
    ov.querySelector('.cm-photo').onclick = () => pf.click();
    pf.onchange = async () => {
      const f = pf.files[0]; pf.value = '';
      if (!f) return;
      msg.textContent = 'uploading photo…';
      try {
        const dataUrl = await downscalePhoto(f, 1600, 0.82);
        const r = await fetch('https://blpsalesapp.netlify.app/.netlify/functions/request-shot', {
          method: 'POST', headers: {'content-type': 'application/json'},
          body: JSON.stringify({key: 'pianoman', id: 'card-' + c.id,
            photo: dataUrl.split(',')[1], photoType: 'image/jpeg',
            photoName: 'card-photo.jpg'})});
        const j = await r.json();
        if (!j.url) throw new Error(j.error || 'upload failed');
        const url = j.url;
        await addNote('📷 ' + url);
      } catch (e) { msg.textContent = '✗ ' + e.message; }
    };
    // 🎬 video → Drive "Task Board Media" via the bridge (blob store is
    // photos-only at ~6MB; Drive takes ~30MB ≈ a 30-second phone clip)
    const vf = ov.querySelector('.cm-vfile');
    ov.querySelector('.cm-video').onclick = () => vf.click();
    vf.onchange = async () => {
      const f = vf.files[0]; vf.value = '';
      if (!f) return;
      if (f.size > 30 * 1024 * 1024) {
        msg.textContent = '✗ video too big (' + Math.round(f.size / 1048576)
          + 'MB) — keep it under 30MB (~30 seconds), or trim it first';
        return;
      }
      const wa = writeAuth();
      if (!wa.ok) { msg.textContent = 'Sign in first.'; return; }
      msg.textContent = 'uploading video… (' + Math.round(f.size / 1048576) + 'MB — hang tight)';
      try {
        const b64 = await new Promise((res, rej) => {
          const rd = new FileReader();
          rd.onload = () => res(String(rd.result).split(',')[1]);
          rd.onerror = () => rej(new Error('could not read the file'));
          rd.readAsDataURL(f);
        });
        const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
          headers: {'content-type': 'text/plain;charset=utf-8'},
          body: JSON.stringify({pin: wa.pin, action: 'cardmedia', cardId: c.id,
            mime: f.type || 'video/mp4', data: b64, ...authFields()})});
        const j = await r.json();
        if (!j.url) throw new Error(j.error || 'upload failed');
        await addNote('🎬 ' + j.url);
      } catch (e) { msg.textContent = '✗ ' + e.message; }
    };
    ov.querySelector('.cm-sms').onclick = () => { ov.hidden = true; openCardTextModal(c); };
    ov.querySelector('.cm-reassign').onclick = () => { ov.hidden = true; openReassignModal(c); };
    ov.querySelector('.cm-del').onclick = () => {
      const was = c.col;
      c.col = 'archived'; ov.hidden = true; renderTaskBoard();   // instant
      tbSend({op: 'archive', id: c.id}).then(j => {
        if (!j) { c.col = was; renderTaskBoard(); }
      });
    };
    serialDatalist();
  }
}

/* ---------- 📅 Scheduling — management dashboard (managers & owners) ----------
 * Shop Manager pages embedded via manager.html?embed=1 (chrome hidden,
 * hash picks the page) — one source of truth, nothing duplicated. */
const SHOP_MGR = 'https://blpshop.netlify.app/manager.html';
function shopFrameHTML(tab) {
  return `<iframe class="shopframe" src="${SHOP_MGR}?embed=1#${tab}"
      title="Shop Manager — ${esc(tab)}"></iframe>
    <p class="pd frameft">Signed-in view from the Shop Manager —
      <a href="${SHOP_MGR}#${tab}" target="_blank" rel="noopener">open full page ↗</a></p>`;
}
// embedded Shop Manager frames can't run Google sign-in (Google refuses to
// render inside an iframe) — they ask us for the identity instead, and we
// hand over the signed-in user's token (same OAuth client both sides)
addEventListener('message', ev => {
  if (ev.origin !== 'https://blpshop.netlify.app') return;
  if (!ev.data || !ev.data.blpAuthRequest) return;
  const u = authUser();
  if (!u || !u.email) return;
  try {
    ev.source.postMessage({blpAuth: {idToken: (u.exp * 1000 > Date.now() + 30000) ? u.tok : '',
      email: u.email, name: u.name || ''}}, ev.origin);
  } catch (e) { /* frame gone */ }
});
const SCHED_TABS = [
  ['dash', '📊 Dashboard'], ['review', '📝 Weekly Review'], ['planner', '🧮 Planner'],
  ['week', '🗓 Week Schedule'], ['schedule', '📆 Schedule'], ['sequence', '🔢 Sequence'],
  ['pipeline', '🚰 Pipeline'], ['walk', '🚶 Walk-the-Shop'],
];
const SCHED = {tab: 'planner'};
function renderSched() {
  const el = $('#schedBody');
  if (!el) return;
  if (!isTimelogAdmin()) { el.innerHTML = '<div class="empty">Managers &amp; owners only.</div>'; return; }
  el.innerHTML = `<div class="teamtabs">${SCHED_TABS.map(([id, label]) =>
      `<button data-st="${id}" class="${SCHED.tab === id ? 'on' : ''}">${label}</button>`).join('')}</div>
    <div id="schedFrame"></div>`;
  el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
    SCHED.tab = b.dataset.st;
    el.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x.dataset.st === SCHED.tab));
    schedPane();
  });
  schedPane();
}
// native panes (Brigham 8/29: Shop App is being sunset — no more iframes).
// 'schedule' reuses the Team dashboard's native Team Schedules table.
function schedPane() {
  const host = $('#schedFrame');
  if (!host) return;
  if (SCHED.tab === 'schedule') {
    if (!TEAM.sched && !TEAM.loading) { teamFetchAll(); }
    host.innerHTML = `<div class="smgr">${TEAM.sched ? teamScheduleHTML()
      : '<div class="empty">Loading the team schedule…</div>'}</div>`;
    if (!TEAM.sched) setTimeout(() => { if (SCHED.tab === 'schedule' && TEAM.sched) schedPane(); }, 2500);
    return;
  }
  if (window.renderSchedNative) renderSchedNative(SCHED.tab, host);
  else host.innerHTML = '<div class="empty">Still loading the scheduling module — try again in a second.</div>';
}

/* ---------- 🛡 Admin dashboard (admin + managers + owners) ---------- */
const ADMDASH_TABS = [
  ['requests', '💡 App Requests'], ['brigham', '🗒 Brigham Tasks'],
  ['curtis', '🎨 Curtis'], ['qc', '✅ QC'], ['client', '📬 Client Reports'],
];
/* Native admin dashboard (Brigham 8/28): no Shop App frames, no second
 * sign-in — every tab reads/writes the same sheets directly. The Shop App
 * is being sunset one page at a time. */
const ADMDASH = {tab: 'requests', req: null, brig: null, curtis: null, busy: false};
const REQ_STATES = ['Requested', 'In progress', 'Live', 'Tested', 'Declined'];
async function admFetchRequests() {
  try {
    const r = await fetch(BRIDGE_URL + '?fn=requests', {redirect: 'follow'});
    ADMDASH.req = (await r.json()).requests || [];
  } catch (e) { ADMDASH.req = ADMDASH.req || []; }
  renderAdmDash();
}
function admRequestsHTML() {
  if (!ADMDASH.req) { admFetchRequests(); return '<div class="empty">Loading app requests…</div>'; }
  const open = ADMDASH.req.filter(r => !['Tested', 'Declined'].includes(r.status));
  const closed = ADMDASH.req.filter(r => ['Tested', 'Declined'].includes(r.status));
  const row = r => `<div class="admreq">
      <div class="admreqtop"><b>${esc(r.who)}</b>
        <span class="chip ${r.type === 'bug' ? 'c-due' : r.type === 'idea' ? 'c-from' : 'c-piano'}">${esc(r.type || 'edit')}</span>
        <small>${esc(String(r.date).slice(0, 10))} · ${esc(r.id)}</small>
        <select class="reqst" data-id="${esc(r.id)}">
          ${REQ_STATES.map(st => `<option ${r.status === st ? 'selected' : ''}>${st}</option>`).join('')}
        </select></div>
      <div class="admreqtext">${esc(r.text)}</div>
      <div class="admreqmeta">${r.context ? esc(r.context) + ' · ' : ''}${r.screenshot
        ? `<a href="${esc(r.screenshot)}" target="_blank" rel="noopener">📎 screenshot ↗</a>` : ''}</div>
      <div class="admreqbtns">
        <button class="rqcopy" data-id="${esc(r.id)}">📋 Copy for Claude</button>
        <button class="rqsmsbtn" data-id="${esc(r.id)}">💬 Text ${esc((r.who || '').split(' ')[0])}</button>
      </div>
      <div class="rqsmsbox" data-id="${esc(r.id)}" hidden>
        <div class="rqpres">
          <button class="rqpre" data-t="Can you give a little more detail — what were you tapping, and what did you expect to happen?">more detail?</button>
          <button class="rqpre" data-t="Could you attach a screenshot of what you're seeing? (💡 lightbulb → attach screenshot)">screenshot?</button>
          <button class="rqpre" data-t="Is this still happening after refreshing the app (☰ menu → ⟳ Refresh app)?">still happening?</button>
        </div>
        <textarea class="rqsmstxt" rows="2" placeholder="text ${esc((r.who || '').split(' ')[0])} a question…"></textarea>
        <div class="rqsmsrow">
          <button class="rqsmssend csvbtn">Send text</button>
          <button class="rqsmscancel csvbtn" style="background:none;border:1px solid #cfc9bf;color:inherit">Cancel</button>
          <span class="rqsmsout phmsg"></span>
        </div>
      </div>
    </div>`;
  return `<h4 class="tmsec">Open <span class="pc">${open.length}</span></h4>${open.map(row).join('')
    || '<div class="empty">Nothing open. 🎉</div>'}
    <details style="margin-top:14px"><summary style="cursor:pointer;color:#8a929a">Completed / declined (${closed.length})</summary>
      ${closed.slice(0, 40).map(row).join('')}</details>`;
}
async function admFetchBrigham() {
  try {
    const r = await fetch('https://blpsalesapp.netlify.app/.netlify/functions/brigham-tasks?key='
      + encodeURIComponent('pianoman'));
    ADMDASH.brig = (await r.json()).rows || [];
  } catch (e) { ADMDASH.brig = ADMDASH.brig || []; }
  renderAdmDash();
}
function admBrighamHTML() {
  if (!ADMDASH.brig) { admFetchBrigham(); return '<div class="empty">Loading Brigham\u2019s tasks…</div>'; }
  // rows: [When, Piano, Note, From, Priority, Status, Done date]; row 1 = headers
  const rows = ADMDASH.brig.slice(1).map((v, i) => ({row: i + 2, when: v[0], piano: v[1],
    note: v[2], from: v[3], pri: v[4], status: v[5], done: v[6]}));
  const open = rows.filter(r => !/done|complete/i.test(String(r.status || '')));
  const doneRows = rows.filter(r => /done|complete/i.test(String(r.status || '')));
  const line = r => `<div class="admreq">
      <div class="admreqtop"><b>${esc(String(r.piano || '').slice(0, 34) || '(general)')}</b>
        ${r.pri ? `<span class="chip c-due">${esc(r.pri)}</span>` : ''}
        <small>${esc(String(r.when).slice(0, 10))}${r.from ? ' · from ' + esc(r.from) : ''}</small>
        <button class="brigdone" data-row="${r.row}">✓ Done</button></div>
      <div class="admreqtext">${esc(r.note || '')}</div></div>`;
  return `<div class="movebox notebox">
      <input class="brig-note" maxlength="200" placeholder="new task for Brigham…">
      <input class="brig-piano" maxlength="30" placeholder="piano (optional)" list="serialList" style="max-width:150px">
      <button class="mvgo brig-add">Add</button>
    </div><div class="brigmsg phmsg"></div>
    <h4 class="tmsec">Open <span class="pc">${open.length}</span></h4>${open.map(line).join('')
    || '<div class="empty">Brigham\u2019s list is clear. 🎉</div>'}
    <details style="margin-top:14px"><summary style="cursor:pointer;color:#8a929a">Done (${doneRows.length})</summary>
      ${doneRows.slice(-30).reverse().map(line).join('')}</details>`;
}
async function admFetchCurtis() {
  try {
    const r = await fetch('https://blpsalesapp.netlify.app/.netlify/functions/curtis-orders?key='
      + encodeURIComponent('pianoman'));
    ADMDASH.curtis = (await r.json()).tabs || {};
  } catch (e) { ADMDASH.curtis = ADMDASH.curtis || {}; }
  renderAdmDash();
}
function admCurtisHTML() {
  if (!ADMDASH.curtis) { admFetchCurtis(); return '<div class="empty">Loading Curtis\u2019s orders…</div>'; }
  const tabs = Object.entries(ADMDASH.curtis);
  if (!tabs.length) return '<div class="empty">No order tabs found.</div>';
  return tabs.map(([name, rows]) => {
    if (!rows || rows.length < 2) return '';
    return `<h4 class="tmsec">${esc(name)} <span class="pc">${rows.length - 1}</span></h4>
      <div class="tmscroll"><table class="tmtable">
        <tr>${rows[0].map(h => `<th>${esc(String(h || ''))}</th>`).join('')}</tr>
        ${rows.slice(1).map(r => `<tr>${rows[0].map((_, i) =>
          `<td>${esc(String(r[i] || ''))}</td>`).join('')}</tr>`).join('')}
      </table></div>`;
  }).join('') + `<p class="pd">Add or edit orders with the 🎨 Curtis Harper button in the 📨 Request menu —
    every request lands on this sheet.</p>`;
}
function admQcHTML() {
  return `<p class="pd">QC lives on each piano now: open a piano\u2019s card → 📁 Paperwork holds the
      scanned QC checklists, and the phase checklist gates QC &amp; Assembly. Look a piano up:</p>
    <div class="movebox notebox"><input class="qcfind" maxlength="30" list="serialList"
      placeholder="serial — opens the piano\u2019s card"><button class="mvgo qcgo">Open</button></div>
    <div class="qcmsg phmsg"></div>
    <p class="pd"><a href="https://docs.google.com/document/d/1f7AU5PtX1bP4-b48MHMSn1nzpN5FbMmTd1Yh0kaBcVY/edit"
      target="_blank" rel="noopener">📄 The QC checklist document ↗</a></p>
    ${(() => {
      const inQC = S.data.pianos.filter(p => p.active && (p.phase || '') === 'QC & Assembly');
      return `<h4 class="tmsec">In QC &amp; Assembly right now <span class="pc">${inQC.length}</span></h4>
        <div class="tmgrid">${inQC.map(p => `<div class="tmtile mrowqc" data-row="${p.row}" style="cursor:pointer">
          <b>${esc(((p.year ? p.year + ' ' : '') + [p.make, p.model].filter(Boolean).join(' ')).slice(0, 30))}</b>
          <small>#${esc(p.serial)} · spot ${esc(String(p.location || '—'))}</small></div>`).join('')
          || '<div class="empty">None in QC right now.</div>'}</div>`;
    })()}`;
}
function admClientHTML() {
  const optIn = S.data.pianos.filter(p => p.active && (p.clientReports || '').trim().toLowerCase() === 'yes');
  const unasked = S.data.pianos.filter(p => p.active && p.serial && inShopwork(p)
    && !['yes', 'no'].includes((p.clientReports || '').trim().toLowerCase()));
  return `<p class="pd">Client-report pianos (opt-in on each card\u2019s 🔐 Admin section). Open a piano to
      draft/send from its 🤝 Client Reports History.</p>
    <h4 class="tmsec">Opted in <span class="pc">${optIn.length}</span></h4>
    <div class="tmgrid">${optIn.map(p => `<div class="tmtile mrowqc" data-row="${p.row}" style="cursor:pointer">
      <b>${esc(((p.year ? p.year + ' ' : '') + [p.make, p.model].filter(Boolean).join(' ')).slice(0, 30))}</b>
      <small>#${esc(p.serial)} · ${esc(p.phase || '—')} · ${esc(ownerNameOf(p) || '')}</small></div>`).join('')
      || '<div class="empty">No pianos opted in yet.</div>'}</div>
    <details style="margin-top:14px"><summary style="cursor:pointer;color:#8a929a">Shop pianos not yet asked (${unasked.length})</summary>
      <div class="tmgrid" style="margin-top:8px">${unasked.slice(0, 30).map(p => `<div class="tmtile mrowqc" data-row="${p.row}" style="cursor:pointer">
        <b>${esc(((p.year ? p.year + ' ' : '') + [p.make, p.model].filter(Boolean).join(' ')).slice(0, 30))}</b>
        <small>#${esc(p.serial)}</small></div>`).join('')}</div></details>`;
}
function renderAdmDash() {
  const el = $('#admdashBody');
  if (!el) return;
  if (!isTeamAdmin()) { el.innerHTML = '<div class="empty">Admin, managers &amp; owners only.</div>'; return; }
  const body = ADMDASH.tab === 'requests' ? admRequestsHTML()
    : ADMDASH.tab === 'brigham' ? admBrighamHTML()
    : ADMDASH.tab === 'curtis' ? admCurtisHTML()
    : ADMDASH.tab === 'qc' ? admQcHTML() : admClientHTML();
  el.innerHTML = `<div class="teamtabs">${ADMDASH_TABS.map(([id, label]) =>
      `<button data-at="${id}" class="${ADMDASH.tab === id ? 'on' : ''}">${label}</button>`).join('')}
      <button class="teamrefresh admrefresh">🔄</button></div>
    <div id="admdashPane">${body}</div>`;
  el.querySelectorAll('[data-at]').forEach(b => b.onclick = () => {
    ADMDASH.tab = b.dataset.at; renderAdmDash();
  });
  el.querySelector('.admrefresh').onclick = () => {
    ADMDASH.req = ADMDASH.brig = ADMDASH.curtis = null; renderAdmDash();
  };
  // requests: status dropdown writes through the bridge (Google-verified)
  el.querySelectorAll('.reqst').forEach(sel => sel.onchange = async () => {
    const wa = writeAuth();
    if (!wa.ok) { alert('Sign in with Google first.'); return; }
    sel.disabled = true;
    try {
      const r = await bridgeFetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin: wa.pin, action: 'requeststatus', id: sel.dataset.id,
          status: sel.value, ...authFields()})});
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'failed');
      const req = ADMDASH.req.find(x => x.id === sel.dataset.id);
      if (req) req.status = sel.value;
      renderAdmDash();
    } catch (e) { alert('✗ ' + e.message); sel.disabled = false; }
  });
  // 📋 Copy for Claude + 💬 text the requester — same tools as the shop
  // app's App Requests page (Brigham 9/3)
  el.querySelectorAll('.rqcopy').forEach(b => b.onclick = async () => {
    const x = (ADMDASH.req || []).find(r => r.id === b.dataset.id); if (!x) return;
    const brief = `App request ${x.id} (${x.type || 'edit'}) from ${x.who}, ${String(x.date).slice(0, 10)}:\n"${x.text}"\nContext: ${x.context || '—'}${x.screenshot ? '\nScreenshot: ' + x.screenshot : ''}`;
    try { await navigator.clipboard.writeText(brief); b.textContent = '✓ copied'; }
    catch (e) { b.textContent = '✗ copy blocked'; }
    setTimeout(() => { b.textContent = '📋 Copy for Claude'; }, 1500);
  });
  el.querySelectorAll('.rqsmsbtn').forEach(b => b.onclick = () => {
    const box = el.querySelector(`.rqsmsbox[data-id="${b.dataset.id}"]`); if (!box) return;
    box.hidden = !box.hidden;
    if (!box.hidden) box.querySelector('.rqsmstxt').focus();
  });
  el.querySelectorAll('.rqsmsbox').forEach(box => {
    const x = (ADMDASH.req || []).find(r => r.id === box.dataset.id); if (!x) return;
    const ta = box.querySelector('.rqsmstxt'), out = box.querySelector('.rqsmsout');
    box.querySelectorAll('.rqpre').forEach(pb => pb.onclick = () => { ta.value = pb.dataset.t; ta.focus(); });
    box.querySelector('.rqsmscancel').onclick = () => { box.hidden = true; out.textContent = ''; };
    box.querySelector('.rqsmssend').onclick = async ev => {
      const msgTxt = ta.value.trim();
      if (!msgTxt) { ta.focus(); return; }
      const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Sending…'; out.textContent = '';
      try {
        const r2 = await fetchT('https://blpsalesapp.netlify.app/.netlify/functions/request-notify', {
          method: 'POST', headers: {'content-type': 'application/json'},
          body: JSON.stringify({key: 'pianoman', name: x.who,
            message: `BLP Apps — about your ${x.type || 'request'} "${String(x.text).slice(0, 60)}": ${msgTxt} — ${clockName() || 'the office'}`})}, 30000);
        const j2 = await r2.json();
        if (j2.error) throw new Error(j2.error);
        if (j2.sent === false && !j2.scheduled && !j2.queued) throw new Error(j2.reason || 'not sent');
        out.className = 'rqsmsout phmsg ok';
        out.textContent = j2.scheduled || j2.queued
          ? `✓ queued — ${(x.who || '').split(' ')[0]} gets it at 10am (quiet hours)`
          : `✓ texted ${(x.who || '').split(' ')[0]}`;
        ta.value = '';
        setTimeout(() => { box.hidden = true; out.textContent = ''; }, 2400);
      } catch (e2) { out.className = 'rqsmsout phmsg err'; out.textContent = '✗ ' + e2.message; }
      btn.disabled = false; btn.textContent = 'Send text';
    };
  });
  // brigham tasks: add + mark done via the salesapp2 function
  const bAdd = el.querySelector('.brig-add');
  if (bAdd) bAdd.onclick = async () => {
    const note = el.querySelector('.brig-note').value.trim();
    if (!note) return;
    bAdd.disabled = true;
    const msg = el.querySelector('.brigmsg');
    msg.textContent = 'adding…';
    try {
      const u = authUser();
      const r = await fetch('https://blpsalesapp.netlify.app/.netlify/functions/brigham-tasks', {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({key: 'pianoman', add: {piano: el.querySelector('.brig-piano').value.trim(),
          note, from: (u && u.name) || 'Store Map'}})});
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      ADMDASH.brig = null; renderAdmDash();
    } catch (e) { msg.textContent = '✗ ' + e.message; bAdd.disabled = false; }
  };
  el.querySelectorAll('.brigdone').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await fetch('https://blpsalesapp.netlify.app/.netlify/functions/brigham-tasks', {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({key: 'pianoman', update: {row: +b.dataset.row, status: 'Done'}})});
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      ADMDASH.brig = null; renderAdmDash();
    } catch (e) { alert('✗ ' + e.message); b.disabled = false; }
  });
  // qc + client tiles open the piano's card
  el.querySelectorAll('.mrowqc').forEach(t => t.onclick = () => {
    const p = S.data.pianos.find(x => x.row === +t.dataset.row);
    if (p) { switchView('map'); focusPiano(p); openPop(p.row, S.popAnchor, true); }
  });
  const qgo = el.querySelector('.qcgo');
  if (qgo) qgo.onclick = () => {
    const q = el.querySelector('.qcfind').value.trim().toLowerCase();
    const p = S.data.pianos.find(x => x.active && (x.serial || '').toLowerCase() === q)
      || S.data.pianos.find(x => x.active && matches(x, q));
    const msg = el.querySelector('.qcmsg');
    if (!p) { msg.textContent = 'no match'; return; }
    switchView('map'); focusPiano(p); openPop(p.row, S.popAnchor, true);
  };
  if (ADMDASH.tab === 'brigham' || ADMDASH.tab === 'qc') serialDatalist();
}

/* ---------- views / nav / drawers ---------- */
function showView(v) {
  ['map', 'report', 'board', 'cal', 'media', 'shopmap', 'archive', 'dash', 'whiteboard', 'training', 'trainingdoc', 'sched', 'team', 'admdash', 'updates', 'tboard', 'manager'].forEach(x => $('#view-' + x).hidden = x !== v);
  if (v === 'archive') renderArchive();
  document.querySelectorAll('.navitem[data-view]').forEach(el =>
    el.classList.toggle('on', el.dataset.view === v));
  if (v === 'shopmap') renderShopMap();
  if (v === 'dash') renderDash();
  if (v === 'whiteboard') renderWhiteboard();   // first open fetches the board
  if (v === 'sched') renderSched();
  if (v === 'team') renderTeam();
  if (v === 'admdash') renderAdmDash();
  if (v === 'updates') renderUpdatesFeed();
  if (v === 'tboard') renderTaskBoard();
  if (v === 'manager') renderManager();
}
/* 📊 Manager console — the scorecard as its own menu tab */
function renderManager() {
  const el = $('#managerBody');
  if (!el) return;
  if (!isManagerConsole()) { el.innerHTML = '<div class="empty">Owners and the Lead Manager only.</div>'; return; }
  if (!S.tlRows) loadTimeLog();
  if (!S.payRows) loadPayroll();
  if (!S.qcRows) loadQcLog();
  if (!S.slRows) loadScoreLog();
  el.innerHTML = scorecardTable();
}
/* 🚀 App Updates — the user-facing changelog. Same "App Updates" sheet the
 * 📣 admin report logs into; everyone can read what's new. */
async function renderUpdatesFeed() {
  const el = $('#updatesBody');
  if (!el) return;
  if (!S.auRows) {
    el.innerHTML = '<div class="empty">Loading the update log…</div>';
    try {
      const r = await fetch(BRIDGE_URL + '?fn=appupdates', {redirect: 'follow'});
      S.auRows = (await r.json()).rows || [];
    } catch (e) { el.innerHTML = '<div class="empty">✗ could not load updates — try again</div>'; return; }
  }
  const rows = S.auRows;
  if (!rows.length) { el.innerHTML = '<div class="empty">No updates logged yet.</div>'; return; }
  const day = iso => {
    const d = new Date(iso);
    return isNaN(d) ? String(iso).slice(0, 10)
      : d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Denver'});
  };
  let lastDay = '';
  el.innerHTML = rows.map(r => {
    const d = day(r.at);
    const head = d !== lastDay ? `<h4 class="updday">${esc(d)}</h4>` : '';
    lastDay = d;
    return `${head}<div class="updrow">🚀 ${esc(r.text)}</div>`;
  }).join('');
}
function switchView(v) {
  if (v === 'sched' && !isTimelogAdmin()) v = 'map';   // managers & owners only
  if ((v === 'team' || v === 'admdash') && !isTeamAdmin()) v = 'map';   // admin + managers + owners
  if (v === 'manager' && !isManagerConsole()) v = 'map';   // Brigham, Karmel & Mark only
  S.view = v; showView(v); closeNav();
  // a leftover page scroll (from panning the map) can slide a view's top —
  // and its ✕ — up underneath the sticky header, where iOS bounce keeps it
  if (v !== 'map') {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const st = document.querySelector('.stage');
    if (st) st.scrollTop = 0;
  }
}
document.querySelectorAll('.navitem[data-view]').forEach(el =>
  el.onclick = () => switchView(el.dataset.view));

// tapping the BLP logo is a hard reset to "just opened the app" — first
// floor, full-width zoom, no search, no open card/report, nav drawer closed
function goHome() {
  history.replaceState(null, '', location.pathname);
  S.floor = 0; S.search = ''; S.zoom = 1; S.focusRow = null; S.openReport = null;
  popPinned = false; $('#pop').hidden = true;
  const search = $('#search'); if (search) search.value = '';
  syncSearchClear();
  $('#searchac').hidden = true;
  closeNav();
  switchView('map');
  renderTabs(); renderMap(); sizePlan();
}
$('.logo').onclick = goHome;
$('.logo').style.cursor = 'pointer';

// every non-map view gets a ✕ back to the map (Escape works too)
['report', 'board', 'cal', 'media', 'shopmap', 'archive', 'dash', 'whiteboard', 'training', 'trainingdoc'].forEach(v => {
  const el = $('#view-' + v);
  if (el && !el.querySelector('.viewclose')) {
    const b = document.createElement('button');
    b.className = 'viewclose';
    b.title = 'Close — back to the map';
    b.textContent = '✕';
    b.onclick = () => switchView('map');
    el.prepend(b);
  }
});
addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.view !== 'map' && !document.querySelector('.tagview')) switchView('map');
});
// Home/End inside any text field jump the caret to line start/end (with
// shift-selection). On macOS Safari/installed app those keys scroll the
// page instead — Melissa's big keyboard, 9/3.
addEventListener('keydown', e => {
  const t = e.target;
  if ((e.key !== 'Home' && e.key !== 'End') || !t || e.metaKey || e.ctrlKey || e.altKey) return;
  const isTa = t.tagName === 'TEXTAREA';
  if (!isTa && !(t.tagName === 'INPUT' && /^(text|search|url|tel|email|)$/.test(t.type || ''))) return;
  e.preventDefault();
  const end = e.key === 'End';
  const v = t.value, c = end ? t.selectionEnd : t.selectionStart;
  let pos;
  if (isTa) {
    if (end) { const nl = v.indexOf('\n', c); pos = nl === -1 ? v.length : nl; }
    else pos = v.lastIndexOf('\n', c - 1) + 1;
  } else pos = end ? v.length : 0;
  const anchor = e.shiftKey ? (end ? t.selectionStart : t.selectionEnd) : pos;
  t.setSelectionRange(Math.min(anchor, pos), Math.max(anchor, pos), end ? 'forward' : 'backward');
}, true);

/* ---------- 🌐 language selector — Google page-translate, our menu ----------
 * The whole app (cards, reports, briefs links) renders in English; picking a
 * language sets Google Translate's googtrans cookie and loads its element,
 * which machine-translates the page in place and keeps translating every
 * re-render. "English" clears the cookie and reloads clean. */
const LANGS = [['en', 'English'], ['es', 'Español']];
function gtCookieClear() {
  ['', '; domain=' + location.hostname, '; domain=.' + location.hostname].forEach(d => {
    document.cookie = 'googtrans=; path=/' + d + '; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });
}
function setLang(code) {
  if (code === 'en') { gtCookieClear(); lsDel('blpLang'); location.reload(); return; }
  gtCookieClear();
  document.cookie = 'googtrans=/en/' + code + '; path=/';
  lsSet('blpLang', code);
  location.reload();   // the widget reads the cookie on load and translates
}
function loadTranslator() {
  if (document.getElementById('gtwrap')) return;
  const holder = document.createElement('div');
  holder.id = 'gtwrap';
  document.body.appendChild(holder);
  window.googleTranslateElementInit = () => {
    /* global google */
    new google.translate.TranslateElement({pageLanguage: 'en', autoDisplay: false}, 'gtwrap');
  };
  const s = document.createElement('script');
  s.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
  document.head.appendChild(s);
}
(() => {
  const saved = lsGet('blpLang') || '';
  const cur = $('#langCur');
  if (cur) cur.textContent = (LANGS.find(l => l[0] === saved) || [])[1] || '';
  if (saved && saved !== 'en') {
    if (!/googtrans=/.test(document.cookie)) document.cookie = 'googtrans=/en/' + saved + '; path=/';
    loadTranslator();
  }
  const list = $('#langList');
  if (list) {
    list.innerHTML = LANGS.map(([c, name]) =>
      `<button class="langchip notranslate ${saved === c || (!saved && c === 'en') ? 'on' : ''}" data-l="${c}" translate="no">${name}</button>`).join('');
    list.querySelectorAll('.langchip').forEach(b => b.onclick = () => setLang(b.dataset.l));
  }
  const btn = $('#langBtn');
  if (btn) btn.onclick = () => { list.hidden = !list.hidden; };
})();

function openNav() { $('#side').classList.add('open'); $('#scrim').classList.add('show'); }
function closeNav() { $('#side').classList.remove('open'); $('#scrim').classList.remove('show'); }
$('#menuBtn').onclick = () =>
  $('#side').classList.contains('open') ? closeNav() : openNav();
$('#scrim').onclick = closeNav;

function syncFeed() {
  $('#view-map').classList.toggle('nofeed', !S.feedOpen);
  sizePlan();   // map immediately claims the freed space
}
$('#movesBtn').onclick = () => { S.feedOpen = !S.feedOpen; if (S.view !== 'map') switchView('map'); syncFeed(); };
$('#movesClose').onclick = () => { S.feedOpen = false; syncFeed(); };
document.querySelectorAll('.feedgo').forEach(b => b.onclick = () => {
  S.feedOpen = false; syncFeed();
  switchView(b.dataset.view);
});

/* mobile header slimming (Brigham 9/3): on narrow screens the header keeps
 * only search · 🚚 · ☰; the other live controls MOVE into the drawer's
 * quick-tools strip (moving DOM nodes preserves their handlers), and move
 * back when the window widens. */
(() => {
  const IDS = ['wbBtn', 'queueBtn', 'boardBtn', 'hardRefreshBtn', 'suggestBtn', 'movesBtn'];
  const homes = new Map();   // node -> {parent, next}
  const rememberedSel = ['.topreq', '.topwho'];
  const nodes = () => IDS.map(id => document.getElementById(id))
    .concat([...document.querySelectorAll('header.bar .topreq'), document.getElementById('topWho'),
             document.getElementById('whoTopMenu')])
    .concat([...(homes.size ? [...homes.keys()] : [])])
    .filter((n, i, arr) => n && arr.indexOf(n) === i);
  function applyHeaderLayout() {
    const tools = document.getElementById('drawerTools');
    if (!tools) return;
    const mobile = window.innerWidth <= 760;
    for (const n of nodes()) {
      if (mobile) {
        if (!homes.has(n)) homes.set(n, {parent: n.parentNode, next: n.nextSibling});
        if (n.parentNode !== tools) tools.appendChild(n);
      } else {
        const home = homes.get(n);
        if (home && n.parentNode === tools) {
          if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(n, home.next);
          else home.parent.appendChild(n);
        }
      }
    }
  }
  applyHeaderLayout();
  let hlT = null;
  window.addEventListener('resize', () => { clearTimeout(hlT); hlT = setTimeout(applyHeaderLayout, 200); });
})();

$('#legendBtn').onclick = () => { const p = $('#legendPanel'); p.hidden = !p.hidden; };
/* Legend items are clickable (Brigham 8/25): each opens the list of pianos in
 * that state, same predicates the map paints with; a row jumps to the piano. */
const LEGEND_LISTS = {
  photos:   {t: '📷 Needs photos',   f: p => !notYetArrived(p) && mediaNeeds(p).photo},
  video:    {t: '🎥 Needs video',    f: p => !notYetArrived(p) && mediaNeeds(p).video},
  sched:    {t: '🟣 Move scheduled', f: p => pianoStatus(p) === 'sched'},
  move:     {t: '🔴 In transit',     f: p => pianoStatus(p) === 'move'},
  new:      {t: '🩷 New (first 7 days)', f: p => !!p.isNew},
  sale:     {t: '🟢 For sale',       f: p => (p.phase || '') === 'For Sale'},
  coming:   {t: '🟡 Coming soon',    f: p => comingSoon(p)},
  rented:   {t: '🟠 Rented',         f: p => isRented(p)},
  tune:     {t: '🔵 On the tuning calendar', f: p => !!tuningInfo(p).next},
  financed: {t: '💚 Private financing', f: p => isPrivateFinancing(p)},
  larson:   {t: '🩵 Larson Family',  f: p => /conference room|larson home/i.test(p.location || '') && !isPrivateFinancing(p)},
  soldpend: {t: '🏅 Sold / completed — awaiting delivery', f: p => soldPending(p)},
  preq:     {t: '🚫 Pre-Queue — deposit pending, do NOT start', f: p => preQueue(p)},
  // ownership + every shop phase/state (Brigham 9/3): the whole legend taps
  blp:      {t: '⚪ BLP owned',          f: p => ownerClass(p) === 'blp'},
  client:   {t: '⚫ Client / consigned', f: p => ownerClass(p) !== 'blp'},
  q:        {t: 'Q-# In Queue',          f: p => effectivePhase(p) === 'In Queue' || (!effectivePhase(p) && !!p.queuePos)},
  paused:   {t: 'P · Paused',            f: p => effectivePhase(p) === 'Paused'},
  wb:       {t: 'WB · Waiting on Brigham',        f: p => effectivePhase(p) === 'Waiting on Brigham'},
  wc:       {t: 'WC · Waiting on Curtis Harper',  f: p => effectivePhase(p) === 'Waiting on Curtis Harper'},
  wcu:      {t: 'WCu · Waiting on Customer',      f: p => effectivePhase(p) === 'Waiting on Customer'},
  wo:       {t: 'WO · Waiting on OTHER',          f: p => effectivePhase(p) === 'Waiting on OTHER'},
};
// the 13 working phases share one pattern — key ph0..ph12
[['1N', 'New Arrival - Admin'], ['2A', 'Assessment'], ['3C', 'CAP'],
 ['4P', 'PRSB & Plate Refinishing'], ['5L', 'Lacquer Soundboard'], ['6R', 'Restringing'],
 ['7C', 'Chip Tuning'], ['8D', 'DHRT'], ['9T', '1st Tuning'], ['10R', 'Refinishing'],
 ['11QC', 'QC & Assembly'], ['12T', '2nd Tuning'], ['13E', 'Exit Prep - Admin']]
  .forEach(([code, name], i) => {
    LEGEND_LISTS['ph' + i] = {t: code + ' · ' + name, f: p => effectivePhase(p) === name};
  });
function openLegendList(key) {
  const def = LEGEND_LISTS[key]; if (!def) return;
  const list = ((S.data && S.data.pianos) || []).filter(p => p.active && def.f(p))
    .sort((a, b) => String(a.location || 'zz').localeCompare(String(b.location || 'zz'), undefined, {numeric: true}));
  let panel = $('#lgListPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'lgListPanel';
    panel.style.cssText = 'position:absolute;right:12px;bottom:52px;z-index:60;background:#fff;'
      + 'border:1px solid #d8d2c8;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.18);'
      + 'padding:12px 14px;width:min(430px,92%);max-height:62%;overflow:auto;font-size:12.5px';
    document.querySelector('.mapcard').appendChild(panel);
  }
  panel.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <b style="font-size:13px">${def.t}</b>
      <span style="color:#8a847b">${list.length} piano${list.length === 1 ? '' : 's'}</span>
      <span id="lgListX" style="margin-left:auto;cursor:pointer;padding:2px 8px">✕</span></div>
    ${list.map(p => `<div class="lgrow" data-row="${p.row}" style="padding:6px 4px;border-top:1px solid #f0ece5;cursor:pointer">
        <div style="display:flex;gap:8px;align-items:baseline">
        <b style="min-width:44px">${esc(String(p.location || '—'))}</b>
        <span style="flex:1">${esc(String(p.summary || '').slice(0, 44))}</span>
        <span style="color:#8a847b">#${esc(String(p.serial || '—'))}</span></div>
        ${/^waiting/i.test(p.phase || '') ? `<div style="color:#9a5b13;font-size:11.5px;margin:2px 0 0 44px">${
          (p.waitNote || '').trim() ? '⏳ ' + esc(String(p.waitNote).slice(0, 110)) : '⏳ no reason recorded — open the card to add one'}${
          (p.checkBack || '').trim() ? ' · check back ' + esc(p.checkBack) : ''}</div>` : ''}</div>`).join('')
      || '<div style="color:#8a847b;padding:8px 0">None right now. 🎉</div>'}`;
  panel.hidden = false;
  panel.querySelector('#lgListX').onclick = () => { panel.hidden = true; };
  panel.querySelectorAll('.lgrow').forEach(r => r.onclick = () => {
    const p = S.data.pianos.find(x => String(x.row) === r.dataset.row);
    if (!p) return;
    panel.hidden = true; $('#legendPanel').hidden = true;
    focusPiano(p);
  });
}
$('#legendPanel').addEventListener('click', e => {
  const q = e.target.closest('.lgq');
  if (q) openLegendList(q.dataset.lg);
});

// top-bar 🏢 BLP Apps menu — links to the other BLP webapps
const appsTopBtn = $('#appsTopBtn');
if (appsTopBtn) {
  appsTopBtn.onclick = () => {
    const m = $('#appsTopMenu');
    m.hidden = !m.hidden;
    if (!m.hidden) {
      const r = appsTopBtn.getBoundingClientRect();
      const menuW = Math.max(190, m.offsetWidth || 0);
      const right = Math.min(
        Math.max(8, window.innerWidth - r.right),
        Math.max(8, window.innerWidth - menuW - 8));
      m.style.position = 'fixed';
      m.style.top = (r.bottom + 6) + 'px';
      m.style.right = right + 'px';
      m.style.left = 'auto';
    }
  };
  document.addEventListener('click', e => {
    if (!e.target.closest('#appsTopBtn') && !e.target.closest('#appsTopMenu')) {
      $('#appsTopMenu').hidden = true;
    }
  });
}

// top-bar 📨 Request menu — general requests, no piano required
const topReqBtn = $('#reqTopBtn');
if (topReqBtn) {
  topReqBtn.onclick = () => {
    const m = $('#reqTopMenu');
    m.hidden = !m.hidden;
    if (!m.hidden) {
      // pin under the button but clamp inside the viewport — on small
      // screens the button can sit far left, and a right-anchored 190px
      // menu would otherwise run off the left edge
      const r = topReqBtn.getBoundingClientRect();
      const menuW = Math.max(190, m.offsetWidth || 0);
      const right = Math.min(
        Math.max(8, window.innerWidth - r.right),
        Math.max(8, window.innerWidth - menuW - 8));
      m.style.position = 'fixed';
      m.style.top = (r.bottom + 6) + 'px';
      m.style.right = right + 'px';
      m.style.left = 'auto';
    }
  };
  document.addEventListener('click', e => {
    if (!e.target.closest('#reqTopBtn') && !e.target.closest('#reqTopMenu')) {
      $('#reqTopMenu').hidden = true;
    }
  });
  document.querySelectorAll('#reqTopMenu button').forEach(b => b.onclick = () => {
    $('#reqTopMenu').hidden = true;
    const kind = b.dataset.req;
    if (kind === 'curtis') openCurtisModal(null);
    else if (kind === 'admin') openAdminModal(null);
    else if (kind === 'touchup') openGenericModal(null, 'Touch Up');
    else if (kind === 'priority') openGenericModal(null, 'Priority Scheduling');
    else if (kind === 'brigham') openBrighamModal(null);
    else if (kind === 'tempspot') tempSpotModal();
    else if (kind === 'timeoff') timeOffModal();
    else if (kind === 'trainreq') trainReqModal();
    else if (kind === 'addpiano') openAddModal(null);
  });
}

let searchTimer = null;
/* ---------- search + type-ahead suggestions ---------- */
// Ranked so the thing you are most likely typing floats up: a serial you
// started keying beats a serial that merely contains those digits, which
// beats a year/make/model hit, which beats a loose summary match.
function searchRank(p, q) {
  const ser = String(p.serial || '').toLowerCase();
  const make = String(p.make || '').toLowerCase();
  const model = String(p.model || '').toLowerCase();
  const year = String(p.year || '').toLowerCase();
  const spot = String(p.location || '').toLowerCase();
  if (spot === q) return 0;
  if (ser === q) return 1;
  if (ser.startsWith(q)) return 2;
  if (ser.includes(q)) return 3;
  if (make.startsWith(q) || model.startsWith(q)) return 4;
  if (year.startsWith(q)) return 5;
  if (make.includes(q) || model.includes(q)) return 6;
  if (String(p.summary || '').toLowerCase().includes(q)) return 7;
  if (String(p.owner || '').toLowerCase().includes(q)) return 7.5;   // owner first/last name
  if (spot.startsWith(q)) return 8;
  return 99;
}
let acList = [], acIdx = -1;
function renderSuggest(q) {
  const box = $('#searchac');
  if (!box) return;
  if (q.length < 1) { box.hidden = true; acList = []; acIdx = -1; return; }
  acList = (S.data.pianos || [])
    .filter(p => p.active || p.archived)
    .map(p => ({p, r: searchRank(p, q) + (p.archived ? 0.5 : 0)}))
    .filter(x => x.r < 99)
    .sort((a, b) => a.r - b.r || String(a.p.summary).localeCompare(String(b.p.summary)))
    .slice(0, 8)
    .map(x => x.p);
  acIdx = -1;
  if (!acList.length) { box.hidden = true; return; }
  const hl = t => {
    const i = String(t).toLowerCase().indexOf(q);
    if (i < 0) return esc(t);
    return esc(String(t).slice(0, i)) + '<b>' + esc(String(t).slice(i, i + q.length))
      + '</b>' + esc(String(t).slice(i + q.length));
  };
  box.innerHTML = acList.map((p, i) => `<div class="acrow" data-i="${i}">
      <span class="acname">${hl(p.summary || [p.year, p.make, p.model].filter(Boolean).join(' '))}</span>
      <span class="acmeta">${p.serial ? '#' + hl(p.serial) : ''}
        <i>${p.archived ? '📦 delivered' : 'map ' + esc(p.location || '—')}</i></span>
    </div>`).join('');
  box.hidden = false;
  box.querySelectorAll('.acrow').forEach(el => {
    el.onmousedown = ev => { ev.preventDefault(); pickSuggest(+el.dataset.i); };
  });
}
function pickSuggest(i) {
  const p = acList[i];
  if (!p) return;
  $('#searchac').hidden = true;
  $('#search').value = p.summary || p.serial || '';
  S.search = $('#search').value;
  syncSearchClear();
  if (p.archived) { openArchived(p); return; }
  renderMap();
  focusPiano(p);
}
function moveSuggest(d) {
  const box = $('#searchac');
  if (box.hidden || !acList.length) return;
  acIdx = (acIdx + d + acList.length) % acList.length;
  box.querySelectorAll('.acrow').forEach((el, i) => el.classList.toggle('on', i === acIdx));
  const on = box.querySelector('.acrow.on');
  if (on) on.scrollIntoView({block: 'nearest'});
}
// one-tap ✕ clears the search instead of eight backspaces (Brigham 8/27)
const searchClearBtn = $('#searchClear');
function syncSearchClear() {
  if (searchClearBtn) searchClearBtn.hidden = !$('#search').value;
}
if (searchClearBtn) searchClearBtn.onclick = () => {
  const s = $('#search');
  s.value = ''; S.search = ''; S.focusRow = null;
  $('#searchac').hidden = true;
  syncSearchClear();
  renderMap();
  s.focus();
};
$('#search').addEventListener('input', e => {
  syncSearchClear();
  S.search = e.target.value;
  S.focusRow = null;
  if (S.view !== 'map') switchView('map');
  renderMap();
  const q = S.search.trim().toLowerCase();
  renderSuggest(q);
  clearTimeout(searchTimer);
  if (q.length < 2) return;
  searchTimer = setTimeout(() => {
    if (S.slotFloor.has(q)) { focusSpot(q); return; }      // exact spot #
    const hits = S.data.pianos.filter(p => p.active && matches(p, q));
    if (hits.length === 1) { focusPiano(hits[0]); return; }   // unique piano
    if (!hits.length) {   // maybe it's a delivered piano — jump to the archive
      const arch = S.data.pianos.filter(p => p.archived && matches(p, q));
      if (arch.length === 1) openArchived(arch[0]);
    }
  }, 450);
});
$('#search').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); }
  else if (e.key === 'Enter') {
    if (acIdx >= 0) { e.preventDefault(); pickSuggest(acIdx); }
    else if (acList.length === 1) { e.preventDefault(); pickSuggest(0); }
  } else if (e.key === 'Escape') { $('#searchac').hidden = true; }
});
$('#search').addEventListener('focus', () => renderSuggest(S.search.trim().toLowerCase()));
$('#search').addEventListener('blur', () => setTimeout(() => { $('#searchac').hidden = true; }, 120));

/* ---------- document-style zoom (scroll is native) ---------- */
function zoomAt(k, cx, cy) {
  const sc = $('#mapscroll');
  const r = sc.getBoundingClientRect();
  const prev = S.zoom;
  S.zoom = Math.min(8, Math.max(1, S.zoom * k));
  const real = S.zoom / prev;
  if (real === 1) return;
  const ox = (cx ?? r.left + r.width / 2) - r.left;
  const oy = (cy ?? r.top + r.height / 2) - r.top;
  const px = sc.scrollLeft + ox, py = sc.scrollTop + oy;
  sizePlan();
  sc.scrollLeft = px * real - ox;
  sc.scrollTop = py * real - oy;
}
/* Mobile: iOS ignores user-scalable=no, so pinching used to zoom the whole
 * PAGE and strand the header/hamburger off-screen. Block page zoom and
 * translate a pinch over the map into the map's own zoom instead. */
(() => {
  let gz = 1;
  document.addEventListener('gesturestart', e => { e.preventDefault(); gz = 1; }, {passive: false});
  document.addEventListener('gesturechange', e => {
    e.preventDefault();
    if (!e.target || !e.target.closest || !e.target.closest('#mapscroll')) return;
    const k = e.scale / gz;
    gz = e.scale;
    if (k && isFinite(k)) zoomAt(k, e.clientX, e.clientY);
  }, {passive: false});
  document.addEventListener('gestureend', e => e.preventDefault(), {passive: false});
})();
$('#zoomIn').onclick = () => zoomAt(1.4);
$('#zoomOut').onclick = () => zoomAt(1 / 1.4);
$('#zoomFit').onclick = () => { S.zoom = 1; sizePlan(); };
$('#mapscroll').addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;      // plain scroll stays native
  e.preventDefault();
  zoomAt(e.deltaY > 0 ? 1 / 1.18 : 1.18, e.clientX, e.clientY);
}, {passive: false});
$('#mapscroll').addEventListener('dblclick', e => {
  if (e.target.closest('.piano') || e.target.closest('.slot')) return;
  S.zoom = 1; sizePlan();
});

boot();
