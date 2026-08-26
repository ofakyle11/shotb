# Team A Dev 13 — missing: accounting, payroll, incentives and reporting

Domain: money. Everything below was verified by reading the code; every
"missing" claim names where I looked. Baseline confirmed green:
`node scripts/run_all_tests.mjs` → **44/44 suites passed**.

---

## What exists and works

- `finance/lib-money.js:63-98` — `costReport()` is the real studio model, done
  right: open PO = committed, invoiced/paid = actual, void drops out
  (`:75-80`), petty cash is actual (`:81`), ETC defaults to money-left-in-plan
  with a per-account override (`:86-88`), EFC = actual + committed + ETC,
  variance = budget − EFC. Unbudgeted accounts are surfaced as
  `Unbudgeted · <acct>` (`:68`) rather than silently dropped. This is correct.
- `finance/lib-money.js:109-129` — `csvCell()` prefixes `= + - @ \t \r` exactly
  as the brief requires, and `scripts/test_csv_injection.mjs:73` covers it.
- `investors/lib-invest.js:99-166` — the waterfall is genuinely good. Correct
  tier order (fee/expenses → debt → gap → equity → 50/50 split), pro-rata
  shortfall *inside* a tier (`:117-125`), and `allocate()` (`:78-92`) drops the
  rounding residue on the largest weight so every run reconciles to the cent
  (`:163-164`). 66 tests pass.
- `investors/lib-invest.js:172-179` — breakeven solved algebraically, no
  iteration. Clean.
- `producer/budget-sheet.js:59-81` — Amt×Units×Rate with manual fallback;
  fringes on labor accounts only (`LABOR_ACCTS`, `:87`), bond and insurance on
  the direct subtotal, contingency on the whole basis. That is the right order
  of operations, and all four percentages default to 0 so a sheet that already
  carries fringe line items never double-counts (`:85-86`). Careful work.
- `producer/budget-sheet.js:104-119` — `norms()`, per-account % bands framed as
  "a question the bond company will ask" rather than an error. Good judgement.
- `taxcredit/lib-taxcred.js` — the honesty is the feature. Every figure is
  labeled an estimate, explicit human tags always beat the heuristic
  (`:91-95`), and untagged rows are visibly stamped `guess` in the UI
  (`taxcredit/index.html:161-162`).
- `tools/lib-money.js:47-111` — the timecard OT model is right and rare:
  1.5× on *worked* hours but 2×/3× on *elapsed* hours (the 12-hour-day
  convention, `:59-62`), escalating meal penalties (`:78-90`), turnaround
  invasion priced at rate × hours invaded (`:93-100`), 6th/7th-day multipliers,
  fringes applied last. Fully parameterized via `TC_DEFAULTS`.

---

## What exists but needs work

- **HIGH — `contracts/lib-deal.js:14-16`: every signed deal memo posts to the
  wrong budget account.** `DEPT_ACCT` maps camera, sound, art, wardrobe, hmu,
  grip, electric, stunts, locations and production **all to `3000`**, cast to
  `2000`, and edit/post/music to `5000`. Against the top-sheet chart
  (`producer/budget-sheet.js:14-33`) `3000` is *Direction*, `2000` is
  *Producers Unit*, `5000` is *Production Staff*. `contracts/index.html:150-155`
  wires this live: signing a deal calls `toCommitment()` → `CMoney.addPO()` →
  writes `SB_Money_v1`. Result on a real show: Direction reads catastrophically
  over budget while Camera, G&E, Art and Wardrobe read as untouched, and the
  producer chases a phantom. Fix: map departments through a shared chart
  (see "Missing #2") — camera→6000, sound→7000, g&e/grip/electric→8000,
  art/stunts→9000, wardrobe→10000, hmu→11000, locations→13000,
  production→5000, edit/post/music→15000, cast→4000.
- **HIGH — `casting/index.html:346`: cast offers commit to account `'1400'`,
  which exists in no chart of accounts in the repo.** Not in
  `producer/budget-sheet.js:14-33`, not in `js/budget-engine.js:621-723`. Every
  cast offer therefore lands in `finance/lib-money.js:68`'s
  `Unbudgeted · 1400` bucket and never appears against the 4000 Cast budget —
  typically the largest single account on the sheet. Should be `4000`.
- **HIGH — `finance/lib-money.js:132-142` + `finance/index.html:144`:
  mid-shoot partial actuals poison the estimator.** `feedLearning()` runs on
  *every* render (every PO add, status flip, ETC edit, delete). It synthesizes
  `{desc:'cost report actuals', est: budget, actual: actual}`, and
  `js/learn.js:62-65` fingerprints on `acct|desc|est|actual` — so each
  incremental change in `actual` is a *new* fingerprint and gets learned again.
  Early in a shoot `actual/est` is small; `js/learn.js:66` clamps it to 0.25 and
  `:68` EMAs toward it, and `calibration()` (`:77-81`) then applies a multiplier
  as low as 0.5× to the *next* film's seeded budget (`producer/budget-sheet.js:161-165`).
  The estimator learns "everything costs half" from a show that simply is not
  finished yet. Fix: only feed accounts where the report is closed — gate on a
  taken snapshot or an explicit "post to learning" action, not on render.
- **MED — nine pages read-modify-write the whole `SB_Money_v1` blob.**
  `post/index.html:244-248`, `locations/index.html:265-268`,
  `vfx/index.html:246-249`, `music/index.html:129-136`,
  `casting/index.html:344-347`, `wardrobe/index.html:313-316`,
  `safety/index.html:204-209` and `:256-259`, `contracts/index.html:151-155`
  each do `JSON.parse(getItem)` → mutate → `setItem` of the entire object. With
  the Money Room open in a second tab, one blob silently overwrites the other,
  and because `addPO` increments `m.nextPo` in whichever copy the writer loaded
  (`finance/lib-money.js:26`), two tabs mint **duplicate PO numbers**. Fix: a
  tiny `CMoney.mutate(fn)` helper that re-reads immediately before writing, plus
  a `storage` event listener in `finance/index.html` to re-render.
- **MED — `safety/index.html:208`** posts police paid duty to `3000`
  (Direction). Belongs on 13000 Locations or 18000 General.
- **MED — `finance/index.html:109`** falls back to
  `['1100','2000','3000','5000']` when no budget sheet exists. `1100` is in no
  chart; a PO issued before the sheet is built is unbudgeted forever.
- **LOW — `CMoney.removeRow` (`finance/lib-money.js:45-50`)** hard-deletes.
  A `void` status already exists and expresses the same intent reversibly.

---

## What is missing entirely

### 1 · Payroll ledger — timecards never reach the cost report — **CRITICAL**

**Where I looked.** `costReport()` (`finance/lib-money.js:63-98`) iterates
`m.pos` and `m.petty` and nothing else. `TMoney.timecard`
(`tools/lib-money.js:47-111`) is a single-crew-member, single-day calculator.
Its UI (`tools/tools-money-ui.js:71-91`) saves to `SB_Timecards_v1` with fields
`date, name, call, wrap, hours, total, notes` — **no account code, no
department**. I grepped every reader of `SB_Timecards_v1` in the repo: only
`production/production.js:221`, which feeds `CProd.dpr` (`production/lib-prod.js:24,41`)
to print a *count* of cards on the daily report. Nothing posts money.

**Why a production cares.** Labor is 50–70% of a live-action budget. The Money
Room prints an Estimated Final Cost and a variance while structurally blind to
the largest cost on the picture. Deal memos capture the *contracted* figure
(rate × guaranteed days, `contracts/lib-deal.js:54-57`), but the overage — OT,
meal penalties, forced calls, 6th/7th day — is exactly where a shoot day blows
up, and none of it posts anywhere. A UPM cannot answer "are we over?" from this
platform today.

**Build sketch.** Attaches to `finance/`. New pure lib `finance/lib-payroll.js`
(`CPayroll`), reusing `TMoney.timecard` verbatim for per-card math.
Key `SB_Payroll_v1`:

```
{ v:1, weeks:[ { id, ending:'YYYY-MM-DD', status:'open|approved|posted',
    cards:[ { id, crewId, name, acct, dept, date, call, wrap, meals,
              firstMealAtHr, dow, prevWrap, rate, gross, penalties,
              fringes, total, loanOut:bool, resident:bool } ] } ] }
```

`CPayroll.post(week)` writes actual rows into `SB_Money_v1` under a third row
family (`m.payroll[]`), and `costReport` gains one loop beside
`finance/lib-money.js:81`. `SB_Crew_v1` gains `acct` (derived from `dept` via
the shared chart below). No existing key or field is renamed.

**Size.** Medium — ~250 lines of lib, one page section, one `scripts/test_payroll.mjs`.
**Value.** Highest in this report. Until it lands, every EFC number is wrong by
the size of the crew.

### 2 · A shared chart of accounts — **HIGH**

**Where I looked.** There are three charts and no source of truth.
`js/budget-engine.js:621-723` (mirrored in `timeline/timeline-budget.js:636-705`)
has ~28 accounts including 4100/4200/4400/4500, 8500, 9900, 13500,
15200/15400/15600/15800, 16500/16800. `producer/budget-sheet.js:14-33` has 18,
and `SEED_MAP` (`:36`) collapses the first into the second. Every module that
writes a PO then hardcodes a string literal — and gets it right about half the
time: post `15000`, vfx `15000`, music `15000`, locations `13000`, wardrobe
`10000` are correct; casting `1400`, contracts `2000/3000/5000`, safety `3000`,
the Money Room fallback `1100` are not. Half-right is worse than uniformly
wrong, because the report still looks plausible.

**Build sketch.** New `js/coa.js` (`CCoa`), a pure constant plus helpers — no
storage key needed:

```
CCoa.ACCOUNTS  // [{ code, name, parent, labor:bool, phase:[prep,shoot,post] }]
CCoa.roll(code)      // '4100' → '4000'
CCoa.forDept(dept)   // 'camera' → '6000'
CCoa.normalize(code) // legacy '1400' → '4000', '1100' → '1000' (read-time only)
```

Then a one-line edit at each of the ~9 `addPO` call sites and in
`contracts/lib-deal.js:14-16`. Critically: **never renumber a stored account** —
live owners have rows under `1400`; `normalize()` maps at read time so old data
lands on the right line without being rewritten.

**Size.** Small — ~120-line lib, nine one-line edits, one test suite.
**Value.** HIGH. It is what makes the cost report *true*, and it is the cheapest
high-value item here.

### 3 · Purchase-order approval chain — **HIGH**

**Where I looked.** Grepped `approv` across `finance/ producer/ taxcredit/
investors/ tools/ contracts/ production/ workflow/ js/`. The only hits are
unrelated (clip approval in `workflow/workflow.js:129-140`, one prose line in
`taxcredit/lib-taxcred.js:142`). `CMoney.addPO` (`finance/lib-money.js:23-32`)
stamps `status:'open'` at creation — no requester, no approver, no threshold —
and `setPoStatus` (`:33-38`) lets anything move straight to `paid`.

**Why a production cares.** A bonded picture, a tax-credit audit and any
investor agreement all require documented spend authority. Today a PA can
commit $200,000 and nothing records who authorised it.

**Build sketch.** Attaches to `finance/`, additive to `SB_Money_v1`. PO records
gain `{ requestedBy, approvals:[{who, role, at, decision}] }`; the ladder lives
alongside as `m.policy = { levels:[{upTo:5000, role:'coordinator'},
{upTo:50000, role:'upm'}, {upTo:null, role:'producer'}] }`. Add a `pending`
status ahead of `open` so unapproved money is neither counted as committed nor
invisible, and gate `setPoStatus('open')` on the ladder being satisfied.
Identity is already available via `SB_OWNER_NAME` (`js/cinamate-auth.js`).

**Size.** Small–medium; no key renames, old POs read as pre-approved.
**Value.** HIGH.

### 4 · Multi-currency and VAT/GST — **HIGH**

**Where I looked.** Grepped `currency`, `exchange`, `\bfx\b`, `USD`, `EUR`,
`GBP`, `VAT`, `GST`, `sales tax` across every money module and `app.html`.
Zero real hits — the `app.html` "currency" matches are the word *concurrency*
(`app.html:2554,2610,6086,6332`). Every formatter hardcodes a dollar sign:
`finance/index.html:99`, `taxcredit/index.html:105`,
`investors/lib-invest.js:16-22`, `contracts/lib-deal.js:69`.

**Why a production cares — concretely.** `taxcredit/lib-taxcred.js:20-42` ships
**fourteen non-US jurisdictions**: UK AVEC and IFTC, Ireland S481, Hungary,
Czech, Australia, NZ, BC, Ontario, Iceland, Malta, Italy, Greece, Germany,
Spain. Those claims are denominated in GBP, EUR, AUD, NZD, CAD, HUF, CZK.
`creditModel()` (`:104-131`) multiplies whatever numbers sit in the ledger by a
rate band, and the page prints the result with a `$`. The platform is already
promising international work it cannot denominate. VAT is worse: in the UK, EU,
Canada, Australia and NZ a production pays VAT/GST on nearly every invoice and
reclaims it — so gross-of-VAT POs overstate cost by up to 25%, and VAT is
almost never qualified spend for an incentive claim.

**Build sketch.** `SB_Money_v1` gains `m.currency` (base, default `'USD'`) and
each row gains `{ ccy, fxRate, fxDate, net, taxCode, taxAmount, taxRecoverable }`.
Rows without `ccy` read as base, so existing owner data is untouched. New
`finance/lib-fx.js` over `SB_Fx_v1 = { base:'USD', rates:{ GBP:{rate, asOf, note} } }`
— rates are **user-entered from their own bank or accountant, never fetched and
never invented**, per the brief. `costReport` totals in base while the ledger
keeps the transaction currency, so a UK claim can still file in GBP.
`CTaxCred.creditModel` excludes `taxAmount` from `qualifiedSpend`.

**Size.** Medium–large; touches every money formatter but is entirely additive.
**Value.** HIGH the moment anyone shoots outside the US — and 70% of the
platform's own incentive table is non-US.

### 5 · A weekly cost report that is actually weekly — **HIGH**

**Where I looked.** `CMoney.snapshot` (`finance/lib-money.js:101-107`) stores
`{ week, date, totals }` — **totals only, no per-account rows**. So "which
account moved this week, and why" — the entire purpose of a weekly cost report —
is unanswerable, and the UI can only echo the last EFC
(`finance/index.html:129-131`). Separately, `costReport` never reads `po.date`
or `p.date` (`:75-81`): it is cumulative-to-date with no period filter, so
"this week's spend" does not exist as a concept.

**And there are two unconnected cost ledgers.** `TMoney.hotCost`
(`tools/lib-money.js:116-138`) over `SB_HotCost_v1`
(`tools/tools-money-ui.js:117-128`) computes actual/committed/variance/pctUsed
per account against the same `SB_BudgetSheet_v1` — a second implementation of
the same report over a different store. Nothing reconciles them, and
`CTaxCred.rowsFromMoney` (`taxcredit/lib-taxcred.js:73-88`) reads only
`SB_Money_v1`, so anything logged in the Tools hot-cost register is invisible to
both the Money Room and the tax credit.

**Build sketch.** Attaches to `finance/`. (a) `snapshot()` also stores a trimmed
row array; (b) new `CMoney.weekOverWeek(a, b)` returning per-account deltas and
top movers; (c) `costReport(sheet, m, {from, to})` for a true period report.
Then converge the ledgers: keep `SB_HotCost_v1` readable (live owners have rows
in it) but have `TMoney.hotCost` read `SB_Money_v1` too and dedupe, or retire the
Tools tab in favour of the Money Room. Retention already exists at `:105`.

**Size.** Small for snapshots and deltas; medium for the ledger merge.
**Value.** HIGH — without it the "weekly cost report" is a running total.

### 6 · Cash-flow forecast against the shooting calendar — **MED-HIGH**

**Where I looked.** `producer/budget-sheet.js:121-140` `cashflow()` splits the
grand total into exactly three buckets — prep / shoot / post — via a fixed
per-account phase table (`PHASE`, `:122-127`). That cannot tell a producer what
must be in the bank on a given Friday. The calendar data already exists and no
money module touches it: `SB_ShootPlan_v1` (`tools/sched-weather.js:11,34-43`)
holds a real start date and a skip-weekends day walker, and
`SB_ScheduleBoard_v1` holds scenes on day indices
(`producer/schedule-board.js:12,116-141`). I grepped every reader of
`SB_ShootPlan_v1`: `production/production.js:224`, `workflow/workflow.js:206`,
`workflow/advisor-ui.js:55`, `tools/sched-weather.js` — no money module.

Financing has the mirror gap: `CInvest.capTable`
(`investors/lib-invest.js:64-75`) sums `raised` from `SB_Investors_v1` with no
distinction between money *committed* and money *wired*. There is no drawdown
schedule anywhere (grepped `capital call`, `drawdown`, `sources and uses`,
`financing plan` — nothing).

**Build sketch.** New `producer/lib-cashflow.js`: walk `SB_ShootPlan_v1` into
calendar weeks, spread each account across them by phase weight, overlay
`SB_Money_v1` PO dates + vendor payment terms (Missing #9) and payroll weeks
(Missing #1), and emit a weekly cash-required curve against draws stored as
`SB_Funding_v1 = { draws:[{ id, source, amount, expected, received }] }`.

**Size.** Medium.
**Value.** MED-HIGH — this is the number that decides whether a production stops.

### 7 · Tax-credit application package, and labor in the qualified base — **HIGH**

**Where I looked.** `taxcredit/index.html` has **no export at all** — I grepped
`csv`, `download`, `export`, `print`: zero hits, versus `finance/index.html:52,174-179`
which does export. `CTaxCred.checklist` (`lib-taxcred.js:138-163`) is generic
prose with tick boxes; there is no schedule of qualified spend an auditor could
accept. And `rowsFromMoney` (`:73-88`) builds the qualified base from POs and
petty cash only — **labor never enters it**. For the labor-only programs in the
platform's own table — BC PSTC 36% (`:34`), Ontario OFTTC 35% (`:35`) — and for
New York, which is BTL-only (`:24`), the modeled credit is near zero because the
one category that qualifies is the one the ledger cannot see.

There is a second, cheaper gap in the same place: `checklist` item `residency`
(`:149-150`) instructs the user to "collect residency documentation for cast and
crew", but `SB_Crew_v1` (`tools/tools-registers.js:31-38`) carries
name/role/dept/union/rate/phone/email/dietary/emergency — **no residency, no
jurisdiction, no loan-out vs employee flag**. The platform asks for the single
field that decides a labor credit and gives you nowhere to put it.

**Build sketch.** Attaches to `taxcredit/`. Add `residency` and `loanOut` to the
`SB_Crew_v1` register fields (additive; existing rows read blank). Teach
`rowsFromMoney` to include payroll rows carrying a `resident` flag. Add
`CTaxCred.package(juris, tags, money, meta)` returning a CSV schedule — vendor,
date, ref, account, description, jurisdiction, resident, amount, qualified Y/N,
reason — plus a cover summary, all cells through the existing `csvCell` guard.

**Size.** Small–medium once Missing #1 lands.
**Value.** HIGH — the difference between a modeled number and a filed claim.

### 8 · Audit trail on money records — **MED-HIGH**

**Where I looked.** `CMoney.blank()` (`finance/lib-money.js:17`) is
`{v, pos, petty, etc, snapshots, nextPo}` — no log. `removeRow` (`:45-50`) hard
deletes, wired to a single `confirm()` (`finance/index.html:166-169`).
`setPoStatus` (`:33-38`) flips open→paid with no record of who or when. ETC
overrides (`:86-88`, `finance/index.html:164`) silently move EFC with no note.
Grepped `audit trail` / `auditTrail` repo-wide: zero.

**Why a production cares.** A bond company, a tax-credit auditor and an investor
all ask the same question — "show me the history of this line." Today the answer
is a mutable blob in one browser.

**Build sketch.** Append-only `m.log = [{ at, who, action, target, before, after }]`
on `SB_Money_v1`, capped the way `snapshots` already is (`:105`). Route
`addPO` / `setPoStatus` / `addPetty` / `removeRow` / ETC edits through one
`record()` helper; make `removeRow` set `status:'void'` rather than splice.
`who` from `SB_OWNER_NAME`.

**Size.** Small.
**Value.** MED-HIGH.

### 9 · Vendor master, payment terms, and the petty-cash float — **MED**

**Where I looked.** Vendor is a free-text string on each PO
(`finance/lib-money.js:26`) — no dedupe, no tax ID on file, no payment terms,
no remit-to. Grepped `1099` and `W-9`: no hits outside a CSS media query
(`index.html:508`). Petty cash (`:39-44`) is `{who, desc, acct, amount, date}` —
a flat receipt log with no float issued, no float-vs-receipts reconciliation and
no per-person balance. Per diem exists **only** as a deal-memo field
(`contracts/lib-deal.js:27,32,56,83`) folded into the commitment total; there is
no per-diem disbursement record, and `CTaxCred`'s exempt regex
(`taxcredit/lib-taxcred.js:62`) already assumes per diem is a thing being spent.

**Build sketch.** `SB_Vendors_v1 = { vendors:[{ id, name, taxIdOnFile:bool,
terms:'net30', currency, remitNotes }] }` — store only a *flag* that the tax ID
is on file, never the number itself, per the brief's no-secrets rule. PO gains
`vendorId`. Petty rows gain `floatId` over
`SB_Floats_v1 = { floats:[{ id, who, issued, returned, acct }] }`, so the Money
Room can show who is holding cash and has not reconciled.

**Size.** Small–medium.
**Value.** MED — bites from the first week of prep, but nothing is *wrong* today.

### 10 · Completion bond reporting — **MED**

**Where I looked.** Bond exists only as a percentage cost line:
`sheetTotals` (`producer/budget-sheet.js:74-79`), the `bsBond` input
(`:229`), and estimator account `16800` (`js/budget-engine.js:720`). There is no
bond deliverable of any kind — no cost report to the bond company, no
contingency-exhaustion watch, no cure notice.

**Build sketch.** Attaches to `finance/`, and it is mostly presentation once
Missing #5 exists: the weekly cost report plus a cover carrying budget, EFC,
variance, cause of variance, contingency remaining, and a strike-price line
(contingency exhausted → the bond company can take over the picture). Reuse
`CMoney.csv` for the schedule plus a print stylesheet, as
`producer/budget-sheet.js:387-388` already does for the top sheet.

**Size.** Small, after #5.
**Value.** MED generally; HIGH for any bonded picture — which is any picture
with real financing.

---

## Evidence

Files read in full: `finance/lib-money.js`, `finance/index.html`,
`producer/budget-sheet.js`, `producer/incentives.js`, `taxcredit/lib-taxcred.js`,
`investors/lib-invest.js`, `tools/lib-money.js`, `tools/tools-money-ui.js`,
`production/lib-prod.js`.

Files read in part: `contracts/lib-deal.js:1-80,101-109`,
`taxcredit/index.html:55-184`, `investors/index.html:60-122,243,261-262`,
`tools/tools-registers.js:20-75,100`, `tools/sched-weather.js:1-60`,
`producer/schedule-board.js` (structure), `producer/index.html:32-105`,
`js/learn.js:55-81`, `js/budget-engine.js:621-723`,
`timeline/timeline-budget.js:636-705`, `post/index.html:100,244-250`,
`locations/index.html:265-268`, `vfx/index.html:246-249`,
`music/index.html:129-136`, `casting/index.html:344-347`,
`wardrobe/index.html:313-316`, `safety/index.html:204-209,256-259`,
`contracts/index.html:103,150-155`, `scripts/test_ops.mjs:13-41`,
`scripts/test_post.mjs:111-123`, `scripts/test_csv_injection.mjs:66-73`.

Searches run before claiming anything missing (repo-wide unless noted, excluding
`node_modules/`, `.git/`, `static/vendor/`): `per diem`, `perdiem`, `timecard`,
`timesheet`, `payroll`, `hot cost`/`hotcost`, `approv*` (scoped to the nine money
modules), `currency`, `exchange rate`, `fx`, `USD`/`EUR`/`GBP`, `VAT`, `GST`,
`sales tax`, `audit trail`/`auditTrail`, `petty`, `cash flow`/`cashflow`,
`cost to complete`/`costToComplete`, `bond`, `residual`, `invoice`, `1099`,
`W-9`, `vendor`, `bank account`, `cash position`, `reconcil*`, `capital call`,
`drawdown`, `sources and uses`, `financing plan`, plus every `SB_*` key in the
repo and every reader of `SB_Money_v1`, `SB_HotCost_v1`, `SB_Timecards_v1`,
`SB_ShootPlan_v1`, `SB_TaxLedger_v1`, `SB_Crew_v1`.

Test baseline verified by running `node scripts/run_all_tests.mjs` →
`44/44 suites passed`. No file in the repo was modified.
