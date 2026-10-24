# feat/payments-photo-matching: pagamentos (simulados) e busca inteligente, fases F01–F10

> Texto da PR (seção 8 do briefing). A PR **não deve ser integrada** sem a revisão de segurança do Codex.

## Resumo

Este pacote entrega a auditoria e a arquitetura das áreas A (pagamentos, comissões e entrega) e B (busca por roupas e por selfie), além de código de referência **testado** para o núcleo das regras financeiras e da interpretação de consultas.

O repositório da aplicação (`pedromatosx/fotoviva`) é privado e não estava acessível. Por isso a auditoria usou o deploy público e o bundle do cliente, e **nenhum arquivo da aplicação foi alterado**. Pagamentos reais e biometria continuam desativados.

## Funcionalidades entregues

| Item | Tipo | Situação |
|---|---|---|
| Auditoria da jornada de compra e da busca | Documento | ✅ (fontes públicas) |
| Arquitetura modular + porta `PaymentProvider` | Documento + interface TS | ✅ |
| Pix simulado: estados, `txid`, validade, webhook assinado, deduplicação, confirmação atômica | Especificação + código de referência | ✅ testado |
| Comissões versionadas, partidas dobradas, estornos, saldo e repasse fictício | Especificação + código de referência | ✅ testado (estorno total) |
| Direitos de download, tickets, revogação e log | Especificação | ✅ (concessão e revogação testadas) |
| Busca por roupas (pt-BR, cores por pessoa, ranking na mesma pessoa) | Especificação + interpretador + SQL | ✅ interpretador e SQL testados |
| Busca por selfie | Arquitetura + contrato | ⛔ bloqueada (flag sem valor `on`) |
| Contratos de API para o Claude | Documento | ✅ |

## Testes executados

`node --test` (Node v24.19.0, `node:sqlite`/SQLite 3.53): **25 de 25 passando**. Os detalhes estão em [testes.md](testes.md). Cobrem PAG-01, 03, 04, 05, 06, 08, 09 e 10, PAG-12 em parte, as invariantes contábeis (2.000 pedidos aleatórios), o ledger somente-inserção e o interpretador BUS-00. A SQL da busca B1 também foi validada: exige a mesma pessoa e exclui fotos privadas e de outros álbuns.

Os testes de rota HTTP (Miniflare / `wrangler dev`) estão especificados e **ainda não foram executados**, porque dependem do código-fonte.

## Resultados das simulações

- Evento válido → pedido `paid`, 4 lançamentos somando 0, 3 direitos ativos.
- O mesmo evento repetido, um segundo pagamento, valor divergente, pagamento depois da validade e `txid` desconhecido → nenhum efeito colateral, com `outcome` explicativo.
- Corrida entre duas conexões → uma confirmação `applied` e a outra `already_paid`.
- Estorno total → lançamentos anulados, saldo do fotógrafo 0, direitos revogados; repetir não tem efeito.
- Os testes encontraram 2 bugs no código de referência, que foram corrigidos (`NULL` em comparação; plurais de peças).

## Documentação

- APIs: [F10-contratos-api.md](F10-contratos-api.md)
- Fluxos de pagamento: [F02](F02-arquitetura-pagamentos.md) · [F03](F03-pix.md) · [F04](F04-comissoes-repasses.md) · [F05](F05-entrega.md)
- Arquitetura de reconhecimento facial: [F06](F06-busca-selfie.md)
- Busca por roupas: [F07](F07-busca-roupas.md) · [F08](F08-mecanismo-de-busca.md) · [F09](F09-indexacao.md)

## Recursos ainda bloqueados

Pix sandbox e real · e-mail · repasses reais · busca B2 (processador) · selfie B3 (RIPD, parecer jurídico, Codex) · deploy comercial. Ver [roadmap.md, etapa 4](roadmap.md#etapa-4--bloqueado-exige-autorização-formal).

## Integração com o Claude

[integracao-claude.md](integracao-claude.md): telas afetadas, estados, textos e regras que vêm do servidor. O pacote não altera layout.

## Revisão do Codex

[revisao-codex.md](revisao-codex.md): autorização, proteção das fotos, exclusão de dados, dependências, limitações e perguntas abertas.

## Checklist antes do merge

- [ ] Acesso ao repositório privado e auditoria F01 confirmada no código
- [ ] Etapas 1 e 2 do roadmap implementadas com migrações **locais**
- [ ] Testes HTTP 📝 executados e passando
- [ ] Aprovação do Codex
- [ ] Versão pública continua respondendo 403 nas rotas de commerce e busca

🤖 Generated with [Claude Code](https://claude.com/claude-code)
