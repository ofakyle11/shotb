#!/usr/bin/env node
/* Node checks for Cast Intelligence (production/lib-cast.js) and the
 * Advisor (workflow/advisor.js). */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'production/lib-cast.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'workflow/advisor.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'timeline/timeline-doc.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'timeline/timeline-budget.js'), 'utf8'));
const C = globalThis.CCast, A = globalThis.CAdvisor, B = globalThis.SBBudget;

let failed = 0;
function ok(cond, name) {
  if (cond) console.log('  ok ', name);
  else { console.error('  FAIL', name); failed = 1; }
}

/* ── cast: TMDB parsers ── */
{
  const s = C.parseTmdbSearch({ results: [{ id: 2, name: 'B', popularity: 3 }, { id: 1, name: 'A', popularity: 30, known_for_department: 'Acting' }] });
  ok(s.id === 1 && s.name === 'A', 'tmdb: search picks most popular');
  ok(C.parseTmdbSearch({ results: [] }) === null, 'tmdb: empty search → null');

  const credits = C.parseTmdbActorCredits({ cast: [
    { id: 10, title: 'Old Film', release_date: '2015-01-01', character: 'Cop', order: 5, genre_ids: [28] },
    { id: 11, title: 'New Film', release_date: '2025-06-01', character: 'Lead', order: 0, genre_ids: [28, 18], popularity: 40 },
    { id: 12, title: 'Unreleased', release_date: '' }
  ] });
  ok(credits.length === 2 && credits[0].title === 'New Film', 'tmdb: actor credits sorted, dateless dropped');
  ok(credits[0].order === 0 && credits[0].genres.join() === '28,18', 'tmdb: billing + genres kept');

  const dir = C.parseTmdbDirectorCredits({ crew: [
    { id: 20, title: 'Directed', job: 'Director', release_date: '2022-01-01', genre_ids: [28] },
    { id: 21, title: 'Produced', job: 'Producer', release_date: '2023-01-01' }
  ] });
  ok(dir.length === 1 && dir[0].id === 20, 'tmdb: director filter keeps only Director jobs');

  const cast = C.parseTmdbFilmCast({ cast: [{ id: 5, name: 'X', order: 0 }] }, 20, 'Directed');
  ok(cast[0].filmTitle === 'Directed', 'tmdb: film cast carries film ref');
}

/* ── cast: Wikidata parsers ── */
{
  const q = C.wikidataActorQuery('Test "Actor"');
  ok(q.includes('wdt:P161') && !q.includes('"Test "Actor""'), 'wikidata: query built, quotes stripped');
  const parsed = C.parseWikidataActor({ results: { bindings: [
    { filmLabel: { value: 'Film One' }, year: { value: '2024' }, directorLabel: { value: 'Jane Doe' }, genreLabel: { value: 'drama film' } },
    { filmLabel: { value: 'Film One' }, year: { value: '2024' }, directorLabel: { value: 'Jane Doe' }, genreLabel: { value: 'thriller film' } },
    { filmLabel: { value: 'Q12345' } },
    { filmLabel: { value: 'Film Two' }, year: { value: '2019' }, directorLabel: { value: 'John Roe' } }
  ] } });
  ok(parsed.length === 2 && parsed[0].title === 'Film One', 'wikidata: films deduped + sorted');
  ok(parsed[0].directors.join() === 'Jane Doe' && parsed[0].genres.length === 2, 'wikidata: directors + genres merged');

  const d = C.parseWikidataDirector({ results: { bindings: [
    { filmLabel: { value: 'Film One' }, year: { value: '2024' }, castLabel: { value: 'Actor A' } },
    { filmLabel: { value: 'Film One' }, castLabel: { value: 'Actor B' } },
    { filmLabel: { value: 'Film Three' }, year: { value: '2020' }, castLabel: { value: 'Actor A' } }
  ] } });
  ok(d.films.length === 2 && d.collaborators[0].name === 'Actor A' && d.collaborators[0].films === 2, 'wikidata: director films + collaborator counts');
}

/* ── cast: fit ── */
{
  const actorFilms = [
    { id: 11, title: 'New Film', year: 2025, genres: [28, 18] },
    { id: 20, title: 'Directed', year: 2022, genres: [28] },
    { id: 10, title: 'Old Film', year: 2015, genres: [28] }
  ];
  const directorFilms = [
    { id: 20, title: 'Directed', year: 2022, genres: [28] },
    { id: 30, title: 'Other', year: 2018, genres: [28] }
  ];
  const f = C.fit({ actorFilms, directorFilms, nowYear: 2026, projectGenre: 'Action' });
  ok(f.direct === 1, 'fit: direct collaboration detected');
  ok(f.score > 50, 'fit: history + genre + recency scores high (' + f.score + ')');
  ok(f.reasons.some(r => r.includes('Directed')), 'fit: names the shared film');
  ok(f.reasons.some(r => /Recently active/.test(r)), 'fit: recency reason');

  const cold = C.fit({ actorFilms: [{ id: 99, title: 'X', year: 2010, genres: [35] }], directorFilms, nowYear: 2026 });
  ok(cold.direct === 0 && cold.score < f.score, 'fit: stranger scores lower');
  ok(cold.reasons.some(r => /2010/.test(r)), 'fit: stale credit flagged');

  const wd = C.fit({ actorFilms: [{ title: 'W', year: 2024, directors: ['Jane Doe'], genres: [] }], directorFilms: [], directorName: 'jane doe', nowYear: 2026 });
  ok(wd.direct === 1, 'fit: wikidata name-based direct match, case-insensitive');
}

/* ── cast: quote ── */
{
  ok(C.quote({ knownQuote: 300000 }).low === 300000, 'quote: known quote overrides');
  const newcomer = C.quote({ films: [{ year: 2024, order: 8 }], nowYear: 2026 });
  ok(newcomer.tier.includes('Scale'), 'quote: thin résumé → scale tier');
  const name = C.quote({ films: [
    { year: 2025, order: 1 }, { year: 2024, order: 0 }, { year: 2023, order: 3 }, { year: 2022, order: 1 }
  ], popularity: 15, nowYear: 2026 });
  ok(name.tier === 'Name', 'quote: repeated top billing → Name tier');
  const alist = C.quote({ films: [
    { year: 2025, order: 0 }, { year: 2024, order: 0 }, { year: 2023, order: 0 }, { year: 2022, order: 1 }, { year: 2021, order: 0 }
  ], popularity: 70, nowYear: 2026 });
  ok(alist.tier === 'A-list' && alist.high >= 20e6, 'quote: demand + billing → A-list band');
  ok(newcomer.basis.some(b => /1,204/.test(b)), 'quote: SAG scale floor stated');
  const sug = C.suggest([{ name: 'A', films: 3 }, { name: 'Me', films: 5 }, { name: 'B', films: 1 }], 'me', 5);
  ok(sug.length === 2 && sug[0].name === 'A', 'suggest: excludes self, keeps order');
}

/* ── advisor: looks ── */
{
  const looks = A.wantedLooks('EXT. DESERT HIGHWAY - DAY. Dunes to the horizon. Later, a neon-soaked downtown alley in the rain.', 'Thriller');
  ok(looks.includes('desert') && looks.includes('city') && looks.includes('rain'), 'looks: extracted from script (' + looks.join(',') + ')');
  ok(A.wantedLooks('', 'Western').includes('western'), 'looks: genre implies western');
}

/* ── advisor: locations (uses the real incentive table) ── */
{
  const recs = A.recommendLocations({
    budget: 10e6,
    looks: ['desert', 'smalltown'],
    incentives: B.INCENTIVES
  });
  ok(recs.length >= 15, 'locations: ranks the full table');
  const nm = recs.find(r => r.id === 'newmexico');
  ok(nm && nm.lookHits.includes('desert'), 'locations: New Mexico matches desert look');
  ok(recs.slice(0, 4).some(r => r.id === 'newmexico'), 'locations: NM ranks top-4 for a $10M desert film');
  ok(nm.recovery > 1e6, 'locations: recovery in dollars (' + nm.recovery + ')');
  const uk = A.recommendLocations({ budget: 50e6, looks: ['period'], incentives: B.INCENTIVES }).find(r => r.id === 'ukiftc');
  ok(uk && !uk.eligible && uk.reasons.some(x => /cap/.test(x)), 'locations: $50M film flagged over the UK indie cap');
  const small = A.recommendLocations({ budget: 3e5, looks: [], incentives: B.INCENTIVES }).find(r => r.id === 'california');
  ok(small && !small.eligible, 'locations: below-minimum spend flagged');
}

/* ── advisor: staffing ── */
{
  const a = { genre: 'Action', drivers: [{ key: 'stunts', count: 6 }, { key: 'water', count: 2 }], nightPct: 0.5, castTotal: 12 };
  const st = A.recommendStaffing({ analysis: a, scale: 'mid' });
  ok(st.plan.some(p => p.role.includes('Stunt coordinator')), 'staffing: stunts driver adds stunt coordinator');
  ok(st.plan.some(p => p.role.includes('Marine')), 'staffing: water driver adds marine unit');
  ok(st.plan.some(p => /Additional lighting/.test(p.role)), 'staffing: heavy nights add lighting crew');
  ok(st.plan.some(p => p.role === '2nd AD'), 'staffing: big cast adds 2nd AD');
  const indie = A.recommendStaffing({ analysis: {}, scale: 'indie' });
  ok(st.total > indie.total, 'staffing: mid scale staffs heavier than indie');
  const doc = A.recommendStaffing({ analysis: {}, mode: 'documentary' });
  ok(doc.plan.some(p => /Archival/.test(p.role)) && doc.total < indie.total, 'staffing: documentary is a lean unit');
}

/* ── advisor: prep actions ── */
{
  ok(A.prepActions({}).some(x => /No screenplay/.test(x.text)), 'prep: empty project → start at the Writer');
  const acts = A.prepActions({
    timeline: { scriptText: 'INT. A - NIGHT\n' + 'w '.repeat(300), clips: [{ videoUrl: 'u', status: 'done' }] },
    analysis: { nightCount: 4, uniqueLocations: 3 },
    sheet: { categories: [{ items: [{ est: 100 }] }] },
    budgetPrefs: { incentive: 'none' },
    roles: [{ status: 'Open' }, { status: 'Cast' }],
    locations: [{ permit: 'Applied' }],
    clearance: [{ status: 'Flagged' }]
  });
  const txt = acts.map(x => x.text).join('|');
  ok(/night scenes but no shoot-day plan/.test(txt), 'prep: night scenes without a day plan flagged');
  ok(/No tax jurisdiction/.test(txt), 'prep: missing incentive flagged');
  ok(/1 role still uncast/.test(txt), 'prep: open roles counted');
  ok(/permit/.test(txt), 'prep: pending permits high severity');
  ok(/clearance/.test(txt), 'prep: open clearances flagged');
  ok(/awaiting approval/.test(txt), 'prep: rendered-but-unapproved flagged');
  const done = A.prepActions({
    timeline: { scriptText: 'w '.repeat(300), clips: [{ videoUrl: 'u', status: 'approved' }] },
    sheet: { categories: [{ items: [{ est: 100 }] }] },
    budgetPrefs: { incentive: 'georgia' },
    roles: [{ status: 'Cast' }], crew: [{ name: 'x' }], insurance: [{ id: 1 }],
    cut: { project: { video: [{ id: 'v' }] } }
  });
  ok(done.length === 1 && done[0].sev === 'ok', 'prep: fully prepared project → all clear');
}

if (failed) { console.error('\nAdvisor checks FAILED'); process.exit(1); }
console.log('\nAll advisor checks passed.');
