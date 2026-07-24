/* BLP Store Map — front-end */
const PIANOLOG_URL = 'https://pianologapp.netlify.app/';
// shop pipeline phases (shared with the BLP Shop app via the Piano Log's
// CURRENT PHASE column). Q/P are the parking states.
const PHASES = ['New Arrival', 'Assessment', 'Teardown', 'PRSB', 'CAP',
  'Refinishing', 'Final Assembly', 'DHRT', 'Tuning', 'QC',
  'Admin Exit Prep', 'Delivered'];
const PHASE_STATES = ['In Queue', 'Paused', 'For Sale'];   // unnumbered states; For Sale turns the icon green
// first-letter code for each numbered phase (10 = QC gets two letters)
const PHASE_ABBR = {
  'New Arrival': 'N', 'Assessment': 'A', 'Teardown': 'T', 'PRSB': 'P', 'CAP': 'C',
  'Refinishing': 'R', 'Final Assembly': 'F', 'DHRT': 'D', 'Tuning': 'T',
  'QC': 'QC', 'Admin Exit Prep': 'A',
};
// what an icon should read: {full:'6R', short:'6'} — or null for none
function phaseLabels(phase) {
  if (!phase) return null;
  if (phase === 'In Queue') return {full: 'Q', short: 'Q'};
  if (phase === 'Paused') return {full: 'P', short: 'P'};
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
const SLOT_RE = /^\d+[a-zA-Z]?$/;
// named areas in col U that are legitimate (not "unplaced") even though
// they aren't numbered slots on the map
const KNOWN_AREAS = ['showroom', 'pre-sale showroom', 'third floor', 'storage',
  'shop', 'vestibule', 'wing room', 'holding room', 'attic', 'sold floor',
  'rebuilding line', 'refinishing', 'back shop', 'middle shop', 'basement',
  'warehouse', 'rental', 'out for delivery', 'customer', 'sanding', 'coming soon'];

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
async function boot() {
  S.map = await fetchSlots();
  try { S.data = await fetchData(); }
  catch (e) { S.data = EMPTY; }   // draw the floor plan even with no data
  index(); renderAll();
  setInterval(async () => {
    try {
      const [m, d2] = await Promise.all([fetchSlots(), fetchData()]);
      S.map = m; S.data = d2;
      index(); renderAll();
    } catch (e) { /* keep last */ }
  }, 150000);
}

// edits confirmed by the bridge but maybe not yet reflected in the 2-min
// cached /api/data — re-applied after every poll so a refresh can't revert
// a just-saved change. Keyed by piano row. {phase, location}
const pendingEdits = new Map();
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
    if (!stillPending) pendingEdits.delete(row);
  }
}

function index() {
  applyPending();
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
    && !areaBinFor(p));   // area-bin pianos are drawn in their zone instead
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

function comingSoon(p) {
  return (p.location || '').trim().replace(/\s+/g, ' ').toLowerCase().startsWith('coming soon');
}
function pianoStatus(p) {
  const today = localDay();
  if (comingSoon(p)) return 'coming';   // not yet at the store — yellow
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
  const fi = placed ? S.slotFloor.get(p.location.toLowerCase()) : (inBin ? 0 : 1);
  if (fi !== S.floor) { S.floor = fi; renderTabs(); }
  renderMap();
  const f = S.map.floors[S.floor];
  const sl = placed ? f.slots.find(x => x.id.toLowerCase() === p.location.toLowerCase()) : null;
  const target = sl ? {x: sl.x + sl.w / 2, y: sl.y + sl.h / 2}
    : (S.binXY || {})[p.row] || (S.holdingXY || {})[p.row];
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
  const lab = phaseLabels(effectivePhase(p));
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
// after-media only becomes relevant once a piano reaches Tuning (phase 9),
// i.e. it's essentially finished — through Tuning & QC
const AFTER_MIN = PHASES.indexOf('Tuning') + 1;   // 9
function phaseNum(p) { const i = PHASES.indexOf(effectivePhase(p)); return i >= 0 ? i + 1 : 0; }
function effectivePhase(p) {
  if (p.phase) return p.phase;
  return (p.isNew && !comingSoon(p)) ? 'New Arrival' : '';   // not-yet-arrived stays unphased
}
// four media lines for the data card (✓ have it / ✗ needed / — n/a yet)
function mediaCard(p) {
  const late = isLate(p);
  const line = (label, have, active) => {
    const mark = !active ? '<b class="mna">— after Tuning/QC</b>'
      : have ? '<b class="myes">✓ have</b>' : '<b class="mno">✗ needed</b>';
    return `<div class="row rowflex"><span>${label}</span>${mark}</div>`;
  };
  return `<div class="mediabox">
    ${line('Before photos', p.bphoto, true)}
    ${line('Before video', p.bvideo, true)}
    ${line('After photos', p.aphoto, late)}
    ${line('After video', p.avideo, late)}
  </div>`;
}
function isLate(p) { return phaseNum(p) >= AFTER_MIN; }
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
  let fs = Math.min(13, Math.max(9, z.h * 0.5));
  const cx = z.x + (z.w || 0) / 2;
  const fits = t => t.length * (fs * 0.58 + 1.4) + 8 <= z.w;
  if (!z.w || fits(z.text)) {
    return `<text x="${cx}" y="${z.y + (z.h ? z.h / 2 + fs * 0.35 : 0)}" text-anchor="middle"
            class="zlabel ${cls}" font-size="${fs}">${esc(z.text)}</text>`;
  }
  let lines = wrapWords(z.text, z.w, fs);
  while ((lines.length > 3 || lines.length * fs * 1.2 > z.h + 6) && fs > 7.5) {
    fs -= 0.75;
    lines = wrapWords(z.text, z.w, fs);
  }
  lines = lines.slice(0, 3);
  const lh = fs * 1.2;
  const y0 = z.y + z.h / 2 - ((lines.length - 1) / 2) * lh + fs * 0.35;
  return `<text x="${cx}" y="${y0}" text-anchor="middle" class="zlabel ${cls}" font-size="${fs}">`
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
      }
    }
  }
  // ---- second-floor holding zone: every active piano not on a spot ----
  let drawW = f.width, drawH = f.height;
  S.holdingXY = {};
  if (S.floor === 1) {
    const list = unplacedPianos();
    if (list.length) {
      const gap = 110, cols = 9, cw = 158, ch = 140, x0 = f.width + gap, y0 = 250;
      const zoneW = cols * cw + 60, zoneX = x0 - 30;
      const rows = Math.ceil(list.length / cols);
      const zoneH = y0 - 80 + rows * ch + 40;
      s += `<rect x="${zoneX}" y="80" width="${zoneW}" height="${zoneH}" rx="20" class="holdzone"/>`;
      s += `<text x="${zoneX + zoneW / 2}" y="160" text-anchor="middle" class="holdtitle">NOT ON THE MAP — ${list.length} PIANOS NEED A SPOT #</text>`;
      s += `<text x="${zoneX + zoneW / 2}" y="200" text-anchor="middle" class="holdsub">click one, then use its “new spot #” box to place it on the map</text>`;
      const iw = cw - 14, ih = ch - 14;          // inner cell size
      const NLH = 15, LLH = 13, PAD = 9;         // line heights, bottom pad
      list.forEach((p, idx) => {
        const cx0 = x0 + (idx % cols) * cw, cy0 = y0 + Math.floor(idx / cols) * ch;
        const cx = cx0 + iw / 2;
        const st = pianoStatus(p);
        const hl = S.focusRow === p.row || (q && matches(p, q));
        const dim = q && !matches(p, q);
        // wrap name + location to fit; each capped at 2 lines
        const nm = (p.year ? p.year + ' ' : '')
          + ([p.make, p.model].filter(Boolean).join(' ') || p.summary || '');
        const loc = p.location ? p.location.replace(/\s+/g, ' ') : 'no spot yet';
        const nameLines = wrapCap(nm, iw - 8, 13.5, 2);
        const locLines = wrapCap(loc, iw - 8, 12, 2);
        const textH = nameLines.length * NLH + 3 + locLines.length * LLH;
        const textTop = cy0 + ih - PAD - textH;   // text block hugs the bottom
        // icon fills the space above the text; scale to what remains
        const regTop = cy0 + 8, regBot = textTop - 4;
        const iconCy = (regTop + regBot) / 2;
        const sc = Math.max(1.4, Math.min(2.7, (regBot - regTop) / 22));
        S.holdingXY[p.row] = {x: cx, y: cy0 + ih / 2};
        s += `<rect x="${cx0}" y="${cy0}" width="${iw}" height="${ih}" rx="11"
              class="holdcell ${hl ? 'hl' : ''} ${dim ? 'dim' : ''}" data-row="${p.row}"/>`;
        s += `<g class="piano ${st} own-${ownerClass(p)} ${dim ? 'dim' : ''} ${hl ? 'hl' : ''}"
              data-row="${p.row}">${glyph(p.type, cx, iconCy, sc)}${phaseText(p, cx, iconCy, sc)}${mediaBadge(p, cx, iconCy, sc)}</g>`;
        let ty = textTop + 11;
        s += `<text x="${cx}" y="${ty}" text-anchor="middle" class="holdname">`
          + nameLines.map((L, li) => `<tspan x="${cx}" ${li ? `dy="${NLH}"` : ''}>${esc(L)}</tspan>`).join('')
          + `</text>`;
        ty += (nameLines.length - 1) * NLH + LLH + 3;
        s += `<text x="${cx}" y="${ty}" text-anchor="middle" class="holdloc">`
          + locLines.map((L, li) => `<tspan x="${cx}" ${li ? `dy="${LLH}"` : ''}>${esc(L)}</tspan>`).join('')
          + `</text>`;
      });
      drawW = x0 + cols * cw + 40;
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
                coming: 'COMING SOON',
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
         <button class="mvgo">Move</button>
       </div><div class="mvmsg"></div>`
    : `<div class="mvmsg">No serial # — change location in the Piano Log.</div>`;
  const tuner = p.serial && p.serial.length >= 5
    ? (ti.next
       ? `<div class="row tunerow">🎵 Tuning <b>${esc(fmtDay(ti.next.date))} · ${esc(ti.next.time)}</b></div>`
       : `<button class="tunebtn">🎵 Request Tuning</button>
          <div class="tunebox" hidden>
            <textarea class="tunenotes" rows="2"
              placeholder="notes for Korban — repairs, prep work… (optional)"></textarea>
            <button class="tunego">Schedule next open slot</button>
          </div><div class="tunemsg"></div>`)
    : '';
  const effPh = effectivePhase(p);
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
    <div class="row">Status <b>${esc(p.status || '—')}</b></div>
    <div class="row">Owner <b>${esc(p.owner || '—')}</b></div>
    ${priceLabel(p) ? `<div class="row">Price <b class="pricecard">${esc(priceLabel(p))}</b></div>` : ''}
    <div class="row">Last tuned <b>${ti.last ? esc(fmtDay(ti.last)) : '—'}</b></div>
    ${mediaCard(p)}
    ${phaser}
    ${tuner}
    ${mover}
    <span class="btn">Open Piano Log ↗</span>`;
}
const fmtDay = iso => new Date(iso + 'T12:00')
  .toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'});
function wirePop(p) {
  const pop = $('#pop');
  pop.onclick = ev => {
    if (ev.target.classList.contains('x')) { pop.hidden = true; popPinned = false; return; }
    if (ev.target.closest('.movebox') || ev.target.closest('.mvmsg')) return;
    if (ev.target.classList.contains('mvin')) return;
    window.open(logLink(p), '_blank', 'noopener');
  };
  const go = pop.querySelector('.mvgo');
  if (go) go.onclick = () => movePiano(p, pop.querySelector('.mvin').value.trim(), pop);
  const inp = pop.querySelector('.mvin');
  if (inp) inp.onkeydown = e => {
    if (e.key === 'Enter') movePiano(p, inp.value.trim(), pop);
  };
  const tb = pop.querySelector('.tunebtn');
  if (tb) tb.onclick = () => {
    popPinned = true;
    tb.hidden = true;
    pop.querySelector('.tunebox').hidden = false;
    place(pop, S.popAnchor);   // card grew — keep it fully on screen
    pop.querySelector('.tunenotes').focus();
  };
  const tg = pop.querySelector('.tunego');
  if (tg) tg.onclick = () => requestTuning(p, pop);
  const ps = pop.querySelector('.phsel');
  if (ps) {
    ps.onclick = ev => ev.stopPropagation();
    ps.onchange = () => setPhase(p, ps.value, pop);
  }
}

async function setPhase(p, phase, pop) {
  const msg = pop.querySelector('.phmsg');
  const sel = pop.querySelector('.phsel');
  const was = p.phase || '';
  if (phase === was) return;
  popPinned = true;
  const pin = teamPin(false);   // prompts on first use of this device
  if (!pin) {
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
      body: JSON.stringify({pin, serial: p.serial, action: 'setphase', phase, row: p.row}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') {
      localStorage.removeItem('blpPin');
      revertPhase(p, was, sel, edit);
      msg.className = 'phmsg err'; msg.textContent = '✗ Wrong PIN — change it again to retry.';
    } else if (j.ok) {
      p.phase = j.phase != null ? j.phase : phase;
      edit.phase = p.phase;   // keep protecting until /api/data catches up
      msg.className = 'phmsg ok';
      msg.textContent = p.phase ? `✓ Saved — ${p.phase}` : '✓ Phase cleared';
      renderMap();
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
function revertPhase(p, was, sel, edit) {
  p.phase = was;
  if (edit) { delete edit.phase; if (!Object.keys(edit).length) pendingEdits.delete(p.row); }
  if (sel) sel.value = was;
  renderMap();
}

async function requestTuning(p, pop) {
  const msg = pop.querySelector('.tunemsg');
  const notes = pop.querySelector('.tunenotes').value.trim();
  popPinned = true;
  const pin = teamPin(false);
  if (!pin) { msg.textContent = 'A team PIN is required to schedule tunings.'; return; }
  msg.textContent = 'Finding Korban’s next open slot…';
  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'tune', notes}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') {
      localStorage.removeItem('blpPin');
      msg.textContent = '✗ Wrong PIN — click Schedule to try again.';
      return;
    }
    if (j.scheduled) {
      msg.textContent = `✓ On the tuning cal: ${j.date} at ${j.time}`;
      // reflect immediately: add to local tunings so the piano turns blue
      S.data.tunings = S.data.tunings || {upcoming: [], past: []};
      S.data.tunings.upcoming.push([j.iso || localDay(), j.hhmm || j.time,
        `${j.title || 'Tuning'} SN ${p.serial}`]);
      pop.querySelector('.tunebox').hidden = true;
      renderMap(); renderKpis();
    } else {
      msg.textContent = '✗ ' + (j.error || 'scheduling failed');
    }
  } catch (e) {
    msg.textContent = '✗ ' + e.message;
  }
}

function teamPin(forceAsk) {
  let pin = localStorage.getItem('blpPin') || '';
  if (!pin || forceAsk) {
    pin = (prompt('BLP team PIN (needed once on this device to move pianos):') || '').trim();
    if (pin) localStorage.setItem('blpPin', pin);
  }
  return pin;
}

async function movePiano(p, dest, pop) {
  const msg = pop.querySelector('.mvmsg');
  if (!dest) { msg.textContent = 'Type a spot number or area name first.'; return; }
  const known = S.slotFloor.has(dest.toLowerCase());
  popPinned = true;
  const pin = teamPin(false);
  if (!pin) { msg.textContent = 'A team PIN is required to move pianos.'; return; }
  msg.textContent = 'Updating Piano Log…';
  try {
    // straight to the Apps Script bridge; text/plain avoids CORS preflight
    const r = await fetch(BRIDGE_URL, {
      method: 'POST', redirect: 'follow',
      headers: {'content-type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({pin, serial: p.serial, action: 'move', newLocation: dest, row: p.row}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') {
      localStorage.removeItem('blpPin');
      msg.className = 'mvmsg err'; msg.textContent = '✗ Wrong PIN — click Move to try again.';
      return;
    }
    if (j.moved) {
      msg.className = 'mvmsg ok';
      msg.textContent = `✓ Moved from ${j.previous || '—'} to ${j.location}`
        + (known ? '' : ' (not a numbered map spot — it will show in reports)');
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
      <div class="row">No piano assigned in the Piano Log.</div>`;
    pop.onclick = ev => {
      if (ev.target.classList.contains('x')) { pop.hidden = true; popPinned = false; } };
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

/* ---------- report ---------- */
function renderReport() {
  const un = unplaced(), du = duplicates();
  $('#unplacedCount').textContent = un.length;
  $('#dupCount').textContent = du.length;
  $('#unplacedTable').innerHTML =
    `<tr><th>PIANO</th><th>SERIAL</th><th>LOG SECTION</th><th>STATUS</th><th>COL U SAYS</th><th></th></tr>` +
    (un.map(p => `<tr><td>${esc(p.summary)}</td><td>${esc(p.serial)}</td>
      <td>${esc((p.section || '—').slice(0, 38))}</td><td>${esc(p.status)}</td>
      <td class="locraw">${esc(p.location || '(blank)')}</td>
      <td><a target="_blank" rel="noopener" href="${logLink(p)}">open ↗</a></td></tr>`).join('')
     || '<tr><td colspan="6" class="empty">None — every active piano has a valid map location. 🎉</td></tr>');
  $('#dupTable').innerHTML =
    `<tr><th>SLOT</th><th>PIANOS CLAIMING IT</th></tr>` +
    (du.map(d => `<tr><td class="locraw">${esc(d.slot)}</td>
      <td>${d.pianos.map(p => esc(p.summary) + (p.serial ? ` (SN ${esc(p.serial)})` : '')).join(' &nbsp;•&nbsp; ')}</td></tr>`).join('')
     || '<tr><td colspan="2" class="empty">No duplicate slot assignments. 🎉</td></tr>');
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
