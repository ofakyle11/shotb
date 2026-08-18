/* SBDoc — documentary-mode engine for the Producer's Estimate.
 *
 * Documentary economics are structurally different from scripted features:
 * no cast tiers or stunt units — instead interview/verite/b-roll day
 * structures, archival licensing by the minute, long edit calendars
 * (the film is written in the edit), clearances/E&O, and a funding mix
 * of grants + licenses rather than equity waterfalls.
 *
 * Account structure follows the IDA/Documentary-Magazine chart of accounts
 * (1000 R&D · 2000 dir/prod · 3000 talent · 41xx crew · 42xx editorial ·
 * 5000 equipment · 6000 travel · 7xxx post · 8xxx insurance · 9000 office ·
 * 10000 festivals) with ITVS-template deliverables. Every rate constant is
 * sourced in docs/DOCUMENTARY_MODE.md.
 *
 * Shape compatibility: estimateDoc() returns the same {groups, groupTotals,
 * total, schedule, tiers} contract as SBBudget.estimateProduction(), so the
 * top-sheet seeder, digest builder and panel renderer work unchanged.
 */
(function (root) {
  'use strict';

  /* ── Segment cues ──────────────────────────────────────────────── */
  var CUES = [
    { key: 'interview', label: 'Interviews',   re: /^\s*(?:INTERVIEW\b|INT(?:ERVIEW)?\s*[:.—-]|SIT-?DOWN\b|Q\s*:)/im, inline: /\b(?:INTERVIEW(?:S)?\s+WITH|SIT-?DOWN\s+WITH|TALKING\s+HEAD)\b/gi, weight: 6 },
    { key: 'archival',  label: 'Archival',     re: /\b(?:ARCHIVAL|ARCHIVE(?:S)?|NEWSREEL|STOCK\s+FOOTAGE|FOUND\s+FOOTAGE|HOME\s+(?:VIDEO|MOVIE)S?|FILE\s+FOOTAGE)\b/gi, weight: 8 },
    { key: 'narration', label: 'Narration',    re: /\b(?:NARRATOR|NARRATION|V\.?O\.?\b|VOICE-?OVER)\b/g, weight: 4 },
    { key: 'verite',    label: 'Vérité',       re: /\b(?:VERITE|VÉRITÉ|OBSERVATIONAL|FLY.ON.THE.WALL|WE\s+FOLLOW)\b/gi, weight: 6 },
    { key: 'broll',     label: 'B-roll',       re: /\b(?:B-?ROLL|ESTABLISHING|DRONE\s+SHOT|AERIAL(?:S)?|MONTAGE)\b/gi, weight: 3 },
    { key: 'reenact',   label: 'Re-enactment', re: /\b(?:RE-?ENACT(?:MENT|ED)?|DRAMATIZATION|RECREATION\s+SCENE)\b/gi, weight: 7 },
    { key: 'gfx',       label: 'Graphics/Anim',re: /\b(?:ANIMATION|ANIMATED|MOTION\s+GRAPHICS?|GFX|TITLE\s+CARD|CHYRON|INFOGRAPHIC|MAP\s+GRAPHIC)\b/gi, weight: 5 },
    { key: 'travel',    label: 'Travel',       re: /\b(?:TRAVEL\s+TO|ON\s+LOCATION\s+IN|FLY\s+TO|SHOT\s+IN|FILMED\s+(?:IN|ACROSS))\b/gi, weight: 5 },
    { key: 'music',     label: 'Music cues',   re: /\b(?:NEEDLE\s*DROP|MUSIC\s+CUE|SONG\s*:|SOUNDTRACK)\b/gi, weight: 4 }
  ];

  /* Transcript-style speaker lines: "JANE DOE:", "Dr. Smith:", timecoded rows */
  var SPEAKER_RE = /^\s*(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s+)?([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,3})\s*:\s+\S/;
  var NOT_SPEAKERS = /^(?:INT|EXT|CUT|FADE|DISSOLVE|TITLE|NOTE|SCENE|ACT|VO|V\.O|NARRATOR|INTERVIEW|ARCHIVAL|MUSIC|SFX|GFX|CARD|SUPER|Q|A)$/i;

  function analyzeDoc(text) {
    text = String(text || '');
    var lines = text.split(/\r?\n/);
    var counts = {};
    CUES.forEach(function (c) {
      var n = 0;
      if (c.re) { var m = text.match(c.re); n += m ? m.length : 0; }
      if (c.inline) { var m2 = text.match(c.inline); n += m2 ? m2.length : 0; }
      counts[c.key] = n;
    });

    /* Subjects: interview cues with names + transcript speaker lines */
    var freq = {};
    lines.forEach(function (ln) {
      var m = ln.match(SPEAKER_RE);
      if (m) {
        var name = m[1].trim();
        if (!NOT_SPEAKERS.test(name.split(/\s+/)[0]) && name.length > 2) {
          freq[name] = (freq[name] || 0) + 1;
        }
      }
      var iv = ln.match(/\bINTERVIEW(?:S)?(?:\s+WITH)?\s*[:—-]?\s+([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,3})/);
      if (iv && !NOT_SPEAKERS.test(iv[1].split(/\s+/)[0])) freq[iv[1].trim()] = (freq[iv[1].trim()] || 0) + 2;
    });
    var subjects = Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; });

    /* Locations: sluglines + "ON LOCATION IN X" */
    var locs = {};
    (text.match(/^.*\b(?:INT\.|EXT\.|INT\/EXT\.)\s*([^—\n-]{2,48})/gim) || []).forEach(function (h) {
      var l = h.replace(/^.*\b(?:INT\.|EXT\.|INT\/EXT\.)\s*/i, '').replace(/\s*[—-]\s*(?:DAY|NIGHT|DUSK|DAWN|LATER|CONTINUOUS).*$/i, '').trim().toUpperCase();
      if (l) locs[l] = 1;
    });
    (text.match(/\b(?:ON\s+LOCATION\s+IN|TRAVEL\s+TO|FILMED\s+IN)\s+([A-Z][A-Za-z\s,]{2,32})/g) || []).forEach(function (m) {
      locs[m.replace(/^.*?\b(?:IN|TO)\s+/, '').trim().toUpperCase()] = 1;
    });

    var words = (text.match(/\S+/g) || []).length;
    var pages = Math.max(1, Math.round(words / 250));          // prose pages
    // Treatments run ~1 finished minute per prose page; transcripts far denser.
    var speakerLines = lines.filter(function (l) { return SPEAKER_RE.test(l); }).length;
    var isTranscript = speakerLines > lines.length * 0.25;
    var runtimeMin = isTranscript ? Math.max(40, Math.round(words / 900)) : Math.max(40, Math.min(120, pages));

    var docScore = 0;
    CUES.forEach(function (c) { docScore += Math.min(counts[c.key], 12) * c.weight; });
    if (isTranscript) docScore += 40;

    var drivers = CUES.map(function (c) {
      return { key: c.key, label: c.label, count: counts[c.key], weight: c.weight };
    }).filter(function (d) { return d.count > 0; })
      .sort(function (a, b) { return b.count * b.weight - a.count * a.weight; });

    return {
      isDocLike: docScore >= 60,
      docScore: docScore,
      subjects: subjects,
      subjectCount: subjects.length,
      uniqueLocations: Object.keys(locs).length,
      locations: Object.keys(locs),
      counts: counts,
      drivers: drivers,
      pages: pages,
      words: words,
      isTranscript: isTranscript,
      runtimeMin: runtimeMin,
      hasText: words > 0
    };
  }

  /* ── Rate tables (every figure sourced in docs/DOCUMENTARY_MODE.md) ── */

  var DOC_TIERS = {
    /* Production scale — bands match the published tier surveys
     * (docfundingvault / GlobalFilmz 2026 / IDA funded clusters at
     * $350–450k and $600–800k; Sundance prioritizes < $1.2M).
     * crewDay = all-in crew day (academyvoices: lean 1–3p $500–1.5k,
     * 5+ crew $3–10k; GlobalFilmz full pro day $8–20k).
     * editWksPerHr from the ADE guide: 1 month per 10 finished minutes
     * ≈ 26 wks per finished hour at standard; compressed 8–12 wks per
     * TV-hour is the failure mode, not the plan.
     * eo bands from THAgency: festival-only $2–3.5k → large $15–30k. */
    scale: [
      { id: 'diy',      label: 'DIY / micro (< $100k)',        crewSize: 2, crewDay: [500, 1500],   editWksPerHr: [10, 16], finish: [3e3, 12e3],   dirProd: [0, 25e3],      research: [1e3, 8e3],    eo: [1000, 3500] },
      { id: 'low',      label: 'Low budget ($100k–$400k)',     crewSize: 3, crewDay: [1200, 3000],  editWksPerHr: [14, 22], finish: [12e3, 40e3],  dirProd: [20e3, 80e3],   research: [5e3, 25e3],   eo: [2000, 6000] },
      { id: 'indie',    label: 'Indie feature ($400k–$1.2M)',  crewSize: 5, crewDay: [3000, 8000],  editWksPerHr: [20, 30], finish: [40e3, 110e3], dirProd: [70e3, 240e3],  research: [15e3, 60e3],  eo: [5000, 12000] },
      { id: 'premium',  label: 'Premium / streamer ($1.2M+)',  crewSize: 8, crewDay: [8000, 16000], editWksPerHr: [26, 40], finish: [90e3, 250e3], dirProd: [240e3, 600e3], research: [40e3, 150e3], eo: [15000, 30000] }
    ],
    /* Archival appetite: finished minutes × all-media in-perpetuity $/min.
     * Anchors: Producers Library doc all-media $59/sec ≈ $3.5k/min;
     * BFI doc rate £4,320 first min + £72/sec ≈ $5.5k/min; TV-news
     * footage $80–150/sec ≈ $4.8–9k/min; 30-second minimums standard. */
    archival: [
      { id: 'none',     label: 'No archival',                    minutes: [0, 0],    ratePerMin: [0, 0] },
      { id: 'light',    label: 'Light (news clips, photos)',     minutes: [2, 6],    ratePerMin: [3000, 6000] },
      { id: 'moderate', label: 'Moderate (period sequences)',    minutes: [6, 18],   ratePerMin: [3500, 7500] },
      { id: 'heavy',    label: 'Archival-driven film',           minutes: [18, 45],  ratePerMin: [4500, 9000] }
    ],
    /* Music posture. Composer doc scores run to ~$30k ($200–250/finished
     * minute); indie-feature sync $1–15k/track, recognizable catalog 5–10×. */
    music: [
      { id: 'score',    label: 'Composer score only',            cost: [5e3, 30e3] },
      { id: 'mixed',    label: 'Score + a few licensed tracks',  cost: [15e3, 90e3] },
      { id: 'needle',   label: 'Needle-drop heavy',              cost: [60e3, 300e3] }
    ],
    /* Docs are mostly non-union (ADE); union basis matters for
     * network/streamer deliverables. */
    crewBasis: [
      { id: 'nonunion', label: 'Non-union doc crew',                 fringe: 0.25, mult: 1.0 },
      { id: 'hybrid',   label: 'Mixed / some union',                 fringe: 0.30, mult: 1.15 },
      { id: 'union',    label: 'Union (network/stream deliverable)', fringe: 0.38, mult: 1.35 }
    ]
  };

  /* Funding-offset panel — verified programs and amounts. */
  var DOC_GRANTS = [
    { id: 'itvs',      label: 'ITVS Open Call (co-production)',   range: [150e3, 400e3], note: 'up to $400k features; PBS window license' },
    { id: 'justfilms', label: 'Ford Foundation JustFilms',        range: [15e3, 300e3],  note: 'median award ~$125k' },
    { id: 'sundance',  label: 'Sundance Documentary Fund',        range: [50e3, 100e3],  note: 'production/post grants; ~2,000 apply, 25–30 funded' },
    { id: 'chickegg',  label: 'Chicken & Egg Pictures',           range: [10e3, 75e3],   note: '$10k research / $20k dev; $75k award' },
    { id: 'catapult',  label: 'Catapult Film Fund (development)', range: [25e3, 25e3] },
    { id: 'cmf',       label: 'CMF POV Program (Canada)',         range: [100e3, 400e3], note: '≤49% of eligible costs, cap $400k CAD' }
  ];

  /* Documentary eligibility deltas for the shared incentive table —
   * only programs with verified doc rules are adjusted:
   * NY excludes documentaries from "qualified film" outright; Georgia
   * gives docs the 20% base but not the +10% GEP logo uplift; UK AVEC,
   * Ontario OFTTC and BC labour credits expressly include docs. */
  var DOC_INCENTIVE_ADJUST = {
    newyork: { excluded: true, note: 'NY film credit excludes documentaries' },
    georgia: { rate: [0.20, 0.20], note: 'docs: 20% base only — no GEP logo uplift' },
    ukavec:  { note: 'documentaries expressly qualify' },
    ontario: { note: 'OFTTC defines documentary as eligible' },
    bc:      { note: 'docs eligible under BC labour credits' }
  };

  function R(range, mult) { return [Math.round(range[0] * (mult || 1)), Math.round(range[1] * (mult || 1))]; }
  function addR(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function tier(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[1] || list[0];
  }

  /* ── The documentary estimate ──────────────────────────────────── */
  function estimateDoc(analysis, sel) {
    sel = sel || {};
    var scale = tier(DOC_TIERS.scale, sel.docScale || 'low');
    var arch = tier(DOC_TIERS.archival, sel.docArchival || (analysis.counts && analysis.counts.archival > 6 ? 'moderate' : analysis.counts && analysis.counts.archival > 0 ? 'light' : 'none'));
    var music = tier(DOC_TIERS.music, sel.docMusic || 'mixed');
    var basis = tier(DOC_TIERS.crewBasis, sel.docCrewBasis || 'nonunion');

    /* Shoot structure: suggested from the text, overridable in the panel. */
    var subjects = Math.max(1, analysis.subjectCount || 1);
    var interviewDays = sel.interviewDays != null ? sel.interviewDays : Math.ceil(subjects * 0.75);
    var veriteDays = sel.veriteDays != null ? sel.veriteDays
      : Math.max(2, Math.round((analysis.counts && (analysis.counts.verite * 2 + analysis.counts.broll)) || 4));
    var travelRegions = sel.travelRegions != null ? sel.travelRegions
      : Math.min(6, Math.max(0, Math.round((analysis.counts && analysis.counts.travel || 0) / 2)));
    var shootDays = interviewDays + veriteDays + travelRegions; // 1 travel day per region

    var runtimeHr = (sel.runtimeMin || analysis.runtimeMin || 85) / 60;
    var editWeeks = Math.round((scale.editWksPerHr[0] + scale.editWksPerHr[1]) / 2 * runtimeHr);

    /* Shooting ratio (toolsforfilm): interview-driven 10–20:1,
     * observational 30–80:1 — blended by the segment mix. */
    var ivShare = interviewDays / Math.max(1, shootDays);
    var ratio = Math.round(15 * ivShare + 50 * (1 - ivShare));
    var footageHours = Math.round(runtimeHr * 60 * ratio / 60);

    var crewDay = R(scale.crewDay, basis.mult);
    var crewLabor = R(crewDay, shootDays);
    var fringes = R(crewLabor, basis.fringe);

    /* Travel: flights+hotels+per-diem per region for the crew (academyvoices:
     * domestic blocks $3–15k; international runs toward $50k). */
    var travel = R([2500 * scale.crewSize, 6500 * scale.crewSize], Math.max(travelRegions, 0));

    /* Equipment: interview setups $0.5–2k/day; pro packages $1.5–5k/day. */
    var equip = R([shootDays * 400, shootDays * 1500], scale.crewSize >= 5 ? 1.6 : 1);

    var archival = [Math.round(arch.minutes[0] * arch.ratePerMin[0]), Math.round(arch.minutes[1] * arch.ratePerMin[1])];

    /* Editorial: doc editors $1.8–3.2k/wk market, $3.2–4.5k/wk at the
     * union/streamer end (New Doc Editing $3.2k, MPEG on-call $3,897);
     * assistant editor from a few months before the editor on 5+ crews. */
    var editorWk = scale.crewSize >= 5 ? [3200, 4500] : [1800, 3200];
    var editorial = R(editorWk, editWeeks);
    if (scale.crewSize >= 5) editorial = addR(editorial, R([1200, 2000], Math.round(editWeeks * 0.6)));

    var gfx = (analysis.counts && analysis.counts.gfx > 0)
      ? R([5e3, 30e3], Math.min(analysis.counts.gfx, 4)) : [0, 0];
    var reenact = (analysis.counts && analysis.counts.reenact > 0)
      ? R([6e3, 30e3], Math.min(analysis.counts.reenact, 5)) : [0, 0];

    /* Insurance & clearances: E&O by scale (THAgency bands); fair-use /
     * clearance counsel heavier on archival-driven films. */
    var eo = arch.id === 'heavy' ? R(scale.eo, 1.3) : scale.eo;
    var legal = addR([5e3, 25e3], arch.id === 'heavy' ? [10e3, 30e3] : [0, 0]);
    var insurance = R([shootDays * 120, shootDays * 300], 1);
    /* ITVS-style deliverables: CC $1k, transcripts, copyright, title
     * search, trailer — the template's required subtotal is $6,135. */
    var deliverables = [4e3, 9e3];

    var atl = {};
    atl['1000 · Research & development'] = scale.research;
    atl['2000 · Director & producer fees (5–10% each)'] = scale.dirProd;
    atl['3000 · Subjects, narrator & talent'] = [0, Math.round(subjects * 500) + 2000];
    var prodGrp = {};
    prodGrp['4100 · Crew (' + scale.crewSize + '-person × ' + shootDays + ' days)'] = crewLabor;
    prodGrp['4199 · Fringes & payroll (' + Math.round(basis.fringe * 100) + '%)'] = fringes;
    prodGrp['5000 · Camera, sound & lighting'] = equip;
    prodGrp['5500 · Re-enactment units'] = reenact;
    prodGrp['6000 · Travel & locations (' + travelRegions + ' region' + (travelRegions === 1 ? '' : 's') + ')'] = travel;
    var rights = {};
    rights['1500 · Footage rights (' + arch.minutes[0] + '–' + arch.minutes[1] + ' min, all media)'] = archival;
    rights['1600 · Music (' + music.label.toLowerCase() + ')'] = music.cost;
    var post = {};
    post['4200 · Editorial (' + editWeeks + ' weeks)'] = editorial;
    post['7300 · Graphics & animation'] = gfx;
    post['7500 · Color, online & mix'] = scale.finish;
    var office = {};
    office['8100 · E&O insurance'] = eo;
    office['8200 · Production insurance'] = insurance;
    office['8500 · Legal & clearances'] = legal;
    office['9000 · Office, accounting & admin'] = R([500, 1500], Math.max(6, Math.round(editWeeks / 2)));
    office['9500 · Deliverables (CC, transcripts, trailer)'] = deliverables;
    var groups = {
      'Above the line': atl,
      'Production': prodGrp,
      'Rights — archival & music': rights,
      'Post-production': post,
      'Insurance, legal & office': office
    };

    var groupTotals = {}, lo = 0, hi = 0;
    Object.keys(groups).forEach(function (g) {
      var glo = 0, ghi = 0;
      Object.keys(groups[g]).forEach(function (k) { glo += groups[g][k][0]; ghi += groups[g][k][1]; });
      groupTotals[g] = [glo, ghi];
      lo += glo; hi += ghi;
    });

    /* Festivals & impact ≈ 5–8% of hard costs (IDA sample spends 7%). */
    var fest = [Math.round(lo * 0.05), Math.round(hi * 0.08)];
    groups['Festivals & distribution prep'] = { '10000 · Publicity, festivals & impact': fest };
    groupTotals['Festivals & distribution prep'] = fest;
    lo += fest[0]; hi += fest[1];

    /* Contingency 6–10% (IDA: start at 10%, reduce reluctantly). */
    var contingency = [Math.round(lo * 0.06), Math.round(hi * 0.10)];
    groups['Contingency'] = { '9900 · Contingency (6–10%)': contingency };
    groupTotals['Contingency'] = contingency;
    lo += contingency[0]; hi += contingency[1];
    var total = [lo, hi];

    return {
      mode: 'documentary',
      groups: groups,
      groupTotals: groupTotals,
      total: total,
      schedule: {
        shootDays: shootDays,
        interviewDays: interviewDays,
        veriteDays: veriteDays,
        travelRegions: travelRegions,
        editWeeks: editWeeks,
        shootingRatio: ratio,
        footageHours: footageHours,
        totalWeeks: Math.round(shootDays / 4 + editWeeks + 6)
      },
      tiers: { scale: scale, archival: arch, music: music, basis: basis },
      grants: DOC_GRANTS,
      subjects: subjects,
      runtimeMin: Math.round(runtimeHr * 60)
    };
  }

  /* ── Documentary revenue paths ─────────────────────────────────────
   * Calibrated to the post-2022 market correction (sourced in
   * docs/DOCUMENTARY_MODE.md): streamer buys are now rare events —
   * Sundance 2023 saw ZERO streamer doc buys and 2026 none reported;
   * highs remain celebrity/IP-only ($10M Knock Down the House, ~$15M
   * Reeve, $25M Eilish). PBS POV pays ~$30–45k/feature ($150k ceiling),
   * Independent Lens $40k–six figures, Storyville UK-only ≈ £80–100k
   * ceiling. Educational lifetime realistically $5–50k at ~50% splits.
   * CMSI 2020: only 20% of docs reach profit; 40% earn nothing. */
  var DOC_SALES = {
    heat: [
      { id: 'quiet',    label: 'Completed, no festival heat',  streamer: [0, 50e3],      broadcast: [10e3, 40e3],   educational: [2e3, 20e3],   theatrical: [0, 0],          selfdist: [1e3, 10e3] },
      { id: 'solid',    label: 'Festival run, good reviews',   streamer: [25e3, 150e3],  broadcast: [30e3, 90e3],   educational: [5e3, 50e3],   theatrical: [0, 50e3],       selfdist: [2e3, 15e3] },
      { id: 'premiere', label: 'Major-festival premiere',      streamer: [500e3, 5e6],   broadcast: [60e3, 250e3],  educational: [15e3, 80e3],  theatrical: [25e3, 250e3],   selfdist: [5e3, 40e3] },
      { id: 'breakout', label: 'Celebrity/IP breakout (rare)', streamer: [5e6, 15e6],    broadcast: [100e3, 400e3], educational: [30e3, 150e3], theatrical: [250e3, 2e6],    selfdist: [50e3, 700e3] }
    ],
    /* Doc sales agents run 10–20% (Submarine/Cinetic norms) + expenses. */
    agentFee: 0.15, agentExpenses: 25e3,
    /* CMSI State of the Documentary Field 2020. */
    profitRate: 0.20, zeroRevenueRate: 0.40,
    /* Streamer series commissions: cost-plus ~30% (20–40% bracket). */
    seriesCostPlus: [0.20, 0.40]
  };

  function docSales(budgetRange, sel) {
    var heat = tier(DOC_SALES.heat, (sel && sel.heat) || 'solid');
    var gross = [0, 0];
    ['streamer', 'broadcast', 'educational', 'theatrical', 'selfdist'].forEach(function (k) {
      gross = addR(gross, heat[k]);
    });
    var net = [Math.round(gross[0] * (1 - DOC_SALES.agentFee)) - DOC_SALES.agentExpenses,
               Math.round(gross[1] * (1 - DOC_SALES.agentFee)) - DOC_SALES.agentExpenses];
    if (net[0] < 0) net[0] = 0;
    var mid = (budgetRange[0] + budgetRange[1]) / 2 || 1;
    return {
      heat: heat, paths: {
        'Streaming / all-rights acquisition': heat.streamer,
        'Broadcast licenses (PBS + intl stack)': heat.broadcast,
        'Educational & institutional': heat.educational,
        'Theatrical / event screenings': heat.theatrical,
        'Self-distribution (TVOD/AVOD/direct)': heat.selfdist
      },
      gross: gross, net: net,
      recoupsAtLow: net[0] >= mid, recoupsAtHigh: net[1] >= mid,
      profitRate: DOC_SALES.profitRate, zeroRevenueRate: DOC_SALES.zeroRevenueRate,
      seriesCostPlus: DOC_SALES.seriesCostPlus,
      grants: DOC_GRANTS
    };
  }

  root.SBDoc = {
    analyzeDoc: analyzeDoc,
    estimateDoc: estimateDoc,
    docSales: docSales,
    DOC_TIERS: DOC_TIERS,
    DOC_GRANTS: DOC_GRANTS,
    DOC_SALES: DOC_SALES,
    DOC_INCENTIVE_ADJUST: DOC_INCENTIVE_ADJUST
  };
})(typeof window !== 'undefined' ? window : globalThis);
