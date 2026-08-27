// /api/print?id=<googleDocId> — printable copy of a daily-brief Google Doc.
// Fetches the doc's public HTML export (the briefs are shared
// anyone-with-link) and serves it inline with an auto-opened print
// dialog, so the reports view can offer one-click 🖨 print links
// instead of the download-only PDF export.

const DOC_ID = /^[-\w]{20,80}$/;

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!DOC_ID.test(id)) return new Response('bad doc id', { status: 400 });
  const r = await fetch(
    `https://docs.google.com/document/d/${id}/export?format=html`,
    { redirect: 'follow' });
  if (!r.ok) {
    return new Response('Could not load that document (is it still shared?).',
      { status: 502 });
  }
  let html = await r.text();
  const extra = `<style>@page { margin: 14mm; } body { max-width: 7.5in; }</style>
<script>onload = () => setTimeout(() => print(), 350)</script>`;
  html = html.includes('</body>')
    ? html.replace('</body>', extra + '</body>')
    : html + extra;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};
