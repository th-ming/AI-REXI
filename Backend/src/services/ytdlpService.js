/**
 * ytdlpService.js — Xem YouTube không quảng cáo (giống Premium free)
 *
 * 20/9/2026: ĐỔI SANG youtube-dl-exec (npm) — BỎ HOÀN TOÀN PHỤ THUỘC PYTHON.
 *   Trước đây service spawn `python ytdlp_helper.py` (yt-dlp Python module).
 *   Render free runtime=node KHÔNG có Python/yt_dlp → YouTube Free chết hoàn toàn
 *   trên cloud ("Không tìm thấy Python + yt_dlp").
 *   youtube-dl-exec tự tải binary yt-dlp vào node_modules/youtube-dl-exec/bin/
 *   lúc npm install (postinstall) → chạy được mọi nơi chỉ cần Node.
 *   LƯU Ý Render/deploy: nếu npm chặn install-scripts (npm config allow-scripts),
 *   binary sẽ không tải — check bằng GET /api/services/youtube/status → ready=false.
 *
 * Cách dùng: giữ nguyên 3 hàm + shape trả về như bản Python helper cũ:
 *   searchVideos(query, limit)                → { videos: [...] }
 *   getVideoStream(urlOrId)                   → { id, title, author, duration, views,
 *                                                 description, stream_url, format_id, ext, height }
 *   downloadAudio(urlOrId, outPath, timeout)  → { ok, title, file, duration }
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const ytdl = require('youtube-dl-exec');

// YOUTUBE_COOKIES: nội dung file cookie Netscape — vượt bot check
// "Sign in to confirm you're not a bot" khi chạy trên IP datacenter (Render).
// Set env trên Render (multiline OK), ghi ra temp file 1 lần rồi pass --cookies cho yt-dlp.
let _cookiesFile = null;
function getCookiesOption() {
  const raw = process.env.YOUTUBE_COOKIES;
  if (!raw || !raw.trim()) return {};
  if (!_cookiesFile) {
    _cookiesFile = path.join(os.tmpdir(), `ytdlp-cookies-${process.pid}.txt`);
    fs.writeFileSync(_cookiesFile, raw.replace(/\\n/g, '\n'), 'utf8');
  }
  return { cookies: _cookiesFile };
}

// ffmpeg cho extract-audio (đã có sẵn trong dependencies — không cần PATH)
let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch (e) { ffmpegPath = null; }

// Đường dẫn binary yt-dlp do youtube-dl-exec tải (check trạng thái / debug)
function getBinaryPath() {
  try {
    const pkgDir = path.dirname(require.resolve('youtube-dl-exec/package.json'));
    const bin = process.platform === 'win32'
      ? path.join(pkgDir, 'bin', 'yt-dlp.exe')
      : path.join(pkgDir, 'bin', 'yt-dlp');
    return fs.existsSync(bin) ? bin : null;
  } catch (e) { return null; }
}

const DEFAULT_TIMEOUT = 45000;

function normalizeUrl(urlOrId) {
  const s = String(urlOrId || '').trim();
  if (!s) throw new Error('Thiếu URL/ID video');
  return /^https?:\/\//.test(s) ? s : `https://www.youtube.com/watch?v=${s}`;
}

// youtube-dl-exec v3 KHÔNG có option "timeout" (đẩy --timeout cho yt-dlp → lỗi).
// Chặn cứng bằng race; stall mạng thì yt-dlp tự chết nhờ socketTimeout.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} quá ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}

function toError(e) {
  // youtube-dl-exec reject với stderr yt-dlp — rút gọn cho FE hiển thị
  const msg = String((e && (e.stderr || e.message)) || e || '').trim();
  return new Error(msg.split('\n').filter(Boolean).slice(-1)[0] || 'yt-dlp lỗi không xác định');
}

/**
 * Search video YouTube.
 * @returns {Promise<{videos: Array<{id,title,author,duration,views,thumbnails,thumb}>}>}
 */
async function searchVideos(query, limit = 12) {
  if (!query || !String(query).trim()) throw new Error('Thiếu từ khóa tìm kiếm');
  try {
    const data = await withTimeout(ytdl(`ytsearch${parseInt(limit, 10) || 12}:${String(query).trim()}`, {
      dumpSingleJson: true,
      flatPlaylist: true,
      noPlaylist: true,
      skipDownload: true,
      quiet: true,
      noWarnings: true,
      socketTimeout: 20,
      ...getCookiesOption(),
    }), DEFAULT_TIMEOUT, 'Search');
    const entries = (data && (data.entries || data)) || [];
    const videos = (Array.isArray(entries) ? entries : []).filter(Boolean).map(e => {
      const thumbs = e.thumbnails || [];
      return {
        id: e.id,
        title: e.title,
        author: e.channel || e.uploader || '',
        duration: e.duration,
        views: e.view_count,
        thumbnails: thumbs,
        thumb: (thumbs.length ? thumbs[thumbs.length - 1].url : (e.thumbnail || null)),
      };
    });
    return { videos };
  } catch (e) { throw toError(e); }
}

/**
 * Lấy thông tin video + URL stream trực tiếp (không quảng cáo, không tracking).
 * @returns {Promise<{id,title,author,duration,views,description,stream_url,format_id,ext,height}>}
 */
async function getVideoStream(urlOrId) {
  if (!urlOrId) throw new Error('Thiếu URL/ID video');
  try {
    const info = await withTimeout(ytdl(normalizeUrl(urlOrId), {
      dumpSingleJson: true,
      noPlaylist: true,
      skipDownload: true,
      quiet: true,
      noWarnings: true,
      // Chuẩn format như helper cũ: combined ≤720p ưu tiên, fallback dần xuống
      // Video dài/music mix thường KHÔNG có progressive format → fallback audio-only
      // (bestaudio m4a phát được trong <video> như audio-only, phù hợp nghe nhạc)
      format: 'best[height<=720][acodec!=none][vcodec!=none]/best[height<=720]/best/bestaudio[ext=m4a]/bestaudio',
      socketTimeout: 20,
      ...getCookiesOption(),
    }), DEFAULT_TIMEOUT, 'Lấy stream');
    if (!info || !info.url) throw new Error('yt-dlp không trả được URL stream');
    return {
      id: info.id,
      title: info.title,
      author: info.channel || info.uploader || '',
      duration: info.duration,
      views: info.view_count,
      description: String(info.description || '').slice(0, 2000),
      stream_url: info.url,
      format_id: info.format_id,
      ext: info.ext,
      height: info.height,
    };
  } catch (e) { throw toError(e); }
}

// Giới hạn độ dài audio tải về cho Tóm tắt AI (giây) — tránh 413 Groq
// (video nonstop 1-2h sẽ chỉ tải 10 phút đầu, đủ để tóm tắt nội dung chính)
const SUMMARY_MAX_SECONDS = 600;

/**
 * Tải audio (mp3 mono 16kHz 64kbps, tối đa 10 phút) — chuẩn đầu vào Whisper cho Tóm tắt AI.
 * @returns {Promise<{ok, title, file, duration}>}
 */
async function downloadAudio(urlOrId, outPath, timeoutMs = 150000) {
  if (!urlOrId) throw new Error('Thiếu URL/ID video');
  if (!outPath) throw new Error('Thiếu đường dẫn file đích');
  try {
    // LƯU Ý: KHÔNG dùng dumpJson — --dump-json của yt-dlp ÉP SIMULATE MODE
    // → không tải file nào cả. Phải dùng printJson (in JSON sau khi tải xong).
    const out = await withTimeout(ytdl.exec(normalizeUrl(urlOrId), {
      printJson: true,
      noPlaylist: true,
      quiet: true,
      noWarnings: true,
      format: 'bestaudio/best',
      output: outPath + '.%(ext)s',
      downloadSections: `*0-${SUMMARY_MAX_SECONDS}`,
      forceKeyframesAtCuts: true,
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: '64',
      // mono 16kHz + cắt 10 phút: chuẩn Whisper, tránh file >25MB bị Groq từ chối
      postprocessorArgs: `ffmpeg:-ar 16000 -ac 1 -t ${SUMMARY_MAX_SECONDS}`,
      ...(ffmpegPath ? { ffmpegLocation: ffmpegPath } : {}),
      socketTimeout: 30,
      ...getCookiesOption(),
    }), timeoutMs, 'Tải audio');
    const stdout = typeof out === 'string' ? out : ((out && out.stdout) || '');
    const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
    let info = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try { info = JSON.parse(lines[i]); break; } catch (e) { /* dòng progress — bỏ qua */ }
    }
    let file = '';
    try { file = info.requested_downloads[0].filepath; } catch (e) { /* fallback bên dưới */ }
    if (!file || !fs.existsSync(file)) {
      file = outPath + '.mp3';
    }
    if (!fs.existsSync(file)) throw new Error('Không tìm thấy file mp3 sau khi tải: ' + file);
    return { ok: true, title: info.title, file, duration: info.duration };
  } catch (e) { throw toError(e); }
}

/**
 * Trạng thái sẵn sàng (dùng cho GET /api/services/youtube/status).
 * Không cần Python nữa — chỉ cần binary yt-dlp do youtube-dl-exec tải lúc npm install.
 */
async function getStatus() {
  const bin = getBinaryPath();
  let version = null;
  if (bin) {
    version = await new Promise((resolve) => {
      require('child_process').execFile(bin, ['--version'], { timeout: 10000 }, (err, stdout) => {
        resolve(err ? null : String(stdout || '').trim() || null);
      });
    });
  }
  return {
    engine: 'youtube-dl-exec (bundled yt-dlp binary)',
    binary_path: bin,
    yt_dlp: version,
    ffmpeg: !!(ffmpegPath && fs.existsSync(ffmpegPath)),
    cookies: !!process.env.YOUTUBE_COOKIES,
    ready: !!version,
  };
}

module.exports = { searchVideos, getVideoStream, downloadAudio, getStatus };
