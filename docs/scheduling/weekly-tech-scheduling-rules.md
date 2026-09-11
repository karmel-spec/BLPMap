---
name: weekly-tech-scheduling
description: Rules + data sources for drafting the weekly BLP technician work schedule (recurring task)
metadata: 
  node_type: memory
  type: project
  originSessionId: 7ddc8b00-d75b-45e9-9e9e-d89608f2d9e1
  modified: 2026-09-11T17:16:10.817Z
---

Recurring task: draft a Mon–Fri work proposal for BLP technicians (PDF for
Brigham's review; first one delivered 2026-07-27 to ~/Desktop). May later
write directly to Google Calendars after approval.

Data sources: Store Map /api/data (phases, tracks, queuePos), Piano Log
CURRENT SHOPWORK sections, latest Friday reports (report sheet year tab),
tech specialties tab + intern note (Sequence sheet 1k9ToAeueEg5WOtaY91xXzL-a0l_AJsSZWw23tcAWECU),
track defs (track tabs / track-defs endpoint), Task Status tab (concurrent tasks).

**Read TWO Friday-report weeks, match word STEMS (2026-08-08, Brigham
correction):** Lupita wrote "I finished restring" (ESL shorthand for
restringing) on 7/31; the map phase for M&H 55383 was never advanced, and
the 8/10 draft nearly scheduled her to re-restring it. Rules: (a) always
read the latest TWO Friday columns — completion claims often precede the
phase update by a week; (b) match phase words by stem, never exact word
(restring≈restringing≈restrung, chip≈Chip Tuning, tun≈tuning/tuned);
(c) cross-check every "finished X" claim against the map phase and treat
map phases as possibly stale — the Shop Manager briefing now has a
stale-phase detector (smStalePhases_ in DailyReport.gs) doing this daily.

**Moving calendar is a scheduling INPUT (2026-08-08, Brigham):** read
pianomoving.blp@gmail.com for the draft week before writing anything.
(a) Pickups can UNBLOCK work — e.g. "pick up a plate" Mon 9am meant Cable
Nelson 139681's plate was back Monday, so its restring was schedulable
that same week, not "blocked". (b) Deliveries to customers create
tune-then-QC obligations BEFORE load-out (tuning first, QC second; same
day as each other only when unavoidable). Urgency tiers: delivery TODAY
with no tune/QC in ~2 weeks → emergency same-day tune+QC, both entries
noted "being delivered today — expedite"; delivery TOMORROW → schedule
tune+QC the day before with a "delivers tomorrow" note (urgent, one tier
below emergency). Match delivery names to owners in the Piano Log to find
serials (e.g. "John & Gina Piet" → Cunningham 16124, "Kris Almgren" →
Mathushek 8409).

Brigham's rules so far (2026-07-27):
- **Loosely follow the queue**: prioritize pianos highest in the Custom
  Shopwork queue, BUT if no suitable tech is available for that piano's next
  phase/concurrent task, skip and schedule the next available piano's next
  phase + concurrent tasks instead. Continuity from Friday reports still matters.
- **Bottleneck report accompanies every draft**: list pianos that cannot
  advance to their next phase because a concurrent task is unfinished
  (windows from track defs; state from the Task Status tab). First try to
  SCHEDULE the blocking task into the week; only unschedulable blockers go
  on the report.
- **Phase durations from calendar history**: before drafting, analyze the
  technicians' Google Calendars historically (gog -a karmel@ calendar events
  <tech calendar> works — verified 7/27) to estimate typical scheduled time
  per phase, and size future blocks to roughly those durations.
- **Deadline notes on calendar entries**: when a downstream phase is already
  scheduled, the upstream tech's entry carries a soft-deadline note tied to
  the reason — e.g. "shoot to finish by Thu — QC is scheduled Fri", or
  "ideally wrap X by Wed because [next task] is planned next". Deadlines
  reference the dependent event, not arbitrary dates.
- **Concurrent-task timing is two-sided** (2026-07-27): each task's merged
  span on the track tab gives (a) an earliest START — schedule it as soon as
  that phase begins, especially order-lead-time tasks (parts/decal/plating
  should be kicked off at window start, not late in the window); and (b) a
  hard DEADLINE — it must be COMPLETE before the phase following the span
  begins, because that next phase physically depends on it (plate work →
  restringing; electroplated pedals/hardware + key service + parts → DHRT;
  decal → soundboard lacquer on rebuild, → refinishing on hybrid/refurb;
  parts/plating/buffing → refurb checklist on refurbishing; repair-track
  parts ordered within assessment itself). Drafts must not schedule a
  piano's next phase until its gating tasks are done/complete-able first.
- Interns (per note on tech specialties tab): variety, each task twice
  back-to-back, CAP first, PRSB needs heavy supervision, DHRT last (520-hr program).

Shift hours (Brigham, 2026-07-27): standard is **8:00–4:00** (NOT 4:30),
with occasional one-offs (e.g. Jake dentist appt week of 7/27). Exceptions:
**McKinly works until 6:00**; **Lupita 7:00–5:00 Tue/Wed/Fri only**;
**Avery Mon–Fri 8:00–noon**. Live source of truth: the **"Team Schedule"
tab on the report sheet** (11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I),
editable in Shop Manager → Schedules (team-schedule.mts bridge) — read that
tab when drafting, not these notes.

Tuning calendars (Brigham, 2026-07-27): the shop "tuning calendar" holds
**in-store tunings only**, and Brigham assigns them week by week (an empty
upcoming week just means not yet assigned — not missing data). **Field-work
tunings for McKinly and Curtis live on their own personal calendars.**

**Training loop lives in the Shop Manager app (2026-08-09, all verified live):**
Planner notes boxes + Manager Clarification answer boxes → Netlify BACKGROUND
functions on blpsalesapp (`schedule-adjust-background`, `bottleneck-resolve-background`;
sync versions removed — a revision takes 30-90s, past the 10s sync limit).
Results land in Netlify Blobs store "adjust-results" keyed by client nonce;
UI polls `adjust-result?nonce=`. Standing rules append to the **Scheduling
Rules tab** (rules WIN over defaults in the Saturday routine). Drafts persist
in localStorage until sent. **Adjustment history (Aug 10 2026, live)**: every
adjust/bottleneck run also appends to an **"Adjustment Log" tab** on the
report sheet (when-Denver/by/kind/input/outcome/rules/questions/saved —
lib/adjust-log.ts, salesapp2 commit 6de5042); Planner's 🕘 History button
reads it via GET `adjust-log?key=` (newest first). Rules-tab timestamps now
Denver (were UTC). Planner "saved" stamp renders Denver via fmtDenver(). Gotcha fixed 8/9: `CFG.` vs `CONFIG.` typo made
loadProposal silently fall back to the repo snapshot ("Apply (needs bridge
update)") — swallowed by the try/catch.

**Approve-button calendar ACL gap (found 2026-08-16):** the bridge web app
executes as brigham@brighamlarsonpianos.com, but most tech .blp calendars are
shared with his PERSONAL brighamlarson@gmail.com (owner) — NOT the business
account. Bridge apply succeeds only for Korban/Jake/McKinly (writable);
Matthew's is READ-ONLY to brigham@ (getCalendarById returns it, every
createEvent throws — a bug marked him applied anyway; fixed in repo commit
a6a66c0). **Deployed-script sync DONE (8/25 eve, Version 64 via the built-in
Claude browser pane — karmel@'s Google session lives there; Apps Script
propagation takes ~1-2 min after Deploy, poll before concluding failure).**
All repo patches live: applied-marking fix, location stamping, 🚀 appLive
brief section, 'Archived' request status. **BIG: the web app now executes
as karmel@brighamlarsonpianos.com** (deploy dialog "Execute as: Me
(karmel@)" — parallel sessions redeployed under her) — karmel@ HAS tech-
calendar write access, so the Approve button's calendar writes should now
work for ALL techs; verify on the next weekly apply before assuming.
NOTE: deployed Code.gs is ~213KB vs repo DailyReport.gs ~135KB — the repo
lags the deployed script (parallel sessions edited deployed directly);
diff before any full-file sync, never setValue the repo copy over it.

**Event-location rule (Brigham 2026-08-17, on Scheduling Rules tab):** every
scheduled piano event carries the piano's CURRENT map spot (bare value, from
/api/data by serial-in-title) in the Google event location field. Bridge
applySchedule_ does this since 3723d80; gog-based applies must pass
`--location <spot>`; never overwrite an existing location (field appts).
Until each tech calendar is shared with brigham@brighamlarsonpianos.com
("make changes"), complete Approve-button applies via `gog -a karmel@`
calendar create (karmel@ or karmel.larson@gmail.com is owner on tech cals)
then bridge markOnly. Week Aug 17–21 applied this way 8/16: 81/81 events,
audited 0 missing, all 15 techs marked, applied:true.

**Tech Calendars tab is fully mapped (2026-08-09):** all 15 active techs on
the report sheet's Tech Calendars tab. Calendars answer by DIRECT ID
(firstlast.blp@gmail.com) even though they never appear in karmel's
calendarList — probe by ID, don't trust list calls. Lupita = 
**lupitachavoya.blp** (not guadalupe...); Garrett = garrett**taylor**.blp
(Vickery is the mover). Hunter Rawlings has NO calendar yet — wire it when
someone creates hunterrawlings.blp@gmail.com. Brigham's added rules
(2026-08-09, in Scheduling Rules tab): chip tuning 2-5 days after
restringing completion; chip tunings before showroom tunings (loose);
parts dependencies get deadline appointments on Korban's calendar (he
needs explicit direction + close follow-up); QC finishes the day BEFORE a
known delivery with the delivery date noted so the tech paces.

**Store Map sheet access (2026-08-09):** karmel@ is now an EDITOR on the
Store Map spreadsheet (12qMhAHxkRlacel5Q7qxCOwYShgDRD3O46D1cYCrlfwA) — gog
sheets insert/merge/update/format all work. Slots are cells matching
/^\d+[a-zA-Z]?$/ on First/Second floor tabs; numeric cells export as FLOATS
(203.0) — normalize before matching. 213a–213f created (BK–BP 55:61,
half-width). /api/slots supports `?refresh=1` cache bypass.

Known gaps (asked 7/27, still unanswered): time-per-phase standards
(mitigate via calendar history), client promise dates, who owns parts/decal
ordering, Sadie's status, subcontractor cadence, station limits,
expert-vs-development weighting. [[blp-store-map-app]] [[blp-shop-reports]]

**Approve-button partial failure ROOT CAUSE + fix (2026-08-31):** Brigham's
Approve wrote only Curtis/Korban/Mark of 15 — Apps Script `CalendarApp
.getCalendarById` returns null for any calendar karmel@ hasn't SUBSCRIBED to
(API access alone isn't enough). Fixed durably: `gog calendar subscribe -a
karmel@ <cal>` run for all 12 missing tech calendars (she's owner on 11 —
subscribe revealed it). Recovery: created the 74 missing events via gog
(karmel@ for 11 techs, **melissa@ for Hunter** — hunterrawlings.blp is
reader-only to karmel@, owners = hunter/melissa/brighamlarson@gmail/info/
alisa/susie), then bridge `applyschedule markOnly:true` → applied:true, all
15. STILL OPEN: an owner must grant karmel@ "Make changes" on
hunterrawlings.blp@gmail.com or next week's apply fails for Hunter again
(gog has no ACL-write). Week Aug 31–Sep 4: 74 events created 8/31, all
verified on-calendar.

**Apps Script deploy gotchas (8/26, hard-won):** (1) a STALE Manage-deployments
dialog re-saves pinned to the version it OPENED with — a peer's "no-op"
re-deploy clobbered a newer live version this way. Fresh dialog → pencil →
combobox must literally read "New version" → Deploy. (2) Deployment updates
FLAP for ~5 min while propagating (old+new versions serve interleaved) —
poll the exec URL until ~10 consecutive good hits; NEVER trust the success
toast. (3) Coordinate deploys between sessions via SendMessage; one session
in the dialog at a time. Bridge now V72 (whereis + peer's clock-fix brief
section). fn=whereis: Shop Board away tiles (off/field/part), sources =
Team Schedule blanks + tech-calendar markers + live field appts, 10-min
CacheService. Team Schedule: Doris Fri + Jacob Wed now blank; Hunter row
added (8-4 M-F).

**2026-09-03: Weekly reports moved Friday → THURSDAY 6pm.** Storage unchanged: report
sheet (11RoeVRETag…) year tab "2026", row1 = FRIDAY-date week labels (shop app submits
via thisFriday(), so Thu submissions land right). Manager Weekly Review reads that
column — no separate tab exists. Scheduled task `thursday-report-sweep` (Thu 6:04pm,
desktop app must be open): reads week column, roster = Current Team Position~tech +
Doris, excludes Victoria; texts missing folks via request-notify; ALWAYS texts
Brigham+Karmel a summary. Ricardo has NO phone on Tech Phones (sends fail) — still
pending. 9/3 manual sweep: reminded Avery/Garrett/Korban/Matthew/McKinly/Sadie.

**2026-09-04: SCHEDULING DAY moved Sat/Sun → FRIDAY**, Mark assisting Brigham and
eventually taking over. Flow: reports due Thu 6pm → Fri morning Brigham+Mark build
next week in the Shop Manager Planner (fills from weekly reports; missing techs fall
back to last week's report). 9/4 status: 15/16 in after the Thursday sweep texts
worked; Ricardo (Intern) the only straggler (phone added late 9/3), Victoria excused.

**2026-09-11 (Brigham): size schedule blocks from Work Clock ACTUALS** —
bridge ?fn=timelog rows {tech,serial,phase,minutes}; filter ≥10min, drop
Claude/test rows; prefer the tech's own median piano-hours per phase, then
all-tech phase median, then blp-phase-time-standards.md (calendar estimates,
now fallback only). At ~3.5 wks of data: DHRT≈30h/piano, CAP≈19h,
restring≈13h, PRSB≈14h, full key set≈26h, QC≈5h. Recompute each draft;
put pace-based wrap-day predictions in lane notes. Baked into the
friday-schedule-draft task prompt 9/11.

**2026-09-11: scheduled task `friday-schedule-draft` (Fri 7:04am, desktop app
must be open)** — drafts next week's proposal per these rules, saveproposal to
Proposal Store (never overwrites a same-weekStart draft), texts Mark + summary
to Brigham/Karmel. Pairs with thursday-report-sweep (Thu 6pm). NOTE: the
Weekly Review's "Connect Google Calendar" button is the LEGACY client-side
OAuth path — it maps techs from the SIGNED-IN user's calendarList by name,
so it only half-works for Brigham and does nothing for Mark (markhales.blp
has no tech calendars). It only feeds the in-page assigned-counts/bumps;
proposal save + Approve/apply run server-side as karmel@ and need no
connect. Future cleanup: replace with a bridge fn.

**2026-09-04 (first FRIDAY scheduling session): Sep 7–11 proposal drafted + saved**
to Proposal Store (action saveproposal; Planner verified serving it). REPORT-OVER-CARD
rule now EXPLICIT from Brigham: when a weekly report contradicts the card phase, trust
the report and plan the NEXT phase (plan JSON carries reportOverrides[] listing each).
Overrides this week: 7912 QC done→2nd tuning; 4329 CAP done→PRSB; 29908 lacquer
done→restring; 60534 refinish done→assembly; 181349 done→Jake freed. URGENT caught:
Hallet Davis grand 1700946 (card PAUSED) delivers Jackson WY Thu 9/10 → Korban tunes
Mon, Curtis QCs Tue. Lupita's new hours M-Th 7:00-12:30 (from her report — Team
Schedule tab needs the edit). Jake parked on 154950 while 38930 waits on Renner/Abel
customer answer. Plan JSON shape: {week, weekStart, colors{key:hex}, techs:[{name,
hours, who, days:[[ [start,end,colorKey,title,note] ]x5]}], bottlenecks[],
reportOverrides[]}. Keytop Q map button (v330) feeds Marcelo's queue picks.

## Weekly automation chain (as of 2026-09-11)
- Thu 6:00 PM `thursday-report-sweep` — report reminders + GO/no-GO text to Brigham + Karmel.
- Fri 7:00 AM `friday-schedule-draft` — Claude drafts next week's 16-tech proposal → Proposal Store; texts Mark/Brigham/Karmel.
- Mark revises in Store Map → Scheduler → Planner (Manager Clarification + schedule notes) during Friday.
- Fri 4:30 PM `friday-schedule-approval-nudge` (added 9/11) — reads bridge ?fn=proposal (meta.savedAt/applied),
  runs the review checks (TENTATIVE blocks, 3+ techs on one serial/day, open bottlenecks, Tech Calendars gaps,
  Korban <10 tunings, off-day blocks), texts Brigham the status + "review Planner & Approve", copy to Karmel,
  logs an App Updates row. Fires whether or not Mark's final revision landed (wording differs).
- Approve = Planner button (no PIN since sched.js v22) → bridge applyschedule writes live tech calendars.
- 9/11 review of the Sep 14–18 proposal texted to Brigham + Karmel (6 items: Mark Wed–Fri TENTATIVE, Alex Martin
  missing, 3 techs on Steinway 3536 Mon–Tue, Conover 4329 unattended, Korban Fri 9:30 open, Jake Tue QC on 154950).
