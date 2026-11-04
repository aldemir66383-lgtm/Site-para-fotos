# Plano de testes obrigatórios

> **Legenda:**
> - ✅ **executado** no código de referência (`node --test`, 25/25 passando, Node v24.19.0)
> - 🟡 **parcial**: a regra central foi executada, mas a rota HTTP depende do código-fonte
> - 📝 **especificado**: precisa do código-fonte privado para rodar
>
> Use **somente dados sintéticos** ou imagens com uso autorizado. Todo grupo inclui casos negativos.

## 1. Pagamentos

| ID | Requisito | Cenário | Esperado | Nível | Situação |
|---|---|---|---|---|---|
| PAG-01 | Valores incorretos | Preço negativo, fracionário, `NaN` ou acima de `MAX_SAFE_INTEGER`; pedido vazio | Erro de validação; nada é gravado | Unitário | ✅ |
| PAG-01 | Valores incorretos | Evento `paid` com valor ≠ total do pedido | `outcome = amount_mismatch`; pedido continua `pending`; 0 lançamentos; 0 direitos | Integração (SQL) | ✅ |
| PAG-02 | Preços manipulados | `POST /orders` com `totalCents: 1` e `price: 1` no corpo | Ignorados; total = soma dos preços do catálogo; log `client_price_ignored` | Integração HTTP | 📝 |
| PAG-02 | Preços manipulados | Preço do álbum muda depois de criado o pedido | O pedido mantém o snapshot; um carrinho novo usa o preço novo | Integração | 📝 |
| PAG-03 | Eventos repetidos | O mesmo `providerEventId` entregue 2 vezes | Segunda resposta com `fresh = 0`; nenhuma linha nova em eventos, ledger ou direitos | Integração (SQL) | ✅ |
| PAG-04 | Webhooks inválidos | Sem cabeçalho, cabeçalho malformado, `t` não numérico, `v1` fora do formato | `false` → `401` sem detalhe | Unitário | ✅ |
| PAG-04 | Webhooks inválidos | `txid` desconhecido | `outcome = unknown_charge` | Integração (SQL) | ✅ |
| PAG-04 | Webhooks inválidos | Corpo > 16 KB; JSON inválido com assinatura válida | `413`; `400`, sem mudança de estado | Integração HTTP | 📝 |
| PAG-05 | Assinaturas incorretas | Segredo errado; corpo alterado depois de assinar; `t` fora de ±300 s (replay) | Rejeitado | Unitário | ✅ |
| PAG-05 | Rotação | Assinado com o segredo anterior durante a janela | Aceito | Unitário | ✅ |
| PAG-06 | Pagamentos expirados | Evento `paid` depois de `expires_at` | `outcome = late_payment`; nenhum direito; (live) `refunds` automático | Integração (SQL) | ✅ |
| PAG-06 | Expiração | Ler pedido `pending` vencido | Passa a `expired` na leitura | Integração | 📝 |
| PAG-07 | Pedidos de outros compradores | Sessão B lê, gera ticket ou recuperação no pedido de A | `404` em todas as rotas `orders/:id/*` | Integração HTTP | 📝 |
| PAG-08 | Tentativas duplicadas | Segundo pagamento (outro id) para o mesmo pedido | `already_paid`; sem lançamento duplo (chave `payment:<orderId>`) | Integração (SQL) | ✅ |
| PAG-08 | Tentativas duplicadas | Duplo clique em "Continuar para simulação Pix" (mesma chave de idempotência) | O mesmo pedido é devolvido | Integração HTTP | 📝 |
| PAG-09 | Reembolsos | Estorno total | Lançamentos se anulam; `payable` = 0; direitos revogados | Integração (SQL) | ✅ |
| PAG-09 | Reembolsos | Estorno repetido (outro `refundId`) | `applied = 0`; nada novo | Integração (SQL) | ✅ |
| PAG-09 | Reembolsos | Estorno de pedido não pago | Nada acontece | Integração (SQL) | ✅ |
| PAG-09 | Reembolsos | Estorno parcial de 1 de 3 fotos | Só aquele direito é revogado; lançamentos proporcionais | Integração | 📝 |
| PAG-10 | Concorrência | Duas conexões leem o pedido antes e confirmam eventos diferentes depois | Uma `applied`, a outra `already_paid`; 3 direitos; ledger soma 0 | Integração (SQL, 2 conexões) | ✅ |
| PAG-10 | Concorrência | 20 requisições paralelas de ticket para o mesmo direito | Só um uso por ticket; limite de 10/h respeitado | Integração HTTP | 📝 |
| PAG-11 | Falhas de comunicação | Timeout do provedor ao criar a cobrança | Pedido `pending`; a nova tentativa reutiliza o mesmo `txid` | Integração (provedor falso) | 📝 |
| PAG-11 | Falhas de comunicação | D1 indisponível durante o webhook | `503`; o reenvio aplica uma única vez | Integração | 📝 |
| PAG-12 | Entrega sem pagamento | Ticket para pedido `pending`, `expired` ou `refunded` | `404` ou `403`; `delivery_log = denied` | Integração HTTP | 🟡 (os direitos não são criados sem pagamento válido: ✅) |
| PAG-12 | Entrega sem pagamento | Reutilizar a URL do ticket | `410 ticket_used` | Integração HTTP | 📝 |
| F04 | Contabilidade | 2.000 pedidos aleatórios (1–20 itens, 1–4 fotógrafos, taxas variadas) | Invariante de soma e lançamentos somando 0 | Propriedade | ✅ |
| F04 | Contabilidade | `UPDATE` ou `DELETE` em `ledger_entries` | Abortado por trigger | Integração (SQL) | ✅ |

## 2. Busca inteligente

| ID | Requisito | Cenário | Esperado | Nível | Situação |
|---|---|---|---|---|---|
| BUS-00 | Interpretação | Os exemplos do briefing (blusa azul, uniforme branco, roupa preta, mochila, boné, combinação de cores, número) | Atributos canônicos corretos | Unitário | ✅ |
| BUS-00 | Interpretação | Termo desconhecido ("flamengo") | Vai para `unrecognizedTerms`; nada é inventado | Unitário | ✅ |
| BUS-00 | Interpretação | Vazio, `<script>`, 500 repetições | Não quebra; no máximo 5 itens | Unitário | ✅ |
| BUS-01 | Imagem inválida | Arquivo `.jpg` que é PDF; bytes truncados; SVG | `415` ou `422 image_unreadable` | Integração | 📝 |
| BUS-02 | Arquivo grande | 8 MB + 1 byte; 100 MP com poucos bytes ("bomba de descompressão") | `413`; `422` antes de decodificar tudo | Integração | 📝 |
| BUS-03 | Imagem sem pessoa | Cena sintética só com fundo | Referência: `422 no_person`. Selfie: `422 no_face` | Integração (sintético) | 📝 |
| BUS-04 | Múltiplas pessoas | Referência com 3 figuras | Usa a maior (ou a escolhida). Selfie: `422 multiple_faces` | Integração (sintético) | 📝 |
| BUS-05 | Roupas semelhantes | Mesma cor na mesma pessoa × cores divididas entre duas pessoas | A mesma pessoa vem primeiro; a divisão cai de faixa | Integração (SQL) | 🟡 (SQL validada: p1 `matched=2` > p2 `matched=1`) |
| BUS-06 | Iluminação diferente | A mesma cena com ganho de 0,6 a 1,4 por canal | A cor nomeada não muda em ≥ 90% dos casos | Unitário (classificador) | 📝 |
| BUS-07 | Cores semelhantes | Azul × azul-marinho × preto | Exato > vizinho; vizinho aparece com peso menor | Unitário | 📝 |
| BUS-08 | Falsas correspondências | Consulta "camisa verde" em álbum sem verde | Sem resultados `alta`; no máximo `baixa`, recolhidos | Integração | 📝 |
| BUS-09 | Sem correspondência | Álbum sem índice | `200 results: []` + motivo `not_indexed` nas capacidades | Integração | 📝 |
| BUS-10 | Fora do álbum autorizado | `albumId` de um álbum com fotos idênticas | Fotos do outro álbum não aparecem | Integração (SQL) | 🟡 (p4 excluída ✅) |
| BUS-10 | Fora do álbum autorizado | `albumId` de rascunho ou ocultado | `404` | Integração HTTP | 📝 |
| BUS-11 | Fotos privadas | Foto não visível com atributos idênticos | Não aparece | Integração (SQL) | 🟡 (p3 excluída ✅) |
| BUS-11 | Fotos privadas | Resposta contém URL de original ou chave do R2 | Nunca: só `/previews/:id` | Contrato | 📝 |
| BUS-12 | Cancelamento | `DELETE` durante `processing` | `204`; o status passa a `canceled`; resultados não são gravados | Integração | 📝 |
| BUS-12 | Cancelamento | `DELETE` da sessão de outra pessoa | `404` | Integração | 📝 |
| BUS-13 | Exclusão de temporários | Depois de `DELETE` ou TTL de 30 min | A linha não existe; nenhuma imagem no R2; logs sem payload | Integração | 📝 |
| BUS-13 | Exclusão de temporários | Selfie (modo `synthetic`) | Bytes e vetor nunca persistidos (inspecionar D1, R2 e logs) | Integração | 📝 |
| BUS-14 | Limite de requisições | 31 buscas por roupa em 1 min | `429` com `retryAfterSeconds` | Integração | 📝 |
| BUS-15 | Flag desligada | Qualquer rota de busca com `FV_SEARCH_CLOTHING=off` | `403 feature_disabled` | Integração | 📝 |
| BUS-16 | Selfie bloqueada | `mode=selfie` com `FV_FACE_SEARCH=off` | `403`; nenhuma leitura do corpo além do cabeçalho multipart | Integração | 📝 |
| BUS-17 | Associação correta | Fotógrafo envia atributos para a foto de outro fotógrafo | `404`; nada gravado | Integração | 📝 |

## 3. Resultados das simulações executadas

```text
✔ PAG-04 assinatura válida é aceita
✔ PAG-05 assinatura com segredo errado é rejeitada
✔ PAG-05 corpo alterado após assinar é rejeitado
✔ PAG-05 timestamp fora da tolerância (replay) é rejeitado
✔ PAG-04 cabeçalho ausente ou malformado é rejeitado
✔ PAG-04 rotação: segredo anterior ainda aceito durante a janela
✔ F04 arredondamento half-even
✔ F04 alocação por maior resto soma exatamente
✔ F04 exemplo: 3 fotos de R$ 15,00, plataforma absorve a taxa do PSP
✔ F04 pedido com dois fotógrafos e taxa do PSP paga pelos fotógrafos
✔ PAG-01 valores inválidos são recusados
✔ F04 propriedade: invariante contábil em 2.000 pedidos aleatórios
✔ PAG-03 caminho feliz: pago, lançamentos zerados, direitos concedidos
✔ PAG-03 evento repetido (mesmo id) é idempotente
✔ PAG-08 segundo pagamento (id diferente) do mesmo pedido não lança em dobro
✔ PAG-01 valor divergente no evento não confirma o pedido nem concede direitos (PAG-12)
✔ PAG-06 pagamento após a validade não libera fotos (PAG-12)
✔ PAG-04 cobrança desconhecida
✔ PAG-10 concorrência: duas conexões leem antes e confirmam depois
✔ PAG-09 estorno total reverte lançamentos e revoga direitos; repetir é idempotente
✔ PAG-09 estorno de pedido não pago não faz nada
✔ F04 ledger é somente-inserção (UPDATE/DELETE bloqueados por trigger)
✔ BUS-00 interpretação de consultas
✔ BUS-00 termos desconhecidos são relatados, não inventados
✔ BUS-00 consulta vazia/hostil não quebra e tem limite
ℹ tests 25
ℹ pass 25
ℹ fail 0
node v24.19.0
```

**Bugs encontrados e corrigidos pelos próprios testes:**

1. `refund_id = ?` devolvia `NULL` (e não `0`) quando o pedido nunca tinha sido estornado. A comparação passou a usar `IS`.
2. Plurais de peças ("calças", "bonés") não eram reconhecidos. Foi adicionado o tratamento de plural.

**Limite desta evidência:** os testes rodam no Node com `node:sqlite` (SQLite 3.53), o mesmo motor do D1, com o batch emulado por `BEGIN IMMEDIATE/COMMIT`. Eles **não** substituem testes no `wrangler dev` / Miniflare com o código real, que estão marcados como 📝.
