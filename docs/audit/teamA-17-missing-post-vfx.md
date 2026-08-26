# Team A Dev 17 — what is missing entirely in post, editorial and VFX

Scope: `editor/`, `post/`, `vfx/`, `screening/`, `production/lib-prod.js` (QC),
plus the two places post work actually lands — `distribution/` and
`tools/` (media + captions).

**Method.** Every "missing" claim below was grepped for first, across the whole
repo excluding `node_modules/`, `.git/`, `private/`, `docs/`, `static/` and the
stray `Shotbreak-main (1).zip`. Where a search hit, I read the hit and say what
it actually is. Searches run: `FCPXML`, `AAF`, `xmeml`, `OTIO`, `EDL`,
`proxy`, `relink`, `reconnect`, `offline media`, `checksum`, `md5`, `xxhash`,
`MHL`, `LTO`, `ingest`, `camera card`, `card offload`, `LUFS`, `LKFS`,
`loudness`, `R128`, `A/85`, `true peak`, `Harding`, `photosensitive`, `SCC`,
`IMSC`, `textless`, `2-pop`, `head slate`, `colour bars`, `changelist`,
`change list`, `pull list`, `count sheet`, `handles`, `conform`, `turnover`,
`reel`, `act break`, `ADR`, `spotting`, `foley`, `walla`, `looping`,
`dialogue continuity`, `as-broadcast`, `combined continuity`, `CCSL`, `SRT`,
`VTT`, `temp`, `23.976`, `29.97`, `drop frame`.

**Deliberate non-duplication.** `crew-16-vfx.md` and `crew-17-editorial-post.md`
already exist in this folder and already cover, well: AAF/FCPXML export,
interchange *import*, reel names + source timecode + relink, the conform/turnover
checklist, a QC report against a spec, per-platform deliverable specs, the
version→screening→note chain, change lists, VFX pulls with handles, loudness on
export, the two VFX registries, the vendor turnover package, plate naming,
on-set VFX data capture, and cost-per-shot. `crew-18` covers ADR, spotting,
foley, M&E and stems. `crew-19` covers SCC/IMSC/CEA-608. **I do not re-file any
of those.** Where one of my findings touches theirs I say so in one line and
move on. Everything in my "missing entirely" section is ground none of them
covered, and I verified that by grepping their reports too.

---

## What exists and works

- `post/lib-post.js:19-34` — a 14-milestone post template with real `after`
  dependencies (`qc` correctly waits on all three of `grade`, `mix`,
  `vfx-final`). This is the right graph, not a decorative list.
- `post/lib-post.js:118-174` — `schedule()` does a Kahn topological sort, a
  forward pass, then for backward solving exploits translation-invariance of
  business-day arithmetic (`:142`) to land the terminal milestone exactly on the
  target date in one shift rather than iterating. Weekend-skipping is pure —
  no `Date.now()` anywhere in the file. Returns `{error:'cycle'}` rather than
  looping. This is genuinely good code.
- `post/lib-post.js:216-223` — `awardBid` returns `needsCommit: !bid.committedPo`
  rather than committing itself, so the Money Room PO cannot be double-posted by
  a double-click. The right separation.
- `vfx/lib-vfx.js:144-163` — `plateChecklist` scales by complexity and the
  contents are correct on-set practice (clean plate and tracking markers at
  medium, HDRI + chrome/grey at complex, re-shot HDRI + witness cam + set survey
  at hero). `daySheet` (`:182-210`) prints it per scene at the *highest*
  complexity in that scene, which is the right rule.
- `vfx/lib-vfx.js:112-120` — `bidVsEst` returns `below`/`within`/`above` against
  a band and every estimate carries `label: 'planning estimate'` (`:27`). The
  platform never pretends a range is a quote.
- `editor/lib-cut.js:142-157` — the EDL follows the CMX event-line convention and
  writes `* FROM CLIP NAME` and a `* SPEED:` comment. `otio()` (`:163-230`)
  emits real `Timeline.1`/`Track.1`/`Clip.2` with `LinearTimeWarp.1` for speed
  and a leading `Gap.1` to position audio. Resolve and Premiere read this.
- `editor/lib-cut.js:271-330` — `silences()`, `tighten()` and `beats()` are
  honest deterministic DSP with sane defaults (a 0.12s breath left on a tighten,
  a trailing-average beat detector with a minimum gap). Not "AI" theatre.
- `screening/lib-screen.js` — the whole design decision is right: no video
  hosting, everyone plays the same exported file locally, only the notes travel.
  `toMarkers` (`:79-84`) filters to open notes and `screening/index.html:159-162`
  writes them into `SB_Cut_v1` as `project.markers`, which the editor ruler
  renders (`editor/cut-ui.js:206-207`). That loop closes.
- `tools/lib-media.js:88-127` — a correct SHA-256 offload manifest with
  `verifyAgainst` returning `ok/changed/missing/extra` and a `clean` flag. The
  XML escaper (`:131-132`) does all five entities and unescapes `&amp;` last so
  paths round-trip. The hash function is injected, so it is node-testable.
- `tools/lib-script.js:70-113` — SRT and WebVTT parse *and* write, plus
  `captionQc` for reading speed, line length and overlaps. Captions are not
  missing; only the broadcast formats are (crew-19's finding, not mine).
- `dailies/lib-dailies.js:45-78` — bijective base-26 slate letters, so 12Z rolls
  to 12AA correctly. `editorPicks`/`picksText` (`:203-222`) produce a real pull
  list of circled takes, with the honest footer that circles do not bind the cut.
- `distribution/lib-dist.js:15-50` — the deliverables list and the five buyer
  presets are accurate to what buyers actually issue.

---

## What exists but needs work

Four only. Everything else I found in this area is already filed by crew-16/17/19
and I am not padding the list.

- **HIGH — `post/lib-post.js:238-252` reports a *planned* date as "ready".**
  `distReadiness` sets `ready: r.end || null`, where `r.end` comes straight out
  of the template schedule. `post/index.html:104` then tells the user "As each
  milestone completes, the matching deliverable becomes ready to tick in
  /distribution/". Nothing completes. There is no completion state anywhere in
  the store (see the next section). So the Delivery Readiness panel is a
  restatement of the plan wearing the word "ready", and a post supervisor
  reading it will tell a distributor a date that is a template guess with no
  evidence behind it. *Change:* until actuals exist, rename the column to
  "planned ready" in `distReadiness`'s output key and in the panel; once actuals
  exist, `ready` should be `actualEnd || null` and the planned date a separate
  `planned` field.

- **MED — three unlinked review-note stores, and a note cannot reach a VFX
  shot.** `SB_Screening_v1` (`screening/index.html:84`), `SB_ReviewNotes_v1`
  (`tools/tools-media-ui.js:198`), and `project.markers` inside `SB_Cut_v1`
  (`screening/index.html:161`). A note has `{sec, text, author, at, status}`
  (`screening/lib-screen.js:34-40`) and nothing else — no department, no target.
  So "VFX-020 comp edge at 00:41:12" is free text that the VFX board
  (`SB_VfxBoard_v1`, `vfx/index.html:110`) never sees, and a supervisor has to
  retype every picture note into the shot row by hand. *Change:* add optional
  `dept` (`picture|sound|vfx|music|titles`) and `target` (a free-form id such as
  `VFX-020`) to `addNote`; add a `notesFor(sess, target)` selector; render open
  notes matching a shot code in the VFX board row. ~40 lines in
  `lib-screen.js`, no key rename.

- **MED — two VFX shot registries, neither aware of the other.** `SB_VfxBoard_v1`
  (`vfx/index.html:110`, statuses `briefed…approved`, `vfx/lib-vfx.js:13`) and
  `SB_VfxShots_v1` (`production/production.js:243-261`, statuses
  `Brief/In progress/Review/Retake/Final`, and a shot id randomised as
  `'VFX' + (101..990)` at `:260`). Two shot numbering schemes, two status
  vocabularies. Already filed as crew-16's first HIGH with the same remedy
  (redirect the Production Office tab at `/vfx/`); recorded here only so the
  count of registries is on the record from a second reader. Note the extra
  detail crew-16 does not state: the Production Office row carries a `due` date
  and `expiryField: 'due'`, which is the *only* date on any VFX shot in the
  platform — `vfx/lib-vfx.js:97-109` `makeShot` has none. Whichever registry
  survives must keep that `due` field.

- **LOW but a live trap — the cloud sync silently drops any `SB_*` key with an
  underscore in the middle.** `netlify/functions/projects-sync.js:227` tests
  `/^SB_[A-Za-z0-9]+_v\d+$/` and `delete`s anything that fails. `SB_PostActuals_v1`
  syncs; `SB_Post_Actuals_v1` is dropped without a message, so the owner's data
  would live on one machine only and nobody would know until a device swap.
  Every new key proposed below is single-token on purpose. *Change:* nothing to
  fix in the function — but this constraint belongs in `BRIEF.md` next to the
  "never rename an `SB_*` key" rule.

---

## What is missing entirely

### 1. Milestone actuals — the post supervisor's actual job. VALUE: HIGHEST

**What it is.** A status and a real date on every post milestone: not started /
in progress / complete, with `actualStart` and `actualEnd`, and the slip
(planned end vs actual end, in business days) computed against the plan.

**Where I looked.** `post/index.html:123` is the whole store:

```js
var st = readLS(KEY) || { anchor: '', direction: 'backward', dayOverrides: {},
                          project: '', versions: [], bids: [] };
```

`milestones()` (`post/index.html:129-135`) applies only `dayOverrides[m.id]`, a
duration. `CPost.schedule` (`post/lib-post.js:118-174`) returns
`{id,name,start,end,days,blockedBy,critical}` — every field derived, nothing
observed. Greps for `actual`, `status`, `done`, `complete` across
`post/index.html` return exactly one hit: the marketing sentence at `:104`.

**Why a production needs it.** Post supervision *is* variance tracking. The
whole value of the critical path at `post/lib-post.js:151-162` is that you can
see a day lost on it is a day lost on delivery — but you cannot lose a day here,
because nothing records that a day was lost. Today the picture-lock date on
screen is identical on the day you start assembly and three weeks after
picture-lock was missed. A completion bond, a distributor's delivery date, an
investor update and the `workflow/advisor.js` gating all want the same fact —
"are we behind, and by how much" — and no module on the platform can answer it.
This is also the cheapest big win in my whole domain: the graph, the business-day
math and the critical path are already built and already correct. Only the
observation layer is absent.

**Attach to.** `post/` section 1, in place.

**Data model.** New key `SB_PostActuals_v1`:

```
{ v: 1, rows: { <milestoneId>: { status: 'todo'|'wip'|'done',
                                 actualStart: 'YYYY-MM-DD',
                                 actualEnd:   'YYYY-MM-DD',
                                 note: '' } } }
```

Keep it out of `SB_Post_v1` so no live owner's existing store shape changes.

**Build.** In `lib-post.js`, one new pure function beside `schedule()`:

```
variance(scheduleRows, actuals) ->
  { rows: [{ id, planStart, planEnd, actualStart, actualEnd, status,
             slipDays, critical, forecastEnd }],
    slip, forecastDelivery, atRisk: [ids] }
```

`slipDays` is `CPost.busDiff(planEnd, actualEnd)` — `busDiff` already exists at
`:71-77`. `forecastEnd` re-runs `runForward` from the last `done` milestone's
`actualEnd` instead of the anchor, which is a three-line change to `runForward`
(accept a per-id start override map). `forecastDelivery` is the terminal row's
forecast end; that number is the one the whole platform actually wants.
`distReadiness` then reads `actualEnd` and the readiness panel stops lying.

**Size.** ~90 lines in `lib-post.js`, ~70 lines of UI in `post/index.html` (a
status select and two date inputs per row, plus a slip column), ~60 lines added
to `scripts/test_post.mjs`. Half a day. `scripts/run_all_tests.mjs:45-51`
auto-discovers new suites, so nothing needs registering.

---

### 2. A media chain of custody that survives the browser tab. VALUE: HIGH

**What it is.** A persistent register of every camera card offloaded and
verified, bound to the production, to the sources the cut references, and to the
archive deliverable.

**Where I looked.** The hashing *engine* exists and is good —
`tools/lib-media.js:88-127`. The *UI* is `tools/tools-media-ui.js:84-142`, and
it is entirely ephemeral: `lastEntries` and `loadedManifest` are local `var`s at
`:92`, the XML is pushed straight to an `<a download>` at `:114-117`, and there
is no `C.save(...)` / `localStorage` write anywhere in that function. Verified
by reading the whole tab. So a DIT can prove a copy is bit-perfect and then
close the tab, and the production retains no record that the card was ever
offloaded, how many files it held, or whether it verified.

Downstream, `editor/cut-ui.js:61` stores bin items as
`{id,name,kind,url,dur,w,h,origin,idb,missing,thumb}` — no hash, no size, no
path. When the IndexedDB blob is gone, `:807-812` sets `missing = true` and
`:183` refuses with "That source needs re-importing first". There is no relink
(crew-17 filed relink; the *hash-verified* relink below is the part they did
not). And `distribution/lib-dist.js:38` bills the owner for an "Archive master
(LTO / verified backup)" deliverable that nothing in the platform can evidence.

**Why a production needs it.** The single most expensive irreversible failure in
this whole domain is losing original camera negative, and the second is
discovering at conform that the file you are relinking is not the file you shot.
An E&O insurer and a completion bond both ask for the offload log. A post house
receiving the drive asks for the manifest. Right now the answer is "check the
DIT's laptop for a downloaded XML".

**Attach to.** `tools/` Offload tab writes it; `editor/` bin reads it; `post/`
and `distribution/` report against it.

**Data model.** New key `SB_MediaLog_v1`:

```
{ v: 1, cards: [ { id, label: 'A001', shootDay: 'YYYY-MM-DD', unit: 'main',
                   fileCount, bytes, createdAt,
                   files: [ { path, size, sha256 } ],
                   verifiedAt: '', verifyResult: 'clean'|'mismatch'|'',
                   destinations: [ 'RAID-1', 'LTO-3', 'offsite' ] } ] }
```

`files` is the same shape `manifestXml`/`parseManifest` already speak, so the
existing engine needs no change at all.

**Build.**
1. Persist. In `tools-media-ui.js`, after hashing, write a card row instead of
   only downloading. ~40 lines. A card of 400 files at ~120 bytes a row is
   ~48 KB of `localStorage` — fine; cap `files` at, say, 2000 per card and note
   the cap in the UI.
2. `lib-media.js` gains two pure functions: `cardSummary(card)` and
   `matchByHash(sha256, cards) -> {card, file} | null`. ~30 lines.
3. Editor relink-by-hash. When a bin item is `missing`, offer "re-pick this
   file"; hash the picked file with the same `crypto.subtle.digest` call already
   at `tools-media-ui.js:99`, and if it matches the recorded `sha256`, relink
   silently and say so. If it does not match, refuse and name the mismatch. That
   turns crew-17's relink from "trust the filename" into "prove it is the same
   frames", which is the whole point. ~60 lines in `cut-ui.js` plus a `sha256`
   field on the bin item (additive — `loadSaved` at `:798-818` tolerates
   unknown fields already).
4. Archive evidence. `distribution` reads `SB_MediaLog_v1` and refuses to let
   `lto` be ticked until every card has `verifyResult === 'clean'` and at least
   two `destinations`. ~20 lines.

**Size.** ~150 lines total plus `scripts/test_medialog.mjs`. One day.

---

### 3. A proxy / offline-online workflow. VALUE: HIGH

**What it is.** Cut against small proxies, conform against the originals; a
recorded link between the two so the EDL and OTIO name the *original* file, not
the proxy the browser played.

**Where I looked.** `proxy` appears 20+ times in `app.html` and every one is
`sbVideoProxy()` — the localhost AI-video generation bridge at `app.html:1495`,
unrelated. `grep -riw proxy` over `editor/`, `post/`, `vfx/`, `tools/`,
`dailies/` returns nothing. `relink`, `reconnect` and `offline media` return
nothing anywhere. There is no proxy concept on this platform.

**Why a production needs it.** This is the reason the editor cannot currently
touch real footage. Camera originals are 100 MB–2 GB a clip; the bin persists
whole `File` blobs in IndexedDB (`editor/cut-ui.js:40-47, 146`) and the exporter
holds the entire MP4 in memory (`:767` reads `mp4.length` off a single buffer).
An hour of ProRes will not survive either. Every real editorial workflow solves
this the same way — cut proxies, conform originals — and the platform already
has the two halves it needs: a browser-side transcoder (`static/ffmpeg/`) and an
OTIO writer that takes a `srcMap` argument for exactly this purpose
(`editor/lib-cut.js:163`, `otio(p, srcMap)`, `:178` reads `srcMap[c.srcId].url`).
`srcMap` is currently fed from the bin (`cut-ui.js:920-922`); feeding it original
paths instead is the entire conform story.

**Attach to.** `editor/` bin, with the original-file record living in
`SB_MediaLog_v1` from finding 2.

**Data model.** Extend the bin item with `origPath`, `origSha256`, `proxy: true`
— additive, no key rename. `otio()` and `edl()` then prefer `origPath` when it
is present.

**Build.** Three parts, and only the first is real work: (a) a "make proxy"
action that runs the bundled ffmpeg to 960×540 H.264 and stores *that* in
IndexedDB while keeping the original's path and hash — ~120 lines; (b) `otio()`
and `edl()` prefer the original path — ~10 lines and a test; (c) a bin badge
showing which items are proxies. Do this after finding 2, since it depends on
the hash record.

**Size.** ~150 lines. One to two days, mostly ffmpeg-in-browser plumbing.

---

### 4. A rights gate on anything that leaves the building. VALUE: HIGH

**What it is.** A check, at the moment a screener is logged or a cut is
exported, that every music cue in it is licensed or replaced and every clearance
finding is resolved — and a refusal, or at minimum a named warning, when it is
not.

**Where I looked.** The rights data exists and is good: `music/lib-music.js:17`
tracks cue status through `identified → quote requested → quoted → licensed`
with `replaced` as the other terminal, `cueSheet` at `:218` correctly excludes
replaced cues, and `clearance/lib-clear.js:66-109` scans and summarises with a
`pending` count. Now the gap:

```
grep -rn "CMusic|SB_Music_v1|CClear|SB_Clearance_v1" --include=*.js --include=*.html
  (excluding music/, clearance/, scripts/)
  → production/production.js:312   (a generic Register on SB_Clearance_v1)
  → workflow/advisor-ui.js:54      (reads clearance into the advisor)
```

`SB_Music_v1` is read by **nothing outside `music/`**. `distribution/lib-dist.js:97-103`
`addScreener` records `{recipient, company, link, sentAt, expires, watched, notes}` —
who got it, never what was in it. `screening/lib-screen.js:17-23` `newSession`
records `{id, title, createdBy, createdAt, fps, notes}` — no cut identity at all.
And `workflow/advisor.js` has exactly two post-side rules in the whole file
(`:174` and `:178-180`); neither mentions rights.

**Why a production needs it.** Sending a screener with an unlicensed needle-drop
in it, or premiering at a festival with unresolved trademark exposure, is the
kind of mistake that ends a distribution deal. The platform holds every fact
needed to prevent it and never joins them up. This is a *join*, not a new
capability, which is why the value/effort ratio is so good.

**Attach to.** `distribution/` (screener log) and `editor/` (export), reading
`SB_Music_v1` and `SB_Clearance_v1`.

**Data model.** No new key. Add to `lib-dist.js`:

```
rightsGate(music, clearance) ->
  { clear: bool,
    blockers: [ {kind:'music'|'clearance', label, status} ],
    warnings: [ ... ] }
```

Pure, node-testable, takes the two stores as arguments — it must not read
`localStorage` itself, per the `lib-*` convention.

**Build.** ~50 lines in `lib-dist.js`, ~30 lines wiring it into the screener
form and the editor's export button (warn, name the specific cues, require a
typed confirm — never silently block), ~40 lines of tests. Half a day.

---

### 5. An annotated frame on a note. VALUE: MED-HIGH, and it is nearly free

**What it is.** The marked-up still — a circle round the offending comp edge, an
arrow at the boom in shot. It is how a director actually gives a VFX or grade
note, and it is the one note format that removes ambiguity.

**Where I looked.** The drawing surface already exists and works. The Dailies
Review tab (`tools/tools-media-ui.js:145-215`) stacks a `<canvas>` over a
`<video>`, handles mouse *and* touch, and strokes in the house gold
(`:186-192`). Then `rvNote` at `:211-215` saves:

```js
notes.add({ clip: f ? f.name : '—', tc: tcNow(), note: '', status: 'Open' });
```

The canvas is not read. `rvClear` at `:169` wipes it. Meanwhile
`toDataURL` is called three times elsewhere *in the same file* — `:314`, `:470`,
`:508` — so the capability is sitting in the same module, unwired. The drawing
is discarded on every note, every clear, every reload.

**Why a production needs it.** "Fix the edge at 41:12" is three emails.
A frame with a circle on it is zero.

**Attach to.** `tools/` Dailies Review now; `screening/` next, where the notes
that matter live.

**Data model.** Add `frame` (a JPEG data URL) to the review-note row. Composite
the video frame and the overlay canvas into one offscreen canvas at capture
time, then `toDataURL('image/jpeg', 0.7)`. At 640px wide that is ~40 KB a note —
so cap stored frames (say 40 per session, oldest evicted, with a visible count),
because `localStorage` is a ~5 MB budget shared with every other `SB_*` store.
State the cap in the UI rather than silently dropping.

**Build.** ~25 lines to composite and store, ~20 to render a thumbnail in the
notes list with a click-to-enlarge, ~15 for the cap and its message. Then the
same three functions move into `screening/` and `CScreen.addNote` gains an
optional `frame`. Two to three hours for the first half.

---

### 6. A temp-element register for a screening cut. VALUE: MED

**What it is.** A list of what in this cut is temporary and must be replaced
before final: temp music, temp mix, temp VFX, stock footage, unlicensed
needle-drops, placeholder titles.

**Where I looked.** `temp` as a concept exists in exactly one place —
`vfx/lib-vfx.js:13`, as one of seven shot statuses. Greps for `temp track`,
`temp mix`, `needle drop` return nothing. `music/lib-music.js` has `replaced` as
a cue status (`:17`), which is the closest thing on the platform, but it is
per-cue and never joined to a cut or a screening (see finding 4).

**Why a production needs it.** Two separate failures. Legal: a temp element in a
cut that goes to a festival or a buyer is unlicensed use, which finding 4's gate
addresses at the door but cannot describe. Editorial: "temp love" is real — the
director gets attached to the temp score, and the only defence is a written list
of what is temp, visible from the first screening. The list also *is* the
turnover brief for the composer and the mixer.

**Attach to.** `screening/`, bound to the session; surfaced in `post/` next to
the versions log.

**Data model.** New key `SB_TempElements_v1`:

```
{ v: 1, rows: [ { id, kind: 'music'|'mix'|'vfx'|'stock'|'title'|'sfx',
                  label, sec, cueId, shotCode,
                  status: 'temp'|'final'|'cleared', note } ] }
```

`sec` reuses the same seconds-from-zero convention as `CScreen` notes so it
renders on the same ruler. `cueId`/`shotCode` are optional joins back to
`SB_Music_v1` and `SB_VfxBoard_v1`.

**Build.** ~60 lines of pure logic (`add`, `byKind`, `outstanding(rows)`, and a
text export that is the composer/mixer brief), ~60 lines of UI in
`screening/index.html`, a test suite. Feed `outstanding()` into `rightsGate`
from finding 4 so temp elements become named blockers. Half a day.

---

### 7. Dialogue continuity / combined continuity script. VALUE: MED

**What it is.** The as-delivered transcript: every line of dialogue in the
finished picture, in cut order, with timecode, speaker, and shot/action
descriptions. It is a contracted deliverable, and it is the source document for
dubbing, subtitling and censorship review in every territory.

**Where I looked.** `production/lib-prod.js:156` lists
`['Subtitling', 'Dialogue continuity script']` in `DELIVERY_TEMPLATE` — a
string in a checklist. Greps for `as-broadcast`, `combined continuity` and
`CCSL` return nothing anywhere in the repo. Nothing produces one.
`crew-17` and `crew-18` both return zero for `continuity script`.

**Why a production needs it.** It is on the checklist because buyers demand it,
and today the owner has to type it by hand from the finished film. The platform
already holds both halves: the screenplay (`writer/`, and every module's
`splitScenes` — `vfx/lib-vfx.js:54`, `dailies/lib-dailies.js:15`,
`production/lib-prod.js:110`) and the cut with timecodes
(`editor/lib-cut.js:131-157`). Joining them is a text-processing job, not a new
discipline. It also feeds captions: `tools/lib-script.js:88-97` already writes
SRT and VTT from `[{start,end,text}]`, so a continuity script generator hands
the caption tool its input for free — which is the bridge from screenplay to
captions that is currently missing.

**Attach to.** `production/` as a new tab beside Cue Sheet (which is the same
shape of job — `production/lib-prod.js:70-85`), reading `SB_Writer_v1` and
`SB_Cut_v1`.

**Data model.** No new key needed for a first pass — generate on demand from the
two existing stores. If the owner edits the result, store it as
`SB_Continuity_v1`… **except** `SB_Continuity_v1` is already taken by the
script-supervisor continuity notes (it appears in the key inventory). Use
`SB_DialogueCont_v1`.

```
{ v: 1, rows: [ { n, tcIn, tcOut, speaker, text, action } ] }
```

**Build.** A pure `continuity(scriptText, cutProject)` in `lib-prod.js` that
walks the cut's clips in order, maps each clip's `label`/`scene` back to a
screenplay scene, and emits dialogue blocks with the clip's record timecode.
It will be approximate — the cut's clips do not carry scene numbers today
(`editor/lib-cut.js:16` has no `scene` on a video clip, though `assemble()` at
`:262` reads one from its `sources` argument), so the honest first version asks
the owner to confirm the scene per clip. ~110 lines plus a CSV/text export
through the existing `csvCell` at `production/lib-prod.js:91-95`. One day.

---

### 8. A per-version submission log on the vendor side. VALUE: MED

**What it is.** Not the turnover *out* (crew-16 filed that, correctly, as their
highest). This is the return leg: every version a vendor actually delivered —
what arrived, when, in what format, who reviewed it, and the verdict.

**Where I looked.** `vfx/lib-vfx.js:106` stores `version` as a single string
`'v001'` and `bumpVersion` (`:176-179`) overwrites it. crew-16 filed the
history-destruction bug. What neither crew-16 nor crew-17 filed is that even
with a version *array*, there is nowhere to record the delivery event: no
received date, no file format, no reviewer, no verdict. `post/lib-post.js:197-204`
`addVersion` is the cut-version log and stores `{id, stage, n, date, notes}` —
which is the closest analogue in the platform and shows the shape works.

**Why a production needs it.** "How many revisions has this vendor had on
VFX-020" is the question that decides whether an overage is the vendor's problem
or yours, and it is a contractual question. Also: if a vendor delivered v004 on
the 12th and the cut still has v002 in it, that is a real and common
conform failure that nothing here can detect.

**Attach to.** `vfx/`, as an array on the shot.

**Data model.** On the shot: `submissions: [ { v, receivedAt, format, from,
verdict: 'approved'|'retake'|'pending', note } ]`. Additive to
`SB_VfxBoard_v1`; existing rows without it read as `[]`.

**Build.** ~50 lines in `lib-vfx.js` (`addSubmission`, `latest(shot)`,
`retakeCount(shot)`, and a `retakeCount > 2` flag in `board()`), ~50 of UI.
Do it in the same pass as crew-16's version-array fix — it is the same edit to
the same object and doing them separately means touching `bumpVersion` twice.
Half a day on top of that fix.

---

## Evidence

Files read in full: `post/lib-post.js` (264), `vfx/lib-vfx.js` (220),
`editor/lib-cut.js` (389), `screening/lib-screen.js` (107),
`production/lib-prod.js` (182), `dailies/lib-dailies.js` (233),
`tools/lib-media.js` (137), `distribution/lib-dist.js` (117),
`post/index.html` (§1–4 and the store/render script, lines 1–180),
`tools/tools-media-ui.js:80-220`, `editor/cut-ui.js:60-160` and `:793-838`.
Files read in part with line numbers cited: `production/production.js`,
`music/lib-music.js`, `clearance/lib-clear.js`, `tools/lib-script.js`,
`workflow/advisor.js`, `editor/index.html`, `screening/index.html`,
`vfx/index.html`, `distribution/index.html`,
`netlify/functions/projects-sync.js`, `scripts/run_all_tests.mjs`.

Specific claims:

- `post/index.html:123` — the complete `SB_Post_v1` shape; no status/actual field.
- `post/index.html:129-135` — `milestones()` applies only `dayOverrides`.
- `post/index.html:104` — "As each milestone completes…", with nothing that completes.
- `post/lib-post.js:19-34` — 14 milestones, `qc.after = ['grade','mix','vfx-final']`.
- `post/lib-post.js:71-77` — `busDiff`, the signed business-day delta a slip calc needs.
- `post/lib-post.js:118-174` — `schedule()`; `:142` the one-shift backward solve.
- `post/lib-post.js:216-223` — `awardBid` returns `needsCommit`, does not commit.
- `post/lib-post.js:238-252` — `distReadiness`; `:243` `ready: r.end || null`.
- `vfx/lib-vfx.js:13` — the only occurrence of `temp` as a concept in the repo.
- `vfx/lib-vfx.js:97-109` — `makeShot`; no dates, no submissions.
- `vfx/lib-vfx.js:144-163`, `:182-210` — plate checklist and day sheet.
- `editor/lib-cut.js:16` — `fps: 24` in `blank()`.
- `editor/lib-cut.js:142-157` — EDL; `:144` hard-codes `FCM: NON-DROP FRAME`.
- `editor/lib-cut.js:163`, `:178` — `otio(p, srcMap)` and its `srcMap[c.srcId].url` lookup.
- `editor/cut-ui.js:61` — the bin item shape: no hash, no size, no original path.
- `editor/cut-ui.js:183`, `:807-812` — the `missing` dead end, no relink.
- `editor/cut-ui.js:702`, `editor/index.html:97` — `edFps` (24/30 only) read only
  inside `exportMp4`; `project.fps` is never assigned anywhere in the repo
  (grep `project.fps\s*=` → 0 hits). Already filed by crew-17 at their `:129`.
- `screening/lib-screen.js:17-23` — `newSession`; `fps: 24` hard-set, no cut identity.
- `screening/lib-screen.js:34-40` — the note shape; no dept, no target.
- `screening/index.html:159-162` — notes → `SB_Cut_v1.project.markers`.
- `tools/lib-media.js:88-127` — the manifest engine; `:113-127` `verifyAgainst`.
- `tools/tools-media-ui.js:92` — `lastEntries`/`loadedManifest` are locals.
- `tools/tools-media-ui.js:114-117` — the manifest is downloaded, never stored.
- `tools/tools-media-ui.js:186-192`, `:211-215` — the canvas draws; `rvNote` drops it.
- `tools/tools-media-ui.js:314`, `:470`, `:508` — `toDataURL` in the same file.
- `tools/lib-script.js:119` — exports `toSrt`/`toVtt`; no SCC (crew-19's finding).
- `production/lib-prod.js:154-156` — SCC/IMSC, SRT/VTT and the dialogue
  continuity script, as checklist strings only.
- `production/production.js:243-261` — `SB_VfxShots_v1`, the second VFX registry,
  with the only `due` date on any VFX shot (`:252`, `expiryField: 'due'` at `:245`).
- `production/production.js:335-346` — `SB_Delivery_v1`; status is a five-option
  select, no spec behind it.
- `distribution/lib-dist.js:38` — the `lto` archive-master deliverable.
- `distribution/lib-dist.js:97-103` — `addScreener`; records the recipient, never
  the content.
- `music/lib-music.js:17`, `:218` — cue statuses including `replaced`; `cueSheet`
  excludes replaced cues.
- `clearance/lib-clear.js:66-109` — the scan and its `pending` count.
- `workflow/advisor.js:174`, `:178-180` — the only two post-side advisor rules.
- `netlify/functions/projects-sync.js:227` — `/^SB_[A-Za-z0-9]+_v\d+$/`, and the
  `delete` of anything that fails it.
- `scripts/run_all_tests.mjs:45-51` — new `scripts/test_*.mjs` auto-discovered.

Negative searches (zero hits outside `node_modules/`, `static/`, the `.zip` and
the audit docs themselves): `FCPXML`, `AAF` as a format, `xmeml`, `relink`,
`reconnect`, `offline media`, `xxhash`, `camera card`, `card offload`, `LUFS`,
`LKFS`, `loudness`, `R128`, `A/85`, `true peak`, `Harding`, `photosensitive`,
`2-pop`, `head slate`, `colour bars`, `changelist`, `change list`,
`count sheet`, `reel` as an editorial reel, `act break`, `ADR`, `spotting` (one
hit: a deliverable label at `distribution/lib-dist.js:25`), `foley` (one hit:
the M&E label at `:22`), `walla`, `as-broadcast`, `combined continuity`, `CCSL`,
`23.976`, `29.97`, `drop frame`. `proxy` outside `app.html`'s AI-video bridge:
zero.

No file in the repo was modified.
