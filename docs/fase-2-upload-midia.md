# Fase 2.1 — Upload, EXIF, OCR e proteção

Implementação em TypeScript para Cloudflare Workers + D1 + R2 + Queues, com processamento de imagem em um serviço Node separado. O repositório não tinha um servidor executável, autenticação ou tabela de álbuns; esta implementação fornece um Worker com autenticação JWT e uma tabela mínima de propriedade de álbuns. O componente `MassUpload.tsx` continua sendo uma demonstração; seu fluxo deve consumir os contratos abaixo na aplicação principal.

## Fluxo

1. O fotógrafo autenticado solicita a intenção, informando álbum, nome, MIME e tamanho.
2. O Worker valida `role=photographer`, `sub` e a propriedade do álbum no D1; cria a foto como `draft`.
3. O navegador faz `PUT` direto no R2 privado, em `originals/pending/{photoId}/{nonce}.jpg`. A assinatura dura dez minutos e inclui **Content-Length exato** e `Content-Type: image/jpeg`.
4. Após o PUT, o cliente chama `/process`. O Worker confere presença, tamanho e MIME com HEAD, fixa o ETag e registra o trabalho no D1 antes de publicar na fila.
5. O consumidor obtém um lease, lê o objeto condicionado ao ETag e envia os bytes ao serviço de mídia por HTTPS autenticado. Uma substituição entre HEAD e GET é recusada.
6. O serviço decodifica o JPEG, extrai EXIF, corrige orientação, reduz para até 1600 × 1600 e consulta OCR antes de aplicar a marca. A saída WebP tem a marca diagonal repetida gravada nos pixels e não preserva EXIF/GPS.
7. O Worker grava o original em `originals/{photoId}.jpg` e a prévia em `previews/{photoId}.webp`. Uma transação D1 grava EXIF e dorsais, registra aprovação técnica e muda a foto para `verified`.
8. O catálogo deve filtrar `status = 'verified'`. O handler público de prévias também verifica esse status e entrega somente a chave de prévia esperada. Não existe rota pública para originais.

URLs PUT podem ser reutilizadas até expirarem. Por isso a chave temporária é diferente da definitiva: uma URL antiga nunca sobrescreve o original aprovado. O cron remove o staging depois da expiração. Configure também lifecycle de **um dia apenas em `originals/pending/`** para remover objetos órfãos criados por uploads abandonados ou falhas entre serviços. Nunca aplique essa regra ao prefixo inteiro `originals/`.

## Contratos HTTP

Autenticação: `Authorization: Bearer <JWT>`, assinado com RS256 ou ES256; `sub`, `iat`, `exp`, `iss`, `aud` e `role=photographer` obrigatórios. Chaves públicas vêm da URL JWKS configurada pelo operador. Não são aceitos identidade nem status fornecidos no corpo. Na aplicação principal, pode-se adaptar `authenticatePhotographer` à sessão HttpOnly existente, mantendo validação de papel e proteção CSRF quando houver cookies.

### POST /api/fotoviva/studio/photos/upload-intent

```json
{ "albumId": "album-1", "filename": "corrida.jpg", "contentType": "image/jpeg", "size": 7340032 }
```

Resposta `201`:

```json
{
  "photoId": "38a0c79b-d6bb-4d58-864f-90328f0c7e3e",
  "uploadUrl": "https://…r2.cloudflarestorage.com/…?X-Amz-…",
  "method": "PUT",
  "headers": { "Content-Type": "image/jpeg" },
  "expectedBytes": 7340032,
  "maxBytes": 20971520,
  "expiresAt": "2026-10-24T15:10:00.000Z"
}
```

No navegador:

```ts
const upload = await fetch(intent.uploadUrl, {
  method: "PUT", headers: intent.headers, body: file,
});
if (!upload.ok) throw new Error("Falha no upload");
```

Envie o `File` inteiro como corpo, sem FormData. O navegador calcula Content-Length automaticamente; não tente definir esse cabeçalho via JavaScript. Clientes nativos precisam enviar exatamente o tamanho autorizado. O limite é **20 MiB (20 × 1024 × 1024 bytes)**, também conferido antes da leitura e durante o processamento; a extensão não substitui a decodificação real do JPEG.

### POST /api/fotoviva/studio/photos/process

```json
{ "photoId": "38a0c79b-d6bb-4d58-864f-90328f0c7e3e" }
```

Resposta `202`: `{ "photoId": "…", "status": "queued", "pollAfterSeconds": 3 }`. Pode retornar `processing`. Repetir a chamada permite acompanhar o resultado; a conclusão retorna `200` com `status: verified` e `previewUrl`. A fila pode receber duplicatas, mas lease e transação evitam processamento concorrente e duplicação dos dorsais. Uma falha terminal retorna `422`; faça uma nova intenção para reenviar.

Erros seguem `{ "error": "Mensagem em português", "code": "codigo_estavel" }`: `400 invalid_input`, `401 unauthenticated`, `404 not_found` (também para recursos alheios), `409 upload_incomplete`, `410 upload_expired`, `413 payload_too_large`, `415 unsupported_media_type`, `422 image_rejected/source_changed/processing_failed` e `503 temporarily_unavailable`.

### GET /api/fotoviva/previews/:photoId

Entrega WebP somente de fotos verificadas. Usa `no-store` para que ocultar uma foto bloqueie a próxima requisição. O bucket inteiro permanece privado; não configure domínio público para expor prévias e originais juntos. Para CDN futura, use um mecanismo que preserve a revogação.

## EXIF e OCR

`photo_exif` contém DateTimeOriginal bruto, subsequência de segundos, OffsetTimeOriginal, câmera, lente, exposição, abertura, ISO, distância focal e orientação. `photos.captured_at` preserva o horário local e a precisão original (até nove casas decimais); `photo_exif.captured_at_utc` é preenchido somente se houver offset EXIF válido, com precisão de milissegundos. Sem offset, não se presume UTC nem o fuso do servidor. Fotos sem EXIF são válidas e recebem metadados nulos. A dimensão da foto é armazenada já considerando a orientação.

O Google Cloud Vision recebe somente uma versão reduzida, orientada e sem EXIF, por API autenticada com Application Default Credentials. Ative Vision API no projeto e conceda ao serviço acesso mínimo necessário. Use identidade de workload/ADC; não inclua arquivos de credenciais na imagem Docker ou no repositório.

O OCR combina `TEXT_DETECTION` com `OBJECT_LOCALIZATION`, pede confiança de texto e aceita palavras inteiras de 1 a 5 dígitos com confiança mínima 0,70, próximas ao tronco/quadril de uma pessoa ou à região central de uma bicicleta. Preserva zeros iniciais e deduplica pelo maior valor de confiança; `confidence` é o menor valor entre texto e objeto. Números sem região compatível são descartados. Isso é uma **heurística de dorsal/placa**, não um detector especializado: patrocinadores, oclusões, fotos distantes e placas pequenas podem causar falsos positivos ou omissões. Uma resposta OCR sem números é válida; indisponibilidade do provedor causa retentativa e mantém a foto fora do catálogo. O provedor tem custo por imagem/feature; ajuste concorrência e cotas conforme a operação.

`approved_at` representa aprovação técnica (JPEG válido, tamanho/pixels permitidos, EXIF processado, OCR concluído e prévia gerada). Moderação humana/de conteúdo não está implementada. A marca d'água reduz o aproveitamento de capturas e cópias, mas não impede prints nem garante remoção impossível.

## Banco de dados e implantação

1. Instale Node 22.13+ (Node 24 recomendado) e rode `npm ci`.
2. Crie D1 `fotoviva`, bucket privado `fotoviva-private`, fila `fotoviva-photos` e DLQ `fotoviva-photos-dlq`; substitua os placeholders em `wrangler.jsonc`.
3. Aponte o Worker às rotas de API no domínio da aplicação. `workers_dev` vem desativado. Se integrar a outro roteador, use os handlers exportados e conecte também `queue` e `scheduled`.
4. Cadastre secrets do Worker com `npx wrangler secret put`: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` e `MEDIA_SERVICE_TOKEN`. O token R2 deve ter leitura/escrita **somente nesse bucket**. Não configure acesso público via `r2.dev` ou custom domain. Configure `AUTH_*` para seu emissor real; o `sub` deve corresponder ao `photographer_id` no banco.
5. Configure o CORS do R2 para os domínios reais do estúdio, permitindo PUT e `Content-Type`. Exemplo (substitua o domínio):

```json
[{ "AllowedOrigins": ["https://studio.example.com"], "AllowedMethods": ["PUT"],
   "AllowedHeaders": ["Content-Type"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
```

6. **Banco novo:** `npx wrangler d1 migrations apply fotoviva --remote` executa as migrações pendentes (incluindo a Fase 4.1). Para desenvolvimento, `npm run db:migrate:local`. `schema.sql` é um snapshot cumulativo das migrações, para referência/bootstrap manual; não execute snapshot e migrações sobre o mesmo banco. Consulte também [a migração de entrega e ledger](fase-4-entrega-ledger.md).
7. **Banco já criado pelo schema anterior:** faça backup e registre `0001_baseline.sql` como aplicado no controle `d1_migrations` antes de executar as migrações pendentes. Não reaplique 0001 nem 0002 manualmente em banco já migrado. A migração 0002 cria `albums` mínimo: importe os IDs e donos do cadastro verdadeiro antes de usar a API. Se o banco principal já tiver `albums`, adapte essa parte ao schema real antes de aplicar.
8. **Atenção à migração:** fotos `verified` legadas voltam a `draft`, porque não há prova de geração de prévia protegida. Reingira os arquivos pela nova API antes de republicar. Dorsais legados inválidos são removidos e duplicatas são consolidadas pela maior confiança. Os originais não são removidos pela migração.
9. Construa o serviço: `docker build -f Dockerfile.media -t fotoviva-media .`. Execute em um host Node/container com HTTPS, fontes DejaVu e ADC para Vision. Defina `MEDIA_SERVICE_TOKEN` (segredo aleatório de pelo menos 32 caracteres), `PORT` e a identidade Google. Configure `MEDIA_SERVICE_URL` do Worker com o endpoint HTTPS `/process` e o mesmo token. Não publique porta HTTP diretamente na internet; use o terminador TLS da hospedagem. O serviço aceita até dois trabalhos simultâneos por instância; excesso recebe 503 para retentativa.
10. Rode `npm run check`, `npm run build:media` e `npm run deploy:check`. Faça o deploy em ambiente de homologação com as credenciais reais e teste assinatura PUT/tamanho, CORS, JWT, visibilidade do bucket, OCR, fila e download de prévias antes da produção. Não há deploy automático nesta alteração.

O consumidor processa uma imagem por invocação, com concorrência máxima de oito invocações, timeout de chamada de mídia de 90 s e lease de cinco minutos. O contador persistente limita a cinco tentativas por foto. O cron a cada dois minutos recupera leases vencidos, republica trabalhos que ficaram entre D1 e fila e remove staging expirado. Observe fila/DLQ e `photo_uploads.error_code`; não registre URLs assinadas, tokens, EXIF bruto ou bytes das fotos.

## Verificação local

Os testes usam JPEGs sintéticos, processamento real com Sharp/exifr, SQLite com as migrações reais, adaptadores locais D1/R2/fila e respostas de OCR simuladas. Cobrem autorização, assinatura, limites, EXIF, marca gravada, filtros de OCR, substituição de upload, duplicação, falhas de R2/OCR, esgotamento de tentativas e recuperação. A checagem TypeScript cobre o backend desta fase; os componentes React e módulos antigos não foram incluídos por ainda não haver uma aplicação principal configurada neste repositório.

Referências: [URLs pré-assinadas R2](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [CORS R2](https://developers.cloudflare.com/r2/buckets/cors/), [retentativas Queues](https://developers.cloudflare.com/queues/configuration/batching-retries/), [Sharp composite](https://sharp.pixelplumbing.com/api-composite/), [opções exifr](https://github.com/MikeKovarik/exifr), [OCR Vision](https://docs.cloud.google.com/vision/docs/ocr), [objetos Vision](https://docs.cloud.google.com/vision/docs/object-localizer).
