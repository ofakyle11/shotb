# Team A Dev 05 — `tools/` (Register engine, sun, script, money, media)

Slice: `tools/tools-core.js`, `lib-sun.js`, `lib-script.js`, `lib-money.js`,
`lib-media.js`, `sched-weather.js`, `tools-registers.js`, `tools-money-ui.js`,
`tools-script-ui.js`, `tools-media-ui.js`, `index.html`.

Baseline: `node scripts/test_tools.mjs` passes (all checks green) before and
after this audit. Nothing here was edited. Every claim below was either read at
the cited line or reproduced by running the library in node.

---

## What exists and works

- `tools/lib-sun.js:33-62` — the solar crossing maths is a faithful
  NOAA/Meeus implementation and it is **accurate**. Reproduced against NOAA for
  Los Angeles 2026-06-21: this code gives sunrise 05:43:16 PDT / sunset
  20:08:46 PDT against NOAA's 05:41:44 / 20:07:58 — 92 s and 48 s error, inside
  the ±2 min the header claims. Golden-hour altitudes (+6°, `lib-sun.js:57-58`)
  and civil twilight (−6°, `:56,:60`) match the standard definitions; the
  −0.833° sunrise altitude correctly folds in refraction plus solar radius.
- `tools/lib-sun.js:24-29` — the polar branches are right, not hand-waved.
  `x < -1` (sun never drops to the altitude) returns π and `x > 1` returns NaN.
  Verified: Tromsø 2026-06-21 yields 24.0 h daylight; Tromsø 2026-12-21 yields
  `null` sunrise and `null` sunset. Most naive ports get one of these backwards.
- `tools/lib-sun.js:71-74` — `daylightHours` is correct (÷360000 gives tenths
  of an hour, ÷10 gives hours); LA solstice returns 14.4 h.
- `tools/lib-media.js:128-132` — `xmlEsc`/`xmlUnesc` unescape `&amp;` **last**,
  which is the one ordering that round-trips. A path containing a literal
  `&lt;` survives escape→unescape unchanged. Verified. The comment explaining
  why is accurate and worth keeping.
- `tools/lib-media.js:70,82` — `fov()` and `ffEquiv` are correct thin-lens
  trigonometry. 25 mm on Super 35 → 53.0° HFOV, 85 mm full-frame → 23.9°.
- `tools/lib-money.js:47-111` — the timecard engine is the strongest logic file
  in the slice. The OT-on-worked / DT-and-golden-on-elapsed split
  (`:59-62`) is the correct reading of the 12-hour-day convention, meal
  deduction caps at two meals (`:52`), the escalating half-hour penalty ladder
  (`:85-88`) is capped at 12 steps so a runaway input cannot produce a fantasy
  number, and `hoursBetween` handles a past-midnight wrap (`:37`). It is
  parameterised through `TC_DEFAULTS` rather than hard-coded, which is the
  right call given every sideletter differs.
- `tools/lib-money.js:145-173` — `instrumentWaterfall` pays deferrals before
  equity, caps each payment at what is actually left (`:149,:155`), and reports
  `breakeven:false` on a shortfall rather than producing negative numbers.
- `tools/tools-core.js:82-96` — CSV formula-injection guard is present and
  correct, and it is applied to header labels as well as cells (`:89`), which
  three of the four other copies in the repo do not do.
- `tools/lib-script.js:14-37` — the LCS differ is genuinely correct (verified
  against a hand-built case) and `revColor` follows the real production colour
  order (`:46`).
- `tools/tools-media-ui.js:94-107` — hashing runs entirely client-side through
  WebCrypto with no upload, exactly as the copy promises.

---

## What exists but needs work

### HIGH

- **`_headers:4` + `tools/lib-sun.js:77-81` + `tools/sched-weather.js:120` —
  the weather feature is dead on the deployed site.** The CSP `connect-src` on
  `/*` lists `'self' blob: data: https://api.themoviedb.org
  https://query.wikidata.org http://127.0.0.1:* http://localhost:*`. There is
  no `https://api.open-meteo.com`, so the `fetch` at `sched-weather.js:120` is
  refused by the browser. `.catch(function () {})` at `:135` swallows it
  silently, so every shoot day renders "beyond forecast" and the Risk column
  stays `—` forever, with no error anywhere. The forecast *and* the shoot-risk
  score — the whole point of the Day-planner strip — never run in production.
  Fix: add `https://api.open-meteo.com` to `connect-src` in `_headers`, and
  replace the empty catch with a visible "forecast unavailable" note so the
  next outage is not silent too.

- **`tools/sched-weather.js:147-148` — sun times are rendered in the *viewer's*
  timezone, not the location's.** `S.fmtLocal(t.sunrise)` is called with no
  `tzOffsetMin`, so `lib-sun.js:66` falls back to
  `-new Date(ms).getTimezoneOffset()`. Verified: Budapest 2026-06-21 sunrise is
  04:47 CEST; from a UTC browser this table prints **02:47**, and from Los
  Angeles it prints 19:47 the previous evening. These numbers go straight onto
  a call sheet. The data needed to fix it is already being fetched and thrown
  away — `weatherUrl` (`lib-sun.js:80`) sends `&timezone=auto`, and Open-Meteo
  returns `utc_offset_seconds` in the response that `sched-weather.js:122-132`
  never reads. Fix: capture `w.utc_offset_seconds`, pass
  `utc_offset_seconds/60` to every `fmtLocal` call, and for the pre-fetch
  render fall back to `Math.round(lon/15)*60` rather than the browser offset.

- **`tools/lib-media.js:109` — `parseManifest` silently pairs one file's path
  with another file's hash, then reports the copy as bit-perfect.** The regex
  is `<hash>[\s\S]*?<path>…</path>[\s\S]*?<size>…</size>[\s\S]*?<sha256>…
  </sha256>[\s\S]*?</hash>` — the lazy `[\s\S]*?` runs are not anchored inside
  a single `<hash>` block, so if one block is missing a `<sha256>` (truncated
  write, interrupted download, a manifest from another tool) the match reaches
  forward into the *next* block. Reproduced with a two-entry manifest whose
  first block has no hash: the parser returns exactly one entry,
  `{path:'A.mov', size:111, sha256:'ffff'}` — A's path with B's hash — B has
  vanished, and `verifyAgainst` then returns `clean:true` for a card it never
  actually checked. For the one tool in the platform whose entire job is
  proving a copy is bit-perfect, a false "VERIFIED" is the worst possible
  failure. Fix: split on `/<hash>([\s\S]*?)<\/hash>/g` first and parse each
  block independently, and treat a block missing any of the three fields as a
  hard parse error rather than skipping it.

- **`tools/lib-media.js:24-25,30,34-46` — `DOMAIN_MIN`/`DOMAIN_MAX` are parsed,
  returned, and then completely ignored.** `sampleLut` clamps r/g/b to 0–1 and
  scales by `size-1` with no domain mapping at all; verified that
  `sampleLut(lut, 2, 0, 0)` on a `DOMAIN_MAX 4 4 4` LUT returns `[1,0,0]`
  instead of the correct interior sample. Every log-space input LUT — ARRI
  LogC, RED IPP2, S-Log3, the exact LUTs a DP hands a DIT — carries a domain
  wider than 0–1, and the Look tab will preview them wrong with no warning.
  Fix: normalise in `sampleLut` — `x = (r - domMin[0]) / (domMax[0] -
  domMin[0])` before the clamp — and either apply the same to
  `applyLutToPixels` or refuse a LUT whose domain is not 0–1 with a toast.

- **`tools/tools-core.js:18-20` — `save()` swallows `QuotaExceededError`, so
  every register silently stops persisting once localStorage fills.** The
  `catch (e) {}` means `add`, `update` and `remove` all appear to succeed: the
  table on screen shows the new row, the summary recounts, and nothing is
  written. On the next page load the row is gone. This is not theoretical in
  this slice — `tools-script-ui.js:232` stores up to 8 base64 stills in
  `SB_EPK_v1` and `tools-media-ui.js:470` stores base64 JPEGs in
  `SB_Moodboard_v1`, both of which reach the ~5 MB origin quota easily, and
  once the quota is hit *every other register on the origin* (Crew, Rights,
  Insurance, Timecards, Take Log) starts losing writes too. Fix: have `save()`
  return a boolean, and have `Register.persist()` surface a failure through
  `toast()` — plus move image blobs out of localStorage (see Missing, below).

- **`tools/tools-media-ui.js:99 + :88` — the offload verifier cannot verify
  actual camera media.** `await f.arrayBuffer()` loads each whole file into
  memory before hashing; a single ARRIRAW / R3D / ProRes clip is routinely
  5–40 GB and Chrome rejects an ArrayBuffer over ~2 GB, so the promise rejects.
  `hashFiles` is `async` with no `.catch` at the call site (`:110`), so the UI
  is left permanently showing "Hashing 0/N…". Separately, the input at `:88` is
  `multiple` but **not** `webkitdirectory`, while `:102` reads
  `f.webkitRelativePath` — a property only populated when `webkitdirectory` is
  set. So every manifest records bare filenames and cannot tell `A001/clip.mov`
  from `B001/clip.mov`, and a DIT cannot pick a card folder at all, only
  hand-select files. Fix: add `webkitdirectory` (with a files-vs-folder
  toggle), and stream the hash — see the incremental-SHA-256 item under
  Missing.

### MED

- **`tools/tools-core.js:115-118` — a `select` field on a fresh row shows a
  value that is not stored, and the mismatch corrupts the summaries.**
  `add()` (`:63-69`) creates `{}` when the schema has no `blank`, so `v` is
  `''`, no `<option>` gets `selected`, and the browser displays option[0] while
  the row holds `undefined`. Because the displayed value already *looks* right,
  the user never changes it, so `onchange` never fires and it is never written.
  Two concrete consequences: `tools-registers.js:86` counts festivals with
  `r.status === 'Planned'`, so **the amber "N deadlines within 30d" warning
  never fires for any festival row the user did not manually re-pick Status
  on** — the single most useful number on that tab; and
  `tools-registers.js:41` buckets crew by `r.dept || 'Other'`, so the
  department breakdown says "Other 9" while every row visibly reads
  "Production". Fix (one line, plus schema hygiene): in `Register.add`,
  default every `select` field to `f.options[0]`, or render a leading
  `<option value="">—</option>` so the display matches the stored blank.

- **`tools/lib-script.js:14-27` — the LCS table is a full O(n·m) `Int32Array`
  allocation, and the header comment ("scripts are small enough") is wrong for
  the feature's own use case.** Comparing two 110-page drafts (≈6 050 lines
  each) allocates 6 051 separate `Int32Array`s totalling ≈140 MB, synchronously,
  on the UI thread; two 130-page drafts is ≈195 MB. Measured: a 2 000×2 000 diff
  takes 230 ms in node, so a 6 000×6 000 is roughly 2 s of frozen tab plus the
  allocation. The revision workflow exists precisely to compare two full drafts
  that differ by a handful of lines. Fix is cheap: trim the common prefix and
  suffix before building the table (collapses the realistic case from 6 000×6 000
  to well under 100×100), and row-compress the DP to two rows for the residue.

- **`tools/lib-media.js:109,120` — hash comparison is case-sensitive and the
  manifest regex only accepts lowercase hex.** `[0-9a-f]+` at `:109` means a
  manifest written by ShotPut Pro, Silverstack or YoYotta with uppercase digests
  parses to **zero** entries (verified), and `m.sha256 === s.sha256` at `:120`
  reports every file as `changed` on a case mismatch (verified). Fix:
  `[0-9a-fA-F]+` in the pattern and `.toLowerCase()` on both sides of the
  comparison.

- **`tools/lib-media.js:72` — `coverage()` uses `distance × w / focal` where the
  thin-lens relation is `(distance − focal) × w / focal`.** The error is exactly
  one focal length, negligible at conversational distances and large where the
  tool is most needed. Measured on Super 35: 25 mm at 3 m is 1.0 % off, 50 mm at
  0.6 m is 11 % off, **100 mm at 0.3 m is 40 % off** — and an insert or product
  shot is exactly the case where someone asks "will the label fill frame".
  `lensCalc('super35', 50, 0.04)` (subject nearer than the focal length) happily
  returns 0.02 m rather than flagging that the lens cannot focus there. Note
  `test_tools.mjs:136` asserts `widthAt ≈ 2.99 ± 0.05`, which both the current
  and the corrected formula satisfy, so the test does not discriminate. Fix:
  use `(distance - focal/1000)`, and return `null` when `distance <= focal`.

- **`tools/lib-media.js:59-69` — the lens calculator has no anamorphic squeeze.**
  A 2× anamorphic 40 mm on Super 35 has the horizontal field of a 20 mm
  spherical; this tool reports the spherical 40 mm figure. Any show shooting
  anamorphic gets a wrong number from every row. Fix: add a `squeeze` argument
  (1, 1.3, 1.5, 1.8, 2) and use `fov(s.w * squeeze, focal)` for horizontal,
  leaving vertical alone.

- **`tools/lib-script.js:53-59,81` — captions are dropped silently on legal
  input.** `tcToMs` requires a fractional-seconds group, so a cue timed
  `00:00:01 --> 00:00:03` (valid, common in hand-written and machine-generated
  SRT) returns `null` and `parseCaptions:82` drops the cue with no message —
  verified, a one-cue file parses to **0 cues** and the UI cheerfully reports
  "0 cues loaded". The end-time extraction at `:81`
  (`(tm[1]||'').split(' ')[1] || tm[1]`) is also position-dependent: a VTT line
  `00:00:01.000 -->00:00:03.000 line:0` (no space after the arrow, legal)
  parses `line:0` as the end time and drops the cue — verified. Fix: make the
  milliseconds group optional in both regexes, and use
  `tm[1].trim().split(/\s+/)[0]` for the end time.

- **`tools/lib-script.js:99-113` — `captionQc` misses the two checks a
  deliverable is most often rejected for.** It has reading speed and line
  length (both at sensible thresholds) but no **minimum cue duration** and no
  **minimum inter-cue gap**. Verified: a 200 ms flash cue followed 20 ms later
  by the next cue returns an empty issue list — QC CLEAN. Every major platform
  spec requires ≥ 5/6 s (833 ms) per cue and a ≥ 2-frame gap. Fix: add both,
  parameterised, plus a frame-rate field so 23.976 and 24 can be told apart.

- **`tools/sched-weather.js:104,120` — a schedule longer than 16 days loses the
  forecast entirely, including the days that *are* in range.** Open-Meteo's
  forecast endpoint covers ~16 days; `n` is allowed up to 60 (`:104`) and
  `end_date` is set to the last day (`:120`), so an out-of-range `end_date`
  errors the whole request and the empty `.catch` blanks the column for day 1
  as well as day 40. Fix: clamp `end_date` to today + 16 and render the tail as
  "beyond forecast" per row.

- **`tools/sched-weather.js:150` + `tools/lib-sun.js:78-79,95` — units are
  unlabelled and mismatched to the audience.** `weatherUrl` sets neither
  `temperature_unit` nor `wind_speed_unit`, so Open-Meteo returns °C and km/h;
  the table prints `16–24°` with no unit, and `shootRisk`'s wind threshold of
  30 (`lib-sun.js:95`) is 30 km/h ≈ 19 mph — a stiff breeze, not the condition
  that stops a crane. Eight of the twelve presets in `CITIES`
  (`sched-weather.js:25-30`) are US cities. Fix: add an explicit unit toggle
  that sets both API params, and label the column.

- **`tools/lib-sun.js:33-47` — `crossing()` has no site-elevation or
  custom-horizon parameter.** −0.833° is the sea-level value; at 2 000 m the sun
  sets roughly 9 minutes later, and a location ringed by hills sets far earlier
  than either. Both are routine location-scout questions. Fix: accept an
  `elevationM` and subtract `1.15° × √(elevM)/60`, and optionally a manual
  horizon-obstruction angle per location.

- **`tools/tools-core.js:98-161` — the whole table re-renders on every single
  cell edit.** `inp.onchange` at `:149-153` calls `self.render(host)` whenever
  the schema has a `summary` or an `expiryField` — which is every register in
  `tools-registers.js`. That throws away scroll position and focus on each
  edit. On a 200-row crew list this is the difference between usable and not.
  Fix: patch the summary node and the affected row in place instead of
  rebuilding `innerHTML`.

- **`tools/tools-core.js:54-56` vs the implementation — the documented schema
  contract is wrong in four places.** `flags` is documented at `:55` and is
  dead code: `:130-133` computes `s.flags(r)` and then does `h += ''`, throwing
  the result away. `type: 'textarea'` (`:57`) renders a plain `<input>`
  (`:119-121`), so a continuity note cannot contain a newline. `type: 'money'`
  and `type: 'number'` (`:57`) both fall through to `type="text"` (`:122`) —
  no numeric keypad on a phone, which matters for a slate logger and a hot-cost
  entry used on set. Meanwhile `expiryField` (used at `:124`) and `blank` (used
  at `:139`) are undocumented. Fix these together with the promotion below.

### LOW

- `tools/lib-sun.js:35` — the sign on the `0.0009` (`J0`) term is flipped
  relative to the reference algorithm; it should be `- 0.0009`, matching
  `n = round(d - J0 - lw/2π)`. Harmless today because `sunTimes:52` always
  passes a local-noon instant, which leaves the value ≈ 0.02 from a rounding
  boundary, but it is a trap for any future caller that passes a different
  reference time. One character.
- `tools/lib-sun.js:24-29` returns π for the midnight-sun case, which makes
  `sunTimes` report an identical sunrise and sunset (verified: Tromsø
  2026-06-21 both read 15:47 UTC). Daylight is correctly 24 h, but the two
  printed times are fictitious. Return a `noSet: true` flag and have
  `sched-weather.js` print "no sunset".
- `tools/tools-core.js:140-147` — `URL.createObjectURL` is never revoked on CSV
  export (same at `tools-script-ui.js:193`, `:256`, `tools-media-ui.js:115`,
  `:397`), leaking a blob per download for the tab's lifetime.
- `tools/tools-core.js:95` — CSV rows are joined with `\n` and there is no
  UTF-8 BOM, so accented crew names mis-render when the file is opened in Excel
  on Windows. `\r\n` + `﻿` is the two-character fix.
- `tools/lib-script.js:53` — hours are capped at two digits, so a timecode past
  99 h (verified: `100:00:00,000` → `null`) is dropped. Rare, but broadcast
  timecode is sometimes hour-of-day offset.
- `tools/lib-media.js:22-27` — a DaVinci `.cube` using `LUT_3D_INPUT_RANGE`
  (the common variant of DOMAIN_MIN/MAX) is silently ignored rather than read
  or rejected; and `:29` only rejects *too few* data rows, accepting and
  discarding extras.
- `tools/tools-script-ui.js:249` — EPK stills go through `CinUrl.safe`, which
  is right, but `js/safe-url.js:63` admits only png/jpeg/webp/gif/avif. The
  file input at `:214` is `accept="image/*"`, so a HEIC still straight off an
  iPhone becomes `<img src="">` in the generated press kit with no message.
  Either narrow the `accept` or transcode through a canvas first (the moodboard
  already does exactly this at `tools-media-ui.js:465-470`).
- `tools/tools-media-ui.js:93,112,131` — `lastEntries` and `loadedManifest`
  persist across operations with no reset, so hashing a *second* card after a
  verify silently re-verifies it against the first card's manifest instead of
  writing a new one. Add a "start over" control.
- `tools/tools-media-ui.js:162` — the dailies scrubber hard-codes 24 fps
  (`FR = 1/24`); a 23.976 or 25 fps clip steps by the wrong increment and the
  timecode readout at `:176` drifts. Read the rate or offer a picker.

---

## What is missing entirely

### `js/cin-register.js` — promote `Register` to the shared table engine — HIGH value

This is the assignment's central question, and the answer is: yes, `Register`
is the right nucleus, and it is currently about 45 % of what the other modules
need. Today it is 100 lines that does storage, render, edit, delete and CSV-out
(`tools-core.js:58-161`), and **it is used by exactly one module** — thirteen
registers across `tools-registers.js`, `tools-money-ui.js`, `tools-script-ui.js`
and `tools-media-ui.js`.

What the rest of the platform is doing instead, measured:

- Sixteen module `index.html` files hand-roll the same table: `casting` (2
  tables), `festivals` (2), `investors` (2), `vfx` (2), `post` (3), `wardrobe`
  (3), plus `contracts`, `dailies`, `music`, `props`, `taxcredit`, `finance`
  and others at one apiece — each building `'<tr data-id="' + esc(id) + '">'`
  by concatenation with its own render function.
- `props/index.html:140-143` reimplements `TCore.load`/`save` verbatim, silent
  `catch (e) {}` and all. That pattern repeats across the module set.
- `csvCell` exists in four independent copies — `boards/lib-shots.js:104`,
  `finance/lib-money.js:114`, `producer/budget-sheet.js:175`,
  `production/lib-prod.js:91` — plus `csvSafe` in `tools-core.js:82`. Three are
  byte-identical; `producer`'s diverged into RFC-correct conditional quoting.
  Five copies of a four-line security-relevant function is five places to
  forget the guard.
- Only `finance/index.html` and the `tools` registers can export CSV at all.
  Every other register in the platform is a dead end for a producer who needs
  the list in a spreadsheet.

**Proposed API** (vanilla, no build step, `<script src="/js/cin-register.js">`,
same IIFE shape as `js/safe-url.js`):

```js
var reg = CinRegister.create({
  key: 'SB_Crew_v1',              // never renamed; existing rows load as-is
  fields: [
    { id:'name',  label:'Name',      type:'text',   required:true, sortable:true },
    { id:'dept',  label:'Dept',      type:'select', options:[...], default:'Production' },
    { id:'rate',  label:'Rate',      type:'money',  min:0, align:'right' },
    { id:'note',  label:'Note',      type:'textarea', rows:3 },
    { id:'exp',   label:'Expires',   type:'date',   expiryWarnDays:30 }
  ],
  validate: fn(row) -> [{field, msg}] | null,
  summary:  fn(rows) -> html,
  rowClass: fn(row) -> 'warn' | 'bad' | '',   // replaces the dead `flags` hook
  sort: { field:'name', dir:'asc' },
  filter: true,                                // renders a search box
  virtual: { rowHeight: 34, threshold: 200 },  // windowed render past 200 rows
  csv: { in:true, out:true, filename:'crew' }
});
reg.mount('#hostId');
reg.rows;  reg.add(row);  reg.update(id, field, value);  reg.remove(id);
reg.setFilter(str);  reg.setSort(field, dir);  reg.importCsv(text) -> {added, skipped, errors};
reg.on('change', fn);                           // so a report can recompute
```

Ten additions over what exists, in dependency order:

1. **Typed fields that actually differ** — `money`/`number` emit
   `type="number" inputmode="decimal"`, `textarea` emits a real `<textarea>`.
   Fixes `tools-core.js:119-122`.
2. **`default` per field** and `required` — kills the select-mismatch bug above
   at the root, for every module at once.
3. **`validate`** returning per-field errors rendered inline, so a rate of
   "fifty" or an expiry before an effective date is caught at entry rather than
   surfacing as `num()` returning 0 three tabs away.
4. **Sort** — click a header. Every one of the sixteen hand-rolled tables lacks
   it.
5. **Filter/search** — one box over all string fields.
6. **Virtualisation** past ~200 rows. A feature crew list, a 400-slate take log
   and a props register all cross that.
7. **In-place patching** instead of full `innerHTML` re-render, fixing the
   focus/scroll loss at `tools-core.js:149-153`.
8. **CSV import** to match the existing export, with a header-to-field mapping
   step. Every production already has the crew list in a spreadsheet; there is
   currently no way in.
9. **Quota-aware persistence** — `save()` returns a boolean, a failed write
   raises a toast instead of vanishing.
10. **The single `csvCell`**, RFC 4180 quoting + `\r\n` + BOM + the
    formula-injection guard, exported as `CinRegister.csvCell` so the four
    copies can call it.

**Adopters and what each deletes** (all `SB_*` keys and field ids stay exactly
as they are — this is a render/persistence swap, not a data migration):

| Module | Deletes |
|---|---|
| `tools/tools-registers.js` | nothing structural — the 5 schemas stay, engine swaps under them |
| `props/index.html` | `readLS`/`save` (`:140-143`), `renderRows` (`:235-258`) |
| `casting`, `festivals`, `investors`, `vfx` | 2 table renderers each + their localStorage helpers |
| `post`, `wardrobe` | 3 table renderers each |
| `contracts`, `dailies`, `music`, `taxcredit`, `finance` | 1 renderer each |
| `boards/lib-shots.js`, `finance/lib-money.js`, `production/lib-prod.js` | their `csvCell` copies (`:104`, `:114`, `:91`) |
| `producer/budget-sheet.js` | its `csvCell` (`:175`) — keep its conditional-quoting behaviour as the shared implementation, it is the correct one |

Rough size: ~450 lines for the shared component, plus a `scripts/test_register.mjs`
covering schema validation, sort/filter, CSV round-trip and the injection guard
on the pure-logic half (the render half stays DOM-only and untested, matching
the existing `lib-*` / UI split). Net deletion across the sixteen adopters is
comfortably larger than the addition. **Do this first — every other item in
this report that touches a register gets fixed once instead of seventeen times.**

### `js/lib-sha256.js` — incremental SHA-256 — HIGH value

Without it, the Offload tab cannot hash real camera media (see the HIGH finding
at `tools-media-ui.js:99`). `crypto.subtle.digest` is one-shot with no
`update()`, so streaming requires an in-repo implementation — ~90 lines of pure
JS, node-testable, no dependency, well within the platform's constraints, and
verifiable against `node:crypto` in a `scripts/test_sha256.mjs`. Feed it from
`file.stream()` (or `file.slice()` chunks) at 8 MB, `await` between chunks so
the tab stays responsive, and report per-file progress. Attaches to `tools`
Offload; `dailies` and `post` want the same thing for round-trip verification.

### ASC MHL v2 output — MED-HIGH value

`lib-media.js:88-106` writes `<cinamatemanifest>`, which no other tool in the
industry can read. A DIT's manifest has to be handed to post and re-verified in
Silverstack, ShotPut Pro or YoYotta; a proprietary root element makes that
impossible, so the tool's output stops at the edge of this app. Emitting real
ASC MHL (or at minimum classic MHL 1.1 `<hashlist>`) plus an import path for
the same is a schema change to one function, not new machinery, and it turns
the Offload tab from a demo into something a DIT can actually put on a card.
Keep `<cinamatemanifest>` readable on import for anyone with existing files.

### Depth-of-field / hyperfocal on the lens tool — MED-HIGH value

`lib-media.js:73-84` gives FOV and coverage but not DOF, which is the number
the camera department actually asks for on the day ("at T2.8 on a 50, how much
have I got?"). It is pure trigonometry over the sensor data already in
`SENSORS` (`:59-69`) — circle of confusion from sensor width, hyperfocal
`H = f²/(N·c) + f`, near/far limits — perhaps 25 lines plus tests, and it
attaches directly to the existing Lens & Coverage tab. Add T-stop and CoC
inputs alongside the focal and distance fields already at
`tools-media-ui.js:228-229`.

### Frame-accurate caption timing and a broadcast caption format — MED value

`lib-script.js` is millisecond-based throughout. Deliverables are frame-based,
and every platform spec (Netflix, Amazon, most broadcasters) asks for TTML/iTT
or SCC, not SRT. A frame-rate parameter through `tcToMs`/`msToTc`/`captionQc`
plus a `toTtml()` writer would make the Captions tab produce something a
distributor accepts. Attaches to `tools` Captions and to `post`.

### Screenplay-aware revision marks — MED value

The assignment asked which screenplay conventions `lib-script.js` handles.
The honest answer: **none — it contains no screenplay parser at all.** It is a
plain line differ (`:14-37`) plus a caption codec; there is no handling of dual
dialogue, `(CONT'D)`, transitions, montages or scene-number suffixes anywhere
in the file, and none is claimed in its header. The screenplay parser lives in
`timeline/parser.js`, outside this slice. The gap that matters *here* is that
the colored-page workflow (`tools-script-ui.js:21-89`) advertises "industry
asterisk change-bars" at `:28` but `diffLines` returns ops with no page or
scene attribution, so there is no way to produce an actual revision-marked
page: no locked scene numbers, no A-scenes, no `12A` page numbering, no
asterisk in the right margin, no revision slug in the header. Making that real
means running the diff through `timeline/parser.js`'s scene structure and
emitting per-page marks — a genuine piece of work, and the thing that would
turn this tab from a diff viewer into the revision workflow it says it is.

---

## Evidence

Files read in full: `tools/tools-core.js` (167), `tools/lib-sun.js` (102),
`tools/lib-script.js` (121), `tools/lib-money.js` (177), `tools/lib-media.js`
(137), `tools/sched-weather.js` (160), `tools/tools-registers.js` (177),
`tools/tools-money-ui.js` (207), `tools/tools-script-ui.js` (262),
`tools/tools-media-ui.js` (515), `tools/index.html` (130),
`scripts/test_tools.mjs` (162), `js/safe-url.js` (107), `_headers` (head),
`docs/audit/BRIEF.md`, `docs/audit/assignments/teamA-05.md`.

Files sampled for the duplication survey: `props/index.html:79,135-143,235-258`,
`boards/lib-shots.js:104-110`, `finance/lib-money.js:114-120`,
`producer/budget-sheet.js:175-181`, `production/lib-prod.js:91-97`,
`producer/index.html:161`; table/`setItem`/`text-csv` counts taken across all
28 module directories and `app.html`.

Reproduced by running the libraries under node (scratch harness, no repo files
touched):

- LA 2026-06-21 sun times vs NOAA — 92 s / 48 s error; Tromsø midnight sun
  (24 h, identical rise/set) and polar night (`null`/`null`).
- `TSun.fmtLocal(budapestSunrise)` → `02:47` where CEST is `04:47`.
- `TMedia.parseManifest` on a two-block manifest with one missing `<sha256>`
  → one entry pairing block A's path with block B's hash;
  `verifyAgainst` on that → `clean: true`.
- `TMedia.parseManifest` on uppercase hex → 0 entries; `verifyAgainst` with a
  case-mismatched digest → `changed`.
- `TMedia.sampleLut` on a `DOMAIN_MAX 4 4 4` LUT — domain ignored, out-of-range
  input clamped to 1.
- `TMedia.lensCalc('super35', 100, 0.3).widthAt` → 0.07 m vs 0.05 m exact
  (40 % over); `lensCalc('super35', 50, 0.04)` returns 0.02 rather than null.
- `TScript.tcToMs('00:00:01')` → `null`; `parseCaptions` on a one-cue SRT with
  no milliseconds → 0 cues; on a VTT with cue settings and no space after
  `-->` → 0 cues (with a space → 1 cue).
- `TScript.captionQc([{0,200},{220,1000}])` → `[]` (no min-duration, no
  min-gap check).
- `TScript.diffLines` at 2 000×2 000 → 230 ms; LCS table size computed at
  10 MB / 42 MB / 140 MB for 30 / 60 / 110-page drafts.
- `node scripts/test_tools.mjs` → all checks pass, before and after. Nothing in
  this slice was edited.
