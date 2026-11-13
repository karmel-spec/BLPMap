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

**Resolved bottlenecks stay closed (Walter 2026-10-16, also on the Scheduling Rules tab):**
a bottleneck answered "Resolved" in the Planner, or shown as cleared in the piano
card's SCOPE NOTES / PIANO NOTES (/api/data `scopeNotes`, `pianoNotes`), is closed.
Never carry it into a later draft or re-raise its old cause unless a NEWER weekly
report or card note says it is blocked again. If the piano still needs a tech,
raise only that (e.g. "DHRT lane unassigned"). Check the card's Scope Notes and
Piano Notes before carrying ANY bottleneck forward. (Kranich & Bach 60534 was
re-raised on 10/16 as "bottom board not located, let-off buttons not ordered"
after being answered Resolved on 10/2 and twice on 10/13, and the card's scope
note said "Bottom board located; let-off button issue resolved by Garrett".)

**A manager's tuning priority list outranks pre-booked tunings (Mark 2026-10-19,
also on the Scheduling Rules tab):** when Planner notes name pianos as Korban's top
tuning priority (with or without days/slots), schedule those first exactly as given —
Brigham's priorities trump everything, pre-booked tunings included. Then re-place
EVERY pre-booked piano the list displaced into the slots that remain this week, in
their original order, then overflow to next week. Never drop a pre-booked piano and
never leave a slot empty while a pre-booked piano is unplaced. Say in changes which
pre-booked tunings moved where; Approve moves the calendar events to the plan's slots
and refuses to stack a tuning on a slot another piano still holds. (On 10/16 the list
was written literally over the calendar: Monday and Tuesday 8:00 went out double-booked
and Wednesday went out empty.)

**Rentals (Mark 2026-11-10):** phase **Out on Rental** = the piano is at a renter's home
(spot "Rented — was at …", CURRENTLY RENTED section). It is NOT in the building: never
schedule work, QC or a tuning for it, and never treat it as a for-sale floor piano. Phase
**Rental Check-in** = a rental just came back and needs checking over before it goes back to
For Sale — list it in the draft's changes as "rental check-in needed"; don't invent work for
it beyond what its card says.

**Standing meetings (Mark 2026-11-04, rewritten 2026-11-10 — Scheduling Rules row 104):**
**Manager Meeting** (Tuesdays 10:30–11:30: Brigham, Karmel, Mark, Jacob, Matthew) is a
recurring Google Calendar event. **Tuning Training is NOT recurring anymore** — Mark adds it
to the calendar by hand when it happens — but **every Thursday 10:30–11:30 stays open for
Brigham, Karmel and Mark** whether or not a Tuning Training event exists. Nobody else is held
for it (Jacob, Sadie and Hunter removed 11/10 — never block that hour or add a training block
for them). Never put either meeting in the plan (no block, so Approve writes no event —
Brigham and Karmel have no tech calendar, so plan blocks never reached them). Treat those
hours as taken on each attendee's calendar and schedule their other work around them, like a
pre-booked tuning.

**Korban's monthly HVAC filter check (Mark 2026-11-04, Scheduling Rules row 113):**
on the **first Wednesday of every month**, a **"BLDG: HVAC filter check"** block
2:30-3:00 (exact title); that day his Hardware Buffing Queue ends at 2:30. If he is
out that Wednesday, put it on his next shop day that week, same time. No calendar
note. The Planner owns it (no recurring Google event) — first one Wed 12/2/2026.

**Korban's Hardware Buffing Queue (Mark 2026-10-19, Scheduling Rules row 90):** one
block per day, 11:00-15:00 — **Monday 11:00-14:30**, followed by a **"Vacuum
maintenance: clean filters, empty buckets" block 14:30-15:00 every Monday** that the
plan schedules itself (Mark 2026-11-02: the standing recurring event on his calendar
was deleted, so the Planner now owns it — use that exact title). Do NOT write job lists in the
block's note: Approve fills the event from the live buffing list. Only a rule-10
`DEADLINE:` line may go in the note.

**Alex works Saturdays (Mark 2026-11-13):** his days are Monday, Tuesday, Thursday,
Friday and Saturday. His plan lane has a 6th day (`days[5]` = Saturday) and Approve
writes it to his calendar: Friday's shop work copied over, minus Friday-only blocks
(Friday Shop Organization), around any field appointment on his own Saturday calendar.
No one else gets a Saturday unless their hours say so.

**Korban's tuning slots (Mark 2026-11-12, replaces Walter 10/14; Scheduling Rules row 95):**
two slots a day — FIRST 8:00 (Fridays 8:45, after shop tidying) and SECOND 9:30
(Fridays 10:15).
- **FIRST = showroom tunings.** Matthew's walkthrough tunings come in as Store Map
  requests and book this slot themselves (bridge `korbanSlot_`); after them the
  **Tuning Queue** — `tuningQueue` in Store Map /api/data (⚡ ASAP first, then walk
  order). If /api/data answers with `tuningQueuePending`, fetch again after 30 s;
  never fill slots from a missing queue.
- **SECOND = only a shopwork piano's 1st Tuning or 2nd Tuning — decided by the CARD
  PHASE only.** A piano whose card phase is 1st Tuning or 2nd Tuning counts whatever its
  section — BLP-owned and consignment pianos after refurb or rebuild work too (Mark
  11/13, Baldwin 167698). A Store Map service request, a QC or a showroom repair does
  NOT make a showroom piano shopwork and doesn't by itself call for a tuning; a tuning
  requested for it is a showroom tuning (first slot). The delivery rule still holds: a
  piano that delivers gets its tune-then-QC before load-out (delivery tunings below). If no shopwork tuning is due that
  day, the second slot stays empty — unless a bumped pre-booked tuning needs a slot this
  week (bumped tunings, below).
- **Thursday 9:30 and Friday 10:15 are HELD** for pianos that finish DHRT that week
  (their 1st Tuning): no plan block there, no showroom piano. At **Wednesday 6:00 PM**
  the bridge (`fillHeldTunings_`, from the daily 6 PM trigger) fills a held slot still
  open by moving up the next showroom Store Map request booked later (not delivery /
  concert tunings, not shopwork pianos), else the Tuning Queue; anything left is open
  to showroom requests.
- **Chip tunings are not Korban's** (row 102): the technician doing a piano's DHRT does
  its chip tuning before beginning DHRT — no waiting days after restringing (rows 8 and
  24 superseded). Make it the first block of that tech's DHRT, typed tune, titled
  "<make> <serial> - Chip Tuning"; if no one has the DHRT yet, ask who takes it.
- Pre-booked tunings stay as they are — except a showroom tuning booked into a 9:30
  before 11/12: when a shopwork piano is ready for its 1st/2nd Tuning that week, the
  shopwork piano takes the 9:30 and the showroom tuning moves to the next free 8:00
  (row 116). Shopwork 1st/2nd and Store Map request tunings overflow to next week;
  Tuning Queue pianos never carry over.
- **Brigham's priority list outranks everything**, the Thu/Fri DHRT hold included.
- **Deliveries are self-serve (Mark 11/13):** never ask whether a delivery needs a tuning.
  Every customer delivery on the moving calendar with a serial and no tuning already booked
  for that serial gets BOTH, unasked: Korban's pre-delivery tuning (the workday before the
  delivery, by the slot rule below) and the QC after it the same day — the tuning ends
  before the QC starts. Exceptions stay: storage returns, moved-only pianos, outside-shop
  trips, QRS-only pianos (30-min QC). A delivery with no serial → ask for the serial.
- **Rulings from the 11/13 rule review (Mark) — all on the Scheduling Rules tab:**
  tune then QC, always (the short-QC-first sequence is retired, row 30); deliveries are
  matched by serial only — a client-name match is a reason to ask (rows 3, 47); pre-booked
  tunings are never deleted, moved only by the rules (row 90); restringing is allowed with
  the plate AFTER, Back in piano or In piano, never BEFORE or At Curtis Harper (row 89);
  different phases on one piano overlap with no note, except no DHRT while the piano is in
  the refinishing shop (rows 108, 119); personal appointments go through Time Off, no
  placeholder blocks (row 63); Korban's Friday buffing is 11:45–3:00 (row 85); only the
  technicians a note names change, except a delivery's tune/QC and field appointments
  that follow the tech's calendar (row 109).
- **Bumped tunings (Mark 11/13; row 31 rewritten):** a tuning bumped by a manager's
  priority list, a shopwork 1st/2nd tuning, a delivery tuning or a queue jump goes to an
  OPEN slot THIS week first — an open 8:00, then an empty 9:30 (row 100: never leave a slot
  empty while a pre-booked piano is unplaced) — and to next week only when this week is
  full. The Thursday/Friday holds still wait for the Wednesday 6 PM fill.
- **Delivery blocks' calendar note (Mark 11/13):** exactly "Delivery <weekday> <M/D>"
  (`[CAL: Delivery Tuesday 11/17]`) — never the client's name, no other schedule wording;
  a check-up QC may add the prior QC date.
- **Plates:** a piano whose plate is "Plate storage — BEFORE" must not be scheduled for
  RESTRINGING (row 89; rows 97 / 101 now point to it) — other phases are scheduled as usual.
- **Delivery tunings (Mark 11/12, option A; row 117):** a pre-delivery tuning takes
  Korban's 8:00 (Fri 8:45) on the day it's needed; a showroom tuning already there
  moves to the next free 8:00. Only when that 8:00 holds another delivery tuning or a
  Brigham priority does the delivery take the 9:30 (Fri 10:15), held slots included.

Data sources: Store Map /api/data (phases, tracks, queuePos, tuningQueue), Piano Log
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

**Outside-shop trips are NOT deliveries (Mark 2026-10-29).** A moving-calendar
trip that takes a piano TO an outside shop or specialist — Barrus Pianos,
David Hyde, Curtis Harper (plating), a QRS or player installer — gets no
pre-delivery tuning or QC, even when the piano is sold. Outside work (QRS and
player installs above all) is checked AFTER the piano comes back: schedule its
QC once the return is on the moving calendar, before the trip to the customer.
A Piano Log note like "we are putting a QRS on" means the QRS is NOT on yet.
(Chickering 80147, week of 10/26: "Barrus: Swap uprights" took it to Barrus to
have its QRS installed; the draft read it as a delivery and booked a 30-minute
"pre-delivery QC" the day before — Melissa, 102626terry10.)

**A tune or QC already booked satisfies the delivery obligation (Mark
2026-11-06).** Before adding a pre-delivery tuning or QC for a piano that
delivers in the plan week, check the 20-QC & Showroom Repairs calendar
(qualitycontrol.blp@gmail.com), the 03-In Store Tuning calendar and the tech
calendars for that piano's serial from TODAY through the delivery date — not
just the plan week. An event already there (any tech, any day before the
delivery) IS the obligation met: don't propose another, and say in the lane's
who-line who has it and when. Only when nothing is booked does the draft add
the tune-then-QC. (Schafer & Sons HIJG0085, week of 11/9: Melissa had booked
McKinly's "QC for delivery" for Fri 11/6 2:00 on the QC calendar; the draft
saw only the Monday 6:45 PM rental delivery and gave Jake a second QC Monday
morning.)

**Plate status and the Waiting on Curtis Harper phase (Mark 2026-11-09,
revised 2026-11-10).** The card moves the PHASE from the plate status, never
the other way: plate → At Curtis Harper sets the phase to Waiting on Curtis
Harper (the waiting note records the phase it left); a plate back from Curtis
(AFTER storage, Back in piano, In piano) sets the phase to Restringing,
always; a plate leaving Curtis for BEFORE storage or blank puts the phase
back to the one the note recorded. Setting the phase to Waiting on Curtis
Harper does NOT change the plate (request 111026hales81): the plate can sit
in **Plate storage — BEFORE** while the piano waits for Curtis to take it.
**Waiting on Curtis Harper means Lacquer Soundboard is complete — the last
step before the plate can go back in — and the piano is ONLY waiting on Curtis
Harper for its plate (Mark 2026-11-11)** — the plate stays on the rack slat it
was given in CAP (it sits there all through PRSB and Lacquer Soundboard) and
the map letters it purple. When the refinished plate is back (AFTER storage /
Back in piano) the phase goes to Restringing. **Restringing needs the plate
(Mark 2026-11-11):** any move INTO Restringing while the plate still reads
Plate storage — BEFORE or At Curtis Harper lands as Waiting on Curtis Harper
instead (AFTER, Back in piano, In piano or blank → Restringing as asked; sale
phases skipped). "Removed" is no longer a plate status. So: treat **Waiting on Curtis
Harper** as "hold restringing" whether the plate reads At Curtis Harper or
Plate storage — BEFORE — both are normal, neither is a bottleneck to flag;
treat **Restringing + Plate storage — AFTER** as "just back from Curtis" —
Lupita's next restring per the rule below. Still flag as a stale status: a
phase past Restringing with the plate still on AFTER, or Waiting on Curtis
Harper with the plate on AFTER / Back in piano / In piano (the plate is back).

**AFTER plates go to Lupita (Mark 2026-10-30).** When a piano's card PLATE
STATUS reads **Plate storage — AFTER** (refinished plate back from Curtis
Harper), its restringing is **Lupita's next restringing assignment** —
schedule it to start as soon as her current restring wraps, in shop-queue
order when more than one AFTER plate is waiting — no note needed, and another
tech on a DIFFERENT phase of that piano (keytops, DHRT, refinishing) is not a
conflict. Don't give it to another restringer unless a manager's note says so. If the card's phase is already
past Restringing (e.g. Exit Prep with the plate status still on AFTER),
don't schedule a restring — flag the stale plate status as a bottleneck.
(Schaeffer 23910, week of 11/2: AFTER plate, phase Restringing, while
Lupita's 160095 restring was done.)

**One technician per phase (Mark 2026-10-30).** A piano's phase — its CAP,
its DHRT, its restringing — has ONE technician on it on any given day unless a
manager's note pairs two by name ("Hunter joins Avery on the 211935 CAP").
Never double techs up on one phase on your own and never put a second tech
"behind" the first. DIFFERENT phases on the same piano may overlap —
restringing and DHRT, keytops alongside other phases — that is fine and needs
no note: another tech on a different phase is never a reason to leave someone
unscheduled (week of 11/2: Lupita's week came back blank because Marcelo had
the Schaeffer's key service — wrong). (Week of
11/2 draft: "Jake opens the Decker DHRT with Garrett behind him from Thursday";
earlier, Hunter + Avery both on the 211935 CAP — neither asked for.)

**Only the technicians a note names change (Mark 2026-10-30).** In a revision,
change a tech only if a note is written for them, names them, or is GLOBAL.
Never re-staff or "cover" a piano another note emptied — flag the open lane
instead. Apply adjustments throws away changes to unnamed techs.

**Calendar titles (Mark 2026-10-30).** (1) When a Planner note (a tech's box
or the GLOBAL box) says to put words in the calendar TITLE ("add xyz to the calendar title", "as the exact title",
"in the title"), those words go into the block TITLE verbatim — not into a
`[CAL: …]` segment. (2) Any block whose event will carry a description (a
`[CAL: …]` note, or 🏆 sale lines on the card) gets " (see notes)" at the end
of its title — Approve adds it automatically, so don't write it yourself.
Korban's Hardware Buffing Queue block is exempt (its description is the
standing queue list). Most blocks have no note and no "(see notes)".

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
- **Deadline notes on calendar entries** — RETIRED (Mark 2026-10-30): no
  automatic "Deadline: shoot to finish by …" line on a tech's calendar. A
  deadline goes on the calendar only when a manager's note asks for it.
  (Korban's hardware-ready DEADLINE inside his Hardware Buffing Queue block,
  rule 10, is separate and stays.)
- **Calendar block notes (Mark 2026-10-26, standing rule):** a block's note is
  `[CAL: what the technician sees] what the managers see`. Approve puts ONLY the
  `[CAL: …]` segment on the technician's event; everything after it stays in the
  Planner. Set `"calNotes": "cal-only"` at the top level of the plan JSON so
  Approve knows the plan follows this rule (a block with no segment then gets no
  description).
  - **NEW information only (Mark 2026-10-30):** the segment carries only what
    the technician does NOT already know — a manager's instruction from the
    notes, a client's request about the piano, parts that arrived or are now
    holding the work, a problem someone else found. Words a manager's note
    asked to put on the calendar are copied verbatim. NEVER restate the
    technician's own weekly report — what they did, what's left, their next
    steps, days to finish — they wrote it. Never repeat facts already on the
    card (tuned to 432 Hz, finish, model details). **Most blocks get no
    segment.** (Garrett's 11/2 Monday segment restated his report — "three
    days left per your report. Hammers aligned… after-touch is the open step"
    — plus a deadline and the 432 Hz pitch: all redundant.)
  - Second person / imperative: "Next steps: finish the let-off", "Waiting on #9
    bridge pins", "Bush the pedal rod hole with felt". Never he/she/his/her/they
    or the technician's name.
  - Never in the segment: anything schedule-related (times, days, dates, end
    times, days off, field bookings, "full shop day", open slots, who covers
    what, reassignments, pacing, deadlines unless a note asks); anything private (health,
    personal matters, progress or performance comments, payment status, client
    contact details); client / owner names (not confidential — just not
    useful: technicians work by make, model and serial; Melissa, Brigham and
    Mark are the ones who use owner names); anything written for the managers rather than the
    technician — why the block is here, card or scope-note status ("That closes
    the card's 'CAP stays open - waiting for new whippens' scope note, so the CAP
    can actually finish this week" is for Mark, not Avery), twin-check / duplicate-
    serial notes ("also on the TWIN CHECK list… distinguish by serial"), report
    echoes, queue ranks, "continuing"; the make/serial or spot (title and
    location carry them).
  - Nothing piano-specific to say → no segment.
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
**McKinly works until 6:00**; **Lupita Mon–Thu 7:00–12:30** (Mark 11/13; her weekly report overrides);
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

**In-store tuning protocol — the overlap is DELIBERATE (Walter 2026-09-18):**
an in-store tuning is created on the **"03-In Store Tuning"** calendar
(blp.matthewputnam@gmail.com) and the technician is added as a **guest**, so it
reaches their own calendar as an invitation. `scheduleTuning_` already does
exactly this. The weekly plan is a SEPARATE system: applySchedule_ writes plan
blocks straight onto the tech's own calendar, no master, no guests. So a
planned tuning block and the real tuning appointment can sit in the same slot
on Korban's calendar. **That is the protocol working, not a double-booking to
report or clean up** — never raise it as a conflict, never delete one side,
never "resolve" it by moving a tuning off the In Store Tuning calendar.

**Tech Calendars tab is fully mapped (2026-08-09):** all 15 active techs on
the report sheet's Tech Calendars tab. Calendars answer by DIRECT ID
(firstlast.blp@gmail.com) even though they never appear in karmel's
calendarList — probe by ID, don't trust list calls. Lupita = 
**lupitachavoya.blp** (not guadalupe...); Garrett = garrett**taylor**.blp
(Vickery is the mover). Hunter Rawlings' calendar is
hunterrawlings.blp@gmail.com ("16-Hunter Rawlings", readable as of 11/4). Brigham's added rules
(2026-08-09, in Scheduling Rules tab): chip tuning 2-5 days after
restringing completion [SUPERSEDED 11/12: the DHRT tech does it before
beginning DHRT, no wait]; chip tunings before showroom tunings (loose);
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
15. Week Aug 31–Sep 4: 74 events created 8/31, all verified on-calendar.
**CLOSED 2026-09-18 (Walter): karmel@brighamlarsonpianos.com now has "Make
changes" on hunterrawlings.blp@gmail.com** — Hunter applies from karmel@ with
everyone else, no melissa@ detour. The old "STILL OPEN" wording stayed here
for ~3 weeks after the grant and the Friday draft kept raising it as a
manager clarification every week, because this file is an INPUT to that
routine. Close items here when they are done — a stale line becomes a weekly
false alarm. If Hunter is ever skipped on Apply again, re-check the sharing
before believing any note.

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

**Technician OUT (Mark 10/23/2026).** When the shop manager says a technician is out, on vacation,
"out all week", "clear his/her week" or "do not schedule him/her this week", that technician gets
NO work that week: five empty days, hours blank, `who` = "OUT this week — <reason>". Do not carry
a lane forward onto them, and do not move their work to someone else unless the note says who
takes it. They stay empty in later revisions until a note says they are back. The Team Schedule
tab's off-days are the same idea for recurring days off.

**Approved time off (Mark 10/23/2026).** Read the bridge's `fn=timeoffrows` and treat every row with
status `approved` that falls in the plan week as binding: a whole day off (no Times value) gets no
blocks for that technician; a partial day (a Times value such as "8–noon") gets nothing in those
hours. This is independent of the Team Schedule tab and of calendar off markers — approving a
request in the Store Map is enough on its own. Approve skips approved whole days too.
