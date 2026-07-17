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
var MOVING_ICS = 'PASTE_ICS_URL_HERE';     // the moving calendar's SECRET iCal address
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
  return json_({ok: true, service: 'BLP Store Map bridge'});
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
    var sh = SpreadsheetApp.openById(PIANO_LOG_ID).getSheets()[0];
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
      return json_({ok: true, moved: true, row: row, summary: summary,
                    previous: current, location: String(req.newLocation).trim()});
    }
    return json_({ok: true, row: row, summary: summary, location: current});
  } catch (err) {
    return json_({error: String(err)});
  }
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
