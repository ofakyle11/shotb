#!/usr/bin/env node
/* Node checks for the Projects vault, Boards and Production engines. */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'projects/lib-vault.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'boards/lib-shots.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'production/lib-prod.js'), 'utf8'));
const V = globalThis.CVault, S = globalThis.CShots, P = globalThis.CProd;

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

/* ── production: DPR ── */
{
  const d = P.dpr({
    takes: [{ scene: '12', take: 1, status: 'print', date: '2026-08-20' }, { scene: '12', take: 2, date: '2026-08-20' }, { scene: '14', take: 1, date: '2026-08-21' }],
    timecards: { rows: [{ name: 'AC', date: '2026-08-20' }, { name: 'Gaffer', date: '2026-08-20' }] },
    hotcost: [{ amount: '1200' }, { amount: 800 }],
    board: { scenes: [{ day: 0 }, { day: -1 }] },
    plan: { date: '2026-09-14' },
    timeline: { projectName: 'THE LAST DISPATCH' }
  }, { date: '2026-08-20', notes: 'Lost 1h to rain' });
  ok(d.project === 'THE LAST DISPATCH', 'dpr: project name');
  ok(d.scenesCovered.join() === '12', 'dpr: date-filtered scenes');
  ok(d.takeCount === 2 && d.printedCount === 1, 'dpr: takes + prints');
  ok(d.crewOnCards === 2, 'dpr: crew count');
  ok(d.hotCostTotal === 2000, 'dpr: hot-cost sum');
  const txt = P.dprText(d);
  ok(txt.includes('DAILY PRODUCTION REPORT') && txt.includes('Lost 1h to rain'), 'dpr: text render');
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
