# Machine-independent hosting

Live site: **https://blpstoremap.netlify.app** (auto-deploys from this repo's
`main` branch). Once the pieces below are in place, nothing depends on any
local computer.

## Who does what, where

| Job | Runs on | Config |
|---|---|---|
| Map + stats + reports UI | Netlify (static) | auto-deploy from GitHub |
| `/api/data` (Piano Log + calendar) | Netlify Function | `BLP_MOVING_ICS` env var |
| `/api/slots` (floor-plan geometry, live from the sheet, 6 h cache) | Netlify Function | none — `netlify/functions/slots.mjs` |
| Daily report email (weekdays 6 AM) | Google Apps Script as info@ | `apps-script/DailyReport.gs` |

Geometry needs no cron at all: `/api/slots` regenerates from the Store Map
sheet on demand (cached 6 hours), so floor-plan edits appear the same day.
`data/slots.json` stays in the repo only as a fallback snapshot.

## One-time setup

### 1. Netlify environment variables — NONE REQUIRED
The live site needs no env vars: calendar events are served by the Apps
Script bridge (`GET <bridge>/exec?fn=events` — the secret iCal address
lives only inside the deployed script), and piano moves go browser →
bridge, authenticated by the team PIN (`TEAM_PIN` constant in the
deployed script; change it there any time). `BLP_MOVING_ICS` is honored
as an optional override if ever set.

### 2. Daily email + sheet bridge (Apps Script) — DONE July 17 2026
The "Store Map Daily Report" project lives in **brigham@**'s Apps Script
(script.google.com → My Projects). `setup()` has been run and authorized:
the weekday 6 AM Mountain trigger is installed and the web-app bridge
("Store Map bridge v1") is deployed. To rotate the secret or redeploy after
code changes: edit Code.gs, then Deploy → Manage deployments → ✏️ →
New version → Deploy. Rerun `setup()` only to reinstall the trigger.

## Local dev
`python3 server.py` still works exactly as before (port 8641) and needs
`config.json` for the calendar. The local 6 AM scheduler is now just a
dev convenience — the cloud owns the real jobs.
