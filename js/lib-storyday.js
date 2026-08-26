/* CINAMATE — story days (CStoryDay).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A scene record says INT/EXT and a time of day. It does not say WHICH DAY of
 * the story it is, and no other store does either. That is the join a costume
 * supervisor, a make-up continuity and a script supervisor all need: "scene 4A
 * and scene 22 are the same story day, so the shirt, the cut lip and the hair
 * must match" — and it is invisible in a shooting order, where 22 is shot on
 * day 2 and 4A on day 9.
 *
 * HONEST ABOUT AMBIGUITY
 * ----------------------
 * A screenplay very often does not say. "INT. KITCHEN - DAY" after
 * "EXT. ROAD - DAY" may be ten minutes later or a fortnight later; the page is
 * silent and the only person who knows is the writer. So every boundary this
 * module derives carries a confidence:
 *
 *   CERTAIN    the script itself said so — CONTINUOUS / SAME TIME / LATER,
 *              an explicit NEXT DAY / THREE DAYS LATER / DAY 4 cue, or a
 *              NIGHT -> DAY transition (the sun came up; that is a new day).
 *   UNCERTAIN  the derivation had to pick. DAY -> DAY, NIGHT -> NIGHT,
 *              DAY -> NIGHT and any scene with no printed time of day are all
 *              guesses, and are reported as guesses rather than presented as
 *              facts. The default is "same story day" because that is the
 *              conservative reading for continuity: it makes the department
 *              match MORE, and an unnecessary match costs a photograph, while
 *              a missed one costs a reshoot.
 *
 * Nothing here invents certainty. `result.uncertain` is the list a supervisor
 * walks with the script supervisor, and every one of those scenes can be
 * overridden by hand; the override is persisted and always wins.
 *
 * PURE — no DOM, no Date.now inside the derivation. Node-testable via
 * scripts/test_storyday.mjs. Original code, written for Cinamate.
 */
(function (root) {
  'use strict';

  /* The one scene model. Story days are derived FROM scenes; they never
     re-parse a screenplay themselves. */
  var CS = root.CScenes;
  if (!CS) throw new Error('js/lib-storyday.js requires js/lib-scenes.js to be loaded first');

  var KEY = 'SB_StoryDays_v1';
  var CERTAIN = 'CERTAIN', UNCERTAIN = 'UNCERTAIN';

  function txt(v) { return String(v == null ? '' : v); }
  function upper(v) { return txt(v).toUpperCase(); }

  /* ── 1 · time-of-day classification ────────────────────────────────────
     Four kinds, not two. 'SAME' is the class of tokens that explicitly tie a
     scene to the one before it, and 'UNKNOWN' is a real answer — an
     unnumbered draft with bare "INT. KITCHEN" headings has to be reported as
     unknown, not silently filed under DAY.                                */
  function todKind(text) {
    var t = upper(text);
    if (!t.replace(/\s/g, '')) return 'UNKNOWN';
    if (/\b(CONTINUOUS|CONT'?S|SAME TIME|MOMENTS LATER)\b/.test(t)) return 'SAME';
    if (/\b(NIGHT|EVENING|DUSK|SUNSET|MIDNIGHT|MAGIC HOUR)\b/.test(t)) return 'NIGHT';
    if (/\b(DAY|MORNING|AFTERNOON|NOON|MIDDAY|DAWN|SUNRISE)\b/.test(t)) return 'DAY';
    if (/\bLATER\b/.test(t)) return 'SAME';
    if (/\bSAME\b/.test(t)) return 'SAME';
    return 'UNKNOWN';
  }

  /* ── 2 · the cues a script actually prints ─────────────────────────────
     These are read off the WHOLE slugline and the first lines of action, not
     off `tod`: CScenes only lifts a recognised time word into `tod`, so
     "INT. KITCHEN - NEXT DAY" leaves "NEXT DAY" sitting in the location and a
     tod-only reader never sees the one cue that settles the question.      */
  var NEW_DAY_RE = new RegExp(
    '\\b(?:THE\\s+)?(?:NEXT|FOLLOWING)\\s+(?:DAY|MORNING|NIGHT|EVENING|AFTERNOON|WEEK|MONTH|YEAR)\\b' +
    '|\\b(?:A|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|[0-9]+)\\s+' +
    '(?:DAYS?|NIGHTS?|WEEKS?|MONTHS?|YEARS?)\\s+(?:LATER|EARLIER|AGO|ON)\\b' +
    '|\\bTHE\\s+(?:DAY|MORNING|NIGHT)\\s+AFTER\\b');
  var SAME_DAY_RE = new RegExp(
    '\\bLATER\\s+THAT\\s+(?:DAY|NIGHT|MORNING|AFTERNOON|EVENING)\\b' +
    '|\\bTHAT\\s+(?:SAME\\s+)?(?:DAY|NIGHT|MORNING|AFTERNOON|EVENING)\\b' +
    '|\\bSAME\\s+(?:DAY|NIGHT)\\b|\\bCONTINUOUS\\b|\\bSAME\\s+TIME\\b|\\bMOMENTS\\s+LATER\\b');
  /* An explicit story-day stamp. Some shooting scripts print it on the
     slugline exactly so this question has an answer: "- DAY 4". */
  var PIN_RE = /\b(?:STORY\s+)?DAY\s+([0-9]{1,3})\b/;
  /* Out-of-time material. It is a new story day in the sense that nothing in
     it matches the scene before — but WHICH day it is, the script has not
     said, so it is never CERTAIN. */
  var ELSEWHEN_RE = /\b(FLASH\s?BACKS?|FLASH\s?FORWARDS?|DREAM(?:\s+SEQUENCE)?|FANTASY(?:\s+SEQUENCE)?|MEMORY|YEARS\s+AGO|MONTHS\s+AGO)\b/;

  /* The text a cue may legitimately appear in: the printed heading plus the
     first two lines of action. Anything deeper is prose about a day, not a
     statement about this scene's day. */
  function cueText(sc) {
    var head = upper(sc && (sc.raw || sc.slug || sc.heading));
    var body = [], list = (sc && sc.body) || [], i;
    for (i = 0; i < list.length && body.length < 2; i++) {
      if (txt(list[i]).replace(/\s+/g, '')) body.push(upper(list[i]));
    }
    return head + ' ¶ ' + body.join(' ¶ ');
  }

  /* cueOf(scene) → the explicit instruction the script gave, or null.
     Order matters: a pinned day beats a relative cue, and a relative cue
     beats a same-day cue, because "THE NEXT DAY. LATER THAT MORNING" is one
     sentence about one boundary and the first half is the operative half. */
  function cueOf(sc) {
    var t = cueText(sc);
    var pin = PIN_RE.exec(t);
    if (pin) return { boundary: 'PIN', day: parseInt(pin[1], 10), confidence: CERTAIN,
                      reason: 'the script prints "DAY ' + pin[1] + '" on the heading' };
    if (ELSEWHEN_RE.test(t)) return { boundary: 'NEW', confidence: UNCERTAIN,
                      reason: 'flashback / dream / other-time material — it is not this story day, and the script does not say which day it is' };
    if (NEW_DAY_RE.test(t)) return { boundary: 'NEW', confidence: CERTAIN,
                      reason: 'the script says the story has moved on ("next day" / "days later")' };
    if (SAME_DAY_RE.test(t)) return { boundary: 'SAME', confidence: CERTAIN,
                      reason: 'the script ties this scene to the one before it (continuous / same day)' };
    return null;
  }

  /* ── 3 · the derivation ────────────────────────────────────────────────
     One scene at a time, against the scene before it. Every branch names its
     own reason in words a supervisor can argue with.                       */
  /* `prev` is either the previous scene record or, from derive(), the CARRIED
     time of day — the last one the script actually printed. That distinction
     carries the weight here: a run of CONTINUOUS headings has no clock of its own, and
     comparing against the literal previous scene made "NIGHT, CONTINUOUS, DAY"
     read as SAME -> DAY and miss the sunrise entirely. */
  function boundaryFor(prev, sc, i) {
    if (i === 0) return { boundary: 'NEW', confidence: CERTAIN, reason: 'first scene of the script — story day 1' };
    var cue = cueOf(sc);
    if (cue) return cue;

    var a = typeof prev === 'string' ? prev : todKind(prev && (prev.tod || prev.slug));
    var b = todKind(sc && (sc.tod || sc.slug));

    if (b === 'SAME') return { boundary: 'SAME', confidence: CERTAIN,
      reason: 'the heading reads continuous / later — the same story day as the scene before' };
    if (b === 'UNKNOWN') return { boundary: 'SAME', confidence: UNCERTAIN,
      reason: 'no time of day is printed on this heading — kept on the same story day, but nothing in the script says so' };
    if (a === 'UNKNOWN' || a === 'SAME') return { boundary: 'SAME', confidence: UNCERTAIN,
      reason: 'the last printed time of day is unknown, so nothing can be said about the boundary — kept on the same story day' };
    if (a === 'NIGHT' && b === 'DAY') return { boundary: 'NEW', confidence: CERTAIN,
      reason: 'night gives way to day — the sun came up, so this is a new story day' };
    if (a === 'DAY' && b === 'NIGHT') return { boundary: 'SAME', confidence: UNCERTAIN,
      reason: 'day into night: read as the same day carrying on into the evening, but it could be any later night' };
    if (a === 'DAY' && b === 'DAY') return { boundary: 'SAME', confidence: UNCERTAIN,
      reason: 'two daytime scenes running: the script does not say whether a night passed between them' };
    return { boundary: 'SAME', confidence: UNCERTAIN,
      reason: 'two night scenes running: the script does not say whether this is the same night' };
  }

  /* An override is one of: 'SAME', 'NEW', or a story-day number. Whatever the
     derivation thought, a person who has read the script wins. */
  function overrideFor(v) {
    if (v == null || v === '' || v === 'AUTO') return null;
    var n = typeof v === 'number' ? v : (/^[0-9]+$/.test(txt(v).replace(/^\s+|\s+$/g, '')) ? parseInt(v, 10) : NaN);
    if (isFinite(n) && n > 0) return { boundary: 'PIN', day: n, confidence: CERTAIN, source: 'MANUAL',
      reason: 'set by hand to story day ' + n };
    var s = upper(v);
    if (s === 'NEW') return { boundary: 'NEW', confidence: CERTAIN, source: 'MANUAL', reason: 'set by hand: starts a new story day' };
    if (s === 'SAME') return { boundary: 'SAME', confidence: CERTAIN, source: 'MANUAL', reason: 'set by hand: same story day as the scene before' };
    return null;
  }

  function sceneListOf(input) {
    if (typeof input === 'string') return CS.parse(input).scenes;
    if (input && Object.prototype.toString.call(input) !== '[object Array]' && input.scenes) return input.scenes;
    return (input || []).slice();
  }

  function dayLabel(day, certain) { return 'Story Day ' + day + (certain ? '' : ' ?'); }

  /* derive(scriptTextOrScenes, opts) → the whole picture.
       opts.overrides {sceneKey: 'SAME'|'NEW'|n}   opts.names {'1': 'Wedding day'}
     `opts` may be the SB_StoryDays_v1 store itself. */
  function derive(input, opts) {
    var o = opts || {};
    var overrides = o.overrides || {}, names = o.names || {};
    var scenes = sceneListOf(input);
    var rows = [], days = [], byDay = {}, cur = 0, top = 0, carried = 'UNKNOWN';

    scenes.forEach(function (sc, i) {
      var d = boundaryFor(carried, sc, i);
      var key = txt(sc.key || sc.label || (i + 1));
      var manual = overrideFor(overrides[key]);
      var derived = d;
      if (manual) d = manual;
      if (i === 0 && d.boundary === 'SAME') d = { boundary: 'NEW', confidence: d.confidence,
        source: d.source, reason: d.reason + ' (the first scene has to start a day)' };

      if (d.boundary === 'PIN') cur = d.day;
      else if (d.boundary === 'NEW') cur = top + 1;
      if (cur < 1) cur = 1;
      if (cur > top) top = cur;

      var row = {
        key: key, label: txt(sc.label || key), ord: sc.ord || (i + 1), n: sc.n || 0,
        slug: txt(sc.slug), location: txt(sc.location), tod: txt(sc.tod), iu: txt(sc.iu),
        kind: todKind(sc.tod || sc.slug),
        day: cur,
        boundary: d.boundary,
        confidence: d.confidence,
        source: manual ? 'MANUAL' : 'DERIVED',
        reason: d.reason,
        /* What the derivation thought before any override, so a supervisor can
           see WHAT they overruled rather than only that they overruled it. */
        derivedBoundary: derived.boundary,
        derivedConfidence: derived.confidence,
        derivedReason: derived.reason
      };
      rows.push(row);
      if (!byDay[cur]) {
        byDay[cur] = { day: cur, name: txt(names[cur] || names[String(cur)] || ''),
                       label: '', certain: true, scenes: [], rows: [], uncertain: [], tods: [] };
        days.push(byDay[cur]);
      }
      byDay[cur].scenes.push(key);
      byDay[cur].rows.push(row);
      if (row.confidence !== CERTAIN) { byDay[cur].certain = false; byDay[cur].uncertain.push(key); }
      if (row.kind !== 'UNKNOWN' && byDay[cur].tods.indexOf(row.kind) < 0) byDay[cur].tods.push(row.kind);
      /* Only a printed DAY or NIGHT moves the clock on. CONTINUOUS, LATER and
         a heading with no time of day inherit whatever was last printed. */
      if (row.kind === 'DAY' || row.kind === 'NIGHT') carried = row.kind;
    });

    days.sort(function (x, y) { return x.day - y.day; });
    days.forEach(function (dd) { dd.label = dd.name || dayLabel(dd.day, dd.certain); });

    var uncertain = rows.filter(function (r) { return r.confidence !== CERTAIN; })
                        .map(function (r) { return r.key; });
    return {
      rows: rows, days: days, dayCount: days.length,
      uncertain: uncertain,
      certainCount: rows.length - uncertain.length,
      sceneCount: rows.length,
      overridden: rows.filter(function (r) { return r.source === 'MANUAL'; }).map(function (r) { return r.key; })
    };
  }

  /* dayOf(result, '4A') → the story day number, or 0 when the scene is not in
     the script. 0 is deliberately not 1: "I do not know" must not read as
     "day one". */
  function dayOf(result, key) {
    var want = CS.normNum(key), rows = (result && result.rows) || [], i;
    for (i = 0; i < rows.length; i++) if (CS.normNum(rows[i].key) === want) return rows[i].day;
    return 0;
  }
  function scenesOfDay(result, day) {
    return ((result && result.rows) || []).filter(function (r) { return r.day === +day; });
  }

  /* ── 4 · the store ─────────────────────────────────────────────────────
     SB_StoryDays_v1 holds ONLY what a person decided — the overrides and the
     day names. The derivation is recomputed from the script every time, so a
     rewrite never leaves stale story days behind pretending to be current. */
  function blankStore() { return { v: 1, updatedAt: '', overrides: {}, names: {} }; }
  function normStore(s) {
    var st = (s && typeof s === 'object') ? s : blankStore();
    if (!st.overrides || typeof st.overrides !== 'object') st.overrides = {};
    if (!st.names || typeof st.names !== 'object') st.names = {};
    if (!st.v) st.v = 1;
    return st;
  }
  function setOverride(store, key, value) {
    var st = normStore(store), k = CS.normNum(key);
    if (!k) return st;
    if (value == null || value === '' || upper(value) === 'AUTO') delete st.overrides[k];
    else st.overrides[k] = typeof value === 'number' ? value : upper(value);
    return st;
  }
  function nameDay(store, day, name) {
    var st = normStore(store), d = parseInt(day, 10);
    if (!isFinite(d) || d < 1) return st;
    if (!txt(name).replace(/\s+/g, '')) delete st.names[d];
    else st.names[d] = txt(name);
    return st;
  }
  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  function readDays() {
    var s = ls(); if (!s) return blankStore();
    try { return normStore(JSON.parse(s.getItem(KEY) || 'null')); } catch (e) { return blankStore(); }
  }
  function writeDays(store, when) {
    var s = ls(); if (!s) return false;
    var st = normStore(store);
    st.updatedAt = txt(when) || st.updatedAt;
    try { s.setItem(KEY, JSON.stringify(st)); return true; } catch (e) { return false; }
  }

  root.CStoryDay = {
    KEY: KEY, CERTAIN: CERTAIN, UNCERTAIN: UNCERTAIN,
    NEW_DAY_RE: NEW_DAY_RE, SAME_DAY_RE: SAME_DAY_RE,
    todKind: todKind, cueOf: cueOf, boundaryFor: boundaryFor, overrideFor: overrideFor,
    derive: derive, dayOf: dayOf, scenesOfDay: scenesOfDay, dayLabel: dayLabel,
    blankStore: blankStore, normStore: normStore,
    setOverride: setOverride, nameDay: nameDay,
    readDays: readDays, writeDays: writeDays
  };
})(typeof window !== 'undefined' ? window : globalThis);
