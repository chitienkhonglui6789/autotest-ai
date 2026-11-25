#!/usr/bin/env bash
set -e

if [ ! -f .env ]; then
  echo "⚠️ Không tìm thấy file .env! Đang tự động tạo từ .env.example..."
  cp .env.example .env
  echo "👉 Vui lòng mở file .env và điền LLM_API_KEY trước khi khởi chạy."
  exit 1
fi

echo "🚀 Đang khởi chạy AutoTest Studio với Docker Compose..."
docker compose up -d --build

echo "✅ Hệ thống đã sẵn sàng tại: http://localhost:3000"
echo "📜 Xem log tiến trình: docker compose logs -f"
