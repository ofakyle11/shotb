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

## 2. FIVE budget-total implementations, four of them wrong (CONFIRMED ×2)

The toolbar advertises an **Amt × Units × Rate** calculator. Only
`producer/budget-sheet.js:69` uses `itemEst()`. These four read `it.est`
directly, which is **zero** for every line entered that way:

- `finance/lib-money.js:53` — the cost report
- `investors/lib-invest.js:207` — the quarterly investor letter
- `workflow/advisor-ui.js:31` — the advisor
- `js/learn.js:60` — **the learning layer**

Verified by execution: a "6 × 20 days × $700" camera line reads **$84,000** on
the top sheet and **$0** in the cost report — `variance: -84000, over: true` on
day one. The investor letter either prints "budget not yet locked" or declares
the picture over budget by the entire spend. **A wrong number in a document
that goes to investors** (crew-03, crew-04).

`tools/tools-money-ui.js:132` does it correctly, which is what makes the other
four oversights rather than a design.

**Two further defects in the same path** (crew-04):
- The cost report drops fringes, bond, insurance and contingency entirely —
  verified grand total **$1,463,000** vs cost-report budget **$1,000,000** — and
  there is no 19000 Contingency row, so contingency can never be drawn down.
- The CSV export omits the fringe/bond/insurance rows, so **$330k appears from
  nowhere** between SUBTOTAL and GRAND TOTAL. And the whole top sheet renders
  through `fmtMoney` at two significant figures: `$163k` for $163,412.

**Note for Phase 4:** `js/learn.js` is one of the four. The existing learning
layer is learning from a field that is zero — so whatever it currently claims
to have learned about budgets is learned from nothing. Phase 4 must not build
on top of it without fixing this first.

**The test that would have caught all of it:** one assertion that
`sum(budgetByAcct) === sheetTotals().grand`. `scripts/test_ops.mjs:19` uses a
bare `{est: N}` fixture, so the entire bug class is invisible to the suite —
see finding 12.

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

---

## 14. Further confirmations of finding 9 (already exists, unused)

- **Sun times.** `locations/lib-scout.js:480` `goldenHour()` returns *solar*
  time with no longitude, timezone or DST correction. `tools/lib-sun.js` is a
  correct NOAA/Meeus implementation, **already tested**, and is simply never
  loaded on the Locations page. Measured error on 21 June sunset: Atlanta 19:12
  vs 20:52, Toronto 19:43 vs 21:03, Vancouver 20:07 vs 21:23 — **up to 1h40m**,
  on the number that decides whether you make the day (crew-12).
- **Reel / source timecode / checksum for relinking.** Dailies already captures
  `tcIn`, `soundRoll` and `lens`; Tools already SHA-256s every file; the Editor
  bin carries none of it, so `edl()` writes `AX` for every event with no
  `* SOURCE FILE:` line. Three modules hold the pieces and none talk (crew-17).

## 15. Silent wrong answers, where failing loudly was the only safe option

A wrong number presented confidently is worse than a blank, and this pattern
recurs independently of the modules it appears in.

- `today/index.html:106` falls back to **the first location in the book with
  any hospital** when its match fails — no caveat shown. Its slugline parser is
  weaker than the stripboard's (no en-dash, no scene number), which makes that
  failure the *common* path, not the rare one. So the phone prints a real
  hospital, for the wrong location (crew-12).
- `casting/`: with no TMDB key `directorFilms` is always `[]`, yet the card
  renders **"Fit with <Director> — 36/100" under a gold bar** for a comparison
  that never ran. Wikidata carries no billing field, so every performer is
  pinned at "Established supporting, $25k–$150k" with the basis printed as *"no
  recent top-billed roles found"* — a stated fact the code cannot observe
  (crew-06).
- `cut-ui.js:141` mints a new id on every import and nothing reassigns
  `clip.srcId`, so a `missing` source is permanent — the UI's **"re-import
  needed" is a lie** (crew-17).
- Weather is built but CSP-blocked at `_headers:4` and **fails silently**
  (crew-12). `tools/sched-weather.js:150` computes and scores wind, then never
  displays it — the one number deciding whether a 20×20 flies (crew-11).

These are the same class as the security work's `CinUrl.safe()` rule: when the
platform cannot vouch for something, it must say so rather than substitute a
plausible value.

## 16. Two stores for one concept, repeatedly

Beyond `SB_Deals_v1` (finding 3), the same split recurs:

| Concept | Store A | Store B | Consequence |
|---|---|---|---|
| Locations | `SB_ScoutBook_v1` | `SB_Locations_v1` | Advisor reads the one **without** the hospital (crew-12) |
| Take log | `SB_Dailies_v1` | `SB_TakeLog_v1` | DPR reads the one nobody writes (crew-13/14) |
| Cue list | `SB_Music_v1` | `SB_CueSheet_v1` | neither can produce a PRO cue sheet alone (crew-18) |
| Casting | `SB_CastingDesk_v1` | pipeline store | complementary halves of one status vocabulary (crew-06) |
| Editor | `editor/` | `editor/timeline-engine.js:409` still mounted in the Studio | second editor whose EDL has **no event lines at all** (crew-17) |


---

## 17. ROOT CAUSE of finding 1: the scene number is discarded at parse

Finding 1 listed five modules that each parse scene numbers differently. The
development audit found *why* they all have to: **the printed scene number is
thrown away the moment the script is read.**

- `timeline/parser.js:61` discards the printed number in a **non-capturing
  group**.
- `dailies/lib-dailies.js:27` therefore numbers scenes by **array position**.
- Dailies takes, `wardrobe/lib-ward.js:98`, `safety/lib-safety.js:147`,
  `vfx/lib-vfx.js:189` and the stripboard all key off a number that **silently
  shifts when a scene is inserted**.
- A/B numbering cannot be expressed at all.

So the five regexes are not five independent bugs — they are five departments
each trying to re-derive a fact the parser already had and threw away. **Capture
it once at `parser.js:61`, carry it on the scene, and findings 1 and 17 both
close.** This is now the single highest-leverage change in the backlog.

---

## 18. Page count is 4.4× wrong, and it drives the schedule and the budget

`timeline/timeline-budget.js:285` counts eighths in **physical newlines ÷ 5**,
not typeset lines. Every Writer output and every unflattened PDF has unwrapped
paragraphs, so the count is meaningless for exactly the documents the platform
produces itself.

Measured: a **4,136-word draft (≈22 pages) reports 5 pages / 40 eighths** — a
**4.4× under-measure**. That number flows into `shootDays`
(`timeline/timeline-budget.js:563`), the stripboard, and from there the entire
budget.

There is no pagination anywhere in the repo. Combined with finding 2, the two
biggest numbers a producer relies on — how many days, and how much — are both
computed from inputs that are wrong by construction.

---

## 19. Development has no idea→treatment path, and `toFountain` writes prose

- The Writer's precondition is that **you already own a treatment**. Idea →
  logline → treatment does not exist.
- `writer/lib-treatment.js:220` `toFountain` does not write a screenplay; it
  re-headers treatment prose verbatim — no dialogue, no screen direction, no
  sections.
- `:101` destroys act structure, verified by execution: `ACT ONE` becomes
  `INT. ONE - DAY`; `SEQUENCE 2 — THE HEIST` becomes `EXT. — THE HEIST - NIGHT`.
  **These fake locations then propagate into the location bible and the
  stripboard.**
- `scripts/test_writer.mjs:76` only asserts the slug starts with `INT.`, so
  44/44 passes over it — another instance of finding 12.
- Three modules overwrite `SB_Timeline_v1.scriptText` with **no snapshot**
  (`writer/writer.js:213`, `producer/index.html:271`, `timeline/timeline.js:1071`).
  The Writer has no undo and swallows quota errors silently.
- Nothing on the development path calls a model: `parse-script.js` **has no
  caller and is not in the deploy set**.

(crew-01)

---

## 20. "E&O-ready" can be reached having cleared nothing (crew-20)

The most serious instance of finding 15, because the output is a representation
made to an insurer.

`clearance/lib-clear.js:105` counts only `pending` as open. Set every finding to
**"accepted risk"** and `eoReady` returns **true**, with the green banner at
`clearance/index.html:95` inviting you to *"Package the report with your E&O
application"* — **zero items actually cleared**.

It also ignores `SB_Rights_v1`, `SB_Music_v1` and `SB_Insurance_v1` entirely, so
an empty chain of title, no licences and no certificate of insurance still reads
**CLEAR**.

## 21. Distribution exclusivity is wrong in both directions (crew-20)

`distribution/lib-dist.js:86` keys on free-text strings and ignores dates.
Verified:

| Input | Correct | Actual |
|---|---|---|
| Worldwide/SVOD + Germany/SVOD | conflict | **0 conflicts** |
| "United States" vs "USA" | conflict | **0 conflicts** |
| Canada/SVOD 2027 + Canada/SVOD 2035 | no conflict | **1 false conflict** |

This is the territory/term/media model finding 9 says already exists in
`tools/tools-registers.js:128` `SB_Rights_v1`.

## 22. Final confirmations from the last two crew reports

Adding to existing findings rather than new ones — which is itself the point:
twenty independent auditors converged on the same handful of root causes.

- **Finding 1/17 (scene numbers):** `vfx/lib-vfx.js:58` rejects A-scenes while
  `timeline/timeline-budget.js:282` accepts them. Verified: a 3-scene sample
  with one A-scene returns 2 scenes and attributes the A-scene's explosion to
  scene 1. **Every scene number after the first revision page is wrong —
  exactly when a VFX supervisor needs it.** That is now **six** modules.
- **Finding 10 (chart of accounts):** `vfx/index.html:247` commits POs to
  `15000` (all of Post-Production) while `js/budget-engine.js:702` budgets VFX
  at `15200`, so cost-per-shot against a VFX line cannot be asked anywhere.
- **Finding 9 (correct version exists elsewhere):** `vfx/lib-vfx.js:107` stores
  `committedPo` as a **boolean**, discarding the PO number, so a deleted shot
  orphans its PO forever — while `post/lib-post.js:212` in the same codebase
  stores `po.num` correctly.
- **Finding 16 (two stores per concept):** `SB_VfxBoard_v1` (IDs by tens) vs
  `SB_VfxShots_v1` (`production/production.js:260`, a **random** 101–990 ID) —
  both visible to the same owner, neither read by anything else. Plus
  `SB_Festivals_v1` and `SB_Deals_v1`, where the two writers use incompatible
  shapes and **one silently destroys the other**: Tools-first and the
  Strategist's save drops every submission, buyer and premiere status;
  object-first and the Tools tab throws `rows.reduce is not a function`.
- `detectShots` emits one shot per cue *per scene*, so a 14-cut dragon sequence
  bids as **one shot**.

**Cheapest high-value build found in the whole crew sweep:** `sets/gl.js:395`
has a working lens-accurate `snapshot()` that nothing calls, and
`boards/lib-shots.js:37` has an `img` field waiting for it. A "send frame to
board" button is real previz for roughly thirty lines.

---

# What the crew sweep actually concluded

Twenty auditors, twenty departments, and they converged rather than diverged.
Almost every individual finding rolls up into six root causes:

1. **The scene number is discarded at parse** (`timeline/parser.js:61`), so six
   modules re-derive it differently and every department breaks down a
   different film.
2. **Page count is measured in newlines** (4.4× wrong), and it drives shootDays
   and the budget.
3. **The budget total is read from a field nothing writes**, in four places
   including the learning layer.
4. **There is no canonical project model**, so eight concepts have two stores
   each and several silently destroy one another.
5. **Money is posted to accounts that are not the department's**, so nothing
   reconciles.
6. **The correct implementation usually already exists in another module** —
   which means much of the fix is deletion and wiring, not new code.

Ranked honestly, fixing 1, 2 and 3 alone would change more about this platform's
trustworthiness than any new module in the backlog.

---

## 23. The test suite ENFORCES the lens contradiction (crew-10)

Finding 12 said green tests can sit over dead features. This is worse: two
passing tests each assert a *different* sensor for the same lens, so the suite
actively locks the contradiction in place.

- `scripts/test_set.mjs:39` pins the 2D cone to full frame — 54.4° at 35mm.
- `scripts/test_set3d.mjs:136` pins the 3D frustum to Super 35 — 39.2° at 35mm.

Both pass. 44/44 is green. **Fixing either one alone breaks a test**, which is
exactly the trap that keeps a contradiction alive: the suite reports the bug as
the intended behaviour. A third sensor table sits unused at
`tools/lib-media.js:59`.

Measured aspect dependence, since `sets/index.html:83` sets the canvas to
`width:100%;height:100%` and so it is **never** the 4:3 the maths assumes:

| Window shape | What a 35mm shows |
|---|---|
| 4:3 | 39.1° (correct) |
| 16:9 | **50.7°** |
| 21:9 | **63.8°** |

Widen the browser window and the lens sees more room. No aspect-ratio or
safe-area overlay exists anywhere in the repo.

## 24. Sun times are wrong in two different ways, in two different places

Finding 14 recorded that Locations uses an approximate solar engine while a
correct tested one sits unloaded. Cinematography found the *other* half: where
the correct engine **is** used, it is passed no timezone.

`tools/lib-sun.js:66` falls back to `getTimezoneOffset()` — the **viewer's**
offset, not the location's — and neither `tools/sched-weather.js:147` nor
`production/production.js:152` passes one. Verified by execution: **LA sunset on
2026-08-26 is 19:28 local and renders as 02:28 on a UTC machine.** The city
picker ships 12 cities spanning 19 hours of offset, so the remote case is the
designed one, not an edge case.

`TSun` also returns times only — no azimuth, no altitude — so no question about
sun *direction* can be answered, which is most of what a DP actually asks of it.

---

**Phase 1 crew sweep closed: 20 of 20 reported.** The final report did not add a
seventh root cause; it deepened three existing ones. That convergence is the
strongest evidence the six root causes are real and the backlog is tractable.

---

# TEAM A findings

## 25. A checksum verifier that reports "bit-perfect" while pairing the wrong hash

`tools/lib-media.js:109` `parseManifest` uses lazy `[\s\S]*?` runs that are not
anchored inside a `<hash>` block, so it pairs **one file's path with another
file's hash**. Reproduced with a truncated manifest: `{path:'A.mov',
sha256:'ffff'}` — B's hash, and B is gone entirely — with `verifyAgainst`
returning `clean: true`.

This is the worst available failure mode for a verifier. Media offload is the
one place on a production where "probably fine" is not acceptable, and the tool
says *bit-perfect* over lost footage (teamA-05).

## 26. `csvCell` exists in five copies — three of them are mine

`finance/lib-money.js:114`, `production/lib-prod.js:91`,
`producer/budget-sheet.js:175`, `boards/lib-shots.js:104`, and `csvSafe` at
`tools/tools-core.js:82`.

Three of those I added myself, closing the CSV formula-injection findings from
the previous security review. Each one was correct in isolation and I wrote a
sweep asserting that every CSV writer carries the guard — but the right move
was one shared helper in `js/`, and the sweep I wrote actively *rewards*
duplication: it checks that the guard is present in each file, so copying it is
the cheapest way to pass. A test that makes the wrong fix the easy fix is a
design error in the test.

Fold all five into one `js/lib-csv.js`, and change the sweep to assert that no
file defines its own.

## 27. `Register` is the right nucleus and is used by exactly one module

`tools/tools-core.js` `Register` is a working schema-driven table with CRUD,
validation and CSV. **Sixteen module `index.html` files hand-roll the same
table.** Promoting it to `js/` and adopting it is the largest single reduction
in surface area available — and it is the same conclusion, reached
independently, as the shared-project-model finding (3) and the shared-parser
finding (17): this codebase's problem is not missing capability, it is the same
capability written many times, slightly differently, in many places (teamA-05).

## 28. Timezone bug confirmed a third time, with the fix data already fetched

`tools/sched-weather.js:147` renders sun times in the **viewer's** timezone:
Budapest sunrise (04:47 CEST) prints as 02:47 from a UTC browser. The request at
`weatherUrl` already sends `&timezone=auto` and the response's
`utc_offset_seconds` **is fetched and then discarded** (teamA-05).

And the weather planner is dead in production regardless: `_headers:4` omits
`api.open-meteo.com` from `connect-src`, so the fetch is CSP-blocked and
`.catch(function(){})` at `sched-weather.js:135` swallows it. Every day shows
"beyond forecast" and the risk score never runs — silently, forever.

## 29. Cinematography vocabulary with no arithmetic behind it (teamA-14)

`app.html:2071` ships "Shallow f/1.4", "Daylight 5600K", "Anamorphic Bokeh" as
AI prompt tokens. There is no depth-of-field or hyperfocal maths anywhere
(`hyperfocal`, `circle of confusion`: zero hits; `lensCalc()` takes no
aperture), and zero hits repo-wide for `kilowatt|kW|watt|amperage|distro` or
`HMI|tungsten|fixture|gel|kelvin`.

`sets/lib-set.js:29` gives every fixture the same circle and a hardcoded 20°
cone; the sample data types wattage into the free-text **label** (`"Key 2K"`).
`locations/lib-scout.js:510` records available power as free text and nothing
computes demand — which is both a budget miss and the most common on-set
electrical incident.

The platform speaks the language and cannot do the sums. DOF/hyperfocal is
~80 lines onto `tools/lib-media.js` with no new `SB_` key.

## 30. "The day" has three incompatible identities (teamA-16)

The reason the DPR is fiction is not the two field-name bugs — it is that the
platform has no shoot-day record at all.

| Where | What a "day" is |
|---|---|
| stripboard | an **int index** plus a hand-typed `MM/DD` string |
| Dailies | `yyyy-mm-dd` plus a unit |
| `SB_ShootPlan_v1` | the real computed date — **which nobody asks for** |

So `today/index.html:71` has to **guess what day it is by string-matching**. On
top of that, `production/lib-prod.js:27,30` filters takes on `t.date` and counts
prints on `t.status||t.print` — neither field exists in either take store — so
every take ever logged counts on every date and `printedCount` is permanently
zero. The DPR never opens `SB_Dailies_v1` at all.

Fix: an `SB_ShootDays_v1` record. Small, and it is the join key the call sheet,
the DPR, the pull list, the costume plot and the day log all need.

## 31. `SB_BudgetSheet_v1`: read by eight modules, written by one (teamA-15)

This is the structural reason no department rollup is possible. The only writer
is `producer/budget-sheet.js:11`, seeding from `SB_Budget_v1` and `SB_Money_v1`.
Real priced props and costume totals are therefore invisible to investors,
incentives, sales forecast, money room and dashboard — **all eight instead see
the flat 55/30/15 guess at `js/budget-engine.js:682`**.

Finding 6 said department numbers are not derived from department content. This
is why: there is no write path.

## 32. Verification that leaves no record (teamA-16, teamA-17)

`tools/lib-media.js:88` does **correct** SHA-256/MHL verification — and
`tools-media-ui.js:93` keeps every entry in function locals and pushes the XML
to an `<a download>`. **Nothing reaches any `SB_*` key.**

Consequences: nothing can answer *"is A007 clear to format?"* — the one
irreversible mistake available on a set; no take records a camera roll; the
editor bin carries no hash and dead-ends at `missing`; and
`distribution/lib-dist.js:38` bills an *"Archive master (verified backup)"* that
nothing can evidence.

The engine is written and tested. It needs a place to put its answer.

## 33. Nothing gates what leaves the building (teamA-17)

`SB_Music_v1` is read by no file outside `music/` (verified). `addScreener`
(`distribution/lib-dist.js:97`) records the recipient and never the content.
`CScreen.newSession` records no cut identity.

**A screener can go out with unlicensed cues in it, and the platform holds every
fact needed to stop that.** ~50 lines of `rightsGate(music, clearance)` — a
join, not new capability. Best consequence-per-line item found in Phase 1.

## 34. Continuity photos leave the project (teamA-15)

`wardrobe/index.html:133` writes JPEGs to IndexedDB. `projects/lib-vault.js:15`
and `netlify/functions/projects-sync.js:227` only ever touch `SB_*` localStorage
keys — so the photos are outside the vault and outside cloud sync. Worse,
`lib-vault.js:170` wipes and rewrites localStorage on a project switch and
leaves the blobs behind: the department's matching record is **device-only,
silently vanishes on a project switch, and the orphans grow unbounded**.

## 35. The post calendar reports a template guess as "ready" (teamA-17)

`SB_Post_v1` stores no milestone status and no actual dates, so `CPost.schedule`
is a pure plan and `distReadiness` (`post/lib-post.js:243`) reports `ready` off
the planned end date — while `post/index.html:104` tells the user "as each
milestone completes…". **Nothing ever completes.** The graph, business-day
maths and critical path are all built and correct; only the observation layer is
missing. ~90 lines.

This is the same shape as finding 35's siblings: a correct engine with no way to
record what actually happened. Which is exactly what Phase 4's self-learning
work needs — **you cannot learn from outcomes you never record.**

## 36. TWO budget engines, 4.5× apart, and one of them is untested (teamA-04)

The most consequential finding of the TEAM A sweep.

- `dashboard.html:1832` loads `js/budget-engine.js`.
- `producer/index.html:162` loads `timeline/timeline-budget.js`.
- **1,038 of 1,082 lines are identical (95.9%)** — but only the timeline copy
  has the documentary branch (`timeline-budget.js:541`).

Same documentary project, measured: dashboard **$3,223,437** vs producer
**$710,479**. A 4.5× disagreement between two screens of the same product.

And the part that let it happen: **no test loads `js/budget-engine.js`.** Every
suite evals the timeline copy. So the dashboard's engine — live, in front of the
owner — can drift indefinitely while the suite reports 44/44 green.

That is the third distinct failure mode in this codebase's assurance, and worth
stating together:
1. a test that builds its own fixture instead of the shape the app writes (12);
2. two tests that each pin a different answer, enforcing a contradiction (23);
3. **a whole 1,082-line engine that no test ever loads** (36).

Canonical is `timeline-budget.js`. Delete the other and repoint the dashboard.

**Two further money losses in the same path:**
- `producer/budget-sheet.js:155` returns before the `SEED_MAP` lookup, so
  `9900 · Stunts, SFX & special units` is **silently dropped — $203,500 on the
  suite's own fixture** — and `SEED_MAP['9900']` at `:36` is dead code.
- `js/budget-engine.js:685` labels the fringe line with no account prefix, so
  the regex at `:152` fails and **$397k–$709k of payroll fringes lands in 18000
  General Expenses**, pushing it to 7.5% against its own 2–7% NORMS band. A
  freshly-seeded sheet therefore carries **12 self-inflicted norm flags** — the
  platform flags its own arithmetic as suspicious and blames the user's budget.

Round trip measured: estimator $6,486,336 → sheet $6,304,846.

Also HIGH: `driver_load` is capped at 1.59 while `docs/PRODUCTION_PRICING.md`
§2.6 shows it uncapped; auto-schedule never reads `sc.cast`, so it cannot
minimise the hold days the DOOD already computes; and hold days are displayed
but never priced.
