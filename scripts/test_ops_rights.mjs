#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   The rights path, tested against the inputs it actually fails on.

   Every case in this file is a state a real project is in — and each one was
   reported CLEAR or E&O READY by code whose own comments said it had fixed
   exactly that. The pattern in all of them is the same: a rule computed from
   the one field somebody remembered (`pending`, a truthy store, a non-empty
   string) instead of from the question being asked.

   The standing rule this suite exists to enforce: fixtures use the input class
   where the bug lives. So the findings here are all "accepted risk", the
   stores are ABSENT in some cases and PRESENT-AND-EMPTY in others, the E&O
   row has no carrier and no expiry, and the override reason is whitespace.

   run: node scripts/test_ops_rights.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
for (const f of ['js/lib-scenes.js', 'clearance/lib-clear.js', 'distribution/lib-dist.js']) {
  (0, eval)(readFileSync(join(ROOT, f), 'utf8'));
}
const { CClear: C, CDist: X } = globalThis;

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.error('  ✗', n); } };
const ids = (s) => s.blockers.map((b) => b.id);
const labels = (s) => s.blockers.map((b) => b.label).join(' | ');

const TODAY = '2026-08-23';
/* A complete file, for contrast: this is the ONLY shape that may read ready. */
const FULL = {
  rights: [{ material: 'Night Harvest (novel)', kind: 'Option', party: 'A. Sayer', status: 'Executed' }],
  music: { cues: [{ title: 'Main Title', status: 'licensed', scope: 'all-media' }] },
  insurance: [{ kind: 'E&O', carrier: 'Chubb', policy: 'EO-2291', expiry: '2027-06-30' }],
  scannedAt: TODAY, todayISO: TODAY
};
const CLEARED = [{ id: 'f1', cat: 'brand', term: 'Coca-Cola', risk: 'medium', status: 'cleared', scene: 1 },
                 { id: 'f2', cat: 'music', term: 'sings', risk: 'high', status: 'rewritten', scene: 2 }];
t('baseline: a complete file with every finding resolved IS ready',
  C.summary(CLEARED, FULL).eoReady === true && C.summary(CLEARED, FULL).checked === true);

/* ══ 1 · "accepted risk" is a decision to CARRY a finding ══════════════════
   Flip every finding to "accepted risk": open=2, resolved=0, and the banner
   went green over the words "every script finding cleared or rewritten". */
const ALL_CARRIED = CLEARED.map((f) => Object.assign({}, f, { status: 'accepted risk' }));
const carried = C.summary(ALL_CARRIED, FULL);
t('accepted risk: nothing is resolved', carried.open === 2 && carried.resolved === 0 &&
  carried.acceptedRisk === 2);
t('accepted risk: NOT E&O ready', carried.eoReady === false);
t('accepted risk: the blocker names it as carried, not cleared',
  ids(carried).includes('accepted-risk') && /Carried, not cleared/.test(
    carried.blockers.filter((b) => b.id === 'accepted-risk')[0].detail));
t('accepted risk: still disclosed to the underwriter',
  carried.disclosures.some((d) => d.id === 'accepted-risk'));
t('accepted risk: one carried finding among cleared ones is enough to block',
  C.summary([CLEARED[0], ALL_CARRIED[1]], FULL).eoReady === false);
t('accepted risk: a status nobody defined is a blocker too, not silence', (() => {
  const s = C.summary([{ id: 'f3', cat: 'brand', term: 'x', risk: 'low', status: 'maybe later' }], FULL);
  return !s.eoReady && ids(s).includes('findings-open');
})());

/* ══ 2 · the emptiness case, verbatim ══════════════════════════════════════
   Zero findings because nobody ever scanned, one executed rights row, one E&O
   row with no carrier / no policy number / no expiry (a blank expiry read as
   "live"), and no music store at all. That combination reported eoReady:true
   under the banner "every cue licensed, policy live". */
const EMPTY_FILE = {
  rights: [{ material: 'Screenplay', kind: 'Writer agreement', party: 'K. Francis', status: 'Executed' }],
  music: null,                       // never opened /music/
  insurance: [{ kind: 'E&O' }],      // a note to self, not a policy
  scannedAt: '',                     // never scanned
  todayISO: TODAY
};
const hollow = C.summary([], EMPTY_FILE);
t('emptiness: NOT E&O ready', hollow.eoReady === false);
t('emptiness: the scan that never ran is named',
  ids(hollow).includes('scan') && /never scanned/i.test(labels(hollow)));
t('emptiness: the music store nobody opened is named',
  ids(hollow).includes('music') && /never checked|not checked/i.test(labels(hollow)));
t('emptiness: the blank policy row is named, and says which fields are missing', (() => {
  const b = hollow.blockers.filter((x) => x.id === 'eo-policy-detail')[0];
  return !!b && /carrier/.test(b.detail) && /policy number/.test(b.detail) && /expiry/.test(b.detail);
})());
t('emptiness: every one of those is flagged UNKNOWN, not merely open',
  hollow.unknown === 3 && hollow.blockers.filter((b) => b.unknown).length === 3);
t('emptiness: checked is false — nothing was actually read', hollow.checked === false);
t('emptiness: a blank expiry is not a policy that never expires',
  C.summary([], Object.assign({}, FULL, { insurance: [{ kind: 'E&O', carrier: 'Chubb', policy: 'EO-1' }] })).eoReady === false);
t('emptiness: zero findings AFTER a scan is a clean read, not unknown', (() => {
  const s = C.summary([], Object.assign({}, FULL, { scannedAt: TODAY }));
  return s.eoReady === true && s.unknown === 0;
})());
t('emptiness: the scan date can arrive on the store itself', (() => {
  const s = C.summary({ findings: [], scannedAt: TODAY }, Object.assign({}, FULL, { scannedAt: '' }));
  return s.eoReady === true && s.scannedAt === TODAY;
})());

/* ── "checked and empty" vs "never checked" ──
   clearance/index.html used to substitute [] and {cues:[]} for every missing
   store, so summary reported checked:true having read nothing at all. */
t('substitution: [] for a missing rights register does not read as checked', (() => {
  const s = C.summary(CLEARED, Object.assign({}, FULL, { rights: [] }));
  return !s.eoReady && ids(s).includes('chain');
})());
t('substitution: {cues:[]} for a missing music store blocks as unknown', (() => {
  const s = C.summary(CLEARED, Object.assign({}, FULL, { music: { cues: [] } }));
  return !s.eoReady && s.blockers.some((b) => b.id === 'music' && b.unknown && /empty|No cues/i.test(b.label));
})());
t('substitution: a picture with no third-party music can say so and be ready', (() => {
  const s = C.summary(CLEARED, Object.assign({}, FULL, { music: { cues: [], noMusic: true } }));
  return s.eoReady === true;
})());
t('substitution: a store worked on but holding only a replaced cue is not empty', (() => {
  const s = C.summary(CLEARED, Object.assign({}, FULL, { music: { cues: [{ title: 'Cut Cue', status: 'replaced' }] } }));
  return s.eoReady === true;
})());
t('summary: an OBJECT under SB_Rights_v1 reports unknown instead of throwing', (() => {
  let threw = false, s = null;
  try { s = C.summary(CLEARED, Object.assign({}, FULL, { rights: { r1: { kind: 'Option', status: 'Executed' } } })); }
  catch (e) { threw = true; }
  return !threw && !s.eoReady && s.blockers.some((b) => b.id === 'chain' && b.unknown);
})());
t('summary: an object with .rows is read as the rows', (() => {
  const s = C.summary(CLEARED, Object.assign({}, FULL, { rights: { rows: FULL.rights } }));
  return s.eoReady === true;
})());
t('summary: junk in every slot still answers, and answers no', (() => {
  const s = C.summary('nonsense', { rights: 7, music: 'x', insurance: true, todayISO: TODAY });
  return !s.eoReady && s.total === 0 && s.blockers.length >= 3;
})());

/* ══ 3 · the gate: absence of evidence is not clearance ════════════════════ */
const noneChecked = X.rightsGate(null, null, { scope: 'all-media', checkedAt: TODAY });
t('gate: a project that never opened /music/ is not CLEAR',
  noneChecked.ok === false && noneChecked.level === 'unknown' && noneChecked.checked === false);
t('gate: the summary says what is unanswered', /never been answered/.test(noneChecked.summary));
t('gate: both unknowns are named, with what to do',
  noneChecked.blockers.length === 2 && noneChecked.blockers.every((b) => b.kind === 'unknown' && /Music|scan/i.test(b.label)) &&
  noneChecked.blockers.every((b) => b.detail.length > 20));
t('gate: a real blocker outranks an unknown', (() => {
  const g = X.rightsGate({ cues: [{ title: 'Blue Moon', status: 'identified' }] }, null, {});
  return g.level === 'blocked' && !g.ok && g.unknown === 1 && g.blockers.length === 2;
})());
t('gate: a fully checked, fully licensed cut is still clear', (() => {
  const g = X.rightsGate({ cues: [{ title: 'Main Title', status: 'licensed', scope: 'all-media' }] },
    { findings: [], scannedAt: TODAY }, { scope: 'all-media' });
  return g.ok && g.level === 'clear' && g.checked === true && g.cues === 1 && g.licensed === 1;
})());

/* ══ 4 · the door: the override guarantee is the library's, not the page's ══
   `!f.overrideReason` has no trim, so " " and "\t\n" sent — and were then
   recorded ON the screener as the audit reason. */
const WHITESPACE = [' ', '\t\n', '     ', '.', '-', '?'];
WHITESPACE.forEach((why) => {
  const store = X.blank();
  const res = X.sendScreener(store, { recipient: 'A. Buyer', sentAt: TODAY, overrideReason: why }, noneChecked);
  t('door: override ' + JSON.stringify(why) + ' is refused and nothing is logged',
    res.refused === true && res.screener === null && store.screeners.length === 0);
});
t('door: the refusal says why the reason was rejected', (() => {
  const res = X.sendScreener(X.blank(), { recipient: 'A', sentAt: TODAY, overrideReason: '  ' }, noneChecked);
  return /must be words/.test(res.reason || '');
})());
t('door: a real reason is accepted, collapsed and recorded', (() => {
  const store = X.blank();
  const res = X.sendScreener(store, { recipient: 'A. Buyer', sentAt: TODAY,
    overrideReason: '  Sales agent needs it \n today  ' }, noneChecked);
  return res.ok && res.overridden && store.screeners.length === 1 &&
    res.screener.overrideReason === 'Sales agent needs it today';
})());
t('door: overrideReason() is the one rule, callable by the page',
  X.overrideReason(' \t ') === '' && X.overrideReason('  ok  fine ') === 'ok fine' &&
  X.overrideReason(null) === '' && X.overrideReason('...') === '');
t('door: what went out is recorded even when it went out anyway', (() => {
  const store = X.blank();
  X.sendScreener(store, { recipient: 'A. Buyer', sentAt: TODAY, cutId: 'nh-v3',
    cutLabel: 'night-harvest-v3.mp4', overrideReason: 'Sales agent needs it' }, noneChecked);
  const s = store.screeners[0];
  return s.rights.ok === false && s.rights.level === 'unknown' &&
    s.rights.blockers.length === 2 && s.cutLabel === 'night-harvest-v3.mp4' && s.gated === true;
})());

/* ── sendScreener with NO gate: not an open door ── */
t('door: no gate argument is refused, not waved through', (() => {
  const store = X.blank();
  const res = X.sendScreener(store, { recipient: 'A. Buyer', sentAt: TODAY });
  return res.refused === true && store.screeners.length === 0 &&
    res.gate.level === 'unknown' && res.gate.ok === false;
})());
t('door: no gate + a reason records the unchecked state, never rights:null', (() => {
  const store = X.blank();
  const res = X.sendScreener(store, { recipient: 'A. Buyer', sentAt: TODAY,
    overrideReason: 'Backfilling a send from before the gate existed' });
  return res.ok && res.screener.rights !== null && res.screener.rights.level === 'unknown' &&
    res.screener.gated === true;
})());
t('registry: addScreener is the raw log line and marks itself ungated', (() => {
  const store = X.blank();
  const s = X.addScreener(store, { recipient: 'C. Late', sentAt: TODAY });
  return s.gated === false && s.rights === null && store.screeners.length === 1;
})());
t('registry: a whitespace reason never lands on a raw row either',
  X.addScreener(X.blank(), { recipient: 'X', overrideReason: '   ' }).overrideReason === '');

/* ══ 5 · exclusivity: a non-exclusive grant is a real deal ═════════════════ */
t('windows: exclusive defaults true but is settable false', (() => {
  const s = X.blank();
  const a = X.addWindow(s, { territory: 'Canada', channel: 'SVOD' });
  const b = X.addWindow(s, { territory: 'Canada', channel: 'SVOD', exclusive: false });
  return a.exclusive === true && b.exclusive === false && X.windowConflicts(s).length === 0;
})());
t('windows: an end with no start says the START is missing, not the end', (() => {
  const s = X.blank();
  X.addWindow(s, { territory: 'Canada', channel: 'SVOD', end: '2028-01-01' });
  X.addWindow(s, { territory: 'Canada', channel: 'SVOD', start: '2027-01-01', end: '2027-06-01' });
  const c = X.windowConflicts(s)[0];
  return c.kind === 'undated' && c.missing.join() === 'start date' &&
    /record the start date/.test(c.detail) && !/record the end date/.test(c.detail);
})());
t('windows: windowRange says which edge it knows', (() => {
  const r = X.windowRange({ end: '2028-01-01' });
  return r.endKnown === true && r.startKnown === false && r.dated === false;
})());
t('windows: a grant whose end is before the other starts is no clash at all', (() => {
  const s = X.blank();
  X.addWindow(s, { territory: 'Canada', channel: 'SVOD', end: '2027-01-01' });
  X.addWindow(s, { territory: 'Canada', channel: 'SVOD', start: '2028-01-01', end: '2029-01-01' });
  return X.windowConflicts(s).length === 0;
})());

console.log(`test_ops_rights: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
