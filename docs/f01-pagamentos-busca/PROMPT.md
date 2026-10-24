# DESENVOLVEDOR F01 — PAGAMENTOS E BUSCA INTELIGENTE DE FOTOGRAFIAS

## 1. MISSÃO

Você será o responsável pela implementação de dois conjuntos de funcionalidades da plataforma FotoViva:

**ÁREA A — Sistema de pagamentos, compras e comissões.**

**ÁREA B — Busca inteligente de fotografias por selfie, semelhança facial e características de roupas.**

Repositório: `pedromatosx/fotoviva`

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

# PARTE A — SISTEMA DE PAGAMENTOS

## F01 — Auditoria do fluxo de compra

Mapeie toda a jornada:

**Foto encontrada → seleção → carrinho → pedido → pagamento → confirmação → direito de download → entrega → comissão do fotógrafo.**

Identifique o que já funciona e o que ainda depende de serviços externos.

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

## 6. AUTONOMIA E METODOLOGIA GSD

Organize o desenvolvimento em fases F01 a F10.

Execute autonomamente:

**ANALISAR → IMPLEMENTAR → TESTAR → CORRIGIR → COMMITAR → DOCUMENTAR → CONTINUAR.**

Não interrompa para solicitar confirmação de pequenas alterações técnicas.

Continue pelas tarefas independentes quando houver bloqueios.

Não realize trabalho em segundo plano fora de uma sessão ativa sem uma automação configurada.

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

**COMECE PELA AUDITORIA DO QUE JÁ EXISTE E CONTINUE AUTONOMAMENTE PELAS FASES F01 A F10. NÃO REIMPLEMENTE O QUE JÁ ESTIVER CORRETO.**

Seu objetivo é preparar as funcionalidades para futura operação real, mantendo pagamentos e processamento biométrico real desativados até autorização.
