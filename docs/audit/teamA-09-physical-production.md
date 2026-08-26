# Team A Dev 09 — physical production (props · sets 2D/3D · wardrobe · vfx · safety · music · post)

Scope: `props/`, `sets/`, `wardrobe/`, `vfx/`, `safety/`, `music/`, `post/`, with
`sets/lib-set3d.js` as the deep read. Every geometric and numeric claim below was
executed under node against the real library, not read off the source.

---

## What exists and works

- `sets/lib-set3d.js:78-87` — `multiply()` is a correct column-major 4×4 product.
  `o[c*4+r] = Σ a[k*4+r]·b[c*4+k]` expands exactly to the written form. No transpose
  needed anywhere, as the header claims.
- `sets/lib-set3d.js:88-95` — `perspective()` is textbook gluPerspective in column-major:
  `f = 1/tan(fov/2)` from `fovYDeg·π/360`, `m[10] = (far+near)/(near-far)`, `m[11] = -1`,
  `m[14] = 2·far·near/(near-far)`. Correct.
- `sets/lib-set3d.js:106-118` — `lookAt()` builds the standard R^T + translation view
  matrix, and the degenerate guards are real: `z` falls back to `[0,0,1]` when eye==target
  (`:108`), and the straight-down case where `cross(up,z)` collapses falls back to
  `cross([0,0,1],z)` (`:112`), which for `z=[0,±1,0]` yields `[∓1,0,0]` — non-zero. Verified.
- `sets/lib-set3d.js:140-150` — **`rotY`'s sign convention is correct against the 2D plan.**
  It applies `[c -s; s c]` to `(dx,dz)`, byte-identical to SVG `rotate()`'s matrix, and
  `lib-set.js:69-72`'s `hitTest` applies the exact inverse `[c s; -s c]`. Plan and 3D agree
  on rotation. The comment at `:141-145` is accurate. This is the thing most likely to be
  wrong in a hand-built engine and it is right.
- `sets/lib-set3d.js:323-335` — `rayTriangle` is a correct two-sided Möller–Trumbore:
  `p=rd×e2`, `det=e1·p`, parallel reject at 1e-9, barycentric rejects `u<0||u>1` and
  `v<0||u+v>1`, `t=e2·q/det` with a 1e-6 epsilon. `screenRay` (`:351-366`) hands it a
  normalized direction, so `t` is in feet. Correct.
- `sets/lib-set3d.js:373-380` — `SENSOR_W = 24.89`, `SENSOR_H = 18.66` are the correct
  Super 35 full-aperture dimensions (0.980″ × 0.735″). `lensFov(35,false)` = 39.15°,
  `lensFov(35,true)` = 29.85°. Both correct for that aperture.
- `sets/lib-set3d.js:304-317` — `hexToRgb` tests content before length, so `'nonsense'`
  (8 chars) takes the fallback rather than the RGBA branch. The comment at `:307-309`
  describes a bug that is genuinely fixed.
- `sets/lib-set3d.js:399-418` — `toOBJ` emits legal OBJ: 1-based indices, four verts per
  face, quad faces (legal n-gons), `g` per piece. `slug()` (`:442`) neutralises a newline
  in the plan name, and `scripts/test_set3d.mjs:240-242` proves it.
- `post/lib-post.js:41-149` — the best-modelled file in the slice. Pure business-day date
  math with no `Date.now()` anywhere, `topoSort` with real cycle detection returning
  `{error:'cycle'}` (`:100,124`), inclusive durations (`:113`), multi-parent milestones
  starting after the latest parent (`:107-111`), and backward scheduling solved exactly by
  translation-invariance rather than iteration (`:140-148`). The `!terminal` short-circuit
  at `:137-139` is correct on first iteration. This is fine as it stands.
- `wardrobe/lib-ward.js:42-85` — `cueName`/`charactersFromScript` is careful work:
  strips `(V.O.)`/`(CONT'D)` suffixes, rejects sluglines, transitions, non-caps, trailing
  punctuation, and requires an actual dialogue line to follow (`:71`). Good.
- `safety/lib-safety.js:217-227` — `paidDutyEstimate` enforces the minimum call correctly
  (`hours = max(minCall||4, hours||4)`), which is the detail that makes paid-duty numbers
  wrong when it is missed.
- `vfx/lib-vfx.js:124-141` — `board()` is safe against unknown statuses: `statusRank`
  returns −1 and `-1 >= 2` is false, so a corrupt status never counts as awarded money.
- `sets/gl.js:98-108` — WebGL and shader failures both return `null` and
  `sets/index.html:172-184` degrades to the 2D plan with an honest message. Correct.
- `sets/gl.js:96-99` — `preserveDrawingBuffer:true` is set, which is what makes
  `snapshot()` (`:395-398`) actually work rather than returning a blank PNG.

---

## What exists but needs work

### HIGH

- **`sets/lib-set3d.js:153-232` — every face normal in the engine points inward.**
  The header at `:20` states "triangles wind counter-clockwise when seen from outside".
  They do not — uniformly. Executed against the real library:

  | face | computed normal | should be |
  |---|---|---|
  | box top | `0,-1,0` | `0,+1,0` |
  | box bottom | `0,+1,0` | `0,-1,0` |
  | box −Z side | `0,0,+1` | `0,0,-1` |
  | box +X side | `-1,0,0` | `+1,0,0` |
  | cylinder side @ a=0 | `-0.966,0,-0.259` | outward ≈ `+1,0,0` |
  | cylinder top cap | `0,-1,0` | `0,+1,0` |

  `boxQuads`' top quad is `[hi0,hi1,hi2,hi3]`; viewed from above (screen right `+X`,
  screen up `−Z`) that order runs upper-left → upper-right → lower-right → lower-left,
  i.e. clockwise. Every other face follows suit.

  Three consequences, all live:
  1. `sets/gl.js:52` shades with `max(dot(n,key),0.0)`. A set's top surfaces get
     `dot < 0` from both key and fill and render at flat ambient `0.42` — the darkest
     value in the shader — while the undersides nobody sees are fully lit. **The set
     renders lit from below.** It has gone unnoticed only because `gl.js` never calls
     `gl.enable(gl.CULL_FACE)`, so backfaces still paint and there are no holes.
  2. `toSTL` (`:420-439`) writes both an inverted `facet normal` *and* clockwise vertex
     winding. STL's right-hand rule is violated on every facet, so a set exported to a
     slicer or to SketchUp arrives inside-out.
  3. `toOBJ` (`:399-418`) writes no `vn` at all, so importers derive normals from winding
     — same inversion.

  Fix: reverse the corner order in `boxQuads` (`:163-170`), the side quad and cap in
  `cylinderQuads` (`:180-181`). Everything else is built from those two, so both bugs
  and all downstream exports fall out with one change. Then add a test asserting
  `dot(faceNormal, faceCentre − itemCentre) > 0` for every quad — no current test checks
  orientation at all (`scripts/test_set3d.mjs:203-209` checks unit length only, and
  explicitly skips zero-length normals with `if (l > 1e-6 && …)`), which is exactly why
  this survived 63 passing assertions.

- **`sets/lib-set3d.js:223-228` vs `:382-393` — the camera mesh points 180° away from
  where the camera actually looks.** `cameraView` returns facing `(sin r, −cos r)`, i.e.
  `−Z` at rot 0 — up the page, matching the 2D plan's cone, which `lib-set.js:95-97`
  draws toward `−y`. But `cameraQuads` puts the lens barrel at `rotY(cx, cz + 1.1, …)`
  — `+Z`, *down* the page. Verified: at rot 0 `cameraView` direction is `0,0,-1` while
  the mesh's mass extends to `z = +1.42` and only `−0.90` behind. The mesh's lens direction
  is exactly `−1 ×` the view direction at every rotation. A designer orbiting the set sees
  every camera aimed at the opposite wall from the one its frustum covers, and
  `gl.js:172-200` draws the frustum wireframe from `cameraView`, so the drawn cone comes
  out of the back of the drawn body. One-character class of fix: `cz - 1.1` at `:225`.

- **Three different screenplay scene numberings across eight modules, and the majority
  one never emits scene 1.** `splitScenes` is copy-pasted into
  `props/lib-props.js:116`, `vfx/lib-vfx.js:54`, `music/lib-music.js:33`,
  `wardrobe/lib-ward.js:23`, `dailies/lib-dailies.js`, `casting/lib-castdesk.js`,
  `clearance/lib-clear.js`, `safety/lib-safety.js:88` — four textually distinct
  implementations, three distinct behaviours. Run against one script whose first line is
  `FADE IN:`, the first real slugline `INT. KITCHEN - DAY` is numbered:

  | module | scene numbers emitted | first real scene |
  |---|---|---|
  | props, vfx, music, wardrobe, dailies | `0, 2, 3` | **2** |
  | clearance | `1, 2, 3` | **2** |
  | safety | `1, 2` | **1** |

  The majority variant is plainly buggy on its own terms: `cur.n` is 0 for the preamble,
  and after it is pushed `scenes.length` is 1, so the first real scene gets `n = 2`.
  **Scene number 1 does not exist in any script with a title card, a FADE IN, or any text
  before the first slugline** — which is every real screenplay. So a props breakdown, a
  VFX shot board, a music cue list and a wardrobe change plot all cite scene numbers one
  higher than the pages the AD is holding, while the risk assessment for the same script
  cites the correct ones. Two departments reading the same script get different scene
  numbers for the same scene. This is the single highest-value correctness fix in my slice
  and the strongest argument for the shared parser proposed below.

- **`sets/lib-set.js:80-83` vs `sets/lib-set3d.js:373-380` — the same lens has two
  different fields of view on the same screen.** `CSet.fovDeg` uses `atan(18/f)`, a
  **full-frame stills 36mm** sensor; `CSet3D.lensFov` uses **Super 35** 24.89mm. Measured:

  | lens | 2D plan cone | 3D lens view | delta |
  |---|---|---|---|
  | 18mm | 90.0° | 69.3° | 20.7° |
  | 25mm | 71.5° | 52.9° | 18.6° |
  | 35mm | 54.4° | 39.1° | 15.3° |
  | 50mm | 39.6° | 28.0° | 11.6° |
  | 85mm | 23.9° | 16.7° | 7.2° |

  Worse, `sets/index.html:162` and `:206` print `S.fovDeg(...)` as the on-screen label —
  so the panel reads "FOV 54.4°" while `gl.js:255` renders the same camera at 39.1°, and
  `:206` writes "35mm · 54.4° horizontal" directly beneath a viewport showing 39.1°.
  A DP checking whether a 35 holds the two-shot gets a 15° lie from the plan and a
  different answer from the 3D view. Fix: delete `fovDeg` and have `lib-set.js` call
  `CSet3D.lensFov(lens,false)`, or lift the sensor constants into the shared units module
  below. Super 35 is the right reference for a film tool; full-frame stills is not.

  Related, one level down: `cameraView` (`:392`) returns `fovY` derived from the **4:3**
  full-aperture height (18.66), and `gl.js:255` then widens it by the *canvas* aspect.
  On a 16:9 viewport that yields a horizontal FOV of ~50.7° for a 35mm instead of 39.15°.
  The lens view should be letterboxed to the target aspect ratio and the FOV derived from
  the horizontal dimension, or "look through the lens" overstates coverage on every lens.

- **`sets/lib-set3d.js:235-245,262` — a door does not cut the wall it sits in.**
  `openingQuads` draws jambs, a header and a sill, and the comment at `:233-234` says this
  is so "a doorway reads as a blocked wall" is avoided. But `buildScene` (`:269-277`) maps
  every item to an independent mesh with no boolean subtraction anywhere, and a `wall` item
  is a solid box (`:263`). So the wall behind the door is still solid: the doorway renders
  as a frame drawn *on* an unbroken wall, and the camera cannot see or move through it.
  For a 3D set builder whose selling point is "look through this lens from this mark",
  not being able to shoot through a doorway is the feature failing at its own job.
  This is the largest piece of real work in the slice: `wall` needs to accept a list of
  openings (or `buildScene` needs to detect doors/windows whose footprint overlaps a wall)
  and emit the wall as up-to-four boxes around the hole. The 2D plan already carries
  everything needed — position, width, elevation, height.

### MED

- **`sets/lib-set3d.js:337-348` — `pick` cannot select an item whose id is falsy.**
  `best = m.id` and the return is `best ? {...} : null`. Verified: an item with `id: 0`
  returns `null`, an item with no `id` returns `null`, `id:'ok'` returns
  `{id:'ok',distance:18}` — the ray hit in all three cases. `CSet.uid()`
  (`lib-set.js:33`) currently yields `'i'+base36` so nothing hits this today, but
  `CProps.toSetItem` (`lib-props.js:73`) and any imported/synced plan can produce items
  without ids, and they become permanently unselectable in 3D with no error. Track a
  separate `hit` flag or test `best !== null`.

- **`sets/gl.js:278-286` — one draw call per item.** At 500 items that is 500
  `drawArrays` calls per frame, and the only per-mesh state is a single float uniform.
  Everything already lives in one interleaved buffer with `meshRanges` recording offsets
  (`:210-216`), so this can be **three** calls: `[0, sel.start)`, `sel`, and
  `[sel.start+sel.count, end)`. Better still, add a per-vertex `aSelected` float and make
  it one call. Same output, ~166× fewer calls.

- **`sets/gl.js:307-321,342-357 — `frame()` is called synchronously from every input
  event.** A 1000 Hz mouse produces up to 1000 full renders per second, each currently
  costing 500 draw calls plus six `getUniformLocation` and five `getAttribLocation`
  round-trips (`:260-275, 289-295`, re-queried every frame). Coalesce through
  `requestAnimationFrame` and cache the locations once at `create()`.

- **`sets/gl.js:202-238` — `setPlan` rebuilds and re-uploads the entire scene on every
  edit.** `sets/index.html:332` calls `refresh3d()` on every single field change and
  `:313` on every pointerup. At 500 items `triangulate` (`lib-set3d.js:282-302`) builds
  ~100k vertices by `push` into plain JS arrays (≈1M numbers) and then copies into four
  typed arrays — roughly 4 MB of churn per keystroke. Dirty-track the changed item and
  `bufferSubData` its range; `meshRanges` already knows where it is.
  `frameAll()` (`:386-393`) is a smaller instance of the same thing: it calls
  `buildScene()` — rebuilding every mesh — purely to read `bounds`, which is just
  `+plan.w`/`+plan.h`.

- **`sets/gl.js:399-402` — `destroy()` leaks the GL context.** It removes the two window
  listeners but not the six canvas listeners registered at `:360-367`, and never calls
  `deleteBuffer` on the five buffers or `deleteProgram` on the two programs. Browsers cap
  live WebGL contexts (typically ~16); repeatedly opening and closing the 3D view will
  eventually make `create()` return `null` and silently drop the user to the 2D fallback.

- **`sets/index.html:242-248` — orbiting the view changes the selection.** `gl.js:301`
  handles `mousedown` for orbit, but a `click` still fires on the canvas at the end of any
  drag, and the handler unconditionally re-picks and reassigns `sel`. Every orbit ends by
  selecting whatever happened to be under the cursor. Guard on `drag.moved`, as the 2D
  path already does at `sets/index.html:311`.

- **`sets/lib-set3d.js:181 — the cylinder cap emits a degenerate quad.** `[[cx,y1,cz],
  p0, p1, [cx,y1,cz]]` has identical first and fourth vertices, so triangulation yields
  one real triangle and one zero-area one. Verified: a `plant` produces 24 quads of which
  12 triangles are degenerate. In `toSTL` these are written as `facet normal 0 0 0` with
  two coincident vertices — many slicers and mesh validators reject zero-area facets
  outright. Emit the cap as a triangle fan rather than a fake quad. Separately, cylinders
  have **no bottom cap** at all, so no exported mesh containing a plant, a person, or a
  camera is watertight — which rules out 3D printing a model of the set, a normal art
  department use for STL.

- **`props/lib-props.js:85-94` — `fitsThrough` enumerates six orientations correctly but
  has no diagonal case, and reports false negatives.** The six footprints are exactly the
  three unordered dimension pairs in both orders — complete for axis-aligned passage, and
  the "carry it lengthwise" case is handled implicitly because only two of three dimensions
  are ever tested. That part is sound. What is missing is rotation *within the plane of the
  opening*. Verified against a tilt-aware solver:

  | prop (ft) | opening (ft) | `fitsThrough` | truth |
  |---|---|---|---|
  | 3 × 3 × 0.4 | 2.6 × 2.6 | **false** | fits (45° bbox = 2.40) |
  | 2.9 × 2.9 × 0.3 | 2.5 × 2.5 | **false** | fits |

  Any flat prop — a mirror, a tabletop, a framed painting, a door flat — wider than the
  opening but thin enough to angle through is reported as not fitting. That is the exact
  case a props master angles through a stage door every day, and the tool tells them not to
  try. Add the tilted test: sweep θ and check
  `a·cosθ + b·sinθ ≤ W && a·sinθ + b·cosθ ≤ H`. While there, two more:
  `f[0] <= w` treats an exact match as a fit (a 36.0″ prop through a 36.0″ door), so it
  needs a clearance allowance of a couple of inches; and the return is a bare boolean when
  what the department needs on the load list is *which* orientation works and by how much
  it clears.

- **`props/lib-props.js:73 — two placements of the same prop collide on id.**
  `id: 'prop_' + item.id` is deterministic, so placing prop `p3` twice on a set yields two
  items both called `prop_p3` (verified). `CSet.removeItem` (`lib-set.js:56`) filters by id
  and deletes **both**; `itemById` and `gl.js:143` return only the first; `gl.js:280`
  highlights one. A dining room with six matching chairs from one prop record is
  unmanageable. Append a per-placement suffix and keep `propId` as the link back —
  the field already exists at `:79` and is the right mechanism.

- **`safety/lib-safety.js` has no test suite at all.** `scripts/run_all_tests.mjs:39-60`
  discovers suites by globbing `test_*.mjs`, so there is no `MISSING` row to notice — the
  326-line `lib-safety.js`, the largest library in this slice and the one that produces
  legal risk-assessment documents, simply has zero coverage while every sibling
  (`test_props`, `test_set`, `test_vfx`, `test_wardrobe`, `test_music`, `test_post`) has
  40–60 assertions. Discovery-by-glob is the right design, but it silently rewards not
  writing a test. Worth an explicit "every `lib-*.js` has a `test_*.mjs`" check.

- **`safety/lib-safety.js:57 vs :247 — the hazard scan and the animal scan disagree.**
  `HAZARDS.animals` matches `cat leaps` but not a bare `cat`, while `SPECIES_RE` matches
  `cat` plainly. Verified on one script: `animalsInScript` reports a cat in scene 2;
  `analyze`'s animals hazard fired only because of an unrelated "Birds". A scene with a cat
  in it therefore gets an animal *budget* line and a wrangler day rate, but **no risk-
  assessment entry, no wrangler in the required-personnel list, and no safety-meeting
  item** (`:147-158`). The two lists should be driven by one species table.

- **`music/lib-music.js:65-83` — `scanScript` emits one cue per matching line.** A scene
  where a song plays across six lines of action produces six hits, and `cueFromHit`
  (`:105-110`) turns each into a separate cue titled `Scene N music (song)`. There is no
  per-scene dedupe. On a music-heavy script the cue list is unusable on first scan. Collapse
  to one hit per scene per term, keeping the best-quality title found (`QUOTED_RE`, `:60`).

- **`music/lib-music.js:216-235` — the cue sheet is missing the fields that make a cue
  sheet acceptable.** `cueSheet` emits SEQ/TITLE/ARTIST/USE/TIMING/PUBLISHER/MASTER OWNER.
  A delivery cue sheet is rejected without **PRO affiliation** (ASCAP/BMI/SESAC/SOCAN)
  and **percentage shares** per writer and publisher. `makeCue` (`:86-104`) has no field for
  either. Since the module's stated job at `:7` is "export a delivery cue sheet", this is
  the gap between a working document and a deliverable one. Add `pro` and `shares[]` to the
  cue model and two columns to the sheet.

- **`wardrobe/lib-ward.js:188-200` — quick changes are computed on the wrong axis.**
  `quickChanges` flags a character in adjacent *scene numbers* wearing different looks. But
  a quick change is a constraint of the **shooting order**, not the script order. Scenes 14
  and 15 may shoot three weeks apart; scenes 3 and 47 may shoot back to back — and then
  nobody is warned. The stripboard in `producer/` already holds the shooting order. Have
  `changePlot` accept an optional scene→shoot-day/position map and compute adjacency
  against it, falling back to script order when none is supplied. Same for
  `continuitySpans` (`:202-210`), where a gap in shooting order is the thing that actually
  requires the continuity photograph.

- **`scripts/test_set3d_browser.mjs` is flaky — the repo was not at 44/44 during this
  audit. Already being fixed by another agent; recorded here for completeness.**
  I observed `43/44 suites passed · 1 failing` in 2 of 4 full runs of
  `node scripts/run_all_tests.mjs`, while the suite passed 3/3 standalone. Suites run
  strictly sequentially (`run_all_tests.mjs:75-96`), so I wrongly ruled out contention and
  attributed it to load. The actual cause is **cross-process**: the suite hardcoded port
  8124 (`:18`) and `smoke_pages.mjs:23` hardcoded 8123, so with ~20 audit agents running
  the suite concurrently a second run bound nothing and talked to *another agent's* server
  serving a different working directory. The fixed `setTimeout(1200)` (`:24`) with no
  readiness poll made it worse. As of this writing the working tree already contains an
  uncommitted fix — a new `scripts/lib-testserver.mjs` that binds port 0, reads the
  OS-chosen port off `http.server`'s stderr, and polls until it answers, with both
  harnesses migrated to it. That is the right fix and I have nothing to add to it.
  The residual point that stands on its own: the pixel assertions still sit behind a fixed
  `waitForTimeout(500)` (`:128,142`) through software SwiftShader, which is the same
  sleep-and-hope pattern one layer up and will bite on a loaded machine.

### LOW

- `vfx/lib-vfx.js:43` — the cue `['sky', 'Sky replacement / enhancement', 'simple']` is a
  bare `\bsky\b`, so every exterior scene that mentions the sky proposes a $500–1500 VFX
  shot; `:46` `flies|flying` catches "time flies". Require a second signal or expose a
  sensitivity control, or the auto-detected board arrives full of noise.
- `sets/lib-set3d.js:242-243` — `openingQuads`' header and sill span the full item width
  while the jambs already occupy the outer 0.3 ft over the full wall height, so the two
  overlap. Harmless in the viewport (coincident faces), but it makes the exported solid
  self-intersecting and non-manifold. Inset the header/sill by `jamb`.
- `sets/lib-set3d.js:269` — the comment says "Whole plan → meshes, plus the floor" but no
  floor mesh is produced. The floor is drawn as a line grid in `gl.js:155-168`, which means
  `pick` can never hit the ground (no click-to-place) and neither export contains a stage
  floor. Say so, or add one.
- `sets/lib-set3d.js:69` vs `:310-313` — `colorOf` accepts only 6-digit hex, but
  `hexToRgb` handles 8-digit RGBA. The only 8-digit value that can ever reach it is the
  hardcoded `vehicle` profile at `:46`, and `sets/index.html:160` slices any colour to 7
  chars for the picker, so per-item alpha is unreachable. Pick one.
- `sets/gl.js:289-295` — `bind()` never calls `disableVertexAttribArray` for locations the
  next program does not use. It happens to work because both programs' attribute locations
  overlap in declaration order, but that ordering is the linker's choice, not a guarantee.
- `post/lib-post.js:71-77` — `busDiff` walks one business day at a time, allocating several
  `Date` objects per step, bounded at 20000. Offsets are small in practice; a direct
  weeks×5 computation would be O(1).
- `props/lib-props.js:167` — `rentCost` reads `item.scenes.length` unguarded. The UI always
  supplies `scenes: []` (`props/index.html:300`), so it does not fire today, but any
  cloud-synced or imported item without the field throws a `TypeError` (verified) and takes
  the whole estimate down. `(item.scenes || []).length`.
- `props/index.html:300` — `id: 'm' + Date.now()` collides for two props added in the same
  millisecond, which then compounds with the `toSetItem` collision above.
- `props/lib-props.js:111` — plural handling is `term + 's?'`, so irregulars are missed
  (`knife` will not match "knives"). Minor, but "knives" is a weapons-category miss.
- `safety/lib-safety.js:202-213` — `paidDutyNeeds` can push duplicate reasons for one
  scene when several hazards qualify; it has no dedupe, unlike `meetingChecklist` (`:157`).
- `props/lib-props.js:288-296` — `buildOverpassQL` interpolates `lat`/`lon` into the query
  without an `isFinite` guard. They come from `parseNominatim`'s `+r.lat`, so the worst case
  is a `NaN` in the query and a failed request rather than injection — but guard it anyway.

---

## What is missing entirely — supporting software

These are the pieces that would let the existing tools be built out, rather than new
modules. Ranked by value.

1. **A shared screenplay parser — `js/script-parse.js`. Value: HIGHEST.**
   `splitScenes` exists in eight libraries as four textual variants with three different
   numberings, and the majority variant is wrong (see HIGH above). Every module that reads
   a script re-derives scenes, and none of them agree. One module exporting
   `splitScenes(text) → [{n, slug, body, intExt, location, dayNight}]` fixes the numbering
   bug once, gives every department the same scene numbers, and unlocks things no module
   can do today because it only has `slug` as an opaque string — e.g. grouping props by
   location, or letting `safety`'s night-exterior rule read a parsed `dayNight` instead of
   a regex over raw text (`safety/lib-safety.js:63`). Roughly 150 lines plus one test
   suite, and it *deletes* code from eight files. The migration must preserve current
   numbering behind a flag or renumber stored breakdowns, since owners have live data.

2. **A shared units and dimensions library — `js/units.js`. Value: HIGH.**
   Feet are the unit everywhere, but the conventions collide at the seams:
   `props` uses `{w, d, h}` = width/depth/height, while a `sets` item's `.h` is *footprint
   depth* and `.hgt` is height (`lib-set3d.js:249`). `toSetItem` (`lib-props.js:70-81`)
   silently transposes between them; nothing enforces that it stays right. The Super 35
   sensor constants live in `lib-set3d.js:373` while a second, contradictory sensor model
   lives in `lib-set.js:82`. A units module owning `{w,d,h}` as one type, feet↔metres↔
   inches conversion, and the sensor/lens table would collapse the FOV disagreement and
   make `fitsThrough` able to take a *set plan* and answer the question it should be
   answering: "which of these props cannot get onto this stage through these doors?"
   `sets` already knows every door's width and `PROFILES.door.h` (`lib-set3d.js:34`), and
   `toSetItem` already carries `propId` — the two halves exist and are not joined.
   Also the place to state the OBJ/STL unit problem: neither format declares units, so a
   24 ft set imports into Blender as 24 metres. An explicit metres-export option belongs here.

3. **A scene graph for `lib-set3d.js`. Value: HIGH.**
   Today `buildScene` (`:269-277`) is a flat `items.map(itemMesh)`; every quad is baked in
   world space by `rotY` at build time, so nothing can be moved without rebuilding it, and
   nothing can be parented. A minimal node graph — `{transform, children, mesh}` with the
   world matrix composed at draw time — is what makes the rest of the wanted features
   possible: moving an item becomes a uniform update instead of a 4 MB buffer rebuild
   (see MED above); a wall with its doors and set dressing becomes one movable unit, which
   is how a set is actually struck and re-erected; and per-node bounding boxes give `pick`
   a broad phase, which it badly needs — it currently tests every triangle of every mesh
   with per-triangle array allocation (`:337-348`). Moderate work, roughly 200 lines, and
   it is the prerequisite for items 4 and 5.

4. **An instancing path. Value: MED.**
   A set is repetition: forty chairs, twelve place settings, a row of flats. Each is
   currently a full copy of its geometry in the vertex buffer — the reason 500 items means
   ~100k vertices. With the scene graph in place, `ANGLE_instanced_arrays` (a WebGL1
   extension, no third-party code, consistent with the constraints) reduces that to one
   copy of each profile's geometry plus a per-instance transform and colour. Combined with
   the draw-call fix this is the difference between a 500-item set being unusable and
   being fluid. It also shrinks the OBJ export, which can then reference one `g` block per
   profile.

5. **A materials system. Value: MED.**
   `colorOf` (`:67-70`) is the whole of it: one flat RGB per item. `toOBJ` emits no
   `usemtl` and no companion `.mtl`, so the colours a designer chose are **lost on export**
   — a previz vendor receives untextured grey geometry. A small material table
   (`{name, diffuse, roughness, doubleSided}`) referenced by profile and overridable per
   item would carry through to a real `.mtl` sidecar, let `greenscreen` render as an actual
   keyable green and `window` as transparent (both currently opaque boxes), and give the
   shader something better than a single ambient term.

6. **Wall openings as a first-class concept. Value: HIGH, but it is really the fix to the
   HIGH finding above rather than new software.** Whatever form it takes — an `openings[]`
   array on a wall item, or footprint-overlap detection in `buildScene` — it needs to exist
   before the 3D view can honestly claim to show what a lens sees.

---

## Evidence

Files read in full: `sets/lib-set3d.js` (457), `sets/gl.js` (408), `sets/lib-set.js` (154),
`props/lib-props.js` (356), `safety/lib-safety.js` (327), `vfx/lib-vfx.js` (221).
Read in part: `sets/index.html:100-398`, `music/lib-music.js:1-140` and `140-246`,
`wardrobe/lib-ward.js:1-130` and `130-274`, `post/lib-post.js:1-150`,
`scripts/run_all_tests.mjs:15-110`, `scripts/test_set3d.mjs:195-243`,
`scripts/test_set3d_browser.mjs:1-40`, `props/index.html:300,393`.

Executed, not inferred — all against the real libraries under node:
- Face normals for `boxQuads` (all six faces), `cylinderQuads` (side and cap), producing
  the inversion table in the first HIGH finding.
- Camera mesh Z-extent (`min 9.10 / max 11.42` about `cz=10`) against `cameraView`'s
  direction `(0,0,-1)`, establishing the 180° error.
- `lensFov` at 18/25/35/50/85mm vs `CSet.fovDeg` at the same focal lengths, producing the
  FOV delta table.
- `S3.pick` with `id:0`, `id:undefined`, `id:'ok'` — first two return `null` on a hit.
- `splitScenes` across props/safety/vfx/music/wardrobe/clearance/dailies on one script with
  a preamble, producing the scene-numbering table. `md5sum` over the extracted function
  bodies confirmed four distinct texts across the eight files.
- `fitsThrough` vs a 0.25°-step tilt-aware solver over all three face pairs, producing the
  two confirmed false negatives.
- `toSetItem` called twice for prop `p3` — both returned `prop_p3`.
- `priceItem` on a `vehicle` item without `scenes` — confirmed `TypeError`.
- `node scripts/run_all_tests.mjs` run four times: `43/44 · 1 failing` twice,
  `44/44` twice, with `set3d browser` the only varying suite;
  `node scripts/test_set3d_browser.mjs` standalone passed 3/3 at 32 assertions.

Not verified, and flagged as such:
- I did not run the 3D viewport in a browser, so the visual consequence of the inverted
  normals ("tops render at flat ambient 0.42") is derived from the shader source at
  `sets/gl.js:52` and the measured normals, not observed. The normals themselves are
  measured fact; the appearance is inference.
- I did not diagnose the `set3d browser` flake correctly on my own — I measured its rate
  and ruled out intra-run contention, but the cross-process port collision was identified
  by another agent whose fix appeared in the working tree during this audit.
- `scripts/smoke_pages.mjs`, `scripts/test_set3d_browser.mjs` and the new
  `scripts/lib-testserver.mjs` show as modified/untracked in `git status`. Those are
  another agent's concurrent work, not mine. The only file this audit created is this
  report.
