/* CINAMATE Production — office engine (pure, no DOM).
 *
 * Daily production report assembly from data the platform already
 * captures, music cue sheets derived from the Editor's audio track,
 * audition sides cut from the screenplay, a guild residuals estimator
 * using published industry-convention rates, and the standard
 * distributor delivery checklist. All original code, written for
 * Cinamate; rates and list contents follow widely published
 * conventions and are estimates, not legal or accounting advice.
 */
(function (root) {
  'use strict';
  /* The one scene model — js/lib-scenes.js. Every module used to carry its
     own screenplay splitter; they disagreed on preambles, printed scene
     numbers and A/B scenes, so they now all read from here. Loaded by a
     <script> tag before this file, and by the node suites. */
  var CS = root.CScenes;
  if (!CS) throw new Error('lib-prod.js requires js/lib-scenes.js to be loaded first');
  /* The one shoot-day record — js/lib-shootdays.js. It is the join key between
     the stripboard's day index, the calendar date the plan computes, and the
     two take stores. The DPR used to invent all three for itself. */
  var CSD = root.CShootDays;
  if (!CSD) throw new Error('lib-prod.js requires js/lib-shootdays.js to be loaded first');


  /* ── Daily Production Report ──────────────────────────────────────
   * stores: {takes: SB_TakeLog_v1 rows, dailies: SB_Dailies_v1,
   *          timecards: SB_Timecards_v1 rows, hotcost: SB_HotCost_v1 rows,
   *          board: SB_ScheduleBoard_v1, plan: SB_ShootPlan_v1,
   *          shootDays: SB_ShootDays_v1 rows, timeline: SB_Timeline_v1}
   *
   * What this report used to do, and why none of it was true:
   *   · it filtered takes on `t.date`, a field NO writer of either take store
   *     emits, behind `!t.date || t.date === date` — so every take ever logged
   *     was reported on every date of the shoot;
   *   · it counted prints with /print|good|circle/ against `t.status||t.print`,
   *     two more fields no writer emits, so printedCount was permanently 0;
   *   · it read only SB_TakeLog_v1, so a full day logged in /dailies/ — the
   *     store the on-set app actually writes — never reached the report;
   *   · "scheduled" counted every strip on the board with a day >= 0, i.e. the
   *     whole schedule, reported as though it were today's work.
   * All four are the same root cause: no shoot-day record to join on. Takes
   * now come through CShootDays.takesOn (both stores, normalised, dated), and
   * scheduled scenes are the strips on THIS day's index. */
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function rowsOf(v) { return Array.isArray(v) ? v : (v && Array.isArray(v.rows)) ? v.rows : []; }

  function dpr(stores, opts) {
    stores = stores || {}; opts = opts || {};
    var cards = rowsOf(stores.timecards);
    var hot = rowsOf(stores.hotcost);
    var date = opts.date || '';

    /* Which shoot day is this? By date if the record knows it, else by the
       index the caller names, else derived from the plan. -1 means the date
       is not a shoot day at all, which the report says out loud rather than
       quietly counting the whole schedule. */
    var days = stores.shootDays;
    var dayIdx = (opts.dayIdx == null || opts.dayIdx < 0) ? CSD.indexForDate(days, date) : opts.dayIdx;
    if (dayIdx < 0 && date && stores.plan) {
      var derived = CSD.build(stores.plan, stores.board, { existing: days });
      dayIdx = CSD.indexForDate(derived, date);
    }
    var unitRec = CSD.byIndex(days, dayIdx);

    var takeStores = { takeLog: stores.takes, dailies: stores.dailies };
    var dayTakes = date ? CSD.takesOn(takeStores, date) : CSD.allTakes(takeStores);
    var scenes = {};
    dayTakes.forEach(function (t) { if (t.scene) scenes[t.scene] = 1; });
    var printed = CSD.circledTakes(dayTakes);
    var cardDay = date ? cards.filter(function (c) { return !c.date || c.date === date; }) : cards;
    var hotTotal = hot.reduce(function (a, h) { return a + num(h.amount || h.actual || h.total); }, 0);

    /* Scheduled vs shot, for THIS day. */
    var strips = dayIdx >= 0 ? CSD.scheduledOn(stores.board, dayIdx) : [];
    var scheduledNums = strips.map(function (s) { return String(s.num == null ? s.id : s.num); });
    var covered = Object.keys(scenes);
    var shotOfScheduled = scheduledNums.filter(function (n) { return scenes[n]; });
    return {
      date: date,
      dayIdx: dayIdx,
      dayLabel: dayIdx >= 0 ? 'Day ' + (dayIdx + 1) : '',
      unit: unitRec ? unitRec.unit : '',
      project: (stores.timeline && stores.timeline.projectName) || 'Untitled Film',
      scenesCovered: covered.sort(),
      scheduledSceneNums: scheduledNums,
      scheduledScenes: scheduledNums.length,
      scenesShot: shotOfScheduled.length,
      scenesUnshot: scheduledNums.filter(function (n) { return !scenes[n]; }),
      pagesScheduled: strips.reduce(function (a, s) { return a + num(s.eighths); }, 0),
      takeCount: dayTakes.length,
      printedCount: printed.length,
      undatedTakes: CSD.undatedTakes(takeStores).length,
      crewOnCards: cardDay.length,
      hotCostTotal: Math.round(hotTotal),
      dayOneDate: CSD.firstShootDate(stores.plan) || (stores.plan && stores.plan.date) || '',
      notes: opts.notes || ''
    };
  }

  function dprText(d) {
    var head = 'Date: ' + (d.date || '—') +
      (d.dayLabel ? '   ·   ' + d.dayLabel : '   ·   not a scheduled shoot day') +
      (d.unit ? '   ·   ' + d.unit + ' unit' : '');
    var out = [
      'DAILY PRODUCTION REPORT — ' + d.project,
      head,
      '',
      'Scheduled: ' + d.scheduledScenes + ' scene' + (d.scheduledScenes === 1 ? '' : 's') +
        (d.scheduledSceneNums.length ? ' (' + d.scheduledSceneNums.join(', ') + ')' : '') +
        '  ·  shot ' + d.scenesShot + '/' + d.scheduledScenes +
        (d.scenesUnshot.length ? '  ·  NOT SHOT: ' + d.scenesUnshot.join(', ') : ''),
      'Scenes covered: ' + (d.scenesCovered.length ? d.scenesCovered.join(', ') : 'none logged'),
      'Takes: ' + d.takeCount + ' (' + d.printedCount + ' circled/printed)'
    ];
    if (d.undatedTakes) {
      out.push(d.undatedTakes + ' take' + (d.undatedTakes === 1 ? '' : 's') +
        ' carry no shoot day and are on no report — date them in the take log.');
    }
    out.push('Crew timecards: ' + d.crewOnCards);
    out.push('Hot-cost postings to date: $' + d.hotCostTotal.toLocaleString('en-US'));
    if (d.notes) out.push('\nNotes: ' + d.notes);
    return out.join('\n').trim();
  }

  /* ── Music cue sheet — MOVED to /music/ ───────────────────────────
     cueSheet(), cueCsv() and tcOf() lived here and are gone. They emitted a
     nine-column sheet with one composer and one publisher per cue and no
     ISWC/ISRC, which no performing-rights society accepts, and the office
     pane's CSV writer overwrote the duration this file had just computed with
     an empty string. music/lib-music.js now owns the whole concept from the
     same source — the Editor's audio track:

       CMusic.cuesFromCut(SB_Cut_v1)          real tcIn/tcOut AND durSec
       CMusic.cueSheetRows/cueSheetCsv(cues)  PRO format, ISWC/ISRC, one line
                                              per writer/publisher share
       CMusic.cueSheetIssues(cues)            what a society would reject
       CMusic.importCueRows(rows)             the old SB_CueSheet_v1 rows

     SB_CueSheet_v1 is NOT deleted: it holds composer/publisher/society text
     owners typed, and /music/'s "↧ Import the office cue register" button
     brings it across. */

  /* ── Audition sides from the screenplay ───────────────────────────
     This split on /\n(?=(?:INT|EXT|...)[.\s])/ — no allowance for a scene
     number and none for a leading indent. A numbered shooting script
     ("1   INT. KITCHEN - DAY") therefore never split at all: the whole
     screenplay came back as one block, and if the actor's name appeared
     anywhere in it, the entire script was emailed out as that actor's
     "sides". Scene breaks now come from the one scene model, which reads
     the printed number as well, so a side is labelled with the number the
     production will actually call on the day. */
  function sidesFor(scriptText, charName) {
    var out = [];
    if (!scriptText || !charName) return out;
    var name = String(charName).toUpperCase();
    CS.parse(scriptText).scenes.forEach(function (sc) {
      var text = (sc.slug + '\n' + sc.text).replace(/^\n+|\n+$/g, '');
      /* appearsIn, NOT speaksIn — and the distinction is deliberate.

         These are ON-SET sides: an actor who wrestles Hank across a kitchen
         with no dialogue is still called that day and still needs the pages.
         casting/lib-castdesk.js cuts AUDITION sides and correctly asks the
         other question, whether the performer has a cue.

         What was actually wrong here was the MATCH, not the semantics. The
         test was `text.toUpperCase().indexOf(name) < 0` — a plain substring —
         so a character named AL was present in every scene containing CALL,
         HALL, ALICE or GENERAL. Sides go to a performer's representative, so
         that meant pages of an unreleased screenplay reaching people with no
         reason to receive them. appearsIn keeps the reading and matches whole
         words. */
      if (!CS.appearsIn(sc.body || text, name)) return;
      out.push({ scene: sc.label, number: sc.number, slug: sc.slug.slice(0, 70), text: text });
    });
    return out;
  }

  /* ── Residuals estimator ────────────────────────────────────────── */
  /* Industry-convention percentages of distributor's gross in
   * post-initial markets (published guild convention figures; actual
   * obligations depend on the specific agreements in force). */
  var RESIDUAL_RATES = {
    'SAG-AFTRA (cast)': 0.036,
    'DGA (director)': 0.012,
    'WGA (writer)': 0.012,
    'IATSE (MPIPHF)': 0.054
  };
  function residuals(marketGross, rates) {
    rates = rates || RESIDUAL_RATES;
    var g = {
      svod: num(marketGross && marketGross.svod),
      tv: num(marketGross && marketGross.tv),
      homeVideo: num(marketGross && marketGross.homeVideo),
      avod: num(marketGross && marketGross.avod)
    };
    var base = g.svod + g.tv + g.avod + g.homeVideo * 0.2; // home-video convention: 20% royalty base
    var lines = Object.keys(rates).map(function (k) {
      return { guild: k, rate: rates[k], amount: Math.round(base * rates[k]) };
    });
    var total = lines.reduce(function (a, l) { return a + l.amount; }, 0);
    return { base: Math.round(base), lines: lines, total: total, pctOfGross: base ? Math.round(total / base * 1000) / 10 : 0 };
  }

  /* ── Delivery checklist template ────────────────────────────────── */
  var DELIVERY_TEMPLATE = [
    ['Picture', 'ProRes 422 HQ (or DNx) master, native resolution'],
    ['Picture', 'H.264/H.265 screener with burned-in TC'],
    ['Picture', 'Textless master (if titles are burned in)'],
    ['Audio', '5.1 printmaster (or stereo where contracted)'],
    ['Audio', 'Stereo fold-down'],
    ['Audio', 'M&E (music & effects) mix'],
    ['Subtitling', 'Closed captions (SCC or IMSC)'],
    ['Subtitling', 'SRT/VTT subtitle files'],
    ['Subtitling', 'Dialogue continuity script'],
    ['Music', 'Music cue sheet'],
    ['Music', 'Music licenses (sync + master) for every cue'],
    ['Legal', 'Chain of title package'],
    ['Legal', 'E&O insurance certificate'],
    ['Legal', 'Talent agreements & releases'],
    ['Art', 'Key art (poster) — layered + flattened'],
    ['Art', 'Stills set (min. 20, captioned)'],
    ['Docs', 'Final main & end credits list'],
    ['Docs', 'QC report'],
    ['Docs', 'Copyright registration']
  ];
  function deliveryTemplate(mkId) {
    mkId = mkId || function (i) { return 'dl' + i; };
    return DELIVERY_TEMPLATE.map(function (row, i) {
      return { id: mkId(i), group: row[0], item: row[1], status: 'todo', notes: '' };
    });
  }

  root.CProd = {
    dpr: dpr, dprText: dprText,
    sidesFor: sidesFor,
    RESIDUAL_RATES: RESIDUAL_RATES, residuals: residuals,
    deliveryTemplate: deliveryTemplate
  };
})(typeof window !== 'undefined' ? window : globalThis);
