import { describe, expect, it } from "vitest";
import { commerceEnvironment } from "./commerce-helpers.js";
import {
  cleanOrphanUploads,
  expireOrdersAndPrivateData,
} from "../src/server/maintenance.js";

describe("cron de manutenção", () => {
  it("apaga somente staging antigo sem trabalho ativo e preserva originais", async () => {
    const c = await commerceEnvironment();
    const now = Date.now();
    for (const key of [
      "originals/pending/orphan.jpg",
      "originals/pending/recent.jpg",
      "originals/pending/active.jpg",
      "originals/final.jpg",
    ])
      await c.bucket.put(key, new Uint8Array([1, 2, 3]));
    for (const [key, value] of c.objects)
      if (!key.endsWith("recent.jpg"))
        value.uploaded = new Date(now - 2 * 86_400_000);
    c.sqlite
      .prepare(
        `INSERT INTO photo_uploads(photo_id,staging_key,expected_bytes,upload_expires_at,state,updated_at)
      VALUES (?,'originals/pending/active.jpg',3,?,'queued',?)`,
      )
      .run(c.photoIds[0], now + 600_000, now);
    await cleanOrphanUploads(c.env, now);
    expect(c.objects.has("originals/pending/orphan.jpg")).toBe(false);
    expect(c.objects.has("originals/pending/recent.jpg")).toBe(true);
    expect(c.objects.has("originals/pending/active.jpg")).toBe(true);
    expect(c.objects.has("originals/final.jpg")).toBe(true);
  });

  it("continua varredura paginada sem carregar o bucket inteiro", async () => {
    const c = await commerceEnvironment();
    const now = Date.now();
    for (let i = 0; i < 103; i++) {
      const key = `originals/pending/${String(i).padStart(3, "0")}`;
      await c.bucket.put(key, new Uint8Array([1]));
      c.objects.get(key)!.uploaded = new Date(now - 2 * 86_400_000);
    }
    await cleanOrphanUploads(c.env, now, 1);
    expect(
      [...c.objects.keys()].filter((k) => k.startsWith("originals/pending/"))
        .length,
    ).toBe(3);
    expect(
      c.sqlite.prepare("SELECT value FROM maintenance_state").get()?.value,
    ).not.toBe("");
    await cleanOrphanUploads(c.env, now, 1);
    expect(
      [...c.objects.keys()].filter((k) => k.startsWith("originals/pending/"))
        .length,
    ).toBe(0);
    expect(
      c.sqlite.prepare("SELECT value FROM maintenance_state").get()?.value,
    ).toBe("");
  });

  it("expira pedidos/cobranças pendentes sem mudar pagos e remove dados temporários vencidos", async () => {
    const c = await commerceEnvironment({ settle: false });
    const now = Date.now();
    c.sqlite
      .prepare("UPDATE orders SET expires_at='2020-01-01T00:00:00Z'")
      .run();
    c.sqlite
      .prepare(
        `INSERT INTO face_search_consents(id,buyer_ip_hash,album_id,policy_version,expires_at_ms) VALUES ('expired','hash','album-1','v1',0)`,
      )
      .run();
    c.sqlite
      .prepare(
        `INSERT INTO search_sessions VALUES ('session','owner-hash','album-1','expired','selfie','[]',0,0)`,
      )
      .run();
    await expireOrdersAndPrivateData(c.env, now);
    expect(c.sqlite.prepare("SELECT status FROM orders").get()?.status).toBe(
      "expired",
    );
    expect(
      c.sqlite.prepare("SELECT status FROM payment_charges").get()?.status,
    ).toBe("expired");
    expect(
      c.sqlite.prepare("SELECT count(*) AS n FROM search_sessions").get()?.n,
    ).toBe(0);
    expect(
      c.sqlite.prepare("SELECT count(*) AS n FROM face_search_consents").get()
        ?.n,
    ).toBe(0);
    const paid = await commerceEnvironment();
    await expireOrdersAndPrivateData(paid.env, Date.now() + 86_400_000);
    expect(paid.sqlite.prepare("SELECT status FROM orders").get()?.status).toBe(
      "paid",
    );
  });
});
