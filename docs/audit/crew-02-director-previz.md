# Director — previz, coverage, blocking, dailies-to-cut

Verdict up front, since the brief asks a direct question: **no, the loop does
not close.** A director can draw a shot list, and separately can stand up a set
and look through a lens, and separately can log takes on the day. None of those
three things knows the other two exist. The shot list has no idea what a scene
is (it thinks a scene is one AI clip), the lens view has no idea what shape the
frame is (it is the shape of the browser window), and nothing anywhere compares
what was planned to what was shot to what ended up in the cut.

The individual pieces are better than that summary sounds. The 3D geometry
engine is genuinely good work. The failure is at the seams.

---

## What exists and works

- **`sets/lib-set3d.js:24-456`** — a real, clean, DOM-free 3D engine: profiles
  with sensible real-world heights (`PROFILES`, :32-52), column-major matrix
  maths (:75-133), quad meshes with proper winding (:152-245), Möller–Trumbore
  picking (:323-348), OBJ and STL export (:399-439). The rotation sign is
  correct and the comment at :141-146 shows somebody already caught and fixed
  the mirror bug. This stands a plan the art department drew with no re-entry.
- **`sets/gl.js:96-404`** — a hand-written WebGL viewport with no third-party
  code, a per-foot floor grid brightened every ten (:155-168), wireframe camera
  frustums drawn for every camera on the plan (:172-200), and a clean fallback
  to the 2D plan when WebGL is unavailable (:100, :106-108, `sets/index.html:176-183`).
  The 2D plan and the 3D view edit the same items with no conversion step —
  drag a wall in plan and it moves in 3D (`sets/index.html:310-314`).
- **`sets/lib-set.js:88-146`** — the top-down plan renders to a standalone SVG
  with a 5-foot scale bar and the plan name/dimensions burned in (:139-144).
  That is a drawing you can actually hand to a construction coordinator.
- **`dailies/lib-dailies.js:36-101`** — the slate arithmetic is right. Bijective
  base-26 so 12Z rolls to 12AA (:45-50), `nextSlate` continues a scene and
  `nextSetup` bumps the letter (:59-78), and `sortTakes` sorts by day → scene →
  setup → take the way a script supervisor's log reads (:93-101). The camera and
  sound reports (:154-200) are the classic layout.
- **`screening/lib-screen.js:79-81` → `editor/cut-ui.js:206-207`** — the one
  director loop that genuinely closes: timecoded notes taken while watching a
  cut become clickable markers on the Editor ruler. This is the model every
  other hand-off in this platform should copy.
- **`boards/boards.js:193-266`** — the animatic exporter is real: WebCodecs into
  the project's own MP4 muxer, with a slate renderer for un-framed shots
  (:176-183) and a live MediaRecorder WebM fallback (:255-265).
- **`producer/schedule-board.js:56-68`** — the stripboard collapses clips back
  into real scenes by grouping on `c.heading`. It is the only module that does
  this correctly, and it is the pattern Boards should be copying (see below).
- **`tools/lib-media.js:59-84`** — a proper nine-entry sensor table (Super 35,
  17:9, full frame, ALEXA LF/65, V-RAPTOR VV, MFT, S16, phone) with HFOV, VFOV,
  coverage-at-distance and full-frame equivalent. This already exists and is the
  fix for the Sets lens problem below.

---

## What exists but needs work

### HIGH — the Boards module does not know what a scene is

`boards/lib-shots.js:22-34`. `seedScenes` maps **one board scene per Studio
clip**, and a Studio clip is one action-line beat, not a scene. I ran it:

```
input:  a 2-scene screenplay (INT. KITCHEN - NIGHT / EXT. FIRE ESCAPE - CONTINUOUS)
output: 12 board "scenes" —
        SC01 — Opening scene      SC07 — Climax
        SC02 — Character intro    SC08 — Resolution
        SC03 — Dialogue           SC09 — Epilogue
        SC04 — Action beat        SC10 — Opening scene   ← the labels just cycle
        ...
```

Those names come from `timeline/parser.js:607`, a nine-item array cycled by
`labels[(n-1)%labels.length]` (:617). The real slugline is sitting right there
on `c.heading` (:619) and is thrown away. A feature with 60 scenes seeds ~400
board "scenes" named "Reaction shot" and "Epilogue" on repeat. **A director
cannot plan coverage of a scene here because the module has no scene.**

Second defect in the same eight lines: `desc: c.prompt || ''` (:27). No clip
ever carries a `.prompt` — the prompt is built on demand by
`timeline/timeline.js:288-310`. The field is `description` (`parser.js:622`).
So every seeded board scene has an empty description, always. Verified.

**Change:** group clips by `c.heading` exactly as
`producer/schedule-board.js:61-67` already does, use the heading as the slug,
and read `c.description`. Roughly 15 lines. This one fix is the difference
between the Boards module being usable and being decorative.

### HIGH — a 35mm lens has three different answers on the same page

`sets/lib-set.js:80-83` computes FOV against a **full-frame** 36mm gate.
`sets/lib-set3d.js:373-379` computes it against **Super 35** (24.89 × 18.66).
And `sets/gl.js:255` feeds the vertical Super 35 FOV into a perspective matrix
whose aspect is `canvas.width / canvas.height` — the shape of the browser panel.

| lens | 2D plan cone | 3D wireframe frustum | actually rendered (16:9 panel) |
|------|--------------|----------------------|-------------------------------|
| 24mm | 73.7° | 54.8° | ~63° |
| 35mm | **54.4°** | **39.1°** | **50.7°** |
| 50mm | 39.6° | 28.0° | ~38° |

Worse: the rendered figure moves when you resize the window (39.1° at a 4:3
panel, 50.7° at 16:9). The caption under the view says `S.fovDeg(lens)` —
the full-frame number — while the picture above it is neither
(`sets/index.html:204-206`), and the inspector note says "(full-frame)"
(`sets/index.html:97`) about a Super 35 render. Both behaviours are locked in by
tests that assert opposite things: `scripts/test_set.mjs:39` demands 54.4° for a
35mm, `scripts/test_set3d.mjs:136` demands 27.9° for a 50mm.

A director who blocks a scene off that plan and then confirms it through the
lens is being shown a 15-degree lie, and the DP will find out on the day.

**Change:** one sensor of record. Add a per-plan format picker sourced from
`tools/lib-media.js:59-69`, have `CSet.fovDeg` delegate to `CSet3D.lensFov`, and
letterbox the GL viewport to the chosen capture aspect instead of filling the
div. Update both test suites to the single source.

### HIGH — the lens view has no frame

Related but separate. There is no aspect ratio, no frame line, no safe-action or
safe-title guide, no ground glass of any kind. `gl.js:240-287` paints edge to
edge of the div. The Studio's only aspect options are 16:9 / 9:16 / 1:1
(`timeline/index.html:74-78`); **2.39:1 and 1.85:1 do not exist anywhere in this
repo** (grepped). The board frame is hard-coded 16:9 in CSS
(`boards/boards.css:22`) and uploads are force-cropped to 480×270
(`boards/boards.js:132-135`).

You cannot judge a composition without knowing where the edges are. A director
shooting scope has nowhere in this platform to say so.

**Change:** a format field on the plan (2.39 / 1.85 / 1.78 / 1.33 / 4:3 / 9:16),
a letterbox mask over the GL canvas, and the same ratio applied to
`.bd-frame`'s `aspect-ratio` and the board thumbnail crop.

### HIGH — you cannot capture what you see through the lens

`sets/gl.js:395-398` has `snapshot()`, and `gl.js:98` sets
`preserveDrawingBuffer: true` specifically so it will work. **Nothing calls it.**
Grepped the whole repo. The `⬇ PNG` button (`sets/index.html:374-389`) exports
the 2D SVG plan, not the 3D view.

Meanwhile `boards/boards.js:101-106 setShotImg(shotId, dataUrl)` accepts exactly
the kind of data URL `snapshot()` returns, and the shot card already has three
frame-source buttons (`boards.js:47-51`).

So the single highest-value previz feature on the platform — *stand up the set,
put the camera on its mark, look through the real lens, and put that frame on
the storyboard* — is one wired button away and is not wired. This is the loop
closure. **Build this first.**

### HIGH — a boarded shot has no stable number

`boards/boards.js:65` labels a shot `'shot ' + (i + 1)` from its array index,
and `boards/lib-shots.js:94` exports the same index to CSV. Drop an insert in
ahead of shot 12 and every shot after it silently renumbers. On a real
production a setup number is an immutable identifier — it is chalked on the
slate, printed on the camera report, marked on the lined script and typed into
the editor's bin. Renumbering on reorder means the shot list cannot be
referenced by anyone.

**Change:** assign a permanent `setup` string on creation (`12A`, `12B` — the
bijective letter maths already exists at `dailies/lib-dailies.js:45-50`), display
that, export that, and never derive it from position.

### HIGH — boards will run out of storage on a real film

Frames are 480×270 JPEGs stored as base64 data URLs in `localStorage`
(`boards/boards.js:109-111`, `:132-136`), inside one `SB_Boards_v1` blob
(`:26`). At roughly 25–40 KB per frame, a 400-shot feature is 10–16 MB against a
5–10 MB quota. On overflow `save()` catches, toasts "Storage full", and **the
edit is lost silently** — the director keeps typing into a document that is no
longer being written.

The Editor already solved this: `editor/cut-ui.js:32-59` puts media blobs in
IndexedDB (`cinamate_cut`) and keeps only ids in localStorage.

**Change:** move frame blobs to IndexedDB behind the same idb helpers; keep
`{id, size, angle, move, lensMm, dur, desc, frameId}` in the JSON.

### MED — the coverage suggestion does not know who is in the scene

`boards/boards.js:345-356` pulls `tl.characters` — the **whole film's** cast map
— and takes `Object.keys(...).slice(0, 4)`. On a two-hander it will suggest
singles on whichever four names happen to be first in the map, including
characters who are not in the room.

The parser already computed the right answer twice: `sc.characters_present` and
per-shot `characters_in_frame` (`timeline/parser.js:594-600`), and every clip
carries `characters` (`:626`).

Also weak in `lib-shots.js:41-57`: coverage is always master + singles + insert
regardless of what the scene is. `SIZES` includes `OTS` (:13) and
`suggestCoverage` never generates one — for a dialogue scene the OTS/reverse
pair *is* the coverage. No establisher on a new location, no cutaway, no
reaction. And `boards.js:353` uses `concat`, so pressing "Suggest coverage"
twice silently duplicates the whole set.

**Change:** take cast from the scene's own clips; branch the pattern on whether
the scene has dialogue (OTS pair + singles + reverse) or is action (master +
inserts + coverage of the geography); make it idempotent.

### MED — the printed board has no header, and prints one scene at a time

`boards/boards.css:66` and `:68` style a `.bd-print-head` element. **No element
with that class exists** — grepped `boards/` and `app.html`. So the printed
sheet carries no production title, no scene slug, no date, no page numbers.

And `boards/boards.js:361` is `window.print()` against `#bdShots`, which
`renderShots()` (:72-77) fills with the **currently selected scene only**. A
60-scene film is 60 separate print operations, each producing an unlabelled page.

**Change:** render every scene into a hidden print container with a per-scene
header (production, scene slug, page, date), or offer "print this scene / print
all".

### MED — the animatic is silent, and the muxer supports sound

`boards/boards.js:245-250` passes `buildMp4` a single video track.
`editor/lib-mp4.js:5-6, 153-205` already carries an AAC audio track with a
proper `esds`/AudioSpecificConfig. An animatic with no scratch dialogue and no
temp music cannot be used to time a scene — which is the only reason to cut one.
Also hard-coded 12 fps (`boards.js:196`) with no project frame rate; the Editor
project carries `fps` (`editor/lib-cut.js:16`).

**Change:** let a shot carry a scratch audio blob or pull dialogue from the
parsed scene; feed the audio track through; take fps from the cut project.

### MED — "look through" cannot tilt, cannot roll, and cannot switch cameras

`sets/lib-set3d.js:382-393`. `cameraView` returns
`target = [eye.x + sin(r)*10, h, eye.z - cos(r)*10]` — the target's Y is always
the eye's Y. **The camera is permanently dead level.** There is no tilt, no
Dutch. Meanwhile the shot list offers High, Low, Dutch, Overhead and Ground
angles (`boards/lib-shots.js:14`). You cannot preview any of them.

Switching cameras is also awkward: `sets/index.html:226-239` locks onto `cams[0]`
unless a camera was already selected, and `sets/index.html:243` disables
selection while locked — so you must exit look-through, reselect, and re-enter.

**Change:** add `tilt` and `roll` to a camera item, apply them in `cameraView`,
and add prev/next-camera buttons on the GL bar. `orbitEye` (:122-133) already
proves the spherical maths is understood.

### MED — a blocking mark has no facing and no path

`sets/lib-set3d.js:216-222 personQuads(cx, cz, h)` takes no rotation, and
`:259` calls it without one. The 2D stencil is a circle with a symmetric
crosshair (`sets/lib-set.js:111-113`) — the `rotate()` on the group is invisible
on that shape. So an actor mark cannot indicate which way the actor is facing.

That kills eyelines and the 180-degree line at the root. There is no line of
action anywhere in this repo (grepped for axis / eyeline / 180). Screen
direction is captured — as a free-text select on a script-supervisor register
(`production/production.js:167`) — with no geometric backing.

**Change:** give `person` a facing arrow in both 2D and 3D from the existing
`rot`; then a two-mark line-of-action check falls out almost free, and a camera
placed on the wrong side of it can be flagged.

### MED — three separate take logs, and the DPR reads the wrong one

| module | key | what it holds |
|---|---|---|
| `dailies/index.html:142` | `SB_Dailies_v1` | the good one — slates, circles, lens, TC, reports |
| `tools/tools-media-ui.js:38` | `SB_TakeLog_v1` | a flat register behind the tap-slate |
| `production/production.js:161` | `SB_Continuity_v1` | script-supervisor setups |

`production/lib-prod.js:21-47 dpr()` reads `SB_TakeLog_v1`
(`production/production.js:220`). A director who logs the day in the dedicated
Dailies module gets a Daily Production Report that says **"Scenes covered: none
logged"**.

And `dailies/index.html:306-309` "Send picks to Editor" writes
`SB_DailiesPicks_v1` — **nothing in the repo reads that key.** The button
reports success into a void.

**Change:** make `SB_Dailies_v1` the single take log; have `dpr()` read it; have
the Editor read `SB_DailiesPicks_v1` into a bin filter.

### MED — the Workflow board has no previz stage

`workflow/workflow.js:39-161` defines seven stages: Develop, Breakdown, Budget,
Schedule, Generate, Review, Deliver. `gather()` (:199-217) reads fourteen keys
and **`SB_Boards_v1`, `SB_SetDesign_v1` and `SB_Dailies_v1` are not among them.**

So "pipeline mission control" cannot see the shot list, the sets, or the day's
takes. The director's own deliverables are invisible to the tool that tells the
production what is done. "Review" (:132-142) counts approved AI clips, not
circled takes.

**Change:** insert a **Previz** stage between Breakdown and Budget reading
`SB_Boards_v1` + `SB_SetDesign_v1` (scenes boarded / shots framed / sets built),
and point "Review" at `SB_Dailies_v1`.

### HIGH (platform-wide, hits the director first) — short screenplays are shredded on import

`timeline/parser.js:377`:
`if(lineCount<20 && t.length>250) return unflattenScreenplay(t);`

A correctly formatted screenplay with fewer than 20 non-blank lines and more
than 250 characters is run through the PDF-repair path **even though
`isScriptFlattened` correctly returned false**. Reproduced on an 8-line,
319-character, properly broken scene:

```
in:   INT. KITCHEN - NIGHT
      MARA stands at the sink. Rain hammers the window...
      HANK enters, soaked through to the skin...

out:  heading  "INT. KITCHEN -"        ← time of day amputated
      shot 1   description "NIGHT"     ← TOD became a shot
      shot 2   MARA (dialogue): "stands at the sink."      ← action → dialogue
      shot 6   HANK (dialogue): "enters, soaked through to the skin."
```

That is every short film, commercial, music video, pilot cold-open, and every
single test scene a new user pastes in to try the tool. The corrupted slugline
then propagates into the location bible, the Boards slugs, the Dailies coverage
check, and the Producer stripboard — all of which key on the heading.

**Change:** trust `isScriptFlattened`. Delete the line-count shortcut, or gate it
on the text actually having no blank lines between blocks.

### LOW — the set plan's scene tags go nowhere

`sets/index.html:94` offers a "Scenes" field on each plan ("e.g. 4, 12, 18A") and
`lib-set.js:42` stores it. **No module reads `plan.scenes`.** Tag a set with the
scenes it serves and nothing happens. It should drive a scene → set lookup from
Boards and the stripboard.

### LOW — the shot list CSV is not a shot list

`boards/lib-shots.js:90-98` exports Scene, Shot#, Size, Angle, Move, Lens, Secs,
Description. Missing everything a 1st AD needs: setup number, cast in shot,
location/set, shoot day, page eighths, special equipment (dolly / crane /
Steadicam is folded into "Move"), and notes. "Secs" is screen time, which is not
what a shot list carries — the useful number is estimated setup time.

---

## What is missing entirely

- **Lined script.** *Value: HIGH.* The director's and script supervisor's
  primary artefact: the screenplay with a vertical line down each page for every
  setup, showing exactly which lines that setup covers, solid where the actor is
  on camera and squiggled where they are off. It is how coverage is planned,
  how it is checked on the day, and how the editor knows what exists.
  Attaches to `boards/` (shot ↔ script-range link) rendering over
  `SB_Timeline_v1.scriptText`. Build: add `startLine`/`endLine` to a board shot,
  a click-drag selection over the script text, and an SVG line gutter beside the
  page. ~250 lines plus a print stylesheet. **This is the single biggest hole in
  the director's toolkit here.**

- **Coverage completeness warnings.** *Value: HIGH.* Nothing anywhere says "you
  boarded a master and two singles for scene 14 and you have not boarded the
  reverse", or "scene 22 has dialogue for three characters and one single".
  `dailies/lib-dailies.js:126-143 coverageByScene` gets as far as *scene-level*
  gaps ("this scene has zero takes") and stops. Attaches to `boards/lib-shots.js`
  as a pure `coverageGaps(scene, cast, dialogueLines)` returning warnings, shown
  on the scene rail chip (`boards.js:31-35`) and rolled into the DPR. ~120 lines.

- **Shot-to-cut conformance.** *Value: HIGH.* A cut clip is
  `{id, srcId, label, in, out, speed, trans}` (`editor/lib-cut.js:13-21`) — no
  scene, no slate, no shot id — and the EDL only carries `label`
  (`:142-157`). So there is no way to ask the two questions a director asks at
  the end of every reel: *did everything I shot make it in*, and *what is in the
  cut that I never planned*. Attaches to `editor/lib-cut.js` (add
  `scene`/`slate`/`shotId` to a video clip, carried into `edl()` comment lines
  and `otio()` metadata) plus a conformance view. ~200 lines. Depends on the
  stable setup numbers above.

- **Overhead blocking diagram with actor paths.** *Value: HIGH.* The set plan has
  static blocking marks with no facing (see above) and no motion. A director's
  blocking diagram is numbered positions (1, 2, 3) with arrowed paths between
  them, beat-matched to the script, plus the camera's own move drawn on the same
  page. Attaches to `sets/` as a `path` array on a `person` item plus a beat
  index, rendered as an arrowed polyline in `lib-set.js:toSVG` and as a floor
  ribbon in the 3D view. ~200 lines. Pairs with the lined script.

- **Director's notes / a tone-and-reference board.** *Value: MED-HIGH.* There is
  a poster compositor (`boards/boards.js:272-308`) and nothing for the thing a
  director actually assembles first: a reference wall — stills, palettes,
  lens/format intent, per-scene tone notes, the "look book" that goes to the DP,
  the designer and the colourist. Attaches to `boards/` as a third tab beside
  Storyboards and Key art. Reuses the existing upload and frame-grab paths.
  ~180 lines. Needs the IndexedDB move first.

- **Shot priority (must / should / could).** *Value: MED-HIGH.* `blankShot`
  (`lib-shots.js:36-38`) has no priority field. When the day collapses — and it
  always does — the director and the 1st AD drop shots. Doing that off a plan
  made in prep is a different film from doing it in a panic at 6pm. One enum on
  a shot, a colour on the card, a "must-haves not yet shot" line on the DPR.
  ~40 lines. Cheapest high-value item in this report.

- **A route between Boards and Sets.** *Value: MED.* `boards/index.html:37-39`
  links to Dashboard, Editor, Studio. `sets/index.html:65-67` links to Dashboard,
  Props, Studio. Neither links to the other. The two halves of previz — the shot
  list and the space it happens in — never meet, in the nav or in the data. A
  shot should name the set plan and the camera item it was framed from; a camera
  on a plan should name the shot it serves.

- **Overhead / plan-view lens preview.** *Value: MED.* `gl.js` clamps orbit pitch
  to 85° (:318) so a true top-down of the set with all frustums overlaid — the
  view a director and DP actually argue over — is unavailable. `orbitEye`
  already handles the pole case (`lib-set3d.js:126`); it is a UI clamp, not a
  maths limit.

- **A DP/gaffer hand-off packet.** *Value: MED.* Exports today are per-artefact:
  SVG, OBJ, STL, PNG plan, shot-list CSV, animatic MP4. There is no single
  "prep packet" — scene sluglines, boards, shot list, set plans with camera
  marks and lens list, blocking diagrams — as one PDF or ZIP. `jszip` is already
  loaded (`timeline/index.html:25`). ~150 lines of assembly over existing
  exporters.

- **A test suite for `boards/lib-shots.js`.** *Value: LOW-MED.* Boards is covered
  only inside `scripts/test_modules.mjs:75-91` — and `:78` actually asserts the
  broken behaviour (`scenes[0].slug.includes('Opening')`). Every other module of
  this size has its own `scripts/test_*.mjs`. Once seeding is fixed, that
  assertion must be inverted to demand the slugline.

---

## Evidence

Files read in full: `docs/audit/BRIEF.md`; `boards/lib-shots.js`,
`boards/boards.js`, `boards/index.html`, `boards/boards.css`;
`sets/lib-set3d.js`, `sets/gl.js`, `sets/lib-set.js`, `sets/index.html`;
`dailies/lib-dailies.js`; `workflow/workflow.js`; `scripts/run_all_tests.mjs`.

Read in part: `timeline/timeline.js` (:1-80, :288-313, structure map),
`timeline/parser.js` (:30-55, :301-400, :491-640), `timeline/index.html`;
`editor/lib-cut.js` (:10-50, :142-230), `editor/cut-ui.js` (:32-59, :206-207),
`editor/lib-mp4.js` (:150-210); `production/lib-prod.js` (:15-60),
`production/production.js` (:150-230); `producer/schedule-board.js` (:1-200);
`screening/index.html` (:82-172), `screening/lib-screen.js`;
`tools/lib-media.js` (:55-95), `tools/tools-media-ui.js` (:25-260);
`dailies/index.html` (:140-320); `dashboard.html` (:2160-2230);
`scripts/test_modules.mjs` (:70-95), `scripts/test_set3d.mjs`,
`scripts/test_set.mjs`, `scripts/test_csv_injection.mjs`;
`writer/lib-treatment.js` (:90-260); `workflow/advisor.js` (:1-60).

Claims executed rather than read:

1. Ran `SBParser.parse` + `SBParser.scenesToClips` + `CShots.seedScenes` on a
   2-scene screenplay under node → 12 board scenes named from the cycling label
   array, all descriptions empty, both sluglines lost. Confirms
   `boards/lib-shots.js:22-34` against `timeline/parser.js:605-640`.
2. Ran `SBParser.normalizeScriptText` on an 8-line / 319-char correctly
   formatted scene → `isScriptFlattened` false, `unflattenScreenplay` applied
   anyway, `INT. KITCHEN - NIGHT` → `INT. KITCHEN -` + a `NIGHT` shot, and two
   action lines converted into character cues with dialogue. Confirms
   `timeline/parser.js:377`.
3. Computed the three FOV figures from the three formulas in
   `sets/lib-set.js:80-83`, `sets/lib-set3d.js:373-379` and
   `sets/gl.js:255`: 35mm = 54.4° / 39.1° / 50.7° (at a 16:9 panel; 39.1° at
   4:3). Table above.
4. Grepped the whole repo (excluding `node_modules`, `static/vendor`,
   `private/`) and verified as absent: any caller of `CSetGL.snapshot`; any
   reader of `SB_DailiesPicks_v1`; any reader of `plan.scenes`; any element
   carrying `.bd-print-head`; any occurrence of `2.39`, `1.85` or `anamorphic`;
   any occurrence of a 180-degree line, line of action or eyeline.
5. Grepped `SB_Boards_v1` → read only by `boards/boards.js` and
   `dashboard.html:2181`. `SB_SetDesign_v1` → `sets/index.html:110` and
   `props/index.html:219`. Neither appears in `workflow/workflow.js:199-217`.

No file was modified. Two throwaway node scripts were written to the session
scratchpad, not to the repo.
