@echo off
title Webhook publico - Blessia Labs
echo.
echo Este comando abre somente o tunel para o receptor local em 127.0.0.1:8788.
echo Ele nao inicia o worker e nao libera envios de mensagens.
echo Mantenha esta janela aberta. Para encerrar o tunel, pressione Ctrl+C.
echo Envie ao Codex somente o endereco https://...trycloudflare.com que aparecer.
echo.
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --no-autoupdate --protocol http2 --edge-ip-version 4 --url http://127.0.0.1:8788
echo.
echo O tunel foi encerrado. O webhook publico fica indisponivel sem esta janela.
pause
