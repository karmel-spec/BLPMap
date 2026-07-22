#!/usr/bin/env python3
"""Quick health check for the Apps Script bridge using config.json values.

The 'move' test is a NO-OP: it looks up the piano's current location and
"moves" it to that same spot, exercising the sheet-write path without
changing any data.
"""
import json
import urllib.request

cfg = json.load(open('config.json'))

def post(payload):
    req = urllib.request.Request(cfg['bridge_url'],
                                 data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

look = post({'secret': cfg['bridge_secret'], 'serial': '181349', 'action': 'lookup'})
print('lookup:', look)
if look.get('ok') and look.get('location'):
    noop = post({'secret': cfg['bridge_secret'], 'serial': '181349',
                 'action': 'move', 'newLocation': look['location'], 'row': look['row']})
    print('no-op move (same spot back in):', noop)
