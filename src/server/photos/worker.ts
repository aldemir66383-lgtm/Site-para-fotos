import { handleRequest } from "./handlers.js";
import { consumePhotos, recoverPhotos } from "./processing.js";
import type { Env } from "./env.js";
import type { PhotoJob } from "./contracts.js";
import { handleCommerceRequest } from "../delivery/handlers.js";
import { handleCheckoutRequest } from "../finance/checkout.js";

export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) =>
    await handleCheckoutRequest(request, env) ??
    await handleCommerceRequest(request, env, ctx) ??
    handleRequest(request, env),
  queue: (batch: MessageBatch<PhotoJob>, env: Env) => consumePhotos(batch, env),
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(recoverPhotos(env));
  },
} satisfies ExportedHandler<Env, PhotoJob>;
