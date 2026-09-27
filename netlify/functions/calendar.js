// Authoritative calendar dates from free, keyless sources:
// - Google's public holiday calendars: every market's public holidays AND observances
//   (Mother's Day, Halloween, Harmony Day…), falling back to Nager.Date if Google fails
// - Google's religious/cultural calendars: Hindu, Christian, Orthodox, Chinese lunar,
//   Korean, Buddhist & Sikh festivals
// - Hebcal (Jewish) and Aladhan (Islamic), which give exact dates
// Returns Orbit-shaped events for today → +15 months. Cached at Netlify's CDN for a day.
const WINDOW_MONTHS = 15;
const VALID = ['US', 'UK', 'AU', 'BR', 'DE', 'FR', 'IN', 'MX', 'JP', 'SE', 'AR', 'ZA'];
const COUNTRY_CAL = {
  US: 'en.usa', UK: 'en.uk', AU: 'en.australian', BR: 'en.brazilian', DE: 'en.german', FR: 'en.french',
  IN: 'en.indian', MX: 'en.mexican', JP: 'en.japanese', SE: 'en.swedish', AR: 'en.ar', ZA: 'en.sa',
};
const NAGER_CODES = { UK: 'GB' };

// Faith & cultural calendars shown for every search. `only` keeps just the festivals we want;
// `major` marks the ones big enough to be HIGH priority.
const CULTURE_CALS = [
  { cal: 'en.hinduism', faith: 'Hindu', mkts: ['GLOBAL', 'IN', 'UK', 'US', 'AU', 'ZA'],
    major: /Diwali|Holi|Navratri|Durga Puja|Ganesh Chaturthi|Raksha Bandhan|Onam|Pongal|Dussehra|Janmashtami/,
    rel: 'Bollywood, devotional & festive playlists' },
  { cal: 'en.christian', faith: 'Christian', mkts: ['GLOBAL'],
    only: /Christmas|Easter|Good Friday|Ash Wednesday|Mardi Gras|Palm Sunday|Pentecost|All Saints|All Souls|Advent|Epiphany|St\. Patrick|Guadalupe/,
    major: /Christmas Day$|Easter Sunday|Good Friday|St\. Patrick|Mardi Gras/,
    rel: 'Seasonal, gospel & celebration playlists' },
  { cal: 'en.orthodox_christianity', faith: 'Orthodox Christian', mkts: ['GLOBAL'],
    only: /Easter|Christmas/, rel: 'Seasonal & choral playlists' },
  { cal: 'en.china', faith: 'Chinese / Lunar', mkts: ['GLOBAL', 'AU', 'US', 'UK'],
    only: /Chinese New Year|Spring Festival Eve|Lantern|Qing Ming Jie$|Dragon Boat Festival$|Chinese Valentine|Mid-Autumn Festival$|Double Ninth|Spirit Festival/,
    major: /Chinese New Year|Mid-Autumn/, rel: 'C-pop, Mandopop & celebration playlists' },
  { cal: 'en.south_korea', faith: 'Korean', mkts: ['GLOBAL'],
    only: /^(Chuseok|Seollal)$/, major: /./, rel: 'K-pop & family-holiday playlists' },
  { cal: 'en.indian', faith: 'Buddhist / Sikh / Jain', mkts: ['GLOBAL', 'IN', 'UK', 'AU'],
    only: /Buddha Purnima|Vaisakhi|Guru Nanak|Mahavir/, major: /Vaisakhi|Buddha Purnima/,
    rel: 'Devotional, bhangra & reflective playlists' },
];

const ISLAMIC_DAYS = [
  // [day, hijriMonth, name, rel]
  ['01', '01', 'Islamic New Year', 'Reflective & new-beginnings playlists'],
  ['12', '03', 'Mawlid al-Nabi', 'Devotional & nasheed playlists'],
  ['01', '09', 'Ramadan begins', 'Reflective & suhoor/iftar playlists'],
  ['01', '10', 'Eid al-Fitr', 'Celebration & family playlists'],
  ['10', '12', 'Eid al-Adha', 'Celebration & family playlists'],
];
const JEWISH_HOLIDAYS = ['Rosh Hashana', 'Yom Kippur', 'Sukkot', 'Chanukah', 'Purim', 'Pesach', 'Shavuot'];

const UA = { 'User-Agent': 'OrbitCultureCalendar/1.0' };
const getJSON = async (url) => {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
};
const slug = s => s.replace(/\W+/g, '_');

// ── Google public calendars (iCal) ───────────────────────────────────────────
async function googleCalendar(cal) {
  const r = await fetch(`https://calendar.google.com/calendar/ical/${cal}%23holiday%40group.v.calendar.google.com/public/basic.ics`, { headers: UA });
  if (!r.ok) throw new Error(`Google calendar ${cal} → ${r.status}`);
  const text = (await r.text()).replace(/\r?\n[ \t]/g, '');  // unfold wrapped lines
  const unescape = s => (s || '').replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1').trim();
  return (text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || []).map(ev => {
    const d = (ev.match(/DTSTART;VALUE=DATE:(\d{8})/) || [])[1];
    const desc = unescape((ev.match(/\nDESCRIPTION:(.*)/) || [])[1]).split('\n')[0];
    return d && {
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      name: unescape((ev.match(/\nSUMMARY:(.*)/) || [])[1]),
      kind: desc,  // "Public holiday", "Public holiday in Queensland", "Observance"
    };
  }).filter(Boolean);
}

// Skip follow-on days ("Spring Festival Holiday", "Day off for …") and clock changes
const isNoise = n => (/ [Hh]oliday$/.test(n) && !/Bank Holiday$/.test(n)) || /Golden Week|^Day off|substitute|Daylight Saving|\(half-day\)/.test(n);

async function countryDates(market, start, end, observances) {
  try {
    const list = await googleCalendar(COUNTRY_CAL[market]);
    return list
      .filter(h => h.date >= start && h.date <= end && !isNoise(h.name))
      .filter(h => observances || h.kind === 'Public holiday')
      .map(h => {
        const pub = h.kind.startsWith('Public holiday');
        const region = h.kind.replace(/^Public holiday in /, '');
        const regional = pub && h.kind !== 'Public holiday';
        return {
          id: `hol_${market}_${h.date}_${slug(h.name)}`,
          name: h.name,
          date: h.date,
          cat: market === 'AU' ? 'Australia' : pub ? 'Public Holidays' : 'Cultural & Religious',
          region: regional ? `${market}: ${region}` : market,
          mkts: [market],
          rel: !pub ? 'Cultural moment & themed playlists' : regional ? 'Regional long-weekend playlists' : 'National long-weekend & holiday playlists',
          pri: pub && !regional ? 'MEDIUM' : 'LOW',
          tags: [pub ? 'public holiday' : 'observance', 'long weekend', h.name.toLowerCase()],
          isLive: true,
          source: 'Google Calendar',
        };
      });
  } catch (e) {
    return nagerDates(market, start, end);  // fallback: public holidays only
  }
}

async function nagerDates(market, start, end) {
  const years = [...new Set([start.slice(0, 4), end.slice(0, 4)])];
  const lists = await Promise.all(years.map(y => getJSON(`https://date.nager.at/api/v3/PublicHolidays/${y}/${NAGER_CODES[market] || market}`)));
  return lists.flat().filter(h => h.date >= start && h.date <= end).map(h => {
    const states = (h.counties || []).map(c => c.split('-')[1]).join(', ');
    return {
      id: `hol_${market}_${h.date}_${slug(h.name)}`,
      name: states ? `${h.name} (${states})` : h.name,
      date: h.date,
      cat: market === 'AU' ? 'Australia' : 'Public Holidays',
      region: states ? `${market}: ${states}` : market,
      mkts: [market],
      rel: h.global ? 'National long-weekend & holiday playlists' : 'Regional holiday playlists',
      pri: h.global ? 'MEDIUM' : 'LOW',
      tags: ['public holiday', 'long weekend', h.localName.toLowerCase()],
      isLive: true,
      source: 'Nager.Date',
    };
  });
}

async function cultureDates(c, start, end) {
  const list = await googleCalendar(c.cal);
  return list
    .filter(h => h.date >= start && h.date <= end && !isNoise(h.name) && (!c.only || c.only.test(h.name)))
    .map(h => ({
      id: `cul_${slug(c.faith)}_${h.date}_${slug(h.name)}`,
      name: `${h.name} ${h.date.slice(0, 4)}`,
      date: h.date,
      cat: 'Cultural & Religious',
      region: 'Global',
      mkts: c.mkts,
      rel: c.rel,
      pri: c.major && c.major.test(h.name) ? 'HIGH' : 'LOW',
      tags: [c.faith.toLowerCase(), 'faith', 'culture', 'festival', h.name.toLowerCase()],
      isLive: true,
      source: 'Google Calendar',
    }));
}

// ── Hebcal (Jewish) ──────────────────────────────────────────────────────────
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

// ── Aladhan (Islamic) ────────────────────────────────────────────────────────
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
      id: `isl_${slug(name)}_${date}`,
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

// Same holiday from several calendars (e.g. Christmas in every country) → one event, markets merged
function mergeDuplicates(events) {
  const norm = n => n.toLowerCase().replace(/\b20\d\d\b|\(.*?\)/g, '').replace(/[^a-z]+/g, ' ').trim();
  const byKey = new Map();
  for (const e of events) {
    const k = `${e.date}|${norm(e.name)}`;
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, { ...e }); continue; }
    prev.mkts = [...new Set([...prev.mkts, ...e.mkts])];
    if (e.pri === 'HIGH' || (e.pri === 'MEDIUM' && prev.pri === 'LOW')) prev.pri = e.pri;
  }
  return [...byKey.values()];
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    // Cache at Netlify's edge for a day — these dates don't change
    'Netlify-CDN-Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
  };
  const markets = (event.queryStringParameters?.markets || '')
    .split(',').map(m => m.trim().toUpperCase()).filter(m => VALID.includes(m));

  const now = new Date();
  const start = now.toISOString().slice(0, 10);
  const endD = new Date(now); endD.setMonth(endD.getMonth() + WINDOW_MONTHS);
  const end = endD.toISOString().slice(0, 10);

  // With markets chosen: their holidays + observances. With none: national holidays everywhere.
  const jobs = {
    country: Promise.allSettled((markets.length ? markets : VALID).map(m => countryDates(m, start, end, markets.length > 0)))
      .then(rs => rs.flatMap(r => (r.status === 'fulfilled' ? r.value : [])))
      .then(list => (markets.length ? list : list.filter(h => h.pri === 'MEDIUM'))),
    culture: Promise.allSettled(CULTURE_CALS.map(c => cultureDates(c, start, end)))
      .then(rs => rs.flatMap(r => (r.status === 'fulfilled' ? r.value : []))),
    jewish: jewishHolidays(start, end),
    islamic: islamicHolidays(start, end),
  };
  const names = Object.keys(jobs);
  const settled = await Promise.allSettled(Object.values(jobs));
  const errors = settled.map((s, i) => s.status === 'rejected' && `${names[i]}: ${s.reason.message}`).filter(Boolean);
  const events = mergeDuplicates(settled.flatMap(s => (s.status === 'fulfilled' ? s.value : [])));

  return { statusCode: 200, headers, body: JSON.stringify({ events, errors }) };
};
