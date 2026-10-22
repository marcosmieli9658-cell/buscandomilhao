# Configuração do operador

Este sistema roda localmente. O banco, a sessão do Chrome e as credenciais permanecem na máquina do operador.

## Estado vigente em 22/10/2026

- Marca e configuração comercial atualizadas para Blessia Labs, com site `https://blessialabs.com.br`, Instagram `@agenciablessialabs` e Marcos em Desenvolvimento e Comercial pelo WhatsApp (12) 99678-7273. Yasmin cuida do suporte.
- Prospecção pausada por decisão explícita do operador: pausa geral e fila do navegador ativas no banco, `DRY_RUN=true` e descoberta autônoma desativada. **Sem worker ativo e sem envio de mensagens nesta retomada.** Aprovar um texto não altera nenhuma dessas condições.
- Painel e gateway local estão ativos em `127.0.0.1:3000` e `127.0.0.1:8788`. O Chrome dedicado está conectado por TCP em `127.0.0.1:9222`, e o usuário confirmou `@agenciablessialabs` na janela dedicada.
- Com Node 24 e as dependências locais existentes, abrir apenas o painel com `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000`. O comando `pnpm dev` inicia todos os componentes e não deve ser usado para simples consulta ao CRM.
- A API da Meta confirmou `@agenciablessialabs`, nome Blessia Labs e o mesmo ID configurado. Os dois modelos configurados da OpenAI responderam ao teste mínimo de Responses com dados artificiais e `store=false` (118 tokens no total). A chave não permite listar o catálogo (`api.model.read`), mas a geração foi validada; nenhuma permissão, chave ou modelo foi alterado.
- O receptor e o gateway passaram em **12 verificações locais**: challenge, rejeição de token/assinatura inválidos, payload vazio assinado pelos dois segredos, rota restrita e método não permitido. Nenhum evento de lead foi criado nesses testes.
- A revisão automática rejeitou a iniciação do Cloudflare pelo agente, inclusive após pedido explícito do operador, sem detalhe além de bloqueio por política. **Não contornar por outro provedor, ferramenta ou script.** O arquivo `ABRIR-WEBHOOK-BLESSIA.cmd` foi preparado para execução manual pelo usuário; o agente não o executou.
- O usuário abriu manualmente um novo túnel, `https://watt-yards-fever-recognize.trycloudflare.com`. Os callbacks do app principal (via API) e do produto Instagram (pela interface) foram salvos para `https://watt-yards-fever-recognize.trycloudflare.com/api/instagram/webhook` e confirmados por leitura GET e recarregamento. As **8 verificações públicas passaram**. A URL anterior `stated-bird-ago-future.trycloudflare.com` foi substituída; as evidências anteriores permanecem preservadas.
- **Recebimento real concluído em 22/10 às 10h17min56s BRT.** A mensagem “Teste 2” chegou por nova tentativa às **10h16min49s**, como evento 3/mensagem 39. A mensagem “Teste 3” chegou às **10h17min56s**, em menos de um segundo, como evento 4/mensagem 40. Ambas tiveram assinatura HMAC válida e `processing_error=null`. O lead 1 ficou em `api_active`, proprietário `api`, funil `replied`.
- Os jobs `process_inbound` **156 e 157** estão pendentes com **zero tentativas**. O worker continua ausente, as pausas geral e do navegador estão em `1/1`, `DRY_RUN=true`, descoberta automática desativada e os **3 rascunhos seguem `pending`**. **Zero mensagens outbound novas**; esta validação não aprova textos nem comprova envio de mensagens.
- Contagem após os testes reais: **37 leads, 40 mensagens, 117 jobs, 4 eventos de webhook e 3 exceções**. Evidências: `logs/recepcao-real-confirmada-2026-10-22.json`, `logs/callback-produto-confirmado-2026-10-22-1313.json`, `logs/validacao-publica-callback-principal-2026-10-22-1313.json` e `screenshots/recebimento-confirmado-blessia-2026-10-22.png`.
- O teste sintético anterior da Meta recebeu HMAC válido e HTTP 200, mas `received=0`; esse teste histórico comprovava acesso e assinatura, sem ingestão. A mensagem vista às 09h48 e a ausência inicial no CRM motivaram o diagnóstico. A pendência de recebimento foi encerrada pelos eventos reais registrados acima, mantendo as evidências anteriores.
- Para manter o recebimento, deixar **o computador ligado e conectado à internet**, além da **janela do túnel aberta**; ela pode ser minimizada. Fechar ou reiniciar o túnel pode gerar outra URL. Nesse caso, atualizar ambos os callbacks e repetir a validação. Não foi configurada instalação nem inicialização automática.
- Os 34 leads anteriores foram preservados. **32 contatos com envio registrado estão bloqueados** para novas primeiras abordagens. As **duas tentativas antigas incertas** também estão bloqueadas; seus jobs não foram reabertos nem reenviados. Mensagens manuais fora do banco e mudança de @ sem ID conhecido exigem conferência humana no Direct.
- A revisão individual solicitada pelo usuário foi implementada em `/approvals`. Há **3 rascunhos `pending`**, sem aprovação ou envio. Os cinco exemplos em `docs/ABORDAGENS-PARA-APROVACAO.txt` são referências; não autorizam disparos nem substituem a revisão individual.
- A migração aditiva `drizzle/0001_message_approvals.sql` foi aplicada após o backup `backups/upscale-agent-2026-10-22T12-40-23-557Z.db`. Não removeu dados anteriores. A implementação passou em **57 testes offline**, TypeScript e ESLint focal.
- Backup local após o recebimento confirmado: `backups/upscale-agent-2026-10-22T13-21-04-402Z.db`. Banco e credenciais continuam fora do Git.

### Histórico da recuperação em 22/10

- Às 10h02, a assinatura existente `messages` foi reaplicada uma vez via `POST /me/subscribed_apps`, com HTTP 200 e `success=true`, sem novos campos/permissões. Evidência: `logs/reaplicacao-assinatura-messages-2026-10-22.json`.
- Às 10h05, o túnel anterior retornou HTTP 530 e depois `ENOTFOUND`; não havia processo `cloudflared.exe` ativo. O usuário confirmou que fechou a janela. O horário exato da queda não foi observado. Evidência: `logs/segundo-teste-real-2026-10-22.json`.
- O usuário reabriu a janela às 10h13, gerando a URL vigente. A confirmação real acima substitui o bloqueio anterior. O agente não reiniciou o túnel.

### Revisar as mensagens no painel

1. Abrir <http://127.0.0.1:3000/approvals> e conferir destinatário, canal e motivo.
2. Ler e editar a mensagem. **Salvar** qualquer alteração antes de aprovar; a versão salva é a que poderá ser enviada.
3. Para uma primeira abordagem, abrir o Direct e conferir que nunca enviamos mensagem àquela conta. Só então marcar a confirmação de histórico.
4. **Aprovar cada mensagem** individualmente, ou rejeitar. Troca de destinatário, versão desatualizada, contato anterior ou tentativa incerta impedem a aprovação/envio.
5. A aprovação enfileira somente o texto exato salvo. **Não libera a pausa geral, a fila do navegador, o modo real ou a descoberta.** O recebimento real já foi validado; a retomada dos envios ainda exige decisão separada do usuário.

Primeiras abordagens, respostas pela API e acompanhamentos passam pela revisão humana.
Jobs antigos sem aprovação não podem enviar. Antes da ação externa, a aprovação é
reservada atomicamente; falha ou interrupção fica incerta e exige conferência manual.
`simulated` significa simulação, sem envio; não vira envio real automaticamente e
exige nova revisão. `sending`/`uncertain` não autorizam repetição. A janela de resposta
da API, o opt-out e a identidade do destinatário são conferidos novamente no envio.

## Histórico da configuração em 05/09/2026

Os itens abaixo registram a configuração daquela data. O estado vigente acima prevalece
sobre as referências históricas a modo real, filas liberadas e rotina automática.

- Chave restrita da OpenAI criada no projeto `UpScale Instagram Sales Agent`, salva no `.env` local e validada com uma resposta real curta.
- Credenciais locais da Meta preenchidas e validadas sem expor valores: app principal, app do produto Instagram, os dois segredos, token de acesso, token de verificação e conta profissional.
- Operação real ativada: `DRY_RUN=false`, Chrome dedicado conectado e fila autônoma liberada.
- Rotina diária programada para começar em **07/09/2026**. Executa de segunda a sexta, entre 09:00 e 20:00, com até 50 leads por dia e intervalo fixo de 60 segundos entre primeiras mensagens.
- Dez buscas de segmentos da UpScale em São José dos Campos abastecem a rotina diária. Cada busca coleta no máximo cinco perfis e o cadastro impede duplicidade entre dias.
- Domínio `agencyupscale.com.br` associado ao portfólio UpScale com autorização específica e confirmado como `Verified` na Meta em 03/09. Apenas um TXT foi adicionado no DNS da Vercel; sua propagação pública foi confirmada e os registros anteriores foram preservados. Não foram atribuídos parceiros ou acessos adicionais.
- O `CNPJ.pdf` já estava anexado nos dois campos de comprovação da Meta; os anexos foram confirmados visualmente, sem novo upload. A conexão empresarial foi comprovada pelo domínio, sem solicitar códigos ao sócio.
- Verificação empresarial aprovada. A Central de Segurança mostra a empresa como `Verificada`.
- App `UpScale Publisher` publicado. Domínio, email, política de privacidade, termos de uso, exclusão de dados, categoria e ícone oficial foram salvos.
- `instagram_business_basic`, `instagram_business_content_publish` e `instagram_business_manage_messages` aparecem como `Pronto para teste`. O token atual leu o perfil e a API de conversas com sucesso, sem retornar conteúdo privado no diagnóstico.
- Webhook HTTPS configurado no produto correto, **Login da empresa no Instagram**. O campo `messages` está assinado no produto e na conta profissional. A rota pública aceita somente `/api/instagram/webhook`; outras rotas ficam inacessíveis.
- Teste real concluído em 03/09: as respostas `Recebi 3` e `Recebi 4` foram entregues novamente pela Meta, validadas com a chave específica do produto, gravadas sem erro e fizeram o handoff `browser → api_active`. A resposta gerada pela IA ficou apenas em `dry_run` e não foi enviada.
- Validação final concluída: lint, TypeScript, 23 testes e build de produção passaram.
- `pnpm dev` inicia painel, worker, gateway restrito e túnel HTTPS. O inicializador usa `localhost.run` e mantém o Cloudflare Quick Tunnel como alternativa. Como a URL é temporária, quando ela mudar o callback do produto **Login da empresa no Instagram** precisa ser atualizado pelo navegador antes de receber novas mensagens.
- O painel está em `http://localhost:3000`. Os primeiros contatos usam o Chrome dedicado conectado em `127.0.0.1:9222`.

### Operação a partir de segunda-feira

1. Manter o computador, o Chrome dedicado e `pnpm dev` ativos.
2. Às 09:00, a partir de 07/09/2026, o worker cria a fila diária automaticamente nos dias úteis.
3. Acompanhar leads, respostas, encaminhamentos e exceções no painel.
4. Quando uma operação de envio for novamente autorizada e o lead escolher WhatsApp, o destino comercial atual é Marcos, (12) 99678-7273.
5. Se o túnel reiniciar, confirmar que o callback do produto **Login da empresa no Instagram** acompanha a nova URL.

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
- OpenSSH do Windows e `cloudflared` disponíveis no `PATH`
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

No Windows PowerShell, use `Copy-Item` no lugar de `cp` se necessário. O comando `pnpm dev` inicia painel, worker durável, gateway restrito do webhook e túnel HTTPS com troca automática de provedor quando necessário. Abra `http://localhost:3000`.

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
7. Defina o limite diário, os dias e o intervalo aprovados pelo operador antes de iniciar.

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
