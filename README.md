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
