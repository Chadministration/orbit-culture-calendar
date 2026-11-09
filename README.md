# Orbit — cultural moments for briefs

**Orbit** helps Spotify Creative Labs answer briefs faster. Paste in an RFP; Orbit confirms what it understood (client, product, audience, markets, campaign window), then finds the cultural moments worth showing up for — each with a reason it fits and a concrete Spotify activation idea. The shortlist exports to a PowerPoint deck (opens in Google Slides) or a CSV for the media plan.

- **Live (prototype):** https://illustrious-peony-4214cf.netlify.app
- **Status:** working prototype, built and run by one person on personal accounts. Looking for a home on Spotify infrastructure — see [Moving to Spotify](#moving-to-spotify).

---

## How it works

```
Brief ──► 1. Read brief (AI)  ──► editable summary card  ──► user confirms
                                                               │
          2. Gather candidates ◄───────────────────────────────┘
             • curated calendar (465 events, 2026–27) + yearly moments rolled into 2027
             • holidays + faith/cultural dates for chosen markets
             • live trends, releases, events, news, album anniversaries
                                   │
          3. Rank (AI) ──► reason + activation idea + fit + tonal risk per moment
                                   │
          4. Filter in the browser
             • brand safety (no alcohol / health-awareness / grief / politics where wrong for the brand)
             • campaign window ±3 weeks (outside-window moments flagged)
             • market fit (global moments only if big AND a direct fit)
             • region fit (a state-specific brief drops other states' local events)
             • de-duplication
                                   │
          5. Show: Orbit · Timeline · List  ──► shortlist ──► deck / CSV
             • "Not relevant" hides a moment for that client (and future searches for them)
             • "Find more" asks the AI for the next-best moments, skipping shown and hidden ones
```

Everything user-facing is one file, `index.html` (vanilla HTML/CSS/JS, no build step). Server-side work lives in Netlify Functions, which proxy third-party APIs so keys never reach the browser.

## Repo layout

| Path | What it is |
|---|---|
| `index.html` | The whole front end: UI, curated events (`EVENTS_RAW`), brief extraction, ranking prompt, filters, views, shortlist, export |
| `netlify/functions/openai.js` | OpenAI proxy. Only accepts requests from the site's own origin; model, temperature and output size are fixed server-side |
| `netlify/functions/calendar.js` | Public holidays + observances per market and faith/cultural calendars (Google public calendars, Nager.Date fallback), Jewish (Hebcal) and Islamic (Aladhan) dates. CDN-cached 24h |
| `netlify/functions/trending.js` | Live trends: Google Trends, YouTube, Wikipedia spikes per country, Bluesky, Reddit, plus "trending all week". CDN-cached 1h |
| `netlify/functions/trend-snapshot.js` | **Scheduled hourly.** Records Google + YouTube trends for all 12 markets into Netlify Blobs (rolling 7 days) |
| `netlify/functions/tmdb.js`, `ticketmaster.js`, `guardian.js`, `bandsintown.js` | Thin API proxies |
| `netlify/lib/trend-sources.js` | Shared fetchers used by `trending` and `trend-snapshot` |
| `data/album-anniversaries.json` | ~930 most-listened albums with release dates → 10/20/25/30/40/50-year anniversaries |
| `scripts/build-album-anniversaries.py` | Rebuilds that file (ListenBrainz popularity + MusicBrainz dates). Run occasionally |
| `netlify.toml` | Function routes (`/api/*`), hourly schedule, secrets-scan settings |
| `package.json` | Only dependency: `@netlify/blobs` (for trend history) |

## Data sources

| Source | Used for | Key needed | Notes |
|---|---|---|---|
| Curated calendar (`EVENTS_RAW`) | 465 hand-picked moments, 2026–27; Australian moments tagged gold | — | Past events are hidden automatically. Uncertain dates are marked "TBC". Yearly moments entered only for 2026 are copied into 2027 as "date TBC" (`projectNextYear`); ended festivals are listed in `DEFUNCT` |
| OpenAI (`gpt-4o`) | Reading the brief; ranking, reasons, activation ideas | `OPENAI_API_KEY` | Two calls per search |
| Google public calendars | Holidays + observances for 12 markets; Hindu, Christian, Orthodox, Chinese lunar, Korean, Buddhist/Sikh/Jain dates | — | Nager.Date as fallback |
| Hebcal / Aladhan | Jewish / Islamic dates | — | Islamic dates can shift ±1 day |
| Google Trends (RSS) | Daily search trends per market | — | ~10 items per market |
| YouTube Data API | Most-popular videos per market | `YOUTUBE_API_KEY` | ~300 of 10,000 free daily units |
| Wikimedia | Pages spiking per country vs. their 7-day baseline | — | Data lands ~2 days late |
| Bluesky | Global trending topics | — | US-leaning |
| Reddit (RSS) | Hot posts in brief-relevant subreddits | — | **Unreliable** — Reddit often blocks Netlify's servers |
| TMDB | Upcoming film releases | `TMDB_API_KEY` | |
| Ticketmaster | Events per market | `TICKETMASTER_API_KEY` | |
| The Guardian | News context | `GUARDIAN_API_KEY` | |
| Bandsintown | Gigs for AI-suggested artists | `BANDSINTOWN_APP_ID` | **Not working** — needs a registered app ID |
| ListenBrainz + MusicBrainz | Album anniversaries (pre-built file) | — | Popularity skews rock/indie |

## Configuration

Set in Netlify → Project configuration → Environment variables:

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | yes | Brief reading + ranking |
| `TMDB_API_KEY`, `TICKETMASTER_API_KEY`, `GUARDIAN_API_KEY` | recommended | Live releases, events, news |
| `YOUTUBE_API_KEY` | recommended | YouTube trends (restrict the key to YouTube Data API v3) |
| `BANDSINTOWN_APP_ID` | optional | Gigs (currently non-functional) |
| `ALLOWED_ORIGINS` | optional | Extra comma-separated origins allowed to call `/api/openai` (e.g. a custom domain) |

Netlify secret scanning is on; `BANDSINTOWN_APP_ID` is excluded because its value also appears in page code (it's a public identifier, not a secret).

## Running it

- **Deployed:** push to `main` → Netlify builds and publishes (no build command; site root is `.`).
- **Locally (UI only):** `python3 -m http.server` in the repo and open `http://localhost:8000`. The page loads, but `/api/*` functions and AI search won't work without `netlify dev` (needs Node + the Netlify CLI and the env vars above).

## Costs & limits (prototype)

- **OpenAI:** two `gpt-4o` calls per search; the ranking call sends the candidate list (~150 KB) and returns up to 7,000 tokens.
- **Netlify:** free plan. Each production deploy uses credits — batch changes into one deploy. The hourly trend snapshot and searches draw small amounts of operational credit.
- **Known limits:** non-holiday dates (festivals, awards, film releases) can't be auto-verified — trust the "✓ Confirmed date" / "TBC" labels; trend sources are thin (Google ~10/market); Reddit and Bandsintown unreliable; the OpenAI origin check stops casual misuse but isn't authentication (a scripted request can fake the origin).

## Security notes

- No API keys in the repo or page; all third-party calls with keys go through functions.
- The site is **public** and has **no sign-in**. Fine for a prototype; a team tool should sit behind SSO.
- Runs on personal accounts (GitHub, Netlify, OpenAI, Google Cloud).

## Moving to Spotify

What we'd need:

1. **Hosting behind SSO** on Spotify infrastructure (the app is static HTML + a handful of small serverless functions — easy to port).
2. **An approved AI option** in place of a personal OpenAI key.
3. **Read access to internal data** (all found in Backstage's data catalog) that would make Orbit much stronger:

| Internal data | Would add |
|---|---|
| Daily Top & Viral charts by market (`DailyRegionalTopCharts`, `DailyRegionalViralChartsJob`) | Songs/artists rising in each market — the strongest trend signal possible |
| Upcoming releases (`album-prerelease-pipelines.ActivePrereleases`, `spotify-new-release.album`) | Big releases in the campaign window, ranked by artist popularity in that market |
| Concert catalog (`Moog.ConcertCatalogAll`) | Tour dates by city — replaces Bandsintown |
| Podcast charts (`podcasters-pipelines.charts_v3`) | Rising podcasts/episodes by market and category |
| Regional popularity (`sp-content-popularity`) | Which artists over-index in each market |
| Editorial cultural-moment campaigns (Home "watch-feed") | Moments Spotify's own editors are backing |

4. **An owner** for security review, data access approvals and ongoing maintenance.
