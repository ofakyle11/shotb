/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Distribution Room engine (CDist)
   The delivery schedule as buyers actually issue it — picture, audio,
   accessibility, marketing and legal/docs items — with per-buyer presets,
   a windows planner (territory · channel · window · dates), and a
   screener registry that records exactly who was sent what and when.
   Pure logic, no DOM.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function uid() { return 'x' + Math.random().toString(36).slice(2, 9); }

  /* the master delivery schedule */
  var DELIVERABLES = [
    { id: 'dcp',        group: 'Picture', label: 'DCP (2K, 24fps, SMPTE)' },
    { id: 'prores',     group: 'Picture', label: 'ProRes 4444/422HQ master (graded)' },
    { id: 'textless',   group: 'Picture', label: 'Textless backgrounds' },
    { id: 'screenermp4',group: 'Picture', label: 'H.264 screener with burn-in TC' },
    { id: 'pm51',       group: 'Audio', label: '5.1 printmaster' },
    { id: 'pm20',       group: 'Audio', label: '2.0 fold-down (Lt/Rt)' },
    { id: 'me',         group: 'Audio', label: 'M&E (music & effects, foley-filled)' },
    { id: 'stems',      group: 'Audio', label: 'DME stems (dialogue/music/effects)' },
    { id: 'cc',         group: 'Accessibility', label: 'Closed captions (SCC + SRT)' },
    { id: 'subs',       group: 'Accessibility', label: 'Subtitle masters / spotting list' },
    { id: 'ad',         group: 'Accessibility', label: 'Audio description track' },
    { id: 'trailer',    group: 'Marketing', label: 'Trailer (graded, mixed)' },
    { id: 'keyart',     group: 'Marketing', label: 'Key art (layered + flattened)' },
    { id: 'stills',     group: 'Marketing', label: 'Unit stills (min 25, captioned)' },
    { id: 'epk',        group: 'Marketing', label: 'EPK / press kit' },
    { id: 'chain',      group: 'Legal & docs', label: 'Chain of title package' },
    { id: 'eo',         group: 'Legal & docs', label: 'E&O insurance certificate' },
    { id: 'cuesheet',   group: 'Legal & docs', label: 'Music cue sheet' },
    { id: 'licenses',   group: 'Legal & docs', label: 'Music/materials licenses' },
    { id: 'credits',    group: 'Legal & docs', label: 'Final credits + paid-ad obligations' },
    { id: 'qc',         group: 'Legal & docs', label: 'QC report (picture + audio)' },
    { id: 'metadata',   group: 'Legal & docs', label: 'Metadata package (synopsis, ratings, ISAN)' },
    { id: 'lto',        group: 'Legal & docs', label: 'Archive master (LTO / verified backup)' }
  ];
  var BY_ID = {};
  DELIVERABLES.forEach(function (d) { BY_ID[d.id] = d; });

  /* what each buyer class actually demands */
  var BUYER_PRESETS = {
    festival:   { label: 'Festival premiere', need: ['dcp', 'screenermp4', 'stills', 'trailer', 'cc'] },
    theatrical: { label: 'Theatrical', need: ['dcp', 'prores', 'pm51', 'pm20', 'cc', 'trailer', 'keyart', 'stills', 'chain', 'eo', 'cuesheet', 'credits', 'qc'] },
    streamer:   { label: 'Streamer', need: DELIVERABLES.map(function (d) { return d.id; }) },
    aggregator: { label: 'Aggregator / TVOD', need: ['prores', 'pm20', 'cc', 'keyart', 'metadata', 'chain', 'eo', 'cuesheet', 'qc'] },
    broadcast:  { label: 'Broadcast TV', need: ['prores', 'textless', 'pm51', 'me', 'cc', 'metadata', 'chain', 'eo', 'cuesheet', 'credits', 'qc'] }
  };

  function blank() {
    return { v: 1, done: {}, buyer: 'streamer', windows: [], screeners: [] };
  }

  /* checklist for the chosen buyer, with completion state applied */
  function checklist(store) {
    var preset = BUYER_PRESETS[store.buyer] || BUYER_PRESETS.streamer;
    var need = {};
    preset.need.forEach(function (id) { need[id] = 1; });
    var groups = {};
    DELIVERABLES.forEach(function (d) {
      if (!groups[d.group]) groups[d.group] = [];
      groups[d.group].push({ id: d.id, label: d.label, required: !!need[d.id], done: !!store.done[d.id] });
    });
    var required = preset.need.length;
    var complete = preset.need.filter(function (id) { return store.done[id]; }).length;
    return { buyer: preset.label, groups: groups, required: required, complete: complete,
             pct: required ? Math.round(complete / required * 100) : 0 };
  }
  function toggle(store, id) {
    if (!BY_ID[id]) return false;
    store.done[id] = !store.done[id];
    return store.done[id];
  }

  /* ── the rights space: territory × media × term ────────────────────────
     The old guard keyed on the raw strings and ignored dates, so it was
     wrong in BOTH directions: "Worldwide/SVOD" and "Germany/SVOD" did not
     collide (different strings), "United States" and "USA" did not collide
     (different spellings), and two Canada/SVOD grants eight years apart DID
     collide (same string, dates never consulted). An exclusivity clash is an
     overlap in all three dimensions at once. */
  var TERRITORY_ALIASES = {
    'worldwide': 'WORLD', 'world': 'WORLD', 'global': 'WORLD', 'all territories': 'WORLD',
    'row': 'ROW', 'rest of world': 'ROW',
    'united states': 'US', 'united states of america': 'US', 'usa': 'US', 'u.s.': 'US',
    'u.s.a.': 'US', 'us': 'US', 'america': 'US', 'domestic': 'US',
    'canada': 'CA', 'mexico': 'MX', 'united kingdom': 'GB', 'uk': 'GB', 'u.k.': 'GB',
    'great britain': 'GB', 'britain': 'GB', 'ireland': 'IE', 'germany': 'DE', 'austria': 'AT',
    'switzerland': 'CH', 'france': 'FR', 'spain': 'ES', 'italy': 'IT', 'portugal': 'PT',
    'netherlands': 'NL', 'belgium': 'BE', 'luxembourg': 'LU', 'sweden': 'SE', 'norway': 'NO',
    'denmark': 'DK', 'finland': 'FI', 'iceland': 'IS', 'poland': 'PL', 'australia': 'AU',
    'new zealand': 'NZ', 'japan': 'JP', 'south korea': 'KR', 'korea': 'KR', 'china': 'CN',
    'india': 'IN', 'brazil': 'BR', 'argentina': 'AR', 'south africa': 'ZA'
  };
  /* A region is the set of codes it grants. Anything not listed is compared
     as its own normalised name — an unknown territory is never assumed to
     overlap something else, but it is never assumed safe against WORLD. */
  var TERRITORY_GROUPS = {
    'NORTH AMERICA': ['US', 'CA', 'MX'], 'NA': ['US', 'CA', 'MX'],
    'LATIN AMERICA': ['MX', 'BR', 'AR'], 'LATAM': ['MX', 'BR', 'AR'],
    'EUROPE': ['GB', 'IE', 'DE', 'AT', 'CH', 'FR', 'ES', 'IT', 'PT', 'NL', 'BE', 'LU',
               'SE', 'NO', 'DK', 'FI', 'IS', 'PL'],
    'DACH': ['DE', 'AT', 'CH'],
    'BENELUX': ['BE', 'NL', 'LU'],
    'UK & IRELAND': ['GB', 'IE'], 'UK AND IRELAND': ['GB', 'IE'],
    'SCANDINAVIA': ['SE', 'NO', 'DK'], 'NORDICS': ['SE', 'NO', 'DK', 'FI', 'IS'],
    'ANZ': ['AU', 'NZ'], 'AUSTRALIA/NZ': ['AU', 'NZ'],
    'ASIA': ['JP', 'KR', 'CN', 'IN']
  };
  function normTerritory(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return '';
    if (TERRITORY_ALIASES[s]) return TERRITORY_ALIASES[s];
    return s.toUpperCase();
  }
  /* territoryOverlap(a, b) — do these two grants touch the same ground? */
  function territoryOverlap(a, b) {
    var x = normTerritory(a), y = normTerritory(b);
    if (!x || !y) return true;                    // an unnamed territory could be anywhere
    if (x === y) return true;
    if (x === 'WORLD' || y === 'WORLD') return true;
    if (x === 'ROW' || y === 'ROW') return true;  // rest-of-world is defined by what is left
    var sx = TERRITORY_GROUPS[x] || [x], sy = TERRITORY_GROUPS[y] || [y];
    return sx.some(function (c) { return sy.indexOf(c) >= 0; });
  }

  var CHANNEL_GROUPS = {
    'ALL MEDIA': null, 'ALL RIGHTS': null, 'ALL': null,
    'DIGITAL': ['SVOD', 'TVOD', 'AVOD', 'EST'],
    'VOD': ['SVOD', 'TVOD', 'AVOD'],
    'PAY TV': ['PAY TV'], 'FREE TV': ['BROADCAST', 'FREE TV']
  };
  function normChannel(v) {
    var s = String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ' ');
    if (s === 'TV' || s === 'TELEVISION') return 'BROADCAST';
    if (s === 'THEATRIC' || s === 'THEATRICAL RELEASE') return 'THEATRICAL';
    return s;
  }
  function channelOverlap(a, b) {
    var x = normChannel(a), y = normChannel(b);
    if (!x || !y) return true;
    if (x === y) return true;
    if (x in CHANNEL_GROUPS && CHANNEL_GROUPS[x] === null) return true;   // all media
    if (y in CHANNEL_GROUPS && CHANNEL_GROUPS[y] === null) return true;
    var sx = CHANNEL_GROUPS[x] || [x], sy = CHANNEL_GROUPS[y] || [y];
    return sx.some(function (c) { return sy.indexOf(c) >= 0; });
  }

  /* parseTerm('90 days'|'18 months'|'2 years'|'in perpetuity') → days, or
     null when nothing is stated. Perpetuity is Infinity, not a big number. */
  function parseTerm(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) return null;
    if (/perpetu|life of copyright|forever/.test(s)) return Infinity;
    var m = /(\d+(?:\.\d+)?)\s*(day|week|month|year)/.exec(s);
    if (!m) return null;
    var n = parseFloat(m[1]);
    return m[2] === 'day' ? n : m[2] === 'week' ? n * 7 : m[2] === 'month' ? n * 30.44 : n * 365.25;
  }
  function dayNum(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;
    var t = Date.parse(iso + 'T00:00:00Z');
    return isFinite(t) ? t / 86400000 : null;
  }
  /* windowRange(w) → {start, end, dated} in whole days. `dated` is false when
     the grant does not say when it ends — which is a fact worth reporting,
     not a licence to guess. */
  function windowRange(w) {
    var start = dayNum(w && w.start);
    var end = dayNum(w && w.end);
    if (end == null) {
      var term = parseTerm(w && w.window);
      if (term != null && start != null) end = term === Infinity ? Infinity : start + term;
      else if (term === Infinity) end = Infinity;
    }
    return { start: start, end: end, dated: start != null && end != null };
  }
  function termsOverlap(a, b) {
    var aStart = a.start == null ? -Infinity : a.start;
    var aEnd = a.end == null ? Infinity : a.end;
    var bStart = b.start == null ? -Infinity : b.start;
    var bEnd = b.end == null ? Infinity : b.end;
    return aStart <= bEnd && bStart <= aEnd;
  }

  /* windows planner — the release sequence by territory */
  function addWindow(store, fields) {
    var w = { id: uid(), territory: fields.territory || 'Worldwide',
      channel: fields.channel || 'SVOD', window: fields.window || '',
      start: fields.start || '', end: fields.end || '',
      licensee: fields.licensee || '', exclusive: fields.exclusive !== false };
    store.windows.push(w);
    return w;
  }
  /* windowConflicts(store) → [{a, b, key, kind, detail}]
       kind 'overlap' — both grants are dated and the terms intersect.
       kind 'undated' — the rights space collides and at least one grant has
                        no term on record, so the answer is unknowable until
                        somebody writes the dates down. Reported, not guessed. */
  function windowConflicts(store) {
    var ws = ((store && store.windows) || []).filter(function (w) { return w.exclusive; });
    var out = [];
    for (var i = 0; i < ws.length; i++) {
      for (var j = i + 1; j < ws.length; j++) {
        var a = ws[i], b = ws[j];
        if (!territoryOverlap(a.territory, b.territory)) continue;
        if (!channelOverlap(a.channel, b.channel)) continue;
        var ra = windowRange(a), rb = windowRange(b);
        var key = a.territory + ' · ' + a.channel + '  ×  ' + b.territory + ' · ' + b.channel;
        if (!ra.dated || !rb.dated) {
          if (!termsOverlap(ra, rb)) continue;
          out.push({ a: a.id, b: b.id, key: key, kind: 'undated',
            detail: 'Same territory and channel, and no term on record for ' +
              (!ra.dated && !rb.dated ? 'either grant' : 'one of them') +
              ' — record the end date (or "90 days" in the window field) to know whether these collide.' });
          continue;
        }
        if (!termsOverlap(ra, rb)) continue;
        out.push({ a: a.id, b: b.id, key: key, kind: 'overlap',
          detail: 'Two exclusive grants over the same rights at the same time.' });
      }
    }
    return out;
  }

  /* ── the rights gate ───────────────────────────────────────────────────
     Nothing used to gate what left the building. The screener registry
     recorded the RECIPIENT and never the CONTENT, so a cut carrying an
     unlicensed needle-drop went out with no record of what was in it — and
     the platform already held every fact needed to stop it: the cue list and
     its licence status in SB_Music_v1, the script findings in SB_ClearScan_v1.
     This is the join, not a new capability.

     rightsGate(music, clearance, opts) → {ok, level, blockers, cautions, ...}
       music      SB_Music_v1 store {cues:[…]} (a bare array is accepted too)
       clearance  SB_ClearScan_v1 findings array, or {findings:[…]}
       opts.scope 'festival' (a festival screener) | 'all-media' (delivery)
       opts.checkedAt  the caller's date — this module never asks the clock. */
  var SCOPES = ['festival', 'all-media'];

  function cuesOf(music) {
    var list = (music && music.cues) || (music && music.length ? music : []) || [];
    return list.filter(function (c) { return c && c.status !== 'replaced'; });
  }
  function findingsOf(clearance) {
    return (clearance && clearance.findings) || (clearance && clearance.length ? clearance : []) || [];
  }

  function rightsGate(music, clearance, opts) {
    var o = opts || {};
    var scope = SCOPES.indexOf(o.scope) >= 0 ? o.scope : 'all-media';
    var blockers = [], cautions = [];
    var cues = cuesOf(music);
    var findings = findingsOf(clearance);

    cues.forEach(function (c) {
      var name = c.title || 'untitled cue';
      if (c.status !== 'licensed') {
        blockers.push({ kind: 'music', ref: c.id || name, label: name + ' — ' + (c.status || 'no status'),
          detail: 'No sync/master licence on record. A screener carrying this cue is an unlicensed public exhibition.' });
      } else if (c.scope === 'festival' && scope === 'all-media') {
        blockers.push({ kind: 'music-scope', ref: c.id || name, label: name + ' — festival-only licence',
          detail: 'Licensed for festival exhibition only. Exercise the step-up before this cut goes to a buyer.' });
      } else if (c.scope === 'festival') {
        cautions.push({ kind: 'music-scope', ref: c.id || name, label: name + ' — festival scope',
          detail: 'Covered for this screener; not for distribution.' });
      }
    });

    findings.forEach(function (f) {
      if (f.status === 'cleared' || f.status === 'rewritten') return;
      var where = 'SC ' + (f.sceneLabel || f.scene || '?') + ' ' + (f.cat || '') + ' — ' + (f.term || '');
      if (f.risk === 'high' && f.status !== 'accepted risk') {
        blockers.push({ kind: 'clearance', ref: f.id || where, label: where,
          detail: f.action || 'High-risk clearance finding, still open.' });
      } else {
        cautions.push({ kind: 'clearance', ref: f.id || where, label: where + ' (' + (f.status || 'open') + ')',
          detail: f.action || 'Open clearance finding.' });
      }
    });

    var level = blockers.length ? 'blocked' : cautions.length ? 'caution' : 'clear';
    return {
      ok: blockers.length === 0, level: level, scope: scope,
      blockers: blockers, cautions: cautions,
      cues: cues.length, licensed: cues.filter(function (c) { return c.status === 'licensed'; }).length,
      checkedAt: o.checkedAt || '',
      summary: blockers.length
        ? blockers.length + ' rights blocker' + (blockers.length === 1 ? '' : 's') + ' — this cut is not cleared to leave'
        : cues.length + ' cue' + (cues.length === 1 ? '' : 's') + ' licensed, no open high-risk findings' +
          (cautions.length ? ' · ' + cautions.length + ' caution' + (cautions.length === 1 ? '' : 's') : '')
    };
  }

  /* screener registry — who has the picture, WHICH CUT, and what was in it */
  function addScreener(store, fields) {
    var f = fields || {};
    var s = { id: uid(), recipient: f.recipient || '', company: f.company || '',
      link: f.link || '', sentAt: f.sentAt || '', expires: f.expires || '',
      cutId: f.cutId || '', cutLabel: f.cutLabel || '', scope: SCOPES.indexOf(f.scope) >= 0 ? f.scope : 'all-media',
      rights: f.rights || null, overrideReason: f.overrideReason || '',
      watched: false, notes: f.notes || '' };
    store.screeners.push(s);
    return s;
  }

  /* sendScreener(store, fields, gate) — the door. A blocked gate refuses the
     send; an owner who sends anyway must say why, and the reason and the
     blockers are recorded ON the screener, so "who had the picture, and what
     was wrong with it at the time" is answerable a year later. */
  function sendScreener(store, fields, gate) {
    var f = fields || {};
    if (gate && !gate.ok && !f.overrideReason) {
      return { ok: false, refused: true, gate: gate, screener: null };
    }
    var s = addScreener(store, {
      recipient: f.recipient, company: f.company, link: f.link, sentAt: f.sentAt,
      expires: f.expires, cutId: f.cutId, cutLabel: f.cutLabel, notes: f.notes,
      scope: (gate && gate.scope) || f.scope, overrideReason: f.overrideReason,
      rights: gate ? { level: gate.level, ok: gate.ok, checkedAt: gate.checkedAt,
                       summary: gate.summary,
                       blockers: gate.blockers.map(function (b) { return b.label; }),
                       cautions: gate.cautions.map(function (b) { return b.label; }) } : null
    });
    return { ok: true, refused: false, gate: gate || null, screener: s,
             overridden: !!(gate && !gate.ok && f.overrideReason) };
  }
  function removeRow(store, id) {
    var n = store.windows.length + store.screeners.length;
    store.windows = store.windows.filter(function (w) { return w.id !== id; });
    store.screeners = store.screeners.filter(function (s) { return s.id !== id; });
    return n !== store.windows.length + store.screeners.length;
  }

  root.CDist = {
    DELIVERABLES: DELIVERABLES, BUYER_PRESETS: BUYER_PRESETS, SCOPES: SCOPES,
    TERRITORY_ALIASES: TERRITORY_ALIASES, TERRITORY_GROUPS: TERRITORY_GROUPS,
    CHANNEL_GROUPS: CHANNEL_GROUPS,
    blank: blank, checklist: checklist, toggle: toggle,
    normTerritory: normTerritory, territoryOverlap: territoryOverlap,
    normChannel: normChannel, channelOverlap: channelOverlap,
    parseTerm: parseTerm, windowRange: windowRange, termsOverlap: termsOverlap,
    addWindow: addWindow, windowConflicts: windowConflicts,
    rightsGate: rightsGate, addScreener: addScreener, sendScreener: sendScreener,
    removeRow: removeRow
  };
})(typeof window !== 'undefined' ? window : globalThis);
