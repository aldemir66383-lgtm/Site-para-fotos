# Pacote para revisão de segurança (Codex)

> Nenhuma integração com a `main` acontece sem esta revisão. Aprovação visual ou teste financeiro simulado **não substituem** a revisão de segurança.

## 1. Itens que o briefing pede

| Item | Onde está |
|---|---|
| Contratos das APIs | [F10-contratos-api.md](F10-contratos-api.md) |
| Modelo de dados | [F02 §5](F02-arquitetura-pagamentos.md#5-modelo-de-dados-proposto), [F05 §2](F05-entrega.md#2-modelo), [F09 §1](F09-indexacao.md#1-modelo-de-dados), DDL testado em [codigo-de-referencia.md §4](codigo-de-referencia.md#4-confirmação-atômica-e-estorno-d1) |
| Modelo de autorização | §2 abaixo |
| Proteção das fotografias | §3 abaixo · [F05](F05-entrega.md) · [F09 §3](F09-indexacao.md#3-autorização-e-visibilidade-antes-de-entregar-resultados) |
| Fluxo financeiro | [F03](F03-pix.md) · [F04](F04-comissoes-repasses.md) |
| Fluxo de exclusão de dados | [F06 §5](F06-busca-selfie.md#5-retenção-e-eliminação) · [F09 §6](F09-indexacao.md#6-eliminação-de-dados-temporários) |
| Requisitos de consentimento | [F06 §3 e §7](F06-busca-selfie.md) |
| Dependências externas | §4 abaixo |
| Limitações conhecidas | §5 abaixo |

## 2. Modelo de autorização

| Ator | Pode | Não pode |
|---|---|---|
| Visitante ou convidado (cookie anônimo) | Navegar em álbuns visíveis, montar carrinho, criar pedido simulado, ver **os próprios** pedidos e direitos, buscar por roupas em álbum visível | Ver pedidos, sessões ou direitos de outra pessoa (404); usar selfie (bloqueada) |
| Comprador autenticado | O mesmo, com o histórico ligado à conta | Idem |
| Fotógrafo (papel concedido pelo responsável) | Enviar atributos de busca das **próprias** fotos; ver o **próprio** saldo fictício | Atributos ou saldo de outro fotógrafo; alterar preço de pedido já criado |
| `finance_admin` (laboratório) | Estorno simulado, ajuste, repasse simulado, conciliação | Transferir dinheiro (não existe código para isso) |
| Moderação | Ocultar álbum, o que dispara revogação e remoção do índice | — |
| Provedor de pagamento | `POST` assinado no webhook | Qualquer outra rota |

Regra transversal: `FV_LAB` desligado → `403` em commerce, busca e laboratório (padrão atual, verificado no deploy público).

## 3. Proteção das fotografias

1. O original fica no R2 privado e só é servido **através do Worker**, depois de consumir o ticket. Não há URL pré-assinada.
2. A busca devolve **somente** `/previews/:id` (com marca-d'água) e aplica a mesma regra de visibilidade da galeria via `JOIN`.
3. A imagem de referência é processada no navegador (B1) ou em memória. A selfie nunca é persistida.
4. Os índices vetorial e facial são por álbum, ficam no R2 privado e o facial é cifrado com chave própria (destruição de chave).
5. Os logs não contêm imagem, vetor, consulta, token nem IP puro.

## 4. Dependências externas

| Dependência | Situação | Observação |
|---|---|---|
| Cloudflare Workers, D1, R2, Cron Triggers | Já usados | Nenhum produto pago novo na fase B1 |
| Rate Limiting binding | Opcional | Alternativa: contador em D1 |
| PSP / API Pix | 🔒 | Contrato, credenciais, mTLS (domínio próprio) |
| Provedor de e-mail | 🔒 | O recibo hoje é só uma prévia |
| onnxruntime-web / modelo detector (B1) | A escolher | Verificar licença: evitar AGPL (ex.: Ultralytics YOLO) e pesos não comerciais |
| Processador auto-hospedado (B2/B3) | 🔒 | Custo de infraestrutura |
| Vectorize | Não proposto | Seria um produto a mais para aprovar |

## 5. Limitações conhecidas

- O código-fonte privado **não foi lido**. A auditoria vem do bundle público, e as rotas marcadas como [existente] podem ter detalhes diferentes.
- Os testes executados cobrem as **regras centrais** em SQLite/Node, não as rotas HTTP reais no `wrangler dev`.
- O D1 não tem transação interativa. A consistência depende de batch com condições, chaves únicas e conciliação; uma falha entre ler e gravar é coberta pelos guardas, mas precisa de teste no Miniflare.
- O Time Travel do D1 mantém a restauração a um ponto no tempo. Linhas apagadas podem voltar numa restauração, por isso a destruição de chave é usada para os dados biométricos.
- A busca por cor erra com cores próximas e uniformes iguais; o tipo de peça só é distinguido na B2.
- **Este repositório (`aldemir66383-lgtm/Site-para-fotos`) é público.** Como ele contém o modelo de ameaças, considere torná-lo privado.

## 6. Perguntas abertas

1. Remover EXIF (GPS, número de série) dos originais antes da entrega? ([F05 §6](F05-entrega.md#6-perguntas-para-o-codex))
2. Marca invisível por comprador?
3. Separar os buckets de prévias e originais?
4. Como rotacionar a chave mestra depois da destruição de chaves por álbum (F06 §5)?
5. Os limites de requisição (F09 §5) e de tentativas de recuperação (F05 §5) são suficientes?
6. A validação dos atributos enviados pelo navegador do fotógrafo (F08 §2) é suficiente?
