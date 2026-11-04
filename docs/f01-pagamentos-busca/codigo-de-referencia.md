# Código de referência (testado)

> **O que é:** trechos em TypeScript que implementam o **núcleo** das regras de F03, F04 e F07. Rodam em Cloudflare Workers (WebCrypto) e foram testados em Node 24 com `node:sqlite` (o mesmo SQLite do D1).
> **O que não é:** código integrado ao repositório `pedromatosx/fotoviva`, que não estava acessível. Para integrar, adapte os nomes de tabelas e colunas aos existentes (F01 §8) e troque `runBatch` por `env.DB.batch(stmts.map(([sql, p]) => env.DB.prepare(sql).bind(...bindUsed(sql, p))))`.
> **Resultado:** 25/25 testes passando (ver [testes.md §3](testes.md#3-resultados-das-simulações-executadas)).

## Como executar

```bash
# Node 24+ (executa .ts direto, com remoção de tipos)
node --test reference.test.ts
node b1-query-check.mjs
```

Copie os blocos abaixo para arquivos com os nomes indicados no título de cada seção.

## 1. Assinatura do webhook

`webhook-signature.ts`: HMAC-SHA256 sobre `t.corpoBruto`, tolerância de ±300 s, comparação em tempo constante (`crypto.subtle.verify`) e rotação de segredos.

```ts
// Verificação da assinatura do webhook Pix do laboratório.
// Compatível com Cloudflare Workers e Node 20+ (WebCrypto global).
// Cabeçalho: "X-FV-Lab-Signature: t=<unix-seg>,v1=<hex hmac-sha256>"
// Mensagem assinada: `${t}.${corpoBruto}` — verificar ANTES de fazer JSON.parse.

const enc = new TextEncoder();

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
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
 * @param secrets segredo atual primeiro; durante rotação, inclua o anterior.
 * Usa crypto.subtle.verify (comparação em tempo constante).
 */
export async function verifyLabSignature(
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
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    if (await crypto.subtle.verify("HMAC", key, sig, data)) return true;
  }
  return false;
}

/** Usado apenas pelo simulador do laboratório para emitir eventos assinados. */
export async function signLabPayload(rawBody: Uint8Array, secret: string, t: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, concat(enc.encode(`${t}.`), rawBody)));
  return `t=${t},v1=${Array.from(mac, b => b.toString(16).padStart(2, "0")).join("")}`;
}
```

## 2. Dinheiro e comissão

`money.ts`: centavos inteiros, *basis points*, arredondamento *half-even*, divisão por fotógrafo e alocação por maior resto.

```ts
// Cálculo de comissão em centavos inteiros. Taxas em basis points (1 bps = 0,01%).

export type FeeBearer = "platform" | "photographer";

export interface CommissionRule {
  id: string;
  version: number;
  platformFeeBps: number;        // ex.: 2000 = 20%
  providerFeeBps: number;        // ex.: 99 = 0,99% (taxa percentual do PSP)
  providerFeeFixedCents: number; // ex.: 0
  providerFeeBearer: FeeBearer;
}

export interface OrderLine { photographerId: string; unitPriceCents: number }

export interface PhotographerShare {
  photographerId: string;
  grossCents: number;
  platformFeeCents: number;
  providerFeeCents: number; // parcela da taxa do PSP atribuída a este fotógrafo (0 se a plataforma absorve)
  payableCents: number;     // valor devido ao fotógrafo
}

export interface OrderSplit {
  totalCents: number;
  providerFeeCents: number;
  platformNetCents: number; // comissão da plataforma menos a taxa do PSP absorvida
  shares: PhotographerShare[];
}

function assertCents(n: number, label: string): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${label} deve ser inteiro >= 0 (recebido ${n})`);
}

/** round(a / b), metade para o par (banker's rounding), só com inteiros. */
export function divRoundHalfEven(a: number, b: number): number {
  assertCents(a, "dividendo");
  if (!Number.isSafeInteger(b) || b <= 0) throw new RangeError("divisor inválido");
  const q = Math.floor(a / b);
  const r = a - q * b;
  if (2 * r > b) return q + 1;
  if (2 * r < b) return q;
  return q % 2 === 0 ? q : q + 1;
}

/** Distribui `total` proporcionalmente a `weights` pelo método do maior resto. Soma exata garantida. */
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

  // Taxa do PSP incide sobre a cobrança inteira.
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

/** Invariante contábil: tudo o que entrou foi atribuído a alguém. */
export function checkSplit(s: OrderSplit): boolean {
  const payable = s.shares.reduce((a, x) => a + x.payableCents, 0);
  return payable + s.platformNetCents + s.providerFeeCents === s.totalCents;
}
```

## 3. Interpretador de consultas de roupa

`clothing-query.ts`: vocabulário fechado em pt-BR, sem IA; todos os itens se referem à mesma pessoa.

```ts
// Interpretação determinística de consultas em pt-BR sobre roupas e acessórios.
// Não usa IA: vocabulário fechado → atributos canônicos. Tudo na consulta se refere à MESMA pessoa.

export type Color =
  | "preto" | "branco" | "cinza" | "vermelho" | "laranja" | "amarelo"
  | "verde" | "azul" | "azul_marinho" | "roxo" | "rosa" | "marrom";
export type Region = "superior" | "inferior" | "corpo_inteiro" | "cabeca" | "bolsa" | "pes" | "qualquer";

export interface Item { type: string; region: Region; color?: Color }
export interface ClothingQuery { items: Item[]; bib?: string; unrecognized: string[] }

const GARMENTS: Record<string, [string, Region]> = {
  camisa: ["camisa", "superior"], camiseta: ["camiseta", "superior"], blusa: ["blusa", "superior"],
  regata: ["regata", "superior"], top: ["top", "superior"], jaqueta: ["jaqueta", "superior"],
  casaco: ["casaco", "superior"], moletom: ["moletom", "superior"], colete: ["colete", "superior"],
  uniforme: ["uniforme", "corpo_inteiro"], vestido: ["vestido", "corpo_inteiro"], macacao: ["macacao", "corpo_inteiro"],
  short: ["short", "inferior"], shorts: ["short", "inferior"], bermuda: ["bermuda", "inferior"],
  calca: ["calca", "inferior"], saia: ["saia", "inferior"], legging: ["legging", "inferior"],
  tenis: ["tenis", "pes"], roupa: ["roupa", "qualquer"],
  bone: ["bone", "cabeca"], chapeu: ["chapeu", "cabeca"], viseira: ["viseira", "cabeca"],
  bandana: ["bandana", "cabeca"], mochila: ["mochila", "bolsa"], pochete: ["pochete", "bolsa"],
  bolsa: ["bolsa", "bolsa"],
};

// Formas aceitas para cada cor (masculino/feminino/plural e sinônimos).
const COLOR_FORMS = new Map<string, Color>();
const inflected = (stem: string, c: Color) => ["o", "a", "os", "as"].forEach(s => COLOR_FORMS.set(stem + s, c));
const invariant = (word: string, c: Color) => { COLOR_FORMS.set(word, c); COLOR_FORMS.set(word + "s", c); };
inflected("pret", "preto"); inflected("branc", "branco"); inflected("vermelh", "vermelho");
inflected("amarel", "amarelo"); inflected("dourad", "amarelo"); inflected("rox", "roxo"); inflected("cinzent", "cinza");
invariant("cinza", "cinza"); invariant("prata", "cinza"); invariant("laranja", "laranja"); invariant("verde", "verde");
invariant("vinho", "vermelho"); invariant("bordo", "vermelho"); invariant("rosa", "rosa"); invariant("pink", "rosa");
invariant("bege", "marrom"); invariant("caramelo", "marrom"); invariant("lilas", "roxo"); invariant("violeta", "roxo");
invariant("celeste", "azul"); invariant("marinho", "azul_marinho");
COLOR_FORMS.set("marrom", "marrom"); COLOR_FORMS.set("marrons", "marrom");
COLOR_FORMS.set("azul", "azul"); COLOR_FORMS.set("azuis", "azul");

const STOPWORDS = new Set(["e", "com", "de", "da", "do", "um", "uma", "uns", "umas", "a", "o", "as", "os", "na", "no", "em", "cor", "claro", "clara", "escuro", "escura"]);

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function parseClothingQuery(input: string): ClothingQuery {
  const q: ClothingQuery = { items: [], unrecognized: [] };
  const tokens = normalize(input.slice(0, 200)).replace(/[-_/]/g, " ").match(/#?[a-z0-9°º]+/g) ?? [];
  let current: Item | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const bibMatch = tok.match(/^#?(\d{1,6})$/);
    if (bibMatch) {
      const prev = tokens[i - 1];
      if (tok.startsWith("#") || prev === "numero" || prev === "n" || prev === "no" || prev === "nº" || prev === "n°") {
        q.bib = bibMatch[1];
        continue;
      }
    }
    if (tok === "numero" || tok === "n°" || tok === "nº") continue;
    const garment = GARMENTS[tok] ?? (tok.endsWith("s") ? GARMENTS[tok.slice(0, -1)] : undefined);
    if (garment) {
      current = { type: garment[0], region: garment[1] };
      q.items.push(current);
      continue;
    }
    // "azul marinho" vira um único azul_marinho
    if (tok === "marinho" && current?.color === "azul") { current.color = "azul_marinho"; continue; }
    const color = COLOR_FORMS.get(tok);
    if (color) {
      if (current && !current.color) current.color = color;
      else { current = { type: "roupa", region: "qualquer", color }; q.items.push(current); }
      continue;
    }
    if (!STOPWORDS.has(tok)) q.unrecognized.push(tok);
  }
  q.items = q.items.slice(0, 5); // limite de complexidade por consulta
  return q;
}
```

## 4. Confirmação atômica e estorno (D1)

`payment-confirm.ts`: DDL, lançamentos em partidas dobradas, batch de confirmação protegido por condições e batch de estorno.

```ts
// Confirmação atômica de pagamento Pix (simulado) e estorno, no formato de um batch D1.
// Aqui o batch é emulado com node:sqlite em BEGIN IMMEDIATE/COMMIT (D1 executa batch como transação).
import type { DatabaseSync } from "node:sqlite";
import { splitOrder, type CommissionRule, type OrderLine } from "./money.ts";

export const SCHEMA = /* sql */ `
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  buyer_subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','expired','refunded')),
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  commission_rule_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  paid_at INTEGER,
  paid_event_id TEXT,
  refund_id TEXT
);
CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  photo_id TEXT NOT NULL,
  photographer_id TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  UNIQUE (order_id, photo_id)
);
CREATE TABLE payment_charges (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  provider TEXT NOT NULL,
  txid TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','paid','expired','failed','refunded')),
  expires_at INTEGER NOT NULL,
  UNIQUE (provider, txid)
);
CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  txid TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  outcome TEXT,
  UNIQUE (provider, provider_event_id)
);
CREATE TABLE ledger_entries (
  id INTEGER PRIMARY KEY,
  order_id TEXT NOT NULL,
  posting_key TEXT NOT NULL,
  account TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (posting_key, account)
);
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
CREATE TABLE download_entitlements (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL UNIQUE,
  photo_id TEXT NOT NULL,
  buyer_subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','revoked')),
  granted_event_id TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoke_reason TEXT
);
`;

export interface PaidEvent {
  rowId: string;           // UUID gerado ao receber (não vem do provedor)
  provider: string;        // 'lab'
  providerEventId: string; // id do evento no provedor (no Pix real: endToEndId)
  txid: string;
  amountCents: number;
}

export interface Posting { account: string; amountCents: number }

/** Lançamentos de partida dobrada do pagamento: débitos positivos, créditos negativos, soma zero. */
export function paymentPostings(lines: OrderLine[], rule: CommissionRule, provider: string): Posting[] {
  const s = splitOrder(lines, rule);
  const p: Posting[] = [
    { account: `clearing:${provider}`, amountCents: s.totalCents - s.providerFeeCents },
    { account: "expense:provider_fee", amountCents: s.providerFeeCents },
    { account: "revenue:platform_fee", amountCents: -s.shares.reduce((a, x) => a + x.platformFeeCents, 0) },
  ];
  if (rule.providerFeeBearer === "photographer") {
    p.push({ account: "revenue:provider_fee_recharge", amountCents: -s.providerFeeCents });
  }
  for (const sh of s.shares) p.push({ account: `payable:photographer:${sh.photographerId}`, amountCents: -sh.payableCents });
  return p.filter(x => x.amountCents !== 0);
}

/** Leitura prévia (fora do batch): o pedido é um snapshot imutável, então calcular antes é seguro. */
export function loadOrderForTxid(db: DatabaseSync, provider: string, txid: string) {
  const order = db.prepare(
    `SELECT o.id, o.commission_rule_id FROM orders o JOIN payment_charges c ON c.order_id = o.id
     WHERE c.provider = ?1 AND c.txid = ?2`,
  ).get(provider, txid) as { id: string; commission_rule_id: string } | undefined;
  if (!order) return undefined;
  const lines = db.prepare(
    `SELECT photographer_id AS photographerId, unit_price_cents AS unitPriceCents FROM order_items WHERE order_id = ?1`,
  ).all(order.id) as unknown as OrderLine[];
  return { orderId: order.id, ruleId: order.commission_rule_id, lines };
}

const OUTCOME = /* sql */ `
CASE
  WHEN EXISTS (SELECT 1 FROM orders WHERE paid_event_id = ?1) THEN 'applied'
  WHEN NOT EXISTS (SELECT 1 FROM payment_charges WHERE provider = ?2 AND txid = ?4) THEN 'unknown_charge'
  WHEN EXISTS (SELECT 1 FROM payment_charges c JOIN orders o ON o.id = c.order_id
               WHERE c.provider = ?2 AND c.txid = ?4 AND o.status = 'paid') THEN 'already_paid'
  WHEN EXISTS (SELECT 1 FROM payment_charges c JOIN orders o ON o.id = c.order_id
               WHERE c.provider = ?2 AND c.txid = ?4 AND (c.amount_cents <> ?5 OR o.total_cents <> ?5)) THEN 'amount_mismatch'
  WHEN EXISTS (SELECT 1 FROM payment_charges c JOIN orders o ON o.id = c.order_id
               WHERE c.provider = ?2 AND c.txid = ?4 AND o.expires_at <= ?6) THEN 'late_payment'
  ELSE 'not_pending'
END`;

/** Retorna as instruções do batch (SQL + parâmetros), na ordem em que o D1 as executaria. */
export function confirmPaymentBatch(e: PaidEvent, now: number, postings: Posting[]): [string, unknown[]][] {
  const base = [e.rowId, e.provider, e.providerEventId, e.txid, e.amountCents, now];
  return [
    [`INSERT INTO payment_events (id, provider, provider_event_id, txid, type, amount_cents, received_at)
      VALUES (?1, ?2, ?3, ?4, 'paid', ?5, ?6)
      ON CONFLICT (provider, provider_event_id) DO NOTHING`, base],
    [`UPDATE orders SET status = 'paid', paid_at = ?6, paid_event_id = ?1
      WHERE id = (SELECT order_id FROM payment_charges WHERE provider = ?2 AND txid = ?4 AND amount_cents = ?5)
        AND status = 'pending' AND expires_at > ?6 AND total_cents = ?5
        AND EXISTS (SELECT 1 FROM payment_events WHERE id = ?1)`, base],
    [`UPDATE payment_charges SET status = 'paid'
      WHERE provider = ?2 AND txid = ?4
        AND EXISTS (SELECT 1 FROM orders o WHERE o.id = payment_charges.order_id AND o.paid_event_id = ?1)`, base],
    ...postings.map(p => [
      `INSERT INTO ledger_entries (order_id, posting_key, account, amount_cents, created_at)
       SELECT o.id, 'payment:' || o.id, ?7, ?8, ?6 FROM orders o WHERE o.paid_event_id = ?1
       ON CONFLICT (posting_key, account) DO NOTHING`, [...base, p.account, p.amountCents],
    ] as [string, unknown[]]),
    [`INSERT INTO download_entitlements
        (id, order_id, order_item_id, photo_id, buyer_subject, status, granted_event_id, granted_at)
      SELECT lower(hex(randomblob(16))), oi.order_id, oi.id, oi.photo_id, o.buyer_subject, 'active', ?1, ?6
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.paid_event_id = ?1
      ON CONFLICT (order_item_id) DO NOTHING`, base],
    [`UPDATE payment_events SET outcome = ${OUTCOME} WHERE id = ?1`, base],
    [`SELECT (id = ?1) AS fresh, outcome FROM payment_events WHERE provider = ?2 AND provider_event_id = ?3`, base],
  ];
}

/** Estorno total simulado: reverte os lançamentos do pagamento e revoga os direitos de download. */
export function refundBatch(orderId: string, refundId: string, now: number): [string, unknown[]][] {
  const p = [orderId, refundId, now];
  return [
    [`UPDATE orders SET status = 'refunded', refund_id = ?2 WHERE id = ?1 AND status = 'paid'`, p],
    [`UPDATE payment_charges SET status = 'refunded'
      WHERE order_id = ?1 AND EXISTS (SELECT 1 FROM orders WHERE id = ?1 AND refund_id = ?2)`, p],
    [`INSERT INTO ledger_entries (order_id, posting_key, account, amount_cents, created_at)
      SELECT order_id, 'refund:' || order_id, account, -amount_cents, ?3 FROM ledger_entries
      WHERE posting_key = 'payment:' || ?1
        AND EXISTS (SELECT 1 FROM orders WHERE id = ?1 AND refund_id = ?2)
      ON CONFLICT (posting_key, account) DO NOTHING`, p],
    [`UPDATE download_entitlements SET status = 'revoked', revoked_at = ?3, revoke_reason = 'refund'
      WHERE order_id = ?1 AND status = 'active'
        AND EXISTS (SELECT 1 FROM orders WHERE id = ?1 AND refund_id = ?2)`, p],
    [`SELECT status, (refund_id IS ?2) AS applied FROM orders WHERE id = ?1`, p],
  ];
}

/** Passa só os parâmetros que a instrução usa (?1..?N); SQLite/D1 rejeitam parâmetros sobrando. */
export function bindUsed(sql: string, params: unknown[]): unknown[] {
  const max = Math.max(0, ...Array.from(sql.matchAll(/\?(\d+)/g), m => Number(m[1])));
  return params.slice(0, max);
}

/** Emula db.batch() do D1: todas as instruções numa transação; devolve o resultado da última. */
export function runBatch(db: DatabaseSync, stmts: [string, unknown[]][]): Record<string, unknown> | undefined {
  db.exec("BEGIN IMMEDIATE");
  try {
    let last: Record<string, unknown> | undefined;
    for (const [sql, params] of stmts) {
      const st = db.prepare(sql);
      const args = bindUsed(sql, params) as never[];
      if (/^\s*SELECT/i.test(sql)) last = st.get(...args) as Record<string, unknown>;
      else st.run(...args);
    }
    db.exec("COMMIT");
    return last;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
```

## 5. Verificação da consulta de busca B1

`b1-query-check.mjs`: mostra que a consulta exige a mesma pessoa e exclui fotos privadas e de outros álbuns.

```js
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE person_attributes (photo_id TEXT, album_id TEXT, person_idx INTEGER, rel_height REAL, region TEXT, color TEXT, confidence REAL, PRIMARY KEY (photo_id, person_idx, region));
CREATE TABLE photos (id TEXT PRIMARY KEY, album_id TEXT, visible INTEGER);
CREATE VIEW visible_photos AS SELECT id AS photo_id, album_id FROM photos WHERE visible = 1;
INSERT INTO photos VALUES ('p1','A',1),('p2','A',1),('p3','A',0),('p4','B',1);
-- p1: mesma pessoa com camisa vermelha + boné preto
INSERT INTO person_attributes VALUES ('p1','A',0,0.6,'superior','vermelho',0.9),('p1','A',0,0.6,'cabeca','preto',0.8);
-- p2: pessoa 0 camisa vermelha, pessoa 1 boné preto (falso positivo clássico)
INSERT INTO person_attributes VALUES ('p2','A',0,0.5,'superior','vermelho',0.95),('p2','A',1,0.5,'cabeca','preto',0.95);
-- p3: privada (não visível) com tudo igual
INSERT INTO person_attributes VALUES ('p3','A',0,0.7,'superior','vermelho',0.99),('p3','A',0,0.7,'cabeca','preto',0.99);
-- p4: outro álbum
INSERT INTO person_attributes VALUES ('p4','B',0,0.7,'superior','vermelho',0.99),('p4','B',0,0.7,'cabeca','preto',0.99);
`);
const sql = `
WITH q(region, color, weight) AS (VALUES (?2, ?3, 1.0), (?4, ?5, 1.0)),
vis AS (SELECT photo_id FROM visible_photos WHERE album_id = ?1)
SELECT pa.photo_id, pa.person_idx,
       SUM(pa.confidence * q.weight)            AS score,
       COUNT(DISTINCT q.region || q.color)      AS matched,
       MAX(pa.rel_height)                       AS size
FROM person_attributes pa
JOIN q   ON (q.region = pa.region OR q.region = 'qualquer') AND q.color = pa.color
JOIN vis ON vis.photo_id = pa.photo_id
WHERE pa.album_id = ?1
GROUP BY pa.photo_id, pa.person_idx
ORDER BY matched DESC, score DESC, size DESC, pa.photo_id
LIMIT 200;`;
console.table(db.prepare(sql).all("A", "superior", "vermelho", "cabeca", "preto"));
```

## 6. Testes

`reference.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyLabSignature, signLabPayload } from "./webhook-signature.ts";
import { allocate, divRoundHalfEven, splitOrder, checkSplit, type CommissionRule } from "./money.ts";
import { parseClothingQuery } from "./clothing-query.ts";
import { SCHEMA, confirmPaymentBatch, refundBatch, runBatch, paymentPostings, loadOrderForTxid, type PaidEvent } from "./payment-confirm.ts";

const enc = new TextEncoder();
const SECRET = "segredo-sintetico-de-teste";
const NOW = 1_761_264_000;

// ---------------------------------------------------------------- assinatura
test("PAG-04 assinatura válida é aceita", async () => {
  const body = enc.encode('{"type":"pix.paid","txid":"abc"}');
  const h = await signLabPayload(body, SECRET, NOW);
  assert.equal(await verifyLabSignature(body, h, [SECRET], NOW), true);
});
test("PAG-05 assinatura com segredo errado é rejeitada", async () => {
  const body = enc.encode("{}");
  const h = await signLabPayload(body, "outro-segredo", NOW);
  assert.equal(await verifyLabSignature(body, h, [SECRET], NOW), false);
});
test("PAG-05 corpo alterado após assinar é rejeitado", async () => {
  const h = await signLabPayload(enc.encode('{"amountCents":4500}'), SECRET, NOW);
  assert.equal(await verifyLabSignature(enc.encode('{"amountCents":1}'), h, [SECRET], NOW), false);
});
test("PAG-05 timestamp fora da tolerância (replay) é rejeitado", async () => {
  const body = enc.encode("{}");
  const h = await signLabPayload(body, SECRET, NOW - 301);
  assert.equal(await verifyLabSignature(body, h, [SECRET], NOW), false);
});
test("PAG-04 cabeçalho ausente ou malformado é rejeitado", async () => {
  const body = enc.encode("{}");
  for (const h of [null, "", "v1=abc", "t=1,v1=xyz", "t=abc,v1=" + "0".repeat(64), "t=1".repeat(100)]) {
    assert.equal(await verifyLabSignature(body, h, [SECRET], NOW), false, String(h));
  }
});
test("PAG-04 rotação: segredo anterior ainda aceito durante a janela", async () => {
  const body = enc.encode("{}");
  const h = await signLabPayload(body, "segredo-antigo", NOW);
  assert.equal(await verifyLabSignature(body, h, ["segredo-novo", "segredo-antigo"], NOW), true);
});

// ---------------------------------------------------------------- dinheiro
const RULE: CommissionRule = {
  id: "lab-default", version: 1, platformFeeBps: 2000, providerFeeBps: 99,
  providerFeeFixedCents: 0, providerFeeBearer: "platform",
};
test("F04 arredondamento half-even", () => {
  assert.equal(divRoundHalfEven(5, 2), 2);   // 2,5 → 2
  assert.equal(divRoundHalfEven(7, 2), 4);   // 3,5 → 4
  assert.equal(divRoundHalfEven(445500, 10_000), 45); // 44,55 → 45
});
test("F04 alocação por maior resto soma exatamente", () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  for (const total of [0, 1, 7, 99, 12345]) {
    const parts = allocate(total, [3, 5, 11, 1]);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
  }
});
test("F04 exemplo: 3 fotos de R$ 15,00, plataforma absorve a taxa do PSP", () => {
  const s = splitOrder([1, 2, 3].map(() => ({ photographerId: "f1", unitPriceCents: 1500 })), RULE);
  assert.equal(s.totalCents, 4500);
  assert.equal(s.providerFeeCents, 45);
  assert.equal(s.shares[0].platformFeeCents, 900);
  assert.equal(s.shares[0].payableCents, 3600);
  assert.equal(s.platformNetCents, 855);
  assert.ok(checkSplit(s));
});
test("F04 pedido com dois fotógrafos e taxa do PSP paga pelos fotógrafos", () => {
  const s = splitOrder(
    [{ photographerId: "f1", unitPriceCents: 1990 }, { photographerId: "f2", unitPriceCents: 2490 }, { photographerId: "f2", unitPriceCents: 2490 }],
    { ...RULE, providerFeeBearer: "photographer", providerFeeFixedCents: 10 },
  );
  assert.equal(s.totalCents, 6970);
  assert.ok(checkSplit(s));
  assert.equal(s.shares.reduce((a, x) => a + x.providerFeeCents, 0), s.providerFeeCents);
});
test("PAG-01 valores inválidos são recusados", () => {
  for (const bad of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => splitOrder([{ photographerId: "f1", unitPriceCents: bad }], RULE));
  }
  assert.throws(() => splitOrder([], RULE));
});
test("F04 propriedade: invariante contábil em 2.000 pedidos aleatórios", () => {
  let seed = 42;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
  for (let i = 0; i < 2000; i++) {
    const lines = Array.from({ length: 1 + rnd(20) }, () => ({ photographerId: "f" + rnd(4), unitPriceCents: 200 + rnd(20000) }));
    const rule: CommissionRule = { ...RULE, platformFeeBps: rnd(5000), providerFeeBps: rnd(300), providerFeeFixedCents: rnd(50), providerFeeBearer: rnd(2) ? "platform" : "photographer" };
    const s = splitOrder(lines, rule);
    assert.ok(checkSplit(s));
    const postings = paymentPostings(lines, rule, "lab");
    assert.equal(postings.reduce((a, p) => a + p.amountCents, 0), 0);
  }
});

// ---------------------------------------------------------------- confirmação atômica (D1 emulado)
function freshDb(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}
function seedOrder(db: DatabaseSync, { id = "o1", txid = "TX" + "a".repeat(30), total = 4500, expiresAt = NOW + 900 } = {}) {
  db.prepare(`INSERT INTO orders VALUES (?, 'comprador-1', 'pending', ?, 'lab-default', ?, NULL, NULL, NULL)`).run(id, total, expiresAt);
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO order_items VALUES (?, ?, ?, 'f1', 1500)`).run(`${id}-i${i}`, id, `foto-${i}`);
  }
  db.prepare(`INSERT INTO payment_charges VALUES (?, ?, 'lab', ?, ?, 'active', ?)`).run(`c-${id}`, id, txid, total, expiresAt);
  return txid;
}
function deliver(db: DatabaseSync, ev: Omit<PaidEvent, "rowId" | "provider">, now = NOW) {
  const loaded = loadOrderForTxid(db, "lab", ev.txid);
  const postings = loaded ? paymentPostings(loaded.lines, RULE, "lab") : [];
  return runBatch(db, confirmPaymentBatch({ ...ev, provider: "lab", rowId: crypto.randomUUID() }, now, postings));
}
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;

test("PAG-03 caminho feliz: pago, lançamentos zerados, direitos concedidos", () => {
  const db = freshDb();
  const txid = seedOrder(db);
  const r = deliver(db, { providerEventId: "E1", txid, amountCents: 4500 });
  assert.deepEqual({ ...r }, { fresh: 1, outcome: "applied" });
  assert.equal(count(db, `SELECT count(*) n FROM orders WHERE status='paid'`), 1);
  assert.equal(count(db, `SELECT sum(amount_cents) n FROM ledger_entries`), 0);
  assert.equal(count(db, `SELECT count(*) n FROM download_entitlements WHERE status='active'`), 3);
});
test("PAG-03 evento repetido (mesmo id) é idempotente", () => {
  const db = freshDb();
  const txid = seedOrder(db);
  deliver(db, { providerEventId: "E1", txid, amountCents: 4500 });
  const ledger = count(db, `SELECT count(*) n FROM ledger_entries`);
  const r = deliver(db, { providerEventId: "E1", txid, amountCents: 4500 });
  assert.deepEqual({ ...r }, { fresh: 0, outcome: "applied" });
  assert.equal(count(db, `SELECT count(*) n FROM ledger_entries`), ledger);
  assert.equal(count(db, `SELECT count(*) n FROM download_entitlements`), 3);
  assert.equal(count(db, `SELECT count(*) n FROM payment_events`), 1);
});
test("PAG-08 segundo pagamento (id diferente) do mesmo pedido não lança em dobro", () => {
  const db = freshDb();
  const txid = seedOrder(db);
  deliver(db, { providerEventId: "E1", txid, amountCents: 4500 });
  const r = deliver(db, { providerEventId: "E2", txid, amountCents: 4500 });
  assert.equal(r?.outcome, "already_paid");
  assert.equal(count(db, `SELECT count(*) n FROM ledger_entries WHERE posting_key LIKE 'payment:%'`), 4);
});
test("PAG-01 valor divergente no evento não confirma o pedido nem concede direitos (PAG-12)", () => {
  const db = freshDb();
  const txid = seedOrder(db);
  const r = deliver(db, { providerEventId: "E1", txid, amountCents: 1 });
  assert.equal(r?.outcome, "amount_mismatch");
  assert.equal(count(db, `SELECT count(*) n FROM orders WHERE status='pending'`), 1);
  assert.equal(count(db, `SELECT count(*) n FROM download_entitlements`), 0);
  assert.equal(count(db, `SELECT count(*) n FROM ledger_entries`), 0);
});
test("PAG-06 pagamento após a validade não libera fotos (PAG-12)", () => {
  const db = freshDb();
  const txid = seedOrder(db, { expiresAt: NOW - 1 });
  const r = deliver(db, { providerEventId: "E1", txid, amountCents: 4500 });
  assert.equal(r?.outcome, "late_payment");
  assert.equal(count(db, `SELECT count(*) n FROM download_entitlements`), 0);
});
test("PAG-04 cobrança desconhecida", () => {
  const db = freshDb();
  seedOrder(db);
  const r = deliver(db, { providerEventId: "E1", txid: "TX-inexistente", amountCents: 4500 });
  assert.equal(r?.outcome, "unknown_charge");
});
test("PAG-10 concorrência: duas conexões leem antes e confirmam depois", () => {
  const dir = mkdtempSync(join(tmpdir(), "fv-"));
  try {
    const file = join(dir, "lab.sqlite");
    const a = freshDb(file);
    const txid = seedOrder(a);
    const b = new DatabaseSync(file);
    // Os dois workers leem e calculam antes de qualquer escrita (pior caso).
    const la = loadOrderForTxid(a, "lab", txid)!;
    const lb = loadOrderForTxid(b, "lab", txid)!;
    const ra = runBatch(a, confirmPaymentBatch({ rowId: "ra", provider: "lab", providerEventId: "E1", txid, amountCents: 4500 }, NOW, paymentPostings(la.lines, RULE, "lab")));
    const rb = runBatch(b, confirmPaymentBatch({ rowId: "rb", provider: "lab", providerEventId: "E2", txid, amountCents: 4500 }, NOW, paymentPostings(lb.lines, RULE, "lab")));
    assert.equal(ra?.outcome, "applied");
    assert.equal(rb?.outcome, "already_paid");
    assert.equal(count(a, `SELECT count(*) n FROM download_entitlements`), 3);
    assert.equal(count(a, `SELECT sum(amount_cents) n FROM ledger_entries`), 0);
    a.close(); b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("PAG-09 estorno total reverte lançamentos e revoga direitos; repetir é idempotente", () => {
  const db = freshDb();
  const txid = seedOrder(db);
  deliver(db, { providerEventId: "E1", txid, amountCents: 4500 });
  const r1 = runBatch(db, refundBatch("o1", "R1", NOW + 60));
  const r2 = runBatch(db, refundBatch("o1", "R2", NOW + 61));
  assert.deepEqual({ ...r1 }, { status: "refunded", applied: 1 });
  assert.deepEqual({ ...r2 }, { status: "refunded", applied: 0 });
  assert.equal(count(db, `SELECT count(*) n FROM ledger_entries WHERE posting_key LIKE 'refund:%'`), 4);
  assert.equal(count(db, `SELECT sum(amount_cents) n FROM ledger_entries WHERE account LIKE 'payable:%'`), 0);
  assert.equal(count(db, `SELECT count(*) n FROM download_entitlements WHERE status='active'`), 0);
});
test("PAG-09 estorno de pedido não pago não faz nada", () => {
  const db = freshDb();
  seedOrder(db);
  const r = runBatch(db, refundBatch("o1", "R1", NOW));
  assert.deepEqual({ ...r }, { status: "pending", applied: 0 });
  assert.equal(count(db, `SELECT count(*) n FROM ledger_entries`), 0);
});
test("F04 ledger é somente-inserção (UPDATE/DELETE bloqueados por trigger)", () => {
  const db = freshDb();
  const txid = seedOrder(db);
  deliver(db, { providerEventId: "E1", txid, amountCents: 4500 });
  assert.throws(() => db.exec(`UPDATE ledger_entries SET amount_cents = 0`), /append-only/);
  assert.throws(() => db.exec(`DELETE FROM ledger_entries`), /append-only/);
});

// ---------------------------------------------------------------- consulta de roupas
test("BUS-00 interpretação de consultas", () => {
  assert.deepEqual(parseClothingQuery("Camisa vermelha e boné preto").items, [
    { type: "camisa", region: "superior", color: "vermelho" },
    { type: "bone", region: "cabeca", color: "preto" },
  ]);
  assert.deepEqual(parseClothingQuery("blusa azul-marinho").items, [{ type: "blusa", region: "superior", color: "azul_marinho" }]);
  assert.deepEqual(parseClothingQuery("uniforme BRANCO").items, [{ type: "uniforme", region: "corpo_inteiro", color: "branco" }]);
  assert.deepEqual(parseClothingQuery("roupa preta").items, [{ type: "roupa", region: "qualquer", color: "preto" }]);
  assert.deepEqual(parseClothingQuery("mochila").items, [{ type: "mochila", region: "bolsa" }]);
  const n = parseClothingQuery("camisa com número 1234");
  assert.equal(n.bib, "1234");
  assert.deepEqual(n.items, [{ type: "camisa", region: "superior" }]);
  assert.equal(parseClothingQuery("#77 regata amarela").bib, "77");
  assert.deepEqual(parseClothingQuery("vermelho e azul").items.map(i => i.color), ["vermelho", "azul"]);
  assert.deepEqual(parseClothingQuery("calças azuis").items, [{ type: "calca", region: "inferior", color: "azul" }]);
});
test("BUS-00 termos desconhecidos são relatados, não inventados", () => {
  const q = parseClothingQuery("camisa do flamengo");
  assert.deepEqual(q.items, [{ type: "camisa", region: "superior" }]);
  assert.deepEqual(q.unrecognized, ["flamengo"]);
});
test("BUS-00 consulta vazia/hostil não quebra e tem limite", () => {
  assert.deepEqual(parseClothingQuery("").items, []);
  assert.deepEqual(parseClothingQuery("<script>alert(1)</script>").items, []);
  assert.ok(parseClothingQuery("camisa ".repeat(500)).items.length <= 5);
});
```
