import { z } from "zod";
import { ApiError, readLimited } from "../photos/contracts.js";
import type { Env } from "../photos/env.js";
import {
  authenticateSession,
  type AuthenticateSession,
} from "../auth/session.js";
import { json } from "../photos/handlers.js";

export const WHATSAPP_POLICY_VERSION = "aire-whatsapp-v1";
const contactSchema = z.union([
  z.object({ enabled: z.literal(false) }).strict(),
  z
    .object({
      enabled: z.literal(true),
      phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
      policyVersion: z.literal(WHATSAPP_POLICY_VERSION),
    })
    .strict(),
]);

export async function handleWhatsAppContact(
  request: Request,
  env: Env,
  authenticate: AuthenticateSession = authenticateSession,
): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(
    /^\/api\/fotoviva\/orders\/([a-zA-Z0-9_-]{1,100})\/whatsapp-contact$/,
  );
  if (!match) return null;
  try {
    const user = await authenticate(request, env);
    if (!["buyer", "photographer"].includes(user.role))
      throw new ApiError(403, "forbidden", "Sessão de comprador necessária.");
    if (request.method !== "PUT")
      throw new ApiError(405, "method_not_allowed", "Método não permitido.");
    if (
      request.headers.get("Content-Type")?.split(";")[0].trim() !==
      "application/json"
    )
      throw new ApiError(415, "unsupported_media_type", "Envie JSON.");
    let raw: unknown;
    try {
      raw = JSON.parse(
        new TextDecoder().decode(await readLimited(request.body, 2048)),
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "invalid_input", "JSON inválido.");
    }
    const input = contactSchema.parse(raw);
    const order = await env.DB.prepare(
      "SELECT status FROM orders WHERE id=? AND buyer_subject=?",
    )
      .bind(match[1], user.id)
      .first<{ status: string }>();
    if (!order) throw new ApiError(404, "not_found", "Pedido não encontrado.");
    if (input.enabled) {
      const result = await env.DB.prepare(
        `UPDATE orders SET buyer_phone_e164=?,whatsapp_opt_in_at_ms=?,whatsapp_opt_in_version=?
        WHERE id=? AND buyer_subject=? AND status='pending'`,
      )
        .bind(input.phone, Date.now(), input.policyVersion, match[1], user.id)
        .run();
      if (result.meta.changes !== 1)
        throw new ApiError(
          409,
          "order_not_pending",
          "Cadastre o telefone e aceite o WhatsApp antes de concluir o pagamento.",
        );
    } else
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE orders SET buyer_phone_e164=NULL,whatsapp_opt_in_at_ms=NULL,whatsapp_opt_in_version=NULL WHERE id=? AND buyer_subject=?",
        ).bind(match[1], user.id),
        env.DB.prepare(
          "UPDATE whatsapp_outbox SET state='skipped',error_code='opt_out' WHERE order_id=? AND state='pending'",
        ).bind(match[1]),
      ]);
    return json({ enabled: input.enabled });
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        { error: "Telefone ou consentimento inválido.", code: "invalid_input" },
        400,
      );
    if (error instanceof ApiError)
      return json({ error: error.message, code: error.code }, error.status);
    console.error("whatsapp_contact_failed");
    return json(
      {
        error: "Serviço temporariamente indisponível.",
        code: "temporarily_unavailable",
      },
      503,
    );
  }
}

function configuration(env: Env) {
  if (env.WHATSAPP_ENABLED !== "on") return null;
  if (
    !env.WHATSAPP_ACCESS_TOKEN ||
    !/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID ?? "") ||
    !/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION ?? "") ||
    !/^\w{1,128}$/.test(env.WHATSAPP_TEMPLATE_NAME ?? "") ||
    !env.PUBLIC_SITE_URL
  )
    return null;
  const base = new URL(env.PUBLIC_SITE_URL);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  )
    throw new Error("Invalid Aire Photos public origin");
  return {
    url: `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    base: base.origin,
  };
}

/** Records provider acceptance, not recipient delivery. Ambiguous sends are never retried blindly. */
export async function dispatchOrderWhatsApp(
  env: Env,
  orderId: string,
  now = Date.now(),
): Promise<void> {
  const config = configuration(env);
  if (!config) return;
  const token = crypto.randomUUID();
  const claim = await env.DB.prepare(
    `UPDATE whatsapp_outbox SET state='sending',attempts=attempts+1,lease_token=?,lease_until_ms=?
    WHERE order_id=? AND state='pending' AND next_attempt_at_ms<=? AND attempts<5 RETURNING id,attempts`,
  )
    .bind(token, now + 120_000, orderId, now)
    .first<{ id: string; attempts: number }>();
  if (!claim) return;
  const finish = async (
    state: string,
    error: string | null,
    messageId: string | null = null,
    next = now,
  ) => {
    await env.DB.prepare(
      `UPDATE whatsapp_outbox SET state=?,error_code=?,provider_message_id=?,next_attempt_at_ms=?,
      accepted_at_ms=?,lease_token=NULL,lease_until_ms=NULL WHERE id=? AND lease_token=? AND state='sending'`,
    )
      .bind(
        state,
        error,
        messageId,
        next,
        state === "accepted" ? Date.now() : null,
        claim.id,
        token,
      )
      .run();
  };
  try {
    const order = await env.DB.prepare(
      `SELECT buyer_phone_e164 FROM orders WHERE id=? AND status IN ('paid','partially_refunded')
      AND whatsapp_opt_in_at_ms IS NOT NULL AND whatsapp_opt_in_version=? AND paid_at_ms+2592000000>?
      AND buyer_phone_e164 IS NOT NULL`,
    )
      .bind(orderId, WHATSAPP_POLICY_VERSION, now)
      .first<{ buyer_phone_e164: string }>();
    if (!order || !/^\+[1-9]\d{7,14}$/.test(order.buyer_phone_e164)) {
      await finish("skipped", "consent_or_order_unavailable");
      return;
    }
    const link = `${config.base}/minhas-fotos/${encodeURIComponent(orderId)}`;
    const response = await fetch(config.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: order.buyer_phone_e164.slice(1),
        type: "template",
        biz_opaque_callback_data: claim.id,
        template: {
          name: env.WHATSAPP_TEMPLATE_NAME,
          language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE ?? "pt_BR" },
          components: [
            { type: "body", parameters: [{ type: "text", text: link }] },
          ],
        },
      }),
    });
    if (response.status === 429) {
      const wait = Math.min(
        3600,
        Math.max(60, Number(response.headers.get("Retry-After")) || 60),
      );
      await response.body?.cancel();
      await finish(
        claim.attempts >= 5 ? "failed" : "pending",
        "provider_rate_limited",
        null,
        now + wait * 1000,
      );
      return;
    }
    if (!response.ok) {
      await response.body?.cancel();
      await finish(
        response.status >= 500 ? "uncertain" : "failed",
        `provider_http_${response.status}`,
      );
      return;
    }
    const payload = JSON.parse(
      new TextDecoder().decode(await readLimited(response.body, 64 * 1024)),
    ) as { messages?: { id?: unknown }[] };
    const id = payload.messages?.[0]?.id;
    if (typeof id !== "string" || !id || id.length > 500) {
      await finish("uncertain", "provider_invalid_receipt");
      return;
    }
    await finish("accepted", null, id);
  } catch {
    await finish("uncertain", "send_outcome_unknown");
  }
}

export async function drainWhatsAppOutbox(env: Env, limit = 20) {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE whatsapp_outbox SET state='uncertain',error_code='send_interrupted',lease_token=NULL,lease_until_ms=NULL
    WHERE state='sending' AND lease_until_ms<?`,
  )
    .bind(now)
    .run();
  if (!configuration(env)) return;
  const rows = await env.DB.prepare(
    `SELECT order_id FROM whatsapp_outbox WHERE state='pending' AND next_attempt_at_ms<=? AND attempts<5
    ORDER BY created_at_ms LIMIT ?`,
  )
    .bind(now, limit)
    .all<{ order_id: string }>();
  for (const row of rows.results)
    await dispatchOrderWhatsApp(env, row.order_id);
}
