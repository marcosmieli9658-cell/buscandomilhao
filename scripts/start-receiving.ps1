[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$OpenPanel,
    [switch]$Notify
)

# Receive-only launcher. Never invokes package scripts, workers, tunnels or Chrome.
# -DryRun checks local configuration/processes only; it starts no services or browser.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
$logsRoot = Join-Path $projectRoot 'logs\receiving'
$statePath = Join-Path $logsRoot 'processes.json'
$syncScript = Join-Path $projectRoot 'scripts\sync-inbound.mjs'
$syncConfig = Join-Path $projectRoot '.env.receiver-sync.local'
$nextCli = Join-Path $projectRoot 'node_modules\next\dist\bin\next'
$panelUrl = 'http://127.0.0.1:3000'
$mutex = $null
$lockTaken = $false
$exitCode = 0

function Get-TextHash([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Get-NodeProcesses {
    return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop)
}

function Test-NodeExecutable($Process) {
    return $Process -and $Process.ExecutablePath -and [string]::Equals(
        [IO.Path]::GetFullPath($Process.ExecutablePath), $script:nodePath, [StringComparison]::OrdinalIgnoreCase)
}

function Test-ArgumentPath([string]$CommandLine, [string]$ArgumentPath) {
    $command = $CommandLine.Replace('\', '/')
    $argument = [regex]::Escape($ArgumentPath.Replace('\', '/'))
    return $command -match ('(?i)(?:^|[\s"])' + $argument + '(?:$|[\s"])')
}

function Test-PanelProcess($Process) {
    if (!(Test-NodeExecutable $Process) -or !$Process.CommandLine) { return $false }
    $command = [string]$Process.CommandLine
    if ((Test-ArgumentPath $command $script:nextCli) -and
        (Test-ArgumentPath $command $script:projectRoot) -and
        $command -match '(?i)\b(dev|start)\b') { return $true }
    # Next dev forks start-server.js. Its absolute module path identifies this checkout.
    $root = [regex]::Escape($script:projectRoot.Replace('\', '/'))
    return $command.Replace('\', '/') -match (
        '(?i)(?:^|[\s"])' + $root + '/node_modules/(?:\.pnpm/[^"\s]+/node_modules/)?next/dist/server/lib/start-server\.js(?:$|[\s"])')
}

function Test-SyncProcess($Process) {
    return (Test-NodeExecutable $Process) -and $Process.CommandLine -and
        (Test-ArgumentPath ([string]$Process.CommandLine) $script:syncScript) -and
        $Process.CommandLine -notmatch '(?i)(?:^|\s)--(?:once|help)(?:\s|$)'
}

function Get-PortListeners {
    # Query all listeners so "no match" is distinct from an inventory failure.
    return @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq 3000 })
}

function Get-KnownListener($Processes) {
    $listeners = @(Get-PortListeners)
    if (!$listeners.Count) { return $null }
    if (@($listeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' }).Count) {
        throw 'A porta 3000 nao esta restrita a 127.0.0.1. Nenhum processo foi substituido.'
    }
    $owners = @($listeners.OwningProcess | Sort-Object -Unique)
    if ($owners.Count -ne 1) { throw 'A porta 3000 possui mais de um processo. Inicializacao interrompida.' }
    $owner = @($Processes | Where-Object { $_.ProcessId -eq $owners[0] })
    if ($owner.Count -ne 1 -or !(Test-PanelProcess $owner[0])) {
        throw 'Outro servico ocupa a porta 3000. Feche-o manualmente ou confira o processo antes de tentar novamente.'
    }
    return $owner[0]
}

function Get-ProcessRecord($Process) {
    return [ordered]@{
        pid = [int]$Process.ProcessId
        createdUtc = $Process.CreationDate.ToUniversalTime().ToString('o')
        executablePath = [string]$Process.ExecutablePath
        commandSha256 = Get-TextHash ([string]$Process.CommandLine)
    }
}

function Test-Record($Process, $Record) {
    if (!$Process -or !$Record) { return $false }
    return $Process.ProcessId -eq $Record.pid -and
        $Process.CreationDate.ToUniversalTime().ToString('o') -eq $Record.createdUtc -and
        [string]::Equals($Process.ExecutablePath, $Record.executablePath, [StringComparison]::OrdinalIgnoreCase) -and
        (Get-TextHash ([string]$Process.CommandLine)) -eq $Record.commandSha256
}

function Read-LocalHttp([string]$Path, [int]$MaxCharacters = 524288) {
    $request = [Net.HttpWebRequest]::Create($script:panelUrl + $Path)
    $request.Method = 'GET'
    $request.Proxy = $null
    $request.AllowAutoRedirect = $false
    $request.Timeout = 4000
    $request.ReadWriteTimeout = 4000
    $response = $null
    $reader = $null
    try {
        try { $response = $request.GetResponse() }
        catch [Net.WebException] {
            if (!$_.Exception.Response) { throw }
            $response = $_.Exception.Response
        }
        $reader = [IO.StreamReader]::new($response.GetResponseStream(), [Text.Encoding]::UTF8)
        $characters = New-Object char[] $MaxCharacters
        $count = $reader.ReadBlock($characters, 0, $characters.Length)
        return @{ status = [int]$response.StatusCode; body = [string]::new($characters, 0, $count) }
    }
    finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Close() }
    }
}

function Test-PanelHealth {
    try {
        # Invalid verification GET is read-only and never contains a real token.
        $probe = Read-LocalHttp '/api/instagram/webhook' 8192
        $expected = 'Verifica' + [char]0x00e7 + [char]0x00e3 + 'o do webhook recusada.'
        if ($probe.status -ne 403 -or ($probe.body | ConvertFrom-Json).error -ne $expected) { return $false }
        $page = Read-LocalHttp '/'
        return $page.status -eq 200 -and $page.body.Contains('<title>Buscando Leads | Blessia Labs</title>')
    }
    catch { return $false }
}

function Start-HiddenNode([string]$Name, [string[]]$Arguments) {
    # Arguments are direct executable arguments, never a cmd.exe expression.
    foreach ($argument in $Arguments) {
        if ($argument -match '["\r\n]' -or $argument.EndsWith('\')) { throw 'Argumento de inicializacao invalido.' }
    }
    $argumentLine = ($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    return Start-Process -FilePath $script:nodePath -ArgumentList $argumentLine -WorkingDirectory $script:projectRoot `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $script:logsRoot "$Name-$stamp.out.log") `
        -RedirectStandardError (Join-Path $script:logsRoot "$Name-$stamp.err.log")
}

try {
    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $nodePath = [IO.Path]::GetFullPath($nodeCommand.Source)
    $version = (& $nodePath --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') { throw 'Este projeto precisa do Node.js 24 ja instalado.' }
    foreach ($required in @($nextCli, $syncScript, $syncConfig)) {
        if (!(Test-Path -LiteralPath $required -PathType Leaf)) { throw "Arquivo necessario ausente: $required" }
    }
    # The dummy first argv prevents the imported sync module's CLI guard from running.
    # This checks configuration without printing values or making network requests.
    $preflight = @'
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';
try {
  loadEnvFile(process.argv[3]);
  const { readConfig } = await import(pathToFileURL(process.argv[2]).href);
  const config = readConfig();
  if (config.localUrl !== 'http://127.0.0.1:3000/api/instagram/webhook') throw new Error('local_origin');
  console.log('configuration_ok');
} catch { console.error('receiver_configuration_invalid'); process.exitCode = 1; }
'@
    $validation = (& $nodePath --input-type=module -e $preflight 'launcher-preflight' $syncScript $syncConfig 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $validation -ne 'configuration_ok') {
        throw 'Configuracao de recebimento invalida. Confira .env.receiver-sync.local sem compartilhar o token.'
    }

    if (!$DryRun) {
        $mutex = [Threading.Mutex]::new($false, ('Local\BlessiaReceiving-' + (Get-TextHash $projectRoot.ToLowerInvariant())))
        try { $lockTaken = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $lockTaken = $true }
        if (!$lockTaken) { throw 'Outra abertura do painel ja esta em andamento. Aguarde alguns instantes.' }
    }

    $processes = @(Get-NodeProcesses)
    $listener = Get-KnownListener $processes
    $panelProcesses = @($processes | Where-Object { Test-PanelProcess $_ })
    $syncProcesses = @($processes | Where-Object { Test-SyncProcess $_ })
    if ($syncProcesses.Count -gt 1) { throw 'Ha mais de um sincronizador deste projeto. Nenhum novo processo sera iniciado.' }
    $ambiguousSync = @($processes | Where-Object {
        $_.CommandLine -and $_.CommandLine -match '(?i)(?:^|[\s"])(?:\.?[\\/])?scripts[\\/]sync-inbound\.mjs(?:$|[\s"])'
    })
    if ($ambiguousSync.Count) { throw 'Existe um sincronizador com caminho relativo. Confirme sua pasta e reinicie com caminho absoluto antes de usar este atalho.' }

    $previous = $null
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        try { $previous = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json }
        catch { throw 'O registro local de processos esta invalido. Confira logs\receiving\processes.json.' }
        if ($previous.version -ne 1 -or $previous.projectRoot -ne $projectRoot) { throw 'O registro de processos pertence a outra pasta ou versao.' }
        # A reused PID is never treated as a recorded process without creation/path/command checks.
        foreach ($kind in @('panel', 'sync')) {
            $record = $previous.$kind
            if ($record) {
                $recorded = @($processes | Where-Object { $_.ProcessId -eq $record.pid })
                if ($recorded.Count -and !(Test-Record $recorded[0] $record)) { $previous.$kind = $null }
            }
        }
    }

    if ($DryRun) {
        [ordered]@{
            dryRun = $true; projectRoot = $projectRoot; nodeVersion = $version
            panelAction = $(if ($listener) { 'reuse_after_http_health_check' } elseif ($panelProcesses.Count) { 'wait_existing_panel' } else { 'start_next_dev_loopback' })
            syncAction = $(if ($syncProcesses.Count) { 'reuse_verified_process' } else { 'start_receive_only_sync' })
            panelPid = $(if ($listener) { [int]$listener.ProcessId } else { $null })
            syncPid = $(if ($syncProcesses.Count) { [int]$syncProcesses[0].ProcessId } else { $null })
            configValid = $true; httpHealthChecked = $false; openPanelRequested = [bool]$OpenPanel
            startsWorkers = $false; changesPauses = $false; startsTunnels = $false
        } | ConvertTo-Json
    }
    else {
        [IO.Directory]::CreateDirectory($logsRoot) | Out-Null
        if (!$listener -and !$panelProcesses.Count) {
            $null = Start-HiddenNode 'panel' @($nextCli, 'dev', $projectRoot, '--hostname', '127.0.0.1', '--port', '3000')
        }
        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        $healthy = $false
        do {
            $processes = @(Get-NodeProcesses)
            $listener = Get-KnownListener $processes
            if ($listener -and (Test-PanelHealth)) { $healthy = $true; break }
            Start-Sleep -Milliseconds 750
        } while ([DateTime]::UtcNow -lt $deadline)
        if (!$healthy) { throw 'O painel nao confirmou sua identidade e saude. O sincronizador nao foi iniciado; confira logs\receiving.' }

        # Recheck immediately before launch, after the potentially slow Next compilation.
        $syncProcesses = @(Get-NodeProcesses | Where-Object { Test-SyncProcess $_ })
        if ($syncProcesses.Count -gt 1) { throw 'Foram encontrados sincronizadores duplicados. Nenhum novo processo foi iniciado.' }
        if (!$syncProcesses.Count) {
            $started = Start-HiddenNode 'sync' @($syncScript)
            Start-Sleep -Milliseconds 1200
            $syncProcesses = @(Get-NodeProcesses | Where-Object { $_.ProcessId -eq $started.Id -and (Test-SyncProcess $_) })
            if ($syncProcesses.Count -ne 1) { throw 'O sincronizador encerrou ao iniciar. Confira os logs de recebimento.' }
        }
        $state = [ordered]@{
            version = 1; projectRoot = $projectRoot; updatedUtc = [DateTime]::UtcNow.ToString('o')
            panel = Get-ProcessRecord $listener
            sync = Get-ProcessRecord $syncProcesses[0]
        }
        $temporaryState = Join-Path $logsRoot ('processes-' + [Guid]::NewGuid().ToString('N') + '.tmp')
        [IO.File]::WriteAllText($temporaryState, ($state | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporaryState -Destination $statePath -Force
        Write-Output 'Painel e sincronizador de recebimento ativos. Nenhum envio foi liberado.'
        if ($OpenPanel) { Start-Process -FilePath $panelUrl | Out-Null }
    }
}
catch {
    $exitCode = 1
    $message = $_.Exception.Message
    Write-Error $message -ErrorAction Continue
    if ($Notify -and !$DryRun) {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            [Windows.Forms.MessageBox]::Show($message, 'Painel Blessia Labs', 'OK', 'Error') | Out-Null
        } catch { Write-Warning 'Nao foi possivel abrir o aviso. Execute o script em um PowerShell para conferir o erro.' }
    }
}
finally {
    if ($lockTaken -and $mutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
exit $exitCode
