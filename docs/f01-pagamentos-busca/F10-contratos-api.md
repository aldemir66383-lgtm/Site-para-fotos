# F10 — Contratos de integração (API)

> **Status:** ✅ contratos definidos · ⚠️ as rotas marcadas **[existente]** foram inferidas do bundle público e precisam ser confirmadas no código · as marcadas **[nova]** são propostas
> **Público:** o Claude (telas) e o Codex (revisão). As telas podem ser feitas **sem alterar a lógica do servidor**.

## 1. Convenções

| Item | Regra |
|---|---|
| Prefixo | `/api/fotoviva/…` (mantido) |
| Autenticação | Cookie de sessão `HttpOnly` (existente). Convidados usam o cookie anônimo do laboratório |
| Dinheiro | `*Cents` inteiros, BRL. **Não existe campo de preço na entrada** de nenhuma rota de compra |
| Datas | `expiresAt` e similares em ISO-8601 UTC, ou epoch ms se o código existente já usar esse formato (confirmar) |
| Erro | `{ "error": "<mensagem pt-BR para exibir>", "code": "<código estável>", "retryAfterSeconds"?: number }`. O campo `error` já é usado pelo cliente atual; `code` é a novidade |
| Recurso de outro usuário | **404** (nunca 403), para não revelar que ele existe |
| Recurso desligado | **403** `feature_disabled`. A interface mostra o estado `blocked`, que já existe |

### Códigos de erro

| HTTP | `code` | Quando |
|---|---|---|
| 400 | `invalid_input` | Esquema inválido |
| 400 | `consent_required` | Selfie sem consentimento válido |
| 401 | `invalid_signature` | Webhook (sem detalhes) |
| 403 | `feature_disabled` | Flag desligada ou fora do laboratório |
| 403 | `album_not_eligible` | Álbum sem a busca pedida (ex.: tem menores e o modo é selfie) |
| 404 | `not_found` | Inexistente **ou** de outro usuário |
| 409 | `items_unavailable` | Carrinho com fotos indisponíveis |
| 410 | `ticket_used` · `ticket_expired` · `session_expired` | — |
| 413 | `payload_too_large` | Imagem acima de 8 MB (busca) |
| 415 | `unsupported_media_type` | Fora de JPEG, PNG ou WebP |
| 422 | `image_unreadable` · `image_too_small` · `image_quality` · `no_person` · `no_face` · `multiple_faces` | Validação da imagem |
| 429 | `rate_limited` | Com `retryAfterSeconds` |
| 503 | `temporarily_unavailable` | D1, R2 ou processador fora do ar |

## 2. Tipos compartilhados

```ts
export type UiState = "loading" | "blocked" | "error" | "empty" | "ready"; // padrão existente das telas

export type OrderStatus = "pending" | "paid" | "failed" | "expired" | "refunded";
export type Relevance = "alta" | "media" | "baixa";
export type Color =
  | "preto" | "branco" | "cinza" | "vermelho" | "laranja" | "amarelo"
  | "verde" | "azul" | "azul_marinho" | "roxo" | "rosa" | "marrom";
export type Region = "superior" | "inferior" | "corpo_inteiro" | "cabeca" | "bolsa" | "pes" | "qualquer";

export interface ApiError { error: string; code: string; retryAfterSeconds?: number }
```

## 3. Compra (área A)

### 3.1 Carrinho [existente]

| Método e rota | Entrada | Saída |
|---|---|---|
| `GET /api/fotoviva/cart` | — | `CartView` |
| `POST /api/fotoviva/cart` | `{ "action": "add", "photoIds": string[≤24] }` · `{ "action": "remove", "photoId": string }` · `{ "action": "clear" }` *(formato inferido)* | `CartView` |

```ts
export interface CartView {
  items: { photoId: string; albumTitle?: string; preview?: string; available: boolean; unitPriceCents?: number }[];
  count: number;
  totalCents: number;        // calculado no servidor; itens indisponíveis não entram
  unavailableCount: number;
}
```

### 3.2 Criar pedido [existente]

`POST /api/fotoviva/orders`

- Cabeçalho `Idempotency-Key: <uuid>`. O cliente já gera e reutiliza essa chave em retentativas; **confirmar** se ela vai em cabeçalho ou no corpo.
- O corpo **não leva preço**. O servidor usa o carrinho da sessão. Se vierem `price`, `total` ou `amount`, eles são **ignorados**.
- `201 { "id": "<uuid>" }` · repetição com a mesma chave → `200` com o mesmo `id` · `409 items_unavailable`.

### 3.3 Consultar pedido e pagamento simulado [existente + campo novo]

`GET /api/fotoviva/orders/:id`

```ts
export interface OrderView {
  id: string;
  status: OrderStatus;
  itemCount: number;
  totalCents: number;        // snapshot congelado
  expiresAt: string;
  payment?: {                // [nova] opcional, retrocompatível
    provider: "lab";
    simulated: true;         // a interface DEVE exibir "sem dinheiro real" enquanto for true
    txid: string;
    status: "active" | "paid" | "expired" | "failed" | "refunded" | "partially_refunded";
    copyPaste: null;         // sempre null no laboratório: não existe chave Pix
    pollAfterSeconds: number; // sugestão de intervalo para consultar de novo
  };
}
```

### 3.4 Pedidos do comprador [existente]

`GET /api/fotoviva/orders` → `{ orders: { id, status, totalCents, itemCount, createdAt }[] }` *(campos a confirmar)*

### 3.5 Direitos de download e recibo [existente + campos novos]

`GET /api/fotoviva/orders/:id/deliveries`

```ts
export interface DeliveriesView {
  receipt: { status: OrderStatus; totalCents: number; items: unknown[]; warning: string; emailPreview: string };
  items: {
    photoId: string;
    canDownload: boolean;
    downloadsLeft?: number;            // [nova]
    revokedReason?: "refund" | "moderation" | "photographer_takedown" | "admin"; // [nova]
  }[];
}
```

### 3.6 Ticket e entrega [existente]

- `POST /api/fotoviva/orders/:id/photos/:photoId/ticket` → `200 { "url": "/api/fotoviva/deliveries/<token>", "expiresAt": "…" }`. Validade de 60 s e uso único.
- `GET /api/fotoviva/deliveries/:token` → `200 image/jpeg` (anexo) · `410 ticket_used | ticket_expired` · `404`.
- A interface deve navegar para a `url` logo depois de recebê-la, **sem guardar** o token.

### 3.7 Recuperação do convidado [existente]

- `POST /api/fotoviva/orders/:id/recovery` → `{ "code": "<43 chars>" }`. O código aparece **uma única vez**.
- `POST /api/fotoviva/recover` com `{ orderId, code }` → `200` (associa o pedido à sessão) · `404` genérico · `429`.

### 3.8 Laboratório financeiro (somente `FV_LAB=1`)

| Rota | Situação | Papel | Função |
|---|---|---|---|
| `POST /api/fotoviva/pix-lab/webhook` | existente | Assinatura HMAC | Recebe o evento simulado (F03 §4) |
| `POST /api/fotoviva/pix-lab/simulate` | nova (verificar se já existe) | Dono do pedido ou `finance_admin` | `{ orderId, scenario }`: gera evento **assinado** |
| `GET /api/fotoviva/finance-lab/ledger` | existente | Admin | Conciliação (`allReconciled`, `orders[]`) |
| `POST /api/fotoviva/finance-lab/refunds` | nova | `finance_admin` | `{ orderId, photoIds?: string[], reason }` → estorno simulado, idempotente por `Idempotency-Key` |
| `GET /api/fotoviva/finance-lab/balances` | nova | Fotógrafo (o próprio) ou admin | `{ pendingCents, availableCents, negativeCents, history[] }` |
| `POST /api/fotoviva/finance-lab/payouts/simulate` | nova | `finance_admin` | `{ photographerId }` → `{ batchId, amountCents, status: "simulated" }` |

## 4. Busca (área B)

### 4.1 Capacidades do álbum [nova]

`GET /api/fotoviva/search/capabilities?albumId=<id>`

```ts
export interface SearchCapabilities {
  albumId: string;
  modes: { filters: true; clothingText: boolean; clothingReference: boolean; selfie: boolean };
  unavailableReasons: Partial<Record<"clothingText" | "clothingReference" | "selfie",
    "feature_disabled" | "album_not_eligible" | "not_indexed">>;
  limits: { maxUploadBytes: number; acceptedTypes: string[]; maxItemsPerQuery: number };
  selfiePolicy?: { version: string; url: string };   // presente só se a selfie puder ser oferecida
}
```

A interface só mostra os botões dos modos que estão `true`. Hoje, `selfie` é **sempre `false`**.

### 4.2 Busca por roupas: texto ou atributos [nova, síncrona]

`POST /api/fotoviva/search/clothing`

```ts
export interface ClothingSearchRequest {
  albumId: string;
  query?: string;                                       // até 200 caracteres
  attributes?: { region: Region; color?: Color; type?: string }[]; // seleção guiada (até 5)
  bib?: string;                                         // número de peito (filtro existente)
  capturedFrom?: string; capturedTo?: string;           // horário EXIF (filtro existente)
  cursor?: string;                                      // paginação de 24 em 24
}

export interface ClothingSearchResponse {
  interpreted: { items: { type: string; region: Region; color?: Color }[]; bib?: string };
  unrecognizedTerms: string[];   // mostrar "não entendemos: …"
  results: SearchResult[];
  nextCursor: string | null;
}

export interface SearchResult {
  photoId: string;
  albumId: string;
  previewUrl: string;            // sempre a prévia com marca-d'água
  width: number; height: number;
  relevance: Relevance;
  reasons: (
    | { kind: "color"; region: Region; color: Color; exact: boolean }
    | { kind: "garment"; type: string }
    | { kind: "bib"; value: string }
    | { kind: "visual_similarity" }
    | { kind: "face_similarity" }
  )[];
}
```

Exemplo:

```json
POST /api/fotoviva/search/clothing
{ "albumId": "alb_123", "query": "camisa vermelha e boné preto" }

200
{
  "interpreted": { "items": [
    { "type": "camisa", "region": "superior", "color": "vermelho" },
    { "type": "bone", "region": "cabeca", "color": "preto" } ] },
  "unrecognizedTerms": [],
  "results": [
    { "photoId": "ph_9", "albumId": "alb_123", "previewUrl": "/api/fotoviva/previews/ph_9",
      "width": 1600, "height": 1067, "relevance": "alta",
      "reasons": [ { "kind": "color", "region": "superior", "color": "vermelho", "exact": true },
                   { "kind": "color", "region": "cabeca", "color": "preto", "exact": true } ] }
  ],
  "nextCursor": null
}
```

### 4.3 Sessões assíncronas: imagem de referência e selfie [nova]

| Ação | Rota | Resposta |
|---|---|---|
| **Enviar imagem de referência** | `POST /api/fotoviva/search/sessions` (multipart: `albumId`, `mode=reference`, `image` **ou** `attributes` JSON calculado no navegador) | `202 SearchSession` |
| **Enviar selfie** (bloqueado) | Mesma rota, com `mode=selfie`, `image`, `consent={"policyVersion":"…","accepted":true,"adult":true}` | Hoje: `403 feature_disabled` |
| **Consultar status** | `GET /api/fotoviva/search/sessions/:id` | `200 SearchSession` |
| **Receber resultados** | Mesma rota, quando `status = "done"` | `results` preenchido |
| **Cancelar processamento** | `DELETE /api/fotoviva/search/sessions/:id` | `204`: cancela e apaga |
| **Excluir dados temporários** | Mesma rota `DELETE`. Depois do `done`, apaga os resultados guardados | `204` · repetir → `404` |

```ts
export interface SearchSession {
  id: string;
  albumId: string;
  mode: "reference" | "selfie";
  status: "queued" | "processing" | "done" | "failed" | "canceled" | "expired";
  expiresAt: string;                 // 30 min
  pollAfterSeconds?: number;
  errorCode?: string;                // ex.: "no_person", "multiple_faces"
  results?: SearchResult[];          // só em "done"
  disclaimer?: string;               // obrigatório no modo selfie: "Possíveis correspondências — confira se é você."
}
```

**Níveis de confiança (como exibir):**

| `relevance` | Texto sugerido | Observação |
|---|---|---|
| `alta` | "Muito parecida com a sua busca" | — |
| `media` | "Pode ser você / pode combinar" | — |
| `baixa` | "Outras possibilidades" | Só em roupas, recolhido por padrão. **Nunca** aparece no modo selfie |

Não exibir porcentagens nem pontuações.

### 4.4 Indexação pelo fotógrafo [nova, fase B1]

`PUT /api/fotoviva/studio/photos/:id/search-features` (somente o dono da foto)

```ts
export interface PhotoSearchFeatures {
  modelVersion: string;              // ex.: "b1-color-1"
  people: {                          // até 30
    box: [number, number, number, number]; // relativo (0..1): x, y, w, h
    regions: { region: Region; color: Color; confidence: number }[]; // até 4
  }[];
}
```

`204` · `404` (foto de outro fotógrafo) · `400 invalid_input`. `albumId` e `photographerId` **não** fazem parte do corpo: vêm do banco.

## 5. Componentes mínimos para o Claude

Esta é a lógica sem estilo que o Claude pode envolver com o design dele. Cada item é um *hook* ou serviço que só chama os contratos acima.

| Componente | Responsabilidade | Estados |
|---|---|---|
| `useSearchCapabilities(albumId)` | Decide quais botões mostrar | `loading`, `ready`, `error` |
| `useClothingSearch(albumId)` | Debounce de 300 ms, paginação e cancelamento com `AbortController` | `loading`, `empty`, `ready`, `error`, `blocked` |
| `useSearchSession()` | Cria, consulta com intervalo crescente, cancela e exclui; chama `DELETE` ao sair da tela | `queued`, `processing`, `done`, `failed`, `canceled`, `expired` |
| `useOrderPayment(orderId)` | Consulta o pedido respeitando `pollAfterSeconds` e para em estado terminal | `pending`, `paid`, `failed`, `expired`, `refunded` |
| `useDeliveries(orderId)` | Lista direitos; pede ticket e navega para a URL | `blocked`, `ready`, `error` |
