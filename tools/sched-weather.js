/* Shoot-day weather & daylight planner — decorates the Producer Suite
 * Schedule tab. Give it a start date and a location; every shoot day on
 * the board gets its calendar date, sunrise/sunset, golden hours, and a
 * live forecast with a shoot-risk score (Open-Meteo public API, keyless,
 * fetched straight from this browser).
 *
 * All original code, written for Cinamate. Solar math: tools/lib-sun.js.
 */
(function (root) {
  'use strict';
  var KEY = 'SB_ShootPlan_v1';
  /* Escaping for any value interpolated into the markup below — all five of
     & < > " ' so a value can never break out of an attribute or a tag. */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; } }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }

  var CITIES = {
    '': ['Custom lat/lon', null, null],
    la: ['Los Angeles', 34.05, -118.24], nyc: ['New York', 40.71, -74.01],
    atl: ['Atlanta', 33.75, -84.39], nola: ['New Orleans', 29.95, -90.07],
    chi: ['Chicago', 41.88, -87.63], abq: ['Albuquerque', 35.08, -106.65],
    van: ['Vancouver', 49.28, -123.12], tor: ['Toronto', 43.65, -79.38],
    lon: ['London', 51.51, -0.13], dub: ['Dublin', 53.35, -6.26],
    bud: ['Budapest', 47.50, 19.04], syd: ['Sydney', -33.87, 151.21]
  };

  function ymd(d) { return d.toISOString().slice(0, 10); }
  function addDays(dateStr, n, skipWeekends) {
    var d = new Date(dateStr + 'T12:00:00Z');
    var added = 0;
    while (added < n) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (skipWeekends && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) continue;
      added++;
    }
    return ymd(d);
  }

  function dayCount() {
    var days = document.querySelectorAll('#sbDays .ps-day, #sbDays [data-day]');
    var n = 0;
    var seen = {};
    Array.prototype.forEach.call(days, function (el) {
      var d = el.getAttribute('data-day');
      if (d != null && d !== '-1' && !seen[d]) { seen[d] = 1; n++; }
    });
    if (n) return n;
    var kids = document.querySelectorAll('#sbDays > *').length;
    return kids > 0 ? kids : 5;
  }

  function mount() {
    var pane = $('pane-schedule');
    if (!pane || $('swWrap')) return;
    var bar = document.createElement('div');
    bar.id = 'swWrap';
    bar.innerHTML = '<div class="ps-toolbar" style="border-top:1px solid var(--border)">' +
      '<span class="ps-hint" style="color:var(--gold)">☀ Day planner</span>' +
      '<label class="ps-inline">Day 1 <input type="date" id="swDate" style="width:140px"></label>' +
      '<select class="uc-sel" id="swCity">' + Object.keys(CITIES).map(function (k) {
        return '<option value="' + esc(k) + '">' + CITIES[k][0] + '</option>';
      }).join('') + '</select>' +
      '<label class="ps-inline">lat <input id="swLat" style="width:64px" placeholder="34.05"></label>' +
      '<label class="ps-inline">lon <input id="swLon" style="width:70px" placeholder="-118.24"></label>' +
      '<label class="ps-inline"><input type="checkbox" id="swWk" style="width:auto" checked> skip weekends</label>' +
      '<label class="ps-inline">days <input id="swN" type="number" min="1" max="60" style="width:56px" placeholder="auto" title="How many shoot days to plan — blank follows the stripboard"></label>' +
      '<button class="tb-btn gold" id="swGo">Plan days</button>' +
      '</div><div id="swOut" style="padding:0 14px 8px"></div>';
    var board = $('sbDays') ? $('sbDays').closest('.ps-board') : null;
    pane.insertBefore(bar, board || pane.children[1] || null);

    var p = load();
    if (p.date) $('swDate').value = p.date;
    if (p.city != null) $('swCity').value = p.city;
    if (p.lat != null) $('swLat').value = p.lat;
    if (p.lon != null) $('swLon').value = p.lon;
    if (p.skipWk === false) $('swWk').checked = false;
    if (p.n) $('swN').value = p.n;
    $('swCity').addEventListener('change', function () {
      var c = CITIES[this.value];
      if (c && c[1] != null) { $('swLat').value = c[1]; $('swLon').value = c[2]; }
    });
    $('swGo').addEventListener('click', plan);
    if (p.date && p.lat) plan();
  }

  function plan() {
    var S = root.TSun;
    var date = $('swDate').value;
    var lat = parseFloat($('swLat').value), lon = parseFloat($('swLon').value);
    if (!date || !isFinite(lat) || !isFinite(lon)) {
      $('swOut').innerHTML = '<p class="bud-note">Pick a start date and a location first.</p>';
      return;
    }
    var skipWk = $('swWk').checked;
    var nOverride = parseInt($('swN').value, 10);
    save({ date: date, city: $('swCity').value, lat: lat, lon: lon, skipWk: skipWk, n: nOverride || '' });
    var n = nOverride > 0 ? Math.min(60, nOverride) : Math.max(dayCount(), 5);
    var days = [];
    var cur = date;
    // day 1 lands on/after the chosen date honoring the weekend rule
    var d0 = new Date(date + 'T12:00:00Z');
    if (skipWk && (d0.getUTCDay() === 0 || d0.getUTCDay() === 6)) cur = addDays(date, 1, true);
    for (var i = 0; i < n; i++) {
      days.push(cur);
      cur = addDays(cur, 1, skipWk);
    }
    var rows = days.map(function (d, i) {
      var t = S.sunTimes(d, lat, lon);
      return { i: i + 1, date: d, sun: t };
    });
    renderRows(rows, null);
    // live forecast (Open-Meteo covers ~16 days out)
    fetch(S.weatherUrl(lat, lon, days[0], days[days.length - 1]))
      .then(function (r) { return r.json(); })
      .then(function (w) {
        var byDate = {};
        if (w && w.daily && w.daily.time) w.daily.time.forEach(function (d, i) {
          byDate[d] = {
            code: w.daily.weather_code[i],
            tmax: Math.round(w.daily.temperature_2m_max[i]),
            tmin: Math.round(w.daily.temperature_2m_min[i]),
            precipProb: w.daily.precipitation_probability_max[i],
            windMax: w.daily.wind_speed_10m_max[i]
          };
        });
        renderRows(rows, byDate);
      })
      .catch(function () { /* astro-only view already rendered */ });
  }

  function renderRows(rows, wx) {
    var S = root.TSun;
    var h = '<div class="bud-tablewrap"><table class="bud-table"><thead><tr><th>Day</th><th>Date</th><th>Sunrise</th><th>Golden AM ends</th><th>Golden PM starts</th><th>Sunset</th><th>Daylight</th><th>Forecast</th><th>Risk</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var t = r.sun;
      var w = wx && wx[r.date];
      var risk = w ? S.shootRisk(w) : null;
      var dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(r.date + 'T12:00:00Z').getUTCDay()];
      h += '<tr><td><b>Day ' + esc(r.i) + '</b></td><td>' + dow + ' ' + esc(r.date) + '</td>' +
        '<td>' + S.fmtLocal(t.sunrise) + '</td><td>' + S.fmtLocal(t.goldenEndAM) + '</td>' +
        '<td style="color:var(--gold)">' + S.fmtLocal(t.goldenStartPM) + '</td><td>' + S.fmtLocal(t.sunset) + '</td>' +
        '<td>' + esc(S.daylightHours(t) || '—') + 'h</td>' +
        '<td>' + (w ? esc(S.wmoLabel(w.code)) + ' · ' + esc(w.tmin) + '–' + esc(w.tmax) + '° · ' + esc(w.precipProb || 0) + '% rain' : '<span style="color:var(--dim)">beyond forecast</span>') + '</td>' +
        '<td>' + (risk == null ? '—' : '<span class="tk-chip ' + (risk >= 50 ? 'bad' : risk >= 25 ? 'warn' : 'good') + '">' + risk + '</span>') + '</td></tr>';
    });
    h += '</tbody></table></div>' +
      '<p class="bud-note">Sun times computed locally (±2 min); forecast from the free Open-Meteo API, fetched by your browser. Risk blends rain probability, wind and storm codes — reorder exterior days away from red.</p>';
    $('swOut').innerHTML = h;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})(typeof window !== 'undefined' ? window : globalThis);
