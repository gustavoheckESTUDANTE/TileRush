param(
    [switch]$ConfigureFirewallOnly
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = $PSCommandPath
$ruleName = 'Tile Rush Arena LAN'
$port = 3001

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Set-LanFirewallRule {
    if (-not (Test-IsAdministrator)) {
        throw 'A configuracao do firewall precisa de permissao de administrador.'
    }

    $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (-not $existingRule) {
        New-NetFirewallRule `
            -DisplayName $ruleName `
            -Direction Inbound `
            -Action Allow `
            -Protocol TCP `
            -LocalPort $port `
            -Profile Domain,Private,Public | Out-Null
    } else {
        $existingRule | Set-NetFirewallRule -Enabled True -Action Allow -Profile Domain,Private,Public | Out-Null
    }
}

function Test-LanFirewallRule {
    try {
        $rules = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction Stop |
            Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }

        foreach ($rule in $rules) {
            $portFilter = $rule | Get-NetFirewallPortFilter
            if ($portFilter.Protocol -eq 'TCP' -and $portFilter.LocalPort -contains "$port") {
                return $true
            }
        }
    } catch {
        return $false
    }

    return $false
}

function Get-PrimaryLanAddress {
    $udp = New-Object System.Net.Sockets.UdpClient
    try {
        $udp.Connect('1.1.1.1', 80)
        $endpoint = [System.Net.IPEndPoint]$udp.Client.LocalEndPoint
        if ($endpoint.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
            return $endpoint.Address.IPAddressToString
        }
    } finally {
        $udp.Dispose()
    }

    return $null
}

if ($ConfigureFirewallOnly) {
    Set-LanFirewallRule
    exit 0
}

try {
    Set-Location -LiteralPath $projectRoot

    Write-Host ''
    Write-Host 'TILE RUSH - INICIANDO JOGO EM LAN' -ForegroundColor White
    Write-Host '---------------------------------' -ForegroundColor DarkGray

    if (-not (Test-LanFirewallRule)) {
        Write-Host 'O Windows pedira permissao para liberar a porta 3001.' -ForegroundColor Yellow

        $firewallProcess = Start-Process `
            -FilePath 'powershell.exe' `
            -Verb RunAs `
            -Wait `
            -PassThru `
            -ArgumentList @(
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', "`"$scriptPath`"",
                '-ConfigureFirewallOnly'
            )

        if ($firewallProcess.ExitCode -ne 0) {
            throw 'A porta 3001 nao foi liberada. Aceite a solicitacao do Windows para permitir conexoes da rede.'
        }
    }

    Write-Host 'Compilando o jogo...' -ForegroundColor Gray
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw 'Nao foi possivel compilar o jogo.'
    }

    $healthUrl = "http://127.0.0.1:$port/health"
    $serverOnline = $false

    try {
        $health = Invoke-WebRequest -UseBasicParsing $healthUrl -TimeoutSec 1
        $serverOnline = $health.StatusCode -eq 200
    } catch {
        $serverOnline = $false
    }

    if (-not $serverOnline) {
        Write-Host 'Iniciando o servidor...' -ForegroundColor Gray
        Start-Process `
            -FilePath 'npm.cmd' `
            -ArgumentList @('start') `
            -WorkingDirectory $projectRoot `
            -WindowStyle Hidden | Out-Null

        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 250
            try {
                $health = Invoke-WebRequest -UseBasicParsing $healthUrl -TimeoutSec 1
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
        throw "O servidor nao iniciou na porta $port."
    }

    $lanAddress = Get-PrimaryLanAddress
    if (-not $lanAddress) {
        throw 'Nao foi possivel identificar o endereco da rede local.'
    }

    $gameUrl = "http://${lanAddress}:$port"

    try {
        $lanHealth = Invoke-WebRequest -UseBasicParsing "$gameUrl/health" -TimeoutSec 3
        if ($lanHealth.StatusCode -ne 200) {
            throw 'Resposta inesperada do servidor.'
        }
    } catch {
        throw "O servidor iniciou, mas nao respondeu pelo endereco LAN $gameUrl."
    }

    Set-Clipboard -Value $gameUrl

    Write-Host ''
    Write-Host 'LINK PARA A MESMA REDE:' -ForegroundColor White
    Write-Host $gameUrl -ForegroundColor Cyan
    Write-Host 'O endereco foi copiado e aberto no navegador.' -ForegroundColor Gray
    Write-Host ''

    Start-Process $gameUrl
    exit 0
} catch {
    Write-Host ''
    Write-Host 'ERRO:' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    exit 1
}
