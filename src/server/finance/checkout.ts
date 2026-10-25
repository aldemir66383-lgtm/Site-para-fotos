import { z } from "zod";
import { ApiError, readLimited } from "../photos/contracts.js";
import { json } from "../photos/handlers.js";
import type { Env } from "../photos/env.js";
import { AsaasPaymentProvider } from "./providers/asaas-provider.js";
import { MockPaymentProvider } from "./providers/mock-provider.js";
import type { PaymentProvider } from "./providers/payment-provider.js";
import { verifyWebhookSignature } from "./webhook-signature.js";
import { settleVerifiedPayment } from "./settlement.js";

const orderInputSchema = z.object({
  albumId: z.string().min(1).max(200),
  photoIds: z.array(z.string().min(1).max(200)).min(1).max(1000),
  buyer: z.object({
    name: z.string().max(200).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(30).optional(),
  }).optional(),
}).strict();

function getPaymentProvider(env: Env): PaymentProvider {
  if (env.ASAAS_API_KEY) {
    return new AsaasPaymentProvider({
      apiKey: env.ASAAS_API_KEY,
      baseUrl: env.ASAAS_BASE_URL,
    });
  }
  return new MockPaymentProvider();
}

/**
 * Precificação inteligente em combos:
 * 1 a 2 fotos: 1500 centavos cada (R$ 15,00)
 * 3 a 5 fotos: 1200 centavos cada (R$ 12,00)
 * 6 ou mais fotos: 1000 centavos cada (R$ 10,00)
 */
function calculateUnitPriceCents(totalPhotos: number): number {
  if (totalPhotos >= 6) return 1000;
  if (totalPhotos >= 3) return 1200;
  return 1500;
}

export async function createOrder(request: Request, env: Env, buyerSubject?: string): Promise<Response> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Envie um corpo JSON.");
  }

  const rawBytes = await readLimited(request.body, 16384);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(new TextDecoder().decode(rawBytes));
  } catch {
    throw new ApiError(400, "invalid_json", "JSON inválido.");
  }

  const input = orderInputSchema.parse(parsedJson);
  const idempotencyKey = request.headers.get("Idempotency-Key") || crypto.randomUUID();
  const subject = buyerSubject ||
    request.headers.get("X-Buyer-Subject") ||
    (request.headers.get("Idempotency-Key") ? `guest:${request.headers.get("Idempotency-Key")}` : `guest:${crypto.randomUUID()}`);

  // Verifica se o pedido idempotente já existe
  const existing = await env.DB.prepare(
    "SELECT id, total_cents, item_count, status, expires_at FROM orders WHERE buyer_subject = ? AND idempotency_key = ?"
  ).bind(subject, idempotencyKey).first<{
    id: string; total_cents: number; item_count: number; status: string; expires_at: string;
  }>();

  if (existing) {
    const charge = await env.DB.prepare(
      "SELECT txid, copy_and_paste, provider, status FROM payment_charges WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
    ).bind(existing.id).first<{ txid: string; copy_and_paste: string; provider: string; status: string }>();

    return json({
      orderId: existing.id,
      txid: charge?.txid,
      copyAndPaste: charge?.copy_and_paste,
      status: existing.status,
      totalCents: existing.total_cents,
      itemCount: existing.item_count,
      expiresAt: existing.expires_at,
    }, 200);
  }

  // Busca e valida as fotos no D1
  const placeholders = input.photoIds.map(() => "?").join(",");
  const photos = await env.DB.prepare(
    `SELECT id, photographer_id FROM photos WHERE id IN (${placeholders}) AND status = 'verified'`
  ).bind(...input.photoIds).all<{ id: string; photographer_id: string }>();

  if (photos.results.length !== input.photoIds.length) {
    throw new ApiError(400, "photos_unavailable", "Uma ou mais fotos selecionadas não estão disponíveis.");
  }

  // Busca a regra de comissão ativa
  let rule = await env.DB.prepare(
    "SELECT id FROM commission_rules ORDER BY version DESC LIMIT 1"
  ).first<{ id: string }>();

  if (!rule) {
    rule = { id: "rule-default-v1" };
    await env.DB.prepare(
      `INSERT OR IGNORE INTO commission_rules
       (id, version, platform_fee_bps, provider_fee_bps, provider_fee_fixed_cents, provider_fee_bearer, hold_days)
       VALUES (?, 1, 2000, 99, 0, 'platform', 14)`
    ).bind(rule.id).run();
  }

  const orderId = crypto.randomUUID();
  const unitPrice = calculateUnitPriceCents(photos.results.length);
  const totalCents = unitPrice * photos.results.length;
  const txid = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  const ttlSeconds = 900; // 15 minutos de validade do Pix
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  // Cria cobrança no provedor Pix
  const provider = getPaymentProvider(env);
  const chargeResult = await provider.createCharge({
    orderId,
    txid,
    amountCents: totalCents,
    customer: input.buyer || {},
    expiresInSeconds: ttlSeconds,
  });

  // Salva pedido, itens e cobrança em transação atômica
  const itemInserts = photos.results.map((photo) =>
    env.DB.prepare(
      `INSERT INTO order_items (id, order_id, photo_id, photographer_id, unit_price_cents)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), orderId, photo.id, photo.photographer_id, unitPrice)
  );

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO orders (id, buyer_subject, idempotency_key, status, item_count, total_cents, commission_rule_id, expires_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).bind(orderId, subject, idempotencyKey, photos.results.length, totalCents, rule.id, expiresAt),
    ...itemInserts,
    env.DB.prepare(
      `INSERT INTO payment_charges (txid, order_id, provider, provider_charge_id, status, copy_and_paste, expires_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(txid, orderId, provider.providerName, chargeResult.providerChargeId, chargeResult.copyAndPaste, expiresAt),
  ]);

  return json({
    orderId,
    txid,
    copyAndPaste: chargeResult.copyAndPaste,
    qrCodeBase64: chargeResult.qrCodeBase64,
    expiresAt,
    totalCents,
    itemCount: photos.results.length,
  }, 201);
}

export async function getOrder(orderId: string, env: Env): Promise<Response> {
  const nowIso = new Date().toISOString();

  // Expiração preguiçosa (lazy expiration)
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending' AND expires_at <= ?"
    ).bind(orderId, nowIso),
    env.DB.prepare(
      "UPDATE payment_charges SET status = 'expired' WHERE order_id = ? AND status = 'pending' AND expires_at <= ?"
    ).bind(orderId, nowIso),
  ]);

  const order = await env.DB.prepare(
    "SELECT id, buyer_subject, status, item_count, total_cents, expires_at, created_at FROM orders WHERE id = ?"
  ).bind(orderId).first<{
    id: string; buyer_subject: string; status: string; item_count: number; total_cents: number; expires_at: string; created_at: string;
  }>();

  if (!order) {
    throw new ApiError(404, "order_not_found", "Pedido não encontrado.");
  }

  const charge = await env.DB.prepare(
    "SELECT txid, provider, status, copy_and_paste, expires_at FROM payment_charges WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(orderId).first<{
    txid: string; provider: string; status: string; copy_and_paste: string; expires_at: string;
  }>();

  return json({
    id: order.id,
    status: order.status,
    totalCents: order.total_cents,
    itemCount: order.item_count,
    expiresAt: order.expires_at,
    createdAt: order.created_at,
    charge: charge ? {
      txid: charge.txid,
      provider: charge.provider,
      status: charge.status,
      copyAndPaste: charge.copy_and_paste,
      expiresAt: charge.expires_at,
    } : null,
  });
}

export async function handlePixWebhook(request: Request, env: Env): Promise<Response> {
  const rawBody = await readLimited(request.body, 16384);

  // Verificação de assinatura se segredo estiver configurado
  if (env.WEBHOOK_SECRET) {
    const signature = request.headers.get("X-Signature") ||
      request.headers.get("X-FV-Lab-Signature") ||
      request.headers.get("X-Asaas-Signature");

    const isValid = await verifyWebhookSignature(rawBody, signature, [env.WEBHOOK_SECRET]);
    if (!isValid) {
      throw new ApiError(401, "invalid_signature", "Assinatura do webhook inválida.");
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new ApiError(400, "invalid_json", "Payload inválido.");
  }

  let provider = "mock";
  let providerEventId = "";
  let txid = "";
  let amountCents = 0;

  // Reconhecimento do formato Asaas
  if (payload.event && payload.payment) {
    provider = "asaas";
    providerEventId = payload.payment.id;
    txid = payload.payment.externalReference;
    amountCents = Math.round(Number(payload.payment.value) * 100);
  } else if (payload.txid && payload.amountCents) {
    // Formato genérico/padrão
    provider = payload.provider || "mock";
    providerEventId = payload.providerEventId || `evt_${payload.txid}`;
    txid = payload.txid;
    amountCents = payload.amountCents;
  } else {
    throw new ApiError(400, "unsupported_payload", "Estrutura do evento não reconhecida.");
  }

  const result = await settleVerifiedPayment(env.DB, {
    provider,
    providerEventId,
    txid,
    amountCents,
  });

  return json({
    received: true,
    outcome: result.outcome,
    orderId: result.orderId,
  });
}

export async function handleCheckoutRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  const isCreateOrder = path === "/api/fotoviva/orders";
  const orderMatch = path.match(/^\/api\/fotoviva\/orders\/([a-zA-Z0-9_-]{1,100})$/);
  const isWebhook = path === "/api/fotoviva/pix/webhook" || path === "/api/fotoviva/pix-lab/webhook";

  if (!isCreateOrder && !orderMatch && !isWebhook) return null;

  try {
    if (isCreateOrder && request.method === "POST") return await createOrder(request, env);
    if (orderMatch && request.method === "GET") return await getOrder(orderMatch[1], env);
    if (isWebhook && request.method === "POST") return await handlePixWebhook(request, env);
    return json({ error: "Método não permitido.", code: "method_not_allowed" }, 405);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: "Dados inválidos.", code: "invalid_input" }, 400);
    if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
    console.error("checkout_request_failed", error);
    return json({ error: "Serviço temporariamente indisponível.", code: "temporarily_unavailable" }, 503);
  }
}
