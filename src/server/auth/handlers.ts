import { z } from "zod";
import { authHeaders, validMutationOrigin } from "./http.js";
import type { Env } from "../photos/env.js";
import { hashPassword, createSessionToken, parseNativeSession, type UserSession } from "./native-auth.js";

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(6).max(100),
  name: z.string().trim().min(2).max(100),
  role: z.enum(["buyer", "photographer"]).default("buyer"),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(100),
});

export async function handleAuthRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/api/auth/")) {
    return null;
  }

  const corsHeaders: Record<string, string> = {};
  authHeaders(request, env).forEach((value, key) => { corsHeaders[key] = value; });

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!validMutationOrigin(request, env)) return Response.json({ error: "invalid_origin" }, { status: 403, headers: corsHeaders });
  if (!env.NATIVE_AUTH_SECRET || new TextEncoder().encode(env.NATIVE_AUTH_SECRET).length < 32) {
    return Response.json({ error: "auth_unavailable" }, { status: 503, headers: corsHeaders });
  }

  try {
    // POST /api/auth/register
    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const parsed = registerSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: "invalid_input", details: parsed.error.issues }, { status: 400, headers: corsHeaders });
      }

      const { email, password, name, role } = parsed.data;

      // Verifica se usuário já existe
      const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      if (existing) {
        return Response.json({ error: "email_already_exists", message: "Este e-mail já está em uso." }, { status: 409, headers: corsHeaders });
      }

      const { hash, salt } = await hashPassword(password);
      const userId = crypto.randomUUID();

      await env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, password_salt, name, role) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(userId, email, hash, salt, name, role)
        .run();

      const userSession: UserSession = { id: userId, email, name, role };
      const token = await createSessionToken(userSession, env);

      const cookie = `fv_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`;

      return Response.json(
        { user: { id: userId, email, name, role }, token },
        {
          status: 201,
          headers: {
            ...corsHeaders,
            "Set-Cookie": cookie,
          },
        }
      );
    }

    // POST /api/auth/login
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: "invalid_input" }, { status: 400, headers: corsHeaders });
      }

      const { email, password } = parsed.data;

      const userRow = await env.DB.prepare(
        "SELECT id, email, password_hash, password_salt, name, role, status FROM users WHERE email = ?"
      )
        .bind(email)
        .first<{
          id: string;
          email: string;
          password_hash: string;
          password_salt: string;
          name: string;
          role: "buyer" | "photographer" | "admin";
          status: string;
        }>();

      if (!userRow || userRow.status !== "active") {
        return Response.json({ error: "invalid_credentials", message: "E-mail ou senha inválidos." }, { status: 401, headers: corsHeaders });
      }

      const { hash } = await hashPassword(password, userRow.password_salt);
      if (hash !== userRow.password_hash) {
        return Response.json({ error: "invalid_credentials", message: "E-mail ou senha inválidos." }, { status: 401, headers: corsHeaders });
      }

      const userSession: UserSession = {
        id: userRow.id,
        email: userRow.email,
        name: userRow.name,
        role: userRow.role,
      };

      const token = await createSessionToken(userSession, env);
      const cookie = `fv_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`;

      return Response.json(
        { user: userSession, token },
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Set-Cookie": cookie,
          },
        }
      );
    }

    // POST /api/auth/logout
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      const session = await parseNativeSession(request, env);
      if (session) await env.DB.prepare("INSERT OR IGNORE INTO revoked_sessions (id, expires_at) VALUES (?, ?)")
        .bind(session.sessionId, session.expiresAt).run();
      const cookie = `fv_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
      return Response.json({ success: true }, { status: 200, headers: { ...corsHeaders, "Set-Cookie": cookie } });
    }

    // GET /api/auth/me
    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const session = await parseNativeSession(request, env);
      if (!session) {
        return Response.json({ error: "unauthenticated" }, { status: 401, headers: corsHeaders });
      }
      const { id, email, name, role } = session;
      return Response.json({ user: { id, email, name, role } }, { status: 200, headers: corsHeaders });
    }

    return Response.json({ error: "not_found" }, { status: 404, headers: corsHeaders });
  } catch {
    return Response.json({ error: "server_error" }, { status: 500, headers: corsHeaders });
  }
}
