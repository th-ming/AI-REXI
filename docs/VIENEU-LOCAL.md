# VieNeu-TTS (CPU) — self-host cho AI REXI

Engine TTS tiếng Việt **miễn phí** chạy trên máy user (CPU, torch-free ONNX), có
**clone giọng**. Cloud (Render free) không chạy nổi model nên chỉ đóng vai trò cầu nối:
backend đọc `VIENEU_BASE_URL` rồi forward request sang máy user qua một tunnel công khai.

## Thành phần (máy user — `D:\Temp\opencode`)

| File / thư mục | Vai trò |
| --- | --- |
| `vieneu-venv\` | venv đã `pip install vieneu` (v3.8.3) |
| `vieneu-server.py` | FastAPI OpenAI-compatible, **port 8124**, host `127.0.0.1` |
| `vieneu-tunnel.txt` | URL quick-tunnel hiện tại (tự ghi) |
| `vieneu-tunnel-watchdog.ps1` | giữ server + tunnel sống, tự cập nhật Render khi URL đổi |
| `update-vieneu-url.py` | PUT `VIENEU_BASE_URL` lên Render + POST deploy (idempotent) |
| `cloudflared.exe` | tunnel binary (quick tunnel, không cần tài khoản) |
| `vieneu-cf.err` / `vieneu-watchdog.log` | log tunnel / log watchdog |

## Chạy server local

```powershell
D:\Temp\opencode\vieneu-venv\Scripts\python.exe D:\Temp\opencode\vieneu-server.py
```

- Load model ~29s, sample rate 48000 Hz, 25 preset giọng Việt.
- Infer ~8s/câu (CPU).
- Endpoints:
  - `GET  /health` → `{"ok":true,"engine":"vieneu-cpu","sample_rate":48000}`
  - `GET  /v1/voices` → danh sách preset
  - `POST /v1/audio/speech` (JSON `{input, voice, ...}`) → WAV
  - `POST /v1/clone` (multipart `file` + `text` + `ref_text?`) → WAV giọng clone

> Lưu ý: gọi test từ PowerShell hay lỗi 400 do encoding dấu tiếng Việt — dùng
> **python client** hoặc curl với `--data-binary @file.json`.

## Tunnel + tự đồng bộ (một lệnh, chạy nền)

```powershell
powershell -ExecutionPolicy Bypass -File D:\Temp\opencode\vieneu-tunnel-watchdog.ps1
```

Watchdog sẽ:
1. Bật lại server local nếu chết.
2. Bật lại `cloudflared tunnel --url http://127.0.0.1:8124 --no-autoupdate --edge-ip-version 4 --protocol http2` nếu chết.
3. Ghi URL mới vào `vieneu-tunnel.txt`.
4. Khi URL đổi → verify `GET <url>/health` từ ngoài → `update-vieneu-url.py` PUT env + deploy Render.

## Backend AI REXI

- `VIENEU_BASE_URL` (env Render) = URL tunnel. Có env này thì:
  - `GET /api/services/tts/voices` trả 25 preset VieNeu (`engine: "vieneu"`, `voice_clone: true`).
  - `POST /api/services/tts` ưu tiên VieNeu; nhận `engine: "vieneu" | "edge-tts"` để buộc engine.
  - `POST /api/services/tts/clone` (multipart `audio` + `text` + `ref_text?`) → forward `/v1/clone` → trả WAV base64.
- Không có env → app tự fallback edge-tts như cũ (không clone).

## Giới hạn (trung thực)

- **Máy user phải BẬT** (server + watchdog). Máy tắt / ngủ → TTS VieNeu và clone lỗi;
  FE báo lỗi rõ (không lặng lẽ đổi giọng khi user chọn VieNeu).
- **URL tunnel động**: quick tunnel đổi URL mỗi lần restart → watchdog tự đồng bộ lại.
  Có độ trễ ~1 phút giữa lúc URL đổi và Render deploy xong.
- Quick tunnel không SLA; đứt tạm thời có thể xảy ra, watchdog tự nối lại.
- Render free spin-down: request đầu có thể chậm 30-60s.
