# Prop Master

Judged as the person who breaks down the script, sources every object an actor
touches, keeps it matching across a month of out-of-order shooting, and returns
it without a loss-and-damage bill. Question asked of the code: *could I run a
show from this, breakdown → source → set → wrap?*

Short answer: I could **price** a show from this and I could **call** prop
houses from it. I could not **run** one. The module is a strong estimating and
sourcing tool wearing a props department's name. Everything from the moment the
truck is loaded onward — per-day pull lists, check-in/check-out, continuity
photos, loss and damage, returns — does not exist anywhere in the platform.

---

## What exists and works

- `props/lib-props.js:97-113` — the lexicon covers 9 categories and ~150 terms
  with sensible category assignment (shotgun→weapon, typewriter→electronics,
  piano→specialty). The category taxonomy itself is the right one a props
  department uses.
- `props/lib-props.js:162-181` — pricing is built on real conventions and the
  code matches its own comments: the 10% rule (weekly ≈ 10% of replacement
  value), 75% on weeks 2+, buy when rental exceeds 60% of purchase (the ~40%
  resale break-even). Consumables are correctly buy-only and priced per shoot
  day (`:165`). These are honest working rules, not invented numbers.
- `props/lib-props.js:83-94` — `fitsThrough` is geometrically correct. It tests
  all six 2-of-3 dimension permutations, which is exactly what a mover does with
  a doorway. Not a fudge.
- `props/lib-props.js:40-64` — `CAT_DIMS` + `dimsFor` give every prop a
  real-world size with a per-item override that survives round-trip. Giving a
  props list dimensions at all puts this ahead of most software the department
  actually gets handed.
- `props/index.html:172-196` — the scale preview draws the prop beside a 5.8 ft
  figure (`sets/lib-set3d.js:48`). This is the correct answer to "how big is
  that" — a measurement in feet is right but slow; the picture is instant. It
  degrades honestly when WebGL is unavailable (`:177-180`).
- `props/index.html:215-233` → `props/lib-props.js:66-81` — placement writes an
  ordinary set item into `SB_SetDesign_v1`, so the Set Designer needs no
  knowledge of props. It renders as a real box at real dimensions in both 2D
  (`sets/lib-set.js:30`, kind `rect`) and 3D (`sets/lib-set3d.js:51`).
  Re-placing moves rather than duplicates (`:228`). Genuinely good design.
- `scripts/test_set3d_browser.mjs:209-286` — that placement path is covered
  end-to-end in a real browser: sizes render, the preview draws lit pixels, the
  doorway note appears, the item lands in the set store with `propId` intact and
  does not duplicate on a second placement. Real coverage, not a smoke test.
- `props/lib-props.js:268-277` — the curated directory returns `phone: null`
  for every house and offers a Google search link instead
  (`:322-325`). `scripts/test_props.mjs` asserts this ("directory never invents
  phones"). The brief's no-invented-numbers rule is respected in code and
  guarded by a test.
- `props/lib-props.js:279-321` — keyless Nominatim + Overpass lookup with a
  graceful three-stage fallback (research service → map → directory only,
  `props/index.html:331-365`), and `mergeHouses` fills phones onto curated names
  rather than duplicating them. Source is labelled in the UI (`:313`).
- `props/lib-props.js:208-216` / `js/learn.js:55-80` — quotes feed the learning
  layer using the **raw** uncalibrated estimate, so calibration cannot feed on
  its own output. Ratios are clamped 0.25–4, multipliers 0.5–2, and one data
  point is explicitly refused as "an anecdote". Careful work.
- Escaping is clean throughout `props/index.html` — `esc()` on every
  interpolation, `CinUrl.safe()` on the website and search links (`:315,:317`),
  `tel:` stripped to `[^+\d]` (`:314`). Nothing to flag.
- `scripts/test_props.mjs` — 42 assertions, all passing. Verified by running it.

---

## What exists but needs work

### HIGH — the scene numbers in the breakdown are wrong on any numbered script

`props/lib-props.js:120` uses `/^\s*(?:\d+[\s.]*)?(INT|EXT|INT\/EXT|I\/E)[.\s]/i`
while `js/budget-engine.js:279` (which drives the stripboard,
`producer/schedule-board.js:55`) uses
`/^\s*(?:\d+[A-Z]?[.\s-]*)?(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i`. The props regex
has no `[A-Z]?`, so it **cannot see an A-scene**. Verified by running it:

```
1  INT. KITCHEN - DAY   → props scene 1
14A INT. HALL - NIGHT   → NOT a scene; its body is swallowed into scene 1
15  EXT. ROAD - DAY     → props scene 2
```

The lamp in 14A is reported as a scene 1 prop. The truck in 15 is reported as
scene 2. The stripboard sees three scenes; props sees two. Every scene number in
the props breakdown is silently offset from every other department's, and it
looks perfectly plausible. A prop master breaks down the *locked, numbered*
script — this is precisely the case that breaks.

**Change**: capture the printed scene number from the slugline (`\d+[A-Z]?`) and
use it as `sc.n`, falling back to the ordinal only when the script is unnumbered.
Support the alpha suffix through to `item.scenes` so "14A" can be expressed.
Align the regex with `js/budget-engine.js:279` so the two parsers cannot diverge.

### HIGH — the breakdown reads dialogue and verbs, and one false positive costs $1,950

`props/lib-props.js:133-136` scans `sc.body.join('\n')` — action **and**
dialogue, with no action/dialogue split. Combined with the naive `term + 's?'`
regex (`:111`) and terms like `camera`, `watch`, `ring`, `chain`, `bow`, `glass`
in the hand-prop list (`:103`), the result on ordinary screenplay prose is:

```
INT. OFFICE - DAY
The CAMERA pushes in on MAGGIE. A phone rings. She ignores it.
MAGGIE
  I could kill for a coffee. Watch the door, will you?
She takes a bow after the applause. Chain of command, he says.
```
→ `Bow/weapon, Camera/handprop, Chain/handprop, Coffee/food, Ring/handprop,
Watch/handprop` — six items, none of them props. And "Bow" lands in `weapon`,
which trips the automatic armorer line at `props/lib-props.js:201-202` and adds
$1,950 to a scene with no weapon in it.

**Change**: split each scene into action vs. dialogue vs. character cue (the
splitter already has the lines) and match action only; drop bare-verb terms
(`watch`, `ring`, `bow`, `chain`, `camera`) or require an article/adjective
before them; never let an auto-found weapon add the armorer line without
confirmation.

### HIGH — "Rebuild from script" destroys every edit and silently re-points set placements

`props/index.html:294-295`:
```js
var kept = st.items.filter(function (x) { return x.manual; });
st.items = found.concat(kept);
```
Only hand-added props survive. Every edit to an auto-found prop — corrected
category, hero flag, custom dimensions, the quote you typed in the Quoted column
— is destroyed. Given the false-positive rate above, pruning the list is the
first thing you do, and rebuilding after any script revision throws the pruning
away.

Worse: `props/lib-props.js:142-146` regenerates ids as `p1…pN` in **sorted term
order**, so adding one prop early in the alphabet shifts every subsequent id. A
prop already placed on a set carries `propId: 'prop_p1'`
(`props/lib-props.js:73`) — after a rebuild that id points at a different prop.
The box on the stage still says "Upright piano"; the link behind it now resolves
to "Umbrella".

`clearance/index.html:118-120` already solves exactly this — it re-scans and
restores prior statuses by matching `cat|scene|term`. **Change**: give props the
same treatment, keyed on `name+cat`, and make ids stable (hash the term, not the
sort position).

### HIGH — the props budget never reaches the budget or the Money Room

`props/index.html:258-262` computes rentals, armorer, contingency and a "Props
budget" total, and it goes nowhere. `producer/budget-sheet.js:23` has acct 9000
Art Department with a "Set dressing & props" line that stays at zero.

Eight modules already commit to the Money Room via `CMoney.addPO`
(`finance/lib-money.js:23-31`): post, locations, vfx, safety, music, casting,
contracts, and — directly analogous — wardrobe, whose one-button commit is
`wardrobe/index.html:94,310-318` (acct 10000, vendor "Wardrobe dept"). Props is
the outlier. On a real show props is one of the two most PO- and
petty-cash-heavy departments and it is invisible to the cost report.

**Change**: add a "Commit to Money Room (acct 9000)" button mirroring
`wardrobe/index.html:310-318`, with the double-commit guard `post/lib-post.js:217`
uses. Ideally per-house rather than one lump, since a props total is many vendors.

### HIGH — there is no BUILD

`props/index.html:246` offers `['auto','rent','buy']`. Wardrobe — a *less*
build-heavy department — has `SOURCES = ['buy','rent','build','cast-own']`
(`wardrobe/lib-ward.js:15`) and totals by source
(`wardrobe/lib-ward.js:131-142`). Props builds more than any other department:
breakaways, hero graphics, prop money, fake food, specialty rigs, anything a
stunt destroys. None of it can be expressed. No shop hours, no materials, no
fabricator, no build lead time.

**Change**: add `build` to the mode list; price it as materials + hours × shop
rate rather than through the 10% rule; add a `buildDays` lead-time field so it
lands on the prep calendar rather than the rental clock.

### HIGH — a hand-added prop can never be assigned to a scene

`props/index.html:244` renders the Scenes column as read-only text:
```js
'<td class="pp-scenes">' + esc((it.scenes || []).join(', ')) + '</td>'
```
Every other column is an input. `ppAdd` (`:300`) creates props with
`scenes: []`, and there is no way to change that. On a real show at least half
the props list is hand-added — the dressing, the practicals, the paperwork, the
things the writer never named. None of them can carry a scene, so the per-scene
view is structurally incomplete.

It also silently mis-prices: a hand-added picture vehicle hits
`props/lib-props.js:167` `Math.max(1, item.scenes.length * 2)` with an empty
array, giving **one day** — $400 for a car on a 15-day shoot.

**Change**: make the Scenes cell an input using
`wardrobe/lib-ward.js:98-109 parseSceneNums`, which already parses "3, 7, 12-15".

### MED — the armorer line is a constant and cannot be corrected from the UI

`props/lib-props.js:202`:
```js
var armorer = hasWeapons ? ARMORER_DAY * Math.max(1, plan.weaponDays || Math.min(plan.shootDays || 3, 3)) : 0;
```
`plan.weaponDays` is never supplied — `props/index.html:144` returns only
`{weeks, shootDays}`. So for any shoot of 3+ days the armorer is always
$650 × 3 = $1,950, whether weapons appear in one scene or forty. There is also
no ammunition/blanks line, no weapons transport or overnight storage, and no
permit tracking.

**Change**: derive weapon days from the scenes the weapon props appear in joined
to the stripboard's scene→day map (`producer/schedule-board.js:79,84`), and
expose an override field. Cross-link to `safety/lib-safety.js:15-21`, which
already carries the correct weapons controls (custody, cold/hot calls, no live
ammunition) and the "weapons visible in public → police notification"
rule at `safety/lib-safety.js:208`. The two modules both know about weapons and
have never been introduced.

### MED — the estimate excludes costs the module's own RFQ asks the vendor for

`props/lib-props.js:340-341` asks every house for "damage waiver, and
delivery/pickup options". Neither appears in `estimate()`. Nor does transport,
prep or wrap labour, cleaning, restocking, or loss-and-damage reserve. The note
at `props/index.html:101` explains the *method* (10% rule, break-even, armorer,
calibration) honestly but says nothing about *scope*. So "Props budget $X" reads
as a total when it is a rental-and-purchase subtotal.

**Change**: one line under the totals naming what is excluded, and a
damage-waiver percentage (8–12% of rental is the usual ask) as a visible line
rather than a silent omission.

### MED — the "Quoted $" column is ambiguous, so the learning layer learns noise

`props/index.html:252` labels the field "Quoted $" with placeholder "quote", and
`props/lib-props.js:208-215` compares it against `priceItem(...).raw` — the
**total for the whole rental period or the whole purchase**. A prop house quotes
a *weekly rate*. There is no vendor, no date, no period, and no rate structure
attached to the number, so the module cannot tell a weekly rate from a total
from a purchase price, and neither can the user. The per-category multiplier it
trains (`js/learn.js:77-80`) is therefore built on mixed units.

Secondary: the fingerprint at `js/learn.js:62` includes the actual value, so
correcting a typo'd quote (1200 → 1500) learns twice rather than replacing.

**Change**: split into `rate`, `unit` (day/week/flat), `vendor`, `date`; compute
the comparable total from those; learn only from the computed total.

### MED — the doorway check is a constant, not the actual set

`props/index.html:192` hardcodes `P.fitsThrough(it, 3, 6.75)`. The set plans
contain real doors — `sets/lib-set.js:13` `door: {w: 3}` overridable per item,
with height 6.75 at `sets/lib-set3d.js:33` — and the load-in path a prop master
actually worries about is the truck lift gate, the elevator, the stage door and
the corridor turn, not a notional 3-footer.

**Change**: run `fitsThrough` against every door on the active plan and report
the tightest, plus user-entered truck/elevator dimensions. Cheap: the geometry
already works.

### MED — a size change never follows the prop onto the set, though the code says it does

`props/lib-props.js:66-69` comments: *"propId ties the two together so a size
change here can follow it there."* Nothing implements it. The dimension change
handler `props/index.html:198-207` calls `save(); renderRows(); drawSize();` and
never touches `SB_SetDesign_v1`. You must delete and re-place. A comment
promising behaviour the code does not have is worse than no comment.

Same file, same area: deleting a prop (`props/index.html:284-288`) leaves its box
on the set plan forever, with a `propId` pointing at nothing.

### MED — every placed prop lands on the same square foot

`props/index.html:226` places at `(plan.w/2, plan.h/2)` for every prop, with no
offset and no collision test against existing items. Place ten props and you
have one heap at stage centre, some of them inside walls.

**Change**: spiral or grid outward from centre, skipping occupied cells —
`sets/lib-set.js:66-77 hitTest` already does point-in-rotated-rect and can be
reused directly.

### MED — cross-tab last-write-wins between Props and the Set Designer

`sets/index.html:126` reads the whole doc once at load; `:129` writes the whole
doc on every save. `props/index.html:230` writes the same key independently. The
props topbar links to the Set Designer (`props/index.html:65`) and the Set
Designer links back to Props (`sets/index.html:66`), so having both open is the
intended workflow — and the next save from either tab silently erases the
other's work.

**Change**: re-read the store immediately before merging in both writers, or add
a `storage` event listener that reloads.

### MED — default dimensions are presented as measurements

`props/lib-props.js:41-49` defaults every weapon to 3.0 × 0.6 × 0.6 (a rifle) and
every greens item to 2.2 × 2.2 × 4.5 (a potted tree). A derringer and a bouquet
get those numbers, and `props/index.html:253-254` renders them in the table
identically to a measured override. The comment at `:34-39` is honest about them
being defaults; the UI is not.

**Change**: render defaulted dimensions dimmed/italic with
`title="category default — measure and override"`, and stamp measured ones.

### MED — greens and picture vehicles are priced as objects, not as services

`props/lib-props.js:25` prices greens at $1,200 replacement → ~$120/week under
the 10% rule for an entire greens package. Greens is a *crew and maintenance*
line: a greensman, delivery, daily watering, swap-outs, and removal. `:19-20`
prices a picture vehicle at $400/day and honestly notes driver/wrangling is
excluded — but the day count `Math.min(shootDays, scenes.length * 2)`
(`:167`) is arbitrary, and picture cars are usually held for the whole period
plus prep, need aging/decals/dressing, a separate certificate of insurance,
transport to set, and plates.

**Change**: give greens a labour-day rate rather than a rental value; give
vehicles prep days, hold days, transport, and an insurance flag.

### LOW — a partially-shaped store blanks the page

`props/index.html:142` falls back to defaults only when the store is entirely
absent. A restored project whose `SB_Props_v1` lacks `items` throws at
`:238` (`st.items.map`) and the page renders empty; one lacking `phones` throws
at `:310` and kills the sourcing panel. The vault
(`projects/lib-vault.js`) restores arbitrary user JSON.

**Change**: merge defaults into the loaded object rather than replacing it.

### LOW — the mailto body can be cut mid-escape

`props/index.html:394` slices the **percent-encoded** string at 1800 chars, which
can bisect a `%XX` triple and produce a malformed URI. Encode after slicing.

### LOW — the new geometry API has no node tests

`scripts/test_props.mjs` covers breakdown, pricing, learning, sourcing and RFQ —
42 assertions — but not `dimsFor`, `toSetItem`, `fitsThrough` or `CAT_DIMS`.
Those are covered only through the browser suite
(`scripts/test_set3d_browser.mjs:209-286`), which needs Playwright. The brief
asks for pure logic to be node-testable; this is the one part of `lib-props.js`
that isn't tested that way. Cheap to add: `fitsThrough` in particular has exact
expected answers (piano through a 3 ft door: no; wallet: yes).

---

## What is missing entirely

### 1. The daily prop pull list — HIGHEST VALUE

The single most-used document in the department: *what goes on the truck for Day
7*. It does not exist. Nothing anywhere joins props to shoot days — `today/`
has no props at all (grepped: zero matches).

Everything needed is already in the platform: props carry `scenes`
(`props/lib-props.js:144`), and the stripboard assigns `scene → day`
(`producer/schedule-board.js:79,84`, stored in `SB_ScheduleBoard_v1` and already
read by `production/lib-prod.js:33-34`). A day-indexed pull list is a join and a
print stylesheet.

Attach to: `props/` as a fourth section, mirrored into `today/`.
Build: small — half a day. **Value: highest in this report.**

### 2. Check-in / check-out, and loss & damage

There is no record of what left the prop house, what arrived on set, who signed
for it, what came back, and what did not. This is the department's legal and
financial exposure — the L&D invoice at wrap is what a prop master is judged on,
and rental agreements make the production liable for replacement value from
pickup to return.

The data model is nearly there: `props/lib-props.js:153-159 baseValue` already
computes replacement value, which is exactly the number an L&D claim is settled
against.

Attach to: `props/`, with the settlement posting to the Money Room via
`finance/lib-money.js:23 addPO`.
Build: medium — a status field per item (`ordered / in / on set / returned /
lost / damaged`), a per-item vendor, out and due-back dates, and a wrap report
listing everything not returned with its replacement value.
**Value: very high.**

### 3. Per-prop continuity photos

`production/production.js:157-174` gives the script supervisor one free-text
"Wardrobe / props" column (`:168`). That is the entire prop continuity story.
A prop master's actual job on set is: photograph the dressed set and every hero
prop's state, per scene, before the first take, so that scene 40 shot on day 3
matches scene 39 shot on day 22.

Wardrobe has already built exactly this and it works: an IndexedDB photo store
attached to a look, resized on upload, dated
(`wardrobe/index.html:98-104, 132-137, 345-366`, sizing math in
`wardrobe/lib-ward.js:260-265`). It even flags which looks *need* photographing —
`changePlot`'s `continuitySpans` marks a look returning after a scene gap with
the note "photograph it" (`wardrobe/lib-ward.js:199-209`).

Attach to: `props/`, reusing the wardrobe photo pattern almost verbatim; the
"span across non-adjacent scenes → photograph it" rule transfers unchanged and is
*more* important for props (a half-smoked cigarette, a poured drink level, a
letter's fold) than for wardrobe.
Build: small-medium — the pattern is proven in-repo.
**Value: very high. This is the "continuity-checking" half of the job title,
and it is entirely absent.**

### 4. Hero / stunt / breakaway / background multiples

`props/index.html:249` has a single boolean `hero` and `qty` as one number.
The real model is per-prop counts by type: hero (close-up spec), stunt double,
breakaway (destroyed per take — you need one per take, not one per show),
rehearsal, and background. `baseValue` multiplying by 3 for hero
(`props/lib-props.js:156`) is a reasonable cost proxy but cannot express
"six breakaway bottles for scene 14, three takes planned".

Wardrobe already reasons about this correctly: `sceneHazards` +
`multiplesAdvice` (`wardrobe/lib-ward.js:225-256`) scan for blood/rain/mud/tears/
fight/water and recommend 3 multiples at the first hazard scene, +1 per further
hazard scene, capped at 6, with an explicit "estimate; confirm with stunts/SFX"
caveat. That logic is directly portable and props needs it more.

Attach to: `props/lib-props.js` pricing, plus a multiples column.
Build: small — port `wardrobe/lib-ward.js:225-256`.
**Value: high.**

### 5. Picture vehicle log

Picture cars are their own discipline: a per-vehicle record of owner, plates and
registration, condition photos at pickup and return, mileage, fuel, the
certificate of insurance, precision-driver bookings, and prep (aging, decals,
period plates, camera rigging). `safety/lib-safety.js:41-49` has the safety half
(closed roads, brakes/belts/kill-switch inspection, precision driver) but there
is no vehicle *record* anywhere. Today a picture car is one row in the props
table priced at $400 × an invented day count.

Attach to: `props/`, cross-linked to `safety/`.
Build: medium.
**Value: high on any show with a car; zero on a chamber piece.**

### 6. Weapons register and permits

The platform correctly knows weapons need a licensed armorer
(`props/lib-props.js:17-18`, `safety/lib-safety.js:15-21`). It has no register:
per-weapon make/model/serial, live vs. rubber vs. resin vs. non-firing,
blank load, the transport permit, the storage arrangement, the chain-of-custody
sign-out per shoot day, and jurisdiction rules (which vary enormously and are the
reason a prop master phones ahead).

`locations/` already models permits with an expiry chip
(`production/production.js:132-144`), so the pattern exists.

Attach to: `props/` with the safety controls pulled from
`safety/lib-safety.js:15-21`.
Build: medium.
**Value: high, and it is the one area where getting it wrong is not a budget
problem.**

### 7. Product placement and branded-item clearance

`clearance/lib-clear.js:76-80` flags every brand in the script with the action
*"Product-placement agreement, greek the mark, or swap for a cleared fictional
brand"* — and that action lands on nobody's list. The person who has to source
the greeked substitute, or take delivery of the placed product, is the prop
master, and there is no link between a clearance finding and a props line.

Missing on the props side: which branded items were cleared vs. greeked vs.
swapped, who the placement partner is, the contra value (product placement is
*income* or an in-kind budget offset — it is currently invisible to the budget
entirely), delivery dates, approval-of-depiction obligations, and the
prop-money reproduction rules that `clearance/lib-clear.js:40-41` already flags
but nobody owns.

Attach to: a link from each `clearance` brand finding into a props row, plus a
placement register in `props/`.
Build: small-medium.
**Value: high — it is money in as well as risk out, and this platform already
does the hard half (detection).**

### 8. Prop houses: rental agreement terms and the return clock

`housesFor` gives names and specs; there is nothing to hold the deal: rental
rate and unit, minimum period, damage-waiver percentage, delivery and pickup
charges, the return date, and the late-return penalty. The return date is the
one that matters — a prop returned a week late costs a full extra week, and it
is the most common avoidable overage in the department.

Attach to: `props/` house cards (which already persist per-production edits via
`st.phones`, `props/index.html:376-381`).
Build: small.
**Value: medium-high.**

### 9. An exportable, printable prop list

There is no CSV and no print path in `props/index.html` (grepped: zero matches
for `csv`, `window.print`, `@media print`). The department hands out lists
constantly — to the vendor, to the accountant, to the truck, to the set dressers.
The RFQ textarea (`props/lib-props.js:328-343`) is the only output and it is
prose.

`production/lib-prod.js:86-95 csvCell` already implements the brief's formula-
injection guard and `:97-103 cueCsv` shows the pattern.

Attach to: `props/`.
Build: trivial.
**Value: medium — but it is the cheapest item in this report.**

### 10. Greens as a discipline

Greens is a category in the pricing table (`props/lib-props.js:25`) and nothing
else: no plant schedule, no live-vs-silk decision, no watering/maintenance
during a hold, no seasonal availability (the single biggest constraint — you
cannot get autumn foliage in April), no removal and site restoration. On an
exterior-heavy show greens is its own crew.

Attach to: `props/` as a sub-mode, or split off if it ever grows.
Build: medium.
**Value: medium — high only on the shows where it matters, which the module
cannot currently tell apart.**

---

## Evidence

Files read in full:
- `docs/audit/BRIEF.md` (1-87)
- `props/lib-props.js` (1-355)
- `props/index.html` (1-417)
- `production/lib-prod.js` (1-182)
- `clearance/lib-clear.js` (1-153)
- `sets/lib-set.js` (1-153)
- `scripts/test_props.mjs` (full)

Files read in part:
- `production/production.js` 1-240 (continuity register `:157-174`, its free-text
  "Wardrobe / props" field `:168`; locations permit register `:127-145`)
- `sets/lib-set3d.js` 30-80 (PROFILES `:32-51`, `custom` box `:51`, `person` 5.8 ft
  `:48`, `heightOf` `:57-61`)
- `sets/index.html` 110-130 (doc load `:126`, whole-doc save `:129`, topbar link
  to Props `:66`)
- `wardrobe/lib-ward.js` 12-22, 100-265 (`SOURCES` incl. build `:15`,
  `parseSceneNums` `:98-109`, `totalsBySource` `:131-142`, `changePlot` /
  `continuitySpans` `:161-209`, `sceneHazards` + `multiplesAdvice` `:225-256`,
  `fitWithin` `:260-265`)
- `wardrobe/index.html` 94, 98-104, 132-137, 300-366 (Money Room commit
  `:310-318`, IndexedDB photo store `:133-137`, photo attach `:345-366`)
- `safety/lib-safety.js` 1-120 (weapons hazard `:15-21`, vehicles `:41-49`,
  public-weapons police rule `:208`)
- `clearance/index.html` 55-124 (status preservation on re-scan `:118-120`)
- `producer/budget-sheet.js` 1-60 (acct 9000 Art Department `:23`)
- `producer/schedule-board.js` 20-90 (`scenesFromScript`, `num: i+1` `:79`,
  `day: -1` `:84`)
- `finance/lib-money.js` 1-80 (`addPO` `:23-31`, `addPetty` `:38-43`,
  `costReport` `:63+`)
- `js/budget-engine.js` 279-295 (`SLUG_RE` `:279`, `splitScenes` `:282-295`)
- `js/learn.js` 50-90 (`learnBudget` fingerprint `:62`, `calibration` `:77-80`)
- `tools/lib-money.js` 112-135 (`hotCost` postings shape)
- `dashboard.html` 2180-2200 (props count tile `:2192-2193`)
- `scripts/run_all_tests.mjs` 1-80 (suite discovery)
- `scripts/test_set3d_browser.mjs` 200-290 (props browser coverage `:209-286`)
- `scripts/make_sample.mjs` 88-105 · `projects/sample.cinamate.json`
  (`SB_Props_v1` shape)

Commands actually run:
- `node scripts/test_props.mjs` → **42 passed, 0 failed**
- `node -e` against `props/lib-props.js` with a numbered script containing
  scene 14A → **props reports 2 scenes where `budget-engine`'s `SLUG_RE`
  reports 3**; the 14A body is absorbed into scene 1; the truck in scene 15 is
  reported as scene 2
- `node -e` against `props/lib-props.js` with an ordinary action/dialogue page →
  **`Bow/weapon, Camera/handprop, Chain/handprop, Coffee/food, Ring/handprop,
  Watch/handprop`** — six props, none real, one of them arming the armorer line
- `grep -rn "addPO"` → 8 modules commit to the Money Room; props is not one
- `grep -c "csv\|window.print\|@media print" props/index.html` → **0**
- `grep -rn "check-in\|check-out\|damage waiver\|loss and damage"` → no
  department in the platform has any of these
- `grep -rn "breakdown sheet\|day out of days\|DOOD"` → no matches
- `grep -n "props" today/index.html` → no matches
