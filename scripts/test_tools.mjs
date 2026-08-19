/* Tests for the Cinamate Tools logic libraries — run: node scripts/test_tools.mjs */
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const f of ['tools/lib-sun.js', 'tools/lib-script.js', 'tools/lib-money.js', 'tools/lib-media.js']) {
  (0, eval)(readFileSync(join(root, f), 'utf8'));
}
const { TSun, TScript, TMoney, TMedia } = globalThis;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.error('FAIL  ' + name + (extra != null ? ' — got: ' + JSON.stringify(extra) : '')); }
}

// ── sun math (reference: NOAA calculator, LA 2026-06-21: sunrise ~05:42, sunset ~20:08 PDT) ──
{
  const t = TSun.sunTimes('2026-06-21', 34.05, -118.24);
  const rise = new Date(t.sunrise).toISOString();
  const set = new Date(t.sunset).toISOString();
  // PDT = UTC-7 → expect ~12:42Z rise, ~03:08Z next-day set
  const riseH = new Date(t.sunrise).getUTCHours() + new Date(t.sunrise).getUTCMinutes() / 60;
  check('LA solstice sunrise ≈ 12:42Z ±10min', Math.abs(riseH - 12.7) < 0.17, rise);
  const setH = new Date(t.sunset).getUTCHours() + new Date(t.sunset).getUTCMinutes() / 60;
  check('LA solstice sunset ≈ 03:08Z ±10min', Math.abs(setH - 3.13) < 0.17, set);
  check('golden hour brackets sunset', t.goldenStartPM < t.sunset && t.sunset < t.dusk, null);
  check('daylight ~14.4h at LA solstice', Math.abs(TSun.daylightHours(t) - 14.4) < 0.3, TSun.daylightHours(t));
  const winter = TSun.sunTimes('2026-12-21', 34.05, -118.24);
  check('winter day shorter than summer', TSun.daylightHours(winter) < TSun.daylightHours(t) - 4, TSun.daylightHours(winter));
  check('weather url is open-meteo daily', TSun.weatherUrl(34, -118, '2026-08-19', '2026-08-25').includes('api.open-meteo.com') && TSun.weatherUrl(34, -118, 'a', 'b').includes('precipitation_probability_max'));
  check('storm scores high risk', TSun.shootRisk({ code: 95, precipProb: 80, windMax: 40 }) > 70, TSun.shootRisk({ code: 95, precipProb: 80, windMax: 40 }));
  check('clear day scores low risk', TSun.shootRisk({ code: 0, precipProb: 5, windMax: 10 }) < 10);
}

// ── diff ──
{
  const a = 'INT. BARN - DAY\nJack enters.\nJACK\nHello.\nHe exits.';
  const b = 'INT. BARN - NIGHT\nJack enters.\nJACK\nHello there.\nHe exits.';
  const ops = TScript.diffLines(a, b);
  const st = TScript.diffStats(ops);
  check('diff finds 2 changed lines', st.added === 2 && st.deleted === 2, st);
  check('unchanged lines preserved', ops.filter(o => o.type === 'same').length === 3);
  check('identical texts diff clean', TScript.diffStats(TScript.diffLines(a, a)).changed === 0);
  check('revision colors follow convention', TScript.revColor(1) === 'Blue' && TScript.revColor(2) === 'Pink' && TScript.revColor(3) === 'Yellow');
}

// ── captions ──
{
  const srt = '1\n00:00:01,000 --> 00:00:03,500\nHello there.\n\n2\n00:00:04,000 --> 00:00:05,000\nA second line\nwith two rows.\n';
  const cues = TScript.parseCaptions(srt);
  check('srt parses 2 cues', cues.length === 2, cues.length);
  check('timecodes to ms', cues[0].start === 1000 && cues[0].end === 3500, cues[0]);
  const round = TScript.parseCaptions(TScript.toSrt(cues));
  check('srt roundtrip stable', JSON.stringify(round) === JSON.stringify(cues));
  const vtt = TScript.toVtt(cues);
  check('vtt has header + dot times', vtt.startsWith('WEBVTT') && vtt.includes('00:00:01.000'));
  check('vtt reparses', TScript.parseCaptions(vtt).length === 2);
  const qc = TScript.captionQc([{ start: 0, end: 1000, text: 'This line is way too long to fit within broadcast conventions at all' }]);
  check('qc flags cps + line length', qc.some(i => i.kind === 'cps') && qc.some(i => i.kind === 'line'), qc);
}

// ── timecard ──
{
  // 06:00 call, 20:00 wrap (14h elapsed), two 30-min meals → 13h worked
  const tc = TMoney.timecard({ rate: 50, call: '06:00', wrap: '20:00', mealsTaken: 2, firstMealAtHr: 5, dayOfWeek: 3 });
  check('elapsed 14h, worked 13h', tc.elapsed === 14 && tc.worked === 13, tc);
  // straight 8 + DT hours = elapsed 12→14 = 2h at 2×; OT = 13-8-2 = 3h at 1.5×
  const st8 = tc.lines.find(l => l.label === 'Straight time');
  const ot = tc.lines.find(l => /Overtime/.test(l.label));
  const dt = tc.lines.find(l => /Double/.test(l.label));
  check('8 straight / 3 OT / 2 DT', st8.hours === 8 && ot.hours === 3 && dt.hours === 2, tc.lines);
  check('gross = 8*50 + 3*75 + 2*100', tc.gross === 825, tc.gross);
  check('no meal penalty when fed on time', tc.penalties === 0, tc.penalties);
  check('fringes 28%', tc.fringes === Math.round(825 * 0.28 * 100) / 100, tc.fringes);

  const late = TMoney.timecard({ rate: 50, call: '06:00', wrap: '14:00', mealsTaken: 1, firstMealAtHr: 7.6, dayOfWeek: 2 });
  check('late meal penalized', late.penalties > 0, late.penalties);

  const seventh = TMoney.timecard({ rate: 50, call: '08:00', wrap: '16:00', mealsTaken: 0, firstMealAtHr: 5, dayOfWeek: 7 });
  check('7th day doubles pay', seventh.gross === 8 * 50 * 2, seventh.gross);

  const forced = TMoney.timecard({ rate: 50, call: '06:00', wrap: '18:00', mealsTaken: 1, firstMealAtHr: 5, dayOfWeek: 4, prevWrap: '23:00' });
  check('turnaround invasion pays', forced.penalties >= 3 * 50, forced.penalties); // 23:00→06:00 = 7h rest, 3h invaded
  check('overnight wrap handled', TMoney.hoursBetween('18:00', '02:00') === 8);
}

// ── hot cost ──
{
  const hc = TMoney.hotCost([
    { acct: '4100', kind: 'actual', amount: 12000 },
    { acct: '4100', kind: 'po', amount: 3000 },
    { acct: '6000', kind: 'actual', amount: 2000 }
  ], { '4100': 20000, '6000': 1500 });
  const crew = hc.rows.find(r => r.acct === '4100');
  check('actual + committed split', crew.actual === 12000 && crew.committed === 3000, crew);
  check('variance vs budget', crew.variance === 5000 && hc.rows.find(r => r.acct === '6000').variance === -500, hc.rows);
  check('totals roll up', hc.totals.total === 17000 && hc.totals.budget === 21500, hc.totals);
}

// ── waterfall instruments ──
{
  const wf = TMoney.instrumentWaterfall(3_000_000,
    [{ name: 'Class A equity', invested: 1_000_000, premiumPct: 0.2, corridorPct: 0.5 }],
    [{ name: 'Director deferral', amount: 100_000 }]);
  check('deferral paid first', wf.steps[0].paid === 100000, wf.steps[0]);
  check('equity recoups 120%', wf.steps[1].paid === 1200000, wf.steps[1]);
  check('pool after recoup', wf.pool === 1700000, wf.pool);
  check('50/50 corridor split', wf.steps[2].paid === 850000 && wf.producerNet === 850000, wf.steps);
  const dry = TMoney.instrumentWaterfall(500_000, [{ name: 'A', invested: 1_000_000, premiumPct: 0.2, corridorPct: 0.5 }], []);
  check('shortfall does not overpay', dry.steps[0].paid === 500000 && dry.pool === 0 && dry.breakeven === false, dry);
}

// ── LUT ──
{
  // identity 2-point LUT
  const cube = 'TITLE "identity"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
  const lut = TMedia.parseCube(cube);
  check('cube parses size 2', lut.size === 2 && lut.title === 'identity');
  const mid = TMedia.sampleLut(lut, 0.5, 0.25, 0.75);
  check('identity LUT passes through', Math.abs(mid[0] - 0.5) < 1e-6 && Math.abs(mid[1] - 0.25) < 1e-6 && Math.abs(mid[2] - 0.75) < 1e-6, mid);
  const px = new Uint8ClampedArray([128, 64, 192, 255]);
  TMedia.applyLutToPixels(lut, px);
  check('pixel apply ± rounding', Math.abs(px[0] - 128) <= 1 && Math.abs(px[1] - 64) <= 1 && Math.abs(px[2] - 192) <= 1, px);
  let threw = false;
  try { TMedia.parseCube('LUT_3D_SIZE 2\n0 0 0\n'); } catch (e) { threw = true; }
  check('truncated cube rejected', threw);
}

// ── lens ──
{
  const lc = TMedia.lensCalc('super35', 25, 3);
  check('25mm on S35 ≈ 53° HFOV', Math.abs(lc.hfov - 53) < 1.5, lc.hfov);
  check('coverage ≈ 2.99m wide at 3m', Math.abs(lc.widthAt - 2.99) < 0.05, lc.widthAt);
  check('FF equivalent ≈ 36mm', Math.abs(lc.ffEquiv - 36) <= 1, lc.ffEquiv);
  const long = TMedia.lensCalc('fullframe', 85, 2);
  check('85mm FF ≈ 24° HFOV', Math.abs(long.hfov - 23.9) < 1, long.hfov);
}

// ── manifest ──
{
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const files = [
    { path: 'A001/clip1.mov', size: 5, sha256: sha('12345') },
    { path: 'A001/clip2.mov', size: 3, sha256: sha('abc') }
  ];
  const xml = TMedia.manifestXml(files, { project: 'Test & Co', created: '2026-08-19T00:00:00Z' });
  check('xml escapes project name', xml.includes('Test &amp; Co'));
  const parsed = TMedia.parseManifest(xml);
  check('manifest roundtrip', parsed.length === 2 && parsed[0].sha256 === files[0].sha256, parsed);
  const v1 = TMedia.verifyAgainst(parsed, files);
  check('clean verify', v1.clean && v1.ok.length === 2, v1);
  const v2 = TMedia.verifyAgainst(parsed, [files[0], { path: 'A001/clip2.mov', size: 3, sha256: sha('CHANGED') }, { path: 'new.mov', size: 1, sha256: sha('x') }]);
  check('detects changed + extra', v2.changed.length === 1 && v2.extra.length === 1 && !v2.clean, v2);
  const v3 = TMedia.verifyAgainst(parsed, [files[0]]);
  check('detects missing', v3.missing.length === 1, v3.missing);
}

console.log(failures ? '\n' + failures + ' FAILURES' : '\nAll tools checks passed.');
process.exit(failures ? 1 : 0);
