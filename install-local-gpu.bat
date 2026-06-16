@echo off
title Shotbreak Local GPU Setup
cd /d "%~dp0local-backend"
echo.
echo Installing Stable Diffusion 1.5 stack for AMD GPU (DirectML) or CPU...
echo This downloads ~4GB on first image generation. One-time setup ~5-15 min.
echo.
py -m pip install --upgrade pip
py -m pip install -r requirements-gpu.txt
if %errorlevel% neq 0 (
  echo.
  echo [FAILED] pip install — check your internet and try again.
  pause
  exit /b 1
)
echo.
echo Verifying GPU inference...
py -c "from diffusers_infer import is_available, device_name, init_error; print('device:', device_name()); print('ready:', is_available()); print('error:', init_error())"
echo.
echo Done. Restart START_LOCAL.bat then generate — images use SD 1.5, video uses AI still + motion.
pause