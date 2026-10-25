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
