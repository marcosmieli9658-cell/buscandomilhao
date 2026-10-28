# Buscando Leads

Sistema comercial local da Blessia Labs para descobrir, qualificar e acompanhar leads no Instagram com CRM auditável, worker durável e handoff seguro entre o navegador e a API oficial da Meta.

**Retomada de 28/10/2026:** há 50 novos textos autorizados, IDs 52–101, aguardando
conexão e conferência individual do Direct. O recebimento permanente na VPS está
preparado e testado localmente, mas ainda não foi ativado. Estado e comandos seguros
em [SETUP.md](SETUP.md). Os scripts legados `pnpm dev/start` também iniciam worker e
túnel; não usá-los para abrir somente o painel nesta retomada.

O projeto implementa o ciclo:

```text
Observar → Decidir → Agir → Medir → Aprender → Adaptar
```

## Checkpoint final | 22/10/2026, 12h38min07s BRT

**Lote concluído e auditoria final aprovada.** No lote autorizado de 48 mensagens
(aprovações **4–51**), o resultado foi **43 enviadas, 4 recusadas pela plataforma
(13, 36, 42 e 49) e 1 perfil indisponível (16), sem tentativa nesse perfil**.
Somando DQ e Le Palmier, tratados separadamente, são **50 contatos avaliados,
49 tentativas reais, 43 envios confirmados na auditoria, 6 recusas e 1 indisponível**.
Não há aprovação pendente, resultado incerto ou duplicidade dentro desse escopo.

- Pausas geral/navegador em **1/1**, `DRY_RUN=true` persistente, descoberta
  desativada e worker geral ausente. O lote não deve ser executado novamente.
- Chegaram **5 retornos reais**, dos leads **48, 58, 68, 74 e 80**, além dos dois
  testes anteriores. Os jobs **156, 157, 173, 183, 194, 201 e 208** continuam
  `pending`, com **zero tentativas**. Nenhuma resposta automática foi enviada;
  o próximo trabalho é revisar os retornos e preparar respostas para aprovação.
- Os vínculos/fontes dos IDs **24, 45, 49, 50 e 51** foram conferidos antes das
  respectivas tentativas. A pendência do checkpoint parcial foi encerrada.
- As recusas tardias de **13 e 36** foram reconciliadas com capturas, AX, backup e
  auditoria, preservando o ACK e os timestamps aparentes originais. O caso **42**
  foi encerrado como bloqueado após expiração sem ACK; **49** usou ACK negativo.
  Nenhum deles conta como envio, opt-out ou autorização para tentar novamente.
- A ponte aceita a recusa literal observada em **português ou inglês**. Antes do
  ACK, reabrir ou recarregar o mesmo thread e conferir corpo, destinatário e
  ausência de erro. Capturas devem ter nome com o **nonce**; ACK e prova são
  vinculados por IDs, versão, destinatário, horário e SHA-256.
- Validação mais recente: **26 testes da ponte**, TypeScript e ESLint focal
  passaram. A bateria focal anterior passou em **56 testes**; são execuções
  distintas, sem somar as contagens ou alegar uma bateria completa posterior.

Evidência final local:
`logs/operator-assisted/batch-audit-2026-10-22T15-38-07-791Z.json`.
Procedimento: [docs/ENVIO-ASSISTIDO.md](docs/ENVIO-ASSISTIDO.md).
Os 32 contatos com envio antigo e as duas tentativas antigas incertas continuam
protegidos contra nova primeira abordagem. Novas mensagens e respostas exigem a
aprovação correspondente; a autorização deste lote foi encerrada com seus resultados.

### Histórico do checkpoint parcial | 22/10/2026, 11h15min57s BRT

Os envios estavam em andamento nesse horário. O registro abaixo documenta aquela
etapa; o checkpoint final acima prevalece e não há item desse lote a continuar.

- O usuário autorizou no chat os **48 textos existentes das aprovações 4–51**,
  respondendo “nem vou revisar, manda bala”. A autorização corresponde aos
  destinatários e textos do manifesto local; não libera novos textos ou contatos.
- O envio é **individual e assistido por CUA**, com conferência do remetente
  `@agenciablessialabs`, do destinatário e do histórico do Direct. O texto e a versão
  aprovados são reservados por um único job. Captura e ACK registram o resultado.
- O **worker geral, as respostas automáticas e a descoberta continuam pausados**.
  As pausas geral e do navegador foram conferidas em `1/1` neste checkpoint. O
  lançador assistido usa modo real somente no próprio processo, sem alterar o
  `.env` nem iniciar o worker; as pausas ficam restauradas durante a ação no Direct.
- O webhook já recebeu mensagens reais, com HMAC válido e persistência no CRM.
  Recebimento ativo não significa resposta automática: os jobs de entrada aguardam.
- **DQ Fisioterapia e Le Palmier foram bloqueados pela recusa do Instagram a novas
  solicitações.** Aprovações 2/3 rejeitadas, jobs 161/158 em `dead_letter`, canais
  `blocked`, sem retry. `do_not_contact=false`: a recusa da plataforma não foi
  registrada como pedido de remoção feito pelo destinatário.
- A identificação da **R9 foi corrigida para `@r9barbeariaoficial_`**, com sublinhado
  final. O registro incorreto foi retido para auditoria, aprovação 1 rejeitada e
  job 160 cancelado. O destinatário correto foi conferido no Direct; aprovação 4
  está `sent`, job 162 concluído, com prova. **Não repetir esse envio.**
- A auditoria do lote encontrou 48 identificadores distintos. Para os outros 47,
  não havia histórico local anterior no checkpoint de 11h12; a API oficial leu 34
  conversas e encontrou apenas a R9 já enviada. Ausência na API não substitui a
  conferência individual do Direct. Os vínculos dos IDs 24, 45, 49, 50 e 51,
  pendentes naquele horário, foram posteriormente confirmados antes das tentativas.

Procedimento: [docs/ENVIO-ASSISTIDO.md](docs/ENVIO-ASSISTIDO.md). Evidências locais:
`logs/manifest-lote48-autorizado-2026-10-22.json`,
`logs/operator-assisted/` e `screenshots/`. Banco, provas e manifesto são locais e
ignorados pelo Git. A autorização não transforma `sending`/`uncertain` em sucesso,
nem autoriza repetição de itens bloqueados ou já enviados.

### Histórico de 22/10: antes da autorização e dos envios assistidos

Os parágrafos abaixo preservam o checkpoint de recebimento. As contagens e a
ausência de envios descritas nele são históricas; o checkpoint final acima prevalece.

A ferramenta está configurada para Blessia Labs, Instagram `@agenciablessialabs`,
site `https://blessialabs.com.br` e contato comercial de Marcos. O Chrome dedicado
está conectado por TCP em loopback, e o usuário confirmou a conta logada
`@agenciablessialabs`.

A operação continua **pausada**: pausa geral e fila do navegador ativas,
`DRY_RUN=true`, descoberta automática desativada e **nenhum worker iniciado**.
Nenhuma mensagem foi enviada nesta retomada.

A revisão individual está implementada em <http://127.0.0.1:3000/approvals>, com
**3 rascunhos pendentes**. O fluxo é salvar o texto, conferir o histórico do Direct
na primeira abordagem e aprovar cada mensagem. Aprovar não despausa a operação.
Respostas e acompanhamentos também exigem aprovação; simulação e envio incerto
não são repetidos automaticamente. Os 32 contatos com envio registrado e as duas
tentativas antigas incertas estão bloqueados para novas primeiras abordagens.

O recebimento real foi confirmado em **22/10/2026 às 10h17min56s BRT**. O usuário
abriu manualmente um novo túnel,
`https://watt-yards-fever-recognize.trycloudflare.com`, e os callbacks do app principal
e do produto Instagram foram salvos e conferidos novamente. As 8 verificações
públicas passaram. A mensagem “Teste 2” chegou por nova tentativa às 10h16min49s; a
“Teste 3” chegou às 10h17min56s, em menos de um segundo, com HMAC válido e sem erro de
processamento. O contato de teste ficou em `api_active`, sob a API, no estado `replied`.

Os dois jobs de processamento continuam pendentes, com zero tentativas. **Nenhum
novo envio foi feito ou validado**, os três rascunhos seguem pendentes, as pausas
continuam ativas e o worker permanece desligado. O banco contém 37 leads, 40 mensagens,
117 jobs, 4 eventos de webhook e 3 exceções.

A URL anterior `stated-bird-ago-future.trycloudflare.com` foi substituída. O bloqueio
da revisão automática à iniciação do túnel pelo agente continua válido e não deve
ser contornado. Para manter o recebimento, deixar o computador ligado e conectado à
internet e a janela de túnel aberta; pode minimizá-la. Ao fechar ou reiniciar o túnel,
a URL pode mudar, exigindo atualizar os dois callbacks e revalidar. Nenhuma instalação
ou inicialização automática foi configurada.

Evidência principal: `logs/recepcao-real-confirmada-2026-10-22.json` e
`screenshots/recebimento-confirmado-blessia-2026-10-22.png`. Os testes sintéticos
anteriores com `received=0` permanecem históricos; a confirmação atual usa mensagens
reais recebidas e gravadas no CRM.

A migração aditiva de aprovações foi aplicada após backup do banco. A versão passou
em **57 testes offline**, TypeScript e ESLint focal. Procedimento, backup e limites
estão em `SETUP.md`; os registros de setembro são históricos.

- Dashboard e CRM em PT-BR
- Funis separados de clientes e afiliados
- Funil de afiliados desativado até existir programa verificado
- Descoberta em aba isolada do Chrome por CDP
- Cadastro e mensagens protegidos contra duplicidade
- Revisão individual em `/approvals`, com edição, aprovação e rejeição do texto exato
- Primeira DM pelo Chrome dedicado, com modo real ou simulação visíveis no painel
- Webhook Meta com verificação HMAC e idempotência
- Gateway público restrito ao webhook; túnel temporário aberto manualmente pelo operador nesta retomada
- Handoff atômico de propriedade navegador → API oficial
- Motor de conversação estruturado com OpenAI
- Afirmações comerciais limitadas ao arquivo de fatos verificados
- Opt-out permanente e imediato
- Limites diários, dias úteis, horário e intervalo entre DMs
- Descoberta diária autônoma, idempotente e configurada por segmentos e cidades
- Jobs duráveis, retry, dead-letter e recuperação após reinício
- Experimentos com atribuição determinística e grupo de controle
- Custo de IA por lead e por cliente ativo
- Auditoria, timeline, fila de exceções e pausa geral
- Backup e restauração do SQLite

## Executar

Para abrir somente o painel local nesta retomada, com as dependências já instaladas:

```powershell
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000
```

Abra <http://127.0.0.1:3000>. Esse comando não inicia worker, gateway nem túnel.
Esse comando não executa o lote autorizado nem inicia a descoberta. Os envios
assistidos seguem o procedimento de um único job; não iniciar o worker geral.

Para uma instalação nova ou uma operação completa autorizada:

```bash
pnpm install
pnpm dev
```

O comando inicia painel, worker, gateway restrito e túnel HTTPS. A URL temporária do webhook é registrada automaticamente no app principal da Meta. No fluxo com Login da empresa no Instagram, confirme também que o callback específico do produto usa a mesma URL. Abra <http://localhost:3000>.

Antes do primeiro uso real, siga o [SETUP.md](SETUP.md). O sistema começa em `DRY_RUN=true`.

## Verificar

```bash
pnpm verify
```

Esse comando executa lint, TypeScript strict, testes e build de produção. Os testes críticos cobrem dedupe, transições, primeira DM, webhook, handoff, trava de envio duplicado, janela da API, opt-out, follow-up, experimentos, recuperação, circuit breaker e orçamento.

## Estrutura

```text
config/business.json         fatos reais e ICP, ignorado pelo Git
src/app                      painel Next.js e webhook
src/features                 regras de leads, aprovações e experimentos
src/integrations/browser     Playwright via CDP
src/integrations/instagram   webhook e API oficial
src/integrations/openai      decisões estruturadas e custo
src/db                       schema e cliente SQLite/Drizzle
src/worker                   fila durável e handlers
drizzle                      migrações versionadas
scripts                      setup, túnel, migração, seed, backup e restore
```

Detalhes técnicos estão em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e as limitações oficiais validadas em [docs/PLATFORM-CONSTRAINTS.md](docs/PLATFORM-CONSTRAINTS.md).

## Segurança operacional

- `.env`, `config/business.json`, banco, perfil do Chrome e artefatos locais não entram no Git.
- A porta CDP deve ficar exclusivamente em `127.0.0.1`.
- O navegador nunca responde depois do handoff para a API.
- API sem permissão, janela encerrada ou webhook indisponível não são contornados pelo navegador.
- Pedidos de remoção encerram permanentemente o contato em todos os canais.
- O smoke test real deve usar uma conta de teste controlada pelo operador.

## Origem

Construído a partir do prompt público [Buscando 1 Milhão](https://github.com/soumatheusgomes/buscandomilhao), adaptado para a operação e para as regras comerciais da Blessia Labs.
