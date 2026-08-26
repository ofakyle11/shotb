#!/usr/bin/env node
/* Node checks for the CINAMATE Workflow pipeline engine (workflow/workflow.js). */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/* The page loads the money engine ABOVE workflow.js (workflow/index.html), and
   the budget stage now asks CBudgetSheet for the subtotal rather than summing
   `est` itself. A suite that loads workflow.js alone leaves CBudgetSheet
   undefined and silently exercises the fallback — testing the old behaviour
   while the page runs the new one. Mirror the page. */
(0, eval)(readFileSync(join(ROOT, 'js/lib-money-math.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'js/lib-money-accounts.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'js/lib-money-sheet.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'workflow/workflow.js'), 'utf8'));
const W = globalThis.CWorkflow;

let failed = 0;
function ok(cond, name) {
  if (cond) console.log('  ok ', name);
  else { console.error('  FAIL', name); failed = 1; }
}
const byId = (a, id) => a.stages.find(s => s.id === id);

/* empty browser → everything todo, Develop is the active next step */
{
  const a = W.assess({});
  ok(a.stages.length === 7, 'empty: 7 stages');
  ok(a.overallPct === 0, 'empty: 0%');
  ok(a.nextUp && a.nextUp.id === 'develop', 'empty: next up is Develop');
  ok(byId(a, 'develop').status === 'active', 'empty: develop marked active');
  ok(byId(a, 'generate').status === 'todo', 'empty: generate still todo');
  ok(a.project === 'Untitled Film', 'empty: default project name');
}

/* script present (writer beats) → develop done, breakdown active */
{
  const a = W.assess({ writer: { proj: { title: 'THE SALT ROAD' }, scenes: [{ slug: 'EXT. FLATS - DAY', body: 'x' }] } });
  ok(byId(a, 'develop').status === 'done', 'writer: develop done');
  ok(a.nextUp.id === 'breakdown', 'writer: next is breakdown');
  ok(a.project === 'THE SALT ROAD', 'writer: project title from writer');
}

/* studio script text alone also counts */
{
  const a = W.assess({ timeline: { scriptText: 'INT. LAB - DAY\n' + 'action '.repeat(60) } });
  ok(byId(a, 'develop').status === 'done', 'scriptText: develop done');
}

/* clips parsed → breakdown done; generate/review reflect render state */
{
  const clips = [
    { num: 1, label: 'Opening', durationSec: 4, status: 'approved', videoUrl: 'blob:a' },
    { num: 2, label: 'The call', durationSec: 6, status: 'done', videoUrl: 'blob:b' },
    { num: 3, label: 'Highway', durationSec: 4, status: 'generating' },
    { num: 4, label: 'Finale', durationSec: 8 }
  ];
  const a = W.assess({
    timeline: {
      projectName: 'THE LAST DISPATCH', scriptText: 'INT. A - DAY\n' + 'w '.repeat(200),
      clips, characters: [{ name: 'MARA' }], locationBible: { HIGHWAY: {} }
    },
    localGpu: { url: 'http://127.0.0.1:3456' }
  });
  ok(byId(a, 'breakdown').status === 'done', 'clips: breakdown done');
  ok(byId(a, 'breakdown').metrics.join().includes('4 clips'), 'clips: clip count metric');
  ok(byId(a, 'generate').status === 'active', 'clips: generate active while rendering');
  ok(byId(a, 'generate').metrics.join().includes('2/4 rendered'), 'clips: rendered ratio');
  ok(byId(a, 'generate').metrics.join().includes('1 rendering now'), 'clips: generating count');
  ok(byId(a, 'review').metrics.join().includes('1/4 approved'), 'clips: approved ratio');
  ok(a.clips.length === 4, 'clips: board rows');
  ok(a.clips[2].status === 'generating' && a.clips[3].status === 'queued', 'clips: board statuses');
  ok(a.checks.bridge === 'http://127.0.0.1:3456', 'clips: bridge check carries url');
  ok(a.nextUp.id === 'budget', 'clips: next gap is budget');
}

/* every clip rendered + approved → generate and review done */
{
  const clips = [
    { num: 1, status: 'approved', videoUrl: 'u1' },
    { num: 2, status: 'approved', videoUrl: 'u2' }
  ];
  const a = W.assess({ timeline: { scriptText: 'w '.repeat(200), clips } });
  ok(byId(a, 'generate').status === 'done', 'approved: generate done');
  ok(byId(a, 'review').status === 'done', 'approved: review done');
}

/* budget top sheet: totals + contingency + documentary mode */
{
  const a = W.assess({
    sheet: {
      contingencyPct: 10,
      categories: [
        { items: [{ est: 500000, actual: 120000 }, { est: 250000 }] },
        { items: [{ est: 250000 }] }
      ]
    },
    budgetPrefs: { mode: 'documentary' }
  });
  const b = byId(a, 'budget');
  ok(b.status === 'done', 'budget: done with totals');
  ok(b.metrics.join().includes('$1,100,000'), 'budget: grand total with contingency (' + b.metrics[0] + ')');
  ok(b.metrics.join().includes('Documentary'), 'budget: documentary mode shown');
  ok(b.metrics.join().includes('$120,000 actuals'), 'budget: actuals surfaced');
  ok(a.mode === 'Documentary', 'budget: top-level mode');
}

/* schedule: boarded scenes + day count + plan date */
{
  const a = W.assess({
    board: { scenes: [{ day: 0 }, { day: 0 }, { day: 1 }, { day: -1 }] },
    plan: { date: '2026-09-14' }
  });
  const sch = byId(a, 'schedule');
  ok(sch.status === 'done', 'schedule: done when boarded');
  ok(sch.metrics.join().includes('3/4 scenes boarded'), 'schedule: boarded ratio');
  ok(sch.metrics.join().includes('2 shoot days'), 'schedule: distinct day count');
  ok(sch.metrics.join().includes('Day 1: 2026-09-14'), 'schedule: start date from planner');
}

/* deliver checklist */
{
  const a = W.assess({
    timeline: { scriptText: 'w '.repeat(200), clips: [{ num: 1, status: 'approved', videoUrl: 'u' }] },
    captions: [{ start: 0 }],
    credits: { text: 'CREW' },
    epk: { title: 'X' }
  });
  const d = byId(a, 'deliver');
  ok(d.status === 'done', 'deliver: all four steps done');
  ok(d.checklist.every(c => c.ok), 'deliver: checklist all ok');
  ok(a.overallPct > 40, 'deliver: overall pct reflects progress');
  ok(byId(a, 'budget').status === 'active' || a.nextUp.id === 'budget', 'deliver: budget still the gap');
}

/* full pipeline → 100%, no next up */
{
  const a = W.assess({
    writer: { proj: { title: 'T' }, scenes: [{}] },
    timeline: { scriptText: 'w '.repeat(200), clips: [{ num: 1, status: 'approved', videoUrl: 'u' }], characters: [{}], locationBible: {} },
    sheet: { contingencyPct: 0, categories: [{ items: [{ est: 100 }] }] },
    board: { scenes: [{ day: 0 }] },
    captions: [{}], credits: { text: 'x' }, epk: { a: 1 }
  });
  ok(a.overallPct === 100, 'full: 100%');
  ok(a.nextUp === null, 'full: nothing next');
  ok(a.stages.every(s => s.status === 'done'), 'full: all stages done');
}

/* malformed stores never throw */
{
  let threw = false;
  try { W.assess({ timeline: 'garbage', sheet: 42, board: { scenes: 'no' }, writer: null }); }
  catch (e) { threw = true; }
  ok(!threw, 'robust: malformed stores tolerated');
}

/* editor cut export satisfies the Final export step */
{
  const a = W.assess({ cut: { lastExport: { when: 'x', res: '1280x720' } } });
  const d = a.stages.find(s => s.id === 'deliver');
  ok(d.checklist.find(c => c.key === 'export').ok, 'deliver: cut export counts as final export');
}


/* ── a calculator-entered budget is not an empty budget ───────────────
   The budget stage summed `it.est` directly. js/lib-money-sheet.js computes an
   item as rate × amt × units whenever all three are set and falls back to the
   stored `est` only otherwise, so a line entered through the Amt × Units ×
   Rate calculator has a real value and — until the sheet is saved and the
   estimate written back — an `est` of zero.

   A live $400,000 top sheet therefore read as 0, which is not a cosmetic
   miscount: it drove the stage to "active", the metric to "Seed the top sheet
   from the script estimate", and the hint to "⚡ Seed from script estimate" —
   and seeding DELETES every line item. The Workflow told an operator their
   budget was empty and pointed them at the control that would make it true. */
{
  const calcSheet = {
    contingencyPct: 10,
    categories: [{ acct: '2000', name: 'Camera', items: [
      /* Cents, and deliberately NOT round: 3 × 5 × $1061.64 is the exact case
         budget-sheet.js cites for the float bug — a raw float writes
         15924.599999999999 into a cell the producer then sums. A fixture of
         round hundreds would pass whether or not the arithmetic handles it. */
      { desc: 'Operator', amt: 3, units: 5, rate: 106164, actual: 1592461 },
    ] }],
  };
  const a = W.assess({ sheet: calcSheet, timeline: { clips: [{ id: 1 }] } });
  const budget = a.stages.find((x) => x.id === 'budget');
  ok(!!budget, 'the budget stage exists');
  ok(budget.status === 'done',
    'a calculator-entered budget reads as done, not empty  (got ' + budget.status + ')');
  ok(!budget.hint.includes('Seed from script estimate'),
    'it does not advise seeding — which would delete the line items  (' + budget.hint + ')');
  ok(budget.metrics.some((m) => /grand total/.test(m || '')),
    'the grand total is reported  (' + JSON.stringify(budget.metrics) + ')');
  ok(budget.metrics.some((m) => /actuals posted/.test(m || '')),
    'actuals are reported through actualTotal, not dropped  (' + JSON.stringify(budget.metrics) + ')');

  /* Counter-assertion: a genuinely empty sheet must STILL read as empty, or
     the fix would have simply disabled the check. */
  const empty = W.assess({ sheet: { categories: [] }, timeline: { clips: [{ id: 1 }] } });
  const eb = empty.stages.find((x) => x.id === 'budget');
  ok(eb.status !== 'done', 'a genuinely empty sheet still reads as not done');
  ok(eb.hint.includes('Seed from script estimate'), 'and still advises seeding');
}

if (failed) { console.error('\nWorkflow checks FAILED'); process.exit(1); }
console.log('\nAll workflow checks passed.');
