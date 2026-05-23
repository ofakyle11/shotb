// /.netlify/functions/get-analysis
// Returns today's AI-generated analysis from Firebase
// Frontend calls this instead of generating template analysis

const DB = 'https://atlas-intelligence-37d6d-default-rtdb.firebaseio.com';
const SECRET = process.env.FIREBASE_DB_SECRET;

function cors(code, body) {
  return { statusCode: code, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, {});
  if (!SECRET) return cors(500, { error: 'Not configured' });

  try {
    const params = event.queryStringParameters || {};
    const date = params.date || new Date().toISOString().split('T')[0];
    
    // Get specific ticker
    if (params.ticker) {
      const res = await fetch(`${DB}/daily_analysis/${date}/stocks/${params.ticker}.json?auth=${SECRET}`);
      const data = res.ok ? await res.json() : null;
      if (!data) return cors(404, { error: 'No analysis for ' + params.ticker + ' on ' + date });
      return cors(200, { ticker: params.ticker, date, ...data });
    }

    // Get full day's analysis
    const res = await fetch(`${DB}/daily_analysis/${date}.json?auth=${SECRET}`);
    const data = res.ok ? await res.json() : null;
    if (!data || !data.stocks) return cors(404, { error: 'No analysis for ' + date });
    
    return cors(200, { date, meta: data.meta, stocks: data.stocks, rankings: data.rankings || null });
  } catch (e) {
    return cors(500, { error: e.message });
  }
};
