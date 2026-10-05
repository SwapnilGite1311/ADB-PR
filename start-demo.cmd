@echo off
cd /d "%~dp0"
node -e "if(Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if errorlevel 1 (
    echo Install Node.js 24 LTS from https://nodejs.org/ and try again.
    pause
    exit /b 1
)
if not exist "node_modules\mongoose\package.json" (
    echo Installing packages. Internet is required for the first run.
    call npm.cmd ci
    if errorlevel 1 (
        echo Installation failed. Check your internet connection and the messages above.
        pause
        exit /b 1
    )
)
echo Open http://localhost:3000 after the Local demo ready message appears.
echo Keep this window open. Press Ctrl+C to stop the app.
node demo.js
set "DEMO_EXIT=%ERRORLEVEL%"
>>"demo-log.txt" echo Launcher: Node exited with code %DEMO_EXIT%.
echo.
echo Demo stopped with exit code %DEMO_EXIT%.
echo Please share demo-log.txt and this exit message if it stopped unexpectedly.
pause
