// Authoritative calendar dates from free, keyless APIs:
// - Nager.Date: public holidays per market (incl. Australian state holidays)
// - Hebcal: major Jewish holidays
// - Aladhan: Islamic holidays (Hijri → Gregorian conversion)
// Returns Orbit-shaped events for today → +15 months. Cached at Netlify's CDN for a day.
const WINDOW_MONTHS = 15;
const NAGER_CODES = { UK: 'GB' }; // Orbit market code → ISO code where they differ
const ISLAMIC_DAYS = [
  // [day, hijriMonth, name, rel]
  ['01', '01', 'Islamic New Year', 'Reflective & new-beginnings playlists'],
  ['12', '03', 'Mawlid al-Nabi', 'Devotional & nasheed playlists'],
  ['01', '09', 'Ramadan begins', 'Reflective & suhoor/iftar playlists'],
  ['01', '10', 'Eid al-Fitr', 'Celebration & family playlists'],
  ['10', '12', 'Eid al-Adha', 'Celebration & family playlists'],
];
const JEWISH_HOLIDAYS = ['Rosh Hashana', 'Yom Kippur', 'Sukkot', 'Chanukah', 'Purim', 'Pesach', 'Shavuot'];

const getJSON = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': 'OrbitCultureCalendar/1.0' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
};

async function publicHolidays(markets, start, end) {
  const years = [...new Set([start.slice(0, 4), end.slice(0, 4)])];
  const jobs = markets.flatMap(m => years.map(async y => {
    const list = await getJSON(`https://date.nager.at/api/v3/PublicHolidays/${y}/${NAGER_CODES[m] || m}`);
    return list.map(h => ({ ...h, market: m }));
  }));
  const settled = await Promise.allSettled(jobs);
  const out = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const h of s.value) {
      if (h.date < start || h.date > end) continue;
      const states = (h.counties || []).map(c => c.split('-')[1]).join(', ');
      out.push({
        id: `hol_${h.market}_${h.date}_${h.name.replace(/\W+/g, '_')}`,
        name: states ? `${h.name} (${states})` : h.name,
        date: h.date,
        cat: h.market === 'AU' ? 'Australia' : 'Public Holidays',
        region: states ? `${h.market}: ${states}` : h.market,
        mkts: [h.market],
        rel: h.global ? 'National long-weekend & holiday playlists' : 'Regional holiday playlists',
        pri: h.global ? 'MEDIUM' : 'LOW',
        tags: ['public holiday', 'long weekend', h.localName.toLowerCase()],
        isLive: true,
        source: 'Nager.Date',
      });
    }
  }
  return out;
}

async function jewishHolidays(start, end) {
  const d = await getJSON(`https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=off&mod=off&nx=off&ss=off&mf=off&c=off&s=off&start=${start}&end=${end}`);
  // Collapse multi-day festivals (e.g. "Pesach I" … "Pesach VIII") into one event with start/end
  // (a new group starts when the same festival reappears more than 10 days later)
  const groups = [];
  const items = (d.items || []).filter(i => !/^Erev /.test(i.title)).sort((x, y) => x.date.localeCompare(y.date));
  for (const i of items) {
    const base = JEWISH_HOLIDAYS.find(h => i.title.startsWith(h));
    if (!base) continue;
    const g = groups.find(g => g.base === base && (new Date(i.date) - new Date(g.dates[g.dates.length - 1])) / 864e5 <= 10);
    if (g) g.dates.push(i.date); else groups.push({ base, dates: [i.date] });
  }
  return groups.map(({ base, dates }) => {
    const name = base === 'Chanukah' ? 'Hanukkah' : base === 'Pesach' ? 'Passover (Pesach)' : base;
    return {
      id: `heb_${base}_${dates[0]}`,
      name: `${name} ${dates[0].slice(0, 4)}`,
      date: dates[0],
      ...(dates.length > 1 ? { end: dates[dates.length - 1] } : {}),
      cat: 'Cultural & Religious',
      region: 'Global',
      mkts: ['GLOBAL'],
      rel: 'Festive & family playlists',
      pri: ['Hanukkah', 'Passover (Pesach)', 'Rosh Hashana', 'Yom Kippur'].includes(name) ? 'MEDIUM' : 'LOW',
      tags: ['jewish', 'faith', 'holiday', 'family', name.toLowerCase()],
      isLive: true,
      source: 'Hebcal',
    };
  });
}

async function islamicHolidays(start, end) {
  // Current Hijri year from today's date, then this year and next
  const today = await getJSON(`https://api.aladhan.com/v1/gToH/${start.split('-').reverse().join('-')}`);
  const hy = parseInt(today.data.hijri.year, 10);
  const jobs = [hy, hy + 1].flatMap(y => ISLAMIC_DAYS.map(async ([dd, mm, name, rel]) => {
    const r = await getJSON(`https://api.aladhan.com/v1/hToG/${dd}-${mm}-${y}`);
    const date = r.data.gregorian.date.split('-').reverse().join('-'); // DD-MM-YYYY → YYYY-MM-DD
    return { name, rel, date };
  }));
  const settled = await Promise.allSettled(jobs);
  return settled
    .filter(s => s.status === 'fulfilled' && s.value.date >= start && s.value.date <= end)
    .map(({ value: { name, rel, date } }) => ({
      id: `isl_${name.replace(/\W+/g, '_')}_${date}`,
      name: `${name} ${date.slice(0, 4)}`,
      date,
      cat: 'Cultural & Religious',
      region: 'Global',
      mkts: ['GLOBAL', 'IN', 'UK', 'FR', 'ZA'],
      rel,
      pri: /Ramadan|Eid/.test(name) ? 'HIGH' : 'LOW',
      tags: ['islam', 'muslim', 'faith', 'family', name.toLowerCase()],
      isLive: true,
      source: 'Aladhan',
      note: 'Dates can shift by a day depending on moon sighting',
    }));
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    // Cache at Netlify's edge for a day — these dates don't change
    'Netlify-CDN-Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
  };
  const valid = ['US', 'UK', 'AU', 'BR', 'DE', 'FR', 'IN', 'MX', 'JP', 'SE', 'AR', 'ZA'];
  const markets = (event.queryStringParameters?.markets || '')
    .split(',').map(m => m.trim().toUpperCase()).filter(m => valid.includes(m));

  const now = new Date();
  const start = now.toISOString().slice(0, 10);
  const endD = new Date(now); endD.setMonth(endD.getMonth() + WINDOW_MONTHS);
  const end = endD.toISOString().slice(0, 10);

  const [hol, heb, isl] = await Promise.allSettled([
    // With no market chosen, only include national holidays for all markets
    publicHolidays(markets.length ? markets : valid, start, end)
      .then(list => markets.length ? list : list.filter(h => h.pri === 'MEDIUM')),
    jewishHolidays(start, end),
    islamicHolidays(start, end),
  ]);
  const pick = s => (s.status === 'fulfilled' ? s.value : []);
  const events = [...pick(hol), ...pick(heb), ...pick(isl)];
  const errors = [hol, heb, isl].filter(s => s.status === 'rejected').map(s => s.reason.message);

  return { statusCode: 200, headers, body: JSON.stringify({ events, errors }) };
};
