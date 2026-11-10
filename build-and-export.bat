@echo off
setlocal enabledelayedexpansion
title Dong Goi AutoTest Studio Offline
echo ============================================================
echo   BUOC 1: DONG GOI DOCKER IMAGE CHO MANG LAN KHONG INTERNET
echo ============================================================
echo.

where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay Docker tren may nay.
    echo Vui long cai dat Docker Desktop hoac chay script nay tren may
    echo da co Docker va co ket noi Internet de build image.
    echo.
    if not "%1"=="--no-pause" pause
    exit /b 1
)

echo [1/4] Dang build Docker image autotest-studio:latest (linux/amd64)...
docker build --platform linux/amd64 -t autotest-studio:latest .
if %errorlevel% neq 0 (
    echo.
    echo [LOI] Build Docker image that bai!
    if not "%1"=="--no-pause" pause
    exit /b 1
)

echo.
echo [2/4] Dang tao thu muc phan phoi offline 'offline-package'...
if not exist "offline-package" mkdir offline-package
if not exist "offline-package\data" mkdir offline-package\data
if not exist "offline-package\screenshots" mkdir offline-package\screenshots

echo.
echo [3/4] Dang xuat image ra file tar (autotest-studio-offline.tar)...
echo Qua trinh nay co the mat 1-3 phut tuy thuoc vao toc do o dia...
docker save autotest-studio:latest -o offline-package\autotest-studio-offline.tar
if %errorlevel% neq 0 (
    echo.
    echo [LOI] Xuat file tar that bai!
    if not "%1"=="--no-pause" pause
    exit /b 1
)

echo.
echo [4/4] Sao chep cac file can thiet vao offline-package...
copy /y docker-compose.yml offline-package\docker-compose.yml >nul
copy /y .env.example offline-package\.env.example >nul
copy /y deploy.sh offline-package\deploy.sh >nul
copy /y README-OFFLINE.md offline-package\README.md >nul

if exist "be\.env" (
    copy /y be\.env offline-package\.env >nul
    echo Da copy file be\.env hien tai vao offline-package\.env
) else (
    copy /y .env.example offline-package\.env >nul
)

echo.
echo [5/5] Dang nen offline-package thanh autotest-offline.tar.gz...
tar -czf autotest-offline.tar.gz offline-package

echo.
echo ============================================================
echo   DONG GOI THANH CONG!
echo ============================================================
echo Da tao thanh cong 1 file nen duy nhat: autotest-offline.tar.gz
echo Ban chi can copy 1 file nay sang server Linux (qua SCP hoac USB).
echo.
echo Tren server Linux chi can giai nen va chay:
echo     tar -xzf autotest-offline.tar.gz
echo     cd offline-package
echo     sudo bash deploy.sh
echo.
echo ============================================================
if not "%1"=="--no-pause" pause

