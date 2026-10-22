# Envio assistido de uma mensagem aprovada

O lançador opera um único job e usa o texto persistido da aprovação. Não controla o
navegador, não gera copy e não inicia o worker. O operador usa CUA para conferir a
conta, o destinatário, o histórico e o resultado no Direct.

Na raiz do projeto, usando Node 24:

```text
node --import tsx scripts/operator-assisted-send.ts --approval-id N --version N --job-id N
```

O job precisa estar `pending`, sem tentativas anteriores, com horário vencido e a
mesma aprovação/versão. As duas filas devem estar pausadas e nenhum worker geral
pode estar ativo. O processo usa `DRY_RUN=false` somente no próprio ambiente;
não altera `.env`. As pausas são restauradas logo após a reserva e antes de aguardar
a operação no navegador.

O lançador imprime `requestPath`, `ackPath` e `expiresAt`. Leia o pedido e respeite
o prazo de 240 segundos, limitado pelo horário operacional. Não envie após a
expiração. Os arquivos e capturas permanecem em diretórios locais ignorados pelo Git.

## Confirmação por captura

Todo ACK deve copiar exatamente do pedido estes sete campos:

```json
{
  "approvalId": 2,
  "approvalVersion": 6,
  "jobId": 161,
  "nonce": "COPIAR_DO_PEDIDO",
  "sender": "@agenciablessialabs",
  "recipientHandle": "COPIAR_DO_PEDIDO",
  "bodySha256": "COPIAR_DO_PEDIDO"
}
```

Os IDs acima ilustram o formato; não são uma autorização ou instrução para repetir
uma tentativa passada. Acrescente `threadUrl` (HTTPS do Direct, terminando em `/`),
`proofPath` absoluto para uma captura nova em `screenshots/` ou
`logs/operator-assisted/`, e `confirmedAt` em ISO UTC. Grave o arquivo completo em
um temporário e renomeie para `ackPath`, evitando leitura parcial.

Para sucesso, somente após conferir a mensagem e a ausência de indicação de
envio pendente ou erro, acrescente:

Antes dessa confirmação, reabra a URL exata do Direct ou recarregue a conversa e
aguarde seu conteúdo carregar. A bolha pode aparecer antes de uma recusa tardia.
Confira o painel da conversa correta, sem confundir avisos na lista de outras
conversas com o destinatário atual. Salve a captura com nome único incluindo o nonce;
nunca sobrescreva prova ou ACK de outro pedido. A presença persistida sem erro
comprova o envio observado, não a leitura ou o interesse do destinatário.

```json
{ "outcome": "sent", "confirmedVisible": true }
```

Uma mensagem visível acompanhada de recusa não é sucesso. Para a recusa específica
de novas solicitações já observada neste fluxo, acrescente estes campos, sem
`confirmedVisible`:

```json
{
  "outcome": "blocked",
  "reasonCode": "instagram_new_message_requests_disabled",
  "observedError": "This account can't receive your message because they don't allow new message requests from everyone."
}
```

A captura deve mostrar a recusa, o destinatário e a mensagem correspondente. Esse
campo aceita também a literal em português: `Essa conta não pode receber sua
mensagem porque não aceita novas solicitações de contato de todos.` Registre o
texto no idioma observado, sem traduzi-lo para preencher o ACK. Esse
ACK resulta em mensagem `blocked`, aprovação `rejected` e job `dead_letter`.
Se o lead ainda aguarda a primeira abordagem, seu canal fica `blocked`. Um inbound
ou encaminhamento para atendimento humano recebido durante a conferência mantém
seu estado mais recente; respostas continuam exigindo revisão e aprovação.
Não registra `sent`, não altera `do_not_contact` e não gera nova tentativa.
O histórico bloqueia também outro cadastro com a mesma identidade.

Outros erros, capturas ausentes, identidade divergente, ACK inválido ou expiração
mantêm o resultado incerto para revisão manual. Não reutilize ACK nem reabra jobs.
Após interrupção abrupta, confira o registro `.recovery.json`, o banco e as pausas;
o encerramento forçado do processo pode impedir a finalização do estado do job.
