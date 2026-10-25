import { z } from "zod";
import { authenticateSession, type AuthenticateSession } from "../auth/session.js";
import { ApiError } from "../photos/contracts.js";
import type { Env } from "../photos/env.js";
import { json } from "../photos/handlers.js";
import { balanceResponse, requestPayout } from "../finance/payouts.js";
import { auditDelivery, claimTicket, issueTicket, requireCurrentRight } from "./tickets.js";
import { streamOriginal, streamZip } from "./stream-zip.js";

const ID = "([a-zA-Z0-9_-]{1,100})";
const securityHeaders = {
  "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
};

export async function handleCommerceRequest(request: Request, env: Env, ctx?: Pick<ExecutionContext, "waitUntil">,
  authenticate: AuthenticateSession = authenticateSession): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const single = path.match(new RegExp(`^/api/fotoviva/orders/${ID}/photos/${ID}/ticket$`));
  const zipTicket = path.match(new RegExp(`^/api/fotoviva/orders/${ID}/download-all-zip/ticket$`));
  const zipDownload = path.match(new RegExp(`^/api/fotoviva/orders/${ID}/download-all-zip$`));
  const delivery = path.match(/^\/api\/fotoviva\/deliveries\/([a-zA-Z0-9_-]{43})$/);
  const payout = path === "/api/fotoviva/photographer/payouts";
  const balance = path === "/api/fotoviva/photographer/balance";
  if (!single && !zipTicket && !zipDownload && !delivery && !payout && !balance) return null;
  try {
    const session = await authenticate(request, env);
    if (payout || balance) {
      if (session.role !== "photographer") throw new ApiError(403, "photographer_required", "Acesso restrito a fotógrafos.");
      if (payout && request.method === "POST") return await requestPayout(request, env, session.id);
      if (balance && request.method === "GET") return await balanceResponse(env, session.id);
    } else {
      if (!["buyer", "photographer"].includes(session.role)) throw new ApiError(403, "buyer_required", "Sessão de comprador necessária.");
      if (single && request.method === "POST") return await issueTicket(env, session.id, single[1], single[2]);
      if (zipTicket && request.method === "POST") return await issueTicket(env, session.id, zipTicket[1], null);
      if ((zipDownload || delivery) && request.method === "GET") {
        const token = zipDownload ? new URL(request.url).searchParams.get("ticket") ?? "" : delivery![1];
        const claim = await claimTicket(env, session.id, token, zipDownload ? "zip" : "single", zipDownload?.[1]);
        const report = (outcome: Parameters<typeof auditDelivery>[4], bytes: number) =>
          auditDelivery(env.DB, session.id, claim.orderId, claim.hash, outcome, bytes);
        const open = async (item: (typeof claim.items)[number]) => {
          await requireCurrentRight(env, session.id, claim.orderId, item);
          const object = await env.PHOTOS.get(item.original_r2_key);
          if (!object) throw new ApiError(503, "original_unavailable", "Original temporariamente indisponível.");
          return object.body;
        };
        if (zipDownload) {
          const output = streamZip(claim.items.map((item, i) => ({
            filename: `aire-photos-${String(i + 1).padStart(4, "0")}-${item.photo_id.replace(/[^a-zA-Z0-9_-]/g, "_")}.jpg`,
            open: () => open(item),
          })), report);
          ctx?.waitUntil(output.completion);
          return new Response(output.stream, { headers: { ...securityHeaders, "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="aire-photos-evento-${claim.orderId}.zip"` } });
        }
        let input: ReadableStream<Uint8Array>;
        try { input = await open(claim.items[0]); }
        catch (error) { await report(error instanceof ApiError && error.code === "right_revoked" ? "revoked" : "storage_error", 0); throw error; }
        const output = streamOriginal(input, report);
        ctx?.waitUntil(output.completion);
        return new Response(output.stream, { headers: { ...securityHeaders, "Content-Type": "image/jpeg",
          "Content-Disposition": `attachment; filename="aire-photos-${claim.items[0].photo_id.slice(0, 8)}.jpg"` } });
      }
    }
    return json({ error: "Método não permitido.", code: "method_not_allowed" }, 405);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: "Dados inválidos.", code: "invalid_input" }, 400);
    if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
    console.error("commerce_request_failed");
    return json({ error: "Serviço temporariamente indisponível.", code: "temporarily_unavailable" }, 503);
  }
}
