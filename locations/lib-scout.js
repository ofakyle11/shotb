/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Location Scout Book engine (CScout)
   Pure logic, no DOM: film-permit and soundstage directories for the major
   production hubs, fuzzy hub matching, a compact NOAA-style golden-hour
   approximation (local SOLAR time — always verify locally), the standard
   tech-scout checklist, and slugline mining of the working screenplay.

   HONESTY: permit entries below were verified against the official city fee
   schedules and application portals on 2026-08-23 (verified:true). Facility
   entries are verified:true only where the operator's own site confirmed
   them; anything else stays
   was built, so every entry ships verified:false, carries NO fees, phone
   numbers, or application URLs, and points at a web search instead. Office
   and facility names are long-standing institutional facts; everything
   else is labeled guidance to confirm on the official page.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── 1 · filming-permit directory ─────────────────────────────────────
     applyUrl is '' when no URL could be verified — the UI must render a
     search link instead. Costs and lead times are guidance, not quotes.  */
  var PERMITS = [
    {
        "hub": "Toronto",
        "office": "City of Toronto Film & Entertainment Industries office",
        "required": "Permit required for filming on City property (streets, sidewalks, parks, civic centres/squares) or when production vehicles park on City streets. NOT required if all filming activity — including parking of production veh",
        "cost": "CAD, verified against the City's official Plan Your Shoot fee schedule (fetched 2026-08-23): Production registration $100 (free for students); Grid permit $100 (free for students); Location permit $300 features/series/pilots, $150 commercials/documentaries; Parks permit $200 (free for students); Road closure fee $500 (additional charge); ",
        "leadTime": "Verified minimums: parks — 3 business days before filming (small format) / 4 business days (large format); special effects/pyrotechnics — 7 business days; fire hydrant use — at least 10 business days.",
        "insurance": "General Comprehensive Public Liability of CAD $2,000,000 per occurrence, naming \"The City of Toronto, 100 Queen St. W., Toronto, Ontario M5H 2N2\" as additional insured. Certificate",
        "police": "Not verified in this check. (Commonly, Toronto requires paid-duty Toronto Police officers for traffic stopping/lane closures, billed directly to the production ",
        "applyUrl": "https://secure.toronto.ca/FilmPal/Start.jsp",
        "verified": true
    },
    {
        "hub": "Vancouver",
        "office": "City of Vancouver Film and Special Events Branch",
        "required": "A film permit (under a Master Film Licence Agreement) is required for filming on City public spaces — streets, sidewalks, plazas — and a Park Board permit for filming in parks or on the seawall. No application is require",
        "cost": "CAD, taxes extra (2025/26 schedule, verified against official City pages): $100 non-refundable application fee; daily film permit $1,300 per day of filming (covers all locations that day plus prep/wrap dates, parking signage/hooding); late-night/early-morning surcharge $2,000 per day; ultra-low impact productions (under 15 cast/crew, mini",
        "leadTime": "Apply at least 2 weeks (10 working days) before filming; Master Film Licence Agreement setup can take 2 weeks or longer. Stunts and special effects proposals at least 10 working days ahead; temporary ",
        "insurance": "$5,000,000 Commercial General Liability minimum for filming permits (third-party bodily injury, death, property damage), with a cross-liability clause and an additional insured end",
        "police": "Vancouver Police required on set for traffic control, weapons escort, or public safety; booked through VPD Emergency/Operational Planning min. 2 working days ah",
        "applyUrl": "https://plposweb.vancouver.ca/Public/Login.aspx",
        "verified": true
    },
    {
        "hub": "Atlanta",
        "office": "Atlanta Mayor's Office of Film & Entertainment",
        "required": "Permit required only when entertainment-industry filming (motion pictures, TV series, commercials, music videos, games, animation intended for commercial release) occurs on PUBLIC property (Sec. 46-103(1)). No city filmi",
        "cost": "USD, verified Aug 2026 against the official AMOFE fee schedule PDF posted on the city's FilmApp portal and matching codified Sec. 46-110: non-refundable application fee $100 ($25 students); filming permit fee $300 per calendar month, +$300 each renewal month ($150 per project for students, no monthly renewals); rush permit fee additional ",
        "leadTime": "No fixed application deadline (Sec. 46-106(3)), but: applications 3 or fewer business days before the permit's effective date incur rush fees; street/lane/sidewalk closure requests need a traffic cont",
        "insurance": "Sec. 46-109(3): producer must obtain insurance in an amount determined by the city's risk manager and name the City of Atlanta as additional insured, with proof provided as the ris",
        "police": "Street/lane/sidewalk closures require a traffic control plan reviewed by Atlanta Police Department and approved by the office of transportation; closures are ev",
        "applyUrl": "https://app2.apply4.com/filmapp/usa/atlanta",
        "verified": true
    },
    {
        "hub": "Los Angeles",
        "office": "FilmLA",
        "required": "A FilmLA permit is required for commercial motion/still production filming on location (public property, and private property in most FilmLA-served jurisdictions) within the City of Los Angeles, unincorporated LA County,",
        "cost": "USD, FY 2025/26 rates confirmed unchanged for FY 2026/27 (FilmLA Board elected no increase in FilmLA service fees effective July 1, 2026): motion permit application $931 (covers up to 5 locations within 7 consecutive days); still photography permit $104; student permit $52 (simple) / $134 (complex); non-profit/PSA $73 (rider $36). Common ",
        "leadTime": "FilmLA's standard guidance is a minimum of ~3 business days for routine permits, longer (7+ days) for complex activity (road closures, stunts, SFX). [Not re-verified in this pass — verification was sc",
        "insurance": "General liability insurance (commonly $1M per occurrence) with the relevant jurisdiction(s) and FilmLA named as additional insured; certificate filed with FilmLA. [Not re-verified ",
        "police": "Lane/street closures require FilmLA lane closure administration ($78/location) plus jurisdiction-billed police/traffic control (e.g., LAPD officers) charged at ",
        "applyUrl": "https://my.filmla.com",
        "verified": true
    },
    {
        "hub": "New York",
        "office": "NYC Mayor's Office of Media and Entertainment",
        "required": "Permit required for productions with equipment packages (dolly tracks, lights, cable, etc.), production vehicles requesting parking privileges (excluding personal cars, mini-vans, SUVs, pick-ups), exclusive use of City p",
        "cost": "USD $500 per each consecutive 14-day period (or portion thereof) of the project's shoot dates; non-refundable; in effect since 1/1/2024 (verified on nyc.gov and the E-Apply portal, current as of Aug 2026). Examples: 4-day shoot = $500; a 6-week (42-day) shoot = $1,500 (three periods); 43–56 days = $2,000. Hardship fee waiver available: su",
        "leadTime": "Certificate of Insurance must be emailed by the broker/agent to the Film Office (insurance@media.nyc.gov) at least 48 hours BEFORE submitting the online permit application; for filming in NYC parks al",
        "insurance": "Commercial General Liability insurance of at least $1,000,000 per occurrence in the name of the entity requesting the permit; the City of New York must be named as additional insur",
        "police": "Productions requiring NYPD assistance (e.g. stunts, prop weapons, actors in police uniform, street/traffic control) must apply for a permit and are coordinated ",
        "applyUrl": "https://nyceventpermits.nyc.gov/film/",
        "verified": true
    },
    {
        "hub": "London",
        "office": "Borough Film Services",
        "required": "Filming on public/local-authority-managed land requires permission from that borough's Film Service; private locations need the property owner's permission (per Film London). Verified borough example (RBKC): a Notice of ",
        "cost": "VERIFIED — varies by borough, no single London fee. City of London (official page, Date updated 16/06/2026; all charges subject to VAT being added): charity/students £40; small crew handheld (up to 5 people) £95; small crew camera+tripod (up to 10) £210; medium crew (11-20) £275; large crew (21-50) £375; very large crew (51-100) £500; cre",
        "leadTime": "Varies by borough. Verified for Westminster (Jan 2026 schedule): low-impact shoots (under 7 cast/crew) 3+ working days; parking suspensions/dispensations 10+ working days; pavement closures, stunts, S",
        "insurance": "Not re-verified in this pass. Borough film services commonly require public liability insurance (typically £5m) naming the council — confirm with the specific borough before relyin",
        "police": "Verified for Westminster: traffic management, road closures, highway licences, parking suspensions/dispensations, and streetlight control are recoverable costs ",
        "applyUrl": "https://filmlondon.org.uk/filming-in-london/plan-your-shoot/permission",
        "verified": true
    }
];

  /* ── 2 · soundstage directory ─────────────────────────────────────────
     Facility names are long-standing institutional facts; stage counts
     and specs drift, so they are described qualitatively. website is
     null when unverified — the UI renders a search link.               */
  var STAGES = [
    {
        "hub": "Toronto",
        "facilities": [
            {
                "name": "Pinewood Toronto Studios",
                "kind": "major purpose-built studio lot",
                "stages": "16 purpose-built stages, 450,000+ sq ft of stage space; Mega Stage ~45,900-46,000 sq ft (b",
                "notable": "Canada's largest purpose-built complex, in the Port Lands",
                "website": "https://pinewoodgroup.com/toronto-studios/stages-and-support-spaces/",
                "verified": true
            },
            {
                "name": "Cinespace Studios (Toronto)",
                "kind": "major multi-campus studio operator",
                "stages": "29 active stages, ~1.4 million sq ft across three campuses: Kipling (Studios A-N, FX East/",
                "notable": "Ontario's largest stage provider",
                "website": "https://cinespace.com/cinespace-toronto/",
                "verified": true
            },
            {
                "name": "Revival Film Studios (Revival 629)",
                "kind": "independent soundstage campus (former Toronto Film Studios)",
                "stages": "10 stages plus 9 support spaces on an 18.5-acre site (official site); industry press cites",
                "notable": "East-end campus at 629 Eastern Ave",
                "website": "https://revivalfilmstudios.ca/",
                "verified": true
            },
            {
                "name": "TriBro Studios",
                "kind": "independent full-service soundstages",
                "stages": "3 sound stages at 6 Curity Ave plus the Sandy Beach Studio site in Toronto East (dimension",
                "notable": "Mid-size full-service operator near the downtown core with production offices, wardrobe, carpentry/paint shops",
                "website": "https://tribrostudios.com/",
                "verified": true
            },
            {
                "name": "William F. White Studios / Studio City Toronto (Sunbelt Rentals)",
                "kind": "equipment-vendor-operated stage network",
                "stages": "Company materials cite 32 stages across nine facilities (~1M+ sq ft network-wide); acquire",
                "notable": "Canada's dominant grip/lighting vendor (a Sunbelt Rentals company) that bundles stages with equipment",
                "website": null,
                "verified": false
            },
            {
                "name": "Studio Toronto (formerly Downsview Park Studios)",
                "kind": "independent enclosed studio campus",
                "stages": "10 certified sound stages, ~300,000 sq ft, per Cinelease and Hollywood Reporter (2022 rela",
                "notable": "Fully-enclosed Downsview campus near Downsview Park Station with parking for ~1,000 cast/crew and 250 trucks",
                "website": null,
                "verified": false
            }
        ],
        "booking": "Toronto's major stages are booked direct with each studio's stage/booking team - none of the majors publish rates. You email or call the operator (e.g. stages@cinespace.com / 416-406-4000; Pinewood Toronto via its contact page; Revival at info@revivalfilmstudios.ca / 416-461-4500; TriBro at info@tri"
    },
    {
        "hub": "Vancouver",
        "facilities": [
            {
                "name": "Vancouver Film Studios",
                "kind": "major independent studio lot (purpose-built)",
                "stages": "13 purpose-built sound stages (site); Wikipedia lists sizes ~12,500-21,000 sq ft each, ~35",
                "notable": "East Vancouver flagship lot (McLean Group) at 3500 Cornett Rd",
                "website": "https://vancouverfilmstudios.com/",
                "verified": true
            },
            {
                "name": "Bridge Studios",
                "kind": "major multi-campus studio operator (purpose-built)",
                "stages": "38 sound stages across three Greater Vancouver campuses: Boundary (13 stages/15 acres), La",
                "notable": "BC's original multi-stage campus, now 100% fossil-fuel-free",
                "website": "https://bridgestudios.com/",
                "verified": true
            },
            {
                "name": "North Shore Studios",
                "kind": "purpose-built studio lot",
                "stages": "8 purpose-built stages, 11,010-20,544 sq ft each (~132,000 sq ft total), 30-40 ft clear he",
                "notable": "Industry-favourite North Vancouver lot founded 1989 by Stephen J. Cannell",
                "website": "https://nsstudios.ca/north-shore-studios/stages/",
                "verified": true
            },
            {
                "name": "Mammoth Studios",
                "kind": "converted big-box mega-stages (operated with North Shore Studios)",
                "stages": "278,771 sq ft of stage space; largest single stage 120,665 sq ft (among North America's bi",
                "notable": "Burnaby facility for the very largest builds — some of North America's largest sound stages under one roof",
                "website": "https://nsstudios.ca/mammoth-studios/",
                "verified": true
            },
            {
                "name": "Martini Film Studios",
                "kind": "independent converted-warehouse studio campus with backlot and standing sets",
                "stages": "~150,000 sq ft of converted sound stages (site currently presents Studios A/B/C; industry ",
                "notable": "Langley campus known for standing sets (Boeing 767-200 interior, courthouse, hospital ER), 16-acre 'Martini To",
                "website": "https://www.martinifilmstudios.com/",
                "verified": true
            },
            {
                "name": "Canadian Motion Picture Park Studios (CMPP)",
                "kind": "major independent studio park (purpose-built stages + backlot)",
                "stages": "18 sound stages, ~7,000-42,000 sq ft each; 300,000+ sq ft of stages/support on 25 acres; 4",
                "notable": "Burnaby studio park that hosted Godzilla (2014), TRON: Legacy, Watchmen, Twilight, Supernatural, Lucifer",
                "website": null,
                "verified": false
            }
        ],
        "booking": "There is no centralized booking system for Vancouver soundstages, and major facilities do not publish rates — everything at the professional tier is quote/lease-based. The standard path: (1) The BC Film Commission at Creative BC maintains a free public Stages + Studio Facilities directory (creativeb"
    },
    {
        "hub": "Atlanta",
        "facilities": [
            {
                "name": "Trilith Studios",
                "kind": "major purpose-built studio lot",
                "stages": "30+ soundstages (plus specialty stages Live A/B, Stage A, Town Stage), 15,000–40,000 sq ft",
                "notable": "Largest purpose-built studio campus in North America",
                "website": "https://www.trilithstudios.com",
                "verified": true
            },
            {
                "name": "Assembly Studios (Assembly Atlanta)",
                "kind": "major studio lot (owned by Gray Media, operated/booked by Universal Production Services)",
                "stages": "19 sound stages (site figure; some directories cite up to 22), roughly 15,000–30,000 sq ft",
                "notable": "Newest major Atlanta lot, built on the former GM Doraville plant",
                "website": "https://assemblyatlanta.com/studios/assembly-studios/",
                "verified": true
            },
            {
                "name": "Shadowbox Studios Atlanta (formerly Blackhall Studios)",
                "kind": "large independent soundstage campus",
                "stages": "9 soundstages, 19,200–38,400 sq ft (200,000+ sq ft stage space), 40-ft working heights, 65",
                "notable": "As Blackhall it hosted Jumanji: The Next Level and Venom 2",
                "website": "https://shadowboxstudios.com/atlanta/",
                "verified": true
            },
            {
                "name": "Tyler Perry Studios",
                "kind": "major private studio lot (rents to outside studios/networks, typically longer-term)",
                "stages": "12 purpose-built sound stages, 10,000–38,500 sq ft, 4000A 3-phase power, on the 330-acre f",
                "notable": "One of the largest US studio lots",
                "website": "https://tylerperrystudios.com",
                "verified": true
            },
            {
                "name": "Eagle Rock Studios Atlanta (Norcross)",
                "kind": "independent soundstage complex (single-roof TV/film facility)",
                "stages": "4 soundstages of ~28,500–30,300 sq ft each (~119,000 sq ft combined) plus 34,000+ sq ft of",
                "notable": "Workhorse for multi-cam TV and streaming series",
                "website": "https://eaglerockstudiosatl.com",
                "verified": true
            },
            {
                "name": "Electric Owl Studios",
                "kind": "independent purpose-built soundstage campus (sustainability-focused)",
                "stages": "140,000 sq ft of purpose-built stages plus 50,000 sq ft production offices, 90,000 sq ft m",
                "notable": "Bills itself as the world's first purpose-built LEED Gold certified film & TV studio",
                "website": "https://www.electricowlstudios.com",
                "verified": true
            }
        ],
        "booking": "Atlanta's major stages are not bookable off a rate card — every large facility (Trilith, Assembly, Shadowbox, Tyler Perry, Eagle Rock, Electric Owl) works on direct quotes negotiated with an in-house sales/booking team, and none publishes day rates. The normal path: (1) contact the facility's sales "
    },
    {
        "hub": "Los Angeles",
        "facilities": [
            {
                "name": "Warner Bros. Studios Burbank",
                "kind": "major studio lot",
                "stages": "30 stages, 14,000-32,000 sq ft (plus 16 more at the WB Ranch)",
                "notable": "Full-service historic major lot renting stages, backlot exterior sets, and crafts departments (lighting/grip, ",
                "website": "https://wbstudios.com/",
                "verified": true
            },
            {
                "name": "Sony Pictures Studios",
                "kind": "major studio lot",
                "stages": "18 stages, 7,600-42,000 sq ft; Stage 15 (42,000 sq ft, historically North America's larges",
                "notable": "Culver City lot of The Wizard of Oz-era MGM heritage",
                "website": "https://www.sonypicturesstudios.com/",
                "verified": true
            },
            {
                "name": "Sunset Studios (Sunset Gower / Sunset Bronson / Sunset Las Palmas)",
                "kind": "independent multi-campus studio operator (Hudson Pacific Properties)",
                "stages": "Three historic Hollywood campuses (est. 1918-1919); newer Sunset Glenoaks campus adds 7 st",
                "notable": "Largest independent stage operator in Hollywood proper",
                "website": "https://sunsetstudios.com/",
                "verified": true
            },
            {
                "name": "LA Center Studios",
                "kind": "independent full-service studio campus",
                "stages": "Six 18,000 sq ft audience-rated stages with floating wood floors and silent air",
                "notable": "20-acre downtown LA campus with 450,000 sq ft of production office space and closable public streets",
                "website": "https://lacenterstudios.com/",
                "verified": true
            },
            {
                "name": "Santa Clarita Studios",
                "kind": "independent studio lot with backlot",
                "stages": "35 stages, 6,000-48,000 sq ft; clear-span, audience-rated, min 3,600 amps and 60 tons AC e",
                "notable": "One of the largest independent facilities in the LA 30-mile zone, with a downtown backlot",
                "website": "https://www.sc-studios.com/",
                "verified": true
            },
            {
                "name": "Mack Sennett Studios",
                "kind": "historic boutique/converted soundstage complex",
                "stages": "Two large stages within ~25,000 sq ft, plus event spaces; white cycs, green screens, up to",
                "notable": "Operating since 1916 (Mack Sennett's silent-era studio) in Silver Lake",
                "website": "https://macksennettstudios.net/",
                "verified": true
            }
        ],
        "booking": "LA stage booking is almost entirely direct and quote-based — no major or mid-size facility publishes a rate card. Productions contact each lot's studio operations/leasing office (e.g. Warner Bros. studio.leasing@wbd.com; Sony Studio Operations 310-244-6926; independents often list named executives, "
    },
    {
        "hub": "New York",
        "facilities": [
            {
                "name": "Steiner Studios",
                "kind": "major studio lot (Brooklyn Navy Yard)",
                "stages": "30 stages, ~780,000 sq ft on a 50-acre gated lot; stages roughly 2,480–27,200 sq ft, grids",
                "notable": "Largest purpose-built studio campus on the East Coast",
                "website": "https://www.steinerstudios.com/",
                "verified": true
            },
            {
                "name": "Silvercup Studios",
                "kind": "major independent studio complex (3 lots: 2 in Long Island City, 1 in the Bronx)",
                "stages": "23 stages totaling ~240,000 sq ft; individual stages 2,100–16,220 sq ft, ceilings to 50 ft",
                "notable": "Operating since 1983",
                "website": "http://www.silvercupstudios.com/",
                "verified": true
            },
            {
                "name": "Kaufman Astoria Studios",
                "kind": "major historic studio lot (Astoria, Queens)",
                "stages": "11 stages totaling 147,000+ sq ft (7 column-free), plus NYC's only outdoor backlot (~34,80",
                "notable": "1920 Paramount-era landmark lot",
                "website": null,
                "verified": true
            },
            {
                "name": "Broadway Stages",
                "kind": "large independent multi-site stage operator (Brooklyn/Queens/Staten Island)",
                "stages": "60+ soundstages across three boroughs; 4M+ sq ft of integrated space and 16+ acres of park",
                "notable": "NYC's biggest independent stage landlord — episodic TV workhorse (e.g. the FBI franchise) with unique owned lo",
                "website": "https://broadway-stages.com/",
                "verified": true
            },
            {
                "name": "Wildflower Studios",
                "kind": "new purpose-built vertical studio campus (Astoria waterfront, Queens)",
                "stages": "11 combinable stages averaging ~18,000 sq ft each; 760,000 sq ft total; 45-ft grid height;",
                "notable": "Opened mid-2020s",
                "website": "https://www.wildflowerstudios.com/",
                "verified": true
            },
            {
                "name": "York Studios",
                "kind": "independent purpose-built soundstage facility (two campuses)",
                "stages": "Michaelangelo Campus: 175,000 sq ft in Soundview, Bronx; Maspeth Campus: 40,000 sq ft in Q",
                "notable": "Founded 2012",
                "website": "https://www.yorkstudios.com/",
                "verified": true
            }
        ],
        "booking": "NYC is a direct-quote market: none of the major studios publish rates. Productions contact each facility's studio operations/booking office directly, and pricing is negotiated per project based on stage size, term (episodic series often hold stages for months or years, which drives scarcity), and bu"
    },
    {
        "hub": "London",
        "facilities": [
            {
                "name": "Pinewood Studios",
                "kind": "major studio lot (Iver Heath, west of London)",
                "stages": "30 sound stages of varying sizes, plus 3 exterior backlots and a permanently filled Underw",
                "notable": "The UK's flagship lot for 90 years — home of the James Bond franchise and large-scale action/franchise filmmak",
                "website": "https://www.pinewoodgroup.com/our-studios/pinewood-studios/",
                "verified": true
            },
            {
                "name": "Warner Bros. Studios Leavesden",
                "kind": "major studio lot (Watford, NW of London)",
                "stages": "350,000 sq ft of sound stages (individual stage count not published on homepage), Europe's",
                "notable": "Warner Bros.' UK production hub — the Harry Potter lot, now first-choice for tentpole features",
                "website": "https://www.wbsl.com/",
                "verified": true
            },
            {
                "name": "Elstree Studios",
                "kind": "independent major studios (Borehamwood, ~20 min from central London)",
                "stages": "multiple film/TV stages (exact count/sizes not published on homepage)",
                "notable": "Century-old studio known for The Crown, Strictly Come Dancing, Gangs of London and its Star Wars heritage",
                "website": "https://www.elstreestudios.co.uk/",
                "verified": true
            },
            {
                "name": "3 Mills Studios",
                "kind": "independent soundstage campus (East London, E3)",
                "stages": "9 main production stages totaling ~75,000 sq ft, plus rehearsal stages and 130+ offices",
                "notable": "East London's iconic film/TV/theatre campus — London 2012 ceremonies, recent features incl. Blitz",
                "website": "https://3mills.com/",
                "verified": true
            },
            {
                "name": "Ealing Studios",
                "kind": "historic independent studio lot (West London)",
                "stages": "5 sound stages totaling ~37,000 sq ft, incl. a new 14,000 sq ft net-zero stage and three l",
                "notable": "The world's oldest continuously operating film studio (est. 1902) — Black Mirror, Darkest Hour, Last Night in ",
                "website": "https://ealingstudios.com/",
                "verified": true
            },
            {
                "name": "Garden Studios",
                "kind": "independent soundstage campus with permanent virtual production stage (Park Royal, West London)",
                "stages": "8 sound stages from 5,005 to 23,414 sq ft, plus a 7,815 sq ft permanent LED-volume Virtual",
                "notable": "London's leading virtual-production campus — permanent LED volume with wet-hire VP services alongside conventi",
                "website": "https://gardenstudios.io/",
                "verified": true
            }
        ],
        "booking": "Feature/HETV soundstages in the London market are booked directly with each studio's in-house bookings/sales team and are almost universally quote-based — none of the major facilities publish rate cards. Quotes depend on stage size, hire duration, and ancillary space (production offices, workshops, "
    }
];

  /* Advisor jurisdiction (SB_Budget_v1.incentive) → permit/stage hub */
  var INCENTIVE_HUB = {
    ontario: 'Toronto', bc: 'Vancouver', georgia: 'Atlanta',
    california: 'Los Angeles', newyork: 'New York',
    ukavec: 'London', ukiftc: 'London'
  };
  function hubForIncentive(id) {
    return INCENTIVE_HUB[String(id || '').toLowerCase()] || null;
  }

  /* ── 3 · fuzzy hub matching ─────────────────────────────────────────── */
  var HUB_ALIAS = { la: 'Los Angeles', nyc: 'New York', 'new york city': 'New York',
    hollywood: 'Los Angeles', burbank: 'Los Angeles', brooklyn: 'New York',
    queens: 'New York', burnaby: 'Vancouver', gta: 'Toronto' };
  function matchHub(cityText, list) {
    var lc = String(cityText || '').toLowerCase().trim();
    if (!lc) return null;
    var hit = null;
    var alias = HUB_ALIAS[lc];
    list.forEach(function (entry) {
      var hub = entry.hub.toLowerCase();
      if (entry.hub === alias || lc.indexOf(hub) >= 0 ||
          (lc.length >= 4 && hub.indexOf(lc) >= 0)) hit = entry;
    });
    return hit;
  }
  function permitFor(cityText) { return matchHub(cityText, PERMITS); }
  function stagesFor(cityText) { return matchHub(cityText, STAGES); }

  function searchLink(name, city) {
    return 'https://www.google.com/search?q=' +
      encodeURIComponent(String(name || '') + ' ' + String(city || '')).replace(/%20/g, '+');
  }

  /* ── 4 · golden hour — compact NOAA-style approximation ───────────────
     Returns LOCAL SOLAR TIME (solar noon = 12:00): no timezone or
     longitude correction is applied, so real clock times shift by up to
     ~an hour either way plus DST. Every result carries the note.        */
  var RAD = Math.PI / 180;
  function dayOfYear(isoDate) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) days[1] = 29;
    var n = d, i;
    for (i = 0; i < mo - 1; i++) n += days[i];
    return n;
  }
  function fmtHour(h) {
    while (h < 0) h += 24;
    while (h >= 24) h -= 24;
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function goldenHour(lat, isoDate) {
    var NOTE = 'solar time — verify locally';
    var n = dayOfYear(isoDate);
    var la = +lat;
    if (n == null || !isFinite(la) || la < -90 || la > 90) {
      return { sunrise: null, sunset: null, goldenAmStart: null, goldenPmStart: null,
               polar: null, error: 'bad input', note: NOTE };
    }
    /* Cooper's declination formula + official-sunrise zenith 90.833° */
    var decl = 23.44 * Math.sin(2 * Math.PI * (284 + n) / 365);
    var cosH = (Math.cos(90.833 * RAD) - Math.sin(la * RAD) * Math.sin(decl * RAD)) /
               (Math.cos(la * RAD) * Math.cos(decl * RAD));
    if (cosH > 1)  return { sunrise: null, sunset: null, goldenAmStart: null, goldenPmStart: null,
                            polar: 'polar night — sun never rises this date', note: NOTE };
    if (cosH < -1) return { sunrise: null, sunset: null, goldenAmStart: null, goldenPmStart: null,
                            polar: 'midnight sun — sun never sets this date', note: NOTE };
    var H = Math.acos(cosH) / RAD / 15;          /* half day-length in hours */
    var rise = 12 - H, set = 12 + H;
    return {
      sunrise: fmtHour(rise), sunset: fmtHour(set),
      goldenAmStart: fmtHour(rise),              /* golden light runs ~1h from sunrise */
      goldenPmStart: fmtHour(set - 1),           /* …and the last ~1h before sunset    */
      dayLength: Math.round(H * 2 * 10) / 10,
      polar: null, note: NOTE
    };
  }

  /* ── 5 · tech-scout checklist ─────────────────────────────────────────── */
  function locationChecklist() {
    return [
      { id: 'power',     item: 'Power',        detail: 'House power capacity and tie-in point, or generator spot (with cable run + noise distance).' },
      { id: 'parking',   item: 'Parking',      detail: 'Trucks, basecamp, and crew parking — measured, legal, and close enough to matter.' },
      { id: 'loadin',    item: 'Load-in',      detail: 'Doors, ramps, stairs, elevator dimensions and weight limits; push distance to set.' },
      { id: 'bathrooms', item: 'Bathrooms',    detail: 'Working facilities on site or honeywagon spot — count against crew size.' },
      { id: 'neighbors', item: 'Neighbors',    detail: 'Who is next door, who needs notification letters, who can shut you down.' },
      { id: 'noise',     item: 'Noise',        detail: 'Flight paths, traffic, HVAC, schools, church bells — listen at the hour you will shoot.' },
      { id: 'cell',      item: 'Cell signal',  detail: 'Coverage for every carrier the crew uses; dead zones change the walkie plan.' },
      { id: 'hospital',  item: 'Nearest hospital', detail: 'Name, address, and drive time — this line feeds the call sheet safety block.' },
      { id: 'permits',   item: 'Permits',      detail: 'Which jurisdiction, what activities are covered, lead time and conditions.' },
      { id: 'coi',       item: 'Insurance COI', detail: 'Certificate of insurance naming the owner/city — amount, additional insureds, delivery before load-in.' }
    ];
  }

  /* ── 6 · location records + screenplay mining ──────────────────────── */
  function blankLocation(fields) {
    var f = fields || {};
    return {
      id: f.id || ('loc' + Math.random().toString(36).slice(2, 9)),
      name: f.name || '', address: f.address || '', scenes: f.scenes || '',
      hospital: f.hospital || '', hospitalAddress: f.hospitalAddress || '',
      parking: f.parking || '', power: f.power || '', loadIn: f.loadIn || '',
      notes: f.notes || '', permitStatus: 'none', releaseStatus: 'none', photos: []
    };
  }

  /* Unique script locations from sluglines: [{name, scenes:[n..]}] */
  function scriptLocations(scriptText) {
    var lines = String(scriptText || '').split(/\r?\n/);
    var n = 0, map = {}, order = [];
    lines.forEach(function (ln) {
      if (!/^\s*(?:\d+[\s.]*)?(INT|EXT|INT\/EXT|I\/E)[.\s]/i.test(ln)) return;
      n++;
      var s = ln.replace(/^\s*(?:\d+[\s.]*)?/, '')
                .replace(/^(INT\/EXT|I\/E|INT|EXT)[.\s]+/i, '')
                .split(/\s+[-–—]\s+/)[0]
                .replace(/[.\s]+$/, '').trim().toUpperCase();
      if (!s) s = '(UNNAMED LOCATION)';
      if (!map[s]) { map[s] = { name: s, scenes: [] }; order.push(s); }
      if (map[s].scenes.indexOf(n) < 0) map[s].scenes.push(n);
    });
    return order.map(function (k) { return map[k]; });
  }

  root.CScout = {
    PERMITS: PERMITS, STAGES: STAGES, INCENTIVE_HUB: INCENTIVE_HUB,
    hubForIncentive: hubForIncentive, permitFor: permitFor, stagesFor: stagesFor,
    searchLink: searchLink, goldenHour: goldenHour, dayOfYear: dayOfYear,
    locationChecklist: locationChecklist, blankLocation: blankLocation,
    scriptLocations: scriptLocations
  };
})(typeof window !== 'undefined' ? window : globalThis);
