# Costume Designer, with Hair & Makeup

Read as the department that has to put the right clothes on the right body in the
right state of wear on a day the schedule picked for reasons that have nothing to
do with the story. Verdict up front: **there is a real costume module and it is
better than a stub, but it lives entirely in script order and entirely on one
device. A costume supervisor cannot run continuity from it on a non-linear board,
and nothing it computes reaches the schedule, the call sheet or the budget.**
There is no hair & makeup department in the platform at all.

---

## What exists and works

- `wardrobe/lib-ward.js:59-85` — `charactersFromScript()` walks ALL-CAPS dialogue
  cues with suffix stripping (`V.O.`/`O.S.`/`CONT'D`) and a transition blacklist,
  returning name + scene list + line count. This is the same walk a casting office
  does and it is correct; `scripts/test_wardrobe.mjs:51-60` proves it rejects
  sluglines, lowercase and `CUT TO:`.
- `wardrobe/lib-ward.js:98-109` — `parseSceneNums()` takes `1, 4-6, 12` with range
  expansion, dedupe and sort. Small thing, but it is the difference between typing
  a costume plot and fighting a form.
- `wardrobe/lib-ward.js:161-214` — `changePlot()` produces a genuine
  character × scene grid, plus three derived flags: quick change (adjacent scenes,
  different look), continuity span (same look across a gap → photograph it), and
  conflict (two looks down for one scene). The span flag with its "photograph it"
  note is real department thinking, not decoration.
- `wardrobe/lib-ward.js:219-257` — `sceneHazards()` + `multiplesAdvice()` scan for
  blood/rain/mud/tears/fights/water and recommend 3 multiples for the first hazard
  scene, +1 per further one, capped at 6, with the note explicitly labelled an
  estimate to confirm with stunts/SFX. Honest, and the honesty is tested
  (`scripts/test_wardrobe.mjs:122`).
- `wardrobe/index.html:133-172, 345-371` — continuity photos are downscaled to a
  1024px long edge on canvas, JPEG-encoded and stored in IndexedDB against the
  look, date-stamped. A photo pipeline that does not blow the localStorage quota is
  the right call.
- `wardrobe/lib-ward.js:131-154` — cost rollup splits by buy / rent / build /
  cast-own and rolls up per character. That four-way split is exactly how a costume
  budget is actually broken out.
- `wardrobe/index.html:310-318` — commits the wardrobe total to Money Room account
  **10000**, which really is the Wardrobe account in this platform's chart
  (`producer/budget-sheet.js:24`). The account is right.
- `tools/tools-registers.js:33` — the crew register already offers `Wardrobe` and
  `HMU` as departments, so the people exist in the database even though the work
  does not.
- `workflow/advisor.js:120-121` — the staffing recommender does put a costume
  designer and a hair & makeup unit in the plan, with HMU annotated
  "continuity-critical". The advice is correct; nothing in the platform then
  supports it.
- 44/44 test suites pass (`node scripts/run_all_tests.mjs`), wardrobe at 37 checks.
  Nothing here is broken in the "it throws" sense.

---

## What exists but needs work

### HIGH — the change plot is in script order and the shoot is not
`wardrobe/lib-ward.js:188-200` computes quick changes with
`for (s = 1; s < n; s++)` over **script scene numbers**. A quick change is not a
story-order fact. It is "the actor must come out of change 2 and into change 5
between two setups on the same shooting day." As written the flag is
simultaneously a false positive (scenes 12 and 13 flagged, shot eleven days apart)
and a false negative (scenes 4 and 87 shot back to back on Day 6, silent). The
same applies to `continuitySpans` at `:202-210` — a "gap" in script numbering is
not the gap that matters; the gap that matters is calendar days between the two
shoot days that carry the look.

The fix: the board already holds the mapping. `producer/schedule-board.js:148-179`
`doodMatrix()` walks `sc.day` per scene and per cast member. Add
`changePlotByShootDay(looks, boardScenes)` to `lib-ward.js` that groups looks by
`sc.day` instead of `sc.num`, and re-derive quick changes as *adjacent within a
day* and continuity spans as *same look on non-adjacent shoot days*. That single
function turns the module from a script tool into a production tool.

### HIGH — wardrobe and the stripboard parse sluglines with different regexes
`wardrobe/lib-ward.js:14`:
`/^\s*(?:\d+[\s.]*)?(INT|EXT|INT\/EXT|I\/E)[.\s]/i`
`timeline/timeline-budget.js:282` (what the stripboard uses):
`/^\s*(?:\d+[A-Z]?[.\s-]*)?(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i`

Verified divergence on real headings:

| heading | CWard | SBBudget |
|---|---|---|
| `12A. INT. KITCHEN - DAY` | **no match** | match |
| `101B EXT. FIELD - DAY` | **no match** | match |
| `INT KITCHEN - DAY` | match | **no match** |

A/B scenes are exactly what a revised production draft is full of, and they are
exactly when the costume department needs the plot most. Wardrobe silently drops
them, which does not just lose a scene — it **renumbers every scene after it**, so
a look pinned to "scene 40" now points at the wrong scene. Any future join between
`SB_Wardrobe_v1` and `SB_ScheduleBoard_v1` is wrong before it starts. Fix: have
`wardrobe/index.html:128` read the board's scene list
(`SB_ScheduleBoard_v1.scenes[].num`) as the authority instead of re-parsing, or at
minimum align the two regexes. The same stale copy of the loose regex is also in
`casting/lib-castdesk.js:13` and `props/lib-props.js:120`.

### HIGH — multiples advice is cosmetic; the budget still pays for one
`wardrobe/lib-ward.js:242-257` computes `multiples: 4` for a hero garment that
meets blood and a fight. `wardrobe/index.html:192,208` renders it as a warning
banner and that is the end of it. `lookCost()` (`:125-129`) and `totalsBySource()`
(`:131-142`) sum each piece exactly once. There is no `qty` on a piece at all —
`makePiece()` at `:118-123` has `{item, source, cost}` and nothing else. So the
platform tells the designer to buy four of the shirt and then budgets for one.
Contrast `props/lib-props.js:162-173`, where `qty` genuinely multiplies. Fix: add
`qty` to `makePiece()`, default it from `multiplesAdvice().multiples`, and let the
designer override it — a two-line change to the piece shape plus multiplication in
the two rollups.

### HIGH — signed wardrobe and HMU deal memos post to the Director's account
`contracts/lib-deal.js:14-16` maps `wardrobe: '3000'` and `hmu: '3000'`.
`producer/budget-sheet.js:24-25` says Wardrobe is **10000** and Makeup & Hair is
**11000**. Account 3000 is **Direction**. `toCommitment()` at `:59-66` uses that
map, so every signed costume-crew or key-hair deal memo lands as an open PO against
the director. The wardrobe cost report line can therefore never reconcile: the
purchases arrive on 10000 (from `wardrobe/index.html:315`) and the labour arrives
on 3000. Meanwhile the Direction line shows a phantom overage. This is a two-value
edit and it should be near the top of the fix list.

### HIGH — continuity photos never leave the device
`projects/lib-vault.js:15` sweeps `/^SB_[A-Za-z0-9]+_v\d+$/` out of localStorage,
so `SB_Wardrobe_v1` (the looks, costs, scene numbers) does back up and sync. But
the photos live in IndexedDB (`cinamate_wardrobe`, `wardrobe/index.html:133-143`)
and `lib-vault.js` contains no IndexedDB code whatsoever. The single most valuable
artefact the department produces — the continuity still that settles the argument
in week five — is device-local, invisible to the vault, and gone the moment the
browser clears site data. Either export the IndexedDB store into the vault
payload as base64 (with a size cap and a "photos not synced" badge when over), or
be loud in the UI that these are local-only. Right now `wardrobe/index.html:102`
says "kept in this browser" in 11px dim grey and that is the whole warning.

### MED — the change plot cannot leave the browser
`wardrobe/index.html` has **no export, no CSV, no print path** — grepped and
confirmed. Props ships an RFQ generator with copy and mailto
(`props/index.html:118-121, 386-401`, `props/lib-props.js:328-343`). A costume plot
that cannot be printed for the truck, mailed to the designer, or handed to the
supervisor as a PDF is a plot that does not exist. This module is the only
department tool in the platform with no way out. Add a CSV of the grid (using the
`csvCell` formula-injection guard already written at `production/lib-prod.js:86-95`)
and a print stylesheet mirroring `producer/schedule-board.js:338-343`'s
`cs-printing` approach.

### MED — "Commit total to Money Room" double-commits on a second click
`wardrobe/index.html:310-318` calls `CMoney.addPO()` unconditionally, and
`finance/lib-money.js:23-32` always pushes a new PO. Click twice and the whole
wardrobe budget is committed twice, inflating the Committed column and therefore
EFC in the cost report. Store the returned `po.id` on `st` and update in place, or
at least confirm when a wardrobe PO already exists.

### MED — piece costs have no estimate/actual split and never learn
A piece has one number (`lib-ward.js:118-123`). There is nowhere to record what the
quote actually came back at. Props does both: `priceItem()` applies a learned
per-category multiplier from `CLearn.calibration('props:'+cat)`
(`props/lib-props.js:187-195`) and `recordQuote()` feeds real actuals back
(`:208-216`). Wardrobe touches `CLearn` nowhere. Same pattern, same effort — add
`actual` to the piece and a `recordQuote`-equivalent keyed `wardrobe:<source>`.

### MED — the wardrobe budget line is a percentage and ignores the costume plot
`js/budget-engine.js:683-684` (mirrored in `timeline/timeline-budget.js:698-699`):

```js
btl['10000 · Wardrobe']       = addR(laborPct(0.05), [art[0]*0.30, art[1]*0.30]);
btl['11000 · Makeup & hair']  = addR(laborPct(0.04), [art[0]*0.15, art[1]*0.15]);
```

5% of crew labour plus 30% of an art-per-day allowance. Nothing in that expression
knows how many characters, how many changes, how many periods, how many multiples,
or whether anyone is in prosthetics. A 9-change period lead and a one-look
contemporary two-hander produce the same wardrobe number. Meanwhile
`boardOverridesModel()` at `producer/schedule-board.js:116-143` already proves the
pattern for feeding real counts back into the estimate — it does exactly this for
stunt / pyro / water / animal days from breakdown tags. A `wardrobeOverrides`
carrying `{characters, looks, changes, multiples, periodFlag}` would slot into the
same mechanism.

### MED — the hazard lexicon is too short and is disconnected from the tags that already exist
`wardrobe/lib-ward.js:219-226` covers blood, rain, mud, tear, fight, water. Missing
and routinely costume-destroying: **fire/burn** (and the flame-retardant treatment
that goes with it), snow/ice, food and eating, vomit, paint, sweat, oil/grease,
chocolate. Worse, this list is a third independent regex bank — `safety/lib-safety.js:14-86`
has eleven hazards including `fire`, and `producer/schedule-board.js:39-40` has
per-scene `stunts/sfx/vfx/water/animals/vehicles` tags the AD has already ticked by
hand. A scene the AD tagged **STUNTS** on the board raises no multiples in wardrobe.
Read `sc.tags` as a hazard source alongside the regex.

### MED — look names are unstable, and there is no change number
`wardrobe/index.html:220-224` names a new look `'Look ' + (count for that character + 1)`.
Delete Look 2 of 3 and the next look you add is also called "Look 3". The
continuity register (`production/production.js:168`) then references wardrobe as
free text, so "TOM Look 3" can point at two different garments. A costume plot runs
on **change numbers** that are stable and never reused. Add a monotonic
`changeNo` on the look, allocated once and never recomputed, and render it as
`TOM Ch.3` everywhere.

### MED — the continuity register is six free-text columns with no join
`production/production.js:157-174` is one `Register` with
`scene / setup / circled / direction / wardrobe / notes` and a single **"Wardrobe / props"**
column. No look id, no change number, no photo, no dropdown of the looks that exist
two modules away in `SB_Wardrobe_v1`. The script supervisor and the costume
supervisor are typing the same garment into two systems in two vocabularies. Make
the wardrobe cell a select populated from the wardrobe looks and store the look id.

### MED — `SB_Wardrobe_v1` has exactly one reader
Grepped: the key appears in `wardrobe/index.html:116` and **nowhere else in the
repository**. Not the call sheet, not the DPR (`production/lib-prod.js:21-47`), not
the phone call sheet (`today/index.html`), not the workflow advisor, not the budget.
The costume plot is a leaf node. Every integration named in this report is
downstream of somebody deciding this key is a public interface.

### LOW — a scene cannot hold two changes for one character
`wardrobe/lib-ward.js:183` flags any character with two looks in one scene as a
**conflict** telling you to "pick one". But "SC 42 — pre-fight suit / post-fight
suit, wrecked" is an ordinary scene, not a mistake. Add an explicit ordered
`within-scene` sequence so a legitimate mid-scene change is expressible, and keep
the conflict flag for the genuinely ambiguous case.

### LOW — the `wardrobe-props` agent has no wardrobe prompt
`agents/client.js:58` sells a "Wardrobe & Props" agent at 15 credits. It has no
entry in the prompt map at `netlify/functions/agent-invoke.js:21-40`, so it falls
through to the generic `base + ' Provide expert analysis for this production element.'`
at `:42`. Either write it a costume prompt or stop charging for it. (There is no
hair or makeup agent anywhere in the 52-agent roster.)

### LOW — two disconnected wardrobe data models
`app.html:5365-5403` has a per-character wardrobe spec —
`{top, bottom, footwear, outerwear, accessory}` from gender-aware option lists —
used to anchor AI image and video generation, with `wardrobe_default` pulled from
enrichment at `app.html:4020-4023`. That is a costume description the designer would
want as a starting point for a look, and conversely a locked look is exactly the
anchor the generator wants. Neither reads the other. A one-way seed (bible → look
pieces) is cheap and immediately useful.

### LOW — `timeline/timeline-continuity.js` is not costume continuity
Worth stating plainly because the filename invites the mistake. Its `applyGraph()`
(`:122-214`) builds location/time blocks and carries *cast presence* across
generated clips; `enrichPromptWithContinuity()` (`:362-381`) writes the word
"wardrobe" into an AI prompt string. It is prompt coherence for generated video. It
has no relationship to garment continuity and should not be counted as coverage.

---

## What is missing entirely

### 1. Story days — the primitive the whole department runs on. **Value: critical**
Grepped for `story day` / `script day` / `storyDay` / `scriptDay` across the repo:
**zero hits.** Costume continuity is not organised by scene, it is organised by
story day. Every scene on Story Day 3 must match, wherever those scenes land on the
board; the moment the script crosses to Day 4 the department is free. Without it,
"does this shirt match" is unanswerable and the change plot is guesswork. Attach a
`storyDay` field to the scene record in `producer/schedule-board.js:76-87`
(alongside the existing `dn: day|night`), seed it from `DAY`/`NIGHT`/`CONTINUOUS`/
`LATER` in the slugline the way `timeline/timeline-continuity.js:14-20` already
classifies headings, and let the user correct it. Then key looks to story days
rather than raw scene lists. Everything else in this section becomes easy once this
exists. Perhaps a day of work; the highest-leverage single field in the platform for
this department.

### 2. HMU as a department — it does not exist. **Value: critical**
There are 28 modules and none of them is hair & makeup. No look book, no
application-time estimate, no wig plot, no prosthetics schedule, no HMU continuity
photos, no chair count. `js/budget-engine.js:684` has an account for it and
`workflow/advisor.js:121` staffs it "continuity-critical", and that is the entire
representation. What is needed is small and specific:
- an HMU look per character per story day (base / hair / effects makeup / wig id);
- an **application-time estimate in minutes** on each look, and a removal time;
- a chair count so N actors in 90-minute prosthetics against 2 chairs computes a
  real earliest crew call.
That last number is the one the 1st AD needs and nothing in the platform can
currently produce it. Attach to `wardrobe/` as a second tab (it is already the
"looks" module and the data shape is the same) or a sibling `hmu/` with
`lib-hmu.js`. Roughly the size of the existing wardrobe module.

### 3. HMU and costume call times on the call sheet. **Value: critical**
`producer/schedule-board.js:303` — `dayMeta = {call, date, notes}`. One general
call for the whole company. The cast table at `:308-310` shows the DOOD code
(SW/W/H/WF) and nothing else. `today/index.html:116` renders that single
`meta.call` as the big number on the phone. A real call sheet carries three times
per performer — **MU/H**, **wardrobe**, **on set** — derived backwards from the
first shot: on-set minus travel minus wardrobe minus HMU application. That
derivation is arithmetic once item 2 gives you the minutes and item 1 gives you the
story day. Without it the department's entire workload is invisible to the schedule
and the makeup trailer finds out at 5am. Extend `dayMeta` with a per-cast call
object and render it in the call sheet table and in `today/`. Cheap, immediate,
high impact.

### 4. A fitting calendar. **Value: high**
`casting/lib-castdesk.js:152` promises "plus customary fittings" in the offer memo
boilerplate; `casting/index.html:82` tracks hold-from and hold-to and nothing else.
There is no fitting date, no measurement sheet, no alteration turnaround. The only
sizing anywhere in the platform is one free-text `sizes` string on the *look*
(`wardrobe/lib-ward.js:115`) — sizing is a property of the **actor**, not the
garment, and it belongs where the actor is. SAG fitting days are also a paid
obligation that `contracts/lib-deal.js:54-57` `dealValue()` does not count. Add a
measurement record on the candidate/role, a fitting date with a status, and a
prep-gate warning when a booked actor has a look and no fitting. Attaches to
`casting/`, feeds `wardrobe/`.

### 5. Laundry, turnaround and the doubles ledger. **Value: high**
Grepped: no `laundry`, no `turnaround` in any costume sense. A multiples count of 4
is a plan only if you also know which of the four is on the actor, which is in the
wash, which is being re-aged and which is the clean spare, and whether the wash can
be back before the next day that look works. With story days (item 1) and shoot-day
mapping the calculation is: for each look, list the shoot days it works; if two
consecutive days both need the wrecked state and there is one hero unit, flag it.
That is the single warning that saves a day. Attaches to `wardrobe/`, small once
items 1 and 3 land.

### 6. Continuity photo capture that is actually usable on set. **Value: high**
The photo store exists but the metadata is one field — `date` at
`wardrobe/index.html:359`. A continuity still needs: scene, setup, take, story day,
change number, and which of front/back/detail it is. And it needs to be *found* —
right now `renderPhotos()` (`:326-344`) dumps every photo for every look into one
flat wall with no filter and no search. On set the question is always "show me
MAGGIE Ch.3 on Story Day 2, back view" and there is no way to ask it. Extend the
IndexedDB record shape, add filters, and add a per-look photo strip on the look
card itself.

### 7. Aging, distressing and breakdown as scheduled work. **Value: medium-high**
`wardrobe/index.html:206` offers a free-text notes box placeholdered
"Notes — aging, dye, doubles…". That is the entirety of it. Breakdown is *labour
with a lead time* — dye, sand, shred, blood, re-age between takes — and it has to
happen before the day the garment works, not on it. Model it as a task with a
target date derived from the earliest shoot day the look works, a state
(clean → light → heavy → destroyed) per multiple, and a warning when the lead time
does not fit. Attaches to `wardrobe/`.

### 8. Costume sourcing — a directory that is currently sitting in Props. **Value: medium**
`props/lib-props.js:224` lists **Malabar** ("Period costumes & accessories") inside
the *prop house* directory, and the OpenStreetMap query at `:294` already searches
`shop~"props|theatrical|costume"`. So the platform knows about costume houses; it
just files them under the wrong department. Wardrobe has no sourcing, no rent-vs-buy
rule (props has one at `:177-181`), and no RFQ. Lift `HUBS`, `housesFor()`,
`mergeHouses()` and `rfq()` into a shared shape and give wardrobe a costume-house
directory and a quote request. Mostly reuse.

### 9. Prosthetics and skin-contact safety. **Value: medium**
`safety/lib-safety.js:14-86` has eleven hazards. None of them covers adhesives,
removers, solvents, contact lenses, blood in eyes or mouth, prosthetic wear-time
limits, or flame-retardant treatment of a costume worn near the `fire` hazard that
module already detects. HMU is a chemical department working on faces, and it is
absent from the risk assessment (`:126-145`) and from the safety meeting checklist
(`:147-163`) that `today/index.html:109-112` prints on the phone every morning.
Add the hazard entries; they are data, not code.

### 10. A wardrobe/HMU prep gate in the advisor. **Value: medium**
`workflow/advisor.js:140-184` `prepActions()` gates casting, crew, locations,
permits, insurance, clearance and delivery. It says nothing about costume or HMU.
The three warnings worth adding, all computable from data that already exists:
booked cast with a look and no fitting; looks with scenes but no priced pieces; a
hazard look sitting on `multiples: 1`. Four lines each, in the same `act()` idiom.

### 11. Budget detail lines that match how the department actually spends. **Value: medium**
`producer/budget-sheet.js:24-25` gives Wardrobe two starter items ("Costume
designer & crew", "Purchases & rentals") and HMU two ("HMU crew", "Supplies").
Missing from Wardrobe: multiples/doubles, aging & breakdown, alterations, fittings,
laundry & dry cleaning, loss & damage, cleaning deposits, truck/trailer, kit fees.
Missing from HMU: wigs, prosthetics, contact lenses, HMU trailer, kit rentals. The
`kitFee` field does at least exist on deal memos (`contracts/lib-deal.js:27,82`).
Pure data edit to `DEFAULT_CATEGORIES`.

---

## Direct answers to the three questions asked

**Could a costume supervisor run continuity across a non-linear shooting order from
this?** No. The change plot is computed entirely in script-scene space
(`wardrobe/lib-ward.js:161-214`), `SB_Wardrobe_v1` is never joined to
`SB_ScheduleBoard_v1` (single reader, `wardrobe/index.html:116`), there is no story
day anywhere in the repository, and the two modules do not even agree on what
counts as a scene (`lib-ward.js:14` vs `timeline-budget.js:282`, diverging on A/B
scenes). The quick-change flag as written describes the story, not the shoot.

**Does anything connect costume change count to the schedule and the budget?**
Nothing to the schedule at all. To the budget, one thing and only one: the manual
"Commit total to Money Room" button at `wardrobe/index.html:310-318`, which posts
one lump PO to account 10000, double-commits on a second click, and ignores the
multiples the same page just recommended. The estimator's own wardrobe line
(`js/budget-engine.js:683`) is a fixed percentage of crew labour and has never
heard of a change.

**What is missing?** The costume plot grid exists and is decent; stable change
numbers, multiples tracking that reaches money, fitting calendars, HMU look books,
application-time estimates that feed the call sheet, prosthetics scheduling, and
usable continuity photo capture are all absent — enumerated above with attachment
points and rough size.

---

## Evidence

Files read in full: `wardrobe/lib-ward.js` (275 lines), `wardrobe/index.html`
(389), `production/lib-prod.js` (182), `casting/lib-castdesk.js` (192),
`props/lib-props.js` (355), `timeline/timeline-continuity.js` (392),
`scripts/test_wardrobe.mjs` (139).

Files read in relevant part: `production/production.js:1-200`,
`producer/schedule-board.js:1-380`, `producer/budget-sheet.js:1-60`,
`js/budget-engine.js:630-740`, `timeline/timeline-budget.js:276-323`,
`contracts/lib-deal.js:1-88`, `finance/lib-money.js:1-140`,
`safety/lib-safety.js:14-86`, `today/index.html:55-153`,
`tools/tools-registers.js:1-65`, `workflow/advisor.js:95-193`,
`projects/lib-vault.js` (SB key sweep), `agents/client.js:25-66`,
`netlify/functions/agent-invoke.js:15-56`, `app.html:4001-4023, 5316-5403`,
`casting/index.html:79-282`.

Claims verified by execution, not by reading:
- `node scripts/run_all_tests.mjs` → **44/44 suites passed**, `wardrobe: 37 passed, 0 failed`.
- The two slugline regexes were run against six real headings in Node; the
  divergence table above is that output verbatim.
- `grep -rn "SB_Wardrobe_v1"` across the repo → one hit, `wardrobe/index.html:116`.
- `grep -rniE "story ?day|script ?day|storyDay|scriptDay"` → zero hits.
- `grep -rn "indexedDB"` in `projects/lib-vault.js` / `projects/index.html` → zero hits;
  `indexedDB.open` users are only `editor/cut-ui.js`, `locations/index.html`,
  `wardrobe/index.html`.
- `grep -niE "export|csv|print"` in `wardrobe/index.html` → zero hits.
- `grep -rn "CLearn"` → wardrobe absent; props at `lib-props.js:187,189,209,213`.

No file was modified. Nothing above is asserted without a line number behind it.
