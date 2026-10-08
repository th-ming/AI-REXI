# Social Posting Connectors (X / TikTok / Instagram)

Trạng thái: **SCAFFOLD** — code đã sẵn sàng, chỉ cần bật env key là chạy.
Khi thiếu key, `GET /api/social/status` trả `configured:false` và mọi endpoint
mutate trả `503 { "ok": false, "error": "not_configured" }`. App hiện tại không bị ảnh hưởng.

- Backend: `Backend/src/services/social.js`, `Backend/src/routes/social.routes.js` (mount tại `/api/social`).
- Frontend: `Frontend/src/components/SocialConnect.jsx` (nằm trong modal Cài đặt, mục "Mạng xã hội").
- Token lưu per-user ở bảng `social_oauth_tokens` (mã hoá AES-256-GCM qua `utils/cryptoKeys`).

## Endpoints

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/api/social/status` | `{ok:true, platforms:{x:{configured,connected,account}, tiktok:{...}, instagram:{...}}}` |
| GET | `/api/social/:platform/connect` | Redirect tới provider authorize URL. Có thể kèm `?token=<JWT>` để gắn token đúng user. |
| GET | `/api/social/:platform/callback` | Đổi code → token → lưu → redirect `FRONTEND_URL/?social_connected=<p>` (lỗi: `?social_error=<msg>`). |
| POST | `/api/social/:platform/post` | Auth. Body `{ text, media_url? }` → `{ok,id,url}` hoặc lỗi. |

`platform` ∈ `x | tiktok | instagram`.

## Redirect URI cần đăng ký (bắt buộc khớp)

Đặt trên Render env `FRONTEND_URL=https://rexiai.bot.cd`. Redirect URI mặc định:

- X: `https://rexiai.bot.cd/api/social/x/callback`
- TikTok: `https://rexiai.bot.cd/api/social/tiktok/callback`
- Instagram: `https://rexiai.bot.cd/api/social/instagram/callback`

(Có thể override bằng `X_REDIRECT_URI` / `TIKTOK_REDIRECT_URI` / `META_REDIRECT_URI`.)

---

## 1) X (Twitter) — OAuth 2.0 PKCE + tweet write

**Developer app**: https://developer.x.com → Project & App.
**App type**: "Web App, Automated App or Bot"; bật **OAuth 2.0**.
**User authentication settings**:
- App permissions: **Read and write**
- Type of App: **Web App**
- Callback URI: `https://rexiai.bot.cd/api/social/x/callback`
- Website URL: `https://rexiai.bot.cd`

**Scopes** (đã set trong code): `tweet.read tweet.write users.read offline.access`.
**Env vars trên Render**: `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` (tuỳ chọn).
**Lưu ý**: X free tier cho phép post qua API v2; cần access token + refresh token (scope `offline.access`). Không cần review cho app của chính mình; nếu phục vụ nhiều user bên ngoài có thể cần nâng tier.

**Publish**: `POST https://api.twitter.com/2/tweets` body `{ "text": "..." }` (≤ 280 ký tự).

---

## 2) TikTok — Login Kit + Content Posting API

**Developer app**: https://developers.tiktok.com → Manage apps.
**Products cần bật**: **Login Kit** + **Content Posting API**.
**Scopes**: `user.info.basic`, `video.publish` (hoặc `video.upload`).
**Redirect URI** (đăng ký trong Login Kit): `https://rexiai.bot.cd/api/social/tiktok/callback`
**Env vars trên Render**: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` (tuỳ chọn).

**Review/approval**: Content Posting API **phải được TikTok duyệt** (audit). Trước khi duyệt, app chỉ post được ở chế độ **private/self-only** ("Direct Post" cần scope `video.publish` đã duyệt). Sandbox app giới hạn target user.
**Định dạng**: Content Posting API **không nhận text-only** — cần `media_url` (video URL công khai để pull, `PULL_FROM_URL`). Code trả `media_url_required` nếu thiếu.

**Publish**: `POST https://open.tiktokapis.com/v2/post/publish/video/init/` với `source_info.source = PULL_FROM_URL`.

---

## 3) Instagram — Meta Graph API (IG Content Publishing)

**Developer app**: https://developers.facebook.com → Create App (type **Business**).
**Thêm product**: **Instagram Graph API** / **Facebook Login**.
**Yêu cầu tài khoản**: **Instagram Business** hoặc **Creator account** liên kết với một **Facebook Page**.
**Scopes**: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`.
**Redirect URI** (Facebook Login → Valid OAuth Redirect URIs): `https://rexiai.bot.cd/api/social/instagram/callback`
**Env vars trên Render**: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` (tuỳ chọn).

**Review/approval**: Cần **App Review** cho `instagram_content_publish` + xác minh **Business Verification** khi dùng ngoài tester. App ở Development mode chỉ hoạt động với role/tester của app.
**Luồng token**: code → short-lived user token → **long-lived (~60 ngày)** → lấy IG Business account id từ `/me/accounts` (lưu vào `meta.igUserId`).

**Publish**: `POST /{ig-user-id}/media` (tạo container, cần `image_url` hoặc `video_url` + `caption`) → `POST /{ig-user-id}/media_publish` (publish). **Không nhận text-only** → cần `media_url`. Code trả `media_url_required` nếu thiếu.

---

## Bật nhanh (Render)

1. Set `FRONTEND_URL=https://rexiai.bot.cd`.
2. Thêm env key cho từng nền tảng (mục trên).
3. Redeploy service `rexiai-ai-backend`.
4. Mở app → Cài đặt → mục "Mạng xã hội" → nền tảng chuyển từ **Chưa cấu hình** sang **Chưa kết nối** → bấm **Kết nối** → hoàn tất OAuth → quay về app kèm toast.

## Ghi chú an toàn

- Thiếu key → 503 `not_configured`, không crash.
- Token mã hoá at-rest; refresh token giữ lại khi provider không trả mới.
- X dùng PKCE (`code_verifier` lưu trong state in-memory, TTL 10 phút).
- `state` mang cả `userId` để gắn token đúng user sau redirect trình duyệt.
