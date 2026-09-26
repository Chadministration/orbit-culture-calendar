exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'TICKETMASTER_API_KEY not set' }) };
  }

  // Forward all query params from the request, inject the real API key
  const params = new URLSearchParams(event.queryStringParameters || {});
  params.set('apikey', apiKey);

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;

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
