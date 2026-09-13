#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# AI REXI — Deploy 1 lệnh lên VPS
#
# Yêu cầu trên VPS: Docker + Docker Compose plugin
#   curl -fsSL https://get.docker.com | sh
#
# Trước khi chạy: sửa DOMAIN trong .env (cp deploy/.env.example .env)
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")/.."   # về thư mục gốc AI REXI

# Tạo .env nếu chưa có
if [ ! -f .env ]; then
  cp deploy/.env.example .env
  echo "⚠️  Đã tạo .env — SỬA DOMAIN=rexi.domain.com rồi chạy lại lệnh."
  exit 1
fi

DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2 | tr -d '[:space:]')
if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "rexi.example.com" ]; then
  echo "❌ Chưa đặt DOMAIN trong .env"
  exit 1
fi

echo "🚀 Deploy AI REXI → https://$DOMAIN"
docker compose -f deploy/docker-compose.prod.yml up -d --build

echo ""
echo "✅ XONG! Truy cập: https://$DOMAIN"
echo "   Xem log:  docker compose -f deploy/docker-compose.prod.yml logs -f"
