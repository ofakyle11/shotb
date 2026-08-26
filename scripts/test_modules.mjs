#!/usr/bin/env node
/* Node checks for the Projects vault, Boards and Production engines. */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'projects/lib-vault.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'boards/lib-shots.js'), 'utf8'));
/* lib-prod.js cuts audition sides with the one scene model, and joins the
   day through the shoot-day record — both are load-order requirements it
   throws on, exactly as the browser loads them. */
(0, eval)(readFileSync(join(ROOT, 'js/lib-scenes.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'js/lib-shootdays.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'production/lib-prod.js'), 'utf8'));
const V = globalThis.CVault, S = globalThis.CShots, P = globalThis.CProd, SD = globalThis.CShootDays;

let failed = 0;
function ok(cond, name) {
  if (cond) console.log('  ok ', name);
  else { console.error('  FAIL', name); failed = 1; }
}

/* fake localStorage */
function fakeStore(init) {
  const data = Object.assign({}, init || {});
  return {
    _data: data,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
  };
}

/* ── vault ── */
{
  const st = fakeStore({
    SB_Timeline_v1: '{"projectName":"A"}',
    SB_Cut_v1: '{"x":1}',
    CIN_Other: 'no',
    SB_bad: 'no'
  });
  const snap = V.snapshot(st);
  ok(Object.keys(snap).sort().join() === 'SB_Cut_v1,SB_Timeline_v1', 'vault: snapshot only project keys');
  const arch = V.archive(st, 'Test Film', '2026-08-20');
  const parsed = V.parseArchive(arch);
  ok(parsed.format === 'cinamate/1' && parsed.name === 'Test Film', 'vault: archive header');
  ok(parsed.stores.SB_Timeline_v1 === '{"projectName":"A"}', 'vault: archive carries raw store');

  const st2 = fakeStore({ SB_Stale_v1: 'old' });
  const n = V.restore(st2, arch);
  ok(n === 2, 'vault: restore writes 2 keys');
  ok(st2.getItem('SB_Stale_v1') === null, 'vault: restore clears stale keys');
  ok(st2.getItem('SB_Timeline_v1') === '{"projectName":"A"}', 'vault: restore round-trips');
  let threw = '';
  try { V.parseArchive('{"nope":1}'); } catch (e) { threw = e.message; }
  ok(/archive/i.test(threw), 'vault: bad archive rejected');
}
{
  const st = fakeStore({ SB_Timeline_v1: '"film-A"' });
  V.switchTo(st, 'Film B', 'd1');
  ok(st.getItem('SB_Timeline_v1') === null, 'vault: switch clears workspace');
  const m1 = V.meta(st);
  ok(m1.active === 'Film B' && m1.slots['Project 1'].stores.SB_Timeline_v1 === '"film-A"', 'vault: switch stashed previous project');
  st.setItem('SB_Timeline_v1', '"film-B"');
  V.switchTo(st, 'Project 1', 'd2');
  ok(st.getItem('SB_Timeline_v1') === '"film-A"', 'vault: switch back restores A');
  ok(V.meta(st).slots['Film B'].stores.SB_Timeline_v1 === '"film-B"', 'vault: B stashed on the way out');
  V.renameActive(st, 'Feature One');
  ok(V.meta(st).active === 'Feature One' && V.meta(st).slots['Feature One'], 'vault: rename active');
  let err = '';
  try { V.deleteSlot(st, 'Feature One'); } catch (e) { err = e.message; }
  ok(/active/i.test(err), 'vault: cannot delete active');
  V.deleteSlot(st, 'Film B');
  ok(!V.meta(st).slots['Film B'], 'vault: delete slot');
  const inv = V.inventory(V.snapshot(st));
  ok(inv.count === 1 && inv.bytes > 5, 'vault: inventory sizes');
}

/* ── boards ── */
{
  const scenes = S.seedScenes({ clips: [{ num: 1, label: 'Opening' }, { num: 2, label: 'Chase' }] }, null);
  ok(scenes.length === 2 && scenes[0].slug.includes('SC01') && scenes[0].slug.includes('Opening'), 'boards: seed from studio clips');
  const fromWriter = S.seedScenes(null, { scenes: [{ slug: 'EXT. FLATS - DAY', body: 'x'.repeat(300) }] });
  ok(fromWriter.length === 1 && fromWriter[0].slug === 'EXT. FLATS - DAY' && fromWriter[0].desc.length === 200, 'boards: seed from writer beats');
  const cov = S.suggestCoverage({ id: 's1' }, ['MARA', 'HANK']);
  ok(cov.length === 4, 'boards: coverage master + 2 singles + insert');
  ok(cov[0].desc.includes('Master') && cov[1].desc.includes('MARA') && cov[3].size === 'INSERT', 'boards: coverage roles');
  const proj = { scenes: [{ id: 's1', slug: 'SC01', shots: [Object.assign(S.blankShot('a'), { img: 'data:x', dur: 3 }), S.blankShot('b')] }] };
  ok(S.shotCount(proj) === 2 && S.totalDur(proj) === 5, 'boards: counts + duration');
  ok(S.animaticPlan(proj).length === 1, 'boards: animatic keeps only framed shots');
  ok(S.animaticPlan(proj, true).length === 2, 'boards: includeEmpty renders slates');
  ok(S.animaticPlan(proj)[0].dur === 3 && S.animaticPlan(proj)[0].label.includes('SC01'), 'boards: frame timing + label');
  const csv = S.toCsv(proj);
  ok(csv.split('\n').length === 3 && csv.includes('"Lens (mm)"'), 'boards: csv rows');
}

/* ── production: DPR ──────────────────────────────────────────────────────
   The fixture this replaced invented `{scene,take,status:'print',date}` — a
   shape NO writer of SB_TakeLog_v1 has ever produced. The only writer is the
   TCore.Register at tools/tools-media-ui.js:38, whose fields are
   [day,time,scene,take,roll,grade,note], and a circled take is the <select>
   option string 'Circled ⭕' in `grade`. Because the fixture invented `status`
   and `date`, the suite went green while the shipped report filtered on a
   field nobody wrote (so every take counted on every day) and counted prints
   on two more (so printedCount was permanently 0). Every row below is the
   shape a real writer emits, and the writer is named. */
{
  /* tools/tools-media-ui.js:38 — the take-log Register. */
  const takeLog = [
    { id: 'r1', day: '2026-08-20', time: '09:12', scene: '12', take: '1', roll: 'A001', grade: '—', note: '' },
    { id: 'r2', day: '2026-08-20', time: '09:20', scene: '12', take: '2', roll: 'A001', grade: 'Circled ⭕', note: 'print' },
    { id: 'r3', day: '2026-08-21', time: '08:40', scene: '14', take: '1', roll: 'A002', grade: 'Good', note: '' }
  ];
  /* dailies/index.html:185 → CDailies.makeTake, wrapped in {days,takes,cur}. */
  const dailies = {
    cur: { date: '2026-08-20', unit: 'MAIN' },
    days: [{ date: '2026-08-20', unit: 'MAIN' }],
    takes: [
      { id: 'd1', day: '2026-08-20', scene: '13', slate: '13A', take: 1, camera: 'A', circled: true, ngReason: '', notes: 'the one', soundRoll: 'S1', lens: '35', tcIn: '' },
      { id: 'd2', day: '2026-08-21', scene: '14', slate: '14A', take: 1, camera: 'B', circled: false, ngReason: 'plane', notes: '', soundRoll: 'S2', lens: '50', tcIn: '' }
    ]
  };
  /* producer/schedule-board.js:84 — strips; day -1 is the boneyard. */
  const board = { scenes: [
    { id: 'sc12', num: 12, heading: 'INT. DINER - NIGHT', eighths: 12, day: 0 },
    { id: 'sc13', num: 13, heading: 'EXT. LOT - NIGHT', eighths: 6, day: 0 },
    { id: 'sc15', num: 15, heading: 'INT. STUDY - DAY', eighths: 8, day: 0 },
    { id: 'sc14', num: 14, heading: 'EXT. RIVER - DUSK', eighths: 4, day: 1 },
    { id: 'sc16', num: 16, heading: 'INT. CAR - DAY', eighths: 3, day: -1 }
  ] };
  /* tools/sched-weather.js:105 — the day plan. 2026-08-20 is a Thursday. */
  const plan = { date: '2026-08-20', city: 'la', lat: 34.05, lon: -118.24, skipWk: true, n: '' };
  const shootDays = SD.build(plan, board, { dailies: dailies });
  const stores = {
    takes: takeLog, dailies: dailies,
    timecards: { rows: [{ name: 'AC', date: '2026-08-20' }, { name: 'Gaffer', date: '2026-08-20' }] },
    hotcost: [{ amount: '1200' }, { amount: 800 }],
    board: board, plan: plan, shootDays: shootDays,
    timeline: { projectName: 'THE LAST DISPATCH' }
  };
  const d = P.dpr(stores, { date: '2026-08-20', notes: 'Lost 1h to rain' });
  ok(d.project === 'THE LAST DISPATCH', 'dpr: project name');
  ok(d.dayIdx === 0 && d.dayLabel === 'Day 1', 'dpr: the date resolves to a shoot day');
  ok(d.scenesCovered.join() === '12,13', 'dpr: scenes covered come from BOTH take stores, that day only');
  ok(d.takeCount === 3, 'dpr: takes on the day, across both stores');
  ok(d.printedCount === 2, 'dpr: circled takes counted from grade AND the boolean');
  ok(d.crewOnCards === 2, 'dpr: crew count');
  ok(d.hotCostTotal === 2000, 'dpr: hot-cost sum');
  ok(d.scheduledScenes === 3 && d.scheduledSceneNums.join() === '12,13,15', 'dpr: scheduled is THIS day, not the whole board');
  ok(d.scenesShot === 2 && d.scenesUnshot.join() === '15', 'dpr: scheduled vs shot');
  ok(d.pagesScheduled === 26, 'dpr: eighths scheduled for the day');
  ok(d.dayOneDate === '2026-08-20', 'dpr: day one from the plan');

  const d2 = P.dpr(stores, { date: '2026-08-21', notes: '' });
  ok(d2.dayIdx === 1 && d2.takeCount === 2 && d2.printedCount === 0, 'dpr: the next day is a different day');
  ok(d2.scenesCovered.join() === '14', 'dpr: yesterday does not bleed into today');

  /* A Saturday: no strips, no takes, and the report says so instead of
     reporting the entire schedule as scheduled. */
  const d3 = P.dpr(stores, { date: '2026-08-22', notes: '' });
  ok(d3.dayIdx === -1 && d3.scheduledScenes === 0 && d3.takeCount === 0, 'dpr: a date that is not a shoot day');

  /* A take with no day — the shape still sitting in real browsers from before
     the take log carried one — is on no report, and is reported as such. */
  const d4 = P.dpr(Object.assign({}, stores, {
    takes: takeLog.concat([{ id: 'r0', time: '17:44', scene: '99', take: '1', roll: 'A000', grade: 'Circled ⭕', note: '' }])
  }), { date: '2026-08-20', notes: '' });
  ok(d4.takeCount === 3 && d4.undatedTakes === 1, 'dpr: an undated take counts on no day and is flagged');

  const txt = P.dprText(d);
  ok(txt.includes('DAILY PRODUCTION REPORT') && txt.includes('Lost 1h to rain'), 'dpr: text render');
  ok(txt.includes('Day 1') && txt.includes('shot 2/3') && txt.includes('NOT SHOT: 15'), 'dpr: text carries the day and the shortfall');
  ok(P.dprText(d4).includes('carry no shoot day'), 'dpr: text names the undated takes');

  /* ── the join, checked against the record rather than restated ──────────
     The report's numbers have to be the shoot-day record's numbers; if the
     two ever answer differently, the DPR is fiction again. So the assertions
     below compare dpr's output to what CShootDays says directly, through the
     same store objects the page hands both of them. */
  ok(SD.indexForDate(shootDays, '2026-08-20') === d.dayIdx, 'dpr/join: the report resolves the day the record does');
  ok(SD.byIndex(shootDays, d.dayIdx).date === d.date, 'dpr/join: index and date are two names for one day');
  ok(SD.firstShootDate(plan) === d.dayOneDate, 'dpr/join: day one is the plan\'s, weekend rule included');
  ok(SD.scheduledOn(board, 0).length === d.scheduledScenes, 'dpr/join: scheduled is scheduledOn(board, day)');
  const takeStores = { takeLog: takeLog, dailies: dailies };
  ok(SD.takesOn(takeStores, '2026-08-20').length === d.takeCount, 'dpr/join: takes are takesOn(date), both stores');
  ok(SD.circledTakes(SD.takesOn(takeStores, '2026-08-20')).length === d.printedCount, 'dpr/join: prints are the circled takes');
  ok(SD.allTakes(takeStores).length === 5 && SD.allTakes(takeStores).length > d.takeCount,
    'dpr/join: the whole log is bigger than one day — which is what the old report reported');

  /* sync() is the call the page makes; the report must read the same record. */
  const ls = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); } };
  ls.setItem('SB_ShootPlan_v1', JSON.stringify(plan));
  ls.setItem('SB_ScheduleBoard_v1', JSON.stringify(board));
  ls.setItem('SB_Dailies_v1', JSON.stringify(dailies));
  const synced = SD.sync(ls);
  ok(synced.length === 2 && synced[0].date === '2026-08-20', 'dpr/join: sync builds the record the page passes in');
  ok(P.dpr(Object.assign({}, stores, { shootDays: synced }), { date: '2026-08-20' }).dayIdx === 0,
    'dpr/join: the report reads a synced record the same way');
}

/* ── production: timecode ────────────────────────────────────────────────
   tcOf stamps the cue sheet a PRO will be sent; it had never been called by a
   suite in its own right, only through cueSheet. */
{
  ok(P.tcOf(0) === '00:00:00:00', 'tcOf: zero');
  ok(P.tcOf(1.5) === '00:00:01:12', 'tcOf: half a second at 24fps is 12 frames');
  ok(P.tcOf(3661.5, 30) === '01:01:01:15', 'tcOf: hours, minutes and frames at 30fps');
  ok(P.tcOf(1, 25) === '00:00:01:00', 'tcOf: fps is honoured');
}

/* ── production: cue sheet ── */
{
  const cues = P.cueSheet({ project: { fps: 24, audio: [
    { label: 'Main theme', start: 0, in: 0, out: 30 },
    { label: 'Chase', start: 45.5, in: 2, out: 62 }
  ] } });
  ok(cues.length === 2, 'cues: two cues');
  ok(cues[0].tcIn === '00:00:00:00' && cues[0].tcOut === '00:00:30:00', 'cues: first timing');
  ok(cues[1].tcIn === '00:00:45:12' && cues[1].durSec === 60, 'cues: second timing with frames');
  const csv = P.cueCsv(cues);
  ok(csv.includes('"Cue title"') && csv.includes('"Main theme"'), 'cues: csv');
}

/* ── production: sides ── */
{
  const script = 'INT. DINER - NIGHT\n\nEDIE wipes the counter.\n\nEDIE\nWe are closed.\n\nEXT. ROAD - DAY\n\nA truck rolls by.\n\nINT. KITCHEN - DAY\n\nEDIE and HANK argue.';
  const sides = P.sidesFor(script, 'Edie');
  ok(sides.length === 2, 'sides: scenes containing the character');
  ok(sides[0].slug.includes('DINER') && sides[1].slug.includes('KITCHEN'), 'sides: correct scenes');
  ok(P.sidesFor(script, 'NOBODY').length === 0, 'sides: absent character → none');
}

/* ── production: residuals ── */
{
  const r = P.residuals({ svod: 1000000, tv: 500000, homeVideo: 200000 });
  ok(r.base === 1540000, 'residuals: base with 20% home-video royalty convention');
  ok(r.lines.length === 4, 'residuals: four guild lines');
  const sag = r.lines.find(l => l.guild.includes('SAG'));
  ok(sag.amount === Math.round(1540000 * 0.036), 'residuals: SAG line math');
  ok(r.total === r.lines.reduce((a, l) => a + l.amount, 0), 'residuals: total sums lines');
  ok(P.residuals({}).total === 0, 'residuals: zero gross → zero');
}

/* ── production: delivery template ── */
{
  const t = P.deliveryTemplate();
  ok(t.length >= 18, 'delivery: full checklist');
  ok(t.every(x => x.status === 'todo' && x.group && x.item), 'delivery: item shape');
  ok(t.some(x => x.item.includes('cue sheet')) && t.some(x => x.item.includes('Chain of title')), 'delivery: key items present');
}

if (failed) { console.error('\nModule checks FAILED'); process.exit(1); }
console.log('\nAll module checks passed.');
