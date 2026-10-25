import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { ApiError, MAX_UPLOAD_BYTES } from "../photos/contracts.js";
import { processImage } from "./processor.js";

export function createMediaServer(token: string, processor = processImage) {
  if (token.length < 32) throw new Error("MEDIA_SERVICE_TOKEN must have at least 32 characters");
  const expected = createHash("sha256").update(`Bearer ${token}`).digest();
  let active = 0;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    try {
      const actual = createHash("sha256").update(req.headers.authorization ?? "").digest();
      if (!timingSafeEqual(expected, actual)) throw new ApiError(401, "unauthenticated", "Não autorizado.");
      if (req.method !== "POST" || req.url !== "/process") throw new ApiError(404, "not_found", "Rota não encontrada.");
      if (req.headers["content-type"] !== "image/jpeg") throw new ApiError(415, "unsupported_media_type", "Envie JPEG.");
      if (active >= 2) throw new ApiError(503, "temporarily_unavailable", "Processador ocupado.");
      active++;
      try {
        const declaredSize = Number(req.headers["content-length"] ?? 0);
        if (declaredSize > MAX_UPLOAD_BYTES) throw new ApiError(413, "payload_too_large", "JPEG acima de 20 MB.");
        let length = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          length += chunk.length;
          if (length > MAX_UPLOAD_BYTES) throw new ApiError(413, "payload_too_large", "JPEG acima de 20 MB.");
          chunks.push(Buffer.from(chunk));
        }
        const result = await processor(Buffer.concat(chunks));
        res.end(JSON.stringify(result));
      } finally { active--; }
    } catch (error) {
      res.statusCode = error instanceof ApiError ? error.status : 503;
      res.end(JSON.stringify({ code: error instanceof ApiError ? error.code : "temporarily_unavailable" }));
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createMediaServer(process.env.MEDIA_SERVICE_TOKEN ?? "");
  const port = Number(process.env.PORT ?? 8788);
  server.listen(port, "0.0.0.0", () => console.log(`FotoViva media listening on ${port}`));
}
