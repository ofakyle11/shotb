# Shotbreak Producer's Estimate — Pricing Methodology & Rate Reference

This document backs every number in `timeline/timeline-budget.js` (the
**Producer's Estimate** panel on the timeline page). It has two halves:

1. **AI rough-draft preview pricing** — what the model APIs bill to generate
   the lighting/set previz cut of a script, and how long the run takes.
2. **Real-world production pricing** — the tiered budget model (director tier,
   star tier, crew/union status, locations, equipment, VFX) and the published
   rates behind it.

All figures were verified against official union rate sheets, provider
pricing pages, and trade-press deal reporting as of **August 2026**
(2025–26 / 2026–27 union rate years). Rates drift — every constant lives in
one place at the top of `timeline-budget.js` so recalibration is a one-file
edit. These are **planning-grade estimates, not quotes**.

---

## Part 1 — AI preview: cost & time

### 1.1 Video model rates (USD per second of finished footage)

| Model (app id) | 480p | 720p | 1080p | Median wall-clock/clip | Source basis |
|---|---|---|---|---|---|
| `seedance-2.0-turbo` | $0.10 | $0.20 | $0.50 | ~156 s | WaveSpeed Seedance 2.0 Fast: $0.50 / $1.00 / $2.50 per 5 s ([wavespeed.ai](https://wavespeed.ai/models/bytedance/seedance-2.0-fast/image-to-video)); Replicate 2.0: $0.08/$0.18/$0.45 per s ([replicate.com](https://replicate.com/bytedance/seedance-2.0)) |
| `wan-2.7` | — | $0.10 | $0.14 | ~47–60 s | fal.ai & Replicate Wan 2.7 flat $0.10/s ([fal.ai](https://fal.ai/wan-2.7)); Alibaba Model Studio wan2.6 $0.086 (720p) / $0.143 (1080p) per s |
| `sora-2` | — | $0.10 | — | 30–90 s | OpenAI official: sora-2 $0.10/s at 720p; sora-2-pro $0.30–$0.70/s ([developers.openai.com](https://developers.openai.com/api/docs/pricing)) |
| `veo-3.1` | — | $0.40 | $0.40 | 11 s–6 min | Google Gemini API Veo 3.1 standard w/ audio: $0.40/s at 720p & 1080p; Fast tier $0.10–$0.12/s ([ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)) |
| `kling-3.0-pro` | — | $0.112 | $0.14 | 60–120 s | Kling official per-unit: standard $0.084/s, pro $0.112/s, +audio $0.14/s ([costbench](https://costbench.com/software/ai-media-apis/kling-api/), [renderful](https://renderful.ai/blog/kling-api-pricing)) |
| `grok-imagine` | $0.05 | $0.05 | — | ~25 s / 6 s clip | xAI official: grok-imagine-video $0.050/s output, audio included ([docs.x.ai](https://docs.x.ai/developers/models/grok-imagine-video)) |

Stills (character portraits / location plates): **$0.04/image default** —
Nano Banana (gemini-2.5-flash-image) $0.039, FLUX dev $0.025, FLUX 1.1 Pro
$0.04, gpt-image medium ~$0.042. Nano Banana Pro runs $0.134 at 1K/2K.

### 1.2 The formulas

```
footage_seconds  = clip_count × avg_clip_duration
one_pass_cost    = footage_seconds × usd_per_sec(model, resolution)
likely_cost      = one_pass_cost × retake_factor + stills_cost
high_cost        = one_pass_cost × retake_factor × 1.35 + stills_cost
stills_cost      = (cast_count + location_count) × image_takes × usd_per_image
wall_clock       = ceil(clip_count × retake_factor / concurrency)
                   × median_gen_seconds(model) + setup_minutes
```

Defaults: `retake_factor = 1.6` (≈ 60 % of clips regenerated at least once),
`concurrency = 3`, `image_takes = 2`, `setup_minutes = 12` (parse +
character/location enrichment + prompt passes). Both retakes and concurrency
are editable in the panel.

### 1.3 Worked example — a 90-page feature previz

~90 pages → ~180 scenes/beats → ~270 clips × 5 s at 720p:

| Model | One pass | Likely (×1.6 retakes) | Wall clock (3 parallel) |
|---|---|---|---|
| Grok Imagine | $68 | ~$110 | ~1.7 h |
| Sora 2 / Wan 2.7 | $135 | ~$220 | ~2–3 h |
| Seedance 2.0 Turbo | $270 | ~$435 | ~6 h |
| Veo 3.1 | $540 | ~$870 | ~5 h |

Contrast: shooting the same script for real starts around **$300k**
(micro-budget) and runs to **$200M+** (tentpole). That comparison is what
the panel's footer line shows.

---

## Part 2 — Real-world production pricing

### 2.1 Union scale anchors (published minimums)

**SAG-AFTRA theatrical (7/1/25–6/30/26, next year in parens)**

| Item | Rate |
|---|---|
| Day performer, Basic (> $2M budget) | $1,246/day ($1,283) |
| Weekly performer, Basic | $4,326/wk ($4,456) |
| Low Budget Agreement ($700k–$2M) | $810/day, $2,812/wk ($834 / $2,896) |
| Moderate Low Budget ($300k–$700k) | $449/day, $1,560/wk |
| Ultra Low Budget (≤ $300k) | $249/day ($257) |
| Background actor (Schedule X West Coast) | $224/day ($231) |
| Stand-in / photo double | $262/day ($270) |
| Pension & health fringe | 21 % principals / 20.5 % background |
| Overtime | 1.5× hours 9–10, 2× after 10 (day performers) |

**DGA (2026–27 rate card)**

| Item | Rate |
|---|---|
| Director, high budget (> $11M) | $25,214/wk, ~13-wk guaranteed run ≈ $320k min |
| Director, low-budget sideletter $8.5–11M | $22,693/wk (90 %) |
| Director sideletter $4–8.5M | $18,911/wk (75 %) |
| Director sideletter ≤ $3M | fully negotiable (fringes 22.5 % still owed) |
| UPM / 1st AD (studio weekly) | $7,197 / $6,843 |

**WGA (2023 MBA, 5/2/25–5/1/26 year)**

| Item | Rate |
|---|---|
| Original screenplay incl. treatment, ≥ $5M budget | $170,655 |
| Original screenplay incl. treatment, < $5M | $90,904 |
| Rewrite (high budget) | $45,470 |

**IATSE (Basic Agreement 2025–26; +3.5 % 8/2/26)**

| Item | Rate |
|---|---|
| Grip / electric journeyman | $54.78/hr ≈ $767 per 12-hr day |
| Key grip / gaffer | $63.01/hr ≈ $882 per 12-hr day |
| Camera operator (Local 600) | $469/8-hr day, $5,907/wk |
| Script supervisor (Local 161 scale) | $630/day, $2,841/wk |
| Overtime | 1.5× after 8, 2× after 12 elapsed, 3× after 15 |
| Budgeting convention | 12-hr day = 14 pay units (8 ST + 4 OT @1.5×) |

**All-in fringe rules of thumb** (payroll tax + workers' comp + union
benefits + handling): non-union crew **~28–30 %**, IATSE crew **~40 %**,
SAG cast **~45 %**. The estimator uses 28 % / 32 % / 40 % by crew tier, with
cast fringes weighted 0.6 because P&H contributions cap out on star fees.

### 2.2 Talent tiers (reported market, 2020–2026)

**Director** (`TIERS.director`)

| Tier | Range | Anchors |
|---|---|---|
| First-time | $10k–$75k | DGA LB sideletter ~$9k–$20k min; indie norm $10k–$50k (~5 % of budget) |
| Emerging (festival) | $85k–$500k | DGA LB scale ~$85k/4-wk; new studio directors $250k–$500k |
| Established | $500k–$2.5M | most working directors $250k–$2M; DGA basic min run ≈ $320k |
| Veteran hitmaker | $2.5M–$7M | THR survey: studio $2.5M–$5M, streamers $4M–$7M |
| A-list | $7M–$15M | step below the first-dollar-gross club |
| Legend | $15M–$25M + gross pts | Nolan ~$20M advance vs 15–20 % first-dollar gross (Dunkirk, The Odyssey) |

**Lead / star** (`TIERS.lead`)

| Tier | Range | Anchors |
|---|---|---|
| Unknown (SAG scale) | $15k–$80k | scale day/weekly; Schedule F run-of-picture ~$65k–$80k |
| Rising | $100k–$2M | Zendaya $300k (Dune), Chalamet $2M (Dune), Pugh $1M (Oppenheimer) |
| Recognizable name | $2M–$5M | Chalamet $3M (Dune 2), Phoenix $4.5M (Joker, pre-breakout) |
| Star | $8M–$15M | Murphy $10M (Oppenheimer), Robbie & Gosling $12.5M (Barbie), Momoa $15M |
| A-list | $20M–$35M | Johnson $22.5M, DiCaprio $30M, Pitt $30M, Smith $35M |
| Megastar | $50M–$100M+ | Johnson $50M (Red One); Cruise ~$13M + first-dollar gross → $100M+ (Top Gun: Maverick) |

Backend note: true first-dollar gross is essentially extinct outside the
Cruise/Nolan tier; the modern structure is upfront fee + box-office milestone
bonuses, or a streamer buyout with no backend (which pushes upfronts higher).

**Supporting cast** (`TIERS.supporting`, per role): scale/indie $5k–$50k;
seasoned $20k–$200k; name $200k–$2M; star cameo / prestige name $250k–$4M
(RDJ, Blunt and Damon each ~$4M on Oppenheimer; Sheen $250k for one day).
Day players: $1.5k–$6k for a run (SAG $1,246/day basic, $810 LBA × 2–5 days).

**Producers**: 3–5 % of budget on indies (caps ~$5M budgets); $750k–$1M
typical studio fee; A-list producers $15M+. **Casting directors**: indie
features $5k–$25k flat; studio features $30k–$250k+.

### 2.3 Below the line

**Crew**: modeled as `crew_size × blended_day_rate × rate_mult × shoot_days
× 1.12 OT factor`, where the blended day rate is a 12-hr all-in day across
departments (PAs ~$250 → keys ~$900): micro $350 → tentpole $900, and
`rate_mult` is 0.75 non-union / 0.90 hybrid / 1.15 full union.

**Background extras**: $120–$270/person-day (non-union ~$100–$200; SAG $224
+ 20.5 % P&H). Extras volume scales with detected crowd scenes.

**Locations** (`TIERS.locations`): residential $500–$2.5k/day; commercial
$2k–$15k/day; landmark $10k+/day. Permits: FilmLA $931/permit + $232
notification (Low Impact pilot: $350); NYC MOME $500 per 14 days.
Soundstages: independent LA stages ~$900–$1,800/day; set construction from
<$10k (simple) into the millions (studio builds) — hence the wide
per-location fee on the stage tier.

**Equipment** (`TIERS.equipment`): weekly = 3× day rate (the "3-day week"
rental convention). Alexa 35 / Venice 2 packaged ≈ $2,500/day; RED V-Raptor
≈ $2,000/day; 5-ton G&E truck $600–$750/day; indie FX3/FX6 kits ~$200–$500/wk
body-only. Tiers: indie $800–$4k/wk → IMAX $80k–$200k/wk.

**Special units** (auto-added from script drivers):

| Unit | Per day | Basis |
|---|---|---|
| Stunts | $4k–$15k | coordinator $1,938/day flat-deal + performers $1,246/day + rigging + per-take adjustments ($100–$500 moderate, $1k+ high falls, $5k–$10k/day extreme) |
| Pyro / SFX | $6k–$40k | licensed pyrotechnician $1.2k–$2.5k/day + SFX coordinator $800–$1.5k/day + materials + fire safety |
| Water / marine | $8k–$50k | tank stages from ~$150/hr; large portable tank ~$21k/setup; dive-safety crew per project |
| Animals | $1.5k–$8k | wrangler + humane officer |

**Transport** is 10–14 % of crew labor; **travel & living** applies a
multiplier on distant/international location tiers.

### 2.4 Post-production

| Item | Range by scale | Basis |
|---|---|---|
| Editorial | $1.5k–$3.5k/wk (micro) → $25k–$50k/wk (tentpole) | IATSE Local 700 editor min $3,428/wk; indie non-union $1.25k–$2.5k/wk; assistant $250–$350/day |
| Sound design & mix | $3k–$20k (micro) → $1M–$3M (tentpole) | indie basic mix $3k–$5k; facility package from $20k–$30k; mix stage $1k–$4k/day |
| Music | $3k–$20k (micro) → $2.5M–$8M (tentpole) | indie score $10k–$50k all-in; rule of thumb 2–5 % of budget; sync licenses $250–$5k (indie tracks) to $15k–$60k+ (known songs) |
| Color / DI | $1k–$10k (micro) → $400k–$1.2M (tentpole) | documented indie feature grade $9.5k; full studio DI $65k–$85k+ |

**VFX** (`TIERS.vfx`) — per-shot by complexity, with shot-count floors per
runtime minute so a "no-VFX" feature still carries invisible fixes:

| Intensity | $/shot | Shots/min floor | Basis |
|---|---|---|---|
| Light (cleanup/comps) | $300–$1.5k | 0.5 | cleanup $100–$1k/shot; 50–100 invisible shots even on "no-VFX" films |
| Moderate (set ext., sims) | $1k–$5k | 2 | comps/set extensions $1k–$5k/shot; moderate indies 150–500 shots |
| Heavy (creatures) | $5k–$40k | 6 | high-end shots $5k–$50k+ |
| Full CG spectacle | $40k–$120k | 15 | hero CG $75k–$200k/shot; blockbuster averages $46k–$62k/shot; Rogue One ~1,600 shots, Avatar 2 ~3,300 |

The panel auto-suggests the VFX tier from detected creature/magic/sci-fi and
pyro keywords (overridable).

### 2.5 Other / indirect

| Item | Rate | Basis |
|---|---|---|
| Production insurance | 2.5 % of direct costs | industry 2–3 % |
| Completion bond | 2.5 % (only micro→mid tiers) | 3–5 % gross fee, ~2–3 % net after rebate; studio films self-bond |
| Legal & finance | 1.5 % | standard indie range 1.5–3 % |
| Contingency | 10 % | standard bond-company requirement |

### 2.6 Schedule model

```
shoot_days = max(5, ceil(pages / pages_per_day × driver_load))
driver_load = 1 + night_pct×0.15 + stunts×0.005 + pyro×0.01
              + water×0.008 + crowds×0.004 + (heavy VFX ? 0.10 : 0)
```

Pages/day by scale: micro 7 → low 5.5 → indie 4.5 → mid 3.5 → studio 3 →
tentpole 2.2 (industry ranges from line-producer rules of thumb; 1 script
page ≈ 1 minute of screen time). Prep ≈ 1.1–1.6× shoot weeks; post ≈ 2.4×
shoot weeks + 8–16 weeks when VFX is heavy.

### 2.7 Script-driven budget drivers

The analyzer scans the screenplay for weighted keyword families — stunts &
fights, fire/explosions, weapons, vehicle action, water work, weather FX,
VFX/creatures, crowds, animals, child actors, period setting, aerial work —
plus INT/EXT and DAY/NIGHT ratios from scene headings. Drivers feed
(a) the shoot-day multiplier, (b) special-unit day counts, (c) the VFX tier
suggestion, and (d) the complexity score shown in the panel.

### 2.8 Script measurement: eighths of a page

Scenes are measured the way ADs actually break down scripts — in **eighths
of a page** (the convention CineSched and every stripboard tool uses). The
analyzer splits the screenplay at sluglines and sizes each scene at
~5 content lines per eighth (≈ 40 content lines/page). Total pages =
Σ eighths ÷ 8, and the shoot-day computation runs on exact eighths rather
than a rounded word count. When a script has no sluglines the word-count
estimate (~200 words/page) is the fallback.

### 2.9 Cast costing: Day-Out-of-Days

Supporting cast and day players are costed from a simplified
**Day-Out-of-Days**: scenes are laid onto shoot days in script order at the
tier's eighths-per-day pace, each performer's first/last day and worked days
are computed from which scenes they appear in, and:

- **supporting roles** = SAG-anchored weekly rate (non-union $1,800 / LBA
  $2,812 / Basic $4,326) × span weeks, clamped into the chosen supporting
  tier's per-role band — so scale players cost what the schedule says while
  name talent costs their fee;
- **day players** = day rate ($400 / $810 / $1,246) × worked days.

Leads remain flat run-of-picture fees by star tier (that is how they are
actually dealt). A real DOOD also models holds, drop-pickup rules and
consecutive-employment — this is the planning-grade version.

### 2.10 Top-sheet account structure

Line items follow the standard Movie Magic-style account skeleton (the same
19-category structure CineSpend ships): 1000 Story & Rights, 2000 Producers,
3000 Direction, 4000s Cast, 5000 Production Staff, 6000 Camera, 7000 Sound,
8000 Grip & Electric, 9000 Art, 10000 Wardrobe, 11000 Makeup & Hair,
12000 Transportation, 13000 Locations, 14000 Media & Stock, 15000s Post,
16000s Insurance/Legal/Bond, 17000 Publicity, 18000 General Expenses,
19000 Contingency. Crew labor is split across department accounts
(staff 20 %, camera 13 %, sound 4 %, G&E 18 %, set ops 24 %, art 12 %,
wardrobe 5 %, HMU 4 %); equipment splits camera 45 % / G&E 50 % / sound 5 %;
the art allowance splits art 55 % / wardrobe 30 % / HMU 15 %.

### 2.11 Tax incentives (net-cost modeling)

A jurisdiction selector applies published incentive terms to estimate
recovery: `recovery = total × qualified-spend fraction × credit rate`.
Labor-only credits (BC PSTC 36 %, Ontario OFTTC) use a lower qualified
fraction (~45 %) than all-spend rebates (~70–75 %); UK/Ireland claims cap at
80 % of core expenditure (qualPct 0.64). Headline terms modeled (2025–26):

| Jurisdiction | Headline | Type / notes |
|---|---|---|
| Georgia | 20 % + 10 % logo = 30 % | transferable, no annual cap, min $500k |
| California (4.0) | 20–35 % | excludes ATL, annual allocation |
| New York | 30 % | refundable, BTL only |
| New Mexico | 25–40 % | refundable + uplifts |
| Louisiana | 25–40 % | $150M annual cap |
| UK AVEC | 34 % gross / 25.5 % net | on 80 % of core spend |
| UK IFTC | 53 % gross / 39.75 % net | films ≤ ~£15M core spend |
| Ireland S481 | 32 % | on 80 % of eligible, €125M cap |
| Hungary | 30 % | rebate, no project cap |
| Czech Republic | 20–30 % | +10 % VFX/animation |
| Australia | 30 % | Location / Producer Offset |
| New Zealand | 20–25 % (40 % domestic) | NZSPG |
| British Columbia | 36 % | **labor only** (PSTC) |
| Ontario | 21.5 % all-spend | or 35 % labor (OFTTC) |
| Iceland | 25–35 % | rebate |
| Malta | 30–40 % | rebate + uplifts |
| Italy | 40 % | credit, per-project caps |
| Greece | 40 % | rebate, +5 % VFX |
| Germany | DFFF 25 % (+5–10 % regional) | grant |
| Spain | 25–30 % (Canary 50 %+) | credit |

Recovery is shown as a **net-cost reduction, not upfront cash** — credits
pay out 6–18 months after audit (bankable at 85–92 ¢ on the dollar for
transferable credits like Georgia's).

### 2.12 Real-film genre benchmarks

To sanity-check the model against reality, the panel compares the estimate
to released-feature budget distributions computed from the TMDB 5000
dataset (3,708 features with reported budgets; the same data used by the
movies-explorer and Movie-Data-Analysis projects), inflation-adjusted ×1.6
from its ~2005 median vintage to 2026 dollars. Per primary genre it shows
median / interquartile budget and median worldwide gross, plus the
percentile your likely estimate occupies in the overall distribution
(p10 ≈ $4.6M, median ≈ $38M, p90 ≈ $144M in 2026$). Genre is auto-inferred
from the script (keyword families + action-driver volume) and overridable.

### 2.13 Reference tools this design draws on

- **[CineSpend](https://github.com/ChrisTempel/CineSpend)** (GPL-3, Swift):
  Movie Magic-style top sheet → the 19-account structure and amt×units×rate
  transparency adopted in §2.10. Concepts only — no code was ported.
- **[CineSched](https://github.com/ChrisTempel/CineSched)** (GPL-3, Swift):
  eighths-of-page scene measurement, breakdown tagging categories
  (stunts/SFX/VFX/vehicles/extras — mirrored by our driver detection), and
  the Day-Out-of-Days work/hold model behind §2.8–2.9.
- **[taxincentivedecoder.com](https://www.taxincentivedecoder.com)**: the
  jurisdiction-incentive concept behind §2.11. Rates here were verified
  against the underlying government program terms rather than copied.
- **[Movie-Data-Analysis](https://github.com/Jeesoo-Jhun/Movie-Data-Analysis)**
  and **[movies-explorer](https://github.com/dataprofessor/movies-explorer)**:
  budget/ROI-by-genre benchmarking approach and the TMDB dataset behind §2.12.

### 2.14 Known limitations

- Star/director fees above "established" are reported figures, not scale;
  single-source trade numbers (e.g. some Dune cast salaries) are estimates.
- Marketing/P&A is intentionally excluded (it is a distribution cost, often
  equal to half the production budget again).
- Cast fringes are approximated (0.6 weighting) because SAG P&H caps out on
  large fees.
- Incentive recovery is an estimate on headline terms — every program has
  per-category qualification rules, sunset dates and allocation queues;
  a production accountant's opinion letter is the real number.
- The DOOD model schedules scenes in script order (no stripboard
  optimization), so supporting-cast spans are conservative.
- Genre benchmarks are inflation-adjusted 2005-vintage data — treat as
  order-of-magnitude context, not market forecasts.
- The DGA 2026–27 low-budget sideletter rates are marked "tentative" on the
  official rate card; Kling API pricing has historically swung 40–60 %.

---

## Sources

**Union scale (official first):**
[DGA 2026–27 rate card PDF](https://edge.sitecorecloud.io/directorsguf4d4-dga2c79-dgaprod1615-f6e3/media/Files/Contracts/Rate-Cards-2026-thru-2027/DGA260715Rates2026thru2027.pdf) ·
[WGA 2023 Schedule of Minimums PDF](https://www.wga.org/uploadedFiles/contracts/2023_Schedule_of_Minimums.pdf) ·
[SAG-AFTRA theatrical rate sheet](https://www.sagaftra.org/rate-sheet-theatrical) ·
[SAG-AFTRA ULB rate sheet](https://www.sagaftra.org/sites/default/files/2025-10/Current%20Ultra%20Low%20Budget%20Project%20Agreement%20(UPA)%20Rate%20Sheet.pdf) ·
[AMPTP DGA wage tables](https://amptp.org/wp-content/themes/amptp/assets/pdf/DGA/Wage%20Scales%20%E2%80%93%202023-26%20BA.pdf) ·
[ICG Local 600 LBTA rate card 2025](https://www.icg600.com/sites/default/files/2025-03/LBTA-Rate-Card-2025.pdf) ·
[Wrapbook SAG guide](https://www.wrapbook.com/blog/essential-guide-sag-rates) ·
[Wrapbook DGA guide](https://www.wrapbook.com/blog/essential-guide-dga-rate-card) ·
[Topsheet SAG 2025–26](https://www.topsheet.io/edu/rates/sag-aftra/sag-aftra-theatrical-rates-2025) ·
[Topsheet IATSE 2025–26](https://www.topsheet.io/edu/rates/iatse/iatse-theatrical-theatrical-rates) ·
[Greenslate IATSE BA changes](https://greenslate.com/blog/official-iatse-basic-agreement-changes-and-effective-dates) ·
[2024 IATSE Basic Agreement MOA](https://iatse.net/wp-content/uploads/2024/07/2024-IATSE-Basic-Agreement-MOA-FINAL.pdf)

**Talent deals (trade press):**
[Variety 2022 movie-star salary report](https://variety.com/2022/film/features/movie-star-salaries-joaquin-phoenix-joker-2-tom-cruise-1235320046/) ·
[THR "What Hollywood Earns Now"](https://www.hollywoodreporter.com/business/business-news/what-hollywood-earns-now-stars-execs-salaries-1235243926/) ·
[Forbes highest-paid actors 2023](https://www.forbes.com/sites/mattcraig/2024/03/06/highest-paid-actors-2023-adam-sandler-margot-robbie/) ·
[Forbes highest-paid actors 2025](https://www.forbes.com/sites/mattcraig/2026/03/13/the-highest-paid-actors-of-2025/) ·
[Variety on Nolan's Odyssey deal](https://variety.com/2026/film/news/christopher-nolan-odyssey-success-donna-langley-universal-1236817681/) ·
[Backstage actor pay guide](https://www.backstage.com/magazine/article/how-much-money-actors-make-for-films-68589/) ·
[NeedACrew casting rates](https://www.needacrew.com/blog/casting-director-rates) ·
[IndieWire indie producer pay](https://www.indiewire.com/news/general/how-much-does-an-american-indie-producer-get-paid-177871/)

**Production & post benchmarks:**
[FilmLA fee schedule](https://info.filmla.com/filming-related-fees/common-fees-la-city) ·
[Wrapbook NYC permits](https://www.wrapbook.com/blog/nyc-film-permits) ·
[Tools for Film location budgeting](https://www.toolsforfilm.com/blog/how-to-budget-location-costs) ·
[CSLA camera rentals](https://cslarentals.com/cameras/all/) ·
[ShareGrid rental-week conventions](https://support.sharegrid.com/en/articles/748910-how-are-rental-shoot-days-and-prices-calculated) ·
[Wrapbook production insurance](https://www.wrapbook.com/blog/essential-guide-film-production-insurance) ·
[Wrapbook completion bonds](https://www.wrapbook.com/blog/completion-bonds) ·
[Saturation.io SFX coordinator rates](https://saturation.io/film-crew-positions/special-effects-coordinator) ·
[Cinema Sound audio-post budgeting](https://www.cinemasound.com/budgeting-sound-much-audio-post-cost/) ·
[Robin Hoffmann film-music budgets](https://www.robin-hoffmann.com/tutorials/film-music-budget/) ·
[Vitrina VFX cost guide](https://vitrina.ai/blog/vfx-cost-guide/) ·
[ActionVFX cost breakdown](https://www.actionvfx.com/blog/visual-effects-cost-the-numbers-you-need-to-know) ·
[Stephen Follows budget research](https://stephenfollows.com/p/how-do-film-budgets-change-as-they-grow)

**AI model pricing (official/provider):**
[OpenAI API pricing (Sora 2)](https://developers.openai.com/api/docs/pricing) ·
[Google Gemini API pricing (Veo 3.1, image models)](https://ai.google.dev/gemini-api/docs/pricing) ·
[xAI Grok Imagine video](https://docs.x.ai/developers/models/grok-imagine-video) ·
[WaveSpeed Seedance 2.0](https://wavespeed.ai/models/bytedance/seedance-2.0/image-to-video) ·
[WaveSpeed Wan 2.5](https://wavespeed.ai/models/alibaba/wan-2.5/image-to-video) ·
[Replicate pricing](https://replicate.com/pricing) ·
[fal.ai Wan 2.7](https://fal.ai/wan-2.7) ·
[Kling API pricing snapshot](https://costbench.com/software/ai-media-apis/kling-api/) ·
[BFL FLUX pricing](https://bfl.ai/pricing)
