$ErrorActionPreference = "Stop"

if (!(Test-Path ".env")) {
    Write-Host "⚠️ Không tìm thấy file .env! Đang tự động sao chép từ .env.example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "👉 Vui lòng mở file .env và điền LLM_API_KEY trước khi khởi chạy." -ForegroundColor Cyan
    exit 1
}

Write-Host "🚀 Đang khởi chạy AutoTest Studio với Docker Compose..." -ForegroundColor Green
docker compose up -d --build

Write-Host "✅ Hệ thống đã sẵn sàng tại: http://localhost:3000" -ForegroundColor Green
Write-Host "📜 Xem log tiến trình: docker compose logs -f" -ForegroundColor Gray
