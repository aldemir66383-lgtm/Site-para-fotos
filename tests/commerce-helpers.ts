import { testEnvironment } from "./helpers.js";
import { settleVerifiedPayment } from "../src/server/finance/settlement.js";

export const buyer = async () => ({ id: "buyer-1", role: "buyer" });
export const photographer = async () => ({ id: "owner", role: "photographer" });
export const paymentEvent = { provider: "lab", providerEventId: "paid-1", txid: "tx-1", amountCents: 4500 };

export async function commerceEnvironment(options: { paidAt?: number; settle?: boolean; holdDays?: number } = {}) {
  const context = testEnvironment();
  const { sqlite, env, bucket } = context;
  env.PAYOUT_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 42).toString("base64");
  const now = options.paidAt ?? Date.now();
  sqlite.prepare(`INSERT INTO commission_rules
    (id,version,platform_fee_bps,provider_fee_bps,provider_fee_fixed_cents,provider_fee_bearer,hold_days)
    VALUES ('rule',1,2000,99,0,'platform',?)`).run(options.holdDays ?? 7);
  sqlite.prepare(`INSERT INTO orders
    (id,buyer_subject,idempotency_key,status,item_count,total_cents,commission_rule_id,expires_at)
    VALUES ('order-1','buyer-1','order-create','pending',3,4500,'rule',?)`).run(new Date(now + 900_000).toISOString());
  const photoIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  for (let i = 0; i < photoIds.length; i++) {
    const id = photoIds[i];
    sqlite.prepare(`INSERT INTO photos
      (id,album_id,photographer_id,preview_url,original_r2_key,status) VALUES (?,'album-1','owner','',?,'draft')`)
      .run(id, `originals/${id}.jpg`);
    sqlite.prepare("INSERT INTO photo_exif (photo_id) VALUES (?)").run(id);
    sqlite.prepare(`UPDATE photos SET status='verified',preview_url=?,preview_r2_key=?,approved_at=?,pipeline_version='test' WHERE id=?`)
      .run(`/api/fotoviva/previews/${id}`, `previews/${id}.webp`, new Date(now).toISOString(), id);
    sqlite.prepare("INSERT INTO order_items (id,order_id,photo_id,photographer_id,unit_price_cents) VALUES (?,'order-1',?,'owner',1500)").run(`item-${i}`, id);
    await bucket.put(`originals/${id}.jpg`, new TextEncoder().encode(`synthetic-original-full-resolution-${i}`), { httpMetadata: { contentType: "image/jpeg" } });
  }
  sqlite.prepare("INSERT INTO payment_charges (txid,order_id,provider,status,expires_at) VALUES ('tx-1','order-1','lab','pending',?)")
    .run(new Date(now + 900_000).toISOString());
  if (options.settle !== false) await settleVerifiedPayment(env.DB, paymentEvent, now);
  return { ...context, photoIds, paidAt: now };
}

export function api(path: string, method = "GET", body?: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request(`https://fotoviva.test/api/fotoviva/${path}`, {
    method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
