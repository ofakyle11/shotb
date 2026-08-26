/* CINAMATE — one scene model.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Ten modules each grew their own screenplay splitter. They agreed on the
 * happy path and disagreed everywhere a real script differs from a test
 * fixture, which is how four separate defects shipped at once:
 *
 *   1. The printed scene number was thrown away. Every copy used
 *      /^\s*(?:\d+[\s.]*)?(INT|EXT|...)/ — a NON-capturing group. A shooting
 *      script says "24  INT. KITCHEN - DAY" and the platform called it scene
 *      7, because 7 was its position in the file. Every scene number the
 *      production actually says out loud on set — on the call sheet, the
 *      slate, the DPR, the sides — was a number Cinamate invented.
 *   2. With a "FADE IN:" preamble the first real scene was numbered 2. The
 *      preamble was pushed as scene 0, then the next scene took
 *      `n = scenes.length + 1` = 2. Seven of the eight copies did this. Every
 *      suite passed because every fixture opened directly on a slugline.
 *   3. A/B scenes vanished. "4A INT. STUDY - NIGHT" does not match
 *      \d+[\s.]* followed by INT (the "A" blocks it), so 4A was not a scene
 *      break at all — its content was swallowed into the previous scene. On a
 *      revised script, where A/B scenes are exactly the new material, the
 *      newest pages were the ones silently lost.
 *   4. production/lib-prod.js split on /\n(?=(?:INT|EXT|...)[.\s])/ with no
 *      allowance for a number or leading indent, so a numbered script never
 *      split at all and "audition sides" for one actor were the entire
 *      screenplay.
 *
 * So: one parser, one scene record, one store. This module is pure — no DOM,
 * no network — and is node-testable via scripts/test_scenes.mjs.
 *
 * THE SCENE RECORD
 * ----------------
 * A scene number is not a number. "4A" is a scene number; so is "A4". The
 * record therefore carries both the printed identity and a safe numeric, and
 * callers pick the one that fits:
 *
 *   ord      1-based position in the file. Preamble is 0. Always an integer.
 *   number   the screenplay's OWN printed number, verbatim: '4A'. '' if the
 *            script is unnumbered.
 *   n        numeric, for arithmetic, filters and existing numeric stores.
 *            The printed base when numbered (4A -> 4), else the ordinal.
 *   label    what a human reads and what goes on a call sheet: '4A', or the
 *            ordinal when the script carries no numbers.
 *   key      unique stable string identity ('4A' vs '4'), for dedupe and
 *            object keys where 4 and 4A must not collide.
 *   sortKey  numeric collation only: 4 < 4A < 4B < 5 (4, 4.01, 4.02, 5).
 *   slug     the slugline as printed, trimmed, right-hand number removed.
 *   body     content lines, page furniture and CONTINUED markers removed.
 *   text     body joined with newlines.
 *   iu       'INT' | 'EXT' | 'INT/EXT' | 'EST'
 *   location 'FARMHOUSE KITCHEN'   tod 'NIGHT'   continued  bool
 *   lines/eighths  page measure, 55 lines to the page (see eighthsOf).
 *
 * Original code, written for Cinamate.
 */
(function (root) {
  'use strict';

  var KEY = 'SB_Scenes_v1';

  /* ── 1 · the one slugline grammar ──────────────────────────────────────
     Built from parts so the pieces are testable and there is exactly one
     definition of each. Order matters: INT/EXT and I/E must be tried before
     bare INT, or "INT/EXT. CAR" matches as INT and leaves "/EXT." in the
     location.                                                              */

  /* Interior/exterior token. EST. (establishing) is a real slugline opener. */
  var IU_SRC = '(INT\\.?\\s*\\/\\s*EXT|EXT\\.?\\s*\\/\\s*INT|I\\s*\\/\\s*E|E\\s*\\/\\s*I|INT|EXT|EST)';

  /* A printed scene number: 4, 4A, A4, 12AB, optionally "SC"/"SCENE" and
     optionally closed by . ) or -. Captured — this is the whole point. */
  var NUM_SRC = '(?:(?:SC|SCENE)\\s*\\.?\\s*)?([0-9]+[A-Z]{0,3}|[A-Z]{1,3}[0-9]+)\\s*[.)\\-]?';

  /* The slugline itself. Group 1 = printed number (may be undefined),
     group 2 = INT/EXT token, group 3 = the rest of the line. The token must
     be followed by a period, a slash or whitespace so that INTERCUT,
     "Interior" and EXTRA are not sluglines. */
  var SLUG_RE = new RegExp(
    '^[\\s*]*' + '(?:' + NUM_SRC + '\\s+)?' + IU_SRC + '\\s*\\.?[\\s\\-–—:]+(.*)$', 'i');

  /* A bare scene number on its own line. PDF extraction routinely drops the
     number onto the line above the slugline; it belongs to the slugline. */
  var NUM_ONLY_RE = /^[\s*]*(?:(?:SC|SCENE)\s*\.?\s*)?([0-9]+[A-Z]{0,3}|[A-Z]{1,3}[0-9]+)\s*[.)\-]?\s*$/i;

  /* Page furniture that is not content: CONTINUED brackets, (MORE), the
     page-number line, and revision slugs. Dropping these keeps them out of
     the page measure and out of every keyword scan. */
  var CONT_RE = /^\s*\(?\s*(?:CONTINUED|CONT'?D|MORE)\s*\)?\s*[:.]?\s*$/i;
  var PAGE_FURNITURE_RE = /^\s*(?:(?:PAGE\s*)?\d+\s*\.?|\(?\s*(?:rev(?:ised|\.)?|blue|pink|yellow|green|goldenrod)\b[^\n]*\)?)\s*$/i;

  /* Time of day, taken from the tail of the slugline after the last dash. */
  var TOD_WORDS = ['CONTINUOUS', 'MOMENTS LATER', 'LATER', 'SAME TIME', 'SAME',
    'MORNING', 'AFTERNOON', 'EVENING', 'MIDNIGHT', 'PRE-DAWN', 'DAWN', 'DUSK',
    'SUNSET', 'SUNRISE', 'NIGHT', 'DAY', 'MAGIC HOUR'];

  function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

  /* Professional shooting scripts print the scene number down BOTH margins:
     "24  INT. KITCHEN - DAY                    24". The right-hand copy is
     not part of the location and must come off before anything else reads
     the line. Only strip it when it matches the number we found on the left,
     so a location that genuinely ends in a numeral survives. */
  function stripRightNumber(rest, num) {
    if (!num) return rest;
    var re = new RegExp('\\s{2,}' + num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[.)]?\\s*$', 'i');
    return rest.replace(re, '');
  }

  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* The canonical heading: the author's own slugline with the scene number
     removed from BOTH margins. `number` carries the identity; `slug` carries
     the heading. Keeping the number inside the slug is how "24" ended up
     being read as part of the location name. */
  function cleanSlug(t, num) {
    var s = t;
    if (num) {
      s = s.replace(new RegExp('^[\\s*]*(?:(?:SC|SCENE)\\s*\\.?\\s*)?' + reEsc(num) + '\\s*[.)\\-]?\\s+', 'i'), '');
      s = stripRightNumber(s, num);
    }
    return trim(s);
  }

  function normIU(tok) {
    var t = String(tok || '').toUpperCase().replace(/[.\s]/g, '');
    if (t === 'INT/EXT' || t === 'EXT/INT' || t === 'I/E' || t === 'E/I') return 'INT/EXT';
    if (t === 'EST') return 'EST';
    return t === 'EXT' ? 'EXT' : 'INT';
  }

  /* Split "FARMHOUSE KITCHEN - NIGHT (CONTINUOUS)" into location + tod.
     The time of day is the tail after the LAST separator that is followed by
     a recognised time word — so "PARIS - LEFT BANK - NIGHT" keeps the whole
     "PARIS - LEFT BANK" as the location. */
  function splitLocation(rest) {
    var s = trim(rest).replace(/\s*\(\s*(?:CONTINUED|CONT'?D)\s*\)\s*$/i, '');
    var parts = s.split(/\s*[\-–—]\s+|\s+[\-–—]\s*/);
    var tod = '';
    if (parts.length > 1) {
      var tail = trim(parts[parts.length - 1]);
      var bare = tail.replace(/\s*\([^)]*\)\s*$/, '').toUpperCase();
      for (var i = 0; i < TOD_WORDS.length; i++) {
        if (bare === TOD_WORDS[i] || bare.indexOf(TOD_WORDS[i]) === 0) { tod = tail; parts.pop(); break; }
      }
    }
    return { location: trim(parts.join(' - ')).toUpperCase(), tod: trim(tod).toUpperCase() };
  }

  /* parseSlug(line) → slugline metadata, or null when the line is not one.
     This is the single answer to "is this a scene heading?" for the whole
     platform. */
  function parseSlug(line) {
    var raw = String(line == null ? '' : line).replace(/\s+$/, '');
    var t = trim(raw);
    if (!t) return null;
    var m = SLUG_RE.exec(t);
    if (!m) return null;
    var num = m[1] ? String(m[1]).toUpperCase() : '';
    var rest = stripRightNumber(m[3] || '', num);
    /* A slugline needs somewhere to be. "EXT." alone, or "INT. - DAY", is a
       formatting artefact, not a scene. */
    if (!trim(rest).replace(/[\-–—:.\s]/g, '')) return null;
    var loc = splitLocation(rest);
    var nm = num ? /^([0-9]+)([A-Z]*)$/.exec(num) : null;
    var pre = num && !nm ? /^([A-Z]+)([0-9]+)$/.exec(num) : null;
    return {
      number: num,
      base: nm ? parseInt(nm[1], 10) : (pre ? parseInt(pre[2], 10) : 0),
      suffix: nm ? nm[2] : (pre ? pre[1] : ''),
      prefixed: !!pre,
      iu: normIU(m[2]),
      location: loc.location,
      tod: loc.tod,
      continued: /\(\s*CONT(?:INUED|'?D)\s*\)/i.test(t),
      slug: cleanSlug(t, num),
      raw: t
    };
  }

  function isSlug(line) { return parseSlug(line) !== null; }

  /* Suffix 'A' → .01, 'B' → .02, 'AA' → .27. Collation only. */
  function suffixWeight(sfx) {
    var s = String(sfx || '').toUpperCase(), w = 0;
    for (var i = 0; i < s.length; i++) w = w * 26 + (s.charCodeAt(i) - 64);
    return w / 100;
  }

  /* ── 2 · page measure ──────────────────────────────────────────────────
     A screenplay page is 55 lines. One eighth is 55/8 ≈ 6.875 lines. Blank
     lines occupy the page and are counted; the old copies dropped them and
     then divided by 5, which is a different number for no stated reason.
     Long lines wrap, so they are counted as the rows they would occupy at
     the standard element widths. */
  var LINES_PER_PAGE = 55;
  var ACTION_COLS = 60, DIALOGUE_COLS = 35;

  function rowsFor(line, inDialogue) {
    var len = String(line || '').replace(/\s+$/, '').length;
    if (!len) return 1;
    var cols = inDialogue ? DIALOGUE_COLS : ACTION_COLS;
    return Math.max(1, Math.ceil(len / cols));
  }

  /* eighthsOf(lines) → page eighths, minimum 1. A scene that exists occupies
     at least an eighth on the board, which is why the floor is 1. */
  function eighthsOf(lines) {
    var rows = 0, inDlg = false;
    (lines || []).forEach(function (ln) {
      var t = trim(ln);
      if (!t) { inDlg = false; rows += 1; return; }
      if (/^[A-Z][A-Z0-9 .,'()\-]{0,34}$/.test(t) && t === t.toUpperCase() && /[A-Z]/.test(t)) inDlg = true;
      rows += rowsFor(ln, inDlg);
    });
    return Math.max(1, Math.round(rows / (LINES_PER_PAGE / 8)));
  }

  /* ── 3 · dual dialogue ─────────────────────────────────────────────────
     Two forms reach us. Fountain marks the second column with a trailing ^.
     A PDF of a printed page merges the two columns onto one line, separated
     by a run of spaces. Either way both characters must survive: a dual
     scene where only the left column is read loses one actor's entire day.  */
  var DUAL_MERGED_RE = /^(\s*)([A-Z][A-Z0-9 .,'()\-]{0,30}?)\s{3,}([A-Z][A-Z0-9 .,'()\-]{0,30}?)\s*$/;

  function splitDual(line) {
    var t = String(line == null ? '' : line);
    if (/\^\s*$/.test(t)) return [t.replace(/\s*\^\s*$/, '')];
    var m = DUAL_MERGED_RE.exec(t);
    if (!m) return null;
    var a = trim(m[2]), b = trim(m[3]);
    /* Both halves must look like character cues, not a wide action line. */
    if (!a || !b) return null;
    if (a !== a.toUpperCase() || b !== b.toUpperCase()) return null;
    if (!/^[A-Z]/.test(a) || !/^[A-Z]/.test(b)) return null;
    if (isSlug(a) || isSlug(b)) return null;
    return [a, b];
  }

  /* ── 4 · the parser ────────────────────────────────────────────────────
     parse(text, opts) → { scenes, preamble, numbered, pages, eighths }
     `scenes` holds real scenes only. Anything before the first slugline —
     title page, FADE IN:, an epigraph — is the preamble, kept separately so
     it is never counted as a scene and never silently dropped.             */
  function parse(text, opts) {
    opts = opts || {};
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var scenes = [], preLines = [], cur = null, i, pendingNum = '';

    function close() {
      if (cur) { cur.body = trimBlanks(cur.body); scenes.push(cur); cur = null; }
    }

    for (i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var t = trim(raw);

      /* A bare number immediately above a slugline belongs to that slugline. */
      if (t && NUM_ONLY_RE.test(t)) {
        var nxt = '';
        for (var j = i + 1; j < lines.length; j++) { if (trim(lines[j])) { nxt = trim(lines[j]); break; } }
        if (nxt && isSlug(nxt) && !parseSlug(nxt).number) { pendingNum = NUM_ONLY_RE.exec(t)[1].toUpperCase(); continue; }
      }

      var meta = parseSlug(raw);
      if (meta) {
        if (!meta.number && pendingNum) {
          meta.number = pendingNum;
          var pm = /^([0-9]+)([A-Z]*)$/.exec(pendingNum);
          if (pm) { meta.base = parseInt(pm[1], 10); meta.suffix = pm[2]; }
        }
        pendingNum = '';
        close();
        cur = {
          ord: scenes.length + 1,
          number: meta.number,
          n: 0, label: '', key: '', sortKey: 0,
          slug: meta.slug,
          raw: meta.raw,
          heading: meta.slug,         /* alias: timeline/parser.js calls it heading */
          location: meta.location,
          tod: meta.tod,
          iu: meta.iu,
          continued: meta.continued,
          body: [],
          text: ''
        };
        continue;
      }
      /* A blank line between a bare scene number and its slugline is normal
         formatting — only real content cancels a pending number. */
      if (t) pendingNum = '';

      /* CONTINUED / (MORE) / page numbers are furniture, not content. */
      if (t && (CONT_RE.test(t) || (cur && PAGE_FURNITURE_RE.test(t)))) {
        if (cur && CONT_RE.test(t)) cur.continued = true;
        continue;
      }

      var dual = t ? splitDual(raw) : null;
      var push = dual || [raw];
      for (var k = 0; k < push.length; k++) {
        if (cur) cur.body.push(push[k]); else preLines.push(push[k]);
      }
    }
    close();

    /* Number the scenes. Printed numbers win; the ordinal fills in only
       where the script printed nothing. */
    var numbered = scenes.some(function (s) { return !!s.number; });
    scenes.forEach(function (s) {
      var pm = s.number ? /^([0-9]+)([A-Z]*)$/.exec(s.number) : null;
      var px = s.number && !pm ? /^([A-Z]+)([0-9]+)$/.exec(s.number) : null;
      var base = pm ? parseInt(pm[1], 10) : px ? parseInt(px[2], 10) : s.ord;
      var sfx = pm ? pm[2] : px ? px[1] : '';
      s.n = base;
      s.label = s.number || String(s.ord);
      s.key = s.number || String(s.ord);
      s.sortKey = base + suffixWeight(sfx);
      s.text = s.body.join('\n');
      s.lines = s.body.length + 1;
      s.eighths = eighthsOf([s.slug].concat(s.body));
    });

    var pre = null;
    preLines = trimBlanks(preLines);
    if (preLines.join('').replace(/\s/g, '')) {
      pre = {
        ord: 0, number: '', n: 0, label: '0', key: '0', sortKey: 0,
        slug: '', heading: '', location: '', tod: '', iu: '', continued: false,
        body: preLines, text: preLines.join('\n'),
        lines: preLines.length, eighths: eighthsOf(preLines), preamble: true
      };
    }

    var eighths = scenes.reduce(function (a, s) { return a + s.eighths; }, 0);
    return {
      scenes: scenes,
      preamble: pre,
      numbered: numbered,
      eighths: eighths,
      pages: Math.max(scenes.length ? 1 : 0, Math.round(eighths / 8 * 10) / 10)
    };
  }

  function trimBlanks(arr) {
    var a = (arr || []).slice();
    while (a.length && !trim(a[0])) a.shift();
    while (a.length && !trim(a[a.length - 1])) a.pop();
    return a;
  }

  /* split(text) → the house-pattern array: preamble first at ord 0 when one
     exists, then the real scenes. This is the drop-in for the eight retired
     copies of splitScenes, with the numbering fixed: the first real scene is
     scene 1 whether or not the script opens on FADE IN:.                   */
  function split(text) {
    var r = parse(text);
    return r.preamble ? [r.preamble].concat(r.scenes) : r.scenes.slice();
  }

  /* sceneList(text) → the lightweight list for pickers and call sheets. */
  function sceneList(text) {
    return parse(text).scenes.map(function (s) {
      return { n: s.n, ord: s.ord, number: s.number, label: s.label, key: s.key,
               slug: s.slug, location: s.location, tod: s.tod, iu: s.iu, eighths: s.eighths };
    });
  }

  /* ── 5 · lookup ────────────────────────────────────────────────────────
     byNumber accepts what a human types: 4, '4', '4a', ' 4A ', 'SC 4A'. It
     matches the printed number first, then the ordinal, so it does the right
     thing on both a numbered shooting script and an unnumbered draft.      */
  function normNum(v) {
    var s = trim(v).toUpperCase().replace(/^(?:SC|SCENE)\s*\.?\s*/, '').replace(/[.)\s]+$/, '');
    return s;
  }
  function byNumber(scenes, want) {
    var w = normNum(want);
    if (!w) return null;
    var list = scenes || [], i;
    for (i = 0; i < list.length; i++) if (String(list[i].number || '').toUpperCase() === w) return list[i];
    /* The ordinal is only an identity for a scene the script did not number.
       On a numbered script, asking for "3" when the printed numbers run
       1, 2, 4A must miss — returning the third scene in the file would be
       inventing a scene 3 that the production does not have. */
    for (i = 0; i < list.length; i++) if (!list[i].number && String(list[i].label || '').toUpperCase() === w) return list[i];
    for (i = 0; i < list.length; i++) if (!list[i].number && String(list[i].ord) === w) return list[i];
    return null;
  }
  /* index(scenes) → { '4A': rec, ... }; unnumbered scenes key by ordinal. */
  function index(scenes) {
    var out = {};
    (scenes || []).forEach(function (s) {
      if (s.number) out[String(s.number).toUpperCase()] = s;
      else if (out[String(s.ord)] === undefined) out[String(s.ord)] = s;
    });
    return out;
  }

  /* parseSceneNums('1, 4-6, 8A') → ['1','4','5','6','8A'] — printed numbers,
     as strings, because 8A is one of them. Ranges expand numerically. */
  function parseSceneNums(text) {
    var out = [], seen = {};
    String(text == null ? '' : text).split(/[,\s]+/).forEach(function (tok) {
      if (!tok) return;
      var m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(tok);
      if (m) {
        var a = +m[1], b = +m[2];
        if (Math.abs(b - a) <= 500) for (var i = Math.min(a, b); i <= Math.max(a, b); i++) add(String(i));
        return;
      }
      var s = normNum(tok);
      if (/^[0-9]+[A-Z]{0,3}$/.test(s) || /^[A-Z]{1,3}[0-9]+$/.test(s)) add(s);
    });
    function add(v) { if (!seen[v]) { seen[v] = 1; out.push(v); } }
    return out.sort(function (x, y) { return cmp(x, y); });
  }
  function cmp(a, b) {
    var ka = keyWeight(a), kb = keyWeight(b);
    return ka - kb;
  }
  function keyWeight(v) {
    var s = normNum(v);
    var m = /^([0-9]+)([A-Z]*)$/.exec(s) || /^([A-Z]+)([0-9]+)$/.exec(s);
    if (!m) return 0;
    return /^[0-9]/.test(s) ? parseInt(m[1], 10) + suffixWeight(m[2])
                            : parseInt(m[2], 10) + suffixWeight(m[1]);
  }
  function sortScenes(list) {
    return (list || []).slice().sort(function (a, b) { return (a.sortKey || 0) - (b.sortKey || 0); });
  }

  /* ── 6 · the store ─────────────────────────────────────────────────────
     SB_Scenes_v1 — the parsed breakdown, so every department reads the same
     scene list instead of re-parsing the script slightly differently. New
     key; nothing existing is renamed. */
  function ls() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function load() {
    var s = ls(); if (!s) return null;
    try { return JSON.parse(s.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function save(store) {
    var s = ls(); if (!s) return false;
    try { s.setItem(KEY, JSON.stringify(store)); return true; } catch (e) { return false; }
  }
  /* build(text, meta) → the store shape, without writing it. */
  function build(text, meta) {
    var r = parse(text);
    return {
      v: 1,
      updatedAt: new Date().toISOString(),
      project: (meta && meta.project) || '',
      numbered: r.numbered,
      pages: r.pages,
      eighths: r.eighths,
      scenes: r.scenes,
      preamble: r.preamble
    };
  }
  /* sync(text, meta) → build + persist. Returns the store either way. */
  function sync(text, meta) { var st = build(text, meta); save(st); return st; }
  /* list() → the stored scenes, or [] when nothing has been parsed yet. */
  function list() { var st = load(); return (st && Array.isArray(st.scenes)) ? st.scenes : []; }

  root.CScenes = {
    KEY: KEY,
    SLUG_RE: SLUG_RE,
    LINES_PER_PAGE: LINES_PER_PAGE,
    isSlug: isSlug, parseSlug: parseSlug, splitDual: splitDual,
    parse: parse, split: split, sceneList: sceneList,
    eighthsOf: eighthsOf,
    byNumber: byNumber, index: index, sortScenes: sortScenes,
    parseSceneNums: parseSceneNums, normNum: normNum, keyWeight: keyWeight,
    load: load, save: save, build: build, sync: sync, list: list
  };
})(typeof window !== 'undefined' ? window : globalThis);
