# Production Designer

Judged as the person responsible for the look of every space: concept and
reference, set design and construction drawings, swatch and finish, scenic,
set dressing, practical build vs location dressing, and the art department's
own budget and calendar.

**Short answer to the question the brief asks:** no, an art department cannot
build from this yet. The measuring is honest — everything is in feet, end to
end, and the geometry is sound — but the output is a top-down plan and a
perspective model. There is no elevation, no section, no dimension string, no
title block, no north arrow, no finish schedule, and no quantity takeoff. Two
specific defects make the model actively misleading rather than merely
incomplete: **doors do not cut the walls they sit in**, and **the "look through
the lens" view's horizontal coverage is the browser window's shape, not the
film format's.** Both are verified below with numbers.

---

## What exists and works

- `sets/lib-set.js:11-31` — a 19-piece stencil catalog dimensioned in real feet
  (wall 10′×6″, door 3′, bed 6′6″×5′, vehicle 15′×6′). The sizes are right.
- `sets/lib-set.js:63` — `snap()` to a 6-inch grid by default. Correct
  granularity for a stage plan; a designer never places a flat to the ¹⁄₁₆″.
- `sets/lib-set.js:66-77` — `hitTest()` transforms the point into each item's
  local frame, so selection is correct on rotated pieces, with 0.3 ft of finger
  slop. Properly done.
- `sets/lib-set.js:126-146` — `toSVG()` emits a complete standalone SVG: 1-ft
  grid, bolder line every 5 ft, a 5-ft scale bar, and the plan name with its
  overall dimensions. This is a measured drawing rather than a sketch, which is
  more than most browser tools manage.
- `sets/lib-set3d.js:14-21` — the coordinate conventions are stated once, in
  writing, at the top of the file (feet; X right, Y up, Z toward viewer; plan
  (x,y) → world (x,0,y); CCW winding). This is why the 3D view is not a mirror
  of the plan, and it is the reason the module is maintainable at all.
- `sets/lib-set3d.js:32-52` — every stencil carries a real default height:
  door 6′9″, counter 3′, shelf 6′, person 5′10″, greenscreen 12′. Those are the
  numbers a set dresser would assume, and each is overridable per item
  (`heightOf`/`elevationOf`/`colorOf`, lines 56-70).
- `sets/lib-set3d.js:140-150` — `rotY()` is matched deliberately to SVG's
  `rotate()` with the sign reasoning written out. This is exactly the class of
  bug that makes a 3D view untrustworthy, and it was thought about.
- `sets/lib-set3d.js:190-232` — table/chair/sofa/camera/light get real
  silhouettes (top on four legs, seat plus back, base plus arms, tripod column)
  rather than crates. Cheap, and it makes a plan readable at a glance.
- `sets/lib-set3d.js:323-348` — ray/triangle picking by Möller–Trumbore, so a
  click in 3D selects the same item the 2D plan would.
- `sets/lib-set3d.js:399-439` — OBJ (one named group per piece) and STL text
  exports with no third-party code, honouring the no-dependency constraint.
  `scripts/test_set3d_browser.mjs:192-207` verifies both produce real geometry
  with no `NaN` and one group per piece.
- `sets/gl.js:155-168` — the 3D floor grid is one line per foot, brighter every
  ten, with the stage outline drawn separately. This is what makes the 3D view
  trustworthy instead of decorative, and the comment says so.
- `sets/gl.js:171-200` — every camera on the plan draws its frustum as
  wireframe, so coverage is visible without switching views.
- `sets/gl.js:96-108` + `sets/index.html:172-184` — WebGL failure returns null
  and the UI says plainly that 3D is unavailable while plan and exports still
  work. Honest degradation.
- `props/lib-props.js:40-64` — every prop category has honest w×d×h defaults in
  feet, each overridable per item. A props list that knows how big a thing is.
- `props/lib-props.js:83-94` + `props/index.html:192-195` — `fitsThrough()`
  tries all six orientations against a standard 3′×6′9″ doorway and tells you
  plainly if a piece will not make it. That is a real art-department question
  answered correctly.
- `props/index.html:172-196` — the prop rendered beside a six-foot figure in the
  same 3D engine. Scale is the whole question and a picture answers it faster
  than a number.
- `props/lib-props.js:70-81` + `props/index.html:215-233` — placing a prop
  writes an ordinary set item at its real size into `SB_SetDesign_v1`, so the
  Set Designer needs no knowledge of props. Clean separation.
- `props/lib-props.js:16-30,150-206` — the 10% weekly rule, the 75% long-run
  discount, the ~40%-resale buy-vs-rent break-even, an automatic armorer day
  rate on any weapon, and 10% contingency. That is how a props budget is
  genuinely built.
- `props/lib-props.js:221-254,279-325` — the prop-house directory carries no
  invented phone numbers; numbers arrive only from OpenStreetMap or the user's
  own edit, with a Google search link as the fallback. Correct discipline.
- `locations/lib-scout.js:507-521` — the tech-scout checklist asks for load-in
  door, ramp, stair and elevator dimensions and weight limits. That is precisely
  the art department's question about a practical location.
- `locations/index.html:129-145` — scout photos go to IndexedDB rather than
  localStorage, keeping large images out of the 5 MB budget. Good engineering.
- `tools/tools-media-ui.js:410-513` — a working moodboard: drag, scroll-to-size,
  notes, PNG export, images downscaled to 480 px on ingest.
- `boards/lib-shots.js:41-57` — coverage suggestion (master + singles on named
  cast + insert) and `:99-114` the CSV formula-injection guard. Both correct.

---

## What exists but needs work

### HIGH

- `sets/lib-set3d.js:248-277` — **A door or window does not cut the wall it sits
  in.** `buildScene()` maps every item to an independent mesh; there is no
  boolean subtraction anywhere in the file. Verified: a plan with a 10-ft wall at
  y=4 and a 3-ft door at the same point produces a wall mesh of exactly 6 quads
  (a plain solid box), and a ray fired straight through the doorway at 5 ft eye
  height hits mesh `w1` at 5.75 ft. The comment at `sets/lib-set3d.js:234` states
  the opposite intent — "a door or window is a hole… otherwise a doorway reads as
  a blocked wall" — but `openingQuads` only builds jambs and a header *beside*
  and *above* the opening, and never touches the wall. Consequence: every OBJ and
  STL this tool exports has bricked-up doorways, and "look through the lens" shows
  a solid wall where an actor walks in. **Fix:** in `buildScene`, collect opening
  items whose rotated footprint overlaps a wall and emit that wall as four boxes
  (sill, header, and two side pieces) instead of one.

- `sets/gl.js:255` — **The look-through view shows more than the lens covers.**
  `S3.perspective(fovY(), canvas.width / canvas.height, …)` takes the vertical FOV
  from the Super 35 aperture height (`sets/lib-set3d.js:373-379`) but the
  horizontal from the browser panel's aspect. Measured: on a 900×420 panel a 35 mm
  shows 59.5° horizontal against a true 39.1°; a 24 mm shows 79.6° against 54.8°;
  a 50 mm shows 43.6° against 28.0°. The view is only correct when the panel
  happens to be 4:3 (the S35 aperture aspect). This is the module's headline
  feature — "the thing a general 3D modeller cannot do" per
  `sets/index.html:225` — and a designer sizing a backing or a wall run from it
  builds substantially the wrong amount. **Fix:** letterbox the viewport to a
  chosen film aspect (1.85 / 2.00 / 2.39 / 1.78) and derive both FOVs from the
  format, with the aspect stored on the plan.

- `sets/lib-set.js:80-83` vs `sets/lib-set3d.js:373-379` — **The 2D plan and the
  3D view disagree about the same lens.** `fovDeg()` computes on a full-frame
  36 mm sensor (`18/f`); `lensFov()` uses the Super 35 aperture (24.89 × 18.66).
  Measured spread: 18 mm 90.0° vs 69.3°; 24 mm 73.7° vs 54.8°; 35 mm 54.4° vs
  39.1°; 50 mm 39.6° vs 28.0°; 85 mm 23.9° vs 16.7°. Worse,
  `sets/index.html:205-206` labels the 3D viewport with the **2D** figure, so the
  caption contradicts the picture it is printed on, and `sets/index.html:97`
  tells the designer the cones are "(full-frame)" while the model is S35. **Fix:**
  one sensor constant, selectable (S35 / FF / 65mm / M4/3), consumed by both.

- `sets/index.html:345` + `sets/lib-set.js:131,117-121` — **The exported plan is a
  dark-mode screenshot, not a drawing.** `svgString()` renders at 14 px per foot;
  at 96 dpi that is 0.146 in/ft, which is no standard drafting scale (¼″=1′-0″ is
  24 px/ft, ½″ is 48). The sheet is filled `#0A1628` with `#8BA3B8` linework, so
  printed it is a solid dark rectangle. There is no title block — no project, set
  name, scale ratio, date, designer, revision or drawing number — no north arrow,
  and no dimension strings between elements; the only measurement aid is the 1-ft
  grid and a 5-ft scale bar (`sets/lib-set.js:140-144`). There is no
  `@media print` rule for this module either (`css/cinamate-ui.css:163-167`
  covers other modules only). A construction coordinator cannot scale off this
  sheet, cannot file it, and cannot tell revision 2 from revision 5. **Fix:** a
  print theme (white ground, black line, hatched walls), export at a real
  drafting scale, a title-block band, and dimension lines.

- `sets/lib-set3d.js:88-95` — **No orthographic projection, therefore no
  elevations and no sections.** `perspective()` is the only projection in the
  file. Every wall the tool can already describe — height, elevation, openings,
  colour — can only be seen in perspective. An art department builds flats from
  elevations; a plan alone does not tell a carpenter where the chair rail sits or
  how tall the header is. **Fix:** add `ortho()` beside `perspective()`, and a
  per-wall elevation SVG generator in `lib-set.js`. The data is already there;
  this is a view, not a new model.

- `js/budget-engine.js:650,682-684` + `producer/budget-sheet.js:23,144,338-351` —
  **The art department budget is unrelated to the art department's work.** The
  whole allowance is `scale.artPerDay × shootDays` picked from the budget tier
  (`js/budget-engine.js:67-72`), then split 55/30/15 across art / wardrobe /
  HMU. Nothing in `sets/` or `props/` computes a quantity — grepping `sets/` and
  `props/` for area or square footage returns nothing — so the number of sets you
  designed, their size, and your priced props list have zero effect on the
  number. The top sheet gives account 9000 three starter lines ("Production
  designer & crew", "Set dressing & props", "Stunts / SFX units") and seeds only
  from the parametric estimator, never from `SB_Props_v1`'s real quoted figures.
  A designer cannot defend a build with this.

- `sets/lib-set.js:42` + `sets/index.html:94` + `producer/schedule-board.js:90-100`
  — **The set plan is not connected to the schedule.** A plan's only link to the
  script is a free-text `scenes` string ("e.g. 4, 12, 18A"). The stripboard groups
  by *location*, not by set. So nothing can answer: how many shoot days is this
  set standing, when does it need to be built, when can it be struck, which sets
  overlap on the calendar. The art department's calendar runs weeks ahead of the
  shooting calendar and the platform does not model that at all.

- `workflow/workflow.js:40,57,77,98,115,133,154` — **There is no Design/Prep stage
  in the pipeline.** The seven stages are Develop, Breakdown, Budget, Schedule,
  Generate, Review, Deliver. `sets`, `props` and `boards` appear nowhere in
  mission control, so the art department has no gate and no readiness signal —
  no "sets designed / approved / built / dressed". `workflow/advisor.js:132`
  mentions Art exactly once, and only for period pictures.

### MED

- `props/lib-props.js:79` — **`propId` is written and never read.** It is set on
  every placed item and asserted by `scripts/test_set3d_browser.mjs:276`, but no
  file under `sets/` reads it. So: resizing a prop does not update the piece on
  the set; deleting a prop leaves it on the set forever; and the set decorator's
  core document — the dressing list per set, with scenes and cost — cannot be
  produced even though every field it needs already exists.
- `props/index.html:226-229` — **Re-placing a prop discards the designer's
  placement.** The existing item is filtered out and a new one pushed at the plan
  centre. The comment at line 227 says "should move it, not litter the stage" —
  it moves it back to the middle. Keep the previous x/y when one exists.
- `sets/lib-set.js:11-31` — **The catalog cannot describe how a set is built.**
  No platform/riser/parallel, no stair unit, no column, no fireplace, no arch, no
  translite/backing, no cyc, no ceiling piece, and — the important omission — no
  dolly track and no crane footprint. Without track on the plan there is no way to
  see *why* a wall has to be wild.
- `sets/index.html:152-162` + `sets/lib-set.js:109-110` +
  `sets/lib-set3d.js:235-245` — **No mirror/flip, and the door swing is
  fixed-hand.** The inspector offers label/x/y/w/h/rot/height/off-floor/colour/lens
  only. The 2D swing arc is always drawn the same way, and the 3D door ignores
  swing entirely. Swing direction decides wall clearance and where the camera can
  stand; it is not an aesthetic detail.
- `sets/lib-set3d.js:271-274` — **One global wall height per plan.** `buildScene`
  takes the max height across all wall items and applies it to every opening's
  header. Two rooms of different heights on one plan give wrong headers in the
  shorter one.
- `sets/lib-set3d.js:181,425-435,413` — **Cylinders export a quarter degenerate
  geometry.** The cap "quad" is `[C, p0, p1, C]` — first and fourth vertices
  identical — so `toSTL` emits its second triangle with a zero-area face.
  Measured: one plant yields 48 facets, 12 of them `facet normal 0 0 0`. `toOBJ`
  emits the same as a 4-vertex face with a repeated index. Affects plant, person
  and the camera lens barrel. Strict importers and slicers reject or silently
  "repair" these. **Fix:** push a triangle for the cap, not a collapsed quad.
- `sets/lib-set3d.js:399-418` — **OBJ carries no materials.** Verified: the export
  contains no `mtllib` and no `usemtl`. The per-item colour set at
  `sets/index.html:160` is the only finish information the model holds, and it is
  dropped at the door — so the model that opens in Blender is uniformly grey. A
  `usemtl` per group plus a sibling `.mtl` is a dozen lines.
- `sets/lib-set.js:94,101` — **Fixed cone and throw lengths.** Every camera cone
  is drawn 12 ft long and every light throw 9 ft, regardless of lens, fixture or
  set size. On a 60-ft stage the coverage cone stops a fifth of the way across
  and tells the designer nothing about the far wall.
- `sets/index.html:338-342` — **No undo.** Delete/Backspace removes the selected
  piece immediately, with no confirmation and no history, while deleting a whole
  *plan* does confirm (`sets/index.html:266`). `timeline/timeline.js:31-32`
  already implements a working snapshot/undo pattern in this codebase.
- `locations/index.html:129-145` vs `projects/lib-vault.js:15-44` — **Scout photos
  do not travel with the project.** Photos live in IndexedDB
  (`cinamate_scout`/`photos`); the vault snapshots only localStorage `SB_*` keys.
  The location *records* (`SB_ScoutBook_v1`) survive an export or a project switch;
  the photographs — the actual reference — do not, and
  `locations/index.html:209` silently removes the broken thumbnail. For a
  production designer this is the worst thing on the list to lose.
- `boards/boards.js:109,113,272-283,410-416` — **Key art from a clip is a 480×270
  upscale.** Frames are grabbed at 480×270 JPEG q0.65 and assigned straight to
  `keyart.bg`, then stretched to cover a 1600×2400 sheet — roughly 59 dpi against
  a 27×40 print. And `production/lib-prod.js:162` lists "Key art (poster) —
  layered + flattened" as a delivery item the module can never satisfy: the
  export is a single flattened PNG with no layers, no bleed, no title-safe area
  and no billing-block typography rules.
- `sets/lib-set.js:138` — items render in insertion order with no z-control, so a
  door added before its wall is painted over by the wall. Add explicit ordering
  (openings and dressing above structure) or a send-to-front control.

### LOW

- `tools/tools-media-ui.js:411` — the moodboard is one global board, not per set,
  per location or per scene. No palette extraction, and no link from a set plan
  to its reference.
- `production/production.js:157-174` — continuity is text-only (`wardrobe`,
  `notes`). No photo field, so there is no set-dressing continuity record — the
  document that stops a lamp moving three feet between takes.
- `props/lib-props.js:73` — the set-item id is `'prop_' + id.replace(/[^A-Za-z0-9_-]/g,'')`;
  two prop ids that sanitize identically will collide and overwrite each other on
  the plan.
- `props/lib-props.js:70-81` — placement ignores `qty`. Twelve chairs place as one.
- `sets/index.html:305-306` — drag clamps the item *centre* to the plan bounds, so
  half a 15-ft vehicle can hang outside the stage with no warning.
- `sets/gl.js:395-398` — `snapshot()` renders a PNG of the 3D view and nothing
  anywhere calls it. A set render belongs on the call sheet and in the boards.

---

## What is missing entirely

1. **Construction drawings** — dimensioned plan, an elevation per wall, and at
   least one section, each with a title block and a real drafting scale. Attach
   to `sets/`. Needs `ortho()` in `lib-set3d.js`, a wall-elevation SVG generator
   in `lib-set.js`, dimension-string rendering, and a print theme. **Value:
   highest on this list** — it is the deliverable the module's own strapline
   claims (`sets/index.html:55,57`) and the one thing it does not produce.
2. **Wild walls, floated walls and removable ceilings** — a `wild: true` flag plus
   a pull direction on each wall, drawn with the standard broken line and arrow,
   and counted in the build. Attach to `sets/lib-set.js` STENCILS + `itemSVG`.
   Small change, large consequence: today a set that can only be shot from one
   side looks identical on the plan to one that can be shot from four. **HIGH.**
3. **Paint and finish schedule** — a named finish per surface: paint code and
   sheen, wallpaper, flooring, trim, practical fixture, with supplier and a
   swatch, printable and keyed to the plan. The model already carries an RGB
   colour per item (`sets/lib-set3d.js:67-70`); a scenic charge hand cannot work
   from a hex triplet. Attach to `sets/`. **HIGH.**
4. **Set dressing list per set, tied to props** — read the `propId` already
   written at `props/lib-props.js:79` and produce, per plan: which props dress
   this set, in which scenes, at what cost, with a rent/buy column. Attaches to
   both `sets/` and `props/`. **HIGH and cheap** — every field exists, nothing
   reads them.
5. **Art department budget rollup** — quantities taken off the plan (linear feet
   of wall, square feet of flattage, opening counts, floor area, piece count) ×
   unit costs, plus the priced props list, feeding account 9000 instead of the
   tier allowance at `js/budget-engine.js:650`. The sub-accounts a real 9000
   needs and `producer/budget-sheet.js:23` lacks: designer / art director / set
   designer labour, construction labour, construction materials, paint, greens,
   set dressing rental, set dressing purchase, prop rental, prop purchase, loss
   & damage, drafting and model shop, strike and restore. **HIGH.**
6. **Build / dress / strike schedule** — a per-set band (prep, build, paint,
   dress, shoot, strike, restore) tied to stripboard days, so the art department
   calendar exists as a thing and not as folklore. Attaches to
   `producer/schedule-board.js` + `sets/`. **HIGH.**
7. **Stage fit check** — does the set fit the stage, with the pullback the widest
   lens needs, plus a lighting perimeter and a clear path to the elephant door.
   `locations/lib-scout.js:96+` already carries a soundstage directory, but the
   `stages` field is prose ("16 purpose-built stages, 450,000+ sq ft…") with no
   numeric clear width, depth, grid height or door size. Add numeric dimensions
   to `STAGES` and a check in `sets/`. **HIGH** — this is the question that
   decides whether a design is buildable at all.
8. **Standard flat stock and modular wall runs** — build a wall from 4×8 / 4×10 /
   4×12 flats at a stated thickness so the plan yields a cut list and a flat
   count. Today `wall` is one 10′×6″ rectangle (`sets/lib-set.js:12`). **MED.**
9. **Swing sets** — one physical stage space re-dressed as several sets, with the
   changeover time, the shared structure and the elements that get reused called
   out on both the plan and the schedule. Attach to `sets/` + producer schedule.
   **MED.**
10. **North arrow and sun orientation on the plan** — for an exterior or any set
    with practical windows, which way the windows face decides the lighting plan
    and the shooting order. `locations/lib-scout.js:480` already computes golden
    hour and `tools/` has a sun calculator; the plan carries no orientation at
    all. **MED.**
11. **Concept art and reference attached to a set** — a lookbook slot on each
    plan (images, extracted palette, notes) and an export that pairs the
    reference with the drawing, which is how a design is actually presented to a
    director. The generic moodboard exists at `tools/tools-media-ui.js:411` and
    is attached to nothing. **MED.**
12. **Practical fixtures as first-class items** — a table lamp is simultaneously
    a prop, a set dressing line and a practical the gaffer must power, dim and
    match. Today `light` is a lighting unit only (`sets/lib-set.js:29`,
    `sets/lib-set3d.js:50`) and a lamp is a nameless box. **MED.**
13. **Drawing register with revisions** — set plans are revised constantly and
    the shop builds from whatever it last printed. Version number, date, and a
    "what changed" note per plan, with the revision printed in the title block.
    There is no undo today, let alone a revision history. **MED.**
14. **Location dressing plan** — the practical-location counterpart to a set
    plan: what gets removed, what gets added, what gets protected, what must be
    restored, and the before/after photo pair that proves it. `locations/` has
    photos and a tech-scout checklist but no dressing intent and no restore list.
    **MED.**
15. **Greens plan** — `props/lib-props.js:24` has a greens category with real
    dimensions, but nothing places greens on a plan or a location, and there is
    no irrigation, maintenance or strike note. **LOW.**
16. **Picture-vehicle clearance** — vehicles are catalogued with real dimensions
    (`props/lib-props.js:20,41-49`) but the set plan cannot check a turning
    circle, a swing path, or whether the car can get to its mark. **LOW.**

---

## Evidence

Files read in full: `sets/lib-set.js` (153 lines), `sets/lib-set3d.js` (456),
`sets/gl.js` (407), `sets/index.html` (397), `props/lib-props.js` (355),
`boards/lib-shots.js` (123).

Files read in part, with the lines cited above: `props/index.html:1-280`,
`boards/boards.js:1-130,255-429`, `locations/lib-scout.js:92-131,505-560`,
`js/budget-engine.js:67-72,100-160,650-708`,
`producer/budget-sheet.js:1-60`, `producer/schedule-board.js:59-100`,
`workflow/workflow.js:30-160`, `workflow/advisor.js:132`,
`production/production.js:110-180`, `production/lib-prod.js:145-183`,
`projects/lib-vault.js:1-80`, `tools/tools-media-ui.js:405-514`,
`dashboard.html:2175-2205`, `css/cinamate-ui.css:160-167`,
`locations/index.html:119-250`, `boards/index.html:60-85`,
`scripts/test_set3d_browser.mjs:180-290`.

Two claims were measured rather than read, by loading the pure libraries under
node (read-only; no file was modified):

1. **Openings do not cut walls.** Plan: a `wall` (10′ × 6″) and a `door` (3′)
   both centred at (12, 4). `CSet3D.buildScene()` returns a wall mesh of exactly
   6 quads — a plain solid box — and `CSet3D.pick()` from origin (12, 5, 10)
   along −Z, straight through the doorway at eye height, returns
   `{"id":"w1","distance":5.75}`. The wall blocks the door.
2. **FOV figures.** `CSet.fovDeg` vs `CSet3D.lensFov(mm,false)`, in degrees:
   18 mm 90.0 / 69.3 · 24 mm 73.7 / 54.8 · 35 mm 54.4 / 39.1 · 50 mm 39.6 / 28.0
   · 85 mm 23.9 / 16.7. And with `fovY` from S35 but aspect from the panel
   (`sets/gl.js:255`), a 900×420 viewport shows 79.6° / 59.5° / 43.6° horizontal
   for 24 / 35 / 50 mm against true values of 54.8° / 39.1° / 28.0°; a 640×480
   viewport matches exactly, confirming the aspect is the cause.
3. **Export details.** A plan containing one `plant` produces an STL of 48
   facets of which 12 are `facet normal 0 0 0`; the OBJ for the same plan
   contains no `mtllib` and no `usemtl`.

No file in the repository was edited.
