# Team A Dev 03 — `editor/`: the NLE, the MP4 muxer, the AI-assist suite

Scope read in full: `editor/lib-mp4.js` (278), `editor/lib-cut.js` (389),
`editor/cut-ui.js` (963), `editor/timeline-engine.js` (610),
`js/ffmpeg-wasm.js` (264), `editor/index.html`, plus the second `CMux`
consumer at `boards/boards.js:245` and `static/ffmpeg/`.

Every claim below that says "confirmed" was executed against the real module
in node, not inferred. Claims about browser wall-clock are marked as estimates.

---

## What exists and works

- `editor/lib-mp4.js:209` — `buildMp4()` produces a **structurally correct**
  ISO-BMFF file. I built a synthetic 2-track file and parsed it back: box
  order is `ftyp(32) moov(1621) mdat(33008)`; each `trak` carries
  `stsd,stts,stss,stsc,stsz,stco` in spec order; both chunk offsets land
  exactly on their track's first payload byte (1661 and 6461, verified against
  the mdat payload start). This is not a toy.
- `editor/lib-mp4.js:105` — `tkhd` byte layout is correct field-for-field
  (create/mod/id/reserved/duration/reserved8/layer/group/volume/reserved/
  36-byte matrix/width/height), flags 3, volume 0x0100 on audio and 0 on
  video. `mvhd:92`, `mdhd:118` (language 0x55c4 = `und`), `hdlr:125`,
  `dinf:133`, `vmhd`/`smhd` at `:195` are all correct too. I checked these
  against the 14496-12 layouts rather than trusting the header comment.
- `editor/lib-mp4.js:141` — `avc1Entry` is the correct 78-byte visual sample
  entry; `mp4aEntry:153` builds a well-formed `esds` (objectTypeIndication
  0x40, streamType 0x15, DecSpecificInfo tag 0x05, SLConfig 0x06). The
  4-byte expandable descriptor length at `:48` is legal.
- `editor/lib-mp4.js:218` — the two-pass chunk-offset computation is sound:
  `u32` is fixed-width so the moov cannot change size between passes, and
  `:232` asserts it anyway. Confirmed no drift on a real build.
- `editor/lib-cut.js:23-96` — the timeline model (`effDur`/`starts`/
  `duration`/`videoAt`/`titlesAt`/`audioAt`) is clean, pure and genuinely
  node-testable. `videoAt` handling of a crossfade's outgoing hold (`:61`)
  and the symmetric fade-to-black tail (`:71`) is more careful than most
  hobby NLEs.
- `editor/cut-ui.js:722-746` — the WebCodecs export path is correct in
  outline: codec negotiation walks `avc1.640028 → 4d401f → 42001f` with
  `isConfigSupported`, backpressure is respected (`encodeQueueSize > 4`),
  a keyframe lands every 2 s, and there is a real MediaRecorder fallback
  (`:775`) for browsers with no `VideoEncoder`. The `avc: {format:'avc'}`
  request at `:707` is the right choice for an MP4 target (length-prefixed,
  not Annex-B) — getting that wrong is the usual reason a hand-rolled muxer
  produces an unplayable file, and it is right here.
- `editor/cut-ui.js:31-57` — IndexedDB media persistence with an explicit
  `missing` state on reload (`:807-812`) is the right design; blob URLs do
  not survive a reload and this module knows it.
- `js/ffmpeg-wasm.js:7-16` — `assertIsolated()` fails loudly and accurately
  on the real cause (no `crossOriginIsolated` / no `SharedArrayBuffer`)
  instead of dying inside wasm. `:35-79` builds the worker from a blob so
  there is no CDN dependency — correct per the brief's no-third-party rule,
  and the only Web Worker anywhere in the editor stack.
- `scripts/test_cut.mjs` passes 100%. Note for the record: the full suite is
  **43/44, not the 44/44 the brief claims** — `test_set3d_browser` fails on
  "the Set Designer draws the placed prop". Not my slice; flagging for
  whoever owns `sets/`.

---

## What exists but needs work

### HIGH — the exported MP4 has a permanent ~21 ms audio lag (no edit list)

`editor/lib-mp4.js` never writes an `edts`/`elst`. Confirmed by parsing a
real build: `has edts/elst: false` on both tracks. `edts` appears in the file
only as a string in the parser's container table (`:242`).

Every AAC-LC encoder emits ~1024 samples of priming (decoder delay) before
the first real sample. Without an `elst` whose `media_time` skips that
priming, the decoder plays 1024 samples of encoder silence first, so **audio
sits 21.3 ms late against picture in every single export** — about half a
frame at 24 fps. Separately, `encodeAudio` (`cut-ui.js:657`) emits whole
1024-sample packets, so the audio track overshoots the video track: measured
`60.0107 s` audio against `60.0000 s` video (confirmed by reading the two
`mdhd` boxes back out of a real build).

Why it matters: 21 ms is inside the range a colourist or a sound mixer will
call out on a review copy, and it is exactly the kind of defect that gets
blamed on the picture department. It is also cumulative-looking to a client
even though it is constant.

Fix: add `elst(version 0, entries=[{segment_duration: trackDurMv,
media_time: primingSamples, media_rate: 1<<16}])` wrapped in `edts`, inserted
into `trackBoxes` between `tkhd` and `mdia` (`lib-mp4.js:201`). Take the
priming count from the first chunk's negative timestamp, or default to 1024
for `mp4a.40.2`. Use the same box to trim the tail overshoot by setting
`segment_duration` to the true video duration.

### HIGH — `otio()` puts every audio cue at the wrong time once there are two

`editor/lib-cut.js:190-207` emits a `Gap.1` of length `a.start` before *each*
audio clip. OTIO track children are sequential, so the gaps accumulate.

Confirmed: two cues at `start: 2` and `start: 10` on a 24 fps timeline export
as `Gap(48f), Clip(72f), Gap(240f), Clip(72f)` — the second cue lands at
**frame 360 (15.0 s) instead of frame 240 (10.0 s)**, 5 seconds late.

Why it matters: OTIO is the handoff to Resolve and Premiere. A cut with a
score cue and a source-music cue conforms wrong on the first try, silently,
and the assistant editor has to find it by ear.

Fix: track a running cursor. Gap length must be `a.start - cursor`, where
`cursor` is the end of the previous clip; if it is negative the cues overlap
and need a second `Track.1` named `A2`. Same file, ~8 lines.

### HIGH — the EDL loses every transition and can be a frame short

Two confirmed defects in `editor/lib-cut.js:142`:

1. **All transitions are emitted as hard cuts.** `:150` hardcodes the
   transition column to `C`. A clip with `trans: {type:'crossfade', dur:1}`
   exports as `002  AX  V  C  ...` — verified. CMX3600 expresses a dissolve
   as a `C` event for the outgoing frame plus a `D` event carrying the
   dissolve length. So every dissolve the editor set is thrown away on
   conform, with no warning.
2. **Source and record durations can disagree by a frame.** `tc()` (`:131`)
   rounds each of the four timecodes independently with `Math.round(sec*fps)`.
   Verified case at 24 fps: a clip of `in 0 → out 0.52` after a 0.02 s clip
   reports `src=12f rec=13f`. Resolve conforms the record side, so the cut
   drifts one frame relative to what the editor saw.

Fix for (1): emit the `D` pair with the dissolve length in frames. Fix for
(2): quantise the model to frames — see the frame-accurate time model below —
or at minimum derive `recOut` as `recIn + (srcOut - srcIn)` in frame space so
the two sides cannot disagree. Also emit `* SOURCE FILE:` and a real reel
name; every event currently uses the reel `AX` (`:150`), which Resolve
cannot relink.

### HIGH — export seeks a `<video>` element once per frame, on the main thread

`cut-ui.js:736-745` walks frames serially; each iteration calls
`drawFrame(tt, octx, W, H, true)` (`:298`) with `exact = true`, which awaits
`seekVideo()` (`:288`) — a full `<video>` seek and a `seeked` event, per
exported frame. A 3-minute cut at 24 fps is 4320 seeks.

Two consequences:

- **Speed.** A non-keyframe seek in Chrome is tens of milliseconds, so export
  is realistically several times slower than real time and the tab is
  unresponsive between awaits. (Wall-clock is an estimate — I could not run a
  browser here — but the seek-per-frame structure is not in doubt.)
- **Correctness, and this is the worse one.** `seekVideo:294` has
  `setTimeout(done, 2000)` — after 2 s it resolves *as if the seek completed*.
  Under load the encoder then receives the previously-decoded frame with no
  error and no log. The export silently contains duplicated/wrong frames.

Fix: stop random-access seeking. Decode each source **forward, in
presentation order**, with `VideoDecoder` in a worker and a small ring cache
— the timeline is walked monotonically, so sequential decode is the natural
access pattern and needs no seeking at all except at clip boundaries.
Interface sketched under *Missing* below. As an immediate mitigation,
`seekVideo`'s timeout should reject rather than resolve, so a bad export
fails loudly instead of shipping.

### HIGH — memory: `buildMp4` allocates 4× the payload, on top of 2× already spent

Instrumented `concat()` on a real build: for a 281 MB payload, `buildMp4`
allocated **1125 MB across four full-size copies — exactly 4.00× payload**.
The nesting at `lib-mp4.js:22-35` and `:235-238` copies the mdat body once
per enclosing box.

That is on top of `cut-ui.js:721-756`, which holds every encoded chunk in
`chunks[]` and then concatenates into `vdata` (2× payload live, and `chunks`
stays referenced), plus `new Blob([mp4])` at `:766` (one more copy).

Realistic peak for a 5-minute 1080p cut at the configured bitrate
(`W*H*fps*0.12` ≈ 6 Mbps, so ~224 MB of video): roughly **0.9–1.1 GB live**.
A 10-minute cut is at real risk of an OOM tab crash, and on mobile Safari far
sooner.

Fix: `buildMp4` should return an ordered array of `Uint8Array` parts (or a
`Blob`) instead of one flat buffer — the caller only ever wraps it in a Blob,
which accepts parts natively, so all four copies disappear. `box()` should
build a parts list, not concatenate. This is a contained change to
`lib-mp4.js` with a compatible shim, and `boards/boards.js:245` benefits too.

### MED-HIGH — beat cut shows the same half-second of footage over and over

`lib-cut.js:334` `cutToBeats()` cycles clips with `k % clips.length` but reads
`src.in` fresh every time, so each recurrence of a source uses the identical
range. Confirmed: 6 beats over 2 sources produced
`s1 0.00-0.50 | s2 0.00-0.50 | s1 0.00-0.50 | s2 0.00-0.50 | s1 0.00-0.50 |
s2 0.00-0.50`.

So "cut to the music" on a 90-second track with 4 sources is the same four
half-second shots looping 45 times. It also discards all colour, speed and
transition settings (`:345` builds bare clips) and replaces `p.video`
wholesale (`:348`).

Fix: keep a per-source read cursor that advances by `take` and wraps at
`srcDur`, and carry `color`/`speed` forward from the source clip.

### MED-HIGH — `renderTimeline()` + `fillWaves()` run on every pointermove of a trim drag

`cut-ui.js:601` calls `renderTimeline()` inside the trim `pointermove`
handler. `renderTimeline` (`:218`) rebuilds the innerHTML of all three tracks
and then calls `fillWaves()` (`:239`), which walks **every** `canvas.ed-wave`
in the document, resizes it and redraws 240 peak bars. At pointer rate on a
40-clip timeline that is ~40 canvas rebuilds per event.

Fix: during a drag, mutate only the dragged element's `style.left/width` and
call the full `renderTimeline()` once on `pointerup` (`:603`).

### MED-HIGH — `timeline-engine.js` rebuilds the whole timeline 20×/s during playback

`editor/timeline-engine.js:313-320`: `startPlay()` runs
`setInterval(..., 50)` and calls `renderTimeline()` on every tick.
`renderTimeline` (`:158`) sets `lane.innerHTML = ''` and then re-creates every
clip div — **each containing a `<video class="clip-thumb" preload="metadata">`
(`:192`)**. So 20 times a second every clip's video element is destroyed and
recreated, re-triggering metadata fetch and decoder setup.

This is worse than anything in `cut-ui.js` and it is on the Studio's editor
(`timeline/index.html:318`), which is the one most owners will actually open.

Fix: hoist the playhead update out of the render (`ph.style.left` alone),
switch the interval to `requestAnimationFrame`, and rebuild clips only when
`state.timeline` changes.

### MED — `getAudioBuffer` decodes whole sources to RAM and never evicts

`cut-ui.js:243-254` caches a decoded `AudioBuffer` per source in `audioBufs`,
forever. A 10-minute 48 kHz stereo buffer is ~115 MB of `Float32`. A 20-clip
Studio bin is ~2.3 GB. `mixAudio` (`:628`) then builds an
`OfflineAudioContext` of `durSec * 48000 * 2` on top.

Fix: an LRU cache keyed by source with a byte budget (see *decode cache*
below), and for `mixAudio`, render in chunks rather than one context sized to
the whole timeline.

### MED — one `<video>` element per source, never released

`cut-ui.js:65,279-287` — `vids[srcId]` grows without bound and each entry
holds a live decoder. Chrome caps concurrent decoders (order of tens on
desktop, far fewer on mobile); past the cap `<video>` elements silently stop
decoding, which will present as "some clips render black". Reachable with a
Studio bin of 40 clips.

Fix: pool a small fixed number of elements (4–6) and rebind `src` on demand,
or move to `VideoDecoder` and delete the pool entirely.

### MED — `silences()` is a fixed level gate, not silence detection

`lib-cut.js:272` thresholds a peak envelope at a hardcoded `0.04`. Computed:
that is **−28.0 dBFS**. Typical location room tone peaks −50 to −30 dBFS and
dialogue peaks −18 to −12 dBFS. So on a clean studio take the gate finds
everything, and on a noisy location take whose room tone sits at −29 dBFS it
finds **nothing at all** — and the UI reports "No leading/trailing silence
found" (`cut-ui.js:893`), which reads as "your take is clean" rather than
"the detector could not cope".

Compounding it, `envelopeFor` (`cut-ui.js:859-876`) steps the inner loop by
16, so it inspects 60 of every 960 samples — an effective peak-detect rate of
**3 kHz**. Transients are smeared.

Fix: estimate the noise floor as the ~10th percentile of the envelope and set
`threshold = floor * k` (or floor + 9 dB), which is what every real detector
does; expose `k` rather than an absolute level. Drop the `+= 16` stride, or
replace peak with a proper RMS over the window — RMS over 960 samples is
cheaper than 60 `Math.abs` + `Math.max` and is the correct statistic.

### MED — `tighten()` cannot remove interior silence, which is the case that matters

`lib-cut.js:291` only pulls `in` past a silence that already touches `c.in`
(`:297`) and `out` back past one touching `c.out` (`:301`). A three-minute
interview take with a 4-second pause in the middle is untouched.

The UI calls this "Listening for dead air…" and reports "Xs of dead air
removed" (`cut-ui.js:881,893`), which promises the interior case.

Fix: for interior silences longer than `minDur`, split the clip and drop the
silent span (ripple). `C.split()` already exists at `:99` — this is
composition, not new machinery.

### MED — `beats()` is an onset detector wearing a beat-tracker's label

`lib-cut.js:312`. It flags any envelope sample exceeding a 1-second trailing
mean by 1.5× and above an absolute floor of `0.08` (**−21.9 dBFS**). There is
**no tempo estimation and no phase fitting**, so the output is a list of
unevenly spaced onsets, not a musical grid. Cuts land *near* the beat, which
reads as sloppy rather than rhythmic.

It also compares absolute level to a mean level rather than using a positive
first difference (flux): a track with a sustained loud pad under quiet drums
yields no beats, and a track that fades in yields a burst of false ones. At
`rate = 50` the resolution is 20 ms — about half a frame — and outputs are
then rounded to 10 ms (`:323`) while the timeline is float seconds, so
nothing is frame-aligned.

Fix: keep the onset function, then autocorrelate (or comb-filter) it over
60–180 BPM to pick a tempo, fit phase against the strongest onsets, and emit
a *regular* grid snapped to nearby onsets. ~40 lines of pure DSP, node-
testable, belongs next to `beats()` in `lib-cut.js`. Rename the current
function `onsets()` and let `beats()` be the tracker built on it — the honest
naming is worth as much as the algorithm.

### MED — "Auto" colour does no white balance and is open-loop

`lib-cut.js:366` `autoColor()` is the most principled of the four assists — a
real 5/95 percentile stretch plus a mid-grey pull to 118. Two limits:

1. **It always returns `sat: 1, tw: 0`** (`:377`). So Auto never touches
   white balance, even though the inspector exposes a Warmth slider
   (`cut-ui.js:449`). Matching two cameras on the same setup *is* the white
   balance problem; Auto cannot help with it.
2. **The exposure and contrast terms are computed open-loop and interact.**
   `ex` comes from the pre-contrast mean, but `cssFilter` (`:353`) applies
   `brightness()` then `contrast()`, and CSS `contrast()` pivots about 0.5 in
   non-linear sRGB, so the post-filter mean is not 118. It is a decent
   heuristic; the label "Auto ✨" over-promises.

Also `:497` samples a single 160×90 frame from whatever happens to be
decoded, then applies it to the whole clip — a clip with a pan or a lighting
change gets balanced to one arbitrary moment.

Fix: (a) add a grey-world or white-patch estimate over the RGB channels and
map it to `tw`; (b) iterate twice — apply, re-measure the histogram, correct;
(c) sample 3–5 frames across the clip and take the median.

### MED — `cssFilter`'s warmth control is the wrong operator

`lib-cut.js:359-360`: positive warmth is `sepia()` (a fixed matrix that
desaturates toward brown, not a colour temperature) and negative warmth is
`hue-rotate(-24deg)`, which rotates *every* hue — it turns skin green while
cooling the sky.

Fix: `ctx.filter` accepts an SVG filter reference (`url(#id)`), and
`feComponentTransfer` with per-channel linear slopes gives a real R/B gain,
i.e. an actual temperature trim. That works identically in preview and in
export because both go through `drawFrame`.

### MED — no `ctts`, so the muxer assumes B-frames never appear

Confirmed `has ctts: false`. `cut-ui.js:757-761` synthesises durations as
`sizes.map(() => Math.round(90000/fps))` and ignores `chunk.timestamp`
entirely. If a WebCodecs encoder ever emits B-frames, output order is decode
order, presentation order differs, and without `ctts` the file plays frames
out of order.

Today Chrome's WebCodecs H.264 path does not emit B-frames, so this is latent
rather than broken. But it is latent by luck, not by contract.

Fix: either pin it — pass `latencyMode: 'realtime'` in the encoder config at
`cut-ui.js:707`, which contractually suppresses B-frames — or do it properly:
retain `chunk.timestamp`, sort by it, and emit a `ctts` table. Pinning is one
line and I would do that first.

### MED — the export is non-interleaved: one video chunk, then one audio chunk

Confirmed offsets: video chunk at 1661, audio chunk at 6461 (= mdat start +
the entire video payload). `stsc` declares one chunk holding every sample
(`lib-mp4.js:75-79`), and `buildMp4:230-234` lays tracks out back to back.

This is legal ISO-BMFF and desktop players handle it, but it means a player
must reach the end of the file before it has any audio. Progressive HTTP
playback and hardware players (TV apps, some Android media pipelines) do
badly with it. Given the assignment's "plays in Chrome and nowhere else"
concern, this is the most likely portability trap in the file — more likely
than any box error, because the boxes are right.

Fix: interleave in ~1-second chunks. `stsc` becomes a multi-entry table and
`stco` a real offset list; `trackBoxes` already takes an offset, so the
change is localised to `buildMp4` plus generalising `stsc`/`stco`.

### MED — no `co64`; the file silently corrupts past 4 GB

`box()` writes the size as `u32` (`lib-mp4.js:31`) and `stco` offsets are
`u32` (`:80`). Confirmed `u32(5e9)` produces `2a05f200` — a silent wrap, no
throw. A feature-length 1080p export (~4 GB at the configured bitrate) would
produce a corrupt file rather than an error, if the tab survived the memory
cost at all.

Fix: at minimum, throw when `payload + moov > 0xFFFFFFFF - 8`. Properly:
64-bit `largesize` on `mdat` and `co64` in place of `stco` above the
threshold. Combined with the memory finding above, the honest framing is that
this is a trailer/short-form tool — it should say so rather than fail
strangely.

### LOW-MED — both `avcC` fallbacks are malformed

`cut-ui.js:761` falls back to `[1,66,0,31,255,225,0,0]` and
`boards/boards.js:249` to `[1,66,0,31,255,225]`. A valid `AVCDecoderConfiguration`
needs SPS length + SPS bytes + PPS count + PPS; both stop after
`numOfSequenceParameterSets`. If `decoderConfig.description` is ever absent
these produce an unplayable file instead of an honest failure.

Fix: throw. There is no useful fallback for a missing SPS/PPS.

### LOW — `stss` is omitted when `sync` is empty, which inverts its meaning

`lib-mp4.js:190`: `if (syncs.length && syncs.length < t.sizes.length)`. An
absent `stss` means *all* samples are sync points. So a caller that passes no
`sync` array gets a file claiming every frame is a keyframe, and seeking
lands on garbage. Both current callers pass it, so this is defensive only.

Fix: write `stss` whenever `t.sync` was supplied, and throw if a video track
omits it.

### LOW — `u32(sampleRate << 16)` overflows above 65535 Hz

`lib-mp4.js:171`. Confirmed: `48000 << 16` → `bb800000` (correct), but
`96000 << 16` → `77000000` instead of `17700000`. Unreachable today (48000 is
hardcoded at `cut-ui.js:733`) but it is a trap for anyone adding 96 kHz.
Fix: `u16(sampleRate), u16(0)`.

### LOW — dead branch in `videoAt`

`lib-cut.js:45-47`: the outer `if` tests `t >= total && ...` but the body only
acts on `t < 0`. The non-negative branch does nothing. Harmless, but it reads
as though it guards the end of the timeline and it does not.

### LOW — the `decoderConfig.description` copy at `cut-ui.js:667` is a no-op ternary

`meta.decoderConfig.description.slice ? description : new Uint8Array(description)`
— both `ArrayBuffer` and every `TypedArray` have `.slice`, so the second arm
is unreachable. It happens to work. Fix: `new Uint8Array(d.buffer ?
d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d)` — which also
handles the offset-view case the current line would get wrong.

---

## What is missing entirely

### 1. One timeline model instead of two editors — **HIGHEST value**

There are **two independent, incompatible NLEs in this repo**, both living in
`editor/`:

| | `cut-ui.js` + `lib-cut.js` | `timeline-engine.js` |
|---|---|---|
| Loaded by | `editor/index.html:111-113` | `timeline/index.html:318` |
| Storage | `SB_Cut_v1` + IndexedDB | `SB_Editor_v1` |
| Model | ripple video + titles + audio, transitions, speed, colour | flat clip list, trimIn/trimOut, transition name |
| Export | WebCodecs → `CMux` (`cut-ui.js:698`) | ffmpeg.wasm (`timeline-engine.js:428`) |
| EDL | `lib-cut.js:142` (CMX-shaped) | `timeline-engine.js:409` (comment lines only, no event records — not a conformable EDL) |

Work done in the Studio's editor is invisible in the cutting room and vice
versa; the only bridge is a one-shot `SB_Timeline_Export` handoff
(`timeline-engine.js:351-372`) and a read of `SB_Timeline_v1`
(`cut-ui.js:154`). Two export pipelines means two sets of the bugs above.

What to build: make `lib-cut.js`'s project the single model, and reduce
`timeline-engine.js` to a thin embedded *view* over it. `SB_Editor_v1` must
keep working — read it, migrate into `SB_Cut_v1` on first load, and leave the
old key in place (per the brief, never rename a live key).

Effort: substantial (the largest item here) but it removes an entire
duplicate codebase and is the precondition for every other improvement
landing once instead of twice.

### 2. A frame-accurate time model — **HIGH**

Nothing in the module quantises to frames. `split()` cuts at a float
(`lib-cut.js:109`), `starts()` accumulates floats (`:25`), and `tc()` rounds
only for display (`:131`) — which is precisely why the EDL can be a frame
short (confirmed above). Every professional NLE is integer-frame internally
for this reason.

```js
// lib-time.js — integer frames in, seconds only at the boundary
CTime = {
  rate(fpsNum, fpsDen),          // {num:24000, den:1001} — carries NDF/DF honestly
  toFrames(sec, rate),           // round-half-even, deterministic
  toSec(frames, rate),
  add(a, b), sub(a, b),          // integer, no accumulation error
  rescale(frames, from, to),     // 24 -> 90000 ticks for the muxer, exact
  tc(frames, rate, {drop}),      // 00:00:00:00 / 00:00:00;00
  parseTc(str, rate)
}
```

Then clip `in`/`out`/`start`/`dur` become integer frames, `starts()` is an
integer prefix sum, and the EDL's source and record sides cannot disagree by
construction. It also unblocks 23.976/29.97, which the UI cannot currently
offer at all (`editor/index.html:97` — only 24 and 30) and which is what
actual deliverables are in.

Effort: moderate — the model change is mechanical, but it touches the
persisted `SB_Cut_v1` shape, so it needs a migration that reads float seconds
and writes frames.

### 3. A media abstraction over decode — **HIGH**

Today the editor talks to `<video>` elements directly in three different
places (`ensureVideo:279`, `syncAudio:407`, `probe:86`) with three different
lifecycle stories and no eviction. Everything above about per-frame seeks,
decoder exhaustion and unbounded `AudioBuffer` caching is downstream of not
having this.

```js
// lib-media.js — no DOM in the interface; the worker owns the decoders
CMedia = {
  open(srcId, blobOrUrl) -> Promise<Handle>,   // probes: dur, w, h, rate, hasAudio
  // sequential is the fast path: the export walks the timeline monotonically
  frames(handle, {fromSec, toSec, rate}) -> AsyncIterable<VideoFrame>,
  frameAt(handle, sec) -> Promise<VideoFrame>, // random access, cache-backed
  audio(handle, {fromSec, toSec, sampleRate}) -> Promise<AudioBuffer>,
  release(handle),
  budget(bytes)                                 // global ceiling, LRU under it
}
```

`frames()` as an async iterator is the important half: export becomes
"iterate the clip's frames in order" instead of "seek 4320 times", which
removes both the speed problem and the silent-wrong-frame problem in one
move. Effort: moderate; `VideoDecoder` is already available in every browser
where the current WebCodecs export works, so it adds no new capability
requirement.

### 4. A worker pool — **HIGH**

There is **no Web Worker and no `OffscreenCanvas` anywhere in `editor/`**
(grepped: the only `Worker` in the whole stack is the ffmpeg blob worker at
`js/ffmpeg-wasm.js:85`). Compositing, encoding, decoding, waveform peaks and
histogram reads all run on the main thread.

```js
// lib-pool.js
CPool = {
  create({src, size}) -> Pool,   // src: a blob-URL worker, per the no-CDN rule
  run(pool, job, transfers) -> Promise<result>,   // structured clone + transfer
  map(pool, jobs, {onProgress}) -> Promise<results[]>,
  size(pool, n),                 // navigator.hardwareConcurrency - 1 by default
  destroy(pool)
}
```

Highest-yield first job to move: waveform peaks (`lib-cut.js:233` + the
`decodeAudioData` at `cut-ui.js:247`), because it is pure, already isolated,
and currently blocks the UI on every bin add. Second: the composite +
`VideoEncoder` loop onto an `OffscreenCanvas` — that alone makes the tab
responsive during export.

Effort: the pool itself is small (~120 lines). Moving each job is
independent, so this can land incrementally.

### 5. A decode cache with a real budget — **MED-HIGH**

`audioBufs`, `peaksCache` and `vids` (`cut-ui.js:65`) are three unbounded
plain objects. Nothing is ever evicted.

```js
// lib-cache.js — pure, node-testable, no DOM
CCache = {
  create({maxBytes, sizeOf}) -> Cache,
  get(cache, key) -> value | undefined,   // touches LRU
  put(cache, key, value),                 // evicts to budget, calls onEvict
  has(cache, key),
  onEvict(cache, fn),                     // so VideoFrame/AudioBuffer get closed
  stats(cache) -> {bytes, count, hits, misses}
}
```

`onEvict` is the part that matters: `VideoFrame` must be explicitly `close()`d
or it holds GPU memory that GC will not reclaim in time. Effort: small, and
it is the cheapest fix for the memory findings above.

### 6. A conform-fidelity test suite — **MED-HIGH**

`scripts/test_cut.mjs` verifies that boxes *exist* and that offsets land
("mp4: stco per track", "mp4: video chunk offset lands on first video byte").
It never checks that the file is *right*: no assertion on `elst`, on `ctts`,
on video-vs-audio track duration agreement, on EDL record/source consistency,
or an OTIO round-trip. Every confirmed bug in this report passes the existing
suite.

What to add, all pure and node-testable:
- muxer: parse the built file back and assert track durations agree within
  one video frame, that `stsc`/`stco`/`stsz` are mutually consistent, and
  that total `stsz` bytes equal the `mdat` payload length;
- EDL: for every event, `recOut - recIn === srcOut - srcIn` in frames, and a
  `D` event exists for every non-cut transition;
- OTIO: walk each track's children summing durations and assert every clip
  lands at its model `start` — this single test catches the audio-gap bug;
- assists: fixture envelopes (a sine burst train at a known BPM, a take with
  a known noise floor) and assert the detectors find the planted answer.

Effort: small, and it is what makes the rest of the work safe.

### 7. Frame-accurate audio scrub / JKL with pitch — **MED**

`syncAudio` (`cut-ui.js:401`) drives raw `<audio>`/`<video>` elements and
resyncs only when drift exceeds 0.25 s (`:417`), so audio is a quarter-second
loose against picture during playback. `shuttle` (`:929-932`) sets
`playbackRate` on the video (`:379`) but audio is never rate-matched at all,
so L-key shuttle plays picture fast against normal-speed audio.

A Web Audio graph (buffer sources scheduled against `AudioContext.currentTime`,
with picture slaved to the audio clock rather than to `performance.now()` at
`:367`) fixes both. Audio clock as master is what every NLE does, and it is
the standard fix for exactly this drift. Effort: moderate.

### 8. Render-ahead cache for preview — **MED**

`drawFrame` recomputes everything per frame and `seek()` drops requests via a
`scrubQueued` boolean (`cut-ui.js:348-356`), so scrubbing feels laggy and
skips. With `CMedia` + `CPool` in place, a small ring of pre-composited
frames around the playhead makes scrubbing smooth. Effort: small *once* items
3 and 4 exist; not worth attempting before them.

---

## Evidence

Read in full:
- `/home/user/shotb/editor/lib-mp4.js` (1–278)
- `/home/user/shotb/editor/lib-cut.js` (1–389)
- `/home/user/shotb/editor/cut-ui.js` (1–963)
- `/home/user/shotb/editor/timeline-engine.js` (1–610)
- `/home/user/shotb/js/ffmpeg-wasm.js` (1–264)

Read in part:
- `/home/user/shotb/editor/index.html:90-97` (resolution/fps options),
  `:111-113` (script tags)
- `/home/user/shotb/timeline/index.html:317-318` (second editor's mount)
- `/home/user/shotb/boards/boards.js:230-250` (second `CMux` consumer)
- `/home/user/shotb/scripts/test_cut.mjs` (coverage survey)
- `/home/user/shotb/static/ffmpeg/` (directory listing; `ffmpeg-core.wasm` is
  32.1 MB, served from origin — no CDN, consistent with the brief)

Executed, not inferred:
- Built a synthetic 2-track MP4 through `CMux.buildMp4` and parsed it back
  with `CMux.parse`/`findAll`. Output: box order `ftyp(32) moov(1621)
  mdat(33008)`; `stbl` children `stsd,stts,stss,stsc,stsz,stco` (video) and
  `stsd,stts,stsc,stsz,stco` (audio); `has edts/elst: false`, `has ctts:
  false`, `has co64: false` on both tracks; `stco[0]=1661`, `stco[1]=6461`
  against `mdat` payload start 1661 and video payload 4800 bytes — confirming
  the non-interleaved layout. `mdhd` read back: video `180000/90000 =
  2.0000 s`, audio `96256/48000 = 2.0053 s`.
- `CCut.otio()` on two audio cues at `start 2` and `start 10`, 24 fps:
  children `Gap(48f), Clip(72f), Gap(240f), Clip(72f)` — second cue at frame
  360, should be 240.
- `CCut.edl()` frame arithmetic: clip `in 0 → out 0.52` following a 0.02 s
  clip gives `src=12f rec=13f`.
- `CCut.edl()` on a clip with `trans:{type:'crossfade',dur:1}`: emitted
  `002  AX       V     C` — no `D` event.
- `CCut.cutToBeats()` with 7 beats and 2 six-second sources: every output
  clip is `0.00-0.50` of its source.
- Instrumented `concat()` in a copy of `lib-mp4.js`: 281.3 MB payload →
  1125.2 MB allocated across four full-size copies (4.00×).
- `u32()` arithmetic: `u32(5e9) = 2a05f200` (silent wrap); `u32(48000<<16) =
  bb800000` (correct); `u32(96000<<16) = 77000000` (wrong, expected
  `17700000`).
- Threshold conversions: `silences()` default `0.04` = −28.0 dBFS;
  `beats()` floor `0.08` = −21.9 dBFS; `envelopeFor(rate=50)` inspects 60 of
  960 samples per bucket = 3 kHz effective.
- `grep` for `Worker|OffscreenCanvas|VideoDecoder|requestIdleCallback` across
  `editor/` and `js/ffmpeg-wasm.js`: only hits are the service-worker
  registration at `editor/index.html:114` and the ffmpeg blob worker at
  `js/ffmpeg-wasm.js:85`.
- `node scripts/run_all_tests.mjs`: **43/44 suites pass**, not 44/44 —
  `test_set3d_browser` fails on "the Set Designer draws the placed prop"
  (31 passed, 1 failed). Outside my slice; noted for `sets/`.
  `node scripts/test_cut.mjs` alone: all checks pass.

No source file was modified.
