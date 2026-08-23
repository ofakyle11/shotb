#!/usr/bin/env node
/* Node tests for post/lib-post.js (CPost) — run: node scripts/test_post.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'post/lib-post.js'), 'utf8'));
const P = globalThis.CPost;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

/* ── template ── */
const tpl = P.template();
t('template has all 14 milestones', tpl.length === 14);
t('template deep-copies (no shared after arrays)', (() => {
  const a = P.template(); a[0].after.push('zzz'); a[0].days = 99;
  return P.template()[0].after.length === 0 && P.template()[0].days === 5;
})());
t('qc waits on grade+mix+vfx-final', (() => {
  const qc = tpl.filter(m => m.id === 'qc')[0];
  return qc.after.slice().sort().join(',') === 'grade,mix,vfx-final';
})());

/* ── date math (2026-01-05 is a Monday; 2026-01-03 a Saturday) ── */
t('isWeekend spots Saturday', P.isWeekend('2026-01-03') && !P.isWeekend('2026-01-05'));
t('addBusDays skips a weekend', P.addBusDays('2026-01-09', 1) === '2026-01-12'); // Fri +1 → Mon
t('addBusDays 5 = one full week', P.addBusDays('2026-01-05', 5) === '2026-01-12');
t('addBusDays negative crosses weekend back', P.addBusDays('2026-01-12', -1) === '2026-01-09');
t('addBusDays zero is identity on a business day', P.addBusDays('2026-01-07', 0) === '2026-01-07');
t('snapBusiness forward Sat→Mon', P.snapBusiness('2026-01-03', 1) === '2026-01-05');
t('snapBusiness backward Sun→Fri', P.snapBusiness('2026-01-04', -1) === '2026-01-02');
t('busDiff signed both ways', P.busDiff('2026-01-05', '2026-01-12') === 5 &&
                              P.busDiff('2026-01-12', '2026-01-05') === -5 &&
                              P.busDiff('2026-01-05', '2026-01-05') === 0);

/* ── forward schedule from Monday 2026-01-05 ── */
const fwd = P.schedule(P.template(), '2026-01-05', 'forward');
const F = {}; fwd.rows.forEach(r => { F[r.id] = r; });
t('forward: assembly Mon Jan 5 → Fri Jan 9', F.assembly.start === '2026-01-05' && F.assembly.end === '2026-01-09');
t('forward: editors-cut starts next business day', F['editors-cut'].start === '2026-01-12' && F['editors-cut'].end === '2026-01-23');
t('forward: turnover lands Feb 12-13', F.turnover.start === '2026-02-12' && F.turnover.end === '2026-02-13');
t('forward: grade/sound-edit/vfx run parallel off turnover',
  F.grade.start === '2026-02-16' && F['sound-edit'].start === '2026-02-16' && F['vfx-final'].start === '2026-02-16');
t('forward: vfx-final 15 working days → Mar 6', F['vfx-final'].end === '2026-03-06');
t('forward: qc starts after LATEST of its 3 parents',
  F.qc.start === '2026-03-09' && F.qc.start === P.addBusDays(F['vfx-final'].end, 1));
t('forward: delivery lands Mon Mar 16', F.delivery.start === '2026-03-16' && F.delivery.end === '2026-03-16');
t('no milestone ever starts or ends on a weekend',
  fwd.rows.every(r => !P.isWeekend(r.start) && !P.isWeekend(r.end)));
t('critical path totals 51 days', fwd.criticalPath === 51);
t('critical path routes through sound-edit→mix, not conform',
  fwd.path.indexOf('sound-edit') >= 0 && fwd.path.indexOf('mix') >= 0 && fwd.path.indexOf('conform') < 0);
t('rows carry blockedBy + critical flags',
  F.dcp.blockedBy.join(',') === 'qc' && F.delivery.critical === true && F['m-and-e'].critical === false);
t('weekend forward anchor snaps to Monday',
  P.schedule(P.template(), '2026-01-03', 'forward').rows[0].start === '2026-01-05');

/* ── backward schedule: delivery lands ON the given date ── */
const bwd = P.schedule(P.template(), '2026-03-16', 'backward');
const B = {}; bwd.rows.forEach(r => { B[r.id] = r; });
t('backward: delivery ends ON the target', B.delivery.end === '2026-03-16');
t('backward: solves assembly start to Jan 5', B.assembly.start === '2026-01-05');
t('backward mirrors forward exactly', fwd.rows.every(r => B[r.id].start === r.start && B[r.id].end === r.end));
t('backward weekend target snaps to previous Friday',
  (() => { const s = P.schedule(P.template(), '2026-03-15', 'backward'); // a Sunday
           return s.rows.filter(r => r.id === 'delivery')[0].end === '2026-03-13'; })());
t('cycle returns error, not hang', (() => {
  const s = P.schedule([{ id: 'a', name: 'A', days: 1, after: ['b'] },
                        { id: 'b', name: 'B', days: 1, after: ['a'] }], '2026-01-05', 'forward');
  return s.error === 'cycle' && s.rows.length === 0;
})());
t('multi-day custom milestone spans weekends correctly', (() => {
  const s = P.schedule([{ id: 'x', name: 'X', days: 7, after: [] }], '2026-01-05', 'forward');
  return s.rows[0].end === '2026-01-13' && s.criticalPath === 7; // Mon..next Tue
})());

t('no anchor date → no dates invented, critical path still solves', (() => {
  const s = P.schedule(P.template(), '', 'backward');
  return s.rows.length === 14 && s.rows.every(r => r.start === null && r.end === null) &&
         s.criticalPath === 51 && s.start === null && s.end === null;
})());

/* ── versions ── */
t('versionName Project_DC_v03 style', P.versionName('Project', 'directors-cut', 3) === 'Project_DC_v03');
t('versionName strips spaces/punct', P.versionName('Night Harvest!', 'editors-cut', 12) === 'NightHarvest_EC_v12');
t('versionName falls back safely', P.versionName('', 'weird stage', 1) === 'Project_WEIR_v01');
const log = [];
t('nextVersion starts at 1', P.nextVersion(log, 'directors-cut') === 1);
const v1 = P.addVersion(log, { stage: 'directors-cut', date: '2026-02-01', notes: 'first pass' });
P.addVersion(log, { stage: 'directors-cut' });
P.addVersion(log, { stage: 'mix' });
t('addVersion auto-numbers per stage', v1.n === 1 && log[1].n === 2 && log[2].n === 1);
t('nextVersion counts only its stage', P.nextVersion(log, 'directors-cut') === 3 && P.nextVersion(log, 'mix') === 2);
t('version rows carry id/date/notes', v1.id && v1.date === '2026-02-01' && v1.notes === 'first pass');

/* ── vendor bids + commit-once guard ── */
const bids = [];
const b1 = P.addBid(bids, { service: 'grade', vendor: 'Northlight Colour', bid: 18000 });
const b2 = P.addBid(bids, { service: 'grade', vendor: 'Budget Grade Co', bid: 9500 });
P.addBid(bids, { service: 'mix', vendor: 'Mixhaus', bid: 22000 });
t('addBid stores service/vendor/amount', b1.service === 'grade' && b1.bid === 18000 && b1.awarded === false);
t('addBid rejects unknown service', P.addBid(bids, { service: 'catering', vendor: 'X', bid: 5 }) === null && bids.length === 3);
t('lowBid finds the cheapest per service', P.lowBid(bids, 'grade').vendor === 'Budget Grade Co' && P.lowBid(bids, 'dcp') === null);
const aw = P.awardBid(bids, b2.id);
t('award flags the bid and asks for a PO', aw.bid.awarded === true && aw.needsCommit === true);
aw.bid.committedPo = 'PO-1001'; // page sets this after CMoney.addPO
t('committedPo guard blocks a second commit', P.awardBid(bids, b2.id).needsCommit === false);
t('awardBid of unknown id → null', P.awardBid(bids, 'nope') === null);

/* ── Money Room round-trip (real CMoney) ── */
(0, eval)(readFileSync(join(ROOT, 'finance/lib-money.js'), 'utf8'));
const M = globalThis.CMoney;
const money = M.blank();
const po = M.addPO(money, { vendor: aw.bid.vendor, desc: 'Post grade — awarded bid',
                            acct: '15000', amount: aw.bid.bid, date: '2026-02-16' });
t('awarded bid commits to acct 15000 as open PO', po.acct === '15000' && po.status === 'open' && po.amount === 9500);
t('PO shows as committed in the cost report',
  M.costReport({ categories: [] }, money).rows.filter(r => r.acct === '15000')[0].committed === 9500);

/* ── delivery readiness ── */
const ready = P.distReadiness(fwd.rows);
t('readiness lists exactly the 5 deliverables', ready.length === 5 &&
  ready.map(r => r.deliverable).sort().join('|') === '5.1 printmaster|DCP|M&E|ProRes master|QC report');
t('grade → ProRes master with its end date',
  ready.filter(r => r.id === 'grade')[0].deliverable === 'ProRes master' &&
  ready.filter(r => r.id === 'grade')[0].ready === '2026-02-20');
t('readiness sorted by ready date', ready[0].id === 'grade' && ready[ready.length - 1].id === 'dcp');
t('readiness tolerates undated rows', (() => {
  const r = P.distReadiness([{ id: 'mix', name: 'Final mix' }, { id: 'grade', name: 'Grade', end: '2026-02-20' }]);
  return r.length === 2 && r[0].id === 'grade' && r[1].ready === null;
})());

console.log(`test_post: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
