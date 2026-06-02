@echo off
REM ============================================================
REM  Wireless Mic Planner ローカル起動スクリプト (Windows)
REM ------------------------------------------------------------
REM  起動順:
REM   1) Python (本物・MS Store スタブは除外)
REM   2) py ランチャー
REM   3) システムの Node.js
REM   4) Cursor IDE 同梱の node.exe (フォールバック)
REM   何も無ければ案内を表示して停止 (pause)
REM ============================================================
setlocal enableextensions
cd /d "%~dp0"

set "PORT=8000"

echo ============================================================
echo   Wireless Mic Planner ローカル起動
echo   ブラウザで http://localhost:%PORT%/  を開いてください
echo   (停止するには このウィンドウで Ctrl+C か ウィンドウを閉じる)
echo ============================================================
echo.

REM ---- 1) Python (本物のみ。MS Store スタブは弾く) -----------
for /f "delims=" %%P in ('where python 2^>nul') do (
  echo %%P | findstr /I "WindowsApps" >nul
  if errorlevel 1 (
    echo [起動] Python: %%P
    "%%P" -m http.server %PORT%
    goto :end
  )
)

REM ---- 2) py ランチャー --------------------------------------
where py >nul 2>nul
if %errorlevel%==0 (
  echo [起動] py launcher
  py -3 -m http.server %PORT%
  goto :end
)

REM ---- 3) システム Node.js -----------------------------------
where node >nul 2>nul
if %errorlevel%==0 (
  for /f "delims=" %%N in ('where node') do (
    echo [起動] Node.js: %%N
    "%%N" "%~dp0serve.js" %PORT%
    goto :end
  )
)

REM ---- 4) Cursor 同梱の node.exe -----------------------------
set "CURSOR_NODE=C:\Program Files\cursor\resources\app\resources\helpers\node.exe"
if exist "%CURSOR_NODE%" (
  echo [起動] Cursor 同梱 Node.js: %CURSOR_NODE%
  "%CURSOR_NODE%" "%~dp0serve.js" %PORT%
  goto :end
)

REM ---- どれも見つからなかった ---------------------------------
echo.
echo ------------------------------------------------------------
echo  Python / Node.js のどちらも見つかりませんでした。
echo  以下のいずれかをインストールしてもう一度お試しください:
echo    - Python: https://www.python.org/downloads/
echo               (インストール時に [Add Python to PATH] を ON)
echo    - Node.js: https://nodejs.org/  (LTS 版で OK)
echo ------------------------------------------------------------
pause
goto :end

:end
echo.
echo --- サーバー停止 ---
pause
endlocal
