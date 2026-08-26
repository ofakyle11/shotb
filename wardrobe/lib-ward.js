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
  /* The one scene model — js/lib-scenes.js. Every module used to carry its
     own screenplay splitter; they disagreed on preambles, printed scene
     numbers and A/B scenes, so they now all read from here. Loaded by a
     <script> tag before this file, and by the node suites. */
  var CS = root.CScenes;
  if (!CS) throw new Error('lib-ward.js requires js/lib-scenes.js to be loaded first');


  var SOURCES = ['buy', 'rent', 'build', 'cast-own'];

  function uid(p) { return (p || 'w') + Math.random().toString(36).slice(2, 9); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round2(v) { return Math.round(v * 100) / 100; }

  /* ── 1 · scenes ─────────────────────────────────────────────────────── */
  var splitScenes = CS.split;

  /* ── 2 · dialogue cues → characters ─────────────────────────────────────
     A character cue is a short ALL-CAPS line (2–30 chars), not a slugline,
     not a transition/format keyword, optionally suffixed (V.O.)/(O.S.)/
     (CONT'D), and followed by an actual line of dialogue.                  */
  var NOT_CUES = /^(FADE IN|FADE OUT|FADE TO|CUT TO|DISSOLVE TO|SMASH CUT|MATCH CUT|JUMP CUT|CONTINUED|INTERCUT|MONTAGE|SERIES OF SHOTS|TITLE|SUPER|CHYRON|THE END|END OF|BLACK|LATER|BEAT|BACK TO|OMITTED|ANGLE ON|CLOSE ON|INSERT)\b/;

  function cueName(line) {
    var t = String(line == null ? '' : line).trim();
    if (!t) return null;
    if (CS.isSlug(t)) return null;
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
        if (!nxt || CS.isSlug(nxt)) continue;      /* a cue needs dialogue after it */
        if (!found[name]) found[name] = { name: name, lines: 0, sceneSet: {}, keySet: {} };
        found[name].lines++;
        found[name].sceneSet[sc.n] = true;
        /* `scenes` stays the legacy integer list every existing reader expects;
           `sceneKeys` carries the printed identity, so a character who only
           speaks in 4A is not filed under 4. */
        if (sc.key) found[name].keySet[sc.key] = true;
      }
    });
    return Object.keys(found).map(function (k) {
      var f = found[k];
      var list = Object.keys(f.sceneSet).map(function (n) { return +n; })
        .sort(function (a, b) { return a - b; });
      var keys = Object.keys(f.keySet).sort(function (a, b) { return CS.keyWeight(a) - CS.keyWeight(b); });
      return { name: f.name, scenes: list, sceneKeys: keys, lines: f.lines };
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

  /* A look carries scenes twice, deliberately and only for as long as the
     migration takes: `sceneNums` is the legacy integer list every existing
     record and the old change plot use, and `sceneKeys` is the printed
     identity ('4A') the costume plot and the shooting order join on. Writing
     both keeps every stored look readable while A-scenes stop being lost. */
  function newLook(fields) {
    var f = fields || {};
    var keys = (f.sceneKeys && f.sceneKeys.length)
      ? CS.parseSceneNums(f.sceneKeys.join(','))
      : uniqScenes(f.sceneNums).map(function (n) { return String(n); });
    return { id: uid('lk'), character: f.character || '', lookName: f.lookName || 'Look 1',
             sceneNums: uniqScenes((f.sceneNums && f.sceneNums.length) ? f.sceneNums : keys),
             sceneKeys: keys, pieces: [],
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

  /* ── 6 · the costume plot (character × scene, ordered by STORY day) ─────
     `changePlot` above is the old numeric-scene grid and stays for callers
     that still use it. It cannot express two things a supervisor needs:

       1. A/B scenes. It keys on integers, so 4 and 4A are the same column —
          and on a revised script the A-scenes are exactly the new material.
       2. Story order. Scene order in the file is not the order the day is
          lived (a flashback), and it is emphatically not the order it is
          shot. What must MATCH is decided by the story day; what must be
          PREPARED for on the truck is decided by the shooting order.

     costumePlot keys on the printed scene identity (CScenes `key`), groups by
     story day (CStoryDay), and carries the shooting position alongside so the
     two orders can be read against each other on one line.                */

  /* Scene keys a look is worn in: printed identities as strings ('4A'), taken
     from the look's own sceneKeys when it has them, else lifted from the
     legacy numeric sceneNums. */
  function lookSceneKeys(look) {
    var raw = (look && look.sceneKeys) || null;
    if (!raw || !raw.length) raw = ((look && look.sceneNums) || []).map(function (n) { return String(n); });
    var seen = {}, out = [];
    raw.forEach(function (v) {
      var k = CS.normNum(v);
      if (k && !seen[k]) { seen[k] = 1; out.push(k); }
    });
    return out.sort(function (a, b) { return CS.keyWeight(a) - CS.keyWeight(b); });
  }

  /* What a person types into the scenes box. Unlike the legacy parseSceneNums
     above, this one keeps A-scenes: '4, 4A, 7-9' → ['4','4A','7','8','9']. */
  function parseSceneKeys(text) { return CS.parseSceneNums(text); }

  /* Hazards keyed by printed scene identity, so 4 and 4A do not collide. */
  function sceneHazardsByKey(scriptText) {
    var out = {};
    CS.parse(scriptText).scenes.forEach(function (sc) {
      var t = sc.slug + '\n' + sc.body.join('\n'), hits = [];
      HAZARDS.forEach(function (h) { if (h.re.test(t)) hits.push(h.id); });
      if (hits.length) out[sc.key] = hits;
    });
    return out;
  }

  /* The multiples estimate, over scene keys. Same arithmetic as
     multiplesAdvice, which stays for the numeric callers. */
  function multiplesFor(look, hazardsByKey) {
    var kinds = {}, hit = [];
    lookSceneKeys(look).forEach(function (k) {
      var hz = hazardsByKey && hazardsByKey[k];
      if (hz && hz.length) { hit.push(k); hz.forEach(function (h) { kinds[h] = true; }); }
    });
    if (!hit.length) return { multiples: 1, hazards: [], scenes: [], note: '' };
    var m = Math.min(3 + (hit.length - 1), 6), ks = Object.keys(kinds).sort();
    return { multiples: m, hazards: ks, scenes: hit,
             note: 'Meets ' + ks.join(' / ') + ' in scene ' + hit.join(', ') +
                   ' — buy ' + m + ' multiples (estimate; confirm with stunts/SFX).' };
  }

  /* shootOrderFromBoard(board, scenes) → [{key, shootDay, pos}] plus what did
     not match. SB_ScheduleBoard_v1 identifies a strip by its ORDINAL (`num`)
     and its heading, never by the printed scene number, so the join has to be
     made here and it has to be honest about its misses: an unmatched strip is
     a scene whose shooting position this page does not know, and saying so is
     the difference between a gap and a wrong answer. */
  function shootOrderFromBoard(board, scenes) {
    var strips = (board && board.scenes) || [];
    var list = (scenes && scenes.length) ? scenes : [];
    var byOrd = {}, byHead = {};
    list.forEach(function (sc) {
      byOrd[sc.ord] = sc;
      var h = String(sc.slug || '').toUpperCase().replace(/\s+/g, ' ');
      if (h && byHead[h] === undefined) byHead[h] = sc;
    });
    var placed = [], unmatched = [], seen = {};
    strips.forEach(function (st, i) {
      var head = String(st.heading || '').toUpperCase()
        .replace(/^\s*(?:[0-9]+[A-Z]{0,3}|[A-Z]{1,3}[0-9]+)\s*[.)\-]?\s+/, '').replace(/\s+/g, ' ');
      var sc = byHead[head] || byOrd[st.num] || null;
      if (!sc || seen[sc.key]) { unmatched.push(String(st.heading || ('strip ' + (i + 1)))); return; }
      seen[sc.key] = 1;
      placed.push({ key: sc.key, label: sc.label, ord: sc.ord,
                    shootDay: (st.day == null ? -1 : +st.day), boardIndex: i });
    });
    /* Boneyard strips (day < 0) are not scheduled: they get no position. */
    var sched = placed.filter(function (p) { return p.shootDay >= 0; })
      .sort(function (a, b) { return a.shootDay - b.shootDay || a.boardIndex - b.boardIndex; });
    sched.forEach(function (p, i) { p.pos = i + 1; });
    var unscheduled = placed.filter(function (p) { return p.shootDay < 0; });
    unscheduled.forEach(function (p) { p.pos = 0; });
    return { order: sched, unscheduled: unscheduled, unmatched: unmatched,
             matched: placed.length, strips: strips.length };
  }

  /* costumePlot({looks, scenes, story, shootOrder}) → the plot itself.
       scenes      CScenes records (the printed identities)
       story       a CStoryDay.derive() result — optional; without one every
                   scene lands on day 0 and the whole plot is marked uncertain,
                   which is the truthful answer rather than a fabricated day 1.
       shootOrder  [{key, shootDay, pos}] from shootOrderFromBoard, optional. */
  function costumePlot(opts) {
    var o = opts || {};
    var looks = o.looks || [], scenes = o.scenes || [];
    var story = o.story || null;
    var shoot = {};
    (o.shootOrder || []).forEach(function (s) { shoot[CS.normNum(s.key)] = s; });

    var dayOfKey = {}, confOf = {}, dayMeta = {};
    if (story) {
      (story.rows || []).forEach(function (r) { dayOfKey[r.key] = r.day; confOf[r.key] = r.confidence; });
      (story.days || []).forEach(function (d) { dayMeta[d.day] = d; });
    }

    /* character → scene key → [{lookId, lookName}] */
    var wear = {}, charSet = {}, unplaced = [];
    var known = {};
    scenes.forEach(function (sc) { known[sc.key] = sc; });
    looks.forEach(function (l) {
      var c = l.character || '(unassigned)';
      charSet[c] = true;
      if (!wear[c]) wear[c] = {};
      lookSceneKeys(l).forEach(function (k) {
        if (!known[k]) { unplaced.push({ character: c, lookName: l.lookName, scene: k }); return; }
        if (!wear[c][k]) wear[c][k] = [];
        wear[c][k].push({ lookId: l.id, lookName: l.lookName });
      });
    });
    var characters = Object.keys(charSet).sort();

    /* Scenes in STORY order: day, then the order they play inside the day. */
    var ordered = scenes.slice().sort(function (a, b) {
      var da = dayOfKey[a.key] || 0, db = dayOfKey[b.key] || 0;
      return da - db || (a.sortKey || a.ord || 0) - (b.sortKey || b.ord || 0);
    });

    /* Change numbers, assigned in story order — this is what the department
       calls a change: MAGGIE #1, #2, #3. A look that comes back keeps its own
       number, because "back into change 2" is the instruction. */
    var changeNo = {}, nextNo = {}, changes = {}, changeList = [];
    ordered.forEach(function (sc) {
      characters.forEach(function (c) {
        ((wear[c] || {})[sc.key] || []).forEach(function (w) {
          var id = c + '|' + w.lookId;
          if (!changeNo[id]) {
            nextNo[c] = (nextNo[c] || 0) + 1;
            changeNo[id] = nextNo[c];
            changes[id] = { character: c, changeNo: nextNo[c], lookId: w.lookId, lookName: w.lookName,
                            scenes: [], days: [], shootDays: [], shootPositions: [],
                            dayUncertain: false, mustMatch: false, outOfOrder: false, note: '' };
            changeList.push(changes[id]);
          }
          var ch = changes[id];
          ch.scenes.push(sc.key);
          var d = dayOfKey[sc.key] || 0;
          if (ch.days.indexOf(d) < 0) ch.days.push(d);
          if (confOf[sc.key] && confOf[sc.key] !== 'CERTAIN') ch.dayUncertain = true;
          if (!story) ch.dayUncertain = true;
          var sh = shoot[sc.key];
          if (sh) {
            if (ch.shootDays.indexOf(sh.shootDay) < 0) ch.shootDays.push(sh.shootDay);
            ch.shootPositions.push(sh.pos);
          }
        });
      });
    });

    changeList.forEach(function (ch) {
      ch.days.sort(function (a, b) { return a - b; });
      ch.shootDays.sort(function (a, b) { return a - b; });
      ch.mustMatch = ch.scenes.length > 1;
      /* Shot in a different order than it is lived: the classic continuity
         trap — the torn, bloodied, rained-on state of a garment is arrived at
         on story day 2 and photographed on shooting day 9. */
      var pos = ch.shootPositions.slice();
      ch.outOfOrder = pos.length > 1 && pos.some(function (p, i) { return i > 0 && p < pos[i - 1]; });
      var bits = [];
      if (ch.scenes.length > 1) bits.push('worn in ' + ch.scenes.length + ' scenes (' + ch.scenes.join(', ') + ')');
      if (ch.days.length > 1) bits.push('across ' + ch.days.length + ' story days');
      if (ch.shootDays.length > 1) bits.push('shot over ' + ch.shootDays.length + ' shooting days — photograph it and match');
      if (ch.outOfOrder) bits.push('shot out of story order');
      if (ch.dayUncertain) bits.push('its story day is UNCERTAIN — confirm with the script supervisor');
      ch.note = bits.join('; ');
    });

    /* The grid, one row per scene in story order, grouped into days. */
    var days = [], byDay = {}, conflicts = [];
    ordered.forEach(function (sc) {
      var d = dayOfKey[sc.key] || 0;
      if (!byDay[d]) {
        var meta = dayMeta[d];
        byDay[d] = { day: d, name: (meta && meta.name) || '',
                     label: meta ? meta.label : (story ? 'Story Day ' + d : 'Story day not derived'),
                     certain: meta ? !!meta.certain : false, scenes: [] };
        days.push(byDay[d]);
      }
      var sh = shoot[sc.key] || null;
      var row = { key: sc.key, label: sc.label, ord: sc.ord, tod: sc.tod, iu: sc.iu,
                  location: sc.location, day: d,
                  dayConfidence: confOf[sc.key] || 'UNCERTAIN',
                  shootDay: sh ? sh.shootDay : -1, shootPos: sh ? sh.pos : 0,
                  cells: [] };
      characters.forEach(function (c) {
        var w = (wear[c] || {})[sc.key] || [];
        if (w.length > 1) conflicts.push({ scene: sc.key, character: c,
          looks: w.map(function (x) { return x.lookName; }) });
        row.cells.push({ character: c, worn: w.map(function (x) {
          return { lookId: x.lookId, lookName: x.lookName, changeNo: changeNo[c + '|' + x.lookId] || 0 };
        }) });
      });
      byDay[d].scenes.push(row);
    });
    days.sort(function (a, b) { return a.day - b.day; });

    /* Quick changes are a STORY-day question (how long the character has) and
       a SHOOTING question (whether the change happens on the day). Adjacency
       is measured inside the story day, where the clock actually runs. */
    var quickChanges = [];
    days.forEach(function (d) {
      var i, j;
      for (i = 1; i < d.scenes.length; i++) {
        for (j = 0; j < characters.length; j++) {
          var c = characters[j];
          var a = ((wear[c] || {})[d.scenes[i - 1].key]) || [];
          var b = ((wear[c] || {})[d.scenes[i].key]) || [];
          if (!a.length || !b.length) continue;
          var shared = a.some(function (x) { return b.some(function (y) { return y.lookId === x.lookId; }); });
          if (shared) continue;
          quickChanges.push({ character: c, day: d.day,
            fromScene: d.scenes[i - 1].key, toScene: d.scenes[i].key,
            fromLook: a[0].lookName, toLook: b[0].lookName,
            fromChange: changeNo[c + '|' + a[0].lookId] || 0,
            toChange: changeNo[c + '|' + b[0].lookId] || 0,
            sameShootDay: (shoot[d.scenes[i - 1].key] && shoot[d.scenes[i].key])
              ? shoot[d.scenes[i - 1].key].shootDay === shoot[d.scenes[i].key].shootDay : null });
        }
      }
    });

    var shootRows = ordered.slice().filter(function (sc) { return shoot[sc.key]; })
      .sort(function (a, b) { return shoot[a.key].pos - shoot[b.key].pos; })
      .map(function (sc) {
        return { key: sc.key, label: sc.label, day: dayOfKey[sc.key] || 0,
                 dayConfidence: confOf[sc.key] || 'UNCERTAIN',
                 shootDay: shoot[sc.key].shootDay, shootPos: shoot[sc.key].pos,
                 wearing: characters.map(function (c) {
                   return { character: c, worn: ((wear[c] || {})[sc.key] || []).map(function (x) {
                     return { lookName: x.lookName, changeNo: changeNo[c + '|' + x.lookId] || 0 }; }) };
                 }).filter(function (x) { return x.worn.length; }) };
      });

    return {
      characters: characters, days: days, changes: changeList,
      quickChanges: quickChanges, conflicts: conflicts, unplaced: unplaced,
      shootOrdered: shootRows,
      sceneCount: ordered.length,
      storyDerived: !!story,
      uncertainScenes: ordered.filter(function (sc) {
        return !confOf[sc.key] || confOf[sc.key] !== 'CERTAIN'; }).map(function (sc) { return sc.key; })
    };
  }

  /* ── 7 · continuity photos: project namespacing and orphans ─────────────
     The bytes of a continuity photo live in IndexedDB and the vault snapshots
     localStorage only, so the photos are outside the project, outside the
     archive and outside the studio cloud back-up — while the photo REFERENCES
     are inside all three. Two consequences, both real:

       * switching projects wipes and rewrites localStorage and leaves the
         blobs where they are, so every photo of the outgoing project becomes
         an orphan the moment the department switches;
       * an archive restored on a second device carries references to bytes
         that were never in it, so the looks show empty frames.

     Nothing in wardrobe/ can put bytes in the vault. What it CAN do is stamp
     every record with the project that made it so they stop bleeding across
     productions, count what is stranded, and hand the department a portable
     pack so the record can travel by hand until the vault carries it.      */

  function projectSlug(name) {
    var s = String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return s || 'project-1';
  }

  /* A photo record, stamped with its project. `id` is prefixed with the
     project slug so two productions cannot collide on one key even if the
     random tail repeats. */
  function photoRecord(fields) {
    var f = fields || {};
    var proj = String(f.project == null ? '' : f.project);
    var id = f.id || (projectSlug(proj) + ':' + uid('ph'));
    return { id: id, project: proj, lookId: f.lookId || '', dataUrl: f.dataUrl || '',
             date: f.date || '', bytes: (f.dataUrl || '').length };
  }

  /* referencedPhotoIds({projectName: wardrobeStateOrJson}) → {project:[ids]}.
     The vault's own meta (CIN_Projects_v1) holds every project's snapshot of
     SB_Wardrobe_v1, so the full reference set across ALL projects is knowable
     from localStorage alone — which is what makes an honest orphan count
     possible without touching the vault. */
  function referencedPhotoIds(states) {
    var out = {};
    Object.keys(states || {}).forEach(function (proj) {
      var v = states[proj], st = v;
      if (typeof v === 'string') { try { st = JSON.parse(v); } catch (e) { st = null; } }
      var ids = [];
      ((st && st.looks) || []).forEach(function (l) {
        ((l && l.photoIds) || []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(String(id)); });
      });
      out[proj] = ids;
    });
    return out;
  }

  /* orphanScan(records, refsByProject, activeProject) → what is actually in
     the browser versus what any project still points at. */
  function orphanScan(records, refsByProject, activeProject) {
    var recs = records || [], refs = refsByProject || {};
    var active = String(activeProject == null ? '' : activeProject);
    var all = {}, byProj = {};
    Object.keys(refs).forEach(function (p) {
      byProj[p] = {};
      (refs[p] || []).forEach(function (id) { all[id] = p; byProj[p][id] = true; });
    });
    var mine = [], foreign = [], orphans = [], legacy = [], bytes = 0, mineBytes = 0, orphanBytes = 0;
    var have = {};
    recs.forEach(function (r) {
      var b = Number(r.bytes || (r.dataUrl || '').length) || 0;
      bytes += b;
      have[r.id] = true;
      var owner = r.project == null ? '' : String(r.project);
      if (!owner) legacy.push(r);
      if (!all[r.id]) { orphans.push(r); orphanBytes += b; return; }
      if (owner === active || (!owner && all[r.id] === active)) { mine.push(r); mineBytes += b; }
      else foreign.push(r);
    });
    var missing = [];
    (refs[active] || []).forEach(function (id) { if (!have[id]) missing.push(id); });
    return {
      total: recs.length, bytes: bytes,
      mine: mine, mineBytes: mineBytes,
      foreign: foreign,
      orphans: orphans, orphanBytes: orphanBytes,
      legacy: legacy,
      missing: missing,
      projects: Object.keys(refs).sort()
    };
  }

  /* A portable pack: the bytes the vault cannot carry, as one file the
     department can hand to the next device. Deterministic — `when` comes from
     the caller, never from a clock in here. */
  var PACK_FORMAT = 'cinamate/wardrobe-photos/1';
  function photoPack(project, looks, records, when) {
    var keep = {};
    (looks || []).forEach(function (l) { ((l && l.photoIds) || []).forEach(function (id) { keep[id] = true; }); });
    return {
      format: PACK_FORMAT,
      project: String(project == null ? '' : project),
      savedAt: String(when == null ? '' : when),
      looks: (looks || []).map(function (l) {
        return { id: l.id, character: l.character || '', lookName: l.lookName || '',
                 photoIds: (l.photoIds || []).slice() };
      }),
      photos: (records || []).filter(function (r) { return keep[r.id]; }).map(function (r) {
        return { id: r.id, project: String(project == null ? '' : project), lookId: r.lookId || '',
                 dataUrl: r.dataUrl || '', date: r.date || '' };
      })
    };
  }
  /* readPhotoPack throws rather than returning a half-understood object: a
     pack that cannot be read must not quietly restore nothing. */
  function readPhotoPack(input) {
    var p = input;
    if (typeof input === 'string') {
      try { p = JSON.parse(input); } catch (e) { throw new Error('That file is not a wardrobe photo pack'); }
    }
    if (!p || p.format !== PACK_FORMAT) throw new Error('Not a Cinamate wardrobe photo pack (format missing)');
    if (!p.photos || Object.prototype.toString.call(p.photos) !== '[object Array]') {
      throw new Error('That pack carries no photos');
    }
    var ok = p.photos.filter(function (r) {
      return r && typeof r.dataUrl === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(r.dataUrl);
    });
    if (!ok.length) throw new Error('That pack carries no readable photos');
    return { format: p.format, project: String(p.project || ''), savedAt: String(p.savedAt || ''),
             looks: p.looks || [], photos: ok, dropped: p.photos.length - ok.length };
  }

  /* ── 8 · photo sizing math (the IndexedDB work itself lives in the page) */
  function fitWithin(w, h, max) {
    w = Math.max(1, num(w)); h = Math.max(1, num(h)); max = Math.max(1, num(max) || 1024);
    var scale = Math.min(1, max / Math.max(w, h));
    return { w: Math.round(w * scale), h: Math.round(h * scale), scale: scale };
  }

  root.CWard = {
    SOURCES: SOURCES, HAZARDS: HAZARDS, PACK_FORMAT: PACK_FORMAT,
    splitScenes: splitScenes, cueName: cueName, charactersFromScript: charactersFromScript,
    uniqScenes: uniqScenes, parseSceneNums: parseSceneNums,
    newLook: newLook, makePiece: makePiece, lookCost: lookCost,
    totalsBySource: totalsBySource, rollupByCharacter: rollupByCharacter,
    changePlot: changePlot, sceneHazards: sceneHazards, multiplesAdvice: multiplesAdvice,
    lookSceneKeys: lookSceneKeys, parseSceneKeys: parseSceneKeys,
    sceneHazardsByKey: sceneHazardsByKey, multiplesFor: multiplesFor,
    shootOrderFromBoard: shootOrderFromBoard, costumePlot: costumePlot,
    projectSlug: projectSlug, photoRecord: photoRecord,
    referencedPhotoIds: referencedPhotoIds, orphanScan: orphanScan,
    photoPack: photoPack, readPhotoPack: readPhotoPack,
    fitWithin: fitWithin
  };
})(typeof window !== 'undefined' ? window : globalThis);
