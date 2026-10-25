import { ApiError } from "../photos/contracts.js";
import { json } from "../photos/handlers.js";
import type { Env } from "../photos/env.js";
import { ACCESS_WINDOW_MS } from "../finance/settlement.js";

export const MAX_ZIP_PHOTOS = 1000;
export type TicketKind = "single" | "zip";
export type DeliveryOutcome = "issued" | "started" | "served" | "expired" | "reused" | "denied" | "revoked" | "storage_error" | "cancelled" | "rate_limited" | "download_limit";
export interface DeliveryItem { entitlement_id: string; photo_id: string; original_r2_key: string }
interface Ticket { token_hash: string; order_id: string; buyer_subject: string; kind: TicketKind; used: number; expires_at: string; claim_id: string | null; item_count: number }

// Numbered parameters: 1=ISO now, 2=epoch ms now, 3=subject, 4=order.
export function bind(db: D1Database, sql: string, params: (string | number | null)[]) {
  const n = Math.max(0, ...Array.from(sql.matchAll(/\?(\d+)/g), m => Number(m[1])));
  return db.prepare(sql).bind(...params.slice(0, n));
}
const FROM = `FROM download_entitlements e JOIN orders o ON o.id=e.order_id
  JOIN order_items i ON i.id=e.order_item_id JOIN photos p ON p.id=e.photo_id`;
const RIGHT = `e.status='active' AND julianday(e.expires_at)>julianday(?1)
  AND e.granted_event_id=o.paid_event_id AND e.granted_at_ms=o.paid_at_ms
  AND o.status IN ('paid','partially_refunded') AND o.paid_at_ms <= ?2 AND o.paid_at_ms + ${ACCESS_WINDOW_MS} > ?2
  AND o.buyer_subject=?3 AND e.buyer_subject=?3 AND e.order_id=?4
  AND i.order_id=o.id AND i.photo_id=e.photo_id AND p.status='verified'
  AND p.original_r2_key LIKE 'originals/%' AND p.original_r2_key NOT LIKE 'originals/pending/%'`;
const SELECTION = `${RIGHT} AND e.downloads_left>0 AND (?5='' OR e.photo_id=?5)`;
const RATE_LIMIT = `(SELECT count(*) FROM delivery_ticket_items ri JOIN delivery_tickets rt ON rt.token_hash=ri.ticket_hash
  WHERE ri.entitlement_id=e.id AND rt.issued_at_ms > ?2 - 3600000) < 10`;

export async function auditDelivery(db: D1Database, subject: string, orderId: string | null, hash: string | null,
  outcome: DeliveryOutcome, bytes = 0) {
  await db.prepare("INSERT INTO delivery_log (id,ticket_hash,order_id,buyer_subject,outcome,bytes,at_ms) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), hash, orderId, subject, outcome, bytes, Date.now()).run();
}

export async function tokenHash(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

export async function issueTicket(env: Env, subject: string, orderId: string, photoId: string | null, now = Date.now()): Promise<Response> {
  const order = await env.DB.prepare("SELECT item_count FROM orders WHERE id=? AND buyer_subject=?").bind(orderId, subject).first<{ item_count: number }>();
  if (!order) {
    await auditDelivery(env.DB, subject, null, null, "denied");
    throw new ApiError(404, "not_found", "Pedido não encontrado.");
  }
  const count = photoId ? 1 : order.item_count;
  if (count < 1 || count > MAX_ZIP_PHOTOS) throw new ApiError(409, "package_limit", "Pedido fora do limite de fotos por pacote.");
  const kind: TicketKind = photoId ? "single" : "zip";
  const token = newToken(), hash = await tokenHash(token);
  const expiresAt = new Date(now + 60_000).toISOString();
  const params = [new Date(now).toISOString(), now, subject, orderId, photoId ?? "", kind, hash, expiresAt, crypto.randomUUID(), count];
  await env.DB.batch([
    bind(env.DB, `INSERT INTO delivery_tickets
      (token_hash,entitlement_id,photo_id,buyer_subject,expires_at,order_id,kind,issued_at_ms,item_count)
      SELECT ?7,e.id,e.photo_id,?3,?8,?4,?6,?2,?10 ${FROM} WHERE ${SELECTION}
      AND (SELECT count(*) ${FROM} WHERE ${SELECTION})=?10
      AND NOT EXISTS (SELECT 1 ${FROM} WHERE ${SELECTION} AND NOT (${RATE_LIMIT}))
      ORDER BY e.id LIMIT 1`, params),
    bind(env.DB, `INSERT INTO delivery_ticket_items(ticket_hash, entitlement_id)
      SELECT ?7,e.id ${FROM} WHERE ${SELECTION} AND EXISTS (SELECT 1 FROM delivery_tickets WHERE token_hash=?7)`, params),
    bind(env.DB, `INSERT INTO delivery_log (id,ticket_hash,order_id,buyer_subject,outcome,at_ms)
      SELECT ?9,?7,?4,?3,'issued',?2 WHERE EXISTS (SELECT 1 FROM delivery_tickets WHERE token_hash=?7)`, params),
  ]);
  const issued = await env.DB.prepare("SELECT token_hash FROM delivery_tickets WHERE token_hash=?").bind(hash).first();
  if (!issued) {
    const eligible = await bind(env.DB, `SELECT count(*) AS n ${FROM} WHERE ${SELECTION}`, params).first<{ n: number }>();
    const limited = eligible?.n === count;
    await auditDelivery(env.DB, subject, orderId, null, limited ? "rate_limited" : "denied");
    throw new ApiError(limited ? 429 : 404, limited ? "rate_limited" : "not_found",
      limited ? "Limite de 10 tickets por foto por hora atingido." : "Fotos indisponíveis para download.");
  }
  return json({ url: kind === "zip"
    ? `/api/fotoviva/orders/${orderId}/download-all-zip?ticket=${token}`
    : `/api/fotoviva/deliveries/${token}`, expiresAt }, 201);
}

export async function claimTicket(env: Env, subject: string, token: string, kind: TicketKind, requestedOrderId?: string, now = Date.now()) {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new ApiError(404, "not_found", "Ticket não encontrado.");
  const hash = await tokenHash(token);
  const ticket = await env.DB.prepare("SELECT * FROM delivery_tickets WHERE token_hash=? AND buyer_subject=? AND kind=?")
    .bind(hash, subject, kind).first<Ticket>();
  if (!ticket || (requestedOrderId && requestedOrderId !== ticket.order_id)) {
    await auditDelivery(env.DB, subject, null, hash, "denied");
    throw new ApiError(404, "not_found", "Ticket não encontrado.");
  }
  const claimId = crypto.randomUUID();
  const params = [new Date(now).toISOString(), now, subject, ticket.order_id, hash, claimId];
  await env.DB.batch([
    bind(env.DB, `UPDATE delivery_tickets SET used=1,used_at_ms=?2,claim_id=?6
      WHERE token_hash=?5 AND buyer_subject=?3 AND used=0 AND julianday(expires_at)>julianday(?1)
      AND item_count=(SELECT count(*) FROM delivery_ticket_items WHERE ticket_hash=?5)
      AND item_count=(SELECT count(*) ${FROM} JOIN delivery_ticket_items ti ON ti.entitlement_id=e.id
        WHERE ti.ticket_hash=?5 AND ${RIGHT} AND e.downloads_left>0)`, params),
    bind(env.DB, `UPDATE download_entitlements SET downloads_left=downloads_left-1
      WHERE id IN (SELECT entitlement_id FROM delivery_ticket_items WHERE ticket_hash=?5)
      AND EXISTS (SELECT 1 FROM delivery_tickets WHERE token_hash=?5 AND claim_id=?6)`, params),
    bind(env.DB, `INSERT INTO delivery_log(id,ticket_hash,order_id,buyer_subject,outcome,at_ms)
      SELECT ?6,?5,?4,?3,'started',?2 WHERE EXISTS (SELECT 1 FROM delivery_tickets WHERE token_hash=?5 AND claim_id=?6)`, params),
  ]);
  const claimed = await env.DB.prepare("SELECT claim_id FROM delivery_tickets WHERE token_hash=?").bind(hash).first<{ claim_id: string }>();
  if (claimed?.claim_id !== claimId) {
    const fresh = await env.DB.prepare("SELECT used,expires_at FROM delivery_tickets WHERE token_hash=?").bind(hash).first<{ used: number; expires_at: string }>();
    const exhausted = await env.DB.prepare(`SELECT e.id FROM download_entitlements e
      JOIN delivery_ticket_items ti ON ti.entitlement_id=e.id WHERE ti.ticket_hash=? AND e.downloads_left <= 0 LIMIT 1`)
      .bind(hash).first();
    const outcome = fresh?.used ? "reused" : Date.parse(fresh?.expires_at ?? "") <= now ? "expired" : exhausted ? "download_limit" : "revoked";
    await auditDelivery(env.DB, subject, ticket.order_id, hash, outcome);
    throw new ApiError(outcome === "revoked" ? 404 : outcome === "download_limit" ? 409 : 410,
      outcome === "reused" ? "ticket_used" : outcome === "expired" ? "ticket_expired" : outcome === "download_limit" ? "download_limit" : "not_found", "Ticket indisponível para download.");
  }
  const items = await bind(env.DB, `SELECT e.id AS entitlement_id,e.photo_id,p.original_r2_key ${FROM}
    JOIN delivery_ticket_items ti ON ti.entitlement_id=e.id WHERE ti.ticket_hash=?5 AND ${RIGHT} ORDER BY i.id`, params).all<DeliveryItem>();
  if (items.results.length !== ticket.item_count) {
    await auditDelivery(env.DB, subject, ticket.order_id, hash, "revoked");
    throw new ApiError(404, "not_found", "Direitos de download indisponíveis.");
  }
  return { hash, orderId: ticket.order_id, items: items.results };
}

export async function requireCurrentRight(env: Env, subject: string, orderId: string, item: DeliveryItem): Promise<void> {
  const now = Date.now();
  const row = await bind(env.DB, `SELECT e.id ${FROM} WHERE ${RIGHT} AND e.id=?5 AND p.original_r2_key=?6`,
    [new Date(now).toISOString(), now, subject, orderId, item.entitlement_id, item.original_r2_key]).first();
  if (!row) throw new ApiError(404, "right_revoked", "Direito de download revogado ou expirado.");
}
