# Data Scraper Kit (`/api/scrape`)

Công cụ cào dữ liệu **ADDITIVE** cho Rexi AI: trích xuất thông tin / nội dung / bình luận / media
từ link mạng xã hội, video **và** trang web thường. Không phá vỡ tính năng cũ, không bao giờ
crash server (mọi endpoint bọc `try/catch` + `rateLimit`, luôn trả JSON `{ok:...}`).

> UI: mở **FAB (góc phải dưới)** → **Cào dữ liệu**, hoặc **Super Tools** → nút **Cào dữ liệu**.

## Cào được gì

- **Social / video (qua yt-dlp worker IP nhà):** bất kỳ site nào **yt-dlp** hỗ trợ —
  YouTube, TikTok, Instagram, X/Twitter, Facebook, Vimeo, Dailymotion, Twitch, Reddit,
  SoundCloud, Pinterest, LinkedIn, Bilibili, Douyin, XiaoHongShu, …
- **Web thường (fetch trực tiếp):** `title`, `description`, `og:image`, `og:site_name`,
  readable `text`, danh sách `links`.

Phần social cần **worker yt-dlp** chạy local (`tools/ytdlp-worker/worker.js`) để có IP dân dụng
(YouTube/Instagram/Facebook chặn bot theo IP datacenter). Không cấu hình worker → phần social
báo lỗi rõ ràng; phần web vẫn chạy bình thường.

## Cấu hình

| Env | Ý nghĩa |
|-----|---------|
| `YTDLP_WORKER_URL` | URL worker yt-dlp (Cloudflare quick tunnel trỏ về máy local) |
| `YTDLP_WORKER_TOKEN` | Token gọi worker (worker kiểm tra `?token=`) |

Không set `YTDLP_WORKER_URL` → `GET /api/scrape/status` trả `ytdlp_worker.configured = false`.

## Endpoints

Tất cả nhận/trả JSON. Endpoint lỗi trả `{ "ok": false, "error": "..." }` (HTTP 4xx).

### `GET /api/scrape/status`
Public, nhẹ.
```json
{
  "ok": true,
  "ytdlp_worker": { "configured": true, "url": "https://<tunnel>" },
  "web": true,
  "supports": ["youtube","tiktok","instagram","twitter/x","facebook", "…","generic-web"]
}
```

### `POST /api/scrape/info` — `{ "url": "..." }`
Thử worker yt-dlp trước; nếu không có/không được → fallback đọc web.
```json
{
  "ok": true,
  "source": "ytdlp",            // hoặc "web"
  "data": {
    "title": "...", "uploader": "...", "duration": 212,
    "upload_date": null, "description": "...", "thumbnail": null,
    "view_count": 12345, "like_count": null, "comment_count": null,
    "webpage_url": "...", "extractor": "worker-ytdlp",
    "formats": [{ "format_id": "18", "ext": "mp4", "resolution": "360p", "filesize": null }],
    "stream_url": "https://<tunnel>/stream?..."
  }
}
```
Fallback web → `data`: `{ title, description, og_image, og_site_name, text(≤5000), links[] }`.

### `POST /api/scrape/page` — `{ "url": "..." }`
Chỉ đọc nội dung text.
```json
{ "ok": true, "source": "web", "data": { "title": "...", "text": "…", "lang": "en" } }
```

### `POST /api/scrape/comments` — `{ "url": "...", "max": 30 }`
Bình luận qua worker (yt-dlp `--write-comments`). Cần worker.
```json
{ "ok": true, "source": "ytdlp", "count": 30,
  "data": [{ "author": "...", "text": "...", "like_count": 12, "published": "2025-01-01" }] }
```

### `POST /api/scrape/batch` — `{ "urls": ["...", "..."] }`
Lặp tuần tự tối đa **10** url (mỗi lần 1 call worker).
```json
{ "ok": true, "count": 2, "results": [ { "ok": true, "url": "...", "source": "web", "data": {…} } ] }
```

### `POST /api/scrape/download` — `{ "url": "..." }`
Trả **URL media trực tiếp** + headers (KHÔNG proxy bytes).
```json
{ "ok": true, "source": "ytdlp", "url": "...", "media_url": "https://...",
  "formats": [{ "format_id": "18", "ext": "mp4", "resolution": "360p", "filesize": null }],
  "headers": {}, "cookies_note": "..." }
```
Không lấy được → `{ "ok": false, "error": "..." }`.

## Giới hạn & rate limit

| Endpoint | Giới hạn (mỗi IP/user / 60s) |
|----------|------------------------------|
| `/status` | 120 |
| `/info`, `/page` | 30 |
| `/comments` | 15 |
| `/batch` | 10 |
| `/download` | 20 |

- `batch` tối đa 10 url, chạy tuần tự (1 worker call 1 lúc).
- `comments.max` kẹp trong `[1, 100]`.
- Web fetch timeout **15s**; worker info **45s**; worker comments **100s**.
- URL phải bắt đầu bằng `http(s)://`; chặn SSRF (không cho trỏ vào IP/host nội bộ).

## Ghi chú đạo đức / ToS

Chỉ dùng để cào **nội dung công khai**. Việc cào dữ liệu phải **tuân thủ điều khoản sử dụng
(ToS) của từng nền tảng** và pháp luật hiện hành (quyền riêng tư, bản quyền). Không dùng để
thu thập dữ liệu cá nhân trái phép, phá hoại dịch vụ, hoặc né tránh cơ chế bảo vệ của nền tảng.
Người dùng tự chịu trách nhiệm về cách sử dụng dữ liệu cào được.
