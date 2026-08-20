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
  'Waiting on Brigham', 'Waiting on Curtis Harper', 'Waiting on OTHER'];
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
// "Sign in with Google" (identity for the activity log — who changed what).
// Public web client in karmel@'s "BLP Store Map" Google Cloud project;
// empty string hides the sign-in UI entirely.
const GOOGLE_CLIENT_ID = '110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com';
const PRICETAGS_URL = 'https://blppricetags.netlify.app/';
const SLOT_RE = /^\d+[a-zA-Z]?$/;
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
async function fetchData() {
  const r = await fetch('/api/data');
  if (!r.ok) throw new Error('api ' + r.status);
  return r.json();
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
  const dataP = fetchData().catch(() => null);
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
  setInterval(async () => {
    try {
      const [m, d2] = await Promise.all([fetchSlots(), fetchData()]);
      S.map = m; S.data = d2;
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
function tasksBox(p) {
  if (!p.serial || !trackKeysFor(p).length) return '';
  return `<div class="taskbox"><div class="taskhead">Concurrent tasks
      <span class="taskmsg"></span></div><div class="taskbody">loading…</div></div>`;
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
function gotoLine(p, effPh) {
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
  const hit = list => list.filter(r => r[2].includes(p.serial));
  const up = hit(t.upcoming || [])[0];
  const past = hit(t.past || []).pop();
  return {next: up ? {date: up[0], time: up[1]} : null,
          last: past ? past[0] : null};
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
          + p.year + ' ' + p.location).toLowerCase().includes(q);
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
window.addEventListener('hashchange', () => { deepLinkDone = ''; tryDeepLink(); });

/* ---------- rendering ---------- */
function renderAll() {
  renderTabs(); renderKpis(); renderCrew(); renderMoves();
  renderMap(); renderReport(); renderBoard(); renderCal(); renderMedia(); showView(S.view); syncFeed();
}

function renderTabs() {
  // narrow screens: "1st floor" / "2nd floor" to save space; wide: full name
  const short = window.innerWidth <= 760;
  $('#floorTabs').innerHTML = S.map.floors.map((f, i) => {
    const full = esc(f.name.replace(' floor', '')) + ' floor';
    const abbr = ['1st floor', '2nd floor', '3rd floor'][i] || full;
    return `<div class="${i === S.floor ? 'on' : ''}" data-f="${i}">${short ? abbr : full}</div>`;
  }).join('');
  $('#floorTabs').querySelectorAll('div').forEach(el =>
    el.onclick = () => { S.floor = +el.dataset.f;
      if (S.view !== 'map') switchView('map');
      renderMap(); renderTabs(); $('#mapscroll').scrollTop = 0; });
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
  $('#kpis').innerHTML = `
    <div class="kpi"><span class="n">${total}</span><span class="l">TOTAL PIANOS</span></div>
    <div class="kpi click" id="kpiF1"><span class="n">${placed(0)}</span><span class="l">1ST FLOOR →</span></div>
    <div class="kpi click" id="kpiF2"><span class="n">${placed(1)}</span><span class="l">2ND FLOOR →</span></div>
    <div class="kpi"><span class="n">${own.blp}<small> / ${own.csgn} / ${own.client}</small></span><span class="l">BLP / CONSIGN / CLIENT</span></div>
    <div class="kpi"><span class="n">${tm}</span><span class="l">MOVES TODAY</span></div>
    <div class="kpi click" id="kpiNew"><span class="n">${newWeek}</span><span class="l">NEW THIS WEEK →</span></div>
    <div class="kpi click" id="kpiMedia"><span class="n">${mediaCount} 📷</span><span class="l">MEDIA NEEDED →</span></div>
    <div class="kpi red" id="kpiReport"><span class="n">${un} <small>+ ${du} dup</small></span><span class="l">UNPLACED / ERRORS →</span></div>`;
  $('#kpiReport').onclick = () => switchView('report');
  $('#kpiMedia').onclick = () => switchView('media');
  $('#kpiF1').onclick = () => gotoFloor(0);
  $('#kpiF2').onclick = () => gotoFloor(1);
  $('#kpiNew').onclick = () => {
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
  const fi = placed ? S.slotFloor.get(p.location.toLowerCase())
    : inBin ? floorForBin(inBin)
    : (comingSoon(p) || outForService(p)) ? 0   // front-door/parking-lot zones live on floor 0
    : 1;                   // attic/rented live on floor 1
  if (fi !== S.floor) { S.floor = fi; renderTabs(); }
  renderMap();
  const f = S.map.floors[S.floor];
  const sl = placed ? f.slots.find(x => x.id.toLowerCase() === p.location.toLowerCase()) : null;
  const target = sl ? {x: sl.x + sl.w / 2, y: sl.y + sl.h / 2}
    : (S.binXY || {})[p.row] || (S.rentXY || {})[p.row] || (S.comingXY || {})[p.row] || (S.serviceXY || {})[p.row] || (S.holdingXY || {})[p.row];
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
    ? evs.map(e => `<div class="tmv">
        <span>TODAY · ${e.time || 'ALL DAY'}</span>
        <b>${esc(e.summary)}</b></div>`).join('')
    : '<div class="tmv none">No moves on today’s calendar.</div>';
  const fr = $('#calFrame');
  if (!fr.src) fr.src = CAL_EMBED;
}

function renderMoves() {
  const evs = todaysMoves();
  $('#moves').innerHTML = evs.length ? evs.map(e => `
    <div class="mv">
      <b>${esc(e.summary)}</b>
      <span>${e.time || 'all day'}</span>
    </div>`).join('') : '<div class="empty">No moves on today’s calendar.</div>';
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
    <div class="mdmsg"></div>
  </div>`;
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
           : `<button class="pwadd" data-k="${k}">＋ attach</button>`}
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
    if (ev.target === ov || ev.target.classList.contains('tvx')) ov.remove();
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
    <div class="rail"><span>SERIAL # ${esc(d.serial)}</span></div>
    <div class="main">
      <div class="id"><img src="${logo}" alt="Brigham Larson Pianos">
        <div class="nm"><h1>${esc(d.h1)}</h1><div class="sub">${esc(d.sub || '\u2014')}</div></div></div>
      <div class="rows">
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
    .sheet { width: 8.2in; margin: 0 auto; padding: 14px 0; }
    .tag { width: 8.06in; height: 5.02in; background: #fff; display: flex; overflow: hidden;
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
    @media print {
      body { background: #fff; }
      .bar { display: none; }
      .sheet { width: auto; margin: 0; padding: 0; }
      .tag { box-shadow: none; }
      .cut { display: flex; }
      .copy2 { display: flex; }
    }
  </style></head><body>
    <div class="bar"><b>Shop tag</b> — click any field to edit, tap 1·2·3 to set the refinishing level
      <button onclick="doPrint()">🖨 Print — 2 per page</button></div>
    <div class="sheet">${tag}<div class="cut">✂ cut</div>${tag.replace('class="tag"', 'class="tag copy2"')}</div>
    <script>
      const t1 = document.querySelectorAll('.tag')[0], t2 = document.querySelectorAll('.tag')[1];
      const sync = () => { t2.innerHTML = t1.innerHTML; };
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
        if (b) b.textContent = '🖨 Print — 2 per page';
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
                data-row="${p.row}">${glyph(p.type, cx, cy, sc)}${phaseText(p, cx, cy, sc)}${mediaBadge(p, cx, cy, sc)}${finBadge(p, cx, cy, sc)}${soldBadge(p, cx, cy, sc)}${ghostBadge(p, cx, cy, sc)}</g>`;
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
              data-row="${p.row}">${glyph(p.type, cx, cy, bSc)}${phaseText(p, cx, cy, bSc)}${mediaBadge(p, cx, cy, bSc)}${finBadge(p, cx, cy, bSc)}</g>`;
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
              data-row="${p.row}">${glyph(p.type, cx, cy, sc)}${phaseText(p, cx, cy, sc)}${mediaBadge(p, cx, cy, sc)}${finBadge(p, cx, cy, sc)}${soldBadge(p, cx, cy, sc)}${ghostBadge(p, cx, cy, sc)}</g>`;
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
                <g transform="rotate(90 ${cx} ${cy})">${glyph(p.type, cx, cy, sc)}</g>${phaseText(p, cx, cy, sc)}${mediaBadge(p, cx, cy, sc)}${priceText(p, cx, cy, sc)}${finBadge(p, cx, cy, sc)}${soldBadge(p, cx, cy, sc)}${ghostBadge(p, cx, cy, sc)}</g>`;
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
                data-slot="${esc(sl.id)}" data-row="${p.row}">${glyph(p.type, cx, cy, sc)}${phaseText(p, cx, cy, sc)}${mediaBadge(p, cx, cy, sc)}${priceText(p, cx, cy, sc)}${finBadge(p, cx, cy, sc)}${soldBadge(p, cx, cy, sc)}${ghostBadge(p, cx, cy, sc)}</g>`;
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
  // ---- OUT FOR SERVICE zone (1st floor): pianos out at an external tech's
  // shop, parked in the same front-door/parking-lot area, just below
  // Coming Soon
  S.serviceXY = {};
  if (S.floor === 0) {
    const ofl = outForServicePianos();
    if (ofl.length) {
      const SZ = {x: 1480, y: csnBottom + 16, x2: 2020};
      const szw = SZ.x2 - SZ.x;
      const shH = 34, nameH = 26;
      const sLay = bigIconLayout(szw - 12);
      const scols = sLay.cols, ssc = sLay.sc, sch = sLay.pitch + nameH;
      const srows = Math.ceil(ofl.length / scols);
      const szh = shH + srows * sch + 10;
      s += `<rect x="${SZ.x}" y="${SZ.y}" width="${szw}" height="${szh}" rx="8" class="ofszone"/>`;
      s += `<text x="${SZ.x + szw / 2}" y="${SZ.y + 24}" text-anchor="middle" class="ofstitle" font-size="16">OUT FOR SERVICE (${ofl.length})</text>`;
      const scw = szw / scols;
      ofl.forEach((p, idx) => {
        const cx0 = SZ.x + (idx % scols) * scw;
        const cy0 = SZ.y + shH + Math.floor(idx / scols) * sch;
        const cx = cx0 + scw / 2;
        const hl = S.focusRow === p.row || (q && matches(p, q));
        const dim = q && !matches(p, q);
        const nm = (p.year ? p.year + ' ' : '')
          + ([p.make, p.model].filter(Boolean).join(' ') || p.summary || '');
        const nameLines = wrapCap(nm, scw - 8, 9, 1);
        const iconCy = cy0 + (sch - nameH) / 2;
        S.serviceXY[p.row] = {x: cx, y: cy0 + sch / 2};
        s += `<g class="piano own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
              data-row="${p.row}">${glyph(p.type, cx, iconCy, ssc)}</g>`;
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
              data-row="${p.row}">${glyph(p.type, cx, iconCy, sc)}${phaseText(p, cx, iconCy, sc)}${mediaBadge(p, cx, iconCy, sc)}${finBadge(p, cx, iconCy, sc)}${soldBadge(p, cx, iconCy, sc)}${ghostBadge(p, cx, iconCy, sc)}</g>`;
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
  S.drawW = drawW; S.drawH = drawH;

  const svg = $('#plan');
  svg.innerHTML = s;
  svg.querySelectorAll('.cabunitbox, .cabunitnum, .cabcntc, .cabcnt2').forEach(el =>
    el.addEventListener('click', ev => { ev.stopPropagation(); openCabUnitModal(el.dataset.unit); }));
  sizePlan();
  svg.querySelectorAll('.piano').forEach(el => {
    el.addEventListener('click', ev => { ev.stopPropagation(); openPop(+el.dataset.row, el, true); });
    el.addEventListener('mouseenter', () => openPop(+el.dataset.row, el, false));
    el.addEventListener('mouseleave', scheduleHide);
  });
  svg.querySelectorAll('.holdcell[data-row]').forEach(el => {
    el.addEventListener('click', () => openPop(+el.dataset.row, el, true));
    el.addEventListener('mouseenter', () => openPop(+el.dataset.row, el, false));
    el.addEventListener('mouseleave', scheduleHide);
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
        <button class="sgt on" data-t="bug">🐛 Bug</button>
        <button class="sgt" data-t="edit">✏️ Edit</button>
        <button class="sgt" data-t="idea">💡 Idea</button>
      </div>
      <textarea class="sgtext" maxlength="1500" placeholder="What's wrong / what would make it better? A sentence or two is plenty."></textarea>
      <div class="sgrow">
        <label class="sgshot">📷 Attach screenshot<input type="file" accept="image/*" hidden></label>
        <span class="sgshotname"></span>
        <button class="sgsend">Send it 🚀</button>
      </div>
      <div class="sgmsg"></div>
    </div>
    <div class="sgmine"><b>My requests</b><div class="sgminelist">loading…</div></div>
  </div>`;
  document.body.appendChild(ov);
  ov.onclick = ev => { if (ev.target === ov || ev.target.classList.contains('tvx')) ov.remove(); };
  let type = 'bug', shotFile = null;
  ov.querySelectorAll('.sgt').forEach(b => b.onclick = () => {
    ov.querySelectorAll('.sgt').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); type = b.dataset.t;
  });
  const fin = ov.querySelector('.sgshot input');
  fin.onchange = () => {
    shotFile = fin.files && fin.files[0];
    ov.querySelector('.sgshotname').textContent = shotFile ? shotFile.name.slice(0, 22) : '';
  };
  const msg = ov.querySelector('.sgmsg');
  ov.querySelector('.sgsend').onclick = async () => {
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
    msg.className = 'sgmsg'; msg.textContent = shotFile ? 'Uploading screenshot…' : 'Sending…';
    const body = {pin, action: 'suggest', type, text,
      context: 'view:' + (S.view || 'map') + (openSerial ? ' · piano #' + openSerial : ''),
      ...authFields()};
    try {
      if (shotFile) {
        const dataUrl = await downscalePhoto(shotFile, 1600, 0.85);
        body.photo = dataUrl.split(',')[1]; body.photoType = 'image/jpeg';
        body.photoName = shotFile.name.replace(/[^\w.-]+/g, '_').slice(0, 40);
      }
      const r = await fetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'}, body: JSON.stringify(body)});
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'failed');
      msg.className = 'sgmsg ok';
      msg.textContent = '✓ Filed as ' + j.id + ' — thank you! You\u2019ll see it move to Live here when it ships.';
      ov.querySelector('.sgtext').value = ''; shotFile = null; fin.value = '';
      ov.querySelector('.sgshotname').textContent = '';
      loadMyRequests(ov);
    } catch (e) { msg.className = 'sgmsg err'; msg.textContent = '✗ ' + e.message; }
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
      <span class="sgtxt">${ICONS[x.type] || '💡'} ${esc(x.text.slice(0, 70))}</span>
      ${x.status === 'Live' ? `<button class="sgok" data-id="${esc(x.id)}">✅ It works</button>` : ''}
    </div>`).join('');
    box.querySelectorAll('.sgok').forEach(b => b.onclick = async () => {
      const {pin, ok} = writeAuth(); if (!ok) return;
      b.textContent = '…';
      await fetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin, action: 'requeststatus', id: b.dataset.id, status: 'Tested', ...authFields()})});
      loadMyRequests(ov);
    });
  } catch (e) { box.innerHTML = '<i>couldn\u2019t load</i>'; }
}
setTimeout(() => {
  const btn = document.getElementById('suggestBtn');
  if (btn) btn.onclick = openSuggestBox;
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
async function punch(action, p, phase, source, endAt) {
  const {pin, ok} = writeAuth();
  if (!ok) return {error: 'Sign in first — hours are logged under your name.'};
  const body = {pin, action, source: source || 'card', ...authFields()};
  if (p) { body.serial = p.serial; body.row = p.row; body.phase = phase || ''; }
  if (endAt) body.endAt = endAt;
  try {
    const r = await fetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'}, body: JSON.stringify(body)});
    const j = await r.json();
    if (j.ok) {
      CLOCK.open = action === 'clockin'
        ? (j.open || {tech: clockName(), serial: p.serial, phase, start: new Date().toISOString()})
        : null;
      CLOCK.nudged = false; CLOCK.lastAct = Date.now();
      renderClockChip(); renderDock();
    }
    return j;
  } catch (e) { return {error: 'offline — punch not recorded, try again'}; }
}
function renderClockChip() {
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
function renderDock() {
  let dock = document.getElementById('mydock');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'mydock'; dock.hidden = true;
    document.body.appendChild(dock);
  }
  const o = CLOCK.open;
  if (!o) { dock.hidden = true; return; }
  const recents = (S.recentRows || []).map(r => S.data.pianos.find(x => x.row === r))
    .filter(x => x && x.serial && x.serial !== o.serial).slice(0, 4);
  dock.hidden = false;
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
    </div>
    <div class="dockmenu" hidden>
      ${recents.map(x => `<div class="dockopt" data-row="${x.row}">📌 ${esc(x.summary.slice(0, 34))} · #${esc(x.serial)}</div>`).join('')}
      <div class="dockopt dockfind">🔍 Find a piano on the map…</div>
    </div>`;
  const menu = dock.querySelector('.dockmenu');
  dock.querySelector('.dockswitch').onclick = () => { menu.hidden = !menu.hidden; };
  dock.querySelector('.dockout').onclick = async () => {
    const j = await punch('clockout', null, '', 'dock');
    if (j.error) alert(j.error);
  };
  menu.querySelectorAll('.dockopt[data-row]').forEach(el => el.onclick = () => {
    menu.hidden = true;
    const p = S.data.pianos.find(x => x.row === +el.dataset.row);
    if (p) { focusPiano(p); lsSet('sec_clock', 'open'); }
  });
  const df = menu.querySelector('.dockfind');
  if (df) df.onclick = () => { menu.hidden = true; const q = document.querySelector('.search'); if (q) q.focus(); };
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
       <input type="file" class="photoin" accept="image/*" capture="environment" hidden>
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
           ${phaseOptions(p, effPh).map((ph, i) =>
             `<option value="${esc(ph)}" ${effPh === ph ? 'selected' : ''}>${i + 1} · ${esc(ph)}</option>`).join('')}
           ${PHASE_STATES.map(ph =>
             `<option value="${esc(ph)}" ${effPh === ph ? 'selected' : ''}>${esc(ph)}</option>`).join('')}
         </select></div>${gotoLine(p, effPh)}<div class="phmsg"></div>`
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
    <span class="tag ${st}">${tags[st]}</span>
    <h3>${esc(makeModel)}</h3>
    <div class="row rowflex"><span>Serial # <b>${esc(p.serial || '—')}</b></span>${typeBtns}</div>
    <div class="typemsg phmsg"></div>
    ${preQueue(p) ? `<div class="pqwarn">⚠️ <b>PRE-QUEUE</b> — deposit not received. No work is approved on this piano yet.
      ${isAdminUser() ? `<button class="pqapprove">✅ Approve for queue</button>` : `<i>admin / manager approval required to start work</i>`}
      <span class="pqmsg"></span></div>` : ''}
    </div>
    <div class="row">Owner <b>${esc(ownerLine)}</b></div>
    <div class="row">Status <b>${esc(p.status || '—')}</b></div>
    ${effectivePhase(p) === 'For Sale'
      ? `<div class="row rowflex"><span>Price <b class="pricecard">${priceLabel(p) ? esc(priceLabel(p)) : '—'}</b></span>
           ${p.serial ? `<button class="predit">${p.price ? '✎ Edit price' : '＋ Add price'}</button>` : ''}</div>`
      : (priceLabel(p) ? `<div class="row">Price <b class="pricecard">${esc(priceLabel(p))}</b></div>` : '')}

    ${p.serial ? (() => {
      const mine = CLOCK.open;
      const onThis = mine && mine.serial === p.serial;
      if (onThis) return secWrap('clock', '⏱ Work Clock', `
        <div class="row rowflex"><span>Working on</span><b>${esc(mine.phase || '—')}</b></div>
        <button class="clkbtn clkout">■ Clock out — <span class="cctime" data-start="${esc(mine.start)}">${clockElapsed(mine.start)}</span></button>
        <div class="clkmsg phmsg"></div>`);
      const opts = (pianoPhases(p) || PHASES).concat(PHASE_STATES);
      return secWrap('clock', '⏱ Work Clock', `
        ${mine ? `<div class="clkwarn">⏱ You're on <b>#${esc(mine.serial)}</b>
          <span class="cctime" data-start="${esc(mine.start)}">${clockElapsed(mine.start)}</span> — clocking in here closes it.</div>` : ''}
        <div class="row rowflex"><span>What work?</span>
          <select class="clkphase">
            <option value="">— select the work —</option>
            ${opts.map(ph => `<option>${esc(ph)}</option>`).join('')}
            <option value="__other__">✏️ Other — write it in…</option>
          </select></div>
        <input class="clkother" placeholder="what are you doing on this piano?" maxlength="60" hidden>
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
        </span></div><div class="cabmsg phmsg"></div>` : ''}`)}

    ${(body => p.serial ? secWrap('shop', '🔨 Shop Progress', body) : body)(`
    ${tracker}
    ${p.serial ? `<div class="row trkrow" title="key-top service — tap each that applies">Keys
        <span class="trkchips">${KEY_SERVICE.map(t =>
          `<button class="trk keybtn ${keyTokens(p).includes(t) ? 'on' : ''}" data-k="${t}">${esc(t)}</button>`).join('')}
        </span></div><div class="keymsg phmsg"></div>` : ''}
    ${phaser}
    ${p.serial ? (() => {
      const dl = (p.phasesDone || '').split(',').map(t => t.trim()).filter(Boolean);
      return `<div class="row trkrow" title="phases already completed — tap to toggle">Done
        <span class="trkchips">${(pianoPhases(p) || PHASES).filter(ph => ph !== 'Delivered').map((ph, i) =>
          `<button class="trk dn ${dl.includes(ph) ? 'on' : ''}" data-ph="${esc(ph)}" title="${esc(ph)}">${i + 1}${dl.includes(ph) ? '✓' : ''}</button>`).join('')}
        </span></div><div class="dnmsg phmsg"></div>`;
    })() : ''}
    ${tasksBox(p)}
    ${(p.phase || '').startsWith('Waiting') ? `<div class="row waitnote">Waiting on
        <b>${esc(p.waitNote || p.phase.replace('Waiting on ', ''))}</b>
        ${p.checkBack ? `<span class="wncb">· check back <b class="snzcur">${esc(p.checkBack)}</b></span>` : ''}
      </div>
      ${p.serial ? `<div class="row rowflex snzrow"><span class="snzlbl">${p.checkBack ? 'Re-snooze' : 'Check back in'}</span>
        <span class="snzbtns"><button class="snz" data-d="3">+3d</button><button class="snz" data-d="7">+1w</button><button class="snz" data-d="14">+2w</button><button class="snz" data-d="30">+1m</button></span>
      </div><div class="snzmsg phmsg"></div>` : ''}` : ''}
    ${p.serial ? `<div class="tagbtns histbtns"><button class="tagbtn rreports">📄 Tech Reports History</button></div>` : ''}`)}

    ${(body => p.serial ? secWrap('media', '📷 Media', body) : body)(`
    ${mediaCard(p)}
    ${photo}`)}

    ${p.serial ? secWrap('pw', '📁 Paperwork', paperworkCard(p)) : ''}

    ${admin}

    <div class="row" style="margin-top:10px">Last tuned <b>${ti.last ? esc(fmtDayYear(ti.last)) : '—'}</b></div>
    ${ti.next ? `<div class="row">Tuning scheduled <b class="tunesched">🎵 ${esc(fmtDay(ti.next.date))} · ${esc(ti.next.time)}</b></div>` : ''}
    ${p.serial ? `<button class="tunebtn reqbtn">📨 Request… ▾</button>
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
        <button data-req="dup" class="reqdanger">🗑 Mark as Duplicate</button>
      </div>` : ''}
    <div class="tagbtns">
      ${priceLabel(p) ? `<a class="tagbtn" target="_blank" rel="noopener"
        href="${priceTagUrl(p)}">🏷 Price tag ↗</a>` : ''}
      ${p.serial ? `<button class="tagbtn shoptag">🖨 Shop tag</button>` : ''}
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
    ${secWrap('log', '📖 Piano Log', logExtrasBody(p), false)}`;
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
    if (ev.target.classList.contains('x')) { pop.hidden = true; popPinned = false; return; }
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
  pop.querySelectorAll('.cabdel').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    saveCabinetry(p, cabTokens(p).filter(t => t !== b.dataset.t), pop);
  });
  pop.querySelectorAll('.trk.dn').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    toggleDone(p, b.dataset.ph, pop);
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
  if (st) st.onclick = ev => { ev.stopPropagation(); printShopTag(p); };
  const dt = pop.querySelector('.dtech');
  if (dt) dt.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); openTechFolder(dt.dataset.serial, dt); };
  const tt = pop.querySelector('.tagthumb');
  if (tt) tt.onclick = ev => { ev.stopPropagation(); openTagSnapshot(p); };
  (() => {   // Work Clock wiring: phase is mandatory, "Other" allows write-in
    const sel = pop.querySelector('.clkphase');
    const oth = pop.querySelector('.clkother');
    const inBtn = pop.querySelector('.clkin');
    const outBtn = pop.querySelector('.clkout');
    const cmsg = pop.querySelector('.clkmsg');
    const chosen = () => {
      if (!sel) return '';
      if (sel.value === '__other__') return (oth.value || '').trim();
      return sel.value;
    };
    const refresh = () => {
      if (!inBtn) return;
      if (oth) oth.hidden = sel.value !== '__other__';
      inBtn.classList.toggle('off', !chosen());
    };
    if (sel) { sel.onchange = () => { refresh(); if (sel.value === '__other__' && oth) oth.focus(); }; sel.onclick = ev => ev.stopPropagation(); }
    if (oth) { oth.oninput = refresh; oth.onclick = ev => ev.stopPropagation(); }
    if (inBtn) inBtn.onclick = async ev => {
      ev.stopPropagation(); popPinned = true;
      if (preQueue(p) && !isAdminUser()) {
        alert('🚫 This piano is PRE-QUEUE \u2014 the deposit hasn\u2019t been received, so no work can start yet. Ask a manager.');
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
      cmsg.className = 'clkmsg phmsg'; cmsg.textContent = 'Clocking in\u2026';
      const j = await punch('clockin', p, ph, S.scanArrived === p.serial ? 'scan' : 'card');
      if (j.error) { cmsg.className = 'clkmsg phmsg err'; cmsg.textContent = '\u2717 ' + j.error; return; }
      S.scanArrived = null;
      openPop(p.row, S.popAnchor, true);
    };
    if (outBtn) outBtn.onclick = async ev => {
      ev.stopPropagation(); popPinned = true;
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
      const r = await fetch(BRIDGE_URL, {method: 'POST', redirect: 'follow',
        headers: {'content-type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({pin, action: 'prequeueapprove', serial: p.serial, row: p.row, ...authFields()})});
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'failed');
      p.status = j.status;   // optimistic: banner + ghost drop immediately
      renderMap();
      openPop(p.row, S.popAnchor, true);
    } catch (e) { if (pqm) pqm.textContent = ' ✗ ' + e.message; }
  };
  const pws = pop.querySelector('.pwscan');
  if (pws) pws.onclick = ev => { ev.stopPropagation(); popPinned = true; scanPaperwork(p, pop); };
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

async function setPhase(p, phase, pop, extra) {
  const msg = pop.querySelector('.phmsg');
  const sel = pop.querySelector('.phsel');
  const was = p.phase || '';
  if (phase === was) return;
  if (phase.startsWith('Waiting') && extra == null) {
    openWaitNoteModal(p, phase, pop);   // ask for details + check-back first
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
  ov.innerHTML = `<div class="tmcard">
    <span class="x">✕</span>
    <h3>＋ Add a Piano — Spot ${esc(slotId)}</h3>
    <label>Serial number <small>(required)</small></label>
    <input class="adserial" maxlength="20" list="serialList" placeholder="e.g. 546310"${''}
      value="${esc(prefillSerial || '')}">
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
    <label>Owner</label>
    <input class="adowner" maxlength="60" value="BLP">
    <button class="adgo">Add to the Piano Log at spot ${esc(slotId)}</button>
    <div class="tmmsg admsg"></div>
  </div>`;
  ov.hidden = false;
  ov.onclick = ev => {
    if (ev.target === ov || ev.target.classList.contains('x')) ov.hidden = true;
  };
  serialDatalist();
  ov.querySelector('.adgo').onclick = () => submitAdd(slotId, ov);
  ov.querySelector('.adserial').focus();
}
async function submitAdd(slotId, ov) {
  const msg = ov.querySelector('.admsg');
  const btn = ov.querySelector('.adgo');
  const v = c => ov.querySelector(c).value.trim();
  const serial = v('.adserial');
  if (!serial) { msg.className = 'tmmsg err'; msg.textContent = 'A serial number is required.'; return; }
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in with Google (☰ menu) to make changes — actions are logged under your name.'; return; }
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = 'Adding to the Piano Log…';
  const fields = {serial, year: v('.adyear'), make: v('.admake'), model: v('.admodel'),
                  category: v('.adtype'), owner: v('.adowner') || 'BLP', location: slotId};
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
    msg.textContent = `✓ Added to the Piano Log (row ${j.row}) at spot ${slotId}.`;
    applyBumps(j.bumped);
    const nu = {row: j.row, section: '', owner: fields.owner, serial,
      summary: j.summary, year: fields.year, make: fields.make, model: fields.model,
      size: '', type: fields.category.toLowerCase(), status: '', location: slotId,
      isSlot: SLOT_RE.test(slotId), entered: localDay(),
      phase: 'New Arrival - Admin', price: '', bphoto: false, aphoto: false,
      bvideo: false, avideo: false, queuePos: 0, queueTotal: 0,
      isNew: true, active: true};
    pendingAdds.push(nu);
    applyAdds(); index(); renderAll();
    setTimeout(() => { ov.hidden = true; focusPiano(nu); }, 1600);
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
    if (ev.target === ov || ev.target.classList.contains('x')) ov.hidden = true;
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
    if (ev.target === ov || ev.target.classList.contains('x')) {
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
    msg.textContent = '✓ Price request emailed to Brigham.';
    setTimeout(() => { ov.hidden = true; }, 1800);
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
    if (ev.target === ov || ev.target.classList.contains('x')) ov.hidden = true;
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
function onGoogleCred(resp) {
  try {
    const claims = JSON.parse(atob(resp.credential.split('.')[1]
      .replace(/-/g, '+').replace(/_/g, '/')));
    lsSet('blpUser', JSON.stringify({
      tok: resp.credential, exp: claims.exp,
      name: claims.name || claims.email, email: claims.email, pic: claims.picture || '',
    }));
  } catch (e) { /* malformed credential — stay signed out */ }
  renderAuth();
}
function signOut() {
  lsDel('blpUser');
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  renderAuth();
}
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
      gb.querySelector('.goauth').onclick = oidcLogin;
    }
  }
}
function renderAuth() {
  authGate();
  // top-bar identity chip — who's signed in, always visible
  const tw = $('#topWho');
  if (tw && !tw.dataset.wired) {
    tw.dataset.wired = '1';
    // tap your name to sign out — the shared-device flow: gate comes back
    // for the next person, and everything they do is logged under THEIR name
    tw.onclick = () => {
      const u = authUser();
      if (!u) return;
      if (confirm('Sign out ' + (u.name || 'this user') + '?\n\nThe sign-in screen comes back so the next person can log in as themselves.')) {
        signOut();
      }
    };
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
    $('#gsiBtn').querySelector('.goauth').onclick = oidcLogin;
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
    $('#gsiBtn').querySelector('.goauth').onclick = oidcLogin;
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

async function movePiano(p, dest, pop) {
  const msg = pop.querySelector('.mvmsg');
  if (!dest) { msg.textContent = 'Type a spot number or area name first.'; return; }
  if (!isValidDest(dest)) {
    msg.textContent = '\u201c' + dest + '\u201d isn\u2019t a spot on the map \u2014 pick one from the suggestion list.';
    return;
  }
  const known = S.slotFloor.has(dest.toLowerCase());
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
      if (ev.target.classList.contains('x')) { pop.hidden = true; popPinned = false; } };
  } else {
    pop.innerHTML = `<span class="x">✕</span>
      <span class="tag">SPOT ${esc(id)}</span><h3>Empty</h3>
      <div class="row">No piano assigned in the Piano Log.</div>
      <button class="tagbtn addhere">＋ Put a piano here</button>`;
    pop.onclick = ev => {
      if (ev.target.classList.contains('x')) { pop.hidden = true; popPinned = false; return; }
      if (ev.target.classList.contains('addhere')) { pop.hidden = true; openAssignModal(id); } };
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
function activityTable(rows) {
  if (!rows) return '<div class="empty">Loading the activity log…</div>';
  return `<table><tr><th>WHEN</th><th>WHO</th><th>ACTION</th><th>PIANO</th><th>DETAILS</th></tr>` +
    (rows.map(r => `<tr><td style="white-space:nowrap">${esc(r[0])}</td><td>${esc(r[1])}</td>
      <td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td></tr>`).join('')
     || '<tr><td colspan="5" class="empty">No activity yet — changes made in the map will appear here.</td></tr>') + '</table>';
}

const REPORT_DEFS = () => [
  {id: 'unplaced', icon: '⚠️', title: 'UNPLACED PIANOS', count: unplaced().length,
   desc: 'Active pianos whose Piano Log location (column U) is empty or doesn’t match any spot or known area.',
   html: unplacedTable},
  {id: 'dups', icon: '🔁', title: 'DUPLICATE SPOT NUMBERS', count: duplicates().length,
   desc: 'Two or more active pianos claim the same map spot — one of them is wrong.',
   html: dupTable},
  {id: 'stage', icon: '🔧', title: 'MISSING SHOP STAGE', count: missingStage().length,
   desc: 'Pianos in the Custom Shopwork section missing a CURRENT PHASE or TRACK — storage, rentals, financing, and other non-shopwork sections are exempt. Click a row to jump to the piano.',
   html: missingStageTable},
  {id: 'media', icon: '📸', title: 'MEDIA NEEDED', count: S.data.pianos.filter(p =>
     p.active && !notYetArrived(p) && (mediaNeeds(p).photo || mediaNeeds(p).video)).length,
   desc: 'Before photos/video for every arrived piano; after photos/video once it reaches Tuning or later. Pianos that haven\'t arrived yet join once they\'re here.',
   html: mediaTable},
  {id: 'cabinetry', icon: '🗄', title: 'CABINETRY', count: S.data.pianos.filter(p =>
     p.active && cabTokens(p).length).length,
   desc: 'Which Cabinetry Storage shelves hold each piano\'s stripped cabinetry and hardware. Assign from the piano card (Cabinetry → ＋ shelf); click a unit box on the map for one unit\'s contents.',
   html: cabinetryTable},
  {id: 'duplicates', icon: '🗑', title: 'MARKED DUPLICATES', count: duplicateMarkedPianos().length,
   desc: 'Rows marked "Mark as Duplicate" from a piano card — hidden from the map/reports but never deleted. Restore one here if it was flagged by mistake.',
   html: duplicatesTable},
  {id: 'waiting', icon: '⏳', title: 'WAITING ON', count: waitingPianos().length,
   desc: 'Every piano parked in a Waiting phase — what it’s waiting on, and when to check whether the wait is over (set with the card’s +3d/+1w/+2w/+1m snooze buttons). Overdue or dateless waits show in red.',
   html: waitingTable},
  {id: 'activity', icon: '📝', title: 'ACTIVITY LOG', count: null,
   desc: 'Who changed what — every move, phase change, media checkoff, and tuning request made through the map.',
   html: () => activityTable(S.activityRows)},
];

function renderReport() {
  const body = $('#reportsBody');
  if (!body) return;
  const open = S.openReport;
  body.innerHTML = REPORT_DEFS().map(r => `
    <div class="rpt ${open === r.id ? 'open' : ''}" data-r="${r.id}">
      <button class="rptbtn">
        <span class="ric">${r.icon}</span><span class="rtitle">${r.title}</span>
        ${r.count != null ? `<span class="pc ${r.count ? '' : 'zero'}">${r.count}</span>` : ''}
        <span class="chev">${open === r.id ? '▾' : '▸'}</span>
      </button>
      <div class="rptbody" ${open === r.id ? '' : 'hidden'}>
        <div class="rpthead"><p class="pd">${r.desc}</p>
          <button class="printbtn" data-r="${r.id}">🖨 Print</button></div>
        <div class="tscroll">${open === r.id ? r.html() : ''}</div>
      </div>
    </div>`).join('');
  body.querySelectorAll('.rptbtn').forEach(b => b.onclick = () => {
    const id = b.closest('.rpt').dataset.r;
    S.openReport = S.openReport === id ? null : id;
    if (S.openReport === 'activity' && !S.activityRows) loadActivity();
    renderReport();
  });
  body.querySelectorAll('.printbtn').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const def = REPORT_DEFS().find(r => r.id === b.dataset.r);
    printReport(def.icon + ' ' + def.title, def.html());
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

/* ---------- views / nav / drawers ---------- */
function showView(v) {
  ['map', 'report', 'board', 'cal', 'media', 'shopmap'].forEach(x => $('#view-' + x).hidden = x !== v);
  document.querySelectorAll('.navitem[data-view]').forEach(el =>
    el.classList.toggle('on', el.dataset.view === v));
  if (v === 'shopmap') renderShopMap();
}
function switchView(v) { S.view = v; showView(v); closeNav(); }
document.querySelectorAll('.navitem[data-view]').forEach(el =>
  el.onclick = () => switchView(el.dataset.view));

// every non-map view gets a ✕ back to the map (Escape works too)
['report', 'board', 'cal', 'media', 'shopmap'].forEach(v => {
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

$('#legendBtn').onclick = () => { const p = $('#legendPanel'); p.hidden = !p.hidden; };

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
  if (spot.startsWith(q)) return 8;
  return 99;
}
let acList = [], acIdx = -1;
function renderSuggest(q) {
  const box = $('#searchac');
  if (!box) return;
  if (q.length < 1) { box.hidden = true; acList = []; acIdx = -1; return; }
  acList = (S.data.pianos || [])
    .filter(p => p.active)
    .map(p => ({p, r: searchRank(p, q)}))
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
        <i>map ${esc(p.location || '—')}</i></span>
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
$('#search').addEventListener('input', e => {
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
    if (hits.length === 1) focusPiano(hits[0]);            // unique piano
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
