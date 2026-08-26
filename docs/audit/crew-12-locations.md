# Location Manager

Judged as the person who has to find the place, hold it, paper it, permit it,
park the trucks, warn the neighbours, keep the crew safe on it, and hand it back
the way it was found.

**Verdict up front.** The permit and soundstage intelligence in `locations/` is
the strongest domain research anywhere in this repo — a location manager would
genuinely use it. Everything downstream of "I found the place" is missing or
broken. You cannot record a recce, hold a date, track an agreement, log a
permit application, plan a basecamp, notify a neighbour, or restore a location.
The one thing the Scout Book promises out loud three separate times — that the
nearest hospital reaches the call sheet — is false: the printed call sheet never
reads it, and the phone call sheet that does read it will print a *different
location's* hospital without saying so.

---

## What exists and works

- `locations/lib-scout.js:23-90` — the six-hub filming-permit directory is real,
  dated and sourced. Toronto: $300 location permit for features / $150
  commercials, $200 parks, $500 road closure, 3–4 business days parks lead time,
  CAD $2,000,000 CGL naming "The City of Toronto, 100 Queen St. W." as
  additional insured. Vancouver: $1,300/day, $2,000 late-night surcharge, 10
  working days, $5,000,000 CGL. NYC: $500 per consecutive 14-day period, COI to
  `insurance@media.nyc.gov` **48 hours before** you may submit. These are the
  numbers a location manager actually needs and they are not invented.
- `locations/lib-scout.js:24-33, 96-147` — the verified/unverified discipline is
  enforced structurally: `applyUrl` and `website` are only populated when
  `verified:true`, and `scripts/test_locations.mjs:24,31` asserts the invariant.
  `locations/index.html:286-288, 324-326` renders a Google search link instead
  of a fabricated URL. This is the right way to ship directory data.
- `locations/lib-scout.js:149, 203, 257, 311, 365, 419` — the per-hub "booking
  reality" paragraphs correctly state that no major stage operator publishes a
  rate card and that everything is direct-quote. That is the true answer and it
  saves a first-timer a week.
- `locations/lib-scout.js:508-521` — the 10-item tech-scout checklist is the
  right ten items (power tie-in, parking measured/legal, load-in dimensions and
  push distance, bathrooms vs crew size, neighbours, noise *at the hour you will
  shoot*, cell coverage per carrier, hospital drive time, permit scope,
  COI delivery before load-in). No padding.
- `locations/lib-scout.js:536-551` — `scriptLocations()` mines sluglines,
  strips leading scene numbers, handles `INT/EXT` and `I/E`, dedupes by set and
  groups scene numbers. Verified by `scripts/test_locations.mjs:111-116`.
- `locations/index.html:129-163` — photos go to IndexedDB (`cinamate_scout`),
  downscaled to 1280px long edge at JPEG 0.85 before storage. Correct call:
  a recce board would blow the localStorage quota in ten photos.
- `locations/index.html:259-271` + `producer/budget-sheet.js:27` — the permit-fee
  button books a real open PO on acct **13000 Locations**, which is a real
  category in the chart of accounts with `Location fees / Permits / Travel &
  living`. The money genuinely lands in the Money Room.
- `tools/lib-sun.js:33-62` — a proper NOAA/Meeus solar engine: longitude-aware,
  civil dawn and dusk at −6°, true golden-hour crossings at +6°, ±2 min.
  `scripts/test_tools.mjs:21-32` pins it against the LA solstice. Good code.
- `safety/lib-safety.js:165-227` — paid-duty police directory (12 cities),
  `paidDutyNeeds()` derives *which scenes* trigger officers from EXT + vehicles /
  weapons / crowds / stunts, and `safety/index.html:202-211` commits the estimate
  to the Money Room. This is directly useful on a street shoot.
- `clearance/lib-clear.js:131-139` + `clearance/index.html:140` — a location
  release template exists and drafts with the address filled in.
- `producer/schedule-board.js:300-344` + `producer/producer.css:135-139` — the
  call sheet exists and prints/PDFs cleanly (black text, chrome hidden).
- `timeline/timeline-locations-enrich.js:94-131` + `netlify/functions/enrich-locations.js`
  — a working location-alias canonicaliser that merges different sluglines for
  the same physical place (AIRPORT TERMINAL ≡ PIERRE TRUDEAU INTERNATIONAL).
  Exactly the problem a location manager has with a sloppy draft.
- 44/44 suites pass; `scripts/test_locations.mjs` carries 49 assertions.

---

## What exists but needs work

### HIGH

- **`locations/lib-scout.js:480-505` — the Locations page uses the wrong sun
  engine, and it is wrong by up to 1h40m.** There are two solar engines in this
  repo. `tools/lib-sun.js` is correct. `CScout.goldenHour()` is a
  Cooper's-declination approximation that returns **local solar time with no
  longitude, timezone or DST correction**, and `locations/index.html:114` never
  loads `lib-sun.js`. Measured, same date, same latitude:

  | Hub | 21 Jun sunset — `TSun` (real clock) | `CScout.goldenHour` |
  |---|---|---|
  | Atlanta | 20:52 | **19:12** |
  | Toronto | 21:03 | **19:43** |
  | Vancouver | 21:23 | **20:07** |
  | London | 21:22 | **20:19** |

  It also defines PM golden as "sunset − 60 min" flat, where `lib-sun.js`
  computes the real +6° crossing. Toronto, 15 Nov: `TSun` says golden starts
  16:11 and you lose the sun at 16:54; `CScout` says 15:48 / 16:48. A schedule
  built on the CScout number puts a company on the wrong side of magic hour.
  The page's own disclaimer ("verify locally") does not make a 100-minute error
  acceptable when the correct engine is already in the repo and tested.
  **Fix:** delete `CScout.goldenHour`, load `/tools/lib-sun.js` on
  `locations/index.html`, and take lon + tz from the location record (see below).

- **`producer/schedule-board.js:300-344` — the nearest hospital never reaches the
  printed call sheet.** `openCallSheet()` reads only `SB_ScheduleBoard_v1`. The
  hospital, address, parking, power and load-in all live in `SB_ScoutBook_v1` and
  are never read. The call sheet's "Locations" block (`:307, :323`) is just
  slugline text — `FARMHOUSE KITCHEN`, not an address anyone can drive to. There
  is no map, no parking instruction, no basecamp, no safety block, no weather, no
  sunrise/sunset. Meanwhile `locations/index.html:78`, `:185` and
  `lib-scout.js:517` all tell the user in plain English that the hospital field
  "feeds the call sheet safety block". It does not. A location manager will fill
  that field, believe it shipped, and it will not be on the paper the crew holds.
  **Fix:** `openCallSheet` should match the day's sets against `SB_ScoutBook_v1`
  and print address + parking + hospital + hospital address + sun times.

- **`today/index.html:98-106` — the phone call sheet will print the wrong
  hospital, silently.** The match is a first-8-characters substring test in both
  directions; if it fails, line 106 unconditionally takes *the first location in
  the book that has any hospital at all* and renders it under the red
  "Nearest hospital" heading with no caveat. Line 104 does the same whenever
  today has no parsed sets (`|| locs.length === 0`). Combined with the weak
  slugline parser at `:91` (below), the failure path is the common one, not the
  rare one. On a location with a medevac question this is the worst kind of
  wrong: confidently wrong. **Fix:** no match ⇒ render "not matched — confirm
  the hospital for today's location", never a fallback.

- **Two disconnected location registers.** `SB_ScoutBook_v1`
  (`locations/index.html:119`) holds name/address/scenes/parking/power/loadIn/
  hospital/hospitalAddress/permitStatus/releaseStatus/photos.
  `SB_Locations_v1` (`production/production.js:127-145`) holds
  name/scenes/address/contact/permit/permitDate/notes. Neither reads the other.
  Only the production one has a contact and a permit date with the expiry chip
  (`tools/tools-core.js:124-127`); only the scout one has a hospital and photos.
  Worse, `workflow/advisor-ui.js:53` and `workflow/advisor.js:164-168` read
  **only** `SB_Locations_v1`, so a location manager who works entirely in the
  Scout Book is told forever "N script locations, none scouted yet" and never
  gets the "permits not yet issued" alert. The two even disagree on vocabulary:
  Scout Book uses `none/applied/issued` (lowercase), the Advisor tests for
  `'Applied'`/`'Denied'`. **Fix:** one record. Migrate `SB_Locations_v1` rows into
  `SB_ScoutBook_v1` on first load, point the production pane and the Advisor at it.

- **`_headers:4` — the weather forecast is blocked by CSP and fails silently.**
  `connect-src` is `'self' blob: data: https://api.themoviedb.org
  https://query.wikidata.org http://127.0.0.1:* http://localhost:*`.
  `tools/sched-weather.js:120` fetches `https://api.open-meteo.com` (built at
  `tools/lib-sun.js:77-81`), which is not on the list, so on the live site every
  forecast request is refused. The `.catch()` at `:135` is empty, so the user
  sees "beyond forecast" and "—" in the Risk column forever with no explanation.
  `scripts/test_tools.mjs:33` only asserts the URL *string*, so the suite passes.
  The same CSP kills the Props module's `nominatim.openstreetmap.org` /
  `overpass-api.de` lookups (`props/lib-props.js:279-280`). **Fix:** add the three
  hosts to `connect-src`, or proxy through a Netlify function; and make the catch
  say "forecast unreachable" rather than nothing.

- **The Scout Book cannot produce a document.** `grep -i "print|csv|download|
  export|@media"` over `locations/index.html` returns **nothing**. There is no
  print stylesheet, no PDF, no CSV, no photo-package export, no email body. The
  entire deliverable of a recce — a per-location page with photos, address,
  hospital, parking, power, load-in and notes that goes to the director, the DP,
  the AD and the producer — cannot leave the browser. Every other register in the
  platform has "Export CSV" (`tools/tools-core.js:140-147`); this one does not.

- **`locations/index.html:126, 360-369` — the tech-scout checklist is global, not
  per-location.** `st.checks` lives at the top of the state object, so ticking
  "Power" on the farmhouse ticks it on the diner, the police station and the
  parking garage. Same for `st.lat` / `st.date` — one latitude for the whole
  show. On a 20-location feature this makes the checklist actively misleading:
  it reports done work that was never done. **Fix:** move `checks` (and lat/lon/
  date) onto the location record.

### MED

- **`locations/lib-scout.js:524-533` — a location record has no coordinates, no
  timezone, and no dates.** `blankLocation()` produces
  `{id,name,address,scenes,hospital,hospitalAddress,parking,power,loadIn,notes,
  permitStatus,releaseStatus,photos}`. No `lat`/`lon`/`tzOffset`, so per-location
  sun and weather are impossible and the user must retype a latitude by hand
  (`locations/index.html:101`). No `contact`/`phone`/`email` for the owner. No
  `holdDates`, `prepDate`, `shootDates`, `wrapDate`, `permitAppliedOn`,
  `permitExpires`, `agreementExpires`, `fee`, `noise`, `restrictions`. Adding
  `lat/lon/tz` is the unlock for four other findings at once.

- **`projects/lib-vault.js:26-44` — recce photos do not travel with the
  production.** `snapshot()` enumerates `localStorage` only. The photos are in
  IndexedDB `cinamate_scout`, which is (a) never included in a `.cinamate`
  archive or the studio-cloud sync, and (b) **not namespaced per project**, so
  switching projects leaves orphans in a shared store while the new project's
  photo ids resolve to nothing. When they resolve to nothing,
  `locations/index.html:209` removes the `<img>` from the DOM with no message —
  the scout board just quietly empties. `today/index.html:51` explicitly tells
  the user to "pull the production from the studio cloud on this device", which
  is precisely the operation that loses the photos. **Fix:** key the object store
  by project slot, and either include a photo manifest in the archive or warn
  clearly on export.

- **`locations/lib-scout.js:437-448` — the fuzzy hub matcher has no region
  qualifier and returns the last match, not the best.** Verified:
  `permitFor('London, Ontario')` → **London UK** (£ fees, Film London apply
  URL); `permitFor('Vancouver, Washington')` → **Vancouver BC** (CAD $1,300/day);
  `permitFor('New York, Lincolnshire')` → **New York City**;
  `permitFor('york')` → New York; `permitFor('Los Angeles, Chile')` → FilmLA.
  These are all real production towns. The UI then stamps the result with a green
  `verified` chip (`locations/index.html:291`). Filing against the wrong
  jurisdiction means missing the lead time and arriving without a permit.
  **Fix:** require a country/region token to disambiguate same-name hubs, and
  show "did you mean" rather than silently picking one.

- **Stale and contradictory honesty labelling.** `locations/index.html:301`
  prints *"this build could not verify fees or application URLs against the
  official pages, so none are shown"* directly underneath six fee schedules and
  a live Apply button. `locations/index.html:322` hard-codes the tag
  `unverified guidance` on the stage card even when every facility in it is
  `verified:true`. And the module header at `locations/lib-scout.js:8-15` is
  garbled mid-sentence — *"anything else stays / was built, so every entry ships
  verified:false"* — asserting the exact opposite of the data below it, where all
  six permit entries are `verified:true`. A location manager cannot tell which
  claim to believe, which is worse than either answer alone.

- **`locations/index.html:262-271` — the fee commit forgets everything.** The
  amount is read from the input, posted as a PO, and the input cleared; nothing
  is written back to the location record, so the Scout Book never knows what a
  location cost. The vendor is hard-coded `'Film permit office'` and the account
  hard-coded `'13000'`. There is **no path at all** for the location fee itself —
  the owner's day rate, usually the largest single line in acct 13000 — nor for
  the site rep, the security guard, the cleaning, or the damage deposit.

- **`today/index.html:91` — the phone call sheet has a weaker slugline parser
  than the board.** It splits on a plain hyphen only and does not strip a leading
  scene number, where `producer/schedule-board.js:50-53` handles `[-—–]` and the
  number. Measured on the same headings:

  | Heading | `today/` | `schedule-board` |
  |---|---|---|
  | `INT. FARMHOUSE KITCHEN – NIGHT` (en dash) | `FARMHOUSE KITCHEN – NIGHT` | `FARMHOUSE KITCHEN` |
  | `12. INT. FARMHOUSE KITCHEN - NIGHT` | `12. INT. FARMHOUSE KITCHEN` | `FARMHOUSE KITCHEN` |

  Numbered sluglines and en/em dashes are both normal in imported Final Draft /
  PDF scripts. This garbles the "Sets / locations" block *and* is the direct
  cause of the hospital-fallback path above. **Fix:** export `locOf()` and use
  the one parser everywhere.

- **`locations/lib-scout.js:536-551` — `scriptLocations()` ignores the
  locationBible aliases.** It dedupes on raw slugline text, so a draft that calls
  one set three things produces three scout-book entries and three sets of
  permits. The canonicaliser that solves this already exists and already ran
  (`timeline/timeline-locations-enrich.js:175-214`, stored on
  `SB_Timeline_v1.locationBible`). Consume it.

### LOW

- `locations/index.html:153` — recce photos are hard-capped at 1280px on the long
  edge. That is fine for a thumbnail strip and too small for a DP or designer to
  judge a wall, a window line or a ceiling height. Keep one full-resolution copy
  per location, or make the cap a setting.
- `production/production.js:151-152` — `Sun.fmtLocal(t.sunrise)` is called with no
  tz argument, so `tools/lib-sun.js:66` falls back to **the browser's** timezone.
  A producer in Toronto planning a Vancouver shoot gets times three hours wrong.
- `locations/lib-scout.js:424-428` duplicates `safety/lib-safety.js:180-184`.
  The safety copy knows New Mexico, Louisiana, Ireland, Australia and NZ; the
  scout copy does not. Two maps of the same fact will drift.
- `locations/lib-scout.js:27, 30-31, 38, 41-42, 60, 71, 82` — several directory
  strings are truncated mid-word ("when production vehicles park on City stree",
  "Certificate", "billed directly to the production "). Harmless but it reads as
  broken data next to otherwise careful research.

---

## What is missing entirely

Ranked by what actually stops a shoot.

1. **Location agreement records and status pipeline — HIGH.**
   `releaseStatus` is a three-value dropdown (`none/sent/signed`) attached to
   nothing. A real agreement carries: owner/agent name and contact, fee and
   payment terms, the exact dates and hours granted (prep / shoot / wrap
   separately), what the production may alter, restoration obligation, damage
   deposit, cancellation and weather-day terms, insurance limits and additional
   insured wording, parking rights, and whether the owner has signed *and*
   countersigned. `clearance/lib-clear.js:131-139` drafts a single paragraph with
   an address in it — nowhere near sufficient to sign. **Attach to:** `locations/`
   for the record, `clearance/lib-clear.js` for the document generator.
   **Build:** a `agreements` array on the location record, a longer template with
   a fee/dates/hours/restoration block, and a status chip on the location card.

2. **Permit tracking as records, not a directory — HIGH.**
   The directory tells you *what a Toronto permit costs*. Nothing lets you record
   *this* permit: jurisdiction, application date, lead-time countdown against the
   shoot date, permit number, conditions attached, parks/road-closure/SFX riders,
   fee paid, officer contact, issue and expiry dates. `tools/tools-core.js:124-127`
   already renders an expiry chip (`EXPIRED` / `12d`) for any register with an
   `expiryField` — the machinery exists, it just was never pointed at permits.
   **Attach to:** `locations/`. **Build:** a permits array per location using the
   existing Register pattern, plus a "lead time" warning that compares
   `permitAppliedOn` against the hub's `leadTime` string.

3. **Nearest-hospital lookup and a real safety block on the printed call
   sheet — HIGH.** Today the hospital is typed by hand and reaches only the phone
   page. It needs: an automatic lookup (`props/lib-props.js:279-308` already
   implements keyless Nominatim geocoding + Overpass POI search — an
   `amenity=hospital` query around the location's lat/lon is the same code with a
   different filter), drive time, a map link, a tel link, and printing on the
   call sheet next to the location address. **Attach to:**
   `producer/schedule-board.js:300` and `today/`. **Blocked by:** the CSP finding
   above — needs `nominatim.openstreetmap.org` in `connect-src` or a proxy.

4. **Parking, basecamp and unit layout plan — HIGH.**
   Nothing in the platform draws where the trucks go. "basecamp", "honeywagon"
   and "crew parking" appear only as words inside the checklist strings; there is
   no layout tool, no truck inventory, no measured lot. **Attach to:** `sets/`.
   `sets/lib-set.js:41-45` already takes arbitrary width/height in feet,
   `:130-145` draws a 1-ft grid with a 5-ft scale bar, and `sets/index.html:64`
   exports PNG "for call sheets and email". **Build:** basecamp stencils at real
   dimensions (40′ trailer, honeywagon, 10-ton grip truck, camera truck,
   generator + cable run, catering, crew park bay, tech tent, base tent), a
   grid-step option so a 400′×300′ lot does not draw 700 grid lines, and a
   plan-per-location link. Genuinely close to free given the existing engine.

5. **Weather that actually runs, wired to shoot dates and locations — HIGH.**
   The engine is written and correct (`tools/lib-sun.js:77-98`, including a
   `shootRisk()` score blending rain probability, wind and storm codes) and the
   UI is built (`tools/sched-weather.js`). It is dead in production because of
   the CSP. Beyond unblocking it: it takes one lat/lon for the whole schedule
   rather than per-location, it is not on the Locations page at all, and there is
   no cover-set suggestion ("Day 9 exterior scores 78 — swap with the Day 12
   interior"). **Attach to:** `locations/` per record and
   `producer/schedule-board.js` per day.

6. **A recce / scout report export — HIGH.** The deliverable of the job.
   Per-location: photos at usable size, address, coordinates, contact, hospital,
   parking, power, load-in, noise, restrictions, sun times for the shoot date,
   permit and agreement status. Print-to-PDF is enough — `producer/producer.css:135-139`
   shows the pattern (`body.cs-printing` hides chrome and forces black text).
   **Attach to:** `locations/`. Small build, very high value.

7. **Restoration / wrap-out checklist with before-and-after photo pairs —
   MED-HIGH.** The damage deposit and the owner's willingness to have the
   industry back both turn on this. The photo store already exists
   (`locations/index.html:129-146`); it needs a `phase: 'before'|'after'` tag,
   a paired view, and a wrap checklist (floors protected and lifted, walls made
   good, fixtures rehung, gaffer tape residue, landscaping, rubbish removed,
   keys returned, owner walkthrough signed, deposit released).
   **Attach to:** `locations/`.

8. **Neighbour notification letters and a distribution log — MED-HIGH.**
   Nothing in the repo mentions neighbours except one checklist string
   (`lib-scout.js:514`). A notification letter needs: production name, dates and
   hours, what will happen (lighting, generators, gunfire, road closures,
   intermittent traffic control), the location manager's mobile, and a complaint
   line — plus a log of which addresses were served and when, because "we
   notified" is the first thing challenged when a shoot is shut down.
   **Attach to:** `clearance/lib-clear.js` (it already drafts letters —
   `materialsRequest`, `appearanceRelease`, `locationRelease`, `syncRequest`) for
   the template, `locations/` for the served-log.

9. **Sun path and shadow direction, not just times — MED-HIGH.**
   The brief question "what is the sun doing at 4pm in November" is half
   answered: `tools/lib-sun.js` gives you 16:11 golden / 16:54 sunset in Toronto,
   but nothing gives you *azimuth and elevation*, which is what decides which
   wall is the key and whether the hero window backlights or flares. The Meeus
   machinery in `lib-sun.js:15-29` already computes declination and hour angle —
   azimuth is a few lines more. **Attach to:** `tools/lib-sun.js` +
   `locations/index.html`, ideally with a compass rose on the location card and,
   later, an overlay on the `sets/` plan.

10. **Location hold calendar and clash detection — MED.**
    No dates on a location record at all, so you cannot hold a place, cannot see
    that two units want the same location on the same day, and cannot see that
    the stripboard moved off the date you hold. **Attach to:**
    `producer/schedule-board.js` (it owns `dayMeta` and the day dates) reading
    hold dates off the location record.

11. **Company-move and travel-time modelling — MED.**
    `producer/schedule-board.js:93-111` can group scenes by location to reduce
    moves — good — but nothing costs a move in minutes or dollars, and nothing
    warns when two locations scheduled on the same day are 40 minutes apart.
    With lat/lon on the record this is a distance calculation.
    **Attach to:** `producer/schedule-board.js`.

12. **COI request and tracking per location — MED.**
    `tools/tools-registers.js:100-112` already has an insurance register with
    `insured` (additional insured), limits, effective and expiry with a 30-day
    warning chip. It is not linked to a location, and it is not pre-filled from
    the permit directory — which already carries the *exact* wording each city
    demands (`lib-scout.js:30`: `"The City of Toronto, 100 Queen St. W.,
    Toronto, Ontario M5H 2N2"`, `:41`: Vancouver's $5M with cross-liability).
    Joining these two is cheap and removes the single most common reason a
    permit gets bounced. **Attach to:** `locations/` ↔ `tools/#insurance`.

13. **Per-location cost tracking — MED.** Acct 13000 has three global lines.
    Nothing rolls up "the farmhouse cost $14,200 all-in" — fee, permit, police,
    parking, cleaning, restoration. **Attach to:** `finance/lib-money.js` (tag POs
    with a `locId`) + a per-location total on the scout card.

14. **Sound and noise survey record — LOW-MED.** The checklist tells you to
    listen for flight paths, HVAC, schools and church bells at the hour you will
    shoot; there is no field to write down what you heard, and no way to flag
    "school bell 15:20, avoid dialogue" onto the day it matters.
    **Attach to:** the location record + the call sheet notes.

---

## Evidence

Files read in full: `locations/lib-scout.js` (561 ln), `locations/index.html`
(383 ln), `tools/lib-sun.js` (102 ln), `tools/sched-weather.js` (160 ln),
`tools/tools-core.js` (167 ln), `safety/lib-safety.js` (326 ln),
`safety/index.html` (290 ln), `clearance/lib-clear.js` (153 ln),
`clearance/index.html` (154 ln), `producer/schedule-board.js` (475 ln),
`production/lib-prod.js` (182 ln), `today/index.html` (157 ln),
`projects/lib-vault.js` (326 ln), `scripts/test_locations.mjs` (119 ln),
`_headers`, `.netlifyignore`, `_redirects`.
Read in part: `production/production.js:100-170`, `workflow/advisor.js:55-184`,
`props/lib-props.js:270-320`, `props/index.html:340-375`, `sets/lib-set.js:1-62,
130-153`, `producer/budget-sheet.js:15-36`, `finance/lib-money.js:1-60`,
`tools/tools-registers.js:100-115`, `timeline/timeline-locations-enrich.js:90-150`,
`netlify/functions/enrich-locations.js`, `producer/producer.css:99-140`,
`producer/index.html:157-167`.

Claims verified by execution, not by reading:

- Sun-engine divergence — ran `TSun.sunTimes` and `CScout.goldenHour` side by
  side for Toronto / Atlanta / Vancouver / London / Albuquerque on 2026-06-21 and
  Toronto on 2026-11-15. Numbers in the table above are the measured output.
- Fuzzy hub mis-matching — ran `CScout.permitFor()` on `'London, Ontario'`,
  `'Vancouver, Washington'`, `'New York, Lincolnshire'`, `'Los Angeles, Chile'`,
  `'york'`, `'ondon'`, `'Hamilton, Ontario'`. Results as quoted.
- Slugline parser divergence — ran `today/index.html:91`'s expression and
  `schedule-board.js:50-53`'s `locOf()` on four headings. Results as quoted.
- CSP block — `_headers:4` `connect-src` enumerated; `api.open-meteo.com`,
  `nominatim.openstreetmap.org` and `overpass-api.de` are absent. `netlify.toml`
  sets no CSP (its `[[headers]]` block at :34-40 carries only X-Frame-Options,
  nosniff, Referrer-Policy, Permissions-Policy), and `_headers` is not in
  `.netlifyignore`, so it ships.
- Store isolation — `grep -rn "SB_ScoutBook_v1"` across the deployed tree returns
  exactly two hits: `locations/index.html:119` and `today/index.html:95`.
- No export in the Scout Book — `grep -i "print|csv|download|export|@media"` over
  `locations/index.html` returns zero matches.
- No domain coverage for basecamp / recce / restoration / neighbour /
  hold dates / sun path — grepped each term across `--include=*.js --include=*.html`
  excluding `node_modules`, `.git`, `private`, `local-backend`, `docs`. Only hits
  are the checklist strings in `locations/lib-scout.js:512, 514`.
- `node scripts/run_all_tests.mjs` — **44/44 suites pass**, `test_locations: 49
  passed, 0 failed`. Nothing in this report was left failing; no file was edited.
