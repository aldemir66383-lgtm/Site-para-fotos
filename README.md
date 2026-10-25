# Site-para-fotos — Aire Photos

## Busca por selfie e WhatsApp

Busca facial com consentimento específico, índice cifrado por álbum, comparação cosseno e descarte dos buffers da selfie; notificações WhatsApp via Meta após a liquidação, com outbox persistente. O cron de dez minutos limpa uploads órfãos, expira pedidos e remove dados temporários.

Veja [contratos e configuração Aire Photos](docs/aire-photos-selfie-whatsapp.md). Os nomes internos FotoViva foram preservados para compatibilidade; serviços externos exigem suas credenciais e o catálogo facial precisa estar habilitado/indexado.

## Entrega e contabilidade — Fase 4.1

Tickets de uso único (60 s), direitos de 30 dias, originais individuais e ZIP64 por streaming do R2, ledger em partidas dobradas e solicitação de repasse com reserva atômica de saldo. Consulte os [contratos e a integração com o PSP](docs/fase-4-entrega-ledger.md).

## Backend de mídia — Fase 2.1

Este repositório inclui um backend executável para upload direto ao R2 privado, processamento assíncrono com EXIF, OCR de dorsais e prévias WebP com marca d'água. O Worker usa D1 e Queues; o serviço de mídia roda em Node com Sharp/exifr e Google Cloud Vision.

Consulte [contratos, migrações e implantação](docs/fase-2-upload-midia.md). Para validar: `npm ci` e `npm run check`. É necessário configurar Cloudflare, emissor JWT e credenciais do OCR para operação real; o componente de upload existente ainda é uma demonstração.

## Histórico do pacote F01

Repositório de trabalho do **Desenvolvedor F01** da plataforma FotoViva, um marketplace de fotografias de eventos esportivos e sociais. Este desenvolvedor é responsável por duas áreas:

- **Área A:** pagamentos, pedidos, comissões e entrega após o pagamento. Por enquanto, tudo funciona apenas em simulação.
- **Área B:** busca inteligente de fotografias por roupas e outras características visuais, além da busca por selfie. Esses recursos ficam atrás de feature flags desativadas.

A aplicação principal fica no repositório privado `pedromatosx/fotoviva`. Este repositório reúne documentação F01, componentes de referência e o backend de mídia da Fase 2.1; a integração com a aplicação principal deve seguir seus contratos reais de sessão e álbuns.

## Organização de branches

| Branch | Responsável | Conteúdo |
|---|---|---|
| `main` | Integração | Versão integrada e estável |
| `feat/payments-photo-matching` | Desenvolvedor F01 | Pagamentos e busca inteligente (fases F01–F10) |
| `feat/claude-visual-ux` | Claude (design) | Não é mantida neste repositório |
| `security/codex-hardening` | Codex (segurança) | Não é mantida neste repositório |

> **Este repositório é público.** Não envie credenciais, dados reais, fotografias privadas nem dados biométricos.
