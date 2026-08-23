/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Wardrobe & Looks engine (CWard)
   Pure logic, no DOM: character extraction from dialogue cues (same walk a
   casting office uses), looks with per-piece costs by source (buy / rent /
   build / cast-own), the scene-by-scene change plot with QUICK CHANGE and
   CONTINUITY SPAN flags, budget rollups, and multiples advice for hero
   garments that meet blood / rain / mud / tears / fights / water in the
   script. Multiples counts are estimates — confirm with stunts and SFX.
   All state is passed in; storage and IndexedDB live in the page script.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var SLUG_RE = /^\s*(?:\d+[\s.]*)?(INT|EXT|INT\/EXT|I\/E)[.\s]/i;
  var SOURCES = ['buy', 'rent', 'build', 'cast-own'];

  function uid(p) { return (p || 'w') + Math.random().toString(36).slice(2, 9); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round2(v) { return Math.round(v * 100) / 100; }

  /* ── 1 · scenes ─────────────────────────────────────────────────────────
     Split a screenplay into scenes on sluglines; scene 0 catches preamble. */
  function splitScenes(text) {
    var lines = String(text || '').split(/\r?\n/);
    var scenes = [], cur = { n: 0, slug: '', body: [] };
    lines.forEach(function (ln) {
      if (SLUG_RE.test(ln)) {
        if (cur.body.length || cur.slug) scenes.push(cur);
        cur = { n: scenes.length + 1, slug: ln.trim(), body: [] };
      } else cur.body.push(ln);
    });
    if (cur.body.length || cur.slug) scenes.push(cur);
    return scenes.filter(function (s) { return s.slug || s.body.join('').trim(); });
  }

  /* ── 2 · dialogue cues → characters ─────────────────────────────────────
     A character cue is a short ALL-CAPS line (2–30 chars), not a slugline,
     not a transition/format keyword, optionally suffixed (V.O.)/(O.S.)/
     (CONT'D), and followed by an actual line of dialogue.                  */
  var NOT_CUES = /^(FADE IN|FADE OUT|FADE TO|CUT TO|DISSOLVE TO|SMASH CUT|MATCH CUT|JUMP CUT|CONTINUED|INTERCUT|MONTAGE|SERIES OF SHOTS|TITLE|SUPER|CHYRON|THE END|END OF|BLACK|LATER|BEAT|BACK TO|OMITTED|ANGLE ON|CLOSE ON|INSERT)\b/;

  function cueName(line) {
    var t = String(line == null ? '' : line).trim();
    if (!t) return null;
    if (SLUG_RE.test(t)) return null;
    var s = t.replace(/\s*\((?:V\.?\s?O\.?|O\.?\s?S\.?|O\.?\s?C\.?|CONT'?D\.?|VOICE OVER|OFF SCREEN|PRE-?LAP|FILTERED)\)\.?\s*$/i, '');
    s = s.replace(/^\s+|\s+$/g, '');
    if (s.length < 2 || s.length > 30) return null;
    if (s !== s.toUpperCase()) return null;
    if (!/[A-Z]/.test(s)) return null;
    if (/[:;!?]$/.test(s)) return null;               /* transitions end in ':' */
    if (NOT_CUES.test(s)) return null;
    if (!/^[A-Z][A-Z0-9 .,'\-]*$/.test(s)) return null;
    return s;
  }

  /* charactersFromScript(scriptText) → [{name, scenes:[nums], lines}]
     sorted by dialogue cues descending, then name.                         */
  function charactersFromScript(scriptText) {
    var scenes = splitScenes(scriptText);
    var found = {};
    scenes.forEach(function (sc) {
      var i, j, name, nxt;
      for (i = 0; i < sc.body.length; i++) {
        name = cueName(sc.body[i]);
        if (!name) continue;
        nxt = '';
        for (j = i + 1; j < sc.body.length; j++) {
          if (sc.body[j].replace(/\s+/g, '')) { nxt = sc.body[j]; break; }
        }
        if (!nxt || SLUG_RE.test(nxt)) continue;      /* a cue needs dialogue after it */
        if (!found[name]) found[name] = { name: name, lines: 0, sceneSet: {} };
        found[name].lines++;
        found[name].sceneSet[sc.n] = true;
      }
    });
    return Object.keys(found).map(function (k) {
      var f = found[k];
      var list = Object.keys(f.sceneSet).map(function (n) { return +n; })
        .sort(function (a, b) { return a - b; });
      return { name: f.name, scenes: list, lines: f.lines };
    }).sort(function (a, b) {
      return b.lines - a.lines || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
  }

  /* ── 3 · looks & pieces ─────────────────────────────────────────────── */
  function uniqScenes(nums) {
    var seen = {}, out = [];
    (nums || []).forEach(function (v) {
      var n = parseInt(v, 10);
      if (isFinite(n) && n >= 1 && !seen[n]) { seen[n] = true; out.push(n); }
    });
    return out.sort(function (a, b) { return a - b; });
  }

  /* '1, 3-5 9' → [1,3,4,5,9] — commas/spaces split, dashes expand ranges. */
  function parseSceneNums(text) {
    var out = [];
    String(text || '').split(/[,\s]+/).forEach(function (tok) {
      if (!tok) return;
      var m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(tok);
      if (m) {
        var a = +m[1], b = +m[2], i;
        if (b - a <= 500) for (i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
      } else if (/^\d+$/.test(tok)) out.push(+tok);
    });
    return uniqScenes(out);
  }

  function newLook(fields) {
    var f = fields || {};
    return { id: uid('lk'), character: f.character || '', lookName: f.lookName || 'Look 1',
             sceneNums: uniqScenes(f.sceneNums), pieces: [],
             sizes: f.sizes || '', notes: f.notes || '', photoIds: [] };
  }

  function makePiece(fields) {
    var f = fields || {};
    return { item: f.item || 'Garment',
             source: SOURCES.indexOf(f.source) >= 0 ? f.source : 'buy',
             cost: num(f.cost) };
  }

  function lookCost(look) {
    var t = 0;
    ((look && look.pieces) || []).forEach(function (p) { t += num(p.cost); });
    return round2(t);
  }

  function totalsBySource(looks) {
    var out = { buy: 0, rent: 0, build: 0, 'cast-own': 0, total: 0 };
    (looks || []).forEach(function (l) {
      ((l && l.pieces) || []).forEach(function (p) {
        var s = SOURCES.indexOf(p.source) >= 0 ? p.source : 'buy';
        out[s] += num(p.cost);
        out.total += num(p.cost);
      });
    });
    SOURCES.concat(['total']).forEach(function (k) { out[k] = round2(out[k]); });
    return out;
  }

  /* per-character rollup → [{character, looks, cost}] sorted by name */
  function rollupByCharacter(looks) {
    var by = {};
    (looks || []).forEach(function (l) {
      var c = (l.character || '(unassigned)');
      if (!by[c]) by[c] = { character: c, looks: 0, cost: 0 };
      by[c].looks++;
      by[c].cost = round2(by[c].cost + lookCost(l));
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }

  /* ── 4 · change plot ────────────────────────────────────────────────────
     Scene-by-scene grid of who wears what, plus:
     QUICK CHANGE   — same character, adjacent scenes, different looks
     CONTINUITY SPAN— same look across non-adjacent scenes → photograph it
     CONFLICT       — one character down for two looks in the same scene   */
  function changePlot(looks, sceneCount) {
    var n = Math.max(0, parseInt(sceneCount, 10) || 0);
    var charSet = {}, wear = {};                     /* char → scene → [look] */
    (looks || []).forEach(function (l) {
      var c = l.character || '(unassigned)';
      charSet[c] = true;
      if (!wear[c]) wear[c] = {};
      uniqScenes(l.sceneNums).forEach(function (s) {
        if (s > n) n = s;
        if (!wear[c][s]) wear[c][s] = [];
        wear[c][s].push({ lookId: l.id, lookName: l.lookName });
      });
    });
    var characters = Object.keys(charSet).sort();

    var grid = [], conflicts = [], s, row;
    for (s = 1; s <= n; s++) {
      row = { scene: s, wearing: [] };
      characters.forEach(function (c) {
        (wear[c][s] || []).forEach(function (w) {
          row.wearing.push({ character: c, lookId: w.lookId, lookName: w.lookName });
        });
        if ((wear[c][s] || []).length > 1) conflicts.push({ scene: s, character: c });
      });
      grid.push(row);
    }

    var quickChanges = [];
    characters.forEach(function (c) {
      var s;
      for (s = 1; s < n; s++) {
        var a = wear[c][s], b = wear[c][s + 1];
        if (!a || !b) continue;
        var shared = a.some(function (x) {
          return b.some(function (y) { return y.lookId === x.lookId; });
        });
        if (!shared) quickChanges.push({ character: c, fromScene: s, toScene: s + 1,
          fromLook: a[0].lookName, toLook: b[0].lookName });
      }
    });

    var continuitySpans = [];
    (looks || []).forEach(function (l) {
      var ss = uniqScenes(l.sceneNums);
      if (ss.length < 2) return;
      var gap = false, k;
      for (k = 1; k < ss.length; k++) if (ss[k] - ss[k - 1] > 1) gap = true;
      if (gap) continuitySpans.push({ character: l.character || '(unassigned)',
        lookId: l.id, lookName: l.lookName, scenes: ss, note: 'photograph it' });
    });

    return { sceneCount: n, characters: characters, grid: grid,
             quickChanges: quickChanges, continuitySpans: continuitySpans, conflicts: conflicts };
  }

  /* ── 5 · multiples advice ───────────────────────────────────────────────
     Hero garments that get wet, bloody, muddy or torn need doubles.
     sceneHazards(scriptText) → { sceneN: ['blood', …] }                   */
  var HAZARDS = [
    { id: 'blood', re: /\bblood/i },
    { id: 'rain',  re: /\brain/i },
    { id: 'mud',   re: /\bmud/i },
    { id: 'tear',  re: /\b(tears?|tearing|torn|rips?|ripped|ripping|shreds?|shredded)\b/i },
    { id: 'fight', re: /\b(fight|brawl|scuffle|punch)/i },
    { id: 'water', re: /\bwater/i }
  ];

  function sceneHazards(scriptText) {
    var out = {};
    splitScenes(scriptText).forEach(function (sc) {
      var txt = sc.slug + '\n' + sc.body.join('\n');
      var hits = [];
      HAZARDS.forEach(function (h) { if (h.re.test(txt)) hits.push(h.id); });
      if (hits.length) out[sc.n] = hits;
    });
    return out;
  }

  /* Base of 3 multiples for the first hazard scene (one to wear, one to
     wreck, one spare), +1 per further hazard scene, capped at 6. That is
     an estimate — confirm counts with the stunt and SFX departments.      */
  function multiplesAdvice(look, hazardsByScene) {
    var kinds = {}, hazardScenes = [];
    uniqScenes(look && look.sceneNums).forEach(function (s) {
      var hits = hazardsByScene && hazardsByScene[s];
      if (hits && hits.length) {
        hazardScenes.push(s);
        hits.forEach(function (h) { kinds[h] = true; });
      }
    });
    if (!hazardScenes.length) return { multiples: 1, hazards: [], scenes: [], note: '' };
    var m = Math.min(3 + (hazardScenes.length - 1), 6);
    var ks = Object.keys(kinds).sort();
    return { multiples: m, hazards: ks, scenes: hazardScenes,
             note: 'Meets ' + ks.join(' / ') + ' in scene ' + hazardScenes.join(', ') +
                   ' — buy ' + m + ' multiples (estimate; confirm with stunts/SFX).' };
  }

  /* ── 6 · photo sizing math (the IndexedDB work itself lives in the page) */
  function fitWithin(w, h, max) {
    w = Math.max(1, num(w)); h = Math.max(1, num(h)); max = Math.max(1, num(max) || 1024);
    var scale = Math.min(1, max / Math.max(w, h));
    return { w: Math.round(w * scale), h: Math.round(h * scale), scale: scale };
  }

  root.CWard = {
    SOURCES: SOURCES, HAZARDS: HAZARDS,
    splitScenes: splitScenes, cueName: cueName, charactersFromScript: charactersFromScript,
    uniqScenes: uniqScenes, parseSceneNums: parseSceneNums,
    newLook: newLook, makePiece: makePiece, lookCost: lookCost,
    totalsBySource: totalsBySource, rollupByCharacter: rollupByCharacter,
    changePlot: changePlot, sceneHazards: sceneHazards, multiplesAdvice: multiplesAdvice,
    fitWithin: fitWithin
  };
})(typeof window !== 'undefined' ? window : globalThis);
