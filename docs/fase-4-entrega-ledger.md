# Fase 4.1 — Entrega de originais e split contábil

> Atualização Aire Photos: o passo seguinte acrescentou [busca facial, WhatsApp pós-pagamento e manutenção](aire-photos-selfie-whatsapp.md). O webhook Pix agora integra a liquidação à outbox WhatsApp. Os anexos novos usam `aire-photos-…`; nomes internos da API permanecem para compatibilidade.

O Worker da Fase 2 agora roteia também tickets, entrega individual, ZIP e saldo/solicitação de repasse. Os originais continuam no mesmo R2 privado; nenhuma rota retorna URL pré-assinada de leitura. Este passo implementa o backend de entrega e contabilidade. O adaptador de pagamento real, a transferência Pix e o envio de WhatsApp não são implementados por estes handlers.

## Contratos

Autenticação em todas as rotas: JWT verificado pelo emissor/JWKS configurado em `AUTH_*`. Aceita `Authorization: Bearer …` ou cookie `fv_session` com o mesmo JWT. O emissor deve configurar o cookie com `HttpOnly; Secure; SameSite=Lax` ou mais restritivo. POSTs autenticados por cookie exigem `Origin` igual à origem da API, para proteção CSRF. A aplicação pode substituir o adaptador de sessão, preservando identidade, papel e CSRF. A audiência configurada deve ser válida para compradores e fotógrafos.

| Método e rota | Entrada | Resposta |
|---|---|---|
| `POST /api/fotoviva/orders/:id/photos/:photoId/ticket` | Corpo vazio | `201 { url, expiresAt }` |
| `GET /api/fotoviva/deliveries/:token` | Ticket e sessão do comprador | JPEG original como anexo |
| `POST /api/fotoviva/orders/:id/download-all-zip/ticket` | Corpo vazio | `201 { url, expiresAt }` |
| `GET /api/fotoviva/orders/:id/download-all-zip?ticket=…` | Ticket ZIP e sessão do comprador | ZIP original como anexo |
| `GET /api/fotoviva/photographer/balance` | Papel `photographer` | `{ pendingCents, availableCents, negativeCents, inPayoutCents }` |
| `POST /api/fotoviva/photographer/payouts` | `Idempotency-Key` e JSON `{ "amountCents": 3000 }` | `201 { id, amountCents, status: "requested" }`; repetição idêntica `200` |

O comprador pode ter papel `buyer` ou `photographer`; o acesso é sempre vinculado ao `sub` da sessão, nunca a uma identidade informada no corpo. Pedidos e fotos alheios retornam `404`. O corpo do repasse não aceita fotógrafo nem chave Pix: ambos vêm da sessão/cadastro verificado.

Para navegação nativa do navegador, obtenha o ticket por POST e navegue para a URL retornada, com o cookie de sessão válido. Não converta o ZIP inteiro para Blob no cliente. Com autenticação exclusiva por Bearer, o consumidor deve enviar esse cabeçalho também no GET e drenar o stream para o destino; `window.location` não transporta Authorization. O componente React de referência ainda não foi conectado a esse fluxo.

## Direitos, tickets e auditoria

- Direitos são concedidos pela liquidação, na mesma transação do pagamento e do ledger, por **30 dias**, com o limite já existente de **cinco tentativas de download por foto**.
- A validação exige pedido pago (ou parcialmente estornado com o direito específico ainda ativo), titular correto, foto disponível, direito ativo/não expirado e vínculo com o evento que pagou o pedido. A janela máxima é calculada também a partir de `orders.paid_at_ms`; alterar apenas `expires_at` não estende os 30 dias.
- Ticket: 32 bytes aleatórios, base64url, validade de **60 segundos**. Só o SHA-256 é persistido. A tabela de itens fixa os direitos do pacote; tickets ZIP e individuais não são intercambiáveis.
- Emissão limitada a **dez tickets por direito por hora**, somando os dois tipos. A checagem e a inserção acontecem na mesma transação.
- O consumo faz compare-and-set no ticket e decrementa todas as quotas em uma única transação. Um `claim_id` aleatório por consumo protege até contra chamadas concorrentes no mesmo milissegundo. Replay não decrementa novamente.
- A validade de 60 s governa o **início**, não a duração da transferência. Os direitos são revalidados ao consumir e antes de abrir cada original no ZIP; expiração ou revogação posterior interrompe as próximas leituras. Bytes já transmitidos não podem ser recolhidos.
- O pacote é completo e comporta até **1.000 fotos**. Se qualquer item do pedido estiver indisponível, sem direito ou sem quota, ele é recusado; não se produz silenciosamente um pacote parcial. Fotos restantes de um pedido parcialmente estornado podem ser baixadas individualmente se mantiverem seus direitos.
- A quota conta **tentativas admitidas**, inclusive se houver falha de rede/R2 ou cancelamento depois do consumo; não há devolução automática da quota nem retomada via Range. Para tentar novamente, emita outro ticket. Essa política impede reuso ou duplicação de reservas após falhas ambíguas.
- `delivery_log` é append-only e registra `issued`, `started`, `served`, `expired`, `reused`, `denied`, `revoked`, `download_limit`, `rate_limited`, `storage_error` e `cancelled`, com sujeito, pedido, hash do ticket e bytes. Não contém token bruto nem IP. `served` significa que o servidor terminou de fornecer o stream, não que o usuário confirmou salvamento em disco.

Respostas de download usam `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e `Content-Disposition: attachment`. O ZIP usa exatamente `fotoviva-evento-{orderId}.zip`. Não registre query strings ou URLs de entrega em analytics, logs de proxy/CDN ou ferramentas de erro; o parâmetro ticket é uma credencial efêmera.

Erros relevantes: `401 unauthenticated`, `403 invalid_origin/photographer_required`, `404 not_found`, `409 download_limit/payout_unavailable/idempotency_conflict`, `410 ticket_used/ticket_expired`, `429 rate_limited` e `503 temporarily_unavailable`.

## ZIP sem arquivos temporários

`src/server/delivery/stream-zip.ts` usa zip.js com Web Streams, método STORE (JPEG já é comprimido), data descriptors, ZIP64, sem Web Workers ou buffer de arquivo inteiro. A leitura é sequencial e o stream HTTP aplica backpressure. O cancelamento fecha explicitamente o leitor ativo do R2 e impede a abertura do próximo objeto.

O consumo do ticket e a reserva das quotas acontecem antes dos cabeçalhos. Se um original desaparecer depois, o stream falha e o resultado é auditado; não é possível trocar o status HTTP depois que os cabeçalhos já foram enviados. O cliente deve tratar a interrupção como download incompleto. `ExecutionContext.waitUntil` mantém o fechamento da auditoria ativo após o encerramento da resposta.

O limite de 1.000 fotos mantém limitada a lista de metadados do diretório ZIP; o tamanho dos bytes das fotos não é mantido na memória do Worker. Para pacotes grandes, use Workers Paid e configure CPU/subrequests conforme carga: há uma revalidação D1 e um GET R2 por arquivo, além das operações de ticket. Faça homologação com volumes e redes reais antes de produção. ZIP64 permite que o pacote ultrapasse 4 GiB.

## Liquidação e split

O hook interno `settleVerifiedPayment(db, event, now?)`, em `src/server/finance/settlement.ts`, deve ser chamado pelo adaptador PSP **depois de validar assinatura/autenticidade e o estado liquidado do pagamento**. Ele não está exposto como endpoint que um comprador possa acionar. Não conecte o retorno do checkout ou uma confirmação enviada pelo navegador diretamente a esse hook.

```ts
await settleVerifiedPayment(env.DB, {
  provider: "seu_psp",
  providerEventId: eventoVerificado.id,
  txid: eventoVerificado.txid,
  amountCents: eventoVerificado.amountCents,
});
```

O hook confere cobrança, valor, validade e snapshot dos itens. A regra de comissão vem exclusivamente de `orders.commission_rule_id`. A transação confirma pedido/cobrança, sela o grupo contábil e concede direitos. Repetir o evento ou receber dois eventos para a mesma cobrança não duplica ledger nem direitos. O retorno `already_paid`/`not_pending_or_expired` deve ser conciliado pelo adaptador; pagamentos tardios não concedem acesso.

`commission_rules` é imutável, tem taxas em basis points, versão e `hold_days`. Cadastre uma nova regra para mudar taxas futuras. Os valores do exemplo abaixo são ilustrativos e precisam corresponder ao contrato do PSP:

```sql
INSERT INTO commission_rules
  (id,version,platform_fee_bps,provider_fee_bps,provider_fee_fixed_cents,provider_fee_bearer,hold_days)
VALUES ('example-v1',1,2000,99,0,'platform',7);
```

Exemplo do F04, total R$45,00:

| Conta | Direção | Centavos |
|---|---|---:|
| `clearing:{provider}` | débito | 4455 |
| `expense:provider_fee` | débito | 45 |
| `revenue:platform_fee` | crédito | 900 |
| `photographer:{id}` | crédito | 3600 |

O débito de clearing inclui apenas o valor líquido recebido do PSP; os débitos totalizam 4500 e os créditos 4500. Quando o fotógrafo absorve a taxa, o cálculo usa maior resto e acrescenta `revenue:provider_fee_recharge`. A conta `photographer:{id}` atende ao contrato desta fase e corresponde à obrigação `payable:photographer:<id>` descrita no F04; não se cria outro ledger paralelo.

O schema existente mantém `direction` e `amount_cents` positivo: débito soma positivo e crédito negativo ao conciliar. O cálculo usa BigInt nos produtos, half-even e maior resto. Grupos novos têm `ledger_postings.state='draft'`, número esperado de linhas e operação idempotente. A selagem para `posted` é bloqueada no **banco** se quantidade ou soma zero falharem. Linhas e grupos selados são imutáveis; uma falha no batch reverte pagamento, grupo e direitos juntos. Saldos consideram somente grupos selados, em uma leitura coerente do ledger. `auditLedger(db)` aponta grupos abertos, legados inconsistentes e diferenças.

Os itens, valor, titular e regra do pedido tornam-se snapshots imutáveis; todos os itens devem ser criados enquanto o pedido está pendente. A implementação limita cada pedido/lançamento/solicitação a 10¹² centavos e recusa valores fora da precisão segura. Ajustes e reversões futuros devem usar novos grupos balanceados, nunca editar ou apagar linhas históricas. Ao integrar estornos, reverta a contabilidade com a regra original e revogue os direitos correspondentes na mesma transação.

## Saldo e solicitação de repasse

Créditos do fotógrafo ficam pendentes até `paid_at_ms + hold_days`. O saldo disponível soma créditos vencidos menos débitos/reservas; débitos podem produzir `negativeCents`, que bloqueia novas reservas. O saldo não é guardado em uma coluna mutável.

Antes de disponibilizar repasses, configure o secret **`PAYOUT_KEY_ENCRYPTION_KEY`** no Worker: 32 bytes aleatórios em base64. Guarde-o fora do repositório e do serviço de mídia. A chave cifra valores Pix com AES-256-GCM, vinculados ao fotógrafo/tipo, e gera um fingerprint HMAC. A alteração/rotação desse secret exige migrar os registros cifrados; não o substitua sem essa migração.

O onboarding confiável deve verificar a titularidade da chave com o PSP/DICT e só então chamar:

```ts
await registerVerifiedPixKey(env.DB, env.PAYOUT_KEY_ENCRYPTION_KEY!, photographerId, {
  type: "EVP", value: chaveConfirmadaPeloProvedor,
});
```

Essa função é um hook interno de cadastro, não uma rota pública de autoverificação. A validação local cobre CPF, CNPJ numérico/alfanumérico e dígitos verificadores, telefone E.164, e-mail e EVP; ela **não substitui** confirmação de existência/titularidade pelo PSP. O endpoint recusa cadastro não verificado/desativado e revalida a versão da chave dentro da transação. O pedido guarda um snapshot cifrado; nenhuma resposta ou log expõe a chave.

`POST /photographer/payouts` cria uma solicitação `requested` e, no mesmo batch, debita `photographer:{id}` e credita `payable:payouts:{id}`. A condição de saldo é reavaliada dentro do INSERT SQL, evitando que solicitações concorrentes reservem o mesmo saldo. Repetição da mesma Idempotency-Key/valor retorna a solicitação existente; valor diferente produz conflito. `inPayoutCents` vem da conta de reservas do ledger.

Esse endpoint **solicita e reserva**; não afirma que houve transferência. O futuro adaptador de transferência deverá liquidar ou cancelar a solicitação com grupos contábeis novos e conciliação PSP, preservando idempotência e o snapshot da chave.

## Migração e operação

1. Rode `npm ci` e `npm run check`.
2. Aplique `0003_delivery_ledger.sql` após as duas migrações da Fase 2: `npm run db:migrate:local` em desenvolvimento ou `npx wrangler d1 migrations apply fotoviva --remote` no ambiente configurado, após backup e revisão.
3. O snapshot `src/server/db/schema.sql` agora equivale às **três** migrações. Não o execute em banco já migrado.
4. Direitos/pagamentos legados sem `paid_at_ms` e proveniência de liquidação não são liberados automaticamente. Faça backfill auditado a partir do evento real e dos itens, com prazo ancorado na data original; não use a data da migração para renovar acesso.
5. Grupos legados do ledger permanecem registrados. Grupos não balanceados/valores inválidos recebem `legacy_review` e ficam fora dos saldos. Mesmo grupos balanceados antigos não ganham vencimento automático: os créditos sem `available_at_ms` exigem conciliação e migração de abertura com rastreabilidade. Não execute UPDATE nas linhas depois de ativar os triggers append-only.
6. Integre o adaptador PSP aos hooks de liquidação e verificação de Pix; configure `PAYOUT_KEY_ENCRYPTION_KEY`, sessão/JWKS e bucket privado. O Worker usa as mesmas credenciais R2 e bindings já existentes.
7. Valide com `npm run deploy:check`. Homologue autenticidade PSP, cookie/CSRF, concorrência real, volume ZIP e auditoria no ambiente Cloudflare antes de habilitar o fluxo ao público. Esta alteração não faz deploy nem transfere dinheiro.

Os testes usam migrações reais em SQLite, adaptadores locais D1/R2 e zip.js para verificar bytes e CRC. Cobrem 2.000 splits, liquidação idempotente, hold, soma zero/imutabilidade no banco, reserva concorrente, titularidade, quota, replay/expiração/revogação de tickets, pacote completo, backpressure, cancelamento e falhas de storage. Não substituem teste conectado ao PSP ou ao R2 de produção.

Referências: [F04](f01-pagamentos-busca/F04-comissoes-repasses.md), [F05](f01-pagamentos-busca/F05-entrega.md), [batch transacional D1](https://developers.cloudflare.com/d1/worker-api/d1-database/), [zip.js](https://gildas-lormeau.github.io/zip.js/api/classes/ZipWriter.html), [opções de streaming ZIP](https://gildas-lormeau.github.io/zip.js/api/interfaces/ZipWriterConstructorOptions.html), [limites Workers](https://developers.cloudflare.com/workers/platform/limits/), [API DICT](https://bcb.gov.br/content/estabilidadefinanceira/pix/API-DICT.html), [DV CNPJ alfanumérico](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf).
