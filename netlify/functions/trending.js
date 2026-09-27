// What the internet is talking about right now, from free keyless sources:
// - Google Trends daily search trends (RSS) per market
// - Bluesky trending topics (global)
// - Reddit hot posts (RSS) for brief-relevant subreddits — Reddit's JSON API blocks unauthenticated servers
// Cached at Netlify's edge for an hour.
const GEO = { UK: 'GB' };
const VALID = ['US', 'UK', 'AU', 'BR', 'DE', 'FR', 'IN', 'MX', 'JP', 'SE', 'AR', 'ZA'];
const UA = { 'User-Agent': 'OrbitCultureCalendar/1.0 (+https://illustrious-peony-4214cf.netlify.app)' };

const decode = s => (s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const tag = (xml, name) => decode((xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1]);
const blocks = (xml, name) => xml.match(new RegExp(`<${name}[\\s>][\\s\\S]*?</${name}>`, 'g')) || [];

async function googleTrends(market) {
  const r = await fetch(`https://trends.google.com/trending/rss?geo=${GEO[market] || market}`, { headers: UA });
  if (!r.ok) throw new Error(`Google Trends ${market} → ${r.status}`);
  const xml = await r.text();
  return blocks(xml, 'item').slice(0, 20).map(item => {
    const traffic = parseInt(tag(item, 'ht:approx_traffic').replace(/\D/g, ''), 10) || 0;
    return {
      title: tag(item, 'title'),
      traffic,
      headline: tag(item, 'ht:news_item_title'),
      url: tag(item, 'ht:news_item_url'),
      market,
    };
  });
}

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

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const markets = (q.markets || '').split(',').map(m => m.trim().toUpperCase()).filter(m => VALID.includes(m));
  const subs = (q.subs || '').split(',').map(s => s.trim()).filter(s => /^[A-Za-z0-9_]{2,21}$/.test(s)).slice(0, 8);

  const [g, b, rd] = await Promise.allSettled([
    Promise.allSettled((markets.length ? markets : ['AU', 'US', 'UK']).slice(0, 4).map(googleTrends))
      .then(rs => rs.flatMap(r => (r.status === 'fulfilled' ? r.value : []))),
    bluesky(),
    subs.length ? reddit(subs) : Promise.resolve([]),
  ]);
  const pick = s => (s.status === 'fulfilled' ? s.value : []);
  const errors = [g, b, rd].filter(s => s.status === 'rejected').map(s => s.reason.message);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
    },
    body: JSON.stringify({ google: pick(g), bluesky: pick(b), reddit: pick(rd), errors }),
  };
};
