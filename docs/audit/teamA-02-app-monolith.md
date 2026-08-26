# Team A Dev 02 — `app.html`, the monolith

Scope: `/home/user/shotb/app.html` — 505,744 bytes / 9,330 lines. 411,677 bytes
(81%) is inline JS across 16 `<script>` blocks; 43,769 bytes is inline CSS in 2
`<style>` blocks; ~50 KB is markup. Gzipped the page is 139,418 bytes.

The single most important thing I found is not a bug in a function. It is that
**roughly a quarter of this file is UI that cannot be reached** — four of the
five top-level views are hidden by a CSS `!important` rule, and a whole second
5-step wizard is hidden behind a function with zero callers. Everything else in
this report should be read with that in mind: several "features" I checked for
correctness turn out to be unreachable, and a few things that look like dead
code are the only live path.

---

## What exists and works

- `app.html:2372` `esc()`, `:2378` `jsq()` — correct and correctly ordered.
  `jsq()` does backslash-escaping *before* `esc()` is applied on top, which is
  the only order that survives HTML entity decoding running ahead of the JS
  parser. The comment at `:2374-2377` states the reasoning accurately.
- Escaping discipline across the file is genuinely good. 167 `esc()` calls, 27
  `CinUrl.safe()` calls. I searched for the classic failure — a bare object
  property dropped into markup — with
  `'+\s*[a-z_$][\w$]*\.(name|text|desc|description|prompt|title|heading|label|value|url|note)\s*+'`
  and got 4 hits (`:2383`, `:2390`, `:2394`, `:5933`), every one of them
  building plain text for a `.txt` export or an API prompt, none of them HTML.
  I could not find an unescaped HTML sink in this file.
- `netlify/functions/gate.js:150-154` correctly re-issues a per-path CSP for
  `/app.html` that adds `https://www.gstatic.com` to `script-src` and the three
  Google identity hosts to `connect-src`. `_headers` never applies to a
  function response and the code says so at `gate.js:136`. The four Firebase
  compat bundles at `app.html:35-42` are pinned with SRI + `crossorigin`. This
  whole chain is right.
- `app.html:2429-2449` `pickStatus()` / `pickVideoUrl()` — a genuinely careful
  defensive unpacker that walks `video_url`, `url`, `video.url`, `videos[0]`,
  `outputs[0]`, `data.*` and recurses into `raw`. It matches what
  `netlify/functions/generate-video.js:136-141,243` actually returns for both
  WaveSpeed and Grok. This is the right shape for a provider-shim.
- `app.html:7522-7573` `mhPersistPendingJobs()` / `mhResumePendingPolls()` —
  in-flight `request_id`s are written to `sb_pending_<uid>` and re-polled after
  a reload, guarded by `projectCreatedAt` so a new project does not resurrect
  an old project's jobs. On a Kling render that takes 30-45 minutes this is the
  difference between a refresh costing nothing and costing the whole batch. It
  is the best-engineered thing in the generation pipeline.
- `app.html:2805-3035` `V._loadFFmpeg()` — fetches `ffmpeg-core.js` as text,
  concatenates it with a hand-written message handler, and builds the Worker
  from a blob so there is no `importScripts` to fail silently. It passes
  `wasmBinary` as transferred bytes rather than a URL, sidestepping
  ffmpeg-core's internal `locateFile` override. Real errors surface with real
  messages. The `crossOriginIsolated` guard at `:2809-2814` even distinguishes
  the iframe case. This is the one part of the file I would not touch.
- `app.html:6490-6491` puts `referrerpolicy="no-referrer"` on generated
  `<video>` and provides an `onerror` fallback link. Good instinct — though see
  the CSP finding below for *why* that fallback fires.
- `scripts/scan_html_sinks.mjs:219-239,264-269` — the allowlist stores an
  occurrence **count**, not just an expression, and `--check` fails when the
  observed count exceeds the reviewed count. The header comment at `:222-226`
  explains exactly why (two planted sinks were absorbed by an uncounted entry).
  This is the correct design and I agree with it.
- `node scripts/run_all_tests.mjs` → **44/44 suites passed** on the tree as I
  found it.

### The 23 reviewed interpolations — my verdict on each

First, a correction: the assignment says 23. `scripts/html_sinks_allow.json`
actually carries **34 distinct `app.html::` entries covering 90 occurrences**.
`node scripts/scan_html_sinks.mjs --only=app.html` reports 0 unreviewed.

I read all 34. **I agree with the substance of every one of them.** Three
qualifications:

1. **The cited line numbers have rotted.** The entries are keyed by expression
   text, so the line numbers inside `why` are prose, and much of that prose is
   now wrong. Verified examples: `ex(t)` cites `app.html:2358`, `ex()` is at
   `:2379`; the `i` entry cites `csLocked.forEach((c,i)=>)` at `3309`, it is at
   `:3323`; `sbProviderBadge(imgMode)` cites `app.html:1569-1573` and
   `SB_PROVIDER_LABELS (app.html:1557-1568)`, the real spans are `:1584-1588`
   and `:1572-1583`. The two entries that describe the *same* function disagree
   with each other — `prov` cites `sbProviderBadge` at `:1584` (correct) while
   `sbProviderBadge(imgMode)` cites `:1569` (stale). A reviewer re-checking
   these lands in the wrong function. Cheap fix: have `--migrate` also rewrite
   a `seen_at` line-number list, so drift is visible rather than silently
   misleading.
2. **The two load-bearing entries hold.** `key` (n=21) claims "`${si}-${shi}`
   from loop indices, digits and a hyphen". Verified at `app.html:8760` inside
   `scenes.forEach((scene,si)) → shots.forEach((shot,shi))`, and its 21 uses at
   `:8796-8851` land in `id=`, `data-`, and single-quoted `onclick` JS strings
   — none breakable by digits. `si` (n=18) claims all sites are loop indices or
   that index threaded as a parameter. Verified: `mhBgRenderClipCard(p,si,k)` is
   called only from `app.html:4813` and `:4881`, both with the loop counter, and
   `mhBgRenderTextField`/`mhBgRenderCineField` (`:4936`, `:4940`, `:4942`) only
   from inside `mhBgRenderClipCard`. Both entries' caveats ("if `key` ever stops
   being derived from indices alone this needs reading again") are the right
   caveat.
3. **`esc(0)` reasoning is correct.** `esc()` is `String(s||'')`, so `esc(0)`
   is `''`. Every "0-valued, so esc() would blank it" justification checks out.

Two structural gaps in the scanner itself, both of which app.html happens to
survive:

- `scan_html_sinks.mjs:185` tests `HAS_MARKUP` against `t.before`, which is only
  the text *since the previous* `${…}`. At `app.html:8820`,
  `<option ${o===ui.loc.tod?'selected':''}>${o}</option>`, the `before` of the
  second `${o}` is just `>`, which does not match `HAS_MARKUP` — so that sink is
  invisible. That is why the `o` entry is n=4 and not n=5. Here `o` comes from
  the `CINE` constant table so nothing is wrong, but the class of gap is real. I
  checked the adjacent-interpolation form `}${` across app.html: exactly 1
  occurrence (`:8702`) and it is `esc()`-wrapped. Fine today.
- `scan_html_sinks.mjs:195` requires `string + expr + string` on one line, so a
  trailing interpolation at end-of-statement is unseen. I measured this: 6 such
  sites in app.html (`:1621`, `:6518`, `:6527`, `:6551`, `:6574`, `:6667`), all
  either allowlisted deliberate-markup producers or `.toFixed()`. Also fine
  today.
- Counts only fail *upward*. Delete one of the 21 `key` sinks and add a new
  `key` interpolation somewhere genuinely unsafe and the total stays 21 and
  `--check` passes. Worth a `--check` warning when observed < allowed.

---

## What exists but needs work

### HIGH — Four of the five views are dead, and ~24% of the file ships to serve them

`app.html:632`:

```css
#dashView, #fwdView, #revView, #charView { display: none !important; }
```

`!important` means no `element.style.display` can ever reveal them, and
`showMode(m)` (`:2009-2020`) ignores its argument entirely — every call path
lands on `#mediaView`. `showMode('fwd')` at `:2248` and `showMode('char')` at
`:1065` do nothing.

What that retires, all still shipped and parsed on every load:

| Region | Lines | Bytes | What it is |
|---|---|---|---|
| `:335-763` | 429 | 36,012 | markup for dashView / fwdView / revView / charView |
| `:1055-1152` | 98 | 6,310 | markup for the legacy `#mhStep2..5` wizard panes |
| `:2108-2413` | 306 | 36,438 | file upload, fallback parser, Reverse Mode, `render()`, **all five exporters** (`xEDL` `xDocx` `xCSV` `xTxt` `xPr`) |
| `:2415-3249` minus 3 live members | ~435 | ~22,000 | `SBVideo` batch engine, gallery, ZIP-all, crossfade stitcher, credits/balance |
| `:3251-3334` | 84 | 3,233 | Character Studio (`csGenerate` … `csRenderLocked`) |
| `:9255-9318` | 64 | 3,862 | dashboard project cards |
| legacy wizard fns | ~856 | — | `mhEnter` `mhCheckAutoExport` `mhGoto` `mhRenderScriptStep` `mhLockScript` `mhRenderBackgrounds` `mhBgRender*` `mhRenderCharacters` `mhRenderGenerate` `mhRenderClipsGrid` |

≈ **2,270 lines, ≈ 130 KB (26% of the page)** that no owner can reach.

Reachability, verified rather than assumed:

- `mhEnter()` (`:3917`) has **zero callers** anywhere in the repo — I grepped
  every `.html` and `.js` outside `node_modules`.
- `mhGoto()` is called only from buttons inside `#mhStep2..4` (`:1068`, `:1069`,
  `:1082`, `:1083`, `:1118`), from `:4238` (a banner rendered by
  `mhRenderScriptStep`, itself only called by `mhGoto(1)`), and from
  `mhLockScript()` (`:4436`) — which the live UI does not use; the live Lock
  Script button at `:841` calls `mhLockScriptAndExtract()`.
- `SBVideo` members: `_genShot` (only `:2366`), `_onBatch` `_openGallery`
  `_openStitch` (only `:2319-2321`), `_zipAll` (only `:2786`), `_runStitch`
  (only `:3177`), `_stitchClips` `_groupClipsByScene` `_fetchToU8`
  `refreshBalance` `initFromResult` — every one of them reachable only from
  `render()` at `:2304`, which paints into `#resArea` inside `#fwdView`.
  `_cancelPoll` (`:2628`) has zero callers. The **only** live members are
  `_startPoll` (`:9096`), `_updateUI` (`:7340`, `:9097`) and `_loadFFmpeg`
  (`:7107`).

Why it matters to a production: the five export formats a producer actually
needs off a breakdown — EDL, DOCX, CSV, TXT, AI prompts — are all in the dead
block. So is Reverse Mode, so is Character Studio, so is the credits display.
Anyone reading this file to plan work will price features that already exist and
cannot be opened, and will spend review time on code no user runs.

Change: delete `:335-763`, `:1055-1152`, `:2108-2413`, `:3251-3334`,
`:9255-9318` and the wizard functions, **after** first lifting `esc()`/`jsq()`
out (they live at `:2372-2378`, inside the block being deleted, and 167 call
sites across the live code depend on them). Keep `SBVideo._startPoll`,
`_updateUI`, `_loadFFmpeg`, `pickStatus`, `pickVideoUrl`. If any of the five
exporters is wanted, re-home it against the Generation Hub project model rather
than `rD` — but that is a rebuild, not a revival.

### HIGH — Generated images and videos are blocked by the app's own CSP

`netlify/functions/gate.js:142` serves `/app.html` with:

```
img-src   'self' data: blob: http://127.0.0.1:* http://localhost:*
media-src 'self' blob: data: http://127.0.0.1:* http://localhost:*
connect-src 'self' blob: data: https://api.themoviedb.org https://query.wikidata.org http://127.0.0.1:* http://localhost:*
```

`gate.js:150-154` widens only `script-src` (gstatic) and `connect-src` (Google
identity) for this path. `img-src` and `media-src` are untouched.

But `generate-video.js` returns raw provider CDN URLs: `outputs[0]` from
WaveSpeed (`:136-137`, `:812`) and Grok's own host from `extractGrokVideoUrl`
(`:243`). `app.html:1518` proves the client expects them —
`if(/vidgen\.xai/i.test(url))return true;`. Only Sora is proxied same-origin,
through `netlify/functions/serve-openai-video.js`.

So on the deployed gated app:

- `<video src="https://…wavespeed…">` at `app.html:6490`, `:2775`, `:2787`,
  `:3189` — blocked by `media-src`.
- `<img src="…">` for character stills at `:3289`, `:3325`, `:8912` — blocked by
  `img-src`.
- `fetch(clipUrl)` at `:2793` (`_zipAll`), `:3040` (`_fetchToU8`), `:6996`
  (`mhEditExportInline`), `:7147` (`mhStitchRun`) — blocked by `connect-src`.

The corroboration is in the code: `:6490-6491` already ships an `onerror`
handler that swaps in "Inline preview blocked — open video in new tab". Someone
hit exactly this and papered over the symptom. The "open in new tab" link works
because top-level navigation is not covered by `media-src`; the inline preview
never will be.

Consequence for a real production: every clip preview is a broken box, and
`mhEditExportInline()` — the one live editor export — cannot download a single
clip into FFmpeg's filesystem. Export MP4 is dead on the cloud path.

Change: add the two provider hosts to `img-src`/`media-src`/`connect-src` in
`gate.js:142` scoped to `/app(\.html)?` the same way gstatic already is, or
(better, and it keeps the CSP tight) add a signed same-origin media proxy
alongside `serve-openai-video.js` and rewrite provider URLs in
`generate-video.js` before returning them. The second option also fixes the
`referrerpolicy` and link-expiry problems that come free with provider CDNs.

### HIGH — Owner sessions cannot survive a refresh; three restore paths are dead

`js/auth.js:39-41` runs `rehydrateOwnerToken()` at load, which is just
`clearOwnerToken()` (`:54-63`) — it removes `SB_OWNER_TOKEN`, `SB_OWNER_NAME`
and `SB_OWNER_EXPIRES` from localStorage on **every page load**. That is
deliberate (the session is the HttpOnly `cin_owner` cookie) and the comment at
`:26-38` explains it well.

But `app.html` was not updated to match:

- `customerLogin()` at `:1755-1764` still writes `SB_OWNER_NAME` and
  `SB_OWNER_EXPIRES` and sets `window.SB_OWNER_TOKEN = null`. Those two writes
  are erased by `js/auth.js` on the next load, before any app code runs.
- `restoreOwnerSessionFromStorage()` (`:1650-1697`) and
  `restoreEarlyOwnerSession()` (`:1339-1363`) both require a 4-part token
  (`:1657`, `:1345`). No token is ever stored any more, so both always return
  `false`.
- `sbBootstrapSession()` (`:2039-2043`) therefore never restores anything.

So a signed-in owner who presses F5 is dropped back to the login screen while
the 12-hour `cin_owner` cookie is still perfectly valid — and the login screen
hint at `:281` promises "Sessions last ~12 hours".

The fix already exists and nothing uses it: `verify-owner.js:44-46` sets a
readable `cin_who` cookie beside the HttpOnly session, and `js/auth.js:129`
exposes `window.cinOwnerName()` to read it (validated against `/^[a-z]{2}\d{3}$/`
at `:50`). Repo-wide grep: **zero call sites.**

Change: rewrite `restoreOwnerSessionFromStorage()` to synthesize `curUser` from
`window.cinOwnerName()` + `OWNER_META`, and delete
`restoreEarlyOwnerSession()`. Stronger version: `app.html` is only ever served
by `gate.js` after the cookie has already been verified, so a successful page
load *is* proof of a valid owner session — the client does not need to
re-derive it at all.

### HIGH — `SBVideo._onBatch()` throws on its first line (and the dialog it would show is fiction)

`app.html:2421` initialises `V = {model:"local-comfy", …}`. The only writer is
the `onchange` on `#vg-model` at `:2318` — an `onchange` does not fire for the
`selected` attribute, so `V.model` stays `"local-comfy"` until the user
manually changes the dropdown. Then `:2547`:

```js
const mp=MP[V.model];const cost=shots.length*mp.c;
```

`MP` (`:2420`) has six keys and `local-comfy` is not one of them → `mp` is
`undefined` → `TypeError` on `mp.c`. "GENERATE ALL SHOTS" crashes for any user
who did not first touch the model select.

Compounding it, the confirm text at `:2548` reads *"Credits deducted upfront.
Failed shots refunded."* There is no credit system. `V.refreshBalance()`
(`:2451`) POSTs `{action:"balance"}`, and `generate-video.js` handles
`providers`, `set_openai_key`, `set_aivideoapi_key`, `generate_picture`,
`upload_image`, `submit`, `status`, `cancel`, `result` — and falls through to
`{error:'Unknown action or missing params'}` at `:1156`. Nothing anywhere
deducts or refunds. The dialog quotes a balance that is always `0`.

Both are currently masked by the dead-view finding (`_onBatch` is unreachable).
Fix or delete — but do not leave a cost dialog that promises accounting the
backend does not do.

Rank HIGH because if the forward view is ever revived, this is the first button
a user presses.

### HIGH — Two batch engines with a ~100× throughput difference, and neither retries

- `SBVideo._onBatch()` (`:2544-2622`): three concurrent workers
  (`Promise.all([worker(),worker(),worker()])` at `:2611`), fire-and-forget
  submit, poll separately.
- `mhDoFinalGenerate()` (`:7576-7667`, the live one, wired at `:937`): a plain
  `for` loop at `:7601` that `await`s `generateVideoForShot(key, …,
  {waitForDone:true})` — strictly one shot at a time, start to finish.

`sbMaxPollMs()` (`:1555-1567`) allows Kling 3,600,000 ms. A 200-shot feature
generated serially on Kling is 100+ hours of a tab that must stay open. The
concurrent engine would do it in a third of the wall time — and it is the dead
one.

Neither engine retries a failed submit. `generateVideoForShot` (`:9069-9126`)
does one `fetch`; any 429 or 5xx from WaveSpeed throws straight to the catch at
`:9127`, and in batch mode `mhDoFinalGenerate:7630-7636` records the message and
moves to the next shot. On a provider rate-limit the whole batch is lost one
shot at a time with no backoff.

Change: give `mhDoFinalGenerate` a bounded worker pool (3 is the number
`_onBatch:2610` already justifies against WaveSpeed and Netlify concurrency
caps), and wrap the submit in retry-with-jitter on 429/5xx/network — 3 attempts,
2s/6s/18s. Both are contained changes inside two functions.

### HIGH — Polling burns two function invocations per tick, forever

`mhPollVideoUntilDone()` (`:7424-7482`) fetches `status` at `:7443` and then
**unconditionally** fetches `result` at `:7462` in the same iteration. The only
early return is when status already came back `COMPLETED` *with* a URL
(`:7451`). Every non-terminal tick costs two Netlify invocations plus two
provider round-trips.

`sbPollIntervalMs()` (`:1568-1571`) caps at 10s for Kling, 5s otherwise — it
never backs off further. One Kling shot at its 60-minute ceiling is ~360 ticks
= **~720 function invocations for a single clip**. A 200-shot feature is on the
order of 144,000 invocations, all of them billable, most of them answering
"still working".

Meanwhile the other live poller, `SBVideo._startPoll` (`:2635-2756`), hardcodes
`setInterval(…, 5000)` at `:2754` and ignores `sbPollIntervalMs()` entirely, and
issues **one** request per tick. Two pollers, two intervals, two request counts,
same job.

Change: skip the `result` call whenever the `status` call returned a
non-terminal state; back off 5s → 10s → 20s → 30s capped; and make
`_startPoll` call `sbPollIntervalMs()` like the function was written for.

### HIGH — Reference photos never reach the model, so "character lock" is a no-op in the cloud

`generate-video.js:849-861` handles `upload_image` by echoing the data URL
straight back — the note in the response says so: `'demo-echo (use real bucket
in prod for permanent https refs to WaveSpeed)'`.

`app.html:8939` then stores that data URL as the character's photo. And
`app.html:9053` builds the payload as:

```js
character_image_url: (charRefUrl && charRefUrl.startsWith('https://')) ? charRefUrl : null,
```

A `data:` URL fails that test, so it is dropped. The user uploaded a reference
photo, the UI at `:2344` says "🔒 Reference locked", `:2348` says "locks this
character into video gen" — and the request goes out with no reference at all.
Character consistency across shots is the single hardest thing about AI film
generation and this is the feature that is supposed to solve it.

Secondary damage: those multi-megabyte data URLs land in the project object.
`app.html:2267` caps an upload at 4 MB, which is ~5.3 MB once base64-encoded.
`projectSave()` (`:3357`) `JSON.stringify`s the whole project into localStorage
and its only failure handling is `alert('Could not save project (storage
full?)')`. Two reference photos will exceed a 5-10 MB localStorage quota and
wedge *all* persistence for that project — script, shots, prompts, clip URLs.

Change: make `upload_image` write to a real bucket and return an `https://` URL
(the note already says this is the plan), and until then reject the upload in
the UI rather than accepting it and silently discarding it. Separately,
reference photos should never enter the object that `projectSave()` serialises.

### HIGH — The iframe MP4 export hands off to a tab that never picks it up

`mhEditExport()` (`:6918`) detects an iframe and calls `mhEditExportPopOut()`
(`:6929`), which stashes the timeline under `sb_autoexport_<ts>_<rand>` and
opens `/app.html?autoexport=<key>#media`.

The receiver is `mhCheckAutoExport()` (`:4126`). Its **only** call site is
`app.html:4123`, inside `mhEnter()` — the function with zero callers. So the new
tab loads, ignores the query parameter, and shows an empty Generation Hub, while
the original tab displays "🪟 Export tab opened … the export runs in a top-level
tab where it works reliably" (`:6967-6971`).

Since `/workflow/` loads `/app.html#media?embed=1` in a pane (`:1976-1990`),
this is the *normal* path for anyone exporting from the workflow. The orphaned
`sb_autoexport_*` entry is also never cleaned up (`:4157` is the only
`removeItem` and it is unreachable), so each attempt leaks a copy of the
timeline into localStorage permanently.

Change: call `mhCheckAutoExport()` from `mhEnsureUnifiedStudio()` (`:7776`),
which is the live entry point, and move the `localStorage.removeItem(key)` to
immediately after the payload parse so a malformed payload cannot leak either.

### MED — Three FFmpeg stitchers in one file, all three assuming every clip is 6 seconds

- `V._stitchClips()` (`:3048-3130`) — `:3093-3097` runs a probe pass
  (`-i file -f null -`), throws the output away, and then does
  `durations.push(6)`. Every `xfade` offset at `:3106-3112` is computed from
  that literal.
- `mhEditExportInline()` (`:6976-7100`) — `:7010` and `:7018` compute trim
  length as `6-(c.trimIn||0)-c.trimOut`; `:7042` and `:7048` build the xfade
  offset chain from `6`.
- `mhStitchRun()` (`:7114-7173`) — concat-only, but writes its own list file and
  its own FS cleanup.

`getVideoSettings()` (`js/model-config.js:337-343`) resolves duration from the
model's own table — Seedance defaults to 5s, Veo to 8s. Any clip that is not
exactly 6s puts every subsequent crossfade offset out by the difference, which
compounds across the reel: black frames, clipped tails, audio drift. On a
20-shot scene with 5s clips the final crossfade lands 20 seconds past the end of
the timeline.

The duration is *known* — `mhUpsertGenJob` could carry it from `vs.duration` at
submit time (`:9048`), and `editor/lib-cut.js` already models clip in/out
properly. Change: store the real duration on the job at submit, thread it into
one stitcher, and delete the other two. Two of the three are already unreachable
(`_stitchClips` via the dead gallery; `mhStitchRun` writes into `#mhStitchArea`
at `:1141`, inside the hidden `#mhStep4`), so this is mostly deletion.

### MED — Twelve screenplay-parsing helpers duplicated against `timeline/parser.js`, ten already diverged

`timeline/parser.js` is loaded at `app.html:47`, and `parse()` (`:2176-2185`)
delegates to `window.SBParser.parse` when present — so app.html's own copies are
the fallback. I diffed each pair (whitespace-normalised, full function bodies):

| helper | app.html | parser.js | state |
|---|---|---|---|
| `isSH` | `:2134` | `:3` | **DIVERGED** (1009 B vs 629 B) |
| `isCC` | `:2167` | `:13` | **DIVERGED** |
| `isPar` | `:2168` | `:20` | **DIVERGED** |
| `isTr` | `:2169` | `:21` | **DIVERGED** — app.html matches `FADE TO`/`MATCH CUT`, parser.js does not |
| `isSceneNumberOnly` | `:2162` | `:22` | **DIVERGED** |
| `isTitlePageLine` | `:2156` | `:23` | **DIVERGED** |
| `exCN` | `:2170` | `:30` | **DIVERGED** — parser.js upper-cases, app.html does not |
| `resCN` | `:2171` | `:31` | identical |
| `spS` | `:2172` | `:32` | **DIVERGED** |
| `iT` | `:2173` | `:37` | **DIVERGED** |
| `iCm` | `:2174` | `:48` | **DIVERGED** |
| `cleanCharName` | `:3824` | `:178` | identical (byte-for-byte) |

Ten of twelve have already drifted. This is not a theoretical risk — it has
happened.

And it is not confined to the dead fallback. `app.html`'s own `isSH()` is used
in three live places: `:3870` (`extractCharacterNames`), `:5769` (the line
classifier), and `:2229` (`reverseProcess`). So the app decides "is this a scene
heading?" one way when parsing forward through `SBParser` and a different way
when classifying lines for the character extractor — in the same page, on the
same script. `isSH` is the biggest divergence in the table (380 bytes of extra
patterns in app.html).

Change: delete `app.html:2134-2223` and `:3824-3827`, make `timeline/parser.js`
a hard dependency (it already loads unconditionally), and port app.html's extra
`isSH` patterns into `parser.js:3` where `scripts/test_parser_chars.mjs` will
cover them.

### MED — Four escapers and a sixth `csvCell`

`app.html` defines `esc()` (`:2372`), `ea()` (`:2373`), `ex()` (`:2379`), and a
second `esc()` inside the dashboard IIFE (`:9278`) with a different
implementation. `ea()` has **zero callers**. `ex()` is used only by `xDocx()`
(dead). The `:9278` copy shadows the global inside that IIFE.

CSV escaping: `app.html:2396` inlines `ce()` with the `/^[=+\-@\t\r]/` guard,
and the identical function exists as `csvCell()` in `finance/lib-money.js:114`,
`production/lib-prod.js:91`, `producer/budget-sheet.js:175`,
`boards/lib-shots.js:104`, and `tools/tools-core.js:84` — **six copies**. The
brief calls this rule out explicitly; six independently maintained copies is how
one of them silently loses the `\t` or the `\r`.

EDL: `app.html:2380` `ftc()` and `:2385` `xEDL()` reimplement
`editor/lib-cut.js:131` `tc()` and `:142` `edl()`. Two CMX-3600 writers.

Change: one `js/lib-esc.js` exporting `esc/jsq/ex/csvCell` on `window.CinEsc`,
loaded before everything, with `scripts/test_esc.mjs`. Delete `ea()`. Point the
five libs at it too — the brief's CSV rule then has one place to be right.

### MED — 185 `<option>` elements per clip card, built as one string and `innerHTML`'d

`mhBgRenderClipCard()` (`:4886-4955`) emits, per shot: a shot-type select (10),
an angle select (7), and eleven `CINE` selects. I parsed the `CINE` table at
`:2071` — those eleven groups total **155** options. With the leading blank in
each select that is **185 `<option>` per clip card**, plus one option per scene
in the inherit-from dropdown at `:4909-4912`.

`mhRenderBackgrounds()` (`:4717-4819`) concatenates all of them into one `h`
string and assigns it at `:4817`. A 120-scene / 600-shot feature with "Expand
all scenes" is ~184,000 option elements in a single `innerHTML` write. The
comment at `:4706-4709` acknowledges this ("rendering every option element
upfront kills the first paint") and mitigates it with default-collapse — the
mitigation is real, the underlying cost is not addressed.

`:4818` then calls `projectSave(p)` — a full `JSON.stringify` of the project to
localStorage — on **every render**, including renders triggered by a single
dropdown change (`:5046`, `:5055`, `:5064`, `:5071`, `:5078`, `:5083`, `:5091`,
`:5231`, `:5249`, `:5279`, `:5299`, `:5308`).

More generally `projectLoad()` (`:3356`) does `getItem` + `JSON.parse` +
`ensureProjectAssets` with **no caching**, and there are **102 call sites**
against **58** `projectSave` call sites. A single tab switch parses the whole
project object dozens of times.

`mhBgRefreshClipCard()` (`:4876-4884`) already implements the right pattern —
replace one card in place. Change: use it everywhere, render `<option>` sets
lazily on `focus`, and add a short-lived in-memory project cache invalidated by
`projectSave`. (Caveat, and it is a big one: `#mhBgList` lives at `:1080` inside
the hidden `#mhStep3`, so this whole renderer is currently unreachable — fix it
only if the Settings tab is revived, otherwise delete it.)

### MED — The live tabs are not tabs; everything renders at once, twice

`mhEnsureUnifiedStudio()` (`:7776-7784`) sets `display:block` on **every**
`.mh-tab-pane` at `:7780`, and `mhSwitchTab()` (`:7852-7857`) only
`scrollIntoView`s. So Script, Characters, Generate and Edit are all in the DOM
simultaneously.

`mhRunTabInit('generate')` calls `buildPerShotDetailBoxes()` at `:7837` and
**again** in a `setTimeout` at `:7839`. `buildPerShotDetailBoxes()` (`:8724`)
renders every shot in the project with no windowing and no collapse-by-scene —
each card carries a `<textarea>`, a character row, three location selects
(~28 options) and eight jot selects (~49 options), so ~77 options and a textarea
per shot. Every click on the Generate tab button rebuilds all of them twice.

Change: make `mhSwitchTab` actually toggle pane display; drop the duplicate
`buildPerShotDetailBoxes()` at `:7839`; render shot cards for the expanded scene
only, matching what `_bgCollapsedScenes` (`:4710`) already does elsewhere.

### MED — `projKey()` can resolve to `anon` before `curUser` exists

`projKey()` (`:3355`) is `'sb_project_' + (curUser?.uid || curUser?.name ||
'anon')`. `restoreEarlyOwnerSession()` registers on `DOMContentLoaded` at
`:1443` and `sbBootstrapSession()` at `:9321`, so the early handler runs first —
and `earlyEnterApp()` (`:1320-1337`) calls `mhEnsureUnifiedStudio()` at `:1335`
while the big script's `curUser` (`:1485`) is still `null`. Any `projectSave()`
in that window writes to `sb_project_anon`, and the owner's real project silently
appears empty.

This is latent today only because the early restore path is itself dead (see the
owner-session finding). Fixing the session restore will expose it.

Change: make `projKey()` throw or return `null` when `curUser` is unset, and
have `projectLoad`/`projectSave` no-op on `null` rather than inventing `anon`.
Note this is also the one persistence key in the file that is not `SB_*` — as
are `sb_pending_*` (`:7526`) and `sb_autoexport_*` (`:6938`). The brief forbids
renaming them now; a comment naming them as the exceptions would help.

### MED — Ops instructions and a config key rendered into end-user UI

`customerLogin()` at `:1806-1814` builds a login error containing the literal
Firebase Web API key and step-by-step Netlify instructions ("set
`FIREBASE_API_KEY` to exactly that value … Clear cache and deploy"). A Firebase
Web API key is a public identifier, not a secret, so this is not a credential
leak — but it is internal deploy runbook text shown to whoever hit a wrong
password. `:281` similarly tells the login screen to paste `OWNER_PW_*` "from
Netlify". Change: log the detail to console, show the user "Sign-in is
misconfigured — contact the studio."

### LOW — Two duplicated `customerLogin` implementations

The early bootstrap defines `window.customerLogin` at `:1365-1440`; the main
script declares `function customerLogin()` at `:1714-1826`. A top-level function
declaration wins, so the early copy is overwritten and only exists to serve a
click that lands before the big script parses. They are ~90 lines of the same
verify-owner flow, already divergent (the early copy has no Firebase fallback).
Change: keep `safeSignIn()` (`:289`) as the "not ready yet" guard, which it
already does well, and delete the early duplicate.

### LOW — Head scripts block first paint

`:30-48` loads JSZip, four Firebase compat bundles (~500 KB uncompressed), five
`js/*.js` files, `timeline/parser.js` and a Google Fonts stylesheet — none with
`defer` or `async`. Then 411 KB of inline JS parses before anything renders. On
the four Firebase bundles specifically, `defer` is safe: the only synchronous
consumer is the IIFE at `:1166`, which is itself below them.

### LOW — Cosmetic

- `:2419` `BATCH="/.netlify/functions/batch-generate"` is unused; the endpoint
  (`netlify/functions/batch-generate.js`) is a 44-line stub that returns
  `"Polling not yet implemented in MVP."` and is not in the deploy set.
- `:7312` `headers: await (typeof h.then === 'function' ? h : Promise.resolve(h))`
  — `h` was already awaited at `:7309`.
- `mhRenderCharacters()`/`mhCharRenderCard()` (`:5464`, `:5535`) are a second,
  complete character editor; the live one is `mhRebuildCharAgentBoxes()`
  (`:7859`) with its own template. Two full implementations of the same screen.

---

## What is missing entirely — the supporting software

### 1. Any behavioural test over `app.html`. Value: **critical**

Exactly three files in `scripts/` mention `app.html`: `scan_html_sinks.mjs`,
`test_html_sinks.mjs`, `test_sw_cache.mjs`. All three are textual — one greps
for interpolations, one checks the service worker's cache list. **Not one line
of app.html's 411 KB of logic is executed by any of the 44 suites.**

Every other module in this repo has `lib-*.js` + `scripts/test_*.mjs` (30 libs,
44 suites). The largest, most business-critical file in the product has none.
That is why ten of twelve parser helpers could diverge unnoticed, why
`MP[V.model]` can be `undefined`, and why the autoexport receiver could lose its
only caller without anything going red.

This is the reason to decompose, and it is also the deliverable: extraction
without a matching `scripts/test_*.mjs` per lib buys nothing.

### 2. `js/lib-esc.js` — the escaping primitives. Value: **high**, and it must go first

`esc()` and `jsq()` currently sit at `:2372-2378`, inside the block that the
dead-view cleanup deletes, with 167 live call sites depending on them. Nothing
else can be safely removed until they are lifted out.

Contents: `esc`, `jsq`, `ex`, `csvCell`. ~20 lines, zero dependencies,
node-testable. `scripts/test_esc.mjs` should assert the `jsq`-then-`esc`
ordering (`:2374-2377`'s reasoning as an executable test), `esc(0) === ''` (the
premise the sink allowlist rests on), and the `/^[=+\-@\t\r]/` CSV guard. Point
`finance/lib-money.js`, `production/lib-prod.js`, `producer/budget-sheet.js`,
`boards/lib-shots.js` and `tools/tools-core.js` at the same `csvCell` and delete
five copies.

### 3. `js/lib-shotkey.js` — shot identity. Value: **high**

`key = ${si}-${shi}` is the spine of the Generation Hub: it is the DOM id
prefix, the `_shotUI` map key, the `_mhGenCancel` key, and the argument to a
dozen `onclick` strings. It is also the justification for 21 of the 90 reviewed
HTML sinks.

Contents: `encodeKey(si,shi)`, `decodeKey(key)` (currently
`key.split('-').map(Number)` repeated at `:7322`, `:7363`, `:7489`, `:8890`,
`:9020`, `:9499` and more), `shotLabel(si,shi)`, `mhOrderedShotKeys(p)`
(`:7205`). ~40 lines, pure. `scripts/test_shotkey.mjs` pins the format to
digits-and-hyphen, which turns the allowlist's `key`/`si` entries from a prose
promise into a guarded invariant.

### 4. `js/lib-genjob.js` — provider response handling and job state. Value: **high**

The layer with the most untested branching in the file: `pickStatus`
(`:2430`), `pickVideoUrl` (`:2431-2448`), `mhNormalizeVideoStatus` (`:7410`),
`mhAcceptVideoUrl` (`:7417`), `sbIsVideoMediaUrl` (`:1515`),
`sbIsPlaceholderUrl` (`:1502`), `sbInferProvider` (`:1508`), `sbMaxPollMs`
(`:1555`), `sbPollIntervalMs` (`:1568`), `sbPollPayload`/`sbResultPayload`
(`:1522`/`:1530`), `mhUpsertGenJob` (`:6382`), `mhGetShotJob` (`:6472`),
`mhIsJobGenerating` (`:6400`), `mhIsRealVideoUrl` (`:6393`). All pure. ~180
lines.

`scripts/test_genjob.mjs` can then fix the WaveSpeed / Grok / Sora response
shapes as fixtures and cover the poll-interval and timeout policy that today has
two contradictory implementations. This is also the natural home for the
backoff fix and the "don't call `result` when `status` says pending" fix.

### 5. `js/lib-prompt.js` — prompt construction. Value: **high**

`buildShotVideoPrompt` (`:7176`), `stripJots` (`:7201`), `mhNormalizeShotUI`
(`:8708`), `getBestCharPrompt` (`:3360`), the seed-prompt block at
`:8767-8789`, and `V.buildPrompt` (`:2453`). Pure string assembly, ~150 lines.

This is the product. The exact text sent to the model decides whether a
character's face holds across 200 shots, and there is currently no way to assert
that a prompt still contains its master block, its character reference and its
location plate after an edit. A snapshot test here is worth more than any other
single test in this plan.

### 6. `js/lib-project.js` — the project model. Value: **medium-high**

`ensureProjectAssets` (`:3445`), `mhResolveCharPhotoStore` (`:3461`),
`mhNormalizeAssetUrl` (`:3481`), `mhUrlsMatch` (`:3490`),
`mhCollectActiveCharPhotoUrls` (`:3498`), `mhCharHasActivePhotos` (`:3511`),
`mhBuildShotCharsFromProject` (`:3517`), `mhSyncShotUICharsWithProject`
(`:3538`), `mhSyncShotUIPromptsWithProject` (`:3564`),
`mhPurgePhotoUrlFromProject` (`:3580`), `mhBuildScenesFromScriptText` (`:8556`),
`mhSyncCharacterBibleFromParse` (`:8632`). All operate on a plain object. ~300
lines.

`mhPurgePhotoUrlFromProject` alone touches seven separate stores
(`characterBible`, `characterImages`, `scenes[].shots[]`, `_shotUI`,
`_mhGenState.jobs`, `rD.characterImages`, `csLocked`) — removing one photo and
leaving a dangling reference in any one of them is exactly the kind of bug a
node test catches in a second and a human never finds.

Also the right place to add the in-memory `projectLoad` cache (102 call sites,
no caching today).

### 7. `js/lib-shotcard.js` — the shot-card renderer. Value: **medium**

The assignment names this one specifically. Today `buildPerShotDetailBoxes`
(`:8724-8858`) interleaves reading the project, mutating `_shotUI`, seeding
prompts, building ~130 lines of template literal, and writing `innerHTML`.

Split it: `renderShotCard(model) → html string` where `model` is a plain object
(`{key, shotLabel, action, ui, locOptions, cineOptions, jobState}`), pure and
node-testable against a golden-HTML fixture; and leave the `area.innerHTML =`
plus the `projectLoad()` read in `app.html`. The mutation currently hidden in
the middle (`ui.prompt = …` at `:8781`) moves into `lib-prompt.js`.

Once the render is pure, windowing (render only the expanded scene) and lazy
`<option>` population become one-line changes rather than surgery, and the
`shot-card` HTML gets its first regression test.

### 8. A module loader — and the header change it depends on. Value: **medium**

The constraint is `<script src>` plus inline IIFE, no build step, no bundler.
The right shape is `js/cin-loader.js`: a small manifest
(`[{name, src, deps}]`), a topological sort, and sequential `<script>` injection
with a shared `window.Cin` namespace, so a module declares its dependencies
instead of relying on source order in one 9,330-line file.

**The trap, and it is the reason to sequence this last:** `gate.js:130` sets
`Cache-Control: private, no-store` on every response, and `_headers:15-19` sets
`no-cache, no-store, must-revalidate` on `/*.js`. Nothing is cached. `app.html`
already pays 6 extra gate round-trips for `js/config.js`, `js/auth.js`,
`js/model-config.js`, `js/mastery-resolver.js`, `js/safe-url.js` and
`timeline/parser.js`. Splitting the inline 411 KB into another 7 files turns one
Lambda invocation into 13, with the same total bytes and zero caching — cold
load gets **worse**.

So the loader work must ship with a `gate.js` change: when a request for
`/js/*.js` carries a content-hash query (`?h=<sha256-prefix>`, supplied by the
manifest), respond `Cache-Control: private, max-age=31536000, immutable`. The
content hash makes that safe — a changed file is a changed URL. This is a ~15
line change in `gate.js:128-143` and it is the precondition for decomposition
paying off rather than costing.

### Sequence

```
0.  Lift esc/jsq out of :2372 into js/lib-esc.js + test_esc.mjs        (nothing else can move first)
1.  Delete the four CSS-hidden views, the mhStep2-5 wizard, and the
    dead SBVideo members                                              (~2,270 lines, ~130 KB, no user-visible change)
2.  gate.js: immutable caching for content-hashed /js/*.js            (precondition for 6)
3.  lib-shotkey.js + lib-genjob.js + tests                            (pure, no DOM, unblocks the poll/backoff fixes)
4.  lib-prompt.js + snapshot tests                                    (the product surface)
5.  lib-project.js + tests, add the projectLoad cache
6.  js/cin-loader.js + manifest; move 3-5 out of the inline block
7.  lib-shotcard.js; then windowing + lazy options on top of it
8.  Delete app.html:2134-2223 and :3824; parser.js becomes a hard dep
```

Steps 0-1 are pure subtraction and make every later step smaller. Step 2 is
fifteen lines in `gate.js` without which steps 3-7 are a net regression on load
time. Steps 3-5 are the ones that give this file its first real tests. Nothing
before step 6 changes how a single byte reaches the browser, so each can ship
and be verified independently against `node scripts/run_all_tests.mjs`.

---

## Evidence

Files read in full or in the ranges noted, with the claims each supports.

**`/home/user/shotb/app.html`** (9,330 lines) — read in sections:
- `:1-60`, `:228-330` — head, SRI-pinned Firebase, login markup, `safeSignIn`.
- `:632` — `#dashView, #fwdView, #revView, #charView { display: none !important; }`.
- `:764`, `:807-1046` — the live `#mediaView` and its four `.mh-tab-pane`s.
- `:1055-1152` — the hidden `#mhStep2..5` legacy panes and their render targets.
- `:1154-1448` — Firebase/auth IIFE, early bootstrap `customerLogin`, `restoreEarlyOwnerSession`.
- `:1450-1863` — `curUser`, `sbVideoProxy`/`sbMaxPollMs`/`sbPollIntervalMs`, `restoreOwnerSessionFromStorage`, `customerLogin`, `customerRegister`.
- `:1864-2123` — `loadUser`, `enterApp`, `showMode`/`showDash`, `doLogout`, tier checks, `CINE` table, `sbGenerateCharacterPicture`, file upload.
- `:2124-2413` — parser helpers, Reverse Mode, `render()`, `esc/ea/jsq/ex/ftc`, all five exporters.
- `:2415-3249` — the `SBVideo` IIFE: `_genShot`, `_onBatch`, `_startPoll`, `_updateUI`, `_loadFFmpeg`, `_stitchClips`, `_runStitch`.
- `:3251-3371` — Character Studio, `projKey`/`projectLoad`/`projectSave`.
- `:3372-3671` — studio reset, `ensureProjectAssets`, the photo-store helpers, `mhPurgePhotoUrlFromProject`.
- `:4120-4200` — `mhCheckAutoExport`, `mhUpdateHeader`, `mhGoto`.
- `:4700-5032` — `mhRenderBackgrounds` and the `mhBg*` renderers.
- `:6350-6549` — gen-job state, `mhClipMediaHtml`, `mhRenderShotClipPreview`.
- `:6907-7186` — MP4 export (iframe pop-out and inline), `mhStitchRun`, `buildShotVideoPrompt`.
- `:7280-7679` — cancellation, `mhPollVideoUntilDone`, `mhPersistPendingJobs`/`mhResumePendingPolls`, `mhDoFinalGenerate`.
- `:7766-7885` — `mhEnsureUnifiedStudio`, `mhRunTabInit`, `mhSwitchTab`, `mhRebuildCharAgentBoxes`.
- `:8556-8858` — `mhBuildScenesFromScriptText`, `mhSyncScenesFromScript`, `buildPerShotDetailBoxes`.
- `:8890-9251` — `renderShotChars`, `addCharToShot`, `appendJot`, `generateVideoForShot`, `generateLocalClipForShot`.
- `:9252-9330` — dashboard IIFE, `sbBootstrapSession` registration.

**Other files read:**
- `/home/user/shotb/js/auth.js` (139 lines, full) — `:39-41` rehydrate-is-a-purge, `:54-63` `clearOwnerToken`, `:72` no-op `touchOwnerToken`, `:129` unused `cinOwnerName`.
- `/home/user/shotb/js/model-config.js:300-390` — `getVideoSettings`, `mhInitVideoSettings`, per-model duration/aspect/resolution validation.
- `/home/user/shotb/netlify/functions/gate.js` (169 lines, full) — `:128-143` response headers and CSP, `:150-154` the `/app.html` widening, `:130` `private, no-store`.
- `/home/user/shotb/netlify/functions/verify-owner.js:32-46,281-282` — `cin_owner` (HttpOnly) and `cin_who` (readable) cookies.
- `/home/user/shotb/netlify/functions/generate-video.js` — `:651` action destructure, `:661-1156` the nine handled actions and the unknown-action fallthrough, `:849-861` `upload_image` demo-echo, `:136-141,243` URL extraction.
- `/home/user/shotb/netlify/functions/batch-generate.js` (44 lines, full) — the unreferenced stub.
- `/home/user/shotb/netlify/functions/serve-openai-video.js:1-40` — the one same-origin media proxy (Sora only).
- `/home/user/shotb/scripts/scan_html_sinks.mjs` (284 lines, full) — `:185` `HAS_MARKUP` against `before`, `:195` the concat regex, `:219-239` counted entries, `:264-269` the `--check` comparison.
- `/home/user/shotb/scripts/html_sinks_allow.json` — all 34 `app.html::` entries.
- `/home/user/shotb/scripts/test_helpers_defined.mjs:1-30` — why brace-depth matters for a global `esc`.
- `/home/user/shotb/timeline/parser.js:1-60,178-200` + full-body diffs of 12 helpers.
- `/home/user/shotb/editor/lib-cut.js:130-160` — `tc()` and `edl()`.
- `/home/user/shotb/boards/lib-shots.js:104`, `/home/user/shotb/finance/lib-money.js:114`, `/home/user/shotb/production/lib-prod.js:91`, `/home/user/shotb/producer/budget-sheet.js:175`, `/home/user/shotb/tools/tools-core.js:84` — the `csvCell` copies.
- `/home/user/shotb/_headers:1-45`, `/home/user/shotb/netlify.toml` (full) — CSP, cache policy, publish guard.

**Measurements taken (commands run, not estimated):**
- Page weight: 505,744 B total / 411,677 B inline JS in 16 blocks / 43,769 B inline CSS in 2 blocks / 139,418 B gzipped.
- `CINE` option counts parsed from the literal at `:2071`: 155 options across 11 groups → 185 `<option>` per clip card including shot/angle and blanks.
- `projectLoad()` call sites: 102. `projectSave(` call sites: 58.
- `'+` concatenation points in app.html: 648. Trailing-interpolation sites the concat regex cannot see: 6. Adjacent `}${` interpolations: 1.
- `esc(` calls: 167. `CinUrl.safe(` calls: 27.
- `node scripts/scan_html_sinks.mjs --only=app.html` → 172 interpolations scanned, 0 unreviewed.
- `node scripts/run_all_tests.mjs` → 44/44 suites passed.
- Whole-repo grep for `mhEnter`, `showMode(`, `SBVideo._onBatch`, `csGenerate`, `cinOwnerName` outside `app.html`/`js/auth.js`: no matches.
- Function-boundary line counts for the 14 named legacy-wizard functions: 856 lines.
- Byte/line spans of the six unreachable regions: 128,861 B / 1,816 lines, before adding the wizard functions.

**Not verified.** I did not load the deployed site, so the CSP finding is
derived from `gate.js:142` plus the provider URLs `generate-video.js` returns
plus the `onerror` fallback at `app.html:6490`; it is a strong inference, not an
observation. I did not exercise a live generation against WaveSpeed or XAI, so
the character-reference finding rests on reading `:9053` against
`generate-video.js:849-861` rather than on a captured request.
