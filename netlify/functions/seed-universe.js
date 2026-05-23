// /.netlify/functions/seed-universe
// Populates Firebase with a large stock universe (200+ stocks)
// The daily-analysis engine picks the strongest movers from this pool each morning
// Run once, then update periodically to add new candidates

const DB = 'https://atlas-intelligence-37d6d-default-rtdb.firebaseio.com';
const SECRET = process.env.FIREBASE_DB_SECRET;

function cors(code, body) {
  return { statusCode: code, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

const UNIVERSE = {
  mining: {
    name: 'Mining', ic: '⛏️', color: 'var(--mining)',
    desc: 'Gold, silver, copper, lithium, uranium & rare earth miners on TSX/NYSE',
    stocks: [
      { t: 'ABX', n: 'Barrick Gold Corp', x: 'NYSE', i: 'Gold Mining' },
      { t: 'NEM', n: 'Newmont Corporation', x: 'NYSE', i: 'Gold Mining' },
      { t: 'AEM', n: 'Agnico Eagle Mines', x: 'NYSE', i: 'Gold Mining' },
      { t: 'WPM', n: 'Wheaton Precious Metals', x: 'NYSE', i: 'Precious Metals Streaming' },
      { t: 'TECK', n: 'Teck Resources Ltd', x: 'NYSE', i: 'Diversified Mining' },
      { t: 'FCX', n: 'Freeport-McMoRan Inc', x: 'NYSE', i: 'Copper & Gold Mining' },
      { t: 'RIO', n: 'Rio Tinto Group', x: 'NYSE', i: 'Diversified Mining' },
      { t: 'BHP', n: 'BHP Group Ltd', x: 'NYSE', i: 'Diversified Mining' },
      { t: 'VALE', n: 'Vale S.A.', x: 'NYSE', i: 'Iron Ore & Nickel Mining' },
      { t: 'GOLD', n: 'Barrick Gold Corp', x: 'NYSE', i: 'Gold Mining' },
      { t: 'KGC', n: 'Kinross Gold Corp', x: 'NYSE', i: 'Gold Mining' },
      { t: 'PAAS', n: 'Pan American Silver', x: 'NYSE', i: 'Silver Mining' },
      { t: 'AG', n: 'First Majestic Silver', x: 'NYSE', i: 'Silver Mining' },
      { t: 'FNV', n: 'Franco-Nevada Corp', x: 'NYSE', i: 'Precious Metals Royalty' },
      { t: 'SLI', n: 'Standard Lithium', x: 'NYSE', i: 'Lithium Mining' },
      { t: 'LAC', n: 'Lithium Americas', x: 'NYSE', i: 'Lithium Mining' },
      { t: 'ALB', n: 'Albemarle Corp', x: 'NYSE', i: 'Lithium & Specialty Chemicals' },
      { t: 'MP', n: 'MP Materials Corp', x: 'NYSE', i: 'Rare Earth Mining' },
      { t: 'SCCO', n: 'Southern Copper Corp', x: 'NYSE', i: 'Copper Mining' },
      { t: 'AA', n: 'Alcoa Corporation', x: 'NYSE', i: 'Aluminum Mining' },
    ]
  },
  ai: {
    name: 'AI', ic: '🤖', color: 'var(--ai)',
    desc: 'Artificial intelligence, machine learning & autonomous systems',
    stocks: [
      { t: 'PLTR', n: 'Palantir Technologies', x: 'NYSE', i: 'Defense AI & Analytics' },
      { t: 'AI', n: 'C3.ai Inc', x: 'NYSE', i: 'Enterprise AI Platform' },
      { t: 'PATH', n: 'UiPath Inc', x: 'NYSE', i: 'AI Process Automation' },
      { t: 'SOUN', n: 'SoundHound AI Inc', x: 'NYSE', i: 'Conversational AI' },
      { t: 'BBAI', n: 'BigBear.ai Holdings', x: 'NYSE', i: 'Decision Intelligence AI' },
      { t: 'BB', n: 'BlackBerry Limited', x: 'NYSE', i: 'IoT & Cybersecurity AI' },
      { t: 'SNOW', n: 'Snowflake Inc', x: 'NYSE', i: 'Cloud Data & AI Platform' },
      { t: 'CRWD', n: 'CrowdStrike Holdings', x: 'NYSE', i: 'AI Cybersecurity' },
      { t: 'DDOG', n: 'Datadog Inc', x: 'NYSE', i: 'Cloud Monitoring & AI' },
      { t: 'NVDA', n: 'NVIDIA Corporation', x: 'NYSE', i: 'AI Chips & GPUs' },
      { t: 'AMD', n: 'Advanced Micro Devices', x: 'NYSE', i: 'AI Semiconductors' },
      { t: 'MSFT', n: 'Microsoft Corporation', x: 'NYSE', i: 'Cloud & AI Infrastructure' },
      { t: 'GOOGL', n: 'Alphabet Inc', x: 'NYSE', i: 'Search & AI' },
      { t: 'META', n: 'Meta Platforms Inc', x: 'NYSE', i: 'Social & AI' },
      { t: 'AMZN', n: 'Amazon.com Inc', x: 'NYSE', i: 'Cloud & AI Services' },
      { t: 'UPST', n: 'Upstart Holdings', x: 'NYSE', i: 'AI Lending' },
      { t: 'S', n: 'SentinelOne Inc', x: 'NYSE', i: 'AI Cybersecurity' },
      { t: 'AAPL', n: 'Apple Inc', x: 'NYSE', i: 'Consumer AI & Devices' },
      { t: 'MDB', n: 'MongoDB Inc', x: 'NYSE', i: 'AI Database Platform' },
      { t: 'TSLA', n: 'Tesla Inc', x: 'NYSE', i: 'AI & Autonomous Vehicles' },
    ]
  },
  tech: {
    name: 'Tech', ic: '💻', color: 'var(--tech)',
    desc: 'Software, cloud computing, semiconductors & digital infrastructure',
    stocks: [
      { t: 'OTEX', n: 'Open Text Corp', x: 'NYSE', i: 'Enterprise Software' },
      { t: 'GDDY', n: 'GoDaddy Inc', x: 'NYSE', i: 'Web Services' },
      { t: 'SHOP', n: 'Shopify Inc', x: 'NYSE', i: 'E-Commerce Platform' },
      { t: 'ANET', n: 'Arista Networks', x: 'NYSE', i: 'Cloud Networking' },
      { t: 'CSU', n: 'Constellation Software', x: 'TSX', i: 'Vertical Market Software' },
      { t: 'TSM', n: 'Taiwan Semiconductor', x: 'NYSE', i: 'Semiconductor Foundry' },
      { t: 'CRM', n: 'Salesforce Inc', x: 'NYSE', i: 'Enterprise CRM' },
      { t: 'ORCL', n: 'Oracle Corporation', x: 'NYSE', i: 'Cloud & Database' },
      { t: 'PANW', n: 'Palo Alto Networks', x: 'NYSE', i: 'Cybersecurity' },
      { t: 'NOW', n: 'ServiceNow Inc', x: 'NYSE', i: 'IT Workflow Platform' },
      { t: 'AVGO', n: 'Broadcom Inc', x: 'NYSE', i: 'Semiconductors' },
      { t: 'INTC', n: 'Intel Corporation', x: 'NYSE', i: 'Semiconductors' },
      { t: 'ADBE', n: 'Adobe Inc', x: 'NYSE', i: 'Creative Software' },
      { t: 'UBER', n: 'Uber Technologies', x: 'NYSE', i: 'Mobility Platform' },
      { t: 'NET', n: 'Cloudflare Inc', x: 'NYSE', i: 'Edge Computing' },
      { t: 'ZS', n: 'Zscaler Inc', x: 'NYSE', i: 'Cloud Security' },
      { t: 'TEAM', n: 'Atlassian Corp', x: 'NYSE', i: 'DevOps & Collaboration' },
      { t: 'MRVL', n: 'Marvell Technology', x: 'NYSE', i: 'Data Infrastructure Chips' },
      { t: 'DELL', n: 'Dell Technologies', x: 'NYSE', i: 'Enterprise Hardware' },
      { t: 'HPE', n: 'Hewlett Packard Enterprise', x: 'NYSE', i: 'Enterprise Infrastructure' },
    ]
  },
  biotech: {
    name: 'Biotech', ic: '🧬', color: 'var(--biotech)',
    desc: 'Biotechnology, pharmaceuticals, gene therapy & medical innovation',
    stocks: [
      { t: 'MRNA', n: 'Moderna Inc', x: 'NYSE', i: 'mRNA Therapeutics' },
      { t: 'CRSP', n: 'CRISPR Therapeutics', x: 'NYSE', i: 'Gene Editing' },
      { t: 'BNTX', n: 'BioNTech SE', x: 'NYSE', i: 'mRNA & Cancer Immunotherapy' },
      { t: 'ABCL', n: 'AbCellera Biologics', x: 'NYSE', i: 'Antibody Discovery AI' },
      { t: 'VRTX', n: 'Vertex Pharmaceuticals', x: 'NYSE', i: 'Gene Therapy' },
      { t: 'RXRX', n: 'Recursion Pharma', x: 'NYSE', i: 'AI Drug Discovery' },
      { t: 'REGN', n: 'Regeneron Pharmaceuticals', x: 'NYSE', i: 'Biotech Therapeutics' },
      { t: 'BIIB', n: 'Biogen Inc', x: 'NYSE', i: 'Neuroscience Biotech' },
      { t: 'GILD', n: 'Gilead Sciences', x: 'NYSE', i: 'Antiviral & Oncology' },
      { t: 'AMGN', n: 'Amgen Inc', x: 'NYSE', i: 'Large-Cap Biotech' },
      { t: 'LLY', n: 'Eli Lilly and Company', x: 'NYSE', i: 'GLP-1 & Diabetes' },
      { t: 'PFE', n: 'Pfizer Inc', x: 'NYSE', i: 'Big Pharma' },
      { t: 'JNJ', n: 'Johnson & Johnson', x: 'NYSE', i: 'Diversified Healthcare' },
      { t: 'ABBV', n: 'AbbVie Inc', x: 'NYSE', i: 'Immunology & Oncology' },
      { t: 'BMY', n: 'Bristol-Myers Squibb', x: 'NYSE', i: 'Oncology & Cardiology' },
      { t: 'ILMN', n: 'Illumina Inc', x: 'NYSE', i: 'Genomic Sequencing' },
      { t: 'IONS', n: 'Ionis Pharmaceuticals', x: 'NYSE', i: 'RNA Therapeutics' },
      { t: 'EXAS', n: 'Exact Sciences', x: 'NYSE', i: 'Cancer Diagnostics' },
      { t: 'NTLA', n: 'Intellia Therapeutics', x: 'NYSE', i: 'In Vivo Gene Editing' },
      { t: 'BEAM', n: 'Beam Therapeutics', x: 'NYSE', i: 'Base Editing' },
    ]
  },
  energy: {
    name: 'Energy', ic: '⚡', color: 'var(--energy)',
    desc: 'Oil, gas, uranium, renewables & energy infrastructure',
    stocks: [
      { t: 'SU', n: 'Suncor Energy', x: 'NYSE', i: 'Oil Sands & Refining' },
      { t: 'CCJ', n: 'Cameco Corporation', x: 'NYSE', i: 'Uranium Mining' },
      { t: 'CNQ', n: 'Canadian Natural Resources', x: 'NYSE', i: 'Oil & Gas Production' },
      { t: 'ENB', n: 'Enbridge Inc', x: 'NYSE', i: 'Pipeline & Midstream' },
      { t: 'XOM', n: 'Exxon Mobil Corporation', x: 'NYSE', i: 'Integrated Oil & Gas' },
      { t: 'FSLR', n: 'First Solar Inc', x: 'NYSE', i: 'Solar Manufacturing' },
      { t: 'CVX', n: 'Chevron Corporation', x: 'NYSE', i: 'Integrated Oil & Gas' },
      { t: 'COP', n: 'ConocoPhillips', x: 'NYSE', i: 'Exploration & Production' },
      { t: 'NEE', n: 'NextEra Energy Inc', x: 'NYSE', i: 'Renewable Energy & Utilities' },
      { t: 'OXY', n: 'Occidental Petroleum', x: 'NYSE', i: 'Oil & Gas + Carbon Capture' },
      { t: 'DVN', n: 'Devon Energy Corp', x: 'NYSE', i: 'Shale Oil & Gas' },
      { t: 'PXD', n: 'Pioneer Natural Resources', x: 'NYSE', i: 'Permian Basin E&P' },
      { t: 'ENPH', n: 'Enphase Energy', x: 'NYSE', i: 'Solar Microinverters' },
      { t: 'TRP', n: 'TC Energy Corporation', x: 'NYSE', i: 'Pipeline Infrastructure' },
      { t: 'SLB', n: 'Schlumberger Ltd', x: 'NYSE', i: 'Oilfield Services' },
      { t: 'HAL', n: 'Halliburton Company', x: 'NYSE', i: 'Oilfield Services' },
      { t: 'SEDG', n: 'SolarEdge Technologies', x: 'NYSE', i: 'Solar Inverters' },
      { t: 'UEC', n: 'Uranium Energy Corp', x: 'NYSE', i: 'Uranium Mining' },
      { t: 'NXE', n: 'NexGen Energy Ltd', x: 'NYSE', i: 'Uranium Development' },
      { t: 'BE', n: 'Bloom Energy Corp', x: 'NYSE', i: 'Fuel Cell Technology' },
    ]
  },
  defense: {
    name: 'Defense', ic: '🛡️', color: 'var(--defense)',
    desc: 'Aerospace, defense contractors, military tech & cybersecurity',
    stocks: [
      { t: 'LMT', n: 'Lockheed Martin Corp', x: 'NYSE', i: 'Aerospace & Defense' },
      { t: 'GD', n: 'General Dynamics', x: 'NYSE', i: 'Defense & Aerospace' },
      { t: 'RTX', n: 'RTX Corporation', x: 'NYSE', i: 'Defense & Aerospace' },
      { t: 'CAE', n: 'CAE Inc', x: 'NYSE', i: 'Simulation & Training' },
      { t: 'AXON', n: 'Axon Enterprise Inc', x: 'NYSE', i: 'Law Enforcement Tech' },
      { t: 'NOC', n: 'Northrop Grumman Corp', x: 'NYSE', i: 'Aerospace & Defense' },
      { t: 'HII', n: 'Huntington Ingalls Industries', x: 'NYSE', i: 'Naval Shipbuilding' },
      { t: 'LHX', n: 'L3Harris Technologies', x: 'NYSE', i: 'Defense Electronics' },
      { t: 'BA', n: 'Boeing Company', x: 'NYSE', i: 'Aerospace & Defense' },
      { t: 'TDG', n: 'TransDigm Group', x: 'NYSE', i: 'Aerospace Components' },
      { t: 'HWM', n: 'Howmet Aerospace', x: 'NYSE', i: 'Aerospace Materials' },
      { t: 'LDOS', n: 'Leidos Holdings', x: 'NYSE', i: 'Defense IT Services' },
      { t: 'KTOS', n: 'Kratos Defense & Security', x: 'NYSE', i: 'Drone & Missile Tech' },
      { t: 'RKLB', n: 'Rocket Lab USA', x: 'NYSE', i: 'Space Launch & Satellites' },
      { t: 'ASTS', n: 'AST SpaceMobile', x: 'NYSE', i: 'Space-Based Broadband' },
      { t: 'BWXT', n: 'BWX Technologies', x: 'NYSE', i: 'Nuclear Technology' },
      { t: 'AVAV', n: 'AeroVironment Inc', x: 'NYSE', i: 'Military Drones' },
      { t: 'MRCY', n: 'Mercury Systems', x: 'NYSE', i: 'Defense Electronics' },
      { t: 'SPR', n: 'Spirit AeroSystems', x: 'NYSE', i: 'Aerospace Structures' },
      { t: 'GILT', n: 'Gilat Satellite Networks', x: 'NYSE', i: 'Satellite Communications' },
    ]
  },
  media: {
    name: 'Media', ic: '📺', color: 'var(--media)',
    desc: 'Streaming, entertainment, social media & digital content',
    stocks: [
      { t: 'DIS', n: 'Walt Disney Company', x: 'NYSE', i: 'Entertainment & Streaming' },
      { t: 'NFLX', n: 'Netflix Inc', x: 'NYSE', i: 'Streaming Entertainment' },
      { t: 'SPOT', n: 'Spotify Technology', x: 'NYSE', i: 'Audio Streaming' },
      { t: 'WBD', n: 'Warner Bros Discovery', x: 'NYSE', i: 'Media Conglomerate' },
      { t: 'PARA', n: 'Paramount Global', x: 'NYSE', i: 'Media Conglomerate' },
      { t: 'ROKU', n: 'Roku Inc', x: 'NYSE', i: 'Connected TV Platform' },
      { t: 'SNAP', n: 'Snap Inc', x: 'NYSE', i: 'Social Media' },
      { t: 'PINS', n: 'Pinterest Inc', x: 'NYSE', i: 'Visual Discovery' },
      { t: 'RDDT', n: 'Reddit Inc', x: 'NYSE', i: 'Social Platform' },
      { t: 'RBLX', n: 'Roblox Corporation', x: 'NYSE', i: 'Gaming & Metaverse' },
      { t: 'TTWO', n: 'Take-Two Interactive', x: 'NYSE', i: 'Video Games' },
      { t: 'EA', n: 'Electronic Arts', x: 'NYSE', i: 'Video Games' },
      { t: 'LYV', n: 'Live Nation Entertainment', x: 'NYSE', i: 'Live Events & Ticketing' },
      { t: 'CMCSA', n: 'Comcast Corporation', x: 'NYSE', i: 'Cable & Media' },
      { t: 'IMAX', n: 'IMAX Corporation', x: 'NYSE', i: 'Cinema Technology' },
    ]
  },
  other: {
    name: 'Other', ic: '📊', color: 'var(--other)',
    desc: 'Fintech, infrastructure, consumer & diversified holdings',
    stocks: [
      { t: 'V', n: 'Visa Inc', x: 'NYSE', i: 'Payment Networks' },
      { t: 'SQ', n: 'Block Inc', x: 'NYSE', i: 'Fintech & Payments' },
      { t: 'CNR', n: 'Canadian National Railway', x: 'NYSE', i: 'Rail Transportation' },
      { t: 'WM', n: 'Waste Management Inc', x: 'NYSE', i: 'Environmental Services' },
      { t: 'COST', n: 'Costco Wholesale', x: 'NYSE', i: 'Membership Retail' },
      { t: 'BAM', n: 'Brookfield Asset Management', x: 'NYSE', i: 'Alternative Asset Management' },
      { t: 'MA', n: 'Mastercard Inc', x: 'NYSE', i: 'Payment Networks' },
      { t: 'PYPL', n: 'PayPal Holdings', x: 'NYSE', i: 'Digital Payments' },
      { t: 'COIN', n: 'Coinbase Global', x: 'NYSE', i: 'Crypto Exchange' },
      { t: 'SOFI', n: 'SoFi Technologies', x: 'NYSE', i: 'Digital Banking' },
      { t: 'CP', n: 'Canadian Pacific Kansas City', x: 'NYSE', i: 'Rail Transportation' },
      { t: 'BRK.B', n: 'Berkshire Hathaway', x: 'NYSE', i: 'Diversified Holdings' },
      { t: 'JPM', n: 'JPMorgan Chase', x: 'NYSE', i: 'Investment Banking' },
      { t: 'GS', n: 'Goldman Sachs', x: 'NYSE', i: 'Investment Banking' },
      { t: 'WMT', n: 'Walmart Inc', x: 'NYSE', i: 'Retail' },
    ]
  }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, {});
  if (!SECRET) return cors(500, { error: 'Set FIREBASE_DB_SECRET' });

  try {
    // Store entire universe in Firebase
    await fetch(`${DB}/stock_universe.json?auth=${SECRET}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(UNIVERSE)
    });

    // Count
    let total = 0;
    Object.values(UNIVERSE).forEach(s => { total += s.stocks.length; });

    return cors(200, {
      message: `Universe seeded: ${total} stocks across ${Object.keys(UNIVERSE).length} sectors`,
      sectors: Object.entries(UNIVERSE).map(([k, v]) => `${k}: ${v.stocks.length} stocks`)
    });
  } catch (e) {
    return cors(500, { error: e.message });
  }
};
