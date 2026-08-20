/* CINAMATE Production Office — UI for casting/sides, locations,
 * continuity, camera & sound reports, daily production report, VFX,
 * cue sheet, clearances, delivery QC and residuals.
 * Registers: /tools/tools-core.js · Sun: /tools/lib-sun.js ·
 * Engine: lib-prod.js. All original code, written for Cinamate.
 */
(function () {
  'use strict';
  var T = window.TCore, P = window.CProd, Sun = window.TSun;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function readLS(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function dl(name, text, mime) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
    a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }
  function charNames() {
    var tl = readLS('SB_Timeline_v1');
    var cs = (tl && tl.characters) || [];
    return (Array.isArray(cs) ? cs : Object.keys(cs))
      .map(function (c) { return typeof c === 'string' ? c : (c.name || ''); })
      .filter(Boolean);
  }

  var inited = {};
  var PANES = {};

  /* ── Casting & Sides ────────────────────────────────────────────── */
  PANES.casting = function (pane) {
    pane.innerHTML = '<div class="pr-two">' +
      '<div class="pr-panel"><h4>Roles</h4><div id="prRoles"></div></div>' +
      '<div class="pr-panel"><h4>Candidates</h4><div id="prCands"></div></div></div>' +
      '<h4 style="padding:0 14px;font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:.06em;margin-top:16px">Audition sides</h4>' +
      '<div class="pr-inline"><label>Character <select class="uc-sel" id="prSideChar"></select></label>' +
      '<button class="tb-btn gold" id="prSideGo">Build sides</button>' +
      '<button class="tb-btn" id="prSidePrint">🖨 Print</button>' +
      '<button class="tb-btn" id="prSideDl">⬇ .txt</button>' +
      '<span class="ps-hint">Scenes are pulled from the Studio screenplay where the character appears</span></div>' +
      '<div class="pr-sides" id="prSidesOut">Pick a character and build sides.</div>' +
      '<h4 style="padding:0 14px;font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:.06em;margin-top:18px">Cast intelligence</h4>' +
      '<div class="pr-inline">' +
      '<label>TMDB key <input id="prTmdbKey" type="password" style="width:130px" placeholder="optional" title="Free key from themoviedb.org — adds demand index + billing data. Stored only in this browser. Works without it via Wikidata."></label>' +
      '<label>Actor <input id="prCiActor" style="width:150px" placeholder="Name"></label>' +
      '<label>Target director <input id="prCiDir" style="width:150px" placeholder="Who you want at the helm"></label>' +
      '<button class="tb-btn gold" id="prCiGo">Analyze</button>' +
      '<button class="tb-btn" id="prCiSuggest" title="The director\'s frequent collaborators, ranked">✨ Suggest cast for this director</button>' +
      '</div>' +
      '<div id="prCiOut" style="padding:0 14px 14px"></div>';

    var roles = new T.Register({
      key: 'SB_Roles_v1', title: 'Roles',
      hint: 'Seeded from the Studio character list — add scale/day-player roles freely',
      fields: [
        { id: 'role', label: 'Role', width: '16%' },
        { id: 'type', label: 'Type', type: 'select', options: ['Lead', 'Supporting', 'Day player', 'Featured extra'], width: '13%' },
        { id: 'status', label: 'Status', type: 'select', options: ['Open', 'Auditioning', 'Offer out', 'Cast'], width: '13%' },
        { id: 'cast', label: 'Cast as', width: '18%' },
        { id: 'rate', label: 'Rate', width: '12%' },
        { id: 'notes', label: 'Notes' }
      ],
      summary: function (rows) {
        var open = rows.filter(function (r) { return r.status !== 'Cast'; }).length;
        return rows.length + ' roles · <b>' + (rows.length - open) + ' cast</b> · ' + open + ' open';
      },
      blank: function () { return { role: '', type: 'Supporting', status: 'Open', cast: '', rate: '', notes: '' }; }
    });
    if (!roles.rows.length) {
      charNames().slice(0, 12).forEach(function (n, i) {
        roles.add({ role: n, type: i < 2 ? 'Lead' : 'Supporting', status: 'Open', cast: '', rate: '', notes: '' });
      });
    }
    roles.render('prRoles');

    new T.Register({
      key: 'SB_Candidates_v1', title: 'Candidates',
      hint: 'Track auditions and self-tapes per role',
      fields: [
        { id: 'name', label: 'Actor', width: '18%' },
        { id: 'role', label: 'For role', width: '14%' },
        { id: 'contact', label: 'Rep / contact', width: '20%' },
        { id: 'tape', label: 'Tape link', width: '18%' },
        { id: 'verdict', label: 'Verdict', type: 'select', options: ['—', 'Callback', 'Pass', 'Pin', 'Offer'], width: '12%' },
        { id: 'notes', label: 'Notes' }
      ],
      blank: function () { return { name: '', role: '', contact: '', tape: '', verdict: '—', notes: '' }; }
    }).render('prCands');

    function fillChars() {
      var names = charNames();
      $('prSideChar').innerHTML = names.length
        ? names.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('')
        : '<option value="">(no script characters yet)</option>';
    }
    fillChars();
    var lastSides = '';
    $('prSideGo').addEventListener('click', function () {
      var tl = readLS('SB_Timeline_v1');
      var who = $('prSideChar').value;
      if (!who) return T.toast('Parse a screenplay in the Studio first');
      var sides = P.sidesFor((tl && tl.scriptText) || '', who);
      if (!sides.length) { $('prSidesOut').textContent = 'No scenes found for ' + who + '.'; return; }
      lastSides = 'AUDITION SIDES — ' + who + '\n' + ((tl && tl.projectName) || '') + '\n' + '='.repeat(48) + '\n\n' +
        sides.map(function (s) { return s.text; }).join('\n\n' + '-'.repeat(48) + '\n\n');
      $('prSidesOut').textContent = lastSides;
      T.toast(sides.length + ' scene' + (sides.length === 1 ? '' : 's') + ' of sides built');
    });
    $('prSidePrint').addEventListener('click', function () { window.print(); });
    $('prSideDl').addEventListener('click', function () {
      if (!lastSides) return T.toast('Build sides first');
      dl('sides-' + $('prSideChar').value.toLowerCase() + '.txt', lastSides);
    });

    wireCastIntel();
  };

  /* ── Locations ──────────────────────────────────────────────────── */
  PANES.locations = function (pane) {
    pane.innerHTML = '<div id="prLocs"></div>' +
      '<div class="pr-inline"><label>Sun check — lat <input id="prLocLat" style="width:70px" placeholder="34.05"></label>' +
      '<label>lon <input id="prLocLon" style="width:76px" placeholder="-118.24"></label>' +
      '<label>date <input type="date" id="prLocDate"></label>' +
      '<button class="tb-btn gold" id="prLocSun">☀ Sun times</button>' +
      '<span class="ps-hint" id="prLocSunOut"></span></div>' +
      '<p class="pr-note">Golden-hour planning per location — the schedule-wide planner lives in Producer Suite → Schedule.</p>';
    new T.Register({
      key: 'SB_Locations_v1', title: 'Locations',
      hint: 'Scouted locations, permits and practical notes; expiry chip = permit date',
      expiryField: 'permitDate',
      fields: [
        { id: 'name', label: 'Location', width: '16%' },
        { id: 'scenes', label: 'Scenes', width: '10%' },
        { id: 'address', label: 'Address / pin', width: '20%' },
        { id: 'contact', label: 'Contact', width: '14%' },
        { id: 'permit', label: 'Permit', type: 'select', options: ['Not needed', 'Applied', 'Issued', 'Denied'], width: '11%' },
        { id: 'permitDate', label: 'Permit date', type: 'date', width: '12%' },
        { id: 'notes', label: 'Power / parking / sound' }
      ],
      summary: function (rows) {
        var ok = rows.filter(function (r) { return r.permit === 'Issued' || r.permit === 'Not needed'; }).length;
        return rows.length + ' locations · <b>' + ok + '</b> clear to shoot';
      },
      blank: function () { return { name: '', scenes: '', address: '', contact: '', permit: 'Not needed', permitDate: '', notes: '' }; }
    }).render('prLocs');
    $('prLocSun').addEventListener('click', function () {
      var lat = parseFloat($('prLocLat').value), lon = parseFloat($('prLocLon').value);
      var d = $('prLocDate').value || new Date().toISOString().slice(0, 10);
      if (!isFinite(lat) || !isFinite(lon)) return T.toast('Enter lat/lon');
      var t = Sun.sunTimes(d, lat, lon);
      $('prLocSunOut').innerHTML = 'sunrise ' + Sun.fmtLocal(t.sunrise) + ' · golden pm ' +
        '<b style="color:var(--gold)">' + Sun.fmtLocal(t.goldenStartPM) + '</b> · sunset ' + Sun.fmtLocal(t.sunset);
    });
  };

  /* ── Continuity ─────────────────────────────────────────────────── */
  PANES.continuity = function (pane) {
    pane.innerHTML = '<div id="prCont"></div>' +
      '<p class="pr-note">Script-supervisor log: circled takes and matching notes per scene. Take-by-take capture lives in Tools → Slate &amp; Takes.</p>';
    new T.Register({
      key: 'SB_Continuity_v1', title: 'Continuity',
      hint: 'One row per scene/setup — wardrobe, props, screen direction, circled take',
      fields: [
        { id: 'scene', label: 'Scene', width: '8%' },
        { id: 'setup', label: 'Setup', width: '8%' },
        { id: 'circled', label: 'Circled take', width: '10%' },
        { id: 'direction', label: 'Screen dir.', type: 'select', options: ['L→R', 'R→L', 'Neutral'], width: '10%' },
        { id: 'wardrobe', label: 'Wardrobe / props', width: '26%' },
        { id: 'notes', label: 'Matching notes' }
      ],
      summary: function (rows) { return rows.length + ' setups logged'; },
      blank: function () { return { scene: '', setup: '', circled: '', direction: 'Neutral', wardrobe: '', notes: '' }; }
    }).render('prCont');
  };

  /* ── Camera & Sound reports ─────────────────────────────────────── */
  PANES.reports = function (pane) {
    pane.innerHTML = '<div class="pr-two">' +
      '<div class="pr-panel"><h4>Camera reports</h4><div id="prCam"></div></div>' +
      '<div class="pr-panel"><h4>Sound reports</h4><div id="prSnd"></div></div></div>';
    new T.Register({
      key: 'SB_CameraReports_v1', title: 'Camera',
      fields: [
        { id: 'date', label: 'Date', type: 'date', width: '14%' },
        { id: 'roll', label: 'Roll', width: '10%' },
        { id: 'scene', label: 'Scene', width: '10%' },
        { id: 'lens', label: 'Lens', width: '12%' },
        { id: 'stop', label: 'Stop', width: '10%' },
        { id: 'filter', label: 'Filter', width: '12%' },
        { id: 'notes', label: 'Notes' }
      ],
      blank: function () { return { date: T.today(), roll: '', scene: '', lens: '', stop: '', filter: '', notes: '' }; }
    }).render('prCam');
    new T.Register({
      key: 'SB_SoundReports_v1', title: 'Sound',
      fields: [
        { id: 'date', label: 'Date', type: 'date', width: '14%' },
        { id: 'roll', label: 'Roll', width: '10%' },
        { id: 'scene', label: 'Scene', width: '10%' },
        { id: 'tc', label: 'TC', width: '14%' },
        { id: 'mics', label: 'Mics', width: '16%' },
        { id: 'notes', label: 'Notes (wild lines, room tone)' }
      ],
      blank: function () { return { date: T.today(), roll: '', scene: '', tc: '', mics: '', notes: '' }; }
    }).render('prSnd');
  };

  /* ── Daily Production Report ────────────────────────────────────── */
  PANES.dpr = function (pane) {
    pane.innerHTML = '<div class="pr-inline">' +
      '<label>Report date <input type="date" id="prDprDate" value="' + T.today() + '"></label>' +
      '<label>Notes <input id="prDprNotes" style="width:280px" placeholder="Weather delays, incidents, visitors…"></label>' +
      '<button class="tb-btn gold" id="prDprGo">Build report</button>' +
      '<button class="tb-btn" id="prDprPrint">🖨 Print</button>' +
      '<button class="tb-btn" id="prDprDl">⬇ .txt</button></div>' +
      '<div class="pr-report" id="prDprOut" style="margin:0 14px">Pick a date and build — the report assembles itself from the take log, timecards, hot costs and the stripboard.</div>';
    var last = '';
    function build() {
      var d = P.dpr({
        takes: readLS('SB_TakeLog_v1'),
        timecards: readLS('SB_Timecards_v1'),
        hotcost: readLS('SB_HotCost_v1'),
        board: readLS('SB_ScheduleBoard_v1'),
        plan: readLS('SB_ShootPlan_v1'),
        timeline: readLS('SB_Timeline_v1')
      }, { date: $('prDprDate').value, notes: $('prDprNotes').value });
      last = P.dprText(d);
      $('prDprOut').textContent = last;
      T.toast('Report built from live production data');
    }
    $('prDprGo').addEventListener('click', build);
    $('prDprPrint').addEventListener('click', function () { window.print(); });
    $('prDprDl').addEventListener('click', function () {
      if (!last) return T.toast('Build the report first');
      dl('dpr-' + $('prDprDate').value + '.txt', last);
    });
  };

  /* ── VFX ────────────────────────────────────────────────────────── */
  PANES.vfx = function (pane) {
    pane.innerHTML = '<div id="prVfx"></div>';
    new T.Register({
      key: 'SB_VfxShots_v1', title: 'VFX shots',
      hint: 'One row per shot — versions climb as vendors deliver',
      expiryField: 'due',
      fields: [
        { id: 'shot', label: 'Shot ID', width: '12%' },
        { id: 'scene', label: 'Scene', width: '8%' },
        { id: 'desc', label: 'Work description', width: '24%' },
        { id: 'vendor', label: 'Vendor / artist', width: '14%' },
        { id: 'version', label: 'Ver', width: '7%' },
        { id: 'status', label: 'Status', type: 'select', options: ['Brief', 'In progress', 'Review', 'Retake', 'Final'], width: '12%' },
        { id: 'due', label: 'Due', type: 'date', width: '11%' },
        { id: 'notes', label: 'Notes' }
      ],
      summary: function (rows) {
        var fin = rows.filter(function (r) { return r.status === 'Final'; }).length;
        return rows.length + ' shots · <b>' + fin + ' final</b> · ' + (rows.length - fin) + ' open';
      },
      blank: function () { return { shot: 'VFX' + String(101 + Math.floor(Math.random() * 890)), scene: '', desc: '', vendor: '', version: 'v1', status: 'Brief', due: '', notes: '' }; }
    }).render('prVfx');
  };

  /* ── Cue sheet ──────────────────────────────────────────────────── */
  PANES.cues = function (pane) {
    pane.innerHTML = '<div class="pr-inline">' +
      '<button class="tb-btn gold" id="prCueSeed">⚡ Pull cues from the Editor timeline</button>' +
      '<button class="tb-btn" id="prCueCsv">⬇ Cue sheet CSV</button>' +
      '<span class="ps-hint">PROs require a cue sheet for every broadcast — timings come straight from your cut\'s audio track</span></div>' +
      '<div id="prCueReg"></div>';
    var reg = new T.Register({
      key: 'SB_CueSheet_v1', title: 'Cues',
      fields: [
        { id: 'title', label: 'Cue title', width: '20%' },
        { id: 'tcIn', label: 'TC in', width: '12%' },
        { id: 'tcOut', label: 'TC out', width: '12%' },
        { id: 'use', label: 'Use', type: 'select', options: ['BI', 'BV', 'VI', 'VV', 'MT', 'ET'], width: '8%' },
        { id: 'composer', label: 'Composer', width: '16%' },
        { id: 'publisher', label: 'Publisher', width: '16%' },
        { id: 'society', label: 'Society', width: '10%' }
      ],
      summary: function (rows) { return rows.length + ' cues · BI=background instr., VV=visual vocal, MT/ET=main & end title'; },
      blank: function () { return { title: '', tcIn: '', tcOut: '', use: 'BI', composer: '', publisher: '', society: '' }; }
    });
    reg.render('prCueReg');
    $('prCueSeed').addEventListener('click', function () {
      var cues = P.cueSheet(readLS('SB_Cut_v1'));
      if (!cues.length) return T.toast('No audio on the Editor timeline yet');
      var have = {};
      reg.rows.forEach(function (r) { have[r.title + r.tcIn] = 1; });
      var added = 0;
      cues.forEach(function (c) {
        if (have[c.title + c.tcIn]) return;
        reg.add({ title: c.title, tcIn: c.tcIn, tcOut: c.tcOut, use: c.use, composer: '', publisher: '', society: '' });
        added++;
      });
      reg.render('prCueReg');
      T.toast(added + ' cue' + (added === 1 ? '' : 's') + ' pulled from the cut');
    });
    $('prCueCsv').addEventListener('click', function () {
      dl('cue-sheet.csv', P.cueCsv(reg.rows.map(function (r, i) {
        return { n: i + 1, title: r.title, tcIn: r.tcIn, tcOut: r.tcOut, durSec: '', use: r.use, composer: r.composer, publisher: r.publisher, society: r.society };
      })), 'text/csv');
    });
  };

  /* ── Clearances ─────────────────────────────────────────────────── */
  PANES.clearance = function (pane) {
    pane.innerHTML = '<div id="prClear"></div>' +
      '<p class="pr-note">Anything visible or audible that someone else owns: brands, artwork, music, real people, real places. Estimates, not legal advice — clear anything doubtful with production counsel.</p>';
    new T.Register({
      key: 'SB_Clearance_v1', title: 'Clearances',
      fields: [
        { id: 'item', label: 'Item', width: '20%' },
        { id: 'type', label: 'Type', type: 'select', options: ['Brand/product', 'Music', 'Artwork', 'Likeness', 'Location', 'Footage', 'Text/quote'], width: '13%' },
        { id: 'scene', label: 'Scene', width: '8%' },
        { id: 'status', label: 'Status', type: 'select', options: ['Flagged', 'Clearing', 'Cleared', 'Removed', 'Fair-use opinion'], width: '13%' },
        { id: 'holder', label: 'Rights holder', width: '18%' },
        { id: 'notes', label: 'Notes' }
      ],
      summary: function (rows) {
        var open = rows.filter(function (r) { return r.status === 'Flagged' || r.status === 'Clearing'; }).length;
        return rows.length + ' items · <b style="color:' + (open ? 'var(--red)' : 'var(--green)') + '">' + open + ' open</b>';
      },
      blank: function () { return { item: '', type: 'Brand/product', scene: '', status: 'Flagged', holder: '', notes: '' }; }
    }).render('prClear');
  };

  /* ── Delivery QC ────────────────────────────────────────────────── */
  PANES.delivery = function (pane) {
    pane.innerHTML = '<div class="pr-inline"><button class="tb-btn gold" id="prDelSeed">⚡ Seed the standard deliverables list</button>' +
      '<span class="ps-hint">The list distributors actually ask for — tick items off as they are QC\'d</span></div>' +
      '<div id="prDel"></div>';
    var reg = new T.Register({
      key: 'SB_Delivery_v1', title: 'Delivery',
      fields: [
        { id: 'group', label: 'Group', type: 'select', options: ['Picture', 'Audio', 'Subtitling', 'Music', 'Legal', 'Art', 'Docs'], width: '12%' },
        { id: 'item', label: 'Deliverable', width: '38%' },
        { id: 'status', label: 'Status', type: 'select', options: ['todo', 'in QC', 'passed', 'delivered', 'n/a'], width: '12%' },
        { id: 'notes', label: 'Notes / file reference' }
      ],
      summary: function (rows) {
        var done = rows.filter(function (r) { return r.status === 'passed' || r.status === 'delivered' || r.status === 'n/a'; }).length;
        return rows.length + ' deliverables · <b>' + done + '</b> cleared';
      },
      blank: function () { return { group: 'Picture', item: '', status: 'todo', notes: '' }; }
    });
    reg.render('prDel');
    $('prDelSeed').addEventListener('click', function () {
      if (reg.rows.length && !confirm('Add the standard template rows to the existing list?')) return;
      P.deliveryTemplate().forEach(function (row) { reg.add({ group: row.group, item: row.item, status: 'todo', notes: '' }); });
      reg.render('prDel');
      T.toast('Standard deliverables seeded');
    });
  };

  /* ── Residuals ──────────────────────────────────────────────────── */
  PANES.residuals = function (pane) {
    pane.innerHTML = '<div class="pr-inline">' +
      '<label>SVOD gross $<input id="prResSvod" style="width:110px" placeholder="1,000,000"></label>' +
      '<label>TV $<input id="prResTv" style="width:100px" placeholder="500,000"></label>' +
      '<label>AVOD $<input id="prResAvod" style="width:100px" placeholder="0"></label>' +
      '<label>Home video $<input id="prResHv" style="width:100px" placeholder="200,000"></label>' +
      '<button class="tb-btn gold" id="prResGo">Estimate</button></div>' +
      '<div id="prResOut" style="padding:0 14px"></div>' +
      '<p class="pr-note">Industry-convention guild percentages on post-initial-market distributor\'s gross (home video on the customary 20% royalty base). Actual obligations depend on the agreements in force — an estimate for the waterfall, not accounting advice.</p>';
    function n(v) { return parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0; }
    $('prResGo').addEventListener('click', function () {
      var r = P.residuals({
        svod: n($('prResSvod').value), tv: n($('prResTv').value),
        avod: n($('prResAvod').value), homeVideo: n($('prResHv').value)
      });
      $('prResOut').innerHTML = '<div class="bud-tablewrap"><table class="bud-table"><thead><tr><th>Guild</th><th>Rate</th><th>Estimated residuals</th></tr></thead><tbody>' +
        r.lines.map(function (l) {
          return '<tr><td>' + esc(l.guild) + '</td><td>' + (l.rate * 100).toFixed(1) + '%</td><td style="font-family:var(--mono)">$' + l.amount.toLocaleString('en-US') + '</td></tr>';
        }).join('') +
        '<tr><td><b>Total</b></td><td></td><td style="font-family:var(--mono);color:var(--gold)"><b>$' + r.total.toLocaleString('en-US') + '</b></td></tr>' +
        '</tbody></table></div>' +
        '<p class="bud-note">Royalty base $' + r.base.toLocaleString('en-US') + ' — fold this into Producer Suite → Sales as a distribution cost.</p>';
    });
  };

  /* ── Cast intelligence (engine: lib-cast.js) ────────────────────── */
  function wireCastIntel() {
    var CC = window.CCast;
    var saved = readLS('SB_TMDB_v1') || {};
    $('prTmdbKey').value = saved.key || '';
    $('prTmdbKey').addEventListener('change', function () {
      try { localStorage.setItem('SB_TMDB_v1', JSON.stringify({ key: this.value.trim() })); } catch (e) {}
      T.toast(this.value.trim() ? 'TMDB key saved in this browser' : 'TMDB key cleared');
    });
    function tmdbKey() { var k = readLS('SB_TMDB_v1'); return (k && k.key) || ''; }
    async function tmdb(path, params) {
      var qs = Object.assign({ api_key: tmdbKey() }, params || {});
      var u = 'https://api.themoviedb.org/3' + path + '?' + Object.keys(qs).map(function (x) { return x + '=' + encodeURIComponent(qs[x]); }).join('&');
      var ck = 'tmdb:' + path + ':' + JSON.stringify(params || {});
      var hit = window.CLearn && CLearn.cacheGet(ck);
      if (hit) return hit;
      var r = await fetch(u);
      if (!r.ok) throw new Error('TMDB ' + r.status + (r.status === 401 ? ' — check the key' : ''));
      var j = await r.json();
      if (window.CLearn) CLearn.cachePut(ck, j);
      return j;
    }
    async function sparql(q) {
      var ck = 'wd:' + q.slice(0, 200);
      var hit = window.CLearn && CLearn.cacheGet(ck);
      if (hit) return hit;
      var r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { Accept: 'application/sparql-results+json' } });
      if (!r.ok) throw new Error('Wikidata ' + r.status);
      var j = await r.json();
      if (window.CLearn) CLearn.cachePut(ck, j);
      return j;
    }
    var lastCard = null;
    function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
    function quoteBlock(q) {
      return '<div class="pr-ci-quote"><b>' + esc(q.tier) + '</b> · ' + money(q.low) + ' – ' + money(q.high) +
        '<ul>' + q.basis.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' +
        '<span class="ps-hint">Estimate from public career data — enter a known quote to override: </span>' +
        '<input id="prCiKnown" style="width:110px" placeholder="e.g. 250000"> <button class="tb-btn" id="prCiKnownGo">Apply</button></div>';
    }
    function renderCard(d) {
      lastCard = d;
      var h = '<div class="pr-ci-card">';
      h += '<div class="pr-ci-head"><b>' + esc(d.name) + '</b>' +
        (d.popularity ? '<span class="wf-chip good">demand ' + Math.round(d.popularity) + '</span>' : '<span class="ps-hint">no TMDB key — Wikidata data only</span>') + '</div>';
      if (d.films.length) {
        h += '<div class="pr-ci-sec">Last films</div><table class="bud-table"><tbody>' +
          d.films.slice(0, 8).map(function (f) {
            return '<tr><td style="font-family:var(--mono);width:52px">' + (f.year || '—') + '</td><td>' + esc(f.title) + '</td><td class="ps-hint">' +
              esc(f.role || (f.directors && f.directors.length ? 'dir. ' + f.directors.join(', ') : '')) +
              (f.order != null && f.order <= 2 ? ' · top-billed' : '') + '</td></tr>';
          }).join('') + '</tbody></table>';
      }
      if (d.directors.length) {
        h += '<div class="pr-ci-sec">Directors they\'ve worked with</div><div class="pr-ci-chips">' +
          d.directors.slice(0, 8).map(function (x) { return '<span class="wf-chip">' + esc(x.name) + ' ×' + x.films + '</span>'; }).join('') + '</div>';
      }
      if (d.fit) {
        h += '<div class="pr-ci-sec">Fit with ' + esc(d.dirName) + ' — <b style="color:var(--gold)">' + d.fit.score + '/100</b></div>' +
          '<div class="pr-ci-bar"><div style="width:' + d.fit.score + '%"></div></div>' +
          '<ul class="pr-ci-reasons">' + d.fit.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
      }
      h += '<div class="pr-ci-sec">Quote estimate</div>' + quoteBlock(d.quote);
      h += '<p style="margin-top:10px"><button class="tb-btn gold" id="prCiAdd">+ Add as candidate</button></p></div>';
      $('prCiOut').innerHTML = h;
      var kg = $('prCiKnownGo');
      if (kg) kg.addEventListener('click', function () {
        var v = parseFloat(String($('prCiKnown').value).replace(/[^0-9.]/g, ''));
        d.quote = CC.quote({ knownQuote: v });
        renderCard(d);
      });
      var add = $('prCiAdd');
      if (add) add.addEventListener('click', function () {
        var rows = readLS('SB_Candidates_v1') || [];
        if (!Array.isArray(rows)) rows = [];
        rows.unshift({
          id: 'ci' + Date.now().toString(36), name: d.name, role: '', contact: '', tape: '',
          verdict: '—',
          notes: (d.fit ? 'Fit ' + d.fit.score + '/100 vs ' + d.dirName + ' · ' : '') + d.quote.tier + ' (' + money(d.quote.low) + '–' + money(d.quote.high) + ')'
        });
        try { localStorage.setItem('SB_Candidates_v1', JSON.stringify(rows)); } catch (e) {}
        T.toast(d.name + ' added to candidates');
        inited.casting = 0; PANES.casting($('pane-casting'));
      });
    }
    async function analyzeActor() {
      var actor = $('prCiActor').value.trim();
      if (!actor) return T.toast('Type an actor\'s name');
      var dirName = $('prCiDir').value.trim();
      $('prCiOut').innerHTML = '<p class="bud-note">Researching ' + esc(actor) + '…</p>';
      var wd = [];
      try { wd = CC.parseWikidataActor(await sparql(CC.wikidataActorQuery(actor))); } catch (e) {}
      var credits = null, popularity = 0;
      if (tmdbKey()) {
        try {
          var hit = CC.parseTmdbSearch(await tmdb('/search/person', { query: actor }));
          if (hit) { popularity = hit.popularity; credits = CC.parseTmdbActorCredits(await tmdb('/person/' + hit.id + '/movie_credits')); }
        } catch (e) { T.toast(e.message); }
      }
      var films = (credits && credits.length) ? credits : wd;
      if (!films.length) { $('prCiOut').innerHTML = '<p class="bud-note">Nothing found for "' + esc(actor) + '" — check the spelling (full billed name works best).</p>'; return; }
      var dirCounts = {};
      wd.forEach(function (f) { (f.directors || []).forEach(function (dn) { dirCounts[dn] = (dirCounts[dn] || 0) + 1; }); });
      var directors = Object.keys(dirCounts).map(function (n) { return { name: n, films: dirCounts[n] }; })
        .sort(function (a, b) { return b.films - a.films; });
      var directorFilms = [];
      if (dirName && tmdbKey()) {
        try {
          var dh = CC.parseTmdbSearch(await tmdb('/search/person', { query: dirName }));
          if (dh) directorFilms = CC.parseTmdbDirectorCredits(await tmdb('/person/' + dh.id + '/movie_credits'));
        } catch (e) {}
      }
      var prefs = readLS('SB_Budget_v1') || {};
      var fit = dirName ? CC.fit({
        actorFilms: films, directorFilms: directorFilms, directorName: dirName,
        projectGenre: prefs.genre && prefs.genre !== 'auto' ? prefs.genre : '',
        nowYear: new Date().getFullYear()
      }) : null;
      renderCard({
        name: actor, films: films, directors: directors, popularity: popularity,
        dirName: dirName, fit: fit,
        quote: CC.quote({ films: films, popularity: popularity, nowYear: new Date().getFullYear() })
      });
    }
    async function suggestCast() {
      var dirName = $('prCiDir').value.trim();
      if (!dirName) return T.toast('Name the target director first');
      $('prCiOut').innerHTML = '<p class="bud-note">Mapping ' + esc(dirName) + '\'s collaborators…</p>';
      try {
        var d = CC.parseWikidataDirector(await sparql(CC.wikidataDirectorQuery(dirName)));
        if (!d.films.length) { $('prCiOut').innerHTML = '<p class="bud-note">No director named "' + esc(dirName) + '" found on Wikidata.</p>'; return; }
        var sug = CC.suggest(d.collaborators, '', 10);
        $('prCiOut').innerHTML = '<div class="pr-ci-card">' +
          '<div class="pr-ci-head"><b>' + esc(dirName) + '</b><span class="ps-hint">' + d.films.length + ' films on record</span></div>' +
          '<div class="pr-ci-sec">Actors this director keeps coming back to — click one to analyze</div>' +
          '<div class="pr-ci-chips">' + sug.map(function (x) {
            return '<button class="wf-chip pr-ci-sug" data-name="' + esc(x.name) + '" style="cursor:pointer;border:none">' + esc(x.name) + ' ×' + x.films + '</button>';
          }).join('') + '</div>' +
          '<p class="ps-hint" style="margin-top:8px">Familiar collaborators shoot faster and price friendlier — the director\'s trust is already built.</p></div>';
        $('prCiOut').querySelectorAll('.pr-ci-sug').forEach(function (b) {
          b.addEventListener('click', function () {
            $('prCiActor').value = b.getAttribute('data-name');
            analyzeActor();
          });
        });
      } catch (e) { $('prCiOut').innerHTML = '<p class="bud-note">Wikidata unavailable right now (' + esc(e.message) + ') — try again shortly.</p>'; }
    }
    $('prCiGo').addEventListener('click', analyzeActor);
    $('prCiSuggest').addEventListener('click', suggestCast);
  }

  /* ── tab dispatch ───────────────────────────────────────────────── */
  function show(tab) {
    document.querySelectorAll('#prRail button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('.tk-pane').forEach(function (p) {
      p.classList.toggle('hidden', p.id !== 'pane-' + tab);
    });
    if (!inited[tab] && PANES[tab]) { inited[tab] = 1; PANES[tab]($('pane-' + tab)); }
  }
  $('prRail').addEventListener('click', function (e) {
    var tab = e.target.getAttribute && e.target.getAttribute('data-tab');
    if (tab) { location.hash = tab; show(tab); }
  });
  var first = (location.hash || '').replace('#', '');
  show(PANES[first] ? first : 'casting');

  window.CProdApp = { show: show, panes: PANES };
})();
