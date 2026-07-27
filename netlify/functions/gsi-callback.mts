/**
 * Google Sign-In redirect callback (ux_mode: 'redirect').
 *
 * The map's sign-in button sends the browser to Google; Google POSTs the
 * ID-token credential here (form_post). We hand it to the app by stashing
 * it in localStorage and bouncing back to the map, where startup code
 * consumes it (see app.js). No popups, no dialogs — works in every browser.
 *
 * Requires this URL in the OAuth client's "Authorized redirect URIs":
 *   https://blpstoremap.netlify.app/.netlify/functions/gsi-callback
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }
  let credential = "";
  try {
    const form = await req.formData();
    credential = String(form.get("credential") || "");
    // double-submit CSRF check (Google sends the token as cookie + field)
    const bodyTok = String(form.get("g_csrf_token") || "");
    const cookieTok = /(?:^|;\s*)g_csrf_token=([^;]+)/.exec(req.headers.get("cookie") || "")?.[1] || "";
    if (!bodyTok || bodyTok !== cookieTok) credential = "";
  } catch (e) { credential = ""; }

  // JWT charset is [A-Za-z0-9_.-] — JSON.stringify + tag-break guard anyway
  const safe = JSON.stringify(credential).replace(/</g, "\\u003c");
  const html = `<!doctype html><meta charset="utf-8"><title>Signing in…</title>
<body style="background:#0d0d0d;color:#a8a8aa;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<div>Signing in…</div>
<script>
  try { var c = ${safe}; if (c) localStorage.setItem("blpGsiCred", c); } catch (e) {}
  location.replace("/");
</script></body>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
};
