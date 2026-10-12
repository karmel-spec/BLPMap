// /api/babybook — Myles's baby book (Brigham 10/12). The birth story ships
// with the page (babybook/story.js); this function stores what Abby adds or
// changes from her phone and the photos she attaches.
//   POST {op:'list', pin}                         -> {chapters, entries}
//   POST {op:'save_chapter', pin, chapter}        -> {ok}
//   POST {op:'save_entry', pin, entry}            -> {ok}
//   POST {op:'upload', pin, name, type, data}     -> {url}   (data = base64 JPEG/PNG, ≤ 5 MB)
// Rows live in Supabase babybook_chapters / babybook_entries
// (supabase/babybook.sql); photos in the public `babybook` storage bucket.
// Everything is gated by the family passphrase in the BABYBOOK_PIN env var —
// reads too, since it's a family book, not a worksheet.

import { timingSafeEqual } from 'node:crypto';

const SB_URL = (process.env.SUPABASE_URL || 'https://ismacawxfvvllfinibbf.supabase.co').replace(/\/$/, '');
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PIN = String(process.env.BABYBOOK_PIN || '');
const BUCKET = 'babybook';
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function pinOk(given) {
  const a = Buffer.from(String(given || '').trim().toLowerCase());
  const b = Buffer.from(PIN.trim().toLowerCase());
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

const sb = (path, init) => fetch(SB_URL + '/rest/v1/' + path, {
  ...init,
  headers: { apikey: SB_SERVICE_KEY, Authorization: 'Bearer ' + SB_SERVICE_KEY,
    'content-type': 'application/json', ...(init && init.headers || {}) },
  signal: AbortSignal.timeout(10000),
});

// Pull [url, width, height] triples and the first plausible ms timestamp (plus UTC offset)
// that follows each one out of a shared album page. Tolerant of the surrounding structure.
export function parseAlbum(html) {
  const out = []; const seen = new Set();
  const re = /\["(https:\/\/lh3\.googleusercontent\.com\/[^"]+)",(\d+),(\d+)/g;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1]; if (seen.has(src)) continue; seen.add(src);
    const width = +m[2], height = +m[3];
    if (width < 200 || height < 200) continue;                       // avatars, thumbnails
    const tail = html.slice(m.index, m.index + 600);
    const ts = /[\[,](1[5-9]\d{11}|2\d{12})[,\]]/.exec(tail);          // ms since epoch, 2017..2100
    let takenAt = null;
    if (ts) {
      const after = tail.slice(ts.index + ts[0].length);
      const off = /[\[,](-?\d{5,8})[,\]]/.exec(after);                  // UTC offset in ms, e.g. -21600000
      const offsetMs = off && Math.abs(+off[1]) <= 14 * 3600000 && (+off[1]) % 900000 === 0 ? +off[1] : null;
      takenAt = { ms: +ts[1], offsetMs };
    }
    out.push({ src, width, height, takenAt });
  }
  return out;
}

// EXIF DateTimeOriginal ("YYYY:MM:DD HH:MM:SS", camera-local) from a JPEG's first bytes.
export function exifDateTime(v) {
  try {
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 4 <= v.byteLength) {
      const marker = v.getUint16(o), len = v.getUint16(o + 2);
      if (marker === 0xFFE1 && o + 10 < v.byteLength && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const g16 = (p) => v.getUint16(p, le), g32 = (p) => v.getUint32(p, le);
        const find = (ifd, tag) => { if (ifd + 2 > v.byteLength) return -1; const n = g16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (e + 12 > v.byteLength) return -1; if (g16(e) === tag) return e; } return -1; };
        const ex = find(t + g32(t + 4), 0x8769); if (ex < 0) return null;
        let e = find(t + g32(ex + 8), 0x9003); if (e < 0) e = find(t + g32(ex + 8), 0x9004); if (e < 0) return null;
        const off = t + g32(e + 8); let s = '';
        for (let i = 0; i < 19 && off + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(off + i));
        return /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? s : null;
      }
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
      o += 2 + len;
    }
  } catch (e) { /* fall through */ }
  return null;
}

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const safeId = (v) => str(v, 60).replace(/[^a-zA-Z0-9_-]/g, '');

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SB_SERVICE_KEY || !PIN) return json({ error: 'baby book not configured — set BABYBOOK_PIN and SUPABASE_SERVICE_KEY in Netlify env vars' }, 501);
  let body;
  try { body = await req.json(); } catch (e) { body = {}; }
  if (!pinOk(body.pin)) return json({ error: 'That passphrase is not right.' }, 401);
  const op = String(body.op || 'list');

  try {
    if (op === 'list') {
      const [c, e] = await Promise.all([
        sb('babybook_chapters?select=*&order=sort.asc'),
        sb('babybook_entries?select=*&order=sort.asc'),
      ]);
      if (!c.ok || !e.ok) return json({ error: 'Supabase read failed' }, 502);
      return json({ chapters: await c.json(), entries: await e.json() });
    }

    if (op === 'save_chapter') {
      const ch = body.chapter || {};
      const id = safeId(ch.id);
      if (!id) return json({ error: 'chapter id required' }, 400);
      const row = { id, title: str(ch.title, 120), subtitle: str(ch.subtitle, 200), big: str(ch.big, 24),
        sort: Number(ch.sort) || 0, deleted: ch.deleted === true, updated_at: new Date().toISOString() };
      const r = await sb('babybook_chapters?on_conflict=id', { method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([row]) });
      if (!r.ok) return json({ error: 'Supabase ' + r.status + ': ' + (await r.text()).slice(0, 160) }, 502);
      return json({ ok: true });
    }

    if (op === 'save_entry') {
      const en = body.entry || {};
      const id = safeId(en.id);
      if (!id) return json({ error: 'entry id required' }, 400);
      const photos = Array.isArray(en.photos) ? en.photos.slice(0, 12).map(p => ({
        url: str(p && p.url, 400), caption: str(p && p.caption, 200) })).filter(p => /^https:\/\//.test(p.url)) : [];
      const kind = ['moment', 'quote', 'feature', 'cover', 'facts'].includes(en.kind) ? en.kind : 'moment';
      const row = { id, chapter: safeId(en.chapter), time_label: str(en.time, 40), sort: Number(en.sort) || 0, kind,
        title: str(en.title, 160), body: str(en.body, 4000), cite: str(en.cite, 200), photos,
        deleted: en.deleted === true, updated_at: new Date().toISOString() };
      const r = await sb('babybook_entries?on_conflict=id', { method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([row]) });
      if (!r.ok) return json({ error: 'Supabase ' + r.status + ': ' + (await r.text()).slice(0, 160) }, 502);
      return json({ ok: true });
    }

    if (op === 'upload') {
      const type = body.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const ext = type === 'image/png' ? 'png' : 'jpg';
      const data = String(body.data || '').replace(/^data:[^,]*,/, '');
      const buf = Buffer.from(data, 'base64');
      if (!buf.length) return json({ error: 'no photo data' }, 400);
      if (buf.length > MAX_PHOTO_BYTES) return json({ error: 'photo too large (5 MB max after resizing)' }, 413);
      const name = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const r = await fetch(SB_URL + '/storage/v1/object/' + BUCKET + '/' + name, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + SB_SERVICE_KEY, 'content-type': type, 'cache-control': 'public, max-age=31536000' },
        body: buf, signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) return json({ error: 'Storage ' + r.status + ': ' + (await r.text()).slice(0, 160) }, 502);
      return json({ url: SB_URL + '/storage/v1/object/public/' + BUCKET + '/' + name });
    }

    // Google Photos shared album: list every photo with its taken-at time, from the album page itself.
    //   POST {op:'album', pin, url} -> {title, photos:[{src, width, height, takenAt}]}
    // The shared-album page embeds its data in AF_initDataCallback; each item carries the
    // lh3 base URL, pixel size and the creation timestamp (ms) plus the camera's UTC offset.
    if (op === 'album') {
      const shareUrl = String(body.url || '').trim();
      if (!/^https:\/\/(photos\.app\.goo\.gl|photos\.google\.com|goo\.gl)\//.test(shareUrl)) return json({ error: 'paste a Google Photos share link (photos.app.goo.gl/… or photos.google.com/share/…)' }, 400);
      const r = await fetch(shareUrl, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) return json({ error: 'Google Photos answered ' + r.status + ' for that link' }, 502);
      const html = await r.text();
      const photos = parseAlbum(html);
      const t = /<meta property="og:title" content="([^"]*)"/.exec(html);
      if (!photos.length) return json({ error: 'No photos found at that link. Make sure the album is shared with "anyone with the link".' }, 404);
      return json({ title: t ? t[1] : '', photos, finalUrl: r.url });
    }

    // Copy one album photo into the bucket (server side, so the phone never downloads it).
    //   POST {op:'import', pin, src} -> {url}
    if (op === 'import') {
      const src = String(body.src || '');
      if (!/^https:\/\/lh3\.googleusercontent\.com\//.test(src)) return json({ error: 'not a Google Photos image URL' }, 400);
      const base = src.replace(/=[^/]*$/, '');
      // taken-at from the original's EXIF (first 256 KB is enough), best effort
      let takenAt = null;
      try {
        const o = await fetch(base + '=d', { headers: { Range: 'bytes=0-262143' }, signal: AbortSignal.timeout(12000) });
        if (o.ok) takenAt = exifDateTime(new DataView(await o.arrayBuffer()));
      } catch (e) { takenAt = null; }
      const r = await fetch(base + '=w2400-h2400', { signal: AbortSignal.timeout(20000) });
      if (!r.ok) return json({ error: 'Google answered ' + r.status + ' for that photo' }, 502);
      const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) return json({ error: 'empty photo' }, 502);
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      const name = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const up = await fetch(SB_URL + '/storage/v1/object/' + BUCKET + '/' + name, {
        method: 'POST', headers: { Authorization: 'Bearer ' + SB_SERVICE_KEY, 'content-type': type, 'cache-control': 'public, max-age=31536000' },
        body: buf, signal: AbortSignal.timeout(20000),
      });
      if (!up.ok) return json({ error: 'Storage ' + up.status + ': ' + (await up.text()).slice(0, 160) }, 502);
      return json({ url: SB_URL + '/storage/v1/object/public/' + BUCKET + '/' + name, takenAt });
    }

    return json({ error: 'unknown op' }, 400);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 502);
  }
};
