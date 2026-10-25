import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authenticatePhotographer } from "../src/server/photos/auth.js";
import { authenticateSession } from "../src/server/auth/session.js";
import { testEnvironment } from "./helpers.js";

let key: CryptoKey;
let jwks: unknown;
beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  key = pair.privateKey;
  jwks = { keys: [{ ...await exportJWK(pair.publicKey), kid: "test-key", alg: "ES256", use: "sig" }] };
});
afterEach(() => vi.unstubAllGlobals());

async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ sub: "owner", role: "photographer", ...overrides })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuer("https://auth.example.test").setAudience("studio").setIssuedAt().setExpirationTime("5m").sign(key);
}
const request = (jwt: string) => new Request("https://fotoviva.test", { headers: { Authorization: `Bearer ${jwt}` } });

describe("JWT do fotógrafo", () => {
  it("valida assinatura, emissor, público, expiração e papel", async () => {
    const { env } = testEnvironment();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(jwks)));
    await expect(authenticatePhotographer(request(await token()), env)).resolves.toEqual({ id: "owner" });
    await expect(authenticatePhotographer(request(await token({ role: "buyer" })), env)).rejects.toMatchObject({ status: 401 });
    await expect(authenticatePhotographer(request(await token()), { ...env, AUTH_AUDIENCE: "different" })).rejects.toMatchObject({ status: 401 });
    await expect(authenticatePhotographer(request(await token()), { ...env, AUTH_ISSUER: "https://evil.test" })).rejects.toMatchObject({ status: 401 });
    const expired = await new SignJWT({ sub: "owner", role: "photographer" }).setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(env.AUTH_ISSUER).setAudience(env.AUTH_AUDIENCE).setIssuedAt().setExpirationTime(1).sign(key);
    await expect(authenticatePhotographer(request(expired), env)).rejects.toMatchObject({ status: 401 });
    const forged = `${await token()}extra`;
    await expect(authenticatePhotographer(request(forged), env)).rejects.toMatchObject({ status: 401 });
    await expect(authenticatePhotographer(request("eyJhbGciOiJub25lIn0.eyJzdWIiOiJvd25lciJ9."), env)).rejects.toMatchObject({ status: 401 });
  });

  it("aceita cookie assinado para navegação e exige Origin em mutações por cookie", async () => {
    const { env } = testEnvironment();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(jwks)));
    const jwt = await token({ role: "buyer" });
    const headers = { Cookie: `fv_session=${jwt}` };
    await expect(authenticateSession(new Request("https://fotoviva.test", { headers }), env)).resolves.toEqual({ id: "owner", role: "buyer" });
    await expect(authenticateSession(new Request("https://fotoviva.test", { method: "POST", headers }), env)).rejects.toMatchObject({ status: 403 });
    await expect(authenticateSession(new Request("https://fotoviva.test", { method: "POST", headers: { ...headers, Origin: "https://evil.test" } }), env)).rejects.toMatchObject({ status: 403 });
    await expect(authenticateSession(new Request("https://fotoviva.test", { method: "POST", headers: { ...headers, Origin: "https://fotoviva.test" } }), env)).resolves.toMatchObject({ role: "buyer" });
  });
});
