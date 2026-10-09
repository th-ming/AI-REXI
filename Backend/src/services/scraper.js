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
const WORKER_LIST_TIMEOUT_MS = 100000;
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
  'douyin', 'xiaohongshu', 'snapchat', 'tumblr', 'telegram', 'bandcamp', 'mixcloud',
  'streamable', 'rumble', 'odysee', 'kick', 'likee', 'threads', 'weibo', 'youku',
  'iqiyi', 'pornhub', 'xvideos', 'generic-web',
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

// Liệt kê video của kênh/playlist qua worker /list (flat-playlist).
async function workerList(url, limit) {
  const j = await workerGet(`/list?${workerQ({ url, limit: String(limit) })}`, WORKER_LIST_TIMEOUT_MS);
  const arr = Array.isArray(j.items) ? j.items : [];
  return { platform: j.platform || null, items: arr };
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH — tìm kênh / từ khoá (ADDITIVE). Web qua DuckDuckGo HTML; YouTube qua
// worker ytsearch; platform khác → web search scoped (`site:<host> <q>`).
// Không bao giờ crash: thiếu worker → fallback web; lỗi parse → mảng rỗng.
// ─────────────────────────────────────────────────────────────────────────────
const SEARCH_RESULT_LIMIT = 25;

// Platform → host để scope `site:` khi không có API riêng.
const PLATFORM_SITE = {
  tiktok: 'tiktok.com',
  youtube: 'youtube.com',
  instagram: 'instagram.com',
  twitter: 'twitter.com',
  'twitter/x': 'twitter.com',
  x: 'twitter.com',
  facebook: 'facebook.com',
  reddit: 'reddit.com',
  linkedin: 'linkedin.com',
  pinterest: 'pinterest.com',
  bilibili: 'bilibili.com',
  threads: 'threads.net',
};

function normSearchLimit(n) {
  return Math.max(1, Math.min(parseInt(n, 10) || 10, SEARCH_RESULT_LIMIT));
}

// Giải mã redirect DuckDuckGo: https://duckduckgo.com/l/?uddg=<encoded> → URL thật.
function decodeDdgRedirect(href) {
  let h = decodeEntities(String(href || '')).trim();
  if (!h) return '';
  if (h.startsWith('//')) h = 'https:' + h;
  try {
    const u = new URL(h);
    if (/(^|\.)duckduckgo\.com$/i.test(u.hostname)) {
      const uddg = u.searchParams.get('uddg');
      if (uddg) return uddg;
    }
  } catch (e) { /* không phải URL tuyệt đối → trả nguyên */ }
  return h;
}

// Parse trang kết quả html.duckduckgo.com/html/ → [{title,url,snippet}].
function parseDdgResults(html, limit) {
  const h = String(html || '');
  const out = [];
  const reA = /<a\b([^>]*\bclass=["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = reA.exec(h)) !== null) {
    const hrefM = (m[1] || '').match(/\bhref=["']([^"']*)["']/i);
    if (!hrefM) continue;
    const url = decodeDdgRedirect(hrefM[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const title = stripTags(m[2]).trim();
    if (!title) continue;
    out.push({ title, url });
    if (out.length >= limit) break;
  }
  const snippets = [];
  const reS = /<a\b[^>]*\bclass=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = reS.exec(h)) !== null) snippets.push(stripTags(m[1]).trim());
  return out.map((a, i) => ({ title: a.title, url: a.url, snippet: snippets[i] || undefined }));
}

// Giải mã link redirect Bing: https://www.bing.com/ck/a?...&u=a1<base64url> → URL thật.
function decodeBingUrl(href) {
  const h = decodeEntities(String(href || '')).trim();
  try {
    const u = new URL(h, 'https://www.bing.com');
    if (/(^|\.)bing\.com$/i.test(u.hostname)) {
      const uu = u.searchParams.get('u');
      if (uu && /^a1/i.test(uu)) {
        const b64 = uu.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        try {
          const dec = Buffer.from(b64, 'base64').toString('utf8');
          if (/^https?:\/\//i.test(dec)) return dec;
        } catch (e) { /* ignore */ }
      }
      if (u.pathname === '/' && !u.search) return '';
    }
    return u.toString();
  } catch (e) { return h; }
}

// Parse trang kết quả Bing HTML (`<li class="b_algo">` → h2>a + p) → [{title,url,snippet}].
function parseBingResults(html, limit) {
  const h = String(html || '');
  const out = [];
  const parts = h.split(/<li[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>/i).slice(1);
  for (const part of parts) {
    const block = part.split(/<\/li>/i)[0];
    const aM = block.match(/<h2[^>]*>[\s\S]*?<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!aM) continue;
    const url = decodeBingUrl(aM[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const title = stripTags(aM[2]).trim();
    if (!title) continue;
    const pM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = pM ? stripTags(pM[1]).trim() : '';
    out.push({ title, url, snippet: snippet || undefined });
    if (out.length >= limit) break;
  }
  return out;
}

// Parse Google News RSS (<item><title><link><description>) → [{title,url,snippet}].
// Đây là nguồn gần như không chặn IP datacenter (dùng làm fallback cuối cho web search).
function parseGoogleNewsRss(xml, limit) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    const it = m[1];
    const t = (it.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const l = (it.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const d = (it.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '';
    const url = decodeEntities(String(l).replace(/<!\[CDATA\[|\]\]>/g, '')).trim();
    if (!url) continue;
    out.push({
      title: decodeEntities(stripTags(t)).trim() || url,
      url,
      snippet: stripTags(d).slice(0, 300) || undefined,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// GET HTML 1 URL qua worker (IP nhà) — dùng khi có worker, vì datacenter IP của cloud
// hay bị engine chặn/kết quả rác. Fallback fetch trực tiếp nếu worker lỗi/không có.
async function workerFetchHtml(url) {
  const j = await workerGet(`/fetch?${workerQ({ url })}`, 30000);
  if (!j || typeof j.html !== 'string') throw new Error('worker /fetch không trả html');
  return j.html;
}

// Lấy HTML 1 URL tìm kiếm: ưu tiên worker (IP nhà) → fallback fetch trực tiếp.
async function searchFetch(url) {
  if (workerEnabled()) {
    try { return await workerFetchHtml(url); }
    catch (e) { console.log(`[scraper] workerFetchHtml thất bại: ${e && e.message ? e.message : 'lỗi'}`); }
  }
  const r = await fetchHtml(url);
  return r.html;
}

// Fetch trực tiếp bằng IP của server (bỏ qua worker) — dùng làm lượt thử phụ khi
// worker trả HTML rỗng/rác (vd IP nhà tạm bị engine chặn).
async function directFetchHtml(url) {
  const r = await fetchHtml(url);
  return r.html;
}

// Web search (HTML, không cần API key). Thử nhiều engine theo thứ tự — DuckDuckGo
// trước (theo chuẩn), rồi Bing (một số datacenter IP như Render chặn DDG nhưng tới
// được Bing). platform != 'web' → scope `site:<host> <q>`; query scoped rỗng → thử thô.
// Mỗi lượt thử: worker (IP nhà) trước; nếu rỗng → thử lại fetch trực tiếp (IP server).
async function webSearch(q, limit, platform) {
  const p = String(platform || 'web').toLowerCase();
  const host = PLATFORM_SITE[p];
  const scoped = p !== 'web' && !!host;
  const query = scoped ? `site:${host} ${q}` : q;
  const domain = host ? host.replace(/^www\./i, '').toLowerCase() : null;
  const engines = [
    { name: 'duckduckgo', url: (x) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(x)}`, parse: parseDdgResults },
    { name: 'bing', url: (x) => `https://www.bing.com/search?q=${encodeURIComponent(x)}&setlang=en`, parse: parseBingResults },
    { name: 'google-news-rss', url: (x) => `https://news.google.com/rss/search?q=${encodeURIComponent(x)}&hl=vi&gl=VN&ceid=VN:vi`, parse: parseGoogleNewsRss },
  ];
  const runParse = async (eng, attempt, fetcher) => {
    let out = eng.parse(await fetcher(eng.url(attempt)), limit);
    if (scoped && domain) out = out.filter((it) => String(it.url).toLowerCase().includes(domain));
    return out;
  };
  let parsed = [];
  let usedEngine = 'web';
  for (const eng of engines) {
    for (const attempt of (scoped ? [query, q] : [q])) {
      try { parsed = await runParse(eng, attempt, searchFetch); } catch (e) { parsed = []; }
      if (!parsed.length) {
        try { parsed = await runParse(eng, attempt, directFetchHtml); } catch (e) { parsed = []; }
      }
      if (parsed.length) break;
    }
    if (parsed.length) { usedEngine = eng.name; break; }
  }
  return {
    engine: usedEngine,
    results: parsed.map((it) => {
      const real = platformOf(it.url) || 'web';
      const onPlatform = domain ? String(it.url).toLowerCase().includes(domain) : false;
      return {
        title: it.title,
        url: it.url,
        platform: (p !== 'web' && (real === p || onPlatform)) ? p : real,
        snippet: it.snippet,
      };
    }),
  };
}

// YouTube search qua worker ytsearch.
async function workerSearch(q, limit) {
  const j = await workerGet(`/search?${workerQ({ q, limit: String(limit) })}`, WORKER_INFO_TIMEOUT_MS);
  const arr = Array.isArray(j.items) ? j.items : [];
  return arr.map((it) => ({
    title: it.title || it.id || 'video',
    url: it.url || (it.id ? `https://www.youtube.com/watch?v=${it.id}` : null),
    platform: 'youtube',
    snippet: it.uploader || undefined,
    uploader: it.uploader || null,
    channel_id: it.channel_id || null,
    uploader_url: it.uploader_url || null,
  })).filter((r) => r.url);
}

// search({q, platform?, limit?}) → { ok, source, query, platform, count, results:[{title,url,platform,snippet?}] }.
async function search(input) {
  const inp = input || {};
  const q = String(inp.q != null ? inp.q : (inp.query != null ? inp.query : '')).trim();
  if (!q) throw new Error('Thiếu q (từ khoá tìm kiếm).');
  const limit = normSearchLimit(inp.limit);
  const platform = String(inp.platform || 'web').toLowerCase();
  let results = [];
  let source = 'web';
  let engine = null;

  if (platform === 'youtube') {
    if (workerEnabled()) {
      try {
        results = await workerSearch(q, limit);
        source = 'ytdlp';
        engine = 'ytdlp';
      } catch (e) {
        console.log(`[scraper] workerSearch thất bại: ${e && e.message ? e.message : 'lỗi'}`);
        results = [];
      }
    }
    if (!results.length) {
      const w = await webSearch(q, limit, 'youtube');
      results = w.results; engine = w.engine; source = 'web';
    }
  } else {
    const w = await webSearch(q, limit, platform);
    results = w.results; engine = w.engine; source = 'web';
  }

  return { ok: true, source, engine, query: q, platform, count: results.length, results };
}

// findChannel({name, platform?}) → { ok, name, platform, count, candidates:[{name,url,platform}] }.
async function findChannel(input) {
  const inp = input || {};
  const name = String(inp.name != null ? inp.name : (inp.q != null ? inp.q : '')).trim();
  if (!name) throw new Error('Thiếu name (tên kênh).');
  const platform = String(inp.platform || '').toLowerCase();
  const limit = normSearchLimit(inp.limit || 10);
  const candidates = [];
  const seen = new Set();
  const push = (c) => {
    if (!c || !c.url || seen.has(c.url)) return;
    seen.add(c.url);
    candidates.push(c);
  };

  // YouTube: dùng worker ytsearch → channel_id/uploader_url từ entries.
  if (platform === 'youtube' && workerEnabled()) {
    try {
      const r = await workerSearch(name, limit);
      for (const it of r) {
        if (it.uploader_url) push({ name: it.uploader || name, url: it.uploader_url, platform: 'youtube' });
        else if (it.channel_id) push({ name: it.uploader || name, url: `https://www.youtube.com/channel/${it.channel_id}`, platform: 'youtube' });
      }
    } catch (e) {
      console.log(`[scraper] findChannel worker thất bại: ${e && e.message ? e.message : 'lỗi'}`);
    }
  }

  // Fallback / platform khác: web search scoped, lọc link kênh/profile khi nhận diện được.
  if (!candidates.length) {
    const host = PLATFORM_SITE[platform];
    const query = host ? `site:${host} ${name}` : name;
    const w = await webSearch(query, limit, platform || 'web');
    for (const it of w.results) {
      let ok = true;
      if (platform === 'tiktok') ok = /tiktok\.com\/@/i.test(it.url);
      else if (platform === 'youtube') ok = /youtube\.com\/(@|channel\/|c\/|user\/)/i.test(it.url);
      else if (platform === 'instagram') ok = /instagram\.com\//i.test(it.url);
      if (ok) push({ name: it.title || name, url: it.url, platform: it.platform, snippet: it.snippet });
    }
  }

  // TikTok: nếu chưa ra ứng viên, thử thêm scope thẳng vào hồ sơ `site:tiktok.com/@ <name>`
  // (một số engine xử lý scope này tốt hơn `site:tiktok.com <name>`).
  if (!candidates.length && platform === 'tiktok') {
    try {
      const w2 = await webSearch(`site:tiktok.com/@ ${name}`, limit, 'web');
      for (const it of w2.results) {
        if (/tiktok\.com\/@/i.test(it.url)) push({ name: it.title || name, url: it.url, platform: 'tiktok', snippet: it.snippet });
      }
    } catch (e) {
      console.log(`[scraper] findChannel tiktok /@ thất bại: ${e && e.message ? e.message : 'lỗi'}`);
    }
  }

  return { ok: true, name, platform: platform || 'web', count: candidates.length, candidates };
}

// ─────────────────────────────────────────────────────────────────────────────
// DIG — đào 1 kênh theo TÊN: tìm ứng viên → xếp hạng → tự crawl kênh khớp nhất
// → tóm tắt chủ đề. ADDITIVE, guarded, không bao giờ crash server.
// ─────────────────────────────────────────────────────────────────────────────

// Chuẩn hoá "handle": bỏ @, bỏ dấu, chỉ giữ chữ+số thường.
function normHandle(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^@+/, '')
    .replace(/[^a-z0-9]/g, '');
}

// Khoảng cách sửa (Levenshtein) — dùng đoán kênh gần đúng (vd "rixi404" cho "rexi").
function editDistance(a, b) {
  const s = String(a || ''), t = String(b || '');
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = new Array(t.length + 1);
  let cur = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[t.length];
}

// Độ "gần" giữa handle kênh và tên tìm (0..1): exact > prefix (phạt độ dài thêm)
// > substring > prefix gần đúng (vd "rixi404" cho "rexi").
function closeness(handle, name) {
  const h = String(handle || ''), n = String(name || '');
  if (!h || !n) return 0;
  if (h === n) return 1;
  if (h.startsWith(n)) {
    const extra = h.length - n.length;
    return Math.max(0.5, 0.85 - Math.min(extra, 6) * 0.05);
  }
  if (h.includes(n)) return 0.5;
  if (n.includes(h) && h.length >= 3) return 0.5;
  let best = 0;
  const probes = [h];
  for (let len = Math.max(3, n.length - 1); len <= n.length + 1; len++) {
    if (len <= h.length) probes.push(h.slice(0, len));
  }
  for (const p of probes) {
    const d = editDistance(p, n);
    const sim = 1 - d / Math.max(p.length, n.length, 1);
    if (sim > best) best = sim;
  }
  return Math.max(0, best);
}

// Parse số kiểu "12.5K" / "1,234" / "1.234.567" → số.
function parseCount(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/\s+/g, '');
  if (!s) return 0;
  s = s.replace(/,/g, '.');
  const parts = s.split('.');
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last.length === 3 && /^\d+$/.test(parts[0])) s = parts.join(''); // 1.234.567 → hàng nghìn
    else s = parts.slice(0, -1).join('') + '.' + last;                    // giữ 1 chữ số thập phân cuối
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function applyCountSuffix(n, suffix) {
  const s = String(suffix || '').toLowerCase();
  if (/^(k|nghìn|nghin|ngàn|ngan)$/.test(s)) return n * 1e3;
  if (/^(m|triệu|trieu)$/.test(s)) return n * 1e6;
  if (/^(b|tỷ|ty)$/.test(s)) return n * 1e9;
  return n;
}

// Trích follower / like / video từ snippet tìm kiếm (VI + EN).
function extractEngagement(text) {
  const s = String(text || '');
  const num = '([\\d][\\d.,]*)';
  const suf = '(k|m|b|nghìn|nghin|ngàn|ngan|triệu|trieu|tỷ|ty)?';
  const scan = (re) => {
    const m = s.match(re);
    if (!m) return 0;
    return Math.round(applyCountSuffix(parseCount(m[1]), m[2]));
  };
  return {
    followers: scan(new RegExp(num + '\\s*' + suf + '\\s*(?:followers?|subscribers?|subs\\b|người theo dõi|nguoi theo doi|người đăng ký|nguoi dang ky)', 'i')),
    likes: scan(new RegExp(num + '\\s*' + suf + '\\s*(?:likes?|lượt thích|luot thich|thích\\b)', 'i')),
    videos: scan(new RegExp(num + '\\s*' + suf + '\\s*(?:videos?|clips?|video\\b)', 'i')),
    following: scan(new RegExp(num + '\\s*' + suf + '\\s*(?:following|đang follow|dang follow)', 'i')),
  };
}

// Rút handle kênh từ URL (tiktok/youtube/instagram).
function handleFromUrl(url) {
  const u = String(url || '');
  let m = u.match(/tiktok\.com\/@([^/?#]+)/i);
  if (m) return normHandle(m[1]);
  m = u.match(/youtube\.com\/@([^/?#]+)/i);
  if (m) return normHandle(m[1]);
  m = u.match(/youtube\.com\/(?:c|user)\/([^/?#]+)/i);
  if (m) return normHandle(m[1]);
  m = u.match(/instagram\.com\/([^/?#]+)/i);
  if (m && !/^(p|reel|reels|tv|explore|stories)$/i.test(m[1])) return normHandle(m[1]);
  return '';
}

// Chuẩn hoá URL ứng viên → URL kênh/profile (bỏ phần /video/… của TikTok).
function candidateProfileUrl(url) {
  const u = String(url || '');
  const t = u.match(/tiktok\.com\/@([^/?#]+)/i);
  if (t) return `https://www.tiktok.com/@${t[1]}`;
  return u;
}

// Xếp hạng ứng viên: (a) độ khớp handle ↔ tên, (b) engagement trong snippet.
function rankCandidates(candidates, name) {
  const n = normHandle(name);
  const scored = (Array.isArray(candidates) ? candidates : []).map((c) => {
    const url = candidateProfileUrl(c.url);
    const handle = handleFromUrl(url) || normHandle(c.name);
    const eng = extractEngagement([c.snippet, c.name].filter(Boolean).join(' · '));
    let score = closeness(handle, n) * 500;
    if (eng.followers) score += Math.log10(eng.followers + 1) * 40;
    if (eng.likes) score += Math.log10(eng.likes + 1) * 25;
    const out = { ...c, url, handle, score: Math.round(score) };
    if (eng.followers) out.followers = eng.followers;
    if (eng.likes) out.likes = eng.likes;
    return out;
  });
  scored.sort((a, b) => b.score - a.score);
  // Bỏ trùng theo URL kênh (giữ bản điểm cao nhất) — vd nhiều video cùng 1 kênh.
  const seen = new Set();
  return scored.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

// Stopwords (đã bỏ dấu) cho việc đếm keyword tần suất.
const DIG_STOPWORDS = new Set((
  'a,an,the,and,or,of,to,in,on,for,with,at,by,from,this,that,these,those,is,are,was,were,be,been,it,its,as,we,you,he,she,they,i,me,my,your,our,their,his,her,not,no,do,does,did,so,if,then,than,too,very,can,will,just,new,more,most,all,any,out,up,down,over,about,into,only,also,how,what,when,where,who,why,but,your,via,get,got,one,two,day,full,part,official,channel,subscribe,sub,like,comment,share,follow,tiktok,youtube,shorts,short,video,clip,clips,live,viral,trend,trending,music,funny' +
  ',va,cua,la,co,cho,voi,trong,tren,mot,nhung,cac,duoc,nguoi,nhu,da,se,khong,cung,nay,do,khi,thi,de,tu,theo,ve,ra,vao,hoac,vi,nen,roi,oi,nha,nhe,day,kia,ay,ta,minh,ban,anh,chi,em,no,ho,chung,toi,dang,bi,o,tai,sang,qua,len,xuong,an,choi,lam,di,xem,xu,huong,moi,ngay,video,clip,kênh,kenh'
).split(',').map((w) => w.trim()).filter(Boolean));

// Đếm tần suất hashtag hoặc keyword trong corpus text.
function topCounts(texts, mode) {
  const joined = (Array.isArray(texts) ? texts : []).join('\n');
  const counts = new Map();
  if (mode === 'hashtag') {
    const re = /#([\p{L}\p{N}_]+)/gu;
    let m;
    while ((m = re.exec(joined)) !== null) {
      const tag = m[1].toLowerCase();
      if (tag.length < 2) continue;
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  } else {
    const cleaned = joined
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/@[\p{L}\p{N}_.]+/gu, ' ')
      .replace(/#[\p{L}\p{N}_]+/gu, ' ')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const toks = cleaned.match(/[a-z0-9]{3,}/g) || [];
    for (const t of toks) {
      if (DIG_STOPWORDS.has(t)) continue;
      if (/^\d+$/.test(t)) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// Tóm tắt chủ đề dựa trên tần suất (khi không có Gemini).
function freqSummary(keywords, hashtags) {
  const kw = (keywords || []).slice(0, 5).map((x) => x[0]);
  const tags = (hashtags || []).slice(0, 5).map((x) => '#' + x[0]);
  const parts = [];
  if (kw.length) parts.push(`Nội dung xoay quanh: ${kw.join(', ')}`);
  if (tags.length) parts.push(`Hashtag nổi bật: ${tags.join(' ')}`);
  if (!parts.length) return 'Chưa đủ dữ liệu để tóm tắt chủ đề kênh.';
  return parts.join('. ') + '.';
}

// (Tuỳ chọn) tóm tắt 1-2 câu bằng Gemini nếu có key — lỗi/không có → null (fallback tần suất).
async function geminiTopicSummary(name, titles) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key || key === 'YOUR_GEMINI_API_KEY_HERE') return null;
  try {
    const prompt = `Dựa trên các tiêu đề video gần đây của kênh "${name}", viết 1-2 câu tiếng Việt ngắn gọn: kênh này làm về chủ đề gì. Chỉ trả về câu tóm tắt, không thêm gì khác.\n\nTiêu đề:\n${(titles || []).slice(0, 12).join('\n')}`;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 120 } }),
        signal: AbortSignal.timeout(12000),
      }
    );
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content
      && j.candidates[0].content.parts && j.candidates[0].content.parts[0]
      && j.candidates[0].content.parts[0].text;
    const out = String(txt || '').trim();
    return out ? out.slice(0, 400) : null;
  } catch (e) {
    return null;
  }
}

// dig({name, platform?='tiktok', limit?}) → tìm kênh → xếp hạng → tự crawl → tóm tắt.
async function dig(input) {
  const inp = input || {};
  const name = String(inp.name != null ? inp.name : (inp.q != null ? inp.q : '')).trim();
  if (!name) throw new Error('Thiếu name (tên kênh).');
  const platform = String(inp.platform || 'tiktok').toLowerCase();
  const maxTry = Math.max(1, Math.min(parseInt(inp.limit, 10) || 3, 5));
  const perChannel = Math.max(6, Math.min(parseInt(inp.per_channel, 10) || 12, 20));

  // 1) Ứng viên kênh.
  let candidates = [];
  try {
    const fc = await findChannel({ name, platform, limit: Math.max(maxTry, 8) });
    candidates = fc.candidates || [];
  } catch (e) {
    console.log(`[scraper] dig findChannel thất bại: ${e && e.message ? e.message : 'lỗi'}`);
  }

  // 2) Xếp hạng.
  const ranked = rankCandidates(candidates, name);

  // 3) Tự crawl lần lượt tới khi có kênh ra video (tối đa maxTry lần thử).
  const tried = [];
  let best = null;
  for (let i = 0; i < ranked.length && tried.length < maxTry; i++) {
    const c = ranked[i];
    const entry = { url: c.url, handle: c.handle || null, name: c.name };
    try {
      const ch = await channel(c.url, { limit: perChannel });
      if (ch && ch.count > 0 && Array.isArray(ch.items) && ch.items.length) {
        entry.ok = true; entry.count = ch.count;
        tried.push(entry);
        best = { candidate: c, channel: ch };
        break;
      }
      entry.ok = false; entry.count = 0; entry.error = '0 video';
      tried.push(entry);
    } catch (e) {
      entry.ok = false; entry.error = e && e.message ? e.message : 'lỗi';
      tried.push(entry);
    }
  }

  // 4) Tóm tắt chủ đề cho kênh tốt nhất.
  let bestOut = null;
  if (best) {
    const ch = best.channel;
    const c = best.candidate;
    const items = ch.items || [];
    const titles = items.map((it) => it.title).filter(Boolean);
    const hashtags = topCounts(titles, 'hashtag').slice(0, 12).map(([tag, count]) => ({ tag, count }));
    const keywords = topCounts(titles, 'keyword').slice(0, 12).map(([word, count]) => ({ word, count }));
    const freq = freqSummary(keywords.map((k) => [k.word, k.count]), hashtags.map((h) => [h.tag, h.count]));
    let topic_summary = freq;
    const g = await geminiTopicSummary(c.name || name, titles);
    if (g) topic_summary = g;
    const views = items.map((it) => it.view_count).filter((v) => v != null);
    const avgView = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : null;
    const dates = items.map((it) => it.published).filter(Boolean).sort();
    bestOut = {
      name: c.name || c.handle || name,
      url: c.url,
      handle: c.handle || null,
      followers: c.followers != null ? c.followers : null,
      likes: c.likes != null ? c.likes : null,
      count: ch.count,
      videos_sample: items.slice(0, 5).map((it) => ({
        title: it.title, url: it.url, published: it.published,
        view_count: it.view_count != null ? it.view_count : null,
      })),
      hashtags,
      keywords,
      topic_summary,
      last_upload: dates.length ? dates[dates.length - 1] : null,
      stats: { avg_view: avgView, last_view: views.length ? views[0] : null, sample: items.length },
    };
  }

  return {
    ok: true,
    name,
    platform,
    best: bestOut,
    candidates: ranked.map((c) => ({
      name: c.name, url: c.url, handle: c.handle || null, score: c.score,
      followers: c.followers != null ? c.followers : null,
      likes: c.likes != null ? c.likes : null,
      snippet: c.snippet,
    })),
    tried,
    note: bestOut ? undefined : 'Không crawl được kênh nào ra video (worker yt-dlp có thể chưa cấu hình hoặc nền tảng chặn).',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
function status() {
  return { ok: true, ytdlp_worker: workerStatus(), web: true, search: true, dig: true, supports: SUPPORTS };
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

// ─────────────────────────────────────────────────────────────────────────────
// KÊNH / PLAYLIST + RAG (nối vào ragService đang có — tiết kiệm token khi chat)
// ─────────────────────────────────────────────────────────────────────────────

// Ngày hôm nay theo giờ VN (UTC+7) → 'YYYY-MM-DD'.
function vnToday() {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  return vn.toISOString().slice(0, 10);
}

// timestamp (unix giây) → 'YYYY-MM-DD' giờ VN.
function tsToVnDate(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000 + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

// 'YYYYMMDD' → 'YYYY-MM-DD' (yt-dlp upload_date).
function ymdToIso(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : (s || null);
}

// Đoán platform từ hostname.
function platformOf(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    const map = [
      ['youtube.com', 'youtube'], ['youtu.be', 'youtube'], ['tiktok.com', 'tiktok'],
      ['instagram.com', 'instagram'], ['twitter.com', 'twitter/x'], ['x.com', 'twitter/x'],
      ['facebook.com', 'facebook'], ['fb.watch', 'facebook'], ['vimeo.com', 'vimeo'],
      ['dailymotion.com', 'dailymotion'], ['twitch.tv', 'twitch'], ['reddit.com', 'reddit'],
      ['soundcloud.com', 'soundcloud'], ['pinterest.', 'pinterest'], ['linkedin.com', 'linkedin'],
      ['bilibili.com', 'bilibili'], ['douyin.com', 'douyin'], ['xiaohongshu.com', 'xiaohongshu'],
      ['weibo.', 'weibo'], ['kick.com', 'kick'], ['rumble.com', 'rumble'],
    ];
    for (const [d, name] of map) if (h === d || h.endsWith('.' + d) || h.includes(d)) return name;
    return h;
  } catch (e) { return null; }
}

// items → text (để nạp RAG): title + kênh + ngày + link + description.
function itemsToText(items) {
  const arr = Array.isArray(items) ? items : [];
  return arr.map((it) => {
    if (it == null) return '';
    if (typeof it === 'string') return it;
    const parts = [];
    if (it.title) parts.push(`# ${it.title}`);
    if (it.uploader) parts.push(`Kênh: ${it.uploader}`);
    if (it.published) parts.push(`Ngày: ${it.published}`);
    if (it.view_count != null) parts.push(`Lượt xem: ${it.view_count}`);
    if (it.url) parts.push(`Link: ${it.url}`);
    if (it.description) parts.push(String(it.description));
    return parts.join('\n');
  }).filter(Boolean).join('\n\n');
}

// channel(): liệt kê video kênh/playlist qua worker /list. Fallback /info (1 mục).
async function channel(rawUrl, opts) {
  const o = opts || {};
  const n = normalizeUrl(rawUrl);
  if (!n.ok) throw new Error(n.error);
  const safe = await assertPublicUrlAsync(n.url);
  if (!safe.ok) throw new Error(safe.reason);
  const limit = Math.max(1, Math.min(parseInt(o.limit, 10) || 20, 100));
  const today = o.today === true || o.today === 'true';

  if (!workerEnabled()) {
    throw new Error('Chưa cấu hình yt-dlp worker (YTDLP_WORKER_URL) — không liệt kê được kênh/playlist.');
  }

  let platform = platformOf(n.url);
  let items = [];
  let listErr = null;
  try {
    const r = await workerList(n.url, limit);
    items = r.items || [];
    platform = r.platform || platform;
  } catch (e) {
    listErr = e && e.message ? e.message : 'worker /list lỗi';
  }

  if (!items.length) {
    try {
      const inf = await workerInfo(n.url);
      items = [{
        id: inf.id || null, title: inf.title || null, url: n.url,
        uploader: inf.uploader || null, duration: inf.duration != null ? inf.duration : null,
        timestamp: null, upload_date: inf.upload_date || null,
        view_count: inf.view_count != null ? inf.view_count : null,
      }];
    } catch (e) {
      if (listErr) throw new Error(`Không liệt kê được kênh/playlist: ${listErr}`);
      throw new Error('Không lấy được danh sách video (site có thể không hỗ trợ flat-playlist).');
    }
  }

  const mapped = items.slice(0, limit).map((it) => ({
    id: it.id || null,
    title: it.title || null,
    url: it.url || null,
    uploader: it.uploader || null,
    published: tsToVnDate(it.timestamp) || ymdToIso(it.upload_date) || null,
    view_count: it.view_count != null ? it.view_count : null,
  }));
  const filtered = today ? mapped.filter((it) => it.published && it.published === vnToday()) : mapped;
  return { ok: true, platform, count: filtered.length, items: filtered, today_filtered: today };
}

// ingest(): chunk text (hoặc items) → nạp vào RAG store đang có (ragService).
async function ingest(input, userId) {
  const rag = require('./ragService');
  const inp = input || {};
  const src = String(inp.source || '').trim() || 'scrape';
  const title = String(inp.title || src).trim().slice(0, 300);
  let text = '';
  if (typeof inp.text === 'string' && inp.text.trim()) text = inp.text;
  else if (Array.isArray(inp.items)) text = itemsToText(inp.items);
  if (!text || text.trim().length < 10) throw new Error('Thiếu nội dung để nạp (text hoặc items).');
  const scope = userId || 'scrape-public';
  const res = await rag.saveTextDocument(scope, title, text, { source: src });
  if (res && res.error) throw new Error(res.error);
  return { ok: true, doc_id: res.ma_tai_lieu, chunks: res.so_chunk, chars: res.so_ky_tu, source: src, title };
}

// ask(): truy vấn RAG store → trả về các chunk liên quan (chỉ feed chunk đó cho model).
async function ask(input, userId) {
  const rag = require('./ragService');
  const inp = input || {};
  const q = String(inp.question || '').trim();
  if (!q) throw new Error('Thiếu question.');
  const src = String(inp.source || '').trim();
  const limit = Math.max(1, Math.min(parseInt(inp.limit, 10) || 5, 20));
  const scope = userId || 'scrape-public';
  const rows = await rag.searchDocuments(scope, q, src ? Math.min(limit * 4, 40) : limit);
  let chunks = (rows || []).map((r) => ({ text: r.noi_dung, score: r.do_tuong_dong, doc: r.ten_file }));
  if (src) {
    const filtered = chunks.filter((c) => String(c.doc || '').toLowerCase().includes(src.toLowerCase()));
    if (filtered.length) chunks = filtered;
  }
  chunks = chunks.slice(0, limit);
  return { ok: true, count: chunks.length, chunks };
}

// pipeline(): crawl (urls/channel) → nạp RAG → trả chunk (hoặc top chunks khi có question).
async function pipeline(input, userId) {
  const inp = input || {};
  const urls = Array.isArray(inp.urls) ? inp.urls.slice(0, 10) : [];
  const question = inp.question ? String(inp.question) : '';
  const ingested = [];

  if (inp.channel) {
    try {
      const ch = await channel(inp.channel, { limit: inp.limit || 20, today: !!inp.today });
      const src = `channel:${platformOf(inp.channel) || 'site'}:${String(inp.channel).slice(0, 60)}`;
      const text = itemsToText(ch.items) || `Kênh ${inp.channel} — ${ch.count} video.`;
      const r = await ingest({ source: src, title: src, text }, userId);
      ingested.push({ type: 'channel', ok: true, count: ch.count, ...r });
    } catch (e) {
      ingested.push({ type: 'channel', ok: false, error: e.message || 'lỗi' });
    }
  }

  for (const u of urls) {
    try {
      const r0 = await info(u);
      const d = r0.data || {};
      const text = [
        d.title && `# ${d.title}`,
        d.uploader && `Kênh: ${d.uploader}`,
        d.description && String(d.description),
        (r0.source === 'web' && d.text) ? String(d.text) : '',
      ].filter(Boolean).join('\n');
      const src = `url:${platformOf(u) || 'web'}:${String(u).slice(0, 60)}`;
      const r = await ingest({ source: src, title: d.title || src, text: text || d.title || u }, userId);
      ingested.push({ type: 'url', ok: true, url: u, ...r });
    } catch (e) {
      ingested.push({ type: 'url', ok: false, url: u, error: e.message || 'lỗi' });
    }
  }

  if (!ingested.length) throw new Error('Thiếu urls hoặc channel để crawl.');
  const out = { ok: true, ingested };
  if (question) {
    const a = await ask({ question, limit: 5 }, userId);
    out.question = question;
    out.chunks = a.chunks;
  }
  return out;
}

module.exports = {
  status,
  info,
  page: pageExtract,
  comments,
  batch,
  download,
  channel,
  ingest,
  ask,
  pipeline,
  search,
  findChannel,
  dig,
  normalizeUrl,
  workerStatus,
  workerEnabled,
  SUPPORTS,
};
