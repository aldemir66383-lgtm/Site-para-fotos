import { createRemoteJWKSet, jwtVerify } from "jose";
import { ApiError } from "../photos/contracts.js";
import type { Env } from "../photos/env.js";

export interface Session { id: string; role: string }
export type AuthenticateSession = (request: Request, env: Env) => Promise<Session>;
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const authenticateSession: AuthenticateSession = async (request, env) => {
  const authorization = request.headers.get("Authorization");
  let token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!authorization) {
    const cookie = request.headers.get("Cookie")?.split(";").map(c => c.trim()).find(c => c.startsWith("fv_session="));
    token = cookie?.slice("fv_session=".length);
    if (token && !["GET", "HEAD"].includes(request.method)
      && request.headers.get("Origin") !== new URL(request.url).origin) {
      throw new ApiError(403, "invalid_origin", "Origem da requisição inválida.");
    }
  }
  if (!token) throw new ApiError(401, "unauthenticated", "Autenticação necessária.");
  const url = new URL(env.AUTH_JWKS_URL);
  if (url.protocol !== "https:") throw new Error("AUTH_JWKS_URL must use HTTPS");
  let keySet = keySets.get(url.href);
  if (!keySet) { keySet = createRemoteJWKSet(url); keySets.set(url.href, keySet); }
  try {
    const { payload } = await jwtVerify(token, keySet, {
      issuer: env.AUTH_ISSUER, audience: env.AUTH_AUDIENCE,
      algorithms: ["RS256", "ES256"], requiredClaims: ["sub", "exp", "iat"],
    });
    if (!payload.sub || payload.sub.length > 200 || typeof payload.role !== "string") throw new Error("Invalid session claims");
    return { id: payload.sub, role: payload.role };
  } catch { throw new ApiError(401, "unauthenticated", "Sessão inválida ou expirada."); }
};
