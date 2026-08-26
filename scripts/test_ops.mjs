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

/* ── E&O readiness is a representation made to an insurer ──
   The old rule was `open === 0` counting only `pending`, so marking every
   finding "accepted risk" turned the banner green having cleared NOTHING,
   and the chain of title, the music licences and the certificate of insurance
   were never consulted at all. */
const EO_FILE = {
  rights: [{ material: 'Night Harvest (novel)', kind: 'Option', party: 'A. Sayer', status: 'Executed' },
           { material: 'Screenplay', kind: 'Writer agreement', party: 'K. Francis', status: 'Executed' }],
  music: { cues: [{ title: 'Blue Moon', status: 'licensed', scope: 'all-media' }] },
  insurance: [{ kind: 'E&O', carrier: 'Chubb', policy: 'EO-1', expiry: '2027-06-30' }],
  todayISO: '2026-08-23'
};
const idsOf = (s) => s.blockers.map(b => b.id).join();
finds.forEach(f => { f.status = 'accepted risk'; });
const risky = C.summary(finds, EO_FILE);
t('clear: accepted risk is NOT cleared', risky.acceptedRisk === finds.length &&
  risky.open === finds.length && risky.resolved === 0);
t('clear: accepted risk still blocks nothing but is disclosed',
  risky.eoReady === true && risky.disclosures.some(d => d.id === 'accepted-risk'));
finds[0].status = 'pending';
t('clear: one pending finding blocks E&O', !C.summary(finds, EO_FILE).eoReady);
finds.forEach(f => { f.status = 'cleared'; });
t('clear: cleared + full file → E&O ready', C.summary(finds, EO_FILE).eoReady);
t('clear: isResolved is the one rule', C.isResolved({ status: 'rewritten' }) &&
  !C.isResolved({ status: 'accepted risk' }) && !C.isResolved({ status: 'pending' }));
t('clear: no context → blockers say so rather than passing', (() => {
  const s = C.summary(finds);
  return !s.eoReady && !s.checked && s.blockers.filter(b => b.unknown).length === 3;
})());
t('clear: empty chain of title blocks', (() => {
  const s = C.summary(finds, Object.assign({}, EO_FILE, { rights: [] }));
  return !s.eoReady && idsOf(s).includes('chain');
})());
t('clear: an unexecuted agreement is a chain gap', (() => {
  const s = C.summary(finds, Object.assign({}, EO_FILE, {
    rights: EO_FILE.rights.concat([{ material: 'Archive clip', kind: 'Archival license', status: 'Negotiating' }]) }));
  return !s.eoReady && idsOf(s).includes('chain-gaps');
})());
t('clear: an unlicensed cue blocks E&O', (() => {
  const s = C.summary(finds, Object.assign({}, EO_FILE, {
    music: { cues: [{ title: 'Blue Moon', status: 'quoted' }] } }));
  return !s.eoReady && s.blockers.some(b => b.id === 'music' && /Blue Moon/.test(b.detail));
})());
t('clear: a replaced cue needs no licence', C.summary(finds, Object.assign({}, EO_FILE, {
  music: { cues: [{ title: 'Blue Moon', status: 'replaced' }] } })).eoReady);
t('clear: a festival-only licence is disclosed, not silent', (() => {
  const s = C.summary(finds, Object.assign({}, EO_FILE, {
    music: { cues: [{ title: 'Blue Moon', status: 'licensed', scope: 'festival' }] } }));
  return s.eoReady && s.disclosures.some(d => d.id === 'music-scope');
})());
t('clear: no E&O certificate blocks', (() => {
  const s = C.summary(finds, Object.assign({}, EO_FILE, { insurance: [] }));
  return !s.eoReady && idsOf(s).includes('eo-policy');
})());
t('clear: an expired E&O policy blocks', (() => {
  const s = C.summary(finds, Object.assign({}, EO_FILE, {
    insurance: [{ kind: 'E&O', carrier: 'Chubb', expiry: '2026-01-01' }] }));
  return !s.eoReady && s.blockers.some(b => /expired/i.test(b.label));
})());
t('clear: expiry is judged against the caller\'s date, never Date.now()', (() => {
  const late = C.summary(finds, Object.assign({}, EO_FILE, { todayISO: '2027-12-01' }));
  return !late.eoReady && C.summary(finds, EO_FILE).eoReady;
})());
t('clear: STATUSES is the shared vocabulary', C.STATUSES.length === 4 &&
  C.STATUSES.indexOf('accepted risk') >= 0 && C.RESOLVED.length === 2 && C.CHAIN_KINDS.length === 5);
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
/* Notes are notes against A CUT — a session that records no cut identity
   cannot say which picture was reviewed, and the screener registry next door
   cannot say what it sent. */
t('screen: a session with no cut says so plainly', R.cutLabel(sess) === 'unidentified cut');
const withCut = R.newSession(rs, 'DC2', 'HZ465', 'now',
  { id: 'nh-v3|91231', label: 'night-harvest-v3.mp4', version: 'v3', durSec: 5340 });
t('screen: newSession records the cut', withCut.cut.version === 'v3' && withCut.cut.durSec === 5340);
t('screen: cutLabel names it', R.cutLabel(withCut) === 'night-harvest-v3.mp4 v3');
t('screen: setCut re-identifies a session', (() => {
  R.setCut(sess, { label: 'night-harvest-v4.mp4', version: 'v4' });
  return R.cutLabel(sess) === 'night-harvest-v4.mp4 v4' && R.setCut(null, {}) === null;
})());
t('screen: normCut copes with junk', R.normCut(null).id === '' && R.normCut({ durSec: 'x' }).durSec === 0);
t('screen: the cut is on the exported notes', /night-harvest-v4/.test(R.exportText(sess)));
R.removeSession(rs, withCut.id);
t('screen: removeSession drops it', rs.sessions.length === 1);

/* ══ CDist ══ */
const dsx = X.blank();
t('dist: streamer needs everything', X.checklist(dsx).required === X.DELIVERABLES.length);
dsx.buyer = 'festival';
let ck = X.checklist(dsx);
t('dist: festival needs 5', ck.required === 5 && ck.pct === 0);
X.toggle(dsx, 'dcp'); X.toggle(dsx, 'trailer');
ck = X.checklist(dsx);
t('dist: progress tracks required only', ck.complete === 2 && ck.pct === 40);

/* ── exclusivity: territory × channel × TERM ──
   The old key was `territory|channel` lowercased with no dates, so it was
   wrong in both directions. Each row below is one of the three cases. */
const winStore = (rows) => { const s = X.blank(); rows.forEach(r => X.addWindow(s, r)); return s; };
const kinds = (s) => X.windowConflicts(s).map(c => c.kind).join();
t('dist: Worldwide/SVOD collides with Germany/SVOD', kinds(winStore([
  { territory: 'Worldwide', channel: 'SVOD', start: '2027-01-01', end: '2028-01-01' },
  { territory: 'Germany', channel: 'SVOD', start: '2027-06-01', end: '2027-12-01' }])) === 'overlap');
t('dist: "United States" collides with "USA"', kinds(winStore([
  { territory: 'United States', channel: 'Theatrical', start: '2027-01-01', window: '90 days' },
  { territory: 'USA', channel: 'Theatrical', start: '2027-02-01', window: '90 days' }])) === 'overlap');
t('dist: Canada 2027 and Canada 2035 do NOT collide', X.windowConflicts(winStore([
  { territory: 'Canada', channel: 'SVOD', start: '2027-01-01', window: '2 years' },
  { territory: 'Canada', channel: 'SVOD', start: '2035-01-01', window: '2 years' }])).length === 0);
t('dist: no term on record is reported, not guessed', kinds(winStore([
  { territory: 'Canada', channel: 'SVOD', start: '2027-01-01' },
  { territory: 'Canada', channel: 'SVOD', start: '2035-01-01' }])) === 'undated');
t('dist: North America contains the US; France does not', (() => {
  const hit = winStore([{ territory: 'North America', channel: 'SVOD', start: '2027-01-01', end: '2029-01-01' },
                        { territory: 'US', channel: 'SVOD', start: '2028-01-01', end: '2028-06-01' }]);
  const miss = winStore([{ territory: 'France', channel: 'SVOD', start: '2027-01-01', end: '2029-01-01' },
                         { territory: 'US', channel: 'SVOD', start: '2028-01-01', end: '2028-06-01' }]);
  return kinds(hit) === 'overlap' && X.windowConflicts(miss).length === 0;
})());
t('dist: "All media" swallows every channel, SVOD and Theatrical do not meet', (() => {
  const hit = winStore([{ territory: 'Canada', channel: 'All media', start: '2027-01-01', end: '2029-01-01' },
                        { territory: 'Canada', channel: 'AVOD', start: '2028-01-01', end: '2028-06-01' }]);
  const miss = winStore([{ territory: 'Canada', channel: 'Theatrical', start: '2027-01-01', end: '2029-01-01' },
                         { territory: 'Canada', channel: 'SVOD', start: '2028-01-01', end: '2028-06-01' }]);
  return kinds(hit) === 'overlap' && X.windowConflicts(miss).length === 0;
})());
t('dist: a non-exclusive grant never clashes', X.windowConflicts(winStore([
  { territory: 'Canada', channel: 'SVOD', start: '2027-01-01', end: '2028-01-01' },
  { territory: 'Canada', channel: 'SVOD', start: '2027-02-01', end: '2027-06-01', exclusive: false }])).length === 0);
t('dist: normTerritory folds the spellings', X.normTerritory('u.s.a.') === 'US' &&
  X.normTerritory('Worldwide') === 'WORLD' && X.normTerritory('Ruritania') === 'RURITANIA');
t('dist: normChannel folds TV onto broadcast', X.normChannel('television') === 'BROADCAST' &&
  X.normChannel(' svod ') === 'SVOD');
t('dist: territoryOverlap/channelOverlap are the two axes', X.territoryOverlap('DACH', 'Austria') &&
  !X.territoryOverlap('Japan', 'Brazil') && X.channelOverlap('Digital', 'TVOD') && !X.channelOverlap('DCP', 'SVOD'));
t('dist: parseTerm reads days/weeks/months/years and perpetuity',
  X.parseTerm('90 days') === 90 && X.parseTerm('2 weeks') === 14 &&
  Math.round(X.parseTerm('18 months')) === 548 && X.parseTerm('in perpetuity') === Infinity &&
  X.parseTerm('') === null && X.parseTerm('soon') === null);
t('dist: windowRange knows when it is undated', (() => {
  const a = X.windowRange({ start: '2027-01-01', window: '90 days' });
  const b = X.windowRange({ start: '2027-01-01' });
  return a.dated === true && b.dated === false && a.end - a.start === 90 && X.termsOverlap(a, b);
})());

/* ── the rights gate: what leaves the building ──
   A screener could go out carrying an unlicensed cue while the platform held
   every fact needed to stop it. rightsGate is that join. */
const MUSIC = { cues: [
  { id: 'm1', title: 'Blue Moon', status: 'identified' },
  { id: 'm2', title: 'Main Title', status: 'licensed', scope: 'all-media' },
  { id: 'm3', title: 'Bar Band', status: 'licensed', scope: 'festival' },
  { id: 'm4', title: 'Cut Cue', status: 'replaced' }] };
const CLEAR_OPEN = [
  { id: 'f1', cat: 'footage', term: 'news footage', risk: 'high', status: 'pending', sceneLabel: '4A', action: 'License it' },
  { id: 'f2', cat: 'signage', term: 'billboard', risk: 'low', status: 'pending', sceneLabel: '7', action: 'Greek it' },
  { id: 'f3', cat: 'brand', term: 'Coca-Cola', risk: 'medium', status: 'cleared', sceneLabel: '1', action: 'x' }];
const gate = X.rightsGate(MUSIC, CLEAR_OPEN, { scope: 'all-media', checkedAt: '2026-08-23' });
t('gate: an unlicensed cue blocks', gate.blockers.some(b => b.kind === 'music' && /Blue Moon/.test(b.label)));
t('gate: a replaced cue is not counted', gate.cues === 3 && !/Cut Cue/.test(JSON.stringify(gate)));
t('gate: a festival-only licence blocks an all-media send',
  gate.blockers.some(b => b.kind === 'music-scope' && /Bar Band/.test(b.label)));
t('gate: an open HIGH-risk finding blocks', gate.blockers.some(b => b.kind === 'clearance' && /4A/.test(b.label)));
t('gate: a low-risk finding cautions, a cleared one says nothing',
  gate.cautions.some(b => /billboard/.test(b.label)) && !/Coca-Cola/.test(JSON.stringify(gate)));
t('gate: blocked is blocked', gate.level === 'blocked' && gate.ok === false && /not cleared to leave/.test(gate.summary));
const festGate = X.rightsGate({ cues: [MUSIC.cues[1], MUSIC.cues[2]] }, [], { scope: 'festival' });
t('gate: a festival licence covers a festival screener',
  festGate.ok && festGate.level === 'caution' && festGate.cautions.length === 1);
t('gate: an accepted risk is a caution, not a block', X.rightsGate({ cues: [] },
  [{ id: 'f9', risk: 'high', status: 'accepted risk', cat: 'brand', term: 'Nike', sceneLabel: '3' }], {}).ok);
t('gate: nothing to check is clear', X.rightsGate(null, null, {}).level === 'clear');
t('gate: a bare cue array is accepted too', X.rightsGate([{ title: 'x', status: 'identified' }], [], {}).blockers.length === 1);
t('gate: scope defaults to all-media, bogus scope too',
  X.rightsGate(null, null, { scope: 'zap' }).scope === 'all-media' && X.SCOPES.length === 2);

/* ── the door ── */
const blocked = X.sendScreener(dsx, { recipient: 'A. Buyer', company: 'Festco', sentAt: '2026-08-23',
  cutId: 'nh-v3', cutLabel: 'night-harvest-v3.mp4' }, gate);
t('dist: a blocked cut is refused, and nothing is logged',
  blocked.refused === true && blocked.screener === null && dsx.screeners.length === 0);
const forced = X.sendScreener(dsx, { recipient: 'A. Buyer', company: 'Festco', sentAt: '2026-08-23',
  cutId: 'nh-v3', cutLabel: 'night-harvest-v3.mp4', overrideReason: 'Sales agent needs it; cues are being replaced' }, gate);
t('dist: an override is allowed and RECORDED', forced.ok && forced.overridden &&
  /Sales agent/.test(forced.screener.overrideReason));
t('dist: the screener records WHAT went out, not just who',
  forced.screener.cutLabel === 'night-harvest-v3.mp4' && forced.screener.cutId === 'nh-v3' &&
  forced.screener.rights.ok === false && forced.screener.rights.blockers.length === gate.blockers.length);
const cleanSend = X.sendScreener(dsx, { recipient: 'B. Programmer', sentAt: '2026-08-24',
  cutId: 'nh-v4', cutLabel: 'night-harvest-v4.mp4' }, X.rightsGate({ cues: [MUSIC.cues[1]] }, [], { scope: 'all-media' }));
t('dist: a clean cut goes straight out', cleanSend.ok && !cleanSend.overridden &&
  cleanSend.screener.rights.ok === true);
const scn = X.addScreener(dsx, { recipient: 'C. Late', company: 'Festco', sentAt: '2026-08-25' });
t('dist: screener logged unwatched', scn.watched === false && dsx.screeners.length === 3);
t('dist: removeRow clears either table', X.removeRow(dsx, scn.id) && dsx.screeners.length === 2);

console.log(`test_ops: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
