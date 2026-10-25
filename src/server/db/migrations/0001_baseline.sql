-- Schema D1 SQLite para FotoViva
-- Suporta conciliação contábil, eventos Pix, catálogo, busca e downloads

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  buyer_subject TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'paid', 'expired', 'failed', 'refunded', 'partially_refunded')),
  item_count INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  commission_rule_id TEXT NOT NULL,
  paid_event_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(buyer_subject, idempotency_key)
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL,
  photographer_id TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_charges (
  txid TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,
  provider_charge_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'paid', 'expired', 'failed', 'refunded')),
  copy_and_paste TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  txid TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  outcome TEXT NOT NULL, -- applied, duplicate, amount_mismatch, late_payment, unknown_charge
  payload TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS download_entitlements (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL UNIQUE REFERENCES order_items(id),
  order_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  buyer_subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked', 'expired')),
  downloads_left INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  revocation_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_tickets (
  token_hash TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES download_entitlements(id),
  photo_id TEXT NOT NULL,
  buyer_subject TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  posting_key TEXT NOT NULL, -- ex: payment:order_id, refund:order_id
  account TEXT NOT NULL,      -- photographer:id, platform:fee, provider:fee, clearing
  direction TEXT NOT NULL CHECK(direction IN ('credit', 'debit')),
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(posting_key, account)
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL,
  photographer_id TEXT NOT NULL,
  preview_url TEXT NOT NULL,
  original_r2_key TEXT NOT NULL,
  captured_at TEXT,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'verified' CHECK(status IN ('draft', 'verified', 'hidden')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photo_bibs (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  bib_number TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_photo_bibs_number ON photo_bibs(bib_number);

CREATE TABLE IF NOT EXISTS face_search_consents (
  id TEXT PRIMARY KEY,
  buyer_ip_hash TEXT NOT NULL,
  album_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  consented_at TEXT NOT NULL DEFAULT (datetime('now'))
);
