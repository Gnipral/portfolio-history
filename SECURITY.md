# Security policy

Portfolio History runs in the browser and keeps portfolio data on the device. The only servers are two Cloudflare Workers: the price proxy (`workers/price-proxy`) and the optional, end-to-end encrypted account (`workers/account`). A problem in any of them is welcome.

## Reporting a vulnerability

Please do not open a public issue. Report it privately on GitHub instead: **Security → Report a vulnerability** on this repository ([direct link](https://github.com/Gnipral/portfolio-history/security/advisories/new)).

Include what you found, how to reproduce it, and what an attacker could do with it. You get an answer within a week. Once it is fixed, the advisory is published and you are credited if you want to be.

## Scope

- The app at https://gnipral.github.io/portfolio-history/ and the code in this repository
- The price proxy and the account Worker

Out of scope: the market data sources themselves (Yahoo, Twelve Data, Alpha Vantage, CoinGecko, OpenFIGI) and denial-of-service tests.

## What the app does to protect your data

- Without an account, nothing about your portfolio leaves the device: price requests contain only tickers, ISINs and dates.
- The account stores only data encrypted in the browser (AES-GCM, key from your own password with PBKDF2-SHA256, 600,000 iterations). Sign-in uses passkeys; there are no passwords on the server.
- Both Workers only answer the app's own origin and are rate limited per IP address.
- The app has a Content-Security-Policy, and the GitHub Actions are pinned to a commit.
