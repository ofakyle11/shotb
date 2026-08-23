@echo off
rem ═══════════════════════════════════════════════════════════════════
rem  CINAMATE — what is this machine ready to do?
rem  Double-click me, then screenshot the window (or copy the text).
rem ═══════════════════════════════════════════════════════════════════
cd /d "%~dp0"
where py >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Python was not found. Install it from python.org and tick
  echo   "Add Python to PATH", then run this again.
  echo.
  pause
  exit /b 1
)
py _health_report.py
pause
