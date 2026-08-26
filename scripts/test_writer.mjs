#!/usr/bin/env node
/* Node checks for the CINAMATE Writer treatment engine (writer/lib-treatment.js). */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'writer/lib-treatment.js'), 'utf8'));
const T = globalThis.TWriter;

let failed = 0;
function ok(cond, name) {
  if (cond) console.log('  ok ', name);
  else { console.error('  FAIL', name); failed = 1; }
}

/* entities */
ok(T.decodeEntities('Tom &amp; Jerry &#8212; &quot;hi&quot;') === 'Tom & Jerry — "hi"', 'entity decode');

/* OOXML paragraphs */
const XML = '<w:document><w:body>' +
  '<w:p><w:r><w:t>THE LAST DISPATCH</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>by </w:t></w:r><w:r><w:t xml:space="preserve">Kyle F.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>ACT ONE</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Mara drives the empty highway</w:t><w:tab/><w:t>at night.</w:t></w:r></w:p>' +
  '</w:body></w:document>';
const paras = T.docxParagraphs(XML);
ok(paras.length === 4, 'docx: 4 paragraphs');
ok(paras[0] === 'THE LAST DISPATCH', 'docx: title paragraph joined');
ok(paras[1] === 'by Kyle F.', 'docx: split runs joined');
ok(paras[3] === 'Mara drives the empty highway at night.', 'docx: tab becomes space');

/* cleanText */
ok(T.cleanText('a good deci-\nsion made') === 'a good decision made', 'clean: de-hyphenate wraps');
ok(T.cleanText('line one\nline two\n\nnext para').split('\n\n').length === 2, 'clean: rebuild paragraphs');
ok(!/Page 3 of 12/.test(T.cleanText('text here\nPage 3 of 12\nmore text')), 'clean: drop page numbers');

/* heading detection */
ok(T.isHeadingLine('ACT TWO'), 'heading: ACT');
ok(T.isHeadingLine('INT. WAREHOUSE - NIGHT'), 'heading: slugline');
ok(T.isHeadingLine('3. THE HEIST'), 'heading: numbered');
ok(T.isHeadingLine('THE RECKONING'), 'heading: all caps');
ok(!T.isHeadingLine('Mara walks into the warehouse.'), 'heading: prose is not');
ok(!T.isHeadingLine('IT WAS THE BEST OF TIMES. IT WAS THE WORST OF TIMES. IT WAS EVERYTHING.'), 'heading: caps run-on sentences rejected');

/* slug guessing */
ok(T.guessSlug('INT. LAB - DAY', '') === 'INT. LAB - DAY', 'slug: passthrough');
ok(/ - NIGHT$/.test(T.guessSlug('int. lab', 'They hide until midnight.')), 'slug: tod appended from body');
const s1 = T.guessSlug('THE ROOFTOP', 'Wind screams across the rooftop at dusk. Mara waits in the dark.');
ok(/^EXT\./.test(s1) && / - NIGHT$/.test(s1), 'slug: EXT + NIGHT inferred (' + s1 + ')');
const s2 = T.guessSlug('3. THE INTERROGATION', 'A windowless room. HANK circles the table inside.');
ok(/^INT\./.test(s2) && /THE INTERROGATION/.test(s2), 'slug: INT + numbered heading cleaned (' + s2 + ')');

/* characters */
const who = T.extractCharacters('MARA (30s) enters. Hank follows Mara inside. HANK lights a cigarette.');
ok(who.includes('MARA') && who.includes('HANK'), 'characters: caps + repeats found');
ok(!who.includes('THE'), 'characters: stopwords excluded');

/* full treatment parse */
const TREATMENT = [
  'THE LAST DISPATCH',
  '', 'by Kyle Francis', '',
  'LOGLINE: A night-shift dispatcher fields a call from her own future.',
  '', 'ACT ONE', '',
  'MARA (30s), tired eyes, works the graveyard shift inside a county dispatch office. The phones never stop.',
  '', 'THE CALL', '',
  'A voice she recognizes — her own — warns her about tomorrow night. MARA: "Who is this?"',
  '', 'EXT. HIGHWAY 9 - NIGHT', '',
  'Mara drives the empty highway. Rain hammers the windshield.'
].join('\n');
const parsed = T.parseTreatment(TREATMENT);
ok(parsed.project.title === 'THE LAST DISPATCH', 'parse: title');
ok(parsed.project.author === 'Kyle Francis', 'parse: author');
ok(/night-shift dispatcher/.test(parsed.project.logline), 'parse: logline');
ok(parsed.scenes.length === 3, 'parse: 3 scenes (' + parsed.scenes.length + ')');
ok(/^INT\./.test(parsed.scenes[0].slug), 'parse: scene 1 INT inferred (' + parsed.scenes[0].slug + ')');
ok(parsed.scenes[2].slug === 'EXT. HIGHWAY 9 - NIGHT', 'parse: explicit slugline kept');
ok(parsed.scenes[0].characters.includes('MARA'), 'parse: characters attached');

/* no headings at all → one beat per paragraph */
const flat = T.parseTreatment('A man wakes up alone on a container ship.\n\nHe finds a note in his own handwriting.\n\nThe ship has no crew.');
ok(flat.scenes.length >= 2, 'parse: headingless treatment still yields beats');

/* fountain output */
const f = T.toFountain(parsed, { draftDate: '2026-08-20' });
ok(f.startsWith('Title: THE LAST DISPATCH'), 'fountain: title page');
ok(/Author: Kyle Francis/.test(f), 'fountain: author');
ok(/Draft date: 2026-08-20/.test(f), 'fountain: draft date');
ok(/EXT\. HIGHWAY 9 - NIGHT/.test(f), 'fountain: sluglines present');
ok(/MARA\n"?Who is this\?/.test(f), 'fountain: dialogue passthrough (NAME: "line")');
ok(!/SHOTBREAK/i.test(f), 'fountain: no old brand strings');

/* stats */
const st = T.stats(parsed);
ok(st.scenes === 3 && st.words > 20, 'stats: scenes + words');
ok(st.estScreenplayPages >= 3, 'stats: screenplay expansion');
ok(st.characters.includes('MARA'), 'stats: cast list');


/* ── the Writer's output must parse as the Writer's structure ─────────
   The Writer's Fountain is the Timeline's input, and until now no suite
   loaded both engines in one process, so their agreement was unpinned. The
   cost was concrete: the card slugline field was free text, toFountain wrote
   it verbatim, and a card renamed "Kitchen at dawn" — no INT./EXT. token —
   became ordinary action in the export. Five cards parsed to three Timeline
   scenes, no warning at either end. The UI now normalises a non-slug heading
   through guessSlug on blur; this pins the whole contract underneath. */
(0, eval)(readFileSync(join(ROOT, 'js/lib-scenes.js'), 'utf8'));
{
  const CS = globalThis.CScenes;
  ok(!!CS, 'the scene model loads beside the Writer');

  const scenes = [
    { slug: 'INT. FARMHOUSE KITCHEN - NIGHT', body: 'Maggie sets the table.\n\nMAGGIE\nSupper is cold.', characters: ['MAGGIE'] },
    { slug: 'EXT. COUNTRY ROAD - DAY',        body: 'Tom trudges through mud.', characters: [] },
    { slug: 'INT. BARN - NIGHT',              body: 'Lantern light.\n\nTOM\nAnyone here?', characters: ['TOM'] },
  ];
  const fx = T.toFountain({ project: { title: 'AGREEMENT' }, scenes: scenes });
  const parsed = CS.parse(fx);
  ok(parsed.scenes.length === scenes.length,
    'every Writer card is a Timeline scene (' + parsed.scenes.length + '/' + scenes.length + ')');
  ok(parsed.scenes.every((sc, i) => sc.slug.indexOf(scenes[i].slug.split(' - ')[0]) === 0),
    'the scenes arrive in order under their own sluglines');
  ok(CS.speaksIn(parsed.scenes[0].body || parsed.scenes[0].text, 'MAGGIE'),
    'dialogue cues survive the round trip');

  /* THE FAILURE CASE, exactly as it shipped: a heading with no INT/EXT token.
     Written verbatim it folds; through guessSlug it stays a scene. */
  const broken = [scenes[0], { slug: 'Kitchen at dawn', body: 'Light through the window.', characters: [] }, scenes[2]];
  const folded = CS.parse(T.toFountain({ project: { title: 'X' }, scenes: broken }));
  ok(folded.scenes.length === 2,
    'verbatim, the bare heading folds into the previous scene (the bug: ' + folded.scenes.length + '/3)');
  const mended = [scenes[0], { slug: T.guessSlug('Kitchen at dawn', 'Light through the window.'), body: 'Light through the window.', characters: [] }, scenes[2]];
  const kept = CS.parse(T.toFountain({ project: { title: 'X' }, scenes: mended }));
  ok(kept.scenes.length === 3,
    'through guessSlug — what the UI now does on blur — all three survive (' + kept.scenes.length + '/3)');
  ok(T.isSlugline(T.guessSlug('Kitchen at dawn', 'Light through the window.')),
    'guessSlug always yields something isSlugline accepts');
}

if (failed) { console.error('\nWriter checks FAILED'); process.exit(1); }
console.log('\nAll writer checks passed.');
