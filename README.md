# Buscando Leads

Sistema comercial local da Blessia Labs para descobrir, qualificar e acompanhar leads no Instagram com CRM auditável, worker durável e handoff seguro entre o navegador e a API oficial da Meta.

O projeto implementa o ciclo:

```text
Observar → Decidir → Agir → Medir → Aprender → Adaptar
```

## Estado atual | 22/10/2026

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
Os envios e a descoberta continuam pausados até autorização específica do operador.

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
