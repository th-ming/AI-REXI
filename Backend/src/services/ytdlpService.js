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

// ─── PO Token (bgutil) — vượt gate "Sign in to confirm you're not a bot" trên IP datacenter ───
// Kiến trúc: 1 service Docker riêng chạy bgutil POT provider (HTTP, xem docs/DEPLOY-YTPOT.md),
// main backend cài plugin `bgutil-ytdlp-pot-provider` (zip vendor trong Backend/vendor/ytdlp-plugins)
// và trỏ tới provider qua YTPOT_BASE_URL. Bật bằng env — tắt (không set) thì mọi thứ như cũ.
const PLUGIN_DIR = path.join(__dirname, '..', '..', 'vendor', 'ytdlp-plugins');
function potBaseUrl() {
  const u = (process.env.YTPOT_BASE_URL || '').trim();
  return u || null;
}
function potEnabled() { return !!potBaseUrl(); }
function potOptions() {
  if (!potEnabled()) return {};
  const o = {};
  if (fs.existsSync(PLUGIN_DIR)) o.pluginDirs = PLUGIN_DIR;
  return o;
}
// Ghép extractor-args: player_client + base_url provider (nhiều arg ngăn bằng ';').
function buildExtractorArgs(client) {
  const parts = [];
  if (client) parts.push(`youtube:player_client=${client}`);
  const base = potBaseUrl();
  if (base) parts.push(`youtubepot-bgutilhttp:base_url=${base}`);
  return parts.length ? parts.join(';') : null;
}

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
// Ladder player_client: IP datacenter (Render) bị YouTube trả lỗi PHỤ THUỘC CLIENT
// ("The page needs to be reloaded." / "Requested format is not available.").
// Có YOUTUBE_COOKIES (login thật) → thử lần lượt từng client tới khi lấy được stream.
// KHÔNG dùng android/ios (yt-dlp bỏ qua cookies với 2 client này). tv/web_safari/mweb
// hay qua được datacenter; default để cuối cùng.
// Ladder chọn client + cookies cho IP datacenter (Render).
// PHÁT HIỆN QUAN TRỌNG (đo trên cloud):
//  - Client `android` KHÔNG cookies → YouTube trả format 18 (mp4 combined 360p) trên datacenter.
//  - Nếu gửi cookies (session login) từ datacenter → "The page needs to be reloaded." (Google chặn).
//  - Video age/sign-in-restricted thì mọi client đều bot-check trên datacenter → cần cookies.
// 29/9: video gated (VEVO...) trên Render fail "Requested format is not available" —
// IP bị cờ nên progressive bị rút với client android/default. Mở rộng no-cookie:
//   mweb / web_embedded (embed player, served rộng rãi) / web_music (VEVO = music video)
// — 3 client này vẫn trả progressive fmt 18 (verify local 29/9). `tv` BỊ BREAK server-side
// ("The page needs to be reloaded" từ 2026.08) → không đưa vào no-cookie.
const ATTEMPT_LADDER = [
  { client: 'android', cookies: false },
  { client: 'ios,android', cookies: false },
  { client: 'android_vr', cookies: false },
  { client: null, cookies: false },          // default (visionos...) — có thể chỉ video-only
  { client: null, cookies: true },           // session login (local OK, cloud có thể bị "reload")
  { client: 'tv', cookies: true },
  { client: 'web_safari', cookies: true },
];

// Ladder có chèn PO token: android (nhanh, no-cookie) → các client web no-cookie
// (mweb/web_embedded/web_music/web/web_safari — đều nhận PO token GVS từ provider)
// → cookies. Chỉ thêm khi YTPOT_BASE_URL bật; video thường vẫn dừng ở android nên không chậm.
function potLadder() {
  if (!potEnabled()) return ATTEMPT_LADDER;
  return [
    ...ATTEMPT_LADDER.slice(0, 4),
    { client: 'mweb', cookies: false },
    { client: 'web_embedded', cookies: false },
    { client: 'web_music', cookies: false },
    { client: 'web', cookies: false },
    { client: 'web_safari', cookies: false },
    ...ATTEMPT_LADDER.slice(4),
  ];
}

// Format chuẩn: combined ≤720p ưu tiên, rồi combined bất kỳ, rồi audio-only
// (bestaudio m4a phát được trong <video> như audio-only). KHÔNG ưu tiên video-only
// vì sẽ mất tiếng khi phát trực tiếp.
const STREAM_FORMAT = 'best[height<=720][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]/bestaudio[ext=m4a]/bestaudio/best';

async function getVideoStream(urlOrId) {
  if (!urlOrId) throw new Error('Thiếu URL/ID video');
  const cached = streamCacheGet(extractVideoId(urlOrId));
  if (cached) return cached;
  const url = normalizeUrl(urlOrId);
  const cookies = getCookiesOption();
  let lastErr = null;
  // Khi có PO token: chèn các client web no-cookie (nhận PO token GVS) vào SAU các client
  // no-cookie nhanh (android...) nhưng TRƯỚC khi thử cookies — không làm chậm video thường.
  const attempts = potLadder();
  for (const attempt of attempts) {
    try {
      const opts = {
        dumpSingleJson: true,
        noPlaylist: true,
        skipDownload: true,
        quiet: true,
        noWarnings: true,
        format: STREAM_FORMAT,
        socketTimeout: 20,
        ...potOptions(),
        ...(attempt.cookies ? cookies : {}),
      };
      const xargs = buildExtractorArgs(attempt.client);
      if (xargs) opts.extractorArgs = xargs;
      const info = await withTimeout(ytdl(url, opts), 30000, 'Lấy stream');
      if (!info || !info.url) throw new Error('yt-dlp không trả được URL stream');
      const out = {
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
        stream_client: attempt.client || 'default',
      };
      streamCacheSet(info.id, out);
      return out;
    } catch (e) {
      lastErr = e;
      console.log(`[ytdlpService] getVideoStream client="${attempt.client || 'default'}" cookies=${attempt.cookies} failed: ${(e && (e.stderr || e.message)) || e}`);
    }
  }
  // Mọi attempt yt-dlp thua (bot-check / "Requested format is not available" / reload)
  // → thử chuỗi public instance (Invidious → Piped): stream đi qua IP instance, né IP Render.
  const vid = extractVideoId(urlOrId);
  if (vid) {
    try {
      const fb = await publicFallback(vid);
      if (fb) { streamCacheSet(vid, fb); return fb; }
    } catch (e) {
      console.log(`[ytdlpService] publicFallback(${vid}) failed: ${(e && e.message) || e}`);
    }
  }
  throw toError(lastErr || new Error('yt-dlp không trả được URL stream'));
}

// ─── Fallback public instances (Invidious → Piped) ─────────────────────────
// 29/9: IP Render bị YouTube cờ mạnh với video gated (VEVO/official). Khi cả
// ladder yt-dlp thua, stream qua public instance: IP INSTANCE gọi YouTube,
// Render (và trình duyệt user) chỉ nói chuyện với instance. Mọi thứ free.
// Instances đổi liên tục → hard-code list + health-check runtime (probe stream
// thật bằng Range request, chỉ nhận 200/206 + content-type video|audio).
const INVIDIOUS_HOSTS = ['invidious.f5.si', 'iv.melmac.space', 'inv.nadeko.net', 'invidious.jing.rocks', 'yewtu.be'];
const PIPED_HOSTS = ['api.piped.private.coffee', 'pipedapi.kavin.rocks'];

// Cache kết quả stream (success) trong 30 phút — Render free yếu CPU,
// tránh chạy lại cả ladder + fallback cho mỗi lần user bấm play lại.
const STREAM_CACHE_TTL = 30 * 60 * 1000;
const _streamCache = new Map();
function streamCacheSet(id, val) {
  if (!id) return;
  _streamCache.set(id, { val, at: Date.now() });
  if (_streamCache.size > 100) { // giới hạn bộ nhớ
    const first = _streamCache.keys().next().value;
    _streamCache.delete(first);
  }
}
function streamCacheGet(id) {
  if (!id) return null;
  const hit = _streamCache.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > STREAM_CACHE_TTL) { _streamCache.delete(id); return null; }
  return hit.val;
}

function extractVideoId(urlOrId) {
  const s = String(urlOrId || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/) || s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Probe stream thật: Range request 1KB — chỉ nhận 200/206 + content-type video|audio.
async function probeStream(url) {
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-1023', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if ((res.status === 200 || res.status === 206) && /^video\/|^audio\/|octet-stream/.test(ct)) return true;
    // đọc bỏ body để giải phóng socket
    try { await res.arrayBuffer(); } catch (e) {}
    return false;
  } catch (e) { return false; }
}

// fallback_shape: gói metadata của instance về shape chuẩn getVideoStream.
function fallbackShape(vid, meta, streamUrl, { formatId, ext, height, provider, audioOnly }) {
  return {
    id: vid,
    title: meta.title || vid,
    author: meta.author || '',
    duration: meta.duration != null ? Number(meta.duration) : undefined,
    views: meta.views != null ? Number(meta.views) : undefined,
    description: String(meta.description || '').slice(0, 2000),
    stream_url: streamUrl,
    format_id: formatId,
    ext: ext,
    height: height || (audioOnly ? 0 : undefined),
    stream_client: provider,
    fallback_used: provider,
    audio_only: !!audioOnly,
  };
}

/**
 * Chuỗi public instance khi yt-dlp thua bot-check trên IP datacenter.
 * @param {string} vid  video ID 11 ký tự
 * @param {object} [opts] { preferAudio: bool } — downloadAudio ưu tiên stream audio
 * @returns shape getVideoStream hoặc null
 */
async function publicFallback(vid, opts = {}) {
  // 1) Invidious: GET /api/v1/videos/{id} → formatStreams (progressive) → /latest_version local=true
  for (const host of INVIDIOUS_HOSTS) {
    try {
      const res = await fetch(`https://${host}/api/v1/videos/${vid}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const j = await res.json().catch(() => null);
      if (!j || !j.title) continue;
      const fs = Array.isArray(j.formatStreams) ? j.formatStreams : [];
      const adaptive = Array.isArray(j.adaptiveFormats) ? j.adaptiveFormats : [];
      // progressive (phát trực tiếp trong <video>): ưu tiên 22 (720p) → 18 (360p) → bất kỳ
      const pick = opts.preferAudio
        ? null
        : (fs.find(f => f.itag === '22') || fs.find(f => f.itag === '18') || fs[0] || null);
      if (pick && pick.itag) {
        const streamUrl = `https://${host}/latest_version?id=${vid}&itag=${pick.itag}&local=true`;
        if (await probeStream(streamUrl)) {
          const height = parseInt(String(pick.resolution || '').replace('p', ''), 10) || undefined;
          return fallbackShape(vid, { title: j.title, author: j.author, duration: j.lengthSeconds, views: j.viewCount, description: j.description },
            streamUrl, { formatId: `invidious:${pick.itag}`, ext: pick.container || 'mp4', height, provider: `invidious:${host}` });
        }
      }
      // audio-only (itag 140 m4a) — phát được trong <video> như bestaudio, đủ cho /summarize
      const audio = adaptive.find(f => f.itag === '140');
      if (audio) {
        const audioUrl = `https://${host}/latest_version?id=${vid}&itag=140&local=true`;
        if (await probeStream(audioUrl)) {
          return fallbackShape(vid, { title: j.title, author: j.author, duration: j.lengthSeconds, views: j.viewCount, description: j.description },
            audioUrl, { formatId: 'invidious:140', ext: 'm4a', height: 0, provider: `invidious:${host}`, audioOnly: true });
        }
      }
    } catch (e) { /* instance chết/time-out → thử con tiếp theo */ }
  }
  // 2) Piped: GET /streams/{id} → videoStreams (URL đã proxied qua proxy của Piped)
  for (const host of PIPED_HOSTS) {
    try {
      const res = await fetch(`https://${host}/streams/${vid}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const j = await res.json().catch(() => null);
      if (!j || !j.title) continue;
      const vs = Array.isArray(j.videoStreams) ? j.videoStreams : [];
      const as = Array.isArray(j.audioStreams) ? j.audioStreams : [];
      if (opts.preferAudio && as.length) {
        const a = as.find(s => String(s.mimeType || '').includes('m4a')) || as[0];
        if (a && a.url && await probeStream(a.url)) {
          return fallbackShape(vid, { title: j.title, author: j.uploader, duration: j.duration, views: j.views, description: j.description },
            a.url, { formatId: `piped:${a.itag}`, ext: 'm4a', height: 0, provider: `piped:${host}`, audioOnly: true });
        }
      }
      // combined (videoOnly=false) ưu tiên — phát trực tiếp có cả hình+tiếng
      const combined = vs.filter(s => s.videoOnly === false && /mp4|webm/i.test(s.mimeType || ''));
      const pick = combined.find(s => s.quality === '720p') || combined.find(s => s.quality === '360p') || combined[0] || vs.find(s => s.videoOnly === false);
      if (pick && pick.url && await probeStream(pick.url)) {
        const height = parseInt(String(pick.quality || '').replace('p', ''), 10) || undefined;
        const ext = /webm/i.test(pick.mimeType || '') ? 'webm' : 'mp4';
        return fallbackShape(vid, { title: j.title, author: j.uploader, duration: j.duration, views: j.views, description: j.description },
          pick.url, { formatId: `piped:${pick.itag}`, ext, height, provider: `piped:${host}` });
      }
    } catch (e) { /* instance chết → thử con tiếp theo */ }
  }
  return null;
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
  let lastErr = null;
  const attempts = potLadder();
  for (const attempt of attempts) {
    try {
      // LƯU Ý: KHÔNG dùng dumpJson — --dump-json của yt-dlp ÉP SIMULATE MODE
      // → không tải file nào cả. Phải dùng printJson (in JSON sau khi tải xong).
      const opts = {
        printJson: true,
        noPlaylist: true,
        quiet: true,
        noWarnings: true,
        format: 'bestaudio[ext=m4a]/bestaudio/best[acodec!=none][vcodec!=none]/best',
        output: outPath + '.%(ext)s',
        // KHÔNG dùng --download-sections/--force-keyframes-at-cuts: ffmpeg-static
        // trên Render free bị SIGSEGV (code -11). Cắt 10 phút bằng postprocessor
        // ffmpeg (-t) ở bước extract-audio (1 lần decode duy nhất).
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: '64',
        // mono 16kHz + cắt 10 phút: chuẩn Whisper, tránh file >25MB bị Groq từ chối
        postprocessorArgs: `ffmpeg:-ar 16000 -ac 1 -t ${SUMMARY_MAX_SECONDS}`,
        ...(ffmpegPath ? { ffmpegLocation: ffmpegPath } : {}),
        socketTimeout: 30,
        ...potOptions(),
        ...(attempt.cookies ? getCookiesOption() : {}),
      };
      const xargs = buildExtractorArgs(attempt.client);
      if (xargs) opts.extractorArgs = xargs;
      const out = await withTimeout(ytdl.exec(normalizeUrl(urlOrId), opts), timeoutMs, 'Tải audio');
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
    } catch (e) {
      lastErr = e;
      console.log(`[ytdlpService] downloadAudio client="${attempt.client || 'default'}" cookies=${attempt.cookies} failed: ${(e && (e.stderr || e.message)) || e}`);
    }
  }
  // Ladder thua → tải audio qua public instance (Invidious/Piped, stream qua IP instance)
  const vid = extractVideoId(urlOrId);
  if (vid) {
    try {
      const out = await downloadAudioViaFallback(vid, outPath);
      if (out) return out;
    } catch (e) {
      console.log(`[ytdlpService] downloadAudioViaFallback(${vid}) failed: ${(e && e.message) || e}`);
    }
  }
  throw toError(lastErr || new Error('yt-dlp không tải được audio'));
}

// Tải audio qua public instance cho /youtube/summarize: fetch stream (audio m4a
// hoặc video combined) về file temp → ffmpeg extract mp3 mono 16kHz 64k, cắt 10 phút.
async function downloadAudioViaFallback(vid, outPath) {
  const info = await publicFallback(vid, { preferAudio: true });
  if (!info || !info.stream_url) return null;
  if (!ffmpegPath) throw new Error('Không có ffmpeg cho fallback download');
  const res = await fetch(info.stream_url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf || !buf.length) return null;
  const raw = `${outPath}.fallback.mp4`;
  const dest = `${outPath}.mp3`;
  fs.writeFileSync(raw, buf);
  await new Promise((resolve, reject) => {
    require('child_process').execFile(ffmpegPath,
      ['-y', '-i', raw, '-vn', '-ar', '16000', '-ac', '1', '-b:a', '64k', '-t', String(SUMMARY_MAX_SECONDS), dest],
      { timeout: 120000 },
      (err, so, se) => err
        ? reject(new Error('ffmpeg fallback: ' + String(se || so || err.message || '').split('\n').filter(Boolean).slice(-1)[0] || 'lỗi không xác định'))
        : resolve());
  });
  try { fs.unlinkSync(raw); } catch (e) {}
  if (!fs.existsSync(dest)) throw new Error('ffmpeg fallback không tạo được mp3');
  return { ok: true, title: info.title, file: dest, duration: info.duration };
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
    po_token: potEnabled(),
    pot_provider: potBaseUrl(),
    pot_plugin: fs.existsSync(PLUGIN_DIR),
    ready: !!version,
  };
}

module.exports = { searchVideos, getVideoStream, downloadAudio, getStatus };
