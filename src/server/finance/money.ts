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
  const q = Math.floor(a / b);
  const r = a - q * b;
  if (2 * r > b) return q + 1;
  if (2 * r < b) return q;
  return q % 2 === 0 ? q : q + 1;
}

/** Distribui proporcionalmente com garantia matemática de soma exata. */
export function allocate(total: number, weights: number[]): number[] {
  assertCents(total, "total");
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) throw new RangeError("pesos inválidos");
  const base = weights.map(w => Math.floor((total * w) / sum));
  let rest = total - base.reduce((s, x) => s + x, 0);
  const order = weights
    .map((w, i) => ({ i, rem: (total * w) % sum }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; rest > 0; k++, rest--) base[order[k % order.length].i]++;
  return base;
}

export function splitOrder(lines: OrderLine[], rule: CommissionRule): OrderSplit {
  if (lines.length === 0) throw new RangeError("pedido vazio");
  const gross = new Map<string, number>();
  for (const l of lines) {
    assertCents(l.unitPriceCents, "unitPriceCents");
    gross.set(l.photographerId, (gross.get(l.photographerId) ?? 0) + l.unitPriceCents);
  }
  const ids = [...gross.keys()].sort();
  const totalCents = ids.reduce((s, id) => s + gross.get(id)!, 0);

  const providerFeeCents = Math.min(
    totalCents,
    divRoundHalfEven(totalCents * rule.providerFeeBps, 10_000) + rule.providerFeeFixedCents,
  );
  const providerParts = rule.providerFeeBearer === "photographer"
    ? allocate(providerFeeCents, ids.map(id => gross.get(id)!))
    : ids.map(() => 0);

  const shares = ids.map((photographerId, i) => {
    const grossCents = gross.get(photographerId)!;
    const platformFeeCents = divRoundHalfEven(grossCents * rule.platformFeeBps, 10_000);
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
