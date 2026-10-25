import { ApiError, MAX_ATTEMPTS, MAX_PREVIEW_BYTES, MAX_UPLOAD_BYTES, mediaResultSchema, readLimited, type PhotoJob } from "./contracts.js";
import type { Env } from "./env.js";
import type { UploadRow } from "./handlers.js";

const LEASE_MS = 5 * 60_000;

export async function processJob(job: PhotoJob, env: Env): Promise<void> {
  const token = crypto.randomUUID();
  const now = Date.now();
  const row = await env.DB.prepare(`UPDATE photo_uploads SET state = 'processing',
    lease_token = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
    WHERE photo_id = ? AND attempts < ? AND
    (state = 'queued' OR (state = 'processing' AND lease_until < ?)) RETURNING *`)
    .bind(token, now + LEASE_MS, now, job.photoId, MAX_ATTEMPTS, now).first<UploadRow>();
  if (!row) return;
  try {
    const source = await env.PHOTOS.get(row.staging_key, { onlyIf: { etagMatches: row.source_etag! } });
    if (!source || !("body" in source)) throw new ApiError(422, "source_changed", "Upload ausente ou alterado.");
    if (source.size > MAX_UPLOAD_BYTES || source.size !== row.expected_bytes) {
      await source.body.cancel();
      throw new ApiError(422, "invalid_size", "Tamanho inválido.");
    }
    const original = await readLimited(source.body, MAX_UPLOAD_BYTES);
    if (original[0] !== 0xff || original[1] !== 0xd8 || original[2] !== 0xff) {
      throw new ApiError(422, "invalid_jpeg", "JPEG inválido.");
    }
    const url = new URL(env.MEDIA_SERVICE_URL);
    if (url.protocol !== "https:" || !env.MEDIA_SERVICE_TOKEN) throw new Error("Invalid media service configuration");
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(90_000),
      headers: { "Content-Type": "image/jpeg", Authorization: `Bearer ${env.MEDIA_SERVICE_TOKEN}` },
      body: original,
    });
    if (response.status === 422 || response.status === 413 || response.status === 415) {
      await response.body?.cancel();
      throw new ApiError(422, "image_rejected", "Imagem recusada pelo processador.");
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error("Media service unavailable"); }
    const result = mediaResultSchema.parse(JSON.parse(new TextDecoder().decode(
      await readLimited(response.body, 3 * 1024 * 1024),
    )));
    const preview = Uint8Array.from(atob(result.previewBase64), c => c.charCodeAt(0));
    if (preview.length > MAX_PREVIEW_BYTES || new TextDecoder().decode(preview.slice(0, 4)) !== "RIFF"
      || new TextDecoder().decode(preview.slice(8, 12)) !== "WEBP") throw new Error("Invalid processor preview");

    const originalKey = `originals/${job.photoId}.jpg`;
    const previewKey = `previews/${job.photoId}.webp`;
    // As chaves definitivas nunca recebem uma URL PUT assinada.
    await env.PHOTOS.put(originalKey, original, {
      httpMetadata: { contentType: "image/jpeg", cacheControl: "private, no-store" },
      customMetadata: { photoId: job.photoId, sourceEtag: row.source_etag! },
    });
    await env.PHOTOS.put(previewKey, preview, {
      httpMetadata: { contentType: "image/webp", cacheControl: "no-store" },
      customMetadata: { pipeline: result.pipelineVersion, watermark: "burned-in-v1" },
    });
    const exif = result.exif;
    const gate = "EXISTS (SELECT 1 FROM photo_uploads WHERE photo_id = ? AND lease_token = ? AND state = 'done')";
    await env.DB.batch([
      env.DB.prepare(`UPDATE photo_uploads SET state = 'done', error_code = NULL, updated_at = ?
        WHERE photo_id = ? AND state = 'processing' AND lease_token = ? AND lease_until > ?`)
        .bind(Date.now(), job.photoId, token, Date.now()),
      env.DB.prepare(`INSERT INTO photo_exif (photo_id, date_time_original, sub_sec_time_original,
        offset_time_original, captured_at_utc, camera_make, camera_model, lens_model,
        exposure_time, f_number, iso, focal_length, orientation)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${gate}
        ON CONFLICT(photo_id) DO UPDATE SET
          date_time_original=excluded.date_time_original, sub_sec_time_original=excluded.sub_sec_time_original,
          offset_time_original=excluded.offset_time_original, captured_at_utc=excluded.captured_at_utc,
          camera_make=excluded.camera_make, camera_model=excluded.camera_model, lens_model=excluded.lens_model,
          exposure_time=excluded.exposure_time, f_number=excluded.f_number, iso=excluded.iso,
          focal_length=excluded.focal_length, orientation=excluded.orientation`)
        .bind(job.photoId, exif.dateTimeOriginal, exif.subSecTimeOriginal, exif.offsetTimeOriginal,
          exif.capturedAtUtc, exif.cameraMake, exif.cameraModel, exif.lensModel,
          exif.exposureTime, exif.fNumber, exif.iso, exif.focalLength, exif.orientation, job.photoId, token),
      env.DB.prepare(`DELETE FROM photo_bibs WHERE photo_id = ? AND ${gate}`).bind(job.photoId, job.photoId, token),
      ...result.bibs.map(bib => env.DB.prepare(`INSERT INTO photo_bibs (id, photo_id, bib_number, confidence)
        SELECT ?, ?, ?, ? WHERE ${gate}
        ON CONFLICT(photo_id, bib_number) DO UPDATE SET confidence = MAX(confidence, excluded.confidence)`)
        .bind(crypto.randomUUID(), job.photoId, bib.bibNumber, bib.confidence, job.photoId, token)),
      env.DB.prepare(`UPDATE photos SET status = 'verified', preview_r2_key = ?, preview_url = ?,
        original_r2_key = ?, captured_at = ?, width = ?, height = ?, approved_at = ?, pipeline_version = ?
        WHERE id = ? AND status = 'draft' AND ${gate}`)
        .bind(previewKey, `/api/fotoviva/previews/${job.photoId}`, originalKey, exif.capturedAt,
          result.width, result.height, new Date().toISOString(), result.pipelineVersion, job.photoId, job.photoId, token),
    ]);
  } catch (error) {
    const terminal = error instanceof ApiError && error.status < 500 || row.attempts >= MAX_ATTEMPTS;
    const code = error instanceof ApiError ? error.code : "processing_failed";
    await env.DB.prepare(`UPDATE photo_uploads SET state = ?, error_code = ?, lease_token = NULL,
      lease_until = NULL, updated_at = ? WHERE photo_id = ? AND state = 'processing' AND lease_token = ?`)
      .bind(terminal ? "failed" : "queued", code, Date.now(), job.photoId, token).run();
    if (!terminal) throw error;
  }
}

export async function consumePhotos(batch: MessageBatch<PhotoJob>, env: Env): Promise<void> {
  // Um original por vez por invocação mantém o uso de memória limitado.
  for (const message of batch.messages) {
    try {
      if (typeof message.body?.photoId !== "string") { message.ack(); continue; }
      await processJob(message.body, env);
      message.ack();
    } catch {
      console.error("photo_job_retry", { photoId: message.body.photoId });
      message.retry({ delaySeconds: 60 });
    }
  }
}

export async function recoverPhotos(env: Env): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE photo_uploads SET state = CASE WHEN attempts >= ? THEN 'failed' ELSE 'queued' END,
      lease_token = NULL, lease_until = NULL, updated_at = ?, error_code = 'processing_interrupted'
      WHERE state = 'processing' AND lease_until < ?`).bind(MAX_ATTEMPTS, now - 120_000, now),
    env.DB.prepare(`UPDATE photo_uploads SET state = 'failed', error_code = 'upload_expired', updated_at = ?
      WHERE state = 'pending' AND upload_expires_at < ?`).bind(now, now - 60_000),
  ]);
  const pending = await env.DB.prepare(`SELECT photo_id FROM photo_uploads WHERE state = 'queued'
    AND updated_at < ? ORDER BY updated_at LIMIT 100`).bind(now - 60_000).all<{ photo_id: string }>();
  if (pending.results.length) {
    await env.PHOTO_QUEUE.sendBatch(pending.results.map(row => ({ body: { photoId: row.photo_id } })));
    await env.DB.batch(pending.results.map(row => env.DB.prepare(`UPDATE photo_uploads SET updated_at = ?
      WHERE photo_id = ? AND state = 'queued'`).bind(now, row.photo_id)));
  }
  // URLs expiradas não podem recriar o staging depois da limpeza.
  const expired = await env.DB.prepare(`SELECT photo_id, staging_key FROM photo_uploads
    WHERE state IN ('done', 'failed') AND upload_expires_at < ? AND staging_deleted_at IS NULL LIMIT 100`)
    .bind(now - 60_000).all<{ photo_id: string; staging_key: string }>();
  for (const row of expired.results) {
    await env.PHOTOS.delete(row.staging_key);
    await env.DB.prepare("UPDATE photo_uploads SET staging_deleted_at = ? WHERE photo_id = ?")
      .bind(now, row.photo_id).run();
  }
}
