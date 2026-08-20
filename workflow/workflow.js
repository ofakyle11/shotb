/* CINAMATE Workflow — production pipeline mission control.
 *
 * Reads what every module has actually saved in this browser (Writer,
 * Studio, Producer Suite, Tools) and renders the whole pipeline:
 * where the project stands, live metrics per stage, what to do next.
 * Entirely client-side; no server calls except an optional health ping
 * to the local Cinamate AI bridge.
 *
 * Engine (window.CWorkflow.assess) is pure and node-testable.
 */
(function (root) {
  'use strict';

  /* ── engine ─────────────────────────────────────────────────────── */
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
  function count(v) {
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') return Object.keys(v).length;
    return 0;
  }

  /* stores = { timeline, writer, sheet, budgetPrefs, board, plan, sales,
   *            localGpu, captions, credits, epk, crew, reviewNotes, drafts } — each
   * already JSON-parsed (null/undefined when absent). */
  function assess(stores) {
    var s = stores || {};
    var tl = s.timeline || {};
    var wr = s.writer || {};
    var clips = Array.isArray(tl.clips) ? tl.clips : [];
    var rendered = clips.filter(function (c) { return c && c.videoUrl; });
    var approved = clips.filter(function (c) { return c && c.status === 'approved'; });
    var generating = clips.filter(function (c) { return c && c.status === 'generating'; });
    var script = String(tl.scriptText || '');
    var wrScenes = Array.isArray(wr.scenes) ? wr.scenes : [];
    var stages = [];

    /* 1 · Develop — a screenplay exists (Writer draft or Studio script) */
    var hasScript = script.trim().length > 200 || wrScenes.length > 0;
    stages.push({
      id: 'develop', title: 'Develop', module: 'Writer',
      href: '/writer/',
      status: hasScript ? 'done' : 'todo',
      metrics: hasScript ? [
        (tl.projectName || (wr.proj && wr.proj.title) || 'Untitled') + '',
        wrScenes.length ? wrScenes.length + ' treatment beats' : null,
        script ? Math.round(script.split(/\s+/).filter(Boolean).length) + ' script words' : null
      ].filter(Boolean) : ['No screenplay yet'],
      hint: hasScript ? 'Screenplay in hand' : 'Import a treatment in the Writer, or paste a script in the Studio',
      action: hasScript ? 'Revise in Writer' : 'Open Writer'
    });

    /* 2 · Breakdown — script parsed into clips / characters / locations */
    var chars = count(tl.characters);
    var locs = count(tl.locationBible);
    var hasBreakdown = clips.length > 0;
    stages.push({
      id: 'breakdown', title: 'Breakdown', module: 'Studio',
      href: '/timeline/',
      status: hasBreakdown ? 'done' : (hasScript ? 'active' : 'todo'),
      metrics: hasBreakdown ? [
        clips.length + ' clips', chars + ' characters', locs + ' locations'
      ] : [hasScript ? 'Script ready to parse' : 'Needs a script first'],
      hint: hasBreakdown ? 'Timeline built' : 'Open the Studio and parse the screenplay into clips',
      action: 'Open Studio'
    });

    /* 3 · Budget — top sheet carries real numbers */
    var sheet = s.sheet || {};
    var cats = Array.isArray(sheet.categories) ? sheet.categories : [];
    var subtotal = 0, actuals = 0;
    cats.forEach(function (c) {
      (c.items || []).forEach(function (it) { subtotal += num(it.est); actuals += num(it.actual); });
    });
    var grand = Math.round(subtotal * (1 + num(sheet.contingencyPct) / 100));
    var mode = (s.budgetPrefs && s.budgetPrefs.mode) === 'documentary' ? 'Documentary' : 'Feature Film';
    stages.push({
      id: 'budget', title: 'Budget', module: 'Producer Suite',
      href: '/producer/',
      status: subtotal > 0 ? 'done' : (hasBreakdown ? 'active' : 'todo'),
      metrics: subtotal > 0 ? [
        '$' + grand.toLocaleString('en-US') + ' grand total',
        mode,
        actuals > 0 ? '$' + Math.round(actuals).toLocaleString('en-US') + ' actuals posted' : null
      ].filter(Boolean) : [mode, hasBreakdown ? 'Seed the top sheet from the script estimate' : 'Estimates unlock after breakdown'],
      hint: subtotal > 0 ? 'Top sheet live' : 'Open Producer Suite → Budget → ⚡ Seed from script estimate',
      action: 'Open Budget'
    });

    /* 4 · Schedule — strips boarded onto shoot days */
    var board = s.board || {};
    var bScenes = Array.isArray(board.scenes) ? board.scenes : [];
    var boarded = bScenes.filter(function (sc) { return sc && sc.day >= 0; });
    var dayIds = {};
    boarded.forEach(function (sc) { dayIds[sc.day] = 1; });
    var nDays = Object.keys(dayIds).length;
    var plan = s.plan || {};
    stages.push({
      id: 'schedule', title: 'Schedule', module: 'Producer Suite',
      href: '/producer/#schedule',
      status: boarded.length > 0 ? 'done' : (hasBreakdown ? 'active' : 'todo'),
      metrics: boarded.length > 0 ? [
        boarded.length + '/' + bScenes.length + ' scenes boarded',
        nDays + ' shoot day' + (nDays === 1 ? '' : 's'),
        plan.date ? 'Day 1: ' + plan.date : null
      ].filter(Boolean) : [bScenes.length ? bScenes.length + ' strips in the boneyard' : 'Seed scenes from the script'],
      hint: boarded.length > 0 ? 'Stripboard set' : 'Producer Suite → Schedule → seed, then drag strips onto days',
      action: 'Open Schedule'
    });

    /* 5 · Generate — Cinamate AI renders every clip */
    var gpu = s.localGpu || {};
    var bridgeSet = !!(gpu.url || '').trim();
    var genDone = clips.length > 0 && rendered.length === clips.length;
    stages.push({
      id: 'generate', title: 'Generate', module: 'Studio · Cinamate AI',
      href: '/timeline/',
      status: genDone ? 'done' : (rendered.length || generating.length ? 'active' : (hasBreakdown ? 'active' : 'todo')),
      metrics: clips.length ? [
        rendered.length + '/' + clips.length + ' rendered',
        generating.length ? generating.length + ' rendering now' : null,
        bridgeSet ? 'Bridge: ' + gpu.url : 'Bridge not configured'
      ].filter(Boolean) : [bridgeSet ? 'Bridge: ' + gpu.url : 'Bridge not configured', 'Clips appear after breakdown'],
      hint: genDone ? 'All clips rendered on your machine' :
        bridgeSet ? 'Generate All in the Studio renders through your local bridge' :
          'Set the bridge URL (127.0.0.1:3456) in Studio → Settings → Local GPU',
      action: 'Open Studio'
    });

    /* 6 · Review — approve every rendered clip */
    var notes = count(s.reviewNotes);
    var revDone = clips.length > 0 && approved.length === clips.length;
    stages.push({
      id: 'review', title: 'Review', module: 'Studio · Dailies',
      href: '/timeline/',
      status: revDone ? 'done' : (approved.length ? 'active' : (rendered.length ? 'active' : 'todo')),
      metrics: clips.length ? [
        approved.length + '/' + clips.length + ' approved',
        notes ? notes + ' dailies notes' : null
      ].filter(Boolean) : ['Approve clips as they render'],
      hint: revDone ? 'Every clip approved' : 'Approve each take in the Studio; frame-step dailies live in Tools → Dailies Review',
      action: 'Review clips'
    });

    /* 7 · Deliver — finishing kit */
    var deliver = [
      { key: 'captions', label: 'Captions', ok: count(s.captions) > 0 },
      { key: 'credits', label: 'Credit roll', ok: !!(s.credits && (s.credits.text || count(s.credits))) },
      { key: 'epk', label: 'Press kit', ok: !!(s.epk && count(s.epk)) },
      { key: 'export', label: 'Final export', ok: revDone }
    ];
    var deliverDone = deliver.filter(function (d) { return d.ok; }).length;
    stages.push({
      id: 'deliver', title: 'Deliver', module: 'Tools',
      href: '/tools/',
      status: deliverDone === deliver.length ? 'done' : (deliverDone > 0 || revDone ? 'active' : 'todo'),
      metrics: [deliverDone + '/' + deliver.length + ' finishing steps'],
      checklist: deliver,
      hint: 'Captions, credit roll and press kit live in Tools; export the picture from the Studio',
      action: 'Open Tools'
    });

    /* mark the first not-done stage active (single "you are here") */
    var nextUp = null;
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].status !== 'done') { nextUp = stages[i]; if (stages[i].status === 'todo') stages[i].status = 'active'; break; }
    }
    var doneN = stages.filter(function (st) { return st.status === 'done'; }).length;

    return {
      project: tl.projectName || (wr.proj && wr.proj.title) || 'Untitled Film',
      mode: mode,
      stages: stages,
      nextUp: nextUp,
      overallPct: Math.round(100 * doneN / stages.length),
      clips: clips.map(function (c) {
        return {
          num: c.num, label: c.label || '', durationSec: c.durationSec,
          status: c.status === 'approved' ? 'approved' : c.status === 'generating' ? 'generating' : (c.videoUrl ? 'rendered' : 'queued')
        };
      }),
      checks: {
        bridge: bridgeSet ? gpu.url : null,
        model: (tl.global && tl.global.model) || 'local-comfy',
        budgetMode: mode
      }
    };
  }

  root.CWorkflow = { assess: assess, _num: num, _count: count };

  /* ── UI (browser only) ──────────────────────────────────────────── */
  if (typeof document === 'undefined') return;

  function $(id) { return document.getElementById(id); }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function readLS(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }

  function gather() {
    return {
      timeline: readLS('SB_Timeline_v1'),
      writer: readLS('SB_Writer_v1'),
      sheet: readLS('SB_BudgetSheet_v1'),
      budgetPrefs: readLS('SB_Budget_v1'),
      board: readLS('SB_ScheduleBoard_v1'),
      plan: readLS('SB_ShootPlan_v1'),
      sales: readLS('SB_Sales_v1'),
      localGpu: readLS('SB_LocalGPU_v1'),
      captions: readLS('SB_Captions_v1'),
      credits: readLS('SB_Credits_v1'),
      epk: readLS('SB_EPK_v1'),
      crew: readLS('SB_Crew_v1'),
      reviewNotes: readLS('SB_ReviewNotes_v1'),
      drafts: readLS('SB_Drafts_v1')
    };
  }

  var STATUS_LABEL = { done: 'Done', active: 'In progress', todo: 'Up ahead' };

  function render() {
    var a = assess(gather());
    $('wfProject').textContent = a.project;
    $('wfMode').textContent = a.mode;
    $('wfPct').textContent = a.overallPct + '%';
    $('wfBarFill').style.width = a.overallPct + '%';
    $('wfNext').innerHTML = a.nextUp
      ? 'Next up: <b>' + esc(a.nextUp.title) + '</b> — ' + esc(a.nextUp.hint) +
        ' <a class="tb-btn gold" href="' + esc(a.nextUp.href) + '">' + esc(a.nextUp.action) + ' →</a>'
      : 'Pipeline complete — every stage is done. 🎬';

    $('wfStages').innerHTML = a.stages.map(function (st, i) {
      return '<div class="wf-stage ' + st.status + '" data-stage="' + st.id + '">' +
        '<div class="wf-stage-head">' +
        '<span class="wf-stage-n">' + (st.status === 'done' ? '✓' : (i + 1)) + '</span>' +
        '<div><div class="wf-stage-title">' + esc(st.title) + '</div>' +
        '<div class="wf-stage-mod">' + esc(st.module) + '</div></div>' +
        '<span class="wf-badge ' + st.status + '">' + STATUS_LABEL[st.status] + '</span>' +
        '</div>' +
        '<ul class="wf-metrics">' + st.metrics.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' +
        (st.checklist ? '<div class="wf-checks">' + st.checklist.map(function (d) {
          return '<span class="wf-chip ' + (d.ok ? 'good' : '') + '">' + (d.ok ? '✓ ' : '') + esc(d.label) + '</span>';
        }).join('') + '</div>' : '') +
        '<p class="wf-hint">' + esc(st.hint) + '</p>' +
        '<a class="tb-btn' + (st.status === 'active' ? ' gold' : '') + '" href="' + esc(st.href) + '">' + esc(st.action) + '</a>' +
        '</div>';
    }).join('');

    /* generation board */
    var gb = $('wfClips');
    if (!a.clips.length) {
      gb.innerHTML = '<p class="bud-note">No clips yet — the board fills in once the Studio parses your screenplay.</p>';
    } else {
      var order = { generating: 0, queued: 1, rendered: 2, approved: 3 };
      var counts = { queued: 0, generating: 0, rendered: 0, approved: 0 };
      a.clips.forEach(function (c) { counts[c.status]++; });
      gb.innerHTML = '<div class="wf-clipsum">' +
        ['generating', 'queued', 'rendered', 'approved'].map(function (k) {
          return counts[k] ? '<span class="wf-chip ' + k + '">' + counts[k] + ' ' + k + '</span>' : '';
        }).join('') + '</div>' +
        '<div class="wf-clipgrid">' + a.clips.slice().sort(function (x, y) {
          return (order[x.status] - order[y.status]) || ((x.num || 0) - (y.num || 0));
        }).map(function (c) {
          return '<a class="wf-clip ' + c.status + '" href="/timeline/" title="' + esc(c.label) + ' — ' + c.status + '">' +
            '<b>' + String(c.num || '·').toString().padStart(2, '0') + '</b> ' + esc((c.label || '').slice(0, 26)) +
            '<span>' + c.status + (c.durationSec ? ' · ~' + c.durationSec + 's' : '') + '</span></a>';
        }).join('') + '</div>';
    }

    /* system checks */
    var checks = [];
    checks.push(a.checks.bridge
      ? { ok: true, label: 'Cinamate AI bridge · ' + a.checks.bridge, id: 'bridge' }
      : { ok: false, label: 'Cinamate AI bridge not configured — set it in Studio → Settings → Local GPU', id: 'bridge' });
    checks.push({ ok: true, label: 'Model: Cinamate AI (renders on your machine)', id: 'model' });
    checks.push({ ok: true, label: 'Project type: ' + a.checks.budgetMode, id: 'mode' });
    $('wfChecks').innerHTML = checks.map(function (c) {
      return '<span class="wf-chip ' + (c.ok ? 'good' : 'warn') + '" data-check="' + c.id + '">' + (c.ok ? '✓' : '△') + ' ' + esc(c.label) + '</span>';
    }).join('');

    /* live bridge ping (best effort; only when configured) */
    if (a.checks.bridge) pingBridge(a.checks.bridge);
  }

  var _pinged = '';
  function pingBridge(url) {
    if (_pinged === url) return;
    _pinged = url;
    var base = url.replace(/\/+$/, '');
    var ctl = ('AbortController' in root) ? new AbortController() : null;
    var timer = ctl && setTimeout(function () { ctl.abort(); }, 2500);
    fetch(base + '/health', ctl ? { signal: ctl.signal } : {})
      .then(function (r) { return r.ok; })
      .catch(function () { return false; })
      .then(function (up) {
        if (timer) clearTimeout(timer);
        var el = document.querySelector('[data-check="bridge"]');
        if (!el) return;
        el.classList.remove('good', 'warn');
        el.classList.add(up ? 'good' : 'warn');
        el.textContent = (up ? '✓ Cinamate AI bridge online · ' : '△ Bridge configured but not reachable right now · ') + url;
      });
  }

  function init() {
    render();
    /* stay live: re-render when another tab saves, or on return to this tab */
    root.addEventListener('storage', function () { _pinged = ''; render(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { _pinged = ''; render(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
