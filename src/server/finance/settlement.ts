import { z } from "zod";
import { ApiError } from "../photos/contracts.js";
import { paymentPostings, postingStatements, MAX_CENTS } from "./ledger.js";
import type { CommissionRule, OrderLine } from "./money.js";
import type { Env } from "../photos/env.js";
import {
  dispatchOrderWhatsApp,
  WHATSAPP_POLICY_VERSION,
} from "../notifications/whatsapp.js";

export const ACCESS_WINDOW_MS = 30 * 24 * 60 * 60_000;
const eventSchema = z
  .object({
    provider: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    providerEventId: z.string().min(1).max(200),
    txid: z.string().min(1).max(200),
    amountCents: z.number().int().positive().max(MAX_CENTS),
  })
  .strict();
export type VerifiedPaidEvent = z.infer<typeof eventSchema>;

/** Call only from a PSP adapter AFTER verifying authenticity and settled status. Never expose to buyer requests. */
export async function settleVerifiedPayment(
  backend: D1Database | Env,
  input: VerifiedPaidEvent,
  now = Date.now(),
  ctx?: Pick<ExecutionContext, "waitUntil">,
) {
  const env = "DB" in backend ? backend : undefined;
  const db = env?.DB ?? (backend as D1Database);
  const event = eventSchema.parse(input);
  const order = await db
    .prepare(
      `SELECT o.*, c.provider FROM orders o JOIN payment_charges c ON c.order_id=o.id
    WHERE c.provider=? AND c.txid=?`,
    )
    .bind(event.provider, event.txid)
    .first<{
      id: string;
      total_cents: number;
      item_count: number;
      commission_rule_id: string;
      status: string;
    }>();
  if (!order)
    throw new ApiError(404, "unknown_charge", "Cobrança não encontrada.");
  if (order.total_cents !== event.amountCents)
    throw new ApiError(409, "amount_mismatch", "Valor divergente.");
  const rule = await db
    .prepare(
      `SELECT id, version, platform_fee_bps AS platformFeeBps,
    provider_fee_bps AS providerFeeBps, provider_fee_fixed_cents AS providerFeeFixedCents,
    provider_fee_bearer AS providerFeeBearer, hold_days AS holdDays FROM commission_rules WHERE id=?`,
    )
    .bind(order.commission_rule_id)
    .first<CommissionRule & { holdDays: number }>();
  if (!rule)
    throw new ApiError(
      409,
      "commission_rule_missing",
      "Regra de comissão indisponível.",
    );
  const items = await db
    .prepare(
      `SELECT photographer_id AS photographerId, unit_price_cents AS unitPriceCents
    FROM order_items WHERE order_id=? ORDER BY id`,
    )
    .bind(order.id)
    .all<OrderLine>();
  if (
    items.results.length !== order.item_count ||
    items.results.length > 1000 ||
    items.results.reduce((s, l) => s + l.unitPriceCents, 0) !==
      order.total_cents
  ) {
    throw new ApiError(
      409,
      "order_snapshot_invalid",
      "Snapshot do pedido inconsistente.",
    );
  }
  const postings = paymentPostings(
    items.results,
    rule,
    event.provider,
    now + rule.holdDays * 86_400_000,
  );
  const operationId = crypto.randomUUID();
  const actor = `psp:${event.provider}`;
  const nowIso = new Date(now).toISOString();
  const gate = "EXISTS (SELECT 1 FROM orders WHERE id=? AND paid_event_id=?)";
  await db.batch([
    db
      .prepare(
        `INSERT INTO payment_events (id, provider, provider_event_id, txid, amount_cents, outcome, occurred_at)
      VALUES (?, ?, ?, ?, ?, 'received', ?) ON CONFLICT(provider, provider_event_id) DO NOTHING`,
      )
      .bind(
        operationId,
        event.provider,
        event.providerEventId,
        event.txid,
        event.amountCents,
        nowIso,
      ),
    db
      .prepare(
        `UPDATE orders SET status='paid', paid_event_id=?, paid_at_ms=?, updated_at=?
      WHERE id=? AND status='pending' AND julianday(expires_at)>julianday(?)
      AND total_cents=? AND EXISTS (SELECT 1 FROM payment_events WHERE id=?)
      AND EXISTS (SELECT 1 FROM payment_charges WHERE txid=? AND provider=? AND status='pending'
        AND julianday(expires_at)>julianday(?))
      AND NOT EXISTS (SELECT 1 FROM ledger_postings WHERE posting_key='payment:' || orders.id)
      AND (SELECT count(*) FROM order_items WHERE order_id=orders.id)=orders.item_count
      AND (SELECT sum(unit_price_cents) FROM order_items WHERE order_id=orders.id)=orders.total_cents`,
      )
      .bind(
        operationId,
        now,
        nowIso,
        order.id,
        nowIso,
        event.amountCents,
        operationId,
        event.txid,
        event.provider,
        nowIso,
      ),
    ...postingStatements(
      db,
      `payment:${order.id}`,
      operationId,
      actor,
      order.id,
      postings,
      now,
      gate,
      [order.id, operationId],
    ),
    db
      .prepare(
        `UPDATE payment_charges SET status='paid', updated_at=? WHERE txid=? AND provider=? AND ${gate}`,
      )
      .bind(nowIso, event.txid, event.provider, order.id, operationId),
    db
      .prepare(
        `INSERT INTO download_entitlements
      (id, order_item_id, order_id, photo_id, buyer_subject, status, downloads_left, expires_at, granted_event_id, granted_at_ms)
      SELECT lower(hex(randomblob(16))), i.id, i.order_id, i.photo_id, o.buyer_subject, 'active', 5, ?, ?, ?
      FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.id=? AND o.paid_event_id=?`,
      )
      .bind(
        new Date(now + ACCESS_WINDOW_MS).toISOString(),
        operationId,
        now,
        order.id,
        operationId,
      ),
    db
      .prepare(
        `UPDATE payment_events SET outcome=CASE
      WHEN EXISTS (SELECT 1 FROM orders WHERE id=? AND paid_event_id=?) THEN 'applied'
      WHEN EXISTS (SELECT 1 FROM orders WHERE id=? AND paid_at_ms IS NOT NULL) THEN 'already_paid'
      ELSE 'not_pending_or_expired' END WHERE id=?`,
      )
      .bind(order.id, operationId, order.id, operationId),
    db
      .prepare(
        `INSERT INTO whatsapp_outbox(id,order_id,next_attempt_at_ms,created_at_ms)
      SELECT lower(hex(randomblob(16))),id,?,? FROM orders WHERE id=? AND paid_event_id=?
      AND buyer_phone_e164 IS NOT NULL AND whatsapp_opt_in_at_ms IS NOT NULL AND whatsapp_opt_in_version=?
      ON CONFLICT(order_id) DO NOTHING`,
      )
      .bind(now, now, order.id, operationId, WHATSAPP_POLICY_VERSION),
  ]);
  const result = await db
    .prepare(
      `SELECT txid, amount_cents, outcome FROM payment_events WHERE provider=? AND provider_event_id=?`,
    )
    .bind(event.provider, event.providerEventId)
    .first<{ txid: string; amount_cents: number; outcome: string }>();
  if (
    result?.txid !== event.txid ||
    result.amount_cents !== event.amountCents
  ) {
    throw new ApiError(
      409,
      "event_conflict",
      "Evento já associado a outra cobrança.",
    );
  }
  if (env && result.outcome === "applied") {
    const delivery = dispatchOrderWhatsApp(env, order.id).catch(() => {
      console.error("whatsapp_dispatch_deferred");
    });
    if (ctx) ctx.waitUntil(delivery);
    else await delivery;
  }
  return { orderId: order.id, outcome: result.outcome };
}
