# 🗺️ KẾ HOẠCH TỔNG THỂ — AI REXI + OpenCut (Sản phẩm cho khách, chạy trên VPS rác)

> Ngày lập: 10/08/2026
> Mục tiêu: **Khách dùng FREE 100%, chất lượng ngon, chạy trên VPS giá rẻ (~200k/tháng, không GPU)**

---

## 1. MỤC TIÊU & RÀNG BUỘC

| # | Ràng buộc | Chi tiết |
|---|---|---|
| 1 | **VPS rác** | ~1-2GB RAM, 1-2 CPU, không GPU → không chạy model nặng (Kimi K2, XTTS 1.8GB, Demucs, Wan2.1...) |
| 2 | **Khách free 100%** | Không thu phí trực tiếp, không giới hạn thô bạo, vẫn giữ quota mềm để chống spam |
| 3 | **Local-first triết lý** | Whisper/OCR/PDF chạy CPU được; cái nào quá nặng thì dùng API free (Groq, edge-tts) |
| 4 | **API key có sẵn** | 9 key đã lưu trong DB `khoa_api`: Gemini, Groq, NVIDIA, Cerebras, Cohere, OpenRouter, Mistral, OpenCode, GitHub + 109 model active |
| 5 | **Không phá luồng cũ** | Mọi thay đổi theo đúng pattern có sẵn của AI REXI (tab/FAB/modal) |

---

## 2. HIỆN TRẠNG (INVENTORY)

### 2.1 AI REXI — đã có ✅

| Chức năng | File chính | Ghi chú |
|---|---|---|
| Chat AI đa provider (SSE streaming) | `Frontend/src/App.jsx`, `Backend/src/routes/chat.routes.js` | Gemini/Groq/Mistral/NVIDIA... 109 model |
| Agent Mode (AI tự làm việc) | `Backend/src/routes/agent.routes.js` | admin-only (bảo mật) |
| TTS Studio (10 giọng Việt) | `Frontend/src/components/StudioTab.jsx`, `Backend` `/services/tts` | edge-tts server + Web Speech fallback |
| Video Creator (HTML→MP4) | `Frontend/src/components/VideoCreatorTab.jsx`, `/services/video/*` | render qua backend |
| IPTV Xem TV (200+ nước) | `Frontend/src/components/IPTVTab.jsx`, `/services/iptv/*` | HLS + phụ đề AI |
| Remote Desktop | inline trong App.jsx, `/services/desktop/*` | chụp + click |
| Browser Agent (Playwright WS) | `Frontend/src/components/BrowserView.jsx`, `/services/browser/*` | Stagehand |
| Workspace Files (D:\AI REXI) | `/workspace/*` | đọc/ghi file dự án |
| Super Tools (Terminal/Git/Memory) | inline App.jsx, `/chat/exec|git|memory` | |
| 35+ Skills | `SkillsModal.jsx`, `/services/skills` | |
| Admin Panel | `AdminPanel.jsx`, `/admin/*` | users/models/channels/logs |
| Auth (email + Google OAuth) | `Backend/src/routes/auth.routes.js` | guest: 10 msg + 3 agent |
| **PDF/DOCX extract (MỚI ✅)** | `/services/office/process-pdf?action=extract`, `/agent/process-file` | pdf-parse + mammoth, đã test OK |
| **OpenCut tab (MỚI ✅)** | `Frontend/src/components/OpenCutTab.jsx` (iframe) | FAB 🎨 Sáng Tạo + HelpModal |
| **YouTube Free (MỚI ✅)** | `YouTubeTab.jsx` + `/services/youtube/*` (yt-dlp) | Xem video không quảng cáo + Tóm tắt AI, đã test 13/13 |

### 2.2 OpenCut (D:/repos/OpenCut) — đã có ✅

| Nhóm | Chi tiết |
|---|---|
| Timeline | 8 loại element, snapping, ripple, group, scenes, bookmarks |
| Effects | 27 effects GPU (chroma-key, glitch, vhs, crt, lut3d...) |
| Transitions | 10 loại |
| Masks | shape + freeform bezier + text mask |
| Keyframes | bezier, interpolation, đầy đủ channel |
| Subtitle AI | Whisper ONNX local (tiny→large-v3-turbo), SRT/ASS |
| Export | MP4/WebM, 4 quality levels, WebGPU render |

### 2.3 Kho repo (D:/repos — 56 repos) — nguyên liệu chưa dùng 🟡

| Repo | Công dụng | Nặng/nhẹ | Dùng cho VPS rác? |
|---|---|---|---|
| VieNeu-TTS | TTS giọng Việt + clone (server 8124 hiện TẮT) | ~1-2GB RAM | ⚠️ chỉ khi VPS ≥4GB |
| WhisperX | Subtitle chuẩn + diarization | trung bình | ✅ CPU được |
| VideoLingo | Dịch + lồng tiếng video | nặng | ❌ VPS rác |
| Real-ESRGAN / SUPIR | Upscale 2K/4K | rất nặng | ❌ cần GPU |
| GPT-SoVITS / F5-TTS / CosyVoice | Voice cloning | nặng | ❌ VPS rác |
| LivePortrait / SadTalker / MuseTalk / LatentSync | Avatar + lip-sync | nặng | ❌ cần GPU |
| MoneyPrinterTurbo / ShortGPT | Auto shorts | trung bình | ✅ với API free |
| LTX-Video / Wan2.1 | Text→video | rất nặng | ❌ cần GPU |
| ACE-Step 1.5 | **AI tạo nhạc** | nặng | ❌ VPS rác |
| Marker / MinerU / Nougat | PDF→Markdown siêu chuẩn | trung bình | ✅ CPU được |
| OpenCut-AI | AI editor + 8 microservices + docker-compose GPU | nặng | ⚠️ bản lite |
| chunkr | PDF parsing | trung bình | ✅ |

### 2.4 API Keys trong DB (đã xác nhận từ `khoa_api`)

| Provider | Model active | Dùng cho |
|---|---|---|
| **groq** | 11 (whisper-large-v3, llama, qwen...) | STT + LLM free tier tốt nhất |
| **gemini** | 13 | Chat + Vision (đọc ảnh) |
| **mistral** | 32 | Chat + Agent |
| **nvidia** | 25 | LLM (NIM) |
| **openrouter** | 11 | Mọi model |
| **cerebras** | 3 | LLM siêu nhanh |
| **cohere** | 6 | RAG/Embeddings |
| **opencode** | 8 | Code agent |
| **github** | (models) | LLM qua GitHub Models |

---

## 3. KIẾN TRÚC MỤC TIÊU (VPS rác 1-2GB RAM)

```
                        ┌─────────────────────────────┐
   Khách (Browser) ───► │  Caddy (HTTPS miễn phí)     │
                        │   → /api/* → Backend Node   │
                        │   → /opencut → OpenCut Next  │
                        └─────────────┬───────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
   Backend AI REXI (Node)   OpenCut web (Next standalone)  SQLite (tro_ly_ai.db)
   - chat/agent/workspace   - editor WebGPU (client-side)
   - services: tts/iptv/    - Whisper ONNX local (client)
     desktop/browser/office
              │
              ├──► Groq API free  (whisper-large-v3, LLM)   ← key trong DB
              ├──► edge-tts       (giọng Việt, container nhẹ)
              └──► MinerU (tùy chọn) PDF scan nâng cao

Tổng RAM dự kiến: ~1.5GB (Node ~300MB + OpenCut ~400MB + SQLite + OS)
```

**Nguyên tắc:** Model nặng → chạy client-side (WebGPU/WebAssembly trong trình duyệt khách) hoặc API free. Server chỉ giữ phần nhẹ (Node + SQLite + edge-tts).

---

## 4. KẾ HOẠCH CHI TIẾT THEO GIAI ĐOẠN

### 🟢 PHASE 0 — NỀN TẢNG & VỆ SINH (đã xong 70%)

| # | Task | File đụng tới | Trạng thái | Verify |
|---|---|---|---|---|
| 0.1 | Fix 74 lint errors OpenCut (no-unsafe-assertion, prefer-object-params) | OpenCut ~30 file | ✅ XONG | eslint 0 errors |
| 0.2 | Tích hợp OpenCut thành tab AI REXI | OpenCutTab.jsx + config.js + App.jsx | ✅ XONG | oxlint + build |
| 0.3 | PDF/DOCX extract backend | services.routes.js + agent.routes.js | ✅ XONG | curl test OK |
| 0.4 | OpenCut vào HelpModal | HelpModal.jsx | ✅ XONG | oxlint 0 lỗi |
| 0.5 | Frontend: nút "Gửi PDF cho AI" trong ChatTab | ChatTab.jsx | ✅ XONG — test 3 lớp: UI + API + AI trả lời | build |
| 0.6 | Test tổng: mở app → chat → gửi PDF → AI trả lời | end-to-end | ✅ XONG — Playwright thật 13/13, DB xác nhận AI phân tích | browser test |

### 🟡 PHASE 1 — AI SERVICES NHẸ (ưu tiên cao, làm được trên VPS rác)

| # | Task | Cách làm | Ước lượng | Rủi ro |
|---|---|---|---|---|
| 1.1 | **STT qua Groq** — `/services/transcribe` dùng key groq trong DB (whisper-large-v3) | ✅ XONG — test thật: tiếng Việt 100% + dịch Anh→Việt chuẩn | 2-4h | key hết quota → fallback nên thêm |
| 1.2 | **Subtitle AI nâng cao**: nối WhisperX timestamps → SRT vào VideoCreator/OpenCut | script Python nhẹ / API | 4-6h | RAM |
| 1.3 | **PDF scan (OCR)**: MinerU cho PDF ảnh (PDF extract hiện không đọc được ảnh) | microservice MinerU | 1-2 ngày | nặng vừa |
| 1.4 | **VideoLingo lite**: dịch phụ đề (không lồng tiếng) qua LLM free | gọi LLM từ DB keys | 4h | — |
| 1.5 | **Tự động hóa 1 câu**: "Tóm tắt video này" → transcribe → LLM → markdown | ✅ XONG — /youtube/summarize: yt-dlp audio → Groq Whisper → LLM (fallback Gemini) | 1 ngày | Groq quota → có fallback Gemini |

### 🔵 PHASE 2 — NÂNG CẤP OPENCUT (vượt CapCut ở phần lõi)

| # | Task | Độ khó | File chính | Ghi chú |
|---|---|---|---|---|
| 2.1 | **Blend modes UI** (17 modes đã có trong renderer, thiếu panel) | ⭐⭐ | OpenCut properties panel | tác động lớn, dễ |
| 2.2 | **Reverse clip + Freeze frame** | ⭐⭐ | timeline ops | core đã có split/trim |
| 2.3 | **Speed ramps** (đường cong tốc độ) | ⭐⭐⭐ | retime + timeline UI | curve presets |
| 2.4 | **Loudness normalization** | ⭐ | audio-mastering.ts | thêm normalize dB |
| 2.5 | **4K / bitrate export** | ⭐⭐ | export options | mở rộng quality |
| 2.6 | **Text presets / WordArt** | ⭐⭐ | text rendering | thư viện style |

### 🟠 PHASE 3 — PRODUCTION & DEPLOY VPS (mục tiêu chính của bạn)

| # | Task | Chi tiết | Ước lượng |
|---|---|---|---|
| 3.1 | **Dockerfile Backend + Frontend** | multi-stage build, runtime Node slim | 1 ngày |
| 3.2 | **OpenCut Next standalone image** | `output: standalone` (đã cấu hình sẵn) | 4h |
| 3.3 | **docker-compose.prod.yml** | backend + opencut + caddy + edge-tts | 4h |
| 3.4 | **Caddy + HTTPS miễn phí** | auto TLS, reverse proxy, gzip | 2h |
| 3.5 | **systemd + auto-restart + backup SQLite** | cron backup hàng ngày | 2h |
| 3.6 | **Multi-tenant/quota mềm** | mỗi khách 1 workspace, giới hạn dung lượng | 1-2 ngày |
| 3.7 | **deploy.sh 1 lệnh** | cài Docker + compose up + Caddy | 2h |
| 3.8 | **Monitoring** | uptime + log + cảnh báo Telegram | 3h |
| 3.9 | **Billing tùy chọn** (free + premium nâng cao) | nếu sau này muốn thu | 2 ngày |

### 🟣 PHASE 4 — ĐIỂM KHÁC BIỆT (không bắt buộc, cần máy mạnh hơn)

| # | Task | Repo | Điều kiện |
|---|---|---|---|
| 4.1 | AI tạo nhạc nền (ACE-Step) | ACE-Step | VPS GPU hoặc máy riêng |
| 4.2 | Auto shorts hàng loạt | MoneyPrinterTurbo/ShortGPT | máy trung bình |
| 4.3 | Avatar đọc tin (lip-sync) | LivePortrait/MuseTalk | VPS GPU |
| 4.4 | Text→video | LTX-Video/Wan2.1 | VPS GPU |

---

## 5. BẢNG ƯU TIÊN THEO RÀNG BUỘC "VPS RÁC + FREE + NGON"

| Thứ tự | Việc | Vì sao ưu tiên | Điều kiện cần |
|---|---|---|---|
| 🥇 1 | Phase 1.2-1.5 (Subtitle nâng cao, PDF OCR, dịch sub, tóm tắt video) | Giá trị cao nhất cho khách, chạy CPU/API free | key Groq còn quota |
| 🥈 2 | Phase 3 (deploy VPS) | Đưa sản phẩm ra khách thật | VPS + domain |
| 🥉 3 | Phase 2 (blend modes, speed ramps...) | OpenCut vượt CapCut phần lõi | chỉ cần thời gian |
| 4 | Phase 0.5-0.6 (UI upload PDF, test tổng) | Hoàn thiện trải nghiệm | — |
| 5 | Phase 4 | Khác biệt, cần máy mạnh hơn | nâng cấp VPS |

---

## 6. RỦI RO & GIẢM THIỂU

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Key API hết quota (Groq free) | 🟡 | fallback: nếu Groq lỗi → chuyển Whisper local hoặc Gemini |
| VPS 1GB không đủ RAM | 🟠 | SQLite thay Postgres, tắt node_modules dev, giới hạn worker |
| OpenCut iframe CORS/security | 🟢 | OpenCut `output: standalone` + headers Caddy |
| Model nặng khách tải nhiều (Whisper ONNX ~500MB) | 🟡 | lazy-load, cache, chỉ tải khi dùng |
| Agent routes admin-only (khách không dùng được) | 🟡 | giữ nguyên bảo mật, tạo route riêng cho khách có giới hạn |
| VieNeu-TTS chưa bật server | 🟢 | dùng edge-tts trước, bật VieNeu sau nếu RAM cho phép |

---

## 7. TIẾP THEO NGAY (3 việc đầu tiên khi bạn duyệt)

1. **0.5** — Thêm nút "Gửi PDF cho AI" vào ChatTab (Frontend) để khách dùng được tính năng đã làm
2. ~~**1.1** — Kiểm tra/nối Groq STT vào `/services/transcribe`~~ ✅ XONG (10/08/2026)
3. **3.1-3.4** — Viết bộ Dockerfile + docker-compose.prod + Caddy → deploy thử lên VPS

> Mỗi task hoàn thành → chạy `oxlint` + `npm run build` + test API bằng curl (đúng quy trình đã làm).

---

## 8. BÁO CÁO TỔNG KẾT 10/08/2026 — TÍNH NĂNG MỚI & FIX BUG

### ✅ Đã hoàn thành & test thực tế

| # | Tính năng | Kết quả test | Ghi chú |
|---|---|---|---|
| 1 | 🎮 Game Zone (Pac-Man, Snake, Pong, Tetris, Space Invaders, ...) | ✅ PASS | iframe game chạy ổn, đổi game mượt |
| 2 | 📄 PDF Scan OCR (LightOnOCR-2-1B local, port 8099) | ✅ PASS `ocr_used=True` | text nhận diện chính xác |
| 3 | 📝 Summarize YouTube + SRT (Groq) | ✅ PASS 49 timestamps | phụ đề có timestamp đầy đủ |
| 4 | 🛰️ IPTV "Phụ Đề Kênh" (track nhúng, đồng bộ 100%) | ✅ PASS | nút hiện khi kênh có phụ đề nhúng (VD: kênh phim Pluto TV) |
| 5 | 🛰️ IPTV "Phụ Đề AI" — cảnh báo trễ 7-10s | ✅ PASS | tooltip giải thích rõ độ trễ + quota |
| 6 | Console sạch, không lỗi CORS | ✅ PASS | sau fix proxy |

### 🐛 Bug đã sửa

| Bug | Nguyên nhân | Fix |
|---|---|---|
| Kênh Pluto TV (jmp2.uk) không phát qua proxy | Redirect tới stitcher-ipv4.pluto.tv trả content-type `x-mpegURL` (hoa X) — regex case-sensitive bỏ qua | Check content-type case-insensitive + `.m3u8` bất kể hoa thường |
| Playlist CRLF (`
`) không rewrite được | Regex chỉ match LF | Chuẩn hoá CRLF→LF trước khi rewrite |
| OCR kẹt 5+ phút / không bao giờ xong | ① Render PDF scale=2.0 → ảnh 8.7MP quá khổ cho CPU ② float16 trên CPU gây NaN → generate chạy hết 1024 token không dừng | ① Giới hạn ảnh MAX_DIM=1600px + scale 1.0 ② Quay lại float32 (float16 trên CPU bị NaN) |
| Nút "Phụ Đề Kênh" không hiện dù stream có track nhúng | hls.js populate `subtitleTracks` sau sự kiện MANIFEST_PARSED | Thêm `readEmbeddedSubs()` đọc trễ 1.2s + lắng nghe SUBTITLE_TRACKS_LOADED |

### 📊 Hiệu năng OCR sau tối ưu

| Phiên bản | Thời gian/trang |
|---|---|
| Trước (scale 2.0 + float32, ảnh 8.7MP) | kẹt 5+ phút |
| Sau (scale 1.0 + MAX_DIM 1600, float32) | **~70s** (load model 6s + generate) |

> Ghi chú: float16 gây `RuntimeError: probability tensor contains inf/nan` trên CPU — không dùng.

### ⚠️ Giới hạn còn lại

- **OCR chậm trên máy CPU yếu / RAM 8GB** — model 2.1B float32 ~4.5GB RAM; nâng cấp máy hoặc dùng GPU sẽ nhanh hơn nhiều
- **Phụ đề AI (nghe + dịch) trễ 7-10s** — giới hạn vật lý của caption live; khuyến nghị dùng "Phụ Đề Kênh" (track nhúng) khi có
- **Login test false-negative** — browser session có sẵn trong localStorage nên form không hiện (test artifact, không phải bug; API login riêng vẫn PASS)

### 🔜 Việc tiếp theo đề xuất

1. Deploy VPS (Docker + Caddy) để ra thị trường
2. Cache kết quả OCR theo file hash (tránh xử lý lại file trùng)
3. Thêm nút "Gửi PDF cho AI" vào ChatTab cho khách
4. Dịch phụ đề nhúng (track EN → tiếng Việt) bằng Groq free
