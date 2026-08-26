# Team A Dev 15 — what is missing: art, props and costume departments

Scope as assigned: art department (`sets/`), props (`props/`), costume (`wardrobe/`),
plus HMU, greens, picture vehicles, continuity capture, asset control and the
department budget rollup.

**Where I looked before claiming anything is missing.** Full-text search across
`*.js` / `*.html` (excluding `node_modules`, `static/vendor`) for: elevation,
section, paint, finish schedule, set dec/setdec, swatch, costume plot, change
number, fitting, HMU, hair, makeup, look book/lookbook, continuity, check-in,
checkout, damage, greens, picture vehicle, loss, purchase order, petty cash,
receipt, barcode, inventory, asset tag, return date, wrap out, strike, distress,
aging, dye, sew, tailor, alteration, prosthetic, wig, beard, vendor, supplier,
calendar, flame, retardant, fire marshal. I also enumerated every `SB_*` key in
the repo (78 of them) — there is no `SB_HMU_*`, `SB_SetDec_*`, `SB_Fitting_*`,
`SB_AssetLog_*` or `SB_Scenes_*`.

**On duplication.** `docs/audit/crew-07-production-design.md`,
`crew-08-props.md` and `crew-09-costume-hmu.md` already claim 43 missing items
across this domain — construction drawings, elevations/sections, wild walls,
paint & finish schedule, set-dressing list, build/strike schedule, stage fit,
swing sets, north arrow, drawing register, greens plan, the daily pull list,
check-in/out and L&D, per-prop continuity photos, multiples, picture-vehicle log,
weapons register, story days, HMU as a department, MU/W call times, fitting
calendar, laundry ledger, aging/distressing, prosthetics safety, and department
budget lines. **I have not restated any of those.** Everything below is either
(a) a gap none of the three named, or (b) a correction to one of them, because
each of those reports looked at one department and the break is at the seam.

---

## What exists and works

- `wardrobe/lib-ward.js:161-214` — `changePlot()` is the real thing: a
  character × scene wear grid, with quick changes detected across adjacent
  scenes, continuity spans flagged when a look returns after a gap, and
  same-scene conflicts. Verified by running it. Do not rebuild this.
- `wardrobe/lib-ward.js:242-257` — `multiplesAdvice()` reads blood/rain/mud/
  tear/fight/water out of the script and sizes doubles at 3 for the first hazard
  scene, +1 per further one, capped at 6, and says out loud that it is an
  estimate to confirm with stunts/SFX. Honest and correct.
- `props/lib-props.js:163-181` — the 10%-of-replacement weekly rule with a 75%
  long-run discount and a buy-vs-rent break-even at 60% of purchase. Priced
  the way a prop master actually reasons.
- `props/lib-props.js:34-94` — every prop carries real w/d/h in feet with
  per-category defaults, and `fitsThrough()` tries all six orientations against
  a door opening. This is the detail that stops a truck arriving with something
  that will not fit the stage door.
- `props/lib-props.js:70-81` + `props/index.html:215-234` — a prop can be
  pushed onto the active set plan at its true size, carrying `propId` so the two
  records stay tied. The plumbing between props and sets exists.
- `sets/lib-set3d.js:368-393` — `cameraView()`/`lensFov()` project the real
  Super-35 aperture through the lens on the plan. A general 3D modeller cannot
  do this. Genuinely differentiated.
- `sets/lib-set3d.js:399-442` — OBJ and STL export, name-slugged so a newline
  in a set name cannot inject geometry. Careful work.
- `props/lib-props.js:221-277` — the prop-house directory carries no invented
  phone numbers; numbers come only from OSM, the bridge, or the user. Follows
  the brief's rule exactly.

## What exists but needs work

- **`props/lib-props.js:120` and `wardrobe/lib-ward.js:14` — the slugline regex
  is a regression against `js/budget-engine.js:279`, and it silently corrupts
  every scene number both modules produce. HIGH.**
  The canonical one is `/^\s*(?:\d+[A-Z]?[.\s-]*)?(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i`.
  Props and wardrobe both use `/^\s*(?:\d+[\s.]*)?(INT|EXT|INT\/EXT|I\/E)[.\s]/i`
  — no `[A-Z]?`. An A-scene is therefore not recognised as a scene at all and its
  contents are folded into the scene above it. Separately, both build a preamble
  scene (`props/lib-props.js:118`, `wardrobe/lib-ward.js:25`) which is dropped by
  the trailing filter but has already incremented `scenes.length`, so numbering
  starts at 2 for any script beginning with a blank line. I ran all three parsers
  over the same six-scene fixture:

  | slugline | stripboard (`SBBudget.splitScenes`) | props / wardrobe |
  |---|---|---|
  | `1 INT. KITCHEN - DAY` | 1 | 2 |
  | `2 EXT. STREET - NIGHT` | 2 | 3 |
  | `4 INT. BAR - NIGHT` | 3 | 4 |
  | `4A INT. BAR BACK ROOM - NIGHT` | 4 | *(swallowed into 4)* |
  | `5 INT. LOFT - DAY` | 5 | 5 |

  `CProps.breakdown()` reported the piano that is really in 4A as being in
  "scene 4", and the revolver that is really in scene 1 as "scene 2". Fix the
  regex and drop the preamble scene before numbering. That is a ten-line change
  and it is a prerequisite for the next item and for crew-08's pull list.
- **`producer/schedule-board.js:311-324` — the call sheet has no wardrobe,
  props or HMU block. MED-HIGH.** Scenes, cast codes, locations, notes; nothing
  else. crew-09 asks for per-performer MU/W call *times*; separately the sheet
  needs the department blocks themselves — today's costume changes, the props
  on the truck, special HMU. Cheap once scene identity is fixed.
- **`props/index.html:226` — every prop placed on a set lands at the exact
  centre of the plan.** `toSetItem(it, plan.w/2, plan.h/2)` with no offset, so
  N props stack in one spot and have to be dragged apart by hand. LOW, but a
  spiral or grid placement is four lines.
- **`tools/tools-media-ui.js:413,475` stores moodboard images as full
  `readAsDataURL` strings inside `SB_Moodboard_v1` in localStorage, while
  `wardrobe/index.html:133-172` stores its photos in IndexedDB. MED.** Two
  incompatible image strategies in one platform. The localStorage one shares the
  ~5 MB origin quota with every other `SB_*` key, so a designer building a real
  reference board can silently break saves everywhere else — every `save()` in
  these modules is a bare `try{}catch(e){}` (e.g. `wardrobe/index.html:126`,
  `props/index.html:143`) so a quota failure is invisible.
- **`wardrobe/index.html:358-360` — the continuity photo record is
  `{id, lookId, dataUrl, date}` and `date` is the upload date, not the shoot
  date.** No scene, no story day, no take, no angle (front / back / detail /
  pocket contents), no note. crew-09 asks for on-set usability; the specific
  minimum record is `{scene, storyDay, day, take, angle, note, shotDate}`.

## What is missing entirely

### 1. A canonical scene register — `SB_Scenes_v1`. **Value: highest in this report**

There is no shared scene identity anywhere in the platform. Five separate
parsers each split the script and each invent their own numbering:
`js/budget-engine.js:282` (feeds the stripboard, DOOD, call sheet and budget
seed), `props/lib-props.js:116`, `wardrobe/lib-ward.js:23`,
`timeline/timeline-continuity.js:50`, and `netlify/functions/parse-script.js`.
**Every one of them discards the scene number written in the slugline** — the
regexes match `(?:\d+...)?` and then throw the capture away — and renumbers
1..N. Proven above: for the same script the stripboard calls a scene 3 while
props calls it 4, and scene 4A does not exist in props or wardrobe at all.

This is the reason crew-08's "the pull list is a join and a print stylesheet"
is not true today: `props.scenes` → `board.scenes[].num` → `sc.day` is a join on
two different numbering systems, and it will produce a truck manifest for the
wrong day. The same break sits under the costume change plot, the greens plan,
the set-dressing list and every art-department report anyone proposes to build.

- **Attach to:** a new `js/lib-scenes.js` (pure, node-testable, `scripts/test_scenes.mjs`),
  written once and consumed by budget-engine, props, wardrobe, timeline.
- **Data model:** `{ id, num, sortKey, slug, intExt, setName, timeOfDay, storyDay, pages8, charIndex }`
  where `num` is the **screenplay's own** number as written (`"4A"`, `"18"`,
  `"OMITTED"`) and `sortKey` is a sortable tuple `[4, "A"]`. `id` is stable
  across re-parses so a look, a prop or a dressing note keyed to a scene
  survives a script revision.
- **`SB_*` key:** `SB_Scenes_v1`.
- **Size:** one to two days for the library plus tests, then a mechanical
  swap in each consumer. Nothing in the current data needs renaming — the
  existing `scenes: [n]` arrays keep working while `sceneIds` is added
  alongside.
- This also delivers crew-09's item 1 (story days) for free, since `storyDay`
  belongs on this record and nowhere else.

### 2. Continuity photos are outside the vault, outside the cloud, and leak across projects. **Value: highest**

The one irreplaceable artefact the costume department produces — the
continuity photo — is the only production data in the platform that is not
backed up, not portable and not project-scoped.

- `wardrobe/index.html:133` puts the JPEGs in IndexedDB database
  `cinamate_wardrobe`, store `photos`.
- `projects/lib-vault.js:15,26-40` snapshots **only** keys matching
  `/^SB_[A-Za-z0-9]+_v\d+$/` from `localStorage`. IndexedDB is never read.
- `netlify/functions/projects-sync.js:227` rejects anything that is not an
  `SB_*` localStorage key, so the photos never reach the cloud either.
- `projects/lib-vault.js:170-172` — switching projects calls `writeStores()`,
  which does `allKeys(store).forEach(removeItem)` and then writes the incoming
  snapshot. `SB_Wardrobe_v1` (which holds `photoIds`) is replaced; the IndexedDB
  blobs from the previous production are left in place.

Consequences, all three real: (a) the photos exist on exactly one browser on one
machine and are gone if that profile is cleared — the department's legal
matching record, lost; (b) after a project switch the new project's look ids
never match the old photo ids, so photos silently vanish from the UI; (c) the
orphaned blobs are never garbage-collected, because the only delete path is
`wardrobe/index.html:250,374` (deleting a look or a photo by hand), so IndexedDB
grows without bound across productions.

- **Attach to:** `projects/lib-vault.js` and `netlify/functions/projects-sync.js`.
- **Build:** give the vault a binary sidecar — an `assets` section in the
  archive holding `{id, mime, bytes}` records, an `idbSnapshot()`/`idbRestore()`
  pair in the page script (the engine stays DOM-free by taking the store map as
  an argument, same shape as `allKeys`), and a size ceiling with an explicit
  "photos not included, N MB over limit" message rather than silence. Cloud
  sync needs a separate blob path or a documented "photos are device-local"
  banner — either is acceptable, the current silence is not.
- **Size:** medium — two to three days, and it fixes the same problem for the
  props, HMU and set-reference photo stores that items 3-5 below will create.

### 3. No module can write to the top sheet — the department rollup has no wire, not just no data. **Value: high**

crew-07 item 5 asks for an art-department rollup into account 9000. The deeper
fact is that **the top sheet is write-only from one place**. `SB_BudgetSheet_v1`
is read by eight modules — `investors/index.html:239`, `dashboard.html:2176`,
`finance/index.html:104`, `producer/sales-forecast.js:329`,
`producer/incentives.js:89`, `tools/tools-money-ui.js:130`,
`workflow/workflow.js:203`, `workflow/advisor-ui.js:28` — and written by exactly
one, `producer/budget-sheet.js:11`. That module seeds only from `SB_Budget_v1`
(the script estimator, `:334`) and `SB_Money_v1` (`:259`). It has never heard of
`SB_Props_v1`, `SB_Wardrobe_v1` or `SB_SetDesign_v1`.

So `CProps.estimate()` computes a complete props budget with armorer days and
contingency (`props/lib-props.js:197-206`), `CWard.totalsBySource()` computes
costume spend split buy/rent/build/cast-own (`wardrobe/lib-ward.js:131-142`),
and **both numbers are invisible to the investor pack, the incentive
calculator, the sales forecast, the money room, the workflow advisor and the
dashboard.** What those eight modules see instead is the tier allowance at
`js/budget-engine.js:682-684`, which derives art / wardrobe / HMU as flat 55% /
30% / 15% splits of a single "art" line — a guess, standing in front of two real
priced lists.

- **Attach to:** `producer/budget-sheet.js`, as a second seeding source
  alongside `seedFromEstimator`.
- **Build:** a `contributions` array on the sheet — `{source, acct, desc, est, locked}`
  — and a `pull()` that reads the department keys and refreshes the rows it owns
  without touching hand-entered lines. Props → 9000, wardrobe → 10000, HMU →
  11000, set construction → 9000 sub-accounts.
- **`SB_*` key:** none new; extend the existing `SB_BudgetSheet_v1` shape
  additively (`categories[].items[].source`).
- **Size:** small-to-medium — half a day for the mechanism, and it is the
  single change that makes every other art-department costing item in this
  audit worth building.

### 4. The AI generation side has its own wardrobe, and it is one outfit per film. **Value: high — and unique to this platform**

`app.html:5316-5393` defines a Character Bible with
`wardrobe: {top, bottom, footwear, outerwear, accessory}` picked from
gender-aware dropdowns (`app.html:5368-5389`), and `app.html:5446-5453` folds
those five words into the image-generation prompt as `"Wearing …"`. That is
**one costume per character for the entire film**, chosen from about forty fixed
options, with no scene awareness at all.

Meanwhile `SB_Wardrobe_v1` holds the real per-scene change plot, with piece
lists, sources and costs. The two never meet: grepped, `SB_Wardrobe_v1` is read
by `wardrobe/index.html:116` and nothing else in the repo.

For a platform whose stated arc is development → distribution with AI previz in
the middle, this means every generated frame, every previz shot and every
dailies proxy shows the character in the wrong clothes the moment the script
calls a change — and the costume designer's actual work has no route into the
imagery that the investors and the director will look at. The same disconnect
exists for sets: `SB_SetDesign_v1` plans reach `dashboard.html:2194` as a count
and `props/index.html:219` for placement, and never inform
`netlify/functions/enrich-locations.js`, which prompts an LLM to invent a
production-design description from scratch.

- **Attach to:** `app.html` character-bible prompt builder (`:5446`), reading
  through the scene register from item 1.
- **Build:** resolve `(character, sceneId) → look` from `SB_Wardrobe_v1`, render
  the look's `pieces[].item` strings into the prompt in place of the dropdown
  words, and fall back to the dropdowns when no look covers that scene. Keep
  the dropdowns — they are the right thing for a character with no costume work
  yet. Add a `lookId` stamp on each generated clip so a re-generation after a
  costume change is detectable.
- **Size:** small — the join is the work, and item 1 supplies it. Very high
  value per hour.

### 5. Asset control across all three departments, including recovery at wrap. **Value: high**

crew-08 item 2 asks for props check-in/check-out and L&D. Two things it does
not cover, and one correction:

- **It is not a props problem, it is a department problem.** Costumes are
  rented and hired too (`wardrobe/lib-ward.js:15` has `rent` as a first-class
  source), set dressing is rented, picture vehicles are rented. One ledger
  should serve all three, keyed by department, or three modules will grow three
  incompatible ones.
- **Nothing settles the resale assumption.** `props/lib-props.js:176` decides
  buy-vs-rent on the premise of "~40% resale/asset recovery at wrap", and there
  is no record anywhere of what was bought, therefore what is owned, therefore
  what was actually recovered. The buy decision is made on a number the platform
  can never check. `js/learn.js` already exists to calibrate estimates against
  actuals and `props/lib-props.js:208-216 recordQuote()` already feeds it —
  recovery is the same shape and would feed the same loop.
- **Fire-marshal certification does not exist.** Grepped `flame`, `retardant`,
  `fireproof`, `fire marshal` — zero hits outside `static/vendor/pdf.worker.min.js`.
  Every soft good and every piece of construction lumber on a stage needs a
  flame-retardancy treatment record, and the fire marshal asks for it before the
  stage is signed off. `safety/lib-safety.js` carries hazard controls but has
  nothing on materials. MED on its own; free if it rides on the asset record.

- **Attach to:** a shared `js/lib-assets.js`, surfaced as a tab in each of
  `props/`, `wardrobe/`, `sets/`.
- **Data model:** `{id, dept, refId, refKey, vendor, source, out, dueBack, in, status, replacementValue, condition, ftTreated, ftCert, note}`
  with `status ∈ ordered | out | on-set | returned | lost | damaged | purchased`.
  `refKey`/`refId` point back at the props item, the costume look or the set item
  so nothing is re-keyed.
- **`SB_*` key:** `SB_Assets_v1`.
- **Size:** medium — two days for the engine, tests and one UI, then the other
  two tabs are near-free. Settlement posts to `finance/lib-money.js:23 addPO`.

### 6. A single per-scene breakdown record — the coloured-tag breakdown sheet. **Value: high**

The breakdown page is the one document every department in this report works
from, and it is the only industry-standard art-department document with no
representation at all. Today the script is broken down **five separate times**
by five parsers that share no output: props terms (`props/lib-props.js:97-113`),
characters (`wardrobe/lib-ward.js:59`), stripboard tags — stunts/sfx/vfx/water/
animals/vehicles (`producer/schedule-board.js:38`), safety hazards
(`safety/lib-safety.js:47+`) and budget drivers (`js/budget-engine.js`). There
is no scene record on which "this scene needs: these props, this dressing, this
wardrobe, this makeup, these greens, this vehicle" is written down together, and
so no way to print the page a production meeting is run from.

Once item 1 exists, this is a view plus an editable overlay rather than a sixth
parser: each department writes its tags onto the shared scene record, and the
breakdown page reads them. Note this is also where the set-dressing list
(crew-07 item 4) and the pull list (crew-08 item 1) both live, so building it
once retires two other asks.

- **Attach to:** `production/` (which already hosts the script-supervisor
  registers) or a new tab in `producer/`.
- **`SB_*` key:** overlay on `SB_Scenes_v1` — `scene.breakdown[dept] = [tags]`.
- **Size:** medium, and mostly UI.

### 7. Costume plot and prop list have no export. **Value: medium**

Grepped `csv` across `props/index.html`, `wardrobe/index.html`,
`sets/index.html` and all three libs: **zero hits.** The platform has a CSV
injection guard and a test for it (`scripts/test_csv_injection.mjs`), so the
convention exists — these three modules simply never call it. A prop master and
a costume supervisor both live in spreadsheets and both have to hand a list to a
vendor, a rental house and an insurer. crew-08 item 9 asks for this for props;
it applies equally to the change plot, the piece list and the set inventory.
Small: a `toCSV()` in each lib, routed through the existing escaper.

### 8. Greens and picture vehicles have a price but no plan. **Value: low-medium**

Both are already catalogued: `props/lib-props.js:25,26` price picture vehicles
per shoot day and greens at $1,200 replacement, `sets/lib-set.js:23,25` have
plant and vehicle stencils, `safety/lib-safety.js:49` checks picture vehicles for
brakes and kill switch. crew-07 items 15-16 and crew-08 items 5 and 10 cover the
registers. The one thing none of them names: **greens are perishable and
vehicles have a continuity state.** A hedge dressed on day 3 is dead by day 11;
a picture car that gets a bullet hole in scene 40 must have it in every scene
after. Both are story-day continuity problems, so both fall out of item 1 nearly
free — a `perishAfterDays` on a greens item and a `damageState` keyed to story
day on a vehicle. Not worth a module of their own; worth two fields.

---

## Evidence

Files read in full: `sets/lib-set.js` (153 lines), `sets/lib-set3d.js` (456),
`props/lib-props.js` (355), `wardrobe/lib-ward.js` (275).

Files read in part, with the lines cited above verified directly:
`sets/index.html:55-102,140-175`; `props/index.html:71-135,215-265,308-400`;
`wardrobe/index.html:98-135,174-235,320-384`;
`producer/budget-sheet.js:1-60,204,259,334`; `producer/schedule-board.js:1-90,
148-180,236-330`; `js/budget-engine.js:279-295,673-684`;
`finance/lib-money.js:18-45,75-79,121`; `projects/lib-vault.js:15-40,158-180,
283-292`; `netlify/functions/projects-sync.js:37,198-240`;
`production/production.js:120-225`; `timeline/timeline-continuity.js:1-70`;
`timeline/timeline-characters.js:36-175`; `tools/tools-media-ui.js:412-475`;
`tools/tools-registers.js:33`; `workflow/advisor.js:119-132`;
`dashboard.html:2185-2205`; `app.html:3998-4025,5316-5393,5440-5470`;
`safety/lib-safety.js:44-53`; `locations/lib-scout.js:41,128`;
`casting/lib-castdesk.js:152`.

Executed, not inferred: I loaded `js/budget-engine.js`, `props/lib-props.js` and
`wardrobe/lib-ward.js` under node against a six-scene fixture containing scene
4A and confirmed the numbering divergence and the swallowed A-scene in the table
in "What exists but needs work". No source file was modified; the fixture was
written to the scratchpad.

Searches run and returning nothing anywhere in the application code (excluding
`static/vendor/`): `finish schedule`, `swatch`, `change number`, `look book`,
`check-in`, `check out`, `barcode`, `asset tag`, `wrap out`, `distress`,
`alteration`, `prosthetic`, `wig`, `SFX makeup`, `supplier`, `flame`,
`retardant`, `fire marshal`, `fireproof`, `story day`, and `csv` within the
three art-department modules. `elevation` appears only at
`sets/lib-set3d.js:56-66` and `sets/index.html:159`, where it means an item's
height off the floor, not an architectural elevation drawing.

Reports read to avoid duplication: `docs/audit/BRIEF.md`,
`docs/audit/assignments/teamA-15.md`, and the "What is missing entirely"
sections of `crew-07-production-design.md`, `crew-08-props.md` and
`crew-09-costume-hmu.md`.
