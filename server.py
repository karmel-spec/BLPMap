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
def _load_ics_url():
    cfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
    try:
        with open(cfg) as fh:
            return json.load(fh).get('moving_ics_url', '')
    except OSError:
        return os.environ.get('BLP_MOVING_ICS', '')

MOVING_ICS = _load_ics_url()
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
    """Refresh weekdays at 6:00 AM local. Checked every 10 min so a sleeping
    Mac simply catches up on wake instead of missing the slot."""
    last_run = None
    slots = os.path.join(BASE, 'data', 'slots.json')
    try:  # also refresh at startup if the file is over a day old
        age = time.time() - os.path.getmtime(slots)
        if age > 86400:
            refresh_geometry()
            last_run = date.today()
    except OSError:
        refresh_geometry()
        last_run = date.today()
    while True:
        now = datetime.now()
        if now.weekday() < 5 and now.hour >= 6 and last_run != now.date():
            if refresh_geometry():
                last_run = now.date()
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
