import { ApiError } from "../photos/contracts.js";

export type PixKeyType = "CPF" | "CNPJ" | "PHONE" | "EMAIL" | "EVP";
export interface PixKey { type: PixKeyType; value: string }
const encoder = new TextEncoder();

function checkDigit(values: number[], weights: number[]) {
  const remainder = values.reduce((sum, value, i) => sum + value * weights[i], 0) % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function normalizePixKey(input: PixKey): PixKey {
  let value = input.value.trim();
  let valid = false;
  if (input.type === "CPF") {
    if (/^\d{11}$/.test(value) && !/^(\d)\1+$/.test(value)) {
      const digits = [...value].map(Number);
      valid = checkDigit(digits.slice(0, 9), [10,9,8,7,6,5,4,3,2]) === digits[9]
        && checkDigit(digits.slice(0, 10), [11,10,9,8,7,6,5,4,3,2]) === digits[10];
    }
  } else if (input.type === "CNPJ") {
    value = value.toUpperCase();
    if (/^[A-Z0-9]{12}\d{2}$/.test(value) && !/^(\d)\1+$/.test(value)) {
      const digits = [...value].map(c => c.charCodeAt(0) - 48);
      valid = checkDigit(digits.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]) === digits[12]
        && checkDigit(digits.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]) === digits[13];
    }
  } else if (input.type === "PHONE") valid = /^\+[1-9]\d{1,14}$/.test(value);
  else if (input.type === "EMAIL") {
    value = value.toLowerCase();
    valid = value.length <= 77 && /^[a-z0-9.!#$'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(value);
  } else if (input.type === "EVP") {
    value = value.toLowerCase();
    valid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
  }
  if (!valid) throw new ApiError(400, "invalid_pix_key", "Chave Pix inválida.");
  return { type: input.type, value };
}

async function key(secret: string) {
  const raw = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("PAYOUT_KEY_ENCRYPTION_KEY must be 32 random bytes in base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function encryptPixKey(secret: string, photographerId: string, input: PixKey) {
  const pix = normalizePixKey(input);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv,
    additionalData: encoder.encode(`fotoviva-pix-v1:${photographerId}:${pix.type}`) }, await key(secret), encoder.encode(pix.value));
  const fingerprintKey = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const fingerprint = await crypto.subtle.sign("HMAC", fingerprintKey, encoder.encode(`${photographerId}:${pix.type}:${pix.value}`));
  return { type: pix.type, ciphertext: `${base64(iv)}.${base64(new Uint8Array(encrypted))}`, fingerprint: base64(new Uint8Array(fingerprint)) };
}

export async function decryptPixKey(secret: string, photographerId: string, type: PixKeyType, ciphertext: string): Promise<PixKey> {
  const [iv, data, extra] = ciphertext.split(".");
  if (!iv || !data || extra) throw new Error("Invalid encrypted Pix key");
  const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Uint8Array.from(atob(iv), c => c.charCodeAt(0)),
    additionalData: encoder.encode(`fotoviva-pix-v1:${photographerId}:${type}`) }, await key(secret), Uint8Array.from(atob(data), c => c.charCodeAt(0)));
  return normalizePixKey({ type, value: new TextDecoder().decode(bytes) });
}

/** Trusted onboarding hook: call only AFTER PSP/DICT ownership verification, never directly from a buyer body. */
export async function registerVerifiedPixKey(db: D1Database, secret: string, photographerId: string, input: PixKey, now = Date.now()) {
  const pix = await encryptPixKey(secret, photographerId, input);
  await db.prepare(`INSERT INTO photographer_payout_profiles
    (photographer_id, pix_key_type, pix_key_ciphertext, pix_key_fingerprint, verified_at_ms, disabled_at_ms)
    VALUES (?, ?, ?, ?, ?, NULL) ON CONFLICT(photographer_id) DO UPDATE SET
    pix_key_type=excluded.pix_key_type, pix_key_ciphertext=excluded.pix_key_ciphertext,
    pix_key_fingerprint=excluded.pix_key_fingerprint, verified_at_ms=excluded.verified_at_ms, disabled_at_ms=NULL`)
    .bind(photographerId, pix.type, pix.ciphertext, pix.fingerprint, now).run();
}
