# Line Producer / UPM — budget, cost report, actuals

Read as the person who signs the budget, defends it to the financier and the
bond company, and has to explain the Friday cost report. Verdict up front:

**The skeleton is right and the estimator is unusually well-sourced. The
plumbing between them is broken.** A production accountant would recognise the
top sheet and the DOOD immediately. They would then discover that the number on
the top sheet, the number in the cost report, the number in the investor letter
and the number in the tax-credit ledger are four different numbers, computed by
four different pieces of code, and that three of them silently drop every line
item entered with the Amt × Units × Rate calculator the toolbar tells you to use.

---

## What exists and works

- `producer/budget-sheet.js:14-33` — an 18-account top sheet on the real
  Movie Magic / standard-feature numbering (1000 Story, 2000 Producers,
  3000 Direction, 4000 Cast, 5000 Production Staff, 6000 Camera, 7000 Sound,
  8000 G&E, 9000 Art, 10000 Wardrobe, 11000 HMU, 12000 Transpo, 13000 Locations,
  14000 Media, 15000 Post, 16000 Insurance/Legal, 17000 Publicity,
  18000 General, with 19000 Contingency computed rather than typed). This is a
  structure a real accountant can read without a legend. It is genuinely fine.
- `producer/budget-sheet.js:59-63` — `itemEst()` implements the correct
  detail-line convention: Amt × Units × Rate wins when all three are set,
  manual estimate otherwise. Three-level hierarchy (top sheet → category →
  detail line) is right.
- `producer/budget-sheet.js:64-81` — detail rolls to category rolls to top
  sheet with no manual re-entry, and fringes / bond / insurance / contingency
  are computed on top. The contingency basis (`subtotal + fringes + bond +
  insurance`) is defensible.
- `producer/budget-sheet.js:87` — `LABOR_ACCTS` correctly identifies 2000–11000
  as the fringeable accounts and leaves 12000+ alone. Defaults to 0 % so a
  sheet that already carries fringe lines does not double up — that is the
  right call and the tooltip at `:228` says so.
- `producer/budget-sheet.js:104-119` — `NORMS`, the per-account share bands.
  A "the bond company will ask about this" flag is exactly the right instinct
  for a top sheet, and the bands themselves are plausible.
- `producer/schedule-board.js:145-179` — a real DOOD matrix with the correct
  codes (SW / W / H / WF / SWF), work days, span, and hold days derived from
  actual board day assignments. Not a mock-up; the codes and the hold
  arithmetic (`:174`) are right.
- `producer/schedule-board.js:113-143` — `boardOverridesModel()` feeds the real
  stripboard back into the estimator: cast spans from actual day assignments,
  stunt/SFX/water/animal day counts from breakdown tags, extras person-days
  summed. Schedule drives budget, which is the correct direction of causality
  and is rarer than it should be in tools like this.
- `finance/lib-money.js:63-98` — `costReport()` is the right model:
  Budget / Actual / Committed / ETC / EFC / Variance per account, with
  `EFC = Actual + Committed + ETC` and `Variance = Budget − EFC`, ETC
  defaulting to remaining plan (`:87-88`) and overridable per line. Open POs
  are committed, invoiced/paid are actual (`:78-79`). Unbudgeted accounts
  surface as their own row (`:68`) instead of vanishing. This is the correct
  weekly-cost-report shape.
- `contracts/index.html:150-153` + `contracts/lib-deal.js:59-66` — signing a
  deal memo automatically raises a commitment PO in the Money Room. That is the
  right reflex; payroll obligation should hit the cost report on signature, not
  on first invoice.
- `tools/lib-money.js:47-111` — the timecard calculator is the best single
  piece of line-producer code in the repo. 1.5× after 8 *worked* hours, 2×
  after 12 *elapsed*, golden time 3× after 15, escalating meal penalties by
  half-hour, forced-call turnaround invasion priced at the hourly rate, 6th/7th
  day multipliers, fringes on the subtotal. The worked-vs-elapsed distinction
  at `:59-62` is the detail that separates people who have done this from
  people who have read about it.
- `docs/PRODUCTION_PRICING.md` — 430 lines, every rate table traced to a named
  source, official union rate cards linked first and trade press second, and a
  §2.14 "Known limitations" that volunteers the weaknesses (marketing excluded,
  cast fringe approximated, DOOD unoptimised, genre benchmarks are 2005-vintage
  data inflated forward). This is better sourcing than most commissioned budget
  templates ship with. Do not let anyone "clean this up".
- `producer/incentives.js:18-32` + `taxcredit/lib-taxcred.js:138-163` — the
  jurisdiction comparison and the application checklist are honest: every
  screen says the figures are estimates on published headline terms and that an
  accountant decides. The checklist correctly separates pre-registration,
  residency documentation, cultural certification and the CPA audit.

---

## What exists but needs work

### HIGH — the budget total is computed five different ways and four are wrong

`producer/budget-sheet.js:69-81` is the only correct implementation. Every
other consumer reimplements it and reads `it.est` directly, which is **zero**
for any line entered through the Amt × Units × Rate calculator the toolbar
advertises at `producer/index.html:60`:

- `finance/lib-money.js:53-61` — `budgetByAcct()` sums `num(it.est)`.
- `investors/lib-invest.js:207-213` — `budgetTotal()` sums `num(it.est)`.
- `workflow/advisor-ui.js:31-35` — its own subtotal from `parseFloat(i.est)`.
- `js/learn.js:60` — calibration reads `parseFloat(it.est)`.
- `taxcredit/index.html:115-121` — inherits the bug via `CMoney.budgetByAcct`.
- `tools/tools-money-ui.js:129-140` — **this one is correct** (`num(it.amt) *
  num(it.units) * num(it.rate)` with `est` as fallback), which proves the other
  five are oversights, not design.

Verified by execution. A single line "Camera crew 6 × 20 days × $700" gives:

```
top-sheet catTotals 6000 est = 84000
CMoney.budgetByAcct 6000 budget = 0
cost report row 6000 = {budget:0, committed:84000, efc:84000, variance:-84000, over:true}
```

The camera account reads **$84,000 OVER on day one** against a budget of zero.
Why it matters: the cost report is the document you take into the Monday
production meeting. If it declares a fully-budgeted department 100 % over
because of how the estimate was typed, nobody uses the cost report again, and
the same wrong number goes out in the investor update letter.

**Fix:** export `itemEst` from `SBBudgetSheet` (it already is, `:409`) and have
all five call one shared account-total function. One helper, five call sites.

### HIGH — the cost report's budget column excludes fringes, bond, insurance and contingency

`finance/lib-money.js:53-61` only sums category detail lines. Verified:

```
sheetTotals: subtotal 1,000,000 · fringes 280,000 · bond 25,000 ·
             insurance 25,000 · contingency 133,000 · grand 1,463,000
CMoney budget total: 1,000,000
```

EFC is therefore being compared against a budget **32 % smaller than the one
that was approved and financed**. Worse, there is no 19000 Contingency row in
the cost report at all — so the single most common weekly-cost-report action,
*drawing contingency down against a department overage and showing the
remaining contingency*, is impossible. A bond company reads the contingency
balance before it reads anything else.

**Fix:** `budgetByAcct()` should emit synthetic rows for fringes (allocated
across the labor accounts, or as its own account), bond, insurance, and a real
19000 Contingency account whose ETC is manually drawn down. Rank: HIGH.

### HIGH — signed deal memos post commitments to the wrong accounts

`contracts/lib-deal.js:14-16`:

```js
var DEPT_ACCT = { cast: '2000', camera: '3000', 'g&e': '3000', grip: '3000',
  electric: '3000', art: '3000', sound: '3000', wardrobe: '3000', hmu: '3000',
  production: '3000', stunts: '3000', locations: '3000',
  edit: '5000', post: '5000', music: '5000' };
```

Against the top sheet at `producer/budget-sheet.js:14-33`, 2000 is **Producers
Unit**, 3000 is **Direction** and 5000 is **Production Staff**. So every cast
agreement commits against the producers' fee, every camera/grip/art/sound/
wardrobe/HMU/stunts/locations deal commits against the director's fee, and
every editorial and music deal commits against production staff. The fallback
at `:62` (`f.kind === 'cast' ? '2000' : '3000'`) has the same error.

Once you sign twenty crew deals, account 3000 Direction reads several hundred
percent over and Camera, G&E, Art, Sound, Wardrobe and HMU all read zero
committed. Account-level variance — the only reason to have accounts — becomes
noise. **Fix:** remap to cast 4000, production 5000, camera 6000, sound 7000,
G&E/grip/electric 8000, art/stunts 9000, wardrobe 10000, HMU 11000,
locations 13000, edit/post/music 15000. Ten minutes of work, and it is the
difference between a usable and an unusable cost report.

### HIGH — the top sheet is displayed at two significant figures

`producer/budget-sheet.js:218` → `SBBudget.fmtMoney` (`timeline/timeline-budget.js:846-852`)
renders `$1.5M`, `$163k`, `$84k`. Every amount on the top sheet, every category
subtotal, the grand total, and the *computed Amt × Units × Rate cell in the
detail grid* (`:301`) go through it. A $163,412 line reads "$163k".

A line producer cannot foot a top sheet they cannot read to the dollar, and
cannot check a rate calculation whose result is rounded before they see it.
`fmtMoney` also does `Math.max(0, …)` at `:847`, so any negative figure
displays as `$0`. The Money Room already uses exact `toLocaleString()`
(`finance/index.html:99`) — the top sheet should too. Keep `fmtMoney` for the
estimator's planning ranges, where 2sf is honest. Rank: HIGH.

### HIGH — the CSV export does not foot

`producer/budget-sheet.js:182-196` writes SUBTOTAL, then the 19000 Contingency
row, then GRAND TOTAL. It never writes the fringes, bond or insurance rows.
Verified:

```
,,SUBTOTAL (all categories),,,,1000000,,
19000,Contingency,10%,,,,133000,,
,,GRAND TOTAL,,,,1463000,,
```

$330,000 appears from nowhere. This CSV is the artifact that goes to the
financier, the bond company and the accountant. A top sheet that does not add
up is worse than no top sheet. **Fix:** three `rows.push` calls mirroring
`renderTopSheet`'s `:247-249`. Rank: HIGH — it is a five-line fix on a
document of record.

### HIGH — two engines define the same global, and the Producer Suite and the dashboard use different ones

`js/budget-engine.js` (1,081 lines) and `timeline/timeline-budget.js` (1,239
lines) are a fork of the same file — the entire rate table, tier structure,
incentive table, driver regexes and `estimateProduction` are duplicated. Both
end with `root.SBBudget = API`. `dashboard.html:1832` loads the first;
`timeline/index.html:315`, `producer/index.html:162` and
`workflow/index.html:87` load the second. `taxcredit/lib-taxcred.js:20-42`
carries a *third* verbatim copy of the incentive table, its comment at `:16`
admitting it.

They have already drifted (`local-comfy` model, documentary mode, `analysis.doc`
exist only in the timeline copy). A rate correction — and these rates change
every contract year — has to land in two or three files or the dashboard quotes
one budget and the Producer Suite quotes another. **Fix:** make
`timeline-budget.js` the single engine, load it on the dashboard, delete the
fork, and have `lib-taxcred.js` read `SBBudget.INCENTIVES`. Rank: HIGH for
maintenance risk on a rate-driven product.

### MED — the tax-credit model double-discounts qualified spend

`taxcredit/lib-taxcred.js:116` — `rawCredit = qualifiedSpend * qualPct * mid`.
But `qualifiedSpend` (`:112`) is already the sum of only those rows that passed
row-level qualification, and `qualPct` is documented at `:19` as "fraction of a
*typical budget* that qualifies". Applying both discounts the same haircut
twice. Verified:

```
NY, $1.0M of spend the accountant tagged 100% qualified:
  estCredit 165000   <- should be 1,000,000 x 30% = 300,000
```

An accountant who does the work of tagging the ledger line by line is punished
for it — the more carefully they tag, the further under the true credit the
number lands. `qualPct` belongs on the *whole-budget advisor model* (`:120`,
where it is correct), not on the tagged ledger. Rank: MED — it understates, so
it will not blow up a cash flow, but the ledger tab's entire purpose is to beat
the whole-budget assumption and it structurally cannot.

### MED — minimum-spend thresholds test against running ledger spend

`taxcredit/lib-taxcred.js:117` — `belowMin = juris.minSpend && totalSpend <
juris.minSpend`, where `totalSpend` is spend posted so far. Verified: a $6M
Georgia production with $100k posted reads `belowMin: true, estCredit: 0`. The
budget total is already a parameter (`budgetTotal`, `:118`) and is the right
basis for a *threshold* test. Test the threshold against budget; use ledger
spend for a separate "$X to go before the floor" progress figure. Rank: MED.

### MED — the calibration loop learns from mid-shoot partial actuals

`producer/budget-sheet.js:207-213` calls `CLearn.learnBudget(sheet)` on every
edit, and `js/learn.js:55-76` learns from any line where both `est` and
`actual` are > 0, weighting each new observation at 0.3 (`:68`). During a shoot
the actual column holds *partial* spend. Typing the first $5k invoice against a
$50k account teaches the estimator "this account comes in at 0.25×" (clamped at
`:66`), permanently biasing the next film's estimate downward. The fingerprint
at `:62` includes the actual value, so every revision of a partial actual
learns again.

Actuals should calibrate at wrap, not continuously. **Fix:** gate `learnBudget`
behind an explicit "close this account" / "lock the budget" action, or only
learn from `CMoney.feedLearning` (`finance/lib-money.js:132-142`) once a final
cost report snapshot is taken. Rank: MED — it silently degrades the one feature
that would make this tool better than a spreadsheet over time.

### MED — the norm bands are measured against a denominator they were not derived from

`producer/budget-sheet.js:113` divides each account by `tot.grand`, which
includes contingency, fringes, bond and insurance — money that by construction
sits in no account. At the default 10 % contingency alone, every account's
share reads ~9 % lower than its share of direct costs, biasing the whole sheet
toward the "▽ light" flag. On a seeded sheet I measured 13 of 18 accounts
flagged, which renders the flag meaningless. Divide by `tot.subtotal`, or state
in the tooltip that the bands are shares of the grand total and re-derive them.
Rank: MED — a warning that fires on everything is a warning that fires on
nothing.

### MED — one flat fringe rate across cast and crew, and the estimator disagrees with the top sheet

`producer/budget-sheet.js:74` applies a single `fringesPct` uniformly across
accounts 2000–11000. The estimator, in the same product, weights cast fringes
at 0.6 (`timeline/timeline-budget.js:648-650`) precisely because SAG P&H caps
out on large fees — and the pricing doc explains why (§2.1: non-union ~28–30 %,
IATSE ~40 %, SAG ~45 %). So the top sheet and the estimator that seeds it use
two different fringe methodologies on the same numbers.

A real budget carries a fringe rate *per account*, because 4000 Cast (SAG),
6000–11000 (IATSE) and 5000 (often non-union) are three different rates, and
the union mix is the single largest swing factor in a US indie budget. **Fix:**
`LABOR_ACCTS` becomes `{ '4000': 'sag', '5000': 'nonunion', '6000': 'iatse', … }`
with an editable rate per basis. Rank: MED.

### MED — the estimator's payroll fringes land in 18000 General Expenses when seeded

`timeline/timeline-budget.js:700` emits the fringe line as
`'Payroll fringes (40%)'` — no account prefix. `producer/budget-sheet.js:152`
matches `/^(\d{4,5})\s*·\s*(.+)$/`, fails, and `:156` falls through to
`byAcct['18000']`. Verified on a seeded sheet: `18000 General Expenses` carried
`Payroll fringes (40%) | General expenses (~4% of BTL)` at 4.9 % of grand
total. Fringes are not a general expense; on a union picture they are the
second-largest number on the sheet. Give the estimator line an account number
(a dedicated fringe account, or allocate across the labor accounts). Rank: MED.

### MED — cash flow puts half the bond and insurance in post

`producer/budget-sheet.js:128-140`. The `PHASE` table itself is thoughtful
(`:122-127` — post at `[0, .05, .95]`, wardrobe front-loaded at `[.6, .35, .05]`
— someone has done this). But `:136-137` takes everything not in the account
structure (fringes + bond + insurance + contingency) and splits it 50/50
shoot/post. The completion bond fee is paid at closing and the insurance
premium at binding — both are **prep** cash, and the whole point of a cash-flow
schedule is telling the financier how much money must be in the account before
day one. Attribute bond and insurance to prep, fringes to the phase weighting
of the labor they sit on, and only contingency to shoot/post. Rank: MED.

### MED — the weekly snapshot stores totals only

`finance/lib-money.js:101-107` freezes `report.totals` and nothing else. So
there is no per-account week-over-week movement — the column a line producer
actually reads ("Camera moved $40k against us this week"). `finance/index.html:129-131`
can only print one line about the last snapshot. Store `report.rows` in the
snapshot (52 weeks × ~20 accounts is trivial) and render a movement column.
Rank: MED, and it is the cheapest large improvement in this report.

### MED — hot costs are a second, unreconciled set of books

`tools/tools-money-ui.js:117-128` keeps postings in `SB_HotCost_v1` with its own
`actual`/`po` kinds and its own budget read; `finance/lib-money.js` keeps POs
and petty cash in `SB_Money_v1`. A PO issued in the Money Room does not appear
in Hot Costs and a hot-cost posting does not appear in the cost report.
`production/lib-prod.js:31` builds the DPR's hot-cost figure from
`SB_HotCost_v1` only, so the DPR ignores every PO the production actually
issued. Two ledgers that never reconcile is the classic way a production loses
track of its money. Hot costs should be a *view* over `SB_Money_v1` filtered by
date, not a separate store. Rank: MED (HIGH if anyone actually uses both).

### MED — "hot costs" are not date-aware, so they are not hot costs

`tools/lib-money.js:116-138` aggregates postings by account and ignores the
`date` field the register collects (`tools-money-ui.js:121`).
`production/lib-prod.js:31` sums all hot-cost rows with no date filter while
date-filtering takes and timecards (`:27`, `:30`). What is implemented is a
cumulative actual-vs-budget summary — a small cost report. A hot cost is
specifically *yesterday's* cost against yesterday's plan, on the UPM's desk by
call. Add a date filter and a per-day budgeted-vs-actual line. Rank: MED.

### MED — timecards cannot post to a budget account

`tools/tools-money-ui.js:88` logs `{date, name, call, wrap, hours, total, notes}`.
No `acct`. So the best-calculated number in the product — a fully fringed
day's payroll — can never reach the cost report, and payroll (the largest
single category in most budgets) is invisible to Actual. Add an account field
and a "post to cost report" action writing into `SB_Money_v1`. Rank: MED, and
it is what turns the timecard calculator from a toy into the payroll feed.

### LOW — SAG scale is carried in two places with two different numbers

`contracts/lib-deal.js:13` — `SAG_SCALE = { day: 1204, week: 4181 }`.
`timeline/timeline-budget.js:217-221` and `docs/PRODUCTION_PRICING.md` §2.1 —
`{ day: 1246, week: 4326 }` for 2025-26. The deal-memo module is issuing cast
agreements at a prior year's scale. Read it from `SBBudget.PERFORMER_RATES`.

### LOW — the cost report CSV has no header block

`finance/lib-money.js:120-129` emits `Acct,Category,Budget,…` and rows. A cost
report of record needs project name, period ending, week number, prepared-by
and a "budget as of" reference on the face of the document. Four lines.

### LOW — contingency is charged on the bond fee

`producer/budget-sheet.js:77-78` — the contingency basis includes the bond and
insurance premiums. Most bond companies compute contingency on ATL + BTL before
bond, insurance and contingency. Minor and arguable, but it is the kind of
thing a bond company will query.

### LOW — no currency anywhere

`fmtMoney` hardcodes `$` and there is no currency or FX field on the sheet.
The product's own incentive table (`timeline/timeline-budget.js:169-196`) lists
UK, Ireland, Hungary, Czech, Australia, NZ, Iceland, Malta, Italy, Greece,
Germany and Spain and actively recommends shooting there. A UK production
budgets in GBP and claims AVEC in GBP. Low rank only because it is a large
change and the single-currency case is the common one.

---

## What is missing entirely

- **Locked approved budget vs. working budget.** HIGH value. There is one
  mutable `SB_BudgetSheet_v1` (`producer/budget-sheet.js:11`). Editing an
  estimate silently changes every historical variance — the cost report has no
  fixed baseline to vary *against*, which is the definition of a cost report.
  A real production locks the approved budget at financing close and moves
  money afterwards only through numbered, signed amendments. Attach to
  `producer/budget-sheet.js`: a `locked` snapshot of the sheet stored alongside
  the working one, `CMoney.costReport` reading the locked copy for its Budget
  column, and an amendment log (date, from-account, to-account, amount,
  reason, approver). Roughly one new lib + one panel. This is the single most
  valuable thing on this list.
- **Purchase order approval chain.** HIGH value. `finance/lib-money.js:23-32`
  creates a PO already `open` — no requester, no approver, no approval
  threshold, no audit trail. On a real show, a PO over the UPM's limit needs
  the producer, and over the producer's limit needs the financier or bond
  company. Without it there is no control, only a record. Attach to
  `finance/lib-money.js`: add `requestedBy`, `approvedBy`, `approvedAt`, a
  `pending` status before `open`, and a per-account approval limit table;
  commit nothing to the Committed column until approved. Small — a status and
  three fields, plus UI.
- **Petty cash envelopes / floats.** MED-HIGH value. `finance/lib-money.js:39-44`
  logs a receipt against an account and nothing else. Real petty cash is issued
  as a float to a named holder, spent down against receipts, and *reconciled* —
  the balance in each envelope, unreconciled floats outstanding, and who is
  holding cash they have not accounted for. Attach to `finance/lib-money.js`:
  a `floats` array (`{holder, issued, date, returned}`), receipts referencing a
  float id, and a reconciliation view showing issued − receipted − returned per
  holder. Half a day.
- **Cost-to-complete by account with a real basis.** MED-HIGH value. ETC exists
  (`finance/lib-money.js:87-88`) but defaults to "whatever is left in the plan"
  and is otherwise a free-text number. A defensible ETC is derived: days
  remaining × the account's run rate to date, or remaining scenes × cost per
  scene. Attach to `finance/lib-money.js` plus the stripboard
  (`producer/schedule-board.js`) for days-remaining: offer three ETC bases per
  account — plan remaining, run-rate extrapolation, manual — and show which one
  each line is using. This is what makes an EFC arguable rather than asserted.
- **Weekly cost report as a document.** MED-HIGH value. There is a live table
  but no printable, dated report of record with prior-week comparison, this
  week's movement, a contingency-remaining line and a signature block. That
  document is the deliverable to financiers and the bond company, weekly, under
  contract. Attach to `finance/index.html` + the enriched snapshot above. Small
  once snapshots carry rows.
- **Fringe detail by union agreement.** MED value. See the MED finding above —
  one global percentage cannot express SAG P&H caps, IATSE MPI hourly H&P plus
  IAP percentage plus vacation/holiday, and the employer payroll-tax ceilings
  (FICA/FUTA/SUTA) that stop applying partway through a run. The pricing doc
  already documents all of these correctly (§2.1); the top sheet just does not
  implement them. Attach to `producer/budget-sheet.js` as a fringe-basis table.
- **Financing plan and drawdown schedule.** MED value. `cashflow()` gives three
  lumps (prep/shoot/post). A financier needs the other side: sources (equity,
  gap, pre-sales, tax-credit bridge — the last of which the taxcredit module
  can already size), each with a drawdown date, tested against the weekly cash
  requirement so the negative-cash weeks are visible. `investors/lib-invest.js`
  already models the recoupment waterfall; this is the front half of the same
  story and is missing. Attach to `producer/` as a fourth tab or to
  `investors/`.
- **Amortisation / pattern budgeting.** LOW-MED value. No way to express a cost
  that is shared across episodes or units, or a spend amortised over a run.
  Only matters if series work is ever in scope.
- **Automated top-sheet vs cost-report reconciliation check.** MED value, tiny
  cost. Given the five divergent budget totals documented above, a single test
  asserting `sum(CMoney.budgetByAcct) === SBBudgetSheet.sheetTotals().grand`
  for a sheet using the calculator would have caught every one of them. Note
  that `scripts/test_ops.mjs:19-21` uses a fixture of bare `{est: N}` items, so
  the entire class of bug is invisible to the current 44/44 suite — which does
  pass, cleanly, today.

---

## Evidence

Files read in full: `docs/audit/BRIEF.md`, `producer/budget-sheet.js` (418 L),
`producer/incentives.js` (106 L), `producer/index.html` (307 L),
`finance/lib-money.js` (150 L), `finance/index.html` (188 L),
`taxcredit/lib-taxcred.js` (171 L), `tools/tools-money-ui.js` (208 L),
`js/learn.js:51-95`, `tools/lib-money.js:15-145`.

Read in part: `js/budget-engine.js:1-780` (rate tables, `analyze`,
`estimateAI`, `estimateProduction`, formatting), `timeline/timeline-budget.js`
(structural diff against `js/budget-engine.js`; lines 645-738 read directly),
`producer/schedule-board.js:110-190`, `contracts/lib-deal.js:1-70`,
`production/lib-prod.js:1-110`, `investors/lib-invest.js:204-220`,
`workflow/advisor-ui.js:20-60`, `workflow/workflow.js:195-240`,
`taxcredit/index.html:1-125`, `scripts/test_ops.mjs:1-52`,
`scripts/test_producer_suite.mjs` (check list),
`docs/PRODUCTION_PRICING.md` §§2.1–2.6, 2.10–2.14 and Sources.

Claims verified by executing the shipped modules under Node (no files
modified):

1. `SBBudgetSheet.catTotals` on a single `{amt:6, units:20, rate:700}` line
   returns 84,000; `CMoney.budgetByAcct` on the same sheet returns 0;
   `CMoney.costReport` reports `variance: -84000, over: true`.
2. A sheet with subtotal 1,000,000 and `fringesPct 28 / bondPct 2.5 /
   insurancePct 2.5 / contingencyPct 10` gives `sheetTotals.grand = 1,463,000`
   while `CMoney.budgetByAcct` totals 1,000,000.
3. `SBBudgetSheet.sheetToCsv` on that sheet emits SUBTOTAL 1,000,000,
   Contingency 133,000, GRAND TOTAL 1,463,000 — no fringe, bond or insurance
   rows.
4. `SBBudgetSheet.seedFromEstimate` from a 40-scene synthetic script routes
   `Payroll fringes (40%)` into account 18000, and flags 13 of 18 accounts
   outside their NORMS bands.
5. `CTaxCred.creditModel` for New York on 1,000,000 of spend explicitly tagged
   qualified returns `estCredit 165,000` (= 1,000,000 × 0.55 × 0.30), not
   300,000.
6. `CTaxCred.creditModel` for Georgia with a 6,000,000 budget and 100,000
   posted returns `belowMin: true, estCredit: 0`.
7. `node scripts/run_all_tests.mjs` → **44/44 suites passed** at the time of
   this audit. Nothing in this report is a failing test; all of it passes.

Not verified, not claimed: I did not open the live site, did not check any
rate against its cited source, and did not read `producer/sales-forecast.js`
or the distribution-side waterfall beyond confirming
`investors/lib-invest.js:207-213` shares the `it.est` bug.
