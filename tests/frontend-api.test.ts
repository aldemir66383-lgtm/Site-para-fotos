import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiRequest } from "../src/components/auth/api";

afterEach(() => vi.unstubAllGlobals());

describe("frontend session API", () => {
  it("sends the session cookie and validates the response", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true }));
    vi.stubGlobal("fetch", fetch);
    await expect(apiRequest("/api/admin/commission-rules", z.object({ success: z.literal(true) }), { method: "POST", body: "{}" })).resolves.toEqual({ success: true });
    expect(fetch).toHaveBeenCalledWith("/api/admin/commission-rules", expect.objectContaining({ credentials: "include", method: "POST", body: "{}" }));
  });

  it("rejects malformed success responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: "yes" })));
    await expect(apiRequest("/api/example", z.object({ success: z.boolean() }))).rejects.toThrow("dados inesperados");
  });

  it("does not display internal server errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "SQL private details" }, { status: 500 })));
    await expect(apiRequest("/api/example", z.unknown())).rejects.toThrow("Não foi possível concluir");
  });

  it("distinguishes login errors from expired sessions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({}, { status: 401 })));
    await expect(apiRequest("/api/auth/login", z.unknown())).rejects.toThrow("E-mail ou senha incorretos");
    await expect(apiRequest("/api/auth/me", z.unknown())).rejects.toThrow("Sua sessão expirou");
  });
});
