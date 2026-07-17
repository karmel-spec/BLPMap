// /api/slots — regenerates the floor-plan geometry straight from the
// Store Map sheet (xlsx export) using exceljs. JS port of
// scripts/extract_map.py. Cached 6 hours, so floor-plan edits in the
// spreadsheet appear on the live site the same morning with no cron,
// no commits, and no local machine.

import ExcelJS from 'exceljs';

const XLSX_URL =
  'https://docs.google.com/spreadsheets/d/12qMhAHxkRlacel5Q7qxCOwYShgDRD3O46D1cYCrlfwA/export?format=xlsx';
const FLOORS = ['First floor', 'Second floor'];
const SLOT_RE = /^\d+[a-zA-Z]?$/;
const COL_PX = 7.0, ROW_PX = 4 / 3;
const WALL_STYLES = new Set(['medium', 'thick', 'double']);
const CACHE_MS = 6 * 3600 * 1000;

let cache = { at: 0, body: null };

function sheetGeometry(ws) {
  const ncols = ws.columnCount, nrows = ws.rowCount;
  const dcw = ws.properties.defaultColWidth || 8.43;
  const drh = ws.properties.defaultRowHeight || 15.0;
  const xs = [0]; let x = 0;
  for (let c = 1; c <= ncols + 1; c++) {
    const col = ws.getColumn(c);
    x += (col && col.width ? col.width : dcw) * COL_PX + 5;
    xs.push(x);
  }
  const ys = [0]; let y = 0;
  for (let r = 1; r <= nrows + 1; r++) {
    const row = ws.getRow(r);
    y += (row && row.height ? row.height : drh) * ROW_PX;
    ys.push(y);
  }
  return { xs, ys };
}

function fillHex(cell) {
  const f = cell.fill;
  if (f && f.type === 'pattern' && f.pattern === 'solid' && f.fgColor && f.fgColor.argb) {
    const a = f.fgColor.argb;
    if (a !== '00000000' && a !== 'FFFFFFFF') return '#' + a.slice(-6).toLowerCase();
  }
  return null;
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.result !== undefined) return String(v.result);
    return String(v.text || '');
  }
  return String(v);
}

function extract(ws) {
  const { xs, ys } = sheetGeometry(ws);
  // merges: {'A1': 'A1:C3', ...} — resolve anchors and covered cells
  const merges = ws.model.merges || [];
  const anchor = new Map();   // 'r,c' of anchor -> {r1,c1,r2,c2}
  const covered = new Set();
  for (const rng of merges) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(rng);
    if (!m) continue;
    const colN = s => s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
    const c1 = colN(m[1]), r1 = +m[2], c2 = colN(m[3]), r2 = +m[4];
    anchor.set(r1 + ',' + c1, { r1, c1, r2, c2 });
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) covered.add(r + ',' + c);
  }
  const slots = [], labels = [], rawWalls = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const key = r + ',' + c;
      // walls from medium/thick borders (every cell)
      const b = cell.border || {};
      const x0 = xs[c - 1], x1 = xs[c], y0 = ys[r - 1], y1 = ys[r];
      if (b.top && WALL_STYLES.has(b.top.style)) rawWalls.push(['h', y0, x0, x1]);
      if (b.bottom && WALL_STYLES.has(b.bottom.style)) rawWalls.push(['h', y1, x0, x1]);
      if (b.left && WALL_STYLES.has(b.left.style)) rawWalls.push(['v', x0, y0, y1]);
      if (b.right && WALL_STYLES.has(b.right.style)) rawWalls.push(['v', x1, y0, y1]);
      // values
      const text = cellText(cell.value).trim();
      if (!text) return;
      if (covered.has(key) && !anchor.has(key)) return;
      let X = x0, Y = y0, W = x1 - x0, H = y1 - y0;
      if (anchor.has(key)) {
        const a = anchor.get(key);
        X = xs[a.c1 - 1]; Y = ys[a.r1 - 1];
        W = xs[a.c2] - X; H = ys[a.r2] - Y;
      }
      const item = { x: rnd(X), y: rnd(Y), w: rnd(W), h: rnd(H) };
      const fill = fillHex(cell);
      if (fill) item.fill = fill;
      if (SLOT_RE.test(text)) slots.push({ id: text, ...item });
      else labels.push({ text, ...item });
    });
  });
  // merge collinear wall segments
  const groups = new Map();
  for (const [kind, k, a, b2] of rawWalls) {
    const gk = kind + ':' + k.toFixed(1);
    if (!groups.has(gk)) groups.set(gk, { kind, k, spans: [] });
    groups.get(gk).spans.push([Math.min(a, b2), Math.max(a, b2)]);
  }
  const walls = [];
  for (const { kind, k, spans } of groups.values()) {
    spans.sort((s, t) => s[0] - t[0]);
    let [c0, c1] = spans[0];
    for (let i = 1; i < spans.length; i++) {
      const [a, b2] = spans[i];
      if (a <= c1 + 0.5) c1 = Math.max(c1, b2);
      else { pushWall(walls, kind, k, c0, c1); [c0, c1] = [a, b2]; }
    }
    pushWall(walls, kind, k, c0, c1);
  }
  // crop to content bbox
  const items = slots.concat(labels);
  const px = items.flatMap(s => [s.x, s.x + s.w])
    .concat(walls.flatMap(w => [w.x1, w.x2]));
  const py = items.flatMap(s => [s.y, s.y + s.h])
    .concat(walls.flatMap(w => [w.y1, w.y2]));
  const minx = Math.min(...px) - 20, miny = Math.min(...py) - 20;
  const maxx = Math.max(...px) + 20, maxy = Math.max(...py) + 20;
  for (const s of items) { s.x = rnd(s.x - minx); s.y = rnd(s.y - miny); }
  for (const w of walls) {
    w.x1 = rnd(w.x1 - minx); w.x2 = rnd(w.x2 - minx);
    w.y1 = rnd(w.y1 - miny); w.y2 = rnd(w.y2 - miny);
  }
  return { width: rnd(maxx - minx), height: rnd(maxy - miny), slots, labels, walls };
}

const rnd = n => Math.round(n * 10) / 10;
function pushWall(walls, kind, k, a, b) {
  walls.push(kind === 'h'
    ? { x1: rnd(a), y1: rnd(k), x2: rnd(b), y2: rnd(k) }
    : { x1: rnd(k), y1: rnd(a), x2: rnd(k), y2: rnd(b) });
}

export async function buildSlots() {
  const res = await fetch(XLSX_URL);
  if (!res.ok) throw new Error('xlsx download ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const floors = [];
  for (const name of FLOORS) {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new Error('missing sheet: ' + name);
    const data = extract(ws);
    data.name = name;
    floors.push(data);
  }
  return { floors, generatedAt: new Date().toISOString() };
}

export default async () => {
  const now = Date.now();
  if (cache.body && now - cache.at < CACHE_MS) {
    return new Response(cache.body, {
      headers: { 'content-type': 'application/json', 'x-slots-cache': 'hit' },
    });
  }
  try {
    const body = JSON.stringify(await buildSlots());
    cache = { at: now, body };
    return new Response(body, { headers: { 'content-type': 'application/json' } });
  } catch (err) {
    if (cache.body) {
      return new Response(cache.body, {
        headers: { 'content-type': 'application/json', 'x-slots-cache': 'stale' },
      });
    }
    // last resort: the committed snapshot redirect is handled client-side
    return Response.json({ error: String(err) }, { status: 502 });
  }
};
