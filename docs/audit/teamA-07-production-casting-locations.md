# TEAM A DEV 07 — production · casting · locations · dailies

Read-only audit. Every claim below has a `file:line` behind it and, where a
number is quoted, a run against the real code (`node` against the actual
`lib-*.js`, no mocks). Baseline confirmed clean before and after: `node
scripts/run_all_tests.mjs` → **44/44 suites passed**. Nothing was edited.

---

## What exists and works

- `dailies/lib-dailies.js:36-78` — bijective base-26 slate arithmetic
  (`lettersToNum`/`numToLetters`/`nextSetup`) is correct through 12Z → 12AA.
  This is the real 2nd-AC scheme and it is implemented properly.
- `dailies/lib-dailies.js:154-200` — `cameraReport`/`soundReport` produce the
  classic fixed-column paper layout, both footed with "cross-check against the
  camera assistant's written report before lab/DIT turnover." Correct posture.
- `casting/lib-castdesk.js:39-52` — `cueName()` is the best screenplay
  primitive in my slice: strips `(V.O.)/(O.S.)/(CONT'D)`, rejects transitions
  via `NOT_CUES`, requires real dialogue on the next non-blank line
  (`:56-73`). It does not confuse a name in an action line for a speaking role.
- `casting/lib-castdesk.js:87-109` — `holdConflicts()` cross-role, ISO-string
  date overlap. Surfaced at `casting/index.html:241-249` with both sides of the
  conflict named. This is a genuinely useful casting-office feature.
- `casting/lib-castdesk.js:141-161` — `offerLetter()` prints `TBD` for every
  missing field and never invents a date or rate; carries the non-binding /
  counsel-reviews language. Exactly right.
- `tools/lib-sun.js:33-62` — full NOAA/Meeus `sunTimes()` with longitude
  correction, returning real ms-UTC timestamps. Handles polar cases
  (`:26-27`). This is the correct solar engine and it already exists.
- `production/lib-prod.js:91-95` — `csvCell()` implements the `= + - @ \t \r`
  apostrophe guard, and it is under test at `scripts/test_csv_injection.mjs:82`.
- `production/production.js:507-529` — `suggestCast()` is the **model** for
  failure handling in this codebase: it catches, and renders
  `'Wikidata unavailable right now (' + esc(e.message) + ') — try again shortly.'`
  into the panel. It never fabricates. Every other network path in my slice
  should copy this and does not.
- `js/learn.js:148-173` — `cleanCached()` strips `javascript:/vbscript:/data:/
  file:` schemes and `<>"'` from every third-party reply before it is stored,
  and blocks `__proto__`/`constructor` keys. The TMDB/Wikidata payloads are
  neutralised on the way in. Given `'unsafe-inline'` in the CSP this matters,
  and it is done correctly.

### Answering the assignment directly: is `lib-prod.js` holding seven concerns costing anything?

**No — leave it alone.** It is 182 lines carrying five (not seven) small pure
concerns: DPR, cue sheet, sides, residuals, delivery template. Continuity,
camera/sound reports, VFX and clearances have *no logic* in the lib at all —
they are pure `T.Register` field configs at `production/production.js:157-206`,
`:240-262`, `:308-327`. Splitting a 182-line file would be churn with no payoff.

The duplication cost is real but it is **across** files, not inside this one —
see `sidesFor` (below) and the twelve-copy slugline regex in *What is missing*.

---

## What exists but needs work

### HIGH — the Daily Production Report cannot read the take log it is pointed at

`production/lib-prod.js:27-30` vs the only writer of that key,
`tools/tools-media-ui.js:37-48`.

The DPR reads `SB_TakeLog_v1` (`production/production.js:220`). That store is a
`T.Register` whose fields are **`time, scene, take, roll, grade, note`**.

1. `lib-prod.js:30` — `printed = dayTakes.filter(t => /print|good|circle/i.test(String(t.status || t.print || '')))`.
   Neither `status` nor `print` exists on the row. The field is **`grade`**
   (`'Circled ⭕' | 'Good' | 'NG' | 'False start'`). **`printedCount` is always
   0**, for every owner, every day, no matter how many takes were circled.
2. `lib-prod.js:27` — `dayTakes = takes.filter(t => !t.date || t.date === date)`.
   The row has **no `date` field** (it has `time`). `!t.date` is always true, so
   **every take ever logged is counted into every day's report**, printed under
   `Date: <today>` at `lib-prod.js:52-55`.

Why it matters: the DPR is the one document a production office emits daily and
that financiers, the completion bond and the insurer read. It currently reports
a cumulative all-time take count as today's count, with zero prints, every day.

The test is green because `scripts/test_modules.mjs:96` feeds a hand-written
fixture `{scene, take, status:'print', date}` — a shape **no writer in the app
produces**. The suite validates the fixture, not the contract.

**Change:** map `grade` → printed and add `date` to the `SB_TakeLog_v1` Register
(`tools/tools-media-ui.js:38-48`) — do not rename the key. Then make
`test_modules.mjs` build its fixture from the same field list the Register
declares, so a divergence like this fails.

### HIGH — the Dailies Logger is invisible to everything that consumes take data

`dailies/index.html:142,149` stores `SB_Dailies_v1` as `{days:[], takes:[…]}`.
The DPR reads `SB_TakeLog_v1` (`production/production.js:220`), and
`rowsOf()` (`production/lib-prod.js:19`) only unwraps an array or `.rows` —
never `.takes`. The take model also differs: `makeTake()`
(`dailies/lib-dailies.js:81-92`) uses a boolean `circled`; `SB_TakeLog_v1` uses
a `grade` string.

So the platform ships **two independent on-set take logs** — the phone-first
Dailies Logger and Tools → Slate & Takes — and the Daily Production Report reads
the one that is not the dedicated module. A production that logs its whole shoot
in `dailies/` gets "Takes: 0 (0 printed) · Scenes covered: none logged" every
single day.

**Change:** make `SB_Dailies_v1.takes` the source of truth, teach `rowsOf()` to
unwrap `.takes`, and normalise `circled` ↔ `grade` in one adapter. Both keys
stay — existing owner data under either must keep loading.

### HIGH — audition sides from the Production Office leak the entire screenplay

`production/lib-prod.js:106-118`. Verified by running both implementations
against the same two scripts:

```
NUMBERED shooting script ("12  INT. KITCHEN - DAY"):
  CProd.sidesFor(TOM)  → 1 block, slug "12  INT. KITCHEN - DAY", text = WHOLE SCRIPT
  CCastDesk            → 2 scenes found, correct sides
UNNUMBERED script, TOM speaks in scene 1 only:
  CProd.sidesFor(TOM)  → 2 blocks (includes "EXT. STREET - DAY", where Tom
                          never speaks — matched on "Tom is not here" and
                          on the word "Tomorrow")
  CCastDesk.sidesFor   → 1 scene. Correct.
```

Two distinct defects in one function:

1. `:110` — the split regex is `\n(?=(?:INT|EXT|INT\/EXT|I\/E|EST)[.\s])`. It is
   the **only** slugline regex in the repo that omits the `^\s*(?:\d+[\s.]*)?`
   scene-number prefix (compare `casting/lib-castdesk.js:13`,
   `dailies/lib-dailies.js:19`, `locations/lib-scout.js:540`,
   `timeline/parser.js:10`). On any locked shooting script — i.e. every script
   that has reached casting — it never splits, and the "sides" become the
   complete screenplay.
2. `:112-113` — `up.indexOf(name) < 0` is a raw substring test over the whole
   uppercased block. `AL` matches `CALL`/`ALONE`; `TOM` matches `TOMORROW`. It
   also matches a character merely *named in an action line* who has no lines.

Why it matters: sides go out to agents and strangers. Handing a full unreleased
screenplay to every auditionee is the kind of leak a production does not
recover from, and `production/production.js:110-113` offers it as a `.txt`
download.

**Change:** delete `CProd.sidesFor` entirely and have `production/production.js`
call `CCastDesk.sidesFor` (`casting/lib-castdesk.js:114-136`), which is already
correct, already tested (`scripts/test_castoffice.mjs:105-114`) and already
loaded elsewhere. This is a deletion, not a rewrite.

### HIGH — a failed research call renders as a confident, wrong answer

`production/production.js:468-506`. Three separate false-UI paths:

1. `:474` — `try { wd = CC.parseWikidataActor(await sparql(…)); } catch (e) {}`.
   Swallowed. With no TMDB key (the documented default — `:44` calls the key
   "optional"), a Wikidata outage leaves `films = []`, and `:483` renders
   **`Nothing found for "Meryl Streep" — check the spelling (full billed name
   works best).`** A network failure is reported to the user as *their* typo.
2. `:493` — `catch (e) {}` on the director filmography. `directorFilms` stays
   `[]`, but `fit()` is still computed and rendered at `:440-443` as a
   `<b>N/100</b>` with a gold progress bar. Measured with a 24-film,
   recently-active actor:

   ```
   director lookup FAILED/absent → {score: 36, direct: 0, genreOverlap: 0,
                                    reasons: ["Recently active (2026)"]}
   director lookup SUCCEEDED     → {score: 66, genreOverlap: 1}
   ```

   Same actor, same director, 30-point swing, and the card gives the reader no
   signal at all that the comparison was never made. Note the reasons list even
   drops `lib-cast.js:174`'s honest `"No shared history found — a fresh
   pairing"` fallback, because the recency line already made `reasons`
   non-empty. The score is presented as a finding; it is an artifact.
3. `:489` — `if (dirName && tmdbKey())`. Without a TMDB key the director
   filmography is **never fetched at all** — the Wikidata director query exists
   (`lib-cast.js:69-77`) but is only used by `suggestCast`. So on the
   default keyless path, `genreOverlap` is structurally always 0 and
   `"Strong genre overlap"` (`lib-cast.js:153`) can never fire. The fit score is
   a lower bound masquerading as a measurement.

**Change:** carry an explicit per-source status (`ok | failed | not-attempted`)
out of the fetch layer; suppress the fit block entirely when
`directorFilms.length === 0` and say *why* ("director filmography not loaded —
add a TMDB key, or Wikidata was unreachable"); and never let a caught network
error fall through to a "not found" message. Copy the presentation at `:528`.

### HIGH — the quote estimator is capped by the data source, and blames the actor

`production/lib-cast.js:190-213`. Measured, keyless Wikidata path, 24 recent films:

```
quote → {tier: "Established supporting", low: 25000, high: 150000,
         basis: ["24 credits in the last 6 years",
                 "no recent top-billed roles found",
                 "floor: SAG-AFTRA scale $1,204/day"]}
```

Wikidata films (`parseWikidataActor`, `lib-cast.js:79-94`) carry **no `order`
field**. So `leadish` at `:198` is always 0 and `popularity` is always 0, which
means `idx` can never exceed 1 at `:200-204`. **Every actor on the keyless path
returns $25k–$150k** — an unknown day player and an A-lister land in the same
bracket.

Worse, the basis line reads `"no recent top-billed roles found"`. That is
phrased as a fact about the performer. It is actually a fact about the data
source: billing order was never available. The assignment's question — *does the
UI distinguish sourced figures from estimates* — the honest answer for this
block is **no**: it does not distinguish *absent* from *not carried by this
source*, which is the more dangerous confusion when the output is a money band
someone may take into a negotiation.

**Change:** make the tier ceiling a function of what the source can support.
When billing order is unavailable, return `tier: 'Insufficient data'` with the
scale floor and a search link, rather than a bracket the model cannot justify.
That is the brief's own rule ("unverified entries get a Google search link
instead of a made-up value") applied to a figure, not just a phone number.

### HIGH — the permit & stage directory is systematically truncated mid-word

`locations/lib-scout.js:23-421`. Measured field lengths across all six hubs:

```
PERMITS   required=220  cost=340  leadTime=200  insurance=180  police=160
          — identical to the character for every one of the six hubs
STAGES    stages=90 (34 of 36 facilities hit exactly 90)
          notable=110 (7 hit exactly 110)   booking=300 (all six hubs)
```

Every field over its cap was hard-`slice()`d, mid-word. Rendered examples:

- Toronto `required` ends `"…NOT required if all filming activity — including
  parking of production veh"` — the reader cannot tell whether the exemption
  covers them, which is the only thing that line is for.
- Toronto `insurance` ends `"…as additional insured. Certificate"`.
- Atlanta `required` ends `"…Sec. 46-103(1)). No city filmi"`.
- LA `leadTime` ends `"[Not re-verified in this pass — verification was sc"`.

Rendered as authoritative `<dd>` under headings "When a permit is required",
"Insurance", "Police / traffic extras" at `locations/index.html:295-299`.
Truncated insurance and permit-scope guidance is worse than no guidance: it
reads complete enough to act on.

The module's own header comment (`lib-scout.js:8-15`) is truncated by the same
pipeline — it breaks mid-sentence at `"anything else stays"` / `"was built, so
every entry ships verified:false…"`.

**Change:** this is a data-pipeline bug, not a content decision. Re-emit the
directory without the length caps, and add a `scripts/test_locations.mjs` guard
asserting no string field ends without terminal punctuation.

### HIGH — the page tells the reader the fees are not shown, directly under the fees

`locations/index.html:301` renders, unconditionally:

> "Sources: this build could not verify fees or application URLs against the
> official pages, **so none are shown** — fees and rules drift constantly."

It sits immediately below `<dt>Cost</dt><dd>` (`:296`) showing e.g. FilmLA
`"motion permit application $931"`, and beside an **"Apply ↗"** button (`:287`)
pointing at `https://my.filmla.com`. Every one of the six permit records carries
`verified: true`, a populated `applyUrl`, and detailed currency figures.

Separately at `:322`, the stages card hardcodes
`<span class="sk-tag">unverified guidance</span>` for the whole hub — while the
per-facility link logic four lines later (`:324-326`) *does* correctly respect
`f.verified`, falling back to `S.searchLink()`. So the record-level provenance
exists in the data and is honoured for links but overridden by a fixed string in
the header.

The result is that the provenance system is inverted: verified data is labelled
unverified, and the one honest sentence on the page is factually wrong about the
page it is on. A reader who learns the disclaimers are noise stops reading them.

I could not resolve from the code alone which claim is true — the header comment
says one thing, the `verified` flags say another, the UI says a third. **That
irreconcilability is the finding.** Per the brief's rule, a fee or URL the build
cannot stand behind should render as a search link; one it can should be labelled
with its verification date. Currently neither happens.

**Change:** drive both the tag and the disclaimer off the record's own
`verified` flag (per-facility, not per-hub), add a `verifiedOn` date to each
record, and render "verified against the official fee schedule on
`<date>`" or a search link — never both messages at once.

### HIGH — the Location Scout Book uses the wrong sun engine, and cannot use the right one

The assignment asks about `locations/`'s relationship to `tools/lib-sun.js`.
There is none: `locations/index.html:112-114` loads `project-badge`,
`lib-money` and `lib-scout` — **not `/tools/lib-sun.js`**. It uses
`CScout.goldenHour` (`lib-scout.js:480-505`) instead, a Cooper's-declination
approximation with **no longitude, no timezone, no equation of time, no DST**.

Ironically the vestigial Locations *tab* in the Production Office
(`production/index.html:100`, `production/production.js:146-153`) does load
`TSun` and gets it right. The worse engine is in the dedicated module.

Measured, same lat/lon/date, sunset (converted to local clock):

```
2026-06-21 Los Angeles   TSun 20:08 PDT   CScout 19:13   Δ  55 min
2026-06-21 Toronto       TSun 21:03 EDT   CScout 19:43   Δ  80 min
2026-06-21 Atlanta       TSun 20:52 EDT   CScout 19:12   Δ 100 min
2026-06-21 London        TSun 21:22 BST   CScout 20:19   Δ  63 min
2026-12-21 Atlanta       TSun 17:34 EST   CScout 16:57   Δ  37 min
```

37 to 100 minutes. The page does label the output "solar time — verify locally"
twice (`lib-scout.js:481`, `index.html:107`) — that is honest, and I credit it —
but no 1st AD converts solar time by hand, and a crew that calls the magic-hour
setup off this page is on set up to an hour and a half wrong. The platform
already contains the correct engine.

The structural reason it cannot simply be fixed in the UI: `blankLocation()`
(`lib-scout.js:524-533`) has **no `lat`/`lon` fields**, and the sun form at
`index.html:101` asks only for **latitude**. The location record physically
cannot feed a longitude-aware calculation.

**Change:** add `lat`/`lon` to `blankLocation()` and to the `FIELDS` list at
`index.html:168-171`; load `/tools/lib-sun.js`; call `TSun.sunTimes(date, lat,
lon)` and `TSun.fmtLocal()`. Then retire `CScout.goldenHour` (keeping the export
as a thin shim so `scripts/test_locations.mjs` stays green until it is updated).
This also lets each location carry its own coordinates instead of the user
re-typing them.

### HIGH (adjacent) — the weather forecast is blocked by CSP and fails silently to a false display

`tools/sched-weather.js:120` fetches `https://api.open-meteo.com/...`
(`tools/lib-sun.js:77-81`). The deployed CSP at `_headers:4` sets:

```
connect-src 'self' blob: data: https://api.themoviedb.org
            https://query.wikidata.org http://127.0.0.1:* http://localhost:*
```

`api.open-meteo.com` is **not in the list**, and there is no per-path override
for `/tools/*` (`_headers` scopes checked: `/*`, `/*.js`, `/*.html`, `/*.css`,
`/workflow/*`, `/agents/*`, `/app.html`, `/editor/*`, `/timeline/*`,
`/static/ffmpeg/*`, `/index.html`; `netlify.toml` sets no CSP at all).

Every weather fetch on the live site is therefore blocked — and
`sched-weather.js:133` is `.catch(function () { /* astro-only view already
rendered */ });`. The failure is swallowed, and the table at `:148-152` then
renders **"beyond forecast"** and risk **"—"** for every day. That string is a
lie: the days *are* within Open-Meteo's ~16-day window; the call was blocked.
The footer at `:157` compounds it — *"forecast from the free Open-Meteo API,
fetched by your browser"* — describing something that never happens.

I flag this as adjacent to my slice because it is the weather half of the
locations/sun story, and because it is the cleanest example in the codebase of
the failure mode the assignment asks about: **a failed call leaving the UI
showing something false.**

**Change:** add `https://api.open-meteo.com` to `connect-src` in `_headers`, and
replace the empty catch with a distinct "forecast unavailable" state that is
visibly different from "beyond forecast".

### HIGH — three location stores, and the Advisor reads the one nobody writes

- `SB_ScoutBook_v1` — `locations/index.html:119`. The real Scout Book: address,
  scenes, parking, power, load-in, **hospital + hospitalAddress**,
  permitStatus, releaseStatus, IndexedDB photos.
- `SB_Locations_v1` — `production/production.js:128-145`. A separate Register:
  name, scenes, address, contact, permit, permitDate, notes.
- Consumers: `today/index.html:95` reads `SB_ScoutBook_v1`;
  `workflow/advisor-ui.js:53` reads **`SB_Locations_v1`**.

So a production that scouts entirely in the Location Scout Book — the module
built for it, the one with the photo board and the hospital field — is invisible
to the Advisor's prep-readiness check, which is what surfaces
`'prep: pending permits high severity'` (asserted at
`scripts/test_advisor.mjs:164`). The permit chip the user filled in never
reaches the readiness panel.

The two schemas also disagree on the same concept: `permit` (`Not needed |
Applied | Issued | Denied`) vs `permitStatus` (`none | applied | issued`) — no
`Denied` state on the Scout Book side, so a refused permit cannot be recorded
where the photos and hospital live.

Note also `locations/index.html:78` — *"The **nearest hospital** field feeds the
call sheet safety block"*. `hospital`/`hospitalAddress` exist only on
`SB_ScoutBook_v1`, which the Advisor does not read; I found no consumer wiring
it into a call sheet. That promise is currently unkept.

**Change:** make `SB_ScoutBook_v1` the canonical location record (it is the
richer schema), have `production/production.js` render it instead of its own
Register, and point `advisor-ui.js:53` at it with a read-time fallback to
`SB_Locations_v1` so existing owner data still counts. Neither key gets renamed.

### MED — two casting systems, and Cast Intelligence writes into the weaker one

- `SB_CastingDesk_v1` — `casting/index.html:128`. Roles with nested candidates,
  hold-date conflict detection, offer memo, Money Room commit on acct 1400.
- `SB_Roles_v1` + `SB_Candidates_v1` — `production/production.js:53,77`. Flat
  Registers, no conflict detection, no offer memo.

`production/production.js:456-463` — the Cast Intelligence "+ Add as candidate"
button writes to **`SB_Candidates_v1`**. So a researched actor lands in the flat
list and can never reach the pipeline that would catch a hold conflict or draft
their offer. `advisor-ui.js:52` reads `SB_Roles_v1` for the "roles still uncast"
signal (`test_advisor.mjs:163`), so the Casting Office's booked roles do not
count as cast.

**Change:** route "+ Add as candidate" into `SB_CastingDesk_v1` under the
selected role; have the Advisor read both keys and merge.

### MED — `matchHub` false positives put a shoot in the wrong country

`locations/lib-scout.js:437-448`. Measured:

```
permitFor("New London, Connecticut")  → London      (£ fees, Film London link)
permitFor("Vancouver, Washington")    → Vancouver   (CAD fees, BC portal)
permitFor("Los Angeles and New York") → New York    (last match wins, no break)
permitFor("LA, CA")                   → null        (alias needs an exact match)
permitFor("Ontario, California")      → null
```

Three causes: `lc.indexOf(hub) >= 0` at `:444` matches any substring, the loop
never breaks so the *last* match wins rather than the best, and `HUB_ALIAS`
(`:441`) is only consulted on an exact full-string equality.

Why it matters: a New London, CT production is shown a £500 road-closure fee
schedule, a 10-working-day borough lead time and an "Apply ↗" button to
Film London. It is confidently, silently wrong about jurisdiction — the one
thing this table exists to get right.

**Change:** score candidates and take the best rather than the last; require a
word boundary (`\bnew york\b`) rather than a bare substring; check aliases
per-token, not per-string; and return `null` on a tie so the UI falls back to
its honest "search out the local film office" message at `index.html:283`.

### MED — Dailies coverage compares printed scene numbers to positional indices

`dailies/lib-dailies.js:27-31` — `sceneList()` renumbers slugged scenes
`1..N` by position and **discards the number printed in the slugline**.
`coverageByScene` (`:126-143`) then matches those indices against
`num(t.scene) || parseSlate(t.slate).scene` — the number the AC actually chalked,
i.e. the script's printed scene number.

On a spec script numbered 1..N these agree. On a **locked shooting script** —
which is what exists by the time anyone is logging takes — they cannot: locked
scripts carry A-scenes (`12`, `12A`, `13`) and OMITTED scenes, so printed
numbers are non-contiguous. Coverage then reports scenes as un-shot that were
shot, and marks shot scenes against the wrong slug.

Why it matters: the coverage gap list is what a script supervisor checks before
releasing a location. A false gap sends a crew back; a false cover leaves a
scene unshot.

**Change:** capture the printed number in `splitScenes` (the regex at `:19`
already has the `(?:\d+[\s.]*)?` group — just capture it) and key coverage off
it, falling back to position only when the script is unnumbered.

### MED — no fetch in this codebase has a timeout, and no failure is cached

`grep -rn "AbortController"` across the repo returns **nothing**. The three
client-side third-party callers —
`production/production.js:399` (TMDB), `:409` (Wikidata),
`tools/sched-weather.js:120` (Open-Meteo) — all `await fetch()` bare. A hung
Wikidata endpoint leaves `"Researching <name>…"` (`production.js:472`) on screen
indefinitely with no cancel.

`js/learn.js:129-192` caches **successes only** (TTL 1 week, LRU-capped at 60→50
at `:184-188`). Nothing records a failure, so a down endpoint is re-hit on every
click with no backoff. And `cacheGet` returns `e.v` with **no timestamp** — the
Cast Intelligence card can render seven-day-old figures with no "as of" date
anywhere in `renderCard` (`production.js:423-467`).

**Change:** covered by the shared layer below.

### LOW — `production/lib-prod.js:143` residuals `pctOfGross` is not a % of gross

`base = svod + tv + avod + homeVideo * 0.2` (`:138`), then
`pctOfGross = total / base`. That is a percentage of the *royalty base*, not of
gross — they differ whenever `homeVideo > 0`, which is the only case the 20%
convention exists for. The UI at `production/production.js:379` correctly calls
it "Royalty base" and does not render `pctOfGross`, so nothing is currently
displayed wrong; the field name is a trap for the next caller.
**Change:** rename to `pctOfBase`.

### LOW — camera-report columns truncate real lens names

`dailies/lib-dailies.js:146-150` — `pad(s, w)` truncates to `w-1` plus `…`. The
LENS column is 9 wide (`:161`), so `"Zeiss 35mm"` prints as `"Zeiss 35…"` and
`"Cooke S4 32mm"` as `"Cooke S4…"` on the report handed to the DIT.
**Change:** widen LENS to 14, or measure the column from the widest value.

### LOW — `nextSlate` uses array order, not take order

`dailies/lib-dailies.js:59-67` takes `same[same.length - 1]` — the last-*entered*
row for that scene, not the highest take number. Correct for straight on-set
logging; wrong after any out-of-order correction.
**Change:** `Math.max(...same.map(t => num(t.take))) + 1`.

### LOW — unguarded `localStorage.setItem` on the Money Room commit paths

`locations/index.html:268` and `casting/index.html:347` write
`SB_Money_v1` with no `try/catch`, unlike every other write in both files
(`locations:127`, `casting:137`). On a quota error the exception escapes after
`CMoney.addPO` has already mutated the in-memory object, and the toast at
`:270`/`:348` never fires — the user is told nothing and believes the PO was
not booked, while a later successful write may persist it.

### LOW — `scheduledScenes` computed and never shown

`production/lib-prod.js:34,43` computes `scheduled` from the stripboard; it does
not appear in `dprText` (`:49-60`). Either render it ("scenes remaining on the
board") or drop it.

---

## What is missing entirely

### 1 · `CinSource` — the shared research/fetch layer (the assignment's brief). Value: HIGH

Every defect in the HIGH block above that involves a network call is the same
missing abstraction, re-implemented badly three times. Design:

**`js/lib-source.js`** — pure, node-testable, no DOM, no `fetch`. Builds request
descriptors, normalises replies into a `Sourced<T>` envelope, and formats
provenance and failure strings. This is where the tests live.

```js
Sourced<T> = {
  value:    T | null,
  status:   'ok' | 'cached' | 'failed' | 'blocked' | 'not-attempted' | 'unsupported',
  source:   'TMDB' | 'Wikidata' | 'Open-Meteo' | 'user' | 'estimate',
  fetchedAt: 1756... | null,     // ms epoch
  reason:   '',                  // 'HTTP 401 — check the key', 'timed out after 8s',
                                 // 'blocked by CSP', 'no TMDB key', 'source does
                                 // not carry billing order'
  searchUrl: ''                  // populated whenever value is null
}
```

Three helpers, all pure:
- `CinSource.provenance(s)` → `"TMDB · fetched 26 Aug 2026"` / `"estimated"` /
  `"Wikidata · cached 3 days ago"`. One string, one look, everywhere.
- `CinSource.failureText(s)` → the honest sentence to render *in place of* a
  value, never alongside a fabricated one. Modelled on the one path that
  already gets this right, `production/production.js:528`.
- `CinSource.unsupported(source, field)` → the distinction the quote estimator
  is missing: *this source does not carry this field* is not *this actor has no
  such credits*.

**`js/source-fetch.js`** — the thin DOM/network half:
- `AbortController` with a default 8s timeout (nothing in the repo has one today)
- one retry on a network error or 5xx with ~600ms backoff; **never** retry a 4xx
- delegates caching to `CLearn.cacheGet/cachePut`, but stores the envelope so
  `fetchedAt` survives — today `cacheGet` (`js/learn.js:129-135`) drops `e.t` on
  the floor, which is why no card can say "as of"
- **caches failures** with a short TTL (~2 min) so a down endpoint is not
  re-hit on every click
- returns `status:'blocked'`, distinct from `'failed'`, when the CSP rejects the
  connection — the Open-Meteo case, currently indistinguishable from "no data"

Keep the existing sanitisation: route everything through
`CLearn.cleanCached` (`js/learn.js:148-173`) on the way in. It is correct and
it is the reason `'unsafe-inline'` is survivable here.

**Every caller that should adopt it:**

| Caller | Today | What it gains |
|---|---|---|
| `production/production.js:393-404` TMDB | bare `await fetch`, no timeout | timeout, retry, `fetchedAt` on the card |
| `production/production.js:405-414` Wikidata | bare `await fetch`, no timeout | same, plus failure caching |
| `production/production.js:474` actor lookup | `catch (e) {}` → "check the spelling" | `status:'failed'` → the real reason |
| `production/production.js:489-493` director lookup | `catch (e) {}` → silent 36/100 | suppress the fit block, say why |
| `production/production.js:478-480` TMDB search | 3-second toast, then renders anyway | persistent in-card provenance |
| `production/lib-cast.js:190-213` `quote()` | invents a bracket from absent data | `unsupported('Wikidata','billing order')` |
| `production/lib-cast.js:135-176` `fit()` | scores against `[]` as if it were data | refuses to score without a director set |
| `tools/sched-weather.js:120-133` Open-Meteo | `.catch(){}` → "beyond forecast" | `'blocked'` vs `'failed'` vs real absence |
| `locations/index.html:280-303` permits | fixed disclaimer contradicting the data | `provenance()` off each record's `verified` |
| `locations/index.html:314-334` stages | one hardcoded "unverified" tag per hub | per-facility, matching `:324-326` |
| `js/project-badge.js:165,192` sync | bare fetch, no timeout | timeout + a real offline state |

Roughly 250 lines of pure logic plus 80 of fetch glue, one new
`scripts/test_source.mjs`, no new key, no framework, no dependency. It removes
more code from the callers than it adds.

### 2 · `CinScript` — one screenplay-scene primitive. Value: HIGH

The slugline regex is independently reimplemented in **at least twelve** places:
`timeline/parser.js:10,131,134`, `casting/lib-castdesk.js:13`,
`dailies/lib-dailies.js:19`, `locations/lib-scout.js:540,543`,
`production/lib-prod.js:110`, `music/lib-music.js:37`, `props/lib-props.js:120`,
`safety/lib-safety.js:92`, `clearance/lib-clear.js:50`,
`producer/schedule-board.js:51`, `js/budget-engine.js:279,361,370`,
`js/mastery-resolver.js:18`, `agents/normalizers.js:40,83,135`, `app.html` (×13).

The divergence has already produced a live defect: `production/lib-prod.js:110`
is the one copy missing the scene-number prefix, and that is exactly why sides
leak the whole screenplay. Every other module would have caught it.

Extract `splitScenes(text) → [{n, printedNumber, slug, body[]}]` and
`cueName(line)` — take both from `casting/lib-castdesk.js:13-73`, which is the
best implementation — into `js/lib-script.js`, add `printedNumber` (the fix the
Dailies coverage bug needs), and delete the eleven other copies over time.
Start with the four in my slice. ~90 lines, one test file, and it retires two
HIGH findings and one MED outright.

### 3 · A location record that carries its own coordinates. Value: MED

Not a new module — a schema addition that unblocks three things at once.
`blankLocation()` (`locations/lib-scout.js:524-533`) gains `lat`, `lon`, `tz`.
That single change lets the Scout Book call the correct `TSun.sunTimes`, lets
`tools/sched-weather.js` pull a per-location forecast instead of one typed
lat/lon for the whole schedule, and lets the call sheet compute travel time to
the hospital field that already exists at `:529`. Add the two inputs at
`index.html:168-171` and default them from the Advisor hub. Small, high leverage.

---

## Evidence

Files read in full: `production/lib-prod.js`, `production/lib-cast.js`,
`production/production.js`, `production/index.html`, `casting/lib-castdesk.js`,
`casting/index.html`, `locations/lib-scout.js`, `locations/index.html`,
`dailies/lib-dailies.js`, `tools/lib-sun.js`.

Read in part: `dailies/index.html:138-310`, `js/learn.js:120-212`,
`tools/sched-weather.js:100-160`, `tools/tools-media-ui.js:30-60`,
`tools/tools-money-ui.js:72-125`, `workflow/advisor-ui.js:40-80`,
`scripts/test_modules.mjs:88-118`, `scripts/test_advisor.mjs`,
`scripts/test_castoffice.mjs`, `_headers:1-80`, `netlify.toml:34-45`.

Executed against the real libraries (no mocks), scratch scripts under
`/tmp/claude-0/-home-user-shotb/1dbea9c1-2b21-5c42-a1f9-058830ed88f1/scratchpad/`:

- `sun.mjs` — `TSun.sunTimes` vs `CScout.goldenHour`, 4 cities × 2 solstices.
  Sunset deltas 37–100 min.
- `sides.mjs` — `CProd.sidesFor` vs `CCastDesk.sidesFor` on a numbered and an
  unnumbered script. Whole-script leak and substring false positives reproduced.
- `fit.mjs` — `CCast.fit` with and without a director filmography (36 vs 66);
  `CCast.quote` on the keyless path (capped at $25k–$150k); `CScout.permitFor`
  false positives; permit/stage field-length census.

Baseline: `node scripts/run_all_tests.mjs` → **44/44 suites passed**, before and
after. No file was edited.

**Line-number index of every claim:**
`production/lib-prod.js` 19, 27, 30, 34, 43, 49-60, 91-95, 106-118, 138, 143 ·
`production/lib-cast.js` 59-77, 79-94, 135-176, 190-213 ·
`production/production.js` 44, 53, 77, 110-113, 128-145, 146-153, 157-206,
220-226, 240-262, 308-327, 379, 393-414, 423-467, 468-506, 507-529, 528 ·
`production/index.html` 100 ·
`casting/lib-castdesk.js` 13, 39-52, 56-73, 87-109, 114-136, 141-161 ·
`casting/index.html` 128, 137, 241-249, 344-348 ·
`locations/lib-scout.js` 8-15, 23-421, 437-448, 480-505, 524-533, 540, 543 ·
`locations/index.html` 78, 101, 107, 112-114, 119, 127, 168-171, 268, 280-303,
314-334 ·
`dailies/lib-dailies.js` 15-31, 36-78, 81-92, 126-143, 146-150, 154-200 ·
`dailies/index.html` 142, 149 ·
`tools/lib-sun.js` 26-27, 33-62, 77-81 ·
`tools/sched-weather.js` 120, 133, 148-152, 157 ·
`tools/tools-media-ui.js` 37-48 · `tools/tools-money-ui.js` 72-77, 118-125 ·
`js/learn.js` 129-192, 148-173, 184-188 ·
`workflow/advisor-ui.js` 52, 53 · `today/index.html` 95 ·
`scripts/test_modules.mjs` 96 · `scripts/test_advisor.mjs` 163, 164 ·
`scripts/test_castoffice.mjs` 105-114 · `scripts/test_csv_injection.mjs` 82 ·
`_headers` 4.
