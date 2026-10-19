# Price proxy (Cloudflare Worker)

Yahoo Finance and OpenFIGI do not allow requests from a browser (no CORS headers). This Worker forwards exactly two kinds of requests for the app:

| Route | Upstream |
|---|---|
| `GET /yahoo/chart/:symbol?period1=&period2=` | Yahoo Finance daily chart with split events |
| `POST /openfigi/mapping` | OpenFIGI ISIN → ticker mapping (max 10 jobs) |

- Only origins listed in `ALLOWED_ORIGINS` (`wrangler.toml`) get an answer; everything else gets `403`.
- Query parameters are whitelisted; the interval is always `1d`.
- Responses are cached at the edge: one hour for recent data, a week for history that ended more than two days ago.
- The Worker sees only tickers and ISINs, never quantities or amounts. It stores nothing apart from that cache.

## Deploy

Needs a free Cloudflare account. From this folder:

```bash
npx wrangler login
npx wrangler deploy
```

Wrangler prints the URL, e.g. `https://portfolio-history-price-proxy.<account>.workers.dev`. Enter it in the app under **Settings → Price proxy URL**.

Optional, for a higher OpenFIGI rate limit (a free key from openfigi.com):

```bash
npx wrangler secret put OPENFIGI_API_KEY
```

The free Workers plan allows 100,000 requests per day, far more than this app needs: prices are cached in the browser, so each day is fetched only once per device.

## Test

From the repository root: `npx vitest run workers`.
