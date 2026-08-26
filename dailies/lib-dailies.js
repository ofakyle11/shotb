/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Dailies Logger engine (CDailies)
   Pure logic, no DOM: on-set take logging math — auto slate/take suggestion,
   circled-take rates, script coverage gaps, the planned-vs-shot coverage join,
   classic per-day camera & sound report text exports, and the editor's pull
   list of circled takes.
   All state is passed in; nothing here touches storage or the page.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  /* The one scene model — js/lib-scenes.js. Every module used to carry its
     own screenplay splitter; they disagreed on preambles, printed scene
     numbers and A/B scenes, so they now all read from here. Loaded by a
     <script> tag before this file, and by the node suites. */
  var CS = root.CScenes;
  if (!CS) throw new Error('lib-dailies.js requires js/lib-scenes.js to be loaded first');

  /* The shoot day (js/lib-shootdays.js) is the join key between this page, the
     stripboard and the day planner, and it also owns the ONE translation of
     the other take store's circle. It is resolved at call time rather than
     captured at load: the pages that need it load it first, and the two suites
     that only ask this file to split a screenplay must not be made to carry
     it. Every entry point that genuinely needs it says so and throws. */
  function SD() { return root.CShootDays || null; }
  function needSD(what) {
    var sd = SD();
    if (!sd) throw new Error('lib-dailies ' + what + ' requires js/lib-shootdays.js to be loaded first');
    return sd;
  }

  function num(v) { var n = parseInt(v, 10); return isFinite(n) ? n : 0; }
  function str(v) { return String(v == null ? '' : v).trim(); }

  /* ── 1 · screenplay scenes (the one scene model) ─────────────────────────
     sceneList used to renumber the scenes 1..n by position, which is how a
     take slated "24" could not be matched to the scene the script calls 24.
     CScenes.sceneList carries the printed number through instead.          */
  var splitScenes = CS.split;
  var sceneList = CS.sceneList;

  /* ── 2 · slate arithmetic ────────────────────────────────────────────────
     Slates follow the classic scheme: scene number + setup letter
     (12A, 12B … 12Z, 12AA). Letters are bijective base-26.                 */
  function lettersToNum(s) {
    var n = 0, up = str(s).toUpperCase();
    for (var i = 0; i < up.length; i++) {
      var c = up.charCodeAt(i);
      if (c < 65 || c > 90) return 0;
      n = n * 26 + (c - 64);
    }
    return n;
  }
  function numToLetters(n) {
    var s = '';
    n = Math.floor(n);
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function parseSlate(slate) {
    var m = /^\s*(\d+)?\s*([A-Za-z]+)?\s*$/.exec(str(slate));
    if (!m) return { scene: 0, letters: '', ord: 0 };
    return { scene: num(m[1]), letters: str(m[2]).toUpperCase(), ord: lettersToNum(m[2] || '') };
  }
  /* nextSlate(takes, scene): what the 2nd AC would chalk next.
     Same scene as an existing take → same slate, take + 1.
     A scene with no takes yet → slate '<scene>A', take 1.                  */
  function nextSlate(takes, scene) {
    var sc = str(scene);
    var same = (takes || []).filter(function (t) { return str(t.scene) === sc; });
    if (same.length) {
      var last = same[same.length - 1];
      return { slate: str(last.slate) || (sc + 'A'), take: num(last.take) + 1, fresh: false };
    }
    return { slate: sc + 'A', take: 1, fresh: true };
  }
  /* nextSetup(takes, scene): new camera setup on the same scene → next
     unused letter for that scene (12A used → 12B; 12Z used → 12AA).        */
  function nextSetup(takes, scene) {
    var sc = str(scene), max = 0;
    (takes || []).forEach(function (t) {
      if (str(t.scene) !== sc) return;
      var p = parseSlate(t.slate);
      if (p.ord > max) max = p.ord;
    });
    return { slate: sc + numToLetters(max + 1), take: 1, fresh: max === 0 };
  }

  /* ── 3 · take normalisation ─────────────────────────────────────────── */
  function makeTake(fields, id) {
    var f = fields || {};
    var cam = str(f.camera).toUpperCase();
    return {
      id: str(id || f.id) || 't' + Math.random().toString(36).slice(2, 9),
      day: str(f.day), scene: str(f.scene),
      slate: str(f.slate).toUpperCase(), take: Math.max(1, num(f.take) || 1),
      camera: cam === 'B' ? 'B' : 'A',
      circled: !!f.circled, ngReason: str(f.ngReason), notes: str(f.notes),
      soundRoll: str(f.soundRoll), lens: str(f.lens), tcIn: str(f.tcIn)
    };
  }
  function sortTakes(takes) {
    return (takes || []).slice().sort(function (a, b) {
      if (str(a.day) !== str(b.day)) return str(a.day) < str(b.day) ? -1 : 1;
      var pa = parseSlate(a.slate), pb = parseSlate(b.slate);
      if (pa.scene !== pb.scene) return pa.scene - pb.scene;
      if (pa.ord !== pb.ord) return pa.ord - pb.ord;
      return num(a.take) - num(b.take);
    });
  }

  /* ── 3b · the one circle question, and the other take store ─────────────
     A take is circled in two different alphabets. SB_Dailies_v1 (this module's
     own shape) carries a real boolean. SB_TakeLog_v1 — the Tools → Slate
     Register — carries the <select> display string 'Circled ⭕' in `grade`.

     js/lib-shootdays.js normalises the second into the first, and that was
     supposed to be the end of it; but every reader in this file went on
     reading `t.circled` off the raw row, so a take circled on the phone in
     /tools/ was invisible to the circle rate, to both on-set reports and to
     the editor's pull list. It counted as a take and never as a circle: a
     silent wrong answer in the one direction that matters, because an
     uncounted circle is a printed take the cutting room never receives.

     So every read of "is this circled" in this file goes through here, and the
     string→boolean rule is NOT restated — a second copy of it is exactly how
     the two stores drifted apart in the first place.                        */
  function isCircled(take) {
    var t = take || {};
    if (t.circled === true) return true;
    var g = str(t.grade);
    if (!g) return false;
    return needSD('isCircled (a take carrying a grade string)').isCircledGrade(g);
  }

  /* fromLogRow(row): a CShootDays-normalised take (either store) in this
     module's own shape, so the reports can be written over both logs at once.
     `source` is carried through — a row that came from the Tools Register is
     not editable here and the page must not offer to edit it. */
  function fromLogRow(row) {
    var r = row || {};
    var t = makeTake({
      day: r.day, scene: r.scene, slate: r.slate || (str(r.scene) ? str(r.scene) + 'A' : ''),
      take: r.take, camera: r.camera, circled: isCircled(r),
      ngReason: /^\s*ng\b/i.test(str(r.grade)) ? str(r.grade) : '',
      notes: r.note == null ? r.notes : r.note,
      soundRoll: r.roll == null ? r.soundRoll : r.roll,
      lens: r.lens, tcIn: r.time || r.tcIn
    }, r.id);
    t.source = str(r.source);
    return t;
  }

  /* mergeTakes(mine, rows): this page's own takes plus everything else the
     shoot-day accessor can see, deduped on id so a row that reached us through
     both paths is one take, not two. */
  function mergeTakes(mine, rows) {
    var out = [], seen = {};
    (mine || []).forEach(function (t) { if (t && !seen[str(t.id)]) { seen[str(t.id)] = 1; out.push(t); } });
    (rows || []).forEach(function (r) {
      var t = fromLogRow(r);
      if (seen[str(t.id)]) return;
      seen[str(t.id)] = 1;
      out.push(t);
    });
    return out;
  }

  /* ── 3c · what date a take is stamped with ──────────────────────────────
     THE CONVENTION, stated once: a shoot day is the production's own LOCAL
     calendar date. Wrap at 23:50 on the 7th belongs to the 7th — that is the
     day the crew worked, the day on the call sheet, and the day the report is
     headed with. Stamping in UTC files that take on the 8th for everybody west
     of Greenwich, and then `CShootDays.takesOn` (exact string equality) hands
     back half the day's takes on each of two dates.

     tools/tools-core.js still stamps SB_TakeLog_v1 in UTC
     (new Date().toISOString().slice(0,10)) while carrying a LOCAL 'HH:MM' in
     the same row, so those rows are internally inconsistent. utcDayISO exists
     so this page can SEE that disagreement and say so, rather than quietly
     losing takes across the boundary.                                       */
  function localDayISO(d) {
    var x = d || new Date();
    return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2);
  }
  function utcDayISO(d) {
    var x = d || new Date();
    return x.getUTCFullYear() + '-' + ('0' + (x.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + x.getUTCDate()).slice(-2);
  }
  /* dayStamp(d) → {local, utc, differ}. When they differ, any take logged in
     Tools → Slate right now lands on a different calendar date than one logged
     here — the page reports that instead of pretending the log is one list. */
  function dayStamp(d) {
    var l = localDayISO(d), u = utcDayISO(d);
    return { local: l, utc: u, differ: l !== u };
  }

  /* ── 4 · circle rate ──────────────────────────────────────────────────
     circled / total, overall and per shoot day.                            */
  function circleRate(takes) {
    var all = takes || [];
    var byDay = {}, order = [];
    all.forEach(function (t) {
      var d = str(t.day) || '(no day)';
      if (!byDay[d]) { byDay[d] = { day: d, total: 0, circled: 0, pct: 0 }; order.push(d); }
      byDay[d].total++;
      if (isCircled(t)) byDay[d].circled++;
    });
    order.sort();
    var days = order.map(function (d) {
      var r = byDay[d];
      r.pct = r.total ? Math.round(100 * r.circled / r.total) : 0;
      return r;
    });
    var total = all.length, circled = all.filter(isCircled).length;
    return { overall: { total: total, circled: circled, pct: total ? Math.round(100 * circled / total) : 0 },
             byDay: days };
  }

  /* ── 5 · coverage: which script scenes have zero takes ───────────────
     Keyed on the PRINTED scene identity, not on the numeric base. Counting by
     `n` meant a take slated 4A landed on scene 4: on a revised script, where
     the A-scenes are exactly the new material, coverage of the newest pages
     was credited to the pages they replaced. `n` stays on every row for the
     readers that already use it.                                            */
  function takeSceneKey(scenes, take) {
    var t = take || {};
    var want = CS.normNum(t.scene);
    if (!want) {
      var p = parseSlate(t.slate);
      want = p.scene ? String(p.scene) : '';
    }
    if (!want) return '';
    var hit = CS.byNumber(scenes || [], want);
    /* A scene this screenplay does not contain keeps its own identity rather
       than being rounded onto one that exists. */
    return hit ? hit.key : want;
  }
  function coverageByScene(takes, scriptText) {
    var scenes = sceneList(scriptText);
    var counts = {}, circles = {};
    (takes || []).forEach(function (t) {
      var k = takeSceneKey(scenes, t);
      if (!k) return;
      counts[k] = (counts[k] || 0) + 1;
      if (isCircled(t)) circles[k] = (circles[k] || 0) + 1;
    });
    var rows = scenes.map(function (s) {
      return { n: s.n, key: s.key, label: s.label, slug: s.slug, eighths: s.eighths,
               takes: counts[s.key] || 0,
               circled: circles[s.key] || 0, covered: (counts[s.key] || 0) > 0 };
    });
    return { scenes: rows,
             gaps: rows.filter(function (r) { return !r.covered; }),
             covered: rows.filter(function (r) { return r.covered; }).length,
             total: rows.length };
  }

  /* ── 5b · the loop: what was PLANNED against what was SHOT ──────────────
     coverageByScene above answers "which scenes has this production not shot
     yet", which on day three of a forty-day schedule is almost every scene —
     a statistic, and one nobody can act on. The question the floor actually
     asks at wrap is narrower and urgent: *of the scenes scheduled for today,
     which ones did we not get?* Both halves of that have been sitting in the
     store the whole time — the stripboard says what was scheduled on a day
     index, the shoot-day record turns that index into a date, and the take
     logs say what was shot on that date — and nothing ever compared them. So
     an unshot scene simply did not appear anywhere, which is the worst
     possible shape for it: silence that reads as "nothing to report".

     The join is made on three keys that already exist, and nothing new is
     invented: CShootDays.byDate/scheduledOn/takesOn for the day,
     CScenes.byNumber for the scene (so 4A is not 4), and the strip's own
     heading for the strip. Every miss on each of those joins is reported.  */

  /* A day is only judged once it is over. A scene scheduled for next Tuesday
     is not a gap, and reporting it as one would train the AD to ignore the
     whole list. `wrapped` is the production saying so; asOf is the calendar
     saying so for a day nobody remembered to wrap. */
  function dayIsOver(rec, asOf) {
    if (!rec) return false;
    if (rec.wrapped) return true;
    return !!(asOf && rec.date && rec.date < asOf);
  }

  function normHead(v) {
    return str(v).toUpperCase().replace(/\s+/g, ' ');
  }
  /* stripScene(scenes, strip) → {scene, how}. A stripboard strip identifies
     itself by an ORDINAL (`num`) and a heading, never by the printed scene
     number — but the heading it carries is the author's own slugline, and the
     printed number is right there in it. So the number is read out of the
     heading with the one slugline grammar, the heading text is the fallback
     for a hand-typed strip, and the ordinal is the last resort.

     The ordinal really is last: CScenes.byNumber refuses an ordinal on a
     numbered script on purpose, so a strip that gets that far on a shooting
     script is reported as unmatched rather than matched to whatever scene
     happens to sit in that position. An invented match here would put a real
     scene's name on the wrong day's gap list.

     wardrobe/lib-ward.js:shootOrderFromBoard makes the same join for the
     costume plot by heading-then-ordinal. Two joins onto one board is one too
     many; they should become one the day a module can depend on another
     module's lib. Until then this one is stated where its answer is used. */
  function stripScene(scenes, strip) {
    var list = scenes || [], st = strip || {};
    var head = str(st.heading);
    var meta = head ? CS.parseSlug(head) : null;
    if (meta && meta.number) {
      var byNum = CS.byNumber(list, meta.number);
      if (byNum) return { scene: byNum, how: 'number' };
    }
    var want = normHead(meta ? meta.slug : head);
    if (want) {
      for (var i = 0; i < list.length; i++) {
        if (normHead(list[i].slug) === want) return { scene: list[i], how: 'heading' };
      }
    }
    var ord = CS.byNumber(list, str(st.num));
    if (ord) return { scene: ord, how: 'ordinal' };
    return { scene: null, how: '' };
  }

  function dayName(rec) {
    return 'Day ' + (num(rec && rec.dayIdx) + 1) + (rec && rec.date ? ' (' + rec.date + ')' : '');
  }

  /* coverageAgainstSchedule({board, shootDays, scriptText|scenes, stores|takes|
                              takesFor, asOf})
       → { days, missed, pickedUp, unplanned, notInScript, unmatchedStrips,
           neverScheduled, undated, totals }
     `missed` is the actionable list: a scene that was scheduled on a day that
     is over and carries no take anywhere. */
  function coverageAgainstSchedule(input) {
    var o = input || {};
    var sd = needSD('coverageAgainstSchedule');
    var scenes = o.scenes || (o.scriptText != null ? CS.parse(o.scriptText).scenes : []);
    var board = o.board || { scenes: [] };
    var recs = Array.isArray(o.shootDays) ? o.shootDays.slice() : [];
    var asOf = str(o.asOf);
    var byKey = {};
    scenes.forEach(function (s) { byKey[s.key] = s; });

    var takesFor = typeof o.takesFor === 'function' ? o.takesFor
      : o.stores ? function (rec) { return sd.takesOn(o.stores, rec.date); }
      : function (rec) { return (o.takes || []).filter(function (t) { return str(t.day) === str(rec.date); }); };

    /* Pass one: what was shot, and on which day. Across ALL days, because a
       scene missed on Tuesday and picked up on Friday is not a hole in the
       picture — it is a hole in Tuesday, and the report must be able to say
       which of the two it is looking at. */
    var shotOn = {}, dayTakeRows = {}, unplanned = [], notInScript = [];
    recs.forEach(function (rec) {
      var rows = takesFor(rec) || [];
      dayTakeRows[rec.dayIdx] = rows;
      rows.forEach(function (t) {
        var k = takeSceneKey(scenes, t);
        if (!k) return;
        if (!shotOn[k]) shotOn[k] = [];
        if (shotOn[k].indexOf(rec.dayIdx) < 0) shotOn[k].push(rec.dayIdx);
      });
    });

    var days = [], missed = [], pickedUp = [], unmatchedStrips = [], scheduledKeys = {};
    var scheduledCount = 0, shotCount = 0, judgedDays = 0;

    recs.slice().sort(function (a, b) { return num(a.dayIdx) - num(b.dayIdx); }).forEach(function (rec) {
      var over = dayIsOver(rec, asOf);
      if (over) judgedDays++;
      var strips = sd.scheduledOn(board, rec.dayIdx) || [];
      var planned = [], missedHere = [];
      strips.forEach(function (stp) {
        var hit = stripScene(scenes, stp);
        if (!hit.scene) {
          unmatchedStrips.push({ dayIdx: rec.dayIdx, date: rec.date,
            heading: str(stp.heading) || ('strip ' + str(stp.id || stp.num)),
            note: 'this strip matches no scene in the screenplay, so nothing on it can be checked for coverage' });
          return;
        }
        var sc = hit.scene;
        scheduledKeys[sc.key] = true;
        scheduledCount++;
        var on = shotOn[sc.key] || [];
        var here = on.indexOf(rec.dayIdx) >= 0;
        var later = on.filter(function (d) { return d !== rec.dayIdx; });
        /* The page count of a missed scene is the SCHEDULE's own figure — what
           the AD planned for the day and what the day is measured against —
           not this module's re-measure of the scene text. The parsed measure
           is the fallback for a strip that carries none. */
        var row = { key: sc.key, label: sc.label, slug: sc.slug, iu: sc.iu, tod: sc.tod,
                    location: sc.location, eighths: Math.max(0, num(stp.eighths)) || (sc.eighths || 0),
                    dayIdx: rec.dayIdx, date: rec.date, unit: rec.unit,
                    matchedBy: hit.how, shot: here, dayOver: over,
                    takes: 0, circled: 0, pickedUpOn: later.length ? later.slice().sort(function (a, b) { return a - b; }) : null,
                    note: '' };
        (dayTakeRows[rec.dayIdx] || []).forEach(function (t) {
          if (takeSceneKey(scenes, t) !== sc.key) return;
          row.takes++;
          if (isCircled(t)) row.circled++;
        });
        if (here) shotCount++;
        if (!here && over) {
          if (row.pickedUpOn) {
            row.note = 'Scene ' + sc.label + ' — ' + (sc.slug || '(no heading)') + ' — was scheduled on ' +
              dayName(rec) + ' and was not shot that day; it was picked up on ' +
              row.pickedUpOn.map(function (d) { return 'Day ' + (d + 1); }).join(', ') + '.';
            pickedUp.push(row);
          } else {
            row.note = 'Scene ' + sc.label + ' — ' + (sc.slug || '(no heading)') + ' — was scheduled on ' +
              dayName(rec) + ' and NO take was logged, on that day or any other. ' +
              eighthsLabel(row.eighths) + ' unshot: reschedule it or drop it on the record.';
            missed.push(row);
            missedHere.push(row);
          }
        }
        planned.push(row);
      });

      /* Shot on this day but not scheduled for it: a pick-up, an added scene,
         or a scene pulled forward. Not a fault — but it is what the missing
         pages were traded for, so the day cannot be read without it. */
      var plannedKeys = {};
      planned.forEach(function (p) { plannedKeys[p.key] = true; });
      var added = [];
      (dayTakeRows[rec.dayIdx] || []).forEach(function (t) {
        var k = takeSceneKey(scenes, t);
        if (!k || plannedKeys[k]) return;
        plannedKeys[k] = true;
        var sc = byKey[k];
        var row = { key: k, label: sc ? sc.label : k, slug: sc ? sc.slug : '',
                    eighths: sc ? sc.eighths : 0, dayIdx: rec.dayIdx, date: rec.date,
                    inScript: !!sc,
                    note: sc ? 'Scene ' + sc.label + ' was shot on ' + dayName(rec) + ' without being scheduled for it.'
                             : 'Takes are logged against scene ' + k + ' on ' + dayName(rec) +
                               ', and this screenplay has no scene ' + k + '.' };
        added.push(row);
        (sc ? unplanned : notInScript).push(row);
      });

      days.push({ dayIdx: rec.dayIdx, date: rec.date, unit: rec.unit, wrapped: !!rec.wrapped,
                  dayOver: over, scheduled: planned, missed: missedHere, added: added,
                  plannedEighths: planned.reduce(function (a, p) { return a + (p.eighths || 0); }, 0),
                  missedEighths: missedHere.reduce(function (a, p) { return a + (p.eighths || 0); }, 0) });
    });

    /* A scene on no strip at all is a different failure from an unshot one,
       and it belongs to the schedule rather than to the floor. */
    var neverScheduled = scenes.filter(function (s) { return !scheduledKeys[s.key]; })
      .map(function (s) {
        return { key: s.key, label: s.label, slug: s.slug, eighths: s.eighths,
                 shot: !!(shotOn[s.key] && shotOn[s.key].length),
                 note: 'Scene ' + s.label + ' is on no strip of the stripboard' +
                       (shotOn[s.key] && shotOn[s.key].length ? ' — though it has been shot.'
                                                              : ' and has not been shot.') };
      });

    return {
      days: days, missed: missed, pickedUp: pickedUp, unplanned: unplanned,
      notInScript: notInScript, unmatchedStrips: unmatchedStrips,
      neverScheduled: neverScheduled,
      undated: o.stores ? sd.undatedTakes(o.stores) : [],
      totals: {
        scenes: scenes.length, shootDays: recs.length, judgedDays: judgedDays,
        scheduled: scheduledCount, shot: shotCount,
        missed: missed.length, pickedUp: pickedUp.length,
        missedEighths: missed.reduce(function (a, r) { return a + (r.eighths || 0); }, 0)
      }
    };
  }

  /* Eighths as a production says them: 12 → "1 4/8 pages". */
  function eighthsLabel(e) {
    var n = Math.max(0, num(e));
    var whole = Math.floor(n / 8), rem = n % 8;
    if (!n) return 'no page count on the strip';
    return (whole ? whole + (rem ? ' ' + rem + '/8' : '') : rem + '/8') + ' page' + (whole === 1 && !rem ? '' : 's');
  }

  /* The gap list as text, for the production report and the 6pm email. */
  function missedText(cov, opts) {
    var o = opts || {};
    var c = cov || { missed: [], pickedUp: [], totals: {} };
    var out = ['SCHEDULED AND NOT SHOT — ' + (o.production || '(untitled)'),
               (o.asOf ? 'As of ' + o.asOf : 'As of the last wrapped day'), ''];
    if (!c.totals.judgedDays) {
      out.push('No shoot day has wrapped yet, so nothing is judged. A day is checked');
      out.push('once it is marked wrapped, or once its date has passed.');
      return out.join('\n');
    }
    if (!c.missed.length) {
      out.push('Nothing. Every scene scheduled on the ' + c.totals.judgedDays +
               ' day(s) already shot has at least one take.');
    } else {
      c.missed.forEach(function (r) { out.push(' - ' + r.note); });
      out.push('');
      out.push(c.missed.length + ' scene(s) scheduled and never shot · ' +
               eighthsLabel(c.totals.missedEighths) + ' outstanding.');
    }
    if (c.pickedUp.length) {
      out.push('');
      out.push('Missed on the day and picked up since:');
      c.pickedUp.forEach(function (r) { out.push(' - ' + r.note); });
    }
    if (c.unmatchedStrips.length) {
      out.push('');
      out.push(c.unmatchedStrips.length + ' strip(s) on the board match no scene in the screenplay —');
      out.push('their coverage cannot be checked at all:');
      c.unmatchedStrips.forEach(function (r) { out.push(' - ' + r.heading); });
    }
    return out.join('\n');
  }

  /* ── 6 · classic per-day report exports ─────────────────────────────── */
  function pad(s, w) {
    s = str(s);
    while (s.length < w) s += ' ';
    return s.length > w ? s.slice(0, w - 1) + '…' : s;
  }
  function dayTakes(takes, day) {
    return sortTakes((takes || []).filter(function (t) { return str(t.day) === str(day); }));
  }
  function cameraReport(takes, day, opts) {
    var o = opts || {};
    var rows = dayTakes(takes, day);
    var out = ['CAMERA REPORT — ' + (str(day) || 'no day') + (o.unit ? '  ·  ' + o.unit + ' unit' : ''),
               (o.production ? 'Production: ' + o.production : 'Production: (untitled)') +
               '   ·   circled takes marked ●',
               '',
               pad('SCENE', 7) + pad('SLATE', 8) + pad('TK', 4) + pad('CAM', 5) +
               pad('LENS', 9) + pad('TC IN', 13) + 'NOTES',
               '-------------------------------------------------------------'];
    rows.forEach(function (t) {
      out.push(pad(t.scene, 7) + pad(t.slate, 8) + pad(t.take, 4) + pad(t.camera, 5) +
               pad(t.lens || '—', 9) + pad(t.tcIn || '—', 13) +
               (isCircled(t) ? '● ' : '') + str(t.notes) +
               (t.ngReason ? ' [NG: ' + t.ngReason + ']' : ''));
    });
    if (!rows.length) out.push('(no takes logged for this day)');
    var cr = circleRate(rows);
    out.push('');
    out.push('Takes: ' + cr.overall.total + '   Circled: ' + cr.overall.circled +
             ' (' + cr.overall.pct + '%)');
    out.push('Logged on set with CINAMATE Dailies — cross-check against the');
    out.push('camera assistant\'s written report before lab/DIT turnover.');
    return out.join('\n');
  }
  function soundReport(takes, day, opts) {
    var o = opts || {};
    var rows = dayTakes(takes, day);
    var out = ['SOUND REPORT — ' + (str(day) || 'no day') + (o.unit ? '  ·  ' + o.unit + ' unit' : ''),
               (o.production ? 'Production: ' + o.production : 'Production: (untitled)') +
               '   ·   circled takes marked ●',
               '',
               pad('SCENE', 7) + pad('SLATE', 8) + pad('TK', 4) + pad('ROLL', 7) +
               pad('TC IN', 13) + 'NOTES',
               '-------------------------------------------------------------'];
    rows.forEach(function (t) {
      out.push(pad(t.scene, 7) + pad(t.slate, 8) + pad(t.take, 4) +
               pad(t.soundRoll || '—', 7) + pad(t.tcIn || '—', 13) +
               (isCircled(t) ? '● ' : '') + str(t.notes) +
               (t.ngReason ? ' [NG: ' + t.ngReason + ']' : ''));
    });
    if (!rows.length) out.push('(no takes logged for this day)');
    out.push('');
    out.push('Logged on set with CINAMATE Dailies — cross-check against the');
    out.push('sound mixer\'s written report before turnover.');
    return out.join('\n');
  }

  /* ── 7 · editor picks: circled takes grouped by scene ────────────────── */
  function editorPicks(takes) {
    var circled = sortTakes((takes || []).filter(isCircled));
    return circled.map(function (t) {
      return { scene: str(t.scene), slate: str(t.slate), take: num(t.take),
               notes: str(t.notes), day: str(t.day), camera: t.camera === 'B' ? 'B' : 'A' };
    });
  }
  function picksText(picks) {
    var out = ['EDITOR PULL LIST — circled takes', ''];
    var lastScene = null;
    (picks || []).forEach(function (p) {
      if (p.scene !== lastScene) { out.push('Scene ' + p.scene); lastScene = p.scene; }
      out.push('  ' + pad(p.slate, 8) + 'take ' + pad(p.take, 4) +
               (p.camera ? p.camera + '-cam  ' : '') + str(p.notes));
    });
    if (!(picks || []).length) out.push('(no circled takes yet)');
    out.push('');
    out.push('Circles are the director\'s on-set preference — the cut is not bound by them.');
    return out.join('\n');
  }

  root.CDailies = {
    splitScenes: splitScenes, sceneList: sceneList,
    lettersToNum: lettersToNum, numToLetters: numToLetters, parseSlate: parseSlate,
    nextSlate: nextSlate, nextSetup: nextSetup,
    makeTake: makeTake, sortTakes: sortTakes,
    isCircled: isCircled, fromLogRow: fromLogRow, mergeTakes: mergeTakes,
    localDayISO: localDayISO, utcDayISO: utcDayISO, dayStamp: dayStamp,
    circleRate: circleRate, coverageByScene: coverageByScene,
    takeSceneKey: takeSceneKey, stripScene: stripScene, dayIsOver: dayIsOver,
    eighthsLabel: eighthsLabel,
    coverageAgainstSchedule: coverageAgainstSchedule, missedText: missedText,
    cameraReport: cameraReport, soundReport: soundReport,
    editorPicks: editorPicks, picksText: picksText
  };
})(typeof window !== 'undefined' ? window : globalThis);
