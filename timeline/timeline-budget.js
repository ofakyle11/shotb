/* SHOTBREAK Timeline — Producer's Estimate (budget + schedule module)
 *
 * Two estimators driven by the parsed screenplay:
 *   1. AI rough-draft preview (lighting/set previz) — how long the Shotbreak
 *      generation run takes and what the model APIs will bill, per video model.
 *   2. Real-world production — a tiered line-item budget (director tier, star
 *      tier, supporting cast, crew union status, locations, equipment, VFX)
 *      with a shoot-day schedule derived from page count and detected
 *      budget drivers (stunts, night work, water, crowds, period, …).
 *
 * All dollar figures are planning-grade ranges, not quotes. Every rate lives
 * in the tables below so it can be tuned in one place. See
 * docs/PRODUCTION_PRICING.md for sources and methodology.
 */
(function (root) {
  'use strict';

  /* ════════════════════════════════════════════════════════════════════
   *  1. RATE TABLES
   * ════════════════════════════════════════════════════════════════════ */

  /* AI video model billing — USD per second of finished footage, by output
   * resolution, plus median queue+render wall-clock per clip. Verified against
   * provider list prices (Aug 2026): WaveSpeed (Seedance/Wan/Veo — this app's
   * default provider), fal.ai, Replicate, OpenAI, Google Gemini API, xAI.
   * List prices drift monthly; adjust here. Sources: docs/PRODUCTION_PRICING.md */
  var AI_MODEL_RATES = {
    // WaveSpeed Seedance 2.0 Fast: $0.50/5s 480p, $1.00/5s 720p, $2.50/5s 1080p; median e2e ~156s
    'seedance-2.0-turbo': { label: 'Seedance 2.0 Turbo', usdPerSec: { '480p': 0.10, '720p': 0.20, '1080p': 0.50 }, genSecPerClip: 150 },
    // fal/Replicate Wan 2.7: $0.10/s flat; Alibaba official wan2.6 $0.086 (720p) / $0.143 (1080p); Wan family median e2e ~47s
    'wan-2.7':            { label: 'Wan 2.7',            usdPerSec: { '720p': 0.10, '1080p': 0.14 },               genSecPerClip: 60 },
    // OpenAI official: sora-2 $0.10/s (720p); 30-90s typical render
    'sora-2':             { label: 'Sora 2',             usdPerSec: { '720p': 0.10 },                              genSecPerClip: 75 },
    // Google Gemini API Veo 3.1 standard (w/ audio): $0.40/s at 720p and 1080p; jobs 11s-6min
    'veo-3.1':            { label: 'Veo 3.1',            usdPerSec: { '720p': 0.40, '1080p': 0.40 },               genSecPerClip: 120 },
    // Kling 3.0 official per-unit: standard $0.084/s (720p), pro $0.112-$0.14/s w/ audio (1080p); 5s clip ~60-120s
    'kling-3.0-pro':      { label: 'Kling 3.0 Pro',      usdPerSec: { '720p': 0.112, '1080p': 0.14 },              genSecPerClip: 120 },
    // xAI official grok-imagine-video: $0.05/s output, audio included (480p/720p); ~25s for 6s clip
    'grok-imagine':       { label: 'Grok Imagine',       usdPerSec: { '480p': 0.05, '720p': 0.05 },                genSecPerClip: 40 }
  };

  var AI_DEFAULTS = {
    retakeFactor: 1.6,   // avg generations per kept clip (regens + rejects)
    concurrency: 3,      // clips rendering in parallel
    imageUsd: 0.04,      // one still — Nano Banana $0.039, FLUX dev $0.025, gpt-image med ~$0.042
    imageTakes: 2,       // takes per kept still
    setupMinutes: 12     // parse, character/location enrichment, prompt passes
  };

  /* Real-world tiers. range = [low, high] USD unless noted.
   * Calibrated against 2025-26 published union scale (SAG-AFTRA, IATSE,
   * DGA, WGA official rate sheets), FilmLA/NYC permit schedules, rental
   * house price lists and trade-press deal reporting.
   * Full source list + methodology: docs/PRODUCTION_PRICING.md. */
  var TIERS = {
    scale: [
      /* scriptRights anchored to WGA minimums: original screenplay incl. treatment
       * = $90,904 low-budget (<$5M) / $170,655 high-budget (2025-26 MBA). */
      { id: 'micro',    label: 'Micro-budget (< $500k)',   pagesPerDay: 7,   crewSize: 12,  crewAvgDay: 350, artPerDay: [500, 2000],     scriptRights: [2e3, 30e3],    producers: [10e3, 30e3],   sound: [3e3, 20e3],    music: [3e3, 20e3],   di: [1e3, 10e3],   editorialWk: [1500, 3500],  castingFee: [1500, 5e3] },
      { id: 'low',      label: 'Low budget ($500k–$2M)',   pagesPerDay: 5.5, crewSize: 30,  crewAvgDay: 450, artPerDay: [1500, 5000],    scriptRights: [30e3, 95e3],   producers: [25e3, 100e3],  sound: [20e3, 60e3],   music: [15e3, 60e3],  di: [8e3, 30e3],   editorialWk: [3000, 6000],  castingFee: [5e3, 15e3] },
      { id: 'indie',    label: 'Indie ($2M–$10M)',         pagesPerDay: 4.5, crewSize: 60,  crewAvgDay: 600, artPerDay: [4000, 15000],   scriptRights: [91e3, 350e3],  producers: [100e3, 500e3], sound: [50e3, 150e3],  music: [50e3, 250e3], di: [25e3, 85e3],  editorialWk: [6000, 12000], castingFee: [15e3, 40e3] },
      { id: 'mid',      label: 'Mid-level ($10M–$40M)',    pagesPerDay: 3.5, crewSize: 110, crewAvgDay: 700, artPerDay: [12000, 45000],  scriptRights: [250e3, 1.5e6], producers: [500e3, 2e6],   sound: [150e3, 450e3], music: [200e3, 1e6],  di: [65e3, 200e3], editorialWk: [10000, 20000], castingFee: [40e3, 100e3] },
      { id: 'studio',   label: 'Studio ($40M–$100M)',      pagesPerDay: 3,   crewSize: 180, crewAvgDay: 800, artPerDay: [35000, 120000], scriptRights: [1e6, 4e6],     producers: [1.5e6, 5e6],   sound: [400e3, 1e6],   music: [1e6, 3e6],    di: [150e3, 500e3], editorialWk: [15000, 30000], castingFee: [100e3, 250e3] },
      { id: 'tentpole', label: 'Tentpole ($100M+)',        pagesPerDay: 2.2, crewSize: 300, crewAvgDay: 900, artPerDay: [90000, 350000], scriptRights: [2.5e6, 12e6],  producers: [5e6, 15e6],    sound: [1e6, 3e6],     music: [2.5e6, 8e6],  di: [400e3, 1.2e6], editorialWk: [25000, 50000], castingFee: [200e3, 500e3] }
    ],
    /* DGA low-budget sideletter ≈ $9k-$20k min on micro films; DGA basic scale
     * ≈ $320k min run on $11M+ films; THR: veterans $2.5M-$7M; reported
     * A-list fees $15M-$25M upfront plus gross points (Nolan class). */
    director: [
      { id: 'first',       label: 'First-time director',            range: [10e3, 75e3] },
      { id: 'emerging',    label: 'Emerging (festival credits)',    range: [85e3, 500e3] },
      { id: 'established', label: 'Established (DGA scale+)',       range: [500e3, 2.5e6] },
      { id: 'veteran',     label: 'Veteran hitmaker',               range: [2.5e6, 7e6] },
      { id: 'alist',       label: 'A-list director',                range: [7e6, 15e6] },
      { id: 'legend',      label: 'Legend (fee + gross points)',    range: [15e6, 25e6] }
    ],
    /* SAG scale day rate $1,246 (25-26); Schedule F run-of-picture ~$65k-$80k.
     * Reported deals: rising $300k-$2M (Zendaya/Chalamet Dune 1), name $2M-$5M,
     * star $8M-$15M (Murphy, Robbie/Gosling Barbie), A-list $20M-$35M
     * (DiCaprio, Pitt, Smith), megastar $50M+ (Johnson Red One, Cruise). */
    lead: [
      { id: 'unknown',  label: 'Unknown (SAG scale)',           range: [15e3, 80e3] },
      { id: 'rising',   label: 'Rising talent',                 range: [100e3, 2e6] },
      { id: 'name',     label: 'Recognizable name',             range: [2e6, 5e6] },
      { id: 'star',     label: 'Star',                          range: [8e6, 15e6] },
      { id: 'alist',    label: 'A-list star',                   range: [20e6, 35e6] },
      { id: 'megastar', label: 'Megastar (fee + backend)',      range: [50e6, 100e6] }
    ],
    /* Per-role: indie character actors $5k-$50k total; studio supporting
     * $20k-$200k; prestige name supporting up to $2M-$4M (Oppenheimer). */
    supporting: [
      { id: 'scale',    label: 'Scale / indie character actors', range: [5e3, 50e3] },
      { id: 'seasoned', label: 'Seasoned character actors',      range: [20e3, 200e3] },
      { id: 'name',     label: 'Name supporting cast',           range: [200e3, 2e6] },
      { id: 'starcameo',label: 'Star cameos / prestige names',   range: [250e3, 4e6] }
    ],
    /* All-in fringe rules of thumb: non-union ~28-30% (payroll tax + WC +
     * handling); IATSE ~40% (MPI H&P $9.97/hr + IAP 6% + vacation/holiday);
     * SAG cast ~45% — cast fringe is applied at a 0.6 weighting because
     * P&H contributions cap out on large star fees. */
    crew: [
      { id: 'nonunion', label: 'Non-union',                          fringe: 0.28, rateMult: 0.75 },
      { id: 'hybrid',   label: 'Hybrid / low-budget agreements',     fringe: 0.32, rateMult: 0.90 },
      { id: 'union',    label: 'Full union (IATSE / DGA / SAG)',     fringe: 0.40, rateMult: 1.15 }
    ],
    /* Residential $500-$2.5k/day, commercial $2k-$15k/day, landmark $10k+/day.
     * perLocFee = permits + prep/restore per unique location (FilmLA permit
     * $931 + $232 notification; NYC $500/14 days). Stage: indie stages
     * $900-$1,800/day + set construction per built set. */
    locations: [
      { id: 'local',         label: 'Local practical locations',      perDay: [500, 2500],   perLocFee: [150, 950],    travelPct: 0 },
      { id: 'city',          label: 'Major-city streets & permits',   perDay: [2000, 10000], perLocFee: [1000, 3500],  travelPct: 0.02 },
      { id: 'premium',       label: 'Premium / landmark locations',   perDay: [8000, 30000], perLocFee: [2500, 15000], travelPct: 0.03 },
      { id: 'stage',         label: 'Stage builds (soundstage)',      perDay: [1000, 12000], perLocFee: [15e3, 400e3], travelPct: 0 },
      { id: 'international', label: 'International / remote exotic',  perDay: [4000, 20000], perLocFee: [2000, 12000], travelPct: 0.08 }
    ],
    /* Weekly = 3x day rate ("3-day week" rental convention). Alexa 35 /
     * Venice 2 packaged ≈ $2.5k/day; 5-ton G&E truck ≈ $650/day. */
    equipment: [
      { id: 'indie', label: 'Indie kit (mirrorless / prosumer)',        perWeek: [800, 4000] },
      { id: 'pro',   label: 'Pro package (cine camera + G&E truck)',    perWeek: [9000, 30000] },
      { id: 'studio',label: 'Studio package (Alexa/Venice, multi-cam)', perWeek: [30000, 90000] },
      { id: 'imax',  label: 'Large-format / IMAX',                      perWeek: [80000, 200000] }
    ],
    /* perShot from vendor guides: cleanup $100-$1k, comps/set ext $1k-$5k,
     * creatures/sims $5k-$50k, hero CG $75k-$200k (blockbuster avg
     * $46k-$62k/shot). shotsPerMin floors mirror real shot counts: even
     * "no-VFX" features carry 50-100 invisible fixes; blockbusters run
     * 1,600-3,300 shots (Rogue One, Avatar 2). */
    vfx: [
      { id: 'none',     label: 'None / practical only',           shotsPct: 0,    shotsPerMin: 0,   perShot: [0, 0] },
      { id: 'light',    label: 'Light (cleanup, comps)',          shotsPct: 0.10, shotsPerMin: 0.5, perShot: [300, 1500] },
      { id: 'moderate', label: 'Moderate (set ext., sims)',       shotsPct: 0.25, shotsPerMin: 2,   perShot: [1000, 5000] },
      { id: 'heavy',    label: 'Heavy (creatures, environments)', shotsPct: 0.45, shotsPerMin: 6,   perShot: [5000, 40000] },
      { id: 'full',     label: 'Full-scale CG spectacle',         shotsPct: 0.70, shotsPerMin: 15,  perShot: [40000, 120000] }
    ]
  };

  var EXTRA_DAY_RATE = [120, 270];        // background per person-day: non-union ~$100-200 → SAG $224 + 20.5% P&H
  var DAY_PLAYER_RANGE = [1500, 6000];    // small speaking part, whole run (SAG day $1,246 / LBA $810 × 2-5 days)
  var STUNT_DAY = [4000, 15000];          // coordinator ($1,938 flat-deal day) + performers ($1,246/day) + rigging + adjustments
  var PYRO_DAY = [6000, 40000];           // licensed pyrotechnician $1.2k-$2.5k/day + SFX crew + materials + fire safety
  var WATER_DAY = [8000, 50000];          // tank rental ($1.2k-$2k/day small) to full marine/dive-safety unit
  var ANIMAL_DAY = [1500, 8000];          // wrangler + humane officer per animal day
  var OT_FACTOR = 0.12;                   // overtime bleed beyond the blended 12-hr day baked into crewAvgDay
  var INSURANCE_PCT = 0.025;              // production insurance: 2-3% of budget
  var LEGAL_PCT = 0.015;
  var BOND_PCT = 0.025;                   // completion bond ~2-3% net (indie financing only)
  var CONTINGENCY_PCT = 0.10;             // standard bond-company requirement

  /* ════════════════════════════════════════════════════════════════════
   *  2. SCRIPT ANALYSIS
   * ════════════════════════════════════════════════════════════════════ */

  var DRIVERS = [
    { key: 'stunts',   label: 'Stunts & fights',      weight: 8, re: /\b(fight|fistfight|brawl|punch\w*|kick\w*|stunt\w*|tackle\w*|slams?|leaps?|dives?|crash\w*|chase[sd]?|chasing|shoves?|grapples?)\b/gi },
    { key: 'pyro',     label: 'Fire & explosions',    weight: 9, re: /\b(explosion\w*|explodes?|blast\w*|fireball|detonat\w*|burn(s|ing|ed)?|flames?|on fire|inferno|smolder\w*)\b/gi },
    { key: 'gunplay',  label: 'Weapons / gunfire',    weight: 6, re: /\b(guns?|pistol|revolver|rifle|shotgun|gunshot\w*|shoot(s|out|ing)?|muzzle|bullets?|holster|sniper)\b/gi },
    { key: 'vehicles', label: 'Vehicle action',       weight: 7, re: /\b(car chase|swerv\w*|speeding|skids?|motorcycle|helicopter|chopper|jet\b|airplane|train\b|semi[- ]?truck|eighteen[- ]?wheeler|wrecks?)\b/gi },
    { key: 'water',    label: 'Water work',           weight: 8, re: /\b(underwater|ocean|sea\b|lake|river|harbor|pool\b|drown\w*|swim\w*|boat\w*|ships?|yacht|submarine|waves?|surf\w*)\b/gi },
    { key: 'weather',  label: 'Weather FX',           weight: 4, re: /\b(rain\w*|downpour|drizzl\w*|snow\w*|blizzard|storm\w*|thunder\w*|lightning|hail|fog|mist)\b/gi },
    { key: 'vfx',      label: 'VFX / creatures',      weight: 9, re: /\b(creature\w*|monster\w*|dragon\w*|alien\w*|spaceship|starship|robot\w*|cyborg|android|hologram\w*|portal\w*|magic\w*|spells?|sorcer\w*|transforms?|morphs?|zombie\w*|ghost\w*|demon\w*|superpower\w*|levitat\w*|telekine\w*|shapeshift\w*)\b/gi },
    { key: 'crowds',   label: 'Crowd scenes',         weight: 6, re: /\b(crowds?|mob\b|riot\w*|audience|stadium|arena|concert|parade|protest\w*|onlookers|bystanders|patrons|soldiers|army|battalion|warriors|villagers|congregation)\b/gi },
    { key: 'animals',  label: 'Animals on set',       weight: 5, re: /\b(dogs?|cats?|horse\w*|wolf|wolves|lions?|tigers?|bears?|snakes?|hawks?|eagles?|livestock|cattle|goats?|chickens?)\b/gi },
    { key: 'children', label: 'Child actors',         weight: 4, re: /\b(child|children|kids?|toddler|baby|infant|schoolyard|playground)\b/gi },
    { key: 'period',   label: 'Period setting',       weight: 8, re: /\b(1[0-8]\d\d|19[0-5]\d|medieval|victorian|edwardian|castle\w*|carriage|horse-drawn|sword\w*|knights?|ancient|roman empire|samurai|wild west|saloon|frontier|colonial)\b/gi },
    { key: 'aerial',   label: 'Aerial / drone work',  weight: 3, re: /\b(aerial\w*|bird'?s[- ]eye|drone (shot|view)|helicopter shot|flyover|high above the)\b/gi }
  ];

  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function textFromClips(clips) {
    return (clips || []).map(function (c) {
      return [c.heading, c.description, c.dialogue].filter(Boolean).join('\n');
    }).join('\n\n');
  }

  function pickText(st) {
    var t = String((st && st.scriptText) || '').trim();
    if (t.length > 200) return t;
    return textFromClips(st && st.clips) || t;
  }

  function estimatePages(text, clips) {
    var words = String(text || '').split(/\s+/).filter(Boolean).length;
    if (words > 150) return Math.max(1, Math.round(words / 200));
    var secs = (clips || []).reduce(function (a, c) { return a + (c.durationSec || 5); }, 0);
    return Math.max(1, Math.round(secs / 60));
  }

  function detectDrivers(text) {
    var out = [];
    DRIVERS.forEach(function (d) {
      var m = String(text || '').match(d.re);
      var count = m ? m.length : 0;
      if (count > 0) out.push({ key: d.key, label: d.label, count: count, weight: d.weight });
    });
    out.sort(function (a, b) { return b.count * b.weight - a.count * a.weight; });
    return out;
  }

  function driverCount(drivers, key) {
    var d = (drivers || []).find(function (x) { return x.key === key; });
    return d ? d.count : 0;
  }

  function analyze(st) {
    st = st || {};
    var clips = st.clips || [];
    var text = pickText(st);
    var pages = estimatePages(text, clips);

    // Scene headings — prefer real parse, fall back to regex over the text.
    var headings = [];
    if (st.parseResult && Array.isArray(st.parseResult.scenes) && st.parseResult.scenes.length) {
      headings = st.parseResult.scenes.map(function (s) { return String(s.heading || ''); });
    } else if (clips.length) {
      var seen = {};
      clips.forEach(function (c) {
        var h = String(c.heading || '').trim();
        if (h && !seen[h]) { seen[h] = 1; headings.push(h); }
      });
    }
    if (!headings.length) {
      headings = (String(text).match(/^.*\b(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.).*$/gim) || []).map(function (s) { return s.trim(); });
    }
    var scenes = Math.max(headings.length, 1);

    var intCount = 0, extCount = 0, nightCount = 0;
    var locSet = {};
    headings.forEach(function (h) {
      if (/\bEXT\b|\bEXT\./i.test(h)) extCount++; else intCount++;
      if (/\b(NIGHT|DUSK|EVENING|MIDNIGHT|PRE-DAWN)\b/i.test(h)) nightCount++;
      var name = h.replace(/^\s*(?:\d+[A-Z]?[.\s-]*)?(INT\.|EXT\.|INT\/EXT\.|I\/E\.?)\s*/i, '').split(/\s+[-—–]\s+/)[0].trim().toUpperCase();
      if (name) locSet[name] = 1;
    });
    var uniqueLocations = Math.max(Object.keys(locSet).length,
      (st.locationBible || []).length ? (st.locationBible || []).length : 0, 1);

    // Cast: rank characters by how often they appear in clips + dialogue cues.
    var charNames = Object.keys(st.characters || {});
    var freq = {};
    charNames.forEach(function (n) { freq[n] = 0; });
    clips.forEach(function (c) {
      (c.characters || []).forEach(function (n) {
        var k = String(n || '').toUpperCase().trim();
        if (!k) return;
        freq[k] = (freq[k] || 0) + 1;
      });
    });
    var ranked = Object.keys(freq).filter(function (k) { return freq[k] > 0 || charNames.indexOf(k) >= 0; })
      .sort(function (a, b) { return (freq[b] || 0) - (freq[a] || 0); });
    if (!ranked.length && charNames.length) ranked = charNames.slice();
    var castTotal = Math.max(ranked.length, 1);
    var leads = clamp(castTotal >= 2 ? 2 : 1, 1, 2);
    var supporting = clamp(castTotal - leads, 0, 6);
    var dayPlayers = Math.max(castTotal - leads - supporting, 0);

    var drivers = detectDrivers(text);
    var complexity = 0;
    drivers.forEach(function (d) { complexity += Math.min(d.count, 10) / 10 * d.weight; });
    complexity = Math.round(clamp(complexity / 0.72, 0, 100)); // 72 = max possible weight sum

    var totalClipSec = clips.reduce(function (a, c) { return a + (c.durationSec || 5); }, 0);

    return {
      pages: pages,
      runtimeMin: pages,               // industry rule of thumb: 1 page ≈ 1 minute
      scenes: scenes,
      clips: clips.length,
      clipSeconds: totalClipSec,
      intCount: intCount,
      extCount: extCount,
      nightCount: nightCount,
      nightPct: scenes ? nightCount / scenes : 0,
      uniqueLocations: uniqueLocations,
      castTotal: castTotal,
      leads: leads,
      supporting: supporting,
      dayPlayers: dayPlayers,
      leadNames: ranked.slice(0, leads),
      drivers: drivers,
      complexity: complexity,
      hasText: !!text
    };
  }

  /* ════════════════════════════════════════════════════════════════════
   *  3. AI PREVIEW ESTIMATE
   * ════════════════════════════════════════════════════════════════════ */

  function rateForRes(model, res) {
    var m = AI_MODEL_RATES[model];
    if (!m) return null;
    if (m.usdPerSec[res] != null) return m.usdPerSec[res];
    var keys = Object.keys(m.usdPerSec);
    return m.usdPerSec[keys[keys.length - 1]]; // closest available tier
  }

  function estimateAI(st, analysis, opts) {
    opts = opts || {};
    var g = (st && st.global) || {};
    var retake = clamp(num(opts.retakeFactor, AI_DEFAULTS.retakeFactor), 1, 4);
    var conc = clamp(Math.round(num(opts.concurrency, AI_DEFAULTS.concurrency)), 1, 8);
    var clipCount = analysis.clips || Math.max(analysis.scenes * 3, 6); // ~3 shots/scene if not parsed yet
    var avgDur = num(g.clipDuration, 5);
    var res = g.quality || '720p';

    var stills = (analysis.castTotal + analysis.uniqueLocations) * AI_DEFAULTS.imageTakes;
    var stillsUsd = stills * AI_DEFAULTS.imageUsd;

    var rows = Object.keys(AI_MODEL_RATES).map(function (id) {
      var m = AI_MODEL_RATES[id];
      var rate = rateForRes(id, res);
      var footageSec = clipCount * avgDur;
      var onePass = footageSec * rate;
      var likely = onePass * retake + stillsUsd;
      var genSec = Math.ceil(clipCount * retake / conc) * m.genSecPerClip;
      var wallMin = Math.round(genSec / 60 + AI_DEFAULTS.setupMinutes);
      return {
        id: id,
        label: m.label,
        usdPerSec: rate,
        clips: clipCount,
        footageSec: footageSec,
        onePassUsd: onePass,
        likelyUsd: likely,
        highUsd: onePass * retake * 1.35 + stillsUsd,
        wallMinutes: wallMin,
        selected: id === g.model
      };
    });

    return {
      resolution: res,
      avgClipSec: avgDur,
      clipCount: clipCount,
      retakeFactor: retake,
      concurrency: conc,
      stillsCount: stills,
      stillsUsd: stillsUsd,
      rows: rows,
      selectedRow: rows.find(function (r) { return r.selected; }) || rows[0]
    };
  }

  /* ════════════════════════════════════════════════════════════════════
   *  4. REAL-WORLD PRODUCTION ESTIMATE
   * ════════════════════════════════════════════════════════════════════ */

  function tier(list, id) {
    var t = list.find(function (x) { return x.id === id; });
    return t || list[0];
  }
  function R(range, mult) {
    mult = mult == null ? 1 : mult;
    return [range[0] * mult, range[1] * mult];
  }
  function addR(a, b) { return [a[0] + b[0], a[1] + b[1]]; }

  function suggestVfxTier(analysis) {
    var v = driverCount(analysis.drivers, 'vfx');
    var p = driverCount(analysis.drivers, 'pyro');
    var score = v * 2 + p;
    if (score === 0) return 'none';
    if (score < 8) return 'light';
    if (score < 24) return 'moderate';
    if (score < 60) return 'heavy';
    return 'full';
  }

  function estimateProduction(analysis, sel) {
    sel = sel || {};
    var scale = tier(TIERS.scale, sel.scale || 'indie');
    var director = tier(TIERS.director, sel.director || 'emerging');
    var lead = tier(TIERS.lead, sel.lead || 'rising');
    var support = tier(TIERS.supporting, sel.supporting || 'scale');
    var crew = tier(TIERS.crew, sel.crew || 'nonunion');
    var loc = tier(TIERS.locations, sel.locations || 'local');
    var equip = tier(TIERS.equipment, sel.equipment || 'indie');
    var vfxId = sel.vfx === 'auto' || !sel.vfx ? suggestVfxTier(analysis) : sel.vfx;
    var vfx = tier(TIERS.vfx, vfxId);

    /* ── Schedule ────────────────────────────────────────────────── */
    var driverLoad =
      1 +
      analysis.nightPct * 0.15 +
      Math.min(driverCount(analysis.drivers, 'stunts'), 20) * 0.005 +
      Math.min(driverCount(analysis.drivers, 'pyro'), 10) * 0.01 +
      Math.min(driverCount(analysis.drivers, 'water'), 10) * 0.008 +
      Math.min(driverCount(analysis.drivers, 'crowds'), 15) * 0.004 +
      (vfx.shotsPct >= 0.45 ? 0.10 : 0);
    var shootDays = Math.max(5, Math.ceil(analysis.pages / scale.pagesPerDay * driverLoad));
    var shootWeeks = shootDays / 5;
    var prepWeeks = Math.max(2, Math.round(shootWeeks * (scale.crewSize >= 110 ? 1.6 : 1.1)));
    var postWeeks = Math.max(8, Math.round(shootWeeks * 2.4 + (vfx.shotsPct >= 0.45 ? 16 : vfx.shotsPct >= 0.25 ? 8 : 0)));

    /* ── Above the line ──────────────────────────────────────────── */
    var castLeads = R(lead.range, analysis.leads);
    var castSupport = R(support.range, analysis.supporting);
    var castDay = R(DAY_PLAYER_RANGE, analysis.dayPlayers);
    var atl = {};
    atl['Story & rights'] = R(scale.scriptRights);
    atl['Producers'] = R(scale.producers);
    atl['Director'] = R(director.range);
    atl['Lead cast (' + analysis.leads + ')'] = castLeads;
    atl['Supporting cast (' + analysis.supporting + ')'] = castSupport;
    atl['Day players (' + analysis.dayPlayers + ')'] = castDay;
    atl['Casting'] = R(scale.castingFee);

    /* ── Below the line (production) ─────────────────────────────── */
    var laborBase = scale.crewSize * scale.crewAvgDay * crew.rateMult * shootDays * (1 + OT_FACTOR);
    var crewLabor = [laborBase * 0.9, laborBase * 1.15];
    var castFringeBase = addR(addR(castLeads, castSupport), castDay);
    var fringes = [
      (crewLabor[0] + castFringeBase[0] * 0.6) * crew.fringe,
      (crewLabor[1] + castFringeBase[1] * 0.6) * crew.fringe
    ];

    var crowdHits = driverCount(analysis.drivers, 'crowds');
    var extrasDays = crowdHits ? clamp(crowdHits * 12, 20, 4000) : Math.round(shootDays * 2);
    var extras = [extrasDays * EXTRA_DAY_RATE[0], extrasDays * EXTRA_DAY_RATE[1]];

    var equipWeeks = shootWeeks + 1; // includes prep/test week
    var equipment = [equip.perWeek[0] * equipWeeks, equip.perWeek[1] * equipWeeks];

    var locations = [
      loc.perDay[0] * shootDays + loc.perLocFee[0] * analysis.uniqueLocations,
      loc.perDay[1] * shootDays + loc.perLocFee[1] * analysis.uniqueLocations
    ];
    var art = [scale.artPerDay[0] * shootDays, scale.artPerDay[1] * shootDays];

    var stuntDays = Math.min(Math.ceil(driverCount(analysis.drivers, 'stunts') / 4), shootDays);
    var pyroDays = Math.min(Math.ceil(driverCount(analysis.drivers, 'pyro') / 3), Math.ceil(shootDays / 2));
    var waterDays = Math.min(Math.ceil(driverCount(analysis.drivers, 'water') / 5), Math.ceil(shootDays / 2));
    var animalDays = Math.min(Math.ceil(driverCount(analysis.drivers, 'animals') / 4), shootDays);
    var specialUnits = [
      stuntDays * STUNT_DAY[0] + pyroDays * PYRO_DAY[0] + waterDays * WATER_DAY[0] + animalDays * ANIMAL_DAY[0],
      stuntDays * STUNT_DAY[1] + pyroDays * PYRO_DAY[1] + waterDays * WATER_DAY[1] + animalDays * ANIMAL_DAY[1]
    ];

    var transport = [crewLabor[0] * 0.10, crewLabor[1] * 0.14];
    var travel = loc.travelPct ? [
      (crewLabor[0] + castFringeBase[0]) * loc.travelPct * 2,
      (crewLabor[1] + castFringeBase[1]) * loc.travelPct * 2
    ] : [0, 0];

    var btl = {};
    btl['Crew labor (~' + scale.crewSize + ' crew × ' + shootDays + ' days)'] = crewLabor;
    btl['Payroll fringes (' + Math.round(crew.fringe * 100) + '%)'] = fringes;
    btl['Background / extras (~' + extrasDays + ' person-days)'] = extras;
    btl['Camera, grip & electric'] = equipment;
    btl['Locations & permits (' + analysis.uniqueLocations + ' locations)'] = locations;
    btl['Production design / art dept'] = art;
    btl['Stunts, SFX & special units'] = specialUnits;
    btl['Transportation'] = transport;
    btl['Travel & living'] = travel;

    /* ── Post-production ─────────────────────────────────────────── */
    var vfxShots = Math.max(
      Math.round((analysis.clips || analysis.scenes * 3) * vfx.shotsPct),
      Math.round(analysis.runtimeMin * (vfx.shotsPerMin || 0))
    );
    var vfxCost = [vfxShots * vfx.perShot[0], vfxShots * vfx.perShot[1]];
    var editorial = [scale.editorialWk[0] * postWeeks, scale.editorialWk[1] * postWeeks];
    var post = {};
    post['Editorial (' + postWeeks + ' weeks)'] = editorial;
    post['VFX (' + vfxShots + ' shots, ' + vfx.label.toLowerCase() + ')'] = vfxCost;
    post['Sound design & mix'] = R(scale.sound);
    post['Music (score + licensing)'] = R(scale.music);
    post['Color / DI & deliverables'] = R(scale.di);

    /* ── Other ───────────────────────────────────────────────────── */
    function sumGroup(g) {
      var lo = 0, hi = 0;
      Object.keys(g).forEach(function (k) { lo += g[k][0]; hi += g[k][1]; });
      return [lo, hi];
    }
    var direct = addR(addR(sumGroup(atl), sumGroup(btl)), sumGroup(post));
    var isIndieFinanced = ['micro', 'low', 'indie', 'mid'].indexOf(scale.id) >= 0;
    var other = {
      'Insurance (2.5%)': R(direct, INSURANCE_PCT),
      'Legal & finance (1.5%)': R(direct, LEGAL_PCT),
      'Contingency (10%)': R(direct, CONTINGENCY_PCT)
    };
    if (isIndieFinanced) other['Completion bond (2.5%)'] = R(direct, BOND_PCT);

    var total = addR(direct, sumGroup(other));
    var likely = (total[0] + total[1]) / 2;

    return {
      tiers: { scale: scale, director: director, lead: lead, supporting: support, crew: crew, locations: loc, equipment: equip, vfx: vfx, vfxAuto: (sel.vfx === 'auto' || !sel.vfx) },
      schedule: { shootDays: shootDays, prepWeeks: prepWeeks, postWeeks: postWeeks, totalWeeks: Math.round(prepWeeks + shootWeeks + postWeeks) },
      groups: { 'Above the line': atl, 'Production (below the line)': btl, 'Post-production': post, 'Other': other },
      groupTotals: {
        'Above the line': sumGroup(atl),
        'Production (below the line)': sumGroup(btl),
        'Post-production': sumGroup(post),
        'Other': sumGroup(other)
      },
      vfxShots: vfxShots,
      total: { low: total[0], likely: likely, high: total[1] }
    };
  }

  /* ════════════════════════════════════════════════════════════════════
   *  5. FORMATTING
   * ════════════════════════════════════════════════════════════════════ */

  function fmtMoney(n) {
    n = Math.max(0, Math.round(n));
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return '$' + n;
  }
  function fmtRange(r) { return fmtMoney(r[0]) + ' – ' + fmtMoney(r[1]); }
  function fmtMins(min) {
    min = Math.max(1, Math.round(min));
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + 'h ' + (m ? m + 'm' : '').trim();
  }
  function escT(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ════════════════════════════════════════════════════════════════════
   *  6. AI LINE PRODUCER DIGEST
   * ════════════════════════════════════════════════════════════════════ */

  function buildDigest(st, analysis, prod, ai) {
    var L = [];
    L.push('PROJECT: ' + ((st && st.projectName) || 'Untitled Film'));
    L.push('SCRIPT: ~' + analysis.pages + ' pages / ~' + analysis.runtimeMin + ' min runtime, ' + analysis.scenes + ' scenes (' + analysis.intCount + ' INT / ' + analysis.extCount + ' EXT, ' + analysis.nightCount + ' night)');
    L.push('CAST: ' + analysis.castTotal + ' speaking (' + analysis.leads + ' leads' + (analysis.leadNames.length ? ': ' + analysis.leadNames.join(', ') : '') + ', ' + analysis.supporting + ' supporting, ' + analysis.dayPlayers + ' day players); LOCATIONS: ' + analysis.uniqueLocations);
    if (analysis.drivers.length) {
      L.push('BUDGET DRIVERS: ' + analysis.drivers.slice(0, 8).map(function (d) { return d.label + ' ×' + d.count; }).join('; '));
    }
    L.push('CHOSEN TIERS: scale=' + prod.tiers.scale.label + '; director=' + prod.tiers.director.label + '; lead=' + prod.tiers.lead.label + '; supporting=' + prod.tiers.supporting.label + '; crew=' + prod.tiers.crew.label + '; locations=' + prod.tiers.locations.label + '; equipment=' + prod.tiers.equipment.label + '; vfx=' + prod.tiers.vfx.label);
    L.push('MODEL SCHEDULE: ' + prod.schedule.shootDays + ' shoot days, ' + prod.schedule.prepWeeks + ' prep wks, ' + prod.schedule.postWeeks + ' post wks');
    Object.keys(prod.groupTotals).forEach(function (k) {
      L.push(k.toUpperCase() + ': ' + fmtRange(prod.groupTotals[k]));
    });
    L.push('MODEL TOTAL: ' + fmtMoney(prod.total.low) + ' low / ' + fmtMoney(prod.total.likely) + ' likely / ' + fmtMoney(prod.total.high) + ' high');
    if (ai && ai.selectedRow) {
      L.push('AI PREVIEW (for contrast): ' + ai.clipCount + ' clips on ' + ai.selectedRow.label + ' ≈ ' + fmtMoney(ai.selectedRow.likelyUsd) + ' and ' + fmtMins(ai.selectedRow.wallMinutes));
    }
    return L.join('\n').slice(0, 1900);
  }

  /* ════════════════════════════════════════════════════════════════════
   *  7. UI (panel rendering + wiring)
   * ════════════════════════════════════════════════════════════════════ */

  var PREF_KEY = 'SB_Budget_v1';
  var _env = null;      // {getState, toast}
  var _sig = '';
  var _prefs = null;
  var _aiNotes = '';    // last line-producer output
  var _aiBusy = false;

  function prefs() {
    if (_prefs) return _prefs;
    _prefs = { scale: 'indie', director: 'emerging', lead: 'rising', supporting: 'scale', crew: 'nonunion', locations: 'local', equipment: 'indie', vfx: 'auto', retakeFactor: AI_DEFAULTS.retakeFactor, concurrency: AI_DEFAULTS.concurrency };
    try {
      var saved = JSON.parse((root.localStorage && root.localStorage.getItem(PREF_KEY)) || 'null');
      if (saved) Object.assign(_prefs, saved);
    } catch (e) {}
    return _prefs;
  }
  function savePrefs() {
    try { root.localStorage && root.localStorage.setItem(PREF_KEY, JSON.stringify(prefs())); } catch (e) {}
  }

  function $id(id) { return (typeof document !== 'undefined') ? document.getElementById(id) : null; }

  function tierSelect(id, list, current, labelTxt, autoOption) {
    var opts = '';
    if (autoOption) opts += '<option value="auto"' + (current === 'auto' ? ' selected' : '') + '>Auto (from script)</option>';
    list.forEach(function (t) {
      opts += '<option value="' + t.id + '"' + (t.id === current ? ' selected' : '') + '>' + escT(t.label) + '</option>';
    });
    return '<label class="bud-field"><span>' + escT(labelTxt) + '</span><select id="' + id + '" class="uc-sel bud-sel">' + opts + '</select></label>';
  }

  function statChip(label, value) {
    return '<div class="bud-stat"><b>' + escT(String(value)) + '</b><span>' + escT(label) + '</span></div>';
  }

  function renderBody(st) {
    var body = $id('budBody');
    if (!body) return;
    var analysis = analyze(st);
    if (!analysis.hasText && !analysis.clips) {
      body.innerHTML = '<div class="bud-empty">Import and parse a script first — the estimate reads your timeline.</div>';
      return;
    }
    var p = prefs();
    var ai = estimateAI(st, analysis, p);
    var prod = estimateProduction(analysis, p);

    var html = '';

    /* Script stats */
    html += '<div class="bud-stats">' +
      statChip('pages', '~' + analysis.pages) +
      statChip('est. runtime', '~' + analysis.runtimeMin + ' min') +
      statChip('scenes', analysis.scenes) +
      statChip('clips', analysis.clips || '—') +
      statChip('cast', analysis.castTotal) +
      statChip('locations', analysis.uniqueLocations) +
      statChip('night scenes', analysis.nightCount) +
      statChip('complexity', analysis.complexity + '/100') +
      '</div>';

    if (analysis.drivers.length) {
      html += '<div class="bud-drivers">' + analysis.drivers.map(function (d) {
        return '<span class="bud-chip" title="weight ' + d.weight + '/10">' + escT(d.label) + ' <b>×' + d.count + '</b></span>';
      }).join('') + '</div>';
    }

    /* AI preview section */
    html += '<div class="bud-section"><h4>AI rough-draft preview — cost &amp; time</h4>';
    html += '<div class="bud-assume">' + ai.clipCount + ' clips × ~' + ai.avgClipSec + 's @ ' + escT(ai.resolution) +
      ' · <label>retakes ×<input type="number" id="budRetake" min="1" max="4" step="0.1" value="' + ai.retakeFactor + '"></label>' +
      ' · <label>parallel <input type="number" id="budConc" min="1" max="8" step="1" value="' + ai.concurrency + '"></label>' +
      ' · ' + ai.stillsCount + ' stills (portraits/plates) ≈ ' + fmtMoney(ai.stillsUsd) + '</div>';
    html += '<div class="bud-tablewrap"><table class="bud-table"><thead><tr><th>Model</th><th>$/sec</th><th>One pass</th><th>Likely (w/ retakes)</th><th>High</th><th>Wall clock</th></tr></thead><tbody>';
    ai.rows.forEach(function (r) {
      html += '<tr' + (r.selected ? ' class="bud-cur"' : '') + '><td>' + escT(r.label) + (r.selected ? ' <em>← selected</em>' : '') + '</td>' +
        '<td>$' + r.usdPerSec.toFixed(2) + '</td>' +
        '<td>' + fmtMoney(r.onePassUsd) + '</td>' +
        '<td><b>' + fmtMoney(r.likelyUsd) + '</b></td>' +
        '<td>' + fmtMoney(r.highUsd) + '</td>' +
        '<td>' + fmtMins(r.wallMinutes) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<p class="bud-note">API list-price estimates — retakes multiplier covers regenerations; wall clock assumes ' + ai.concurrency + ' clips rendering in parallel plus ~' + AI_DEFAULTS.setupMinutes + ' min of parse/enrichment. Edit rates in <code>timeline-budget.js</code>.</p></div>';

    /* Production section */
    html += '<div class="bud-section"><h4>Real-world production — tiered estimate</h4>';
    html += '<div class="bud-tiers">' +
      tierSelect('budScale', TIERS.scale, p.scale, 'Production scale') +
      tierSelect('budDirector', TIERS.director, p.director, 'Director tier') +
      tierSelect('budLead', TIERS.lead, p.lead, 'Star / lead tier') +
      tierSelect('budSupport', TIERS.supporting, p.supporting, 'Supporting cast') +
      tierSelect('budCrew', TIERS.crew, p.crew, 'Crew / unions') +
      tierSelect('budLoc', TIERS.locations, p.locations, 'Locations') +
      tierSelect('budEquip', TIERS.equipment, p.equipment, 'Camera & equipment') +
      tierSelect('budVfx', TIERS.vfx, p.vfx, 'VFX intensity', true) +
      '</div>';

    html += '<div class="bud-sched">Schedule: <b>' + prod.schedule.shootDays + ' shoot days</b> · ' +
      prod.schedule.prepWeeks + ' wks prep · ' + prod.schedule.postWeeks + ' wks post · ~' + prod.schedule.totalWeeks + ' weeks total' +
      (prod.tiers.vfxAuto ? ' · VFX auto-set to <b>' + escT(prod.tiers.vfx.label) + '</b> from script' : '') + '</div>';

    Object.keys(prod.groups).forEach(function (gname) {
      var g = prod.groups[gname];
      html += '<div class="bud-tablewrap"><table class="bud-table bud-dept"><thead><tr><th>' + escT(gname) + '</th><th class="bud-r">' + fmtRange(prod.groupTotals[gname]) + '</th></tr></thead><tbody>';
      Object.keys(g).forEach(function (k) {
        if (g[k][1] <= 0) return;
        html += '<tr><td>' + escT(k) + '</td><td class="bud-r">' + fmtRange(g[k]) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });

    html += '<div class="bud-total">Estimated total: <span>' + fmtMoney(prod.total.low) + '</span> low · <b>' + fmtMoney(prod.total.likely) + '</b> likely · <span>' + fmtMoney(prod.total.high) + '</span> high</div>';

    var sel = ai.selectedRow;
    if (sel) {
      var ratio = sel.likelyUsd > 0 ? Math.round(prod.total.likely / sel.likelyUsd) : 0;
      html += '<div class="bud-compare">Your AI previz: <b>' + fmtMoney(sel.likelyUsd) + '</b> in <b>' + fmtMins(sel.wallMinutes) + '</b> — vs shooting it for real: <b>' + fmtMoney(prod.total.likely) + '</b> over <b>~' + prod.schedule.totalWeeks + ' weeks</b>' + (ratio > 1 ? ' (≈' + ratio.toLocaleString() + '× the cost)' : '') + '.</div>';
    }
    html += '</div>';

    /* AI line producer */
    html += '<div class="bud-section"><h4>AI line producer</h4>' +
      '<div class="bud-ai-row"><button type="button" class="tb-btn gold" id="budAiBtn"' + (_aiBusy ? ' disabled' : '') + '>' + (_aiBusy ? 'Analyzing…' : '🎬 Get line-producer notes') + '</button>' +
      '<span class="bud-note">Sends a compact digest (not your full script) to the crew agent for sanity checks, savings ideas and overage risks.</span></div>' +
      (_aiNotes ? '<div class="bud-ai-out">' + escT(_aiNotes) + '</div>' : '') +
      '</div>';

    body.innerHTML = html;
    bindBodyEvents(st);
  }

  function bindBodyEvents(st) {
    var p = prefs();
    var map = { budScale: 'scale', budDirector: 'director', budLead: 'lead', budSupport: 'supporting', budCrew: 'crew', budLoc: 'locations', budEquip: 'equipment', budVfx: 'vfx' };
    Object.keys(map).forEach(function (id) {
      var el = $id(id);
      if (!el) return;
      el.onchange = function () { p[map[id]] = el.value; savePrefs(); renderBody(currentState()); };
    });
    ['budRetake', 'budConc'].forEach(function (id) {
      var el = $id(id);
      if (!el) return;
      el.onchange = function () {
        if (id === 'budRetake') p.retakeFactor = clamp(num(el.value, AI_DEFAULTS.retakeFactor), 1, 4);
        else p.concurrency = clamp(Math.round(num(el.value, AI_DEFAULTS.concurrency)), 1, 8);
        savePrefs(); renderBody(currentState());
      };
    });
    var aiBtn = $id('budAiBtn');
    if (aiBtn) aiBtn.onclick = function () { runLineProducer(st); };
  }

  function currentState() {
    return (_env && typeof _env.getState === 'function') ? _env.getState() : {};
  }

  function runLineProducer(st) {
    if (_aiBusy) return;
    var toast = (_env && _env.toast) || function () {};
    if (!root.SB_Agents || typeof root.SB_Agents.invoke !== 'function') {
      toast('Agent client not loaded on this page');
      return;
    }
    var analysis = analyze(st);
    var p = prefs();
    var digest = buildDigest(st, analysis, estimateProduction(analysis, p), estimateAI(st, analysis, p));
    _aiBusy = true;
    renderBody(st);
    root.SB_Agents.invoke('line-producer', { script: digest, task: 'budget_review' })
      .then(function (r) {
        _aiNotes = String((r && (r.output || r.result)) || 'No notes returned.');
      })
      .catch(function (e) {
        _aiNotes = '';
        toast(e && e.message ? e.message : 'Line producer call failed');
      })
      .then(function () {
        _aiBusy = false;
        renderBody(currentState());
      });
  }

  function signature(st) {
    var g = (st && st.global) || {};
    return [
      (st && st.scriptText ? st.scriptText.length : 0),
      (st && st.clips ? st.clips.length : 0),
      Object.keys((st && st.characters) || {}).length,
      ((st && st.locationBible) || []).length,
      g.model, g.quality, g.clipDuration
    ].join('|');
  }

  /* Called from timeline.js renderAll() — cheap unless something changed. */
  function refresh(st, force) {
    if (!$id('budBody')) return;
    var sig = signature(st);
    if (!force && sig === _sig) return;
    _sig = sig;
    renderBody(st);
  }

  /* Called once from timeline.js bindUI(). */
  function wire(env) {
    _env = env || {};
    var panel = $id('budgetPanel');
    if (panel) {
      panel.addEventListener('toggle', function () {
        if (panel.open) refresh(currentState(), true);
      });
    }
    refresh(currentState(), true);
  }

  var API = {
    wire: wire,
    refresh: refresh,
    analyze: analyze,
    estimateAI: estimateAI,
    estimateProduction: estimateProduction,
    buildDigest: buildDigest,
    suggestVfxTier: suggestVfxTier,
    detectDrivers: detectDrivers,
    fmtMoney: fmtMoney,
    fmtRange: fmtRange,
    fmtMins: fmtMins,
    TIERS: TIERS,
    AI_MODEL_RATES: AI_MODEL_RATES,
    AI_DEFAULTS: AI_DEFAULTS
  };

  root.SBBudget = API;
})(typeof window !== 'undefined' ? window : globalThis);
