@echo off
rem ─────────────────────────────────────────────────────────────────────────
rem  Krafted stability audit — Windows, ONE command.
rem
rem  BEFORE YOU RUN: edit audit_config_win.json and set
rem    "board"   -> your real .kpak on this machine
rem    "footage" -> your real footage folder on this machine
rem  (Backslashes must be doubled in JSON, e.g. "C:\\Users\\you\\footage")
rem
rem  Output: results\result_win.json  — send that file back.
rem  If Node is missing, use audit_page.html instead (open it in Chrome).
rem ─────────────────────────────────────────────────────────────────────────
setlocal

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo NODE NOT FOUND on this machine.
  echo Option A: install Node 18+ from https://nodejs.org then re-run this file.
  echo Option B: open audit_page.html in Chrome - it needs nothing installed.
  echo.
  pause
  exit /b 2
)

if not exist "%~dp0audit_config_win.json" (
  echo MISSING audit_config_win.json - copy it from audit_config_win.example.json and edit the paths.
  pause
  exit /b 2
)

pushd "%~dp0"
node "%~dp0..\run_audit.js" --config "%~dp0audit_config_win.json"
set RC=%ERRORLEVEL%
popd

echo.
echo EXIT CODE: %RC%
if not "%RC%"=="0" echo (non-zero means the run crashed — result_win.json is still written, marked PARTIAL)
pause
exit /b %RC%
