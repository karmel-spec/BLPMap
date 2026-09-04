#!/usr/bin/env python3
"""BLP Store Map — dev server.

Serves the static app and /api/data, which merges:
  - Piano Log sheet (public CSV export)  -> pianos + locations (col U)
  - Piano Moving calendar (private iCal) -> today's / upcoming moves + crew
Both are cached in memory for 2 minutes; on network failure the last good
payload is served with stale=true.
"""
import csv
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))

PORT = int(os.environ.get('PORT', 8641))
PIANO_LOG_CSV = ('https://docs.google.com/spreadsheets/d/'
                 '1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc/export?format=csv&gid=970727205')

# The moving calendar's *secret* iCal URL lives in config.json (gitignored)
# or the BLP_MOVING_ICS env var — never in the repo.
def _load_config():
    cfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
    try:
        with open(cfg) as fh:
            return json.load(fh)
    except OSError:
        return {}

_CFG = _load_config()
MOVING_ICS = _CFG.get('moving_ics_url', os.environ.get('BLP_MOVING_ICS', ''))
REPORT_TO = _CFG.get('report_to', 'info@brighamlarsonpianos.com')
REPORT_ACCOUNT = _CFG.get('gog_account', 'info@brighamlarsonpianos.com')
# set "daily_email": false in config.json once the Apps Script sender
# (apps-script/DailyReport.gs) is live, so mornings don't get two reports
DAILY_EMAIL = _CFG.get('daily_email', True)
CACHE_SECS = 120

SLOT_RE = re.compile(r'^\d+(?:\.\d)?[a-zA-Z]?$')
DATE_RE = re.compile(r'(\d{1,2})/(\d{1,2})/(\d{2,4})')
ACTIVE_MARKERS = ('for sale', 'for rent', 'current shop work', 'available',
                  'in shop', 'storage', 'consign')

_lock = threading.Lock()
_cache = {'at': 0, 'payload': None}


def _fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'BLPStoreMap/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def piano_type(category, name=''):
    c = (category or '').lower()
    if c.startswith('grand') or ', grand' in c:
        return 'grand'
    if 'digital' in c:
        return 'digital'
    if 'upright' in c or 'console' in c or 'spinet' in c or 'studio' in c:
        return 'upright'
    # category blank/unhelpful: fall back to the piano's own name text
    n = (name or '').lower()
    if any(w in n for w in ('upright', 'console', 'spinet', 'studio', 'vertical')):
        return 'upright'
    if 'grand' in n:
        return 'grand'
    return 'other'


def parse_dates(text):
    out = []
    for m, d, y in DATE_RE.findall(text or ''):
        y = int(y)
        if y < 100:
            y += 2000
        try:
            out.append(date(y, int(m), int(d)))
        except ValueError:
            pass
    return out


DRIVE_URL_RE = re.compile(r'(https://(?:drive|docs)\.google\.com/[^\s,"\']+)')


def drive_url(v):
    """Media/folder cells hold a Drive link when one has been pasted in."""
    m = DRIVE_URL_RE.search(v or '')
    return m.group(1) if m else ''


def parse_pianos(raw):
    rows = list(csv.reader(io.StringIO(raw.decode('utf-8', 'replace'))))
    pianos = []
    today = date.today()
    hdr = rows[1] if len(rows) > 1 else []
    phase_idx = next((i for i, h in enumerate(hdr)
                      if h.strip().upper() == 'CURRENT PHASE'), -1)
    # the sheet's real price column is "TAG / INVOICE PRICE" (col BJ);
    # the bare "PRICE" column is a retired duplicate kept as fallback
    price_idx = next((i for i, h in enumerate(hdr)
                      if h.strip().upper() == 'TAG / INVOICE PRICE'), -1)
    if price_idx < 0:
        price_idx = next((i for i, h in enumerate(hdr)
                          if h.strip().upper() == 'PRICE'), -1)
    track_idx = next((i for i, h in enumerate(hdr)
                      if h.strip().upper() == 'TRACK'), -1)
    done_idx = next((i for i, h in enumerate(hdr)
                     if h.strip().upper() == 'PHASES DONE'), -1)
    wait_idx = next((i for i, h in enumerate(hdr)
                     if h.strip().upper() == 'WAITING NOTE'), -1)
    cr_idx = next((i for i, h in enumerate(hdr)
                   if h.strip().upper() == 'CLIENT REPORTS'), -1)
    cb_idx = next((i for i, h in enumerate(hdr)
                   if h.strip().upper() == 'CHECK BACK'), -1)
    cab_idx = next((i for i, h in enumerate(hdr)
                    if h.strip().upper() == 'CABINETRY'), -1)
    type_ov_idx = next((i for i, h in enumerate(hdr)
                        if h.strip().upper() == 'TYPE OVERRIDE'), -1)
    plate_idx = next((i for i, h in enumerate(hdr)
                      if h.strip().upper() == 'PLATE STATUS'), -1)
    pay_plan_idx = next((i for i, h in enumerate(hdr)
                         if h.strip().upper() == 'PAYMENT PLAN'), -1)
    pay_ms_idx = next((i for i, h in enumerate(hdr)
                       if h.strip().upper() == 'PAY MILESTONE'), -1)
    admin_st_idx = next((i for i, h in enumerate(hdr)
                         if h.strip().upper() == 'ADMIN STEPS'), -1)
    key_svc_idx = next((i for i, h in enumerate(hdr)
                        if h.strip().upper() == 'KEY SERVICE'), -1)
    bench_loc_idx = next((i for i, h in enumerate(hdr)
                          if h.strip().upper() == 'BENCH LOCATION'), -1)
    plate_hw_idx = next((i for i, h in enumerate(hdr)
                         if h.strip().upper() == 'PLATE HW LOCATION'), -1)
    plate_temp_idx = next((i for i, h in enumerate(hdr)
                           if h.strip().upper() == 'PLATE TEMP SPOT'), -1)
    scope_notes_idx = next((i for i, h in enumerate(hdr)
                            if h.strip().upper() == 'SCOPE NOTES'), -1)
    keytop_idx = next((i for i, h in enumerate(hdr)
                       if h.strip().upper() == 'KEYTOP STATUS'), -1)
    imp_note_idx = next((i for i, h in enumerate(hdr)
                         if h.strip().upper() == 'IMPORTANT NOTES'), -1)
    piano_notes_idx = next((i for i, h in enumerate(hdr)
                            if h.strip().upper() == 'PIANO NOTES'), -1)
    bench_note_idx = next((i for i, h in enumerate(hdr)
                           if h.strip().upper() == 'BENCH NOTE'), -1)
    temp_entry_idx = next((i for i, h in enumerate(hdr)
                           if h.strip().upper() == 'TEMP ENTRY'), -1)
    tag_snap_idx = next((i for i, h in enumerate(hdr)
                         if h.strip().upper() == 'TAG SNAPSHOT'), -1)
    paperwork_idx = next((i for i, h in enumerate(hdr)
                          if h.strip().upper() == 'PAPERWORK'), -1)
    # CUSTOM SHOPWORK queue bounds (1-based rows). Queue position = row - header;
    # total = rows from just after the header down to the first fully-blank row.
    q_hdr = q_end = None
    for idx, rr in enumerate(rows, start=1):
        b = rr[1].strip() if len(rr) > 1 else ''
        c = rr[2].strip() if len(rr) > 2 else ''
        d = rr[3].strip() if len(rr) > 3 else ''
        if q_hdr is None:
            if b.upper() == 'CUSTOM SHOPWORK' and not c and not d:
                q_hdr = idx
        elif q_end is None and not b and not c and not d:
            q_end = idx
    section = ''
    sold_zone = False   # True once the "SOLD" divider row passes: rows below
                        # it are exited pianos (year archives + WEB galleries)
    for i, r in enumerate(rows[2:], start=3):
        def col(idx):
            return r[idx].strip() if len(r) > idx else ''

        def med(idx):
            # media cells: empty=needed, "Skipped ..."=deliberately skipped,
            # a bare "x"=not applicable to this piano (never needed)
            v = col(idx)
            if not v:
                return False
            if v.strip().lower() == 'x':
                return 'na'
            return 'skip' if v.lower().startswith('skip') else True
        serial, summary = col(2), col(3)
        # Section banner. Most are blank except the label in col B, but a few
        # ("SOLD OR COMPLETED BUT NOT DELIVERED YET") also carry a note in the
        # summary column - so an ALL-CAPS one-line label with no serial and no
        # year/make/model counts as a banner too, not as a piano.
        head = col(1)
        caps_banner = (not col(4) and not col(5) and not col(6) and head
                       and '\n' not in head and len(head) < 60
                       and re.search(r'[A-Z]', head) and not re.search(r'[a-z]', head))
        if not serial and (not summary or caps_banner):
            if head:                       # section divider row
                section = head
                if head.strip().upper() == 'SOLD':
                    sold_zone = True
            continue
        phase_raw = col(phase_idx) if phase_idx >= 0 else ''
        archived = sold_zone or 'delivered' in phase_raw.lower()  # delivered/sold: off the map, kept for the archive
        # skip the sheet's sub-header rows
        if summary.upper() in ('SHOPIFY', 'ADMIN', 'WEB') \
                or col(20).upper() in ('ADMIN', 'LOCATION / STATUS') \
                or 'Arrival Date' in col(21):
            continue
        status = col(18)
        loc = col(20)
        # keyboard stands are inventory, not pianos - keep them off the map
        if re.search(r'\bstand\b', summary, re.I) or serial.strip().lower() == 'stand':
            continue
        # section-header/status-note rows with no serial (room labels, "go to X
        # section" pointers, "Piano is [not] at BLP..." shop-follow-up notes) -
        # not a piano, just a divider or note row that slipped a summary in
        if not col(4) and not col(5) and (
                re.match(r'^haydn room$', summary.strip(), re.I)
                or re.search(r'go to .* section', summary + ' ' + serial, re.I)
                or re.match(r'^piano is ', summary.strip(), re.I)):
            continue
        dates = parse_dates(col(21))
        entered = max((d for d in dates if d <= today), default=None)
        is_new = bool(entered and (today - entered).days <= 7)
        ol = col(1).lower()
        # Above the SOLD divider a piano is physically here (even "SOLD OR
        # COMPLETED (but not gone yet)") unless the row is pure bookkeeping.
        active = (not archived
                  and 'never received' not in ol
                  and 'never received' not in status.lower()
                  and 'duplicate' not in ol)
        pianos.append({
            'row': i,
            'archived': archived,
            'section': section,
            'owner': col(1),
            'serial': serial,
            'summary': summary or f"{col(4)} {col(5)} {col(6)}".strip(),
            'year': col(4), 'make': col(5), 'model': col(6), 'size': col(7),
            'type': (col(type_ov_idx) if type_ov_idx >= 0 else '') or piano_type(col(9), summary + ' ' + col(6)),
            'typeOverride': col(type_ov_idx) if type_ov_idx >= 0 else '',
            # shop-tag statics: BENCH, PROJECT CATEGORY (plan), NOTES, REPLATING ORDERED
            'bench': col(19)[:60], 'plan': col(23)[:220],
            'benchLoc': (col(bench_loc_idx) if bench_loc_idx >= 0 else '')[:80],
            'plateHw': (col(plate_hw_idx) if plate_hw_idx >= 0 else '')[:80],
            'plateTemp': (col(plate_temp_idx) if plate_temp_idx >= 0 else '')[:90],
            'scopeNotes': (col(scope_notes_idx) if scope_notes_idx >= 0 else '')[:500],
            'keytopStatus': (col(keytop_idx) if keytop_idx >= 0 else '')[:40],
            'importantNote': (col(imp_note_idx) if imp_note_idx >= 0 else '')[:200],
            'pianoNotes': (col(piano_notes_idx) if piano_notes_idx >= 0 else '')[:2000],
            'benchNote': (col(bench_note_idx) if bench_note_idx >= 0 else '')[:160],
            'tempEntry': (col(temp_entry_idx) if temp_entry_idx >= 0 else '')[:80],
            'planNotes': col(26)[:300], 'replate': col(50)[:20],
            # admin section: payment plan, last-emailed pay milestone, admin steps done
            'payPlan': col(pay_plan_idx) if pay_plan_idx >= 0 else '',
            'payMilestone': col(pay_ms_idx) if pay_ms_idx >= 0 else '',
            'adminSteps': col(admin_st_idx) if admin_st_idx >= 0 else '',
            'keyService': col(key_svc_idx) if key_svc_idx >= 0 else '',
            'keywork': col(51)[:90],
            'tagSnapshot': col(tag_snap_idx) if tag_snap_idx >= 0 else '',
            'paperwork': col(paperwork_idx) if paperwork_idx >= 0 else '',
            'tasks': {
                'bass': col(38)[:80], 'decals': col(39)[:80], 'parts': col(40)[:80],
                'pedals': col(41)[:80], 'pedaltrim': col(42)[:80], 'lock': col(43)[:80],
                'strikeplate': col(44)[:80], 'escutcheon': col(45)[:80], 'decor': col(46)[:80],
                'hinges': col(47)[:80], 'screws': col(48)[:80], 'otherhw': col(49)[:80],
            },
            # everything else the Piano Log holds for this row that the card
            # doesn't already surface — keyed by the sheet's own header names
            'logExtras': {
                h.strip(): col(c)[:300]
                for c, h in enumerate(hdr)
                if h and h.strip() and col(c) and c not in
                {0, 1, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 26, 50, 51, 68,
                 phase_idx, price_idx, track_idx, done_idx, wait_idx, cr_idx, cb_idx, cab_idx,
                 type_ov_idx, pay_plan_idx, pay_ms_idx, admin_st_idx, key_svc_idx,
                 tag_snap_idx, paperwork_idx}
            },
            # the media cells double as Drive folder links when they hold a URL
            'bphotoUrl': drive_url(col(14)), 'bvideoUrl': drive_url(col(15)),
            'aphotoUrl': drive_url(col(16)), 'avideoUrl': drive_url(col(17)),
            'mainFolder': drive_url(col(68)),
            'status': status,
            'location': loc,
            'isSlot': bool(SLOT_RE.match(loc)),
            'entered': entered.isoformat() if entered else None,
            'phase': col(phase_idx) if phase_idx >= 0 else '',
            'price': col(price_idx) if price_idx >= 0 and any(ch.isdigit() for ch in col(price_idx)) else '',
            'track': col(track_idx) if track_idx >= 0 else '',
            'phasesDone': col(done_idx) if done_idx >= 0 else '',
            'waitNote': col(wait_idx) if wait_idx >= 0 else '',
            'clientReports': col(cr_idx) if cr_idx >= 0 else '',
            'checkBack': col(cb_idx) if cb_idx >= 0 else '',
            'cabinetry': col(cab_idx) if cab_idx >= 0 else '',
            'plateStatus': col(plate_idx) if plate_idx >= 0 else '',
            'bphoto': med(14), 'bvideo': med(15),
            'aphoto': med(16), 'avideo': med(17),
            'queuePos': 0,
            'queueTotal': 0,
            'isNew': is_new,
            'active': active,
        })
    # Queue numbers count PIANOS in row order (not raw row offsets), so they
    # stay a contiguous 1..N even if a label or junk row sits inside the
    # section — and match the Piano Log app's queue numbering.
    q = [p for p in pianos if q_hdr and q_end and q_hdr < p['row'] < q_end]
    for k, p in enumerate(q, 1):
        p['queuePos'] = k
        p['queueTotal'] = len(q)
    return pianos


def _unfold(text):
    return re.sub(r'\r?\n[ \t]', '', text)


def parse_events(raw):
    text = _unfold(raw.decode('utf-8', 'replace'))
    today = date.today()
    lo, hi = today - timedelta(days=1), today + timedelta(days=14)
    events = []
    for block in text.split('BEGIN:VEVENT')[1:]:
        block = block.split('END:VEVENT')[0]
        props = {}
        for line in block.splitlines():
            if ':' not in line:
                continue
            k, v = line.split(':', 1)
            props[k.split(';')[0].upper()] = v.strip()
        dt = props.get('DTSTART', '')
        m = re.match(r'^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?', dt)
        if not m:
            continue
        d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        hhmm = f"{m.group(4)}:{m.group(5)}" if m.group(4) else None
        if hhmm and m.group(7) == 'Z':  # UTC -> America/Denver
            try:
                from zoneinfo import ZoneInfo
                loc = datetime(d.year, d.month, d.day, int(m.group(4)), int(m.group(5)),
                               tzinfo=ZoneInfo('UTC')).astimezone(ZoneInfo('America/Denver'))
                d = loc.date()
                hhmm = loc.strftime('%H:%M')
            except Exception:
                pass
        if not (lo <= d <= hi):
            continue
        summ = props.get('SUMMARY', '').replace('\\,', ',')
        done = bool(re.match(r'^\s*x\s+', summ, re.I))
        clean = re.sub(r'^\s*x\s+', '', summ, flags=re.I).strip()
        if clean.upper() in ('OFF', 'NO MOVES', ''):
            continue
        events.append({
            'date': d.isoformat(),
            'time': hhmm,
            'summary': clean,
            'done': done,
            'description': props.get('DESCRIPTION', '')
                .replace('\\n', ' ').replace('\\,', ',')[:400],
        })
    events.sort(key=lambda e: (e['date'], e['time'] or '99'))
    return events


NAME_RE = re.compile(r"^[A-Za-z .,'&/+]{2,40}$")

def crew_today(events):
    today = date.today().isoformat()
    names = []
    for e in events:
        if e['date'] != today:
            continue
        head = e['summary'].split(':', 1)[0].strip()
        if ':' in e['summary'] and NAME_RE.match(head) and len(head.split()) <= 4:
            for n in re.split(r'[/&+]| and ', head):
                n = n.strip().title()
                if n and n.lower() not in ('piano', 'pickup', 'pick up', 'delivery',
                                           'in store', 'upright', 'grand') \
                        and n not in names and len(n) < 20:
                    names.append(n)
    return names


def build_payload():
    pianos_raw = _fetch(PIANO_LOG_CSV)
    pianos = parse_pianos(pianos_raw)
    events = parse_events(_fetch(MOVING_ICS)) if MOVING_ICS else []
    tunings = {'upcoming': [], 'past': []}
    bridge = _CFG.get('bridge_url')
    if bridge:
        try:
            t = json.loads(_fetch(bridge + '?fn=tunings'))
            if 'upcoming' in t:
                tunings = t
        except Exception:
            pass  # tuning calendar unavailable: feature degrades gracefully
    return {
        'pianos': pianos,
        'events': events,
        'crew': crew_today(events),
        'tunings': tunings,
        'fetchedAt': datetime.now().isoformat(timespec='seconds'),
        'stale': False,
    }


def get_data():
    with _lock:
        if _cache['payload'] and time.time() - _cache['at'] < CACHE_SECS:
            return _cache['payload']
    try:
        payload = build_payload()
        with _lock:
            _cache.update(at=time.time(), payload=payload)
        return payload
    except Exception as exc:  # network failure -> stale cache
        with _lock:
            if _cache['payload']:
                stale = dict(_cache['payload'])
                stale['stale'] = True
                return stale
        return {'error': str(exc), 'pianos': [], 'events': [], 'crew': []}


STORE_MAP_XLSX = ('https://docs.google.com/spreadsheets/d/'
                  '12qMhAHxkRlacel5Q7qxCOwYShgDRD3O46D1cYCrlfwA/export?format=xlsx')

# ---------------------------------------------------------------- daily email
KNOWN_AREAS = ('showroom', 'pre-sale showroom', 'third floor', 'storage',
               'shop', 'vestibule', 'wing room', 'holding room', 'attic',
               'sold floor', 'rebuilding line', 'refinishing', 'back shop',
               'middle shop', 'basement', 'warehouse', 'rental',
               'out for delivery', 'customer')

def _esc(s):
    return (str(s or '').replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;'))


def _slot_floors():
    try:
        with open(os.path.join(BASE, 'data', 'slots.json')) as fh:
            doc = json.load(fh)
        return {s['id'].lower(): fi for fi, f in enumerate(doc['floors'])
                for s in f['slots']}
    except OSError:
        return {}


def build_report(payload):
    """Compute the same numbers the app shows, server-side."""
    slots = _slot_floors()
    act = [p for p in payload['pianos'] if p['active']]
    today = date.today().isoformat()
    moves = [e for e in payload['events'] if e['date'] == today]
    floor = {0: 0, 1: 0}
    by_slot = {}
    for p in act:
        loc = p['location'].lower()
        if p['isSlot'] and loc in slots:
            floor[slots[loc]] += 1
            by_slot.setdefault(loc, []).append(p)
    unplaced = [p for p in act if not p['location']
                or (p['isSlot'] and p['location'].lower() not in slots)
                or (not p['isSlot'] and
                    not any(a in p['location'].lower() for a in KNOWN_AREAS))]
    dups = sorted(((k, v) for k, v in by_slot.items() if len(v) > 1),
                  key=lambda kv: -len(kv[1]))
    seen, total = set(), 0
    for p in act:
        key = p['serial'] or f"row{p['row']}"
        if key not in seen:
            seen.add(key)
            total += 1
    new_week = sum(1 for p in act if p['isNew'])
    return {'total': total, 'floor1': floor[0], 'floor2': floor[1],
            'moves': moves, 'unplaced': unplaced, 'dups': dups,
            'new_week': new_week, 'crew': payload.get('crew', [])}


def report_html(r):
    day = datetime.now().strftime('%A, %B %-d, %Y')
    chip = ('<td style="padding:10px 16px;background:#f7f8f9;border:1px solid '
            '#e3e6e9;border-radius:8px;text-align:center"><div style="font-size:'
            '22px;font-weight:800;color:#121212">{}</div><div style="font-size:'
            '10px;letter-spacing:1px;color:#8a929a">{}</div></td>')
    chips = ''.join([
        chip.format(r['total'], 'TOTAL PIANOS'),
        chip.format(r['floor1'], '1ST FLOOR'),
        chip.format(r['floor2'], '2ND FLOOR'),
        chip.format(len(r['moves']), 'MOVES TODAY'),
        chip.format(r['new_week'], 'NEW THIS WEEK'),
        chip.format(f"{len(r['unplaced'])} / {len(r['dups'])}",
                    'UNPLACED / DUP SLOTS'),
    ])
    mv_rows = ''.join(
        f'<li style="margin:4px 0">{"✅ " if e["done"] else ""}'
        f'<b>{e["time"] or "all day"}</b> — {_esc(e["summary"])}</li>'
        for e in r['moves']) or '<li>No moves on today’s calendar.</li>'
    crew = ' · '.join(r['crew']) or 'none listed on the calendar'
    th = ('<th style="text-align:left;font-size:10px;letter-spacing:1px;'
          'color:#8a929a;border-bottom:2px solid #eceef0;padding:5px 10px 5px 0">')
    td = '<td style="border-bottom:1px solid #f0f2f4;padding:6px 10px 6px 0;font-size:13px">'
    un_rows = ''.join(
        f'<tr>{td}{_esc(p["summary"][:45])}</td>{td}{_esc(p["serial"])}</td>'
        f'{td}{_esc((p.get("section") or "")[:30])}</td>'
        f'{td}<b style="color:#9e2020">{_esc(p["location"] or "(blank)")}</b></td></tr>'
        for p in r['unplaced'][:60])
    if len(r['unplaced']) > 60:
        un_rows += f'<tr>{td} colspan="4">… and {len(r["unplaced"]) - 60} more</td></tr>'
    dup_rows = ''.join(
        f'<tr>{td}<b style="color:#9e2020">{_esc(slot)}</b></td>'
        f'{td}{_esc(" • ".join(p["summary"][:35] for p in ps))}</td></tr>'
        for slot, ps in r['dups'][:40])
    log_url = ('https://docs.google.com/spreadsheets/d/'
               '1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc/edit')
    return f"""<div style="font-family:Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto">
<div style="background:#0d0d0d;color:#fff;padding:18px 24px;border-radius:10px 10px 0 0">
  <div style="font-family:Georgia,serif;letter-spacing:4px;font-size:18px">BRIGHAM LARSON <span style="color:#d6d6d6">PIANOS</span></div>
  <div style="font-size:12px;color:#bbb;letter-spacing:2px;margin-top:3px">STORE MAP — DAILY REPORT · {day}</div>
</div>
<div style="border:1px solid #e3e6e9;border-top:none;border-radius:0 0 10px 10px;padding:20px 24px">
  <table cellspacing="6" style="width:100%;border-collapse:separate"><tr>{chips}</tr></table>
  <h3 style="color:#9e2020;letter-spacing:1.5px;font-size:13px;margin:18px 0 6px">🚚 TODAY'S MOVES</h3>
  <div style="font-size:12px;color:#8a929a;margin-bottom:4px">Crew: {_esc(crew)}</div>
  <ul style="margin:6px 0;padding-left:18px;font-size:13px">{mv_rows}</ul>
  <h3 style="color:#9e2020;letter-spacing:1.5px;font-size:13px;margin:18px 0 6px">⚠️ UNPLACED PIANOS ({len(r['unplaced'])})</h3>
  <div style="font-size:12px;color:#8a929a;margin-bottom:6px">Column U is blank or doesn't match a Store Map slot or known area — give these a number.</div>
  <table style="width:100%;border-collapse:collapse"><tr>{th}PIANO</th>{th}SERIAL</th>{th}LOG SECTION</th>{th}COL U SAYS</th></tr>{un_rows}</table>
  <h3 style="color:#9e2020;letter-spacing:1.5px;font-size:13px;margin:18px 0 6px">🔁 DUPLICATE SPOT NUMBERS ({len(r['dups'])})</h3>
  <table style="width:100%;border-collapse:collapse"><tr>{th}SLOT</th>{th}PIANOS CLAIMING IT</th></tr>{dup_rows}</table>
  <p style="font-size:12px;color:#8a929a;margin-top:16px">Fix rows in the
  <a href="{log_url}" style="color:#9e2020">Piano Log</a> (column U) — the map updates within 2 minutes.
  Sent automatically by the BLP Store Map app, weekdays at 6 AM.</p>
</div></div>"""


def send_daily_report():
    try:
        payload = get_data()
        if payload.get('error'):
            raise RuntimeError(payload['error'])
        r = build_report(payload)
        html = report_html(r)
        subject = (f"Store Map Daily Report — {len(r['unplaced'])} unplaced, "
                   f"{len(r['dups'])} duplicate spots, {len(r['moves'])} moves today")
        text = (f"Total pianos: {r['total']} (1st: {r['floor1']}, 2nd: {r['floor2']})\n"
                f"Moves today: {len(r['moves'])}\nUnplaced: {len(r['unplaced'])}\n"
                f"Duplicate slots: {len(r['dups'])}\n\nOpen the Store Map app for details.")
        subprocess.run(
            ['gog', 'gmail', 'send', '-a', REPORT_ACCOUNT, '--to', REPORT_TO,
             '--subject', subject, '--body', text, '--body-html', html,
             '--no-input', '-y'],
            check=True, capture_output=True, timeout=60)
        print(f'[{datetime.now():%m-%d %H:%M}] daily report emailed to {REPORT_TO}')
        return True
    except subprocess.CalledProcessError as exc:
        print(f'[{datetime.now():%m-%d %H:%M}] report email FAILED: '
              f'{exc.stderr.decode()[:300] if exc.stderr else exc}')
        return False
    except Exception as exc:
        print(f'[{datetime.now():%m-%d %H:%M}] report email FAILED: {exc}')
        return False

def refresh_geometry():
    """Re-download the Store Map sheet and regenerate data/slots.json."""
    try:
        blob = _fetch(STORE_MAP_XLSX)
        with open(os.path.join(BASE, 'data', 'storemap.xlsx'), 'wb') as fh:
            fh.write(blob)
        subprocess.run([sys.executable, os.path.join(BASE, 'scripts', 'extract_map.py')],
                       check=True, cwd=BASE, capture_output=True, timeout=120)
        print(f'[{datetime.now():%m-%d %H:%M}] map geometry refreshed from Store Map sheet')
        return True
    except Exception as exc:
        print(f'[{datetime.now():%m-%d %H:%M}] geometry refresh FAILED: {exc}')
        return False


def _geometry_scheduler():
    """Weekdays at 6:00 AM local: refresh map geometry, then email the daily
    report. Checked every 10 min so a sleeping Mac simply catches up on wake
    instead of missing the slot."""
    last_geo = last_mail = None
    slots = os.path.join(BASE, 'data', 'slots.json')
    try:  # also refresh at startup if the file is over a day old
        age = time.time() - os.path.getmtime(slots)
        if age > 86400:
            refresh_geometry()
            last_geo = date.today()
    except OSError:
        refresh_geometry()
        last_geo = date.today()
    while True:
        now = datetime.now()
        if now.weekday() < 5 and now.hour >= 6:
            if last_geo != now.date() and refresh_geometry():
                last_geo = now.date()
            if DAILY_EMAIL and last_mail != now.date() and send_daily_report():
                last_mail = now.date()
        time.sleep(600)


BRIDGE_URL = _CFG.get('bridge_url', '')
BRIDGE_SECRET = _CFG.get('bridge_secret', '')


def bridge_call(payload):
    """POST to the Apps Script bridge; follow its 302 to the echo URL."""
    body = json.dumps({**payload, 'secret': BRIDGE_SECRET}).encode()

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(BRIDGE_URL, data=body,
                                 headers={'Content-Type': 'application/json'})
    try:
        resp = opener.open(req, timeout=30)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307) and e.headers.get('Location'):
            with urllib.request.urlopen(e.headers['Location'], timeout=30) as r2:
                return json.loads(r2.read())
        raise


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path.split('?')[0] == '/api/move':
            try:
                if not BRIDGE_URL or not BRIDGE_SECRET:
                    raise RuntimeError('bridge not configured in config.json')
                n = int(self.headers.get('Content-Length', 0))
                req = json.loads(self.rfile.read(n) or b'{}')
                payload = {'serial': str(req.get('serial', '')),
                           'action': 'move' if req.get('newLocation') else 'lookup'}
                if req.get('newLocation'):
                    payload['newLocation'] = str(req['newLocation'])
                if req.get('row'):
                    payload['row'] = req['row']
                out = bridge_call(payload)
            except Exception as exc:
                out = {'error': str(exc)}
            body = json.dumps(out).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def do_GET(self):
        if self.path.split('?')[0] == '/api/data':
            data = get_data()
            if 'scope=active' in self.path:
                data = dict(data, pianos=[p for p in data.get('pianos', []) if p.get('active')], scope='active')
            body = json.dumps(data).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        if args and '/api/' in str(args[0]):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    os.chdir(BASE)
    threading.Thread(target=_geometry_scheduler, daemon=True).start()
    print(f'BLP Store Map on http://localhost:{PORT} '
          f'(geometry auto-refresh weekdays 6:00 AM)')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
