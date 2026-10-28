-- Accounts are optional: everything in the app works without one. An account keeps the imported
-- portfolio and the saved periods, to open them again later or on another device.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- Passkeys: only the public key is stored; the private key never leaves the person's device.
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX credentials_user ON credentials(user_id);

-- One-time challenges of a passkey ceremony, deleted when used or expired.
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  user_id TEXT,
  expires_at TEXT NOT NULL
);

-- Sessions by the SHA-256 of their token: a leaked table does not give access.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- The saved data: the portfolio and periods, compressed by the app.
CREATE TABLE data (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  body BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
