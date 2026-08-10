param(
    [string]$RepositoryRoot = ""
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Resolve-RepositoryRoot {
    param([string]$Requested)

    if ($Requested) {
        return (Resolve-Path -LiteralPath $Requested).Path
    }

    $candidate = (Get-Location).Path
    if (Test-Path -LiteralPath (Join-Path $candidate "clients\terminal\package.json")) {
        return $candidate
    }

    $scriptParent = Split-Path -Parent $PSScriptRoot
    if (Test-Path -LiteralPath (Join-Path $scriptParent "clients\terminal\package.json")) {
        return $scriptParent
    }

    $typed = Read-Host "Informe a pasta do repositório api-master-meeting"
    return (Resolve-Path -LiteralPath $typed).Path
}

$repo = Resolve-RepositoryRoot -Requested $RepositoryRoot

if (-not (Test-Path -LiteralPath (Join-Path $repo "clients\terminal\package.json"))) {
    throw "A pasta informada não parece ser o repositório api-master-meeting: $repo"
}

Write-Step "Validando branch e estado do Git"
Push-Location $repo
try {
    $branch = (& git branch --show-current).Trim()
    if ($branch -ne "desenvolvimento-master-meeting") {
        throw "Branch atual: '$branch'. Troque para desenvolvimento-master-meeting antes de aplicar."
    }

    $sourceRoot = Join-Path $PSScriptRoot "files"
    if (-not (Test-Path -LiteralPath $sourceRoot)) {
        throw "A pasta 'files' do pacote não foi encontrada."
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupRoot = Join-Path $repo ".master-meeting-backup\$stamp"

    $relativeFiles = @(
        "clients\terminal\src\app\api\master\[...path]\route.ts",
        "clients\terminal\src\app\MasterApiPanel.tsx",
        "clients\terminal\src\app\page.tsx",
        "clients\terminal\src\app\terminal\page.tsx"
    )

    Write-Step "Criando backup dos arquivos existentes"
    foreach ($relative in $relativeFiles) {
        $destination = Join-Path $repo $relative
        if (Test-Path -LiteralPath $destination) {
            $backup = Join-Path $backupRoot $relative
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
            Copy-Item -LiteralPath $destination -Destination $backup -Force
        }
    }

    Write-Step "Aplicando o painel administrativo de chaves"
    foreach ($relative in $relativeFiles) {
        $source = Join-Path $sourceRoot $relative
        $destination = Join-Path $repo $relative

        if (-not (Test-Path -LiteralPath $source)) {
            throw "Arquivo ausente no pacote: $relative"
        }

        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
        Write-Host "[OK] $relative" -ForegroundColor Green
    }

    Write-Step "Verificando alterações"
    & git diff --check
    if ($LASTEXITCODE -ne 0) {
        throw "git diff --check encontrou problemas."
    }

    & git status --short

    Write-Host "`nAplicação concluída." -ForegroundColor Green
    Write-Host "Backup: $backupRoot"
    Write-Host ""
    Write-Host "Próximo comando:"
    Write-Host "docker compose --env-file deploy\compose\.env -f deploy\compose\docker-compose.yml up -d --build terminal" -ForegroundColor Yellow
}
finally {
    Pop-Location
}
