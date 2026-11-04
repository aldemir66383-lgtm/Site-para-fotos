# Desenvolvedor F01 — Pagamentos e busca inteligente

> ⚠️ **SUPERADO em 24/10/2026.** Este pacote foi escrito **sem acesso** ao código-fonte. Com o acesso liberado, a auditoria foi refeita no próprio código e várias inferências daqui se mostraram incorretas. A versão válida está no repositório privado da FotoViva, na branch `feat/payments-photo-matching`. **Não use estes documentos como referência.**

Pacote de trabalho em Markdown das fases **F01–F10** da FotoViva. Ele cobre a área A (pagamentos simulados, comissões e entrega) e a área B (busca por roupas e por selfie). O briefing original e o status de cada item estão em [PROMPT.md](PROMPT.md).

## Situação geral

| Fase | Documento | Situação |
|---|---|---|
| F01 Auditoria | [F01-auditoria.md](F01-auditoria.md) | ✅ com fontes públicas · ⚠️ falta confirmar no código privado |
| F02 Arquitetura de pagamentos | [F02-arquitetura-pagamentos.md](F02-arquitetura-pagamentos.md) | ✅ |
| F03 Pix | [F03-pix.md](F03-pix.md) | ✅ núcleo testado |
| F04 Comissões e repasses | [F04-comissoes-repasses.md](F04-comissoes-repasses.md) | ✅ núcleo testado |
| F05 Entrega | [F05-entrega.md](F05-entrega.md) | ✅ |
| F06 Selfie | [F06-busca-selfie.md](F06-busca-selfie.md) | ⛔ projetada e **bloqueada** |
| F07 Roupas | [F07-busca-roupas.md](F07-busca-roupas.md) | ✅ interpretador testado |
| F08 Mecanismo de busca | [F08-mecanismo-de-busca.md](F08-mecanismo-de-busca.md) | ✅ ADR |
| F09 Indexação | [F09-indexacao.md](F09-indexacao.md) | ✅ SQL validada |
| F10 Contratos | [F10-contratos-api.md](F10-contratos-api.md) | ✅ |

Apoio: [testes.md](testes.md) · [codigo-de-referencia.md](codigo-de-referencia.md) · [revisao-codex.md](revisao-codex.md) · [integracao-claude.md](integracao-claude.md) · [roadmap.md](roadmap.md) · [PULL_REQUEST.md](PULL_REQUEST.md)

## Bloqueio principal

O código-fonte (`pedromatosx/fotoviva`) é **privado** e a conta `aldemir66383-lgtm` não tem acesso. Por isso:

- a auditoria foi feita no deploy público (`fotoviva-pedromatosx-lab…workers.dev`) e no bundle do cliente;
- nenhum arquivo da aplicação foi alterado; nada foi reimplementado às cegas;
- o código de referência (25 testes passando) está pronto para ser adaptado quando houver acesso (ver [roadmap, etapa 0](roadmap.md#etapa-0--desbloqueio-pré-requisito-)).

## Limites respeitados

Nenhuma cobrança real, credencial financeira, gateway, conta bancária, repasse, cartão, processamento biométrico, publicação de foto privada, migração remota, API paga ou deploy. O deploy público foi apenas consultado com `GET` e continua isolado (`403` em todas as rotas de API).
