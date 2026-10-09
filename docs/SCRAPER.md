# Data Scraper Kit (`/api/scrape`)

Công cụ cào dữ liệu **ADDITIVE** cho Rexi AI: trích xuất thông tin / nội dung / bình luận / media
từ link mạng xã hội, video **và** trang web thường. Không phá vỡ tính năng cũ, không bao giờ
crash server (mọi endpoint bọc `try/catch` + `rateLimit`, luôn trả JSON `{ok:...}`).

> UI: mở **FAB (góc phải dưới)** → **Cào dữ liệu**, hoặc **Super Tools** → nút **Cào dữ liệu**.
> Panel có 3 tab: **Cào link** · **Kênh / Hôm nay** · **RAG**.

## Cào được gì

- **Social / video (qua yt-dlp worker IP nhà):** bất kỳ site nào **yt-dlp** hỗ trợ —
  YouTube, TikTok, Instagram, X/Twitter, Facebook, Vimeo, Dailymotion, Twitch, Reddit,
  SoundCloud, Pinterest, LinkedIn, Bilibili, Douyin, XiaoHongShu, Snapchat, Tumblr, Telegram,
  Bandcamp, Mixcloud, Streamable, Rumble, Odysee, Kick, Likee, Threads, Weibo, Youku, iQiyi…
- **Danh sách kênh / playlist (mới):** liệt kê video của một kênh/playlist qua worker `/list`
  (`yt-dlp --flat-playlist`), lọc được **chỉ video đăng hôm nay**. YouTube tốt nhất.
- **Web thường (fetch trực tiếp):** `title`, `description`, `og:image`, `og:site_name`,
  readable `text`, danh sách `links`.
- **Nạp vào RAG (mới):** chunk dữ liệu cào được → lưu vào **RAG store đang có** của app để chat
  trả lời dựa trên dữ liệu đó mà chỉ dùng vài chunk liên quan (**tiết kiệm token**).
  Xem [RAG.md](./RAG.md).

Phần social + danh sách kênh cần **worker yt-dlp** chạy local (`tools/ytdlp-worker/worker.js`)
để có IP dân dụng (YouTube/Instagram/Facebook chặn bot theo IP datacenter). Không cấu hình
worker → phần social/kênh báo lỗi rõ ràng; phần web vẫn chạy bình thường.

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

### `POST /api/scrape/channel` — `{ "url": "...", "limit": 20, "today": false }`
Liệt kê video của **kênh / playlist** qua worker `/list` (`yt-dlp --flat-playlist`).
`today=true` → chỉ giữ video có ngày đăng == hôm nay (theo giờ VN, UTC+7; derive từ `timestamp`).
YouTube tốt nhất; site khác **best-effort**. Nếu worker không list được → fallback `/info` trên
chính URL đó (1 mục); nếu vẫn không được → `{ "ok": false, "error": "..." }`.
```json
{ "ok": true, "platform": "youtube", "count": 3, "today_filtered": false,
  "items": [{ "id": "...", "title": "...", "url": "https://...",
              "uploader": "...", "published": "2026-10-09", "view_count": 12345 }] }
```

### `POST /api/scrape/ingest` — `{ "source": "...", "title": "...", "text": "..." | "items": [...] }`
Chunk `text` (hoặc ghép `items` title/description/link) → lưu vào **RAG store đang có**
(`ragService`, cùng bảng `tai_lieu_rag` + `tai_lieu_rag_chunk` như `/api/documents/upload`) →
mỗi `source` là 1 document. Đăng nhập → RAG vào đúng tài khoản (chat dùng được ngay);
không đăng nhập → scope `scrape-public`.
```json
{ "ok": true, "doc_id": "uuid", "chunks": 12, "chars": 10450, "source": "channel:youtube:...", "title": "..." }
```

### `POST /api/scrape/ask` — `{ "question": "...", "source": "..."?, "limit": 5 }`
Truy vấn RAG store (tái dùng `ragService.searchDocuments`) → trả **chỉ các chunk liên quan**
để caller feed cho model (thay vì dump toàn bộ text → tiết kiệm token). `source` (tuỳ chọn) lọc
theo tên document.
```json
{ "ok": true, "count": 3,
  "chunks": [{ "text": "...", "score": 0.78, "doc": "Kênh ..." }] }
```

### `POST /api/scrape/pipeline` — `{ "urls": ["..."], "channel": "..."?, "question": "..."?, "limit": 20 }`
Tiện lợi 1 call: crawl (`urls` từng link qua `/info`, và/hoặc `channel` qua `/list`) → **ingest
vào RAG** → nếu có `question` thì trả luôn **top chunks**. `urls` tối đa 10.
```json
{ "ok": true,
  "ingested": [{ "type": "url", "ok": true, "url": "...", "doc_id": "uuid", "chunks": 4 },
               { "type": "channel", "ok": true, "count": 20, "doc_id": "uuid", "chunks": 8 }],
  "chunks": [{ "text": "...", "score": 0.71, "doc": "..." }] }
```

## Giới hạn & rate limit

| Endpoint | Giới hạn (mỗi IP/user / 60s) |
|----------|------------------------------|
| `/status` | 120 |
| `/info`, `/page` | 30 |
| `/comments` | 15 |
| `/batch` | 10 |
| `/download` | 20 |
| `/channel` | 15 |
| `/ingest` | 20 |
| `/ask` | 30 |
| `/pipeline` | 10 |

- `batch` tối đa 10 url, chạy tuần tự (1 worker call 1 lúc).
- `comments.max` kẹp trong `[1, 100]`; `channel.limit` kẹp trong `[1, 100]`; `ask.limit` `[1, 20]`.
- Web fetch timeout **15s**; worker info **45s**; worker comments **100s**; worker list **100s**.
- URL phải bắt đầu bằng `http(s)://`; chặn SSRF (không cho trỏ vào IP/host nội bộ).

## CÁI GÌ CÀO ĐƯỢC / CÁI GÌ KHÔNG (nói thẳng)

**Cào tốt (công khai, không cần login):**
- **YouTube** — tốt nhất: video info, bình luận, danh sách kênh/playlist (kể cả "chỉ hôm nay").
- Web thường (bài viết, blog, trang tĩnh) — đọc trực tiếp, không cần worker.
- Các site public yt-dlp hỗ trợ: Vimeo, Twitch (VOD), Reddit, SoundCloud, Bilibili, Rumble…

**KHÔNG cào được (hoặc rất hạn chế) — cần login/cookies/API, không có thì thua:**
- **Facebook, Instagram (private/nội dung cần login)** — chặn IP datacenter + yêu cầu session;
  chỉ lấy được một phần khi worker có **cookies hợp lệ** (`COOKIES_FILE`).
- **Zalo** — không phải site yt-dlp hỗ trợ, không có API công khai → **không cào được**.
- Video **private / age-restricted / cần trả phí** — cần cookies tài khoản hợp lệ.
- Nội dung sau paywall, ứng dụng native, app yêu cầu đăng nhập (TikTok/XiaoHongShu cũng hay chặn).

**Lưu ý quan trọng:**
- "Biết mọi thứ về một kênh" chỉ **đáng tin với site public mà yt-dlp hỗ trợ (YouTube tốt nhất)**.
  Site khác là best-effort, có thể trả rỗng/lỗi — endpoint trả lỗi sạch chứ không bịa.
- `--flat-playlist` thường **không kèm ngày đăng / lượt xem** (nhất là YouTube) → `published`
  có thể `null`, và filter `today` khi đó sẽ loại các mục thiếu ngày. Muốn ngày chính xác phải
  lấy info từng video (chậm hơn) — hiện chưa làm để giữ nhanh.
- App có env **`YOUTUBE_COOKIES` / worker `COOKIES_FILE`** (`D:\Temp\opencode\yt-cookies.txt`)
  — nếu có cookies tài khoản hợp lệ, một số nội dung gate (age-restricted, một phần FB/IG) sẽ mở.

## Ghi chú đạo đức / ToS


Chỉ dùng để cào **nội dung công khai**. Việc cào dữ liệu phải **tuân thủ điều khoản sử dụng
(ToS) của từng nền tảng** và pháp luật hiện hành (quyền riêng tư, bản quyền). Không dùng để
thu thập dữ liệu cá nhân trái phép, phá hoại dịch vụ, hoặc né tránh cơ chế bảo vệ của nền tảng.
Người dùng tự chịu trách nhiệm về cách sử dụng dữ liệu cào được.
