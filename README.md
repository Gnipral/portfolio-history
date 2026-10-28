<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/gnipral-lockup-dark.svg">
    <img src="public/brand/gnipral-lockup-light.svg" alt="Gnipral" width="320">
  </picture>
</p>

# Portfolio History

A Progressive Web App that reconstructs the value and profit of an investment portfolio over time from a broker export. Everything runs in the browser; portfolio data never leaves the device.

Live app: https://gnipral.github.io/portfolio-history/

## What it does

1. **Import** a broker export (CSV, XLSX, XML or PDF). The file is read in the browser and stored in IndexedDB.
2. **Prices** are fetched once per day for every product you ever held, together with splits and EUR exchange rates, and cached in the browser.
3. The **dashboard** rebuilds the portfolio for every calendar day since the first transaction:
   - a chart of value, invested capital and profit, in euros or percent, with a crosshair, a slider and a date picker that stay in sync, and quick ranges (1M, 3M, YTD, 1Y, ALL);
   - cards for value, invested capital, profit/loss, simple return, time-weighted return (TWR) and money-weighted return (XIRR) on the selected day;
   - the positions and an allocation chart for that day, by position, type, currency or country of the ISIN; click a position for its own chart with its trades;
   - benchmarks (MSCI World, FTSE All-World, S&P 500 ETF, or your own mix of them) bought and sold with exactly the same money on the same days;
   - a **Share** button that makes a picture of the time-weighted return over the chosen period (post or story size), optionally against a benchmark, with the mix by type and with your positions (their weight and return), plus a text to paste with it. It never shows amounts or quantities, and product names only when you choose to show the positions;
   - toggles to include or exclude dividends, transaction costs, taxes, FX costs and deposits. Options the export has no data for are disabled, with the reason.
4. **Analysis**, per year:
   - **Taxes**: stock exchange tax (TOB) and withheld taxes paid, and an estimate of the tax on capital gains under the rules of a country: Belgium (from 2026), Germany, France, the Netherlands, or your own. Rate, yearly exemption and its carry-over, loss carry-forward, FIFO or average cost and a reference date for gains that are not taxed can all be adjusted;
   - **Dividends**: per month, year, kind and position, gross and net, with the yield on cost;
   - **Realized**: every sale with its cost basis and result;
   - **Costs**: transaction costs, FX costs and taxes, and how much profit and time-weighted return they cost;
   - **Risk**: largest fall and recovery, volatility, best and worst month, and the return of every month.
5. **Settings**: API keys, price proxy, cost basis (average or FIFO), benchmarks and mix, theme, and deleting all data.
6. **Demo mode**: "Try the demo" (on the empty dashboard, the Import page or in Settings) opens a made-up portfolio from March 2021 until today, with deposits, ETFs, a US stock, a dividend payer, crypto, a sale and a withdrawal. Its prices are generated in the browser, so it needs no connection or API key. It lives in its own database with its own settings: your own data is never touched. A banner on every page leads back.

### Privacy

There is no backend and no account. Transactions, prices and settings live in your browser's IndexedDB and never leave the device. The only outgoing requests are for market data: tickers, ISINs and date ranges, never quantities or amounts. **Settings → Delete all data** wipes everything, including the price cache and API keys.

### Offline

The app is a PWA: install it from the browser menu ("Install app" or "Add to Home Screen"). After the first visit, the app shell, the static market data and everything in IndexedDB work without a connection. While offline the header shows **Offline**, the dashboard is calculated from the stored prices, and new prices are fetched as soon as the connection is back. A new version is never activated by surprise: a banner asks to reload.

### How the numbers are calculated

| Measure | Definition |
|---|---|
| Invested capital | Net money put in: buys minus sells (or deposits minus withdrawals when deposits are included) |
| Profit / loss | Realized plus unrealized result, after the included dividends and charges |
| Simple return | Profit / loss divided by the highest invested capital so far |
| TWR | Daily returns chain-linked; money coming in counts at the start of the day, money going out at the end, so the timing of your deposits does not affect it |
| XIRR | The yearly rate at which all flows and the value on the selected day net to zero; it does depend on when you added money. During the first year it is shown over the period instead, because a yearly rate from a few weeks is meaningless |

Without deposits in the export, the portfolio is the securities alone and every buy, sell and dividend is a flow. With deposits included, cash is part of the portfolio and only deposits and withdrawals are flows. Cost basis (average or FIFO) decides how realized and unrealized results are split. Dividends count net of withholding tax and collection costs; a withholding tax booked as its own row is left out together with the dividends. Securities transferred in or out without a sale count at their market value of that day: received units are money put in, not profit, and the profit on units sent away stays in the result.

Providers deliver split-adjusted prices; the app undoes later splits, so a quantity from before a split is valued at the price of that time. Products without any price are valued at their last trade price and listed on the **Prices** page, where a ticker or a split can be entered by hand.

## Importing data

Supported exports:

| Broker | File | Notes |
|---|---|---|
| DEGIRO | Transactions and/or Account statement (Rekeningoverzicht), CSV, XLSX or PDF | The Account statement adds dividends, dividend tax, TOB, deposits and interest. PDFs in Dutch, English, German, French, Italian, Spanish and Portuguese; EUR accounts only. |
| Bolero | Transaction history (Excel), or contract notes (borderellen) and account statements (PDF) | The Excel has no ISIN, so symbols are entered on the Prices page; the PDFs have ISINs, costs, TOB and withholding tax |
| Keytrade Bank | Transactions (CSV or Excel), or contract notes and coupon notes (PDF, Dutch/French/German) | The CSV/Excel column names are not yet confirmed with a real export |
| Saxo | Transactions (Excel), or Trade, Corporate Action, Cash Transfer and Cash Amount reports (PDF, English/German) | Event text in the account's language (`Buy`/`Koop`) |
| Interactive Brokers, Lynx | Flex Queries: Trades, Cash Transactions, Corporate Actions (CSV or XML) | Columns are looked up by name; summary rows and cancelled trades are skipped |
| Trade Republic | Transaction export (CSV, `,` or `;`), or settlements, dividend notes and the account statement (PDF) | Card payments count as withdrawals; a reversed dividend cancels the original |
| Trading 212 | History → Export (CSV), or the activity statement (PDF) | All column variants since 2023 |
| Revolut | Trading account statement (CSV or PDF), or trade confirmations (PDF) | Identified by ticker; the PDF statement links tickers to ISINs |
| eToro | Account statement (Excel) | Account currency and ISINs from the other sheets |
| XTB | Account history, Cash Operations (CSV or Excel) | Both layouts; account currency from the file name (`EUR_…csv`); transfers between sub-accounts are skipped |
| Bitvavo, Coinbase, Binance, Kraken, Bitpanda | Transaction history / ledgers (CSV or Excel) | Staking and rewards count as free coins; coin-to-coin conversions move the cost basis |

Import either the PDFs or the CSV of a broker, not both: they describe the same transactions. Trade Republic corporate action, tax and interest notes are not read; its CSV export covers them.

Brokers are detected from the header row, also after a few preamble lines, and PDFs from their text. Each broker is an adapter in `src/import/adapters/` that maps its rows to the normalized `Transaction` model (`src/model/transaction.ts`), with shared helpers in `kit.ts`; the PDF readers are in `src/import/pdf/`. The rules for each broker follow [Portfolio Performance](https://github.com/portfolio-performance/portfolio)'s importers, which are tested on many real documents. Amounts in another currency than EUR are converted at the ECB rate of the day. Adding a broker means adding an adapter and registering it in `src/import/registry.ts`.

To check real exports without committing them:

```bash
DEGIRO_SAMPLE=/path/to/Transactions.xlsx npx vitest run privateSample --silent=false
BROKER_EXPORTS=/path/to/folder npx vitest run brokerExports --silent=false   # every CSV/XLSX/XML in a folder
PDF_SAMPLES=/path/to/folder npx vitest run pdfSamples --silent=false         # every PDF, or PDF text dump (.txt)
```

Never commit personal broker exports: this repository is public.

## Static market data

`public/data/` holds FX rates and benchmark closes that the app reads before calling any live API:

| File | Content | Source |
|---|---|---|
| `fx-rates.json` | ECB reference rates, units per 1 EUR, 14 currencies, from 2010 | Frankfurter |
| `benchmark-iwda.json`, `benchmark-vwce.json`, `benchmark-sxr8.json` | Daily closes of the benchmark ETFs | Yahoo Finance |
| `meta.json` | Last check, sources, row counts, errors | |
| `report.json` | Weekly data-quality report: stale files, gaps, large day-to-day moves, missing values | |

The files are append-only: dates already stored are never rewritten. Update them locally with `npm run data:snapshot`.

The **Daily data snapshot** workflow (`.github/workflows/data-snapshot.yml`) runs every day at 21:30 UTC and can be started by hand from the Actions tab. It:

1. fetches the new data server side (Yahoo does not allow browser requests),
2. commits the changes to `main`, with the commit author taken from `.github/authors.json` (rotated daily when it lists more than one author); on days without new market data only `meta.json` changes,
3. builds and deploys the site, because pushes made with `GITHUB_TOKEN` do not start other workflows.

The **Weekly maintenance** workflow (`.github/workflows/weekly-maintenance.yml`) runs every Monday at 06:00 UTC, with the same author list. It writes `public/data/report.json` and regenerates [`CHANGELOG.md`](CHANGELOG.md) from the merged pull requests, then deploys when something changed. Warnings (a file that stopped updating, a gap of more than 6 days in the last 90 days, errors from the last daily snapshot) show up in the report and as annotations on the workflow run. Run it locally with `npm run maintenance`.

GitHub disables scheduled workflows in public repositories after 60 days without repository activity. The daily commits keep the schedule active; if it is ever disabled, re-enable it in the Actions tab.

## Price proxy

Yahoo Finance and OpenFIGI block browser requests (no CORS). `workers/price-proxy/` is a small Cloudflare Worker that forwards only daily chart and ISIN-mapping requests from the app's own origin. See [its README](workers/price-proxy/README.md) for deployment. Without the proxy, the app can still use price APIs with your own key (Twelve Data, Alpha Vantage) and key-less CoinGecko for crypto.

## Development

Requires Node.js 22 or newer (the scripts run TypeScript directly with Node's type stripping).

```bash
npm install
npm run dev            # local dev server
npm test               # unit tests (Vitest)
npm run build          # type-check + production build to dist/
npm run preview        # serve the production build, including the service worker
npm run data:snapshot  # update public/data from the live sources
npm run maintenance    # data-quality report and changelog
```

PWA icons are generated at build time from `public/icon.svg`. The service worker only runs in the production build, so test offline behaviour with `npm run build && npm run preview`.

| Folder | Content |
|---|---|
| `src/import/` | File reading and one adapter per broker |
| `src/model/` | The normalized `Transaction` |
| `src/data/` | IndexedDB schema (Dexie) |
| `src/market/` | Price providers, FX, ISIN resolution, caching and sync |
| `src/engine/` | Pure calculation: ledger, daily series, returns, benchmark |
| `src/ui/` | Pages and dashboard components |
| `scripts/` | Daily snapshot and weekly maintenance, run by GitHub Actions |
| `workers/price-proxy/` | Cloudflare Worker for Yahoo Finance and OpenFIGI |

## Deployment

Every push to `main` is tested, built and deployed to GitHub Pages by `.github/workflows/deploy.yml` (Pages source: GitHub Actions). Pull requests run tests and the build via `.github/workflows/ci.yml`. The Vite `base` is `/portfolio-history/`; change it in `vite.config.ts` for a fork with another name.

## Contributing

- One branch and one pull request per change, linked to an issue (`Closes #n`). Merge with a merge commit; squash merging is off.
- Every pull request needs green CI: `npm test` and `npm run build` (strict TypeScript) must pass.
- Add tests with every change in `src/engine`, `src/import`, `src/market` or `scripts`. The engine is pure: test it with hand-calculated scenarios.
- **Never commit a real broker export or anything with personal data.** Fixtures are synthetic; check a real file locally with the `*_SAMPLE` environment variable as shown above.
- New broker: open an issue with an anonymized sample (the header row plus a few rows with made-up numbers), then add an adapter in `src/import/adapters/<broker>/` and register it. Open broker requests have the [`broker`](https://github.com/Gnipral/portfolio-history/issues?q=is%3Aopen+label%3Abroker) label.
- Don't edit `public/data/*` or `CHANGELOG.md` by hand; the workflows own them.
- Commit with a noreply email address (GitHub → Settings → Emails → Keep my email addresses private).

## Brand

Logo files are in `public/brand/`: the mark (`gnipral-mark.svg`, also the app icon via `public/icon.svg`), the lockup for light and dark backgrounds, a 500×500 avatar and a 1280×640 social preview image.
