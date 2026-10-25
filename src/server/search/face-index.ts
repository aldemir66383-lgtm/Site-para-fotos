import {
  ApiError,
  MAX_UPLOAD_BYTES,
  readLimited,
} from "../photos/contracts.js";
import type { Env } from "../photos/env.js";
import { encryptFaceVector } from "./face-privacy.js";
import {
  faceConfig,
  httpFaceProvider,
  type EmbedFaces,
  type Face,
} from "./face-provider.js";

export interface FaceAlbum {
  id: string;
  face_index_expires_at_ms: number;
}
export async function eligibleFaceAlbum(
  env: Env,
  albumId: string,
  now = Date.now(),
): Promise<FaceAlbum> {
  const row = await env.DB.prepare(
    `SELECT id,face_index_expires_at_ms FROM albums WHERE id=?
    AND catalog_visibility='public' AND face_search_enabled=1 AND may_include_minors=0
    AND face_legal_basis_reference IS NOT NULL AND length(trim(face_legal_basis_reference))>0
    AND face_index_expires_at_ms>?`,
  )
    .bind(albumId, now)
    .first<FaceAlbum>();
  if (!row)
    throw new ApiError(
      404,
      "not_found",
      "Álbum indisponível para busca por selfie.",
    );
  return row;
}

export async function indexPhotoFaces(
  env: Env,
  photoId: string,
  provider?: EmbedFaces,
  suppliedImage?: Uint8Array<ArrayBuffer>,
) {
  if (env.FV_FACE_SEARCH !== "on") return;
  const config = faceConfig(env),
    now = Date.now(),
    token = crypto.randomUUID();
  const photo = await env.DB.prepare(
    "SELECT id,album_id,original_r2_key FROM face_search_photos WHERE id=?",
  )
    .bind(photoId)
    .first<{ id: string; album_id: string; original_r2_key: string }>();
  if (!photo) return;
  const album = await eligibleFaceAlbum(env, photo.album_id, now);
  const expires = Math.min(
    album.face_index_expires_at_ms,
    now + 30 * 86_400_000,
  );
  await env.DB.prepare(
    `INSERT INTO photo_face_index
    (photo_id,album_id,model_version,state,attempts,lease_token,lease_until_ms,updated_at_ms,expires_at_ms)
    VALUES (?,?,?,'indexing',1,?,?,?,?) ON CONFLICT(photo_id) DO UPDATE SET
    album_id=excluded.album_id,model_version=excluded.model_version,state='indexing',
    attempts=CASE WHEN photo_face_index.state='indexed' OR photo_face_index.model_version!=excluded.model_version THEN 1 ELSE photo_face_index.attempts+1 END,
    lease_token=excluded.lease_token,lease_until_ms=excluded.lease_until_ms,updated_at_ms=excluded.updated_at_ms,expires_at_ms=excluded.expires_at_ms
    WHERE (photo_face_index.state!='indexing' OR photo_face_index.lease_until_ms<?)
      AND (photo_face_index.state!='indexed' OR photo_face_index.model_version!=? OR photo_face_index.expires_at_ms<=?)
      AND (photo_face_index.attempts<3 OR photo_face_index.model_version!=? OR photo_face_index.state='indexed')`,
  )
    .bind(
      photoId,
      photo.album_id,
      config.model,
      token,
      now + 120_000,
      now,
      expires,
      now,
      config.model,
      now,
      config.model,
    )
    .run();
  const claimed = await env.DB.prepare(
    "SELECT lease_token FROM photo_face_index WHERE photo_id=?",
  )
    .bind(photoId)
    .first<{ lease_token: string }>();
  if (claimed?.lease_token !== token) return;
  let image = suppliedImage;
  let faces: Face[] = [];
  try {
    if (!image) {
      const object = await env.PHOTOS.get(photo.original_r2_key);
      if (!object || object.size > MAX_UPLOAD_BYTES)
        throw new Error("Face original unavailable");
      image = await readLimited(object.body, MAX_UPLOAD_BYTES);
    }
    faces = await (provider ?? httpFaceProvider(env))(image, "image/jpeg");
    const ciphertexts: { faceIndex: number; ciphertext: string }[] = [];
    for (const [faceIndex, face] of faces.entries()) {
      if (faceIndex >= 30) throw new Error("Too many indexed faces");
      if (face.quality < 0.6) continue;
      ciphertexts.push({
        faceIndex,
        ciphertext: await encryptFaceVector(
          env.FACE_INDEX_ENCRYPTION_KEY!,
          `${photo.album_id}:${photoId}:${config.model}:${faceIndex}`,
          face.vector,
        ),
      });
    }
    const gate = `EXISTS (SELECT 1 FROM photo_face_index f JOIN face_search_photos p ON p.id=f.photo_id
      JOIN albums a ON a.id=p.album_id WHERE f.photo_id=? AND f.lease_token=? AND f.state='indexing'
      AND a.face_index_expires_at_ms>?)`;
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM photo_face_embeddings WHERE photo_id=? AND ${gate}`,
      ).bind(photoId, photoId, token, Date.now()),
      ...ciphertexts.map((face) =>
        env.DB.prepare(
          `INSERT INTO photo_face_embeddings(photo_id,album_id,face_index,model_version,ciphertext,expires_at_ms)
        SELECT ?,?,?,?,?,? WHERE ${gate}`,
        ).bind(
          photoId,
          photo.album_id,
          face.faceIndex,
          config.model,
          face.ciphertext,
          expires,
          photoId,
          token,
          Date.now(),
        ),
      ),
      env.DB.prepare(
        `UPDATE photo_face_index SET state='indexed',lease_token=NULL,lease_until_ms=NULL,updated_at_ms=?
        WHERE photo_id=? AND lease_token=? AND ${gate}`,
      ).bind(Date.now(), photoId, token, photoId, token, Date.now()),
    ]);
  } catch (error) {
    await env.DB.prepare(
      "UPDATE photo_face_index SET state='failed',lease_token=NULL,lease_until_ms=NULL,updated_at_ms=? WHERE photo_id=? AND lease_token=?",
    )
      .bind(Date.now(), photoId, token)
      .run();
    throw error;
  } finally {
    if (!suppliedImage) image?.fill(0);
    for (const face of faces) face.vector.fill(0);
  }
}

export async function indexPendingFaces(env: Env, limit = 10) {
  if (
    env.FV_FACE_SEARCH !== "on" ||
    !env.FACE_EMBEDDINGS_URL ||
    !env.FACE_INDEX_ENCRYPTION_KEY
  )
    return;
  const now = Date.now();
  const rows = await env.DB.prepare(
    `SELECT p.id FROM face_search_photos p JOIN albums a ON a.id=p.album_id
    LEFT JOIN photo_face_index f ON f.photo_id=p.id WHERE a.face_index_expires_at_ms>?
    AND (f.photo_id IS NULL OR ((f.model_version!=? OR f.state='failed' OR f.expires_at_ms<=? OR (f.state='indexing' AND f.lease_until_ms<?))
      AND (f.attempts<3 OR f.model_version!=? OR f.state='indexed') AND f.updated_at_ms<?)) ORDER BY p.id LIMIT ?`,
  )
    .bind(
      now,
      env.FACE_MODEL_VERSION ?? "",
      now,
      now,
      env.FACE_MODEL_VERSION ?? "",
      now - 600_000,
      limit,
    )
    .all<{ id: string }>();
  for (const row of rows.results) {
    try {
      await indexPhotoFaces(env, row.id);
    } catch {
      console.error("face_index_retry_pending");
    }
  }
}
