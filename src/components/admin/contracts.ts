import { z } from "zod";
export const overviewSchema = z.object({ stats: z.object({
  orders: z.object({ total_orders: z.number(), paid_cents: z.number(), paid_orders: z.number() }).nullable(),
  users: z.object({ total_users: z.number(), total_photographers: z.number(), total_buyers: z.number() }).nullable(),
  photos: z.number(),
}) });
export const ordersSchema = z.object({ orders: z.array(z.object({ id: z.string(), buyer_subject: z.string().nullable(), status: z.string(), item_count: z.number(), total_cents: z.number(), created_at: z.string() })) });
export type Order = z.infer<typeof ordersSchema>["orders"][number];
export const usersSchema = z.object({ users: z.array(z.object({ id: z.string(), email: z.string(), name: z.string(), role: z.enum(["admin", "photographer", "buyer"]), status: z.string(), created_at: z.string() })) });
export const ruleSchema = z.object({ id: z.string(), name: z.string(), version: z.number(), platform_fee_percent: z.number(), provider_fee_percent: z.number(), fixed_fee_cents: z.number(), provider_fee_bearer: z.enum(["platform", "photographer"]), hold_days: z.number(), created_at: z.string() });
export const rulesSchema = z.object({ rules: z.array(ruleSchema) });
