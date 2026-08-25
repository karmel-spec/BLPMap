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
  // Tech photo folder for one piano — the Store Map's Media section links here
  if (e && e.parameter && e.parameter.fn === 'techfolder') {
    try {
      var tsh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
      var tf = findPiano_(tsh, e.parameter.serial, e.parameter.row);
      if (tf.error) return json_({error: tf.error, url: ''});
      var fold = techFolderFor_(tsh, tf.row, String(e.parameter.serial || ''));
      return json_({url: fold ? fold.getUrl() : '', name: fold ? fold.getName() : ''});
    } catch (err) { return json_({error: String(err), url: ''}); }
  }
  // Work clock: all OPEN sessions + today's closed minutes per tech.
  // Feeds the card chip, the My Day dock and the Shop Board live tiles.
  if (e && e.parameter && e.parameter.fn === 'requests') {
    try { return json_(requestsList_()); }
    catch (err) { return json_({error: String(err), requests: []}); }
  }
  if (e && e.parameter && e.parameter.fn === 'history') {
    try { return json_(pianoHistory_(e.parameter.serial, e.parameter.row)); }
    catch (err) { return json_({error: String(err), loc: [], cab: []}); }
  }
  if (e && e.parameter && e.parameter.fn === 'briefs') {
    try { return json_(briefLog_()); }
    catch (err) { return json_({error: String(err), briefs: []}); }
  }
  if (e && e.parameter && e.parameter.fn === 'timeclock') {
    try { return json_(timeClockState_()); }
    catch (err) { return json_({error: String(err), open: []}); }
  }
  // Work clock history rows for the Job Costing report (?days=90)
  if (e && e.parameter && e.parameter.fn === 'timelog') {
    try { return json_(timeLogRows_(Number(e.parameter.days) || 90)); }
    catch (err) { return json_({error: String(err), rows: []}); }
  }
  // Shop Board roster overrides (Roster tab of the report sheet) — served
  // here because the Shop Reports Bridge deployment is owner-locked
  if (e && e.parameter && e.parameter.fn === 'shoproster') {
    try { return json_(shopRosterList_()); }
    catch (err) { return json_({error: String(err), roster: []}); }
  }
  // Rerunnable: link-share all archived brief docs (managers get access)
  if (e && e.parameter && e.parameter.fn === 'sharebriefs') {
    try { return json_(shareAllBriefs_()); }
    catch (err) { return json_({error: String(err)}); }
  }
  // Clock-fix requests (team asks admin/managers to adjust a punch)
  if (e && e.parameter && e.parameter.fn === 'clockfixes') {
    try { return json_(clockFixRows_()); }
    catch (err) { return json_({error: String(err), rows: []}); }
  }
  // Payroll day-clock: state for the dashboard button, rows for the report
  if (e && e.parameter && e.parameter.fn === 'payroll') {
    try { return json_(payrollState_()); }
    catch (err) { return json_({error: String(err), open: [], today: []}); }
  }
  if (e && e.parameter && e.parameter.fn === 'payrollrows') {
    try { return json_(payrollRows_(Number(e.parameter.days) || 95)); }
    catch (err) { return json_({error: String(err), rows: []}); }
  }
  // Paperwork scans (QC checklists etc.) for one piano — filed by year in
  // one Drive folder, named "Make Serial"; matched by serial substring
  if (e && e.parameter && e.parameter.fn === 'paperwork') {
    try { return json_(paperworkScan_(e.parameter.serial)); }
    catch (err) { return json_({error: String(err), files: []}); }
  }
  if (e && e.parameter && e.parameter.fn === 'proposal') {
    try { return json_(latestProposal_()); }
    catch (err) { return json_({error: String(err)}); }
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
    // the shop apps' shared password doubles as a team PIN here so the
    // Shop Manager's bridge calls (App Requests etc.) work for
    // password-gate users too — same team, same trust level
    var pinOk = req.pin === TEAM_PIN || String(req.pin || '').trim().toLowerCase() === 'pianoman';
    if (req.secret !== BRIDGE_SECRET && !pinOk && !gOk) {
      return json_({error: 'unauthorized'});
    }
    req._g = g || null;   // verified Google identity for permission-gated actions
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
      if (ph.ok && ph.autoCompleted) logAct_(who, 'Phases auto-completed',
        ph.summary || req.serial, 'For Sale — all shop phases marked done');
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
      var prEmail = String((req.user && req.user.email) || '').toLowerCase();
      if (PQ_ADMINS.indexOf(prEmail) < 0) {
        return json_({error: 'Only admins/owners can change sale prices (Google sign-in required).'});
      }
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
    if (req.action === 'markduplicate') {
      var mdp = markDuplicate_(req);
      if (mdp.ok) logAct_(who, 'Marked duplicate', mdp.summary || req.serial,
        'row ' + mdp.row + (req.realRef ? ' — real one: ' + req.realRef : '') +
        ' — reversible: remove "(DUPLICATE)" from Owner in the Piano Log');
      return json_(mdp);
    }
    if (req.action === 'unmarkduplicate') {
      var umd = unmarkDuplicate_(req);
      if (umd.ok) logAct_(who, 'Restored from duplicate', umd.summary || req.serial, 'row ' + umd.row);
      return json_(umd);
    }
    if (req.action === 'settype') {
      var sty = setTypeOverride_(req);
      if (sty.ok) logAct_(who, 'Icon type set', sty.summary || req.serial,
        (sty.previous || '(auto)') + ' → ' + (sty.type || '(auto)'));
      return json_(sty);
    }
    if (req.action === 'tagsnapshot') {
      var tsn = setTagSnapshot_(req);
      if (tsn.ok) logAct_(who, 'Shop tag printed', tsn.summary || req.serial, 'tag snapshot saved');
      return json_(tsn);
    }
    if (req.action === 'setkeys') {
      var sks = setKeyService_(req);
      if (sks.ok) logAct_(who, 'Key service', sks.summary || req.serial, sks.keys || '(cleared)');
      return json_(sks);
    }
    if (req.action === 'prequeueapprove') {
      var pqa = preQueueApprove_(req);
      if (pqa.ok) logAct_(who, 'Queue APPROVED (deposit in)', pqa.summary || req.serial, pqa.status);
      return json_(pqa);
    }
    if (req.action === 'briefdoc') {
      try { return json_(briefDocOnly_()); }
      catch (e2) { return json_({error: String(e2).slice(0, 300)}); }
    }
    if (req.action === 'sendbrief') {
      var sb = sendShopManagerReportTo_(SHOPMGR_TO);
      logAct_(who, 'Shop brief sent manually', 'briefing', sb.doc || '');
      return json_(sb);
    }
    if (req.action === 'suggest') {
      var sg = addRequest_(req);
      if (sg.ok) logAct_(who, 'App request', sg.id, String(req.type || '') + ': ' + String(req.text || '').slice(0, 90));
      return json_(sg);
    }
    if (req.action === 'requeststatus') {
      var rs = setRequestStatus_(req);
      if (rs.ok) logAct_(who, 'App request ' + rs.status, rs.id, rs.text);
      return json_(rs);
    }
    // per-tech dashboard: PRs, piano history, anniversary — from the Time Log
    if (req.action === 'techdash') {
      return json_(techDash_(String((req.user && req.user.name) || req.name || '')));
    }
    // compact standup digest for the 7:50AM text (Netlify holds Twilio)
    if (req.action === 'briefsms') {
      return json_(briefSms_());
    }
    // team phone list for the share sheet — POST-only so the numbers sit
    // behind the same PIN / Google auth as every other write
    if (req.action === 'phones') {
      return json_(teamPhones_());
    }
    if (req.action === 'clockin') {
      var cin = clockIn_(req);
      return json_(cin);
    }
    if (req.action === 'clockout') {
      var cout = clockOut_(req);
      return json_(cout);
    }
    if (req.action === 'dayin') {
      return json_(dayIn_(req));
    }
    if (req.action === 'dayout') {
      return json_(dayOut_(req));
    }
    if (req.action === 'adjustclock') {
      var adj = adjustClock_(req);
      if (adj.ok) logAct_(who, 'Clock adjusted', adj.piano || adj.tech || '',
        (req.clock === 'pay' ? 'payroll' : 'piano') + (req.add ? ' session added' : ' row ' + req.row) +
        ' → ' + String(req.start || '').slice(0, 16) + ' – ' + String(req.end || '').slice(0, 16));
      return json_(adj);
    }
    if (req.action === 'clockfix') {
      var cfx = clockFixRequest_(req, who);
      if (cfx.ok) logAct_(who, 'Clock fix requested', req.serial || '(day clock)', String(req.note || '').slice(0, 120));
      return json_(cfx);
    }
    if (req.action === 'resolveclockfix') {
      return json_(resolveClockFix_(req, who));
    }
    if (req.action === 'setpaperwork') {
      var spw = setPaperwork_(req);
      if (spw.ok) logAct_(who, 'Paperwork', spw.summary || req.serial,
        req.kind + (req.url ? ' attached' : ' removed'));
      return json_(spw);
    }
    if (req.action === 'saveproposal') {
      var svp = saveProposal_(req);
      if (svp.ok) logAct_(who, 'Schedule proposal saved', svp.week, 'awaiting review in Shop Manager');
      return json_(svp);
    }
    if (req.action === 'applyschedule') {
      var aps = applySchedule_(req);
      if (aps.ok) logAct_(who, 'Schedule APPLIED to tech calendars', aps.week,
        aps.results.map(function (r) { return r.tech + ':' + (r.events != null ? r.events : (r.skipped || r.error)); }).join(', '));
      return json_(aps);
    }
    if (req.action === 'setpayplan') {
      var spp = setPayPlan_(req);
      if (spp.ok) logAct_(who, 'Payment plan', spp.summary || req.serial, spp.plan || '(cleared)');
      return json_(spp);
    }
    if (req.action === 'setadminsteps') {
      var sas = setAdminSteps_(req);
      if (sas.ok) logAct_(who, 'Admin steps', sas.summary || req.serial, sas.steps || '(cleared)');
      return json_(sas);
    }
    if (req.action === 'paymilestone') {
      var pms = payMilestone_(req);
      if (pms.ok && !pms.skipped) logAct_(who, 'Payment milestone email', req.summary || req.serial,
        pms.milestone + '% — emailed ' + (pms.emailed || ''));
      return json_(pms);
    }
    if (req.action === 'shoprosterset') {
      var srs = shopRosterSet_(String(req.tech || ''), String(req.status || 'active'));
      if (srs.ok) logAct_(who, 'Roster ' + srs.status, srs.tech, 'Shop Board roster override');
      return json_(srs);
    }
    if (req.action === 'setcolor') {
      var scl = setColor_(req);
      if (scl.ok) logAct_(who, 'Color ' + (req.which === 'final' ? 'FINAL approved' : 'first pick'),
        scl.summary || req.serial, scl.value || '(cleared)');
      return json_(scl);
    }
    if (req.action === 'phasenote') {
      var pn = phaseNote_(req, who);
      if (pn.ok) logAct_(who, 'Phase note', pn.summary || req.serial,
        String(req.phase || '') + ': ' + String(req.note || '').slice(0, 120));
      return json_(pn);
    }
    if (req.action === 'setplatestatus') {
      var pls = setPlateStatus_(req);
      if (pls.ok) logAct_(who, 'Plate status', pls.summary || req.serial, pls.plateStatus || '(cleared)');
      return json_(pls);
    }
    if (req.action === 'setcabinetry') {
      var cb2 = setCabinetry_(req);
      if (cb2.ok) logAct_(who, 'Cabinetry location', cb2.summary || req.serial,
        cb2.cabinetry || '(cleared)');
      return json_(cb2);
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
      if (pt.saved) logAct_(who,
        req.kind === 'before' ? 'Before photo' : req.kind === 'after' ? 'After photo' : 'Progress photo',
        pt.summary || req.serial, (req.stage || '(no phase)') + ' → ' + pt.name);
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
  var kind = String(req.kind || 'tech').toLowerCase();   // tech | before | after
  var tech;
  if (kind === 'before' || kind === 'after') {
    tech = mediaFolderFor_(sh, found.row, serial, kind);
  } else {
    tech = techFolderFor_(sh, found.row, serial);
  }
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
/* Before/After photo folders: use the folder already linked in the media
 * cell (col 14 = before, col 16 = after) if there is one; otherwise create
 * a "Before Photos"/"After Photos" subfolder beside Tech and write its link
 * back into the cell — which also flips the card's media state to done. */
function mediaFolderFor_(sh, row, serial, kind) {
  var col = kind === 'before' ? 14 : 16;   // 1-based: N=14, P=16
  var cell = String(sh.getRange(row, col).getValue() || '');
  var m = /folders\/([A-Za-z0-9_-]+)/.exec(cell);
  if (m) { try { return DriveApp.getFolderById(m[1]); } catch (e) {} }
  var tech = techFolderFor_(sh, row, serial);
  if (!tech) return null;
  var parentIt = tech.getParents();
  var parent = parentIt.hasNext() ? parentIt.next() : tech;
  var name = kind === 'before' ? 'Before Photos' : 'After Photos';
  var it = parent.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : parent.createFolder(name);
  try { sh.getRange(row, col).setValue(folder.getUrl()); } catch (e) {}
  return folder;
}
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
  'Waiting on Brigham', 'Waiting on Curtis Harper', 'Waiting on Customer', 'Waiting on OTHER'];

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
                    'Technology', 'Old Player', 'Storage', 'Misc'];

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
  // A piano reaching For Sale has finished the shop, so every work phase is
  // complete by definition — tick them all so the Done row and the shop
  // progress bar agree with reality instead of needing 13 manual taps.
  // Only ever ADDS marks (nothing is un-ticked), and it runs here rather
  // than in the app so the Shop app and any other caller get it too.
  var autoDone = null;
  if (phase === 'For Sale' && prev !== 'For Sale') {
    try {
      var dcol = pianoCol_(sh, 'PHASES DONE');
      var had = String(sh.getRange(found.row, dcol).getValue() || '')
        .split(',').map(function (t) { return t.trim(); }).filter(String);
      var work = PHASE_VALUES.slice(0, 13);        // New Arrival .. Exit Prep
      var missing = work.filter(function (ph) { return had.indexOf(ph) < 0; });
      if (missing.length) {                        // already all ticked? leave it
        autoDone = work.join(', ');                // canonical sheet order
        sh.getRange(found.row, dcol).setValue(autoDone);
      }
    } catch (e) { /* automation is a convenience — never fail the phase write */ }
  }
  return {ok: true, row: movedTo || found.row, summary: found.summary,
          previous: prev, phase: phase, note: note, checkBack: cb,
          movedToSold: !!movedTo, done: autoDone, autoCompleted: !!autoDone};
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
  // the sheet's real price column is "TAG / INVOICE PRICE" (col BJ) —
  // the bare "PRICE" column was a duplicate the bridge once created
  var col = -1, fallback = -1;
  for (var c = 0; c < hdr.length; c++) {
    var h = String(hdr[c] || '').trim().toUpperCase();
    if (h === 'TAG / INVOICE PRICE') { col = c + 1; break; }
    if (h === 'PRICE' && fallback < 0) fallback = c + 1;
  }
  if (col < 0) col = fallback;
  if (col < 0) return {error: 'no TAG / INVOICE PRICE column found in the Piano Log'};
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

/* which Cabinetry Storage shelves hold this piano's stripped parts —
   comma-separated tokens like "7-L3, 8-5" in a CABINETRY column */
/* Accidental duplicate cleanup (non-destructive): prefixes the OWNER cell
 * (col B) with "(DUPLICATE)" so the data parsers' existing exclusion rule
 * (same one that already drops "NEVER RECEIVED" rows) removes this row
 * from the map/reports on the next fetch. The row and its full history
 * stay in the sheet — reversible by editing that one cell.
 * req: {serial, row, realRef?} */
function markDuplicate_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var ownerCell = sh.getRange(found.row, 2);
  var owner = String(ownerCell.getValue() || '');
  if (owner.toLowerCase().indexOf('duplicate') < 0) {
    ownerCell.setValue('(DUPLICATE) ' + owner);
  }
  return {ok: true, row: found.row, summary: found.summary};
}

/* Undo markDuplicate_: strips the "(DUPLICATE)" prefix back off, putting
 * the row back on the map/reports on the next fetch. req: {serial, row} */
function unmarkDuplicate_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var ownerCell = sh.getRange(found.row, 2);
  var owner = String(ownerCell.getValue() || '');
  ownerCell.setValue(owner.replace(/^\(DUPLICATE\)\s*/i, ''));
  return {ok: true, row: found.row, summary: found.summary};
}

/* Manual override for which map icon a piano gets (grand/upright/digital)
 * — for the rare case CATEGORY + summary text both mislead pianoType()'s
 * auto-detection. req: {serial, row, type: 'grand'|'upright'|'digital'|''}
 * (blank clears the override, reverting to auto-detection). */
function setTypeOverride_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  var col = -1;
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === 'TYPE OVERRIDE') { col = c + 1; break; }
  }
  var val = String(req.type || '').trim().toLowerCase();
  if (val && ['grand', 'upright', 'digital'].indexOf(val) < 0) return {error: 'type must be grand, upright, or digital'};
  if (col < 0) { if (!val) return {ok: true, row: found.row, summary: found.summary, type: ''};
    sh.getRange(2, last + 1).setValue('TYPE OVERRIDE'); col = last + 1; }
  var prev = String(sh.getRange(found.row, col).getValue() || '');
  sh.getRange(found.row, col).setValue(val);
  return {ok: true, row: found.row, summary: found.summary, previous: prev, type: val};
}

// helper: find-or-create a named column on the Piano Log header row (row 2)
function pianoCol_(sh, name) {
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === name) return c + 1;
  }
  sh.getRange(2, last + 1).setValue(name);
  return last + 1;
}

function setTagSnapshot_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var col = pianoCol_(sh, 'TAG SNAPSHOT');
  var val = String(req.snapshot == null ? '' : req.snapshot).slice(0, 8000);
  sh.getRange(found.row, col).setValue(val);
  return {ok: true, row: found.row, summary: found.summary};
}

function setKeyService_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var col = pianoCol_(sh, 'KEY SERVICE');
  var ok = ['ivory', 'plastic', 'ebony'];
  var keep = String(req.keys == null ? '' : req.keys).split(',')
    .map(function (t) { return t.trim(); })
    .filter(function (t) { return ok.indexOf(t.toLowerCase()) >= 0; });
  var val = keep.join(', ');
  sh.getRange(found.row, col).setValue(val);
  return {ok: true, row: found.row, summary: found.summary, keys: val};
}

/* ===================== WORK CLOCK (per-piano time tracking) =====================
 * One "Time Log" tab on the report sheet is the ledger every punch surface
 * writes to (card button, QR scan, dock, manager corrections). THE rule:
 * a tech has at most ONE open session — clockin always closes the previous
 * open row first and reports what it closed. clockout accepts an optional
 * backdated endAt (the dock's "clock out at last activity" nudge). */
var TIME_LOG_TAB = 'Time Log';
function timeLogSheet_() {
  var ss = SpreadsheetApp.openById('11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I');
  var sh = ss.getSheetByName(TIME_LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(TIME_LOG_TAB, ss.getSheets().length);
    sh.getRange(1, 1, 1, 9).setValues([['Tech', 'Serial', 'Piano', 'Phase',
      'Clock In', 'Clock Out', 'Minutes', 'Source', 'Closed By']]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function clockTech_(req) {
  var n = String((req.user && req.user.name) || '').replace(/\s*\(.*$/, '').trim();
  return n;
}
function openSessionRow_(sh, tech) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var from = Math.max(2, last - 400);   // open rows are always near the bottom
  var vals = sh.getRange(from, 1, last - from + 1, 6).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]).toLowerCase() === tech.toLowerCase() && !vals[i][5]) {
      return {row: from + i, v: vals[i]};
    }
  }
  return null;
}
function closeSession_(sh, open, closedBy, endAt) {
  var end = endAt ? new Date(endAt) : new Date();
  var start = new Date(open.v[4]);
  if (!(end > start)) end = new Date();
  var mins = Math.max(1, Math.round((end - start) / 60000));
  sh.getRange(open.row, 6, 1, 2).setValues([[end.toISOString(), mins]]);
  if (closedBy) sh.getRange(open.row, 9).setValue(String(closedBy));
  return {serial: String(open.v[1]), piano: String(open.v[2]), phase: String(open.v[3]),
          start: String(open.v[4]), minutes: mins};
}
function withClockLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function clockIn_(req) { return withClockLock_(function () { return clockInLocked_(req); }); }
function clockInLocked_(req) {
  var tech = clockTech_(req);
  if (!tech) return {error: 'no name on this session — sign in first'};
  if (!req.serial) return {error: 'serial required'};
  var sh = timeLogSheet_();
  var closed = null;
  var open;
  while ((open = openSessionRow_(sh, tech))) {   // a double-click can leave several
    closed = closeSession_(sh, open, 'switch');
    if (closed.minutes <= 1 && closed.serial === String(req.serial)) {
      // same piano within a minute = the same click twice — reuse, don't restack
      sh.getRange(open.row, 6, 1, 2).setValues([['', '']]);
      return {ok: true, closed: null,
              open: {tech: tech, serial: closed.serial, phase: closed.phase, start: closed.start}};
    }
  }
  var psh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var f = findPiano_(psh, req.serial, req.row);
  var startIso = new Date().toISOString();
  sh.appendRow([tech, String(req.serial), (f && f.summary) || '', String(req.phase || ''),
                startIso, '', '', String(req.source || 'card'), '']);
  return {ok: true, closed: closed,
          open: {tech: tech, serial: String(req.serial), phase: String(req.phase || ''), start: startIso}};
}
function clockOut_(req) { return withClockLock_(function () { return clockOutLocked_(req); }); }
function clockOutLocked_(req) {
  var tech = clockTech_(req);
  if (!tech) return {error: 'no name on this session — sign in first'};
  var sh = timeLogSheet_();
  var open = openSessionRow_(sh, tech);
  if (!open) return {ok: true, closed: null, note: 'nothing was open'};
  var out = closeSession_(sh, open, String(req.reason || ''), req.endAt);
  var extra;   // close any race-created leftovers too
  while ((extra = openSessionRow_(sh, tech))) closeSession_(sh, extra, 'duplicate punch (auto)');
  return {ok: true, closed: out};
}
/* Forgotten sessions: anything still open from a PREVIOUS day gets closed
 * automatically — at 6 PM Denver on its start day (or +1h if it began after
 * 6 PM), capped at 10 hours. Runs opportunistically, at most every 10 min. */
function sweepForgottenClocks_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('clocksweep')) return 0;
  cache.put('clocksweep', '1', 600);
  var sh = timeLogSheet_();
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var from = Math.max(2, last - 400);
  var vals = sh.getRange(from, 1, last - from + 1, 6).getValues();
  var todayStr = Utilities.formatDate(new Date(), 'America/Denver', 'yyyy-MM-dd');
  var n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (!vals[i][0] || vals[i][5] || !vals[i][4]) continue;
    var start = new Date(vals[i][4]);
    if (Utilities.formatDate(start, 'America/Denver', 'yyyy-MM-dd') === todayStr) continue;
    var six = new Date(Utilities.formatDate(start, 'America/Denver', "yyyy-MM-dd'T'18:00:00XXX"));
    var end = six > start ? six : new Date(start.getTime() + 3600000);
    if (end - start > 36000000) end = new Date(start.getTime() + 36000000);
    closeSession_(sh, {row: from + i, v: vals[i]}, 'auto: forgot to clock out', end.toISOString());
    n++;
  }
  return n;
}
/* Every place a piano has lived, straight from the ACTIVITY LOG (moves,
 * attic bumps, SOLD relocation) plus its cabinetry-shelf changes. */
function pianoHistory_(serial, rowOverride) {
  serial = String(serial || '').trim();
  var psh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var f = findPiano_(psh, serial, rowOverride);
  var summary = (f && f.summary) || '';
  var sh = SpreadsheetApp.openById(PIANO_LOG_ID).getSheetByName('ACTIVITY LOG');
  var loc = [], cab = [];
  if (sh && sh.getLastRow() >= 2) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
    var LOC = {'Moved': 1, 'Bumped to attic': 1, 'Moved to SOLD section': 1};
    for (var i = vals.length - 1; i >= 0 && (loc.length < 40 || cab.length < 40); i--) {
      var v = vals[i];
      var pianoCell = String(v[3] || '');
      var hit = (summary && pianoCell === summary) || pianoCell === serial
        || (serial && String(v[4] || '').indexOf(serial) >= 0 && pianoCell.indexOf(serial) >= 0);
      if (!hit && serial && pianoCell.indexOf(serial) >= 0) hit = true;
      if (!hit) continue;
      var row = {when: (v[0] instanceof Date)
          ? Utilities.formatDate(v[0], 'America/Denver', 'MMM d, yyyy h:mm a') : String(v[0]),
        who: String(v[1] || ''), detail: String(v[4] || '').slice(0, 160)};
      if (LOC[String(v[2])] && loc.length < 40) loc.push(row);
      else if (String(v[2]) === 'Cabinetry location' && cab.length < 40) cab.push(row);
    }
  }
  return {ok: true, loc: loc, cab: cab};
}
function timeClockState_() {
  try { sweepForgottenClocks_(); } catch (e) {}
  var sh = timeLogSheet_();
  var last = sh.getLastRow();
  var openList = [], today = {};
  if (last >= 2) {
    var from = Math.max(2, last - 600);
    var vals = sh.getRange(from, 1, last - from + 1, 8).getValues();
    var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      if (!v[0]) continue;
      var tech = String(v[0]);
      if (!v[5]) {
        openList.push({tech: tech, serial: String(v[1]), piano: String(v[2]),
                       phase: String(v[3]), start: String(v[4]), source: String(v[7])});
      } else if (new Date(v[5]) >= midnight) {
        today[tech] = (today[tech] || 0) + (Number(v[6]) || 0);
      }
    }
    // open sessions count toward today too
    for (var j = 0; j < openList.length; j++) {
      var o = openList[j];
      var mins = Math.max(0, Math.round((Date.now() - new Date(o.start)) / 60000));
      today[o.tech] = (today[o.tech] || 0) + mins;
    }
  }
  return {ok: true, open: openList, todayMinutes: today, at: new Date().toISOString()};
}
function timeLogRows_(days) {
  var sh = timeLogSheet_();
  var last = sh.getLastRow();
  var out = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, 8).getValues();
    var cutoff = Date.now() - Math.min(days, 730) * 86400000;
    for (var i = 0; i < vals.length && out.length < 8000; i++) {
      var v = vals[i];
      if (!v[0] || !v[4]) continue;
      if (new Date(v[4]).getTime() < cutoff) continue;
      out.push({row: i + 2, tech: String(v[0]), serial: String(v[1]), piano: String(v[2]),
                phase: String(v[3]), start: String(v[4]), end: String(v[5] || ''),
                minutes: Number(v[6]) || 0, source: String(v[7] || '')});
    }
  }
  return {ok: true, rows: out, days: days};
}

/* ===================== PAYROLL CLOCK (day in / day out) =====================
 * Separate from the per-piano Work Clock: one "Payroll Clock" tab records a
 * tech's whole paid day — clock in on arrival, clock out at end of day.
 * One open day row per tech; a punch left open from a previous day is
 * auto-closed at 6 PM Denver of its start day (12 h cap) with a note so
 * admin reviews it before payroll. */
var PAYROLL_TAB = 'Payroll Clock';
function payrollSheet_() {
  var ss = SpreadsheetApp.openById('11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I');
  var sh = ss.getSheetByName(PAYROLL_TAB);
  if (!sh) {
    sh = ss.insertSheet(PAYROLL_TAB, ss.getSheets().length);
    sh.getRange(1, 1, 1, 7).setValues([['Tech', 'Date', 'Clock In', 'Clock Out', 'Minutes', 'Source', 'Note']]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function openPayRow_(sh, tech) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var from = Math.max(2, last - 200);
  var vals = sh.getRange(from, 1, last - from + 1, 4).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]).toLowerCase() === tech.toLowerCase() && vals[i][2] && !vals[i][3]) {
      return {row: from + i, v: vals[i]};
    }
  }
  return null;
}
function closePayRow_(sh, open, endAt, note) {
  var end = endAt ? new Date(endAt) : new Date();
  var start = new Date(open.v[2]);
  if (!(end > start)) end = new Date();
  var mins = Math.max(1, Math.round((end - start) / 60000));
  sh.getRange(open.row, 4, 1, 2).setValues([[end.toISOString(), mins]]);
  if (note) sh.getRange(open.row, 7).setValue(String(note));
  return {tech: String(open.v[0]), date: String(open.v[1]), start: String(open.v[2]),
          end: end.toISOString(), minutes: mins};
}
function sweepForgottenPay_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var from = Math.max(2, last - 200);
  var vals = sh.getRange(from, 1, last - from + 1, 4).getValues();
  var todayStr = Utilities.formatDate(new Date(), 'America/Denver', 'yyyy-MM-dd');
  for (var i = 0; i < vals.length; i++) {
    if (!vals[i][0] || !vals[i][2] || vals[i][3]) continue;
    var start = new Date(vals[i][2]);
    if (Utilities.formatDate(start, 'America/Denver', 'yyyy-MM-dd') === todayStr) continue;
    var six = new Date(Utilities.formatDate(start, 'America/Denver', "yyyy-MM-dd'T'18:00:00XXX"));
    var end = six > start ? six : new Date(start.getTime() + 3600000);
    if (end - start > 43200000) end = new Date(start.getTime() + 43200000);
    closePayRow_(sh, {row: from + i, v: vals[i]}, end.toISOString(),
                 'auto: forgot to clock out — review before payroll');
  }
}
/* Geofence for payroll punches: the app sends the phone's location with
 * each punch. DAY clock-ins/outs from a confident GPS fix outside the fence
 * are BLOCKED (Brigham 8/26) — the app offers a manager time-adjustment
 * request instead. No fix / denied / desktop → allowed but flagged, so the
 * shop computers keep working. Piano punches stay soft (flag only). */
var STORE_LAT = 40.269752, STORE_LNG = -111.682881;   // 1497 S State St, Orem
var FENCE_METERS = 300;
function geoAwayMiles_(req) {
  var g = req.geo;
  if (!g || typeof g === 'string') return 0;    // no GPS fix → allow
  var lat = Number(g.lat), lng = Number(g.lng);
  if (!isFinite(lat) || !isFinite(lng)) return 0;
  var R = 6371000, toR = Math.PI / 180;
  var dLat = (lat - STORE_LAT) * toR, dLng = (lng - STORE_LNG) * toR;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(STORE_LAT * toR) * Math.cos(lat * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var m = 2 * R * Math.asin(Math.sqrt(a));
  return m > FENCE_METERS + (Number(g.acc) || 0) ? m / 1609.34 : 0;
}
function geoNote_(req, dir) {
  var g = req.geo;
  if (!g) return '';
  if (typeof g === 'string') return '📍 ' + dir + ': location off';
  var lat = Number(g.lat), lng = Number(g.lng);
  if (!isFinite(lat) || !isFinite(lng)) return '📍 ' + dir + ': location off';
  var R = 6371000, toR = Math.PI / 180;
  var dLat = (lat - STORE_LAT) * toR, dLng = (lng - STORE_LNG) * toR;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(STORE_LAT * toR) * Math.cos(lat * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var m = 2 * R * Math.asin(Math.sqrt(a));
  if (m <= FENCE_METERS + (Number(g.acc) || 0)) return '';
  return '📍 ' + dir + ': ' + (m / 1609.34).toFixed(1) + ' mi from store';
}
function dayIn_(req) {
  return withClockLock_(function () {
    var tech = clockTech_(req);
    if (!tech) return {error: 'no name on this session — sign in first'};
    var sh = payrollSheet_();
    sweepForgottenPay_(sh);
    var open = openPayRow_(sh, tech);
    if (open) return {ok: true, already: true,
                      open: {tech: tech, start: String(open.v[2])}};
    var awayIn = geoAwayMiles_(req);
    if (awayIn) return {error: 'geofence', awayMiles: Math.round(awayIn * 10) / 10};
    var now = new Date();
    var startIso = now.toISOString();
    sh.appendRow([tech, Utilities.formatDate(now, 'America/Denver', 'yyyy-MM-dd'),
                  startIso, '', '', String(req.source || 'dash'), geoNote_(req, 'in')]);
    return {ok: true, open: {tech: tech, start: startIso}};
  });
}
function dayOut_(req) {
  return withClockLock_(function () {
    var tech = clockTech_(req);
    if (!tech) return {error: 'no name on this session — sign in first'};
    var sh = payrollSheet_();
    var open = openPayRow_(sh, tech);
    if (!open) return {ok: true, closed: null, note: 'no open day'};
    var awayOut = geoAwayMiles_(req);
    if (awayOut) return {error: 'geofence', awayMiles: Math.round(awayOut * 10) / 10};
    var gn = geoNote_(req, 'out');
    var oldNote = String(sh.getRange(open.row, 7).getValue() || '');
    var out = closePayRow_(sh, open, req.endAt,
      gn ? (oldNote ? oldNote + ' · ' : '') + gn : '');
    var extra;   // double-punch leftovers
    while ((extra = openPayRow_(sh, tech))) closePayRow_(sh, extra, null, 'duplicate punch (auto)');
    return {ok: true, closed: out};
  });
}
function payrollState_() {
  var sh = payrollSheet_();
  sweepForgottenPay_(sh);
  var last = sh.getLastRow();
  var open = [], today = [];
  var todayStr = Utilities.formatDate(new Date(), 'America/Denver', 'yyyy-MM-dd');
  if (last >= 2) {
    var from = Math.max(2, last - 200);
    var vals = sh.getRange(from, 1, last - from + 1, 5).getValues();
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      if (!v[0] || !v[2]) continue;
      if (v[2] && !v[3]) open.push({tech: String(v[0]), start: String(v[2])});
      if (String(v[1]) === todayStr || (v[1] instanceof Date &&
          Utilities.formatDate(v[1], 'America/Denver', 'yyyy-MM-dd') === todayStr)) {
        today.push({tech: String(v[0]), start: String(v[2]),
                    end: String(v[3] || ''), minutes: Number(v[4]) || 0});
      }
    }
  }
  return {ok: true, open: open, today: today};
}
function payrollRows_(days) {
  var sh = payrollSheet_();
  var last = sh.getLastRow();
  var out = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, 7).getValues();
    var cutoff = Date.now() - Math.min(days, 730) * 86400000;
    for (var i = 0; i < vals.length && out.length < 8000; i++) {
      var v = vals[i];
      if (!v[0] || !v[2]) continue;
      if (new Date(v[2]).getTime() < cutoff) continue;
      var d = (v[1] instanceof Date)
        ? Utilities.formatDate(v[1], 'America/Denver', 'yyyy-MM-dd') : String(v[1]);
      out.push({row: i + 2, tech: String(v[0]), date: d, start: String(v[2]), end: String(v[3] || ''),
                minutes: Number(v[4]) || 0, source: String(v[5] || ''), note: String(v[6] || '')});
    }
  }
  return {ok: true, rows: out, days: days};
}

/* ============== CLOCK PERMISSIONS + ADJUSTMENTS + FIX REQUESTS ==============
 * Job-costing (piano Time Log) edits: owners + managers Mark/Matthew/Jacob.
 * Payroll punch edits: owners + Melissa. Permission = VERIFIED Google email
 * (req._g from doPost) — the PIN alone never grants these.
 * Jacob's sign-in email isn't on file yet: until it's added to
 * TIMELOG_ADMIN_EMAILS, any BLP-verified Google account whose first name is
 * Jacob qualifies (token-verified name, BLP domain only). */
var OWNER_EMAILS = ['brigham@brighamlarsonpianos.com', 'karmel@brighamlarsonpianos.com'];
var PAYROLL_ADMIN_EMAILS = OWNER_EMAILS.concat(['melissa@brighamlarsonpianos.com']);
var TIMELOG_ADMIN_EMAILS = OWNER_EMAILS.concat(
  ['markhales.blp@gmail.com', 'matthewwessman.blp@gmail.com', 'jacobmower.blp@gmail.com']);
function blpAccount_(g) {
  return g && g.email && (/@brighamlarsonpianos\.com$/i.test(g.email) || /\.blp@gmail\.com$/i.test(g.email));
}
function payrollAdmin_(g) {
  return !!(g && g.email && PAYROLL_ADMIN_EMAILS.indexOf(g.email.toLowerCase()) >= 0);
}
function timelogAdmin_(g) {
  if (g && g.email && TIMELOG_ADMIN_EMAILS.indexOf(g.email.toLowerCase()) >= 0) return true;
  return !!(blpAccount_(g) && /^jacob\b/i.test(String(g.name || '')));   // Jacob fallback (see note)
}
/* Edit an existing punch's start/end (row = sheet row from the rows
 * endpoints) or, with add:true, append a missed session outright. */
function adjustClock_(req) {
  return withClockLock_(function () {
    var g = req._g;
    var isPay = req.clock === 'pay';
    if (isPay ? !payrollAdmin_(g) : !timelogAdmin_(g)) {
      return {error: isPay
        ? 'Only owners and Melissa can adjust payroll punches (Google sign-in required).'
        : 'Only owners and the shop managers can adjust piano clock times (Google sign-in required).'};
    }
    var start = new Date(req.start), end = req.end ? new Date(req.end) : null;
    if (isNaN(start)) return {error: 'bad start time'};
    if (end && !(end > start)) return {error: 'end must be after start'};
    var mins = end ? Math.max(1, Math.round((end - start) / 60000)) : '';
    var stamp = 'adjusted by ' + ((g.name || g.email)) + ' ' +
      Utilities.formatDate(new Date(), 'America/Denver', 'M/d h:mm a');
    if (isPay) {
      var sh = payrollSheet_();
      if (req.add) {
        if (!req.tech) return {error: 'tech required'};
        sh.appendRow([String(req.tech),
          Utilities.formatDate(start, 'America/Denver', 'yyyy-MM-dd'),
          start.toISOString(), end ? end.toISOString() : '', mins, 'adjust', 'added: ' + stamp.slice(9)]);
        return {ok: true, tech: String(req.tech)};
      }
      var row = Number(req.row);
      if (!(row >= 2) || row > sh.getLastRow()) return {error: 'bad row'};
      sh.getRange(row, 2).setValue(Utilities.formatDate(start, 'America/Denver', 'yyyy-MM-dd'));
      sh.getRange(row, 3, 1, 3).setValues([[start.toISOString(), end ? end.toISOString() : '', mins]]);
      var oldNote = String(sh.getRange(row, 7).getValue() || '');
      sh.getRange(row, 7).setValue((oldNote ? oldNote + ' · ' : '') + stamp);
      return {ok: true, tech: String(sh.getRange(row, 1).getValue())};
    }
    var tsh = timeLogSheet_();
    if (req.add) {
      if (!req.tech || !req.serial) return {error: 'tech and piano serial required'};
      var psh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
      var f = findPiano_(psh, req.serial, null);
      tsh.appendRow([String(req.tech), String(req.serial), (f && f.summary) || '',
        String(req.phase || ''), start.toISOString(), end ? end.toISOString() : '', mins,
        'adjust', 'added: ' + stamp.slice(9)]);
      return {ok: true, tech: String(req.tech), piano: (f && f.summary) || String(req.serial)};
    }
    var trow = Number(req.row);
    if (!(trow >= 2) || trow > tsh.getLastRow()) return {error: 'bad row'};
    tsh.getRange(trow, 5, 1, 3).setValues([[start.toISOString(), end ? end.toISOString() : '', mins]]);
    var oldBy = String(tsh.getRange(trow, 9).getValue() || '');
    tsh.getRange(trow, 9).setValue((oldBy ? oldBy + ' · ' : '') + stamp);
    return {ok: true, tech: String(tsh.getRange(trow, 1).getValue()),
            piano: String(tsh.getRange(trow, 3).getValue())};
  });
}
/* Team-member "please fix my clock" requests — one tab, worked from the
 * 🛠 Time Clock Adjustments report. Any signed-in team member may file. */
var CLOCK_FIX_TAB = 'Clock Fix Requests';
function clockFixSheet_() {
  var ss = SpreadsheetApp.openById('11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I');
  var sh = ss.getSheetByName(CLOCK_FIX_TAB);
  if (!sh) {
    sh = ss.insertSheet(CLOCK_FIX_TAB, ss.getSheets().length);
    sh.getRange(1, 1, 1, 6).setValues([['When', 'Who', 'Clock', 'Piano serial', 'What needs fixing', 'Status']]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function clockFixRequest_(req, who) {
  var note = String(req.note || '').trim();
  if (!note) return {error: 'say what needs fixing (date + correct times helps)'};
  var sh = clockFixSheet_();
  sh.appendRow([new Date(), String(who || ''), req.clock === 'pay' ? 'Day clock' : 'Piano clock',
                String(req.serial || ''), note.slice(0, 400), 'open']);
  return {ok: true};
}
function resolveClockFix_(req, who) {
  var g = req._g;
  if (!payrollAdmin_(g) && !timelogAdmin_(g)) {
    return {error: 'Only owners, Melissa, or the shop managers can resolve fix requests.'};
  }
  var sh = clockFixSheet_();
  var row = Number(req.row);
  if (!(row >= 2) || row > sh.getLastRow()) return {error: 'bad row'};
  sh.getRange(row, 6).setValue('resolved by ' + ((g.name || g.email)) + ' ' +
    Utilities.formatDate(new Date(), 'America/Denver', 'M/d'));
  return {ok: true};
}
function clockFixRows_() {
  var sh = clockFixSheet_();
  var last = sh.getLastRow();
  var out = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, 6).getValues();
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      if (!v[0]) continue;
      out.push({row: i + 2,
        when: (v[0] instanceof Date) ? Utilities.formatDate(v[0], 'America/Denver', 'MMM d, h:mm a') : String(v[0]),
        who: String(v[1] || ''), clock: String(v[2] || ''), serial: String(v[3] || ''),
        note: String(v[4] || ''), status: String(v[5] || 'open')});
    }
  }
  out.reverse();
  return {ok: true, rows: out.slice(0, 200)};
}

/* ===================== SUGGESTION BOX (app requests) =====================
 * Team-sourced bugs/edits/ideas for the web apps. One "Requests" tab on the
 * report sheet; screenshots land in a "BLP App Requests" Drive folder.
 * Status flow: Requested -> In progress -> Live -> Tested. The requester
 * confirms "Tested" themselves from the map's My Requests list. */
// Pre-Queue approval is manager-only, enforced HERE (not just in the UI)
var PQ_ADMINS = ['markhales.blp@gmail.com',   // Mark — lead manager, full permissions
  'melissa@brighamlarsonpianos.com', 'brigham@brighamlarsonpianos.com',
  'karmel@brighamlarsonpianos.com', 'alisa@brighamlarsonpianos.com',
  'susie@brighamlarsonpianos.com', 'walter@brighamlarsonpianos.com'];
function preQueueApprove_(req) {
  var email = String((req.user && req.user.email) || '').toLowerCase();
  if (PQ_ADMINS.indexOf(email) < 0) {
    return {error: 'Only admins/managers can approve a piano into the queue (Google sign-in required).'};
  }
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var COL_S = 19;
  var cur = String(sh.getRange(found.row, COL_S).getValue() || '');
  if (!/pre[\s-]?queue/i.test(cur)) return {ok: true, row: found.row, summary: found.summary, status: cur};
  var next = cur.replace(/,?\s*pre[\s-]?queue/i, '').replace(/^\s*,\s*/, '').trim();
  next = (next ? next + ', ' : '') + 'Queue Approved '
    + Utilities.formatDate(new Date(), 'America/Denver', 'M/d/yy');
  sh.getRange(found.row, COL_S).setValue(next);
  return {ok: true, row: found.row, summary: found.summary, status: next};
}

var REQUESTS_TAB = 'Requests';
function requestsSheet_() {
  var ss = SpreadsheetApp.openById('11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I');
  var sh = ss.getSheetByName(REQUESTS_TAB);
  if (!sh) {
    sh = ss.insertSheet(REQUESTS_TAB, ss.getSheets().length);
    sh.getRange(1, 1, 1, 10).setValues([['ID', 'Date', 'Who', 'Type', 'Request',
      'Context', 'Screenshot', 'Status', 'Status By', 'Status At']]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function addRequest_(req) {
  var sh = requestsSheet_();
  var who = clockTech_(req) || 'Unknown';
  // friendly id: MMDDYY + last name + that person's running request count
  // e.g. 081926wessman01, then 082026wessman02 on their next one
  var lastName = String(who).trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, '') || 'team';
  var n = 0;
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var whos = sh.getRange(2, 3, lastRow - 1, 1).getValues();
    for (var w = 0; w < whos.length; w++) {
      if (String(whos[w][0]).trim().toLowerCase() === String(who).trim().toLowerCase()) n++;
    }
  }
  var id = Utilities.formatDate(new Date(), 'America/Denver', 'MMddyy')
    + lastName + ('0' + (n + 1)).slice(-2);
  // preferred path (8/25): the client pre-uploads via the sales-app service
  // account (request-shot) — this web app's own token has NO Drive scope in
  // the anonymous deployment, so the REST upload below always failed silently
  var shot = /^https:\/\/(drive\.google\.com|blpsalesapp\.netlify\.app)\//.test(String(req.screenshotUrl || ''))
    ? String(req.screenshotUrl) : '';
  if (!shot && req.photo) {
    // Drive REST, not DriveApp — DriveApp throws in the anonymous web-app
    // context, which silently ate every screenshot the team attached
    try {
      var folderId = driveFolderIdByName_('BLP App Requests');
      var meta = {name: id + '-' + (req.photoName || 'screenshot.jpg'), parents: [folderId]};
      var boundary = 'blpshot' + id;
      var payload = Utilities.newBlob(
        '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'
        + JSON.stringify(meta)
        + '\r\n--' + boundary + '\r\nContent-Type: ' + (req.photoType || 'image/jpeg')
        + '\r\nContent-Transfer-Encoding: base64\r\n\r\n'
        + req.photo + '\r\n--' + boundary + '--').getBytes();
      var res = UrlFetchApp.fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
          method: 'post',
          contentType: 'multipart/related; boundary=' + boundary,
          payload: payload,
          headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
        });
      var f = JSON.parse(res.getContentText());
      if (f.id) { shareAnyoneWithLink_(f.id); shot = f.webViewLink || ('https://drive.google.com/file/d/' + f.id + '/view'); }
    } catch (e) { shot = ''; }
  }
  sh.appendRow([id, new Date().toISOString(), who, String(req.type || 'idea'),
    String(req.text || '').slice(0, 2000), String(req.context || '').slice(0, 300),
    shot, 'Requested', '', '']);
  return {ok: true, id: id, screenshot: shot};
}
function setRequestStatus_(req) {
  var STATUSES = ['Requested', 'In progress', 'Live', 'Tested', 'Archived'];
  if (STATUSES.indexOf(String(req.status)) < 0) return {error: 'bad status'};
  var sh = requestsSheet_();
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(req.id)) {
      sh.getRange(i + 1, 8, 1, 3).setValues([[String(req.status),
        clockTech_(req) || '', new Date().toISOString()]]);
      return {ok: true, id: String(req.id), status: String(req.status),
              who: String(vals[i][2]), text: String(vals[i][4]).slice(0, 140)};
    }
  }
  return {error: 'request not found'};
}
/* Tech Phones tab -> [{name, phone}] so the share sheet can open a text
 * to a teammate with the link prefilled. Digits normalized to +1XXXXXXXXXX. */
function teamPhones_() {
  var ss = SpreadsheetApp.openById('11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I');
  var sh = ss.getSheetByName('Tech Phones');
  if (!sh) return {ok: true, phones: []};
  var vals = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 2).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var name = String(vals[i][0] || '').trim();
    var digits = String(vals[i][1] || '').replace(/\D/g, '');
    if (!name || digits.length < 10) continue;
    if (digits.length === 10) digits = '1' + digits;
    out.push({name: name, phone: '+' + digits});
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  // BLP email per teammate (Current Team: firstname col A, BLP Email col AE) —
  // only name/phone/email ever leave this function, nothing else from that sheet
  try {
    var ts = SpreadsheetApp.openById('1j1FP78rRj1jrl2z-_vIg95kN3GuG8TI4dpOheSnIoPc')
      .getSheetByName('Current Team');
    var tv = ts.getRange(2, 1, Math.max(1, ts.getLastRow() - 1), 31).getValues();
    var emails = {};
    for (var k = 0; k < tv.length; k++) {
      var fn = String(tv[k][0] || '').trim().toLowerCase();
      var em = String(tv[k][30] || '').trim();
      if (fn && em.indexOf('@') > 0) emails[fn] = em;
    }
    for (var m2 = 0; m2 < out.length; m2++) {
      var key = out[m2].name.split(' ')[0].toLowerCase();
      if (emails[key]) out[m2].email = emails[key];
    }
  } catch (e) {}
  return {ok: true, phones: out};
}

function requestsList_() {
  var sh = requestsSheet_();
  var last = sh.getLastRow();
  var out = [];
  if (last >= 2) {
    var vals = sh.getRange(Math.max(2, last - 499), 1, Math.min(500, last - 1), 10).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      var v = vals[i];
      if (!v[0]) continue;
      out.push({id: String(v[0]), date: String(v[1]), who: String(v[2]), type: String(v[3]),
                text: String(v[4]), context: String(v[5]), screenshot: String(v[6]),
                status: String(v[7]) || 'Requested', statusBy: String(v[8]), statusAt: String(v[9])});
    }
  }
  return {ok: true, requests: out};
}

/* Paperwork — QC checklist scans live in one shared Drive folder, filed in
 * year subfolders with names like "Acrosonic 583056". paperworkScan_ finds a
 * piano's scans by serial (Drive title search, 6h cache); setPaperwork_
 * stores manual attachments (bass string order, tear down sheet, plating
 * order…) as JSON in a PAPERWORK column the map serves back out. */
var PAPERWORK_FOLDER = '1hcITGeJpzoBSk4fMsdnIs-FA0LZMu-Cl';
function paperworkScan_(serial) {
  serial = String(serial || '').trim();
  if (serial.length < 4) return {files: []};
  var cache = CacheService.getScriptCache();
  var hit = cache.get('pw_' + serial);
  if (hit) return JSON.parse(hit);
  var q = "title contains '" + serial.replace(/'/g, "\\'") + "'";
  var out = [];
  var folders = [DriveApp.getFolderById(PAPERWORK_FOLDER)];
  var subs = folders[0].getFolders();          // year folders, one level down
  while (subs.hasNext()) folders.push(subs.next());
  for (var i = 0; i < folders.length && out.length < 12; i++) {
    var fs = folders[i].searchFiles(q);
    while (fs.hasNext() && out.length < 12) {
      var f = fs.next();
      out.push({name: f.getName(), url: f.getUrl()});
    }
    var fo = folders[i].searchFolders(q);      // some pianos get a subfolder
    while (fo.hasNext() && out.length < 12) {
      var d = fo.next();
      out.push({name: d.getName() + ' 📁', url: d.getUrl()});
    }
  }
  var res = {files: out};
  cache.put('pw_' + serial, JSON.stringify(res), 21600);
  return res;
}

function setPaperwork_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var kind = String(req.kind || '').trim().toLowerCase();
  if (!kind) return {error: 'kind required'};
  var col = pianoCol_(sh, 'PAPERWORK');
  var cur = {};
  try { cur = JSON.parse(String(sh.getRange(found.row, col).getValue() || '{}')) || {}; }
  catch (e) { cur = {}; }
  var url = String(req.url == null ? '' : req.url).trim();
  if (!url) delete cur[kind];
  else cur[kind] = {url: url.slice(0, 500), name: String(req.name || '').slice(0, 120)};
  sh.getRange(found.row, col).setValue(Object.keys(cur).length ? JSON.stringify(cur) : '');
  return {ok: true, row: found.row, summary: found.summary, paperwork: cur};
}

function setPayPlan_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var col = pianoCol_(sh, 'PAYMENT PLAN');
  var val = String(req.plan == null ? '' : req.plan).trim();
  sh.getRange(found.row, col).setValue(val);
  return {ok: true, row: found.row, summary: found.summary, plan: val};
}

function setAdminSteps_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var col = pianoCol_(sh, 'ADMIN STEPS');
  var val = String(req.steps == null ? '' : req.steps).trim();
  sh.getRange(found.row, col).setValue(val);
  return {ok: true, row: found.row, summary: found.summary, steps: val};
}

// A shop-progress payment milestone (25/50/75/100%) was crossed: email info@
// a shop update + progress-photo folder link + a prepared client email, then
// record the milestone so it never emails twice
function payMilestone_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var col = pianoCol_(sh, 'PAY MILESTONE');
  var prev = parseInt(String(sh.getRange(found.row, col).getValue() || '').replace(/\D/g, ''), 10) || 0;
  var ms = parseInt(req.milestone, 10) || 0;
  if (ms <= prev) return {ok: true, row: found.row, milestone: prev, skipped: 'already emailed'};
  var tech = null;
  try { tech = techFolderFor_(sh, found.row, req.serial); } catch (e) {}
  var subject = '💰 ' + ms + '% payment milestone — ' + (req.summary || req.serial)
    + (req.plan ? ' (' + req.plan + ')' : '');
  var body = 'Shop work progress update\n'
    + '========================\n'
    + 'Piano: ' + (req.summary || '') + '  (serial ' + (req.serial || '—') + ')\n'
    + 'Client: ' + (req.ownerName || '—') + (req.clientEmail ? '  <' + req.clientEmail + '>' : '') + '\n'
    + 'Milestone reached: ' + ms + '%  (currently ' + (req.pct || ms) + '% · phase: ' + (req.phase || '—') + ')\n'
    + 'Payment plan: ' + (req.plan || 'not set') + '\n'
    + 'Progress photos: ' + (tech ? tech.getUrl() : 'no Tech folder found for this piano') + '\n'
    + 'Store Map: ' + APP_URL + '\n\n'
    + '--- Prepared email for the client (review, personalize, send) ---\n\n'
    + (req.clientDraft || '(none)') + '\n';
  MailApp.sendEmail(REPORT_TO, subject, body);
  sh.getRange(found.row, col).setValue(String(ms));
  return {ok: true, row: found.row, milestone: ms, emailed: REPORT_TO};
}

/* ============ SHOP MANAGER DAILY BRIEFING ============
 * A working checklist for the shop manager, not just a headcount: what
 * changed yesterday and who did it, what's blocked, what needs a decision,
 * and what data is missing. Every section hides itself when it's empty, so
 * a quiet day is a short email.
 * Run sendShopManagerReport() manually, or sendShopManagerReportTo('a@b.com')
 * to send a sample somewhere else. */
var SHOPMGR_TO = 'shop@brighamlarsonpianos.com,brigham@brighamlarsonpianos.com,karmel@brighamlarsonpianos.com';
var ADMIN_TO = 'info@brighamlarsonpianos.com,karmel@brighamlarsonpianos.com,brigham@brighamlarsonpianos.com';   // Admin Morning Brief
var TRACKDEFS_URL = 'https://blpsalesapp.netlify.app/.netlify/functions/track-defs';
var TASKS_URL = 'https://blpsalesapp.netlify.app/.netlify/functions/piano-tasks';
// phase -> the specialty area that staffs it (mirrors the Store Map card)
var SM_PHASE_AREA = {
  'CAP': 'CAP', 'PRSB & Plate Refinishing': 'PRSB', 'Restringing': 'Restringing',
  'Refinishing': 'Refinishing', 'QC & Assembly': 'QC', '1st Tuning': 'Tuning',
  '2nd Tuning': 'Tuning', 'Chip Tuning': 'Tuning'
};
// median scheduled hours per phase (7 months of tech calendar history) turned
// into "this is taking too long" day thresholds
var SM_PHASE_DAYS = {
  'CAP': 21, 'PRSB & Plate Refinishing': 21, 'Lacquer Soundboard': 10,
  'Restringing': 14, 'Chip Tuning': 5, 'DHRT': 30, '1st Tuning': 5,
  'Refinishing': 30, 'QC & Assembly': 10, '2nd Tuning': 5,
  'Exit Prep - Admin': 7, 'Assessment': 7, 'New Arrival - Admin': 5
};
var SM_ADMIN_STEPS = ['$1000 Queue Payment', 'Selections Made (Google Form)',
  'Welcome Email', 'Before Photos', 'Plan Entered to Shop Tag & Printed',
  'Upsell Offers — Brigham Call (after 50%)',
  '100% Payment Collected Prior to Delivery', 'Delivery Scheduled'];

function smDenverDay_(d) {
  return Utilities.formatDate(d || new Date(), 'America/Denver', 'yyyy-MM-dd');
}
function smIsShopwork_(p) {
  return String(p.section || '').trim().toUpperCase() === 'CUSTOM SHOPWORK';
}
function smPhaseIdx_(ph) { return PHASE_VALUES.indexOf(ph); }
function smIsWorkPhase_(ph) {
  var i = smPhaseIdx_(ph);
  return i >= 0 && i <= 12;   // New Arrival .. Exit Prep
}
// pianos whose track phases are done, as a rough % (mirrors the card's bar)
function smProgress_(p) {
  var done = String(p.phasesDone || '').split(',').map(function (s) { return s.trim(); })
    .filter(String);
  var list = PHASE_VALUES.slice(0, 13);
  var cur = smPhaseIdx_(p.phase);
  var n = 0;
  for (var i = 0; i < list.length; i++) {
    if (done.indexOf(list[i]) >= 0 || (cur >= 0 && i < cur)) n++;
  }
  return Math.round(n / list.length * 100);
}
// "City, ST" hiding in the owner blob — the Shop Work Map needs one to pin
function smHasPlace_(p) {
  var blob = String(p.owner || '');
  return /[A-Za-z][A-Za-z .'-]{2,},?\s*[A-Z]{2}[,.]?\s+\d{5}/.test(blob)
      || /[A-Za-z][A-Za-z .'-]{2,},\s*[A-Z]{2}\b/.test(blob);
}
function smDaysSince_(iso) {
  if (!iso) return null;
  var t = new Date(iso + 'T00:00:00Z').getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}
function smName_(p) {
  return (p.summary || [p.year, p.make, p.model].filter(String).join(' ') || 'piano');
}
function smSpot_(p) { return p.location ? String(p.location) : '—'; }

/* ---- yesterday's activity, grouped by person ---- */
function smYesterdayActivity_() {
  var ss = SpreadsheetApp.openById(PIANO_LOG_ID);
  var sh = ss.getSheetByName('ACTIVITY LOG');
  var out = {byWho: {}, phases: [], dups: [], total: 0};
  if (!sh || sh.getLastRow() < 2) return out;
  var n = Math.min(sh.getLastRow() - 1, 600);
  var vals = sh.getRange(sh.getLastRow() - n + 1, 1, n, 5).getValues();
  var since = new Date(Date.now() - 36 * 3600 * 1000);   // since ~yesterday morning
  for (var i = 0; i < vals.length; i++) {
    var when = vals[i][0];
    if (!(when instanceof Date) || when < since) continue;
    var who = String(vals[i][1] || 'unknown');
    var action = String(vals[i][2] || '');
    var piano = String(vals[i][3] || '');
    var detail = String(vals[i][4] || '');
    var stamp = Utilities.formatDate(when, 'America/Denver', 'h:mm a');
    out.total++;
    if (!out.byWho[who]) out.byWho[who] = [];
    out.byWho[who].push({t: stamp, action: action, piano: piano, detail: detail});
    if (/phase change/i.test(action)) out.phases.push({who: who, piano: piano, detail: detail});
    if (/marked duplicate/i.test(action)) out.dups.push({who: who, piano: piano, detail: detail});
  }
  return out;
}

/* ---- concurrent tasks that must finish before the NEXT phase starts ---- */
function smBlockedByTasks_(pianos, defs) {
  if (!defs || !defs.tracks) return [];
  var live = pianos.filter(function (p) {
    return p.serial && smIsShopwork_(p) && smIsWorkPhase_(p.phase);
  }).slice(0, 60);                       // cap so the trigger can't time out
  if (!live.length) return [];
  var reqs = live.map(function (p) {
    return {url: TASKS_URL + '?serial=' + encodeURIComponent(p.serial),
            muteHttpExceptions: true};
  });
  var resp;
  try { resp = UrlFetchApp.fetchAll(reqs); } catch (e) { return []; }
  var out = [];
  for (var i = 0; i < live.length; i++) {
    var p = live[i], rows = [];
    try { rows = (JSON.parse(resp[i].getContentText()) || {}).rows || []; }
    catch (e) { continue; }
    var keys = smTrackKeys_(p, defs);
    if (!keys.length) continue;
    var curIdx = smPhaseIdx_(p.phase);
    var late = [];
    for (var k = 0; k < keys.length; k++) {
      var tasks = defs.tracks[keys[k]].tasks || [];
      for (var t = 0; t < tasks.length; t++) {
        var endIdx = smPhaseIdx_(smNormPhase_(tasks[t].endPhase));
        if (endIdx < 0 || endIdx > curIdx) continue;      // not due yet
        var id = smTaskId_(tasks[t].name);
        var row = null;
        for (var r = 0; r < rows.length; r++) {
          if (smTaskId_(rows[r].task) === id && !rows[r].part) { row = rows[r]; break; }
        }
        var parts = rows.filter(function (x) { return smTaskId_(x.task) === id && x.part; });
        var doneAll = parts.length
          ? parts.every(function (x) { return x.step2At; })
          : !!(row && row.step2At);
        if (!doneAll && late.indexOf(tasks[t].name) < 0) late.push(tasks[t].name);
      }
    }
    if (late.length) out.push({p: p, tasks: late});
  }
  return out;
}
function smTaskId_(n) {
  return String(n || '').toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function smNormPhase_(s) {
  var t = String(s || '').toLowerCase();
  if (t.indexOf('new arrival') >= 0) return 'New Arrival - Admin';
  if (t.indexOf('assessment') >= 0) return 'Assessment';
  if (t.indexOf('chip tuning') >= 0) return 'Chip Tuning';
  if (t.indexOf('string') >= 0) return 'Restringing';
  if (t.indexOf('cap') >= 0) return 'CAP';
  if (t.indexOf('prsb') >= 0) return 'PRSB & Plate Refinishing';
  if (t.indexOf('lacquer') >= 0) return 'Lacquer Soundboard';
  if (t.indexOf('dhrt') >= 0) return 'DHRT';
  if (t.indexOf('1st tuning') >= 0) return '1st Tuning';
  if (t.indexOf('2nd tuning') >= 0) return '2nd Tuning';
  if (t.indexOf('refinish') >= 0) return 'Refinishing';
  if (t.indexOf('qc') >= 0) return 'QC & Assembly';
  if (t.indexOf('exit prep') >= 0) return 'Exit Prep - Admin';
  if (t.indexOf('delivered') >= 0) return 'Delivered';
  return String(s || '').trim();
}
function smTrackKeys_(p, defs) {
  var have = String(p.track || '').toLowerCase();
  var alias = {rebuild: 'rebuild', hybrid: 'hybrid', refurbish: 'refurbishing',
               refurbishing: 'refurbishing', repair: 'repair'};
  var keys = [];
  for (var a in alias) {
    if (have.indexOf(a) >= 0 && defs.tracks[alias[a]] && keys.indexOf(alias[a]) < 0) {
      keys.push(alias[a]);
    }
  }
  return keys;
}
function smGoTo_(phase, type, defs) {
  if (!defs || !defs.specialties) return '';
  var area = SM_PHASE_AREA[phase];
  if (phase === 'DHRT') area = (type === 'grand') ? 'DHRT for grands' : 'DHRT for uprights';
  if (!area) return '';
  var folks = (defs.specialties.people || []).filter(function (x) {
    return x.role !== 'intern' && (x.skills[area] || 0) >= 2;
  }).sort(function (a, b) { return (b.skills[area] || 0) - (a.skills[area] || 0); }).slice(0, 3);
  return folks.map(function (x) {
    return x.name + ((x.skills[area] === 3) ? ' ★' : '');
  }).join(', ');
}

/* ---- stale phases: Friday reports say a phase is finished but the map
   still shows the piano IN that phase. Matches on word STEMS because the
   team writes shorthand and ESL phrasing — "restring" == "restringing",
   "chip tune" == "Chip Tuning" (this exact miss happened with M&H 55383:
   "I finished restring" 7/31, map still said Restringing a week later). ---- */
var SM_PHASE_STEMS = {
  'Restringing': ['restring', 'string'],
  'Chip Tuning': ['chip'],
  '1st Tuning': ['tun'], '2nd Tuning': ['tun'],
  'CAP': ['cap'],
  'PRSB & Plate Refinishing': ['prsb', 'plate'],
  'Lacquer Soundboard': ['lacquer', 'soundboard'],
  'Refinishing': ['refinish', 'spray', 'sanded', 'sanding'],
  'DHRT': ['dhrt', 'regulat', 'voicing', 'voice'],
  'QC & Assembly': ['qc', 'assembl'],
  'Exit Prep - Admin': ['exit prep']
};
var SM_DONE_RE = /finish|finished|done|complete|completed|100\s*%/;
function smReportSheetLatest_() {
  // latest non-empty Friday column + the one before it (completion claims
  // often appear the week BEFORE the phase gets advanced — read both)
  try {
    var ss = SpreadsheetApp.openById('11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I');
    var year = Utilities.formatDate(new Date(), 'America/Denver', 'yyyy');
    var sh = null, tabs = ss.getSheets();
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getName().indexOf(year) >= 0) { sh = tabs[i]; break; }
    }
    if (!sh) return '';
    var vals = sh.getDataRange().getValues();
    var lastCol = -1;
    for (var c = vals[0].length - 1; c >= 1; c--) {
      for (var r2 = 1; r2 < vals.length; r2++) {
        if (String(vals[r2][c] || '').trim()) { lastCol = c; break; }
      }
      if (lastCol >= 0) break;
    }
    if (lastCol < 1) return '';
    var txt = [];
    for (var r3 = 1; r3 < vals.length; r3++) {
      txt.push(String(vals[r3][lastCol] || ''));
      if (lastCol > 1) txt.push(String(vals[r3][lastCol - 1] || ''));
    }
    return txt.join('\n').toLowerCase();
  } catch (e) { return ''; }
}
function smStalePhases_(pianos) {
  var blob = smReportSheetLatest_();
  if (!blob) return [];
  // split into sentence-ish segments so "finished" binds to the right serial
  var segs = blob.split(/[\n.|;]+/);
  var out = [];
  pianos.forEach(function (p) {
    if (!p.serial || !smIsShopwork_(p)) return;
    var stems = SM_PHASE_STEMS[p.phase];
    if (!stems) return;
    var ser = String(p.serial).toLowerCase();
    if (ser.length < 4) return;                     // too short to trust a match
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].indexOf(ser) < 0) continue;
      if (!SM_DONE_RE.test(segs[i])) continue;
      for (var k = 0; k < stems.length; k++) {
        if (segs[i].indexOf(stems[k]) >= 0) {
          out.push({p: p, quote: segs[i].trim().slice(0, 140)});
          return;
        }
      }
      // bare "<serial>: completed" with no phase word at all still counts —
      // McKinly wrote exactly that about Baldwin 191714 while the map said
      // Refinishing, and a stem-only match missed it
      if (segs[i].replace(ser, '').length < 60) {
        out.push({p: p, quote: segs[i].trim().slice(0, 140)});
        return;
      }
    }
  });
  return out;
}

/* ---- arrivals on the moving calendar with no Piano Log row: pickups
   headed to the shop whose client name matches no owner cell — these
   pianos will never appear on the map unless a Coming Soon row is added
   (caught live 8/8: Metler, Karhan, Haas pickups had no rows). ---- */
function smArrivalName_(sum) {
  var t = String(sum || '');
  var m = /from\s+([A-Z][A-Za-z .'-]{3,40}?)'s/i.exec(t);   // "from Suzanne Metler's house"
  if (m) return m[1].trim();
  var parts = t.split(':');
  if (parts.length > 1) {
    var last = parts[parts.length - 1]
      .replace(/\b(pick\s?up|pickup|delivery|move)\b/gi, '').trim();
    if (/^[A-Za-z .'&-]{4,40}$/.test(last)) return last;
  }
  return '';
}
function smMissingArrivals_(pianos, events) {
  var out = [];
  (events || []).forEach(function (e) {
    var sum = String(e.summary || '');
    if (!/pick\s?up|pickup|grab/i.test(sum)) return;             // arrivals only
    if (/bench|plate|skid|board|part|tool|rug|dolly/i.test(sum)) return;  // gear, not pianos
    var name = smArrivalName_(sum);
    if (!name || name.length < 5) return;                        // nothing matchable
    var needle = name.toLowerCase();
    var found = pianos.some(function (p) {
      return String(p.owner || '').toLowerCase().indexOf(needle) >= 0;
    });
    if (!found) out.push({date: String(e.date || ''), summary: sum.slice(0, 90), name: name});
  });
  return out;
}

/* ---- weekly schedule proposal: stored on a hidden tab of the report
   sheet (the anonymous web-app deployment cannot call DriveApp — its
   grant lacks the Drive scope — but SpreadsheetApp works), embedded in
   the Shop Manager's Planner page, and (after Brigham approves) written
   onto the technicians' real Google Calendars ---- */
var PROPOSAL_TAB = 'Proposal Store';   // A1 = meta JSON, A2.. = plan JSON chunks
var TECH_CAL_TAB = 'Tech Calendars';   // Name | Calendar ID — editable, no redeploy
var PROPOSAL_CHUNK = 40000;            // stay under the 50k-char cell limit
function proposalSheet_() {
  var ss = SpreadsheetApp.openById('11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I');
  var sh = ss.getSheetByName(PROPOSAL_TAB);
  if (!sh) { sh = ss.insertSheet(PROPOSAL_TAB, ss.getSheets().length); sh.hideSheet(); }
  return sh;
}
function saveProposal_(req) {
  var plan = String(req.plan || '');
  if (!plan || plan.length > 400000) return {error: 'plan missing or too large'};
  try { JSON.parse(plan); } catch (e) { return {error: 'plan is not valid JSON'}; }
  var meta = {week: String(req.week || ''), weekStart: String(req.weekStart || ''),
              savedAt: new Date().toISOString(), store: 'sheet', applied: false};
  var rows = [[JSON.stringify(meta)]];
  for (var i = 0; i < plan.length; i += PROPOSAL_CHUNK) rows.push([plan.substr(i, PROPOSAL_CHUNK)]);
  var sh = proposalSheet_();
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 1).setValues(rows);
  return {ok: true, week: meta.week};
}
function latestProposal_() {
  var vals = proposalSheet_().getDataRange().getValues();
  if (!vals.length || !String(vals[0][0] || '')) return {error: 'no proposal saved yet'};
  var meta = JSON.parse(String(vals[0][0]));
  var raw = '';
  for (var i = 1; i < vals.length; i++) raw += String(vals[i][0] || '');
  if (!raw) return {error: 'proposal store has meta but no plan'};
  return {ok: true, meta: meta, plan: JSON.parse(raw)};
}
function techCalMap_() {
  var ss = SpreadsheetApp.openById('11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I');
  var sh = ss.getSheetByName(TECH_CAL_TAB);
  if (!sh) {
    sh = ss.insertSheet(TECH_CAL_TAB, ss.getSheets().length);
    // verified calendars only — Garrett VICKERY is the mover, NOT Garrett
    // Taylor the DHRT tech, so unknowns stay blank for Brigham to fill in
    var seed = [['Technician', 'Calendar ID (leave blank = skip on apply)'],
      ['Korban', 'korbangreenhalgh.blp@gmail.com'],
      ['Curtis', 'curtisbiggs.blp@gmail.com'],
      ['Jake', 'jakepulver.blp@gmail.com'],
      ['McKinly', 'mckinlylopp.blp@gmail.com'],
      ['Matthew', 'matthewwessman.blp@gmail.com'],
      ['Mark', 'markhales.blp@gmail.com'],
      ['Avery', ''], ['Courtney', ''], ['Doris', ''], ['Garrett', ''],
      ['Jacob', ''], ['Lupita', ''], ['Marcelo', ''], ['Myrrhanda', ''],
      ['Sadie', ''], ['Victoria', '']];
    sh.getRange(1, 1, seed.length, 2).setValues(seed);
    sh.setFrozenRows(1);
  }
  var vals = sh.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < vals.length; i++) {
    var n = String(vals[i][0] || '').trim(), c = String(vals[i][1] || '').trim();
    if (n && c) map[n.toLowerCase()] = c;
  }
  return map;
}
// plan times are shop-clock 12h without am/pm: 7-11 = morning, 12-6 = afternoon
function shopClock_(t) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return null;
  var h = parseInt(m[1], 10);
  if (h >= 1 && h <= 6) h += 12;
  return {h: h, min: parseInt(m[2], 10)};
}
function applySchedule_(req) {
  var got = latestProposal_();
  if (!got.ok) return got;
  // selective approve: req.techs = ['Doris', …] applies only those; omitted
  // = every mapped tech. Per-tech idempotency via meta.appliedTechs.
  var only = null;
  if (req.techs && req.techs.length) {
    only = {};
    req.techs.forEach(function (n) { only[String(n).toLowerCase()] = true; });
  }
  var done = {};
  (got.meta.appliedTechs || []).forEach(function (n) { done[String(n).toLowerCase()] = true; });
  if (!only && got.meta.applied && !req.force) {
    return {error: 'already applied ' + got.meta.appliedAt + ' — resend with force:true to re-apply'};
  }
  var plan = got.plan;
  var start = new Date((plan.weekStart || got.meta.weekStart) + 'T12:00:00');
  if (isNaN(start.getTime())) return {error: 'proposal has no weekStart date'};
  var map = techCalMap_();
  // standing rule (Brigham 2026-08-17): every scheduled piano event carries the
  // piano's CURRENT map spot in the Google event's location field (bare value)
  var spotBySerial = {};
  try {
    var live = JSON.parse(UrlFetchApp.fetch(APP_URL + '/api/data').getContentText());
    (live.pianos || []).forEach(function (p) {
      if (p.serial && p.location) spotBySerial[String(p.serial)] = String(p.location);
    });
  } catch (e) { /* no map data — events just go out without locations */ }
  function spotFor_(title) {
    var runs = String(title || '').match(/\d{3,}/g) || [];
    for (var i = 0; i < runs.length; i++) {
      if (spotBySerial[runs[i]]) return spotBySerial[runs[i]];
    }
    return '';
  }
  var results = [];
  var applied = [];
  (plan.techs || []).forEach(function (tch) {
    var key = String(tch.name || '').toLowerCase();
    if (only && !only[key]) return;
    if (done[key] && !req.force) { results.push({tech: tch.name, skipped: 'already applied'}); return; }
    var calId = map[key];
    if (!calId) { results.push({tech: tch.name, skipped: 'no calendar mapped'}); return; }
    if (req.markOnly) { applied.push(tch.name); results.push({tech: tch.name, events: 0, marked: true}); return; }
    var cal;
    try { cal = CalendarApp.getCalendarById(calId); } catch (e) { cal = null; }
    if (!cal) { results.push({tech: tch.name, error: 'no access to ' + calId}); return; }
    var made = 0, failed = 0;
    (tch.days || []).forEach(function (blocks, di) {
      (blocks || []).forEach(function (b) {
        if (b[2] === 'hold') return;               // already on their calendar
        var t1 = shopClock_(b[0]), t2 = shopClock_(b[1]);
        if (!t1 || !t2) { failed++; return; }
        var d1 = new Date(start); d1.setDate(d1.getDate() + di); d1.setHours(t1.h, t1.min, 0, 0);
        var d2 = new Date(start); d2.setDate(d2.getDate() + di); d2.setHours(t2.h, t2.min, 0, 0);
        try {
          var evTitle = String(b[3] || 'Shop work');
          var opts = {description: (b[4] ? String(b[4]) + '\n' : '')
            + 'Applied from the Shop Manager schedule proposal (' + plan.week + ')'};
          var spot = spotFor_(evTitle);
          if (spot) opts.location = spot;
          cal.createEvent(evTitle, d1, d2, opts);
          made++;
        } catch (e) { failed++; }
      });
    });
    results.push({tech: tch.name, events: made, failed: failed});
    // a tech whose every event-create failed (e.g. read-only calendar access)
    // must NOT be recorded as applied — that hid Matthew's failure on 8/16
    if (made > 0 || failed === 0) applied.push(tch.name);
  });
  applied.forEach(function (n) { done[String(n).toLowerCase()] = true; });
  got.meta.appliedTechs = (plan.techs || []).map(function (t) { return t.name; })
    .filter(function (n) { return done[String(n).toLowerCase()]; });
  var mappable = (plan.techs || []).filter(function (t) { return map[String(t.name || '').toLowerCase()]; });
  got.meta.applied = mappable.length > 0 && mappable.every(function (t) { return done[String(t.name).toLowerCase()]; });
  got.meta.appliedAt = new Date().toISOString();
  proposalSheet_().getRange(1, 1).setValue(JSON.stringify(got.meta));
  return {ok: true, week: plan.week, results: results, appliedTechs: got.meta.appliedTechs, applied: got.meta.applied};
}

/* ---- the briefing itself ---- */
/* ---------- Morning Standup (8AM) — celebration + culture block ---------- */
var SM_SAFETY_TIPS = [
  'Lifting a grand? Never alone — three points of contact on the skid board, and clear the path first.',
  'Tilters and dollies: check straps for fraying before the first move of the day, not after.',
  'Lacquer and finishing areas: respirators on, and check the spray booth exhaust is running before the gun.',
  'String replacement: eye protection ALWAYS — a breaking bass string carries real force.',
  'Keep walkways between map spots clear — a dolly path blocked by a bench is how toes get broken.',
  'Sanding and buffing: dust masks on, and vacuum the station at the end of the shift, not "later".',
  'Soldering and hot tools: unplug at the outlet when you step away, even "just for a minute".',
  'Cabinet parts on high shelves: heavy pieces live at waist height — never above shoulder level.',
  'Extension cords: fully unrolled before load, out of walk paths, and never daisy-chained.',
  'Chemical strippers: gloves, ventilation, and label every transfer container the moment you pour.',
  'Ladders: 3 points of contact, never the top step, and a spotter for anything over 8 feet.',
  'Pinblock and plate work: crane straps rated and inspected — a plate drop is unforgiving.',
  'Blades and chisels: sharpen at the bench, cap or sheath before they go in the apron.',
  'End of day: hot rags from oil finishing go in the metal can with water — spontaneous combustion is real.'
];
var SM_STANDARDS = [
  'Every piano leaves cleaner than it arrived — wipe your station and the piano before you clock out of it.',
  'Photograph before you disassemble. Future-you (and the client) will thank you.',
  'If you touch it, log it — the Work Clock and activity log are how we prove our craftsmanship story.',
  'Client parts are sacred: label, bag, and shelf every screw the same day it comes off.',
  'A phase isn’t done until the checklist says it’s done — no verbal "basically finished".',
  'See something drifting on another bench? Say something kindly, today, not at the deadline.',
  'The queue order is a promise to clients — jumping it needs a manager’s yes, every time.',
  'Tools back on the shadow board before lunch and before close — hunting tools is stolen shop time.',
  'When in doubt on a call (finish level, part choice), stop and ask — rework costs triple.',
  'Write notes a stranger could follow — the next tech on this piano might not be you.',
  'Under-promise, over-deliver: pad the estimate, beat the date.',
  'Treat every walk-through like the client is watching — because on delivery day, they are.',
  'A near-miss is a report, not a story for later — we fix hazards the day we meet them.',
  'Celebrate finished work out loud — a piano leaving the shop is why we’re all here.'
];
function smParseMonthDay_(s) {
  var m = /^(\d{1,2})\s*[\/\-]\s*(\d{1,2})/.exec(String(s || '').trim());
  if (!m) return null;
  var mo = +m[1], d = +m[2];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  var yr = /[\/\-](\d{2,4})\s*$/.exec(String(s).trim().slice(m[0].length));
  var y = yr ? +yr[1] : null;
  if (y !== null && y < 100) y += (y > 30 ? 1900 : 2000);
  return {mo: mo, d: d, y: y};
}
function smStandup_(pianos, R) {
  var S = {bdays: [], annivs: [], newFaces: [], delivered: [], teamwork: [],
           champ: null, personalBests: [], safety: '', standard: '', focus: [], dbg: []};
  // anchor every date window on the brief's own date, so an evening send
  // celebrates the birthdays of the morning it's prepping for
  var now = (R && R.refDate) ? R.refDate : new Date();
  var doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  S.safety = SM_SAFETY_TIPS[doy % SM_SAFETY_TIPS.length];
  S.standard = SM_STANDARDS[doy % SM_STANDARDS.length];

  // birthdays + work anniversaries + new team members (Current Team sheet;
  // only first name, position, and the dates below ever leave this function)
  try {
    var ts = SpreadsheetApp.openById('1j1FP78rRj1jrl2z-_vIg95kN3GuG8TI4dpOheSnIoPc')
      .getSheetByName('Current Team');
    var tv = ts.getRange(2, 1, Math.max(1, ts.getLastRow() - 1), 25).getValues();
    var win = [];   // today + next 6 days as {mo, d, off}
    for (var o = 0; o < 7; o++) {
      var dt = new Date(now.getTime() + o * 86400000);
      win.push({mo: dt.getMonth() + 1, d: dt.getDate(), off: o});
    }
    // anniversaries are rarer than birthdays — a 7-day window sits empty most
    // mornings, so give them a full month of runway to always have a spot
    var winAnniv = [];
    for (var o2 = 0; o2 < 30; o2++) {
      var dt2 = new Date(now.getTime() + o2 * 86400000);
      winAnniv.push({mo: dt2.getMonth() + 1, d: dt2.getDate(), off: o2});
    }
    function inWinArr(md, arr) {
      if (!md) return null;
      for (var wI = 0; wI < arr.length; wI++) {
        if (arr[wI].mo === md.mo && arr[wI].d === md.d) return arr[wI].off;
      }
      return null;
    }
    function inWin(md) { return inWinArr(md, win); }
    function when(off) { return off === 0 ? 'TODAY 🎉' : off === 1 ? 'tomorrow'
      : Utilities.formatDate(new Date(now.getTime() + off * 86400000), 'America/Denver', 'EEEE M/d'); }
    for (var i = 0; i < tv.length; i++) {
      var first = String(tv[i][0] || '').trim(), last = String(tv[i][1] || '').trim();
      if (!first) continue;
      var pos = String(tv[i][3] || '').trim();
      // birthdate cells arrive as Date objects when the cell is date-formatted,
      // as strings otherwise — and a year the sheet invented (e.g. "10/27"
      // parsing to the current year) is not a real birth year
      var bdRaw = tv[i][24];
      var bd = (bdRaw instanceof Date)
        ? {mo: bdRaw.getMonth() + 1, d: bdRaw.getDate(),
           y: (bdRaw.getFullYear() > 1930 && bdRaw.getFullYear() <= now.getFullYear() - 8)
              ? bdRaw.getFullYear() : null}
        : smParseMonthDay_(bdRaw);
      var off1 = inWin(bd);
      if (off1 !== null) {
        var age = bd.y ? (now.getFullYear() - bd.y) : null;
        S.bdays.push({name: first + ' ' + last, when: when(off1), off: off1,
                      age: age && age > 10 && age < 90 ? age : null});
      }
      var st = tv[i][6];
      var sd = (st instanceof Date) ? {mo: st.getMonth() + 1, d: st.getDate(), y: st.getFullYear()}
                                    : smParseMonthDay_(st);
      if (sd && sd.y) {
        var off2 = inWinArr(sd, winAnniv);
        var yrs = now.getFullYear() - sd.y;
        if (off2 !== null && yrs >= 1) {
          S.annivs.push({name: first + ' ' + last, when: when(off2), off: off2, years: yrs, pos: pos});
        }
        var stDate = new Date(sd.y, sd.mo - 1, sd.d);
        var daysHere = Math.floor((now - stDate) / 86400000);
        if (daysHere >= 0 && daysHere <= 21) {
          S.newFaces.push({name: first + ' ' + last, pos: pos, days: daysHere});
        }
      }
    }
    S.bdays.sort(function (a, b) { return a.off - b.off; });
    S.annivs.sort(function (a, b) { return a.off - b.off; });
  } catch (e) { S.dbg.push(String(e)); }

  // pianos delivered / completed yesterday — from the activity log
  try {
    (R.activity.phases || []).forEach(function (a) {
      if (/deliver/i.test(String(a.detail || ''))) {
        S.delivered.push({piano: a.piano, who: a.who});
      }
    });
  } catch (e) { S.dbg.push(String(e)); }

  // teamwork: for pianos delivered yesterday or moving today, everyone who
  // ever clocked time on them — "these N techs built this"
  try {
    var tl = timeLogRows_(240).rows || [];
    var bySerial = {};
    tl.forEach(function (r0) {
      if (!r0.serial) return;
      (bySerial[r0.serial] = bySerial[r0.serial] || {}).x = 1;
      bySerial[r0.serial][r0.tech] = true;
    });
    var outbound = {};
    S.delivered.forEach(function (d) { outbound[d.piano] = 'delivered yesterday'; });
    (R.moves || []).forEach(function (e0) {
      var s1 = String(e0.serial || e0.summary || '');
      if (s1) outbound[s1] = 'moving today';
    });
    for (var key in outbound) {
      for (var ser in bySerial) {
        if (key.indexOf(ser) < 0 && ser.indexOf(key) < 0
            && key.toLowerCase().indexOf(ser.toLowerCase()) < 0) continue;
        var techs = Object.keys(bySerial[ser]).filter(function (t) { return t !== 'x'; });
        if (techs.length >= 2) {
          S.teamwork.push({piano: key, why: outbound[key], techs: techs});
        }
        break;
      }
    }
  } catch (e) { S.dbg.push(String(e)); }

  // yesterday's Work Clock champion + personal-best days (last 60 days)
  try {
    if (R.clocked && R.clocked.length) S.champ = R.clocked[0];
    var tl2 = timeLogRows_(60).rows || [];
    var perDay = {};
    tl2.forEach(function (r0) {
      var d0 = Utilities.formatDate(new Date(r0.start), 'America/Denver', 'yyyy-MM-dd');
      (perDay[r0.tech] = perDay[r0.tech] || {})[d0] =
        (perDay[r0.tech][d0] || 0) + (r0.minutes || 0);
    });
    var yd = Utilities.formatDate(new Date(now.getTime() - 86400000), 'America/Denver', 'yyyy-MM-dd');
    for (var t2 in perDay) {
      var y0 = perDay[t2][yd] || 0;
      if (y0 < 120) continue;
      var best = true;
      for (var d2 in perDay[t2]) { if (d2 !== yd && perDay[t2][d2] >= y0) { best = false; break; } }
      if (best) S.personalBests.push({tech: t2, hours: Math.round(y0 / 6) / 10});
    }
  } catch (e) { S.dbg.push(String(e)); }

  // today's focus: next up in the queue + counts the room should hear
  try {
    (R.queueUp || []).slice(0, 3).forEach(function (p) {
      S.focus.push('Queue #' + p.queuePos + ' — ' + smName_(p) + ' (' + (p.phase || 'no phase') + ')');
    });
    if ((R.moves || []).length) S.focus.push((R.moves.length) + ' move' + (R.moves.length > 1 ? 's' : '') + ' on today’s calendar — confirm crews and paths');
    var od = (R.waiting || []).filter(function (w) { return w.state === 'overdue'; }).length;
    if (od) S.focus.push(od + ' “waiting on” item' + (od > 1 ? 's' : '') + ' past the check-back date — assign owners');
  } catch (e) { S.dbg.push(String(e)); }
  return S;
}

// dayOffset: 0 = classic same-morning send (brief describes "today");
// 1 = sent the evening before, ~7PM, so the brief describes "tomorrow" —
// the day of the standup it's actually prepping the team for.
function buildShopManagerReport_(dayOffset) {
  dayOffset = dayOffset || 0;
  var refDate = new Date(Date.now() + dayOffset * 86400000);
  var data = JSON.parse(UrlFetchApp.fetch(APP_URL + '/api/data').getContentText());
  var slots = JSON.parse(UrlFetchApp.fetch(APP_URL + '/data/slots.json').getContentText());
  var defs = null;
  try { defs = JSON.parse(UrlFetchApp.fetch(TRACKDEFS_URL).getContentText()); } catch (e) {}
  var pianos = (data.pianos || []).filter(function (p) { return p.active !== false; });
  var today = smDenverDay_(refDate);
  var R = {day: Utilities.formatDate(refDate, 'America/Denver', 'EEEE, MMMM d, yyyy'),
           dayOffset: dayOffset, refDate: refDate};

  R.activity = smYesterdayActivity_();

  // phase advances yesterday + who staffs the phase they're now in
  R.advances = R.activity.phases.map(function (a) {
    var p = null;
    for (var i = 0; i < pianos.length; i++) {
      if (pianos[i].summary === a.piano || pianos[i].serial === a.piano) { p = pianos[i]; break; }
    }
    return {who: a.who, piano: a.piano, detail: a.detail,
            goTo: p ? smGoTo_(p.phase, p.type, defs) : '', spot: p ? smSpot_(p) : ''};
  });

  R.blocked = smBlockedByTasks_(pianos, defs);

  // hours clocked yesterday (Work Clock) — adoption nudge + real numbers
  R.clocked = []; R.clockedTotal = 0;
  try {
    var tlRows = timeLogRows_(3).rows;
    // the day before the brief's own date — for an evening send that's the
    // shift just finishing, which is exactly what the morning wants to hear
    var yd = Utilities.formatDate(new Date(refDate.getTime() - 86400000), 'America/Denver', 'yyyy-MM-dd');
    var per = {};
    tlRows.forEach(function (r0) {
      if (Utilities.formatDate(new Date(r0.start), 'America/Denver', 'yyyy-MM-dd') !== yd) return;
      if (!per[r0.tech]) per[r0.tech] = {min: 0, pianos: {}};
      per[r0.tech].min += (r0.minutes || 0);
      per[r0.tech].pianos[r0.serial + ' ' + (r0.piano || '')] = r0.phase || '';
    });
    R.clocked = Object.keys(per).map(function (t) {
      return {tech: t, hours: Math.round(per[t].min / 6) / 10, pianos: Object.keys(per[t].pianos).length};
    }).sort(function (a, b) { return b.hours - a.hours; });
    R.clockedTotal = Math.round(R.clocked.reduce(function (s0, x) { return s0 + x.hours; }, 0) * 10) / 10;
  } catch (e) {}

  // suggestion box: filed or moved in the last 7 days — public credit fuels it
  R.suggestions = [];
  R.appLive = [];   // gone Live/Tested this week — managers announce these at the meeting
  try {
    var reqs = requestsList_().requests || [];
    var wk = Date.now() - 7 * 86400000;
    R.suggestions = reqs.filter(function (x) {
      return x.status !== 'Archived'
        && (new Date(x.date).getTime() >= wk
            || (x.statusAt && new Date(x.statusAt).getTime() >= wk));
    }).slice(0, 15);
    R.appLive = reqs.filter(function (x) {
      return (x.status === 'Live' || x.status === 'Tested')
        && x.statusAt && new Date(x.statusAt).getTime() >= wk;
    }).slice(0, 15);
  } catch (e) {}

  // client reports ready to review/send: opt-IN pianos with shop activity
  // in the last 7 days — the news is what makes a report worth emailing
  R.clientReady = [];
  try {
    var crp = pianos.filter(function (p) {
      return String(p.clientReports || '').trim().toLowerCase() === 'yes' && p.serial;
    });
    if (crp.length) {
      var act7 = (activity_().rows || []);
      var wk7 = Date.now() - 7 * 86400000;
      R.clientReady = crp.filter(function (p) {
        return act7.some(function (r) {
          var d = new Date(r[0]);
          return (isNaN(d) || d.getTime() >= wk7)
            && String(r[3] || '').indexOf(String(p.serial)) >= 0;
        });
      }).map(function (p) {
        return {serial: p.serial, summary: String(p.summary || '').slice(0, 44), phase: p.phase || ''};
      }).slice(0, 12);
    }
  } catch (e) {}

  // field tunings on McKinly's / Curtis's own calendars, next 2 days —
  // which appointments still need a reminder call / confirmation
  R.fieldCalls = [];
  try {
    var FIELD_CALS = [['McKinly', 'mckinlylopp.blp@gmail.com'], ['Curtis', 'curtisbiggs.blp@gmail.com']];
    var fc0 = new Date();
    var fc2 = new Date(Date.now() + 2 * 86400000); fc2.setHours(23, 59, 59, 0);
    FIELD_CALS.forEach(function (fc) {
      var cal; try { cal = CalendarApp.getCalendarById(fc[1]); } catch (e) { cal = null; }
      if (!cal) return;
      cal.getEvents(fc0, fc2).forEach(function (ev) {
        var t = String(ev.getTitle() || '');
        if (!/:/.test(t)) return;                       // client appts read "City: Name"
        if (/off|available for tuning|no tuning|back-to-back/i.test(t)) return;
        var flags = [];
        if (/cancel/i.test(t)) flags.push('CANCELLED — confirm & clear the slot');
        else if (/tentative/i.test(t)) flags.push('tentative — confirm the time');
        else if (!/confirmed/i.test(t)) flags.push('needs a reminder call');
        if (/reminder txt sch/i.test(t)) flags.push('reminder text scheduled');
        if (!flags.length) return;
        R.fieldCalls.push({tech: fc[0],
          when: Utilities.formatDate(ev.getStartTime(), 'America/Denver', 'EEE h:mm a'),
          title: t.slice(0, 70), flag: flags.join(' · ')});
      });
    });
    R.fieldCalls = R.fieldCalls.slice(0, 14);
  } catch (e) {}

  // waiting on… + check-back hygiene
  R.waiting = [];
  pianos.forEach(function (p) {
    if (!/^waiting/i.test(String(p.phase || ''))) return;
    var cb = String(p.checkBack || '').trim();
    var state = 'ok', days = null;
    if (!cb) state = 'missing';
    else {
      var d = new Date(cb);
      if (isNaN(d.getTime())) state = 'missing';
      else {
        days = Math.floor((Date.now() - d.getTime()) / 86400000);
        if (days > 0) state = 'overdue';
        else if (days === 0) state = 'today';
      }
    }
    R.waiting.push({p: p, on: p.waitNote || String(p.phase).replace(/^Waiting on /i, ''),
                    cb: cb, state: state, days: days});
  });
  R.waiting.sort(function (a, b) {
    var rank = {overdue: 0, missing: 1, today: 2, ok: 3};
    return rank[a.state] - rank[b.state];
  });

  // stalled: in one work phase longer than its standard
  R.stalled = [];
  pianos.forEach(function (p) {
    if (!smIsShopwork_(p) || !smIsWorkPhase_(p.phase)) return;
    var lim = SM_PHASE_DAYS[p.phase];
    var age = smDaysSince_(p.entered);
    if (lim && age !== null && age > lim * 2) {
      R.stalled.push({p: p, age: age, lim: lim});
    }
  });
  R.stalled.sort(function (a, b) { return b.age - a.age; });

  // open numbered spots -> next up in the queue (a recommendation to approve)
  var taken = {};
  pianos.forEach(function (p) {
    if (p.isSlot) taken[String(p.location).toLowerCase()] = true;
  });
  var open = [];
  (slots.floors || []).forEach(function (f, fi) {
    (f.slots || []).forEach(function (s) {
      var id = String(s.id || s.slot || '').toLowerCase();
      if (id && !taken[id]) open.push({id: s.id || s.slot, floor: fi + 1});
    });
  });
  R.openSpots = open;
  R.queueUp = pianos.filter(function (p) {
    return p.queuePos && !p.isSlot && smIsShopwork_(p);
  }).sort(function (a, b) { return a.queuePos - b.queuePos; }).slice(0, Math.max(3, open.length));

  // data gaps
  R.noMap = pianos.filter(function (p) {
    return smIsShopwork_(p) && !p.isSlot && !/coming soon|david hyde|attic/i.test(p.location || '');
  });
  R.noTrack = pianos.filter(function (p) {
    return smIsShopwork_(p) && !String(p.track || '').trim();
  });
  R.noPhase = pianos.filter(function (p) {
    return smIsShopwork_(p) && p.isSlot && !String(p.phase || '').trim();
  });
  R.noCab = pianos.filter(function (p) {
    return smIsShopwork_(p) && smPhaseIdx_(p.phase) >= 3 && smPhaseIdx_(p.phase) <= 12
      && !String(p.cabinetry || '').trim();
  });
  R.noAddress = pianos.filter(function (p) {
    return smIsShopwork_(p) && !smHasPlace_(p);
  });

  // media
  R.mediaBefore = pianos.filter(function (p) {
    return smIsShopwork_(p) && (p.bphoto === false || p.bvideo === false);
  });
  R.exitBlocked = pianos.filter(function (p) {
    var i = smPhaseIdx_(p.phase);
    return smIsShopwork_(p) && i >= 10 && i <= 12
      && (p.aphoto === false || p.avideo === false);
  });

  // admin + payments
  // every queue piano without a payment plan (Brigham 8/26) — the ones past
  // 25% complete are the urgent tail (milestone emails stay off without one)
  R.noPlan = pianos.filter(function (p) {
    return smIsShopwork_(p) && !String(p.payPlan || '').trim();
  }).map(function (p) { return {p: p, urgent: smProgress_(p) >= 25}; })
    .sort(function (a, b) { return (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0); });
  R.adminDrift = [];
  pianos.forEach(function (p) {
    if (!smIsShopwork_(p)) return;
    var steps = String(p.adminSteps || '').split('|').map(function (s) { return s.trim(); });
    var i = smPhaseIdx_(p.phase);
    var want = [];
    if (i >= 1 && steps.indexOf('$1000 Queue Payment') < 0) want.push('$1000 Queue Payment');
    if (i >= 2 && steps.indexOf('Welcome Email') < 0) want.push('Welcome Email');
    if (i >= 2 && steps.indexOf('Before Photos') < 0) want.push('Before Photos');
    if (smProgress_(p) >= 50 && steps.indexOf('Upsell Offers — Brigham Call (after 50%)') < 0) {
      want.push('Upsell call (50%+)');
    }
    if (i >= 12 && steps.indexOf('100% Payment Collected Prior to Delivery') < 0) {
      want.push('100% payment');
    }
    if (want.length) R.adminDrift.push({p: p, want: want});
  });

  R.stalePhases = smStalePhases_(pianos);
  R.missingArrivals = smMissingArrivals_(pianos, data.events || []);

  R.soldPending = pianos.filter(function (p) {
    return /sold or completed but not delivered/i.test(p.section || '');
  });

  // housekeeping (what the old daily report covered)
  R.unplaced = pianos.filter(function (p) {
    return !p.isSlot && !/coming soon/i.test(p.location || '');
  });
  var bySlot = {};
  pianos.forEach(function (p) {
    if (!p.isSlot) return;
    var k = String(p.location).toLowerCase();
    (bySlot[k] = bySlot[k] || []).push(p);
  });
  R.dupSpots = [];
  for (var k in bySlot) { if (bySlot[k].length > 1) R.dupSpots.push({spot: k, list: bySlot[k]}); }

  R.moves = (data.events || []).filter(function (e) {
    return String(e.date || e.start || '').slice(0, 10) === today;
  });
  R.total = pianos.length;
  R.standup = smStandup_(pianos, R);
  return R;
}

function smTocId_(title) {
  return 'sec-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}
function shopManagerHtml_(R) {
  var H = [];
  var TOC = [];
  function sec(icon, title, count, note) {
    var id = smTocId_(title);
    TOC.push({id: id, label: icon + ' ' + title});
    H.push('<h2 id="' + id + '" style="font:700 13px/1.4 Helvetica,Arial,sans-serif;letter-spacing:1.5px;'
      + 'text-transform:uppercase;color:#6f6a63;background:#f4f1ec;border-left:4px solid #9e2020;'
      + 'margin:22px 0 8px;padding:7px 11px">' + icon + ' ' + title
      + (count != null ? ' <span style="color:#9e2020">(' + count + ')</span>' : '') + '</h2>');
    if (note) H.push('<p style="margin:0 0 8px;font:12px Helvetica,Arial;color:#8a847b">' + note + '</p>');
  }
  function ul(items) {
    H.push('<ul style="margin:0 0 4px;padding-left:18px;font:13px/1.65 Helvetica,Arial;color:#2b2f33">'
      + items.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>');
  }
  function pill(t, bg, fg) {
    return '<span style="background:' + bg + ';color:' + fg + ';border-radius:4px;'
      + 'padding:1px 6px;font-size:11px;font-weight:700">' + t + '</span>';
  }
  function ref(p) {
    return '<b>' + smName_(p) + '</b> <span style="color:#8a847b">· map #' + smSpot_(p)
      + (p.serial ? ' · ' + p.serial : '') + '</span>';
  }

  H.push('<div style="max-width:760px;margin:0 auto;font-family:Helvetica,Arial,sans-serif">');
  H.push('<div style="text-align:center;background:#faf8f4;border:1.5px solid #121212;border-bottom:none;'
    + 'border-radius:8px 8px 0 0;padding:16px 18px 12px">'
    + '<img src="' + APP_URL + '/assets/blp-logo.png" alt="Brigham Larson Pianos" '
    +   'style="max-height:30px;max-width:140px">'
    + '<div style="font:700 12px Helvetica,Arial,sans-serif;letter-spacing:3.5px;color:#9e2020;margin-top:10px">'
    +   'SHOP MANAGER BRIEFING</div>'
    + '<div style="font:700 15px Helvetica,Arial,sans-serif;color:#2b2f33;margin-top:5px">' + R.day + '</div>'
    + '<div style="width:64px;height:3px;background:#c9a227;margin:10px auto 0;border-radius:2px"></div>'
    + '</div>');
  H.push('<div style="border:1.5px solid #121212;border-top:none;border-radius:0 0 8px 8px;padding:16px 18px">');

  // "Jump to a section" — spliced in below once every section (and its id)
  // has been rendered, so the links always match a real anchor
  var tocInsertAt = H.length;

  // ---------- Morning Standup — first thing the 8AM huddle reads ----------
  var SU = R.standup || {};
  TOC.push({id: 'sec-morning-standup', label: '🌅 Morning Standup'});
  H.push('<div id="sec-morning-standup" style="background:#faf8f4;border:1px solid #e6dfd2;border-radius:10px;padding:14px 16px;margin:2px 0 18px">');
  H.push('<div style="font:800 13px Helvetica,Arial;letter-spacing:2px;color:#9e2020;margin-bottom:10px">'
    + '🌅 MORNING STANDUP · 8AM</div>');
  function su(icon, label, lines) {
    if (!lines || !lines.length) return;
    H.push('<div style="margin:0 0 10px"><div style="font:700 12px Helvetica,Arial;color:#6f6a63;'
      + 'letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">' + icon + ' ' + label + '</div>'
      + '<ul style="margin:0;padding-left:18px;font:13px/1.6 Helvetica,Arial;color:#2b2f33">'
      + lines.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></div>');
  }
  su('🎂', 'Birthdays', (SU.bdays || []).map(function (b) {
    return '<b>' + b.name + '</b> — ' + b.when + (b.age ? ' <span style="color:#8a847b">(turning ' + b.age + ')</span>' : '');
  }));
  su('🥂', 'Upcoming work anniversaries', (SU.annivs || []).map(function (a) {
    return '<b>' + a.name + '</b> — ' + a.years + ' year' + (a.years > 1 ? 's' : '') + ' at BLP (' + a.when + ')';
  }));
  su('👋', 'Welcome the new faces', (SU.newFaces || []).map(function (n) {
    return '<b>' + n.name + '</b>' + (n.pos ? ' — ' + n.pos : '')
      + ' <span style="color:#8a847b">(day ' + (n.days + 1) + ')</span>';
  }));
  su('🚚', 'Celebrate — finished & delivered', (SU.delivered || []).map(function (d) {
    return '<b>' + d.piano + '</b> left the shop yesterday <span style="color:#8a847b">(logged by ' + d.who + ')</span> 🎉';
  }));
  su('🤝', 'Teamwork spotlight', (SU.teamwork || []).map(function (t) {
    return '<b>' + t.piano + '</b> (' + t.why + ') — built by <b>' + t.techs.length + ' techs</b>: '
      + t.techs.join(', ') + '. Take a bow.';
  }));
  var champLines = [];
  if (SU.champ) champLines.push('<b>' + SU.champ.tech + '</b> led the Work Clock yesterday — '
    + SU.champ.hours + ' h across ' + SU.champ.pianos + (SU.champ.pianos === 1 ? ' piano' : ' pianos') + ' 🏆');
  (SU.personalBests || []).forEach(function (pb) {
    if (SU.champ && pb.tech === SU.champ.tech) return;
    champLines.push('<b>' + pb.tech + '</b> set a personal-best day — ' + pb.hours + ' h logged 📈');
  });
  su('🏆', 'Work Clock wins', champLines);
  su('🛡', 'Safety minute', SU.safety ? ['<i>' + SU.safety + '</i>'] : []);
  su('⭐', 'Standard of the day', SU.standard ? ['<i>' + SU.standard + '</i>'
    + ' <a href="https://blpshop.netlify.app/#policies-stime-management" '
    + 'style="color:#9e2020;font-size:12px;white-space:nowrap">full standards ↗</a>'] : []);
  su('🎯', 'Today’s focus', SU.focus || []);
  H.push('</div>');

  // page 2 starts here — every other section's header lands on its own page
  H.push('<div style="page-break-before:always;height:0;margin:0;padding:0;line-height:0">&nbsp;</div>');

  // at a glance
  var alerts = R.blocked.length + R.noCab.length + R.noTrack.length + R.noPhase.length;
  H.push('<p style="font:13px/1.6 Helvetica,Arial;color:#2b2f33;margin:0 0 4px">'
    + '<b>' + R.activity.total + '</b> changes logged since yesterday · '
    + '<b>' + R.moves.length + '</b> moves today · '
    + '<b style="color:' + (alerts ? '#9e2020' : '#2e7d4f') + '">' + alerts + '</b> items needing attention'
    + '</p>');

  sec('⏱', 'Hours clocked yesterday', R.clockedTotal + ' h',
    'From the per-piano Work Clock. Live status and job costing: Shop Manager → Shop Board.');
  if (R.clocked && R.clocked.length) {
    ul(R.clocked.map(function (x) {
      return '<b>' + x.tech + '</b> — ' + x.hours + ' h across ' + x.pianos
        + (x.pianos === 1 ? ' piano' : ' pianos');
    }));
  } else {
    H.push('<p style="margin:0 0 8px;font:12.5px Helvetica,Arial;color:#8a847b">No punches yesterday — '
      + 'remind the team: the ⏱ Work Clock on every piano card (or scanning the shop tag) is how hours land in job costing.</p>');
  }
  if (R.appLive && R.appLive.length) {
    var LICON = {bug: '🐛', edit: '✏️', idea: '💡'};
    sec('🚀', 'New in the apps — announce these', R.appLive.length,
      'Fixes and features that went LIVE this week. Managers: mention these at the morning '
      + 'meeting and thank the requester by name; Tested means the requester confirmed it works.');
    ul(R.appLive.map(function (x) {
      return (LICON[x.type] || '💡') + ' ' + String(x.text).slice(0, 130)
        + ' <span style="color:#8a847b">(asked by <b>' + x.who + '</b>'
        + (x.context ? ', ' + x.context : '') + ')</span> '
        + pill(x.status, x.status === 'Tested' ? '#eaf5ec' : '#eaf2fd',
               x.status === 'Tested' ? '#2f7d4f' : '#2c5d96');
    }));
  }
  // print-ready batches — edit this list to add/remove links from the brief
  var PRINTABLES = [
    '<a href="https://blpsalesapp.netlify.app/.netlify/functions/request-shot?id=shoptagbatch-C9uY7E_uivhq">'
    + '115 shop tags — storage &amp; idle pianos (2 per page, ready to print)</a> '
    + '<span style="color:#8a847b">prepared 8/25</span>',
  ];
  if (PRINTABLES.length) {
    sec('📎', 'Printables', PRINTABLES.length, 'Print-ready batches — open, print, done.');
    ul(PRINTABLES);
  }
  if (R.clientReady && R.clientReady.length) {
    sec('🤝', 'Client reports ready to send', R.clientReady.length,
      'Opt-in client-report pianos with shop activity this week — review the draft and email it from the Shop Manager’s Client Reports page.');
    ul(R.clientReady.map(function (x) {
      return '<b>' + esc_(x.summary) + '</b> #' + esc_(x.serial) + (x.phase ? ' · ' + esc_(x.phase) : '');
    }));
  }
  if (R.fieldCalls && R.fieldCalls.length) {
    sec('📞', 'Field tunings — reminder calls & confirmations (next 2 days)', R.fieldCalls.length,
      'From McKinly’s and Curtis’s own calendars — call to confirm, or clear cancelled slots.');
    ul(R.fieldCalls.map(function (x) {
      return '<b>' + esc_(x.when) + '</b> · ' + esc_(x.tech) + ' · ' + esc_(x.title)
        + ' ' + pill(esc_(x.flag), '#fdf3ec', '#9a5b13');
    }));
  }
  if (R.suggestions && R.suggestions.length) {
    var SICON = {bug: '🐛', edit: '✏️', idea: '💡'};
    var SPILL = {'Requested': ['#eeeeee', '#555555'], 'In progress': ['#fdf3ec', '#9a5b13'],
                 'Live': ['#eaf2fd', '#2c5d96'], 'Tested': ['#eaf5ec', '#2f7d4f']};
    sec('💡', 'App suggestions this week', R.suggestions.length,
      'From the team via the Store Map\u2019s 💡 button \u2014 thank the names you see here.');
    ul(R.suggestions.map(function (x) {
      var c = SPILL[x.status] || SPILL.Requested;
      return '<b>' + x.who + '</b> \u2014 ' + (SICON[x.type] || '💡') + ' '
        + String(x.text).slice(0, 110) + ' ' + pill(x.status, c[0], c[1]);
    }));
  }
  if (R.activity.total) {
    sec('📋', 'Yesterday in the map', R.activity.total, 'Every change is logged under the name that made it.');
    var whos = [];
    for (var w in R.activity.byWho) {
      var list = R.activity.byWho[w];
      whos.push('<b>' + w + '</b> — ' + list.length + ' change' + (list.length > 1 ? 's' : '')
        + '<br><span style="color:#6f6a63;font-size:12px">'
        + list.slice(0, 8).map(function (a) {
            return a.t + ' · ' + a.action + (a.piano ? ' — ' + a.piano : '');
          }).join('<br>')
        + (list.length > 8 ? '<br>… and ' + (list.length - 8) + ' more' : '') + '</span>');
    }
    ul(whos);
  }

  if (R.advances.length) {
    sec('▶', 'Phase advances — is the next tech lined up?', R.advances.length);
    ul(R.advances.map(function (a) {
      return '<b>' + a.piano + '</b>' + (a.spot ? ' <span style="color:#8a847b">· map #' + a.spot + '</span>' : '')
        + '<br><span style="font-size:12px;color:#6f6a63">' + a.detail + ' — moved by ' + a.who + '</span>'
        + (a.goTo ? '<br>' + pill('GO-TO: ' + a.goTo, '#eef4ff', '#2b5fa8') : '');
    }));
  }

  if (R.blocked.length) {
    sec('⛔', 'Blocked — concurrent work not finished', R.blocked.length,
      'These pianos are at or past the phase where the task below was due.');
    ul(R.blocked.map(function (b) {
      return ref(b.p) + '<br>' + pill('IN ' + (b.p.phase || '—'), '#fdf3ec', '#8a6a00')
        + ' <span style="font-size:12px;color:#9e2020">outstanding: ' + b.tasks.join(', ') + '</span>';
    }));
  }

  if (R.waiting.length) {
    sec('⏳', 'Waiting on…', R.waiting.length, 'Overdue and missing check-back dates first.');
    ul(R.waiting.map(function (w) {
      var tag = w.state === 'overdue'
          ? pill('CHECK BACK ' + w.days + 'd OVERDUE', '#fbeaea', '#9e2020')
        : w.state === 'missing' ? pill('NO CHECK-BACK DATE', '#fdf3ec', '#8a6a00')
        : w.state === 'today' ? pill('CHECK BACK TODAY', '#eef4ff', '#2b5fa8')
        : '<span style="font-size:12px;color:#8a847b">check back ' + w.cb + '</span>';
      return ref(w.p) + '<br><span style="font-size:12px;color:#6f6a63">waiting on ' + w.on
        + '</span> ' + tag;
    }));
  }

  // (the 🐢 "sitting longer than the standard" list moved to its own
  //  Store Map report — linked in the footer below)

  if (R.openSpots.length && R.queueUp.length) {
    sec('🔄', 'Open spots — next up in the queue', null,
      R.openSpots.length + ' numbered spot' + (R.openSpots.length > 1 ? 's are' : ' is')
      + ' free. Recommended for the in-store moves list — approve before scheduling.');
    ul(R.queueUp.map(function (p) {
      return pill('QUEUE #' + p.queuePos, '#f0f2f4', '#5a626a') + ' ' + ref(p)
        + '<br><span style="font-size:12px;color:#6f6a63">currently: ' + (p.location || '—')
        + (p.track ? ' · track: ' + p.track : ' · <b style="color:#9e2020">no track set</b>') + '</span>';
    }));
    H.push('<p style="font:12px Helvetica,Arial;color:#8a847b;margin:2px 0 0">Open: '
      + R.openSpots.slice(0, 30).map(function (s) { return '#' + s.id; }).join(', ')
      + (R.openSpots.length > 30 ? ' …' : '') + '</p>');
  }

  var gaps = [];
  if (R.noMap.length) gaps.push('<b>' + R.noMap.length + '</b> shop-work pianos with <b>no map number</b>: '
    + R.noMap.slice(0, 8).map(smName_).join('; '));
  if (R.noPhase.length) gaps.push('<b>' + R.noPhase.length + '</b> on the map with <b>no shop phase</b>: '
    + R.noPhase.slice(0, 8).map(function (p) { return smName_(p) + ' (#' + smSpot_(p) + ')'; }).join('; '));
  if (R.noTrack.length) gaps.push('<b>' + R.noTrack.length + '</b> with <b>no track</b> — phases can\'t be planned: '
    + R.noTrack.slice(0, 8).map(smName_).join('; '));
  if (R.noCab.length) gaps.push('<b>' + R.noCab.length + '</b> past PRSB with <b>no cabinetry shelf</b> recorded: '
    + R.noCab.slice(0, 8).map(function (p) { return smName_(p) + ' (#' + smSpot_(p) + ')'; }).join('; '));
  if (gaps.length) { sec('⚠️', 'Data gaps', null, 'Small fixes that keep the map and reports honest.'); ul(gaps); }

  if (R.soldPending.length) {
    sec('✓', 'Sold / completed — awaiting delivery', R.soldPending.length,
      'Gold ring on the map. Do not re-sell or re-price these.');
    ul(R.soldPending.map(function (p) { return ref(p); }));
  }

  if (R.missingArrivals.length) {
    sec('\ud83d\ude9a', 'Arrivals with no Piano Log row', R.missingArrivals.length,
      'The moving calendar is picking these up, but no owner cell matches the client \u2014 add a Coming Soon row so they land on the map when they arrive.');
    ul(R.missingArrivals.map(function (a) {
      return '<b>' + a.name + '</b> \u2014 ' + a.date
        + ' <span style="font-size:12px;color:#6f6a63">\u201c' + a.summary + '\u201d</span>';
    }));
  }

  if (R.stalePhases.length) {
    sec('\ud83d\udd04', 'Phase looks stale vs Friday reports', R.stalePhases.length,
      'A recent report says this phase is finished, but the map still shows the piano in it \u2014 advance the phase so scheduling doesn\u2019t re-assign done work.');
    ul(R.stalePhases.map(function (sp) {
      return ref(sp.p) + '<br>' + pill('MAP SAYS: ' + sp.p.phase, '#fdf3ec', '#8a6a00')
        + ' <span style="font-size:12px;color:#6f6a63">report: \u201c' + sp.quote + '\u2026\u201d</span>';
    }));
  }

  if (R.activity.dups.length) {
    sec('🗑', 'Marked duplicate yesterday', R.activity.dups.length,
      'Review — restoring is one click in Reports → Marked Duplicates.');
    ul(R.activity.dups.map(function (d) { return '<b>' + d.piano + '</b> — by ' + d.who; }));
  }

  if (R.unplaced.length || R.dupSpots.length) {
    sec('🧹', 'Housekeeping', R.unplaced.length + R.dupSpots.length);
    var h = [];
    if (R.unplaced.length) h.push('<b>' + R.unplaced.length + '</b> pianos not on a numbered spot');
    if (R.dupSpots.length) h.push('<b>' + R.dupSpots.length + '</b> spots with more than one piano: '
      + R.dupSpots.slice(0, 10).map(function (d) { return '#' + d.spot; }).join(', '));
    ul(h);
  }

  // all Store Map reports, numbered + linked, with live counts where we have them
  var RPT_LINKS = [
    ['briefs', '📰 Daily Shop Briefs', null],
    ['queue', '🎹 Shop Queue', null],
    ['tasks', '🧩 Concurrent Work', null],
    ['stalled', '🐢 Sitting Too Long', R.stalled.length],
    ['unplaced', '⚠️ Unplaced Pianos', R.unplaced.length],
    ['dups', '🔁 Duplicate Spot Numbers', R.dupSpots.length],
    ['stage', '🔧 Missing Shop Stage', null],
    ['media', '📸 Media Needed', null],
    ['cabinetry', '🗄 Cabinetry', null],
    ['duplicates', '🗑 Marked Duplicates', null],
    ['waiting', '⏳ Waiting On', R.waiting.length],
    ['activity', '📝 Activity Log', null]
  ];
  sec('📚', 'All Store Map reports', null,
    'Tap any report to open it directly — each has filters, share (↗), and print.');
  H.push('<ol style="margin:0 0 4px;padding-left:22px;font:13px/1.9 Helvetica,Arial;color:#2b2f33">'
    + RPT_LINKS.map(function (r0) {
        return '<li><a href="' + APP_URL + '/#report=' + r0[0] + '" style="color:#9e2020;font-weight:700">'
          + r0[1] + '</a>' + (r0[2] ? ' <span style="color:#8a847b">(' + r0[2] + ')</span>' : '') + '</li>';
      }).join('') + '</ol>');

  H.push('<p style="margin:22px 0 0;padding-top:10px;border-top:1px solid #e4e0d8;'
    + 'font:11.5px Helvetica,Arial;color:#8a847b">Generated from the live Store Map · '
    + '<a href="' + APP_URL + '" style="color:#9e2020">open the map</a> · '
    + R.total + ' active pianos</p>');
  H.push('</div></div>');

  // now that every section (and its anchor) is known, splice the jump-links
  // bar in at the top — right after the header, right before Morning Standup
  H.splice(tocInsertAt, 0, smTocHtml_(TOC, '#9e2020', '#faf4f0', '#f0dede'));
  return H.join('');
}
function smTocHtml_(TOC, color, bg, border) {
  if (!TOC.length) return '';
  return '<div style="background:#fff;border:1px solid #e4e0d8;border-radius:8px;padding:12px 16px;margin:0 0 16px">'
    + '<div style="font:700 11px Helvetica,Arial;letter-spacing:1.5px;text-transform:uppercase;'
    + 'color:#8a847b;margin-bottom:8px">Jump to a section</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:7px">'
    + TOC.map(function (t) {
        return '<a href="#' + t.id + '" style="font:12px Helvetica,Arial;color:' + color
          + ';text-decoration:none;background:' + bg + ';border:1px solid ' + border
          + ';border-radius:999px;padding:4px 10px;white-space:nowrap">' + t.label + '</a>';
      }).join('') + '</div></div>';
}

/* Every briefing is also saved as a Google Doc (Drive REST convert) in a
 * "BLP Shop Briefs" folder, link-shared, and logged to the report sheet's
 * "Brief Log" tab — the Store Map's Daily Briefs report lists those links. */
function briefDoc_(subject, html, kind) {
  var it = DriveApp.getFoldersByName('BLP Shop Briefs');
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder('BLP Shop Briefs');
  var meta = {name: subject, mimeType: 'application/vnd.google-apps.document',
              parents: [folder.getId()]};
  var boundary = 'blpbrief' + Date.now();
  var body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'
    + JSON.stringify(meta)
    + '\r\n--' + boundary + '\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n'
    + html + '\r\n--' + boundary + '--';
  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'post',
    contentType: 'multipart/related; boundary=' + boundary,
    payload: body,
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
  });
  var f = JSON.parse(res.getContentText());
  shareAnyoneWithLink_(f.id);
  var url = f.webViewLink || ('https://docs.google.com/document/d/' + f.id + '/edit');
  var ss = SpreadsheetApp.openById('11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I');
  var sh = ss.getSheetByName('Brief Log');
  if (!sh) {
    sh = ss.insertSheet('Brief Log', ss.getSheets().length);
    sh.getRange(1, 1, 1, 4).setValues([['Date', 'Subject', 'Doc URL', 'Kind']]);
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date().toISOString(), subject, url, kind || 'shop']);
  return url;
}
function briefLog_() {
  var ss = SpreadsheetApp.openById('11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I');
  var sh = ss.getSheetByName('Brief Log');
  var out = [];
  if (sh && sh.getLastRow() >= 2) {
    var n = Math.min(60, sh.getLastRow() - 1);
    var vals = sh.getRange(sh.getLastRow() - n + 1, 1, n, 4).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      var subj = String(vals[i][1]);
      // rows written before the Kind column existed: sniff the subject
      var kind = String(vals[i][3] || '').toLowerCase();
      if (kind !== 'shop' && kind !== 'admin') kind = /admin/i.test(subj) ? 'admin' : 'shop';
      out.push({date: String(vals[i][0]), subject: subj, url: String(vals[i][2]), kind: kind});
    }
  }
  return {ok: true, briefs: out};
}

/* ---------- Admin Morning Brief — payments, media, delivery logistics ---------- */
function adminBriefHtml_(R) {
  var H = [];
  var TOC = [];
  function sec(icon, title, count, note) {
    var id = smTocId_(title);
    TOC.push({id: id, label: icon + ' ' + title});
    H.push('<h2 id="' + id + '" style="font:700 13px/1.4 Helvetica,Arial,sans-serif;letter-spacing:1.5px;'
      + 'text-transform:uppercase;color:#6f6a63;background:#f4f1ec;border-left:4px solid #2c5d96;'
      + 'margin:22px 0 8px;padding:7px 11px">' + icon + ' ' + title
      + (count != null ? ' <span style="color:#2c5d96">(' + count + ')</span>' : '') + '</h2>');
    if (note) H.push('<p style="margin:0 0 8px;font:12px Helvetica,Arial;color:#8a847b">' + note + '</p>');
  }
  function ul(items) {
    H.push('<ul style="margin:0 0 4px;padding-left:18px;font:13px/1.65 Helvetica,Arial;color:#2b2f33">'
      + items.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>');
  }
  function ref(p) {
    return '<b>' + smName_(p) + '</b> <span style="color:#8a847b">· map #' + smSpot_(p)
      + (p.serial ? ' · ' + p.serial : '') + '</span>';
  }
  H.push('<div style="max-width:760px;margin:0 auto;font-family:Helvetica,Arial,sans-serif">');
  H.push('<div style="text-align:center;background:#f4f7fb;border:1.5px solid #121212;border-bottom:none;'
    + 'border-radius:8px 8px 0 0;padding:16px 18px 12px">'
    + '<img src="' + APP_URL + '/assets/blp-logo.png" alt="Brigham Larson Pianos" '
    +   'style="max-height:30px;max-width:140px">'
    + '<div style="font:700 12px Helvetica,Arial,sans-serif;letter-spacing:3.5px;color:#2c5d96;margin-top:10px">'
    +   'ADMIN MORNING BRIEFING</div>'
    + '<div style="font:700 15px Helvetica,Arial,sans-serif;color:#2b2f33;margin-top:5px">' + R.day + '</div>'
    + '<div style="width:64px;height:3px;background:#c9a227;margin:10px auto 0;border-radius:2px"></div>'
    + '</div>');
  H.push('<div style="border:1.5px solid #121212;border-top:none;border-radius:0 0 8px 8px;padding:16px 18px">');
  var tocInsertAt = H.length;

  if (R.noPlan.length || R.adminDrift.length) {
    sec('💰', 'Admin & payments', R.noPlan.length + R.adminDrift.length);
    var a = [];
    if (R.noPlan.length) a.push('<b style="color:#9e2020">' + R.noPlan.length
      + ' queue pianos with no payment plan set</b> (bold = past 25% complete — milestone emails stay off until one is chosen):<br>'
      + '<span style="font-size:12px">' + R.noPlan.slice(0, 15).map(function (x) {
          var nm = smName_(x.p) + ' (#' + smSpot_(x.p) + ')';
          return x.urgent ? '<b>' + nm + '</b>' : nm; }).join('; ') + '</span>');
    R.adminDrift.slice(0, 10).forEach(function (d) {
      a.push(ref(d.p) + '<br><span style="font-size:12px;color:#8a6a00">admin steps not checked: '
        + d.want.join(', ') + '</span>');
    });
    ul(a);
  }

  if (R.mediaBefore.length || R.exitBlocked.length) {
    sec('📷', 'Media', R.mediaBefore.length + R.exitBlocked.length);
    var m = [];
    if (R.exitBlocked.length) m.push('<b style="color:#9e2020">Exit blocked — at QC or later, after media missing:</b><br>'
      + '<span style="font-size:12px">' + R.exitBlocked.slice(0, 10).map(function (p) {
          return smName_(p) + ' (#' + smSpot_(p) + ')'; }).join('; ') + '</span>');
    if (R.mediaBefore.length) m.push('<b>' + R.mediaBefore.length + '</b> shop-work pianos still need before photos/video');
    ul(m);
  }

  if (R.noAddress.length) {
    sec('📍', 'No delivery address found', R.noAddress.length,
      'The Shop Work Map can\'t pin these — add a "City, ST" to the owner cell in the Piano Log.');
    ul(R.noAddress.slice(0, 15).map(function (p) { return ref(p); }));
  }

  if (R.soldPending.length) {
    sec('✓', 'Sold / completed — awaiting delivery', R.soldPending.length,
      'Gold ring on the map. Do not re-sell or re-price these.');
    ul(R.soldPending.map(function (p) { return ref(p); }));
  }

  if (R.missingArrivals.length) {
    sec('🚚', 'Arrivals with no Piano Log row', R.missingArrivals.length,
      'The moving calendar is picking these up, but no owner cell matches the client — add a Coming Soon row so they land on the map when they arrive.');
    ul(R.missingArrivals.map(function (a0) {
      return '<b>' + a0.name + '</b> — ' + a0.date
        + ' <span style="font-size:12px;color:#6f6a63">“' + a0.summary + '”</span>';
    }));
  }

  sec('📚', 'Deep dives', null, 'Tap to open the live report — each has filters, share (↗), and print.');
  ul([
    '<a href="' + APP_URL + '/#report=media" style="color:#2c5d96;font-weight:700">📸 Media Needed</a>',
    '<a href="' + APP_URL + '/#report=waiting" style="color:#2c5d96;font-weight:700">⏳ Waiting On</a>',
    '<a href="' + APP_URL + '/#report=activity" style="color:#2c5d96;font-weight:700">📝 Activity Log</a>',
    '<a href="' + APP_URL + '/#report=briefs" style="color:#2c5d96;font-weight:700">📰 Daily Shop Briefs</a>'
  ]);

  H.push('<p style="margin:22px 0 0;padding-top:10px;border-top:1px solid #e4e0d8;'
    + 'font:11.5px Helvetica,Arial;color:#8a847b">Generated from the live Store Map · '
    + '<a href="' + APP_URL + '" style="color:#2c5d96">open the map</a> · '
    + R.total + ' active pianos</p>');
  H.push('</div></div>');
  H.splice(tocInsertAt, 0, smTocHtml_(TOC, '#2c5d96', '#f0f4fa', '#dbe6f2'));
  return H.join('');
}
function adminAlerts_(R) {
  return R.noPlan.length + R.adminDrift.length + R.mediaBefore.length + R.exitBlocked.length
    + R.noAddress.length + R.soldPending.length + R.missingArrivals.length;
}

/* Everything the Store Map's My Dashboard needs for one technician,
 * computed from the Time Log (365 days) + the team sheet. Matched by name
 * the same way the Work Clock stores it. */
function techDash_(name) {
  var norm = name.trim().toLowerCase();
  var first = norm.split(/\s+/)[0];
  if (!first) return {ok: false, error: 'no name'};
  var rows = (timeLogRows_(365).rows || []).filter(function (r) {
    var t = r.tech.trim().toLowerCase();
    return t === norm || t.split(/\s+/)[0] === first;
  });

  // per-piano rollup, newest first
  var byPiano = {}, order = [];
  rows.forEach(function (r) {
    if (!r.serial) return;
    if (!byPiano[r.serial]) { byPiano[r.serial] = {serial: r.serial, piano: r.piano, phases: {}, minutes: 0, last: ''}; order.push(r.serial); }
    var b = byPiano[r.serial];
    b.minutes += r.minutes;
    if (r.phase) b.phases[r.phase] = true;
    if (r.start > b.last) b.last = r.start;
  });
  var pianos = order.map(function (k) {
    var b = byPiano[k];
    return {serial: b.serial, piano: b.piano, phases: Object.keys(b.phases).join(' · '),
            hours: Math.round(b.minutes / 6) / 10, last: b.last};
  }).sort(function (a, b) { return b.last < a.last ? -1 : 1; });

  // PRs: best day, best week, most pianos in a week, longest session
  var perDay = {}, perWeek = {}, weekPianos = {}, longest = null;
  rows.forEach(function (r) {
    var d = Utilities.formatDate(new Date(r.start), 'America/Denver', 'yyyy-MM-dd');
    var w = Utilities.formatDate(new Date(r.start), 'America/Denver', 'YYYY-ww');
    perDay[d] = (perDay[d] || 0) + r.minutes;
    perWeek[w] = (perWeek[w] || 0) + r.minutes;
    (weekPianos[w] = weekPianos[w] || {})[r.serial] = true;
    if (!longest || r.minutes > longest.minutes) longest = r;
  });
  function best(map) {
    var bk = null, bv = 0;
    for (var k in map) { if (map[k] > bv) { bv = map[k]; bk = k; } }
    return bk ? {when: bk, minutes: bv} : null;
  }
  var bDay = best(perDay), bWeek = best(perWeek);
  var bWkP = null;
  for (var wk in weekPianos) {
    var n = Object.keys(weekPianos[wk]).length;
    if (!bWkP || n > bWkP.n) bWkP = {when: wk, n: n};
  }
  var today = Utilities.formatDate(new Date(), 'America/Denver', 'yyyy-MM-dd');
  var prs = {
    bestDayH: bDay ? Math.round(bDay.minutes / 6) / 10 : 0,
    bestDayWhen: bDay ? bDay.when : '',
    bestWeekH: bWeek ? Math.round(bWeek.minutes / 6) / 10 : 0,
    mostPianosWeek: bWkP ? bWkP.n : 0,
    longestSessionH: longest ? Math.round(longest.minutes / 6) / 10 : 0,
    longestSessionPhase: longest ? longest.phase : '',
    todayH: Math.round((perDay[today] || 0) / 6) / 10,
    pianosTouched: pianos.length,
  };

  // anniversary + tenure + work title from the team sheet (start date only leaves here)
  var anniv = null;
  var title = '';
  try {
    var ts = SpreadsheetApp.openById('1j1FP78rRj1jrl2z-_vIg95kN3GuG8TI4dpOheSnIoPc')
      .getSheetByName('Current Team');
    var tv = ts.getRange(2, 1, Math.max(1, ts.getLastRow() - 1), 7).getValues();
    for (var i = 0; i < tv.length; i++) {
      if (String(tv[i][0] || '').trim().toLowerCase() !== first) continue;
      title = String(tv[i][3] || '').trim();   // Position column
      var st = tv[i][6];
      var sd = (st instanceof Date) ? st : null;
      if (!sd) {
        var pm = smParseMonthDay_(st);
        if (pm && pm.y) sd = new Date(pm.y, pm.mo - 1, pm.d);
      }
      if (sd) {
        var now = new Date();
        var next = new Date(now.getFullYear(), sd.getMonth(), sd.getDate());
        if (next < now) next = new Date(now.getFullYear() + 1, sd.getMonth(), sd.getDate());
        anniv = {years: next.getFullYear() - sd.getFullYear(),
                 days: Math.ceil((next - now) / 86400000),
                 date: Utilities.formatDate(next, 'America/Denver', 'MMM d')};
      }
      break;
    }
  } catch (e) {}

  return {ok: true, name: name, title: title, pianos: pianos.slice(0, 250), prs: prs, anniv: anniv};
}

/* The 7:50 AM standup text: today's celebration lines, the safety/standard
 * prompts, and a link to last night's archived brief. Deliberately light —
 * no piano-data fetch, so it answers in a second. */
function briefSms_() {
  var now = new Date();
  var R = {refDate: now, activity: {phases: []}, moves: [], clocked: [],
           queueUp: [], waiting: []};
  // yesterday's clock leader, so the text can name a win
  try {
    var yd = Utilities.formatDate(new Date(now.getTime() - 86400000), 'America/Denver', 'yyyy-MM-dd');
    var per = {};
    (timeLogRows_(3).rows || []).forEach(function (r0) {
      if (Utilities.formatDate(new Date(r0.start), 'America/Denver', 'yyyy-MM-dd') !== yd) return;
      if (!per[r0.tech]) per[r0.tech] = {min: 0, pianos: {}};
      per[r0.tech].min += (r0.minutes || 0);
      per[r0.tech].pianos[r0.serial] = 1;
    });
    R.clocked = Object.keys(per).map(function (t) {
      return {tech: t, hours: Math.round(per[t].min / 6) / 10, pianos: Object.keys(per[t].pianos).length};
    }).sort(function (a, b) { return b.hours - a.hours; });
  } catch (e) {}

  var SU = smStandup_([], R);
  var L = [];
  L.push('BLP Standup 8AM - ' + Utilities.formatDate(now, 'America/Denver', 'EEE MMM d'));
  (SU.bdays || []).filter(function (b) { return b.off === 0; }).forEach(function (b) {
    L.push('BIRTHDAY: ' + b.name + (b.age ? ' turns ' + b.age : '') + ' - celebrate it!');
  });
  (SU.annivs || []).filter(function (a) { return a.off === 0; }).forEach(function (a) {
    L.push('ANNIVERSARY: ' + a.name + ' - ' + a.years + ' yr' + (a.years > 1 ? 's' : '') + ' at BLP');
  });
  (SU.newFaces || []).filter(function (n) { return n.days <= 7; }).forEach(function (n) {
    L.push('WELCOME: ' + n.name + (n.pos ? ' (' + n.pos + ')' : '') + ', day ' + (n.days + 1));
  });
  if (SU.champ) L.push('Clock leader yesterday: ' + SU.champ.tech + ' - ' + SU.champ.hours + ' h');
  if (SU.safety) L.push('Safety: ' + SU.safety);
  if (SU.standard) L.push('Standard: ' + SU.standard);

  // last night's shop brief, so the full detail is one tap away
  var url = '';
  try {
    var briefs = (briefLog_().briefs || []).filter(function (b) { return b.kind === 'shop'; });
    if (briefs.length) url = briefs[0].url;
  } catch (e) {}
  if (url) L.push('Full brief: ' + url);
  return {ok: true, text: L.join('\n'), url: url, lines: L.length};
}

function sendShopManagerReportTo_(to, note, dayOffset) {
  var R = buildShopManagerReport_(dayOffset);
  var alerts = R.blocked.length + R.noCab.length + R.noTrack.length + R.noPhase.length;
  var html = shopManagerHtml_(R);
  if (note) {
    html = '<div style="max-width:760px;margin:0 auto 10px;padding:10px 14px;background:#fdf3ec;'
      + 'border:1px solid #eecfae;border-radius:8px;font:13px Helvetica,Arial;color:#6b5030">'
      + note + '</div>' + html;
  }
  var subject = (note ? '[SAMPLE] ' : '') + 'Shop Manager Briefing — ' + R.day
    + ' · ' + alerts + ' to review';
  var docUrl = '', docErr = '';
  try { docUrl = briefDoc_(subject, html, 'shop'); } catch (e) { docErr = String(e).slice(0, 200); }
  if (docUrl) {
    html = '<div style="max-width:760px;margin:0 auto 10px;text-align:right;font:12px Helvetica,Arial">'
      + '<a href="' + docUrl + '">📄 Open this briefing as a Google Doc</a></div>' + html;
  }
  MailApp.sendEmail({
    to: to,
    subject: subject,
    htmlBody: html,
    body: 'Shop Manager Briefing ' + R.day + '\n'
      + R.activity.total + ' changes logged, ' + alerts + ' items needing attention.\n'
      + 'Open in HTML for the full briefing.',
    name: 'BLP Store Map',
  });
  // the Admin Morning Brief rides the same build — payments, media, logistics
  var adm = {sent: false};
  if (!note) {
    try {
      var aHtml = adminBriefHtml_(R);
      var aAlerts = adminAlerts_(R);
      var aSubject = 'Admin Morning Briefing — ' + R.day + ' · ' + aAlerts + ' to review';
      var aDoc = '';
      try { aDoc = briefDoc_(aSubject, aHtml, 'admin'); } catch (e2) {}
      if (aDoc) {
        aHtml = '<div style="max-width:760px;margin:0 auto 10px;text-align:right;font:12px Helvetica,Arial">'
          + '<a href="' + aDoc + '">📄 Open this briefing as a Google Doc</a></div>' + aHtml;
      }
      MailApp.sendEmail({to: ADMIN_TO, subject: aSubject, htmlBody: aHtml,
        body: 'Admin Morning Briefing ' + R.day + ' — ' + aAlerts + ' items. Open in HTML.',
        name: 'BLP Store Map'});
      adm = {sent: true, to: ADMIN_TO, alerts: aAlerts, doc: aDoc};
    } catch (e3) { adm = {sent: false, err: String(e3).slice(0, 160)}; }
  }
  return {ok: true, to: to, alerts: alerts, changes: R.activity.total, doc: docUrl, docErr: docErr, admin: adm};
}
// build + archive today's brief as a Google Doc WITHOUT emailing (for testing
// and for regenerating a doc on demand)
function briefDocOnly_(dayOffset) {
  var R = buildShopManagerReport_(dayOffset);
  var alerts = R.blocked.length + R.noCab.length + R.noTrack.length + R.noPhase.length;
  var subject = 'Shop Manager Briefing — ' + R.day + ' · ' + alerts + ' to review';
  return {ok: true, doc: briefDoc_(subject, shopManagerHtml_(R), 'shop')};
}

function setupShopManagerBriefing() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendShopManagerReport') ScriptApp.deleteTrigger(t);
  });
  // 6–7 PM Denver the EVENING BEFORE: both briefs land before the team goes
  // home, describing the next working day's standup
  ScriptApp.newTrigger('sendShopManagerReport').timeBased()
    .everyDays(1).atHour(18).nearMinute(30).inTimezone('America/Denver').create();
  return 'Briefings scheduled — evenings ~6:30 PM for the next morning. Shop: '
    + SHOPMGR_TO + ' | Admin: ' + ADMIN_TO;
}
function sendShopManagerReport() {
  var hour = Number(Utilities.formatDate(new Date(), 'America/Denver', 'H'));
  // the briefs moved to an evening send. A stale morning trigger still exists
  // under another account (getProjectTriggers can't delete another user's), so
  // ignore any firing before noon rather than double-send.
  if (!isManualRun_() && hour < 12) return;
  // evening send: the brief is for TOMORROW, so skip the evenings before a
  // non-working day (Fri evening's brief would be for Saturday) and let
  // Sunday evening cover Monday
  var dow = Number(Utilities.formatDate(new Date(), 'America/Denver', 'u'));  // 1=Mon..7=Sun
  if (!isManualRun_() && (dow === 5 || dow === 6)) return;   // Fri/Sat evenings off
  return sendShopManagerReportTo_(SHOPMGR_TO, null, 1);
}

function setCabinetry_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  var col = -1;
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === 'CABINETRY') { col = c + 1; break; }
  }
  if (col < 0) { sh.getRange(2, last + 1).setValue('CABINETRY'); col = last + 1; }
  var val = String(req.cabinetry == null ? '' : req.cabinetry).trim();
  sh.getRange(found.row, col).setValue(val);
  return {ok: true, row: found.row, summary: found.summary, cabinetry: val};
}

/* Shop Board roster overrides: the "Roster" tab on the report sheet
 * (Name | Status | Updated) — active adds a name, inactive hides it from
 * the Shop Manager's Shop Board / Weekly Review / cleaning rotation. */
function shopRosterTab_() {
  var ss = SpreadsheetApp.openById('11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I');
  var sh = ss.getSheetByName('Roster');
  if (!sh) {
    sh = ss.insertSheet('Roster', ss.getSheets().length);
    sh.getRange(1, 1, 1, 3).setValues([['Name', 'Status', 'Updated']]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function shopRosterList_() {
  var sh = shopRosterTab_();
  var out = [];
  if (sh.getLastRow() >= 2) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (!String(vals[i][0]).trim()) continue;
      out.push({name: String(vals[i][0]).trim(),
                status: /inactive/i.test(String(vals[i][1])) ? 'inactive' : 'active'});
    }
  }
  return {ok: true, roster: out};
}
function shopRosterSet_(tech, status) {
  if (!tech) return {error: 'missing tech'};
  status = /inactive/i.test(status) ? 'inactive' : 'active';
  var sh = shopRosterTab_();
  var today = new Date().toISOString().slice(0, 10);
  if (sh.getLastRow() >= 2) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).trim().toLowerCase() === tech.trim().toLowerCase()) {
        sh.getRange(i + 2, 2, 1, 2).setValues([[status, today]]);
        return {ok: true, tech: tech.trim(), status: status, updated: true};
      }
    }
  }
  sh.appendRow([tech.trim(), status, today]);
  return {ok: true, tech: tech.trim(), status: status, added: true};
}

/* Plate lifecycle per piano ('PLATE STATUS' col, header row 2): plates leave
 * for Curtis Harper's shop and come back — the Concurrent Work report's
 * plating view shows where each plate is. */
var PLATE_STATUSES = ['', 'In piano', 'Removed', 'Plate storage — BEFORE',
                      'At Curtis Harper', 'Plate storage — AFTER', 'Back in piano'];
/* Color selections (Brigham 8/26): admin-entered refinish/plating color+sheen —
 * a first pick, then the FINAL after the client approves. Header-created cols. */
function setColor_(req) {
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var hdrName = req.which === 'final' ? 'COLOR FINAL APPROVED' : 'COLOR FIRST PICK';
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  var col = -1;
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === hdrName) { col = c + 1; break; }
  }
  if (col < 0) { sh.getRange(2, last + 1).setValue(hdrName); col = last + 1; }
  var val = String(req.value == null ? '' : req.value).trim().slice(0, 80);
  sh.getRange(found.row, col).setValue(val);
  return {ok: true, row: found.row, summary: found.summary, which: req.which, value: val};
}
/* Phase notes (Brigham 8/26): tech notes left when advancing a phase, shown on
 * the data card — appended newest-first into a header-created PHASE NOTES col. */
function phaseNote_(req, who) {
  var note = String(req.note || '').trim().slice(0, 300);
  if (!note) return {error: 'no note'};
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  var col = -1;
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === 'PHASE NOTES') { col = c + 1; break; }
  }
  if (col < 0) { sh.getRange(2, last + 1).setValue('PHASE NOTES'); col = last + 1; }
  var name = String(who || '').replace(/\s*<[^>]*>\s*/, '').replace(/\s*\(.*\)\s*$/, '');
  var stamp = Utilities.formatDate(new Date(), 'America/Denver', 'M/d');
  var line = stamp + ' ' + name + (req.phase ? ' (' + String(req.phase) + ')' : '') + ': ' + note;
  var prev = String(sh.getRange(found.row, col).getValue() || '').trim();
  sh.getRange(found.row, col).setValue(prev ? line + '\n' + prev : line);
  return {ok: true, row: found.row, summary: found.summary};
}
function setPlateStatus_(req) {
  var val = String(req.plateStatus == null ? '' : req.plateStatus).trim();
  if (PLATE_STATUSES.indexOf(val) < 0) return {error: 'bad plate status: ' + val};
  var sh = pianoSheet_(SpreadsheetApp.openById(PIANO_LOG_ID));
  var found = findPiano_(sh, req.serial, req.row);
  if (found.error) return found;
  var last = sh.getLastColumn();
  var hdr = sh.getRange(2, 1, 1, last).getValues()[0];
  var col = -1;
  for (var c = 0; c < hdr.length; c++) {
    if (String(hdr[c] || '').trim().toUpperCase() === 'PLATE STATUS') { col = c + 1; break; }
  }
  if (col < 0) { sh.getRange(2, last + 1).setValue('PLATE STATUS'); col = last + 1; }
  sh.getRange(found.row, col).setValue(val);
  return {ok: true, row: found.row, summary: found.summary, plateStatus: val};
}

/* Make a Drive file readable by anyone with the link (REST — DriveApp's
 * setSharing silently failed under this script's grants, which left the
 * nightly brief docs locked until Brigham shared them by hand). */
function shareAnyoneWithLink_(fileId) {
  try {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '/permissions', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({role: 'reader', type: 'anyone'}),
      headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
      muteHttpExceptions: true,
    });
  } catch (e) { /* sharing is best-effort — the doc itself still exists */ }
}
/* Find-or-create a Drive folder by name via REST (web-app safe). */
function driveFolderIdByName_(name) {
  var token = ScriptApp.getOAuthToken();
  var q = encodeURIComponent("name='" + name + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  var r = JSON.parse(UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)',
    {headers: {Authorization: 'Bearer ' + token}}).getContentText());
  if (r.files && r.files.length) return r.files[0].id;
  var c = JSON.parse(UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({name: name, mimeType: 'application/vnd.google-apps.folder'}),
    headers: {Authorization: 'Bearer ' + token}}).getContentText());
  return c.id;
}
/* One-shot / rerunnable sweep: link-share every archived brief doc. */
function shareAllBriefs_() {
  var ss = SpreadsheetApp.openById('11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I');
  var sh = ss.getSheetByName('Brief Log');
  var n = 0;
  if (sh && sh.getLastRow() >= 2) {
    var vals = sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var m = /\/document\/d\/([\w-]+)/.exec(String(vals[i][0] || ''));
      if (m) { shareAnyoneWithLink_(m[1]); n++; }
    }
  }
  return {ok: true, shared: n};
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

/** One-time: run me from the editor to grant the Drive scope briefDoc_ needs. */
function authorizeBriefDoc() {
  Logger.log(DriveApp.getRootFolder().getName());
}
