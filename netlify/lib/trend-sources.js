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

const settledValues = async (promises) =>
  (await Promise.allSettled(promises)).flatMap(r => (r.status === 'fulfilled' ? r.value : []));

module.exports = { MARKETS, googleTrends, youtube, bluesky, reddit, settledValues };
