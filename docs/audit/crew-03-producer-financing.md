# Producer / Executive Producer — financing, cap stack, waterfall, chain of title

Judged as the person raising the money and carrying the picture. The question
throughout: could I run a real round out of this, and would an investor, a bank
or a bond company accept what comes out of it?

**Short answer.** The waterfall engine itself is better than most commercial
tools — it is cent-exact, closed-form on breakeven, and honest about being a
simulation. Everything *around* it is missing: there is no record of money
actually received or actually paid, no funded-vs-committed on an investor, no
link between what has been raised and what the budget needs, and three
incompatible waterfall engines that speak three different revenue vocabularies.
You can model a deal here. You cannot **run** one.

---

## What exists and works

- `investors/lib-invest.js:99-166` — the recoupment waterfall is real and
  correctly ordered: off-the-top (sales fee, then expenses) → debt principal +
  interest → gap → equity principal + premium → 50/50 profit split. Shortfalls
  inside a tier pay pro-rata by amount owed (`:121-123`). This is the standard
  indie order, run correctly.
- `investors/lib-invest.js:79-92` — `allocate()` splits a pool across weights to
  the cent and lands the rounding residue on the largest weight, so
  distributions reconcile exactly (`:164` `distributed`). Proved by
  `scripts/test_investors.mjs:69-72` and again under over-claimed backend at
  `:109`. Most spreadsheets a producer builds do not reconcile; this does.
- `investors/lib-invest.js:172-179` — breakeven solved directly
  (`gross = (owed + E) / (1 − f)`), not iterated, and
  `scripts/test_investors.mjs:116-121` verifies it by feeding the answer back
  through the waterfall and checking every tier lands exactly paid. That is the
  right way to test a financial model.
- `investors/lib-invest.js:141` — explicit backend percentages that sum over
  100% are scaled down; under 100% leaves an explicit `undistributed` remainder
  rather than silently inventing money. Correct behaviour on a genuinely
  ambiguous term sheet.
- `investors/lib-invest.js:198-203` — the statement carries a plain-language
  "modeled by the simulator … an estimate, not an audited accounting … verify
  against the executed financing agreements and collection-account statements"
  legend. Given what the tool actually is, this is exactly right and it should
  not be softened.
- `investors/index.html:238-263` + `lib-invest.js:219-267` — the quarterly
  update letter pulls the budget grand total and the Money Room EFC live, states
  which browser data it used (`index.html:248-250`), and when it has nothing it
  says so rather than inventing a figure.
- `finance/lib-money.js:63-98` — the cost report is the studio-accounting
  article: Budget / Actual / Committed / ETC / EFC / Variance per account, ETC
  defaulting to "spend the plan, no more" (`:88`), unbudgeted accounts surfaced
  as their own rows (`:68`). `:101-107` takes an immutable weekly snapshot
  capped at 52 weeks. `:110-118` prefixes CSV formula characters.
- `contracts/lib-deal.js:58-66` + `contracts/index.html:~158-166` — signing a
  deal memo auto-issues an open PO on the routed account in the Money Room, so
  payroll obligations enter the Committed column the moment ink lands. This is
  the single best cross-module link in the financing stack and it works.
- `producer/budget-sheet.js:69-81` — `sheetTotals()` computes fringes on labor
  accounts only, bond and insurance on the direct subtotal, and contingency on a
  basis that *includes* fringes/bond/insurance. That ordering is correct and is
  the thing amateur budgets get wrong.
- `producer/budget-sheet.js:104-118` — per-account NORMS bands with the framing
  "outside the band isn't wrong, it's a question the bond company will ask".
  That is precisely how a bond application reads.
- `producer/sales-forecast.js:24-30` + `docs/SALES_FORECAST.md` — quantile bands
  rather than a single number, with sourced calibration, an explicit failure
  rate (15.5%), and a "Known limitations" section
  (`SALES_FORECAST.md:101-114`) that names its own weaknesses including the
  streaming-era gap. `sales-forecast.js:138-151` is a territory take/ask sheet a
  real sales agent would recognise, and it is deliberately sober.
- `taxcredit/lib-taxcred.js:20-41,104-136` — 20 jurisdictions with rate bands and
  qualifying-spend fractions, modelled against actual Money Room spend rather
  than only against a budget number.
- `production/lib-prod.js:120-140` — a guild residuals estimator at published
  convention rates, with the home-video 20% royalty base handled correctly.
- `tools/tools-registers.js:124-150` — the Rights & Chain of Title register
  captures agreement type, counterparty, territory, media, term start, term
  end/reversion, fee and status, and flags "N not yet executed — chain gap".
  The data model is right.
- `projects/lib-vault.js:15,23-24` — `SB_Investors_v1` matches `KEY_RE` and is
  not in `LOCAL_ONLY`, so the cap table travels with the project slot and inside
  a `.cinamate` archive, while credentials do not. Correct.

---

## What exists but needs work

### HIGH

- **`finance/lib-money.js:53-61` and `investors/lib-invest.js:207-213` — the
  budget reads $0 for any top sheet built with the Amt × Units × Rate
  calculator.** Both functions sum `it.est` only. `producer/budget-sheet.js:62-66
  itemEst()` returns `amt × units × rate` when all three are set and leaves
  `est` at its `blankItem()` default of `0` (`:41`). Verified by running the
  three files together: a sheet with two calculator-built lines gives
  `CInvest.budgetTotal → 0`, `budgetByAcct → {4000:0, 6000:0}`, and a cost report
  of `budget 0, actual 52000, variance −52000, over: true`. **Consequences for a
  real production:** every account in the Money Room reads 100% over budget; the
  quarterly investor letter prints "Working budget: not yet locked in the
  budgeting suite" (`lib-invest.js:239`) while a full budget exists; and if any
  `est` *is* filled the letter's "Variance vs budget" (`:243-244`) declares the
  picture OVER budget by the entire spend. That is a wrong number in a document
  sent to investors. `tools/tools-money-ui.js:132-139` already computes this
  correctly — the two engines disagree with each other.
  **Fix:** both call the same item-value function; and `budgetTotal()` should
  return `sheetTotals().grand`, not the bare category sum, so contingency,
  fringes, bond and insurance are in the number an investor is shown. As written
  it understates the budget by roughly 15–25% even on a fully typed sheet.

- **`contracts/index.html:77` and `tools/tools-registers.js:157` both own
  `SB_Deals_v1` with incompatible shapes.** Contracts writes
  `{v:1, deals:[…]}` (`contracts/lib-deal.js:21`); `TCore.Register.persist`
  writes a bare array (`tools/tools-core.js:62`). Verified both directions
  throw: with the register's array in place,
  `contracts/index.html` `render()` dies on `st.deals.forEach` (`Cannot read
  properties of undefined`); with the contracts object in place,
  `tools-registers.js:168-174` `summary()` dies on `rows.filter is not a
  function`. `tools/index.html:112` sets `initialized[name]=true` *before*
  calling the tab, so the Buyers & Investors pane is permanently blank after the
  first failure. Whichever of the two modules a producer touches second is dead
  — and those two modules are the crew paperwork and the investor pipeline, the
  two halves of the job. **Fix:** rename one side's key. Per the brief no
  existing `SB_*` key may be renamed, so the new key must go to the *newer* of
  the two owners with a one-time migration read of the old key.

- **No funded-vs-committed on an investor position.**
  `investors/lib-invest.js:29-40` `normalize()` has a single `amount`. During a
  raise the number a producer looks at every morning is "committed $2.4M, called
  $1.6M, funded $1.35M, $250k outstanding on two subscriptions" — none of that
  can be expressed. The cap table therefore cannot tell you whether you can
  actually make Friday's payroll. **Fix:** add `committed`, `funded`, and a
  `calls: [{date, amount, received}]` array; `capTable()` (`:64-75`) reports
  both raised-committed and raised-funded; the waterfall keeps using funded.

- **Nothing anywhere compares the raise to the budget.** `SB_Investors_v1` is
  read only by `investors/index.html:122` — grepping the tree finds no other
  reader. The workflow advisor reads twelve stores (`workflow/advisor-ui.js:50-56`)
  and the cap table is not among them; `dashboard.html:1413` has a nav link and
  nothing else. So the platform never says "you are $400,000 short of your own
  budget". That is the most important single fact in development and it is
  invisible. **Fix:** one derived figure — `sheetTotals().grand − capTable().raised`
  — surfaced on the dashboard, the workflow advisor, and the top of the Investor
  Room, with the tax credit and pre-sales counted as sources once they exist
  (see *Missing → Sources & Uses*).

- **Interest is not bankable.** `investors/lib-invest.js:52-61` `owed()` applies
  one global `years` (`normOpts:47`, UI field `investors/index.html:78`) to every
  position, simple interest, no compounding option. There is no per-investor
  closing date, no accrual to a specific date, no partial repayment reducing
  principal, no default rate. A lender's counsel will ask for an accrual
  schedule from the drawdown date and this cannot produce one — and the platform
  has no production start date anywhere to accrue against (see *Missing →
  Cash-flow schedule*). **Fix:** per-position `closedOn`, `rateBasis`
  (`simple` | `compound-annual` | `compound-monthly`), an `asOf` date on the
  waterfall, and a payments array so principal amortises.

- **Three waterfalls, three revenue bases, no shared vocabulary.**
  `investors/lib-invest.js:99` takes **gross receipts** and deducts a sales fee.
  `producer/sales-forecast.js:109-131` starts at **worldwide box-office gross**,
  derives lifetime revenue, then deducts distribution fee, P&A, agent, budget and
  a flat 20% financing premium to reach **producer net**.
  `tools/lib-money.js:145` takes **distributable lifetime revenue** and runs
  deferrals → classes → corridors. `tools/tools-money-ui.js:170` tells the user
  to "take the lifetime figure from the Sales tab's waterfall" while the
  Investor Room's box next door is labelled "Gross receipts $"
  (`investors/index.html:74`). A producer moving a number between these screens
  will double-count the distribution fee and P&A and will not be told.
  `sales-forecast.js:121` also subtracts `financeCost = 0.20 * budget`
  regardless of what the actual cap table says. **Fix:** one engine. The
  forecast should produce a receipts figure at a named point in the chain, hand
  it to `CInvest.waterfall()` with the real cap table, and every screen should
  label its units.

- **A distribution window carries no money.** `distribution/lib-dist.js:78-84`:
  territory, channel, window, start, licensee, exclusive. No minimum guarantee,
  no licence fee, no term end, no recoupable-expense cap, no holdback, no
  delivery date, no payment schedule, no rights-reverted flag. So the pre-sales
  Leg 3 forecasts (`sales-forecast.js:156-171`) can never become tracked
  contracts, the gross receipts driving the waterfall have no itemised source,
  and `windowConflicts()` (`:86-94`) can only catch a same-territory /
  same-channel clash — never an overlapping *term*, which is the conflict that
  actually gets a producer sued. **Fix:** extend the window record with
  `mg`, `expenseCap`, `termStart`, `termEnd`, `holdbackDays`, `paymentTerms`,
  and make the conflict check date-aware.

- **`tools/lib-money.js:160-169` over-distributes the back-end pool.** Each
  class's corridor is paid as `pool * corridorPct` with no normalisation, and
  `producerNet` floors at `pool * max(0, 1 - corridorTotal)`. Two classes at 0.6
  each pay out 120% of the pool while the producer shows zero, and nothing
  reconciles — the function returns no total to check against `pool`. Contrast
  `investors/lib-invest.js:141`, which scales explicitly and proves the
  reconciliation in test. **Fix:** scale corridors to at most 1.0 the way
  `CInvest` does, and return a reconciliation figure so a test can assert it.
  Better: delete this engine and route the Tools tab through `CInvest`.

### MED

- **`tools/tools-registers.js:129` `SB_Rights_v1` is read by nothing else.**
  `distribution/lib-dist.js:31` has a "Chain of title package" tick-box that
  never consults the rights register, so a producer can mark chain of title
  delivered with six unexecuted agreements sitting in the register two clicks
  away. `clearance/lib-clear.js:107` computes `eoReady` and it is used only for a
  banner at `clearance/index.html:94`. **Fix:** the `chain` and `eo` deliverables
  should read `SB_Rights_v1` and the clearance summary and refuse to tick while
  gaps are open — the data to do it already exists.

- **Two clearance registers that do not know about each other.**
  `clearance/index.html:79` stores the automated scan under `SB_ClearScan_v1`;
  `production/production.js:312` keeps a manual clearance register under
  `SB_Clearance_v1`. `workflow/advisor-ui.js:54` reads only the latter, so the
  scanner's open high-risk findings never reach mission control. **Fix:** the
  scanner should push accepted findings into `SB_Clearance_v1` as rows rather
  than keeping a parallel truth.

- **Off-the-top has no expense cap and no CAMA fee.**
  `investors/lib-invest.js:100-105` takes a single `expensesOffTop` number.
  In a real sales agency agreement the recoupable market-expense **cap** is the
  most negotiated term on the page ("commission 15%, expenses capped at $75,000"),
  and above it the agent eats the overage. There is also no collection account
  manager fee (typically ~1% off the top, capped), no residuals reserve — the
  estimator at `production/lib-prod.js:130` exists but never reaches the
  waterfall — and no deferments tier, although `tools/lib-money.js:148-152` has
  one. **Fix:** turn `expensesOffTop` into `{amount, cap}`, add a CAMA fee and a
  residuals-reserve line, and lift the deferrals tier from the Tools engine.

- **Producer/investor split is hard-coded 50/50.**
  `investors/lib-invest.js:130-131`. No rolling break, no flip point ("70/30 to
  investors until 1.5×, then 50/50"), which is the standard sweetener on an
  indie equity raise. **Fix:** a `splitTiers: [{untilMultiple, investorPct}]`
  array; the current behaviour is the single-tier default.

- **`producer/budget-sheet.js:128-141` `cashflow()` is three fixed buckets.**
  Prep/shoot/post with hard-coded phase percentages per account and the
  contingency and extras split 50/50 across shoot and post (`:136-137`). That
  answers "roughly when does money leave" but it is not a schedule anyone can
  bank against.

- **`producer/sales-forecast.js:115` — `lifetime = rentals / theta` means a film
  with no theatrical release cannot be modelled at all.** Every revenue figure in
  Leg 2 is derived from a box-office number, so the streaming-first indie — now
  the majority case — falls out of the model, and Leg 3 (pre-sales) never joins
  Leg 2 or the cap table. `docs/SALES_FORECAST.md:104-107` names this limitation
  honestly, which is to its credit, but it is the common case now rather than an
  edge. **Fix:** a flat-licence path that starts from a licence fee rather than
  from gross, and a switch that carries the Leg 3 pre-sale total into the cap
  table as a source.

### LOW

- `investors/index.html:262` — `encodeURIComponent(text).slice(0, 1800)` can cut
  a percent escape in half (`%E2%80` → `%E`) and silently truncates the investor
  letter mid-sentence with no warning to the user. Slice the text first, then
  encode, and tell the user the mail body was shortened.
- `contracts/lib-deal.js:13` — `SAG_SCALE = { day: 1204, week: 4181 }` is a
  hard-coded rate with no effective date. `memoText()` (`:78`) prints "(scale)"
  next to it. Add the schedule's effective date beside the figure so a stale
  number is visible as stale.
- `finance/lib-money.js:89-90` — the cost report rounds EFC and variance to whole
  dollars per row and then sums the rounded rows (`:92`), so the total can differ
  from the exact figure by a few dollars on a large sheet. Harmless for a hot
  cost, wrong for anything an accountant signs. Sum first, round last.

---

## What is missing entirely

- **Cash-flow / draw schedule against the calendar** — HIGH.
  A week-by-week table of what leaves the bank and what comes in, keyed to the
  actual shoot dates. It is the first document a bank, a bond company or a
  gap lender asks for, and the platform has none. The hook already exists:
  `tools/sched-weather.js:11,80` stores Day 1's calendar date in
  `SB_ShootPlan_v1.date` and `addDays()` (`:30-38`) already maps an ordinal
  stripboard day to a calendar date with weekend skipping. Attach to the Producer
  Suite next to the Budget tab, reusing `budget-sheet.js:120-127 PHASE` as the
  seed distribution and letting the producer override per week. Roughly one new
  `lib-cashflow.js` plus a tab; the inputs are all present.

- **Sources & Uses / financing plan** — HIGH.
  `investors/lib-invest.js:24` `KINDS = ['equity','debt','gap']`. There is no
  place for a tax credit (`taxcredit/lib-taxcred.js:104` estimates one, but it is
  a rebate to be modelled, never a source of funds), a pre-sale minimum
  guarantee, a soft-money grant, a deferment, a producer-fee deferral, or a
  co-production contribution. A producer cannot state their cap stack, which
  means they cannot answer the first question any investor asks: "who else is
  in, and where do I sit?" Add the kinds to `KINDS`, give each a recoupment
  position, and render a Sources & Uses page against `sheetTotals().grand`.
  Attach to `investors/`. This plus the gap check above is the highest-value
  work on the list.

- **Collection account (CAMA) and a real receipts/distributions ledger** — HIGH.
  Everything in the Investor Room is driven by one hypothetical
  `gross` slider (`investors/index.html:74-75`). There is no record of a payment
  actually received (date, payer, territory, gross, withholding), and no record
  of a distribution actually made. So "Recouped to date"
  (`lib-invest.js:195`) is always fiction, and the tool can never produce the
  statement an investor is contractually owed each quarter. Add
  `SB_Receipts_v1` (dated receipts by source) and `SB_Distributions_v1` (dated
  payments by investor), have the waterfall run on cumulative actual receipts,
  and keep the slider as an explicitly-labelled projection mode. Attach to
  `investors/`.

- **Recoupment schedule export** — MED-HIGH.
  Once the ledger above exists, the deliverable is a period-by-period schedule:
  opening unrecouped balance, receipts, fees, tier payments, closing balance,
  per investor, as CSV. `lib-invest.js:182-204` produces a prose statement; an
  investor's accountant wants the grid. Small once the ledger exists; reuse the
  CSV-injection guard at `finance/lib-money.js:110-118`.

- **Completion bond tracking** — MED-HIGH.
  The bond appears as a budget line
  (`producer/budget-sheet.js:30`, `js/budget-engine.js:156 BOND_PCT = 0.025`) and
  nothing more. Nothing tracks the relationship the bond creates: the approved
  cash-flow schedule, the strike price, the weekly cost-report delivery
  obligation, over-budget notice thresholds, the contingency the bond requires to
  remain unspent, and the takeover trigger. The Money Room's weekly immutable
  snapshot (`finance/lib-money.js:101-107`) is exactly the artifact a bond wants
  — it simply is not framed as an obligation with a deadline and a recipient.
  Attach to `finance/`: a bond panel that reads the snapshot history, shows
  contingency remaining against the bonded figure, and flags a missed week.

- **Chain-of-title package generator** — MED-HIGH.
  `distribution/lib-dist.js:31` names the deliverable; `production/lib-prod.js:159`
  names it again; nothing produces it. It should assemble from `SB_Rights_v1`
  (agreements, territory, media, term), `SB_Clearance_v1`, `SB_Insurance_v1`
  (E&O certificate), `SB_CueSheet_v1`, `SB_Credits_v1`, plus copyright
  registration and the title report, and refuse to declare itself complete while
  any agreement is not `Executed` or any clearance is open. Attach to
  `clearance/` with a read from the Tools rights register. The registers already
  hold the fields; this is assembly and a gap check, not new data modelling.

- **Greenlight / financing-close gate** — HIGH value, cheap.
  `workflow/advisor.js` recommends jurisdictions and staffing but nothing gates
  the decision to start spending. The gate a producer needs is one screen:
  % of budget closed and funded, chain-of-title gaps, E&O bound
  (`SB_Insurance_v1` already has the record and an expiry chip at
  `tools/tools-registers.js:100-121`), open high-risk clearance findings
  (`clearance/lib-clear.js:104-107`), completion bond issued, cash-flow schedule
  approved. Every input already exists in a store; this is a reader and a
  rule set, attaching to `workflow/`.

- **Securities-offering record-keeping** — MED.
  The update letter (`lib-invest.js:219-267`) is a real communication to real
  investors and the cap table is a real solicitation record, but there is nowhere
  to record a subscription date, a closing date, an accreditation
  representation, or which offering document an investor received. Counsel
  decides what is required; the platform should at minimum hold the fields and
  carry a standing "this is a modeling tool, not an offer to sell securities"
  legend on the cap table the way `lib-invest.js:198-203` already does on the
  statement. Fields plus a legend; small.

- **Residuals reserve in the waterfall** — MED.
  `production/lib-prod.js:130-140` estimates guild residuals correctly but the
  figure never reaches `CInvest.waterfall()`. Residuals are an off-the-top
  obligation on distributor's gross; a waterfall that omits them overstates every
  investor's return. Wire the estimator's output in as an off-the-top line.

---

## Evidence

Files read in full: `docs/audit/BRIEF.md`, `investors/lib-invest.js`,
`investors/index.html`, `finance/lib-money.js`, `finance/index.html` (60-188),
`contracts/lib-deal.js`, `contracts/index.html` (60-240),
`clearance/lib-clear.js`, `distribution/lib-dist.js`, `distribution/index.html`
(85-200), `projects/lib-vault.js`, `docs/SALES_FORECAST.md`,
`producer/sales-forecast.js`, `scripts/test_investors.mjs`,
`tools/tools-registers.js`, `tools/tools-money-ui.js`.

Files read in part: `producer/budget-sheet.js` (1-200, 414),
`tools/lib-money.js` (145-177), `tools/tools-core.js` (10-140),
`tools/index.html` (108-120), `producer/schedule-board.js` (82-231, 463),
`tools/sched-weather.js` (5-90), `taxcredit/lib-taxcred.js` (1-70, 104-170),
`production/lib-prod.js` (118-175), `production/production.js` (300-380),
`workflow/advisor.js` (1-80), `workflow/advisor-ui.js` (40-80),
`producer/incentives.js` (1-30), `dashboard.html` (grep only).

Checks actually run:

- `node scripts/run_all_tests.mjs` → **44/44 suites passed**. Nothing in this
  report is a failing test; every defect below is behaviour no test covers.
- Executed `investors/lib-invest.js` + `finance/lib-money.js` against a top sheet
  whose items use `amt`/`units`/`rate` with `est: 0` (the shape
  `producer/budget-sheet.js:41 blankItem()` creates):
  `CInvest.budgetTotal → 0`; `CMoney.budgetByAcct → {4000:{budget:0}, 6000:{budget:0}}`;
  `CMoney.costReport(...).totals → {budget:0, actual:52000, efc:52000, variance:-52000, over:true}`.
- Executed the `SB_Deals_v1` collision both ways: the contracts page's
  `st.deals.forEach` throws `Cannot read properties of undefined (reading 'forEach')`
  on the Tools register's array; the Tools register's `summary()` throws
  `fromContracts.filter is not a function` on the contracts object.
- Grepped the whole tree (excluding `node_modules`, `static/vendor`) for
  `chain of title`, `collection account`, `CAMA`, `completion bond`, `escrow`,
  `cash flow`, `accredited investor`, `private placement`, `subscription
  agreement`. Only hits: the bond as a budget percentage
  (`timeline/timeline-budget.js:159`, `js/budget-engine.js:156`,
  `producer/budget-sheet.js:30,229,248`), chain of title as a checklist label
  (`production/lib-prod.js:159`, `distribution/lib-dist.js:31`,
  `tools/tools-registers.js:126`), and `cashflow()` at
  `producer/budget-sheet.js:128`. No collection account, no escrow, no
  completion-bond relationship, no securities record-keeping anywhere.
- Grepped for readers of `SB_Investors_v1` / `CInvest`: only
  `investors/index.html` and `investors/lib-invest.js`. Grepped for readers of
  `SB_Rights_v1`: only `tools/tools-registers.js:129`. Grepped for
  `startDate|shootStart|firstDay|calendarStart` across all JS: one hit, in
  `casting/lib-castdesk.js:151` — there is no production start date on the
  platform other than `SB_ShootPlan_v1.date` inside the day planner.
