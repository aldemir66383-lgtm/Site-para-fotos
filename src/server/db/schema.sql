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

-- Aplicar após o baseline. Em bancos existentes, registre 0001 como já aplicado.
CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  photographer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_albums_owner ON albums(photographer_id, id);

ALTER TABLE photos ADD COLUMN preview_r2_key TEXT;
ALTER TABLE photos ADD COLUMN approved_at TEXT;
ALTER TABLE photos ADD COLUMN pipeline_version TEXT;

CREATE TABLE photo_exif (
  photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  date_time_original TEXT,
  sub_sec_time_original TEXT,
  offset_time_original TEXT,
  captured_at_utc TEXT,
  camera_make TEXT,
  camera_model TEXT,
  lens_model TEXT,
  exposure_time REAL,
  f_number REAL,
  iso REAL,
  focal_length REAL,
  orientation INTEGER CHECK(orientation BETWEEN 1 AND 8),
  extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photo_uploads (
  photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  staging_key TEXT NOT NULL UNIQUE,
  expected_bytes INTEGER NOT NULL CHECK(expected_bytes BETWEEN 1 AND 20971520),
  upload_expires_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending', 'queued', 'processing', 'done', 'failed')),
  source_etag TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER,
  error_code TEXT,
  staging_deleted_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_photo_uploads_recovery ON photo_uploads(state, updated_at);
CREATE INDEX idx_photos_catalog ON photos(album_id, captured_at, id) WHERE status = 'verified';

-- Remover valores antigos inválidos e duplicados antes da unicidade.
DELETE FROM photo_bibs WHERE length(bib_number) NOT BETWEEN 1 AND 5
  OR bib_number GLOB '*[^0-9]*' OR confidence NOT BETWEEN 0 AND 1;
DELETE FROM photo_bibs WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY photo_id, bib_number ORDER BY confidence DESC, id
    ) AS position FROM photo_bibs
  ) WHERE position > 1
);
CREATE UNIQUE INDEX idx_photo_bibs_unique ON photo_bibs(photo_id, bib_number);
CREATE INDEX idx_photo_bibs_lookup ON photo_bibs(bib_number, photo_id);

CREATE TRIGGER photo_bibs_validate_insert BEFORE INSERT ON photo_bibs
WHEN length(NEW.bib_number) NOT BETWEEN 1 AND 5 OR NEW.bib_number GLOB '*[^0-9]*'
  OR NEW.confidence NOT BETWEEN 0 AND 1
BEGIN SELECT RAISE(ABORT, 'invalid bib'); END;
CREATE TRIGGER photo_bibs_validate_update BEFORE UPDATE ON photo_bibs
WHEN length(NEW.bib_number) NOT BETWEEN 1 AND 5 OR NEW.bib_number GLOB '*[^0-9]*'
  OR NEW.confidence NOT BETWEEN 0 AND 1
BEGIN SELECT RAISE(ABORT, 'invalid bib'); END;

-- O default legado era verified: agora mesmo um INSERT sem status falha fechado.
CREATE TRIGGER photos_require_processing_insert BEFORE INSERT ON photos
WHEN NEW.status = 'verified'
BEGIN SELECT RAISE(ABORT, 'new photos must start as draft'); END;

CREATE TRIGGER photos_require_processing_update BEFORE UPDATE ON photos
WHEN NEW.status = 'verified' AND (
  NEW.approved_at IS NULL OR NEW.pipeline_version IS NULL
  OR NEW.preview_r2_key IS NULL OR NEW.preview_r2_key != 'previews/' || NEW.id || '.webp'
  OR NEW.preview_url != '/api/fotoviva/previews/' || NEW.id
  OR NOT EXISTS (SELECT 1 FROM photo_exif WHERE photo_id = NEW.id)
)
BEGIN SELECT RAISE(ABORT, 'verified photos require approved media and EXIF processing'); END;

-- Fotos legadas não têm prova de processamento/marca d'água; exigem reingestão.
UPDATE photos SET status = 'draft' WHERE status = 'verified';

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

-- Marca pública: Aire Photos. Nomes internos existentes são preservados.
ALTER TABLE albums ADD COLUMN catalog_visibility TEXT NOT NULL DEFAULT 'public' CHECK(catalog_visibility IN ('public','private'));
ALTER TABLE albums ADD COLUMN may_include_minors INTEGER NOT NULL DEFAULT 1 CHECK(may_include_minors IN (0,1));
ALTER TABLE albums ADD COLUMN face_search_enabled INTEGER NOT NULL DEFAULT 0 CHECK(face_search_enabled IN (0,1));
ALTER TABLE albums ADD COLUMN face_legal_basis_reference TEXT;
ALTER TABLE albums ADD COLUMN face_index_expires_at_ms INTEGER;

ALTER TABLE face_search_consents ADD COLUMN subject_hash TEXT;
ALTER TABLE face_search_consents ADD COLUMN consented_at_ms INTEGER;
ALTER TABLE face_search_consents ADD COLUMN expires_at_ms INTEGER;
ALTER TABLE face_search_consents ADD COLUMN purpose TEXT NOT NULL DEFAULT 'selfie_search';
ALTER TABLE face_search_consents ADD COLUMN revoked_at_ms INTEGER;
CREATE INDEX idx_face_consent_subject_time ON face_search_consents(subject_hash,consented_at_ms);
CREATE INDEX idx_face_consent_ip_time ON face_search_consents(buyer_ip_hash,consented_at_ms);
CREATE TABLE search_sessions (
  id TEXT PRIMARY KEY,
  owner_subject_hash TEXT NOT NULL,
  album_id TEXT NOT NULL REFERENCES albums(id),
  consent_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode='selfie'),
  results_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_search_sessions_expiry ON search_sessions(expires_at_ms);

CREATE TABLE photo_face_index (
  photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  album_id TEXT NOT NULL REFERENCES albums(id),
  model_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('indexing','indexed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until_ms INTEGER,
  source_etag TEXT,
  updated_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE TABLE photo_face_embeddings (
  photo_id TEXT NOT NULL REFERENCES photo_face_index(photo_id) ON DELETE CASCADE,
  album_id TEXT NOT NULL REFERENCES albums(id),
  face_index INTEGER NOT NULL CHECK(face_index BETWEEN 0 AND 29),
  model_version TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY(photo_id,face_index)
);
CREATE INDEX idx_face_album_vectors ON photo_face_embeddings(album_id,model_version,photo_id,face_index);
CREATE VIEW face_search_photos AS SELECT p.* FROM photos p JOIN albums a ON a.id=p.album_id
  WHERE p.status='verified' AND a.catalog_visibility='public' AND a.face_search_enabled=1
  AND a.may_include_minors=0 AND a.face_legal_basis_reference IS NOT NULL
  AND length(trim(a.face_legal_basis_reference))>0;
CREATE TRIGGER face_index_photo_hidden AFTER UPDATE OF status ON photos WHEN NEW.status!='verified'
BEGIN DELETE FROM photo_face_index WHERE photo_id=NEW.id; END;
CREATE TRIGGER face_index_photo_changed AFTER UPDATE OF album_id,original_r2_key ON photos
WHEN NEW.album_id!=OLD.album_id OR NEW.original_r2_key!=OLD.original_r2_key
BEGIN DELETE FROM photo_face_index WHERE photo_id=NEW.id; END;
CREATE TRIGGER face_index_album_disabled AFTER UPDATE OF face_search_enabled,may_include_minors,catalog_visibility,face_legal_basis_reference,face_index_expires_at_ms ON albums
BEGIN DELETE FROM photo_face_index WHERE album_id=NEW.id; END;

ALTER TABLE orders ADD COLUMN buyer_phone_e164 TEXT;
ALTER TABLE orders ADD COLUMN whatsapp_opt_in_at_ms INTEGER;
ALTER TABLE orders ADD COLUMN whatsapp_opt_in_version TEXT;
CREATE TABLE whatsapp_outbox (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','failed','uncertain','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  lease_token TEXT,
  lease_until_ms INTEGER,
  provider_message_id TEXT,
  error_code TEXT,
  created_at_ms INTEGER NOT NULL,
  accepted_at_ms INTEGER
);
CREATE INDEX idx_whatsapp_outbox_pending ON whatsapp_outbox(state,next_attempt_at_ms);
CREATE TABLE maintenance_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- 0005_users_auth_admin.sql
-- Tabela de usuários para login nativo no Aire Photos (Cloudflare D1)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('buyer', 'photographer', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE revoked_sessions (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_revoked_sessions_expiry ON revoked_sessions(expires_at);

-- Existing financial rules remain immutable. Every edit creates a new version.
ALTER TABLE commission_rules ADD COLUMN name TEXT NOT NULL DEFAULT 'Regra de comissão';
