/**
 * BLP Store Map — Daily Report emailer (machine-independent).
 *
 * Runs entirely in Google's cloud on a time trigger as
 * info@brighamlarsonpianos.com. Fetches the live data the Store Map app
 * already serves at blpstoremap.netlify.app and emails the daily report.
 *
 * ONE-TIME SETUP (~3 minutes, matches the Piano Log bridge pattern):
 *   1. script.google.com signed in as info@brighamlarsonpianos.com
 *      -> New project, name it "Store Map Daily Report".
 *   2. Paste this whole file over Code.gs. Save.
 *   3. Run the function `setup` once (Run > setup). Authorize when asked
 *      (it needs: send email as you, fetch external URLs).
 *   4. Done. It emails info@ weekdays at ~6 AM Mountain, forever,
 *      no computer required. Run `sendDailyReport` any time for a manual send.
 */

var APP_URL = 'https://blpstoremap.netlify.app';
var REPORT_TO = 'info@brighamlarsonpianos.com';
var PIANO_LOG_ID = '1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc';
var BRIDGE_SECRET = 'PASTE_SECRET_HERE';   // server-to-server auth (optional)
var TEAM_PIN = 'PASTE_PIN_HERE';           // what BLP team members type to move pianos
var PHOTOS_ROOT_ID = '1KB-L5dzcGSAC5Q2y40JQorkaxXfY3AiJ';  // per-piano photo folders live under here
var PHOTO_LOG_TAB = 'PHOTO LOG';           // per-upload record (feeds client-update drafts)
var MOVING_ICS = 'PASTE_ICS_URL_HERE';     // the moving calendar's SECRET iCal address
var TUNING_CAL = 'korbangreenhalgh.blp@gmail.com';  // 09-Korban Greenhalgh
// master record of every tuning in the store — every request lands here
// in addition to the assigned technician's own calendar
var MASTER_TUNING_CAL = 'pianotuning.blp@gmail.com';
// every calendar scanned for scheduled/past tunings
var TUNING_CALS = [TUNING_CAL, MASTER_TUNING_CAL];
var TECH_WORK_START = 8, TECH_WORK_END = 16;   // non-Korban techs: 8am-4pm gap search
// OAuth web client for "Sign in with Google" in the map app — used only to
// verify who made a change for the activity log. Client IDs are public.
var GOOGLE_CLIENT_ID = '110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com';
var TUNING_SLOTS = [8, 10];                // weekday tuning start hours (Denver)
var TUNING_MINUTES = 90;                   // block length, matches Korban's bookings
var KNOWN_AREAS = ['showroom', 'pre-sale showroom', 'third floor', 'storage',
  'shop', 'vestibule', 'wing room', 'holding room', 'attic', 'sold floor',
  'rebuilding line', 'refinishing', 'back shop', 'middle shop', 'basement',
  'warehouse', 'rental', 'out for delivery', 'customer'];

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendDailyReport').timeBased()
    .everyDays(1).atHour(6).inTimezone('America/Denver').create();
  sendDailyReport();   // send one now to confirm everything works
}

function sendDailyReport() {
  var now = new Date();
  var dow = Number(Utilities.formatDate(now, 'America/Denver', 'u')); // 1=Mon..7=Sun
  if (dow > 5 && !isManualRun_()) return;  // weekdays only on the trigger

  var data = JSON.parse(UrlFetchApp.fetch(APP_URL + '/api/data').getContentText());
  var slotsDoc = JSON.parse(UrlFetchApp.fetch(APP_URL + '/data/slots.json').getContentText());
  var r = buildReport_(data, slotsDoc);
  var subject = 'Store Map Daily Report — ' + r.unplaced.length + ' unplaced, '
    + r.dups.length + ' duplicate spots, ' + r.moves.length + ' moves today';
  MailApp.sendEmail({
    to: REPORT_TO,
    subject: subject,
    htmlBody: reportHtml_(r),
    body: 'Total pianos: ' + r.total + '\nUnplaced: ' + r.unplaced.length
      + '\nDuplicate slots: ' + r.dups.length + '\nMoves today: ' + r.moves.length,
    name: 'BLP Store Map',
  });
}

/**
 * Web-app bridge: lets the Store Map app look up / update a piano's
 * "Location / Status" (column U) in the Piano Log. Deploy as Web app
 * (execute as me, access: anyone); Netlify keeps the URL + secret in
 * env vars and proxies /api/move here — the secret never reaches browsers.
 *
 * POST JSON: {secret, serial, action: 'lookup'|'move', newLocation?, row?}
 */
/**
 * Public read endpoint: GET ?fn=events returns the next two weeks of
 * moving-calendar events as JSON. The SECRET iCal address never leaves
 * this script — Netlify's /api/data fetches events from here, so no
 * env vars or credentials are needed anywhere else.
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.fn === 'events') {
    try { return json_({events: fetchEvents_()}); }
    catch (err) { return json_({error: String(err), events: []}); }
  }
  if (e && e.parameter && e.parameter.fn === 'tunings') {
    try { return json_(tunings_()); }
    catch (err) { return json_({error: String(err), upcoming: [], past: []}); }
  }
  if (e && e.parameter && e.parameter.fn === 'activity') {
    try { return json_(activity_()); }
    catch (err) { return json_({error: String(err), rows: []}); }
  }
  if (e && e.parameter && e.parameter.fn === 'techs') {
    try { return json_(techs_()); }
    catch (err) { return json_({error: String(err), techs: []}); }
  }
  return json_({ok: true, service: 'BLP Store Map bridge'});
}

/**
 * Tuning feature — scans every calendar in TUNING_CALS (Korban's and the
 * pianotuning.blp account, both shared with this script's owner).
 * ?fn=tunings returns compact upcoming/past event lists (only events whose
 * titles contain a 5+ digit run, i.e. a serial) so the map can color
 * scheduled pianos and show "last tuned". 30-min cache.
 */
function tunings_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('tunings');
  if (hit) return JSON.parse(hit);
  var tz = 'America/Denver';
  var now = new Date();
  var past = [], upcoming = [], seenCal = 0;
  for (var c = 0; c < TUNING_CALS.length; c++) {
    var cal = CalendarApp.getCalendarById(TUNING_CALS[c]);
    if (!cal) continue;
    seenCal++;
    var evs = cal.getEvents(new Date(now.getTime() - 540 * 86400000),
                            new Date(now.getTime() + 60 * 86400000));
    for (var i = 0; i < evs.length; i++) {
      var t = evs[i].getTitle() || '';
      if (!/\d{5,}/.test(t)) continue;   // only piano-ish events (serial in title)
      var st = evs[i].getStartTime();
      var rec = [Utilities.formatDate(st, tz, 'yyyy-MM-dd'),
                 Utilities.formatDate(st, tz, 'HH:mm'),
                 t.slice(0, 70)];
      (st < now ? past : upcoming).push(rec);
    }
  }
  if (!seenCal) return {error: 'no tuning calendar shared with ' + Session.getEffectiveUser(), upcoming: [], past: []};
  var bySt = function (a, b) { return (a[0] + a[1]) < (b[0] + b[1]) ? -1 : 1; };
  past.sort(bySt); upcoming.sort(bySt);
  var out = {upcoming: upcoming, past: past.slice(-800)};
  try { cache.put('tunings', JSON.stringify(out), 1800); } catch (ig) {}
  return out;
}

/**
 * Schedule a tuning request. Korban gets his fixed weekday slots (8am/10am,
 * skipping NO KORBAN days); any other technician gets the first open
 * 90-minute gap in their 8am-4pm weekday working hours. Every booking is
 * written to BOTH the technician's calendar and the master tuning calendar
 * (the store's permanent record — it's also how "last tuned" updates once
 * the date passes). req: {serial, row?, techId?, techName?, repairs?,
 * notes?, dryrun?} — dryrun computes the slot without creating events.
 */
function scheduleTuning_(req) {
  var tz = 'America/Denver';
  var techId = String(req.techId || TUNING_CAL).trim();
  var cal = CalendarApp.getCalendarById(techId);
  if (!cal) return {error: 'that calendar is not shared with ' + Session.getEffectiveUser() + ': ' + techId};
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var techName = String(req.techName || cal.getName()).replace(/^\d+\s*-\s*/, '').trim();
  var title = 'Tuning: ' + (found.summary || 'piano') + ' SN ' + req.serial
    + (found.location ? ' @ spot ' + found.location : '');
  var slot = techId === TUNING_CAL ? korbanSlot_(cal, tz) : openGap_(cal, tz, techName);
  if (!slot) return {error: 'no open slot found on ' + techName + "'s calendar in the next 6 weeks"};
  var desc = 'Requested via BLP Store Map ('
    + Utilities.formatDate(new Date(), tz, 'MMM d, h:mm a') + ')'
    + '\nAssigned to: ' + techName;
  if (req.repairs && String(req.repairs).trim()) {
    desc += '\n\nRepair requests:\n' + String(req.repairs).trim();
  }
  if (req.notes && String(req.notes).trim()) {
    desc += '\n\nNotes:\n' + String(req.notes).trim();
  }
  desc += '\n\nPiano Log: https://pianologapp.netlify.app/#piano=' +
    encodeURIComponent(req.serial);
  if (!req.dryrun) {
    cal.createEvent(title, slot.start, slot.end, {description: desc});
    if (techId !== MASTER_TUNING_CAL) {
      var master = CalendarApp.getCalendarById(MASTER_TUNING_CAL);
      if (master) master.createEvent(title + ' — ' + techName, slot.start, slot.end,
                                     {description: desc});
    }
    try { CacheService.getScriptCache().remove('tunings'); } catch (ig) {}
  }
  return {ok: true, scheduled: true, dryrun: !!req.dryrun, tech: techName,
          date: Utilities.formatDate(slot.start, tz, 'EEE, MMM d'),
          iso: Utilities.formatDate(slot.start, tz, 'yyyy-MM-dd'),
          hhmm: Utilities.formatDate(slot.start, tz, 'HH:mm'),
          time: Utilities.formatDate(slot.start, tz, 'h:mm a'),
          summary: found.summary, title: title};
}

// Korban's fixed tuning slots: weekdays 8am + 10am, skipping conflicts
// and any day carrying a "NO KORBAN" event
function korbanSlot_(cal, tz) {
  for (var d = 1; d <= 42; d++) {
    var day = new Date(Date.now() + d * 86400000);
    var dow = Number(Utilities.formatDate(day, tz, 'u'));
    if (dow > 5) continue;
    var y = Utilities.formatDate(day, tz, 'yyyy-MM-dd');
    var dayEvents = cal.getEvents(new Date(y + 'T00:00:00'), new Date(y + 'T23:59:59'));
    var blocked = dayEvents.some(function (ev) {
      return /NO KORBAN/i.test(ev.getTitle() || '');
    });
    if (blocked) continue;
    for (var s = 0; s < TUNING_SLOTS.length; s++) {
      var start = new Date(y + 'T' + ('0' + TUNING_SLOTS[s]).slice(-2) + ':00:00');
      var end = new Date(start.getTime() + TUNING_MINUTES * 60000);
      var clash = dayEvents.some(function (ev) {
        return !ev.isAllDayEvent() && ev.getStartTime() < end && ev.getEndTime() > start;
      });
      if (!clash) return {start: start, end: end};
    }
  }
  return null;
}

// any other technician: first open 90-minute gap in weekday working hours
// (8am-4pm, starts on the half hour); days with an all-day NO/OFF/VACATION
// event are skipped
function openGap_(cal, tz, techName) {
  for (var d = 1; d <= 42; d++) {
    var day = new Date(Date.now() + d * 86400000);
    var dow = Number(Utilities.formatDate(day, tz, 'u'));
    if (dow > 5) continue;
    var y = Utilities.formatDate(day, tz, 'yyyy-MM-dd');
    var dayEvents = cal.getEvents(new Date(y + 'T00:00:00'), new Date(y + 'T23:59:59'));
    var off = dayEvents.some(function (ev) {
      var t = ev.getTitle() || '';
      return (ev.isAllDayEvent() && /\b(no |off|vacation|pto|out)\b/i.test(t))
        || new RegExp('NO ' + techName.split(' ')[0], 'i').test(t);
    });
    if (off) continue;
    for (var h = TECH_WORK_START; h + TUNING_MINUTES / 60 <= TECH_WORK_END; h += 0.5) {
      var hh = Math.floor(h), mm = h % 1 ? '30' : '00';
      var start = new Date(y + 'T' + ('0' + hh).slice(-2) + ':' + mm + ':00');
      var end = new Date(start.getTime() + TUNING_MINUTES * 60000);
      var clash = dayEvents.some(function (ev) {
        return !ev.isAllDayEvent() && ev.getStartTime() < end && ev.getEndTime() > start;
      });
      if (!clash) return {start: start, end: end};
    }
  }
  return null;
}

/**
 * Technician list for the tuning-request form: every technician calendar
 * shared with this account (the NN-Name .blp@gmail.com calendars), Korban
 * first as the default. The master tuning + moving calendars are excluded.
 */
function techs_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('techs');
  if (hit) return JSON.parse(hit);
  var out = [];
  CalendarApp.getAllCalendars().forEach(function (c) {
    var id = c.getId(), name = c.getName();
    if (id === MASTER_TUNING_CAL) return;
    if (/moving/i.test(id) || /moving/i.test(name)) return;
    if (!/\.blp@gmail\.com$/.test(id) && !/^\d{2}\s*-/.test(name)) return;
    out.push({id: id, name: name.replace(/^\d+\s*-\s*/, '').trim(),
              isDefault: id === TUNING_CAL});
  });
  out.sort(function (a, b) {
    return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)
      || (a.name < b.name ? -1 : 1);
  });
  var res = {techs: out};
  try { cache.put('techs', JSON.stringify(res), 3600); } catch (ig) {}
  return res;
}

function findPiano_(sh, serial, rowOverride) {
  var last = sh.getLastRow();
  var serials = sh.getRange(1, 3, last, 1).getValues();
  var owners = sh.getRange(1, 2, last, 1).getValues();
  var soldRow = last + 1;
  for (var i = 0; i < last; i++) {
    if (String(owners[i][0] || '').trim().toUpperCase() === 'SOLD'
        && !String(serials[i][0] || '').trim()) { soldRow = i + 1; break; }
  }
  var want = String(serial || '').trim().toLowerCase();
  if (!want) return {error: 'serial required'};
  var matches = [];
  for (var r = 1; r < soldRow; r++) {
    if (String(serials[r - 1][0] || '').trim().toLowerCase() === want) matches.push(r);
  }
  if (!matches.length) return {error: 'serial not found above the SOLD section'};
  var row = rowOverride || matches[0];
  return {row: row,
          summary: String(sh.getRange(row, 4).getValue() || ''),
          location: String(sh.getRange(row, 21).getValue() || '')};
}

function fetchEvents_() {
  var tz = 'America/Denver';
  var text = UrlFetchApp.fetch(MOVING_ICS).getContentText().replace(/\r?\n[ \t]/g, '');
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var today = new Date(todayStr + 'T12:00:00Z');
  var lo = new Date(today.getTime() - 86400000);
  var hi = new Date(today.getTime() + 14 * 86400000);
  var events = [];
  var blocks = text.split('BEGIN:VEVENT').slice(1);
  for (var b = 0; b < blocks.length; b++) {
    var body = blocks[b].split('END:VEVENT')[0];
    var props = {};
    var lines = body.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var idx = lines[i].indexOf(':');
      if (idx < 0) continue;
      props[lines[i].slice(0, idx).split(';')[0].toUpperCase()] =
        lines[i].slice(idx + 1).replace(/\s+$/, '');
    }
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(props.DTSTART || '');
    if (!m) continue;
    var day, hhmm = m[4] ? m[4] + ':' + m[5] : null;
    if (hhmm && m[7] === 'Z') {
      var utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
      day = Utilities.formatDate(utc, tz, 'yyyy-MM-dd');
      hhmm = Utilities.formatDate(utc, tz, 'HH:mm');
    } else {
      day = m[1] + '-' + m[2] + '-' + m[3];
    }
    var dd = new Date(day + 'T12:00:00Z');
    if (dd < lo || dd > hi) continue;
    var raw = (props.SUMMARY || '').replace(/\\,/g, ',');
    var clean = raw.replace(/^\s*x\s+/i, '').replace(/^\s+|\s+$/g, '');
    var up = clean.toUpperCase();
    if (up === 'OFF' || up === 'NO MOVES' || up === '') continue;
    events.push({
      date: day, time: hhmm, summary: clean,
      done: /^\s*x\s/i.test(raw),
      description: (props.DESCRIPTION || '').replace(/\\n/g, ' ')
        .replace(/\\,/g, ',').slice(0, 400),
    });
  }
  events.sort(function (a, b) {
    return (a.date + (a.time || '99')) < (b.date + (b.time || '99')) ? -1 : 1;
  });
  return events;
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    // team members authenticate with the PIN (typed once in the map app);
    // BRIDGE_SECRET remains for optional server-to-server use
    if (req.secret !== BRIDGE_SECRET && req.pin !== TEAM_PIN) {
      return json_({error: 'unauthorized'});
    }
    var who = who_(req);
    if (req.action === 'tune') {
      var t = scheduleTuning_(req);
      if (t.scheduled) logAct_(who, 'Tuning scheduled', t.summary || req.serial,
        (t.date || '') + ' ' + (t.time || ''));
      return json_(t);
    }
    if (req.action === 'setphase') {
      var ph = setPhase_(req);
      if (ph.ok) logAct_(who, 'Phase change', ph.summary || req.serial,
        (ph.previous || '(none)') + ' → ' + (ph.phase || '(none)'));
      return json_(ph);
    }
    if (req.action === 'fixtabs') return json_(fixTabs_());
    if (req.action === 'setmedia') {
      var md = setMedia_(req, who);
      if (md.ok && md.detail) logAct_(who, 'Media done', md.summary || req.serial, md.detail);
      return json_(md);
    }
    if (req.action === 'photo') {
      var pt = savePhoto_(req, who);
      if (pt.saved) logAct_(who, 'Progress photo', pt.summary || req.serial,
        (req.stage || '(no phase)') + ' → ' + pt.name);
      return json_(pt);
    }
    if (req.action === 'queue') {
      var qm = queueMove_(req);
      if (qm.ok && qm.moved) logAct_(who, 'Queue change', qm.summary || req.serial,
        (req.from_pos && req.to_pos)
          ? 'queue #' + req.from_pos + ' → #' + req.to_pos
          : 'moved ' + (req.where === 'after' ? 'after' : 'before') + ' s/n ' + req.anchor_serial);
      return json_(qm);
    }
    var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
    var last = sh.getLastRow();
    var serials = sh.getRange(1, 3, last, 1).getValues();  // col C
    var owners = sh.getRange(1, 2, last, 1).getValues();   // col B (SOLD divider)
    var soldRow = last + 1;
    for (var i = 0; i < last; i++) {
      if (String(owners[i][0] || '').trim().toUpperCase() === 'SOLD'
          && !String(serials[i][0] || '').trim()) { soldRow = i + 1; break; }
    }
    var want = String(req.serial || '').trim().toLowerCase();
    if (!want) return json_({error: 'serial required'});
    var matches = [];
    for (var r = 1; r < soldRow; r++) {
      if (String(serials[r - 1][0] || '').trim().toLowerCase() === want) matches.push(r);
    }
    if (!matches.length) return json_({error: 'serial not found above the SOLD section'});
    if (matches.length > 1 && !req.row) {
      return json_({error: 'multiple active rows share this serial', rows: matches});
    }
    var row = req.row || matches[0];
    var summary = String(sh.getRange(row, 4).getValue() || '');
    var current = String(sh.getRange(row, 21).getValue() || '');
    if (req.action === 'move' && req.newLocation != null && String(req.newLocation).trim()) {
      sh.getRange(row, 21).setValue(String(req.newLocation).trim());
      logAct_(who, 'Moved', summary || req.serial,
        (current || '(blank)') + ' → ' + String(req.newLocation).trim());
      return json_({ok: true, moved: true, row: row, summary: summary,
                    previous: current, location: String(req.newLocation).trim()});
    }
    return json_({ok: true, row: row, summary: summary, location: current});
  } catch (err) {
    return json_({error: String(err)});
  }
}

/* ---------- progress photos (one-tap capture from the Store Map) ---------- */
// Save a phone photo into the piano's existing "Tech" Drive subfolder, named
// by serial + current phase + date, and record it on the PHOTO LOG tab so
// client-update drafts can pull "photos for this stage" later.
function savePhoto_(req, who) {
  if (!req.data) return {error: 'no image data'};
  var ss = SpreadsheetApp.openById(PIANO_LOG_ID);
  var sh = pianoSheet_(ss);
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var serial = String(req.serial || '').trim();
  var tech = techFolderFor_(sh, found.row, serial);
  if (!tech) return {error: 'no Drive folder found for this piano — add its link to the Main Folder column in the Piano Log'};

  var stageSlug = String(req.stage || '').replace(/[^\w &-]+/g, '').trim()
                    .replace(/\s+/g, '-') || 'no-phase';
  var day = Utilities.formatDate(new Date(), 'America/Denver', 'yyyy-MM-dd');
  var prefix = serial + '__' + stageSlug + '__' + day;
  var n = 1, it = tech.getFiles();
  while (it.hasNext()) { if (it.next().getName().indexOf(prefix) === 0) n++; }
  var name = prefix + '__' + n + (String(req.mime || '') === 'image/png' ? '.png' : '.jpg');

  var blob = Utilities.newBlob(Utilities.base64Decode(String(req.data)),
                               String(req.mime || 'image/jpeg'), name);
  var file = tech.createFile(blob);

  var log = ss.getSheetByName(PHOTO_LOG_TAB);
  if (!log) {
    log = ss.insertSheet(PHOTO_LOG_TAB, ss.getSheets().length);   // LAST tab — the apps read the first tab's CSV
    log.appendRow(['When', 'Serial', 'Piano', 'Stage', 'By', 'File', 'Link']);
    log.setFrozenRows(1);
  }
  log.appendRow([new Date(), serial, found.summary || '', String(req.stage || ''),
                 who, name, file.getUrl()]);
  return {ok: true, saved: true, name: name, link: file.getUrl(),
          folder: tech.getName(), summary: found.summary};
}

// Resolve the piano's "Tech" photos subfolder. Prefers the Main Folder link on
// the piano's row (located by header text, so the column can move); falls back
// to searching the photos root tree for a folder whose name carries the serial.
function techFolderFor_(sh, row, serial) {
  var folder = null;
  var hdr = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  for (var i = 0; i < hdr.length; i++) {
    if (String(hdr[i] || '').trim().toUpperCase() === 'MAIN FOLDER') {
      var link = String(sh.getRange(row, i + 1).getValue() || '');
      var m = /folders\/([A-Za-z0-9_-]+)/.exec(link);
      if (m) { try { folder = DriveApp.getFolderById(m[1]); } catch (e) {} }
      break;
    }
  }
  // the link may point at the make-level folder — descend to the serial folder
  if (folder && folder.getName().indexOf(serial) < 0) {
    var kids = folder.getFolders();
    while (kids.hasNext()) {
      var k = kids.next();
      if (k.getName().indexOf(serial) >= 0) { folder = k; break; }
    }
  }
  if (!folder && serial) {
    var q = DriveApp.searchFolders('title contains ' + JSON.stringify(serial));
    while (q.hasNext()) {
      var cand = q.next();
      if (underRoot_(cand)) { folder = cand; break; }
      if (!folder) folder = cand;   // fallback: any match
    }
  }
  if (!folder) return null;
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var s = subs.next();
    if (/^tech/i.test(s.getName())) return s;
  }
  return folder.createFolder('Tech');
}

function underRoot_(folder) {
  try {
    var seen = 0, p = folder.getParents();
    while (p.hasNext() && seen++ < 6) {
      var par = p.next();
      if (par.getId() === PHOTOS_ROOT_ID) return true;
      p = par.getParents();
    }
  } catch (e) {}
  return false;
}

function pianoSheet_(ss) {
  // the Piano Log tab isn't necessarily the leftmost sheet: pick the one
  // whose C2 header mentions SERIAL, falling back by name
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var v = String(sheets[i].getRange(2, 3).getValue() || '').toUpperCase();
    if (v.indexOf('SERIAL') >= 0) return sheets[i];
  }
  return ss.getSheetByName('Piano Log') || sheets[0];
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function isManualRun_() {
  // heuristics aside, manual editor runs should always send; the trigger
  // passes through the weekday gate above. Editor runs have no trigger id.
  return true;
}

function buildReport_(data, slotsDoc) {
  var slotFloor = {};
  slotsDoc.floors.forEach(function (f, fi) {
    f.slots.forEach(function (s) { slotFloor[s.id.toLowerCase()] = fi; });
  });
  var act = data.pianos.filter(function (p) { return p.active; });
  var today = Utilities.formatDate(new Date(), 'America/Denver', 'yyyy-MM-dd');
  var moves = data.events.filter(function (e) { return e.date === today; });
  var floor = [0, 0], bySlot = {};
  act.forEach(function (p) {
    var loc = (p.location || '').toLowerCase();
    if (p.isSlot && loc in slotFloor) {
      floor[slotFloor[loc]]++;
      (bySlot[loc] = bySlot[loc] || []).push(p);
    }
  });
  var unplaced = act.filter(function (p) {
    if (!p.location) return true;
    if (p.isSlot) return !(p.location.toLowerCase() in slotFloor);
    var l = p.location.toLowerCase();
    return !KNOWN_AREAS.some(function (a) { return l.indexOf(a) >= 0; });
  });
  var dups = Object.keys(bySlot).filter(function (k) { return bySlot[k].length > 1; })
    .sort(function (a, b) { return bySlot[b].length - bySlot[a].length; })
    .map(function (k) { return {slot: k, pianos: bySlot[k]}; });
  var seen = {}, total = 0;
  act.forEach(function (p) {
    var key = p.serial || 'row' + p.row;
    if (!seen[key]) { seen[key] = 1; total++; }
  });
  return {
    total: total, floor1: floor[0], floor2: floor[1], moves: moves,
    unplaced: unplaced, dups: dups, crew: data.crew || [],
    newWeek: act.filter(function (p) { return p.isNew; }).length,
  };
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function reportHtml_(r) {
  var day = Utilities.formatDate(new Date(), 'America/Denver', 'EEEE, MMMM d, yyyy');
  function chip(n, l) {
    return '<td style="padding:10px 16px;background:#f7f8f9;border:1px solid #e3e6e9;'
      + 'border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:800;'
      + 'color:#121212">' + n + '</div><div style="font-size:10px;letter-spacing:1px;'
      + 'color:#8a929a">' + l + '</div></td>';
  }
  var chips = chip(r.total, 'TOTAL PIANOS') + chip(r.floor1, '1ST FLOOR')
    + chip(r.floor2, '2ND FLOOR') + chip(r.moves.length, 'MOVES TODAY')
    + chip(r.newWeek, 'NEW THIS WEEK')
    + chip(r.unplaced.length + ' / ' + r.dups.length, 'UNPLACED / DUP SLOTS');
  var mv = r.moves.map(function (e) {
    return '<li style="margin:4px 0">' + (e.done ? '✅ ' : '') + '<b>'
      + (e.time || 'all day') + '</b> — ' + esc_(e.summary) + '</li>';
  }).join('') || '<li>No moves on today’s calendar.</li>';
  var th = '<th style="text-align:left;font-size:10px;letter-spacing:1px;color:#8a929a;'
    + 'border-bottom:2px solid #eceef0;padding:5px 10px 5px 0">';
  var td = '<td style="border-bottom:1px solid #f0f2f4;padding:6px 10px 6px 0;font-size:13px">';
  var un = r.unplaced.slice(0, 60).map(function (p) {
    return '<tr>' + td + esc_((p.summary || '').slice(0, 45)) + '</td>' + td
      + esc_(p.serial) + '</td>' + td + esc_((p.section || '').slice(0, 30)) + '</td>'
      + td + '<b style="color:#9e2020">' + esc_(p.location || '(blank)') + '</b></td></tr>';
  }).join('');
  if (r.unplaced.length > 60) {
    un += '<tr>' + td + '… and ' + (r.unplaced.length - 60) + ' more</td></tr>';
  }
  var du = r.dups.slice(0, 40).map(function (d) {
    return '<tr>' + td + '<b style="color:#9e2020">' + esc_(d.slot) + '</b></td>' + td
      + esc_(d.pianos.map(function (p) { return (p.summary || '').slice(0, 35); }).join(' • '))
      + '</td></tr>';
  }).join('');
  var logUrl = 'https://docs.google.com/spreadsheets/d/1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc/edit';
  return '<div style="font-family:Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto">'
    + '<div style="background:#0d0d0d;color:#fff;padding:18px 24px;border-radius:10px 10px 0 0">'
    + '<div style="font-family:Georgia,serif;letter-spacing:4px;font-size:18px">BRIGHAM LARSON '
    + '<span style="color:#d6d6d6">PIANOS</span></div>'
    + '<div style="font-size:12px;color:#bbb;letter-spacing:2px;margin-top:3px">STORE MAP — DAILY REPORT · '
    + day + '</div></div>'
    + '<div style="border:1px solid #e3e6e9;border-top:none;border-radius:0 0 10px 10px;padding:20px 24px">'
    + '<table cellspacing="6" style="width:100%;border-collapse:separate"><tr>' + chips + '</tr></table>'
    + '<h3 style="color:#9e2020;letter-spacing:1.5px;font-size:13px;margin:18px 0 6px">🚚 TODAY\'S MOVES</h3>'
    + '<div style="font-size:12px;color:#8a929a;margin-bottom:4px">Crew: '
    + (esc_(r.crew.join(' · ')) || 'none listed') + '</div>'
    + '<ul style="margin:6px 0;padding-left:18px;font-size:13px">' + mv + '</ul>'
    + '<h3 style="color:#9e2020;letter-spacing:1.5px;font-size:13px;margin:18px 0 6px">⚠️ UNPLACED PIANOS ('
    + r.unplaced.length + ')</h3>'
    + '<table style="width:100%;border-collapse:collapse"><tr>' + th + 'PIANO</th>' + th
    + 'SERIAL</th>' + th + 'LOG SECTION</th>' + th + 'COL U SAYS</th></tr>' + un + '</table>'
    + '<h3 style="color:#9e2020;letter-spacing:1.5px;font-size:13px;margin:18px 0 6px">🔁 DUPLICATE SPOT NUMBERS ('
    + r.dups.length + ')</h3>'
    + '<table style="width:100%;border-collapse:collapse"><tr>' + th + 'SLOT</th>' + th
    + 'PIANOS CLAIMING IT</th></tr>' + du + '</table>'
    + '<p style="font-size:12px;color:#8a929a;margin-top:16px">Fix rows in the '
    + '<a href="' + logUrl + '" style="color:#9e2020">Piano Log</a> (column U) — '
    + '<a href="' + APP_URL + '" style="color:#9e2020">the map</a> updates within 2 minutes. '
    + 'Sent by the Store Map Apps Script, weekdays at 6 AM Mountain.</p></div></div>';
}

// Run once from the editor to grant Calendar access (used by the tuning feature)
function authorizeCalendar() {
  var cal = CalendarApp.getCalendarById(TUNING_CAL);
  Logger.log(cal ? 'OK: can see ' + cal.getName() : 'Calendar not shared with this account');
}


/**
 * Shop pipeline phase — shared with the BLP Shop app. Stored in the Piano
 * Log's CURRENT PHASE column (created at the first free column, header on
 * row 2, and found by name so column shuffles can't break it).
 */
var PHASE_HEADER = 'CURRENT PHASE';
var PHASE_VALUES = ['New Arrival', 'Assessment', 'Teardown', 'PRSB', 'CAP',
  'Refinishing', 'Final Assembly', 'DHRT', 'Tuning', 'QC',
  'Admin Exit Prep', 'Delivered', 'In Queue', 'Paused', 'For Sale'];

function phaseCol_(sh) {
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === PHASE_HEADER) return c + 1;
  }
  sh.getRange(2, last + 1).setValue(PHASE_HEADER);
  return last + 1;
}

function setPhase_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var phase = String(req.phase == null ? '' : req.phase).trim();
  if (phase && PHASE_VALUES.indexOf(phase) < 0) return {error: 'unknown phase: ' + phase};
  var col = phaseCol_(sh);
  var prev = String(sh.getRange(found.row, col).getValue() || '');
  sh.getRange(found.row, col).setValue(phase);
  return {ok: true, row: found.row, summary: found.summary,
          previous: prev, phase: phase};
}

/**
 * Who made this change — for the ACTIVITY LOG sheet. If the request carries
 * a Google ID token (from "Sign in with Google" in the map app) it is
 * verified against Google's tokeninfo endpoint; otherwise the unverified
 * display name the app sent is used, and failing that just "Team (PIN)".
 */
function who_(req) {
  var g = verifyGoogle_(req.idToken);
  if (g) return (g.name || g.email) + (g.email ? ' <' + g.email + '>' : '');
  if (req.user && (req.user.name || req.user.email)) {
    return String(req.user.name || req.user.email).slice(0, 60) + ' (session expired — unverified)';
  }
  return 'Team (PIN)';
}

function verifyGoogle_(tok) {
  if (!tok) return null;
  try {
    var r = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tok),
      {muteHttpExceptions: true});
    if (r.getResponseCode() !== 200) return null;
    var j = JSON.parse(r.getContentText());
    if (GOOGLE_CLIENT_ID.indexOf('PASTE') < 0 && j.aud !== GOOGLE_CLIENT_ID) return null;
    if (Number(j.exp) * 1000 < Date.now()) return null;
    return {email: j.email || '', name: j.name || ''};
  } catch (err) { return null; }
}

/**
 * Activity log — every write through this bridge is appended to an
 * "ACTIVITY LOG" tab in the Piano Log spreadsheet (created on first use).
 * ?fn=activity returns the most recent 300 entries, newest first.
 */
function logAct_(who, action, piano, detail) {
  try {
    var ss = SpreadsheetApp.openById(PIANO_LOG_ID);
    var sh = ss.getSheetByName('ACTIVITY LOG');
    if (!sh) {
      sh = ss.insertSheet('ACTIVITY LOG', ss.getSheets().length);   // LAST tab — the apps read the first tab's CSV
      sh.appendRow(['When', 'Who', 'Action', 'Piano', 'Details']);
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), String(who || ''), String(action || ''),
                  String(piano || ''), String(detail || '')]);
  } catch (err) { /* logging must never break the write itself */ }
}

function activity_() {
  var ss = SpreadsheetApp.openById(PIANO_LOG_ID);
  var sh = ss.getSheetByName('ACTIVITY LOG');
  if (!sh || sh.getLastRow() < 2) return {rows: []};
  var n = Math.min(sh.getLastRow() - 1, 300);
  var vals = sh.getRange(sh.getLastRow() - n + 1, 1, n, 5).getValues();
  var tz = 'America/Denver';
  return {rows: vals.map(function (r) {
    return [r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'MMM d, yyyy h:mm a') : String(r[0]),
            String(r[1]), String(r[2]), String(r[3]), String(r[4])];
  }).reverse()};
}

/**
 * Media checkoffs — "photos taken" / "video made" from the map's data card.
 * Writes a dated ✓ stamp into the Piano Log's media columns
 * (N=before photos, P=after photos, Q=before video, R=after video).
 * One-way on purpose: it never overwrites a non-empty cell (those often
 * hold real links), so un-marking is done in the spreadsheet itself.
 */
var MEDIA_COLS = {bphoto: 14, aphoto: 16, bvideo: 17, avideo: 18};
var MEDIA_NAMES = {bphoto: 'before photos', aphoto: 'after photos',
                   bvideo: 'before video', avideo: 'after video'};

function setMedia_(req, who) {
  var col = MEDIA_COLS[req.field];
  if (!col) return {error: 'unknown media field: ' + req.field};
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var cell = sh.getRange(found.row, col);
  var prev = String(cell.getValue() || '').trim();
  if (prev) {   // already has a link/note — nothing to do, but not an error
    return {ok: true, row: found.row, summary: found.summary,
            field: req.field, already: true};
  }
  var stamp = '✓ ' + Utilities.formatDate(new Date(), 'America/Denver', 'MMM d, yyyy');
  var name = String(who || '').replace(/\s*<[^>]*>\s*/, '').replace(/\s*\(.*\)\s*$/, '');
  if (name && name !== 'Team (PIN)') stamp += ' — ' + name;
  cell.setValue(stamp);
  return {ok: true, row: found.row, summary: found.summary, field: req.field,
          detail: MEDIA_NAMES[req.field] + ' marked done'};
}

// One-shot repair: helper tabs (ACTIVITY LOG / PHOTO LOG) must never sit at
// index 0 — the Store Map, Piano Log app, and Shop app all read the
// spreadsheet's FIRST tab via CSV export. Moves them to the end.
function fixTabs_() {
  var ss = SpreadsheetApp.openById(PIANO_LOG_ID);
  var moved = [];
  ['ACTIVITY LOG', PHOTO_LOG_TAB].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh) {
      ss.setActiveSheet(sh);
      ss.moveActiveSheet(ss.getSheets().length);
      moved.push(name);
    }
  });
  var main = pianoSheet_(ss);
  return {ok: true, moved: moved, firstTab: ss.getSheets()[0].getName(),
          pianoGid: main.getSheetId()};
}

/* ---------- shop queue reorder (Custom Shopwork row order = the queue) ----
   Serial-anchored: "move piano S before/after piano T". Both rows are located
   by exact serial match above the SOLD divider at execution time — never by
   remembered row numbers, which shift constantly as pianos come and go. The
   map app computes the anchor from live queue positions; all other queue
   numbers adjust organically because they derive from row order. */
function queueMove_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
    var last = sh.getLastRow();
    var serials = sh.getRange(1, 3, last, 1).getValues();
    var owners = sh.getRange(1, 2, last, 1).getValues();
    var soldRow = last + 1;
    for (var i = 0; i < last; i++) {
      if (String(owners[i][0] || '').trim().toUpperCase() === 'SOLD'
          && !String(serials[i][0] || '').trim()) { soldRow = i + 1; break; }
    }
    var findUnique = function (serial) {
      var want = String(serial || '').trim().toLowerCase();
      if (!want) return {error: 'serial required'};
      var m = [];
      for (var r = 1; r < soldRow; r++) {
        if (String(serials[r - 1][0] || '').trim().toLowerCase() === want) m.push(r);
      }
      if (!m.length) return {error: 'serial ' + serial + ' not found above the SOLD section'};
      if (m.length > 1) return {error: 'serial ' + serial + ' appears in rows ' + m.join(', ') + ' — fix in the Piano Log first'};
      return {row: m[0]};
    };
    if (String(req.serial || '').trim().toLowerCase() ===
        String(req.anchor_serial || '').trim().toLowerCase()) {
      return {ok: true, moved: false};
    }
    var src = findUnique(req.serial);
    if (src.error) return src;
    var anc = findUnique(req.anchor_serial);
    if (anc.error) return {error: 'anchor piano: ' + anc.error};
    var summary = String(sh.getRange(src.row, 4).getValue() || '');
    var dest = anc.row + (req.where === 'after' ? 1 : 0);
    sh.moveRows(sh.getRange(src.row, 1), dest);
    SpreadsheetApp.flush();
    return {ok: true, moved: true, summary: summary,
            from_row: src.row, anchor_row: anc.row};
  } finally {
    lock.releaseLock();
  }
}
