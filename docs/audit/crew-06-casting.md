# Casting Director

Verdict up front: **you can run a small session out of this, and you cannot run an
offer out of it.** Breakdown → roles board → sides → candidate pipeline → hold
conflict → offer memo is a real, working chain, and the sides parser is better
than most script tools I have used. But the moment money or a union touches the
work, it comes apart: the offer commits the wrong number to the wrong account,
the quote model states a fact it has no way to observe, and the actor you book is
never the same object as the character on the DOOD or the call sheet.

---

## What exists and works

- `casting/lib-castdesk.js:56` — `charactersFromScript()` genuinely extracts speaking
  roles: it requires an ALL-CAPS cue **followed by an actual line of dialogue**, strips
  `(V.O.)/(O.S.)/(O.C.)/(CONT'D)`, rejects sluglines and transitions, and returns lines
  + scene list per role. This is the correct definition of a speaking role, not a
  name-frequency count. 22 assertions cover it in `scripts/test_castoffice.mjs:50-82`.
- `casting/lib-castdesk.js:114` — `sidesFor()` returns only the scenes in which the
  character **speaks** (cue-verified, not name-mentioned), numbered, slugline + body,
  with a "verify against the current draft before sending" header baked into the text.
  Correct behaviour and correctly cautious.
- `casting/lib-castdesk.js:141` — `offerLetter()` prints `TBD` for every missing field
  and never fabricates a date, rate or rep. The non-binding / counsel-reviews /
  union-clearances-and-work-permits paragraph is in the body, not a footnote. This is
  the right posture for a generated offer memo.
- `casting/lib-castdesk.js:90` — `holdConflicts()` finds the same name held or booked
  on two overlapping date ranges across roles, and correctly ignores `submitted`
  candidates and rows missing either date. `casting/index.html:243` renders it in red
  above the candidate table with "resolve with the reps before booking."
- `casting/index.html:229` — self-tape links are gated on `^https?://` **and** passed
  through `CinUrl.safe()` before landing in an `href`. Given `'unsafe-inline'` in the
  CSP this is exactly right, and `js/safe-url.js:72` is a genuinely good implementation
  (control-char stripping, backslash refusal, credential-in-authority check).
- `casting/index.html:85` — "Contacts and self-tape links are whatever you paste in —
  nothing here is looked up or invented." Honest, and true of the module.
- `production/lib-cast.js:190` — `quote()` honours a user-entered `knownQuote` as an
  absolute override with basis `'Reported/entered quote — overrides the model'`. The
  escape hatch exists and the UI exposes it (`production/production.js:420`).
- `production/production.js:427` — when no TMDB key is present the card shows
  "no TMDB key — Wikidata data only". The caveat exists; see below for where it stops.
- `projects/lib-vault.js:23` — `LOCAL_ONLY = /^SB_(LocalGPU|TMDB)_v\d+$/i` keeps the
  TMDB key out of the cloud vault. The key never leaves the browser. Correct.
- `producer/schedule-board.js:148` — `doodMatrix()` implements the real SW / W / H /
  WF / SWF codes with correct span-vs-work-day arithmetic and a hold count. This is a
  proper Day-Out-of-Days, and `js/budget-engine.js:570` lets the board's real day
  assignments override the script-order approximation.
- `contracts/lib-deal.js:37` + `contracts/index.html:150` — marking a deal `signed`
  creates a Money Room PO exactly once, guarded by `d.committedPo`. The guard is right;
  the account it posts to is not (below).

---

## What exists but needs work

### HIGH — a cast offer commits the wrong amount to a non-existent account
`casting/index.html:340,346`

```js
var amount = parseFloat(String($('coOffRate').value).replace(/[^0-9.]/g, ''));
...
acct: '1400', amount: amount, ...
```

Two independent failures in four lines:

1. **The amount is one period, not the engagement.** The form has `coOffStart` and
   `coOffEnd` right above it (`casting/index.html:103-104`) and the memo prints
   "3500 per week" over an 18-day span — but the PO is `3500`. A six-week supporting
   deal commits 1/6 of its value. `contracts/lib-deal.js:55` gets this right
   (`rate × guaranteed + kit + perDiem × guaranteed`); the Casting Office has no
   guarantee field at all.
2. **Account `1400` does not exist.** The chart of accounts is
   `producer/budget-sheet.js:15-32`; Cast is **`4000`**. `finance/lib-money.js:68`
   falls unmatched accounts through to `'Unbudgeted · ' + acct` with `budget: 0`, so
   every cast offer lands on the cost report as a permanently over-budget phantom line
   while account 4000 · Cast shows zero commitments. There is no way to re-account an
   existing PO — `finance/index.html:106` only builds the dropdown for *new* manual POs.

There is also no dedupe: clicking Commit twice writes two POs, unlike the deal-memo path.

**Change:** post `rate × periods-between-start-and-end` (add a `Guaranteed` input next
to the rate), send it to `'4000'`, and store the returned `po.num` on the offer state so
a second click updates rather than duplicates. Bonus: `casting/index.html:116` tells the
user in prose that it commits "under acct 1400 (Cast)" — that string is wrong too.

### HIGH — Deal Memos charge cast to the Producers Unit
`contracts/lib-deal.js:15,61`

```js
var DEPT_ACCT = { cast: '2000', camera: '3000', 'g&e': '3000', grip: '3000', ... };
var acct = f.kind === 'cast' ? '2000' : '3000';
```

In `producer/budget-sheet.js:16-23`, `2000` is **Producers Unit** and `3000` is
**Direction**. So a signed cast agreement charges the producers' account and every crew
memo — camera, grip, sound, wardrobe — charges the director's. The bridge to the cost
report is real and works mechanically; it is aimed at the wrong rows. Cast should be
`4000`, and the whole `DEPT_ACCT` map needs remapping to the 5000/6000/7000/8000/9000/
10000/11000 chart the budget sheet actually publishes.

### HIGH — the quote model can only return two of its five tiers, and misstates why
`production/lib-cast.js:197-209`

The TMDB key is optional and the default path is Wikidata. `parseWikidataActor()`
(`production/lib-cast.js:79-94`) returns `{title, year, directors[], genres[]}` — **no
billing order, no popularity**. So on the default path:

- `leadish = recent.filter(f => f.order != null && f.order <= 2).length` is **always 0**
  (the field does not exist), and
- `pop` is **always 0**,

which pins `idx` at 1 forever. I ran it: a 40-credit, 21-recent-credit performer returns

```
Established supporting  $25,000 – $150,000
basis: ['21 credits in the last 6 years',
        'no recent top-billed roles found',
        'floor: SAG-AFTRA scale $1,204/day']
```

The same résumé through TMDB returns **A-list**. And that middle bullet is the real
problem: *"no recent top-billed roles found"* is stated as a finding about the performer
when the data source carries no billing field to look in. That is the difference between
"I don't know" and "I checked and the answer is no", and a casting director will carry
that line to a producer. **Change:** when the source has no `order` field at all, emit
`'billing data unavailable from this source — tier capped'` and cap the band with an
explicit "≥" rather than a closed range; when `popularity` is absent, say so instead of
letting a missing signal read as a low one.

Related, smaller: `TIERS[0]` is labelled `'Scale / day player'` but has
`low: SCALE.week` (`$4,181`) — a genuine two-day day-player part prices below the floor
of the band named after it (`production/lib-cast.js:184`).

### HIGH — the fit score claims a comparison that did not happen
`production/lib-cast.js:135-176`, `production/production.js:441,489`

`directorFilms` is only fetched `if (dirName && tmdbKey())` (`production/production.js:489`),
and the failure is swallowed by a bare `catch (e) {}` at `:493`. With no key, `df = []`,
so `overlap01()` returns 0 and the genre term contributes nothing — yet the card still
renders **"Fit with &lt;Director&gt; — 36/100"** under a gold progress bar
(`production/production.js:441-443`). I ran it: a 40-credit actor against an empty
director set scores **36/100** with the single reason "Recently active (2026)".

The honest line — `'No shared history found — a fresh pairing'` — is only emitted when
`reasons` is *empty* (`production/lib-cast.js:174`), so "Recently active" suppresses it
exactly when the data is thinnest.

The score composition is also weighted oddly for a casting decision:
`Math.min(af.length, 20)` gives up to 20 of 100 points for **filmography length alone**,
so a prolific character actor who has never met the director floors at 36 while a
perfect newcomer tops out near 17. **Change:** return a `confidence` field alongside
`score`, refuse to render the "Fit with X" heading when `directorFilms.length === 0 &&
direct === 0`, and surface the swallowed fetch errors at `:474` and `:493`.

### HIGH — the booked actor never reaches the DOOD or the call sheet
`producer/schedule-board.js:308`, `js/budget-engine.js:404`

`doodMatrix()` rows are keyed by **character name**, sourced from
`analysis.sceneCast` (`producer/schedule-board.js:71`), which is built at
`js/budget-engine.js:407` by regex-matching the character name anywhere in the scene
text. Nothing joins that to `SB_CastingDesk_v1`. Consequences:

- The call sheet's "Cast calls" table (`producer/schedule-board.js:308-310`) lists
  **MAGGIE / SW**, never *Ana Reyes*. There is one "General call" field
  (`:318`) and no per-cast call, pickup, makeup or on-set time, and no cast numbers.
- The hold dates a casting director gives the reps (`casting/index.html:232-233`) are
  never checked against the span the DOOD says the character actually works. A three-week
  hold on a character the board spreads over seven weeks is invisible.
- `js/budget-engine.js:407` matches the name as a whole word **anywhere in the scene**,
  so a character merely *talked about* in action counts as a work day, inflating the
  span you would size a deal against.

**Change:** put a `castAs` field on the role in `SB_CastingDesk_v1` (populated when a
candidate hits `booked`), and have `doodMatrix()` and `openCallSheet()` render
`character — actor` when the binding exists. That single join also unlocks a real cast
list and a contact sheet.

### HIGH — two disconnected casting systems, and the pipeline only sees the weaker one
`casting/index.html:128` vs `production/production.js:53,77`

- Casting Office → `SB_CastingDesk_v1` (roles, candidates, 7 statuses, holds, sides, offer)
- Production Office → `SB_Roles_v1` + `SB_Candidates_v1` (flat registers, cast intelligence)

They never read each other. `workflow/advisor-ui.js:52` reads **only** `SB_Roles_v1`, so
a casting director who works the Casting Office all week gets "N roles still uncast" from
the pipeline advisor forever. Worse, the two hold *complementary halves of one vocabulary*:
`casting/lib-castdesk.js:14` has `hold` and `released` but no **Pass**;
`production/production.js:84` has `Pass` and `Pin` but no hold dates. Neither is complete.
Add `app.html`'s `characterBible` (`app.html:5467`, a separate `projKey()` store) and
`SB_Timeline_v1.characters` and there are **four** places a character is named.

**Change:** make `SB_CastingDesk_v1` the single casting store, have the Production
Office's Cast Intelligence write candidates into it (`production/production.js:456` already
writes to `SB_Candidates_v1` — retarget it), and point the advisor at it. Do not rename
either key; read both and prefer the desk.

### MED — the sides in the Production Office are the wrong ones
`production/lib-prod.js:106-118`

```js
var blocks = String(scriptText).split(/\n(?=(?:INT|EXT|INT\/EXT|I\/E|EST)[.\s])/);
blocks.forEach(function (b) { var up = b.toUpperCase(); if (up.indexOf(name) < 0) return; ...
```

A raw substring match on the whole scene. Sides for **TOM** pull in every scene containing
`TOMORROW`, `ATOM`, `CUSTOM` or `BOTTOM`, plus every scene where the character is merely
mentioned in action. It is wired to the Studio character list at
`production/production.js:102` — so the *default* sides path in the app is the bad one,
while the good cue-verified implementation sits unused two directories away in
`casting/lib-castdesk.js:114`. **Change:** delete `CProd.sidesFor` and call
`CCastDesk.sidesFor`; keep the `CProd` export as a thin alias so nothing breaks.

### MED — the cue parser silently drops the day-player roles you most need
`casting/lib-castdesk.js:50`

`if (!/^[A-Z][A-Z0-9 .,'\-]*$/.test(s)) return null;` — no `#`, no accents, no
parentheses. Verified by running the library:

| cue | result | should be |
|---|---|---|
| `MAN #1` | `null` | MAN #1 |
| `COP #2` | `null` | COP #2 |
| `JOSÉ` | `null` | JOSÉ |
| `RENÉE` | `null` | RENÉE |
| `MAGGIE (INTO PHONE)` | `null` | MAGGIE |
| `MOMENTS LATER` | `'MOMENTS LATER'` | null |
| `CONTINUOUS` | `'CONTINUOUS'` | null |
| `FLASHBACK` | `'FLASHBACK'` | null |
| `FREEZE FRAME` | `'FREEZE FRAME'` | null |
| `ROLL CREDITS` | `'ROLL CREDITS'` | null |

Numbered cues (`MAN #1`, `COP #2`) are the standard form for exactly the day-player
roles that carry the most casting volume and the least attention. Accented names are
dropped outright. In the other direction, `NOT_CUES` (`casting/lib-castdesk.js:37`) is
missing `CONTINUOUS`, `MOMENTS LATER`, `FLASHBACK`, `FREEZE FRAME`, `WIPE`, `IRIS`,
`PRELAP`, `ROLL CREDITS`, `END CREDITS`. **Change:** add `#` and `À-ɏ` to the
charset, strip any trailing `(...)` wrylie rather than a fixed list, and extend
`NOT_CUES`. The page note at `casting/index.html:73` telling the user to prune is honest
but does not cover the false *negatives* — a role that never appears cannot be pruned back in.

### MED — SAG scale is stated three times with two different numbers
`production/lib-cast.js:182` · `contracts/lib-deal.js:13` · `js/budget-engine.js:216`

```
lib-cast.js:182     SCALE = { day: 1204, week: 4181 }
lib-deal.js:13      SAG_SCALE = { day: 1204, week: 4181 }   // "kept current in one place"
budget-engine.js:216  union: { day: 1246, week: 4326 }       // "SAG Basic"
```

The comment on `lib-deal.js:13` claims a single source of truth that does not exist —
the budget engine disagrees by ~3.5%, and `casting/index.html:57` and
`contracts/index.html:57` both print `$1,204/day · $4,181/week` to the user as fact.
`js/budget-engine.js:85` also cites `$1,246`. A casting director quoting scale into an
offer and a producer costing the same role off the top sheet get different floors.
**Change:** one exported constant, imported by all three, with the agreement year and
the tier it belongs to stamped next to it.

### MED — hold conflicts only see this production, and only exact-name matches
`casting/lib-castdesk.js:99`

Matching is `a.name.trim().toLowerCase() === b.name.trim().toLowerCase()`. "Ana Reyes"
vs "A. Reyes" vs "Ana Reyes (Gersh)" are three different people. More importantly the
conflict a casting director actually fears — a hold on *someone else's* picture — is
structurally unrepresentable: there is nowhere to record an external hold. And a
first-refusal with an open end date is skipped entirely, because `holdConflicts()`
requires **both** `holdFrom` and `holdTo` (`:92-93`) and says nothing when it skips.
**Change:** allow an open-ended hold (treat missing `holdTo` as +∞ and flag it as
"open-ended"), add an `External hold` candidate row type, and normalise names before
comparison.

### LOW — the roles board and candidate list cannot leave the browser
`casting/index.html` has Copy/Download for sides and the offer memo, and nothing for the
board itself. `tools/tools-core.js:87` gives the Production Office registers a CSV export
(with correct `= + - @` prefixing at `:82`), but the Casting Office — the better data —
has none. "Send me the grid" is a daily ask. `csvCell()` already exists at
`production/lib-prod.js:92`; wiring a board export is an hour.

### LOW — cached research is presented as live
`production/production.js:396-403` caches TMDB and Wikidata responses through
`CLearn.cachePut` with the default TTL of one week (`js/learn.js:183`). Sensible
caching, but the card carries no "as of" date, so a six-day-old quote band looks freshly
fetched. Stamp `cacheGet`'s `t` onto the card.

### LOW — the Production Office tape link is not clickable
`production/production.js:83` stores `tape` in a `T.Register` field, and
`tools/tools-core.js` renders every field as a plain `<input>` with no `href` anywhere.
The Casting Office has the ▶ button; this one makes you copy-paste. (The upside: no URL
sink, so nothing to escape.)

---

## What is missing entirely

- **Audition session & tape management** — HIGH. There is no session object: no date,
  no time slots, no rounds, no reader, no multiple takes, no per-round notes (the
  `notes` field at `casting/index.html:235` is one string, overwritten each round), no
  shortlist, no share-with-director bundle. `selfTape` is a single URL. A casting
  director runs 40 people through a room in a day and needs to know *when* each was
  seen and *which* tape is round 2. Attach to `casting/` as a `sessions[]` array on
  `SB_CastingDesk_v1` with `{date, role, slots:[{candidateId, time, round, tapeUrl,
  note}]}`; the roles board already has the candidate ids to hang it on. Maybe 300 lines
  in `lib-castdesk.js` plus a fifth section on the page.

- **Avail / pin / first refusal, with an expiry clock** — HIGH. `STATUSES`
  (`casting/lib-castdesk.js:14`) jumps `test → offer → hold`. Real practice puts
  **pin**, **avail check** and **first refusal** between them, each with a date it
  expires, because an unexpired avail is a promise you are holding on someone else's
  time. `production/production.js:84` has a `Pin` verdict but no dates. Attach to
  `casting/lib-castdesk.js`: extend `STATUSES`, add `holdKind` (`pin` | `avail` |
  `first-refusal` | `hard-hold`) and `expiresOn`, and have `boardSummary()` count
  expiring-today. Small change, high daily value.

- **SAG-AFTRA agreement tier** — HIGH. Nothing anywhere records which agreement the
  picture is signatory to. Basic / Modified Low Budget / Low Budget / Ultra Low Budget /
  Short / New Media / Student each set different minimums, overtime, turnaround,
  travel and BG ratios — they determine what an offer can legally *say*.
  `js/budget-engine.js:214` has a three-tier `PERFORMER_RATES` shim
  (`nonunion / hybrid / union`) buried in a budget calculation, which is the closest
  thing. Attach to `casting/` as a production-level setting that flows into
  `offerLetter()` and `contracts/lib-deal.js:castDefaults()`, replacing the hardcoded
  `union: 'SAG-AFTRA'` at `contracts/lib-deal.js:30`. Medium build, and it is the
  precondition for the offer memo being trustworthy at all.

- **Minors: permits, hours, studio teacher, trust account** — HIGH (legal). The only
  trace of a child performer in the entire platform is a budget keyword driver
  (`js/budget-engine.js:234`) and the phrase "work permits" inside the offer boilerplate
  (`casting/lib-castdesk.js:158`). Missing: per-minor work permit number and expiry,
  age-banded permitted work hours, school hours and studio-teacher requirement per shoot
  day, guardian on set, and the Coogan/trust account acknowledgement. Booking a minor
  without these is not a workflow gap, it is an enforcement exposure. Attach to
  `casting/` (a `minor: {dob, permitNo, permitExpiry, guardian}` block on the candidate)
  and surface it on the call sheet in `producer/schedule-board.js:300`, which already
  knows which cast work which day. `safety/lib-safety.js` is the model for how this
  platform expresses a compliance rule.

- **Background casting and stand-ins** — HIGH. BG exists only as an integer
  (`producer/schedule-board.js:312` renders `+N BG` on the call sheet, and
  `js/budget-engine.js:641` costs `extrasDays × $120–270`). There is no BG breakdown per
  day, no skills/wardrobe/vehicle notes, no voucher tracking, no SAG-covered-vs-non-union
  split, and **no stand-ins, photo doubles, stunt doubles or utility** anywhere in the
  repo (verified by grep). Stand-ins are booked by the casting department and are on set
  every day. Attach as a `background` section in `casting/` keyed to the stripboard day
  numbers that `SB_ScheduleBoard_v1` already publishes.

- **The breakdown itself** — MED/HIGH. The platform can find the roles but cannot
  *release* them. There is no breakdown document: role name, size (Lead/Supporting/Day
  player/Featured), age range, gender, ethnicity, physical notes, the shoot dates from
  the DOOD, rate and agreement tier, union status, submission instructions, and the
  nudity / intimacy / stunt / smoking / animal flags a rep must be told before submitting.
  `app.html:5347-5363` (`CHAR_ATTRS`) has age, gender, ethnicity, height, build, hair and
  eyes — genuinely breakdown-shaped fields — but they exist to compose a Flux image
  prompt (`app.html:5409`) and live in a store the Casting Office cannot see
  (`app.html:3356`). Attach: a `breakdownText(role)` in `casting/lib-castdesk.js` next to
  `offerLetter()`, reading the character bible where available. Cheap, and it is the
  first artifact of the job.

- **Deal terms beyond a rate** — MED. `offerLetter()` carries rate, dates and billing.
  A real offer negotiates guarantee, overtime and 6th/7th day, travel and per diem,
  looping/ADR days, exclusivity and options, dressing room, nudity rider, credit
  position and size, and favored nations. `contracts/lib-deal.js:29` has `guaranteed`,
  `otTerms`, `kitFee`, `perDiem` and `credit` — the fields exist in the wrong module and
  the two never meet. Attach: have `casting/index.html`'s Commit button hand the offer to
  `CDeal.addDeal()` instead of writing its own PO, which fixes the amount bug, the
  account bug and the missing terms in one move.

- **Chemistry reads** — MED. A chemistry read is a *pair*, not a candidate.
  `STATUSES` has `test` but nothing models "read A against B for the other role", which
  is how leads get cast. Attach to the sessions object above as a `pairs[]`.

- **Availability calendar** — MED. Availability is two date inputs per candidate
  (`casting/index.html:232-233`). No blackout dates, no travel days, no
  known-conflict-elsewhere, and no view of a role's candidates laid over the shoot
  window. The stripboard already renders a day grid (`producer/schedule-board.js`) — the
  same rendering over candidate holds would answer "who can actually do these dates"
  at a glance.

- **Cast list / contact sheet** — LOW/MED. Once `castAs` binds actor to character there
  is an obvious one-page output — character, actor, agent, contact, deal status, work
  days, hold dates — that every department asks for weekly. Nothing produces it today.

---

## Evidence

Files read in full: `casting/lib-castdesk.js`, `casting/index.html`,
`production/lib-cast.js`, `production/lib-prod.js`, `production/index.html`,
`contracts/lib-deal.js`, `contracts/index.html`, `js/safe-url.js`,
`scripts/test_castoffice.mjs`, `scripts/test_advisor.mjs`, `docs/audit/BRIEF.md`.

Read in part: `production/production.js:1-130,383-552`;
`producer/schedule-board.js:1-200,296-344`; `js/budget-engine.js:380-439,540-649`;
`finance/lib-money.js:50-94`; `finance/index.html:104-123`;
`producer/budget-sheet.js:15-36`; `app.html:5316-5515,3356-3357`;
`tools/tools-core.js:80-146`; `js/learn.js:129-183`; `projects/lib-vault.js:15-23`;
`today/index.html:85-126`; `workflow/advisor-ui.js:52`.

Claims verified by execution, not by reading:

- `node -e` against `casting/lib-castdesk.js` — the `cueName()` table above. `MAN #1`,
  `COP #2`, `JOSÉ`, `RENÉE`, `MAGGIE (INTO PHONE)` all return `null`; `MOMENTS LATER`,
  `CONTINUOUS`, `FLASHBACK`, `FREEZE FRAME`, `ROLL CREDITS`, `PRELAP` all return a name.
- `node -e` against `production/lib-cast.js` — a 40-credit / 21-recent-credit Wikidata
  résumé returns `Established supporting $25,000–$150,000` with basis
  `'no recent top-billed roles found'`; the identical résumé with TMDB `order` and
  `popularity: 70` returns `A-list`. `fit()` with `directorFilms: []` returns `36/100`
  with the sole reason `'Recently active (2026)'`.
- `grep` across `**/*.{js,html}` for `work permit|studio teacher|Coogan|child actor|
  minor performer|guardian` — only `js/budget-engine.js:234`,
  `timeline/timeline-budget.js:237` and `casting/lib-castdesk.js:158`.
- `grep` for `intimacy|nudity|stunt double|stand-in|photo double|background actor|
  extras casting` — no casting-department hits; the only matches are
  `workflow/advisor.js:130` (a staffing line item) and unrelated prose.
- `grep -l` for `SB_CastingDesk_v1|SB_Candidates_v1|SB_Roles_v1` — exactly three files:
  `casting/index.html`, `production/production.js`, `workflow/advisor-ui.js`.

Aside, not a casting finding: `node scripts/run_all_tests.mjs` reports **43/44** in this
sandbox, failing `set3d browser`. That suite passes standing alone
(`node scripts/test_set3d_browser.mjs` → `32 passed, 0 failed`), so it looks like a
runner timeout in this environment rather than a real regression. I edited nothing.
