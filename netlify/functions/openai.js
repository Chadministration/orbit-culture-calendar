// Proxy to OpenAI. Locked down so the key can only be spent by the Orbit site:
// - only requests from the site's own origin (Netlify's URL / DEPLOY_PRIME_URL, or ALLOWED_ORIGINS)
// - model, temperature and response_format are fixed here, not taken from the caller
// - request size and output tokens are capped
const MODEL = 'gpt-4o';
const MAX_BODY_BYTES = 400_000;   // full events list + live events + brief is ~150KB
const MAX_OUTPUT_TOKENS = 4000;

const allowedOrigins = () =>
  [process.env.URL, process.env.DEPLOY_PRIME_URL, ...(process.env.ALLOWED_ORIGINS || '').split(',')]
    .map(o => (o || '').trim().replace(/\/$/, ''))
    .filter(Boolean);

exports.handler = async (event) => {
  const origin = (event.headers.origin || '').replace(/\/$/, '');
  const originOk = allowedOrigins().includes(origin);
  const CORS = {
    'Access-Control-Allow-Origin': originOk ? origin : 'null',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const fail = (statusCode, error) =>
    ({ statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: { message: error } }) });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: originOk ? 204 : 403, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');
  if (!originOk) return fail(403, 'Requests are only accepted from the Orbit site');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fail(500, 'OPENAI_API_KEY not set');

  if ((event.body || '').length > MAX_BODY_BYTES) return fail(413, 'Request too large');

  let messages;
  try {
    ({ messages } = JSON.parse(event.body || '{}'));
  } catch {
    return fail(400, 'Invalid JSON');
  }
  const valid = Array.isArray(messages) && messages.length > 0 && messages.length <= 4 &&
    messages.every(m => ['system', 'user'].includes(m?.role) && typeof m.content === 'string');
  if (!valid) return fail(400, 'Invalid messages');

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        max_tokens: MAX_OUTPUT_TOKENS,
        messages,
      }),
    });
    const data = await resp.json();
    return {
      statusCode: resp.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return fail(502, e.message);
  }
};
