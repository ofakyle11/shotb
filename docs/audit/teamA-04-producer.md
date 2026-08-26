# Team A Dev 04 — producer/ (budget top sheet, stripboard, DOOD, call sheets, incentives)

Slice: `producer/*.js` (4), `js/budget-engine.js`, `timeline/timeline-budget.js`,
`docs/PRODUCTION_PRICING.md`. Every number below was produced by running the real
code under `node` against the repo's own test fixture script; nothing is inferred
from a comment. `node scripts/run_all_tests.mjs` and
`node scripts/test_producer_suite.mjs` pass unmodified — I edited nothing.

---

## What exists and works

- `producer/schedule-board.js:148-179` — `doodMatrix()` is genuinely correct. SW /
  W / H / WF / SWF are assigned off first/last worked day, `hld = span - work`,
  rows sort by workload. This is the real DOOD code set, not a decoration.
- `producer/schedule-board.js:14-37` — `formatEighths` / `parseEighths` round-trip
  the industry unit properly: `"1 7/8"`→15, `"7/8"`→7, bare `"15"`→15 eighths,
  `"2.5"`→20, garbage→`null`. The eighths convention is respected end to end and
  `analyze()` runs the shoot-day maths on exact eighths (`budget-engine.js:550`),
  not a rounded page count.
- `producer/budget-sheet.js:175-196` — CSV export is correct and safe: `csvCell`
  prefixes `'` on a leading `= + - @ \t \r` before quoting, exactly as the brief
  requires, and emits per-category subtotals plus a grand total.
- `producer/incentives.js` — the decoder is fully data-driven off
  `SBBudget.INCENTIVES` (`:19`). Adding a jurisdiction to the table makes it
  appear in the comparison with no change here. That part is right.
- `producer/producer.css:134-139` — `body.cs-printing` correctly isolates the call
  sheet for print (hides `.app`, un-modals `#sbCallModal`, forces black text). The
  print path was thought through.
- `producer/sales-forecast.js:20-58` — quantile bands rather than a point estimate,
  with per-bracket `n=` counts in the comments and a separately reported
  `FAILURE_RATE = 0.155`. Out of my slice's core, but honest modelling.
- `producer/index.html:162-167` — module load order is right, and the four tabs
  each guard on their own DOM anchor (`if (!$('bsTopSheet')) return;` etc.), which
  is why `scripts/test_producer_suite.mjs` can `eval` them under node at all.

---

## What exists but needs work

### HIGH — two budget engines define the same global and disagree by 4.5×

`dashboard.html:1832` loads `js/budget-engine.js`; `producer/index.html:162` and
`timeline/index.html:315` load `timeline/timeline-budget.js`. Both define
`root.SBBudget`. Measured overlap: **1,038 of budget-engine's 1,082 lines appear
verbatim in timeline-budget's 1,240 — 95.9% of one file, 83.7% of the other.**

Scripted mode agrees to the cent today ($6,486,336 both). Documentary mode does
not, because `timeline-budget.js:541` has `if (sel.mode === 'documentary') return
estimateDocCompat(...)` and `budget-engine.js` has no such branch:

| Same doc treatment, same prefs | likely total | `prod.mode` |
|---|---|---|
| dashboard → `js/budget-engine.js` | **$3,223,437** | `undefined` |
| producer → `timeline/timeline-budget.js` | **$710,479** | `documentary` |

**4.54×, on two pages of the same app, for the same project.** A producer who
prices a doc on the dashboard and then on `/producer/` gets two different films.

Worse: **no test loads `js/budget-engine.js`.** `test_budget_estimator.mjs:7`,
`test_producer_suite.mjs:7`, `test_learn.mjs:10`, `test_advisor.mjs:12` and
`test_taxcredit.mjs:20` all read `timeline/timeline-budget.js`. The dashboard's
copy can drift arbitrarily and 44/44 still passes. `budget-engine.js:905` even
tells the user to "Edit rates in `timeline-budget.js`" — a copy-paste tell.

**Canonical must be `timeline/timeline-budget.js`** (it is the superset: doc mode,
`local-comfy`, the `offered`-model filter, the `CLearn` speed feedback). Delete
`js/budget-engine.js` and point `dashboard.html:1832` at the timeline file;
`dashboard.html:2384`'s comment about "adding a tier in js/budget-engine.js"
updates with it. Nothing in the dashboard's estimator (`dashboard.html:2430-2500`)
touches anything the timeline file lacks.

### HIGH — the seed silently drops account 9900 (stunts, SFX, special units)

`producer/budget-sheet.js:155`:

```js
if (acct === '19000' || acct === '9900') return; // contingency is auto-computed
var target = byAcct[SEED_MAP[acct] || acct] || byAcct['18000'];
```

The early return fires **before** the `SEED_MAP` lookup, so `SEED_MAP['9900']:
'9000'` at `:36` is dead code and the entire `9900 · Stunts, SFX & special units`
line never reaches the top sheet. Measured on the suite's own action fixture:
**$203,500 vanishes.** The comment justifies skipping 19000 (contingency really is
auto-computed) and 9900 got swept along with it.

To a real production this is the money that pays the stunt coordinator, the
licensed pyrotechnician and the marine unit. Fix: drop `|| acct === '9900'` — the
`SEED_MAP` entry already routes it to Art Department, which is where a Movie
Magic sheet carries it.

### HIGH — payroll fringes post to General Expenses and then trip the sheet's own alarm

`budget-engine.js:685` labels the line `'Payroll fringes (28%)'` — **no account
prefix**. `budget-sheet.js:152`'s `label.match(/^(\d{4,5})\s*·\s*(.+)$/)` returns
null, `acct` is null, and the fallback `|| byAcct['18000']` dumps it into General
Expenses. Measured:

| crew tier | fringe line | lands in | 18000 as % of grand | NORMS band |
|---|---|---|---|---|
| nonunion | $446,456 | 18000 | 5.1% | 2–7% |
| union | $708,741 | 18000 | **7.5%** | 2–7% → flagged **▲ high** |

So on a union show the sheet flags its own seed as an anomaly. And a
freshly-seeded sheet carries **12 norm flags** (4000 at 34.6% vs 8–30%, 15000 at
26.7% vs 7–18%, and nine accounts flagged "low" precisely because the crew labour
that belongs to them is sitting in 18000). The `▲/▽` markers at
`budget-sheet.js:236-239` are a good idea rendered useless by a routing bug.

Fix: give the fringe line an account prefix in the engine (`'9800 · Payroll
fringes (…%)'` is the conventional slot), or better, apportion it back across the
labour accounts it came from — `laborPct()` at `budget-engine.js:674` already
knows the split.

### HIGH — the Money Room reads a different budget than the top sheet displays

`producer/budget-sheet.js:59-63` — `itemEst()` returns `amt × units × rate` when
all three are set, ignoring `est`. `finance/lib-money.js:53-61` —
`budgetByAcct()` sums **`num(it.est)`** and nothing else. And
`budget-sheet.js:300-302` does not even render an `est` input while the
calculator is live, so the calculator path can never write `est`.

Measured — one G&E line entered as `30 × 20 days × $650`, one PO for $390,000:

```
top sheet  itemEst 8000 : 390000
money room budgetByAcct : { "8000": 0, "6000": 120000 }
8000 row: budget 0  actual 390000  variance -390000  over true
report totals.budget 120000   vs sheetTotals.subtotal 510000 / grand 561000
```

**Amt × Units × Rate is the top sheet's headline feature** (`index.html:60`:
"Amt × Units × Rate fills the total") and every line built with it has a $0 budget
in the cost report — 100% over, with real spend and no plan behind it. The two
totals render adjacent: `budget-sheet.js:262` prints the Money Room EFC/variance
line directly under the GRAND TOTAL.

Fix: `budgetByAcct` must call the sheet's own `itemEst` (export it, or move both
onto a shared money lib — see *Missing*). Note it also ignores fringes/bond/
insurance/contingency entirely, so `totals.budget` can never reconcile to `grand`.

### HIGH — contingency has two different bases, and fringes/bond double-count

Estimator (`budget-engine.js:723`): `R(direct, CONTINGENCY_PCT)` — 10% of ATL +
BTL + Post **only**, excluding the whole `Other` group.
Sheet (`budget-sheet.js:77-78`): `basis = sub + fringes + bond + insurance`, then
`cont = basis × contingencyPct/100` — where `sub` is *every* category including
16000 Insurance & Legal, 17000 Publicity and 18000 General.

Measured on one project:

| | contingency |
|---|---|
| estimator, 10% of `direct` ($5,511,565) | $551,157 |
| sheet, 10% of `subtotal` ($5,731,678) | $573,168 |
| sheet, if the same money were present (10% of direct+other) | $593,518 |

Seed round-trip: estimator likely **$6,486,336** → seeded sheet grand
**$6,304,846**. A **2.8% / $181k** loss on an operation that should be lossless
($203,500 of dropped 9900 partly offset by the wider contingency base). Two
producers, two tools, same film, different number.

`docs/PRODUCTION_PRICING.md:233` says only "Contingency | 10 %" and never states
of what. Pick one base, name it in the doc, and make both engines call the same
function.

Compounding it: `budget-sheet.js:14-33`'s blank sheet ships literal starter items
named **"Cast fringes"** (4000), **"Payroll fringes"** (18000), **"Completion
bond"** and **"Production insurance"** (16000) — while `:74-76` also offers
`fringesPct` / `bondPct` / `insurancePct` fields. The comment at `:86` says they
"default to 0 so sheets that already carry fringe line items never double up",
but nothing stops the double. Measured: typing 25 / 2 / 2.5 into a **seeded**
sheet — which already carries `Payroll fringes 397,034`, `Completion bond
137,789`, `Insurance 137,789` — adds **$1,102,966**, +17.5%, silently. Fix: when
a seeded fringe/bond/insurance line exists, grey the matching % field and say why.

### HIGH — `driver_load` is silently capped at 1.59; the doc shows no cap

`docs/PRODUCTION_PRICING.md:238-241` prints the formula uncapped. The code
(`budget-engine.js:540-547`, `timeline-budget.js:556-563`) wraps every term:
`Math.min(stunts,20)*0.005 + Math.min(pyro,10)*0.01 + Math.min(water,10)*0.008 +
Math.min(crowds,15)*0.004`, plus `nightPct*0.15` and a flat `+0.10` for heavy VFX.
Ceiling: **1 + .15 + .10 + .10 + .08 + .06 + .10 = 1.59**.

Measured, 30 pages, indie pace, base 6.7 days:

| script | shoot days | implied driver_load |
|---|---|---|
| calm day interiors | 7 | 1.05 |
| all-action, 100% night | 11 | 1.65 (incl. `ceil`) |

An all-night action picture can never stretch more than ~60% past the base pace.
A line producer would routinely double it. Related: **`nightPct` appears exactly
once in the engine** (`timeline-budget.js:557`) — it moves the schedule and
nothing else. There is no night premium on `crewAvgDay`, no shortened usable day,
no turnaround cost. 40 night exteriors and the money barely moves. Rank HIGH
because night work is one of the top three real budget drivers.

### HIGH — auto-schedule cannot see the cast, which is the point of boarding

`producer/schedule-board.js:93-111`. Actual behaviour, not the docstring:

- One greedy first-fit pass. Complexity: `O(n log n)` for the location sort
  (script mode does no sort at all), `O(n)` to fill. No backtracking, no
  improvement pass, no objective function.
- **It never reads `sc.cast`.** Hold days — the thing a stripboard exists to
  minimise — are computed afterwards by `doodMatrix` and fed back to nothing.
- It overwrites `sc.day` for **every** scene, including strips the user
  hand-dragged. There is no lock, so "auto-schedule" is all-or-nothing and any
  manual boarding is destroyed.
- `mode:'location'` sorts by `la < lb` — **alphabetical by location name**
  (`:98-99`). "AIRPORT" before "ZOO" has no relationship to travel time. It does
  correctly put day work before night per location (`:100`), but across
  consecutive locations day/night flip-flops freely — no 10-hour turnaround.
- Cannot express: split days / company move mid-day, second unit, actor
  availability windows, location day-windows or blackout dates, weather holds,
  weekends/holidays (day indexes are bare integers), a 6th day, day-out-of-town,
  or a hard "these two scenes must shoot together".
- No balancing: `if (used > 0 && used + sc.eighths > perDay)` means the last day
  can hold a single 1/8 strip.

The DOOD already computes the objective (`hld` at `:174`). Wiring a cost function
over it is the single highest-leverage change in this slice.

### HIGH — hold days are displayed but never priced

`schedule-board.js:174` computes `hld`; `:390` renders it; `:122`
`boardOverridesModel` exports only `{workDays, spanDays, spanWeeks}`. Day players
are then costed on worked days alone — `budget-engine.js:616-617`:
`castDay[0] += clamp(perf.day * days, 800, …)` with `days = d.workDays`. A day
player with SW on day 1 and WF on day 5 bills 2 days, not 5. Under SAG
consecutive-employment a held performer is payable unless formally dropped
(10-day break). The board can *see* the holds and the budget ignores them.

### MED — background counts are head counts billed as person-days

`schedule-board.js:139`: `extrasDays: scheduled.reduce((a, sc) => a + (sc.extras
|| 0), 0)`. That sums a per-scene **head count**. The engine then labels it
`'4500 · Background & extras (~' + extrasDays + ' person-days)'`
(`budget-engine.js:686`) and multiplies by `EXTRA_DAY_RATE = [120, 270]`
(`:147`). Three scenes on the same day with 50 extras each = 150 person-days
billed for what is 50 people for one day. Fix: group by `sc.day` and take the max
per day, or add a per-scene "same BG as previous scene" flag.

### MED — the incentive table lives in three files; only one drift path is tested

`js/budget-engine.js:166`, `timeline/timeline-budget.js`, and
`taxcredit/lib-taxcred.js:20` (`JURIS`). Verified all three are byte-identical
today (21 entries, deep-equal). `scripts/test_taxcredit.mjs:19-27` guards
`JURIS` against **timeline-budget only**. Nothing guards `budget-engine`'s copy.

A Georgia rate change today = 3 hand-edits to JS + `PRODUCTION_PRICING.md:307`,
with one of the three unguarded. Collapsing the two engines (finding 1) removes
one; the taxcredit mirror should import rather than copy, or the test should
cover all copies.

### MED — the decoder ignores the qualified-spend classifier that already exists

`producer/incentives.js:20-22` applies a flat `qualPct` to the whole budget:
`recLow = budget * i.qualPct * i.rate[0]`. That budget includes the contingency
and the completion-bond fee. Meanwhile `taxcredit/lib-taxcred.js` already ships
`EXEMPT_RE` + `qualifiedGuess()` which correctly excludes travel, hotel/per-diem,
insurance, bond, legal, financing and out-of-jurisdiction spend, and
`creditModel()` runs it over real Money Room rows. The producer decoder should
call `CTaxCred` rather than re-approximating with one blended fraction.

### MED — below-minimum jurisdictions still advertise a full recovery

`producer/incentives.js:41-59`. `belowMin`/`overCap` produce a warning chip in the
Jurisdiction cell, but the *Est. recovery* and *Net cost* columns still print the
full number and the row still sorts by it. Only the `in-best` highlight is
suppressed (`:42-43`). A $200k film sees Georgia's recovery figure against a
$500k program minimum. Zero or strike those cells.

Minor and same file: the recovery column prints a low–high **range** (`:59`) while
Net cost uses the **midpoint** (`:27`), so net never brackets recovery.

### MED — the call sheet is missing most of what a call sheet is for

`schedule-board.js:300-344` produces: date, one general call, scene rows, cast
rows, locations, notes. The "Cast calls" table (`:308-310`) prints the **DOOD
code** — `SW`, `W`, `H` — where a call sheet prints a **time**. Absent: per-cast
call times, crew call, meal times (a meal penalty is real money), nearest
hospital, basecamp/parking/crew park, walkie channels, weather, sunrise/sunset,
and tomorrow's advance schedule.

`tools/lib-sun.js` is **already loaded on this page** (`producer/index.html:160`)
and exports `sunTimes`, `daylightHours`, `wmoLabel`, `shootRisk`
(`tools/lib-sun.js:100-101`). Nothing under `producer/` references `TSun`. That
is a very cheap, very visible win.

### MED — two unlinked shoot calendars

`tools/sched-weather.js` (loaded at `producer/index.html:161`) owns the real
mapping: start date + skip-weekends → per-day calendar dates, sunrise, golden
hours, forecast, risk score, stored under `SB_ShootPlan_v1`
(`sched-weather.js:105-114`). The call sheet keeps its own **free-text** date the
user types by hand (`schedule-board.js:318`, `dayMeta[d].date`, placeholder
`MM/DD`). `production/lib-prod.js:44` reads `stores.plan.date` as `dayOneDate`
and does no arithmetic. And `schedule-board.js:122` hard-codes
`spanWeeks = ceil(span/5)` — a 5-day week the planner's `skipWk` checkbox lets
you turn off.

Result: the planner knows Day 12 is Fri 2026-10-16 with a 62 rain risk; the call
sheet for Day 12 is blank until someone types it, and the cast weekly cost
assumes a 5-day week regardless. Also, the planner's own footer says "reorder
exterior days away from red" — an instruction to the human, because the scheduler
cannot consume its own risk score.

### MED — `PRODUCTION_PRICING.md` Part 1 documents a product that no longer ships

`js/model-config.js:13-15` offers exactly **one** video model: `local-comfy`
("Cinamate AI") at **$0/sec**. `timeline-budget.js` filters the cost table to
offered models and zeroes the stills cost when everything is local. Meanwhile
`PRODUCTION_PRICING.md:28-77` (§1.1–1.3) tabulates 10 cloud models with
per-second prices and a dollar worked example, and **never mentions
`local-comfy`**. The doc's opening claim (`:3`) that it "backs every number in
`timeline/timeline-budget.js`" is now false for Part 1. Part 2 (production
pricing) still checks out against the code — I verified the tier tables,
special-unit day rates, `INSURANCE_PCT`/`LEGAL_PCT`/`BOND_PCT`, the account-split
percentages at `:293-295`, and the eighths convention.

Also stale: the doc is headed "**Shotbreak** Producer's Estimate" while every
module says Cinamate.

### MED — no `lib-*.js` under `producer/`

The brief's own convention: "Every module has a `lib-*.js` of pure logic with no
DOM, node-testable." `producer/` has none. `autoScheduleModel`, `doodMatrix`,
`sheetTotals`, `itemEst`, `seedFromEstimate`, `sheetToCsv` and `rows()` are all
pure, and all live inside DOM-coupled IIFEs. `test_producer_suite.mjs:7-9` only
works because nothing touches `document` at module scope — one new top-level DOM
reference and all 60-odd producer assertions die at once. It also means no other
module can reuse the scheduler without dragging in the renderer.

### MED — the DOOD and call sheet are print-only

`schedule-board.js:442` and `:338-343` go straight to `window.print()`. The top
sheet has a proper CSV (`:353-361`). A DOOD is a document the AD emails to
payroll and the agents; PDF-only means no data handoff, and no re-import.

### LOW — internal duplication and recompute in `budget-sheet.js`

- `extras()` (`:88-98`) recomputes `laborBase`, `fringes`, `bond`, `insurance`
  with the same expressions as `sheetTotals()` (`:72-76`). Verified identical
  outputs. One should call the other.
- `LABOR_ACCTS` is read at `:73` and declared at `:87` — safe only because
  `var` hoists and `sheetTotals` is call-time. Fragile.
- `renderTopSheet` calls `norms()` twice (`:231`, `:255`); each does a full
  `sheetTotals()`, which itself walks `catTotals` twice. `catTotals` runs roughly
  5× per category per render, and every field `change` re-renders (`:315-320`).
  Harmless at 18 categories; memoise if line counts grow.

### LOW — cash flow puts bond and insurance in the wrong phase

`cashflow()` (`:128-140`) computes prep/shoot/post from the `PHASE` table, then
`overhead = grand - (prep+shoot+post)` — i.e. fringes + bond + insurance +
contingency — and splits it **50/50 shoot/post** (`:137`). The completion-bond fee
and the insurance binder are prep cash; a financier reading "CASH NEEDED — prep
$1.09M" is under-told what has to be wired before day one.

### LOW — `ukiftc.budgetCap` compares the wrong quantity

`budget-engine.js:174`: `budgetCap: 30e6` is tested against `likely`, the total
budget. The real IFTC limit is ~£15M of **core expenditure**, not total budget.
Roughly right by coincidence; wrong in principle.

---

## What is missing entirely

### 1. A scheduling / constraint core — `producer/lib-sched.js`. Value: HIGHEST

What: strips + hard constraints + an objective, separated from the DOM.
Constraints a feature actually needs: cast availability windows, locked strips,
location day-windows and blackout dates, min/max consecutive days, 10-hour
turnaround (blocks day-after-night), split days / company moves, second unit,
weather-sensitive exteriors with a cover set. Objective: company moves + cast
hold days + night premium + weather risk (`TSun.shootRisk` already produces the
last term). Implementation: greedy seed (what exists now) then a bounded local
search — swap/move a strip, keep if cost drops, ~2,000 iterations. That is 200
lines of vanilla JS and no dependency.

Attaches to: `producer/schedule-board.js` replaces `autoScheduleModel` with a
call into it; `production/`, `today/` and `workflow/` all already read
`SB_ScheduleBoard_v1` and inherit the improvement for free.
Why a production needs it: hold days and company moves are where an indie
schedule bleeds, and the app already measures both and acts on neither.

### 2. One money / rounding library — `js/lib-money-math.js`. Value: HIGH

Not just `round()` and `pct()`. The load-bearing export is a single
`rollup(lineItems, {fringesPct, bondPct, insurancePct, contingencyPct})` that
defines — once — what the contingency base is, what counts as a labour account,
and whether an explicit fringe line suppresses the percentage field. Today that
logic exists three times with three answers: `budget-engine.js:713-725`,
`budget-sheet.js:69-98`, and `finance/lib-money.js:53-61`. Also folds in
`itemEst` so the Money Room and the top sheet cannot disagree (finding 4).
Attaches to: both engines, `producer/budget-sheet.js`, `finance/lib-money.js`,
`investors/lib-invest.js:206` (which re-derives a grand total again).

### 3. A rate table updatable without a code change. Value: HIGH

Today a Georgia rate change is: edit `INCENTIVES` in `js/budget-engine.js`, edit
it again in `timeline/timeline-budget.js`, edit `JURIS` in
`taxcredit/lib-taxcred.js`, edit the table in `PRODUCTION_PRICING.md` — with only
one of the three drift paths under test. Same story for `TIERS`, `STUNT_DAY`,
`PYRO_DAY`, `PERFORMER_RATES`, `AI_MODEL_RATES` — all `var` literals inside IIFEs
with no override hook.

Shape that respects the no-build constraint: `data/rates.json` and
`data/incentives.json` fetched once at boot by a tiny `js/rates.js`, shallow-
merged over the built-in defaults so the app still works offline and if the fetch
fails. Version + `verifiedAt` fields per table so the UI can say "SAG rates as of
2026-08". `scripts/test_rates.mjs` validates shape and that every `rate` is a
2-element ascending band. Then a rate year rolls over with a JSON edit and a
doc-table regeneration, not four code edits.

### 4. A shared shoot calendar — `producer/lib-calendar.js`. Value: MED-HIGH

`shootDates(day1, n, {skipWeekends, sixthDay, holidays})` → `[{day, date, dow}]`,
plus `weeksBetween()` for the cast span maths. The loop already exists inside a
renderer at `sched-weather.js:105-114`. Extracting it lets the call sheet
auto-fill its date, the DOOD replace `ceil(span/5)` with real elapsed weeks
(`schedule-board.js:122`), `production/lib-prod.js:44` compute a DPR date from a
day index, and the weather planner stay in sync with all of them. Small, and it
unblocks four other findings.

### 5. Hold-day and night-premium cost terms. Value: MED

`boardOverridesModel` should export `holdDays` alongside `workDays`, and the
engine should price them (day players first — that is where SAG consecutive
employment bites). Separately, a `nightPremium` multiplier on `crewAvgDay` for
days the board marks night. Both are a handful of lines each and both correct a
systematic under-estimate.

---

## Evidence

Files read in full: `producer/schedule-board.js` (475), `producer/budget-sheet.js`
(417), `producer/incentives.js` (105), `producer/index.html` (306),
`js/budget-engine.js` (1,082), `timeline/timeline-budget.js` (diffed in full
against the above), `docs/PRODUCTION_PRICING.md` (430),
`scripts/test_producer_suite.mjs` (248). Read in part:
`producer/sales-forecast.js:1-60,346-358`, `producer/producer.css:99-140`,
`finance/lib-money.js:40-100`, `taxcredit/lib-taxcred.js:1-80,150-175`,
`tools/sched-weather.js:60-175`, `tools/lib-sun.js:95-102`,
`js/model-config.js:1-16`, `dashboard.html:2370-2500`,
`production/lib-prod.js:1-44`, `scripts/test_taxcredit.mjs:1-60`.

Specific lines behind each claim:

- Two engines: `dashboard.html:1832` vs `producer/index.html:162` and
  `timeline/index.html:315`; doc-mode branch at `timeline-budget.js:541`, absent
  from `budget-engine.js`; 1,038/1,082 identical lines by `difflib`
  `SequenceMatcher`; no test loads `budget-engine.js` (`test_budget_estimator.mjs:7`,
  `test_producer_suite.mjs:7`, `test_learn.mjs:10`, `test_advisor.mjs:12`,
  `test_taxcredit.mjs:20` all name `timeline/timeline-budget.js`); stale
  self-reference at `budget-engine.js:905`.
- 9900 dropped: `budget-sheet.js:155` early return; dead `SEED_MAP` entry at `:36`.
- Fringe routing: `budget-engine.js:685` (unprefixed label) → `budget-sheet.js:152`
  regex → `:156` `byAcct['18000']` fallback; NORMS band at `:104-108`; flag render
  at `:236-239`.
- Money Room mismatch: `budget-sheet.js:59-63` (`itemEst`) vs
  `finance/lib-money.js:53-61` (`budgetByAcct`); no `est` input at
  `budget-sheet.js:300-302`; adjacent render at `:262`.
- Contingency bases: `budget-engine.js:723` vs `budget-sheet.js:77-78`; doc
  `PRODUCTION_PRICING.md:233`. Double-count starter items at `budget-sheet.js:18,
  30, 32` vs the % fields at `:74-76` and the comment at `:86`.
- `driver_load` caps: `budget-engine.js:540-547` (`Math.min` on every count) vs
  uncapped doc formula at `PRODUCTION_PRICING.md:238-241`; `nightPct` used once at
  `timeline-budget.js:557`.
- Scheduler: `schedule-board.js:93-111` (greedy fill, alphabetical location sort
  at `:98-99`, day-before-night at `:100`, unconditional `sc.day` overwrite at
  `:107`); `sbAuto` handler at `:410-416`.
- Holds: computed `schedule-board.js:174`, rendered `:390`, not exported `:122`,
  not priced `budget-engine.js:616-617`.
- Extras units: `schedule-board.js:139` vs label at `budget-engine.js:686` and rate
  at `:147`.
- Incentive triplication: `budget-engine.js:166`, `taxcredit/lib-taxcred.js:20`,
  test at `test_taxcredit.mjs:19-27`; unused classifier at `lib-taxcred.js`
  (`EXEMPT_RE`, `qualifiedGuess`); flat `qualPct` at `incentives.js:20-22`;
  below-min still priced at `incentives.js:41-59`; `ukiftc` cap at
  `budget-engine.js:174`.
- Call sheet: `schedule-board.js:300-344`, DOOD codes as "calls" at `:308-310`;
  `TSun` loaded at `producer/index.html:160`, exported at `tools/lib-sun.js:100`,
  zero references under `producer/`.
- Calendars: `sched-weather.js:105-114` and `KEY` at `:11`; free-text date at
  `schedule-board.js:318`; `ceil(span/5)` at `:122`; `dayOneDate` at
  `production/lib-prod.js:44`.
- Doc drift: `js/model-config.js:13-15` (one model), `PRODUCTION_PRICING.md:28-77`
  (ten models), `:3` (backing claim), `:1` ("Shotbreak").
- Duplication in `budget-sheet.js`: `extras()` `:88-98` vs `sheetTotals()` `:72-76`;
  `LABOR_ACCTS` read `:73` / declared `:87`; double `norms()` at `:231` and `:255`;
  cashflow overhead split at `:137`.
- Known-good: `csvCell` `:175-181`; `doodMatrix` `:148-179`; eighths
  `:14-37`; print isolation `producer.css:134-139`.

Numbers were produced by evaluating the shipped files under node (same technique
as `scripts/test_producer_suite.mjs`) against the suite's own action fixture
(`test_producer_suite.mjs:37`) and the doc treatment fixture (`:179-199`), plus a
synthetic 30-page script for the `driver_load` ceiling. `node
scripts/test_producer_suite.mjs` → all checks pass, unmodified. No source file
was edited.
