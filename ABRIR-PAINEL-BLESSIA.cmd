@echo off
rem Starts only the local panel and receive-only synchronizer. No sales worker.
rem The PowerShell process and its Node helpers remain hidden; errors use a dialog.
start "" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -File "%~dp0scripts\start-receiving.ps1" -OpenPanel -Notify
exit /b
