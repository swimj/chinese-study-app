@echo off
setlocal

cd /d "%~dp0\.."

if not exist "node_modules" (
  echo Installing packages...
  call npm install
  if errorlevel 1 goto error
)

if not exist "data\friend-mandarin-user-data\app.db" (
  echo Creating fresh Mandarin study database...
  call npm run friend:mandarin:setup-db
  if errorlevel 1 goto error
)

echo Starting Chinese Study App.
echo Backend and frontend will open in separate terminal windows.
echo Close those windows, or press Ctrl+C in each one, to stop the app.

start "Chinese Study App Backend" cmd /k "npm run friend:mandarin:backend"
start "Chinese Study App Frontend" cmd /k "npm run friend:mandarin:frontend"

echo.
echo Opening http://localhost:4173 ...
timeout /t 3 /nobreak >nul
start "" "http://localhost:4173"

exit /b 0

:error
echo.
echo Setup failed. Check the message above.
pause
exit /b 1
