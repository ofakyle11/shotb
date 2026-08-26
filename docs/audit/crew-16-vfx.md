# VFX Supervisor

Verdict up front: **you could brief a shot list from this. You could not bid it,
turn it over, track it or deliver it.** The `vfx/` module is a competent
first-pass breakdown-and-estimate tool with an honest tone about what its
numbers are worth. Past the estimate it stops: no dates, no vendor entity, no
version history, no turnover, no pull list, no plate identity, no cost-per-shot
against a real VFX budget line. And the platform carries **two disconnected VFX
shot registries** with different numbering schemes and different status
vocabularies, both visible to the same owner in the same session.

---

## What exists and works

- `vfx/lib-vfx.js:13` — a seven-state lifecycle (`briefed → bid → awarded →
  plates → temp → final → approved`) that is genuinely the right spine. Most
  tools stop at "in progress / done". This one names the two states a
  supervisor actually lives between — `temp` and `final`.
- `vfx/lib-vfx.js:85-95` — `VFX-010, VFX-020 …` numbering, always ten past the
  highest on the board. Gapped numbering is the correct convention: it leaves
  room to insert `VFX-015` when the cut changes without renumbering the show.
  This is the only stable shot identifier anywhere in the platform.
- `vfx/lib-vfx.js:17-28` — planning bands by complexity, every return carrying
  `label: 'planning estimate'`, and `vfx/index.html:90` repeating in the UI that
  these are not quotes. Correct and honest. A tool that hands a first-timer a
  number that looks like a quote does real damage; this one refuses to.
- `vfx/lib-vfx.js:113-120` — `bidVsEst` classifies a vendor bid as
  below/within/above the band with a signed delta. That is exactly the sanity
  check a supervisor wants on a bid sheet, and it is done right.
- `vfx/lib-vfx.js:144-163` — the plate checklist scales with complexity, and the
  content is real: clean plate and tracking markers at medium, HDRI plus
  chrome/grey ball at complex, witness cam and set survey at hero. Someone who
  has actually stood on a set wrote this list.
- `vfx/lib-vfx.js:182-210` + `vfx/index.html:92-98` — the day sheet groups shots
  by scene and prints the plate needs at that scene's *maximum* complexity
  (`:197-203`). Taking the max is the right call — you shoot the hardest shot's
  requirements for the whole setup.
- `sets/lib-set.js:26` + `sets/lib-set3d.js:47` — a greenscreen stencil with a
  12 ft profile, and `sets/gl.js:171-198` draws every camera's real frustum as
  wireframe. You can lay a green in and check from the camera mark whether it
  fills frame. That is a real previz answer to a real previz question, and
  nothing else on the platform does it.
- `sets/lib-set3d.js:382-393` + `sets/gl.js:118-140` — "look through the lens"
  puts the viewport at the camera item's mark at its focal length. The idea is
  right and the maths is tested (`scripts/test_set3d.mjs`, 63 checks).
- `editor/lib-cut.js:163-231` — the OTIO export is real `Timeline.1` /
  `Track.1` / `Clip.2` schema that Resolve reads natively. That is the correct
  turnover *carrier* to have built; it is just not carrying anything VFX yet
  (see below).
- `tools/lib-media.js:59-84` — a nine-format sensor table with correct
  dimensions and a proper FOV/coverage/full-frame-equivalent calculator. This is
  the right piece of lens maths, in the wrong module (see HIGH item 4).
- `tools/lib-media.js:86-130` — an MHL-style hash manifest with re-verification.
  The correct primitive for proving a plate delivery arrived intact.
- `producer/schedule-board.js:39-40` — strips carry a `vfx` tag, so VFX scenes
  are visible on the board and countable as special-unit days (`:126`).
- `post/lib-post.js:197-215` — the post module's version log and vendor-bid
  handling are done properly: versions are *rows* with a date and notes, and
  `committedPo` holds the PO number, not a boolean. The VFX module is the worse
  sibling of code that already exists ten directories away.
- `scripts/test_vfx.mjs` — 47 checks, all passing; 44/44 suites green on
  `node scripts/run_all_tests.mjs`. The estimate maths, the code sequencing and
  the checklist scaling are all covered.

---

## What exists but needs work

### HIGH — two VFX shot registries, neither complete

`vfx/index.html:110` stores `SB_VfxBoard_v1`. `production/production.js:243`
stores `SB_VfxShots_v1`. Nothing reads either but its own page (verified: those
two lines are the only references in the repo). Both are reachable in the same
session — the dashboard rail at `dashboard.html:1504` and the "VFX Shots" tab at
`production/index.html:76`.

They disagree on everything that matters:

| | `vfx/` board | Production Office tab |
|---|---|---|
| Shot ID | `VFX-010` by tens (`lib-vfx.js:91-95`) | `'VFX' + random 101-990` (`production.js:260`) |
| Statuses | briefed/bid/awarded/plates/temp/final/approved | Brief/In progress/Review/Retake/Final |
| Version | `v001`, single string | `v1`, single string |
| Money | complexity band + bid + PO commit | none |
| Dates | none | `due` only |

`production/production.js:260` generating a **random** shot number is the worst
of it. Two shots can collide; the numbers carry no order; and it cannot be
reconciled with the `VFX-0n0` board. A shot number is the primary key of a VFX
show — every plate name, every version, every invoice line and every DI note
hangs off it.

**Change:** delete the Production Office VFX pane and redirect that tab to
`/vfx/`, migrating any `SB_VfxShots_v1` rows into `SB_VfxBoard_v1` on first load
(keep both keys — the brief forbids renaming, but nothing forbids reading the
old one once and marking it migrated). Move the two fields the Production pane
has that the real board lacks — `due` and `notes` — onto `makeShot` at
`vfx/lib-vfx.js:97-109`.

### HIGH — the shot count, the number a bid lives or dies on, is a scene count

`vfx/lib-vfx.js:69-82`: `detectShots` emits **one suggestion per cue per scene**.
A scene where a dragon plays across fourteen cuts produces one `hero` shot. A
scene with two separate creature beats produces one.

Meanwhile `js/budget-engine.js:694-698` computes VFX shot count top-down as
`clips × shotsPct` (or `runtimeMin × shotsPerMin`) and posts it to
`15200 · VFX (N shots, …)` at `:702`. So the platform gives a supervisor two
shot counts derived by unrelated methods, with no reconciliation view, and the
one in the VFX module is structurally an undercount.

Worse in the other direction: `vfx/lib-vfx.js:43` fires `Sky replacement` on the
bare word `sky` anywhere in scene action. Verified — a three-scene sample with
"the sky is grey", "he looks at the sky", "birds fly against the sky" yields
three phantom shots and a $1,500–$4,500 phantom planning range. On a
thirty-exterior feature that is 30 phantom shots. `flies|flying` (`:46`) matches
the insect; `crash` (`:36`) matches waves.

**Change:** make `detectShots` return *cue occurrences with a count* (how many
times the cue fires in the scene body) and have the board seed one shot per
occurrence, so a supervisor is deleting rather than inventing. Add a
`confidence` field and put the loose single-word cues (`sky`, `flies`, `crash`)
behind a "suggested — confirm" chip the operator must accept. Then surface both
counts side by side: bottom-up board total vs `budget-engine` top-down estimate.

### HIGH — a revised script silently mis-numbers every scene

`vfx/lib-vfx.js:58` uses `/^\s*(?:\d+[\s.]*)?(INT|EXT|INT\/EXT|I\/E)[.\s]/i`.
`timeline/timeline-budget.js:282` — which drives the stripboard and the budget —
uses `/^\s*(?:\d+[A-Z]?[.\s-]*)?(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i`.

Two divergences, both live:

1. The budget regex allows an **A-scene** (`14A INT. VAULT - DAY`), the standard
   revision convention. The VFX regex does not: `\d+[\s.]*` cannot consume the
   `A`, so the slugline fails to match entirely. Verified by running the
   library — a three-scene sample containing one A-scene comes back as **two**
   scenes, and the explosion that belongs to 14A is attributed to scene 1.
   Every scene number after the first A-scene is wrong, silently.
2. The VFX regex accepts `INT LAB - NIGHT` (no period); the budget regex does
   not. So a Fountain or plain-text draft splits into different scene counts in
   the two modules.

A VFX supervisor works off blue and pink pages more than off the white draft.
This bug appears exactly when the show gets real.

**Change:** one shared slugline splitter. `timeline/timeline-budget.js:282-292`
is the more correct of the two — export it and have `vfx/lib-vfx.js:54`,
`dailies/lib-dailies.js:15-25` and `production/lib-prod.js:110` all call it.
Carry the A-scene suffix through as part of the scene key, not just the integer.

### HIGH — award writes to the wrong account and cannot be undone

`vfx/index.html:247-248` commits an awarded bid to account **`15000`**.
`producer/budget-sheet.js:29` defines `15000` as **Post-Production** entire, with
VFX merely one of five *items* inside it — Editorial, VFX, Sound design & mix,
Music, Color/DI. `js/budget-engine.js:702` estimates VFX at `15200`, which
`producer/budget-sheet.js:36` (`SEED_MAP`) folds up into `15000`.

`finance/lib-money.js:64-81` rolls actuals up by exact account string. So every
VFX PO pools with editorial and sound. **There is no way to ask "what have I
spent on VFX against what I budgeted for VFX" anywhere on this platform.** That
is the single question a supervisor is asked every week.

Two further defects in the same twenty lines:

- `vfx/lib-vfx.js:107` stores `committedPo: false` — a **boolean**. The PO number
  from `CMoney.addPO` is thrown away at `vfx/index.html:250`. `finance/lib-money.js:32-37`
  has `setPoStatus(m, id, 'void')` sitting right there, and the VFX board can
  never call it because it did not keep the id. Delete a shot
  (`vfx/index.html:161-165`) and its committed PO stays in the Money Room
  forever with no trace of what it bought. `post/lib-post.js:212` and
  `post/index.html:236,249` already do this correctly — they store `po.num` and
  warn you which PO to void. Copy that.
- Move an awarded shot backwards (re-bid after a scope change) and the status
  select at `vfx/index.html:135-137` writes it with no guard; `board()` at
  `vfx/lib-vfx.js:133` then drops the bid out of `totalAwarded` while the PO
  stays open in the Money Room and `committedPo` stays `true`, so the shot can
  never be re-awarded at the new number. The board and the Money Room now
  disagree and neither is flagged.

**Change:** open a real `15200 · VFX` account in `DEFAULT_CATEGORIES`
(`producer/budget-sheet.js:20-32`) and stop mapping it away in `SEED_MAP`; commit
VFX POs there. Store the PO number in `committedPo`. On delete or de-award, call
`setPoStatus(…, 'void')` and say so in the toast.

### HIGH — the version bump destroys the version history

`vfx/lib-vfx.js:176-179` + `vfx/index.html:166-172`: bumping `v001 → v002`
overwrites a single string on the shot. No date, no note, no status at the time
of the bump, no who, no link to a file. `versionName` (`:170-174`) composes a
perfectly good name — `NIGHTHARVEST_VFX-010_temp_v001` — and then nothing keeps
a record that it ever existed.

A VFX shot's version history *is* the shot's record. "Vendor says they delivered
v004 on the 12th; we reviewed v003 and kicked it back" is the daily conversation,
and this board cannot hold either half of it.

`post/lib-post.js:190-204` gets this right in the same codebase: `addVersion`
pushes `{id, stage, n, date, notes}` rows into an array and `nextVersion` finds
the max. Mirror it exactly.

**Change:** replace `shot.version` (string) with `shot.versions` (array of
`{v, date, status, note, vendor}`), keep `shot.version` as a derived getter so
nothing breaks, and render the last three versions inline on the row.

### MED — the day sheet is in script order, not shoot order

`vfx/lib-vfx.js:189` sorts scenes numerically ascending. A day sheet's whole
purpose is "what does the VFX wrangler need on **today's** setups". The
stripboard already assigns `scenes[].day` (`producer/schedule-board.js:84,104-107`)
under `SB_ScheduleBoard_v1`, and `vfx/index.html:174` already reads localStorage
for the screenplay, so the join is one `readLS` away.

**Change:** `daySheet(shots, project, board)` — group by shoot day, fall back to
scene order when unscheduled, and head each block with the day number and date.
Add a "Day N only" filter to the page.

### MED — no dates anywhere on a VFX shot

`vfx/lib-vfx.js:97-109` — `makeShot` has no bid-due, no award, no turnover, no
vendor-delivery, no review, no final-due. `post/lib-post.js:30` schedules
`vfx-final` as a flat **15 working days** regardless of whether the show is four
shots or four hundred, and `:31` gates QC behind it. So the post calendar's VFX
box is decorative.

**Change:** add the date fields to `makeShot`; drive the `vfx-final` milestone
duration from the board (shot count weighted by complexity) instead of the
constant at `post/lib-post.js:30`; flag shots whose vendor-delivery date lands
after turnover.

### MED — the 2D plan and the 3D lens view disagree about the sensor

`sets/lib-set.js:79-83` computes the plan's camera cone for a **full-frame
36 mm** sensor. `sets/lib-set3d.js:373-380` computes the "look through" FOV for
**Super 35 (24.89 × 18.66)**. Verified numerically on the same 35 mm camera item:

```
plan cone   35 mm → 54.4°
look-through 35 mm → 39.1°
plan cone   24 mm → 73.7°
look-through 24 mm → 54.8°
```

Fifteen degrees apart — the difference between a 35 and a 50. And
`sets/index.html:97` tells the user the cone is "(full-frame)" while the view
they are about to open is not. If you size a greenscreen off the plan and then
check it through the lens, the two answers contradict each other.

`tools/lib-media.js:59-69` already holds the correct nine-format sensor table.

**Change:** export `SENSORS` from `tools/lib-media.js`, add a per-plan (or
per-camera) sensor selector, and have both `sets/lib-set.js:80` and
`sets/lib-set3d.js:376` read from it. Delete both hardcoded constants. Add an
anamorphic squeeze factor while you are in there — a 2x squeeze changes the
horizontal answer by 100%.

### MED — the camera cannot tilt

`sets/lib-set3d.js:382-393`: `cameraView` builds `target` at the same `y` as
`eye` (`:391`). The camera is permanently level. There is no tilt, no roll, no
dutch — and `sets/gl.js:122-140` calls it with no override.

Lens height *is* adjustable (`sets/index.html:158`, via the item's overall height
minus 0.5 ft at `lib-set3d.js:383`) but it is labelled "Height ft" and means the
height of the camera *object*, which also resizes the drawn body. A supervisor
reading "lens height 4'6\"" off a plan has no field to put it in.

Tilt and lens height are two of the four numbers on every on-set VFX data sheet
(with focal length and T-stop). Without tilt, a low-angle set-extension previz —
the most common reason to previz at all — cannot be represented.

**Change:** add `tilt` and `roll` to the camera item, honour them in
`cameraView`, and split "lens height" out as its own field distinct from the
body height. Show `lens · height · tilt` under the "look through" note at
`sets/index.html:199-206`.

### MED — the OBJ/STL export is not a layout handoff

`sets/lib-set3d.js:399-439`. It is a valid mesh export and it opens anywhere.
As a *VFX layout* handoff it fails on four counts:

1. **No camera.** The one thing this module knows that a general modeller does
   not — where the camera is and what lens it carries — is exported as a *box*
   (`cameraQuads`, `:223-228`). Position, orientation and focal length are
   thrown away. A layout artist gets a small crate on the floor.
2. **No units and no axis declaration.** `:405` writes `# units: feet` as a
   comment. OBJ has no unit field; Maya, Blender and Nuke will each import at
   their own default. A set that is 24 ft across arrives 24 cm or 24 m across.
   No scale option, no Z-up toggle.
3. **No materials.** `itemMesh` (`:265`) carries a colour that `toOBJ` never
   writes — no `mtllib`, no `usemtl`. Greenscreen, walls and blocking marks all
   arrive the same grey, so a layout artist cannot tell the green from a flat.
4. **Unwelded geometry.** `:407-415` emits four fresh vertices per quad
   (`n += 4`), no `vn`, no shared vertices. Every box is 24 loose verts.

**Change:** write an `.mtl` sidecar from `colorOf`; add a scale selector
(ft / cm / m) that multiplies vertices rather than annotating them; add a Z-up
option; and — the highest-value piece — export cameras as a separate plain-text
`.chan`-style file (`frame tx ty tz rx ry rz focal`, one line, static) plus
`usemtl` groups. A one-line camera file is trivially readable by every VFX
package and is worth more than the geometry.

### MED — the EDL cannot be conformed and carries no VFX marks

`editor/lib-cut.js:142-156`. Every event line is written with reel **`AX`**
(`:149`) — auxiliary. A conform house cannot pull a plate from `AX`; it needs the
source reel/card name. And the OTIO export sets `markers: []` on every clip
(`:185`, `:206`) — markers are precisely the mechanism by which a VFX turnover
travels inside a timeline.

There are also no handles: `edl()` writes source in/out exactly at the cut. The
`handle` parameter at `:255` is an auto-assembly trim, not a pull handle.

**Change:** carry a reel/card name on the source bin entry and write it into the
EDL event; write VFX shot codes into OTIO `markers` where a clip is flagged VFX;
and add a handle count (default 8 frames) to the EDL/pull export.

### LOW — the boards shot list has no shot number

`boards/lib-shots.js:36-37`: `blankShot` carries size, angle, move, lensMm, desc,
img, dur — and no identifier. `toCsvRows` (`:90-98`) numbers shots by array index
(`String(i + 1)`). Reorder a scene and every shot number in it changes. There is
also no `vfx` boolean, so the storyboard cannot be filtered to VFX shots and the
VFX board cannot be seeded from the storyboard.

**Change:** add a stable `num` (scene-letter convention: `12A`, `12B`, matching
`dailies/lib-dailies.js:36-50`, which already implements bijective base-26
correctly) and a `vfx` flag; add both to `toCsvRows`.

### LOW — the take log cannot mark a plate

`dailies/lib-dailies.js:81-92`: a take carries day, scene, slate, take, camera
A/B, circled, ngReason, notes, soundRoll, lens (free string), tcIn. Missing:
camera roll/card, clip filename, T-stop, fps, filtration, lens height, tilt —
and any VFX shot reference. `production/production.js:181-193`'s camera report
adds stop and filter but is keyed by scene, not by take or by VFX shot.

So the platform records that a take happened and separately records that a VFX
shot exists, and there is no join. The supervisor cannot answer "which take is
the plate for VFX-060, and what was the lens height on it."

**Change:** add `vfxCode` and `plateType` (`main | clean | witness | element`) to
`makeTake`, plus `roll`, `clip`, `stop`, `fps`, `heightFt`, `tiltDeg`. Show the
VFX board's per-shot plate status from the takes that reference it.

### LOW — cue false positives beyond the sky case

`vfx/lib-vfx.js:31-47` is a good list, but it has no negative lookarounds and no
dialogue exclusion — the cues run over the whole scene body including character
dialogue (`:73-75` joins `sc.body` wholesale). A character *saying* "there's a
ghost in this house" bids a spectral comp pass.

**Change:** strip dialogue blocks before cue matching, the way
`production/lib-prod.js:106-118` already isolates character blocks.

---

## What is missing entirely

### 1. A vendor entity and a turnover package — HIGHEST VALUE

`vfx/lib-vfx.js:103` — `vendor` is a free-text string on each shot. There is no
vendor record anywhere on the platform. So there is no bid-due date, no award
date, no contact, no per-vendor package, no delivery spec, no payment milestone,
no security tier, no NDA, and no per-vendor rollup in `board()`
(`vfx/lib-vfx.js:124-141` totals only globally).

Nor is there a **turnover**. `post/lib-post.js:24` has a `turnover` milestone —
a date box with nothing in it. A turnover in practice is: a locked shot list with
codes and frame counts, plates named to a convention, handles, a count sheet, a
reference cut, and a signed scope. None of it exists.

Attach to `vfx/`, as a fourth section. Build: a `vendors` array
(`{id, name, contact, bidDue, awarded, spec, security, milestones[]}`) with
shots pointing at vendor ids instead of strings; a `turnover(shots, vendorId)`
function producing a package text/CSV per vendor; and a per-vendor rollup in
`board()`. Roughly one new pure-logic section in `lib-vfx.js` plus a page
section — a day's work, and it is what turns this from a breakdown tool into a
production tool.

### 2. Plate naming convention and plate identity — HIGH

Nothing on the platform names a plate. `vfx/lib-vfx.js:170-174` composes a
*version* name; there is no plate name, which is a different and earlier thing
(`SHOW_VFX0060_v001_plateA_clean`). Without a convention agreed before the
shoot, plates arrive named by the DIT's card structure and every vendor invents
their own, which is where a week disappears.

Attach to `vfx/`, next to `versionName`. Build: a `plateName(project, shot,
plateLetter, type, take)` composer, an editable convention template shown on the
page, and a printable "plate naming card" for the DIT. Small — half a day — and
disproportionately valuable. `tools/lib-media.js:86-130`'s MHL manifest is
already there to verify the delivery once the names exist.

### 3. On-set VFX data capture — HIGH

`vfx/lib-vfx.js:144-163` lists what to capture. Nothing records that it *was*
captured. There is no field anywhere for: HDRI shot (yes/no, when, which
lighting state, file ref), chrome/grey ball pass, tracking markers placed and
where, witness cam roll, set survey, lens height, tilt, T-stop, fps, filtration,
camera-to-subject distance, or a lidar/photogrammetry reference.

Attach to `vfx/` (a per-shot data panel) writing back into the same
`SB_VfxBoard_v1` store, with the take-log link from the LOW item above. Build:
`shot.onSet = {hdri, balls, markers, witness, survey, lensMm, stop, fps,
heightFt, tiltDeg, distFt, notes}`, a red/amber/green completeness chip per shot
on the board, and a "data gaps" list on the day sheet. Medium — a day. This is
the difference between a checklist and a supervisor's actual record.

### 4. Cost per shot against a VFX budget line — HIGH

Covered under the account bug above, but the missing *capability* is its own
item: there is no view anywhere showing, per shot, `planning estimate → bid →
awarded → invoiced → paid`, and no rollup of that against a VFX budget line.
`finance/lib-money.js:64-81` can already do the arithmetic once VFX has its own
account. Attach to `vfx/` section 3 and to `finance/`. Small once account 15200
exists.

### 5. Complexity scoring with drivers, not a four-word dropdown — MED

`vfx/lib-vfx.js:14` — complexity is one of four labels chosen by hand or guessed
from a cue. Real bidding scores drivers: roto? matchmove? CG element count?
sim? crowd? day/night? screen time? number of characters interacting? A dropdown
cannot express "medium comp but four weeks of roto", which is the most common
budget surprise on an indie.

Attach to `vfx/lib-vfx.js` alongside `internalEst`. Build a driver checklist per
shot that scores into a complexity band and widens or narrows the estimate range
accordingly, and show the drivers on the bid comparison so a vendor's number can
be argued against something. Medium.

### 6. Omits, adds and cut-change tracking — MED

`vfx/lib-vfx.js:13` has no `omit` state and no `retake`/kickback. Shots get cut;
awarded shots get omitted; finals get kicked back by the director. The board can
only be walked forwards, and walking it backwards silently breaks the money
(see HIGH item 4). There is also no record of *which cut* a shot count was
locked against, so "the count went from 84 to 112" has no audit trail.

Attach to `vfx/lib-vfx.js:13` (two new states, outside `statusRank`'s linear
order) plus a small change log. Small.

### 7. A real previz/layout export path — MED

The pieces are all present and unconnected:

- `sets/gl.js:395-398` has a working `snapshot()` returning a PNG data URL —
  **never called by anything** (verified across the repo). The lens-accurate
  frame can already be captured and there is no button.
- `boards/lib-shots.js:37` has an `img` field per shot that feeds the animatic
  MP4 (`boards/lib-shots.js:73-87`, `boards/boards.js:220-240`).
- `boards/boards.js:46-51` accepts frames from a clip grab, an upload, or the
  local AI bridge — but not from the set's own camera.

So: add a "Send frame to board" button to `sets/index.html` next to the OBJ/STL
buttons (`:364-372`) that calls `gl3d.snapshot()` and writes it onto the
selected board shot. That is previz — a lens-accurate, measured, blocked frame
straight into the animatic — for maybe thirty lines. **This is the highest
value-per-line item in the whole report.**

Then the layout half: the camera text export described under the OBJ item.

### 8. DI handoff — MED

There is no VFX→DI path. `post/lib-post.js:31` gates QC behind grade, mix and
vfx-final in parallel, which is the right shape, but nothing carries: colour
space or working space, show LUT/CDL per shot, whether a VFX final was delivered
graded or ungraded, or a per-shot conform status. `tools/lib-media.js:14-56`
parses and applies `.cube` LUTs already; `tools/tools-media-ui.js:258-266`
previews them. Nothing associates a LUT with a shot or a show.

Attach the LUT/colour-space fields to the VFX shot and surface a
"VFX → DI handoff" list in `post/`. Medium.

### 9. VFX is invisible to the pipeline — LOW but cheap

`workflow/workflow.js:35-165` builds seven stages — develop, breakdown, budget,
schedule, generate, review, deliver. There is no VFX stage, and the VFX board is
never read. `workflow/advisor.js:129` knows a VFX supervisor is needed on set,
which is the only acknowledgement anywhere. Adding a VFX stage that reads
`SB_VfxBoard_v1` and reports `n shots · n awarded · n final · n approved` is
under an hour and puts VFX on the same wall as everything else.

---

## Evidence

Files read in full: `vfx/lib-vfx.js` (220 lines), `vfx/index.html` (274),
`post/lib-post.js` (264), `production/lib-prod.js` (182), `boards/lib-shots.js`
(123), `sets/lib-set3d.js` (456), `scripts/test_vfx.mjs` (118),
`docs/audit/BRIEF.md`.

Files read in part, with the lines cited above verified directly:
`production/production.js:1-280`, `production/index.html:69-81`,
`boards/boards.js` (numbering, frame sources, animatic),
`editor/lib-cut.js:1-300`, `editor/cut-ui.js:900-935`,
`sets/lib-set.js:14-110`, `sets/gl.js:98-200,385-410`,
`sets/index.html:55-100,148-206,340-392`, `tools/lib-media.js:57-90`,
`dailies/lib-dailies.js:15-155`, `finance/lib-money.js:20-85`,
`js/budget-engine.js:130-160,510-530,690-710`,
`timeline/timeline-budget.js:280-292,700-725`,
`producer/budget-sheet.js:20-50`, `producer/schedule-board.js:30-110`,
`projects/lib-vault.js:14-40`, `workflow/workflow.js:35-175`,
`workflow/advisor.js:129`.

Claims verified by execution, not by reading:

1. **A-scene bug.** Ran `V.splitScenes` on a three-scene sample containing
   `14A INT. VAULT - DAY`. Result: 2 scenes; the A-scene's body — including its
   explosion cue — was appended to scene 1 and `detectShots` attributed the
   explosion to scene 1.
2. **Sensor mismatch.** `CSet.fovDeg(35)` = 54.4°; `CSet3D.lensFov(35, false)`
   = 39.1°. At 24 mm: 73.7° vs 54.8°.
3. **Sky false positives.** Three prose mentions of "sky" in three scenes →
   three suggested shots, planning range $1,500–$4,500.
4. **Baseline health.** `node scripts/run_all_tests.mjs` → 44/44 suites passed,
   `test_vfx: 47 passed, 0 failed`.
5. **Store isolation.** Repo-wide grep for `SB_VfxBoard_v1` and `SB_VfxShots_v1`
   returns exactly one reference each — `vfx/index.html:110` and
   `production/production.js:243`. No other module reads either.
6. **`snapshot()` is dead code.** Repo-wide grep for `snapshot` outside
   `projects/lib-vault.js` (an unrelated function of the same name) returns only
   the definition at `sets/gl.js:395`.

No file was edited. This phase was read-only.
