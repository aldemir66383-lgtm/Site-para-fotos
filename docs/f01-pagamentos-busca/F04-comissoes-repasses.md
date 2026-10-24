# F04 — Comissões, taxas, estornos e repasses

> **Status:** ✅ regras especificadas · ✅ cálculo e lançamentos testados (inclui 2.000 pedidos aleatórios) · ⚠️ falta integrar ao ledger existente do laboratório
> **Regra:** comissões e repasses são **fictícios**. Não existe código de transferência, saque nem cadastro de conta bancária.

## 1. Regras configuráveis

Uma regra (`commission_rules`, ver F02 §5) define:

| Campo | Exemplo | Significado |
|---|---|---|
| `platform_fee_bps` | `2000` | Comissão da plataforma sobre o valor bruto de cada fotógrafo (20%) |
| `provider_fee_bps` + `provider_fee_fixed_cents` | `99` + `0` | Taxa do PSP sobre a cobrança inteira (0,99%). Os valores são **ilustrativos** |
| `provider_fee_bearer` | `platform` | Quem paga a taxa do PSP: `platform` ou `photographer` |
| `provider_fee_refundable` | `0` | Se o PSP devolve a taxa em caso de estorno (no Pix, geralmente não devolve; confirmar com o PSP) |
| `hold_days` | `7` | Dias até o saldo ficar disponível (janela de estorno) |
| `scope` | `global` · `photographer` · `album` | A regra mais específica vence |
| `version`, `valid_from`, `valid_to` | — | Regras nunca são editadas: cria-se uma versão nova |

**Snapshot:** o pedido grava `commission_rule_id` ao ser criado. Mudar a regra depois **não altera** pedidos antigos.

## 2. Cálculo

- **Unidade:** centavos inteiros; taxas em *basis points*.
- **Arredondamento:** metade para o par (*half-even*), só com inteiros.
- **Pedido com vários fotógrafos:** o carrinho agrupa as fotos por álbum, então um pedido pode envolver mais de um fotógrafo. A comissão é calculada **por fotógrafo**. A taxa do PSP incide sobre a cobrança inteira e, quando paga pelos fotógrafos, é distribuída pelo **método do maior resto**, que garante soma exata.
- **Invariante:** `Σ repasses + receita líquida da plataforma + taxa do PSP = total` (verificada em 2.000 pedidos aleatórios).

### Exemplo verificado

3 fotos de R$ 15,00 de um único fotógrafo; plataforma 20%; PSP 0,99%; a plataforma paga a taxa do PSP.

| Item | Cálculo | Centavos |
|---|---|---|
| Total | 3 × 1500 | **4500** |
| Taxa do PSP | 4500 × 0,99% = 44,55 → 45 | **45** |
| Comissão da plataforma | 4500 × 20% | **900** |
| Devido ao fotógrafo | 4500 − 900 | **3600** |
| Receita líquida da plataforma | 900 − 45 | **855** |
| Conferência | 3600 + 855 + 45 | **4500** ✅ |

## 3. Lançamentos (partidas dobradas)

Débitos são positivos e créditos negativos. **Cada grupo de lançamentos soma zero.**

| Conta | Natureza | No pagamento do exemplo |
|---|---|---|
| `clearing:lab` | Dinheiro a receber do PSP | +4455 |
| `expense:provider_fee` | Despesa com o PSP | +45 |
| `revenue:platform_fee` | Receita da plataforma | −900 |
| `revenue:provider_fee_recharge` | Taxa do PSP repassada ao fotógrafo (só quando `bearer=photographer`) | — |
| `payable:photographer:<id>` | Devido ao fotógrafo | −3600 |
| **Soma** | | **0** ✅ |

- `posting_key` identifica o grupo e é único por conta: `payment:<orderId>`, `refund:<refundId>`, `adjust:<uuid>`, `payout:<batchId>`. Repetir uma operação não duplica nada.
- O ledger existente do laboratório já expõe `feeNetCents`, `photographerDueNetCents`, `paidClearingCents` e `refundedClearingCents`. **Mapear essas contas** para as acima, em vez de criar um ledger paralelo. A novidade principal é `expense:provider_fee`.

## 4. Estornos

| Tipo | Lançamentos | Direitos de download |
|---|---|---|
| **Total** | Reverte todo o grupo `payment:<orderId>` com sinal invertido, na chave `refund:<orderId>`. Se `provider_fee_refundable = 0`, a linha `expense:provider_fee` **não** é revertida e a plataforma absorve a perda (lançamento `expense:refund_loss`) | Todos `revoked` |
| **Parcial (itens)** | Recalcula o *split* só dos itens estornados com a mesma regra do pedido e lança o inverso na chave `refund:<refundId>` | Só os itens estornados ficam `revoked` |
| **Depois do repasse fictício** | O fotógrafo fica com saldo negativo (`receivable:photographer:<id>`), compensado no próximo lote | — |

O estorno total foi testado: os lançamentos se anulam, o saldo `payable` volta a 0, os direitos são revogados e repetir o estorno não tem efeito. O código de referência faz a reversão **integral**, o que equivale a `provider_fee_refundable = 1`; a variante com perda da taxa ainda precisa ser implementada.

## 5. Ajustes

- São lançamentos manuais com `posting_key = adjust:<uuid>`, e exigem `reason` (texto até 280 caracteres), `actor` e o papel `finance_admin`.
- Os lançamentos de um ajuste também precisam somar zero; é proibido "criar dinheiro".
- No live (🔒), passam a exigir **dois aprovadores diferentes**.

## 6. Saldo do fotógrafo

O saldo é calculado a partir do ledger e nunca é guardado como número solto:

| Estado | Regra |
|---|---|
| `pending` | Lançamentos `payable` de pedidos pagos há menos de `hold_days` |
| `available` | `payable` com mais de `hold_days`, sem estorno pendente |
| `in_payout` | Incluído num lote `simulated` |
| `negative` | Estornos depois do repasse (`receivable`) |

```sql
-- saldo disponível (fictício) de um fotógrafo
SELECT -COALESCE(SUM(le.amount_cents), 0) AS available_cents
FROM ledger_entries le JOIN orders o ON o.id = le.order_id
WHERE le.account = 'payable:photographer:' || ?1
  AND o.paid_at <= ?2 - (?3 * 86400000);   -- ?3 = hold_days
```

## 7. Repasses fictícios

- `POST /api/fotoviva/finance-lab/payouts/simulate { photographerId }` está disponível só no laboratório e para `finance_admin`. Ele cria um `payout_batches(status='simulated')` e os lançamentos `payable:photographer:<id> +X` / `clearing:payout_simulated −X`.
- **Não existe** estado `transferred` nem adaptador de transferência. A tela deve mostrar: "Repasse simulado — nenhum valor foi transferido".

## 8. Histórico e auditoria

- `ledger_entries` aceita apenas inserções (triggers testados contra `UPDATE` e `DELETE`).
- Cada operação registra `actor`, `created_at` e a chave idempotente.
- A conciliação (existente) ganha estas invariantes:
  1. cada `posting_key` soma 0;
  2. pedido `paid` ⇒ existe o grupo `payment:<id>`;
  3. pedido `refunded` ⇒ existe o grupo `refund:*`;
  4. Σ `payable` por fotógrafo = saldo exibido;
  5. eventos com dinheiro e não aplicados ⇒ existe um `refunds` correspondente.
