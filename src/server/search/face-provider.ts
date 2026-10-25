import { z } from "zod";
import { ApiError, readLimited } from "../photos/contracts.js";
import type { Env } from "../photos/env.js";

export interface Face {
  vector: Float32Array;
  quality: number;
}
export type EmbedFaces = (
  image: Uint8Array<ArrayBuffer>,
  contentType: string,
  signal?: AbortSignal,
) => Promise<Face[]>;
export interface FaceConfig {
  model: string;
  dimensions: number;
  medium: number;
  high: number;
}

export function faceConfig(env: Env): FaceConfig {
  const dimensions = Number(env.FACE_EMBEDDING_DIMENSIONS),
    medium = Number(env.FACE_MEDIUM_THRESHOLD),
    high = Number(env.FACE_HIGH_THRESHOLD);
  if (
    !env.FACE_MODEL_VERSION ||
    !Number.isInteger(dimensions) ||
    dimensions < 64 ||
    dimensions > 2048 ||
    !env.FACE_MEDIUM_THRESHOLD ||
    !env.FACE_HIGH_THRESHOLD ||
    !Number.isFinite(medium) ||
    !Number.isFinite(high) ||
    medium < 0 ||
    high <= medium ||
    high > 1 ||
    !env.FACE_INDEX_ENCRYPTION_KEY ||
    !env.FACE_IP_HASH_SECRET
  ) {
    throw new ApiError(
      503,
      "face_not_configured",
      "Busca facial ainda não configurada.",
    );
  }
  return { model: env.FACE_MODEL_VERSION, dimensions, medium, high };
}

export function normalizeVector(
  values: ArrayLike<number>,
  dimensions: number,
): Float32Array {
  if (values.length !== dimensions)
    throw new Error("Incompatible face dimensions");
  const result = new Float32Array(dimensions);
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    if (!Number.isFinite(values[i])) {
      result.fill(0);
      throw new Error("Invalid face vector");
    }
    result[i] = values[i];
    norm += result[i] * result[i];
  }
  if (!Number.isFinite(norm) || norm < 1e-12) {
    result.fill(0);
    throw new Error("Empty face vector");
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dimensions; i++) result[i] /= norm;
  return result;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error("Incompatible face dimensions");
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (!aa || !bb) throw new Error("Empty face vector");
  return Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb)));
}

export function httpFaceProvider(env: Env): EmbedFaces {
  const config = faceConfig(env);
  if (!env.FACE_EMBEDDINGS_URL || !env.FACE_EMBEDDINGS_TOKEN)
    throw new ApiError(
      503,
      "face_not_configured",
      "Processador facial indisponível.",
    );
  const url = new URL(env.FACE_EMBEDDINGS_URL);
  if (url.protocol !== "https:")
    throw new Error("Face endpoint must use HTTPS");
  return async (image, contentType, signal) => {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(25_000),
        ...(signal ? [signal] : []),
      ]),
      headers: {
        Authorization: `Bearer ${env.FACE_EMBEDDINGS_TOKEN}`,
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
      body: image,
    });
    if (response.status === 422) {
      await response.body?.cancel();
      throw new ApiError(
        422,
        "image_quality",
        "Envie uma imagem nítida com o rosto de frente.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(
        503,
        "face_unavailable",
        "Processador facial temporariamente indisponível.",
      );
    }
    const schema = z.object({
      modelVersion: z.literal(config.model),
      faces: z
        .array(
          z.object({
            quality: z.number().min(0).max(1),
            vector: z.array(z.number().finite()).length(config.dimensions),
          }),
        )
        .max(30),
    });
    const bytes = await readLimited(response.body, 2 * 1024 * 1024);
    const faces: Face[] = [];
    let parsed: z.infer<typeof schema> | undefined;
    try {
      parsed = schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      for (const face of parsed.faces)
        faces.push({
          quality: face.quality,
          vector: normalizeVector(face.vector, config.dimensions),
        });
      return faces;
    } catch {
      for (const face of faces) face.vector.fill(0);
      throw new ApiError(
        503,
        "face_invalid_response",
        "Resposta incompatível do processador facial.",
      );
    } finally {
      bytes.fill(0);
      for (const face of parsed?.faces ?? []) face.vector.fill(0);
    }
  };
}
