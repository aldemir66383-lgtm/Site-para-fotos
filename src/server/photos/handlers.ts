import { z } from "zod";
import { ApiError, MAX_UPLOAD_BYTES, UPLOAD_TTL_SECONDS, readLimited } from "./contracts.js";
import { authenticatePhotographer, type Authenticate } from "./auth.js";
import { signUpload } from "./sign-upload.js";
import type { Env } from "./env.js";

const idSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const uploadInput = z.object({
  albumId: idSchema,
  filename: z.string().min(1).max(255).regex(/\.jpe?g$/i),
  contentType: z.literal("image/jpeg"),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
}).strict();
const processInput = z.object({ photoId: z.uuid() }).strict();

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function body(request: Request): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Envie um corpo JSON.");
  }
  try { return JSON.parse(new TextDecoder().decode(await readLimited(request.body, 4096))); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_input", "JSON inválido.");
  }
}

export async function uploadIntent(request: Request, env: Env, authenticate: Authenticate): Promise<Response> {
  const photographer = await authenticate(request, env);
  const raw = await body(request);
  if (typeof raw === "object" && raw && "size" in raw && typeof raw.size === "number" && raw.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, "payload_too_large", "O limite por JPEG é 20 MB.");
  }
  const input = uploadInput.parse(raw);
  const album = await env.DB.prepare("SELECT id FROM albums WHERE id = ? AND photographer_id = ?")
    .bind(input.albumId, photographer.id).first();
  if (!album) throw new ApiError(404, "not_found", "Álbum não encontrado.");
  const photoId = crypto.randomUUID();
  const stagingKey = `originals/pending/${photoId}/${crypto.randomUUID()}.jpg`;
  const now = Date.now();
  const expiresAt = now + UPLOAD_TTL_SECONDS * 1000;
  const uploadUrl = await signUpload(env, stagingKey, input.size);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO photos
      (id, album_id, photographer_id, preview_url, original_r2_key, status)
      VALUES (?, ?, ?, '', ?, 'draft')`).bind(photoId, input.albumId, photographer.id, `originals/${photoId}.jpg`),
    env.DB.prepare(`INSERT INTO photo_uploads
      (photo_id, staging_key, expected_bytes, upload_expires_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(photoId, stagingKey, input.size, expiresAt, now),
  ]);
  return json({
    photoId, uploadUrl, method: "PUT", headers: { "Content-Type": "image/jpeg" },
    expectedBytes: input.size, maxBytes: MAX_UPLOAD_BYTES, expiresAt: new Date(expiresAt).toISOString(),
  }, 201);
}

export interface UploadRow {
  photo_id: string; staging_key: string; expected_bytes: number; upload_expires_at: number;
  state: "pending" | "queued" | "processing" | "done" | "failed";
  source_etag: string | null; attempts: number; error_code: string | null;
  photo_status?: "draft" | "verified" | "hidden";
}

export async function processPhoto(request: Request, env: Env, authenticate: Authenticate): Promise<Response> {
  const photographer = await authenticate(request, env);
  const { photoId } = processInput.parse(await body(request));
  const row = await env.DB.prepare(`SELECT u.*, p.status AS photo_status FROM photo_uploads u JOIN photos p ON p.id = u.photo_id
    JOIN albums a ON a.id = p.album_id
    WHERE p.id = ? AND p.photographer_id = ? AND a.photographer_id = ?`)
    .bind(photoId, photographer.id, photographer.id).first<UploadRow>();
  if (!row) throw new ApiError(404, "not_found", "Foto não encontrada.");
  if (row.state === "done") return json({ photoId, status: row.photo_status,
    ...(row.photo_status === "verified" ? { previewUrl: `/api/fotoviva/previews/${photoId}` } : {}),
  });
  if (row.state === "failed") throw new ApiError(422, row.error_code ?? "processing_failed", "Processamento recusado. Reenvie a foto.");
  if (row.state === "pending") {
    if (row.upload_expires_at + 60_000 < Date.now()) throw new ApiError(410, "upload_expired", "Intenção de upload expirada.");
    const object = await env.PHOTOS.head(row.staging_key);
    if (!object) throw new ApiError(409, "upload_incomplete", "Conclua o upload antes de processar.");
    if (object.size > MAX_UPLOAD_BYTES || object.size !== row.expected_bytes) {
      throw new ApiError(413, "payload_too_large", "O tamanho enviado difere do upload autorizado.");
    }
    if (object.httpMetadata?.contentType !== "image/jpeg") {
      throw new ApiError(415, "unsupported_media_type", "Somente arquivos JPEG são aceitos.");
    }
    await env.DB.prepare(`UPDATE photo_uploads SET state = 'queued', source_etag = ?, updated_at = ?
      WHERE photo_id = ? AND state = 'pending'`).bind(object.etag, Date.now(), photoId).run();
  }
  // Outbox em D1: se o envio falhar, o cron republica. Duplicatas são seguras.
  if (row.state === "pending" || row.state === "queued") await env.PHOTO_QUEUE.send({ photoId });
  return json({ photoId, status: row.state === "processing" ? "processing" : "queued", pollAfterSeconds: 3 }, 202);
}

async function preview(photoId: string, env: Env): Promise<Response> {
  if (!z.uuid().safeParse(photoId).success) throw new ApiError(404, "not_found", "Prévia não encontrada.");
  const row = await env.DB.prepare(`SELECT preview_r2_key FROM photos
    WHERE id = ? AND status = 'verified' AND approved_at IS NOT NULL`).bind(photoId).first<{ preview_r2_key: string }>();
  if (row?.preview_r2_key !== `previews/${photoId}.webp`) throw new ApiError(404, "not_found", "Prévia não encontrada.");
  const object = await env.PHOTOS.get(row.preview_r2_key);
  if (!object) throw new ApiError(404, "not_found", "Prévia não encontrada.");
  // Sem cache compartilhado: ocultação deve bloquear a próxima requisição.
  return new Response(object.body, { headers: {
    "Content-Type": "image/webp", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}

export async function handleRequest(request: Request, env: Env, authenticate = authenticatePhotographer): Promise<Response> {
  try {
    const path = new URL(request.url).pathname;
    if (path === "/api/fotoviva/studio/photos/upload-intent" && request.method === "POST") return await uploadIntent(request, env, authenticate);
    if (path === "/api/fotoviva/studio/photos/process" && request.method === "POST") return await processPhoto(request, env, authenticate);
    const match = path.match(/^\/api\/fotoviva\/previews\/([^/]+)$/);
    if (match && request.method === "GET") return await preview(match[1], env);
    return json({ error: "Rota não encontrada.", code: "not_found" }, 404);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: "Dados inválidos.", code: "invalid_input" }, 400);
    if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
    // Não registrar URLs assinadas, JWTs ou conteúdo das imagens.
    console.error("photo_request_failed");
    return json({ error: "Serviço temporariamente indisponível.", code: "temporarily_unavailable" }, 503);
  }
}
