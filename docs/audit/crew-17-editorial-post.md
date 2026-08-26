# Editor & Post Supervisor

Judged as the people who cut the film and run post: ingest, dailies, assembly,
versions, screenings, notes, conform, turnover, deliverables, QC.

**Short answer to "is the editor real or a demo":** `editor/` (lib-cut + lib-mp4
+ cut-ui) is a *real, original* cutting tool — hand-written timeline math, a
hand-written ISO-BMFF muxer that produces a genuinely valid MP4, WebCodecs
encode, IndexedDB media persistence, undo/redo, J-K-L. It is not a wrapper and
it is not fake. It is also a **short-form** tool: single video track, ripple
only, no drop-frame, no relink, and a memory-resident single-`mdat` export that
cannot survive a feature. And there is a *second, weaker* editor
(`editor/timeline-engine.js`) still mounted inside the Studio with its own
store and a **structurally invalid EDL**.

**Where the post pipeline breaks:** the handoff. Everything that leaves the
edit suite — EDL, OTIO, the exported master, the grade, the notes, the version
log — disagrees with itself. Details below, ranked.

---

## What exists and works

- `editor/lib-cut.js:23-96` — ripple timeline math (`effDur`/`starts`/
  `duration`/`videoAt`) that correctly maps timeline time → source time through
  a speed change, holds the outgoing frame for a crossfade, and applies a
  symmetric fade-to-black across a cut point. This is real NLE arithmetic, and
  `scripts/test_cut.mjs:27-41` pins it exactly.
- `editor/lib-cut.js:99-112` — `split()` refuses a split within 0.05s of an
  existing cut point and preserves total duration. Correct behaviour.
- `editor/lib-cut.js:163-230` — OpenTimelineIO `Timeline.1` output with a real
  `Stack.1`/`Track.1`/`Clip.2` tree, `RationalTime.1` in frames, audio offsets
  expressed as `Gap.1`, and speed as `LinearTimeWarp.1`. Resolve and Premiere
  read this natively. This is the single most valuable thing in the module.
- `editor/lib-mp4.js:57-239` — an original ISO/IEC 14496-12 writer.
  `ftyp|moov|mdat`, two-pass chunk-offset resolution with an explicit drift
  guard at `:232`, run-length `stts`, `stss` only when it is meaningful,
  `avcC` from the encoder's own `decoderConfig.description`, and a correct
  `esds`/`DecoderConfig`/`DecSpecificInfo` descriptor chain for AAC
  (`:153-174`). `scripts/test_cut.mjs:109-149` verifies the `stco` offsets land
  on the right bytes. I checked the box layouts by hand — `tkhd`, `mdhd`,
  `hdlr`, `vmhd`, `smhd`, `avc1`, `mp4a` are all spec-correct, including the
  `sampleRate << 16` sign-wrap at `lib-mp4.js:171`, which comes out right
  because `u32()` uses `>>>`.
- `editor/cut-ui.js:32-57, 141-150, 798-818` — local media goes into IndexedDB
  and survives a reload; a source whose blob is gone is flagged `missing` and
  `addToTimeline` (`:183`) refuses to place it. That is more media discipline
  than most browser editors bother with.
- `editor/cut-ui.js:628-696` — the export audio path is honest work:
  `OfflineAudioContext` mix of every video clip's own audio plus the A1 track
  at per-clip gain and playback rate, then `AudioEncoder` to AAC with a
  hand-built fallback `AudioSpecificConfig` (`:622-626`) if the encoder does
  not hand one back.
- `editor/cut-ui.js:924-937` — J/K/L shuttle with 1×/2×/4× on repeated L, `S`
  to split, Ctrl+Z/Y. An editor can actually drive this.
- `editor/lib-cut.js:253-378` + `scripts/test_assist.mjs` — the assist suite is
  real deterministic DSP, not an LLM call: `assemble` trims handles and
  crossfades on scene change; `silences` is a threshold-and-min-duration run
  detector; `tighten` pulls in/out past head/tail silence keeping a 0.12s
  breath; `beats` is a trailing-average onset detector; `autoColor` is a 5/95
  percentile stretch plus a mid-grey exposure pull. All node-tested.
- `post/lib-post.js:19-174` — the best-engineered file in this whole area. A
  14-milestone post template with a real dependency graph, Kahn topological
  sort with cycle detection (`:82-101`), weekend-skipping business-day
  arithmetic that never touches `Date.now()`, a longest-chain critical path,
  and a backward solve that lands delivery *on* the target date by exploiting
  the translation-invariance of business-day arithmetic (`:139-148`). 49 tests.
  A post supervisor could plan a real schedule on this today.
- `post/index.html:241-255` — awarding a vendor bid writes a real PO into
  `SB_Money_v1` on account 15000 with a commit-once guard (`lib-post.js:216-223`)
  and refuses to delete a committed bid. That is the correct financial
  behaviour and it is rare to see it done right.
- `dailies/lib-dailies.js:45-78` — bijective base-26 slate arithmetic
  (12A → 12B → … 12Z → 12AA) with `nextSlate` (same setup, take+1) vs
  `nextSetup` (next unused letter). This is exactly how a 2nd AC chalks a slate.
- `dailies/lib-dailies.js:154-200` — fixed-width plain-text camera and sound
  reports that look like the real documents, with the circle rate footed and an
  explicit "cross-check against the written report before turnover" caveat.
- `dailies/lib-dailies.js:126-143` — coverage-by-scene against the actual
  screenplay: which script scenes still have zero takes. That is the single
  most useful thing you can hand a director at 6pm.
- `screening/lib-screen.js:34-90` — timecoded notes, open/done, sorted by
  timecode, with a `locked` flag when every note is addressed
  (`:86-90`). The architectural choice at `:5-8` — no video hosting, everyone
  loads the same local file, only the tiny notes sync — is genuinely smart for
  a localStorage-and-cloud-sync platform.
- `screening/lib-screen.js:79-84` → `editor/cut-ui.js:200-211` — open notes
  become brass markers on the Editor ruler. A working review loop.
- `production/lib-prod.js:70-103` — the music cue sheet is derived from the
  Editor's A1 track with real timecode in/out, and `csvCell` (`:88-95`)
  correctly prefixes `= + - @ \t \r` cells. That cue sheet is a genuine PRO
  deliverable produced from real cut data.
- `tools/lib-media.js:88-127` — an MHL-style SHA-256 offload manifest with a
  real re-scan verifier (`ok`/`changed`/`missing`/`extra`, `clean` flag). This
  is proper media management and it is hiding in the wrong module.
- `tools/lib-media.js:15-46` — a correct IRIDAS/Adobe `.cube` 3D LUT parser
  with trilinear interpolation, red-varies-fastest per spec.
- All 44 suites pass (`node scripts/run_all_tests.mjs`), including `cut`,
  `post`, `dailies` and `assist`. Verified, not assumed.

---

## What exists but needs work

### HIGH

- **`editor/lib-cut.js:150` — every EDL event is a hard cut `C`.** A crossfade
  or fade-to-black set in the Inspector is silently discarded on EDL export.
  The finishing house conforms a cut where you cut a dissolve. Emit a `D`
  dissolve event pair with the transition duration in the standard CMX form,
  or at minimum refuse to export and say which events would be lost.

- **`editor/lib-cut.js:153` — a speed change is written as a comment
  (`* SPEED: 200%`), not an `M2` motion-effect record.** The consequence is
  arithmetic, not cosmetic: for the tested 2× clip the event line carries
  source `00:00:01:00 → 00:00:05:00` (4s) against record
  `00:00:04:00 → 00:00:06:00` (2s). Source and record durations disagree with
  no motion record to explain it. Every conform tool either errors or
  conforms it wrong. Add the `M2 <reel> <fps> <src-in>` record before the
  event, per `scripts/test_cut.mjs:72-73`'s own event-line format.

- **`editor/lib-cut.js:146` — `edl()` iterates `p.video` only.** Titles and the
  entire A1 music/audio track never appear in the EDL. The sound house gets a
  picture EDL with no audio events, so the temp music you laid in does not
  travel. OTIO carries audio (`:189-207`); EDL does not. Emit `A`/`AA` track
  events, or state on the button that the EDL is picture-only.

- **`editor/cut-ui.js:700-702` vs `editor/lib-cut.js:15` — the export frame
  rate never reaches the project.** `edFps` is read only inside `exportMp4`;
  `project.fps` is the `blank()` default of 24 and is never assigned anywhere
  in `cut-ui.js` (verified: only ever read, at `:205, 238, 303, 351, 387`).
  Export at 30 fps and you ship a 30 fps master with an EDL and an OTIO that
  both declare 24. Every timecode in the turnover package is wrong by 25%.
  `project.width/height` are dead in the same way. One line — write `project.fps`
  and `project.width/height` from the Export selects on change, and re-render.

- **`editor/cut-ui.js:66, 309-313, 375` — dissolves do not render into the
  exported MP4.** The crossfade holds the outgoing frame from `prevFrame`, but
  `prevFrame` is only ever populated inside the *playback* loop at `:375`, from
  the *preview* canvas `cv`. Export draws to `off` and calls `pause()` first
  (`:715`), so during export `prevFrame` is a detached canvas at its default
  300×150 and fully transparent — `ctx.drawImage` of it is a visual no-op. The
  dissolve you approved in preview exports as a hard cut, or, if you happened
  to play the timeline first, as a stale frame from wherever playback stopped.
  Scrubbing has the same problem: `seek()` → `drawFrame(..., exact=true)` never
  refreshes `prevFrame`. Fix: render the outgoing clip's frame on demand inside
  `drawFrame` when `hit.prevHold` is set, using `hit.prevHold.srcTime`, instead
  of relying on a cached canvas.

- **`editor/cut-ui.js:141-150` — imported media can never be relinked.**
  `addFiles` mints `'f_' + uid()` on every import, and nothing anywhere
  reassigns `clip.srcId`. Once a bin item is `missing` (cleared site data, a
  different browser, a shared project), the timeline clips point at a dead id
  forever and the bin's "re-import needed" hint is a lie — re-importing creates
  a *new* bin item the cut does not reference. A cut is one browser-profile
  wipe from being unconformable. Add a relink action on a missing bin item that
  keeps the id and swaps the blob, and match on filename + duration.

- **`editor/lib-mp4.js:80-84, 209-239` — the muxer cannot write a feature.**
  `stco` is 32-bit with no `co64` fallback, so any file over 4 GB silently
  wraps its chunk offsets; and `buildMp4` concatenates the *entire* movie into
  one `Uint8Array` in one `mdat` in memory. At the encoder's own bitrate
  (`cut-ui.js:707`, `W*H*fps*0.12` ≈ 7.5 Mbps at 1080p24) a 20-minute piece is
  ~1.1 GB held in RAM twice over. A 90-minute feature is not merely slow, it is
  impossible. Compounding it, `exportMp4:736-745` does one **`seekVideo` per
  frame, serialised on the main thread** — 7,200 seeks for a five-minute cut.
  This is a trailer/short/social exporter. Either say so in the UI, or move to
  fragmented MP4 (`moof`/`mdat` written incrementally to a `FileSystemWritableFileStream`)
  plus `co64`.

- **`editor/timeline-engine.js:409-426` — the Studio's embedded editor exports
  an EDL with no event lines at all.** `exportEdl()` emits `TITLE:`, `FCM:` and
  then only `* FROM CLIP NAME:` / `* SOURCE FILE:` comment pairs. There is no
  `001 AX V C ...` record anywhere, and the accumulated `offset` at `:418` is
  computed and thrown away. Every conform tool reads this as an empty timeline.
  It is wired to two buttons (`:531, 533`). This whole engine is a second,
  older editor still mounted in the Studio (`timeline/index.html:318`,
  `timeline/timeline.js:1224-1230`) with its **own** store `SB_Editor_embed_v1`
  and a third dead one, `SB_Editor_v1` (`:573` — nothing on the site has
  `id="binItems"` any more). Two editors, three stores, no path between them:
  a cut assembled by Pro Cut in the Studio cannot be opened in `/editor/`.
  Decide which editor is the editor. If the Studio panel stays, make it a thin
  view over `SB_Cut_v1` and delete `exportEdl` in favour of `CCut.edl`.

- **`editor/cut-ui.js:152-169` vs `_headers:4` / `netlify/functions/gate.js:142`
  — "Load Studio clips" cannot work for cloud-generated footage.** The CSP is
  `media-src 'self' blob: data: http://127.0.0.1:* http://localhost:*` and
  `connect-src` likewise. Studio `videoUrl`s come back from remote providers
  (`timeline/timeline.js:1798-1805`, `netlify/functions/generate-video.js:136-146`),
  so `probe()` gets a blocked load, `v.onerror` fires, and every clip lands in
  the bin as `missing`. The local-GPU path (127.0.0.1) is allowed and is
  presumably the intent — but the primary documented route into the editor
  silently produces an empty bin on the deployed site. Either proxy provider
  media through the existing (currently unused) `serve-openai-video` function
  so it is same-origin, or surface a specific "this clip is blocked by the
  content policy — render locally or re-import" message instead of the generic
  "re-import needed".

- **`production/production.js:220` vs `dailies/index.html:142` — the Daily
  Production Report reads the wrong take log.** `dpr()` pulls
  `SB_TakeLog_v1`, which is written by the *Tools* digital slate
  (`tools/tools-media-ui.js:38`). The real dailies module writes
  `SB_Dailies_v1`. Log takes properly in `/dailies/` — scene, slate, take,
  circle, lens, sound roll, TC — and your DPR reports zero takes and zero
  prints. There are four separate take/note stores on this platform
  (`SB_Dailies_v1`, `SB_TakeLog_v1`, `SB_ReviewNotes_v1`, `SB_Screening_v1`)
  and none of them merge. Make `dpr()` read both and prefer `SB_Dailies_v1`.

- **`dailies/index.html:306-310` — `SB_DailiesPicks_v1` is written and never
  read by anything.** Verified by grep across the repo: one write, zero reads.
  The circled-take pull list — the single most important thing dailies hands
  editorial — is a dead end. The bin has no scene/slate/take fields at all
  (`cut-ui.js:61`), so there is nothing for it to match against. Add
  `scene/slate/take/circled` to bin items and a "Load circled takes" action in
  the Editor bin next to "Load Studio clips".

### MED

- **`editor/lib-cut.js:353-378` + `cut-ui.js:304` — the grade is baked into the
  master and invisible to interchange.** Per-clip colour is applied as a canvas
  `ctx.filter` string during both preview and export, so it is destructive,
  8-bit, sRGB, and after decode. Neither `edl()` nor `otio()` carries it —
  `otio()`'s `effects` array (`:183-185`) holds only the time warp. The colourist
  receives a timeline that looks nothing like the MP4 you signed off. At
  minimum write the colour values into OTIO clip `metadata.cinamate.color` and
  say on the Export panel that the grade is burned in.
- **`editor/lib-cut.js:359-360` — "warmth" is not a colour-temperature control.**
  Positive warmth applies `sepia()`, negative applies `hue-rotate()`, which
  rotates *every* hue — skin goes green before the sky goes blue. Use a
  channel-gain matrix (lift R, cut B) via `ctx.filter`'s `url(#svgfilter)` or a
  small `feColorMatrix`, and while you are there wire `tools/lib-media.js`'s
  existing, correct `.cube` LUT parser into the Inspector. The LUT tool and the
  editor currently cannot talk to each other at all.
- **`editor/lib-cut.js:334-350` — "Cut to beats" silently discards every grade
  and transition.** `cutToBeats` replaces `p.video` wholesale with freshly
  minted objects carrying `trans:{type:'cut'}` and no `color`. It also
  round-robins through clips by index, so it is a music-video toy, not a scene
  tool. Undo covers it (`cut-ui.js:906`) but nothing warns first. Carry `color`
  and `trans` forward from the source clip, and confirm before replacing a
  non-empty track. Same applies to `assemble` (`:256`, `p.video = []`).
- **`editor/lib-cut.js:312-330` — `beats` is an onset detector, not a beat
  tracker.** No tempo estimate, no phase lock, no bar grid. Cuts land on
  transients, which for anything but a four-on-the-floor track means cuts on
  off-beats. Add a simple autocorrelation tempo estimate and quantise the
  returned times to the inferred grid.
- **`editor/lib-cut.js:274 — `silences` uses a fixed absolute threshold of
  0.04.** A noisy location recording never registers any silence, so "Tighten"
  reports "no leading/trailing silence found" on exactly the material that most
  needs it. Derive the threshold from the envelope's own noise floor (e.g. 10th
  percentile × 3).
- **`editor/lib-cut.js:131-140` — timecode is non-drop only, and
  `edl()` hard-codes `FCM: NON-DROP FRAME` (`:144`).** The fps select offers
  only 24 and 30 (`editor/index.html:97`). 29.97 DF is the standard broadcast
  rate and cannot be expressed anywhere on this platform (grep: no `29.97`, no
  `23.976`, no `drop frame` handling). Any broadcast deliverable is out of
  reach. Add 23.976/29.97 with a DF flag and a drop-frame `tc()` variant.
- **`editor/index.html:61` + `cut-ui.js:342` — you cannot see a vertical or
  square framing before you render it.** `#edCanvas` is fixed at 1280×720 and
  `seek`/`play` always draw at `cv.width/cv.height`; the crop-fill branch in
  `drawCover` only fires during export at the target W×H. Pick "Social 9:16",
  render for ten minutes, then discover the crop. Resize the preview canvas
  when `edRes` changes.
- **`post/index.html:187-194` — historic version names are rewritten when the
  project is renamed.** `renderVersions` recomputes every row's name from the
  *current* `poProj` value. The `Nightharvest_DC_v03` you emailed the post house
  becomes `Themidnight_DC_v03` in your own log. Store the resolved name on the
  row at `lib-post.js:197-204` and display that.
- **`post/lib-post.js:197-204` — a "version" is a name, a stage and a note.** It
  records no TRT, no export reference, no `SB_Cut_v1` snapshot, no screening
  session, no reel count, no who-approved. Two milestones later nobody can say
  what `_DC_v03` actually was. Store at minimum: duration, clip count, the
  `lastExport` stamp (`cut-ui.js:767` already writes one), and the screening
  session id it answered.
- **`screening/index.html:157-164` — sending notes to the Editor is a
  clobbering write.** `srToEditor` reads `SB_Cut_v1`, sets
  `cut.project.markers` and writes the whole object back. If the Editor tab is
  open, its in-memory `project` has no markers and the next `save()`
  (`cut-ui.js:70-80`) wipes them. Also the Editor only reads markers at boot
  (`:802`), so an open Editor never sees them. Write markers to a separate key
  and have the Editor merge them on a `storage` event.
- **`screening/lib-screen.js:17-23` — a review session is not bound to a cut.**
  No version id, no file name, no duration, no hash. `sess.fps` is hard-set to
  24 and never settable, so notes against a 30 fps export display the wrong
  frame number. The page's own copy promises "everyone loads the same exported
  cut" and nothing checks it. Record the loaded file's name, size and duration
  on the session at `screening/index.html:121-126` and warn on mismatch.
- **`screening/lib-screen.js:34-41` — notes have no department, no assignee and
  no target version.** A note cannot be routed to sound, VFX, music or titles,
  so the Screening Room cannot feed a turnover. Add a `dept` enum and an
  `assignedTo`, and group `exportText` by department.
- **`dashboard.html:2184-2192` — the dashboard's cut metric is permanently
  zero.** It looks for `cut.tracks[].clips` or `cut.clips`; the real shape is
  `{project:{video,titles,audio}, bin}` (`cut-ui.js:71-78`). So `cutClips` is
  always 0, the `CUTTING` stage at `:2212` never triggers, and the EDITOR feed
  line at `:2355` never appears. `workflow/advisor.js:174` reads the same store
  *correctly* (`s.cut.project.video`) — copy that.
- **`workflow/workflow.js:40-160` — post is not in the pipeline.** The seven
  stages are Develop, Breakdown, Budget, Schedule, Generate, Review, Deliver.
  There is no Edit stage, no Post stage, no Screening stage; `/editor/`,
  `/post/` and `/screening/` appear in no stage's `href`. "Deliver" points at
  `/tools/`, which does not contain the delivery checklist — that lives at
  `/production/#delivery`. Mission control cannot see the half of the film that
  happens after the last shooting day.

### LOW

- `editor/lib-cut.js:45-47` — dead branch. The `if` computes a compound
  condition and then only returns for `t < 0`; the real out-of-range guard is
  the separate check at `:54`. Harmless, but it reads as a bug.
- `editor/lib-cut.js:377` — `autoColor` always returns `sat: 1, tw: 0` despite
  the Inspector exposing both. The "✨ Auto" toast (`cut-ui.js:508`) only
  mentions exposure and contrast, so this is honest, but the sliders imply more.
- `editor/lib-mp4.js:177-202` — no `edts`/`elst`. AAC encoder priming (~1024
  samples ≈ 21 ms) is not compensated, so audio sits about half a frame early.
  A one-box fix.
- `editor/lib-cut.js:92-96` — `audioAt` is exported and tested but never called
  by the UI; audio scheduling uses a separate path (`cut-ui.js:401-420`).
- `editor/cut-ui.js:775-795` — the MediaRecorder fallback captures the fixed
  1280×720 preview canvas and ignores the chosen resolution, and is silent. The
  toast says so, which is the right call, but the resolution select stays
  enabled and lies.
- `post/lib-post.js:231-252` — `distReadiness` maps 5 milestones to 5
  deliverable *names*; `distribution/lib-dist.js:15-39` defines 23. The two
  lists share no identifiers, so the Post module's "ready to tick in
  /distribution/" link is manual.

---

## What is missing entirely

- **AAF or FCPXML export — VALUE: HIGHEST.** Grep confirms neither string
  exists anywhere in the repo. OTIO is the right modern choice and it works,
  but AAF is still what an Avid-based finishing house and virtually every
  sound facility ask for, and FCPXML is what a Resolve/FCP colourist prefers
  when OTIO drops transitions and effects. Attaches to `editor/lib-cut.js`
  alongside `edl()`/`otio()`. FCPXML is the cheaper win — it is plain XML,
  expresses transitions, titles, audio, per-clip effects and markers, and can be
  written with the same string-building style as `edl()`. Roughly a day.
  AAF is a binary structured-storage container and is a genuinely large job in
  vanilla JS; if only one gets built, build FCPXML.

- **Interchange *import* — VALUE: HIGH.** There is no EDL, OTIO or XML *reader*
  anywhere. The editor is a one-way door: a cut that goes out to a finishing
  house can never come back, which means no change lists, no re-conform after a
  picture change, and no way to receive a cut from an assistant editor. Attach a
  `parseOtio()` to `editor/lib-cut.js` — it is the inverse of the function
  already there and reuses the same clip model. Half a day, and it turns a demo
  into a workflow.

- **Media management: reel names, source timecode, and relink — VALUE: HIGH.**
  Bin items carry `{id,name,kind,url,dur,w,h,origin,idb}` (`cut-ui.js:61`) and
  nothing else. No reel/tape name, no camera source timecode, no UMID, no
  checksum, no scene/slate/take. `edl()` therefore writes `AX` (unknown source)
  as the reel for every single event (`lib-cut.js:150`), and writes no
  `* SOURCE FILE:` line at all, so a conform tool has only a clip name to match
  on. A finishing house conforms from camera originals by reel and source TC —
  neither exists here. Meanwhile `tools/lib-media.js:88-127` already computes
  and verifies SHA-256 per file for the offload manifest, and
  `dailies/lib-dailies.js:81-92` already captures `tcIn`, `soundRoll`, `lens`
  and `camera` per take. The pieces exist in three modules that do not talk.
  Attach: extend the bin item shape, populate it from `SB_Dailies_v1` on
  import, and write reel + source TC into `edl()` and into OTIO
  `metadata`. Two to three days and it is the difference between "exports a
  file" and "hands over a conformable turnover".

- **A conform / turnover checklist — VALUE: HIGH.** `post/lib-post.js:24-25`
  has `turnover` and `conform` as bare milestones with `days: 2` and `days: 3`
  and nothing behind them. A real turnover is a package: locked picture with
  burn-in, an EDL/AAF/XML per department, a reel breakdown, VFX pulls with
  handles, a spotting list for sound, a temp mix reference, a music cue sheet,
  a textless list, and a change list against the previous turnover. None of it
  exists. Attach to `/post/` as section 5, seeded from the actual cut in
  `SB_Cut_v1` (clip count, TRT, transition count, audio clip count) so the
  checklist knows what it is turning over. One to two days.

- **A QC report against a spec — VALUE: HIGH.** There is no QC anywhere on this
  platform, despite `qc` appearing as a post milestone
  (`post/lib-post.js:31`), as a vendor service (`:207`), as a deliverable
  (`distribution/lib-dist.js:36`) and as a status value
  (`production/production.js:339`). What exists is a 19-row name list
  (`production/lib-prod.js:147-167`) rendered into a register with a
  `todo/in QC/passed` dropdown. Nothing measures anything. Specifically absent:
  loudness (grep: no `LUFS`, no `R128`, no `A/85` anywhere in the repo), true
  peak, resolution/frame-rate/scan verification, colour primaries and transfer,
  audio channel map, head/tail leader and slate, black-frame and freeze
  detection, textless check, caption timing. The editor already decodes every
  frame and mixes the full audio bed during export (`cut-ui.js:628-655`) — a
  loudness meter and a black/freeze detector over that same pass are almost
  free. Attach to `production/lib-prod.js` as a `qcReport(cut, spec)` returning
  pass/fail per line, and render it in the Delivery QC tab. Two days for a
  meaningful first pass; the loudness measurement alone is worth it because
  every platform rejects on it.

- **Per-platform deliverable *specs*, not just names — VALUE: HIGH.**
  `distribution/lib-dist.js:15-50` has a good 23-item schedule and five buyer
  presets, but each item is a label string — `'ProRes 4444/422HQ master
  (graded)'`. There is no machine-readable spec and no per-platform variation:
  a Netflix master, an Amazon master, an iTunes package and a broadcaster's
  tape all differ materially in codec, wrapper, audio channel order, loudness
  target, caption format, textless requirement and file-naming convention.
  Nothing here can tell you a delivery will be rejected before you send it.
  Attach to `distribution/lib-dist.js`: give each deliverable a `spec` object
  (container, codec, bit depth, chroma, resolution, fps, scan, colour primaries,
  audio layout, loudness target, naming pattern) and let a preset override it
  per buyer. This is the natural input to the QC report above — the two should
  be built together. Two days, mostly research; every figure must be verifiable
  and unverified ones get a search link per the brief's rule.

- **A version → screening → note → cut chain — VALUE: MED-HIGH.** Four things
  exist that should be one thing: `post` logs a version name
  (`lib-post.js:197-204`), `screening` holds notes against an unidentified
  video file (`lib-screen.js:17-23`), the Editor holds markers with no
  provenance (`cut-ui.js:206-209`), and `SB_ReviewNotes_v1` in Tools holds a
  fifth, unrelated note set. Nobody can answer "which notes did v04 address?"
  or "what changed between DC v03 and v04?". Attach to `post/lib-post.js`:
  give a version a stable id, have `screening` stamp its session with that id,
  and have the Editor record which markers it resolved. Half a day of plumbing
  for the single biggest jump in post credibility.

- **A second video track and real trim modes — VALUE: MED.** V1 only, ripple
  only (`lib-cut.js:25-28`); there is no V2, so no insert over, no split screen,
  no title-over-picture beyond the separate titles track, and no B-roll. The
  trim handles (`cut-ui.js:577-611`) implement ripple trim; roll, slip and
  slide are impossible, and there is no source monitor or 3-point editing
  (`editor/index.html:61` has exactly one canvas). Track locking, enable/disable
  and mute do not exist. Attach to `editor/lib-cut.js` as `video2[]` with an
  explicit `start` per clip — the `videoAt` compositing already handles an
  alpha hold, so a second layer is a smaller change than it looks. Two days.

- **Change lists — VALUE: MED.** Once a version chain exists, the diff between
  two `SB_Cut_v1` snapshots is a change list, which is what sound and VFX need
  after every picture change and what makes re-conform possible instead of
  re-doing. Attach to `post/`. Cheap once versions store the cut.

- **VFX pulls with handles — VALUE: MED.** `production/production.js:240-262`
  tracks VFX shots by id, vendor and version, but nothing connects a VFX shot
  to a range on the cut, so nobody can pull the plate with handles. The Editor
  has no shot-level marking beyond clips. Attach: a `vfx` flag plus handle
  length on a video clip, and a pull list export keyed to `SB_VfxShots_v1`.

- **Loudness normalisation on export — VALUE: MED.** `mixAudio`
  (`cut-ui.js:628-655`) sums every source at unity into an
  `OfflineAudioContext` with no limiter and no normalisation. Overlapping clips
  clip. The rendered buffer is right there before encode — an ITU-R BS.1770
  integrated-loudness pass and a look-ahead limiter would be maybe 80 lines and
  would stop the exported screener being rejected.

---

## Evidence

Files read in full: `docs/audit/BRIEF.md`; `editor/lib-cut.js` (389 L),
`editor/lib-mp4.js` (278 L), `editor/cut-ui.js` (963 L),
`editor/timeline-engine.js` (610 L), `editor/index.html`, `editor/editor.css`;
`post/lib-post.js` (264 L), `post/index.html` (279 L);
`dailies/lib-dailies.js` (233 L); `screening/lib-screen.js` (107 L),
`screening/index.html` (178 L); `production/lib-prod.js` (182 L);
`timeline/pro-cut.js` (227 L), `timeline/timeline-export.js` (130 L);
`distribution/lib-dist.js` (117 L); `tools/lib-media.js` (137 L);
`js/ffmpeg-wasm.js` (264 L); `scripts/test_cut.mjs` (152 L); `_headers`;
`netlify.toml`; `_redirects`.

Partial reads: `dailies/index.html:280-336`; `production/production.js:200-360`;
`tools/tools-media-ui.js:1-200`; `timeline/timeline.js:1210-1290`;
`workflow/workflow.js:135-175`; `workflow/advisor.js:168-195`;
`dashboard.html:2175-2200`; `netlify/functions/gate.js:141-153`;
`netlify/functions/generate-video.js:130-150`; `scripts/test_assist.mjs:1-70`.

Verified by execution:
- `node scripts/run_all_tests.mjs` → **44/44 suites passed** (cut, post,
  dailies, assist all green).

Verified by repo-wide grep (zero hits, confirming absence):
`AAF`, `FCPXML`/`fcpxml`, `LUFS`, `loudness`, `R128`, `A/85`, `co64`,
`29.97`, `23.976`, `relink`.

Verified by grep (single write, zero reads): `SB_DailiesPicks_v1` —
written only at `dailies/index.html:308`.

Verified by grep (store fragmentation): `SB_TakeLog_v1` is written by
`tools/tools-media-ui.js:38` and read by `production/production.js:220`;
`SB_Dailies_v1` (`dailies/index.html:142`) is read by nothing outside dailies.
`SB_Cut_v1` is read by `screening/index.html:159`, `dashboard.html:2184`,
`production/production.js:287`, `workflow/workflow.js:215`,
`workflow/advisor-ui.js:55`. `SB_Editor_v1` (`editor/timeline-engine.js:573`)
has no live mount point — the only `binItems` id on the site is `tle-binItems`
at `timeline/index.html:198`, which uses `SB_Editor_embed_v1`
(`timeline/timeline.js:1226`).

Claims I checked by hand rather than assuming: the ISO-BMFF box layouts in
`lib-mp4.js` (`mvhd`, `tkhd`, `mdhd`, `hdlr`, `vmhd`, `smhd`, `avc1`, `mp4a`,
`esds` descriptor chain, `stts`/`stsz`/`stsc`/`stco`/`stss`) against the
14496-12 and 14496-1 field orders — all correct, including the `sampleRate << 16`
int32 wrap at `:171`, which is saved by `u32()` using `>>>`. The EDL
source-vs-record duration mismatch on a speed change was worked through against
the exact event line asserted in `scripts/test_cut.mjs:72`.
