# Team A Dev 19 — missing: delivery, distribution, marketing

Domain: getting the film out. Everything below was checked against the repo
first. Where I claim something is missing I say what I searched and where.

**Search log (repo-wide, excluding `node_modules/ .git/ private/ static/vendor/`):**
`watermark` 0 files · `forensic` 0 · `DRM` 0 · `LUFS|LKFS|loudness|R128|dialnorm` 0 ·
`Rec.709|Rec.2020|Dolby Vision|HDR` 0 (only `HDRI` in `vfx/lib-vfx.js:155`) ·
`dubbing|localization|localisation|territory version` 0 · `avails` 0 ·
`MPAA|rating board|BBFC|FSK|age rating` 0 (`certification` only in
`taxcredit/lib-taxcred.js:135` and means the UK/IE/AU cultural test) ·
`title report|title search|title opinion` 0 · `collection account|CAMA` 0 ·
`distributor statement|remittance|sales report|earnings` 0 · `comparable` 0 ·
`EIDR` 0, `ISAN` 1 (a delivery-list label, `distribution/lib-dist.js:37`) ·
`AFM` 1 (a source comment, `producer/sales-forecast.js:99`), `EFM|Marché` 0 ·
`billing block` 1 (a free-text textarea, `boards/index.html:72`).
Also enumerated every `SB_*` key in the repo (89) so nothing below collides
with one that already exists.

---

## What exists and works

- `distribution/lib-dist.js:15-39` — a 23-item master delivery schedule grouped
  Picture / Audio / Accessibility / Marketing / Legal & docs. The item list
  itself is genuinely the right list; someone who has actually delivered a film
  wrote it (textless backgrounds, M&E foley-filled, DME stems, ISAN in the
  metadata package, LTO archive master).
- `distribution/lib-dist.js:44-50` — five buyer presets (festival / theatrical /
  streamer / aggregator / broadcast) that reshape the required set. Festival
  needing 5 items and a streamer needing all 23 is exactly right and is the
  single best idea in the module.
- `distribution/lib-dist.js:57-70` — `checklist()` returns required-vs-complete
  and a percentage against the *required* subset only, so unrequired extras
  don't inflate progress. Correct, and covered at `scripts/test_ops.mjs:144-149`.
- `festivals/lib-fest.js:27-84` — 14 curated majors with honest approximate
  windows, premiere notes and fee hints, an explicit drift banner
  (`lib-fest.js:16`) and Google-search links instead of invented URLs
  (`lib-fest.js:87-90`). This is the right way to ship a directory that ages.
- `festivals/lib-fest.js:104-122` — `strategy()` gives real, correct advice
  about spending a world premiere only once. Good writing, good judgment.
- `festivals/lib-fest.js:139-160` — fee totals split paid vs planned by whether
  a `submittedOn` date exists, and `upcoming()` flags past-due deadlines.
- `clearance/lib-clear.js:66-95` — scene-scoped clearance scan across brands,
  music, non-555 phone numbers, artwork, archival footage, real persons,
  currency and signage, each finding carrying the standard remedy. This is a
  real pre-E&O read, not a keyword toy, and the `keep()` guard at
  `lib-clear.js:33` correctly spares 555-01XX numbers.
- `clearance/lib-clear.js:110-147` — materials request, appearance release,
  location release and sync request letters. Plain, signable, honest.
- `investors/lib-invest.js:99-166` — the recoupment waterfall is the most
  rigorous piece of money code in the platform: correct tier order, pro-rata
  shortfalls inside a tier, and `allocate()` (`lib-invest.js:77-92`) dropping
  the rounding residue on the largest weight so distributions reconcile to the
  cent. `breakeven()` (`:172-179`) solves directly rather than iterating.
- `tools/lib-script.js:51-113` — real SRT and WebVTT parse/write plus a caption
  QC that checks reading speed (20 cps), line length (42 chars), 3+ lines and
  cue overlap. Wired to an editor at `tools/tools-script-ui.js:132-199`. This
  covers the "caption and subtitle formats" item on my brief — it is **not**
  missing, and it is good.
- `production/lib-prod.js:70-103` — music cue sheet derived from the Editor's
  audio track with composer / publisher / society columns and CSV-injection
  guarding at `:91-95`. Cue-sheet delivery is covered.
- `music/lib-music.js` — sync/master licensing tiers, per-cue status flow
  (`:117-123`), quote-vs-estimate handling and license request letters. The
  "music licenses" deliverable is genuinely served.
- `tools/tools-registers.js:124-150` — a Rights / Chain-of-Title *register*
  (`SB_Rights_v1`) with counterparty, territory, media, term start/end,
  reversion date and an executed/not-executed chain-gap chip. Metadata coverage
  of chain of title is real. (What is missing is the documents themselves — see
  below.)
- `tools/tools-registers.js:152-176` — buyer/sales-agent/investor pipeline
  (`SB_Deals_v1`) with stages through Screener sent → Offer → Negotiation, and
  `festivals/lib-fest.js:168-190` adds a second buyer CRM with stale-contact
  follow-up. Buyer tracking exists twice over.
- `tools/tools-script-ui.js:202-261` — EPK generator producing a self-contained
  press-kit HTML with stills, characters and crew, using `CinUrl.safe()` on
  every embedded image src (`:249`). Press kit is **not** missing.
- `producer/sales-forecast.js:19-181` — quantile-band revenue forecast
  calibrated on 3,708 features, a gross→producer-net waterfall, a 12-territory
  pre-sale take/ask sheet and streaming buyout comps, with the honest caveat
  that ~15.5% of budgeted films never see meaningful revenue. Forward-looking
  sales modeling is well served.
- `production/lib-prod.js:120-144` — a guild residuals *estimator* on
  distributor's gross with the home-video 20% royalty base convention.

---

## What exists but needs work

Kept short — ten teammates are covering improvements. The first is a hard bug I
tripped over while verifying gap 8 and cannot leave unreported; the rest are
here because they define where the gaps below have to attach.

- **`SB_Deals_v1` is written in two incompatible shapes by two modules — one of
  them crashes on load. HIGH, data loss.**
  `contracts/index.html:77` sets `KEY = 'SB_Deals_v1'` and stores an **object**,
  `{v:1, deals:[…]}` (`contracts/lib-deal.js:21`).
  `tools/tools-registers.js:157` gives the Buyers & Investors register the
  **same key**, and `TCore.Register` stores a bare **array** of rows
  (`tools/tools-core.js:60,62`).
  Neither guards the shape it reads:
  - `contracts/index.html:85` — `var st = readLS(KEY) || D.blank();`. An array
    is truthy (even `[]`), so `D.blank()` never runs, and `render()` at
    `contracts/index.html:90` immediately calls `st.deals.forEach(…)` on
    `undefined`. The Deal Memos page throws and renders nothing.
  - The reverse is just as bad: `TCore.load` (`tools/tools-core.js:15`) returns
    the object rather than its `[]` fallback, so `this.rows` becomes
    `{v:1,deals:[]}`; `this.rows.length` is `undefined` so the table renders
    "Nothing here yet", and the first `add()` (`tools-core.js:66`,
    `this.rows.unshift`) throws.
  Whichever module the owner opens second is broken, and the first `persist()`
  or `save()` afterwards overwrites the other module's data permanently. Both
  modules are on my brief's list (contracts, and the buyer pipeline behind
  gap 8). Fix: give the deal-memo store its own key — but note the brief's
  rule, existing owners already have data under `SB_Deals_v1` in *one* of the
  two shapes, so the migration has to sniff the shape (`Array.isArray`) and
  move the right half, not just rename.

- `distribution/lib-dist.js:53,71-75` — HIGH. Completion is a bare boolean map
  (`done: {}`), toggled by id. A deliverable has no due date, no delivered
  date, no owner, no file reference and no state between "todo" and "done"
  (no "in QC", no "rejected by buyer"). A distribution agreement's delivery
  date is a breach trigger; the platform cannot express one. Any fix must
  migrate in place — `SB_Dist_v1` is live.
- `distribution/lib-dist.js:99` + `distribution/index.html:144` — MED. `expires`
  is accepted by `addScreener()` and stored, but the page never passes it
  (`index.html:144` sends only recipient/company/link/sentAt) and never renders
  it (`index.html:123-129`). A dead field on the one record that exists to
  contain a leak.
- `distribution/lib-dist.js:86-94` — MED. `windowConflicts()` keys on
  `territory + '|' + channel` lowercased and ignores dates entirely, so two
  *sequential* SVOD windows in the same territory read as an exclusivity clash
  — `scripts/test_ops.mjs:152-154` actually asserts that false positive (Canada
  SVOD from 2027-01-01 and from 2027-03-01 → 1 conflict). Meanwhile a genuine
  clash between `Worldwide` and `Germany` is invisible because the strings
  differ. Territory needs to be a set, not a string, and windows need an end.
- Two delivery checklists that do not talk to each other — MED.
  `distribution/` uses `SB_Dist_v1` + `CDist.DELIVERABLES`
  (`lib-dist.js:15-39`); `production/production.js:330-350` uses
  `SB_Delivery_v1` + `CProd.deliveryTemplate` (`production/lib-prod.js:146-173`),
  a 19-row near-duplicate with a richer status vocabulary
  (`todo / in QC / passed / delivered / n/a`) and a notes/file-reference column.
  `workflow/advisor.js:179-180` nags about the *production* one; nothing reads
  the *distribution* one. Tick an item in one and the other still says todo.
  One of these has to become the source of truth before a spec matrix can hang
  off it.
- Three unconnected waterfalls, all fed by a hand-typed number —
  `investors/lib-invest.js:99`, `producer/sales-forecast.js:109`,
  `tools/lib-money.js:145`. See gap 3.

---

## What is missing entirely

### 1. Revenue actuals — receipts ledger and participation statements · HIGH

**What it is.** A record of money that actually came in: each distributor,
sales-agent or platform statement as a row — licensee, territory, channel,
period, currency, gross, distribution fee, recoupable expenses, net remitted,
date received.

**Where I looked.** `distributor statement|remittance|sales report|earnings` →
0 hits repo-wide. `collection account|CAMA` → 0. The only revenue input in the
entire platform is a single number: `investors/index.html:74`
(`<input id="ivGross">`) plus a slider at `:211`, stored as `st.gross`
(`investors/index.html:129`) and passed straight to
`CInvest.waterfall(st.investors, st.gross, opts)` at `:185`.

**Why a production needs it.** The platform can model money three separate ways
— `investors/lib-invest.js:99`, `producer/sales-forecast.js:109`,
`tools/lib-money.js:145` — and can record it zero ways. Consequences that bite:
the quarterly investor letter (`investors/lib-invest.js:219-267`) reports
"gross receipts to date" from a number someone typed, and says so at `:252`;
the residuals estimator (`production/lib-prod.js:130`) needs per-market gross it
has no source for; and nobody can reconcile a distributor's statement against
the contracted fee and expense cap, which is where indie films are quietly
underpaid. The Money Room (`finance/lib-money.js`) is scrupulous about every
dollar going *out* and blind to every dollar coming *in*.

**Attach to.** `investors/` as a "Receipts" tab (it already owns the waterfall
and the investor letter), or a small `revenue/` module on the dashboard rail.

**Data model.** New key `SB_Receipts_v1`:
```
{ v:1, statements:[ { id, source, licensee, territory, channel,
  periodStart, periodEnd, currency, fxRate, gross, distFeePct, distFee,
  expenses, net, receivedOn, notes, lines:[{label, amount}] } ] }
```
Then `CInvest.waterfall()` takes `sum(net)` instead of a typed number (keep the
manual override for what-if), `CProd.residuals()` gets a real per-market base
from `channel`, and a `statement(period)` function emits a per-investor
statement for an actual quarter rather than a hypothetical.

**Size.** Medium-large. ~250 lines of `lib-` logic + a page + tests. The
waterfall it feeds already exists and is correct, which is most of the work.

---

### 2. Technical delivery specification matrix · HIGH

**What it is.** For each deliverable and each buyer profile, what the file must
actually *be*: container and codec, resolution, frame rate, scan, aspect,
color space and transfer, audio channel mapping and order, loudness target,
peak ceiling, caption format and frame rate, file naming, slate and head/tail
build, metadata fields required.

**Where I looked.** `LUFS|LKFS|loudness|EBU R128|dialnorm` → 0 files.
`Rec.709|Rec.2020|Dolby Vision|HDR` → 0 (only `HDRI` in VFX). `bitrate|codec`
→ only the Editor's own export path (`editor/cut-ui.js:659,704`). The
deliverable rows are label strings only — `distribution/lib-dist.js:16-38` and
`production/lib-prod.js:147-167` carry no spec fields, and `BUYER_PRESETS`
(`lib-dist.js:44-50`) is a list of item ids with nothing attached.

**Why a production needs it.** `{ id:'pm51', label:'5.1 printmaster' }` tells a
producer to make one; it does not tell them the platform wants -27 LUFS with a
-2 dBTP ceiling in L R C LFE Ls Rs order, or that the captions must be SCC at
29.97 drop-frame rather than the 24 fps SRT they have. Platform QC rejections
on exactly these points cost weeks and a re-master fee, and they land after the
window has been announced. This is the single largest piece of "the platform
knows *what* but not *what shape*" in my whole domain.

**Attach to.** `distribution/lib-dist.js` — a `SPECS` table keyed by profile,
merged into `checklist()` so each row can expand to its spec, and a "spec
sheet" export the post house can be handed. It also gives the two rival
checklists (see above) a reason to merge, since `SB_Delivery_v1` already has
the `in QC / passed` vocabulary a spec check needs.

**Data model.** Static in the lib (no new key needed for the standard
profiles); `SB_DistSpec_v1` only if owners define custom buyer profiles.
Constraint to respect: the brief forbids inventing numbers, and platform specs
drift yearly — so every profile carries a `CFest.BANNER`-style verify notice
and a Google-search link to the current delivery spec, exactly the pattern
`festivals/lib-fest.js:16,87-90` already established.

**Size.** Medium. ~200 lines of table + spec-merge logic, a UI disclosure per
row, tests in `scripts/test_ops.mjs`.

---

### 3. Premiere-status conflict detection · HIGH (best value per line in this report)

**What it is.** Knowing that accepting festival B on 20 Aug burns the
international premiere that festival A's 5 Sep competition slot requires.

**Where I looked.** Two festival trackers, neither able to detect it.
`festivals/lib-fest.js:126-131` — `newSub()` stores `festival, category,
deadline, fee, submittedOn, result`. There is **no festival screening date**,
no premiere requirement, no territory. `strategy()` (`lib-fest.js:104-122`)
reasons from one global string on the whole film (`st.premiereStatus`, set by a
dropdown at `festivals/index.html:156`) and produces prose, not a check.
`tools/tools-registers.js:74-82` — the `SB_Festivals_v1` register *does* have a
`premiere` requirement column (None / World / International / North American /
US / Regional) and a `deadline`, but again no screening date and no logic; the
page just prints a note telling the user to sequence it themselves
(`tools-registers.js:92`).

**Why a production needs it.** Premiere status is spendable once per tier and
the ladder is strict: world → continental → national → regional. A festival
acceptance is a date, not a status change, so the damage is done by whichever
festival *screens* first, not whichever you accepted first. `strategy()`
already says this in prose at `lib-fest.js:119-121` — "never burn it on a minor
festival while an A-list answer is still pending" — and then the tracker gives
you no way to see that you are about to. This is a mistake that ends a film's
festival run, and the platform has every input except two date fields.

**Attach to.** `festivals/lib-fest.js`.

**Data model.** Extend `newSub()` with `festStart`, `festEnd`, `premiereReq`
(reuse the exact option list already in `tools-registers.js:81` so the two
trackers agree), `territory`. Same key `SB_Festivals_v1` / `st.subs` — additive
fields only, old records read as blank. Add:
```
premiereConflicts(subs) → [{ id, burnedBy, tier, note }]
```
walking accepted-and-dated submissions in `festStart` order, tracking which
tiers are spent, flagging any submission whose `premiereReq` is already burned
by an earlier screening. Render as a red chip in the existing submissions table
(`festivals/index.html:170-182`).

**Size.** Small-medium. ~60 lines of logic, two inputs, a chip, tests alongside
`scripts/test_festivals.mjs`. Highest value-to-effort ratio in this report.

---

### 4. Screener forensic identification and expiry · HIGH

**What it is.** A per-recipient code that survives on a leaked copy, plus an
enforced expiry on the link.

**Where I looked.** `watermark` 0 files, `forensic` 0, `burnin` 0, `DRM` 0
repo-wide. The screener registry (`distribution/lib-dist.js:97-103`,
`distribution/index.html:70-78,123-129`) records recipient, company, link,
sentAt, watched. `distribution/index.html:78` states the intent plainly — "If a
copy leaks, this list is where the conversation starts" — but the list holds
nothing that ties a specific leaked file to a specific recipient, and
`expires` is stored and never used (see the needs-work section).

**Why a production needs it.** With one screener out you know who leaked it.
With forty out to programmers and buyers you know nothing, which is precisely
the situation the registry exists for. A pre-premiere leak devalues a sale.

**Attach to.** `distribution/`. The platform deliberately hosts no video
(`screening/lib-screen.js:5-7` explains why, and that decision is correct), so
the honest build is *not* server-side watermarking. Instead: generate a short
unique code per screener record, show the burn-in instruction next to it (the
Editor at `editor/cut-ui.js:457` already has a text/subtitle layer that can
carry it), and add a reverse lookup — paste a code seen on a leaked copy, get
the recipient. Plus surface and enforce `expires`, marking lapsed screeners
visibly.

**Data model.** Additive fields on the existing screener record in
`SB_Dist_v1`: `code`, `expires` (already there), `revoked`. No new key.

**Size.** Small. ~50 lines plus UI. Should ship with gap 1's module or on its own.

---

### 5. Chain-of-title document vault · MED-HIGH

**What it is.** Evidence, not metadata: which executed document backs each
rights grant, who signed it, when, and proof the file you hand a distributor is
the one you logged.

**Where I looked.** `SB_Rights_v1` (`tools/tools-registers.js:124-150`) holds
agreement *metadata* only — no document, no signatory, no file reference; its
completeness chip at `:143-148` counts rows whose status is not `Executed`,
which measures data entry rather than evidence. `projects/lib-vault.js` is a
different thing despite the name: it snapshots `SB_*` keys into project slots
and `.cinamate` archives (`lib-vault.js:1-10,37-44`), it is not a document
store. `document vault|doc vault` → 0 hits. Only two places in the repo accept
file uploads for storage at all, both images
(`tools/tools-script-ui.js:224-230` EPK stills, `boards/boards.js:405` key-art
background).

**Why a production needs it.** Chain of title is a named delivery item
(`distribution/lib-dist.js:31`, `production/lib-prod.js:159`) and an E&O
prerequisite. A distributor's legal review asks for the documents, not a
spreadsheet asserting they exist. Today an owner ticks "chain" complete with
nothing behind it.

**Attach to.** `clearance/` (it already owns the pre-E&O read and drafts the
releases) or the Rights tab in `tools/`.

**Data model.** New key `SB_ChainDocs_v1`, one row per document, joined to a
`SB_Rights_v1` row by id: `{ id, rightsId, docType, fileName, location,
signedOn, signatories[], sha256, verifiedOn, notes }`. **Do not store the
blobs** — `localStorage` cannot hold a production's executed PDFs and the EPK
already caps itself at 8 stills for this reason
(`tools/tools-script-ui.js:232`). Store the fingerprint instead: hash the file
in-browser with `crypto.subtle.digest` on drop, keep only the digest and where
the file lives. That gives a verifiable manifest at a few hundred bytes a row,
and re-dropping a file later proves it is unchanged. Add a required-document
matrix per rights `kind` (an Option needs the option agreement + the underlying
copyright registration + any extension; a Music sync needs both sync and master)
so the gap list is about missing *documents*, not missing rows.

**Size.** Medium. ~180 lines + UI + tests. The hashing is ~10 lines of
`crypto.subtle` and needs no dependency.

---

### 6. E&O application package · MED-HIGH

**What it is.** The assembled submission an E&O carrier actually asks for, and
a list of what is still missing from it.

**Where I looked.** `clearance/lib-clear.js:97-108` computes
`eoReady: open === 0` — E&O readiness defined purely as "no open script
clearance findings". `tools/tools-registers.js:96-122` has an Insurance
register with `E&O` as a policy *type*. `clearance/index.html:94` shows the
readiness banner. Nothing assembles a package. `title report|title search|title
opinion` → 0 hits, and a title report is a standard E&O prerequisite.

**Why a production needs it.** A carrier wants chain of title, the script
clearance report, a title report, the music cue sheet with licenses, every
talent/location/appearance release, copyright registration and the distribution
agreements. The platform holds or can hold most of that already —
`SB_Rights_v1`, `SB_ClearScan_v1`, `SB_CueSheet_v1`, `SB_Music_v1`,
`SB_Insurance_v1`, `SB_Clearance_v1` — and never composes it. Declaring
`eoReady` on the strength of the script scan alone is optimistic to the point of
being misleading, because the expensive gaps are the paperwork ones.

**Attach to.** `clearance/lib-clear.js` — `eoPackage(sources)` returning
`{ sections:[{name, required, have, missing[]}], gaps[], coverText }`, plus a
carrier cover letter in the same voice as the existing letter generators
(`lib-clear.js:110-147`). Add a `title` row type to the rights register so the
title report has somewhere to live.

**Data model.** No new key — it is a pure read across keys that exist. Feed it
the same way `festivals/lib-fest.js:192-198` reads `SB_Dist_v1`: page reads
localStorage, lib stays pure.

**Size.** Small-medium. ~150 lines, mostly composition. Cheap because the
inputs are already there.

---

### 7. Territory versioning · MED

**What it is.** The film as a set of territory-specific versions rather than one
global artifact.

**Where I looked.** `dubbing|localization|localisation|territory version` → 0
files. `MPAA|rating board|BBFC|FSK|age rating` → 0. Territory exists only on a
*window* (`distribution/lib-dist.js:79-83`) and on a rights row
(`tools/tools-registers.js:135`), never on a deliverable. The checklist is one
global `done` map (`lib-dist.js:53`).

**Why a production needs it.** Sell to six territories and each wants its own
translated title, its own subtitle language master, an M&E for dubbing, a local
classification certificate, sometimes censorship cuts, and local credit or logo
requirements — each with its own delivery status and its own deadline. Today
"delivered to Germany" and "delivered to Japan" are the same tick box, so a
producer juggling several territories tracks it in a spreadsheet and the
platform's delivery percentage becomes fiction. Note the M&E deliverable
already exists (`lib-dist.js:22`) — the platform knows dubbing happens and has
nowhere to record that it did.

**Attach to.** `distribution/lib-dist.js`, hanging off the windows planner
which already carries territory and licensee.

**Data model.** `versions[]` inside `SB_Dist_v1`:
`{ id, territory, titleLocal, languages[], subMasters[], dubStatus,
classification, cuts, creditReqs, done:{}, dueOn }` — a per-version `done` map
reusing the same deliverable ids, so `checklist()` takes an optional version and
the existing global path stays untouched. Additive; no key rename.

**Size.** Medium. ~150 lines plus a territory tab in the UI.

---

### 8. Sales agent terms and market tracking · MED

**What it is.** The agreement with whoever sells the film, and the market
calendar the selling happens at.

**Where I looked.** Buyer contacts are tracked twice
(`festivals/lib-fest.js:168-190`, `tools/tools-registers.js:152-176`, the latter
with `Sales agent` as a contact type) — that part is fine. What does not exist:
any record of the *agent's terms*. `producer/sales-forecast.js:153-154`
hardcodes `AGENT_COMMISSION = 0.15` and `AGENT_EXPENSES = 60000` as constants
with no way for an owner to enter their actual deal, and
`investors/lib-invest.js:45` defaults `salesFeePct` to 15 the same way. Markets:
`AFM` appears once, in a source comment (`sales-forecast.js:99`); `EFM`,
`Marché`, `Ventana Sur`, `Filmart` → 0 hits.

**Why a production needs it.** The sales agent agreement decides whether money
reaches the film: commission tier, expense cap (uncapped market expenses are
where indie money disappears), term length, territories held vs reserved,
holdbacks, and the agent's own delivery obligations. None of it is expressible.
And a market is where the deals happen — which market, who you are meeting,
what materials you brought, what offers came back — a distinct workflow from
the festival submission tracker, currently absent.

**Attach to.** `contracts/` for the agreement (it already owns deal memos and
the commitment flow to the Money Room, `contracts/lib-deal.js:58-66`);
`festivals/` for the market calendar, next to the buyer CRM.

**Data model.** New key `SB_SalesAgent_v1`:
`{ v:1, agent:{ name, company, commissionPct, expenseCap, term, territories[],
reserved[], holdbacks[], deliveryObligations[] },
markets:[{ id, name, city, start, end, attending, materials[], meetings[],
offers[] }] }`. Then `producer/sales-forecast.js` reads the real commission and
cap instead of its constants, and `investors` gets a real `salesFeePct`.
Constraint: market dates drift, so they are user-entered with search links —
the `CFest` directory pattern (`festivals/lib-fest.js:16,87-90`), never
hardcoded.

**Size.** Medium. ~200 lines + page. The forecast wiring is a few lines and
immediately makes two existing modules more honest.

---

### 9. Marketing asset specs and manifest · MED

**What it is.** Key art as the *matrix* platforms require, plus a manifest of
every marketing asset with its metadata.

**Where I looked.** `boards/boards.js:269-...` — key art is a single poster:
one aspect, title / tagline / billing-block text / background, exported as one
PNG one-sheet at a fixed 1600×2400 (`boards.js:410-415`). `SB_KeyArt_v1` holds
`{title, tag, credits, layout, bg}`. `distribution/lib-dist.js:28-30` lists
"Key art (layered + flattened)" and "Unit stills (min 25, captioned)" as
deliverables with nothing behind them.

**Why a production needs it.** A platform delivery wants portrait, landscape,
square, wide banner, a title treatment on transparency and a logo-safe variant,
each at named pixel dimensions; unit stills want caption, photographer credit
and clearance status per image. The generator makes one of the ~six required
crops, and "min 25, captioned" has no place to hold the captions.

**Attach to.** `boards/` — additional canvas render targets from the same
composition (the drawing code at `boards.js:279-310` already parameterises
layout), plus a stills manifest.

**Data model.** Extend `SB_KeyArt_v1` with a `formats[]` array of
`{id, w, h, label, done}`; new `SB_Stills_v1` for the manifest
(`{ id, fileName, caption, photographer, subjects[], cleared, sha256 }`) —
metadata only, same no-blobs reasoning as gap 5.

**Size.** Small-medium. ~120 lines.

---

### 10. Billing block and paid-ad credit obligations · MED (very cheap)

**What it is.** The contractual credit commitments, aggregated.

**Where I looked.** `contracts/lib-deal.js:33` — every cast deal carries a
`credit` field defaulting to "Main titles, single card, position by mutual
agreement", stored per deal in `store.deals` (`lib-deal.js:36-40`) — under the
contested `SB_Deals_v1` key, so this gap is blocked on the shape bug above.
`boards/index.html:72` — a free-text "Billing block"
textarea the user retypes by hand into `SB_KeyArt_v1.credits`.
`distribution/lib-dist.js:35` — "Final credits + paid-ad obligations" is a
delivery item. Nothing connects the three. `billing block` → 1 hit, that
textarea. `paid.ad|credit obligation` → 1 hit, that label.

**Why a production needs it.** Credit obligations are contractual and
litigable: order, size relative to title, single card vs shared, whether the
credit must appear in paid advertising. They are agreed one deal at a time and
then have to be honoured on the poster and in the main titles months later,
usually by someone reading through the deal memos by hand. The data is already
in the platform, structured, and nothing reads it.

**Attach to.** `contracts/lib-deal.js` → `creditObligations(store)` returning
rows sorted by agreed position with paid-ad flags; consumed by `boards/`
(prefill the billing block instead of a blank textarea), by the credit roll
(`tools/tools-media-ui.js:323-350`, currently a plain textarea against
`SB_Credits_v1`), and as a checklist item against the `credits` deliverable.

**Data model.** Additive fields on the existing deal `fields` object:
`creditPosition`, `creditSize`, `paidAds` (bool), `creditType`. No new key.

**Size.** Small. ~80 lines. Best cheap win after gap 3.

---

### 11. Comparable titles and audience definition · LOW-MED

**What it is.** A register of comparable films — what they cost, what they made,
who bought them, where they premiered — and a stated target audience.

**Where I looked.** `comparable` → 0 files. `comps` matches only VFX
compositing (`vfx/lib-vfx.js:18-19`) and `buyoutComps()`
(`producer/sales-forecast.js:175-181`), which returns multiples of *your* budget
rather than any actual title. `audience|demographic|four-quadrant|target market`
→ nothing in a marketing sense; the closest is the rating-widens-audience note
at `sales-forecast.js:55`. `IMDb` → 0.

**Why a production needs it.** Every buyer conversation, festival cover letter
and investor deck opens with comps, and the EPK
(`tools/tools-script-ui.js:202-261`) has no field for them or for who the film
is for.

**Attach to.** `producer/` next to the forecast, or `festivals/` next to the
buyer CRM; surfaced in the EPK.

**Data model.** New key `SB_Comps_v1`: `{ v:1, audience:{primary, secondary,
notes}, titles:[{ id, title, year, budget, gross, buyer, premiere, source,
notes }] }`.

**Constraint that shapes this one.** The brief forbids inventing numbers, and
there is no bundled dataset — so this must be a **user-entered** register with
a required `source` field per row and Google-search links, following
`CFest.searchLink` (`festivals/lib-fest.js:87-90`). Anything that ships
pre-filled box-office figures would be fabricated. That caps its value, which
is why it ranks below the rest.

**Size.** Small. ~90 lines, mostly a `TCore.Register`.

---

### 12. Residuals *reporting* · MED (blocked on gap 1)

**What it is.** Who is owed what, for which period, from which market.

**Where I looked.** `production/lib-prod.js:120-144` gives one lump per guild
from four hand-typed market grosses, rendered at `production/production.js:366`
with an honest disclaimer. `participant|profit particip` → 1 hit, a comment
saying it is not modeled (`production/lib-cast.js:181`). There is no participant
list, no period, no statement.

**Why a production needs it.** Residuals are a per-participant, per-period
obligation that outlives the production company, and the guild wants a report,
not an estimate. The estimator is the right tool for budgeting; it is not a
reporting system and does not claim to be.

**Attach to.** `production/lib-prod.js`, consuming `SB_Receipts_v1` from gap 1.

**Data model.** `SB_Participants_v1`
(`{ id, name, guild, role, basis, pct, floor }`) plus a
`residualsStatement(receipts, participants, period)`.

**Size.** Medium, and it should be built *after* gap 1 — without real receipts
it would just be a second estimator.

---

### 13. Distribution is invisible to the pipeline · MED (structural)

**What it is.** Mission control stops at picture lock.

**Where I looked.** `workflow/workflow.js` builds exactly seven stages —
develop `:39`, breakdown `:56`, budget `:76`, schedule `:97`, generate `:114`,
review `:132`, deliver `:153`. The final "Deliver" stage
(`workflow.js:146-163`) checks four things: captions, credit roll, press kit,
final export. Its `gather()` (`workflow.js:205-220`) reads fifteen `SB_*` keys
and **none** of `SB_Dist_v1`, `SB_Festivals_v1`, `SB_Rights_v1`,
`SB_ClearScan_v1`, `SB_Deals_v1` or `SB_Insurance_v1`. Its hint at `:159` sends
the user to Tools; `workflow/advisor.js:179-180` mentions delivery only via
`SB_Delivery_v1`, the production-side list.

**Why a production needs it.** Six of the modules on my brief — distribution,
festivals, clearance, contracts, screening, investors — represent months of work
after the cut is locked, and the pipeline declares the film "complete 🎬"
(`workflow.js:~236`) once the press kit exists. A producer using mission control
as their map cannot see that the delivery schedule is 4/23, that an E&O gap is
open, or that a festival deadline is eight days out.

**Attach to.** `workflow/workflow.js` — extend `gather()` and add stages after
`deliver`: **Clear** (E&O readiness from `SB_ClearScan_v1` + `SB_Rights_v1`),
**Festival** (submissions pending / accepted, next deadline from
`CFest.upcoming`), **Sell** (pipeline stages from `SB_Deals_v1`), **Deliver to
buyer** (`CDist.checklist` percentage), **Report** (receipts and statements,
once gap 1 exists).

**Data model.** None new — pure composition over existing keys, exactly what
`assess()` already does.

**Size.** Small-medium. ~120 lines. Ships independently and makes every other
gap on this list discoverable, which is why it is here despite adding no new
capability of its own.

---

## Ranked summary

Fix first, before any of it: **the `SB_Deals_v1` shape collision**
(`contracts/index.html:77` vs `tools/tools-registers.js:157`) — it is a live
crash and a data-loss path, not a gap. Details in the section above.

| # | Gap | Rank | Attaches to | New key | Size |
|---|-----|------|-------------|---------|------|
| 3 | Premiere-status conflict detection | HIGH | `festivals/lib-fest.js` | none | S-M |
| 1 | Revenue actuals + statements | HIGH | `investors/` | `SB_Receipts_v1` | M-L |
| 2 | Technical delivery spec matrix | HIGH | `distribution/lib-dist.js` | none* | M |
| 4 | Screener forensic code + expiry | HIGH | `distribution/` | none | S |
| 5 | Chain-of-title document vault | MED-HIGH | `clearance/` or Tools | `SB_ChainDocs_v1` | M |
| 6 | E&O application package | MED-HIGH | `clearance/lib-clear.js` | none | S-M |
| 10 | Billing block / credit obligations | MED | `contracts/lib-deal.js` | none | S |
| 13 | Distribution stages in the pipeline | MED | `workflow/workflow.js` | none | S-M |
| 7 | Territory versioning | MED | `distribution/lib-dist.js` | none | M |
| 8 | Sales agent terms + market calendar | MED | `contracts/`, `festivals/` | `SB_SalesAgent_v1` | M |
| 9 | Marketing asset specs + manifest | MED | `boards/` | `SB_Stills_v1` | S-M |
| 12 | Residuals reporting | MED | `production/lib-prod.js` | `SB_Participants_v1` | M |
| 11 | Comparable titles + audience | LOW-MED | `producer/` or `festivals/` | `SB_Comps_v1` | S |

\* `SB_DistSpec_v1` only if owners define custom buyer profiles.

**Things I checked and found already covered — do not build these:** caption and
subtitle formats (SRT/VTT parse, write and QC, `tools/lib-script.js:51-113`);
press kit / EPK (`tools/tools-script-ui.js:202-261`); music cue sheet
(`production/lib-prod.js:70-103`) and sync/master licensing (`music/lib-music.js`);
chain-of-title *metadata* (`tools/tools-registers.js:124-150`); buyer and
sales-agent contact tracking (twice: `festivals/lib-fest.js:168-190`,
`tools/tools-registers.js:152-176`); festival submission and fee tracking
(twice: `festivals/lib-fest.js:126-165`, `tools/tools-registers.js:68-93`);
insurance/COI register (`tools/tools-registers.js:96-122`); revenue *forecasting*
and territory pre-sale modeling (`producer/sales-forecast.js`); recoupment
waterfall (`investors/lib-invest.js:99-166`); screening notes and cut review
(`screening/lib-screen.js`); residuals *estimation* (`production/lib-prod.js:120-144`).
`CDist` is also already node-tested (`scripts/test_ops.mjs:142-157`) — there is
no test-coverage gap in this domain.

---

## Evidence

Files read in full: `distribution/lib-dist.js` (117 lines),
`distribution/index.html` (162), `festivals/lib-fest.js` (208),
`clearance/lib-clear.js` (153), `screening/lib-screen.js` (107),
`investors/lib-invest.js` (275), `contracts/lib-deal.js` (112),
`tools/lib-script.js` (121), `tools/tools-registers.js` (177),
`tools/tools-script-ui.js` (262), `producer/sales-forecast.js` (359).

Files read in part: `contracts/index.html:77-100`, `tools/tools-core.js:14-22,
60-72,105-115` (the two halves of the `SB_Deals_v1` collision),
`production/lib-prod.js:70-182`,
`festivals/index.html:150-272`, `workflow/workflow.js:120-240`,
`workflow/advisor-ui.js:40-80`, `workflow/advisor.js:175-181`,
`post/lib-post.js:200-262`, `finance/lib-money.js:1-70`,
`tools/lib-money.js:125-175`, `projects/lib-vault.js:1-70`,
`production/production.js:325-350`, `boards/boards.js` (keyart paths),
`music/lib-music.js` (exports), `investors/index.html:74-281`,
`scripts/test_ops.mjs:140-158`, `taxcredit/lib-taxcred.js:135-153`,
`_redirects`, `netlify/functions/gate.js` (no per-module allowlist —
adding a module needs no gate change), `dashboard.html:1531` (module rail).

Enumerations run: all 89 `SB_*` keys in the repo; all `lib-*.js` files
referenced by `scripts/test_*.mjs`; all `href='/module/'` entries in
`dashboard.html`.

Negative searches (0 hits, quoted at the top of this report) are the basis for
gaps 1, 2, 4, 7, 8, 11 and are listed there with the exact patterns used.

No file was modified.
