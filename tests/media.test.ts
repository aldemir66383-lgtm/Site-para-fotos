import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeExif } from "../src/server/media/exif.js";
import { extractBibs, type VisionAnnotation } from "../src/server/media/ocr.js";
import { processImage, watermarkSvg } from "../src/server/media/processor.js";
import { WATERMARK } from "../src/server/photos/contracts.js";
import { createMediaServer } from "../src/server/media/service.js";

describe("EXIF", () => {
  it("preserva frações de segundo e offset sem assumir UTC para horário local", () => {
    const raw = { DateTimeOriginal: "2026:10:24 08:32:10", SubSecTimeOriginal: "123456", OffsetTimeOriginal: "-03:00", Make: "Canon", Model: "R5" };
    expect(normalizeExif(raw)).toMatchObject({ capturedAt: "2026-10-24T08:32:10.123456-03:00", capturedAtUtc: "2026-10-24T11:32:10.123Z", cameraModel: "R5" });
    expect(normalizeExif({ ...raw, OffsetTimeOriginal: undefined })).toMatchObject({ capturedAt: "2026-10-24T08:32:10.123456", capturedAtUtc: null });
    expect(normalizeExif({ DateTimeOriginal: "2026:02:30 08:32:10" }).capturedAt).toBeNull();
    expect(normalizeExif().capturedAt).toBeNull();
  });
});

describe("OCR com filtro espacial", () => {
  function word(text: string, x = 300, y = 400, confidence = 0.9) {
    return { symbols: [...text].map(text => ({ text })), confidence,
      boundingBox: { vertices: [{ x, y }, { x: x + 60, y }, { x: x + 60, y: y + 30 }, { x, y: y + 30 }] } };
  }
  const person = { name: "Person", score: 0.95, boundingPoly: { normalizedVertices: [{ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.1 }, { x: 0.6, y: 0.9 }, { x: 0.1, y: 0.9 }] } };
  it("aceita de 1 a 5 dígitos no dorsal e elimina duplicatas, letras, fundo e baixa confiança", () => {
    const annotation: VisionAnnotation = {
      localizedObjectAnnotations: [person],
      fullTextAnnotation: { pages: [{ width: 1000, height: 1000, blocks: [{ paragraphs: [{ words: [
        word("00123"), word("00123", 300, 400, 0.8), word("7"), word("123456"), word("A12"),
        word("999", 850), word("12", 300, 400, 0.4),
      ] }] }] }] },
    };
    expect(extractBibs(annotation)).toEqual([{ bibNumber: "00123", confidence: 0.9 }, { bibNumber: "7", confidence: 0.9 }]);
    expect(extractBibs({ ...annotation, localizedObjectAnnotations: [] })).toEqual([]);
    expect(extractBibs({ ...annotation, localizedObjectAnnotations: [{ ...person, name: "Bicycle" }] })).toHaveLength(2);
    expect(() => extractBibs({ error: { code: 8 } })).toThrow();
  });
});

describe("prévia protegida", () => {
  it("decodifica JPEG real, extrai EXIF, orienta, reduz e grava a marca nos pixels sem metadados privados", async () => {
    const jpeg = await sharp({ create: { width: 2200, height: 1400, channels: 3, background: "#5a8275" } })
      .withExif({ IFD0: { Make: "Canon", Model: "R5", Orientation: "6" },
        IFD2: { DateTimeOriginal: "2026:10:24 08:32:10", SubSecTimeOriginal: "123", OffsetTimeOriginal: "-03:00" } })
      .jpeg().toBuffer();
    const result = await processImage(jpeg, async () => []);
    expect(result.exif).toMatchObject({ dateTimeOriginal: "2026:10:24 08:32:10", cameraModel: "R5", capturedAt: "2026-10-24T08:32:10.123-03:00" });
    const preview = Buffer.from(result.previewBase64, "base64");
    const metadata = await sharp(preview).metadata();
    expect(metadata.format).toBe("webp");
    expect(Math.max(metadata.width!, metadata.height!)).toBe(1600);
    expect(metadata.exif).toBeUndefined();
    const stats = await sharp(preview).stats();
    expect(stats.channels.some(channel => channel.stdev > 10)).toBe(true);
    expect(watermarkSvg(800, 600).toString()).toContain(WATERMARK);
  });

  it("recusa arquivo disfarçado ou truncado e propaga falhas do OCR", async () => {
    await expect(processImage(Buffer.from("fake.jpg"), async () => [])).rejects.toMatchObject({ status: 422 });
    const jpeg = await sharp({ create: { width: 600, height: 400, channels: 3, background: "white" } }).jpeg().toBuffer();
    await expect(processImage(jpeg.subarray(0, jpeg.length / 2), async () => [])).rejects.toMatchObject({ status: 422 });
    await expect(processImage(jpeg, async () => { throw new Error("OCR down"); })).rejects.toThrow("OCR down");
  });

  it("protege o serviço de mídia com segredo e limite real de bytes", async () => {
    const token = "test-secret".repeat(4);
    const server = createMediaServer(token);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/process`;
    try {
      expect((await fetch(url, { method: "POST", body: "x" })).status).toBe(401);
      expect((await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" }, body: "not a jpeg" })).status).toBe(422);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
