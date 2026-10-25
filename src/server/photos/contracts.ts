import { z } from "zod";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
export const UPLOAD_TTL_SECONDS = 600;
export const MAX_ATTEMPTS = 5;
export const WATERMARK = "AIRE PHOTOS  PRÉVIA NÃO AUTORIZADA";

export const bibSchema = z.object({
  bibNumber: z.string().regex(/^\d{1,5}$/),
  confidence: z.number().min(0).max(1),
});

export const exifSchema = z.object({
  dateTimeOriginal: z.string().max(32).nullable(),
  subSecTimeOriginal: z.string().max(9).nullable(),
  offsetTimeOriginal: z.string().max(6).nullable(),
  capturedAt: z.string().max(48).nullable(),
  capturedAtUtc: z.string().max(32).nullable(),
  cameraMake: z.string().max(120).nullable(),
  cameraModel: z.string().max(120).nullable(),
  lensModel: z.string().max(120).nullable(),
  exposureTime: z.number().finite().nonnegative().nullable(),
  fNumber: z.number().finite().nonnegative().nullable(),
  iso: z.number().finite().nonnegative().nullable(),
  focalLength: z.number().finite().nonnegative().nullable(),
  orientation: z.number().int().min(1).max(8).nullable(),
});

export const mediaResultSchema = z.object({
  approved: z.literal(true),
  pipelineVersion: z.literal("fotoviva-media-v1"),
  previewBase64: z.string().min(16).max(Math.ceil(MAX_PREVIEW_BYTES / 3) * 4),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
  previewWidth: z.number().int().positive().max(1600),
  previewHeight: z.number().int().positive().max(1600),
  exif: exifSchema,
  bibs: z.array(bibSchema).max(100),
});

export type ExifMetadata = z.infer<typeof exifSchema>;
export type MediaResult = z.infer<typeof mediaResultSchema>;
export type Bib = z.infer<typeof bibSchema>;
export interface PhotoJob { photoId: string }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function readLimited(stream: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) throw new ApiError(400, "invalid_input", "Corpo vazio.");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new ApiError(413, "payload_too_large", "Arquivo ou resposta acima do limite.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
