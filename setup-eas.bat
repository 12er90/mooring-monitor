@echo off
REM Mooring Monitor - EAS Build Setup Script for Windows

echo.
echo ========================================
echo Mooring Monitor - EAS Build Setup
echo ========================================
echo.

REM Check if npm is installed
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [X] npm is not installed. Please install Node.js first.
    pause
    exit /b 1
)

REM Install EAS CLI globally if not present
where eas >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [*] Installing EAS CLI globally...
    call npm install -g eas-cli
)

echo [+] EAS CLI is installed
echo.

REM Change to mobile-app directory
cd /d "%~dp0mobile-app"

echo [*] Installing mobile app dependencies...
call npm install

echo.
echo ========================================
echo [+] Setup Complete!
echo ========================================
echo.
echo [*] Next Steps:
echo    1. Login to Expo: eas login
echo    2. Build Android: eas build --platform android
echo    3. Build iOS: eas build --platform ios
echo    4. Build Both: eas build --platform all
echo.
echo [*] For more info, read README.md in mobile-app/
echo.
pause
