@echo off
title AutoTest Studio Runner
echo ===================================================
echo     DANG KHOI DONG HE THONG AUTOTEST STUDIO
echo ===================================================
echo.
echo [1/2] Dang khoi chay Backend tai http://127.0.0.1:3000...
start "AutoTest Backend (Port 3000)" cmd /k "cd be && npm run dev"

echo [2/2] Dang khoi chay Frontend tai http://localhost:5173...
start "AutoTest Frontend (Port 5173)" cmd /k "cd fe && npm run dev"

echo.
echo Da bat ca 2 server thanh cong!
echo Mo trinh duyet truy cap: http://localhost:5173
echo.
timeout /t 3 >nul
start http://localhost:5173

