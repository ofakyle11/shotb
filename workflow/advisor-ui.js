/* CINAMATE Advisor — UI on the Workflow page. Computes the film's
 * analysis via SBBudget.analyze, then renders prep actions, the
 * jurisdiction ranking and the staffing plan, with one-click Apply
 * buttons that write into the target modules. Original code.
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var A = window.CAdvisor, B = window.SBBudget;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function readLS(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var toastTimer;
  function toast(m) {
    var el = $('wfToast'); if (!el) return;
    el.textContent = m; el.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('on'); }, 3000);
  }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  var SEV = { high: ['#A65D5D', 'NOW'], med: ['#5B8DB8', 'SOON'], low: ['#6A7E94', 'NEXT'], ok: ['#4A8B7A', 'CLEAR'] };

  var lastStaffing = null;

  function compute() {
    var tl = readLS('SB_Timeline_v1') || {};
    var prefs = readLS('SB_Budget_v1') || {};
    var sheet = readLS('SB_BudgetSheet_v1') || {};
    var analysis = null;
    try { analysis = B && B.analyze ? B.analyze(tl) : null; } catch (e) {}
    var subtotal = 0;
    (sheet.categories || []).forEach(function (c) {
      (c.items || []).forEach(function (i) { subtotal += parseFloat(i.est) || 0; });
    });
    var budget = subtotal > 0 ? Math.round(subtotal * (1 + (parseFloat(sheet.contingencyPct) || 0) / 100)) : 0;
    var looks = A.wantedLooks(tl.scriptText || '', analysis && analysis.genre);
    return {
      tl: tl, prefs: prefs, analysis: analysis, looks: looks,
      budget: budget || 5e6, budgetIsPlaceholder: !budget
    };
  }

  function render() {
    var host = $('wfAdvisor'); if (!host || !A) return;
    var c = compute();
    var h = '';

    /* prep actions */
    var acts = A.prepActions({
      timeline: c.tl, writer: readLS('SB_Writer_v1'), analysis: c.analysis,
      sheet: readLS('SB_BudgetSheet_v1'), budgetPrefs: c.prefs,
      roles: readLS('SB_Roles_v1'), crew: readLS('SB_Crew_v1'),
      locations: readLS('SB_Locations_v1'), insurance: readLS('SB_Insurance_v1'),
      clearance: readLS('SB_Clearance_v1'), delivery: readLS('SB_Delivery_v1'),
      plan: readLS('SB_ShootPlan_v1'), cut: readLS('SB_Cut_v1')
    });
    h += '<div class="wf-adv-acts">' + acts.map(function (x) {
      var s = SEV[x.sev] || SEV.low;
      return '<a class="wf-adv-act" href="' + CinUrl.safe(x.href) + '">' +
        '<span class="wf-adv-sev" style="background:' + s[0] + '22;color:' + s[0] + '">' + s[1] + '</span>' +
        '<span>' + esc(x.text) + '</span><b>' + esc(x.label) + ' →</b></a>';
    }).join('') + '</div>';

    /* locations */
    if (B && B.INCENTIVES) {
      var recs = A.recommendLocations({ budget: c.budget, looks: c.looks, incentives: B.INCENTIVES }).slice(0, 3);
      h += '<h3 class="wf-adv-h">Where to shoot it' +
        '<span class="wf-dim"> — ' + (c.looks.length ? 'the script wants: ' + c.looks.join(', ') : 'no look cues found yet') +
        ' · modeled on ' + money(c.budget) + (c.budgetIsPlaceholder ? ' (placeholder until the budget is seeded)' : ' from the top sheet') + '</span></h3>';
      h += '<div class="wf-adv-grid">' + recs.map(function (r, i) {
        return '<div class="wf-adv-card' + (i === 0 ? ' top' : '') + '">' +
          '<div class="wf-adv-cardhead"><b>' + esc(r.label) + '</b><span class="wf-chip good">' + money(r.recovery) + ' back</span></div>' +
          '<ul class="wf-metrics">' + r.reasons.slice(0, 4).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
          '<button class="tb-btn' + (i === 0 ? ' gold' : '') + '" data-inc="' + esc(r.id) + '">Model this jurisdiction</button>' +
          '</div>';
      }).join('') + '</div>';
    }

    /* staffing */
    var st = A.recommendStaffing({
      analysis: c.analysis || {},
      scale: c.prefs.scale || 'indie',
      mode: c.prefs.mode === 'documentary' ? 'documentary' : 'scripted'
    });
    lastStaffing = st;
    h += '<h3 class="wf-adv-h">Who to hire for this style' +
      '<span class="wf-dim"> — ' + esc((c.analysis && c.analysis.genre) || 'film') + ' · ' + esc(c.prefs.scale || 'indie') + ' scale · ' + st.total + ' core positions</span></h3>';
    h += '<div class="bud-tablewrap"><table class="bud-table"><thead><tr><th>Dept</th><th>Role</th><th>#</th><th>Why</th></tr></thead><tbody>' +
      st.plan.map(function (p) {
        return '<tr><td>' + esc(p.dept) + '</td><td>' + esc(p.role) + '</td><td style="font-family:var(--mono)">' + esc(p.count) + '</td><td class="wf-dim" style="font-size:10px">' + esc(p.why) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="wf-adv-foot"><button class="tb-btn gold" id="wfAdvSeedCrew">Seed these as open positions in Crew</button>' +
      '<span class="wf-dim">' + esc(st.note) + '</span></p>';

    if (window.CLearn) {
      var L = CLearn.summary();
      h += '<p class="wf-adv-foot wf-dim" style="font-size:10px;color:var(--dim)">Self-learning: ' +
        (L.budgetLines ? esc(L.budgetLines) + ' budget actuals learned (avg correction ×' + esc(L.avgMult) + ')' : 'no budget actuals learned yet — fill the Actual column as invoices land') +
        ' · ' + (L.renders ? L.renders + ' renders timed — your machine averages ' + L.wallPerClip + 's/clip (' + L.trend + ')' : 'render speed not measured yet') +
        (L.cached ? ' · ' + L.cached + ' research lookups cached' : '') + '</p>';
    }
    host.innerHTML = h;

    host.querySelectorAll('[data-inc]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-inc');
        var prefs = readLS('SB_Budget_v1') || {};
        prefs.incentive = id;
        writeLS('SB_Budget_v1', prefs);
        toast('Jurisdiction modeled — the Studio estimate and Producer Suite now assume ' + id);
        render();
      });
    });
    var seed = $('wfAdvSeedCrew');
    if (seed) seed.addEventListener('click', function () {
      var rows = readLS('SB_Crew_v1') || [];
      if (!Array.isArray(rows)) rows = [];
      var have = {};
      rows.forEach(function (r) { have[(r.role || '').toLowerCase()] = 1; });
      var UNION = { Camera: 'IATSE', 'G&E': 'IATSE', Art: 'IATSE', Sound: 'IATSE', Wardrobe: 'IATSE', HMU: 'IATSE', Edit: 'IATSE', Post: 'Non-union', Production: 'Non-union' };
      var added = 0;
      (lastStaffing ? lastStaffing.plan : []).forEach(function (p) {
        if (have[p.role.toLowerCase()]) return;
        for (var k = 0; k < p.count; k++) {
          rows.unshift({
            id: 'adv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: '(open position)', role: p.role, dept: p.dept,
            union: UNION[p.dept] || 'Non-union', rate: '', phone: '', email: '',
            dietary: '', emergency: ''
          });
          added++;
        }
      });
      writeLS('SB_Crew_v1', rows);
      toast(added + ' open positions added to the Crew register');
    });
  }

  var css = document.createElement('style');
  css.textContent =
    '.wf-adv-acts{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}' +
    '.wf-adv-act{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:9px 12px;font-size:12px;color:var(--text2);text-decoration:none}' +
    '.wf-adv-act:hover{border-color:var(--border2)}' +
    '.wf-adv-act b{margin-left:auto;color:var(--gold);font-size:11px;white-space:nowrap}' +
    '.wf-adv-sev{font-size:8px;font-weight:800;border-radius:4px;padding:2px 6px;letter-spacing:.06em;flex-shrink:0}' +
    '.wf-adv-h{font-size:12px;color:var(--gold);letter-spacing:.06em;text-transform:uppercase;margin:18px 0 8px}' +
    '.wf-adv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}' +
    '.wf-adv-card{background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:12px;display:flex;flex-direction:column;gap:8px}' +
    '.wf-adv-card.top{border-color:var(--gold)}' +
    '.wf-adv-cardhead{display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap;font-size:12px}' +
    '.wf-adv-card .tb-btn{align-self:flex-start}' +
    '.wf-adv-foot{display:flex;align-items:center;gap:12px;margin-top:8px;flex-wrap:wrap}';
  document.head.appendChild(css);

  function init() {
    render();
    window.addEventListener('storage', render);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.CAdvisorUI = { render: render };
})();
