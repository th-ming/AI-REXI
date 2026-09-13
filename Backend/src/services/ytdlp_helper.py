# -*- coding: utf-8 -*-
"""ytdlp_helper.py — CLI helper cho yt-dlp (gọi từ Node.js qua child_process).

Usage:
    python ytdlp_helper.py search "<query>" <limit>
    python ytdlp_helper.py stream "<url_or_id>"
    python ytdlp_helper.py audio "<url_or_id>" "<out_path>"

Output: JSON (stdout, dòng cuối cùng). Lỗi: JSON {"error": "..."} hoặc exit code != 0.
"""
import sys
import json
import yt_dlp


def search(query, limit=12):
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": True,
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    entries = info.get("entries") or []
    videos = []
    for e in entries:
        if not e:
            continue
        thumbs = e.get("thumbnails") or []
        videos.append({
            "id": e.get("id"),
            "title": e.get("title"),
            "author": e.get("channel") or e.get("uploader") or "",
            "duration": e.get("duration"),
            "views": e.get("view_count"),
            "thumbnails": thumbs,
            "thumb": (thumbs[-1].get("url") if thumbs else None),
        })
    print(json.dumps({"videos": videos}, ensure_ascii=False))
    sys.exit(0)


# Giới hạn độ dài audio tải về cho Tóm tắt AI (giây) — tránh 413 Groq
# (video nonstop 1-2h sẽ chỉ tải 10 phút đầu, đủ để tóm tắt nội dung chính)
SUMMARY_MAX_SECONDS = 600


def audio(url_or_id, out_path):
    """Tải audio (mp3 mono 16kHz, tối đa 10 phút) từ video YouTube — dùng cho Tóm tắt AI.
    - download_ranges: chỉ lấy 10 phút đầu (tránh file >25MB bị Groq từ chối 413)
    - mono 16kHz 64kbps: chuẩn đầu vào Whisper, file nhỏ gọn
    Cần ffmpeg (yt-dlp tự tìm thấy nếu có trong PATH).
    """
    if not url_or_id.startswith("http"):
        url_or_id = f"https://www.youtube.com/watch?v={url_or_id}"
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
        "format": "bestaudio/best",
        "outtmpl": out_path + ".%(ext)s",
        "download_sections": f"*0-{SUMMARY_MAX_SECONDS}",
        "force_keyframes_at_cuts": True,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "64",
            }
        ],
        # -t 600: đảm bảo cắt 10 phút kể cả khi download_sections không được hỗ trợ
        "postprocessor_args": ["-ar", "16000", "-ac", "1", "-t", str(SUMMARY_MAX_SECONDS)],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url_or_id, download=True)
    filepath = ""
    try:
        filepath = info["requested_downloads"][0]["filepath"]
    except Exception:
        filepath = out_path + ".mp3"
    result = {
        "ok": True,
        "title": info.get("title"),
        "file": filepath,
        "duration": info.get("duration"),
    }
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0)


def stream(url_or_id):
    # Chấp nhận cả video ID lẫn URL đầy đủ
    if not url_or_id.startswith("http"):
        url_or_id = f"https://www.youtube.com/watch?v={url_or_id}"
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "format": "best[height<=720][acodec!=none][vcodec!=none]/best[height<=720]/best",
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url_or_id, download=False)
    result = {
        "id": info.get("id"),
        "title": info.get("title"),
        "author": info.get("channel") or info.get("uploader") or "",
        "duration": info.get("duration"),
        "views": info.get("view_count"),
        "description": (info.get("description") or "")[:2000],
        "stream_url": info.get("url"),
        "format_id": info.get("format_id"),
        "ext": info.get("ext"),
        "height": info.get("height"),
    }
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    try:
        action = sys.argv[1] if len(sys.argv) > 1 else ""
        if action == "search":
            query = sys.argv[2] if len(sys.argv) > 2 else ""
            limit = int(sys.argv[3]) if len(sys.argv) > 3 else 12
            search(query, limit)
        elif action == "stream":
            target = sys.argv[2] if len(sys.argv) > 2 else ""
            stream(target)
        elif action == "audio":
            target = sys.argv[2] if len(sys.argv) > 2 else ""
            out_path = sys.argv[3] if len(sys.argv) > 3 else ""
            audio(target, out_path)
        else:
            print(json.dumps({"error": f"Unknown action: {action}"}))
            sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)[:400]}))
        sys.exit(1)
