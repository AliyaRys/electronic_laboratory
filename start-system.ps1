$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

function Test-DockerReady {
    & docker info --format "{{.ServerVersion}}" *> $null
    return $LASTEXITCODE -eq 0
}

if (-not (Test-DockerReady)) {
    $dockerCandidates = @(
        "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe",
        "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    )
    $dockerDesktop = $dockerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($null -eq $dockerDesktop) {
        throw "Docker Desktop не найден. Установите или запустите Docker Desktop вручную."
    }

    Write-Host "Запускаю Docker Desktop..."
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 60 -and -not (Test-DockerReady); $attempt++) {
        Start-Sleep -Seconds 1
    }
    if (-not (Test-DockerReady)) {
        throw "Docker Desktop запущен, но не успел подготовиться. Повторите запуск через минуту."
    }
}

Write-Host "Запускаю Электронную лабораторию ВСЭ..."
& docker compose `
    -f docker-compose.yml `
    -f docker-compose.dev.yml `
    -f docker-compose.local.yml `
    up -d
if ($LASTEXITCODE -ne 0) {
    throw "Не удалось запустить контейнеры системы."
}

$loginUrl = "http://127.0.0.1:8080/login"
$isReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $loginUrl -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            $isReady = $true
            break
        }
    }
    catch {
        Start-Sleep -Seconds 1
    }
}
if (-not $isReady) {
    throw "Система запущена, но страница входа пока не отвечает. Повторите запуск через минуту."
}

Write-Host "Система готова: $loginUrl"
Start-Process $loginUrl
