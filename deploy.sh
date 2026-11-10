#!/usr/bin/env bash
set -e

echo "============================================================"
echo "  TRIỂN KHAI AUTOTEST STUDIO TRÊN LINUX (MẠNG LAN OFFLINE)"
echo "============================================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Kiểm tra quyền và lệnh Docker
DOCKER_CMD="docker"
if ! command -v docker >/dev/null 2>&1; then
    echo "[LỖI] Hệ thống chưa cài đặt Docker!"
    echo "Vì server không có internet, vui lòng cài gói deb/rpm Docker trước khi triển khai."
    exit 1
fi

# Kiểm tra xem user hiện tại có quyền gọi docker daemon hay cần sudo
if ! docker info >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
        DOCKER_CMD="sudo docker"
    else
        echo "[LỖI] Không thể kết nối tới Docker Daemon."
        echo "Vui lòng chạy lại script với quyền root: sudo bash deploy.sh"
        exit 1
    fi
fi

# Xác định lệnh Compose phù hợp
COMPOSE_CMD=""
if $DOCKER_CMD compose version >/dev/null 2>&1; then
    COMPOSE_CMD="$DOCKER_CMD compose"
elif command -v docker-compose >/dev/null 2>&1; then
    if docker-compose version >/dev/null 2>&1; then
        COMPOSE_CMD="docker-compose"
    elif command -v sudo >/dev/null 2>&1 && sudo docker-compose version >/dev/null 2>&1; then
        COMPOSE_CMD="sudo docker-compose"
    fi
fi

# 2. Kiểm tra file nén offline image
TAR_FILE="autotest-studio-offline.tar"
if [ ! -f "$TAR_FILE" ]; then
    echo "[LỖI] Không tìm thấy file $TAR_FILE tại $SCRIPT_DIR!"
    echo "Vui lòng copy file $TAR_FILE vào cùng thư mục với deploy.sh."
    exit 1
fi

# 3. Tạo thư mục lưu trữ dữ liệu và cấp quyền ghi 777 cho container
echo "[1/5] Khởi tạo các thư mục lưu trữ và phân quyền..."
mkdir -p data screenshots
chmod -R 777 data screenshots 2>/dev/null || true

# 4. Đảm bảo file .env tồn tại
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "[2/5] Tạo file .env từ .env.example..."
        cp .env.example .env
    else
        touch .env
    fi
fi
chmod 666 .env 2>/dev/null || true

# Đọc cấu hình cổng ngoài từ .env (mặc định 39793)
EXT_PORT="39793"
if [ -f ".env" ]; then
    ENV_PORT=$(grep -E '^\s*EXTERNAL_PORT\s*=' .env | cut -d= -f2- | tr -d ' "\r')
    if [ -n "$ENV_PORT" ]; then
        EXT_PORT="$ENV_PORT"
    fi
fi

# 5. Dọn dẹp container cũ trước khi kiểm tra xung đột cổng
echo "[2/5] Dọn dẹp tiến trình container cũ (nếu có)..."
if [ -n "$COMPOSE_CMD" ]; then
    $COMPOSE_CMD down 2>/dev/null || true
fi
$DOCKER_CMD stop autotest-studio 2>/dev/null || true
$DOCKER_CMD rm autotest-studio 2>/dev/null || true

# 6. Kiểm tra cổng ngoài (8386) có bị tiến trình khác chiếm dụng không
echo "[3/5] Kiểm tra tính khả dụng của cổng ngoài $EXT_PORT..."
PORT_OCCUPIED=false
if command -v ss >/dev/null 2>&1; then
    if ss -tuln | grep -qE "(:|\])${EXT_PORT}\s"; then
        PORT_OCCUPIED=true
    fi
elif command -v netstat >/dev/null 2>&1; then
    if netstat -tuln | grep -qE "(:|\])${EXT_PORT}\s"; then
        PORT_OCCUPIED=true
    fi
elif command -v lsof >/dev/null 2>&1; then
    if lsof -i ":${EXT_PORT}" >/dev/null 2>&1; then
        PORT_OCCUPIED=true
    fi
fi

if [ "$PORT_OCCUPIED" = "true" ]; then
    echo "[CẢNH BÁO] Cổng $EXT_PORT đang bị một tiến trình khác trên server chiếm dụng!"
    echo "Bạn có thể chỉnh sửa dòng 'EXTERNAL_PORT=...' trong file .env sang cổng khác (ví dụ: 8387) rồi chạy lại."
    read -p "Bạn có muốn tiếp tục thử bind cổng này không? (y/n) " -n 1 -r || true
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "  -> Cổng $EXT_PORT sẵn sàng!"
fi

# 7. Nạp Docker Image từ file nén .tar
echo "[4/5] Đang nạp Docker image từ $TAR_FILE vào Docker..."
$DOCKER_CMD load -i "$TAR_FILE"

# 8. Khởi động Container
echo "[5/5] Đang khởi động AutoTest Studio (cổng ngoài $EXT_PORT -> cổng trong 3000)..."

if [ -n "$COMPOSE_CMD" ]; then
    echo "Khởi chạy qua $COMPOSE_CMD..."
    EXTERNAL_PORT="$EXT_PORT" $COMPOSE_CMD up -d
else
    echo "Khởi chạy trực tiếp bằng lệnh '$DOCKER_CMD run'..."
    $DOCKER_CMD run -d \
      --name autotest-studio \
      --restart unless-stopped \
      -p "$EXT_PORT:3000" \
      -e HOST=0.0.0.0 \
      -e PORT=3000 \
      -e HEADLESS=true \
      -e CHROME_PATH=/usr/bin/chromium \
      --env-file .env \
      -v "$PWD/data:/app/be/data" \
      -v "$PWD/screenshots:/app/be/screenshots" \
      -v "$PWD/.env:/app/be/.env" \
      --shm-size=1gb \
      autotest-studio:latest
fi

echo ""
echo "============================================================"
echo "  TRIỂN KHAI THÀNH CÔNG!"
echo "============================================================"
echo "Kiểm tra tiến trình container:"
$DOCKER_CMD ps --filter "name=autotest-studio"
echo ""

# Xác định danh sách IP của server
SERVER_IPS=""
if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
    SERVER_IPS=$(hostname -I 2>/dev/null)
elif command -v ip >/dev/null 2>&1; then
    SERVER_IPS=$(ip addr show 2>/dev/null | awk '/inet / && !/127.0.0.1/ {print $2}' | cut -d/ -f1)
elif command -v ifconfig >/dev/null 2>&1; then
    SERVER_IPS=$(ifconfig 2>/dev/null | awk '/inet / && !/127.0.0.1/ {print $2}')
fi

echo "Các máy tính trong mạng LAN có thể mở trình duyệt và truy cập:"
for ip in $SERVER_IPS; do
    echo "  👉 http://$ip:$EXT_PORT"
done
echo "Hoặc tại chính server: http://localhost:$EXT_PORT"
echo "============================================================"
