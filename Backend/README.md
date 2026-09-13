# AI REXI — Backend

Self-host AI assistant backend. Chạy local hoặc deploy Render/Railway.

## Yêu cầu

- Node.js >= 18
- SQLite (local) hoặc PostgreSQL (prod)
- Env vars xem `.env.example`

## Cài đặt nhanh

```bash
cd Backend
cp .env.example .env   # nếu có
npm install
npm start
```

Mặc định chạy ở `http://localhost:3000`.

## Env quan trọng

| Biến | Mô tả |
|------|--------|
| `PORT` | Port server (default 3000) |
| `JWT_SECRET` | Secret ký JWT (prod nên set cố định) |
| `ENC_KEY` | 32 bytes hex — mã hóa API key lưu DB (fallback từ JWT_SECRET nếu thiếu) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Tài khoản admin ban đầu (khuyên dùng) |
| `GITHUB_TOKEN` | GitHub token (optional, fallback sang DB) |
| `GROQ_API_KEY` | Groq key (Tự động lấy từ CSDL SQLite bảng `khoa_api`, `.env` chỉ là fallback) |
| `GEMINI_API_KEY` | Gemini key (optional, fallback sang DB) |

## API chính

- `POST /api/auth/login` — đăng nhập
- `POST /api/auth/register` — đăng ký
- `GET /api/chat/stream` — chat streaming
- `GET /api/models` — danh sách model
- `POST /api/admin/models/publish-active` — đẩy model working lên trang chủ
- `GET /api/admin/logs` — xem audit log
- `POST /api/admin/cleanup` — dọn logs/cache cũ (body: `{ days?: 30 }`)
- `GET /api/admin/iptv/*` — IPTV monitor

## Lưu ý

- Dữ liệu memory/context lưu trong DB (`bo_nho_dai_han`, `context_sessions`)
- File `Database/sessions.json` sẽ tự động migrate sang DB khi khởi động lần đầu
- Không commit `.env` lên git

## License

ISC
