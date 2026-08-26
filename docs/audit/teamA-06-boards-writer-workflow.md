# Team A Dev 06 — boards / writer / workflow

Slice: `boards/` (storyboards, shot lists, key art, animatic), `writer/`
(treatment → script), `workflow/` (pipeline mission control), plus how the three
share data with `timeline/` and `app.html`.

All behavioural claims below were re-run in node against the real library files
(`writer/lib-treatment.js`, `boards/lib-shots.js`, `timeline/parser.js`,
`workflow/workflow.js`). Baseline verified: `node scripts/run_all_tests.mjs` →
**44/44 suites passed**.

---

## What exists and works

- `workflow/workflow.js:199-217` — `gather()` genuinely reads live localStorage
  on every render. `workflow.js:308-309` re-renders on the cross-tab `storage`
  event and on `visibilitychange`. This is **not** a static picture: the code
  path is `init() → render() → assess(gather())` with no cached snapshot
  anywhere. The mission-control claim is honest as far as the keys it reads.
- `workflow/workflow.js:25-188` — `assess()` is pure, takes injected stores, and
  is exercised by `scripts/test_workflow.mjs` (41 assertions). The
  "single you-are-here" rule at `workflow.js:164-167` is correct: it promotes the
  first non-done stage to `active` and leaves the rest `todo`.
- `workflow/advisor-ui.js:49-56` + `workflow/advisor.js:139-186` — the Advisor is
  the strongest cross-module integration in the platform. It reads 12 stores,
  and it **writes back** (`advisor-ui.js:107-109` sets `SB_Budget_v1.incentive`;
  `advisor-ui.js:116-134` seeds open positions into `SB_Crew_v1`). Prep actions
  are prescriptive and correctly conditional (e.g. `advisor.js:156` only nags
  about permits when a row is actually `Applied`/`Denied`).
- `boards/lib-shots.js:104-108` — `csvCell()` handles the `= + - @` tab/CR
  formula-injection prefix correctly and is covered by
  `scripts/test_csv_injection.mjs:89`. The quote-doubling is also right.
- `boards/boards.js:220-254` — the animatic exporter is real work: WebCodecs
  `VideoEncoder` → the in-repo MP4 muxer (`CMux.buildMp4`), with a genuine
  real-time `MediaRecorder`/WebM fallback at `boards.js:256-265`, backpressure
  handling at `boards.js:239`, and a keyframe every 2s. No third-party runtime.
- `boards/boards.js:117-119` — the frame grab correctly catches the tainted-canvas
  `SecurityError` and tells the operator *why* (cross-origin clip), rather than
  failing silently.
- `boards/boards.js:46` and `workflow/workflow.js:229,245` use `CinUrl.safe()`
  for URLs in attributes, and both pages load `/js/safe-url.js`
  (`boards/index.html:25`, `workflow/index.html:27`). Escaping discipline in this
  slice is correct — I found no XSS sink in the three modules.
- `writer/index.html:26-28` — pdf.js and JSZip are vendored under
  `/static/vendor/`, not pulled from a CDN. The constraint is respected.
- `writer/lib-treatment.js:46-64` — `cleanText()` is good: de-hyphenates line
  wraps, drops `Page 3 of 12` furniture, rebuilds paragraphs from PDF hard wraps.
  This is the hard part of treatment import and it is done properly.

---

## What exists but needs work

### HIGH — `boards/lib-shots.js:22-34`: every *shot* is treated as a *scene*

`timeline/parser.js:605-641` emits one clip **per shot**, not per scene:
`scenesToClips` iterates `sc.shots.forEach` and increments a global counter `n`.
`seedScenes()` then maps 1 clip → 1 board "scene".

Measured on a 4-scene treatment: 4 scenes → 10 clips → **10 board "scenes"**,
each with an empty shot list. A feature with 90 scenes × 6 shots produces 540
board scenes. There is no scene grouping anywhere in Boards, so the storyboard
artist gets a flat list with no scene boundaries.

Worse, the slug is manufactured from the wrong fields
(`lib-shots.js:27`):

```js
slug: 'SC' + String(c.num || i + 1).padStart(2, '0') + ' — ' + (c.label || 'Scene')
```

- `c.num` is the **global shot index**, not a scene number. Board "SC10" is
  scene 4, shot 2. A 1st AD reading the CSV cannot find that scene in the script.
- `c.label` is a rotating 9-item placeholder list from `parser.js:607`
  (`'Opening scene','Character intro','Dialogue',…`), so board scenes are named
  `SC01 — Opening scene`, `SC10 — Opening scene`. Verified output.
- `c.heading` — the **actual slugline** (`INT. LAW OFFICE - NIGHT`, set at
  `parser.js:619`) — is never read.

Change: group clips by `c.heading` (or `sceneIdx`, already on the clip at
`parser.js:618`), one board scene per script scene, slug = the real heading,
and hang the clips off it as the seeded shots. Keep `c.description` as the
shot description.

### HIGH — `boards/lib-shots.js:22-27`: `desc` is always empty (wrong field name)

`seedScenes` reads `c.prompt`. Clips have **no** `prompt` field — `parser.js:614-637`
sets `description`. `grep -n "prompt" timeline/*.js` finds only
`timeline.js:1763,1769`, which build a transient request body. So every seeded
board scene has `desc: ''`.

This is not cosmetic. `boards/boards.js:151` builds the AI frame prompt as
`sh.desc || sc.desc || 'cinematic still'`. On a freshly seeded board both are
empty, so every generated storyboard frame is prompted with nothing but
`"SC03 — Dialogue. WS shot, eye level, cinematic still"`. The whole
frame-generation feature is starved of the script content that already exists
two fields away. Fix: `desc: c.description || ''`.

### HIGH — `boards/boards.js:326-327`: re-seeding aliases and destroys storyboards

```js
var by = {};
project.scenes.forEach(function (s) { by[s.slug] = s; });
scenes.forEach(function (s) { if (by[s.slug]) s.shots = by[s.slug].shots; });
```

Two failures, both verified in node:

1. **Last-write-wins on duplicate slugs.** Two scenes slugged
   `INT. BAR - NIGHT` (routine — a location recurs) collapse to one entry in
   `by`. The earlier scene's shots and frames are silently dropped.
2. **Shared array reference.** Both rebuilt scenes get the *same* `shots` array
   object. Verified: `fresh[0].shots === fresh[1].shots` is `true`, and pushing a
   shot into scene 1 makes it appear in scene 7. Shot ids collide too.

Third, compounding failure: because the timeline-seeded slug embeds the global
shot index (`SC<num>`), **any** upstream edit shifts every subsequent `num`.
`timeline/timeline.js:1659-1661` rebuilds `state.clips` wholesale on every
re-parse. So adding one sentence to scene 1 renames every downstream board slug,
the merge finds no match, and **every storyboard frame after the insertion point
is discarded** — a storyboard artist's day of work gone on a script re-parse
with no warning. Fix: key the merge on a stable scene id (see the model below),
deep-copy the shots array, and warn before dropping unmatched scenes.

Nit while you are there: `by` is a bare object, so a scene slugged literally
`constructor` yields a truthy `by[s.slug]` whose `.shots` is `undefined`, and the
next `sc.shots.push(...)` throws. Use `Object.create(null)` or a `Map`.

### HIGH — `js/project-badge.js:139`: boards frames silently stop cloud auto-sync

Storyboard frames are stored inline as base64 JPEG data URLs
(`boards.js:109-116` — 480×270, quality 0.65 → roughly 15–25 KB of base64 each)
inside `SB_Boards_v1`. `project-badge.js` is loaded on Boards
(`boards/index.html:100`) and auto-syncs the whole SB_* set every 4 minutes. At
`project-badge.js:139`:

```js
if (archive.length > 3800000) return;   // near the cloud cap
```

A bare `return` — **no `markBadge()` call, no toast, no console warning**. Around
~200 framed shots the archive crosses 3.8 MB and cloud backup stops dead while
the badge continues to show its last successful state. The owner believes the
production is backed up and it is not. At minimum call
`markBadge('warn', …)` here; properly, frames belong out of the JSON blob.

The same data also multiplies locally: `projects/lib-vault.js:219-224`
(`saveActive`) copies every SB_* value into `CIN_Projects_v1.slots[…]`. With
three project slots the same base64 frames are held four times inside a single
~5 MB origin quota. `boards.js:26` catches the quota exception and toasts, which
is good, but there is no eviction or compaction path.

### HIGH — `writer/lib-treatment.js:88-109`: act breaks become phantom exterior scenes

Verified:

| heading | `guessSlug()` output |
|---|---|
| `ACT ONE` | `EXT. ONE - DAY` |
| `ACT TWO` | `EXT. TWO - DAY` |
| `PART ONE` | `EXT. ONE - DAY` |
| `THE CALL` | `EXT. THE CALL - DAY` |

`lib-treatment.js:101-102` strips the `ACT` keyword but `[\s\dIVX:.-]*` cannot
consume `ONE`, leaving it as the location; `lib-treatment.js:99` then defaults to
`EXT.` when no interior cue is found. Every act break in a treatment becomes a
fake exterior day scene that flows straight into the Studio breakdown, the
location bible, the stripboard and the budget.

`scripts/test_writer.mjs:76` asserts only `/^INT\./.test(parsed.scenes[0].slug)`
and prints the value — so `INT. ONE - DAY` passes the suite today. The test is
too weak to catch this. Fix: treat `ACT|PART|CHAPTER|SEQUENCE` headings as
structural markers (carry them as `act`/`sequence` metadata on the following
scene) rather than as locations, and tighten the assertion to the location name.

### HIGH — `writer/lib-treatment.js:190`: dialogue is mangled by two regex bugs

```js
var QUOTED = /([A-Z][A-Za-z .'-]{1,24}):\s*[“"']([^”"']{1,400})[”"']/g;
```

Both verified in node against `bodyToFountain`:

1. **The name class eats the preceding sentence.** `[A-Za-z .'-]` includes `.`
   and space, so `She opens the file. MARA: "Who is this?"` produces the
   character cue `SHE OPENS THE FILE. MARA`. Treatments are prose — action and
   dialogue routinely share a paragraph, and `cleanText:60` deliberately joins
   consecutive lines into one paragraph, so this path is the common case, not the
   edge case.
2. **The quote class excludes `'`, so contractions truncate the line.**
   `MARA: "I'm done after this one."` mid-paragraph yields the cue line `I`
   followed by a stray action line `m done after this one."`. An apostrophe is
   the single most common character in screen dialogue.

The whole-paragraph path at `lib-treatment.js:195` handles apostrophes
correctly, which is why `test_writer.mjs:89` (`"Who is this?"` — no apostrophe,
own paragraph) passes. Fix: restrict the name class to `[A-Z][A-Z0-9 .'-]{1,24}`
(cues are capitalised) anchored at a sentence boundary, and change the quote body
to `[^“”"]{1,400}` so only real quote marks terminate it.

### HIGH — `writer/writer.js:208-218`: "Send to Studio" produces a phantom SCENE 1

`wrToStudio` writes the Fountain text into `SB_Timeline_v1.scriptText` and
nothing else. The Studio then parses that text — including the Fountain **title
page** the writer emitted at `lib-treatment.js:224-230`.

`timeline/parser.js:23-29` (`isTitlePageLine`) does not recognise `Title:`,
`Credit:`, `Author:` or `Source:`. Verified end-to-end result: the parser
manufactures a scene `SCENE 1` containing four shots —

```
"Title:"  ·  "Close on THE LAST CLIENT, delivering dialogue."
"Close on CINAMATE, delivering dialogue."  ·  "= A tired lawyer takes one final case."
```

— and registers **`THE LAST CLIENT` and `CINAMATE` as cast members**. Those
phantom characters then propagate into the character bible, casting, continuity,
and Boards' `suggestCoverage` (`boards.js:347-353`), which cheerfully generates a
single on "CINAMATE".

Two independent fixes, both cheap: teach `isTitlePageLine` the Fountain
key/value form (`^[A-Z][A-Za-z ]{2,20}:\s`) and the synopsis form (`^= `); and
have `wrToStudio` send the body only, passing title/author as structured fields
rather than as script text.

### MED — `workflow/`: mission control cannot see two thirds of the platform

`gather()` (`workflow.js:199-217`) reads 15 keys. The repo has 60+ `SB_*_v1`
stores. Absent from both the pipeline **and** the Advisor's prep actions
(`advisor.js:139-186`): `SB_Boards_v1`, `SB_Props_v1`, `SB_Wardrobe_v1`,
`SB_SetDesign_v1`, `SB_Safety_v1`, `SB_Music_v1`, `SB_Festivals_v1`,
`SB_Dist_v1`, `SB_Investors_v1`, `SB_TaxLedger_v1`, `SB_VfxShots_v1`,
`SB_Continuity_v1`, `SB_Timecards_v1`, `SB_HotCost_v1`.

The storyboard omission matters most to a real production: the shot list is what
the 1st AD schedules the day against, and there is no stage, no metric and no
prep action anywhere telling the producer that scene 42 has no coverage planned.
There is no "Coverage" stage between Breakdown and Schedule.

`workflow.js:207,212,214` also gather `SB_Sales_v1`, `SB_Crew_v1` and
`SB_Drafts_v1` and then never use them in `assess()` — dead reads that imply
coverage that is not there. (`SB_Crew_v1` *is* used, but only by the Advisor.)

Fix: add a `coverage` stage reading `SB_Boards_v1` (scenes boarded / shots
listed / frames drawn) between `breakdown` and `schedule`, add a prep action
`"N scenes have no shot list"`, and either wire up or delete the three unused
gathers.

### MED — two disagreeing progress models over identical data

`workflow.js:175` computes `overallPct = round(100 * doneStages / 7)` — a
7-bucket step function, so a project jumps 14% at a time and can only ever read
0/14/29/43/…%.

`dashboard.html:2202-2208` computes a completely different weighted score over
the same stores (`hasScript` +15, `boardN` +10, `sheetTotal` +15, render ratio
×30, `cutClips` +15, `cut.lastExport` +15) with a different stage vocabulary at
`dashboard.html:2210-2216` (`EMPTY/SCRIPT/STORYBOARD/GENERATING/RENDERED/
CUTTING/MASTERED`) versus workflow's seven (`develop/breakdown/budget/schedule/
generate/review/deliver`).

The same project therefore reports two different completion percentages and two
different stage names depending on which page you open. Neither is wrong; there
is simply no single definition. Pick one — I would put the weighted model in
`workflow.js` (it is the finer signal) and have `dashboard.html` call
`CWorkflow.assess()` instead of re-deriving.

Related concrete bug: `dashboard.html:2166` sums runtime as
`(+c.dur || (c.params && +c.params.duration) || +c.duration || 8)`. Clips carry
**none** of those three fields — the parser sets `durationSec`
(`parser.js:620`), which `workflow.js:178` reads correctly. So the dashboard's
rendered-runtime figure is always `8 × renderedCount`, a hardcoded fiction.

Also `dashboard.html:2183` counts `boards.scenes.length`, which after seeding
equals the clip count — so a project flips to stage `STORYBOARD` before a single
frame has been drawn. Count framed shots instead.

### MED — `writer/`: the script model is a flat array with no identity

`writer.js:12`: `state = { proj:{…}, scenes: [ {slug, body, characters} ] }`.
Not a blob of text — the beats are structured — but there is **no scene id**.
Scene identity is the array index: cards carry `data-i="<index>"`
(`writer.js:107`), edits write `state.scenes[i][f]` (`writer.js:167-169`),
reorder splices the array (`writer.js:178-179`), and the scene number is derived
positionally as `n: i + 1` (`writer.js:90`).

**What breaks when a scene is renumbered:**

- Inside Writer: nothing. Every reference is positional and recomputed on
  render, so reordering is internally consistent. This is honestly fine for a
  single-user beat board.
- Crossing into Boards: `boards.js:322` seeds from `SB_Writer_v1` and merges on
  **slug**. Writer slugs are auto-generated and duplicate freely (`INT. BAR -
  NIGHT` in scenes 1, 5 and 12), so the aliasing/loss bug above fires on exactly
  the path Writer feeds.
- Crossing into the Studio: `wrToStudio` sends only flattened text. Scene
  identity is destroyed at the boundary and re-invented by the parser as
  `clip.num`. There is no way to say "this Studio clip came from that Writer
  beat", so a Writer edit can never be propagated into an already-broken-down
  Studio project without a full re-parse that discards all render state
  (`timeline.js:1659-1661` replaces `state.clips` wholesale, dropping every
  `videoUrl`, `status`, `edit` and `params`).

There are also **no revisions**. A production runs on coloured revision pages
(white → blue → pink → yellow); this model cannot express a locked draft, a
revision colour, an A-page, or a change bar. `writer.js:187-191` ("New project")
discards the current script behind a single `confirm()` with no undo and no
draft history — `SB_Drafts_v1` exists as a key and is gathered by
`workflow.js:214` but nothing in this slice writes it.

Rank HIGH for the missing scene id, MED for revisions.

### MED — `boards/lib-shots.js:90-98`: the shot-list CSV is not a shot list

Verified header:

```
"Scene","Shot","Size","Angle","Move","Lens (mm)","Secs","Description"
```

where `Scene` is the manufactured slug (`SC03 — Dialogue`). A shot list that
goes to a 1st AD and a camera department needs, at minimum: scene number,
INT/EXT, location, D/N, page eighths, cast IDs in the shot, and equipment
(the lens is there; the body/support/filtration are not). None of the first six
are present, and every one of them is already sitting on the clip
(`parser.js:614-637`: `heading`, `characters`) or derivable via
`SBParser.parseSceneHeading` (`parser.js:56-80`, which already returns
`{name, timeOfDay}`).

This is the single cheapest high-value fix in the slice: the data exists, the
CSV just does not carry it.

### LOW — `boards/boards.js:193`: the framed-only animatic mode is unreachable

`animaticPlan(project, includeEmpty)` supports two modes and both are tested
(`test_modules.mjs:86-87`), but `exportAnimatic` hard-codes `true`, so every
export includes slates for unframed shots. Add a toggle, or drop the parameter.

### LOW — `boards/boards.js:87-89`: clip URL in an attribute uses `esc()` not `CinUrl.safe()`

`'<option value="' + esc(c.videoUrl) + '">'`, and the value is later assigned to
`video.src` (`boards.js:95`). Not exploitable — `esc()` blocks attribute
break-out and `javascript:` does not execute in a `video.src` — but it is the
one place in this slice that departs from the brief's rule for URLs in
attributes. Gate it with `CinUrl.isSafe()` when building the option list.

### LOW — `js/safe-url.js` key-shape regex is duplicated three times

`projects/lib-vault.js:15` (`KEY_RE`), `lib-vault.js:23` (`LOCAL_ONLY`) and
`js/project-badge.js:102` each carry their own copy of
`/^SB_[A-Za-z0-9]+_v\d+$/` and the LocalGPU/TMDB exclusion. Any new canonical key
must satisfy all three, and drifting one silently un-syncs data. Export the
predicate from `CVault` and have `project-badge.js` call it.

---

## What is missing entirely

### 1. A canonical project data model — and most of it is already in the repo, orphaned. Value: HIGHEST.

The assignment predicted the missing piece is a shared schema. It is, but the
finding is sharper than that: **a previous version of `/workflow/` was a
project-oriented SPA with exactly this model, it was replaced by the current
pipeline dashboard, and app.html still contains six live integration points
pointing at it.**

Evidence:

- `app.html:9285-9317` renders a project grid from `SB_Projects_v1`, an
  **id-keyed registry**: `{ id: { id, title, vision:{logline}, clips, updated_at } }`,
  linking each card to `/workflow/#/project/${p.id}/vision`. The current
  `workflow/workflow.js` has **no hash routing at all** — that link is dead.
- `app.html:3918-4103` (`mhEnter`) reads `SB_WorkflowStaged` and describes it as
  "Bridge from /workflow/ … from Coverage step with staged shots". Its schema is
  `{ project_id, project_title, script_raw, scenes[], shots[{ scene_id,
  characters_in_frame, character_image_url, negative_prompt }] }`.
  **Nothing in the repo writes `SB_WorkflowStaged`** — grep finds one `getItem`
  and three `removeItem`, no `setItem`. Dead branch.
- `app.html:4211-4222` carries a "workflow lock" banner explaining that the
  workflow's normalizer produced *8 scenes / 53 shots* where app.html's own
  engine produces *10 / 75* — i.e. two breakdown engines that disagree, with the
  workflow's treated as authoritative.
- `app.html:2700-2729` writes generated clips back into
  `SB_Projects_v1[wfProjId].clips` keyed by **`shotObj.id`** — the only stable
  shot identity anywhere in the platform. Because nothing creates the registry
  entry, `if(proj)` is always false and the write-back never fires.
- `app.html:6840-6868` restores already-generated clips from that same registry
  so credits are not re-burned. Also dead.

Meanwhile the monolith stores its own model under **`sb_project_<uid>`**
(`app.html:3355`, documented at `app.html:3339-3350`) —
`{ name, createdAt, script, scenes:[{ id, heading, body, shots:[{id,num,text,prompt}],
background, characters }], characterMap, generatedClips }`. That is a genuinely
good structured model with scene **and** shot ids. It does **not** match
`CVault.KEY_RE` (lowercase, no `_v1`), so:

- the Projects vault never snapshots it — switching projects does not switch
  app.html's project;
- `.cinamate` archives do not contain it;
- `project-badge.js` cloud sync never uploads it.

Same for `SB_Generated` (`app.html:2681-2686`), which holds the rendered clip
records handed to `/editor/`: non-conforming key ⇒ never swapped on project
switch ⇒ **project A's generated clips remain visible in the Editor after
switching to project B.**

So today there are **four** incompatible scene models:

| Where | Shape | Scene identity | Shot identity |
|---|---|---|---|
| `writer/writer.js:12` | `scenes[{slug, body, characters}]` | array index | none |
| `timeline/parser.js:614` | `clips[]` (flat, one per shot) | `heading` string + `sceneIdx` | `clip.id` (regenerated on re-parse) |
| `boards/lib-shots.js:17` | `scenes[{id, slug, desc, shots[]}]` | random `uid()`, matched by slug | random `uid()` |
| `app.html:3339` | `scenes[{id, heading, body, shots[{id,num}]}]` | stable id | stable id |

…and the same concept under different names throughout: **scene/clip/beat/
strip**, **slug/heading/slugline**, **desc/description/prompt/body/text**,
**dur/durationSec/duration**, **characters (array) / characters (map) /
characters_in_frame / characterMap**.

**Proposed schema — `SB_Story_v1`** (matches `CVault.KEY_RE`, so it is portable,
vault-swappable and cloud-synced for free):

```js
{
  v: 1,
  projectId: 'p_<base36>',          // stable across renames
  title, author, draftDate, logline,
  revision: { colour: 'white', locked: false, n: 1 },
  scenes: [{
    id: 'sc_<base36>',              // NEVER regenerated, NEVER an index
    number: '12',                   // display only; 'A12' legal for A-pages
    act: 'ONE',                     // where ACT/PART headings now go
    heading: 'INT. BAR - NIGHT',    // the one canonical name for a slugline
    intExt: 'INT', location: 'BAR', timeOfDay: 'NIGHT',
    pageEighths: 12,
    body: '…',                      // prose, kept verbatim by the vault sanitiser
    cast: ['sc_char_ab'],
    shots: [{
      id: 'sh_<base36>',
      size, angle, move, lensMm, seconds,
      description, frameImgRef,     // an ASSET REF, not inline base64
      status: 'planned'|'rendered'|'approved',
      clipId: 'clip-07'             // link back to the Studio clip
    }]
  }],
  characters: { 'sc_char_ab': { name, description } }
}
```

Two rules carry the weight: **scene and shot ids are permanent** (only ids cross
module boundaries; numbers and slugs are display strings that may change), and
**frame images are refs**, held in a separate `SB_Frames_v1` keyed by ref so the
story model stays small enough to sync.

**Events** — no framework needed. localStorage already fires `storage` across
tabs and `workflow.js:308` proves the pattern works. Add a tiny
`js/story-bus.js`: `CStory.get()`, `CStory.mutate(fn)` (writes, then bumps a
`SB_Story_rev` counter), and `CStory.on('change', cb)` wired to both the
`storage` event and a same-tab `CustomEvent` so the writing tab also updates.
~60 lines, vanilla, node-testable.

**Migration path — no key is renamed, no live owner loses data:**

1. Ship `js/lib-story.js` (pure) + `scripts/test_story.mjs`. Add
   `CStory.migrate({ writer, timeline, boards, appProject })` that builds
   `SB_Story_v1` from whatever exists, in that precedence order, minting ids and
   matching board scenes to clips by `heading` (with slug as fallback). Pure
   function, fully testable against fixtures.
2. Each module reads `SB_Story_v1` **if present**, else falls back to its own key
   exactly as today, and calls `migrate()` once on first load, writing the result
   alongside — never over — the legacy key.
3. Writes go dual for one release: `CStory.mutate()` also projects back into
   `SB_Writer_v1` / `SB_Boards_v1` in the legacy shape, so a stale cached page or
   an un-migrated module keeps working.
4. Adopt in order **writer → boards → workflow → timeline → app.html**. Writer
   is smallest and highest leverage (it is the source of scene identity); Boards
   is next because its aliasing bug disappears the moment the merge keys on
   `scene.id`; workflow then gains a coverage stage for free.
5. Only after all five read `SB_Story_v1` natively, drop the dual write. Legacy
   keys stay in place, unread, so a rollback is a one-line revert.
6. `CVault` needs no change — `SB_Story_v1` and `SB_Frames_v1` both match
   `KEY_RE`. Add `SB_Generated` and `sb_project_<uid>` to the migration source
   list so the monolith's orphaned work is finally captured by the vault.

Build cost: roughly 400 lines of pure JS plus a test suite, and one adoption PR
per module. It closes the aliasing bug, the re-parse frame loss, the phantom
SCENE 1, the two-progress-models split, and the Editor cross-project leak — all
of which are symptoms of the same missing thing.

### 2. A Coverage stage in `workflow/`. Value: HIGH.

Attach to `workflow/workflow.js` between `breakdown` and `schedule`: scenes with
a shot list / total shots / frames drawn, reading `SB_Boards_v1` (later
`SB_Story_v1`). Add the matching prep action in `advisor.js:139-186`
(`"42 scenes have no coverage planned"`, `href: '/boards/'`). Small — one stage
object plus one `act()` call — and it makes the platform's storyboard work
visible to the producer for the first time. Also add `/boards/` to the
`workflow/index.html` and `boards/index.html` navs; neither currently links to
the other.

### 3. Frame storage out of the JSON blob. Value: HIGH.

`SB_Frames_v1` keyed `{ ref: dataUrl }`, with the story model holding only refs.
Immediately: `SB_Story_v1` stays small enough that
`project-badge.js:139` never trips; the vault stops multiplying megabytes of
base64 per project slot; and frames can be evicted or downscaled independently.
Attaches to `boards/`. A day's work.

### 4. Revision control in `writer/`. Value: MED.

Draft snapshots with colour (white/blue/pink), a lock flag, A-page numbering and
a diff between two revisions. `SB_Drafts_v1` already exists as a key and is
already gathered by `workflow.js:214` — nothing writes it. Attach to `writer/`,
surface the current colour on the workflow Develop stage. A production cannot
distribute pages without this.

### 5. A real shot-list export. Value: MED.

Extend `boards/lib-shots.js:90-98` to emit scene number, INT/EXT, location, D/N,
page eighths, cast and equipment, and add a printable per-day shot list filtered
by the `SB_ScheduleBoard_v1` day assignment. All inputs already exist. Attach to
`boards/`. Half a day, and it turns the CSV from a curiosity into the document a
1st AD actually uses.

### 6. `scripts/test_boards.mjs`. Value: MED.

The brief says every module has a `lib-*.js` plus a `scripts/test_*.mjs`.
`boards/lib-shots.js` has **no dedicated suite** — it is covered only
incidentally by `test_modules.mjs:75-90` (10 assertions) and
`test_csv_injection.mjs:89`. None of those cover `seedScenes`' field-name bug,
the duplicate-slug merge, or the scene/shot conflation, which is precisely why
those bugs are live.

---

## Evidence

Files read in full: `boards/lib-shots.js`, `boards/boards.js`,
`boards/index.html`, `writer/lib-treatment.js`, `writer/writer.js`,
`writer/index.html`, `workflow/workflow.js`, `workflow/advisor-ui.js`,
`workflow/index.html`, `projects/lib-vault.js`, `js/project-badge.js`,
`scripts/run_all_tests.mjs`.

Files read in part: `workflow/advisor.js:1-186`, `timeline/parser.js:1-140,
500-707`, `timeline/timeline.js:33-45, 1650-1685`, `dashboard.html:2140-2230`,
`app.html:355-372, 2700-2732, 3339-3360, 3905-3945, 4085-4110, 6836-6870,
9285-9317`, `scripts/test_writer.mjs`, `scripts/test_workflow.mjs:1-30`,
`scripts/test_modules.mjs` (boards section), `scripts/test_csv_injection.mjs`
(boards section).

Executed (read-only, node, against the real library files):

- `TWriter.guessSlug('ACT ONE','')` → `'EXT. ONE - DAY'`;
  `'PART ONE'` → `'EXT. ONE - DAY'`; `'THE CALL'` → `'EXT. THE CALL - DAY'`.
- `TWriter.toFountain(parseTreatment('INT. BAR - NIGHT\n\nShe opens the file. MARA: "Who is this?"'))`
  → cue line `SHE OPENS THE FILE. MARA`.
- Mid-paragraph `MARA: "I'm done after this one."` → cue `MARA` / `I`, then a
  stray action line `m done after this one."`.
- Full Writer→Studio round trip on a 4-scene treatment: `SBParser.parse` yields
  scenes `["SCENE 1"(4 shots), "EXT. ONE - DAY"(0), "INT. LAW OFFICE - NIGHT"(4),
  "EXT. PARKING GARAGE - NIGHT"(2)]`; `scenesToClips` → 10 clips;
  `CShots.seedScenes({clips})` → 10 board scenes slugged
  `SC01 — Opening scene` … `SC10 — Opening scene`, every `desc === ''`.
- Boards `bdSeed` merge logic replayed on two same-slug scenes:
  `fresh[0].shots === fresh[1].shots` → `true`; the first duplicate's shots are
  dropped.
- `CShots.toCsv` header confirmed as
  `"Scene","Shot","Size","Angle","Move","Lens (mm)","Secs","Description"`.
- `node scripts/run_all_tests.mjs` → `44/44 suites passed` (baseline unchanged;
  no file in the repo was edited).

Greps behind the cross-module claims:

- `SB_Boards_v1` appears in exactly three non-test places:
  `boards/boards.js:5,10` and `dashboard.html:2181`. `workflow/` never reads it.
- `SB_WorkflowStaged`: one `getItem` (`app.html:3921`), three `removeItem`
  (`3429, 4095, 4103`), **zero** `setItem` anywhere in the repo.
- `SB_Projects_v1`: written only at `app.html:2725`, inside a branch guarded by a
  registry entry that nothing creates.
- `app.html` contains **no** reference to `SB_Timeline_v1`, `SB_Writer_v1` or
  `SB_Boards_v1` — the monolith shares no `SB_*_v1` store with this slice.
- `c.prompt` (read by `lib-shots.js:27`) exists nowhere on a clip; `parser.js:622`
  sets `description`.
- `c.dur` / `c.params.duration` / `c.duration` (read by `dashboard.html:2166`)
  exist nowhere on a clip; `parser.js:620` sets `durationSec`.
