# Colourist & Finishing Supervisor

Short answer to the two questions I was asked:

**Is there real colour management?** No. There is exactly one piece of genuine
colour code in the repo — a correct `.cube` 3D LUT parser with trilinear
interpolation at `tools/lib-media.js:15-56` — and it is stranded in a
stills-only preview tab, working on 8-bit sRGB `ImageData`, wired to nothing.
The Editor's "Color" section is four CSS canvas filters. There is no working
space, no display space, no transform, no LUT on a clip, and the string
"HDR" does not appear anywhere in the product except as a CSS class name for
a page header (`app.html:94`). A repo-wide grep for `rec709 | bt2020 | PQ |
HLG | ACES | nits | EOTF | gamut | Dolby Vision` returns zero hits in any
module file.

**Could this produce a deliverable a streamer would accept?** No, and not
close. The best master this platform can emit is 1920×1080 H.264 in an MP4
that carries no `colr` box (undefined primaries/transfer/matrix), a hardcoded
`und` language tag, no `ctts` box (so B-frames would play out of order), and
32-bit chunk offsets that overflow on a feature-length file. Frame rates are
24 and 30 only — not 23.976, not 25, not 29.97. Audio is 128 kbps stereo AAC
with no loudness measurement and no limiter. Titles are burned in with no
textless pass. There is no ProRes, no DNx, no IMF, no DCP, no captions
attached to the master, and no per-territory version.

What *is* here, and is genuinely good, is the paperwork around finishing: the
post calendar, the version-naming convention, the buyer-shaped delivery
checklist, and a competent caption QC. The platform knows the *names* of the
deliverables. It cannot make them.

---

## What exists and works

- `tools/lib-media.js:15-31` — `parseCube()` is a correct IRIDAS/Adobe `.cube`
  reader: handles `TITLE`, `LUT_3D_SIZE`, `DOMAIN_MIN/MAX`, rejects 1D LUTs
  explicitly, and validates the row count against `size³`. This is real.
- `tools/lib-media.js:34-46` — `sampleLut()` is a correct trilinear
  interpolation with red varying fastest, matching the spec. Verified against
  the identity round-trip test at `scripts/test_tools.mjs:118-125`.
- `tools/tools-media-ui.js:259-318` — the Look/LUT pane does a real
  before/after split with an intensity blend slider and a PNG export. For
  showing a director a look on a frame, it works.
- `tools/lib-script.js:69-97` — SRT and WebVTT parse/write, both directions,
  BOM-stripped, `MM:SS.mmm` VTT short form handled, cues sorted. Round-trip
  stability is tested at `scripts/test_tools.mjs:52-59`.
- `tools/lib-script.js:99-113` — `captionQc()` checks reading speed (20 cps),
  line length (42 chars), 3+ line cues, and overlaps. Those are the right four
  checks and the thresholds are the conventional ones. This is the single best
  piece of finishing-QC code in the repo.
- `post/lib-post.js:19-34` — the milestone template has the correct post
  topology: turnover fans out to conform, grade, sound edit and VFX in
  parallel; QC gates on grade + mix + VFX finals; DCP after QC. Somebody who
  has actually supervised post wrote this.
- `post/lib-post.js:118-174` — the schedule solves forward or backward with
  business-day arithmetic and an exact translation-invariant offset for the
  backward solve, plus a real longest-path critical path. Solid, and it never
  touches `Date.now()`, so it is testable.
- `post/lib-post.js:183-189` — `versionName()` produces `Project_DC_v03`.
  Correct convention, correct abbreviations at `post/lib-post.js:177-182`.
- `distribution/lib-dist.js:15-50` — the 23-item delivery schedule and the
  five buyer presets are accurate to what buyers actually issue. Textless
  backgrounds for broadcast, M&E for broadcast, DME stems for a streamer,
  five items for a festival. This list is right.
- `production/lib-prod.js:147-167` — a second, broadly consistent delivery
  template. Correctly flags "Textless master (**if titles are burned in**)".
- `editor/lib-mp4.js:209-239` — the MP4 writer is real and structurally
  correct: two-pass chunk-offset resolution with a drift assertion at
  `editor/lib-mp4.js:232`, run-length `stts`, `stss` correctly omitted when
  every sample is a sync sample (`editor/lib-mp4.js:190`), and a legal
  4-byte expandable descriptor length in `esds` (`editor/lib-mp4.js:44-54`).
  Writing a playable MP4 by hand in vanilla JS is not a small thing.
- `editor/lib-cut.js:366-378` — `autoColor()` is an honest 5/95 percentile
  stretch plus a mid-grey pull, clamped to sane ranges. As a one-click
  balance for a rough cut it is fine and it does what it says.
- `screening/lib-screen.js:79-90` — notes convert to Editor markers and
  `progress()` reports `locked: true` only when every note is addressed. That
  is the right definition of a picture-lock signal.
- `dailies/lib-dailies.js:51-78` — bijective base-26 slate arithmetic
  (`12A → 12B … 12Z → 12AA`). Correct, and correct is not common.

---

## What exists but needs work

- **`editor/lib-cut.js:355-362` — the "grade" is a look filter, not colour.**
  `cssFilter()` emits `brightness/contrast/saturate/sepia/hue-rotate` and
  `editor/cut-ui.js:305` hands that straight to `ctx.filter` on an 8-bit sRGB
  canvas. "Warmth" is implemented as sepia in one direction and a hue rotation
  in the other (`editor/lib-cut.js:359-360`) — those are not inverses of each
  other, so a warmth slider swept through zero does not travel a continuous
  path, and neither operation is a white-balance. A production cannot grade on
  this: there is no working space, no per-clip LUT, no lift/gamma/gain, no
  curves, no secondaries, no scopes, and no way to see two clips side by side
  to match them. **Change:** add `lut: {id, mix}` to the clip model, load the
  `.cube` through the existing `TMedia.parseCube`, and apply it in
  `drawFrame()` via a WebGL 3D-texture pass (a `<canvas webgl>` sampler is ~60
  lines and needs no dependency); keep `cssFilter` as the CPU fallback. Then
  add a reference-frame A/B and an RGB parade built from the histogram code
  already at `editor/cut-ui.js:501-505`. **HIGH.**

- **`tools/lib-media.js:49-56` — the LUT path is display-referred and
  disconnected.** `applyLutToPixels()` divides by 255 and multiplies back by
  255, so any log-encoded source is fed to the LUT already crushed to 8-bit
  sRGB by the browser's decode. A show LUT applied that way does not match
  what the grade will look like, which defeats the purpose of a look preview.
  It is also reachable only from a stills tab: it never touches the Editor,
  the Studio timeline, Dailies Review, or the export. **Change:** move the LUT
  application into the Editor's draw path (above) and into
  `tools/tools-media-ui.js:146-216`'s review player so a DIT can watch dailies
  through the show LUT. **HIGH.**

- **`tools/tools-media-ui.js:262` — the Look tab tells the user to "grab a
  frame in Dailies Review", and there is no grab button.** `TTabs.review` at
  `tools/tools-media-ui.js:146-216` has load, play, ±1 frame, draw, clear and
  note — no frame export, and the drawing canvas is a separate overlay from
  the video, so even a manual `toDataURL` would return only the annotation.
  The advertised workflow does not exist. **Change:** one button that composites
  `rvVid` onto a canvas and hands the dataURL to the Look tab. **MED.**

- **`editor/cut-ui.js:702` vs `editor/lib-cut.js:15` — the export frame rate
  and the project frame rate are different numbers and never reconciled.**
  `var fps = +$('edFps').value` is a local in `exportMp4()`; `project.fps` is
  set once to 24 by `blank()` and nothing in `cut-ui.js` ever writes it (grep:
  the only assignments to `.fps` are reads at lines 205, 238, 303, 351, 387).
  Export at 30 fps and you get a 30 fps master, a 24 fps EDL
  (`editor/lib-cut.js:142`), a 24 fps OTIO (`editor/lib-cut.js:161`) and a
  24 fps timecode readout. Every record timecode in the turnover then
  disagrees with the master by 25%. An online editor conforming from that EDL
  produces garbage. **Change:** make `edFps` write `project.fps` and re-render.
  Three lines. **HIGH — this is a conform-breaking defect, not a gap.**

- **`editor/lib-cut.js:150` — the EDL writes `C` (cut) for every event.** The
  cut engine supports `crossfade` and `fadeblack` (`editor/lib-cut.js:59-77`)
  and neither survives the EDL: no `D` event, no dissolve duration field, no
  `EFFECTS NAME` comment. `editor/lib-cut.js:163-230`'s OTIO is worse — it
  emits no `Transition.1` objects at all and drops the entire titles track.
  So the one thing an EDL/OTIO turnover exists to do — let the online suite
  reproduce the offline — is exactly what these two exporters cannot do.
  **Change:** emit paired `C`/`D` events with the dissolve length in the EDL,
  and `Transition.1` children plus a third `Track.1` for titles in the OTIO.
  **HIGH.**

- **`editor/lib-cut.js:151` — every EDL source timecode starts at
  00:00:00:00 and every reel is `AX`.** `tc(c.in, fps)` is an offset into the
  file, not camera timecode, and the bin item shape
  (`editor/cut-ui.js:75`: `{id, name, kind, dur, w, h, origin, idb, url}`)
  has no field for a tape/reel name or a start TC. Meanwhile Dailies already
  captures `tcIn`, `soundRoll` and `lens` per take
  (`dailies/lib-dailies.js:81-92`) and throws them away at the module
  boundary. The OTIO has the same hole: `media_references` at
  `editor/lib-cut.js:175-181` carries `target_url` and `name` but no
  `available_range`, so Resolve assumes source TC zero — and for
  `origin:'file'` clips the `target_url` is a bare filename
  (`editor/cut-ui.js:921`), while for Studio clips it is a `blob:` URL that
  is dead the moment the tab closes. Neither export can relink to originals.
  **Change:** add `tcStart` and `reel` to the bin item, populate from the
  Dailies take log where the labels match, write `available_range` into the
  OTIO and the real reel into the EDL. **HIGH.**

- **`editor/cut-ui.js:757-762` — the master MP4 is untagged.**
  `editor/lib-mp4.js:141-152`'s `avc1Entry` writes no `colr` box, so
  colour primaries, transfer characteristics and matrix coefficients are all
  undefined and every player guesses. `editor/lib-mp4.js:122` hardcodes
  language `0x55c4` = `und` on every track. Both are automatic QC failures on
  any streamer spec, and `colr` is about twenty bytes: `box('colr',
  str('nclx'), u16(1), u16(1), u16(1), [0x80])` for Rec.709 full-swing-flag
  off. **Change:** write `colr` from a new project-level display-space
  setting, and a real ISO-639-2 language from a track field. **HIGH — cheapest
  high-value fix on this list.**

- **`editor/cut-ui.js:722-730` — no `ctts` box, but B-frames are not
  disabled.** The first codec tried is `avc1.640028` (High 4.0,
  `editor/cut-ui.js:704`) and `VideoEncoderConfig.latencyMode` is never set,
  so it defaults to `quality`, under which Chromium's encoders may emit
  B-frames. The output callback pushes chunks in emission (decode) order,
  `stts` is written with uniform durations
  (`editor/cut-ui.js:759`), and `editor/lib-mp4.js` contains no `ctts`
  anywhere. If the encoder ever returns B-frames, the master plays frames out
  of order. **Change:** either set `latencyMode: 'realtime'` in the config
  (one line, disables B-frames in Chromium) or write a `ctts` from
  `chunk.timestamp`. **HIGH — silent picture corruption is the worst kind.**

- **`editor/lib-mp4.js:80-84` — `stco` is 32-bit, so a feature cannot be
  exported.** `buildMp4` also materialises the whole payload in one
  `new Uint8Array(total)` (`editor/lib-mp4.js:233`). At the bitrate formula
  `W*H*fps*0.12` (`editor/cut-ui.js:707`), 1080p24 is ≈ 5.97 Mbit/s, so a
  100-minute feature is ≈ 4.48 GB — past the 4.29 GB `stco` ceiling and past
  what a browser will hand you as a single ArrayBuffer. The tool is
  structurally a short-form tool. **Change:** switch to `co64` above 4 GB and
  stream to a `File System Access` writable handle instead of buffering.
  **MED** (it only bites at feature length, but it bites absolutely).

- **`editor/index.html:90-97` — 1080p and 24/30 fps is the whole ladder.**
  No UHD, no 2K/4K DCI, no 23.976, no 25, no 29.97 drop-frame — and
  `editor/lib-cut.js:131-140`'s `tc()` assumes an integer fps with no
  drop-frame handling, while `editor/lib-cut.js:144` hardcodes
  `FCM: NON-DROP FRAME`. 23.976 is the frame rate of essentially every US
  streaming deliverable. **Change:** add 23.976/25/29.97/50/59.94 and UHD to
  the dropdowns, make `tc()` drop-frame aware, and derive the `FCM:` line.
  **HIGH.**

- **`editor/cut-ui.js:320-336` — titles are burned in with no textless
  pass.** `drawFrame()` always renders the title track and there is no
  toggle, yet `production/lib-prod.js:150` and
  `distribution/lib-dist.js:18` both list a textless master as a required
  deliverable. The tool that creates the problem refuses to solve it.
  **Change:** an "Export textless" checkbox that skips the `C.titlesAt` block.
  Genuinely a five-line change for a required deliverable. **HIGH — best
  effort-to-value ratio in this report.**

- **`editor/cut-ui.js:628-655` — the mix sums to hard clipping with no
  metering.** Every video clip's audio is connected to `ctx.destination` at
  unity with no gain node at all (only the A1 track gets one, line 648), and
  `OfflineAudioContext` hard-clips anything past ±1.0 on render. Two clips
  with dialogue at −6 dBFS sum to 0 dBFS and any music on top of that
  distorts. There is no peak read-out, no limiter, no loudness figure, and no
  per-clip level on the video track — so you cannot duck production sound
  under score. Every delivery spec in the world states a loudness target;
  this cannot report one. **Change:** a gain node per video clip exposed in
  the inspector, a limiter before `destination`, and a true-peak + integrated
  loudness read-out after render. **HIGH.**

- **`editor/cut-ui.js:659` — audio is 128 kbps stereo AAC, always.** No 5.1,
  no printmaster, no M&E, no stems — yet `distribution/lib-dist.js:20-23`
  requires all four for a streamer and `post/lib-post.js:27-29` schedules ten
  days of sound edit and five of mix to produce them. 128 kbps is a screener
  rate, not a master rate. **Change:** at minimum raise the bitrate and expose
  it; the multichannel work belongs in a real audio bay. **MED.**

- **`editor/cut-ui.js:338-345` — reframing is one hardcoded rule with no
  control.** `drawCover()` letterboxes when the target is wide and crop-fills
  when it is tall or square. So a 2.39:1 cut exported at 1.78 gets black bars
  baked into the picture — which most streamer specs reject, since they want
  native active picture — and a 16:9 source going to a 9:16 social version
  gets a centre crop with no way to pan. **Change:** per-clip
  `reframe: {scale, x, y}` plus a fit/fill/native choice at project level.
  **MED.**

- **`production/production.js:329-355` — "Delivery QC" is a to-do list, not
  QC.** The register has `group / item / status / notes` with a status
  dropdown containing "in QC" and "passed". Nothing measures anything.
  Nothing knows what spec it is passing. A deliverable marked "passed"
  carries no evidence, no filename, no checksum, no date and no operator.
  **Change:** attach each row to a named spec (below), require a file
  reference and a checksum from the existing MHL code
  (`tools/lib-media.js:88-127`) before a row can go to "passed", and stamp who
  and when. **HIGH.**

- **`distribution/lib-dist.js:52-75` — delivery state is a single global set
  of ticks.** `store.done` is one flat `{id: bool}` map shared by every buyer,
  so switching `store.buyer` (line 58) re-shows the same ticks. You cannot
  record that the UK broadcaster has its M&E but the German one does not, and
  a "delivered" tick names no file, no version and no date. For a picture
  going out to more than one licensee this is the whole job. **Change:** key
  `done` by `buyer|territory`, and make each entry `{done, version, file,
  sha256, date, by}` rather than a boolean. **HIGH.**

- **`distribution/lib-dist.js:86-94` — `windowConflicts()` never reads a
  date.** It flags any two exclusive rows sharing territory + channel as a
  clash, ignoring `w.start` entirely, and `addWindow` (line 78-84) has no end
  date at all. A 2027 SVOD deal that begins after the 2026 deal expires shows
  as a permanent false conflict, which trains the owner to ignore the warning.
  **Change:** add `end`, and compare intervals rather than keys. **MED.**

- **`screening/lib-screen.js:19` — session fps is hardcoded 24 with no UI.**
  `screening/index.html` reads `sess().fps` at lines 112 and 127 and never
  writes it. Review a 25 fps or 23.976 cut and every timecode in the notes and
  every marker sent back to the Editor is wrong. Worse,
  `screening/lib-screen.js:35` rounds `sec` to one decimal — 0.1 s is about
  2.4 frames at 24 — so a note reading "one-frame flash at 01:12:03:07" can
  never be recorded frame-accurately. Frame-accurate notes are the entire
  reason a post house runs a review tool. **Change:** an fps selector on the
  session, and store `sec` at frame precision (`Math.round(sec*fps)/fps`).
  **HIGH.**

- **`screening/lib-screen.js:17-23` — a session does not record which version
  it is notes on.** `newSession` takes title, author and date. Nothing links
  to `CPost.versionName` (`post/lib-post.js:183`), which already exists and
  already produces the right string. Notes taken against `Film_EC_v03` get
  applied to `Film_DC_v01` with no warning — the classic way a fixed note
  gets un-fixed. **Change:** a `version` field on the session, seeded from
  the Post Supervisor's versions log. Small change, real protection. **HIGH.**

- **`workflow/workflow.js:152` — "Final export" ticks green when nothing has
  been exported.** `ok: revDone || cutExported` short-circuits on `revDone`,
  which is only "every Studio clip approved" (line 131). A project that has
  never produced a single master file reports "Deliver — 4/4 finishing steps,
  done" on the one screen the owner uses as mission control. **Change:** drop
  the `revDone ||`. One line. **MED.**

- **`workflow/workflow.js:133-160` — the pipeline jumps Review → Deliver with
  no finishing stage.** There is no conform, no grade, no mix, no QC gate,
  even though `post/lib-post.js:19-34` already models all four. So the
  platform's own map of itself says finishing does not happen. **Change:**
  insert a "Finish" stage between 6 and 7, reading the Post Supervisor
  milestones and blocking Deliver until QC is complete. **MED.**

- **`tools/tools-media-ui.js:321-408` — the credit roll is a scrolling text
  canvas, not credit management.** It records at 720×405
  (`tools/index.html` canvas, line 332) into a real-time-captured WebM — so
  the roll's resolution does not match any master, and a long roll takes as
  long to export as it takes to play. More importantly there is no notion of
  a *contractual* credit: no main-title card order, no size/placement
  obligations, no paid-ad block, no approval state — and
  `distribution/lib-dist.js:35` explicitly lists "Final credits + paid-ad
  obligations" as a required deliverable. Credit order is a thing people sue
  over. **Change:** render at the project resolution off-screen frame by frame
  (the Editor already has that loop at `editor/cut-ui.js:736-745`), and add a
  credit obligations register linked to `contracts/`. **MED.**

- **`tools/lib-script.js:88-97` — captions are millisecond-based and
  frame-blind.** SRT and VTT are the two formats a delivery spec least often
  asks for on its own; `production/lib-prod.js:154` asks for "SCC or IMSC"
  and `distribution/lib-dist.js:24` for "SCC + SRT", and neither exists. There
  is also no positioning, no forced-narrative flag, no language tag, and no
  frame-rate conversion — so a caption file cut against a 23.976 master and
  one cut against 24 are indistinguishable and one of them drifts a frame
  every 41 seconds. **Change:** add IMSC1/TTML output (XML, no dependency) and
  a frame-rate field that converts on export; SCC is a bigger job because of
  CEA-608 byte-pair encoding, so make it the second step. **HIGH.**

- **`production/lib-prod.js:70-85` — the cue sheet hardcodes `use: 'BI'` for
  every cue** and leaves composer, publisher and society blank with no way to
  fill them from the Music module. A cue sheet with every cue marked
  background instrumental and no society is rejected by every PRO. The tcIn is
  derived from the Editor's audio track starts, which is the right idea.
  **Change:** editable use codes (BI/BV/VI/VV/MT/ET) and a join to
  `music/lib-music.js`'s licence rows. **MED.**

---

## What is missing entirely

- **A colour-managed pipeline (working space, input transform, display
  transform).** Every frame in this platform is 8-bit sRGB from decode to
  export; there is no point at which the code knows what colour a pixel is.
  Without it there is nothing to grade *in*, no way to match two cameras, and
  no honest way to say what the master is. Attach to `editor/` as a
  project-level `{working, display, inputTransforms:{srcId: name}}` on the
  `blank()` model, applied in `drawFrame()`. Realistically: a WebGL preview
  path with float textures, an IDT/ODT pair as shader code, and `colr`
  tagging on export. Two to three weeks of careful work, and every other
  colour feature depends on it. **Value: HIGHEST — nothing else in this
  section is meaningful without it.**

- **LUT import and management.** The parser already exists
  (`tools/lib-media.js:15-56`) — what is missing is a library: named LUTs
  stored per project, assignable per clip and per bin item, with a mix amount,
  a show LUT for dailies, and the ability to bake or not bake on export.
  Attach to `editor/` (clip model + inspector) and `tools/` (the library).
  A week on top of the pipeline above. **Value: HIGH.**

- **HDR and SDR trim passes.** There is no HDR concept at all — no PQ or HLG
  transfer, no mastering-display metadata, no MaxCLL/MaxFALL, no SDR
  down-trim. Every streamer that accepts HDR requires both an HDR master and
  an SDR trim, and requires them to be different grades, not one auto-converted
  from the other. This is the single biggest reason the answer to "would a
  streamer take this" is no. Attach to `editor/` on top of the colour
  pipeline: a per-clip `trim` layer that applies only in the SDR pass, and
  `mdcv`/`clli` boxes in `editor/lib-mp4.js`. Large — but the *metadata* half
  is small and worth doing early. **Value: HIGH.**

- **Per-platform deliverable specs with a machine-checkable checklist.** The
  platform lists deliverables by name (`distribution/lib-dist.js:15-39`,
  `production/lib-prod.js:147-167`) but nowhere states a *spec*: container,
  codec, bit depth, chroma subsampling, resolution, frame rate, colour
  primaries/transfer/matrix, audio channel order, loudness target, caption
  format, file naming. A named spec object per buyer class is what turns the
  existing tick-list into QC. Attach to `distribution/lib-dist.js` as
  `SPECS = {streamer: {...}, theatrical: {...}}` and have
  `production/production.js:330`'s Delivery QC pane read it. This is a couple
  of days of data entry plus a comparison function, and it makes three
  existing modules useful. **Value: HIGH — best value per hour on this list.**

- **Loudness measurement (ITU-R BS.1770 / EBU R128).** Repo-wide grep for
  `LUFS | loudness | R128 | 1770 | true peak | dBTP | dialnorm`: zero hits.
  Every spec states a target (−24 LKFS for US broadcast, −27 for a theatrical
  printmaster reference, −14 to −24 depending on the streamer) and every
  delivery is measured on arrival. BS.1770 is a K-weighting filter, mean
  square over 400 ms blocks, and a two-stage gate — perhaps 120 lines of pure
  JS running over the `OfflineAudioContext` render the Editor already produces
  at `editor/cut-ui.js:654`, plus a 4× oversampled true-peak. Node-testable,
  fits the `lib-*.js` convention exactly. Attach as `editor/lib-loudness.js`,
  surfaced in the Editor export panel and in Delivery QC. The platform's own
  `docs/FEATURE_CANDIDATES.md:34` already flags this as candidate #28.
  **Value: HIGH — small, self-contained, and it is the single most common
  automatic QC failure in real delivery.**

- **Broadcast caption formats (SCC, IMSC1/TTML) and caption versioning.**
  Covered above as a gap in `tools/lib-script.js`. IMSC1 is XML and is a day
  or two; SCC needs CEA-608 byte-pair encoding and parity, so a week. Add a
  language and a territory to each caption set so the same picture can carry
  en-US CC, es-419 subs and a forced-narrative track. Attach to `tools/`
  (the Captions tab) with the sets stored per project. **Value: HIGH.**

- **Versioning for territories and cuts.** `post/lib-post.js:176-204` versions
  the *cut* and does it well; nothing versions the *master*. There is no
  theatrical vs streaming vs airline vs territory version, no record of what
  is different between them (an airline version is a different edit, not a
  different file), no edit-decision delta, and no way to say which version a
  window at `distribution/lib-dist.js:78-84` licensed. Attach to `post/` as a
  versions matrix keyed `{cut, territory, platform}` with a reason and a
  deliverable set per row, referenced by the Distribution windows planner.
  Moderate — mostly a data model and a table. **Value: HIGH.**

- **Credit and title-card management.** Covered above. Beyond the roll, what
  is missing is the *obligation*: who is contractually owed a card, in what
  order, at what size, in which paid ads. `contracts/` holds the deal memos
  and `distribution/lib-dist.js:35` demands the output; nothing joins them.
  Attach as a credits register in `production/` reading from `contracts/`.
  **Value: MED.**

- **An AAF (or OMF) sound turnover.** `post/lib-post.js:27-29` books ten days
  of sound edit and five of mix. No sound facility on earth takes an OTIO;
  they take AAF. The Editor exports EDL and OTIO only (`editor/index.html:101-102`)
  — so the platform schedules a stage it cannot hand off to. Attach to
  `editor/` alongside `lib-mp4.js` as `lib-aaf.js`. AAF is a structured
  storage container and is genuinely hard; an OMF or even a per-clip WAV
  bundle with a text EDL of the audio track is 80% of the value for 10% of
  the work. **Value: HIGH (the reduced version).**

- **An ALE / dailies metadata bridge.** Dailies captures scene, slate, take,
  camera, lens, sound roll and tcIn (`dailies/lib-dailies.js:81-92`); the
  Editor bin captures none of it (`editor/cut-ui.js:75`). ALE is a tab-
  delimited text format and would take an afternoon. It is the cheapest way to
  get real timecode and reel names into the EDL/OTIO problem described above.
  Attach to `dailies/` as an export and `editor/` as an import.
  **Value: MED, but trivially cheap.**

- **A conform/reconform check.** When notes come back on `EC_v03` and the cut
  has moved to `DC_v01`, something must tell you which notes still land. The
  pieces are here — `screening/` has timecoded notes, `post/` has version
  names, `editor/lib-cut.js:25-35` computes clip starts — and nothing joins
  them. Attach to `screening/`: store each note against a clip id + source
  offset rather than a timeline second, and re-derive the timeline position
  from the current cut. Half a week, and it fixes the most common way a note
  gets lost. **Value: MED-HIGH.**

- **Scopes.** No waveform monitor, no vectorscope, no RGB parade, no false
  colour. `editor/cut-ui.js:501-505` already builds a luma histogram for the
  auto-balance, so the pixel-reading half is solved. Nobody grades without
  scopes. Attach to `editor/` as a panel beside the preview. A few days.
  **Value: MED-HIGH (and it makes the existing look controls defensible).**

- **A ProRes or DNxHR mezzanine writer.** Every picture deliverable in both
  checklists (`distribution/lib-dist.js:17`, `production/lib-prod.js:148`)
  is ProRes or DNx; the Editor can only make H.264. ProRes is a patent-
  encumbered proprietary codec and should not be reimplemented here. The
  honest answer is that in-browser mastering tops out at H.264/HEVC, and the
  platform should say so: label the MP4 export "review copy / screener", not
  "master", and route the real master through a named facility in
  `post/lib-post.js:207`'s vendor bids. **Value: MED — as a piece of honesty,
  not a build.**

- **Burn-in / forensic watermarking for screeners.** Both checklists require
  "H.264 screener with burned-in TC" (`distribution/lib-dist.js:19`,
  `production/lib-prod.js:149`) and the Editor has no burn-in at all — no
  timecode, no recipient name, no watermark — while
  `distribution/index.html:70-78` runs a screener registry whose stated
  purpose is "if a copy leaks, this list is where the conversation starts". A
  registry without a per-recipient burn-in cannot actually identify a leak.
  This is a genuinely small build: `drawFrame()` already has the canvas, so a
  TC string and a recipient name drawn at low opacity is under 30 lines, and
  it makes an existing feature true. Attach to `editor/` export options, fed
  from `distribution/`. **Value: HIGH for the effort.**

---

## Evidence

Files read in full: `editor/lib-cut.js` (389 lines), `editor/lib-mp4.js`
(278), `editor/index.html` (116), `post/lib-post.js` (264),
`distribution/lib-dist.js` (117), `distribution/index.html` (162),
`production/lib-prod.js` (182), `screening/lib-screen.js` (107),
`dailies/lib-dailies.js` (233), `tools/lib-media.js` (137),
`tools/lib-script.js` (121), `docs/audit/BRIEF.md`.

Files read in part: `editor/cut-ui.js` (lines 260-380, 420-540, 610-810 —
preview, inspector, colour, export, boot), `tools/tools-media-ui.js`
(143-216 Dailies Review, 250-408 Look/LUT and Credit Roll),
`production/production.js` (320-380 Delivery QC and Residuals),
`workflow/workflow.js` (129-165 Review and Deliver stages),
`post/index.html` (52-110 and 176-274 via grep),
`screening/index.html` (39-170 via grep), `dailies/index.html` (via grep),
`editor/timeline-engine.js` (1-40), `docs/FEATURE_CANDIDATES.md` (grep),
`scripts/test_tools.mjs` (52-59, 116-125), `scripts/test_assist.mjs` (63-69),
`tools/index.html` (41-63), `vfx/lib-vfx.js` (grep), `music/lib-music.js`
(grep).

Negative results I verified by repo-wide grep (excluding `node_modules/` and
`static/vendor/`):

- `rec709 | rec\.709 | bt709 | bt2020 | rec2020 | colour space | colorspace |
  colr | HDR | Dolby Vision | HLG | PQ | SMPTE 2084 | ACES | LogC | S-Log |
  gamut | nits | EOTF | OOTF` — the only real hits in module code are
  `tools/lib-media.js` and `tools/tools-media-ui.js` (LUT), the `.hdr` CSS
  class in `app.html:94`, and prose in `index.html:2553`. No colour-space or
  HDR code exists.
- `LUFS | loudness | EBU R128 | R128 | ITU BS.1770 | 1770 | true peak | dBTP |
  dialnorm | LKFS | ATSC A/85` — zero hits anywhere in the repo.
- `SCC | IMSC | TTML | CEA-608 | CEA-708` — appear only as strings in the two
  deliverable checklists (`production/lib-prod.js:154`,
  `distribution/lib-dist.js:24`). No encoder or parser.
- `AAF | FCPXML | xmeml | .ale` — zero hits. Interchange is EDL and OTIO only.
- `burn | watermark | forensic` — appear only as deliverable labels
  (`distribution/lib-dist.js:19`, `production/lib-prod.js:149-150`). No
  implementation.
- `colorSpace | display-p3` — zero hits in module code; every canvas is
  default 8-bit sRGB. The only `getContext('2d', {...})` option used anywhere
  is `willReadFrequently` at `editor/cut-ui.js:498`.
- `ctts | co64 | pasp | elst` — zero hits in `editor/lib-mp4.js`.

Corroboration: the platform's own `docs/FEATURE_CANDIDATES.md:56-57` already
lists "Color & look development" (#27) and "Delivery QC — serverless loudness
(EBU R128) and caption-format checks against delivery specs" (#28) as unbuilt
candidates, which matches what I found in the code.

Arithmetic I did rather than read: at `editor/cut-ui.js:707`'s bitrate formula
`W*H*fps*0.12`, 1920×1080 at 24 fps is 5,971,968 bit/s ≈ 0.746 MB/s, so a
100-minute (6,000 s) master is ≈ 4,478 MB — above the 4,295 MB ceiling of the
32-bit offsets written by `stco` at `editor/lib-mp4.js:80-84`.

I did not edit any file. I did not run the test suite.
