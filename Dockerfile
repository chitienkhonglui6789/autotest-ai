# ==============================================================================
# GIAI ĐOẠN 1: ĐÓNG GÓI GIAO DIỆN FRONTEND (Vite / React Studio)
# ==============================================================================
FROM node:22-bookworm-slim AS fe-builder
WORKDIR /app/fe

# Cache dependency layer
COPY fe/package*.json ./
RUN npm install

# Copy source và build giao diện tĩnh
COPY fe/ ./
RUN npm run build

# ==============================================================================
# GIAI ĐOẠN 2: RUNTIME MÁY CHỦ KIỂM THỬ & PLAYWRIGHT CHROMIUM
# ==============================================================================
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    CLIENT_DIST_DIR=/app/fe/dist \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0

WORKDIR /app

# Cài đặt các thư viện Backend
WORKDIR /app/be
COPY be/package*.json ./
RUN npm install

# Cài đặt Chromium cùng toàn bộ thư viện Linux cần thiết (fonts, libgbm, nss...)
RUN npx playwright install --with-deps chromium

# Đưa bản build giao diện Frontend từ Giai đoạn 1 vào
WORKDIR /app
COPY --from=fe-builder /app/fe/dist /app/fe/dist

# Đưa mã nguồn Backend vào
COPY be/ /app/be/

# Tạo sẵn thư mục lưu trữ dữ liệu (SQLite và Ảnh chụp màn hình)
RUN mkdir -p /app/be/data /app/be/screenshots

EXPOSE 3000

# Thư mục lưu trữ bền vững (mount ra volume ngoài)
VOLUME ["/app/be/data", "/app/be/screenshots"]

WORKDIR /app/be
CMD ["node", "src/server.js"]
