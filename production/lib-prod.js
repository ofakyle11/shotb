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

  /* ── Daily Production Report ────────────────────────────────────── */
  /* stores: {takes: SB_TakeLog_v1 rows, timecards: SB_Timecards_v1 rows,
   *          board: SB_ScheduleBoard_v1, plan: SB_ShootPlan_v1,
   *          hotcost: SB_HotCost_v1 rows, timeline: SB_Timeline_v1} */
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function rowsOf(v) { return Array.isArray(v) ? v : (v && Array.isArray(v.rows)) ? v.rows : []; }

  function dpr(stores, opts) {
    stores = stores || {}; opts = opts || {};
    var takes = rowsOf(stores.takes);
    var cards = rowsOf(stores.timecards);
    var hot = rowsOf(stores.hotcost);
    var date = opts.date || '';
    var dayTakes = date ? takes.filter(function (t) { return !t.date || t.date === date; }) : takes;
    var scenes = {};
    dayTakes.forEach(function (t) { if (t.scene != null && t.scene !== '') scenes[t.scene] = 1; });
    var printed = dayTakes.filter(function (t) { return /print|good|circle/i.test(String(t.status || t.print || '')); });
    var cardDay = date ? cards.filter(function (c) { return !c.date || c.date === date; }) : cards;
    var hotTotal = hot.reduce(function (a, h) { return a + num(h.amount || h.actual || h.total); }, 0);
    var boardScenes = (stores.board && Array.isArray(stores.board.scenes)) ? stores.board.scenes : [];
    var scheduled = boardScenes.filter(function (s) { return s.day >= 0; }).length;
    return {
      date: date,
      project: (stores.timeline && stores.timeline.projectName) || 'Untitled Film',
      scenesCovered: Object.keys(scenes).sort(),
      takeCount: dayTakes.length,
      printedCount: printed.length,
      crewOnCards: cardDay.length,
      hotCostTotal: Math.round(hotTotal),
      scheduledScenes: scheduled,
      dayOneDate: (stores.plan && stores.plan.date) || '',
      notes: opts.notes || ''
    };
  }

  function dprText(d) {
    return [
      'DAILY PRODUCTION REPORT — ' + d.project,
      'Date: ' + (d.date || '—'),
      '',
      'Scenes covered: ' + (d.scenesCovered.length ? d.scenesCovered.join(', ') : 'none logged'),
      'Takes: ' + d.takeCount + ' (' + d.printedCount + ' printed)',
      'Crew timecards: ' + d.crewOnCards,
      'Hot-cost postings to date: $' + d.hotCostTotal.toLocaleString('en-US'),
      d.notes ? '\nNotes: ' + d.notes : ''
    ].join('\n').trim();
  }

  /* ── Music cue sheet from the Editor timeline ───────────────────── */
  function tcOf(sec, fps) {
    fps = fps || 24;
    var f = Math.round(sec * fps), fr = f % fps;
    var s = Math.floor(f / fps) % 60, m = Math.floor(f / fps / 60) % 60, h = Math.floor(f / fps / 3600);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(h) + ':' + p(m) + ':' + p(s) + ':' + p(fr);
  }
  function cueSheet(cutStore) {
    var p = (cutStore && cutStore.project) || cutStore || {};
    var fps = p.fps || 24;
    return ((p.audio) || []).map(function (a, i) {
      var dur = Math.max(0, (a.out - a.in) / (a.speed || 1));
      return {
        n: i + 1,
        title: a.label || 'Cue ' + (i + 1),
        tcIn: tcOf(a.start || 0, fps),
        tcOut: tcOf((a.start || 0) + dur, fps),
        durSec: Math.round(dur * 10) / 10,
        use: 'BI',            // background instrumental — edit per cue
        composer: '', publisher: '', society: ''
      };
    });
  }
  /* A cell that opens with = + - @ (or a tab or carriage return that scrolls
     one into place) is a formula to Excel and Sheets, not text -- so a line
     item typed on this site would run on the machine of whoever opens the
     export. The leading apostrophe is what those programs read as "this is
     literal", and they strip it on display. */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function cueCsv(cues) {
    var rows = [['#', 'Cue title', 'TC in', 'TC out', 'Secs', 'Use', 'Composer', 'Publisher', 'Society']];
    (cues || []).forEach(function (c) {
      rows.push([c.n, c.title, c.tcIn, c.tcOut, c.durSec, c.use, c.composer, c.publisher, c.society]);
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }

  /* ── Audition sides from the screenplay ─────────────────────────── */
  function sidesFor(scriptText, charName) {
    var out = [];
    if (!scriptText || !charName) return out;
    var name = String(charName).toUpperCase();
    var blocks = String(scriptText).split(/\n(?=(?:INT|EXT|INT\/EXT|I\/E|EST)[.\s])/);
    blocks.forEach(function (b) {
      var up = b.toUpperCase();
      if (up.indexOf(name) < 0) return;
      var slug = (b.split('\n')[0] || '').trim();
      out.push({ slug: slug.slice(0, 70), text: b.trim() });
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
    cueSheet: cueSheet, cueCsv: cueCsv, tcOf: tcOf,
    sidesFor: sidesFor,
    RESIDUAL_RATES: RESIDUAL_RATES, residuals: residuals,
    deliveryTemplate: deliveryTemplate
  };
})(typeof window !== 'undefined' ? window : globalThis);
