import { z } from "zod";
import { ApiError, readLimited } from "../photos/contracts.js";
import type { Env } from "../photos/env.js";
import { json } from "../photos/handlers.js";
import { AVAILABLE_SQL, MAX_CENTS, photographerBalance, postingStatements } from "./ledger.js";
import { decryptPixKey, type PixKeyType } from "./pix-key.js";

const inputSchema = z.object({ amountCents: z.number().int().positive().max(MAX_CENTS) }).strict();

export async function requestPayout(request: Request, env: Env, photographerId: string, now = Date.now()): Promise<Response> {
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!idempotencyKey || !/^[a-zA-Z0-9_-]{8,100}$/.test(idempotencyKey)) throw new ApiError(400, "idempotency_key_required", "Informe Idempotency-Key válido.");
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") throw new ApiError(415, "unsupported_media_type", "Envie JSON.");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(await readLimited(request.body, 4096))); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "invalid_input", "JSON inválido."); }
  const { amountCents } = inputSchema.parse(raw);
  const existing = await env.DB.prepare(`SELECT id, amount_cents, status FROM payout_requests WHERE photographer_id=? AND idempotency_key=?`)
    .bind(photographerId, idempotencyKey).first<{ id: string; amount_cents: number; status: string }>();
  if (existing) {
    if (existing.amount_cents !== amountCents) throw new ApiError(409, "idempotency_conflict", "Chave já usada com outro valor.");
    return json({ id: existing.id, amountCents, status: existing.status }, 200);
  }
  const profile = await env.DB.prepare(`SELECT * FROM photographer_payout_profiles WHERE photographer_id=?
    AND disabled_at_ms IS NULL AND verified_at_ms <= ?`).bind(photographerId, now).first<{
      pix_key_type: PixKeyType; pix_key_ciphertext: string; pix_key_fingerprint: string;
    }>();
  if (!profile) throw new ApiError(409, "pix_key_unverified", "Cadastre e verifique uma chave Pix antes de solicitar repasse.");
  if (!env.PAYOUT_KEY_ENCRYPTION_KEY) throw new Error("Payout encryption key missing");
  await decryptPixKey(env.PAYOUT_KEY_ENCRYPTION_KEY, photographerId, profile.pix_key_type, profile.pix_key_ciphertext);
  const id = crypto.randomUUID(), operationId = crypto.randomUUID();
  const account = `photographer:${photographerId}`;
  const eligibility = "EXISTS (SELECT 1 FROM payout_requests WHERE id=? AND operation_id=?)";
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO payout_requests
      (id, photographer_id, idempotency_key, amount_cents, pix_key_type, pix_key_ciphertext, pix_key_fingerprint, requested_at_ms, operation_id)
      SELECT ?, ?, ?, ?, p.pix_key_type, p.pix_key_ciphertext, p.pix_key_fingerprint, ?, ? FROM photographer_payout_profiles p
      WHERE p.photographer_id=? AND p.disabled_at_ms IS NULL AND p.verified_at_ms <= ?
      AND p.pix_key_fingerprint=? AND ? <= ${AVAILABLE_SQL}
      ON CONFLICT(photographer_id, idempotency_key) DO NOTHING`)
      .bind(id, photographerId, idempotencyKey, amountCents, now, operationId, photographerId, now,
        profile.pix_key_fingerprint, amountCents, account, now),
    ...postingStatements(env.DB, `payout:${id}`, operationId, `photographer:${photographerId}`, null, [
      { account, direction: "debit", amountCents, availableAtMs: now },
      { account: `payable:payouts:${photographerId}`, direction: "credit", amountCents },
    ], now, eligibility, [id, operationId]),
  ]);
  const result = await env.DB.prepare(`SELECT id, amount_cents, status FROM payout_requests WHERE photographer_id=? AND idempotency_key=?`)
    .bind(photographerId, idempotencyKey).first<{ id: string; amount_cents: number; status: string }>();
  if (!result) throw new ApiError(409, "payout_unavailable", "Saldo disponível insuficiente ou chave Pix alterada.");
  if (result.amount_cents !== amountCents) throw new ApiError(409, "idempotency_conflict", "Chave já usada com outro valor.");
  return json({ id: result.id, amountCents, status: result.status }, result.id === id ? 201 : 200);
}

export async function balanceResponse(env: Env, photographerId: string): Promise<Response> {
  return json(await photographerBalance(env.DB, photographerId));
}
