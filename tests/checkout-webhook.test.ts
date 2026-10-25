import { describe, expect, it } from "vitest";
import { handleCheckoutRequest } from "../src/server/finance/checkout.js";
import { signWebhookPayload } from "../src/server/finance/webhook-signature.js";
import { commerceEnvironment, api } from "./commerce-helpers.js";

describe("Checkout e Webhook Pix", () => {
  it("cria um pedido com fotos válidas e calcula combo com sucesso", async () => {
    const { env, photoIds } = await commerceEnvironment({ settle: false });

    const req = api("orders", "POST", {
      albumId: "album-1",
      photoIds: [photoIds[0], photoIds[1], photoIds[2]], // 3 fotos -> combo de 1200 cada = 3600 total
      buyer: { name: "Atleta Silva", email: "atleta@example.com" },
    }, { "Idempotency-Key": "idemp-test-1" });

    const res = await handleCheckoutRequest(req, env);
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

    const replayRes = await handleCheckoutRequest(replayReq, env);
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

    const res = await handleCheckoutRequest(req, env);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const data = await res!.json() as any;
    expect(data.code).toBe("photos_unavailable");
  });

  it("consulta pedido existente e aplica expiração preguiçosa", async () => {
    const { env, sqlite } = await commerceEnvironment({ settle: false });

    // Consulta order-1 que está pending
    const req = api("orders/order-1", "GET");
    const res = await handleCheckoutRequest(req, env);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const data = await res!.json() as any;
    expect(data.id).toBe("order-1");
    expect(data.status).toBe("pending");
    expect(data.charge.txid).toBe("tx-1");

    // Simula expiração alterando expires_at no passado
    sqlite.prepare("UPDATE orders SET expires_at = '2020-01-01T00:00:00Z' WHERE id = 'order-1'").run();

    const reqExpired = api("orders/order-1", "GET");
    const resExpired = await handleCheckoutRequest(reqExpired, env);
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
