# Gaffer & Key Grip

**Verdict up front:** no. A gaffer cannot produce anything a real crew would rig
from. There is no fixture, no watt, no amp, no kelvin, no gel, no cable, no
generator and no load anywhere in the platform. The word "light" appears in the
set designer as a stencil, in the budget as a percentage, and in the AI prompt
strings as an adjective — and nowhere as a quantity. The `light` object in the
3D view is a shape: a 1.2 × 1.0 ft box on a 0.25 ft stick. It has no photometric
meaning of any kind, it emits nothing, it casts nothing, and moving it changes
literally not one pixel of the render.

That said, the platform is unusually close to being able to do this properly,
because it already holds the one thing every other lighting tool has to ask you
to enter by hand: **the set, measured in feet, with the camera in it.** Section
three is written around that.

---

## What exists and works

- `sets/lib-set.js:29,100-106` — the `light` stencil draws a 40° wedge (half-angle
  hardcoded 20°, `lh = 20 * Math.PI / 180`) 9 ft long on the top-down plan. As a
  *sketch* of where a lamp points it is legible and it prints. That is a genuine
  (if crude) lighting-position drawing, and it is more than most 2D floor-plan
  tools bother with.
- `sets/lib-set3d.js:32-52,248-266` — every plan item stands up in 3D at a real
  height with per-item `hgt`, `z` (off-floor) and `color` overrides, in feet,
  from the same record the 2D plan uses. A light on a 12 ft stand or hung at 16 ft
  is expressible today, and the OBJ/STL export (`lib-set3d.js:399-439`) carries
  it out to Blender as a named group. The geometry half of a lighting plot is
  solved.
- `sets/lib-set3d.js:323-348` — `rayTriangle()` (Möller–Trumbore) and `pick()`
  are already written, already tested, already used for click-selection. This is
  exactly the machinery a shadow / obstruction test needs. It is sitting there.
- `sets/gl.js:172-200` — `cameraLines()` draws every camera's true frustum as
  wireframe in the 3D view. This is the correct pattern; a `lightLines()` twin
  would be ~30 lines of the same code.
- `tools/lib-sun.js:33-62` — a real NOAA/Meeus solar solver: civil dawn, sunrise,
  the **6° elevation crossings** for golden hour, sunset, civil dusk, at a real
  lat/lon. This is the correct definition of golden hour, not a clock rule, and
  it is accurate enough (±2 min) to schedule a magic-hour rig against.
- `tools/sched-weather.js:93-156` — sun times plus a live Open-Meteo forecast per
  shoot day, with a risk chip. For deciding which day the 20×20 goes up outdoors,
  this is the single most useful screen in the platform for my department.
- `safety/lib-safety.js:74-79` — an `electrical` hazard whose controls name GFCI
  on distro near water, ramped-and-flagged cable crossings, and a wind/lightning
  stop condition. Those are the right three controls, correctly worded.
- `safety/lib-safety.js:50-55` — `heights` names "Rigging grip / certified rigger",
  fall protection above 6 ft, load-rated rigging, exclusion zone below. Correct.
- `tools/tools-registers.js:33` — the crew register has a real `dept` enum that
  includes `G&E`, and rows carry phone / emergency contact. A gaffer, best boy
  and key grip can be entered as people with contacts today.
- `production/production.js:181-193` — the camera report captures `lens`, `stop`
  and `filter` per roll. The T-stop is the one number that ties the DP's exposure
  to my department, and at least it is being logged.
- `docs/PRODUCTION_PRICING.md:120-122` — sourced IATSE rates for grip/electric
  journeyman ($54.78/hr) and key grip/gaffer ($63.01/hr). The **labour** half of
  the 8000 account has a real basis.

---

## What exists but needs work

### HIGH — the `light` object is a decal, not a light
`sets/lib-set3d.js:50,229-232` + `sets/gl.js:41-57,226`

`lightQuads()` returns two boxes. The fragment shader's illumination is two
hardcoded constant directions —
`vec3 key = normalize(vec3(-0.4, 0.85, 0.35));` and
`vec3 fill = normalize(vec3(0.6, 0.35, -0.6));` (`gl.js:50-51`) — computed per
fragment with no reference to the scene at all. Consequences a gaffer will hit
inside five minutes:

1. Moving, rotating, raising or re-colouring a `light` item changes nothing in
   the 3D render. Setting its `color` to a daylight blue tints **the box**, not
   the set, because `gl.js:52-53` multiplies `vColor.rgb` (the fixture's own
   surface colour) by the hardcoded `l`.
2. `setPlan()` builds `cameraLines(plan)` (`gl.js:226`) and nothing else. There
   is **no** light cone in 3D. The 3D view is strictly *worse* than the 2D plan
   for my department: the one thing 2D shows — which way the lamp points — is
   dropped the moment you press ◳ 3D.
3. No shadow pass, no occlusion. Whether the flat at `w2` blocks the key is the
   entire question a lighting plot answers, and the tool cannot be asked it.

**Why it matters:** the toolbar promises "See exactly what a camera on this set
sees" and delivers it. The inspector caption (`sets/index.html:97`) promises
"the gaffer's light throws work the same way" — and they do not. A DP will trust
the camera view, then trust the light beside it, and be wrong.

**The change:** (a) add `lightLines(plan)` to `gl.js` next to `cameraLines()`,
drawing the real beam cone from real fixture data (below) at its real throw;
(b) feed the plan's light items into the fragment shader as up to N point/spot
lights with position, colour and intensity, keeping the two hardcoded lamps as a
0.15 ambient floor so an unlit set is still navigable; (c) an occlusion test
using the existing `S3.pick()` from each light to a selected blocking mark,
reported as "keyed / shadowed by *Back flat*". (c) is nearly free — the ray code
already exists and is tested.

### HIGH — a light item cannot store a single electrical or photometric fact
`sets/lib-set.js:46-53` + `sets/index.html:150-163`

`addItem()` creates `{id, type, x, y, w, h, rot, label}`, and adds `lens` **only**
for a camera. The inspector renders a Lens mm field only when
`st.kind === 'camera'` (`index.html:161`). So on a light there is nowhere to put:
fixture type, wattage, draw in amps, voltage, beam angle, field angle, colour
temperature, CRI, gel/diffusion, dimmer channel, circuit, distro box, stand type
or rigging method. The sample project proves the workaround — the shipped plan
stores its fixture as `"label":"Key 2K"` (`projects/sample.cinamate.json`,
`SB_SetDesign_v1`). The wattage lives in a free-text string that nothing parses.

The beam is worse than absent, it is wrong-by-default: every light on every plan
draws the same 40° wedge 9 ft long — 6.6 ft of coverage at the end of the throw —
on a sample set that is 24 × 20 ft. A 5K fresnel spotted to 12° and a 4×4 Astera
book light both draw that identical wedge.

**The change:** add optional per-item fields the same way `lens` was added
(`lib-set.js:51`) — `fixture`, `watts`, `beamDeg`, `kelvin`, `gel`, `channel`,
`dim` — with a `FIXTURES` table keyed by fixture id supplying the defaults, then
drive both the 2D wedge angle/length and the (new) 3D cone off `beamDeg` and a
throw derived from output rather than the constant `9`. This is additive to the
item record, so no `SB_*` key or existing plan breaks.

### HIGH — two disagreeing lens models in the same module, and a third that is right
`sets/lib-set.js:79-83` vs `sets/lib-set3d.js:373-379` vs `tools/lib-media.js:59-72`

The 2D plan's `fovDeg()` hardcodes a full-frame 36 mm gate (`atan(18/f)`). The 3D
`lensFov()` hardcodes Super 35 (`SENSOR_W = 24.89`). Same item, same `lens`
value, two answers:

| lens | 2D plan cone | 3D frustum / "Look through" |
|---|---|---|
| 24 mm | 73.7° | 54.8° |
| 35 mm | 54.4° | 39.1° |
| 50 mm | 39.6° | 28.0° |

**Why it matters to me specifically:** the frame line is where I am allowed to
put a stand, a flag, a bounce or a lamp. A gaffer laying out a plot off the
printed 2D plan at 35 mm believes he has 54° of hot zone to stay clear of; the
DP looking through the same camera in 3D sees 39°. Fifteen degrees of set is
either wasted or full of grip stands that are about to be in frame. And
`sets/index.html:97` states "(full-frame)" as fact, so the wrong one is the one
that is documented.

Meanwhile `tools/lib-media.js:59-69` already carries a proper nine-entry sensor
table (Super 35, S35 17:9, full frame, ALEXA LF, ALEXA 65, RED VV, MFT, S16,
phone) with `fov()` and `coverage()` beside it, node-tested.

**The change:** put a `sensor` field on the plan (default `super35`), have both
`lib-set.js` and `lib-set3d.js` read `TMedia.SENSORS`, and delete both hardcoded
constants. One table, one answer, and the set designer inherits ALEXA 65 and
Super 16 for free.

### HIGH — the stripboard has no day that is not a shooting day
`producer/schedule-board.js:104-111,221-233,303`

`autoScheduleModel()` fills integer day indices at a pages/day pace; `render()`
prints `Day N` for every index; `dayMeta[d]` holds `{call, date, notes}` only.
There is no day *type*. So a pre-rig day, a prelight day, a travel day, a hold
day, a company move, a splinter-unit day and a second-unit day are all
unrepresentable. A pre-rig is not a scheduling nicety — it is the mechanism by
which a G&E crew makes a 24-scene interior week possible, and it is the line item
the producer cuts first because nothing on the board argues for it.

Equally, `sc.day` cannot express a split day, so a company move mid-day (the
thing that costs my department two hours of wrap-and-reset) is invisible.

**The change:** `dayMeta[d].type ∈ {shoot, prerig, prelight, travel, hold, move,
2ndunit}` with a strip-free rendering for non-shoot types, and make
`doodMatrix()` (`:148`) skip non-shoot days when computing holds so a rig day
does not read as an actor hold. Small, contained, and it unlocks the turnaround
work below.

### MED — the breakdown has six tags and none of them are mine
`producer/schedule-board.js:39-40`

`TAG_KEYS = ['stunts','sfx','vfx','water','animals','vehicles']`. A real
breakdown sheet has ~20 categories, and the ones that drive my truck are all
absent: Special Equipment (condor, scissor, crane, dolly, track), Generator,
Additional Lighting, Rigging Crew, Practical Effects, Process/Poor-Man. These
tags are not cosmetic — `boardOverridesModel()` (`:116-143`) turns them into
`unitOverrides.stuntDays / pyroDays / waterDays / animalDays` which feed the
budget estimator directly. There is no `geDays`, no `condorDays`, no `rigDays`,
so no amount of boarding can make the budget see a lighting-heavy night block.

**The change:** extend `TAG_KEYS` with `condor`, `genny`, `crane`, `rigging`,
`practicals`, add matching `unitOverrides`, and add the day-rate constants beside
`STUNT_DAY`/`PYRO_DAY` in `js/budget-engine.js:149`.

### MED — account 8000 is two lines and a percentage
`producer/budget-sheet.js:22` and `js/budget-engine.js:680`

The top-sheet skeleton gives Grip & Electric exactly `['G&E crew', 'G&E package
& truck']`. The estimator computes it as
`addR(laborPct(0.18), [equipment[0] * 0.50, equipment[1] * 0.50])` — 18 % of crew
labour, 50 % of the equipment allowance. Note the labour side has a sourced basis
(`docs/PRODUCTION_PRICING.md:120-122`) and the gear side is a bare ratio.

A real 8000 breaks to roughly sixteen lines: gaffer, best boy electric, set
electricians (daily), rigging gaffer + rigging electrics, key grip, best boy grip,
dolly grip, grips (daily), rigging grips, lighting package rental, grip package
rental, generator rental **+ fuel**, condor/lift rental **+ operator**, expendables
(gel, diffusion, blackwrap, gaff/paper tape, batteries), truck/box rentals and kit
fees, loss & damage. Two are conspicuously missing platform-wide: **generator fuel
appears nowhere in the repo**, and expendables exist only under `14000 · Media &
Stock` (`budget-sheet.js:26`), which is where the DIT's drives live, not my gel.

**Why it matters:** fuel on a 500 A genny running 12 hours is a four-figure line
per day, and expendables on a 20-day show are five figures. Both are pure
consumption — a producer who cannot see them cannot cut them, and finds them in
the actuals.

### MED — the electrical hazard only fires when it rains
`safety/lib-safety.js:74-79,62-67,50-55`

The `electrical` regex is
`/\b(rain (?:hammers|pours|machine)|storm|downpour|soaked|generator|power lines?)\b/i`
— i.e. weather words plus the literal words "generator" and "power lines". So the
electrical hazard is raised by the *screenplay's weather*, never by the
*department's plan*. Meanwhile the `night` hazard (sev 1) is turnaround and lit
paths only and says nothing about power, though every night exterior on earth
needs a genny, a distro run and a cable crossing.

The deeper structural gap: `analyze()` (`:102-120`) derives hazards from script
text and only from script text. A condor basket at 60 ft over a live street is
the most dangerous thing my department does and the script never mentions it —
I decided to do it. `heights` (`:51`) will only fire if a character climbs a
roof. There is no way for a head of department to *declare* a hazard into the
assessment.

**The change:** (a) add `generator`/`distro`/`condor`/`lift`/`rigging` to the
hazard set, triggered by department declarations rather than by regex alone;
(b) give `analyze()` a second input — a list of crew-declared hazards per
scene/day — merged into `flagged` so the printed assessment
(`assessmentText()`, `:126`) covers what the crew is actually doing, not only
what the writer wrote.

### MED — wind is computed, scored, and then never shown
`tools/lib-sun.js:92-98` and `tools/sched-weather.js:140,150`

`shootRisk()` reads `day.windMax` and adds risk above 30 (Open-Meteo returns
km/h under `timezone=auto`, ≈ 18.6 mph — which is, by coincidence, close to the
right "start thinking about the 20×20" threshold). But `renderRows()` prints
condition, temp range and rain probability and **never prints the wind speed**.
The number that decides whether a key grip can fly a 12×12 or a 20×20 silk, whether
a butterfly frame goes up at all, and whether the condor can be raised, exists in
the fetched data, is used, and is then discarded before display. The temperature
also prints a bare `°` with no unit (`sched-weather.js:150`).

**The change:** add a Wind column with an explicit unit and a rigging threshold
chip (green / amber ≥ 25 km/h / red ≥ 40 km/h), and state the temperature unit.
Three lines in `renderRows()` and the highest ratio of value to effort in this
whole report.

### MED — two sun models, and the one the location scout uses is the wrong one
`locations/lib-scout.js:480-505` vs `tools/lib-sun.js:51-62`

`CScout.goldenHour()` uses Cooper's declination approximation with **no
longitude, no timezone and no DST**, and — critically for my department — defines
golden hour as a flat clock hour: `goldenAmStart: fmtHour(rise)` and
`goldenPmStart: fmtHour(set - 1)`. Golden hour is not an hour. It is the sun
below 6° elevation: roughly 25 minutes at the equator and well over two hours at
high latitude in summer. `tools/lib-sun.js:57-58` already computes the correct
6° crossings. `locations/index.html:107` honestly discloses the approximation,
which is to the authors' credit — but the correct engine is already in the repo
and is not being called.

**The change:** have `locations/` call `TSun.sunTimes()` and delete
`CScout.goldenHour()`. Keep `dayOfYear()`, which is used elsewhere.

### MED — "Power" on a location is a free-text box
`locations/lib-scout.js:510,530` and `locations/index.html:170`

The tech-scout checklist asks exactly the right question — *"House power capacity
and tie-in point, or generator spot (with cable run + noise distance)"* — and
then `blankLocation()` gives it `power: ''` and the UI renders it as a plain text
input beside parking and load-in. The same is true of the locations register in
`production/production.js:138`, where power shares one `notes` column with
parking and sound.

So the scout is prompted to gather the four numbers that determine my entire
approach to a location — available amperage, service type, distance to tie-in,
genny placement distance and its noise impact on sound — and there is nowhere to
record any of them as data. Nothing downstream can ask "is there enough power
here?" because the answer is prose.

**The change:** replace the string with
`power: {amps, volts, phase, tieIn, tieInDistFt, gennySpot, gennyDistFt,
noiseConcern}`, keeping `power` as a legacy string field so existing owner data
survives (the brief forbids renaming). Then a plan's total draw can be checked
against the location.

### LOW — practicals have no owner
`props/lib-props.js:102`

`lamp|chandelier|candle|candelabra` classify as `setdress`. On a real show a
practical is jointly owned: props buys it, art dresses it, and **electric rewires,
dims, gels and often re-lamps it** — and the bulb wattage, the dimmer channel and
whether it is on the board are electric's problem. Nothing in the props record
(`lib-props.js:193`) carries a wattage, a dimmable flag, a colour temperature or
a channel, and there is no link from a practical prop to a light item on the set
plan.

### LOW — the shot list knows the move but not the rig
`boards/lib-shots.js:15,35`

`MOVES` includes `Track` and `Crane`; `blankShot()` is
`{id, size, angle, move, lensMm, desc, img, dur}`. A shot marked `Track` does not
record that it needs 40 ft of straight track, a dolly, a leveled floor and a
dolly grip; `Crane` does not record which crane, its arm length, its counterweight
or that the base needs a permit and a licensed operator. That is a key grip's
whole day and there is no field for it.

### LOW — the pipeline has no prep phase
`workflow/workflow.js:40,57,77,98,115,133,154`

Seven stages: Develop → Breakdown → Budget → Schedule → Generate → Review →
Deliver. Mission control goes straight from boarding the schedule to generating
imagery. The entire physical prep block — tech scout, equipment orders and
sub-rentals, pre-rig, prelight, department load-in — has no stage, so the
Advisor's prep actions (`workflow/advisor.js:140+`) can never surface "your
equipment order is not placed and you shoot in nine days".

---

## What is missing entirely

### 1. Fixture inventory with photometrics — HIGHEST VALUE
**What:** a pure-logic `sets/lib-gaffer.js` (`CGaffer`) carrying a fixture table:
id, label, family (tungsten fresnel / HMI / LED panel / LED fresnel / soft /
china ball / kino / practical), watts, draw in amps at 120 V and 208/240 V,
beam and field angle (spot and flood), native colour temperature, bi-colour range,
and photometric output as candelas or foot-candles at a reference distance.
From that, three functions that are pure arithmetic:
- `fcAt(fixture, distanceFt, spotFlood)` — inverse-square with the published
  reference point, then
- `fcToStop(fc, iso, shutterDeg, fps)` — foot-candles → T-stop, and
- `stopToFc(stop, iso, ...)` — the inverse, which is the question actually asked
  ("the DP wants a T2.8 at 800 — what do I need at 14 ft?").

**Why a production needs it:** this is the gaffer's entire pre-production. It is
what turns "put a light there" into an equipment order. It is also the only thing
that makes the 3D view honest.

**Attach to:** `sets/` as the data source, surfaced in the inspector; exported to
`producer/` account 8000 as an order.

**Effort:** the maths is trivial arithmetic and node-testable in a `scripts/
test_gaffer.mjs`; the work is compiling ~40 fixture rows. Every number must come
from a published photometric sheet or be omitted — per the brief, do not invent
output figures, and an unverified fixture gets a search link, not a guess.

### 2. Power, distro and generator sizing — HIGHEST VALUE
**What:** given the fixtures on a plan, sum the draw; group into circuits (20 A
domestic, 100 A/200 A/400 A distro legs); size the genny with a headroom factor
(continuous load ≥ 80 % of rating is the thing that trips at the worst moment);
report kW required, recommended genny class, fuel burn per hour and fuel cost per
12-hour day; and flag when total draw exceeds the location's recorded house
service (which needs finding #9 above to be structured first).

**Why:** this is the single line no producer can estimate and no gaffer can skip.
It converts a lighting plot into a truck order and a fuel line, and it is the
answer to "can we tie in here or do we need a genny?" — the question that decides
whether a location is affordable.

**Attach to:** `sets/` (fixtures) → `locations/` (available service) →
`producer/` account 8000 (genny + fuel line items).

**Effort:** small. Pure arithmetic on top of finding #1, ~150 lines.

### 3. Cable run lengths and voltage drop — THE ONE ONLY THIS PLATFORM CAN DO
**What:** the plan is already measured in feet and already knows where every
fixture is. Add a genny/tie-in point as a plan item, and the run to every fixture
is a path length the existing geometry computes for free. Then voltage drop is
one formula (`VD = 2 × K × I × L / cmil`), which tells you when a 4/0 feeder is
needed instead of banded 2/0, when a run is too long for the gauge, and how much
cable to actually put on the truck.

**Why it is the killer feature:** every other lighting-design tool makes you
enter the run length by hand because it has no idea where the generator is
parked. Cinamate does. Nobody orders cable by measuring; they order by guessing,
and then the run comes up 40 ft short at 11 p.m.

**Attach to:** `sets/lib-set3d.js` (distances) + finding #2.

**Effort:** small-to-medium. The hard part (geometry in feet) is done.

### 4. Lighting plot to the standard, with symbols and a key — HIGH
**What:** a proper plot: numbered fixture symbols drawn per fixture family (the
conventional shapes — fresnel, ellipsoidal, PAR, softbox, cyc, practical),
channel/circuit number in a hexagon, colour/gel call-out, focus arrows, a hang
position, and a legend/key block with a fixture count schedule and the total
connected load. Plus its companion, the **instrument schedule** (a table: channel,
fixture, position, purpose, gel, dimmer, load).

**Why:** the plot is the deliverable. It is what goes on the wall, what the best
boy orders from, and what the rigging crew works to. A plan with generic circles
on it is a sketch of a plot, not a plot.

**Attach to:** `sets/lib-set.js` — `itemSVG()` (`:88-123`) already branches per
`kind` and already emits standalone SVG; adding a `fixtureSymbol(fixture)` branch
plus a legend block in `toSVG()` (`:126-146`) is exactly the same code path that
already renders the scale bar and title at `:139-144`.

**Effort:** medium; entirely inside an existing, tested renderer.

### 5. Sun path, shadow direction and day-for-night planning — HIGH
**What:** `TSun.crossing()` (`tools/lib-sun.js:33-47`) already computes solar
declination and hour angle. Adding `sunPosition(dateMs, lat, lon) → {azimuth,
altitude}` is a handful more lines of the same Meeus maths. That unlocks the
three things an exterior gaffer plans around:
- a **sun-path arrow** on the set plan for each hour of the shoot day, so you can
  see at 9 a.m. that the building will be backlit by 2 p.m.;
- **shadow direction and length** for a given object height, which decides where
  the 12×12 goes and when the location turns;
- **day-for-night**: the target under-exposure (typically −1.5 to −2 stops), the
  blue shift, sun angle low enough to sell it, and the exposure/ND plan to get
  there — which the platform cannot express at all today because no exposure
  maths exists anywhere in the repo (verified: no ISO, T-stop, foot-candle or
  exposure calculation exists outside the AI prompt-string dropdown at
  `app.html:2071`).

**Attach to:** `tools/lib-sun.js` for the maths; `sets/` for the plan arrow;
`producer/` day cards for the per-day sun line.

**Effort:** small for the astronomy (the hard part is written), medium for the UI.

### 6. Gel, diffusion and colour-temperature planning — MED
**What:** a gel/diffusion reference (CTB/CTO in ¼/½/full, Plus Green/Minus Green,
ND in ⅓/⅔/1/2 stops, the common diffusions) with each one's **transmission loss
in stops** and its **mired shift**, so mixed-source correction is a calculation
rather than an argument: tungsten at 3200 K under a 5600 K window, what CTB gets
you there, and what stop it costs.

**Why:** colour temperature has exactly one appearance in the platform — a
dropdown of prompt strings (`app.html:2071`, `CINE.temp`) feeding an image
generator. There is no kelvin value on any fixture, on any set, or on any
location. A production cannot order gel from this platform.

**Attach to:** `sets/` fixtures (a `gel` field per fixture) + a reference table in
`lib-gaffer.js`; the cut-list rolls up per plan.

**Effort:** small. Mired arithmetic is one line; the table is the work.

### 7. Grip package and rigging list — MED
**What:** the other half of the department, which has *no* representation at all:
stands (baby/junior/combo/hi-hi), C-stands and arms, flags/nets/silks by size,
12×12 and 20×20 frames, butterfly kits, bounce, floppies, apple boxes, sandbags,
speed rail and pipe, menace arms, wall/ceiling spreaders, dolly, track (in
lengths), sliders, cranes/jibs. Ordered as a package with counts, priced, and
tied to the shots that need it (finding LOW above).

**Why:** the key grip's order is half the 8000 account and there is currently
nothing in the platform that produces it.

**Attach to:** `producer/` 8000 line items, seeded from `boards/` shot moves and
from the set plan.

**Effort:** medium — mostly a well-organised catalogue with counts.

### 8. Condor / scissor lift planning — MED
**What:** lift type, platform height, reach, weight, ground-bearing requirement,
outrigger footprint, operator requirement, permit/road-closure need, and delivery
+ standby day rates.

**Why:** a condor is simultaneously the most expensive single G&E rental on a
night exterior, the longest lead time, and by a wide margin the most dangerous
thing the department does. It appears zero times in the repository. It has no
budget line, no schedule tag, and no hazard entry.

**Attach to:** `producer/` 8000 + a new hazard in `safety/lib-safety.js` (see the
MED electrical finding) + a stripboard tag.

**Effort:** small.

### 9. Rigging loads — MED value, and build it *carefully*
**What:** point loads and counterweight for hung fixtures, sandbag counts for
stands and frames by wind speed, and working-load limits for the common hardware.

**A deliberate recommendation to build less than you could:** do **not** ship a
calculator that outputs a number a rigger might rely on. Ship a **reference with
stated design factors** (the industry 5:1 on lifting hardware), a rigging
checklist that mirrors `safety/lib-safety.js:53-55`, a wind-vs-sandbag guidance
table tied to the forecast wind from finding MED-wind above, and an explicit
sign-off field naming the certified rigger. The platform's own convention —
"never invent a number" — applies with extra force where the failure mode is a
20×20 coming down on a crew.

**Attach to:** `safety/` (checklist + sign-off) and `sets/` (per-item rigging
method).

**Effort:** small, if scoped as reference-plus-checklist rather than as a
calculator.

### 10. Pre-rig / prelight days and turnaround protection — MED
**What:** on top of the day-type change (HIGH, stripboard), a pre-rig planner:
which sets get rigged ahead, how many rigging crew for how many days, what has to
be struck before the next unit loads in, and the turnaround check. The platform
already computes turnaround invasion penalties in the timecard tool
(`tools/lib-money.js:92-98`) and the safety module already asserts a "minimum
10-hour turnaround protected" control (`safety/lib-safety.js:66`) — but nothing
connects either to the schedule. Nothing warns when a Friday night wrap and a
Saturday morning call violate it.

**Why:** rigging crews routinely work opposite the shooting crew, and G&E turnaround
is where crews actually get hurt — driving home. The pieces exist; they are not wired
together.

**Attach to:** `producer/schedule-board.js` day types + `workflow/advisor.js` as a
prep action.

**Effort:** small — it is mostly connecting three things that all already exist.

### 11. Lighting continuity log — LOW
**What:** the electric department's equivalent of the camera report
(`production/production.js:181-193`): per setup, which fixtures were up, at what
level, gelled how, at what height and angle. Photograph the rig.

**Why:** reshoots and pickups. A month later, matching a night interior with no
record of the rig is guesswork, and the script supervisor's continuity register
(`production/production.js:160-173`) covers wardrobe, props and screen direction
but not light.

**Attach to:** `production/` as a fourth register beside Camera and Sound —
the `T.Register` engine makes this nearly free.

---

## Evidence

Files read in full: `sets/lib-set3d.js` (456 lines), `sets/gl.js` (407),
`sets/lib-set.js` (153), `sets/index.html` (397), `tools/lib-sun.js` (102),
`safety/lib-safety.js` (326), `producer/schedule-board.js` (475).

Files read in part, with the cited ranges verified:
`tools/sched-weather.js:85-159`, `tools/lib-media.js:1-73`,
`tools/tools-media-ui.js:219-256`, `tools/tools-registers.js:1-65`,
`locations/lib-scout.js:462-559`, `locations/index.html` (power/sun regions),
`producer/budget-sheet.js:10-36`, `js/budget-engine.js:650-769`,
`workflow/advisor.js:95-165`, `workflow/workflow.js:30-165`,
`production/production.js:130-237`, `boards/lib-shots.js:13-70`,
`boards/boards.js:41-72`, `props/lib-props.js:100-110`,
`docs/PRODUCTION_PRICING.md:110-130`, `scripts/test_set.mjs:76-79`,
`projects/sample.cinamate.json` (`SB_SetDesign_v1` store).

Specific claims and where they are verifiable:

- Two hardcoded directional lights, no scene input: `sets/gl.js:50-52`.
- Light drawn as two boxes: `sets/lib-set3d.js:229-232`; light profile
  `{h: 7, shape: 'light', color: '#F2D98C'}` at `:50`.
- No light cone in 3D — `setPlan()` builds grid + `cameraLines(plan)` only:
  `sets/gl.js:225-235`; `cameraLines()` at `:172-200`.
- Item record has no electrical fields; `lens` is camera-only:
  `sets/lib-set.js:46-53`; inspector gates Lens on `st.kind === 'camera'` at
  `sets/index.html:161`.
- 2D light wedge fixed at 20° half-angle, 9 ft: `sets/lib-set.js:101`
  (`var lh = 20 * Math.PI / 180, ll = 9 * ppf;`) — 6.6 ft of coverage at the end
  of the throw, on a 24 × 20 ft sample set.
- The only light test asserts a fill colour string appears in the SVG:
  `scripts/test_set.mjs:78`.
- Sample plan stores wattage in a label: `projects/sample.cinamate.json`,
  `SB_SetDesign_v1` → items `l1` `{"type":"light","label":"Key 2K"}` and `l2`
  `{"label":"Fill"}`.
- FOV disagreement: `sets/lib-set.js:80-83` (`atan(18/f)`, full frame) vs
  `sets/lib-set3d.js:373-379` (`SENSOR_W = 24.89`, Super 35). Table computed from
  those two expressions directly. The 3D frustum wireframe uses the Super 35 one
  (`sets/gl.js:178-179`). Correct sensor table exists unused at
  `tools/lib-media.js:59-69`.
- Stripboard day is a bare integer, `dayMeta` is `{call, date, notes}`:
  `producer/schedule-board.js:104-109, 303`.
- Six breakdown tags: `producer/schedule-board.js:39`; they become
  `unitOverrides` at `:134-140`.
- Account 8000 = two starter items: `producer/budget-sheet.js:22`; estimator
  formula `addR(laborPct(0.18), [equipment[0] * 0.50, equipment[1] * 0.50])` at
  `js/budget-engine.js:680`. Expendables live under 14000 at
  `producer/budget-sheet.js:26`.
- Electrical hazard is weather-triggered: `safety/lib-safety.js:75`. Night hazard
  says nothing about power: `:62-67`. `analyze()` takes script text only:
  `:102-120`.
- Wind computed but not rendered: used in `shootRisk` at `tools/lib-sun.js:95`;
  absent from the row template at `tools/sched-weather.js:150`, whose columns are
  declared at `:140`.
- Two sun models: `locations/lib-scout.js:480-505` (Cooper, `set - 1` for golden
  hour, no longitude) vs `tools/lib-sun.js:57-58` (6° crossings). Disclosure at
  `locations/index.html:107`.
- Power is a string: `locations/lib-scout.js:530` (`power: f.power || ''`),
  rendered as a text input at `locations/index.html:170`; the checklist prompt
  that asks the right question is at `locations/lib-scout.js:510`. Same field
  merged into a shared notes column at `production/production.js:138`.
- Practicals classify as set dressing: `props/lib-props.js:102`.
- Shot record has no grip equipment: `boards/lib-shots.js:35` (`blankShot`),
  moves list at `:15`.
- Pipeline has no prep stage: `workflow/workflow.js:40, 57, 77, 98, 115, 133, 154`.
- Ray/triangle intersection available for a shadow test:
  `sets/lib-set3d.js:323-348`.
- Turnaround maths exists but is unconnected to the board:
  `tools/lib-money.js:92-98`; the safety control asserting it is
  `safety/lib-safety.js:66`.
- IATSE G&E labour rates sourced: `docs/PRODUCTION_PRICING.md:120-122`.
- No exposure maths anywhere: a repo-wide search for ISO / f-stop / T-stop /
  exposure / ND / foot-candle returns only prose — `vfx/lib-vfx.js:147` (a VFX
  data-capture checklist string) and `app.html:2071` (`CINE.temp` / `CINE.exp`,
  AI prompt-string dropdowns). The only "3200K / 5600K" in the platform is in
  that dropdown.
- The only "lighting" intelligence writes prompts, not plots: a `lighting-designer`
  AI agent at `agents/client.js:64` with its system prompt at
  `netlify/functions/agent-invoke.js:27`.
- No occurrence anywhere in the repository of: condor, scissor lift, distro,
  ballast, dimmer, DMX, stinger, kelvin (outside the prompt dropdown), foot-candle,
  CTB, CTO, sandbag, speed rail, truss, menace arm, pre-rig, prelight, or working
  load limit. Verified by repo-wide `rg` excluding `node_modules`, `static/`,
  `*.zip` and `*.pyc`.
