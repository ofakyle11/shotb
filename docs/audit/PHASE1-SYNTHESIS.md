# Phase 1 synthesis — the ordered Phase 2 backlog

40 agents: 20 film-crew departments and 20 engineers. Detail and evidence live
in `CROSS-CUTTING.md` (51 findings) and the 40 individual reports. This file is
the **plan**, ordered so that each wave makes the next one cheaper.

## The one-paragraph version

The platform's problem is not missing capability. It is that **the same
capability was written many times, slightly differently**, and the seams between
those copies are where every serious defect lives. Twelve scene parsers.
Two budget engines that disagree 4.5×. Eight copies of `splitScenes`. Five
`csvCell`s. Twenty-six hand-rolled tables. Meanwhile the *correct*
implementation of a dozen things already exists somewhere in the repo, unused.
A large share of this backlog is deletion and wiring, not new code.

Underneath that: **four numbers a producer actually relies on are wrong** — page
count (4.4× under), budget total (reads $0), cast weeks (bills idle days), and
tax credit (25–55% under). And **the test suite hid all of it in five distinct
ways**, so fixing the tests is not hygiene here, it is the deliverable.

---

## Wave 1 — foundations. Nothing else is trustworthy until these land.

Do these first and in this order; later waves depend on them.

**1.1 One scene model.** `js/lib-scenes.js` + `SB_Scenes_v1`. Capture the
printed scene number at `timeline/parser.js:61` (today a non-capturing group
throws it away) and carry it on the scene. Retire the ~12 regexes and the 8
copies of `splitScenes`. Must handle A/B numbering and a `FADE IN:` preamble —
today most copies number the first real scene **2**.
*Closes findings 1, 17, 40, 49. Precondition for roughly a third of the backlog.*

**1.2 One budget engine.** Delete `js/budget-engine.js`; repoint
`dashboard.html:1832` at `timeline/timeline-budget.js`. They are 95.9% identical
and disagree **4.5×** on the same documentary. *Finding 36.*

**1.3 One budget total.** `itemEst()` semantics for all five readers
(`finance`, `investors`, `workflow/advisor-ui`, `js/learn`, `producer`). Restore
the dropped 9900 seed row and fix the fringe account prefix so $397k–$709k stops
landing in General Expenses. *Findings 2, 36.*

**1.4 One chart of accounts.** A shared map. Fix `contracts/lib-deal.js:14`
(crew→3000, cast→2000), `casting/index.html:346` (→1400, which does not exist),
`vfx/index.html:247` (15000 vs 15200), and give props a posting at all.
*Findings 6, 10, 22.*

**1.5 Money arithmetic.** A decimal money helper with explicit rounding. Fix the
cost-report total that does not foot, the raw floats in CSV, the double
application of `qualPct` (25–55% understated), and `dealValue`'s missing fringes
plus the `<=` that prints "(scale)" for half of scale. *Finding 42.*

**1.6 Fix the tests, deliberately.** Five failure modes were found; each needs a
structural answer, not a patch:

| Mode | Answer |
|---|---|
| fixture invents a shape no writer produces | one round-trip test per store: writer's output satisfies reader's expectations |
| two tests pin contradictory answers | where two implementations exist, assert they agree *before* deleting one |
| a live engine no suite loads | enumerate shipped `lib-*.js`, assert each is loaded by some suite |
| fixtures dodge the input class with the bug | cents in every money fixture; A-scenes and a `FADE IN:` preamble in every script fixture |
| glob discovery hides untested modules | the same enumeration check; `safety/lib-safety.js` has 326 lines and no suite |

*Finding 43, 50. Already done: the concurrent-run port collision, finding 51.*

---

## Wave 2 — correctness where the platform already claims to work

**2.1 Sets/3D.** Reverse every face normal (`lib-set3d.js:153`; sets currently
light from below and every OBJ/STL exports inside-out); enable `CULL_FACE` so
winding errors are visible; one sensor table (adopt `tools/lib-media.js:59`);
derive aspect from the *format*, not the canvas; boolean-subtract doors and
windows from walls; fix the camera mesh pointing 180° from its own frustum.
Change `test_set.mjs:39` and `test_set3d.mjs:136` **together** — each currently
pins a different sensor, so fixing one alone turns the suite red.
*Findings 5, 23, 48.*

**2.2 Sun and time.** Delete `CScout.goldenHour()`; load `tools/lib-sun.js`
everywhere. Pass the *location's* timezone (already fetched as
`utc_offset_seconds`, currently discarded). Add azimuth/altitude. Add
`api.open-meteo.com` to `connect-src` so weather stops failing silently.
*Findings 14, 24, 28.*

**2.3 The day, and the take log.** `SB_ShootDays_v1` as the join key. Unify the
three take logs; fix `lib-prod.js:27,30` reading `t.date`/`t.status` that no
writer produces. *Findings 11, 30.*

**2.4 Editor and turnover.** `ftc()` puts seconds in the hours field — a 1-hour
cut exports as `3600:00:00:00`; `otio()` accumulates gaps so every cue after the
first lands late; `project.fps` is never written; add the `colr` box and
`edts/elst` (~21ms audio lag today). *Findings 8, teamA-01, teamA-03.*

**2.5 Things that leak or mislead.** Audition sides currently ship the **entire
screenplay** — delete the broken splitter and call `CCastDesk.sidesFor`. Gate
`eoReady` on actual clearance. Gate screeners on music rights. Fix distribution
exclusivity (wrong in both directions). *Findings 20, 21, 33, 40.*

**2.6 `app.html`.** ~2,270 lines (~130KB, parsed every load) are unreachable:
either wire `showMode()` and `mhEnter()` or delete them — do not leave them.
Fix owner session restore (the fix, `cinOwnerName()`, exists with zero callers).
Widen the gate CSP so generated assets are not blocked. *teamA-02.*

---

## Wave 3 — what is genuinely missing, ranked by consequence per line

1. **Payroll into the cost report** — labour is 50–70% of a budget and reaches
   `costReport` not at all; every EFC and variance is wrong by the size of the
   crew. The OT engine already exists and is tested.
2. **Rights gate on anything leaving the building** (~50 lines, a join).
3. **Prep/wrap calendar** — wire `CPost.schedule()`, which is already a tested
   business-day dependency scheduler with critical path, plus a template.
4. **Outcome records** — `SB_PostActuals_v1`, `SB_MediaCards_v1`,
   `SB_Receipts_v1`. These are also the Phase 4 prerequisite.
5. **Call sheet assembled, not typed** — hospital, parking, per-department
   calls, hazards, sun/weather. Every field already exists one hop away.
6. **DOOD drop/pickup** — stops billing eighteen idle days.
7. **DOF/hyperfocal and power/generator sizing** (~80 lines; the platform
   already speaks the vocabulary with no arithmetic behind it).
8. **ADR list, PRO-format cue sheet with writer/publisher shares.**
9. **Lined script, story days, costume plot by shoot day.**
10. **Series/episodic structure**, six-day weeks, premiere-conflict detection.

## Wave 4 — Phase 4 prerequisites (see finding 37, 44)

Replace, do not extend. Record `pred` before folding an observation in; learn
only from completed productions, never mid-shoot partials; fingerprint on
identity not value; put the store under the vault; and **prove it** with
walk-forward error against held-out productions. The schedule loop already has
both ends stored and never compared.

---

## Explicitly NOT to do

- Do not split `production/lib-prod.js` — 182 lines, five small pure functions;
  an auditor checked specifically and said leave it.
- Do not rebuild what is already good: the reconciling investor waterfall,
  `docs/PRODUCTION_PRICING.md`, festival premiere sequencing, `CPost.schedule`'s
  graph, `TMoney.timecard`, the Editor's ripple maths and ISO-BMFF muxer,
  `CCastDesk.charactersFromScript`, the ray/triangle intersection, and the props
  directory's refusal to invent a phone number.
