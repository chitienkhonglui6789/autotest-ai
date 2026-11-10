#!/usr/bin/env bash
set -e

echo "============================================================"
echo "  BƯỚC 1: ĐÓNG GÓI DOCKER IMAGE CHO MẠNG LAN KHÔNG INTERNET"
echo "============================================================"

if ! command -v docker >/dev/null 2>&1; then
    echo "[LỖI] Không tìm thấy Docker trên máy này."
    echo "Vui lòng chạy script này trên máy có Docker và kết nối Internet."
    exit 1
fi

echo "[1/4] Đang build Docker image autotest-studio:latest (linux/amd64)..."
docker build --platform linux/amd64 -t autotest-studio:latest .

echo "[2/4] Đang tạo thư mục phân phối offline 'offline-package'..."
mkdir -p offline-package/data offline-package/screenshots

echo "[3/4] Đang xuất image ra file tar (autotest-studio-offline.tar)..."
docker save autotest-studio:latest -o offline-package/autotest-studio-offline.tar

echo "[4/4] Sao chép các tệp cấu hình vào offline-package..."
cp docker-compose.yml offline-package/docker-compose.yml
cp .env.example offline-package/.env.example
cp deploy.sh offline-package/deploy.sh
chmod +x offline-package/deploy.sh
cp README-OFFLINE.md offline-package/README.md

if [ -f "be/.env" ]; then
    cp be/.env offline-package/.env
    echo "Đã copy file be/.env hiện tại vào offline-package/.env"
else
    cp .env.example offline-package/.env
fi

echo ""
echo "[5/5] Đang nén offline-package thành autotest-offline.tar.gz..."
tar -czf autotest-offline.tar.gz offline-package

echo ""
echo "============================================================"
echo "  ĐÓNG GÓI THÀNH CÔNG!"
echo "============================================================"
echo "Đã tạo file nén duy nhất: autotest-offline.tar.gz"
echo "Chép 1 file này sang server Linux nội bộ, sau đó chạy:"
echo "    tar -xzf autotest-offline.tar.gz"
echo "    cd offline-package"
echo "    sudo bash deploy.sh"
echo "============================================================"

