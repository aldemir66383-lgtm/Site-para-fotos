import exifr from "exifr";
import type { ExifMetadata } from "../photos/contracts.js";

const stringValue = (value: unknown, limit = 120): string | null =>
  typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, limit) || null : null;
const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export function normalizeExif(raw: Record<string, unknown> = {}): ExifMetadata {
  const dateTimeOriginal = stringValue(raw.DateTimeOriginal, 32);
  const subSec = stringValue(raw.SubSecTimeOriginal, 9);
  const offset = stringValue(raw.OffsetTimeOriginal, 6);
  const subSecTimeOriginal = subSec && /^\d{1,9}$/.test(subSec) ? subSec : null;
  const offsetTimeOriginal = offset && /^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset)
    && (offset.slice(1, 3) !== "14" || offset.slice(4) === "00") ? offset : null;
  let capturedAt: string | null = null;
  let capturedAtUtc: string | null = null;
  const match = dateTimeOriginal?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
    const check = new Date(`${local}Z`);
    // Date normaliza datas impossíveis: exigir igualdade também do dia/mês.
    if (Number.isFinite(check.getTime()) && check.toISOString().slice(0, 19) === local) {
      capturedAt = `${local}${subSecTimeOriginal ? `.${subSecTimeOriginal}` : ""}${offsetTimeOriginal ?? ""}`;
      if (offsetTimeOriginal) capturedAtUtc = new Date(capturedAt).toISOString();
    }
  }
  const orientation = numberValue(raw.Orientation);
  return {
    dateTimeOriginal, subSecTimeOriginal, offsetTimeOriginal, capturedAt, capturedAtUtc,
    cameraMake: stringValue(raw.Make), cameraModel: stringValue(raw.Model), lensModel: stringValue(raw.LensModel),
    exposureTime: numberValue(raw.ExposureTime), fNumber: numberValue(raw.FNumber),
    iso: numberValue(raw.ISO), focalLength: numberValue(raw.FocalLength),
    orientation: orientation && Number.isInteger(orientation) && orientation <= 8 ? orientation : null,
  };
}

export async function extractExif(bytes: Buffer): Promise<ExifMetadata> {
  // Sem GPS, número de série ou conversão implícita da hora da câmera para UTC.
  const raw = await exifr.parse(bytes, {
    pick: ["DateTimeOriginal", "SubSecTimeOriginal", "OffsetTimeOriginal", "Make", "Model", "LensModel",
      "ExposureTime", "FNumber", "ISO", "FocalLength", "Orientation"],
    reviveValues: false, translateValues: false,
  });
  return normalizeExif(raw ?? {});
}
