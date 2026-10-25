import { afterEach, describe, expect, it, vi } from "vitest";
import { commerceEnvironment, buyer, api } from "./commerce-helpers.js";
import { handleFaceRequest } from "../src/server/search/face-handlers.js";
import { indexPhotoFaces } from "../src/server/search/face-index.js";
import {
  cosine,
  httpFaceProvider,
  normalizeVector,
  type Face,
} from "../src/server/search/face-provider.js";
import {
  FACE_POLICY_VERSION,
  decryptFaceVector,
  encryptFaceVector,
} from "../src/server/search/face-privacy.js";

afterEach(() => vi.unstubAllGlobals());
const vector = (score = 1) => {
  const v = new Float32Array(64);
  v[0] = score;
  v[1] = Math.sqrt(1 - score * score);
  return v;
};
const face = (score = 1): Face => ({ vector: vector(score), quality: 0.95 });
async function setup() {
  const c = await commerceEnvironment();
  Object.assign(c.env, {
    FV_FACE_SEARCH: "on",
    FACE_MODEL_VERSION: "synthetic-v1",
    FACE_EMBEDDING_DIMENSIONS: "64",
    FACE_MEDIUM_THRESHOLD: "0.6",
    FACE_HIGH_THRESHOLD: "0.9",
    FACE_IP_HASH_SECRET: "synthetic-secret-".repeat(4),
    FACE_INDEX_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
  });
  c.sqlite
    .prepare(
      `UPDATE albums SET face_search_enabled=1,may_include_minors=0,face_legal_basis_reference='synthetic-fixtures-only',face_index_expires_at_ms=? WHERE id='album-1'`,
    )
    .run(Date.now() + 7 * 86_400_000);
  for (const [i, id] of c.photoIds.entries())
    await indexPhotoFaces(c.env, id, async () =>
      i === 0 ? [face(1), face(0.95)] : [face(i === 1 ? 0.75 : 0)],
    );
  return c;
}
function selfie(
  consent: unknown = {
    policyVersion: FACE_POLICY_VERSION,
    accepted: true,
    adult: true,
    ownImage: true,
  },
) {
  const form = new FormData();
  form.set("albumId", "album-1");
  form.set("mode", "selfie");
  form.set("consent", JSON.stringify(consent));
  form.set(
    "image",
    new Blob([new Uint8Array([255, 216, 255, 224, 0, 0])], {
      type: "image/jpeg",
    }),
    "synthetic.jpg",
  );
  return new Request("https://fotoviva.test/api/fotoviva/search/sessions", {
    method: "POST",
    headers: { "CF-Connecting-IP": "203.0.113.7" },
    body: form,
  });
}

describe("busca por selfie em RAM", () => {
  it("classifica e deduplica fotos em alta/media, registra IP pseudonimizado e zera buffers", async () => {
    const c = await setup();
    let retainedImage: Uint8Array | undefined;
    const query = face();
    const response = await handleFaceRequest(
      selfie(),
      c.env,
      buyer,
      async (image) => {
        retainedImage = image;
        return [query];
      },
    );
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      id: string;
      results: { photoId: string; relevance: string }[];
    };
    expect(body.results.map((r) => [r.photoId, r.relevance])).toEqual([
      [c.photoIds[0], "alta"],
      [c.photoIds[1], "media"],
    ]);
    expect(retainedImage?.every((v) => v === 0)).toBe(true);
    expect(query.vector.every((v) => v === 0)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(
      /score|vector|ciphertext|originals/,
    );
    const receipt = c.sqlite
      .prepare("SELECT * FROM face_search_consents")
      .get()!;
    expect(String(receipt.buyer_ip_hash)).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.policy_version).toBe(FACE_POLICY_VERSION);
    expect(JSON.stringify(receipt)).not.toContain("203.0.113.7");
    const stored = c.sqlite
      .prepare("SELECT results_json FROM search_sessions")
      .get()!;
    expect(String(stored.results_json)).not.toMatch(/score|vector/);
    const encrypted = c.sqlite
      .prepare("SELECT ciphertext FROM photo_face_embeddings LIMIT 1")
      .get()!;
    expect(String(encrypted.ciphertext)).not.toContain("vector");
  });

  it("exige consentimento específico vigente antes de chamar o processador", async () => {
    const c = await setup();
    const provider = vi.fn(async () => [face()]);
    for (const consent of [
      { accepted: true },
      {
        policyVersion: FACE_POLICY_VERSION,
        accepted: false,
        adult: true,
        ownImage: true,
      },
      {
        policyVersion: FACE_POLICY_VERSION,
        accepted: true,
        adult: false,
        ownImage: true,
      },
      {
        policyVersion: FACE_POLICY_VERSION,
        accepted: true,
        adult: true,
        ownImage: false,
      },
    ]) {
      const response = await handleFaceRequest(
        selfie(consent),
        c.env,
        buyer,
        provider,
      );
      expect(response?.status).toBe(400);
    }
    expect(provider).not.toHaveBeenCalled();
    expect(
      c.sqlite.prepare("SELECT count(*) AS n FROM face_search_consents").get()
        ?.n,
    ).toBe(0);
  });

  it("bloqueia flag desligada, álbuns privados e álbuns com menores", async () => {
    const c = await setup();
    const provider = vi.fn(async () => [face()]);
    c.env.FV_FACE_SEARCH = "off";
    expect(
      (await handleFaceRequest(selfie(), c.env, buyer, provider))?.status,
    ).toBe(403);
    c.env.FV_FACE_SEARCH = "on";
    c.sqlite.prepare("UPDATE albums SET catalog_visibility='private'").run();
    expect(
      (await handleFaceRequest(selfie(), c.env, buyer, provider))?.status,
    ).toBe(404);
    c.sqlite
      .prepare(
        "UPDATE albums SET catalog_visibility='public',may_include_minors=1",
      )
      .run();
    expect(
      (await handleFaceRequest(selfie(), c.env, buyer, provider))?.status,
    ).toBe(404);
    expect(provider).not.toHaveBeenCalled();
    expect(
      c.sqlite.prepare("SELECT count(*) AS n FROM photo_face_embeddings").get()
        ?.n,
    ).toBe(0);
  });

  it("não inclui outro álbum e revalida fotos ocultadas ao consultar a sessão", async () => {
    const c = await setup();
    c.sqlite
      .prepare(
        "INSERT INTO albums(id,photographer_id,title) VALUES ('other','owner','Outro')",
      )
      .run();
    c.sqlite
      .prepare("UPDATE photos SET album_id='other' WHERE id=?")
      .run(c.photoIds[1]);
    const response = await handleFaceRequest(
      selfie(),
      c.env,
      buyer,
      async () => [face()],
    );
    const result = (await response!.json()) as {
      id: string;
      results: { photoId: string }[];
    };
    expect(result.results.map((r) => r.photoId)).toEqual([c.photoIds[0]]);
    c.sqlite
      .prepare("UPDATE photos SET status='hidden' WHERE id=?")
      .run(c.photoIds[0]);
    const refresh = await handleFaceRequest(
      api(`search/sessions/${result.id}`),
      c.env,
      buyer,
    );
    expect(((await refresh!.json()) as { results: unknown[] }).results).toEqual(
      [],
    );
    expect(
      (
        await handleFaceRequest(
          api(`search/sessions/${result.id}`),
          c.env,
          async () => ({ id: "intruder", role: "buyer" }),
        )
      )?.status,
    ).toBe(404);
  });

  it("limita buscas por sessão e IP e não faz inferência excedente", async () => {
    const c = await setup();
    const provider = vi.fn(async () => [face()]);
    for (let i = 0; i < 5; i++)
      expect(
        (await handleFaceRequest(selfie(), c.env, buyer, provider))?.status,
      ).toBe(200);
    expect(
      (await handleFaceRequest(selfie(), c.env, buyer, provider))?.status,
    ).toBe(429);
    expect(
      (
        await handleFaceRequest(
          selfie(),
          c.env,
          async () => ({ id: "other", role: "buyer" }),
          provider,
        )
      )?.status,
    ).toBe(429);
    expect(provider).toHaveBeenCalledTimes(5);
  });

  it("trata ausência, múltiplos rostos e qualidade, apagando vetores inclusive em erros", async () => {
    const c = await setup();
    for (const [faces, code] of [
      [[], "no_face"],
      [[face(), face()], "multiple_faces"],
      [[{ ...face(), quality: 0.2 }], "image_quality"],
    ] as [Face[], string][]) {
      const response = await handleFaceRequest(
        selfie(),
        c.env,
        buyer,
        async () => faces,
      );
      expect(response?.status).toBe(422);
      expect(((await response!.json()) as { code: string }).code).toBe(code);
      for (const f of faces) expect(f.vector.every((v) => v === 0)).toBe(true);
    }
  });

  it("remove resultados e registra revogação do consentimento pelo titular", async () => {
    const c = await setup();
    const result = (await (await handleFaceRequest(
      selfie(),
      c.env,
      buyer,
      async () => [face()],
    ))!.json()) as { id: string };
    expect(
      (
        await handleFaceRequest(
          api(`search/sessions/${result.id}`, "DELETE"),
          c.env,
          async () => ({ id: "other", role: "buyer" }),
        )
      )?.status,
    ).toBe(404);
    expect(
      (
        await handleFaceRequest(
          api(`search/sessions/${result.id}`, "DELETE"),
          c.env,
          buyer,
        )
      )?.status,
    ).toBe(204);
    expect(
      c.sqlite.prepare("SELECT count(*) AS n FROM search_sessions").get()?.n,
    ).toBe(0);
    expect(
      c.sqlite.prepare("SELECT revoked_at_ms FROM face_search_consents").get()
        ?.revoked_at_ms,
    ).toBeTypeOf("number");
  });

  it("valida modelo/dimensões do endpoint e não utiliza embeddings textuais", async () => {
    const c = await setup();
    c.env.FACE_EMBEDDINGS_URL = "https://face.example.test/embed";
    c.env.FACE_EMBEDDINGS_TOKEN = "test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ modelVersion: "text-model", faces: [] }),
      ),
    );
    await expect(
      httpFaceProvider(c.env)(new Uint8Array([1]), "image/jpeg"),
    ).rejects.toMatchObject({ code: "face_invalid_response" });
    expect(
      cosine(normalizeVector([3, 4], 2), normalizeVector([6, 8], 2)),
    ).toBeCloseTo(1);
    expect(() => normalizeVector([0, 0], 2)).toThrow();
    expect(() => normalizeVector([NaN, 1], 2)).toThrow();
    const encrypted = await encryptFaceVector(
      c.env.FACE_INDEX_ENCRYPTION_KEY!,
      "album-a",
      vector(),
    );
    await expect(
      decryptFaceVector(
        c.env.FACE_INDEX_ENCRYPTION_KEY!,
        "album-b",
        encrypted,
        64,
      ),
    ).rejects.toThrow();
  });
});
