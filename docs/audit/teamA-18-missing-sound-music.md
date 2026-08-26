# Team A Dev 18 — missing: sound and music, set to final mix

Scope: production sound, post sound, music rights, mix and delivery audio.
Everything below was searched for before it was called missing; the search is
recorded in **Evidence · where I looked**.

---

## What exists and works

- `music/lib-music.js:65-83` — `scanScript()` finds music moments in the
  screenplay (sings, karaoke, band plays, jukebox, radio, hums, quoted titles)
  and suggests featured vs background from the verb. Honest, useful, and the
  ordering rule at `:49-59` is deliberate rather than accidental.
- `music/lib-music.js:125-147` — sync/master estimated **per side** with a
  library all-in exception (`:22-28`), festival scope at 15% (`:18`), and every
  return carrying a "planning estimate only" note. This is the right posture.
- `music/lib-music.js:184-207` — the sync + master license request letter is a
  genuinely sendable document, including the MFN and credit-language asks.
- `music/index.html:126-140` — a licensed cue with a real quote commits once to
  Money Room account 15000 with a `committedPo` guard. Correct.
- `post/lib-post.js:19-34,118-174` — sound edit → mix → M&E sit in the post
  calendar with real dependencies, and the backward solve at `:131-149` lands
  delivery on the target date exactly. `distReadiness()` (`:238-252`) surfaces
  the 5.1 printmaster and M&E as dated deliverables.
- `dailies/lib-dailies.js:179-200` + `dailies/index.html:113` — a per-day sound
  report export exists and is honest about being the on-set log rather than the
  mixer's report of record (`dailies/index.html:117`).
- `screening/lib-screen.js:34-40,58-84` — timecoded notes with `fmtTc`/`parseTc`
  and conversion into Editor ruler markers. This is the correct foundation for
  any spotting session and should be extended, not replaced.
- `tools/tools-registers.js:124-146` — the Rights register already carries
  `Music sync` and `Music master` agreement kinds with territory, media, term
  start/end and an expiry watch on `termEnd`.
- `distribution/lib-dist.js:20-23` — the audio delivery group names the four
  things buyers ask for: 5.1 printmaster, 2.0 Lt/Rt fold-down, M&E, DME stems.
- `editor/cut-ui.js:141-147,643-651` — audio files import into the bin, persist
  as blobs in IndexedDB `cinamate_cut` (`:34,40`), and the export path renders
  the whole timeline through an `OfflineAudioContext` before AAC encode.

---

## What exists but needs work

- **`production/production.js:302` — the cue-sheet CSV ships with no durations.**
  HIGH. `CProd.cueSheet()` computes `durSec` at `production/lib-prod.js:75-80`,
  but the export re-maps the register rows and hardcodes `durSec: ''`. A PRO
  rejects a cue sheet without cue durations, so today's export cannot be
  submitted. One-line fix: derive seconds from `tcIn`/`tcOut` with
  `CProd.tcOf`'s inverse, or persist `durSec` on the register row.

- **Two disconnected cue sheets.** HIGH. `SB_CueSheet_v1`
  (`production/production.js:272-285`) is timecode-anchored and pulled from the
  cut; `SB_Music_v1` (`music/index.html:114`) holds the rights, tier, quote and
  PO state. Neither knows the other exists — `music/lib-music.js:216-235` prints
  `__:__ – __:__` as the timing for every row (`:228`) because the timings live
  in the other store. A production ends up maintaining the same cue list twice
  and the one with the money on it is the one with blank timings. Merge: give
  `CMusic.makeCue` `tcIn`/`tcOut`/`durSec`, and have the Editor pull write into
  `SB_Music_v1` cues instead of a parallel register.

- **`production/production.js:195-206` — the sound report register is not a
  sound report.** MED. Fields are date, roll, scene, TC, mics, notes; wild lines
  and room tone are a hint inside a free-text `notes` placeholder (`:203`). A
  mixer's report needs the channel map (Tr1 boom / Tr2 lav CHAR / Tr3-4 plants),
  sample rate and bit depth, TC frame rate and whether it is drop-frame, and
  per-take MOS / wild / room-tone / false-start / playback flags. Post cannot
  conform a track from what this captures.

- **`dailies/lib-dailies.js:81-92` — `makeTake` has `soundRoll` and `tcIn` and
  nothing else audio.** MED. No MOS flag, no track assignment, no per-take
  mixer comment distinct from the director's note. `soundReport()` at `:179`
  can therefore only reprint the camera columns with the roll swapped in.

- **`music/lib-music.js:96` — `scope` is a two-value enum, `festival` or
  `all-media`.** HIGH; see the rights gap below. The letter at `:189` sells a
  step-up option to all media, and the estimate note at `:144` tells the owner
  to negotiate it "now, before you need them" — but nothing in the data model
  can record that the option was granted, what it costs, or when it lapses.

- **`editor/cut-ui.js:469` — audio gain is a 0..1 slider.** MED. Below unity
  only, one gain value per clip, one audio track (`editor/lib-cut.js:19`), no
  fades and no automation. You cannot build a temp mix on this, and the AAC
  encode at `cut-ui.js:658-660` is fixed stereo 128 kbps with no level target.

- **`producer/budget-sheet.js:29` — post sound is one line.** LOW. Account 15000
  carries a single "Sound design & mix" item. Once an ADR list exists (below),
  ADR stage days, loop group, foley, and the M&E pass are separately estimable
  and should be separate items.

---

## What is missing entirely

### 1 · ADR list and loop-group plan — HIGH
**What it is.** The per-line record of every piece of dialogue that has to be
re-recorded: character, scene, timecode in/out, the line text, the reason
(traffic/plane/HVAC, wardrobe rustle, performance change, overlapping mic,
censor alt), status (spotted → scheduled → recorded → cut in → approved), the
session it belongs to, and the alt-take/censor variants. Loop group is the same
record for crowd walla.

**Why a production needs it.** ADR is the one post-sound cost that reaches back
into production: it recalls cast, which means recall scheduling, per-diem, a
SAG obligation, and a stage day. An indie feature that discovers its ADR list at
the mix has already lost the actor to another job. It is also the mechanism that
turns a bad sound day into a recoverable one — which is exactly the failure the
on-set sound report is supposed to flag and currently cannot.

**Attach to.** `post/` (new tab in `post/index.html`, logic in a new
`post/lib-adr.js` exposing `CADR`). Cast names come free from the existing
character extraction; scene and line text come from `SB_Timeline_v1.scriptText`
with the same slugline rule used at `music/lib-music.js:33-44`.

**Data model.** `SB_ADR_v1` = `{ v:1, lines:[], sessions:[] }`;
`line = { id, character, scene, tcIn, tcOut, text, reason, priority,
status, sessionId, takes:[{n, notes, selected}], notes }`;
`session = { id, date, studio, character, lineIds:[], hours }`.

**Size.** Medium. ~250 lines of pure logic (grouping lines by character into
sessions, estimating stage hours from line count, an export the mixer can read),
~200 lines of UI, one `scripts/test_adr.mjs`. Suites are auto-discovered
(`scripts/run_all_tests.mjs:43-58`), so a new file needs no registration.

### 2 · A PRO-submittable cue sheet — HIGH
**What it is.** ASCAP/BMI/SESAC/SOCAN all want the same thing and none of it is
here: per-cue **writer** rows with PRO affiliation and shares totalling 100%,
**publisher** rows with affiliation and shares, cue duration in mm:ss, the use
code, and — increasingly — ISWC on the composition and ISRC on the master.

**What exists instead.** `production/production.js:272-285` gives one
`composer` text field, one `publisher` text field, and one free-text `society`
field. There is no way to express two writers at 50/50, no way to express a
publisher share, and no validation that shares sum to 100. `music/lib-music.js:224-225`
prints a single `PUBLISHER` and `MASTER OWNER` column.

**Why a production needs it.** The cue sheet is a contractual delivery item
(`distribution/lib-dist.js:33`, `production/lib-prod.js:157`). A sheet that fails
the PRO's share validation is bounced, the broadcaster's delivery is incomplete,
and the writers do not get paid their performance royalties — the composer's
actual income on a low-budget picture. This is the highest-consequence
data-model gap in the music module.

**Attach to.** `music/lib-music.js` (own the whole cue record there; retire the
duplicate register). Add `writers:[{name, pro, share, ipi}]`,
`publishers:[{name, pro, share, ipi}]`, `iswc`, `isrc`, `tcIn`, `tcOut`,
`durSec`, plus `validateShares(cue)` returning the specific rows that do not sum
to 100. Keep the existing `SB_Music_v1` key; add fields, rename nothing.

**Size.** Small-to-medium. ~120 lines of logic plus a CSV export using the
existing `csvCell` guard pattern (`production/lib-prod.js:88-95`), ~150 lines of
UI, one test suite.

### 3 · Per-cue rights grant: territory · term · media · step-up — HIGH
**What it is.** The licence a cue actually carries: territory (worldwide / US /
festival circuit), term (perpetuity / 5 years / festival window with an end
date), media (all media / theatrical / SVOD / AVOD / in-context promo), option
step-up fee and its exercise deadline, MFN linkage, and per-side status (sync
granted but master still open is the normal state, and it is invisible today).

**Where I looked before calling it missing.** `SB_Rights_v1`
(`tools/tools-registers.js:127-146`) does carry territory/media/term/status with
`Music sync` and `Music master` kinds and an expiry watch — but it is a generic
free-text register, one row per agreement, with no link to a cue, no per-side
pairing, and no step-up concept. `CMusic` itself has only the two-value `scope`
(`music/lib-music.js:16,96`).

**Why a production needs it.** The platform's own estimate note tells you to buy
a festival licence at 15% and negotiate a step-up (`music/lib-music.js:144`).
Taking that advice creates a dated liability: the festival window closes, the
step-up deadline passes, and the picture is now unsellable with that cue in it.
Nothing in Cinamate can warn about that today. Getting caught means a re-cut or
a re-score after picture lock.

**Attach to.** `music/lib-music.js` `makeCue` (`:86-104`), with a one-way mirror
into `SB_Rights_v1` so the E&O chain-of-title view stays whole.

**Data model.** On the cue: `grant = { territory, media:[], termStart, termEnd,
perpetuity:bool, stepUpFee, stepUpDeadline, mfn:bool, syncStatus, masterStatus }`.
Add `expiringCues(cues, todayISO)` — pure, date passed in, matching the
no-`Date.now()` discipline in `post/lib-post.js:42-77`.

**Size.** Small. ~100 lines of logic, ~100 of UI, one test suite.

### 4 · Loudness targets and an audio delivery spec — HIGH
**What it is.** Every delivery has a number: EBU R128 −23 LUFS ±0.5 with −1 dBTP
for European broadcast, ATSC A/85 −24 LKFS for US broadcast, roughly −27 LKFS
dialogue-gated for the major streamers, −14 to −16 LUFS for web trailers, and
theatrical mixed to reference level rather than a LUFS target. Plus channel
layout and file naming per deliverable.

**Where I looked.** `grep -i "lufs|lkfs|loudness|dbtp|true peak"` across every
`.js` and `.html` outside `node_modules`, `static`, `private`: **zero hits**.
`distribution/lib-dist.js:20-23` names the deliverables but no spec;
`post/lib-post.js:233` names "5.1 printmaster" as a string.

**Why a production needs it.** A mix delivered at the wrong integrated loudness
is bounced by QC, and a re-mix after the stage has wrapped is a full stage day
the budget did not carry. It is also the single cheapest QC gate to automate:
the Editor already renders the finished timeline into an `AudioBuffer`
(`editor/cut-ui.js:643-654`), so a K-weighted integrated-loudness and true-peak
measurement is arithmetic over an array that is already in memory.

**Attach to.** A new `post/lib-loudness.js` (`CLoud`) holding the target table
and the R128 gating math; consumed by `distribution` as a per-buyer audio spec
sheet and by `editor` as a "measured −18.4 LUFS · target −23" readout on export.

**Data model.** Static `TARGETS` table (no storage needed) plus
`SB_Post_v1.audioSpec = { target, measuredLufs, truePeak, measuredAt }`.

**Size.** Medium. The R128 filter + gating is ~120 lines and is exactly the kind
of pure function `scripts/test_loudness.mjs` can pin with synthetic buffers.

### 5 · RF / frequency coordination — MED-HIGH
**What it is.** The wireless plan for a shoot day: every transmitter (lav packs,
IEMs, Comteks, camera hops, walkie channels), its frequency, and an
intermodulation check — third-order products `2f₁−f₂` and `f₁+f₂−f₃` landing on
another carrier is what causes the mystery buzz on take 9. Plus a per-location
record of the local TV-band occupancy, which is the reason a plan that worked
downtown fails at the second location.

**Where I looked.** `grep -i "mhz|wireless|frequency|spectrum|intermod|comtek"`
across the repo: the only hits are an oscillator in the slate tool
(`tools/tools-media-ui.js:69`), a walkie mention in the safety checklist
(`safety/lib-safety.js:48`) and the location noise/cell items
(`locations/lib-scout.js:515-516`). Nothing coordinates anything.

**Why a production needs it.** On a multi-cast day this is the difference
between usable dialogue and a page of ADR. It is also pure arithmetic — the
kind of thing a browser does perfectly and a mixer currently does on paper.

**Attach to.** `production/` as a Sound tab, cross-linked from `locations/`
(scan per location). New `production/lib-rf.js` (`CRF`).

**Data model.** `SB_RFPlan_v1 = { v:1, plans:[{ id, locationId, date,
transmitters:[{id, label, kind, freqMhz, device, owner}], excluded:[ranges],
notes }] }`. Core functions: `intermod(freqs, order)` → the conflicting
products, `suggest(count, band, excluded)` → an intermod-free set,
`report(plan)` → the sheet the mixer tapes to the cart.

**Size.** Medium. ~200 lines of logic (genuinely testable: known-good
intermod-free sets are standard), ~150 of UI.

### 6 · Wild track and room tone log — MED
**What it is.** Numbered non-sync recordings: room tone per location (one minute
minimum, per set, per lighting state), wild lines, and wild effects — each with
its own roll/file id, the location it belongs to, and the scenes it serves.

**Where I looked.** `grep -i "wild track|room tone|roomtone"`: **zero hits**
anywhere in the repo. The only trace is the placeholder text
`Notes (wild lines, room tone)` at `production/production.js:203`.

**Why a production needs it.** Missing room tone for a location you have already
struck is unfixable at the mix; the editor has to fake it or the scene sits on a
hole. A one-per-location checklist that the location is not "wrapped" until tone
is recorded is a five-minute rule that saves a mix day.

**Attach to.** `dailies/` (logged where the takes are) with a completeness
readout in `locations/` — "3 of 7 locations have room tone".

**Data model.** `SB_WildTracks_v1 = { v:1, rows:[{ id, day, kind:'tone'|'line'|
'fx', label, roll, locationId, scenes, durSec, notes }] }`, plus
`toneCoverage(rows, locations)` returning the gaps — the same shape as
`CDailies.coverageByScene` (`dailies/lib-dailies.js:126-143`).

**Size.** Small. ~120 lines total; it reuses the Dailies logging UI wholesale.

### 7 · Spotting session with spans and disciplines — MED
**What it is.** The music and sound spotting session: sitting with the picture
and marking where cues start and stop, where sound design carries a scene, which
lines go to ADR, what needs foley. A cue is a **span**, not a point, and each
mark belongs to a discipline.

**Where I looked.** `screening/lib-screen.js` is the closest thing and it is
close — but `addNote(sess, sec, text, author, when)` at `:34-40` stores a single
`sec` with no out-point and no category, and `toMarkers` (`:79-84`) inherits
that. `grep -i "spotting"` finds only the subtitle spotting list at
`distribution/lib-dist.js:25`.

**Why a production needs it.** The spotting session is where the composer, the
supervising sound editor and the director agree on what the film needs; its
output is the cue list that becomes the cue sheet and the ADR list that becomes
the stage day. Right now that meeting has nowhere to land.

**Attach to.** Extend `CScreen` rather than build new: add optional `secOut` and
`kind` (`music` / `sfx` / `foley` / `adr` / `mix`) to the note, defaulting to
today's behaviour so existing `SB_Screening_v1` data keeps working; add
`spotList(sess, kind)`. Then `music/` seeds cues from `kind:'music'` spans
(which also fills the `tcIn`/`tcOut` gap in finding 2) and `post/` seeds the ADR
list from `kind:'adr'`.

**Size.** Small — this is the highest leverage-per-line item in the report,
because three other gaps close partially as a side effect.

### 8 · Stem and M&E manifest — MED
**What it is.** What the mix actually hands over: DME stems with their channel
layouts, the M&E with its foley/effects fill list (every dialogue-adjacent sound
that has to exist without the dialogue), the Lt/Rt fold-down, and file naming.
`distribution/lib-dist.js:22-23` and `post/lib-post.js:29,233-234` are
checkboxes and strings — there is no list of what is inside them.

**Why a production needs it.** M&E is what makes foreign sales possible; a
"delivered" M&E with dialogue bleeding through a practical is rejected and the
territory sale stalls. The fill list is the artefact that prevents it.

**Attach to.** `post/` alongside the audio spec. `SB_Post_v1.stems = [{ id,
name, layout, target, status, notes }]` and `.meFill = [{ scene, item, status }]`.

**Size.** Small.

### 9 · Sound design asset library — MED-LOW
**What it is.** A searchable store of SFX, ambiences, foley and score stems with
tags, source/licence, and which scenes use them.

**Where I looked.** The Editor bin (`editor/cut-ui.js:141-147`) is per-project
and untagged; there is no library anywhere else. Nothing tracks the licence on a
sound effect, though `SB_Clearance_v1` (`production/production.js:315-324`) has
a `Music` type that could cover a licensed SFX pack.

**Attach to.** `editor/`, reusing the existing IndexedDB store `cinamate_cut`
(`editor/cut-ui.js:34,40`) — audio blobs cannot go in `localStorage`, and the
IDB pattern is already proven here. Metadata in `SB_SoundLib_v1`, blobs in IDB.

**Size.** Medium, mostly UI.

### 10 · Composer work-for-hire / score delivery agreement — MED-LOW
**What it is.** The one agreement that clears an entire score: work-for-hire
ownership, package vs creative fee, the delivery list (stems, cue-by-cue,
session files), publishing split, and the composer's PRO registration.

**Where I looked.** `contracts/lib-deal.js` generates crew deal memos and cast
agreements; a composer can be typed in as a crew role routed to account 5000
(`:16`), but there is no score-specific template. `music/lib-music.js:178-180`
explicitly tells the owner an original score is "cleared by one work-for-hire
agreement" — and then cannot produce one, while the same file happily generates
the sync licence request at `:184-207`.

**Attach to.** `contracts/lib-deal.js` as a third document kind, seeded from
`CMusic.scoreComparison()`. **Size:** small — it is a template function beside
two that already exist.

### 11 · Playback and pre-record for on-set music — MED-LOW
**What it is.** A cue that plays on set (a band, a dance number, a car radio the
actors react to) must be licensed **before the shoot day**, not at picture lock,
and the master must be pre-recorded or sourced. The whole of `CMusic` assumes
the opposite: `licenseRequest` says "timing to be confirmed at picture lock"
(`music/lib-music.js:199`) and `cueSheet` prints blank timings for the same
reason (`:222`).

**Why it matters.** Shooting to an unlicensed playback track is how a scene
becomes unusable — you cannot re-cut a performance that was choreographed to a
song you did not get. `scanScript` already detects exactly these moments
(karaoke, band plays, jukebox at `music/lib-music.js:50-58`).

**Attach to.** `music/lib-music.js`: a `playback:true` flag on the cue plus
`neededBy` (the shoot date, readable from `SB_ScheduleBoard_v1`), and a
prominent warning when a playback cue is not `licensed` and its shoot day is
near. **Size:** very small; high value per line.

### 12 · Audio capture anywhere in the platform — LOW (infrastructure note)
`grep "getUserMedia|MediaRecorder"` finds `MediaRecorder` used only for canvas
video capture (`editor/cut-ui.js:776-780`, `boards/boards.js:256-258`,
`tools/tools-media-ui.js:390-392`) and **no `getUserMedia` at all**. That closes
off three cheap wins: scratch ADR recorded in the browser against picture, room
tone captured on a phone at the scout, and an SPL/noise-floor reading at a
location to back the qualitative `noise` checklist item
(`locations/lib-scout.js:515`). Worth knowing before anyone plans those.

---

## Evidence

Files read in full: `music/lib-music.js`, `post/lib-post.js`,
`production/lib-prod.js`, `dailies/lib-dailies.js`, `contracts/lib-deal.js`
(1-70), `screening/lib-screen.js` (1-106), `distribution/lib-dist.js` (1-80).

Files read in part: `production/production.js` (160-330),
`music/index.html` (100-200), `editor/cut-ui.js` (130-190, 400-500, 630-700),
`editor/lib-cut.js` (1-30, 232-250, 380-390), `editor/timeline-engine.js`
(20-50), `tools/tools-registers.js` (118-175), `tools/tools-media-ui.js`
(55-100), `producer/budget-sheet.js` (1-60), `locations/lib-scout.js` (500-560),
`agents/client.js` (30-80), `scripts/run_all_tests.mjs` (1-60),
`post/index.html` (structure), `docs/audit/BRIEF.md`.

**Where I looked before calling anything missing** — repo-wide greps over
`*.js` and `*.html`, excluding `node_modules`, `private`, `local-backend`,
`static`:

| searched for | result |
|---|---|
| `wild track`, `room tone`, `roomtone` | 0 hits (only the placeholder at `production/production.js:203`) |
| `ADR` | 2 hits, both agent names — `agents/client.js:33,61` |
| `foley` | 1 hit, a deliverable label — `distribution/lib-dist.js:22` |
| `LUFS`, `LKFS`, `loudness`, `dBTP`, `true peak` | 0 hits |
| `MHz`, `wireless`, `frequency`, `spectrum`, `intermod`, `Comtek` | 0 relevant hits (`tools/tools-media-ui.js:69` is a slate beep oscillator) |
| `ASCAP`, `BMI`, `SESAC`, `SOCAN`, `PRS`, `IPI`, `ISWC`, `ISRC` | 0 hits |
| `spotting` | 1 hit, subtitle spotting — `distribution/lib-dist.js:25` |
| `stem`/`stems`, `printmaster`, `M&E` | labels only — `post/lib-post.js:29,233-234`, `production/lib-prod.js:151-153`, `distribution/lib-dist.js:20-23` |
| `Atmos`, `7.1`, `dub stage`, `mix stage`, `dialogue list`, `as-broadcast` | 0 hits |
| `getUserMedia` | 0 hits |
| `sound designer`, `supervising sound`, `music supervisor`, `music editor` | agent names only — `agents/client.js:67,78` |
| all `SB_*` keys enumerated repo-wide | no sound- or music-specific key beyond `SB_Music_v1`, `SB_CueSheet_v1`, `SB_SoundReports_v1` |

Storage keys confirmed in use: `SB_Music_v1` (`music/index.html:114`),
`SB_Post_v1` (`post/index.html:116`), `SB_CueSheet_v1`
(`production/production.js:272`), `SB_SoundReports_v1` (`:195`),
`SB_CameraReports_v1` (`:182`), `SB_Rights_v1` (`tools/tools-registers.js:129`),
`SB_Cut_v1` (`editor/cut-ui.js:15`), `SB_Screening_v1`, `SB_Dailies_v1`.
Every key proposed above is new; nothing existing is renamed.

No file was edited. Test suites are auto-discovered from `scripts/test_*.mjs`
(`scripts/run_all_tests.mjs:43-58`), so each build sketch above assumes one new
suite file and no runner change.
