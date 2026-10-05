@echo off
REM Double-click this file to run the demo and keep the window open afterwards.
cd /d "%~dp0"
node demo.js
set "DEMO_EXIT=%ERRORLEVEL%"
>>"demo-log.txt" echo Launcher: Node exited with code %DEMO_EXIT%.
echo.
echo Demo stopped with exit code %DEMO_EXIT%.
echo Please share demo-log.txt and this exit message if it stopped unexpectedly.
pause
