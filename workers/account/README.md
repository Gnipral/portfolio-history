# Account (Cloudflare Worker)

The optional account of the app. Everything works without it. With an account, the imported portfolio and the saved periods are kept, so they can be opened again later or on another device.

| Route | What it does |
|---|---|
| `POST /register/options`, `POST /register/verify` | Create an account with a passkey; answers a session token |
| `POST /login/options`, `POST /login/verify` | Sign in with a passkey; answers a session token |
| `GET /me` | The account of the token and when its data was last saved |
| `POST /logout` | End this session |
| `DELETE /account` | Delete the account, its passkeys, sessions and data |
| `GET /data`, `PUT /data` | Load or save the data: the portfolio and periods, gzipped by the app (max 1.5 MB) |

## Security

- **Passkeys (WebAuthn):** no passwords. The Worker stores only each passkey's public key and checks every sign-in against it with SimpleWebAuthn.
- **Relying party:** the host name of the calling origin, so a passkey made on the app's site only works there.
- **Challenges:** used once, valid for 5 minutes, deleted on use.
- **Sessions:** random 256-bit tokens, valid for 90 days. Only their SHA-256 is stored.
- **Origins:** only origins in `ALLOWED_ORIGINS` (`wrangler.toml`) get an answer.
- **Your data:** sent to the account only when the person saves it (or after an import or change while signed in). It is end-to-end encrypted: the app compresses it and encrypts it with AES-GCM under a key derived (PBKDF2, 600,000 rounds) from an encryption password the person chooses, before it leaves the browser. The Worker stores only those sealed bytes in D1 and cannot read them. A forgotten password cannot be reset; the data on the devices stays.

## Set up (once)

With the Cloudflare account that runs the price proxy:

1. **Create the database:**

   ```bash
   cd workers/account
   npx wrangler d1 create portfolio-history-account
   ```

   Paste the `database_id` it prints into `wrangler.toml`, then create the tables:

   ```bash
   npx wrangler d1 migrations apply portfolio-history-account --remote
   ```

2. **Deploy.** Connect Workers Builds to this repository like the price proxy: root directory `/workers/account`, deploy command `npx wrangler deploy`. Or deploy by hand with `npx wrangler deploy`. The Worker runs at `https://portfolio-history-account.<account>.workers.dev`.

3. **Show it in the app.** In GitHub, under *Settings → Secrets and variables → Actions → Variables*, add the repository variable `ACCOUNT_URL` with that address. The next deploy of the app shows **Settings → Account (optional)**. Without the variable, the app has no account at all.

For local development, start the app with `VITE_ACCOUNT_URL=<address> npm run dev`. `http://localhost:5173` is already in `ALLOWED_ORIGINS`, and passkeys made there only work on localhost.

## Test

From the repository root: `npx vitest run workers/account`.
