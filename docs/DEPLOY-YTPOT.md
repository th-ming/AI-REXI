# YouTube PO Token (bgutil) — kiến trúc & vận hành

> Cập nhật 24/9/2026. Dùng để vượt gate **"Sign in to confirm you're not a bot"** của YouTube
> khi backend chạy trên IP datacenter (Render). Đây là tính năng **env-gated**: không set
> `YTPOT_BASE_URL` thì mọi thứ chạy y như cũ (không phụ thuộc dịch vụ ngoài).

## 1. Thành phần

| Thành phần | Vị trí | Ghi chú |
|---|---|---|
| POT provider (HTTP) | Render **image-backed** web service `ai-rexi-ytpot` (`srv-daq6j4142hec738g97qg`) | image `docker.io/brainicism/bgutil-ytdlp-pot-provider:latest`, port 10000, health `/ping`, plan free, oregon. URL: `https://ai-rexi-ytpot.onrender.com` |
| yt-dlp plugin | `Backend/vendor/ytdlp-plugins/bgutil-ytdlp-pot-provider.zip` | yt-dlp standalone (youtube-dl-exec) **có** load plugin qua `--plugin-dirs` (đã kiểm chứng) |
| Wiring | `Backend/src/services/ytdlpService.js` | `potLadder()` chèn client `web`/`web_safari` no-cookie sau các client android nhanh; `potOptions()` thêm `--plugin-dirs`; `buildExtractorArgs()` thêm `youtubepot-bgutilhttp:base_url` |

## 2. Bật/tắt

- Bật: set env `YTPOT_BASE_URL=https://ai-rexi-ytpot.onrender.com` trên service backend (`srv-dajo7567bikc73crnjg0`) rồi redeploy.
- Tắt: xoá env `YTPOT_BASE_URL` (không cần đụng code). Provider có thể để chạy hoặc xoá.

## 3. Kiểm chứng

```
GET /api/services/youtube/status
→ { po_token:true, pot_provider:"https://ai-rexi-ytpot.onrender.com", pot_plugin:true }
POST /api/services/youtube/stream?url=<id>   # video thường (vd dQw4w9WgXcQ) → 200 format 18
```

## 4. Kết quả thực tế (24/9/2026) — GIỚI HẠN ĐÃ BIẾT

- Provider sống, plugin load, **token PO được sinh thật** (log provider `Generating POT ...`).
- **NHƯNG** các video bị gate (nhạc VEVO/official như `kJQP7kiw5Fk`, `9bZkp7q19f0`, `JGwWNGJdvx8`, `60ItHLz5WEA`)
  **vẫn fail** từ IP Render: mọi client no-cookie (kể cả `web`+PO token) đều `Sign in to confirm you're not a bot`;
  client + cookies login thật thì `The page needs to be reloaded` (Google chặn session từ datacenter).
- Kết luận: **PO token là điều kiện cần nhưng chưa đủ** khi IP egress bị YouTube gắn cờ mạnh
  (đúng như cảnh báo trong README bgutil). Video **không bị gate vẫn chạy 100%** (android → format 18).

## 5. Giải pháp thay thế (khi cần gate 100%)

1. **Proxy dân cư (residential)** cho riêng yt-dlp: `--proxy http://user:pass@host:port` (thêm env `YTDLP_PROXY`).
   Đây là cách duy nhất chắc chắn — đổi IP egress khỏi dải datacenter.
2. Chạy một **worker yt-dlp ở nhà** (IP dân cư) expose API nội bộ, backend gọi qua.
3. Chấp nhận: chỉ hỗ trợ video không gate (hiện trạng), hiển thị thông báo rõ cho video bị gate.

## 6. Bảo mật

Provider là HTTP **không xác thực** (theo thiết kế upstream, chặn request có `Origin`/cross-site).
Đã public qua Render (bắt buộc để backend gọi). Rủi ro: bị lạm dụng sinh token. Nếu không cần nữa → xoá service.
