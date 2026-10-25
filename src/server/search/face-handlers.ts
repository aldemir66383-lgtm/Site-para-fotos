import { z } from "zod";
import {
  authenticateSession,
  type AuthenticateSession,
} from "../auth/session.js";
import { ApiError, readLimited } from "../photos/contracts.js";
import type { Env } from "../photos/env.js";
import { json } from "../photos/handlers.js";
import { eligibleFaceAlbum, indexPhotoFaces } from "./face-index.js";
import {
  FACE_DISCLAIMER,
  FACE_POLICY_VERSION,
  decryptFaceVector,
  privacyHash,
  recordFaceConsent,
} from "./face-privacy.js";
import {
  cosine,
  faceConfig,
  httpFaceProvider,
  type EmbedFaces,
  type Face,
} from "./face-provider.js";

const MAX_SELFIE_BYTES = 8 * 1024 * 1024;
const idSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const consentSchema = z
  .object({
    policyVersion: z.literal(FACE_POLICY_VERSION),
    accepted: z.literal(true),
    adult: z.literal(true),
    ownImage: z.literal(true),
  })
  .strict();
const resultSchema = z
  .array(
    z.object({ photoId: z.string(), relevance: z.enum(["alta", "media"]) }),
  )
  .max(50);
interface Match {
  photoId: string;
  score: number;
}

function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10")
    return "image/png";
  const text = new TextDecoder();
  if (
    text.decode(bytes.slice(0, 4)) === "RIFF" &&
    text.decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

async function createSession(
  request: Request,
  env: Env,
  subject: string,
  provider?: EmbedFaces,
): Promise<Response> {
  const config = faceConfig(env);
  if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data;"))
    throw new ApiError(
      415,
      "unsupported_media_type",
      "Envie a selfie como multipart/form-data.",
    );
  const bytes = await readLimited(request.body, MAX_SELFIE_BYTES + 64 * 1024);
  let image: Uint8Array<ArrayBuffer> | undefined;
  let faces: Face[] = [];
  try {
    let form: FormData;
    try {
      form = await new Response(bytes, {
        headers: { "Content-Type": request.headers.get("Content-Type")! },
      }).formData();
    } catch {
      throw new ApiError(400, "invalid_input", "Formulário inválido.");
    }
    const albumId = idSchema.parse(form.get("albumId"));
    if (form.get("mode") !== "selfie")
      throw new ApiError(400, "invalid_input", "Modo de busca inválido.");
    let consent: unknown;
    try {
      consent = JSON.parse(String(form.get("consent")));
    } catch {
      /* rejected below */
    }
    if (!consentSchema.safeParse(consent).success)
      throw new ApiError(
        400,
        "consent_required",
        "Aceite o consentimento específico vigente e confirme que a selfie é sua e que você tem 18 anos ou mais.",
      );
    const file = form.get("image");
    if (!file || typeof file === "string" || !file.size)
      throw new ApiError(400, "invalid_input", "Envie uma selfie.");
    if (file.size > MAX_SELFIE_BYTES)
      throw new ApiError(
        413,
        "payload_too_large",
        "A selfie deve ter até 8 MB.",
      );
    image = new Uint8Array(await file.arrayBuffer());
    const contentType = imageType(image);
    if (!contentType || contentType !== file.type)
      throw new ApiError(
        415,
        "unsupported_media_type",
        "Envie JPEG, PNG ou WebP válido.",
      );
    await eligibleFaceAlbum(env, albumId);
    const indexed = await env.DB.prepare(
      `SELECT photo_id FROM photo_face_index WHERE album_id=? AND state='indexed'
      AND model_version=? AND expires_at_ms>? LIMIT 1`,
    )
      .bind(albumId, config.model, Date.now())
      .first();
    if (!indexed)
      throw new ApiError(
        409,
        "album_not_indexed",
        "O índice facial deste álbum ainda está sendo preparado.",
      );
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip))
      throw new ApiError(
        400,
        "ip_unavailable",
        "Não foi possível registrar o consentimento desta conexão.",
      );
    const receipt = await recordFaceConsent(
      env,
      subject,
      albumId,
      ip,
      Date.now(),
    );
    faces = await (provider ?? httpFaceProvider(env))(
      image,
      contentType,
      request.signal,
    );
    if (faces.length === 0)
      throw new ApiError(
        422,
        "no_face",
        "Nenhum rosto encontrado. Envie uma selfie nítida.",
      );
    if (faces.length !== 1)
      throw new ApiError(
        422,
        "multiple_faces",
        "Envie uma selfie com apenas o seu rosto.",
      );
    if (faces[0].quality < 0.6)
      throw new ApiError(
        422,
        "image_quality",
        "Envie uma selfie nítida, com o rosto de frente.",
      );
    const matches = new Map<string, number>();
    let lastPhoto = "",
      lastFace = -1,
      scanned = 0;
    while (true) {
      request.signal.throwIfAborted();
      const now = Date.now();
      const rows = await env.DB.prepare(
        `SELECT e.photo_id,e.face_index,e.ciphertext FROM photo_face_embeddings e
        JOIN face_search_photos p ON p.id=e.photo_id AND p.album_id=e.album_id
        JOIN photo_face_index f ON f.photo_id=e.photo_id JOIN albums a ON a.id=e.album_id
        WHERE e.album_id=? AND e.model_version=? AND f.model_version=e.model_version AND f.state='indexed'
        AND e.expires_at_ms>? AND f.expires_at_ms>? AND a.face_index_expires_at_ms>?
        AND (e.photo_id>? OR (e.photo_id=? AND e.face_index>?)) ORDER BY e.photo_id,e.face_index LIMIT 100`,
      )
        .bind(
          albumId,
          config.model,
          now,
          now,
          now,
          lastPhoto,
          lastPhoto,
          lastFace,
        )
        .all<{ photo_id: string; face_index: number; ciphertext: string }>();
      if (!rows.results.length) break;
      for (const row of rows.results) {
        if (++scanned > 30000)
          throw new ApiError(
            503,
            "face_index_limit",
            "Álbum acima do limite atual de busca facial.",
          );
        const vector = await decryptFaceVector(
          env.FACE_INDEX_ENCRYPTION_KEY!,
          `${albumId}:${row.photo_id}:${config.model}:${row.face_index}`,
          row.ciphertext,
          config.dimensions,
        );
        try {
          const score = cosine(faces[0].vector, vector);
          if (score >= config.medium)
            matches.set(
              row.photo_id,
              Math.max(matches.get(row.photo_id) ?? -1, score),
            );
        } finally {
          vector.fill(0);
        }
        lastPhoto = row.photo_id;
        lastFace = row.face_index;
      }
      const top = [...matches]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 50);
      matches.clear();
      for (const [id, score] of top) matches.set(id, score);
    }
    const ranked: Match[] = [...matches]
      .map(([photoId, score]) => ({ photoId, score }))
      .sort((a, b) => b.score - a.score || a.photoId.localeCompare(b.photoId));
    const results = ranked.map((row) => ({
      photoId: row.photoId,
      relevance:
        row.score >= config.high ? ("alta" as const) : ("media" as const),
    }));
    const id = crypto.randomUUID(),
      now = Date.now();
    // Recheck after inference: publication/consent may have changed while the provider was running.
    await eligibleFaceAlbum(env, albumId, now);
    await env.DB.prepare(
      `INSERT INTO search_sessions(id,owner_subject_hash,album_id,consent_id,mode,results_json,created_at_ms,expires_at_ms)
      VALUES (?,?,?,?,'selfie',?,?,?)`,
    )
      .bind(
        id,
        receipt.subjectHash,
        albumId,
        receipt.id,
        JSON.stringify(results),
        now,
        now + 30 * 60_000,
      )
      .run();
    return await sessionResponse(env, id, receipt.subjectHash);
  } finally {
    bytes.fill(0);
    image?.fill(0);
    for (const face of faces) face.vector.fill(0);
  }
}

async function sessionResponse(
  env: Env,
  id: string,
  ownerHash: string,
): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT * FROM search_sessions WHERE id=? AND owner_subject_hash=? AND expires_at_ms>?",
  )
    .bind(id, ownerHash, Date.now())
    .first<{ album_id: string; results_json: string; expires_at_ms: number }>();
  if (!row)
    throw new ApiError(404, "not_found", "Sessão de busca não encontrada.");
  await eligibleFaceAlbum(env, row.album_id);
  const results = resultSchema.parse(JSON.parse(row.results_json));
  const visible = results.length
    ? await env.DB.prepare(
        `SELECT id,width,height FROM face_search_photos WHERE album_id=? AND id IN (${results.map(() => "?").join(",")})`,
      )
        .bind(row.album_id, ...results.map((r) => r.photoId))
        .all<{ id: string; width: number; height: number }>()
    : { results: [] };
  const byId = new Map(visible.results.map((r) => [r.id, r]));
  return json({
    id,
    mode: "selfie",
    status: "done",
    expiresAt: new Date(row.expires_at_ms).toISOString(),
    disclaimer: FACE_DISCLAIMER,
    results: results
      .filter((r) => byId.has(r.photoId))
      .map((r) => ({
        ...r,
        albumId: row.album_id,
        previewUrl: `/api/fotoviva/previews/${r.photoId}`,
        width: byId.get(r.photoId)!.width,
        height: byId.get(r.photoId)!.height,
      })),
  });
}

export async function handleFaceRequest(
  request: Request,
  env: Env,
  authenticate: AuthenticateSession = authenticateSession,
  provider?: EmbedFaces,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const sessions = path === "/api/fotoviva/search/sessions";
  const session = path.match(
    /^\/api\/fotoviva\/search\/sessions\/([a-f0-9-]{36})$/,
  );
  const index = path.match(
    /^\/api\/fotoviva\/studio\/photos\/([a-zA-Z0-9_-]{1,100})\/face-index$/,
  );
  if (!sessions && !session && !index) return null;
  try {
    const user = await authenticate(request, env);
    if (!["buyer", "photographer"].includes(user.role))
      throw new ApiError(403, "forbidden", "Sessão sem acesso à busca.");
    if (session && request.method === "DELETE") {
      const hash = await privacyHash(
        env.FACE_IP_HASH_SECRET ?? "",
        `subject:${user.id}`,
      );
      const row = await env.DB.prepare(
        "SELECT consent_id FROM search_sessions WHERE id=? AND owner_subject_hash=?",
      )
        .bind(session[1], hash)
        .first<{ consent_id: string }>();
      if (!row)
        throw new ApiError(404, "not_found", "Sessão de busca não encontrada.");
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE face_search_consents SET revoked_at_ms=? WHERE id=?",
        ).bind(Date.now(), row.consent_id),
        env.DB.prepare(
          "DELETE FROM search_sessions WHERE id=? AND owner_subject_hash=?",
        ).bind(session[1], hash),
      ]);
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (env.FV_FACE_SEARCH !== "on")
      throw new ApiError(
        403,
        "feature_disabled",
        "Busca por selfie indisponível.",
      );
    if (sessions && request.method === "POST")
      return await createSession(request, env, user.id, provider);
    if (session && request.method === "GET")
      return await sessionResponse(
        env,
        session[1],
        await privacyHash(env.FACE_IP_HASH_SECRET ?? "", `subject:${user.id}`),
      );
    if (index && request.method === "POST") {
      if (user.role !== "photographer")
        throw new ApiError(
          403,
          "photographer_required",
          "Acesso restrito a fotógrafos.",
        );
      const owned = await env.DB.prepare(
        `SELECT p.id FROM photos p JOIN albums a ON a.id=p.album_id
        WHERE p.id=? AND p.photographer_id=? AND a.photographer_id=?`,
      )
        .bind(index[1], user.id, user.id)
        .first();
      if (!owned) throw new ApiError(404, "not_found", "Foto não encontrada.");
      await indexPhotoFaces(env, index[1], provider);
      const result = await env.DB.prepare(
        "SELECT state FROM photo_face_index WHERE photo_id=?",
      )
        .bind(index[1])
        .first<{ state: string }>();
      if (!result)
        throw new ApiError(
          409,
          "album_not_eligible",
          "Álbum não habilitado para indexação facial.",
        );
      return json({ photoId: index[1], status: result.state });
    }
    return json(
      { error: "Método não permitido.", code: "method_not_allowed" },
      405,
    );
  } catch (error) {
    if (error instanceof ApiError)
      return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof z.ZodError)
      return json({ error: "Dados inválidos.", code: "invalid_input" }, 400);
    console.error("face_request_failed");
    return json(
      {
        error: "Busca facial temporariamente indisponível.",
        code: "temporarily_unavailable",
      },
      503,
    );
  }
}
