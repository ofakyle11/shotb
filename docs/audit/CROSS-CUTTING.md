# Cross-cutting findings

Patterns visible only across reports. No single agent could see these; each
found one instance and reasonably reported it as a local bug. Fixing them
locally, module by module, would be the wrong call — they are one defect each.

Updated as Phase 1 lands. Sources cited by report.

---

## 1. Five modules parse scene numbers differently (CONFIRMED ×3 independently)

Every department breaks the script down with its own regex, and they disagree.
On any numbered shooting script with an A-scene, **each department is working
from a different film**.

| Module | Where | Behaviour |
|---|---|---|
| budget engine | `js/budget-engine.js:279` | has `[A-Z]?` |
| props | `props/lib-props.js:120` | **lacks** `[A-Z]?` — A-scenes invisible |
| wardrobe | `wardrobe/lib-ward.js` | diverges on `12A.` / `101B` |
| safety | `safety/lib-safety.js:92` | disagrees with SLUG_RE *in the opposite direction* |
| studio budget | `timeline/timeline-budget.js:282` | `SLUG_RE` |

Verified consequences, each by executing the code:
- props: a script of 1 / 14A / 15 yields **2** scenes vs the board's 3, so 14A's
  props are filed under scene 1 and 15's under scene 2 — silently offset from
  every other department (crew-08).
- safety: fall-from-height and crowd hazards attributed to an `INT KITCHEN -
  DAY` scene while the real `EXT. ROOF - NIGHT` is omitted entirely — and
  `today/index.html:111` **joins the two schemes** to build the day's briefing
  (crew-15).

**Fix: one shared scene/slugline parser in `js/`, adopted by all five.** Not
five regex patches. This is the highest-leverage single change found so far.

---

## 2. The budget total does not propagate — downstream reads $0

`producer/budget-sheet.js:62` computes line items as `amt × units × rate` and
leaves `est` at 0. `finance/lib-money.js:53` and `investors/lib-invest.js:207`
sum `est` only. Verified by execution: `budgetTotal → 0`, cost report
`variance −52000, over: true`.

So the quarterly investor letter either prints "budget not yet locked" or
declares the picture over budget by the entire spend — **a wrong number in a
document that goes to investors**. `tools/tools-money-ui.js:132` already does
it correctly, so the right shape exists in the codebase (crew-03).

---

## 3. Shared stores are written in incompatible shapes, or read by nobody

- `SB_Deals_v1` — `contracts/index.html:77` writes `{v:1,deals:[]}`;
  `tools/tools-registers.js:157` writes a bare array. Both directions throw.
  `tools/index.html:112` marks the tab initialised before calling, so Buyers &
  Investors stays permanently blank (crew-03).
- `propId` — written by props onto placed set items, **read by nothing**, so
  the set-dressing list per set cannot be produced although the data exists
  (crew-07).
- `SB_Wardrobe_v1` — never joined to `SB_ScheduleBoard_v1`; one reader only.
  Story days do not exist anywhere in the repo (zero grep hits) (crew-09).

**Fix: the canonical project schema TEAM A DEV 06 was asked to design.** These
are symptoms of no shared model, not three unrelated bugs.

---

## 4. The call sheet is where everything converges, and it carries almost none of it

`producer/schedule-board.js:300-344` prints scenes, cast, locations, notes.
`dayMeta = {call, date, notes}` — one general call time.

Missing, though the data already exists elsewhere in the platform:
- hospital, medic, emergency numbers, scene hazards (crew-15)
- HMU / wardrobe / on-set backward-derived call times (crew-09)

Three departments independently identified the call sheet as their delivery
point. It should be assembled from every department's store, not typed.

---

## 5. A 35mm lens gets THREE different answers on one page (CONFIRMED ×3)

Found independently by production design, grip & electric, and the director.

| Surface | Value for a 35mm | Source |
|---|---|---|
| 2D plan cone | **54.4°** (full-frame) | `sets/lib-set.js:80` |
| 3D wireframe frustum | **39.1°** (Super 35) | `sets/lib-set3d.js:373` |
| what is actually rendered | **50.7°**, and it changes when you resize the window | `sets/gl.js:255` |

`sets/index.html:206` then prints the **2D** number as the caption on the **3D**
view. `gl.js:255` takes fovY from the S35 aperture but `aspect` from
`canvas.width/canvas.height`, so horizontal coverage is the browser window's
shape rather than the film format's — only a 4:3 panel is correct.

The gaffer's note is the one that lands: *"Same item, 15° apart — that gap is
where I put stands and flags."* A proper nine-entry sensor table already exists
unused at `tools/lib-media.js:59`. There are no frame lines and no cinema
aspect ratios anywhere in the repo.
- Doors and windows never cut the walls they sit in — `buildScene()` has no
  boolean subtraction, so every OBJ/STL exports with bricked-up openings and
  "look through the lens" shows a wall where the actor enters. The comment at
  `sets/lib-set3d.js:234` claims the opposite (crew-07).

I shipped this module. The lens sign convention was tested; the *sensor* and
*aspect* were not, and the 2D/3D disagreement was never asserted anywhere.

---

## 6. Department numbers are not derived from department content

- Art allowance is `artPerDay × shootDays` (`js/budget-engine.js:650`) — set
  count, set size and the priced props list have **zero** effect (crew-07).
- The props budget reaches neither account 9000 nor the cost report, while
  eight other modules call `CMoney.addPO` (crew-08).
- `contracts/lib-deal.js:14` posts wardrobe and HMU memos to account **3000
  (Direction)** while the chart puts them at 10000/11000, so the wardrobe line
  can never reconcile (crew-09).
- `multiplesAdvice()` recommends buying 4 of a hero garment while `lookCost()`
  sums each piece once with no `qty` field — **the platform tells you to buy
  four and budgets for one** (crew-09).

---

## 7. Confident labels over heuristics that do not hold up

- Safety hazard detection returns HIGH pyrotechnics and demands a licensed
  pyrotechnician for *"MARY burns the toast"*, HIGH stunts for *"Don't fight
  it"*, an animal wrangler for *"lucky dog"* — while a knife slashing, a man
  falling and cracking his head, and a fence climb come back as severity 1.
  `safety/lib-safety.js:16` matches `knife fight` but not bare `knife`, which
  `props/lib-props.js:98` does have (crew-15).
- Props breakdown reads dialogue and bare verbs: six false positives on
  ordinary prose, and "Bow" trips an automatic $1,950 armorer line (crew-08).
- The Editor's "grade" is four CSS canvas filters; there is no colour
  management, no HDR, and the one real `.cube` LUT parser
  (`tools/lib-media.js:15`) is stranded in a stills tab (crew-19).

An insurer who reads a pyrotechnician demanded for toast stops reading the
pack. These need either real accuracy or honest hedging in the UI — the
platform's own rule about not inventing what it does not know applies to
inferences, not just phone numbers.

---

## 8. Verified export/delivery defects (crew-19)

- `editor/cut-ui.js:702` — export fps and `project.fps` are separate numbers,
  never reconciled; `project.fps` is set to 24 by `blank()` and **nothing ever
  writes it**. Export at 30 → a 30 fps master with a 24 fps EDL and OTIO, every
  record timecode in the turnover off by 25%. Three-line fix.
- `editor/lib-mp4.js:141` — no `colr` box, so primaries/transfer/matrix are
  undefined; language hardcoded `und`; no `ctts` while `avc1.640028` runs at
  default `latencyMode:'quality'`, so B-frames would play out of order.
- No loudness anywhere (zero hits for LUFS/R128/1770/true-peak).
  `editor/cut-ui.js:628` sums every clip to `destination` at unity with no gain
  node and no limiter — it hard-clips.

---

## 9. The correct implementation usually already exists, in another module

**This is the most important finding of Phase 1 so far**, and no single agent
could state it — each found one instance and reported it as a local gap. The
platform repeatedly contains a correct, tested implementation in one module and
a broken reimplementation of the same thing in another.

| The thing needed | Where it already exists, working | Who reimplemented it badly |
|---|---|---|
| Cue-based character extraction | `casting/lib-castdesk.js:56` (cue-verified, tested) | stripboard scans scene *prose* — a character merely mentioned gets `SW` and a call |
| Turnaround, meal penalty, 6th/7th day | `tools/lib-money.js:47` `TMoney.timecard()` — implemented **and tested** | `producer/index.html` does not even load the file |
| Sensor/format table (9 entries) | `tools/lib-media.js:59` | `sets/` hardcodes one aperture, disagrees with itself |
| Budget line arithmetic | `tools/tools-money-ui.js:132` | `finance`, `investors` sum a field nothing writes |
| Rights with territory/term/media/expiry | `tools/tools-registers.js:128` `SB_Rights_v1` — has `Music sync`/`Music master` kinds | `music/` stores one `publisher` string |
| Grouping shots by real slugline | `producer/schedule-board.js:61` | `boards/lib-shots.js:22` invents scenes from a 9-item label array |
| Ray/triangle occlusion test | `sets/lib-set3d.js:323` `pick()`/`rayTriangle()`, tested | light shading is two hardcoded constant directions |
| Framebuffer capture | `CSetGL.snapshot()`, `preserveDrawingBuffer` already set for it | nothing calls it, so a lens view cannot become a board frame |

**Consequence for Phase 2:** a large share of the backlog is *wiring, not
writing*. Deleting the bad copy and calling the good one is cheaper, smaller
and safer than building new — and it removes the divergence permanently rather
than adding a fifth version of it.

---

## 10. The chart of accounts is wrong in at least four places (CONFIRMED ×4)

Money is committed to accounts that are not the department's, so no line can
reconcile and the cost report is wrong wherever it is used.

- `contracts/lib-deal.js:14,61` posts **wardrobe, HMU, composer and all crew**
  to account **3000 (Direction)**, and **cast to 2000 (Producers Unit)**.
- `casting/index.html:340` commits to account **1400, which does not exist in
  the chart** (Cast is 4000, `producer/budget-sheet.js:18`) — so it lands as a
  permanently over-budget "Unbudgeted" line.
- `casting/index.html:346` commits **one week's rate**, not the engagement.
- The props budget reaches neither account 9000 nor the cost report at all.

Sources: crew-03, crew-06, crew-08, crew-09, crew-18.

---

## 11. Three take logs, and the report reads the one nobody writes (CONFIRMED ×4)

- `/dailies/` writes `SB_Dailies_v1`. Tools writes via `tools-media-ui.js`.
  The DPR (`production/production.js:220`) reads `SB_TakeLog_v1`.
- A full day logged in the best of the three never reaches the daily report.
- `production/lib-prod.js:30` tests `t.status || t.print`; the only writer
  stores that field as `grade`. Verified: 3 takes, 2 circled → `printedCount: 0`.
  **Always zero, for every production, since it was written.**
- `:27` filters on `t.date`, which none of the three stores writes (they write
  `time` and `day`), so every take ever logged is reported on every day.
- "Send picks to Editor" writes `SB_DailiesPicks_v1`, which **nothing reads**.

Sources: crew-02, crew-05, crew-13, crew-14.

---

## 12. Green tests over dead features

`scripts/test_modules.mjs:96` exercises `CProd.dpr` with a **synthetic
`status:'print'` shape that nothing in the application ever writes**. The suite
has passed continuously over a feature that returns zero in production.

This is the same failure class as `test_learn.mjs`, which printed "All learn
checks passed" unconditionally with no `process.exit` — every green run since
it was written meant nothing. That one was caught earlier and fixed.

**The lesson generalises: a test that builds its own fixture instead of using
the shape the app writes proves only that the function runs.** Phase 2 should
add, for each store, one assertion that the *writer's* output shape satisfies
the *reader's* expectations. That single class of test would have caught
findings 2, 3, 10 and 11 above.

---

## 13. Individually severe, verified, not yet grouped

- `timeline/parser.js:377` — `if(lineCount<20 && t.length>250)` runs the
  PDF-repair path even when `isScriptFlattened` correctly says false.
  Reproduced: `INT. KITCHEN - NIGHT` becomes heading `INT. KITCHEN -` plus a
  shot called "NIGHT", and action becomes dialogue. **Hits every short, spot
  and test scene**, and the corrupted slugline propagates to locations, boards,
  dailies coverage and the stripboard (crew-02).
- `timeline/timeline-continuity.js:232` — fabricates a hardcoded `VORSANGER`
  lead character into any screenplay containing the standalone token "90"
  (crew-14).
- `producer/schedule-board.js:217` — `#sbBoneyard` survives every render but
  `wireDnD()` re-binds it each time, and its drop handler calls `render()`.
  **Drop listeners double per unschedule drag: 1, 2, 4, 8, 16, 32 confirmed**
  (crew-05).
- `producer/index.html:271` — the "Add script" modal writes `characters:{}`, so
  every strip gets `cast:[]`, the DOOD renders nothing and `boardOverrides()`
  returns `{}` (crew-05).
- Days are indices and `dayMeta.date` is free text, while the Day Planner
  computes real dates into `SB_ShootPlan_v1` and never writes back — so **no
  date-based constraint can exist at all** (crew-05).
