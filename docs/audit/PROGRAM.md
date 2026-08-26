# Cinamate — 7-phase overnight program

State file. If context is lost, read this first, then `ls docs/audit/` to see
what has actually landed, then continue from the first unfinished phase.

Branch: `claude/movie-pricing-estimator-1jjsz7`. Commit each phase as it lands —
the container is ephemeral and anything uncommitted is lost.

## Ground rules for every phase

- **Concurrency cap is 20 subagents.** Run in waves of 20, never more.
- The `Workflow` tool is broken in this environment (subagent permission-handler
  misconfiguration, ~97% tool-call failure). Use plain `Agent` subagents.
- Agents get a short prompt pointing at `docs/audit/BRIEF.md` plus their own
  assignment file. Keep launch messages small.
- Every agent returns **at most 12 lines**; detail goes in its report file.
- `node scripts/run_all_tests.mjs` must stay green (44/44 at programme start).
  Also: `node scripts/smoke_pages.mjs`, `node scripts/scan_html_sinks.mjs
  --check`, and `node scripts/deploy_cinamate.mjs --build-only`.
- Never commit a token or password. Never rename an `SB_*` key.

## Phases

| # | Task | Agents | Gate |
|---|------|--------|------|
| 1 | Analysis: film crew + TEAM A DEVS | 20 + 20 | — |
| 2 | Build improvements + missing modules | waves of 20 | Phase 1 done |
| 3 | UI rebuild: 10 UI + 5 TEAM B DEVS | 15 | Phase 2 done |
| 4 | Self-learning layer | — | Phase 3 done |
| 5 | Landing page rebuild | 10 | Phases 2–4 done |
| 6 | Full security analysis | 50 (3 waves) | Phase 5 done |
| 7 | User manual PDF | 20 | Phase 6 done |

Tracked as tasks #56–62.

## Phase 1 — analysis (in progress)

**Wave 1 — 20 film crew.** Launched. Reports → `docs/audit/crew-01..20-*.md`.

01 development & story · 02 director & previz · 03 producer & financing ·
04 line producer & budget · 05 1st AD & scheduling · 06 casting ·
07 production design · 08 props · 09 costume/HMU · 10 cinematography ·
11 grip & electric · 12 locations · 13 production sound · 14 script supervisor ·
15 stunts & safety · 16 VFX · 17 editorial & post · 18 music & sound post ·
19 colour & finishing · 20 legal, distribution & festivals

> **RESOLVED.** `teamA-20` bounced off the 20-agent cap, was relaunched when a
> slot freed, and completed. Its report exists and it is the direct input to
> Phase 4 — see finding 44 in CROSS-CUTTING.md.

**Wave 2 status: COMPLETE.** All 20 TEAM A reports landed.

**Wave 2 — 20 TEAM A DEVS.** Assignments already written to
`docs/audit/assignments/teamA-01..20.md`. Launch each as:

> Read /home/user/shotb/docs/audit/BRIEF.md, then your assignment at
> /home/user/shotb/docs/audit/assignments/teamA-NN.md. Do exactly what it says.
> Return at most 12 lines.

- 01–10 strengthen what exists + supporting software, split by code slice
  (timeline · app.html · editor · producer · tools · boards/writer/workflow ·
  production/casting/locations · money-and-rights · physical production ·
  foundation).
- 11–20 find what is missing entirely, split by domain (development ·
  scheduling · accounting · camera & lighting · art departments · on-set ·
  post & VFX · sound & music · delivery & distribution · platform).

**When both waves land:** read the reports, write
`docs/audit/PHASE1-SYNTHESIS.md` — one ranked backlog, deduplicated across all
40, each item marked improve/missing with its target module and size. That
synthesis is Phase 2's input. Commit everything.

## Standing user instruction

Babysit this overnight. Do not wait on the user between phases. A recurring
check-in is armed as a fallback; re-arm it each time and stay silent on
no-change ticks.


---

# PHASE 1: COMPLETE — 40 of 40

20 crew + 20 TEAM A. Findings consolidated in `CROSS-CUTTING.md` (51 findings);
the ordered build plan is `PHASE1-SYNTHESIS.md`. **Read the synthesis, not the
40 reports, to continue.**

# PHASE 2: IN PROGRESS — wave 1, the foundations

**Deliberate change of approach from Phase 1.** Twenty parallel agents was right
for *reading* — they cross-referenced each other and covered disjoint ground.
For *writing*, twenty agents editing the same money and breakdown files collide
and produce merge slop rather than speed. So the build fans out along real file
boundaries: few agents where files overlap, wide fan-out where they do not.

Wave 1 is three agents with **disjoint file ownership**, stated in each prompt:

| Agent | Owns | Must not touch |
|---|---|---|
| scene model | `js/lib-scenes.js`, `timeline/parser.js`, the 8 `splitScenes` copies (props, vfx, music, wardrobe, dailies, casting, clearance, safety, production) | money modules, `scripts/` |
| money foundation | `js/budget-engine.js`, `dashboard.html`, finance, taxcredit, contracts, investors, producer, casting/vfx index | scene files, `scripts/run_all_tests.mjs` |
| assurance layer | `scripts/` only | all module source |

None commits; each leaves work in the tree and reports. I verify, run the full
suite, and commit.

**Wave 2 (after wave 1 lands)** — correctness, naturally disjoint, wide fan-out:
sets/3D normals + sensor + aspect + doors; sun/timezone + CSP; shoot-day record
+ take log; editor `ftc()`/`otio()`/fps/`colr`/`edts`; the sides leak; E&O and
rights gates; `app.html` dead code + session restore + CSP.

**Wave 3** — missing modules, ranked by consequence per line (see synthesis).

**Wave 4** — outcome records, which are the Phase 4 prerequisite.
