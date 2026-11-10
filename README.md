# 🚀 AutoTest Studio (v8.0)

Hệ thống Kiểm thử Tự động Web End-to-End (E2E) bằng **Ngôn ngữ Tự nhiên Tiếng Việt** ứng dụng **AI LLM** (OpenAI-compatible / Groq / vLLM / Ollama) kết hợp **Browserbase Stagehand & Playwright Chromium**.

---

## ⚡ Hướng Dẫn Clone & Chạy Nhanh (Getting Started)

### Yêu cầu tiên quyết
- **Node.js**: Phiên bản 18+ trở lên (khuyên dùng Node.js LTS).
- **Trình duyệt**: Google Chrome hoặc Microsoft Edge (hoặc cài đặt Chromium qua Playwright).
- **Mô hình AI**: Có thể dùng **Groq API** (miễn phí/nhanh) hoặc bất kỳ máy chủ **LLM nội bộ (vLLM, Ollama, LiteLLM)** chuẩn OpenAI-compatible.

---

### Bước 1: Clone mã nguồn về máy
```bash
git clone https://github.com/chitienkhonglui6789/autotest-ai.git
cd autotest-ai
```

---

### Bước 2: Cài đặt Dependencies

1. **Cài đặt cho Backend (Node.js/Express & Playwright):**
   ```bash
   cd be
   npm install
   npx playwright install chromium
   cd ..
   ```

2. **Cài đặt cho Frontend (React/Vite & Tailwind CSS):**
   ```bash
   cd fe
   npm install
   cd ..
   ```

---

### Bước 3: Cấu hình Môi trường (.env)

Hệ thống đã có sẵn file mẫu `.env.example`. Bạn copy thành `.env` ở thư mục gốc hoặc thư mục `be/`:

```bash
cp .env.example .env
# Hoặc trên Windows PowerShell:
Copy-Item .env.example .env
```

Chỉnh sửa nội dung file `.env` theo nhu cầu của bạn:

#### Lựa chọn A: Dùng Groq Cloud (Dễ test nhất)
```env
LLM_PROVIDER=groq
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=openai/gpt-oss-120b
LLM_API_KEY=***
LLM_TIMEOUT_MS=60000
PORT=3000
HEADLESS=true
```

#### Lựa chọn B: Dùng Server LLM Nội bộ (vLLM / Ollama / LiteLLM trong mạng LAN)
```env
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=http://192.168.205.10:11434/v1/chat
LLM_MODEL=qwen3.8-27b
LLM_API_KEY=***
LLM_TIMEOUT_MS=90000
PORT=3000
HEADLESS=true
```

---

### Bước 4: Khởi chạy Ứng dụng

#### Cách 1: Khởi động 1-Click (Dành cho Windows)
Nhấp đúp chuột vào file:
👉 **`start.bat`** (hoặc mở Terminal gõ `.\start.bat`)

File script sẽ tự động khởi chạy cả Backend và Frontend, sau đó tự bật trình duyệt mở ứng dụng.

#### Cách 2: Khởi động thủ công qua 2 Terminal

- **Terminal 1 (Backend API & Trình chạy Test):**
  ```bash
  cd be
  npm run dev
  ```
  > Backend chạy tại: `http://localhost:3000`

- **Terminal 2 (Frontend Giao diện Web):**
  ```bash
  cd fe
  npm run dev
  ```
  > Giao diện người dùng chạy tại: `http://localhost:5173`

Mở trình duyệt truy cập: **`http://localhost:5173`**

---

### Cách 3: Chạy bằng Docker Compose (Khuyên dùng khi triển khai máy chủ)
```bash
docker compose up -d --build
```
> Truy cập ngay tại: **`http://<IP_MAY_CHU>:39793`**

---

## 🌟 Các Tính Năng Nổi Bật

1. **Soạn kịch bản Zero-Code:** Viết kịch bản kiểm thử 100% bằng tiếng Việt tự nhiên (mở trang, click, điền form, kiểm tra text).
2. **Khả năng tự thích nghi giao diện (Self-Healing DOM):** AI tự đọc hiểu cấu trúc HTML hiển thị để tìm đúng phần tử, không phụ thuộc vào XPath hay ID cố định.
3. **Bằng chứng hình ảnh trực quan (Visual Evidence):**
   - **Ảnh Trước:** Tự động bắt đúng phần tử đang tương tác với **viền đỏ nổi bật 4px**.
   - **Ảnh Sau:** Chụp lại giao diện sau khi hành động hoàn tất để kiểm chứng.
   - **Ảnh Lỗi:** Chụp lại toàn bộ màn hình khi kiểm thử thất bại kèm phân loại lỗi (`ASSERTION_FAILED`, `ELEMENT_NOT_FOUND`, `TIMEOUT`...).
4. **Báo cáo kiểm thử HTML độc lập:** Xuất 1 file HTML duy nhất nhúng sẵn toàn bộ ảnh Base64, mở xem offline không cần kết nối server.
5. **Độc lập Offline:** Tương thích hoàn toàn với các máy chủ AI nội bộ trong mạng LAN không cần kết nối Internet.

---

## 📖 Cẩm Nang Soạn Kịch Bản Tiếng Việt Chuẩn Xác

Tuân thủ cấu trúc 3 giai đoạn:
1. **Bước 1 (Mở trang):** `Vào trang https://www.saucedemo.com`
2. **Bước 2 (Thao tác):**
   - `Nhập standard_user vào ô Username`
   - `Nhập secret_sauce vào ô Password`
   - `Bấm nút Login`
3. **Bước 3 (Kiểm tra kết quả):**
   - `Kiểm tra xuất hiện chữ Products` *(Khẳng định rõ tiêu chí, không dùng câu hỏi nghi vấn mở như "xem có vào được không")*

---

## 📑 Tài Liệu Hướng Dẫn Chi Tiết
Tham khảo tài liệu hướng dẫn vận hành chi tiết:
- File PDF hướng dẫn: [`Huong-Dan-Su-Dung.pdf`](Huong-Dan-Su-Dung.pdf)
- Hướng dẫn triển khai Offline: [`HUONG_DAN_TRIEN_KHAI_OFFLINE.pdf`](HUONG_DAN_TRIEN_KHAI_OFFLINE.pdf)
