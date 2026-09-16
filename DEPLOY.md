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

**PENDING REDEPLOY — progress photos (July 2026):** the `photo` action
(one-tap progress photos from the piano popup → the piano's "Tech" Drive
subfolder + a PHOTO LOG tab on the Piano Log) was added to
`apps-script/DailyReport.gs`. Paste the file into the Apps Script project
and deploy a new version; until then the app shows "the bridge needs an
update" when a photo is taken. The Apps Script account must have edit
access to the piano photo folders (root `1KB-L5dzcGSAC5Q2y40JQorkaxXfY3AiJ`).

### Redeploying the bridge — encoding matters
`DailyReport.gs` is full of emoji, arrows and dashes in string literals
(texts, sheet notes). A paste that went through a non-UTF-8 clipboard
turns every one of them into Mac Roman garble ("→" arrives as "‚Üí",
"🛠" as "üõ†") — that is what the team's texts looked like on Sep 6–8 2026.
From a terminal, copy with the locale set and verify before pasting:

```sh
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pbcopy < apps-script/DailyReport.gs
pbpaste | cmp - apps-script/DailyReport.gs && echo ok
```

After deploying, open the bridge URL: the ping must show `"enc":"→ — 🛠"`
intact (if it shows garble, the paste was bad — redo it) and `"rev"` equal
to `BRIDGE_REV` at the top of `DailyReport.gs`. Bump `BRIDGE_REV` with every
change — it is the only reliable way to tell that a paste actually took
(a skipped ⌘S or a deployment left on its old version looks identical
otherwise; it happened 9/9).

### Pending bridge paste (as of Wed Sep 16, 2026)
Deployed: rev `2026-09-15.3` (V151, 9/15 from karmel@). Repo: `2026-09-16.5`.
One paste ships, in the order they were built:
* **Voiding a punch** — a clock-in/clock-out a minute apart can now be struck
  from the ledger without deleting the row. A new **Void** column (Time Log J,
  Payroll Clock H) holds "voided by <who> <when> — <why>"; empty means live.
  The column is added to both tabs automatically on first use. Voided rows
  still show in the 🛠 adjust report (struck through, with ↩ restore) but
  count toward no total, are not an open session, are not evidence for the
  forgotten-clock sweep, and can't be matched by a fix request's ✎ Apply.
  Same permissions as adjusting the punch's times.
* **Phase reorder** — PRSB is now `PRSB - Downbearing` (4a) then
  `PRSB - Notching and Pins` (4b), with `Lacquer Soundboard` (5) after both.
  `PRSBb - Plate In` is retired; `PHASE_MIGRATE` maps the retired names and
  `setPhase_` normalises them instead of erroring.
* Exit Prep handoff text (Settings key `exit_prep_notify`, default "Melissa",
  comma-separated, `off` disables) and its Admin Brief section.
* Evidence-based forgotten-clock sweep (a punch left open overnight ends at
  the person's last piano punch / ACTIVITY LOG entry that day; 6 PM is the
  floor, never a trim) and the 8 PM mover nudge.

Deploy from karmel@, restore the three secret lines, New version, then check
the ping for `"rev":"2026-09-16.4"` and `"drive":"ok"`.

**Then run the phase migration once** — POST `{action:'migratephases'}` to the
bridge (or ask Claude to). It rewrites the CURRENT PHASE cells: the 9 pianos
on `PRSBa - Pre-Plate` become `PRSB - Downbearing`. Until it runs they keep
the old text and still draw their 4aP icon, so nothing is broken meanwhile.

Delete this section once done.

## Local dev
`python3 server.py` still works exactly as before (port 8641) and needs
`config.json` for the calendar. The local 6 AM scheduler is now just a
dev convenience — the cloud owns the real jobs.

### ⚠️ Deploy FROM karmel@, and never with placeholder secrets (Sep 11 2026)
Two outages came from paste-deploys that skipped these steps:
1. **Secrets.** The repo file carries `PASTE_SECRET_HERE` / `PASTE_PIN_HERE` /
   `PASTE_ICS_URL_HERE`. A paste that leaves them in place silently kills the
   moving-calendar feed (`fn=events` → "DNS error: http://PASTE_ICS_URL_HERE"),
   rejects the real team PIN, and breaks server-to-server calls. After pasting,
   restore the three real lines (Project History → any karmel@ version has them),
   and confirm the ping shows `"rev"` = `BRIDGE_REV` AND `fn=events` returns events.
2. **Deploying account = executing account.** The web app is `executeAs:
   USER_DEPLOYING`. Versions 136–142 (Sep 9) were created from brigham@, whose
   authorization for this script predates the Drive photo feature — every photo
   upload then failed with "You do not have permission to call
   DriveApp.Folder.createFile". Create new versions signed in as
   **karmel@brighamlarsonpianos.com**, and check `"drive":"ok"` in the ping.
   (If a consent screen ever appears on deploy, stop and have Brigham/Karmel
   approve it — that is an OAuth grant.)
Version 143 (Sep 11, 5:38 PM, karmel@) restored all three.
