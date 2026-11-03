# Aire Photos · Acessos e administração

Cliente React/TypeScript com entradas separadas para administração, fotógrafos e compradores, conectado ao Cloudflare Worker deste repositório.

## Executar localmente

Requer Node.js 22.13 ou superior.

```powershell
npm ci
npm run build:web
npm run setup:local
```

Em dois terminais, na raiz do projeto:

```powershell
npm run dev
```

```powershell
npm run dev:web
```

- Frontend: <http://localhost:5173/>
- Administração: <http://localhost:5173/admin/login>
- Fotógrafos: <http://localhost:5173/fotografo/login>
- Cadastro de fotógrafo: <http://localhost:5173/fotografo/cadastro>
- Compradores: <http://localhost:5173/conta>
- Worker e versão compilada: <http://localhost:8787/admin/login>

Use `localhost` em ambos os processos. O Vite encaminha `/api` ao Worker, mantendo cookies no mesmo domínio. O build também pode ser servido diretamente pelo binding `ASSETS` do Worker.

`setup:local` cria um segredo aleatório em `.dev.vars` caso ainda não exista e aplica as migrações **somente** ao banco local isolado em `.wrangler/access-dev`. Não altera bancos remotos. O comando não cria administradores por padrão.

## Administrador

A conta local preparada nesta implementação utiliza uma senha aleatória. As credenciais estão em `.wrangler/access-dev/admin-credentials.json`, arquivo privado ignorado pelo Git. Não envie esse arquivo nem o utilize como configuração de produção.

Para provisionar outra conta administrativa **local**, forneça `AIRE_ADMIN_EMAIL`, `AIRE_ADMIN_NAME` e `AIRE_ADMIN_PASSWORD` no ambiente e execute:

```powershell
npm run admin:create:local
```

O script exige uma senha explícita, nunca a imprime e insere a conta sem alterar contas existentes. Não existe cadastro público de administradores. Não use senhas em argumentos de linha de comando.

## Organização

- `src/web/`: entrada React, rotas, estilos, layout compartilhado e consulta de dados.
- `src/components/auth/`: formulários separados, contexto de sessão e proteção por perfil.
- `src/components/admin/`: visão geral, pedidos, usuários e comissões.
- `src/components/photographer/`: início, acervo e consulta da conta.
- `src/server/auth/`: autenticação nativa e revogação de sessão.
- `src/server/admin/`: endpoints restritos a administradores.
- `src/server/photographer/`: consulta de fotos restrita ao proprietário.

Referência visual utilizada: projeto vizinho `../fotoviva`, incluindo tipografia local DM Sans/Manrope, superfícies claras e destaque laranja. As licenças das fontes estão em `public/fonts/`. O site de corrida específico ainda depende de confirmação do endereço. A consulta pública à Banlek foi bloqueada; a organização dos portais é uma proposta para o Aire Photos, sem alegar reprodução do painel interno da Banlek.

## Sessão e permissões

Os portais têm URLs e layouts diferentes, mas compartilham o cookie HttpOnly e Secure `fv_session`. Eles não mantêm contas simultâneas independentes no mesmo navegador. Nenhum token é salvo em armazenamento do navegador; somente a preferência visual de tema usa `localStorage`.

O servidor verifica perfil, situação atual da conta e revogação. O logout revoga a sessão no banco e apaga o cookie. Mutações por cookie exigem uma origem permitida. O cadastro público aceita apenas `buyer` e `photographer`.

`NATIVE_AUTH_SECRET` deve ter ao menos 32 bytes e não possui valor padrão. A autenticação externa por JWKS continua disponível nos endpoints que já a utilizavam.

## Comissões e histórico financeiro

A migração `0006_access_and_commission_versions.sql` adiciona o nome das regras e o registro de sessões revogadas. Não remove triggers de imutabilidade.

As regras financeiras reais utilizam comissão e taxa percentual em basis points, taxa fixa do provedor em centavos, responsável pelos custos e prazo de retenção em dias. A API administrativa converte os percentuais para o formulário.

Cada salvamento insere uma nova regra com uma nova versão e um novo ID. O checkout seleciona a versão mais recente para novos pedidos; pedidos anteriores continuam vinculados à regra original. A taxa fixa é um custo do provedor, e não uma comissão fixa adicional da plataforma. Retenção percentual não é implementada e não é simulada pela interface.

## Funcionalidades ainda indisponíveis

O fotógrafo pode entrar, se cadastrar, consultar seu perfil e listar suas próprias fotos. O upload e a consulta de vendas aparecem identificados como indisponíveis. O componente antigo `MassUpload` simula envio; por isso ele não é apresentado como funcionalidade real. Publicação requer integração com álbuns e configuração válida de R2/processamento.

Pedidos e usuários oferecem consulta e filtros sobre os registros retornados (50 pedidos e 100 usuários). Não há alteração de papéis, suspensão, exclusão ou paginação de servidor inventadas pela interface.

## Verificação

```powershell
npm run check
npm run build:web
npm run setup:local -- --test-accounts
npm run test:e2e
```

Os testes de navegador usam o Worker e o D1 locais reais, sem simular as respostas das APIs. Contas aleatórias de teste são gravadas apenas em `.wrangler/access-dev/test-accounts.json`; comissões criadas pelos testes afetam somente esse banco local. No Windows, Playwright usa o Edge instalado; em outros sistemas, instale o Chromium do Playwright.

Capturas de validação ficam em `.wrangler/access-dev/` e traces de falha em `.wrangler/access-dev/test-results/`.

## Antes de uma publicação autorizada

Esta implementação não foi publicada. A configuração atual ainda contém IDs e URLs de exemplo do Cloudflare e do serviço de mídia.

Para um ambiente real, configure os bindings e domínios corretos, aplique as migrações ao D1 correspondente, defina `NATIVE_AUTH_SECRET` como segredo do Worker e provisione a conta administrativa por um canal privado autorizado. Não envie `.dev.vars`, credenciais de teste ou o banco local. Configure também limitação de tentativas de login no Cloudflare antes de abrir o acesso público.
