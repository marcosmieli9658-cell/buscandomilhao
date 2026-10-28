# Receptor permanente de entrada do Buscando Milhão

**Implantado na VPS em 28/10/2026, com os dois callbacks Meta atualizados.**
Este serviço recebe e guarda notificações assinadas na VPS mesmo quando o computador
do CRM está desligado. Não contém worker de vendas, gerador de mensagens, token de
acesso da Página ou função de envio ao Instagram. Requer Node **24** e usa apenas
módulos nativos, incluindo `node:sqlite`.

## Estado verificado em 28/10/2026

- Release ativa: `20261028T134141Z-2388989`, em
  `/opt/buscandomilhao-receiver/releases/`. O serviço
  `blessia-instagram-receiver.service` foi confirmado ativo e habilitado no boot,
  escutando apenas em `127.0.0.1:8790`. Nginx e health local passaram.
- Callback permanente, principal e do produto Instagram:
  `https://blessialabs.com.br/api/buscando-milhao/webhook`. O principal foi
  reconfirmado pela API; o callback do produto foi atualizado na interface Meta.
- A inicialização pelo symlink `current/` foi corrigida: o guard da CLI compara os
  caminhos resolvidos por `realpath`, enquanto importar o módulo permanece sem
  iniciar o serviço. Os **18 testes Node passaram em Windows e Linux**, incluindo
  a regressão dessa inicialização. O runtime continua sendo **Node 24**.
- O verificador público confirmou challenge válido, rejeição de token e assinatura
  inválidos, health não exposto e autenticação da sincronização. O evento técnico
  vazio **ID 1** foi persistido, reencontrado com os mesmos bytes após reiniciar o
  receptor e posteriormente confirmado pelo sincronizador após sucesso do webhook
  local. Como continha `entry: []`, não criou mensagem nem contato no CRM.
- O inicializador local `scripts/start-receiving.ps1` funcionou às **10:43 BRT**;
  o sincronizador ficou ativo sem worker comercial. O arquivo
  `ABRIR-PAINEL-BLESSIA.cmd` abre painel e recebimento em segundo plano.
  **Não foi configurada inicialização automática no Windows nem atalho no Desktop.**
- **Ainda falta concluir a renovação do acesso do Instagram e testar uma mensagem
  real até o CRM.** O evento técnico vazio não comprova esse recebimento real.
  A ativação do receptor não liberou envios nem respostas automáticas.

Evidências locais, ignoradas pelo Git: `logs/receiver-vps-v2-apply-2026-10-28.txt`,
`logs/receiver-vps-v2-postcheck-2026-10-28.txt`,
`logs/receiver-vps-v2-tests-plan-2026-10-28.txt`,
`logs/permanent-callback-main-2026-10-28.json` e
`logs/receiver-verification-2026-10-28T13-42-*.jsonl`.
O procedimento diário está em [RECEBIMENTO-PERMANENTE.md](../../docs/RECEBIMENTO-PERMANENTE.md).

## Fluxo e durabilidade

1. A Meta envia bytes JSON e `X-Hub-Signature-256` ao callback HTTPS.
2. O receptor aceita HMAC SHA256 válido com o App Secret principal **ou** o App Secret
   do produto Instagram. Valida UTF-8, JSON e envelope `instagram`/`page` com `entry`.
3. Persiste bytes originais, assinatura, SHA256 e data em SQLite WAL,
   `synchronous=FULL`. Só responde **200 depois do commit síncrono**. Erro de
   armazenamento responde 503, permitindo nova tentativa da Meta.
4. O sincronizador local autenticado consulta os pendentes e repassa os bytes e a
   assinatura original ao webhook local. Não executa nem libera jobs de envio.
5. **Somente após processamento local bem-sucedido**, o sincronizador confirma o ID.
   Falha, timeout ou desligamento antes do ACK deixam o evento disponível novamente.

A entrega é **pelo menos uma vez**: o CRM precisa deduplicar pelo identificador da
mensagem e reconhecer como duplicado apenas um evento já processado com sucesso.
Este receptor deduplica o payload bruto pelo SHA256, inclusive depois do ACK e de
reiniciar. Repetições HTTP têm 200 com `duplicate:true`. ACK marca `acked_at`; nunca
apaga a linha automaticamente. Não há job automático de retenção ou expurgo.

## Contrato HTTP exato

Todas as respostas usam `Cache-Control: no-store`. Rotas desconhecidas retornam 404;
métodos incompatíveis retornam 405. O serviço escuta somente **127.0.0.1:8790**.

### Público: `GET /webhook`

Query `hub.mode=subscribe`, `hub.verify_token` e `hub.challenge`. Token comparado
sem revelar comprimento e com `timingSafeEqual` sobre hashes de tamanho fixo.
Sucesso retorna o texto exato do desafio com 200; falha 403. Desafio limitado a 1KiB.
Não colocar tokens na URL de ferramentas de monitoramento nem em logs.

### Público: `POST /webhook`

Header `X-Hub-Signature-256: sha256=<64 hex>`. Corpo limitado a **2MiB**, incluindo
transferência chunked. Sucesso: `{ "ok": true, "duplicate": false }` ou `true`.
Assinatura inválida: 401; JSON/envelope inválido: 400; tamanho excedido: 413;
falha transitória de persistência: 503. Nenhum conteúdo do payload entra nos logs.

### Autenticado: `GET /sync/events?limit=25&afterId=0`

Header **`Authorization: Bearer RECEIVER_SYNC_TOKEN`**. Credencial ausente/incorreta
retorna 401. O token deve ser independente dos segredos Meta, aleatório, sem espaços,
com pelo menos 32 bytes. Não aceitar token por query string.

`limit` aceita inteiros de 1 a 100, padrão 25. O lote também é limitado a **8MiB de
bytes originais**, portanto pode conter menos itens do que o limite solicitado.
`afterId` é opcional, inteiro seguro não negativo, padrão 0. Retorna somente IDs
maiores que o cursor. O consumidor pode avançar mesmo quando um evento falha, para
não bloquear eventos posteriores; ao terminar a rodada, reinicia o cursor em 0 e
repete os pendentes. Avançar o cursor não confirma nem remove eventos.

```json
{
  "events": [{
    "id": 1,
    "bodyBase64": "BASE64_DOS_BYTES_ORIGINAIS",
    "signature": "sha256=ASSINATURA_ORIGINAL",
    "sha256": "HASH_SHA256_HEXADECIMAL_DOS_BYTES",
    "receivedAt": "2026-10-28T15:00:00.000Z"
  }],
  "hasMore": false
}
```

IDs são números inteiros positivos. Eventos sem ACK vêm em ordem crescente de ID.
A consulta não muda seu estado. Reconstruir `Buffer.from(bodyBase64, "base64")`,
conferir o SHA256 e enviar esses mesmos bytes ao webhook local com a assinatura.
Não decodificar e serializar novamente o JSON antes de repassar, pois isso muda HMAC.

### Autenticado: `POST /sync/ack`

Mesmo bearer; corpo JSON `{ "ids": [1, 2] }`, de 1 a 100 IDs, limite 16KiB.
IDs repetidos são normalizados. Confirmação atômica: se qualquer ID não existir,
retorna 409 `unknown_event_id` e não confirma nenhum. Formato inválido retorna 400.

```json
{ "ok": true, "ackedIds": [1], "alreadyAckedIds": [2] }
```

Repetir um ACK é seguro. **Não confirmar apenas porque o HTTP local retornou 200**:
o sincronizador deve exigir o resultado de processamento local `{ok:true}` sem
falhas parciais, segundo o contrato do handler do CRM.

### Somente local: `GET /healthz`

Retorna `{ "ok": true }` depois de uma consulta SQLite simples. Não informa
credenciais, eventos, contagens ou caminhos. O exemplo Nginx bloqueia sua exposição.

## Arquivos e preparação da VPS

Em novas instalações ou atualizações, conferir a distribuição, a localização do
Node 24 e as regras do Nginx antes de executar o instalador. A implantação de
28/10/2026 já executou os testes e verificações na VPS; o script continua exigindo
`--apply` para instalar e não modifica callbacks Meta por conta própria.

- `receiver.mjs`: serviço e factory `createReceiver(config)` para testes.
- `blessia-instagram-receiver.service`: unidade com usuário dedicado, isolamento,
  acesso de rede só ao loopback, sem capabilities, estado com permissão 0700 e
  máscara 0077. O instalador seleciona Node 24 em `/opt/bravio-node/bin/node`,
  `/usr/bin/node` ou `/usr/local/bin/node`, nessa ordem, e ajusta a unidade.
- `receiver.env.example`: **somente nomes e placeholders**, nunca credenciais reais.
- `nginx-locations.example.conf`: fragmento a integrar ao vhost HTTPS escolhido.
  Não substitui o vhost do site, do Hub ou do e-mail. Preserva o prefixo externo
  `/api/buscando-milhao/`; a URL base do sincronizador deve incluir esse prefixo.
- `prepare-nginx.mjs`: parser conservador que prepara uma cópia do vhost com um
  único include no servidor TLS de `blessialabs.com.br`; preserva todo o texto
  original. Aborta em configuração ambígua ou diferente da estrutura esperada.
- `deploy-receiver.sh`: plano por padrão, instalação explícita e rollback.

Layout implantado:

```text
/opt/buscandomilhao-receiver/releases/<id>/receiver.mjs   root:root 0644
/opt/buscandomilhao-receiver/current                     symlink da release ativa
/etc/blessia-instagram-receiver.env                      root:root 0600
/var/lib/blessia-instagram-receiver/                     blessia-receiver 0700
/var/lib/blessia-instagram-receiver/events.sqlite        blessia-receiver 0600
/var/backups/blessia-instagram-receiver/<id>/             root:root 0700
```

Criar o usuário de sistema `blessia-receiver`, sem login e sem home. A unidade usa
`StateDirectory` para o diretório de dados, fora de qualquer webroot. O serviço
também aplica 0700/0600 no diretório dedicado, banco e arquivos WAL/SHM no Linux.
**Nunca configurar `RECEIVER_DB_PATH` dentro de um diretório compartilhado**: a factory
restringe a permissão do diretório pai para proteger os eventos.

Provisionar com cuidado somente os dois App Secrets existentes, o verify token e
um **novo** segredo de sincronização independente. Não copiar `.env` inteiro do CRM.
O token de sincronização concede leitura e confirmação dos eventos da fila;
guardá-lo no cliente local em configuração ignorada pelo Git. Nenhuma credencial
de saída Instagram deve existir na VPS deste receptor.

O Nginx precisa oferecer TLS válido. O fragmento desativa access log e error log
na rota de verificação, porque erros de upstream podem registrar a query contendo
o verify token. O serviço emite somente nomes de eventos e status HTTP, sem URLs,
headers, corpos ou detalhes de exceções. Conferir também logs externos do proxy.

## Plano, instalação e rollback

Transferir esta pasta para a VPS por um canal autorizado, sem incluir os segredos
na transferência do código. O alvo fixo do instalador é
`/etc/nginx/sites-available/blessialabs.com.br.conf`, habilitado exatamente uma vez.
Ele só acrescenta `include /etc/nginx/snippets/blessia-buscando-milhao.conf;` dentro
do bloco TLS do domínio principal com conteúdo e rota Resend. Os blocos HTTP e
`www`, os certificados, o root do site e a rota Resend são preservados.

```sh
sudo bash deploy-receiver.sh --plan
```

O plano verifica Node 24 e Nginx, mostra o diff do vhost e não muda serviço, fila,
vhost ou Meta. Cria somente um lock e um diretório temporário, removido ao sair.
Revisar também `nginx-locations.example.conf` e a unidade. O parser não tenta
adivinhar layouts diferentes: se ele recusar, preparar e revisar manualmente o
include no bloco correto antes de continuar, sem substituir o vhost completo.

Provisionar `/etc/blessia-instagram-receiver.env` como `root:root`, modo 0600, com
**exatamente as quatro variáveis** de `receiver.env.example`, usando os valores
existentes para a Meta e um segredo novo para sincronização. Não usar `source` nem
colar valores em comandos que serão registrados. O instalador rejeita placeholders,
variáveis extras e token de sincronização fraco ou reaproveitado.

```sh
sudo bash deploy-receiver.sh --apply
```

O instalador exige root/sudo, cria usuário sem login e uma nova release, executa os
testes com SQLite temporário, guarda backups do vhost/unidade/snippet, troca o
symlink e valida `systemd-analyze verify` e `nginx -t`. Só depois reinicia o receptor,
confere health local e recarrega Nginx. Ativa no boot **somente o receptor**, sem
iniciar sincronizador, worker comercial, envios ou respostas automáticas. Não muda
callbacks Meta, DNS, tokens de saída nem Resend.

Uma falha durante a ativação tenta restaurar a configuração anterior. A saída
informa o backup exato e o comando para rollback explícito:

```sh
sudo bash deploy-receiver.sh --rollback /var/backups/blessia-instagram-receiver/ID_EXATO
```

O rollback recusa sobrescrever alterações posteriores no vhost, unidade, snippet
ou symlink. Restaura o estado anterior do serviço e valida Nginx antes de recarregar.
Não apaga fila SQLite, segredos, backups ou releases. Se for interrompido ou houver
mudanças concorrentes, exige revisão manual; não se deve forçar a sobrescrita.

Cada nova implantação precisa ser validada no Linux da VPS; a verificação local de
sintaxe Bash e os testes Node não substituem `systemd-analyze verify`, `nginx -t`,
health, TLS, teste HMAC e recebimento real. Na implantação de 28/10, as verificações
técnicas passaram; o recebimento real continua pendente conforme o estado acima.

## Validação antes do corte

```text
node --test deploy/receiver/receiver.test.mjs deploy/receiver/prepare-nginx.test.mjs
```

Testes cobrem ambos os segredos HMAC, bytes originais, rejeição de UTF-8/JSON inválido,
limite chunked, consulta repetível, persistência antes de 200 e após reinício,
falha de armazenamento, autenticação, ACK atômico/idempotente, retenção após ACK,
limite de bytes por lote e cursor que permite ultrapassar eventos com falha. O
parser é testado para preservação de TLS/site/Resend, idempotência e rejeição de
ambiguidades. Usam bancos temporários apenas neste diretório; nenhum teste toca o
CRM operacional.

Em uma nova instalação autorizada na VPS, conferir `systemd-analyze verify`, `nginx -t`,
health local, TLS e rotas; usar payload sintético assinado e verificar a persistência
e a sincronização local antes de alterar callbacks. Não liberar vendas ou respostas
automáticas como efeito de ativar recepção. Conferir recebimento real separadamente.

## Verificador e inicialização local

O utilitário `scripts/verify-receiver.mjs` usa apenas as credenciais de recepção
permitidas e grava relatórios sanitizados e datados em `logs/`. Não chama rotas de
envio, não inicia worker e **nunca envia ACK**.

```text
node scripts/verify-receiver.mjs --check
```

Esse é também o modo padrão: faz as checagens de leitura e um POST inválido `{}`
para comprovar a rejeição de assinatura. Não grava um evento válido. Para testar
durabilidade em uma manutenção controlada, manter a sincronização local parada:

```text
node scripts/verify-receiver.mjs --probe
```

`--probe` acrescenta exatamente um JSON assinado com `object: "instagram"`,
`entry: []` e um `verification_id` técnico com UUID; sem mensagem, remetente ou
destinatário. Confere bytes, hash e assinatura na fila, deixando o evento pendente.
Depois de reiniciar o receptor, conferir o UUID informado pelo comando anterior:

```text
node scripts/verify-receiver.mjs --check --probe-id UUID_INFORMADO
```

Essa última consulta não grava outro evento. Só depois de comprovar a persistência,
iniciar o recebimento local: o sincronizador repassa o evento vazio ao CRM e confirma
o ID após o resultado bem-sucedido. Se a sincronização já o confirmou, a consulta por
UUID informa que ele não está pendente; não interpretar isso isoladamente como perda.

Para uso diário, executar `ABRIR-PAINEL-BLESSIA.cmd` na raiz da ferramenta. Ele chama
`scripts/start-receiving.ps1`, que valida configuração, identidade dos processos e
saúde do painel antes de iniciar ou reaproveitar o sincronizador. O painel escuta
em `http://127.0.0.1:3000`; ambos rodam em segundo plano, com registros em
`logs/receiving/`. O inicializador não executa scripts gerais do pacote, túneis ou
worker, nem altera pausas. Sua opção `-DryRun` só inspeciona o estado local, sem
iniciar processos. O Windows não os inicia automaticamente ao entrar na conta;
abrir o arquivo novamente após reiniciar o computador.

## Operação, backup e limites

Quando o computador estiver desligado, novos eventos permanecem na VPS. Ao voltar,
o sincronizador consome os pendentes; o CRM mantém suas próprias pausas e aprovações.
O receptor não busca retroativamente mensagens que a Meta nunca entregou.

Monitorar disco e serviço. Como não há expurgo automático, o banco cresce. Usar
backup consistente via SQLite (online backup ou `VACUUM INTO` em manutenção) e não
copiar somente o arquivo principal enquanto WAL estiver ativo. Backups contêm
mensagens privadas e devem manter proteção equivalente. Uma falha da VPS ou disco
cheio ainda interrompe recepção; 503 permite retry, mas não garante que a Meta
repita indefinidamente. As verificações da implantação registram o estado naquele
momento; não constituem monitoramento contínuo ou garantia de disponibilidade.
