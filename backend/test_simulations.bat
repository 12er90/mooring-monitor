@echo off
REM Test script for mooring monitor simulations

echo.
echo ====================================
echo   MOORING MONITOR TEST SIMULATIONS
echo ====================================
echo.

:menu
echo.
echo 1. Trigger CRITICAL simulation (Berth B)
echo 2. Trigger WARNING simulation (Berth B)
echo 3. Exit
echo.
set /p choice="Enter your choice (1-3): "

if "%choice%"=="1" goto critical
if "%choice%"=="2" goto warning
if "%choice%"=="3" goto end
echo Invalid choice. Please try again.
goto menu

:critical
echo.
echo Triggering CRITICAL simulation for Berth B...
echo Tension will be set to 95.0 for 15 seconds
echo.
curl -X POST http://localhost:5000/api/berth/simulate-critical -H "Content-Type: application/json" -d "{\"berth_name\": \"Berth B\"}" -s | jq .
echo.
pause
goto menu

:warning
echo.
echo Triggering WARNING simulation for Berth B...
echo Tension will be set to 70-85 for 15 seconds
echo.
curl -X POST http://localhost:5000/api/berth/simulate-warning -H "Content-Type: application/json" -d "{\"berth_name\": \"Berth B\"}" -s | jq .
echo.
pause
goto menu

:end
echo.
echo Exiting...
