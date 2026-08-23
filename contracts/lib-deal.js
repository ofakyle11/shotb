/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Deal Memos engine (CDeal)
   Crew deal memos and cast agreements in the standard field set the
   industry signs every day — generated from the crew register and cast
   data the platform already holds, with SAG-AFTRA scale figures where
   they apply. A signed deal becomes a commitment in the Money Room, so
   the cost report sees payroll obligations the moment ink lands.
   Plain-language templates for speed — counsel reviews before signature.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var SAG_SCALE = { day: 1204, week: 4181 };            // theatrical basic, kept current in one place
  var DEPT_ACCT = { cast: '2000', camera: '3000', 'g&e': '3000', grip: '3000', electric: '3000',
    art: '3000', sound: '3000', wardrobe: '3000', hmu: '3000', production: '3000',
    stunts: '3000', locations: '3000', edit: '5000', post: '5000', music: '5000' };

  function uid() { return 'd' + Math.random().toString(36).slice(2, 9); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function blank() { return { v: 1, deals: [] }; }

  function fromCrewRow(row, production) {
    return { kind: 'crew', production: production || '', name: (row && row.name) || '',
      role: (row && row.role) || '', union: (row && row.union) || '',
      rateBasis: 'day', rate: num(row && row.rate), guaranteed: 5,
      otTerms: '1.5x after 12 hours on set', kitFee: 0, perDiem: 0, startDate: '' };
  }
  function castDefaults(production, role) {
    return { kind: 'cast', production: production || '', name: '', role: role || '',
      union: 'SAG-AFTRA', rateBasis: 'day', rate: SAG_SCALE.day, guaranteed: 3,
      otTerms: 'per applicable SAG-AFTRA schedule', kitFee: 0, perDiem: 60,
      credit: 'Main titles, single card, position by mutual agreement', startDate: '' };
  }

  function addDeal(store, fields) {
    var d = { id: uid(), status: 'draft', committedPo: null, fields: fields || {} };
    store.deals.push(d);
    return d;
  }
  function setStatus(store, id, status) {
    var d = store.deals.filter(function (x) { return x.id === id; })[0];
    if (!d || ['draft', 'sent', 'signed'].indexOf(status) < 0) return null;
    d.status = status;
    return d;
  }
  function removeDeal(store, id) {
    var n = store.deals.length;
    store.deals = store.deals.filter(function (x) { return x.id !== id; });
    return n !== store.deals.length;
  }

  /* total obligation a signed deal creates */
  function dealValue(f) {
    var base = num(f.rate) * Math.max(1, num(f.guaranteed) || 1);
    return Math.round(base + num(f.kitFee) + num(f.perDiem) * Math.max(1, num(f.guaranteed) || 1));
  }
  /* signed deal → Money Room commitment (an open PO on the right account) */
  function toCommitment(deal) {
    var f = deal.fields || {};
    var dept = String(f.role || '').toLowerCase();
    var acct = f.kind === 'cast' ? '2000' : '3000';
    Object.keys(DEPT_ACCT).forEach(function (k) { if (dept.indexOf(k) >= 0) acct = DEPT_ACCT[k]; });
    return { vendor: f.name || '(unnamed)', desc: (f.kind === 'cast' ? 'Cast agreement — ' : 'Deal memo — ') + (f.role || ''),
             acct: acct, amount: dealValue(f), notes: 'auto from signed deal ' + deal.id };
  }

  /* ── documents ───────────────────────────────────────────────────── */
  function money(n) { return '$' + Math.round(num(n)).toLocaleString(); }
  function memoText(f) {
    var lines = [
      (f.kind === 'cast' ? 'CAST AGREEMENT (short form)' : 'CREW DEAL MEMO'),
      'Production: ' + (f.production || ''),
      '',
      'Name: ' + (f.name || '') + '            Role: ' + (f.role || ''),
      'Union/Guild: ' + (f.union || 'non-union'),
      'Rate: ' + money(f.rate) + ' per ' + (f.rateBasis || 'day') +
        (f.union === 'SAG-AFTRA' && num(f.rate) <= SAG_SCALE[f.rateBasis || 'day'] ? '  (scale)' : ''),
      'Guaranteed: ' + (f.guaranteed || 1) + ' ' + (f.rateBasis || 'day') + '(s)' +
        '   Start date: ' + (f.startDate || 'TBD'),
      'Overtime: ' + (f.otTerms || 'per applicable agreement'),
      (num(f.kitFee) ? 'Kit/box rental: ' + money(f.kitFee) + ' flat' : null),
      (num(f.perDiem) ? 'Per diem: ' + money(f.perDiem) + ' per working day' : null),
      (f.kind === 'cast' ? 'Credit: ' + (f.credit || 'by mutual agreement') : null),
      '',
      'Engagement is subject to the production\'s standard terms, including safety',
      'compliance, confidentiality, and work-made-for-hire assignment of results',
      'and proceeds to the production. This memo binds both parties on signature;',
      'a long-form agreement, if issued, supersedes it.',
      '',
      'For the production: ______________________   Date: ____________',
      (f.kind === 'cast' ? 'Performer' : 'Crew member') + ': ______________________   Date: ____________'
    ];
    return lines.filter(function (l) { return l !== null; }).join('\n');
  }
  function ndaText(f) {
    return 'NON-DISCLOSURE AGREEMENT\nProduction: ' + (f.production || '') + '\n\n' +
      (f.name || '____________________') + ' agrees to keep confidential all non-public ' +
      'information about the production — including script, story, casting, schedule, ' +
      'imagery and business terms — and to post no material from set without written ' +
      'approval. This obligation survives the engagement.\n\n' +
      'Signature: ______________________   Date: ____________\n';
  }

  root.CDeal = {
    SAG_SCALE: SAG_SCALE, blank: blank,
    fromCrewRow: fromCrewRow, castDefaults: castDefaults,
    addDeal: addDeal, setStatus: setStatus, removeDeal: removeDeal,
    dealValue: dealValue, toCommitment: toCommitment,
    memoText: memoText, ndaText: ndaText
  };
})(typeof window !== 'undefined' ? window : globalThis);
