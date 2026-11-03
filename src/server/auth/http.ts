import type { Env } from "../photos/env.js";

/** Same-origin cookies and explicitly configured frontend origins only. */
export function authHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get("Origin");
  const allowed = new Set([new URL(request.url).origin, env.PUBLIC_SITE_URL].filter(Boolean));
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
  if (origin && allowed.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  return headers;
}

export function validMutationOrigin(request: Request, env: Env): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("Origin");
  // Non-browser clients may authenticate with a bearer token.
  if (!origin) return !request.headers.has("Cookie");
  return origin === new URL(request.url).origin || origin === env.PUBLIC_SITE_URL;
}
