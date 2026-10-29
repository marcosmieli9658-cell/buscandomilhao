# Recebimento do Instagram — Buscando Milhão

## Situação em 29/10/2026

O receptor permanente está ativo na VPS e os dois callbacks da Meta apontam para
ele. O teste técnico vazio foi guardado, sobreviveu ao reinício do receptor e foi
sincronizado com sucesso. O acesso do Instagram foi renovado em 28/10 e validado
para `@agenciablessialabs`, com a assinatura de mensagens ativa.

**O recebimento real foi confirmado em 28/10.** A mensagem própria
“Teste blessia VPS 28/10” chegou como evento 2 na VPS e mensagem 96 no CRM, com o
webhook 10 processado sem erro e confirmação remota após a gravação local. Nenhuma
resposta automática foi enviada. O painel e o sincronizador foram reabertos em
29/10 às 14h29 BRT, com saúde local e sincronização conferidas. Isso não substitui
a aprovação e a conferência individual necessárias para os envios.

**Lote encerrado em 29/10 às 16h19 BRT:** aprovações **52–101**, com **46 envios
confirmados e 4 perfis indisponíveis excluídos sem tentativa (56, 78, 88 e 96)**.
Zero restantes ou duplicidades. Pausas **1/1**, `DRY_RUN=true`, nenhum worker geral
ou resposta automática. Painel e sincronizador estavam ativos no fechamento.
Não repetir o lote. Os seis eventos recebidos de cinco contatos são recepções
genéricas, sem interesse comercial confirmado; os cinco jobs aguardam revisão,
com zero tentativas. Revisar os retornos e aprovar cada resposta antes de enviar.
O cartão/anexo de Seu Dito segue para atendimento humano.

Auditoria: `logs/operator-assisted/batch-final-audit-2026-10-29.json`.
Backup SQLite consistente, ACL privada e `quick_check=ok`:
`backups/upscale-agent-2026-10-29T19-19-39-044Z.db`; relatório
`logs/backup-final-check-2026-10-29T19-19-41-956Z.json`. Esses arquivos são locais,
ignorados pelo Git. A persistência no Direct não comprova leitura ou interesse.

## Como abrir para trabalhar

1. Pressione **Windows + R**, cole o caminho abaixo e pressione **Enter**:

   ```text
   C:\Users\DELL\Documents\blessialabs\projetos\buscandomilhao\ABRIR-PAINEL-BLESSIA.cmd
   ```

2. Aguarde o painel abrir no navegador em `http://127.0.0.1:3000`.
   O primeiro carregamento pode levar cerca de um minuto.
3. O recebimento continua em segundo plano. Abrir o arquivo novamente reutiliza os
   processos reconhecidos; não é necessário abrir várias janelas de terminal.

Esse arquivo inicia somente o painel e a sincronização de recebimento. Não libera
prospecção, mensagens ou respostas automáticas. Essas ações continuam dependendo
das aprovações e do controle de envios do painel.

## Posso fechar o navegador ou desligar o computador?

Pode fechar o navegador: isso não encerra o sincronizador em segundo plano.
Também não é mais necessário manter a antiga janela do Cloudflare aberta.

Se o computador desligar, reiniciar ou perder a conexão, os eventos que a Meta
entregar ao receptor ficam guardados na VPS. Quando voltar, abra o arquivo acima
para retomar a sincronização. **Não foi configurado início automático com o Windows.**
Uma mensagem só sai da fila pendente depois de o CRM confirmar seu processamento.

A fila cobre eventos entregues ao receptor. Ela não recupera automaticamente
mensagens antigas que nunca chegaram a ele, e depende de a VPS continuar disponível.

## Conferência e problemas

O fluxo completo foi comprovado pelo teste de 28/10, registrado em
`logs/recebimento-real-vps-2026-10-28.json`. A reabertura local de 29/10 está em
`logs/receiving-start-audit-2026-10-29.json`. Se uma nova alteração de conexão exigir
teste, usar outra conta para enviar uma mensagem identificável para
`@agenciablessialabs` e conferir a entrada no CRM, mantendo os envios pausados.

Se aparecer um aviso ao abrir, anote o texto do erro. Se o painel abrir, mas a
mensagem não aparecer, confira primeiro se ela está no Direct e informe o horário
do teste. Os registros técnicos ficam em `logs/receiving/`; não é necessário abrir
arquivos de credenciais, recriar o túnel antigo ou liberar envios para corrigir
o recebimento.

Detalhes de manutenção: [documentação do receptor](../deploy/receiver/README.md).
