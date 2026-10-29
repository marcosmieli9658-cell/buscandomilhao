# Configuração do operador

O CRM, a sessão do Chrome e a credencial de envio ficam na máquina do operador.
O receptor dedicado na VPS usa somente os segredos de verificação e sincronização.

## Fechamento do lote — 29/10/2026, 16h19 BRT

O usuário autorizou até 50 novos contatos e aprovou os textos das aprovações
**52–101**. O manifesto exato, com destinatários, versões e hashes, está em
`logs/operator-assisted/manifest-authorized-2026-10-28.json`. O lote terminou com
**46 envios confirmados e 4 exclusões sem tentativa**, perfis exatos indisponíveis
**56, 78, 88 e 96**. Zero itens pendentes, aprovados ou em execução no lote;
46 outbounds, sem duplicidade e sem respostas automáticas. Copy e destinatários
foram preservados. Os excluídos não tiveram job, envio, substituição de perfil ou
opt-out permanente. **Não repetir o lote nem retomar pelos itens de checkpoints
parciais.** Novos contatos e respostas precisam da autorização correspondente.

A auditoria final passou: `logs/operator-assisted/batch-final-audit-2026-10-29.json`.
O backup online SQLite `backups/upscale-agent-2026-10-29T19-19-39-044Z.db` passou em
`PRAGMA quick_check`, com ACL exclusiva do usuário atual e SYSTEM. Relatório:
`logs/backup-final-check-2026-10-29T19-19-41-956Z.json`. Banco e provas são locais,
ignorados pelo Git. O esclarecimento posterior da nota operacional do item 53,
sem alterar resultados, está em `logs/backup-final-audit-note-clarification-2026-10-29.json`.

No fechamento, painel **7892** e sincronizador **17776** estavam ativos, home 200,
nenhum worker geral, processo de envio ou job em execução. Pausas **1/1** e
`DRY_RUN=true` permanecem preservados. Evidência:
`logs/runtime-final-check-2026-10-29.json`. A descoberta não foi liberada.

**Receptor permanente ativo e recebimento real confirmado.** A autorização
Instagram invalidada anteriormente foi renovada em 28/10. A API confirmou
`@agenciablessialabs`, conta `25957684903928564`, e a assinatura `messages` ativa.
Os dois callbacks apontam para o endereço fixo da VPS. A credencial fica somente
na configuração local privada; o arquivo temporário usado na instalação foi removido.

Em 28/10, a mensagem própria **“Teste blessia VPS 28/10”** foi recebida na VPS como
evento **2**, às **11:57:07 BRT**, e entrou no CRM como mensagem **96** do lead
`@marcos_mieli`. O webhook **10** foi processado sem erro às **11:57:25 BRT** e o
evento remoto recebeu confirmação às **11:57:27 BRT**. O timestamp original da
Meta foi preservado. Nenhuma resposta automática foi enviada. Evidência:
`logs/recebimento-real-vps-2026-10-28.json`.

Em 29/10, o painel e o sincronizador foram reabertos pelo inicializador de
recebimento, sem worker geral ou túnel. Às **14:29 BRT**, home 200 com identidade
Blessia, consulta de verificação sem token 403 esperada e ciclos de sincronização
sem falhas foram confirmados. Pausas 1/1 e `DRY_RUN=true` permaneceram preservados.
Evidências: `logs/receiving-start-audit-2026-10-29.json` e
`logs/vinculo-meta-2026-10-29.json`. Esses registros comprovam a abertura local;
a conclusão individual dos envios está na auditoria final separada acima.

### Retornos deste lote e próxima ação

Foram recebidos seis eventos de mensagem de cinco contatos: Mercaldo, Seu Dito,
CD World, Cléo e Ribeiro Pneus. São confirmações ou recepções genéricas, sem
interesse comercial confirmado. Os jobs de revisão **231, 235, 241, 249 e 254**
permanecem `pending`, com zero tentativas. O cartão/anexo de Seu Dito exige revisão
humana, com `channel_owner=human`; nenhum link ou anexo foi aberto pelo agente.
Na leitura final, não havia outro retorno novo desses contatos. Revisar o conteúdo,
distinguir eventual interesse real e preparar respostas para aprovação; não
executar a fila nem liberar respostas automáticas. `sent` confirma persistência no
Direct e no CRM, sem comprovar leitura. As capturas incompletas originais de
79/80/82/83 foram preservadas e complementadas sem reenvio; a auditoria registra o caso.

### Recebimento permanente instalado

- [Receptor e implantação](deploy/receiver/README.md): fila SQLite na VPS, assinatura
  Meta, sincronização autenticada e confirmação somente após gravação no CRM.
- Endereço ativo: `https://blessialabs.com.br/api/buscando-milhao/webhook`.
- `scripts/sync-inbound.mjs`: recebe eventos, preserva datas originais e repete
  falhas sem bloquear os eventos seguintes. Anexos entram para revisão humana;
  arquivos não são baixados e nenhuma resposta é enviada automaticamente.
- Configuração local em `.env.receiver-sync.local`, ignorada pelo Git; não
  compartilhar seu conteúdo. Nenhuma credencial de envio acompanha o receptor.
- `ABRIR-PAINEL-BLESSIA.cmd` abre painel e sincronizador em segundo plano, após
  validar os processos e a identidade do painel. A execução real foi validada e
  ambos estão ativos. Não há inicialização automática no login do Windows.
- Para inspecionar o atalho sem iniciar nada:
  `powershell.exe -NoProfile -File scripts/start-receiving.ps1 -DryRun`.
- **Não usar `pnpm dev` ou `pnpm start` nesta retomada:** os scripts legados também
  iniciam worker e túnel. O atalho novo chama somente Next e o sincronizador.

Validação local: 38 testes Node (receptor, configuração Nginx e sincronização),
62 testes Vitest focais, ESLint focal e typecheck do código passaram. O typecheck
global ainda encontra três erros anteriores no auditor operacional ignorado
`logs/operator-assisted/audit-batch-2026-10-22.ts`. O `-DryRun` do atalho reconheceu
o painel existente e a configuração sem iniciar sincronização ou alterar pausas.
Depois, a regressão de inicialização pelo symlink elevou a bateria do receptor e
parser para 18 testes, passados no Windows e Linux. O serviço foi implantado na
release `20261028T134141Z-2388989`, com backup correspondente em
`/var/backups/blessia-instagram-receiver/`. A primeira tentativa falhou no health e
foi revertida automaticamente; a causa foi corrigida no guard de entrada ESM.

Verificação pública passou: token incorreto403, desafio correto200, assinatura
incorreta401, health oculto404 e sincronização autenticada200/sem autenticação401.
O evento técnico vazio ID1, probe `66ee763d-4360-400e-b373-8909417a4f08`, sobreviveu
ao restart e foi sincronizado/confirmado sem criar mensagem no CRM. A fila guarda
os originais após ACK. Não confundir esse teste técnico com mensagem real.
Evidências em `logs/receiver-verification-2026-10-28T13-42-*.jsonl`.

O callback principal foi confirmado por API, preservando `messages` v26.0
(`logs/permanent-callback-main-2026-10-28.json`). O callback do produto Instagram
foi salvo pela UI e conferido após recarregar
(`screenshots/meta-callback-vps-confirmado-2026-10-28.png`). Site200, Hub200 e a
rota de e-mail405 esperada passaram; Resend manteve o processo original na8787.

Histórico de 28/10 às 10h20 BRT: 50 rascunhos pendentes, zero mensagens ou jobs de
envio novos, 135 leads, 95 mensagens, 173 jobs e nove eventos de webhook. Pausas 1/1,
nenhum job em execução e `DRY_RUN=true`. Backup consistente:
`backups/upscale-agent-2026-10-28T13-18-44-663Z.db`; banco e backup passaram em
`PRAGMA quick_check`. Relatório: `logs/checkpoint-receiver-2026-10-28.json`.

A renovação Meta, o teste real de entrada e o lote 52–101 foram concluídos.
As pausas geral/navegador e `DRY_RUN=true` persistente permanecem preservados.
Próximo trabalho: revisar os retornos, sem repetir os envios ou executar respostas
automaticamente. Operação diária:
[RECEBIMENTO-PERMANENTE.md](docs/RECEBIMENTO-PERMANENTE.md).

## Histórico — checkpoint operacional final de 22/10/2026, 12h38min07s BRT

Auditoria final **aprovada**, com prova em
`logs/operator-assisted/batch-audit-2026-10-22T15-38-07-791Z.json`.
Backup final criado após o lote:
`backups/upscale-agent-2026-10-22T15-40-00-304Z.db`.

| Escopo | Enviadas | Recusas | Indisponível sem tentativa | Total |
| --- | ---: | ---: | ---: | ---: |
| Aprovações 4–51, lote autorizado | 43 | 4 (13, 36, 42, 49) | 1 (16) | 48 |
| DQ e Le Palmier, fora desse lote | 0 | 2 | 0 | 2 |
| Operação encerrada | **43** | **6** | **1** | **50** |

Foram **49 tentativas reais**. Não há aprovação pendente, resultado incerto,
mensagem duplicada ou job em execução dentro do escopo auditado. O perfil 16 não
estava disponível e não recebeu tentativa. A identificação incorreta de R9 foi
cancelada antes de envio; a R9 correta integra o lote. **Não reexecutar o lote.**

### Retornos e próxima ação

- Recebidos **5 retornos reais** dos leads **48, 58, 68, 74 e 80**. Os jobs
  `process_inbound` correspondentes são **173, 183, 194, 201 e 208**.
- Os jobs de teste **156 e 157** permanecem separados, ambos do lead 1.
  Os sete jobs estão `pending`, **attempts=0**. Nenhuma resposta automática saiu.
- Revisar os retornos, distinguir os testes e preparar os textos para aprovação.
  Não iniciar o worker geral para processar essa fila como efeito da retomada.
  Aprovar uma resposta não libera pausas; a janela da API e o opt-out devem ser
  verificados novamente no momento de um envio autorizado.
- Pausas geral e do navegador em **1/1**; `DRY_RUN=true` persistente, descoberta
  desativada e worker geral ausente. O recebimento continua pelo túnel manual,
  que exige computador ligado/online e sua janela aberta, mesmo minimizada.

### Evidência e correções concluídas

- Antes de cada tentativa, o Direct foi conferido sob `@agenciablessialabs`.
  Os vínculos/fontes dos IDs **24, 45, 49, 50 e 51** foram confirmados; não restam
  as pendências de fonte do checkpoint parcial.
- Casos **13/36**: a interface primeiro aparentou envio e depois mostrou recusa.
  Reconciliados para `blocked`/`rejected`, com jobs terminais e sem reenvio. ACKs,
  capturas originais, corpos e timestamps anteriores foram preservados em
  metadados/auditoria. Relatórios `late-platform-block-13-applied-2026-10-22.json`
  e `late-platform-block-36-applied-2026-10-22.json`, em `logs/operator-assisted/`.
- Caso **42**: recusado em português, sem ACK, após expiração natural. Resolvido
  por prova em `approval-42-platform-block-applied-2026-10-22.json`. Caso **49**:
  recusado e encerrado diretamente pelo ACK negativo. As recusas mantêm
  `do_not_contact=false`, pois não são pedidos de remoção do destinatário.
- A confirmação do envio da **Hertz (14)** preserva o inbound/API que chegou
  antes do ACK. A reconciliação conservou esse atendimento e o job de resposta
  pendente. O mesmo cuidado foi aplicado ao ramo de recusa: não sobrescrever
  inbound ou atendimento humano mais recente ao encerrar a tentativa.
- Antes de gravar um ACK, **reabrir/recarregar o mesmo thread**, conferir a conta,
  o destinatário, o texto persistido e eventual erro. Uma bolha ou “Message actions”
  isolada não basta. Usar captura com **nonce no nome** e conferir SHA-256; não
  reutilizar caminho de prova. O ACK negativo aceita as literais verificadas em
  **PT e EN**, mantendo o idioma observado, sem tradução fabricada.
- Verificações mais recentes: **26 testes da ponte**, TypeScript e ESLint focal
  passaram. Antes das últimas correções, a bateria focal de ponte/aprovações/
  proteção de primeiro contato passou em **56 testes**. Essas execuções são
  evidências separadas. Procedimento em [docs/ENVIO-ASSISTIDO.md](docs/ENVIO-ASSISTIDO.md).

### Histórico do checkpoint parcial — 22/10/2026, 11h15min57s BRT

O lote ainda estava em execução nesse horário. Este registro foi preservado como
histórico; a conclusão e os contadores vigentes estão no checkpoint final acima.

### Autorização e escopo

- O usuário dispensou a revisão individual dos **48 textos já existentes**,
  aprovações **4–51**, com “nem vou revisar, manda bala”. O manifesto
  `logs/manifest-lote48-autorizado-2026-10-22.json` conserva destinatários, versões,
  corpos exatos e SHA-256. Ele é uma fotografia, não uma fila para executar sem
  reconferir o estado atual.
- A autorização permite esses textos e destinatários. Não libera descoberta,
  respostas automáticas, worker geral, alterações de copy ou contatos adicionais.
- O histórico do Direct é conferido individualmente por CUA antes de aprovar cada
  item no banco. Nenhum contato já abordado, bloqueado ou com resultado incerto
  deve receber uma nova primeira abordagem. Mudança de @ preserva o cuidado com
  identidade e scoped ID; pontuação e sublinhado não são descartados na comparação.

### Execução assistida em vigor

- O lançador `scripts/operator-assisted-send.ts` executa **um único job aprovado**.
  Exige pausas geral e do navegador ativas e ausência de worker geral. Ele usa
  `DRY_RUN=false` apenas no processo, sem alterar `.env`, e restaura as pausas antes
  da espera por CUA. Conferência de banco deste checkpoint: pausas em `1/1`.
- Antes da ação, conferir conta Blessia, destinatário, Direct sem abordagem
  anterior, corpo, versão, hash e prazo do pedido. Registrar captura do resultado
  e ACK correspondente. Procedimento completo em
  [docs/ENVIO-ASSISTIDO.md](docs/ENVIO-ASSISTIDO.md).
- Uma bolha de mensagem acompanhada de erro **não** comprova envio. Não reutilizar
  ACK, reabrir jobs, tratar `uncertain` como sucesso ou repetir por outro canal.
- **Worker geral, respostas automáticas e descoberta permanecem pausados.**
  Webhook e gateway continuam responsáveis pelo recebimento; a confirmação real
  anterior foi às 10h17min56s BRT, com HMAC válido e gravação no CRM. Receber uma
  resposta não dispara automaticamente outra mensagem.

### Casos concluídos e restrições de continuidade

- **R9 incorreta:** `@r9barbeariaoficial` sem sublinhado era outra identidade.
  Aprovação 1 rejeitada, job 160 cancelado sem tentativa, lead 35 em revisão humana.
  O registro foi preservado; não reutilizar sua aprovação.
- **R9 correta:** `@r9barbeariaoficial_`, lead 38, foi conferida no perfil e Direct.
  Aprovação 4 está `sent` v4, job 162 `completed`, mensagem 44 `sent` e canal
  `waiting_inbound_reply`. Provas/ACK em `logs/operator-assisted/approval-4-*`.
  Esse item do lote já terminou; não reenviar.
- **DQ Fisioterapia:** aprovação 2 rejeitada, job 161 `dead_letter`, canal `blocked`.
  **Le Palmier:** aprovação 3 rejeitada, job 158 `dead_letter`, canal `blocked`.
  A interface recusou novas solicitações; não houve confirmação de entrega nem
  retry. Ambos mantêm `do_not_contact=false`, pois não houve pedido de remoção.
  Evidências e encerramento em `logs/operator-assisted/dq-platform-block-applied-2026-10-22.json`
  e `logs/operator-assisted/lepalmier-platform-block-applied-2026-10-22.json`.
- A auditoria de 11h12 encontrou 48 @ distintos, sem duplicidade entre o lote.
  IDs 5–51 não tinham mensagens/tentativas locais anteriores naquele instante.
  A API oficial percorreu 34 conversas e encontrou apenas a R9 recém-enviada.
  Nenhum dos 48 tinha scoped ID cadastrado; essa limitação e a possível ausência
  de mensagens antigas na API mantêm necessária a conferência do Direct.
- **Fontes então pendentes, posteriormente conferidas antes das tentativas:** ID24 `@escolapadrejuliomaria` (identificador
  somente em texto no site); ID45 `@gogirl.comm` (cidade confirmada pelo índice);
  IDs49 `@flordelisspa_sjc`, 50 `@_clinicaluminus` e 51 `@cssaude` (limitação de
  abertura/leitura da fonte). A verificação foi concluída durante o lote.
- Os demais envios prosseguiram e foram encerrados no checkpoint final. Não
  reconstruir a fila nem importar os lotes novamente como contatos novos.

### Histórico: recuperação anterior à autorização dos envios em 22/10

As contagens, três rascunhos e ausência de outbound abaixo pertencem ao checkpoint
anterior. Foram preservados para auditoria; o checkpoint final acima prevalece.

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
5. A aprovação enfileira somente o texto exato salvo. **Não libera a pausa geral, a fila do navegador, o modo real ou a descoberta.** O lote 4–51 autorizado no chat já foi concluído; não o executar novamente. Novos textos/contatos e respostas permanecem sujeitos à aprovação correspondente e ao procedimento de envio autorizado.

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

Nesta retomada, o modo escolhido é **navegador assistido pelo operador**: o Codex usa
CUA para operar a sessão Blessia já aberta e um lançador reserva somente o job
autorizado. A pausa geral e a fila do navegador permanecem ativas entre as etapas;
jobs de respostas pela API não são processados automaticamente. Não iniciar o
worker geral para executar o lote. O procedimento é
[docs/ENVIO-ASSISTIDO.md](docs/ENVIO-ASSISTIDO.md).

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
- ambos os callbacks HTTPS públicos apontando para `https://blessialabs.com.br/api/buscando-milhao/webhook`;
- ID do app em `INSTAGRAM_APP_ID`;
- ID específico do produto em `INSTAGRAM_PRODUCT_APP_ID`;
- token de verificação igual a `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`;
- segredo do aplicativo em `INSTAGRAM_APP_SECRET`;
- segredo específico do produto em `INSTAGRAM_PRODUCT_APP_SECRET`;
- token de acesso em `INSTAGRAM_PAGE_ACCESS_TOKEN`;
- ID da conta profissional em `INSTAGRAM_BUSINESS_ACCOUNT_ID`.

O receptor da VPS valida a assinatura e guarda o evento. O sincronizador local
encaminha os mesmos bytes e assinatura para `http://127.0.0.1:3000/api/instagram/webhook`
e confirma o evento remoto somente após o CRM processá-lo com sucesso. A validação
HMAC aceita as chaves do produto Instagram e do aplicativo principal, conforme a
origem do evento. Painel e depuração do Chrome permanecem restritos ao computador.

**Fluxo legado de túnel:** o gateway local e o script de túnel continuam no código,
mas não são usados com a VPS. O script pode regravar o callback principal com uma
URL temporária; não iniciá-lo na instalação atual.

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
