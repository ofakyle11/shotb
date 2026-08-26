# Team A Dev 14 — missing: camera, lighting and technical prep

Domain: DP / gaffer / camera-department prep. Everything below was grepped for
before it was called missing; the search and its result are stated inline.

Search scope for every `rg` quoted here:
`--glob '!node_modules' --glob '!docs/**' --glob '!*.zip' --glob '!static/vendor/**'`.

Baseline: `node scripts/run_all_tests.mjs` → **44/44 suites passed** (unmodified tree).

---

## What exists and works

- `tools/lib-media.js:59-69` — `SENSORS`: nine real formats (Super 35, S35 17:9,
  full frame, ARRI LF, ARRI 65, RED V-RAPTOR VV, MFT, Super 16, phone), each with
  true aperture dimensions in mm. **"Sensor presets beyond Super 35" is not a
  gap — it already exists here.**
- `tools/lib-media.js:70-84` — `fov()`, `coverage()`, `lensCalc()`: correct
  thin-lens trigonometry giving HFOV, VFOV, frame width/height at a distance, and
  full-frame-equivalent focal length. Surfaced as a real UI at
  `tools/tools-media-ui.js:218-256` ("Lens & Coverage" tab, `tools/index.html:55`).
- `tools/lib-media.js:15-56` — `.cube` 3D LUT parser (TITLE / LUT_3D_SIZE /
  DOMAIN_MIN / DOMAIN_MAX), trilinear `sampleLut()` with the spec's red-varies-
  fastest indexing at `:41`, and in-place pixel apply. It explicitly rejects 1D
  LUTs at `:23` rather than silently mis-reading them. Live preview with an
  intensity blend at `tools/tools-media-ui.js:258-310`. This is genuine, correct
  colour code — do not rebuild it.
- `tools/lib-sun.js:33-62` — NOAA/Meeus solar position: civil dawn, sunrise,
  end of morning golden hour, start of evening golden hour, sunset, civil dusk.
  `hourAngle()` at `:24-29` correctly distinguishes "sun never sets" (returns π)
  from "sun never rises to this altitude" (NaN), which most naive implementations
  get wrong. Plus keyless Open-Meteo weather (`:77-81`) and a shoot-risk score
  (`:92-98`).
- `sets/lib-set3d.js:368-393` — `lensFov()` / `cameraView()`: a camera item on a
  set plan carries a real focal length and the 3D viewport renders exactly what
  that lens sees from that mark, with the plan-rotation-to-world-facing sign
  convention documented at `:386-389`. Driven by `sets/gl.js:135-141`, with a
  wireframe frustum for every camera on the plan at `sets/gl.js:172-199`. This is
  the standout feature in my domain and it is well built.
- `dailies/lib-dailies.js:154-178` — per-day `cameraReport()` text export
  (scene / slate / take / cam / lens / TC-in / circled), and
  `production/production.js:181-193` — a Camera Report register under
  `SB_CameraReports_v1` with date / roll / scene / lens / stop / filter / notes.
  **Camera reports exist.** (What is missing is the *prep* log — see below.)
- `tools/lib-media.js:88-127` — MHL-style media hash manifest with per-file
  SHA-256 and a `verifyAgainst()` returning ok / changed / missing / extra. That
  is real DIT-grade offload verification.
- `safety/lib-safety.js:74-79` and `:80-86` — electrical/generator and
  drone/aerial hazard entries with named personnel and controls (GFCI on
  distribution near water, flight plan filed, spotter separate from operator).
  Honest and useful as far as it goes.

---

## What exists but needs work

- **HIGH — `sets/lib-set.js:80-83` vs `sets/lib-set3d.js:373-374`: the same lens
  number means two different sensors in the same module.** `CSet.fovDeg()` is
  hardcoded to full frame (`2*atan(18/f)`); `CSet3D` hardcodes Super 35
  (`SENSOR_W = 24.89`, `SENSOR_H = 18.66`). Neither reads `TMedia.SENSORS`, which
  already exists. On the shipped sample plan the A-cam is a 32mm
  (`projects/sample.cinamate.json`, item `cam1`, `"lens":32`): the 2D plan draws a
  **58.7°** cone, the 3D through-lens view frames **42.5°** horizontally — a 38%
  disagreement. Worse, `sets/index.html:206` prints `S.fovDeg(lens)` — the
  *full-frame* number — as the caption underneath the *Super 35* image, and
  `sets/index.html:97` tells the user the cones are full-frame. A DP choosing a
  lens off this plan will order the wrong lens. **Change:** add `plan.format` (or
  `item.sensor`) sourced from `TMedia.SENSORS`, give both `CSet.fovDeg(lensMm,
  sensorW)` and `CSet3D.lensFov(lensMm, vertical, sensor)` optional sensor
  arguments defaulting to today's values so no stored plan changes meaning, and
  make the caption read from the same source as the render. Additive to
  `SB_SetDesign_v1`; no key renamed. Half a day.

- **HIGH — `sets/gl.js:255`: the "look through the lens" view has no frame.**
  The projection is built as `S3.perspective(fovY(), canvas.width/canvas.height,
  ...)`, so the vertical FOV is the lens's but the horizontal extent is whatever
  shape the browser window happens to be. `rg -i "letterbox|mask|guide|frameline|
  crop" sets/gl.js sets/index.html` → **0 hits**. There is no format mask, no
  frameline, no safe area. The one thing this view exists to answer — "does the
  frame hold both of them" — cannot be answered, because the frame shown is the
  window's, not the camera's. **Change:** letterbox the viewport to the chosen
  format aspect and draw action/title safe over it. Small, and it makes the
  best feature in the module trustworthy.

- **MED — `boards/lib-shots.js:36-38`: a shot has no format and no exposure.**
  `blankShot()` carries `size / angle / move / lensMm / desc / img / dur`. There is
  no aspect ratio, no sensor, no T-stop, no filter, no camera height, no frame
  rate. `toCsvRows()` at `:91` therefore exports a shot list that is silent on
  what the frame is. `boards/boards.js:109,132,158` hardcode 16:9 (480×270,
  960×540) for every board frame and AI generation. A shot list handed to a
  1st AC that cannot say "2.39, 40mm, T2.8, 48fps" is half a shot list.
  **Change:** add the fields to `blankShot()` (defaults preserve current
  behaviour), add the columns to `toCsvRows()`, and let the board frame draw at
  the project format.

- **MED — `sets/lib-set.js:29` and `:100-106`: lighting is one generic stencil
  with a fixed cone.** The stencil is `light: { label: 'Light', w: 1.4, h: 1.4,
  kind: 'light' }` — no fixture type, wattage, colour temperature, beam angle,
  gel, dimmer channel or trim height. `itemSVG()` at `:101` draws every fixture
  with the same hardcoded 20° half-angle throw (`var lh = 20 * Math.PI / 180`), so
  a 5° leko and a 90° soft box are drawn identically. The shipped sample proves
  the workaround: the wattage is typed into a free-text label,
  `{"type":"light","label":"Key 2K"}` in `projects/sample.cinamate.json`.
  Repo-wide, `rg -i "\bHMI\b|tungsten|skypanel|\bkino\b|LED panel|\bfixture\b|
  \bgel\b|\bCTB\b|\bCTO\b|kelvin"` → **0 hits in any module**. See "missing" #4.

- **LOW/MED — `tools/lib-sun.js:51-62`: sun times but no sun position.**
  `sunTimes()` returns the six crossing times; it cannot answer "where will the
  sun be at 14:20", which is the question that decides which way a set faces and
  when a wall has to move. The maths is already in the file — `declination()` at
  `:21` and `hourAngle()` at `:24` — so an `sunPosition(dateMs, lat, lon)`
  returning altitude and azimuth is maybe twenty lines. It would also let the
  set plan draw the real sun line across the floor.

---

## What is missing entirely

Ranked by what it changes for a production.

### 1. HIGH — Depth-of-field / hyperfocal calculator
**Verified absent:** `rg -i "hyperfocal"` → 0 hits. `rg -i "circle of confusion"`
→ 0 hits. `rg "f-?stop|fStop|T-?stop"` → only `vfx/lib-vfx.js`. `lensCalc()`
(`tools/lib-media.js:73`) takes sensor, focal and distance — **no aperture**. The
only "depth of field" string in the repo is an AI prompt at `app.html:4513` and a
dropdown of prompt words at `app.html:2071` (`dof:` → "Shallow f/1.4", "Deep
f/8") — vocabulary, no arithmetic.

**What it is:** near and far focus limits, total depth, hyperfocal distance, and
a two-subject solve ("what stop holds both faces in this 2-shot"), from
sensor circle-of-confusion + focal length + T-stop + subject distance.

**Why a production needs it:** it decides whether a dolly move needs a focus pull
(and therefore a second AC), whether an OTS holds both eyelines, and whether a
night exterior at T1.4 is even attemptable. It is the single most-used
calculation on a set and the platform cannot do it.

**Attach to:** `tools/lib-media.js` (extend `TMedia`), rendered into the existing
Lens & Coverage tab at `tools/tools-media-ui.js:218`, and as a HUD read-out in
the sets through-lens view.

**Data model:** add `coc` to each row of the existing `SENSORS` table
(`tools/lib-media.js:59-69`) — the standard derivation is sensor width / 1440,
which lands on the familiar 0.017mm for Super 35 and 0.025mm for full frame.
**No new `SB_` key** — this is a calculator, not a store.

**Size:** ~80 lines of pure lib, ~40 of UI, one `scripts/test_media_dof.mjs`
(the runner auto-discovers `scripts/test_*.mjs` — `scripts/run_all_tests.mjs:47-49`).
Best value-to-effort in my whole domain.

### 2. HIGH — Power and generator sizing
**Verified absent:** `rg "kilowatt|\bkW\b|\bwatt|amperage|\bdistro\b|\bstinger\b|
\bgenny\b"` → **0 hits** in any module. The nearest things are
`locations/lib-scout.js:510`, which records house power and tie-in as a
**free-text** scout note (stored raw at `:530`, `power: f.power || ''`), and
`js/budget-engine.js:680`, which books `8000 · Grip & electric` as 18% of labour
plus 50% of the equipment line. Nothing anywhere computes demand.
`safety/lib-safety.js:74-79` gives prose controls for generators but no numbers.

**What it is:** sum fixture wattage per set-up → amps per leg at 120/208/240V,
three-phase balance, generator size with headroom, cable-run voltage drop, and
fuel burn per day.

**Why a production needs it:** this is the number that decides between a
tow-plant and a putt-putt, whether the location's 100A service is enough or a
genny gets added to the budget, and it is directly a safety question — overloaded
distribution is the most common on-set electrical incident. The scout already
asks "how much power is here"; nothing asks "how much do you need".

**Attach to:** `sets` — the fixtures live on the plan — with the computed total
surfaced back into the `locations` scout sheet (next to the existing `power`
field) and into `producer`'s G&E line.

**Data model:** additive fields on `SB_SetDesign_v1` items (`item.watts`,
`item.volts`, `item.circuit`), plus a small `SB_PowerPlan_v1` for the
generator/feeder choices and the per-day fuel estimate.

**Size:** ~150 lines of pure lib plus a panel. Pairs with #4 — the fixture table
supplies the wattages.

### 3. HIGH — Exposure / ND / filter calculator
**Verified absent:** `rg -i "footcandle|foot-candle|\blux\b|lumen"` → 0 hits.
`rg -i "ND ?filter|neutral density|\bND\d"` → 0 hits. `rg -i "\bISO\b"` finds
only ISO 8601 dates, ISO/IEC 14496-12 in `editor/lib-mp4.js`, and the prompt word
"High ISO 6400" in `app.html:2071`. `app.html:2071` also carries an `exp:` list
("Over +1", "Silhouette", "Low Key") and a `temp:` list ("Daylight 5600K",
"Candlelight 1800K") — again, AI prompt tokens with no maths behind them. The
platform *speaks* cinematography fluently and cannot *compute* any of it.

**What it is:** the exposure triangle (ISO ↔ T-stop ↔ shutter angle at a given
fps), the ND strength required to hold a chosen T-stop in a measured light level,
footcandles/lux-to-stop conversion, and filter factors for ND, IR-ND and pola.

**Why a production needs it:** without it, a day exterior at T1.8 is guesswork,
and the grip truck packs the wrong ND on the one day it matters. It also fills in
the `stop` column that the Camera Report register already asks for
(`production/production.js:188`) with something defensible.

**Attach to:** the same Lens & Coverage tab (`tools/tools-media-ui.js:218`).
**Data model:** none — pure calculator, no `SB_` key.
**Size:** ~70 lines plus UI.

### 4. HIGH — Lighting plot with real fixture symbols
**Verified absent:** see the "needs work" entry above — `fixture`, `HMI`,
`tungsten`, `skypanel`, `kino`, `LED panel`, `gel`, `CTB`, `CTO` and `kelvin` are
**all zero hits** across every module. The `light` stencil
(`sets/lib-set.js:29`) is a circle with a fixed 20° cone (`:101`).

**What it is:** a fixture library — tungsten / HMI / LED families with wattage,
colour temperature, beam angle, and weight — plotted as distinguishable symbols
that draw their *real* beam spread and throw distance, with channel/circuit and
trim-height columns, printing to a lighting plot plus a fixture-count schedule
the gaffer orders from.

**Why a production needs it:** the gaffer's rental order and the generator size
both come off this one sheet. Today the plan can show *where* a light is and
nothing about *what* it is, so the plan cannot be ordered from, and the plot the
gaffer actually uses lives outside the platform.

**Attach to:** `sets/lib-set.js` — add a `FIXTURES` table beside `STENCILS`, and
a fixture branch in `itemSVG()` (`:100-106`) that draws beam angle from data
instead of the hardcoded constant. It prints through the existing `toSVG()` at
`:126` with no new export path.

**Data model:** additive fields on `SB_SetDesign_v1` items (`item.fixture`,
`item.watts`, `item.kelvin`, `item.beamDeg`, `item.gel`, `item.channel`,
`item.trim`). Nothing renamed; old plans keep rendering.

**Size:** medium. The fixture table is the real work; the drawing is a variant of
code that already exists. Must respect the brief's "never invent a number" rule —
fixture specs go in only where they are verifiable, otherwise the field stays
user-entered.

### 5. MED — Aspect ratio, safe areas and framing charts
**Verified absent:** `rg -i "safe ?area|safeArea|titleSafe|action safe"` → **0
hits**. The only aspect data in the repo is AI-generation ratios —
`js/model-config.js:6-14` and `timeline/timeline.js:20`,`:1751` — which offer
16:9 / 9:16 / 1:1 / 4:3 and **none of the cinema formats** (1.66, 1.85, 2.00,
2.39, open matte). `boards/boards.js:109,132` hardcode 480×270.

**What it is:** a project-level shooting format — capture aspect, extraction
aspect, "protect for" — plus action-safe and title-safe percentages, drawn as an
overlay on board frames and on the sets through-lens view, and printable as a
framing chart for the AC's monitor.

**Why a production needs it:** shooting 2.39 extracted from open-gate 16:9 while
every previz frame in the platform is 16:9 means the boards lie about the frame.
Safe areas matter the moment there is a broadcast or festival deliverable.

**Attach to:** project level; read by `boards` (frame draw + CSV column) and
`sets` (viewport mask, which also fixes "needs work" #2).
**Data model:** a small `SB_Format_v1` — `{ capture, extract, protect,
actionSafePct, titleSafePct }` — or a field on `SB_Projects_v1`.
**Size:** small lib (~50 lines of ratio maths), touches three UIs.

### 6. MED — Frame rate, shutter angle and flicker
**Verified absent:** `rg -i "shutter ?angle|shutterAngle"` → **0 hits**. `fps`
appears only as a delivery/export number (`boards/boards.js:221,236`,
`screening/lib-screen.js`, `editor/`, `production/lib-prod.js`) — never as a
shooting parameter.

**What it is:** shutter angle ↔ exposure time at a given fps and the 180° rule;
over/undercrank ratio and the resulting screen time (a 120fps take played at 24
runs 5× long — a fact the stripboard and the animatic both currently get wrong);
flicker-safe fps/angle pairs against 50Hz and 60Hz mains and against HMI ballast
type; roll-bar warnings for practical monitors in frame.

**Why a production needs it:** a mis-planned ramp is a re-shoot, and a flicker
mistake is invisible until dailies — by which time the location is gone.

**Attach to:** `tools` as a calculator, with the screen-time multiplier written
back onto the shot in `boards/lib-shots.js` so `totalDur()` (`:63`) stops being
wrong for high-speed shots.
**Data model:** `fps` and `shutterDeg` on the shot record; no new key.
**Size:** small.

### 7. MED — Camera and lens prep test log
**Verified:** shooting-day reports exist (`production/production.js:181-193`,
`dailies/lib-dailies.js:154-178`, key `SB_CameraReports_v1`), but
`rg -i "camera test|lens test|back ?focus|collimat|lens serial"` → **0 hits**.
There is no record of prep week.

**What it is:** the checkout sheet — lens serial numbers, back-focus /
collimation pass, breathing and distortion notes, T-stop match across the set,
body firmware version, monitor and show-LUT sign-off, filter inventory, and the
"these two lenses don't match" note that saves a grade later.

**Why a production needs it:** it is the evidence trail when a lens comes back
soft and the rental house disputes it, and it is what the DP reads on day one to
remember which lens breathes.

**Attach to:** `production` as a fourth register beside Camera and Sound. The
`TCore.Register` schema (`tools/tools-core.js:58`) makes this almost entirely
declarative — the existing Camera register at `production/production.js:181-193`
is a nine-line template.
**Data model:** `SB_CameraPrep_v1`.
**Size:** small. Mostly a schema.

### 8. MED — Colour pipeline / show LUT management
**Verified:** `.cube` parsing and preview exist (`tools/lib-media.js:15-56`,
`tools/tools-media-ui.js:258`), but `rg -i "colou?r ?space|colorSpace|\bCDL\b|
rec ?709|LogC|S-?Log|V-?Log|ACES"` → **0 real hits** — every apparent match was a
substring in an unrelated word.

**What it is:** a named show-LUT set with the capture colour space each applies
to, ASC-CDL slope/offset/power/saturation per scene, and the LUT name stamped
onto both the camera report and the dailies record.

**Why a production needs it:** dailies graded under an unrecorded LUT is the
classic reason a grade "looks wrong" three months later — nobody can reconstruct
what the DP was actually looking at on the day.

**Attach to:** the Look/LUTs tab plus `dailies`.
**Data model:** `SB_LookLuts_v1`; a `lut` field on the camera report row.
**Size:** medium. **Overlap flag:** shares ground with the colour-finishing crew
report — coordinate before building so it is not built twice.

### 9. LOW/MED — Drone and specialty-rig planning
**Verified:** the only drone handling anywhere is a script-keyword hazard rule
(`safety/lib-safety.js:80-86` — "Licensed drone operator (Part 107 / SFOC)",
"Flight plan filed; airspace checked"), a budget keyword weight
(`js/budget-engine.js:236`, mirrored at `timeline/timeline-budget.js:239`), and
an insurance dropdown option (`tools/tools-registers.js:103`). `rg -i "\bcrane\b|
\bjib\b|technocrane|scissor lift|condor"` → only `boards/lib-shots.js:15` (the
`MOVES` list) and `app.html`. There is no planning, only detection.

**What it is:** per-flight records — airspace class and authorisation reference
(LAANC in the US, RPAS/SFOC in Canada), operator certificate number and expiry,
battery count against shot count and hover time, wind and temperature stop
conditions — and the equivalent for crane/technocrane/car rig: reach, counterweight,
lift capacity, and ground bearing.

**Why a production needs it:** airspace authorisation is a lead-time item that
can move a shoot day, and battery maths is what decides whether the aerial unit is
a half-day or a full day.

**Attach to:** `safety` (it already names the personnel and controls) with a flag
onto the stripboard day.
**Data model:** `SB_AerialPlan_v1`.
**Size:** small-medium. Regulator references must go through the Google-search
fallback per the brief — no invented URLs or certificate numbers.

### 10. LOW — Lens projection / field chart
**Verified:** `lensCalc()` (`tools/lib-media.js:73-84`) gives coverage at one
distance; there is no chart. `rg -i "projection chart|lens chart"` → 0 hits.

**What it is:** a printable table (or graph) of frame width and height across a
distance range for the whole lens set, so the DP picks the lens off the sheet on a
tech scout instead of doing the arithmetic on a phone.

**Why a production needs it:** it is the tech-scout artefact, and it turns an
existing correct function into something a crew carries.

**Attach to:** the Lens & Coverage tab — it is a loop over `coverage()`
(`tools/lib-media.js:72`), which already exists and is already correct.
**Size:** tiny. Highest ratio of usefulness to lines written in this list.

---

## Evidence

Files read in full:
`tools/lib-media.js` (138 lines), `tools/lib-sun.js` (103), `sets/lib-set.js`
(154), `sets/lib-set3d.js` (457), `boards/lib-shots.js` (124).

Files read in part:
`sets/gl.js:110-199, 250-262`; `sets/index.html:54-97, 110, 160-230`;
`dailies/lib-dailies.js:60-190`; `production/production.js:160-219`;
`safety/lib-safety.js:70-95`; `locations/lib-scout.js:505-535`;
`js/budget-engine.js:126-129, 236, 673-680`; `tools/tools-media-ui.js:1-2,
218-310`; `tools/index.html:41-63, 106-117`; `tools/tools-registers.js:100-135`;
`tools/tools-core.js:58, 163`; `boards/boards.js:97-282`;
`timeline/timeline.js:20, 1751, 1843, 2033`; `js/model-config.js:6-14, 257-341`;
`app.html:2071, 4513`; `projects/sample.cinamate.json` (`SB_SetDesign_v1` block);
`scripts/run_all_tests.mjs:13-64`.

Zero-hit searches backing the "missing entirely" claims (same glob scope as
stated at the top):

| pattern | hits |
|---|---|
| `hyperfocal` | 0 |
| `circle of confusion` | 0 |
| `footcandle\|foot-candle\|\blux\b\|lumen` | 0 |
| `ND ?filter\|neutral density\|\bND\d` | 0 |
| `safe ?area\|safeArea\|titleSafe\|action safe` | 0 |
| `shutter ?angle\|shutterAngle` | 0 |
| `kilowatt\|\bkW\b\|\bwatt\|amperage\|\bdistro\b\|\bstinger\b` | 0 |
| `\bHMI\b\|tungsten\|skypanel\|\bkino\b\|LED panel\|\bfixture\b` | 0 |
| `\bgel\b\|\bCTB\b\|\bCTO\b\|kelvin` | 0 in modules |
| `colou?r ?space\|colorSpace\|\bCDL\b\|LogC\|S-?Log\|ACES` | 0 real |
| `letterbox\|mask\|guide\|frameline\|crop` (in `sets/`) | 0 |
| `camera test\|lens test\|back ?focus\|collimat\|lens serial` | 0 |
| `projection chart\|lens chart` | 0 |

Arithmetic behind the sensor-mismatch finding (`sets/lib-set.js:80` vs
`sets/lib-set3d.js:373`), for the sample plan's 32mm A-cam:
`fovDeg(32) = 2·atan(18/32) = 58.7°` (full frame) against
`lensFov(32, false) = 2·atan(24.89/64) = 42.5°` (Super 35).

Baseline test state at the time of audit: `44/44 suites passed`. No file was
modified.
