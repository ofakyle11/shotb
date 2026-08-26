#!/usr/bin/env node
/* Node tests for the ops suite engines: CMoney, CSafety, CClear, CDeal,
   CScreen, CDist — run: node scripts/test_ops.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
for (const f of ['js/lib-scenes.js',
                 'js/lib-money-math.js', 'js/lib-money-accounts.js', 'js/lib-money-sheet.js',
                 'finance/lib-money.js', 'safety/lib-safety.js', 'clearance/lib-clear.js',
                 'contracts/lib-deal.js', 'screening/lib-screen.js', 'distribution/lib-dist.js']) {
  (0, eval)(readFileSync(join(ROOT, f), 'utf8'));
}
const { CMoney: M, CSafety: S, CClear: C, CDeal: D, CScreen: R, CDist: X } = globalThis;

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.error('  ✗', n); } };

/* ══ CMoney — the cost report ══ */
const sheet = { categories: [
  { acct: '2000', name: 'Cast', items: [{ est: 10000 }, { est: 5000 }] },
  { acct: '3000', name: 'Production', items: [{ est: 20000 }] }] };
const m = M.blank();
const po1 = M.addPO(m, { vendor: 'Grip Co', desc: 'package', acct: '3000', amount: 6000 });
M.addPO(m, { vendor: 'Casting', desc: 'session', acct: '2000', amount: 2000 });
M.addPetty(m, { who: 'PA', desc: 'gaff tape', acct: '3000', amount: 150 });
t('PO numbering sequential', po1.num === 'PO-1001' && m.pos[1].num === 'PO-1002');
let rep = M.costReport(sheet, m);
const r3000 = rep.rows.filter(r => r.acct === '3000')[0];
t('open PO is committed, petty is actual', r3000.committed === 6000 && r3000.actual === 150);
t('ETC defaults to remaining plan', r3000.etc === 20000 - 6000 - 150);
t('EFC = actual+committed+etc = budget when on plan', r3000.efc === 20000 && r3000.variance === 0);
M.setPoStatus(m, po1.id, 'paid');
rep = M.costReport(sheet, m);
t('paid PO moves committed→actual', rep.rows.filter(r => r.acct === '3000')[0].actual === 6150);
m.etc['3000'] = 20000;   // line producer says the spend is coming regardless
rep = M.costReport(sheet, m);
const over = rep.rows.filter(r => r.acct === '3000')[0];
t('ETC override forces overrun visible', over.over && over.variance === 20000 - over.efc);
t('unbudgeted account surfaces', (() => {
  const m2 = M.blank(); M.addPO(m2, { acct: '9999', amount: 100 });
  return M.costReport(sheet, m2).rows.some(r => r.acct === '9999' && /Unbudgeted/.test(r.name));
})());
const snap = M.snapshot(m, rep, '2026-08-23');
t('snapshot freezes totals', snap.week === 1 && snap.totals.efc === rep.totals.efc);
t('csv carries total row', /TOTAL/.test(M.csv(rep)));
delete globalThis.CLearn;
t('feedLearning safe without CLearn', M.feedLearning(sheet, m) === 0);
let learned = null;
globalThis.CLearn = { learnBudget: (s2) => { learned = s2; return s2.categories.length; } };
t('actuals feed the learning layer per acct', M.feedLearning(sheet, m) >= 1 && learned.categories[0].items[0].actual > 0);
delete globalThis.CLearn;

/* ══ CSafety ══ */
const SCRIPT = `INT. BARN - NIGHT
Tom loads the shotgun. A fight breaks out; Hal falls from the loft.

EXT. RIVER ROAD - NIGHT
A car chase along the bank. Mara swims across the river as rain hammers down.

EXT. MAIN STREET - DAY
A crowd gathers. A drone shot rises above the town.`;
const an = S.analyze(SCRIPT);
t('safety: scenes counted', an.scenes === 3 && an.flagged.length === 3);
const sc1 = an.flagged[0];
t('safety: weapons+stunts flagged in sc1', sc1.hazards.some(h => h.id === 'weapons') && sc1.hazards.some(h => h.id === 'stunts'));
t('safety: water+vehicles+night+electrical in sc2', (() => {
  const ids = an.flagged[1].hazards.map(h => h.id);
  return ids.includes('water') && ids.includes('vehicles') && ids.includes('electrical');
})());
t('safety: crowd+aerial in sc3', (() => {
  const ids = an.flagged[2].hazards.map(h => h.id);
  return ids.includes('crowds') && ids.includes('aerial');
})());
t('safety: personnel deduped', an.personnel.length === new Set(an.personnel).size && an.personnel.length >= 5);
const doc = S.assessmentText(an, 'Night Harvest', 'K. Francis', '2026-08-23');
t('safety: assessment carries controls + responsibles', /Licensed armorer/.test(doc) && /SCENE 2/.test(doc) && /HIGH/.test(doc));
t('safety: meeting checklist scoped to scenes', S.meetingChecklist(an, [3]).some(i => /Sc 3/.test(i)) &&
  !S.meetingChecklist(an, [3]).some(i => /Sc 1/.test(i)));
/* paid duty police */
t('police: toronto direct link kept', S.policeFor('Toronto').url.indexOf('tps.ca') > 0);
t('police: incentive id resolves (ontario→TPS)', S.policeFor('ontario').service.indexOf('Toronto') === 0);
t('police: nypd known, no invented url', S.policeFor('New York, USA').url === null && /NYPD/.test(S.policeFor('new-york').service));
t('police: unknown city → null + search link works', S.policeFor('Smallville') === null && /google/.test(S.policeSearchLink(null, 'Smallville')));
const needs = S.paidDutyNeeds(an);
t('police: street chase + crowd trigger officers', needs.some(n => /traffic control/i.test(n.why)) && needs.some(n => /Crowd/i.test(n.why)));
const est = S.paidDutyEstimate({ officers: 2, hours: 8, rate: 90, days: 3 });
t('police: estimate math with admin fee', est.perDay === 1440 && est.total === Math.round(1440 * 3 * 1.1));
t('police: minimum call enforced', S.paidDutyEstimate({ officers: 1, hours: 2, rate: 90 }).hours === 4);

/* ══ CClear ══ */
const CSCRIPT = `INT. DINER - DAY
Mara sips a Coca-Cola under a neon sign. On the TV, news footage of the flood.
Tom scribbles a number: 416-555-0142. Hal sings "Blue Moon" off key.
A painting of the founder hangs crooked. Call him at 212-867-5309.`;
const finds = C.scan(CSCRIPT);
const cats = finds.map(f => f.cat);
t('clear: brand caught', cats.includes('brand') && finds.some(f => f.term === 'Coca-Cola'));
t('clear: music caught', cats.includes('music'));
t('clear: 555 number NOT flagged, real number flagged', !finds.some(f => /555-0142/.test(f.term)) && finds.some(f => /867-5309/.test(f.term)));
t('clear: footage + artwork + signage caught', cats.includes('footage') && cats.includes('artwork') && cats.includes('signage'));
t('clear: findings carry scene + action + excerpt', finds.every(f => f.scene === 1 && f.action && f.excerpt));
let sum = C.summary(finds);
t('clear: summary counts open', sum.open === finds.length && !sum.eoReady);
finds.forEach(f => { f.status = 'cleared'; });
t('clear: all cleared → E&O ready', C.summary(finds).eoReady);
t('clear: sync letter names the work', /Blue Moon/.test(C.syncRequest({ item: 'Blue Moon', production: 'X' })));
t('clear: location release carries address', /12 Harbor Lane/.test(C.locationRelease({ address: '12 Harbor Lane' })));

/* ══ CDeal ══ */
const ds = D.blank();
const deal = D.addDeal(ds, D.fromCrewRow({ name: 'J. Chen', role: 'Gaffer', union: 'IATSE', rate: 650 }, 'Night Harvest'));
t('deal: crew defaults sane', deal.fields.rateBasis === 'day' && deal.fields.guaranteed === 5 && deal.status === 'draft');
/* A deal memo obligates the fringes too — an IATSE gaffer at $650/day for a
   5-day guarantee costs $3,250 fee + $390 OT allowance (12%) + $1,456 fringes
   (40% of fee+OT) = $5,096. Committing the bare $3,250 understated every crew
   commitment in the Money Room by the whole employer burden. */
const gCost = D.dealCost(deal.fields);
t('deal: cost breaks out fee, OT allowance and fringes',
  gCost.base === 3250 && gCost.overtime === 390 && gCost.fringes === 1456 && gCost.fringePct === 0.40);
t('deal: value = fee + OT + fringes', D.dealValue(deal.fields) === 5096);
deal.fields.kitFee = 200; deal.fields.perDiem = 40;
/* Per diem is per WORKING day (5), and neither kit nor per diem is fringeable. */
t('deal: kit + per diem included, unfringed', D.dealValue(deal.fields) === 5096 + 200 + 40 * 5);
const cast = D.addDeal(ds, D.castDefaults('Night Harvest', 'MARA'));
t('deal: cast starts at SAG scale', cast.fields.rate === D.SAG_SCALE.day && cast.fields.union === 'SAG-AFTRA');
const com = D.toCommitment(deal);
/* The one chart (CAccounts.forRole): a gaffer is G&E (8000), not Direction,
   and a cast agreement is Cast (4000), not Producers Unit — so a commitment
   reconciles against the budget line that actually carries it. */
t('deal: gaffer commits to 8000 G&E, cast to 4000 Cast', com.acct === '8000' && D.toCommitment(cast).acct === '4000');
t('deal: commitment names the person', com.vendor === 'J. Chen' && /Gaffer/.test(com.desc));
const memo = D.memoText(deal.fields);
t('deal: memo carries rate + OT + kit', /\$650 per day/.test(memo) && /1\.5x after 12/.test(memo) && /Kit\/box rental: \$200/.test(memo));
t('deal: cast memo shows scale tag', /\(scale\)/.test(D.memoText(cast.fields)));
t('deal: nda names the signer', /J\. Chen/.test(D.ndaText({ name: 'J. Chen', production: 'X' })));
t('deal: status transitions guarded', D.setStatus(ds, deal.id, 'signed').status === 'signed' && D.setStatus(ds, deal.id, 'zap') === null);

/* ══ CScreen ══ */
const rs = R.blank();
const sess = R.newSession(rs, 'DC1', 'HZ465', 'now');
R.addNote(sess, 92.4, 'Music too loud under dialogue', 'HZ465');
R.addNote(sess, 12.1, 'Trim the head of this shot', 'MZ465');
t('screen: notes sorted by tc', sess.notes[0].sec === 12.1);
t('screen: tc format 24fps', R.fmtTc(92.5, 24) === '00:01:32:12');
t('screen: tc parse round trip', Math.abs(R.parseTc('00:01:32:12', 24) - 92.5) < 0.03 && R.parseTc('1:30') === 90);
R.setStatus(sess, sess.notes[0].id, 'done');
const prog = R.progress(sess);
t('screen: progress counts open/done', prog.open === 1 && prog.done === 1 && !prog.locked);
const marks = R.toMarkers(sess);
t('screen: only open notes become markers, with author+tc', marks.length === 1 && /HZ465/.test(marks[0].text) && /00:01:32/.test(marks[0].text));
t('screen: export text carries status', /\[DONE\]/.test(R.exportText(sess)) && /\[OPEN\]/.test(R.exportText(sess)));

/* ══ CDist ══ */
const dsx = X.blank();
t('dist: streamer needs everything', X.checklist(dsx).required === X.DELIVERABLES.length);
dsx.buyer = 'festival';
let ck = X.checklist(dsx);
t('dist: festival needs 5', ck.required === 5 && ck.pct === 0);
X.toggle(dsx, 'dcp'); X.toggle(dsx, 'trailer');
ck = X.checklist(dsx);
t('dist: progress tracks required only', ck.complete === 2 && ck.pct === 40);
X.addWindow(dsx, { territory: 'Canada', channel: 'SVOD', start: '2027-01-01' });
X.addWindow(dsx, { territory: 'Canada', channel: 'SVOD', start: '2027-03-01' });
t('dist: exclusivity clash detected', X.windowConflicts(dsx).length === 1);
const scn = X.addScreener(dsx, { recipient: 'A. Buyer', company: 'Festco', sentAt: '2026-08-23' });
t('dist: screener logged unwatched', scn.watched === false && dsx.screeners.length === 1);
t('dist: removeRow clears either table', X.removeRow(dsx, scn.id) && dsx.screeners.length === 0);

console.log(`test_ops: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
