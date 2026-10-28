# Recebimento do Instagram — Buscando Milhão

## Situação em 28/10/2026

O receptor permanente está ativo na VPS e os dois callbacks da Meta apontam para
ele. O teste técnico vazio foi guardado, sobreviveu ao reinício do receptor e foi
sincronizado com sucesso. O painel e o sincronizador local também foram iniciados.

**Ainda falta concluir a renovação do acesso do Instagram e confirmar uma mensagem
real no CRM.** O teste vazio não substitui essa conferência. Os envios e as respostas
automáticas permaneceram pausados durante a implantação.

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

## Conferência final e problemas

Depois de concluir a autenticação do Instagram, enviar de outra conta uma mensagem
de teste identificável para `@agenciablessialabs` e conferir a entrada no CRM,
mantendo os envios pausados. Essa é a etapa pendente para comprovar o fluxo completo.

Se aparecer um aviso ao abrir, anote o texto do erro. Se o painel abrir, mas a
mensagem não aparecer, confira primeiro se ela está no Direct e informe o horário
do teste. Os registros técnicos ficam em `logs/receiving/`; não é necessário abrir
arquivos de credenciais, recriar o túnel antigo ou liberar envios para corrigir
o recebimento.

Detalhes de manutenção: [documentação do receptor](../deploy/receiver/README.md).
