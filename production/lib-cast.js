/* CINAMATE Cast Intelligence — engine (pure, no DOM, no fetch).
 *
 * Normalizes actor/director filmography data (TMDB movie-credit JSON or
 * Wikidata SPARQL bindings), scores actor↔director fit from real
 * collaboration history and genre overlap, and estimates a quote
 * bracket floored at published SAG-AFTRA scale. All original code,
 * written for Cinamate. Quote brackets are industry-convention
 * estimates calibrated to trade-press reporting — not offers, not
 * accounting advice.
 */
(function (root) {
  'use strict';

  function yearOf(d) { var y = parseInt(String(d || '').slice(0, 4), 10); return isFinite(y) ? y : 0; }

  /* ── TMDB normalizers ───────────────────────────────────────────── */
  /* /search/person → best person hit */
  function parseTmdbSearch(json) {
    var r = (json && json.results) || [];
    if (!r.length) return null;
    var p = r.slice().sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); })[0];
    return { id: p.id, name: p.name, popularity: p.popularity || 0, dept: p.known_for_department || '' };
  }

  /* /person/{id}/movie_credits → actor filmography (cast) */
  function parseTmdbActorCredits(json) {
    var cast = (json && json.cast) || [];
    return cast.filter(function (c) { return c.release_date; })
      .map(function (c) {
        return {
          id: c.id, title: c.title || c.original_title || '',
          year: yearOf(c.release_date), role: c.character || '',
          order: (c.order == null ? 99 : c.order),
          popularity: c.popularity || 0,
          genres: c.genre_ids || []
        };
      })
      .sort(function (a, b) { return b.year - a.year; });
  }

  /* /person/{id}/movie_credits → films the person DIRECTED (crew) */
  function parseTmdbDirectorCredits(json) {
    var crew = (json && json.crew) || [];
    return crew.filter(function (c) { return c.job === 'Director' && c.release_date; })
      .map(function (c) {
        return { id: c.id, title: c.title || '', year: yearOf(c.release_date), genres: c.genre_ids || [] };
      })
      .sort(function (a, b) { return b.year - a.year; });
  }

  /* /movie/{id}/credits → top-billed cast of one film */
  function parseTmdbFilmCast(json, filmId, filmTitle) {
    return ((json && json.cast) || []).slice(0, 12).map(function (c) {
      return { id: c.id, name: c.name, order: (c.order == null ? 99 : c.order), popularity: c.popularity || 0, filmId: filmId, filmTitle: filmTitle || '' };
    });
  }

  /* ── Wikidata (no key needed) ───────────────────────────────────── */
  function wikidataActorQuery(name) {
    var n = String(name).replace(/["\\]/g, '');
    return 'SELECT ?filmLabel ?year ?directorLabel ?genreLabel WHERE {' +
      ' ?actor rdfs:label "' + n + '"@en; wdt:P106/wdt:P279* wd:Q33999 .' +
      ' ?film wdt:P161 ?actor .' +
      ' OPTIONAL { ?film wdt:P577 ?date . BIND(YEAR(?date) AS ?year) }' +
      ' OPTIONAL { ?film wdt:P57 ?director . }' +
      ' OPTIONAL { ?film wdt:P136 ?genre . }' +
      ' SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 400';
  }
  function wikidataDirectorQuery(name) {
    var n = String(name).replace(/["\\]/g, '');
    return 'SELECT ?filmLabel ?year ?castLabel WHERE {' +
      ' ?dir rdfs:label "' + n + '"@en .' +
      ' ?film wdt:P57 ?dir .' +
      ' OPTIONAL { ?film wdt:P577 ?date . BIND(YEAR(?date) AS ?year) }' +
      ' OPTIONAL { ?film wdt:P161 ?cast . }' +
      ' SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 400';
  }
  /* SPARQL bindings → films [{title, year, director, genres[]}] deduped */
  function parseWikidataActor(json) {
    var rows = (((json || {}).results || {}).bindings) || [];
    var by = {};
    rows.forEach(function (b) {
      var t = b.filmLabel && b.filmLabel.value; if (!t || /^Q\d+$/.test(t)) return;
      var f = by[t] || (by[t] = { title: t, year: 0, directors: {}, genres: {} });
      var y = b.year && parseInt(b.year.value, 10);
      if (y) f.year = Math.max(f.year, y);
      if (b.directorLabel && !/^Q\d+$/.test(b.directorLabel.value)) f.directors[b.directorLabel.value] = 1;
      if (b.genreLabel && !/^Q\d+$/.test(b.genreLabel.value)) f.genres[b.genreLabel.value] = 1;
    });
    return Object.keys(by).map(function (t) {
      var f = by[t];
      return { title: f.title, year: f.year, directors: Object.keys(f.directors), genres: Object.keys(f.genres) };
    }).sort(function (a, b) { return b.year - a.year; });
  }
  function parseWikidataDirector(json) {
    var rows = (((json || {}).results || {}).bindings) || [];
    var films = {}, collabs = {};
    rows.forEach(function (b) {
      var t = b.filmLabel && b.filmLabel.value; if (!t || /^Q\d+$/.test(t)) return;
      var f = films[t] || (films[t] = { title: t, year: 0 });
      var y = b.year && parseInt(b.year.value, 10);
      if (y) f.year = Math.max(f.year, y);
      if (b.castLabel && !/^Q\d+$/.test(b.castLabel.value)) {
        var n = b.castLabel.value;
        collabs[n] = (collabs[n] || 0) + 1;
      }
    });
    return {
      films: Object.keys(films).map(function (t) { return films[t]; }).sort(function (a, b) { return b.year - a.year; }),
      collaborators: Object.keys(collabs).map(function (n) { return { name: n, films: collabs[n] }; })
        .sort(function (a, b) { return b.films - a.films; })
    };
  }

  /* ── actor ↔ director fit ───────────────────────────────────────── */
  function genreCounts(films) {
    var c = {};
    (films || []).forEach(function (f) {
      (f.genres || []).forEach(function (g) { c[g] = (c[g] || 0) + 1; });
    });
    return c;
  }
  function overlap01(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (!ka.length || !kb.length) return 0;
    var num = 0, da = 0, db = 0, k;
    for (k in a) { da += a[k] * a[k]; if (b[k]) num += a[k] * b[k]; }
    for (k in b) db += b[k] * b[k];
    return num / (Math.sqrt(da) * Math.sqrt(db));
  }

  /* fit({actorFilms, directorFilms, directorName, nowYear}) → {score, reasons[]}
   * actorFilms may carry per-film .directors (wikidata path) or share
   * numeric ids with directorFilms (tmdb path). */
  function fit(inp) {
    var af = inp.actorFilms || [], df = inp.directorFilms || [];
    var nowYear = inp.nowYear || 2026;
    var reasons = [];
    // direct collaborations
    var direct = 0;
    var dfIds = {};
    df.forEach(function (f) { if (f.id != null) dfIds[f.id] = f.title; });
    var directTitles = [];
    af.forEach(function (f) {
      if (f.id != null && dfIds[f.id] != null) { direct++; directTitles.push(f.title); }
      else if (inp.directorName && (f.directors || []).some(function (d) {
        return d.toLowerCase() === String(inp.directorName).toLowerCase();
      })) { direct++; directTitles.push(f.title); }
    });
    if (direct) reasons.push('Worked with this director before: ' + directTitles.slice(0, 3).join(', ') + (direct > 3 ? ' +' + (direct - 3) + ' more' : ''));
    // genre overlap
    var g = overlap01(genreCounts(af), genreCounts(df));
    if (g > 0.55) reasons.push('Strong genre overlap with the director\'s work');
    else if (g > 0.3) reasons.push('Some genre overlap with the director\'s work');
    // recency
    var lastYear = af.length ? af[0].year : 0;
    var active = lastYear >= nowYear - 2;
    if (active) reasons.push('Recently active (' + lastYear + ')');
    else if (lastYear) reasons.push('Last credit ' + lastYear + ' — check availability');
    // project genre match
    if (inp.projectGenre) {
      var pg = String(inp.projectGenre).toLowerCase();
      var inGenre = af.slice(0, 12).some(function (f) {
        return (f.genres || []).some(function (x) { return String(x).toLowerCase().indexOf(pg) >= 0; });
      });
      if (inGenre) reasons.push('Has recent ' + inp.projectGenre + ' credits');
    }
    var score = Math.round(Math.min(100,
      Math.min(direct, 3) * 22 +        // history with the director dominates
      g * 30 +                           // shared sensibility
      (active ? 16 : 4) +
      Math.min(af.length, 20)            // body of work
    ));
    if (!reasons.length) reasons.push('No shared history found — a fresh pairing');
    return { score: score, direct: direct, genreOverlap: Math.round(g * 100) / 100, reasons: reasons };
  }

  /* ── quote estimate ─────────────────────────────────────────────── */
  /* SAG-AFTRA theatrical scale (2025-26 published): ~$1,204/day,
   * $4,181/week. Brackets above scale follow trade-reported convention
   * bands; profit participation not modeled. */
  var SCALE = { day: 1204, week: 4181 };
  var TIERS = [
    { tier: 'Scale / day player', low: SCALE.week, high: 25e3 },
    { tier: 'Established supporting', low: 25e3, high: 150e3 },
    { tier: 'Name', low: 150e3, high: 1e6 },
    { tier: 'Star', low: 1e6, high: 5e6 },
    { tier: 'A-list', low: 5e6, high: 20e6 }
  ];
  function quote(inp) {
    inp = inp || {};
    if (inp.knownQuote > 0) {
      return { tier: 'Known quote', low: inp.knownQuote, high: inp.knownQuote, floor: SCALE, basis: ['Reported/entered quote — overrides the model'] };
    }
    var films = inp.films || [];
    var nowYear = inp.nowYear || 2026;
    var recent = films.filter(function (f) { return f.year >= nowYear - 6; });
    var leadish = recent.filter(function (f) { return f.order != null && f.order <= 2; }).length;
    var pop = inp.popularity || 0;
    var idx = 0;
    if (recent.length >= 3) idx = 1;
    if (leadish >= 2 || pop >= 12) idx = 2;
    if ((leadish >= 4 && pop >= 20) || pop >= 35) idx = 3;
    if (pop >= 60 && leadish >= 4) idx = 4;
    var t = TIERS[idx];
    var basis = [
      recent.length + ' credits in the last 6 years',
      leadish ? leadish + ' recent top-2-billed roles' : 'no recent top-billed roles found'
    ];
    if (pop) basis.push('audience-demand index ' + Math.round(pop));
    basis.push('floor: SAG-AFTRA scale $' + SCALE.day.toLocaleString('en-US') + '/day');
    return { tier: t.tier, low: t.low, high: t.high, floor: SCALE, basis: basis };
  }

  /* rank a director's frequent collaborators as suggestions */
  function suggest(collaborators, excludeName, limit) {
    var ex = String(excludeName || '').toLowerCase();
    return (collaborators || [])
      .filter(function (c) { return c.name.toLowerCase() !== ex && c.films >= 1; })
      .slice(0, limit || 8);
  }

  root.CCast = {
    parseTmdbSearch: parseTmdbSearch,
    parseTmdbActorCredits: parseTmdbActorCredits,
    parseTmdbDirectorCredits: parseTmdbDirectorCredits,
    parseTmdbFilmCast: parseTmdbFilmCast,
    wikidataActorQuery: wikidataActorQuery,
    wikidataDirectorQuery: wikidataDirectorQuery,
    parseWikidataActor: parseWikidataActor,
    parseWikidataDirector: parseWikidataDirector,
    fit: fit, quote: quote, suggest: suggest,
    SCALE: SCALE, TIERS: TIERS
  };
})(typeof window !== 'undefined' ? window : globalThis);
