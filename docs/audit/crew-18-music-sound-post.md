# Composer & Music Supervisor, with Sound Post

Read as the people who spot, score, clear, cut, mix and deliver the audio.

**The short answer to the two questions asked.** *Can a music supervisor clear a
needle drop here?* Halfway. The platform gets the hardest conceptual thing right
— sync and master are modelled as two separate sides with library music as the
one all-in exception — and the request letter asks for both, asks for MFN, asks
for credit language and asks for a step-up option on a festival deal. That is
better than most paid tools. But a cue carries **one** publisher string and
**one** master-owner string, no shares, no territory, no term, no expiry date
and no reference to the executed licence. You can mark a cue "licensed" with
40% of the publishing uncleared and the platform will congratulate you.

*Could you deliver a cue sheet a PRO would accept?* No. There are two cue
sheets and neither is submittable. `music/` has the rights but stamps
`__:__ – __:__` where the timings go. `production/#cues` has real timecode off
the cut but ships empty Composer/Publisher/Society columns, no header block, and
no writer/publisher share percentages — which is the part a PRO actually pays
from. Joining the two is the single highest-value fix in this audit and it is
maybe a day of work, because both halves already exist.

---

## What exists and works

- `music/lib-music.js:125-147` — `perSide()` + `estimate()` price **sync and
  master as two separate sides**, with `tier.allIn` correctly making library /
  production music the one exception that covers both in a single fee
  (`:22-28`). This is the distinction indie productions get wrong most often
  and the platform gets it right in the data model, not just the copy.
- `music/lib-music.js:184-207` — `licenseRequest()` asks for a quote **per
  side**, asks for most-favored-nations terms and the exact required credit
  language, and on `scope: 'festival'` explicitly requests a step-up option to
  all media in perpetuity (`:188-190`). That is the correct instinct and it is
  the thing that saves a picture two years later.
- `music/lib-music.js:138-145` — the festival factor (15% of all-media) is
  applied to each side and the returned note *tells you to negotiate the
  step-up now, before you need it*. Honest and useful.
- `music/lib-music.js:65-83` — `scanScript()` gives a real first-pass cue list
  off the screenplay and, crucially, splits performance words (sings, karaoke,
  band plays → `featured`) from source/ambient words (jukebox, radio, hums →
  `background`) at `:49-59`, lifting a quoted title into the cue name.
- `music/lib-music.js:151-168` — `cueCost()`/`totals()`: a real quote overrides
  the estimate, a `replaced` cue costs zero and is excluded from the count.
  Exactly the working-number logic a supervisor keeps in their head.
- `music/lib-music.js:169-181` — `scoreComparison()` at $100–400 per finished
  minute, with the note correctly observing that an original score is cleared by
  **one** work-for-hire agreement instead of per-song licences.
- `music/index.html:127-139` — `maybeCommit()` posts a licensed cue's actual
  quote to the Money Room once, guarded by `committedPo`. No double-commit.
- `production/lib-prod.js:63-85` — `cueSheet()` derives TC in/out from the
  Editor's audio clips at project fps, honouring `speed`. That is the right
  source for timings: the cut, not a typed guess.
- `production/lib-prod.js:91-103` — `cueCsv()` runs every cell through
  `csvCell()`, which prefixes `= + - @ \t \r` with an apostrophe. The comment at
  `:86-90` explains why. Correct, and the note is worth keeping.
- `production/production.js:277` — the cue register's `use` options are the
  genuine PRO vocabulary: `BI, BV, VI, VV, MT, ET`, with the plain-English gloss
  in the summary line at `:282`.
- `post/lib-post.js:19-34, 118-174` — the post calendar: `sound-edit` (10d) →
  `mix` (5d) → `m-and-e` (2d), topologically sorted, weekend-skipping, solvable
  **backward** from a delivery date by an exact translation-invariant offset
  (`:140-148`), with the critical path computed. Well built and well tested.
- `distribution/lib-dist.js:20-23` — the audio deliverables list is right and
  complete for what sound post owes: 5.1 printmaster, 2.0 Lt/Rt fold-down, M&E
  described as *foley-filled*, and DME stems. Whoever wrote this knew the job.
- `distribution/lib-dist.js:49` — the broadcast preset correctly demands `me`
  and `textless`; the theatrical preset correctly does not.
- `tools/tools-registers.js:128-142` — `SB_Rights_v1` already models
  **`Music sync`** and **`Music master`** as distinct agreement kinds with
  territory, media, term start, term end and status, with `expiryField:
  'termEnd'` driving an expiry warning. The right schema for licence tracking
  exists in the platform. It is simply not wired to the music module.
- `clearance/lib-clear.js:29-30` — the music detector's action line is exactly
  right: "Sync + master license required before the cut locks — or replace with
  original score."
- `screening/lib-screen.js:34-56, 79-84` — timecoded notes threaded by session,
  open/done, sorted, converted to Editor ruler markers (consumed at
  `editor/cut-ui.js:207`). This is 80% of a spotting-session engine already.
- `editor/lib-mp4.js:153-201` — the muxer does write a real AAC audio track
  (`mp4a` + `esds`), so the export is not silent.

---

## What exists but needs work

### HIGH

- `music/lib-music.js:100` — **one `publisher`, one `masterOwner` per cue, no
  shares.** A commercial song routinely has three to five co-writers across
  different publishers, and a sync licence is only valid when 100% of the
  publishing is cleared. As modelled, a cue reads `licensed` with a single name
  in a box; nothing knows whether that name controls 100% or 25%. This is the
  exact mechanism by which indie films get sued after release. It also makes a
  PRO cue sheet impossible, because a PRO pays from per-writer and per-publisher
  **share percentages with society affiliation** and there is nowhere to put
  them. Change: `writers: [{name, society, share}]` and `publishers: [{name,
  society, share}]` on `makeCue()`, validate each set sums to 100 in
  `setStatus()`, and refuse the `licensed` transition when publishing is short.

- `music/lib-music.js:216-235` + `production/lib-prod.js:97-103` — **neither
  cue sheet is PRO-submittable, and they are the two halves of one document.**
  `cueSheet()` emits a fixed-width ASCII table with `__:__ – __:__` in the timing
  column (`:228`) and `[publisher]` / `[master owner]` placeholders — no machine
  can read it and no PRO portal accepts it. `cueCsv()` emits proper CSV with real
  timecode but its Composer / Publisher / Society columns are never populated
  (`production/production.js:294` seeds them as `''`), and it has no header block
  — a PRO needs production title, production company, episode/version, total
  running time, country of origin, release date and a contact before it will
  process a single cue. Change: one `cueCsv()` that emits the header block, then
  one row per cue carrying `n, title, tcIn, tcOut, duration, useCode, writer,
  writerSociety, writerShare, publisher, publisherSociety, publisherShare` —
  timings from `CProd.cueSheet()`, rights from `CMusic`.

- **`SB_Music_v1` and `SB_CueSheet_v1` are two disconnected cue lists.**
  `music/index.html:114` owns rights with no timings; `production/production.js:272`
  owns timings with no rights. Nothing bridges them, nothing reconciles them, and
  nothing anywhere warns that a cue sitting on the locked cut has no licence
  behind it. Change: carry a `musicCueId` on the register row, match on
  title+artist on the pull, and add a reconcile view with the only two lines
  that matter — *on the cut but not licensed* and *licensed but not on the cut*
  (the second is money already spent on a cue that got cut).

- **Two independent music scanners that disagree.** `clearance/lib-clear.js:29-30`
  and `music/lib-music.js:49-59` both read `SB_Timeline_v1.scriptText` with
  different regexes and write to different stores. `CClear` catches
  "whistles the tune"; `CMusic` does not. `CMusic` catches karaoke, jukebox and
  quoted titles; `CClear` catches some of those. A supervisor working one list
  is missing items on the other, and neither list knows the other exists.
  Change: make `CClear`'s music detector delegate to `CMusic.scanScript()`, or
  have the music page import `SB_ClearScan_v1` findings where `cat === 'music'`.

- `music/lib-music.js:16, 86-103` — **`scope` is two enum values and no cue
  carries a single date.** No territory, no term, no media breakdown, no licence
  expiry, no executed date, no reference to the signed document. A festival
  licence lapses — typically at one or two years — and the platform cannot tell
  you when, or which cue is about to revert, or which territory you never bought.
  Change: on the `licensed` transition, write two rows into `SB_Rights_v1`
  (`kind: 'Music sync'` and `'Music master'`) carrying counterparty, territory,
  media and term, and mirror the `termEnd` warning back onto the cue row.
  `tools/tools-registers.js:130` already drives expiry off `termEnd`, so the
  warning machinery is free.

- `post/lib-post.js:29, 33` — **M&E is a dangling leaf: delivery does not wait
  for it.** `m-and-e` depends on `mix`, and *nothing depends on `m-and-e`*.
  `delivery` depends only on `dcp` → `qc` → `grade, mix, vfx-final`. So the
  calendar will happily land delivery before the M&E exists, and M&E is never on
  the critical path — `scripts/test_post.mjs:59` asserts
  `F['m-and-e'].critical === false` as if that were correct. Every broadcast and
  streamer buyer requires M&E (`distribution/lib-dist.js:22, 47, 49`). Change:
  `delivery.after = ['dcp', 'm-and-e']`, and add a `stems` milestone after `mix`
  that `delivery` also waits on. Update the test to assert the new dependency.

- `post/lib-post.js:19-34` — **there is no music milestone anywhere in the post
  calendar, and no ADR or foley.** Fourteen milestones, none of them music.
  Sound edit is a single opaque 10-day block; the mix is 5 days. The composer's
  start date, the scoring dates and the score delivery date do not exist, so the
  one date most likely to blow the mix — the composer being late — is invisible
  on the critical path. Change: add `spotting` (after `picture-lock`, 1d),
  `score-delivery` (after `spotting`), `adr` and `foley` (after `turnover`), and
  make `mix.after = ['sound-edit', 'score-delivery', 'adr', 'foley']`. Add the
  new ids to `STAGE_ABBR` (`:177-182`) so versions can be logged against them.

### MED

- `distribution/lib-dist.js:71-75` — **a deliverable tick is a bare boolean.**
  `toggle()` flips `store.done[id]`; `distribution/index.html:134-135` does
  nothing more. So "5.1 printmaster" can be ticked with no channel order, no
  sample rate or bit depth, no loudness target, no 2-pop or head/tail leader, no
  file name and no QC result — and every one of those is a documented rejection
  reason. Change: make each entry `{spec, file, deliveredAt, qc}`. The platform's
  own other delivery list already does this: `production/production.js:337-340`
  has a file-reference field and a `todo / in QC / passed / delivered / n/a`
  enum. Copy that shape.

- `post/lib-post.js:231-237` — **the readiness map under-covers what sound post
  owes.** `DELIVERABLES` maps only `dcp / mix / m-and-e / grade / qc`. There is
  no entry for the 2.0 Lt/Rt fold-down or the DME stems, both of which
  `distribution/lib-dist.js:21, 23` requires. So the post supervisor's readiness
  cards silently omit two of the four audio deliverables. Change: add `stems`
  and `pm20` once the corresponding milestones exist.

- `music/index.html:133` and `post/index.html:247` — **every music and post PO
  lands on account `15000` undifferentiated.** That is the right *rollup*
  (`producer/budget-sheet.js:29` is Post-Production, and `SEED_MAP` at `:36`
  folds 15200/15400/15600/15800 into it), so no number is wrong — but Editorial,
  VFX, Sound design & mix, Music and Color/DI are five line items inside that one
  account, and the cost report cannot tell you that *music* is over while
  editorial is under. Worse, **the music module never reads the budget at all**:
  `music/index.html:207-223` shows a working total compared only against a
  hypothetical score. `js/budget-engine.js:704` already produces
  `15600 · Music (score + licensing)` scaled to the production size. Change:
  carry a budget line item on the PO (`item: 'Music'`) so `CMoney.costReport()`
  can split account 15000, and put budgeted / committed / forecast on the music
  page.

- `contracts/lib-deal.js:14-16, 61-63` — **a composer or sound-post deal memo
  commits to the wrong account.** `DEPT_ACCT` maps `music`, `post` and `edit` to
  `'5000'`, which is *Production Staff* (`producer/budget-sheet.js:19`), not
  post. And the match is `dept.indexOf(k) >= 0` against the role string, so a
  role typed literally "Composer" matches no key at all and falls through to the
  `'3000'` default — *Direction* (`budget-sheet.js:17`). Same for "Re-recording
  Mixer", "Supervising Sound Editor", "Foley Artist", "ADR Supervisor". Change:
  point music/post/edit at `'15000'` and add `composer`, `mixer`, `foley`, `adr`,
  `sound editor` keys.

- `workflow/workflow.js:144-161` and `workflow/advisor.js:175-177` — **the
  pipeline can read "complete" with zero cleared cues.** The Deliver stage checks
  captions, credit roll, press kit and export. The advisor flags open
  `SB_Clearance_v1` rows but never reads `SB_Music_v1` or `SB_ClearScan_v1`.
  Change: count cues whose status is neither `licensed` nor `replaced` and raise
  a `high` action — this is the one clearance failure that stops a delivery dead.

- `editor/cut-ui.js:233-236, 631, 659` — **one audio lane, one stereo
  mixdown.** Every audio clip is absolutely positioned in a single lane, so
  overlapping music and dialogue collide visually with no way to tell them
  apart. `mixAudio()` hard-codes `new OAC(2, …)` and sums every source into one
  destination; `encodeAudio()` hard-codes `numberOfChannels: 2` at 128 kbps.
  There is no dialogue/music/effects classing, so the platform can never render
  the DME stems or the M&E it asks you to tick in `distribution/`. Change: add
  `bus: 'dia' | 'mus' | 'fx'` to audio clips (default `'mus'`), lane them by bus,
  and render one mixdown per bus — an M&E is then simply "everything except
  `dia`", which is the definition.

- `editor/lib-cut.js:186, 204, 210, 216, 226` — **OTIO markers are hardcoded
  empty and thrown away.** The project model carries `project.markers`, the
  Screening Room produces them (`screening/lib-screen.js:79-84`) and the Editor
  renders them (`cut-ui.js:207`) — but `otio()` writes `markers: []` in all five
  places. OTIO is the turnover format Resolve and Pro Tools read natively; markers
  are precisely how a spotting session travels from the edit suite to the mix
  stage. The schema slot is already there. Change: emit `project.markers` as
  `Marker.2` entries on the V1 track. Small change, disproportionate payoff.

### LOW

- `music/lib-music.js:15` — `USES` is `background / featured / main title /
  end credits`, which does not map onto the PRO codes the *other* cue module
  already uses (`production/production.js:277`: BI/BV/VI/VV/MT/ET). A PRO needs
  the instrumental-vs-vocal and visual-vs-background axes; "featured" carries
  neither. Change: make `USES` the six codes with plain-English labels, and
  weight the estimate off them (visual/vocal → top half of the tier range).
- `music/lib-music.js:141` — `master` is set to exactly the same figure as
  `sync`. Defensible as an MFN convention, and the letter does ask for MFN
  (`:203`) — but for a major-label recording the master is often the dearer side,
  and for a public-domain composition there is a master fee and *no* sync fee at
  all. Change: a `pdComposition` flag that zeroes the sync side, and let the two
  sides be quoted independently.
- `music/lib-music.js:17` — no `denied` status. A cue the publisher refuses sits
  at `quote requested` forever or gets flipped to `replaced` before a replacement
  exists. Change: add `denied`, cost it like `identified`, flag it red.
- `music/index.html:240` — the mailto body is truncated with
  `.slice(0, 1800)` **after** `encodeURIComponent`, which can cut mid-escape-
  sequence and produce a malformed URI. Slice the raw text first, then encode.

---

## What is missing entirely

- **Spotting session, tied to timecode** — *highest value in this report.*
  Against locked picture, the director, composer and supervising sound editor
  produce a numbered list of cues: cue number in reel convention (1M1, 2M3),
  in and out timecode, description, and department. Every artifact downstream is
  derived from it — the composer's schedule, the cue sheet, the ADR list, the
  foley list, the mix plan. Cinamate has no spotting anything; the word appears
  once in the repo and it refers to subtitles (`distribution/lib-dist.js:25`).
  Attach to `screening/`, which is already 80% of the engine: extend `addNote()`
  (`screening/lib-screen.js:34`) with `dept` (`music | dialogue | adr | foley |
  fx`) and an `outSec` so a note becomes a range, add reel/cue numbering, and
  emit the result as the seed for the cue sheet and the ADR/foley lists. Roughly
  300 lines in `lib-screen.js` plus a spotting pane. **Value: HIGH** — it is the
  hub every other gap on this list hangs off.

- **ADR list and ADR cue sheet** — every picture has ADR: unusable production
  takes, off-camera lines, loop group and crowd, and censorship alts. The ADR
  supervisor needs per line: character, performer, scene, TC in/out, the line
  itself, reason (technical / performance / legal / alt), status, and a
  **grouping by performer** so a two-hour session can actually be booked. The
  platform has cast (`production/lib-cast.js`), the script, and a sound-report
  notes field that literally says "wild lines, room tone"
  (`production/production.js:202`) — but no ADR feature. The only occurrence of
  "ADR" in the repo is an LLM agent id in `agents/client.js:61`, in a directory
  excluded from deploys. Attach to `production/` as an `SB_ADR_v1` register
  beside the cue-sheet pane, seeded from spotting notes tagged `adr`. A Register
  schema plus a group-by-performer function and a CSV out. **Value: HIGH** —
  small build, and without it ADR days get booked from a paper list.

- **Foley spotting and foley plan** — the reason foley exists is the M&E:
  every footstep, cloth move and prop handle that lived under production dialogue
  on location must exist as a separately recorded element, or the foreign dub
  plays silent under the dialogue. Cinamate *requires* "M&E (music & effects,
  foley-filled)" (`distribution/lib-dist.js:22`) and gives you two days for it
  (`post/lib-post.js:29`) but offers no way to plan what fills it. Attach to
  `post/` or `production/`, driven by the same spotting engine: per scene —
  footsteps, props, cloth, specifics — with estimated foley hours and an **M&E
  risk flag** on any scene whose only audio is production dialogue. **Value:
  MED-HIGH.**

- **Mix deliverable specification and stem manifest** — what gets rejected at QC
  is spec, not existence: channel order (L R C LFE Ls Rs), 48 kHz / 24-bit,
  loudness target, true-peak ceiling, head and tail leader with the 2-pop, and
  the stem set. Nothing in the repo measures or even names loudness — a
  repo-wide search for LUFS / LKFS / true peak / R128 returns zero hits. Attach
  to `distribution/lib-dist.js` as a `spec` object per audio deliverable with the
  common buyer presets, rendered as the instruction sheet the mix stage works
  from, and mirrored into `post/` readiness. **Value: MED-HIGH** — it converts a
  checkbox into an instruction, which is the difference between a tick and a
  delivery.

- **Music budget against the licensing plan** — the music page computes a
  working total (`music/index.html:207-223`) and compares it to a hypothetical
  score, never to the actual budget. `js/budget-engine.js:704` already generates
  `15600 · Music (score + licensing)` scaled by production size, and
  `producer/budget-sheet.js:29` carries a Music line item. Attach to `music/`:
  read `SB_BudgetSheet_v1`, show budgeted / committed / forecast in the existing
  totals banner, go red when the forecast passes budget, and offer a
  "what to drop" list sorted by dollars per second of screen time — which is the
  actual conversation a supervisor has with a producer. **Value: MED-HIGH,
  small build.**

- **Licence document register with expiry** — a cue marked `licensed` carries no
  evidence at all: no executed date, no licence number, no counterparty
  signature, no term end, no file reference. E&O underwriters and every
  distributor ask for the executed licences, and a lapsed festival licence is how
  a picture loses its music mid-release. `SB_Rights_v1`
  (`tools/tools-registers.js:128-142`) already has the exact schema, expiry
  warning included. Attach `music/` → `tools/#rights` on the `licensed`
  transition. **Value: MED-HIGH, small build** — the destination already exists.

- **Change notes between cut versions** — picture changes after the score is
  written, and a music editor conforms the cues to the new cut. The platform logs
  cut versions (`post/lib-post.js:183-204`) but never computes what actually
  moved between two of them, so nobody knows which cues need conforming. Attach
  to `post/`'s versions log: diff two `SB_Cut_v1` snapshots into a change list
  (frames added/removed at each edit point). Medium effort, and it serves music
  editorial, ADR and VFX from one build. **Value: MED.**

- **Composer agreement and score delivery terms** — `contracts/lib-deal.js` has
  cast and crew templates only. A composer deal is a different animal: work-for-
  hire assignment of the score, package fee versus fee-plus-budget, what the
  package covers (players, studio, orchestrator, mix), publishing (composer
  normally keeps the writer's share; the publisher's share is the negotiation),
  the delivery format including stems and layout, and who registers the cues with
  the PRO. Without those publishing terms stated, the cue sheet cannot be
  completed for the *score* cues either — not just the licensed songs. Attach to
  `contracts/` as a `composerDefaults()` beside `castDefaults()`
  (`lib-deal.js:29`), and fix `DEPT_ACCT` in the same pass. **Value: MED,
  small build.**

- **Two-sided quote tracking** — the module's own note says the publisher and the
  label are usually two separate letters (`music/index.html:93`), but the data
  model has a single `actualQuote` (`music/lib-music.js:99`). In practice they
  are two conversations, two turnarounds, two counterparties, with MFN linking
  the figures. Change `actualQuote` into `syncQuote` / `masterQuote` with a
  per-side status and counterparty, plus an MFN flag that mirrors the higher
  figure. Attach to `music/`. **Value: MED, small build** — it makes the estimate
  and letter machinery that already exists actually honest.

- **Temp-track discipline** — `editor/lib-cut.js:312-350` (`beats`,
  `cutToBeats`) actively encourages cutting picture to a dropped-in music track,
  and `editor/cut-ui.js:897` prompts you to "drop a music track on A1 first".
  That track is almost always an uncleared commercial recording, and cutting to
  it produces temp love plus a picture that only works to a song nobody can
  afford. Nothing warns. Change: when an audio clip drives `cutToBeats()`, offer
  to create a cue for it in `SB_Music_v1` at status `identified`. Attach
  `editor/` → `music/`. Tiny build, and it closes the most common route by which
  an uncleared cue reaches picture lock. **Value: LOW-MED, but the cheapest item
  here.**

---

## Evidence

Files read in full: `music/lib-music.js` (246), `music/index.html` (286),
`post/lib-post.js` (264), `post/index.html` (279), `clearance/lib-clear.js`
(153), `clearance/index.html` (154), `production/lib-prod.js` (182),
`distribution/lib-dist.js` (117), `editor/lib-cut.js` (389),
`screening/lib-screen.js` (107), `contracts/lib-deal.js` (112).

Files read in part: `production/production.js:1-6, 176-206, 264-341`;
`editor/cut-ui.js:198-236, 626-705`; `editor/lib-mp4.js:105-205` (audio track);
`finance/lib-money.js:1-100`; `js/budget-engine.js:67-72, 690-726`;
`producer/budget-sheet.js:14-36`; `tools/tools-registers.js:100-177`;
`tools/tools-core.js:14-110` (Register storage shape);
`workflow/workflow.js:110-180`; `workflow/advisor.js:160-193`;
`workflow/advisor-ui.js:28-54`; `distribution/index.html:104-135`;
`scripts/test_music.mjs`, `scripts/test_post.mjs` (assertions only);
`agents/client.js:25-70`.

Specific claims and where they are verified:

- Sync/master as separate sides — `music/lib-music.js:125-147`; library all-in
  at `:22-28, 141`.
- Festival factor and step-up language — `music/lib-music.js:18, 138-145,
  188-190`.
- One publisher / one master owner, no shares, no dates — `music/lib-music.js:
  86-103` (full `makeCue` field set).
- Cue-sheet timing placeholder — `music/lib-music.js:228` (`'__:__ – __:__'`).
- `cueCsv` header row without a production header block —
  `production/lib-prod.js:98`; empty composer/publisher/society seeded at
  `production/production.js:294`, `302`.
- CSV injection guard — `production/lib-prod.js:91-95`.
- PRO use codes present in the production register — `production/production.js:277`.
- M&E dangling: `m-and-e after ['mix']` (`post/lib-post.js:29`), `delivery after
  ['dcp']` (`:33`), and the test asserting M&E is not critical —
  `scripts/test_post.mjs:59`.
- No music/ADR/foley milestone in the post template — full list at
  `post/lib-post.js:19-34`.
- Readiness map omits stems and 2.0 — `post/lib-post.js:231-237` vs
  `distribution/lib-dist.js:20-23`.
- Deliverable toggle is boolean — `distribution/lib-dist.js:71-75`;
  `distribution/index.html:134-135`.
- POs to account 15000 — `music/index.html:133`, `post/index.html:247`; account
  15000 is Post-Production with five line items at `producer/budget-sheet.js:29`;
  `SEED_MAP` folding 15600 → 15000 at `:36`; budget engine generating
  `15600 · Music (score + licensing)` at `js/budget-engine.js:704`.
- Deal-memo account mis-mapping — `contracts/lib-deal.js:14-16` (`music/post/edit
  → '5000'`), matched by substring at `:61-63`, so "Composer" falls to the
  `'3000'` default; `'5000'` = Production Staff and `'3000'` = Direction per
  `producer/budget-sheet.js:17, 19`.
- Pipeline Deliver stage contents — `workflow/workflow.js:146-151`; advisor reads
  `SB_Clearance_v1` only — `workflow/advisor-ui.js:54`, `workflow/advisor.js:175-177`.
- Single audio lane — `editor/cut-ui.js:233-236`; stereo-only mixdown —
  `cut-ui.js:631` (`new OAC(2, …)`) and `:659` (`numberOfChannels: 2`).
- OTIO markers hardcoded empty — `editor/lib-cut.js:186, 204, 210, 216, 226`;
  markers do exist in the project model at `editor/cut-ui.js:207` and are
  produced by `screening/lib-screen.js:79-84`.
- `SB_Rights_v1` schema with Music sync / Music master, territory, media, term —
  `tools/tools-registers.js:130-142`.
- Two music scanners — `clearance/lib-clear.js:29-30` vs `music/lib-music.js:49-59`.
- mailto slice-after-encode — `music/index.html:240`.
- No loudness handling anywhere: repo-wide grep for `LUFS|LKFS|loudness|dBFS|
  true peak|R128` over all `.js`/`.html` outside `node_modules`, `static`,
  `private` returns zero hits.
- "ADR" appears only in `agents/client.js:33, 61`; "foley" only in
  `distribution/lib-dist.js:22`; "spotting" only in `distribution/lib-dist.js:25`
  (subtitle spotting), by the same greps.
