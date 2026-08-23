/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Post Supervisor engine (CPost)
   Pure logic, no DOM: the post-production calendar (template milestones with
   dependencies, weekend-skipping date math that never touches Date.now()),
   cut version naming ('Project_DC_v03'), vendor bid tracking with a
   commit-once guard for the Money Room, and delivery-readiness hints for
   the Distribution module. All durations are TEMPLATE ESTIMATES — real
   post schedules are negotiated with the facilities.
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

  /* ── 6 · delivery readiness (hints only — never writes SB_Dist_v1) ───── */
  var DELIVERABLES = {
    'dcp':     'DCP',
    'mix':     '5.1 printmaster',
    'm-and-e': 'M&E',
    'grade':   'ProRes master',
    'qc':      'QC report'
  };
  function distReadiness(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (DELIVERABLES[r.id]) {
        out.push({ id: r.id, milestone: r.name || r.id,
                   deliverable: DELIVERABLES[r.id], ready: r.end || null });
      }
    });
    out.sort(function (a, b) {
      if (!a.ready) return 1;
      if (!b.ready) return -1;
      return a.ready < b.ready ? -1 : a.ready > b.ready ? 1 : 0;
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
    DELIVERABLES: DELIVERABLES, distReadiness: distReadiness
  };
})(typeof window !== 'undefined' ? window : globalThis);
