# Team A Dev 08 — money & rights modules (finance, taxcredit, investors, contracts, clearance, distribution, festivals, screening)

Scope: 8 modules, 1,299 lib lines + 1,660 page lines. All 44/44 suites pass at time
of audit (`node scripts/run_all_tests.mjs`). Every number below was produced by
running the shipped code, not by reading it.

---

## What exists and works

- `investors/lib-invest.js:79-92` — `allocate()` is the only correct money
  primitive in the slice. It splits a pool by weights at 2dp and lands the
  rounding residue on the largest weight, so a split always sums to exactly the
  pool. **This is the pattern the other seven should be built on.**
- `investors/lib-invest.js:99-166` — the waterfall is genuinely sound. I ran
  4,000 randomised cases (1-6 investors, mixed equity/debt/gap, random fee,
  off-the-top expenses, explicit and pro-rata backend): **0 reconciliation
  failures** at 1¢ tolerance (`distributed === net`). Another 4,000 cases fed
  `breakeven()` (`:172-179`) back into `waterfall()`: **worst recoupment
  shortfall $0.00**. The closed-form `gross = (owed + E)/(1 − f)` is right and
  round-trips exactly. Do not touch this.
- `scripts/test_investors.mjs:16,70` — `eq = |a−b| < 0.005 // cent-exact` plus
  "waterfall reconciles to the cent". This is the only cent-level assertion in
  the slice and it is why investors is the only module without rounding bugs.
  It is the template for the rest.
- `finance/lib-money.js:63-98` — the Budget/Actual/Committed/ETC → EFC → Variance
  cost report is the correct studio-accounting shape, with the right rules
  (void POs vanish, open = committed, invoiced/paid = actual, ETC defaults to
  remaining plan, unbudgeted accounts surface as their own row). The *model* is
  right; the arithmetic on top of it is not (below).
- `finance/lib-money.js:114-118` — `csvCell()` correctly prefixes `= + - @` tab
  and CR with `'`, and it *is* applied to the two user-controlled text columns
  (acct, name). Verified covered by `scripts/test_csv_injection.mjs:73`.
- `festivals/lib-fest.js:16,87-90` — the honesty design is genuinely good and
  should be copied, not changed: a standing banner that windows and fees drift,
  prose windows deliberately kept approximate ("roughly Jun–Sep"), and
  `searchLink()` emitting a Google search instead of an invented festival URL.
  This is the right answer to unverifiable third-party data.
- `festivals/lib-fest.js:182-186` — `shiftISO()` is the one correct date helper
  in the slice: it validates the ISO shape, anchors at `T00:00:00Z`, and does
  UTC-safe day arithmetic. It is also the only one. Promote it.
- `clearance/lib-clear.js:46-95` — the clearance scanner is real, distinct work
  with no analogue elsewhere in the platform: scene splitting, 100+ marks, seven
  detector categories, per-scene dedupe, and the standard remedial action
  attached to each finding. ~59 lines of genuinely original logic.
- `contracts/index.html:150-157` — sign→PO is guarded by `!d.committedPo`, so a
  deal cannot double-commit. That guard is correct.

---

## What exists but needs work

### Money arithmetic

**HIGH — `finance/lib-money.js:89-92`: the cost report TOTAL row does not foot,
and the error grows with account count.**
Per-row `efc` and `variance` are `Math.round`ed (`:89-90`), but `budget/actual/
committed/etc` are left as raw floats; line `:92` then sums all six into
`totals`. So `totals.efc` is Σ round(row) while `totals.actual` is a raw sum.
`finance/index.html:99` rounds each total again for display.

Worked, 3 accounts each with $100.50 actual:
```
displayed   Actual $302 · Committed $0 · ETC $0 · EFC $303
            302 + 0 + 0 ≠ 303
```
At production scale — 240 accounts, budget $12,345.67 each, actual $11,111.11:
```
sum of per-row rounded EFC = $2,963,040
round(true EFC)            = $2,962,961      →  $79 of phantom cost
```
This report goes weekly to the studio and the completion bond. An accountant
foots the total row; it will not foot. Fix: keep integer cents internally, round
once at render, and derive `totals` by summing raw then rounding — never by
summing rounded rows. Also note `Math.round` is half-away-from-zero on positives
but half-toward-zero on negatives (`Math.round(2.5)=3`, `Math.round(-2.5)=-2`),
so overruns and underruns round with opposite bias.

**HIGH — `finance/lib-money.js:120-129`: the CSV export ships raw IEEE-754
floats into the accountant's spreadsheet.**
Only `acct` and `name` pass through `csvCell()`; the six numeric columns are
emitted raw. Budget items $1,234.10 + $5,678.20 + $9,012.30 produce:
```
"3000","X",15924.599999999999,0,0,15924.599999999999,15925,0
```
Also `budgetByAcct` (`:57`) accumulates with `t += num(it.est)`: 100 line items
of $0.07 sum to `7.000000000000009`. Fix: round to 2dp at the CSV boundary,
and sum in integer cents upstream.

**HIGH — `taxcredit/lib-taxcred.js:116`: `qualPct` is applied a second time to
spend the user has already tagged as qualified, understating the credit by
25–55% depending on jurisdiction.**
`qualPct` is documented at `:19` as "fraction of a typical budget that
qualifies" — a whole-budget haircut standing in for travel/insurance/bond/legal.
But `rawCredit = qualifiedSpend × qualPct × mid` applies it to spend that
`isQualified()` (`:91-95`) has *already* filtered using the same exemption list
(`EXEMPT_RE`, `:62`). Worked, every row explicitly tagged qualified:
```
Georgia,  $2,000,000 tagged qualified @ 25% mid  → should be $500,000
                                    module says  →           $375,000   (−$125k)
British Columbia (qualPct 0.45) @ 36%           → should be $720,000
                                    module says  →           $324,000   (−$396k)
```
`delta` vs the Advisor model (`:126`) is therefore meaningless for any partly-
spent production. The module already knows which rows were tagged and which were
guessed (`guessedCount`, `:110-112`) — the ~6-line fix is to apply `qualPct`
only to the *guessed* portion of qualified spend and 1.0 to the tagged portion.
Note `scripts/test_taxcredit.mjs:81` currently pins the double discount as the
spec, which is why nobody has caught it; that assertion must change with the fix.

**HIGH — `contracts/lib-deal.js:54-57`: a signed deal commits only the bare
guarantee — no fringes, no overtime — so the Money Room's "committed" column is
systematically 25–35% light.**
`dealValue = rate × guaranteed + kitFee + perDiem × guaranteed`. Missing:
employer payroll taxes, union pension & health, and workers' comp — 20–35% on
top of gross wages on any real show — and any OT provision, despite `otTerms`
being printed in the memo (`:81`). A SAG day player at $1,204 creates a real
obligation near $1,541 before a minute of OT; the cost report commits $1,204.
Across a full cast and crew this is the single largest understatement in the
money chain. Fix: a `fringePct` on the deal (defaulting per union) and an
`otAllowancePct`, both surfaced on the memo and both included in `toCommitment`.

**MED — `contracts/lib-deal.js:56`: per diem is multiplied by `guaranteed`, which
is in `rateBasis` units, not days.**
Worked — gaffer, $4,181/week, guaranteed 2 weeks, $60/day per diem:
```
dealValue = 8,482   →  per diem contributed $120
memo says "Per diem: $60 per working day" (:83) → should be 10 days = $600
```
Undercommitted 5×. Any weekly or flat deal is wrong; only day-rate deals happen
to be right. Fix: carry working days separately from rate units.

**MED — `festivals/lib-fest.js:139-146`: `feesTotal()` sums submission fees with
no currency, while the directory it sits under quotes three.**
`MAJORS` quotes CAD $100–200 for TIFF (`:47`), €50–150 for Berlinale (`:43`),
CAD $60–100 for Hot Docs (`:71`); the tracker input is a bare number
(`festivals/index.html:88`, `placeholder="Fee $"`). A 30-festival campaign mixing
USD/CAD/EUR produces a headline total that is not money in any currency. This is
the cleanest example in the slice of money-as-bare-JS-number. Fix: a currency
field per submission and per-currency subtotals; do not invent FX rates.

**LOW — `investors/lib-invest.js:16-22`: `fmt()` strips `.00` but not `.50`, so a
column reads `$1,234` next to `$1,234.50`.** Cosmetic, but it is the number an
investor reads. Pick 0 or 2 decimals per column and hold it.

### Rounding, drift and the record

**HIGH — `finance/lib-money.js:101-107`: weekly snapshots are described as "the
report of record, immutable once taken" (`:100`) but are silently truncated and
then given colliding week numbers.**
`:105` slices to the last 52 once 60 are stored, while `:102` derives
`week` from `snapshots.length + 1`. Run 70 weekly snapshots:
```
stored weeks: 19,20,…,60,61,53,54,55,56,57,58,59,60,61
duplicated:   53×2 54×2 55×2 56×2 57×2 58×2 59×2 60×2 61×2
weeks 1–18 silently discarded
```
A long shoot or a TV season corrupts its own cost history, and the UI
(`finance/index.html:129-131`) reads "last snapshot: week N" off that array.
Fix: store an immutable monotonic `week` on the record, never derive it from
array length, and never drop history — archive instead.

### Date handling

**HIGH — `distribution/lib-dist.js:78-94`: rights windows have a start and no
end, so nothing in the platform can compute a reversion date, and the conflict
check is date-blind in both directions.**
`addWindow` stores `territory, channel, window (free text), start, licensee,
exclusive` — no end date, no term length. `windowConflicts()` (`:86-94`) keys
purely on `territory|channel|exclusive`, so:
- **false positive** — two *sequential* exclusive SVOD deals in Canada
  (2027-2029, then 2030-2032) are reported as a conflict. `scripts/test_ops.mjs`
  asserts exactly this shape as correct behaviour.
- **false negative** — an exclusive Worldwide SVOD window overlapping an
  exclusive France SVOD window is *not* flagged, because the territory strings
  differ. That is the conflict that gets a producer sued.

Knowing when rights revert is the reason a distribution module exists. Fix:
`start` + (`end` | `termMonths`), a territory containment table (Worldwide ⊃
Europe ⊃ France), and an interval-overlap test.

**MED — `festivals/index.html:128`: `todayISO()` uses
`new Date().toISOString().slice(0,10)` — the UTC date, not the user's local
date — and feeds it to `upcoming()` (`:163`) and `staleBuyers()` (`:227`).**
For an owner in UTC+13, 9am local on the 15th is still the 14th in UTC, so a
deadline that has already passed locally renders as still open. Compounding it,
`upcoming()` (`festivals/lib-fest.js:158`) compares bare dates, but festival
deadlines are 11:59pm *in the festival's* time zone — Sundance is 11:59pm MT.
A London producer sees "not past" for seven hours after the door shuts. Fix:
build today from local components, and store a deadline time zone per festival
(or at minimum warn that the date is a floating local date, not an instant).

**MED — `festivals/lib-fest.js:20-84`: the directory's vintage lives only in
prose.** `taxcredit/index.html:67` says "2025-26 vintage" and
`taxcredit/lib-taxcred.js:5,18` repeat it in comments — nothing machine-readable.
Today is 2026-08-26; the app cannot tell the user its data is at the edge of its
stated vintage. Fix: one `CURATED_ISO` constant per table plus a computed
staleness banner — ~6 lines, and it applies to `JURIS` and `MAJORS` alike.

**MED — `investors/lib-invest.js:29-40, 53-61`: interest accrues from a single
global `years` in opts, and an investor record has no date field at all.**
`owed()` computes `amount × interestPct/100 × years` with the *same* `years` for
everyone, so a bridge drawn in month 3 and a gap facility drawn in month 30
accrue identically. Real debt accrues per drawdown. Also simple interest only —
most gap/mezz paper compounds. Fix: `fundedOn` per investor, accrual to an
as-of date, and a `compounding` flag.

**MED — `screening/lib-screen.js:68-76`: `parseTc()` silently returns 1 second for
drop-frame and dotted timecode.**
```
"01:02:03;04"  → 1 sec   (drop-frame notation — the standard for 29.97)
"01:02:03.04"  → 1 sec
"1:02:03:04:05"→ 1 sec
```
Anything the two regexes miss falls to `parseFloat`, which happily reads the
leading `1`. A pasted DF timecode puts a note at one second with no error.
Compounding: `newSession` hard-codes `fps: 24` (`:20`) with no way to set 23.976
or 29.97DF, and `addNote` (`:35`) quantises to 0.1s = 2.4 frames at 24fps — I
asked for frame 11 and got frame 12. `toMarkers()` (`:79-84`) pushes these
straight into the Editor. Fix: return `null` on unparseable input, accept `;`,
make `fps` a session field, and store frames not tenths.

**HIGH — `screening/lib-screen.js:17-23`: a session records no identity for the
cut it is annotating.** The module's whole design (`:4-7`) is "no video hosting —
everyone plays the same exported cut locally, only the notes travel." Nothing
records *which* cut. Re-export with four frames trimmed off the head and every
note in every session is silently four frames off. Fix: fingerprint the session
with filename + duration + fps + file size, and warn on mismatch at load.

### Data integrity

**HIGH — `contracts/lib-deal.js:47-51` + `contracts/index.html:146`: signed deals
and their Money Room POs diverge and orphan.**
`removeDeal()` filters `store.deals` only — the PO it created stays in
`SB_Money_v1` forever, inflating committed cost with no link back. And editing
`rate` or `guaranteed` after signature (`contracts/index.html:146`) does not
touch the PO, so the cost report can say $6,020 committed while the memo both
parties hold says $8,428. Fix: on delete, void the PO by `committedPo`; on edit
of a signed deal, either re-issue the PO or block the edit.

**HIGH — `contracts/lib-deal.js:78`: a below-scale SAG rate is printed as
"(scale)".** The condition is `num(f.rate) <= SAG_SCALE[...]`. Worked:
```
Rate: $600 per day  (scale)      ← SAG day scale is $1,204
```
A SAG-AFTRA engagement at half of scale is a violation, and the generated
agreement labels it compliant. `scripts/test_ops.mjs` asserts `(scale)` appears
using a deal at *exactly* scale, so the boundary is untested. Fix: `===` (or a
tolerance) for the label and a loud flag below scale.

**HIGH — `contracts/lib-deal.js:13`: `SAG_SCALE = { day: 1204, week: 4181 }` is a
bare literal with no effective date and no staleness check**, in a module whose
whole job is generating documents people sign. Scale steps up every contract
year. Same class of problem as `JURIS`, and the same ~6-line fix.

**MED — `contracts/lib-deal.js:59-66`: department→account mapping is an
unanchored substring scan where the last match wins.**
`Object.keys(DEPT_ACCT).forEach(... if (dept.indexOf(k) >= 0) acct = ...)`
iterates all 15 keys with no word boundary and no specificity ranking, so
"Casting Director" matches `cast` and books a production-department fee to the
**cast (2000) account**, corrupting the talent line. Separately, ten of the
fifteen keys all map to `'3000'`, so the cost report cannot tell a camera
overrun from a grip overrun. Fix: word-boundary match, longest-match-wins, and
real account splits per department.

**MED — `taxcredit/lib-taxcred.js:117`: `belowMin` is tested against
`totalSpend`, not qualified spend.** Most programs measure the floor against
*qualified* spend. Worked — Georgia, $500k floor:
```
$300,000 airfare (exempt) + $300,000 grip = total $600,000, qualified $300,000
module: belowMin = false → credit $56,250
reality: $300,000 qualified is below the $500,000 floor → $0
```

**MED — `clearance/index.html:118-121`: cleared statuses are carried across a
re-scan by the key `cat|scene|term` — keyed on scene *number*.** Insert one
scene at the top of the script and every downstream scene renumbers, so a
"cleared" mark does not merely get lost, it lands on a *different* finding in a
different scene. For an E&O submission that is worse than no log. Fix: key on a
stable scene identity (slugline hash) or on the term plus surrounding context.

**MED — `taxcredit/lib-taxcred.js:20-42` and `timeline/timeline-budget.js:169`
hold two hand-maintained copies of the same 21-jurisdiction table.**
`scripts/test_taxcredit.mjs:19-24` enforces that they stay verbatim identical by
regex-extracting `INCENTIVES` out of the other file — good discipline, but it
means *applying a single rate change requires editing two source files in
lockstep*, and there is no `sourceUrl` or `verifiedOn` on any of the 21 entries
to check a figure against published terms. Fix: one file owns the table, the
other imports it, and each entry gets the `searchLink()` treatment festivals
already uses.

**MED — `investors/lib-invest.js:141`: promising more than 100% of the backend
is silently renormalised with no flag.** `coverage = shareSum > 100 ? 1 :
shareSum/100`. Worked — two investors each promised 60% (120% total):
```
investorPool $1,525,000 · paid $1,525,000 · undistributed $0
no warning field of any kind in the returned object
```
Over-allocating backend is the classic indie financing mistake and this is
exactly where it should surface. `investors/index.html:207` only shows
*under*-allocation. Fix: return `overAllocatedPct` and banner it.

**MED — `distribution/lib-dist.js:99`: `expires` is written and never read
anywhere in the codebase.** The screener registry records who holds the picture
but can never answer "which of these 14 links are still live eight months on."
That is the registry's main safety purpose. `distribution/index.html:144` does
not even pass the field.

**LOW — `clearance/lib-clear.js:33`: the phone detector's `keep` guard is half
dead code and lets real numbers through.** `m.replace(/\D/g,'')` strips the very
separators `[-. ]?` is looking for, and the trailing `m.indexOf('555') < 0`
already subsumes the first clause. Net effect: any number containing `555`
passes, but only 555-**01**00–555-**01**99 are actually reserved — "(415)
555-2671" is a real assignable number and the scanner clears it.

**LOW — `festivals/lib-fest.js:175-181`: `staleBuyers` degrades silently on a bad
date.** If `todayISO` is malformed, `shiftISO` returns `''` and the filter
quietly collapses to "never-contacted only" with no signal.

### How much of this is eight copies of one CRUD table?

Measured, not estimated.

| category | lib lines | share |
|---|---|---|
| genuinely distinct domain computation | ~370 | **28%** |
| curated data tables + letter/memo templates | ~349 | 27% |
| CRUD/store plumbing repeated across modules | ~210 | 16% |
| IIFE scaffolding, headers, comment banners | ~370 | 29% |

Per module, genuinely distinct logic: investors ~114 lines (waterfall/allocate/
breakeven), finance ~63, clearance ~59, festivals ~43, taxcredit ~39,
distribution ~22, screening ~18, **contracts ~12**.

The repetition is concentrated and precisely measurable:

- **8/8** pages define their own byte-identical `$()`, `esc()`, `readLS()`,
  `save()`, `toast()` and service-worker registration. 5 source lines are
  verbatim in all eight page scripts; 13 `<head>` lines are verbatim in all
  eight. `esc()` is redefined in **38 files repo-wide**.
- **5/8** libs mint their own `uid()` — identical but for the prefix letter
  (`'m'`, `'d'`, `'x'`, `'f'`, `'s'`).
- **5/8** libs define their own identical `num()`.
- **4/8** libs (`finance`, `contracts`, `distribution`, `screening`) implement
  the same delete idiom verbatim: `var n = arr.length; arr = arr.filter(…);
  return n !== arr.length`.
- **4/8** define their own `blank()` store seed; **4/8** their own
  `setStatus`-with-allowlist.
- Across the 8 pages: 26 `innerHTML =` render sites, 20 of them the identical
  `arr.map(fn).join('') || emptyState` shape, 51 delegated listeners and 25
  `getAttribute('data-…')` dispatches — one hand-rolled table engine, eight times.
- 15 separate money formatters repo-wide under 4 different names (`fm`, `fmt`,
  `money`, `fmtMoney`), 6 files with an inline `'$' + Math.round(...)`.
- `taxcredit/lib-taxcred.js:73-88` (`rowsFromMoney`) re-implements the PO/petty
  bucketing rules of `finance/lib-money.js:75-81` line for line — the comment at
  `:71-72` admits it ("same rules as CMoney.costReport"). Two copies of one
  business rule; add a PO status and the tax ledger silently diverges from the
  cost report.

Verdict: **roughly a quarter of this slice is real, irreplaceable domain work**
(the waterfall, the cost report shape, the clearance scanner, timecode). The
other three-quarters is a curated data table, a document template, and the same
CRUD table rendered eight times.

### Test coverage gap

Only 3 of 8 have a named suite (`test_investors`, `test_taxcredit`,
`test_festivals`); the other five share `scripts/test_ops.mjs` with safety.
More important: **outside `test_investors.mjs`, not one test in the slice uses a
money value with cents.** `test_ops.mjs` uses 10000, 5000, 20000, 6000, 150, 650.
Every rounding finding above is invisible to the suite because the suite never
supplies a fractional dollar. Two of the assertions actively pin bugs as spec:
`test_taxcredit.mjs:81` (the double discount) and the `test_ops.mjs` window test
(date-blind conflicts).

---

## What is missing entirely — the supporting software

### (a) `js/money.js` — a decimal money type with explicit rounding rules
**HIGHEST VALUE.** Every money bug above is one bug: money is a JS float that
gets multiplied then rounded, in eight different places, with eight different
rounding conventions.

Integer minor units + an explicit currency tag. No float ever reaches storage.
```js
CMoney2.of(1234.56, 'USD')      // → { cents: 123456, cur: 'USD' }
CMoney2.parse('$1,234.56')      // tolerant input parse, null on garbage
.add(b) .sub(b) .neg()          // throws on currency mismatch — never silently sums CAD+EUR
.mul(n, mode)                   // mode: 'half-up' | 'half-even' | 'floor' | 'ceil'; default half-even
.pct(n)                         // .mul(n/100) with the same explicit mode
.alloc(weights) -> Money[]      // lifted verbatim from CInvest.allocate; sums EXACTLY to the whole
.cmp(b) .isNeg() .isZero()
.fmt({decimals, symbol})        // the one formatter; replaces all 15
.toCsv()                        // fixed 2dp, never 15924.599999999999
```
`alloc()` is the load-bearing piece and it already exists and is already proven
correct at `investors/lib-invest.js:79-92` — this is extraction, not invention.
Round-half-even as the default kills the sign-asymmetry in `Math.round`.
`~180 lines + a suite with cents in every case.` Everything else waits on this.

### (b) `js/term.js` — dates, terms and rights windows
Second priority. Three distinct jobs the slice does badly or not at all:
```js
CTerm.today(tz)                     // LOCAL date, not toISOString() — fixes festivals:128
CTerm.shift(iso, days)              // lift festivals/lib-fest.js:182 verbatim
CTerm.addMonths(iso, n)             // end-of-month clamp: 2027-01-31 +1mo → 2027-02-28
CTerm.diffDays(a, b)
CTerm.deadline(iso, '23:59', tz)    // a real instant — festival deadlines are 11:59pm LOCAL TO THE FESTIVAL
CTerm.isPast(deadline, nowInstant)
CTerm.window({start, end|termMonths})
CTerm.overlaps(w1, w2)              // interval intersection
CTerm.contains(terrA, terrB)        // Worldwide ⊃ Europe ⊃ France — the containment table
CTerm.conflicts(windows)            // territory containment × channel × exclusivity × date overlap
CTerm.expiring(rows, dateField, within)  // one function serving screener expiry, festival
                                          // deadlines, rights reversion and buyer follow-up
```
Month arithmetic does not exist anywhere in the slice today, which is why
contract terms are free text. End-of-month rollover is the specific trap: a
12-month license from Jan 31 must land Jan 30/31 of the next year, not Mar 2.
`~200 lines.` Rank: **HIGH** — it is the only way `distribution` becomes a real
rights tracker.

### (c) `js/table.js` — the shared table engine
The eight pages hand-roll one table 26 times. A declarative renderer:
```js
CTable.render(el, {
  rows, cols: [{key, label, align, fmt, editable, type}],
  empty: 'No POs yet — every dollar you commit should enter through one.',
  totals: ['budget','actual','efc'],   // footed from RAW values, rounded once at render
  onEdit(rowId, key, value), onDelete(rowId), onAction(rowId, action)
});
```
Plus `js/store.js` for the `readLS/save/blank/uid/add/remove/setStatus` set that
5 of 8 libs each reimplement, and `js/page.js` for `$/esc/toast`/SW-registration
so those 5 lines stop being copied into 38 files. `esc()` living in one audited
place is a security win on a CSP that carries `'unsafe-inline'`.
`~250 lines total.` Rank: **MED-HIGH** — no user-visible change, but it is what
makes every subsequent fix land once instead of eight times.

### Migration order (dependency-forced)

1. **`js/money.js` + a cents-everywhere suite.** Nothing else is safe first.
2. **`finance/lib-money.js` onto it** — cost report, totals, snapshot week
   numbering, CSV. This is the module every other one reads, and its errors
   propagate into taxcredit, investors and contracts.
3. **`contracts/lib-deal.js`** — fringes, OT, per-diem days, scale boundary,
   PO lifecycle. It writes into the Money Room, so it must follow finance.
4. **`taxcredit`** — collapse the duplicate `JURIS` table to one source, add
   `asOf` + `searchLink` per entry, split tagged from guessed spend so `qualPct`
   applies once, and fix `belowMin` to measure qualified spend. Update
   `test_taxcredit.mjs:81` in the same commit.
5. **`js/term.js`**, then `distribution` (window end dates + real conflicts +
   screener expiry) and `festivals` (local today, deadline time zones, per-
   currency fees).
6. **`screening`** — session fps, frame storage, cut fingerprint, strict
   `parseTc`.
7. **`js/table.js` + `js/store.js` + `js/page.js`**, then re-seat all eight
   pages on them. Last, because it touches every file and must not be entangled
   with a behaviour change.

`investors/` moves last and moves least: it is already correct. Its only changes
are per-investor funding dates, an over-allocation flag, and adopting
`js/money.js` — and `allocate()` goes *into* `js/money.js` rather than being
rewritten.

---

## Evidence

Files read in full: `finance/lib-money.js`, `taxcredit/lib-taxcred.js`,
`investors/lib-invest.js`, `contracts/lib-deal.js`, `clearance/lib-clear.js`,
`distribution/lib-dist.js`, `festivals/lib-fest.js`, `screening/lib-screen.js`,
`finance/index.html:85-188`, `scripts/test_ops.mjs`.
Read in part: `taxcredit/index.html:67,83,100-211`, `investors/index.html:74-280`,
`contracts/index.html:140-183`, `clearance/index.html:95-154`,
`distribution/index.html:88-144`, `festivals/index.html:87-227`,
`screening/index.html:112-162`, `scripts/test_investors.mjs`,
`scripts/test_taxcredit.mjs`, `scripts/test_festivals.mjs`,
`scripts/test_csv_injection.mjs:66-73`, `timeline/timeline-budget.js:162-177`,
`js/` listing.

Executed against the shipped libs (not read, *run*):
- cost report footing, 3-account and 240-account drift — `finance/lib-money.js:89-92`
- float accumulation + raw-float CSV — `finance/lib-money.js:57,120-129`
- snapshot week collision over 70 weeks — `finance/lib-money.js:101-107`
- `Math.round` sign asymmetry at ±0.5/±1.5/±2.5
- taxcredit double discount, Georgia and BC, all rows tagged — `:104-131`
- `belowMin` against total vs qualified spend — `:117`
- 4,000-case waterfall reconciliation + 4,000-case breakeven round trip — `investors/lib-invest.js:99-179` (0 failures)
- backend over-allocation at 120% — `investors/lib-invest.js:141`
- `dealValue` per-diem on a weekly deal — `contracts/lib-deal.js:54-57`
- `memoText` "(scale)" at $600 against $1,204 scale — `contracts/lib-deal.js:78`
- `parseTc` on `;` and `.` notation; `addNote` frame quantisation — `screening/lib-screen.js:35,68-76`
- duplication census across all 16 files (verbatim-line, helper, CRUD-verb and render-site counts)
- `node scripts/run_all_tests.mjs` → 44/44 suites passed

No file was modified. Every figure quoted above is reproducible from the current
working tree.
