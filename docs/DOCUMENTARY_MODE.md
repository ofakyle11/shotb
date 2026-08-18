# Documentary Mode — Methodology & Sources

Backs every number in `timeline/timeline-doc.js` (SBDoc) — the Documentary
project type in the Producer's Estimate, the Producer Suite Budget tab, and
the Sales tab's Documentary strategy. Research compiled August 2026; every
figure carries its source.

## Why a separate mode

Documentary economics are structurally different from scripted features:
there is no cast to tier and no stripboard of eighths — instead
interview/vérité/b-roll day structures, archival licensed by the minute,
edit calendars measured in months (the film is written in the edit),
clearances and E&O as first-class lines, and a funding model of stacked
grants and license fees rather than equity recouped through a theatrical
waterfall. A scripted estimator pointed at a documentary treatment produces
confident nonsense; this mode replaces the physics, not just the labels.

## Detection & parsing

`SBDoc.analyzeDoc(text)` reads treatments, narration scripts and interview
transcripts. It detects segment cues (INTERVIEW/SIT-DOWN, ARCHIVAL/NEWSREEL/
STOCK, NARRATION/V.O., VÉRITÉ/OBSERVATIONAL, B-ROLL/DRONE/MONTAGE,
RE-ENACTMENT, GRAPHICS/ANIMATION, TRAVEL, MUSIC cues), extracts subjects
from `NAME:` speaker lines and "INTERVIEW WITH …" phrases, measures prose
pages (~250 words) vs transcript density, and scores doc-likeness — the
estimator offers to switch modes when a script reads as a documentary.

## Budget model

Account structure follows the IDA/Documentary Magazine chart of accounts
(1000 R&D · 2000 producers/director · 3000 talent · 41xx crew · 42xx
editorial · 5000 equipment · 6000 travel · 7xxx post · 8xxx insurance ·
9000 office · 10000 festivals/publicity) with ITVS-template deliverables
([IDA 2025 budgeting guide](https://www.documentary.org/online-feature/2025-introduction-documentary-budgeting-and-scheduling),
[ITVS budget template PDF](https://itvs-website.s3.amazonaws.com/filmmakers_resources/d276102f-fdcb-4b2a-adb1-d2bc1a409607/ITVS%20Budget%20Template.pdf)).

### Scale tiers

| Tier | Total band | Crew | All-in crew day | Edit wks / finished hr |
|---|---|---|---|---|
| DIY / micro | < $100k | 2 | $500–1,500 | 10–16 |
| Low budget | $100–400k | 3 | $1,200–3,000 | 14–22 |
| Indie feature | $400k–1.2M | 5 | $3,000–8,000 | 20–30 |
| Premium / streamer | $1.2M+ | 8 | $8,000–16,000 | 26–40 |

Sources: tier bands from published surveys
([docfundingvault](https://docfundingvault.com/guide/how-much-does-a-documentary-cost),
[GlobalFilmz 2026](https://globalfilmzstudios.com/documentary-film-production-costs-budget-breakdown-for-2026/))
and the IDA's observed funded clusters at $350–450k and $600–800k, IDFA
Forum averages $416–640k (US/UK ≈ $900k); Sundance's fund prioritizes
budgets under $1.2M. Crew-day costs:
[Academy Voices](https://www.academyvoices.com/blog/how-much-does-it-cost-to-make-a-documentary-a-complete-breakdown)
(lean 1–3-person crews $500–1,500/day collectively; 5+ crews $3–10k),
GlobalFilmz (full professional day $8–20k, gear package $1.5–5k/day).
Underlying day rates: doc DP $650–1,800
([Assemble rate guide](https://www.onassemble.com/blog/a-comprehensive-guide-to-day-rates-for-film-crew-2021),
[untamedscience](https://untamedscience.com/filmmaking/getting-started/documentary-costs/)),
sound recordist $550–900 + kit $100–650
([The Rate Guide](https://therateguide.com/sound-mixer-day-rate)).
Edit calendar from the
[Alliance of Documentary Editors schedule guide](https://allianceofdoceditors.com/wp-content/uploads/2022/02/ADE_Edit_Schedules_final2.pdf):
**one month of editing per 10 finished minutes** (90-min feature ≈ 9
months); editor fees $60–120k on professional features, weeklies
$1.8–3.2k (market) to $3.2–4.5k (New Doc Editing $3,200; MPEG on-call
$3,897 — [newdocediting.com](https://newdocediting.com/about/faq-about-our-editing-service/)).
Director + producer fees ≈ **5–10% of budget each**, contingency
**6–10%**, festivals/publicity ≈ 7% of spend (IDA guide, above).

### Shooting structure

Interview days suggested from detected subjects (~0.75 day per subject),
vérité/b-roll days from segment cues, one travel day per detected region;
travel priced $2.5–6.5k per region per crew member
(domestic blocks $3–15k, international toward $50k — Academy Voices).
Blended shooting ratio: interview-driven 10–20:1, observational 30–80:1
([Tools for Film](https://www.toolsforfilm.com/blog/shooting-ratio-explained)) —
the panel shows the implied footage hours.

### Archival licensing (finished minutes × all-media rate)

| Appetite | Minutes | $/min (all-media, perpetuity) |
|---|---|---|
| Light | 2–6 | $3,000–6,000 |
| Moderate | 6–18 | $3,500–7,500 |
| Heavy / archival-driven | 18–45 | $4,500–9,000 |

Anchors: [Producers Library published card](https://producerslibrary.com/pricing-details)
— documentary all-media incl. theatrical **$59/sec ≈ $3,540/min**;
[BFI archive card](https://www.bfi.org.uk/archive-content-sales-licensing/archive-footage-sales/archive-footage-licensing-rates)
— documentary rate £4,320 first minute + £72/sec (≈ $5.5k/min);
TV-news footage $80–150/sec with **30-second minimums** ($2,400–4,500 per
clip) ([documentarycameras.com](https://documentarycameras.com/how-to-license-television-news-footage/));
30-sec minimums are standard across archives (IDA guide).

### Music, E&O, clearances

Composer doc scores to ~$30k ($200–250 per finished minute —
[Robin Hoffmann](https://www.robin-hoffmann.com/tutorials/film-music-budget/));
indie-feature sync $1,000–15,000/track, recognizable catalog 5–10×
([Chartlex 2026 rate card](https://www.chartlex.com/blog/business/sync-licensing-rate-card-2026)).
E&O by tier — festival-only $2–3.5k, small indie $1–5k, mid $5–12k,
streamer/wide $15–30k ([THAgency](https://thagency.com/how-much-is-eo-insurance-for-film/));
E&O insurers require a fair-use opinion letter on archival-driven films.
Deliverables per the ITVS template (CC $1,000, transcripts, copyright,
title search, trailer — required subtotal $6,135).

### Tax incentives — documentary eligibility

Applied automatically in doc mode (`DOC_INCENTIVE_ADJUST`):

- **New York — excluded.** "Documentary" is outside the statutory
  definition of qualified film
  ([ESD guidelines](https://esd.ny.gov/sites/default/files/Film-Credit-Guidelines-wAppendix-05052023.pdf)).
- **Georgia — 20% base only**; the +10% GEP logo uplift is unavailable to
  docs ([GA DOR FAQ](https://georgia.org/sites/default/files/2024-01/faq_film_tax_credit_2024.pdf)).
- **UK AVEC, Ontario OFTTC, BC labour credits — docs expressly qualify**
  ([Tolley AVEC guidance](https://www.tolley.co.uk/tax/guidance/audio-visual-expenditure-credit-avec-key-provisions),
  [Ontario Creates](https://www.ontariocreates.ca/tax-incentives/ofttc),
  [BC film credits](https://www2.gov.bc.ca/gov/content/taxes/income-taxes/corporate/credits/film-tv)).

### Funding offsets (grants panel)

| Program | Amount | Source |
|---|---|---|
| ITVS Open Call | up to $400k (co-production; PBS window) | [itvs.org](https://itvs.org/funding/open-call-production-funding-frequently-asked-questions/) |
| Ford JustFilms | $15–300k, median ~$125k | [Ford Foundation](https://www.fordfoundation.org/news-and-stories/news-and-press/news/ford-foundations-justfilms-allocates-4-8-million-to-advance-documentary-films-championing-social-justice/) |
| Sundance Documentary Fund | $50–100k production/post | [sundance.org](https://www.sundance.org/blogs/2024-sundance-institute-documentary-fund-grantees-announced/) |
| Chicken & Egg | $10k research / $20k dev / $75k award | [chickeneggfilms.org](https://chickeneggfilms.org/programs/research-and-development-grant) |
| Catapult Film Fund | $25k development | [windrose listing](https://www.windrose.fr/producer/int-l-financing-opportunities/) |
| CMF POV (Canada) | ≤49% of costs, cap $400k CAD | [CMF](https://cmf-fmc.ca/document/pov-guidelines/) |

## Revenue model (Sales tab → Documentary strategy)

Docs are sold as a **license stack**, not a box-office bet. Heat tiers:

- **Streamer acquisitions are rare events post-2022**: Sundance 2023 saw
  zero streamer doc buys
  ([Broderick, Filmmaker Magazine](https://filmmakermagazine.com/121543-sundance-2023-documentary-sales-and-beyond-stark-realities-golden-opportunities/));
  2026 none reported ([IDA](https://www.documentary.org/online-feature/dont-panic-doc-industry-looks-upsides-amid-decimation-sundance-2026)).
  Highs remain celebrity/IP-only: Knock Down the House $10M, Reeve ~$15M,
  Eilish $25M, Elton John $30M+
  ([THR](https://www.hollywoodreporter.com/movies/movie-features/documentary-streaming-age-filmmaker-debate-ethics-payments-1235221541/)).
  Mid-market moved to ~$500k/hour with 20–50% price deflation
  ([Documentary Business](https://documentarytelevision.com/commissioning-process/factual-trends-2024-buyers-buckets-and-budgets/)).
- **Broadcast**: PBS POV ~$30–45k/feature, $150k ceiling; Independent Lens
  $40k–six figures
  ([Documentary Business](https://documentarytelevision.com/commissioning-process/inside-pbss-flagship-pov-strand-12-how-many-projects-are-funded-what-do-they-pay-for-which-rights/),
  [Tools for Film](https://www.toolsforfilm.com/directory/film-grants/pov-call-for-entries));
  BBC Storyville buys UK rights only on a ~£2M/yr strand across 20–24
  films ([IDA interview](https://www.documentary.org/online-feature/retaining-eclectic-range-emma-hindley-discusses-bbcs-storyville)).
- **Educational**: university DSLs $150–595, community licenses $89–295,
  ~50% filmmaker splits, lifetime $5–50k realistic
  ([The Film Collaborative pricing survey](https://www.thefilmcollaborative.org/blog/2017/03/low-down-on-educational-distributionpart-3-of-a-3-part-series/)).
- **Theatrical**: US doc market share 0.2–0.9% of box office; 2025's top
  ten (ex-concert-film) grossed ~$20M combined
  ([The Numbers](https://www.the-numbers.com/market/genre/Documentary),
  [Kaufman](https://anthonykaufman.substack.com/p/did-docs-make-a-comeback-in-2025)).
- **Self-distribution**: TVOD year-one $1–10k typical; AVOD $500–5k/yr;
  direct/event outliers to $700k (Touch the Wall via Tugg + DVD)
  ([Tools for Film](https://www.toolsforfilm.com/blog/how-streaming-royalties-are-calculated),
  [IndieWire](https://www.indiewire.com/features/general/inside-the-strange-and-prickly-world-of-ad-supported-indie-film-distribution-1234807779/),
  [IDA](https://www.documentary.org/feature/independent-documentary-distribution-turbulent-times)).
- **Standing caveats** shown in-product: only **20%** of independent docs
  reach profit; **40%** report zero revenue
  ([CMSI State of the Documentary Field 2020](https://cmsimpact.org/report/the-state-of-the-documentary-field-2020-study-of-u-s-documentary-professionals/p/survey-findings/)).
  Doc **series** commissions run cost-plus ~30% (20–40% bracket)
  ([CNBC on the Netflix model](https://www.cnbc.com/2018/08/15/netflix-cost-plus-model-tv-shows-revenue-upside.html)).
  Doc sales agents take 10–20% ([No Film School / Submarine & Cinetic](https://nofilmschool.com/2018/06/documentary-sales-agents)).

## Open-source foundations

We surveyed the OSS documentary tooling landscape before building. The
paper-edit space (autoEdit 2, BBC digital-paper-edit — both MIT, both
dormant) contributes its **data models**, which we adopt as the design
spine for documentary features rather than as dependencies:

- **Transcript interchange**: BBC DPE JSON —
  `{words:[{id,start,end,text}], paragraphs:[{id,start,end,speaker}]}` —
  trivially derivable from Whisper/WhisperX output and convertible to
  SRT/VTT ([bbc/react-transcript-editor](https://github.com/bbc/react-transcript-editor), MIT).
- **Paper-edit**: ordered typed elements (`paper-cut | title | voice-over |
  note`) referencing transcript id + in/out
  ([bbc/digital-paper-edit-client](https://github.com/bbc/digital-paper-edit-client)).
- **Timeline export target**: OpenTimelineIO JSON (Apache-2.0) — rational
  time, schema-tagged nodes, per-object metadata
  ([OTIO spec](https://opentimelineio.readthedocs.io/en/stable/tutorials/otio-file-format-specification.html)).
- **Transcription**: optional server-side Whisper/faster-whisper (MIT) or
  WhisperX (BSD-2) for diarization; optional in-browser via
  transformers.js (Apache-2.0). Never bundled.
- **Breakdown vocabulary**: [Universal Schedule Standard](https://github.com/UniversalScheduleStandard/UniversalScheduleStandard).

The survey confirmed documentary-specific budgeting, clearance/release
tracking, and AV-script parsing **do not exist in OSS** — this module is
first of its kind, built on the public rate cards and templates cited
above rather than on any existing tool.

## Known limitations

- Rate bands are US-centric 2024–2026 figures; UK/EU crew markets differ.
- The revenue heat tiers are scenario bands from reported deals, not a
  fitted distribution — documentary sales data is too sparse and too
  private for quantile fitting (no doc-specific budget-to-revenue
  multiples exist in any published source).
- PBS strand fees are stable nominal figures corroborated across sources
  but date to older reporting — treat as declining in real terms.
- ITVS appears both as funding offset and implies a PBS license — do not
  double-count it against the broadcast line.
- Grants are competitive (Sundance funds ~1.4% of applicants); the offsets
  panel shows what teams stack, not what any project should expect.
