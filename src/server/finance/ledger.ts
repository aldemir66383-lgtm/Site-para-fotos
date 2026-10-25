import { ApiError } from "../photos/contracts.js";
import { splitOrder, type CommissionRule, type OrderLine } from "./money.js";

export const MAX_CENTS = 1_000_000_000_000;
export interface Posting { account: string; direction: "debit" | "credit"; amountCents: number; availableAtMs?: number }

export function assertBalanced(postings: Posting[]): void {
  if (postings.length < 2 || new Set(postings.map(p => p.account)).size !== postings.length) throw new Error("Invalid ledger accounts");
  let sum = 0n;
  for (const p of postings) {
    if (!p.account || !["debit", "credit"].includes(p.direction) || !Number.isSafeInteger(p.amountCents)
      || p.amountCents <= 0 || p.amountCents > MAX_CENTS) throw new Error("Invalid ledger amount");
    sum += BigInt(p.amountCents) * (p.direction === "debit" ? 1n : -1n);
  }
  if (sum !== 0n) throw new Error("Unbalanced ledger posting");
}

export function paymentPostings(lines: OrderLine[], rule: CommissionRule, provider: string, availableAtMs: number): Posting[] {
  const split = splitOrder(lines, rule);
  if (split.totalCents > MAX_CENTS) throw new RangeError("Order above supported limit");
  const entries: Posting[] = [
    { account: `clearing:${provider}`, direction: "debit", amountCents: split.totalCents - split.providerFeeCents },
    { account: "expense:provider_fee", direction: "debit", amountCents: split.providerFeeCents },
    { account: "revenue:platform_fee", direction: "credit", amountCents: split.shares.reduce((a, s) => a + s.platformFeeCents, 0) },
  ];
  if (rule.providerFeeBearer === "photographer") entries.push({
    account: "revenue:provider_fee_recharge", direction: "credit", amountCents: split.providerFeeCents,
  });
  for (const share of split.shares) entries.push({
    account: `photographer:${share.photographerId}`, direction: "credit", amountCents: share.payableCents, availableAtMs,
  });
  const nonzero = entries.filter(e => e.amountCents !== 0);
  assertBalanced(nonzero);
  return nonzero;
}

export function postingStatements(db: D1Database, postingKey: string, operationId: string, actor: string,
  orderId: string | null, postings: Posting[], now: number, eligibilitySql = "1", eligibilityParams: (string | number)[] = []): D1PreparedStatement[] {
  assertBalanced(postings);
  const gate = "EXISTS (SELECT 1 FROM ledger_postings WHERE posting_key = ? AND operation_id = ? AND state = 'draft')";
  return [
    db.prepare(`INSERT INTO ledger_postings (posting_key, state, expected_entries, operation_id, actor, created_at_ms)
      SELECT ?, 'draft', ?, ?, ?, ? WHERE ${eligibilitySql} ON CONFLICT(posting_key) DO NOTHING`)
      .bind(postingKey, postings.length, operationId, actor, now, ...eligibilityParams),
    ...postings.map(p => db.prepare(`INSERT INTO ledger_entries
      (id, posting_key, account, direction, amount_cents, order_id, actor, available_at_ms)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${gate}`)
      .bind(crypto.randomUUID(), postingKey, p.account, p.direction, p.amountCents, orderId, actor, p.availableAtMs ?? null, postingKey, operationId)),
    db.prepare("UPDATE ledger_postings SET state='posted' WHERE posting_key=? AND operation_id=? AND state='draft'")
      .bind(postingKey, operationId),
  ];
}

// Positive credits increase the liability owed to a photographer.
export const AVAILABLE_SQL = `(SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)
  FROM ledger_entries e JOIN ledger_postings g ON g.posting_key=e.posting_key
  WHERE g.state='posted' AND e.account=? AND e.available_at_ms <= ?)`;

export async function photographerBalance(db: D1Database, photographerId: string, now = Date.now()) {
  const account = `photographer:${photographerId}`;
  const row = await db.prepare(`WITH balances AS (
      SELECT e.account,e.available_at_ms,CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END AS cents
      FROM ledger_entries e JOIN ledger_postings g ON g.posting_key=e.posting_key
      WHERE g.state='posted' AND e.account IN (?,?))
    SELECT COALESCE(sum(CASE WHEN account=? AND available_at_ms <= ? THEN cents ELSE 0 END),0) AS matured,
      COALESCE(sum(CASE WHEN account=? AND available_at_ms > ? THEN cents ELSE 0 END),0) AS pending,
      COALESCE(sum(CASE WHEN account=? THEN cents ELSE 0 END),0) AS reserved FROM balances`)
    .bind(account, `payable:payouts:${photographerId}`, account, now, account, now, `payable:payouts:${photographerId}`)
    .first<{ matured: number; pending: number; reserved: number }>();
  const matured = row?.matured ?? 0;
  for (const amount of [matured, row?.pending ?? 0, row?.reserved ?? 0]) {
    if (!Number.isSafeInteger(amount)) throw new ApiError(503, "balance_unavailable", "Saldo fora do limite de precisão.");
  }
  return { pendingCents: row?.pending ?? 0, availableCents: Math.max(matured, 0),
    negativeCents: Math.max(-matured, 0), inPayoutCents: row?.reserved ?? 0 };
}

export async function auditLedger(db: D1Database) {
  const result = await db.prepare(`SELECT g.posting_key, g.state, count(e.id) AS entries,
    COALESCE(sum(CASE WHEN e.direction='debit' THEN e.amount_cents ELSE -e.amount_cents END),0) AS difference_cents
    FROM ledger_postings g LEFT JOIN ledger_entries e ON e.posting_key=g.posting_key
    GROUP BY g.posting_key HAVING g.state != 'posted' OR difference_cents != 0 OR entries != g.expected_entries`).all();
  return { balanced: result.results.length === 0, exceptions: result.results };
}
