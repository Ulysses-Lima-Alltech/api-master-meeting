[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

$RepoRoot = $RepoRoot.Trim().Trim('"')
$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$ComposeDir = Join-Path $RepoRoot "deploy\compose"
$TranscriptionDir = Join-Path $RepoRoot "deploy\transcription"
$ComposeEnvPath = Join-Path $ComposeDir ".env"
$EvidenceRoot = Join-Path $RepoRoot "evidencias-entrega"

$GatewayBaseUrl = "http://localhost:18056"
$AdminBaseUrl = "http://localhost:18057"
$TranscriptionBaseUrl = "http://localhost:8083"

$apiKey = $null
$tokenId = $null
$adminToken = $null
$botCreated = $false
$stopIssued = $false
$terminalReached = $false
$meetingRowId = $null
$meetingCode = $null
$meetingUrl = $null
$containerName = $null
$finalMeetingStatus = $null

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor DarkGray
    Write-Host ("  " + $Text) -ForegroundColor Cyan
    Write-Host ("=" * 72) -ForegroundColor DarkGray
}

function Get-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Arquivo .env não encontrado: $Path"
    }

    $pattern = "^\s*{0}\s*=(.*)$" -f [regex]::Escape($Name)

    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -match $pattern) {
            $value = $Matches[1].Trim()

            if (
                $value.Length -ge 2 -and
                (
                    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                    ($value.StartsWith("'") -and $value.EndsWith("'"))
                )
            ) {
                $value = $value.Substring(1, $value.Length - 2)
            }

            return $value
        }
    }

    return $null
}

function Get-HttpStatusCode {
    param($ErrorRecord)

    try {
        if ($null -ne $ErrorRecord.Exception.Response) {
            return [int]$ErrorRecord.Exception.Response.StatusCode
        }
    }
    catch {
        return $null
    }

    return $null
}

function Get-HttpErrorDetail {
    param($ErrorRecord)

    try {
        $response = $ErrorRecord.Exception.Response

        if ($null -eq $response) {
            return $ErrorRecord.Exception.Message
        }

        $stream = $response.GetResponseStream()

        if ($null -eq $stream) {
            return $ErrorRecord.Exception.Message
        }

        $reader = [System.IO.StreamReader]::new($stream)
        try {
            $body = $reader.ReadToEnd()

            if (-not [string]::IsNullOrWhiteSpace($body)) {
                return $body
            }
        }
        finally {
            $reader.Dispose()
        }
    }
    catch {
        # Mantém a mensagem original quando o corpo não puder ser lido.
    }

    return $ErrorRecord.Exception.Message
}

function Ensure-Docker {
    Write-Section "VALIDANDO O DOCKER"

    & docker version --format "{{.Server.Version}}" 2>$null | Out-Null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Docker Engine disponível." -ForegroundColor Green
        return
    }

    $dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"

    if (-not (Test-Path -LiteralPath $dockerDesktop)) {
        throw "Docker Engine indisponível e Docker Desktop não foi encontrado."
    }

    Write-Host "Abrindo o Docker Desktop..."
    Start-Process -FilePath $dockerDesktop | Out-Null

    $deadline = [DateTime]::UtcNow.AddMinutes(4)

    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds 3

        & docker version --format "{{.Server.Version}}" 2>$null | Out-Null

        if ($LASTEXITCODE -eq 0) {
            Write-Host "Docker Engine iniciado." -ForegroundColor Green
            return
        }

        Write-Host "." -NoNewline
    }

    Write-Host ""
    throw "O Docker Desktop não ficou pronto dentro de 4 minutos."
}

function Start-ComposeStack {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string]$Name
    )

    Write-Host "Iniciando $Name..."

    Push-Location $Directory
    try {
        & docker compose up -d

        if ($LASTEXITCODE -ne 0) {
            throw "docker compose up -d falhou para $Name."
        }
    }
    finally {
        Pop-Location
    }
}

function Wait-HttpHealth {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Name,
        [int]$TimeoutSeconds = 180
    )

    Write-Host "Aguardando $Name ficar saudável" -NoNewline

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)

    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest `
                -UseBasicParsing `
                -Method Get `
                -Uri $Url `
                -TimeoutSec 5

            if ($response.StatusCode -eq 200) {
                Write-Host " OK" -ForegroundColor Green
                return
            }
        }
        catch {
            # Continua aguardando durante a inicialização.
        }

        Write-Host "." -NoNewline
        Start-Sleep -Seconds 2
    }

    Write-Host ""
    throw "$Name não respondeu com HTTP 200 em $Url."
}

function Read-GoogleMeetLink {
    while ($true) {
        Write-Host ""
        $raw = Read-Host "Cole o link da reunião do Google Meet"
        $raw = $raw.Trim()

        $match = [regex]::Match(
            $raw,
            "^(?:(?:https?://)?meet\.google\.com/)?([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#].*)?$",
            [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
        )

        if ($match.Success) {
            $code = $match.Groups[1].Value.ToLowerInvariant()

            return [pscustomobject]@{
                Code = $code
                Url = "https://meet.google.com/$code"
            }
        }

        Write-Host "Link inválido. Exemplo: https://meet.google.com/abc-defg-hij" -ForegroundColor Yellow
    }
}

function Stop-PreviousBotForMeeting {
    param(
        [Parameter(Mandatory = $true)][string]$Platform,
        [Parameter(Mandatory = $true)][string]$NativeMeetingId
    )

    try {
        Invoke-RestMethod `
            -Method Delete `
            -Uri "$GatewayBaseUrl/bots/$Platform/$NativeMeetingId" `
            -Headers @{ "X-API-Key" = $apiKey } |
            Out-Null

        Write-Host "Uma execução antiga foi encontrada e recebeu ordem de saída."
    }
    catch {
        $statusCode = Get-HttpStatusCode $_

        if ($statusCode -ne 404) {
            Write-Host (
                "Aviso ao verificar execução anterior: {0}" -f
                (Get-HttpErrorDetail $_)
            ) -ForegroundColor Yellow
        }
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(45)

    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $runningResult = Invoke-RestMethod `
                -Method Get `
                -Uri "$GatewayBaseUrl/bots/status?platform=$Platform" `
                -Headers @{ "X-API-Key" = $apiKey }

            $matching = @(
                $runningResult.running |
                Where-Object {
                    $_.native_meeting_id -eq $NativeMeetingId
                }
            )

            if ($matching.Count -eq 0) {
                return
            }
        }
        catch {
            return
        }

        Start-Sleep -Seconds 2
    }

    throw "Uma execução anterior dessa reunião ainda está ativa."
}

function Wait-BotActive {
    param(
        [Parameter(Mandatory = $true)][int]$MeetingId,
        [int]$TimeoutSeconds = 600
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastStatus = ""
    $admissionShown = $false

    while ([DateTime]::UtcNow -lt $deadline) {
        $meeting = Invoke-RestMethod `
            -Method Get `
            -Uri "$GatewayBaseUrl/meetings/$MeetingId" `
            -Headers @{ "X-API-Key" = $apiKey }

        $status = [string]$meeting.status

        if ($status -ne $lastStatus) {
            Write-Host ("Status do bot: {0}" -f $status) -ForegroundColor Cyan
            $lastStatus = $status
        }

        if (
            $status -eq "awaiting_admission" -and
            -not $admissionShown
        ) {
            Write-Host ""
            Write-Host "ACEITE o participante 'Master Meeting' no Google Meet." -ForegroundColor Yellow
            Write-Host ""
            $admissionShown = $true
        }

        if ($status -eq "active") {
            return $meeting
        }

        if ($status -in @("failed", "completed")) {
            throw "O bot terminou antes de ficar ativo. Status: $status"
        }

        if ($status -eq "needs_help") {
            throw "O bot entrou no estado needs_help. Verifique os logs do container."
        }

        Start-Sleep -Seconds 3
    }

    throw "O bot não ficou ativo dentro de $TimeoutSeconds segundos."
}

function Stop-BotGracefully {
    param(
        [Parameter(Mandatory = $true)][string]$Platform,
        [Parameter(Mandatory = $true)][string]$NativeMeetingId
    )

    try {
        $result = Invoke-RestMethod `
            -Method Delete `
            -Uri "$GatewayBaseUrl/bots/$Platform/$NativeMeetingId" `
            -Headers @{ "X-API-Key" = $apiKey }

        $script:stopIssued = $true

        Write-Host (
            "Ordem de saída enviada. Status: {0}" -f
            $result.status
        ) -ForegroundColor Green
    }
    catch {
        $statusCode = Get-HttpStatusCode $_

        if ($statusCode -eq 404) {
            $script:stopIssued = $true
            Write-Host "O bot já não estava ativo." -ForegroundColor Yellow
            return
        }

        throw
    }
}

function Wait-MeetingTerminal {
    param(
        [Parameter(Mandatory = $true)][int]$MeetingId,
        [int]$TimeoutSeconds = 120
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastStatus = ""

    while ([DateTime]::UtcNow -lt $deadline) {
        $meeting = Invoke-RestMethod `
            -Method Get `
            -Uri "$GatewayBaseUrl/meetings/$MeetingId" `
            -Headers @{ "X-API-Key" = $apiKey }

        $status = [string]$meeting.status

        if ($status -ne $lastStatus) {
            Write-Host ("Encerramento: {0}" -f $status)
            $lastStatus = $status
        }

        if ($status -in @("completed", "failed")) {
            $script:terminalReached = $true
            $script:finalMeetingStatus = $status
            return $meeting
        }

        Start-Sleep -Seconds 3
    }

    throw "A reunião não chegou a completed/failed dentro de $TimeoutSeconds segundos."
}

function Get-FinalTranscript {
    param(
        [Parameter(Mandatory = $true)][int]$MeetingId,
        [int]$Attempts = 20
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $transcript = Invoke-RestMethod `
                -Method Get `
                -Uri "$GatewayBaseUrl/transcripts/by-id/$MeetingId" `
                -Headers @{ "X-API-Key" = $apiKey }

            if ($null -ne $transcript) {
                return $transcript
            }
        }
        catch {
            $statusCode = Get-HttpStatusCode $_

            if ($statusCode -ne 404) {
                throw
            }
        }

        Start-Sleep -Seconds 3
    }

    throw "A transcrição final não ficou disponível."
}

function Save-TranscriptFiles {
    param(
        [Parameter(Mandatory = $true)]$Transcript,
        [Parameter(Mandatory = $true)][string]$MeetingUrl,
        [Parameter(Mandatory = $true)][string]$NativeMeetingId,
        [Parameter(Mandatory = $true)][int]$MeetingId
    )

    $dayDir = Join-Path $EvidenceRoot (Get-Date -Format "yyyy-MM-dd")
    New-Item -ItemType Directory -Path $dayDir -Force | Out-Null

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $baseName = "google-meet-$NativeMeetingId-$stamp"
    $jsonPath = Join-Path $dayDir "$baseName.json"
    $txtPath = Join-Path $dayDir "$baseName.txt"

    $json = $Transcript | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText($jsonPath, $json, $utf8NoBom)

    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add("MASTER MEETING - TRANSCRIÇÃO")
    $lines.Add("")
    $lines.Add("Reunião: $MeetingUrl")
    $lines.Add("Meeting row ID: $MeetingId")
    $lines.Add("Status final: $finalMeetingStatus")
    $lines.Add("Gerado em: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))")
    $lines.Add("")
    $lines.Add("-" * 72)

    $segments = @($Transcript.segments | Sort-Object -Property start)

    if ($segments.Count -eq 0) {
        $lines.Add("")
        $lines.Add("Nenhum segmento de fala foi reconhecido.")
    }
    else {
        foreach ($segment in $segments) {
            $speaker = [string]$segment.speaker

            if ([string]::IsNullOrWhiteSpace($speaker)) {
                $speaker = "Speaker"
            }

            $text = [string]$segment.text
            $text = $text.Trim()

            if ([string]::IsNullOrWhiteSpace($text)) {
                continue
            }

            $displayTime = "--:--:--"

            if (
                $segment.PSObject.Properties.Name -contains "absolute_start_time" -and
                -not [string]::IsNullOrWhiteSpace([string]$segment.absolute_start_time)
            ) {
                try {
                    $displayTime = (
                        [DateTimeOffset]::Parse(
                            [string]$segment.absolute_start_time
                        )
                    ).ToLocalTime().ToString("HH:mm:ss")
                }
                catch {
                    $displayTime = "--:--:--"
                }
            }
            elseif (
                $segment.PSObject.Properties.Name -contains "start" -and
                [double]$segment.start -ge 100000000
            ) {
                try {
                    $epoch = [DateTimeOffset]::Parse(
                        "1970-01-01T00:00:00+00:00"
                    )

                    $displayTime = $epoch.
                        AddSeconds([double]$segment.start).
                        ToLocalTime().
                        ToString("HH:mm:ss")
                }
                catch {
                    $displayTime = "--:--:--"
                }
            }

            $lines.Add("")
            $lines.Add("[$displayTime] ${speaker}: $text")
        }
    }

    [System.IO.File]::WriteAllLines(
        $txtPath,
        $lines.ToArray(),
        $utf8NoBom
    )

    return [pscustomobject]@{
        JsonPath = $jsonPath
        TextPath = $txtPath
        SegmentCount = $segments.Count
    }
}

function Revoke-TemporaryToken {
    if (
        $null -eq $tokenId -or
        [string]::IsNullOrWhiteSpace($adminToken)
    ) {
        return
    }

    try {
        Invoke-RestMethod `
            -Method Delete `
            -Uri "$AdminBaseUrl/admin/tokens/$tokenId" `
            -Headers @{ "X-Admin-API-Key" = $adminToken } |
            Out-Null

        Write-Host "Token temporário revogado." -ForegroundColor DarkGray
        $script:tokenId = $null
    }
    catch {
        Write-Host (
            "Não foi possível revogar o token temporário: {0}" -f
            (Get-HttpErrorDetail $_)
        ) -ForegroundColor Yellow
    }
}

Clear-Host
Write-Host "MASTER MEETING - EXECUÇÃO PROVISÓRIA" -ForegroundColor Cyan
Write-Host "Google Meet -> transcrição -> saída -> arquivos JSON/TXT"
Write-Host ""

try {
    if (-not (Test-Path -LiteralPath $ComposeDir)) {
        throw "Diretório de compose não encontrado: $ComposeDir"
    }

    if (-not (Test-Path -LiteralPath $TranscriptionDir)) {
        throw "Diretório de transcription não encontrado: $TranscriptionDir"
    }

    $meetingInput = Read-GoogleMeetLink
    $meetingCode = $meetingInput.Code
    $meetingUrl = $meetingInput.Url

    Ensure-Docker

    Write-Section "INICIANDO OS SERVIÇOS"

    Start-ComposeStack `
        -Directory $TranscriptionDir `
        -Name "serviço de transcrição GPU"

    Wait-HttpHealth `
        -Url "$TranscriptionBaseUrl/health" `
        -Name "transcrição GPU" `
        -TimeoutSeconds 300

    Start-ComposeStack `
        -Directory $ComposeDir `
        -Name "stack principal"

    Wait-HttpHealth `
        -Url "$AdminBaseUrl/health" `
        -Name "admin-api" `
        -TimeoutSeconds 180

    Wait-HttpHealth `
        -Url "$GatewayBaseUrl/health" `
        -Name "gateway" `
        -TimeoutSeconds 180

    & docker image inspect "vexaai/vexa-bot:v012" *> $null

    if ($LASTEXITCODE -ne 0) {
        throw (
            "A imagem vexaai/vexa-bot:v012 não existe localmente. " +
            "Faça o build do bot antes de usar este lançador."
        )
    }

    $adminToken = Get-DotEnvValue `
        -Path $ComposeEnvPath `
        -Name "ADMIN_TOKEN"

    if (
        [string]::IsNullOrWhiteSpace($adminToken) -or
        $adminToken -eq "changeme"
    ) {
        throw "ADMIN_TOKEN não está configurado corretamente em $ComposeEnvPath"
    }

    Write-Section "PREPARANDO O ACESSO LOCAL"

    $userBody = @{
        email = "master-meeting-cli@local.test"
        name = "Master Meeting CLI"
        max_concurrent_bots = 3
    } | ConvertTo-Json

    $user = Invoke-RestMethod `
        -Method Post `
        -Uri "$AdminBaseUrl/admin/users" `
        -Headers @{ "X-Admin-API-Key" = $adminToken } `
        -ContentType "application/json; charset=utf-8" `
        -Body $userBody

    $tokenName = "master-meeting-cli-" + (
        Get-Date -Format "yyyyMMdd-HHmmss"
    )

    $escapedTokenName = [System.Uri]::EscapeDataString($tokenName)

    $tokenUri = "$AdminBaseUrl/admin/users/$($user.id)/tokens"
    $tokenUri += "?scopes=bot,tx,browser"
    $tokenUri += "&name=$escapedTokenName"
    $tokenUri += "&expires_in=21600"

    $tokenResponse = Invoke-RestMethod `
        -Method Post `
        -Uri $tokenUri `
        -Headers @{ "X-Admin-API-Key" = $adminToken }

    $apiKey = [string]$tokenResponse.token
    $tokenId = [int]$tokenResponse.id

    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        throw "A admin-api não retornou o token temporário."
    }

    Stop-PreviousBotForMeeting `
        -Platform "google_meet" `
        -NativeMeetingId $meetingCode

    Write-Section "INICIANDO O MASTER MEETING"

    try {
        Start-Process $meetingUrl | Out-Null
        Write-Host "O link foi aberto no navegador."
    }
    catch {
        Write-Host "Abra manualmente: $meetingUrl" -ForegroundColor Yellow
    }

    $botBody = @{
        platform = "google_meet"
        native_meeting_id = $meetingCode
        meeting_url = $meetingUrl
        bot_name = "Master Meeting"
        language = "pt"
        task = "transcribe"
        transcription_tier = "realtime"
        recording_enabled = $false
        transcribe_enabled = $true
        continue_meeting = $false
    } | ConvertTo-Json

    $bot = Invoke-RestMethod `
        -Method Post `
        -Uri "$GatewayBaseUrl/bots" `
        -Headers @{ "X-API-Key" = $apiKey } `
        -ContentType "application/json; charset=utf-8" `
        -Body $botBody

    $botCreated = $true
    $meetingRowId = [int]$bot.id
    $containerName = "vexa-$($bot.bot_container_id)"

    Write-Host ("Reunião interna: {0}" -f $meetingRowId)
    Write-Host ("Container: {0}" -f $containerName)

    Wait-BotActive -MeetingId $meetingRowId | Out-Null

    Write-Section "BOT ATIVO"

    Write-Host "O Master Meeting está dentro da reunião." -ForegroundColor Green
    Write-Host "Fale normalmente. A transcrição está sendo capturada."
    Write-Host ""
    [void](Read-Host "Quando terminar, pressione ENTER para salvar e retirar o bot")

    Write-Section "ENCERRANDO E SALVANDO"

    Stop-BotGracefully `
        -Platform "google_meet" `
        -NativeMeetingId $meetingCode

    Wait-MeetingTerminal `
        -MeetingId $meetingRowId `
        -TimeoutSeconds 120 |
        Out-Null

    Start-Sleep -Seconds 3

    $transcript = Get-FinalTranscript `
        -MeetingId $meetingRowId `
        -Attempts 20

    $saved = Save-TranscriptFiles `
        -Transcript $transcript `
        -MeetingUrl $meetingUrl `
        -NativeMeetingId $meetingCode `
        -MeetingId $meetingRowId

    Write-Host ""
    Write-Host "CONCLUÍDO COM SUCESSO" -ForegroundColor Green
    Write-Host ("Status final: {0}" -f $finalMeetingStatus)
    Write-Host ("Segmentos: {0}" -f $saved.SegmentCount)
    Write-Host ("JSON: {0}" -f $saved.JsonPath)
    Write-Host ("TXT:  {0}" -f $saved.TextPath)
    Write-Host ""
    Write-Host "Os serviços Docker permanecerão ligados para a próxima reunião."
}
catch {
    Write-Host ""
    Write-Host "ERRO NA EXECUÇÃO" -ForegroundColor Red
    Write-Host (Get-HttpErrorDetail $_) -ForegroundColor Red

    if (-not [string]::IsNullOrWhiteSpace($containerName)) {
        Write-Host ""
        Write-Host "Últimos logs do bot:" -ForegroundColor Yellow
        & docker logs --tail 80 $containerName 2>&1
    }
}
finally {
    if (
        $botCreated -and
        -not $stopIssued -and
        -not [string]::IsNullOrWhiteSpace($apiKey) -and
        -not [string]::IsNullOrWhiteSpace($meetingCode)
    ) {
        try {
            Invoke-RestMethod `
                -Method Delete `
                -Uri "$GatewayBaseUrl/bots/google_meet/$meetingCode" `
                -Headers @{ "X-API-Key" = $apiKey } |
                Out-Null
        }
        catch {
            # A limpeza é best-effort.
        }
    }

    Revoke-TemporaryToken

    Set-Location $RepoRoot

    Write-Host ""
    Write-Host "A janela permanecerá aberta. Pode fechá-la quando terminar." -ForegroundColor DarkGray
}
