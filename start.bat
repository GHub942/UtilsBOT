@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 (
  echo Could not access the bot directory.
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.5 or later is required.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=5)?0:1)"
if errorlevel 1 (
  echo Node.js 22.5 or later is required.
  pause
  exit /b 1
)
if not exist ".env" (
  copy ".env.example" ".env" >nul
  if errorlevel 1 (
    echo Could not create .env from .env.example.
    pause
    exit /b 1
  )
  echo Configure .env, then run this script again.
  notepad ".env"
  pause
  exit /b 0
)
choice /c YN /n /m "Enable DEBUG logging for this session? [Y/N] "
if errorlevel 2 (
  set "LOG_LEVEL=info"
) else (
  set "LOG_LEVEL=debug"
)
if not exist "node_modules" (
  call npm ci
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
call npm run deploy
if errorlevel 1 (
  echo Slash command deployment failed.
  pause
  exit /b 1
)
set "RETRIES=0"
:restart
call npm start
if not errorlevel 1 exit /b 0
set /a RETRIES+=1
if %RETRIES% GEQ 5 (
  echo The bot failed five times. Stopping.
  exit /b 1
)
echo Crash detected; restarting in 10 seconds (%RETRIES%/5)...
timeout /t 10 /nobreak >nul
goto restart
