#!/usr/bin/env node
/* Sun, timezone and sun-direction tests for tools/lib-sun.js (TSun).
 * Run: node scripts/test_sun.mjs
 *
 * WHY THIS SUITE EXISTS, SEPARATELY FROM test_tools.mjs
 * -----------------------------------------------------
 * The timezone defect was confirmed three separate times by three separate
 * auditors (findings 14, 24, 28) and survived every one of them, because the
 * only tests that existed asked what the sun did in UTC — which is the one
 * question the bug does not affect. `fmtLocal` was, on the day this was
 * written, named by no suite at all.
 *
 * So the fixtures here are deliberately REMOTE. Every location is somewhere
 * the test machine is not, and the offset-passing assertions are executed a
 * second time inside child processes pinned to three different TZ values. A
 * suite that only ever asks about the machine's own timezone cannot see this
 * class of bug, and that is exactly how it shipped.
 */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SUN_SRC = join(ROOT, 'tools/lib-sun.js');
(0, eval)(readFileSync(SUN_SRC, 'utf8'));
const S = globalThis.TSun;

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.error('  ✗', name, extra === undefined ? '' : '— got: ' + JSON.stringify(extra)); }
}
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

/* ── fixtures: every one of them somewhere else ────────────────────────────
   name, lat, lon, civil UTC offset in minutes on 2026-08-26 (DST as it
   actually stands that day), and the clock time the location itself reads. */
const DAY = '2026-08-26';
const PLACES = [
  { name: 'Los Angeles', lat: 34.05, lon: -118.24, tz: -420, sunset: '19:28' },   // PDT
  { name: 'Budapest', lat: 47.50, lon: 19.04, tz: 120 },                          // CEST
  { name: 'Sydney', lat: -33.87, lon: 151.21, tz: 600 },                          // AEST, southern winter
  { name: 'Reykjavik', lat: 64.15, lon: -21.94, tz: 0 },                          // no DST, ever
  { name: 'Kolkata', lat: 22.57, lon: 88.36, tz: 330 },                           // half-hour offset
];

/* ── 1 · the defect itself: the location's clock, not the viewer's ──────── */
{
  const la = PLACES[0];
  const t0 = S.sunTimes(DAY, la.lat, la.lon);
  t('LA sunset renders 19:28 in the location offset', S.fmtLocal(t0.sunset, la.tz) === la.sunset,
    S.fmtLocal(t0.sunset, la.tz));
  t('…and 02:28 in UTC — the wrong answer this suite exists to catch',
    S.fmtLocal(t0.sunset, 0) === '02:28', S.fmtLocal(t0.sunset, 0));

  const bud = PLACES[1];
  const tb = S.sunTimes(DAY, bud.lat, bud.lon);
  t('Budapest sunrise is a morning hour in CEST', /^0[4-6]:/.test(S.fmtLocal(tb.sunrise, bud.tz)),
    S.fmtLocal(tb.sunrise, bud.tz));
  t('Budapest sunrise in UTC is two hours earlier',
    S.fmtLocal(tb.sunrise, 120) !== S.fmtLocal(tb.sunrise, 0));

  const kol = PLACES[4];
  const tk = S.sunTimes(DAY, kol.lat, kol.lon);
  t('a half-hour offset lands on the half hour', /:(0[0-9]|[1-5][0-9])$/.test(S.fmtLocal(tk.sunrise, kol.tz)) &&
    S.fmtLocal(tk.sunrise, kol.tz) !== S.fmtLocal(tk.sunrise, 300), S.fmtLocal(tk.sunrise, kol.tz));

  const syd = PLACES[2];
  const ts = S.sunTimes(DAY, syd.lat, syd.lon);
  t('Sydney sunset crosses the UTC date line and still reads as evening',
    /^1[6-8]:/.test(S.fmtLocal(ts.sunset, syd.tz)), S.fmtLocal(ts.sunset, syd.tz));

  t('a null time formats as an em dash, never as midnight', S.fmtLocal(null, 0) === '—');
}

/* ── 2 · the same assertions under three foreign machine timezones ────────
   If the offset is honoured, the rendered string cannot depend on TZ. If it
   is not, this is where the viewer's clock leaks in. */
{
  const probe = `
    (0, eval)(require('fs').readFileSync(${JSON.stringify(SUN_SRC)}, 'utf8'));
    const S = globalThis.TSun;
    const out = ${JSON.stringify(PLACES)}.map(function (p) {
      const t = S.sunTimes(${JSON.stringify(DAY)}, p.lat, p.lon);
      return p.name + '|' + S.fmtLocal(t.sunrise, p.tz) + '|' + S.fmtLocal(t.sunset, p.tz) +
             '|' + S.fmtLocal(t.sunset);
    });
    process.stdout.write(JSON.stringify(out));
  `;
  const run = (tz) => JSON.parse(execFileSync(process.execPath, ['-e', probe],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));
  const utc = run('UTC'), pac = run('America/Los_Angeles'), tok = run('Asia/Tokyo');
  const withOffset = (rows) => rows.map((r) => r.split('|').slice(0, 3).join('|')).join(',');
  const noOffset = (rows) => rows.map((r) => r.split('|')[3]).join(',');

  t('offset-aware times are identical under TZ=UTC / LA / Tokyo',
    withOffset(utc) === withOffset(pac) && withOffset(utc) === withOffset(tok),
    { utc: withOffset(utc), pac: withOffset(pac), tok: withOffset(tok) });
  t('LA sunset in the child process is still 19:28', utc[0].split('|')[2] === '19:28', utc[0]);
  t('omitting the offset DOES follow the machine — the trap callers must avoid',
    noOffset(utc) !== noOffset(tok), { utc: noOffset(utc), tok: noOffset(tok) });
}

/* ── 3 · timezone helpers ─────────────────────────────────────────────── */
t('utc_offset_seconds is read off the Open-Meteo response',
  S.tzOffsetFromWeather({ utc_offset_seconds: 7200 }) === 120 &&
  S.tzOffsetFromWeather({ utc_offset_seconds: -25200 }) === -420 &&
  S.tzOffsetFromWeather({ utc_offset_seconds: 19800 }) === 330);
t('a response without the field yields null, not zero',
  S.tzOffsetFromWeather({}) === null && S.tzOffsetFromWeather(null) === null &&
  S.tzOffsetFromWeather({ utc_offset_seconds: 'x' }) === null);
t('the longitude fallback is solar mean time',
  S.tzOffsetFromLon(19.04) === 60 && S.tzOffsetFromLon(-118.24) === -480 &&
  S.tzOffsetFromLon(0) === 0 && S.tzOffsetFromLon(151.21) === 600);
t('the fallback refuses bad input', S.tzOffsetFromLon('x') === null && S.tzOffsetFromLon(undefined) === null);
t('tzLabel is signed, padded and half-hour aware',
  S.tzLabel(120) === 'UTC+02:00' && S.tzLabel(-420) === 'UTC-07:00' &&
  S.tzLabel(330) === 'UTC+05:30' && S.tzLabel(0) === 'UTC+00:00' && S.tzLabel(null) === 'UTC±??');

/* ── 4 · sun DIRECTION ────────────────────────────────────────────────────
   Verified against values that are true by geometry rather than by table:
   at an equinox the sun rises due east and sets due west at every latitude,
   and at local solar noon its altitude is 90 - |lat - declination|. Spot-
   checked against the NOAA solar calculator: LA 2026-06-21 sunset azimuth
   300.6° (this engine: 299.5°), noon altitude 79.4° (79.4°). */
{
  const EQUINOX = '2026-03-20';
  [0, 34.05, -33.87, 51.51].forEach((lat) => {
    const a = S.sunAngles(EQUINOX, lat, 0);
    t(`equinox sunrise is due east at ${lat}°`, near(a.sunrise.azimuth, 90, 2), a.sunrise.azimuth);
    t(`equinox sunset is due west at ${lat}°`, near(a.sunset.azimuth, 270, 2), a.sunset.azimuth);
  });

  const la = S.sunAngles('2026-06-21', 34.05, -118.24);
  t('LA solstice noon altitude = 90 - lat + 23.44', near(la.noon.altitude, 90 - 34.05 + 23.44, 0.3), la.noon.altitude);
  t('LA solstice noon is due south', near(la.noon.azimuth, 180, 2), la.noon.azimuth);
  t('LA solstice sun sets north of west (WNW)', la.sunset.azimuth > 295 && la.sunset.azimuth < 303,
    la.sunset.azimuth);
  t('LA solstice sun rises north of east', la.sunrise.azimuth > 57 && la.sunrise.azimuth < 65, la.sunrise.azimuth);
  const dec = S.sunAngles('2026-12-21', 34.05, -118.24);
  t('LA winter sun sets south of west', dec.sunset.azimuth < 245 && dec.sunset.azimuth > 235, dec.sunset.azimuth);
  t('winter noon is 47° lower than summer noon', near(la.noon.altitude - dec.noon.altitude, 46.9, 0.5),
    la.noon.altitude - dec.noon.altitude);

  const syd = S.sunAngles('2026-06-21', -33.87, 151.21);
  t('southern hemisphere noon sun is in the NORTH', near(syd.noon.azimuth, 0, 3) || near(syd.noon.azimuth, 360, 3),
    syd.noon.azimuth);

  t('altitude at sunrise/sunset sits on the refracted horizon',
    near(la.sunrise.altitude, -0.83, 0.6) && near(la.sunset.altitude, -0.83, 0.6),
    [la.sunrise.altitude, la.sunset.altitude]);
  t('golden hour is at ~6° up, which is what makes it golden',
    near(la.goldenEndAM.altitude, 6, 0.6) && near(la.goldenStartPM.altitude, 6, 0.6),
    [la.goldenEndAM.altitude, la.goldenStartPM.altitude]);

  const times = S.sunTimes('2026-06-21', 34.05, -118.24);
  t('solar noon lies between sunrise and sunset', la.noon.time > times.sunrise && la.noon.time < times.sunset);
  t('noon is the highest the sun gets all day', [-6, -3, -1, 1, 3, 6].every((h) =>
    S.sunPosition(la.noon.time + h * 3600000, 34.05, -118.24).altitude < la.noon.altitude));
  t('solarNoon refuses a bad date', S.solarNoon('not-a-date', 34, -118) === null);
  t('sunPosition refuses bad input rather than inventing one',
    S.sunPosition(null, 34, -118) === null && S.sunPosition(Date.now(), NaN, -118) === null);
}

/* ── 5 · compass ──────────────────────────────────────────────────────── */
t('compass names the eight principal points',
  S.compass(0) === 'N' && S.compass(90) === 'E' && S.compass(180) === 'S' && S.compass(270) === 'W' &&
  S.compass(45) === 'NE' && S.compass(135) === 'SE' && S.compass(225) === 'SW' && S.compass(315) === 'NW');
t('compass resolves the sixteenths', S.compass(292.5) === 'WNW' && S.compass(112.5) === 'ESE');
t('compass wraps past 360 and takes negatives', S.compass(361) === 'N' && S.compass(-90) === 'W');
t('compass refuses a non-number', S.compass(null) === '—' && S.compass(NaN) === '—');

/* ── 6 · the rest of the surface, so nothing here is untested again ────── */
t('daylightHours is longer in June than December at 34°N',
  S.daylightHours(S.sunTimes('2026-06-21', 34.05, -118.24)) >
  S.daylightHours(S.sunTimes('2026-12-21', 34.05, -118.24)) + 4);
t('weatherUrl asks for the timezone the render needs',
  S.weatherUrl(47.5, 19.04, DAY, DAY).includes('timezone=auto') &&
  S.weatherUrl(47.5, 19.04, DAY, DAY).includes('api.open-meteo.com'));
t('wmoLabel names a storm and degrades honestly',
  S.wmoLabel(95) === 'Thunderstorm' && S.wmoLabel(0) === 'Clear' && S.wmoLabel(4242) === 'Code 4242');
t('shootRisk puts a storm above a clear day',
  S.shootRisk({ code: 95, precipProb: 80, windMax: 40 }) > S.shootRisk({ code: 0, precipProb: 5, windMax: 10 }) + 60);

/* ── 7 · the consumers pass an offset at every call site ──────────────────
   Verified by reading the source: a bare fmtLocal(x) in a renderer is the
   defect, and it came back twice already. */
{
  const callers = ['tools/sched-weather.js', 'production/production.js'];
  for (const f of callers) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const calls = src.match(/fmtLocal\s*\([^)]*\)/g) || [];
    t(`${f} calls fmtLocal at all`, calls.length > 0);
    t(`${f} passes an offset on every fmtLocal call`, calls.every((c) => /,/.test(c)),
      calls.filter((c) => !/,/.test(c)));
  }
  t('locations/index.html loads the tested engine, not a second one',
    /tools\/lib-sun\.js/.test(readFileSync(join(ROOT, 'locations/index.html'), 'utf8')));
  t('the approximate duplicate is gone from CScout',
    !/goldenHour/.test(readFileSync(join(ROOT, 'locations/lib-scout.js'), 'utf8')));
  t('the Open-Meteo origin is in the deployed connect-src',
    /connect-src[^\n]*https:\/\/api\.open-meteo\.com/.test(readFileSync(join(ROOT, '_headers'), 'utf8')));
  t('the forecast failure is visible rather than swallowed',
    /forecast unavailable/.test(readFileSync(join(ROOT, 'tools/sched-weather.js'), 'utf8')) &&
    !/catch\s*\(\s*\)\s*\{\s*\}/.test(readFileSync(join(ROOT, 'tools/sched-weather.js'), 'utf8')));
}

console.log(`test_sun: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
