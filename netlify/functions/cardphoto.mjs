// /api/cardphoto?id=<Drive file id>&w=320 — the Drive backup photo for a
// for-sale piano's data card (Melissa 10/16, 101626terry92; Mark 10/19). The
// card prefers the Shopify listing's featured image; with no published
// listing it falls back to the piano's Drive photos. A browser asking Google
// for a Drive thumbnail fails whenever it is signed in to a Google account
// that can't see the file (or blocks Google's image host), so this fetches
// the public thumbnail server-side, with no cookies, and lets the CDN and
// the phone cache it.
const ID_RE = /^[A-Za-z0-9_-]{20,80}$/;

export default async (req) => {
  const u = new URL(req.url);
  const id = u.searchParams.get('id') || '';
  const w = Math.max(80, Math.min(1600, Number(u.searchParams.get('w')) || 320));
  if (!ID_RE.test(id)) return new Response('bad id', { status: 400 });
  try {
    const r = await fetch(`https://lh3.googleusercontent.com/d/${id}=w${w}`, { redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return new Response('no photo', { status: 404, headers: { 'cache-control': 'public, max-age=600' } });
    return new Response(await r.arrayBuffer(), { headers: {
      'content-type': type,
      // a Drive file id never changes its pixels unless re-uploaded under a new id
      'cache-control': 'public, max-age=604800, immutable',
      'netlify-cdn-cache-control': 'public, max-age=2592000, immutable',
    } });
  } catch (e) {
    return new Response('fetch failed', { status: 502 });
  }
};
