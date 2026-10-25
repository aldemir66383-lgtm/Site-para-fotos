# Aire Photos — Busca por selfie, WhatsApp e manutenção

A marca pública é **Aire Photos**, conforme a [página informada](https://fotoviva-pedromatosx-lab.pedromatos2050.workers.dev/). Rotas `/api/fotoviva`, bindings, buckets e dados existentes mantêm seus nomes para compatibilidade. A marca d'água nova, nomes de anexos e descrição do pedido no PSP usam Aire Photos; as prévias antigas precisam ser regeneradas para mudar a marca gravada nos pixels.

## Busca por selfie

`POST /api/fotoviva/search/sessions` exige a sessão JWT existente e multipart com:

| Campo | Valor |
|---|---|
| `albumId` | ID do álbum |
| `mode` | `selfie` |
| `image` | JPEG, PNG ou WebP até 8 MiB |
| `consent` | JSON abaixo |

```json
{"policyVersion":"aire-face-v1","accepted":true,"adult":true,"ownImage":true}
```

A interface precisa explicar a finalidade biométrica, o processamento temporário da selfie, o processador utilizado e a pesquisa restrita ao álbum. A aceitação deve ser específica, destacada e não pré-marcada. `ownImage` declara que a imagem é do próprio solicitante. O backend rejeita consentimento incompleto/desatualizado, álbuns privados, não habilitados ou que possam conter menores, selfies sem rosto/com mais de um rosto e baixa qualidade.

O modelo `@cf/baai/bge-base-en-v1.5` gera **embeddings de texto**, não embeddings faciais. Esta implementação usa a alternativa solicitada: um endpoint HTTPS de reconhecimento facial, isolado e controlado pela operação. Não substitua esse endpoint por um modelo textual, embeddings de descrições ou vetores aleatórios.

Contrato do processador: `POST FACE_EMBEDDINGS_URL`, bytes da imagem, `Content-Type` original e `Authorization: Bearer FACE_EMBEDDINGS_TOKEN`. Ele deve decodificar a imagem com limites de pixels, detectar/alinha faces, avaliar qualidade, gerar vetores com um modelo facial apropriado/licenciado e responder:

```json
{
  "modelVersion": "versao-real-do-modelo-facial",
  "faces": [{ "quality": 0.95, "vector": [0.01, 0.02] }]
}
```

O vetor de exemplo está abreviado: cada vetor deve ter exatamente `FACE_EMBEDDING_DIMENSIONS` componentes finitos (64–2048). A versão deve coincidir com `FACE_MODEL_VERSION`; selfie e catálogo usam o mesmo modelo. Retorne `faces: []` quando não detectar rosto, múltiplos elementos para vários rostos ou `422` para imagem inválida. O endpoint deve operar em RAM, sem logs de payload, armazenamento, treinamento ou retenção das imagens/vetores. O Worker não consegue impor sozinho a política de retenção de outro serviço; use infraestrutura e contrato de processamento compatíveis.

`FACE_MEDIUM_THRESHOLD` e `FACE_HIGH_THRESHOLD` são obrigatórios, entre 0 e 1, com alta > média. Calibre-os com o modelo e um conjunto de avaliação consentido; o código não inventa equivalência entre cosseno e probabilidade de identidade. As classes são `alta` e `media`; abaixo do limiar médio não aparece. O Worker normaliza os vetores, calcula similaridade cosseno, mantém a melhor face por foto e retorna até 50 fotos ordenadas, sem pontuação crua, nome ou identidade:

```json
{
  "id": "uuid-da-sessao",
  "mode": "selfie",
  "status": "done",
  "expiresAt": "2026-10-25T18:30:00.000Z",
  "disclaimer": "Possíveis correspondências — confira se é você.",
  "results": [{"photoId":"uuid-da-foto","relevance":"alta","albumId":"album-1","previewUrl":"/api/fotoviva/previews/uuid-da-foto","width":1600,"height":1067}]
}
```

A implementação é síncrona por requisição: não há selfie ou vetor numa fila. `GET /search/sessions/:id` recupera somente resultados do titular por até 30 minutos, revalidando visibilidade. `DELETE` remove a sessão e registra revogação do consentimento. O recibo de consentimento permanece apenas pelo prazo de auditoria configurado; não contém imagem, vetor, IP puro nem identidade em texto aberto.

### Orçamento de CPU

A varredura síncrona pode decifrar e comparar até **30.000 vetores por requisição**. Essa carga não cabe nos **10 ms de CPU do Workers Free**; a operação da busca exige **Workers Paid**, com `limits.cpu_ms` adequado no ambiente de implantação. A Cloudflare permite configurar esse limite no plano pago; veja os [limites oficiais de CPU](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

`FACE_MAX_SCANNED_VECTORS` controla o teto: inteiro entre **1 e 30000**, padrão **30000** quando ausente. Valores fora da faixa ou não inteiros resultam em 503 `face_not_configured`; ultrapassar o teto durante a busca resulta em 503 `face_index_limit`, sem devolver ou persistir resultados parciais. Reduzir o teto limita a carga, mas não torna esta implementação compatível com o Free.

Ao preparar um ambiente Paid autorizado, configure, por exemplo, `"limits": { "cpu_ms": 30000 }` no bloco desse ambiente e valide o orçamento com medições de CPU no volume e nas dimensões reais do índice antes de ligar a flag. Esse exemplo corresponde a 30 segundos de CPU, não a uma medição de desempenho desta aplicação. A arquitetura síncrona permanece a mesma.

### Consentimento e índice do álbum

`face_search_consents` registra versão/finalidade, data, HMAC do sujeito e HMAC diário do IP confiável `CF-Connecting-IP`, com segredo do Worker. Não confie em `X-Forwarded-For` enviado pelo cliente. Mantenha o endpoint atrás do Cloudflare; o cabeçalho precisa vir da infraestrutura confiável. Limites: cinco buscas/hora e vinte/dia por sujeito, além de limites por IP pseudonimizado. Os IP-hashes mudam por dia UTC; o limite diário por IP acompanha esse dia.

Os bytes conhecidos da selfie e os arrays de vetores são sobrescritos no `finally`, inclusive em falhas; não são escritos no D1, R2 ou logs. JavaScript, parsers e buffers internos de rede podem manter cópias até o garbage collector: isso é descarte de referências/zeragem dos buffers controlados, não uma garantia de apagamento físico instantâneo de toda a RAM.

O **consentimento da selfie não autoriza automaticamente a criação de templates das outras pessoas nas fotos**. Por isso álbuns legados não são habilitados automaticamente. O cadastro confiável da operação deve preencher, com base na documentação dos participantes e nas regras aplicáveis:

```sql
UPDATE albums SET
  face_search_enabled=1,
  may_include_minors=0,
  face_legal_basis_reference='referencia-ao-registro-da-base-legal-do-evento',
  face_index_expires_at_ms=/* fim real da janela de vendas em epoch ms */
WHERE id='album-autorizado';
```

Esse SQL é uma orientação de integração, não uma autorização jurídica. O recibo/hash sozinho não certifica conformidade com a LGPD. A operação deve definir base legal dos participantes, transparência, retenção, atendimento a direitos e avaliação de riscos. Nenhuma inferência identifica civilmente uma pessoa; os resultados são possíveis correspondências em fotos já disponíveis no álbum.

Fotos novas são indexadas após a geração/aprovação da prévia. Para catálogo existente, o fotógrafo proprietário pode chamar `POST /api/fotoviva/studio/photos/:photoId/face-index`, sem vetores no corpo. O Worker lê o original privado, solicita os embeddings faciais e cifra os templates com AES-256-GCM, com contexto de álbum/foto/modelo/face. O índice do álbum contém somente ciphertext; os vetores claros são temporários. Expira no menor prazo entre a janela do álbum e 30 dias. Busca paginada em blocos de 100, limitada por `FACE_MAX_SCANNED_VECTORS` por requisição (padrão de 30 mil faces).

Ocultar, mover ou trocar o original de uma foto invalida sua indexação; desabilitar/alterar a configuração facial do álbum apaga o índice correspondente. O cron também apaga índices expirados e tenta até três indexações de fotos pendentes; modelo novo ou renovação de índice válido reinicia o ciclo. A busca revalida o álbum/foto mesmo que haja linhas antigas no índice.

Os templates cifrados do catálogo permanecem pelo prazo do índice, ao contrário dos vetores da selfie. A chave de cifragem é um secret da operação; backup/Time Travel pode conter ciphertext e recibos antigos. DELETE não equivale a destruição criptográfica de todas as cópias; a política operacional de backups/chaves deve tratar esse ponto. Não troque o secret de cifragem sem invalidar/reindexar os templates existentes. Rotacionar o segredo dos hashes também exige planejar o acesso às sessões/recibos ainda retidos.

## WhatsApp após a liquidação

O checkout exige sessão autenticada (`buyer` ou `photographer`), vincula o pedido a `session.id` e aceita telefone E.164 e opt-in específico:

```json
{
  "albumId":"album-1",
  "photoIds":["foto-1"],
  "buyer":{
    "phone":"+5585999999999",
    "whatsappConsent":{"accepted":true,"policyVersion":"aire-whatsapp-v1"}
  }
}
```

Telefone informado somente para cobrança não ativa envio. Alternativamente, o titular autenticado pode cadastrar antes do pagamento em `PUT /api/fotoviva/orders/:id/whatsapp-contact`:

```json
{"enabled":true,"phone":"+5585999999999","policyVersion":"aire-whatsapp-v1"}
```

O mesmo endpoint com `{"enabled":false}` retira o consentimento e cancela notificações ainda pendentes. Alterações de outro comprador recebem 404. Depois que uma requisição já foi entregue ao provedor, não é possível recolher a mensagem.

`settleVerifiedPayment` grava a outbox **na mesma transação** de pagamento, ledger e direitos. A assinatura aceita tanto o D1 legado quanto `Env`; passando `Env`, o envio é iniciado imediatamente após o commit. Com `ExecutionContext`, a chamada usa `waitUntil`; sem ele, aguarda a tentativa. O webhook Pix existente já passa Env/context. Chamadores antigos que passam só D1 continuam funcionando e o cron drena a outbox.

O webhook agora exige autenticação: HMAC existente com `WEBHOOK_SECRET` para gateway/laboratório, ou `asaas-access-token` conferido com `ASAAS_WEBHOOK_TOKEN` para Asaas nativo. Sem credencial configurada, responde 503 sem liquidar. No formato Asaas, somente `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED` liquidam; estorno, cancelamento e outros eventos não criam direitos ou notificações. A integração do PSP continua responsável por conciliar valores e eventos reais.

O provedor implementado é **Meta WhatsApp Cloud API**, com template de utilidade aprovado. Cadastre o template configurado, por exemplo `aire_photos_download_ready`, em português, com um parâmetro de corpo para a URL:

> Olá! Suas fotos do evento já estão prontas para download: {{1}}

O parâmetro é `PUBLIC_SITE_URL/minhas-fotos/{orderId}`. `PUBLIC_SITE_URL` permanece em `https://fotoviva-pedromatosx-lab.pedromatos2050.workers.dev`, pois o domínio ainda não foi comprado. Quando a zona estiver ativa, altere a variável para `https://airephotos.com.br` no ambiente correspondente. O frontend principal precisa servir essa página e autenticar o comprador; o link não contém ticket efêmero nem acesso público aos originais. Não foram alteradas ou publicadas páginas no Worker remoto.

Outbox única por pedido + lease impedem envios simultâneos/repetição de webhook. `accepted` significa aceite pela API Meta, não confirmação de entrega ao aparelho. HTTP 429 tem retentativa limitada com espera; erros permanentes falham sem reenvio. Timeout, 5xx ou interrupção após envio são `uncertain`: não há garantia de idempotência ponta a ponta sem suporte do provedor, portanto não se repete automaticamente uma tentativa ambígua. Concilie no provedor usando `provider_message_id`/`biz_opaque_callback_data` antes de reativar manualmente uma linha. Nenhum envio de teste a telefone real faz parte da validação local.

## Cron e configuração

`wrangler.jsonc` mantém o cron de dois minutos para recuperar processamento e drenar a outbox, e acrescenta `*/10 * * * *` para:

- Expirar pedidos/cobranças pendentes vencidos, preservando pagos.
- Varredura paginada de `originals/pending/`: no máximo cinco páginas de cem objetos por execução, com cursor persistido; apaga objetos com mais de 24 h sem trabalho ativo. Não toca originais definitivos nem prévias. O lifecycle R2 desse prefixo continua recomendado como complemento.
- Apagar sessões, recibos e índices expirados; tentar até dez fotos pendentes de indexação por execução. Backfills grandes devem chamar o endpoint de indexação com concorrência controlada, além dessa recuperação periódica.

Instale dependências e aplique `0004_face_whatsapp_maintenance.sql` depois de 0001–0003. O snapshot `schema.sql` equivale às quatro migrações. `npm run db:migrate:local` valida localmente; revise backup/configuração antes de aplicar remotamente.

Secrets do Worker:

- `FACE_EMBEDDINGS_TOKEN`: acesso ao serviço facial.
- `FACE_INDEX_ENCRYPTION_KEY`: 32 bytes aleatórios em base64, para templates cifrados.
- `FACE_IP_HASH_SECRET`: pelo menos 32 caracteres aleatórios para HMAC, distinto das outras chaves.
- `WHATSAPP_ACCESS_TOKEN`: token de envio Meta.
- `WEBHOOK_SECRET` e/ou `ASAAS_WEBHOOK_TOKEN`: autenticação dos eventos de pagamento.

Vars adicionais:

- `FV_FACE_SEARCH=on`, `FACE_EMBEDDINGS_URL`, `FACE_MODEL_VERSION`, `FACE_EMBEDDING_DIMENSIONS`, `FACE_MEDIUM_THRESHOLD`, `FACE_HIGH_THRESHOLD`.
- `FACE_CONSENT_RETENTION_DAYS` (90 no exemplo, ajustável conforme a política da operação) e `FACE_MAX_SCANNED_VECTORS` (1–30000, padrão 30000).
- `WHATSAPP_ENABLED=on`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION` suportada pela conta, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE` e `PUBLIC_SITE_URL`.

### Ativação por ambiente e decisão dos sócios

As duas flags vêm em **`off`** no `wrangler.jsonc` e devem permanecer assim até a decisão dos sócios. Configurar credenciais não liga os recursos. A liberação da biometria depende da definição e documentação da base legal LGPD, inclusive para o índice das pessoas fotografadas; a liberação do WhatsApp depende de conta **Meta Business verificada**, template de utilidade aprovado e política de opt-in definida pelos sócios.

- **Testes Vitest:** os testes carregam as flags padrão do Wrangler; cada fixture que precisa de busca ou envio define explicitamente a respectiva flag como `on`, com dados sintéticos e provedores simulados.
- **Desenvolvimento local:** para ensaio autorizado e isolado, use `npx wrangler dev --var FV_FACE_SEARCH:on` ou `npx wrangler dev --var WHATSAPP_ENABLED:on`. Cada comando liga somente o recurso indicado. Configure as demais vars e use apenas serviços simulados; mantenha os segredos de desenvolvimento no arquivo local ignorado `.dev.vars`.
- **Homologação/produção:** após aprovação dos sócios para aquele ambiente, defina separadamente `env.<ambiente>.vars.FV_FACE_SEARCH = "on"` e/ou `env.<ambiente>.vars.WHATSAPP_ENABLED = "on"` em `wrangler.jsonc`. Cada flag habilita seu próprio recurso; mantenha a outra em `off` se não aprovada. O arquivo atual ainda não declara ambientes nomeados: ao adicioná-los, declare também todas as vars e bindings necessários, pois [vars e bindings não são herdados entre ambientes](https://developers.cloudflare.com/workers/wrangler/environments/#non-inheritable-keys-and-environments). Configure os secrets por ambiente (`npx wrangler secret put NOME --env <ambiente>`) e implante com `npx wrangler deploy --env <ambiente>` somente no fluxo de implantação aprovado. Para o destino sem `--env`, a configuração equivalente fica em `vars` no nível raiz.

Para desligar, volte a flag correspondente a `off` no mesmo ambiente. A busca responde `feature_disabled` e o WhatsApp não envia nem consome tentativas da outbox. Notificações pendentes podem ser processadas ao religar, respeitando consentimento e validade do pedido. Credenciais ausentes não geram vetores simulados nem enviam mensagens. Não registre imagens, vetores, IP puro, token Meta, chave facial ou números de telefone em logs de aplicação/proxy.

Valide com `npm run check`, `npm run build:media` e `npm run deploy:check`. Testes novos usam somente JPEGs/embeddings sintéticos e fetch simulado: consentimento/rate limit, faixas/cosseno, isolamento/visibilidade, cifragem, descarte, outbox transacional, checkout → webhook → WhatsApp, duplicação/retentativas e limpeza paginada. Homologação com endpoint facial, Cloudflare e Meta reais depende das credenciais e da infraestrutura configurada.

Referências: [BGE é um modelo textual](https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/), [ANPD — dados pessoais sensíveis](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes/perguntas-frequentes), [Meta — templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/template-messages/), [webhooks Asaas](https://docs.asaas.com/docs/webhooks-faq).
