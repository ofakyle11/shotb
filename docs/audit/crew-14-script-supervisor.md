# Script Supervisor

Judged as the person who holds continuity and the record of what was actually
shot, and who hands the editor a log they can cut from.

**Short answer to the brief's question.** A script supervisor could log a
serviceable *take log* from `/dailies/` on the day — the slate arithmetic is
correct and the phone UI is genuinely usable on set. They could **not** work a
full day from this platform, and the log they hand the editor is **not usable**:
the pull list is written to a key nothing reads, the DPR reads a different take
store than the one the logger writes, and no take has a duration, a screen
direction, a shot reference or a story day. There is a real take log and a real
circled take. There is no lined script, no eyeline/screen-direction continuity,
no page-vs-time, and no editor log beyond a list of circled slates.

---

## What exists and works

- `dailies/lib-dailies.js:36-78` — slate arithmetic done properly: bijective
  base-26 letters, `nextSlate` (same scene → take+1), `nextSetup` (12A→12B,
  12Z→12AA). This is the one piece that behaves the way a 2nd AC's chalk does.
- `dailies/lib-dailies.js:81-92` — `makeTake` normalises scene/slate/take,
  floors take at 1, uppercases the slate. Clean take record.
- `dailies/lib-dailies.js:93-101` — `sortTakes` orders day → scene → setup
  letter → take, non-mutating. Correct sort for a paper log.
- `dailies/lib-dailies.js:105-123` — `circleRate`, overall and per shoot day.
  Circle rate per day is a real production health metric.
- `dailies/lib-dailies.js:126-143` — `coverageByScene`: every script scene with
  zero takes, listed as a gap. This is the "did we actually get it" check.
- `dailies/lib-dailies.js:154-200` — camera and sound report text that mirrors
  the paper forms, circles marked `●`, NG reasons in brackets.
- `dailies/lib-dailies.js:175-176, 197-198, 220` — honest disclaimers: the app
  says to cross-check against the AC's and mixer's own sheets, and says outright
  that "Circles are the director's on-set preference — the cut is not bound by
  them." That is the correct professional posture and it is rare to see it coded.
- `dailies/index.html:78-97, 130-133` — phone-first logging: 52px inputs, a
  sticky `+ TAKE` / `● CIRCLE` bar, scene→slate→take prefill on input. This is
  workable one-handed on a set, which is the actual constraint.
- `dailies/index.html:88-89` — NG reasons as a fixed list (focus, boom in,
  performance, camera, sound, plane/noise, false start). The right vocabulary.
- `wardrobe/lib-ward.js:161-214` — `changePlot` produces a scene-by-scene grid
  plus three genuinely useful flags: QUICK CHANGE (adjacent scenes, different
  look), CONTINUITY SPAN (a look returns after a gap → photograph it), and
  CONFLICT (one character down for two looks in one scene).
- `wardrobe/lib-ward.js:228-257` — `sceneHazards` + `multiplesAdvice`: blood /
  rain / mud / tears / fights / water in the script text drive a multiples count,
  hedged as an estimate to confirm with stunts and SFX. Correct instinct.
- `wardrobe/index.html:132-166, 320-344` — real continuity photos, resized and
  held in IndexedDB, attached to a look and date-stamped.
- `producer/schedule-board.js:14-37` — eighths formatting and parsing that
  round-trips "1 7/8", "7/8", "2.5". `timeline/timeline-budget.js:285-298` sizes
  each scene at ~5 content lines per eighth — a rough but defensible measure.
- `timeline/timeline-continuity.js:14-20` — `continuityType()` reads CONTINUOUS
  / LATER / SAME TIME / FLASHBACK / INTERCUT off the slugline. That is the
  story-time axis, already parsed, even though it is currently only used to
  enrich AI prompts.
- `production/production.js:157-173` — the continuity Register at least names
  the right columns: scene, setup, circled take, screen direction, wardrobe,
  matching notes. The vocabulary is right even where the behaviour is not.
- `today/index.html:44` — the call sheet view links straight to `/dailies/`.
- 44/44 test suites pass (`node scripts/run_all_tests.mjs`), and
  `scripts/test_dailies.mjs` covers CDailies seriously — ~35 assertions across
  slate math, sorting, circle rate, coverage and both reports.

---

## What exists but needs work

- **`production/lib-prod.js:30` — the DPR's printed/circled count is always
  zero. HIGH.**
  `dpr()` tests `t.status || t.print`. The only thing in the platform that
  writes `SB_TakeLog_v1` is the Tools slate at `tools/tools-media-ui.js:74`,
  which stores the field as **`grade`** (`tools/tools-media-ui.js:44`, options
  `— / Circled ⭕ / Good / NG / False start`). Verified by running the real row
  shape through `CProd.dpr`: 3 takes, 2 of them Circled/Good → `printedCount: 0`.
  The DPR is the document the production office and the financier read; it
  reporting zero circled takes every single day makes the whole report
  worthless. Fix: test `t.grade || t.status || t.print` in the filter. The
  reason this survived is `scripts/test_modules.mjs:96`, whose fixture uses
  `status:'print'` — a shape nothing in the app writes — so the suite is green
  over a broken feature. That fixture should be replaced with the real slate row.

- **`production/lib-prod.js:27` — the DPR date filter is a no-op. HIGH.**
  The filter is `!t.date || t.date === date`. Slate rows carry `time` (HH:MM),
  never `date` (`tools/tools-media-ui.js:74`), so `!t.date` is true for every
  row and **every take ever logged is counted on every day**. Verified: two
  takes logged three weeks apart both report on both dates. A DPR that reports
  cumulative totals as the day's work misstates the day to everyone downstream.
  Fix: stamp a `date` on the slate row at write time, and make the filter
  require a match rather than treating a missing date as a match.

- **Two disconnected take logs. HIGH.**
  `dailies/index.html:142` persists the good take log to `SB_Dailies_v1`.
  `tools/tools-media-ui.js:38` persists a second, thinner one to
  `SB_TakeLog_v1`. `production/production.js:220` builds the DPR from
  `SB_TakeLog_v1` only. So a full day logged in the Dailies module — the module
  the platform points a script supervisor at, and the one with circles, NG
  reasons, lenses and rolls — **never reaches the daily production report**. And
  `production/production.js:159` actively misdirects, telling the user
  "Take-by-take capture lives in Tools → Slate & Takes" when the better logger
  is at `/dailies/`. Fix: make `dpr()` read `SB_Dailies_v1.takes` (normalising
  `circled` → printed), keep `SB_TakeLog_v1` as a fallback so no live owner
  loses data, and correct the pointer text.

- **`dailies/index.html:308` — "Send picks to Editor" goes nowhere. HIGH.**
  It writes `SB_DailiesPicks_v1`. A repo-wide grep finds no reader. The Editor
  uses `SB_Cut_v1` (`editor/cut-ui.js:15`) and `SB_Editor_v1`
  (`editor/timeline-engine.js:42`). The toast promises "the Editor can use it as
  a pull list" and the Editor cannot. This is the single most important handoff
  in the script supervisor's job and it is a dead end. Fix: have the Editor read
  `SB_DailiesPicks_v1` and render it as a pull list panel beside the bin.

- **`dailies/lib-dailies.js:84-91` — no take has a length. HIGH.**
  The take record has `tcIn` but no `tcOut`, no duration, no wall-clock stamp.
  A script supervisor times takes; that is where page-count-vs-time,
  scene timings, the estimated runtime, and the DPR's "3 1/8 pages, 4:12 of
  screen time, 14 setups" all come from. Without it the platform can count takes
  but cannot say how long the day's work runs, which is what the editor and the
  post supervisor both need. Fix: add `tcOut` and a derived `durSec` to
  `makeTake`, then roll up per scene and per day.

- **`editor/lib-cut.js:17, 150, 183` — the cut carries no take identity. HIGH.**
  A clip is `{id, srcId, label, in, out, speed, trans}` — no scene, no slate, no
  take. The EDL hardcodes reel `AX` on every event (`:150`) and the OTIO
  `metadata` is `{}` (`:183`). Both are exactly where scene/slate/take belong,
  and both are free. Consequence: nothing can trace a shot in the cut back to a
  circled take or a continuity note, so no reverse-direction editor log is
  possible at all. Fix: add optional `scene`/`slate`/`take` to the clip, emit
  the slate as the EDL reel and `* FROM CLIP NAME`, and populate OTIO `metadata`.

- **`production/production.js:160-173` — the continuity log is a flat table that
  checks nothing. MED.**
  `circled` is free text, not a reference to a logged take, so it can drift out
  of agreement with `SB_Dailies_v1` silently. `direction` is a per-row select
  (`L→R / R→L / Neutral`) that is never compared against the adjacent setup, so
  the one thing this column exists to catch — a crossed line — is never flagged.
  Fix: make `circled` a picker sourced from the take log for that scene, and add
  a derived warning when two consecutive setups on the same scene carry opposite
  directions with no neutral between them.

- **`dailies/lib-dailies.js:88` — C camera is silently rewritten to A. MED.**
  `camera: cam === 'B' ? 'B' : 'A'`. Anything that is not `B` becomes `A`,
  including `C`, `D` and `X`. The UI only offers two buttons
  (`dailies/index.html:83`), and `scripts/test_dailies.mjs:55` asserts the
  coercion as correct behaviour. On any multi-cam day the camera report is
  wrong and the AC's real reports will not reconcile. Fix: accept a single A–Z
  letter, default to A, and widen the UI to a small text/segmented input.

- **`dailies/lib-dailies.js:84-91` + `dailies/index.html:265-268` — unit is not
  on the take. MED.**
  `makeTake` has no `unit` field. `unitFor(day)` returns the **first**
  `st.days` record matching the date, ignoring unit. Shoot MAIN and 2ND on the
  same date and both collapse into one report, headed with whichever unit was
  created first. Splinter and second-unit days are exactly when a script
  supervisor's separate log matters most. Fix: put `unit` on the take, filter
  `dayTakes` by day **and** unit, and title the report from the take's unit.

- **`wardrobe/lib-ward.js:191` — the change plot only knows script order. MED.**
  `for (s = 1; s < n; s++)` compares scene *s* to scene *s+1*. Wardrobe never
  reads `SB_ScheduleBoard_v1` (its consumers are `production/lib-prod.js`,
  `production/production.js`, `producer/schedule-board.js`, `today/index.html`,
  `workflow/workflow.js` — not wardrobe, not props, not dailies). A quick change
  in script order is often not a quick change on the day, and a change that *is*
  brutal on the day — scene 42 pre-fight then scene 12 clean, back to back — is
  invisible. Fix: pass the board's day assignment into `changePlot` and emit a
  second set of flags computed in shooting order.

- **`wardrobe/index.html:337-340` — continuity photos carry no scene or take.
  MED.** The caption is `character · look · date`. A continuity still exists to
  answer "what did this look like at *this moment*" — scene 42, take 3, collar
  unbuttoned, blood on the left cuff. Without a scene number and a free-text
  state note, the photo library cannot settle a matching argument. Fix: add
  `scene`, `slate`, `take` and `note` to the photo record and to the caption.

- **`timeline/timeline-continuity.js:232-277, 288-322` — one screenplay's content
  is hardcoded into a shared engine, and it misfires. MED.**
  `applyCrowdRules` triggers on `/\b(?:ninety|90)\b/i` anywhere in the script or
  clip text, then fabricates a `VORSANGER` character with a hardcoded 50s /
  military haircut / white nametag description (`:241`) and a `CROWD_CLONES`
  entry (`:239`), and `applyBlockCastRules:306-315` injects VORSANGER into every
  clip in the block. Any unrelated screenplay containing the standalone token
  "90" — "he's doing 90 on the freeway" — gets a fictional lead character
  inserted into its cast and continuity record. For a script supervisor, whose
  entire value is that the record is trustworthy, silently invented cast is
  worse than a missing feature. Fix: move the VORSANGER/crowd rules behind an
  explicit per-project opt-in, and drop the bare `\b90\b` trigger.

- **`props/lib-props.js:144-145` — props have no continuity state. MED.**
  An item is `{id, name, cat, scenes, qty, mode, hero, period, value, actual}` —
  purchasing fields only. There is no per-scene condition (intact / torn /
  bloodied / burned / empty / full), no hero-prop photo, no "which take was the
  glass full". Prop condition across a scene shot out of order is one of the
  three things a script supervisor is actually watching. Fix: add a
  `states: [{scene, condition, note, photoId}]` array to the item.

- **`production/lib-prod.js:38` — the scene list sorts as strings. LOW.**
  `Object.keys(scenes).sort()`. Verified: scenes 1, 2, 9, 10 print as
  `1, 10, 2, 9`. Trivial, but it is on the face of the DPR. Fix: numeric-aware
  comparator that still tolerates `12A`.

- **`production/lib-prod.js:32` — hot costs are never date-filtered. LOW.**
  `hot.reduce(...)` sums every posting; `SB_HotCost_v1` rows *do* carry a date
  (`tools/tools-money-ui.js:122`). The label says "to date"
  (`production/lib-prod.js:57`), so it is honest rather than wrong — but a DPR
  normally carries the day's figure alongside the running total.

- **`dailies/index.html:283-300` — the coverage check asks the wrong question at
  wrap. MED.** `renderCoverage` compares the take log against the *whole
  screenplay*. At wrap the script supervisor's question is "did we get
  everything scheduled for **today**". Dailies never reads
  `SB_ScheduleBoard_v1`, so it cannot answer it, even though `today/index.html`
  already renders today's scenes from that store. Fix: read the board, and show
  today's scheduled scenes with a got-it / did-not-get-it mark first, with the
  whole-script view below it.

---

## What is missing entirely

- **Lined script with facing pages** — the central artifact of the job, and it
  does not exist in any form (`lined script` appears once in the whole repo, as
  a crew-role description string at `workflow/advisor.js:122`). A lined script
  is the scene text with a vertical line drawn down it for each camera setup,
  covering the lines that setup is on, squiggled where the actor is off camera;
  the facing page carries the take-by-take notes. It is what proves a scene is
  covered, and it is the first thing an editor asks for. Attach to `boards/`
  (the shot list is already the coverage source) + `dailies/` (takes) +
  `timeline/` (`scriptText`). Build: a scene-text renderer emitting one span per
  line, an absolutely-positioned SVG overlay drawing one vertical line per shot
  across its line range, and a facing-page panel of that scene's takes. The
  scene splitting already exists at `dailies/lib-dailies.js:15-26`. Medium
  build. **Value: highest of anything in this report.**

- **Story day** — completely absent (a repo-wide grep for `storyDay` /
  `scriptDay` / "story day" returns nothing). Story day is the axis every other
  continuity decision hangs off: wardrobe state, hair length, beard growth,
  injury makeup, prop condition, and whether an actor is allowed to look rested.
  Without it, `wardrobe`'s change plot and `props` are both reasoning about
  scene numbers, which is not the same question. Attach to the `timeline/`
  parse as a per-scene field, then feed `wardrobe/lib-ward.js:changePlot` and
  `producer/schedule-board.js`. Half the inference already exists —
  `timeline/timeline-continuity.js:14-20` already classifies CONTINUOUS /
  LATER / FLASHBACK off the slugline; story day is the running counter over
  that. Small-to-medium build. **Value: very high.**

- **Screen direction and eyeline continuity** — the platform stores a direction
  (`production/production.js:167`) and never compares it to anything, and no
  shot record has an eyeline at all (`boards/lib-shots.js:36-38`:
  `{id, size, angle, move, lensMm, desc, img, dur}`). This is the error that
  costs a reshoot: an actor exits frame right and enters frame right in the next
  scene, or two singles are shot from the same side of the line so the
  characters both look camera-left and never appear to be talking to each other.
  Attach to `boards/lib-shots.js` (add `screenDir` and `eyeline` to `blankShot`)
  and surface the check in the continuity register. Build: per scene, per
  character, hold entry/exit direction and eyeline side; flag adjacent setups
  that reverse without a neutral or an on-screen crossing. Small build.
  **Value: very high — it is the classic error, and it is cheap to catch.**

- **Reconciliation of planned coverage against obtained coverage** — the shot
  list and the take log never meet. A shot has no "covered" state
  (`boards/boards.js:44-68` renders size/angle/move/lens/duration/description
  and nothing else); a take has no shot reference (`dailies/lib-dailies.js:84-91`).
  So no one can answer the question the script supervisor exists to answer at
  wrap: *what did we plan to shoot that we did not get?* Attach: add `shotId`
  to `makeTake`, a derived `covered` per shot, and a per-scene "coverage
  obtained vs planned" panel in `/dailies/`. Small build. **Value: very high.**

- **Take timings and page-count-vs-time** — see the HIGH above; separately, no
  stopwatch, no scene timings, no estimated-runtime-vs-actual reconciliation
  anywhere. `producer/schedule-board.js` measures pages and
  `timeline/timeline-doc.js:76-80` guesses a runtime from word count, but
  nothing measures what was actually shot. The script supervisor is who supplies
  "we are running long by six minutes" — the earliest reliable warning a
  production gets. Attach to `dailies/`. Small build. **Value: high.**

- **A real daily editor log** — `editorPicks` (`dailies/lib-dailies.js:203-222`)
  is a list of circled slates, which is not an editor's log. A usable one carries,
  per take: why it was circled, the director's stated preference between takes,
  series/pickup relationships ("take 5 is a pickup from 'and then he turns'"),
  wild lines and room tone, MOS flags, and the continuity caveats that decide
  whether two takes can be cut together ("take 4 has the wrong glass"). Attach
  to `dailies/` → `editor/`, together with making the Editor read
  `SB_DailiesPicks_v1`. Medium build. **Value: high — it is the deliverable the
  brief asks about.**

- **Setups per day** — a headline DPR figure that nothing counts, even though
  `nextSetup` (`dailies/lib-dailies.js:70-78`) already understands exactly what
  a setup is. Derivable in a few lines: distinct `parseSlate(t.slate).ord` per
  scene per day. Attach to `dailies/lib-dailies.js` and surface in
  `production/lib-prod.js:dpr`. Tiny build. **Value: moderate, cost near zero.**

- **Hair and makeup continuity** — exists only as a budget line
  (`timeline/timeline-budget.js:699`, `11000 · Makeup & hair`) and as an advisor
  crew row (`workflow/advisor.js:121`). There is no department module, no
  per-scene state, no photos. HMU continuity is co-equal with wardrobe in a
  script supervisor's day, and `wardrobe/lib-ward.js:161-214` is already the
  right model to clone. Attach as a sibling of `wardrobe/`, or as a second
  look-type inside it. Medium build. **Value: high.**

- **MOS, wild lines and room tone as take flags** — currently a placeholder in a
  Notes column heading (`production/production.js:202`, "Notes (wild lines,
  room tone)"). These need to be flags on a take so the sound report and the
  editor log can list them. Attach to `dailies/lib-dailies.js:makeTake`. Small
  build. **Value: moderate.**

- **Script revision colours and change tracking** — no revision colour (white,
  blue, pink, yellow, green…), no A-pages, no locked scene numbers, no
  "which draft was this scene shot from". On any show that revises during
  production, the script supervisor is the authority on which version reached
  the floor, and there is nothing here to be the authority with. Attach to
  `writer/` + `timeline/`. Medium build. **Value: high on any revising show,
  none on a locked script.**

---

## Evidence

Files read in full:
- `docs/audit/BRIEF.md`
- `production/lib-prod.js` (182 lines)
- `boards/lib-shots.js` (123 lines)
- `dailies/lib-dailies.js` (233 lines)
- `dailies/index.html` (335 lines)
- `wardrobe/lib-ward.js` (275 lines)
- `props/lib-props.js` (355 lines)
- `timeline/timeline-continuity.js` (392 lines)
- `scripts/test_dailies.mjs` (109 lines)

Files read in part, with the lines cited above:
- `production/production.js:1-280` (continuity pane `:157-173`, DPR pane
  `:209-237`, camera/sound registers `:181-205`)
- `tools/tools-media-ui.js:1-120` (slate + `SB_TakeLog_v1` register `:37-51`,
  row written at `:74`)
- `tools/tools-money-ui.js:60-130` (`SB_Timecards_v1` `:72`, `SB_HotCost_v1`
  `:118-127`)
- `editor/lib-cut.js:1-215` (clip model `:13-21`, EDL `:142-156`, OTIO
  `:162-215`)
- `boards/boards.js:200-340` (shot card markup `:44-68`, seeding `:322`)
- `producer/schedule-board.js:1-120` (eighths `:14-37`, strips `:56-87`)
- `timeline/timeline-budget.js:275-315` (`splitScenes` + eighths `:285-298`)
- `post/lib-post.js:1-60`
- `wardrobe/index.html:110-345` (IndexedDB photos `:132-166`, photo render
  `:320-344`)
- `workflow/advisor.js:110-135`
- `today/index.html:40-135`

Claims verified by execution, not by reading:
- `CProd.dpr` returns `printedCount: 0` for real slate rows where two of three
  are graded `Circled ⭕` / `Good` — the `status || print` vs `grade` mismatch.
- `CProd.dpr` returns the same `takeCount` for two different dates when rows
  carry no `date` field, i.e. the date filter is a no-op against real slate rows.
- `CProd.dpr().scenesCovered` returns `["1","10","2","9"]` — string sort.
- `node scripts/run_all_tests.mjs` → **44/44 suites passed** (baseline
  unchanged; this audit edited no source file).

Absences verified by repo-wide grep (excluding `node_modules/` and
`static/vendor/`):
- `SB_DailiesPicks_v1` — written once (`dailies/index.html:308`), read nowhere.
- `storyDay` / `scriptDay` / "story day" — zero occurrences.
- "lined script" — one occurrence, a crew-role description string
  (`workflow/advisor.js:122`).
- "eyeline" — zero occurrences.
- `SB_ScheduleBoard_v1` readers — `production/lib-prod.js`,
  `production/production.js`, `producer/schedule-board.js`, `today/index.html`,
  `workflow/workflow.js`. Not `dailies/`, not `wardrobe/`, not `props/`.
- `SB_Continuity_v1` — written and read only by the single Register at
  `production/production.js:161`.
