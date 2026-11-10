# 🚀 Hướng Dẫn Triển Khai AutoTest Studio Cho Mạng LAN Không Internet

Tài liệu này hướng dẫn cách đóng gói và triển khai hệ thống **AutoTest Studio** lên một máy chủ Linux nội bộ (offline hoàn toàn, không có kết nối ra Internet).

---

## 📋 Mục lục
1. [Nguyên lý hoạt động](#-nguyen-ly-hoat-dong)
2. [Bước 1: Đóng gói tại máy có Internet & Docker](#-buoc-1-dong-goi-tai-may-co-internet--docker)
3. [Bước 2: Chuyển gói sang Server Linux Offline](#-buoc-2-chuyen-goi-sang-server-linux-offline)
4. [Bước 3: Cấu hình và Chạy trên Server Linux](#-buoc-3-cau-hinh-va-chay-tren-server-linux)
5. [Cấu hình AI/LLM trong mạng LAN nội bộ](#-cau-hinh-aillm-trong-mang-lan-noi-bo)
6. [Các lệnh quản trị hữu ích](#-cac-lenh-quan-tri-huu-ich)

---

## 💡 Nguyên lý hoạt động

- Ứng dụng đã được tích hợp thành **1 Container duy nhất**:
  - Backend (Node.js Express + Playwright / Chromium Headless).
  - Frontend (React + Vite đã build static và được Express phục vụ trực tiếp, ánh xạ ra cổng `39793`).
- Toàn bộ dependencies (Node modules, Chromium binary, hệ thống font chữ) được nén gọn trong Docker image `autotest-studio:latest`.
- Trên máy chủ Linux offline, hệ thống **không cần tải bất kỳ package nào từ Internet**, chỉ cần nạp image từ file `.tar` và khởi chạy.

---

## 📦 Bước 1: Đóng gói tại máy có Internet & Docker

Thực hiện trên máy tính của bạn (hoặc máy CI/CD) có Internet và đã cài Docker:

### Trên Windows:
Nhấp đúp chuột vào file:
👉 **`build-and-export.bat`** (hoặc mở Terminal gõ `.\build-and-export.bat`)

### Trên Linux / macOS:
```bash
chmod +x build-and-export.sh
./build-and-export.sh
```

**Kết quả:** Một thư mục có tên `offline-package/` sẽ được tạo ra với các file:
- `autotest-studio-offline.tar` (chứa toàn bộ ứng dụng và Chromium)
- `docker-compose.yml`
- `deploy.sh`
- `.env` / `.env.example`
- `README.md`

---

## 🚚 Bước 2: Chuyển gói sang Server Linux Offline

Copy toàn bộ thư mục `offline-package` sang máy chủ Linux nội bộ bằng một trong các cách:
- Copy qua **USB Flash Drive / Ổ cứng di động**.
- Copy qua mạng nội bộ bằng lệnh `scp`:
  ```bash
  scp -r offline-package user@<server-ip>:/opt/autotest-studio
  ```
- Copy qua thư mục chia sẻ nội bộ (Samba / NFS).

---

## 🚀 Bước 3: Cấu hình và Chạy trên Server Linux

Trên máy chủ Linux (yêu cầu máy chủ đã có Docker engine):

1. Mở Terminal và di chuyển vào thư mục vừa copy:
   ```bash
   cd /path/to/offline-package
   ```

2. Kiểm tra/chỉnh sửa file cấu hình `.env` (nếu cần đổi cổng hoặc cấu hình LLM):
   ```bash
   nano .env
   ```

3. Cấp quyền thực thi và chạy script tự động:
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

Script sẽ tự động:
- Nạp image `autotest-studio-offline.tar` vào Docker engine.
- Tạo các thư mục lưu dữ liệu lịch sử (`data`) và ảnh chụp màn hình (`screenshots`).
- Khởi chạy container với cờ tối ưu cho headless Chromium (`--shm-size=1gb`, `--no-sandbox`).
- In ra các địa chỉ IP mạng LAN để truy cập.

Truy cập trên trình duyệt web:
👉 **`http://<IP-CỦA-SERVER-LINUX>:39793`**

---

## 🧠 Cấu hình AI/LLM trong mạng LAN nội bộ

Vì máy chủ không có Internet, bạn có 2 tùy chọn cung cấp dịch vụ LLM:

### Cách 1: Dùng LLM Server cục bộ trong mạng LAN (Khuyên dùng)
Nếu trong LAN có máy chủ chạy **LiteLLM**, **vLLM**, **Ollama**, hoặc bất kỳ LLM server nào (Qwen, Llama, DeepSeek):
Sửa file `.env`:
```env
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=http://<IP-SERVER>:5000/api
LLM_MODEL=qwen3.8-27b
LLM_API_KEY=***
```

### Cách 2: Máy chủ có HTTP Proxy định tuyến ra Internet hoặc dùng cloud
Nếu máy chủ Linux gọi ra các nhà cung cấp OpenAI, Groq:
Sửa file `.env`:
```env
LLM_PROVIDER=groq
LLM_BASE_URL=https://api.openai.com/v1 (hoặc https://api.groq.com/openai/v1)
LLM_MODEL=gpt-4o-mini (hoặc qwen3.8-27b)
LLM_API_KEY=***
```

---

## 🛠️ Các lệnh quản trị hữu ích

- **Xem log thời gian thực:**
  ```bash
  docker logs -f autotest-studio
  ```
- **Khởi động lại:**
  ```bash
  docker restart autotest-studio
  # Hoặc nếu dùng compose:
  docker compose restart
  ```
- **Dừng hệ thống:**
  ```bash
  docker stop autotest-studio
  # Hoặc nếu dùng compose:
  docker compose down
  ```
- **Dữ liệu được lưu trữ ở đâu?**
  - Lịch sử kiểm thử: `./data/history.json`
  - Ảnh chụp màn hình: `./screenshots/`
  Cả 2 thư mục này nằm ngay trên ổ cứng máy chủ Linux và không bị mất khi xóa hoặc cập nhật container.

