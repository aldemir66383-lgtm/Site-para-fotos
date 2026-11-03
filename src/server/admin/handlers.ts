import { z } from "zod";
import type { Env } from "../photos/env.js";
import { parseNativeSession } from "../auth/native-auth.js";
import { authHeaders, validMutationOrigin } from "../auth/http.js";

const percent = z.number().min(0).max(100).multipleOf(0.01);
const commissionRuleSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(100),
  platformFeePercent: percent,
  providerFeePercent: percent,
  fixedFeeCents: z.number().int().min(0).max(1_000_000_000_000),
  providerFeeBearer: z.enum(["platform", "photographer"]),
  holdDays: z.number().int().min(0).max(365),
}).strict();

export async function handleAdminRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/admin/")) return null;
  const headers = authHeaders(request, env);
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!validMutationOrigin(request, env)) return json({ error: "invalid_origin" }, 403);
  const session = await parseNativeSession(request, env);
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (session.role !== "admin") return json({ error: "forbidden" }, 403);
  try {
    if (url.pathname === "/api/admin/overview" && request.method === "GET") {
      const [orders, users, photos] = await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) AS total_orders,
          COALESCE(SUM(CASE WHEN status = 'paid' THEN total_cents ELSE 0 END), 0) AS paid_cents,
          COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paid_orders FROM orders`).first(),
        env.DB.prepare(`SELECT COUNT(*) AS total_users,
          COUNT(CASE WHEN role = 'photographer' THEN 1 END) AS total_photographers,
          COUNT(CASE WHEN role = 'buyer' THEN 1 END) AS total_buyers FROM users`).first(),
        env.DB.prepare("SELECT COUNT(*) AS count FROM photos WHERE status = 'verified' AND approved_at IS NOT NULL").first<{ count: number }>(),
      ]);
      return json({ stats: { orders, users, photos: photos?.count ?? 0 } });
    }
    if (url.pathname === "/api/admin/orders" && request.method === "GET") {
      const orders = await env.DB.prepare("SELECT id, buyer_subject, status, item_count, total_cents, created_at FROM orders ORDER BY created_at DESC, id DESC LIMIT 50").all();
      return json({ orders: orders.results });
    }
    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      const users = await env.DB.prepare("SELECT id, email, name, role, status, created_at FROM users ORDER BY created_at DESC, id DESC LIMIT 100").all();
      return json({ users: users.results });
    }
    if (url.pathname === "/api/admin/commission-rules" && request.method === "GET") {
      const rules = await env.DB.prepare(`SELECT id, name, version,
        platform_fee_bps / 100.0 AS platform_fee_percent,
        provider_fee_bps / 100.0 AS provider_fee_percent,
        provider_fee_fixed_cents AS fixed_fee_cents, provider_fee_bearer, hold_days, created_at
        FROM commission_rules ORDER BY version DESC, rowid DESC`).all();
      return json({ rules: rules.results });
    }
    if (url.pathname === "/api/admin/commission-rules" && request.method === "POST") {
      const parsed = commissionRuleSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return json({ error: "invalid_input", details: parsed.error.issues }, 400);
      const input = parsed.data;
      const id = crypto.randomUUID();
      // A single statement allocates the version; old orders keep their original rule ID.
      await env.DB.prepare(`INSERT INTO commission_rules
        (id, name, version, platform_fee_bps, provider_fee_bps, provider_fee_fixed_cents, provider_fee_bearer, hold_days)
        SELECT ?, ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?, ?, ? FROM commission_rules`)
        .bind(id, input.name, Math.round(input.platformFeePercent * 100), Math.round(input.providerFeePercent * 100), input.fixedFeeCents, input.providerFeeBearer, input.holdDays).run();
      return json({ success: true, id }, 201);
    }
    return json({ error: "not_found" }, 404);
  } catch {
    return json({ error: "server_error" }, 500);
  }
}
