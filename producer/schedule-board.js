/* CINAMATE Producer Suite — Stripboard Scheduler + Day-Out-of-Days + call sheet
 * (our own web take on the classic AD stripboard workflow; written from
 * scratch).
 *
 * Scenes come from the parsed screenplay, sized in eighths of a page, color
 * coded day/night. Drag strips between the Boneyard and shoot days (or
 * auto-schedule at a target pages/day pace). The DOOD report maps every cast
 * member across shoot days with the standard SW / W / H / WF / SWF codes, plus
 * the drop and pick-up a weekly contract actually allows.
 *
 * Three things this file is deliberately careful about:
 *
 * 1. CAST WEEKS ARE COMPUTED IN EXACTLY ONE PLACE. The old arithmetic —
 *    ceil((last - first + 1) / 5) — lived here AND in timeline-budget.js, so a
 *    performer working day 2 and day 20 was billed four continuous weeks in
 *    both, and only one of them could ever be fixed. SBBudget.castWeeks is now
 *    the single implementation; this file calls it, it does not restate it.
 *
 * 2. THE PACE IS LEARNED, NOT ASSUMED. `4.5 pages/day` used to be hardcoded in
 *    three places, so it survived every film it was wrong about. Wrapped days
 *    now leave a row of {planned, achieved} eighths, and the median of the
 *    achieved column replaces the default once there is enough of it. Below
 *    that threshold the default is shown AND LABELLED as the default.
 *
 * 3. THE CALL SHEET IS ASSEMBLED, NOT TYPED. Every field on it already existed
 *    one hop away — see callSheetModel.
 */
(function (root) {
  'use strict';

  var KEY = 'SB_ScheduleBoard_v1';

  /* The shipped starting pace, and the ONLY place the number 4.5 appears.
     It is a planning default for a film nobody has shot yet; the moment there
     are wrapped days it stops being the answer. */
  var DEFAULT_PACE = 4.5;

  /* How many wrapped days before the learned median replaces the default.
     props/lib-props.js learns a price multiplier from two quotes because a
     quote for one prop is a fairly stable thing. A day's page count is not:
     a dialogue day and a stunt day differ by three times, and the median of
     two numbers is only their mean. Three is the smallest count where the
     median is a real order statistic — one bad day can no longer move it on
     its own. */
  var MIN_PACE_EVIDENCE = 3;

  function int(v) { var n = parseInt(v, 10); return isFinite(n) ? n : 0; }
  function numOr(v, dflt) { var n = parseFloat(v); return isFinite(n) ? n : dflt; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function round2(v) { return Math.round(v * 100) / 100; }
  function medianOf(arr) {
    var s = (arr || []).slice().sort(function (a, b) { return a - b; });
    if (!s.length) return 0;
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* The cast-week arithmetic lives in timeline/timeline-budget.js and is
     called from here. Load order is a runtime contract on this page
     (producer/index.html loads timeline-budget.js first), so a missing
     dependency throws instead of quietly restating the maths. */
  function BUD() {
    var b = root.SBBudget;
    if (!b || !b.castWeeks) throw new Error('producer/schedule-board.js requires timeline/timeline-budget.js');
    return b;
  }

  function formatEighths(e) {
    e = Math.max(0, Math.round(e));
    var whole = Math.floor(e / 8), rem = e % 8;
    if (!whole && !rem) return '0';
    if (!whole) return rem + '/8';
    if (!rem) return String(whole);
    return whole + ' ' + rem + '/8';
  }

  /* Parse "15", "1 7/8", "7/8", "2.5" (pages) → eighths. */
  function parseEighths(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var m = s.match(/^(\d+)\s+(\d)\/8$/);
    if (m) return (+m[1]) * 8 + (+m[2]);
    m = s.match(/^(\d)\/8$/);
    if (m) return +m[1];
    m = s.match(/^(\d+(?:\.\d+)?)$/);
    if (m) {
      var n = parseFloat(m[1]);
      return s.indexOf('.') >= 0 ? Math.max(1, Math.round(n * 8)) : Math.max(1, Math.round(n));
    }
    return null;
  }

  var TAG_KEYS = ['stunts', 'sfx', 'vfx', 'water', 'animals', 'vehicles'];
  var TAG_LABEL = { stunts: 'ST', sfx: 'SFX', vfx: 'VFX', water: 'WTR', animals: 'ANM', vehicles: 'VEH' };

  function ensureScene(sc) {
    sc.tags = sc.tags || {};
    sc.extras = sc.extras || 0;
    sc.notes = sc.notes || '';
    return sc;
  }

  function locOf(heading) {
    return String(heading || '')
      .replace(/^\s*(?:\d+[A-Z]?[.\s-]*)?(INT\.|EXT\.|INT\/EXT\.|I\/E\.?)\s*/i, '')
      .split(/\s+[-—–]\s+/)[0].trim().toUpperCase() || 'UNKNOWN';
  }

  /* Build scene strips from the timeline's saved script. */
  function scenesFromScript(st) {
    var chunks = SBBudget.splitScenes(st.scriptText || '');
    if (chunks.length < 2 && (st.clips || []).length) {
      // No sluglines — fall back to one strip per unique clip heading
      var seen = {}, out = [];
      (st.clips || []).forEach(function (c) {
        var h = String(c.heading || '').trim() || 'Scene';
        if (seen[h]) { seen[h].eighths += 1; return; }
        seen[h] = { heading: h, eighths: 1, text: c.description || '' };
        out.push(seen[h]);
      });
      chunks = out;
    }
    var analysis = SBBudget.analyze(st);
    var castByScene = {};
    Object.keys(analysis.sceneCast || {}).forEach(function (name) {
      analysis.sceneCast[name].forEach(function (i) {
        (castByScene[i] = castByScene[i] || []).push(name);
      });
    });
    return chunks.map(function (sc, i) {
      return {
        id: 'sc' + (i + 1),
        num: i + 1,
        heading: sc.heading || ('Scene ' + (i + 1)),
        eighths: sc.eighths || 1,
        dn: /\b(NIGHT|DUSK|EVENING|MIDNIGHT|PRE-DAWN)\b/i.test(sc.heading || '') ? 'night' : 'day',
        cast: castByScene[i] || [],
        day: -1
      };
    });
  }

  /* Fill days at the target eighths/day pace.
   * mode 'script' (default): script order. mode 'location': group scenes by
   * location (then day/night) first — fewer company moves, the way ADs
   * actually board a show. Scene numbers are preserved either way.
   * pagesPerDay comes from the CALLER (resolvePace decides learned vs
   * default vs what the user typed) so this stays a pure fill. */
  function autoScheduleModel(scenes, pagesPerDay, mode) {
    var perDay = Math.max(1, (pagesPerDay || DEFAULT_PACE) * 8);
    var order = scenes.slice();
    if (mode === 'location') {
      order.sort(function (a, b) {
        var la = locOf(a.heading), lb = locOf(b.heading);
        if (la !== lb) return la < lb ? -1 : 1;
        if (a.dn !== b.dn) return a.dn === 'day' ? -1 : 1; // shoot day work before night per location
        return a.num - b.num;
      });
    }
    var day = 0, used = 0;
    order.forEach(function (sc) {
      if (used > 0 && used + sc.eighths > perDay) { day++; used = 0; }
      sc.day = day;
      used += sc.eighths;
    });
    return scenes;
  }

  /* Board-derived overrides for the budget estimator: exact cast spans from
   * real day assignments, and special-unit day counts from breakdown tags.
   * Returns {} when the board has nothing scheduled.
   * opts {daysPerWeek, castRules} — the contract terms the DOOD honours. */
  function boardOverridesModel(scenes, opts) {
    opts = opts || {};
    var scheduled = scenes.filter(function (s) { return s.day >= 0; });
    if (!scheduled.length) return {};
    var m = doodMatrix(scenes, opts);
    var castDood = {};
    m.rows.forEach(function (r) { castDood[r.name] = r.weeks; });
    function tagDays(key) {
      var days = {};
      scheduled.forEach(function (sc) { if (sc.tags && sc.tags[key]) days[sc.day] = 1; });
      return Object.keys(days).length;
    }
    var anyTags = scheduled.some(function (sc) {
      return (sc.tags && TAG_KEYS.some(function (k) { return sc.tags[k]; })) || sc.extras > 0;
    });
    var out = { castDood: castDood };
    if (opts.daysPerWeek) out.daysPerWeek = opts.daysPerWeek;
    if (anyTags) {
      out.unitOverrides = {
        stuntDays: tagDays('stunts'),
        pyroDays: tagDays('sfx'),
        waterDays: tagDays('water'),
        animalDays: tagDays('animals'),
        extrasDays: scheduled.reduce(function (a, sc) { return a + (sc.extras || 0); }, 0)
      };
    }
    return out;
  }

  /* DOOD matrix: rows per cast member, one column per shoot day. Letters
   * COMPOSE, so one cell can say everything true of that day:
   *   S start · P pick-up (re-engaged after a drop) · W work
   *   D drop (released after this day) · F finish
   *   H hold — an idle day inside an engagement, still billed
   *   — dropped — an idle day the production released, NOT billed
   * so SW, W, WF, SWF read as they always did, and SWD ("starts, works and
   * is dropped") or PWF ("picked up, works, finishes") can now be said at all.
   * Which idle stretches qualify as a drop is SBBudget.castWeeks' call, not
   * this file's: the codes and the money have to come from one answer. */
  function doodMatrix(scenes, opts) {
    opts = opts || {};
    var rules = { daysPerWeek: opts.daysPerWeek || 5 };
    if (opts.castRules) Object.keys(opts.castRules).forEach(function (k) { rules[k] = opts.castRules[k]; });
    var byActor = {};
    var maxDay = -1;
    scenes.forEach(function (sc) {
      if (sc.day < 0) return;
      if (sc.day > maxDay) maxDay = sc.day;
      (sc.cast || []).forEach(function (name) {
        (byActor[name] = byActor[name] || []).push(sc.day);
      });
    });
    var days = maxDay + 1;
    var rows = Object.keys(byActor).map(function (name) {
      var w = BUD().castWeeks(byActor[name], rules);
      var works = {};
      byActor[name].forEach(function (d) { works[d] = 1; });
      var dropAt = {}, pickAt = {}, held = {};
      w.segments.forEach(function (s, i) {
        if (i > 0) pickAt[s.first] = 1;
        for (var d = s.first; d <= s.last; d++) if (!works[d]) held[d] = 1;
      });
      w.drops.forEach(function (dr) { dropAt[dr.after] = 1; });
      var first = w.segments.length ? w.segments[0].first : -1;
      var last = w.segments.length ? w.segments[w.segments.length - 1].last : -1;
      /* Codes compose rather than branch, because a day can be more than one
         thing at once: the first day of a one-day role is SWF, and the day a
         performer starts AND is dropped is SWD. A branch chain has to pick,
         and picking is how "start" hid the drop that was owed notice. */
      var codes = [];
      for (var d = 0; d < days; d++) {
        if (d < first || d > last) { codes.push(''); continue; }
        if (!works[d]) { codes.push(held[d] ? 'H' : '—'); continue; }
        var c = '';
        if (d === first) c += 'S';
        if (pickAt[d]) c += 'P';
        c += 'W';
        if (dropAt[d]) c += 'D';
        if (d === last) c += 'F';
        codes.push(c);
      }
      return {
        name: name, codes: codes,
        tot: w.spanDays, wrk: w.workDays, hld: w.holdDays, drp: w.droppedDays,
        wks: w.spanWeeks, sav: w.savedWeeks, drops: w.drops.length,
        weeks: w                       // the full castWeeks answer, for the estimator
      };
    });
    rows.sort(function (a, b) { return b.wrk - a.wrk || a.name.localeCompare(b.name); });
    return {
      days: days, rows: rows, rules: rules,
      savedWeeks: rows.reduce(function (a, r) { return a + r.sav; }, 0),
      drops: rows.reduce(function (a, r) { return a + r.drops; }, 0)
    };
  }

  /* ══ the schedule learning loop ═══════════════════════════════════════
     Planned eighths per day have always been in this board. What was actually
     shot has been in the take logs since T6 landed CShootDays.takesOn. Nobody
     compared them, so the shipped 4.5 pages/day survived every film it was
     wrong about.

     The observation learned from is RAW — the eighths a wrapped day actually
     achieved. It is not a ratio against the plan, and not a correction to a
     previous correction: it does not depend on the pace that was planned, so
     the learned number cannot chase its own output. (This is the shape
     props/lib-props.js recordQuote uses — learn from the raw value, report
     the count behind it. It is deliberately NOT the shape of learn.js's
     budgetSummary, which averages the size of its own corrections.)          */

  /* Every take names a scene. Map it back to a strip and count that scene's
     eighths ONCE, however many takes it took — counting per take would
     measure coverage, not pages. Scenes are matched against the WHOLE board,
     not just the day's own strips: a day that picks up a scene scheduled
     elsewhere really did shoot those pages.

     ONCE MEANS ONCE FOR THE PRODUCTION, not once per day. Deduplicating
     inside a single call and then matching against the whole board is a
     contradiction, and it inflated without bound: a scene re-shot on three
     days was counted three times, so three days holding 40 real eighths
     reported achieved 16/40/40 and the median learned 5 pages/day for a show
     running 1.67. A pure pick-up day — no strips of its own, takes on scenes
     already in the can — reported the entire board.

     `credited` is the running set of strip ids the production has already
     been paid for, in day order. It is READ AND WRITTEN by this function, so
     the caller (paceRowsModel) hands the same object down the days and each
     scene's pages land on the first wrapped day that shot them. Scenes seen
     again come back as `pickupIds`: real work, reported, worth zero NEW
     pages, because pace answers "how many days to cover the script". */
  function achievedEighths(scenes, takes, credited) {
    var byKey = {};
    (scenes || []).forEach(function (sc) {
      byKey[String(sc.num).trim().toUpperCase()] = sc;
      if (sc.id) byKey[String(sc.id).trim().toUpperCase()] = sc;
    });
    var already = credited || {};
    var hit = {}, total = 0, ids = [], pickupIds = [], matched = 0;
    (takes || []).forEach(function (t) {
      var key = String((t && t.scene) || '').trim().toUpperCase();
      if (!key) return;
      var sc = byKey[key];
      if (!sc) return;
      matched++;
      var id = String(sc.id || sc.num);
      if (hit[id]) return;
      hit[id] = 1;
      if (already[id]) { pickupIds.push(id); return; }
      already[id] = 1;
      ids.push(id);
      total += Math.max(0, +sc.eighths || 0);
    });
    return { eighths: total, sceneIds: ids, pickupIds: pickupIds,
             takes: (takes || []).length, matchedTakes: matched };
  }

  /* One row per WRAPPED day. A mid-shoot partial day looks like catastrophic
     underperformance — half the pages, because half the day is still ahead —
     and would drag the median down for the rest of the show. Only a day the
     production has marked wrapped is evidence, and marking it is a control
     that ships: /today/ wraps the day, and the board's day header toggles it.

     Days are walked in INDEX ORDER, carrying one `credited` set, so a scene's
     pages are counted on the first wrapped day that shot them and a later
     re-shoot of the same scene reports 0 new pages and its pick-ups instead.
     input {board, shootDays, takesFor(dayRecord) → [take]} */
  function paceRowsModel(input) {
    input = input || {};
    var board = input.board || {};
    var scenes = board.scenes || [];
    var takesFor = typeof input.takesFor === 'function' ? input.takesFor : function () { return []; };
    var wrapped = (input.shootDays || []).filter(function (rec) { return rec && rec.wrapped; })
      .slice().sort(function (x, y) { return int(x.dayIdx) - int(y.dayIdx); });
    var credited = {};
    var out = wrapped.map(function (rec) {
      var d = int(rec.dayIdx);
      var planned = scenes.filter(function (s) { return s.day === d; })
        .reduce(function (a, s) { return a + Math.max(0, +s.eighths || 0); }, 0);
      var a = achievedEighths(scenes, takesFor(rec), credited);
      return { dayIdx: d, date: rec.date || '', plannedEighths: planned,
               achievedEighths: a.eighths, sceneIds: a.sceneIds,
               pickupIds: a.pickupIds, takeCount: a.takes };
    });
    return out;
  }

  /* Idempotent by dayIdx: re-opening the page never double-counts a day, and
     re-wrapping a day with more takes replaces its row rather than adding a
     second one.

     `seenIdx` is every day index this pass actually examined — the days that
     have a record right now. A day inside it with no row was examined and is
     NOT wrapped, so its old row is retracted: without that, un-wrapping a day
     marked by mistake left its numbers in the log forever and the learned
     pace could never be walked back. A day outside seenIdx was not examined
     at all (its record is gone), and its row is left alone rather than
     deleted on the strength of a question nobody asked. Omit seenIdx and
     nothing is pruned, which is the old behaviour. */
  function mergePaceLog(log, rows, seenIdx) {
    var seen = null;
    if (seenIdx != null) {
      seen = {};
      (Array.isArray(seenIdx) ? seenIdx : []).forEach(function (v) { seen[int(v)] = 1; });
    }
    var keep = {};
    (rows || []).forEach(function (r) { if (r && r.dayIdx != null) keep[int(r.dayIdx)] = 1; });
    var by = {};
    (Array.isArray(log) ? log : []).forEach(function (r) {
      if (!r || r.dayIdx == null) return;
      var d = int(r.dayIdx);
      if (seen && seen[d] && !keep[d]) return;      // examined, no longer wrapped
      by[d] = r;
    });
    (rows || []).forEach(function (r) { if (r && r.dayIdx != null) by[int(r.dayIdx)] = r; });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return int(a.dayIdx) - int(b.dayIdx); });
  }

  /* Is this row evidence about the pace? A wrapped day whose take log is
     EMPTY is not — nobody recorded what happened, and reading that as "zero
     pages" would teach the board that a production which does not log takes
     shoots nothing. A wrapped day that logged takes and achieved no NEW pages
     IS evidence: it is a pick-up or re-shoot day, it consumed a shoot day,
     and it covered none of the remaining script. Rows written before
     takeCount existed fall back to the old test. */
  function paceRowIsEvidence(r) {
    if (!r) return false;
    if (r.takeCount != null) return int(r.takeCount) > 0;
    return r.achievedEighths > 0;
  }

  /* The learned pace, and the count it stands on. At learnedN below minN the
     DEFAULT is returned and `learned` is false — an unlearned number is never
     handed back dressed as a learned one. */
  function learnedPace(rows, opts) {
    opts = opts || {};
    var fallback = numOr(opts.fallback, DEFAULT_PACE);
    var minN = opts.minN > 0 ? Math.round(opts.minN) : MIN_PACE_EVIDENCE;
    var vals = (rows || []).filter(paceRowIsEvidence)
      .map(function (r) { return Math.max(0, +r.achievedEighths || 0); });
    var n = vals.length;
    var med = n ? round2(medianOf(vals) / 8) : null;
    if (n < minN) {
      return { pagesPerDay: fallback, learnedN: n, minN: minN, learned: false,
               source: 'default', median: med, defaultPace: DEFAULT_PACE };
    }
    return { pagesPerDay: clamp(med, 1, 12), learnedN: n, minN: minN, learned: true,
             source: 'wrapped days', median: med, defaultPace: DEFAULT_PACE };
  }

  /* What the board should actually schedule at. A pace the user typed always
     wins — learning informs, it does not overrule. */
  function resolvePace(board, rows) {
    var lp = learnedPace(rows, { fallback: DEFAULT_PACE });
    var userSet = !!(board && board.paceSet && board.pace > 0);
    return { pace: userSet ? board.pace : lp.pagesPerDay, userSet: userSet,
             learnedN: lp.learnedN, source: userSet ? 'you set it' : lp.source, learned: lp };
  }

  function paceLabel(res) {
    var lp = res.learned;
    var was = lp.learned
      ? ' · your last ' + lp.learnedN + ' wrapped days ran ' + lp.median + ' pg/day'
      : '';
    if (res.userSet) return 'target ' + round2(res.pace) + ' pg/day — you set it' + was;
    if (lp.learned) return 'target ' + round2(res.pace) + ' pg/day — learned from ' +
      lp.learnedN + ' wrapped day' + (lp.learnedN === 1 ? '' : 's');
    if (!lp.learnedN) return 'target ' + round2(res.pace) + ' pg/day — the shipped default; nothing learned yet (no wrapped days)';
    return 'target ' + round2(res.pace) + ' pg/day — the shipped default; ' + lp.learnedN +
      ' wrapped day' + (lp.learnedN === 1 ? '' : 's') + ' so far, ' + lp.minN + ' needed to learn';
  }

  /* ══ the call sheet ═══════════════════════════════════════════════════
     Finding 4: three departments independently named the call sheet as their
     delivery point, and it printed a DOOD letter per cast member and nothing
     else. Every missing field already existed ONE HOP AWAY and was simply
     never asked for. Nothing below is a new box for somebody to retype a
     number that is already in the platform:

       real date · unit · wrapped     SB_ShootDays_v1  (T6's CShootDays)
       sunrise/sunset/golden hours    tools/lib-sun.js over SB_ShootPlan_v1's
                                      pin AND its civil offset (T2's fix — a
                                      call sheet in the wrong timezone is
                                      worse than no call sheet)
       hospital · parking · load-in   SB_ScoutBook_v1  (the scout book)
       per-department crew calls      SB_Crew_v1       (the crew directory)
       walkie channels                the departments that show actually has
       meals · wrap · turnaround      TMoney.TC_DEFAULTS — the SAME rules the
                                      timecard engine bills against, so the
                                      sheet cannot promise a meal the payroll
                                      engine then penalises
       individual cast calls          the board's own strips: the eighths
                                      scheduled before a performer's first
                                      scene, at this day's own pace
       advance schedule               the next two days on the board

     Pure: no clock, no store. The page hands it what it has, and anything it
     was not handed comes back as a stated gap rather than a blank line. */

  var CALL_RULES = {
    shootingCallMin: 30,   // crew call → first shot
    hmuMin: 45,            // make-up + hair before a performer is on set
    wardrobeMin: 15,
    breakfastMin: 30,      // served this long BEFORE crew call
    /* Department pre-calls relative to the general crew call. Art dresses and
       G&E pre-rigs before the unit arrives; camera and sound call with it. */
    deptPreCall: { Art: -60, 'G&E': -30, HMU: -60, Wardrobe: -45, Production: -30,
                   Camera: 0, Sound: 0, Edit: 0, Post: 0, Other: 0 }
  };

  /* Standard channel order. Only departments this show actually crews get a
     channel, so the card is the production's, not a template's. */
  var WALKIE_ORDER = [
    { dept: 'Production', use: 'Production — 1st AD, 2nd AD, PAs' },
    { dept: 'Camera', use: 'Camera' },
    { dept: 'G&E', use: 'Grip & electric' },
    { dept: 'Sound', use: 'Sound' },
    { dept: 'Art', use: 'Art & set dressing' },
    { dept: 'Wardrobe', use: 'Wardrobe' },
    { dept: 'HMU', use: 'Hair & make-up' },
    { dept: 'Other', use: 'Transportation, locations & everyone else' }
  ];

  /* '7:00 AM', '7A', '07:00', '0700' → minutes past midnight, or null. */
  function clockMins(v) {
    var s = String(v == null ? '' : v).trim().toUpperCase().replace(/\./g, '');
    if (!s) return null;
    var m = s.match(/^(\d{1,2})[:]?(\d{2})?\s*(AM|PM|A|P)?$/);
    if (!m) return null;
    var h = +m[1], mi = +(m[2] || 0), ap = m[3] ? m[3].charAt(0) : '';
    if (h > 23 || mi > 59) return null;
    if (ap === 'A') { if (h === 12) h = 0; }
    else if (ap === 'P') { if (h < 12) h += 12; }
    return h * 60 + mi;
  }
  function clockFmt(mins) {
    if (mins == null || !isFinite(mins)) return '';
    var t = ((Math.round(mins) % 1440) + 1440) % 1440;
    var h = Math.floor(t / 60), mi = t % 60, ap = h >= 12 ? 'PM' : 'AM';
    var hh = h % 12 || 12;
    return hh + ':' + ('0' + mi).slice(-2) + ' ' + ap + (mins >= 1440 ? ' +1' : '');
  }
  function round5(m) { return Math.round(m / 5) * 5; }

  /* Loose set-name match between a board slugline and a scout-book location —
     the same shape /today/ uses, kept here so the call sheet and the day view
     name the same hospital. */
  function locMatches(setName, locName) {
    var a = String(setName || '').toLowerCase(), b = String(locName || '').toLowerCase();
    if (!a || !b) return false;
    return a.indexOf(b.slice(0, 8)) >= 0 || b.indexOf(a.slice(0, 8)) >= 0;
  }

  function sceneEighths(scs) {
    return scs.reduce(function (a, s) { return a + Math.max(0, +s.eighths || 0); }, 0);
  }

  /* A DOOD letter is a code an AD reads; the call sheet goes to everyone, so
     it spells the code out. Composed the same way doodMatrix composes it. */
  function statusOf(code) {
    var c = String(code || '');
    if (!c) return '';
    if (c === 'H') return 'HOLD';
    if (c === '—') return 'DROPPED';
    var parts = [];
    parts.push(c.indexOf('P') >= 0 ? 'PICK-UP' : c.indexOf('S') >= 0 ? 'START' : 'WORK');
    if (c.indexOf('D') >= 0) parts.push('DROP AFTER TODAY');
    if (c.indexOf('F') >= 0) parts.push('FINISH');
    return parts.join(' · ');
  }

  /* input {board, day, shootDays, plan, scout, crew, tc, sun, project,
            rules, dood} */
  function callSheetModel(input) {
    input = input || {};
    var board = input.board || {};
    var d = int(input.day);
    var scenes = (board.scenes || []).filter(function (s) { return s.day === d; });
    var meta = (board.dayMeta || {})[d] || {};
    var R = {}, k;
    for (k in CALL_RULES) if (Object.prototype.hasOwnProperty.call(CALL_RULES, k)) R[k] = CALL_RULES[k];
    if (input.rules) for (k in input.rules) R[k] = input.rules[k];
    var tc = input.tc || null;
    var gaps = [];

    /* ── identity: which day is this, really ───────────────────────── */
    var rec = null;
    if (root.CShootDays && input.shootDays) rec = root.CShootDays.byIndex(input.shootDays, d);
    var date = (rec && rec.date) || '';
    var weekday = date && root.CShootDays ? root.CShootDays.weekday(date) : '';
    if (!date) gaps.push('No calendar date — set a start date in the day planner so SB_ShootDays_v1 can date this day.');

    var dayCount = (board.scenes || []).reduce(function (m, s) { return Math.max(m, s.day); }, -1) + 1;

    /* ── the clock ─────────────────────────────────────────────────── */
    var call = clockMins(meta.call);
    var times = { general: null, shooting: null, breakfast: null, lunch: null,
                  lunchBack: null, secondMeal: null, estWrap: null, nextEarliest: null };
    if (call == null) {
      gaps.push('No general crew call — every time below is derived from it.');
    } else {
      times.general = call;
      times.shooting = call + R.shootingCallMin;
      times.breakfast = call - R.breakfastMin;
      if (tc) {
        times.lunch = call + tc.mealAfter * 60;
        times.lunchBack = times.lunch + tc.mealLenMin;
        times.secondMeal = times.lunchBack + tc.mealAfter * 60;
        times.estWrap = call + tc.dtAfter * 60 + tc.mealLenMin;
        times.nextEarliest = times.estWrap + tc.turnaroundHrs * 60;
      } else {
        gaps.push('tools/lib-money.js is not loaded, so meal, wrap and turnaround times could not be derived from TMoney.TC_DEFAULTS.');
      }
    }

    /* ── cast: DOOD status + an individual call per performer ──────── */
    var m = input.dood || doodMatrix(board.scenes || [], { daysPerWeek: board.daysPerWeek });
    var dayEighths = sceneEighths(scenes);
    var shootMinutes = (times.shooting != null && times.estWrap != null)
      ? Math.max(60, times.estWrap - times.shooting) : null;
    function firstSceneOffset(name) {
      var before = 0;
      for (var i = 0; i < scenes.length; i++) {
        if ((scenes[i].cast || []).indexOf(name) >= 0) return before;
        before += Math.max(0, +scenes[i].eighths || 0);
      }
      return null;
    }
    var castCalls = m.rows.filter(function (r) { return r.codes[d] && r.codes[d] !== '—'; }).map(function (r) {
      var code = r.codes[d];
      var working = code !== 'H';
      var before = working ? firstSceneOffset(r.name) : null;
      var onSet = null, cCall = null;
      if (working && before != null && shootMinutes != null && dayEighths > 0) {
        onSet = round5(times.shooting + shootMinutes * (before / dayEighths));
        cCall = round5(onSet - (R.hmuMin + R.wardrobeMin));
      }
      var over = (meta.castCalls || {})[r.name];
      if (clockMins(over) != null) { cCall = clockMins(over); }
      return {
        name: r.name, code: code, working: working,
        status: statusOf(code),
        call: cCall, onSet: onSet,
        callText: clockFmt(cCall), onSetText: clockFmt(onSet),
        hmu: cCall == null ? '' : clockFmt(cCall),
        remark: code.indexOf('D') >= 0 ? 'Drop notice due ' + (dropNoticeText(r, d) || 'today') : ''
      };
    });
    function dropNoticeText(row, dayIdx) {
      var hit = null;
      (row.weeks && row.weeks.drops || []).forEach(function (dr) { if (dr.after === dayIdx) hit = dr; });
      if (!hit || !root.CShootDays || !input.shootDays) return '';
      var nb = root.CShootDays.byIndex(input.shootDays, hit.noticeBy);
      return nb && nb.date ? nb.date : 'Day ' + (hit.noticeBy + 1);
    }

    /* ── crew: one call per department, from the directory ─────────── */
    var crewRows = Array.isArray(input.crew) ? input.crew : (input.crew && input.crew.rows) || [];
    var byDept = {};
    crewRows.forEach(function (c) {
      var dept = String((c && c.dept) || 'Other').trim() || 'Other';
      (byDept[dept] = byDept[dept] || []).push(String((c && c.name) || '').trim() || '—');
    });
    var deptCalls = Object.keys(byDept).sort().map(function (dept) {
      var off = R.deptPreCall[dept] == null ? 0 : R.deptPreCall[dept];
      var t = call == null ? null : call + off;
      return { dept: dept, offsetMin: off, call: t, callText: clockFmt(t),
               count: byDept[dept].length, names: byDept[dept] };
    });
    if (!crewRows.length) gaps.push('No crew in the directory — department calls and the walkie card come from SB_Crew_v1 (Tools → Crew).');

    var walkie = [];
    WALKIE_ORDER.forEach(function (w) {
      if (!byDept[w.dept] && w.dept !== 'Production') return;
      walkie.push({ ch: walkie.length + 1, dept: w.dept, use: w.use, count: (byDept[w.dept] || []).length });
    });

    /* ── locations: the scout book's own answers ───────────────────── */
    var sets = [];
    scenes.forEach(function (sc) { var L = locOf(sc.heading); if (sets.indexOf(L) < 0) sets.push(L); });
    var scoutLocs = (input.scout && (input.scout.locations || input.scout.items)) || [];
    if (!Array.isArray(scoutLocs)) scoutLocs = [];
    var locations = sets.map(function (name) {
      var hit = null;
      scoutLocs.forEach(function (L) { if (!hit && L && locMatches(name, L.name)) hit = L; });
      return {
        set: name,
        name: hit ? (hit.name || name) : name,
        address: hit ? hit.address || '' : '',
        hospital: hit ? hit.hospital || '' : '',
        hospitalAddress: hit ? hit.hospitalAddress || '' : '',
        parking: hit ? hit.parking || '' : '',
        loadIn: hit ? hit.loadIn || '' : '',
        matched: !!hit
      };
    });
    /* One hospital must be on the sheet even when no set matched a card —
       the nearest-hospital line is the reason this block exists. */
    var hospital = null;
    locations.forEach(function (L) { if (!hospital && L.hospital) hospital = { name: L.hospital, address: L.hospitalAddress, from: L.name }; });
    if (!hospital) {
      scoutLocs.forEach(function (L) {
        if (!hospital && L && L.hospital) hospital = { name: L.hospital, address: L.hospitalAddress || '', from: L.name || '', fallback: true };
      });
    }
    if (!hospital) gaps.push('No nearest hospital on file — set it per location in the Scout Book. It belongs on every call sheet.');

    /* ── sun: computed here, in this browser, at the LOCATION's clock ─ */
    var sun = null;
    var plan = input.plan || {};
    var S = input.sun || root.TSun;
    if (S && date && isFinite(+plan.lat) && isFinite(+plan.lon) && plan.lat !== '' && plan.lon !== '') {
      var t = S.sunTimes(date, +plan.lat, +plan.lon);
      var tz = plan.tz == null ? S.tzOffsetFromLon(+plan.lon) : plan.tz;
      sun = {
        sunrise: S.fmtLocal(t.sunrise, tz), sunset: S.fmtLocal(t.sunset, tz),
        goldenAM: S.fmtLocal(t.goldenEndAM, tz), goldenPM: S.fmtLocal(t.goldenStartPM, tz),
        dawn: S.fmtLocal(t.dawn, tz), dusk: S.fmtLocal(t.dusk, tz),
        daylight: S.daylightHours(t),
        tzLabel: S.tzLabel(tz),
        tzEstimated: plan.tzSource !== 'api'
      };
    } else if (date) {
      gaps.push('No location pin — sunrise, sunset and golden hour need a lat/lon on the day planner.');
    }

    /* ── the advance schedule: what tomorrow actually is ───────────── */
    var advance = [];
    for (var nd = d + 1; nd < dayCount && advance.length < 2; nd++) {
      var next = (board.scenes || []).filter(function (s) { return s.day === nd; });
      if (!next.length) continue;
      var nrec = (root.CShootDays && input.shootDays) ? root.CShootDays.byIndex(input.shootDays, nd) : null;
      var nsets = [];
      next.forEach(function (sc) { var L = locOf(sc.heading); if (nsets.indexOf(L) < 0) nsets.push(L); });
      var nmeta = (board.dayMeta || {})[nd] || {};
      var ncall = clockMins(nmeta.call);
      advance.push({
        dayIdx: nd, date: (nrec && nrec.date) || '',
        weekday: (nrec && nrec.date && root.CShootDays) ? root.CShootDays.weekday(nrec.date) : '',
        sets: nsets, scenes: next.map(function (s) { return s.num; }),
        eighths: sceneEighths(next), call: ncall, callText: clockFmt(ncall),
        /* Turnaround is a rule the payroll engine bills on; a call sheet that
           quietly breaks it is how a forced call gets paid for. */
        turnaroundShort: !!(advance.length === 0 && ncall != null && times.nextEarliest != null &&
                            ncall + 1440 < times.nextEarliest)
      });
    }

    var sheet = {
      dayIdx: d, dayNumber: d + 1, dayCount: dayCount,
      title: input.project || 'Untitled Film',
      date: date, weekday: weekday,
      unit: (rec && rec.unit) || '', wrapped: !!(rec && rec.wrapped),
      times: times,
      timeText: {
        general: clockFmt(times.general), shooting: clockFmt(times.shooting),
        breakfast: clockFmt(times.breakfast), lunch: clockFmt(times.lunch),
        lunchBack: clockFmt(times.lunchBack), secondMeal: clockFmt(times.secondMeal),
        estWrap: clockFmt(times.estWrap), nextEarliest: clockFmt(times.nextEarliest)
      },
      mealRule: tc ? tc.mealAfter + ' hrs from call, ' + tc.mealLenMin + ' min' : '',
      turnaroundRule: tc ? tc.turnaroundHrs + ' hrs' : '',
      scenes: scenes.map(function (sc) {
        return { num: sc.num, heading: sc.heading, dn: sc.dn, eighths: sc.eighths,
                 cast: (sc.cast || []).slice(), extras: sc.extras || 0,
                 tags: TAG_KEYS.filter(function (kk) { return sc.tags && sc.tags[kk]; }) };
      }),
      eighths: dayEighths,
      castCalls: castCalls, deptCalls: deptCalls, walkie: walkie,
      locations: locations, hospital: hospital, sun: sun, advance: advance,
      notes: meta.notes || '',
      gaps: gaps
    };
    sheet.signature = sheetSignature(sheet);
    sheet.revision = revisionFor(meta, sheet.signature);
    return sheet;
  }

  /* What the sheet SAYS, reduced to a string. A re-print of an unchanged sheet
     is not a revision; a re-issue after something moved is. That distinction
     is the whole point of the revision letter, so it is derived rather than
     left to whoever remembers to bump it. */
  function sheetSignature(cs) {
    return [
      cs.dayIdx, cs.date, cs.unit,
      cs.timeText.general, cs.timeText.shooting,
      cs.scenes.map(function (s) { return s.num + ':' + s.eighths + ':' + s.dn; }).join(','),
      cs.castCalls.map(function (c) { return c.name + ':' + c.code + ':' + c.callText; }).join(','),
      cs.deptCalls.map(function (c) { return c.dept + ':' + c.callText; }).join(','),
      cs.locations.map(function (l) { return l.set; }).join(','),
      cs.notes
    ].join('|');
  }
  /* meta.issues = [{sig, at}] — the sheets actually sent out. */
  function revisionFor(meta, signature) {
    var issues = (meta && Array.isArray(meta.issues)) ? meta.issues : [];
    var n = issues.length;
    var last = n ? issues[n - 1] : null;
    var changed = !!(last && last.sig !== signature);
    var letterFor = function (i) {
      var s = '';
      i = Math.max(0, i);
      do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0);
      return s;
    };
    if (!n) return { n: 0, letter: '', label: 'CALL SHEET', issued: false, changed: false,
                     note: 'not yet issued' };
    if (changed) return { n: n, letter: letterFor(n - 1), label: 'CALL SHEET — REV. ' + letterFor(n - 1) + ' PENDING',
                          issued: true, changed: true,
                          note: 'changed since the ' + (n === 1 ? 'first issue' : 'last issue') + ' — re-issue to stamp Rev. ' + letterFor(n - 1) };
    return { n: n, letter: n > 1 ? letterFor(n - 2) : '', issued: true, changed: false,
             label: n > 1 ? 'CALL SHEET — REV. ' + letterFor(n - 2) : 'CALL SHEET',
             note: 'issued' + (issues[n - 1].at ? ' ' + issues[n - 1].at : '') };
  }
  /* Record an issue. Returns the new issues list — the caller persists it. */
  function issueSheet(meta, signature, whenISO) {
    var issues = (meta && Array.isArray(meta.issues)) ? meta.issues.slice() : [];
    if (issues.length && issues[issues.length - 1].sig === signature) return issues;
    issues.push({ sig: signature, at: whenISO || '' });
    if (issues.length > 26) issues = issues.slice(-26);
    return issues;
  }

  /* ── persistence ─────────────────────────────────────────────────── */
  var board = null;
  var paceRes = null;
  function normBoard(d) {
    d.scenes.forEach(ensureScene);
    d.dayMeta = d.dayMeta || {};
    d.mode = d.mode || 'script';
    d.paceLog = Array.isArray(d.paceLog) ? d.paceLog : [];
    d.daysPerWeek = clamp(int(d.daysPerWeek) || 5, 5, 7);
    /* A board saved before pace could be learned carries pace 4.5 because that
       was the default, not because anybody chose it. Anything else was typed. */
    d.paceSet = d.paceSet === true || !!(d.pace > 0 && d.pace !== DEFAULT_PACE);
    d.pace = d.pace > 0 ? d.pace : DEFAULT_PACE;
    return d;
  }
  function load() {
    try {
      var d = JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || 'null');
      if (d && Array.isArray(d.scenes)) return normBoard(d);
    } catch (e) {}
    return normBoard({ pace: DEFAULT_PACE, scenes: [], dayMeta: {}, mode: 'script' });
  }
  function persist() {
    try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(board)); } catch (e) {}
  }

  function readLS(k) {
    try { return JSON.parse((root.localStorage && root.localStorage.getItem(k)) || 'null'); } catch (e) { return null; }
  }

  /* Rebuild SB_ShootDays_v1 from the live stores, fold every wrapped day into
     the pace log, and resolve the pace the board should schedule at. */
  function syncLearning() {
    var days = [];
    if (root.CShootDays) {
      try { days = root.CShootDays.sync(root.localStorage, { board: board }); } catch (e) { days = []; }
      var stores = { takeLog: readLS(root.CShootDays.TAKELOG_KEY), dailies: readLS(root.CShootDays.DAILIES_KEY) };
      var rows = paceRowsModel({
        board: board, shootDays: days,
        takesFor: function (rec) { return root.CShootDays.takesOn(stores, rec.date); }
      });
      var merged = mergePaceLog(board.paceLog, rows);
      if (JSON.stringify(merged) !== JSON.stringify(board.paceLog)) { board.paceLog = merged; persist(); }
    }
    paceRes = resolvePace(board, board.paceLog);
    if (!paceRes.userSet && board.pace !== paceRes.pace) { board.pace = paceRes.pace; persist(); }
    return { days: days, pace: paceRes };
  }

  /* ── rendering ───────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  function stripHtml(sc) {
    ensureScene(sc);
    var badges = TAG_KEYS.filter(function (k) { return sc.tags[k]; })
      .map(function (k) { return '<span class="ps-tagchip">' + TAG_LABEL[k] + '</span>'; }).join('');
    if (sc.extras > 0) badges += '<span class="ps-tagchip">BG×' + esc(sc.extras) + '</span>';
    return '<div class="ps-strip ' + esc(sc.dn) + '" draggable="true" data-id="' + esc(sc.id) + '" title="Double-click to edit breakdown · ' + esc(sc.cast.join(', ')) + '">' +
      '<b>' + esc(sc.num) + '</b> · ' + esc(sc.heading.length > 46 ? sc.heading.slice(0, 45) + '…' : sc.heading) +
      '<div class="ps-strip-meta">' + esc(formatEighths(sc.eighths)) + ' pg' + (sc.cast.length ? ' · ' + esc(sc.cast.slice(0, 3).join(', ')) + (sc.cast.length > 3 ? ' +' + (sc.cast.length - 3) : '') : '') + ' ' + badges + '</div></div>';
  }

  function renderPaceChip() {
    var el = $('sbPaceChip');
    if (!el || !paceRes) return;
    el.textContent = paceLabel(paceRes);
    el.className = 'ps-pacechip' + (paceRes.learned.learned ? ' learned' : '');
    el.title = paceRes.learned.learned
      ? 'Median achieved pages across ' + paceRes.learned.learnedN + ' wrapped days, from the take log joined to this board through SB_ShootDays_v1.'
      : 'Wrap a shoot day in /today/ and log its takes; after ' + paceRes.learned.minN +
        ' wrapped days the target becomes the median of what those days actually achieved.';
  }

  function render() {
    var bone = $('sbBoneyard'), daysEl = $('sbDays');
    if (!bone || !daysEl) return;
    var shootDays = syncLearning().days;
    var unsched = board.scenes.filter(function (s) { return s.day < 0; });
    bone.innerHTML = unsched.map(stripHtml).join('') || '<div class="ps-empty">All scenes scheduled</div>';
    var boneMeta = $('sbBoneMeta');
    if (boneMeta) boneMeta.textContent = unsched.length ? unsched.length + ' scenes · ' + formatEighths(unsched.reduce(function (a, s) { return a + s.eighths; }, 0)) + ' pg' : '';

    var maxDay = board.scenes.reduce(function (m, s) { return Math.max(m, s.day); }, -1);
    var dayCount = Math.max(maxDay + 2, 1); // always one empty trailing day to drop into
    var targetEighths = board.pace * 8;
    var h = '';
    for (var d = 0; d < dayCount; d++) {
      var scs = board.scenes.filter(function (s) { return s.day === d; });
      var e = scs.reduce(function (a, s) { return a + s.eighths; }, 0);
      var hasCS = board.dayMeta && board.dayMeta[d] && (board.dayMeta[d].call || board.dayMeta[d].notes);
      var rec = root.CShootDays ? root.CShootDays.byIndex(shootDays, d) : null;
      var when = rec && rec.date ? root.CShootDays.weekday(rec.date) + ' ' + rec.date.slice(5) : '';
      h += '<div class="ps-day"><div class="ps-day-head"><span>Day ' + (d + 1) +
        (when ? ' <span class="ps-day-date">' + esc(when) + '</span>' : '') +
        (rec && rec.wrapped ? ' <span class="ps-wrapchip">WRAPPED</span>' : '') +
        ' <button type="button" class="ps-cs-btn' + (hasCS ? ' has' : '') + '" data-cs="' + d + '" title="Call sheet">📋</button></span>' +
        '<span class="ps-day-meta' + (e > targetEighths ? ' over' : '') + '">' + formatEighths(e) + ' / ' + formatEighths(targetEighths) + ' pg</span></div>' +
        '<div class="ps-strips" data-day="' + esc(d) + '">' + scs.map(stripHtml).join('') + '</div></div>';
    }
    daysEl.innerHTML = h;
    daysEl.querySelectorAll('.ps-cs-btn').forEach(function (b) {
      b.addEventListener('click', function (ev) { ev.stopPropagation(); openCallSheet(+b.dataset.cs); });
    });
    var paceInput = $('sbPace');
    if (paceInput && !paceRes.userSet) paceInput.value = round2(board.pace);
    renderPaceChip();
    wireDnD();
    wireEditors();
    renderDood(false);
  }

  /* ── per-scene breakdown editor (double-click a strip) ───────────── */
  function wireEditors() {
    document.querySelectorAll('#pane-schedule .ps-strip').forEach(function (el) {
      el.addEventListener('dblclick', function () { openEditor(el.dataset.id); });
    });
  }

  function openEditor(id) {
    var sc = board.scenes.find(function (s) { return s.id === id; });
    if (!sc) return;
    ensureScene(sc);
    var wrap = $('sbEditModal');
    if (!wrap) return;
    var tagBoxes = TAG_KEYS.map(function (k) {
      return '<label class="ps-tagbox"><input type="checkbox" data-tag="' + esc(k) + '"' + (sc.tags[k] ? ' checked' : '') + '> ' +
        k.charAt(0).toUpperCase() + k.slice(1) + '</label>';
    }).join('');
    wrap.querySelector('.modal-card').innerHTML =
      '<div class="modal-head"><span>Scene ' + esc(sc.num) + ' — breakdown</span><button type="button" class="tb-btn" id="sbEdClose">✕</button></div>' +
      '<div class="sbed-grid">' +
      '<label>Slugline<input id="sbEdHeading" value="' + esc(sc.heading) + '"></label>' +
      '<div class="sbed-row">' +
      '<label>Pages (eighths)<input id="sbEdEighths" value="' + esc(formatEighths(sc.eighths)) + '" placeholder="e.g. 1 7/8"></label>' +
      '<label>Day / Night<select id="sbEdDn"><option value="day"' + (sc.dn === 'day' ? ' selected' : '') + '>Day</option><option value="night"' + (sc.dn === 'night' ? ' selected' : '') + '>Night</option></select></label>' +
      '<label>Background / extras<input id="sbEdExtras" type="number" min="0" step="1" value="' + esc(sc.extras || 0) + '"></label>' +
      '</div>' +
      '<label>Cast (comma-separated)<input id="sbEdCast" value="' + esc(sc.cast.join(', ')) + '"></label>' +
      '<div class="sbed-tags">' + tagBoxes + '</div>' +
      '<label>Notes<textarea id="sbEdNotes" rows="3">' + esc(sc.notes) + '</textarea></label>' +
      '</div>' +
      '<div class="script-actions"><span class="script-meta">Tags drive the stunt/SFX/water/animal unit days and extras count in the budget seed.</span>' +
      '<div class="script-btns"><button type="button" class="tb-btn" id="sbEdDelete">Delete scene</button>' +
      '<button type="button" class="tb-btn gold" id="sbEdSave">Save</button></div></div>';
    wrap.classList.remove('hidden');
    $('sbEdClose').onclick = function () { wrap.classList.add('hidden'); };
    $('sbEdDelete').onclick = function () {
      if (!confirm('Delete scene ' + sc.num + ' from the board?')) return;
      board.scenes = board.scenes.filter(function (s) { return s.id !== sc.id; });
      wrap.classList.add('hidden');
      persist(); render();
    };
    $('sbEdSave').onclick = function () {
      sc.heading = $('sbEdHeading').value.trim() || sc.heading;
      var e = parseEighths($('sbEdEighths').value);
      if (e != null) sc.eighths = e;
      sc.dn = $('sbEdDn').value === 'night' ? 'night' : 'day';
      sc.extras = Math.max(0, parseInt($('sbEdExtras').value, 10) || 0);
      sc.cast = $('sbEdCast').value.split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
      TAG_KEYS.forEach(function (k) { sc.tags[k] = wrap.querySelector('input[data-tag="' + k + '"]').checked; });
      sc.notes = $('sbEdNotes').value;
      wrap.classList.add('hidden');
      persist(); render();
      if (root.psToast) psToast('Scene ' + sc.num + ' breakdown saved');
    };
  }

  /* ── call sheets ─────────────────────────────────────────────────── */
  function gatherCallSheet(d) {
    var days = root.CShootDays ? root.CShootDays.sync(root.localStorage, { board: board }) : [];
    return callSheetModel({
      board: board, day: d, shootDays: days,
      plan: readLS('SB_ShootPlan_v1') || {},
      scout: readLS('SB_ScoutBook_v1') || {},
      crew: readLS('SB_Crew_v1') || [],
      tc: (root.TMoney && root.TMoney.TC_DEFAULTS) || null,
      sun: root.TSun || null,
      project: (root.psProjectState ? psProjectState().projectName : '') || 'Untitled Film',
      dood: doodMatrix(board.scenes, { daysPerWeek: board.daysPerWeek })
    });
  }

  /* One <tr> from already-escaped cells. Headers are written as literals
     below rather than routed through here: a composed-HTML helper spliced
     into a markup string is exactly what scripts/scan_html_sinks.mjs cannot
     tell apart from an unescaped value, and silencing that scanner with an
     allow-list entry costs more than writing the header out. */
  function row(cells) {
    return '<tr><td>' + cells.join('</td><td>') + '</td></tr>';
  }

  function callSheetHtml(cs) {
    var h = '<div class="cs-head"><div><div class="cs-title">' + esc(cs.title) + '</div>' +
      '<div class="cs-rev">' + esc(cs.revision.label) + ' · ' + esc(cs.revision.note) + '</div></div>' +
      '<div class="cs-fields">Day ' + esc(cs.dayNumber) + ' of ' + esc(cs.dayCount) +
      (cs.date ? ' · <b>' + esc(cs.weekday) + ' ' + esc(cs.date) + '</b>' : ' · <input id="sbCsDate" placeholder="set a start date in the day planner" disabled>') +
      (cs.unit && cs.unit !== 'MAIN' ? ' · ' + esc(cs.unit) + ' UNIT' : '') +
      (cs.wrapped ? ' · <b class="cs-wrapped">WRAPPED</b>' : '') +
      ' · Crew call <input id="sbCsCall" value="' + esc(cs.timeText.general) + '" placeholder="7:00 AM"></div></div>';

    /* the clock block */
    h += '<h4>The day</h4><table class="cs-table cs-clock"><tbody>' +
      row(['Breakfast', esc(cs.timeText.breakfast) || '—', 'Crew call', '<b>' + (esc(cs.timeText.general) || '—') + '</b>']) +
      row(['Shooting call', esc(cs.timeText.shooting) || '—', 'Est. wrap', esc(cs.timeText.estWrap) || '—']) +
      row(['Lunch (' + esc(cs.mealRule || 'meal rule unavailable') + ')', esc(cs.timeText.lunch) || '—',
           'Back in', esc(cs.timeText.lunchBack) || '—']) +
      row(['2nd meal due', esc(cs.timeText.secondMeal) || '—',
           'Earliest next call (' + esc(cs.turnaroundRule || '—') + ' turnaround)', esc(cs.timeText.nextEarliest) || '—']) +
      '</tbody></table>';

    /* sun */
    if (cs.sun) {
      h += '<h4>Sun — ' + esc(cs.sun.tzLabel) + (cs.sun.tzEstimated ? ' <span class="cs-warn">(offset ESTIMATED from longitude — run the day planner once with a live forecast to pin it)</span>' : '') + '</h4>' +
        '<div class="cs-locs">Sunrise ' + esc(cs.sun.sunrise) + ' · golden AM ends ' + esc(cs.sun.goldenAM) +
        ' · golden PM starts ' + esc(cs.sun.goldenPM) + ' · sunset ' + esc(cs.sun.sunset) +
        ' · ' + esc(cs.sun.daylight) + 'h daylight</div>';
    }
    h += '<div id="sbCsWx" class="cs-locs cs-dim">Forecast — checking…</div>';

    /* scenes */
    h += '<h4>Scenes (' + esc(formatEighths(cs.eighths)) + ' pages)</h4>' +
      '<table class="cs-table">' + '<thead><tr><th>#</th><th>Set</th><th>D/N</th><th>Pgs</th><th>Cast</th></tr></thead>' + '<tbody>' +
      (cs.scenes.map(function (sc) {
        return row([esc(sc.num), esc(sc.heading), sc.dn === 'night' ? 'N' : 'D', esc(formatEighths(sc.eighths)),
          esc(sc.cast.join(', ')) + (sc.extras ? ' +' + esc(sc.extras) + ' BG' : '') +
          (sc.tags.length ? ' <span class="ps-tagchip">' +
            esc(sc.tags.map(function (t) { return TAG_LABEL[t]; }).join(' ')) + '</span>' : '')]);
      }).join('') || '<tr><td colspan="5">No scenes scheduled</td></tr>') + '</tbody></table>';

    /* cast */
    h += '<h4>Cast</h4><table class="cs-table">' +
      '<thead><tr><th>Cast</th><th>DOOD</th><th>Status</th><th>Call</th><th>On set</th><th>Remarks</th></tr></thead>' + '<tbody>' +
      (cs.castCalls.map(function (c) {
        return row([esc(c.name), esc(c.code), esc(c.status), esc(c.callText) || '—', esc(c.onSetText) || '—', esc(c.remark)]);
      }).join('') || '<tr><td colspan="6">—</td></tr>') + '</tbody></table>';

    /* crew by department */
    h += '<h4>Crew calls</h4><table class="cs-table">' +
      '<thead><tr><th>Dept</th><th>Call</th><th>Crew</th></tr></thead>' + '<tbody>' +
      (cs.deptCalls.map(function (c) {
        return row([esc(c.dept) + (c.offsetMin ? ' <span class="cs-dim">(' + esc((c.offsetMin > 0 ? '+' : '') + c.offsetMin) + ' min)</span>' : ''),
          esc(c.callText) || '—', esc(c.count) + ' · ' + esc(c.names.slice(0, 6).join(', ')) + (c.names.length > 6 ? ' +' + (c.names.length - 6) : '')]);
      }).join('') || '<tr><td colspan="3">No crew directory yet</td></tr>') + '</tbody></table>';

    /* walkies */
    if (cs.walkie.length) {
      h += '<h4>Walkie channels</h4><div class="cs-locs">' +
        cs.walkie.map(function (w) { return '<b>' + esc(w.ch) + '</b> ' + esc(w.use); }).join(' · ') + '</div>';
    }

    /* locations + safety */
    h += '<h4>Sets &amp; locations</h4><table class="cs-table">' +
      '<thead><tr><th>Set</th><th>Address</th><th>Parking</th><th>Load-in</th></tr></thead>' + '<tbody>' +
      (cs.locations.map(function (L) {
        return row([esc(L.name) + (L.matched ? '' : ' <span class="cs-dim">(no scout card)</span>'),
          esc(L.address) || '—', esc(L.parking) || '—', esc(L.loadIn) || '—']);
      }).join('') || '<tr><td colspan="4">—</td></tr>') + '</tbody></table>';

    h += '<h4>Nearest hospital</h4><div class="cs-hosp">' + (cs.hospital
      ? '<b>' + esc(cs.hospital.name) + '</b>' + (cs.hospital.address ? ' — ' + esc(cs.hospital.address) : '') +
        (cs.hospital.fallback ? ' <span class="cs-warn">(from ' + esc(cs.hospital.from) + ' — no scout card matched today\'s sets)</span>' : '')
      : '<span class="cs-warn">Not on file — set it per location in the Scout Book.</span>') + '</div>';

    /* advance */
    if (cs.advance.length) {
      h += '<h4>Advance schedule</h4><table class="cs-table">' +
        '<thead><tr><th>Day</th><th>Date</th><th>Sets</th><th>Scenes</th><th>Pgs</th><th>Call</th></tr></thead>' + '<tbody>' +
        cs.advance.map(function (a) {
          return row(['Day ' + esc(a.dayIdx + 1), esc((a.weekday ? a.weekday + ' ' : '') + a.date) || '—',
            esc(a.sets.join(' · ')), esc(a.scenes.join(', ')), esc(formatEighths(a.eighths)),
            (esc(a.callText) || '—') + (a.turnaroundShort ? ' <span class="cs-warn">SHORT TURNAROUND</span>' : '')]);
        }).join('') + '</tbody></table>';
    }

    h += '<h4>Notes</h4><textarea id="sbCsNotes" rows="3" class="script-editor" style="width:100%">' + esc(cs.notes) + '</textarea>';

    if (cs.gaps.length) {
      h += '<div class="cs-gaps"><b>Not on this sheet, and why:</b><ul>' +
        cs.gaps.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul></div>';
    }
    return h;
  }

  function openCallSheet(d) {
    var wrap = $('sbCallModal');
    if (!wrap) return;
    var meta = (board.dayMeta[d] = board.dayMeta[d] || { call: '', date: '', notes: '' });
    var cs = gatherCallSheet(d);
    wrap.querySelector('.modal-card').innerHTML =
      '<div class="modal-head"><span>Call sheet — Day ' + esc(d + 1) + '</span><button type="button" class="tb-btn" id="sbCsClose">✕</button></div>' +
      '<div id="sbCsSheet" class="cs-sheet"></div>' +
      '<div class="script-actions"><span class="script-meta">SW start · W work · H hold · WD work then drop · PW pick-up · WF finish · — dropped (not billed)</span>' +
      '<div class="script-btns"><button type="button" class="tb-btn" id="sbCsPrint">Issue / print</button>' +
      '<button type="button" class="tb-btn gold" id="sbCsSave">Save</button></div></div>';
    $('sbCsSheet').innerHTML = callSheetHtml(cs);
    wrap.classList.remove('hidden');
    fetchWeather(cs);
    function saveMeta() {
      var callEl = $('sbCsCall'), notesEl = $('sbCsNotes');
      if (callEl) meta.call = callEl.value;
      if (notesEl) meta.notes = notesEl.value;
      persist();
    }
    $('sbCsClose').onclick = function () { saveMeta(); wrap.classList.add('hidden'); render(); };
    $('sbCsSave').onclick = function () { saveMeta(); wrap.classList.add('hidden'); render(); if (root.psToast) psToast('Call sheet saved'); };
    $('sbCsPrint').onclick = function () {
      saveMeta();
      var fresh = gatherCallSheet(d);
      meta.issues = issueSheet(meta, fresh.signature, new Date().toISOString().slice(0, 10));
      persist();
      document.body.classList.add('cs-printing');
      window.print();
      setTimeout(function () {
        document.body.classList.remove('cs-printing');
        openCallSheet(d);
      }, 500);
    };
  }

  /* The forecast is the one thing on this sheet that cannot be computed here.
     Open-Meteo is keyless and the same source the day planner uses. A blocked
     or failed request says so — it must never be able to impersonate "clear". */
  function fetchWeather(cs) {
    var el = $('sbCsWx');
    if (!el) return;
    var plan = readLS('SB_ShootPlan_v1') || {};
    var S = root.TSun;
    if (!S || !cs.date || !isFinite(+plan.lat) || !isFinite(+plan.lon) || plan.lat === '' || plan.lon === '') {
      el.textContent = 'Forecast — no location pin on the day planner.';
      return;
    }
    fetch(S.weatherUrl(+plan.lat, +plan.lon, cs.date, cs.date))
      .then(function (r) { if (!r.ok) throw new Error('Open-Meteo replied ' + r.status); return r.json(); })
      .then(function (w) {
        var i = w && w.daily && w.daily.time ? w.daily.time.indexOf(cs.date) : -1;
        if (i < 0) { el.textContent = 'Forecast — this date is beyond the forecast window.'; return; }
        var day = { code: w.daily.weather_code[i], tmax: Math.round(w.daily.temperature_2m_max[i]),
                    tmin: Math.round(w.daily.temperature_2m_min[i]),
                    precipProb: w.daily.precipitation_probability_max[i], windMax: w.daily.wind_speed_10m_max[i] };
        var risk = S.shootRisk(day);
        el.className = 'cs-locs';
        el.textContent = 'Forecast — ' + S.wmoLabel(day.code) + ' · ' + day.tmin + '–' + day.tmax + '° · ' +
          (day.precipProb || 0) + '% rain · wind ' + day.windMax + ' · shoot risk ' + risk + '/100';
      })
      .catch(function (e) {
        el.className = 'cs-locs cs-warn';
        el.textContent = 'Forecast unavailable — ' + ((e && e.message) || 'the request failed') +
          '. No weather has been quoted on this sheet.';
      });
  }

  function wireDnD() {
    document.querySelectorAll('#pane-schedule .ps-strip').forEach(function (el) {
      el.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/plain', el.dataset.id);
        ev.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', function () { el.classList.remove('dragging'); });
    });
    document.querySelectorAll('#pane-schedule .ps-strips').forEach(function (zone) {
      zone.addEventListener('dragover', function (ev) { ev.preventDefault(); zone.classList.add('dragover'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('dragover'); });
      zone.addEventListener('drop', function (ev) {
        ev.preventDefault();
        zone.classList.remove('dragover');
        var id = ev.dataTransfer.getData('text/plain');
        var sc = board.scenes.find(function (s) { return s.id === id; });
        if (!sc) return;
        sc.day = parseInt(zone.dataset.day, 10);
        persist();
        render();
      });
    });
  }

  function renderDood(show) {
    var wrap = $('sbDoodWrap');
    if (!wrap) return;
    if (show === false && wrap.classList.contains('hidden')) return;
    var m = doodMatrix(board.scenes, { daysPerWeek: board.daysPerWeek });
    if (!m.rows.length || m.days < 1) {
      wrap.innerHTML = '<div class="ps-empty">Schedule scenes with cast to generate the Day-out-of-Days.</div>';
      if (show) wrap.classList.remove('hidden');
      return;
    }
    var h = '<h3>Day-out-of-Days <span class="dood-week">' + esc(m.rules.daysPerWeek) + '-day week</span></h3>' +
      '<div style="overflow-x:auto"><table class="dood-table"><thead><tr><th>Cast</th>';
    for (var d = 0; d < m.days; d++) h += '<th>D' + (d + 1) + '</th>';
    h += '<th>TOT</th><th>WRK</th><th>HLD</th><th>DRP</th><th>WKS</th></tr></thead><tbody>';
    m.rows.forEach(function (r) {
      h += '<tr><td>' + esc(r.name) + '</td>';
      r.codes.forEach(function (c) {
        var cls = c === 'H' ? 'h' : c === '—' ? 'drop'
          : (c.indexOf('D') >= 0 || c.indexOf('F') >= 0) ? 'wf'
          : (c.indexOf('S') >= 0 || c.indexOf('P') >= 0) ? 'sw' : '';
        h += '<td' + (cls ? ' class="' + esc(cls) + '"' : '') + '>' + esc(c) + '</td>';
      });
      h += '<td>' + esc(r.tot) + '</td><td>' + esc(r.wrk) + '</td><td>' + esc(r.hld) + '</td>' +
        '<td>' + esc(r.drp) + '</td><td>' + esc(r.wks) + (r.sav ? ' <span class="dood-save">−' + esc(r.sav) + '</span>' : '') + '</td></tr>';
    });
    h += '</tbody></table></div><div class="dood-legend">Letters compose — S start · P pick-up · W work · D drop · F finish (so SW, WF, SWF, WD, SWD, PWF) · H hold, billed · — dropped, not billed<br>' +
      'TOT span · WRK worked · HLD billed holds · DRP dropped days · WKS weeks billed' +
      (m.savedWeeks ? ' — <b>' + esc(m.drops) + ' drop' + (m.drops === 1 ? '' : 's') + ' saves ' + esc(m.savedWeeks) + ' cast week' + (m.savedWeeks === 1 ? '' : 's') + '</b>' : '') +
      '</div>';
    wrap.innerHTML = h;
    if (show) wrap.classList.remove('hidden');
  }

  /* ── toolbar ─────────────────────────────────────────────────────── */
  function wireToolbar() {
    var seed = $('sbSeed');
    if (seed) seed.addEventListener('click', function () {
      var st = root.psProjectState ? root.psProjectState() : {};
      if (!st.scriptText && !(st.clips || []).length) return root.psToast && psToast('No script in the timeline yet — import one first');
      var scenes = scenesFromScript(st);
      if (!scenes.length) return root.psToast && psToast('No scenes found — check the script parses on the timeline page');
      board.scenes = scenes;
      persist(); render();
      if (root.psToast) psToast(scenes.length + ' scene strips built (' + formatEighths(scenes.reduce(function (a, s) { return a + s.eighths; }, 0)) + ' pages)');
    });
    var auto = $('sbAuto');
    if (auto) auto.addEventListener('click', function () {
      if (!board.scenes.length) return root.psToast && psToast('Seed scenes from the script first');
      autoScheduleModel(board.scenes, board.pace, board.mode);
      persist(); render();
      var days = board.scenes.reduce(function (m, s) { return Math.max(m, s.day); }, -1) + 1;
      if (root.psToast) psToast('Scheduled ' + days + ' shoot days at ' + round2(board.pace) + ' pages/day (' +
        (paceRes && paceRes.learned.learned && !paceRes.userSet
          ? 'learned from ' + paceRes.learned.learnedN + ' wrapped days'
          : paceRes && paceRes.userSet ? 'your target' : 'the shipped default') + ')' +
        (board.mode === 'location' ? ', grouped by location' : ''));
    });
    var mode = $('sbMode');
    if (mode) {
      mode.value = board.mode || 'script';
      mode.addEventListener('change', function () { board.mode = mode.value; persist(); });
    }
    var week = $('sbWeek');
    if (week) {
      week.value = String(board.daysPerWeek || 5);
      week.addEventListener('change', function () {
        board.daysPerWeek = clamp(int(week.value) || 5, 5, 7);
        persist(); render(); renderDood(false);
        var wp = root.SBBudget && SBBudget.weekPremium ? SBBudget.weekPremium(board.daysPerWeek) : null;
        if (root.psToast) psToast(board.daysPerWeek + '-day week' + (wp && wp.mult > 1
          ? ' — crew days now average ' + Math.round((wp.mult - 1) * 100) + '% over a straight day (TMoney 6th/7th-day premiums)'
          : wp && wp.source === 'unavailable' ? ' — premium unavailable: tools/lib-money.js is not loaded' : ''));
      });
    }
    var pace = $('sbPace');
    if (pace) {
      pace.value = round2(board.pace);
      pace.addEventListener('change', function () {
        board.pace = clamp(numOr(pace.value, DEFAULT_PACE), 1, 12);
        board.paceSet = true;
        persist(); render();
      });
    }
    var relearn = $('sbPaceAuto');
    if (relearn) relearn.addEventListener('click', function () {
      board.paceSet = false;
      persist(); render();
      if (root.psToast) psToast(paceLabel(paceRes));
    });
    var clear = $('sbClear');
    if (clear) clear.addEventListener('click', function () {
      board.scenes.forEach(function (s) { s.day = -1; });
      persist(); render();
    });
    var dood = $('sbDood');
    if (dood) dood.addEventListener('click', function () {
      var wrap = $('sbDoodWrap');
      if (wrap.classList.contains('hidden')) renderDood(true);
      else wrap.classList.add('hidden');
    });
    var print = $('sbPrint');
    if (print) print.addEventListener('click', function () { renderDood(true); window.print(); });
  }

  function init() {
    if (!$('sbDays')) return;
    board = load();
    render();
    wireToolbar();
  }

  /* Live board overrides for the budget seed (empty object if never inited
     or nothing scheduled). */
  function boardOverrides() {
    if (board && board.scenes) return boardOverridesModel(board.scenes, { daysPerWeek: board.daysPerWeek });
    try {
      var d = JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || 'null');
      if (d && Array.isArray(d.scenes)) return boardOverridesModel(d.scenes.map(ensureScene), { daysPerWeek: d.daysPerWeek });
    } catch (e) {}
    return {};
  }

  root.SBScheduleBoard = {
    init: init,
    boardOverrides: boardOverrides,
    DEFAULT_PACE: DEFAULT_PACE,
    MIN_PACE_EVIDENCE: MIN_PACE_EVIDENCE,
    CALL_RULES: CALL_RULES,
    // exposed for tests
    scenesFromScript: scenesFromScript,
    autoScheduleModel: autoScheduleModel,
    boardOverridesModel: boardOverridesModel,
    doodMatrix: doodMatrix,
    formatEighths: formatEighths,
    parseEighths: parseEighths,
    locOf: locOf,
    achievedEighths: achievedEighths,
    paceRowsModel: paceRowsModel,
    mergePaceLog: mergePaceLog,
    learnedPace: learnedPace,
    resolvePace: resolvePace,
    paceLabel: paceLabel,
    callSheetModel: callSheetModel,
    statusOf: statusOf,
    sheetSignature: sheetSignature,
    revisionFor: revisionFor,
    issueSheet: issueSheet,
    clockMins: clockMins,
    clockFmt: clockFmt
  };
})(typeof window !== 'undefined' ? window : globalThis);
