@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 (
  echo Impossible d'acceder au dossier du bot.
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.5 ou une version ulterieure est requis.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=5)?0:1)"
if errorlevel 1 (
  echo Node.js 22.5 ou une version ulterieure est requis.
  pause
  exit /b 1
)
if not exist ".env" (
  copy ".env.example" ".env" >nul
  if errorlevel 1 (
    echo Impossible de creer .env a partir de .env.example.
    pause
    exit /b 1
  )
  echo Complete le fichier .env puis relance ce script.
  notepad ".env"
  pause
  exit /b 0
)
choice /c ON /n /m "Activer les logs DEBUG pour cette session ? [O/N] "
if errorlevel 2 (
  set "LOG_LEVEL=info"
) else (
  set "LOG_LEVEL=debug"
)
if not exist "node_modules" (
  call npm ci
  if errorlevel 1 (
    echo Echec de l'installation des dependances.
    pause
    exit /b 1
  )
)
call npm run deploy
if errorlevel 1 (
  echo Echec du deploiement des commandes slash.
  pause
  exit /b 1
)
set "RETRIES=0"
:restart
call npm start
if not errorlevel 1 exit /b 0
set /a RETRIES+=1
if %RETRIES% GEQ 5 (
  echo Le bot a echoue 5 fois. Arret.
  exit /b 1
)
echo Crash detecte, redemarrage dans 10 secondes (%RETRIES%/5)...
timeout /t 10 /nobreak >nul
goto restart
