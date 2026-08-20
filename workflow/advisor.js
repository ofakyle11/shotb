/* CINAMATE Advisor — the automation layer that makes the modules feed
 * each other. Reads the script analysis (SBBudget.analyze), budget
 * prefs and the incentive table, then recommends:
 *   · the best shooting jurisdictions for THIS film — incentive money
 *     on this budget × look fit for the script's world × crew depth
 *   · a staffing plan matched to the film's style, scale and drivers
 *   · prescriptive prep actions across every module (what to do next)
 * Pure functions on window.CAdvisor; the UI section mounts on the
 * Workflow page. All original code, written for Cinamate. Incentive
 * figures are headline program terms — verify with a production
 * accountant before relying on them.
 */
(function (root) {
  'use strict';

  /* ── look profile per jurisdiction (matched to SBBudget.INCENTIVES ids) ── */
  var PLACE = {
    georgia:    { tags: ['city', 'smalltown', 'forest', 'suburb', 'swamp'], crew: 3, base: 'Atlanta — deepest US crew base outside LA/NY' },
    california: { tags: ['city', 'desert', 'coast', 'mountain', 'suburb'], crew: 3, base: 'Every look within reach; ATL salaries excluded from credit' },
    newyork:    { tags: ['city', 'urban', 'period', 'suburb'], crew: 3, base: 'The urban look; strong stages upstate' },
    newmexico:  { tags: ['desert', 'smalltown', 'mountain', 'western'], crew: 2, base: 'The desert/western look; strong rural uplifts' },
    louisiana:  { tags: ['swamp', 'city', 'period', 'smalltown', 'river'], crew: 2, base: 'New Orleans character; humid-south texture' },
    ukavec:     { tags: ['city', 'period', 'castle', 'countryside', 'rain'], crew: 3, base: 'World-class stages (Pinewood/Leavesden) + period everything' },
    ukiftc:     { tags: ['city', 'period', 'castle', 'countryside', 'rain'], crew: 3, base: 'Same UK base — the enhanced credit for true independents' },
    ireland:    { tags: ['countryside', 'coast', 'castle', 'period', 'rain'], crew: 2, base: 'Dramatic coasts and period texture' },
    hungary:    { tags: ['period', 'city', 'castle', 'europe'], crew: 3, base: 'Budapest doubles for most of old Europe; big stage capacity' },
    czech:      { tags: ['period', 'castle', 'city', 'europe', 'forest'], crew: 2, base: 'Prague period streets; strong VFX uplift' },
    australia:  { tags: ['desert', 'coast', 'city', 'jungle', 'outback'], crew: 3, base: 'Gold Coast/Sydney stages; huge landscape range' },
    nz:         { tags: ['mountain', 'forest', 'coast', 'fantasy'], crew: 2, base: 'The epic-landscape look; elite VFX (Wētā)' },
    bc:         { tags: ['forest', 'mountain', 'city', 'rain', 'snow'], crew: 3, base: 'Vancouver doubles for anywhere-US; deep crews' },
    ontario:    { tags: ['city', 'suburb', 'smalltown', 'snow'], crew: 3, base: 'Toronto doubles for NYC/Chicago at a discount' },
    iceland:    { tags: ['glacier', 'volcanic', 'otherworld', 'snow', 'coast'], crew: 1, base: 'The alien/epic look — bring most of the crew' },
    malta:      { tags: ['sea', 'ancient', 'mediterranean', 'ship'], crew: 1, base: 'Mediterranean + the big water tanks' },
    italy:      { tags: ['period', 'mediterranean', 'city', 'countryside'], crew: 2, base: 'Cinecittà + looks money cannot fake' },
    greece:     { tags: ['island', 'sea', 'ancient', 'mediterranean'], crew: 1, base: 'Islands and antiquity; growing crew base' },
    germany:    { tags: ['city', 'period', 'europe', 'forest'], crew: 3, base: 'Studio Babelsberg + regional fund stacking' },
    spain:      { tags: ['desert', 'city', 'mediterranean', 'period', 'island'], crew: 2, base: 'Almería desert to Canary volcanics at 50%+' }
  };

  /* script text → wanted look tags */
  var LOOK_WORDS = [
    [/desert|dune|arid|mesa|canyon|tumbleweed/i, 'desert'],
    [/ocean|beach|coast|harbor|sea\b|shore|surf/i, 'coast'],
    [/forest|woods|pines|jungle|grove/i, 'forest'],
    [/mountain|summit|cliff|alpine|peak/i, 'mountain'],
    [/snow|blizzard|frozen|glacier|ice\b/i, 'snow'],
    [/skyline|subway|downtown|alley|neon|skyscraper|traffic/i, 'city'],
    [/village|small town|main street|diner|county/i, 'smalltown'],
    [/castle|manor|victorian|medieval|carriage|palace/i, 'period'],
    [/swamp|bayou|marsh|delta/i, 'swamp'],
    [/island\b/i, 'island'],
    [/ship\b|deck\b|galleon|at sea/i, 'sea'],
    [/rain|storm|drizzle|overcast/i, 'rain'],
    [/suburb|cul-de-sac|backyard/i, 'suburb']
  ];
  function wantedLooks(scriptText, genre) {
    var tags = {};
    var s = String(scriptText || '');
    LOOK_WORDS.forEach(function (p) { if (p[0].test(s)) tags[p[1]] = 1; });
    var g = String(genre || '').toLowerCase();
    if (/western/.test(g)) tags.desert = tags.western = 1;
    if (/fantasy/.test(g)) tags.mountain = tags.forest = 1;
    if (/sci|science/.test(g)) tags.otherworld = 1;
    if (/noir|crime|thriller/.test(g)) tags.city = 1;
    if (/period|history/.test(g)) tags.period = 1;
    return Object.keys(tags);
  }

  /* rank jurisdictions: incentive $ on this budget + look + crew depth */
  function recommendLocations(inp) {
    var budget = Math.max(1, inp.budget || 0);
    var looks = inp.looks || [];
    var incentives = (inp.incentives || []).filter(function (i) { return i.id !== 'none'; });
    var scored = incentives.map(function (i) {
      var p = PLACE[i.id] || { tags: [], crew: 2, base: '' };
      var rateMid = (i.rate[0] + i.rate[1]) / 2;
      var recovery = budget * (i.qualPct || 0) * rateMid;
      var lookHits = p.tags.filter(function (t) { return looks.indexOf(t) >= 0; });
      var minOk = !i.minSpend || budget >= i.minSpend;
      var capOk = !i.budgetCap || budget <= i.budgetCap;
      var score = (recovery / budget) * 100 * 1.6          // money first
        + lookHits.length * 14                              // the look
        + p.crew * 6                                        // crew depth = prepared
        + (minOk ? 0 : -50) + (capOk ? 0 : -60);
      var reasons = [];
      reasons.push('≈ $' + Math.round(recovery).toLocaleString('en-US') + ' back (' + Math.round(rateMid * 100) + '% on ' + Math.round((i.qualPct || 0) * 100) + '% qualifying spend)');
      if (lookHits.length) reasons.push('Matches the script\'s world: ' + lookHits.join(', '));
      reasons.push(p.base || 'Crew depth ' + p.crew + '/3');
      if (!minOk) reasons.push('⚠ below the $' + (i.minSpend / 1e6) + 'M minimum spend');
      if (!capOk) reasons.push('⚠ budget above this program\'s cap');
      if (i.note) reasons.push(i.note);
      return { id: i.id, label: i.label, score: Math.round(score), recovery: Math.round(recovery), lookHits: lookHits, crew: p.crew, reasons: reasons, eligible: minOk && capOk };
    }).sort(function (a, b) { return b.score - a.score; });
    return scored;
  }

  /* staffing plan by style, scale and script drivers */
  function recommendStaffing(inp) {
    var a = inp.analysis || {};
    var scale = inp.scale || 'indie';           // indie | mid | studio
    var doc = inp.mode === 'documentary';
    var mult = scale === 'studio' ? 2.2 : scale === 'mid' ? 1.5 : 1;
    function n(base) { return Math.max(1, Math.round(base * mult)); }
    var plan = [];
    function add(dept, role, count, why) { plan.push({ dept: dept, role: role, count: count, why: why }); }
    if (doc) {
      add('Production', 'Producer / PM', 1, 'documentary core team');
      add('Camera', 'DP (owner-operator)', 1, 'doc single-camera coverage');
      add('Sound', 'Sound recordist', 1, 'interviews live or die on sound');
      add('Edit', 'Editor', 1, 'the doc is made in the edit');
      add('Post', 'Archival producer', 1, 'clears and licenses footage');
    } else {
      add('Production', '1st AD', 1, 'runs the set');
      add('Production', 'Production coordinator', n(1), 'office + logistics');
      add('Camera', 'DP', 1, 'the look');
      add('Camera', '1st AC / 2nd AC', n(2), 'focus + media');
      add('Sound', 'Mixer + boom', 2, 'production sound');
      add('G&E', 'Gaffer + grips', n(3), 'light and rig');
      add('Art', 'Production designer + art dept', n(2), 'the world on screen');
      add('Wardrobe', 'Costume designer', n(1), 'character through clothes');
      add('HMU', 'Hair & makeup', n(1), 'continuity-critical');
      add('Production', 'Script supervisor', 1, 'continuity + lined script');
      add('Edit', 'Editor', 1, 'starts cutting during the shoot');
    }
    var d = {};
    (a.drivers || []).forEach(function (x) { d[x.key] = x.count || 1; });
    if (d.stunts) add('Production', 'Stunt coordinator', 1, a.genre + ' — ' + d.stunts + ' action beats in the script');
    if (d.water) add('Production', 'Marine coordinator + safety', 2, 'water work in the script');
    if (d.vfx) add('Post', 'VFX supervisor (on set)', 1, 'VFX beats need on-set data');
    if (d.crowds) add('Production', 'Extras casting / AD staff', n(1), 'crowd scenes in the script');
    if (d.animals) add('Production', 'Animal wrangler', 1, 'animal action in the script');
    if (d.period) add('Art', 'Set decorator + props (period)', n(1), 'period detail load');
    if ((a.nightPct || 0) > 0.3) add('G&E', 'Additional lighting crew', n(1), Math.round(a.nightPct * 100) + '% night work');
    if ((a.castTotal || 0) > 8) add('Production', '2nd AD', 1, String(a.castTotal) + ' speaking parts to move');
    var total = plan.reduce(function (s, p) { return s + p.count; }, 0);
    return { plan: plan, total: total, note: doc ? 'Lean documentary unit' : 'Core ' + scale + ' unit — day players and daily hires on top' };
  }

  /* prescriptive prep actions across every module */
  function prepActions(stores) {
    var s = stores || {};
    var out = [];
    function act(sev, text, href, label) { out.push({ sev: sev, text: text, href: href, label: label }); }
    var tl = s.timeline || {};
    var clips = tl.clips || [];
    var script = String(tl.scriptText || '');
    var a = s.analysis || null;
    if (!script && !(s.writer && (s.writer.scenes || []).length)) {
      act('high', 'No screenplay yet — everything downstream starts here', '/writer/', 'Open Writer');
      return out;
    }
    if (!clips.length) act('high', 'Script not broken down into clips yet', '/timeline/', 'Parse in Studio');
    if (a && a.nightCount > 0 && !(s.plan && s.plan.date)) act('med', a.nightCount + ' night scenes but no shoot-day plan — nights need weather and turnaround planning', '/producer/#schedule', 'Plan days');
    var sheet = s.sheet || {};
    var hasBudget = (sheet.categories || []).some(function (c) { return (c.items || []).some(function (i) { return +i.est > 0; }); });
    if (!hasBudget) act('med', 'Budget top sheet is empty — seed it from the script estimate', '/producer/', 'Seed budget');
    var prefs = s.budgetPrefs || {};
    if (hasBudget && (!prefs.incentive || prefs.incentive === 'none')) act('med', 'No tax jurisdiction modeled — the Advisor ranking below is free money', '/producer/#incentives', 'Pick one');
    var roles = (s.roles && s.roles.rows) || s.roles || [];
    var open = (Array.isArray(roles) ? roles : []).filter(function (r) { return r.status !== 'Cast'; }).length;
    if (open > 0) act('med', open + ' role' + (open === 1 ? '' : 's') + ' still uncast', '/production/#casting', 'Casting');
    var crew = (s.crew && s.crew.rows) || s.crew || [];
    if (!(Array.isArray(crew) ? crew : []).length) act('med', 'No crew on the books — seed the staffing plan below', '/production/', 'Crew');
    var locs = (s.locations && s.locations.rows) || s.locations || [];
    var locRows = Array.isArray(locs) ? locs : [];
    if (a && a.uniqueLocations > 0 && !locRows.length) act('low', a.uniqueLocations + ' script locations, none scouted yet', '/production/#locations', 'Locations');
    var badPermit = locRows.filter(function (l) { return l.permit === 'Applied' || l.permit === 'Denied'; }).length;
    if (badPermit) act('high', badPermit + ' location permit' + (badPermit === 1 ? '' : 's') + ' not yet issued', '/production/#locations', 'Permits');
    var ins = (s.insurance && s.insurance.rows) || s.insurance || [];
    if (!(Array.isArray(ins) ? ins : []).length && hasBudget) act('med', 'No insurance certificates on file', '/tools/#insurance', 'Insurance');
    var rendered = clips.filter(function (c) { return c.videoUrl; }).length;
    var approved = clips.filter(function (c) { return c.status === 'approved'; }).length;
    if (rendered > 0 && approved < rendered) act('low', (rendered - approved) + ' rendered clips awaiting approval', '/timeline/', 'Review');
    if (approved > 0 && !(s.cut && s.cut.project && (s.cut.project.video || []).length)) act('low', 'Approved clips ready but nothing on the Editor timeline', '/editor/', 'Start the cut');
    var clr = (s.clearance && s.clearance.rows) || s.clearance || [];
    var openClr = (Array.isArray(clr) ? clr : []).filter(function (c) { return c.status === 'Flagged' || c.status === 'Clearing'; }).length;
    if (openClr) act('high', openClr + ' clearance item' + (openClr === 1 ? '' : 's') + ' still open', '/production/#clearance', 'Clearances');
    if (s.cut && s.cut.lastExport) {
      var del = (s.delivery && s.delivery.rows) || s.delivery || [];
      if (!(Array.isArray(del) ? del : []).length) act('med', 'Cut exported but the delivery checklist is empty', '/production/#delivery', 'Delivery QC');
    }
    if (!out.length) act('ok', 'Nothing outstanding — every department is ahead of the picture', '/workflow/', 'Pipeline');
    return out;
  }

  root.CAdvisor = {
    PLACE: PLACE,
    wantedLooks: wantedLooks,
    recommendLocations: recommendLocations,
    recommendStaffing: recommendStaffing,
    prepActions: prepActions
  };
})(typeof window !== 'undefined' ? window : globalThis);
