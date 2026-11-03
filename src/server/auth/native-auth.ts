import { SignJWT, jwtVerify } from "jose";
import type { Env } from "../photos/env.js";

export interface UserSession {
  id: string;
  email: string;
  name: string;
  role: "buyer" | "photographer" | "admin";
}

function getSecretKey(env: Env): Uint8Array {
  const secret = env.NATIVE_AUTH_SECRET;
  if (!secret || new TextEncoder().encode(secret).length < 32) throw new Error("Native authentication is not configured");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return {
    hash: bytesToHex(new Uint8Array(derived)),
    salt: bytesToHex(salt),
  };
}

export async function createSessionToken(user: UserSession, env: Env): Promise<string> {
  const key = getSecretKey(env);
  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setJti(crypto.randomUUID())
    .setIssuer("https://airephotos.com.br")
    .setAudience("airephotos")
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
}

export interface NativeSession extends UserSession { sessionId: string; expiresAt: number }

export async function parseNativeSession(request: Request, env: Env): Promise<NativeSession | null> {
  let token: string | undefined;
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else {
    const cookie = request.headers.get("Cookie");
    token = cookie
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("fv_session="))
      ?.slice("fv_session=".length);
  }

  if (!token) return null;

  try {
    const key = getSecretKey(env);
    const { payload } = await jwtVerify(token, key, {
      issuer: "https://airephotos.com.br",
      audience: "airephotos",
      algorithms: ["HS256"], requiredClaims: ["sub", "exp", "iat", "jti"],
    });

    if (!payload.sub || !payload.jti || !payload.exp) return null;
    const user = await env.DB.prepare(`SELECT id, email, name, role FROM users
      WHERE id = ? AND status = 'active'
      AND NOT EXISTS (SELECT 1 FROM revoked_sessions WHERE id = ?)`)
      .bind(payload.sub, payload.jti).first<UserSession>();
    if (!user || !["buyer", "photographer", "admin"].includes(user.role)) return null;
    return { ...user, sessionId: payload.jti, expiresAt: payload.exp };
  } catch {
    return null;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}
