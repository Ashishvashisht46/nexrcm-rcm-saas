@echo off
echo.
echo  ====================================================
echo   NexRCM - One-Click Setup for Windows
echo  ====================================================
echo.

:: Check if Docker is installed
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Docker is NOT installed on your computer.
    echo.
    echo  Please install Docker Desktop first:
    echo  1. Go to: https://www.docker.com/products/docker-desktop/
    echo  2. Click "Download for Windows"
    echo  3. Install it (just keep clicking Next)
    echo  4. Restart your computer
    echo  5. Open Docker Desktop and wait until it says "Running"
    echo  6. Then run this script again
    echo.
    pause
    exit /b 1
)

:: Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Docker is installed but NOT RUNNING.
    echo.
    echo  Please open Docker Desktop and wait until it shows "Running"
    echo  Then run this script again.
    echo.
    pause
    exit /b 1
)

echo  [OK] Docker is installed and running!
echo.
echo  Starting NexRCM... This will take 2-5 minutes the first time.
echo  (It downloads database, web server, etc.)
echo.

:: Start everything
docker-compose up --build -d

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Something went wrong. Try these fixes:
    echo  1. Make sure Docker Desktop is running
    echo  2. Right-click this file and "Run as Administrator"
    echo  3. Try: docker-compose down, then run this again
    echo.
    pause
    exit /b 1
)

echo.
echo  ====================================================
echo   NexRCM is RUNNING!
echo  ====================================================
echo.
echo   Open your browser and go to:
echo.
echo   Frontend:  http://localhost:3000
echo   API:       http://localhost:4000/api/v1
echo   AI Status: http://localhost:4000/api/v1/ai/status
echo.
echo   Login with:
echo   Email:    admin@summithealthmg.com
echo   Password: NexRCM2024!
echo.
echo   To STOP NexRCM:  docker-compose down
echo   To RESTART:       docker-compose up -d
echo   To see LOGS:      docker-compose logs -f
echo.
echo  ====================================================
echo.

:: Try to open browser
start http://localhost:3000

pause
