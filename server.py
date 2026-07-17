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

PORT = 8641
PIANO_LOG_CSV = ('https://docs.google.com/spreadsheets/d/'
                 '1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc/export?format=csv')

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
CACHE_SECS = 120

SLOT_RE = re.compile(r'^\d+[a-zA-Z]?$')
DATE_RE = re.compile(r'(\d{1,2})/(\d{1,2})/(\d{2,4})')
ACTIVE_MARKERS = ('for sale', 'for rent', 'current shop work', 'available',
                  'in shop', 'storage', 'consign')

_lock = threading.Lock()
_cache = {'at': 0, 'payload': None}


def _fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'BLPStoreMap/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def piano_type(category):
    c = (category or '').lower()
    if c.startswith('grand') or ', grand' in c:
        return 'grand'
    if 'digital' in c:
        return 'digital'
    if 'upright' in c or 'console' in c or 'spinet' in c or 'studio' in c:
        return 'upright'
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


def parse_pianos(raw):
    rows = list(csv.reader(io.StringIO(raw.decode('utf-8', 'replace'))))
    pianos = []
    today = date.today()
    section = ''
    sold_zone = False   # True once the "SOLD" divider row passes: rows below
                        # it are exited pianos (year archives + WEB galleries)
    for i, r in enumerate(rows[2:], start=3):
        def col(idx):
            return r[idx].strip() if len(r) > idx else ''
        serial, summary = col(2), col(3)
        if not serial and not summary:
            head = col(1)
            if head:                       # section divider row
                section = head
                if head.strip().upper() == 'SOLD':
                    sold_zone = True
            continue
        if sold_zone:
            continue  # moved to the SOLD rows = exited the building
        # skip the sheet's sub-header rows
        if summary.upper() in ('SHOPIFY', 'ADMIN', 'WEB') \
                or col(20).upper() in ('ADMIN', 'LOCATION / STATUS') \
                or 'Arrival Date' in col(21):
            continue
        status = col(18)
        loc = col(20)
        dates = parse_dates(col(21))
        entered = max((d for d in dates if d <= today), default=None)
        is_new = bool(entered and (today - entered).days <= 7)
        ol = col(1).lower()
        # Above the SOLD divider a piano is physically here (even "SOLD OR
        # COMPLETED (but not gone yet)") unless the row is pure bookkeeping.
        active = ('never received' not in ol
                  and 'never received' not in status.lower()
                  and 'duplicate' not in ol)
        pianos.append({
            'row': i,
            'section': section,
            'owner': col(1),
            'serial': serial,
            'summary': summary or f"{col(4)} {col(5)} {col(6)}".strip(),
            'year': col(4), 'make': col(5), 'model': col(6), 'size': col(7),
            'type': piano_type(col(9)),
            'status': status,
            'location': loc,
            'isSlot': bool(SLOT_RE.match(loc)),
            'entered': entered.isoformat() if entered else None,
            'isNew': is_new,
            'active': active,
        })
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
    return {
        'pianos': pianos,
        'events': events,
        'crew': crew_today(events),
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
  <h3 style="color:#9e2020;letter-spacing:1.5px;font-size:13px;margin:18px 0 6px">🔁 DUPLICATE SLOT NUMBERS ({len(r['dups'])})</h3>
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
                   f"{len(r['dups'])} duplicate slots, {len(r['moves'])} moves today")
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
            if last_mail != now.date() and send_daily_report():
                last_mail = now.date()
        time.sleep(600)


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] == '/api/data':
            body = json.dumps(get_data()).encode()
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
