@echo off
setlocal
cd /d "%~dp0"
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.local.yml stop
if errorlevel 1 (
  echo Could not stop the laboratory. Make sure Docker Desktop is running.
  pause
  exit /b 1
)
echo The laboratory is stopped. Saved data was kept.
endlocal
