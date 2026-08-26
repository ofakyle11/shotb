# Cinamate programme — EXECUTION STATE

The governing document is the approved plan (mirrored below in summary). Read
`PHASE1-SYNTHESIS.md` for the audit backlog, `SIGNATURES.md` for the
do-not-reimplement API map, `CROSS-CUTTING.md` for findings.

## Command structure

- Director = this session (Opus 5). Workers = `Agent` launches that ALWAYS pin
  `model: "opus"` — an omitted model is a defect (no-Fable guarantee).
- Cap 20 concurrent. Writers never share a file. Order cards state OWNS /
  FORBIDDEN / prelude. Agents do not commit; the director verifies per-team
  (staged gating: apply one team's diff → subset gate → commit → next).
- Gate: `run_all_tests.mjs` (53.7s) + `scan_html_sinks.mjs --check` (0.4s)
  every wave; `smoke_pages.mjs` (28.1s) when html/css/js changed;
  `deploy --build-only` (5.9s) when the deploy surface changed. A wave is green
  iff its failing set ⊆ the accepted red set. After Gate-0 that set is empty.

## Sequence and status

| Stage | Status |
|---|---|
| Phase 1 — 40-agent audit | ✅ complete (51 findings) |
| **GATE-0 — recover the green tree** | ⏳ IN PROGRESS: R1 money+suites, R2 scenes+today, R3a assurance triage (parallel, disjoint); then R3b review + pre-cut splits (test_tools per-lib, test_ops → money/rights) after R1 |
| Phase 2 — 10 build teams | pending Gate-0. Spine T5→T6→T7; **T6 first** (Phase 4 dependency). sw.js + deploy partition are integrator-only |
| Phase 3 ∥ Phase 4 | concurrent after Phase 2 (file-disjoint; advisor-ui.js belongs to Phase 4). Phase 3: T1a tokens first, then T1b chrome ∥ territories; T2 owns the app.html kill decision — BEFORE any Phase-2 app.html body work |
| Phase 5 — landing (10) | **Claims work is DONE — see `LANDING-CLAIMS.md` BEFORE touching this page.** The Phase-1 "false claims" list was wrong four times out of five: 3,708 and 0.848 are both sourced (`docs/SALES_FORECAST.md:29,31`), the 4-minute auto-sync is real (`js/project-badge.js:66,216`), and the stage directory is exactly 36. Do NOT "correct" 3,708 to 3,194 — they measure different things. Two genuinely unsourced claims were removed. Remaining: styling/budget only — published landing is `cinamate/index.html`, NOT root (`deploy_cinamate.mjs:135-136` copies it over root then deletes the dir); keep both copies byte-identical; budget ≤140KB built / ≤200KB first load |
| Phase 6 — security (50) | four sub-waves: 20+5 finders → 15 verifiers → 10 gap-check. Never call a crashed specialist's silence "clean" |
| Phase 7 — manual (20 → PDF) | fragments → build_manual.mjs → chromium --print-to-pdf → pypdf outline (pipeline verified) |

Tasks #57–62 track phases. Baseline red set at Gate-0 start: assist,
csv_injection, investors, post, producer_suite, ops, taxcredit,
budget_engines, assurance (9 suites) + smoke `/today/`.

## Standing rules

Vanilla JS, no frameworks/CDN/build step. Never rename an `SB_*` key. No
tokens/passwords in commits. No invented phones/URLs/prices. Money fixtures use
cents; script fixtures use A-scenes + `FADE IN:`. Two implementations → assert
agreement before deleting one. Workflow tool broken here — plain Agent only.
Load-order contract: money-math → accounts → sheet; lib-scenes before
castdesk/safety.

## User handoffs

Netlify token for any live deploy · delete stale `cinamate.netlify.app` (third
account) · buy `cinamate.studio`.

---

# STANDING AUTHORITY (2026-08-26, Kyle asleep)

Kyle handed over with "approve all and make sure it gets fully finished." The
director runs the remaining chain autonomously: finish Phase 2 -> integration
pass -> T7 -> adversarial verify -> Phase 3 || Phase 4 -> Phase 5 -> Phase 6 ->
Phase 7. No waiting for approval between phases. No no-change messages.
An hourly trigger is armed as a fallback; DELETE IT when the chain completes.

## What blanket approval does NOT cover

These are irreversible, outward-facing, or impossible from here. They wait for
Kyle with a written checklist, however broad the standing approval:

1. **Deleting or archiving any GitHub repo.** Irreversible, and no tool exists
   in this session for it. `ofakyle11/shotb` additionally carries the live
   Netlify deploy and every branch of this programme — deleting it before the
   new repo is verified complete would destroy the work.
2. **Any live deploy.** The Netlify token is deliberately not on disk.
3. **Revoking the leaked PAT** (`ghp_P6rR...`, pasted in chat 2026-08-26).
   Only Kyle can do this and it should happen immediately.
4. **Granting the Claude GitHub App access to `kylefrancis280-a11y`**, without
   which the migration to `kylefrancis280-a11y/cin` cannot start.
5. **Taking down the stale ungated `cinamate.netlify.app`** on the third
   Netlify account, which is a live exposure and is NOT fixed by any repo work.

A blanket "approve all" is authority to finish the BUILD. It is not consent to
destroy repositories or publish to the world while nobody is watching.

## Known structural issue for the integration pass

Wave 1's throw-on-missing-dependency guards cross team boundaries: a team that
adds a `requires` guard to a shared lib breaks every suite that evals that lib
without the new prelude — including suites no team owns (T6's
`js/lib-shootdays.js` guard on `production/lib-prod.js` broke
`scripts/test_scenes.mjs`). The collision matrix partitioned FILE ownership but
not DEPENDENCY ownership. Fix centrally in one pass; do not let teams scatter
preludes locally.


---

# LIVE STATUS (overnight, autonomous)

Tree green: 55/55 suites, 32/32 pages, sinks exit 0, assurance exit 0.

LANDED and committed: T1 optics (one sensor table; both contradictory lens pins
moved together; CULL_FACE exposed an uncapped cylinder), T2 sun/timezone/power,
T4 editor turnover (ftc, otio cursor, fps, edts/elst), T5 rights + the
SB_Festivals_v1 data-loss migration, T8 payroll into the cost report, T9 post
actuals, T10 story days + costume plot.

RUNNING: T6 shoot-day join key (+ T5's cue-sheet handoff relayed to it),
T3 CSP parity (gate.js holds a SECOND policy that is the one actually applied
to every gated page — T2's weather fix does not reach production until this
lands), T11 vault blobs (photos/scout/editor media never left the device),
P3-T1a design tokens, P4-L3 bid-vs-final loop.

QUEUED: T7 (needs T6's lib) · adversarial verifiers · rest of Phase 3 · Phase 4
L1/L2/L4/L5 · Phase 5 landing · Phase 6 security (50) · Phase 7 manual (20).

Findings surfaced by the build that the 40-agent audit MISSED:
- SB_Festivals_v1: two writers, incompatible top-level types, silent data loss.
- cylinderQuads had no bottom cap — every table and lamp an open shell.
- The gate's CSP is a second copy; fixing _headers alone changes nothing.
- The IndexedDB blindness covers THREE databases, not one.
