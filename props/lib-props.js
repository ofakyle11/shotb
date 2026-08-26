/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Props Department engine (CProps)
   Pure logic, no DOM: script→prop breakdown, rental pricing (the industry
   "10% rule": weekly rental ≈ 10% of replacement value), buy-vs-rent calls,
   prop-house sourcing (curated hub directory + OpenStreetMap lookups), and
   quote-request generation. Phone numbers are NEVER invented here — they
   come from map data, the bridge research service, or the user's own edits.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── 1 · pricing categories ─────────────────────────────────────────────
     value  = typical replacement value (USD) used by the 10% weekly rule
     day    = per-day rate for things the industry prices daily
     buyOnly= consumables that cannot be rented                              */
  var CATEGORIES = [
    { id: 'weapon',      label: 'Weapons & armory',    value: 1200, armorer: true,
      note: 'Rentals only through licensed armorers — armorer day rate is added automatically.' },
    { id: 'vehicle',     label: 'Picture vehicles',    value: 20000, day: 400,
      note: 'Priced per shoot day, driver/wrangling not included.' },
    { id: 'furniture',   label: 'Furniture',           value: 900 },
    { id: 'electronics', label: 'Electronics & tech',  value: 450 },
    { id: 'setdress',    label: 'Set dressing',        value: 180 },
    { id: 'handprop',    label: 'Hand props',          value: 75 },
    { id: 'greens',      label: 'Greens & florals',    value: 1200 },
    { id: 'food',        label: 'Food & consumables',  value: 60, day: 60, buyOnly: true,
      note: 'Consumables are bought fresh per shoot day, never rented.' },
    { id: 'specialty',   label: 'Specialty / oversize', value: 3500,
      note: 'Pianos, neon, medical rigs, coffins — quote early, these book out.' }
  ];
  var CAT_BY_ID = {};
  CATEGORIES.forEach(function (c) { CAT_BY_ID[c.id] = c; });

  /* ── real-world size, so a prop can stand on a set ───────────────────
     A props list that knows what a thing IS but not how big it is cannot
     answer the question the department actually asks: will it fit through
     the door, will it read in frame, does it block the camera. These are
     honest defaults per category in feet (width x depth x height), and
     every one is overridable per item. */
  var CAT_DIMS = {
    weapon:      { w: 3.0, d: 0.6, h: 0.6 },
    vehicle:     { w: 6.2, d: 15.0, h: 5.0 },
    furniture:   { w: 4.0, d: 2.0, h: 2.6 },
    electronics: { w: 1.6, d: 1.2, h: 1.4 },
    setdress:    { w: 1.4, d: 1.4, h: 1.8 },
    handprop:    { w: 0.7, d: 0.5, h: 0.6 },
    greens:      { w: 2.2, d: 2.2, h: 4.5 },
    food:        { w: 1.2, d: 1.0, h: 0.6 },
    specialty:   { w: 5.0, d: 4.0, h: 4.0 }
  };
  var DEFAULT_DIMS = { w: 2, d: 2, h: 2 };

  function dimsFor(item) {
    var base = CAT_DIMS[item && item.cat] || DEFAULT_DIMS;
    function pick(v, fallback) {
      var n = +v;
      return isFinite(n) && n > 0 ? n : fallback;
    }
    return {
      w: pick(item && item.w, base.w),
      d: pick(item && item.d, base.d),
      h: pick(item && item.h, base.h)
    };
  }

  /* A prop placed on a set becomes an ordinary set item, so the Set
     Designer needs no knowledge of props at all — it just draws a box with
     a name, at the size the props list says it is. propId ties the two
     together so a size change here can follow it there. */
  function toSetItem(item, x, y) {
    var d = dimsFor(item);
    return {
      id: 'prop_' + String((item && item.id) || 'x').replace(/[^A-Za-z0-9_-]/g, ''),
      type: 'custom',
      x: isFinite(+x) ? +x : 6,
      y: isFinite(+y) ? +y : 6,
      w: d.w, h: d.d, hgt: d.h, z: 0, rot: 0,
      label: String((item && item.name) || 'Prop').slice(0, 60),
      propId: (item && item.id) || null
    };
  }

  /* Does it physically go through the opening? The question that stops a
     truck arriving with something that will not fit the stage door. */
  function fitsThrough(item, openW, openH) {
    var d = dimsFor(item);
    var w = +openW, h = +openH;
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
    /* Allowed to be turned on its side or stood on end — which is what
       anyone actually does with a doorway. */
    var footprints = [[d.w, d.h], [d.h, d.w], [d.d, d.h], [d.h, d.d], [d.w, d.d], [d.d, d.w]];
    var ok = footprints.some(function (f) { return f[0] <= w && f[1] <= h; });
    return { fits: ok, dims: d, opening: { w: w, h: h } };
  }

  /* ── 2 · breakdown lexicon (term → category) ──────────────────────────── */
  var LEX = [
    ['weapon', 'gun|pistol|revolver|rifle|shotgun|firearm|sword|dagger|knife|machete|axe|bow|crossbow|grenade|bomb'],
    ['vehicle', 'car|truck|van|bus|taxi|cab|motorcycle|motorbike|bicycle|police cruiser|ambulance|limousine|tractor|boat|canoe'],
    ['furniture', 'sofa|couch|armchair|recliner|table|desk|chair|stool|bench|bed|cot|mattress|dresser|wardrobe|bookshelf|bookcase|cabinet|crib'],
    ['electronics', 'television|tv set|computer|laptop|monitor|telephone|cell phone|cellphone|smartphone|radio|walkie|typewriter|record player|turntable|jukebox|projector|microphone|tape recorder'],
    ['setdress', 'lamp|chandelier|rug|carpet|curtain|drape|mirror|painting|portrait|poster|vase|clock|candle|candelabra|tapestry|trophy|globe|birdcage'],
    ['handprop', 'briefcase|suitcase|backpack|duffel|letter|envelope|newspaper|magazine|book|journal|diary|notebook|map|photograph|photo|wallet|purse|watch|ring|necklace|locket|key|keys|badge|handcuffs|rope|chain|flashlight|lantern|binoculars|umbrella|cane|glasses|sunglasses|lighter|cigarette|cigar|pipe|bottle|flask|glass|mug|cup|tray|syringe|scalpel|bandage|pill|medal|coin|cash|money|doll|toy|chess|cards|dice|guitar|violin|camera'],
    ['greens', 'tree|hedge|bush|flowers|bouquet|garden|ivy|wreath|potted plant'],
    ['food', 'dinner|breakfast|lunch|meal|feast|cake|pie|bread|coffee|tea|wine|whiskey|whisky|beer|champagne|cocktail|soup|fruit'],
    ['specialty', 'piano|organ|harp|slot machine|neon sign|safe|vault|coffin|casket|throne|altar|hospital bed|gurney|wheelchair|lab equipment|telescope|suit of armor|taxidermy|mannequin|cannon']
  ];
  var LEXICON = [];
  LEX.forEach(function (pair) {
    pair[1].split('|').forEach(function (term) {
      LEXICON.push({ term: term, re: new RegExp('\\b' + term.replace(/ /g, '\\s+') + 's?\\b', 'i'), cat: pair[0] });
    });
  });

  /* Split a screenplay into scenes on sluglines; scene 0 catches preamble. */
  function splitScenes(text) {
    var lines = String(text || '').split(/\r?\n/);
    var scenes = [], cur = { n: 0, slug: '', body: [] };
    lines.forEach(function (ln) {
      if (/^\s*(?:\d+[\s.]*)?(INT|EXT|INT\/EXT|I\/E)[.\s]/i.test(ln)) {
        if (cur.body.length || cur.slug) scenes.push(cur);
        cur = { n: scenes.length + 1, slug: ln.trim(), body: [] };
      } else cur.body.push(ln);
    });
    if (cur.body.length || cur.slug) scenes.push(cur);
    return scenes.filter(function (s) { return s.slug || s.body.join('').trim(); });
  }

  /* breakdown(scriptText) → [{name, cat, scenes:[n..], qty}] deduped by term */
  function breakdown(scriptText) {
    var scenes = splitScenes(scriptText);
    var found = {};
    scenes.forEach(function (sc) {
      var body = sc.body.join('\n');
      LEXICON.forEach(function (lx) {
        if (!lx.re.test(body)) return;
        var k = lx.term;
        if (!found[k]) found[k] = { name: cap(lx.term), cat: lx.cat, scenes: [], qty: 1 };
        if (found[k].scenes.indexOf(sc.n) < 0) found[k].scenes.push(sc.n);
      });
    });
    return Object.keys(found).sort().map(function (k, i) {
      var f = found[k];
      return { id: 'p' + (i + 1), name: f.name, cat: f.cat, scenes: f.scenes,
               qty: 1, mode: 'auto', hero: false, period: false, value: 0, actual: 0 };
    });
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ── 3 · pricing ────────────────────────────────────────────────────────
     plan = { weeks, shootDays, weaponDays }                                 */
  var ARMORER_DAY = 650;
  function baseValue(item) {
    var cat = CAT_BY_ID[item.cat] || CAT_BY_ID.handprop;
    var v = item.value > 0 ? +item.value : cat.value;
    if (item.hero) v *= 3;                   // hero props are built/dressed to close-up spec
    if (item.period) v *= 1.6;               // period-correct stock is scarcer
    return v;
  }
  /* Weekly rental with the standard long-run discount: first week full rate,
     following weeks at 75%. */
  function rentCost(item, plan) {
    var cat = CAT_BY_ID[item.cat] || CAT_BY_ID.handprop;
    var qty = Math.max(1, +item.qty || 1);
    if (cat.buyOnly) return { rent: 0, buy: (cat.day || cat.value) * Math.max(1, plan.shootDays || 1) * qty, mode: 'buy' };
    if (cat.day && item.cat === 'vehicle') {
      var days = Math.min(plan.shootDays || 5, Math.max(1, item.scenes.length * 2));
      return { rent: cat.day * days * qty, buy: baseValue(item) * qty, mode: 'rent', days: days };
    }
    var weeks = Math.max(1, plan.weeks || 4);
    var weekly = baseValue(item) * 0.10;
    var rent = weekly * (1 + 0.75 * (weeks - 1)) * qty;
    return { rent: Math.round(rent), buy: Math.round(baseValue(item) * qty), mode: null };
  }
  /* Buy when renting exceeds ~60% of purchase (assumes ~40% resale/asset
     recovery at wrap) — that's the working buy-vs-rent break-even. */
  function decide(item, plan) {
    var c = rentCost(item, plan);
    if (c.mode) return c.mode;
    return c.rent > c.buy * 0.6 ? 'buy' : 'rent';
  }
  function priceItem(item, plan) {
    var c = rentCost(item, plan);
    var mode = item.mode && item.mode !== 'auto' ? item.mode : (c.mode || decide(item, plan));
    var cost = mode === 'buy' ? c.buy : c.rent;
    var mult = 1, learnedN = 0;
    if (root.CLearn) {
      try {
        var cal = root.CLearn.calibration('props:' + item.cat);
        if (cal && cal.n >= 2) { mult = cal.mult; learnedN = cal.n; }
      } catch (e) {}
    }
    return { id: item.id, name: item.name, cat: item.cat, mode: mode, qty: Math.max(1, +item.qty || 1),
             est: Math.round(cost * mult), raw: Math.round(cost), mult: mult, learnedN: learnedN,
             scenes: item.scenes, days: c.days };
  }
  function estimate(items, plan) {
    plan = plan || {};
    var rows = (items || []).map(function (it) { return priceItem(it, plan); });
    var subtotal = rows.reduce(function (a, r) { return a + r.est; }, 0);
    var hasWeapons = (items || []).some(function (it) { return (CAT_BY_ID[it.cat] || {}).armorer; });
    var armorer = hasWeapons ? ARMORER_DAY * Math.max(1, plan.weaponDays || Math.min(plan.shootDays || 3, 3)) : 0;
    var contingency = Math.round((subtotal + armorer) * 0.10);
    return { rows: rows, subtotal: subtotal, armorer: armorer, contingency: contingency,
             total: subtotal + armorer + contingency };
  }
  /* Feed a real quote back into the learning layer (per-category multiplier). */
  function recordQuote(item, plan, actual) {
    if (!root.CLearn || !(actual > 0)) return 0;
    var est = priceItem(item, plan).raw;
    if (!(est > 0)) return 0;
    try {
      return root.CLearn.learnBudget({ categories: [{ acct: 'props:' + item.cat,
        items: [{ desc: item.name, est: est, actual: +actual }] }] });
    } catch (e) { return 0; }
  }

  /* ── 4 · sourcing: curated hubs + OpenStreetMap ─────────────────────────
     Directory entries carry NO phone numbers — numbers come from live map
     data, the bridge research service, or the user editing the card.       */
  var HUBS = {
    'toronto':     { city: 'Toronto, Canada', houses: [
      { name: 'Prop Portfolio', spec: 'Film & TV prop rental — furniture to hand props' },
      { name: 'Malabar', spec: 'Period costumes & accessories (long-standing Toronto house)' }] },
    'vancouver':   { city: 'Vancouver, Canada', houses: [
      { name: 'Independent Studio Services (Vancouver)', spec: 'Full-service props, weapons, graphics' }] },
    'montreal':    { city: 'Montreal, Canada', houses: [] },
    'los-angeles': { city: 'Los Angeles, USA', houses: [
      { name: 'Independent Studio Services (ISS)', spec: 'Full-service — props, armory, graphics, clearances' },
      { name: 'History for Hire', spec: 'Period props — instruments, cameras, signage, Americana' },
      { name: 'LCW Props', spec: 'Electronics, industrial, medical, aerospace set dressing' },
      { name: 'The Hand Prop Room', spec: 'Hand props, weapons, ceremonial, ethnographic' },
      { name: 'Omega Cinema Props', spec: 'Furniture & set dressing, all periods' }] },
    'atlanta':     { city: 'Atlanta, USA', houses: [
      { name: 'Independent Studio Services (Atlanta)', spec: 'Full-service props & armory' }] },
    'new-york':    { city: 'New York, USA', houses: [
      { name: 'City Knickerbocker', spec: 'Lighting props & fixtures since 1906' }] },
    'london':      { city: 'London, UK', houses: [
      { name: 'Farley', spec: 'Prop hire — furniture, smalls, period through modern' },
      { name: 'Superhire', spec: 'Film & TV prop hire, large stock' }] },
    'albuquerque': { city: 'Albuquerque, USA', houses: [] },
    'new-orleans': { city: 'New Orleans, USA', houses: [] },
    'dublin':      { city: 'Dublin, Ireland', houses: [] },
    'budapest':    { city: 'Budapest, Hungary', houses: [] },
    'prague':      { city: 'Prague, Czechia', houses: [] },
    'sydney':      { city: 'Sydney, Australia', houses: [] },
    'wellington':  { city: 'Wellington, New Zealand', houses: [] },
    'reykjavik':   { city: 'Reykjavik, Iceland', houses: [] },
    'valletta':    { city: 'Valletta, Malta', houses: [] },
    'rome':        { city: 'Rome, Italy', houses: [] },
    'athens':      { city: 'Athens, Greece', houses: [] },
    'berlin':      { city: 'Berlin, Germany', houses: [] },
    'madrid':      { city: 'Madrid, Spain', houses: [] }
  };
  /* Advisor jurisdiction (SB_Budget_v1.incentive) → nearest production hub */
  var INCENTIVE_HUB = {
    georgia: 'atlanta', california: 'los-angeles', newyork: 'new-york',
    newmexico: 'albuquerque', louisiana: 'new-orleans', ukavec: 'london',
    ukiftc: 'london', ireland: 'dublin', hungary: 'budapest', czech: 'prague',
    australia: 'sydney', nz: 'wellington', bc: 'vancouver', ontario: 'toronto',
    iceland: 'reykjavik', malta: 'valletta', italy: 'rome', greece: 'athens',
    germany: 'berlin', spain: 'madrid'
  };
  function hubForIncentive(id) {
    var k = INCENTIVE_HUB[String(id || '').toLowerCase()];
    return k ? { key: k, city: HUBS[k].city } : null;
  }
  function housesFor(cityText) {
    var lc = String(cityText || '').toLowerCase();
    var hit = null;
    Object.keys(HUBS).forEach(function (k) {
      if (lc.indexOf(k.replace('-', ' ')) >= 0 || lc.indexOf(HUBS[k].city.split(',')[0].toLowerCase()) >= 0) hit = k;
    });
    return hit ? HUBS[hit].houses.map(function (h) {
      return { name: h.name, spec: h.spec, source: 'directory', phone: null, website: null };
    }) : [];
  }

  var NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
  var OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
  function buildNominatimUrl(city) {
    return NOMINATIM_URL + '?format=json&limit=1&q=' + encodeURIComponent(city);
  }
  function parseNominatim(json) {
    var r = Array.isArray(json) && json[0];
    return r ? { lat: +r.lat, lon: +r.lon, label: r.display_name } : null;
  }
  function buildOverpassQL(lat, lon, km) {
    var r = Math.round((km || 30) * 1000);
    var at = '(around:' + r + ',' + lat + ',' + lon + ')';
    return '[out:json][timeout:25];(' +
      'node["name"~"prop house|prop rental|props|prop shop|film rental|movie rental|studio rental",i]' + at + ';' +
      'way["name"~"prop house|prop rental|props|prop shop|film rental|movie rental|studio rental",i]' + at + ';' +
      'node["shop"~"props|theatrical|costume",i]' + at + ';' +
      ');out center tags 40;';
  }
  function parseOverpass(json) {
    var els = (json && json.elements) || [];
    return els.map(function (e) {
      var t = e.tags || {};
      var addr = [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(' ');
      return { name: t.name || '(unnamed)', spec: t.shop ? 'Map listing — ' + t.shop : 'Map listing',
               phone: t.phone || t['contact:phone'] || null,
               website: t.website || t['contact:website'] || null,
               address: addr || null, source: 'osm',
               lat: e.lat || (e.center && e.center.lat), lon: e.lon || (e.center && e.center.lon) };
    }).filter(function (h) { return h.name !== '(unnamed)'; });
  }
  /* Merge curated + map results; map data fills phones onto directory names. */
  function mergeHouses(curated, osm) {
    var out = (curated || []).map(function (h) { return Object.assign({}, h); });
    (osm || []).forEach(function (o) {
      var hit = out.filter(function (h) {
        return h.name.toLowerCase().indexOf(o.name.toLowerCase()) >= 0 ||
               o.name.toLowerCase().indexOf(h.name.toLowerCase().split(' (')[0]) >= 0;
      })[0];
      if (hit) { if (!hit.phone) hit.phone = o.phone; if (!hit.website) hit.website = o.website; hit.address = hit.address || o.address; }
      else out.push(o);
    });
    return out;
  }
  function searchLink(house, city) {
    return 'https://www.google.com/search?q=' +
      encodeURIComponent('"' + house.name + '" ' + String(city || '').split(',')[0] + ' props rental phone');
  }

  /* ── 5 · quote request ──────────────────────────────────────────────── */
  function rfq(opts) {
    var o = opts || {};
    var items = (o.items || []).map(function (r) {
      return ' - ' + r.name + '  ×' + (r.qty || 1) + '  (' + (CAT_BY_ID[r.cat] ? CAT_BY_ID[r.cat].label : r.cat) +
             (r.mode ? ', to ' + r.mode : '') + ')';
    }).join('\n');
    return 'QUOTE REQUEST — ' + (o.production || 'Untitled production') + '\n' +
      (o.house ? 'To: ' + o.house + '\n' : '') +
      'Shoot dates: ' + (o.dates || 'TBD') + '\n' +
      'Shooting area: ' + (o.city || 'TBD') + '\n\n' +
      'We are prepping the above production and would like availability and pricing on:\n' +
      items + '\n\n' +
      'Please quote weekly rental rates (and purchase where applicable), damage waiver,\n' +
      'and delivery/pickup options to our stage. Happy to send the full breakdown.\n\n' +
      'Thanks,\n' + (o.contact || '') + '\n' + (o.company || 'CINAMATE production office');
  }

  root.CProps = {
    CAT_DIMS: CAT_DIMS, dimsFor: dimsFor, toSetItem: toSetItem, fitsThrough: fitsThrough,
    CATEGORIES: CATEGORIES, CAT_BY_ID: CAT_BY_ID, ARMORER_DAY: ARMORER_DAY,
    splitScenes: splitScenes, breakdown: breakdown,
    priceItem: priceItem, estimate: estimate, decide: decide, recordQuote: recordQuote,
    HUBS: HUBS, hubForIncentive: hubForIncentive, housesFor: housesFor,
    buildNominatimUrl: buildNominatimUrl, parseNominatim: parseNominatim,
    OVERPASS_URL: OVERPASS_URL, buildOverpassQL: buildOverpassQL, parseOverpass: parseOverpass,
    mergeHouses: mergeHouses, searchLink: searchLink, rfq: rfq
  };
})(typeof window !== 'undefined' ? window : globalThis);
