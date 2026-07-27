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
const TRACKS = ['Rebuild', 'Hybrid', 'Refurbish', 'Refinish', 'Technology', 'Old Player', 'Misc'];   // unnumbered states; For Sale turns the icon green
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

// pianos parked in a named work area are drawn INSIDE that zone on the map
// (not in the holding grid). location text -> map zone label to place them in.
const AREA_BINS = [
  {test: l => l.includes('refinish'), zones: ['refinishing shop', 'refinishing room']},
  {test: l => l.includes('sanding'), zones: ['sanding shop', 'back shop', 'sanding room']},
];
// which bin (if any) a piano's location assigns it to
function areaBinFor(p) {
  if (p.isSlot && S.slotFloor.has((p.location || '').toLowerCase())) return null;
  const l = (p.location || '').toLowerCase();
  return AREA_BINS.find(b => b.test(l)) || null;
}
// the bin whose zones list includes this zone-label (or null)
function binForZone(normLabel) {
  return AREA_BINS.find(b => b.zones.includes(normLabel)) || null;
}
// display relabels for zone labels (sheet may still say "Back Shop")
const ZONE_RELABEL = {'back shop': 'Sanding Shop'};

const S = {
  map: null, data: null, floor: 0, search: '', view: 'map',
  bySlot: new Map(), slotFloor: new Map(),
  zoom: 1,        // 1 = map fills the card width; scroll down to explore
  feedOpen: false, // map opens full width; the truck button opens the feed
  focusRow: null, // piano row highlighted by search / NEW-chip focus
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
  setInterval(async () => {
    try {
      const [m, d2] = await Promise.all([fetchSlots(), fetchData()]);
      S.map = m; S.data = d2;
      index(); renderAll();
      if (!d2.stale && d2.pianos.length) writeCache();
    } catch (e) { /* keep last */ }
  }, 150000);
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
    && !areaBinFor(p)     // area-bin pianos are drawn in their zone instead
    && !isRented(p)       // rented pianos live in the rented zone
    && !isConference(p)); // conference/Larson-home pianos live in that zone
}
function rentedPianos() {
  return S.data.pianos.filter(p => p.active && isRented(p));
}
function conferencePianos() {
  return S.data.pianos.filter(p => p.active && isConference(p));
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
// staged in the Conference Room or at the Larson home — accounted for in
// the virtual Conference Room zone rather than dumped in the attic
function isConference(p) {
  return /conference room|larson home/i.test((p.location || '').trim());
}
function comingSoon(p) {
  return (p.location || '').trim().replace(/\s+/g, ' ').toLowerCase().startsWith('coming soon');
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
          + p.location).toLowerCase().includes(q);
}
function logLink(p) {
  return PIANOLOG_URL + '#piano=' + encodeURIComponent(p.serial || p.summary);
}

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
  const inBin = areaBinFor(p);   // parked in a named work-area zone (floor 0)
  const fi = placed ? S.slotFloor.get(p.location.toLowerCase()) : (inBin ? 0 : 1);   // rented + attic both live on floor 1
  if (fi !== S.floor) { S.floor = fi; renderTabs(); }
  renderMap();
  const f = S.map.floors[S.floor];
  const sl = placed ? f.slots.find(x => x.id.toLowerCase() === p.location.toLowerCase()) : null;
  const target = sl ? {x: sl.x + sl.w / 2, y: sl.y + sl.h / 2}
    : (S.binXY || {})[p.row] || (S.rentXY || {})[p.row] || (S.confXY || {})[p.row] || (S.holdingXY || {})[p.row];
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
  const lab = phaseLabels(effectivePhase(p), p);
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
    const mark = !active ? '<b class="mna">— after QC &amp; Assembly</b>'
      : have === 'skip' ? '<b class="mskip">— skipped</b>'
      : have ? '<b class="myes">✓ have</b>'
      : (p.serial ? `<span class="mopts"><i class="mno">✗</i>
           <button class="mmark" data-f="${field}">✓ done</button>
           <button class="mmark mskipbtn" data-f="${field}" data-skip="1">skip</button></span>`
                  : '<b class="mno">✗ needed</b>');
    return `<div class="row rowflex"><span>${label}</span>${mark}</div>`;
  };
  return `<div class="mediabox">
    ${line('Before photos', 'bphoto', p.bphoto, true)}
    ${line('Before video', 'bvideo', p.bvideo, true)}
    ${line('After photos', 'aphoto', p.aphoto, late)}
    ${line('After video', 'avideo', p.avideo, late)}
    <div class="mdmsg"></div>
  </div>`;
}
function isLate(p) { return phaseNum(p) >= AFTER_MIN; }
// on the books but physically not in the building yet — no media possible
function notYetArrived(p) {
  return /coming soon|not here|on order|ordered|never came|in moving truck/i.test(p.location || '');
}
function mediaNeeds(p) {
  // not-yet-arrived pianos aren't photographed until they're here (NEW / 1N)
  if (comingSoon(p)) return {needBP: false, needBV: false, needAP: false, needAV: false, photo: false, video: false};
  const late = isLate(p);
  const needBP = !p.bphoto, needBV = !p.bvideo;
  const needAP = late && !p.aphoto, needAV = late && !p.avideo;
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
// 4x6 shop tag: identity + phase checklist + QR to the Piano Log entry
function printShopTag(p) {
  const nm = [(p.year || ''), p.make, p.model].filter(Boolean).join(' ') || p.summary || 'Piano';
  const eff = effectivePhase(p);
  const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data='
    + encodeURIComponent(logLink(p));
  const rows = PHASES.map((ph, i) => {
    const done = PHASES.indexOf(eff) > i;
    const cur = eff === ph;
    return `<div class="ph ${cur ? 'cur' : ''} ${done ? 'done' : ''}">
      <span class="box">${done ? '✓' : cur ? '▶' : ''}</span>
      <span class="n">${i + 1}</span> ${esc(ph)}</div>`;
  }).join('');
  const state = ['In Queue', 'Paused', 'For Sale'].includes(eff)
    ? `<div class="state">${esc(eff.toUpperCase())}</div>` : '';
  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked — allow pop-ups to print shop tags.'); return; }
  w.document.write(`<!doctype html><html><head><title>Shop tag — ${esc(nm)}</title><style>
    @page { size: 4in 6in; margin: 0.18in; }
    * { box-sizing: border-box; margin: 0; }
    body { font: 11px/1.35 Helvetica, Arial, sans-serif; color: #121212; width: 3.6in; }
    .hd { background: #0d0d0d; color: #fff; padding: 8px 10px; border-radius: 6px 6px 0 0;
          font-family: Georgia, serif; letter-spacing: 3px; font-size: 13px; }
    .hd small { display: block; font-family: Helvetica, Arial, sans-serif; letter-spacing: 2px;
          font-size: 8px; color: #bbb; margin-top: 2px; }
    .bd { border: 1.5px solid #121212; border-top: none; border-radius: 0 0 6px 6px; padding: 8px 10px; }
    h1 { font-size: 15px; margin: 0 0 4px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 8px; margin-bottom: 6px; }
    .meta b { font-size: 12px; }
    .meta span { color: #555; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; }
    .state { border: 2px solid #9e2020; color: #9e2020; font-weight: 800; text-align: center;
             padding: 3px; margin: 4px 0; letter-spacing: 2px; border-radius: 4px; }
    .phases { column-count: 2; column-gap: 10px; border-top: 1px solid #ddd; padding-top: 6px; }
    .ph { break-inside: avoid; padding: 1.5px 0; color: #444; }
    .ph .box { display: inline-block; width: 12px; height: 12px; border: 1.2px solid #888;
               border-radius: 2px; text-align: center; line-height: 11px; font-size: 9px; margin-right: 3px; }
    .ph .n { color: #999; font-size: 9px; }
    .ph.done { color: #999; } .ph.done .box { border-color: #2e7d4f; color: #2e7d4f; }
    .ph.cur { color: #9e2020; font-weight: 800; } .ph.cur .box { border-color: #9e2020; color: #9e2020; }
    .ft { display: flex; align-items: center; gap: 8px; margin-top: 7px; border-top: 1px solid #ddd; padding-top: 6px; }
    .ft img { width: 68px; height: 68px; }
    .ft .note { font-size: 8.5px; color: #666; }
  </style></head><body>
    <div class="hd">BRIGHAM LARSON PIANOS<small>SHOP TAG · ${esc(new Date().toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}))}</small></div>
    <div class="bd">
      <h1>${esc(nm)}</h1>
      <div class="meta">
        <div><span>Serial</span><br><b>${esc(p.serial || '—')}</b></div>
        <div><span>Spot</span><br><b>${esc(p.location || '—')}</b></div>
        <div><span>Owner</span><br><b>${esc((p.owner || '—').slice(0, 22))}</b></div>
        <div><span>${p.queuePos ? 'Queue' : 'Type'}</span><br><b>${p.queuePos ? '#' + p.queuePos + ' of ' + p.queueTotal : esc(p.type || '—')}</b></div>
      </div>
      ${state}
      <div class="phases">${rows}</div>
      <div class="ft"><img src="${qr}" alt="QR">
        <div class="note"><b>Scan for the Piano Log entry</b><br>
        Live location + phase: blpstoremap.netlify.app<br>
        Update the phase from the map’s data card.</div></div>
    </div>
    <script>onload = () => setTimeout(() => print(), 300)<\/script>
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
    if (z.w > 4 && z.h > 4)
      s += `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" class="zonebox ${cls}"/>`;
    if (list && list.length) {
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
        s += `<g class="piano ${st} own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
              data-row="${p.row}">${glyph(p.type, cx, cy, sc)}${phaseText(p, cx, cy, sc)}${mediaBadge(p, cx, cy, sc)}</g>`;
      });
    } else {
      s += zoneLabelSVG(disp === z.text ? z : {...z, text: disp}, cls);
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
          s += `<g class="piano ${st} own-${ownerClass(p)} ${q && !matches(p, q) ? 'dim' : ''} ${hl ? 'hl' : ''}"
                data-slot="${esc(sl.id)}" data-row="${p.row}">
                <g transform="rotate(90 ${cx} ${cy})">${glyph(p.type, cx, cy, sc)}</g>${phaseText(p, cx, cy, sc)}${mediaBadge(p, cx, cy, sc)}${priceText(p, cx, cy, sc)}</g>`;
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
          s += `<g class="piano ${st} own-${ownerClass(p)} ${q && !matches(p, q) ? 'dim' : ''} ${hl ? 'hl' : ''}"
                data-slot="${esc(sl.id)}" data-row="${p.row}">${glyph(p.type, cx, cy, sc)}${phaseText(p, cx, cy, sc)}${mediaBadge(p, cx, cy, sc)}${priceText(p, cx, cy, sc)}</g>`;
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
      const RZ = {x: 80, y: 875, x2: 1050, y2: 1115};
      const zw = RZ.x2 - RZ.x, zh = RZ.y2 - RZ.y;
      s += `<rect x="${RZ.x}" y="${RZ.y}" width="${zw}" height="${zh}" rx="8" class="rentzone"/>`;
      s += `<text x="${RZ.x + zw / 2}" y="${RZ.y + 26}" text-anchor="middle" class="renttitle" font-size="19">RENTED — OUT ON RENTAL (${rl.length})</text>`;
      const headH = 38, cols = 6;
      const rrows = Math.ceil(rl.length / cols);
      const rcw = (zw - 12) / cols;
      const rch = Math.min(105, (zh - headH - 10) / rrows);
      rl.forEach((p, idx) => {
        const cx0 = RZ.x + 6 + (idx % cols) * rcw;
        const cy0 = RZ.y + headH + Math.floor(idx / cols) * rch;
        const cx = cx0 + rcw / 2;
        const hl = S.focusRow === p.row || (q && matches(p, q));
        const dim = q && !matches(p, q);
        const nm = (p.year ? p.year + ' ' : '')
          + ([p.make, p.model].filter(Boolean).join(' ') || p.summary || '');
        const nameLines = wrapCap(nm, rcw - 8, 9.5, 1);
        const iconCy = cy0 + (rch - 16) / 2;
        const sc = Math.max(0.9, Math.min(1.6, (rch - 22) / 22));
        S.rentXY[p.row] = {x: cx, y: cy0 + rch / 2};
        s += `<g class="piano rented own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
              data-row="${p.row}">${glyph(p.type, cx, iconCy, sc)}${phaseText(p, cx, iconCy, sc)}</g>`;
        s += `<text x="${cx}" y="${cy0 + rch - 5}" text-anchor="middle" class="rentname" font-size="9.5">`
          + nameLines.map(L => esc(L)).join('') + `</text>`;
      });
    }
  }

  // ---- CONFERENCE ROOM zone (2nd floor): pianos staged in the conference
  // room or at the Larson home, parked virtually so they're accounted for
  // instead of falling into the attic grid
  S.confXY = {};
  let atticTop = 2620;
  if (S.floor === 1) {
    const cl = conferencePianos();
    if (cl.length) {
      const CZ = {x: 1412, y: 2620, x2: 2082, y2: 2620 + 210};
      const czw = CZ.x2 - CZ.x, czh = CZ.y2 - CZ.y;
      s += `<rect x="${CZ.x}" y="${CZ.y}" width="${czw}" height="${czh}" rx="8" class="confzone"/>`;
      s += `<text x="${CZ.x + czw / 2}" y="${CZ.y + 24}" text-anchor="middle" class="conftitle" font-size="17">CONFERENCE ROOM (${cl.length})</text>`;
      const chH = 34, ccols = 6;
      const crows = Math.ceil(cl.length / ccols);
      const ccw = (czw - 12) / ccols;
      const cch = Math.min(95, (czh - chH - 10) / crows);
      cl.forEach((p, idx) => {
        const cx0 = CZ.x + 6 + (idx % ccols) * ccw;
        const cy0 = CZ.y + chH + Math.floor(idx / ccols) * cch;
        const cx = cx0 + ccw / 2;
        const hl = S.focusRow === p.row || (q && matches(p, q));
        const dim = q && !matches(p, q);
        const nm = (p.year ? p.year + ' ' : '')
          + ([p.make, p.model].filter(Boolean).join(' ') || p.summary || '');
        const nameLines = wrapCap(nm, ccw - 8, 9, 1);
        const iconCy = cy0 + (cch - 14) / 2;
        const sc = Math.max(0.8, Math.min(1.4, (cch - 20) / 22));
        S.confXY[p.row] = {x: cx, y: cy0 + cch / 2};
        s += `<g class="piano own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
              data-row="${p.row}">${glyph(p.type, cx, iconCy, sc)}${phaseText(p, cx, iconCy, sc)}</g>`;
        s += `<text x="${cx}" y="${cy0 + cch - 4}" text-anchor="middle" class="confname" font-size="9">`
          + nameLines.map(L => esc(L)).join('') + `</text>`;
      });
      atticTop = CZ.y2 + 16;   // attic zone shrinks to make room, same outer bounds
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
      const AT = {x: 1412, y: atticTop, x2: 2082, y2: 3818};   // attic rectangle
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
        s += `<g class="piano ${st} own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
              data-row="${p.row}">${glyph(p.type, cx, iconCy, sc)}${phaseText(p, cx, iconCy, sc)}${mediaBadge(p, cx, iconCy, sc)}</g>`;
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
  hideTimer = setTimeout(() => { $('#pop').hidden = true; }, 250);
}
function cancelHide() { clearTimeout(hideTimer); }
$('#pop').addEventListener('mouseenter', cancelHide);
$('#pop').addEventListener('mouseleave', scheduleHide);

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
       </div><div class="mvmsg"></div>`
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
           ${PHASES.map((ph, i) =>
             `<option value="${esc(ph)}" ${effPh === ph ? 'selected' : ''}>${i + 1} · ${esc(ph)}</option>`).join('')}
           ${PHASE_STATES.map(ph =>
             `<option value="${esc(ph)}" ${effPh === ph ? 'selected' : ''}>${esc(ph)}</option>`).join('')}
         </select></div><div class="phmsg"></div>`
    : '';
  return `<span class="x">✕</span>
    <span class="tag ${st}">${tags[st]} · SPOT ${esc(p.location)}</span>
    <h3>${esc(makeModel)}</h3>
    <div class="row rowflex"><span>Serial # <b>${esc(p.serial || '—')}</b></span>${queueChip}</div>
    ${p.serial ? (() => {
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
      return `<div class="tagbtns histbtns">
        <button class="tagbtn rreports">📄 Tech Reports History</button>
        ${crVal === 'yes' ? `<button class="tagbtn creports">🤝 Client Reports History</button>` : ''}
      </div>${crAsk}`;
    })() : ''}
    <div class="row">Status <b>${esc(p.status || '—')}</b></div>
    <div class="row">Owner <b>${esc(p.owner || '—')}</b></div>
    ${effectivePhase(p) === 'For Sale'
      ? `<div class="row rowflex"><span>Price <b class="pricecard">${priceLabel(p) ? esc(priceLabel(p)) : '—'}</b></span>
           ${p.serial ? `<button class="predit">${p.price ? '✎ Edit price' : '＋ Add price'}</button>` : ''}</div>`
      : (priceLabel(p) ? `<div class="row">Price <b class="pricecard">${esc(priceLabel(p))}</b></div>` : '')}
    <div class="row">Last tuned <b>${ti.last ? esc(fmtDayYear(ti.last)) : '—'}</b></div>
    ${ti.next ? `<div class="row">Tuning scheduled <b class="tunesched">🎵 ${esc(fmtDay(ti.next.date))} · ${esc(ti.next.time)}</b></div>` : ''}

    ${mediaCard(p)}
    ${tracker}
    ${phaser}
    ${p.serial ? (() => {
      const dl = (p.phasesDone || '').split(',').map(t => t.trim()).filter(Boolean);
      return `<div class="row trkrow" title="phases already completed — tap to toggle">Done
        <span class="trkchips">${PHASES.filter(ph => ph !== 'Delivered').map((ph, i) =>
          `<button class="trk dn ${dl.includes(ph) ? 'on' : ''}" data-ph="${esc(ph)}" title="${esc(ph)}">${i + 1}${dl.includes(ph) ? '✓' : ''}</button>`).join('')}
        </span></div><div class="dnmsg phmsg"></div>`;
    })() : ''}
    ${(p.phase || '').startsWith('Waiting') ? `<div class="row waitnote">Waiting on
        <b>${esc(p.waitNote || p.phase.replace('Waiting on ', ''))}</b>
        ${p.checkBack ? `<span class="wncb">· check back <b class="snzcur">${esc(p.checkBack)}</b></span>` : ''}
      </div>
      ${p.serial ? `<div class="row rowflex snzrow"><span class="snzlbl">${p.checkBack ? 'Re-snooze' : 'Check back in'}</span>
        <span class="snzbtns"><button class="snz" data-d="3">+3d</button><button class="snz" data-d="7">+1w</button><button class="snz" data-d="14">+2w</button><button class="snz" data-d="30">+1m</button></span>
      </div><div class="snzmsg phmsg"></div>` : ''}` : ''}
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
      </div>` : ''}
    ${photo}
    ${mover}
    ${queuer}
    <div class="tagbtns">
      ${priceLabel(p) ? `<a class="tagbtn" target="_blank" rel="noopener"
        href="${priceTagUrl(p)}">🏷 Price tag ↗</a>` : ''}
      ${p.serial ? `<button class="tagbtn shoptag">🖨 Shop tag</button>` : ''}
    </div>
    <span class="btn">Open Piano Log ↗</span>`;
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
  const go = pop.querySelector('.mvgo:not(.qgo)');
  if (go) go.onclick = () => movePiano(p, pop.querySelector('.mvin:not(.qin)').value.trim(), pop);
  const inp = pop.querySelector('.mvin:not(.qin)');
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
  pop.querySelectorAll('.trk:not(.dn)').forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    if (b.dataset.t === 'Misc' && !b.classList.contains('on')) { openMiscModal(p, pop); return; }
    toggleTrack(p, b.dataset.t, pop);
  });
  const me = pop.querySelector('.miscedit');
  if (me) me.onclick = ev => { ev.stopPropagation(); openMiscModal(p, pop); };
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
  });
  const pb = pop.querySelector('.photobtn');
  const pi = pop.querySelector('.photoin');
  if (pb) pb.onclick = ev => { ev.stopPropagation(); popPinned = true; pi.click(); };
  if (pi) {
    pi.onclick = ev => ev.stopPropagation();
    pi.onchange = () => uploadPhoto(p, pi, pop);
  }
  const st = pop.querySelector('.shoptag');
  if (st) st.onclick = ev => { ev.stopPropagation(); printShopTag(p); };
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
    msg.className = 'phmsg err'; msg.textContent = 'A team PIN is required — nothing saved.';
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
      openPop(p.row, S.popAnchor, true);   // refresh the card rows
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
  if (!ok) { msg.className = 'mdmsg err'; msg.textContent = 'A team PIN is required — nothing saved.'; return; }
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
  if (!ok) { msg.className = 'trkmsg phmsg err'; msg.textContent = 'Sign in or enter the team PIN first.'; return; }
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

// toggle a completed-phase checkmark; the list is saved to PHASES DONE
async function toggleDone(p, phase, pop) {
  const msg = pop.querySelector('.dnmsg');
  popPinned = true;
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'dnmsg phmsg err'; msg.textContent = 'Sign in or enter the team PIN first.'; return; }
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
  if (!ok) { msg.className = 'crmsg phmsg err'; msg.textContent = 'Sign in or enter the PIN first.'; return; }
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
  if (!ok) { msg.className = 'snzmsg phmsg err'; msg.textContent = 'Sign in or enter the PIN first.'; return; }
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
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in (☰ menu) or enter the team PIN first.'; return; }
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
      throw new Error('Not authorized — sign in or re-enter the PIN.');
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
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in (☰ menu) or enter the team PIN to add pianos.'; return; }
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
      throw new Error('Not authorized — sign in or re-enter the PIN, then try again.');
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
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in or enter the team PIN first.'; return; }
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
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in or re-enter the PIN.'); }
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
    <button class="tmgo svgo">Schedule next open slot</button>
    <div class="tmmsg"></div>`);
  ov.querySelector('.svgo').onclick = () => submitService(p, ov);
}
async function submitService(p, ov) {
  const msg = ov.querySelector('.tmmsg');
  const btn = ov.querySelector('.svgo');
  const {pin, ok} = writeAuth();
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in or enter the team PIN first.'; return; }
  const sel = ov.querySelector('.svtech');
  const techName = sel.options[sel.selectedIndex].text;
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = `Finding ${techName}’s next open slot…`;
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'service', row: p.row,
        techId: sel.value, techName,
        minutes: +ov.querySelector('.svmins').value,
        notes: ov.querySelector('.svnotes').value.trim(), ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in or re-enter the PIN.'); }
    if (!j.scheduled) throw new Error(j.error || 'scheduling failed');
    msg.className = 'tmmsg ok';
    msg.textContent = `✓ Scheduled with ${j.tech}: ${j.date} at ${j.time} (${j.minutes} min) — on the QC & Showroom repairs calendar, invite sent to ${j.tech.split(' ')[0]}.`;
    setTimeout(() => { ov.hidden = true; }, 3000);
  } catch (e) {
    msg.className = 'tmmsg err'; msg.textContent = '✗ ' + e.message;
    btn.disabled = false;
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
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in or enter the team PIN first.'; return; }
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
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in or re-enter the PIN.'); }
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
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in or enter the team PIN first.'; return; }
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
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in or re-enter the PIN.'); }
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
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in or enter the team PIN first.'; return; }
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
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in or re-enter the PIN.'); }
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
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in or enter the team PIN first.'; return; }
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
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in or re-enter the PIN.'); }
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
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'Sign in or enter the team PIN first.'; return; }
  btn.disabled = true;
  msg.className = 'tmmsg'; msg.textContent = 'Emailing Brigham…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'requestprice', row: p.row, ...authFields()}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') { lsDel('blpPin'); throw new Error('Not authorized — sign in or re-enter the PIN.'); }
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
  if (!ok) { msg.className = 'tmmsg err'; msg.textContent = 'A team PIN is required to schedule tunings.'; return; }
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
      throw new Error('Wrong PIN — click Schedule to try again.');
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
  if (!af.idToken && !key) {
    keyIn.hidden = false; keyIn.focus();
    msg.className = 'tmmsg err';
    msg.textContent = 'Sign in with Google, or enter the BLP app passcode.';
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
  if (!ok) { msg.className = 'photomsg err'; msg.textContent = 'A team PIN is required — photo not sent.'; return; }
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
      msg.className = 'photomsg err'; msg.textContent = '✗ Wrong PIN — tap the button to try again.';
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
// signed-in Google users write without a PIN (the bridge verifies their
// token); everyone else gets the classic PIN prompt
function writeAuth() {
  if (authUser()) return {pin: lsGet('blpPin') || '', ok: true};
  const pin = teamPin(false);
  return {pin, ok: !!pin};
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
// Sign-in is OPTIONAL again (mandatory gate removed) — the authbox in the
// menu still offers Google sign-in so actions are logged under a name.
function authGate() {
  const ov = document.getElementById('authgate');
  if (ov) ov.hidden = true;
}
function renderAuth() {
  authGate();
  const box = $('#authbox');
  if (!box) return;
  if (!GOOGLE_CLIENT_ID) { box.hidden = true; return; }
  box.hidden = false;
  const u = authUser();
  const expired = u && u.exp * 1000 < Date.now();
  if (u && expired) {
    // hourly Google token ran out and the silent refresh didn't come back —
    // surface it instead of looking "stuck" on Signed in
    box.innerHTML = `<b>Session expired</b>
      <div class="authhint">${esc(u.name)} — sign in again so changes save under your name</div>
      <div id="gsiBtn"></div>
      <button class="authout" id="authOut">sign out</button>`;
    $('#authOut').onclick = signOut;
    if (window.google?.accounts?.id) {
      google.accounts.id.renderButton($('#gsiBtn'),
        {theme: 'outline', size: 'medium', text: 'signin_with', width: 190});
    }
  } else if (u) {
    box.innerHTML = `<b>Signed in</b>
      <span class="authname">${u.pic ? `<img class="authpic" src="${esc(u.pic)}" alt="">` : '👤 '}${esc(u.name)}</span>
      <button class="authout" id="authOut">sign out</button>`;
    $('#authOut').onclick = signOut;
  } else {
    box.innerHTML = `<b>Team member</b>
      <div class="authhint">Sign in so changes are logged under your name — no team PIN needed</div>
      <div id="gsiBtn"></div>`;
    if (window.google?.accounts?.id) {
      google.accounts.id.renderButton($('#gsiBtn'),
        {theme: 'outline', size: 'medium', text: 'signin_with', width: 190});
    }
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
      use_fedcm_for_button: true,
    });
    renderAuth();
    // silently refresh the hourly token for already-signed-in users —
    // on load and every 5 minutes while the page stays open
    const refresh = () => {
      const u = authUser();
      if (!u) return;
      if (u.exp * 1000 < Date.now() + 600000) { try { google.accounts.id.prompt(); } catch (ig) {} }
      if (u.exp * 1000 < Date.now()) renderAuth();   // flip the box to "Session expired"
    };
    refresh();
    setInterval(refresh, 300000);
  };
  document.head.appendChild(s);
  renderAuth();
}
// finish a redirect sign-in: gsi-callback leaves the credential here
try {
  const redirCred = localStorage.getItem('blpGsiCred');
  if (redirCred) { localStorage.removeItem('blpGsiCred'); onGoogleCred({credential: redirCred}); }
} catch (e) { /* storage unavailable — sign-in will be offered again */ }
initAuth();

async function movePiano(p, dest, pop) {
  const msg = pop.querySelector('.mvmsg');
  if (!dest) { msg.textContent = 'Type a spot number or area name first.'; return; }
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
function missingStage() {
  return S.data.pianos.filter(p => p.active && !comingSoon(p) && !p.phase && !p.isNew);
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
  return `<table><tr><th>PIANO</th><th>SERIAL</th><th>LOCATION</th><th>LOG SECTION</th><th></th></tr>` +
    (ms.map(p => `<tr class="mrow" data-row="${p.row}"><td>${esc(pianoName(p))}</td>
      <td>${esc(p.serial)}</td><td class="locraw">${esc(p.location || '(blank)')}</td>
      <td>${esc((p.section || '—').slice(0, 38))}</td>
      <td><a target="_blank" rel="noopener" href="${logLink(p)}">log ↗</a></td></tr>`).join('')
     || '<tr><td colspan="5" class="empty">None — every arrived piano has a shop stage. 🎉</td></tr>') + '</table>';
}
function mediaTable() {
  const act = S.data.pianos.filter(p => p.active && !notYetArrived(p))
    .map(p => ({p, m: mediaNeeds(p)})).filter(x => x.m.photo || x.m.video);
  const need = m => [m.needBP && 'before 📷', m.needBV && 'before 🎥',
                     m.needAP && 'AFTER 📷', m.needAV && 'AFTER 🎥'].filter(Boolean).join(' · ');
  return `<table><tr><th>PIANO</th><th>SERIAL</th><th>LOCATION</th><th>PHASE</th><th>STILL NEEDED</th><th></th></tr>` +
    (act.map(({p, m}) => `<tr class="mrow" data-row="${p.row}"><td>${esc(pianoName(p))}</td>
      <td>${esc(p.serial)}</td><td class="locraw">${esc(p.location || 'no spot')}</td>
      <td>${esc(effectivePhase(p) || '—')}</td><td>${need(m)}</td>
      <td><a target="_blank" rel="noopener" href="${logLink(p)}">log ↗</a></td></tr>`).join('')
     || '<tr><td colspan="6" class="empty">Every active piano has its media. 🎉</td></tr>') + '</table>';
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
   desc: 'Arrived pianos with no CURRENT PHASE in the Piano Log. Click a row to jump to the piano.',
   html: missingStageTable},
  {id: 'media', icon: '📸', title: 'MEDIA NEEDED', count: S.data.pianos.filter(p =>
     p.active && !notYetArrived(p) && (mediaNeeds(p).photo || mediaNeeds(p).video)).length,
   desc: 'Before photos/video for every arrived piano; after photos/video once it reaches Tuning or later. Pianos that haven\'t arrived yet join once they\'re here.',
   html: mediaTable},
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
  ['map', 'report', 'board', 'cal', 'media'].forEach(x => $('#view-' + x).hidden = x !== v);
  document.querySelectorAll('.navitem[data-view]').forEach(el =>
    el.classList.toggle('on', el.dataset.view === v));
}
function switchView(v) { S.view = v; showView(v); closeNav(); }
document.querySelectorAll('.navitem[data-view]').forEach(el =>
  el.onclick = () => switchView(el.dataset.view));

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

// top-bar 📨 Request menu — general requests, no piano required
const topReqBtn = $('#reqTopBtn');
if (topReqBtn) {
  topReqBtn.onclick = () => { const m = $('#reqTopMenu'); m.hidden = !m.hidden; };
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
$('#search').addEventListener('input', e => {
  S.search = e.target.value;
  S.focusRow = null;
  if (S.view !== 'map') switchView('map');
  renderMap();
  clearTimeout(searchTimer);
  const q = S.search.trim().toLowerCase();
  if (q.length < 2) return;
  searchTimer = setTimeout(() => {
    if (S.slotFloor.has(q)) { focusSpot(q); return; }      // exact spot #
    const hits = S.data.pianos.filter(p => p.active && matches(p, q));
    if (hits.length === 1) focusPiano(hits[0]);            // unique piano
  }, 450);
});

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
