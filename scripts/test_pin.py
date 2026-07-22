#!/usr/bin/env python3
"""Verify the team PIN rollover: config.json's team_pin should authorize a
read-only lookup; the retired PIN literal is NOT used anywhere here."""
import json
import urllib.request

cfg = json.load(open('config.json'))

def post(payload):
    req = urllib.request.Request(cfg['bridge_url'],
                                 data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()[:160]

print('new pin lookup:', post({'pin': cfg['team_pin'], 'serial': '181349', 'action': 'lookup'}))
print('stale pin:', post({'pin': cfg['team_pin'][:-1] + 'X', 'serial': '181349', 'action': 'lookup'}))
