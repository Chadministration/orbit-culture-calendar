// Shared fetchers for live internet trends (used by /api/trending and the hourly snapshot)
const GEO = { UK: 'GB' };
const MARKETS = ['US', 'UK', 'AU', 'BR', 'DE', 'FR', 'IN', 'MX', 'JP', 'SE', 'AR', 'ZA'];
const UA = { 'User-Agent': 'OrbitCultureCalendar/1.0 (+https://illustrious-peony-4214cf.netlify.app)' };

const decode = s => (s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const tag = (xml, name) => decode((xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1]);
const blocks = (xml, name) => xml.match(new RegExp(`<${name}[\\s>][\\s\\S]*?</${name}>`, 'g')) || [];

// Google Trends daily search trends (public RSS, ~10–20 items per market)
async function googleTrends(market) {
  const r = await fetch(`https://trends.google.com/trending/rss?geo=${GEO[market] || market}`, { headers: UA });
  if (!r.ok) throw new Error(`Google Trends ${market} → ${r.status}`);
  const xml = await r.text();
  return blocks(xml, 'item').slice(0, 20).map(item => ({
    title: tag(item, 'title'),
    traffic: parseInt(tag(item, 'ht:approx_traffic').replace(/\D/g, ''), 10) || 0,
    headline: tag(item, 'ht:news_item_title'),
    url: tag(item, 'ht:news_item_url'),
    market,
  }));
}

// YouTube most-popular videos per country (needs YOUTUBE_API_KEY; 1 quota unit per call)
async function youtube(market) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&maxResults=20&regionCode=${GEO[market] || market}&key=${key}`);
  if (!r.ok) throw new Error(`YouTube ${market} → ${r.status}`);
  const d = await r.json();
  return (d.items || []).map(v => ({
    title: decode(v.snippet.title),
    channel: v.snippet.channelTitle,
    views: parseInt(v.statistics?.viewCount || '0', 10),
    url: `https://www.youtube.com/watch?v=${v.id}`,
    market,
  }));
}

// Bluesky trending topics (global, keyless)
async function bluesky() {
  const r = await fetch('https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrendingTopics?limit=15', { headers: UA });
  if (!r.ok) throw new Error(`Bluesky → ${r.status}`);
  const d = await r.json();
  return (d.topics || []).map(t => ({
    title: t.displayName || t.topic,
    headline: t.description || '',
    url: t.link ? `https://bsky.app${t.link}` : '',
  }));
}

// Reddit hot posts via RSS (the JSON API blocks unauthenticated servers; RSS is rate-limited)
async function reddit(subs) {
  const r = await fetch(`https://www.reddit.com/r/${subs.join('+')}/hot.rss?limit=25`, { headers: UA });
  if (!r.ok) throw new Error(`Reddit → ${r.status}`);
  const xml = await r.text();
  return blocks(xml, 'entry').map(e => ({
    title: tag(e, 'title'),
    sub: (e.match(/<category[^>]*term="([^"]+)"/) || [])[1] || '',
    url: (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '',
    updated: tag(e, 'updated').slice(0, 10),
  })).filter(p => p.title.length > 10);
}

// Wikipedia pages spiking in a country: views on the latest published day vs the 7 days before.
// Wikimedia publishes per-country data ~2 days late, so we step back until a day exists.
const WIKI_SKIP = /^(Main_Page|Special:|Wikipedia:|Portal:|File:|Help:|Talk:|Category:|Template:|User:)|^Deaths_in|^List_of|^\d{4}$|porn|xxx|xhamster|onlyfans|^Sex|Cleavage|^-$/i;

async function wikiDay(market, date) {
  const [y, m, d] = date.toISOString().slice(0, 10).split('-');
  const r = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top-per-country/${GEO[market] || market}/all-access/${y}/${m}/${d}`, { headers: UA });
  if (!r.ok) return null;
  return (await r.json()).items?.[0]?.articles || null;
}

async function wikipediaRising(market) {
  let latest, day;
  for (let back = 1; back <= 4 && !latest; back++) {
    day = new Date(Date.now() - back * 864e5);
    latest = await wikiDay(market, day);
  }
  if (!latest) throw new Error(`Wikipedia ${market} → no recent data`);
  const prior = (await Promise.all([1, 2, 3, 4, 5, 6, 7].map(k => wikiDay(market, new Date(day - k * 864e5))))).filter(Boolean);
  const history = prior.map(list => ({ views: new Map(list.map(a => [`${a.project}|${a.article}`, a.views_ceil])), floor: list[list.length - 1]?.views_ceil || 0 }));
  return latest
    .filter(a => a.rank <= 300 && !WIKI_SKIP.test(a.article))
    .map(a => {
      const key = `${a.project}|${a.article}`;
      // Not in a day's top list → it had at most that day's lowest count
      const base = history.length ? history.reduce((sum, h) => sum + (h.views.get(key) ?? h.floor), 0) / history.length : a.views_ceil;
      return { a, ratio: a.views_ceil / Math.max(base, 1) };
    })
    .filter(x => x.ratio >= 2.5)
    .sort((x, y) => y.ratio * Math.log(y.a.views_ceil) - x.ratio * Math.log(x.a.views_ceil))
    .slice(0, 15)
    .map(({ a, ratio }) => ({
      title: a.article.replace(/_/g, ' '),
      views: a.views_ceil,
      ratio: Math.round(ratio * 10) / 10,
      date: day.toISOString().slice(0, 10),
      url: `https://${a.project}.org/wiki/${a.article}`,
      market,
    }));
}

const settledValues = async (promises) =>
  (await Promise.allSettled(promises)).flatMap(r => (r.status === 'fulfilled' ? r.value : []));

module.exports = { MARKETS, googleTrends, youtube, bluesky, reddit, wikipediaRising, settledValues };
