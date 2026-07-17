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

### 1. Calendar secret on Netlify
Netlify → blpstoremap → **Site configuration → Environment variables**:
add `BLP_MOVING_ICS` = the moving calendar's *secret* iCal address
(in local `config.json`; never commit it). Then **Deploys → Trigger deploy**.

### 2. Daily email (Apps Script, ~3 minutes)
1. [script.google.com](https://script.google.com) signed in as
   **info@brighamlarsonpianos.com** → New project → name it
   "Store Map Daily Report".
2. Paste all of `apps-script/DailyReport.gs` over `Code.gs`, save.
3. **Run → setup** once; authorize when prompted. It sends a test report
   immediately and installs the weekday 6 AM Mountain trigger.
4. On the Mac, set `"daily_email": false` in `config.json` so local dev
   servers don't double-send.

## Local dev
`python3 server.py` still works exactly as before (port 8641) and needs
`config.json` for the calendar. The local 6 AM scheduler is now just a
dev convenience — the cloud owns the real jobs.
