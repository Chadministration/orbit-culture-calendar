exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'TMDB_API_KEY not set' }) };
  }

  const params = new URLSearchParams(event.queryStringParameters || {});
  params.set('api_key', apiKey);

  // Path after /api/tmdb becomes the TMDB endpoint, e.g. /discover/movie
  const rawPath = event.path || '';
  const tmdbPath = rawPath.replace(/^\/?api\/tmdb/, '') || '/discover/movie';

  const url = `https://api.themoviedb.org/3${tmdbPath}?${params}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    return {
      statusCode: resp.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
