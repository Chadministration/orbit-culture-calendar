// Runs hourly (see netlify.toml). Records which Google/YouTube trends are live in every
// market, and keeps a rolling 7-day tally in Netlify Blobs so /api/trending can report
// what has been trending *all week*, not just this hour.
const { getStore, connectLambda } = require('@netlify/blobs');
const { MARKETS, googleTrends, youtube, settledValues } = require('../lib/trend-sources');

const KEEP_DAYS = 7;
const norm = t => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

exports.handler = async (event) => {
  connectLambda(event);
  const store = getStore('trends');
  const hour = new Date().toISOString().slice(0, 13);  // e.g. 2026-09-27T10

  const [google, yt] = await Promise.all([
    settledValues(MARKETS.map(googleTrends)),
    settledValues(MARKETS.map(youtube)),
  ]);
  const seen = [
    ...google.map(g => ({ source: 'Google Trends', market: g.market, title: g.title, score: g.traffic, detail: g.headline, url: g.url })),
    ...yt.map(v => ({ source: 'YouTube', market: v.market, title: v.title, score: v.views, detail: v.channel, url: v.url })),
  ];

  const weekly = (await store.get('weekly', { type: 'json' })) || { items: {} };
  for (const s of seen) {
    const key = `${s.source}|${s.market}|${norm(s.title)}`;
    const it = weekly.items[key] || { ...s, first: hour, hours: 0, peak: 0 };
    if (it.last !== hour) it.hours += 1;
    Object.assign(it, { last: hour, peak: Math.max(it.peak, s.score), detail: s.detail || it.detail, url: s.url || it.url });
    weekly.items[key] = it;
  }
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 13);
  for (const [k, it] of Object.entries(weekly.items)) if (it.last < cutoff) delete weekly.items[k];
  weekly.updated = hour;
  await store.setJSON('weekly', weekly);

  return { statusCode: 200, body: JSON.stringify({ hour, recorded: seen.length, tracked: Object.keys(weekly.items).length }) };
};
