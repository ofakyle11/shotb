# Development Executive & Story Editor

**Verdict up front.** No. A writer cannot take a one-line idea to a formatted,
revision-tracked shooting script here. Three links of the chain are absent and
two more are mislabelled:

| Link | State |
|---|---|
| idea → logline → treatment | **absent** — the Writer's precondition is that you already own a treatment |
| treatment → beats | works (`writer/lib-treatment.js:135`) |
| beats → screenplay | **mislabelled** — `toFountain` re-headers the treatment prose; it writes no dialogue and no screen direction |
| screenplay → formatted pages | **absent** — no pagination, no page view, no print, no PDF anywhere in the repo |
| pages → revisions | **mislabelled** — "Colored Pages" is a whole-file LCS diff with a colour name attached; there are no pages, no change-bars, no locked numbers |

Everything on the development path is deterministic regex. Nothing calls a
model: `netlify/functions/parse-script.js` has no caller in the repo and is not
in the deploy set, and the writers' wing of the agent crew is metadata over
placeholder files.

---

## What exists and works

- `writer/lib-treatment.js:25` — `docxParagraphs` walks OOXML `<w:t>`/`<w:tab/>`/`<w:br/>` correctly, joins split runs, decodes entities. Verified by `scripts/test_writer.mjs:27-31`.
- `writer/lib-treatment.js:46` — `cleanText` de-hyphenates line wraps (`deci-\nsion` → `decision`), drops "Page 3 of 12" furniture, and rebuilds real paragraphs from hard-wrapped PDF text. This is the right preprocessing and it is not obvious work.
- `writer/writer.js:27` — `readPdf` groups pdf.js text items by rounded `transform[5]`, treating a >20pt vertical gap as a paragraph break. Sound approach.
- `writer/index.html:26-28` — pdf.js and JSZip are served from `/static/vendor/`, not a CDN. The no-third-party-runtime constraint is respected.
- `writer/lib-treatment.js:88` — `guessSlug` infers INT/EXT and time-of-day from body cue words (`INT_CUES`/`EXT_CUES`/`NIGHT_CUES` at :83-86) and normalises an existing slugline instead of re-deriving it. Good instinct.
- `writer/lib-treatment.js:187` — `bodyToFountain` lifts `NAME: "line"` out of treatment prose into a real Fountain cue + dialogue, including mid-paragraph, splitting the action around it. This is the single smartest thing in the module.
- `tools/lib-script.js:14` — `diffLines` is a correct LCS differ using row-wise `Int32Array`. `diffStats:39` is honest about what it counts.
- `tools/lib-script.js:46` — the eleven production revision colours are in the correct industry order (White → Blue → Pink → Yellow → Green → Goldenrod → Buff → Salmon → Cherry → 2nd Blue → 2nd Pink).
- `timeline/parser.js:304-368` — `isScriptFlattened` / `unflattenScreenplay` reconstruct line breaks from a PDF paste blob (cue breaks, parenthetical splits, scene-block splits). Genuinely hard and genuinely useful; it is the difference between a usable and a useless PDF import.
- `timeline/parser.js:388` — `parseQualityWarning` tells the user the parse *failed* ("Many shots landed in fallback SCENE 1") rather than pretending. Rare and correct.
- `timeline/timeline.js:951` + `1015-1036` — `isClipReconstruction` / `renderScriptWarn` detect that the stored "screenplay" is regenerated clip junk, refuse to parse it, and offer a recovery path. Defensive engineering of exactly the right kind for a text field three modules write to.
- `timeline/parser.js:651` — `readFdx` imports Final Draft XML by paragraph `Type`, inserting a blank after Scene Heading and Transition so the line parser sees blocks. Correct.
- `screening/lib-screen.js:17-100` — `CScreen` is real notes machinery: sessions, timecoded notes, `open`/`addressed` status, `progress()`, marker and text export. It is keyed to a cut, not a draft — but the model is right and reusable (see Missing #3).
- `boards/lib-shots.js:99-114` — CSV formula-injection guard present and commented.
- `node scripts/run_all_tests.mjs` → **44/44 suites passed** (run 2026-08-26). `scripts/test_writer.mjs` carries 25 assertions on the treatment engine.

---

## What exists but needs work

### HIGH

- **`writer/lib-treatment.js:220` — `toFountain` does not write a screenplay.**
  Each beat body is emitted verbatim as action under an inferred slugline. No
  dialogue is generated, no prose is converted to present-tense screen
  direction, no parentheticals, no transitions, no act sections, no scene
  numbers. The pane is titled "3 · Screenplay draft" (`writer/index.html:81`)
  and the module ships a `.fountain` file (`writer/writer.js:203`), so a
  financier or a 1st AD opening it expects a screenplay and gets a treatment
  with sluglines on top. **Change:** either rename the pane and the export to
  what it is (a Fountain *skeleton* / formatted beat sheet), or add a real
  prose→screen-direction pass. The dishonest label is the bigger problem.

- **`writer/lib-treatment.js:101-102` — act and sequence headings are turned
  into fake locations.** The regex strips only the leading keyword, leaving the
  ordinal behind. Verified by running the engine:
  ```
  "ACT ONE"                → INT. ONE - DAY
  "ACT THREE"              → EXT. THREE - DAY
  "SEQUENCE 2 — THE HEIST" → EXT. — THE HEIST - NIGHT
  ```
  The three-act spine of a treatment becomes three invented locations, which
  then propagate into the Studio location bible and the stripboard. Note
  `scripts/test_writer.mjs:76` only asserts the slug *starts with* `INT.`, so
  the suite passes over this. **Change:** classify a heading as `structure`
  (ACT/PART/SEQUENCE/CHAPTER) vs `scene`; emit structure as Fountain `#`
  sections in `toFountain`, never as a slugline; strip a leading em-dash from
  the location.

- **`writer/writer.js:15` — `save()` swallows `QuotaExceededError` silently.**
  `try { localStorage.setItem(...) } catch (e) {}`. A writer typing beats into a
  full localStorage loses every keystroke with no signal at all. Compare
  `boards/boards.js:26`, which toasts "Storage full", and `writer/writer.js:215`,
  which does report on the Studio handoff — so the pattern is known and just
  not applied to the autosave. **Change:** toast on failure and pre-flight the
  serialised size.

- **`writer/writer.js:174-181` — no undo, and scene delete has no confirm.**
  Line 177 splices the scene out immediately. Reordering (178-179) is likewise
  unrecoverable. The Studio has `pushHistory()` / `updateUndo()`
  (`timeline/timeline.js:1652`, `:860`). A writing surface with a one-click
  unrecoverable scene delete is worse than a plain text editor. **Change:**
  reuse the Studio's history pattern; 20 states is enough.

- **The Writer → Studio handoff leaves the previous film's derived data in
  place.** `writer/writer.js:211-215` reads `SB_Timeline_v1`, sets only
  `scriptText` and `projectName`, and writes back — `clips`, `characters`,
  `locationBible` and `parseResult` all survive. `timeline/timeline.js:2013-2053`
  does **not** auto-parse on boot. So "→ Send to Studio" lands you in one of two
  wrong states: an empty import zone (`timeline.js:1143-1147`) while your script
  is already sitting in the editor, or the *previous* film's timeline with the
  *new* script behind it and no warning. **Change:** clear the derived keys on
  handoff and set a `pendingParse` flag that boot consumes.

- **Three modules write `SB_Timeline_v1.scriptText`; none of them versions it.**
  `writer/writer.js:213`, `producer/index.html:271` (`saveScriptToProject`, which
  explicitly preserves `d.clips = d.clips || []`), and
  `timeline/timeline.js:1071` (`syncScriptFromEditor`). None snapshots the
  outgoing text, bumps a revision, or invalidates the breakdown. Replacing the
  whole screenplay from the Producer Suite leaves the old stripboard and old
  character bible in place while the budget seeds off the new text. This is
  precisely the "which version is this?" failure coloured pages exist to
  prevent. **Change:** one `setScript(text, {reason})` chokepoint that
  auto-snapshots into `SB_Drafts_v1` before overwriting.

- **`timeline/timeline-budget.js:285-298` — eighths are measured in physical
  newlines, so unwrapped scripts under-measure by ~4×.** `splitScenes` does
  `eighths = max(1, round(lines.length / 5))` over raw non-blank lines. Real
  eighths are *typeset* lines at screenplay margins. Every Writer output and
  every "unflattened" PDF paste has unwrapped action paragraphs (my sample
  produced a 560-character single line). Measured on a 40-beat Writer draft:
  ```
  4,136 words (≈22 pages of action) → 40 scenes, 40 eighths → 5 pages
  ```
  That `pages` value drives `shootDays` (`timeline-budget.js:563-578`), the
  stripboard pace (`producer/schedule-board.js:89-108`) and the budget. A
  25-day shoot prices as a 3-day shoot. **Change:** wrap before counting —
  action at 60 chars, dialogue at 35, cue at 33 — i.e. `ceil(len/60)` per action
  line instead of 1.

- **`tools/tools-script-ui.js:21-89` — "Script Revisions — Colored Pages" is not
  colored pages.** Concretely:
  - Colour is `S.revColor(ds.length)` (lines 29, 50) — a function of array
    length. Delete draft #2 and the next snapshot silently takes Pink instead of
    Yellow. You cannot name, skip, re-order or date a revision.
  - The blurb (line 28) promises "industry asterisk change-bars"; `showDiff`
    (82-85) emits `<div class="ln add">` with **no asterisk** and no revision
    mark. The promise is not kept.
  - There are no pages. No pagination, no A-pages, no per-page colour, no
    "revised 8/26/26" header, no locked-page concept, no revised-pages-only
    output.
  - Source is `SB_Timeline_v1.scriptText` only (line 47), so a Writer draft is
    invisible to the revision history until pushed to the Studio.
  - Each draft stores the **full text** (line 50). Eleven colours of a feature
    ≈ 1.4 MB inside a 4 MB cloud archive cap
    (`netlify/functions/projects-sync.js:25`, `:244`) that also holds the boards'
    base64 frames. And `tools/tools-core.js:18-20` `save()` swallows the quota
    error, so a snapshot that does not fit reports "Blue draft locked" anyway.
  **Change, in order of value:** (1) store draft *N* as a diff against *N-1*;
  (2) explicit colour + date + author on each snapshot; (3) emit `*` in the left
  margin of changed lines; (4) build on a paginator so a "page" exists to
  colour at all.

### MED

- **`boards/lib-shots.js:22-34` — "Seed from script" builds one board scene per
  *shot*, labelled with placeholder text.** Studio clips are one-per-shot
  (`timeline/parser.js:609-611`), so a 40-scene feature with 300 shots becomes
  300 board "scenes". Each slug is `'SC' + num + ' — ' + c.label`
  (`lib-shots.js:27`), and `label` comes from the rotating placeholder list
  `['Opening scene','Character intro','Dialogue',…]` at `parser.js:607` — while
  the real slugline sits unused in `c.heading` (`parser.js:619`). **Change:**
  group clips by `sceneIdx`, slug from `heading`, keep the shots underneath.

- **`boards/boards.js:345-356` — coverage suggestions ignore the scene.** The
  handler reads the *global* character map and slices the first four, never
  touching `sc`, even though `lib-shots.js:41` takes a per-scene `characters`
  argument. In a two-hander you are offered singles on four people who are not
  in the room. **Change:** pass `parseResult.scenes[i].characters_present`
  (already computed at `parser.js:600`) or the selected clip's `characters`.

- **`writer/lib-treatment.js:111-132` — `extractCharacters` has no location
  filter.** Verified: `INT. ROOM - DAY` yields `characters: ["ROOM"]`. The
  Studio parser carries exactly this defence (`timeline/parser.js:171`
  `isLocationCaps`, `:217` `isCastMember`, `:264` `filterCharacterMap`); the
  Writer does not share it. Those chips (`writer/writer.js:116`) are the cast
  list the writer sees and trusts. **Change:** reuse the parser's filter, or at
  minimum reject any name that appears inside a slugline.

- **`writer/lib-treatment.js:242-260` — page and runtime estimates inflate ×3.5
  once you do the work.** `stats()` unconditionally applies the
  treatment→screenplay multiplier (line 257) even after the beats have been
  edited into screenplay-length prose, and `estRuntimeMin` is *defined* as
  `estScreenplayPages` (line 258) rather than derived. Verified: a 4,000-word
  script pasted into the Writer reports 32 pages / 32 minutes. This is the
  number `writer/writer.js:125` puts on screen and the number a producer would
  quote. **Change:** detect screenplay shape (sluglines + cue lines) and switch
  to a direct measure.

- **`writer/lib-treatment.js:150-154` — front matter leaks into the script.**
  The byline regex requires 2–60 characters after "by", so `by K` fails, falls
  through to the leading-prose branch (`:166-169`) and becomes scene 1 slugged
  `EXT. LOCATION - DAY`. Only block 0 is eligible to be the title (`i === 0`).
  **Change:** treat everything before the first heading as front matter.

- **No page view and no print path in the Writer.** `writer/writer.css:44`
  renders the draft as 11px monospace `pre` with `white-space:pre-wrap` — raw
  Fountain source. There is no `@media print` in `writer/writer.css` (there is
  one in `boards/boards.css`). Cinamate cannot produce a printed or PDF script
  anywhere. **Change:** a Fountain→paginated-HTML renderer at real screenplay
  margins gives page count, page breaks, printing, and later page colours from
  one piece of work (see Missing #5).

- **`workflow/workflow.js:37-50` — "Develop" is marked done at 200 characters.**
  `hasScript = script.trim().length > 200 || wrScenes.length > 0`. There is no
  notion of draft maturity, notes addressed, or a lock. `SB_Drafts_v1` is even
  read into `stores` at `workflow.js:214` and then never referenced by
  `assess()` — a dead read. **Change:** make Develop's status a function of
  drafts locked and open script notes.

### LOW

- **`netlify/functions/parse-script.js` is orphaned.** No client code calls it
  (repo-wide search for `parse-script` finds only the file itself), and
  `scripts/deploy_cinamate.mjs:295-309` uploads only `verify-owner`,
  `projects-sync` and `gate` — so it is never deployed. Its prompt is also a
  *production breakdown* (shots, wardrobe, props, atmosphere) rather than
  development analysis. Delete it, or repurpose the prompt for coverage.
- **The agent crew's writers' wing is metadata over placeholders.**
  `agents/registry.js` is a single line of prose; `agents/appliers.js` and
  `agents/prompt_enricher.js` are placeholder strings;
  `agents/normalizers.js:191-200` stubs out `parseSlug`, `extractCharacters`,
  `parseSceneBody`, `isLikelyCharacterName` to empty returns.
  `agents/client.js:26-56` advertises `script-doctor`, `beat-analyst`,
  `dialogue-coach`, `cliche-detector`, `subtext-writer`, `script-formatter`;
  none is reachable. Either build them or stop listing them.
- **`app.html:3795-3814` — `parseScript()` is dead code** (defined, never
  called) and uses a narrower slugline regex than `SBParser` (`:3799` rejects
  `1. INT.` and `SC5 INT.`). Delete before it drifts into use.
- **Fountain fidelity.** `toFountain` emits no transitions, parentheticals,
  centred text, dual dialogue, notes `[[ ]]`, boneyard or sections; the logline
  goes out as `= …` (`:230`), a synopsis line most apps hide. Import is worse:
  `writer/writer.js:65` accepts a `.fountain` file and then feeds it to
  `parseTreatment`, which reads screenplay lines as treatment prose.

---

## What is missing entirely

1. **Idea → logline → treatment. — Value: HIGHEST.**
   The Writer's entry condition is that you already have a treatment.
   `writer/index.html:62` gives you a logline textarea that nothing reads except
   the Fountain title page (`lib-treatment.js:230`). There is no premise
   capture, no logline builder, no synopsis, no one-pager, no treatment
   authoring surface — only import. This is the module named for the job, and it
   is the missing first link of the whole platform.
   *Attach to:* `writer/`. *Build:* a "0 · Premise" panel plus
   `TWriter.scaffoldTreatment(premise, {acts, beatsPerAct})` emitting the same
   beat shape the module already consumes. Pure, node-testable, vanilla, no
   server. Small.

2. **Beat sheet / act structure. — Value: HIGH.**
   No act, sequence, midpoint or structural model exists anywhere in the repo
   (searches for `beat sheet`, `three-act`, `act break` return nothing). The
   Writer is a flat scene list with no grouping (`writer/writer.js:106-118`),
   and `guessSlug` actively destroys the act markers a treatment does carry.
   *Attach to:* `writer/` as a `struct` field per beat + Fountain `#` sections
   on export; surface as a Develop metric in `workflow/`. Small.

3. **Script notes / reader's coverage. — Value: HIGH.**
   "Coverage" throughout this repo means *camera* coverage
   (`boards/lib-shots.js:41`, `dailies/lib-dailies.js:126`). Development
   coverage does not exist: no notes object, no Recommend/Consider/Pass, no
   per-scene comment, no notes-addressed tracking against a draft. Without it
   nothing can say *why* Blue became Pink.
   *Attach to:* `screening/lib-screen.js` — `addNote`/`setStatus`/`progress`/
   `exportText` (`:34-100`) is already the right model, merely keyed to
   `{sec}`. Add a mode keyed to `{draftId, sceneIdx, page}` and surface it in
   the Writer and in the Revisions tab. Moderate, mostly reuse.

4. **Locked scene numbers and A/B numbering. — Value: HIGH.**
   `timeline/parser.js:61` discards the printed scene number with a
   non-capturing group, and `parseSceneHeading` returns no `number` field.
   `timeline/parser.js:22` + `:514` skip a standalone scene-number line rather
   than capturing it. `dailies/lib-dailies.js:27-31` numbers scenes by array
   position (`n: i + 1`). So every downstream reference — dailies takes,
   `wardrobe/lib-ward.js:98-114` `sceneNums`, `safety/lib-safety.js:147-152`
   `sceneNumbers`, `vfx/lib-vfx.js:189-193` `byScene`, the stripboard — is keyed
   to a number that silently shifts the instant a scene is inserted. After a
   lock, real productions freeze numbers and add 14A; Cinamate cannot express
   that at all.
   *Attach to:* `timeline/parser.js` (capture into `scene.number`) plus a
   `lockNumbers()` in the Revisions tab that freezes the map and assigns
   A-suffixes to inserts. Parser change is small; the lock table is a small new
   lib. **This is the single change that makes everything after the lock
   trustworthy.**

5. **Pagination and locked pages. — Value: HIGH.**
   No page model exists (`paginat` appears nowhere outside eighths). Without
   pages there is no page count, no A-pages, no coloured pages, no
   revised-pages-only print, and the eighths measure has to guess from raw
   newlines (see HIGH #7).
   *Attach to:* a new `tools/lib-paginate.js` beside `tools/lib-script.js`,
   consumed by (a) a Writer page view, (b) `timeline-budget.js:285` for real
   eighths, (c) the Revisions tab for coloured and locked pages. Medium — the
   rules are well specified (≈55 lines/page; action 60ch, dialogue 35ch, cue at
   33ch indent). One module unblocks four broken things.

6. **Character arc / story fields. — Value: MED-HIGH.**
   `timeline/timeline-characters.js:3-7` `DEFAULTS` are `description, refUrl,
   faceLock, bodyType, wardrobe, voice, lipSync, emotion, lockMethod, role` —
   every field is a rendering parameter. No want, need, arc, relationship,
   first/last appearance or presence chart. The Story Bible register
   (`tools/tools-script-ui.js:98-112`) has a one-liner and a detail field and
   seeds names, which is a start, but has no per-scene link.
   *Attach to:* the Story Bible register + `timeline-characters.js`. A presence
   chart is nearly free — `characters_present` is already computed per scene at
   `timeline/parser.js:600`. Small.

7. **Comparable titles. — Value: MED.**
   Nothing carries comps. `producer/sales-forecast.js:175` `buyoutComps` is a
   price band, not a title list; genre is inferred by keyword count
   (`timeline-budget.js:302-323`) and is the only story input the forecast gets
   (`sales-forecast.js:200`, `:245`). A slate needs 3–5 named comps with
   budget/gross/year, and those should feed the forecast in place of a bare
   genre string.
   *Attach to:* a `comps` register in `tools/` — `tools/tools-core.js:58`
   `Register` gives CRUD, CSV and injection-safe export for free — read by
   `producer/sales-forecast.js:245`. Per the brief, any unverified figure gets a
   search link rather than an invented number. Small.

8. **Table read. — Value: MED.**
   Nothing in the repo (`table read`, `read-through` return nothing). A read
   produces three artefacts: per-character sides, a timed runtime per scene, and
   notes against scenes. Sides fall out of pagination (#5); the notes capture is
   (#3). Small once those exist.

9. **Rewrite tracking at scene granularity. — Value: MED.**
   `tools/lib-script.js:14` diffs whole-file lines. What a producer and a 1st AD
   need after a revision is *which scenes changed*. *Attach to:* align the diff
   ops to scene boundaries inside `tools-script-ui.js` `showDiff` and report
   changed scene numbers. Small on top of the existing differ.

10. **Draft provenance on derived artefacts. — Value: MED.**
    Clips, boards, strips, budget and DOOD carry no record of which draft they
    came from, so after a Pink revision nothing tells you the stripboard is
    still White. *Attach to:* stamp `srcDraft` in
    `timeline/parser.js:605 scenesToClips` and display it in the Studio header
    and the Producer top sheet. Small.

---

## Evidence

Files read in full or in the cited ranges. Every claim above traces to one of
these; the runtime results were produced by executing the shipped engine.

**Writer**
- `writer/lib-treatment.js` — whole file (274 lines). `:25 docxParagraphs`,
  `:46 cleanText`, `:67 SLUG_RE`, `:70 isHeadingLine`, `:83-86 cue regexes`,
  `:88-109 guessSlug` (`:101-102` act strip), `:111-132 extractCharacters`,
  `:135-184 parseTreatment` (`:150-154` front matter, `:166-169` leading prose),
  `:187-218 bodyToFountain`, `:220-240 toFountain` (`:230` logline as `=`),
  `:242-260 stats` (`:257` ×3.5, `:258` runtime = pages).
- `writer/writer.js` — whole file (231 lines). `:7 SB_Writer_v1`, `:15 save`,
  `:27-48 readPdf`, `:50-57 readDocx`, `:59-72 handleFile`, `:75-85
  buildFromText`, `:94-96 fountain`, `:106-118 renderCards`, `:121-127
  renderStats`, `:174-181 card actions`, `:198-206 download`, `:208-218
  wrToStudio`.
- `writer/index.html` — whole file. `:20 Google Fonts`, `:26-28 vendored
  pdf.js/JSZip`, `:42-89 three-pane layout`, `:59-62 project fields`, `:81
  "Screenplay draft"`, `:84-85 export buttons`.
- `writer/writer.css:44` — `.wr-fountain`; no `@media print` in the file.
- `scripts/test_writer.mjs` — whole file (101 lines); `:76` tolerates the act-slug bug.

**Boards**
- `boards/lib-shots.js` — whole file (124 lines). `:22-34 seedScenes` (`:27` slug
  from label), `:36 blankShot`, `:41-57 suggestCoverage`, `:73-87 animaticPlan`,
  `:99-114 csvCell/toCsv`.
- `boards/boards.js:1-110`, `:315-370` — `:26 save` toast, `:321-332 seed`,
  `:345-356 coverage` using the global character map.
- `boards/boards.css` — contains one `@media print`.
- `boards/index.html:55` — "Suggest coverage" button.

**Script parsing / Studio**
- `timeline/parser.js` — `:3-11 isSH`, `:13-19 isCC`, `:22 isSceneNumberOnly`,
  `:23-29 isTitlePageLine`, `:37-55 iT/iCm`, `:56-80 parseSceneHeading` (`:61`
  discards the scene number), `:82-101 inferLocation/inferTOD`,
  `:171 isLocationCaps`, `:217 isCastMember`, `:264 filterCharacterMap`,
  `:304-316 isScriptFlattened`, `:319-368 unflatten pipeline`,
  `:371-386 normalizeScriptText(Detailed)`, `:388-395 parseQualityWarning`,
  `:506-603 parse`, `:605-641 scenesToClips` (`:607` placeholder labels,
  `:609-611` one clip per shot, `:619` heading kept), `:643-689 readFile/readFdx/
  pdfItemsToLines`.
- `timeline/timeline.js` — `:19,38-39 state + SB_Timeline_v1 persistence`,
  `:830-871 renderAll/bootstrap`, `:929-949 scriptEditorText/flushScriptEditor`,
  `:951-955 isClipReconstruction`, `:1015-1036 renderScriptWarn`,
  `:1038-1060 script panel`, `:1062-1076 syncScriptFromEditor`,
  `:1078-1091 startNewScript`, `:1093-1121 unflattenScriptFromEditor`,
  `:1123-1140 reparseScriptFromEditor`, `:1142-1164 renderTimeline`,
  `:1643-1685 importText/importFile`, `:2013-2053 boot` (no auto-parse),
  `:2055 DOMContentLoaded`.
- `timeline/timeline-budget.js:275-370` — `:280-298 splitScenes` (eighths by
  newline count), `:302-323 inferGenre`, `:339-366 analyze`; `:563-578` shoot-day
  derivation from eighths.
- `timeline/timeline-characters.js:3-32` — `DEFAULTS`, `normalize`.
- `timeline/timeline-doc.js:1-100` — documentary estimator; no script role.
- `timeline/timeline-export.js:1-125` — EDL/zip; no script export.
- `app.html:2116 hFile`, `:2127-2223 parser` (`:2134 isSH`, `:2156 isTitlePageLine`,
  `:2176-2223 parse` delegating to `SBParser` at `:2179`),
  `:2225-2248 reverseProcess`, `:3791-3814 parseScript` (dead),
  `:3816-3849 character extraction`.

**Revisions / notes / bible**
- `tools/lib-script.js` — whole file (122 lines). `:14-37 diffLines`,
  `:39-43 diffStats`, `:45-49 REV_COLORS/revColor/revHex`, `:51-113 captions`.
- `tools/tools-script-ui.js` — whole file (263 lines). `:20-89 revisions`
  (`:28` change-bar promise, `:29,50` colour by count, `:47` source,
  `:75-87 showDiff` with no asterisk), `:91-129 Story Bible`,
  `:131-199 captions`, `:201-261 EPK`.
- `tools/tools-core.js:14-20` — `load`/`save`, quota error swallowed;
  `:58-161 Register`.
- `tools/index.html:52`, `:76` — Revisions tab wiring.
- `tools/tools-media-ui.js:197-215` — `SB_ReviewNotes_v1` is dailies/picture
  notes, not script notes.
- `screening/lib-screen.js:1-105` — `CScreen` notes sessions.
- `dailies/lib-dailies.js:27-31 sceneList` (positional numbering),
  `:125-143 coverageByScene`.

**Pipeline / storage / deploy**
- `workflow/workflow.js:1-70`, `:125-175`, `:200-240` — `:37-50 Develop stage`,
  `:213-214 stores` (`drafts` read, never used).
- `producer/index.html:138-152 script modal`, `:245-300 saveScriptToProject`
  and "Use this script".
- `producer/schedule-board.js:14-30, 60-110, 205-230` — eighths → strips → days.
- `projects/lib-vault.js:10-40, 177-300` — per-project snapshot slots
  (`KEY_RE`, `LOCAL_ONLY`); no draft versioning.
- `netlify/functions/projects-sync.js:25, 227-245` — 4 MB archive cap.
- `netlify/functions/parse-script.js` — whole file (91 lines); no caller.
- `scripts/deploy_cinamate.mjs:291-309` — only `verify-owner`, `projects-sync`
  and `gate` are shipped.
- `agents/client.js` — whole file (257 lines); `:23-79 AGENT_META`.
- `agents/normalizers.js:1-208` — `:191-200` stubbed functions.
- `agents/registry.js`, `agents/appliers.js`, `agents/prompt_enricher.js` —
  placeholder text, not code.
- `netlify.toml`, `.netlifyignore` — publish/functions fail closed.

**Executed (read-only, against the shipped engines)**
- `node scripts/run_all_tests.mjs` → `44/44 suites passed`.
- `TWriter.parseTreatment` + `toFountain` on an act-structured treatment →
  `ACT ONE` → `INT. ONE - DAY`; `ACT THREE` → `EXT. THREE - DAY`;
  `SEQUENCE 2 — THE HEIST` → `EXT. — THE HEIST - NIGHT`; `by K` → a scene
  slugged `EXT. LOCATION - DAY`.
- `TWriter.parseTreatment('INT. ROOM - DAY\n\n…')` → `characters: ["ROOM"]`,
  `estScreenplayPages: 32` / `estRuntimeMin: 32` on 4,000 words.
- `timeline-budget.js splitScenes` logic replayed over a 40-beat Writer draft
  (4,136 words, ≈22 pages) → 40 eighths → **5 pages**.
