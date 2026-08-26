# Production Sound Mixer

Read as the person who has to hand post a set of files that cut together. The
short answer to "is production sound represented at all": **partly — there is a
sound report and a take log with a roll and a timecode field, and both are real.
Everything downstream of that is a hole.** Audio metadata dies at the exact
moment it leaves the Dailies take row: nothing on this platform knows which
track is the boom, nothing pairs a WAV to a camera file, and nothing carries a
channel name past a plain-text export you can only copy to the clipboard.

## What exists and works

- `dailies/lib-dailies.js:179-200` — `soundReport()` is a genuine per-day sound
  report: slate, take, roll, TC in, circled marker, NG reason. It is the only
  real sound-department artifact on the platform and it is honest about its
  standing (`:197-198` tells you to cross-check the mixer's own sheet).
- `dailies/lib-dailies.js:36-78` — slate arithmetic is correct. Bijective
  base-26 setup letters (12A → 12B, 12Z → 12AA), `nextSlate()` bumps the take on
  the same scene, `nextSetup()` bumps the letter. This is what actually gets
  chalked; whoever wrote it has held a slate.
- `dailies/index.html:89` — the NG dropdown carries `boom in` and
  `plane / noise` alongside focus and performance. Those are the two things that
  kill takes for sound, and they are first-class options, not free text.
- `dailies/index.html:186-192` — `addTake()` clears the note, NG and TC fields
  but deliberately leaves `dlRoll` populated, so the sound roll carries forward
  across the day exactly as it should. Small detail, correctly done.
- `tools/tools-media-ui.js:62-80` — the digital slate flashes the div and fires
  a 1 kHz oscillator burst for 80 ms. That is a usable sync mark on a shoot with
  no timecode slate, and it is a real feature, not a mock.
- `production/production.js:194-205` — `SB_SoundReports_v1` register (date,
  roll, scene, TC, mics, notes) with CSV export via `tools/tools-core.js:87-96`,
  including the leading-apostrophe formula-injection guard at `:82-85`. Crude
  schema, but it persists and it exports safely.
- `post/lib-post.js:19-34` — the post template gets the sound dependency graph
  right: `sound-edit` (10d) blocks `mix` (5d) blocks `m-and-e` (2d), and `qc`
  (`:31`) waits on `mix` as well as grade and VFX. Nobody QCs before the mix.
- `distribution/lib-dist.js:20-23` — audio deliverables are correct and complete
  for an indie: 5.1 printmaster, 2.0 Lt/Rt fold-down, M&E (foley-filled), DME
  stems. That list is what a distributor actually asks for.
- `js/budget-engine.js:679,703` — production sound (acct 7000 = 4% of BTL labour
  + 5% of the equipment allowance) and post sound (15400, scaled by budget tier
  at `:67-72`) are separate lines that move with crew size and scale. Fine.
- `editor/lib-cut.js:272-308` — `silences()` and `tighten()` are a working
  amplitude-envelope silence detector with a configurable threshold, minimum
  duration and a `pad` that keeps a breath. Genuinely useful.

## What exists but needs work

- `dailies/lib-dailies.js:81-92` — **the sound report has no track layout.**
  `makeTake()` carries `soundRoll` and `tcIn` and nothing else for sound. A
  sound report exists to tell the dialogue editor *what is on each channel*;
  this one cannot say boom vs lav, cannot name a track, cannot state channel
  count, sample rate, bit depth, file name, TC out, or MOS. Post receives a
  report that answers none of the questions it is for. Add
  `tracks:[{ch,name,mic:'boom'|'lav'|'plant'|'mix',talent}]`, `fmt:{sr,bits,poly}`,
  `fileName`, `tcOut`, `mos` to `makeTake()`, print a format header block and a
  channel column in `soundReport()` (`:182-188`). **HIGH.**
- `production/production.js:202` — **wild lines and room tone exist only as a
  column label.** The literal string `'Notes (wild lines, room tone)'` is the
  platform's entire representation of non-sync recording. There is no way to log
  a wild track, no way to mark a take MOS, and no room-tone check anywhere. A
  sound report with no room-tone line is incomplete and post will phone you for
  it. Add a `kind` field (`sync|wild|room tone|MOS|playback`) to `makeTake()` and
  a per-location room-tone warning in `coverageByScene()`
  (`dailies/lib-dailies.js:126-143`). **HIGH.**
- `production/lib-prod.js:21-47` + `production/production.js:220` — **the Daily
  Production Report reads the wrong take log and its arithmetic is broken for
  both.** It reads `SB_TakeLog_v1` (the Tools slate, `tools/tools-media-ui.js:38`),
  while the Dailies module writes `SB_Dailies_v1` (`dailies/index.html:142`), so
  a full day logged in Dailies produces an empty DPR. Worse, `lib-prod.js:27`
  filters on `t.date` and *neither* store writes a `date` field — Tools writes
  `time` (HH:MM, `tools-media-ui.js:74`), Dailies writes `day`
  (`lib-dailies.js:86`) — so `!t.date` is always true and every take ever logged
  is counted as today's. `lib-prod.js:30` tests `t.status || t.print`, which
  neither store has (Tools has `grade`, Dailies has `circled`), so
  `printedCount` is permanently 0. `scripts/test_modules.mjs:96` passes only
  because it feeds a synthetic `{status,date}` shape no store produces. The DPR
  is the sound department's route to say "we lost the afternoon to a leaf
  blower", and it is reporting fiction. **HIGH.**
- `dailies/lib-dailies.js:168,193` + `dailies/index.html:237` — **NG reasons are
  captured and never counted.** `ngReason` is only ever concatenated into a text
  line; there is no aggregation anywhere in the repo. "Nine takes lost to
  aircraft at the church" is the single most actionable number the sound
  department produces — it moves a schedule and it sizes an ADR budget — and the
  data is already being collected. Add `ngBreakdown(takes,{by:'day'|'scene'|'location'})`
  to `lib-dailies.js`, surface it in the DPR and on the location record. **HIGH,
  and cheap — the capture already works.**
- `editor/cut-ui.js:186,272,631,659,694` + `editor/index.html:78` — **the editor
  cannot represent multichannel production sound.** An audio clip is
  `{label,start,in,out,gain}` (`:186`); the mixdown renders into a 2-channel
  `OfflineAudioContext` (`:631`) and the encoder hard-codes `numberOfChannels: 2`
  (`:659,694`); the waveform is drawn from `getChannelData(0)` only (`:272`); and
  the timeline has exactly one audio lane, `A1` (`editor/index.html:78`). Drop a
  4- or 8-track poly WAV off a recorder onto this and it is silently folded to
  stereo by WebAudio's default mixing rules, with no channel picker, no ISO
  access, no mute/solo, no pan. Minimum honest fix: a per-clip `ch` index into
  `getChannelData(n)` plus a channel selector in the inspector
  (`cut-ui.js:465-470`). Real fix: N audio lanes. **HIGH.**
- `dailies/index.html:306-310` — **the circled-take pull list goes nowhere.** The
  button writes `SB_DailiesPicks_v1` and toasts "sent — the Editor can use it as
  a pull list". Nothing reads that key: a grep across `editor/`, `post/`,
  `production/` and `timeline/` returns nothing, and the only other reference in
  the repo is the shape assertion at `scripts/test_dailies.mjs:102`. Circles are
  the first thing a sound editor pulls. A button claiming a handoff that does not
  happen is worse than no button. **HIGH.**
- `editor/lib-cut.js:16,131-144` + `editor/index.html:97` — **timecode base is
  frozen at 24 fps and drop-frame is asserted rather than computed.** `blank()`
  sets `fps: 24` and `project.fps` is never written from the UI — `cut-ui.js:702`
  reads `edFps` only inside `exportMp4`, so exporting at 30 leaves every EDL,
  OTIO and cue-sheet timecode at 24. The selector offers 24 and 30 only: no
  23.976, no 25, no 29.97. `lib-cut.js:144` emits `FCM: NON-DROP FRAME`
  unconditionally, and `tc()` (`:131-140`) does integer modulo arithmetic that is
  simply wrong at fractional rates. `production/lib-prod.js:63-68` duplicates the
  same maths for the music cue sheet. Any cue sheet or EDL sent to a mix stage at
  23.976 carries wrong numbers. Make `fps` a project field with
  23.976/24/25/29.97DF/30 and implement real drop-frame in `tc()`. **HIGH.**
- `editor/lib-cut.js:142-157` + `editor/cut-ui.js:915,919` — **the EDL has no
  audio events, and an audio-only turnover is impossible.** `edl()` iterates
  `p.video` only, and both the EDL and OTIO buttons refuse to run unless
  `project.video.length` is non-zero. A sound turnover EDL is a routine
  deliverable. Emit `A`/`A2` event lines from `p.audio` and drop the video gate.
  **MED.**
- `producer/schedule-board.js:314-328` — **the call sheet has no sound
  department and no special instructions.** It renders scenes, cast status,
  locations and a free-text note. There is no crew call, no department block, and
  nowhere to print "SC 14 PLAYBACK", "SC 22 MOS", "blanks fired — hearing
  protection", or "generator 200 ft minimum". That block is how the sound
  department learns what is coming. Add a `special[]` array to
  `board.dayMeta[d]` and a Sound line to the sheet. **MED.**
- `locations/index.html:126,360-369` + `locations/lib-scout.js:515,524-533` —
  **location noise is one global tick for the whole production.** The checklist
  item is right (`lib-scout.js:515`: "Flight paths, traffic, HVAC, schools,
  church bells — listen at the hour you will shoot"), but `st.checks` is a single
  object with no location scoping, so ten locations share one "noise" tick, and
  `blankLocation()` has no noise field to write a finding into. Meanwhile a
  second, unrelated location book lives in the Production Office
  (`production/production.js:127-145`, key `SB_Locations_v1`) with one combined
  free-text field labelled "Power / parking / sound". A noise problem found on a
  scout has no home and cannot reach the schedule. Move `checks` onto the
  location record and add `noise:{rating,sources[],timeOfDay,notes}`. **MED.**
- `post/lib-post.js:207` — **you can bid a mix but not a sound edit.**
  `SERVICES = ['grade','mix','vfx','dcp','qc']`. Sound edit, ADR and foley are
  separate vendors with separate POs, and `TEMPLATE:27` already has the
  `sound-edit` milestone — the bid list just does not match the calendar. Add
  `'sound-edit'`, `'adr'`, `'foley'`. **MED.**
- `workflow/workflow.js:144-161` — **the pipeline delivers a film with no mix.**
  The Deliver stage checklist is captions / credit roll / press kit / final
  export. No sound item appears in any of the seven stages, and there is no
  Shoot stage in which production sound could exist at all;
  `workflow/advisor.js:117` (`add('Sound','Mixer + boom',2,'production sound')`)
  is the entire platform's acknowledgement that a boom operator exists. Add a
  sound gate keyed off `SB_Post_v1` bids and versions. **MED.**
- `producer/budget-sheet.js:21` — **account 7000 has two line items:**
  'Sound mixer & boom' and 'Sound package'. Missing: sound utility, radio-mic
  channels (the line that actually scales), timecode slate and lockits,
  comteks/IFB, batteries and expendables, playback rental, cart. The estimator at
  `js/budget-engine.js:679` is a defensible percentage but responds to no
  sound-specific driver (channel count, playback days, crowd work). **MED.**
- `dailies/lib-dailies.js:88` — `camera: cam === 'B' ? 'B' : 'A'` collapses C-cam
  and any splinter-unit camera to A. On a multi-cam day where each camera carries
  a different mic plan, the report cannot say which camera a take belongs to.
  **LOW.**
- `dailies/index.html:113-117,277-280` — **the sound report can only be copied to
  the clipboard.** No `.txt` download, no print stylesheet, while the DPR next
  door has both (`production/production.js:233-236`). A sound report you cannot
  attach to an email is not a report. **LOW — one `dl()` call.**
- `dailies/index.html:87,192` — `tcIn` is hand-typed per take and cleared after
  each one. There is no free-run/record-run mode, no start-of-day jam reference,
  and no `tcOut`. Nobody types timecode on a set. **LOW as a field change, but
  it is why the TC column is empty on every real report.**
- `safety/lib-safety.js:15-21` — the weapons hazard has an armorer, custody,
  muzzle discipline and cold/hot calls, but no hearing protection and no
  obligation to warn the sound department before blanks are fired. One line in
  the `controls` array. **LOW.**

## What is missing entirely

- **RF / radio-mic frequency coordination** — value **HIGH**. There is no trace
  of it anywhere: searching the source for `RF`, `frequency`, `wireless` and
  `radio mic` returns the slate's 1 kHz oscillator (`tools/tools-media-ui.js:69`)
  and nothing else; `walkie` appears only as a prop-category keyword
  (`props/lib-props.js:101`), a safety briefing line (`safety/lib-safety.js:48`)
  and a cell-coverage note (`locations/lib-scout.js:516`). What a production
  needs: a per-location channel plan (block, frequency and transmitter per
  channel, TV-band exclusions for that city, walkie and IFB frequencies), a scan
  log per location per day, and a conflict check. Above four channels this is the
  thing that stops the day. Attach to `locations/` as a per-location RF page,
  with the day's plan printing on the call sheet. Build: a `locations/lib-rf.js`
  pure module — channel model, spacing rule, two-transmitter third-order
  intermod check, scan log — plus one page section and a `scripts/test_rf.mjs`.
  It is real, testable arithmetic and it fits the platform's constraints exactly.
- **Sync map / dual-system pairing** — value **HIGH**. Nothing on the platform
  says "this WAV goes with this camera file". The take row has `soundRoll` and
  `tcIn` (`dailies/lib-dailies.js:90`); the Editor bin has files with a name and
  a duration and no relationship to a slate, a roll or a scene
  (`editor/cut-ui.js:141-147`). **This is the precise seam where audio metadata
  dies.** Attach to `dailies/` (generated from the take log) and `editor/`
  (consumed on import). Build: `syncMap(takes)` in `lib-dailies.js` emitting
  slate/take → `{cameraFile, soundFile, tcIn, offsetFrames}` plus a CSV/ALE-shaped
  export the NLE side can read, and have `addFiles()` match on it. Moderate:
  one function, one export, one import path.
- **AAF/OMF-style turnover to post sound** — value **HIGH**.
  `post/lib-post.js:24` has a `Turnover` milestone with no artifact behind it.
  The Editor produces MP4, a video-only EDL and OTIO; there is no way to hand a
  sound editor audio with handles and track assignments. Attach to `editor/`. Be
  honest about scope: a real AAF is a structured binary container and writing one
  in dependency-free vanilla JS is not a weekend. The deliverable that fits this
  platform is an audio-only OTIO variant plus a turnover manifest CSV (clip,
  source file, source in/out, handles, track assignment, scene/slate/take from
  the sync map). That covers most of what a sound editor actually needs to
  conform.
- **Room tone / wild track register** — value **HIGH**, and the cheapest item on
  this list. No object, no reminder, no coverage check. Attach to `dailies/`: a
  `kind` field on the take row plus a "room tone recorded?" flag per location on
  the coverage panel (`dailies/index.html:283-300`), which already knows how to
  list gaps. Missing room tone is the single most common thing an indie
  discovers three weeks into the mix.
- **Playback / pre-record plan** — value **MED-HIGH**. `music/lib-music.js:49-59`
  already finds the exact scenes that need it — `sings`, `karaoke`, `band plays`
  are matched and tagged `featured` — and nothing routes that anywhere. There is
  no pre-record deliverable, no playback-source field, no "who runs playback"
  assignment, no guide-vocal record plan, and no budget line. Attach:
  `music/` cue → `producer/` call sheet special instructions → `dailies/` take
  logged as `kind:'playback'`. The detection half already exists.
- **Sound gear / channel-count plan** — value **MED**. No equipment register
  exists for any department (checked `boards/`, `sets/`, `props/`). For sound
  specifically: recorder and track count, boom count, radio channel count,
  comtek count — the numbers that size both the budget line and the RF plan.
  Attach to `production/` as another `T.Register`; that infrastructure already
  gives it CSV export for free.
- **Noise report feeding the schedule** — value **MED**. A per-location,
  per-time-of-day noise finding with a rating the stripboard can read, so a
  dialogue-heavy scene is not boarded against the flight path at 4pm. Attach:
  location record → `producer/schedule-board.js` `autoScheduleModel()`, which
  already groups by location and could weight by it.
- **Boom vs lav continuity** — value **MED**. Nothing records which mic covered a
  take, so a scene cut from a lav take against a boom take — which sounds like a
  cut in the room — stays invisible until the mix. Attach: a Mic column on the
  continuity register (`production/production.js:157-173`) or the `mic` field on
  the take row proposed above.
- **A sound line on the Daily Production Report** — value **LOW-MED**.
  `production/lib-prod.js:35-46` returns scenes, takes, prints, timecards and hot
  cost. No sound rolls shot, no files/cards, no problem log, no wild-track count.
  Once the take-source wiring above is fixed this is a few lines in `dprText()`.

## Evidence

Files read in full: `dailies/lib-dailies.js`, `dailies/index.html`,
`production/lib-prod.js`, `post/lib-post.js`, `post/index.html`,
`editor/lib-cut.js`, `music/lib-music.js`, `tools/tools-media-ui.js`.

Files read in part, with the lines relied on:
- `production/production.js:1-305` — sound/camera report registers (`:176-206`),
  continuity (`:157-173`), locations register (`:127-145`), DPR wiring (`:208-237`),
  cue sheet (`:264-305`), delivery QC (`:329-355`).
- `editor/cut-ui.js:62-300` (bin, audio clip creation `:186`, waveform `:272`),
  `:614-700` (mix/encode), `:698-770` (export), `:905-923` (EDL/OTIO buttons).
- `editor/index.html:76-78` (three fixed lanes V1/T1/A1), `:97` (fps selector),
  `:101-102` (EDL/OTIO buttons).
- `locations/lib-scout.js:507-521` (tech-scout checklist), `:524-533`
  (`blankLocation` shape), `:536-551` (script location mining).
- `locations/index.html:115-234` (state and location cards), `:344-379`
  (golden hour and the global checklist).
- `tools/tools-core.js:55-161` (`Register`, `toCsv`, CSV injection guard).
- `producer/schedule-board.js:296-344` (call sheet), `:371-395` (DOOD).
- `producer/budget-sheet.js:14-32` (default accounts).
- `js/budget-engine.js:65-72` (scale table), `:665-706` (top-sheet layout).
- `workflow/workflow.js:56-180` (pipeline stages), `workflow/advisor.js:97-137`
  (staffing plan).
- `safety/lib-safety.js:13-52` (hazard table).
- `distribution/lib-dist.js:17-26` (deliverables).
- `boards/lib-shots.js:60-114` (shot-list CSV columns — no sound column).
- `scripts/test_dailies.mjs:91-102` (sound report + picks tests),
  `scripts/test_modules.mjs:93-123` (DPR and cue-sheet tests).

Cross-store checks performed: `SB_TakeLog_v1` is written only at
`tools/tools-media-ui.js:38` and read only at `production/production.js:220`;
`SB_Dailies_v1` is written and read only in `dailies/index.html:142`;
`SB_DailiesPicks_v1` is written at `dailies/index.html:308` and read nowhere in
the application. `SB_Locations_v1` (`production/production.js:128`) and
`SB_ScoutBook_v1` (`locations/index.html:119`) are two independent location
books.

Term searches across the whole repo (vendor bundles under `static/` and
`node_modules/` excluded). Zero hits in application source: `AAF`, `OMF`,
`iXML`, `BWF`, `broadcast wave`, `jam sync`, `ISO track`, `lavalier`, `radio
mic`, `wireless mic`, `playback` (as a production term — the only matches are
WebAudio's `playbackRate`), and every RF/frequency-coordination term.
Single hits only: `boom` at `dailies/index.html:89`,
`workflow/advisor.js:117`, `producer/budget-sheet.js:21`; `room tone` and
`wild lines` at `production/production.js:202`; `foley` at
`distribution/lib-dist.js:22` (inside the M&E deliverable label);
`walkie` at `props/lib-props.js:101` (prop-category keyword),
`safety/lib-safety.js:48` and `locations/lib-scout.js:516`.
`ADR` appears only at `agents/client.js:61` as `adr-supervisor` in the LLM agent
roster — a text-generation agent under a `voice-builder` manager, in a directory
excluded from deploys, with no connection to any sound data model.
