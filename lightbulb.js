/**
 * BLP 💡 lightbulb — one app-request front door per BLP app (Karmel 10/29).
 *
 *   <script src="https://blpstoremap.netlify.app/lightbulb.js" defer
 *           data-app="CRM" data-session="/api/lightbulb"></script>
 *
 * data-app      : the app's name on the fix list (bridge REQUEST_APPS — CRM,
 *                 Sales App, Marketing, …). No picker: the app files as itself.
 * data-session  : optional same-origin URL, fetched with the app's own cookies,
 *                 answering {name, email, admin, key}. That is how the host
 *                 app says who is signed in, whether they see the admin panel
 *                 and which team key the bridge should get. Without it (or
 *                 when it fails) the widget asks for a name and the team PIN.
 * data-dock     : optional CSS selector; the 💡 renders inline inside it.
 * data-position : bottom-left (default) | bottom-right | top-right.
 *
 * Everything lands in the ONE Requests tab behind the Store Map bridge (IDs,
 * status flow, Live texts, the App Requests report and the daily brief all
 * stay there). Everyone gets the 💡 + their own "My requests"; admins also get
 * the App Requests panel listing only this app's requests (?fn=requests&app=)
 * with In progress / Live / Tested and Copy for Claude. Every write carries the
 * team key and goes through the bridge's own auth — nothing here bypasses it.
 *
 * Page hooks: window.BLPLightbulb.open() / .openAdmin() / .refresh();
 * #requests in the URL opens the admin panel on load.
 */
(function () {
  'use strict';
  if (window.BLPLightbulb) return;

  var BRIDGE = 'https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec';
  var SHOT_URL = 'https://blpsalesapp.netlify.app/.netlify/functions/request-shot';
  var script = document.currentScript || {};
  var ds = script.dataset || {};
  var APP = ds.app || document.title.slice(0, 30) || 'Other';
  var SESSION_URL = ds.session || '';
  var DOCK = ds.dock || '';
  var POS = ds.position || 'bottom-left';
  var LS_NAME = 'blp_lightbulb_name', LS_KEY = 'blp_lightbulb_key';
  var ICON = {bug: '🐛', edit: '✏️', idea: '💡', handbook: '📖'};
  var CLOSED = ['Live', 'Tested', 'Declined', 'Duplicate', 'Resolved', 'Archived'];

  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* blocked */ } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fetchT(url, opts, ms) {
    var c = new AbortController();
    var t = setTimeout(function () { c.abort(); }, ms || 30000);
    return fetch(url, Object.assign({signal: c.signal}, opts || {})).finally(function () { clearTimeout(t); });
  }

  /* ---------- who is this (host session → else remembered name / PIN) ---------- */
  var S = {name: '', email: '', admin: false, key: '', fromHost: false, loaded: false};
  var sessionP = null;
  function loadSession(force) {
    if (sessionP && !force) return sessionP;
    sessionP = (async function () {
      if (SESSION_URL) {
        try {
          var r = await fetchT(SESSION_URL, {credentials: 'same-origin', cache: 'no-store'}, 12000);
          if (r.ok) {
            var j = await r.json();
            if (j && (j.name || j.email)) {
              S.name = String(j.name || j.email.split('@')[0]);
              S.email = String(j.email || '');
              S.admin = !!j.admin;
              S.key = String(j.key || '');
              S.fromHost = true;
            }
          }
        } catch (e) { /* fall back to asking */ }
      }
      if (!S.name) S.name = lsGet(LS_NAME) || lsGet('blp_suggest_name');
      if (!S.key) S.key = lsGet(LS_KEY);
      S.loaded = true;
      paintBtn();
      return S;
    })();
    return sessionP;
  }

  /* ---------- bridge ---------- */
  async function listRequests() {
    for (var a = 0; a < 3; a++) {
      try {
        var r = await fetchT(BRIDGE + '?fn=requests&app=' + encodeURIComponent(APP), {redirect: 'follow'}, 30000);
        var j = await r.json();
        if (j && Array.isArray(j.requests)) return j.requests;
      } catch (e) { /* retry */ }
      await sleep(800 * (a + 1));
    }
    throw new Error('couldn’t reach the request list');
  }
  // the bridge sometimes answers its generic ping without running the action —
  // a reply only counts when it carries what we asked for (same rule as the map)
  async function bridgePost(body, okField) {
    var j = null;
    for (var a = 0; a < 3; a++) {
      try {
        var r = await fetchT(BRIDGE, {method: 'POST', redirect: 'follow',
          headers: {'content-type': 'text/plain;charset=utf-8'}, body: JSON.stringify(body)}, 45000);
        j = await r.json();
      } catch (e) { j = null; }
      if (j && j.ok && j[okField]) return j;
      if (j && j.error) break;
      await sleep(1000 * (a + 1));
    }
    if (j && j.error === 'unauthorized' && !S.fromHost) { S.key = ''; lsSet(LS_KEY, ''); }
    throw new Error(j && j.error === 'unauthorized'
      ? 'the team PIN wasn’t accepted — check it and try again'
      : (j && j.error) || 'the Google bridge hiccuped — try again in a few seconds');
  }
  function authBody() {
    return {pin: S.key, user: {name: S.name, email: S.email}, app: APP};
  }

  /* ---------- styles (shadow DOM keeps the host's CSS out, and ours in) ---------- */
  var CSS = ':host{all:initial}' +
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
    '.btn{position:fixed;z-index:2147482000;width:44px;height:44px;border-radius:50%;background:#1f1b17;color:#ffd34d;border:1px solid rgba(255,255,255,.25);cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.3);font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;transition:transform .15s;padding:0}' +
    '.btn:hover{transform:scale(1.08)}' +
    '.btn.bl{left:18px;bottom:18px}.btn.br{right:18px;bottom:18px}.btn.tr{right:14px;top:12px;width:40px;height:40px;font-size:18px}' +
    '.btn.dock{position:relative;width:34px;height:34px;font-size:17px;box-shadow:none;border-color:rgba(255,255,255,.35)}' +
    '.badge{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;border-radius:9px;background:#b3261e;color:#fff;font-size:10.5px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px;border:2px solid #fff}' +
    '.badge[hidden]{display:none}' +
    '.pop{position:fixed;z-index:2147482001;width:min(360px,calc(100vw - 24px));max-height:min(600px,calc(100vh - 90px));background:#fff;color:#221d18;border-radius:14px;box-shadow:0 12px 44px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden;font-size:13.5px}' +
    '.pop.open{display:flex}' +
    '.pop.bl{left:14px;bottom:72px}.pop.br{right:14px;bottom:72px}.pop.tr{right:14px;top:60px}' +
    '@media (max-width:760px){.pop{left:12px!important;right:12px!important;width:auto;bottom:70px!important;top:auto!important}}' +
    '.head{background:#1f1b17;color:#fff;padding:11px 14px;display:flex;align-items:center;gap:8px}' +
    '.head b{display:block;font-size:14px}.head span{font-size:11.5px;opacity:.75}' +
    '.x{margin-left:auto;background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:2px 4px}' +
    '.body{padding:12px 14px;overflow-y:auto}' +
    '.types{display:flex;gap:6px;margin-bottom:8px}' +
    '.type{flex:1;border:1px solid #d8d0c4;background:#faf7f2;border-radius:8px;padding:7px 4px;font-size:12.5px;cursor:pointer;color:inherit}' +
    '.type.on{border-color:#8a1e1e;background:#f6e9e9;font-weight:600}' +
    'textarea,input[type=text],input[type=password],select{width:100%;border:1px solid #d8d0c4;border-radius:8px;padding:8px 10px;font-size:13.5px;color:#221d18;background:#fff}' +
    'textarea{min-height:80px;resize:vertical}' +
    '.row{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}' +
    '.row input{flex:1;min-width:120px}' +
    '.shot{font-size:12.5px;cursor:pointer;color:#6b6259;white-space:nowrap}' +
    '.send{margin-left:auto;background:#8a1e1e;color:#fff;border:none;border-radius:8px;padding:9px 15px;font-size:13.5px;font-weight:600;cursor:pointer}' +
    '.send:disabled{opacity:.55;cursor:default}' +
    '.prev{margin-top:8px;display:flex;gap:8px;align-items:center}.prev[hidden]{display:none}' +
    '.prev img{height:46px;border-radius:6px;border:1px solid #d8d0c4}' +
    '.msg{font-size:12.5px;margin-top:8px;min-height:16px}.msg.ok{color:#2e7d46}.msg.err{color:#a02020}' +
    '.mine{border-top:1px solid #eee6da;padding:10px 14px;max-height:200px;overflow-y:auto;font-size:12.5px}' +
    '.cap{font-size:11px;color:#6b6259;text-transform:uppercase;letter-spacing:.5px;font-weight:700}' +
    '.req{display:flex;gap:6px;align-items:flex-start;padding:5px 0}' +
    '.st{font-size:10.5px;padding:2px 7px;border-radius:99px;background:#eee6da;white-space:nowrap;flex:none}' +
    '.st.sLive{background:#dcefe2;color:#205c35}.st.sTested{background:#e4e4f5;color:#3a3a7a}.st.sInprogress{background:#fdeed3;color:#7a5a12}.st.sDeclined,.st.sDuplicate{background:#f1eeee;color:#7a6e6e}' +
    '.mini{border:1px solid #2e7d46;color:#2e7d46;background:none;border-radius:7px;font-size:11px;padding:2px 7px;cursor:pointer;white-space:nowrap}' +
    '.adminlink{display:block;width:100%;margin-top:10px;border:1px solid #1f1b17;background:#1f1b17;color:#ffd34d;border-radius:8px;padding:8px;font-size:13px;font-weight:600;cursor:pointer}' +
    /* admin drawer — a right-side panel so the app stays visible beside it */
    '.drawer{position:fixed;z-index:2147482002;top:0;right:0;bottom:0;width:min(460px,100vw);background:#fbf9f6;color:#221d18;box-shadow:-10px 0 40px rgba(0,0,0,.28);display:none;flex-direction:column;font-size:13.5px}' +
    '.drawer.open{display:flex}' +
    '.dhead{background:#1f1b17;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:8px}' +
    '.dhead b{font-size:15px}.dhead span{font-size:11.5px;opacity:.75;display:block}' +
    '.ref{background:none;border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:7px;padding:4px 8px;cursor:pointer;font-size:12px}' +
    '.filters{display:flex;gap:6px;padding:10px 14px 6px;flex-wrap:wrap;align-items:center}' +
    '.f{border:1px solid #d8d0c4;background:#fff;border-radius:99px;padding:4px 10px;font-size:12px;cursor:pointer;color:inherit}' +
    '.f.on{background:#1f1b17;color:#fff;border-color:#1f1b17}' +
    '.q{margin:0 14px 8px;width:calc(100% - 28px)}' +
    '.list{overflow-y:auto;padding:0 14px 20px;flex:1}' +
    '.card{background:#fff;border:1px solid #e6dfd4;border-radius:10px;padding:10px 12px;margin-top:8px}' +
    '.ctop{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12.5px}' +
    '.ctop small{color:#8a847b}' +
    '.chip{font-size:10.5px;padding:2px 7px;border-radius:99px;background:#f0ebe3}' +
    '.chip.bug{background:#fbe3e1;color:#8a1e1e}.chip.idea{background:#e7f0fb;color:#2c5d96}' +
    '.ctext{margin:6px 0 4px;white-space:pre-wrap;word-break:break-word;line-height:1.4}' +
    '.cmeta{font-size:11.5px;color:#8a847b;word-break:break-word}.cmeta a{color:#2c5d96}' +
    '.cbtns{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center}' +
    '.sb{border:1px solid #cfc7ba;background:#fff;border-radius:7px;padding:5px 9px;font-size:12px;cursor:pointer;color:inherit}' +
    '.sb.cur{background:#1f1b17;color:#fff;border-color:#1f1b17;cursor:default}' +
    '.sb:disabled{opacity:.6}' +
    '.more{width:auto;padding:4px 6px;font-size:12px}' +
    '.copy{margin-left:auto}' +
    '.empty{color:#8a847b;font-style:italic;padding:18px 0;text-align:center}' +
    '.toast{position:fixed;z-index:2147482003;left:50%;bottom:24px;transform:translateX(-50%);background:#1f1b17;color:#fff;border-radius:10px;padding:9px 14px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.3);display:none}' +
    '.toast.on{display:block}';

  var host = document.createElement('div');
  host.id = 'blp-lightbulb';
  var root = host.attachShadow ? host.attachShadow({mode: 'open'}) : host;
  var posCls = POS === 'top-right' ? 'tr' : POS === 'bottom-right' ? 'br' : 'bl';
  root.innerHTML = '<style>' + CSS + '</style>' +
    '<button class="btn ' + posCls + '" type="button" title="Suggest an improvement to the ' + esc(APP) + '">💡<span class="badge" hidden></span></button>' +
    '<div class="pop ' + posCls + '" role="dialog" aria-label="Suggest an improvement">' +
      '<div class="head"><div><b>💡 Suggest an improvement</b><span>bugs, edits, ideas for the ' + esc(APP) + ' — straight onto the fix list</span></div>' +
      '<button class="x" type="button" aria-label="close">✕</button></div>' +
      '<div class="body">' +
        '<div class="types"><button type="button" class="type on" data-t="edit">✏️ Edit</button>' +
        '<button type="button" class="type" data-t="idea">💡 Idea</button></div>' +
        '<textarea class="text" maxlength="1500" placeholder="What’s wrong / what would make it better? A sentence or two is plenty."></textarea>' +
        '<div class="row idrow" hidden><input type="text" class="who" maxlength="40" placeholder="Your name">' +
        '<input type="password" class="pin" maxlength="40" placeholder="Team PIN" autocomplete="off"></div>' +
        '<div class="row"><label class="shot">📷 Attach screenshot<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>' +
        '<button type="button" class="send">Send it 🚀</button></div>' +
        '<div class="prev" hidden><img alt="screenshot preview"><button type="button" class="mini rm">✕ remove</button></div>' +
        '<div class="msg"></div>' +
        '<button type="button" class="adminlink" hidden>🛡 App Requests — ' + esc(APP) + '</button>' +
      '</div>' +
      '<div class="mine"><div class="cap">My requests</div><div class="minelist">…</div></div>' +
    '</div>' +
    '<aside class="drawer" aria-label="App Requests">' +
      '<div class="dhead"><div><b>🛡 App Requests — ' + esc(APP) + '</b><span class="dsub">loading…</span></div>' +
      '<button class="ref" type="button" title="reload">🔄</button><button class="x dx" type="button" aria-label="close">✕</button></div>' +
      '<div class="filters">' +
        '<button type="button" class="f on" data-f="open">Open</button><button type="button" class="f" data-f="Live">Live</button>' +
        '<button type="button" class="f" data-f="Tested">Tested</button><button type="button" class="f" data-f="all">All</button></div>' +
      '<input type="text" class="q" placeholder="🔍 words, name, or request id…">' +
      '<div class="list"></div>' +
    '</aside>' +
    '<div class="toast"></div>';

  var $ = function (sel) { return root.querySelector(sel); };
  var btn = $('.btn'), pop = $('.pop'), drawer = $('.drawer'), badge = $('.badge');
  var msg = $('.msg');

  function mount() {
    var dockEl = null;
    try { dockEl = DOCK ? document.querySelector(DOCK) : null; } catch (e) { dockEl = null; }
    if (dockEl) {
      // docked: the button lives in the host's element, the popover stays in our root
      btn.classList.add('dock');
      var inline = document.createElement('span');
      var iroot = inline.attachShadow ? inline.attachShadow({mode: 'open'}) : inline;
      iroot.innerHTML = '<style>' + CSS + '</style>';
      iroot.appendChild(btn);
      dockEl.appendChild(inline);
    }
    document.body.appendChild(host);
    loadSession().then(function () {
      if (S.admin) refreshAdmin();
      if (/^#requests\b/.test(location.hash) && S.admin) openAdmin();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  var toastT = null;
  function toast(t) {
    var el = $('.toast');
    el.textContent = t; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('on'); }, 3200);
  }

  /* ---------- suggest popover ---------- */
  var type = 'edit', shotFile = null;
  root.querySelectorAll('.type').forEach(function (b) {
    b.onclick = function () {
      root.querySelectorAll('.type').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); type = b.dataset.t;
    };
  });
  function paintIdRow() {
    var needName = !S.name, needKey = !S.key;
    $('.idrow').hidden = !(needName || needKey);
    $('.who').hidden = !needName;
    $('.pin').hidden = !needKey;
    if (needName) $('.who').value = $('.who').value || '';
  }
  function paintBtn() {
    $('.adminlink').hidden = !S.admin;
    paintIdRow();
  }
  btn.onclick = function () {
    var open = !pop.classList.contains('open');
    pop.classList.toggle('open', open);
    if (open) { loadSession().then(function () { paintIdRow(); loadMine(); }); setTimeout(function () { $('.text').focus(); }, 30); }
  };
  root.querySelectorAll('.pop .x').forEach(function (x) { x.onclick = function () { pop.classList.remove('open'); }; });
  $('.adminlink').onclick = function () { pop.classList.remove('open'); openAdmin(); };

  var fin = $('.shot input'), prev = $('.prev');
  fin.onchange = function () {
    shotFile = fin.files && fin.files[0];
    if (!shotFile) { prev.hidden = true; return; }
    var rd = new FileReader();
    rd.onload = function () { if (shotFile) { prev.querySelector('img').src = rd.result; prev.hidden = false; } };
    rd.readAsDataURL(shotFile);
  };
  function clearShot() { shotFile = null; fin.value = ''; prev.hidden = true; prev.querySelector('img').removeAttribute('src'); }
  $('.rm').onclick = clearShot;

  function downscale(file, max, q) {
    return new Promise(function (res, rej) {
      var rd = new FileReader();
      rd.onerror = rej;
      rd.onload = function () {
        var img = new Image();
        img.onerror = rej;
        img.onload = function () {
          var k = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', q));
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }

  $('.send').onclick = async function () {
    var send = $('.send');
    if (send.disabled) return;
    var text = $('.text').value.trim();
    if (!text) { msg.className = 'msg err'; msg.textContent = 'Write a sentence first.'; return; }
    await loadSession();
    if (!S.name) {
      var nm = $('.who').value.trim();
      if (!nm) { msg.className = 'msg err'; msg.textContent = 'Add your name so we know who to thank.'; return; }
      S.name = nm; lsSet(LS_NAME, nm);
    }
    if (!S.key) {
      var pin = $('.pin').value.trim();
      if (!pin) { msg.className = 'msg err'; msg.textContent = 'Enter the team PIN (same as the Store Map’s).'; return; }
      S.key = pin;
    }
    send.disabled = true; send.textContent = 'Sending…';
    msg.className = 'msg'; msg.textContent = shotFile ? 'Uploading screenshot…' : 'Sending…';
    var phone = window.innerWidth <= 760 || /iphone|android.*mobile|ipad/i.test(navigator.userAgent);
    var body = Object.assign(authBody(), {action: 'suggest', type: type, text: text,
      context: (location.pathname + location.search).slice(0, 160) + (phone ? ' · 📱 phone' : ' · 💻 computer') + ' · via 💡 lightbulb'});
    var shotNote = '';
    try {
      if (shotFile) {
        var dataUrl = await downscale(shotFile, 1600, 0.85).catch(function () { return null; });
        if (!dataUrl) shotNote = 'this browser can’t read that image format — take a screenshot (PNG) and attach it to a follow-up';
        else {
          var uj = null;
          for (var ua = 0; ua < 2 && !(uj && uj.url); ua++) {
            try {
              var up = await fetchT(SHOT_URL, {method: 'POST', headers: {'content-type': 'application/json'},
                body: JSON.stringify({key: S.key, id: Date.now().toString(36), photo: dataUrl.split(',')[1],
                  photoType: 'image/jpeg', photoName: (shotFile.name || 'screenshot.png').replace(/[^\w.-]+/g, '_').slice(0, 40)})}, 45000);
              uj = await up.json().catch(function () { return null; });
            } catch (eUp) { uj = null; }
          }
          if (uj && uj.url) body.screenshotUrl = uj.url;
          else shotNote = 'the screenshot upload didn’t go through — attach it to a follow-up';
        }
      }
      var j = await bridgePost(body, 'id');
      if (!S.fromHost) lsSet(LS_KEY, S.key);
      msg.className = 'msg ok';
      msg.textContent = '✓ Filed as ' + j.id + (shotNote ? ' — WITHOUT the picture: ' + shotNote + '.'
        : ' — thank you! You’ll see it move to Live here when it ships.');
      $('.text').value = ''; clearShot(); paintIdRow();
      loadMine(true);
    } catch (e) {
      msg.className = 'msg err'; msg.textContent = '✗ ' + e.message;
      paintIdRow();
    }
    send.disabled = false; send.textContent = 'Send it 🚀';
  };

  /* ---------- shared list (one fetch feeds My requests + the admin panel) ---------- */
  var REQ = null, reqP = null;
  function getRequests(force) {
    if (force || !reqP) {
      reqP = listRequests().then(function (rs) { REQ = rs; paintBadge(); return rs; },
        function (e) { reqP = null; throw e; });
    }
    return reqP;
  }
  function isOpen(r) { return CLOSED.indexOf(r.status) < 0; }
  function paintBadge() {
    var n = S.admin && REQ ? REQ.filter(isOpen).length : 0;
    badge.hidden = !n; badge.textContent = n > 99 ? '99+' : String(n);
  }
  function sameWho(a, b) {
    a = String(a || '').trim().toLowerCase(); b = String(b || '').trim().toLowerCase();
    return !!a && !!b && (a === b || a.split(/\s+/)[0] === b || b.split(/\s+/)[0] === a);
  }
  async function loadMine(force) {
    var box = $('.minelist');
    if (!S.name) { box.innerHTML = '<i>add your name above to see your requests</i>'; return; }
    try {
      var rs = await getRequests(force);
      var mine = rs.filter(function (x) { return sameWho(x.who, S.name); }).slice(0, 12);
      if (!mine.length) { box.innerHTML = '<i>none yet for the ' + esc(APP) + ' — be the first!</i>'; return; }
      box.innerHTML = mine.map(function (x) {
        return '<div class="req"><span class="st s' + esc(String(x.status).replace(/\s/g, '')) + '">' + esc(x.status) + '</span>' +
          '<span>' + (ICON[x.type] || '💡') + ' ' + esc(String(x.text).slice(0, 160)) + (x.text.length > 160 ? '…' : '') + '</span>' +
          (x.status === 'Live' ? '<button type="button" class="mini ok" data-id="' + esc(x.id) + '">✅ It works</button>' : '') + '</div>';
      }).join('');
      box.querySelectorAll('.ok').forEach(function (b) {
        b.onclick = async function () {
          if (!S.key) { msg.className = 'msg err'; msg.textContent = 'Enter the team PIN above first.'; paintIdRow(); return; }
          b.textContent = '…'; b.disabled = true;
          try { await bridgePost(Object.assign(authBody(), {action: 'requeststatus', id: b.dataset.id, status: 'Tested'}), 'status'); }
          catch (e) { msg.className = 'msg err'; msg.textContent = '✗ ' + e.message; }
          loadMine(true);
        };
      });
    } catch (e) { box.innerHTML = '<i>couldn’t load — try again in a moment</i>'; }
  }

  /* ---------- admin drawer ---------- */
  var F = {st: 'open', q: ''};
  function openAdmin() {
    if (!S.admin) return;
    drawer.classList.add('open');
    renderAdmin();
    refreshAdmin();
  }
  async function refreshAdmin() {
    if (!S.admin) return;
    $('.dsub').textContent = 'loading…';
    try { await getRequests(true); }
    catch (e) { $('.dsub').textContent = '✗ ' + e.message; return; }
    renderAdmin();
  }
  $('.dx').onclick = function () { drawer.classList.remove('open'); };
  $('.ref').onclick = refreshAdmin;
  root.querySelectorAll('.f').forEach(function (b) {
    b.onclick = function () {
      root.querySelectorAll('.f').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); F.st = b.dataset.f; renderAdmin();
    };
  });
  var qT = null;
  $('.q').oninput = function () { clearTimeout(qT); qT = setTimeout(function () { F.q = $('.q').value.trim().toLowerCase(); renderAdmin(); }, 200); };

  function brief(x) {
    return 'App request ' + x.id + ' — ' + (x.app || APP) + ' (' + (x.type || 'edit') + ') from ' + x.who + ', '
      + String(x.date).slice(0, 10) + ':\n"' + x.text + '"\nContext: ' + (x.context || '—')
      + (x.screenshot ? '\nScreenshot: ' + x.screenshot : '') + '\nStatus: ' + x.status
      + '\nApp URL: ' + location.origin + '\nWhen it ships: set ' + x.id + ' to Live from the 💡 App Requests panel (texts the requester).';
  }
  function renderAdmin() {
    if (!drawer.classList.contains('open')) return;
    var list = $('.list');
    if (!REQ) { list.innerHTML = '<div class="empty">Loading…</div>'; return; }
    var hits = REQ.filter(function (r) {
      var stOk = F.st === 'open' ? isOpen(r) : F.st === 'all' ? true : r.status === F.st;
      return stOk && (!F.q || (r.who + ' ' + r.type + ' ' + r.id + ' ' + r.text + ' ' + r.context + ' ' + r.status).toLowerCase().indexOf(F.q) >= 0);
    });
    $('.dsub').textContent = REQ.filter(isOpen).length + ' open · ' + REQ.length + ' total · signed in as ' + S.name;
    if (!hits.length) {
      list.innerHTML = '<div class="empty">' + (F.st === 'open' && !F.q ? 'Nothing open for the ' + esc(APP) + '. 🎉' : 'No requests match.') + '</div>';
      return;
    }
    list.innerHTML = hits.map(function (r) {
      var cur = r.status || 'Requested';
      var sbtn = function (st, label) {
        return '<button type="button" class="sb' + (cur === st ? ' cur' : '') + '" data-id="' + esc(r.id) + '" data-st="' + st + '"' + (cur === st ? ' disabled' : '') + '>' + label + '</button>';
      };
      return '<div class="card">' +
        '<div class="ctop"><b>' + esc(r.who) + '</b><span class="chip ' + esc(r.type) + '">' + (ICON[r.type] || '💡') + ' ' + esc(r.type || 'edit') + '</span>' +
          '<span class="st s' + esc(cur.replace(/\s/g, '')) + '">' + esc(cur) + '</span>' +
          '<small>' + esc(String(r.date).slice(0, 10)) + ' · ' + esc(r.id) + '</small></div>' +
        '<div class="ctext">' + esc(r.text) + '</div>' +
        '<div class="cmeta">' + esc(r.context || '') + (r.screenshot ? ' · <a href="' + esc(r.screenshot) + '" target="_blank" rel="noopener">📎 screenshot ↗</a>' : '') +
          (r.statusBy ? ' · ' + esc(cur) + ' by ' + esc(r.statusBy) : '') + '</div>' +
        '<div class="cbtns">' + sbtn('In progress', '🔧 In progress') + sbtn('Live', '🚀 Live') + sbtn('Tested', '✅ Tested') +
          '<select class="more" data-id="' + esc(r.id) + '" title="other statuses"><option value="">more…</option>' +
          ['Requested', 'Declined', 'Duplicate'].filter(function (s) { return s !== cur; }).map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select>' +
          '<button type="button" class="sb copy" data-id="' + esc(r.id) + '">📋 Copy for Claude</button></div>' +
      '</div>';
    }).join('');
    list.querySelectorAll('.sb[data-st]').forEach(function (b) { b.onclick = function () { setStatus(b.dataset.id, b.dataset.st, b); }; });
    list.querySelectorAll('.more').forEach(function (s) { s.onchange = function () { if (s.value) setStatus(s.dataset.id, s.value, s); }; });
    list.querySelectorAll('.copy').forEach(function (b) {
      b.onclick = async function () {
        var x = REQ.find(function (r) { return r.id === b.dataset.id; }); if (!x) return;
        try { await navigator.clipboard.writeText(brief(x)); b.textContent = '✓ copied'; }
        catch (e) { b.textContent = '✗ copy blocked'; }
        setTimeout(function () { b.textContent = '📋 Copy for Claude'; }, 1500);
      };
    });
  }
  async function setStatus(id, status, el) {
    if (!S.key) { toast('No team key for this sign-in — ask Karmel'); return; }
    el.disabled = true;
    try {
      var j = await bridgePost(Object.assign(authBody(), {action: 'requeststatus', id: id, status: status}), 'status');
      var x = REQ.find(function (r) { return r.id === id; });
      if (x) { x.status = j.status; x.statusBy = S.name; x.statusAt = new Date().toISOString(); }
      toast(j.texted ? '✓ Live — ' + String(j.who || 'the requester').split(' ')[0] + ' has been texted' : '✓ ' + id + ' → ' + j.status);
      paintBadge(); renderAdmin();
    } catch (e) { toast('✗ ' + e.message); el.disabled = false; }
  }

  window.BLPLightbulb = {
    app: APP,
    open: function () { if (!pop.classList.contains('open')) btn.onclick(); },
    openAdmin: function () { return loadSession().then(openAdmin); },
    refresh: function () { loadSession(true).then(function () { if (S.admin) refreshAdmin(); }); },
  };
})();
