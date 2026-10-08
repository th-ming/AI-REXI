/**
 * scraper.js — "Data Scraper Kit" (ADDITIVE, an toàn, không bao giờ crash server).
 *
 * Trích xuất info / nội dung / bình luận từ link:
 *   - Social/video (qua yt-dlp worker IP nhà): YouTube, TikTok, Instagram, X/Twitter,
 *     Facebook, ... bất kỳ site nào yt-dlp hỗ trợ.
 *   - Web thường (fetch trực tiếp): title, description, og:*, readable text, links.
 *
 * Tái dùng hạ tầng có sẵn: worker yt-dlp cấu hình qua env YTDLP_WORKER_URL + YTDLP_WORKER_TOKEN
 * (worker: tools/ytdlp-worker/worker.js — endpoint GET /info, /comments). Không cấu hình worker
 * vẫn chạy được phần web; phần social sẽ báo lỗi sạch (không 500-crash).
 *
 * Mọi hàm throw Error với message rõ ràng; route bọc try/catch trả {ok:false,error}.
 * TUYỆT ĐỐI không log token (đã strip).
 */

'use strict';

const { assertPublicUrlAsync } = require('../utils/urlSafety');

const WORKER_URL = (process.env.YTDLP_WORKER_URL || '').trim().replace(/\/+$/, '');
const WORKER_TOKEN = (process.env.YTDLP_WORKER_TOKEN || '').trim();
const WORKER_INFO_TIMEOUT_MS = 45000;
const WORKER_COMMENTS_TIMEOUT_MS = 100000;
const WEB_TIMEOUT_MS = 15000;
const MAX_HTML_CHARS = 1500000;
const PAGE_TEXT_LIMIT = 20000;
const INFO_TEXT_LIMIT = 5000;
const LINKS_LIMIT = 200;

// UA giống trình duyệt thật để nhiều site không chặn bot.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Danh sách site tiêu biểu yt-dlp hỗ trợ (thực tế yt-dlp hỗ trợ hàng nghìn site).
const SUPPORTS = [
  'youtube', 'tiktok', 'instagram', 'twitter/x', 'facebook', 'vimeo', 'dailymotion',
  'twitch', 'reddit', 'soundcloud', 'pinterest', 'linkedin', 'bilibili',
  'douyin', 'xiaohongshu', 'generic-web',
];

function workerEnabled() {
  return !!WORKER_URL;
}

function workerStatus() {
  return { configured: workerEnabled(), url: WORKER_URL || null };
}

// Chuẩn hoá URL: trim + bắt buộc http(s). Trả {ok,url} hoặc {ok:false,error}.
function normalizeUrl(input) {
  const s = String(input == null ? '' : input).trim();
  if (!s) return { ok: false, error: 'Thiếu url' };
  if (!/^https?:\/\//i.test(s)) return { ok: false, error: 'url phải bắt đầu bằng http:// hoặc https://' };
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Chỉ hỗ trợ http/https' };
    return { ok: true, url: u.toString() };
  } catch (e) {
    return { ok: false, error: 'url không hợp lệ' };
  }
}

// Ẩn token khỏi log (nếu vô tình xuất hiện trong URL).
function sanitizeForLog(u) {
  try {
    return String(u).replace(/([?&]token=)[^&]*/gi, '$1***');
  } catch (e) {
    return 'url';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML helpers (regex/strip — không thêm dependency mới)
// ─────────────────────────────────────────────────────────────────────────────
function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; } })
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return m; } })
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&hellip;/g, '…').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”');
}

// Bỏ script/style/tag → text đọc được (giữ xuống dòng theo block).
function stripTags(html) {
  return decodeEntities(
    String(html == null ? '' : html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|table|blockquote|pre)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(td|th)>/gi, '\t')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\f]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    .trim();
}

function extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m && m[1] && m[1].trim()) return decodeEntities(m[1]).trim().slice(0, 500);
  return '';
}

function metaContent(html, key) {
  const h = String(html || '');
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${esc}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${esc}["']`, 'i');
  const m = h.match(re1) || h.match(re2);
  return m ? decodeEntities(m[1]).trim() : '';
}

function extractLang(html) {
  const m = String(html || '').match(/<html[^>]*\blang=["']([^"']+)["']/i);
  return m ? m[1].trim() : '';
}

function extractLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    let href = decodeEntities(m[1]).trim();
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel|data):/i.test(href)) continue;
    try { href = new URL(href, baseUrl).toString(); } catch (e) { continue; }
    if (!/^https?:\/\//i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
    if (out.length >= LINKS_LIMIT) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch web
// ─────────────────────────────────────────────────────────────────────────────
async function fetchHtml(rawUrl) {
  const res = await fetch(rawUrl, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi,en-US;q=0.8,en;q=0.7',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
  });
  let body = '';
  try { body = await res.text(); } catch (e) { body = ''; }
  if (body.length > MAX_HTML_CHARS) body = body.slice(0, MAX_HTML_CHARS);
  return {
    status: res.status,
    ok: res.ok,
    contentType: (res.headers.get('content-type') || '').toLowerCase(),
    html: body,
    finalUrl: res.url || rawUrl,
  };
}

// Web info: title, description, og_image, og_site_name, text (5000 ký tự), links.
async function webInfo(rawUrl) {
  const r = await fetchHtml(rawUrl);
  if (r.status >= 400) throw new Error(`Trang trả về HTTP ${r.status}`);
  const isHtml = r.contentType.includes('html') || /<html|<head|<body|<title/i.test(r.html);
  const title = extractTitle(r.html) || metaContent(r.html, 'og:title') || r.finalUrl;
  const description = metaContent(r.html, 'description') || metaContent(r.html, 'og:description');
  const og_image = metaContent(r.html, 'og:image') || metaContent(r.html, 'twitter:image');
  const og_site_name = metaContent(r.html, 'og:site_name');
  const text = isHtml ? stripTags(r.html).slice(0, INFO_TEXT_LIMIT) : String(r.html || '').slice(0, INFO_TEXT_LIMIT).trim();
  const links = isHtml ? extractLinks(r.html, r.finalUrl) : [];
  return {
    title: title || null,
    description: description || null,
    og_image: og_image || null,
    og_site_name: og_site_name || null,
    text: text || '',
    links,
    url: r.finalUrl,
    status: r.status,
  };
}

// Page: chỉ readable text + title + lang.
async function page(rawUrl) {
  const r = await fetchHtml(rawUrl);
  if (r.status >= 400) throw new Error(`Trang trả về HTTP ${r.status}`);
  const isHtml = r.contentType.includes('html') || /<html|<head|<body|<title/i.test(r.html);
  const title = extractTitle(r.html) || metaContent(r.html, 'og:title') || r.finalUrl;
  const lang = extractLang(r.html);
  const text = isHtml ? stripTags(r.html).slice(0, PAGE_TEXT_LIMIT) : String(r.html || '').slice(0, PAGE_TEXT_LIMIT).trim();
  return { title: title || null, text: text || '', lang: lang || null, url: r.finalUrl, status: r.status };
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker yt-dlp (social/video)
// ─────────────────────────────────────────────────────────────────────────────
function workerQ(extra) {
  const q = new URLSearchParams(extra || {});
  if (WORKER_TOKEN) q.set('token', WORKER_TOKEN);
  return q.toString();
}

async function workerGet(pathAndQuery, timeoutMs) {
  const res = await fetch(`${WORKER_URL}${pathAndQuery}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`worker HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  if (!j) throw new Error('worker trả JSON không hợp lệ');
  if (j.ok === false) throw new Error(j.error || 'worker báo lỗi');
  return j;
}

function normalizeWorkerInfo(j, url) {
  const height = j.height != null ? j.height : null;
  return {
    title: j.title || null,
    uploader: j.author || j.uploader || null,
    duration: j.duration != null ? j.duration : null,
    upload_date: j.upload_date || null,
    description: j.description || null,
    thumbnail: j.thumbnail || j.thumbnail_url || null,
    view_count: j.views != null ? j.views : (j.view_count != null ? j.view_count : null),
    like_count: j.like_count != null ? j.like_count : null,
    comment_count: j.comment_count != null ? j.comment_count : null,
    webpage_url: url,
    extractor: j.extractor || 'worker-ytdlp',
    // Worker chỉ resolve 1 progressive format (combined ≤720p) — vẫn trả mảng đúng schema.
    formats: [{
      format_id: j.format_id != null ? String(j.format_id) : null,
      ext: j.ext || null,
      resolution: height ? `${height}p` : null,
      filesize: j.filesize != null ? j.filesize : null,
    }],
    stream_url: j.stream_url || null,
  };
}

async function workerInfo(url) {
  const j = await workerGet(`/info?${workerQ({ url })}`, WORKER_INFO_TIMEOUT_MS);
  return normalizeWorkerInfo(j, url);
}

async function workerComments(url, max) {
  const limit = Math.max(1, Math.min(parseInt(max, 10) || 30, 100));
  const j = await workerGet(`/comments?${workerQ({ url })}`, WORKER_COMMENTS_TIMEOUT_MS);
  const arr = Array.isArray(j.comments) ? j.comments : [];
  return arr.slice(0, limit).map((c) => ({
    author: c.author || 'Ẩn danh',
    text: c.text || '',
    like_count: c.likes != null ? c.likes : (c.like_count != null ? c.like_count : 0),
    published: c.time || c.published || null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
function status() {
  return { ok: true, ytdlp_worker: workerStatus(), web: true, supports: SUPPORTS };
}

// info(): ưu tiên worker → fallback web (guarded). Trả {ok,source,data}.
async function info(rawUrl) {
  const n = normalizeUrl(rawUrl);
  if (!n.ok) throw new Error(n.error);
  const safe = await assertPublicUrlAsync(n.url);
  if (!safe.ok) throw new Error(safe.reason);

  let workerErr = null;
  if (workerEnabled()) {
    try {
      const data = await workerInfo(n.url);
      return { ok: true, source: 'ytdlp', data };
    } catch (e) {
      workerErr = e && e.message ? e.message : 'worker lỗi';
      console.log(`[scraper] workerInfo thất bại (${sanitizeForLog(n.url)}): ${workerErr}`);
    }
  }
  const data = await webInfo(n.url);
  return { ok: true, source: 'web', data, note: workerErr ? 'yt-dlp worker không khả dụng, đã dùng đọc web.' : undefined };
}

async function pageExtract(rawUrl) {
  const n = normalizeUrl(rawUrl);
  if (!n.ok) throw new Error(n.error);
  const safe = await assertPublicUrlAsync(n.url);
  if (!safe.ok) throw new Error(safe.reason);
  return { ok: true, source: 'web', data: await page(n.url) };
}

async function comments(rawUrl, max) {
  const n = normalizeUrl(rawUrl);
  if (!n.ok) throw new Error(n.error);
  if (!workerEnabled()) throw new Error('Chưa cấu hình yt-dlp worker (YTDLP_WORKER_URL) — không lấy được bình luận.');
  const data = await workerComments(n.url, max);
  return { ok: true, source: 'ytdlp', count: data.length, data };
}

async function batch(urls) {
  const list = (Array.isArray(urls) ? urls : [])
    .map((u) => String(u == null ? '' : u).trim())
    .filter(Boolean)
    .slice(0, 10);
  if (!list.length) throw new Error('Thiếu danh sách urls (mảng, tối đa 10).');
  const results = [];
  for (const u of list) {
    try {
      const r = await info(u);
      results.push({ ok: true, url: u, source: r.source, data: r.data });
    } catch (e) {
      results.push({ ok: false, url: u, error: e && e.message ? e.message : 'lỗi không xác định' });
    }
  }
  return { ok: true, count: results.length, results };
}

// download(): trả URL media trực tiếp + headers (KHÔNG proxy bytes).
async function download(rawUrl) {
  const n = normalizeUrl(rawUrl);
  if (!n.ok) throw new Error(n.error);
  let lastErr = null;

  if (workerEnabled()) {
    try {
      const j = await workerGet(`/info?${workerQ({ url: n.url })}`, WORKER_INFO_TIMEOUT_MS);
      const media = j.stream_url || null;
      if (media) {
        return {
          ok: true,
          source: 'ytdlp',
          url: n.url,
          media_url: media,
          formats: normalizeWorkerInfo(j, n.url).formats,
          headers: {},
          cookies_note: 'URL stream của worker đã qua IP nhà; video gated có thể cần cookies trên worker.',
        };
      }
      lastErr = 'worker không trả stream_url';
    } catch (e) {
      lastErr = e && e.message ? e.message : 'worker lỗi';
    }
  }

  // Fallback: yt-dlp binary cục bộ (nếu có) — guarded, không bao giờ crash.
  try {
    const ytdl = require('youtube-dl-exec');
    const raw = await Promise.race([
      ytdl(n.url, { dumpSingleJson: true, noPlaylist: true, skipDownload: true, quiet: true, noWarnings: true, socketTimeout: 20, format: 'best' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('yt-dlp quá 40s')), 40000)),
    ]);
    const media = raw && (raw.url || (Array.isArray(raw.requested_downloads) && raw.requested_downloads[0] && raw.requested_downloads[0].url));
    if (media) {
      return {
        ok: true,
        source: 'local-ytdlp',
        url: n.url,
        media_url: media,
        formats: [{
          format_id: raw.format_id != null ? String(raw.format_id) : null,
          ext: raw.ext || null,
          resolution: raw.height ? `${raw.height}p` : null,
          filesize: raw.filesize != null ? raw.filesize : null,
        }],
        headers: { 'User-Agent': BROWSER_UA },
        cookies_note: 'URL googlevideo/媒体 có thể bị khoá theo IP — tải từ IP khác có thể 403.',
      };
    }
    lastErr = lastErr || 'yt-dlp không trả URL media';
  } catch (e) {
    lastErr = lastErr || (e && e.message ? e.message : 'yt-dlp lỗi');
  }

  return { ok: false, error: lastErr || 'Không lấy được URL media trực tiếp.' };
}

module.exports = {
  status,
  info,
  page: pageExtract,
  comments,
  batch,
  download,
  normalizeUrl,
  workerStatus,
  workerEnabled,
  SUPPORTS,
};
