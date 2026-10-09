#!/usr/bin/env node
/**
 * ytdlp-worker.js - Worker yt-dlp chạy trên máy dân dụng (IP nhà) cho Rexi AI.
 *
 * Mục đích: YouTube chặn bot theo IP datacenter (Render). Worker này chạy trên máy
 * nhà (residential IP), lấy URL stream THẬT rồi PROXY luôn bytes (không thể trả URL
 * trực tiếp vì googlevideo khoá `ip=` theo IP gọi). Backend gọi worker qua tunnel
 * (cloudflared) khi ladder yt-dlp trên cloud thất bại.
 *
 * Endpoints (đều cần ?token= nếu WORKER_TOKEN được set):
 *   GET /health                 -> { ok, version, ytdlp, uptime }
 *   GET /info?id=<videoId>      -> { title, author, duration, stream_url } (stream_url = worker /stream)
 *   GET /stream?id=<id>         -> proxy bytes video (hỗ trợ Range)
 *   GET /stream?url=<watchUrl>  -> như trên với URL đầy đủ
 *   GET /list?url=<chan/playlist>&limit=<n> -> liệt kê video (flat-playlist)
 *
 * Không phụ thuộc npm. Node >= 18 (dùng fetch/stream).
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');

const PORT = parseInt(process.env.PORT || '8787', 10);
const TOKEN = (process.env.WORKER_TOKEN || '').trim();

// Đường dẫn yt-dlp: mặc định binary bundled của repo Rexi AI.
const DEFAULT_YTDLP = path.join(
  __dirname, '..', '..', 'Backend', 'node_modules', 'youtube-dl-exec', 'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
);
const YTDLP = (process.env.YTDLP_BIN || DEFAULT_YTDLP).trim();

// Cookies (tuỳ chọn) - chỉ dùng cho video cần đăng nhập. Máy nhà thường không cần.
const COOKIES_FILE = (process.env.COOKIES_FILE || 'D:\\Temp\\opencode\\yt-cookies-auth.txt').trim();

const FMT = 'best[height<=720][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]/best';

// Thứ tự client: IP nhà -> android/mweb thường trả format 18 (combined) kể cả video gate.
const ATTEMPTS = [
  { client: 'android', cookies: false },
  { client: 'mweb', cookies: false },
  { client: 'android_vr', cookies: false },
  { client: null, cookies: false },
  { client: 'android', cookies: true },
];

const START = Date.now();
let cachedVersion = null;

function auth(req, res) {
  if (!TOKEN) return true;
  const u = new URL(req.url, 'http://x');
  const t = u.searchParams.get('token') || (req.headers['x-worker-token'] || '');
  if (t === TOKEN) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
  return false;
}

function run(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = '', err = '';
    const to = setTimeout(() => { try { p.kill(); } catch (e) {} reject(new Error('yt-dlp timeout')); }, timeoutMs);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(to); reject(e); });
    p.on('close', code => {
      clearTimeout(to);
      if (code === 0) resolve(out);
      else reject(new Error((err.split('\n').filter(Boolean).slice(-1)[0]) || ('yt-dlp exit ' + code)));
    });
  });
}

function watchUrl(idOrUrl) {
  const s = String(idOrUrl || '').trim();
  if (!s) throw new Error('missing id');
  return /^https?:\/\//.test(s) ? s : `https://www.youtube.com/watch?v=${s}`;
}

// Lấy URL stream trực tiếp (googlevideo). Trả { url, client, cookies }.
// Gom TẤT CẢ attempts rồi mới chọn — MP4 progressive luôn thắng HLS, không
// dừng ở attempt đầu trả HLS (trước đây fall-through sớm gây flip MP4/HLS).
async function resolveStream(idOrUrl) {
  const url = watchUrl(idOrUrl);
  const hasCookies = fs.existsSync(COOKIES_FILE);
  let lastErr = null;
  let firstHls = null;
  const isHlsUrl = (u) => /\/hls_playlist\/|manifest\.googlevideo\.com|\.m3u8($|\?)/i.test(u);
  for (const a of ATTEMPTS) {
    if (a.cookies && !hasCookies) continue;
    const args = ['-f', FMT, '-g', '--no-warnings', '--no-playlist', '--socket-timeout', '20'];
    if (a.client) args.push('--extractor-args', `youtube:player_client=${a.client}`);
    if (a.cookies) args.push('--cookies', COOKIES_FILE);
    args.push(url);
    try {
      const out = await run(YTDLP, args, 40000);
      const lines = out.split('\n').map(l => l.trim()).filter(l => /^https?:\/\//.test(l));
      // 4/10: ưu tiên URL progressive (mp4) — bỏ URL HLS (m3u8) nếu còn lựa chọn,
      // vì Chromium không chơi HLS khi không có hls.js.
      const nonHls = lines.filter(l => !isHlsUrl(l));
      if (nonHls.length) return { url: nonHls[nonHls.length - 1], client: a.client || 'default', cookies: a.cookies };
      if (lines.length && !firstHls) firstHls = { url: lines[lines.length - 1], client: a.client || 'default', cookies: a.cookies, hls: true };
    } catch (e) {
      lastErr = e;
      console.log(`[worker] resolve client=${a.client || 'default'} cookies=${a.cookies} fail: ${e.message}`);
    }
  }
  if (firstHls) return firstHls;
  throw lastErr || new Error('yt-dlp không lấy được URL stream');
}

// Lấy metadata JSON (dùng dump-json, không tải).
async function resolveInfo(idOrUrl) {
  const url = watchUrl(idOrUrl);
  const hasCookies = fs.existsSync(COOKIES_FILE);
  let lastErr = null;
  for (const a of ATTEMPTS) {
    if (a.cookies && !hasCookies) continue;
    const args = ['-J', '--no-warnings', '--no-playlist', '--socket-timeout', '20', '-f', FMT];
    if (a.client) args.push('--extractor-args', `youtube:player_client=${a.client}`);
    if (a.cookies) args.push('--cookies', COOKIES_FILE);
    args.push(url);
    try {
      const out = await run(YTDLP, args, 40000);
      const d = JSON.parse(out);
      return {
        id: d.id, title: d.title, author: d.channel || d.uploader || '',
        channel_id: d.channel_id || null,
        duration: d.duration, views: d.view_count,
        description: String(d.description || '').slice(0, 2000),
        format_id: d.format_id, ext: d.ext, height: d.height,
      };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('yt-dlp không lấy được info');
}

function selfBase(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// Cache URL đã resolve theo video id (~10 phút): mỗi request /stream không
// resolve lại nữa → không flip-flop MP4/HLS giữa probe và phát, và nhanh hơn.
// googlevideo URL thường sống ~6h nên cache 10 phút an toàn.
const resolveCache = new Map(); // id -> { url, client, cookies, hls, at }
const RESOLVE_TTL_MS = 10 * 60 * 1000;

async function resolveStreamCached(idOrUrl) {
  const key = String(idOrUrl || '').trim();
  const now = Date.now();
  const hit = resolveCache.get(key);
  if (hit && now - hit.at < RESOLVE_TTL_MS) return hit;
  const r = await resolveStream(idOrUrl);
  resolveCache.set(key, { ...r, at: now });
  if (resolveCache.size > 200) {
    const first = resolveCache.keys().next().value;
    resolveCache.delete(first);
  }
  return r;
}

async function proxyStream(req, res, idOrUrl) {
  const { url } = await resolveStreamCached(idOrUrl);
  const headers = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.youtube.com/', 'Origin': 'https://www.youtube.com' };
  if (req.headers.range) headers['Range'] = req.headers.range;
  const upstream = await fetch(url, { headers, redirect: 'follow' });
  const h = { 'Content-Type': upstream.headers.get('content-type') || 'video/mp4' };
  for (const k of ['content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(k); if (v) h[k] = v;
  }
  h['Access-Control-Allow-Origin'] = '*';
  h['Access-Control-Allow-Headers'] = '*';
  res.writeHead(upstream.status, h);
  if (upstream.body) {
    const { Readable } = require('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } else { res.end(); }
}

// Proxy TRỰC TIẾP 1 URL googlevideo (segment/playlist từ m3u) — không resolve lại.
// Segment bị IP-lock theo IP yêu cầu nên phải fetch từ IP nhà này.
async function proxyDirect(req, res, url) {
  const headers = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.youtube.com/', 'Origin': 'https://www.youtube.com' };
  if (req.headers.range) headers['Range'] = req.headers.range;
  const upstream = await fetch(url, { headers, redirect: 'follow' });
  const h = { 'Content-Type': upstream.headers.get('content-type') || 'video/mp4' };
  for (const k of ['content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(k); if (v) h[k] = v;
  }
  h['Access-Control-Allow-Origin'] = '*';
  h['Access-Control-Allow-Headers'] = '*';
  res.writeHead(upstream.status, h);
  if (upstream.body) {
    const { Readable } = require('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } else { res.end(); }
}

// Lấy bình luận (yt-dlp -J --write-comments) — chậm 10-30s, chạy qua IP nhà
async function resolveComments(idOrUrl) {
  const url = watchUrl(idOrUrl);
  const hasCookies = fs.existsSync(COOKIES_FILE);
  const args = ['-J', '--no-warnings', '--no-playlist', '--socket-timeout', '20',
    '--write-comments', '--extractor-args', 'youtube:max_comments=30,all;max_replies=0,all'];
  if (hasCookies) args.push('--cookies', COOKIES_FILE);
  args.push(url);
  const out = await run(YTDLP, args, 90000);
  const data = JSON.parse(out);
  const comments = (data.comments || [])
    .filter(c => c && c.text)
    .sort((a, b) => (b.like_count || 0) - (a.like_count || 0))
    .slice(0, 30)
    .map(c => ({
      author: c.author || 'Ẩn danh',
      text: c.text,
      likes: c.like_count || 0,
      time: c.timestamp ? new Date(c.timestamp * 1000).toISOString().substring(0, 10) : '',
      avatar: c.author_thumbnail || null,
    }));
  return { comments, count: data.comment_count || comments.length };
}

// Lấy avatar kênh: yt-dlp -J trang channel → thumbnails có id 'avatar_uncropped'.
// Nhanh (~2s), cache 7 ngày phía BE (avatar hiếm khi đổi).
async function resolveChannelAvatar(channelId) {
  const id = String(channelId || '').trim();
  if (!/^UC[\w-]{20,}$/.test(id)) throw new Error('channel_id không hợp lệ');
  const out = await run(YTDLP, ['-J', '--no-warnings', '--flat-playlist', '--skip-download',
    '--socket-timeout', '20', '--playlist-end', '1', `https://www.youtube.com/channel/${id}`], 30000);
  const data = JSON.parse(out);
  const thumbs = (data && data.thumbnails) || [];
  const pick = thumbs.find(t => t && t.id === 'avatar_uncropped')
    || thumbs.filter(t => t && t.width && t.height && t.width === t.height)
      .sort((a, b) => (b.width || 0) - (a.width || 0))[0]
    || thumbs[thumbs.length - 1];
  if (!pick || !pick.url) throw new Error('Không tìm thấy avatar kênh');
  return { avatar_url: pick.url, channel: data.channel || data.uploader || '', channel_id: id };
}

// Liệt kê video của kênh/playlist (flat-playlist) — nhanh, không tải.
// Trả [{ id, title, url, uploader, duration, timestamp, upload_date, view_count, platform }].
// Best-effort: nhiều site (YouTube tốt nhất) hỗ trợ; site không hỗ trợ → mảng rỗng/lỗi.
async function resolveList(idOrUrl, limit) {
  const target = String(idOrUrl || '').trim();
  if (!target) throw new Error('missing url');
  const url = /^https?:\/\//.test(target) ? target : watchUrl(target);
  const n = Math.max(1, Math.min(parseInt(limit, 10) || 20, 200));
  const hasCookies = fs.existsSync(COOKIES_FILE);
  const args = ['--flat-playlist', '--dump-json', '--ignore-errors', '--no-warnings',
    '--skip-download', '--playlist-end', String(n), '--socket-timeout', '20'];
  if (hasCookies) args.push('--cookies', COOKIES_FILE);
  args.push(url);
  const out = await run(YTDLP, args, 90000);

  const mapEntry = (d) => {
    if (!d || typeof d !== 'object') return null;
    const id = d.id || null;
    let vurl = d.webpage_url || null;
    if (!vurl) {
      const raw = d.url || '';
      if (/^https?:\/\//.test(raw)) vurl = raw;
      else if (id && /youtube/i.test(d.ie_key || d.extractor || '')) vurl = `https://www.youtube.com/watch?v=${id}`;
      else if (id) vurl = raw || `https://www.youtube.com/watch?v=${id}`;
    }
    const ts = d.timestamp || d.release_timestamp || null;
    return {
      id,
      title: d.title || null,
      url: vurl || (id ? `https://www.youtube.com/watch?v=${id}` : null),
      uploader: d.uploader || d.channel || d.uploader_id || null,
      duration: d.duration != null ? d.duration : null,
      timestamp: ts != null ? ts : null,
      upload_date: d.upload_date || null,
      view_count: d.view_count != null ? d.view_count : (d.view_count == null && d.views != null ? d.views : null),
      platform: d.ie_key || d.extractor || null,
    };
  };

  const items = [];
  let platform = null;
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    let d;
    try { d = JSON.parse(t); } catch (e) { continue; }
    if (d && d._type === 'playlist' && Array.isArray(d.entries)) {
      platform = platform || d.extractor || d.ie_key || null;
      for (const e of d.entries) { const m = mapEntry(e); if (m && m.id) items.push(m); }
    } else if (d && d.id) {
      platform = platform || d.extractor || d.ie_key || null;
      const m = mapEntry(d); if (m && m.id) items.push(m);
    }
  }
  // Fallback: output là 1 JSON object duy nhất (một số phiên bản yt-dlp)
  if (!items.length) {
    try {
      const d = JSON.parse(out);
      if (d && d._type === 'playlist' && Array.isArray(d.entries)) {
        platform = d.extractor || d.ie_key || platform;
        for (const e of d.entries) { const m = mapEntry(e); if (m && m.id) items.push(m); }
      } else if (d && d.id) {
        platform = d.extractor || d.ie_key || platform;
        const m = mapEntry(d); if (m && m.id) items.push(m);
      }
    } catch (e) { /* ignore */ }
  }
  return { platform, count: items.slice(0, n).length, items: items.slice(0, n) };
}

async function channelAvatarHandler(req, res, id) {
  const started = Date.now();
  try {
    const info = await resolveChannelAvatar(id);
    console.log(`[worker] channel-avatar ok: ${id}, ${Date.now() - started}ms`);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ ok: true, ...info, ms: Date.now() - started }));
  } catch (e) {
    console.log(`[worker] channel-avatar fail: ${id}: ${e.message}`);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

async function commentsHandler(req, res, idOrUrl) {
  const started = Date.now();
  try {
    const info = await resolveComments(idOrUrl);
    console.log(`[worker] comments ok: ${info.count} comments, ${Date.now() - started}ms`);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ ok: true, ...info, ms: Date.now() - started }));
  } catch (e) {
    console.log(`[worker] comments fail: ${e.message}`);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
      return res.end();
    }
    if (u.pathname === '/health') {
      if (!cachedVersion) { try { cachedVersion = (await run(YTDLP, ['--version'], 8000)).trim(); } catch (e) { cachedVersion = null; } }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, version: cachedVersion, ytdlp: YTDLP, bin_ok: fs.existsSync(YTDLP), cookies: fs.existsSync(COOKIES_FILE), uptime: Math.round((Date.now() - START) / 1000), auth: !!TOKEN }));
    }
    if (!auth(req, res)) return;
    const id = u.searchParams.get('id') || u.searchParams.get('url');
    if (u.pathname === '/info') {
      const info = await resolveInfo(id);
      const base = selfBase(req);
      const q = TOKEN ? `?token=${encodeURIComponent(TOKEN)}&id=${encodeURIComponent(id)}` : `?id=${encodeURIComponent(id)}`;
      info.stream_url = `${base}/stream${q}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, ...info }));
    }
    // /resolve?id= → info + stream qua resolveStreamCached (1 lần resolve thống nhất,
    // tránh /info và /stream resolve khác nhau gây flip MP4/HLS)
    if (u.pathname === '/resolve') {
      const info = await resolveInfo(id);
      const base = selfBase(req);
      const q = TOKEN ? `?token=${encodeURIComponent(TOKEN)}&id=${encodeURIComponent(id)}` : `?id=${encodeURIComponent(id)}`;
      info.stream_url = `${base}/stream${q}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, ...info }));
    }
    if (u.pathname === '/stream') {
      if (!id) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'missing id/url' })); }
      // URL googlevideo trực tiếp (segment từ m3u rewritten) — proxy luôn không resolve lại
      if (/^https?:\/\//.test(id) && /googlevideo\.com/i.test(id)) {
        return await proxyDirect(req, res, id);
      }
      return await proxyStream(req, res, id);
    }
    if (u.pathname === '/comments') {
      if (!id) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'missing id/url' })); }
      return await commentsHandler(req, res, id);
    }
    if (u.pathname === '/channel-avatar') {
      if (!id) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'missing id (channel_id)' })); }
      return await channelAvatarHandler(req, res, id);
    }
    if (u.pathname === '/list') {
      if (!id) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'missing url' })); }
      const started = Date.now();
      try {
        const info = await resolveList(id, u.searchParams.get('limit'));
        console.log(`[worker] list ok: ${info.count} items, ${Date.now() - started}ms`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ ok: true, ...info, ms: Date.now() - started }));
      } catch (e) {
        console.log(`[worker] list fail: ${e.message}`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  } catch (e) {
    console.error('[worker] error:', e.message);
    if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); }
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`[worker] listening on http://127.0.0.1:${PORT}  ytdlp=${YTDLP}  auth=${!!TOKEN}`);
});
