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
