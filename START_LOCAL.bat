@echo off
title Shotbreak Local
cd /d "%~dp0"
echo Starting Shotbreak local stack...
echo.

netstat -ano | findstr ":3456" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo [ok] Bridge already listening on port 3456
) else (
  echo [..] Starting bridge on port 3456
  start "Shotbreak Bridge" cmd /k "cd /d %~dp0local-backend && py server.py"
  timeout /t 2 /nobreak >nul
)

netstat -ano | findstr ":8080" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo [ok] UI already listening on port 8080
) else (
  echo [..] Starting UI on port 8080
  start "Shotbreak UI" cmd /k "cd /d %~dp0 && py local-server.py"
  timeout /t 2 /nobreak >nul
)

start http://localhost:8080/app.html
echo.
echo UI:     http://localhost:8080/app.html
echo Bridge: http://localhost:3456/health
echo.
echo Leave both terminal windows open while you work.
echo.
if not exist "%~dp0local-backend\requirements-gpu.txt" (
  echo [tip] For REAL AI on your AMD GPU, also run install-local-gpu.bat once.
) else (
  py -c "from diffusers_infer import packages_installed; import sys; sys.exit(0 if packages_installed() else 1)" >nul 2>&1
  if errorlevel 1 echo [tip] Run install-local-gpu.bat once for Stable Diffusion 1.5 on your GPU.
)
echo.
pause