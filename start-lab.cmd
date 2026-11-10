@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo The local installation is not configured: .env is missing.
  pause
  exit /b 1
)

docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.local.yml up -d
if errorlevel 1 (
  echo Could not start the laboratory. Make sure Docker Desktop is running.
  pause
  exit /b 1
)

powershell -NoProfile -Command "$limit=(Get-Date).AddMinutes(2); do { try { $r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8080/api/v1/health/ready'; if($r.StatusCode -eq 200){ Start-Process 'http://127.0.0.1:8080'; exit 0 } } catch {}; Start-Sleep -Seconds 2 } while((Get-Date) -lt $limit); exit 1"
if errorlevel 1 (
  echo The system started, but readiness was not confirmed within two minutes.
  pause
  exit /b 1
)

echo The laboratory is running at http://127.0.0.1:8080
endlocal
