# Madanapalle Live Tracker

Static Vite dashboard for Madanapalle movie ticket tracking across:

- `ASR`
- `Ravi`
- `Siddartha`
- `Sri Krishna`

The site reads generated JSON snapshots from `public/data/latest.json` and can be deployed on GitHub Pages.

## Local Commands

Install dependencies:

```bash
npm install
```

Refresh the live snapshot:

```bash
npm run collect
```

Build the app:

```bash
npm run build
```

Refresh data and rebuild for Pages:

```bash
npm run build:pages
```

Preview locally:

```bash
npm run preview
```

## GitHub Pages

The GitHub Actions workflow at `.github/workflows/deploy-pages.yml` deploys the app on pushes to `main` or `MPLTracking`.

Important:

- The workflow builds from the committed JSON snapshot.
- Run `npm run build:pages` locally before pushing when you want fresh live numbers in production.
- The default branch is now `MPLTracking`, and scheduled GitHub Actions refresh the published snapshot automatically.

## Live Refresh Proxy

GitHub Pages alone cannot call the live showtime endpoints directly because the browser is blocked by CORS.

For true per-refresh live data, this repo now includes a small Cloudflare Worker in `worker/wrangler.toml` and `worker/src/index.js`.

What it does:

- fetches the latest published snapshot from `https://sathvikm9.github.io/MPLTracking/data/latest.json`
- refreshes the show seat counts server-side from the `bms-india` endpoints
- returns current data through `GET /api/live`

Deploy steps:

```bash
cd worker
npx wrangler deploy
```

After deploy, copy the Worker URL and set it in `public/runtime-config.json`:

```json
{
  "liveApiBase": "https://your-worker-name.workers.dev"
}
```

Then redeploy the GitHub Pages frontend. Once that URL is configured, normal page refreshes will hit the live proxy and pull current numbers instead of only the last published JSON snapshot.

If Cloudflare auth is not set up yet, there is also a Vercel-compatible proxy in `proxy-vercel/api/live.js`. Deploy that folder and point `public/runtime-config.json` at the deployed URL in the same way.

### BMS upstream recovery

BookMyShow can block server-side/headless theatre scraping with Cloudflare. The Vercel proxy supports configurable showtime upstreams so a working source can be swapped in without code changes:

```bash
BMS_SHOWTIME_API_BASE_URLS="https://your-working-source.example/api/showtimes"
BMS_SHOWTIME_API_EXTRA_BASE_URLS="https://fallback-one.example/api/showtimes,https://fallback-two.example/api/showtimes"
BMS_SHOWTIME_API_COOKIE="cookie=value; another=value"
BMS_SHOWTIME_API_USER_AGENT="Mozilla/5.0 ..."
BMS_SHOWTIME_API_ORIGIN="https://example.com"
BMS_SHOWTIME_API_REFERER="https://example.com/"
BMS_SHOWTIME_API_HEADERS_JSON='{"x-custom-header":"value"}'
```

Check source status with:

```bash
curl "https://proxy-vercel-green.vercel.app/api/source-health?date=2026-05-26&eventCode=ET00455003&venueCode=RTDM"
```

If BMS showtime sources are blocked, boxoffice falls back to the BFilmy Madanapalle city/movie aggregate feed. That keeps live totals available, but theatre-level BMS rows need a healthy show-level upstream.
