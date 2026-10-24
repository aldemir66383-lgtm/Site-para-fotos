# Requisitos de integração com o Claude (design)

> A branch do design é `feat/claude-visual-ux`. Este pacote **não altera layout**. Ele entrega contratos ([F10](F10-contratos-api.md)) e uma lógica mínima sem estilo ([F10 §5](F10-contratos-api.md#5-componentes-mínimos-para-o-claude)).

## 1. Telas afetadas

| Tela | Mudança | Contrato |
|---|---|---|
| `/catalogo/:id` (galeria) | Novo bloco "Buscar nesta galeria" com campo de texto, chips de cor/peça e "enviar imagem de referência". O botão de selfie existente **continua desativado** | `capabilities`, `search/clothing`, `search/sessions` |
| `/pedido/:id` (Pix simulado) | Consulta automática usando `payment.pollAfterSeconds`; o aviso "sem dinheiro real" continua obrigatório enquanto `simulated = true` | `GET /orders/:id` |
| `/minhas-fotos/:id` | Mostrar `downloadsLeft` e o motivo de revogação | `GET /orders/:id/deliveries` |
| `/financeiro-teste` | Saldo fictício e "Repasse simulado — nenhum valor foi transferido" | `finance-lab/*` |

## 2. Estados obrigatórios

Seguir o padrão atual `loading | blocked | error | empty | ready` e acrescentar:

| Situação | Texto sugerido (pt-BR) |
|---|---|
| `unrecognizedTerms` não vazio | "Não entendemos: *flamengo*. Tente cores e peças, como 'camisa azul'." |
| `422 no_person` | "Não encontramos uma pessoa nesta imagem. Tente uma foto de corpo inteiro." |
| `422 image_unreadable` / `415` | "Não conseguimos abrir esta imagem. Envie JPG, PNG ou WebP." |
| `413` | "Imagem muito grande. O limite é de 8 MB." |
| `429` | "Muitas buscas seguidas. Tente de novo em *N* s." |
| Resultados vazios | "Nenhuma foto combina. Tente o número de peito ou o horário." |
| Faixa `baixa` | Recolhida por padrão, com o rótulo "Outras possibilidades" |
| Selfie (`selfie: false`) | Manter o modal atual "em preparação" |

## 3. Regras de interface que vêm do servidor

- **Nunca** exibir porcentagem nem pontuação; usar só as faixas `alta`, `media` e `baixa` (F10 §4.3).
- **Nunca** apresentar o resultado como identificação ("é você"). No modo selfie, o `disclaimer` é obrigatório.
- A imagem de referência deve ser processada no navegador quando possível (F07 §4). Mostrar: "Sua imagem não sai do seu aparelho".
- Ao sair da tela de resultados, chamar `DELETE /search/sessions/:id`.
- O link de download é aberto logo depois de recebido, sem ser guardado (F10 §3.6).
- O aviso de laboratório ("LABORATÓRIO · SEM DINHEIRO REAL") não pode ser removido enquanto `simulated = true`.

## 4. Acessibilidade

- Resultados da busca dentro de uma região `aria-live="polite"` com a contagem ("12 fotos encontradas").
- Chips de cor com **nome em texto**, não só a cor, por causa de daltonismo.
- Cancelar a busca é possível pelo teclado (`Esc`) e por um botão visível.
