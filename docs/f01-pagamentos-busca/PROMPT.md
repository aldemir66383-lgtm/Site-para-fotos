# DESENVOLVEDOR F01 — PAGAMENTOS E BUSCA INTELIGENTE DE FOTOGRAFIAS

> **Cópia de trabalho do prompt original.** O texto recebido está preservado sem alterações no commit `ddeaae4`. Esta versão é editada a cada fase com blocos **Status** (legenda: ✅ feito · ⚠️ precisa de confirmação no código privado · 📝 especificado, falta implementar · ⛔/🔒 bloqueado).
> Índice dos entregáveis: [README.md](README.md). Última revisão: 2026-10-23.

## 1. MISSÃO

Você será o responsável pela implementação de dois conjuntos de funcionalidades da plataforma FotoViva:

**ÁREA A — Sistema de pagamentos, compras e comissões.**

**ÁREA B — Busca inteligente de fotografias por selfie, semelhança facial e características de roupas.**

Repositório: `pedromatosx/fotoviva`

> **Status:** ⚠️ o repositório é **privado** e não está acessível para `aldemir66383-lgtm`. O trabalho foi feito em `aldemir66383-lgtm/Site-para-fotos` (público), somente em Markdown, e está pronto para ser levado ao repositório privado ([roadmap, etapa 0](roadmap.md#etapa-0--desbloqueio-pré-requisito-)).

Seu trabalho deverá acontecer em paralelo ao desenvolvimento visual realizado pelo Claude e à auditoria de segurança realizada pelo Codex.

Você deverá implementar funcionalidades reais no código, porém mantendo integrações financeiras e processamento biométrico com dados reais desativados até que suas condições de segurança, privacidade, custo e autorização sejam atendidas.

## 2. ORGANIZAÇÃO DO TRABALHO

Crie uma branch própria:

`feat/payments-photo-matching`

Não trabalhe diretamente na `main`.

Não modifique indiscriminadamente arquivos de autenticação, segurança ou layout que pertençam aos outros responsáveis.

Prefira novos módulos bem definidos, com interfaces e testes próprios.

Quando precisar modificar um arquivo compartilhado, documente a alteração necessária e coordene sua integração.

Não faça merge sem revisão de segurança.

> **Status:** ✅ a branch `feat/payments-photo-matching` foi criada no GitHub a partir da `main`. Nenhum arquivo de autenticação, segurança ou layout foi alterado. Merge só depois do Codex.

## 3. PRIMEIRA ETAPA — INSPEÇÃO

Antes de criar funcionalidades:

1. Leia a estrutura do projeto.
2. Consulte os arquivos GSD.
3. Identifique as implementações existentes de carrinho, pedidos, Pix simulado, comissões e downloads.
4. Analise como álbuns e fotografias são armazenados.
5. Identifique APIs e contratos existentes.
6. Consulte os bloqueios de lançamento.
7. Defina como integrar suas funcionalidades sem duplicar componentes.
8. Produza uma arquitetura modular e um roadmap de execução.

A FotoViva já possui funcionalidades financeiras simuladas. Aproveite o código existente quando for tecnicamente adequado.

Não confunda simulações locais com pagamentos reais.

> **Status:** ✅ itens 3, 5, 7 e 8 feitos com fontes públicas (deploy + bundle) → [F01](F01-auditoria.md), [F02](F02-arquitetura-pagamentos.md), [roadmap](roadmap.md). ⚠️ itens 1, 2, 4 e 6 (estrutura, GSD, armazenamento, bloqueios de lançamento) dependem do código privado; o que foi possível inferir está em [F01 §5](F01-auditoria.md#5-armazenamento-de-álbuns-e-fotografias-inferido).

# PARTE A — SISTEMA DE PAGAMENTOS

## F01 — Auditoria do fluxo de compra

Mapeie toda a jornada:

**Foto encontrada → seleção → carrinho → pedido → pagamento → confirmação → direito de download → entrega → comissão do fotógrafo.**

Identifique o que já funciona e o que ainda depende de serviços externos.

> **Status:** ✅ [F01-auditoria.md](F01-auditoria.md): jornada em 16 etapas. Já existem carrinho, pedido idempotente, Pix de laboratório, ledger com conciliação, tickets de 60 s e recuperação de convidado. Ausentes: saldo e repasse. Dependem de terceiros: Pix real, e-mail.

## F02 — Arquitetura de pagamentos

Projete uma arquitetura com módulos independentes para:

- Carrinho.
- Pedidos.
- Preços.
- Provedor de pagamentos.
- Webhooks.
- Confirmação de pagamento.
- Reembolsos.
- Comissões.
- Repasses.
- Conciliação financeira.
- Direitos de download.

Implemente uma camada de abstração para provedores de pagamento.

Não acople toda a aplicação a uma API específica.

Prepare a substituição entre simulador, sandbox oficial e provedor autorizado.

> **Status:** ✅ [F02](F02-arquitetura-pagamentos.md): 12 módulos, porta `PaymentProvider` e fábrica sem adaptador *live* (a ausência de código é o controle).

## F03 — Pix

Implemente e teste:

- Criação simulada de cobrança.
- Identificadores únicos.
- Controle de validade.
- Estados da cobrança.
- Confirmação por webhook simulado.
- Verificação de assinatura.
- Prevenção de eventos duplicados.
- Atualização segura do pedido.
- Consulta de status.
- Tratamento de expiração e falhas.

Todo preço deve ser calculado no backend.

Não aceite valores finais enviados pelo navegador como autoridade.

**Não utilize credenciais financeiras reais nesta fase.**

> **Status:** ✅ [F03](F03-pix.md) especificado. ✅ assinatura, deduplicação, confirmação atômica, expiração, valor divergente e concorrência **testados** no [código de referência](codigo-de-referencia.md). ⚠️ falta aplicar ao handler `pix-lab` existente. Nenhuma credencial real foi usada.

## F04 — Comissões e repasses

Projete regras configuráveis para:

- Comissão da plataforma.
- Valor destinado ao fotógrafo.
- Taxas do provedor.
- Estornos.
- Ajustes.
- Saldo a receber.
- Registro de eventos.
- Histórico financeiro.

Utilize valores monetários em centavos inteiros ou representação decimal adequada.

Implemente registros auditáveis e operações idempotentes.

Comissões e repasses serão inicialmente fictícios.

Nenhum saque ou transferência real deverá ser realizado.

> **Status:** ✅ [F04](F04-comissoes-repasses.md): regras versionadas, centavos e *basis points*, partidas dobradas e ledger somente-inserção; invariante testada em 2.000 pedidos. Repasse só `simulated`, sem código de transferência.

## F05 — Entrega após pagamento

O sistema deverá considerar uma fotografia comprada somente após confirmação válida do pagamento.

Implemente os controles necessários para:

- Registrar direitos de download.
- Evitar acesso por compradores não autorizados.
- Impedir manipulação de pedidos.
- Limitar reutilização indevida de tickets.
- Revogar ou ajustar direitos quando necessário.
- Registrar entregas e falhas.

A geração e entrega de imagens privadas deve seguir os requisitos definidos pelo Codex.

> **Status:** ✅ [F05](F05-entrega.md): direitos explícitos, tickets com hash e uso único, limites, revogação e log. Perguntas ao Codex em F05 §6.

# PARTE B — BUSCA INTELIGENTE DE FOTOGRAFIAS

## F06 — Sistema de busca por selfie

O objetivo é permitir que o comprador envie uma selfie para localizar possíveis fotografias suas em eventos autorizados.

Projete o seguinte fluxo:

1. O usuário acessa a galeria de um evento.
2. Escolhe a opção de busca por selfie.
3. Recebe informações claras sobre o processamento e o uso da imagem.
4. Autoriza a finalidade específica quando aplicável.
5. Envia uma imagem para análise.
6. O sistema procura correspondências somente nas fotografias autorizadas do evento.
7. Apresenta possíveis resultados com nível de confiança apropriado.
8. O usuário verifica visualmente os resultados.
9. A imagem temporária e os dados derivados são eliminados conforme a política de retenção.

Não apresente uma correspondência como identidade pessoal comprovada.

### Requisitos importantes

- Nunca realizar identificação pública de pessoas.
- Não montar banco biométrico geral de visitantes.
- Não pesquisar rostos entre eventos ou usuários sem autorização adequada.
- Não utilizar fotografias para treinamento externo sem autorização específica.
- Não armazenar embeddings biométricos permanentemente sem necessidade, base legal e controles aprovados.
- Não usar reconhecimento facial de menores sem análise jurídica e salvaguardas específicas.
- Preparar funcionalidades com feature flag desativada enquanto a avaliação de privacidade estiver pendente.

O reconhecimento facial deverá permanecer desativado para dados reais até aprovação da arquitetura, requisitos legais e revisão do Codex.

> **Status:** ⛔ [F06](F06-busca-selfie.md): fluxo e arquitetura projetados; flag `FV_FACE_SEARCH` só aceita `off` ou `synthetic`. O bloqueio principal é a base legal para os **terceiros** nas fotos (LGPD, art. 11), além de menores (art. 14) e RIPD (art. 38).

## F07 — Busca por roupas e características visuais

Além da selfie, implemente uma busca que permita ao usuário descrever ou selecionar características visuais da fotografia.

Exemplos:

- Blusa azul.
- Camisa vermelha.
- Uniforme branco.
- Camisa com número.
- Roupa preta.
- Mochila.
- Boné.
- Combinação de cores.
- Peças de roupa semelhantes às de uma imagem enviada.

A finalidade é ajudar a localizar fotografias em eventos, sem necessariamente identificar uma pessoa pelo rosto.

### Funcionamento esperado

1. O usuário informa as características da roupa ou envia uma imagem de referência.
2. O sistema interpreta as características visuais.
3. Pesquisa apenas fotografias do evento autorizado.
4. Classifica possíveis correspondências.
5. Exibe resultados em ordem de relevância.
6. Permite combinar filtros por evento, data, categoria e características.

Priorize busca por características de vestuário como alternativa que não exija reconhecimento biométrico.

Não transforme informações visuais em perfis pessoais persistentes sem necessidade.

> **Status:** ✅ [F07](F07-busca-roupas.md): todos os exemplos do briefing são interpretados (testado); cores por região da **mesma pessoa**; imagem de referência processada no navegador. 📝 classificador de cor e índice dependem do código.

## F08 — Arquitetura do mecanismo de busca

Analise possíveis abordagens:

- Filtros estruturados.
- Classificação de cores.
- Detecção de peças de roupa.
- Extração de características visuais.
- Similaridade entre imagens.
- Modelos de visão computacional.
- Vetores de características.
- Reconhecimento facial opcional e sujeito a aprovação.

Escolha inicialmente a solução que ofereça melhor equilíbrio entre:

**Qualidade dos resultados + privacidade + custo + desempenho + facilidade de manutenção.**

Não contrate APIs de IA pagas.

Não envie fotografias privadas para provedores externos sem autorização.

Prepare testes com imagens sintéticas e de uso permitido.

> **Status:** ✅ [F08](F08-mecanismo-de-busca.md): ADR em três fases (B1 cores sem custo, B2 CLIP sem a cabeça, B3 rosto bloqueado). Nenhuma API paga; testes com cenas sintéticas e verdade de referência.

## F09 — Indexação e busca em álbuns

Projete como as fotografias serão processadas e pesquisadas.

Verifique:

- Associação ao álbum correto.
- Associação ao fotógrafo correto.
- Criação de índices.
- Atualização após exclusões.
- Restrições de visibilidade.
- Ordenação por relevância.
- Tempo de resposta.
- Prevenção de buscas não autorizadas.
- Limites de requisições.
- Eliminação segura de dados temporários.

O sistema não poderá retornar fotos privadas simplesmente porque suas características coincidem com a consulta.

A autorização de acesso deve ser aplicada antes da entrega dos resultados.

> **Status:** ✅ [F09](F09-indexacao.md): visibilidade única com a galeria via `JOIN`; SQL validada (exclui fotos privadas e de outros álbuns e exige a mesma pessoa); limites de requisição e eliminação de temporários.

## F10 — Interface de integração

Como o Claude será responsável pelo design, você deverá entregar contratos e componentes funcionais mínimos, sem impor alterações visuais extensas.

Defina interfaces para:

- Enviar imagem de referência.
- Consultar status da busca.
- Receber resultados.
- Exibir níveis de confiança.
- Cancelar processamento.
- Excluir dados temporários.
- Criar pedido.
- Consultar pagamento simulado.
- Receber direitos de download.

Documente os contratos para que o Claude possa implementar as telas sem precisar modificar a lógica do servidor.

> **Status:** ✅ [F10](F10-contratos-api.md): os 9 contratos pedidos + códigos de erro + hooks mínimos sem estilo. Requisitos de tela em [integracao-claude.md](integracao-claude.md).

## 4. TESTES OBRIGATÓRIOS

### Pagamentos

Teste:

- Valores incorretos.
- Preços manipulados.
- Eventos repetidos.
- Webhooks inválidos.
- Assinaturas incorretas.
- Pagamentos expirados.
- Pedidos de outros compradores.
- Tentativas duplicadas.
- Reembolsos.
- Concorrência.
- Falhas de comunicação.
- Entrega sem pagamento.

### Busca inteligente

Teste:

- Imagem inválida.
- Arquivo excessivamente grande.
- Imagem sem pessoa.
- Imagem com múltiplas pessoas.
- Roupas semelhantes.
- Iluminação diferente.
- Cores semelhantes.
- Falsas correspondências.
- Resultados sem correspondência.
- Busca fora do álbum autorizado.
- Tentativa de acesso a fotos privadas.
- Cancelamento.
- Exclusão de imagens temporárias.

Utilize exclusivamente dados sintéticos ou imagens cuja utilização esteja autorizada.

Os testes devem incluir casos negativos.

> **Status:** ✅ [testes.md](testes.md): todos os cenários listados viraram casos (PAG-01…12, BUS-00…17); 25 executados e passando, os demais 📝 dependem das rotas reais.

## 5. COLABORAÇÃO COM CODEX

O Codex é responsável pela segurança transversal do projeto.

Antes da integração final, entregue a ele:

- Contratos das APIs.
- Modelo de dados.
- Modelo de autorização.
- Estratégia de proteção de fotografias.
- Fluxo financeiro.
- Fluxo de exclusão de dados.
- Requisitos de consentimento.
- Dependências externas.
- Limitações conhecidas.

Corrija os problemas identificados durante a revisão de segurança.

Nenhuma aprovação visual ou teste financeiro simulado substitui a revisão de segurança.

> **Status:** ✅ pacote pronto em [revisao-codex.md](revisao-codex.md). ⏳ revisão ainda não feita.

## 6. AUTONOMIA E METODOLOGIA GSD

Organize o desenvolvimento em fases F01 a F10.

Execute autonomamente:

**ANALISAR → IMPLEMENTAR → TESTAR → CORRIGIR → COMMITAR → DOCUMENTAR → CONTINUAR.**

Não interrompa para solicitar confirmação de pequenas alterações técnicas.

Continue pelas tarefas independentes quando houver bloqueios.

Não realize trabalho em segundo plano fora de uma sessão ativa sem uma automação configurada.

> **Status:** ✅ trabalho em commits por fase na branch; nada ficou rodando em segundo plano.

## 7. LIMITES OBRIGATÓRIOS

Não realize:

- Cobranças reais.
- Contratação de gateways.
- Cadastro de contas financeiras.
- Repasses reais.
- Uso de cartões verdadeiros.
- Processamento biométrico de pessoas reais sem autorização apropriada.
- Publicação de fotografias privadas.
- Migrações remotas.
- Contratação de APIs pagas.
- Deploy comercial sem autorização.

A versão pública atual da FotoViva deverá continuar isolada dos recursos financeiros e biométricos.

> **Status:** ✅ todos os limites respeitados. O deploy público foi só consultado com `GET` e continua respondendo `403` em todas as rotas de API.

## 8. ENTREGA FINAL

Crie uma Pull Request com:

- Funcionalidades implementadas.
- Testes executados.
- Resultados das simulações.
- Documentação das APIs.
- Fluxos de pagamento.
- Arquitetura de reconhecimento facial.
- Busca por roupas.
- Recursos ainda bloqueados.
- Requisitos de integração com Claude.
- Requisitos de revisão com Codex.

> **Status:** ✅ texto da PR pronto em [PULL_REQUEST.md](PULL_REQUEST.md). ⚠️ a PR final é no repositório privado, que depende de acesso.

**COMECE PELA AUDITORIA DO QUE JÁ EXISTE E CONTINUE AUTONOMAMENTE PELAS FASES F01 A F10. NÃO REIMPLEMENTE O QUE JÁ ESTIVER CORRETO.**

Seu objetivo é preparar as funcionalidades para futura operação real, mantendo pagamentos e processamento biométrico real desativados até autorização.
