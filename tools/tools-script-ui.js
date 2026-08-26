/* Cinamate Tools — story tabs: Script Revisions (colored pages),
 * Story Bible, Captions editor, Press Kit generator.
 * All original code, written for Cinamate.
 */
(function (root) {
  'use strict';
  /* Attribute-safe escaping for any value interpolated into markup. */
  function escAttr(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var C = root.TCore, S = root.TScript, esc = C.esc;
  root.TTabs = root.TTabs || {};

  function projectState() {
    return C.load('SB_Timeline_v1', {}) || {};
  }

  /* ── Script Revisions ─────────────────────────────────────────── */
  root.TTabs.revisions = function () {
    var el = C.$('pane-revisions');
    var KEY = 'SB_Drafts_v1';
    function drafts() { return C.load(KEY, []); }
    function render() {
      var ds = drafts();
      var h = '<h2>Script Revisions — Colored Pages</h2>' +
        '<p class="tk-desc">Snapshot the current script as a locked draft, then compare any two drafts: changed lines get the industry asterisk change-bars and each revision generation takes the next production color (White → Blue → Pink → Yellow…).</p>' +
        '<div class="tk-bar"><button class="tb-btn gold" id="rvSnap">📌 Snapshot current script as ' + esc(S.revColor(ds.length)) + ' draft</button>' +
        '<span class="ps-hint">Script comes from the Studio timeline (same browser)</span></div>';
      h += '<div class="bud-tablewrap"><table class="bud-table"><thead><tr><th></th><th>Draft</th><th>Saved</th><th class="bud-r">Lines</th><th>Compare</th><th></th></tr></thead><tbody>';
      if (!ds.length) h += '<tr><td colspan="6" class="tk-empty">No drafts yet — snapshot your first (White) draft.</td></tr>';
      ds.forEach(function (d, i) {
        h += '<tr><td><span class="tk-revchip" style="background:' + S.revHex(d.color) + '"></span></td>' +
          '<td><b>' + esc(d.color) + '</b> draft</td><td>' + esc(d.saved) + '</td>' +
          '<td class="bud-r">' + escAttr(d.lines) + '</td>' +
          '<td>' + (i > 0 ? '<button class="tb-btn" data-cmp="' + escAttr(i) + '">vs ' + esc(ds[i - 1].color) + '</button> ' : '') +
          (i < ds.length - 1 ? '' : (i > 0 ? '' : '')) +
          '<button class="tb-btn" data-cur="' + escAttr(i) + '">vs current</button></td>' +
          '<td><button class="tb-btn tk-del" data-del="' + escAttr(i) + '">✕</button></td></tr>';
      });
      h += '</tbody></table></div><div id="rvDiff"></div>';
      el.innerHTML = h;

      C.$('rvSnap').onclick = function () {
        var st = projectState();
        var text = st.scriptText || '';
        if (!text.trim()) return C.toast('No script in the Studio yet — import one first');
        var ds2 = drafts();
        ds2.push({ color: S.revColor(ds2.length), saved: new Date().toLocaleString(), lines: text.split('\n').length, text: text });
        C.save(KEY, ds2);
        render();
        C.toast(S.revColor(ds2.length - 1) + ' draft locked');
      };
      Array.prototype.forEach.call(el.querySelectorAll('[data-cmp]'), function (b) {
        b.onclick = function () {
          var i = +b.getAttribute('data-cmp');
          showDiff(drafts()[i - 1], drafts()[i]);
        };
      });
      Array.prototype.forEach.call(el.querySelectorAll('[data-cur]'), function (b) {
        b.onclick = function () {
          var i = +b.getAttribute('data-cur');
          var st = projectState();
          showDiff(drafts()[i], { color: 'Current', text: st.scriptText || '' });
        };
      });
      Array.prototype.forEach.call(el.querySelectorAll('[data-del]'), function (b) {
        b.onclick = function () {
          var ds2 = drafts(); ds2.splice(+b.getAttribute('data-del'), 1);
          C.save(KEY, ds2); render();
        };
      });
    }
    function showDiff(a, b) {
      var ops = S.diffLines(a.text, b.text);
      var st = S.diffStats(ops);
      var h = '<div class="tk-summary" style="margin-top:12px"><span class="tk-revchip" style="background:' + S.revHex(a.color) + '"></span>' + esc(a.color) +
        ' → <span class="tk-revchip" style="background:' + S.revHex(b.color) + '"></span>' + esc(b.color) +
        ' — <b>' + escAttr(st.added) + '</b> added · <b>' + escAttr(st.deleted) + '</b> removed' +
        (st.changed === 0 ? ' · <span class="tk-chip good">IDENTICAL</span>' : '') + '</div>';
      h += '<div class="tk-difwrap">' + ops.map(function (o) {
        if (o.type === 'same') return '<div class="ln">' + esc(o.line || ' ') + '</div>';
        return '<div class="ln ' + escAttr(o.type) + '">' + esc(o.line || ' ') + '</div>';
      }).join('') + '</div>';
      C.$('rvDiff').innerHTML = h;
    }
    render();
  };

  /* ── Story Bible ──────────────────────────────────────────────── */
  root.TTabs.bible = function () {
    var el = C.$('pane-bible');
    el.innerHTML = '<h2>Story Bible</h2>' +
      '<p class="tk-desc">Characters, locations, props and themes in one reference — seeded automatically from what the script parser already found, then yours to deepen. The department heads\' single source of truth.</p>' +
      '<div class="tk-bar"><button class="tb-btn gold" id="bbSeed">⚡ Seed from script</button></div>' +
      '<div id="bbWrap"></div>';
    var reg = new C.Register({
      key: 'SB_Bible_v1',
      fields: [
        { id: 'name', label: 'Name' },
        { id: 'kind', label: 'Type', type: 'select', options: ['Character', 'Location', 'Prop', 'Vehicle', 'Theme', 'Faction', 'Event'] },
        { id: 'logline', label: 'One-line' },
        { id: 'detail', label: 'Detail / continuity notes' },
        { id: 'appears', label: 'Appears in' }
      ],
      summary: function (rows) {
        var c = rows.filter(function (r) { return r.kind === 'Character'; }).length;
        var l = rows.filter(function (r) { return r.kind === 'Location'; }).length;
        return '<b>' + rows.length + '</b> entries · ' + c + ' characters · ' + l + ' locations';
      }
    });
    reg.render('bbWrap');
    C.$('bbSeed').onclick = function () {
      var st = projectState();
      var have = {};
      reg.rows.forEach(function (r) { have[(r.kind + ':' + r.name).toLowerCase()] = 1; });
      var added = 0;
      Object.keys(st.characters || {}).forEach(function (n) {
        if (!have[('character:' + n).toLowerCase()]) { reg.add({ name: n, kind: 'Character', logline: '', detail: '', appears: '' }); added++; }
      });
      (st.locationBible || []).forEach(function (loc) {
        var n = typeof loc === 'string' ? loc : (loc && (loc.name || loc.heading)) || '';
        if (n && !have[('location:' + n).toLowerCase()]) { reg.add({ name: n, kind: 'Location', logline: '', detail: '', appears: '' }); added++; }
      });
      reg.render('bbWrap');
      C.toast(added ? added + ' entries seeded from the script' : 'Nothing new to seed');
    };
  };

  /* ── Captions ─────────────────────────────────────────────────── */
  root.TTabs.captions = function () {
    var el = C.$('pane-captions');
    el.innerHTML = '<h2>Captions — SRT / WebVTT</h2>' +
      '<p class="tk-desc">Load or paste SRT or WebVTT, edit cues in place, run broadcast QC (reading speed, line length, overlaps) and export either format. Everything runs in this browser.</p>' +
      '<div class="tk-bar"><input type="file" id="cpFile" accept=".srt,.vtt" style="display:none">' +
      '<button class="tb-btn gold" onclick="document.getElementById(\'cpFile\').click()">Load .srt / .vtt</button>' +
      '<button class="tb-btn" id="cpAdd">+ Cue</button>' +
      '<button class="tb-btn" id="cpQc">Run QC</button>' +
      '<button class="tb-btn" id="cpSrt">Export SRT</button>' +
      '<button class="tb-btn" id="cpVtt">Export VTT</button></div>' +
      '<div id="cpQcOut"></div><div id="cpTable"></div>';
    var KEY = 'SB_Captions_v1';
    var cues = C.load(KEY, []);
    function persist() { C.save(KEY, cues); }
    function table() {
      var h = '<div class="bud-tablewrap"><table class="bud-table"><thead><tr><th style="width:130px">In</th><th style="width:130px">Out</th><th>Text</th><th></th></tr></thead><tbody>';
      if (!cues.length) h += '<tr><td colspan="4" class="tk-empty">No cues yet — load a file or add one.</td></tr>';
      cues.forEach(function (c, i) {
        h += '<tr data-i="' + escAttr(i) + '"><td><input class="tk-in" data-f="start" value="' + S.msToTc(c.start) + '"></td>' +
          '<td><input class="tk-in" data-f="end" value="' + S.msToTc(c.end) + '"></td>' +
          '<td><input class="tk-in" data-f="text" value="' + esc(c.text.replace(/\n/g, ' | ')) + '"></td>' +
          '<td><button class="tb-btn tk-del">✕</button></td></tr>';
      });
      h += '</tbody></table></div><p class="tk-note">Use “ | ” for a line break inside a cue.</p>';
      C.$('cpTable').innerHTML = h;
      Array.prototype.forEach.call(C.$('cpTable').querySelectorAll('.tk-in'), function (inp) {
        inp.onchange = function () {
          var i = +inp.closest('tr').getAttribute('data-i'), f = inp.getAttribute('data-f');
          if (f === 'text') cues[i].text = inp.value.split(' | ').join('\n');
          else {
            var ms = S.tcToMs(inp.value.replace('.', ','));
            if (ms != null) cues[i][f] = ms;
          }
          persist(); table();
        };
      });
      Array.prototype.forEach.call(C.$('cpTable').querySelectorAll('.tk-del'), function (b) {
        b.onclick = function () { cues.splice(+b.closest('tr').getAttribute('data-i'), 1); persist(); table(); };
      });
    }
    C.$('cpFile').onchange = function () {
      var f = this.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { cues = S.parseCaptions(r.result); persist(); table(); C.toast(cues.length + ' cues loaded'); };
      r.readAsText(f);
    };
    C.$('cpAdd').onclick = function () {
      var last = cues.length ? cues[cues.length - 1].end : 0;
      cues.push({ start: last + 500, end: last + 3000, text: 'New caption' });
      persist(); table();
    };
    C.$('cpQc').onclick = function () {
      var issues = S.captionQc(cues);
      C.$('cpQcOut').innerHTML = issues.length
        ? '<div class="tk-result"><b>' + issues.length + ' QC issue' + (issues.length === 1 ? '' : 's') + ':</b><br>' +
          issues.slice(0, 30).map(function (i) { return 'Cue ' + i.cue + ' — ' + esc(i.msg); }).join('<br>') + '</div>'
        : '<div class="tk-result"><span class="tk-chip good">QC CLEAN</span> reading speed, line length and timing all pass.</div>';
    };
    function dl(name, text) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = name; a.click();
    }
    C.$('cpSrt').onclick = function () { dl('captions.srt', S.toSrt(cues)); };
    C.$('cpVtt').onclick = function () { dl('captions.vtt', S.toVtt(cues)); };
    table();
  };

  /* ── Press Kit (EPK) ──────────────────────────────────────────── */
  root.TTabs.epk = function () {
    var el = C.$('pane-epk');
    var saved = C.load('SB_EPK_v1', {});
    el.innerHTML = '<h2>Electronic Press Kit</h2>' +
      '<p class="tk-desc">Fill the essentials, attach stills, and download a self-contained press-kit page you can send to press, festivals and buyers. Credits pull from your Crew directory and script characters.</p>' +
      '<div class="tk-grid">' +
      fld('ekTitle', 'Title', saved.title || (projectState().projectName || '')) +
      fld('ekLogline', 'Logline', saved.logline || '') +
      fld('ekRuntime', 'Runtime', saved.runtime || '') +
      fld('ekContact', 'Contact (email)', saved.contact || '') +
      '</div>' +
      '<div class="tk-field" style="max-width:760px"><label>Synopsis</label><textarea id="ekSyn">' + esc(saved.synopsis || '') + '</textarea></div>' +
      '<div class="tk-bar" style="margin-top:10px"><input type="file" id="ekStills" accept="image/*" multiple style="display:none">' +
      '<button class="tb-btn" onclick="document.getElementById(\'ekStills\').click()">+ Stills</button>' +
      '<span class="ps-hint" id="ekStillCount"></span>' +
      '<button class="tb-btn gold" id="ekGen">Generate press kit (.html)</button></div>';
    function fld(id, label, val) {
      return '<div class="tk-field"><label>' + esc(label) + '</label><input id="' + id + '" value="' + esc(val) + '"></div>';
    }
    var stills = saved.stills || [];
    function count() { C.$('ekStillCount').textContent = stills.length ? stills.length + ' still' + (stills.length === 1 ? '' : 's') + ' attached' : ''; }
    count();
    C.$('ekStills').onchange = function () {
      Array.prototype.forEach.call(this.files, function (f) {
        var r = new FileReader();
        r.onload = function () { stills.push(r.result); count(); persist(); };
        r.readAsDataURL(f);
      });
    };
    function persist() {
      C.save('SB_EPK_v1', { title: C.$('ekTitle').value, logline: C.$('ekLogline').value, runtime: C.$('ekRuntime').value, contact: C.$('ekContact').value, synopsis: C.$('ekSyn').value, stills: stills.slice(0, 8) });
    }
    ['ekTitle', 'ekLogline', 'ekRuntime', 'ekContact', 'ekSyn'].forEach(function (id) { C.$(id).addEventListener('change', persist); });
    C.$('ekGen').onclick = function () {
      persist();
      var st = projectState();
      var cast = Object.keys(st.characters || {}).slice(0, 12);
      var crew = C.load('SB_Crew_v1', []).slice(0, 20);
      var t = C.$('ekTitle').value || 'Untitled';
      var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(t) + ' — Press Kit</title>' +
        '<style>body{margin:0;background:#0A1628;color:#E8EEF2;font:16px/1.6 Georgia,serif;padding:40px 18px}main{max-width:760px;margin:0 auto}h1{font-size:42px;letter-spacing:.06em;margin:0 0 4px}h2{font-size:14px;letter-spacing:.2em;text-transform:uppercase;color:#C9A86C;margin:36px 0 10px}p.log{font-style:italic;color:#8BA3B8;font-size:20px}img{max-width:100%;border-radius:8px;margin:8px 0}table{width:100%;border-collapse:collapse}td{padding:4px 8px;border-bottom:1px solid rgba(139,163,184,.2);font-size:14px}.c{color:#8BA3B8}</style></head><body><main>' +
        '<h1>' + esc(t) + '</h1><p class="log">' + esc(C.$('ekLogline').value) + '</p>' +
        (C.$('ekRuntime').value ? '<p class="c">Runtime ' + esc(C.$('ekRuntime').value) + '</p>' : '') +
        '<h2>Synopsis</h2><p>' + esc(C.$('ekSyn').value).replace(/\n/g, '</p><p>') + '</p>' +
        (stills.length ? '<h2>Stills</h2>' + stills.map(function (s) {
          /* escAttr stops a value breaking out of the attribute and does
             nothing about what the attribute then points at. */
          return '<img src="' + CinUrl.safe(s) + '">';
        }).join('') : '') +
        (cast.length ? '<h2>Characters</h2><table>' + cast.map(function (c) { return '<tr><td>' + esc(c) + '</td></tr>'; }).join('') + '</table>' : '') +
        (crew.length ? '<h2>Crew</h2><table>' + crew.map(function (c) { return '<tr><td>' + esc(c.role || '') + '</td><td class="c">' + esc(c.name || '') + '</td></tr>'; }).join('') + '</table>' : '') +
        (C.$('ekContact').value ? '<h2>Contact</h2><p>' + esc(C.$('ekContact').value) + '</p>' : '') +
        '</main></body></html>';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      a.download = t.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-press-kit.html';
      a.click();
      C.toast('Press kit generated');
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
