// /api/top10 — Brigham's daily Top 10 (Brigham 9/22): three ranked lists of
// what is waiting on him — SHOP (pianos and crew blocked on his decision or
// his hands), SALES (pricing, offers, consignments, rentals) and ADMIN SUPPORT
// (questions the office needs answered). One scoring pass feeds both the
// Store Map's 🎯 Top 10 view and the 6:15 AM Google-Doc brief the Apps
// Script bridge emails him (top10Brief in apps-script/DailyReport.gs).
//
// Sources: the Piano Log (same CSV export as /api/data), the task boards and
// pending mini-QC requests in Supabase. Cached 3 minutes.

import { parsePianos, PIANO_LOG_CSV } from './data.mjs';

const SB_URL = (process.env.SUPABASE_URL || 'https://ismacawxfvvllfinibbf.supabase.co').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_MamcjSX0CHTdYlpKDWSkmQ_-nbuQ1z-';
const APP = 'https://blpstoremap.netlify.app';
const CACHE_MS = 3 * 60 * 1000;
const cache = { at: 0, body: null };

const SEQ = ['New Arrival - Admin', 'Assessment', 'CAP', 'PRSB - Downbearing', 'PRSB - Notching and Pins',
  'Lacquer Soundboard', 'Restringing', 'Chip Tuning', 'DHRT', '1st Tuning', 'Refinishing', 'QC & Assembly',
  '2nd Tuning', 'Exit Prep - Admin'];
const LATE = ['QC & Assembly', '1st Tuning', '2nd Tuning', 'Exit Prep - Admin'];
const DAY = 86400000;

const sb = async (path) => {
  const r = await fetch(SB_URL + '/rest/v1/' + path, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('supabase ' + r.status + ' on ' + path.split('?')[0]);
  return r.json();
};
const short = (p) => String(p.summary || p.serial || '').replace(/\s+/g, ' ').trim().slice(0, 48);
const pct = (p) => { const d = String(p.phasesDone || ''); const n = d ? d.split(/[|,]/).filter((x) => x.trim()).length : 0; return n / SEQ.length; };
const ageDays = (iso) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY)) : 0;
const pianoLink = (p) => APP + '/#piano=' + encodeURIComponent(p.serial || '');
const cardLink = (c) => APP + '/#tboard=' + encodeURIComponent(c.owner || '') + '&card=' + encodeURIComponent(c.id || '');
const item = (score, kind, title, why, extra) => ({ score, kind, title, why, ...(extra || {}) });

// Mountain-time "today" and the next delivery Friday cards refer to
function mtDate(d = new Date()) { return new Date(d.toLocaleString('en-US', { timeZone: 'America/Denver' })); }
function parseDeliveryDate(text) {
  const m = /\b(\d{1,2})\/(\d{1,2})\b/.exec(text || '');
  if (!m) return null;
  const now = mtDate(); let d = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
  if (d.getTime() < now.getTime() - 60 * DAY) d = new Date(now.getFullYear() + 1, +m[1] - 1, +m[2]);
  return d;
}

function build(pianos, cards, qc) {
  const active = pianos.filter((p) => p.active);
  const bySerial = new Map(active.map((p) => [String(p.serial || '').toLowerCase(), p]));
  const openCards = cards.filter((c) => !c.done_at && c.col !== 'done' && c.col !== 'archived');
  const mine = openCards.filter((c) => /brigham/i.test(c.owner || ''));
  const ask = openCards.filter((c) => c.col === 'askbrigham');
  const shop = [], sales = [], admin = [];

  // ---- SHOP ----
  // 1. delivery-day cards on Brigham's board ("David 9/26 Delivery - …")
  const deliv = mine.filter((c) => /delivery/i.test(c.text || '') && parseDeliveryDate(c.text));
  if (deliv.length) {
    const soonest = deliv.map((c) => parseDeliveryDate(c.text)).sort((a, b) => a - b)[0];
    const days = Math.round((soonest - mtDate()) / DAY);
    const need = deliv.map((c) => bySerial.get(String(c.serial || '').toLowerCase())).filter(Boolean);
    const noVideo = need.filter((p) => !p.avideo);
    shop.push(item(108 - Math.max(0, days) * 6, 'delivery',   // 3 days out ≈ 90: right behind an escalated QC
      `Delivery day ${soonest.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}: ${deliv.length} pianos ship${days >= 0 ? ` in ${days} day${days === 1 ? '' : 's'}` : ''}`,
      `${noVideo.length} still need an after video${noVideo.length ? ': ' + noVideo.map((p) => p.serial).slice(0, 8).join(', ') : ''}. Final QC and sign-off before the trucks load.`,
      { link: APP + '/#tboard=Brigham%20Larson', count: deliv.length, serials: need.map((p) => p.serial) }));
  }
  // 2. mini-QC pending (escalated ones first)
  qc.forEach((q) => {
    shop.push(item(90 + (q.escalated ? 5 : 0) + Math.min(10, ageDays(q.created)), 'qc',
      `Mini-QC waiting: ${q.piano || q.serial} (${q.phase} → ${q.next_phase})`,
      `Requested by ${q.requested_by} ${ageDays(q.created)}d ago${q.escalated ? ' — escalated past the managers to you' : ''}. The crew cannot advance the phase until it is signed.`,
      { serial: q.serial, link: APP + '/#piano=' + encodeURIComponent(q.serial || '') }));
  });
  // 3. pianos in a "Waiting on Brigham" phase, or whose notes say work waits on him
  active.forEach((p) => {
    const ph = p.phase || '';
    if (ph === 'Waiting on Brigham') {
      shop.push(item(88, 'waiting', `Waiting on Brigham: ${short(p)}`, (p.waitNote || 'Phase is set to Waiting on Brigham.').slice(0, 160), { serial: p.serial, link: pianoLink(p) }));
      return;
    }
    const blob = [p.waitNote, p.checkBack, p.importantNote, p.scopeNotes].map((x) => String(x || '')).join(' ');
    const m = /([^.\n]{0,70}\b(contingent on|waiting (on|for)|pending|until) Brigham[^.\n]{0,90})/i.exec(blob) || /([^.\n]{0,70}\bBrigham (to |needs to |must )[^.\n]{0,90})/i.exec(blob);
    if (m && ph !== 'For Sale' && ph !== '') {
      shop.push(item(80, 'blocked', `Blocked on you: ${short(p)} (${ph})`, m[1].trim().slice(0, 170), { serial: p.serial, link: pianoLink(p) }));
    }
  });
  // 4. decision cards on his board (pinblocks, action plans, "piano is waiting")
  const seenDecision = new Set();
  mine.filter((c) => !/delivery/i.test(c.text || '') && /waiting|decide|determine|figure out|course of action|plan for|feasib/i.test(c.text || ''))
    .sort((a, b) => String(a.created).localeCompare(String(b.created)))
    .filter((c) => { const k = String(c.serial || '').toLowerCase(); if (k && seenDecision.has(k)) return false; if (k) seenDecision.add(k); return true; })   // one line per piano
    .forEach((c) => shop.push(item(70 + Math.min(15, ageDays(c.created) / 4), 'decision',
      `Decision: ${String(c.text).replace(/\s+/g, ' ').slice(0, 90)}`, `On your task board ${ageDays(c.created)} days${c.from_who ? ', from ' + c.from_who : ''}.`,
      { serial: c.serial, link: c.serial && bySerial.has(String(c.serial).toLowerCase()) ? pianoLink({ serial: c.serial }) : cardLink(c) })));
  // 5. upsell calls due (admin step 6) — grouped
  const upsell = active.filter((p) => (p.queuePos || SEQ.includes(p.phase)) && !/Upsell/.test(p.adminSteps || '') && (pct(p) >= 0.5 || LATE.includes(p.phase)) && !/^BLP/i.test(String(p.owner || '')));
  if (upsell.length) {
    const top = upsell.sort((a, b) => pct(b) - pct(a)).slice(0, 6);
    shop.push(item(72, 'upsell', `Upsell calls due (Admin step 6): ${upsell.length} restoration clients`,
      `Past the 50% mark or already in QC/exit with no upsell call logged. Start with ${top.map((p) => short(p).split('/')[0].trim() + ' #' + p.serial).slice(0, 4).join('; ')}.`,
      { link: APP + '/#report=admin', count: upsell.length, serials: upsell.map((p) => p.serial) }));
  }
  // 6. before videos missing on pianos already in a phase past intake
  const noBefore = active.filter((p) => (p.queuePos || SEQ.includes(p.phase)) && !p.bvideo && p.phase && !['New Arrival - Admin', 'In Queue', 'Paused'].includes(p.phase));
  if (noBefore.length) shop.push(item(64, 'video', `Before videos missing: ${noBefore.length} pianos already in work`,
    `Footage is lost for good once a phase passes. Soonest: ${noBefore.slice(0, 5).map((p) => '#' + p.serial + ' (' + p.phase + ')').join(', ')}.`,
    { link: APP + '/#report=media', count: noBefore.length, serials: noBefore.map((p) => p.serial) }));
  // 7. after videos missing on pianos in QC / tuning / exit
  const noAfter = active.filter((p) => LATE.includes(p.phase) && !p.avideo);
  if (noAfter.length) shop.push(item(60, 'video', `After videos missing: ${noAfter.length} pianos in QC / tuning / exit prep`,
    noAfter.slice(0, 6).map((p) => '#' + p.serial + ' ' + short(p).split('/')[0].trim()).join(', ') + '.',
    { link: APP + '/#report=media', count: noAfter.length, serials: noAfter.map((p) => p.serial) }));
  // 8. BLP-owned shop-work pianos with no queue number
  const unnumbered = active.filter((p) => /blp/i.test(String(p.owner || '')) && /current shop work/i.test(p.status || '') && !p.queuePos && p.phase !== 'For Sale');
  if (unnumbered.length) shop.push(item(50, 'queue', `Number the BLP-owned queue: ${unnumbered.length} shop-work pianos have no queue position`,
    `Walk the row once and give them an order so the crew has a real sequence. e.g. ${unnumbered.slice(0, 4).map((p) => '#' + p.serial).join(', ')}.`,
    { link: APP + '/#report=queue', count: unnumbered.length, serials: unnumbered.map((p) => p.serial) }));
  // 9. attic pianos with no home
  const attic = active.filter((p) => /attic/i.test(p.location || ''));
  if (attic.length) shop.push(item(40, 'attic', `Attic: ${attic.length} pianos need a spot`,
    attic.map((p) => '#' + p.serial + ' ' + (p.location || '').replace(/attic\s*[—-]?\s*/i, '').trim()).join('; ') + '.',
    { link: APP + '/#report=unplaced', count: attic.length, serials: attic.map((p) => p.serial) }));
  // 10. other cards on his board, oldest first (one grouped line)
  const other = mine.filter((c) => !/delivery/i.test(c.text || '') && !/waiting|decide|determine|figure out|course of action|plan for|feasib/i.test(c.text || ''));
  if (other.length) shop.push(item(35, 'cards', `${other.length} more cards on your task board`,
    other.sort((a, b) => String(a.created).localeCompare(String(b.created))).slice(0, 3).map((c) => String(c.text).replace(/\s+/g, ' ').slice(0, 60)).join(' · ') + (other.length > 3 ? ' · …' : ''),
    { link: APP + '/#tboard=Brigham%20Larson', count: other.length }));

  // ---- SALES ----
  const isSales = (t) => /\b(offer|buy|purchase|sell|consign|price|pricing|quote|quoted|rent|rental|appraisal|invoice|\$[\d,]+k?)\b/i.test(t || '');
  ask.filter((c) => isSales(c.text)).forEach((c) => {
    const money = /\$\s?[\d,]+(\.\d+)?k?/i.test(c.text || '');
    sales.push(item(60 + (money ? 15 : 0) + Math.min(20, ageDays(c.created) * 1.5), 'ask',
      String(c.text).replace(/\s+/g, ' ').slice(0, 110), `${c.owner.split(' ')[0]} asked ${ageDays(c.created)}d ago.`, { link: cardLink(c) }));
  });
  active.filter((p) => p.phase === 'Sale Pending').forEach((p) => sales.push(item(70, 'pending', `Sale pending: ${short(p)}`, 'Close it — payment, paperwork, delivery date.', { serial: p.serial, link: pianoLink(p) })));
  const needPrice = active.filter((p) => p.phase === 'For Sale' && (/call for custom pric/i.test(p.summary || '') || !p.price) && /blp/i.test(String(p.owner || '')));
  if (needPrice.length) sales.push(item(45, 'price', `${needPrice.length} BLP-owned pianos for sale with no price`,
    `Every one shows "call for pricing" and cannot be marketed. e.g. ${needPrice.slice(0, 5).map((p) => '#' + p.serial).join(', ')}.`, { link: APP + '/#report=noprice', count: needPrice.length, serials: needPrice.map((p) => p.serial) }));
  active.filter((p) => p.phase === 'Waiting on Customer' || (p.phase === 'In Queue' && /plan|rebuild|down payment/i.test(String(p.importantNote || p.planNotes || '')) && /brigham/i.test(String(p.importantNote || p.planNotes || ''))))
    .forEach((p) => sales.push(item(55, 'plan', `Restoration plan not settled: ${short(p)}`, String(p.waitNote || p.importantNote || '').replace(/\s+/g, ' ').slice(0, 150), { serial: p.serial, link: pianoLink(p) })));

  // ---- ADMIN SUPPORT ----
  ask.filter((c) => !isSales(c.text)).forEach((c) => {
    admin.push(item(50 + Math.min(30, ageDays(c.created) * 2), 'ask', String(c.text).replace(/\s+/g, ' ').slice(0, 110), `${c.owner.split(' ')[0]} asked ${ageDays(c.created)}d ago.`, { link: cardLink(c) }));
  });
  const adminBlocked = active.filter((p) => ['New Arrival - Admin', 'Exit Prep - Admin'].includes(p.phase) && /brigham/i.test(String(p.importantNote || p.waitNote || '')));
  adminBlocked.forEach((p) => admin.push(item(58, 'admin', `${p.phase}: ${short(p)} needs your word`, String(p.importantNote || p.waitNote || '').replace(/\s+/g, ' ').slice(0, 150), { serial: p.serial, link: pianoLink(p) })));
  const openReq = openCards.filter((c) => /brigham/i.test(c.from_who || '') && !/brigham/i.test(c.owner || '') && ageDays(c.created) > 21);
  if (openReq.length) admin.push(item(30, 'follow', `${openReq.length} tasks you handed out over 3 weeks ago are still open`,
    openReq.slice(0, 3).map((c) => c.owner.split(' ')[0] + ': ' + String(c.text).replace(/\s+/g, ' ').slice(0, 50)).join(' · '), { link: APP + '/#tboard', count: openReq.length }));

  const rank = (arr) => arr.sort((a, b) => b.score - a.score).slice(0, 10).map((x, i) => ({ rank: i + 1, ...x }));
  return { shop: rank(shop), sales: rank(sales), admin: rank(admin),
    totals: { shop: shop.length, sales: sales.length, admin: admin.length, askOpen: ask.length, myCards: mine.length } };
}

export default async () => {
  if (cache.body && Date.now() - cache.at < CACHE_MS) return Response.json({ ...cache.body, cached: true }, { headers: { 'cache-control': 'no-store' } });
  try {
    const [csv, cards, qc] = await Promise.all([
      fetch(PIANO_LOG_CSV, { signal: AbortSignal.timeout(25000) }).then((r) => r.text()),
      sb('tb_cards?select=id,owner,col,text,serial,due,from_who,created,done_at&done_at=is.null'),
      sb('qc_requests?select=id,serial,piano,phase,next_phase,requested_by,status,escalated,created&status=eq.pending'),
    ]);
    const pianos = parsePianos(csv);
    const body = { generated: new Date().toISOString(), ...build(pianos, cards, qc) };
    cache.body = body; cache.at = Date.now();
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (cache.body) return Response.json({ ...cache.body, stale: true, error: String(e.message || e) }, { headers: { 'cache-control': 'no-store' } });
    return Response.json({ error: String(e.message || e) }, { status: 502 });
  }
};
