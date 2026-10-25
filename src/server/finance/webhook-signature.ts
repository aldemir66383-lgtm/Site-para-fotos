/**
 * Verificação e assinatura de Webhooks Pix (HMAC-SHA256).
 * Compatível com Cloudflare Workers (WebCrypto) e Node 20+.
 */

const enc = new TextEncoder();

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function parseSignatureHeader(header: string | null): { t: number; v1: string } | null {
  if (!header || header.length > 200) return null;
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i <= 0) return null;
    parts.set(piece.slice(0, i).trim(), piece.slice(i + 1).trim());
  }
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1") ?? "";
  if (!Number.isSafeInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) return null;
  return { t, v1 };
}

/**
 * Validação de assinatura em tempo constante (sem timing attacks).
 */
export async function verifyWebhookSignature(
  rawBody: Uint8Array,
  header: string | null,
  secrets: string[],
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): Promise<boolean> {
  const parsed = parseSignatureHeader(header);
  if (!parsed || Math.abs(nowSec - parsed.t) > toleranceSec) return false;
  const data = concat(enc.encode(`${parsed.t}.`), rawBody);
  const sig = hexToBytes(parsed.v1);
  for (const secret of secrets) {
    if (!secret) continue;
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (await crypto.subtle.verify("HMAC", key, sig, data)) return true;
  }
  return false;
}

export async function signWebhookPayload(rawBody: Uint8Array, secret: string, t: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, concat(enc.encode(`${t}.`), rawBody)));
  return `t=${t},v1=${Array.from(mac, b => b.toString(16).padStart(2, "0")).join("")}`;
}
