// What the internet is talking about: live right now (Google Trends, YouTube, Bluesky, Reddit,
// Wikipedia pages spiking per country)
// plus what has been trending for many hours this week (from the hourly trend-snapshot job).
// Cached at Netlify's edge for an hour.
const { getStore, connectLambda } = require('@netlify/blobs');
const { MARKETS, googleTrends, youtube, bluesky, reddit, wikipediaRising, settledValues } = require('../lib/trend-sources');

const MIN_HOURS = 6;  // "trending all week" = seen in at least this many hourly snapshots

async function risingThisWeek(event, markets) {
  connectLambda(event);
  const weekly = await getStore('trends').get('weekly', { type: 'json' });
  if (!weekly) return [];
  return Object.values(weekly.items)
    .filter(it => it.hours >= MIN_HOURS && markets.includes(it.market))
    .sort((a, b) => b.hours - a.hours || b.peak - a.peak)
    .slice(0, 25);
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const chosen = (q.markets || '').split(',').map(m => m.trim().toUpperCase()).filter(m => MARKETS.includes(m));
  const markets = (chosen.length ? chosen : ['AU', 'US', 'UK']).slice(0, 4);
  const subs = (q.subs || '').split(',').map(s => s.trim()).filter(s => /^[A-Za-z0-9_]{2,21}$/.test(s)).slice(0, 8);

  const sources = {
    google: settledValues(markets.map(googleTrends)),
    youtube: settledValues(markets.map(youtube)),
    wikipedia: settledValues(markets.map(wikipediaRising)),
    bluesky: bluesky(),
    reddit: subs.length ? reddit(subs) : Promise.resolve([]),
    rising: risingThisWeek(event, markets),
  };
  const names = Object.keys(sources);
  const settled = await Promise.allSettled(Object.values(sources));
  const body = { errors: [] };
  settled.forEach((s, i) => {
    body[names[i]] = s.status === 'fulfilled' ? s.value : [];
    if (s.status === 'rejected') body.errors.push(`${names[i]}: ${s.reason.message}`);
  });
  if (!process.env.YOUTUBE_API_KEY) body.errors.push('youtube: YOUTUBE_API_KEY not set');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
    },
    body: JSON.stringify(body),
  };
};
