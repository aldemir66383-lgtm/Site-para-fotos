# F05 — Entrega após o pagamento

> **Status:** ✅ especificada · ✅ concessão e revogação de direitos testadas no batch de referência · ⚠️ o ticket de 60 s já existe: falta auditar os itens da §3
> **Dependência:** a geração e a entrega de imagens privadas seguem os requisitos do **Codex** (perguntas em aberto na §6).

## 1. Regra central

Uma foto só é considerada **comprada** quando existe `download_entitlements.status = 'active'` para ela. Esse registro só é criado **dentro do batch** que confirma um evento de pagamento válido (F03 §5). Nenhuma outra rota cria direitos.

## 2. Modelo

```sql
CREATE TABLE download_entitlements (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL UNIQUE,
  photo_id TEXT NOT NULL,
  buyer_subject TEXT NOT NULL,          -- id do usuário ou do cookie anônimo de convidado
  status TEXT NOT NULL CHECK (status IN ('active','revoked')),
  granted_event_id TEXT NOT NULL,       -- rastreia qual pagamento concedeu
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoke_reason TEXT,                   -- refund | moderation | photographer_takedown | admin
  max_downloads INTEGER NOT NULL DEFAULT 20,
  downloads_used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE delivery_tickets (
  token_hash TEXT PRIMARY KEY,          -- SHA-256 do token; o token em si nunca é gravado
  entitlement_id TEXT NOT NULL,
  buyer_subject TEXT NOT NULL,
  expires_at INTEGER NOT NULL,          -- emissão + 60 s (valor atual)
  used_at INTEGER
);

CREATE TABLE delivery_log (
  id INTEGER PRIMARY KEY,
  entitlement_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('issued','served','expired','reused','denied','revoked','storage_error')),
  bytes INTEGER,
  ip_hash TEXT,                         -- HMAC(ip, sal diário); nunca o IP puro
  at INTEGER NOT NULL
);
```

> Se o código existente já tiver tabelas equivalentes para tickets e entregas, **acrescente apenas as colunas que faltam**.

## 3. Controles

| Requisito do briefing | Controle | Situação |
|---|---|---|
| Registrar direitos de download | Tabela acima, criada só pelo batch de pagamento | ⚠️ tornar explícito |
| Evitar acesso de compradores não autorizados | Toda rota `orders/:id/*` exige `buyer_subject` igual ao da sessão; caso contrário, responde **404** | ⚠️ verificar |
| Impedir manipulação de pedidos | `order_items` é imutável depois de criado; `photoId` na rota do ticket precisa pertencer ao pedido **e** ter direito ativo | ⚠️ verificar |
| Limitar reutilização de tickets | Token de 32 bytes aleatórios em base64url; grava-se só o SHA-256; uso único via `UPDATE delivery_tickets SET used_at=?now WHERE token_hash=? AND used_at IS NULL AND expires_at > ?now` com `changes = 1` | ✅ 60 s e uso único já existem · ⚠️ verificar o hash |
| Limitar emissões | Até 10 tickets por direito por hora e `downloads_used < max_downloads` | ❌ criar |
| Revogar ou ajustar direitos | Estorno, moderação ou retirada pelo fotógrafo → `status='revoked'`; tickets pendentes deixam de valer, porque a rota de entrega checa o direito no momento do uso | ✅ revogação por estorno testada |
| Registrar entregas e falhas | `delivery_log` para cada resultado | ⚠️ |

## 4. Rota de entrega

`GET /api/fotoviva/deliveries/:token` (existente):

1. Calcular `sha256(token)` e consumir o ticket de forma atômica (veja acima). Se falhar, responder `410 Gone` e registrar `reused` ou `expired`.
2. Confirmar que o direito está `active` e que `buyer_subject` é o mesmo da sessão atual. Se não for, `404` e `denied`.
3. Fazer `env.R2.get(chaveDoOriginal)` e enviar o arquivo **pelo Worker**. **Não redirecionar** para uma URL pré-assinada do R2: ela pode ser reutilizada enquanto não vence, o que anula o uso único.
4. Cabeçalhos: `Content-Type: image/jpeg`, `Content-Disposition: attachment; filename="fotoviva-<8 chars>.jpg"`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
5. Incrementar `downloads_used` e registrar `served` com os bytes enviados.

## 5. Recuperação do convidado (existente)

Manter o desenho atual: código de 43 caracteres, uso único, gerado só no navegador do titular. Verificar também:

- se o código é guardado **como hash**;
- se há limite de tentativas de `POST /recover` (sugestão: 5 por pedido por hora e 20 por IP-hash por dia);
- se a resposta é idêntica para "pedido inexistente" e "código errado".

## 6. Perguntas para o Codex

1. Os metadados EXIF (GPS, número de série da câmera) devem ser removidos do original antes da entrega?
2. A cópia entregue deve ter marca invisível (*fingerprint* por comprador) para rastrear vazamentos?
3. O tempo de 60 s e o máximo de 20 downloads são aceitáveis para originais de 12 MB em redes móveis?
4. O bucket R2 de originais é separado do bucket de prévias, com credenciais distintas?
5. A política para conteúdo retirado pela moderação depois da compra prevê revogar e estornar automaticamente?
