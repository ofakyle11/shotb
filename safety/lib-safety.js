/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Safety & Risk engine (CSafety)
   Risk assessments in the standard hazard/severity/mitigation/responsible
   format, drafted automatically from the screenplay: the same scene text
   that drives the budget flags stunts, weapons, water, fire, animals,
   vehicles, heights, night work and crowds — each mapped to the control
   measures and required personnel productions actually use. Plus the
   safety-meeting checklist and the incident log. Pure logic, no DOM.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  /* The one scene model — js/lib-scenes.js. Every module used to carry its
     own screenplay splitter; they disagreed on preambles, printed scene
     numbers and A/B scenes, so they now all read from here. Loaded by a
     <script> tag before this file, and by the node suites. */
  var CS = root.CScenes;
  if (!CS) throw new Error('lib-safety.js requires js/lib-scenes.js to be loaded first');


  /* severity: 3 = stop-and-plan, 2 = supervised, 1 = note-and-brief */
  var HAZARDS = [
    { id: 'weapons', label: 'Weapons / firearms', sev: 3,
      re: /\b(gun|pistol|revolver|rifle|shotgun|firearm|muzzle|blank[s]? fired|sword|machete|knife fight)\b/i,
      personnel: 'Licensed armorer on set',
      controls: ['No live ammunition on the premises — ever',
        'Armorer controls custody, loading and every hand-off',
        'Muzzle discipline briefing for all cast handling weapons',
        'Cold/hot weapon announcements before each setup'] },
    { id: 'stunts', label: 'Stunts / fights / falls', sev: 3,
      re: /\b(stunt|fight[s]?|brawl|punches|tackles|falls? (?:from|down|off)|leaps? (?:from|off)|crash(?:es)? through|thrown (?:from|through))\b/i,
      personnel: 'Stunt coordinator',
      controls: ['Stunt coordinator plans and rehearses every beat',
        'Pads, rigging and catchers inspected before each take',
        'Medic on set with clear evacuation route',
        'No unplanned contact — action stops on "cut" or any call of "safety"'] },
    { id: 'fire', label: 'Fire / pyrotechnics / smoke', sev: 3,
      re: /\b(fire|flames?|burn(?:s|ing)?|explosion|explodes?|pyro|torch|candle[s]? (?:tips|catches)|smoke fills)\b/i,
      personnel: 'Licensed pyrotechnician + fire safety officer',
      controls: ['Permits filed with local fire authority',
        'Extinguishers and fire blankets staged at camera and at effect',
        'Burn suits/gel for any performer near flame',
        'Smoke effects ventilated; SDS available for all fluids'] },
    { id: 'water', label: 'Water work', sev: 3,
      re: /\b(underwater|drown(?:s|ing)?|swim(?:s|ming)?|river|lake|ocean|sea |boat|canoe|raft|dives? in(?:to)?|falls? in(?:to)? the water)\b/i,
      personnel: 'Water safety officer + certified rescue swimmer',
      controls: ['Safety boat and throw lines in position before rehearsal',
        'Cast swim ability confirmed in writing',
        'Water temperature and current assessed each day',
        'Wetsuit/rewarming plan for prolonged immersion'] },
    { id: 'vehicles', label: 'Vehicle work / driving', sev: 2,
      re: /\b(car chase|chase[s]? (?:the|a|him|her|them)|speeds? (?:away|off|down)|swerves?|crash(?:es)?|driving|drives|motorcycle|truck)\b/i,
      personnel: 'Precision driver + process trailer where doubles drive',
      controls: ['Closed or controlled roads with lockups — never live traffic',
        'Camera positions protected from vehicle path',
        'Walkie protocol rehearsed before first run',
        'Picture vehicles inspected (brakes, belts, kill switch)'] },
    { id: 'heights', label: 'Work at height', sev: 2,
      re: /\b(rooftop|roof edge|cliff|ledge|balcony|scaffold|climbs? (?:up|the)|hangs? (?:from|off)|window ledge)\b/i,
      personnel: 'Rigging grip / certified rigger',
      controls: ['Fall protection above 6 ft — harness, rails or nets',
        'Rigging inspected and load-rated before use',
        'Exclusion zone below all overhead work'] },
    { id: 'animals', label: 'Animals on set', sev: 2,
      re: /\b(dog|horse|cattle|snake|wolf|bird[s]? (?:of prey)?|cat leaps|animal)\b/i,
      personnel: 'Professional animal wrangler',
      controls: ['Wrangler controls all handling; cast briefed on approach',
        'Humane-treatment standards observed and documented',
        'Set quieted for animal work; escape routes planned'] },
    { id: 'night', label: 'Night exteriors', sev: 1,
      re: /^(?:.*\b(EXT\.?)[^\n]*\b(NIGHT|DUSK|DAWN)\b)/im,
      personnel: '1st AD monitors turnaround',
      controls: ['Lit paths between set, trucks and parking',
        'Minimum 10-hour turnaround protected',
        'Drive-home risk assessed after long night shoots'] },
    { id: 'crowds', label: 'Crowd scenes / background', sev: 1,
      re: /\b(crowd[s]?|mob|riot|protest|stampede|packed (?:bar|club|street)|hundreds of)\b/i,
      personnel: 'Extras marshals (1 per 20 background)',
      controls: ['Clear entry/exit routes and assembly point',
        'PA count of background in and out',
        'Amplified briefing before first rehearsal'] },
    { id: 'electrical', label: 'Electrical / generators / rain', sev: 2,
      re: /\b(rain (?:hammers|pours|machine)|storm|downpour|soaked|generator|power lines?)\b/i,
      personnel: 'Gaffer + licensed electrician',
      controls: ['GFCI protection on all distribution near water/rain effects',
        'Cable crossings ramped and flagged',
        'Weather watch with wind/lightning stop conditions'] },
    { id: 'aerial', label: 'Drones / aerial', sev: 2,
      re: /\b(drone|aerial shot|helicopter|from above the (?:city|crowd))\b/i,
      personnel: 'Licensed drone operator (Part 107 / SFOC)',
      controls: ['Flight plan filed; airspace checked',
        'Never overfly unprotected cast or crowd',
        'Spotter separate from operator'] }
  ];

  /* Safety scans real scenes only — the title page is not a scene, and the
     private copy here silently dropped everything before the first slugline
     rather than keeping it as a preamble. CScenes.parse().scenes preserves
     exactly that behaviour, deliberately. */
  var splitScenes = CS.split;
  function realScenes(text) { return CS.parse(text).scenes; }

  /* analyze(scriptText) → per-scene hazard findings */
  function analyze(scriptText) {
    var scenes = realScenes(scriptText);
    var out = [];
    scenes.forEach(function (sc) {
      var text = sc.slug + '\n' + sc.body.join('\n');
      var hits = HAZARDS.filter(function (h) { return h.re.test(text); });
      if (hits.length) {
        out.push({ scene: sc.n, label: sc.label, slug: sc.slug,
          hazards: hits.map(function (h) {
            return { id: h.id, label: h.label, sev: h.sev, personnel: h.personnel, controls: h.controls };
          }),
          score: hits.reduce(function (a, h) { return a + h.sev; }, 0) });
      }
    });
    return { scenes: scenes.length, flagged: out,
             riskScore: out.reduce(function (a, s) { return a + s.score; }, 0),
             personnel: unique(out.reduce(function (a, s) {
               return a.concat(s.hazards.map(function (h) { return h.personnel; })); }, [])) };
  }
  function unique(arr) {
    var seen = {}; return arr.filter(function (x) { return seen[x] ? false : (seen[x] = 1); });
  }

  /* the printable risk assessment — one block per flagged scene */
  function assessmentText(analysis, production, preparedBy, when) {
    var out = 'RISK ASSESSMENT — ' + (production || 'Untitled production') + '\n' +
      'Prepared by: ' + (preparedBy || '') + '   Date: ' + (when || '') + '\n' +
      'Method: hazard identification per scene · severity 1–3 · control measures · responsible person\n' +
      '─────────────────────────────────────────────────────────────\n\n';
    analysis.flagged.forEach(function (s) {
      out += 'SCENE ' + s.scene + ' — ' + s.slug + '\n';
      s.hazards.forEach(function (h) {
        out += '  [' + 'LOW MED HIGH'.split(' ')[h.sev - 1] + '] ' + h.label + '\n';
        out += '      Responsible: ' + h.personnel + '\n';
        h.controls.forEach(function (c) { out += '      · ' + c + '\n'; });
      });
      out += '\n';
    });
    out += 'Required specialist personnel across the schedule:\n';
    analysis.personnel.forEach(function (p) { out += '  · ' + p + '\n'; });
    out += '\nAll hazards to be re-assessed on the day by the 1st AD at the safety meeting.\n';
    return out;
  }

  /* morning safety meeting bullets for a set of scene numbers */
  function meetingChecklist(analysis, sceneNumbers) {
    var want = {};
    (sceneNumbers || []).forEach(function (n) { want[+n] = 1; });
    var items = ['Crew briefed on nearest exits, muster point and medic location'];
    analysis.flagged.forEach(function (s) {
      if (sceneNumbers && sceneNumbers.length && !want[s.scene]) return;
      s.hazards.forEach(function (h) {
        items.push('Sc ' + (s.label || s.scene) + ' · ' + h.label + ' — ' + h.personnel + ' confirms controls in place');
      });
    });
    return unique(items);
  }

  /* ── paid duty police ────────────────────────────────────────────────
     Street shoots need officers booked through the local service's paid
     duty / film program. The directory carries the confirmed program link
     where we have one (Toronto per TPS), otherwise the service name and a
     lookup — never an invented URL. */
  var POLICE = {
    toronto:       { city: 'Toronto, Canada', service: 'Toronto Police Service', program: 'Paid Duty Officer program',
                     url: 'https://www.tps.ca/services/request-paid-duty-officer/' },
    vancouver:     { city: 'Vancouver, Canada', service: 'Vancouver Police Department', program: 'Special events / film unit', url: null },
    montreal:      { city: 'Montreal, Canada', service: 'SPVM', program: 'Film liaison', url: null },
    'new-york':    { city: 'New York, USA', service: 'NYPD Movie & TV Unit', program: 'Filming coordination (via MOME permit)', url: null },
    'los-angeles': { city: 'Los Angeles, USA', service: 'LAPD (booked through FilmLA)', program: 'Off-duty officer coordination', url: null },
    atlanta:       { city: 'Atlanta, USA', service: 'Atlanta Police Department', program: 'Extra-duty employment / film office', url: null },
    'new-orleans': { city: 'New Orleans, USA', service: 'NOPD', program: 'Paid detail (Office of Police Secondary Employment)', url: null },
    albuquerque:   { city: 'Albuquerque, USA', service: 'APD', program: 'Chief\'s overtime / film office', url: null },
    london:        { city: 'London, UK', service: 'Metropolitan Police Film Unit', program: 'Filming in London (via FilmFixer/borough)', url: null },
    dublin:        { city: 'Dublin, Ireland', service: 'An Garda Síochána', program: 'Event/film policing', url: null },
    sydney:        { city: 'Sydney, Australia', service: 'NSW Police', program: 'User-pays policing', url: null },
    wellington:    { city: 'Wellington, NZ', service: 'NZ Police', program: 'Film liaison', url: null }
  };
  var INCENTIVE_HUB = {
    ontario: 'toronto', bc: 'vancouver', georgia: 'atlanta', california: 'los-angeles',
    newyork: 'new-york', newmexico: 'albuquerque', louisiana: 'new-orleans',
    ukavec: 'london', ukiftc: 'london', ireland: 'dublin', australia: 'sydney', nz: 'wellington'
  };
  function policeFor(cityOrIncentive) {
    var k = String(cityOrIncentive || '').toLowerCase().trim();
    if (INCENTIVE_HUB[k]) k = INCENTIVE_HUB[k];
    if (POLICE[k]) return POLICE[k];
    var hit = null;
    Object.keys(POLICE).forEach(function (key) {
      if (k.indexOf(key.replace('-', ' ')) >= 0 ||
          k.indexOf(POLICE[key].city.split(',')[0].toLowerCase()) >= 0) hit = POLICE[key];
    });
    return hit;
  }
  function policeSearchLink(entry, city) {
    return 'https://www.google.com/search?q=' + encodeURIComponent(
      (entry ? entry.service + ' ' : 'police ') + String(city || '').split(',')[0] +
      ' paid duty film production request');
  }
  /* which flagged scenes trigger a paid-duty requirement, and why */
  function paidDutyNeeds(analysis) {
    var reasons = [];
    (analysis.flagged || []).forEach(function (s) {
      var ext = /\bEXT/i.test(s.slug);
      s.hazards.forEach(function (h) {
        if (h.id === 'vehicles' && ext) reasons.push({ scene: s.scene, why: 'Driving/lockups on public roads — traffic control officers' });
        if (h.id === 'weapons' && ext) reasons.push({ scene: s.scene, why: 'Weapons visible in public — police notification + on-set officer' });
        if (h.id === 'crowds') reasons.push({ scene: s.scene, why: 'Crowd control on ' + (ext ? 'public streets' : 'a large call') });
        if (h.id === 'stunts' && ext) reasons.push({ scene: s.scene, why: 'Street stunts — road closure supervision' });
      });
    });
    return reasons;
  }
  /* officers × hours × rate, per day — typical paid-duty terms carry a
     3–4 hour minimum call; rate defaults are editable, not gospel */
  function paidDutyEstimate(o) {
    var officers = Math.max(1, +((o || {}).officers) || 1);
    var hours = Math.max(+((o || {}).minCall) || 4, +((o || {}).hours) || 4);
    var rate = +((o || {}).rate) || 90;
    var days = Math.max(1, +((o || {}).days) || 1);
    var admin = (o && o.adminPct != null ? +o.adminPct : 10) / 100;
    var perDay = officers * hours * rate;
    var total = Math.round(perDay * days * (1 + admin));
    return { officers: officers, hours: hours, rate: rate, days: days,
             perDay: Math.round(perDay), adminPct: Math.round(admin * 100), total: total };
  }

  /* ── animal department ───────────────────────────────────────────────
     Coordinators are quote-based and regional — the directory carries only
     names we can stand behind plus honest lookups; rates are planning
     estimates, and the compliance list follows the industry's certified
     animal-safety monitoring standard. */
  var ANIMAL_SPECIES = [
    { id: 'dog',      label: 'Dog (trained)',        day: [400, 800],  wrangler: true },
    { id: 'cat',      label: 'Cat (trained)',        day: [400, 600],  wrangler: true },
    { id: 'horse',    label: 'Horse',                day: [500, 1000], wrangler: true, note: 'Add stunt/riding double coordination for action.' },
    { id: 'livestock',label: 'Livestock (cow/goat/sheep/pig)', day: [300, 600], wrangler: true },
    { id: 'bird',     label: 'Bird (trained)',       day: [300, 500],  wrangler: true },
    { id: 'reptile',  label: 'Reptile / snake',      day: [250, 500],  wrangler: true, note: 'Venomous species need specialist handlers and are banned on many stages.' },
    { id: 'exotic',   label: 'Exotic / big animal',  day: [1500, 5000], wrangler: true, note: 'Heavily restricted or banned in many jurisdictions — legal review before scheduling.' }
  ];
  var WRANGLER_DAY = [600, 900];   // professional coordinator/wrangler per day
  var VET_DAY = [150, 300];        // vet on call where required
  var SPECIES_RE = [
    ['dog', /\b(dog|puppy|hound|german shepherd|retriever)\b/i],
    ['cat', /\b(cat|kitten)\b/i],
    ['horse', /\b(horse|stallion|mare|pony)\b/i],
    ['livestock', /\b(cow|cattle|goat|sheep|pig|chicken|rooster)\b/i],
    ['bird', /\b(bird|raven|crow|owl|falcon|parrot|dove)\b/i],
    ['reptile', /\b(snake|lizard|reptile|alligator)\b/i],
    ['exotic', /\b(wolf|bear|lion|tiger|monkey|elephant|deer)\b/i]
  ];
  function animalsInScript(scriptText) {
    var out = [];
    realScenes(scriptText).forEach(function (sc) {
      var text = sc.slug + '\n' + sc.body.join('\n');
      SPECIES_RE.forEach(function (pair) {
        if (pair[1].test(text)) out.push({ scene: sc.n, label: sc.label, species: pair[0] });
      });
    });
    return out;
  }
  /* planning estimate: species day rates + wrangler + prep + vet, midpoints */
  function animalEstimate(o) {
    o = o || {};
    var sp = null;
    ANIMAL_SPECIES.forEach(function (s) { if (s.id === o.species) sp = s; });
    if (!sp) sp = ANIMAL_SPECIES[0];
    var days = Math.max(1, +o.days || 1);
    var prep = Math.max(0, +o.prepDays || 0);
    var mid = function (r) { return (r[0] + r[1]) / 2; };
    var animal = mid(sp.day) * days;
    var wrangler = mid(WRANGLER_DAY) * (days + prep);
    var vet = o.vet ? mid(VET_DAY) * days : 0;
    return { species: sp.label, days: days, prepDays: prep,
             animal: Math.round(animal), wrangler: Math.round(wrangler),
             vet: Math.round(vet), total: Math.round(animal + wrangler + vet),
             note: sp.note || '' };
  }
  /* certified animal-safety compliance list — attach to the risk assessment */
  function animalChecklist() {
    return [
      'Professional animal coordinator/wrangler engaged — only they handle the animals',
      'Certified animal-safety representative notified/on set for significant animal action',
      'Veterinary exam current; vet on call (on set for stunts or exotic work)',
      'No sedation or tripping devices — performance through training only',
      'Rest, water, shade and quiet holding area scheduled between setups',
      'Take limits agreed with the coordinator before rolling',
      'Set quieted and rehearsed with stand-ins before the animal works',
      'Apply for the certified "no animals were harmed" end-credit monitoring program',
      'Animal action detailed on the call sheet and covered in the safety meeting'
    ];
  }
  /* directory: only entries we can stand behind by name; everything else is
     an honest lookup for the shoot's own hub */
  var WRANGLERS = [
    { name: 'Birds & Animals Unlimited', hub: 'Los Angeles, USA', spec: 'Major studio animal training/coordination house', verified: true }
  ];
  function wranglerSearchLink(city) {
    return 'https://www.google.com/search?q=' + encodeURIComponent(
      'film animal wrangler coordinator ' + String(city || '').split(',')[0]);
  }

  /* incident log */
  function blank() { return { v: 1, incidents: [], ack: {} }; }
  function addIncident(store, fields) {
    var inc = { id: 'i' + Math.random().toString(36).slice(2, 9),
      date: fields.date || '', scene: fields.scene || '', who: fields.who || '',
      what: fields.what || '', injury: !!fields.injury, action: fields.action || '',
      reportedBy: fields.reportedBy || '' };
    store.incidents.push(inc);
    return inc;
  }

  root.CSafety = {
    HAZARDS: HAZARDS, splitScenes: splitScenes, analyze: analyze,
    assessmentText: assessmentText, meetingChecklist: meetingChecklist,
    POLICE: POLICE, policeFor: policeFor, policeSearchLink: policeSearchLink,
    paidDutyNeeds: paidDutyNeeds, paidDutyEstimate: paidDutyEstimate,
    ANIMAL_SPECIES: ANIMAL_SPECIES, animalsInScript: animalsInScript,
    animalEstimate: animalEstimate, animalChecklist: animalChecklist,
    WRANGLERS: WRANGLERS, wranglerSearchLink: wranglerSearchLink,
    blank: blank, addIncident: addIncident
  };
})(typeof window !== 'undefined' ? window : globalThis);
