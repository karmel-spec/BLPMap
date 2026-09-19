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
| `/api/agent` (in-app chat with Lindsay / Melody / Chris … — the Hermes agents) | Netlify Function | `BLP_GATEWAY_URL`, `BLP_GATEWAY_KEY` env vars |
| `/api/queue` (drag-to-reorder + ＋ add for the Keytop / Refinish / Plate Q boxes — owners, managers & admins) | Netlify Function | `SUPABASE_SERVICE_KEY`; run `supabase/queue_order.sql` once |
| Daily report email (weekdays 6 AM) | Google Apps Script as info@ | `apps-script/DailyReport.gs` |

Geometry needs no cron at all: `/api/slots` regenerates from the Store Map
sheet on demand (cached 6 hours), so floor-plan edits appear the same day.
`data/slots.json` stays in the repo only as a fallback snapshot.

## One-time setup

### 1. Netlify environment variables — two, for agent chat only
The map, moves and calendar need no env vars (see below). **Agent chat**
(tap an agent's face bottom-right → chat window, added Sep 18 2026) does:

| Var | Value |
|---|---|
| `BLP_GATEWAY_KEY` | the shared BLP Agent Gateway key — same value the **blpmarketing** Netlify site uses for Marcus |
| `BLP_GATEWAY_URL` | optional; defaults to `https://agents.brighamlarsonpianos.com` (the Cloudflare tunnel to the agents' Mac) |
| `SUPABASE_SERVICE_KEY` | service-role key of the Supabase project (`ismacawxfvvllfinibbf`) — lets the function save every chat message to `agent_messages` so threads survive the browser and are searchable. Run `supabase/agent_chat.sql` once in the SQL editor first. Without it chat works but threads stay on the device. |

Without the key `/api/agent` answers 501 and the chat window shows
"agent chat not configured" — the rest of the app is unaffected. The
function verifies the signed-in Google ID token (BLP accounts only) before
forwarding anything, and if the gateway is down it reports that plainly;
no stand-in ever answers for an agent (Brigham's rule, same as Marcus).
Local dev: put `"gateway_key"` in `config.json` (gitignored) — `server.py`
mirrors the function.

The same `SUPABASE_SERVICE_KEY` also powers `/api/queue` (hand-set order and
＋ additions for the three queue boxes; table from `supabase/queue_order.sql`).
Only owners, managers and admins may write — the function checks the signed-in
email against the list in `netlify/functions/queue-order.mjs`; add more with a
comma-separated `QUEUE_EDITORS` env var.

#### Everything else — NONE REQUIRED
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
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pbpaste | cmp - apps-script/DailyReport.gs && echo ok
```

**Both lines need the locale.** `pbpaste` without it converts the readback to
Mac Roman on the way out, so a perfectly good clipboard fails the `cmp` with
"differ: char 22, line 2" (the em dash in the header comment). That is the
CHECK being wrong, not the copy — it cost a false alarm on 9/17. If the
locale-set version above passes, the clipboard is genuinely fine.

After deploying, open the bridge URL: the ping must show `"enc":"→ — 🛠"`
intact (if it shows garble, the paste was bad — redo it) and `"rev"` equal
to `BRIDGE_REV` at the top of `DailyReport.gs`. Bump `BRIDGE_REV` with every
change — it is the only reliable way to tell that a paste actually took
(a skipped ⌘S or a deployment left on its old version looks identical
otherwise; it happened 9/9).

### Bridge deploy log
Deployed rev `2026-09-17.2` on Wed Sep 17 2026 from karmel@ — verified
`enc` intact, `drive:"ok"`, `fn=events` returning 18 events, and the
placeholder PIN rejected. The one-time `{action:'migratephases'}` ran the
same day: 8 cells `PRSBa - Pre-Plate` → `PRSB - Downbearing`, zero retired
phase names left in the Piano Log.

**Both deploys that day shipped the placeholder secrets first** and had to be
redone. See the warning below — and note the fix worth doing: move
`BRIDGE_SECRET` / `TEAM_PIN` / `MOVING_ICS` into Script Properties so a paste
can never clobber them again.

## Local dev
`python3 server.py` still works exactly as before (port 8641) and needs
`config.json` for the calendar. The local 6 AM scheduler is now just a
dev convenience — the cloud owns the real jobs.

### ⚠️ Deploy FROM karmel@, and never with placeholder secrets (Sep 11 2026)
Two outages came from paste-deploys that skipped these steps:
1. **Secrets — FIXED as of rev `2026-09-17.3`, no restore step any more.**
   `BRIDGE_SECRET`, `TEAM_PIN` and `MOVING_ICS` now live in **Script
   Properties** (Project Settings → Script properties), which a code paste
   cannot touch. The repo file holds no secret values at all.
   *History:* they used to be `PASTE_..._HERE` constants that had to be restored
   by hand after every paste. That was missed on two consecutive deploys on
   9/17 — the first shipped `PASTE_ICS_URL_HERE` to production (moving calendar
   dead, `fn=events` → "DNS error") and made `PASTE_PIN_HERE` a working team PIN.
   *Moving an existing project over:* run `apps-script/one-time-stash-secrets.gs`
   once while the OLD Code.gs still has the constants, THEN paste the new file —
   that order means no downtime and nobody ever copies a secret by hand.
   *Checking:* the ping now reports `"secrets"` — `ok`, or `NOT SET: TEAM_PIN,
   MOVING_ICS`. Still confirm `fn=events` returns real events.
2. **Deploying account = executing account.** The web app is `executeAs:
   USER_DEPLOYING`. Versions 136–142 (Sep 9) were created from brigham@, whose
   authorization for this script predates the Drive photo feature — every photo
   upload then failed with "You do not have permission to call
   DriveApp.Folder.createFile". Create new versions signed in as
   **karmel@brighamlarsonpianos.com**, and check `"drive":"ok"` in the ping.
   (If a consent screen ever appears on deploy, stop and have Brigham/Karmel
   approve it — that is an OAuth grant.)
Version 143 (Sep 11, 5:38 PM, karmel@) restored all three.
