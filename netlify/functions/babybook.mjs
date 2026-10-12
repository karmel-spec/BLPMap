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

    return json({ error: 'unknown op' }, 400);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 502);
  }
};
