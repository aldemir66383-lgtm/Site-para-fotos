# F01 — Auditoria do que já existe

> **Status:** ✅ concluída com as fontes públicas · ⚠️ falta confirmar no código-fonte privado
> **Data:** 2026-10-23

## 1. Fontes e limites desta auditoria

O repositório `pedromatosx/fotoviva` é **privado e não está acessível** para a conta `aldemir66383-lgtm`: a API do GitHub responde `Could not resolve to a Repository`. Por isso, a auditoria usou apenas fontes públicas:

| Fonte | O que forneceu |
|---|---|
| `https://fotoviva-pedromatosx-lab.pedromatos2050.workers.dev/` (HTML + 40 chunks JS) | Stack, manifesto de rotas (`__VINEXT_*`), textos e estados das telas, campos de cada resposta da API |
| `pedromatosx/fotoviva-pages` (público) | README da prévia estática e `demo-api.js` (simulador de álbuns no navegador) |
| `GET` nas rotas `/api/fotoviva/*` do deploy público | Isolamento: todas respondem `403 FotoViva: demonstracao somente visual; APIs e escrita indisponiveis.` |

Não foi possível ler: os arquivos GSD, os bloqueios de lançamento, o esquema D1, os handlers do servidor, os testes existentes nem a implementação do gate de laboratório.

**Consequência:** toda afirmação marcada como **inferida** foi deduzida do bundle do cliente e precisa ser confirmada no código antes de qualquer implementação. A regra do briefing, "não reimplemente o que já estiver correto", depende dessa confirmação.

## 2. Stack identificada

| Camada | Evidência | Conclusão |
|---|---|---|
| Framework | Cabeçalhos `Vary: X-Vinext-*`, globais `__VINEXT_*`, chunks `rolldown-runtime` | Next.js App Router compilado com **vinext** (Vite) |
| Runtime | `Server: cloudflare`, domínio `*.workers.dev` | **Cloudflare Workers** |
| Banco | Textos "pedido fictício no **D1** local" e "decisão registrada no **D1** de laboratório" | **Cloudflare D1** (SQLite) |
| Arquivos | "Nenhuma foto será… enviada ao **R2**" | **Cloudflare R2** para originais privados |
| Dinheiro | Campos `totalCents` e `priceCents` | Já usa **centavos inteiros** ✅ |
| Gate de laboratório | O cliente tem um estado `blocked`, e o deploy público responde 403 | Existe um flag de ambiente que isola as APIs ✅ |
| Auth | `/api/auth/fotoviva/{signup,login,logout,session,onboard,profile}` | Autenticação própria. O papel de fotógrafo é concedido por um responsável |

## 3. Jornada de compra, de ponta a ponta

Legenda: ✅ existe no laboratório · ⚠️ existe, mas precisa ser verificado ou endurecido · ❌ ausente · 🔒 depende de serviço externo ou autorização

| # | Etapa | Página / API existente | Evidência no bundle | Status |
|---|---|---|---|---|
| 1 | Foto encontrada | `/catalogo`, `/catalogo/:id` · `GET /api/fotoviva/discovery/albums[/:id[/photos[/:photoId]]]` | Busca por nome do evento, cidade, categoria e fotógrafo; "Somente prévias verificadas aparecem aqui"; filtro por **horário EXIF**; campo `bib` (número de peito) | ✅ |
| 2 | Prévia protegida | `GET /api/fotoviva/previews/:id` | "Prévia com marca-d'água"; "O arquivo original permanece privado" | ✅ |
| 3 | Seleção | `/catalogo/:id` | Seleção com limite máximo; envio ao carrinho em lotes de 24 | ✅ |
| 4 | Carrinho | `/carrinho` · `/api/fotoviva/cart` | `totalCents`, `unavailableCount`, ações `remove`/`clear`, "Preços conferidos no servidor a cada atualização", cookie anônimo | ✅ |
| 5 | Pedido | `POST /api/fotoviva/orders` → `/pedido/:id` | O cliente gera `crypto.randomUUID()` uma vez por tentativa e o reutiliza em retentativas (**chave de idempotência**); o pedido é bloqueado se `unavailableCount > 0`; "Valor ilustrativo congelado" | ✅ ⚠️ confirmar se o servidor exige a chave |
| 6 | Cobrança Pix | `/pedido/:id` · `GET /api/fotoviva/orders/:id` | `status`, `itemCount`, `totalCents`, `expiresAt`, `id`; "NÃO EXISTE CHAVE PIX"; sem QR Code nem BR Code | ✅ simulado · 🔒 real |
| 7 | Confirmação | `POST /api/fotoviva/pix-lab/webhook` | Estados `pending`, `paid`, `failed`, `expired`, `refunded`; o cliente atualiza com o botão "Atualizar situação" | ⚠️ verificar assinatura, deduplicação e atomicidade |
| 8 | Direito de download | `GET /api/fotoviva/orders/:id/deliveries` | `items[].canDownload`; "Apenas fotos sintéticas de pedidos confirmados pelo webhook do laboratório" | ✅ ⚠️ não se vê tabela explícita de direitos nem revogação |
| 9 | Entrega | `POST /api/fotoviva/orders/:id/photos/:photoId/ticket` → `{url}` → `GET /api/fotoviva/deliveries/:token` | "Cada link vence em **60 segundos** e só pode ser usado **uma vez**" | ✅ ⚠️ verificar hash do token, vínculo com o comprador e log |
| 10 | Recuperação do convidado | `POST /api/fotoviva/orders/:id/recovery` · `POST /api/fotoviva/recover` | Código de 43 caracteres (32 bytes em base64url), uso único, gerado só no navegador do titular | ✅ ⚠️ verificar limite de tentativas |
| 11 | Recibo | Resposta das entregas: `receipt.warning`, `receipt.emailPreview` | "Recibo por e-mail: **não enviado**" | ✅ simulado · 🔒 provedor de e-mail |
| 12 | Comissão do fotógrafo | `/financeiro-teste` · `GET /api/fotoviva/finance-lab/ledger` | Por pedido: `feeNetCents`, `photographerDueNetCents`, `paidClearingCents`, `refundedClearingCents`, `entryCount`, `reconciled`; também `allReconciled` | ✅ ⚠️ regra configurável? taxa do PSP? |
| 13 | Estorno | Estado `refunded`, `refundedClearingCents` | Nenhuma tela de solicitação; provavelmente disparado por um evento do laboratório | ⚠️ |
| 14 | Saldo e repasse | — | Não há entidade de saldo, lote ou repasse | ❌ |
| 15 | Abstração de provedor | — | Não dá para verificar pelo bundle | ⚠️ |
| 16 | Pix real (PSP) | — | Exige contrato, credenciais, mTLS e conta | 🔒 bloqueado (limite do briefing) |

## 4. Busca inteligente (parte B): o que existe

| Recurso | Situação | Evidência |
|---|---|---|
| Filtros estruturados (evento, cidade, categoria, fotógrafo) | ✅ existe | `catalogo-client` |
| Número de peito (`bib`) | ✅ existe | `e.bib`, "Número de peito:" |
| Filtro por horário de captura (EXIF) | ✅ existe | "Filtrar por horário de captura"; "Data de upload não representa hora da foto" |
| Busca por selfie | 🟡 só a interface, **desativada** | `busca-selfie`: botão `disabled`, "Nesta versão, a selfie não é processada, enviada nem armazenada" |
| Busca por roupas e cores | ❌ ausente | — |
| Similaridade por imagem de referência | ❌ ausente | — |
| Índices visuais ou vetoriais | ❌ ausente | — |

## 5. Armazenamento de álbuns e fotografias (inferido)

- Os álbuns têm `title`, `venue`, `location`, `category` (Corrida, Ciclismo, Crossfit, Futebol, Lutas, Social), `price` ou `priceCents`, `status` (Rascunho, Publicado, Oculto) e `photoCount`.
- As fotos têm `id`, `albumId`/`eventId`, `bib`, `width`, `height` e horário EXIF validado. A **prévia** fica em `/previews/:id`, com marca-d'água. O **original** é JPEG de até 12 MB, privado e guardado no R2.
- Publicação: rascunho privado → verificação das prévias → publicação no laboratório. A moderação pode ocultar álbuns.
- Somente fotos com prévia verificada aparecem na descoberta. **Essa é a regra de visibilidade que a busca precisa reaproveitar** (ver F09).

## 6. Isolamento da versão pública

Verificado em 2026-10-23 com `GET` simples, sem enviar dados:

```
GET /api/fotoviva/cart                → 403
GET /api/fotoviva/orders              → 403
GET /api/fotoviva/finance-lab/ledger  → 403
GET /api/fotoviva/discovery/albums    → 403
GET /api/fotoviva/pix-lab/webhook     → 403
corpo: "FotoViva: demonstracao somente visual; APIs e escrita indisponiveis."
```

✅ A versão pública continua isolada dos recursos financeiros. Toda a proposta deste pacote **preserva** esse gate: nenhuma rota nova responde fora do laboratório (ver F02 §6).

## 7. Conclusões: reaproveitar, endurecer ou criar

| Ação | Itens |
|---|---|
| **Reaproveitar sem reimplementar** | Carrinho, preço no servidor, snapshot do pedido, chave de idempotência do pedido, estados do pedido, ledger e conciliação do laboratório, tickets de 60 s de uso único, recuperação de convidado, prévias com marca-d'água, filtros de descoberta, `bib`, filtro EXIF, gate `blocked` |
| **Verificar e endurecer** | Assinatura do webhook, deduplicação de eventos, atomicidade da confirmação, pagamento após a validade, divergência de valor, regras de comissão versionadas, taxa do PSP no ledger, tabela explícita de direitos de download com revogação, log de entregas, limite de tentativas na recuperação |
| **Criar (módulos novos)** | Porta `PaymentProvider`, estorno parcial, saldo do fotógrafo, repasses **fictícios**, busca por roupas, índice visual por álbum, sessões de busca com exclusão, contrato da busca por selfie (desligada) |
| **Bloqueado** | Pix real, e-mail real, repasses reais, reconhecimento facial com dados reais |

## 8. Checklist para quando houver acesso ao código

- [ ] Ler os arquivos GSD e os bloqueios de lançamento; alinhar este pacote a eles.
- [ ] Localizar os handlers de `cart`, `orders`, `pix-lab/webhook`, `finance-lab/ledger`, `deliveries` e `recover`.
- [ ] Exportar o esquema D1 com `wrangler d1 export --local` (**somente local**; o briefing proíbe migrações remotas).
- [ ] Preencher a tabela da §3 com o caminho de cada arquivo e trocar ⚠️ por ✅ ou ❌.
- [ ] Rodar os testes existentes e anotar a cobertura atual.
- [ ] Mapear cada tabela proposta em F02 §5 para uma tabela existente. Só criar o que faltar.
