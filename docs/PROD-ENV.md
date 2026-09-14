# AI REXI — Biến môi trường Production (Render)

Chỉ liệt kê **tên** biến + cách tạo/xoay. Không bao giờ ghi giá trị secret vào repo.

## Bắt buộc (backend khởi động mới đủ chức năng)

| Biến | Ý nghĩa | Ghi chú |
|---|---|---|
| `DB_TYPE` | Loại DB | Prod = `postgresql` (local = `sqlite`). Adapter chọn theo biến này (`Backend/src/config/db.js`). |
| `PGHOST` | Host Postgres | Prod: `aws-0-ap-southeast-1.pooler.supabase.com` (session pooler — IPv4, WAN được). |
| `PGPORT` | Port | `5432`. |
| `PGDATABASE` | DB | `postgres` (Supabase free: dùng DB gốc `postgres`, schema `public`). |
| `PGUSER` | User | `rexi.<project-ref>` (role thường, **không** dùng `postgres` superuser của app). |
| `PGPASSWORD` | Mật khẩu role `rexi` | Lấy từ Dashboard Render (masked). Xoay: chạy `ALTER ROLE rexi WITH PASSWORD '...'` bằng client `pg` với credential cũ, rồi cập nhật env Render. |
| `PGSSL` | Bật SSL | Prod = `true`. `db.<ref>.supabase.co` là IPv6-only → Render/Windows không tới được qua public, nên dùng pooler + ssl verify-off trong adapter. |
| `JWT_SECRET` | Ký access/refresh token | **Phải giữ nguyên** sau khi tạo — đổi = mọi mật khẩu đã mã hóa trong `khoa_api` giải mã sai (kiến trúc: derive ENC key từ JWT). |
| `PORT` | Cổng listen | Render tự set (`10000`). |

## Tùy chọn (tính năng tắt nếu thiếu)

| Biến | Tính năng |
|---|---|
| `GROQ_API_KEY` | Tóm tắt AI repo trending (`github-trending-scheduler.js`; model qua `GROQ_SUMMARY_MODEL`, mặc định `openai/gpt-oss-20b`).Key cũng có thể đặt trong DB `khoa_api`. |
| `GROQ_SUMMARY_MODEL` | Override model Groq cho summaries. |
| `GITHUB_TOKEN` | Tăng rate-limit GitHub scheduler — repo công khai không bắt buộc. |
| `ENC_KEY` | Mã hóa `khoa_api.gia_tri_khoa`. Prod **cố ý không set** → backend derive từ `JWT_SECRET`; nếu set phải là chuỗi 64-hex cố định, đừng đổi về sau. |

## Vận hành

- Import/seed SQLite → PG: admin → `POST /api/admin/import-sqlite` (builder node:sqlite, chạy trên Render Linux được). **Sau khi import có INSERT id tường minh → chạy `setval` mọi sequence** (`saved_repos`, `audit_log`, `trending_cache`, `iptv_*`, `repo_summaries`, ...) nếu không mọi INSERT mới sẽ PK-collision.
- Health: `GET /api/health` → phải trả `db_type:"postgresql"`, `db:"connected"`.
- Supabase free: project **tự pause** nếu inactive dài; Render free: spin-down ~15' — request đầu chậm 30–60s.

## Xoay mật khẩu DB (không downtime)

1. SQL editor Supabase (role `postgres`) → `ALTER ROLE rexi WITH PASSWORD (mới)`.
2. Render Dashboard → Environment → đổi `PGPASSWORD` → Apply (auto redeploy).
3. `GET /api/health` xanh → xong. Pool kết nối lại sau redeploy.

## Data đã import (prod hiện tại)

`nguoi_dung 23` (kèm tài khoản `admin`), `ai_models 529`, `khoa_api 12` (provider keys, encrypt), `cuoc_hoi_thoai 100`, `tin_nhan 223`, `iptv_channels ~8973`, `audit_log 4k+`, `repo_summaries`, `trending_cache`, `ky_nang 45`. Schema tạo qua `init-db` path PG + `ALTER otp_expiry bigint` + `setval` sequences.
