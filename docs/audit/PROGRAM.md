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
| Phase 5 — landing (10) | after 2/3/4. Fix false claims (3,708→3,194 etc.); published landing is `cinamate/index.html`, NOT root; budget ≤140KB built / ≤200KB first load |
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
