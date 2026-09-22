# BLP Store Map — Brigham Larson Pianos

Live interactive floor map of the piano store. Every numbered location from the
[Store Map sheet](https://docs.google.com/spreadsheets/d/12qMhAHxkRlacel5Q7qxCOwYShgDRD3O46D1cYCrlfwA/edit)
is drawn to true proportion; every active piano from the
[Piano Log](https://docs.google.com/spreadsheets/d/1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc/edit)
(column U "Location / Status") is placed on it, and the pianomoving.blp
Google Calendar drives Today's Moves, the Move Board, and the crew list.

## Run it

```sh
cp config.example.json config.json   # then paste the real secret iCal URL
python3 server.py
# open http://localhost:8641
```

`config.json` is gitignored — the moving calendar's secret iCal address must
never be committed. Without it the app still runs (map + pianos, no moves).

(Registered as `blp-storemap` in `~/.claude/launch.json`.)

## How it works

- `scripts/extract_map.py` converts a fresh xlsx export of the Store Map sheet
  into `data/slots.json` — slots (merged cells with ids like `61`, `86a`),
  zone labels, and wall segments (medium/thick cell borders), for both floors.
  The server re-runs this automatically **weekdays at 6:00 AM** (and at
  startup if slots.json is over a day old), so floor-plan edits in the sheet
  appear on their own. Open tabs pick up new geometry within ~2.5 minutes.
- `server.py` serves the static app plus `/api/data`: Piano Log CSV export +
  moving-calendar iCal feed, parsed, merged, cached 2 minutes. Falls back to
  the last good payload if Google is unreachable.
- **🎯 Brigham's Top 10** (Brigham 9/22): ☰ → Brigham's Top 10 (owners, managers,
  admins) ranks everything waiting on Brigham in three lists — shop, sales,
  admin support — scored by `/api/top10` (`netlify/functions/top10.mjs`) from
  the Piano Log, the task boards and pending mini-QCs. The Apps Script bridge
  (`top10Brief`) writes the same list into one printable Google Doc every
  morning at 6:15 (same link every day) and emails him the link.
- **Queue boxes are editable** (Keytop Q · Refinish Q · Plate Q, Karmel 9/18):
  owners, managers and admins drag ⠿ to reorder and ＋ add a piano; the order
  and additions live in Supabase `queue_order` (`supabase/queue_order.sql`,
  written by `/api/queue`). The Keytop Q also writes the new "In Key Queue #n"
  numbers back to the Piano Log. Everyone else sees the same order, read-only.
- **Agent chat** — the agents' faces bottom-right (Chris for everyone; each
  person's own helpers, e.g. Lindsay · Melody · Carla for Karmel) open an
  in-app chat with that Hermes agent through the BLP Agent Gateway
  (`netlify/functions/agent-chat.mjs`, `/api/agent`), like Marcus on the
  Marketing app — no more bouncing out to Telegram. Every message is saved
  to Supabase (`agent_messages`, `supabase/agent_chat.sql`) so threads follow
  you across devices, and the search bar in each window searches every
  agent's conversations; the device keeps a copy as an instant cache. A
  "Telegram ↗" link in the header stays as a fallback.
- `app.js` renders the SVG map (scroll-zoom / drag-pan), floor tabs, search,
  KPI tiles, piano popups (deep-link to pianologapp.netlify.app), Move Board,
  and the Unplaced / Duplicate-slot admin report.

## Piano statuses

- **In place** (charcoal) — piano's col-U location matches a map slot
- **NEW** (green) — first 7 days after latest entry date in col V
- **Scheduled** (amber) / **In transit** (red) — matched from today's calendar
  events (currently by serial-number mention; will get richer once moves
  reference slots consistently)

## Data-quality report

"Unplaced / Errors" tile → Reports: active pianos whose col-U value is blank
or unrecognized (typos like `76ish`, `sanding room`), plus slots claimed by
more than one active piano.
