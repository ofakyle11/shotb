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

  /* windows planner — the release sequence by territory */
  function addWindow(store, fields) {
    var w = { id: uid(), territory: fields.territory || 'Worldwide',
      channel: fields.channel || 'SVOD', window: fields.window || '',
      start: fields.start || '', licensee: fields.licensee || '', exclusive: fields.exclusive !== false };
    store.windows.push(w);
    return w;
  }
  /* naive overlap guard: same territory + channel + exclusivity is a conflict */
  function windowConflicts(store) {
    var seen = {}, conflicts = [];
    store.windows.forEach(function (w) {
      var k = (w.territory + '|' + w.channel).toLowerCase();
      if (w.exclusive && seen[k]) conflicts.push({ a: seen[k], b: w.id, key: w.territory + ' · ' + w.channel });
      if (w.exclusive) seen[k] = w.id;
    });
    return conflicts;
  }

  /* screener registry — who has the picture, on the record */
  function addScreener(store, fields) {
    var s = { id: uid(), recipient: fields.recipient || '', company: fields.company || '',
      link: fields.link || '', sentAt: fields.sentAt || '', expires: fields.expires || '',
      watched: false, notes: '' };
    store.screeners.push(s);
    return s;
  }
  function removeRow(store, id) {
    var n = store.windows.length + store.screeners.length;
    store.windows = store.windows.filter(function (w) { return w.id !== id; });
    store.screeners = store.screeners.filter(function (s) { return s.id !== id; });
    return n !== store.windows.length + store.screeners.length;
  }

  root.CDist = {
    DELIVERABLES: DELIVERABLES, BUYER_PRESETS: BUYER_PRESETS,
    blank: blank, checklist: checklist, toggle: toggle,
    addWindow: addWindow, windowConflicts: windowConflicts,
    addScreener: addScreener, removeRow: removeRow
  };
})(typeof window !== 'undefined' ? window : globalThis);
