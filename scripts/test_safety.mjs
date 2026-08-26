#!/usr/bin/env node
/* Node tests for safety/lib-safety.js (CSafety) — run: node scripts/test_safety.mjs
 *
 * Why this file exists at all: the module is 326 lines — the largest in its
 * slice — and had no suite of its own. It was not reported as a gap because
 * run_all_tests.mjs discovers suites by globbing scripts/test_*.mjs: a module
 * with no test file is not a failing suite, it is an absent one, and absences
 * do not appear in "44/44 passed". test_ops.mjs did load it and exercise the
 * hazard scan, but the animal department, the incident log and the wrangler
 * directory — a third of the public API — had never been called by anything.
 * scripts/test_assurance.mjs now reports both of those as failures.
 *
 * The fixture below deliberately carries the two input classes the suite used
 * to avoid: a FADE IN: preamble before the first slugline, and an A-scene
 * (1A) between 1 and 2. Both used to be why departments cited scene numbers
 * one off each other. Money values carry cents for the same reason.
 *
 * Known gap, named rather than pinned: analyze() reports `scene: sc.n`, so
 * scene 1 and scene 1A both come back as scene 1 (safety/lib-safety.js:110
 * carries the distinct `label`, and meetingChecklist/paidDutyNeeds at :147 and
 * :202 select on `scene`). A meeting scoped to "1" therefore also returns 1A's
 * hazards — over-inclusive, which is the safe direction for a safety document,
 * but wrong. That belongs to the scene-model wave, so the assertions below use
 * the labels, which are correct today, and do not pin the numbering.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/* The shared scene model loads first; lib-safety.js refuses to load without
   it and says so by name. Guarded so this suite reports a missing dependency
   rather than an unreadable stack trace. */
for (const dep of ['js/lib-scenes.js', 'safety/lib-safety.js']) {
  if (!existsSync(join(ROOT, dep))) {
    console.error(`test_safety: ${dep} is missing`);
    process.exit(1);
  }
  (0, eval)(readFileSync(join(ROOT, dep), 'utf8'));
}
const S = globalThis.CSafety;

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; } else { fail++; console.error('  ✗', name); } };

/* A preamble, an A-scene, and a hazard in every category we claim to find. */
const SCRIPT = `FADE IN:

A cold open over black. Titles.

1  EXT. RIVER ROAD - NIGHT

A car chase along the bank. Rain hammers down as Mara swims across the river.

1A  INT. BARN - NIGHT

Tom loads the shotgun. A fight breaks out; Hal falls from the loft.

2  EXT. MAIN STREET - DAY

A crowd gathers. A drone shot rises above the town. A horse bolts past the
diner as a candle catches the curtain and fire climbs the wall.

FADE OUT.`;

/* ══ 1 · the hazard table itself ══════════════════════════════════════════ */
{
  const H = S.HAZARDS;
  t('hazards: table is populated', Array.isArray(H) && H.length >= 10);
  t('hazards: ids are unique', new Set(H.map((h) => h.id)).size === H.length);
  t('hazards: every entry carries a matcher, a severity and controls',
    H.every((h) => h.re instanceof RegExp && [1, 2, 3].indexOf(h.sev) >= 0 &&
      Array.isArray(h.controls) && h.controls.length > 0));
  t('hazards: every entry names who is responsible',
    H.every((h) => typeof h.personnel === 'string' && h.personnel.length > 3));
  t('hazards: the stop-and-plan tier is the one with a licensed specialist',
    H.filter((h) => h.sev === 3).every((h) => /armorer|coordinator|pyrotechnician|safety officer/i.test(h.personnel)));
}

/* ══ 2 · analyze — the preamble and the A-scene ═══════════════════════════ */
const an = S.analyze(SCRIPT);
{
  t('analyze: the FADE IN: preamble is not counted as a scene', an.scenes === 3);
  t('analyze: all three real scenes are flagged', an.flagged.length === 3);
  const labels = an.flagged.map((f) => f.label);
  t('analyze: the A-scene survives with its own label', labels.join(',') === '1,1A,2');
  t('analyze: labels are distinct even where the numbers collide',
    new Set(labels).size === labels.length);

  const ids = (label) => (an.flagged.find((f) => f.label === label) || { hazards: [] }).hazards.map((h) => h.id);
  t('analyze: sc 1 — water, vehicles, night ext, rain/electrical',
    ['water', 'vehicles', 'night', 'electrical'].every((i) => ids('1').includes(i)));
  t('analyze: sc 1A — weapons and stunts', ids('1A').includes('weapons') && ids('1A').includes('stunts'));
  t('analyze: sc 1A is an interior, so no night-exterior flag', !ids('1A').includes('night'));
  t('analyze: sc 2 — crowds, aerial, animals and fire',
    ['crowds', 'aerial', 'animals', 'fire'].every((i) => ids('2').includes(i)));

  t('analyze: a scene score is the sum of its hazard severities',
    an.flagged.every((f) => f.score === f.hazards.reduce((a, h) => a + h.sev, 0)));
  t('analyze: the risk score is the sum of the scene scores',
    an.riskScore === an.flagged.reduce((a, f) => a + f.score, 0));
  t('analyze: specialist personnel are deduplicated',
    an.personnel.length === new Set(an.personnel).size && an.personnel.length >= 6);
  t('analyze: an empty script is not a crash', (() => {
    const e = S.analyze('');
    return e.scenes === 0 && e.flagged.length === 0 && e.riskScore === 0 && e.personnel.length === 0;
  })());
  t('analyze: a script with no hazards flags nothing',
    S.analyze('INT. EMPTY ROOM - DAY\n\nShe reads a book.').flagged.length === 0);
}

/* ══ 3 · the printable risk assessment ════════════════════════════════════ */
{
  const doc = S.assessmentText(an, 'Night Harvest', 'K. Francis', '2026-08-23');
  t('assessment: names the production, the author and the date',
    /Night Harvest/.test(doc) && /K\. Francis/.test(doc) && /2026-08-23/.test(doc));
  t('assessment: one block per flagged scene', an.flagged.every((f) => doc.includes('SCENE ' + f.scene)));
  t('assessment: severity is printed as a word, not a number',
    /\[HIGH\]/.test(doc) && /\[MED\]/.test(doc) && /\[LOW\]/.test(doc));
  t('assessment: every control measure reaches the page',
    an.flagged[0].hazards[0].controls.every((c) => doc.includes(c)));
  t('assessment: the responsible person is named against the hazard',
    /Responsible: Water safety officer/.test(doc));
  t('assessment: closes by handing the day back to the 1st AD', /1st AD/.test(doc));
  t('assessment: survives an empty analysis',
    typeof S.assessmentText(S.analyze(''), '', '', '') === 'string');
}

/* ══ 4 · the morning meeting checklist ════════════════════════════════════ */
{
  const all = S.meetingChecklist(an);
  t('meeting: always opens with exits, muster point and medic', /exits.*muster.*medic/i.test(all[0]));
  t('meeting: unscoped covers every flagged hazard',
    all.length === 1 + an.flagged.reduce((a, f) => a + f.hazards.length, 0));
  const day2 = S.meetingChecklist(an, [2]);
  t('meeting: scoping to a scene keeps that scene', day2.some((i) => /Sc 2/.test(i)));
  t('meeting: scoping to a scene drops the others', !day2.some((i) => /Sc 1/.test(i)));
  t('meeting: every line names who confirms the control', day2.slice(1).every((i) => /confirms controls in place/.test(i)));
  t('meeting: lines are deduplicated', new Set(all).size === all.length);
  t('meeting: an empty scene list means the whole schedule, not nothing',
    S.meetingChecklist(an, []).length === all.length);
}

/* ══ 5 · paid duty police — a directory that refuses to invent a URL ══════ */
{
  const entries = Object.keys(S.POLICE).map((k) => S.POLICE[k]);
  t('police: every entry names a city, a service and a program',
    entries.every((e) => e.city && e.service && e.program));
  t('police: a URL is either a real https link or explicitly null',
    entries.every((e) => e.url === null || /^https:\/\/[a-z0-9.-]+\//i.test(e.url)));
  t('police: no entry invents a phone number', entries.every((e) => !/\d{3}[-.\s]\d{3,4}/.test(JSON.stringify(e))));

  t('police: a city resolves', S.policeFor('Toronto').service === 'Toronto Police Service');
  t('police: an incentive id resolves to its hub', S.policeFor('ontario').city === 'Toronto, Canada');
  t('police: matching is case- and whitespace-insensitive',
    S.policeFor('  TORONTO  ').service === S.policeFor('toronto').service);
  t('police: a hyphenated key also matches its spelled-out city',
    S.policeFor('New York, USA').service === S.policeFor('new-york').service);
  t('police: a service we cannot link is present without a fabricated URL',
    S.policeFor('new-york').url === null && /NYPD/.test(S.policeFor('new-york').service));
  t('police: an unknown city returns null rather than a guess', S.policeFor('Smallville') === null);
  t('police: nothing at all returns null', S.policeFor('') === null && S.policeFor(null) === null);

  const link = S.policeSearchLink(null, 'Smallville, KS');
  t('search link: is a real search, not an invented service page', /^https:\/\/www\.google\.com\/search\?q=/.test(link));
  t('search link: carries the city and the intent', /Smallville/.test(decodeURIComponent(link)) && /paid duty/.test(decodeURIComponent(link)));
  t('search link: drops the country half of the city string', !/KS/.test(decodeURIComponent(link)));
  t('search link: uses the service name when we have one',
    /Toronto Police Service/.test(decodeURIComponent(S.policeSearchLink(S.policeFor('toronto'), 'Toronto'))));
}

/* ══ 6 · what triggers officers, and what they cost ═══════════════════════ */
{
  const needs = S.paidDutyNeeds(an);
  t('paid duty: an exterior car chase needs traffic control',
    needs.some((n) => /traffic control/i.test(n.why)));
  t('paid duty: a crowd needs crowd control', needs.some((n) => /Crowd control/i.test(n.why)));
  t('paid duty: every requirement cites the scene that caused it',
    needs.every((n) => n.scene != null && typeof n.why === 'string' && n.why.length > 10));
  t('paid duty: weapons INSIDE a barn do not summon police',
    !needs.some((n) => /Weapons visible in public/.test(n.why)));
  t('paid duty: weapons in the street do',
    S.paidDutyNeeds(S.analyze('EXT. MAIN STREET - DAY\n\nHe draws a pistol on the crowd.'))
      .some((n) => /Weapons visible in public/.test(n.why)));
  t('paid duty: nothing flagged means no officers', S.paidDutyNeeds(S.analyze('')).length === 0);

  /* Cents, deliberately: a paid-duty rate is quoted to the half-dollar and the
     old fixtures only ever used round hundreds. The assertions below test the
     arithmetic and tolerate the rounding policy, which the money wave owns. */
  const est = S.paidDutyEstimate({ officers: 2, hours: 8, rate: 92.55, days: 3 });
  t('estimate: per-day is officers × hours × rate, cents included',
    Math.abs(est.perDay - 2 * 8 * 92.55) < 1);
  t('estimate: the total is the per-day across the days plus the admin fee',
    Math.abs(est.total - 2 * 8 * 92.55 * 3 * 1.1) < 1.5);
  t('estimate: the admin percentage is reported, not buried', est.adminPct === 10);
  t('estimate: a fractional rate does not become a fractional total', Number.isInteger(est.total));
  t('estimate: the minimum call is enforced against a short day',
    S.paidDutyEstimate({ officers: 1, hours: 2, rate: 90 }).hours === 4);
  t('estimate: an explicit minimum call overrides the default',
    S.paidDutyEstimate({ officers: 1, hours: 2, rate: 90, minCall: 6 }).hours === 6);
  t('estimate: zero officers is still one officer', S.paidDutyEstimate({ officers: 0 }).officers === 1);
  t('estimate: no admin fee when the service does not charge one',
    S.paidDutyEstimate({ officers: 1, hours: 4, rate: 100, adminPct: 0 }).total === 400);
  t('estimate: junk input falls back to the documented defaults', (() => {
    const e = S.paidDutyEstimate({});
    return e.officers === 1 && e.hours === 4 && e.rate === 90 && e.days === 1;
  })());
}

/* ══ 7 · the animal department ════════════════════════════════════════════ */
{
  const species = S.ANIMAL_SPECIES;
  t('animals: the species table is populated and uniquely keyed',
    species.length >= 6 && new Set(species.map((s) => s.id)).size === species.length);
  t('animals: every species carries a low–high day range in order',
    species.every((s) => Array.isArray(s.day) && s.day.length === 2 && s.day[0] > 0 && s.day[1] >= s.day[0]));
  t('animals: every species requires a wrangler', species.every((s) => s.wrangler === true));
  t('animals: the restricted species carry the warning that matters',
    /banned|restricted|legal review/i.test((species.find((s) => s.id === 'exotic') || {}).note || ''));

  const found = S.animalsInScript(SCRIPT);
  t('animals: the horse in scene 2 is found', found.some((a) => a.species === 'horse'));
  t('animals: the finding cites the scene it came from',
    found.every((a) => a.scene != null && typeof a.species === 'string'));
  t('animals: a script with no animals finds none', S.animalsInScript('INT. ROOM - DAY\n\nShe waits.').length === 0);
  t('animals: species are matched on whole words, not substrings',
    S.animalsInScript('INT. ROOM - DAY\n\nThe catalogue sits on the table.').length === 0);

  const est = S.animalEstimate({ species: 'horse', days: 2, prepDays: 1, vet: true });
  t('estimate: the species is named back, not the id', est.species === 'Horse');
  t('estimate: the animal line is the midpoint day rate across the shoot days',
    est.animal === Math.round((500 + 1000) / 2 * 2));
  t('estimate: the wrangler is paid for prep days as well as shoot days',
    est.wrangler === Math.round((600 + 900) / 2 * 3));
  t('estimate: the vet is only on the shoot days', est.vet === Math.round((150 + 300) / 2 * 2));
  t('estimate: the total foots', est.total === est.animal + est.wrangler + est.vet);
  t('estimate: no vet means no vet line', S.animalEstimate({ species: 'horse', days: 2 }).vet === 0);
  t('estimate: an unknown species falls back rather than returning nothing',
    S.animalEstimate({ species: 'dragon', days: 1 }).total > 0);
  t('estimate: the restricted-species note travels with the estimate',
    /legal review/i.test(S.animalEstimate({ species: 'exotic', days: 1 }).note));

  const list = S.animalChecklist();
  t('checklist: is a real list', Array.isArray(list) && list.length >= 8);
  t('checklist: bans the two practices the standard bans',
    list.some((i) => /no sedation/i.test(i) && /tripping/i.test(i)));
  t('checklist: requires the coordinator to be the only handler',
    list.some((i) => /only they handle/i.test(i)));
  t('checklist: requires a current vet exam', list.some((i) => /vet/i.test(i)));
  t('checklist: puts animal action on the call sheet', list.some((i) => /call sheet/i.test(i)));

  t('wranglers: the directory only names houses we can stand behind',
    S.WRANGLERS.every((w) => w.name && w.hub && w.verified === true));
  const wl = S.wranglerSearchLink('Vancouver, Canada');
  t('wrangler link: is a search, not an invented listing', /^https:\/\/www\.google\.com\/search\?q=/.test(wl));
  t('wrangler link: carries the city without the country half',
    /Vancouver/.test(decodeURIComponent(wl)) && !/Canada/.test(decodeURIComponent(wl)));
  t('wrangler link: still works with no city at all', typeof S.wranglerSearchLink() === 'string');
}

/* ══ 8 · the incident log ═════════════════════════════════════════════════ */
{
  const store = S.blank();
  t('incidents: a blank store is versioned and empty',
    store.v === 1 && Array.isArray(store.incidents) && store.incidents.length === 0);

  const inc = S.addIncident(store, {
    date: '2026-08-20', scene: '1A', who: 'Hal Reyes', what: 'Slipped on the loft ladder',
    injury: true, action: 'Medic attended; ladder re-rigged', reportedBy: 'K. Francis, 1st AD',
  });
  t('incidents: the incident lands in the store', store.incidents.length === 1 && store.incidents[0] === inc);
  t('incidents: every field is carried through',
    inc.date === '2026-08-20' && inc.scene === '1A' && inc.who === 'Hal Reyes' &&
    /loft ladder/.test(inc.what) && /re-rigged/.test(inc.action) && /1st AD/.test(inc.reportedBy));
  t('incidents: injury is a boolean, so a near-miss cannot read as an injury', inc.injury === true);
  t('incidents: a near-miss records as no injury', S.addIncident(store, { what: 'Near miss' }).injury === false);
  t('incidents: an A-scene reference is kept verbatim, not coerced to a number', inc.scene === '1A');
  t('incidents: ids are unique across entries',
    new Set(store.incidents.map((i) => i.id)).size === store.incidents.length);
  t('incidents: a sparse report still produces a complete record', (() => {
    const bare = S.addIncident(store, {});
    return ['id', 'date', 'scene', 'who', 'what', 'injury', 'action', 'reportedBy']
      .every((k) => Object.prototype.hasOwnProperty.call(bare, k));
  })());
  t('incidents: two blank stores do not share an array',
    S.blank().incidents !== S.blank().incidents);
}

/* ══ 9 · the scene splitter this module exposes ═══════════════════════════ */
{
  const scenes = S.splitScenes(SCRIPT);
  t('split: the A-scene is one of the entries', scenes.some((s) => s.label === '1A'));
  t('split: the first real scene is numbered 1, not 2',
    (scenes.find((s) => s.slug && /RIVER ROAD/.test(s.slug)) || {}).label === '1');
  t('split: printed numbers are labels, not positions',
    scenes.filter((s) => s.slug).map((s) => s.label).join(',') === '1,1A,2');
  t('split: analyze() and splitScenes() agree on the real scenes',
    an.flagged.map((f) => f.label).join(',') === scenes.filter((s) => s.slug).map((s) => s.label).join(','));
}

console.log(`test_safety: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
