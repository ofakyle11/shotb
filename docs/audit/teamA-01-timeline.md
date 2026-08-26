# Team A Dev 01 — `timeline/` (the Studio): architecture, correctness, performance, testability

Scope: all 11 js files in `timeline/` (~333 KB), `timeline/index.html`, and the
two siblings the Studio calls into (`editor/lib-cut.js`, `editor/timeline-engine.js`).

All timings below were measured, not estimated, with the repo's own `vm` harness
(`scripts/test_parser_chars.mjs:1-11` pattern) against a synthetic feature:
120 scenes → **1120 clips**, 72 KB screenplay, parsed by the real `SBParser.parse`.
Baseline confirmed before starting: `node scripts/run_all_tests.mjs` → 44/44.

---

## What exists and works

- `timeline/timeline-budget.js:1179-1201` — `signature()` + `refresh()` is a real
  memo: the Producer's Estimate is skipped entirely while `<details id="budgetPanel">`
  is closed, and recomputed only when the signature moves. This is the one place in
  the module that thinks about render cost, and it is the right pattern.
- `timeline/timeline-budget.js:280-298, 327-337` — eighths-per-scene page measurement
  at sluglines (`LINES_PER_EIGHTH=5`) and log-linear budget percentiles. Genuine
  scheduling arithmetic, not a placeholder, and the constants carry their rationale.
- `timeline/timeline-doc.js:1-18, 366` — `SBDoc` documentary engine. Pure logic,
  documented chart of accounts, and deliberately shape-compatible with
  `SBBudget.estimateProduction()` so the top-sheet seeder and digest work unchanged.
  Best-written file in the module.
- `timeline/timeline.js:57-71` — the owner-token purge. The comment explains exactly
  why the localStorage copy of the signed token was a self-issued owner UI, and the
  fix (purge on load, never write again) is correct and lives on the page that
  actually loads.
- `timeline/timeline.js:1963-1968` — `btnPreview` uses `CinUrl.isSafe()` (not `safe()`)
  before `window.open`, with a comment explaining why `safe()` would corrupt a real
  query string. Exactly the distinction the brief draws.
- `timeline/timeline.js:1856-1864` — `loadProject()` refuses to import at all if
  `CVault.scrubImported` did not load, rather than falling back to a weaker local copy.
- `timeline/timeline.js:1951-1953` — script textarea input is debounced 400 ms because
  each sync serializes the whole project. Correct diagnosis, correct fix.
- Escaping across the module is clean: `node scripts/scan_html_sinks.mjs` →
  **172 interpolations, 0 unreviewed**, with `timeline/` in scope
  (`scripts/html_sinks_allow.json:326+`). `timeline-export.js:39-50` escapes every
  queue cell; `timeline.js:1154` uses `CinUrl.safe()` on the clip `<video src>`.
  I found no XSS hole. This is fine — do not let a later phase "fix" it.

---

## What exists but needs work

### HIGH — `timeline/timeline-export.js:3-6` — the EDL timecode formatter is wrong on all four fields

```js
function ftc(frames,fps){
  const h=Math.floor(frames/fps),m=Math.floor((frames%fps*60)/fps),s=Math.floor(frames%fps),f=frames%1;
```

`h` is **seconds**, `m` is a rescaled sub-second remainder, `s` is the frame
remainder, and `f` is `frames%1` which is always `0` for an integer frame count, so
the frames field is permanently `00`. Executed:

| frames @24fps | got | correct |
|---|---|---|
| 24 (1 s) | `01:00:00:00` | `00:00:01:00` |
| 1440 (60 s) | `60:00:00:00` | `00:01:00:00` |
| 86400 (1 h) | `3600:00:00:00` | `01:00:00:00` |

Why it matters: every EDL the Studio exports (`timeline.js:1847-1851`, the Export
panel's `btnEDL`) carries record-in times in the hundreds or thousands of hours. No
NLE will conform it — the assistant editor gets a file that looks plausible, imports
as garbage, and the round-trip to Resolve/Premiere is dead. This is the module's
one hard production-blocking defect.

The fix already exists and is tested: `editor/lib-cut.js:131-140 tc()` is correct
and `scripts/test_cut.mjs:69` asserts `tc(3661.5,24)==='01:01:01:12'`. Delete `ftc`
and have `timeline-export.js` call `SBCut.tc`/`SBCut.edl`.

### HIGH — `editor/timeline-engine.js:409-425` — the embedded editor's EDL has no edit events at all

`exportEdl()` emits `TITLE:`, `FCM:`, then only `* FROM CLIP NAME:` and
`* SOURCE FILE:` comment lines. There is **no** `NNN AX V C <src-in> <src-out>
<rec-in> <rec-out>` record for any clip, and the `offset` accumulator at line 411/421
is computed and never read. The output is a comment file with an `.edl` extension.
This is wired to the Studio's own Export EDL button (`editor/timeline-engine.js:531`,
surfaced as `tle-btnEdl` in `timeline/index.html:191`).

So the Studio ships **two** EDL writers, both non-functional, while
`editor/lib-cut.js:142-157` — the correct, tested one — sits in the same repo.
Point both at `lib-cut`.

### HIGH — `timeline/timeline.js:856-863` — `renderAll()` re-mines the whole project on every interaction

```js
function renderAll(){
  $('projectTitle').textContent=state.projectName;
  repairCorruptClips();
  if(state.clips.length||state.scriptText)bootstrapMastery(false,{skipHydrate:true});
  renderTimeline();renderScriptEditor();renderAssembly();renderCharacters();renderLocations();renderOutput();renderDetail();updateUndo();
```

`bootstrapMastery` → `bootstrapStructure` (`timeline.js:692-734`) is a full
re-derivation pass: `mineProjectMetadata`, `ensureCharactersFromClips`,
`mineCharactersFromClips`, `repairCharactersFromClips`, a possible
`SBParser.parse`, `syncCharactersFromParse`, `backfillClipLocationsFromParse`,
`bootstrapLocationsInline`, `SBLocations.syncAll`, `SBLocEnrich.buildLocalAliasMap`,
`applyCastRoles`, and `save()`. `SBContinuity.applyGraph` is invoked **twice**
(`timeline.js:713` and `timeline.js:724`).

`renderAll()` is the handler for a plain clip click (`timeline.js:1158`).

Measured floor at 1120 clips / 120 scenes, pure JS, Node, no DOM:

| step | ms |
|---|---|
| `SBContinuity.applyGraph` ×2 | 83 |
| `SBLocations.syncAll` | 26 |
| `save()` (JSON.stringify + localStorage write) | 17 |
| **floor per `renderAll()`** | **~136 ms** |

That floor excludes `repairCorruptClips` (regex per clip), `mineCharactersFromClips`
(3 global regexes per clip), `charsForStrip → pruneJunkCharacters → trustedCharacterNames`
(a second and third full-script character extraction), and all DOM work. Selecting a
clip in a feature-length project is a visible freeze.

Worse: `runJob` calls `renderAll()` on entry (`timeline.js:1744`), on success
(`:1806`) and on failure (`:1813`), and `batchGen` (`:1817-1826`) loops every clip.
A 400-clip batch therefore performs ~800 full re-mines — roughly **110 seconds** of
blocking JS spread through the run, on top of the generation itself.

Change: split derivation from rendering. `bootstrapStructure` is an import/parse-time
job, not a paint-time job. Call it from `importText`, `loadProject`, the two Resync
buttons and `bindUI` boot — and *not* from `renderAll`. Add a `dirty` flag so a
clip-body edit can request a re-derive without one happening on every click.

### HIGH — `timeline/timeline-continuity.js:95-111` and `timeline/timeline-locations.js:144-150` — the same scenes×clips quadratic, twice

`buildBlocks` iterates `scenes.forEach` and, inside, `clips.forEach` with
`if (clip.sceneIdx !== si) return;` — i.e. it scans all 1120 clips once per scene to
find the handful belonging to it. `SBLocations.mergeFromScenes:148-150` does exactly
the same scan. Measured: **134,400 inner-clip visits per `buildBlocks` call**, and
`applyGraph` runs it twice per `renderAll` → **268,800 visits per render**.

Both are one line of prep away from linear: bucket once,
`const bySceneIdx = clips.reduce((m,c,ci)=>((m[c.sceneIdx]??=[]).push(ci),m),{})`,
then index. O(scenes × clips) → O(scenes + clips), 134,400 → 1,240.

### HIGH — `timeline/timeline.js:1142-1164` — `renderTimeline()` rebuilds every clip card, including every `<video>`, on every render

`$('clipRow').innerHTML = state.clips.map(...)` (`:1152-1156`) destroys and recreates
the entire strip, then re-attaches four handlers to every card (`:1157-1162`). Line
1154 emits a live `<video src=...>` for each clip that has one — so in the assignment's
400-rendered-clip case, **400 fresh media elements are created and start loading on
every single click**, and the clip row's horizontal scroll position resets each time.

Change: keyed reconciliation. Only `.clip-card` nodes whose `status`/`videoUrl`/`label`
changed need touching, and the row should be event-delegated (one listener on
`#clipRow`) instead of 4×N handlers. See the virtualised list proposal below.

### HIGH — `timeline/timeline.js:31-35, 1078-1091` — Undo cannot restore the screenplay, so "New script" → Undo destroys it permanently

`snapshot()` serializes `{clips, characters, locationBible, global, assembly,
projectName, selectedId, selectedLoc}`. It does **not** include `scriptText` or
`parseResult`, and `restore()` does not set them.

`startNewScript()` calls `pushHistory()` and then sets `state.scriptText=''` and
`state.parseResult=null` (`:1082-1085`). Pressing Undo restores the clips, then
`save()` (`:34`) writes the still-empty `scriptText` back to `SB_Timeline_v1`. The
screenplay is gone from localStorage with the undo affordance sitting right there
implying it isn't.

`importText` has the same shape (`:1652` pushHistory, `:1655` overwrite `scriptText`):
undoing a re-parse restores the old clips but leaves the new script text, producing a
timeline and a screenplay that disagree.

Change: add `scriptText` and `parseResult` to `snapshot()`/`restore()`. One line each.

### MED — `timeline/timeline.js:1166-1173` — `reorder()` reassigns clip IDs, silently moving the selection and invalidating every stored clip index

```js
state.clips.forEach((c,i)=>{c.num=i+1;c.id='clip-'+String(i+1).padStart(2,'0')});
```

IDs are positional, so after a drag they all shift. `state.selectedId` is not updated,
so the right-hand detail panel silently switches to a *different shot* — you drag
clip 7 and the inspector you were editing is now clip 6. Everything keyed on clip id
goes stale with it: the embedded editor's `SB_Editor_embed_v1` timeline references ids
from `syncFromClips` (`timeline.js:1265`), and `SBProCut.applyToTimelineClips`
(`:1249`) matches on them.

The `clipIndices` arrays are positional too (`timeline.js:379-382`,
`timeline-locations.js:110`, `timeline-continuity.js:97`) and are not remapped, so
after any reorder each location's clip membership points at the wrong shots.
`timeline-locations.js:216` renders that as an "N clips" count that is right by
accident and wrong in content.

Also, `pushHistory()` at `:1167` fires before the `fi<0||ti<0` guard at `:1169`, so a
failed drop still burns an undo slot.

Change: give a clip a stable id at creation (`parser.js:615` is the other minting
site) and never re-mint it. Keep `num` as the display ordinal — that one *should*
follow position. Remap `clipIndices` in the same pass, or derive them on read.

### MED — `timeline/timeline.js:38` — `save()` swallows quota failure, and stores every scene's text three times

```js
function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({...}))}catch(e){}}
```

Measured payload breakdown at 1120 clips:

| field | KB |
|---|---|
| `scriptText` | 55 |
| `parseResult` | 231 |
| `clips` | 541 |
| **total** | **827** |

Every scene's description and dialogue is held three times — raw in `scriptText`,
structured in `parseResult.scenes[].shots[]`, and copied again into `clips[]`. That
is comfortably inside the ~5 MB origin quota today, so this is not yet a live outage
— but the empty `catch` means when it *does* trip (long project, plus
`SB_Editor_embed_v1`, `SB_Budget_v1`, `SB_Agents`, `SB_Sales_v1` sharing the origin)
the owner's work simply stops persisting with no warning at all. `projects/lib-vault.js:233,254`
already reasons carefully about a full quota; the Studio is the module that doesn't.

Change: surface the failure (`toast()` + a persistent banner), and stop persisting
`parseResult` — it is re-derivable from `scriptText` in 407 ms, which is cheap for a
once-per-load cost and saves 28% of the payload.

### MED — `timeline/timeline.js:32` — 50-deep history of full-project snapshots is ~51 MB resident

`pushHistory()` keeps 50 `JSON.stringify` snapshots. Measured: 1.03 MB each at 1120
clips → **51 MB** of retained strings, with an 11 ms serialize on every mutation
(and `pushHistory` is called from every toggle, every plate upload, every approve).

Change: cap by total bytes rather than entry count, or store a shallow diff. A
15-entry cap would still cover realistic undo depth at a third of the memory.

### MED — `timeline/timeline-budget.js:1179-1188` — the memo signature is length-based, so same-length edits leave a stale estimate

`signature()` is `scriptText.length | clips.length | char count | locationBible.length
| model | quality | clipDuration`. Two real staleness paths:

1. Any content-preserving-length script edit (`DAY` → `EXT`, a typo fix, swapping a
   word) leaves the signature identical while `detectDrivers`/`inferGenre`/`splitScenes`
   would all produce different numbers.
2. In a clips-only project — which `loadProject` can produce, since it defaults
   `scriptText` to `''` at `timeline.js:1868` — `pickText` falls back to
   `textFromClips` (`timeline-budget.js:251-255`), so editing clip descriptions
   changes the analysis input but not the signature.

Why it matters: the panel then shows a stale number as a current one, on the screen a
producer reads a budget off. Change: hash the actual `pickText(st)` output (a cheap
32-bit rolling hash over the string is enough) instead of measuring its length.

### MED — `timeline/timeline-export.js:26,29` — EDL comment fields are not newline-stripped

`'* LABEL: '+c.label` and `'* DESC: '+(c.description||'').substring(0,200)` are written
raw into a line-oriented format. Clip descriptions routinely contain newlines (they
come straight from parsed action blocks), so a multi-line description emits bare lines
that are neither an event record nor a `*` comment. Most EDL parsers will either drop
the block or choke. Change: `.replace(/[\r\n]+/g,' ')` on both before writing — the
same class of defense the CSV rule in the brief exists for.

### MED — `timeline/timeline-export.js:97-116` — `stitchClips` holds every clip in memory at once

The loop at `:102-107` fetches all clips into a `blobs[]` array before any stitching
begins, and `packageZip` (`:123-128`) then hands the same array to JSZip. At the
assignment's 400 clips × ~5 MB that is ~2 GB resident, twice over in the ZIP fallback.
Final Export will OOM the tab on a feature before it writes a byte. Change: stream —
stitch or zip incrementally and release each blob, or chunk into reels.

### LOW — `timeline/timeline.js:1530-1568` — `pruneJunkCharacters` is O(clips × chars × blob)

`state.clips.forEach` wrapping `Object.keys(chars).forEach` with a `blob.includes(up)`
substring scan (`:1534-1541`). Measured at 8,960 clip×char pairs for my 8-character
synthetic; a real feature with 50-60 speaking and background roles puts it near
60,000 substring scans, and `charsForStrip()` (`:1570-1575`) calls it a second time
per render with no `trusted` argument, which forces a full
`trustedCharacterNames()` → `collectCastFromProject()` → `extractCharactersFromText(script)`
re-extraction. Build one uppercase blob index per render instead of re-scanning.

### LOW — `timeline/timeline.js:1429-1436` — `applyCastRoles` is O(chars × clips)

`inferCastRole(name, clips)` (`:1415-1427`) walks every clip per character, and is
called from `bootstrapStructure:728` on every render. Same fix: precompute a
name → hasDialogue map in one pass.

### LOW — five divergent `esc()` copies inside `timeline/` alone

`timeline.js:28`, `timeline-export.js:52`, `timeline-characters.js:433`,
`timeline-locations.js:3`, `timeline-budget.js:860`. Repo-wide the count is **23**
files defining their own escaper. They are not identical: four use `String(s||'')`,
which renders the number `0` as an empty string, while `timeline-budget.js:860`
uses the correct `String(s == null ? '' : s)`. A budget cell of `0` and a clip label
of `0` currently escape differently.

---

## What is missing entirely

*(Per my assignment this section is supporting software — shared engines that would
let `timeline/` and its siblings be built out further — not missing product modules.)*

### 1. A `lib-*.js` + test suite for the Studio — **HIGHEST value, near-zero cost**

`timeline/` is **the only one of the 28 modules with no `lib-*.js` and no
`scripts/test_*.mjs`.** All 27 siblings have one (`boards/lib-shots.js` …
`writer/lib-treatment.js`); the largest, most-coupled module in the platform has
neither. The two EDL bugs above are exactly what that gap costs: `editor/lib-cut.js`
has `tc()` under test at `scripts/test_cut.mjs:69` and is correct, while the Studio's
untested copy has been emitting `3600:00:00:00` for an hour-long cut.

The cost is genuinely low, because most of the logic is already pure:

- `timeline-budget.js:1239` and `timeline-doc.js:366` already end with the node-safe
  `(function(root){…})(typeof window!=='undefined'?window:globalThis)` tail. I loaded
  both headlessly in Node with **zero source changes** — `SBBudget` and `SBDoc` are
  testable today.
- `parser.js`, `timeline-continuity.js`, `timeline-locations.js`,
  `timeline-locations-enrich.js`, `pro-cut.js` and `timeline-export.js` are equally
  DOM-free but hard-bind `window.X = …`. They still load under the repo's existing
  `vm.runInNewContext(code, {window:{}, console})` harness — the exact pattern already
  at `scripts/test_parser_chars.mjs:1-11`. No refactor required at all.

Build: one `scripts/test_timeline.mjs` in the house style, covering at minimum
timecode/EDL round-trip, `splitScenes`/eighths, `analyze` determinism,
`buildBlocks` bucketing, `clipDur`/`totalDuration`, `pruneJunkCharacters`, and
`snapshot`/`restore` round-tripping (which would have caught the lost `scriptText`).
Roughly a day. It takes the suite from 44 to 45 and puts a fence around the module
every later phase has to touch.

### 2. `js/lib-store.js` — an observable state store with change events — **HIGH**

The root cause of the `renderAll()` problem is that there is no way to say *what*
changed, so the only safe move is to redo everything. A minimal store fixes it:

```js
CStore.create({key:'SB_Timeline_v1', schema:1, initial:{…}})
  .get(path)                      // read
  .set(path, value, {silent})     // write + mark path dirty
  .batch(fn)                      // coalesce many writes into one notify
  .on('change', paths => …)       // paths: ['clips.7.status']
  .subscribe(path, fn)            // targeted
  .commit()                       // debounced persist, returns {ok, bytes, quotaError}
  .snapshot() / .restore(s)       // undo/redo, byte-capped
```

Two things it must do that the current code does not: report the quota failure that
`timeline.js:38` swallows, and cap history by bytes rather than the 50-entry count
that costs 51 MB.

Callers that benefit immediately: `timeline/timeline.js` (replaces `state`, `save`,
`load`, `snapshot`, `pushHistory`, `restore` — `:17-39`), `editor/timeline-engine.js`
(its own `save()` + `SB_Editor_embed_v1`), `projects/lib-vault.js` (already the
closest thing to this), `producer/`, `production/`, `workflow/`. ~300 lines, fully
node-testable.

### 3. `js/lib-render.js` — keyed list reconciliation + windowing — **HIGH**

`renderTimeline()` (`timeline.js:1142-1164`) is the worst case, but the pattern —
`innerHTML = arr.map(...).join('')` followed by `querySelectorAll().forEach(el => el.onclick = …)`
— repeats in `renderCharacters` (`:1298-1315`), `renderLocations` (`:1345-1365`),
`renderOutput` (`:1401`), and across `boards/`, `production/`, `producer/`.

```js
CList.mount(container, {
  key:   item => item.id,              // stable identity — see the reorder bug
  html:  item => '<div …>',            // existing template fn, unchanged
  diff:  item => [item.status, item.videoUrl, item.label],  // repaint trigger
  window:{ itemWidth: 132, overscan: 8 },   // render only what is on screen
  on:    { click: (item, ev) => … }         // one delegated listener, not 4×N
});
```

At 1120 clips this turns a full 1120-node rebuild plus 4480 handler attachments into
~20 visible nodes and one listener, and stops re-creating 400 `<video>` elements per
click. It also preserves scroll position for free, which the current code loses on
every interaction. Callers: `timeline/`, `boards/`, `production/`, `producer/`
stripboard, `dailies/`. ~250 lines.

### 4. `js/lib-schema.js` — a versioned migration layer for `SB_*` keys — **MED-HIGH**

There are **49 distinct `SB_*` keys** across the repo, 10 of them touched by
`timeline/` alone (`SB_Timeline_v1`, `SB_Editor_embed_v1`, `SB_LocalGPU_v1`,
`SB_Budget_v1`, `SB_Agents`, `SB_Sales_v1`, `SB_Timeline_script_hint_v2`, plus the
three purged owner keys). The brief forbids renaming any of them because live owners
hold data there — which is exactly why a migration layer is needed rather than
optional. Today the shape-fixing is scattered defensive code: `ensureClip`
(`timeline.js:41-55`) patches nine possibly-missing fields on every clip on every
load *and* on every `restore()`, and `bindUI` carries an ad-hoc model rename map at
`timeline.js:2026-2027`.

```js
CSchema.define('SB_Timeline_v1', {
  version: 3,
  migrations: {
    1: s => { s.clips.forEach(ensureClipShape); return s; },
    2: s => { s.global.model = MODEL_RENAMES[s.global.model] || s.global.model; return s; },
    3: s => { delete s.parseResult; return s; }        // re-derivable, saves 28%
  },
  validate: s => …            // reject rather than silently half-load
});
```

Key names never change; only the payload version does. Callers: every module with an
`SB_*` key, `netlify/functions/projects-sync.js` (which needs to know what version it
is syncing), and `projects/lib-vault.js`. ~200 lines, trivially node-testable.

### 5. `js/lib-fmt.js` — one escaper, one timecode, one EDL writer — **MED**

Three near-identical `ftc`/`tc`/`exportEdl` implementations exist
(`timeline-export.js:3`, `editor/lib-cut.js:131`, `editor/timeline-engine.js:409`);
two of the three are broken. Twenty-three `esc()` definitions exist and at least two
disagree on falsy handling. Consolidating `esc`, `jsq`, `tc`, `edl` and the CSV
`'`-prefix rule into one tested file removes the whole class. `editor/lib-cut.js`
already holds correct `tc`/`edl`/`otio` under test — promote those to `js/` and have
`timeline-export.js` and `timeline-engine.js` call them rather than reimplement.
~150 lines net, mostly deletion.

---

## Evidence

Files read in full or in the cited ranges:

- `timeline/timeline.js` (2055 lines, read entire) — `:5` storage key; `:17-23` state
  shape; `:28` esc; `:31-36` snapshot/restore/undo/redo/pushHistory; `:38-39`
  save/load; `:41-55` ensureClip; `:57-71` owner purge; `:288-310` buildPrompt;
  `:312-313` clipDur/totalDuration; `:379-385` upsertLocEntry/clipIndices;
  `:692-734` bootstrapStructure; `:712-714, 724` applyGraph ×2; `:856-863` renderAll;
  `:1078-1091` startNewScript; `:1142-1164` renderTimeline; `:1152-1156` innerHTML
  rebuild; `:1157-1162` handler attach; `:1158` click→renderAll; `:1166-1173` reorder;
  `:1298-1315` renderCharacters; `:1345-1365` renderLocations; `:1401` renderOutput;
  `:1415-1436` inferCastRole/applyCastRoles; `:1530-1568` pruneJunkCharacters;
  `:1570-1575` charsForStrip; `:1643-1676` importText; `:1687-1697` addClip/duplicateClip;
  `:1743-1814` runJob; `:1817-1826` batchGen; `:1847-1852` exportEDL/exportProject;
  `:1856-1872` loadProject; `:1874-1884` finalExport; `:1905-2053` bindUI;
  `:1951-1953` debounce; `:1963-1968` CinUrl.isSafe; `:2026-2027` model migration.
- `timeline/timeline-export.js` (130 lines, read entire) — `:3-6` ftc; `:17-33`
  exportEDL; `:26,29` raw label/description; `:39-52` renderQueue + esc;
  `:97-116` stitchClips; `:123-128` packageZip.
- `timeline/timeline-budget.js` — `:242-361` num/textFromClips/pickText/estimatePages/
  detectDrivers/splitScenes/inferGenre/budgetPercentile/analyze; `:860` escT;
  `:1179-1239` signature/refresh/wire/API export tail.
- `timeline/timeline-continuity.js` — `:40-115` shotNeedsBackground/buildBlocks;
  `:95-111` scenes×clips nested loop; `:117-160` sortClipIndices/applyGraph;
  `:198-200, 220, 296` clipIndices use.
- `timeline/timeline-locations.js` — `:80-179` clipLocationMeta/ensureEntry/
  upsertLocation/syncFromClips/mergeFromScenes/mergeFromScript; `:144-150` nested
  loop; `:110, 160, 216` clipIndices.
- `timeline/timeline-doc.js` — `:1-40` header + CUES; `:366` root.SBDoc.
- `timeline/parser.js` — `:605-630` scenesToClips; `:615` clip id minting; `:113`
  clipIndices seed.
- `timeline/timeline-locations-enrich.js` — `:15-39, 165-231, 340` canonicalLocName /
  clipIndices merge.
- `timeline/index.html` (322 lines, read entire) — `:191` tle-btnEdl; `:305-319`
  script load order.
- `editor/lib-cut.js` — `:128-157` tc + edl (correct reference implementation);
  `:159-167` otio.
- `editor/timeline-engine.js` — `:395-425` syncFromClips tail + exportEdl; `:531`
  btnEdl wiring; `:561` export surface.
- `scripts/test_cut.mjs:68-70` — the `tc` assertion the Studio copy would fail.
- `scripts/test_parser_chars.mjs:1-11` — the `vm.runInNewContext` harness pattern.
- `scripts/html_sinks_allow.json:326+` — confirms `timeline/` is in scanner scope.
- `projects/lib-vault.js:233, 254` — the quota reasoning `timeline.js:38` lacks.

Commands run (read-only):

- `node scripts/run_all_tests.mjs` → **44/44 suites passed** (baseline, unchanged).
- `node scripts/scan_html_sinks.mjs` → **172 interpolations scanned, 0 unreviewed**.
- `ls */lib-*.js` → 30 `lib-*.js` files across 27 modules; **none in `timeline/`**.
- Headless load probe → `timeline-budget.js` and `timeline-doc.js` load in Node
  unmodified; the other five bind `window.X` and need the existing `vm` harness.
- Scale harness (120 scenes → 1120 clips via the real `SBParser.parse`) →
  parse 407 ms · `applyGraph` 41.7 ms ×2 · `SBLocations.syncAll` 26.1 ms ·
  `save()` 16.9 ms · `snapshot()` 11.2 ms / 1.03 MB · save payload 827 KB
  (scriptText 55 / parseResult 231 / clips 541) · `buildBlocks` 134,400 inner
  clip visits per call.
- Direct execution of `ftc()` from `timeline-export.js:3-6` against the correct
  formula at 24 fps for 0 / 24 / 48 / 120 / 1440 / 86400 frames — table above.

Not verified, and therefore not claimed: runtime behaviour in a real browser (all
timings are Node), the `SBEnrich`/`SBLocEnrich` network paths, `pro-cut.js` internals
beyond its call sites, and `ffmpeg-wasm.js`.
