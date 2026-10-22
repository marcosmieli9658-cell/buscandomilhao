# Buscando Leads

Sistema comercial local da Blessia Labs para descobrir, qualificar e acompanhar leads no Instagram com CRM auditável, worker durável e handoff seguro entre o navegador e a API oficial da Meta.

O projeto implementa o ciclo:

```text
Observar → Decidir → Agir → Medir → Aprender → Adaptar
```

## Estado atual

Retomado em 22/10/2026 com a configuração comercial da Blessia Labs, Instagram
`@agenciablessialabs`, site `https://blessialabs.com.br` e contato comercial de Marcos.
A prospecção permanece pausada por decisão do operador: pausa geral e fila do navegador
ativas, `DRY_RUN=true` e descoberta diária desativada. O painel pode funcionar sozinho.
A API da Meta reconheceu a conta Blessia Labs, e os dois modelos configurados da OpenAI
responderam ao teste mínimo com dados artificiais. Chrome dedicado, webhook e envio
controlado ainda precisam de validação antes de retomar mensagens. Os registros de
setembro em `SETUP.md` são históricos.

- Dashboard e CRM em PT-BR
- Funis separados de clientes e afiliados
- Funil de afiliados desativado até existir programa verificado
- Descoberta em aba isolada do Chrome por CDP
- Cadastro e mensagens protegidos contra duplicidade
- Primeira DM pelo Chrome dedicado, com modo real ou simulação visíveis no painel
- Webhook Meta com verificação HMAC e idempotência
- Gateway público restrito ao webhook e túnel HTTPS com fallback automático entre provedores
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
src/features                 regras de leads e experimentos
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
