#!/usr/bin/env python3
"""Quick health check for the Apps Script bridge using config.json values."""
import json
import urllib.request

cfg = json.load(open('config.json'))

def post(payload):
    req = urllib.request.Request(cfg['bridge_url'],
                                 data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()[:200]

print('good secret lookup:',
      post({'secret': cfg['bridge_secret'], 'serial': '181349', 'action': 'lookup'}))
print('bad secret:', post({'secret': 'WRONG', 'serial': '181349'}))
