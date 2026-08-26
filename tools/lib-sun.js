/* TSun — sunrise/sunset/golden-hour math for shoot-day planning.
 *
 * Original implementation of the standard NOAA/Meeus solar position
 * equations (public-domain astronomy). Accuracy ±2 minutes, ample for
 * call-sheet planning. All original code, written for Cinamate.
 */
(function (root) {
  'use strict';
  var RAD = Math.PI / 180;

  function toJulian(dateUTCms) { return dateUTCms / 86400000 + 2440587.5; }
  function fromJulian(j) { return (j - 2440587.5) * 86400000; }

  /* Solar coordinates for Julian day n (days since J2000). */
  function solarMeanAnomaly(d) { return RAD * (357.5291 + 0.98560028 * d); }
  function eclipticLongitude(M) {
    var C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    var P = RAD * 102.9372; // perihelion of Earth
    return M + C + P + Math.PI;
  }
  function declination(L) { return Math.asin(Math.sin(L) * Math.sin(RAD * 23.4397)); }

  /* Hour angle for a given sun altitude h at latitude phi. */
  function hourAngle(h, phi, dec) {
    var x = (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (x < -1) return Math.PI;   // sun never reaches this altitude (always above)
    if (x > 1) return NaN;        // never rises to it
    return Math.acos(x);
  }

  /* Time (ms UTC) the sun crosses altitude `deg` on `date` at lon/lat.
   * dir: -1 = morning crossing, +1 = evening crossing. */
  function crossing(dateMs, lat, lon, deg, dir) {
    var lw = RAD * -lon, phi = RAD * lat;
    var d = toJulian(dateMs) - 2451545 + 0.0009 - lw / (2 * Math.PI);
    var n = Math.round(d);
    var ds = n + 0.0009 + lw / (2 * Math.PI);
    var M = solarMeanAnomaly(ds);
    var L = eclipticLongitude(M);
    var dec = declination(L);
    var Jnoon = 2451545 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    var w = hourAngle(RAD * deg, phi, dec);
    if (isNaN(w)) return null;
    var Jset = Jnoon + w / (2 * Math.PI);
    var Jrise = Jnoon - (Jset - Jnoon);
    return fromJulian(dir < 0 ? Jrise : Jset);
  }

  /* All the times a shoot day cares about. date: 'YYYY-MM-DD' (local calendar
   * day at the location); lat/lon in degrees. Returns ms-UTC timestamps. */
  function sunTimes(date, lat, lon) {
    var noonUTC = Date.parse(date + 'T12:00:00Z') - Math.round(lon / 15) * 3600000;
    function c(deg, dir) { return crossing(noonUTC, lat, lon, deg, dir); }
    return {
      dawn: c(-6, -1),            // civil dawn
      sunrise: c(-0.833, -1),
      goldenEndAM: c(6, -1),      // morning golden hour ends
      goldenStartPM: c(6, 1),     // evening golden hour begins
      sunset: c(-0.833, 1),
      dusk: c(-6, 1)              // civil dusk
    };
  }

  /* Solar noon (ms UTC) for the local calendar day at lon. */
  function solarNoon(date, lat, lon) {
    var noonUTC = Date.parse(date + 'T12:00:00Z') - Math.round(lon / 15) * 3600000;
    if (isNaN(noonUTC)) return null;
    var lw = RAD * -lon;
    var d = toJulian(noonUTC) - 2451545 + 0.0009 - lw / (2 * Math.PI);
    var ds = Math.round(d) + 0.0009 + lw / (2 * Math.PI);
    var M = solarMeanAnomaly(ds);
    var L = eclipticLongitude(M);
    return fromJulian(2451545 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L));
  }

  /* ── Sun DIRECTION ────────────────────────────────────────────────────
   * Where the sun actually is, which is most of what a DP or a gaffer asks
   * of this maths: which way does it rise, where is it at the 4pm setup,
   * and how high. Same NOAA/Meeus coordinates as the rise/set solver.     */
  function rightAscension(L) {
    return Math.atan2(Math.sin(L) * Math.cos(RAD * 23.4397), Math.cos(L));
  }
  /* Greenwich mean sidereal time, corrected to the local meridian. */
  function siderealTime(d, lw) { return RAD * (280.16 + 360.9856235 * d) - lw; }

  /* Sun position at an instant. azimuth = degrees CLOCKWISE FROM TRUE NORTH
     (0 N, 90 E, 180 S, 270 W); altitude = degrees above the horizon, negative
     below it. Returns null on bad input rather than a plausible wrong number. */
  function sunPosition(ms, lat, lon) {
    if (ms == null || !isFinite(ms) || !isFinite(lat) || !isFinite(lon)) return null;
    var lw = RAD * -lon, phi = RAD * lat;
    var d = toJulian(ms) - 2451545;
    var M = solarMeanAnomaly(d);
    var L = eclipticLongitude(M);
    var dec = declination(L);
    var H = siderealTime(d, lw) - rightAscension(L);
    var alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    /* atan2 form is measured from due SOUTH; +180 puts it on the compass. */
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) / RAD + 180;
    az = ((az % 360) + 360) % 360;
    return { azimuth: Math.round(az * 10) / 10, altitude: Math.round(alt / RAD * 10) / 10 };
  }

  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compass(az) {
    if (az == null || !isFinite(az)) return '—';
    return COMPASS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
  }

  /* Direction of every moment the shoot day cares about, plus the noon peak. */
  function sunAngles(date, lat, lon) {
    var t = sunTimes(date, lat, lon);
    var out = { sunrise: null, goldenEndAM: null, goldenStartPM: null, sunset: null, noon: null };
    ['sunrise', 'goldenEndAM', 'goldenStartPM', 'sunset'].forEach(function (k) {
      out[k] = sunPosition(t[k], lat, lon);
    });
    var n = solarNoon(date, lat, lon);
    var np = sunPosition(n, lat, lon);
    if (np) { np.time = n; out.noon = np; }
    return out;
  }

  /* ── Timezone ─────────────────────────────────────────────────────────
   * fmtLocal renders in whatever offset it is GIVEN. Passing nothing means
   * the VIEWER's offset, which is only right when the viewer is standing on
   * the location — so every caller must supply the location's offset. The
   * authoritative source is the Open-Meteo response we already fetch
   * (`timezone=auto` → `utc_offset_seconds`); tzOffsetFromLon is the
   * no-network fallback and is solar-mean, not civil: it knows nothing of
   * political borders or DST, so anything rendered from it must say so.  */
  function tzOffsetFromWeather(w) {
    var s = w && w.utc_offset_seconds;
    return typeof s === 'number' && isFinite(s) ? Math.round(s / 60) : null;
  }
  function tzOffsetFromLon(lon) {
    return isFinite(lon) ? Math.round(lon / 15) * 60 : null;
  }
  function tzLabel(min) {
    if (min == null || !isFinite(min)) return 'UTC±??';
    var s = min < 0 ? '-' : '+', a = Math.abs(min);
    return 'UTC' + s + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
  }

  function fmtLocal(ms, tzOffsetMin) {
    if (ms == null) return '—';
    var d = new Date(ms + (tzOffsetMin != null ? tzOffsetMin * 60000 : -new Date(ms).getTimezoneOffset() * 60000));
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function daylightHours(t) {
    if (!t || t.sunrise == null || t.sunset == null) return null;
    return Math.round((t.sunset - t.sunrise) / 360000) / 10;
  }

  /* Weather via the keyless Open-Meteo public API (called client-side). */
  function weatherUrl(lat, lon, dateFrom, dateTo) {
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max' +
      '&timezone=auto&start_date=' + dateFrom + '&end_date=' + dateTo;
  }
  var WMO = {
    0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Rime fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Showers', 81: 'Showers', 82: 'Violent showers',
    85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Storm + hail', 99: 'Storm + hail'
  };
  function wmoLabel(code) { return WMO[code] || 'Code ' + code; }
  /* Shoot-risk score 0–100 from the daily forecast row. */
  function shootRisk(day) {
    var risk = 0;
    if (day.precipProb != null) risk += day.precipProb * 0.6;
    if (day.windMax != null && day.windMax > 30) risk += Math.min(25, (day.windMax - 30) * 1.2);
    if (day.code >= 95) risk += 30; else if (day.code >= 61 && day.code <= 86) risk += 15;
    return Math.min(100, Math.round(risk));
  }

  root.TSun = { sunTimes: sunTimes, fmtLocal: fmtLocal, daylightHours: daylightHours,
    weatherUrl: weatherUrl, wmoLabel: wmoLabel, shootRisk: shootRisk,
    sunPosition: sunPosition, sunAngles: sunAngles, solarNoon: solarNoon, compass: compass,
    tzOffsetFromWeather: tzOffsetFromWeather, tzOffsetFromLon: tzOffsetFromLon, tzLabel: tzLabel };
})(typeof window !== 'undefined' ? window : globalThis);
