@echo off
setlocal EnableDelayedExpansion

echo.
echo ============================================
echo   Pry Full Reset - New User Simulation
echo ============================================
echo.
echo This will:
echo   1. Kill any running Pry / python.exe sidecar processes
echo   2. Delete %%LOCALAPPDATA%%\Pry\  (runtime, hardware.json, crash logs)
echo   3. Delete WebView2 profile (localStorage, onboarding flags)
echo   4. Optionally wipe HuggingFace cache (~600MB model re-download)
echo.
echo The installed Pry.exe itself is NOT removed.
echo Uninstall via Settings^>Apps if you want a 100%% fresh install too.
echo.
set /p CONFIRM="Continue? [y/N] "
if /i not "!CONFIRM!"=="y" (
    echo Aborted.
    exit /b 0
)

echo.
echo [1/4] Killing Pry processes...
taskkill /F /IM pry.exe 2>nul
taskkill /F /IM python.exe /FI "WINDOWTITLE eq pry*" 2>nul
rem Also kill any python process whose parent was pry (best-effort).
for /f "tokens=2 delims=," %%p in ('tasklist /FI "IMAGENAME eq python.exe" /FO CSV /NH 2^>nul') do (
    taskkill /F /PID %%~p 2>nul
)
timeout /t 1 /nobreak >nul

echo.
echo [2/4] Deleting %%LOCALAPPDATA%%\Pry\ ...
if exist "%LOCALAPPDATA%\Pry" (
    rmdir /S /Q "%LOCALAPPDATA%\Pry"
    if exist "%LOCALAPPDATA%\Pry" (
        echo   WARNING: could not fully delete - something still has a lock.
    ) else (
        echo   OK
    )
) else (
    echo   already gone
)

echo.
echo [3/4] Deleting WebView2 profile ^(localStorage / onboarding flags^)...
rem Tauri stores webview data under AppData\Local\com.beargle.pry\ or AppData\Roaming\com.beargle.pry\
set WV_LOCAL=%LOCALAPPDATA%\com.beargle.pry
set WV_ROAMING=%APPDATA%\com.beargle.pry
if exist "%WV_LOCAL%" (
    rmdir /S /Q "%WV_LOCAL%"
    echo   removed %WV_LOCAL%
)
if exist "%WV_ROAMING%" (
    rmdir /S /Q "%WV_ROAMING%"
    echo   removed %WV_ROAMING%
)
rem Fallback: anywhere with "Pry" EBWebView cache
for %%D in (
    "%LOCALAPPDATA%\Pry\EBWebView"
    "%LOCALAPPDATA%\Microsoft\EdgeWebView\User Data\Pry"
) do (
    if exist %%D (
        rmdir /S /Q %%D
        echo   removed %%D
    )
)
echo   OK

echo.
set /p HFNUKE="[4/4] Also wipe HuggingFace cache (~600MB re-download on next run)? [y/N] "
if /i "!HFNUKE!"=="y" (
    if exist "%USERPROFILE%\.cache\huggingface" (
        echo   Deleting %USERPROFILE%\.cache\huggingface ...
        rmdir /S /Q "%USERPROFILE%\.cache\huggingface"
        echo   OK
    ) else (
        echo   already gone
    )
) else (
    echo   Skipped - model weights preserved.
)

echo.
echo ============================================
echo   Reset complete.
echo ============================================
echo.
echo Next: launch Pry from the Start Menu. You should see:
echo   hardware probe -^> preset picker -^> downloading -^> welcome done
echo   -^> main app with tutorial auto-opening.
echo.
pause
