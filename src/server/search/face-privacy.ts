import { ApiError } from "../photos/contracts.js";
import type { Env } from "../photos/env.js";

const enc = new TextEncoder();
export const FACE_POLICY_VERSION = "aire-face-v1";
export const FACE_DISCLAIMER =
  "Possíveis correspondências — confira se é você.";

export async function privacyHash(
  secret: string,
  value: string,
): Promise<string> {
  if (secret.length < 32)
    throw new Error("Face IP hash secret must contain at least 32 characters");
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value))),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function recordFaceConsent(
  env: Env,
  subject: string,
  albumId: string,
  ip: string,
  now: number,
): Promise<{ id: string; subjectHash: string }> {
  const secret = env.FACE_IP_HASH_SECRET!;
  const subjectHash = await privacyHash(secret, `subject:${subject}`);
  const day = new Date(now).toISOString().slice(0, 10);
  const ipHash = await privacyHash(
    secret,
    `ip:${day}:${ip.trim().toLowerCase()}`,
  );
  const id = crypto.randomUUID();
  const retention = Number(env.FACE_CONSENT_RETENTION_DAYS ?? 90);
  if (!Number.isInteger(retention) || retention < 1 || retention > 3650)
    throw new Error("Invalid face consent retention");
  await env.DB.prepare(
    `INSERT INTO face_search_consents
    (id,buyer_ip_hash,album_id,policy_version,subject_hash,consented_at_ms,expires_at_ms)
    SELECT ?,?,?,?,?,?,? WHERE
      (SELECT count(*) FROM face_search_consents WHERE subject_hash=? AND consented_at_ms>?)<5
      AND (SELECT count(*) FROM face_search_consents WHERE buyer_ip_hash=? AND consented_at_ms>?)<5
      AND (SELECT count(*) FROM face_search_consents WHERE subject_hash=? AND consented_at_ms>?)<20
      AND (SELECT count(*) FROM face_search_consents WHERE buyer_ip_hash=? AND consented_at_ms>?)<20`,
  )
    .bind(
      id,
      ipHash,
      albumId,
      FACE_POLICY_VERSION,
      subjectHash,
      now,
      now + retention * 86_400_000,
      subjectHash,
      now - 3_600_000,
      ipHash,
      now - 3_600_000,
      subjectHash,
      now - 86_400_000,
      ipHash,
      Date.parse(`${day}T00:00:00Z`),
    )
    .run();
  const row = await env.DB.prepare(
    "SELECT id FROM face_search_consents WHERE id=?",
  )
    .bind(id)
    .first();
  if (!row)
    throw new ApiError(
      429,
      "rate_limited",
      "Limite de buscas por selfie atingido. Tente novamente mais tarde.",
    );
  return { id, subjectHash };
}

let cachedKey: { secret: string; key: Promise<CryptoKey> } | undefined;
async function importIndexKey(secret: string) {
  const bytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
  if (bytes.length !== 32)
    throw new Error("Face encryption key must be 32 bytes in base64");
  try {
    return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  } finally {
    bytes.fill(0);
  }
}
function indexKey(secret: string) {
  if (cachedKey?.secret !== secret)
    cachedKey = { secret, key: importIndexKey(secret) };
  return cachedKey.key;
}
export async function encryptFaceVector(
  secret: string,
  context: string,
  vector: Float32Array,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const copy = Float32Array.from(vector);
  try {
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(context) },
      await indexKey(secret),
      copy.buffer,
    );
    const bytes = new Uint8Array(iv.length + encrypted.byteLength);
    bytes.set(iv);
    bytes.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...bytes));
  } finally {
    copy.fill(0);
  }
}
export async function decryptFaceVector(
  secret: string,
  context: string,
  ciphertext: string,
  dimensions: number,
): Promise<Float32Array> {
  const bytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  try {
    const data = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes.slice(0, 12),
        additionalData: enc.encode(context),
      },
      await indexKey(secret),
      bytes.slice(12),
    );
    const vector = new Float32Array(data);
    if (vector.length !== dimensions || ![...vector].every(Number.isFinite)) {
      vector.fill(0);
      throw new Error("Invalid stored face vector");
    }
    return vector;
  } finally {
    bytes.fill(0);
  }
}
