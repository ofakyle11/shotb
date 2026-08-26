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
/* money substrate — hard load order: math → accounts → sheet */
for (const f of ['js/lib-money-math.js', 'js/lib-money-accounts.js', 'js/lib-money-sheet.js']) {
  (0, eval)(readFileSync(join(ROOT, f), 'utf8'));
}
(0, eval)(readFileSync(join(ROOT, 'finance/lib-money.js'), 'utf8'));
const M = globalThis.CMoney;
const money = M.blank();
const po = M.addPO(money, { vendor: aw.bid.vendor, desc: 'Post grade — awarded bid',
                            acct: '15000', amount: aw.bid.bid, date: '2026-02-16' });
t('awarded bid commits to acct 15000 as open PO', po.acct === '15000' && po.status === 'open' && po.amount === 9500);
t('PO shows as committed in the cost report',
  M.costReport({ categories: [] }, money).rows.filter(r => r.acct === '15000')[0].committed === 9500);

/* ── delivery readiness (reads ACTUALS, never the plan) ── */
const ready = P.distReadiness(fwd.rows);
t('readiness lists exactly the 5 deliverables', ready.length === 5 &&
  ready.map(r => r.deliverable).sort().join('|') === '5.1 printmaster|DCP|M&E|ProRes master|QC report');
t('grade → ProRes master, planned date carried but NOT called ready',
  ready.filter(r => r.id === 'grade')[0].deliverable === 'ProRes master' &&
  ready.filter(r => r.id === 'grade')[0].planned === '2026-02-20' &&
  ready.filter(r => r.id === 'grade')[0].ready === null);
t('a plan alone makes NOTHING ready', ready.every(r => r.ready === null && r.status === 'planned'));
t('readiness sorted by the date that matters', ready[0].id === 'grade' && ready[ready.length - 1].id === 'dcp');
t('readiness tolerates undated rows', (() => {
  const r = P.distReadiness([{ id: 'mix', name: 'Final mix' }, { id: 'grade', name: 'Grade', end: '2026-02-20' }]);
  return r.length === 2 && r[0].id === 'grade' && r[1].planned === null && r[1].ready === null;
})());

/* ══ actuals layer — SB_PostActuals_v1, laid OVER the plan ══════════════ */
t('blankActuals is an empty, versioned store', (() => {
  const a = P.blankActuals();
  return a.v === 1 && Object.keys(a.milestones).length === 0 && P.ACTUALS_KEY === 'SB_PostActuals_v1';
})());
t('actualFor always returns a full record', (() => {
  const r = P.actualFor(P.blankActuals(), 'assembly');
  return r.id === 'assembly' && r.status === 'not-started' && r.actualStart === '' && r.actualEnd === '';
})());
t('setActual records status + dates', (() => {
  const a = P.blankActuals();
  const r = P.setActual(a, 'assembly', { status: 'done', actualStart: '2026-01-05', actualEnd: '2026-01-07' });
  return r.status === 'done' && r.actualEnd === '2026-01-07' && a.milestones.assembly.actualStart === '2026-01-05';
})());
t('"done" with no end date is REFUSED — a claim with no date is not evidence', (() => {
  const a = P.blankActuals();
  const r = P.setActual(a, 'assembly', { status: 'done', actualStart: '2026-01-05' });
  const bare = P.setActual(a, 'mix', { status: 'done' });
  return r.status === 'in-progress' && bare.status === 'not-started';
})());
t('status follows the evidence when none is given', (() => {
  const a = P.blankActuals();
  const started = P.setActual(a, 'grade', { actualStart: '2026-02-16' });
  const ended = P.setActual(a, 'grade', { actualEnd: '2026-02-20' });
  const reopened = P.setActual(a, 'grade', { actualEnd: '' });
  return started.status === 'in-progress' && ended.status === 'done' && reopened.status === 'in-progress';
})());
t('setActual rejects junk dates and clears dates on not-started', (() => {
  const a = P.blankActuals();
  P.setActual(a, 'grade', { status: 'in-progress', actualStart: 'soon-ish' });
  const back = P.setActual(a, 'grade', { status: 'not-started', actualStart: '2026-02-16' });
  return a.milestones.grade.actualStart === '' && back.actualStart === '' && back.actualEnd === '';
})());
t('clearActual forgets a milestone entirely', (() => {
  const a = P.blankActuals();
  P.setActual(a, 'grade', { status: 'done', actualStart: '2026-02-16', actualEnd: '2026-02-20' });
  const r = P.clearActual(a, 'grade');
  return r.status === 'not-started' && a.milestones.grade === undefined;
})());
t('busSpan counts an observed interval inclusively, weekends skipped',
  P.busSpan('2026-01-05', '2026-01-09') === 5 && P.busSpan('2026-01-05', '2026-01-05') === 1 &&
  P.busSpan('2026-01-05', '2026-01-12') === 6);
t('slipDays is signed: + late, − early, 0 on plan',
  P.slipDays('2026-01-09', '2026-01-12') === 1 && P.slipDays('2026-01-12', '2026-01-09') === -1 &&
  P.slipDays('2026-01-09', '2026-01-09') === 0 && P.slipDays('', '2026-01-09') === 0);
t('effectiveMilestones substitutes observed duration and never mutates the input', (() => {
  const a = P.blankActuals();
  P.setActual(a, 'assembly', { status: 'done', actualStart: '2026-01-05', actualEnd: '2026-01-07' });
  const src = P.template();
  const eff = P.effectiveMilestones(src, a);
  return eff.filter(m => m.id === 'assembly')[0].days === 3 &&
         src.filter(m => m.id === 'assembly')[0].days === 5;
})());

/* — a milestone that finished EARLY — */
const early = P.blankActuals();
P.setActual(early, 'assembly', { status: 'done', actualStart: '2026-01-05', actualEnd: '2026-01-07' }); // 5 → 3 days
const ovEarly = P.overlay(P.template(), early, '2026-01-05', 'forward');
const E = {}; ovEarly.rows.forEach(r => { E[r.id] = r; });
t('early: row carries planned AND actual side by side',
  E.assembly.plannedStart === '2026-01-05' && E.assembly.plannedEnd === '2026-01-09' &&
  E.assembly.actualEnd === '2026-01-07' && E.assembly.status === 'done' && E.assembly.actualDays === 3);
t('early: slip is −2 business days on that milestone', E.assembly.slip === -2);
t('early: downstream forecast pulls forward, plan is untouched',
  E['editors-cut'].plannedStart === '2026-01-12' && E['editors-cut'].forecastStart === '2026-01-08' &&
  ovEarly.plannedEnd === '2026-03-16' && ovEarly.forecastEnd === '2026-03-12');
t('early: whole-project slip is −2 and the critical path has NOT moved',
  ovEarly.slip === -2 && ovEarly.criticalMoved === false &&
  ovEarly.actualPath.join(',') === ovEarly.path.join(','));
t('early: counts by status', ovEarly.done === 1 && ovEarly.inProgress === 0 && ovEarly.notStarted === 13);

/* — a milestone that finished LATE and MOVED the critical path — */
/* The plan ties at 45 days into qc and routes through sound-edit → mix, with
   vfx-final (15d off turnover) one tie-break away. VFX coming in at 30 days is
   the ordinary post disaster: it takes the critical path off sound and mix. */
const late = P.blankActuals();
P.setActual(late, 'vfx-final', { status: 'done', actualStart: '2026-02-16', actualEnd: '2026-03-27' }); // 15 → 30 days
const ovLate = P.overlay(P.template(), late, '2026-01-05', 'forward');
const L = {}; ovLate.rows.forEach(r => { L[r.id] = r; });
t('late: vfx-final ran 30 days against a 15-day estimate',
  L['vfx-final'].days === 15 && L['vfx-final'].actualDays === 30 && L['vfx-final'].slip === 15);
t('late: delivery forecast slips 15 business days past plan',
  ovLate.plannedEnd === '2026-03-16' && ovLate.forecastEnd === '2026-04-06' && ovLate.slip === 15);
t('late: downstream qc waits on the LATE parent, not the planned one',
  L.qc.plannedStart === '2026-03-09' && L.qc.forecastStart === '2026-03-30' && L.qc.slip === 15);
t('late: the critical path MOVED off sound-edit → mix onto vfx-final',
  ovLate.criticalMoved === true &&
  ovLate.path.indexOf('mix') >= 0 && ovLate.actualPath.indexOf('mix') < 0 &&
  ovLate.actualPath.indexOf('vfx-final') >= 0 && ovLate.path.indexOf('vfx-final') < 0);
t('late: rows flag critical THEN vs critical NOW separately',
  L['vfx-final'].critical === false && L['vfx-final'].criticalNow === true &&
  L['sound-edit'].critical === true && L['sound-edit'].criticalNow === false &&
  L.mix.critical === true && L.mix.criticalNow === false);
t('late: as-run critical path is longer than the planned one',
  ovLate.criticalPath === 51 && ovLate.criticalPathActual === 66);

/* — a milestone still IN PROGRESS — */
const wip = P.blankActuals();
P.setActual(wip, 'assembly', { status: 'done', actualStart: '2026-01-05', actualEnd: '2026-01-09' });
P.setActual(wip, 'editors-cut', { status: 'in-progress', actualStart: '2026-01-14' }); // started 2 days late
const ovWip = P.overlay(P.template(), wip, '2026-01-05', 'forward');
const W = {}; ovWip.rows.forEach(r => { W[r.id] = r; });
t('in-progress: actual start honoured, no end claimed',
  W['editors-cut'].status === 'in-progress' && W['editors-cut'].actualStart === '2026-01-14' &&
  W['editors-cut'].actualEnd === '' && W['editors-cut'].actualDays === null);
t('in-progress: forecast end = actual start + the estimate still standing',
  W['editors-cut'].forecastEnd === '2026-01-27' && W['editors-cut'].slip === 2);
t('in-progress: an on-plan finished milestone slips 0', W.assembly.slip === 0 && W.assembly.status === 'done');
t('in-progress: the whole project is forecast 2 days late, path unmoved',
  ovWip.slip === 2 && ovWip.forecastEnd === '2026-03-18' && ovWip.criticalMoved === false);
t('overlay counts in-progress separately', ovWip.done === 1 && ovWip.inProgress === 1 && ovWip.notStarted === 12);

/* — readiness from actuals — */
const rdyActual = P.distReadiness(ovLate.rows);
t('readiness: only a milestone recorded DONE is ready', (() => {
  const a = P.blankActuals();
  P.setActual(a, 'grade', { status: 'done', actualStart: '2026-02-16', actualEnd: '2026-02-24' });
  P.setActual(a, 'mix', { status: 'in-progress', actualStart: '2026-03-02' });
  const r = P.distReadiness(P.overlay(P.template(), a, '2026-01-05', 'forward').rows);
  const by = {}; r.forEach(x => { by[x.id] = x; });
  return by.grade.status === 'ready' && by.grade.ready === '2026-02-24' && by.grade.slip === 2 &&
         by.mix.status === 'in-progress' && by.mix.ready === null &&
         by.dcp.status === 'planned' && by.dcp.ready === null && by.dcp.planned === '2026-03-13';
})());
t('readiness never calls a forecast ready — a 15-day slip is still only forecast',
  rdyActual.every(r => r.ready === null && r.status === 'planned') &&
  rdyActual.filter(r => r.id === 'dcp')[0].planned === '2026-03-13' &&
  rdyActual.filter(r => r.id === 'dcp')[0].forecast === '2026-04-03');
t('distReadiness also accepts plan rows + a separate actuals store', (() => {
  const a = P.blankActuals();
  P.setActual(a, 'qc', { status: 'done', actualStart: '2026-03-09', actualEnd: '2026-03-10' });
  const r = P.distReadiness(fwd.rows, a);
  const qc = r.filter(x => x.id === 'qc')[0];
  return qc.status === 'ready' && qc.ready === '2026-03-10' && qc.planned === '2026-03-10' && qc.slip === 0;
})());

/* — the overlay must not touch the plan — */
t('overlay never mutates the milestones or the plan it was given', (() => {
  const src = P.template();
  const before = JSON.stringify(src);
  const a = P.blankActuals();
  P.setActual(a, 'grade', { status: 'done', actualStart: '2026-02-16', actualEnd: '2026-03-06' });
  P.overlay(src, a, '2026-01-05', 'forward');
  const plain = P.schedule(P.template(), '2026-01-05', 'forward');
  return JSON.stringify(src) === before &&
         plain.rows.every(r => F[r.id].start === r.start && F[r.id].end === r.end);
})());
t('overlay on an empty actuals store == the plan, with nothing claimed', (() => {
  const o = P.overlay(P.template(), P.blankActuals(), '2026-01-05', 'forward');
  return o.rows.every(r => r.forecastStart === r.plannedStart && r.forecastEnd === r.plannedEnd &&
                           r.slip === 0 && r.status === 'not-started') &&
         o.slip === 0 && o.criticalMoved === false && o.done === 0;
})());
t('overlay with no anchor date invents no dates', (() => {
  const a = P.blankActuals();
  P.setActual(a, 'assembly', { status: 'done', actualStart: '2026-01-05', actualEnd: '2026-01-07' });
  const o = P.overlay(P.template(), a, '', 'backward');
  const asm = o.rows.filter(r => r.id === 'assembly')[0];
  return o.plannedEnd === null && asm.plannedEnd === null && asm.forecastEnd === '2026-01-07' &&
         asm.slip === 0 && o.criticalPath === 51;
})());
t('overlay passes a dependency cycle through as an error, not a hang', (() => {
  const o = P.overlay([{ id: 'a', name: 'A', days: 1, after: ['b'] },
                       { id: 'b', name: 'B', days: 1, after: ['a'] }], P.blankActuals(), '2026-01-05', 'forward');
  return o.error === 'cycle' && o.rows.length === 0 && o.criticalMoved === false;
})());
t('a weekend actual date is tolerated, not counted as a working day', (() => {
  const a = P.blankActuals();
  P.setActual(a, 'assembly', { status: 'done', actualStart: '2026-01-05', actualEnd: '2026-01-10' }); // ends Sat
  const o = P.overlay(P.template(), a, '2026-01-05', 'forward');
  const asm = o.rows.filter(r => r.id === 'assembly')[0];
  return asm.actualDays === 5 && asm.slip === 0 &&
         o.rows.filter(r => r.id === 'editors-cut')[0].forecastStart === '2026-01-12';
})());
t('nextBusDay rolls a Saturday finish to Monday, not Tuesday',
  P.nextBusDay('2026-01-10') === '2026-01-12' && P.nextBusDay('2026-01-09') === '2026-01-12' &&
  P.nextBusDay('2026-01-05') === '2026-01-06');

/* ── purity pin: the plan must never consult the clock ──────────────────
   schedule() is the one function every other post surface trusts to give the
   same answer twice. If it ever reads Date.now(), the same store renders two
   different calendars on two different days and nothing downstream can be
   reproduced or tested. Pin it here so a later edit has to argue with a test. */
const SRC = readFileSync(join(ROOT, 'post/lib-post.js'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
t('lib-post.js contains no Date.now / new Date() / Date.parse anywhere',
  !/Date\.now|new\s+Date\s*\(|Date\.parse|\.getTime\s*\(/.test(CODE.split('new Date(Date.UTC(').join('PURE_UTC_PARSE(')));
t('the only Date construction in the file is the pure Date.UTC parse',
  (SRC.match(/new Date\(/g) || []).length === 1 && /new Date\(Date\.UTC\(/.test(SRC));
t('schedule is deterministic: same inputs, same answer, twice',
  JSON.stringify(P.schedule(P.template(), '2026-01-05', 'forward')) ===
  JSON.stringify(P.schedule(P.template(), '2026-01-05', 'forward')));
t('schedule ignores the clock even when the clock lies', (() => {
  const realNow = Date.now, realDate = globalThis.Date;
  let touched = false;
  Date.now = function () { touched = true; return realNow.call(Date); };
  const A = JSON.stringify(P.schedule(P.template(), '2026-03-16', 'backward'));
  const B = JSON.stringify(P.overlay(P.template(), P.blankActuals(), '2026-03-16', 'backward'));
  Date.now = realNow;
  globalThis.Date = realDate;
  return !touched && A.indexOf('2026-01-05') > 0 && B.indexOf('2026-01-05') > 0;
})());

console.log(`test_post: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
