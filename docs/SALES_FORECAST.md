# Cinamate Sales Forecast — Methodology & Sources

Backs every number in `producer/sales-forecast.js` (the **Sales** tab of the
Producer Suite). Three legs: a statistical worldwide-gross forecast, the
distribution waterfall from gross to producer net, and the independent-film
sales path (territory pre-sales + streaming buyouts).

## Why quantile bands, not a number

We surveyed the open-source box-office prediction field before building
(top Kaggle "TMDB Box Office Prediction" solutions and related repos —
[jjone36/tmdb](https://github.com/jjone36/tmdb) RMSLE 1.72,
[DachshundSovereign](https://github.com/DachshundSovereign/Kaggle-TMDB-Box-Office) 1.89,
[bcjuang](https://github.com/bcjuang/box-office-prediction) 1.95,
[Vikranth3140/Movie-Revenue-Prediction](https://github.com/Vikranth3140/Movie-Revenue-Prediction)
(+[arXiv 2405.11651](https://arxiv.org/abs/2405.11651)) R² 0.74,
[thomsu/Box_Office_Success](https://github.com/thomsu/Box_Office_Success) SHAP analysis,
[jishubasak ROI classifier](https://github.com/jishubasak/Blockbusitng-the-Box-Office)).
The consensus: gradient-boosted trees on log-revenue win, budget's log-log
elasticity is ~0.8, and **even the best models leave a P10–P90 band of
roughly 0.2×–6× the point prediction**. A single-number forecast is theater;
quantile bands are the honest product. Common pitfalls we avoid: zero-budget
rows treated as real, leakage features (popularity, vote counts, theater
counts are partly post-release), and survivorship bias (datasets contain
only released films — we surface the failure rate separately).

## Leg 1 — worldwide gross quantiles

Calibrated on the TMDB 5000 dataset (3,708 released features with budget
≥ $100k; same data as our budget benchmarks). Our own fit: log-log slope
**0.848** (matches the literature's ~0.8), R² 0.40, and:

| Budget bracket | P10 | P25 | P50 | P75 | P90 | n |
|---|---|---|---|---|---|---|
| < $5M | 0.27× | 1.50× | 4.99× | 11.55× | 35.0× | 402 |
| $5–20M | 0.25× | 0.87× | 2.49× | 5.60× | 11.1× | 850 |
| $20–60M | 0.44× | 0.89× | 1.99× | 3.53× | 6.0× | 1,182 |
| $60–120M | 0.57× | 1.09× | 2.00× | 3.22× | 5.1× | 526 |
| $120M+ | 1.09× | 1.88× | 2.78× | 4.16× | 5.3× | 234 |

(× = worldwide gross ÷ budget.) Bands tighten as budgets rise; micro-budget
films are lottery tickets, tentpoles have floors. **15.5%** of budgeted
films report essentially no revenue (<5% of budget) — the "never really
released" failure mode, shown as a standing caveat.

Adjustment factors (the features the surveyed models agree on, applied
multiplicatively to the whole band, deliberately conservative):
genre (ratio of genre median multiple to the overall 2.30× median — Horror
3.55× is the standout), franchise/known IP ×1.7 (top-5 feature in every
surveyed model), star tier ×0.85–1.35, release window (summer/holiday
×1.15, January dump ×0.8), rating (PG/PG-13 ×1.1, R ×0.9, with a
Horror+R double-count guard).

## Leg 2 — the distribution waterfall

Gross → producer net, using the researched pipeline:

- **Theatrical rentals ≈ 42.8% of worldwide gross** blended (domestic ~50%
  rental rate on ~40% of WW, international 40%, China slice 25%)
  ([Stephen Follows](https://stephenfollows.com/p/how-a-cinemas-box-office-income-is-distributed),
  [Blockbuster economics 101](https://brandstofans.substack.com/p/blockbuster-movie-economics-101-and))
- **Theatrical is only part of lifetime revenue**: ~33% for studio releases
  (horror 38%, family/animation 34%, action 30%), ~25% for indie releases —
  the rest is home ent, streaming and TV
  ([Follows $30–100M films](https://stephenfollows.com/p/films-make-money-pt2-30m-100m-movies),
  [AFM low-budget data](https://americanfilmmarket.com/update-what-types-of-low-budget-films-break-out/))
- **Distribution fee** 30% studio / 25% indie; **P&A** ~80% of budget for
  wide releases (min $25M) / ~35% indie; **sales agent** ~10% of lifetime
  (indie); **equity recoups at 120%** (20% financing premium)
  ([Vitrina waterfall guide](https://vitrina.ai/blog/understanding-the-film-finance-waterfall-structure-a-complete-guide-to-movie-revenue-distribution/),
  [Thoolie](https://thoolie.com/guides/how-film-revenue-waterfalls-work/))

Validation: these inputs *derive* the industry's "2–2.5× budget breakeven"
rule (our computed breakeven for a $100M studio action film ≈ 2.2× budget),
and Follows' finding that "2× global BO" predicted blockbuster profitability
with 83% accuracy. The net pool after recoupment typically splits ~50/50
between investors and producer/talent.

## Leg 3 — independent sales

**Territory pre-sales**: sales-agent-style take/ask sheet as % of budget
(NA 8–12%, Germany 4–5.5%, Japan 4–5%, UK 3–5%, France 3–4%, etc. — total
coverage ~33–52% of budget, matching the researched 30–50% norm), scaled by
cast bankability ×0.55 (unknown) to ×1.8 (megastar), minus 15% agent
commission and ~$60k market expenses. Banks lend 70–90% against signed
pre-sale contracts. Producers famously overestimate these by ~2× — ours are
the sober numbers.
([Filmmaker Magazine — Foreign Sales 101](https://filmmakermagazine.com/73666-foreign-sales-101-selling-independent-films/),
[EP — World Revenues & Senior Debt](https://www.ep.com/blog/the-beginners-guide-to-world-revenues-foreign-sales-and-senior-debt/),
[SNR Films](https://www.snrfilms.com/post/crafty-table-how-foreign-sales-estimates-really-determine-your-film-s-value),
[FilmTake AFM 2025](https://www.filmtake.com/distribution/afm-2025-the-truth-about-minimum-guarantees-shrinking-territories-and-surviving-the-reset/))

**Streaming buyouts**: typical festival sale 0.5–1.3× budget; breakout genre
titles 2–10× (Sundance headline deals: *It's What's Inside* $17M,
*Fair Play* $20M, *Together* $17M — the top 1–2% of titles); streamer
originals pay cost +20–40%
([Variety](https://variety.com/2024/film/news/netflix-sundance-its-whats-inside-17-million-sale-1235882346/),
[CNBC cost-plus](https://www.cnbc.com/2018/08/15/netflix-cost-plus-model-tv-shows-revenue-upside.html),
[Screen Daily](https://www.screendaily.com/news/neon-closes-17m-worldwide-deal-on-sundance-hit-together/5201323.article)).

## Known limitations

- Calibration data is 2005-vintage theatrical-era; the streaming era shifts
  indie revenue toward flat license fees the gross model can't see — that's
  why the indie path is shown separately.
- Adjustment factors are consensus-derived heuristics, not fitted
  coefficients; franchise ×1.7 and star factors are directionally right,
  not per-title science.
- No P&A optimization: the model assumes P&A scales with budget, not with
  the release's actual ambitions.
- The failure rate (15.5%) is a dataset artifact (unreported revenue
  included) — treat as an order-of-magnitude reality check.
- Nothing here is investment advice; sales estimates from a real sales
  agent supersede all of it.
