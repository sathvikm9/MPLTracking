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
