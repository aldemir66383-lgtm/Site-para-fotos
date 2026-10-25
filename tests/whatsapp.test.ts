import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  buyer,
  commerceEnvironment,
  paymentEvent,
} from "./commerce-helpers.js";
import {
  dispatchOrderWhatsApp,
  drainWhatsAppOutbox,
  handleWhatsAppContact,
  WHATSAPP_POLICY_VERSION,
} from "../src/server/notifications/whatsapp.js";
import { settleVerifiedPayment } from "../src/server/finance/settlement.js";
import { handleCheckoutRequest } from "../src/server/finance/checkout.js";
import { signWebhookPayload } from "../src/server/finance/webhook-signature.js";

afterEach(() => vi.unstubAllGlobals());
async function setup() {
  const c = await commerceEnvironment({ settle: false });
  Object.assign(c.env, {
    WHATSAPP_ENABLED: "on",
    WHATSAPP_ACCESS_TOKEN: "test-token",
    WHATSAPP_PHONE_NUMBER_ID: "123456789",
    WHATSAPP_GRAPH_VERSION: "v23.0",
    WHATSAPP_TEMPLATE_NAME: "aire_photos_download_ready",
    PUBLIC_SITE_URL: "https://aire.example",
  });
  expect(
    (
      await handleWhatsAppContact(
        api("orders/order-1/whatsapp-contact", "PUT", {
          enabled: true,
          phone: "+5511999999999",
          policyVersion: WHATSAPP_POLICY_VERSION,
        }),
        c.env,
        buyer,
      )
    )?.status,
  ).toBe(200);
  return c;
}

describe("WhatsApp pós-pagamento", () => {
  it("integra telefone do checkout ao webhook autenticado e ao disparo imediato", async () => {
    const c = await setup();
    c.env.WEBHOOK_SECRET = "synthetic-webhook-secret";
    const created = await handleCheckoutRequest(
      api(
        "orders",
        "POST",
        {
          albumId: "album-1",
          photoIds: [c.photoIds[0]],
          buyer: {
            phone: "+5511999999999",
            whatsappConsent: {
              accepted: true,
              policyVersion: WHATSAPP_POLICY_VERSION,
            },
          },
        },
        { "Idempotency-Key": "whatsapp-checkout-fixture" },
      ),
      c.env,
    );
    expect(created?.status).toBe(201);
    const order = (await created!.json()) as {
      orderId: string;
      txid: string;
      totalCents: number;
    };
    const event = {
      provider: "mock",
      providerEventId: "whatsapp-checkout-event",
      txid: order.txid,
      amountCents: order.totalCents,
    };
    const body = JSON.stringify(event);
    const signature = await signWebhookPayload(
      new TextEncoder().encode(body),
      c.env.WEBHOOK_SECRET,
      Math.floor(Date.now() / 1000),
    );
    const send = vi.fn(async () =>
      Response.json({ messages: [{ id: "wamid.end-to-end" }] }),
    );
    vi.stubGlobal("fetch", send);
    const settled = await handleCheckoutRequest(
      new Request("https://fotoviva.test/api/fotoviva/pix/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
        },
        body,
      }),
      c.env,
    );
    expect(settled?.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      c.sqlite
        .prepare("SELECT state FROM whatsapp_outbox WHERE order_id=?")
        .get(order.orderId)?.state,
    ).toBe("accepted");
  });
  it("liquida e dispara uma vez com link da Aire Photos, inclusive com replay concorrente", async () => {
    const c = await setup();
    const send = vi.fn(async () =>
      Response.json({ messages: [{ id: "wamid.test" }] }),
    );
    vi.stubGlobal("fetch", send);
    await settleVerifiedPayment(c.env, paymentEvent);
    await Promise.all([
      settleVerifiedPayment(c.env, paymentEvent),
      dispatchOrderWhatsApp(c.env, "order-1"),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    const args = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(args[0]).toBe("https://graph.facebook.com/v23.0/123456789/messages");
    const payload = JSON.parse(String(args[1].body));
    expect(payload.to).toBe("5511999999999");
    expect(payload.template.components[0].parameters[0].text).toBe(
      "https://aire.example/minhas-fotos/order-1",
    );
    expect(String(args[1].body)).not.toMatch(/ticket|originals|r2.cloud/);
    expect(
      c.sqlite
        .prepare("SELECT state,provider_message_id FROM whatsapp_outbox")
        .get(),
    ).toMatchObject({ state: "accepted", provider_message_id: "wamid.test" });
  });

  it("não dispara sem opt-in nem antes do pagamento", async () => {
    const c = await commerceEnvironment({ settle: false });
    c.sqlite
      .prepare("UPDATE orders SET buyer_phone_e164='+5511999999999'")
      .run();
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    await settleVerifiedPayment(c.env, paymentEvent);
    expect(send).not.toHaveBeenCalled();
    expect(
      c.sqlite.prepare("SELECT count(*) AS n FROM whatsapp_outbox").get()?.n,
    ).toBe(0);
  });

  it("preserva pagamento e retenta rate limit por cron", async () => {
    const c = await setup();
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "Retry-After": "60" } }),
      )
      .mockResolvedValueOnce(
        Response.json({ messages: [{ id: "wamid.retry" }] }),
      );
    vi.stubGlobal("fetch", send);
    await settleVerifiedPayment(c.env, paymentEvent);
    expect(c.sqlite.prepare("SELECT status FROM orders").get()?.status).toBe(
      "paid",
    );
    expect(
      c.sqlite.prepare("SELECT state FROM whatsapp_outbox").get()?.state,
    ).toBe("pending");
    c.sqlite.prepare("UPDATE whatsapp_outbox SET next_attempt_at_ms=0").run();
    await drainWhatsAppOutbox(c.env);
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      c.sqlite.prepare("SELECT state FROM whatsapp_outbox").get()?.state,
    ).toBe("accepted");
  });

  it("não reenvia cegamente após timeout ou lease interrompido", async () => {
    const c = await setup();
    const send = vi.fn(async () => {
      throw new Error("network unknown");
    });
    vi.stubGlobal("fetch", send);
    await settleVerifiedPayment(c.env, paymentEvent);
    expect(
      c.sqlite.prepare("SELECT state FROM whatsapp_outbox").get()?.state,
    ).toBe("uncertain");
    await drainWhatsAppOutbox(c.env);
    await settleVerifiedPayment(c.env, paymentEvent);
    expect(send).toHaveBeenCalledTimes(1);
    c.sqlite
      .prepare("UPDATE whatsapp_outbox SET state='sending',lease_until_ms=0")
      .run();
    await drainWhatsAppOutbox(c.env);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      c.sqlite.prepare("SELECT error_code FROM whatsapp_outbox").get()
        ?.error_code,
    ).toBe("send_interrupted");
  });

  it("mantém outbox sem consumir tentativas quando não há credenciais", async () => {
    const c = await setup();
    delete c.env.WHATSAPP_ACCESS_TOKEN;
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    await settleVerifiedPayment(c.env, paymentEvent);
    expect(
      c.sqlite.prepare("SELECT state,attempts FROM whatsapp_outbox").get(),
    ).toMatchObject({ state: "pending", attempts: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("revoga opt-in e impede envio pendente ou alteração de contato alheio", async () => {
    const c = await setup();
    c.env.WHATSAPP_ENABLED = "off";
    await settleVerifiedPayment(c.env, paymentEvent);
    expect(
      (
        await handleWhatsAppContact(
          api("orders/order-1/whatsapp-contact", "PUT", { enabled: false }),
          c.env,
          async () => ({ id: "other", role: "buyer" }),
        )
      )?.status,
    ).toBe(404);
    expect(
      (
        await handleWhatsAppContact(
          api("orders/order-1/whatsapp-contact", "PUT", { enabled: false }),
          c.env,
          buyer,
        )
      )?.status,
    ).toBe(200);
    c.env.WHATSAPP_ENABLED = "on";
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    await drainWhatsAppOutbox(c.env);
    expect(send).not.toHaveBeenCalled();
    expect(
      c.sqlite.prepare("SELECT state FROM whatsapp_outbox").get()?.state,
    ).toBe("skipped");
  });

  it("outbox faz parte da transação que concede os direitos", async () => {
    const c = await setup();
    c.sqlite.exec(
      "CREATE TRIGGER reject_outbox BEFORE INSERT ON whatsapp_outbox BEGIN SELECT RAISE(ABORT,'test-outbox-failure'); END",
    );
    await expect(settleVerifiedPayment(c.env, paymentEvent)).rejects.toThrow(
      "test-outbox-failure",
    );
    expect(c.sqlite.prepare("SELECT status FROM orders").get()?.status).toBe(
      "pending",
    );
    expect(
      c.sqlite.prepare("SELECT count(*) AS n FROM ledger_entries").get()?.n,
    ).toBe(0);
    expect(
      c.sqlite.prepare("SELECT count(*) AS n FROM download_entitlements").get()
        ?.n,
    ).toBe(0);
  });

  it("webhook não configurado não liquida e eventos Asaas não pagos não notificam", async () => {
    const c = await setup();
    expect(
      (
        await handleCheckoutRequest(
          api("pix/webhook", "POST", paymentEvent),
          c.env,
        )
      )?.status,
    ).toBe(503);
    c.env.ASAAS_WEBHOOK_TOKEN = "native-asaas-test-token";
    const response = await handleCheckoutRequest(
      api(
        "pix/webhook",
        "POST",
        {
          event: "PAYMENT_REFUNDED",
          payment: { id: "p1", externalReference: "tx-1", value: 45 },
        },
        { "asaas-access-token": c.env.ASAAS_WEBHOOK_TOKEN },
      ),
      c.env,
    );
    expect(((await response!.json()) as { outcome: string }).outcome).toBe(
      "ignored_event",
    );
    expect(c.sqlite.prepare("SELECT status FROM orders").get()?.status).toBe(
      "pending",
    );
  });
});
