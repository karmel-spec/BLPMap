/* BLP Store Map — front-end */
const PIANOLOG_URL = 'https://pianologapp.netlify.app/';
const SLOT_RE = /^\d+[a-zA-Z]?$/;
// named areas in col U that are legitimate (not "unplaced") even though
// they aren't numbered slots on the map
const KNOWN_AREAS = ['showroom', 'pre-sale showroom', 'third floor', 'storage',
  'shop', 'vestibule', 'wing room', 'holding room', 'attic', 'sold floor',
  'rebuilding line', 'refinishing', 'back shop', 'middle shop', 'basement',
  'warehouse', 'rental', 'out for delivery', 'customer'];

const S = {
  map: null, data: null, floor: 0, search: '', view: 'map',
  bySlot: new Map(), slotFloor: new Map(), vb: null,
  feedOpen: window.innerWidth >= 1200,
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g,
  c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

async function boot() {
  const [map, data] = await Promise.all([
    fetch('data/slots.json').then(r => r.json()),
    fetch('/api/data').then(r => r.json()),
  ]);
  S.map = map; S.data = data;
  index(); renderAll();
  setInterval(async () => {
    try { S.data = await fetch('/api/data').then(r => r.json()); index(); renderAll(); }
    catch (e) { /* keep last */ }
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
function todaysMoves() {
  const t = new Date().toISOString().slice(0, 10);
  return S.data.events.filter(e => e.date === t);
}
function pianoStatus(p) {
  const today = new Date().toISOString().slice(0, 10);
  if (p.serial && p.serial.length > 4) {
    const ev = S.data.events.find(e => (e.summary + e.description).includes(p.serial));
    if (ev && !ev.done) return ev.date === today ? 'move' : 'sched';
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
    el.onclick = () => { S.floor = +el.dataset.f; S.vb = null;
      if (S.view !== 'map') switchView('map'); renderMap(); renderTabs(); });
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
    <div class="kpi"><span class="n">${placed(0)}</span><span class="l">1ST FLOOR</span></div>
    <div class="kpi"><span class="n">${placed(1)}</span><span class="l">2ND FLOOR</span></div>
    <div class="kpi"><span class="n">${own.blp}<small> / ${own.csgn} / ${own.client}</small></span><span class="l">BLP / CONSIGN / CLIENT</span></div>
    <div class="kpi"><span class="n">${tm}</span><span class="l">MOVES TODAY</span></div>
    <div class="kpi"><span class="n">${newWeek}</span><span class="l">NEW THIS WEEK</span></div>
    <div class="kpi red" id="kpiReport"><span class="n">${un} <small>+ ${du} dup</small></span><span class="l">UNPLACED / ERRORS →</span></div>`;
  $('#kpiReport').onclick = () => switchView('report');
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
    ? evs.map(e => `<div class="tmv ${e.done ? 'done' : ''}">
        <span>${e.done ? '✓ DONE · ' : 'TODAY · '}${e.time || 'ALL DAY'}</span>
        <b>${esc(e.summary)}</b></div>`).join('')
    : '<div class="tmv none">No moves on today’s calendar.</div>';
  const fr = $('#calFrame');
  if (!fr.src) fr.src = CAL_EMBED;
}

function renderMoves() {
  const evs = todaysMoves();
  $('#moves').innerHTML = evs.length ? evs.map(e => `
    <div class="mv ${e.done ? 'done' : ''}">
      <b>${e.done ? '<span class="ck">✓</span> ' : ''}${esc(e.summary)}</b>
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

function renderMap() {
  const f = S.map.floors[S.floor];
  const q = S.search.trim().toLowerCase();
  if (!S.vb) S.vb = [0, 0, f.width, f.height];
  let s = '';
  for (const z of f.labels) {
    const filled = z.fill && z.fill !== '#ffffff';
    if (z.w > 4 && z.h > 4)
      s += `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" class="zonebox ${filled ? 'filled' : ''}"/>`;
    s += `<text x="${z.x + z.w / 2}" y="${z.y + z.h / 2 + 4}" text-anchor="middle"
          class="zlabel" font-size="${Math.min(13, Math.max(9, z.h * 0.5))}">${esc(z.text)}</text>`;
  }
  for (const w of f.walls)
    s += `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" class="wall"/>`;
  for (const sl of f.slots) {
    const ps = S.bySlot.get(sl.id.toLowerCase()) || [];
    const hit = q && (sl.id.toLowerCase() === q || ps.some(p => matches(p, q)));
    const dim = q && !hit;
    s += `<rect x="${sl.x}" y="${sl.y}" width="${sl.w}" height="${sl.h}" rx="3"
          class="slot hit ${hit ? 'hl' : ''} ${dim ? 'dim' : ''}" data-slot="${esc(sl.id)}"/>`;
    // slot number: as large as fits, parked on the left side of the box
    const fs = Math.max(11, Math.min(34, sl.h * 0.42, (sl.w * 0.9) / (sl.id.length + 0.5)));
    const numW = fs * 0.62 * sl.id.length + 8;
    s += `<text x="${sl.x + 6}" y="${sl.y + sl.h / 2 + fs * 0.36}" class="snum"
          font-size="${fs}">${esc(sl.id)}</text>`;
    // pianos: fill the remaining width, spaced so shapes never touch
    const n = ps.length;
    if (n) {
      const availW = sl.w - numW - 10;
      const per = 27;                       // icon (20) + gap (7) at scale 1
      const sc = Math.max(0.75, Math.min((sl.h - 8) / 21, availW / (n * per), 4.5));
      const x0 = sl.x + numW + (availW - n * per * sc) / 2 + (per * sc) / 2;
      ps.forEach((p, i) => {
        const st = pianoStatus(p);
        const cx = x0 + i * per * sc;
        const cy = sl.y + sl.h / 2;
        s += `<g class="piano ${st} ${q && !matches(p, q) ? 'dim' : ''} ${q && matches(p, q) ? 'hl' : ''}"
              data-slot="${esc(sl.id)}" data-row="${p.row}">${glyph(p.type, cx, cy, sc)}</g>`;
      });
    }
  }
  const svg = $('#plan');
  svg.setAttribute('viewBox', S.vb.join(' '));
  svg.innerHTML = s;
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
  return `<span class="x">✕</span>
    <span class="tag ${st}">${tags[st]} · SLOT ${esc(p.location)}</span>
    <h3>${esc(makeModel)}</h3>
    <div class="row">Serial # <b>${esc(p.serial || '—')}</b></div>
    <div class="row">Status <b>${esc(p.status || '—')}</b></div>
    <div class="row">Owner <b>${esc(p.owner || '—')}</b></div>
    <span class="btn">Open Piano Log ↗</span>`;
}
function wirePop(p) {
  const pop = $('#pop');
  pop.onclick = ev => {
    if (ev.target.classList.contains('x')) { pop.hidden = true; popPinned = false; return; }
    window.open(logLink(p), '_blank', 'noopener');
  };
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
      <span class="tag">SLOT ${esc(id)} · ${ps.length} PIANOS</span>` +
      ps.map(p => `<div class="row">• ${esc(p.summary)}</div>`).join('') +
      `<div class="row" style="color:#9e2020;font-weight:700">Multiple pianos on one slot — see Reports.</div>`;
    pop.onclick = ev => {
      if (ev.target.classList.contains('x')) { pop.hidden = true; popPinned = false; } };
  } else {
    pop.innerHTML = `<span class="x">✕</span>
      <span class="tag">SLOT ${esc(id)}</span><h3>Empty</h3>
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
  const today = new Date().toISOString().slice(0, 10);
  const byDay = {};
  evs.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  $('#board').innerHTML = Object.keys(byDay).sort().map(d => {
    const label = new Date(d + 'T12:00').toLocaleDateString('en-US',
      {weekday: 'long', month: 'short', day: 'numeric'});
    return `<div class="boardday ${d === today ? 'today' : ''}">${d === today ? 'TODAY — ' : ''}${label}</div>` +
      byDay[d].map(e => `<div class="bev ${e.done ? 'done' : ''}">
        <span class="t">${e.time || '—'}</span><span>${esc(e.summary)}${e.done ? '<span class="ck"> ✓</span>' : ''}</span>
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

function syncFeed() { $('#view-map').classList.toggle('nofeed', !S.feedOpen); }
$('#movesBtn').onclick = () => { S.feedOpen = !S.feedOpen; if (S.view !== 'map') switchView('map'); syncFeed(); };
$('#movesClose').onclick = () => { S.feedOpen = false; syncFeed(); };

$('#legendBtn').onclick = () => { const p = $('#legendPanel'); p.hidden = !p.hidden; };

$('#search').addEventListener('input', e => {
  S.search = e.target.value;
  if (S.view !== 'map') switchView('map');
  renderMap();
});

/* ---------- zoom / pan (mouse + touch pinch) ---------- */
(function zoomPan() {
  const svg = $('#plan');
  function setVB() { svg.setAttribute('viewBox', S.vb.join(' ')); }
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const [x, y, w, h] = S.vb;
    const k = e.deltaY > 0 ? 1.12 : 0.89;
    const r = svg.getBoundingClientRect();
    const mx = x + (e.clientX - r.left) / r.width * w;
    const my = y + (e.clientY - r.top) / r.height * h;
    S.vb = [mx - (mx - x) * k, my - (my - y) * k, w * k, h * k];
    setVB();
  }, {passive: false});

  const ptrs = new Map();
  let pinchDist = 0;
  svg.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) svg.classList.add('panning');
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    const r = svg.getBoundingClientRect();
    if (ptrs.size === 1) {
      const [x, y, w, h] = S.vb;
      S.vb = [x - (e.clientX - prev[0]) / r.width * w,
              y - (e.clientY - prev[1]) / r.height * h, w, h];
      setVB();
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinchDist > 0 && d > 0) {
        const k = pinchDist / d;
        const [x, y, w, h] = S.vb;
        const cxs = (a[0] + b[0]) / 2, cys = (a[1] + b[1]) / 2;
        const mx = x + (cxs - r.left) / r.width * w;
        const my = y + (cys - r.top) / r.height * h;
        S.vb = [mx - (mx - x) * k, my - (my - y) * k, w * k, h * k];
        setVB();
      }
      pinchDist = d;
    }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    svg.addEventListener(ev, e => {
      ptrs.delete(e.pointerId);
      if (!ptrs.size) svg.classList.remove('panning');
    }));
  svg.addEventListener('dblclick', () => {
    const f = S.map.floors[S.floor];
    S.vb = [0, 0, f.width, f.height];
    setVB();
  });
})();

boot();
