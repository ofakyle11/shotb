# Cinamate — audit brief (read this first)

You are one of ~135 agents auditing and extending **Cinamate**, an AI film
production platform. Repo: `/home/user/shotb`. Live: cinamate-studio.netlify.app.

## What it is

A single-owner studio platform covering development → distribution. Five owners
(mz465, kz465, hz465, rz465, dz465) sign in; everything except the landing page
and login is served from inside a gate function to a signed-in owner only.

## How it is built — respect these, they are not negotiable

- **Vanilla JS. No framework, no build step, no CDN, no third-party runtime
  code.** Every module is `<script src="lib-x.js">` + an inline IIFE. If you
  think you need React or a package, you are wrong about the constraint.
- **Data lives in `localStorage`** under `SB_*` keys, with an optional cloud
  sync through `netlify/functions/projects-sync.js`. Never rename an existing
  `SB_*` key or any internal identifier — live owners have data under them.
- **Escaping**: `esc()` for HTML text, `jsq()` then `esc()` for a JS string
  inside an HTML attribute, `CinUrl.safe()` for a URL in an attribute,
  `CinUrl.isSafe()` to gate a real URL (e.g. `window.open`). The CSP carries
  `'unsafe-inline'`, so a `javascript:` URL in an href **executes**.
- **Every module has a `lib-*.js` of pure logic** with no DOM, node-testable,
  plus a `scripts/test_*.mjs` suite. `node scripts/run_all_tests.mjs` runs all
  of them. Currently 44/44 suites pass. **Do not leave them failing.**
- CSV cells beginning `= + - @` tab or CR are prefixed with `'` — a spreadsheet
  treats them as formulas otherwise.
- `private/`, `local-backend/`, `scripts/`, `netlify/`, `agents/`, `docs/`,
  `netlify-git-guard/` are excluded from deploys.
- **Never commit a token, password or key.** Not even in a test fixture.
- Never invent a phone number, URL or price. Unverified entries get a Google
  search link instead.

## The 28 modules

`boards` storyboards/shot lists · `casting` cast intelligence · `cinamate`
landing · `clearance` rights · `contracts` deal memos · `dailies` ·
`distribution` · `editor` NLE + MP4 muxer · `festivals` · `finance` money room ·
`investors` · `locations` · `music` rights & score · `post` post supervisor ·
`producer` budget top-sheet + stripboard + incentives · `production`
casting/continuity/DPR/VFX/cues/QC/residuals · `projects` vault · `props` ·
`safety` risk · `screening` · `sets` 2D plan + 3D builder with real lens views ·
`taxcredit` · `timeline` the Studio (largest, 11 js) · `today` · `tools` sun/
money/script/media · `vfx` · `wardrobe` · `workflow` pipeline mission control ·
`writer` treatment → script.

Root pages: `index.html` (landing), `app.html` (the monolith), `dashboard.html`,
`login.html`, `404.html`. Shared: `js/` (auth, budget-engine, learn,
mastery-resolver, model-config, safe-url, project-badge, config, effects).

## What you must produce

Write a markdown report to the path your prompt names, under
`/home/user/shotb/docs/audit/`. Structure it exactly like this:

```
# <your role>

## What exists and works
- <module/file:line> — one line on what it genuinely does today

## What exists but needs work
- <module/file:line> — what is weak, WHY it matters to a real production,
  and the specific change. Rank: HIGH / MED / LOW.

## What is missing entirely
- <name> — what it is, why a production needs it, which existing module it
  should attach to, and roughly what it takes to build. Rank the value.

## Evidence
- Files you actually read. Line numbers. No claims you did not verify.
```

## Rules that make this useful rather than noise

1. **Read the code.** Do not guess from a filename. A claim without a
   `file:line` behind it will be discarded.
2. **Be specific.** "Improve the UI" is worthless. "The stripboard cannot
   express a split day, so a company move mid-day is invisible on the DOOD —
   add a half-day flag to `producer/lib-sched.js:strip()`" is useful.
3. **Say when something is already good.** An honest "this is fine" is worth
   more than an invented deficiency. Do not pad.
4. **Do not edit any file.** This phase is read-only. Later phases build.
5. Return **at most 12 lines** as your final message: your 3 highest-value
   findings and the report path. The report file carries the detail.
