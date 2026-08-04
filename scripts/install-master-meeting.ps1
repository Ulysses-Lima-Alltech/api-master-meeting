[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

$InstallerRoot = $InstallerRoot.Trim().Trim('"')
$InstallerRoot = [System.IO.Path]::GetFullPath($InstallerRoot)

$RepositoryUrl = "https://github.com/Ulysses-Lima-Alltech/api-master-meeting.git"
$RequiredDockerMajor = 26
$script:RestartRequired = $false

function Write-Section {
    param([string]$Text)

    Write-Host ""
    Write-Host ("=" * 76) -ForegroundColor DarkGray
    Write-Host ("  " + $Text) -ForegroundColor Cyan
    Write-Host ("=" * 76) -ForegroundColor DarkGray
}

function Write-Ok {
    param([string]$Text)
    Write-Host ("[OK] " + $Text) -ForegroundColor Green
}

function Write-Warn {
    param([string]$Text)
    Write-Host ("[AVISO] " + $Text) -ForegroundColor Yellow
}

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable(
        "Path",
        [EnvironmentVariableTarget]::Machine
    )
    $userPath = [Environment]::GetEnvironmentVariable(
        "Path",
        [EnvironmentVariableTarget]::User
    )

    $env:Path = "$machinePath;$userPath"

    $knownPaths = @(
        "$env:ProgramFiles\Git\cmd",
        "$env:ProgramFiles\Docker\Docker\resources\bin"
    )

    foreach ($knownPath in $knownPaths) {
        if (
            (Test-Path -LiteralPath $knownPath) -and
            ($env:Path -notlike "*$knownPath*")
        ) {
            $env:Path += ";$knownPath"
        }
    }
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)

    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory = $true)][string]$FailureMessage,
        [int[]]$AllowedExitCodes = @(0)
    )

    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE

    if ($AllowedExitCodes -notcontains $exitCode) {
        throw "$FailureMessage Código de saída: $exitCode"
    }

    return $exitCode
}

function Install-WingetPackage {
    param(
        [Parameter(Mandatory = $true)][string]$PackageId,
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [Parameter(Mandatory = $true)][string]$CommandName
    )

    Refresh-ProcessPath

    if (Get-Command $CommandName -ErrorAction SilentlyContinue) {
        Write-Ok "$DisplayName já está instalado."
        return
    }

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue

    if ($null -eq $winget) {
        throw (
            "O WinGet não foi encontrado. Instale ou atualize o " +
            "'Instalador de Aplicativo' pela Microsoft Store e execute novamente."
        )
    }

    Write-Host "Instalando $DisplayName..."

    $arguments = @(
        "install",
        "--id", $PackageId,
        "--exact",
        "--source", "winget",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--silent",
        "--disable-interactivity"
    )

    Invoke-Native `
        -FilePath $winget.Source `
        -Arguments $arguments `
        -FailureMessage "Falha ao instalar $DisplayName." `
        -AllowedExitCodes @(0, 3010) |
        Out-Null

    Refresh-ProcessPath

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw (
            "$DisplayName foi instalado, mas o comando '$CommandName' " +
            "ainda não está disponível. Reinicie o Windows e execute novamente."
        )
    }

    Write-Ok "$DisplayName instalado."
}

function Enable-WslFeatures {
    Write-Section "PREPARANDO WSL 2"

    $features = @(
        "Microsoft-Windows-Subsystem-Linux",
        "VirtualMachinePlatform"
    )

    foreach ($featureName in $features) {
        $feature = Get-WindowsOptionalFeature `
            -Online `
            -FeatureName $featureName

        if ($feature.State -eq "Enabled") {
            Write-Ok "$featureName já está habilitado."
            continue
        }

        Write-Host "Habilitando $featureName..."

        $result = Enable-WindowsOptionalFeature `
            -Online `
            -FeatureName $featureName `
            -All `
            -NoRestart

        if ($result.RestartNeeded) {
            $script:RestartRequired = $true
        }

        Write-Ok "$featureName habilitado."
    }
}

function Test-PendingReboot {
    $paths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending",
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired",
        "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager"
    )

    foreach ($path in $paths[0..1]) {
        if (Test-Path -LiteralPath $path) {
            return $true
        }
    }

    try {
        $pendingRename = (
            Get-ItemProperty `
                -LiteralPath $paths[2] `
                -Name PendingFileRenameOperations `
                -ErrorAction Stop
        ).PendingFileRenameOperations

        if ($null -ne $pendingRename) {
            return $true
        }
    }
    catch {
        # Não existe operação pendente nesse registro.
    }

    return $false
}

function Request-RebootAndStop {
    Write-Host ""
    Write-Warn (
        "O Windows precisa ser reiniciado antes de o Docker/WSL funcionar. " +
        "Depois da reinicialização, execute INSTALAR_MASTER_MEETING.bat novamente."
    )

    $answer = Read-Host "Reiniciar o computador agora? [S/N]"

    if ($answer.Trim().ToUpperInvariant() -eq "S") {
        Restart-Computer -Force
    }

    exit 3010
}

function Ensure-WslRuntime {
    if ($script:RestartRequired -or (Test-PendingReboot)) {
        Request-RebootAndStop
    }

    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue

    if ($null -eq $wsl) {
        throw (
            "O comando wsl.exe ainda não está disponível. " +
            "Reinicie o Windows e execute o instalador novamente."
        )
    }

    Write-Host "Atualizando o WSL..."
    & $wsl.Source --update

    if ($LASTEXITCODE -ne 0) {
        Write-Warn (
            "O WSL não pôde ser atualizado automaticamente. " +
            "O instalador continuará e validará o Docker."
        )
    }

    & $wsl.Source --set-default-version 2

    if ($LASTEXITCODE -ne 0) {
        throw "Não foi possível definir o WSL 2 como versão padrão."
    }

    Write-Ok "WSL 2 preparado."
}

function Get-RepositoryRoot {
    $localMarker = Join-Path $InstallerRoot "deploy\compose\docker-compose.yml"

    if (Test-Path -LiteralPath $localMarker) {
        Write-Ok "Repositório encontrado na mesma pasta do instalador."
        return $InstallerRoot
    }

    $desktop = [Environment]::GetFolderPath("Desktop")
    $defaultPath = Join-Path $desktop "Meet\api-master-meeting"

    Write-Host ""
    Write-Host "O repositório não está junto do instalador."
    $customPath = Read-Host "Pasta de instalação [$defaultPath]"

    if ([string]::IsNullOrWhiteSpace($customPath)) {
        $targetPath = $defaultPath
    }
    else {
        $targetPath = [Environment]::ExpandEnvironmentVariables(
            $customPath.Trim().Trim('"')
        )
        $targetPath = [System.IO.Path]::GetFullPath($targetPath)
    }

    $targetMarker = Join-Path $targetPath "deploy\compose\docker-compose.yml"

    if (Test-Path -LiteralPath $targetMarker) {
        Write-Ok "Repositório existente encontrado em $targetPath"
        return $targetPath
    }

    if (Test-Path -LiteralPath $targetPath) {
        $items = @(Get-ChildItem -LiteralPath $targetPath -Force)

        if ($items.Count -gt 0) {
            throw (
                "A pasta escolhida existe, mas não contém o Master Meeting: " +
                "$targetPath"
            )
        }
    }
    else {
        New-Item `
            -ItemType Directory `
            -Path (Split-Path -Parent $targetPath) `
            -Force |
            Out-Null
    }

    Write-Host "Clonando o repositório público..."

    Invoke-Native `
        -FilePath "git" `
        -Arguments @(
            "clone",
            "--branch", "main",
            "--single-branch",
            $RepositoryUrl,
            $targetPath
        ) `
        -FailureMessage "Falha ao clonar o repositório." |
        Out-Null

    if (-not (Test-Path -LiteralPath $targetMarker)) {
        throw "O repositório foi clonado, mas sua estrutura não foi reconhecida."
    }

    Write-Ok "Repositório clonado em $targetPath"
    return $targetPath
}

function Get-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
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

            $commentIndex = $value.IndexOf(" #")

            if ($commentIndex -ge 0) {
                $value = $value.Substring(0, $commentIndex).Trim()
            }

            return $value
        }
    }

    return $null
}

function Set-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowEmptyString()][string]$Value
    )

    $lines = @()

    if (Test-Path -LiteralPath $Path) {
        $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
    }

    $pattern = "^\s*{0}\s*=" -f [regex]::Escape($Name)
    $replacement = "$Name=$Value"
    $found = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) {
            $lines[$i] = $replacement
            $found = $true
            break
        }
    }

    if (-not $found) {
        $lines += $replacement
    }

    [System.IO.File]::WriteAllLines(
        $Path,
        [string[]]$lines,
        $utf8NoBom
    )
}

function New-RandomSecret {
    param([int]$Bytes = 32)

    $buffer = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()

    try {
        $rng.GetBytes($buffer)
    }
    finally {
        $rng.Dispose()
    }

    return [Convert]::ToBase64String($buffer).
        TrimEnd("=").
        Replace("+", "-").
        Replace("/", "_")
}

function Ensure-SecretValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$UnsafeValues = @()
    )

    $current = Get-DotEnvValue -Path $Path -Name $Name

    if (
        [string]::IsNullOrWhiteSpace($current) -or
        ($UnsafeValues -contains $current)
    ) {
        Set-DotEnvValue `
            -Path $Path `
            -Name $Name `
            -Value (New-RandomSecret)

        return
    }
}

function Test-NvidiaHardware {
    try {
        $controllers = @(
            Get-CimInstance Win32_VideoController |
            Select-Object -ExpandProperty Name
        )

        foreach ($controller in $controllers) {
            if ([string]$controller -match "NVIDIA") {
                return $true
            }
        }
    }
    catch {
        # Tenta nvidia-smi como alternativa.
    }

    return $null -ne (
        Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    )
}

function Find-DockerDesktop {
    $candidates = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Docker\Docker Desktop.exe"
    )

    foreach ($candidate in $candidates) {
        if (
            -not [string]::IsNullOrWhiteSpace($candidate) -and
            (Test-Path -LiteralPath $candidate)
        ) {
            return $candidate
        }
    }

    return $null
}

function Wait-DockerEngine {
    param([int]$TimeoutSeconds = 600)

    Refresh-ProcessPath

    & docker version --format "{{.Server.Version}}" 2>$null | Out-Null

    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Docker Engine disponível."
        return
    }

    $dockerDesktop = Find-DockerDesktop

    if ([string]::IsNullOrWhiteSpace($dockerDesktop)) {
        throw "Docker Desktop foi instalado, mas o executável não foi encontrado."
    }

    Write-Host "Abrindo o Docker Desktop..."
    Start-Process -FilePath $dockerDesktop | Out-Null

    Write-Host (
        "Aguardando o Docker Engine. Na primeira abertura, aceite os termos " +
        "do Docker Desktop caso a janela solicite."
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)

    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds 4

        & docker version --format "{{.Server.Version}}" 2>$null | Out-Null

        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Docker Engine iniciado."
            return
        }

        Write-Host "." -NoNewline
    }

    Write-Host ""
    throw (
        "O Docker não ficou pronto dentro de $TimeoutSeconds segundos. " +
        "Abra o Docker Desktop, conclua a configuração inicial e execute novamente."
    )
}

function Assert-DockerVersion {
    $version = (& docker version --format "{{.Server.Version}}").Trim()
    $majorText = ($version -replace "^v", "").Split(".")[0]
    $major = 0

    if (-not [int]::TryParse($majorText, [ref]$major)) {
        Write-Warn "Não foi possível interpretar a versão do Docker: $version"
        return
    }

    if ($major -lt $RequiredDockerMajor) {
        throw (
            "Docker Engine $version é antigo. " +
            "Este projeto exige Docker Engine $RequiredDockerMajor ou superior."
        )
    }

    Write-Ok "Docker Engine $version compatível."
}

function Test-DockerGpu {
    Write-Host "Validando acesso da GPU NVIDIA dentro do Docker..."

    & docker run `
        --rm `
        --gpus all `
        "nvidia/cuda:12.8.0-base-ubuntu22.04" `
        nvidia-smi

    if ($LASTEXITCODE -eq 0) {
        Write-Ok "GPU NVIDIA disponível para os containers."
        return $true
    }

    Write-Warn (
        "A GPU NVIDIA não ficou disponível dentro do Docker. " +
        "A instalação usará transcrição por CPU."
    )
    return $false
}

function Wait-HttpHealth {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Name,
        [int]$TimeoutSeconds = 300
    )

    Write-Host "Aguardando $Name" -NoNewline
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
            # O serviço ainda está inicializando.
        }

        Write-Host "." -NoNewline
        Start-Sleep -Seconds 3
    }

    Write-Host ""
    throw "$Name não respondeu com HTTP 200 em $Url."
}

function Invoke-DockerCompose {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureMessage,
        [switch]$BestEffort
    )

    Push-Location $Directory

    try {
        & docker compose @Arguments
        $exitCode = $LASTEXITCODE

        if (($exitCode -ne 0) -and (-not $BestEffort)) {
            throw "$FailureMessage Código de saída: $exitCode"
        }
    }
    finally {
        Pop-Location
    }
}

function Configure-Environments {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][ValidateSet("gpu", "cpu")]
        [string]$TranscriptionMode
    )

    Write-Section "CONFIGURANDO O AMBIENTE LOCAL"

    $composeDir = Join-Path $RepoRoot "deploy\compose"
    $transcriptionDir = Join-Path $RepoRoot "deploy\transcription"

    $mainExample = Join-Path $composeDir ".env.example"
    $mainEnv = Join-Path $composeDir ".env"
    $sttExample = Join-Path $transcriptionDir ".env.example"
    $sttEnv = Join-Path $transcriptionDir ".env"

    if (-not (Test-Path -LiteralPath $mainExample)) {
        throw "Arquivo ausente: $mainExample"
    }

    if (-not (Test-Path -LiteralPath $sttExample)) {
        throw "Arquivo ausente: $sttExample"
    }

    $mainCreated = $false
    $sttCreated = $false

    if (-not (Test-Path -LiteralPath $mainEnv)) {
        Copy-Item -LiteralPath $mainExample -Destination $mainEnv
        $mainCreated = $true
        Write-Ok "deploy\compose\.env criado."
    }
    else {
        Write-Ok "deploy\compose\.env existente preservado."
    }

    if (-not (Test-Path -LiteralPath $sttEnv)) {
        Copy-Item -LiteralPath $sttExample -Destination $sttEnv
        $sttCreated = $true
        Write-Ok "deploy\transcription\.env criado."
    }
    else {
        Write-Ok "deploy\transcription\.env existente preservado."
    }

    Ensure-SecretValue `
        -Path $mainEnv `
        -Name "ADMIN_TOKEN" `
        -UnsafeValues @("changeme", "dev-admin-token")

    Ensure-SecretValue `
        -Path $mainEnv `
        -Name "INTERNAL_API_SECRET" `
        -UnsafeValues @("vexa-internal-secret")

    Ensure-SecretValue `
        -Path $mainEnv `
        -Name "VEXA_DISPATCH_SIGNING_KEY" `
        -UnsafeValues @("dev-dispatch-signing-key")

    Ensure-SecretValue `
        -Path $mainEnv `
        -Name "NEXTAUTH_SECRET" `
        -UnsafeValues @("dev-nextauth-secret")

    if ($mainCreated) {
        Set-DotEnvValue `
            -Path $mainEnv `
            -Name "DB_PASSWORD" `
            -Value (New-RandomSecret)

        $minioUser = "mm-" + (New-RandomSecret -Bytes 12)
        $minioSecret = New-RandomSecret

        Set-DotEnvValue -Path $mainEnv -Name "MINIO_ROOT_USER" -Value $minioUser
        Set-DotEnvValue -Path $mainEnv -Name "MINIO_ACCESS_KEY" -Value $minioUser
        Set-DotEnvValue -Path $mainEnv -Name "MINIO_ROOT_PASSWORD" -Value $minioSecret
        Set-DotEnvValue -Path $mainEnv -Name "MINIO_SECRET_KEY" -Value $minioSecret
    }

    $mainToken = Get-DotEnvValue `
        -Path $mainEnv `
        -Name "TRANSCRIPTION_SERVICE_TOKEN"

    $sttToken = Get-DotEnvValue `
        -Path $sttEnv `
        -Name "API_TOKEN"

    if (
        -not [string]::IsNullOrWhiteSpace($mainToken) -and
        -not [string]::IsNullOrWhiteSpace($sttToken) -and
        $mainToken -ne $sttToken
    ) {
        throw (
            "Os tokens de transcrição existentes são diferentes. " +
            "Corrija TRANSCRIPTION_SERVICE_TOKEN e API_TOKEN antes de continuar."
        )
    }

    if (-not [string]::IsNullOrWhiteSpace($sttToken)) {
        $sharedToken = $sttToken
    }
    elseif (-not [string]::IsNullOrWhiteSpace($mainToken)) {
        $sharedToken = $mainToken
    }
    else {
        $sharedToken = New-RandomSecret
    }

    Set-DotEnvValue `
        -Path $mainEnv `
        -Name "TRANSCRIPTION_SERVICE_URL" `
        -Value "http://host.docker.internal:8083"

    Set-DotEnvValue `
        -Path $mainEnv `
        -Name "TRANSCRIPTION_SERVICE_TOKEN" `
        -Value $sharedToken

    Set-DotEnvValue `
        -Path $mainEnv `
        -Name "BROWSER_IMAGE" `
        -Value "vexaai/vexa-bot:v012"

    Set-DotEnvValue `
        -Path $mainEnv `
        -Name "TRANSCRIBE_ENABLED" `
        -Value "true"

    Set-DotEnvValue `
        -Path $mainEnv `
        -Name "RECORDING_ENABLED" `
        -Value "false"

    Set-DotEnvValue `
        -Path $sttEnv `
        -Name "API_TOKEN" `
        -Value $sharedToken

    Set-DotEnvValue `
        -Path $sttEnv `
        -Name "MASTER_MEETING_TRANSCRIPTION_MODE" `
        -Value $TranscriptionMode

    if ($TranscriptionMode -eq "gpu") {
        Set-DotEnvValue -Path $sttEnv -Name "MODEL_SIZE" -Value "large-v3-turbo"
        Set-DotEnvValue -Path $sttEnv -Name "COMPUTE_TYPE" -Value "int8"
    }
    else {
        Set-DotEnvValue -Path $sttEnv -Name "MODEL_SIZE" -Value "small"
        Set-DotEnvValue -Path $sttEnv -Name "COMPUTE_TYPE" -Value "int8"
    }

    if (Test-Path -LiteralPath (Join-Path $RepoRoot ".git")) {
        & git -C $RepoRoot check-ignore -q "deploy/compose/.env"
        $mainIgnored = $LASTEXITCODE -eq 0

        & git -C $RepoRoot check-ignore -q "deploy/transcription/.env"
        $sttIgnored = $LASTEXITCODE -eq 0

        if (-not ($mainIgnored -and $sttIgnored)) {
            throw (
                "Proteção interrompida: um arquivo .env não está ignorado pelo Git. " +
                "Nenhuma credencial deve ser publicada."
            )
        }
    }

    Write-Ok "Segredos locais gerados ou preservados sem exibição no terminal."

    return [pscustomobject]@{
        ComposeDir = $composeDir
        TranscriptionDir = $transcriptionDir
        MainEnv = $mainEnv
        SttEnv = $sttEnv
    }
}

function Build-BotImages {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    Write-Section "CONSTRUINDO O BOT"

    $joinDir = Join-Path $RepoRoot "core\meetings\modules\join"
    $joinDockerfile = Join-Path $joinDir "Dockerfile.env"
    $botDockerfile = Join-Path $RepoRoot "core\meetings\services\bot\Dockerfile"

    Invoke-Native `
        -FilePath "docker" `
        -Arguments @(
            "build",
            "-f", $joinDockerfile,
            "-t", "vexa/meet-join-env:dev",
            $joinDir
        ) `
        -FailureMessage "Falha ao construir a imagem base do bot." |
        Out-Null

    Invoke-Native `
        -FilePath "docker" `
        -Arguments @(
            "build",
            "-t", "vexaai/vexa-bot:v012",
            "-f", $botDockerfile,
            $RepoRoot
        ) `
        -FailureMessage "Falha ao construir a imagem do bot." |
        Out-Null

    Write-Ok "Imagem vexaai/vexa-bot:v012 construída."
}

function Build-AndStartTranscription {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][ValidateSet("gpu", "cpu")]
        [string]$Mode
    )

    Write-Section "CONSTRUINDO E INICIANDO A TRANSCRIÇÃO"

    Invoke-DockerCompose `
        -Directory $Directory `
        -Arguments @("-f", "docker-compose.yml", "down", "--remove-orphans") `
        -FailureMessage "Falha ao parar a transcrição GPU anterior." `
        -BestEffort

    Invoke-DockerCompose `
        -Directory $Directory `
        -Arguments @("-f", "docker-compose.cpu.yml", "down", "--remove-orphans") `
        -FailureMessage "Falha ao parar a transcrição CPU anterior." `
        -BestEffort

    if ($Mode -eq "gpu") {
        $composeFile = "docker-compose.yml"
        $label = "GPU"
    }
    else {
        $composeFile = "docker-compose.cpu.yml"
        $label = "CPU"
    }

    Invoke-DockerCompose `
        -Directory $Directory `
        -Arguments @("-f", $composeFile, "build") `
        -FailureMessage "Falha ao construir a transcrição $label."

    Invoke-DockerCompose `
        -Directory $Directory `
        -Arguments @("-f", $composeFile, "up", "-d") `
        -FailureMessage "Falha ao iniciar a transcrição $label."

    Wait-HttpHealth `
        -Url "http://localhost:8083/health" `
        -Name "transcrição $label" `
        -TimeoutSeconds 600

    Write-Ok "Transcrição $label em funcionamento."
}

function Build-AndStartMainStack {
    param([Parameter(Mandatory = $true)][string]$Directory)

    Write-Section "CONSTRUINDO E INICIANDO A STACK PRINCIPAL"

    Invoke-DockerCompose `
        -Directory $Directory `
        -Arguments @("build") `
        -FailureMessage "Falha ao construir a stack principal."

    Invoke-DockerCompose `
        -Directory $Directory `
        -Arguments @("build", "agent-worker") `
        -FailureMessage "Falha ao construir o agent-worker."

    Invoke-DockerCompose `
        -Directory $Directory `
        -Arguments @("up", "-d") `
        -FailureMessage "Falha ao iniciar a stack principal."

    Wait-HttpHealth `
        -Url "http://localhost:18057/health" `
        -Name "admin-api" `
        -TimeoutSeconds 300

    Wait-HttpHealth `
        -Url "http://localhost:18056/health" `
        -Name "gateway" `
        -TimeoutSeconds 300

    Write-Ok "Stack principal em funcionamento."
}

function Create-DesktopShortcut {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    $launcher = Join-Path $RepoRoot "INICIAR_MASTER_MEETING.bat"

    if (-not (Test-Path -LiteralPath $launcher)) {
        Write-Warn "Lançador não encontrado; o atalho não foi criado."
        return
    }

    $desktop = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktop "Master Meeting.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $launcher
    $shortcut.WorkingDirectory = $RepoRoot
    $shortcut.Description = "Iniciar uma reunião com o Master Meeting"
    $shortcut.Save()

    Write-Ok "Atalho criado na Área de Trabalho."
}

Clear-Host
Write-Host "MASTER MEETING - INSTALADOR PARA WINDOWS" -ForegroundColor Cyan
Write-Host (
    "Instala Git, WSL 2 e Docker Desktop; configura segredos locais; " +
    "constrói e inicia os serviços."
)
Write-Host ""

try {
    if (-not (Test-IsAdministrator)) {
        throw "Este instalador precisa ser executado como administrador."
    }

    Write-Section "VALIDANDO O WINDOWS"

    $os = Get-CimInstance Win32_OperatingSystem

    if ($os.ProductType -ne 1) {
        throw "Este instalador foi preparado para Windows 10/11 Desktop."
    }

    Write-Ok "$($os.Caption) detectado."

    try {
        $processor = Get-CimInstance Win32_Processor | Select-Object -First 1

        if (
            $null -ne $processor.VirtualizationFirmwareEnabled -and
            -not $processor.VirtualizationFirmwareEnabled
        ) {
            Write-Warn (
                "A virtualização parece desabilitada na BIOS/UEFI. " +
                "O Docker Desktop poderá não iniciar."
            )
        }
    }
    catch {
        Write-Warn "Não foi possível confirmar a virtualização do processador."
    }

    Enable-WslFeatures

    Write-Section "INSTALANDO DEPENDÊNCIAS"

    Install-WingetPackage `
        -PackageId "Git.Git" `
        -DisplayName "Git" `
        -CommandName "git.exe"

    Install-WingetPackage `
        -PackageId "Docker.DockerDesktop" `
        -DisplayName "Docker Desktop" `
        -CommandName "docker.exe"

    Ensure-WslRuntime

    Write-Section "LOCALIZANDO O PROJETO"

    $repoRoot = Get-RepositoryRoot
    $repoRoot = [System.IO.Path]::GetFullPath($repoRoot)

    $rootDriveName = [System.IO.Path]::GetPathRoot($repoRoot).
        TrimEnd("\").
        TrimEnd(":")

    try {
        $drive = Get-PSDrive -Name $rootDriveName

        if ($drive.Free -lt 15GB) {
            Write-Warn (
                "Há menos de 15 GB livres na unidade $rootDriveName. " +
                "A construção das imagens e o modelo de transcrição podem exigir mais espaço."
            )
        }
    }
    catch {
        Write-Warn "Não foi possível verificar o espaço livre em disco."
    }

    Write-Section "INICIANDO O DOCKER"

    Wait-DockerEngine -TimeoutSeconds 600
    Assert-DockerVersion

    $mode = "cpu"

    if (Test-NvidiaHardware) {
        if (Test-DockerGpu) {
            $mode = "gpu"
        }
    }
    else {
        Write-Warn (
            "Nenhuma GPU NVIDIA foi detectada. " +
            "A transcrição será configurada em CPU com o modelo small."
        )
    }

    $environment = Configure-Environments `
        -RepoRoot $repoRoot `
        -TranscriptionMode $mode

    Build-BotImages -RepoRoot $repoRoot

    Build-AndStartTranscription `
        -Directory $environment.TranscriptionDir `
        -Mode $mode

    Build-AndStartMainStack `
        -Directory $environment.ComposeDir

    Create-DesktopShortcut -RepoRoot $repoRoot

    Write-Section "INSTALAÇÃO CONCLUÍDA"

    Write-Host "Modo de transcrição: $($mode.ToUpperInvariant())" -ForegroundColor Green
    Write-Host "Projeto: $repoRoot"
    Write-Host "Gateway: http://localhost:18056"
    Write-Host "Terminal: http://localhost:13000"
    Write-Host ""
    Write-Host (
        "Use o atalho 'Master Meeting' na Área de Trabalho ou execute:"
    )
    Write-Host (Join-Path $repoRoot "INICIAR_MASTER_MEETING.bat") -ForegroundColor Cyan
    Write-Host ""
    Write-Host (
        "Os arquivos .env permanecem apenas nesta máquina e não devem ser enviados ao GitHub."
    ) -ForegroundColor Yellow

    exit 0
}
catch {
    Write-Host ""
    Write-Host "INSTALAÇÃO INTERROMPIDA" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host (
        "Corrija o ponto indicado e execute INSTALAR_MASTER_MEETING.bat novamente. " +
        "O instalador é idempotente e preserva a configuração já criada."
    )
    exit 1
}
