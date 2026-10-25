/**
 * Cálculos financeiros em centavos inteiros (Integer Cents).
 * Arredondamento bancário half-even e distribuição de maior resto.
 */

export type FeeBearer = "platform" | "photographer";

export interface CommissionRule {
  id: string;
  version: number;
  platformFeeBps: number;        // ex.: 2000 = 20%
  providerFeeBps: number;        // ex.: 99 = 0.99% (taxa do gateway Pix)
  providerFeeFixedCents: number; // taxa fixa em centavos (ex: 0)
  providerFeeBearer: FeeBearer;  // quem absorve a taxa do gateway
}

export interface OrderLine {
  photographerId: string;
  unitPriceCents: number;
}

export interface PhotographerShare {
  photographerId: string;
  grossCents: number;
  platformFeeCents: number;
  providerFeeCents: number;
  payableCents: number;
}

export interface OrderSplit {
  totalCents: number;
  providerFeeCents: number;
  platformNetCents: number;
  shares: PhotographerShare[];
}

function assertCents(n: number, label: string): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`${label} deve ser inteiro >= 0 (recebido ${n})`);
  }
}

/** Banker's rounding: metade para o número par mais próximo. */
export function divRoundHalfEven(a: number, b: number): number {
  assertCents(a, "dividendo");
  if (!Number.isSafeInteger(b) || b <= 0) throw new RangeError("divisor inválido");
  return roundRatio(BigInt(a), BigInt(b));
}

function safeNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError("valor fora da precisão segura");
  return n;
}

function roundRatio(a: bigint, b: bigint): number {
  const q = a / b, r = a % b;
  return safeNumber(q + (2n * r > b || (2n * r === b && q % 2n !== 0n) ? 1n : 0n));
}

function fee(amount: number, bps: number): number {
  return roundRatio(BigInt(amount) * BigInt(bps), 10_000n);
}

/** Distribui proporcionalmente com garantia matemática de soma exata. */
export function allocate(total: number, weights: number[]): number[] {
  assertCents(total, "total");
  weights.forEach(w => assertCents(w, "peso"));
  const sum = weights.reduce((s, w) => s + BigInt(w), 0n);
  if (sum <= 0n) throw new RangeError("pesos inválidos");
  const base = weights.map(w => safeNumber((BigInt(total) * BigInt(w)) / sum));
  let rest = total - base.reduce((s, x) => s + x, 0);
  const order = weights
    .map((w, i) => ({ i, rem: (BigInt(total) * BigInt(w)) % sum }))
    .sort((a, b) => a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1);
  for (let k = 0; rest > 0; k++, rest--) base[order[k % order.length].i]++;
  return base;
}

export function splitOrder(lines: OrderLine[], rule: CommissionRule): OrderSplit {
  if (lines.length === 0) throw new RangeError("pedido vazio");
  for (const bps of [rule.platformFeeBps, rule.providerFeeBps]) {
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new RangeError("taxa inválida");
  }
  assertCents(rule.providerFeeFixedCents, "taxa fixa");
  if (!["platform", "photographer"].includes(rule.providerFeeBearer)) throw new RangeError("responsável pela taxa inválido");
  const gross = new Map<string, number>();
  for (const l of lines) {
    assertCents(l.unitPriceCents, "unitPriceCents");
    if (!l.photographerId) throw new RangeError("fotógrafo inválido");
    gross.set(l.photographerId, safeNumber(BigInt(gross.get(l.photographerId) ?? 0) + BigInt(l.unitPriceCents)));
  }
  const ids = [...gross.keys()].sort();
  const totalCents = safeNumber(ids.reduce((s, id) => s + BigInt(gross.get(id)!), 0n));
  if (totalCents <= 0) throw new RangeError("total deve ser positivo");

  const providerFeeCents = Math.min(
    totalCents,
    safeNumber(BigInt(fee(totalCents, rule.providerFeeBps)) + BigInt(rule.providerFeeFixedCents)),
  );
  const providerParts = rule.providerFeeBearer === "photographer"
    ? allocate(providerFeeCents, ids.map(id => gross.get(id)!))
    : ids.map(() => 0);

  const shares = ids.map((photographerId, i) => {
    const grossCents = gross.get(photographerId)!;
    const platformFeeCents = fee(grossCents, rule.platformFeeBps);
    const payableCents = grossCents - platformFeeCents - providerParts[i];
    if (payableCents < 0) throw new RangeError(`repasse negativo para ${photographerId}`);
    return { photographerId, grossCents, platformFeeCents, providerFeeCents: providerParts[i], payableCents };
  });

  const platformFees = shares.reduce((s, x) => s + x.platformFeeCents, 0);
  const platformNetCents = rule.providerFeeBearer === "platform" ? platformFees - providerFeeCents : platformFees;
  return { totalCents, providerFeeCents, platformNetCents, shares };
}

export function checkSplit(s: OrderSplit): boolean {
  const payable = s.shares.reduce((a, x) => a + x.payableCents, 0);
  return payable + s.platformNetCents + s.providerFeeCents === s.totalCents;
}
