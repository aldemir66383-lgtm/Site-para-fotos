# Site-para-fotos — FotoViva (Desenvolvedor F01)

Repositório de trabalho do **Desenvolvedor F01** da plataforma FotoViva, um marketplace de fotografias de eventos esportivos e sociais. Este desenvolvedor é responsável por duas áreas:

- **Área A:** pagamentos, pedidos, comissões e entrega após o pagamento. Por enquanto, tudo funciona apenas em simulação.
- **Área B:** busca inteligente de fotografias por roupas e outras características visuais, além da busca por selfie. Esses recursos ficam atrás de feature flags desativadas.

O código-fonte da aplicação fica no repositório privado `pedromatosx/fotoviva`. Enquanto o acesso a esse código não estiver disponível, este repositório guarda a documentação técnica produzida, toda em Markdown.

## Organização de branches

| Branch | Responsável | Conteúdo |
|---|---|---|
| `main` | Integração | Versão integrada e estável |
| `feat/payments-photo-matching` | Desenvolvedor F01 | Pagamentos e busca inteligente (fases F01–F10) |
| `feat/claude-visual-ux` | Claude (design) | Telas e experiência visual |
| `security/codex-hardening` | Codex (segurança) | Auditoria e correções de segurança |

Todas as branches de trabalho partem da `main`. A integração na `main` só acontece por Pull Request e depois da revisão de segurança do Codex.

> **Este repositório é público.** Não envie credenciais, dados reais, fotografias privadas nem dados biométricos.
