/* The camera side of tools/lib-media.js: the sensor table the whole platform
 * now reads, and the depth-of-field arithmetic that used to be missing.
 *
 * The LUT and manifest halves are exercised by scripts/test_tools.mjs. This
 * suite exists because the optics grew a public API — formats, aspect,
 * circle of confusion, hyperfocal, near/far — and a lens number nobody has
 * checked against a published table is a number nobody should stand a set on.
 *
 * Run: node scripts/test_media.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'tools/lib-media.js'), 'utf8'));
const M = globalThis.TMedia;

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`  x ${name}${detail !== undefined ? ': ' + detail : ''}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ── the one table ───────────────────────────────────────────────────────
   Nine formats shipped here unused while the Set Designer carried two more
   sensor assumptions of its own. This is now THE table; the checks below are
   what stop an entry drifting to a number no camera has. */
{
  t('the table ships the formats it claims', Object.keys(M.SENSORS).length === 9,
    Object.keys(M.SENSORS).length);
  t('every entry has a positive width, height and label',
    M.sensorList().every((s) => s.w > 0 && s.h > 0 && s.label && s.key));
  t('every label states the measurements it is claiming',
    M.sensorList().every((s) => /\d/.test(s.label)));
  t('the default format is Super 35', M.DEFAULT_SENSOR === 'super35');
  t('Super 35 is the 24.9 × 18.7 aperture',
    M.SENSORS.super35.w === 24.9 && M.SENSORS.super35.h === 18.7);
  t('full frame is the 36 × 24 stills frame',
    M.SENSORS.fullframe.w === 36 && M.SENSORS.fullframe.h === 24);
  t('an unknown key resolves to the default', M.sensorKey('nope') === M.DEFAULT_SENSOR);
  t('a missing key resolves to the default', M.sensor(undefined) === M.SENSORS.super35);
  t('a known key is returned untouched', M.sensorKey('s16') === 's16');
  t('sensorList is a copy, not the table itself',
    M.sensorList()[0] !== M.SENSORS[M.sensorList()[0].key]);
}

/* ── field of view against published values ── */
{
  /* Checked against the standard tables: a 50mm covers about 28° on Super 35
     and about 40° on full frame; a 35mm covers 39.2° and 54.4°. */
  t('50mm on Super 35 ≈ 28° horizontal', Math.abs(M.fovFor('super35', 50) - 27.99) < 0.2,
    M.fovFor('super35', 50).toFixed(2));
  t('35mm on Super 35 ≈ 39.2°', Math.abs(M.fovFor('super35', 35) - 39.16) < 0.2);
  t('35mm on full frame ≈ 54.4°', Math.abs(M.fovFor('fullframe', 35) - 54.43) < 0.2);
  t('50mm on full frame ≈ 39.6°', Math.abs(M.fovFor('fullframe', 50) - 39.6) < 0.3);
  t('vertical is narrower than horizontal on every format',
    M.sensorList().every((s) => M.fovFor(s.key, 35, true) < M.fovFor(s.key, 35, false)));
  t('a longer lens is always narrower', M.fovFor('super35', 85) < M.fovFor('super35', 35));
  t('a nonsense focal length falls back to 35mm',
    near(M.fovFor('super35', -2), M.fovFor('super35', 35)));
  t('the widest format in the table is the widest view at one focal length',
    M.fovFor('alexa-65', 35) > M.fovFor('fullframe', 35) &&
    M.fovFor('fullframe', 35) > M.fovFor('super35', 35) &&
    M.fovFor('super35', 35) > M.fovFor('s16', 35));
}

/* ── aspect comes from the format ─────────────────────────────────────────
   The 3D viewport used to take its aspect from the browser window, so one
   35mm read 39.1° at 4:3, 50.7° at 16:9 and 63.8° at 21:9. The format's own
   shape is the only aspect that means anything. */
{
  t('Super 35 is about 4:3', Math.abs(M.aspectOf('super35') - 4 / 3) < 0.01,
    M.aspectOf('super35'));
  t('full frame is 3:2', near(M.aspectOf('fullframe'), 1.5));
  t('Super 35 17:9 is close to 1.9:1', Math.abs(M.aspectOf('super35-17x9') - 1.878) < 0.01);
  t('an unknown format still yields the default aspect',
    near(M.aspectOf('nope'), M.aspectOf('super35')));
  t('lensCalc reports the format and its aspect', (function () {
    const lc = M.lensCalc('super35-17x9', 32);
    return lc.key === 'super35-17x9' && /17:9/.test(lc.sensor) && Math.abs(lc.aspect - 1.878) < 0.01;
  })());
}

/* ── circle of confusion ─────────────────────────────────────────────────
   Stated rather than buried: frame diagonal ÷ 1500, which is the value that
   reproduces the familiar 0.029mm on full frame. */
{
  t('full frame comes out at the standard 0.029mm', Math.abs(M.cocFor('fullframe') - 0.029) < 0.001,
    M.cocFor('fullframe').toFixed(4));
  t('a smaller format has a smaller circle', M.cocFor('s16') < M.cocFor('super35'));
  t('the divisor is stated, not hidden', M.COC_DIVISOR === 1500);
  t('a house standard can be passed in', Math.abs(M.cocFor('super35', 1000) - 0.0311) < 0.001,
    M.cocFor('super35', 1000));
}

/* ── hyperfocal ──────────────────────────────────────────────────────────
   The published figure for a 50mm at f/2.8 on full frame is about 30 metres;
   at f/8 about 10.9. These are the numbers a focus puller can check against
   the app on their phone, which is the point of computing them at all. */
{
  const cFF = M.cocFor('fullframe');
  t('50mm f/2.8 full frame ≈ 30m', Math.abs(M.hyperfocal(50, 2.8, cFF) - 31) < 1.5,
    M.hyperfocal(50, 2.8, cFF).toFixed(2));
  t('50mm f/8 full frame ≈ 10.9m', Math.abs(M.hyperfocal(50, 8, cFF) - 10.9) < 0.6,
    M.hyperfocal(50, 8, cFF).toFixed(2));
  t('stopping down brings the hyperfocal closer',
    M.hyperfocal(50, 16, cFF) < M.hyperfocal(50, 2.8, cFF));
  t('a longer lens pushes it further out',
    M.hyperfocal(100, 4, cFF) > M.hyperfocal(25, 4, cFF));
  t('it scales as the square of the focal length',
    Math.abs(M.hyperfocal(100, 4, cFF) / M.hyperfocal(50, 4, cFF) - 4) < 0.05);
  t('junk arguments do not produce NaN', isFinite(M.hyperfocal('x', 0)));
}

/* ── depth of field ── */
{
  const d = M.dof('super35', 35, 2.8, 3);
  t('the sharp band brackets the focus distance', d.near < 3 && d.far > 3,
    `${d.near}–${d.far}`);
  t('it reports the format it used', d.key === 'super35');
  t('it reports the circle of confusion it used', Math.abs(d.coc - M.cocFor('super35')) < 1e-4);
  t('near and far add up to the total', Math.abs((d.far - d.near) - d.total) < 0.01);
  t('in front plus behind is the total',
    Math.abs(d.inFront + d.behind - d.total) < 0.01, `${d.inFront} + ${d.behind} vs ${d.total}`);
  t('more of the band sits behind the subject than in front', d.behind > d.inFront,
    `${d.inFront} / ${d.behind}`);

  const open = M.dof('super35', 35, 1.4, 3);
  t('wide open is shallower than stopped down', open.total < d.total, `${open.total} vs ${d.total}`);
  const long = M.dof('super35', 85, 2.8, 3);
  t('a longer lens is shallower at the same stop and distance', long.total < d.total);
  const far = M.dof('super35', 35, 2.8, 12);
  t('the band deepens with distance', far.total > d.total);

  /* Focus at the hyperfocal and everything from half of it out is sharp —
     the definition, used here as an independent check on the algebra. */
  const H = M.hyperfocal(35, 5.6, M.cocFor('super35'));
  const at = M.dof('super35', 35, 5.6, H);
  t('focused at the hyperfocal, the far limit is infinity', at.far === Infinity, at.far);
  t('and the near limit is half the hyperfocal', Math.abs(at.near - H / 2) < 0.05,
    `${at.near} vs ${H / 2}`);
  const past = M.dof('super35', 35, 5.6, H * 2);
  t('past the hyperfocal it stays infinite', past.far === Infinity);
  t('total is infinite when the far limit is', past.total === Infinity);

  t('with no distance it still answers the hyperfocal question', (function () {
    const none = M.dof('super35', 35, 2.8);
    return none.hyperfocal > 0 && none.near === null && none.far === null;
  })());
  t('a house circle of confusion overrides the default',
    M.dof('super35', 35, 2.8, 3, { coc: 0.025 }).total > d.total);
  t('an unknown format falls back rather than throwing',
    M.dof('nope', 35, 2.8, 3).key === 'super35');
  t('junk in does not produce NaN', (function () {
    const j = M.dof('super35', 'x', -1, 'y');
    return isFinite(j.hyperfocal) && j.near === null;
  })());
}

/* ── lensCalc carries the aperture through ───────────────────────────────
   It took no aperture at all until now, which is why "Shallow f/1.4" was a
   prompt word with no arithmetic behind it. */
{
  const plain = M.lensCalc('super35', 35, 3);
  t('an aperture is optional', plain.dof === undefined);
  t('the old fields are untouched', plain.hfov === 39.2 && plain.ffEquiv === 51,
    `${plain.hfov} / ${plain.ffEquiv}`);
  const withStop = M.lensCalc('super35', 35, 3, 1.4);
  t('given an aperture it answers the focus question', withStop.dof && withStop.dof.near < 3,
    JSON.stringify(withStop.dof));
  t('the shallow end really is shallow', withStop.dof.total < 0.6, withStop.dof.total);
  t('coverage is unchanged by the aperture', withStop.widthAt === plain.widthAt);
}

console.log(`test_media: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
