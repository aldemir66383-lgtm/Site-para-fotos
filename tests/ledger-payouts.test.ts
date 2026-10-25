import { describe, expect, it } from "vitest";
import { auditLedger, paymentPostings, photographerBalance, postingStatements } from "../src/server/finance/ledger.js";
import { allocate, divRoundHalfEven, splitOrder, checkSplit, type CommissionRule } from "../src/server/finance/money.js";
import { settleVerifiedPayment } from "../src/server/finance/settlement.js";
import { decryptPixKey, encryptPixKey, normalizePixKey, registerVerifiedPixKey } from "../src/server/finance/pix-key.js";
import { handleCommerceRequest } from "../src/server/delivery/handlers.js";
import { api, buyer, commerceEnvironment, paymentEvent, photographer } from "./commerce-helpers.js";

const rule: CommissionRule = { id: "rule", version: 1, platformFeeBps: 2000, providerFeeBps: 99, providerFeeFixedCents: 0, providerFeeBearer: "platform" };
const pix = { type: "EVP" as const, value: "123e4567-e89b-42d3-a456-426614174000" };

describe("liquidação e ledger", () => {
  it("liquida uma vez, concede 30 dias e contabiliza o exemplo de R$45 em soma zero", async () => {
    const { env, sqlite, paidAt } = await commerceEnvironment();
    const entries = sqlite.prepare("SELECT account,direction,amount_cents FROM ledger_entries ORDER BY account").all();
    expect(entries).toEqual([
      { account: "clearing:lab", direction: "debit", amount_cents: 4455 },
      { account: "expense:provider_fee", direction: "debit", amount_cents: 45 },
      { account: "photographer:owner", direction: "credit", amount_cents: 3600 },
      { account: "revenue:platform_fee", direction: "credit", amount_cents: 900 },
    ]);
    expect(await auditLedger(env.DB)).toEqual({ balanced: true, exceptions: [] });
    expect(sqlite.prepare("SELECT count(*) AS n FROM download_entitlements WHERE expires_at=?").get(new Date(paidAt + 30 * 86_400_000).toISOString())?.n).toBe(3);
    await settleVerifiedPayment(env.DB, paymentEvent, paidAt);
    await settleVerifiedPayment(env.DB, { ...paymentEvent, providerEventId: "paid-2" }, paidAt);
    expect(sqlite.prepare("SELECT count(*) AS n FROM ledger_entries").get()?.n).toBe(4);
    expect(sqlite.prepare("SELECT count(*) AS n FROM download_entitlements").get()?.n).toBe(3);
    expect(await photographerBalance(env.DB, "owner", paidAt + 1)).toMatchObject({ pendingCents: 3600, availableCents: 0 });
    expect(await photographerBalance(env.DB, "owner", paidAt + 7 * 86_400_000)).toMatchObject({ pendingCents: 0, availableCents: 3600 });
  });

  it("recusa valor divergente e pedido expirado sem conceder direitos", async () => {
    const context = await commerceEnvironment({ settle: false });
    await expect(settleVerifiedPayment(context.env.DB, { ...paymentEvent, amountCents: 1 })).rejects.toMatchObject({ code: "amount_mismatch" });
    const result = await settleVerifiedPayment(context.env.DB, paymentEvent, Date.now() + 1_000_000);
    expect(result.outcome).toBe("not_pending_or_expired");
    expect(context.sqlite.prepare("SELECT count(*) AS n FROM ledger_entries").get()?.n).toBe(0);
    expect(context.sqlite.prepare("SELECT count(*) AS n FROM download_entitlements").get()?.n).toBe(0);
  });

  it("eventos concorrentes não duplicam a liquidação", async () => {
    const context = await commerceEnvironment({ settle: false });
    await Promise.all([
      settleVerifiedPayment(context.env.DB, paymentEvent),
      settleVerifiedPayment(context.env.DB, { ...paymentEvent, providerEventId: "paid-concurrent" }),
    ]);
    expect(context.sqlite.prepare("SELECT count(*) AS n FROM ledger_entries").get()?.n).toBe(4);
    expect(await auditLedger(context.env.DB)).toMatchObject({ balanced: true });
  });

  it("o banco bloqueia alteração, exclusão e selagem desbalanceada; o batch reverte tudo", async () => {
    const { env, sqlite } = await commerceEnvironment();
    expect(() => sqlite.prepare("UPDATE ledger_entries SET amount_cents=1").run()).toThrow(/append-only/);
    expect(() => sqlite.prepare("DELETE FROM ledger_entries").run()).toThrow(/append-only/);
    expect(() => sqlite.prepare("UPDATE ledger_postings SET actor='evil'").run()).toThrow(/balanced/);
    await expect(env.DB.batch([
      env.DB.prepare("INSERT INTO ledger_postings VALUES ('bad','draft',2,'op','test',0)"),
      env.DB.prepare("INSERT INTO ledger_entries(id,posting_key,account,direction,amount_cents,actor) VALUES ('b1','bad','a','debit',100,'test')"),
      env.DB.prepare("INSERT INTO ledger_entries(id,posting_key,account,direction,amount_cents,actor) VALUES ('b2','bad','b','credit',99,'test')"),
      env.DB.prepare("UPDATE ledger_postings SET state='posted' WHERE posting_key='bad'"),
    ])).rejects.toThrow(/balanced/);
    expect(sqlite.prepare("SELECT count(*) AS n FROM ledger_postings WHERE posting_key='bad'").get()?.n).toBe(0);
  });

  it("cálculos exatos com BigInt e invariantes em 2.000 pedidos com múltiplos fotógrafos", () => {
    expect(divRoundHalfEven(5, 2)).toBe(2);
    expect(divRoundHalfEven(7, 2)).toBe(4);
    expect(allocate(100, [1,1,1])).toEqual([34,33,33]);
    expect(allocate(Number.MAX_SAFE_INTEGER, [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])).toEqual([4503599627370496,4503599627370495]);
    let seed = 42;
    const rnd = (n: number) => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed % n; };
    for (let i = 0; i < 2000; i++) {
      const lines = Array.from({ length: 1 + rnd(20) }, () => ({ photographerId: `f${rnd(4)}`, unitPriceCents: 200 + rnd(20000) }));
      const config = { ...rule, platformFeeBps: rnd(5000), providerFeeBps: rnd(300), providerFeeFixedCents: rnd(50), providerFeeBearer: rnd(2) ? "platform" as const : "photographer" as const };
      expect(checkSplit(splitOrder(lines, config))).toBe(true);
      const postings = paymentPostings(lines, config, "lab", 0);
      expect(postings.reduce((a, p) => a + (p.direction === "debit" ? p.amountCents : -p.amountCents), 0)).toBe(0);
    }
    expect(() => splitOrder([{ photographerId: "x", unitPriceCents: -1 }], rule)).toThrow();
    expect(() => splitOrder([{ photographerId: "x", unitPriceCents: 1 }], { ...rule, platformFeeBps: 10001 })).toThrow();
  });
});

describe("chave Pix e repasses", () => {
  it("valida o formato e cifra a chave vinculando-a ao fotógrafo", async () => {
    const secret = Buffer.alloc(32, 7).toString("base64");
    const encrypted = await encryptPixKey(secret, "owner", pix);
    expect(encrypted.ciphertext).not.toContain(pix.value);
    expect(await decryptPixKey(secret, "owner", pix.type, encrypted.ciphertext)).toEqual(pix);
    await expect(decryptPixKey(secret, "other", pix.type, encrypted.ciphertext)).rejects.toThrow();
    expect(normalizePixKey({ type: "EMAIL", value: "EXAMPLE@EXAMPLE.COM" }).value).toBe("example@example.com");
    expect(() => normalizePixKey({ type: "CPF", value: "11111111111" })).toThrow();
    expect(() => normalizePixKey({ type: "PHONE", value: "11999999999" })).toThrow();
    expect(() => normalizePixKey({ type: "EVP", value: "invalid" })).toThrow();
  });

  it("exige fotógrafo, saldo vencido e chave previamente verificada", async () => {
    const { env } = await commerceEnvironment();
    const request = () => api("photographer/payouts", "POST", { amountCents: 100 }, { "Idempotency-Key": "payout-test-1" });
    expect((await handleCommerceRequest(request(), env, undefined, buyer))?.status).toBe(403);
    expect((await handleCommerceRequest(request(), env, undefined, photographer))?.status).toBe(409);
    await registerVerifiedPixKey(env.DB, env.PAYOUT_KEY_ENCRYPTION_KEY!, "owner", pix);
    expect((await handleCommerceRequest(request(), env, undefined, photographer))?.status).toBe(409);
  });

  it("reserva atomicamente; duas solicitações não gastam o mesmo saldo", async () => {
    const { env, sqlite } = await commerceEnvironment({ paidAt: Date.now() - 8 * 86_400_000 });
    await registerVerifiedPixKey(env.DB, env.PAYOUT_KEY_ENCRYPTION_KEY!, "owner", pix);
    const request = (key: string, amountCents = 3000) => api("photographer/payouts", "POST", { amountCents }, { "Idempotency-Key": key });
    const results = await Promise.all([
      handleCommerceRequest(request("payout-concurrent-1"), env, undefined, photographer),
      handleCommerceRequest(request("payout-concurrent-2"), env, undefined, photographer),
    ]);
    expect(results.map(r => r?.status).sort()).toEqual([201,409]);
    expect(await photographerBalance(env.DB,"owner")).toEqual({ pendingCents: 0, availableCents: 600, negativeCents: 0, inPayoutCents: 3000 });
    const existing = sqlite.prepare("SELECT idempotency_key FROM payout_requests").get() as { idempotency_key: string };
    expect((await handleCommerceRequest(request(existing.idempotency_key), env, undefined, photographer))?.status).toBe(200);
    expect((await handleCommerceRequest(request(existing.idempotency_key, 100), env, undefined, photographer))?.status).toBe(409);
    expect(await auditLedger(env.DB)).toEqual({ balanced: true, exceptions: [] });
    expect(sqlite.prepare("SELECT count(*) AS n FROM payout_requests").get()?.n).toBe(1);
    expect(sqlite.prepare("SELECT status FROM payout_requests").get()?.status).toBe("requested");
  });

  it("não libera saldo de outro fotógrafo nem chave desativada", async () => {
    const { env, sqlite } = await commerceEnvironment({ paidAt: Date.now() - 8 * 86_400_000 });
    await registerVerifiedPixKey(env.DB, env.PAYOUT_KEY_ENCRYPTION_KEY!, "intruder", pix);
    const req = () => api("photographer/payouts", "POST", { amountCents: 1 }, { "Idempotency-Key": "payout-isolation" });
    expect((await handleCommerceRequest(req(), env, undefined, async () => ({ id: "intruder", role: "photographer" })))?.status).toBe(409);
    await registerVerifiedPixKey(env.DB, env.PAYOUT_KEY_ENCRYPTION_KEY!, "owner", pix);
    sqlite.prepare("UPDATE photographer_payout_profiles SET disabled_at_ms=1 WHERE photographer_id='owner'").run();
    expect((await handleCommerceRequest(req(), env, undefined, photographer))?.status).toBe(409);
  });

  it("mantém dívida negativa e impede repasse quando há débitos posteriores", async () => {
    const { env } = await commerceEnvironment({ paidAt: Date.now() - 8 * 86_400_000 });
    await env.DB.batch(postingStatements(env.DB, "adjust:negative", "op-negative", "finance-admin", null, [
      { account: "photographer:owner", direction: "debit", amountCents: 4000, availableAtMs: 0 },
      { account: "receivable:refund", direction: "credit", amountCents: 4000 },
    ], Date.now()));
    expect(await photographerBalance(env.DB, "owner")).toMatchObject({ availableCents: 0, negativeCents: 400 });
  });
});
