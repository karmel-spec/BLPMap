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
