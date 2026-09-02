# Configuração do operador

Este sistema roda localmente. O banco, a sessão do Chrome e as credenciais permanecem na máquina do operador.

## Situação da configuração — 02/09/2026

- Chave restrita da OpenAI criada no projeto `UpScale Instagram Sales Agent`, salva no `.env` local e validada com uma resposta real curta.
- Credenciais locais da Meta preenchidas, incluindo o segredo do aplicativo. Isso não significa que a integração de mensagens esteja liberada.
- Operação mantida em pausa geral e `DRY_RUN=true`. Nenhuma mensagem real enviada nesta configuração.
- Pendências na Meta: verificação da empresa, requisitos de publicação (incluindo privacidade e exclusão de dados), callback HTTPS, assinatura dos eventos e teste de recebimento.
- O Chrome dedicado ainda precisa estar conectado para a descoberta pelo navegador.
- Na sessão atual, o painel usa `http://127.0.0.1:3001`, porque outro projeto ocupa a porta 3000. O endereço funciona somente enquanto o processo local estiver rodando.

Para iniciar painel e worker na porta alternativa, execute nesta pasta:

```powershell
pnpm exec concurrently -k -n painel,worker "next dev --hostname 127.0.0.1 --port 3001" "tsx watch src/worker/index.ts"
```

Não execute uma segunda instância do worker se a primeira ainda estiver ativa. As credenciais não acompanham o commit nem o push; ficam apenas no `.env` desta máquina.

## 1. Requisitos

- Node.js 24 LTS
- pnpm 11 ou superior
- Google Chrome atual
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

No Windows PowerShell, use `Copy-Item` no lugar de `cp` se necessário. O comando `pnpm dev` inicia o painel e o worker durável juntos. Abra `http://localhost:3000`.

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
- `instagram_business_manage_messages` aprovada para o fluxo Instagram Login;
- assinatura dos eventos `messages` e `messaging_postbacks`;
- callback HTTPS público apontando para `/api/instagram/webhook`;
- token de verificação igual a `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`;
- segredo do aplicativo em `INSTAGRAM_APP_SECRET`;
- token de acesso em `INSTAGRAM_PAGE_ACCESS_TOKEN`;
- ID da conta profissional em `INSTAGRAM_BUSINESS_ACCOUNT_ID`.

Para desenvolvimento local, exponha somente a rota do webhook por um túnel HTTPS confiável. Não exponha o painel local nem a porta de depuração do Chrome.

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
