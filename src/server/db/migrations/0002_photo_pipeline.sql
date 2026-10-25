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
