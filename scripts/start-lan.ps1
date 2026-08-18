$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = $PSCommandPath
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdministrator) {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', "`"$scriptPath`""
    )
    exit 0
}

Set-Location -LiteralPath $projectRoot

$ruleName = 'Tile Rush Arena LAN'
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existingRule) {
    New-NetFirewallRule `
        -DisplayName $ruleName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort 3001 `
        -Profile Domain,Private,Public | Out-Null
}

& npm.cmd run build
if ($LASTEXITCODE -ne 0) {
    throw 'Nao foi possivel compilar o jogo.'
}

$serverOnline = $false
try {
    $health = Invoke-WebRequest -UseBasicParsing 'http://localhost:3001/health' -TimeoutSec 1
    $serverOnline = $health.StatusCode -eq 200
} catch {
    $serverOnline = $false
}

if (-not $serverOnline) {
    Start-Process `
        -FilePath 'npm.cmd' `
        -ArgumentList @('start') `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden

    for ($attempt = 0; $attempt -lt 24; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $health = Invoke-WebRequest -UseBasicParsing 'http://localhost:3001/health' -TimeoutSec 1
            if ($health.StatusCode -eq 200) {
                $serverOnline = $true
                break
            }
        } catch {
            $serverOnline = $false
        }
    }
}

if (-not $serverOnline) {
    throw 'O servidor nao iniciou na porta 3001.'
}

$network = Get-NetIPConfiguration | Where-Object {
    $_.IPv4DefaultGateway -and $_.IPv4Address
} | Select-Object -First 1

$lanAddress = $network.IPv4Address.IPAddress
if (-not $lanAddress) {
    throw 'Nao foi possivel identificar o endereco da rede local.'
}

$gameUrl = "http://${lanAddress}:3001"
Set-Clipboard -Value $gameUrl
Start-Process $gameUrl

Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(
    "Jogo aberto em:`n$gameUrl`n`nO endereco ja foi copiado. Envie para quem estiver na mesma rede.",
    'Tile Rush - LAN',
    'OK',
    'Information'
) | Out-Null
