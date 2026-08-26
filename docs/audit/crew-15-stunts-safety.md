# Stunt Coordinator & Safety Officer

Judged as the people responsible for nobody getting hurt, and for the paperwork
that has to survive an insurer, a film-office inspector and — in the worst case
— a coroner.

**Headline:** the safety module's *content* is real. A working stunt coordinator
would recognise the control measures in `safety/lib-safety.js` as the ones we
actually use. But the *machinery* around that content is not yet trustworthy:
the hazard detector fires HIGH on a woman burning toast and misses a knife
fight, the risk assessment has no likelihood, no residual risk and no signature
block, the safety meeting leaves no record, and the printed call sheet — the
document that actually gets distributed — carries no hospital, no medic and no
safety block at all. All of that is verified below by execution, not inference.

---

## What exists and works

- `safety/lib-safety.js:14-86` — eleven hazard families (weapons, stunts, fire,
  water, vehicles, heights, animals, night, crowds, electrical, aerial), each
  carrying a named responsible specialist and three-to-four control measures.
  The controls are not boilerplate. "No live ammunition on the premises — ever"
  (`:18`), "Cold/hot weapon announcements before each setup" (`:21`), "Safety
  boat and throw lines in position before rehearsal" (`:39`), "GFCI protection
  on all distribution near water/rain effects" (`:77`), "Never overfly
  unprotected cast or crowd" (`:84`). That is the language of the job. Whoever
  wrote this has been on a set.
- `safety/lib-safety.js:282-294` — `animalChecklist()` is the strongest single
  artifact in the module. Nine items that track the certified animal-safety
  monitoring standard: no sedation or tripping devices, take limits agreed with
  the coordinator *before rolling*, set rehearsed with stand-ins before the
  animal works, rest/water/shade holding area. This is publishable as-is.
- `safety/lib-safety.js:165-227` — paid-duty police. Honest by construction:
  only Toronto carries a verified program URL (`:167`); every other service is a
  name plus a Google lookup (`:196-200`), never an invented link. The estimator
  enforces the real 3–4 hour minimum call (`:219`) and an admin percentage.
- `safety/lib-safety.js:234-303` — animal department. Species day-rate bands,
  wrangler day rate applied across shoot *and* prep days (`:274`), optional vet,
  and exactly one directory entry the author could stand behind (`:298`).
  Reptile and exotic notes flag the jurisdictional bans (`:240-241`).
- `safety/index.html:202-211`, `:252-261` — paid-duty and animal estimates
  commit as real POs into the Money Room on the right accounts. Safety costs
  money, and this is the only place in the platform where a safety decision
  produces a financial commitment. That link is correct and valuable.
- `locations/lib-scout.js:517`, `:529`; `locations/index.html:185-187` — nearest
  hospital and hospital address captured per location, with the UI explicitly
  telling the scout it feeds the call sheet safety block. The field exists and
  is labelled with the right reason.
- `today/index.html:129-133` — the phone page is the one surface that puts
  hospital and per-scene safety bullets in front of the crew on the day.
- `tools/tools-registers.js:96-122` — insurance/COI register with 30-day and
  expired chips, and a policy-type list that correctly includes Workers comp,
  Auto and Drone (`:103`) — the covers a hazardous shoot actually needs.
- `scripts/test_ops.mjs:53-88` — `CSafety` is genuinely under test: hazard
  detection, personnel dedupe, document contents, meeting-checklist scoping,
  the police directory's honesty rules, and the minimum-call math (`:88`).
- `clearance/lib-clear.js:40-41` — prop-money reproduction rules flagged from
  the script. A legal/safety item most platforms miss entirely.
- `timeline/timeline-budget.js:152-155` — STUNT / PYRO / WATER / ANIMAL day
  bands with the reasoning in the comment. Defensible planning numbers.

---

## What exists but needs work

### HIGH — the hazard detector produces false HIGHs and misses real hazards
`safety/lib-safety.js:14-86`, verified by running `CSafety.analyze()`.

Given this input:

```
INT. KITCHEN - DAY
MARY burns the toast. She is fired up about the meeting.
MARY: Don't fight it. You're driving me crazy.

INT. OFFICE - DAY
JOHN drives the point home. The rain is driving against the glass.
He's a lucky dog. The deadline crashes down on him.

EXT. ALLEY - NIGHT
DEREK pulls a KNIFE and slashes at PAUL. PAUL falls hard, head cracking
on the pavement. DEREK climbs a fence and vanishes.
```

the module returns: scene 1 → `stunts` + `fire` + `vehicles`, i.e. **HIGH
pyrotechnics requiring a licensed pyrotechnician and fire safety officer, for
burnt toast**; scene 2 → `vehicles` + `animals`, i.e. a precision driver and a
professional animal wrangler for "drives the point home" and "lucky dog".
Scene 3 — the actual edged-weapon assault, head-first fall and fence climb —
returns **`night` only, severity 1**. No armorer. No stunt coordinator. No fall
protection.

Root causes, each a specific line:
- `:30` `burn(?:s|ing)?` and bare `fire` catch the commonest metaphors in
  English action prose ("burns with rage", "fired up", "burning question").
- `:44` `driving|drives|crash(?:es)?` catch "driving rain", "drives the point
  home", "the wave crashes".
- `:57` bare `dog` and bare `animal` catch idiom.
- `:23` `falls? (?:from|down|off)` misses "falls hard", "falls to the floor".
- `:51` `climbs? (?:up|the)` misses "climbs a fence".
- `:16` has `knife fight` but not bare `knife`, `blade`, `slashes`, `stabs`,
  `axe`, `bow`, `crossbow`, `grenade` — **all of which are already in
  `props/lib-props.js:98`**. Two modules disagree about what a weapon is.

Why it matters: an insurer or an inspector who reads a generated document
demanding a pyrotechnician for a toast scene stops reading, and everything else
in the pack loses its authority. Worse, the crew shooting the alley scene gets
no assessment at all.

The change: (a) require object/verb context for the metaphor-prone tokens
(`catches fire`, `set alight`, `open flame`, `burns the building`); (b) widen
the miss cases above; (c) reconcile the weapons lexicon against
`props/lib-props.js:98`; (d) — most important — make every finding
**confirmable and dismissable per scene, persisted**. An assessment is a human
judgement recorded, not a regex result. Once a human confirms, the false
positives stop mattering and the document becomes defensible.

### HIGH — the risk assessment is not in the form an insurer or inspector expects
`safety/lib-safety.js:126-144`, `:15-85`.

`assessmentText()` prints hazard → responsible → controls. What is missing is
everything that makes a risk assessment a risk assessment:

- **Severity is a constant per hazard family** (`sev:` at `:15`, `:22`, `:29`…),
  not an assessment. A birthday candle and a car burn both print `[HIGH]`.
- **No likelihood.** The standard method is likelihood × consequence → risk
  rating. The header at `:129` claims "Method: hazard identification per scene ·
  severity 1–3 · control measures · responsible person" — an inspector will read
  that and ask where the likelihood axis went.
- **No residual risk after controls.** The whole point of listing controls is to
  show the risk drops. Nothing records the after state.
- **No persons exposed** — cast / crew / stunt performers / public / minors.
- **No scene-specific description of the action.** Every fire scene gets the
  same four bullets. There is nowhere to write "practical gas bar, 4ft flame,
  performer 12ft back, no burn on performer".
- **No version, revision date, review date or sign-off block.** No signature
  line for the stunt coordinator, SFX supervisor, 1st AD, UPM or producer.

The change: add `likelihood` and `residual` per finding, an `exposed` field, an
editable per-scene action description, and a signature block plus `rev` /
`reviewed` fields in `assessmentText()`. This is the single change that moves
the document from "a nice printout" to "the thing we hand the broker".

### HIGH — scene numbering diverges; hazards land on the wrong scenes
`safety/lib-safety.js:92` vs `timeline/timeline-budget.js:282`.

The two slugline regexes disagree. `CSafety` uses
`/^\s*(?:\d+[\s.]*)?(INT|EXT|INT\/EXT|I\/E)[.\s]/i` — accepts `INT KITCHEN`
without a period, rejects `3A EXT. ROOF`. `SBBudget.SLUG_RE` is
`/^\s*(?:\d+[A-Z]?[.\s-]*)?(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i` — the exact
opposite on both counts.

Verified by execution on a numbered script (`1 INT. BARN`, `2 INT KITCHEN`,
`3A EXT. ROOF - NIGHT` where Hal falls from the ledge onto a crowd):

- `CSafety` sees two scenes — barn and kitchen — and never sees the roof. The
  roof's action text is swallowed into the kitchen's body, so the generated
  assessment states that **`INT KITCHEN - DAY` carries stunts, work at height,
  night exteriors and crowds**. The real `EXT. ROOF - NIGHT` scene does not
  appear in the risk assessment at all.
- `SBBudget` sees barn and roof, and never sees the kitchen.

`today/index.html:111` then joins the two numbering schemes — it passes
stripboard scene numbers into `CSafety.meetingChecklist()` — so the phone call
sheet can brief the crew on hazards belonging to scenes that are not shooting
today, and omit the ones that are.

The change: one shared slugline splitter used by both, and carry the *printed*
scene number (`14A`) through as an identifier rather than a sequential index.

### HIGH — the printed call sheet has no safety block at all
`producer/schedule-board.js:300-344` (`openCallSheet`).

The distributed document renders: title, day, date, general call, scene table,
cast calls, locations, free-text notes. That is it. No nearest hospital, no
medic, no emergency numbers, no hazard flags for the day, no weather or
sunrise/sunset, no muster point, no department calls.

The data all exists elsewhere: hospital at `locations/lib-scout.js:529`, day
hazards at `safety/lib-safety.js:147`, sunrise/sunset and wind at
`tools/lib-sun.js:56-79`. Only `today/index.html` — the phone view — consumes
any of it. The document that goes out by email and gets printed carries none.

The change: add a safety block to `openCallSheet` pulling hospital from
`SB_ScoutBook_v1`, day hazards from `CSafety.meetingChecklist()`, plus medic and
emergency-contact fields on `board.dayMeta[d]` (`:303`).

### HIGH — the phone call sheet can show a hospital for the wrong location
`today/index.html:98-106`.

The match is a loose eight-character prefix comparison in both directions
(`:100-103`) — and then, if nothing matched, `:106` assigns **any** scout
location that happens to have a hospital filled in. The result is displayed
under a red-bordered "Nearest hospital" header with no indication it was not
matched to today's set. A crew can be routed to a hospital that belongs to a
location in another city.

The change: show a hospital only when the location genuinely matched; otherwise
fall through to the existing "Not on file" state at `:131`. A wrong hospital is
worse than no hospital.

### HIGH — the safety meeting leaves no record
`safety/index.html:214-220`, `safety/lib-safety.js:147-158`, `:306`.

`meetingChecklist()` builds correct, scene-scoped bullets. The page renders them
into a div and nothing is written. `SB_Safety_v1` only ever receives `incidents`
and `police` (`:191`, `:277`). `blank()` at `lib-safety.js:306` even reserves an
`ack: {}` field that no code anywhere writes.

So there is no date, no attendee list, no signature, no record of who ran the
meeting, and no evidence that the scene-specific hazards were briefed. That
record is the first thing an inspector asks for after an incident and the first
thing an insurer asks for on a claim. Its absence is the difference between a
defensible production and an indefensible one.

The change: persist `SB_Safety_v1.meetings = [{date, day, scenes[], ranBy,
attendees[], items[], acknowledged[]}]`, draw attendees from `SB_Crew_v1`
(`tools/tools-registers.js:28-44`), and export. The call-sheet distribution log
at `tools/tools-registers.js:47-64` already implements exactly this
sent/confirmed pattern — reuse it.

### MED — the incident log is too thin to be the legal record it implies
`safety/lib-safety.js:307-314`, `safety/index.html:107-111`, `:275-281`.

`addIncident()` accepts `scene` and `reportedBy`, but the UI collects neither —
both are permanently `''`. Beyond that there is no time of day, no **near-miss**
category, no severity, no body part, no witnesses, no lost-time flag, no
workers-comp board reporting deadline, no corrective-action verification, no
closure status, no edit, no delete, no CSV export. The toast at `:280` says
"injuries also need the insurer notified" and nothing tracks whether that
happened.

The change: rebuild it on `TCore.Register` (`tools/tools-core.js:103`,
`:140-146` already give CSV export, delete and expiry chips) with a `type` field
of `injury | near-miss | property damage | environmental`, and an
`insurerNotified` date with an expiry chip so an un-notified injury goes amber.

### MED — the risk assessment is never saved and is silently overwritten
`safety/index.html:149`, `:153`.

`scan()` assigns `$('sfDoc').value` unconditionally, and `:153` re-runs `scan()`
on **every keystroke** in the "Prepared by" field. Edit the document to add
production-specific detail, then type your name — your edits are gone. Reload
the page and they are gone regardless, because the document is never persisted
at all (only `st.police` and `st.incidents` are).

For a document intended to be signed and filed, that is straightforward data
loss. The change: persist `st.assessment = {text, preparedBy, date, rev}`;
regenerate only on an explicit action, with a confirm when the text has been
edited by hand.

### MED — two uncoordinated hazard truths
`producer/schedule-board.js:39-40`, `:291`, `:134-140` vs `safety/lib-safety.js:102`.

The stripboard carries hand-set per-scene breakdown tags
(`stunts / sfx / vfx / water / animals / vehicles`) and those tags drive the
stunt, pyro, water and animal **unit days** in the budget seed. `CSafety`
re-derives hazards from raw script text and knows nothing about them.

Consequence: a scene the 1st AD has tagged **ST** on the board does not appear
in the risk assessment; a scene `CSafety` flags severity-3 does not tag the
board and buys no stunt day in the budget. Two departments, two answers, no
reconciliation.

The change: make the board tag the single source of truth, seeded by
`CSafety.analyze()` and then human-confirmed. That also resolves the HIGH-1
false-positive problem, because a human confirms before anything is printed.

### MED — insurance is a flat register with no requirement matrix
`tools/tools-registers.js:96-122`, `workflow/advisor.js:169-170`.

The register tracks policies well. The Advisor's only check is that *at least
one row exists*. Nothing crosses the hazard analysis against the policy types
the register itself already enumerates at `:103`. A script with aerial work and
no Drone policy, vehicle work and no Auto policy, or any crew at all and no
Workers comp, passes silently.

The change: a hazard-id → required-cover map (`aerial`→Drone, `vehicles`→Auto,
`stunts`/`fire`→Production package plus an explicit hazardous-activity
exclusion check, any crew→Workers comp) raised as an Advisor action. Also feed
the `insured` field (`:107`) from the permit directory, which already states
exactly who must be named — `locations/lib-scout.js:30`, `:52`, `:74`.

### MED — no activity permits, despite the platform knowing their lead times
`locations/lib-scout.js:531`, `locations/index.html:188-189`.

A location carries one flag: `permitStatus: none | applied | issued`. Yet the
scout book's own verified prose names separate approvals with separate lead
times for exactly the things that need them — Toronto "special
effects/pyrotechnics — 7 business days" (`:29`), Vancouver "Stunts and special
effects proposals at least 10 working days ahead" (`:40`), FilmLA "longer (7+
days) for complex activity (road closures, stunts, SFX)" (`:62`), Westminster
stunts/SFX (`:84`), NYPD "stunts, prop weapons, actors in police uniform"
(`:75`).

The platform knows the lead time and has nowhere to record the application. The
change: a per-activity permit row `{activity, jurisdiction, applied, issued,
leadTimeDays, conditions}` seeded from the hazard analysis, going amber when a
hazard scene is scheduled inside its lead time.

### MED — turnaround invasion is computed for pay, never surfaced as fatigue risk
`tools/lib-money.js:92-98` vs `safety/lib-safety.js:66-67`.

The payroll tool computes a forced-call penalty when rest falls below ten hours.
The safety module lists "Minimum 10-hour turnaround protected" and "Drive-home
risk assessed after long night shoots" as night-work controls with no mechanism
behind either. The platform therefore *knows* the crew got seven hours' rest and
never tells the safety officer.

The change: surface turnaround-invasion days as a safety flag on the day's call
sheet, not only as a pay line.

### LOW — the night hazard fires off body text, not the slugline
`safety/lib-safety.js:63`. The regex runs against slug + body with `/m`, so any
action line containing both "EXT" and "NIGHT" flags the scene as a night
exterior. Test the slugline only.

### LOW — `paidDutyNeeds` gates on `EXT` in the slugline alone
`safety/lib-safety.js:202-213`. A stunt or weapon scene written `I/E.`, or shot
from an interior slug onto a practical street, is missed. Note also that NYPD's
own rule (`locations/lib-scout.js:75`) covers **prop** weapons — the replica/
real distinction does not exempt the notification.

---

## What is missing entirely

1. **Firearms and blank handling procedure / weapon custody log** — *highest
   value*. `props/lib-props.js:17-18` knows a weapon needs an armorer and adds
   `ARMORER_DAY = 650` (`:152`, `:201-202`); `safety/lib-safety.js:15-21` states
   the four correct principles. Neither creates a **record**. What is needed,
   per weapon per day: type and class (live-fire-capable / blank-firing /
   replica / rubber / airsoft), serial or asset number, the armorer's licence
   number and expiry, blank calibre and load, count issued and count returned,
   the signature at each hand-off, the time the weapon went cold, overnight
   storage, and transport arrangements. Attach to `props/` (weapons category)
   with the log surfaced in `safety/`. One `lib-` file plus a register — small
   build. This is the single artifact most likely to be demanded by an insurer,
   a police film unit and, in the worst case, an inquest.

2. **Stunt breakdown, rehearsal and sign-off** — *high*. There is no artifact for
   an individual stunt: sequence description, performers and doubles, rigging
   and equipment, fall height / ratchet load / vehicle speed, the rehearsal
   record, the number of takes agreed before rolling, the "safety" call
   protocol, and the coordinator's signature that it is safe to shoot as
   planned. `safety/lib-safety.js:25-28` names the controls in prose only.
   Attach to `safety/`, keyed off the board's ST tag. This is the document the
   stunt coordinator role exists to produce, and the platform has no slot for it.

3. **SFX / pyro plan and permit sign-off** — *high*. Same shape: charges and
   quantities, the pyrotechnician's licence, the fire-authority permit number
   and inspection record, fire watch, extinguisher placement, exclusion-zone
   radius, and SDS sheets for every fluid. `safety/lib-safety.js:35` names SDS
   with nowhere to file one. Attach to `safety/`.

4. **Near-miss reporting** — *high value, low cost*. Absent entirely; the
   incident record at `safety/lib-safety.js:307` has no `type` field to hold
   one. A near-miss log is the cheapest predictive safety instrument there is —
   it is how you find the fall before someone takes it.

5. **Medic / first-aid provision** — *high*. "Medic" exists in this platform as
   three words inside checklists (`safety/lib-safety.js:27`, `:150`). There is
   no medic booking, no medic on any call sheet, no first-aid kit or AED
   location, no emergency phone block, and no medic day rate in the budget —
   `timeline/timeline-budget.js:152-155` has STUNT / PYRO / WATER / ANIMAL bands
   and no MEDIC. Attach: a medic line on `board.dayMeta` in
   `producer/schedule-board.js:303`, a budget line, and a rule that any
   severity-3 hazard day requires one.

6. **Minors on set** — *high*. Nothing anywhere: no age or date-of-birth field on
   cast records (`production/lib-cast.js`, `casting/lib-castdesk.js` both have
   none), no work-hour limits by age, no studio teacher / tutor requirement, no
   guardian requirement, no work-permit tracking, and no restriction on minors
   near stunts, firearms, water, animals or night work — every one of which
   `CSafety` already detects. Attach to the cast records with a rule layer in
   `safety/`. A jurisdiction will shut a production down over this and a
   completion bond will ask for it in writing.

7. **Health protocol — communicable illness, heat and cold stress, hearing,
   respiratory** — *medium*. Grep returns nothing for COVID, PPE, heat or
   hearing. More useful than a COVID-specific module: a health section covering
   communicable-illness policy, heat/cold thresholds bound to the forecast the
   platform already fetches (`tools/lib-sun.js:77-79` pulls
   `temperature_2m_max/min` and `wind_speed_10m_max`), hearing protection on
   gunfire and pyro days, and respiratory protection for atmospheric smoke —
   which `safety/lib-safety.js:35` mentions with nothing behind it.

8. **Wind and weather stop conditions bound to activity** — *medium*.
   `tools/lib-sun.js:90-96` computes a shoot-risk score that adds penalty above
   wind 30 (units unstated), and `tools/sched-weather.js` displays it.
   `safety/lib-safety.js:79` lists "Weather watch with wind/lightning stop
   conditions" as a control. Nothing sets a numeric stop threshold per activity
   — drone, crane, condor, scaffold, high work — or blocks the day. Cheap to
   build on the existing fetch, and it is the control that keeps a condor from
   going over.

9. **Evacuation / emergency action plan per location** — *medium*. The tech-scout
   checklist (`locations/lib-scout.js:505-520`) captures the hospital and
   nothing else emergency-related. `safety/lib-safety.js:150`'s very first
   briefing item covers "nearest exits, muster point and medic location" — none
   of the three is recorded anywhere. Add muster point, evacuation route, site
   emergency contact and "who calls emergency services" to the location record.

10. **Contractor competence and licence records** — *medium*. `CSafety` names the
    required specialist for every hazard (`:17`, `:24`, `:31`, `:38`, `:44`,
    `:52`, `:58`, `:64`, `:70`, `:76`, `:82`) and there is nowhere to record who
    they are. Deal memos reference "safety compliance" in a single clause
    (`contracts/lib-deal.js:86-89`) but capture no licence number, issuing body,
    expiry, or the contractor's own insurance. Extend `SB_Crew_v1` with
    licence / certification / expiry, or add a dedicated register.

11. **Safety file export** — *medium*. There is no way to produce the bundle an
    insurer or inspector asks for as one artifact: risk assessment plus
    revisions, meeting records, incident and near-miss log, permits,
    certificates, licences, sign-offs. Every register has CSV
    (`tools/tools-core.js:140-146`) and the assessment downloads as a `.txt`
    (`safety/index.html:157-162`), but the pack does not exist. Attach to
    `safety/`.

12. **Safety in the pipeline gates** — *medium*. `workflow/advisor.js:143-186`
    (`prepActions`) checks script, clips, budget, incentives, casting, crew,
    locations, permits, insurance-exists, clearances and delivery. It never
    checks safety: no "twelve scenes carry severity-3 hazards and no risk
    assessment has been prepared", no "stunt scenes scheduled and no stunt
    coordinator on the crew list", no "no safety meeting recorded for a day that
    is already shot". Safety is the one department that can stop the show, and
    it is absent from mission control. Cheap to add and high value.

---

## Evidence

Files read in full: `docs/audit/BRIEF.md`; `safety/lib-safety.js` (326 lines);
`safety/index.html` (290); `production/lib-prod.js` (182); `props/lib-props.js`
(355); `today/index.html` (157); `contracts/lib-deal.js` (112);
`clearance/lib-clear.js` (153).

Files read in part: `producer/schedule-board.js:1-140`, `:270-474`;
`tools/tools-registers.js:1-140`; `workflow/advisor.js:100-190`;
`locations/lib-scout.js:20-90`, `:505-545`; `tools/lib-sun.js:75-101`;
`timeline/timeline-budget.js:150-160`, `:282-298`; `production/production.js:205-250`;
`scripts/test_ops.mjs:50-104`; `scripts/test_cloud_safety.mjs:1-60`;
`tools/tools-core.js` (grep, `:70`, `:80-146`); `tools/lib-money.js` (grep, `:92-98`);
`props/index.html:101`, `:260`; `dashboard.html:1455-1458`.

Executed, not inferred:

- `CSafety.analyze()` run against the toast/idiom/knife-fight script quoted
  above. Output: scene 1 `["stunts","fire","vehicles"]`; scene 2
  `["vehicles","animals"]`; scene 3 `["night"]`. Required personnel included
  "Licensed pyrotechnician + fire safety officer" and "Professional animal
  wrangler". `paidDutyNeeds()` returned `[]` for the alley weapon scene.
- `CSafety.splitScenes()` vs `SBBudget.SLUG_RE`
  (`timeline/timeline-budget.js:282`) run against `1 INT. BARN` /
  `2 INT KITCHEN` / `3A EXT. ROOF - NIGHT`. `CSafety` returned scenes
  `["1 INT. BARN - NIGHT", "2 INT KITCHEN - DAY"]`; `SLUG_RE` matched
  `["1 INT. BARN - NIGHT", "3A EXT. ROOF - NIGHT"]`. `CSafety.analyze()`
  attributed `["stunts","heights","night","crowds"]` to `INT KITCHEN - DAY`.
- `CSafety.blank()` returns `{"v":1,"incidents":[],"ack":{}}`; grep confirms
  `ack` is written by no code in the repository.

Negative results, each confirmed by repo-wide grep excluding `node_modules`,
`static/` and `local-backend/`:

- `minor` / `child labor` / `studio teacher` / `work permit` / `guardian` — two
  incidental hits (`casting/lib-castdesk.js:158`, `festivals/lib-fest.js:120`),
  neither about minors on set. No age or DOB field on any cast record.
- `medic` / `paramedic` / `first aid` / `ambulance` — three hits, all inside
  checklist prose (`safety/lib-safety.js:27`, `:150`) plus one prop-house
  description. No medic anywhere as a bookable, budgetable or call-sheet entity.
- `COVID` / `health protocol` / `PPE` / `hearing protection` / `noise exposure`
  — zero hits.
- `MEDIC_DAY` or equivalent in `timeline/timeline-budget.js` — absent; only
  `STUNT_DAY`, `PYRO_DAY`, `WATER_DAY`, `ANIMAL_DAY` (`:152-155`).
- `safety` in `workflow/advisor.js` — one hit, `:128`, a staffing
  recommendation. No safety gate in `prepActions`.
- `safety` in `dashboard.html` — one hit, `:1455`, the nav link.

Correction to an assumption I checked and disproved: I initially expected no
test coverage for `safety/lib-safety.js` because there is no
`scripts/test_safety.mjs` (`scripts/test_cloud_safety.mjs` is about cloud sync,
not this module). Coverage does exist, in `scripts/test_ops.mjs:53-88`. It is
real coverage — but every assertion uses phrasing built to match the regex
("loads the shotgun", "a fight breaks out", "falls from the loft", "car chase",
"swims across the river", "rain hammers down", "a crowd gathers", "a drone shot
rises"). There is no negative assertion anywhere: nothing asserts that burning
toast does **not** require a pyrotechnician, and nothing asserts that a knife
slash **does** require an armorer. Adding those two cases would have caught
HIGH-1 on the day it was written.

I edited no files. The only file created is this report.
