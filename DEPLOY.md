# Machine-independent hosting

Live site: **https://blpstoremap.netlify.app** (auto-deploys from this repo's
`main` branch). Once the pieces below are in place, nothing depends on any
local computer.

## Who does what, where

| Job | Runs on | Config |
|---|---|---|
| Map + stats + reports UI | Netlify (static) | auto-deploy from GitHub |
| `/api/data` (Piano Log + calendar) | Netlify Function | Google sign-in, or `BLP_DATA_SECRET` for server jobs. `BLP_MOVING_ICS` optional |
| `/api/slots` (floor-plan geometry, live from the sheet, 6 h cache) | Netlify Function | none — `netlify/functions/slots.mjs` |
| `/api/agent` (in-app chat with Lindsay / Melody / Chris … — the Hermes agents) | Netlify Function | `BLP_GATEWAY_URL`, `BLP_GATEWAY_KEY` env vars |
| `/api/queue` (drag-to-reorder + ＋ add for the Keytop / Refinish / Plate Q boxes — owners, managers & admins) | Netlify Function | `SUPABASE_SERVICE_KEY`; run `supabase/queue_order.sql` once |
| Daily report email (weekdays 6 AM) | Google Apps Script as info@ | `apps-script/DailyReport.gs` |
| 🎯 Brigham's Top 10 brief (6:15 AM Mon–Sat, Google Doc + email) | Google Apps Script `top10Brief` ← `/api/top10` Netlify Function | `BLP_DATA_SECRET` in Script Properties (same value as Netlify). Run `setupTop10Brief()` once |

Geometry needs no cron at all: `/api/slots` regenerates from the Store Map
sheet on demand (cached 6 hours), so floor-plan edits appear the same day.
`data/slots.json` stays in the repo only as a fallback snapshot.

## Piano records require a BLP Google sign-in (October 2026)

`/api/data` and `/api/top10` used to answer anyone, including other websites
(the response allowed every origin). They return the Piano Log — customer
names, phone numbers, emails, and addresses. They now answer only:

1. A person signed in with Google on the **same team list the map already
   uses** (`blp-team.js`). The server checks the ID token's signature,
   expiry, audience (this app's OAuth client ID), and `email_verified`.
   A missing or bad token is **401**. A real Google account that is not
   on that list is **403**. Neither response includes piano records.
2. A server job that sends header `x-blp-data-key` equal to the
   `BLP_DATA_SECRET` environment variable. The browser never sees this
   value. Do not commit it.

There is no `Access-Control-Allow-Origin: *` on these endpoints anymore,
so the Shop app's browser cannot read them cross-origin. A server on that
side can call with `x-blp-data-key` if it still needs the feed.

### Who counts as the team

`blp-team.js` is the only copy. The page loads it, the Netlify functions
import it, and `server.py` reads the same three lists. An email is allowed
when, after lowercasing:

- it ends with `@brighamlarsonpianos.com`, or
- it ends with `.blp@gmail.com` (the shop Gmail accounts, such as
  `curtisbiggs.blp@gmail.com`), or
- it is listed in `EXTRA_EMAILS` (today that is only `brighamlarson@gmail.com`)

Gmail dots and +tags are not stripped. That matches how the map has always
compared these addresses.

To add someone: a new workspace mailbox or a new `name.blp@gmail.com`
account is already covered. Any other address goes in `EXTRA_EMAILS` in
`blp-team.js`, then deploy. To remove someone, delete that extra address,
or narrow the suffix lists if a whole pattern has to stop.

The sign-in screen is the one the map already had ("Sign in with Google").
The client already exists: karmel@'s Google Cloud project **BLP Store Map**,
web client

`110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com`

(the same ID hardcoded in `app.js`). It already accepts the team's Gmail
accounts, so leave the OAuth consent screen able to sign those accounts in
(do not switch it to Internal-only). Confirm in Google Cloud Console →
APIs & Services → Credentials → that OAuth client:

- Authorized JavaScript origins: `https://blpstoremap.netlify.app`
  and, for local dev, `http://localhost:8641`
- Authorized redirect URIs: `https://blpstoremap.netlify.app/`
  and `http://localhost:8641/`

The redirect URI is required because the visible button uses Google's
OAuth page and comes back to the map with the ID token. If that client
is ever deleted, create a new Web application client with those origins
and redirect URIs, on a consent screen that allows the team's Gmail
accounts. Put the new client ID in the Netlify variable below **and** in
`GOOGLE_CLIENT_ID` in `app.js`. Until those match, every sign-in gets 401.

### What Karmel sets before this ships

Do these **before merging**, or the map and the morning jobs break on deploy.

1. **Netlify** → blpstoremap → Site configuration → Environment variables.
   Apply to all deploy contexts. Then trigger a deploy (or merge, which deploys).

   | Variable | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | `110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com` |
   | `BLP_DATA_SECRET` | a long random string (at least 16 characters). Generate one; do not reuse the team PIN. |

   If `GOOGLE_CLIENT_ID` is left unset, the function falls back to the client
   ID already in `app.js`, so the map still recognizes staff tokens. If it is
   set to a **different** ID than `app.js`, nobody can load pianos.

2. **Apps Script** (the "Store Map Daily Report" project) → Project Settings
   → Script properties → add `BLP_DATA_SECRET` with the **same** value as
   Netlify. A code paste cannot see or erase Script Properties.

3. **Redeploy the bridge** from `apps-script/DailyReport.gs` (rev
   `2026-10-08.1`) signed in as karmel@. The daily report, the shop-manager
   report, the scorecard snapshot, and Brigham's Top 10 brief all read
   `/api/data` or `/api/top10` and now send `x-blp-data-key`. Until that
   paste is deployed, those jobs get 401. The ping's `secrets` field lists
   `BLP_DATA_SECRET` when the property is missing. Confirm `rev` is
   `2026-10-08.1`.

4. **Then merge.** Anyone who can sign in to the map today (workspace
   address, `.blp@gmail.com`, or `brighamlarson@gmail.com`) still sees the
   map. A logged-out request to `https://blpstoremap.netlify.app/api/data`
   returns 401 and no pianos.

Local dev: the same rules apply in `server.py`. Put `blp_data_secret` in
`config.json` (gitignored; see `config.example.json`) or export
`BLP_DATA_SECRET`.

## One-time setup

### 1. Netlify environment variables
Piano records need `GOOGLE_CLIENT_ID` and `BLP_DATA_SECRET` — see **Piano
records require a BLP Google sign-in** above, and set those before merging.
**Agent chat** (tap an agent's face bottom-right → chat window, added Sep 18 2026) also needs:

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

#### Calendar and moves — no extra env vars
Calendar events are served by the Apps Script bridge (`GET <bridge>/exec?fn=events` — the secret iCal address
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
Deployed rev `2026-09-27.1` (Version 178) on Sat Sep 27 2026 from karmel@ via Claude in Chrome (clipboard paste, 439,707 UTF-16 units verified against the repo file) — ping `enc` intact, `drive:"ok"`, `secrets:"ok"`, `fn=events` 19 events; first `setcrmid` write (289994 → CRM client 4178) ok. Adds the `setcrmid` action / CRM CLIENT ID column.

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
