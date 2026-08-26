# Director of Photography

Read as the person responsible for the image: camera and lens packages, format
and sensor, coverage, exposure, colour pipeline, frame rate, tests, shot lists
and lighting plots.

Short answer to the two questions in my brief:

- **Is the lens maths correct?** The *formula* is correct in all three places it
  is implemented. The *sensor* is not agreed on, and the look-through does not
  respect any capture aspect ratio, so the answers disagree with each other and
  one of them changes when you resize the browser.
- **Could a DP plan a day from this?** Partly. Sun times, weather risk, a set
  plan, a shot list and a take log all genuinely exist. But the sun times are
  printed in the *viewer's* timezone, the sun has no azimuth, the lights you
  place on the plan light nothing, and there is no depth of field, no exposure
  maths, no format, and no lighting order. So: a shape of a day, not a day.

---

## What exists and works

- `sets/lib-set3d.js:376-380` — `lensFov()` is textbook correct:
  `2·atan(dim / 2f)`, in degrees, with a sane fallback to 35mm. The Super 35
  constants at `:373-374` (24.89 × 18.66 mm) are the correct ANSI full/silent
  aperture figures, and they are *named and commented*, which is more than most
  previz tools manage.
- `sets/lib-set3d.js:382-393` — `cameraView()` gets the facing convention right
  (`sin r`, `−cos r`), matching the 2D cone drawn toward −y at `lib-set.js:95-97`.
  That sign is the classic "3D view is a mirror of the plan" bug and it is
  actually pinned by a test at `scripts/test_set3d.mjs:150-153` that says so in
  as many words. Good engineering.
- `sets/lib-set3d.js:88-118` — `perspective()` and `lookAt()` are correct
  column-major GL matrices (verified term by term: `f = 1/tan(fovY/2)`,
  `(far+near)/(near−far)`, `2·far·near/(near−far)`), with the straight-down
  degenerate-basis case guarded at `:110-112`.
- `sets/gl.js:172-200` — `cameraLines()` draws a real wireframe frustum for
  every camera on the plan, with the correct basis and the correct half-angle
  conversion (`deg · π/360`). Seeing four cameras' coverage at once on the plan
  is a genuinely useful previz feature.
- `sets/lib-set3d.js:323-366` — Möller–Trumbore ray/triangle and `screenRay`,
  both degenerate-guarded and tested (`test_set3d.mjs:161-175`). Clicking in 3D
  selects what the 2D plan would.
- `tools/lib-media.js:59-84` — `lensCalc()` is the best optics in the platform:
  nine real formats including ARRI LF and 65, RED V-RAPTOR VV, Super 16 and MFT,
  returning HFOV, VFOV, frame width/height at subject distance, and the
  full-frame equivalent focal. `tools/tools-media-ui.js:218-256` gives it a
  top-down frustum diagram. This is the thing a DP would actually reach for.
- `tools/lib-media.js:15-56` — a real IRIDAS/Adobe `.cube` 3D LUT parser and
  trilinear sampler, red varying fastest per spec, rejecting 1D LUTs (`:23`) and
  truncated files (`:29`). `tools-media-ui.js:258-310` loads a still and a cube
  and previews the look with an intensity blend, entirely client-side.
- `tools/lib-sun.js:11-62` — genuine NOAA/Meeus solar equations, not a
  day-of-year approximation: eccentricity correction, equation of time
  (`:41`), civil dawn/dusk at −6°, official sunrise at −0.833°, golden hour at
  +6°. Verified against LA solstice in `scripts/test_tools.mjs:21-32`.
- `tools/sched-weather.js:93-156` — every shoot day on the stripboard gets
  its date, sunrise, both golden hours, sunset, daylight hours, a live
  Open-Meteo forecast and a blended shoot-risk score. Real day-planning value,
  keyless, fetched in the browser.
- `dailies/lib-dailies.js:33-101` — slate arithmetic done properly: bijective
  base-26 so 12Z rolls to 12AA (`:45-50`), `nextSlate` vs `nextSetup` as
  separate operations (`:59-78`), and a sort that orders by day → scene →
  setup letter → take. `:154-200` emits the classic camera and sound report
  text. This is a real on-set logger, and the honest footnote at
  `dailies/index.html:117` ("your on-set log, not the deliverable of record")
  is exactly the right posture.
- `sets/index.html:61-64` + `lib-set3d.js:399-439` — the plan exports as SVG,
  OBJ, STL and PNG, with the export name slugged (`:442`) so a newline in a set
  name cannot inject geometry. Handing the set to the art department works.
- `sets/lib-set3d.js:304-317` — `hexToRgb` checks content before length, with a
  comment explaining the 8-character-NaN bug that used to make items invisible.
  Fixed and documented.

---

## What exists but needs work

### HIGH — three different sensors for the same camera item
`sets/lib-set.js:79-83` computes the plan's camera cone as
`2·atan(18/f)` — a **full-frame 36 mm** sensor, and the comment says so.
`sets/lib-set3d.js:373-380` computes the 3D frustum and look-through from
**Super 35** 24.89 mm. `tools/lib-media.js:59-69` has a **third** table of nine
formats. All three read the same `it.lens` number.

Concretely, for the same camera at 35mm:

| | source | horizontal FOV |
|---|---|---|
| readout in the UI | `sets/index.html:206` via `CSet.fovDeg` | **54.4°** |
| wireframe frustum + look-through | `CSet3D.lensFov` | **39.2°** |

Both numbers are *locked in by passing tests*: `scripts/test_set.mjs:39` asserts
`fovDeg(35) ≈ 54.4`, `scripts/test_set3d.mjs:136` asserts the Super 35 value.
The suite enforces the contradiction.

Why it matters: the plan's dashed cone is what a DP eyeballs to decide whether
a 35 holds the room. It is 15° too wide. Then the 3D view of the same camera
disagrees with it, and the caption disagrees with both.

**Change:** delete `CSet.fovDeg`. Put a `sensor` key on the plan document,
default `'super35'`, resolved against `TMedia.SENSORS`. Have `CSet3D.lensFov`
take the sensor, and have `CSet.itemSVG` draw the cone from the same call.
Print the format in the readout: `35mm · Super 35 · 39.2° H`.

### HIGH — the look-through's coverage is whatever size the browser window is
`sets/gl.js:255` calls `S3.perspective(fovY(), canvas.width / canvas.height, …)`.
`fovY()` (`:135-141` → `lib-set3d.js:392`) is the vertical FOV of the **1.33:1**
full aperture. The horizontal FOV therefore comes out as
`2·atan(tan(fovY/2) · panelAspect)`:

| panel shape | 35mm look-through shows | truth on S35 |
|---|---|---|
| 4:3 | 39.1° | 39.2° |
| 16:9 (typical) | **50.7°** | 39.2° |
| 21:9 (wide monitor) | **63.8°** | 39.2° |

The canvas is `width:100%;height:100%` in a flex panel
(`sets/index.html:82-83`), so it is never 4:3 in practice. **Drag the window
wider and the 35mm sees more of the room.** For the one feature the file's own
comment calls "the reason to build this at all" (`lib-set3d.js:368-372`), that
is fatal — a DP cannot judge coverage from it.

**Change:** `cameraView()` should return the format's aspect alongside `fovY`.
`gl.js` should render into a letterboxed/pillarboxed rectangle of that aspect
inside the canvas, with the unused area masked. That fixes the maths *and*
gives you the frame line for free.

### HIGH — no aspect ratio, no framing chart, no safe areas, anywhere
A repo-wide search for `2.39`, `1.85`, `safe area`, `title safe`, `action safe`,
`desqueeze` and `squeeze factor` returns exactly one hit, and it is
`env(safe-area-inset-bottom)` CSS on a phone (`dailies/index.html:51`). The
only "aspect ratio" in the platform is generative output size
(`app.html:453-458`, `1024x768` etc.).

`boards/boards.js:109-111` and `:131-135` hard-code every storyboard frame to
**480×270 — 16:9 only**, reinforced by `boards/boards.css:22`
(`aspect-ratio:16/9`). An uploaded 2.39:1 frame is centre-*cropped* (`:134` uses
`Math.max` = cover), so its sides are thrown away; a grabbed frame from a
non-16:9 clip is *stretched* (`:111` draws with no aspect preservation).

`app.html:2071` offers `'Anamorphic 2x'` and `'Anamorphic 1.33x'` as lens
choices — but nothing in the platform knows what a 2× squeeze does to a field
of view.

**Change:** a project-level format record (below, under Missing), then matte the
`sets` look-through to it, shape `boards` frames to it, and derive the
generative aspect from it instead of the other way round.

### HIGH — sun times are printed in the viewer's timezone, not the location's
`tools/lib-sun.js:64-69` — `fmtLocal(ms, tzOffsetMin)` falls back to
`-new Date(ms).getTimezoneOffset()` when no offset is passed. Neither caller
passes one:

- `tools/sched-weather.js:147-148` — all four sun columns
- `production/production.js:151-152` — sunrise / golden PM / sunset

Verified by running the library: LA sunset on 2026-08-26 is **19:28** local.
`fmtLocal(t.sunset)` renders **02:28** on a UTC machine, and would render
22:28 in Toronto.

`sched-weather.js:23-30` ships a city picker with 12 cities spanning ~19 hours
of offset — Los Angeles to Sydney — so **planning a remote location is the
designed use case and it is exactly the broken one**. The footnote at `:154`
then claims "Sun times computed locally (±2 min)", which asserts a precision
the display destroys.

**Change:** carry a `tzOffsetMin` (or IANA zone) on the location/city record and
pass it through every `fmtLocal` call. `CITIES` needs a fourth element.

### HIGH — the sun has no azimuth and no altitude
`tools/lib-sun.js:51-62` returns six timestamps and nothing else. The
questions that actually shape a DP's day are all directional:

- which wall does the key fall on at 09:00?
- when does the actor go backlit walking north up this street?
- when does the sun clear that building, and when does the ridge eat it?

None can be answered. And the maths is already 90% there — `crossing()`
computes the declination at `:40` and the hour angle at `:42`. Solar altitude
and azimuth from declination, hour angle and latitude is roughly fifteen more
lines in the same file.

**Change:** add `sunPosition(dateMs, lat, lon) → {altitude, azimuth}` to `TSun`.
Then: a sun-path arc across the `sets` 2D plan, and a real sun vector fed into
the GL shader in place of the hard-coded key.

### HIGH — the lights you place on the plan light nothing
You can drop `light` items on a set (`sets/lib-set.js:29`,
`lib-set3d.js:50`), give them a position, a rotation and a height. The 3D
renderer ignores every one of them: `sets/gl.js:50-51` hard-codes the key and
fill as GLSL constants —

```glsl
vec3 key  = normalize(vec3(-0.4, 0.85, 0.35));
vec3 fill = normalize(vec3(0.6, 0.35, -0.6));
```

— and `lightQuads` (`lib-set3d.js:229-232`) builds a box on a stick that emits
nothing. In 2D the light's cone is a fixed 40° wedge (`lib-set.js:101`,
`lh = 20°` half-angle) at a fixed 9 ft throw, identical for every fixture, with
no wattage, no beam angle, no colour temperature and no trim height.

So the question a DP opens a 3D set for — *does my key clear the sofa and reach
the actor's eyes* — cannot be asked.

**Change:** at minimum, feed each `light` item's world position and facing into
the fragment shader as a point/spot with the item's beam angle. That is a real
but bounded piece of work and it converts the whole module from a floor plan
into a lighting tool.

### MED — the take log cannot record what the DP (and VFX) need
`dailies/lib-dailies.js:81-92` stores: day, scene, slate, take, camera, circled,
NG reason, notes, sound roll, **lens (free text)**, TC in. That is it.

Missing: camera roll / magazine / card ID, T-stop, filtration and ND, frame
rate, shutter angle, white balance, lens height, TC out.

Two concrete consequences:

1. `vfx/lib-vfx.js:147` puts *"Lens & camera data — focal, T-stop, lens height,
   tilt, FPS, filtration"* on the plate checklist for every VFX shot. The only
   on-set logger in the platform can capture **none of those six fields**.
2. There is a `soundRoll` but **no camera roll**. `tools/lib-media.js:88-127`
   builds an MHL-style hash manifest of the offloaded media. Nothing joins a
   logged take to the file it lives in. With no roll ID, the camera report and
   the DIT's manifest cannot be reconciled — which is the entire purpose of a
   camera report.

Also a data-loss bug, not just a gap: `:88` is
`camera: cam === 'B' ? 'B' : 'A'`. A C-camera or an X-camera take is silently
recorded as A-cam. `dailies/index.html:82-84` offers only the two.

**Change:** widen `makeTake` with `roll`, `stop`, `filter`, `fps`, `shutter`,
`wb`, `tcOut`, and make `camera` a free letter validated as `[A-Z]`. Add the
columns to `cameraReport` (`:161-168`). No stored key changes; new optional
fields only.

### MED — the LUT preview ignores the LUT's own domain and has no colour space
`tools/lib-media.js:24-25` parses `DOMAIN_MIN` and `DOMAIN_MAX` and returns them
on the LUT object. `sampleLut` (`:34-46`) **never reads either** — it clamps
r/g/b to 0–1 at `:36-37` and indexes straight in. Any LUT authored with a
domain other than 0–1 (common for log or linear-input LUTs) samples wrong, with
no warning. No test covers it: `scripts/test_tools.mjs:118-130` exercises an
identity cube only.

Separately, there is no notion of colour space anywhere in the platform (repo
search: no `Rec.709`, no `LogC`, no `S-Log`, no `ACES`, no `ASC CDL`). The still
loaded at `tools-media-ui.js:263-264` is a display-referred JPEG, and
`applyLutToPixels` (`lib-media.js:49-55`) applies the cube straight to
`px/255`. Feeding it a LogC→709 show LUT — the most common thing a DP owns —
double-transforms and shows a wrong look.

**Change:** honour `domMin`/`domMax` in `sampleLut` (a two-line remap before the
clamp) and add a test with a non-unit domain. Then add an input-transform
selector so the preview can state what it thinks the still is.

### MED — the set camera cannot tilt, and lens height is an implicit subtraction
`sets/lib-set3d.js:391` puts the look-at target at the **same height as the
eye**: `target = [eye[0] + sin(r)·10, h, eye[2] − cos(r)·10]`. Every camera in
the 3D view is dead level. No tilt, no high or low angle, no dutch.

Meanwhile `boards/lib-shots.js:14` offers `High`, `Low`, `Overhead`, `Ground`
and `Dutch` as shot angles the 3D view can never show.

Lens height is `heightOf(item) − 0.5` (`:383`), so a DP wanting an 18-inch low
angle has to work out that they should type `2.0` into a field labelled
"Height ft" (`sets/index.html:158`).

**Change:** add `tilt` (and optionally `roll`) to the camera item and a `lensH`
field that means what it says. `cameraLines` in `gl.js:181` will need the
vertical-facing guard that `screenRay` already has at `lib-set3d.js:357-358`.

### MED — three unconnected records of the same lens
The same creative decision is stored three times, in three stores, with no join:

| where | key | field |
|---|---|---|
| set plan camera | `SB_SetDesign_v1` (`sets/index.html:110`) | `item.lens` (number) |
| shot list row | `SB_Boards_v1` (`boards/boards.js:10`) | `shot.lensMm` (number) |
| logged take | `SB_Dailies_v1` (`dailies/index.html:142`) | `take.lens` (string) |

So you cannot say "shot 4A is *this* camera position on *this* plan, and here
is what we actually shot it on." Cross-module reads are already the house
pattern — `props/index.html:219` reads `SB_SetDesign_v1` directly.

**Change:** add an optional `camId` (plan id + item id) to the boards shot and
to the dailies take. Then the shot list can render the look-through frame, and
the camera report can show planned-vs-actual lens.

### MED — two incompatible shot vocabularies
`boards/lib-shots.js:13-15`: `EWS WS MS MCU CU ECU OTS POV INSERT` /
`Eye level, High, Low, Dutch, Overhead, Ground`.
`app.html:4850-4854`: `Extreme Wide, Wide, Medium Wide, Medium, Medium Close,
Close-Up, Extreme Close-Up, Over-the-Shoulder, Two-Shot, Insert` /
`Eye Level, High Angle, Low Angle, Dutch Angle, Birds Eye, Worms Eye,
Over-the-Shoulder`.

Nothing converts between them. The consequence is that the Studio's per-shot
cinematography record at `app.html:2071` — which carries **lens, colour
temperature, contrast, depth of field, exposure, grain, distortion** and is
stored per shot via `mhUpdateCine` — never reaches the shot-list CSV
(`boards/lib-shots.js:90-98`) or the camera report. The richest look metadata in
the platform is trapped in a prompt string (`app.html:6234-6242` joins it into
`"Cinematography: …"` and sends it to an image model).

**Change:** one `SIZES`/`ANGLES` table in `lib-shots.js`, imported by both, with
a display-label map for the long forms. Then let `CINE` fields ride on the
boards shot record.

### LOW — `CSetGL.snapshot()` is dead code, and it is the missing bridge
`sets/gl.js:395-398` renders a frame and returns a PNG data URL. Nothing in the
repo calls it. `boards/boards.js:101-106` (`setShotImg`) accepts exactly a data
URL.

**Change:** wire "look through camera A → save as the frame for shot 4A". Two
functions that already exist, roughly twenty lines of glue, and the 3D set
becomes a previz storyboard generator. Highest value-per-line in this report.

### LOW — high-latitude sun output is confidently wrong-shaped
Verified by running `TSun.sunTimes('2026-06-21', 69.65, 18.96)` (Tromsø): dawn,
sunrise, sunset and dusk all return the **same instant**, 22:47. A DP reading
the schedule table sees an ordinary-looking sunrise/sunset pair for a day on
which the sun never sets, and would plan a night exterior that will never
happen. `hourAngle` (`lib-sun.js:26-27`) already detects the case; the return
shape just has no way to say so.

Note the good behaviour already exists — in the *other*, worse sun
implementation: `locations/lib-scout.js:492-495` returns an explicit
`polar: 'midnight sun — sun never sets this date'`.

**Change:** have `sunTimes` return a `polar` flag alongside the timestamps and
have the renderers show it instead of a time.

### LOW — two sun implementations, and the scouting module uses the worse one
`locations/lib-scout.js:480-505` is Cooper's declination formula with **no
longitude, no equation of time and no timezone**, and it admits it —
`locations/index.html:107` says "no timezone, longitude, or DST correction …
treat them as planning shape, not clock truth."

`TSun` is better on every axis. Locations is where a DP actually scouts.

**Change:** point `locations/index.html:348` at `TSun.sunTimes` (the file
already loads in a page that could include `lib-sun.js`), add a longitude field
next to the existing latitude input at `locations/index.html:101`, and delete
`goldenHour`. Keep the honest disclaimer, fix the number underneath it.

---

## What is missing entirely

### 1. Depth-of-field and hyperfocal calculator — value: HIGH, cost: small
Nothing in the repo computes depth of field. The only "dof" is a list of prompt
strings at `app.html:2071` (`'Shallow f/1.4'`, `'Deep f/8'`) fed to an image
model. There is no circle of confusion, no near/far limit, no hyperfocal.

A DP needs this hourly: *can I hold both actors at T2.8 on a 40, or do I need
the split diopter?* And a 1st AC needs the number before the setup, not after.

**Attach to:** `tools`, as a panel beside Lens & Coverage — it already has the
sensor table (`lib-media.js:59-69`) that DOF needs. Then surface the near and
far planes as shaded bands inside the `sets` 3D frustum
(`gl.js:172-200` already draws the geometry to hang them on).

**Cost:** ~40 lines of pure maths in `lib-media.js` plus a tab and tests. CoC
per format is one more column in `SENSORS`.

### 2. Exposure / ND / lighting-level calculator — value: HIGH, cost: small
No f-stop ↔ ISO ↔ shutter angle ↔ fps relationship anywhere, no ND factors, no
footcandles or lux. This is what tells the gaffer how big a unit to order, and
it is the reason a 96 fps insert needs two more stops than the master.

**Attach to:** `tools`, next to the DOF panel. **Cost:** small — the maths is a
handful of log-2 relationships.

### 3. Project format record: sensor, resolution, aspect, squeeze — value: HIGH, cost: medium
One record the whole platform reads: capture sensor mode, recording resolution,
capture aspect, delivery aspect, anamorphic squeeze factor.

Today: nine formats in `tools`, one hard-coded Super 35 in `sets/lib-set3d.js`,
a different hard-coded full frame in `sets/lib-set.js`, and 16:9 hard-coded in
`boards`. A production shooting 2.39 anamorphic cannot express that fact
anywhere, and its storyboards come out the wrong shape.

**Attach to:** the project record (`projects`), read by `sets` (matte the
look-through), `boards` (shape the frames), `tools` (default the calculators)
and the Studio (derive generation aspect).

**Cost:** medium. The maths is trivial; it touches four modules and needs a
migration default of Super 35 / 16:9 so existing owner data keeps working.

### 4. Lighting plot: fixture library, beam geometry, power draw — value: HIGH, cost: large
The largest genuinely-absent DP deliverable. A repo-wide search finds no
fixture, no wattage, no amperage, no gel, no colour temperature on a light, no
generator.

What is needed: a `light` item that carries a fixture (2K Fresnel, M18, S60,
4-bank Kino, 1×1 LED panel), a beam angle, a throw distance, a colour
temperature, a wattage and a trim height; printed symbols on the plan; and a
per-plan total that sums amperage per leg and warns when you have outrun the
house tie-in or the generator.

Without it, the gaffer cannot be handed anything, the electrical order cannot
be built, and `js/budget-engine.js:680`'s "8000 · Grip & electric" line has
nothing underneath it.

**Attach to:** `sets` — it already owns the item, the plan, the SVG renderer,
the 3D scene and the export path. **Cost:** large, but decomposable: the fixture
table plus the amperage sum alone would be worth shipping on its own, before any
beam rendering.

### 5. Sun path drawn on the location and set plan — value: HIGH, cost: small
Given `sunPosition()` from the HIGH item above: draw the day's sun arc across
the `sets` 2D plan, with a scrubber, and shade which flats and which side of the
actor the light falls on at the chosen hour. This is how an exterior day
actually gets planned, and it is the difference between "sunset is at 19:28" and
"we lose the east wall at 15:40, so shoot the reverse first."

**Attach to:** `sets` (2D plan overlay) and `locations` (per-location).
**Cost:** small once the azimuth exists — it is one SVG arc and a slider.

### 6. Camera test log — value: MED, cost: small
No camera test, lens test, grey card, colour chart or Macbeth reference exists
anywhere in the repo. A DP's prep week produces a signed-off record: lens by
lens with serial numbers, focus witness, breathing, flare, close focus and
colour match across the set; chart references; and the show LUT that was
approved, dated, and attached to the project.

Without it there is no defence when a lens goes soft in week three, and the
show LUT lives in someone's email.

**Attach to:** `dailies` or `production` — both already have register tables and
image handling. **Cost:** small — a register plus stills plus a `.cube`
attachment, all of which have working precedents in the codebase.

### 7. Camera and lighting package list — value: MED, cost: medium
`js/budget-engine.js:678-680` derives "6000 · Camera" and "8000 · Grip &
electric" as flat 45% / 50% splits of a single lump equipment tier
(`:129`: *"Pro package (cine camera + G&E truck)"*, £9k–30k/week).

There is no itemised body / lens set / support / filtration / G&E list, so
nothing can be quoted, ordered, checked in on prep day, or reconciled against
the budget line when the truck arrives.

**Attach to:** `producer`, feeding the existing top-sheet lines.
**Cost:** medium — a register per department plus a roll-up into the budget.

### 8. Frame rate and shutter as project properties — value: MED, cost: small
Frame rate exists only in the Editor: `editor/index.html:97` offers **24 or 30
and nothing else** — no 23.976, no 25, no 29.97, no 48, no high speed — and
`editor/lib-cut.js:131-138` computes timecode with integer fps only, so
drop-frame is not representable.

Nowhere can a DP say "this show is 23.976" or "shot 14C is a 96 fps ramp at a
45° shutter". That number drives the lighting order (flicker-free ballasts,
LED refresh rate) and the stop.

**Attach to:** the project format record (#3) plus a per-shot override on the
boards row. **Cost:** small.

### 9. A DP-facing day view — value: MED, cost: medium
Nothing in the platform assembles the DP's morning: today's scenes → the set
plans they shoot on → the camera setups marked on those plans → lens and stop
per setup → where the sun is at those hours → the lighting order for the day.

Every one of those parts exists, in five different modules, joined by nothing.

**Attach to:** `today` or `workflow` — both are already cross-module aggregators.
**Cost:** medium, and it drops to small once #3 (format), #5 (sun path) and the
`camId` join land.

### 10. Eyeline and the 180° line — value: LOW-MED, cost: small
`sets` knows every camera's position and facing (`lib-set3d.js:382-393`) and
every blocking mark (`lib-set.js:27`). Nothing checks whether two setups on the
same two actors sit on opposite sides of the axis between them. That check is
one cross product per camera pair.

Cheap, and it catches a continuity mistake that costs a reshoot.

**Attach to:** `sets`, as a warning badge on the plan. **Cost:** small.

---

## Evidence

Files read in full: `sets/lib-set3d.js` (456 lines), `sets/gl.js` (407),
`sets/lib-set.js` (153), `boards/lib-shots.js` (123), `tools/lib-sun.js` (102),
`tools/lib-media.js` (137), `dailies/lib-dailies.js` (233).

Files read in part: `sets/index.html:130-250, 61-85, 347-385`,
`tools/sched-weather.js:1-60, 85-159`, `tools/tools-media-ui.js:216-266`,
`boards/boards.js:45-155, 360-375`, `dailies/index.html:82-117, 180-240`,
`production/production.js:140-155`, `locations/lib-scout.js:480-505`,
`locations/index.html:99-110, 344-360`, `vfx/lib-vfx.js:135-165`,
`js/budget-engine.js` (grep, lines 129, 678-680),
`app.html:448-470, 2071, 4505-4520, 4850-4870, 6228-6250`,
`editor/index.html:97`, `editor/lib-cut.js:130-170`,
`scripts/test_set.mjs:30-50`, `scripts/test_set3d.mjs:100-175`,
`scripts/test_tools.mjs:20-140`, `boards/boards.css:22`.

Claims verified by execution, not by reading:

- `node -e` against `tools/lib-sun.js`: LA sunset 2026-08-26 is `19:28` local
  (`fmtLocal(ms, -420)`), and `fmtLocal(ms)` with no offset returns `02:28` on
  a UTC machine. Confirms the timezone finding.
- Same, Tromsø (69.65 N) on 2026-06-21: `dawn`, `sunrise`, `sunset` and `dusk`
  all return the identical instant. Confirms the polar finding.
- FOV arithmetic checked by hand against both constants: full frame
  `2·atan(18/35) = 54.43°`; Super 35 `2·atan(24.89/70) = 39.16°`; look-through
  at 16:9 `2·atan(tan(14.93°)·1.778) = 50.70°`, at 21:9 `63.75°`, at 4:3
  `39.14°`.
- `perspective()` and `multiply()` in `lib-set3d.js:78-95` verified term by term
  against the standard column-major GL forms. Both correct.
- `node scripts/run_all_tests.mjs`: **44/44 suites pass**. (One of four runs
  reported 43/44 with no named failure, and it did not reproduce across three
  further runs — most likely a timing-sensitive suite under load rather than a
  real regression. Flagging it only as an observation; I did not chase it, and
  it is outside this brief.)

Searches run whose *absence* of results is the finding (all excluding
`node_modules`, `static/vendor`, `private/`, minified files):

- `hyperfocal | circle of confusion | depth of field | f-stop | t-stop |
  aperture | ND | footcandle | lux | exposure | shutter angle` — no
  calculations, only the prompt strings at `app.html:2071`.
- `2.39 | 1.85:1 | safe area | title safe | action safe | framing chart |
  desqueeze | squeeze factor` — one hit,
  `dailies/index.html:51` (`env(safe-area-inset-bottom)` CSS).
- `fixture | HMI | Fresnel | SkyPanel | Kino | wattage | kW | amps | power draw
  | generator | gel | CTB | CTO | diffusion | lighting plot` — no matches
  outside false positives.
- `camera test | lens test | grey card | Macbeth | colour chart | camera prep |
  gear list` — no matches.
- `Rec.709 | LogC | S-Log | ACES | colour space | ASC CDL` — no matches; the
  only colour-pipeline code is the `.cube` LUT in `tools/lib-media.js`.
- `snapshot` — `CSetGL.snapshot` (`gl.js:395`) has no callers; the only other
  hits are `projects/lib-vault.js`, an unrelated function of the same name.

No file was edited. This report is the only file written.
