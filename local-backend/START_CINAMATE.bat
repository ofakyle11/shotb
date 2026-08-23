@echo off
rem ═══════════════════════════════════════════════════════════════════
rem  CINAMATE — start everything on the generation machine
rem  · AI bridge on http://127.0.0.1:3456  (video/image generation)
rem  · research service on http://127.0.0.1:3457  (prop-house lookups)
rem  Keep both windows open while you work; closing one stops it.
rem ═══════════════════════════════════════════════════════════════════
cd /d "%~dp0"

where py >nul 2>&1
if errorlevel 1 (
  echo  [X] Python was not found. Install it from python.org and tick
  echo      "Add Python to PATH", then run this file again.
  pause
  exit /b 1
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo  [!] ffmpeg was not found on PATH.
  echo      The bridge needs it to write MP4s - generation will report
  echo      "ffmpeg not found" without it. Install ffmpeg and make sure
  echo      "ffmpeg -version" works in a new terminal, then rerun this.
  echo.
  echo      Starting anyway so you can still test the connection...
  echo.
)

start "CINAMATE bridge :3456" cmd /k py server.py
start "CINAMATE research :3457" cmd /k py research-service.py
echo.
echo  Two CINAMATE windows are opening:
echo    bridge   - http://localhost:3456/health
echo    research - http://localhost:3457/research/health
echo.
echo  Next: on THIS computer open
echo    https://cinamate-studio.netlify.app/timeline/
echo  sign in, and the Studio will say "Local GPU bridge online".
echo.
echo  Leave both windows open. This one can be closed.
pause
