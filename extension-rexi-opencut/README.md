# Rexi OpenCut Bridge (extension)

Cho **agent Rexi AI điều khiển OpenCut** (`opencut.app`) thay bạn: bấm nút, gõ chữ, chạy JS, đọc trang.

## Cách hoạt động
```
Agent Rexi (server) ──enqueue lệnh──▶ bridge (server, in-memory)
                                         ▲ poll ~1.5s (HTTP)      │
Extension background ────────────────────┘                        │ result
   │ port                                                          │
   ▼                                                               │
Tab OpenCut (opencut.app) ── thao tác DOM ──▶ trả kết quả ────────┘
```
- Extension tự lấy token đăng nhập Rexi (`localStorage.rexi_token` trên `rexiai.bot.cd`) → poll `POST /api/services/opencut-bridge/poll` mỗi ~1.5s để lấy lệnh.
- Thao tác xong → `POST /api/services/opencut-bridge/result`.
- Agent gọi tool `opencut_act` → server xếp lệnh → extension lấy và thực thi.

## Cài đặt (Chrome/Edge — 1 lần)
1. Mở `chrome://extensions` (hoặc `edge://extensions`).
2. Bật **Developer mode** (góc trên phải).
3. Bấm **Load unpacked** → chọn thư mục `D:\Rexi AI\extension-rexi-opencut`.
4. Đăng nhập **rexiai.bot.cd** trên 1 tab (để extension lấy token).
5. Mở **https://opencut.app** trên 1 tab.

## Kiểm tra kết nối
- Mở DevTools trên tab `opencut.app` → Console thấy `[RexiBridge] WS connected` là OK.
- Hoặc trên background (chỗ extensions → "service worker") xem log.

## Agent dùng thế nào
Tool `opencut_act` (agent nội bộ, admin):
- `{action:'text'}` → đọc nội dung trang OpenCut.
- `{action:'list'}` → liệt kê các nút bấm được.
- `{action:'click', text:'New project'}` hoặc `{action:'click', selector:'...'}`.
- `{action:'type', selector:'input', text:'...'}`.
- `{action:'eval', code:'return document.querySelectorAll("canvas").length'}` → chạy JS, trả kết quả.
- `{action:'wait', ms:2000}`.

Ví dụ yêu cầu cho agent: *"Mở OpenCut, tạo project mới, rồi báo tao các nút đang có."*

## Lưu ý
- Đây là companion (cài máy) — cần cho agent thao tác **chính trình duyệt của bạn** (OpenCut không có API; trình duyệt chặn agent server đụng iframe khác origin).
- Nếu OpenCut đổi giao diện, selector/text có thể phải chỉnh lại.
- File này **không** đụng vào code web Rexi — chỉ là extension rời.
