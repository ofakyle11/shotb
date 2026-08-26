# 1st Assistant Director — scheduling, boarding and the call sheet

**Verdict up front.** You can board a *short* here — seed strips, drag them onto days,
tag stunts/SFX, print a DOOD. You cannot schedule a feature. Three things stop it
cold: (1) the strips' cast list is a case-insensitive word search over scene prose,
so the DOOD calls actors on days they don't work — and it is silently *empty* if you
paste the script through the Producer Suite's own "Add script" button; (2) nothing in
the scheduler knows a calendar, so cast availability, turnaround, 6th/7th day and meal
penalties are unrepresentable even though `TMoney.timecard()` already computes all of
them, correctly, 20 lines away; (3) the board has no shooting order *within* a day, no
day-level operations, no banner/day-break strips, and the boneyard drop zone doubles
its own event listeners on every unschedule drag until the tab locks.

The call sheet is a scene list, not a call sheet. One general call for everyone, held
(`H`) actors printed in the cast-call block, no address, no hospital, no per-department
calls. A crew would not accept it.

---

## What exists and works

- `producer/schedule-board.js:14-37` — `formatEighths`/`parseEighths` are correct
  eighths math (`15 → "1 7/8"`, `"1 7/8" → 15`, `"2.5" → 20`). This is the right unit
  and it round-trips. Tested at `scripts/test_producer_suite.mjs:76-85`.
- `producer/schedule-board.js:148-179` — `doodMatrix()` produces genuine SW / W / H /
  WF / SWF codes with TOT / WRK / HLD columns, sorted by work days. The code assignment
  logic (first==last → SWF, first → SW, last → WF, gap inside span → H) is right.
- `producer/schedule-board.js:116-143` — `boardOverridesModel()` feeding real board day
  assignments back into the budget estimator is a genuinely good idea and it works:
  `castDood` overrides the estimator's script-order guess at
  `timeline/timeline-budget.js:585`, and breakdown tags override the keyword heuristics
  at `timeline/timeline-budget.js:667-674`. The seed toast is honest about whether the
  board was used (`producer/budget-sheet.js:351-352`).
- `producer/schedule-board.js:250-297` — the per-strip breakdown editor (slugline,
  eighths, D/N, background count, cast, six element tags, notes) covers the core
  breakdown fields and persists cleanly.
- `tools/lib-sun.js:33-62` — real NOAA/Meeus solar math, not an approximation table.
  `sunTimes()` returns dawn / sunrise / golden AM end / golden PM start / sunset / dusk.
  This is the correct engine for a call sheet's sun block.
- `tools/sched-weather.js:93-156` — the Day Planner is the best scheduling feature on
  the platform. Start date + location + skip-weekends → per-day calendar dates,
  sun times, live Open-Meteo forecast, and a 0-100 shoot-risk score. Keyless, fetched
  client-side, degrades to astro-only when offline.
- `tools/lib-money.js:47-111` — `timecard()` is a real production payroll engine:
  1.5× after 8 worked, 2× after 12 elapsed, 3× golden after 15, escalating meal
  penalties per half-hour, turnaround-invasion forced call, 6th/7th-day multipliers,
  fringes. Parameterized via `TC_DEFAULTS` so a production can match its own agreement.
  Nothing here needs rewriting — it needs *connecting*.
- `casting/lib-castdesk.js:39-52, 56-82` — `cueName()`/`charactersFromScript()` do
  character extraction *properly*: an ALL-CAPS cue line, suffix-stripped, rejected if
  it's a transition or has no dialogue under it. This is the extractor the stripboard
  should be using and isn't.
- `casting/lib-castdesk.js:87-109` — `holdConflicts()` correctly finds the same performer
  held/booked on overlapping ISO date ranges across roles.
- `locations/lib-scout.js:508-533` — the tech-scout checklist and `blankLocation()`
  carry exactly the call-sheet fields (hospital, hospital address, parking, power,
  load-in) and the UI tells the user so (`locations/index.html:78, 185`).
- `today/index.html:81-136` — the mobile day view is closer to a real call sheet than
  the Producer Suite's own: it joins the Scout Book for the hospital block and runs
  `CSafety.meetingChecklist()` for today's scene numbers. Right instinct, wrong joins
  (see below).
- `production/lib-prod.js:87-95` — CSV injection guard (`= + - @ \t \r` → leading
  apostrophe) is correct and matches the platform rule.

---

## What exists but needs work

### HIGH — the board's cast list is a word search, so the DOOD lies

`timeline/timeline-budget.js:407-415` builds `sceneCast` by testing
`new RegExp('\\b' + name + '\\b', 'i')` against each scene's *entire prose body*. A
character mentioned in action or in someone else's dialogue is scored as present.
Verified against a two-scene script:

```
INT. BAR - DAY      →  cast = ["JACK","MAYA"]     (MAYA is only mentioned:
                                                   "He asks about MAYA. She is not
                                                   here." / "Where is Maya?")
INT. CAR - NIGHT    →  cast = ["MAYA"]
```

MAYA gets `SW` on day 1 and a work day she does not have. On a feature this is not a
rounding error — it inflates work days, holds and span weeks for every named character,
and `boardOverridesModel()` (`producer/schedule-board.js:116-143`) pushes exactly those
numbers into the budget as weekly-contract cost
(`timeline/timeline-budget.js:618-633`). It also puts people on the call sheet.

**Fix:** replace the regex scan with `CCastDesk.charactersFromScript()`'s cue-based
extraction (`casting/lib-castdesk.js:56-82`) for *speaking* presence, and make silent
presence an explicit breakdown-editor entry rather than an inference. The editor field
already exists (`producer/schedule-board.js:269, 290`).

### HIGH — the cast layer is silently empty on the Producer Suite's own script path

`scenesFromScript()` (`producer/schedule-board.js:69-75`) gets cast from
`SBBudget.analyze(st).sceneCast`, which is only populated when `ranked.length` — and
`ranked` derives entirely from `st.characters` (`timeline/timeline-budget.js:380-392`).
The Producer Suite's "Add script" modal writes `d.characters = d.characters || {}`
(`producer/index.html:271`), i.e. an empty map. Verified: identical script, empty
`characters` → every strip `cast: []`; populated `characters` → correct cast.

Consequence: paste a screenplay on the Schedule tab, seed strips, auto-schedule, open
the DOOD — "Schedule scenes with cast to generate the Day-out-of-Days." No error, no
hint that you must first go to the Studio and parse. `boardOverrides()` then returns
`{}` and the budget silently falls back to its crude script-order approximation.

**Fix:** in `scenesFromScript()`, when `analysis.sceneCast` is empty, derive characters
from the script directly (`CCastDesk.charactersFromScript`) rather than returning
castless strips; and surface a one-line warning on the board when the cast layer is
inferred rather than parsed.

### HIGH — auto-schedule is a page bin-packer that never minimises cast holds

`autoScheduleModel()` (`producer/schedule-board.js:93-111`) fills days to a page target
in either script order or alphabetical-location order. It has no cast objective. A day
player working scenes 1 and 6:

```
script order    1→D1 2→D2 3→D3 4→D4 5→D5 6→D6   DOC {workDays:2, spanDays:6, spanWeeks:2}
location order  1→D1 2→D2 3→D3 4→D4 5→D5 6→D6   DOC {workDays:2, spanDays:6, spanWeeks:2}
AD's own order  1→D1 6→D2 2→D3 3→D4 4→D5 5→D6   DOC {workDays:2, spanDays:2, spanWeeks:1}
```

Both automatic modes charge the performer two weeks; boarding it the way an AD would
charges one. Those `spanWeeks` are multiplied by the weekly rate at
`timeline/timeline-budget.js:620-624`, so pressing "Auto-schedule" can double the
supporting-cast line without saying anything.

Worse, `location` mode is sorted *alphabetically* by set name (line 99), which is
unrelated to geography, and it happily puts two different sets on the same day. Verified
at 2 pages/day: `{D1:[ALPHA,ALPHA], D2:[BRAVO,CHARLIE], D3:[DELTA,ECHO]}` — days 2 and 3
each contain a company move that the board never marks, never costs and never shows in
the pages-vs-target meter (`producer/schedule-board.js:231`).

**Fix:** add a cast-hold objective (a simple greedy pass that pulls a performer's
scattered days together after the page pass), and mark a company move whenever
`locOf()` changes inside a day, with a configurable page-equivalent cost against the
day's target.

### HIGH — the boneyard drop zone doubles its listeners on every unschedule drag

`#sbBoneyard` is static markup (`producer/index.html:86`) and `render()` only replaces
its `innerHTML` (`producer/schedule-board.js:217`), while `#sbDays.innerHTML` is fully
replaced (line 234). `wireDnD()` runs at the end of every `render()` (line 238) and
selects `#pane-schedule .ps-strips` (line 355) — which matches `#sbBoneyard`. So the
boneyard collects one more `drop` listener per render, and its drop handler calls
`render()` (line 366).

Result: N drops into the boneyard → 2^N drop listeners, 2^(N-1) full re-renders and
`localStorage.setItem` of the whole board per drop. Confirmed 1 listener after `init()`
and confirmed doubling by simulation. Pulling strips back to the boneyard is the single
most common motion in boarding; ~20 of them and the tab is dead.

**Fix:** exclude `#sbBoneyard` from the `wireDnD()` selector and bind it once in
`init()`, or set a `_wired` flag on any element that survives a render.

### HIGH — the call sheet is not a call sheet

`openCallSheet()` (`producer/schedule-board.js:300-344`) produces: project name, day
number, one free-text date, one free-text general call, a scene table, a two-column
cast table, a slugline-derived location line and a notes box. Against what a crew needs:

- **One call time for everyone.** `dayMeta[d] = {call, date, notes}` (line 303). No
  per-cast makeup/hair/wardrobe/on-set times, no department calls, no crew call vs.
  shooting call, no pre-calls, no advance for a company move.
- **Held actors are printed in the cast block.** Line 308 filters
  `m.rows.filter(r => r.codes[d])` — `'H'` is a truthy string, so performers on *hold*
  appear in "Cast calls" with status `H`. Hold means not called. This will drive people
  to set.
- **No location detail.** Line 307 uses `locOf(sc.heading)` — an uppercased slugline
  fragment. No address, no map link, no parking/basecamp, no load-in, and **no
  hospital**, despite `SB_ScoutBook_v1` carrying `hospital`/`hospitalAddress` per
  location (`locations/lib-scout.js:528-529`) and the Scout Book UI telling the user
  those fields "feed the call sheet safety block" (`locations/index.html:78, 185`).
  The Producer Suite call sheet never reads that store. Only `/today/` does.
- **No sun or weather** — on a page that already loaded `TSun` and the Open-Meteo
  planner (`producer/index.html:160-161`).
- **No safety block**, though `CSafety.meetingChecklist()` exists and `/today/` uses it.
- **No crew, no walkie channels, no meal times, no wrap estimate, no tomorrow's
  advance schedule.**
- **Export is `window.print()` only** (line 338-343). No PDF metadata, no email, no
  versioning ("Call Sheet — rev 2").

**Fix:** this is the highest-leverage rebuild on the board. `dayMeta` needs
`{crewCall, shootingCall, mealAt, estWrap, castCalls:{name:{mu,hair,ward,onSet}},
locationIds:[], weatherCoverDayId, notes}`, and the sheet needs to join `SB_ScoutBook_v1`
for address/hospital/parking, `TSun` for sunrise/sunset, and `CSafety` for the safety
block — everything already exists in the repo.

### HIGH — no shooting order within a day, and no day-level operations

The drop handler sets `sc.day` and nothing else (`producer/schedule-board.js:364`), and
a day renders `board.scenes.filter(s => s.day === d)` in raw array order (line 226).
So an AD can put scenes on a day but cannot order them — the first thing you do after
boarding a day. There is also no insert-day, delete-day, move-day, duplicate-day or
drag-a-whole-day; no multi-select; no undo (the only confirm is scene delete, line 279).
Rebalancing a 40-day board means dragging every strip individually, one render each.

**Fix:** add an `ord` field to the scene, compute a drop index from pointer position in
the zone, and add day-level commands operating on `sc.day` in bulk.

### MED — the board's day count never reaches the budget

`boardOverrides()` returns only `castDood` and `unitOverrides`
(`producer/schedule-board.js:132-141`). `shootDays` is recomputed from pages ÷ pace ×
driver load at `timeline/timeline-budget.js:566` with no override path, and it drives
crew labour, equipment weeks, art, locations, media stock and extras
(lines 645, 655, 658-665, 690, 692). So a 38-day board and a 24-day estimate coexist
happily and the top sheet quietly uses 24. **Fix:** add `sel.shootDays` and set it from
the board's max day + 1 in `boardOverridesModel()`.

### MED — the Day Planner's calendar never reaches the board, the DOOD or the call sheet

`sched-weather.js` computes a real date for every shoot day, honours weekends
(`tools/sched-weather.js:34-43, 104-113`) and stores the start in `SB_ShootPlan_v1`
(line 11, 103). The board stores a *free-text* `MM/DD` string per day
(`producer/schedule-board.js:318`) that the AD retypes by hand, and the DOOD columns are
`D1…Dn` with no dates at all (line 382). Nothing reconciles them.

This is what blocks every date-aware rule: cast availability windows, turnaround
between wrap and next call, 6th/7th consecutive day, drop/pickup, holidays, and
`/today/`'s "which day is today" guess. `today/index.html:71-79` compares the free-text
`meta.date` against `M/D` and `MM/DD` and falls back to Day 1 on any other format.

**Fix:** make `SB_ShootPlan_v1` authoritative — write a real ISO date onto each
`dayMeta[d]`, show it in the day header and as the DOOD column header, and add explicit
non-shoot days (weekends, holidays, travel) so day index and calendar day stop being the
same number.

### MED — five different slugline parsers disagree, and the board has the strictest one

| module | regex | "INT WAREHOUSE" (no period) | `1A INT. …` revision scene |
|---|---|---|---|
| `SBBudget.splitScenes` (board) | `timeline/timeline-budget.js:282` requires `INT.` | **0 scenes** | kept |
| `CSafety.splitScenes` | `safety/lib-safety.js:92` | 2 scenes | **dropped** |
| `CCastDesk.splitScenes` | `casting/lib-castdesk.js:13` | 2 scenes | dropped, and numbering starts at 0 |
| `CScout.scriptLocations` | `locations/lib-scout.js:540` | 2 scenes | — |
| `CProd.sidesFor` | `production/lib-prod.js:110` | — | requires slugline at column 0 |

Verified by running all five over the same two scripts. Two consequences:

1. A screenplay written without the period after INT/EXT — routine in Fountain and in
   text extracted from PDFs — yields **zero strips**. The board just says "No scenes
   found" while Safety, Casting and Locations all parse it fine.
2. Scene *numbers* diverge. `/today/index.html:111` passes board scene numbers into
   `CSafety.meetingChecklist()`, which numbers scenes differently. On a script with
   revision-lettered scenes the phone call sheet attaches the wrong scenes' hazards —
   or drops them. A safety block that silently loses a hazard is worse than none.

**Fix:** one shared slugline parser in a `lib-slug.js`, used by all five, with a stable
scene id (not a positional index) carried onto the strip.

### MED — the DPR is a take-log summary with two hard bugs

`CProd.dpr()` (`production/lib-prod.js:21-47`), run against the exact row shape the
take-log Register writes (`tools/tools-media-ui.js:37-50`):

```
Takes: 3 (0 printed)      ← one take is "Circled ⭕", one is "Good"
```

- **`printedCount` is always 0.** Line 30 tests `t.status || t.print`; the take log's
  field is `grade` (`tools/tools-media-ui.js:44`). Neither key exists, so the regex runs
  against `''`.
- **Every DPR shows lifetime totals.** Line 27 keeps a take when `!t.date`, and the
  take-log Register defines no `date` field at all (lines 39-46). On day 30 the report
  lists every scene ever shot as "Scenes covered".
- `scheduledScenes` and `dayOneDate` are computed (lines 43-44) and then never printed
  by `dprText()` (lines 49-60).

Beyond the bugs, it carries none of a DPR's spine: no crew call / first shot / lunch in
and out / first shot after lunch / camera wrap / wrap, no scenes-and-pages scheduled vs.
shot vs. remaining, no setups, no minutes of screen time, no ahead/behind days, no
added or omitted scenes, no cast in/out times. **Fix:** add a `date` to the take log,
match on `grade`, and join the board for "scheduled today" so the report can state
ahead/behind — the number the production actually reads.

### MED — the strip does not carry INT/EXT, cast numbers, or a description

`scenesFromScript()` sets only `dn: 'day'|'night'` (`producer/schedule-board.js:82`) and
the CSS colours strips amber for day, blue for night
(`producer/producer.css:67-68`). The industry convention is four colours because
INT/EXT is the variable that decides whether weather can kill you: white INT day,
yellow EXT day, blue INT night, green EXT night. `locOf()` *strips* the INT./EXT. prefix
(line 51) and it is discarded. A board where you cannot see at a glance which days are
exterior cannot be weather-managed.

The strip also shows character *names* truncated to three (line 210) rather than cast
numbers, and carries no one-line description — so it does not read as a strip.

### MED — `parseEighths` treats a bare integer as eighths

`producer/schedule-board.js:31-35`: `"2"` → 2 eighths (a quarter page), `"2.0"` → 16
eighths (two pages). The editor label says "Pages (eighths)" with placeholder `1 7/8`
(line 265), so it is documented, but an AD typing `2` for a two-page scene silently
shrinks the day by 1¾ pages and the day meter goes green. **Fix:** accept `2` as two
pages and require `2/8` or `0.25` for a quarter, or split into two inputs.

### MED — `/today/`'s hospital block can confidently print the wrong hospital

`today/index.html:98-106`: it matches a Scout Book location to today's sets by an
8-character substring in *either* direction, accepts any location when `locs.length ===
0`, and then — if nothing matched — falls back to **the first location on file with a
hospital** (line 106). The rendered block (lines 129-131) shows that hospital as fact,
with no "unmatched, verify" marker. On a multi-location show the phone can show a
hospital in another county. **Fix:** match on an explicit location id joined to the
strip, and print "not on file for this set" rather than a fallback.

### LOW — three incompatible location stores

`SB_ScoutBook_v1` (`locations/index.html:119`, has hospital/parking/power/load-in),
`SB_Locations_v1` (`production/production.js:128`, has address/contact/permit/permit
date) and `SB_Timeline_v1.locationBible`. The producer call sheet reads none of them;
`/today/` reads only the first. Per the platform rule these keys can't be renamed, but
one of them should become the read model the others project into.

### LOW — no board print worth the name

`sbPrint` (`producer/schedule-board.js:441-442`) calls `renderDood(true); window.print()`.
The print CSS forces `.ps-board` to `display:block` (`producer/producer.css:102`), so a
40-day board prints as one long single-column list of strips. There is no one-line
schedule, no per-day page break, no header/footer with the revision date.

---

## What is missing entirely

- **Cast availability as a scheduling constraint** — *the* highest-value gap.
  `casting/index.html:232-233` already stores per-candidate `holdFrom`/`holdTo` as ISO
  dates and `CCastDesk.holdConflicts()` already compares ranges. The board never looks.
  Attach to `producer/schedule-board.js`: once days carry real dates (see the Day
  Planner gap above), join `SB_CastingDesk_v1` role name → strip `cast[]`, and flag any
  strip scheduled outside its performer's hold. Then teach `autoScheduleModel()` to
  respect the windows. Roughly a day's work on top of the date change. **Very high.**

- **Turnaround, meal and consecutive-day warnings on the board.**
  `TMoney.timecard()` (`tools/lib-money.js:47-111`) already implements 10-hour
  turnaround invasion, escalating meal penalties and 6th/7th-day premiums, and
  `TC_DEFAULTS` is parameterized. `producer/index.html` doesn't even load
  `/tools/lib-money.js` (it loads `/finance/lib-money.js`, a different engine, `CMoney`).
  Give `dayMeta` a crew call and estimated wrap, then run `TMoney` across consecutive
  days and paint the day header red for an invaded turnaround, amber for a projected
  meal penalty, and mark day 6 and 7 of each week. Half a day's work; it turns the board
  from a page counter into a scheduling instrument. **Very high.**

- **Banner and day-break strips.** `render()` builds days purely by filtering
  `board.scenes` (line 226) — there is no non-scene strip type. An AD cannot write "END
  OF DAY 4 — COMPANY MOVE TO STAGE 6", "SATURDAY — OFF", "TRAVEL DAY", "UNIT MOVE
  TO ALBUQUERQUE" or a week banner. Add a `kind: 'scene'|'banner'|'break'` discriminator
  to the scene record, render banners full-width and exclude them from page totals and
  from `doodMatrix`. Small change, large effect on legibility. **High.**

- **Split day.** `dn` is `'day'|'night'` (line 82) and `dayMeta` has one call time
  (line 303). A day/night split — the most common way an AD buys a night without
  burning a turnaround — cannot be expressed, so it is invisible on the DOOD and
  invisible to any turnaround rule. Needs a per-day `splitAt` time plus a per-strip
  `unit`/`block` marker. **High.**

- **Company move as a first-class object.** Only the word appears, in a comment
  (`producer/schedule-board.js:91`). A move needs a from-set, a to-set, a travel time,
  a page-equivalent cost against the day's target, and a marker between strips on the
  board. Today two sets on one day look identical to one. **High.**

- **Weather cover sets.** The Day Planner already scores per-day shoot risk 0-100
  (`tools/lib-sun.js:92-98`) and prints the advice "reorder exterior days away from
  red" (`tools/sched-weather.js:154`) — but there is nowhere to *put* a cover set, and
  no INT/EXT bit on the strip to pick one with. Add a `coverFor` field pointing an
  interior day at an exterior day, surface it on the day header and on the call sheet.
  **High** — and cheap once INT/EXT is on the strip.

- **Drop / pickup on the DOOD.** `doodMatrix()` charges an unbroken run of `H` across
  any gap (lines 164-171), and `boardOverridesModel()` bills the whole span as weeks
  (`producer/schedule-board.js:122`). SAG's drop/pickup exists precisely to stop paying
  through a long gap. Add a `D`/`PU` code when a gap exceeds the configured threshold
  (10 days is the common convention, and it must be *calendar* days, which is another
  reason the date gap above blocks everything), and stop counting those days into
  `spanWeeks`. **High** — it is a direct cash line.

- **Second unit / multi-unit boards.** No `unit` field anywhere, no way to run a main
  unit and a splinter/second unit in parallel, no per-unit DOOD or call sheet. Every
  strip belongs to one implicit unit. Add `unit` to the scene record, filter the board
  and the DOOD by unit, and produce a call sheet per unit. **Medium-high** for anything
  above a micro-budget.

- **One-line schedule.** Absent from the whole repo (grep: no hits for "one-liner" /
  "one line schedule"). It is the document everyone outside the AD department actually
  reads — day, date, set, D/N, scenes, pages, cast numbers, one line per strip. It is
  the cheapest thing on this list: a text projection of data the board already holds.
  Attach to `producer/schedule-board.js` next to `sbPrint`. **High value, ~2 hours.**

- **Any schedule export.** The only CSV in `producer/` is the budget top sheet
  (`producer/budget-sheet.js:182-195`). There is no stripboard CSV, no DOOD CSV, no
  call-sheet CSV/PDF beyond `window.print()`, no `.ics` calendar (grep: no `VCALENDAR`
  anywhere in the repo) and no import from Movie Magic / Gorilla / StudioBinder. An AD
  cannot hand the board to the production coordinator, the payroll company or the
  cast's agents. `CProd.csvCell` (`production/lib-prod.js:91-95`) is right there.
  **High, and small.**

- **Cast numbers.** A DOOD lists Cast # / Character / Actor; this one lists only the
  character name (`producer/schedule-board.js:385`). Strips should show numbers, not
  truncated names (line 210). Needs a stable per-character number assigned once and an
  actor-name join to `SB_CastingDesk_v1`. **Medium.**

- **Day-out-of-days for anything but principals.** No rows for stunt performers,
  background, animals, picture vehicles, minors (with their work-hour and tutor rules),
  or crew. The tags exist on the strip (`TAG_KEYS`, line 39) but only aggregate into
  budget day counts (lines 124-141) — they never become DOOD rows. **Medium.**

- **Schedule versioning and change tracking.** `persist()` overwrites
  (`producer/schedule-board.js:195-197`). No revision colours (white / blue / pink /
  yellow / green), no published-vs-working board, no "what changed since the last
  publish" — the thing a 1st AD is asked at the production meeting every week.
  **Medium.**

- **Prep and wrap on the board.** Only shoot days exist. No prep days, rehearsal, camera
  test, fittings, travel or wrap — all of which carry cast and crew cost and all of
  which belong on the DOOD span. **Medium.**

- **Scene status.** No omitted / added / held / completed state on a strip, so there is
  no way to mark what actually got shot, and consequently no way for the DPR to compute
  ahead/behind. **Medium** — and it unblocks the DPR fix above.

---

## Evidence

Files read in full: `docs/audit/BRIEF.md`; `producer/schedule-board.js` (475 lines);
`producer/index.html`; `production/lib-prod.js`; `production/lib-cast.js`;
`casting/lib-castdesk.js`; `tools/lib-sun.js`; `tools/sched-weather.js`;
`tools/lib-money.js`; `today/index.html`; `production/index.html`;
`scripts/test_producer_suite.mjs`.

Read in part: `timeline/timeline-budget.js:275-424, 545-665`;
`locations/lib-scout.js:420-561`; `locations/index.html:78, 110-190`;
`casting/index.html:126-165, 232-233`; `production/production.js:1-260`;
`safety/lib-safety.js:80-158`; `producer/budget-sheet.js:173-195, 330-415`;
`producer/producer.css:59-144`; `tools/tools-media-ui.js:30-70`;
`tools/tools-money-ui.js:60-135`; `finance/lib-money.js:1-20`; `app.html` (grepped —
confirmed no second stripboard implementation).

Claims verified by execution (Node, against the real module files, read-only):

1. **Slugline divergence.** Same script without periods after INT/EXT:
   `SBBudget.splitScenes` → 0, `CSafety.splitScenes` → 2, `CCastDesk.splitScenes` → 2,
   `CScout.scriptLocations` → 2, `SBScheduleBoard.scenesFromScript` → 0 strips.
   With `1 / 1A / 2` revision scenes: `SBBudget` keeps all three, `CSafety` keeps two
   (drops `1A`), `CCastDesk` numbers from 0 with a preamble scene.
2. **Cast word search.** `INT. BAR - DAY` containing only *mentions* of MAYA →
   `cast = ["JACK","MAYA"]`.
3. **Empty cast layer.** Same script with `characters: {}` → all strips `cast: []`;
   with `characters: {JACK:{},MAYA:{}}` → correct cast. `producer/index.html:271` writes
   the empty form.
4. **Auto-schedule cast cost.** Day player in scenes 1 and 6 of 6:
   script mode and location mode both `{workDays:2, spanDays:6, spanWeeks:2}`;
   hand order `{workDays:2, spanDays:2, spanWeeks:1}`.
5. **Silent company moves.** `autoScheduleModel(scenes, 2, 'location')` →
   `{D1:[ALPHA,ALPHA], D2:[BRAVO,CHARLIE], D3:[DELTA,ECHO]}`.
6. **DPR bugs.** Real take-log row shape → `printedCount: 0` with one Circled and one
   Good take; all three undated takes counted into a specific report date;
   `scheduledScenes`/`dayOneDate` computed and absent from `dprText()` output.
7. **Boneyard listener growth.** `SBScheduleBoard.init()` against a DOM stub leaves
   1 `drop` listener on the surviving `#sbBoneyard` element; because each fired handler
   calls `render()` (line 366) and `render()` re-runs `wireDnD()` (line 238) which
   re-selects `#sbBoneyard` (line 355), the count doubles per boneyard drop —
   1, 2, 4, 8, 16, 32 confirmed by simulation.

No files were modified. No tests were run against the repo's suites and none were
changed.
