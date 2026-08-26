/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — the chart of accounts (CAccounts)

   One chart, for every module that posts money. Before this existed each
   module carried its own guess and money landed where nothing could reconcile
   it: crew deal memos posted wardrobe, hair/makeup and the composer to 3000
   (Direction) and cast to 2000 (Producers Unit); the casting office committed
   offers to 1400, an account that does not exist in the chart at all, so every
   cast offer showed up as a permanently over-budget "Unbudgeted" line; VFX
   bids committed to 15000 (Post-Production as a whole) while the estimator
   budgeted them at 15200, so cost-per-shot could not be asked anywhere.

   MAJOR is the top-sheet skeleton (producer/budget-sheet.js seeds from it).
   DETAIL are the sub-accounts the estimator and the departments post to; each
   rolls up to one major account, so a posting can be precise without becoming
   unbudgeted.

   Pure logic, no DOM, no dependencies.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── major accounts — the top sheet ──────────────────────────────────── */
  var MAJOR = [
    { acct: '1000',  name: 'Story & Rights' },
    { acct: '2000',  name: 'Producers Unit' },
    { acct: '3000',  name: 'Direction' },
    { acct: '4000',  name: 'Cast' },
    { acct: '5000',  name: 'Production Staff' },
    { acct: '6000',  name: 'Camera' },
    { acct: '7000',  name: 'Sound' },
    { acct: '8000',  name: 'Grip & Electric' },
    { acct: '9000',  name: 'Art Department' },
    { acct: '10000', name: 'Wardrobe' },
    { acct: '11000', name: 'Makeup & Hair' },
    { acct: '12000', name: 'Transportation' },
    { acct: '13000', name: 'Locations' },
    { acct: '14000', name: 'Media & Stock' },
    { acct: '15000', name: 'Post-Production' },
    { acct: '16000', name: 'Insurance & Legal' },
    { acct: '17000', name: 'Publicity' },
    { acct: '18000', name: 'General Expenses' },
    { acct: '19000', name: 'Contingency' },
    /* Payroll fringes are cross-departmental — union H&P, payroll tax, workers'
       comp on every labour account at once. The estimator produced a fringe
       line with NO account prefix, so the seeder's `^(\d{4,5}) ·` match failed
       and $397k-$709k fell through to General Expenses, an account whose whole
       job is to be ~4% of BTL. It gets its own account. */
    { acct: '20000', name: 'Payroll Fringes' }
  ];

  /* ── detail accounts — what a department actually posts to ───────────── */
  var DETAIL = [
    { acct: '4100',  name: 'Cast — supporting',            parent: '4000' },
    { acct: '4200',  name: 'Cast — day players',           parent: '4000' },
    { acct: '4400',  name: 'Casting',                      parent: '4000' },
    { acct: '4500',  name: 'Background & extras',          parent: '4000' },
    { acct: '8500',  name: 'Set operations & other crew',  parent: '8000' },
    { acct: '9100',  name: 'Props & set dressing',         parent: '9000' },
    { acct: '9900',  name: 'Stunts, SFX & special units',  parent: '9000' },
    { acct: '13500', name: 'Travel & living',              parent: '13000' },
    { acct: '15200', name: 'VFX',                          parent: '15000' },
    { acct: '15400', name: 'Sound design & mix',           parent: '15000' },
    { acct: '15600', name: 'Music (score + licensing)',    parent: '15000' },
    { acct: '15800', name: 'Color / DI & deliverables',    parent: '15000' },
    { acct: '16500', name: 'Legal & finance',              parent: '16000' },
    { acct: '16800', name: 'Completion bond',              parent: '16000' }
  ];

  var BY_ACCT = {};
  MAJOR.forEach(function (a) { BY_ACCT[a.acct] = { acct: a.acct, name: a.name, parent: a.acct, major: true }; });
  DETAIL.forEach(function (a) { BY_ACCT[a.acct] = { acct: a.acct, name: a.name, parent: a.parent, major: false }; });

  function key(a) { return String(a == null ? '' : a).trim(); }
  function get(a) { return BY_ACCT[key(a)] || null; }
  function exists(a) { return !!get(a); }
  function name(a) { var e = get(a); return e ? e.name : ''; }

  /* A posting on a detail account belongs on its major account's budget line.
     Unknown accounts roll up to themselves so they still surface as
     "Unbudgeted · <acct>" rather than silently vanishing into a real line. */
  function rollup(a) { var e = get(a); return e ? e.parent : key(a); }

  /* Labour accounts — the base payroll fringes are calculated on. */
  var LABOR = { '2000': 1, '3000': 1, '4000': 1, '4100': 1, '4200': 1, '4500': 1,
    '5000': 1, '6000': 1, '7000': 1, '8000': 1, '8500': 1, '9000': 1, '9900': 1,
    '10000': 1, '11000': 1, '12000': 1 };
  function isLabor(a) { return !!LABOR[rollup(a)] || !!LABOR[key(a)]; }

  /* ── role / department → account ─────────────────────────────────────────
     Longest matching keyword wins, on word boundaries. Order-independent and
     substring-safe: "assistant director" must not become Direction, "line
     producer" must not become the Producers Unit, "sfx makeup" is HMU and not
     special effects. That last-match-wins loop over an object's key order is
     precisely how every crew memo ended up on account 3000. */
  var ROLE_ACCT = [
    ['story', '1000'], ['rights', '1000'], ['writer', '1000'], ['screenwriter', '1000'],
    ['screenplay', '1000'], ['option', '1000'],

    ['producer', '2000'], ['executive producer', '2000'], ['co-producer', '2000'],
    ['associate producer', '2000'],

    ['director', '3000'], ['direction', '3000'],

    ['cast', '4000'], ['actor', '4000'], ['actress', '4000'], ['performer', '4000'],
    ['lead', '4000'], ['stand-in', '4000'], ['stunt double', '4000'], ['day player', '4200'],
    ['supporting cast', '4100'],
    ['casting', '4400'], ['casting director', '4400'],
    ['background', '4500'], ['extras', '4500'], ['atmosphere', '4500'],

    ['line producer', '5000'], ['upm', '5000'], ['unit production manager', '5000'],
    ['production manager', '5000'], ['production supervisor', '5000'],
    ['production coordinator', '5000'], ['production assistant', '5000'],
    ['assistant director', '5000'], ['1st ad', '5000'], ['2nd ad', '5000'],
    ['script supervisor', '5000'], ['production office', '5000'], ['production staff', '5000'],
    ['craft service', '5000'], ['craft services', '5000'],

    ['camera', '6000'], ['cinematographer', '6000'], ['cinematography', '6000'],
    ['director of photography', '6000'], ['dp', '6000'], ['dop', '6000'],
    ['ac', '6000'], ['1st ac', '6000'], ['2nd ac', '6000'], ['focus puller', '6000'],
    ['dit', '6000'], ['steadicam', '6000'], ['loader', '6000'],

    ['sound', '7000'], ['production sound', '7000'], ['boom', '7000'],
    ['boom operator', '7000'], ['sound mixer', '7000'], ['utility sound', '7000'],

    ['grip', '8000'], ['key grip', '8000'], ['best boy', '8000'], ['dolly grip', '8000'],
    ['electric', '8000'], ['electrician', '8000'], ['gaffer', '8000'], ['g&e', '8000'],
    ['lighting', '8000'], ['rigging', '8000'], ['genny operator', '8000'],

    ['art', '9000'], ['art department', '9000'], ['production designer', '9000'],
    ['production design', '9000'], ['art director', '9000'], ['set decorator', '9000'],
    ['set dressing', '9000'], ['greens', '9000'], ['construction', '9000'],
    ['scenic', '9000'], ['carpenter', '9000'],
    ['props', '9100'], ['prop', '9100'], ['propmaster', '9100'], ['prop master', '9100'],
    ['stunt', '9900'], ['stunts', '9900'], ['stunt coordinator', '9900'],
    ['sfx', '9900'], ['special effects', '9900'], ['armorer', '9900'], ['armourer', '9900'],
    ['pyro', '9900'], ['pyrotechnician', '9900'],

    ['wardrobe', '10000'], ['costume', '10000'], ['costume designer', '10000'],
    ['seamstress', '10000'], ['tailor', '10000'],

    ['hmu', '11000'], ['makeup', '11000'], ['make-up', '11000'], ['hair', '11000'],
    ['hairstylist', '11000'], ['sfx makeup', '11000'], ['prosthetics', '11000'],

    ['transport', '12000'], ['transportation', '12000'], ['driver', '12000'],
    ['teamster', '12000'], ['picture car', '12000'], ['captain', '12000'],

    ['location', '13000'], ['locations', '13000'], ['location manager', '13000'],
    ['location scout', '13000'], ['permit', '13000'], ['site rep', '13000'],
    ['travel', '13500'], ['per diem', '13500'], ['lodging', '13500'], ['hotel', '13500'],

    ['media', '14000'], ['stock', '14000'], ['expendable', '14000'], ['expendables', '14000'],

    ['edit', '15000'], ['editor', '15000'], ['editorial', '15000'], ['post', '15000'],
    ['post production', '15000'], ['post-production', '15000'], ['assistant editor', '15000'],
    ['vfx', '15200'], ['visual effects', '15200'], ['compositor', '15200'],
    ['sound design', '15400'], ['re-recording', '15400'], ['adr', '15400'],
    ['foley', '15400'], ['mix', '15400'], ['sound designer', '15400'],
    ['music', '15600'], ['composer', '15600'], ['score', '15600'], ['song', '15600'],
    ['sync licence', '15600'], ['sync license', '15600'], ['music supervisor', '15600'],
    ['color', '15800'], ['colour', '15800'], ['colorist', '15800'], ['colourist', '15800'],
    ['di', '15800'], ['deliverables', '15800'], ['finishing', '15800'],

    ['insurance', '16000'], ['legal', '16500'], ['attorney', '16500'], ['counsel', '16500'],
    ['completion bond', '16800'], ['bond', '16800'],

    ['publicist', '17000'], ['publicity', '17000'], ['stills', '17000'],
    ['unit photographer', '17000'], ['epk', '17000'],

    ['general expenses', '18000'], ['miscellaneous', '18000'], ['office', '18000'],
    ['contingency', '19000'],
    ['fringe', '20000'], ['fringes', '20000'], ['payroll', '20000']
  ];

  var ROLE_RULES = ROLE_ACCT.map(function (r) {
    return {
      len: r[0].length,
      acct: r[1],
      re: new RegExp('(^|[^a-z0-9])' + r[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+') + '($|[^a-z0-9])', 'i')
    };
  }).sort(function (a, b) { return b.len - a.len; });

  /* Unmatched crew is other crew, not Direction. Unmatched cast is Cast. */
  var DEFAULT_CREW = '5000';
  var DEFAULT_CAST = '4000';

  function forRole(role, kind) {
    var s = String(role == null ? '' : role);
    for (var i = 0; i < ROLE_RULES.length; i++) {
      if (ROLE_RULES[i].re.test(s)) return ROLE_RULES[i].acct;
    }
    return String(kind || '').toLowerCase() === 'cast' ? DEFAULT_CAST : DEFAULT_CREW;
  }
  /* Same table, read as a department name. */
  function forDept(dept) { return forRole(dept, ''); }

  root.CAccounts = {
    MAJOR: MAJOR, DETAIL: DETAIL,
    get: get, exists: exists, name: name, rollup: rollup, isLabor: isLabor,
    forRole: forRole, forDept: forDept,
    DEFAULT_CREW: DEFAULT_CREW, DEFAULT_CAST: DEFAULT_CAST,
    FRINGE_ACCT: '20000', CONTINGENCY_ACCT: '19000'
  };
})(typeof window !== 'undefined' ? window : globalThis);
