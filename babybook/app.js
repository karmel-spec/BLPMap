// Myles's baby book — app logic.
// The story ships in story.js. The live site (/api/babybook, family passphrase)
// adds what Abby saves: edits, new chapters and moments, photos. Without the
// API (local file, preview) the book reads the shipped copy and hides editing.
(function () {
  'use strict';
  const API = '/api/babybook';
  const SEED = window.MYLES_STORY;
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  const state = { book: Object.assign({}, SEED.book), chapters: [], entries: [], db: { chapters: [], entries: [] }, mode: 'loading', pin: '' };
  try { state.pin = localStorage.getItem('babybook_pin') || ''; } catch (e) {}

  /* ---------- data ---------- */
  function dbToEntry(r) {
    return { id: r.id, chapter: r.chapter, time: r.time_label || '', sort: Number(r.sort) || 0, kind: r.kind || 'moment',
      title: r.title || '', body: r.body || '', cite: r.cite || '', photos: Array.isArray(r.photos) ? r.photos : [], deleted: !!r.deleted };
  }
  function merge() {
    const chs = new Map(SEED.chapters.map(c => [c.id, Object.assign({ photos: [] }, c)]));
    state.db.chapters.forEach(r => chs.set(r.id, { id: r.id, title: r.title, subtitle: r.subtitle, big: r.big, sort: Number(r.sort) || 0, deleted: !!r.deleted }));
    const ens = new Map(SEED.entries.map(e => [e.id, Object.assign({ kind: 'moment', photos: [], cite: '' }, e)]));
    state.db.entries.forEach(r => ens.set(r.id, dbToEntry(r)));
    state.book = Object.assign({}, SEED.book);
    const cover = ens.get('cover'); if (cover && !cover.deleted && cover.photos[0]) state.book.coverPhoto = cover.photos[0];
    const facts = ens.get('facts'); if (facts && !facts.deleted && facts.body) { try { const f = JSON.parse(facts.body); if (Array.isArray(f) && f.length) state.book.facts = f; } catch (e) {} }
    state.chapters = [...chs.values()].filter(c => !c.deleted).sort((a, b) => a.sort - b.sort);
    state.entries = [...ens.values()].filter(e => !e.deleted && e.kind !== 'cover' && e.kind !== 'facts').sort((a, b) => a.sort - b.sort);
  }
  function entriesOf(chId) { return state.entries.filter(e => e.chapter === chId); }

  async function api(payload) {
    const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ pin: state.pin }, payload)) });
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error(j.error || ('HTTP ' + r.status)); err.status = r.status; throw err; }
    return j;
  }

  async function load() {
    setStatus('Opening the book…');
    try {
      const j = await api({ op: 'list' });
      state.db = { chapters: j.chapters || [], entries: j.entries || [] };
      state.mode = 'live';
      try { localStorage.setItem('babybook_pin', state.pin); } catch (e) {}
    } catch (e) {
      if (e.status === 401) { state.mode = 'locked'; }
      else { state.mode = 'readonly'; state.reason = e.status === 501 ? e.message : ''; }
    }
    merge(); renderAll(); syncChrome();
  }

  /* ---------- chrome ---------- */
  function setStatus(t) { $('#status').textContent = t; }
  function syncChrome() {
    const pinbar = $('#pinbar');
    pinbar.hidden = state.mode !== 'locked';
    $('#btn-lock').hidden = state.mode !== 'live';
    $('#add-moment').hidden = state.mode !== 'live';
    $('#add-chapter').hidden = state.mode !== 'live';
    $('#edit-facts').hidden = state.mode !== 'live';
    $('#edit-cover-l').hidden = state.mode !== 'live';
    if (state.mode === 'live') setStatus('Tap any moment to edit it or add photos. Saved for the whole family.');
    else if (state.mode === 'locked') setStatus('Enter the family passphrase to open the book.');
    else setStatus(state.reason || 'Reading the shipped copy. Open the live site with the family passphrase to add to the book.');
  }
  $('#pinbar').addEventListener('submit', (ev) => { ev.preventDefault(); state.pin = $('#pin').value.trim(); load(); });
  $('#btn-lock').addEventListener('click', () => { state.pin = ''; try { localStorage.removeItem('babybook_pin'); } catch (e) {} state.mode = 'locked'; state.db = { chapters: [], entries: [] }; merge(); renderAll(); syncChrome(); });

  const tabs = [...document.querySelectorAll('.tabs button')];
  function showView(id) {
    tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.view === id ? 'true' : 'false'));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + id));
    try { location.hash = id; } catch (e) {}
    if (id === 'book') renderBook();
  }
  tabs.forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));
  $('#btn-print').addEventListener('click', () => { showView('book'); setTimeout(() => window.print(), 150); });

  /* ---------- shared bits ---------- */
  function photoFig(p, cls) {
    const f = el('figure'); const img = el('img'); img.src = p.url; img.alt = p.caption || ''; if (cls) img.className = cls; f.appendChild(img);
    if (p.caption) f.appendChild(el('figcaption', null, p.caption));
    return f;
  }
  function pillClass(e) { return /AM|PM/.test(e.time) ? 'pill' : 'pill t'; }

  /* ---------- Read view ---------- */
  function renderRead() {
    const root = $('#read'); root.innerHTML = '';
    state.chapters.forEach(ch => {
      const sec = el('section', 'ch');
      const head = el('div', 'ch-head');
      head.appendChild(el('div', 'big', ch.big || ''));
      head.appendChild(el('div', 'eyebrow', ch.title));
      const h2 = el('h2', null, ch.subtitle || ch.title); head.appendChild(h2);
      sec.appendChild(head);
      entriesOf(ch.id).forEach(e => {
        const live = state.mode === 'live';
        if (e.kind === 'quote') {
          const q = el(live ? 'button' : 'div', 'q'); if (live) q.type = 'button';
          const bq = el('blockquote', null, e.body); q.appendChild(bq);
          if (e.cite) q.appendChild(el('cite', null, e.cite));
          if (live) q.addEventListener('click', () => openEditor(e));
          sec.appendChild(q); return;
        }
        const mo = el(live ? 'button' : 'div', 'mo' + (live ? ' edit' : '') + ((e.body.length + e.title.length) > 170 ? ' long' : '')); if (live) mo.type = 'button';
        mo.appendChild(el('span', pillClass(e), e.time || '·'));
        const p = el('p'); if (e.title) { const b = el('b', null, e.title + ' '); p.appendChild(b); } p.appendChild(document.createTextNode(e.body)); mo.appendChild(p);
        if (e.photos && e.photos.length) { const ph = el('div', 'ph'); e.photos.forEach(x => { const i = el('img'); i.src = x.url; i.alt = x.caption || ''; i.loading = 'lazy'; ph.appendChild(i); }); mo.appendChild(ph); }
        if (live) mo.addEventListener('click', () => openEditor(e));
        sec.appendChild(mo);
      });
      if (state.mode === 'live') {
        const add = el('button', 'btn add', '+ Add a moment to ' + ch.title); add.type = 'button';
        add.addEventListener('click', () => openEditor(null, ch.id)); sec.appendChild(add);
      }
      root.appendChild(sec);
    });
  }

  /* ---------- Book view (pages) ---------- */
  // Page sizes. Blurb's PDF to Book spec for Standard Portrait: trim 8 x 10 in,
  // 0.125 in bleed top, bottom and outside edge, so each PDF page is 8.125 x 10.25.
  // We design every page at 8.25 x 10.25 (bleed on all four sides) and clip the
  // spine-side bleed when printing: recto pages drop the left strip, verso the right.
  const SIZES = {
    blurb:  { label: 'Blurb 8×10', pageW: '8.25in', pageH: '10.25in', sheetW: '8.125in', sheetH: '10.25in', bleed: '0.125in', ratio: '8.25/10.25', coverSeparate: true },
    letter: { label: 'Letter', pageW: '8.5in', pageH: '11in', sheetW: '8.5in', sheetH: '11in', bleed: '0in', ratio: '8.5/11', coverSeparate: false },
  };
  let sizeKey = 'blurb';
  try { sizeKey = localStorage.getItem('babybook_size') || 'blurb'; } catch (e) {}
  if (!SIZES[sizeKey]) sizeKey = 'blurb';
  function applySize() {
    const s = SIZES[sizeKey];
    const r = document.documentElement.style;
    r.setProperty('--page-w', s.pageW); r.setProperty('--page-h', s.pageH); r.setProperty('--sheet-w', s.sheetW); r.setProperty('--sheet-h', s.sheetH); r.setProperty('--bleed', s.bleed); r.setProperty('--page-ratio', s.ratio);
    let st = $('#pagesize-style'); if (!st) { st = el('style'); st.id = 'pagesize-style'; document.head.appendChild(st); }
    st.textContent = '@media print{@page{size:' + s.sheetW + ' ' + s.sheetH + ';margin:0}}';
    $('#size').value = sizeKey;
  }
  $('#size').addEventListener('change', () => { sizeKey = $('#size').value; try { localStorage.setItem('babybook_size', sizeKey); } catch (e) {} applySize(); renderBook(); });

  function renderBook() {
    applySize();
    const root = $('#book'); root.innerHTML = '';
    const b = state.book;
    const page = (cls) => { const p = el('div', 'page' + (cls ? ' ' + cls : '')); root.appendChild(p); return p; };
    // inner is a normal block, so its height is the content height; the page itself clips
    const fits = (p) => p.firstChild.getBoundingClientRect().height <= p.clientHeight * 0.985;

    // cover
    { const p = page('cover'); const c = el('div', 'cov');
      c.appendChild(el('div', 'eyebrow', 'A birth story · ' + b.dateShort));
      const arch = el('div', 'arch');
      if (b.coverPhoto) { const i = el('img'); i.src = b.coverPhoto.url; i.alt = ''; arch.appendChild(i); } else arch.appendChild(el('div', 'ph-empty', 'cover photo'));
      c.appendChild(arch);
      const band = el('div', 'band'); const h = el('h2'); h.appendChild(document.createTextNode('Hello, ')); h.appendChild(el('b', null, b.name)); band.appendChild(h);
      band.appendChild(el('p', null, b.fullName + ' · ' + b.born + ' ' + b.bornAmPm + ' · ' + b.city)); c.appendChild(band); p.appendChild(c); }

    // dedication
    { const p = page('ded'); const i = el('div', 'inner');
      i.appendChild(el('div', 'eyebrow', 'The birth of'));
      i.appendChild(el('h2', 'h', b.fullName));
      i.appendChild(el('div', 'sub', b.parents + ' welcoming their firstborn son'));
      i.appendChild(el('div', 'rule'));
      i.appendChild(el('div', 'sub', b.date + '\n' + b.place)); i.lastChild.style.whiteSpace = 'pre-line';
      i.appendChild(el('div', 'rule'));
      i.appendChild(el('div', 'sub', 'As witnessed and lovingly recorded by ' + b.recorder)); p.appendChild(i); }

    // facts
    { const p = page('facts'); const i = el('div', 'inner');
      const h = el('h2', 'h'); h.appendChild(document.createTextNode("He's ")); h.appendChild(el('em', null, 'here.')); i.appendChild(h);
      const tiles = el('div', 'tiles');
      (b.facts || []).forEach(f => { const t = el('div', 'tile' + (f.tone === 'sage' ? ' sg' : '')); t.appendChild(el('b', null, f.label));
        const s = el('span', String(f.value || '').length > 6 ? 'long' : '', f.value); t.appendChild(s); t.appendChild(el('small', null, f.note || '')); tiles.appendChild(t); });
      const team = el('div', 'tile txt'); team.appendChild(el('b', null, 'Delivery team')); team.appendChild(el('small', null, b.team)); tiles.appendChild(team);
      const vis = el('div', 'tile txt'); vis.appendChild(el('b', null, 'First visitors')); vis.appendChild(el('small', null, b.visitors)); tiles.appendChild(vis);
      i.appendChild(tiles); p.appendChild(i); }

    // chapters
    state.chapters.forEach(ch => {
      let p = page(); let inner = el('div', 'inner'); p.appendChild(inner);
      inner.appendChild(el('div', 'eyebrow', ch.title));
      inner.appendChild(el('div', 'big' + ((ch.big || '').length > 5 ? ' sm' : ''), ch.big || ''));
      if (ch.subtitle) { const st = el('h2', 'h', ch.subtitle); st.style.fontSize = '5.2cqw'; inner.appendChild(st); }
      const items = [];
      entriesOf(ch.id).forEach(e => {
        if (e.kind === 'quote') { items.push({ quote: e }); return; }
        const card = el('div', 'card' + ((e.body.length + e.title.length) > 170 ? ' long' : '')); card.appendChild(el('span', pillClass(e), e.time || '·'));
        const t = el('p'); if (e.title) t.appendChild(el('b', null, e.title + ' ')); t.appendChild(document.createTextNode(e.body)); card.appendChild(t);
        items.push({ node: card });
        if (e.photos && e.photos.length) {
          for (let k = 0; k < e.photos.length; k += 3) {
            const grp = e.photos.slice(k, k + 3); const g = el('div', 'photos n' + grp.length);
            grp.forEach((x, idx) => g.appendChild(photoFig(x, grp.length > 1 && idx === 0 ? 'arch' : ''))); items.push({ node: g });
          }
        }
      });
      items.forEach(it => {
        if (it.quote) {
          const e = it.quote; const q = page('quote'); const qi = el('div', 'inner');
          const top = el('div', 'qtop'); const bq = el('blockquote', e.body.length > 90 ? 'long' : '', e.body); top.appendChild(bq);
          if (e.cite) top.appendChild(el('cite', null, e.cite)); qi.appendChild(top);
          const bot = el('div', 'qbot'); if (e.photos && e.photos.length) { const g = el('div', 'photos n' + Math.min(3, e.photos.length)); e.photos.slice(0, 3).forEach(x => g.appendChild(photoFig(x))); bot.appendChild(g); }
          qi.appendChild(bot); q.appendChild(qi);
          p = null; return;
        }
        if (!p) { p = page(); inner = el('div', 'inner'); p.appendChild(inner); }
        inner.appendChild(it.node);
        if (!fits(p)) { inner.removeChild(it.node); p = page(); inner = el('div', 'inner'); p.appendChild(inner); inner.appendChild(it.node); }
      });
    });

    // closing
    { const p = page('end'); const i = el('div', 'inner');
      i.appendChild(el('div', 'big', 'To be continued'));
      i.appendChild(el('div', 'eyebrow', 'Day one of ' + b.name + "'s story"));
      i.appendChild(el('div', 'sub', 'Recorded in Room 115 by ' + b.recorder + '. The next chapters are Abby\'s to write.')); p.appendChild(i); }

    // cover handling, even page count, recto/verso sheets
    const size = SIZES[sizeKey];
    const coverart = $('#coverart');
    coverart.hidden = !size.coverSeparate;
    [...coverart.querySelectorAll('.page')].forEach(n => n.remove());
    if (size.coverSeparate) { const cv = root.firstChild; coverart.appendChild(cv); }
    if (size.coverSeparate && root.children.length % 2 === 1) { const blank = page('blank'); blank.appendChild(el('div', 'inner')); }
    [...root.children].forEach((pg, n) => {
      const pageNo = size.coverSeparate ? n + 1 : n;           // Blurb: dedication is page 1 (recto)
      const recto = pageNo % 2 === 1;
      if (pageNo > 0 && !pg.classList.contains('quote') && !pg.classList.contains('end') && !pg.classList.contains('blank')) pg.appendChild(el('div', 'folio' + (recto ? '' : ' verso'), String(pageNo).padStart(2, '0')));
      const sheet = el('div', 'sheet ' + (recto ? 'recto' : 'verso')); root.replaceChild(sheet, pg); sheet.appendChild(pg);
    });
    const n = root.children.length;
    $('#pagecount').textContent = n + ' pages' + (size.coverSeparate ? ' inside' + (n < 20 ? ' (Blurb needs at least 20)' : '') : '');
  }

  function renderAll() { renderRead(); if ($('#view-book').classList.contains('on')) renderBook(); }

  /* ---------- editor ---------- */
  const dlg = $('#sheet');
  let editing = null; // {entry, isNew}
  function uid() { return 'a-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function openEditor(entry, chapterId) {
    const isNew = !entry;
    const e = entry ? JSON.parse(JSON.stringify(entry)) : { id: uid(), chapter: chapterId || (state.chapters[state.chapters.length - 1] || {}).id, time: '', sort: 0, kind: 'moment', title: '', body: '', cite: '', photos: [] };
    if (isNew) { const ex = entriesOf(e.chapter); e.sort = (ex.length ? ex[ex.length - 1].sort : 0) + 1; }
    editing = { entry: e, isNew };
    $('#sh-title').textContent = isNew ? 'Add a moment' : 'Edit this moment';
    const sel = $('#f-chapter'); sel.innerHTML = ''; state.chapters.forEach(c => { const o = el('option', null, c.title); o.value = c.id; sel.appendChild(o); }); sel.value = e.chapter;
    $('#f-kind').value = e.kind === 'quote' ? 'quote' : 'moment';
    $('#f-time').value = e.time; $('#f-sort').value = e.sort; $('#f-title').value = e.title; $('#f-body').value = e.body; $('#f-cite').value = e.cite;
    $('#f-delete').hidden = isNew; $('#f-err').textContent = '';
    renderPhotoList(); kindChanged();
    dlg.showModal();
  }
  function kindChanged() { const q = $('#f-kind').value === 'quote'; $('#l-cite').hidden = !q; $('#l-title').hidden = q; }
  $('#f-kind').addEventListener('change', kindChanged);

  function renderPhotoList() {
    const list = $('#f-photos'); list.innerHTML = '';
    editing.entry.photos.forEach((p, i) => {
      const row = el('div', 'pitem'); const img = el('img'); img.src = p.url; img.alt = ''; row.appendChild(img);
      const cap = el('input'); cap.placeholder = 'Caption'; cap.value = p.caption || ''; cap.addEventListener('input', () => { p.caption = cap.value; }); row.appendChild(cap);
      const rm = el('button', 'btn d', 'Remove'); rm.type = 'button'; rm.addEventListener('click', () => { editing.entry.photos.splice(i, 1); renderPhotoList(); }); row.appendChild(rm);
      list.appendChild(row);
    });
  }

  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url);
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', 0.84)); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a photo the browser can read.')); };
      img.src = url;
    });
  }
  async function uploadFiles(files, onDone) {
    const errBox = $('#f-err'); const btn = $('#f-addphoto');
    btn.disabled = true;
    try {
      for (let i = 0; i < files.length; i++) {
        errBox.textContent = 'Uploading photo ' + (i + 1) + ' of ' + files.length + '…';
        const data = await resizeImage(files[i], 2400);
        const j = await api({ op: 'upload', type: 'image/jpeg', data });
        onDone({ url: j.url, caption: '' });
      }
      errBox.textContent = '';
    } catch (e) { errBox.textContent = e.message || String(e); }
    btn.disabled = false;
  }
  $('#f-file').addEventListener('change', (ev) => { const fs = [...ev.target.files]; ev.target.value = ''; if (fs.length) uploadFiles(fs, (p) => { editing.entry.photos.push(p); renderPhotoList(); }); });

  $('#f-cancel').addEventListener('click', () => dlg.close());
  $('#f-delete').addEventListener('click', async () => {
    if ($('#f-delete').dataset.armed !== '1') { $('#f-delete').dataset.armed = '1'; $('#f-delete').textContent = 'Tap again to delete'; return; }
    await saveEntry(Object.assign({}, editing.entry, { deleted: true }));
  });
  $('#sheetform').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = editing.entry;
    e.chapter = $('#f-chapter').value; e.kind = $('#f-kind').value; e.time = $('#f-time').value.trim(); e.sort = Number($('#f-sort').value) || 0;
    e.title = $('#f-title').value.trim(); e.body = $('#f-body').value.trim(); e.cite = $('#f-cite').value.trim();
    if (!e.body) { $('#f-err').textContent = 'Write a few words first.'; return; }
    await saveEntry(e);
  });
  async function saveEntry(e) {
    $('#f-err').textContent = 'Saving…'; $('#f-save').disabled = true;
    try {
      await api({ op: 'save_entry', entry: e });
      const row = { id: e.id, chapter: e.chapter, time_label: e.time, sort: e.sort, kind: e.kind, title: e.title, body: e.body, cite: e.cite, photos: e.photos, deleted: !!e.deleted };
      state.db.entries = state.db.entries.filter(r => r.id !== e.id).concat([row]);
      merge(); renderAll(); dlg.close();
    } catch (err) { $('#f-err').textContent = err.message || String(err); }
    $('#f-save').disabled = false; $('#f-delete').dataset.armed = '0'; $('#f-delete').textContent = 'Delete';
  }

  // chapter editor
  const cdlg = $('#csheet');
  $('#add-chapter').addEventListener('click', () => { $('#c-title').value = ''; $('#c-sub').value = ''; $('#c-big').value = ''; $('#c-err').textContent = ''; cdlg.showModal(); });
  $('#c-cancel').addEventListener('click', () => cdlg.close());
  $('#csheetform').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const title = $('#c-title').value.trim(); if (!title) { $('#c-err').textContent = 'Give the chapter a name.'; return; }
    const ch = { id: uid(), title, subtitle: $('#c-sub').value.trim(), big: $('#c-big').value.trim(), sort: (state.chapters.length ? state.chapters[state.chapters.length - 1].sort : 0) + 1 };
    $('#c-err').textContent = 'Saving…';
    try { await api({ op: 'save_chapter', chapter: ch }); state.db.chapters.push(Object.assign({ deleted: false }, ch)); merge(); renderAll(); cdlg.close(); }
    catch (err) { $('#c-err').textContent = err.message || String(err); }
  });
  $('#add-moment').addEventListener('click', () => openEditor(null));

  // cover photo
  $('#edit-cover').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    setStatus('Uploading cover photo…');
    try { const data = await resizeImage(f, 2400); const j = await api({ op: 'upload', type: 'image/jpeg', data });
      const e = { id: 'cover', chapter: '', time: '', sort: 0, kind: 'cover', title: '', body: 'cover', cite: '', photos: [{ url: j.url, caption: '' }] };
      await api({ op: 'save_entry', entry: e });
      state.db.entries = state.db.entries.filter(r => r.id !== 'cover').concat([{ id: 'cover', kind: 'cover', photos: e.photos, body: 'cover', chapter: '', time_label: '', sort: 0, title: '', cite: '', deleted: false }]);
      merge(); renderAll(); syncChrome();
    } catch (err) { setStatus(err.message || String(err)); }
  });

  // facts editor
  const fdlg = $('#fsheet');
  $('#edit-facts').addEventListener('click', () => {
    const list = $('#fs-list'); list.innerHTML = '';
    (state.book.facts || []).forEach(addFactRow);
    $('#fs-err').textContent = ''; fdlg.showModal();
  });
  function addFactRow(f) {
    const row = el('div', 'pitem'); ['label', 'value', 'note'].forEach(k => { const i = el('input'); i.placeholder = k === 'label' ? 'Label (Weight)' : k === 'value' ? 'Value (7 lb 9 oz)' : 'Small note'; i.value = (f && f[k]) || ''; i.dataset.k = k; row.appendChild(i); });
    row.dataset.tone = (f && f.tone) || ''; $('#fs-list').appendChild(row);
  }
  $('#fs-add').addEventListener('click', () => addFactRow(null));
  $('#fs-cancel').addEventListener('click', () => fdlg.close());
  $('#fsheetform').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const facts = [...$('#fs-list').children].map((row, i) => { const o = { tone: row.dataset.tone || (i % 3 === 0 ? 'sage' : '') }; row.querySelectorAll('input').forEach(inp => { o[inp.dataset.k] = inp.value.trim(); }); return o; }).filter(f => f.label && f.value);
    $('#fs-err').textContent = 'Saving…';
    try { const e = { id: 'facts', chapter: '', time: '', sort: 0, kind: 'facts', title: '', body: JSON.stringify(facts), cite: '', photos: [] };
      await api({ op: 'save_entry', entry: e });
      state.db.entries = state.db.entries.filter(r => r.id !== 'facts').concat([{ id: 'facts', kind: 'facts', body: e.body, photos: [], chapter: '', time_label: '', sort: 0, title: '', cite: '', deleted: false }]);
      merge(); renderAll(); fdlg.close(); }
    catch (err) { $('#fs-err').textContent = err.message || String(err); }
  });

  /* ---------- boot ---------- */
  merge(); renderAll();
  const h = (location.hash || '').replace('#', '');
  showView(h === 'book' ? 'book' : 'read');
  window.addEventListener('resize', () => { if ($('#view-book').classList.contains('on')) renderBook(); });
  window.addEventListener('beforeprint', () => { showView('book'); });
  load();
})();
