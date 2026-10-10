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

// ─── Chẩn đoán ladder (hiển thị /youtube/status) ───────────────────────────
// Lưu lỗi gần nhất của từng client để debug từ xa không cần log Render.
const _ladderErrors = [];
function recordLadderError(client, cookies, err) {
  const msg = String((err && (err.stderr || err.message)) || err || '')
    .split('\n').map(s => s.trim()).filter(Boolean).slice(-1)[0] || 'yt-dlp lỗi';
  _ladderErrors.push({ client: client || 'default', cookies: !!cookies, err: msg.slice(0, 240), at: Date.now() });
  if (_ladderErrors.length > 24) _ladderErrors.shift();
}
function getLadderErrors() { return _ladderErrors.slice(-24); }

// ─── Giữ POT provider "ấm" ──────────────────────────────────────────────────
// Provider là Render free → spin-down; cold start ~30-60s khiến mọi attempt
// (dùng PO token) timeout → direct ladder thua oan và phải rơi xuống Piped.
// Ping /ping mỗi 5 phút để giữ nó thức. unref() để không giữ process sống.
let _potKeepAliveStarted = false;
async function warmPotProvider() {
  const base = potBaseUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/ping`, { signal: AbortSignal.timeout(15000) });
    return res.ok;
  } catch { return false; }
}
function startPotKeepAlive() {
  if (_potKeepAliveStarted || !potEnabled()) return;
  _potKeepAliveStarted = true;
  warmPotProvider().catch(() => {});
  const t = setInterval(() => warmPotProvider().catch(() => {}), 5 * 60 * 1000);
  if (t.unref) t.unref();
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
        channel_id: e.channel_id || null,
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
  { client: 'tv_embedded', cookies: false },  // 29/9 R2: bypass age-gate lịch sử, chưa từng test từ IP cloud
  { client: null, cookies: false },           // default (visionos...) — có thể chỉ video-only
  { client: null, cookies: true },           // session login (local OK, cloud có thể bị "reload")
  { client: 'web_music', cookies: true },     // 29/9 R2: combo mạnh nhất cho age-restricted KHI user cung cấp cookies logged-in
  { client: 'tv', cookies: true },
  { client: 'web_safari', cookies: true },
];

// Ladder có chèn PO token: android (nhanh, no-cookie) → tv_embedded + default →
// các client web no-cookie (mweb/web_embedded/web_music/web/web_safari — đều nhận
// PO token GVS từ provider) → cookies (cuối cùng, hiếm khi thắng từ IP cloud).
function potLadder() {
  if (!potEnabled()) return ATTEMPT_LADDER;
  return [
    ...ATTEMPT_LADDER.slice(0, 5),
    { client: 'mweb', cookies: false },
    { client: 'web_embedded', cookies: false },
    { client: 'web_music', cookies: false },
    { client: 'web', cookies: false },
    { client: 'web_safari', cookies: false },
    ...ATTEMPT_LADDER.slice(5),
  ];
}

// Format chuẩn: combined ≤720p ưu tiên, rồi combined bất kỳ, rồi audio-only
// (bestaudio m4a phát được trong <video> như audio-only). KHÔNG ưu tiên video-only
// vì sẽ mất tiếng khi phát trực tiếp.
const STREAM_FORMAT = 'best[height<=720][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]/bestaudio[ext=m4a]/bestaudio/best';

// ─── Worker yt-dlp IP DÂN DỤNG (máy user) ───────────────────────────────────
// IP Render bị YouTube bot-check mọi client → không có cách free nào phát video
// gated từ datacenter. Worker chạy trên máy nhà (residential) resolve được hết,
// và tự proxy bytes (googlevideo khoá theo IP gọi). Env: YTDLP_WORKER_URL (+ TOKEN).
const WORKER_URL = (process.env.YTDLP_WORKER_URL || '').trim().replace(/\/$/, '');
const WORKER_TOKEN = (process.env.YTDLP_WORKER_TOKEN || '').trim();
function workerEnabled() { return !!WORKER_URL; }

async function workerResolve(urlOrId) {
  if (!WORKER_URL) return null;
  const id = extractVideoId(urlOrId) || String(urlOrId || '').trim();
  const q = new URLSearchParams({ id });
  if (WORKER_TOKEN) q.set('token', WORKER_TOKEN);
  const res = await fetch(`${WORKER_URL}/info?${q.toString()}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`worker HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  if (!j || !j.ok || !j.stream_url) throw new Error('worker không trả stream_url');
  return {
    id: j.id, title: j.title, author: j.author, channel_id: j.channel_id || null, duration: j.duration, views: j.views,
    description: String(j.description || '').slice(0, 2000),
    stream_url: j.stream_url,
    format_id: j.format_id ? `worker:${j.format_id}` : 'worker',
    ext: j.ext, height: j.height,
    stream_client: 'worker:residential',
  };
}


async function getVideoStream(urlOrId) {
  if (!urlOrId) throw new Error('Thiếu URL/ID video');
  const cached = streamCacheGet(extractVideoId(urlOrId));
  if (cached) return cached;
  // Worker residential (nếu cấu hình) — thử TRƯỚC ladder: IP nhà resolve được cả
  // video gated mà mọi client từ IP Render đều bị bot-check.
  if (workerEnabled()) {
    try {
      const w = await workerResolve(urlOrId);
      if (w) { streamCacheSet(w.id || extractVideoId(urlOrId), w); return w; }
    } catch (e) {
      console.log(`[ytdlpService] workerResolve failed: ${(e && e.message) || e}`);
    }
  }
  const url = normalizeUrl(urlOrId);
  const cookies = getCookiesOption();
  let lastErr = null;
  // R3 29/9: deadline tổng — YouTube cờ IP Render thì mọi attempt fail chậm
  // (PO token ~20s/lần × 11 client ≈ 300s+). Capped: hết 45s thì bỏ phần còn
  // lại của ladder, chạy fallback rồi báo lỗi rõ ràng (UX, đừng treo 6 phút).
  // 4/10 FIX 502: Vercel cắt rewrite /api ở 120s (ROUTER_EXTERNAL_TARGET_ERROR,
  // body text/plain "An error occurred..." → FE crash JSON.parse). Tổng budget
  // toàn hàm ≤ ~85s: worker 15s + ladder 45s + fallback 25s → luôn trả JSON.
  // 4/10 FIX 502 (đợt 2): mỗi attempt 20s (bot-check thường fail nhanh, PO token
  // không bao giờ cần tới 30s) + deadline 35s → ladder ≤ ~40s, toàn hàm ≤ ~90s.
  const startedAt = Date.now();
  const LADDER_DEADLINE_MS = 35000;
  // R2 29/9: chia ladder làm 2 pha — no-cookie (nhanh, PO) → publicFallback →
  // cookie attempts (cuối). Video gated hỏng toàn bộ ladder thì fallback trả
  // sớm hơn ~100s; cookie chỉ giúp khi user nạp cookies logged-in mới.
  const attempts = potLadder();
  // IP datacenter bị bot-check: chạy hết 10 client là phí ~150s rồi Render cắt request.
  // Phát hiện "not a bot" sớm → thử vài client đại diện rồi nhảy thẳng sang fallback.
  let sawBotCheck = false;
  let noCookieTried = 0;
  const tryAttempt = async (attempt) => {
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
      const info = await withTimeout(ytdl(url, opts), 20000, 'Lấy stream');
      if (!info || !info.url) throw new Error('yt-dlp không trả được URL stream');
      const out = {
        id: info.id,
        title: info.title,
        author: info.channel || info.uploader || '',
        channel_id: info.channel_id || null,
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
      const emsg = String((e && (e.stderr || e.message)) || e);
      if (/not a bot|Sign in to confirm/i.test(emsg)) sawBotCheck = true;
      recordLadderError(attempt.client, attempt.cookies, e);
      console.log(`[ytdlpService] getVideoStream client="${attempt.client || 'default'}" cookies=${attempt.cookies} failed: ${emsg}`);
      return null;
    }
  };
  for (const attempt of attempts.filter(a => !a.cookies)) {
    if (Date.now() - startedAt > LADDER_DEADLINE_MS) break;
    // Bot-check rõ ràng từ IP này → chỉ thử 4 client đầu rồi né sang fallback cho nhanh.
    if (sawBotCheck && noCookieTried >= 4) break;
    noCookieTried++;
    const out = await tryAttempt(attempt);
    if (out) return out;
  }
  // Mọi attempt no-cookie thua (bot-check / "Requested format is not available")
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
  // Cuối cùng: các attempt có cookies — chỉ khi còn budget (tổng ≤ ~85s).
  if (Date.now() - startedAt < 60000) {
    for (const attempt of attempts.filter(a => a.cookies)) {
      if (Date.now() - startedAt > 70000) break;
      const out = await tryAttempt(attempt);
      if (out) return out;
    }
  }
  // R3: hết ladder + fallback → lỗi rõ ràng cho user (thay vì "Requested format
  // is not available" khó hiểu). Ghi kỹ thuật vào server log thôi.
  const err = new Error(
    'YouTube đang chặn video này với IP của server (bot-check / video age-restricted). ' +
    'Video thường vẫn xem được — thử video khác, hoặc cấp cookies.txt đăng nhập cho backend.'
  );
  err.detail = (lastErr && (lastErr.stderr || lastErr.message)) || '';
  throw toError(err);
}

// ─── Fallback public instances (Invidious → Piped) ─────────────────────────
// 29/9: IP Render bị YouTube cờ mạnh với video gated (VEVO/official). Khi cả
// ladder yt-dlp thua, stream qua public instance: IP INSTANCE gọi YouTube,
// Render (và trình duyệt user) chỉ nói chuyện với instance. Mọi thứ free.
// Instances đổi liên tục → hard-code list + health-check runtime (probe stream
// thật bằng Range request, chỉ nhận 200/206 + content-type video|audio).
const INVIDIOUS_HOSTS = [
  'invidious.f5.si', 'inv.nadeko.net', 'invidious.nerdvpn.de', 'invidious.privacyredirect.com',
  'iv.datura.network', 'invidious.einfachzocken.eu', 'yt.artemislena.eu', 'invidious.protokolla.fi',
  'iv.melmac.space', 'invidious.jing.rocks', 'yewtu.be',
];
const PIPED_HOSTS = [
  'api.piped.private.coffee', 'pipedapi.adminforge.de', 'pipedapi.reallyaweso.me', 'api.piped.yt',
  'piped-api.lunar.icu', 'api.piped.privacydev.net', 'pipedapi.drgns.space', 'pipedapi.ducks.party',
  'pipedapi.kavin.rocks',
];

// Danh sách instance SỐNG ĐỘNG (cache 30 phút). Instance Invidious/Piped chết
// liên tục — chỉ hard-code vài host là không đủ (đo 1/10: Invidious 1/5 sống,
// Piped 1/2). Gộp hard-code + list public, thử lần lượt tới khi có host chạy.
const _instCache = { at: 0, invidious: [], piped: [] };
async function discoverInstances() {
  if (Date.now() - _instCache.at < 30 * 60 * 1000) return _instCache;
  try {
    const res = await fetch('https://api.invidious.io/instances.json?sort_by=type,users', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const arr = await res.json();
      _instCache.invidious = (Array.isArray(arr) ? arr : [])
        .map(x => (Array.isArray(x) ? x[1] : x))
        .filter(o => o && (!o.type || o.type === 'https') && o.uri)
        .map(o => String(o.uri).replace(/^https?:\/\//, '').replace(/\/$/, ''));
    }
  } catch (e) { /* giữ cache cũ */ }
  try {
    const res = await fetch('https://piped-instances.kavin.rocks/', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const arr = await res.json();
      _instCache.piped = (Array.isArray(arr) ? arr : [])
        .map(o => (o && o.api_url) ? String(o.api_url).replace(/^https?:\/\//, '').replace(/\/$/, '') : null)
        .filter(Boolean);
    }
  } catch (e) { /* giữ cache cũ */ }
  _instCache.at = Date.now();
  return _instCache;
}
const uniqHosts = (a) => [...new Set(a.filter(Boolean))];

// Nhớ host vừa phục vụ được → lần sau thử nó trước (giảm thời gian + tăng tỉ lệ thành công).
const _prefHost = { invidious: null, piped: null };
function orderHosts(list, pref) {
  const u = uniqHosts(list);
  if (pref && u.includes(pref)) return [pref, ...u.filter(h => h !== pref)];
  return u;
}

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

// ── Captions-first (manual subs qua worker /subs) ─────────────────────────
// Manual captions chuẩn 100% (auto-captions kém hơn Whisper trên nhạc) — có
// manual subs thì trả srt + title + duration, route skip download+STT.
async function fetchCaptionsSrt(vid, timeoutMs = 120000) {
  if (!vid || !workerEnabled()) return null;
  const q = new URLSearchParams({ id: vid });
  if (WORKER_TOKEN) q.set('token', WORKER_TOKEN);
  try {
    const res = await fetch(`${WORKER_URL}/subs?${q.toString()}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || !data.ok || !data.content) return null;
    let srt = String(data.content);
    if (data.ext === 'vtt') srt = vttToSrt(srt);
    return { ok: true, lang: data.lang, ext: data.ext, srt, title: data.title, duration: data.duration };
  } catch (e) {
    console.log(`[ytdlpService] fetchCaptionsSrt(${vid}) failed: ${(e && e.message) || e}`);
    return null;
  }
}

// VTT → SRT text (phòng khi YouTube chỉ có vtt): cue id → số thứ tự, "." → ","
function vttToSrt(vtt) {
  const blocks = String(vtt || '').replace(/^WEBVTT[^\n]*\r?\n/, '').split(/\r?\n\r?\n/);
  const out = [];
  let n = 0;
  for (const b of blocks) {
    let lines = b.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) continue;
    if (!lines[0].includes('-->') && lines[1] && lines[1].includes('-->')) lines = lines.slice(1);
    const ts = lines.find(l => l.includes('-->'));
    if (!ts) continue;
    const textLines = lines.filter(l => l !== ts);
    n++;
    out.push(String(n), ts.replace(/\./g, ','), ...textLines, '');
  }
  return out.join('\n').trim() + '\n';
}

// SRT → plain text cho LLM summarize (bỏ cue numbers + timestamps, ghép dòng)
function transcriptFromSrt(srt) {
  const lines = String(srt || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (/^\d+$/.test(l)) continue;
    if (l.includes('-->')) continue;
    out.push(l);
  }
  return out.join(' ').replace(/ {2,}/g, ' ').trim();
}

// Dọn artifact transcript (STT/captions): collapse spaces, bỏ dòng lặp liên tiếp
function cleanTranscriptText(text) {
  const t = String(text || '').replace(/\r/g, '').replace(/[ \t]{2,}/g, ' ');
  const lines = t.split('\n').map(l => l.trim());
  const out = [];
  for (const l of lines) {
    if (l && out.length && out[out.length - 1] === l) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

// Dọn SRT artifact: bỏ header WEBVTT sót
function cleanSrtArtifacts(srt) {
  if (!srt) return null;
  const text = String(srt).replace(/^WEBVTT[^\n]*\r?\n?/i, '').trim();
  return text ? text + '\n' : null;
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
  try { await discoverInstances(); } catch (e) { /* dùng hard-code */ }
  const invHosts = orderHosts([...INVIDIOUS_HOSTS, ..._instCache.invidious], _prefHost.invidious).slice(0, 8);
  const pipedHosts = orderHosts([...PIPED_HOSTS, ..._instCache.piped], _prefHost.piped).slice(0, 6);
  const fbDeadline = Date.now() + 25000; // 4/10: cap tổng ~25s — Vercel cắt /api ở 120s, toàn bộ /stream phải xong ≤ ~85s
  // 1) Invidious: GET /api/v1/videos/{id} → formatStreams (progressive) → /latest_version local=true
  for (const host of invHosts) {
    if (Date.now() > fbDeadline) break;
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
          _prefHost.invidious = host;
          return fallbackShape(vid, { title: j.title, author: j.author, duration: j.lengthSeconds, views: j.viewCount, description: j.description },
            streamUrl, { formatId: `invidious:${pick.itag}`, ext: pick.container || 'mp4', height, provider: `invidious:${host}` });
        }
      }
      // audio-only (itag 140 m4a) — phát được trong <video> như bestaudio, đủ cho /summarize
      const audio = adaptive.find(f => f.itag === '140');
      if (audio) {
        const audioUrl = `https://${host}/latest_version?id=${vid}&itag=140&local=true`;
        if (await probeStream(audioUrl)) {
          _prefHost.invidious = host;
          return fallbackShape(vid, { title: j.title, author: j.author, duration: j.lengthSeconds, views: j.viewCount, description: j.description },
            audioUrl, { formatId: 'invidious:140', ext: 'm4a', height: 0, provider: `invidious:${host}`, audioOnly: true });
        }
      }
    } catch (e) { /* instance chết/time-out → thử con tiếp theo */ }
  }
  // 2) Piped: GET /streams/{id} → videoStreams (URL đã proxied qua proxy của Piped)
  for (const host of pipedHosts) {
    if (Date.now() > fbDeadline) break;
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
          _prefHost.piped = host;
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
        _prefHost.piped = host;
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
  // Worker residential TRƯỚC CÙNG (mirror getVideoStream): IP nhà không bị
  // bot-check, Render fetch audio qua tunnel rồi ffmpeg cắt/convert. Ladder
  // local chỉ chạy khi worker chết/tunnel đứt.
  const vid0 = extractVideoId(urlOrId);
  if (vid0 && workerEnabled()) {
    try {
      const out = await downloadAudioViaWorker(vid0, outPath);
      if (out) return out;
    } catch (e) {
      console.log(`[ytdlpService] downloadAudioViaWorker(${vid0}) failed: ${(e && e.message) || e}`);
    }
  }
  // R4: mirror getVideoStream — no-cookie → fallback public instance → cookie,
  // với deadline 150s (IP Render bị cờ thì ladder thua chậm, đừng treo 5+ phút).
  const startedAt = Date.now();
  const LADDER_DEADLINE_MS = 150000;
  const attempts = potLadder();
  const tryAttempt = async (attempt) => {
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
      recordLadderError(attempt.client, attempt.cookies, e);
      console.log(`[ytdlpService] downloadAudio client="${attempt.client || 'default'}" cookies=${attempt.cookies} failed: ${(e && (e.stderr || e.message)) || e}`);
      return null;
    }
  };
  for (const attempt of attempts.filter(a => !a.cookies)) {
    if (Date.now() - startedAt > LADDER_DEADLINE_MS) break;
    const out = await tryAttempt(attempt);
    if (out) return out;
  }
  // Ladder no-cookie thua → tải audio qua public instance (Invidious/Piped, stream qua IP instance)
  const vid = extractVideoId(urlOrId);
  if (vid) {
    try {
      const out = await downloadAudioViaFallback(vid, outPath);
      if (out) return out;
    } catch (e) {
      console.log(`[ytdlpService] downloadAudioViaFallback(${vid}) failed: ${(e && e.message) || e}`);
    }
  }
  // Cuối cùng: các attempt có cookies
  for (const attempt of attempts.filter(a => a.cookies)) {
    if (Date.now() - startedAt > LADDER_DEADLINE_MS) break;
    const out = await tryAttempt(attempt);
    if (out) return out;
  }
  const err = new Error(
    'YouTube đang chặn video này với IP của server (bot-check / video age-restricted) nên không tải được audio. ' +
    'Thử video khác, hoặc cấp cookies.txt đăng nhập cho backend.'
  );
  err.detail = (lastErr && (lastErr.stderr || lastErr.message)) || '';
  throw toError(err);
}

// Tải audio qua worker residential cho /youtube/summarize: worker tải audio-only
// (m4a) từ IP nhà (không bot-check) rồi proxy bytes qua tunnel → Render ffmpeg
// cắt 10 phút + convert mp3 mono 16kHz (chuẩn Whisper).
async function downloadAudioViaWorker(vid, outPath) {
  if (!workerEnabled()) return null;
  const startedAt = Date.now();
  const q = new URLSearchParams({ id: vid });
  if (WORKER_TOKEN) q.set('token', WORKER_TOKEN);
  const res = await fetch(`${WORKER_URL}/audio?${q.toString()}`, { signal: AbortSignal.timeout(240000) });
  if (!res.ok) throw new Error(`worker audio HTTP ${res.status}`);
  const raw = `${outPath}.worker.m4a`;
  await new Promise((resolve, reject) => {
    // fetch (undici) trả Web ReadableStream — bọc thành Node stream rồi mới pipe.
    const { Readable } = require('stream');
    const ws = fs.createWriteStream(raw);
    Readable.fromWeb(res.body).pipe(ws);
    ws.on('error', reject);
    ws.on('finish', resolve);
  });
  const size = fs.existsSync(raw) ? fs.statSync(raw).size : 0;
  if (!size) throw new Error('worker audio rỗng');
  const wTitle = decodeURIComponent(res.headers.get('x-worker-title') || '');
  const wDuration = Number(res.headers.get('x-worker-duration')) || undefined;
  if (!ffmpegPath) {
    // Không ffmpeg (hiếm): trả thẳng m4a — Groq/Whisper vẫn ăn.
    return { ok: true, title: wTitle, file: raw, duration: wDuration };
  }
  const dest = `${outPath}.mp3`;
  await new Promise((resolve, reject) => {
    require('child_process').execFile(ffmpegPath,
      ['-y', '-i', raw, '-vn', '-ar', '16000', '-ac', '1', '-b:a', '64k', '-t', String(SUMMARY_MAX_SECONDS), dest],
      { timeout: 180000 },
      (err, so, se) => err
        ? reject(new Error('ffmpeg worker-audio: ' + String(se || so || err.message || '').split('\n').filter(Boolean).slice(-1)[0] || 'lỗi không xác định'))
        : resolve());
  });
  try { fs.unlinkSync(raw); } catch (e) { /* ignore */ }
  if (!fs.existsSync(dest)) throw new Error('ffmpeg worker-audio không tạo được mp3');
  console.log(`[ytdlpService] downloadAudioViaWorker(${vid}) ok ${(fs.statSync(dest).size / 1048576).toFixed(2)}MB mp3 in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  return { ok: true, title: wTitle, file: dest, duration: wDuration };
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
    pot_warm: _potKeepAliveStarted,
    worker: { configured: workerEnabled(), url: WORKER_URL || null },
    ready: !!version,
    ladder_errors: getLadderErrors(),
  };
}

// Bật keepalive POT ngay khi module được nạp (server require service này lúc boot).
startPotKeepAlive();

// Host cho phép khi gọi /youtube/proxy dưới dạng KHÁCH (không token):
// googlevideo (stream trực tiếp) + worker tunnel đang cấu hình + các
// instance Invidious/Piped đã biết — chặn biến proxy thành fetch-proxy mở.
function isYouTubeProxyHost(host) {
  const h = String(host || '').toLowerCase();
  if (/(^|\.)googlevideo\.com$/.test(h)) return true;
  try {
    const w = WORKER_URL ? new URL(WORKER_URL).hostname.toLowerCase() : '';
    if (w && h === w) return true;
  } catch (e) { /* bỏ qua */ }
  const known = [...INVIDIOUS_HOSTS, ...PIPED_HOSTS,
    ...(_instCache.invidious || []), ...(_instCache.piped || [])]
    .map(x => String(x || '').toLowerCase());
  return known.includes(h);
}

module.exports = { searchVideos, getVideoStream, downloadAudio, getStatus, getLadderErrors, warmPotProvider, isYouTubeProxyHost, extractVideoId, fetchCaptionsSrt, transcriptFromSrt, cleanTranscriptText, cleanSrtArtifacts };
