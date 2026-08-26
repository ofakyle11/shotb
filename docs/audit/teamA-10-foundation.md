# Team A Dev 10 — the foundation (js/, vault, gate, functions, tests, build)

Slice: `js/*` · `projects/lib-vault.js` · `dashboard.html` · `login.html` · `sw.js` ·
`netlify/functions/` (23) · `scripts/` (44 suites + deploy/test/scan runners).

I ran `node scripts/run_all_tests.mjs`: **44/44 suites pass, 1,299 assertions.** Nothing
below is a failing test; everything below is something the tests do not ask about.

---

## What exists and works

- `netlify/functions/gate.js:38-54` — `tokenOwner()` verifies the HMAC over the **literal**
  `expires` field, not a reparsed integer, and rejects a non-`^\d+$` expiry outright. The
  comment at :44-47 records why: signing over `parseInt('1700000000abc')` made one signature
  valid for an unbounded family of cookie strings. The fix is correct and the reasoning is on
  the file.
- `netlify/functions/gate.js:67-85` — `cookieTokens()` reads **every** `cin_owner` in the
  header (capped at 12) and accepts whichever verifies, so a subdomain-planted cookie can no
  longer shadow the real session and sign an owner out. Genuinely good; most implementations
  read the first and stop.
- `projects/lib-vault.js:87-156` — the incoming-archive sanitiser is the strongest single
  piece of code in this slice. Default-deny on every scalar (`:99`), a short prose allow-list
  (`:62`), suffix-matched URL fields (`:66`), scheme rejection that catches `javascript:` with
  no markup characters present (`:70`), **keys sanitised as well as values** (`:101-129`) with
  the re-check that `"__pro<to__"` → `"__proto__"` cannot be manufactured by stripping
  (`:109-118`), `defineProperty` instead of assignment so an inherited setter is not invoked
  (`:124`), depth cap (`:85`), and — the part that matters most — `sanitizeStoreValue` **throws
  rather than returning the input** (`:134-138`). `scripts/test_vault_sanitize.mjs` is 56
  assertions against it. This is fine. Leave it alone.
- `projects/lib-vault.js:158-174` — `writeStores()` sanitises the whole set *before* clearing
  storage, so a mid-restore failure cannot leave the workspace shredded. `switchTo` (`:227-241`)
  and `newProject` (`:244-261`) persist the outgoing snapshot before overwriting live storage,
  for the same reason. Correct ordering, deliberately chosen.
- `projects/lib-vault.js:16-24` — `LOCAL_ONLY` keeps `SB_LocalGPU_v1` (bridge URL + API key)
  and `SB_TMDB_v1` (personal key) out of every snapshot, archive and cloud push.
  `netlify/functions/projects-sync.js:37` enforces the same regex server-side. Both sides
  check, which is the right call for a credential.
- `login.html:48-69` — `dest()` is hardened past the usual three tries: literal-prefix check,
  resolved-origin check, **and** a re-resolution of the output because `/..//evil.com`
  resolves clean but leaves `//evil.com` as the pathname. `scripts/test_login_redirect.mjs`
  is 37 assertions on exactly this. No token is ever returned to page script (`:93-102`);
  the session is the HttpOnly `cin_owner` cookie.
- `sw.js:55-75` — the service worker refuses to cache gated bytes on **two** independent
  grounds (a path allow-list and the response's own `Cache-Control`), decodes percent-encoding
  before the prefix test (`:41-53`, closing `/assets/%2e%2e/dashboard.html`), and routes
  `install` through the same gate as `fetch` (`:77-95`). 39 assertions in
  `scripts/test_sw_cache.mjs`.
- `scripts/run_all_tests.mjs:43-68` — suites are **discovered**, not listed, so adding
  `test_x.mjs` cannot be silently forgotten; a crashed runner is reported as `ERROR` distinct
  from a failing assertion, and every suite runs rather than stopping at the first failure.
  This is better than most production CI.
- `scripts/deploy_cinamate.mjs:100-135, 240-271` — exclusion rules are applied at **every**
  depth (not just the repo root), case-insensitively, refuse symlinks, refuse dotfiles
  wholesale, and are then re-checked against the finished tree in both partitions before
  upload. `netlify.toml:9-18` makes a git build fail closed by publishing a placeholder and
  pointing `functions` at an empty directory. `scripts/test_deploy_exclusions.mjs` is 37
  assertions. I verified the 10.6 MB `Shotbreak-main (1).zip` and the 336 KB `.jpeg` sitting
  at the repo root are both correctly excluded by `EXCLUDE_EXT` (`:82`).
- `scripts/deploy_cinamate.mjs:41-62` — terser is pinned to an exact version and the deploy
  refuses to run if `node_modules` disagrees. This process holds every production secret; the
  reasoning at :43-51 is right.
- `scripts/test_helpers_defined.mjs` — brace-depth-aware check that every escaping helper a
  page calls is actually reachable **at global scope on that page**. It exists because a
  textual "is `esc` declared anywhere" test passed while `dashboard.html` threw
  `ReferenceError` and lost four renderers. 70 assertions. Excellent test.
- **Every `lib-*.js` in the repo has a real logic suite.** I cross-referenced all 30 lib files
  against `scripts/test_*.mjs`; there are zero orphans. See the coverage list below.

---

## What exists but needs work

### HIGH — `js/budget-engine.js` is a stale fork of `timeline/timeline-budget.js`, and the dashboard runs it

`js/budget-engine.js:1080` and `timeline/timeline-budget.js:1238` **both** export
`root.SBBudget`. Identical 13-line header comment, identical rate tables, same function names.
`diff` is 282 lines across 22 hunks. `dashboard.html:1832` loads the fork; `timeline/index.html:315`,
`producer/index.html:162` and `workflow/index.html:87` load the maintained copy. Only the
maintained copy is tested (`test_budget_estimator`, `test_learn`, `test_advisor`,
`test_producer_suite`, `test_taxcredit`). **The 1,081-line fork has zero logic tests** — its
only appearance in `scripts/` is a passing mention in a comment at
`scripts/test_helpers_defined.mjs:13`.

What actually diverges, in money terms:

- **No documentary mode.** `estimateDocCompat` (`timeline-budget.js:786-841`), the doc tier
  selects, the doc-aware incentive rules (NY excludes docs; Georgia caps docs at the 20% base)
  and the grants table are all absent from the fork. A documentary owner opens the dashboard
  and is quoted scripted-feature numbers against an incentive their project is not eligible for.
- **No `local-comfy` model.** `timeline-budget.js:28-30` prices the app's own default render
  path at $0/sec. The fork's `AI_MODEL_RATES` has no such entry.
- **No build filter.** `timeline-budget.js:469-477` filters `AI_MODEL_RATES` down to
  `root.VIDEO_MODELS`, and `js/model-config.js:16` offers exactly one video model
  (`local-comfy`), so the Studio correctly shows one row at $0. `dashboard.html` does not load
  `js/model-config.js` at all and the fork has no filter — so the dashboard prices the same
  film against eight cloud models (Sora, Veo, Seedance, Wan) this build does not offer. Two
  screens, same project, wildly different answers to "what does this cost".
- **Learning is disconnected on the dashboard.** `timeline-budget.js:483-484` substitutes
  `CLearn.genSecPerClip()` — the machine's measured speed — for the shipped default. The fork
  uses `m.genSecPerClip` unconditionally, so render-time learning (loop 2, below) never reaches
  the dashboard estimate.
- `js/budget-engine.js:905` renders the user-facing string *"Edit rates in `timeline-budget.js`"*.
  The file names the other file as canonical. Nobody has maintained this copy on purpose.
- `js/budget-engine.js:790` defines `function esc(s) { return escT(s); }` inside the IIFE and
  uses `esc()` at :848, :884, :891, :905, :923, :949 where the maintained copy uses `escT()`.
  This is the exact shape `scripts/test_helpers_defined.mjs` was written to catch; it is safe
  here only because the definition is in the same file.

**Change:** delete `js/budget-engine.js` and point `dashboard.html:1832` at
`/timeline/timeline-budget.js`, then load `js/model-config.js` on the dashboard so the
`VIDEO_MODELS` filter applies there too. If the two must stay separate, they need separate
names and separate globals — two files exporting one global is the bug, not a style problem.
Budget for the dashboard picking up doc mode's markup (`bud-modeswitch`, `bud-modebtn` classes)
and for one round of visual checking. Nothing else in the slice pays back this well.

### HIGH — every gated subresource is `no-store`, so each navigation re-runs the gate 24 times

`gate.js:130` sets `Cache-Control: private, no-store` on **everything** — HTML, JS and CSS
alike. `timeline/index.html` carries 26 subresource tags, 24 of which the partition moved
inside the function. That means 24 separate Lambda invocations per navigation, each
re-verifying the HMAC, each doing up to four filesystem syscalls (`existsSync` at `gate.js:116`,
`:119`, `:120`, then `readFileSync` at `:122` — there is no in-memory file cache), returning
~472 KB of JS. And because `no-store` forbids storage entirely, **all 24 repeat on every
navigation, forever** — the `?v=20260821b` cache-busting query strings on those script tags
(`timeline/index.html:24-30` and the 20 below) are inert machinery for a cache that is never
allowed to hold anything.

Cold starts compound it: the gate bundle is `gate.js` + a 2.55 MB pre-minify site tree
(`deploy_cinamate.mjs:309`), and Netlify may route a burst of 24 concurrent subresource
requests to several containers at once, so a first load after idle can pay several cold starts
in parallel rather than one.

The `no-store` is right for HTML, which can carry owner-specific data. It is not right for
`.js`/`.css`, which are identical build artifacts for all five owners and contain no owner
data. **Change:** in `gate.js`, branch on `ext` — keep `private, no-store` for `html`, and
serve `private, max-age=3600, must-revalidate` for `js`/`css`. `sw.js:69-75` still refuses to
write them to Cache Storage independently, so the "not replayable from disk after sign-out"
property is preserved by the second, stronger check the file was written to be. That is a
~24× reduction in function invocations per navigation for one branch.

Alongside it: hoist a `Map` cache of `readFileSync` results in `gate.js` module scope, keyed by
`rel`. The bundle is immutable for the container's lifetime, so re-reading it is pure waste.

### HIGH — 1.48 MB of unchanging vendor JS is marked `no-store` by `_headers`

`_headers:15` sets `/*.js → Cache-Control: no-cache, no-store, must-revalidate`. The
`/static/ffmpeg/*` block (`_headers:63,68,72`) deliberately overrides that with
`public, max-age=604800`, with a good comment explaining why a week and not `immutable`.
**`/static/vendor/*` has no such block.** So `pdf.min.js` (320 KB), `jszip.min.js` (97 KB) and
`pdf.worker.min.js` (1.06 MB) — pinned third-party files that never change — fall through to
`no-store`. `timeline/index.html:24-25` loads two of them on every Studio page load (417 KB
re-downloaded each time), and :30 pulls the 1.06 MB worker on the first PDF import.

**Change:** add a `/static/vendor/*` block to `_headers` mirroring the ffmpeg one
(`public, max-age=604800`, plus the `Cross-Origin-Resource-Policy: cross-origin` the worker
needs). Three lines. It is the cheapest real win in this report.

### HIGH — the self-learning store is invisible, uncorrectable and unbacked

Answering the assignment's question precisely, and without flattery.

**What CLearn actually learns today** (`js/learn.js`):

1. **Budget calibration** (`:55-89`). For every line item carrying both an `est` and an
   `actual`, it keeps a per-account EWMA of `actual/est` (`:68`, weights 0.7 old / 0.3 new),
   clamped to `[0.25, 4]` on input and `[0.5, 2]` on output, suppressed below `n = 2` (`:79`).
   Fed from `producer/budget-sheet.js:208` and `:399` (every persist), `finance/index.html:144`
   (cost-report actuals) and `props/index.html:280` (a real quote). Applied at
   `producer/budget-sheet.js:161-165` and `props/lib-props.js:189-192`.
2. **Render speed** (`:92-125`). Median wall-clock per clip over the last 60-80 renders, with
   a faster/slower/steady trend once ≥8 samples exist.
3. **Research cache** (`:128-192`). TMDB/Wikidata replies for a week, sanitised on the way in
   (`:148-173`) because this store deliberately sits outside `SB_*` and the vault sanitiser
   therefore never sees it. That reasoning is correct and the sanitiser is a good one.

**Does it improve anything measurable?** Loop 1, yes — genuinely, and the test suite
(`scripts/test_learn.mjs`) proves the EWMA, the idempotence, the anecdote suppression and the
2× clamp. Loops 2 and 3 are much narrower than they read:

- **Loop 2 only ever learns about local renders and only ever improves local estimates.**
  `timeline/timeline.js:1807` gates `recordRender` on `isLocalModel(pollModel)`, and
  `timeline-budget.js:483` applies the learned value only when `id.indexOf('local') === 0`.
  For an owner not running the ComfyUI bridge, nothing is recorded and nothing improves. The
  loop is closed but it is a very small circle.
- **Loop 3 has exactly two call sites**, both in `production/production.js:397-412`. Casting,
  locations, music and clearance all do their own research lookups and none of them use the
  cache.

**The three structural problems a self-improvement phase has to solve first:**

- **It is invisible.** `CLearn.summary()` is rendered in exactly two places
  (`workflow/advisor-ui.js:96-102`, `dashboard.html:2309-2315`) as prose. There is no screen
  that lists what was learned per account.
- **It is uncorrectable.** `CLearn.reset()` (`js/learn.js:202`) is exported and **has no UI
  anywhere in the repo** — I grepped every `.html` and `.js`. One mistyped actual (a `150000`
  that should have been `15000`) teaches a 2× multiplier on that account, and every future
  seeded estimate on it is inflated 100% forever, annotated only as *"calibrated +100% from 2
  past actuals"*, with no way to undo it short of devtools. On a money tool for a real
  production that is a defect, not a missing nicety.
- **Correcting the typo makes it worse.** The idempotence fingerprint at `js/learn.js:62` is
  `acct|desc|est|actual`. Fixing the number produces a *different* fingerprint, so the
  corrected ratio is learned **on top of** the wrong one — `b.n` goes to 3 and the bad 1.5
  stays inside `b.r`. The mechanism that prevents double-learning is exactly what prevents
  un-learning. **Change:** fingerprint on `acct|desc` only, and have a repeat write *replace*
  that row's contribution rather than append.
- **It is single-browser and unbacked.** `CIN_Learn_v1` (`:23`) does not match
  `lib-vault.js:15`'s `/^SB_[A-Za-z0-9]+_v\d+$/`, so `snapshot()` never captures it, no
  `.cinamate` archive carries it, and `projects-sync.js` never syncs it. Everything the
  platform has learned dies with a browser profile and is never shared between the five owners
  or across one owner's two machines. Keeping it out of the per-project namespace is right;
  keeping it out of the *backup* is not. **Change:** add a `CIN_*` cross-project channel to the
  vault and to `projects-sync` — separate from the project archive, merged rather than
  overwritten on pull (EWMA state merges cleanly: sum the `n`, weight the `r`).

**Rank HIGH** — the assignment says a later phase must make this genuinely self-improving.
Its starting point is: one loop works and is well tested, the other two are narrow, and none
of it can be seen, fixed, or backed up.

### MED — an archive made two versions ago is indistinguishable from a current one

Direct answer to the assignment's question. `projects/lib-vault.js:13` fixes
`FORMAT = 'cinamate/1'` and `parseArchive:189` rejects anything that is not that string
exactly. The number has never been bumped. Two consequences, both bad in opposite directions:

- **Nothing distinguishes old from new.** The archive header (`:177-184`) records `format`,
  `name`, `savedAt` and `stores` — no app build, no per-key schema version. `savedAt` is a
  free-form string (`when || ''`, no format contract, callers pass `'2026-08-20'`). All 67
  `SB_*` keys are at `_v1` (I inventoried them); the `_v\d+` in the key name is decorative —
  **nothing in the repo reads it, nothing bumps it, and there is no `_v1 → _v2` migration code
  anywhere.** I grepped for `migrat|schemaVersion|upgradeSchema` across the whole tree: the
  only hits are `timeline/timeline.js:2026` and `js/model-config.js:411`, both of which
  rename three *model ids*, not schemas. So a two-year-old archive restores its raw blobs
  into a workspace whose modules may have changed shape, and nothing anywhere notices.
- **And bumping the format breaks every existing archive.** The moment anyone writes
  `cinamate/2`, `parseArchive:189` answers *"Not a Cinamate project archive (format missing)"*
  for every `.cinamate` file the five owners have ever exported. There is no upgrade branch.

Restore is destructive by design (`:170` clears every portable key before writing), which is
correct for "open this production" — and `:200-204` correctly refuses an archive with no
portable stores rather than using it to wipe the workspace. But there is no shape validation
at all, and **no test covers cross-version behaviour**: `scripts/test_modules.mjs:40-52` and
all 56 assertions in `test_vault_sanitize.mjs` hardcode `format: 'cinamate/1'`.

**Change:** (a) accept `cinamate/N` for `N <= CURRENT` and route through a migration chain;
(b) write `app`, `builtAt` and a `schema: {SB_Boards_v1: 1, …}` map into the archive header now,
while every value is still 1, so a future migrator has something to dispatch on — an archive
written today is otherwise permanently unversioned; (c) make `savedAt` an ISO-8601 contract.

### MED — the token verifier is copy-pasted across three functions because the deploy makes sharing impossible

`tokenOwner`, `cookieTokens`, `ownerFromCookies`, `safeEqual` and the `NAMES` array exist
verbatim in both `netlify/functions/gate.js:31-85` and `netlify/functions/projects-sync.js:45-95`,
and `verify-owner.js:73-91` carries a third variant (`verifyOwnerToken`). The
`parseInt`-signature comment appears in all three — evidence the fix had to be applied three
times by hand. `LOCAL_ONLY` is a fourth duplication, across `lib-vault.js:23` and
`projects-sync.js:37` (that one is deliberate defence in depth and the comment says so).

This is structurally forced, not sloppiness: `deploy_cinamate.mjs:296` and `:301` pack
`verify-owner` and `projects-sync` with `zip -qj` — junk paths, one file per archive — so a
`require('./lib/…')` sibling cannot ship. A `netlify/functions/lib/` directory does exist with
15 shared modules, but only the legacy `agent-*` endpoints use it, and its `verify-token.js` is
a *different* Firebase-oriented verifier whose header still names the retired
kyleF/steveC/scottD owners.

**Change:** create `netlify/functions/lib/owner-token.js` holding the one verifier, and switch
those two zips from `zip -qj <file>` to `zip -qr <file> lib/owner-token.js` (the gate already
uses `zip -qr` at `:309`, so the pattern is in the file). Then the next auth fix is applied
once. `scripts/test_auth_hardening.mjs` reads both `gate.js` and `verify-owner.js`, so it would
follow the move.

### MED — a release ships 3 functions; the app calls 12

`deploy_cinamate.mjs:387` posts a complete function manifest of exactly
`{ 'verify-owner', 'gate', 'projects-sync' }`. The gated application calls twelve endpoints:
`generate-video` (4 call sites — `timeline/timeline.js:92,1338,1394` and `app.html:1500`),
`auth`, `serve-openai-video`, `enrich-characters`, `enrich-locations`, `batch-generate`,
`agent-invoke`, `agent-invoke-start`, `agent-invoke-status`, `agent-orchestrate`. Nine of those
are in no manifest any release ships. Either they are absent after a release, or they survive
only as leftovers of a deploy made by some other method at an unknown time — neither is a state
anyone can reason about, and `netlify.toml:14-18` correctly forbids a git build from supplying
them.

Two of the twelve are not functions at all: `netlify/functions/run-agent.js` is the 11-byte
string `PLACEHOLDER` and `agent-orchestrate.js` is the 20-byte string `[Full local content]` —
and `agent-orchestrate` is called by the app.

**Change:** decide which endpoints are live, add them to the manifest, and delete the rest
(`seed.js` is already a self-disabling 410 stub, which is the right pattern). Then extend
`scripts/test_deploy_exclusions.mjs` with the inverse of what it checks today: every
`/.netlify/functions/<name>` string reachable from a deployed page must appear in the deploy
manifest. It currently asserts only that a git build ships *no* functions (`:201-207`); the
"a release ships all the ones we need" half is missing.

### MED — `js/config.js` and `js/auth.js` document a regime that no longer exists

Both files call themselves the single source of truth and both are wrong in their headers.

- `js/config.js:13-20` — *"only the 3 owners"*, *"original kyle/scott/steve + kyleF/steveC/
  scottD/steveK shorts"*, *"name + OWNER_PW_KYLEF"*, and an instruction to *"update the
  OWNER_NAME_TO_EMAIL map in the two netlify/.../verify-token.js files"*. There are five
  owners, the env vars are `OWNER_PW_MZ465`…`OWNER_PW_DZ465`, and the file's own list at
  `:67-73` is correct. `:64` reads *"The ONLY two active logins"* directly above five entries.
- `js/auth.js:17` — *"Only the two authorized owners (mz465 / kz465) get special privileges."*
- `netlify/functions/lib/verify-token.js:19` — same retired kyleF/steveC/scottD map in its header.

These are rotation instructions. The next person to rotate a password or add an owner follows
them into files and env vars that do not exist. `netlify/functions/verify-owner.js:6-19` has the
correct procedure; the client files should point at it rather than restate a stale one.

Two smaller notes on the same files: `Object.freeze(CFG)` at `js/config.js:85` is shallow, so
`CFG.owners.meta` and `CFG.firebase` remain mutable — `structuredClone` + a recursive freeze if
the guarantee is meant. And `js/auth.js` is now nearly inert for owners: `getToken()` (`:75-92`)
returns `null` unless Firebase is present, `hdrs()` (`:98-103`) therefore returns plain headers,
and `touchOwnerToken()` (`:72`) is an explicit no-op. Only `rehydrateOwnerToken()` (`:39-41`)
still does work — a one-time purge of pre-cookie-era localStorage tokens. It is loaded by
`app.html`, `index.html` and `cinamate/index.html` only, so it is not on the 24-request hot
path; the purge is worth keeping for now, but it should carry a removal date.

### MED — the offline/gate-down failure mode tells the owner the wrong thing

`sw.js:127`: when a fetch fails and the request is a navigation with no cache hit, the worker
serves `/login.html`. The gate being down, a Netlify function timeout, or an aeroplane all
produce the same screen — a **sign-in form**, to an owner whose cookie is still perfectly
valid. They will type a password, `verify-owner` will fail to answer too, and they will get
*"Could not reach the sign-in service"* (`login.html:111`) with nothing distinguishing "you are
signed out" from "the studio is down".

The second half is worse: `SHELL` (`sw.js:9-14`) caches only the public shell, so **nothing of
the application works offline**. Every module's data is sitting in `localStorage` on that
machine, fully intact, and there is no code cached to render it. A gate outage is a total
outage for a production that has all its own data locally.

**Change:** (a) ship a tiny `/offline.html` on the public CDN and serve it instead of
`/login.html` when the failing navigation targets a gated path, with copy that distinguishes
outage from sign-out; (b) once gated `.js` becomes cacheable per the second finding above,
revisit whether a read-only shell for the highest-value modules can be cached deliberately —
that is a real product decision about whether the code-as-secret posture is worth "the studio
is unusable when Netlify hiccups", and it should be made explicitly rather than by default.

### LOW — the five foundation files with no logic tests

Every `lib-*.js` in the repo is covered. These are not:

| file | lines | status |
|---|---|---|
| `js/budget-engine.js` | 1,081 | none — see the HIGH finding; deleting it is the fix |
| `js/model-config.js` | 459 | none — owns `VIDEO_MODELS`, which gates what the budget panel shows |
| `js/mastery-resolver.js` | 357 | none |
| `js/ffmpeg-wasm.js` | 264 | none |
| `js/config.js` | 102 | none |

`js/effects.js` (502) and `js/project-badge.js` (221) appear in `scripts/` only inside a deploy
manifest and a service-worker path list respectively — no assertions touch their behaviour.

`js/mastery-resolver.js` is the one worth a suite. It is pure logic — `parseHeadingMeta`,
`normalizeLocationKey`, `inferCharRole`, `syncLocationBible`, `resolveShotMastery`,
`enrichPrompt` — with no DOM anywhere, and it decides which reference images and prompt
additions every generated shot receives, so a regression in it degrades character and location
consistency silently across the whole Studio. The only thing stopping a suite is `:344`
assigning to bare `window.SBMastery` instead of the `(function(root){…})(typeof window !== 'undefined' ? window : globalThis)`
pattern every other module in the repo uses. One-line change, then a suite. **Its name is also
misleading for the later self-improvement phase: it learns nothing.** It is a deterministic
resolver with no persistence and no feedback. Worth stating plainly so nobody counts it as part
of the learning layer.

### LOW — `timeline/` is the largest module and half of it is untested

Not strictly my slice, but it falls out of the coverage sweep and the foundation has to support
it. Untested: `timeline-characters.js` (517), `timeline-continuity.js` (392),
`timeline-locations-enrich.js` (347), `timeline-locations.js` (258), `pro-cut.js` (227),
`timeline-enrich.js` (205), `timeline-export.js` (130) — 2,076 lines. Also
`workflow/advisor-ui.js` (164). Every one of them lacks the `lib-*.js` split the brief mandates,
which is *why* they are untested: there is no pure-logic file to load in node. The fix is the
same each time — extract the logic into `timeline/lib-<x>.js`, leave the DOM behind, add a suite.
Sequence it after the two HIGH items.

---

## What is missing entirely

### 1. A schema/migration system for `SB_*` — HIGHEST VALUE, build first

There is none. All 67 keys are `_v1`, nothing reads the version, and there is no migration code
in the repo. Every module hand-rolls `JSON.parse(localStorage.getItem(KEY) || 'null')` and hopes
(`lib-vault.js:210`, `producer/budget-sheet.js:203`, `js/learn.js:27`, and so on across all 28
modules). Today that costs nothing because nothing has ever changed shape. The **first** time a
module needs a different shape, five live owners with real productions in `localStorage` and
`.cinamate` files on disk have no upgrade path, and `parseArchive` will reject anything that
tries to declare itself different.

Attach to `projects/lib-vault.js` — it already owns the key namespace (`:15`), the portability
rule (`:24`) and the archive header (`:177`). Build:

- `js/lib-schema.js` — a registry `{ SB_Boards_v1: { version: 1, migrate: {…} } }`, a
  `readStore(key)` that dispatches through the chain, and a `writeStore` that stamps the
  version. Pure, node-testable, `scripts/test_schema.mjs`.
- Extend the archive header **now**, while everything is still 1, so archives written from
  today carry `{ app, builtAt, schema: {…} }`. This is the part that expires: every archive
  written before it lands is permanently unversioned.
- Widen `parseArchive` to accept `cinamate/N` for `N <= CURRENT`.

Roughly 300 lines plus a suite. It is small, and it is the only item on this list that gets
strictly more expensive the longer it waits.

### 2. A telemetry/metrics layer to feed self-learning — HIGH VALUE

`CLearn` is the seed of one but it only records two event types (a budget row, a local render)
and only ever answers questions those two were designed for. There is no record of what an owner
actually does: which modules are opened, which estimates are accepted versus overridden, which
generated shots are kept versus regenerated, where a workflow stalls. Without that, "make the
platform self-improving" has almost nothing to learn from, and no way to tell whether a change
helped.

Attach beside `js/learn.js` as `js/lib-metrics.js`, under a `CIN_Metrics_v1` key, same
outside-`SB_*` placement, same nothing-leaves-the-browser rule (which is the correct posture and
should not change). A ring buffer of `{t, module, event, ctx}` with a hard cap and an explicit
schema; a `report()` that aggregates; and — the part `CLearn` is missing today — **a screen that
shows the owner what has been recorded and lets them delete a row.** Then move `CLearn`'s three
loops on top of it so there is one store, one backup path, one review screen.

Dependencies: item 1 first (so the store is versioned from birth rather than retrofitted), and
the `CIN_*` sync channel described in the learning finding above, or this dies with a browser
profile exactly as `CLearn` does today.

Roughly 400 lines plus a review UI plus a suite.

### 3. A shared component library — MEDIUM VALUE

`scripts/test_helpers_defined.mjs` exists because `esc()` was defined on some pages and not
others and four renderers died. That test is a workaround for a missing library. The same
helpers are re-implemented per page: `esc` in `js/budget-engine.js:789`, `js/project-badge.js:11`
and inline in most module pages; `csvCell` with the identical `/^[=+\-@\t\r]/` formula-injection
guard in `producer/budget-sheet.js:175-180`, `finance/lib-money.js` and elsewhere; toast, table,
tier-select and money-format each several times over.

Attach as `js/lib-ui.js` (a `<script>` + IIFE like everything else — no build step, no
framework, the constraint holds). `esc`/`escT`/`escAttr`/`jsq`/`csvSafe`/`fmtMoney` first,
since those are the correctness-critical ones and there is already a test that would verify
their reachability on every page. Toast and table can follow.

Value is real but incremental; it does not unblock anything else. Sequence third.

### 4. A build/dev loop — MEDIUM VALUE, cheap

There is `local-server.py` and a 424-line deploy script, and nothing between them.
`scripts/smoke_pages.mjs` exists but is not in the suite list. Missing: one `npm run dev` that
serves the tree with the gate's headers applied locally (COOP/COEP matter — `js/ffmpeg-wasm.js:7-16`
hard-fails without cross-origin isolation, so ffmpeg work cannot be tested against a plain
static server at all), plus a watcher that re-runs the affected suite on save. `run_all_tests.mjs`
takes long enough that nobody runs it per-edit, which is how a 44/44 board stays green while the
untested 4,000 lines listed above drift.

Small: a `scripts/dev_server.mjs` (~150 lines, node http, reuse the `MIME` map and header block
from `gate.js:17-27` and `:128-142` so local and production headers cannot diverge) and a
`--watch` flag on the test runner. Sequence it first *if* the team is about to do a lot of
building, since it makes everything after it faster; otherwise fourth.

### Sequence

1. `_headers` vendor caching (3 lines) and the gate `Cache-Control` branch — hours, immediate.
2. Delete the `budget-engine.js` fork — the dashboard is quoting wrong numbers today.
3. Schema/migration (item 1) — only item that gets more expensive with delay.
4. Dev loop (item 4) — makes 5-7 cheaper.
5. Telemetry + `CIN_*` sync channel (item 2), then rebuild `CLearn` on it with a review/undo UI.
6. Shared function lib for the token verifier; deploy manifest fix + its test.
7. Component library (item 3); `lib-*.js` extractions for `timeline/` and `js/mastery-resolver.js`.

---

## Evidence

Files read in full: `netlify/functions/gate.js`, `js/learn.js`, `js/mastery-resolver.js`,
`js/config.js`, `js/auth.js`, `projects/lib-vault.js`, `sw.js`, `login.html`,
`scripts/run_all_tests.mjs`.

Files read in part, with the lines cited above verified: `js/budget-engine.js` (1-40, 27-240,
775-1081), `timeline/timeline-budget.js` (1-25, 468-486, 1238), `js/model-config.js` (1-25, 432-433),
`js/project-badge.js` (1-25), `js/ffmpeg-wasm.js` (1-22), `js/effects.js` (1-18),
`netlify/functions/verify-owner.js` (1-95, 106-260), `netlify/functions/projects-sync.js` (1-60),
`netlify/functions/lib/*` (headers of all 15), `scripts/deploy_cinamate.mjs` (1-140, 205-320, 374-424),
`scripts/test_helpers_defined.mjs` (1-60), `scripts/test_learn.mjs` (1-45), `scripts/test_tools.mjs` (1-40),
`scripts/test_ops.mjs` (1-35), `scripts/test_deploy_exclusions.mjs` (190-210),
`scripts/test_modules.mjs` (40-52), `scripts/test_vault_sanitize.mjs` (17-135),
`_headers` (all 80), `_redirects`, `netlify.toml` (1-60), `producer/budget-sheet.js` (150-215),
`props/lib-props.js` (175-225), `finance/lib-money.js` (120-150), `workflow/advisor-ui.js` (85-110),
`production/production.js` (395-415), `dashboard.html` (1832, 2305-2315), `timeline/timeline.js` (85-95, 1807),
`timeline/index.html` (24-30, 315).

Verified by execution, not inference:

- `node scripts/run_all_tests.mjs` → 44/44 suites, 1,299 assertions, exit 0.
- `diff js/budget-engine.js timeline/timeline-budget.js` → 282 lines, 22 hunks; both files
  contain `root.SBBudget = API`.
- Eval'd `js/budget-engine.js` in node: loads clean and exports 20 symbols — it is node-testable
  today and simply has no suite.
- Cross-referenced all 30 `*/lib-*.js` files against every `scripts/test_*.mjs`: zero uncovered.
- Cross-referenced all 11 `js/*.js` and all `producer/`, `timeline/`, `workflow/`, `today/` js
  against the suites, discounting mentions that are deploy manifests or SW path lists rather
  than assertions — that is where the untested-files table comes from.
- Inventoried every `SB_[A-Za-z0-9]+_v\d+` literal in the tree: 67 distinct keys, all `_v1`.
- Grepped `migrat|schemaVersion|upgradeSchema` across the tree: only two model-id renames
  (`timeline/timeline.js:2026`, `js/model-config.js:411`), no schema migration anywhere.
- Grepped `CLearn.reset` and `CIN_Learn` across every `.html`/`.js`: no UI call site exists.
- Measured the gated tree at 2,671,316 bytes (2.55 MB) across 141 files, excluding the
  `.zip`/`.jpeg` the deploy correctly refuses; counted 26 subresource tags in
  `timeline/index.html` and 472 KB of `timeline/*.js` + `js/*.js`.
- Compared `/\.netlify/functions/[a-z-]+` call sites (12 distinct) against the deploy's function
  manifest (3).

No claim above rests on a filename.
