/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Casting Office engine (CCastDesk)
   Pure logic, no DOM: speaking-role extraction from the screenplay (ALL-CAPS
   dialogue cues), a candidate pipeline (submitted → callback → test → offer →
   hold → booked / released), hold-date conflict detection across roles,
   audition-sides assembly, and a plain-language offer memo. Dates, rates and
   contacts are never invented here — everything comes from the script or the
   user's own entries. All state is passed in; storage lives in the page.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  /* The one scene model — js/lib-scenes.js. Every module used to carry its
     own screenplay splitter; they disagreed on preambles, printed scene
     numbers and A/B scenes, so they now all read from here. Loaded by a
     <script> tag before this file, and by the node suites. */
  var CS = root.CScenes;
  if (!CS) throw new Error('lib-castdesk.js requires js/lib-scenes.js to be loaded first');


  var STATUSES = ['submitted', 'callback', 'test', 'offer', 'hold', 'booked', 'released'];

  function uid() { return 'c' + Math.random().toString(36).slice(2, 9); }

  /* ── 1 · scenes ─────────────────────────────────────────────────────── */
  var splitScenes = CS.split;

  /* ── 2 · dialogue cues → roles ──────────────────────────────────────────
     A character cue is a short ALL-CAPS line (2–30 chars), not a slugline,
     not a transition/format keyword, optionally suffixed (V.O.)/(O.S.)/
     (CONT'D), and followed by an actual line of dialogue.                  */

  /* Delegated to CScenes, which both this file and wardrobe/lib-ward.js
     carried a byte-identical copy of. A third consumer needed the same test
     and used a substring match instead — see the note above CScenes.cueName
     for what that cost. One implementation, one place. */
  function cueName(line) { return CS.cueName(line); }

  /* charactersFromScript(scriptText) → [{name, scenes, lines, sceneList}]
     sorted by lines (dialogue cues) descending, then name.                 */
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
        if (!found[name]) found[name] = { name: name, lines: 0, sceneSet: {} };
        found[name].lines++;
        found[name].sceneSet[sc.n] = true;
      }
    });
    return Object.keys(found).map(function (k) {
      var f = found[k];
      var list = Object.keys(f.sceneSet).map(function (n) { return +n; })
        .sort(function (a, b) { return a - b; });
      return { name: f.name, scenes: list.length, lines: f.lines, sceneList: list };
    }).sort(function (a, b) {
      return b.lines - a.lines || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
  }

  /* ── 3 · hold conflicts ─────────────────────────────────────────────────
     Same person (name match, case-insensitive) on hold/booked with
     overlapping date ranges — across any roles. ISO dates compare as text. */
  function rangesOverlap(aFrom, aTo, bFrom, bTo) {
    return String(aFrom) <= String(bTo) && String(bFrom) <= String(aTo);
  }
  function holdConflicts(candidates) {
    var held = (candidates || []).filter(function (c) {
      return c && (c.status === 'hold' || c.status === 'booked') &&
             c.holdFrom && c.holdTo && String(c.name || '').replace(/\s+/g, '');
    });
    var out = [], i, j, a, b;
    for (i = 0; i < held.length; i++) {
      for (j = i + 1; j < held.length; j++) {
        a = held[i]; b = held[j];
        if (String(a.name).trim().toLowerCase() !== String(b.name).trim().toLowerCase()) continue;
        if (!rangesOverlap(a.holdFrom, a.holdTo, b.holdFrom, b.holdTo)) continue;
        out.push({
          name: String(a.name).trim(),
          a: { role: a.role || '', status: a.status, from: a.holdFrom, to: a.holdTo },
          b: { role: b.role || '', status: b.status, from: b.holdFrom, to: b.holdTo }
        });
      }
    }
    return out;
  }

  /* ── 4 · audition sides ─────────────────────────────────────────────────
     Every scene where the character speaks — slugline + full body, joined
     with scene numbers. Returns '' when the character never speaks.        */
  function sidesFor(scriptText, character) {
    var want = String(character || '').trim().toUpperCase();
    if (!want) return '';
    var scenes = splitScenes(scriptText);
    var parts = [];
    scenes.forEach(function (sc) {
      var speaks = false, i, n;
      for (i = 0; i < sc.body.length; i++) {
        n = cueName(sc.body[i]);
        if (n && n.toUpperCase() === want) { speaks = true; break; }
      }
      if (!speaks) return;
      var body = sc.body.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
      parts.push('── SCENE ' + sc.label + ' ─────────────────────────────\n' +
        (sc.slug || '(no slugline)') + '\n\n' + body);
    });
    if (!parts.length) return '';
    return 'AUDITION SIDES — ' + want + '\n' +
      parts.length + ' scene' + (parts.length === 1 ? '' : 's') +
      ' in which the character speaks. Trim for the room as needed,\n' +
      'and verify against the current draft before sending.\n\n' +
      parts.join('\n\n');
  }

  /* ── 5 · offer memo ─────────────────────────────────────────────────────
     Business points only, in plain language, with the counsel-reviews note.
     Missing fields print as TBD — never invented.                          */
  function offerLetter(fields) {
    var o = fields || {};
    function or(v, alt) { var s = String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); return s || alt; }
    var unit = or(o.rateUnit, 'weekly') === 'daily' ? 'day' : 'week';
    return 'OFFER MEMO — ' + or(o.production, 'Untitled production') + '\n' +
      'Date: ' + or(o.date, 'TBD') + '\n\n' +
      'To: ' + or(o.actor, '(performer)') + (or(o.rep, '') ? ', c/o ' + or(o.rep, '') : '') + '\n' +
      'Role: ' + or(o.role, '(role)') + '\n\n' +
      'We are pleased to offer you the role of ' + or(o.role, '(role)') +
      ' in ' + or(o.production, 'our production') + '.\n\n' +
      'Engagement:    ' + or(o.startDate, 'TBD') + ' through ' + or(o.endDate, 'TBD') +
      ', plus customary fittings, rehearsals and looping\n' +
      'Compensation:  ' + or(o.rate, 'TBD') + ' per ' + unit +
      ', subject to any applicable union scale minimums\n' +
      'Billing:       ' + or(o.billing, 'TBD') + '\n\n' +
      'This memo states the business points only and is not a binding agreement.\n' +
      'Engagement is conditional on a long-form agreement prepared and reviewed by\n' +
      'production counsel, and on any required union clearances and work permits.\n' +
      'Please have your representatives confirm availability for the dates above.\n\n' +
      or(o.contact, '') + '\n' + or(o.company, 'CINAMATE production office');
  }

  /* ── 6 · pipeline strip ─────────────────────────────────────────────────
     boardSummary(roles) → per-status candidate counts across the board,
     plus totals: candidates, roles, rolesCast (roles with a booking).      */
  function boardSummary(roles) {
    var counts = {};
    STATUSES.forEach(function (s) { counts[s] = 0; });
    var total = 0, cast = 0;
    (roles || []).forEach(function (r) {
      var booked = false;
      ((r && r.candidates) || []).forEach(function (c) {
        if (c && counts[c.status] != null) counts[c.status]++;
        total++;
        if (c && c.status === 'booked') booked = true;
      });
      if (booked) cast++;
    });
    counts.candidates = total;
    counts.roles = (roles || []).length;
    counts.rolesCast = cast;
    return counts;
  }

  root.CCastDesk = {
    STATUSES: STATUSES, uid: uid,
    splitScenes: splitScenes, cueName: cueName,
    charactersFromScript: charactersFromScript,
    rangesOverlap: rangesOverlap, holdConflicts: holdConflicts,
    sidesFor: sidesFor, offerLetter: offerLetter, boardSummary: boardSummary
  };
})(typeof window !== 'undefined' ? window : globalThis);
