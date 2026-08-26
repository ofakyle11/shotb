# Legal, Clearance, Distribution & Festival

Judged as the people who get the film cleared, sold and seen. Short answer to
the brief's question: **the platform can carry a film through a *simulation* of
clearance, festival and sale, but not through the real thing.** Every stage has
a credible surface and honest prose; what it lacks is the paper. There is no
document vault, no chain-of-title checklist, no E&O application, no executed
agreement anywhere — and the one place the platform makes a legal-sounding
claim ("E&O-ready") can be satisfied by clicking a dropdown. The festival
strategy is real strategy, not a list — but the tracker forgets the single
decision the strategy exists to protect. The sales estimates are the most
honest thing in the repo and I would not change their numbers.

---

## What exists and works

- `docs/SALES_FORECAST.md:1-114` — the best-argued document in the codebase.
  Quantile bands instead of a point estimate, every rate cited to a named
  source, a `Known limitations` section (:101-114) that admits the calibration
  data is theatrical-era and ends "sales estimates from a real sales agent
  supersede all of it." That is the correct posture and it is rare.
- `producer/sales-forecast.js:26-32` — five budget brackets with per-bracket
  P10–P90 multiples and `n` in a comment on each row; `:33` carries the 15.5%
  no-real-release failure rate as a first-class constant, surfaced in the UI at
  `:283`. Bands legitimately tighten as budget rises.
- `producer/sales-forecast.js:80-82` — the Horror+R double-count guard. Someone
  thought about their own adjustment stack composing wrongly and fixed it.
- `producer/sales-forecast.js:138-152` — a 12-territory take/ask sheet at
  3–12% of budget each, scaled 0.55×–1.8× by cast bankability, netted of 15%
  commission and $60k market expenses. Totals land at 33–52% of budget, which
  is the right neighbourhood, and the UI (`:302`) states outright that
  producers overestimate these by ~2×.
- `festivals/lib-fest.js:104-122` — `strategy()` is genuine premiere
  sequencing, not a directory filter. It knows a world premiere is spent once,
  that an international premiere can still open Berlinale/Locarno/Rotterdam,
  and that a burned premiere means pivoting to markets and audience awards.
- `festivals/lib-fest.js:16, 87-90` — the honesty discipline. No invented dates,
  no invented URLs: every directory entry links to a Google search
  (`searchLink`) and the banner says windows drift. `scripts/test_festivals.mjs:26-31`
  *enforces* this — a test asserts every entry uses approximate language and
  that no entry contains `https?:`. Constraint encoded as a test is the right way.
- `investors/lib-invest.js:99-166` — the recoupment waterfall is correct and
  reconciles. Fee → expenses → debt+interest → gap+interest → equity+premium →
  50/50 backend, with in-tier shortfalls paid pro-rata by amount owed.
- `investors/lib-invest.js:77-92` — `allocate()` splits a pool to the cent and
  drops the rounding residue on the largest weight, so distributions always sum
  to exactly the pool. This is the kind of thing that gets a real waterfall
  disputed and it is handled.
- `investors/lib-invest.js:172-179` — breakeven solved algebraically rather
  than by iteration, and it returns a null with a note when the sales fee ≥ 100%.
- `investors/lib-invest.js:199-203, 260-262` — statements and quarterly letters
  both carry an unmissable "estimate, not an audited accounting — verify against
  the executed financing agreements and collection-account statements" footer.
- `distribution/lib-dist.js:15-39` — a 23-item delivery schedule grouped
  Picture / Audio / Accessibility / Marketing / Legal & docs. The specifics are
  right: textless backgrounds, DME stems, M&E foley-filled, SCC *and* SRT, audio
  description, ISAN in the metadata package, LTO archive master.
- `distribution/lib-dist.js:44-50` — buyer presets are realistically shaped: a
  festival premiere needs 5 items, a streamer needs all 23, broadcast wants
  textless and M&E, an aggregator wants metadata and chain of title.
- `music/lib-music.js:135-148` — the single best rights feature on the platform.
  It prices sync and master as *two separate sides* (`:141` — `master = tier.allIn ? 0 : side`),
  and on a festival-scope cue it warns "negotiate a step-up option to full rights
  now, before you need them" (`:144`). That is the exact trap that kills indie
  sales and nothing else in the repo names it.
- `contracts/index.html:147-158` — marking a deal `signed` writes a real PO into
  `SB_Money_v1` via `CMoney.addPO` and stamps `committedPo` back on the deal so
  it cannot double-post. A genuine integration, not a mock.
- `contracts/lib-deal.js:58-66` — deal→commitment maps role text onto the right
  budget account (cast 2000, crew 3000, edit/post/music 5000).
- `timeline/timeline-doc.js:119-125` — documentary E&O bands by scale
  ($1–3.5k DIY → $15–30k premium) cited to a named broker, plus archival at
  $3–9k/finished-minute (`:130-136`) and festivals & impact at 5–8% of hard
  costs (`:281-284`). This is real clearance *costing* and it is the standard
  the narrative path should be held to.
- `production/lib-prod.js:88-95`, `tools/tools-core.js:80-84` — CSV formula
  injection guarded consistently in both cue-sheet and register exports.
- `projects/lib-vault.js:15,24` — every store in my scope
  (`SB_ClearScan_v1`, `SB_Dist_v1`, `SB_Deals_v1`, `SB_Festivals_v1`,
  `SB_Rights_v1`, `SB_Insurance_v1`, `SB_Delivery_v1`, `SB_Clearance_v1`)
  matches `KEY_RE` and is portable, so the legal/distribution state travels with
  a `.cinamate` archive and the cloud sync. Correct by default.
- `screening/lib-screen.js:34-56, 79-84` — timecoded cut notes that convert to
  Editor markers, no video hosting, notes-only sync. Clean and honest about its
  own scope. (Internal review, not a buyer/press screening tool — see Missing.)

---

## What exists but needs work

### HIGH

- **`festivals/index.html:122` + `tools/tools-registers.js:72` — two modules
  write incompatible shapes to the same key `SB_Festivals_v1`, and one silently
  destroys the other.** The Tools > Festivals register stores a plain array
  (`tools/tools-core.js:58-60` — `this.rows = load(schema.key, [])`); the
  Festival Strategist stores `{premiereStatus, subs, buyers}`
  (`festivals/index.html:130-132`). Reproduced both directions:
  - Tools-first → Strategist: `readLS` returns an Array, `st.subs = st.subs || []`
    hangs `subs` off the array as a non-index property, and `save()` at `:132`
    runs `JSON.stringify(array)` which **drops every non-index property**. Every
    submission, buyer, fee and premiere status the user just entered is written
    away to nothing, silently, on every save.
  - Strategist-first → Tools: `load()` returns the object, `summary()` calls
    `rows.reduce` at `tools-registers.js:85` → `TypeError: rows.reduce is not a
    function`, and the tab renders nothing.

  The identical collision exists on **`SB_Deals_v1`**: `contracts/index.html:77`
  stores `{v:1, deals:[]}`, `tools/tools-registers.js:157` stores an array of
  buyer/investor pipeline rows. `rows.filter` throws the same way.
  **Change:** the brief forbids renaming an existing `SB_*` key, and both sides
  are live. So migrate by shape, not by rename — in `festivals/index.html` and
  `contracts/index.html`, detect `Array.isArray(stored)` and lift the legacy
  rows into `st.subs` / `st.deals` on load, and in `tools-registers.js` point
  the two colliding registers at their own new keys (`SB_FestReg_v1`,
  `SB_Pipeline_v1`) seeded once from the array form. Add a `scripts/test_*`
  case that asserts every `SB_*` key in the repo has exactly one writer shape;
  this class of bug will recur otherwise.

- **`clearance/lib-clear.js:105-107` — "E&O-ready" can be reached without
  clearing anything.** `summary()` computes `open` as *only* `status === 'pending'`,
  and `eoReady: open === 0`. The status dropdown at `clearance/index.html:104`
  offers `accepted risk`. Reproduced: scan a script with three findings, set all
  three to `accepted risk`, and `summary()` returns `open: 0, eoReady: true`
  while every `byCategory[*].cleared` stays `0`. The page then prints
  **"CLEAR — every finding addressed. Package the report with your E&O
  application."** (`clearance/index.html:95`). Accepted-risk items are precisely
  the ones an underwriter must be told about; here they are the ones that
  disappear. **Change:** split the summary into `cleared` / `acceptedRisk` /
  `pending`; make `eoReady` require `pending === 0 && acceptedRisk === 0`, and
  when accepted-risk items exist show an amber banner listing them as
  "disclosures the underwriter must see", not a green one.

- **`clearance/lib-clear.js:97-108` — the E&O verdict ignores every other
  rights store on the platform.** `summary()` sees only the auto-scan of
  `SB_Timeline_v1.scriptText` (`clearance/index.html:113`). It does not read
  `SB_Rights_v1` (unexecuted agreements — `tools-registers.js:129`),
  `SB_Clearance_v1` (the manual clearance register — `production/production.js:312`),
  `SB_Music_v1` (unlicensed cues — `music/lib-music.js:17`), or
  `SB_Insurance_v1` (`tools-registers.js:100`). A production with an empty chain
  of title, zero music licenses and no COI on file is told it is E&O-ready.
  **Change:** make `summary()` take an optional `context` argument
  `{rights, clearanceReg, cues, insurance}` and gate `eoReady` on: no pending or
  accepted-risk scan findings, **and** no `SB_Rights_v1` row with status ≠
  `Executed`, **and** no `SB_Music_v1` cue with status ≠ `licensed`/`replaced`,
  **and** an `E&O` row present in `SB_Insurance_v1`. Keep the engine pure —
  the page passes the stores in.

- **`distribution/lib-dist.js:86-94` — `windowConflicts()` gets exclusivity
  backwards in both directions.** It keys on `(territory + '|' + channel).toLowerCase()`
  and ignores dates entirely. Reproduced:
  - **Misses real conflicts.** `Worldwide/SVOD` exclusive + `Germany/SVOD`
    exclusive → **0 conflicts**. `United States/Theatrical` + `USA/Theatrical`
    → **0 conflicts**. Free-text territory means the two clashes that actually
    get producers sued are invisible.
  - **Invents false ones.** `Canada/SVOD` starting 2027 + `Canada/SVOD` starting
    2035 → **1 conflict**, though sequential licensing of the same territory is
    the normal shape of a distribution plan.

  `addWindow` (`:78-84`) stores `window` as free text ("90 days") and `start` as
  a date, with no computed end, so no date arithmetic is possible.
  **Change:** give `addWindow` a `months` number and derive `end`; replace the
  string key with a territory-set model — a small ISO-3166 region table where
  `Worldwide` ⊃ `Europe` ⊃ `DE` — and flag a conflict only when territory sets
  intersect **and** channel matches **and** `[start,end)` ranges overlap.
  Add holdback support (a `holdbackDays` after a theatrical window) since that is
  what the windows planner is for.

- **`festivals/lib-fest.js:126-137` — the submissions tracker cannot see a
  premiere conflict, which is the one thing festival strategy is for.**
  `newSub()` records `festival, category, deadline, fee, submittedOn, result` —
  no premiere status requested or required. `setResult()` (`:131-137`) sets a
  result and nothing else; `festivals/index.html:204` responds to an acceptance
  with a congratulations toast. So: log Sundance (world premiere required,
  `MAJORS[0].premiereNote`) and Rotterdam (overlapping January window) as both
  pending, and nothing warns. Accept one, and `st.premiereStatus` is not
  updated, the strategy panel keeps saying "everything is on the table", and the
  other pending A-list submissions are not flagged as now-unwinnable. The
  strategy engine already knows the rule (`:118-121` — "you can only spend it
  once") and the tracker does not enforce it.
  **Change:** add a machine-readable `premiereReq: 'world'|'international'|'regional'|'none'`
  to every `MAJORS` entry alongside the prose `premiereNote`, add `premiereReq`
  and `festivalDates` to `newSub()`, and add
  `premiereConflicts(subs) → [{a, b, reason}]` that flags (a) two pending
  submissions both requiring a world premiere, (b) any pending world-premiere
  submission once another is `accepted`, and (c) submissions whose festival
  dates overlap. Have `setResult(…, 'accepted')` advance `premiereStatus`
  automatically so the strategy panel stops lying.

- **Three clearance stores and two delivery checklists that never reconcile.**
  Clearance state is split across `SB_ClearScan_v1` (auto scan,
  `clearance/index.html:79`), `SB_Clearance_v1` (manual register,
  `production/production.js:312`) and `SB_Rights_v1` (chain of title,
  `tools-registers.js:129`) with **zero** cross-writes — a scanned finding never
  becomes a rights row, and `workflow/advisor.js:175-177` advises on
  `SB_Clearance_v1` alone, so scan findings never reach mission control.
  Delivery is split between `CDist.DELIVERABLES` (23 items,
  `distribution/lib-dist.js:15-39`) and `CProd.DELIVERY_TEMPLATE` (19 items,
  `production/lib-prod.js:147-167`), and **neither is a superset of the other**:
  CProd uniquely has *Dialogue continuity script*, *Talent agreements &
  releases* and *Copyright registration*; CDist uniquely has *DME stems*,
  *Audio description*, *Metadata/ISAN* and *LTO archive master*. A producer who
  ticks items off in Production Office → Delivery QC sees 0% in Distribution.
  **Change:** make `CDist.DELIVERABLES` the single source of truth, add the
  three missing CProd items to it, and have `CProd.deliveryTemplate()` project
  from it rather than hold its own copy. Add `CClear.toRightsRows(findings)` so
  a finding marked `cleared` drafts an `SB_Rights_v1` row with its counterparty,
  territory, media and term pre-filled.

### MED

- **`contracts/lib-deal.js:36-46` — a deal memo has no dates and no audit
  trail.** `addDeal` creates `{id, status:'draft', committedPo, fields}` and
  `setStatus` flips a string. No `sentAt`, no `signedAt`, no countersignature
  record, no version history, no record of *what text* was signed. A signed
  memo whose rate is later edited in the table at `contracts/index.html:146`
  silently rewrites the "signed" document — and if `committedPo` is already set,
  the Money Room commitment is *not* updated, so the cost report holds a stale
  number. **Change:** stamp `sentAt`/`signedAt`, snapshot `memoText(fields)`
  into `d.signedText` on transition to `signed`, freeze the row's rate inputs
  once signed, and emit a change-order PO when a signed deal's value changes.
- **`contracts/lib-deal.js:33` — contracted credit obligations never reach the
  credit roll.** `castDefaults` sets `credit: 'Main titles, single card,
  position by mutual agreement'`, and nothing ever reads it back.
  `tools/tools-media-ui.js:335-344` builds credits from `SB_Timeline_v1.characters`
  and `SB_Crew_v1` only. Meanwhile `distribution/lib-dist.js:35` lists
  "Final credits + paid-ad obligations" as a deliverable with no tool behind it.
  Breaching a credit clause is a real and common claim. **Change:** have the
  credit-roll seed read `SB_Deals_v1`, order by contracted position, and print
  a separate "credit obligations" list (billing block, paid-ad, card size) that
  can be checked against the roll.
- **`distribution/lib-dist.js:97-103` — the screener registry's expiry and notes
  fields are dead.** `addScreener` accepts `expires` and initialises `notes`,
  but `distribution/index.html:144` passes only `{recipient, company, link, sentAt}`
  and the renderer at `:123-129` displays neither. So the registry that says
  "if a copy leaks, this list is where the conversation starts" (`:78`) records
  no expiry, no per-recipient forensic watermark ID, and no revocation. It is a
  contact log, not a chain of custody. **Change:** surface `expires` in the add
  bar with a default (+14 days), show a red chip past expiry, add a
  `watermarkId` field per screener, and add a `revoked` state so the row stays
  on the record rather than being deleted.
- **`production/lib-prod.js:124-144` — residuals are one flat rate against one
  undifferentiated base.** Four guild rates applied to `svod + tv + avod +
  0.2 × homeVideo`, with no distinction between initial and post-initial market,
  no per-market rate table, no participant register, no per-title reporting
  period, and no statement output. The pane itself concedes the gap by telling
  the user to "fold this into Producer Suite → Sales as a distribution cost"
  (`production/production.js:383`) — a manual instruction with no path, and
  `investors/lib-invest.js:99-166` has no residuals line at all, so the
  waterfall over-reports investor returns by the residual amount.
  **Change:** make `RESIDUAL_RATES` a per-market table (`{guild: {svod, tv, avod, homeVideo, theatrical}}`),
  add a participant register keyed off `SB_Deals_v1`, generate a per-period
  statement, and let `CInvest.normOpts` take a `residuals` figure that is
  deducted off the top before the debt tier.
- **`tools/tools-script-ui.js:227-232` — the EPK silently destroys itself and
  can break the whole production's cloud sync.** Stills are read with
  `readAsDataURL` (`:228`) and persisted as base64 into `SB_EPK_v1` (`:232`),
  through `tools/tools-core.js:18-20` whose `save()` swallows
  `QuotaExceededError` with an empty `catch`. One real unit still (~3 MB) becomes
  a ~4.1 MB data URL and is silently dropped; several smaller ones push the
  project archive past the 4 MB cloud cap at
  `netlify/functions/projects-sync.js:25,244-245`, which returns 413 and fails
  the sync **for the entire production**, not just the EPK. Also, `stills.push`
  at `:229` is uncapped in memory while only `slice(0,8)` persists (`:232`), so
  the generated kit at `:248` embeds stills that will not survive a reload.
  **Change:** downscale to a bounded JPEG via canvas before storing, cap total
  EPK bytes and *report* the cap in the UI rather than swallowing it, and add
  `SB_EPK_v1` to the vault's non-portable set or store stills outside the synced
  archive.
- **`tools/tools-script-ui.js:202-265` — the press kit is missing what a press
  kit is for.** It carries title, logline, runtime, synopsis, stills, characters,
  crew, contact. It has no key art/poster, no director's statement, no
  cast/crew bios, no technical specifications (aspect ratio, sound format,
  shooting format, language, country of origin, year), no festival laurels, no
  press quotes, no photo captions and no photographer credit — the last is
  contractually required by most unit stills agreements. **Change:** add those
  fields; laurels can be driven off `SB_Festivals_v1` submissions with
  `result === 'accepted'`, and tech specs off the Editor/post store.
- **`producer/sales-forecast.js:26-33` — the quantile band is conditional on
  release and never made unconditional.** `MULT_BY_BUDGET` is calibrated on
  films with reported revenue; `FAILURE_RATE = 0.155` is displayed as a separate
  caveat at `:283` rather than folded in. So the headline P10 for a sub-$5M film
  reads 0.27× when the unconditional P10 — the number an investor actually
  faces — is nearer zero. `docs/SALES_FORECAST.md:111-112` is candid about this
  being a dataset artifact, which is why this is MED not HIGH.
  **Change:** show both — a "conditional on release" band and an
  "all budgeted films" band with the 15.5% mass at zero — so the P10 row stops
  reading as a floor.
- **Two waterfalls that model the same money and never meet.**
  `producer/sales-forecast.js:110-131` runs gross → lifetime → dist fee → P&A →
  agent → budget → financing premium → NET. `investors/lib-invest.js:99-166`
  runs gross receipts → sales fee → expenses → debt → gap → equity → 50/50.
  Neither feeds the other; the Sales tab's "NET (investors + producer pool)"
  is exactly the `grossReceipts` input the Investor Room asks the user to type
  by hand. **Change:** add a "send P50 net to Investor Room" action that writes
  the forecast net into `SB_Investors_v1` as a scenario, and reconcile the two
  fee stacks so an indie sales agent is not charged 10% in one model and 15% in
  the other.
- **`festivals/lib-fest.js:139-146` and `music/lib-music.js:118-170` — real
  money that never reaches the budget.** Festival fees total in `feesTotal()`
  and per-cue license estimates total in `CMusic.totals()`, and neither posts to
  `SB_BudgetSheet_v1` or the Money Room. The narrative budget has only a single
  generic `16000 · Insurance & Legal` account (`producer/budget-sheet.js:30`,
  `js/budget-engine.js:718-719`) with no E&O, music-licensing, clearance or
  festival/P&A line — while documentary mode has all of them, properly sourced
  (`timeline/timeline-doc.js:119-125, 281-284`). **Change:** port the doc-mode
  E&O bands and festival-percentage line into the narrative budget engine, and
  push `feesTotal().paid` and `CMusic.totals().licensed` in as actuals.

### LOW

- `clearance/lib-clear.js:38-39` — the `realperson` detector only matches a
  *title* followed by a capitalised word (`President|Senator|…|Prince(ss)`).
  "Taylor Swift", "Elon Musk" or a named real corporation portrayed
  unflatteringly all pass clean. A capitalised-bigram pass cross-checked against
  the script's own character list would catch far more; defamation and
  false-light are the claims E&O actually pays out on.
- `clearance/index.html:112-125` — the Clearance page has no export. Buttons are
  scan, draft letter, copy. The banner tells the user to "package the report
  with your E&O application" and there is no report to package. A CSV/print of
  findings-by-category with status and disposition is a small addition.
- `distribution/index.html` — no export of any kind either: no printable
  delivery schedule, no delivery memo, no windows chart. Buyers issue delivery
  schedules as documents.
- `clearance/lib-clear.js:31-33` — the phone detector skips any match containing
  the substring `555` anywhere, which is a slightly loose way to express
  "555-01XX is the reserved fictional block". Correct in practice; brittle.
- `festivals/lib-fest.js:175-186` — `staleBuyers` is a fixed 30-day rule with no
  per-buyer cadence and no next-action date. Fine as a nudge.
- `contracts/lib-deal.js:13` — `SAG_SCALE` is a single hardcoded pair
  (`day: 1204, week: 4181`) with a comment saying it is "kept current in one
  place". It has no effective date, so a memo generated a year from now will
  cite a stale scale as though it were current. Add `asOf` and print it.

---

## What is missing entirely

- **Chain-of-title checklist and document vault — HIGHEST VALUE.** There is
  nowhere on this platform to put an executed document. `SB_Rights_v1`
  (`tools-registers.js:124-150`) is a flat 10-column table with a `status`
  dropdown; `projects/lib-vault.js` snapshots localStorage keys, not files. So
  the chain of title exists as a row that says `Executed` with no PDF behind it,
  and there is no home for a certificate of authorship, a short-form assignment,
  a copyright registration certificate, a title report, a COI, or a signed
  release. No distributor closes without these and no E&O underwriter binds
  without them. **Attach to:** `clearance/` as a third section, backed by a new
  `SB_Docs_v1` index plus IndexedDB blob storage (localStorage cannot hold PDFs,
  and `netlify/functions/projects-sync.js:25` caps the archive at 4 MB, so the
  documents must stay local with only the index syncing). **Build:** the ordered
  US chain-of-title checklist (underlying rights → writer agreements + CoAs →
  producer/director/cast agreements → copyright registration PA → title report
  → short-form assignment → E&O binder), each step with required/optional,
  attached-document slot, and a completeness gauge. ~1 module.
- **E&O application support — HIGH.** The word appears in eleven places
  (`clearance/`, `distribution/lib-dist.js:32`, `production/lib-prod.js:160`,
  `tools-registers.js:103`) and there is no application anywhere. **Attach to:**
  `clearance/`. **Build:** the standard underwriter questionnaire — title,
  synopsis, sources of the story, is it based on real persons/events, are there
  identifiable living persons, music and archival sourced, releases obtained,
  title cleared, script clearance report attached — pre-filled from the scan,
  `SB_Rights_v1`, `SB_Music_v1` and the crew register, exportable as text.
  Plus the coverage-band estimator that already exists for documentary
  (`timeline/timeline-doc.js:122-125`) generalised to narrative. Small.
- **Rights matrix by territory / term / media with reversion — HIGH.**
  `SB_Rights_v1` has `territory` (free text), `media` (single-select) and
  `termEnd`, but there is no matrix view, no overlap detection, no reversion
  calendar, and no test that grants never exceed what was acquired. A film whose
  archival license is festival-only cannot legally supply the streamer
  deliverables list at `distribution/lib-dist.js:47`, and nothing on the
  platform would notice. **Attach to:** `clearance/`, reading `SB_Rights_v1`.
  **Build:** territory × media grid per underlying work, an
  `acquired ⊇ granted` check against `SB_Dist_v1.windows`, and a reversion
  calendar off `termEnd`. Shares the territory-set model the windows fix needs.
- **Festival deadline calendar with premiere-conflict warnings — HIGH.**
  Covered under `windowConflicts`/`newSub` above as a fix, but the calendar half
  is genuinely absent: `upcoming()` (`festivals/lib-fest.js:149-160`) sorts
  pending submissions and flags `past`, and that is the whole of it. No festival
  *dates* (only submission deadlines), so travel and premiere windows cannot be
  laid out; no early/regular/late/extended deadline tiers, though `feeHint`
  concedes fees are tiered "by deadline tier" on eleven of fourteen entries; no
  reminders; no ICS export. **Attach to:** `festivals/`. Medium.
- **Sales agent and market tracking — HIGH.** There is no sales agent entity
  anywhere. The only trace is a `'Sales agent'` option in a dropdown at
  `tools-registers.js:161`. No sales agency agreement, no term/territory of the
  agency appointment, no MG or overage tracking, no per-territory deal record,
  no commission reconciliation, no market presence at all — I found zero
  references to AFM, EFM, Marché du Film, Ventana Sur or Filmart in any module.
  Meanwhile `producer/sales-forecast.js:138-152` produces a 12-territory ask
  sheet that nothing on the platform can record an actual deal against.
  **Attach to:** `distribution/` as a fourth section, or a `sales/` module.
  **Build:** market calendar; per-territory sales sheet seeded from
  `SBSales.TERRITORIES` with ask / offer / MG / signed; agent commission and
  recoupable market expenses; a screenings-and-meetings log per market. Medium.
- **Deal memo → long-form contract flow — HIGH.** `CDeal` produces exactly two
  documents: a crew/cast short-form memo and an NDA (`lib-deal.js:69-103`). The
  memo's own text says "a long-form agreement, if issued, supersedes it"
  (`:89`) and no long form exists. Missing: option/purchase agreement, writer
  agreement + certificate of authorship, director agreement, producer agreement,
  composer agreement, sales agency agreement, distribution licence agreement,
  and any interparty/CAMA paper. **Attach to:** `contracts/`. **Build:** the
  same plain-language template pattern already proven, plus a supersession link
  from memo to long form so the record shows which document governs. Medium.
- **Distribution deal modelling — HIGH.** `distribution/` models *delivery* and
  *windows* but not the *deal*. There is no place to record an MG, a
  distribution fee, recoupable expenses caps, a reporting schedule, an audit
  right, a holdback, a reversion trigger, or a performance-based termination.
  `investors/lib-invest.js` waterfalls receipts it has to be told about by hand.
  **Attach to:** `distribution/`. **Build:** a deal record whose terms *drive*
  the investor waterfall's `salesFeePct` and `expensesOffTop` instead of the
  user retyping them. Medium.
- **Revenue ledger and distributor statement reconciliation — HIGH.** The
  Investor Room's gross receipts is one number typed into a box
  (`investors/index.html:73`). There is no ledger of actual receipts by
  territory / licensee / period, no import of a distributor statement, no
  variance against the deal terms, and no collection-account (CAMA) concept
  even though `lib-invest.js:201-202` twice tells the user to verify against
  collection-account statements. **Attach to:** `investors/`. Medium.
- **Marketing asset and EPK management — MED.** Beyond the EPK's eight base64
  stills there is no asset register: no key art versions, no trailer cut
  tracking, no stills selects with photographer credit and caption, no
  territory-specific artwork, no approval state, no usage rights per asset
  (many stills licenses are festival-and-press only, not key-art), and no
  delivery-spec check against `CDist` marketing items. **Attach to:**
  `distribution/` (which already names the four marketing deliverables at
  `lib-dist.js:27-30`). Medium.
- **No pipeline stage past "Deliver" — HIGH, and cheap.**
  `workflow/workflow.js:153-161` ends the pipeline at Deliver = captions, credit
  roll, press kit, final export. Clearance, E&O, festival premiere, market,
  sale and distribution delivery — six of my seven modules — are invisible to
  mission control. `workflow/advisor.js:175-177` offers exactly one legal
  advisory, and it reads the wrong store. **Attach to:** `workflow/workflow.js`
  `assess()`. **Build:** three stages — *Clear* (scan pending-zero, rights
  executed, E&O bound), *Premiere* (submissions logged, premiere status spent
  deliberately, acceptance), *Sell* (screeners out, buyers active, windows
  planned, delivery % by buyer). All the data already exists in localStorage;
  this is reading it. Small, and it is what makes the back half of the platform
  feel like one product.
- **Festival/press screening logistics — MED.** `screening/` is an internal
  cut-review tool. Nothing handles a festival or press screening: no DCP test
  and KDM tracking, no venue/format confirmation, no press and industry RSVP,
  no Q&A/talent travel, no embargo dates, no review tracking. **Attach to:**
  `festivals/`. Medium.
- **Title clearance and copyright registration — MED.** Neither exists. A title
  report is an E&O prerequisite and `CProd.DELIVERY_TEMPLATE` lists "Copyright
  registration" (`production/lib-prod.js:166`) with no tool behind it.
  **Attach to:** the chain-of-title checklist above. Small once that exists.

---

## Evidence

Files read in full: `docs/audit/BRIEF.md`; `clearance/lib-clear.js` (153),
`clearance/index.html` (154); `contracts/lib-deal.js` (112),
`contracts/index.html` (183); `distribution/lib-dist.js` (117),
`distribution/index.html` (162); `festivals/lib-fest.js` (208),
`festivals/index.html` (272); `investors/lib-invest.js` (275);
`screening/lib-screen.js` (107); `production/lib-prod.js` (182),
`production/index.html` (108); `tools/tools-registers.js` (177);
`docs/SALES_FORECAST.md` (114); `producer/sales-forecast.js` (359).

Read in part: `tools/tools-core.js:12-100` (Register storage, csvSafe);
`tools/tools-script-ui.js:195-265` (EPK); `tools/tools-media-ui.js:321-380`
(credit roll); `tools/index.html:41-112` (tab wiring);
`production/production.js:300-395` (clearance / delivery QC / residuals panes);
`workflow/workflow.js:1-185` (pipeline stages); `workflow/advisor.js:174-177`;
`post/lib-post.js:225-262` (delivery readiness); `music/lib-music.js:1-175`;
`timeline/timeline-doc.js:115-135, 255-290`; `producer/budget-sheet.js:30,76-97`;
`js/budget-engine.js:154,718-719`; `projects/lib-vault.js:1-40`;
`netlify/functions/projects-sync.js:25,244-245`; `writer/writer.js:7-8,213`;
`scripts/test_ops.mjs:85-165`; `scripts/test_festivals.mjs:1-120`;
`investors/index.html:55-125`; `screening/index.html:40-90`;
`dashboard.html:1408-1531`; `docs/FEATURE_CANDIDATES.md:25,49-53`.

Claims verified by execution, not by reading:
- `SB_Festivals_v1` array→object collision: `JSON.stringify` on an Array with a
  `.subs` property returns `[{…tools rows}]` — `subs` is `undefined` on reparse.
  Reverse direction: `rows.reduce is not a function`,
  `rows.forEach is not a function`, `rows.length === undefined`. Same for
  `SB_Deals_v1` (`rows.filter is not a function`).
- `CClear.summary` with all findings set to `accepted risk` →
  `{open: 0, eoReady: true}` with every `byCategory[*].cleared === 0`.
- `CDist.windowConflicts`: `Worldwide/SVOD` + `Germany/SVOD` → 0 conflicts;
  `United States/Theatrical` + `USA/Theatrical` → 0 conflicts;
  `Canada/SVOD` 2027 + `Canada/SVOD` 2035 → 1 conflict.
- `CDist.DELIVERABLES.length === 23` vs `CProd.deliveryTemplate().length === 19`,
  neither a superset (12 CProd items absent from CDist by label match).
- `CinUrl.safe` on an image data URL passes it through; on
  `data:text/html,<script>` and `javascript:` returns `''` — the EPK's
  `<img src="…">` at `tools-script-ui.js:249` is correct, no bug there.
- `node scripts/run_all_tests.mjs` → **44/44 suites passed**. No file in this
  repository was edited.

Files I did **not** read and therefore make no claim about: `app.html`
(511 KB monolith), `editor/`, `sets/`, `boards/`, `finance/lib-money.js`
beyond its `addPO` call site, `dailies/`, `casting/`, `taxcredit/`.
