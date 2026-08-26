# Team A Dev 20 — missing platform capability (cross-cutting)

Scope: the things whose absence hurts in every module at once. Everything below
was searched for before being called missing; where a feature exists under
another name I say so and credit it rather than claiming a gap.

Verification baseline: `node scripts/run_all_tests.mjs` → **44/44 suites passed**
at time of audit. No file was edited.

---

## What exists and works

- `netlify/functions/gate.js:87-168` — the entire application is served from
  inside the function, not the CDN, and only to a request carrying a valid
  HMAC-signed `cin_owner` cookie. Pages redirect, subresources get a bare 401.
  `scripts/deploy_cinamate.mjs:212-233` proves the partition: anything not in
  `PUBLIC_FILES`/`PUBLIC_PREFIXES` is physically moved into `fn-gate/site`.
  This is a genuinely strong perimeter, not security theatre.
- `netlify/functions/projects-sync.js:216-285` — cloud push with real
  optimistic concurrency (`ifVer` compares a monotonic counter, not the
  minute-granular `savedAt`), an 8-slot version ring, and soft delete with a
  `tomb:` record naming who deleted what. The comments show these were learned
  the hard way; the reasoning is sound.
- `js/project-badge.js:164-209` — client-side conflict awareness. Every push
  re-reads the catalog, and auto-sync *holds back* with a visible warning when
  the cloud copy belongs to another owner or moved since this tab last looked.
  The `sendBeacon` path (`:156-162`) correctly refuses to fire when it cannot
  verify, on the principle that losing four minutes of your own autosave beats
  burying a colleague's day.
- `projects/lib-vault.js:194-205` — `restore()` refuses an archive that filters
  down to zero portable stores, so one empty file cannot erase a workspace.
  `projects-sync.js:240-242` enforces the same rule server-side. Both sides
  check; that is the right instinct.
- `sw.js:69-75` — the service worker refuses to cache anything the gate serves,
  enforced by *two* independent checks (a path allow-list and the response's
  own `Cache-Control`) that must agree. Deliberate, correct, and the direct
  cause of gap **M2** below — a real trade-off, not an oversight.
- `js/learn.js` — three learning loops that genuinely close. The render-speed
  loop is the most complete: `timeline/timeline.js:1807` records real wall time,
  `timeline/timeline-budget.js:483-484` spends it on the next estimate.
  `props/lib-props.js:189-195` applies the budget multiplier at price time.
- `editor/cut-ui.js:81-83` and `timeline/timeline.js:32-36` — real undo/redo
  with snapshot stacks, wired to Ctrl+Z/Ctrl+Y (`cut-ui.js:935-936`).
- `wardrobe/index.html:132-171` and `locations/index.html:129-146` — photos in
  IndexedDB rather than localStorage. The right storage choice; see **M1** for
  the consequence nobody finished.
- Mobile viewport meta is present in 29 of 30 module `index.html` files, and
  `today/index.html` is a purpose-built phone call sheet. The responsive
  intent is real.

---

## What exists but needs work

- **`js/learn.js:62-75` — budget calibration is keyed on account code alone.**
  `state.budget[c.acct]` carries a single EWMA ratio per account. A $40k short
  and a $4M feature teach the same `2000` multiplier, and a non-union shoot
  corrects a union one. In a real production this is worse than no
  calibration: it moves the estimate confidently in a direction justified by
  an unrelated film. Add a coarse context bucket to the key — budget decade
  (`1e4`/`1e5`/`1e6`), union vs not — and require `n>=2` *within a bucket*
  (the `n<2` guard at `:79` is right, it is just counting the wrong
  population). **HIGH.**
- **`producer/budget-sheet.js:161-166` — calibration is applied only while
  seeding a blank sheet.** `seedFromEstimator()` is the sole call site in that
  module. Re-opening an existing sheet after three invoices land never
  re-applies what those invoices taught; the learning is visible to a new
  project and invisible to the current one, which is the project the producer
  is actually worried about. Offer a "re-calibrate estimates" action over the
  live sheet showing per-line deltas before applying. **HIGH.**
- **`js/learn.js:92-100` — render timings carry no model or resolution.**
  `state.render` entries are `{c, w, t}`. A 480p SVD clip and a 1080p WAN clip
  land in the same median, so `genSecPerClip()` (`:121-125`) answers a
  question it was not asked. `timeline/timeline.js:1807` already knows
  `pollModel` at the call site — pass it, key the stats by model, and fall
  back to the pooled median only when that model has fewer than three
  samples. **MED.**
- **`js/learn.js:62-65` — a mistyped actual is learned permanently.** The
  fingerprint is `acct|desc|est|act`. Correcting `5000` to `500` changes the
  fingerprint, so the ratio from the typo is already in the EWMA and the
  correction is learned *as well as*, not *instead of*. There is no un-learn,
  and `reset()` (`:202`) is exposed on the API but wired to no UI anywhere in
  the repo. Store the last ~50 contributions with their fingerprints so one can
  be withdrawn and the EWMA replayed. **MED.**
- **`boards/boards.js:136-141` — storyboard frames are JPEG data URLs in
  localStorage.** Frames are downscaled to 480×270 at q0.65, which is
  disciplined, but base64 still inflates ~33% and `save()` (`:26`) can only
  catch the quota failure and say "Storage full — export a project backup and
  clear old frames". A 60-shot board is not an unusual board. `wardrobe` and
  `locations` already solved this with IndexedDB; boards should use the same
  store. **MED.**
- **Whole-project granularity in the sync layer** (`js/project-badge.js:179-188`,
  `projects-sync.js:258-264`). The unit of concurrency is the entire archive —
  all 59 `SB_*` keys. Two owners working simultaneously on *different modules*
  still collide: one is told "auto-sync is holding back" and must choose
  between pulling (losing their work) or pushing over (losing the other's).
  There is no merge. The conflict detection is good; the granularity makes it
  fire constantly for the one workflow it should permit. Per-key versioning
  would let a budget edit and a storyboard edit both land. **HIGH.**
- **Keyboard operation stops at two modules.** Counting `keydown`/`keypress`
  handlers: `editor` 1, `sets` 1, and **zero** in `boards`, `producer`,
  `production`, `timeline`, `finance`, `workflow`, `projects`, `today`. The
  data-entry-heavy modules — the budget sheet and the registers, where someone
  types for an hour — are entirely mouse-driven. Tab/Enter/arrow navigation in
  `tools/tools-core.js`'s shared `Register` engine would fix most of it in one
  place. **MED.**

---

## What is missing entirely

### M1 · Media does not travel with the project — **HIGHEST**

**Where I looked:** `projects/lib-vault.js` (whole file), `projects/index.html`,
grepped `indexedDB|idb|IDB` across the vault — **zero hits**.

Two IndexedDB databases exist and hold real production media: `cinamate_wardrobe`
(`wardrobe/index.html:133`) and `cinamate_scout` (`locations/index.html:132`).
The vault snapshots *only* localStorage: `lib-vault.js:14` `KEY_RE =
/^SB_[A-Za-z0-9]+_v\d+$/`, and `allKeys()`/`snapshot()` (`:26-44`) enumerate a
localStorage-like store. IndexedDB is outside that boundary entirely.

The references, however, are inside it. `SB_Wardrobe_v1` stores `l.photoIds`
(`wardrobe/index.html:362-363`) and `SB_Locations_v1` stores `loc.photos`
(`locations/index.html:159`) — both are arrays of IDB keys. So:

- **Export drops every photo silently.** A `.cinamate` archive carries the ids
  and none of the bytes. On the receiving machine `locations/index.html:209`
  does `getPhoto(id, cb)` and, on a miss, `im.parentNode.removeChild(im)` — the
  image element is *deleted from the DOM*. No error, no placeholder, no
  "3 photos could not be loaded". The scout book simply appears to have fewer
  photos than it has.
- **Cloud push/pull drops them the same way.** Push from the laptop, pull on
  the desktop, and every location and wardrobe photo is gone.
- **Deleting a project slot orphans the bytes forever.** `deleteSlot()`
  (`lib-vault.js:263-269`) removes the meta entry; nothing walks the IDB stores,
  so dead photos accumulate on disk invisibly and permanently.

Why a production cares: location photos *are* the scout. Losing them silently
between the recce and the tech scout means the decision they support cannot be
re-made, and nobody finds out until someone asks "where's the photo of the
loading dock?" A visible failure would be a bug; a silent one is a trap.

**Build sketch.** Give the vault an asset side-channel. New key `SB_Assets_v1`
holds a manifest `{id, store, mime, bytes, sha}` per blob; the archive format
gains a sibling `blobs: {id: dataUrl}` alongside `stores`. `snapshot()` gains an
async pass that reads both IDB databases; `restore()` writes them back before
the SB_* keys land. Guard on total size — the 4 MB cloud cap
(`projects-sync.js:25`) cannot hold real photos, so the cloud path should push
the manifest only and warn honestly, while file export carries the bytes.
Minimum viable fix, worth shipping first: make the miss *visible* — render a
"photo not in this copy" placeholder instead of removing the element.
**Size:** ~1 day for the visible-failure fix; ~3-4 days for full asset
portability including the vault tests.

### M2 · The on-set module cannot work on set — **HIGHEST**

**Where I looked:** `sw.js` (whole file), `scripts/deploy_cinamate.mjs:212-233`,
`today/index.html`, `manifest.webmanifest`.

`today/` is explicitly the phone call sheet — "Today's call sheet on your phone
— call time, scenes, cast, locations, hospital and safety notes"
(`today/index.html:11`). It is 157 lines, reads entirely from localStorage
(`:66-95`), and needs no network to render.

It cannot load without one. `today/` is not in `PUBLIC_FILES` or
`PUBLIC_PREFIXES` (`deploy_cinamate.mjs:212-220`), so it is served by the gate
with `Cache-Control: private, no-store` (`gate.js:130`). `sw.js:69-75` refuses
to cache exactly that, by design and correctly. So `sw.js:127` applies:
`if (req.mode === 'navigate') return caches.match('/login.html')`. Offline, the
call sheet is a login page.

Why a production cares: locations are where signal is not. A canyon, a
stage with a metal roof, a basement, a rural exterior — this is the *normal*
case for a shoot day, and it is the exact moment the hospital address and the
safety notes matter. The one module built for the phone is the one module
guaranteed to fail there.

**Build sketch.** Do not weaken the gate — the reasoning in `sw.js:16-26` is
right. Instead make `today/` a genuine offline shell: a small public bundle
(`today/offline.html` + its CSS) added to `PUBLIC_FILES` and `SHELL`, containing
*no* production data and rendering purely from localStorage, which is
per-device and already survives offline. The gated `/today/` stays as-is for
online use and writes a `SB_TodayCache_v1` snapshot of just the current day
(call time, scenes, cast list, location, hospital, safety notes) that the
offline shell reads. No secrets ship to the CDN — the shell is an empty
renderer; the data never left the device. Add a `test_sw_cache.mjs` case
asserting the shell is public and carries no `SB_` payload.
**Size:** ~2 days. Highest value-per-hour on this list.

### M3 · The schedule learning loop is open, and both halves are already captured — **HIGH**

**Where I looked:** `js/learn.js` (whole file — loops are budget, render, cache
only), `production/lib-prod.js:21-60`, `producer/schedule-board.js`, and
grepped `variance|behindSchedule|daysBehind|planVsActual|actualPages` across the
repo — the only `variance` hits are financial (`finance/lib-money.js:90-95`).

Days are the most expensive estimate a production makes, and it is the one
estimate nothing learns. Yet both sides of the ledger already exist:

- **Planned:** `SB_ScheduleBoard_v1` assigns every scene a `day`
  (`schedule-board.js:104-107`) and knows its page count in eighths (`:23`).
- **Actual:** `dpr()` derives `scenesCovered` for a date from `SB_TakeLog_v1`
  (`production/lib-prod.js:27-29,38`).

They are never compared. `dpr()` returns `scheduledScenes` as a raw count of
all scheduled scenes (`:34,43`) sitting next to `scenesCovered` — two numbers
that look like a comparison and are not one. The single most important line on
a real DPR, "scheduled 5 3/8 pages, shot 3 1/8, behind 2 2/8", is absent.

And so `autoScheduleModel()` keeps its hardcoded default: `perDay =
Math.max(1, (pagesPerDay || 4.5) * 8)` (`schedule-board.js:94`), with `pace:
4.5` stored as a user preference (`:193,426`) that no outcome ever corrects.
The platform will hand you the same optimistic board on your fifth film as your
first, having watched you miss it four times.

Why a production cares: a schedule built on a pace you have never achieved is
the mechanism by which films go over. Every department plans against it. Being
told on day 4 that your real pace is 3.1 pages and the back half needs
reboarding is worth more than every other estimate on the platform combined.

**Build sketch.** Extend `dpr()` to compute planned-vs-actual eighths for the
date (both inputs are already in its `stores` argument — `board` and `takes` —
so the signature does not change) and surface it in `dprText()`. Then add a
fourth loop to `js/learn.js`: `learnPace({plannedEighths, actualEighths, day})`
storing an EWMA under `state.pace`, keyed by unit (main/second) and day/night,
and have `schedule-board.js:94` prefer the learned pace over 4.5 once three
shoot days exist — showing the source, exactly as `budget-sheet.js:164` already
labels a calibrated line. Lives in `CIN_Learn_v1` alongside the other loops, so
it survives project switches and improves the next film. Pure-logic, so it is
testable in `scripts/test_learn.mjs` and `test_producer_suite.mjs`.
**Size:** ~2-3 days. The best self-learning opportunity in the repo, because
the data collection is already done.

### M4 · The platform claims it is learning and cannot prove it — **HIGH**

**Where I looked:** grepped `mape|MAPE|accuracy|residual|holdout|baseline`
across all non-vendor JS — **no hits**. Read `js/learn.js` in full and every one
of its 16 call sites.

`workflow/advisor-ui.js:96-101` renders: *"Self-learning: N budget actuals
learned (avg correction ×M) · N renders timed — your machine averages Xs/clip
(trend)"*. Every number there measures **activity**, not **accuracy**.
`budgetSummary()` (`learn.js:82-89`) returns the mean magnitude of the
correction — a number that grows as the system becomes more *wrong*, not less.
`renderStats().trend` (`:107-112`) compares early against late wall times, which
tracks the machine's mood, not the prediction's quality.

Nothing anywhere asks the only question that matters: **was the calibrated
estimate closer to the actual than the uncalibrated one would have been?** The
system therefore cannot distinguish learning from drift, and a user has no
basis to trust a `+18%` adjustment beyond the fact that it was printed
confidently. For a tool that asks a producer to change a budget line on its
say-so, that is the difference between an instrument and a rumour.

**Build sketch — an accuracy ledger.** This is cheap because the data flows
through one function already. In `learnBudget()` (`learn.js:55-76`), at the
moment both `est` and `act` are known, also record what the model *would have
predicted* before this observation: `pred = est * calibration(acct).mult`.
Append `{acct, est, act, pred, t}` to a bounded `state.ledger` (cap ~200, same
slice discipline as `state.seen` at `:65`). Then compute two numbers over the
ledger: naive MAPE (`|act-est|/act`) and calibrated MAPE (`|act-pred|/act`).
The honest headline becomes *"across 34 line items, calibrated estimates were
off by 12% against 21% uncalibrated"* — or, just as valuably, *"no better than
uncalibrated yet; needs more data"*. Because `pred` is computed from the state
*before* the observation is folded in, this is a true walk-forward test, not a
fit reported as a result.

Two guardrails worth building in: refuse to display a verdict below ~10
observations, and show the calibration as a range rather than a point once the
ledger has enough spread to estimate one. Same treatment applies to
`genSecPerClip()` — log predicted vs actual wall time per render and report the
error. **Size:** ~2 days including tests in `scripts/test_learn.mjs`. This is
the change that turns the learning layer from a claim into a measurement, and
it should land *before* any new signal is added, because it is what tells you
whether the new signal helped.

### M5 · No roles — five owners, all with god-mode — **HIGH**

**Where I looked:** `netlify/functions/verify-owner.js:1-80`, `gate.js:15`,
`projects-sync.js:22`, `js/auth.js`, and every `SB_Roles_v1` / `SB_Crew_v1` call
site. **Important:** `SB_Roles_v1` is *casting* roles — Lead / Supporting / Day
player, cast status (`production/production.js:53-70`) — and `SB_Crew_v1` is a
contact directory with rates and dietary notes (`tools/tools-registers.js:29-38`).
Neither is an access-control concept. There is no permission model anywhere.

Identity is a hardcoded list of five names in three separate files
(`verify-owner.js:60`, `gate.js:15`, `projects-sync.js:22`), each with a
password in an env var, each with identical unlimited authority. Any owner can
overwrite or delete any other's production (`projects-sync.js:287-314`); the
blob store is a single flat namespace shared by all five.

A crew of forty needs: a 1st AD who edits the stripboard but cannot see deal
memos or the budget; a line producer who owns the budget; department heads who
read the schedule and write only their own breakdown; a UPM who approves; cast
who see only their own sides and call times. Today the only way to give a
gaffer a call sheet is to hand them a login that can also delete the film.
This is the single largest blocker to the platform leaving a five-person studio.

**Build sketch.** Deliberately staged, because the honest version is large.
*Stage 1 (~3 days, high value on its own):* a read-only share link. A new
function mints a scoped, expiring HMAC token — same signing pattern as
`verify-owner.js:65-71`, so no new crypto — carrying `{project, scope:'today'|
'schedule', exp}`; `gate.js:38-54` gains a second accepted token shape that
grants only the named paths. That alone lets forty people receive a call sheet
without an owner account. *Stage 2 (~2 weeks):* real accounts with a role field
and per-module read/write/none, which requires moving identity out of env vars
into the blob store and a per-project ACL — and note the client is not the
boundary: `gate.js` must enforce path scope and `projects-sync.js` must enforce
project scope, exactly as both already independently re-check the owner list
today. Do **not** rename `SB_Roles_v1`; the access concept needs a new key
(`SB_Access_v1`).

### M6 · No audit log — **MED-HIGH**

**Where I looked:** grepped `audit log|auditLog|changelog|activity log` across
all JS — **zero hits**. The nearest thing is `savedBy`/`savedAt` on a whole
production (`projects-sync.js:282`), surfaced in `projects/index.html:204,238`
and `js/project-badge.js:185-187`. That tells you who last saved *everything*.
It cannot tell you who changed *this*.

With five owners sharing one namespace and no per-field attribution, "the
budget says 340k and I remember 280k" has no answer. On a real production that
question is asked about the schedule, the deal memos and the insurance
certificate, and the answer determines who is liable.

**Build sketch.** Ride the existing sync path rather than instrumenting 28
modules. `js/project-badge.js` already hashes the workspace before every push
(`lastPushedHash`, `:157-159,207`); extend that to a per-`SB_*`-key hash, diff
against the previous push, and record `{key, who, at, bytesBefore, bytesAfter}`
into a new `SB_Audit_v1` ring (cap ~500). This gives module-level, not
field-level, attribution for near-zero cost and no per-module work — "KZ465
changed the budget sheet at 14:20" is most of the value. Field-level diffing
can come later for the three or four stores that warrant it.
**Size:** ~2 days.

### M7 · No search across a project — **MED**

**Where I looked:** grepped `search across|globalSearch|searchAll|omnisearch|
command palette` — zero hits. Grepped `search` in `dashboard.html` — zero hits.
Individual registers filter their own rows; nothing spans modules.

A production asks cross-cutting questions constantly: "where does the dog
appear?" touches the script, breakdown, props, safety, casting and schedule.
Today that is six modules opened by hand, and the answer is only as good as the
operator's memory of which modules exist — with 28 of them, that is a real
limit.

**Build sketch.** Everything is already in one localStorage namespace, which
makes this unusually cheap. A shared `js/find.js` walks all `SB_*` keys,
JSON-walks each value to a depth cap, matches a query against string leaves,
and returns `{key, path, snippet, moduleHref}`. Render it as a Ctrl-K overlay
in the shared shell so every page inherits it. No index to maintain; a linear
scan over a few MB is imperceptible. Must use `esc()` on every snippet — these
are stored values and several arrive from third parties. Ship read-only
(jump-to-module) first. **Size:** ~2-3 days.

### M8 · No calendar export and no way to actually send a call sheet — **MED**

**Where I looked:** grepped `\.ics|VCALENDAR|icalendar` — **zero hits**.
Grepped `mailto|smtp|sendgrid` in module JS — nothing that sends. `SB_CallDist_v1`
(`tools/tools-registers.js:47-64`) is a *log* that you sent something, with
`method` and `status` columns typed in by hand — it tracks delivery it does not
perform.

Everything the platform knows is date-shaped — shoot days, post milestones
(`post/lib-post.js:35`), festival deadlines, option expiries — and none of it
can reach the phone the crew actually runs their life from. A call time that
lives only inside a web app is a call time somebody misses.

**Build sketch.** `.ics` is plain text and needs no dependency, which suits the
no-build constraint exactly. Add `js/lib-ical.js` (pure, node-testable, with a
`scripts/test_ical.mjs`): `toIcs(events)` emitting VEVENTs with UID, DTSTAMP,
DTSTART/DTEND and correct CRLF folding at 75 octets. Wire an "Add to calendar"
export to the schedule board, post calendar and festival deadlines. Same
escaping discipline as the CSV rule — commas, semicolons and backslashes are
structural in ICS and must be escaped, and the injection concern is real for
the same reason. Sending email needs a service and is a separate decision;
`.ics` download plus a `mailto:` with the file attached by the user covers most
of the need without one. **Size:** ~2 days.

### M9 · Undo is not a platform service — **MED**

**Where I looked:** grepped `undo|redo` across all non-vendor JS. Exactly two
implementations: `editor/cut-ui.js:81-83` and `timeline/timeline.js:32-36`.
Both are good. Neither is shared.

The other 26 modules have no undo at all — including the budget sheet, the
stripboard and every register, which are precisely where destructive mistakes
happen (a mis-drag on the board reassigns a scene's day with no way back). The
two existing implementations are near-identical in shape: snapshot to JSON,
push to a capped stack, restore and re-render.

**Build sketch.** Extract that shape into `js/lib-history.js` — `History(get,
set, {cap})` with `push/undo/redo/canUndo`, pure and node-testable. Adopt it in
the shared `Register` engine (`tools/tools-core.js`) and the schedule board
first; that covers most of the exposure in two call sites. Bind Ctrl+Z globally
in the shell, which also starts the keyboard work noted above. Leave the editor
and timeline implementations alone unless they migrate cleanly — they work, and
churning them earns nothing. **Size:** ~2 days for the library plus the first
two adopters.

### M10 · No reusable production templates — **MED**

**Where I looked:** grepped `template` across module JS. Every hit is a
*content* template — deal-memo boilerplate (`contracts/lib-deal.js:8`), the post
milestone list (`post/lib-post.js:35,255`). `newProject()`
(`projects/lib-vault.js:244-261`) creates a strictly empty workspace.

A studio shooting its fourth music video rebuilds the same crew list, the same
budget skeleton, the same insurance checklist and the same delivery spec every
time. Their accumulated judgement about how they work is trapped in a project
they must not disturb.

**Build sketch.** A template is a `.cinamate` archive minus the
production-specific stores — the format already exists and already round-trips.
Add `saveAsTemplate(store, name, {include:[...keys]})` and
`newFromTemplate(store, name, tpl)` to `lib-vault.js`, storing them under a new
`CIN_Templates_v1` key — outside `SB_*`, alongside `CIN_Learn_v1`
(`learn.js:23`), for the same reason: a template must survive project switches.
Ship with two or three built-ins (short film, music video, feature).
**Size:** ~2 days; the archive plumbing is done.

### M11 · Import/export gaps against the tools productions actually use — **MED**

**Where I looked, tool by tool, before claiming anything:**

| Tool | Status | Evidence |
|---|---|---|
| Final Draft `.fdx` | **import only** | `timeline/parser.js:646,651` `readFdx()`; no writer anywhere |
| Fountain | **export exists** | `writer/lib-treatment.js:220` `toFountain()` |
| EDL (CMX) | **export exists** | `editor/lib-cut.js:142` |
| OTIO | **export exists** | `editor/lib-cut.js:163-228` |
| Movie Magic | **absent** | only prose mentions in `timeline/timeline-budget.js`, `js/budget-engine.js` |
| StudioBinder | **absent** | zero hits repo-wide |
| Frame.io | **absent** | zero hits repo-wide |
| AAF / Avid ALE | **absent** | `AAF` hits are vendor PDF blobs only |
| Resolve FCPXML | **absent** | `fcpxml` hits are vendor blobs only |

The editor's interchange story is genuinely good — EDL and OTIO cover a
conform. The gaps that cost real money are elsewhere:

- **No `.fdx` export.** Script changes made in the writer cannot go back to the
  writer's Final Draft. The platform is a one-way door for the single document
  every other department derives from. Highest-value item here; `.fdx` is
  plain XML and the parser at `timeline/parser.js:651` already proves the shape
  is understood. **~2 days.**
- **No schedule interchange.** The stripboard cannot leave. Any 1st AD arriving
  with their own Movie Magic Scheduling setup, or leaving for one, re-types the
  board. A documented CSV with scene/pages/cast/day columns gets most of the
  practical value without reverse-engineering a proprietary binary — do that,
  and be honest in the UI that it is CSV rather than native. **~1 day.**
- **Frame.io / StudioBinder** are cloud services needing accounts and API
  tokens. Given "never commit a token" and the no-third-party-runtime
  constraint, these are poor fits; `SB_ReviewNotes_v1`
  (`tools/tools-media-ui.js:198-206`) plus a timecoded-note CSV export covers
  the review round-trip without the dependency. **Rank: LOW** — I would not
  build these.

### M12 · No notifications and no approval routing — **MED**

**Where I looked:** grepped `notification|notify(` — every hit is prose inside
safety or budget copy (`safety/lib-safety.js:208`,
`timeline/timeline-budget.js:119`), not a mechanism. Grepped
`approval|approve|signoff` — all hits are contract *text*
(`contracts/lib-deal.js:101`, `clearance/lib-clear.js:120`) or the review-notes
concept in `screening/lib-screen.js:3`. Neither a notification bus nor an
approval state machine exists.

Real productions run on approvals with names attached: the UPM approves the
budget, the director approves the cut, the producer approves an over-scale
offer, legal approves a clearance. Today every one of those is a status
dropdown someone sets themselves, with no requester, no approver, no timestamp
and no record.

This is genuinely blocked on **M5** — an approval is meaningless without
identities to attach it to, and building it before roles exist would produce a
second self-set status field. Sequence it after M5. When built: a small
`SB_Approvals_v1` of `{id, subject, requestedBy, approver, state, at, note}`
with a shared widget any module can mount, plus a badge in the shell. **Size:**
~3 days *after* roles. **Rank: MED, blocked.**

---

## Recommended order

1. **M2** offline call sheet (~2d) — highest value per hour, unblocks the phone.
2. **M1** visible-failure fix for missing photos (~1d), then full asset
   portability (~3-4d) — stops silent data loss.
3. **M4** accuracy ledger (~2d) — build this *before* any new learning signal,
   because it is what tells you whether the next one helped.
4. **M3** schedule learning loop (~2-3d) — both halves of the data already
   exist; the highest-value estimate on the platform.
5. **M5 Stage 1** scoped share links (~3d) — forty people get a call sheet
   without forty god-mode logins.
6. **M6** audit log (~2d), **M9** shared undo (~2d), **M7** search (~2-3d).
7. **M8** `.ics` (~2d), **M10** templates (~2d), **M11** `.fdx` export (~2d).
8. **M5 Stage 2** real roles (~2w), then **M12** approvals (~3d).

Constraint check: every item above is vanilla JS, no build step, no third-party
runtime, pure-logic `lib-*.js` plus a `scripts/test_*.mjs`, and adds only new
`SB_*`/`CIN_*` keys — no existing key is renamed.

---

## Evidence

Files read in full: `docs/audit/BRIEF.md`,
`docs/audit/assignments/teamA-20.md`, `js/learn.js`, `js/mastery-resolver.js`,
`js/auth.js`, `netlify/functions/gate.js`, `netlify/functions/projects-sync.js`,
`sw.js`, `production/lib-prod.js:1-70`, `tools/tools-registers.js:1-70`,
`js/project-badge.js:140-209`, `projects/lib-vault.js:1-60,190-270`.

Files read in part, with the lines cited above verified individually:
`scripts/deploy_cinamate.mjs:212-247`, `netlify/functions/verify-owner.js:1-80`,
`producer/budget-sheet.js:150-215`, `producer/schedule-board.js:23,93-107,193,426`,
`props/lib-props.js:180-220`, `workflow/advisor-ui.js:88-115`,
`boards/boards.js:26,130-175,270,406`, `wardrobe/index.html:125-180,250,329-375`,
`locations/index.html:125-160,193-260`, `today/index.html:11,66-131`,
`editor/cut-ui.js:64,81-83,487,844-845,935-936`, `editor/lib-cut.js:130-228,384`,
`timeline/timeline.js:32-36,1807,1957-1958`, `timeline/parser.js:392,646-651`,
`timeline/timeline-budget.js:119,483-484`, `production/production.js:40-75,209-235,358-412`,
`tools/tools-media-ui.js:198-215`, `finance/lib-money.js:70-133`,
`post/lib-post.js:3-35,255`, `contracts/lib-deal.js:8,101`,
`clearance/lib-clear.js:120`, `screening/lib-screen.js:3`,
`writer/lib-treatment.js:220`, `dashboard.html:2060,2196,2309`.

Negative searches performed (all repo-wide over non-vendor, non-`docs` sources;
zero hits unless noted): `audit log|auditLog|changelog|activity log`;
`\.ics|VCALENDAR|icalendar`; `mape|MAPE|accuracy|residual|holdout|baseline`;
`search across|globalSearch|searchAll|omnisearch|command palette`;
`StudioBinder`; `frame\.io|frameio`; `Movie Magic|mmsx` (prose only);
`indexedDB|idb|IDB` within `projects/`; `variance|behindSchedule|daysBehind|
planVsActual|actualPages` (financial hits only, no schedule variance);
`notification|notify(` (prose only); `template` (content templates only);
`undo|redo` (two implementations only); `keydown|keypress` (counted per module:
`editor` 1, `sets` 1, all others 0).

Test baseline: `node scripts/run_all_tests.mjs` → 44/44 suites passed. No file
was edited during this audit.
