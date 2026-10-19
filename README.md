# Portfolio History

A Progressive Web App that reconstructs the value and profit of an investment portfolio over time from a broker export. Everything runs in the browser; portfolio data never leaves the device.

Work is tracked in the [milestone issues](https://github.com/Gnipral/portfolio-history/issues?q=label%3Amilestone).

Live app: https://gnipral.github.io/portfolio-history/

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev       # local dev server
npm test          # unit tests (Vitest)
npm run build     # type-check + production build to dist/
npm run preview   # serve the production build, including the service worker
```

PWA icons are generated at build time from `public/icon.svg`.

## Deployment

Every push to `main` is tested, built and deployed to GitHub Pages by `.github/workflows/deploy.yml`. Pull requests run tests and the build via `.github/workflows/ci.yml`.

## Importing data

Supported exports:

| Broker | File | Status |
|---|---|---|
| DEGIRO | Transactions (Transacties), CSV or XLSX | Dutch verified with a real export; English headers still to be confirmed |

Brokers are detected from the header row. Each broker is an adapter in `src/import/adapters/` that maps its rows to the normalized `Transaction` model (`src/model/transaction.ts`). Adding a broker means adding an adapter and registering it in `src/import/registry.ts`.

To check a real export without committing it:

```bash
DEGIRO_SAMPLE=/path/to/Transactions.xlsx npx vitest run privateSample --silent=false
```

Never commit personal broker exports: this repository is public.

## Static market data

`public/data/` holds FX rates and benchmark closes that the app reads before calling any live API:

| File | Content | Source |
|---|---|---|
| `fx-rates.json` | ECB reference rates, units per 1 EUR, 14 currencies, from 2010 | Frankfurter |
| `benchmark-iwda.json`, `benchmark-vwce.json`, `benchmark-sxr8.json` | Daily closes of the benchmark ETFs | Yahoo Finance |
| `meta.json` | Last check, sources, row counts, errors | |

The files are append-only: dates already stored are never rewritten. Update them locally with `npm run data:snapshot`.

The **Daily data snapshot** workflow (`.github/workflows/data-snapshot.yml`) runs every day at 21:30 UTC and can be started by hand from the Actions tab. It:

1. fetches the new data server side (Yahoo does not allow browser requests),
2. commits the changes to `main`, with the commit author rotated daily through `.github/authors.json`; on days without new market data only `meta.json` changes,
3. builds and deploys the site, because pushes made with `GITHUB_TOKEN` do not start other workflows.

GitHub disables scheduled workflows in public repositories after 60 days without repository activity. The daily commits keep the schedule active; if it is ever disabled, re-enable it in the Actions tab.

## Price proxy

Yahoo Finance and OpenFIGI block browser requests (no CORS). `workers/price-proxy/` is a small Cloudflare Worker that forwards only daily chart and ISIN-mapping requests from the app's own origin. See [its README](workers/price-proxy/README.md) for deployment. Without the proxy, the app can still use price APIs with your own key (Twelve Data, Alpha Vantage) and key-less CoinGecko for crypto.
