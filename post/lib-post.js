/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Post Supervisor engine (CPost)
   Pure logic, no DOM: the post-production calendar (template milestones with
   dependencies, weekend-skipping date math that never touches Date.now()),
   cut version naming ('Project_DC_v03'), vendor bid tracking with a
   commit-once guard for the Money Room, and delivery-readiness hints for
   the Distribution module. All durations are TEMPLATE ESTIMATES — real
   post schedules are negotiated with the facilities.

   The plan and what actually happened are kept APART: schedule() is a pure
   plan over SB_Post_v1, observed status and dates live in SB_PostActuals_v1,
   and overlay() lays one over the other to produce planned-vs-actual, slip
   and a moved critical path. Readiness is read from the ACTUALS — a
   milestone with no recorded end is 'planned', never 'ready'.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function uid() { return 'ps' + Math.random().toString(36).slice(2, 9); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  /* ── 1 · template milestones ────────────────────────────────────────────
     days = default working-day duration (estimate); after = parent ids.
     A milestone with several parents starts after the LATEST of them.     */
  var TEMPLATE = [
    { id: 'assembly',      name: 'Assembly cut',        days: 5,  after: [] },
    { id: 'editors-cut',   name: "Editor's cut",        days: 10, after: ['assembly'] },
    { id: 'directors-cut', name: "Director's cut",      days: 10, after: ['editors-cut'] },
    { id: 'picture-lock',  name: 'Picture lock',        days: 3,  after: ['directors-cut'] },
    { id: 'turnover',      name: 'Turnover',            days: 2,  after: ['picture-lock'] },
    { id: 'conform',       name: 'Conform / online',    days: 3,  after: ['turnover'] },
    { id: 'grade',         name: 'Colour grade',        days: 5,  after: ['turnover'] },
    { id: 'sound-edit',    name: 'Sound edit',          days: 10, after: ['turnover'] },
    { id: 'mix',           name: 'Final mix',           days: 5,  after: ['sound-edit'] },
    { id: 'm-and-e',       name: 'M&E stems',           days: 2,  after: ['mix'] },
    { id: 'vfx-final',     name: 'VFX finals',          days: 15, after: ['turnover'] },
    { id: 'qc',            name: 'QC pass',             days: 2,  after: ['grade', 'mix', 'vfx-final'] },
    { id: 'dcp',           name: 'DCP mastering',       days: 3,  after: ['qc'] },
    { id: 'delivery',      name: 'Delivery',            days: 1,  after: ['dcp'] }
  ];
  function template() {
    return TEMPLATE.map(function (m) {
      return { id: m.id, name: m.name, days: m.days, after: m.after.slice() };
    });
  }

  /* ── 2 · weekend-skipping date math (pure — no Date.now anywhere) ────── */
  function parseISO(iso) {
    var p = String(iso || '').split('-');
    return new Date(Date.UTC(+p[0], (+p[1] || 1) - 1, +p[2] || 1));
  }
  function fmtISO(d) {
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function isWeekend(iso) {
    var dow = parseISO(iso).getUTCDay();
    return dow === 0 || dow === 6;
  }
  /* Nearest business day: dir >= 0 rolls forward to Monday, dir < 0 back to Friday. */
  function snapBusiness(iso, dir) {
    var d = parseISO(iso), step = dir < 0 ? -1 : 1;
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + step);
    return fmtISO(d);
  }
  /* Move n business days from a business day (n may be negative or 0). */
  function addBusDays(iso, n) {
    var d = parseISO(snapBusiness(iso, n < 0 ? -1 : 1));
    var left = Math.abs(Math.round(n)), step = n < 0 ? -1 : 1;
    while (left > 0) {
      d.setUTCDate(d.getUTCDate() + step);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
    }
    return fmtISO(d);
  }
  /* Signed count of business-day steps from a to b (both business days). */
  function busDiff(a, b) {
    var n = 0, cur = a;
    if (a === b) return 0;
    var step = parseISO(a) < parseISO(b) ? 1 : -1;
    while (cur !== b && Math.abs(n) < 20000) { cur = addBusDays(cur, step); n += step; }
    return n;
  }

  /* ── 3 · the schedule ───────────────────────────────────────────────────
     schedule(milestones, dateISO, direction)
       direction 'forward'  → dateISO is the assembly (root) start date
       direction 'backward' → dateISO is the day delivery must land ON
     Weekends are skipped everywhere; a weekend dateISO snaps to the nearest
     working day (forward → Monday, backward → previous Friday).
     Returns { rows:[{id,name,start,end,days,blockedBy,critical}],
               criticalPath, path, start, end } — or { error:'cycle' }.    */
  function topoSort(ms) {
    var byId = {}, indeg = {}, kids = {}, order = [], queue = [], i;
    ms.forEach(function (m) { byId[m.id] = m; indeg[m.id] = 0; kids[m.id] = []; });
    ms.forEach(function (m) {
      (m.after || []).forEach(function (p) {
        if (byId[p]) { indeg[m.id]++; kids[p].push(m.id); }
      });
    });
    ms.forEach(function (m) { if (!indeg[m.id]) queue.push(m.id); });
    for (i = 0; i < queue.length; i++) {
      order.push(queue[i]);
      kids[queue[i]].forEach(function (k) { if (--indeg[k] === 0) queue.push(k); });
    }
    return order.length === ms.length ? order.map(function (id) { return byId[id]; }) : null;
  }

  function runForward(ordered, anchorISO) {
    var start = {}, end = {}, byId = {};
    ordered.forEach(function (m) { byId[m.id] = m; });
    ordered.forEach(function (m) {
      var latest = null;
      (m.after || []).forEach(function (p) {
        if (end[p] && (!latest || parseISO(end[p]) > parseISO(latest))) latest = end[p];
      });
      var s = latest ? addBusDays(latest, 1) : snapBusiness(anchorISO, 1);
      start[m.id] = s;
      end[m.id] = addBusDays(s, Math.max(1, Math.round(num(m.days)) || 1) - 1);
    });
    return { start: start, end: end };
  }

  function schedule(milestones, dateISO, direction) {
    var ms = (milestones && milestones.length ? milestones : template()).map(function (m) {
      return { id: m.id, name: m.name || m.id, days: Math.max(1, Math.round(num(m.days)) || 1),
               after: (m.after || []).slice() };
    });
    var ordered = topoSort(ms);
    if (!ordered) return { rows: [], criticalPath: 0, path: [], error: 'cycle' };

    /* No anchor date → no dates are invented: rows come back with null
       start/end but the dependency graph and critical path still compute. */
    var dated = !!dateISO;
    var anchor = dated ? snapBusiness(dateISO, direction === 'backward' ? -1 : 1) : '2026-01-05';
    var pass = runForward(ordered, anchor);
    if (dated && direction === 'backward') {
      /* land the terminal milestone ON the (snapped) target date, then re-run */
      var terminal = null;
      ordered.forEach(function (m) {
        if (m.id === 'delivery') terminal = m.id;
      });
      if (!terminal) ordered.forEach(function (m) {
        if (!terminal || parseISO(pass.end[m.id]) > parseISO(pass.end[terminal])) terminal = m.id;
      });
      /* exact solve: business-day arithmetic is translation-invariant, so
         shifting every date by one offset keeps all dependencies intact   */
      var off = busDiff(pass.end[terminal], anchor);
      if (off !== 0) {
        Object.keys(pass.start).forEach(function (id) {
          pass.start[id] = addBusDays(pass.start[id], off);
          pass.end[id] = addBusDays(pass.end[id], off);
        });
      }
    }

    /* critical path: longest days-sum chain through the dependency graph */
    var best = {}, via = {}, cpEnd = null;
    ordered.forEach(function (m) {
      var b = 0, v = null;
      (m.after || []).forEach(function (p) {
        if (best[p] != null && best[p] > b) { b = best[p]; v = p; }
      });
      best[m.id] = b + m.days; via[m.id] = v;
      if (!cpEnd || best[m.id] > best[cpEnd]) cpEnd = m.id;
    });
    var path = [], walk = cpEnd;
    while (walk) { path.unshift(walk); walk = via[walk]; }

    var minStart = null, maxEnd = null;
    var rows = ordered.map(function (m) {
      var s = pass.start[m.id], e = pass.end[m.id];
      if (!minStart || parseISO(s) < parseISO(minStart)) minStart = s;
      if (!maxEnd || parseISO(e) > parseISO(maxEnd)) maxEnd = e;
      return { id: m.id, name: m.name, start: dated ? s : null, end: dated ? e : null,
               days: m.days, blockedBy: m.after.slice(), critical: path.indexOf(m.id) >= 0 };
    });
    return { rows: rows, criticalPath: best[cpEnd] || 0, path: path,
             start: dated ? minStart : null, end: dated ? maxEnd : null };
  }

  /* ── 4 · cut versions ─────────────────────────────────────────────────── */
  var STAGE_ABBR = {
    'assembly': 'ASM', 'editors-cut': 'EC', 'directors-cut': 'DC',
    'picture-lock': 'PL', 'turnover': 'TO', 'conform': 'CONF', 'grade': 'GRD',
    'sound-edit': 'SND', 'mix': 'MIX', 'm-and-e': 'ME', 'vfx-final': 'VFX',
    'qc': 'QC', 'dcp': 'DCP', 'delivery': 'DEL'
  };
  function versionName(project, stage, n) {
    var p = String(project || '').replace(/[^A-Za-z0-9]+/g, '') || 'Project';
    var ab = STAGE_ABBR[stage] ||
      String(stage || 'CUT').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 4) || 'CUT';
    var v = Math.max(1, Math.round(num(n)) || 1);
    return p + '_' + ab + '_v' + (v < 10 ? '0' + v : '' + v);
  }
  function nextVersion(versions, stage) {
    var max = 0;
    (versions || []).forEach(function (r) {
      if (r.stage === stage && r.n > max) max = r.n;
    });
    return max + 1;
  }
  function addVersion(versions, fields) {
    var f = fields || {};
    var row = { id: uid(), stage: f.stage || 'directors-cut',
                n: Math.max(1, Math.round(num(f.n)) || nextVersion(versions, f.stage || 'directors-cut')),
                date: f.date || '', notes: f.notes || '' };
    versions.push(row);
    return row;
  }

  /* ── 5 · vendor bids (commit-once guard for the Money Room) ───────────── */
  var SERVICES = ['grade', 'mix', 'vfx', 'dcp', 'qc'];
  function addBid(bids, fields) {
    var f = fields || {};
    if (SERVICES.indexOf(f.service) < 0) return null;
    var row = { id: uid(), service: f.service, vendor: String(f.vendor || '').trim() || 'Unnamed vendor',
                bid: num(f.bid), awarded: false, committedPo: null };
    bids.push(row);
    return row;
  }
  /* Awarding returns the bid plus whether the Money Room still needs the PO.
     committedPo (set by the page after CMoney.addPO) guards double-commits. */
  function awardBid(bids, id) {
    var bid = (bids || []).filter(function (b) { return b.id === id; })[0];
    if (!bid) return null;
    bid.awarded = true;
    return { bid: bid, needsCommit: !bid.committedPo };
  }
  function lowBid(bids, service) {
    var rows = (bids || []).filter(function (b) { return b.service === service && b.bid > 0; });
    if (!rows.length) return null;
    return rows.reduce(function (a, b) { return b.bid < a.bid ? b : a; });
  }

  /* ── 6 · actuals overlay (store SB_PostActuals_v1) ──────────────────────
     The plan (schedule) stays a pure function of the template and the anchor
     date. What actually happened lives in a SEPARATE store and is laid OVER
     the plan — nothing here mutates a milestone, a plan row, or SB_Post_v1,
     which is what keeps schedule() pure and re-derivable from scratch.

     A record is { id, status:'not-started'|'in-progress'|'done',
                   actualStart, actualEnd }. 'done' without an actualEnd is
     not evidence that anything finished, so setActual refuses to record it —
     a claimed completion with no date is exactly the confident label over
     nothing this layer exists to stop.                                     */
  var ACTUALS_KEY = 'SB_PostActuals_v1';
  var STATUSES = ['not-started', 'in-progress', 'done'];

  function blankActuals() { return { v: 1, milestones: {} }; }
  function isISO(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }

  /* Read one milestone's record — always a full record, never undefined. */
  function actualFor(actuals, id) {
    var r = (actuals && actuals.milestones && actuals.milestones[id]) || null;
    var start = r && isISO(r.actualStart) ? r.actualStart : '';
    var end = r && isISO(r.actualEnd) ? r.actualEnd : '';
    var st = r && STATUSES.indexOf(r.status) >= 0 ? r.status : 'not-started';
    if (st === 'done' && !end) st = start ? 'in-progress' : 'not-started';
    if (st === 'not-started' && start) st = 'in-progress';
    return { id: id, status: st, actualStart: start, actualEnd: end };
  }
  /* Write one milestone's record. Mutates the ACTUALS store only. */
  function setActual(actuals, id, fields) {
    if (!actuals || !id) return null;
    if (!actuals.milestones) actuals.milestones = {};
    var f = fields || {};
    var prev = actualFor(actuals, id);
    var start = f.actualStart === undefined ? prev.actualStart : (isISO(f.actualStart) ? f.actualStart : '');
    var end = f.actualEnd === undefined ? prev.actualEnd : (isISO(f.actualEnd) ? f.actualEnd : '');
    var st = f.status === undefined ? prev.status : f.status;
    if (STATUSES.indexOf(st) < 0) st = 'not-started';
    /* No status given → the status follows the evidence, not the other way
       round: an end date IS a completion, a start date IS work under way. */
    if (f.status === undefined) {
      if (end) st = 'done';
      else if (start && st === 'not-started') st = 'in-progress';
    }
    if (st === 'done' && !end) st = start ? 'in-progress' : 'not-started';
    if (st === 'not-started') { start = ''; end = ''; }
    if (st === 'in-progress') end = '';
    var row = { id: id, status: st, actualStart: start, actualEnd: end };
    actuals.milestones[id] = row;
    return row;
  }
  function clearActual(actuals, id) {
    if (actuals && actuals.milestones) delete actuals.milestones[id];
    return actualFor(actuals, id);
  }

  /* Business-day helpers over dates a human typed (which may be a weekend). */
  function nextBusDay(iso) {
    return isWeekend(iso) ? snapBusiness(iso, 1) : addBusDays(iso, 1);
  }
  /* Inclusive business-day span of a real, observed interval. */
  function busSpan(a, b) {
    if (!isISO(a) || !isISO(b)) return 0;
    var s = snapBusiness(a, 1), e = snapBusiness(b, -1);
    if (parseISO(e) < parseISO(s)) return 1;
    return Math.abs(busDiff(s, e)) + 1;
  }
  /* Signed business-day slip: + is late, - is early, 0 is on plan. */
  function slipDays(plannedISO, actualISO) {
    if (!isISO(plannedISO) || !isISO(actualISO)) return 0;
    return busDiff(snapBusiness(plannedISO, -1), snapBusiness(actualISO, -1));
  }

  /* Milestones with observed durations substituted for template estimates —
     a fresh list, so the caller's milestones are untouched. */
  function effectiveMilestones(milestones, actuals) {
    var base = (milestones && milestones.length ? milestones : template());
    return base.map(function (m) {
      var a = actualFor(actuals, m.id);
      var days = Math.max(1, Math.round(num(m.days)) || 1);
      if (a.status === 'done' && a.actualStart && a.actualEnd) days = busSpan(a.actualStart, a.actualEnd) || days;
      return { id: m.id, name: m.name || m.id, days: days, after: (m.after || []).slice() };
    });
  }

  /* overlay(milestones, actuals, dateISO, direction)
       plan  = schedule(...) exactly as before, untouched
       + per row: status, actualStart/actualEnd, forecastStart/forecastEnd,
         slip (business days, signed), criticalNow
       + criticalMoved: does the critical path run through different
         milestones once observed durations replace the estimates?          */
  function overlay(milestones, actuals, dateISO, direction) {
    var base = (milestones && milestones.length ? milestones : template());
    var plan = schedule(base, dateISO, direction);
    if (plan.error) {
      return { rows: [], criticalPath: 0, path: [], actualPath: [], criticalPathActual: 0,
               criticalMoved: false, plannedStart: null, plannedEnd: null,
               forecastStart: null, forecastEnd: null, slip: 0,
               done: 0, inProgress: 0, notStarted: 0, error: plan.error };
    }
    var asRun = schedule(effectiveMilestones(base, actuals), '', 'forward');
    var actualPath = asRun.error ? plan.path.slice() : asRun.path.slice();
    var criticalMoved = actualPath.join('>') !== plan.path.join('>');

    var fStart = {}, fEnd = {}, counts = { 'done': 0, 'in-progress': 0, 'not-started': 0 };
    var rows = plan.rows.map(function (r) {
      var a = actualFor(actuals, r.id);
      counts[a.status]++;
      var latest = null;
      r.blockedBy.forEach(function (p) {
        if (fEnd[p] && (!latest || parseISO(fEnd[p]) > parseISO(latest))) latest = fEnd[p];
      });
      var s = null, e = null;
      if (a.status === 'done' && a.actualStart && a.actualEnd) {
        s = a.actualStart; e = a.actualEnd;
      } else {
        s = a.actualStart || (latest ? nextBusDay(latest) : r.start);
        if (s) e = addBusDays(s, Math.max(1, r.days) - 1);
      }
      if (s) fStart[r.id] = s;
      if (e) fEnd[r.id] = e;
      return { id: r.id, name: r.name, days: r.days, blockedBy: r.blockedBy.slice(),
               critical: r.critical, criticalNow: actualPath.indexOf(r.id) >= 0,
               plannedStart: r.start, plannedEnd: r.end,
               status: a.status, actualStart: a.actualStart, actualEnd: a.actualEnd,
               actualDays: (a.actualStart && a.actualEnd) ? busSpan(a.actualStart, a.actualEnd) : null,
               forecastStart: s || null, forecastEnd: e || null,
               slip: slipDays(r.end, e) };
    });

    var fcEnd = null, fcStart = null;
    rows.forEach(function (r) {
      if (r.forecastEnd && (!fcEnd || parseISO(r.forecastEnd) > parseISO(fcEnd))) fcEnd = r.forecastEnd;
      if (r.forecastStart && (!fcStart || parseISO(r.forecastStart) < parseISO(fcStart))) fcStart = r.forecastStart;
    });
    return { rows: rows, criticalPath: plan.criticalPath, path: plan.path.slice(),
             actualPath: actualPath, criticalPathActual: asRun.criticalPath || 0,
             criticalMoved: criticalMoved,
             plannedStart: plan.start, plannedEnd: plan.end,
             forecastStart: fcStart, forecastEnd: fcEnd,
             slip: slipDays(plan.end, fcEnd),
             done: counts['done'], inProgress: counts['in-progress'],
             notStarted: counts['not-started'] };
  }

  /* ── 7 · delivery readiness (hints only — never writes SB_Dist_v1) ─────
     READINESS COMES FROM ACTUALS. A deliverable is 'ready' only when its
     milestone is recorded done WITH an actual end date; otherwise it is
     'planned' (or 'in-progress') and `ready` is null. Reporting a template
     estimate as "ready" is how a distributor gets promised a date nobody
     ever verified. Accepts plan rows or overlay rows; a separate actuals
     store may be passed alongside plan rows.                              */
  var DELIVERABLES = {
    'dcp':     'DCP',
    'mix':     '5.1 printmaster',
    'm-and-e': 'M&E',
    'grade':   'ProRes master',
    'qc':      'QC report'
  };
  function distReadiness(rows, actuals) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (!DELIVERABLES[r.id]) return;
      var a = actuals ? actualFor(actuals, r.id)
                      : actualFor({ milestones: (function () { var o = {}; o[r.id] = r; return o; })() }, r.id);
      var planned = r.plannedEnd !== undefined ? (r.plannedEnd || null) : (r.end || null);
      var forecast = r.forecastEnd !== undefined ? (r.forecastEnd || null) : null;
      var ready = a.status === 'done' && a.actualEnd ? a.actualEnd : null;
      out.push({ id: r.id, milestone: r.name || r.id, deliverable: DELIVERABLES[r.id],
                 status: ready ? 'ready' : a.status === 'in-progress' ? 'in-progress' : 'planned',
                 ready: ready, actual: ready, planned: planned,
                 forecast: forecast || (ready ? null : planned),
                 slip: ready ? slipDays(planned, ready) : 0 });
    });
    out.sort(function (a, b) {
      var x = a.ready || a.forecast || a.planned, y = b.ready || b.forecast || b.planned;
      if (!x) return 1;
      if (!y) return -1;
      return x < y ? -1 : x > y ? 1 : 0;
    });
    return out;
  }

  root.CPost = {
    TEMPLATE: TEMPLATE, template: template,
    parseISO: parseISO, fmtISO: fmtISO, isWeekend: isWeekend,
    snapBusiness: snapBusiness, addBusDays: addBusDays, busDiff: busDiff,
    schedule: schedule,
    STAGE_ABBR: STAGE_ABBR, versionName: versionName,
    nextVersion: nextVersion, addVersion: addVersion,
    SERVICES: SERVICES, addBid: addBid, awardBid: awardBid, lowBid: lowBid,
    ACTUALS_KEY: ACTUALS_KEY, STATUSES: STATUSES, blankActuals: blankActuals,
    actualFor: actualFor, setActual: setActual, clearActual: clearActual,
    busSpan: busSpan, slipDays: slipDays, nextBusDay: nextBusDay,
    effectiveMilestones: effectiveMilestones, overlay: overlay,
    DELIVERABLES: DELIVERABLES, distReadiness: distReadiness
  };
})(typeof window !== 'undefined' ? window : globalThis);
