@echo off
rem ═══════════════════════════════════════════════════════════════════
rem  CINAMATE — start everything on the generation machine
rem  · AI bridge on http://127.0.0.1:3456  (video/image generation)
rem  · research service on http://127.0.0.1:3457  (prop-house lookups)
rem  Keep both windows open while you work; closing one stops it.
rem ═══════════════════════════════════════════════════════════════════
cd /d "%~dp0"
start "CINAMATE bridge :3456" cmd /k py server.py
start "CINAMATE research :3457" cmd /k py research-service.py
echo.
echo  Two CINAMATE windows are opening:
echo    bridge   - http://localhost:3456/health
echo    research - http://localhost:3457/research/health
echo.
echo  Leave them open. This window can be closed.
pause
