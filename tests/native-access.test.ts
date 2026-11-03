import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleAuthRequest } from "../src/server/auth/handlers";
import { createSessionToken, hashPassword, parseNativeSession } from "../src/server/auth/native-auth";
import { handleAdminRequest } from "../src/server/admin/handlers";
import { handlePhotographerRequest } from "../src/server/photographer/handlers";
import { testEnvironment } from "./helpers";

let context: ReturnType<typeof testEnvironment>;
const origin = "https://fotoviva.test";
function request(path: string, method = "GET", body?: unknown, token?: string) {
  return new Request(`${origin}${path}`, { method, headers: { Origin: origin, "Content-Type": "application/json", ...(token ? { Cookie: `fv_session=${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function account(role: "admin" | "photographer" | "buyer") {
  const user = { id: crypto.randomUUID(), name: "Pessoa de teste", email: `${crypto.randomUUID()}@test.local`, role };
  const { hash, salt } = await hashPassword("test-password-private");
  context.sqlite.prepare("INSERT INTO users (id,email,name,role,password_hash,password_salt) VALUES (?,?,?,?,?,?)").run(user.id, user.email, user.name, role, hash, salt);
  return { user, token: await createSessionToken(user, context.env) };
}
beforeEach(() => { context = testEnvironment(); });
afterEach(() => context.sqlite.close());

describe("native access boundaries", () => {
  it("rejects public admin registration before inserting a user", async () => {
    const response = await handleAuthRequest(request("/api/auth/register", "POST", { name: "Intruso", email: "intruso@test.local", password: "password123", role: "admin" }), context.env);
    expect(response?.status).toBe(400);
    expect(context.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get()).toMatchObject({ count: 0 });
  });
  it("registers photographers, logs in, and exposes only public session fields", async () => {
    const body = { name: "  Fotógrafo Teste  ", email: "PHOTO@Test.local", password: "test-password", role: "photographer" };
    const registered = await handleAuthRequest(request("/api/auth/register", "POST", body), context.env);
    expect(registered?.status).toBe(201);
    expect(registered?.headers.get("Set-Cookie")).toContain("HttpOnly");
    const login = await handleAuthRequest(request("/api/auth/login", "POST", { email: "photo@test.local", password: body.password }), context.env);
    const result = await login!.json() as { token: string };
    const me = await handleAuthRequest(request("/api/auth/me", "GET", undefined, result.token), context.env);
    expect(await me!.json()).toEqual({ user: { id: expect.any(String), name: "Fotógrafo Teste", email: "photo@test.local", role: "photographer" } });
    const failed = await handleAuthRequest(request("/api/auth/login", "POST", { email: body.email, password: "wrong" }), context.env);
    expect(failed?.status).toBe(401);
  });
  it("enforces role boundaries on the server and reflects changed permissions", async () => {
    const photographer = await account("photographer");
    const buyer = await account("buyer");
    const admin = await account("admin");
    expect((await handleAdminRequest(request("/api/admin/overview"), context.env))?.status).toBe(401);
    for (const token of [photographer.token, buyer.token]) expect((await handleAdminRequest(request("/api/admin/overview", "GET", undefined, token), context.env))?.status).toBe(403);
    expect((await handleAdminRequest(request("/api/admin/overview", "GET", undefined, admin.token), context.env))?.status).toBe(200);
    expect((await handlePhotographerRequest(request("/api/photographer/photos", "GET", undefined, admin.token), context.env))?.status).toBe(403);
    context.sqlite.prepare("UPDATE users SET role='buyer' WHERE id=?").run(admin.user.id);
    expect((await handleAdminRequest(request("/api/admin/overview", "GET", undefined, admin.token), context.env))?.status).toBe(403);
  });
  it("revokes sessions on logout and rejects suspended accounts", async () => {
    const { token, user } = await account("admin");
    expect(await parseNativeSession(request("/api/auth/me", "GET", undefined, token), context.env)).not.toBeNull();
    const response = await handleAuthRequest(request("/api/auth/logout", "POST", undefined, token), context.env);
    expect(response?.status).toBe(200);
    expect(await parseNativeSession(request("/api/auth/me", "GET", undefined, token), context.env)).toBeNull();
    const another = await createSessionToken(user, context.env);
    context.sqlite.prepare("UPDATE users SET status='suspended' WHERE id=?").run(user.id);
    expect(await parseNativeSession(request("/api/auth/me", "GET", undefined, another), context.env)).toBeNull();
  });
  it("rejects cookie mutations from untrusted origins and has no default signing secret", async () => {
    const { token } = await account("admin");
    const crossOrigin = new Request(`${origin}/api/auth/logout`, { method: "POST", headers: { Origin: "https://localhost.evil.test", Cookie: `fv_session=${token}` } });
    expect((await handleAuthRequest(crossOrigin, context.env))?.status).toBe(403);
    const missing = { ...context.env, NATIVE_AUTH_SECRET: undefined };
    expect((await handleAuthRequest(request("/api/auth/login", "POST", { email: "a@b.com", password: "test" }), missing))?.status).toBe(503);
  });
  it("creates commission versions without rewriting past financial rules", async () => {
    const { token } = await account("admin");
    context.sqlite.prepare(`INSERT INTO commission_rules (id,version,platform_fee_bps,provider_fee_bps,provider_fee_fixed_cents,provider_fee_bearer,hold_days) VALUES ('original',1,2000,99,0,'platform',7)`).run();
    const original = context.sqlite.prepare("SELECT * FROM commission_rules WHERE id='original'").get();
    const body = { name: "Nova regra", platformFeePercent: 18.25, providerFeePercent: 0.99, fixedFeeCents: 125, providerFeeBearer: "platform", holdDays: 10 };
    const response = await handleAdminRequest(request("/api/admin/commission-rules", "POST", body, token), context.env);
    expect(response?.status).toBe(201);
    expect(context.sqlite.prepare("SELECT * FROM commission_rules WHERE id='original'").get()).toEqual(original);
    expect(context.sqlite.prepare("SELECT version,platform_fee_bps,provider_fee_fixed_cents,hold_days FROM commission_rules ORDER BY version DESC LIMIT 1").get()).toMatchObject({ version: 2, platform_fee_bps: 1825, provider_fee_fixed_cents: 125, hold_days: 10 });
    expect(() => context.sqlite.prepare("UPDATE commission_rules SET platform_fee_bps=0 WHERE id='original'").run()).toThrow("immutable");
    const loaded = await handleAdminRequest(request("/api/admin/commission-rules", "GET", undefined, token), context.env);
    expect(await loaded!.json()).toMatchObject({ rules: [{ name: "Nova regra", platform_fee_percent: 18.25, fixed_fee_cents: 125 }, { id: "original" }] });
  });
  it("isolates photographer photos by owner", async () => {
    const { token } = await account("photographer");
    const response = await handlePhotographerRequest(request("/api/photographer/photos", "GET", undefined, token), context.env);
    expect(await response!.json()).toEqual({ photos: [] });
  });
});
