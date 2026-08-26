# TEAM A DEV 12 — missing: scheduling & assistant directing

**Scope note.** My half hunts for what is *absent*. `crew-05-first-ad-scheduling.md`
(wave 1) covers the same craft area from the AD's chair and independently reached
several of the same conclusions. Where we overlap I say so and contribute the part
it does not have: **the build spec** — attach point, data model, `SB_*` key, size.
Seven of my findings are not in crew-05 at all and are marked **[new]**.

**The root cause, stated once.** Every gap below is a symptom of two absent nouns.
The board has a `scene` object (`producer/schedule-board.js:76-86`) and nothing
else. There is **no `Day` object** — a shoot day is an integer index, and its only
metadata is `dayMeta[d] = {call, date, notes}` with `date` typed free-hand as
`"MM/DD"` (`:303`, `:318`). And there is **no `Unit` object** — no `unit` field on
any scene, day or crew record anywhere in the repo. Fix those two and eight of the
eleven gaps below collapse into wiring.

**The migration is cheap and safe.** `load()` (`:183-194`) reads `d.scenes`,
`d.dayMeta`, `d.mode` and returns `d` whole; `persist()` (`:195-197`) writes the
whole object back. New fields on the same `SB_ScheduleBoard_v1` object survive
round-trips untouched, and old boards keep working — no key rename, which the brief
forbids. Cloud sync is key-pattern based and value-opaque
(`netlify/functions/projects-sync.js:227` tests `/^SB_[A-Za-z0-9]+_v\d+$/`), so an
extended shape syncs for free and a new `SB_ProdCalendar_v1` passes the same test.

---

## What exists and works

Establishing the search perimeter — I read these before claiming anything absent.

- `producer/schedule-board.js:14-37` — `formatEighths`/`parseEighths` are correct
  eighths math and round-trip; tested at `scripts/test_producer_suite.mjs:76-85`.
- `producer/schedule-board.js:148-179` — `doodMatrix()` emits genuine SW/W/H/WF/SWF
  with TOT/WRK/HLD columns. The code-assignment rule (`:164-172`) is right for the
  five codes it knows.
- `producer/schedule-board.js:93-111` — `autoScheduleModel()` with `mode:'location'`
  (`:96-103`) sorts by location then day/night before bin-packing. That is how an AD
  actually boards a show, and it is the single best idea in the module.
- `producer/schedule-board.js:116-143` — `boardOverridesModel()` feeding real board
  day assignments back into the budget estimator is a genuinely good architecture.
- `tools/lib-money.js:47-110` — `TMoney.timecard()` computes straight/OT/DT/golden,
  6th- and 7th-day premiums (`:69-71`), escalating meal penalties (`:77-90`) and
  turnaround invasion (`:92-100`) against sane defaults (`:25-29`). This is correct
  and complete **as a post-hoc calculator**.
- `tools/sched-weather.js:93-136` — the Day Planner does real calendar arithmetic
  (`addDays`, `:34-43`), local solar math and a live Open-Meteo forecast with a
  0-100 shoot-risk score per day. It works.
- `casting/lib-castdesk.js:87-109` — `holdConflicts()` correctly finds the same
  performer held on overlapping date ranges across two roles.
- **`post/lib-post.js:42-175` — a complete, tested, dependency-graph scheduler.**
  `parseISO`/`fmtISO`/`isWeekend`/`snapBusiness`/`addBusDays`/`busDiff` (`:42-77`),
  `topoSort` (`:87-100`), and `schedule(milestones, dateISO, direction)` (`:118-175`)
  which solves **forwards or backwards** from an anchor date, skips weekends, and
  returns a critical path. Exported as `CPost` (`:254-262`). Pure, no DOM. It is the
  best piece of scheduling code in the repo and it is walled inside post-production.

---

## What exists but needs work

Deliberately short — teamA-01..10 own this column, and crew-05 covers the AD craft
side in depth. Two items only, because both are load-bearing for what follows.

- `js/budget-engine.js:566-630` **and** `timeline/timeline-budget.js:583-630` are the
  same ~50 lines of cast-DOOD-to-money logic, duplicated. Any drop/pickup or unit
  change below must be made twice or the two estimators will silently disagree.
  **Rank: MED** — not wrong today, but it doubles the cost of every fix below.
- `producer/schedule-board.js:122` sets `spanWeeks = ceil(TOT/5)` and
  `js/budget-engine.js:604-609` bills supporting cast at `perf.week * spanWeeks`.
  `TOT` is the unbroken first-to-last span *including every hold day*. **Rank: HIGH**
  — see "Drop / pickup" below; the fix is one function, the consequence is money.

---

## What is missing entirely

### 1. A prep and wrap calendar — and the engine for it already exists **[new]**

**Where I looked.** `rg -i "prep calendar|wrap calendar|crew calendar"` → zero hits
outside my own report. `producer/schedule-board.js:225-233` renders shoot days only.
`workflow/workflow.js:40-154` has a `schedule` pipeline stage but it is a checklist,
not dates. crew-05 flags "prep and wrap on the board" as absent but does not know a
scheduler already exists.

**What it is.** Prep is where a feature is won or lost — tech scouts, fittings,
camera tests, rehearsal, load-ins, department start dates, and the wrap/strike tail.
None of it is expressible. The platform can tell you Day 1 is a Tuesday and cannot
tell you the gaffer needed to start eight working days before it.

**Why this is the highest-value item on my list.** `CPost.schedule()`
(`post/lib-post.js:118-175`) already does *exactly* this job: a topologically sorted
milestone graph, business-day arithmetic, a critical path, and — critically — a
`direction: 'backward'` mode that lands the terminal milestone **on** a target date
(`:127-146`). A prep calendar is that same call with a different `TEMPLATE`
(`:19-34`) and the shoot's Day 1 as the backward anchor. This is a wiring job on a
tested engine, not a build.

**Attach to.** `producer/` as a new `pane-calendar`, engine in a new pure
`producer/lib-prepcal.js` that delegates the date math to `CPost`.
**Data model.** `PREP_TEMPLATE = [{id, name, days, after:[]}]` mirroring
`post/lib-post.js:19-34` — `budget-lock`, `crew-offers`, `tech-scout`, `fittings`,
`camera-test`, `rehearsal`, `load-in`, then `wrap`, `strike`, `truck-return`,
`asset-return`. **Key.** New `SB_ProdCalendar_v1` = `{anchor:'', direction:'backward',
milestones:[…], overrides:{}}`, anchored to `SB_ShootPlan_v1.date`.
**Size.** ~250 lines JS + ~120 lines of pane markup + a `scripts/test_prepcal.mjs`
suite. Half of that is the template table.
**Rank: HIGH.**

### 2. A `unit` dimension — second unit, splinter units, split days

**Where I looked.** `rg -i "second unit|secondUnit|splinter|split day|splitDay|
halfDay|unit move"` across the whole repo → **zero hits** (one false positive:
"splinter" in `dailies/index.html` as prose). No `unit` field on the scene object
(`producer/schedule-board.js:76-86`), on `dayMeta` (`:303`), or on the crew register
(`tools/tools-registers.js:31-38`). crew-05 reaches the same conclusion.

**Why a production needs it.** Two consequences, both concrete. (a) `doodMatrix()`
buckets purely on `sc.day` (`:151-157`), so a scene the second unit shot with a
double marks the principal as `W` on a day they were never called — the DOOD lies
and the actor gets billed. (b) `boardOverridesModel()` counts a tag day once per
`sc.day` (`:124-128`), so a 2nd-unit stunt day and a main-unit day are the same day
to `js/budget-engine.js:652-659` — you under-count the stunt unit and over-count
main-unit crew simultaneously. A split day (company works 6am-2pm at one location
then 4pm-midnight at another) is likewise unrepresentable: `dn` is binary
`'day'|'night'` (`:82`) and there is exactly one call time per day.

**Attach to.** `producer/schedule-board.js` + a new pure `producer/lib-sched.js`.
**Data model.** `sc.unit` (`'main'|'2nd'|'splinter'|<custom id>`, default `'main'` —
absent means main, so old boards migrate for free); `sc.half` (`null|'A'|'B'` for
split days); `board.units = [{id, name, color, crewSize}]`;
`dayMeta[d].calls = {main:'07:00', '2nd':'12:00'}` alongside the existing `call`
string so nothing breaks. **Key.** `SB_ScheduleBoard_v1`, additively.
**Work.** `doodMatrix(scenes, {unit})` filters by unit and merges per-actor across
units; `boardOverridesModel` groups tag days by `unit + day`; `render()` gets a unit
column or a unit filter; strips get a unit chip next to the existing tag chips
(`:205-207`).
**Size.** ~200 lines across the board + estimator, plus test cases in
`scripts/test_producer_suite.mjs` (which already exercises `doodMatrix` at `:67-74`).
**Rank: HIGH.**

### 3. Drop / pickup on the DOOD — and the money it is currently costing

**Where I looked.** `rg -i "drop.*pickup|dropPickup"` → one hit, in
`docs/PRODUCTION_PRICING.md` prose. `doodMatrix()` emits five codes (`:164-172`);
there is no D, P, T (travel), R (rehearsal), F, or SH. crew-05 flags this; what
follows is the part it does not trace.

**Why it matters — the exact leak.** `doodMatrix` returns `tot = last - first + 1`
(`:175`). `boardOverridesModel` turns that into `spanWeeks = ceil(tot/5)` (`:122`).
`js/budget-engine.js:604-609` bills every supporting performer
`perf.week * spanWeeks`. So an actor who works Day 1 and Day 20 and sits idle for
eighteen days in between is billed **four weeks** of scale. The drop/pickup rule
exists precisely so a production does not pay that: drop the performer, pick them up
later, pay neither the gap nor the holds. Right now the estimator has no way to
express the saving, so it systematically over-quotes long-span supporting roles —
and the same wrong number is computed a second time in
`timeline/timeline-budget.js:609-620`.

**Attach to.** `producer/schedule-board.js:148-179` (`doodMatrix`), then both
estimator copies.
**Data model.** `board.castMeta[name] = {drops:[{from:<dayIdx>, to:<dayIdx>}],
travel:[dayIdx], rehearsal:[dayIdx]}`. `doodMatrix` emits `D` on the drop day, `P` on
the pickup, `''` through the gap, and returns `paidDays` (worked + holds *outside*
any drop) alongside the existing `tot`/`wrk`/`hld`. `boardOverridesModel` then sets
`spanWeeks = ceil(paidDays/5)`.
**Key.** `SB_ScheduleBoard_v1`, additively.
**Size.** ~80 lines in `doodMatrix`, ~10 in each estimator, plus a UI affordance to
mark a drop. The smallest job on this list with the largest dollar consequence.
**Rank: HIGH.**

### 4. Cast availability as a scheduling constraint

**Where I looked.** `casting/lib-castdesk.js:90-109` `holdConflicts()` is the only
availability logic in the repo. It compares held candidates **against each other**
and never sees a board — it takes `candidates` and nothing else. The board has no
ISO dates to compare against in any case (`dayMeta[d].date` is `"MM/DD"` free text,
`:318`). Grep confirms `SB_ScheduleBoard_v1` and `SB_CastingDesk_v1` are never read
in the same file. crew-05 calls this "*the* highest-value gap" and I agree it is the
highest-value gap *within the board*; I rank the prep calendar above it only because
that one is nearly free.

**Why a production needs it.** This is the constraint that actually drives a board.
An actor is available the 3rd through the 21st; a name has a hard out; a minor has
tutoring hours. Today you can auto-schedule a performer onto a day they cannot work
and the platform is silent — then the board, the DOOD *and* the budget are all
wrong downstream, because `boardOverridesModel` feeds all three.

**Attach to.** `producer/schedule-board.js`, reading `SB_CastingDesk_v1`.
**Prerequisite.** Real dates on the board (see #7 below) — this cannot be built
until `dayMeta[d].iso` exists. That dependency is why it is a build, not a wiring.
**Data model.** `holdFrom`/`holdTo` already exist on candidates
(`casting/lib-castdesk.js:93`). Add `hardOut` and `minorHours` there. New pure
function `availabilityConflicts(scenes, dayMeta, candidates)` in
`producer/lib-sched.js` → `[{name, day, iso, reason}]`, rendered as a red chip on the
offending strip and a summary line under the board.
**Then the solver.** `autoScheduleModel` gains `mode:'cast'`: bin-pack as now, then
run a greedy day-swap that (a) never places an actor outside their window and
(b) minimises total `hld` from `doodMatrix`. A full constraint solver is not needed
and is not worth it — greedy swap on a 25-day board is milliseconds and gets most of
the benefit.
**Size.** Conflict detection ~120 lines and is worth doing alone. The solver another
~150. Both pure and node-testable.
**Rank: HIGH** (conflicts) / **MED** (solver).

### 5. Turnaround, 6th/7th day and meal penalties as *forecasts* — plus the
hardcoded 5-day week **[new, in part]**

**Where I looked.** `tools/lib-money.js:47-110` computes all three, correctly, for
one person on one day *after the fact*: it needs `prevWrap` (`:94`), `dayOfWeek`
(`:70-71`) and `firstMealAtHr` (`:79`) supplied by the caller. `safety/lib-safety.js:64-66`
mentions "Minimum 10-hour turnaround protected" as **prose in a checklist**.
`workflow/advisor.js:153` warns that night scenes need "turnaround planning" and
links to the Day Planner. Nothing computes a turnaround violation from a schedule.
crew-05 flags the board-level warnings; the week-length finding below is mine.

**The part crew-05 does not have.** There is no six-day week anywhere in the
platform. `js/budget-engine.js:552` hardcodes `shootWeeks = shootDays / 5`, and the
Day Planner's only calendar control is a boolean `skipWeekends`
(`tools/sched-weather.js:71`, `:34-43`) — so the platform can express a five-day
week or a seven-day week and nothing between. A six-day week is the norm on
low-budget features and standard in several territories, and it is exactly the case
where `sixthDayMult: 1.5` (`tools/lib-money.js:28`) bites. The premium is
implemented and unreachable.

**Attach to.** `producer/schedule-board.js` for the warnings; `js/budget-engine.js`
and `tools/sched-weather.js` for the week length.
**Data model.** `dayMeta[d].call` / `.wrap` as real `HH:MM` (they are free strings
today); `board.weekLen` (5|6|7) replacing the boolean, defaulting to 5 so existing
behaviour is unchanged. Then a pure `scheduleWarnings(dayMeta, weekLen)` in
`producer/lib-sched.js` that walks consecutive days and calls
`TMoney.hoursBetween(prevWrap, call)` against `TC_DEFAULTS.turnaroundHrs`, and flags
the 6th and 7th consecutive worked day.
**Size.** ~120 lines plus the `weekLen` plumbing. `TMoney` does the arithmetic; this
is a loop over days and a chip.
**Rank: HIGH** for the 5-day hardcode (it silently mis-costs every 6-day show),
**MED** for the warnings.

### 6. A crew calendar — department start dates, holds and hire windows **[new]**

**Where I looked.** `SB_Crew_v1` is defined once, at `tools/tools-registers.js:28-45`.
Its fields are `name, role, dept, union, rate, phone, email, dietary, emergency`.
**There is not a single date field.** `SB_CallDist_v1` (`:47-56`) tracks who received
a call sheet and has a `day` field — that is the closest thing, and it is a delivery
log. `contracts/index.html:118` reads the crew list for deal memos and gets no dates
either. crew-05 does not cover crew.

**Why a production needs it.** The crew is the largest line in the budget
(`js/budget-engine.js:630`: `crewSize * crewAvgDay * shootDays`) and the platform
models it as a flat multiplication over shoot days. In reality art starts weeks
before camera, construction wraps before day one, the DIT starts at camera test, and
post crew overlap the tail. Without hire windows you cannot answer "how many people
are on payroll in week 3", which is the question a weekly cost report is built on —
and you cannot generate the deal memo start date that `contracts/` is already asking
for.

**Attach to.** `tools/tools-registers.js` (add fields) + the prep calendar from #1.
**Data model.** Add `startOffset` (working days relative to shoot Day 1, negative for
prep), `wrapOffset`, and `daysGuaranteed` to the `SB_Crew_v1` field list. Resolve to
real dates through `CPost.addBusDays(anchor, offset)` — the function already exists
(`post/lib-post.js:61-69`). Offsets rather than absolute dates is the right model
here: the shoot start date moves constantly and you want the crew plan to move with
it.
**Key.** `SB_Crew_v1`, additively — the `Register` component renders whatever fields
it is given, so this is a table edit plus a resolver.
**Size.** ~40 lines of schema, ~80 for a headcount-by-week rollup.
**Rank: MED-HIGH.**

### 7. Real calendar dates on the board

**Where I looked.** `tools/sched-weather.js:103` saves `{date, city, lat, lon,
skipWk, n}` to `SB_ShootPlan_v1` and computes correct ISO dates per shoot day
(`:110-113`) — then renders them into its own table (`:138-156`) and stops. The board
stores `dayMeta[d].date` as free text placeholdered `"MM/DD"` (`:318`).
`today/index.html:71-79` `todayGuess()` tries to find today's shoot day by
string-matching `"M/D"` *and* `"MM/DD"` against that free text and falls back to
Day 1. crew-05 and `CROSS-CUTTING.md:285` both flag this; I list it because items
#4, #5 and #10 are all blocked on it.

**Attach to.** `tools/sched-weather.js:93-136` → write back.
**Data model.** `dayMeta[d].iso` (ISO 8601), written by `plan()` alongside the
display string, never replacing it. Add `dayMeta[d].type`
(`'shoot'|'prep'|'travel'|'hold'|'holiday'|'off'`) so non-shoot days can occupy a
calendar slot without becoming shoot days.
**Size.** ~30 lines to write back, then everything downstream becomes possible.
**Rank: HIGH — it is the keystone.** Cheapest item on the list per unit of unlock.

### 8. Weather cover sets

**Where I looked.** `rg -i "weather cover|coverSet|cover set"` → zero hits.
`tools/sched-weather.js:144,151` computes a per-day `shootRisk` 0-100 and colours a
chip; `:154` then advises the user in prose to "reorder exterior days away from
red". That is the whole mechanism. crew-05 flags this too.

**Why a production needs it.** Cover is the standard answer to weather: for every
exterior day you nominate an interior that can be shot instead at no notice, and you
hold its cast and set. The platform scores the risk and then hands you a sentence.

**Attach to.** `producer/schedule-board.js` + `tools/sched-weather.js`.
**Data model.** `dayMeta[d].coverFor` / `sc.isCover = true`; a pure
`coverCandidates(scenes, day)` in `producer/lib-sched.js` returning unscheduled or
low-priority INT scenes that share cast with that day's call, ranked by page count
match. A "swap to cover" action reassigns `sc.day` for both sets in one move.
**Size.** ~150 lines. The risk score it keys off already exists.
**Rank: MED** — HIGH for any show with real exterior exposure.

### 9. Location availability windows **[new]**

**Where I looked.** `SB_Locations_v1` is defined at `production/production.js:128-145`
— fields `name, scenes, address, contact, permit, permitDate, notes`. A single date,
and it is the permit's. `CScout.blankLocation()` (`locations/lib-scout.js:524-532`)
has `permitStatus`/`releaseStatus` and no dates at all. crew-05 notes the three
location stores disagree but not that none of them can express availability.

**Why a production needs it.** A location is a scheduling constraint at least as
hard as an actor: the church is free Tuesdays only, the school is out during term,
the restaurant needs Mondays, the permit covers the 8th to the 12th and not the 13th.
The board already groups by location to minimise moves
(`producer/schedule-board.js:96-103`) — that grouping is solving the *wrong* problem
if it cannot see when a location is actually open.

**Attach to.** `production/production.js:128-145` field list + the same
`availabilityConflicts()` from #4.
**Data model.** `availFrom`, `availTo`, `blackout` (comma-separated ISO dates),
`prepDays`, `strikeDays` on the location record. Same conflict-chip treatment as cast.
**Size.** ~40 lines of schema, and it reuses #4's conflict pass entirely.
**Rank: MED.**

### 10. Schedule variance and shooting-ratio actuals **[new]**

**Where I looked.** `SB_TakeLog_v1` is defined at `tools/tools-media-ui.js:38-46`:
`time, scene, take, roll, grade, note`. **No date, no shoot day, no pages.**
`production/lib-prod.js:27` filters takes with `!t.date || t.date === date` — since
`t.date` never exists, that predicate is always true and every DPR reports lifetime
totals (crew-05 found this bug at its `:266`). The only "shooting ratio" in the repo
is `timeline/timeline-doc.js:202`, a *documentary planning estimate* (10-20:1
interview-driven, 30-80:1 observational) used to guess footage hours up front —
never compared against anything shot.

**Why a production needs it.** "Are we ahead or behind?" is the 1st AD's entire job
expressed as one number, and it is the number the producer asks for at wrap every
day. It requires exactly two things the platform does not record: pages *scheduled*
for a day (which the board has) and pages *completed* (which nothing has). Same
data yields the real shooting ratio — setups and takes per page — which is the
earliest reliable signal that a schedule is going to blow.

**Attach to.** `tools/tools-media-ui.js` (take log schema) → `production/lib-prod.js`
(`dpr()`).
**Data model.** Add `date` and `day` to the take-log fields, and `sc.status`
(`'todo'|'partial'|'complete'|'omitted'`) to the scene object. Then a pure
`variance(board, takes, throughDay)` in `production/lib-prod.js` returning
`{pagesScheduled, pagesShot, aheadBehindEighths, ratioTakesPerPage,
projectedFinishDay}` — projected finish is `remainingPages / observedPagesPerDay`,
which is the number that actually changes decisions.
**Key.** `SB_TakeLog_v1` and `SB_ScheduleBoard_v1`, both additively.
**Size.** ~15 lines of schema, ~90 for `variance()`, plus a DPR block and test cases
in `scripts/test_ops.mjs`.
**Rank: MED-HIGH** — it is the feedback loop that makes the whole board honest, and
it is blocked on two field additions.

### 11. Background and extras wrangling **[new]**

**Where I looked.** `sc.extras` is a bare integer: defaulted at
`producer/schedule-board.js:44`, edited as a number input at `:267`, parsed at
`:289`, badged as `BG×n` at `:207`, summed to `extrasDays` at `:139`, and consumed
at `js/budget-engine.js:639-641` and `:686` as a person-day count for account 4500.
That is the complete lifecycle. `rg -i "voucher"` → **zero hits** repo-wide;
`"photo double"` → zero; `"stand-in"` appears only in `safety/lib-safety.js` and
unrelated test names. crew-05 does not cover BG.

**Why a production needs it.** Background is where a low-budget day quietly doubles
in cost. A count cannot distinguish twenty silent atmosphere at scale from three
featured extras with fittings and a stand-in who works every day — and they price
very differently. It also cannot produce the two documents the BG wrangler actually
needs: a per-day BG call (staggered from crew call) and vouchers.

**Attach to.** `producer/schedule-board.js` breakdown editor (`:250-297`) +
`js/budget-engine.js`.
**Data model.** Replace the integer with a backward-compatible array —
`sc.bg = [{type:'atmosphere'|'featured'|'silent-bit'|'stand-in'|'photo-double',
count, call, wardrobe}]`, keeping `sc.extras` as the derived total so
`boardOverridesModel:139` and the estimator keep working untouched. Rate multipliers
per type in the estimator (`EXTRA_DAY_RATE` at `:641` is currently one flat band).
**Size.** ~130 lines, most of it the editor UI. Low risk because the old field
survives as a computed total.
**Rank: LOW-MED** — real money on crowd shows, negligible on a chamber piece.

### Also absent, verified, not worth a section

- **One-line schedule.** `rg -i "one-line|one liner"` → the only hits are a `logline`
  field label (`tools/tools-script-ui.js:103`) and prose in `index.html`. The
  one-liner is the most-distributed schedule document on a set. It is ~60 lines
  against the existing `doodMatrix`/`dayMeta` once #7 lands. crew-05 flags it.
- **Any schedule export.** `producer/schedule-board.js:441-442` and `:338-343` are
  `window.print()`. No CSV, no ICS. `production/lib-prod.js:91-95` already has the
  CSV-injection-safe `csvCell()` the brief mandates — reuse it, do not rewrite it.
  ~80 lines for board + DOOD + one-liner CSV.
- **Gantt or month view.** `rg -i "gantt"` → zero hits. `post/` renders its milestone
  schedule as a table. A month grid over `dayMeta[d].iso` + `.type` (#7) would serve
  prep, shoot and post from one component.

---

## Evidence

Files read in full: `producer/schedule-board.js` (475 lines),
`casting/lib-castdesk.js` (192), `production/lib-prod.js` (182),
`tools/sched-weather.js` (160).

Files read in relevant part, with the lines cited above verified:
`js/budget-engine.js:551-560, 566-630, 639-641, 652-662, 686`;
`post/lib-post.js:16-80, 118-175, 254-262`;
`tools/lib-money.js:25-29, 44-110, 175`;
`tools/tools-registers.js:26-56`;
`tools/tools-media-ui.js:34-52`;
`production/production.js:118-155`, tab list at `index.html:69-93`;
`locations/lib-scout.js:508-556`;
`today/index.html:55-120`;
`timeline/timeline-budget.js:583-630`;
`netlify/functions/projects-sync.js:37, 227`;
`scripts/test_producer_suite.mjs:51-111, 215`;
`workflow/workflow.js:40-154`; `workflow/advisor.js:136, 153`;
`safety/lib-safety.js:64-66`; `timeline/timeline-doc.js:202`;
`producer/index.html:69-90, 157-167`.

Negative searches run before claiming absence (all case-insensitive, excluding
`node_modules/`, `static/vendor/`, `*.zip`, `docs/`, `projects/sample*`):
`second unit`, `secondUnit`, `splinter`, `split day`, `splitDay`, `half day`,
`halfDay`, `turnaround`, `meal penalty`, `mealPenalty`, `weather cover`,
`coverSet`, `cover set`, `one-line`, `oneLine`, `drop.*pickup`, `dropPickup`,
`prep calendar`, `wrap calendar`, `crew calendar`, `shooting ratio`,
`company move`, `companyMove`, `unit move`, `background wrangl`, `voucher`,
`atmosphere`, `stand-in`, `photo double`, `rehearsal`, `fitting`, `camera test`,
`travel day`, `fraturday`, `gantt`, `calendar`, `holiday`, `bank holiday`,
`availability`, `behind schedule`, `pages behind`, `scheduleVariance`.
Full `SB_*` key enumeration run to confirm no scheduling store exists beyond
`SB_ScheduleBoard_v1`, `SB_ShootPlan_v1`, `SB_CallDist_v1` and `SB_Crew_v1`.

Hits that turned out **not** to be the feature, recorded so nobody re-chases them:
`half day` in `locations/lib-scout.js` is permit-fee prose; `splinter` in
`dailies/index.html` is prose; `one-line` in `tools/tools-script-ui.js:103` is a
logline field; `shooting ratio` in `timeline/timeline-doc.js:202` is a documentary
footage *estimate*, not a tracked actual; `holiday` in
`producer/sales-forecast.js:52` is a release-window multiplier and in
`js/budget-engine.js:106` a fringe component — neither is a calendar holiday;
`turnaround` in `safety/lib-safety.js:64-66` and `workflow/advisor.js:153` is
advisory prose with no computation behind it.

No file was edited. `node scripts/run_all_tests.mjs` → **44/44 suites passed**,
unchanged.
