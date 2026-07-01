# ForexBot watchdog - vigila bridge / MT5 / Laravel / BD y AVISA (Telegram) + dead-man's-switch
# (Healthchecks.io). Independiente del bridge y de Laravel (por eso detecta si mueren).
# Solo DETECCION/aviso (sin auto-restart). Pensado para Task Scheduler cada ~2 min.
# NOTA: script en ASCII a proposito (PowerShell 5.1 sin BOM rompe con caracteres no-ASCII).
#
# Config: lee de bridge\.env (BRIDGE_URL, BRIDGE_API_KEY) y app\.env (HEALTHCHECK_URL,
# TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WATCHDOG_LARAVEL_URL opcional).

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot   # scripts\ esta bajo la raiz del repo

function Get-EnvVal([string]$file, [string]$key) {
    if (-not (Test-Path $file)) { return $null }
    $m = Select-String -Path $file -Pattern "^\s*$key\s*=" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $m) { return $null }
    return ($m.Line -replace "^\s*$key\s*=", '').Trim().Trim('"').Trim("'")
}

$appEnv = Join-Path $root 'app\.env'
$brEnv  = Join-Path $root 'bridge\.env'

$bridgeUrl  = Get-EnvVal $brEnv 'BRIDGE_URL';            if (-not $bridgeUrl)  { $bridgeUrl  = 'http://127.0.0.1:8000' }
$apiKey     = Get-EnvVal $brEnv 'BRIDGE_API_KEY'
$laravelUrl = Get-EnvVal $appEnv 'WATCHDOG_LARAVEL_URL'; if (-not $laravelUrl) { $laravelUrl = 'http://127.0.0.1:8090' }
$hcUrl      = Get-EnvVal $appEnv 'HEALTHCHECK_URL'
$tgToken    = Get-EnvVal $appEnv 'TELEGRAM_BOT_TOKEN'
$tgChat     = Get-EnvVal $appEnv 'TELEGRAM_CHAT_ID'

function Send-Telegram([string]$text) {
    if (-not $tgToken -or -not $tgChat) { return }
    try {
        Invoke-RestMethod -Method Post -TimeoutSec 10 -Uri "https://api.telegram.org/bot$tgToken/sendMessage" `
            -Body @{ chat_id = $tgChat; text = $text; parse_mode = 'HTML' } | Out-Null
    } catch {}
}

$problems = @()

# 1) Bridge vivo (/health es publico, sin API key)
try { Invoke-RestMethod -TimeoutSec 8 -UseBasicParsing -Uri "$bridgeUrl/health" | Out-Null }
catch { $problems += 'Bridge caido (no responde /health)' }

# 2) MT5 conectado (bridge /account con API key devuelve balance)
if ($apiKey) {
    try {
        $acc = Invoke-RestMethod -TimeoutSec 8 -UseBasicParsing -Uri "$bridgeUrl/account" -Headers @{ 'X-API-Key' = $apiKey }
        if ($null -eq $acc.balance) { $problems += 'MT5 sin datos de cuenta (desconectado?)' }
    } catch { $problems += 'MT5 desconectado (bridge /account fallo)' }
}

# 3) Laravel vivo + BD ESCRIBIBLE (/healthz hace un write; detecta "database is locked")
try {
    $hz = Invoke-RestMethod -TimeoutSec 8 -UseBasicParsing -Uri "$laravelUrl/healthz"
    if (-not $hz.ok) { $problems += "BD con problema: $($hz.error)" }
} catch { $problems += 'Laravel caido o BD locked (/healthz fallo)' }

# --- Resultado: ping si sano; si no, NO pinga (Healthchecks alerta por ausencia) + aviso ---
$stateFile = Join-Path $env:TEMP 'forexbot_watchdog_state.txt'
$prev = if (Test-Path $stateFile) { (Get-Content $stateFile -Raw).Trim() } else { 'ok' }
$now  = if ($problems.Count -eq 0) { 'ok' } else { 'fail' }

if ($now -eq 'ok') {
    if ($hcUrl) { try { Invoke-WebRequest -TimeoutSec 10 -UseBasicParsing -Uri $hcUrl | Out-Null } catch {} }
    if ($prev -eq 'fail') { Send-Telegram '<b>ForexBot recuperado</b> - bridge/MT5/Laravel/BD OK' }
} else {
    if ($hcUrl) { try { Invoke-WebRequest -TimeoutSec 10 -UseBasicParsing -Uri "$hcUrl/fail" | Out-Null } catch {} }
    # Aviso directo SOLO en la transicion ok->fail (Healthchecks recuerda si sigue caido).
    if ($prev -ne 'fail') { Send-Telegram ("<b>ForexBot watchdog - PROBLEMA</b>`n" + ($problems -join "`n")) }
}
Set-Content -Path $stateFile -Value $now -Encoding ascii
