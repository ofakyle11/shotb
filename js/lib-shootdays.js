/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — the shoot day (CShootDays), store SB_ShootDays_v1
   Pure logic, no DOM. Node-testable: every storage entry point takes the
   storage object, so a test hands it a plain fake.

   THE PROBLEM THIS FILE EXISTS FOR
   The platform had no record of a shoot day, so "the day" meant three
   different things and none of them could be joined to the others:

     · the stripboard (SB_ScheduleBoard_v1) — an int index, plus a hand-typed
       MM/DD string in dayMeta that nothing parses;
     · Dailies (SB_Dailies_v1) — a 'YYYY-MM-DD' string and a unit;
     · SB_ShootPlan_v1 — the REAL calendar date, computed with weekday skips
       by the day planner, and asked for by nobody.

   So /today/ guessed the day by string-matching MM/DD, and the DPR filtered
   takes on a field no writer emits, reporting every take ever logged on every
   date. One record fixes all of it:

       { dayIdx, date:'YYYY-MM-DD', unit, sceneIds:[], wrapped:bool, pinned:bool }

   dayIdx is the stripboard's index, date is the calendar date derived from
   SB_ShootPlan_v1, unit is Dailies' unit, sceneIds are the strips scheduled on
   that day. Look it up by either identity and the other one comes back — and
   the identity is (date, unit), not the date: two units shoot one date.
   `pinned` says the date/unit were stated by a writer rather than derived, so
   a rebuild leaves them alone.

   THE TAKE LOG
   Two take stores exist and neither reads the other. SB_Dailies_v1 takes
   carry {day, scene, slate, take, camera, circled, …}; SB_TakeLog_v1 (the
   TCore.Register in tools/tools-media-ui.js) carries {day, time, scene, take,
   roll, grade, note} and expresses "circled" as the display string
   'Circled ⭕' inside `grade`. takesOn() normalises BOTH into one shape,
   including `circled` as a real boolean — see normTakeLogRow for why that
   decision is made here and not at each call site.

   All original code, written for Cinamate.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var KEY = 'SB_ShootDays_v1';
  var PLAN_KEY = 'SB_ShootPlan_v1';
  var BOARD_KEY = 'SB_ScheduleBoard_v1';
  var DAILIES_KEY = 'SB_Dailies_v1';
  var TAKELOG_KEY = 'SB_TakeLog_v1';
  var DEFAULT_UNIT = 'MAIN';

  function str(v) { return String(v == null ? '' : v).trim(); }
  function int(v) { var n = parseInt(v, 10); return isFinite(n) ? n : 0; }

  /* ── 1 · calendar arithmetic ───────────────────────────────────────────
     The weekday-skip rule is the day planner's (tools/sched-weather.js:34),
     which owns SB_ShootPlan_v1 and computes exactly this. It keeps that rule
     inside a DOM module's closure, on a page this file cannot add a script tag
     to (producer/ belongs to another team), so it cannot be called from here.
     The rule is reproduced with different names and pinned by a test rather
     than by nobody; when the planner can take a dependency, sched-weather's
     addDays should delegate to addShootDays below and the copy should go. */
  function isoOf(d) {
    return d.getUTCFullYear() + '-' +
      ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getUTCDate()).slice(-2);
  }
  /* Noon UTC so a browser in any timezone lands on the same calendar day. */
  function atNoon(iso) { return new Date(str(iso) + 'T12:00:00Z'); }
  function isIso(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(str(iso)); }
  function isWeekend(iso) {
    if (!isIso(iso)) return false;
    var w = atNoon(iso).getUTCDay();
    return w === 0 || w === 6;
  }
  function weekday(iso) {
    if (!isIso(iso)) return '';
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][atNoon(iso).getUTCDay()];
  }
  /* n calendar days forward. */
  function addCalendarDays(iso, n) {
    if (!isIso(iso)) return '';
    var d = atNoon(iso);
    d.setUTCDate(d.getUTCDate() + int(n));
    return isoOf(d);
  }
  /* n SHOOT days forward: weekends are not shoot days when the plan skips
     them, so they are stepped over rather than counted. */
  function addShootDays(iso, n, skipWeekends) {
    if (!isIso(iso)) return '';
    var d = atNoon(iso), added = 0, want = Math.max(0, int(n));
    while (added < want) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (skipWeekends && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) continue;
      added++;
    }
    return isoOf(d);
  }
  function skipsWeekends(plan) { return !(plan && plan.skipWk === false); }
  /* Day 1 lands on or after the plan's start date, honouring the rule. */
  function firstShootDate(plan) {
    var start = str(plan && plan.date);
    if (!isIso(start)) return '';
    if (skipsWeekends(plan) && isWeekend(start)) return addShootDays(start, 1, true);
    return start;
  }
  function dateForIndex(plan, idx) {
    var first = firstShootDate(plan);
    if (!first) return '';
    idx = int(idx);
    if (idx <= 0) return first;
    return addShootDays(first, idx, skipsWeekends(plan));
  }

  /* ── 2 · the record ──────────────────────────────────────────────────
     `pinned` marks a record whose date and unit were NAMED by a writer
     (/dailies/ through upsertDate) rather than derived from the plan. It
     exists because build() used to recompute the date of every index from
     the plan, including indices /dailies/ had just created for a date the
     stripboard has never heard of: a take dated 09-14 resolved to
     indexForDate → -1 the moment anything rebuilt. A derived half may be
     recomputed; a half a writer stated may not. */
  function blankDay(idx) {
    return { dayIdx: int(idx), date: '', unit: DEFAULT_UNIT, sceneIds: [], wrapped: false, pinned: false };
  }
  function normDay(rec) {
    var r = rec || {};
    return {
      dayIdx: int(r.dayIdx),
      date: isIso(r.date) ? str(r.date) : '',
      unit: str(r.unit) || DEFAULT_UNIT,
      sceneIds: Array.isArray(r.sceneIds) ? r.sceneIds.map(str) : [],
      wrapped: !!r.wrapped,
      pinned: !!r.pinned
    };
  }
  function list(days) { return Array.isArray(days) ? days.map(normDay) : []; }

  function byIndex(days, idx) {
    idx = int(idx);
    var hit = list(days).filter(function (d) { return d.dayIdx === idx; });
    return hit.length ? hit[0] : null;
  }
  /* A date alone is NOT a shoot day: MAIN and a SPLINTER unit both shoot
     2026-09-14 and they are two days' work, two call sheets and two rows on
     the DPR. `unit` is therefore part of the key wherever a caller knows it;
     omitted, this answers with the first record on the date (the main unit,
     since indices sort ascending) exactly as it always did. */
  function byDate(days, date, unit) {
    var want = str(date), u = str(unit);
    if (!isIso(want)) return null;
    var hit = list(days).filter(function (d) {
      return d.date === want && (!u || d.unit === u);
    });
    return hit.length ? hit[0] : null;
  }
  function indexForDate(days, date, unit) {
    var hit = byDate(days, date, unit);
    return hit ? hit.dayIdx : -1;
  }
  function unitsOnDate(days, date) {
    var want = str(date), seen = {}, out = [];
    list(days).forEach(function (d) {
      if (d.date !== want || seen[d.unit]) return;
      seen[d.unit] = 1; out.push(d.unit);
    });
    return out;
  }
  function dateForDay(days, idx) {
    var hit = byIndex(days, idx);
    return hit ? hit.date : '';
  }
  function upsert(days, rec) {
    var out = list(days), r = normDay(rec), found = false;
    out = out.map(function (d) {
      if (d.dayIdx !== r.dayIdx) return d;
      found = true;
      return r;
    });
    if (!found) out.push(r);
    return sortDays(out);
  }
  function sortDays(days) {
    return list(days).sort(function (a, b) { return a.dayIdx - b.dayIdx; });
  }
  function setWrapped(days, idx, wrapped) {
    return list(days).map(function (d) {
      if (d.dayIdx !== int(idx)) return d;
      return normDay({ dayIdx: d.dayIdx, date: d.date, unit: d.unit,
                       sceneIds: d.sceneIds, wrapped: !!wrapped, pinned: d.pinned });
    });
  }

  /* ── 3 · build the days from the schedule the production already has ──
     The stripboard says which scenes are on which day index; the plan says
     what calendar date an index falls on; Dailies says which unit worked a
     given date. Anything a human has already set (unit, wrapped) survives a
     rebuild — only the derived halves are recomputed. */
  function boardScenes(board) {
    return (board && Array.isArray(board.scenes)) ? board.scenes : [];
  }
  function scheduledOn(board, idx) {
    idx = int(idx);
    return boardScenes(board).filter(function (s) { return int(s.day) === idx && s.day != null && s.day >= 0; });
  }
  function boardDayCount(board) {
    var max = -1;
    boardScenes(board).forEach(function (s) {
      if (s.day != null && s.day >= 0 && int(s.day) > max) max = int(s.day);
    });
    return max + 1;
  }
  function dailyUnits(dailies) {
    var out = {};
    var d = dailies || {};
    (Array.isArray(d.days) ? d.days : []).forEach(function (x) {
      if (x && isIso(x.date) && str(x.unit)) out[str(x.date)] = str(x.unit);
    });
    return out;
  }
  function build(plan, board, opts) {
    opts = opts || {};
    var prev = {};
    list(opts.existing).forEach(function (d) { prev[d.dayIdx] = d; });
    var units = dailyUnits(opts.dailies);
    var n = Math.max(boardDayCount(board), int(opts.count), Object.keys(prev).length);
    if (!n && str(plan && plan.date)) n = Math.max(1, int(plan && plan.n));
    var out = [];
    for (var i = 0; i < n; i++) {
      var was = prev[i] || blankDay(i);
      /* A pinned record's date and unit came from a writer that knew them —
         /dailies/ naming the day it is shooting. Recomputing them from the
         plan's index arithmetic is how a take dated 09-14 stopped resolving
         to any shoot day at all after a rebuild. */
      var date = was.pinned && was.date ? was.date : (dateForIndex(plan, i) || was.date);
      var unit = was.pinned ? was.unit : (units[date] || was.unit);
      out.push(normDay({
        dayIdx: i,
        date: date,
        unit: unit,
        sceneIds: scheduledOn(board, i).map(function (s) { return str(s.id || s.num); }),
        wrapped: was.wrapped,
        pinned: was.pinned
      }));
    }
    return out;
  }

  /* ── 4 · storage ──────────────────────────────────────────────────────
     Every entry point takes the storage object, and there is NO fallback to a
     global localStorage. A fallback makes the claim above a lie: a caller that
     forgets the argument still works in a browser and silently reads a store
     no test ever sees, which is exactly how a module drifts away from the
     suite that is supposed to pin it. No store, no read — say so by answering
     empty rather than by reaching for one. */
  function store(ls) { return ls || null; }
  function readKey(ls, key) {
    var s = store(ls);
    if (!s) return null;
    try { return JSON.parse(s.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function load(ls) { return sortDays(readKey(ls, KEY) || []); }
  function save(ls, days) {
    var s = store(ls);
    if (!s) return sortDays(days);
    var out = sortDays(days);
    try { s.setItem(KEY, JSON.stringify(out)); } catch (e) {}
    return out;
  }
  /* The one call a page makes: rebuild from the live stores, keep what a human
     set, write it back, hand back the days. */
  function sync(ls, opts) {
    opts = opts || {};
    var days = build(
      opts.plan || readKey(ls, PLAN_KEY),
      opts.board || readKey(ls, BOARD_KEY),
      { existing: load(ls), dailies: opts.dailies || readKey(ls, DAILIES_KEY), count: opts.count }
    );
    return save(ls, days);
  }
  /* Dailies names a date and a unit before any board exists — that day is
     still a shoot day and still needs a record. The key is date AND unit: it
     used to be the date alone, so a second unit shooting the same date
     OVERWROTE the main unit's record instead of getting its own, and one of
     the two days vanished from every consumer that joins on this store.
     /dailies/ already keys its own st.days on {date, unit}; this now matches.
     The record is pinned, because the caller stated the date — see build(). */
  function upsertDate(ls, date, fields) {
    var f = fields || {};
    var days = load(ls);
    var unit = str(f.unit) || DEFAULT_UNIT;
    var hit = byDate(days, date, unit);
    var rec;
    if (hit) {
      rec = normDay({ dayIdx: hit.dayIdx, date: hit.date, unit: unit,
                      sceneIds: f.sceneIds || hit.sceneIds,
                      wrapped: f.wrapped == null ? hit.wrapped : !!f.wrapped,
                      pinned: true });
    } else {
      var idx = 0;
      days.forEach(function (d) { if (d.dayIdx >= idx) idx = d.dayIdx + 1; });
      rec = normDay({ dayIdx: idx, date: date, unit: unit, sceneIds: f.sceneIds,
                      wrapped: f.wrapped, pinned: true });
    }
    return save(ls, upsert(days, rec));
  }
  /* Wrap / un-wrap one day, through the store, in one call. The pure
     setWrapped is the arithmetic; this is the entry point a PAGE can use, and
     its absence is why nothing in the shipped tree ever set wrapped:true —
     the flag the whole schedule-learning loop gates on. Un-wrapping is the
     same call with false, because a day marked wrapped by mistake has to be
     retractable or the learned pace is stuck with it. */
  function wrapDay(ls, idx, wrapped) {
    var days = load(ls);
    if (!byIndex(days, idx)) return days;
    return save(ls, setWrapped(days, idx, wrapped));
  }
  /* Which shoot day is today? A lookup, not a string match. todayISO comes
     from the CALLER — a library that reads the clock cannot be tested. */
  function todayIndex(days, todayISO) { return indexForDate(days, todayISO); }
  function currentDay(days, todayISO) {
    var hit = byDate(days, todayISO);
    if (hit) return hit;
    /* Not a shoot day: the next one that has not wrapped, else the last. */
    var all = sortDays(days), want = str(todayISO);
    for (var i = 0; i < all.length; i++) {
      if (all[i].date && want && all[i].date > want) return all[i];
      if (!all[i].wrapped && !all[i].date) return all[i];
    }
    return all.length ? all[all.length - 1] : null;
  }
  function label(rec) {
    if (!rec) return '';
    return 'Day ' + (int(rec.dayIdx) + 1) +
      (rec.date ? ' — ' + weekday(rec.date) + ' ' + rec.date : '') +
      (rec.unit && rec.unit !== DEFAULT_UNIT ? ' · ' + rec.unit + ' unit' : '');
  }

  /* ── 5 · the one take accessor ────────────────────────────────────────
     Two stores, two shapes, and a reader that saw neither. Each store gets its
     OWN normaliser reading only the fields its writer actually emits — a
     generic "read t.day or t.date or t.circled" accessor is how the reader
     drifted from the writer in the first place, and it would drift again the
     moment either schema changes.

     Circled: SB_Dailies_v1 stores a boolean; SB_TakeLog_v1 stores the display
     string 'Circled ⭕' in `grade`, because that is what the <select> shows.
     It is normalised to a boolean HERE, deliberately, for three reasons: the
     emoji is a label, not data, and no consumer should have to match it; every
     consumer that needs the concept (printed count, circle rate, the editor's
     pull list) needs the same answer; and matching the string at each call
     site is exactly how `/print|good|circle/` against a field named `status`
     shipped a permanently-zero printed count. 'Good' is NOT a circle — the
     grade list offers both, so the AD chose 'Good' over 'Circled' on purpose;
     only the circle is the print order. */
  var CIRCLED_GRADE = 'Circled ⭕';
  function isCircledGrade(grade) { return /^\s*circled\b/i.test(str(grade)); }

  function normTakeLogRow(row) {
    var r = row || {};
    return {
      source: TAKELOG_KEY,
      id: str(r.id),
      day: isIso(r.day) ? str(r.day) : '',
      time: str(r.time),
      scene: str(r.scene),
      slate: '',
      take: int(r.take) || 1,
      camera: 'A',
      roll: str(r.roll),
      grade: str(r.grade),
      circled: isCircledGrade(r.grade),
      note: str(r.note)
    };
  }
  function normDailiesTake(row) {
    var r = row || {};
    return {
      source: DAILIES_KEY,
      id: str(r.id),
      day: isIso(r.day) ? str(r.day) : '',
      time: '',
      scene: str(r.scene),
      slate: str(r.slate),
      take: int(r.take) || 1,
      camera: str(r.camera).toUpperCase() === 'B' ? 'B' : 'A',
      roll: str(r.soundRoll),
      grade: r.circled ? CIRCLED_GRADE : (str(r.ngReason) ? 'NG' : ''),
      circled: !!r.circled,
      note: str(r.notes)
    };
  }
  function rowsOf(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.rows)) return v.rows;
    if (v && Array.isArray(v.takes)) return v.takes;
    return [];
  }
  /* stores: {takeLog: SB_TakeLog_v1, dailies: SB_Dailies_v1} */
  function allTakes(stores) {
    var s = stores || {};
    return rowsOf(s.takeLog).map(normTakeLogRow)
      .concat(rowsOf(s.dailies).map(normDailiesTake));
  }
  /* Takes on ONE date. A take with no day is not silently counted as today's —
     that guess is the bug this replaces. It is reported separately by
     undatedTakes so the number is visible rather than invented. */
  function takesOn(stores, date) {
    var want = str(date);
    return allTakes(stores).filter(function (t) { return t.day && t.day === want; });
  }
  function undatedTakes(stores) {
    return allTakes(stores).filter(function (t) { return !t.day; });
  }
  function circledTakes(takes) {
    return (takes || []).filter(function (t) { return !!t.circled; });
  }

  root.CShootDays = {
    KEY: KEY, PLAN_KEY: PLAN_KEY, BOARD_KEY: BOARD_KEY,
    DAILIES_KEY: DAILIES_KEY, TAKELOG_KEY: TAKELOG_KEY,
    DEFAULT_UNIT: DEFAULT_UNIT, CIRCLED_GRADE: CIRCLED_GRADE,

    isWeekend: isWeekend, weekday: weekday,
    addCalendarDays: addCalendarDays, addShootDays: addShootDays,
    firstShootDate: firstShootDate, dateForIndex: dateForIndex,

    blankDay: blankDay, build: build, upsert: upsert, setWrapped: setWrapped,
    byIndex: byIndex, byDate: byDate, indexForDate: indexForDate,
    unitsOnDate: unitsOnDate,
    dateForDay: dateForDay, scheduledOn: scheduledOn, boardDayCount: boardDayCount,
    todayIndex: todayIndex, currentDay: currentDay, label: label,

    load: load, save: save, sync: sync, upsertDate: upsertDate, wrapDay: wrapDay,

    isCircledGrade: isCircledGrade,
    normTakeLogRow: normTakeLogRow, normDailiesTake: normDailiesTake,
    allTakes: allTakes, takesOn: takesOn, undatedTakes: undatedTakes,
    circledTakes: circledTakes
  };
})(typeof window !== 'undefined' ? window : globalThis);
