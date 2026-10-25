import sharp, { type OutputInfo } from "sharp";
import { ApiError, MAX_PREVIEW_BYTES, MAX_UPLOAD_BYTES, WATERMARK, mediaResultSchema, type Bib, type MediaResult } from "../photos/contracts.js";
import { extractExif } from "./exif.js";
import { recognizeBibs } from "./ocr.js";

sharp.cache(false);
sharp.concurrency(1);
const INPUT_OPTIONS = { limitInputPixels: 80_000_000, failOn: "warning" as const };

export function watermarkSvg(width: number, height: number): Buffer {
  const font = Math.max(10, Math.min(24, Math.round(Math.min(width, height) / 18)));
  const tileWidth = font * 23, tileHeight = font * 5;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><pattern id="wm" width="${tileWidth}" height="${tileHeight}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
      <text x="8" y="${font * 2}" font-family="DejaVu Sans, sans-serif" font-size="${font}" font-weight="bold"
        textLength="${tileWidth - 16}" lengthAdjust="spacingAndGlyphs" fill="white" fill-opacity="0.62"
        stroke="black" stroke-opacity="0.5" stroke-width="1" paint-order="stroke">${WATERMARK}</text>
    </pattern></defs><rect width="100%" height="100%" fill="url(#wm)"/></svg>`);
}

export async function processImage(original: Buffer, ocr: (jpeg: Buffer) => Promise<Bib[]> = recognizeBibs): Promise<MediaResult> {
  if (original.length > MAX_UPLOAD_BYTES) throw new ApiError(413, "payload_too_large", "JPEG acima de 20 MB.");
  if (original[0] !== 0xff || original[1] !== 0xd8 || original[2] !== 0xff) throw new ApiError(422, "invalid_jpeg", "JPEG inválido.");
  let base: { data: Buffer; info: OutputInfo };
  let width: number, height: number;
  let exif: Awaited<ReturnType<typeof extractExif>>;
  try {
    const metadata = await sharp(original, INPUT_OPTIONS).metadata();
    if (metadata.format !== "jpeg" || !metadata.width || !metadata.height) throw new Error("Not a JPEG");
    const swap = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
    width = swap ? metadata.height : metadata.width;
    height = swap ? metadata.width : metadata.height;
    if (Math.min(width, height) < 160) throw new Error("Image too small");
    exif = await extractExif(original);
    // Decodificação completa detecta JPEG truncado; sem preservar metadados na prévia.
    base = await sharp(original, INPUT_OPTIONS).rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
  } catch { throw new ApiError(422, "image_unreadable", "JPEG inválido, muito pequeno ou acima de 80 megapixels."); }

  // OCR antes da marca d'água. Falha do provedor é retentável, nunca sucesso vazio simulado.
  const bibs = await ocr(base.data);
  const preview = await sharp(base.data).composite([{
    input: watermarkSvg(base.info.width, base.info.height), blend: "over",
  }]).webp({ quality: 72, effort: 4 }).toBuffer();
  if (preview.length > MAX_PREVIEW_BYTES) throw new Error("Preview exceeds limit");
  return mediaResultSchema.parse({
    approved: true, pipelineVersion: "fotoviva-media-v1", previewBase64: preview.toString("base64"),
    width, height, previewWidth: base.info.width, previewHeight: base.info.height, exif, bibs,
  });
}
