import { handleRequest } from "./handlers.js";
import { consumePhotos } from "./processing.js";
import type { Env } from "./env.js";
import type { PhotoJob } from "./contracts.js";
import { handleCommerceRequest } from "../delivery/handlers.js";
import { handleCheckoutRequest } from "../finance/checkout.js";
import { handleFaceRequest } from "../search/face-handlers.js";
import { handleWhatsAppContact } from "../notifications/whatsapp.js";
import { runScheduled } from "../maintenance.js";

export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) =>
    (await handleFaceRequest(request, env)) ??
    (await handleWhatsAppContact(request, env)) ??
    (await handleCheckoutRequest(request, env, ctx)) ??
    (await handleCommerceRequest(request, env, ctx)) ??
    handleRequest(request, env),
  queue: (batch: MessageBatch<PhotoJob>, env: Env) => consumePhotos(batch, env),
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runScheduled(env, event.cron));
  },
} satisfies ExportedHandler<Env, PhotoJob>;
