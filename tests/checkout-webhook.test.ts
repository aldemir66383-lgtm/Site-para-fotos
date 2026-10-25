import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCheckoutRequest } from "../src/server/finance/checkout.js";
import { signWebhookPayload } from "../src/server/finance/webhook-signature.js";
import { commerceEnvironment, api, buyer, photographer } from "./commerce-helpers.js";

afterEach(() => vi.unstubAllGlobals());

describe("Checkout e Webhook Pix", () => {
  it("ignora X-Buyer-Subject e exige sessão no POST e no GET", async () => {
    const { env, sqlite, photoIds } = await commerceEnvironment({ settle: false });
    const body = { albumId: "album-1", photoIds: [photoIds[0]] };
    const headers = { "X-Buyer-Subject": "spoofed-buyer", "Idempotency-Key": "session-only" };
    const unauthenticated = await handleCheckoutRequest(api("orders", "POST", body, headers), env);
    expect(unauthenticated?.status).toBe(401);
    expect(await unauthenticated!.json()).toMatchObject({ code: "unauthenticated" });
    expect((await handleCheckoutRequest(api("orders/order-1"), env))?.status).toBe(401);
    expect(sqlite.prepare("SELECT count(*) AS n FROM orders").get()?.n).toBe(1);

    const response = await handleCheckoutRequest(api("orders", "POST", body, headers), env, undefined, buyer);
    expect(response?.status).toBe(201);
    const created = await response!.json() as { orderId: string };
    expect(sqlite.prepare("SELECT buyer_subject FROM orders WHERE id=?").get(created.orderId)?.buyer_subject).toBe("buyer-1");
  });

  it("retorna 404 para pedido de outro usuário sem expirá-lo nem revelar o Pix", async () => {
    const { env, sqlite } = await commerceEnvironment({ settle: false });
    sqlite.prepare("UPDATE orders SET expires_at='2020-01-01T00:00:00Z'").run();
    const response = await handleCheckoutRequest(api("orders/order-1"), env, undefined,
      async () => ({ id: "other-buyer", role: "buyer" }));
    expect(response?.status).toBe(404);
    expect(await response!.json()).toEqual({ code: "order_not_found", error: "Pedido não encontrado." });
    expect(sqlite.prepare("SELECT status FROM orders WHERE id='order-1'").get()?.status).toBe("pending");
  });

  it("isola a mesma Idempotency-Key por sessão e aceita fotógrafos como compradores", async () => {
    const { env, sqlite, photoIds } = await commerceEnvironment({ settle: false });
    const body = { albumId: "album-1", photoIds: [photoIds[0]] };
    const headers = { "Idempotency-Key": "shared-key", "X-Buyer-Subject": "buyer-1" };
    const first = await handleCheckoutRequest(api("orders", "POST", body, headers), env, undefined, buyer);
    const second = await handleCheckoutRequest(api("orders", "POST", body, headers), env, undefined, photographer);
    expect(first?.status).toBe(201);
    expect(second?.status).toBe(201);
    const firstData = await first!.json() as { orderId: string; txid: string; copyAndPaste: string };
    const secondData = await second!.json() as typeof firstData;
    expect(secondData.orderId).not.toBe(firstData.orderId);
    expect(secondData.txid).not.toBe(firstData.txid);
    expect(secondData.copyAndPaste).not.toBe(firstData.copyAndPaste);
    expect(sqlite.prepare("SELECT buyer_subject FROM orders WHERE id=?").get(secondData.orderId)?.buyer_subject).toBe("owner");
    const replay = await handleCheckoutRequest(api("orders", "POST", body, headers), env, undefined, photographer);
    expect(replay?.status).toBe(200);
    expect(await replay!.json()).toMatchObject({
      orderId: secondData.orderId, txid: secondData.txid, copyAndPaste: secondData.copyAndPaste,
    });
    expect((await handleCheckoutRequest(api(`orders/${secondData.orderId}`), env, undefined, photographer))?.status).toBe(200);
  });

  it("rejeita papéis sem acesso ao checkout", async () => {
    const { env, photoIds } = await commerceEnvironment({ settle: false });
    const authenticate = async () => ({ id: "admin-1", role: "admin" });
    expect((await handleCheckoutRequest(api("orders", "POST", { albumId: "album-1", photoIds }), env, undefined, authenticate))?.status).toBe(403);
    expect((await handleCheckoutRequest(api("orders/order-1"), env, undefined, authenticate))?.status).toBe(403);
  });

  it("rejeita foto verificada de outro álbum e IDs duplicados", async () => {
    const { env, sqlite, photoIds } = await commerceEnvironment({ settle: false });
    sqlite.prepare("INSERT INTO albums(id,photographer_id,title) VALUES ('other','owner','Outro')").run();
    sqlite.prepare("UPDATE photos SET album_id='other' WHERE id=?").run(photoIds[0]);
    const response = await handleCheckoutRequest(api("orders", "POST", { albumId: "album-1", photoIds }), env, undefined, buyer);
    expect(response?.status).toBe(400);
    expect(await response!.json()).toMatchObject({ code: "photos_unavailable" });
    const duplicated = await handleCheckoutRequest(api("orders", "POST", {
      albumId: "album-1", photoIds: [photoIds[1], photoIds[1]],
    }), env, undefined, buyer);
    expect(duplicated?.status).toBe(400);
    expect(await duplicated!.json()).toMatchObject({ code: "invalid_input", error: "Não envie IDs de fotos duplicados." });
    expect(sqlite.prepare("SELECT count(*) AS n FROM orders").get()?.n).toBe(1);
  });

  it("sem comissão cadastrada retorna 503 antes de criar pedido ou cobrança", async () => {
    const { env, sqlite, photoIds } = await commerceEnvironment({ settle: false, commissionConfigured: false });
    env.ASAAS_API_KEY = "synthetic-test-key";
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const response = await handleCheckoutRequest(api("orders", "POST", { albumId: "album-1", photoIds }), env, undefined, buyer);
    expect(response?.status).toBe(503);
    expect(await response!.json()).toMatchObject({ code: "pricing_not_configured" });
    expect(send).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT count(*) AS n FROM commission_rules").get()?.n).toBe(0);
    expect(sqlite.prepare("SELECT count(*) AS n FROM orders").get()?.n).toBe(1);
    expect(sqlite.prepare("SELECT count(*) AS n FROM payment_charges").get()?.n).toBe(1);
  });

  it("webhook sem nenhum segredo retorna 503 e mantém pedido e cobrança pendentes", async () => {
    const { env, sqlite } = await commerceEnvironment({ settle: false });
    delete env.WEBHOOK_SECRET;
    delete env.ASAAS_WEBHOOK_TOKEN;
    const response = await handleCheckoutRequest(api("pix/webhook", "POST", {
      provider: "lab", providerEventId: "unsigned-event", txid: "tx-1", amountCents: 4500,
    }), env);
    expect(response?.status).toBe(503);
    expect(await response!.json()).toMatchObject({ code: "webhook_not_configured" });
    expect(sqlite.prepare("SELECT status FROM orders WHERE id='order-1'").get()?.status).toBe("pending");
    expect(sqlite.prepare("SELECT status FROM payment_charges WHERE txid='tx-1'").get()?.status).toBe("pending");
    for (const table of ["payment_events", "ledger_entries", "download_entitlements", "whatsapp_outbox"])
      expect(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
  });

  it("cria um pedido com fotos válidas e calcula combo com sucesso", async () => {
    const { env, photoIds } = await commerceEnvironment({ settle: false });

    const req = api("orders", "POST", {
      albumId: "album-1",
      photoIds: [photoIds[0], photoIds[1], photoIds[2]], // 3 fotos -> combo de 1200 cada = 3600 total
      buyer: { name: "Atleta Silva", email: "atleta@example.com" },
    }, { "Idempotency-Key": "idemp-test-1" });

    const res = await handleCheckoutRequest(req, env, undefined, buyer);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(201);

    const data = await res!.json() as any;
    expect(data.orderId).toBeDefined();
    expect(data.txid).toBeDefined();
    expect(data.copyAndPaste).toBeDefined();
    expect(data.totalCents).toBe(3600); // 3 fotos x 1200
    expect(data.itemCount).toBe(3);

    // Replay idempotente deve devolver o mesmo pedido
    const replayReq = api("orders", "POST", {
      albumId: "album-1",
      photoIds: [photoIds[0], photoIds[1], photoIds[2]],
    }, { "Idempotency-Key": "idemp-test-1" });

    const replayRes = await handleCheckoutRequest(replayReq, env, undefined, buyer);
    expect(replayRes!.status).toBe(200);
    const replayData = await replayRes!.json() as any;
    expect(replayData.orderId).toBe(data.orderId);
  });

  it("recusa criação de pedido com fotos inexistentes ou indisponíveis", async () => {
    const { env } = await commerceEnvironment({ settle: false });

    const req = api("orders", "POST", {
      albumId: "album-1",
      photoIds: ["foto-inexistente-123"],
    });

    const res = await handleCheckoutRequest(req, env, undefined, buyer);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const data = await res!.json() as any;
    expect(data.code).toBe("photos_unavailable");
  });

  it("consulta pedido existente e aplica expiração preguiçosa", async () => {
    const { env, sqlite } = await commerceEnvironment({ settle: false });

    // Consulta order-1 que está pending
    const req = api("orders/order-1", "GET");
    const res = await handleCheckoutRequest(req, env, undefined, buyer);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const data = await res!.json() as any;
    expect(data.id).toBe("order-1");
    expect(data.status).toBe("pending");
    expect(data.charge.txid).toBe("tx-1");

    // Simula expiração alterando expires_at no passado
    sqlite.prepare("UPDATE orders SET expires_at = '2020-01-01T00:00:00Z' WHERE id = 'order-1'").run();

    const reqExpired = api("orders/order-1", "GET");
    const resExpired = await handleCheckoutRequest(reqExpired, env, undefined, buyer);
    const dataExpired = await resExpired!.json() as any;
    expect(dataExpired.status).toBe("expired");
  });

  it("processa webhook Pix assinado e liquida pedido no D1", async () => {
    const { env, sqlite } = await commerceEnvironment({ settle: false });
    env.WEBHOOK_SECRET = "secret-super-seguro-123";

    const payload = {
      provider: "lab",
      providerEventId: "evt-pix-1",
      txid: "tx-1",
      amountCents: 4500,
    };
    const bodyBytes = new TextEncoder().encode(JSON.stringify(payload));
    const nowSec = Math.floor(Date.now() / 1000);
    const signature = await signWebhookPayload(bodyBytes, env.WEBHOOK_SECRET, nowSec);

    const req = new Request("https://fotoviva.test/api/fotoviva/pix/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
      },
      body: bodyBytes,
    });

    const res = await handleCheckoutRequest(req, env);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const data = await res!.json() as any;
    expect(data.received).toBe(true);
    expect(data.outcome).toBe("applied");

    // Verifica que o pedido foi marcado como paid
    const order = sqlite.prepare("SELECT status FROM orders WHERE id = 'order-1'").get() as any;
    expect(order.status).toBe("paid");
  });

  it("rejeita webhook com assinatura HMAC inválida", async () => {
    const { env } = await commerceEnvironment({ settle: false });
    env.WEBHOOK_SECRET = "secret-super-seguro-123";

    const payload = { provider: "mock", providerEventId: "evt-fake", txid: "tx-1", amountCents: 4500 };
    const bodyBytes = new TextEncoder().encode(JSON.stringify(payload));

    const req = new Request("https://fotoviva.test/api/fotoviva/pix/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": "t=1700000000,v1=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      },
      body: bodyBytes,
    });

    const res = await handleCheckoutRequest(req, env);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const data = await res!.json() as any;
    expect(data.code).toBe("invalid_signature");
  });
});
