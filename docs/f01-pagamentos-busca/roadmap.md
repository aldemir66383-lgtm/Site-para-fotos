# Roadmap de execução

> O ciclo GSD de cada etapa: **ANALISAR → IMPLEMENTAR → TESTAR → CORRIGIR → COMMITAR → DOCUMENTAR → CONTINUAR**.
> 🔑 = precisa de acesso ao código-fonte privado `pedromatosx/fotoviva`.

## Etapa 0 — Desbloqueio (pré-requisito) 🔑

- [ ] O responsável pelo repositório adiciona `aldemir66383-lgtm` como colaborador de `pedromatosx/fotoviva`, ou fornece um clone local.
- [ ] Criar `feat/payments-photo-matching` **no repositório privado** a partir da `main` dele e trazer a pasta `docs/f01-pagamentos-busca/`.
- [ ] Executar o checklist de [F01 §8](F01-auditoria.md#8-checklist-para-quando-houver-acesso-ao-código) e atualizar as tabelas ⚠️.

## Etapa 1 — Endurecer o que existe (área A) 🔑

| # | Tarefa | Base | Testes | Saída |
|---|---|---|---|---|
| 1.1 | Assinatura HMAC, limite de 16 KB e tolerância de 300 s no `pix-lab/webhook` | [ref §1](codigo-de-referencia.md#1-assinatura-do-webhook) | PAG-04, PAG-05 | Handler atualizado |
| 1.2 | Caixa de entrada `payment_events` + batch de confirmação com condições | [ref §4](codigo-de-referencia.md#4-confirmação-atômica-e-estorno-d1) | PAG-03, 06, 08, 10 | Migração **local** + handler |
| 1.3 | Porta `PaymentProvider` envolvendo o pix-lab atual | F02 §3 | Testes de contrato | `LabPixProvider` |
| 1.4 | Regras de comissão versionadas + `expense:provider_fee` no ledger existente | [ref §2](codigo-de-referencia.md#2-dinheiro-e-comissão), F04 | Propriedade + F04 | Conciliação com as novas invariantes |
| 1.5 | `download_entitlements` explícito + revogação + `delivery_log` + limites de ticket | F05 | PAG-07, 12 | — |
| 1.6 | Estorno parcial, saldo e repasse **fictício** | F04 §4–§7 | PAG-09 | Rotas `finance-lab/*` |
| 1.7 | Campo `payment` em `GET /orders/:id` | F10 §3.3 | Contrato | — |

## Etapa 2 — Busca por roupas B1 (área B) 🔑

| # | Tarefa | Testes |
|---|---|---|
| 2.1 | View/função única `visible_photos`, compartilhada com a galeria | BUS-10, 11 |
| 2.2 | Tabelas `photo_search_index` e `person_attributes`; remoção no batch de exclusão ou ocultação | BUS-17 |
| 2.3 | `PUT /studio/photos/:id/search-features` com validação | BUS-17 |
| 2.4 | Gerador de cenas sintéticas + classificador de cor (CIELAB) | BUS-05, 06, 07 |
| 2.5 | Detector de pessoas no navegador do fotógrafo (licença verificada) | Conjunto consentido |
| 2.6 | `search/capabilities`, `search/clothing` e interpretador | BUS-00, 08, 09, 14, 15 |
| 2.7 | Imagem de referência processada no navegador do comprador | BUS-01 a 04 |
| 2.8 | Sessões, cancelamento e exclusão com cron | BUS-12, 13 |

## Etapa 3 — Revisão e entrega

- [ ] Entregar ao Codex o [pacote de revisão](revisao-codex.md) e corrigir o que ele apontar.
- [ ] Entregar ao Claude os [requisitos de integração](integracao-claude.md).
- [ ] Abrir a PR no repositório privado com o texto de [PULL_REQUEST.md](PULL_REQUEST.md), atualizado.
- [ ] **Não fazer merge** sem a aprovação do Codex.

## Etapa 4 — Bloqueado (exige autorização formal)

| Item | Condição |
|---|---|
| Pix sandbox | PSP escolhido + credenciais de teste + revisão do Codex |
| Pix real, repasses reais, e-mail | Contrato, conta, mTLS, autorização comercial |
| Busca B2 (CLIP) | Processador auto-hospedado aprovado **ou** desempenho aceitável no navegador |
| Selfie B3 | Critérios de [F06 §7](F06-busca-selfie.md#7-critérios-para-desbloquear) |
| Deploy comercial | Autorização explícita |
