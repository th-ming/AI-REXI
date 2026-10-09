# RAG — Truy vấn dữ liệu cào được (tiết kiệm token)

Rexi AI đã có sẵn **RAG** ("đọc & hiểu file"): upload file → trích text → chunk → vector hóa
(Gemini embedding) → khi hỏi thì lấy các chunk gần nghĩa nhất đưa vào context
(`Backend/src/services/ragService.js`, bảng `tai_lieu_rag` + `tai_lieu_rag_chunk`,
route `/api/documents`).

Bản này **nối thêm** dữ liệu cào được (từ Data Scraper Kit) vào **đúng RAG đó** — không tạo
hệ thống mới. Nhờ vậy chat trả lời dựa trên dữ liệu cào mà **chỉ nạp vài chunk liên quan**
thay vì dump toàn bộ text thô ⇒ **tốn ít token hơn nhiều**.

## Cách dùng (API)

1. **Nạp** — `POST /api/scrape/ingest`
   `{ "source": "channel:youtube:@NASA", "title": "...", "text": "..." }`
   hoặc `{ "source": "...", "title": "...", "items": [ {title, description, url, ...} ] }`
   → `{ ok, doc_id, chunks, chars }`. Mỗi `source` là 1 document trong RAG.

2. **Hỏi** — `POST /api/scrape/ask` `{ "question": "...", "source": "...", "limit": 5 }`
   → `{ ok, count, chunks: [{ text, score, doc }] }`.
   **Chỉ feed `chunks` này cho model** — không gửi cả corpus.

3. **1 call trọn gói** — `POST /api/scrape/pipeline`
   `{ "urls": ["..."], "channel": "https://youtube.com/@x", "question": "..." }`
   → crawl + ingest + trả top chunks.

## UI

Panel **Cào dữ liệu** → tab **RAG**:
- Nút **"Nạp kết quả vào RAG"** nạp kết quả cào gần nhất (kênh hoặc link).
- Ô **hỏi** + nút **Hỏi** → hiển thị các chunk liên quan (kèm score + tên doc).

## Phạm vi RAG (ai thấy gì)

- **Đã đăng nhập:** ingest vào scope = `ma_nguoi_dung` của bạn → **chat của bạn dùng được ngay**
  (cùng RAG store với file upload ở `/api/documents`).
- **Chưa đăng nhập:** dùng scope chung `scrape-public` (vẫn hỏi được qua `/ask`, nhưng không
  trộn vào RAG riêng của user nào).

## Embedding & chi phí

- Vector hóa bằng **Gemini embedding** (`brain/memory/embedding-service`) — cần key Gemini
  đã cấu hình (giống RAG file sẵn có). Thiếu key → chunk vẫn lưu nhưng **không có vector** ⇒
  `/ask` trả ít/rỗng (guarded, không crash).
- Vector hóa chunk chạy **fire-and-forget** (không chặn response của `/ingest`), giống
  `saveDocument`. Ngay sau khi `/ingest` trả về, chunk có thể **chưa embed xong** — chờ vài giây
  rồi `/ask` nếu chưa thấy kết quả.
- Lưu ý kỹ thuật: `searchDocuments` dùng pgvector KNN khi `db.type === 'postgresql'`, ngược lại
  fallback cosine trong JS. Cả hai đường đều tái dùng nguyên từ `ragService` — không đổi hành vi.

## Giới hạn / cái gì KHÔNG cào được

Xem mục **"CÁI GÌ CÀO ĐƯỢC / CÁI GÌ KHÔNG"** trong [SCRAPER.md](./SCRAPER.md). Tóm tắt:
Facebook/Instagram private, **Zalo**, nội dung sau paywall, app native, video private/age-
restricted → **không cào được nếu không có cookies/API hợp lệ**. "Biết mọi thứ về một kênh"
chỉ đáng tin với **site public mà yt-dlp hỗ trợ (YouTube tốt nhất)**. Cookies
(`YOUTUBE_COOKIES` / worker `COOKIES_FILE`) mở được một số nội dung gate.
