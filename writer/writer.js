/* CINAMATE Writer — UI: import a treatment (PDF/DOCX/text), edit scene
 * beats, preview/export the Fountain draft, send it to the Studio.
 * Engine: lib-treatment.js (TWriter). Storage: SB_Writer_v1 (this browser).
 */
(function () {
  'use strict';
  var KEY = 'SB_Writer_v1';
  var STUDIO_KEY = 'SB_Timeline_v1';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var state = { proj: { title: '', author: '', date: '', logline: '' }, scenes: [], srcName: '' };
  try { var saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved && saved.scenes) state = saved; } catch (e) {}

  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  var toastTimer = null;
  function toast(msg) {
    var el = $('wrToast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2600);
  }

  /* ── file readers ───────────────────────────────────────────────── */
  async function readPdf(file) {
    if (!window.pdfjsLib) throw new Error('PDF library not loaded — check your connection and retry');
    var doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    var out = [];
    for (var p = 1; p <= doc.numPages; p++) {
      var content = await (await doc.getPage(p)).getTextContent();
      var lastY = null, line = [], lines = [];
      content.items.forEach(function (it) {
        var y = Math.round(it.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          lines.push({ y: lastY, text: line.join('') });
          if (Math.abs(y - lastY) > 20) lines.push({ y: null, text: '' }); // big gap = paragraph
          line = [];
        }
        line.push(it.str);
        lastY = y;
      });
      if (line.length) lines.push({ y: lastY, text: line.join('') });
      out.push(lines.map(function (l) { return l.text; }).join('\n'));
    }
    return out.join('\n\n');
  }

  async function readDocx(file) {
    if (!window.JSZip) throw new Error('DOCX library not loaded — check your connection and retry');
    var zip = await JSZip.loadAsync(await file.arrayBuffer());
    var entry = zip.file('word/document.xml');
    if (!entry) throw new Error('Not a Word document (word/document.xml missing)');
    var xml = await entry.async('string');
    return TWriter.docxParagraphs(xml).join('\n\n');
  }

  async function handleFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var text;
    try {
      if (ext === 'pdf') text = await readPdf(file);
      else if (ext === 'docx') text = await readDocx(file);
      else if (ext === 'txt' || ext === 'md' || ext === 'fountain') text = await file.text();
      else { toast('Use .pdf, .docx, .txt, .md or .fountain'); return; }
    } catch (e) { toast('Import failed: ' + e.message); return; }
    state.srcName = file.name;
    $('wrFileMeta').classList.remove('hidden');
    $('wrFileMeta').textContent = '📄 ' + file.name + ' · ' + (file.size / 1024).toFixed(1) + ' KB';
    buildFromText(text, file.name.replace(/\.[^.]+$/, ''));
  }

  /* ── build + render ─────────────────────────────────────────────── */
  function buildFromText(text, fallbackTitle) {
    var parsed = TWriter.parseTreatment(text, { title: state.proj.title });
    if (!parsed.scenes.length) { toast('No scenes found — is the file empty?'); return; }
    state.scenes = parsed.scenes.map(function (s) { return { slug: s.slug, body: s.body, characters: s.characters }; });
    if (!state.proj.title || state.proj.title === 'Untitled') state.proj.title = parsed.project.title !== 'Untitled' ? parsed.project.title : (fallbackTitle || 'Untitled');
    if (!state.proj.author && parsed.project.author) state.proj.author = parsed.project.author;
    if (!state.proj.logline && parsed.project.logline) state.proj.logline = parsed.project.logline;
    save();
    renderAll();
    toast(state.scenes.length + ' scene beats built — refine, then send to Studio');
  }

  function parsedShape() {
    return {
      project: { title: state.proj.title || 'Untitled', author: state.proj.author, logline: state.proj.logline },
      scenes: state.scenes.map(function (s, i) { return { n: i + 1, slug: s.slug, body: s.body, characters: s.characters || [] }; })
    };
  }

  function fountain() {
    return TWriter.toFountain(parsedShape(), { draftDate: state.proj.date });
  }

  function renderCards() {
    var wrap = $('wrCards');
    if (!state.scenes.length) {
      wrap.innerHTML = '<div class="wr-empty">Drop a treatment on the left — every heading or beat becomes an editable scene card.</div>';
      $('wrSceneMeta').textContent = 'Import a treatment to begin';
      return;
    }
    $('wrSceneMeta').textContent = state.scenes.length + ' scenes';
    wrap.innerHTML = state.scenes.map(function (s, i) {
      return '<div class="wr-card" data-i="' + i + '">' +
        '<div class="wr-card-top">' +
        '<span class="wr-card-n">' + (i + 1) + '</span>' +
        '<input class="wr-card-slug" data-f="slug" value="' + esc(s.slug) + '" title="Scene heading (slugline)">' +
        '<button class="wr-card-btn" data-act="up" title="Move up">▲</button>' +
        '<button class="wr-card-btn" data-act="down" title="Move down">▼</button>' +
        '<button class="wr-card-btn" data-act="del" title="Delete scene">✕</button>' +
        '</div>' +
        '<textarea class="wr-card-body" data-f="body" title="Scene action">' + esc(s.body) + '</textarea>' +
        ((s.characters || []).length ? '<div class="wr-card-chars">' + s.characters.map(function (c) { return '<span class="wr-chip">' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
        '</div>';
    }).join('');
  }

  function renderStats() {
    var st = TWriter.stats(parsedShape());
    $('wrStats').innerHTML = state.scenes.length ?
      '<b>' + st.scenes + '</b> scenes · <b>' + st.words + '</b> words<br>' +
      '≈ <b>' + st.estScreenplayPages + '</b> screenplay pages · ≈ <b>' + st.estRuntimeMin + '</b> min<br>' +
      (st.characters.length ? 'Cast: ' + st.characters.slice(0, 8).join(', ') : '') : '';
  }

  function renderAll() {
    $('wrTitle').value = state.proj.title || '';
    $('wrAuthor').value = state.proj.author || '';
    $('wrDate').value = state.proj.date || '';
    $('wrLogline').value = state.proj.logline || '';
    if (state.srcName) { $('wrFileMeta').classList.remove('hidden'); $('wrFileMeta').textContent = '📄 ' + state.srcName; }
    renderCards();
    renderStats();
    $('wrFountain').textContent = state.scenes.length ? fountain() : 'Your Fountain draft appears here.';
  }

  /* ── events ─────────────────────────────────────────────────────── */
  function wire() {
    $('wrBrowse').addEventListener('click', function () { $('wrFile').click(); });
    $('wrFile').addEventListener('change', function () { if (this.files[0]) handleFile(this.files[0]); });
    var drop = $('wrDrop');
    ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('dragover'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('dragover'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

    $('wrPasteGo').addEventListener('click', function () {
      var t = $('wrPasteBox').value.trim();
      if (t.length < 40) return toast('Paste at least a paragraph of treatment text');
      state.srcName = 'pasted text';
      buildFromText(t);
    });

    [['wrTitle', 'title'], ['wrAuthor', 'author'], ['wrDate', 'date'], ['wrLogline', 'logline']].forEach(function (pair) {
      $(pair[0]).addEventListener('input', function () {
        state.proj[pair[1]] = this.value;
        save();
        $('wrFountain').textContent = state.scenes.length ? fountain() : $('wrFountain').textContent;
      });
    });

    $('wrCards').addEventListener('input', function (e) {
      var card = e.target.closest('.wr-card'); if (!card) return;
      var i = +card.getAttribute('data-i');
      var f = e.target.getAttribute('data-f'); if (!f || !state.scenes[i]) return;
      state.scenes[i][f] = e.target.value;
      if (f === 'body') state.scenes[i].characters = TWriter.extractCharacters(e.target.value);
      save();
      renderStats();
      $('wrFountain').textContent = fountain();
    });
    $('wrCards').addEventListener('click', function (e) {
      var act = e.target.getAttribute('data-act'); if (!act) return;
      var i = +e.target.closest('.wr-card').getAttribute('data-i');
      if (act === 'del') state.scenes.splice(i, 1);
      if (act === 'up' && i > 0) { var a = state.scenes.splice(i, 1)[0]; state.scenes.splice(i - 1, 0, a); }
      if (act === 'down' && i < state.scenes.length - 1) { var b = state.scenes.splice(i, 1)[0]; state.scenes.splice(i + 1, 0, b); }
      save(); renderAll();
    });

    $('wrAddScene').addEventListener('click', function () {
      state.scenes.push({ slug: 'INT. NEW SCENE - DAY', body: '', characters: [] });
      save(); renderAll();
    });
    $('wrClear').addEventListener('click', function () {
      if (!confirm('Start a new project? The current scenes are discarded.')) return;
      state = { proj: { title: '', author: '', date: '', logline: '' }, scenes: [], srcName: '' };
      save(); $('wrFileMeta').classList.add('hidden'); renderAll();
    });

    $('wrCopy').addEventListener('click', function () {
      if (!state.scenes.length) return toast('Nothing to copy yet');
      navigator.clipboard.writeText(fountain()).then(function () { toast('Fountain draft copied'); },
        function () { toast('Copy blocked — use the download instead'); });
    });
    $('wrDlFountain').addEventListener('click', function () {
      if (!state.scenes.length) return toast('Nothing to export yet');
      var name = (state.proj.title || 'cinamate-draft').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([fountain()], { type: 'text/plain' }));
      a.download = (name || 'cinamate-draft') + '.fountain';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    $('wrToStudio').addEventListener('click', function () {
      if (!state.scenes.length) return toast('Build scenes first');
      var text = fountain();
      var studio = {};
      try { studio = JSON.parse(localStorage.getItem(STUDIO_KEY) || 'null') || {}; } catch (e) { studio = {}; }
      studio.scriptText = text;
      studio.projectName = state.proj.title || studio.projectName || 'Untitled Film';
      try { localStorage.setItem(STUDIO_KEY, JSON.stringify(studio)); } catch (e) { return toast('Could not save — storage full?'); }
      toast('Draft sent — opening the Studio…');
      setTimeout(function () { location.href = '/timeline/'; }, 900);
    });
  }

  function init() { wire(); renderAll(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.CWriterApp = {
    getState: function () { return state; },
    buildFromText: buildFromText,
    fountain: fountain,
    handleFile: handleFile
  };
})();
