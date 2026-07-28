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
var MASTER_TUNING_CAL = 'blp.matthewputnam@gmail.com';   // "03-In Store Tuning"
// every calendar scanned for scheduled/past tunings (old master kept for history)
var TUNING_CALS = [TUNING_CAL, MASTER_TUNING_CAL, 'pianotuning.blp@gmail.com'];
var TECH_WORK_START = 8, TECH_WORK_END = 16;   // non-Korban techs: 8am-4pm gap search
// the tuning-request dropdown (Brigham-approved list, Korban default).
// Calendar id doubles as the invite email.
var TUNING_TECHS = [
  {id: TUNING_CAL, name: 'Korban Greenhalgh'},
  {id: 'curtisbiggs.blp@gmail.com', name: 'Curtis Biggs'},
  {id: 'jakepulver.blp@gmail.com', name: 'Jake Pulver'},
  {id: 'mckinlylopp.blp@gmail.com', name: 'McKinly Lopp'},
  {id: 'matthewwessman.blp@gmail.com', name: 'Matthew Wessman'},
];
// OAuth web client for "Sign in with Google" in the map app — used only to
// verify who made a change for the activity log. Client IDs are public.
var GOOGLE_CLIENT_ID = '110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com';
// personal-gmail team accounts allowed to write without the PIN when
// signed in with Google (BLP domain + .blp@gmail.com accounts always are)
var TEAM_EMAILS = ['brighamlarson@gmail.com'];
// showroom repairs: master record calendar + who can be assigned
var SERVICE_CAL = 'qualitycontrol.blp@gmail.com';   // 20-QC & Showroom repairs
// in-store move requests batch into one Monday-7am event on the moving cal
var MOVING_CAL = 'pianomoving.blp@gmail.com';
var MOVE_EVENT_TITLE = 'In-store moves — Store Map requests';
// price workflow: who gets "please set a price" requests, and who gets the
// printable tag whenever a price is added or changed
var PRICE_REQUEST_TO = 'brigham@brighamlarsonpianos.com';
var TAG_ALERT_TO = 'info@brighamlarsonpianos.com';
// Curtis Harper work orders spreadsheet — "Requested" tab gets new rows
var CURTIS_SHEET_ID = '1DxvDQ9WlhxXfiZaKGpdJLOOPNMBfVA9PsHGuLe55pmc';
var CURTIS_TAB = 'Requested';
// Admin requests: who can be picked, where Monday-batch requests collect,
// and where the Monday-8am digest goes
var ADMINS = [
  {name: 'Melissa', email: 'melissa@brighamlarsonpianos.com'},
  {name: 'Brigham', email: 'brigham@brighamlarsonpianos.com'},
  {name: 'Karmel', email: 'karmel@brighamlarsonpianos.com'},
  {name: 'Alisa', email: 'alisa@brighamlarsonpianos.com'},
  {name: 'Susie', email: 'susie@brighamlarsonpianos.com'},
  {name: 'Walter', email: 'walter@brighamlarsonpianos.com'},
];
var ADMIN_NOTES_TAB = 'WALK AROUND ADMIN NOTES';
var ADMIN_DIGEST_TO = 'info@brighamlarsonpianos.com';
var TUNING_SLOTS = [8, 9.5];               // Korban's weekday starts: 8:00 + 9:30 (Denver)
var TUNING_MINUTES = 90;                   // block length, matches Korban's bookings
var KNOWN_AREAS = ['showroom', 'pre-sale showroom', 'third floor', 'storage',
  'shop', 'vestibule', 'wing room', 'holding room', 'attic', 'sold floor',
  'rebuilding line', 'refinishing', 'back shop', 'middle shop', 'basement',
  'warehouse', 'rental', 'rented', 'out for delivery', 'customer'];

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
    var cal = calById_(TUNING_CALS[c]);
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
  if (!seenCal) return {error: 'no tuning calendar shared with ' + 'the bridge account (brigham@)', upcoming: [], past: []};
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
  var master = calById_(MASTER_TUNING_CAL);
  if (!master) return {error: 'the master tuning calendar is not shared with ' + 'the bridge account (brigham@)'};
  // availability is read from the technician's own calendar; if theirs
  // isn't shared with this account yet, the master calendar stands in
  var techCal = calById_(techId);
  var searchCal = techCal || master;
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var techName = String(req.techName || (techCal ? techCal.getName() : techId))
    .replace(/^\d+\s*-\s*/, '').trim();
  var title = 'Tuning: ' + (found.summary || 'piano') + ' #' + req.serial;
  var slot = techId === TUNING_CAL ? korbanSlot_(searchCal, tz) : openGap_(searchCal, tz, techName);
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
    // the master tuning calendar is the record: the event is created THERE
    // first, and the technician is invited to it (it lands on their own
    // calendar as an invitation)
    // the map spot number rides in the event's location/address field
    master.createEvent(title + ' — ' + techName, slot.start, slot.end,
      {description: desc, location: String(found.location || ''),
       guests: techId, sendInvites: true});
    try { CacheService.getScriptCache().remove('tunings'); } catch (ig) {}
  }
  return {ok: true, scheduled: true, dryrun: !!req.dryrun, tech: techName,
          date: Utilities.formatDate(slot.start, tz, 'EEE, MMM d'),
          iso: Utilities.formatDate(slot.start, tz, 'yyyy-MM-dd'),
          hhmm: Utilities.formatDate(slot.start, tz, 'HH:mm'),
          time: Utilities.formatDate(slot.start, tz, 'h:mm a'),
          summary: found.summary, title: title};
}

/* cancel upcoming tuning events for a serial across the tuning calendars
   (master, legacy master, Korban's own) — {serial, dryrun?} */
function deleteTuning_(req) {
  var serial = String(req.serial || '').trim();
  if (!serial) return {error: 'serial required'};
  var cals = [MASTER_TUNING_CAL, 'pianotuning.blp@gmail.com', TUNING_CAL];
  var now = new Date();
  var horizon = new Date(now.getTime() + 90 * 86400000);
  var removed = [];
  for (var i = 0; i < cals.length; i++) {
    var cal = calById_(cals[i]);
    if (!cal) continue;
    var evs = cal.getEvents(now, horizon, {search: serial});
    for (var k = 0; k < evs.length; k++) {
      var t = evs[k].getTitle();
      if (t.indexOf('Tuning') !== 0 || t.indexOf(serial) < 0) continue;
      removed.push({cal: cals[i], title: t,
        start: Utilities.formatDate(evs[k].getStartTime(), 'America/Denver', 'EEE MMM d h:mm a'),
        desc: evs[k].getDescription()});
      if (!req.dryrun) { try { evs[k].deleteEvent(); } catch (ig) {} }
    }
  }
  if (!req.dryrun && removed.length) { try { CacheService.getScriptCache().remove('tunings'); } catch (ig) {} }
  return {ok: true, dryrun: !!req.dryrun, removed: removed};
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
      var hh = Math.floor(TUNING_SLOTS[s]);
      var mm = TUNING_SLOTS[s] % 1 ? '30' : '00';
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

// any other technician: first open gap (minutes long, default 90) in
// weekday working hours (8am-4pm, starts on the half hour); days with an
// all-day NO/OFF/VACATION event are skipped
function openGap_(cal, tz, techName, minutes) {
  minutes = minutes || TUNING_MINUTES;
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
    for (var h = TECH_WORK_START; h + minutes / 60 <= TECH_WORK_END; h += 0.5) {
      var hh = Math.floor(h), mm = h % 1 ? '30' : '00';
      var start = new Date(y + 'T' + ('0' + hh).slice(-2) + ':' + mm + ':00');
      var end = new Date(start.getTime() + minutes * 60000);
      var clash = dayEvents.some(function (ev) {
        return !ev.isAllDayEvent() && ev.getStartTime() < end && ev.getEndTime() > start;
      });
      if (!clash) return {start: start, end: end};
    }
  }
  return null;
}

/**
 * Technician list for the tuning-request form — the fixed Brigham-approved
 * roster in TUNING_TECHS (Korban first as the default).
 */
function techs_() {
  return {techs: TUNING_TECHS.map(function (t) {
    return {id: t.id, name: t.name, isDefault: t.id === TUNING_CAL};
  })};
}

/**
 * Add a brand-new piano to the Piano Log from the map's "+" button.
 * Inserts a row just above the SOLD divider with owner/serial/summary/
 * year/make/model/size/category, location (the clicked spot), today's
 * arrival date, and phase "New Arrival - Admin". If the serial already
 * exists, returns {duplicate:true} with the existing piano's row/summary/
 * location so the app can offer "move it here instead". dryrun supported.
 */
function addPiano_(req) {
  var serial = String(req.serial || '').trim();
  if (!serial) return {error: 'serial required'};
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var last = sh.getLastRow();
  var serials = sh.getRange(1, 3, last, 1).getValues();
  var owners = sh.getRange(1, 2, last, 1).getValues();
  var soldRow = last + 1;
  for (var i = 0; i < last; i++) {
    if (String(owners[i][0] || '').trim().toUpperCase() === 'SOLD'
        && !String(serials[i][0] || '').trim()) { soldRow = i + 1; break; }
  }
  for (var r = 1; r < soldRow; r++) {
    if (String(serials[r - 1][0] || '').trim().toLowerCase() === serial.toLowerCase()) {
      return {duplicate: true, row: r,
              summary: String(sh.getRange(r, 4).getValue() || ''),
              location: String(sh.getRange(r, 21).getValue() || '')};
    }
  }
  var summary = [req.year, req.make, req.model].filter(function (x) { return x; })
    .join(' ').trim() || ('Piano SN ' + serial);
  if (req.dryrun) return {ok: true, added: false, dryrun: true, soldRow: soldRow, summary: summary};
  var row = soldRow;                       // just above the SOLD divider
  sh.insertRowBefore(row);
  sh.getRange(row, 2).setValue(String(req.owner || 'BLP'));                 // B owner
  sh.getRange(row, 3).setValue(serial);                                     // C serial
  sh.getRange(row, 4).setValue(summary);                                    // D summary
  if (req.year) sh.getRange(row, 5).setValue(String(req.year));             // E
  if (req.make) sh.getRange(row, 6).setValue(String(req.make));             // F
  if (req.model) sh.getRange(row, 7).setValue(String(req.model));           // G
  if (req.size) sh.getRange(row, 8).setValue(String(req.size));             // H
  if (req.category) sh.getRange(row, 10).setValue(String(req.category));    // J
  sh.getRange(row, phaseCol_(sh)).setValue('New Arrival - Admin');
  if (req.location) sh.getRange(row, 21).setValue(String(req.location).trim());  // U
  sh.getRange(row, 22).setValue(
    Utilities.formatDate(new Date(), 'America/Denver', 'M/d/yyyy'));        // V arrival
  var bumped = req.location ? bumpOthers_(sh, req.location, row) : [];
  return {ok: true, added: true, row: row, summary: summary,
          location: String(req.location || '').trim(), bumped: bumped};
}

/**
 * One piano per numbered spot: when `spot` is (re)assigned to keepRow,
 * every other piano row claiming that spot is sent to the attic holding
 * zone ("Attic — bumped from N") to await correct reassignment.
 */
function bumpOthers_(sh, spot, keepRow) {
  spot = String(spot || '').trim();
  if (!/^\d+[a-zA-Z]?$/.test(spot)) return [];   // only numbered map spots
  var last = sh.getLastRow();
  var serials = sh.getRange(1, 3, last, 1).getValues();
  var owners = sh.getRange(1, 2, last, 1).getValues();
  var soldRow = last + 1;
  for (var i = 0; i < last; i++) {
    if (String(owners[i][0] || '').trim().toUpperCase() === 'SOLD'
        && !String(serials[i][0] || '').trim()) { soldRow = i + 1; break; }
  }
  var locs = sh.getRange(1, 21, soldRow - 1, 1).getValues();
  var bumped = [];
  for (var r = 1; r < soldRow; r++) {
    if (r === keepRow) continue;
    if (String(locs[r - 1][0] || '').trim().toLowerCase() !== spot.toLowerCase()) continue;
    if (!String(serials[r - 1][0] || '').trim()
        && !String(sh.getRange(r, 4).getValue() || '').trim()) continue;   // not a piano row
    sh.getRange(r, 21).setValue('Attic — bumped from ' + spot);
    bumped.push({row: r, summary: String(sh.getRange(r, 4).getValue() || ''),
                 serial: String(serials[r - 1][0] || '').trim()});
  }
  return bumped;
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
    // three ways in: the team PIN, the server-to-server secret, or a
    // verified Google sign-in from a BLP account (no PIN needed once
    // signed into the map)
    var g = verifyGoogle_(req.idToken);
    var gOk = g && g.email && (/@brighamlarsonpianos\.com$/i.test(g.email)
      || /\.blp@gmail\.com$/i.test(g.email)
      || TEAM_EMAILS.indexOf(g.email.toLowerCase()) >= 0);
    if (req.secret !== BRIDGE_SECRET && req.pin !== TEAM_PIN && !gOk) {
      return json_({error: 'unauthorized'});
    }
    var who = g ? ((g.name || g.email) + (g.email ? ' <' + g.email + '>' : ''))
                : who_(req);
    if (req.action === 'deltune') {
      var dt = deleteTuning_(req);
      if (!dt.dryrun && dt.removed && dt.removed.length) {
        logAct_(who, 'Tuning cancelled', req.serial, dt.removed.map(function (r) { return r.start; }).join('; '));
      }
      return json_(dt);
    }
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
      if (ph.ok && ph.movedToSold) logAct_(who, 'Moved to SOLD section', ph.summary || req.serial,
        'delivered — row relocated below the SOLD divider, off the map');
      return json_(ph);
    }
    if (req.action === 'fixtabs') return json_(fixTabs_());
    if (req.action === 'migratephases') {
      var mg = migratePhases_();
      if (mg.changed) logAct_(who, 'Phase migration', 'all pianos',
        mg.changed + ' cells: ' + JSON.stringify(mg.counts).slice(0, 300));
      return json_(mg);
    }
    if (req.action === 'setmedia') {
      var md = setMedia_(req, who);
      if (md.ok && md.detail) logAct_(who, 'Media done', md.summary || req.serial, md.detail);
      return json_(md);
    }
    if (req.action === 'addpiano') {
      var ap = addPiano_(req);
      if (ap.added) logAct_(who, 'Added piano', ap.summary || req.serial,
        'new row ' + ap.row + ' at spot ' + (req.location || '(none)'));
      return json_(ap);
    }
    if (req.action === 'service') {
      var sv = req.asap ? scheduleServiceAsap_(req) : scheduleService_(req);
      if (sv.scheduled && !sv.dryrun) logAct_(who, req.asap ? 'ASAP service scheduled' : 'Service scheduled',
        sv.summary || req.serial,
        (sv.tech || '') + ' · ' + (sv.date || '') + ' ' + (sv.time || '') + ' · ' + (req.minutes || 60) + ' min');
      return json_(sv);
    }
    if (req.action === 'movereq') {
      var mv = requestMove_(req, who);
      if (mv.scheduled && !mv.dryrun) logAct_(who, 'Move requested', mv.summary || req.serial,
        'Monday ' + (mv.date || '') + (req.newSpot ? ' → spot ' + req.newSpot : ''));
      return json_(mv);
    }
    if (req.action === 'setprice') {
      var pr = setPrice_(req, who);
      if (pr.ok) logAct_(who, 'Price set', pr.summary || req.serial,
        (pr.previous || '(none)') + ' → ' + pr.price);
      return json_(pr);
    }
    if (req.action === 'requestprice') {
      var rq = requestPrice_(req, who);
      if (rq.ok) logAct_(who, 'Price requested', rq.summary || req.serial,
        'email sent to ' + PRICE_REQUEST_TO);
      return json_(rq);
    }
    if (req.action === 'curtis') {
      var ch = curtisRequest_(req, who);
      if (ch.ok && !ch.dryrun) logAct_(who, 'Curtis Harper request', ch.summary || req.serial,
        (req.ctype || 'Other') + (req.notes ? ' — ' + String(req.notes).slice(0, 150) : ''));
      return json_(ch);
    }
    if (req.action === 'adminreq') {
      var ar = adminRequest_(req, who);
      if (ar.ok) logAct_(who, 'Admin request', ar.summary || req.serial,
        'to ' + (req.adminName || 'admin') + ' · ' + (req.when === 'monday' ? 'Monday batch' : 'sent now')
        + (req.notes ? ' — ' + String(req.notes).slice(0, 120) : ''));
      return json_(ar);
    }
    if (req.action === 'setupadmindigest') return json_(setupAdminDigest_());
    if (req.action === 'setdone') {
      var dn = setDone_(req);
      if (dn.ok) logAct_(who, 'Phases-done change', dn.summary || req.serial,
        (dn.previous || '(none)') + ' → ' + (dn.done || '(none)'));
      return json_(dn);
    }
    if (req.action === 'teamreq') {
      var tr = teamRequest_(req, who);
      if (tr.ok) logAct_(who, String(req.kind || 'Team') + ' request', tr.summary || req.serial,
        String(req.notes || '').slice(0, 200));
      return json_(tr);
    }
    if (req.action === 'setsnooze') {
      var sz = setSnooze_(req);
      if (sz.ok) logAct_(who, 'Waiting check-back set', sz.summary || req.serial,
        sz.checkBack || '(cleared)');
      return json_(sz);
    }
    if (req.action === 'setclientreports') {
      var cr = setClientReports_(req);
      if (cr.ok) logAct_(who, 'Client reports ' + (req.enabled ? 'ON' : 'OFF'),
        cr.summary || req.serial, '');
      return json_(cr);
    }
    if (req.action === 'settrack') {
      var tk = setTrack_(req);
      if (tk.ok) logAct_(who, 'Track change', tk.summary || req.serial,
        (tk.previous || '(none)') + ' → ' + (tk.track || '(none)'));
      return json_(tk);
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
      var dest = String(req.newLocation).trim();
      sh.getRange(row, 21).setValue(dest);
      logAct_(who, 'Moved', summary || req.serial,
        (current || '(blank)') + ' → ' + dest);
      // one piano per spot: whoever was already there gets bumped to the
      // attic (newest assignment is the accurate one)
      var bumped = bumpOthers_(sh, dest, row);
      bumped.forEach(function (b) {
        logAct_(who, 'Bumped to attic', b.summary,
          'spot ' + dest + ' reassigned; awaiting a new spot');
      });
      return json_({ok: true, moved: true, row: row, summary: summary,
                    previous: current, location: dest, bumped: bumped});
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


// getCalendarById only sees calendars in the account's list — a calendar
// merely SHARED with us returns null until subscribed. Subscribe on demand.
function calById_(id) {
  var c = CalendarApp.getCalendarById(id);
  if (!c) {
    try { c = CalendarApp.subscribeToCalendar(id); } catch (e) { /* not shared */ }
  }
  return c;
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
  var cal = calById_(TUNING_CAL);
  Logger.log(cal ? 'OK: can see ' + cal.getName() : 'Calendar not shared with this account');
}


/**
 * Shop pipeline phase — shared with the BLP Shop app. Stored in the Piano
 * Log's CURRENT PHASE column (created at the first free column, header on
 * row 2, and found by name so column shuffles can't break it).
 */
var PHASE_HEADER = 'CURRENT PHASE';
var PHASE_VALUES = ['New Arrival - Admin', 'Assessment', 'CAP',
  'PRSB & Plate Refinishing', 'Lacquer Soundboard', 'Restringing',
  'Chip Tuning', 'DHRT', '1st Tuning', 'Refinishing', 'QC & Assembly',
  '2nd Tuning', 'Exit Prep - Admin', 'Delivered',
  'In Queue', 'Paused', 'For Sale',
  'Waiting on Brigham', 'Waiting on Curtis Harper', 'Waiting on OTHER'];

// July 2026 phase rework: how the old phase names translate to the new
// 14-phase pipeline. Used once by the 'migratephases' action to update
// every CURRENT PHASE cell in the Piano Log.
var PHASE_MIGRATE = {
  'New Arrival': 'New Arrival - Admin',
  'Teardown': 'CAP',
  'PRSB': 'PRSB & Plate Refinishing',
  'Final Assembly': 'QC & Assembly',
  'Tuning': '1st Tuning',
  'QC': 'QC & Assembly',
  'Admin Exit Prep': 'Exit Prep - Admin',
};

function migratePhases_() {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var col = phaseCol_(sh);
  var last = sh.getLastRow();
  var rng = sh.getRange(1, col, last, 1);
  var vals = rng.getValues();
  var changed = 0, counts = {};
  for (var i = 0; i < vals.length; i++) {
    var v = String(vals[i][0] || '').trim();
    if (v && PHASE_MIGRATE[v]) {
      vals[i][0] = PHASE_MIGRATE[v];
      counts[v + ' → ' + PHASE_MIGRATE[v]] = (counts[v + ' → ' + PHASE_MIGRATE[v]] || 0) + 1;
      changed++;
    }
  }
  if (changed) rng.setValues(vals);
  return {ok: true, changed: changed, counts: counts};
}

/**
 * Work TRACK(s) — multi-select (Rebuild, Hybrid, Refurbish, Refinish,
 * Technology, Old Player), stored comma-separated in a TRACK column
 * (header row 2, created at the first free column like CURRENT PHASE).
 */
var TRACK_HEADER = 'TRACK';
var TRACK_VALUES = ['Rebuild', 'Hybrid', 'Refurbish', 'Refinish',
                    'Technology', 'Old Player', 'Misc'];

function trackCol_(sh) {
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === TRACK_HEADER) return c + 1;
  }
  sh.getRange(2, last + 1).setValue(TRACK_HEADER);
  return last + 1;
}

function setTrack_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var tracks = [];
  (req.tracks || []).forEach(function (t) {
    t = String(t).trim();
    if (TRACK_VALUES.indexOf(t) >= 0 && tracks.indexOf(t) < 0) tracks.push(t);
  });
  var col = trackCol_(sh);
  var prev = String(sh.getRange(found.row, col).getValue() || '');
  // Misc is unique work — its write-in summary rides along as "Misc (…)"
  var misc = String(req.miscNote || '').trim().replace(/,/g, ';');
  var val = tracks.map(function (t) {
    return (t === 'Misc' && misc) ? 'Misc (' + misc + ')' : t;
  }).join(', ');
  sh.getRange(found.row, col).setValue(val);
  return {ok: true, row: found.row, summary: found.summary,
          previous: prev, track: val};
}

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
  // waiting note: why we're waiting — stored in a WAITING NOTE column,
  // written with Waiting phases and cleared when the piano moves on
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  var ncol = -1;
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === 'WAITING NOTE') { ncol = c + 1; break; }
  }
  if (ncol < 0 && (req.note || phase.indexOf('Waiting') === 0)) {
    sh.getRange(2, last + 1).setValue('WAITING NOTE'); ncol = last + 1;
  }
  var note = '';
  if (ncol > 0) {
    if (phase.indexOf('Waiting') === 0) {
      if (req.note != null && String(req.note).trim()) {
        note = String(req.note).trim();
        sh.getRange(found.row, ncol).setValue(note);
      } else {
        note = String(sh.getRange(found.row, ncol).getValue() || '');
      }
    } else {
      sh.getRange(found.row, ncol).setValue('');
    }
  }
  // check-back date chosen in the Waiting popup rides the same write
  var cb = '';
  var cbcol = -1;
  hdr = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  for (var cc = 0; cc < hdr.length; cc++) {
    if (String(hdr[cc] || '').trim().toUpperCase() === 'CHECK BACK') { cbcol = cc + 1; break; }
  }
  if (cbcol < 0 && req.checkBack) {
    sh.getRange(2, sh.getLastColumn() + 1).setValue('CHECK BACK');
    cbcol = sh.getLastColumn();
  }
  if (cbcol > 0) {
    if (phase.indexOf('Waiting') === 0) {
      if (req.checkBack != null && String(req.checkBack).trim()) {
        cb = String(req.checkBack).trim();
        sh.getRange(found.row, cbcol).setValue(cb);
      } else {
        cb = String(sh.getRange(found.row, cbcol).getValue() || '');
      }
    } else {
      sh.getRange(found.row, cbcol).setValue('');
    }
  }
  var movedTo = null;
  // Delivered pianos exit the map: physically relocate the row into the
  // SOLD section (right after the divider) so the parsers' soldZone skip
  // takes it off the live map on the next fetch
  if (phase === 'Delivered' && found.row < soldDividerRow_(sh)) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sd = soldDividerRow_(sh);
      if (found.row < sd) {
        sh.moveRows(sh.getRange(found.row, 1), sd + 1);
        SpreadsheetApp.flush();
        movedTo = sd + 1;
      }
    } finally { lock.releaseLock(); }
  }
  return {ok: true, row: movedTo || found.row, summary: found.summary,
          previous: prev, phase: phase, note: note, checkBack: cb,
          movedToSold: !!movedTo};
}

// the row number of the "SOLD" divider (col B = SOLD, blank serial) —
// rows at or after this index are exited/sold, not on the live map
function soldDividerRow_(sh) {
  var last = sh.getLastRow();
  var owners = sh.getRange(1, 2, last, 1).getValues();
  var serials = sh.getRange(1, 3, last, 1).getValues();
  for (var i = 0; i < last; i++) {
    if (String(owners[i][0] || '').trim().toUpperCase() === 'SOLD'
        && !String(serials[i][0] || '').trim()) return i + 1;
  }
  return last + 1;
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
  var stamp = (req.skip ? 'Skipped ' : '✓ ')
    + Utilities.formatDate(new Date(), 'America/Denver', 'MMM d, yyyy');
  var name = String(who || '').replace(/\s*<[^>]*>\s*/, '').replace(/\s*\(.*\)\s*$/, '');
  if (name && name !== 'Team (PIN)') stamp += ' — ' + name;
  cell.setValue(stamp);
  return {ok: true, row: found.row, summary: found.summary, field: req.field,
          skipped: !!req.skip,
          detail: MEDIA_NAMES[req.field] + (req.skip ? ' skipped' : ' marked done')};
}

/**
 * Showroom service/repair request. Availability comes from the assigned
 * technician's calendar (Jake Pulver default); the event is created on the
 * QC & Showroom repairs calendar — the permanent service record — with the
 * technician invited so it reaches their calendar too. req: {serial, row?,
 * techId, techName, notes?, minutes (30-min increments), dryrun?}
 */
function scheduleService_(req) {
  var tz = 'America/Denver';
  var techId = String(req.techId || 'jakepulver.blp@gmail.com').trim();
  var master = calById_(SERVICE_CAL);
  if (!master) return {error: 'the QC & Showroom repairs calendar is not shared with ' + 'the bridge account (brigham@)'};
  var techCal = calById_(techId);
  var searchCal = techCal || master;
  var minutes = Math.max(30, Math.min(240, Math.round((Number(req.minutes) || 60) / 30) * 30));
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var techName = String(req.techName || (techCal ? techCal.getName() : techId))
    .replace(/^\d+\s*-\s*/, '').trim();
  var title = 'Service: ' + (found.summary || 'piano') + ' SN ' + req.serial
    + (found.location ? ' @ spot ' + found.location : '') + ' — ' + techName;
  var slot = openGap_(searchCal, tz, techName, minutes);
  if (!slot) return {error: 'no open ' + minutes + '-minute slot found on ' + techName + "'s calendar in the next 6 weeks"};
  var desc = 'Requested via BLP Store Map ('
    + Utilities.formatDate(new Date(), tz, 'MMM d, h:mm a') + ')'
    + '\nAssigned to: ' + techName + '\nTime allotted: ' + minutes + ' minutes';
  if (req.notes && String(req.notes).trim()) {
    desc += '\n\nService / repair request:\n' + String(req.notes).trim();
  }
  desc += '\n\nPiano Log: https://pianologapp.netlify.app/#piano=' +
    encodeURIComponent(req.serial);
  if (!req.dryrun) {
    master.createEvent(title, slot.start, slot.end,
      {description: desc, guests: techId, sendInvites: true});
  }
  return {ok: true, scheduled: true, dryrun: !!req.dryrun, tech: techName,
          minutes: minutes,
          date: Utilities.formatDate(slot.start, tz, 'EEE, MMM d'),
          time: Utilities.formatDate(slot.start, tz, 'h:mm a'),
          summary: found.summary, title: title};
}

/**
 * ASAP showroom service/repair — same request as scheduleService_ but skips
 * the "next open slot" search: books tomorrow (or Monday, if tomorrow is a
 * weekend) at 8am on the QC & Showroom repairs calendar, tech invited. If
 * the tech's own calendar already has a "fieldwork" event that morning, the
 * appointment starts right after that event ends instead of at 8am.
 * req: {serial, row?, techId, techName, notes?, minutes, dryrun?}
 */
function scheduleServiceAsap_(req) {
  var tz = 'America/Denver';
  var techId = String(req.techId || 'jakepulver.blp@gmail.com').trim();
  var master = calById_(SERVICE_CAL);
  if (!master) return {error: 'the QC & Showroom repairs calendar is not shared with ' + 'the bridge account (brigham@)'};
  var techCal = calById_(techId);
  var minutes = Math.max(30, Math.min(240, Math.round((Number(req.minutes) || 60) / 30) * 30));
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var techName = String(req.techName || (techCal ? techCal.getName() : techId))
    .replace(/^\d+\s*-\s*/, '').trim();

  // tomorrow, rolled to Monday if that's a Saturday or Sunday
  var day = new Date(Date.now() + 86400000);
  var dow = Number(Utilities.formatDate(day, tz, 'u'));
  if (dow === 6) day = new Date(day.getTime() + 2 * 86400000);
  else if (dow === 7) day = new Date(day.getTime() + 1 * 86400000);
  var y = Utilities.formatDate(day, tz, 'yyyy-MM-dd');

  var start = new Date(y + 'T08:00:00');
  if (techCal) {
    var dayEvents = techCal.getEvents(new Date(y + 'T00:00:00'), new Date(y + 'T23:59:59'));
    var fieldwork = dayEvents.filter(function (ev) { return /field\s*work/i.test(ev.getTitle() || ''); })
      .sort(function (a, b) { return a.getEndTime() - b.getEndTime(); }).pop();
    if (fieldwork && fieldwork.getEndTime() > start) start = fieldwork.getEndTime();
  }
  var end = new Date(start.getTime() + minutes * 60000);

  var title = 'ASAP Service: ' + (found.summary || 'piano') + ' SN ' + req.serial
    + (found.location ? ' @ spot ' + found.location : '') + ' — ' + techName;
  var desc = 'ASAP request via BLP Store Map ('
    + Utilities.formatDate(new Date(), tz, 'MMM d, h:mm a') + ')'
    + '\nAssigned to: ' + techName + '\nTime allotted: ' + minutes + ' minutes';
  if (req.notes && String(req.notes).trim()) {
    desc += '\n\nService / repair request:\n' + String(req.notes).trim();
  }
  desc += '\n\nPiano Log: https://pianologapp.netlify.app/#piano=' +
    encodeURIComponent(req.serial);

  if (!req.dryrun) {
    master.createEvent(title, start, end, {description: desc, guests: techId, sendInvites: true});
  }
  return {ok: true, scheduled: true, asap: true, dryrun: !!req.dryrun, tech: techName,
          minutes: minutes,
          date: Utilities.formatDate(start, tz, 'EEE, MMM d'),
          time: Utilities.formatDate(start, tz, 'h:mm a'),
          summary: found.summary, title: title};
}

/**
 * In-store move request. All requests batch into ONE event at 7am on the
 * next Monday on the moving calendar ("In-store moves — Store Map
 * requests"): the first request each week creates it, later ones append a
 * line to its description. req: {serial, row?, newSpot?, notes?, dryrun?}
 */
function requestMove_(req, who) {
  var tz = 'America/Denver';
  var cal = calById_(MOVING_CAL);
  if (!cal) return {error: 'the moving calendar is not shared with ' + 'the bridge account (brigham@)'};
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  // next Monday, starting tomorrow (requests made ON a Monday go to the
  // following week's batch — today's 7am move is already underway)
  var day = null;
  for (var d = 1; d <= 7; d++) {
    var cand = new Date(Date.now() + d * 86400000);
    if (Number(Utilities.formatDate(cand, tz, 'u')) === 1) { day = cand; break; }
  }
  var y = Utilities.formatDate(day, tz, 'yyyy-MM-dd');
  var start = new Date(y + 'T07:00:00');
  var end = new Date(y + 'T08:00:00');
  var name = String(who || '').replace(/\s*<[^>]*>\s*/, '').replace(/\s*\(.*\)\s*$/, '');
  var line = '• ' + (found.summary || 'piano') + ' SN ' + req.serial
    + (found.location ? ' — from ' + found.location : '')
    + (req.newSpot ? ' → to ' + String(req.newSpot).trim() : '')
    + (req.notes && String(req.notes).trim() ? ' (' + String(req.notes).trim() + ')' : '')
    + (name && name.indexOf('Team') !== 0 ? ' [' + name + ']' : '');
  if (!req.dryrun) {
    var evs = cal.getEvents(new Date(y + 'T00:00:00'), new Date(y + 'T23:59:59'));
    var ev = null;
    for (var i = 0; i < evs.length; i++) {
      if ((evs[i].getTitle() || '').indexOf(MOVE_EVENT_TITLE) === 0) { ev = evs[i]; break; }
    }
    if (ev) {
      ev.setDescription((ev.getDescription() || '') + '\n' + line);
    } else {
      cal.createEvent(MOVE_EVENT_TITLE, start, end,
        {description: 'Grouped in-store move requests from the Store Map app:\n\n' + line});
    }
  }
  return {ok: true, scheduled: true, dryrun: !!req.dryrun,
          date: Utilities.formatDate(start, tz, 'EEE, MMM d'),
          iso: y, time: '7:00 AM', summary: found.summary, line: line};
}

/**
 * Sale price — written into the Piano Log's PRICE column (found by header
 * name on row 2). Used by the For Sale popup on the map's data card.
 */
function setPrice_(req, who) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  var col = -1;
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === 'PRICE') { col = c + 1; break; }
  }
  if (col < 0) return {error: 'no PRICE column found in the Piano Log'};
  var raw = String(req.price == null ? '' : req.price).replace(/[^0-9.]/g, '');
  if (!raw) return {error: 'price required'};
  var num = Number(raw);
  if (!num || num <= 0) return {error: 'that does not look like a price'};
  var cell = sh.getRange(found.row, col);
  var prev = String(cell.getValue() || '');
  var pretty = '$' + num.toLocaleString('en-US');
  cell.setValue(pretty);
  // every added/changed price alerts info@ with a printable tag attached
  if (!req.silent && prev !== pretty) {
    try { sendTagEmail_(found, String(req.serial || ''), prev, pretty, who); }
    catch (mailErr) { /* the price is saved either way */ }
  }
  return {ok: true, row: found.row, summary: found.summary,
          previous: prev, price: pretty};
}

/**
 * Curtis Harper request — appends a row to the "Requested" tab of the
 * Curtis Harper work orders spreadsheet, matching its columns:
 * Ownership | Priority | DATE REQUESTED | location | PIANO/SERIAL # |
 * Issue | Pic | TYPE OF FINISH | ... req: {serial, row?, ctype
 * (Plate/Touch up/Decal/Other), notes?, dryrun?}
 */
function curtisRequest_(req, who) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  // serial optional: top-bar requests aren't tied to a piano
  var found = String(req.serial || '').trim()
    ? findPiano_(sh, req.serial, req.row)
    : {summary: String(req.pianoText || '').trim() || '(no specific piano)', location: '', row: 0};
  if (found.error) return found;
  var owner = found.row ? String(sh.getRange(found.row, 2).getValue() || '') : '';
  var ownership = /consign/i.test(owner) ? 'Consignment'
    : (!owner || /blp|reno|brigham/i.test(owner)) ? 'BLP' : 'Client';
  var ctype = String(req.ctype || 'Other').trim();
  var issue = ctype + (req.notes && String(req.notes).trim()
    ? ' — ' + String(req.notes).trim() : '');
  var name = String(who || '').replace(/\s*<[^>]*>\s*/, '').replace(/\s*\(.*\)\s*$/, '');
  if (req.dryrun) return {ok: true, dryrun: true, summary: found.summary, ownership: ownership};
  var css;
  try { css = SpreadsheetApp.openById(CURTIS_SHEET_ID); }
  catch (e) { return {error: 'the Curtis Harper work orders sheet is not shared with the bridge account (brigham@)'}; }
  var tab = css.getSheetByName(CURTIS_TAB) || css.getSheets()[0];
  tab.appendRow([
    ownership, '',                                                        // Ownership, Priority
    Utilities.formatDate(new Date(), 'America/Denver', 'M/d/yy'),         // DATE REQUESTED
    String(found.location || ''),                                         // location
    (found.summary || 'Piano') + ' ' + String(req.serial || ''),          // PIANO/SERIAL #
    issue + (name && name.indexOf('Team') !== 0 ? ' [' + name + ']' : ''),// Issue
  ]);
  return {ok: true, summary: found.summary, tab: tab.getName()};
}

/**
 * Admin request — either emailed immediately to the chosen admin, or
 * collected on the WALK AROUND ADMIN NOTES tab and sent as one digest to
 * info@ every Monday at 8am. req: {serial, row?, adminEmail, adminName,
 * notes?, when: 'now'|'monday', dryrun?}
 */
function adminRequest_(req, who) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  // serial optional: top-bar requests aren't tied to a piano
  var found = String(req.serial || '').trim()
    ? findPiano_(sh, req.serial, req.row)
    : {summary: String(req.pianoText || '').trim() || '(no specific piano)', location: '', row: 0};
  if (found.error) return found;
  var name = String(who || '').replace(/\s*<[^>]*>\s*/, '').replace(/\s*\(.*\)\s*$/, '');
  var adminName = String(req.adminName || 'Admin');
  var adminEmail = String(req.adminEmail || '').trim();
  var okAdmin = ADMINS.some(function (a) { return a.email === adminEmail; });
  if (!okAdmin) return {error: 'unknown admin: ' + adminEmail};
  if (req.dryrun) return {ok: true, dryrun: true, summary: found.summary};
  if (req.when === 'monday') {
    var ss = SpreadsheetApp.openById(PIANO_LOG_ID);
    var tab = ss.getSheetByName(ADMIN_NOTES_TAB);
    if (!tab) {
      tab = ss.insertSheet(ADMIN_NOTES_TAB, ss.getSheets().length);   // LAST tab
      tab.appendRow(['When', 'For', 'Piano', 'Serial', 'Spot', 'Request', 'By', 'Sent']);
      tab.setFrozenRows(1);
    }
    tab.appendRow([new Date(), adminName, found.summary || '', String(req.serial || ''),
                   String(found.location || ''), String(req.notes || ''), name, '']);
    return {ok: true, batched: true, summary: found.summary,
            note: 'in Monday morning batch'};
  }
  var logUrl = 'https://pianologapp.netlify.app/#piano=' + encodeURIComponent(req.serial);
  MailApp.sendEmail({
    to: adminEmail,
    subject: '📋 Admin request: ' + (found.summary || 'piano') + ' — SN ' + req.serial,
    htmlBody: '<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px">'
      + '<h2 style="margin:0 0 8px">Admin request from the Store Map</h2>'
      + '<p style="font-size:15px;margin:6px 0"><b>' + esc_(found.summary || 'Piano') + '</b><br>'
      + 'Serial ' + esc_(req.serial) + (found.location ? ' · Spot ' + esc_(found.location) : '') + '</p>'
      + (req.notes && String(req.notes).trim()
         ? '<p style="font-size:14px;white-space:pre-wrap;border-left:3px solid #9e2020;padding-left:10px">'
           + esc_(String(req.notes).trim()) + '</p>' : '')
      + '<p style="font-size:13px;color:#555">Requested by ' + esc_(name || 'the team') + '.</p>'
      + '<p style="font-size:13px"><a href="' + APP_URL + '" style="color:#9e2020">Store Map</a> · '
      + '<a href="' + logUrl + '" style="color:#9e2020">Piano Log</a></p></div>',
    body: 'Admin request for ' + (found.summary || 'piano') + ' SN ' + req.serial
      + (req.notes ? '\n\n' + String(req.notes).trim() : '') + '\n\nRequested by ' + (name || 'the team'),
    name: 'BLP Store Map',
  });
  return {ok: true, sent: true, summary: found.summary, sentTo: adminEmail};
}

// every Monday 8am (Denver): email all unsent WALK AROUND ADMIN NOTES rows
// to info@ in one digest, then mark them sent
function mondayAdminDigest() {
  var ss = SpreadsheetApp.openById(PIANO_LOG_ID);
  var tab = ss.getSheetByName(ADMIN_NOTES_TAB);
  if (!tab || tab.getLastRow() < 2) return;
  var n = tab.getLastRow() - 1;
  var vals = tab.getRange(2, 1, n, 8).getValues();
  var tz = 'America/Denver';
  var pending = [];
  for (var i = 0; i < vals.length; i++) {
    if (!String(vals[i][7] || '').trim()) pending.push({i: i, r: vals[i]});
  }
  if (!pending.length) return;
  // one digest PER ADMIN — each admin gets only their own requests
  var byAdmin = {};
  pending.forEach(function (p) {
    var k = String(p.r[1] || 'Admin');
    (byAdmin[k] = byAdmin[k] || []).push(p);
  });
  Object.keys(byAdmin).forEach(function (adminName) {
    var admin = null;
    for (var a = 0; a < ADMINS.length; a++) {
      if (ADMINS[a].name === adminName) { admin = ADMINS[a]; break; }
    }
    var to = admin ? admin.email : ADMIN_DIGEST_TO;
    var list = byAdmin[adminName];
    var rows = list.map(function (p) {
      var when = p.r[0] instanceof Date ? Utilities.formatDate(p.r[0], tz, 'EEE MMM d, h:mm a') : String(p.r[0]);
      return '<tr><td style="padding:5px 10px 5px 0;border-bottom:1px solid #eee;white-space:nowrap">' + esc_(when) + '</td>'
        + '<td style="padding:5px 10px 5px 0;border-bottom:1px solid #eee">' + esc_(String(p.r[2])) + (p.r[3] ? ' (SN ' + esc_(String(p.r[3])) + ')' : '') + (p.r[4] ? ' · spot ' + esc_(String(p.r[4])) : '') + '</td>'
        + '<td style="padding:5px 10px 5px 0;border-bottom:1px solid #eee">' + esc_(String(p.r[5])) + '</td>'
        + '<td style="padding:5px 0;border-bottom:1px solid #eee;color:#777">' + esc_(String(p.r[6])) + '</td></tr>';
    }).join('');
    MailApp.sendEmail({
      to: to,
      subject: '📋 Your Monday admin requests — ' + list.length + ' from the Store Map',
      htmlBody: '<div style="font-family:Helvetica,Arial,sans-serif;max-width:720px">'
        + '<h2 style="margin:0 0 10px">' + esc_(adminName) + ' — requests collected for you since last Monday</h2>'
        + '<table style="border-collapse:collapse;font-size:13px;width:100%">'
        + '<tr><th style="text-align:left;padding:4px 10px 4px 0;font-size:10px;color:#8a929a">WHEN</th>'
        + '<th style="text-align:left;padding:4px 10px 4px 0;font-size:10px;color:#8a929a">PIANO</th>'
        + '<th style="text-align:left;padding:4px 10px 4px 0;font-size:10px;color:#8a929a">REQUEST</th>'
        + '<th style="text-align:left;padding:4px 0;font-size:10px;color:#8a929a">BY</th></tr>'
        + rows + '</table>'
        + '<p style="font-size:12px;color:#8a929a;margin-top:14px">Collected on the WALK AROUND ADMIN NOTES tab of the Piano Log. Sent every Monday at 8 AM.</p></div>',
      body: list.length + ' admin requests for ' + adminName + ' — see the WALK AROUND ADMIN NOTES tab of the Piano Log.',
      name: 'BLP Store Map',
    });
  });
  var stamp = Utilities.formatDate(new Date(), tz, 'M/d/yyyy');
  pending.forEach(function (p) { tab.getRange(p.i + 2, 8).setValue(stamp); });
}

// one-time: install the Monday 8am digest trigger (idempotent)
function setupAdminDigest_() {
  var have = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'mondayAdminDigest';
  });
  if (!have) {
    ScriptApp.newTrigger('mondayAdminDigest').timeBased()
      .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8)
      .inTimezone('America/Denver').create();
  }
  return {ok: true, installed: !have, already: have};
}

/**
 * Phases-done checklist — phases a piano has COMPLETED (so later phases
 * can proceed even out of order). Comma-separated names in a PHASES DONE
 * column (header row 2). req: {serial, row?, phases: [...]}
 */
// per-piano client-reports switch — 'No' hides the piano from client
// reporting everywhere (map card button + Shop manager Client Reports)
// snooze for Waiting pianos: when to check whether the wait is over.
// Stored in a CHECK BACK column (header row 2). req: {serial,row?,date}
function setSnooze_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  var col = -1;
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === 'CHECK BACK') { col = c + 1; break; }
  }
  if (col < 0) { sh.getRange(2, last + 1).setValue('CHECK BACK'); col = last + 1; }
  var val = String(req.date || '').trim();
  sh.getRange(found.row, col).setValue(val);
  return {ok: true, row: found.row, summary: found.summary, checkBack: val};
}

function setClientReports_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  var col = -1;
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === 'CLIENT REPORTS') { col = c + 1; break; }
  }
  if (col < 0) { sh.getRange(2, last + 1).setValue('CLIENT REPORTS'); col = last + 1; }
  var val = req.enabled ? 'Yes' : 'No';
  sh.getRange(found.row, col).setValue(val);
  return {ok: true, row: found.row, summary: found.summary, clientReports: val};
}

function setDone_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var done = [];
  (req.phases || []).forEach(function (p) {
    p = String(p).trim();
    if (PHASE_VALUES.indexOf(p) >= 0 && done.indexOf(p) < 0) done.push(p);
  });
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  var col = -1;
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === 'PHASES DONE') { col = c + 1; break; }
  }
  if (col < 0) { sh.getRange(2, last + 1).setValue('PHASES DONE'); col = last + 1; }
  var prev = String(sh.getRange(found.row, col).getValue() || '');
  var val = done.join(', ');
  sh.getRange(found.row, col).setValue(val);
  return {ok: true, row: found.row, summary: found.summary,
          previous: prev, done: val};
}

/**
 * Generic team request (Touch Up / Priority Scheduling …) —
 * emails Brigham with the piano + notes and lands in the activity log.
 */
function teamRequest_(req, who) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  // serial optional: top-bar requests aren't tied to a piano
  var found = String(req.serial || '').trim()
    ? findPiano_(sh, req.serial, req.row)
    : {summary: String(req.pianoText || '').trim() || '(no specific piano)', location: '', row: 0};
  if (found.error) return found;
  var kind = String(req.kind || 'Team').slice(0, 40);
  var name = String(who || '').replace(/\s*<[^>]*>\s*/, '').replace(/\s*\(.*\)\s*$/, '');
  var logUrl = 'https://pianologapp.netlify.app/#piano=' + encodeURIComponent(req.serial);
  MailApp.sendEmail({
    to: PRICE_REQUEST_TO,
    subject: '📌 ' + kind + ' request: ' + (found.summary || 'piano') + ' — SN ' + req.serial,
    htmlBody: '<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px">'
      + '<h2 style="margin:0 0 8px">' + esc_(kind) + ' request from the Store Map</h2>'
      + '<p style="font-size:15px;margin:6px 0"><b>' + esc_(found.summary || 'Piano') + '</b><br>'
      + 'Serial ' + esc_(req.serial) + (found.location ? ' · Spot ' + esc_(found.location) : '') + '</p>'
      + (req.notes && String(req.notes).trim()
         ? '<p style="font-size:14px;white-space:pre-wrap;border-left:3px solid #9e2020;padding-left:10px">'
           + esc_(String(req.notes).trim()) + '</p>' : '')
      + '<p style="font-size:13px;color:#555">Requested by ' + esc_(name || 'the team') + '.</p>'
      + '<p style="font-size:13px"><a href="' + APP_URL + '" style="color:#9e2020">Store Map</a> · '
      + '<a href="' + logUrl + '" style="color:#9e2020">Piano Log</a></p></div>',
    body: kind + ' request: ' + (found.summary || 'piano') + ' SN ' + req.serial
      + (req.notes ? '\n\n' + String(req.notes).trim() : '') + '\n\nRequested by ' + (name || 'the team'),
    name: 'BLP Store Map',
  });
  return {ok: true, summary: found.summary, sentTo: PRICE_REQUEST_TO};
}

// "please set a price" email to Brigham, from the For Sale popup
function requestPrice_(req, who) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var name = String(who || '').replace(/\s*<[^>]*>\s*/, '').replace(/\s*\(.*\)\s*$/, '');
  var logUrl = 'https://pianologapp.netlify.app/#piano=' + encodeURIComponent(req.serial);
  MailApp.sendEmail({
    to: PRICE_REQUEST_TO,
    subject: '💲 Price needed: ' + (found.summary || 'piano') + ' — SN ' + req.serial,
    htmlBody: '<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px">'
      + '<h2 style="margin:0 0 8px">A piano was set to <span style="color:#2e7d4f">For Sale</span> and needs a price</h2>'
      + '<p style="font-size:15px;margin:6px 0"><b>' + esc_(found.summary || 'Piano') + '</b><br>'
      + 'Serial ' + esc_(req.serial) + (found.location ? ' · Spot ' + esc_(found.location) : '') + '</p>'
      + '<p style="font-size:13px;color:#555">Requested by ' + esc_(name || 'the team') + ' via the Store Map.</p>'
      + '<p style="font-size:14px">Set it from the piano’s card on the '
      + '<a href="' + APP_URL + '" style="color:#9e2020">Store Map</a> (Add price button) '
      + 'or in the <a href="' + logUrl + '" style="color:#9e2020">Piano Log</a> PRICE column.</p></div>',
    body: 'Price needed: ' + (found.summary || 'piano') + ' SN ' + req.serial
      + (found.location ? ' at spot ' + found.location : '')
      + '. Set it on ' + APP_URL + ' or in the Piano Log.',
    name: 'BLP Store Map',
  });
  return {ok: true, summary: found.summary, sentTo: PRICE_REQUEST_TO};
}

// printable price tag → PDF attachment → info@ ("please print and swap it")
function sendTagEmail_(found, serial, prev, price, who) {
  var name = String(who || '').replace(/\s*<[^>]*>\s*/, '').replace(/\s*\(.*\)\s*$/, '');
  var day = Utilities.formatDate(new Date(), 'America/Denver', 'MMMM d, yyyy');
  var tagHtml = '<html><body style="margin:0;padding:0">'
    + '<div style="width:5in;border:3px solid #0d0d0d;font-family:Georgia,serif;text-align:center">'
    + '<div style="background:#0d0d0d;color:#fff;padding:14px;letter-spacing:5px;font-size:20px">BRIGHAM LARSON PIANOS</div>'
    + '<div style="padding:26px 20px 8px;font-size:26px;font-weight:bold">' + esc_(found.summary || 'Piano') + '</div>'
    + '<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#555;letter-spacing:2px">SERIAL ' + esc_(serial) + '</div>'
    + '<div style="font-size:64px;font-weight:bold;color:#9e2020;padding:22px 0 6px">' + esc_(price) + '</div>'
    + '<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#888;padding-bottom:20px;letter-spacing:1px">'
    + esc_(day) + ' · brighamlarsonpianos.com</div></div></body></html>';
  var pdf = Utilities.newBlob(tagHtml, 'text/html', 'tag.html')
    .getAs('application/pdf').setName('Price Tag — SN ' + serial + '.pdf');
  var verb = prev ? 'updated' : 'added';
  MailApp.sendEmail({
    to: TAG_ALERT_TO,
    subject: '🏷 Price ' + verb + ': ' + (found.summary || 'piano') + ' — now ' + price,
    htmlBody: '<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px">'
      + '<h2 style="margin:0 0 8px">A sale price was ' + verb + '</h2>'
      + '<p style="font-size:15px;margin:6px 0"><b>' + esc_(found.summary || 'Piano') + '</b><br>'
      + 'Serial ' + esc_(serial) + (found.location ? ' · Spot ' + esc_(found.location) : '') + '<br>'
      + (prev ? esc_(prev) + ' → ' : '') + '<b style="color:#2e7d4f;font-size:17px">' + esc_(price) + '</b></p>'
      + '<p style="font-size:14px"><b>Please print the attached price tag and put it on the piano</b> '
      + '(or make a fancy one at <a href="https://blppricetags.netlify.app/?serial='
      + encodeURIComponent(serial) + '&price=' + encodeURIComponent(price.replace(/[^0-9]/g, ''))
      + '&model=' + encodeURIComponent(found.summary || '') + '" style="color:#9e2020">the Price Tag Maker</a>).</p>'
      + '<p style="font-size:12px;color:#777">Changed by ' + esc_(name || 'the team') + ' via the Store Map · ' + esc_(day) + '</p></div>',
    body: 'Price ' + verb + ' for ' + (found.summary || 'piano') + ' SN ' + serial + ': ' + price
      + '. Please print the attached tag and update the piano.',
    attachments: [pdf],
    name: 'BLP Store Map',
  });
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
