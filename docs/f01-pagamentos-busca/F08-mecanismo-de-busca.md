# F08 — Arquitetura do mecanismo de busca

> **Status:** ✅ decisão tomada (ADR abaixo) · 📝 a implementação depende do código-fonte

## 1. Abordagens avaliadas

Nota de 1 (pior) a 5 (melhor) em cada critério do briefing.

| Abordagem | Qualidade | Privacidade | Custo | Desempenho | Manutenção | Decisão |
|---|:-:|:-:|:-:|:-:|:-:|---|
| **Filtros estruturados** (álbum, data, categoria, EXIF, número de peito) | 3 | 5 | 5 | 5 | 5 | ✅ **já existe**: reaproveitar e combinar |
| **Cor por região da pessoa** (detector + CIELAB) | 3 | 4 | 5 | 4 | 4 | ✅ **Fase B1** |
| Detector de peças de roupa treinado | 4 | 4 | 2 | 3 | 2 | ⏸ adiar: os conjuntos abertos de moda (ex.: DeepFashion2) costumam ser **não comerciais**, e treinar tem custo |
| **CLIP zero-shot texto ↔ recorte** | 4 | 3 | 4 | 3 | 4 | ✅ **Fase B2** |
| **Similaridade imagem ↔ imagem** (CLIP do recorte) | 4 | 3 | 4 | 3 | 4 | ✅ **Fase B2** (imagem de referência) |
| Reconhecimento facial | 5 | 1 | 3 | 3 | 3 | ⛔ **Fase B3, bloqueada** (F06) |
| APIs de visão pagas (nuvem) | 4 | 2 | 1 | 4 | 5 | ⛔ proibidas pelo briefing |

## 2. Onde cada etapa roda

| Opção | Prós | Contras | Uso |
|---|---|---|---|
| **Navegador do fotógrafo durante o upload** (onnxruntime-web / WebGPU) | Custo zero; a foto não segue um caminho novo; escala com o número de fotógrafos | Desempenho varia por aparelho; o resultado não é confiável (validar no servidor); modelo de 5–30 MB para baixar uma vez | ✅ B1: detecção e cores |
| **Navegador do comprador** | A imagem de referência **não sai do aparelho** | Celulares fracos | ✅ B1: cores da referência |
| Worker (WASM) | Sem infraestrutura nova | 128 MB de memória e limite de CPU; inviável para detector e CLIP em lote | ✅ só para pontuação, SQL e similaridade vetorial |
| Processador auto-hospedado (contêiner com ONNX Runtime) | Qualidade e controle; permite reindexar | Custo de infraestrutura → precisa de aprovação | 🔒 B2 e reindexação; B3 se for aprovado |
| Workers AI / APIs externas | Simples | Terceiro + custo | ⛔ |

**Validação no servidor para atributos enviados pelo navegador do fotógrafo:**

- o fotógrafo precisa ser **dono** da foto (`studio`);
- `albumId` e `photographerId` vêm do banco, **nunca do payload**;
- no máximo 30 pessoas por foto e 4 regiões por pessoa;
- cores dentro do enum, confiança entre 0 e 1, caixas dentro da imagem;
- versão do modelo registrada.

Como a busca é sempre limitada a um álbum, adulterar atributos só afeta o próprio álbum do fotógrafo.

## 3. ADR-F08-01: busca visual em três fases

- **Contexto:** o briefing pede o melhor equilíbrio entre qualidade, privacidade, custo, desempenho e manutenção, sem APIs pagas e sem enviar fotos privadas a terceiros. O deploy roda em Cloudflare Workers + D1 + R2.
- **Decisão:**
  1. **B1 (agora):** filtros existentes + atributos de cor por região da pessoa, calculados no navegador e guardados no D1 com índice por `(album_id, region, color)`. A consulta é SQL.
  2. **B2 (depois de B1 estável e de aprovar o processador):** vetores CLIP dos recortes **sem a cabeça**, num índice binário por álbum no R2 (§4), para texto livre e imagem de referência.
  3. **B3 (bloqueada):** rosto, conforme F06.
- **Consequências:** B1 não tem custo novo e não usa biometria. Fica pior em "tipo de peça" (camisa × regata) e melhor em cor. B2 resolve o tipo de peça, mas exige infraestrutura.
- **Reversão:** cada fase tem sua flag; desligar não exige migração.

## 4. Índice vetorial por álbum (B2)

O D1 não tem extensão vetorial. Usar o Vectorize da Cloudflare é possível, mas é **um produto a mais para aprovar**. A proposta sem custo novo é esta:

| Item | Valor |
|---|---|
| Vetor | CLIP 512-d → **binarizado por sinal** (64 bytes) + cópia **int8** (512 bytes) para reordenar |
| Arquivo | `search-index/<albumId>/<modelVersion>-<rev>.bin` no R2 **privado** |
| Tamanho (10 mil fotos × 3 pessoas) | ≈ 1,9 MB binário + 15 MB int8 (o int8 é lido só para os 200 melhores) |
| Busca | Distância de Hamming com *popcount* em `Uint32Array` (≈ 30 mil × 16 palavras), depois reordenação com int8 |
| Cache | Na memória do isolate, por `(albumId, rev)`. **Não** usar a Cache API, para não expor o índice |
| Meta | p95 < 800 ms, incluindo a leitura do R2 |

O índice por álbum torna a busca entre álbuns **impossível por construção**: não existe arquivo global.

## 5. Termos de texto para vetores (B2) sem modelo de texto em tempo real

O interpretador (F07 §1) gera combinações de um vocabulário **fechado** (12 cores × ~20 peças e acessórios). Os vetores de texto CLIP dessas combinações (≈ 240 frases, por exemplo "a photo of a person wearing a red t-shirt") são **pré-calculados** uma vez e embutidos no deploy como constante. Assim:

- não há modelo de texto no Worker;
- não há chamada externa;
- o comportamento é determinístico e auditável.

## 6. Testes com imagens sintéticas

- **Gerador de cenas:** figuras humanoides simples (retângulos e elipses) com camisa, calça e boné de cores controladas, sobre fundos variados; 0, 1 ou N pessoas; variação de iluminação (ganho por canal entre 0,6 e 1,4) e de tamanho.
- Cada cena vem com um **JSON de verdade de referência** (caixas e cores). O `SyntheticVisionProcessor` usa as caixas do JSON (o detector real não reconhece figuras sintéticas) e aplica o **classificador de cor real** nos pixels.
- Os resultados permitem medir a precisão por cor e a matriz de confusão, e servem de regressão em CI.
- O detector real é avaliado à parte, num **conjunto consentido** da equipe (fotos com termo de uso), nunca em fotos de clientes.
