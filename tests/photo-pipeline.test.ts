import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { handleRequest } from "../src/server/photos/handlers.js";
import { MAX_UPLOAD_BYTES, type MediaResult } from "../src/server/photos/contracts.js";
import { processJob, recoverPhotos } from "../src/server/photos/processing.js";
import { processImage } from "../src/server/media/processor.js";
import { owner, post, testEnvironment } from "./helpers.js";

let jpeg: Buffer;
let media: MediaResult;
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#388c55" } }).jpeg().toBuffer();
  media = await processImage(jpeg, async () => [{ bibNumber: "00123", confidence: 0.92 }]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function staged(context: ReturnType<typeof testEnvironment>) {
  const response = await handleRequest(post("upload-intent", {
    albumId: "album-1", filename: "foto.jpg", contentType: "image/jpeg", size: jpeg.length,
  }), context.env, owner);
  expect(response.status).toBe(201);
  const intent = await response.json() as { photoId: string; uploadUrl: string };
  const row = context.sqlite.prepare("SELECT staging_key FROM photo_uploads WHERE photo_id = ?").get(intent.photoId) as { staging_key: string };
  await context.bucket.put(row.staging_key, jpeg, { httpMetadata: { contentType: "image/jpeg" } });
  return { ...intent, stagingKey: row.staging_key };
}

describe("upload direto e isolamento", () => {
  it("exige autenticação, papel de fotógrafo e posse do álbum", async () => {
    const context = testEnvironment();
    expect((await handleRequest(post("upload-intent", {}), context.env)).status).toBe(401);
    const response = await handleRequest(post("upload-intent", {
      albumId: "album-1", filename: "x.jpg", size: 100, contentType: "image/jpeg",
    }), context.env, async () => ({ id: "intruder" }));
    expect(response.status).toBe(404);
    expect(context.sqlite.prepare("SELECT count(*) AS n FROM photos").get()?.n).toBe(0);
  });

  it("assina tamanho e MIME e mantém a foto como draft", async () => {
    const context = testEnvironment();
    const intent = await staged(context);
    const url = new URL(intent.uploadUrl);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.pathname).toContain(`/originals/pending/${intent.photoId}/`);
    expect(context.sqlite.prepare("SELECT status, preview_url FROM photos").get()).toMatchObject({ status: "draft", preview_url: "" });
    expect((await handleRequest(new Request(`https://fotoviva.test/api/fotoviva/previews/${intent.photoId}`), context.env)).status).toBe(404);
  });

  it("rejeita excesso de tamanho, PNG e campos de autorização forjados", async () => {
    const { env } = testEnvironment();
    const base = { albumId: "album-1", filename: "x.jpg", size: 100, contentType: "image/jpeg" };
    expect((await handleRequest(post("upload-intent", { ...base, size: MAX_UPLOAD_BYTES + 1 }), env, owner)).status).toBe(413);
    expect((await handleRequest(post("upload-intent", { ...base, filename: "x.png", contentType: "image/png" }), env, owner)).status).toBe(400);
    expect((await handleRequest(post("upload-intent", { ...base, photographerId: "owner", status: "verified" }), env, owner)).status).toBe(400);
  });

  it("não aceita processar foto alheia, upload ausente ou tamanho divergente", async () => {
    const context = testEnvironment();
    const intent = await staged(context);
    expect((await handleRequest(post("process", { photoId: intent.photoId }), context.env, async () => ({ id: "intruder" }))).status).toBe(404);
    context.objects.delete(intent.stagingKey);
    expect((await handleRequest(post("process", { photoId: intent.photoId }), context.env, owner)).status).toBe(409);
    await context.bucket.put(intent.stagingKey, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/jpeg" } });
    expect((await handleRequest(post("process", { photoId: intent.photoId }), context.env, owner)).status).toBe(413);
    expect(context.queue.send).not.toHaveBeenCalled();
  });
});

describe("processamento com publicação atômica", () => {
  it("persiste EXIF e dorsais, protege o original contra replay e serve apenas a prévia", async () => {
    const context = testEnvironment();
    const intent = await staged(context);
    expect((await handleRequest(post("process", { photoId: intent.photoId }), context.env, owner)).status).toBe(202);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(media)));
    await Promise.all([processJob({ photoId: intent.photoId }, context.env), processJob({ photoId: intent.photoId }, context.env)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(context.sqlite.prepare("SELECT status, original_r2_key FROM photos").get()).toMatchObject({
      status: "verified", original_r2_key: `originals/${intent.photoId}.jpg`,
    });
    expect(context.sqlite.prepare("SELECT bib_number, confidence FROM photo_bibs").all()).toEqual([{ bib_number: "00123", confidence: 0.92 }]);
    expect(context.sqlite.prepare("SELECT count(*) AS n FROM photo_exif").get()?.n).toBe(1);
    const original = context.objects.get(`originals/${intent.photoId}.jpg`)!.bytes;
    await context.bucket.put(intent.stagingKey, new Uint8Array([1, 2, 3]));
    await processJob({ photoId: intent.photoId }, context.env);
    expect(context.objects.get(`originals/${intent.photoId}.jpg`)!.bytes).toEqual(original);
    const response = await handleRequest(new Request(`https://fotoviva.test/api/fotoviva/previews/${intent.photoId}`), context.env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect((await handleRequest(post("process", { photoId: intent.photoId }), context.env, owner)).status).toBe(200);
    expect((await handleRequest(new Request(`https://fotoviva.test/originals/${intent.photoId}.jpg`), context.env)).status).toBe(404);
    context.sqlite.prepare("UPDATE photos SET status = 'hidden'").run();
    expect((await handleRequest(new Request(`https://fotoviva.test/api/fotoviva/previews/${intent.photoId}`), context.env)).status).toBe(404);
    expect(await (await handleRequest(post("process", { photoId: intent.photoId }), context.env, owner)).json()).toEqual({ photoId: intent.photoId, status: "hidden" });
  });

  it("detecta substituição do staging entre HEAD e leitura", async () => {
    const context = testEnvironment();
    const intent = await staged(context);
    await handleRequest(post("process", { photoId: intent.photoId }), context.env, owner);
    await context.bucket.put(intent.stagingKey, jpeg, { httpMetadata: { contentType: "image/jpeg" } });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await processJob({ photoId: intent.photoId }, context.env);
    expect(fetcher).not.toHaveBeenCalled();
    expect(context.sqlite.prepare("SELECT state, error_code FROM photo_uploads").get()).toMatchObject({ state: "failed", error_code: "source_changed" });
    expect(context.sqlite.prepare("SELECT status FROM photos").get()?.status).toBe("draft");
  });

  it("retenta indisponibilidade do OCR e não publica prévia incompleta", async () => {
    const context = testEnvironment();
    const intent = await staged(context);
    await handleRequest(post("process", { photoId: intent.photoId }), context.env, owner);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    for (let attempt = 1; attempt < 5; attempt++) await expect(processJob({ photoId: intent.photoId }, context.env)).rejects.toThrow();
    await processJob({ photoId: intent.photoId }, context.env);
    expect(context.sqlite.prepare("SELECT state, attempts FROM photo_uploads").get()).toMatchObject({ state: "failed", attempts: 5 });
    expect(context.sqlite.prepare("SELECT status FROM photos").get()?.status).toBe("draft");
    expect(context.objects.has(`previews/${intent.photoId}.webp`)).toBe(false);
  });

  it("recupera publicação perdida na fila e limpa staging após expiração", async () => {
    const context = testEnvironment();
    const intent = await staged(context);
    context.queue.send.mockRejectedValueOnce(new Error("queue down"));
    expect((await handleRequest(post("process", { photoId: intent.photoId }), context.env, owner)).status).toBe(503);
    context.sqlite.prepare("UPDATE photo_uploads SET updated_at = ?").run(Date.now() - 180_000);
    await recoverPhotos(context.env);
    expect(context.queue.sendBatch).toHaveBeenCalledWith([{ body: { photoId: intent.photoId } }]);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(media)));
    await processJob({ photoId: intent.photoId }, context.env);
    context.sqlite.prepare("UPDATE photo_uploads SET upload_expires_at = 0").run();
    await recoverPhotos(context.env);
    expect(context.objects.has(intent.stagingKey)).toBe(false);
    expect(context.objects.has(`originals/${intent.photoId}.jpg`)).toBe(true);
  });

  it("mantém draft se a gravação da prévia no R2 falhar", async () => {
    const context = testEnvironment();
    const intent = await staged(context);
    await handleRequest(post("process", { photoId: intent.photoId }), context.env, owner);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(media)));
    context.bucket.put.mockImplementationOnce(async () => ({} as never)).mockRejectedValueOnce(new Error("R2 down"));
    await expect(processJob({ photoId: intent.photoId }, context.env)).rejects.toThrow();
    expect(context.sqlite.prepare("SELECT status FROM photos").get()?.status).toBe("draft");
    expect(context.sqlite.prepare("SELECT count(*) AS n FROM photo_bibs").get()?.n).toBe(0);
  });

  it("bloqueia verified sem processamento e restringe números de peito no D1", async () => {
    const context = testEnvironment();
    const intent = await staged(context);
    expect(() => context.sqlite.prepare("UPDATE photos SET status = 'verified'").run()).toThrow(/approved media/);
    expect(() => context.sqlite.prepare("INSERT INTO photos (id, album_id, photographer_id, preview_url, original_r2_key) VALUES ('x','album-1','owner','x','x')").run()).toThrow(/start as draft/);
    expect(() => context.sqlite.prepare("INSERT INTO photo_bibs (id, photo_id, bib_number, confidence) VALUES ('x', ?, '123456', .9)").run(intent.photoId)).toThrow(/invalid bib/);
  });

  it("recupera lease interrompido e impede commit se o lease foi substituído", async () => {
    const context = testEnvironment();
    const intent = await staged(context);
    await handleRequest(post("process", { photoId: intent.photoId }), context.env, owner);
    context.sqlite.prepare("UPDATE photo_uploads SET state = 'processing', lease_token = 'old', lease_until = 0, attempts = 1").run();
    await recoverPhotos(context.env);
    expect(context.sqlite.prepare("SELECT state FROM photo_uploads").get()?.state).toBe("queued");
    vi.stubGlobal("fetch", vi.fn(async () => {
      context.sqlite.prepare("UPDATE photo_uploads SET lease_token = 'replacement'").run();
      return Response.json(media);
    }));
    await processJob({ photoId: intent.photoId }, context.env);
    expect(context.sqlite.prepare("SELECT status FROM photos").get()?.status).toBe("draft");
    expect(context.sqlite.prepare("SELECT count(*) AS n FROM photo_exif").get()?.n).toBe(0);
    expect(context.sqlite.prepare("SELECT count(*) AS n FROM photo_bibs").get()?.n).toBe(0);
  });
});
