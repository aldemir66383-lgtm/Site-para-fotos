ALTER TABLE orders ADD COLUMN paid_at_ms INTEGER;
ALTER TABLE download_entitlements ADD COLUMN granted_event_id TEXT;
ALTER TABLE download_entitlements ADD COLUMN granted_at_ms INTEGER;
ALTER TABLE delivery_tickets ADD COLUMN order_id TEXT;
ALTER TABLE delivery_tickets ADD COLUMN kind TEXT NOT NULL DEFAULT 'single' CHECK(kind IN ('single', 'zip'));
ALTER TABLE delivery_tickets ADD COLUMN issued_at_ms INTEGER;
ALTER TABLE delivery_tickets ADD COLUMN used_at_ms INTEGER;
ALTER TABLE delivery_tickets ADD COLUMN claim_id TEXT;
ALTER TABLE delivery_tickets ADD COLUMN item_count INTEGER NOT NULL DEFAULT 1;
CREATE INDEX idx_entitlements_order ON download_entitlements(order_id, buyer_subject);
CREATE INDEX idx_tickets_issued ON delivery_tickets(issued_at_ms);

CREATE TABLE delivery_ticket_items (
  ticket_hash TEXT NOT NULL REFERENCES delivery_tickets(token_hash),
  entitlement_id TEXT NOT NULL REFERENCES download_entitlements(id),
  PRIMARY KEY(ticket_hash, entitlement_id)
);
CREATE INDEX idx_ticket_items_entitlement ON delivery_ticket_items(entitlement_id, ticket_hash);
CREATE TABLE delivery_log (
  id TEXT PRIMARY KEY,
  ticket_hash TEXT,
  order_id TEXT,
  buyer_subject TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN
    ('issued','started','served','expired','reused','denied','revoked','storage_error','cancelled','rate_limited','download_limit')),
  bytes INTEGER NOT NULL DEFAULT 0 CHECK(bytes >= 0),
  at_ms INTEGER NOT NULL
);
CREATE INDEX idx_delivery_log_order ON delivery_log(order_id, at_ms);
CREATE TRIGGER delivery_log_no_update BEFORE UPDATE ON delivery_log
BEGIN SELECT RAISE(ABORT, 'delivery_log is append-only'); END;
CREATE TRIGGER delivery_log_no_delete BEFORE DELETE ON delivery_log
BEGIN SELECT RAISE(ABORT, 'delivery_log is append-only'); END;
CREATE TRIGGER ticket_items_no_update BEFORE UPDATE ON delivery_ticket_items
BEGIN SELECT RAISE(ABORT, 'ticket items are immutable'); END;
CREATE TRIGGER ticket_items_no_delete BEFORE DELETE ON delivery_ticket_items
BEGIN SELECT RAISE(ABORT, 'ticket items are immutable'); END;

CREATE TABLE commission_rules (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK(version > 0),
  platform_fee_bps INTEGER NOT NULL CHECK(platform_fee_bps BETWEEN 0 AND 10000),
  provider_fee_bps INTEGER NOT NULL CHECK(provider_fee_bps BETWEEN 0 AND 10000),
  provider_fee_fixed_cents INTEGER NOT NULL CHECK(provider_fee_fixed_cents BETWEEN 0 AND 1000000000000),
  provider_fee_bearer TEXT NOT NULL CHECK(provider_fee_bearer IN ('platform','photographer')),
  hold_days INTEGER NOT NULL CHECK(hold_days BETWEEN 0 AND 365),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER commission_rules_no_update BEFORE UPDATE ON commission_rules
BEGIN SELECT RAISE(ABORT, 'commission rules are immutable'); END;
CREATE TRIGGER commission_rules_no_delete BEFORE DELETE ON commission_rules
BEGIN SELECT RAISE(ABORT, 'commission rules are immutable'); END;

ALTER TABLE ledger_entries ADD COLUMN order_id TEXT REFERENCES orders(id);
ALTER TABLE ledger_entries ADD COLUMN actor TEXT;
ALTER TABLE ledger_entries ADD COLUMN available_at_ms INTEGER;
CREATE TABLE ledger_postings (
  posting_key TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('draft','posted','legacy_review')),
  expected_entries INTEGER NOT NULL CHECK(expected_entries >= 2),
  operation_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
-- Preservar o histórico anterior; grupos inválidos ficam fora dos saldos.
INSERT INTO ledger_postings
SELECT posting_key,
  CASE WHEN count(*) >= 2
    AND sum(CASE WHEN direction='debit' THEN amount_cents ELSE -amount_cents END) = 0
    AND min(CASE WHEN typeof(amount_cents)='integer' AND amount_cents > 0 THEN 1 ELSE 0 END) = 1
    THEN 'posted' ELSE 'legacy_review' END,
  max(2, count(*)), 'legacy', 'migration:0003', 0
FROM ledger_entries GROUP BY posting_key;

CREATE TRIGGER ledger_entries_validate BEFORE INSERT ON ledger_entries
WHEN typeof(NEW.amount_cents) != 'integer' OR NEW.amount_cents NOT BETWEEN 1 AND 1000000000000
  OR NEW.actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM ledger_postings WHERE posting_key=NEW.posting_key AND state='draft')
BEGIN SELECT RAISE(ABORT, 'invalid or sealed ledger posting'); END;
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
CREATE TRIGGER ledger_postings_insert_draft BEFORE INSERT ON ledger_postings
WHEN NEW.state != 'draft'
BEGIN SELECT RAISE(ABORT, 'new postings must start as draft'); END;
CREATE TRIGGER ledger_postings_seal BEFORE UPDATE ON ledger_postings
WHEN OLD.state != 'draft' OR NEW.state != 'posted'
  OR NEW.posting_key != OLD.posting_key OR NEW.operation_id != OLD.operation_id
  OR NEW.actor != OLD.actor OR NEW.created_at_ms != OLD.created_at_ms
  OR NEW.expected_entries != OLD.expected_entries
  OR (SELECT count(*) FROM ledger_entries WHERE posting_key=OLD.posting_key) != OLD.expected_entries
  OR (SELECT sum(CASE WHEN direction='debit' THEN amount_cents ELSE -amount_cents END)
      FROM ledger_entries WHERE posting_key=OLD.posting_key) != 0
BEGIN SELECT RAISE(ABORT, 'ledger posting must be immutable and balanced'); END;
CREATE TRIGGER ledger_postings_no_delete BEFORE DELETE ON ledger_postings
BEGIN SELECT RAISE(ABORT, 'ledger_postings is append-only'); END;
CREATE INDEX idx_ledger_account_balance ON ledger_entries(account, available_at_ms, posting_key);

CREATE TABLE photographer_payout_profiles (
  photographer_id TEXT PRIMARY KEY,
  pix_key_type TEXT NOT NULL CHECK(pix_key_type IN ('CPF','CNPJ','PHONE','EMAIL','EVP')),
  pix_key_ciphertext TEXT NOT NULL,
  pix_key_fingerprint TEXT NOT NULL,
  verified_at_ms INTEGER NOT NULL,
  disabled_at_ms INTEGER
);
CREATE TABLE payout_requests (
  id TEXT PRIMARY KEY,
  photographer_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000000000),
  pix_key_type TEXT NOT NULL,
  pix_key_ciphertext TEXT NOT NULL,
  pix_key_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','cancelled','paid')),
  requested_at_ms INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  UNIQUE(photographer_id, idempotency_key)
);
CREATE INDEX idx_payout_owner ON payout_requests(photographer_id, requested_at_ms);

-- O snapshot financeiro dos itens e do pedido não pode mudar após a criação.
CREATE TRIGGER order_items_no_update BEFORE UPDATE ON order_items
BEGIN SELECT RAISE(ABORT, 'order items are immutable'); END;
CREATE TRIGGER order_items_no_delete BEFORE DELETE ON order_items
BEGIN SELECT RAISE(ABORT, 'order items are immutable'); END;
CREATE TRIGGER order_items_no_late_insert BEFORE INSERT ON order_items
WHEN NOT EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND status='pending')
BEGIN SELECT RAISE(ABORT, 'order is no longer pending'); END;
CREATE TRIGGER orders_snapshot_immutable BEFORE UPDATE ON orders
WHEN NEW.total_cents != OLD.total_cents OR NEW.item_count != OLD.item_count
  OR NEW.buyer_subject != OLD.buyer_subject OR NEW.commission_rule_id != OLD.commission_rule_id
BEGIN SELECT RAISE(ABORT, 'order snapshot is immutable'); END;
