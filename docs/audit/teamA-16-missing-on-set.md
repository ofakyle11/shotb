# TEAM A DEV 16 — what is missing for running the day on set

Domain: the day itself — the call sheet the crew works from, the log of what
actually happened, the media that came off the cameras, and the paperwork that
proves it. I checked every item my assignment named before claiming it missing;
where a thing exists under another name I say so and give it credit.

**Search log — what I looked for and where it actually lives.**

| Asked to check | Verdict | Where I looked |
|---|---|---|
| Lined script / facing pages | **absent** | `grep -ri "lined script\|lining\|facing page"` → one hit, a crew-role string at `workflow/advisor.js:122`. Already the headline of `crew-14`; cross-referenced below, not re-derived. |
| Take logs / circled takes | **exists, good** | `dailies/lib-dailies.js:36-123`, `dailies/index.html:179-252`, second logger at `tools/tools-media-ui.js:19-81` |
| Screen direction / eyeline | **1/4 exists** | a `direction` select at `production/production.js:167`; no eyeline, no shot-side. Owned by `crew-14`. |
| Timecode & sync | **fragmented** | four private TC helpers, no project fps, no validation — see MISSING 8 |
| Camera reports | **exists** | `dailies/lib-dailies.js:154-178`, register at `production/production.js:181-193` |
| Sound reports | **exists, no channel map** | `dailies/lib-dailies.js:179-200`, register at `production/production.js:194-205` — see MISSING 7 |
| DIT / data wrangling | **absent as a role** | `grep -n "\bDIT\b"` → two prose lines only (`dailies/index.html:117`, `dailies/lib-dailies.js:176`) |
| Media offload + checksum | **exists, leaves no record** | `tools/lib-media.js:86-132` + `tools/tools-media-ui.js:84-143` — see MISSING 4 |
| Walkie channel plan | **absent** | `grep -ri walkie` → `locations/lib-scout.js:516`, `props/lib-props.js:101`, `safety/lib-safety.js:48`. All prose. |
| Digital call sheet + confirmations | **half exists** | sheet at `producer/schedule-board.js:300-344`, phone view at `today/index.html:81-136`, manual confirm log at `tools/tools-registers.js:47-64` — see MISSING 3 |
| On-set safety sign-offs | **absent** | `safety/lib-safety.js:306` reserves `ack:{}` and nothing ever writes it — see MISSING 5 |
| Daily production report | **exists, disconnected** | `production/lib-prod.js:21-60` — see NEEDS WORK 1 and MISSING 2 |

---

## What exists and works

- `dailies/lib-dailies.js:45-78` — bijective base-26 slate arithmetic;
  `nextSlate` gives take+1 on the same scene, `nextSetup` walks 12A→12B→…→12AA.
  This is the one piece that behaves exactly like a 2nd AC's chalk.
- `dailies/lib-dailies.js:154-200` — camera and sound report text that mirrors
  the paper forms, circles marked `●`, NG reason bracketed, and an honest
  footer telling you to cross-check the AC's and mixer's own sheets. Correct
  professional posture, and rare to see coded.
- `dailies/index.html:78-97,130-133` — 52px inputs and a sticky `+ TAKE` /
  `● CIRCLE` bar. Genuinely one-handed on a set, which is the real constraint.
- `tools/lib-media.js:88-127` + `tools/tools-media-ui.js:94-142` — per-file
  SHA-256 in WebCrypto, an MHL-shaped XML sidecar, and `verifyAgainst()`
  returning ok/changed/missing/extra with a `clean` flag. The checksum
  verification my brief asked about is real and it runs entirely in the
  browser. Its only defect is that it persists nothing (MISSING 4).
- `tools/lib-money.js:19-111` — union timecard engine: 1.5× after 8 worked,
  2× after 12 *elapsed*, 3× after 15 elapsed, escalating meal penalties in
  half-hour steps, turnaround invasion priced against the hourly, 6th/7th-day
  multipliers, fringes. The elapsed-vs-worked distinction at `:59-62` is the
  detail most home-grown calculators get wrong. This is the strongest piece of
  on-set arithmetic in the repo.
- `producer/schedule-board.js:300-344` + `producer/producer.css:99,135-139` — a
  per-day call sheet that really does print to a clean white PDF: title, day,
  date, general call, scene table with pages and D/N, cast status from the
  DOOD, location names, notes.
- `today/index.html:81-136` — the phone view of that day, and the only place on
  the platform that pulls the nearest hospital onto the sheet
  (`:94-106`, from `SB_ScoutBook_v1`) and renders the day's safety bullets from
  `CSafety.meetingChecklist` (`:107-112`). Small, correct, and the right idea.
- `tools/sched-weather.js:93-156` — every shoot day gets its calendar date,
  sunrise, both golden hours, sunset, daylight hours and a live Open-Meteo
  forecast with a shoot-risk score. Keyless, browser-side, no dependency.
- `safety/lib-safety.js:147-158` — `meetingChecklist(analysis, sceneNumbers)`
  produces the morning briefing bullets for exactly today's scenes.
- `tools/tools-registers.js:47-64` — `SB_CallDist_v1`, a per-recipient log of
  sent/opened/confirmed/no-response/bounced with an "N unreached" chip. The
  *record* of confirmation exists; the *loop* does not (MISSING 3).
- `tools/tools-core.js:58-161` — the `Register` engine. Schema-driven CRUD,
  localStorage, expiry chips, CSV export with `= + - @` neutralised at `:82-85`.
  Any register-shaped gap below is nearly free because of this.

## What exists but needs work

1. **HIGH — the Daily Production Report reads two stores that nothing writes,
   so its two headline numbers are fiction.** `production/lib-prod.js:27`
   filters takes on `t.date`; `:30` counts printed takes on
   `t.status || t.print`. There are exactly two take stores on the platform and
   neither has those fields: the Dailies logger writes `SB_Dailies_v1` with
   `{day, scene, slate, take, circled, …}` (`dailies/lib-dailies.js:81-92`,
   written at `dailies/index.html:189`) and the DPR never opens that key at
   all (`production/production.js:219-226`); the Tools slate writes
   `SB_TakeLog_v1` rows of `{time, scene, take, roll, grade, note}`
   (`tools/tools-media-ui.js:38-46`) which have no `date`, so `!t.date` is
   always true and **every take ever logged is counted on every report date**,
   and no `status`/`print`, so **`printedCount` is permanently 0**. The unit
   test passes because it invents a third shape that nothing produces
   (`scripts/test_modules.mjs:96`). Fix: read `SB_Dailies_v1.takes`, filter on
   `t.day`, count `t.circled`, and keep `SB_TakeLog_v1` as a secondary source.
   Roughly fifteen lines plus a test that uses a real store shape.

2. **HIGH — "the day" has three incompatible identities, and nothing
   reconciles them.** The stripboard's day is a 0-based integer index
   (`producer/schedule-board.js:107,364`); its human date is a hand-typed
   free-text `MM/DD` string (`:303,318`); the Dailies logger's day is a
   `yyyy-mm-dd` date with a unit (`dailies/index.html:160-166`); the timecard
   register's day is a `yyyy-mm-dd` date (`tools/tools-money-ui.js:74`); and
   `SB_ShootPlan_v1` can already compute the true calendar date of shoot day N
   including the weekend rule (`tools/sched-weather.js:34-43,104-113`) but
   nobody asks it. The visible consequence is `today/index.html:71-79`, which
   has to *guess* which day is today by string-matching `new Date()` against
   that hand-typed `MM/DD` in two formats and silently falls back to Day 1.
   This is the root cause of most of the missing items below — see MISSING 1.

3. **MED — the call sheet ignores the location record that already holds what a
   call sheet needs.** `producer/schedule-board.js:307,323` derives location
   *names* by string-slicing sluglines, while `locations/lib-scout.js:524-532`
   already stores `{address, hospital, hospitalAddress, parking, power, loadIn}`
   per location. `today/index.html:94-106` does reach for it, with a fuzzy
   8-character name match that will misfire. Wire the scout record to the sheet
   properly (a `locationId` on the strip beats fuzzy matching) and the address,
   parking, load-in and hospital block come for free.

4. **MED — sun and weather stop at the schedule tab.** `sched-weather.js`
   computes sunrise/sunset/golden/forecast per shoot day and writes it nowhere;
   the call sheet (`schedule-board.js:314-328`) and the phone view carry
   neither. Sunrise and sunset are on every real call sheet because they decide
   when the day starts and when you lose the light.

## What is missing entirely

### 1. A shoot-day record — the spine everything on set hangs off. Value: HIGH (small build, unlocks 2–5)

**What it is.** One canonical object per shooting day: `Day N` ↔ calendar date ↔
unit (MAIN / 2ND / SPLINTER) ↔ status (scheduled / shot / cancelled / weather
day). Every other on-set artifact keys off it.

**Why a production needs it.** Right now the stripboard, the take log, the
timecards, the phone call sheet and the DPR each hold a different notion of
"the day" (NEEDS WORK 2). Nothing can answer "what did we shoot on Day 12" in
one hop, and the phone view guesses. A second unit makes it worse: Dailies has
a unit selector (`dailies/index.html:73-76`) that the stripboard, call sheet
and DPR know nothing about, so 2nd-unit takes silently pollute main-unit
numbers.

**Attach to.** `producer/schedule-board.js` owns day indices; `SB_ShootPlan_v1`
owns the calendar. Put the derivation in a new pure `producer/lib-days.js`.

**Data model.** `SB_ShootDays_v1`:
`{v:1, days:[{n:0, date:'2026-09-14', unit:'MAIN', status:'scheduled', locationIds:[]}]}`
seeded by walking `SB_ShootPlan_v1.date` forward with the existing weekend rule,
then editable. Note the sync gate: `netlify/functions/projects-sync.js:227`
only accepts keys matching `/^SB_[A-Za-z0-9]+_v\d+$/`, so `SB_ShootDays_v1` is
fine and `SB_Shoot_Days_v1` would be silently dropped.

**Size.** Small — one pure module (~80 lines), a `scripts/test_days.mjs`, and
replacing three ad-hoc day lookups. Do not rename `dayMeta`; derive from it.

### 2. The AD's day log, and a DPR that is actually the document. Value: HIGH

**What it is.** The time log of the day — general call, crew call by
department, first shot, meal out and in, first shot after lunch, second meal,
camera wrap, crew wrap — plus company moves, background count, weather at call,
and the incident line. Then the report those numbers make: scenes and pages
**scheduled vs shot**, setups, takes, circled takes, minutes of screen time,
and cumulative **days and pages ahead or behind**.

**Verified missing.** `grep -ri "first shot\|camera wrap\|pages shot\|company
move\|ahead of schedule"` across all `*.js`/`*.html` returns nothing but one
code comment at `producer/schedule-board.js:91`. `lunch` appears only as a props
keyword (`props/lib-props.js:101`). The current `dpr()` returns six fields —
scenes covered, take count, printed count, crew on cards, hot cost, scheduled
scenes (`production/lib-prod.js:35-46`) — and `dprText()` renders eight lines
(`:49-60`). No producer or completion bond would accept that as a DPR.

**Why a production needs it.** The DPR is the daily legal and financial record
of the shoot: it is what the completion bond, the insurer, the payroll company
and the investor's cost report all read. "Ahead or behind" is the number that
decides whether you drop a scene tomorrow. And the time log is the *input* to
things this platform already computes but currently makes you re-type by hand —
`tools/lib-money.js:47` needs `call` and `wrap` per person, and its turnaround
invasion at `:94-100` needs yesterday's wrap, which nothing stores.

**Attach to.** `production/lib-prod.js` (the DPR engine) + a new pane in
`production/production.js` next to `PANES.dpr`; the day-log capture screen
belongs in `dailies/` or `today/` where the phone already is.

**Data model.** `SB_DayLog_v1`:
```
{v:1, days:{ '2026-09-14': {
  unit:'MAIN', call:'07:00', crewCall:{Camera:'06:30', G&E:'06:00'},
  firstShot:'08:12', meals:[{out:'13:04', in:'13:34'}],
  firstShotAfter:'13:51', cameraWrap:'19:40', crewWrap:'20:15',
  moves:[{at:'14:20', from:'DINER', to:'ROAD'}],
  weather:'overcast 14°', bg:12, notes:'', incidents:['i7f3a91']
}}}
```
Scheduled-vs-shot needs no new data: pages scheduled are already on the strips
(`schedule-board.js:76-87`, `eighths` + `day`), pages shot are the strips whose
scenes appear in the take log, and setups are distinct slates per scene in
`SB_Dailies_v1`.

**Size.** Medium. `dayLog()` + `dayProgress()` + a rewritten `dpr()`/`dprText()`
in `lib-prod.js` (~200 lines of pure logic), one capture pane, one report pane,
`scripts/test_dpr.mjs`. Fix NEEDS WORK 1 in the same pass — same function.

### 3. The call sheet as a real document, with a confirmation loop. Value: HIGH

**What exists** (credit first): a printable per-day sheet with scenes, pages,
D/N, DOOD cast status, location names and notes
(`producer/schedule-board.js:300-344`), a phone view with hospital and safety
bullets (`today/index.html`), and a manual distribution register
(`tools/tools-registers.js:47-64`).

**What is missing from the document.** Verified by reading
`schedule-board.js:314-328` and `today/index.html:115-135` line by line:

- **Individual cast calls.** The sheet prints only the DOOD letter — `SW`, `W`,
  `H` (`:308-310`). No pickup, makeup, wardrobe, rehearse or on-set time per
  performer. A cast member cannot tell from this sheet when to be anywhere.
- **Department crew calls.** `grep -ri "crew call"` → nothing. `SB_Crew_v1`
  already carries `dept` (`tools/tools-registers.js:33`), so the grouping is
  free.
- **Meal times.** Nothing. The meal is the second most-read line on a call sheet
  and drives the meal penalty `tools/lib-money.js:80-90` already prices.
- **Sunrise / sunset / weather.** Computed one tab away and never carried
  (NEEDS WORK 4).
- **Basecamp, parking, load-in, nearest hospital.** All present per location in
  `locations/lib-scout.js:529-530` and not on the sheet (NEEDS WORK 3).
- **Advance schedule.** `grep -ri "advance schedule\|tomorrow"` → nothing. The
  "tomorrow" block is what lets a department head prep.
- **Revision letter/date.** No `rev` field anywhere on `dayMeta`
  (`schedule-board.js:303`). On a real show a white sheet becomes blue becomes
  pink, and people die of shooting from the wrong colour.
- **Walkie channels** — see MISSING 6.

**What is missing from the loop.** `SB_CallDist_v1` rows are typed by hand and
have no link to the day they belong to beyond a free-text `day` string
(`tools-registers.js:51`), no link to `SB_Crew_v1`, and no way to mark
"published". So the sheet and the record of who got it are two unrelated lists.

**Attach to.** A new pure `producer/lib-callsheet.js` — note there is currently
**no `lib-*.js` for the producer schedule at all**; `schedule-board.js` mixes
model and DOM in one file, which is why its call-sheet half has no node test.
Extract the document model there, keep the DOM in `schedule-board.js`, render
the same model in `today/index.html`.

**Data model.** Extend `SB_ScheduleBoard_v1.dayMeta[d]` in place (never rename
it — live owners have data under it) with
`{rev:'', published:'', castCalls:{NAME:{pickup,mu,set}}, deptCalls:{Camera:'06:30'},
meals:[{at:'13:00', kind:'lunch'}], walkie:[], basecamp:'', advance:''}`. Push
confirmations into the existing `SB_CallDist_v1` with a `dayN` field so
"publish" seeds one row per crew member.

**Size.** Medium. This is the single document the whole crew runs the day from,
and the platform is about 40% of the way there.

### 4. Media card register — the offload record of truth. Value: HIGH

**What is missing.** The verification math is done and correct
(`tools/lib-media.js:88-127`) but **nothing is persisted**: in
`tools/tools-media-ui.js`, `lastEntries` and `loadedManifest` are function-local
(`:93`), the manifest XML is handed to a download link and forgotten
(`:113-122`), and the pass/fail summary is written into innerHTML (`:135-142`).
There is no `SB_*` key for it anywhere — I checked the full key list. So the
platform can *prove* a copy is bit-perfect and cannot *remember* that it did.

**Why a production needs it.** Reformatting a card that was never verified is
the one irreversible mistake available on a set — the footage is simply gone.
The question a DIT is asked ten times a day is "is A007 clear to format?", and
answering it requires a durable record: two destinations, both verified, a
timestamp, and a name against it. Second: no take on this platform records
which *camera* card it lives on. `makeTake` has `soundRoll`
(`dailies/lib-dailies.js:90`) and no camera roll, so the path from a circled
take to a file does not exist.

**Attach to.** A DIT tab in `dailies/` (where the shoot day and takes already
live) reusing `TMedia.manifestXml`/`parseManifest`/`verifyAgainst` unchanged.

**Data model.** `SB_MediaCards_v1`:
```
{v:1, cards:[{ id:'A007', kind:'camera', camera:'A', dayN:11, date:'2026-09-14',
  files:0, bytes:0, manifestSha:'', dests:[{label:'RAID', verifiedAt:'', clean:true},
  {label:'shuttle', verifiedAt:'', clean:true}], clearedToFormat:false,
  clearedBy:'', scenes:['12','12A'] }]}
```
Plus a `cardId` field on `makeTake` so a take resolves to a card.

**Size.** Small-to-medium — a register plus ~60 lines wiring the existing hash
pipeline into it, and a rule that `clearedToFormat` cannot be set until two
destinations report `clean`. The engine is already written and already tested.

### 5. Safety sign-off and attendance for the day. Value: MED-HIGH

**What is missing.** `safety/lib-safety.js:306` returns
`{v:1, incidents:[], ack:{}}` — the `ack` slot is reserved and **never read or
written by any file in the repo** (verified across `safety/index.html`,
`today/index.html`, `production/`, `scripts/`). The meeting checklist renders as
inert `☐` text with no state, at `safety/index.html:103` and
`today/index.html:133`. So there is no record that a safety meeting happened,
who was at it, or which specialist confirmed which control.

**Why a production needs it.** After an incident, the attendance sheet and the
signed briefing are the first documents requested, by the insurer and by anyone
else who asks. Firearms, stunts, minors and animal work each require a specific
acknowledgement from the people involved, not a generic one.

**Note on overlap:** `crew-15` correctly calls for a signature block on the
*risk assessment document*. This is the different artifact: the *per-day,
per-person* record on set. Both are needed; they are not the same item.

**Attach to.** `safety/` (capture and export) + `today/` (the phone, where the
crew actually is). Write into the existing `ack` slot rather than adding a key:
`ack:{'2026-09-14': {meetingAt:'07:10', led:'1st AD', present:['…'],
items:{'sc12-weapons':{by:'Armorer', at:'07:14'}}}}`.

**Size.** Small. No signature-capture primitive exists anywhere on the platform,
so keep it to typed name + timestamp + device — honest, and defensible — rather
than pretending a canvas scribble is a signature.

### 6. Walkie / comms channel plan. Value: MED

**Verified missing:** `walkie` appears three times in the repo and all three are
prose — `locations/lib-scout.js:516` (cell coverage changes the walkie plan),
`props/lib-props.js:101` (a prop keyword), `safety/lib-safety.js:48` (a briefing
line). No channel model, no assignment, no count.

**What a production needs.** The channel card that prints on the call sheet —
1 production, 2 camera, 3 G&E, 4 art, 5 transpo, plus which channel is the
emergency channel — and the radio count per department (which is also a rental
line). On a location with dead cell zones this is the only comms plan there is.

**Attach to.** The call sheet document model in MISSING 3; store as
`dayMeta[d].walkie`. Do not build a separate module.

**Note on overlap:** `crew-13` correctly folds RF *frequency* coordination
(radio mics, intermod, TV-band exclusions) into a proposed `locations/lib-rf.js`.
That is the bigger engineering job and it should own frequencies. This item is
just the channel-assignment card, and it should live on the call sheet whether
or not the RF module is ever built.

### 7. Sound report channel / track map. Value: MED

**What exists:** a roll/scene/TC/mics register (`production/production.js:194-205`,
`mics` is one free-text field) and a printed sound report with roll, TC and
notes (`dailies/lib-dailies.js:179-200`).

**What is missing:** the per-track channel assignment — track 1 boom, 2 lav
EDIE, 3 lav HANK, 4 mixdown-L — which is the thing an assistant editor and a
sound editor read to know what is on the file. Also no mixdown-vs-ISO
distinction and no track count. `grep -ri "channel map\|ISO track"` → nothing.

**Attach to.** `dailies/` — a `tracks:[]` array on the take or, better, on the
sound roll, printed by `soundReport()`.

**Note on overlap:** `crew-13` claims room tone / wild tracks and boom-vs-lav
continuity. The channel map itself is unclaimed and is the cheaper half.

### 8. Timecode discipline — a project frame rate and one shared TC module. Value: MED

**What is missing.** `tcIn` on a take is free text run through `str()` and
nothing else (`dailies/lib-dailies.js:90`, input at `dailies/index.html:87`) —
`10:14:22:07`, `101422:07` and `banana` are equally acceptable. There is **no
project frame rate** outside the Editor's own `SB_Cut_v1.fps`; `grep -rn fps`
across `timeline/ dailies/ producer/ production/ js/` finds only local
`fps || 24` defaults. Drop-frame does not exist as a concept — the only mention
is the string `FCM: NON-DROP FRAME` hardcoded into the EDL header
(`editor/lib-cut.js:144`), which is simply asserted regardless of rate. And four
private TC helpers have been written independently: `tools/lib-script.js:52,61`
(subtitle, comma-millis), `editor/lib-cut.js:131`, `screening/lib-screen.js:59,68`
(the only one that *parses*), `production/lib-prod.js:63`.

**Why a production needs it.** A take's TC is what pairs the sound file to the
picture file. If it is unvalidated text it will be wrong on the day it matters,
and at 29.97 the drop-frame question changes the answer by seconds per hour.

**Attach to.** A shared `js/timecode.js` (that directory already holds the
cross-module shared libs — auth, budget-engine, safe-url, config), with
`parse`, `fmt`, `add`, `diff`, `isValid`, drop-frame aware; a project `fps` on
the production record; a validity chip on the Dailies TC field; and a per-roll
TC continuity check (a take whose TC precedes the previous take on the same
roll is a red flag worth surfacing).

**Size.** Small-medium: ~120 lines plus `scripts/test_timecode.mjs`, then
migrate the four call sites opportunistically rather than in one sweep.

### 9. Lined script, facing pages, screen direction and eyeline — cross-reference, not a new claim

I verified all four are absent (`lined script` → one crew-role string at
`workflow/advisor.js:122`; `blankShot` at `boards/lib-shots.js:36-38` is
`{id,size,angle,move,lensMm,desc,img,dur}` with no side or eyeline; the only
screen-direction field on the platform is the unread select at
`production/production.js:167`). **`crew-14` already documents these in depth
with a build sketch and I am not going to double-count them in the synthesis.**
Recording the confirmation here so the two reports agree: they are missing, and
`crew-14`'s ranking of the lined script as the highest-value item in its domain
is correct.

---

## Ranked summary

| # | Gap | Attaches to | Key | Size | Value |
|---|---|---|---|---|---|
| 1 | Shoot-day record (Day N ↔ date ↔ unit) | `producer/lib-days.js` (new) | `SB_ShootDays_v1` | S | HIGH |
| 2 | AD day log + real DPR (sched vs shot, ahead/behind) | `production/lib-prod.js` | `SB_DayLog_v1` | M | HIGH |
| 3 | Call sheet as a document + confirmation loop | `producer/lib-callsheet.js` (new) | extend `dayMeta` + `SB_CallDist_v1` | M | HIGH |
| 4 | Media card / offload register | `dailies/` (DIT tab) | `SB_MediaCards_v1` | S-M | HIGH |
| 5 | Safety sign-off + attendance | `safety/` + `today/` | existing `SB_Safety_v1.ack` | S | MED-HIGH |
| 6 | Walkie channel card | call sheet model | `dayMeta[d].walkie` | XS | MED |
| 7 | Sound channel / track map | `dailies/lib-dailies.js` | on the sound roll | S | MED |
| 8 | Shared timecode module + project fps | `js/timecode.js` (new) | — | S-M | MED |
| — | Lined script / eyeline | see `crew-14` | — | — | (owned) |

Fixing NEEDS WORK 1 and 2 is a prerequisite for 2 and 3 and should ship in the
same change, not separately.

## Evidence

Files read in full: `docs/audit/BRIEF.md`,
`docs/audit/assignments/teamA-16.md`, `docs/audit/PROGRAM.md`,
`production/lib-prod.js`, `production/production.js`,
`dailies/lib-dailies.js`, `dailies/index.html`,
`producer/schedule-board.js`, `safety/lib-safety.js`, `today/index.html`,
`tools/lib-media.js`, `tools/tools-media-ui.js`, `tools/tools-registers.js`,
`tools/tools-core.js`, `tools/lib-money.js`, `tools/sched-weather.js`,
`boards/lib-shots.js`.

Files read in part: `safety/index.html:36-155`, `editor/lib-cut.js:128-167`,
`screening/lib-screen.js:55-84`, `tools/lib-script.js:52-95`,
`tools/tools-money-ui.js:72-97`, `locations/lib-scout.js:513-532`,
`producer/producer.css:99-139`, `scripts/test_modules.mjs:93-151`,
`netlify/functions/projects-sync.js:37,226-240`, `workflow/advisor.js:118-128`,
`dashboard.html:1455-1490`, `docs/audit/crew-13-production-sound.md`,
`docs/audit/crew-14-script-supervisor.md`,
`docs/audit/crew-15-stunts-safety.md`.

Specific line-level claims made above and verified by reading the line:
`production/lib-prod.js:27,30,35-46,49-60,63`;
`production/production.js:167,181-205,219-226`;
`dailies/lib-dailies.js:45-78,81-92,90,154-200`;
`dailies/index.html:73-76,78-97,87,130-133,149,160-166,189,308`;
`producer/schedule-board.js:76-87,91,107,300-344,303,307-310,314-328,364`;
`safety/lib-safety.js:48,147-158,306`; `safety/index.html:103`;
`today/index.html:71-79,81-136,94-106,107-112,115-135,133`;
`tools/lib-media.js:88-132`; `tools/tools-media-ui.js:19-81,38-46,84-143,93,113-122,135-142`;
`tools/tools-registers.js:33,47-64,51`; `tools/tools-core.js:58-161,82-85`;
`tools/lib-money.js:19-30,47-111,59-62,80-90,94-100`;
`tools/sched-weather.js:34-43,93-156,104-113`;
`tools/tools-money-ui.js:74`; `boards/lib-shots.js:36-38`;
`locations/lib-scout.js:516,524-532,529-530`; `props/lib-props.js:101`;
`workflow/advisor.js:122`; `editor/lib-cut.js:131,144`;
`screening/lib-screen.js:59,68`; `tools/lib-script.js:52,61`;
`producer/producer.css:99,135-139`; `scripts/test_modules.mjs:96`;
`netlify/functions/projects-sync.js:227`; `dailies/index.html:117` and
`dailies/lib-dailies.js:176` (the only two `DIT` occurrences in the repo).

Repo-wide greps run, with their results: `lined script`, `lining`,
`facing page` (1 hit, prose); `eyeline`, `screen direction` (1 hit, a select);
`checksum`, `md5`, `xxhash` (vendor PDF worker only); `MHL`, `offload`
(tools + landing copy); `walkie` (3 hits, all prose); `channel plan`,
`channel map`, `ISO track` (none); `\bDIT\b` case-sensitive (2 prose hits);
`data wrangl` (none); `genlock`, `jam sync`, `second sticks`, `tail slate`,
`23.976`, `dropframe` (none); `first shot`, `camera wrap`, `pages shot`,
`shoot day progress`, `crew call`, `advance schedule`, `castCall`,
`call time`, `sign-off`, `signoff`, `signature`/`initials` (none relevant);
`company move` (1 code comment); `lunch` (props keyword only);
`basecamp` (scout book only); full enumeration of every `SB_*` key in the repo,
cross-referenced against the file that reads and the file that writes each one.

Nothing above is asserted from a filename. I did not edit any file.
