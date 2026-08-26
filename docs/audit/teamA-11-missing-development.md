# Team A Dev 11 — what is missing in development, story and the script

Scope: idea → locked shooting script. Everything below was checked against the
repo before it was called missing; each "missing" item names the search I ran
and the files I read. Where a thing already exists under another name I say so
and do not claim it.

A prior report, `docs/audit/crew-01-development-story.md`, already covers:
premise/logline capture, beat-sheet structure, reader's coverage, locked scene
numbers, pagination, character arc fields, comps, table read, scene-granular
rewrite tracking, draft provenance. I do not re-argue those. Where I touch the
same ground I add only a new, separately verified consequence and say so.

---

## What exists and works

- `tools/lib-script.js:14-37` — `diffLines` is a real LCS line differ, not a
  naive comparison. `diffStats` (`:39`) counts add/del. Correct and fast enough
  for a screenplay.
- `tools/lib-script.js:46-49` — `REV_COLORS` is the correct production order
  (White → Blue → Pink → Yellow → Green → Goldenrod → Buff → Salmon → Cherry →
  2nd Blue → 2nd Pink) with a hex per colour. Right list, right sequence.
- `tools/tools-script-ui.js:45-54` — snapshotting the Studio script as the next
  colour, storing `{color, saved, lines, text}` in `SB_Drafts_v1`, works.
  `tools/tools.css:46` puts the industry asterisk change-bar before added lines.
- `tools/tools-registers.js:128-149` — the Rights / Chain of Title register is
  genuinely the right field set: material, agreement kind (including
  *Underlying rights*, *Option*, *Purchase*, *Life rights*, *Writer
  agreement*), counterparty, territory, media, term start, term end /
  reversion, fee, status. It flags un-executed rows as a chain gap
  (`:143-148`). **Rights-in is not missing** and I do not claim it is.
- `clearance/lib-clear.js:1-46` — the pre-E&O script clearance read (brands,
  non-555 phone numbers, artwork, archival, real persons, currency, signage)
  with the standard action per category. Substantial and correct in kind.
- `casting/lib-castdesk.js:54-80` — `charactersFromScript` already returns
  `{name, scenes, lines, sceneList}` sorted by dialogue-cue count, and
  `:114-131` `sidesFor(scriptText, character)` already assembles per-character
  audition sides. Role size and sides are solved; several "missing" items below
  are cheap *because* of this.
- `screening/lib-screen.js:17-40` — sessions with author, timecoded notes,
  open/addressed status. The right model, currently keyed to `{sec}`.
- `projects/lib-vault.js:87-156` — the incoming-archive sanitiser is the most
  carefully reasoned code in the repo. Not my lane, but it is right.
- `writer/lib-treatment.js` — `docxParagraphs` (`:25`), `cleanText` (`:46`) and
  `parseTreatment` (`:135`) do a real job on a real treatment. 44/44 suites
  pass today (`node scripts/run_all_tests.mjs`, run 2026-08-26).

---

## What exists but needs work

### HIGH — `SB_Deals_v1` is claimed by two different modules with incompatible shapes

`contracts/index.html:77` sets `KEY = 'SB_Deals_v1'` and `:86` does
`var st = readLS(KEY) || D.blank()`, where `CDeal.blank()` is
`{v:1, deals:[]}` (`contracts/lib-deal.js:22`). `render()` at `:91` calls
`st.deals.forEach`.

`tools/tools-registers.js:157` builds a `TCore.Register` on the **same key**.
`tools/tools-core.js:60` does `this.rows = load(schema.key, [])` and
`Register.prototype.render` (`:105`, `:111`) calls `s.summary(this.rows)` and
`this.rows.forEach`; `add` (`:65`) calls `this.rows.unshift`.

So whichever surface writes last breaks the other, in the same workspace:

- Add one Buyers & Investors row → `SB_Deals_v1` becomes an **array** → the
  Deal Memos page throws at `contracts/index.html:91` (`st.deals` is
  `undefined`) and renders nothing. Every drafted memo is invisible.
- Draft one deal memo → `SB_Deals_v1` becomes an **object** → the Buyers &
  Investors tab throws at `tools/tools-core.js:105` (`rows.filter` is not a
  function) and the tab is dead.

Both surfaces are reachable in the shipped app (`tools/index.html:62`,
`contracts/index.html`), and the vault snapshots the key either way
(`projects/lib-vault.js:15` `KEY_RE` matches it), so the broken state travels
into `.cinamate` archives and the studio cloud. **Why it matters:** the two
records that must survive to closing — who you owe and who owes you — silently
erase each other. **Fix:** move the buyers pipeline to a new key
(`SB_Buyers_v1`) with a one-time migration that reads `SB_Deals_v1`, and only
adopts it when `Array.isArray`. Small. Do not rename the contracts key — live
owners have signed memos under it (BRIEF, "never rename an existing `SB_*`
key").

### HIGH — the Revisions tab cannot snapshot what the Writer produced

`tools/tools-script-ui.js:47` reads `projectState().scriptText`, i.e.
`SB_Timeline_v1` only. A draft that lives in the Writer (`SB_Writer_v1`) cannot
be snapshotted until it has been pushed to the Studio, and once pushed there is
no way back (see missing #4). **Why it matters:** the White draft — the one
everything else is measured against — is the one most likely to exist only in
the Writer. **Fix:** in `rvSnap`, fall back to `TWriter.toFountain` over
`SB_Writer_v1` when `scriptText` is empty. Ten lines.

### HIGH — a draft record carries no author and no reason

`tools/tools-script-ui.js:50` pushes `{color, saved, lines, text}`. No author,
no note, no date-of-revision distinct from date-of-snapshot, no link to the
notes that caused it. **Why it matters:** three months later nobody can say why
Blue became Pink, and on a multi-writer show nobody can say who wrote Pink —
which is the input to a WGA credit determination (missing #5). **Fix:** add
`{by, note, revDate}` to the row and two inputs above the snapshot button.
Small, and it is a prerequisite for writing credit.

### MED — the storyboard is orphaned by any scene insertion

`boards/lib-shots.js:27` builds a scene slug as
`'SC' + String(c.num || i+1).padStart(2,'0') + ' — ' + c.label`, where `c.num`
is the positional clip counter from `timeline/parser.js:611-616`.
`boards/boards.js:325-327` re-seeds by matching `by[s.slug]`. Insert one scene
in a revision and every slug from that point on shifts, so **every framed
storyboard panel after the insertion point silently detaches** — and the toast
at `:330` still says "existing boards kept where slugs match". This is a
distinct downstream victim of the missing scene-number lock (crew-01 #4 cited
wardrobe, safety, vfx and dailies; boards is a fifth, and the only one that
loses hand-drawn artwork). **Fix:** match on a stable scene id once numbers are
locked; until then match on the slugline text rather than the ordinal prefix.

### MED — deletions are not marked the way a production marks them

`tools/tools.css:46` sets `.tk-difwrap .add::before{content:'* '}` — added
lines get the asterisk. `:45` renders deleted lines struck through. On a real
revised page a deletion is signalled by an asterisk beside the *surviving*
line, because the deleted text is gone from the page. Screen-reading a diff and
distributing a revision are different artefacts. **Fix:** belongs with the page
model (missing #3), not with the CSS.

### MED — the rights clock only ticks when you are looking at it

`tools/tools-registers.js:130` sets `expiryField:'termEnd'`, and
`tools/tools-core.js:124-127` renders an `EXPIRED` / `Nd` chip — but only
inside that tab's own table. `today/index.html` reads
`SB_ScheduleBoard_v1` (`:66`), `SB_Timeline_v1` (`:85`) and `SB_ScoutBook_v1`
(`:95`) and nothing else. **Why it matters:** an option that lapses unnoticed
ends the project; it is the single highest-consequence date in development and
it is invisible on the daily surface. **Fix:** `today/` reads `SB_Rights_v1`
and surfaces any `termEnd` inside 90 days. Tiny — an hour.

---

## What is missing entirely

### 1. Series / episodic structure — value: HIGHEST

**Where I looked.** `grep -rniE "\bepisode\b|\bepisodes\b|\bseason [0-9]|S[0-9]{2}E[0-9]{2}|limited series|anthology|pilot|showrunner"` across every `.js` and `.html` outside `node_modules`, `static/vendor` and `docs/` — **zero hits**. The only `season` in the codebase is a weather parameter (`timeline/timeline.js:42`, `:1206`). The only `pilot` is an aircraft cue in `writer/lib-treatment.js:83`.

**What it is.** A season is one bible, one cast, one crew, one location set, one rights chain, one budget — and N scripts, each with its own draft/revision state, its own schedule block and its own delivery.

**What exists instead.** `projects/lib-vault.js:227-241` `switchTo` stashes the whole live workspace into a named slot and overwrites localStorage with the target slot. Every `SB_*` key is duplicated per slot (`:37-44` `snapshot` takes all of them). So an eight-episode season is eight unrelated whole-workspace copies: eight copies of the Story Bible, eight of the Crew register, eight of the Rights chain, drifting apart from the first edit. There is no view that shows two at once, no cross-episode DOOD, no "which episodes is this actor in", and `inventory` (`:286`) reads one slot's stores at a time.

**Attach to.** `projects/` (vault) plus a slate view; `workflow/` for a per-episode pipeline column.

**Data model.** `CIN_Projects_v1` slot gains `{kind:'episode', series:<seriesId>, ep:{season, number, title}}`. New key `SB_Series_v1` holding the keys an episode *inherits rather than copies* — `SB_Bible_v1`, `SB_Crew_v1`, `SB_Rights_v1`, `SB_Locations_v1`. `CVault.switchTo` writes the series-level keys from `SB_Series_v1` and only the episode-level keys from the slot; `saveActive` writes series-level keys back to `SB_Series_v1`. `isPortable` (`:24`) already gives the partition point.

**Size.** Medium — the vault change is contained (one new predicate, two branches in `switchTo`/`saveActive`), the slate view is a new page, and nothing downstream changes because each episode still sees exactly the workspace it sees today. This is the single change that takes the platform from "serves a feature" to "serves any TV or streaming project", which is where the money is.

---

### 2. A development deal desk — option / purchase / writer step deals — value: HIGH

**Where I looked.** `contracts/lib-deal.js` in full. The only two deal shapes are `fromCrewRow` (`:24`, `kind:'crew'`) and `castDefaults` (`:30`, `kind:'cast'`); `memoText` (`:72`) prints `CREW DEAL MEMO` or `CAST AGREEMENT (short form)`. `grep` for `option agreement|step deal|purchase price|reversion` in `contracts/` and `tools/` returns nothing beyond the Rights register's dropdown labels.

**What it is.** The first three contracts on any picture are the option (or purchase) of the underlying material, the writer's agreement with its step schedule, and the shopping/NDA cover. The Rights register (`tools/tools-registers.js:133`) *records that they exist* and stores a fee, but generates no document, holds no step schedule, and — the load-bearing gap — has no `toCommitment` path. `contracts/lib-deal.js:60-66` `toCommitment` turns a signed crew or cast deal into an open PO on account 2000/3000 that `finance/lib-money.js:27,64-81` picks up in the cost report. Nothing does that for development. Meanwhile `js/budget-engine.js:636` estimates `1000 · Story & rights` from a budget-tier band (`:70-75` `scriptRights`) that no actual can ever land against, so the one account that is *already spent* before principal photography is the one account the cost report cannot see.

**Attach to.** `contracts/` (`CDeal`), reading the Rights register.

**Data model.** Add `kind:'option'` and `kind:'writer'` to `CDeal`.
`option`: `{material, licensor, optionFee, term, extensions:[{months,fee}], purchasePrice, exerciseBy, reversionOn}`.
`writer`: `{writer, steps:[{label:'Commencement'|'First draft'|'Set of revisions'|'Polish', amount, dueOn, deliveredOn, paid}], creditForm, bonuses}`.
Extend `toCommitment` (`:60`) to emit one PO per unpaid step on account `1000`, and `memoText` to print both. Store under the existing contracts key — **after** the `SB_Deals_v1` collision above is fixed, or the new rows will be eaten by the buyers register.

**Size.** Small-to-medium; it is the same shape as the two deals already there, and the commitment path already exists.

---

### 3. A page model — so a "coloured page" is a page — value: HIGH

*(crew-01 raised pagination as #5; I keep it because my domain is the **distribution** side of a revision and that is a separate artefact from a diff.)*

**Where I looked.** `grep -rniE "paginat|pageCount|@page"` across `.js`/`.css`: no page model anywhere. `@media print` exists in `production/index.html:46`, `producer/producer.css:99`, `boards/boards.css:57`, `css/cinamate-ui.css:163` — call sheets, top sheets and boards print; **the script does not**. `writer/writer.css` has no print block at all.

**What a production actually distributes** on a revision is not a diff on screen: it is the changed pages only, on the current colour stock, with `Rev. Pink 08/26/26` in the header, an asterisk in the margin beside each changed line, A-pages where an insert overran, and a cover listing the changed pages and scenes. `tools/tools-script-ui.js:75-87` shows a scrolling add/del list, which is a code review, not a revision.

**Attach to.** A new `tools/lib-paginate.js` beside `tools/lib-script.js`, pure and node-testable per the BRIEF, consumed by (a) a Writer page view, (b) `timeline/timeline-budget.js:290-293`, where `eighths` is currently `lines.length / LINES_PER_EIGHTH` over raw newlines rather than over laid-out pages, and (c) the Revisions tab.

**Data model.** `paginate(fountainText) → [{page, revColor, lines:[{kind:'slug'|'action'|'cue'|'paren'|'dialogue'|'trans', text, changed}]}]`. Rules are fully specified and need no data: ~55 lines per page, action wraps at 60 characters, dialogue at 35, cue indented 33.

**Size.** Medium, one module, no dependencies. It unblocks four separate broken things at once, and it is the prerequisite for #6.

---

### 4. Treatment → script traceability (fidelity checking) — value: MED-HIGH

**Where I looked.** `writer/writer.js` in full, `boards/lib-shots.js:22-34`, `tools/tools-script-ui.js`.

**The gap.** `writer/writer.js:208-218` `wrToStudio` writes exactly two fields — `studio.scriptText` and `studio.projectName` — and navigates away. The beat array, with each beat's slug, body and detected characters, stays behind in `SB_Writer_v1` and is read again in exactly one place: `boards/lib-shots.js:30-33`, and only as a *fallback* when the timeline has no clips (`:23-29` prefers clips). The Writer itself never reads `SB_Timeline_v1.scriptText` — `writer/writer.js:7-13` loads only its own key. So the door is one-way: revise in the Studio and the Writer still shows the pre-Studio beats forever, with no warning that they are stale.

**Why a production needs it.** The financier bought the treatment. The question asked at every draft — "is this still the film we financed, and which beat did we lose?" — cannot be asked here at all.

**Attach to.** `writer/lib-treatment.js`.

**Data model.** Give each beat a stable `bid` at parse time; `toFountain` (`:220`) emits it as a Fountain note (`[[bid:b7]]`) after each slugline — plain text, survives every round trip, invisible in any Fountain reader. Then `TWriter.fidelity(beats, scriptText) → {kept:[bid], dropped:[bid], added:[sceneIdx], reordered:[bid]}`, rendered as a two-column beat-to-scene map in the Writer and as a metric on the `workflow/` Develop card (which today is the boolean at `workflow/workflow.js:38`).

**Size.** Small. Pure, node-testable, extends `scripts/test_writer.mjs`.

---

### 5. Writing credit, and the writers' room — value: MED-HIGH

**Where I looked.** `grep -rniE "writers? ?room|WGA|screenplay by|story by|arbitration"` across `.js`/`.html`: the only `WGA` in the repo is a title-page keyword in `timeline/parser.js:25` and a comment about WGA minimums in `timeline/timeline-budget.js:68`. No credit determination anywhere.

**The gap, concretely.** The Crew register's `dept` options (`tools/tools-registers.js:33`) are `Production, Camera, Sound, G&E, Art, Wardrobe, HMU, Edit, Post, Other` and its `union` options (`:34`) are `Non-union, IATSE, DGA, SAG-AFTRA, Teamsters, Other`. **There is no Writing department and no WGA**, so the writer cannot be entered in the one directory the platform treats as the crew. Consequently the Credit Roll seeds title + cast + crew (`tools/tools-media-ui.js:333-346`) and **cannot produce a "Screenplay by" card at all** — the first card on the picture. Nothing models the WGA `&` (a team) versus `and` (successive writers) distinction, which is the difference between two credits and one.

**Attach to.** `tools/tools-registers.js` (two dropdown additions), `SB_Credits_v1` seeding, and the draft record from the HIGH item above.

**Data model.** `SB_Drafts_v1` rows gain `by:[{name, team}]`; a `creditForm(drafts) → 'Screenplay by A & B and C'` helper joins teams with `&` and successive writers with `and`. Add `Writing` to `dept` and `WGA` to `union` — additive, no rename, no migration.

**Size.** Small. Very high ratio of visible value to work.

---

### 6. A revised-pages distribution — value: MED-HIGH (needs #3)

**Where I looked.** `tools/tools-script-ui.js:21-89` in full; `grep` for `changed pages|revised pages|A-page`: nothing.

Once #3 exists, the missing artefact is small and specific: **"export revised pages"** — a printable set containing only the pages that changed, on the current colour, with the change-bar margin and a cover sheet listing changed page numbers and changed scene numbers. Today the Revisions tab can tell you 41 lines were added; it cannot tell the 1st AD which scenes to re-strip or the art department which pages to reprint.

**Attach to.** `tools/tools-script-ui.js` `showDiff` (`:75`), over `lib-paginate`.
**Data model.** `revisedPages(prevPaged, nextPaged) → {pages:[n], scenes:[num], aPages:[n]}`.
**Size.** Small on top of #3.

---

### 7. Script submission tracking — who has which draft — value: MED

**Where I looked.** `grep -rniE "submission|query letter|script sent|pitch meeting"` across `.js`/`.html`: every hit is either a video-generation job (`app.html:2560`, `:7414`, `:9068`) or a casting candidate status (`casting/lib-castdesk.js:4`, `casting/index.html:254`). `SB_Deals_v1`'s buyers register (`tools/tools-registers.js:157-166`) has a `Screener sent` stage — that is the finished film going to distributors, not a script going to readers.

**What it is.** The development office's core record: who received which draft, on what date, under what cover (NDA / submission release), and what came back. It is also the evidence trail if someone later claims the idea.

**Attach to.** `tools/` as a new tab — `TCore.Register` (`tools/tools-core.js:58`) gives CRUD, the expiry chip and CSV-injection-safe export (`:80-95`) for free.

**Data model.** `SB_Submissions_v1`: `{recipient, company, kind:'Agent'|'Manager'|'Producer'|'Financier'|'Actor'|'Director'|'Contest', draft (the colour from SB_Drafts_v1), sent (date), release:'NDA'|'Submission release'|'None', response:'Out'|'Reading'|'Pass'|'Notes'|'Offer', respondedOn, notes}`.

**Size.** Small — one schema object, roughly the size of `TTabs.festivals` (`tools/tools-registers.js:68-93`).

---

### 8. Table read — value: MED, and cheaper than it looks

**Where I looked.** `grep -rniE "table ?read|read-?through"`: nothing.

**Why it is cheap here.** Two of the three artefacts already exist:
`casting/lib-castdesk.js:114-131` `sidesFor(scriptText, character)` builds
per-character sides today, and `:54-80` gives the line and scene count per
role. The third — timed notes against scenes — is
`screening/lib-screen.js:17-40` with `sec` swapped for a scene reference.

**What is left to build.** A read session: `{date, cast:{role→reader}, scenes:[{num, startedAt, endedAt}], notes:[…]}`, producing a per-scene runtime that is a far better page-to-minute estimate than `writer/lib-treatment.js:258`'s flat 1-page-per-minute. Attach to `screening/` (a second session `kind`), key `SB_Screening_v1` extended rather than a new key.

**Size.** Small, mostly reuse.

---

### 9. Comparable titles as data — value: MED

*(crew-01 raised this as #7; one point to add.)* `producer/sales-forecast.js:175`
`buyoutComps(budget)` returns `budget × [0.5, 1.3]` and `budget × [2, 10]` — a
band derived from your own budget, not from any title. The only story input the
forecast receives is a genre string inferred by keyword counting
(`js/budget-engine.js:299-323`). The addition worth making: per the BRIEF's
"never invent a price", a comps register must store only figures the owner
types in, and offer a Google search link for anything unverified — exactly the
pattern the repo already uses elsewhere. `TCore.Register` gives the whole thing
for free. Key `SB_Comps_v1`, read by `sales-forecast.js:245` in place of the
bare genre. Small.

---

## Explicitly NOT missing — checked and found

Recording these so nobody rebuilds them:

- **Coloured-page revision naming and diffing** — `tools/lib-script.js:46`,
  `tools/tools-script-ui.js:21-89`. Exists. What is missing is the *page*, not
  the colour (see #3).
- **Rights-in / chain of title** — `tools/tools-registers.js:125-150`. Exists,
  with the right agreement kinds including Option, Purchase, Life rights and
  Writer agreement. What is missing is the document and the payment schedule
  (see #2), not the register.
- **Script clearance** — `clearance/lib-clear.js`. Exists and is thorough.
- **Audition sides and role size** — `casting/lib-castdesk.js:54-131`. Exists.
- **Story bible** — `tools/tools-script-ui.js:92-129`, `SB_Bible_v1`, seeded
  from parsed characters and locations. Exists.
- **Multi-project switching** — `projects/lib-vault.js:207-283`. Exists, but
  models projects as disjoint copies (see #1).
- **Camera coverage** — `boards/lib-shots.js:41`. Exists. Note the word
  "coverage" in this repo always means camera coverage, never a reader's
  report.

---

## Evidence

Read in full: `writer/lib-treatment.js` (275 lines), `writer/writer.js` (231),
`boards/lib-shots.js` (123), `tools/lib-script.js` (121),
`tools/tools-script-ui.js` (262), `tools/tools-registers.js` (177),
`timeline/parser.js` (706), `projects/lib-vault.js` (326),
`netlify/functions/parse-script.js` (91).

Read in the cited ranges: `tools/tools-core.js:1-166`,
`tools/tools-media-ui.js:180-350`, `contracts/lib-deal.js:1-92`,
`contracts/index.html:70-130`, `producer/schedule-board.js:1-120`,
`workflow/workflow.js:1-140`, `js/budget-engine.js:60-80,282-360,600-640`,
`producer/sales-forecast.js:160-215`, `finance/lib-money.js:20-150`,
`casting/lib-castdesk.js:1-190`, `screening/lib-screen.js:1-40`,
`clearance/lib-clear.js:1-70`, `boards/boards.js:318-340`,
`timeline/timeline-doc.js` (structure), `today/index.html:60-100`,
`tools/index.html:38-64`, `tools/tools.css:42-56`, `writer/index.html:1-50`,
`scripts/test_writer.mjs:1-30`, `app.html:2116-2246,4377-4400,8328-8360`.

Searches run across all `.js`/`.html` excluding `node_modules`, `.git`,
`static/vendor`, `private/`, `local-backend/` and `docs/`:
`episode|episodes|season N|S01E01|limited series|anthology|pilot|showrunner`
(zero), `writers? ?room|WGA|screenplay by|story by|arbitration` (two comments
only), `table ?read|read-?through` (zero),
`coverage report|reader's report|beat sheet|three-act|outline` (CSS `outline`
only), `submission|query letter|script sent|pitch meeting` (video jobs and
casting statuses only), `paginat|pageCount|@page` (zero),
`revision|coloured page|goldenrod` (`tools/lib-script.js`,
`tools/tools-script-ui.js`, `timeline/parser.js:25` only),
`sceneNumber|scene_num|lockedScene` (three call sites, none persisting a
number), `title report|title clearance|chain of title` (register and checklist
labels only), `SB_[A-Za-z0-9_]+` (full key inventory, 80 keys).

Executed: `node scripts/run_all_tests.mjs` → **44/44 suites passed**
(2026-08-26). No file in the repository was modified.
