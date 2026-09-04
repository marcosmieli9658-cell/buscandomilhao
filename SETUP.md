# Configuração do operador

Este sistema roda localmente. O banco, a sessão do Chrome e as credenciais permanecem na máquina do operador.

## Situação da configuração — 03/09/2026

- Chave restrita da OpenAI criada no projeto `UpScale Instagram Sales Agent`, salva no `.env` local e validada com uma resposta real curta.
- Credenciais locais da Meta preenchidas e validadas sem expor valores: app principal, app do produto Instagram, os dois segredos, token de acesso, token de verificação e conta profissional.
- Operação protegida: `DRY_RUN=true`. A fila de navegador está em modo assistido pelo operador; jobs de navegador aguardam sem impedir o processamento de respostas oficiais da API.
- Domínio `agencyupscale.com.br` associado ao portfólio UpScale com autorização específica e confirmado como `Verified` na Meta em 03/09. Apenas um TXT foi adicionado no DNS da Vercel; sua propagação pública foi confirmada e os registros anteriores foram preservados. Não foram atribuídos parceiros ou acessos adicionais.
- O `CNPJ.pdf` já estava anexado nos dois campos de comprovação da Meta; os anexos foram confirmados visualmente, sem novo upload. A conexão empresarial foi comprovada pelo domínio, sem solicitar códigos ao sócio.
- Verificação empresarial aprovada. A Central de Segurança mostra a empresa como `Verificada`.
- App `UpScale Publisher` publicado. Domínio, email, política de privacidade, termos de uso, exclusão de dados, categoria e ícone oficial foram salvos.
- `instagram_business_basic`, `instagram_business_content_publish` e `instagram_business_manage_messages` aparecem como `Pronto para teste`. O token atual leu o perfil e a API de conversas com sucesso, sem retornar conteúdo privado no diagnóstico.
- Webhook HTTPS configurado no produto correto, **Login da empresa no Instagram**. O campo `messages` está assinado no produto e na conta profissional. A rota pública aceita somente `/api/instagram/webhook`; outras rotas ficam inacessíveis.
- Teste real concluído em 03/09: as respostas `Recebi 3` e `Recebi 4` foram entregues novamente pela Meta, validadas com a chave específica do produto, gravadas sem erro e fizeram o handoff `browser → api_active`. A resposta gerada pela IA ficou apenas em `dry_run` e não foi enviada.
- Validação final concluída: lint, TypeScript, 19 testes e build de produção passaram.
- `pnpm dev` inicia painel, worker, gateway restrito e Cloudflare Quick Tunnel. O túnel atual está ativo. Como a URL é temporária, quando ela mudar o callback do produto **Login da empresa no Instagram** precisa ser atualizado pelo navegador antes de receber novas mensagens.
- O painel está em `http://localhost:3000`. Por preferência do operador, os primeiros contatos usam a sessão já aberta do Instagram no navegador controlado pelo Codex; não é necessário manter um segundo Chrome aberto.

### Próxima retomada

1. Manter `pnpm dev` rodando e abrir `http://localhost:3000`.
2. Se o túnel for reiniciado, atualizar pelo navegador o callback do produto **Login da empresa no Instagram** com a nova URL exibida no terminal.
3. Manter `DRY_RUN=true` enquanto revisar leads e textos.
4. Para o primeiro contato, processar a fila pelo Codex usando a sessão já conectada do Instagram no navegador do operador.
5. Depois da resposta do lead, conferir o handoff automático para `api_active`. Só trocar para `DRY_RUN=false` quando houver autorização para respostas reais da API.

O usuário prefere configurar os serviços pelo navegador aberto. Os contatos antigos do cadastro pertencem ao sócio; não solicitar códigos a ele sem combinar. O envio do CNPJ à Meta já foi concluído e a empresa foi verificada.

Para iniciar toda a ferramenta, execute nesta pasta:

```powershell
pnpm dev
```

Não execute uma segunda instância se a primeira ainda estiver ativa. O Cloudflare Quick Tunnel não oferece garantia de disponibilidade. A ferramenta recria a URL e atualiza a assinatura do app principal; o callback do produto Instagram deve acompanhar essa URL. As credenciais não acompanham o commit nem o push; ficam apenas no `.env` desta máquina.

## 1. Requisitos

- Node.js 24 LTS
- pnpm 11 ou superior
- Google Chrome atual
- `cloudflared` instalado e disponível no `PATH`
- Conta profissional do Instagram da UpScale
- Aplicativo da Meta com acesso à conta profissional
- Projeto separado na plataforma da OpenAI

Confirme as versões:

```bash
node --version
pnpm --version
```

## 2. Instalação e execução

```bash
pnpm install
cp .env.example .env
cp config/business.example.json config/business.json
pnpm dev
```

No Windows PowerShell, use `Copy-Item` no lugar de `cp` se necessário. O comando `pnpm dev` inicia painel, worker durável, gateway restrito do webhook e túnel HTTPS. Abra `http://localhost:3000`.

Este repositório da UpScale já possui `config/business.json` preenchido na máquina de operação. O arquivo é privado e ignorado pelo Git.

## 3. Chave da OpenAI

1. Acesse <https://platform.openai.com/api-keys>.
2. Crie um projeto separado para o agente comercial. Não use o projeto padrão.
3. Em Settings, Billing, adicione crédito.
4. Em Settings, Limits, configure um limite mensal rígido.
5. Crie uma chave com permissão `Restricted`, liberando `Responses (/v1/responses): Write` para o motor de conversação.
6. Cole a chave em `OPENAI_API_KEY` no `.env`.

O sistema também consulta `OPENAI_MONTHLY_BUDGET_USD` antes de cada chamada e pausa ao atingir o teto. Esse controle interno complementa, mas não substitui, o limite rígido da plataforma.

Os modelos vêm fixados em snapshots no `.env.example`. Ao trocar um modelo, atualize também os preços auditados em `src/integrations/openai/engine.ts`; um modelo sem preço cadastrado é bloqueado para evitar custo não mensurado.

Se a chave vazar, revogue imediatamente em <https://platform.openai.com/api-keys>, gere outra e atualize o `.env`. Não compartilhe prints da chave.

## 4. Chrome dedicado e Instagram

Nesta instalação, o modo escolhido é **navegador assistido pelo operador**: o Codex usa a sessão do Instagram já aberta no navegador do usuário para o primeiro contato. A fila de navegador permanece pausada com o motivo `operator_assisted_browser`, mas jobs da API continuam sendo processados. Não é necessário abrir outro perfil.

O modo dedicado abaixo continua disponível como alternativa para uma instalação totalmente local e autônoma.

O Chrome 136 ou superior exige um diretório de perfil separado para depuração remota. Não use o perfil pessoal.

### Windows PowerShell

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$PWD\.chrome-profile"
```

### macOS

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$PWD/.chrome-profile"
```

### Linux

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$PWD/.chrome-profile"
```

Na janela dedicada, entre em `instagram.com`, conclua o 2FA e mantenha a sessão somente nesse perfil. Teste a conexão:

```bash
curl http://127.0.0.1:9222/json/version
```

A porta de depuração dá controle total sobre a sessão logada. Mantenha em `127.0.0.1`, nunca em `0.0.0.0`, e não execute em máquina compartilhada. O perfil fica em `.chrome-profile/`, é ignorado pelo Git e usa a proteção de credenciais do Chrome e do sistema operacional. O agente nunca exporta `storageState`.

O worker cria uma aba própria, nunca assume abas do operador, nunca chama `bringToFront()` e fecha a aba ao terminar, inclusive em erro.

## 5. Integração oficial da Meta

A permissão de publicação já usada pela UpScale não implica permissão de mensagens. Confirme no aplicativo da Meta:

- conta profissional do Instagram correta;
- `instagram_business_manage_messages` com acesso suficiente para a conta própria ou aprovado para contas externas;
- assinatura do evento `messages` no app e na conta profissional;
- callback HTTPS público apontando para `/api/instagram/webhook`;
- ID do app em `INSTAGRAM_APP_ID`;
- ID específico do produto em `INSTAGRAM_PRODUCT_APP_ID`;
- token de verificação igual a `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`;
- segredo do aplicativo em `INSTAGRAM_APP_SECRET`;
- segredo específico do produto em `INSTAGRAM_PRODUCT_APP_SECRET`;
- token de acesso em `INSTAGRAM_PAGE_ACCESS_TOKEN`;
- ID da conta profissional em `INSTAGRAM_BUSINESS_ACCOUNT_ID`.

O gateway local expõe somente a rota do webhook. A validação HMAC aceita a chave do produto Instagram e a chave do app principal, pois a Meta usa chaves diferentes conforme a origem do evento. O script do túnel aguarda a URL pública responder, atualiza a assinatura do app principal pela API oficial e mantém o processo ativo. Não exponha o painel local nem a porta de depuração do Chrome.

A API oficial só pode responder a uma pessoa que iniciou ou respondeu a conversa. Por isso, o primeiro contato é feito pelo Chrome dedicado. Depois que o webhook recebe a resposta, a propriedade do canal muda de `browser` para `api` de forma auditável.

## 6. Simulação, dry-run e piloto

O `.env.example` começa com `DRY_RUN=true`. Nessa condição, a camada do navegador abre o perfil e preenche a mensagem, mas não envia. As respostas pela API também são simuladas: ficam registradas como `dry_run`, sem chamada de envio à Meta nem alteração do horário de último envio. A simulação pode consumir OpenAI se o motor de IA for acionado. A pausa geral bloqueia o envio direto pela API, além da fila.

Fluxo recomendado:

1. Rode `pnpm verify`.
2. Inicie Chrome e sistema com `DRY_RUN=true`.
3. Cadastre uma conta de teste controlada pelo operador.
4. Verifique texto, screenshot, fila e timeline.
5. Para o smoke test limitado, altere `DRY_RUN=false`, reinicie e use somente a conta de teste autorizada.
6. Confirme o webhook e o handoff para a API.
7. Comece o piloto com o aquecimento automático de 5 DMs por dia.

Qualquer alerta do Instagram, perda de sessão, erro anormal, duplicidade, opt-out elevado, divergência de canal ou teto de IA pausa a operação.

## 7. Backup e restauração

Criar backup consistente com a API de backup do SQLite:

```bash
pnpm db:backup
```

Para restaurar, pare o painel e o worker e execute:

```bash
pnpm db:restore -- backups/upscale-agent-AAAA-MM-DDTHH-MM-SS.db
```

O script verifica a integridade e mantém uma cópia de segurança do banco anterior ao lado do arquivo de destino.

## 8. Diagnóstico rápido

- `browser_unavailable`: abra o Chrome dedicado e depois retome a fila em Operação e alertas.
- `OPENAI_API_KEY is not configured`: preencha a chave e reinicie o worker.
- webhook recusado: confira token de verificação, assinatura e segredo do app.
- janela expirada: o sistema não contorna pela automação do navegador; o item vai para exceção.
- job esgotada: consulte o erro e os artefatos em `screenshots/<job-id>/`.
