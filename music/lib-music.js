/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Music Rights & Score engine (CMusic)
   Pure logic, no DOM: scan the screenplay for music moments (sings, songs,
   jukeboxes, radios, bands, karaoke, quoted titles), keep a cue list with
   tier/use/scope/status, produce clearly-labeled PLANNING estimates for
   sync + master licensing, compare against commissioning an original score,
   draft license request letters, and export a delivery cue sheet.
   No prices here are quotes — every figure is an estimate range midcalc and
   is labeled as such; real numbers come from the rights holders.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  /* The one scene model — js/lib-scenes.js. Every module used to carry its
     own screenplay splitter; they disagreed on preambles, printed scene
     numbers and A/B scenes, so they now all read from here. Loaded by a
     <script> tag before this file, and by the node suites. */
  var CS = root.CScenes;
  if (!CS) throw new Error('lib-music.js requires js/lib-scenes.js to be loaded first');


  /* ── 1 · vocabulary ───────────────────────────────────────────────────── */
  var USES = ['background', 'featured', 'main title', 'end credits'];
  var SCOPES = ['festival', 'all-media'];
  var STATUSES = ['identified', 'quote requested', 'quoted', 'licensed', 'replaced'];
  var FESTIVAL_FACTOR = 0.15;

  /* Planning ranges in USD, per side (sync OR master), all-media scope.
     Library music is the exception: one all-in fee covers both sides. */
  var TIERS = [
    { id: 'library', label: 'Library / production music', low: 50, high: 500, allIn: true,
      note: 'One all-in fee typically covers sync and master together.' },
    { id: 'indie', label: 'Indie / unsigned artist', low: 500, high: 5000 },
    { id: 'known', label: 'Known artist / catalog', low: 5000, high: 25000 },
    { id: 'famous', label: 'Famous artist / major hit', low: 25000, high: 250000 }
  ];
  var TIER_BY_ID = {};
  TIERS.forEach(function (t) { TIER_BY_ID[t.id] = t; });

  /* ── 2 · script scan ──────────────────────────────────────────────────── */
  var splitScenes = CS.split;

  /* Ordered — first hit decides the suggested use. Performance words
     (sings, karaoke, band plays) suggest featured; source/ambient words
     (jukebox, radio, hums, a quoted title that "plays") suggest background. */
  var CUE_TERMS = [
    { term: 'sings', re: /\bsing(?:s|ing)?\b/i, use: 'featured' },
    { term: 'karaoke', re: /\bkaraoke\b/i, use: 'featured' },
    { term: 'band plays', re: /\bband\b[^.\n]{0,40}\bplay(?:s|ing)?\b/i, use: 'featured' },
    { term: 'jukebox', re: /\bjukebox\b/i, use: 'background' },
    { term: 'radio plays', re: /\bradio\b[^.\n]{0,40}\bplay(?:s|ing)?\b/i, use: 'background' },
    { term: 'hums', re: /\bhum(?:s|ming)?\b/i, use: 'background' },
    { term: 'quoted title', re: /["“][^"”\n]{2,60}["”][^\n]{0,50}\bplay(?:s|ing)?\b/i, use: 'background' },
    { term: 'quoted title', re: /\bplay(?:s|ing)?\b[^\n]{0,50}["“][^"”\n]{2,60}["”]/i, use: 'background' },
    { term: 'song', re: /\bsongs?\b/i, use: 'background' }
  ];
  var QUOTED_RE = /["“]([^"”\n]{2,60})["”]/;

  /* scanScript(scriptText) → [{scene, excerpt, suggestedUse, title, term}] —
     one hit per matching line; a quoted string on the line becomes the
     suggested title. */
  function scanScript(scriptText) {
    var scenes = splitScenes(scriptText);
    var hits = [];
    scenes.forEach(function (sc) {
      sc.body.forEach(function (raw) {
        var line = String(raw).trim();
        if (!line) return;
        var use = null, term = '';
        for (var i = 0; i < CUE_TERMS.length; i++) {
          if (CUE_TERMS[i].re.test(line)) { use = CUE_TERMS[i].use; term = CUE_TERMS[i].term; break; }
        }
        if (!use) return;
        var qm = line.match(QUOTED_RE);
        hits.push({ scene: sc.n, sceneLabel: sc.label, excerpt: line.length > 160 ? line.slice(0, 157) + '…' : line,
                    suggestedUse: use, title: qm ? qm[1].trim() : '', term: term });
      });
    });
    return hits;
  }

  /* ── 3 · cues ─────────────────────────────────────────────────────────
     A cue sheet is the document a PRO pays royalties from, and a PRO cannot
     read one that carries a single `composer` and `publisher` text field: it
     needs every writer and every publisher NAMED, with their SHARES totalling
     100% on each side, their society affiliation, the use code, the timing
     and the duration. Those fields live on the cue. */
  var PROS = ['ASCAP', 'BMI', 'SESAC', 'GMR', 'SOCAN', 'PRS', 'GEMA', 'SACEM',
              'APRA AMCOS', 'JASRAC', 'Other', 'Unaffiliated'];
  /* Standard cue-sheet use codes. */
  var USE_CODES = [
    { id: 'BI', label: 'Background instrumental' },
    { id: 'BV', label: 'Background vocal' },
    { id: 'VI', label: 'Visual instrumental (on camera)' },
    { id: 'VV', label: 'Visual vocal (on camera)' },
    { id: 'MT', label: 'Main title' },
    { id: 'ET', label: 'End title' },
    { id: 'THEME', label: 'Theme' },
    { id: 'LOGO', label: 'Logo' }
  ];
  var USE_CODE_IDS = USE_CODES.map(function (u) { return u.id; });
  /* Writer roles as the societies register them. */
  var WRITER_ROLES = ['C', 'A', 'CA', 'AR', 'SR'];   // composer, author/lyricist, both, arranger, sub-arranger

  function shareNum(v) {
    var n = parseFloat(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }
  function normWriter(w) {
    var x = w || {};
    return { name: String(x.name || ''), role: WRITER_ROLES.indexOf(x.role) >= 0 ? x.role : 'C',
             pro: String(x.pro || ''), ipi: String(x.ipi || ''), share: shareNum(x.share) };
  }
  function normPublisher(p) {
    var x = p || {};
    return { name: String(x.name || ''), pro: String(x.pro || ''), ipi: String(x.ipi || ''),
             share: shareNum(x.share) };
  }
  /* The default use code follows the use, and an on-camera performance is
     visual — the owner overrides it per cue. */
  function useCodeFor(cue) {
    var c = cue || {};
    if (USE_CODE_IDS.indexOf(c.useCode) >= 0) return c.useCode;
    if (c.use === 'main title') return 'MT';
    if (c.use === 'end credits') return 'ET';
    if (c.use === 'featured') return c.artist ? 'VV' : 'VI';
    return 'BI';
  }

  function makeCue(f) {
    f = f || {};
    var writers = (f.writers || []).map(normWriter);
    var publishers = (f.publishers || []).map(normPublisher);
    /* A cue that arrived with only the old single `composer`/`publisher`
       string keeps it — as a writer and a publisher with an unstated share,
       which the pre-submission check then reports rather than swallowing. */
    if (!writers.length && f.composer) writers = [normWriter({ name: f.composer, role: 'C' })];
    if (!publishers.length && f.publisher) publishers = [normPublisher({ name: f.publisher, pro: f.society || '' })];
    return {
      id: f.id || 'c' + Math.random().toString(36).slice(2, 9),
      title: f.title || 'Untitled cue',
      artist: f.artist || '',
      scene: +f.scene || 0,
      excerpt: f.excerpt || '',
      use: USES.indexOf(f.use) >= 0 ? f.use : 'background',
      tier: TIER_BY_ID[f.tier] ? f.tier : 'indie',
      scope: SCOPES.indexOf(f.scope) >= 0 ? f.scope : 'all-media',
      status: STATUSES.indexOf(f.status) >= 0 ? f.status : 'identified',
      syncEst: +f.syncEst || 0, masterEst: +f.masterEst || 0,
      actualQuote: +f.actualQuote || 0,
      publisher: f.publisher || '', masterOwner: f.masterOwner || '',
      /* ── the PRO half ── */
      writers: writers, publishers: publishers,
      useCode: USE_CODE_IDS.indexOf(f.useCode) >= 0 ? f.useCode : '',
      tcIn: String(f.tcIn || ''), tcOut: String(f.tcOut || ''), durSec: +f.durSec || 0,
      iswc: String(f.iswc || ''), isrc: String(f.isrc || ''),
      recordLabel: String(f.recordLabel || ''),
      committedPo: !!f.committedPo,
      manual: !!f.manual
    };
  }
  function cueFromHit(hit) {
    return makeCue({
      title: hit.title || 'Scene ' + hit.scene + ' music (' + hit.term + ')',
      scene: hit.scene, excerpt: hit.excerpt, use: hit.suggestedUse
    });
  }

  function setStatus(cue, status) {
    if (!cue || STATUSES.indexOf(status) < 0) return null;
    cue.status = status;
    return cue;
  }
  /* The normal flow; licensed and replaced are terminal. */
  function nextStatus(status) {
    var i = STATUSES.indexOf(status);
    if (i < 0 || status === 'licensed' || status === 'replaced') return null;
    return STATUSES[i + 1];
  }

  /* ── 4 · planning estimates ───────────────────────────────────────────── */
  function perSide(tier, use) {
    var mid = (tier.low + tier.high) / 2;
    if (use === 'main title' || use === 'end credits') return mid * 1.5;
    if (use === 'featured') return (mid + tier.high) / 2;   // top half of the range
    return (tier.low + mid) / 2;                            // background: bottom half
  }

  /* estimate(cue) → {sync, master, total, note}. Both sides are needed for
     any commercial recording; library tracks are one all-in fee. Figures
     are PLANNING estimates only — real quotes come from the rights holders. */
  function estimate(cue) {
    var tier = TIER_BY_ID[cue.tier] || TIER_BY_ID.indie;
    var side = perSide(tier, cue.use);
    var festival = cue.scope === 'festival';
    if (festival) side = side * FESTIVAL_FACTOR;
    var sync = Math.round(side);
    var master = tier.allIn ? 0 : Math.round(side);
    var note = 'Planning estimate only — ' + tier.label + ', ' + cue.use + ' use, ' +
      (tier.allIn ? 'one all-in fee' : 'per side (sync + master both required)') +
      (festival ? '; festival-only ≈15% of the all-media figure — negotiate a step-up option to full rights now, before you need them' : '') +
      '. Real fees vary widely; verify with the publisher and label before relying on this.';
    return { sync: sync, master: master, total: sync + master, note: note };
  }

  /* Working number for one cue: the real quote once you have it, the
     planning estimate until then; a replaced cue costs nothing. */
  function cueCost(cue) {
    if (cue.status === 'replaced') return 0;
    return cue.actualQuote > 0 ? cue.actualQuote : estimate(cue).total;
  }

  function totals(cues) {
    var out = { est: 0, working: 0, quoted: 0, licensed: 0, count: 0, byStatus: {} };
    (cues || []).forEach(function (c) {
      out.byStatus[c.status] = (out.byStatus[c.status] || 0) + 1;
      if (c.status === 'replaced') return;
      out.count++;
      out.est += estimate(c).total;
      out.working += cueCost(c);
      if (c.actualQuote > 0) out.quoted += c.actualQuote;
      if (c.status === 'licensed' && c.actualQuote > 0) out.licensed += c.actualQuote;
    });
    return out;
  }

  /* scoreComparison(minutes) — commissioning an original score instead,
     at the indie range of $100–$400 per finished minute. */
  function scoreComparison(minutes) {
    var m = Math.max(0, +minutes || 0);
    return {
      low: Math.round(m * 100), high: Math.round(m * 400),
      note: 'Commissioned original score, indie range $100–$400 per finished minute of music. ' +
        'Planning estimate only — composer fees swing with orchestration, live players, and ' +
        'delivery format; verify with real composer quotes before relying on it. An original ' +
        'score is cleared by one work-for-hire agreement instead of per-song licenses.'
    };
  }

  /* ── 5 · license request letter ───────────────────────────────────────── */
  function licenseRequest(o) {
    o = o || {};
    var c = o.cue || {};
    var tier = TIER_BY_ID[c.tier] || TIER_BY_ID.indie;
    var scopeLine = c.scope === 'festival'
      ? 'Film-festival exhibition only at this stage; please include a step-up option to all media, worldwide, in perpetuity.'
      : 'All media, worldwide, in perpetuity.';
    return (o.company || 'CINAMATE production office') + '\nRe: "' + (o.production || 'Untitled production') + '"\n\n' +
      'MUSIC SYNCHRONIZATION & MASTER USE LICENSE REQUEST\n\n' +
      'To whom it may concern,\n\n' +
      'We are producing the above independent motion picture and request a quote to license ' +
      'the following recording for use in the picture:\n\n' +
      '    Title: ' + (c.title || '[title]') + '\n' +
      '    Artist: ' + (c.artist || '[artist]') + '\n' +
      '    Use: ' + (c.use || 'background') + (c.scene ? ', scene ' + c.scene : '') +
      ', timing to be confirmed at picture lock\n' +
      '    Rights sought: synchronization' + (tier.allIn ? ' and master use under one all-in fee' :
        ', plus master use where you control the recording') + '\n' +
      '    Territory / term: ' + scopeLine + '\n\n' +
      'Please advise your fee for each side, any most-favored-nations terms, and the exact ' +
      'credit language you require. We are happy to send the scene pages and a reference cut ' +
      'for context.\n\n' +
      'Kind regards,\n' + (o.contact || '') + '\n';
  }

  /* ── 6 · the cue sheet a PRO can actually process ──────────────────────
     Timings first: a cue sheet without a duration per cue is not payable. */
  function timingSec(tc) {
    var s = String(tc == null ? '' : tc).trim();
    if (!s) return 0;
    var m = /^(\d{1,3}):(\d{2}):(\d{2})(?:[:;](\d{1,2}))?$/.exec(s);
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? (+m[4]) / 24 : 0);
    var m2 = /^(\d{1,3}):(\d{2})$/.exec(s);
    if (m2) return (+m2[1]) * 60 + (+m2[2]);
    var n = parseFloat(s);
    return isFinite(n) && n >= 0 ? n : 0;
  }
  function timingTc(sec, fps) {
    fps = fps || 24;
    var s = Math.max(0, +sec || 0);
    var fr = Math.round((s - Math.floor(s)) * fps);
    if (fr >= fps) { fr = 0; s += 1; }
    s = Math.floor(s);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60) + ':' + p(fr);
  }
  /* The duration the PRO pays on: explicit if entered, otherwise the timings. */
  function cueDuration(cue) {
    var c = cue || {};
    if (c.durSec > 0) return Math.round(c.durSec * 10) / 10;
    var a = timingSec(c.tcIn), b = timingSec(c.tcOut);
    return b > a ? Math.round((b - a) * 10) / 10 : 0;
  }
  function mmss(sec) {
    var s = Math.max(0, Math.round(+sec || 0));
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  /* shareTotals(cue) — both sides must total 100%. Societies reject a sheet
     that does not, and an unstated share is the most common reason a writer
     is never paid for a cue that aired. */
  function shareTotals(cue) {
    var c = cue || {};
    var w = (c.writers || []).reduce(function (s, x) { return s + shareNum(x.share); }, 0);
    var p = (c.publishers || []).reduce(function (s, x) { return s + shareNum(x.share); }, 0);
    w = Math.round(w * 100) / 100; p = Math.round(p * 100) / 100;
    return { writers: w, publishers: p, ok: w === 100 && p === 100 };
  }
  function sharesText(list) {
    return (list || []).map(function (x) {
      return (x.name || '[name]') + (x.role ? ' (' + x.role + ')' : '') +
        (x.pro ? ' · ' + x.pro : '') + ' ' + shareNum(x.share) + '%';
    }).join('; ');
  }

  /* cueSheetIssues(cues) → everything a PRO or a distributor would bounce the
     sheet for, named per cue. This is the pre-submission read. */
  function cueSheetIssues(cues, o) {
    var opts = o || {};
    var rows = (cues || []).filter(function (c) { return c.status !== 'replaced'; });
    var issues = [];
    rows.forEach(function (c, i) {
      var seq = i + 1;
      var add = function (field, msg) { issues.push({ seq: seq, cueId: c.id, title: c.title, field: field, msg: msg }); };
      if (!c.title || c.title === 'Untitled cue') add('title', 'Cue has no title.');
      if (!cueDuration(c)) add('timing', 'No timing — enter TC in/out or a duration; a cue with no duration is not payable.');
      if (!(c.writers || []).length) add('writers', 'No writers listed. A PRO pays writers, not a "composer" text field.');
      if (!(c.publishers || []).length) add('publishers', 'No publishers listed (use "Unpublished" if the writer self-publishes).');
      var tot = shareTotals(c);
      if ((c.writers || []).length && tot.writers !== 100) add('writers', 'Writer shares total ' + tot.writers + '%, not 100%.');
      if ((c.publishers || []).length && tot.publishers !== 100) add('publishers', 'Publisher shares total ' + tot.publishers + '%, not 100%.');
      (c.writers || []).forEach(function (w) {
        if (!w.name) add('writers', 'A writer row has no name.');
        else if (!w.pro) add('writers', w.name + ' has no PRO affiliation — the society cannot route the royalty.');
      });
      (c.publishers || []).forEach(function (p) {
        if (p.name && !p.pro) add('publishers', p.name + ' has no PRO affiliation.');
      });
      if (!c.iswc) add('iswc', 'No ISWC for the composition (ask the publisher; blank is accepted but slows matching).');
      if (!c.isrc && c.artist) add('isrc', 'No ISRC for the master recording (ask the label).');
      if (opts.requireLicensed !== false && c.status !== 'licensed') {
        add('status', 'Cue is "' + c.status + '" — only licensed cues belong on a delivered sheet.');
      }
    });
    return issues;
  }

  /* cueSheetRows(cues, o) → one row per cue, in PRO column order. */
  function cueSheetRows(cues, o) {
    o = o || {};
    return (cues || []).filter(function (c) { return c.status !== 'replaced'; }).map(function (c, i) {
      var dur = cueDuration(c);
      return {
        seq: i + 1,
        title: c.title || '',
        useCode: useCodeFor(c),
        tcIn: c.tcIn || '',
        tcOut: c.tcOut || (dur && c.tcIn ? timingTc(timingSec(c.tcIn) + dur, o.fps) : ''),
        durSec: dur,
        duration: dur ? mmss(dur) : '',
        iswc: c.iswc || '',
        isrc: c.isrc || '',
        artist: c.artist || '',
        recordLabel: c.recordLabel || c.masterOwner || '',
        writers: (c.writers || []).map(normWriter),
        publishers: (c.publishers || []).map(normPublisher),
        writerShares: shareTotals(c).writers,
        publisherShares: shareTotals(c).publishers,
        scene: c.scene || ''
      };
    });
  }

  /* A cell that opens with = + - @ (or a tab/CR that scrolls one into place)
     is a formula to Excel and Sheets, not text. */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  /* cueSheetCsv — the delivery format. One row per writer/publisher pair so
     every share is its own line, which is how a society ingests it. */
  function cueSheetCsv(cues, o) {
    o = o || {};
    var head = ['Seq', 'Cue title', 'Use', 'TC in', 'TC out', 'Duration', 'Secs', 'ISWC',
                'Role', 'Writer / publisher', 'PRO', 'IPI', 'Share %', 'Artist', 'ISRC', 'Label'];
    var out = [head.map(csvCell).join(',')];
    cueSheetRows(cues, o).forEach(function (r) {
      var parties = r.writers.map(function (w) {
        return { role: w.role, name: w.name, pro: w.pro, ipi: w.ipi, share: w.share };
      }).concat(r.publishers.map(function (p) {
        return { role: 'P', name: p.name, pro: p.pro, ipi: p.ipi, share: p.share };
      }));
      if (!parties.length) parties = [{ role: '', name: '', pro: '', ipi: '', share: '' }];
      parties.forEach(function (p, k) {
        out.push([k ? '' : r.seq, k ? '' : r.title, k ? '' : r.useCode, k ? '' : r.tcIn,
                  k ? '' : r.tcOut, k ? '' : r.duration, k ? '' : r.durSec, k ? '' : r.iswc,
                  p.role, p.name, p.pro, p.ipi, p.share,
                  k ? '' : r.artist, k ? '' : r.isrc, k ? '' : r.recordLabel].map(csvCell).join(','));
      });
    });
    return out.join('\n');
  }

  function pad(s, n) {
    s = String(s == null ? '' : s);
    if (s.length > n - 2) s = s.slice(0, n - 3) + '…';
    while (s.length < n) s += ' ';
    return s;
  }
  /* The readable preview of the same document. */
  function cueSheet(cues, o) {
    o = o || {};
    var rows = cueSheetRows(cues, o);
    var issues = cueSheetIssues(cues, o);
    var lines = [];
    lines.push('MUSIC CUE SHEET — ' + (o.production || 'Untitled production'));
    lines.push('Prepared ' + (o.date || '[date]') + ' · ' + (o.fps || 24) + ' fps · ' +
      'submit to the PRO of each writer; verify every share and affiliation before delivery');
    lines.push('');
    lines.push(pad('SEQ', 5) + pad('TITLE', 28) + pad('USE', 6) + pad('TC IN', 13) +
      pad('DUR', 8) + pad('ISWC', 16) + 'WRITERS / PUBLISHERS');
    rows.forEach(function (r) {
      lines.push(pad(r.seq, 5) + pad(r.title, 28) + pad(r.useCode, 6) + pad(r.tcIn || '__:__:__:__', 13) +
        pad(r.duration || '—', 8) + pad(r.iswc || '[iswc]', 16) +
        (sharesText(r.writers) || '[no writers listed]'));
      lines.push(pad('', 5) + pad('', 28) + pad('', 6) + pad('', 13) + pad('', 8) + pad('', 16) +
        'P: ' + (sharesText(r.publishers) || '[no publishers listed]'));
    });
    lines.push('');
    lines.push(rows.length + ' cue' + (rows.length === 1 ? '' : 's') + ' · use codes: ' +
      USE_CODES.map(function (u) { return u.id + '=' + u.label; }).join(' · '));
    if (issues.length) {
      lines.push('');
      lines.push('NOT READY TO SUBMIT — ' + issues.length + ' item' + (issues.length === 1 ? '' : 's') + ':');
      issues.forEach(function (x) { lines.push('  · cue ' + x.seq + ' (' + x.title + ') — ' + x.msg); });
    } else {
      lines.push('');
      lines.push('Every cue carries a duration, writer and publisher shares totalling 100%, and a PRO for each party.');
    }
    return lines.join('\n');
  }

  /* ── 7 · seeding from the cut, and from the old office register ────────
     cuesFromCut replaces production/lib-prod.js cueSheet(): same source (the
     Editor timeline's audio track), but it produces real CUES with timings
     and durations instead of a register row whose duration was thrown away. */
  function cuesFromCut(cutStore) {
    var p = (cutStore && cutStore.project) || cutStore || {};
    var fps = p.fps || 24;
    return ((p.audio) || []).map(function (a, i) {
      var dur = Math.max(0, ((+a.out || 0) - (+a.in || 0)) / (+a.speed || 1));
      var start = +a.start || 0;
      return makeCue({
        title: a.label || 'Cue ' + (i + 1),
        tcIn: timingTc(start, fps), tcOut: timingTc(start + dur, fps),
        durSec: Math.round(dur * 10) / 10,
        useCode: 'BI', use: 'background', manual: true
      });
    });
  }
  /* Rows from the old SB_CueSheet_v1 office register — one composer, one
     publisher, one society, no shares. Nothing is discarded: the names become
     a writer and a publisher, and cueSheetIssues then asks for the shares. */
  function importCueRows(rows) {
    return (rows || []).map(function (r) {
      return makeCue({
        title: r.title || '', tcIn: r.tcIn || '', tcOut: r.tcOut || '',
        durSec: +r.durSec || 0,
        useCode: USE_CODE_IDS.indexOf(r.use) >= 0 ? r.use : '',
        composer: r.composer || '', publisher: r.publisher || '', society: r.society || '',
        manual: true
      });
    });
  }

  root.CMusic = {
    USES: USES, SCOPES: SCOPES, STATUSES: STATUSES,
    TIERS: TIERS, TIER_BY_ID: TIER_BY_ID, FESTIVAL_FACTOR: FESTIVAL_FACTOR,
    PROS: PROS, USE_CODES: USE_CODES, USE_CODE_IDS: USE_CODE_IDS, WRITER_ROLES: WRITER_ROLES,
    splitScenes: splitScenes, scanScript: scanScript,
    makeCue: makeCue, cueFromHit: cueFromHit,
    normWriter: normWriter, normPublisher: normPublisher, useCodeFor: useCodeFor,
    setStatus: setStatus, nextStatus: nextStatus,
    estimate: estimate, cueCost: cueCost, totals: totals, scoreComparison: scoreComparison,
    licenseRequest: licenseRequest,
    timingSec: timingSec, timingTc: timingTc, cueDuration: cueDuration, mmss: mmss,
    shareTotals: shareTotals, sharesText: sharesText,
    cueSheet: cueSheet, cueSheetRows: cueSheetRows, cueSheetCsv: cueSheetCsv,
    cueSheetIssues: cueSheetIssues,
    cuesFromCut: cuesFromCut, importCueRows: importCueRows
  };
})(typeof window !== 'undefined' ? window : globalThis);
