/* BLP Store Map — front-end */
const PIANOLOG_URL = 'https://pianologapp.netlify.app/';
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
  'warehouse', 'rental', 'out for delivery', 'customer'];

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

function index() {
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
const localDay = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
function todaysMoves() {
  const t = localDay();
  return S.data.events.filter(e => e.date === t);
}
function pianoStatus(p) {
  const today = localDay();
  if (p.serial && p.serial.length > 4) {
    // note: the calendar's "x " prefix is admin bookkeeping (reminder
    // calls), NOT completion — so any mention today counts as in transit
    const ev = S.data.events.find(e => (e.summary + e.description).includes(p.serial));
    if (ev) return ev.date === today ? 'move' : 'sched';
  }
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
  renderMap(); renderReport(); renderBoard(); renderCal(); showView(S.view); syncFeed();
}

function renderTabs() {
  $('#floorTabs').innerHTML = S.map.floors.map((f, i) =>
    `<div class="${i === S.floor ? 'on' : ''}" data-f="${i}">${esc(f.name.replace(' floor', ''))} floor</div>`).join('');
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
  $('#movesBadge').textContent = tm;
  $('#kpis').innerHTML = `
    <div class="kpi"><span class="n">${total}</span><span class="l">TOTAL PIANOS</span></div>
    <div class="kpi click" id="kpiF1"><span class="n">${placed(0)}</span><span class="l">1ST FLOOR →</span></div>
    <div class="kpi click" id="kpiF2"><span class="n">${placed(1)}</span><span class="l">2ND FLOOR →</span></div>
    <div class="kpi"><span class="n">${own.blp}<small> / ${own.csgn} / ${own.client}</small></span><span class="l">BLP / CONSIGN / CLIENT</span></div>
    <div class="kpi"><span class="n">${tm}</span><span class="l">MOVES TODAY</span></div>
    <div class="kpi click" id="kpiNew"><span class="n">${newWeek}</span><span class="l">NEW THIS WEEK →</span></div>
    <div class="kpi red" id="kpiReport"><span class="n">${un} <small>+ ${du} dup</small></span><span class="l">UNPLACED / ERRORS →</span></div>`;
  $('#kpiReport').onclick = () => switchView('report');
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
  const fi = p.isSlot ? S.slotFloor.get(p.location.toLowerCase()) : undefined;
  if (fi !== undefined && fi !== S.floor) { S.floor = fi; renderTabs(); }
  renderMap();
  const f = S.map.floors[S.floor];
  const sl = fi !== undefined
    ? f.slots.find(x => x.id.toLowerCase() === p.location.toLowerCase()) : null;
  if (sl) {
    S.zoom = Math.max(S.zoom, 2.4); sizePlan();
    const sc = $('#mapscroll');
    const k = sc.querySelector('svg').clientWidth / f.width;
    sc.scrollLeft = (sl.x + sl.w / 2) * k - sc.clientWidth / 2;
    sc.scrollTop = (sl.y + sl.h / 2) * k - sc.clientHeight / 2;
  }
  const el = document.querySelector(`.piano[data-row="${p.row}"]`);
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
  const k = sc.querySelector('svg').clientWidth / f.width;
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
  const sc = $('#mapscroll');
  const w = Math.max(320, sc.clientWidth - 2) * S.zoom;
  const svg = $('#plan');
  svg.setAttribute('viewBox', `0 0 ${f.width} ${f.height}`);
  svg.style.width = w + 'px';
  svg.style.height = (w * f.height / f.width) + 'px';
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
  for (const z of f.labels) {
    const cls = fillClass(z.fill);
    if (z.w > 4 && z.h > 4)
      s += `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" class="zonebox ${cls}"/>`;
    s += zoneLabelSVG(z, cls);
  }
  for (const w of f.walls)
    s += `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" class="wall"/>`;
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
          s += `<g class="piano ${st} ${q && !matches(p, q) ? 'dim' : ''} ${hl ? 'hl' : ''}"
                data-slot="${esc(sl.id)}" data-row="${p.row}">
                <g transform="rotate(90 ${cx} ${cy})">${glyph(p.type, cx, cy, sc)}</g></g>`;
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
          s += `<g class="piano ${st} ${q && !matches(p, q) ? 'dim' : ''} ${hl ? 'hl' : ''}"
                data-slot="${esc(sl.id)}" data-row="${p.row}">${glyph(p.type, cx, cy, sc)}</g>`;
        });
      }
    }
  }
  const svg = $('#plan');
  svg.innerHTML = s;
  sizePlan();
  svg.querySelectorAll('.piano').forEach(el => {
    el.addEventListener('click', ev => { ev.stopPropagation(); openPop(+el.dataset.row, el, true); });
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
  const tags = {in: 'IN PLACE', new: 'NEW', sched: 'SCHEDULED', move: 'IN TRANSIT'};
  const makeModel = [p.make, p.model].filter(Boolean).join(' ') || p.summary;
  const mover = p.serial
    ? `<div class="movebox">
         <input class="mvin" placeholder="new spot #" maxlength="12">
         <button class="mvgo">Move</button>
       </div><div class="mvmsg"></div>`
    : `<div class="mvmsg">No serial # — change location in the Piano Log.</div>`;
  return `<span class="x">✕</span>
    <span class="tag ${st}">${tags[st]} · SPOT ${esc(p.location)}</span>
    <h3>${esc(makeModel)}</h3>
    <div class="row">Serial # <b>${esc(p.serial || '—')}</b></div>
    <div class="row">Status <b>${esc(p.status || '—')}</b></div>
    <div class="row">Owner <b>${esc(p.owner || '—')}</b></div>
    ${mover}
    <span class="btn">Open Piano Log ↗</span>`;
}
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
      body: JSON.stringify({pin, serial: p.serial, action: 'move', newLocation: dest}),
    });
    const j = await r.json();
    if (j.error === 'unauthorized') {
      localStorage.removeItem('blpPin');
      msg.textContent = '✗ Wrong PIN — click Move to try again.';
      return;
    }
    if (j.moved) {
      msg.textContent = `✓ Moved from ${j.previous || '—'} to ${j.location}`
        + (known ? '' : ' (not a numbered map spot — it will show in reports)');
      p.location = j.location;
      p.isSlot = SLOT_RE.test(j.location);
      index(); renderKpis(); renderMap(); renderReport();
    } else {
      msg.textContent = '✗ ' + (j.error || 'update failed');
    }
  } catch (e) {
    msg.textContent = '✗ ' + e.message;
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
  const card = $('.mapcard').getBoundingClientRect();
  const r = el ? el.getBoundingClientRect() : card;
  let x = r.left - card.left + r.width + 10, y = r.top - card.top - 10;
  if (x + 260 > card.width) x = r.left - card.left - 260;
  if (x < 0) x = 10;
  y = Math.max(10, Math.min(y, card.height - 210));
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
  ['map', 'report', 'board', 'cal'].forEach(x => $('#view-' + x).hidden = x !== v);
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
