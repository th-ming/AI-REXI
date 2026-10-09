// autoResearch.js — tự động tra cứu web cho chat (zero-config, không cần user bật gì).
//  - Tin nhắn có URL  -> cào nội dung URL (scraper.info) và nhồi vào ngữ cảnh.
//  - Câu hỏi cần thông tin -> search web (scraper.search) lấy top kết quả.
// Trả chuỗi ngắn (<= ~3500 ký tự) để nhồi vào system prompt; có cache TTL ngắn.
const scraper = require('./scraper');

const CACHE = new Map();
const TTL_MS = 10 * 60 * 1000;

function urlsIn(text) {
  const m = String(text || '').match(/https?:\/\/[^\s"'<>)]+/g);
  return m ? [...new Set(m)].slice(0, 3) : [];
}

// Dấu hiệu câu hỏi cần tra cứu (VN + EN).
const INFO_HINT = /(\b(là gì|la gi|nghĩa là|nghia la|ai là|ai la|khi nào|khi nao|ở đâu|o dau|bao nhiêu|bao nhieu|mới nhất|moi nhat|tin tức|tin tuc|hôm nay|hom nay|hiện nay|hien nay|review|đánh giá|danh gia|so sánh|so sanh|thế nào|the nao|cách|cach lam|hướng dẫn|huong dan|tại sao|tai sao|vì sao|vi sao)\b)|(\b(what|who|when|where|why|how|which|news|latest|price|review|compare|meaning)\b)/i;

async function gather(text) {
  const q = String(text || '').trim();
  if (!q || q.length < 6) return '';

  // 1) Có URL -> đọc trực tiếp (luôn làm, không cần hint).
  const urls = urlsIn(q);
  if (urls.length) {
    let out = '';
    for (const u of urls) {
      try {
        const r = await scraper.info(u); // {ok, source, data}
        if (r && r.ok && r.data) {
          const d = r.data;
          const body = String(d.text || d.description || '').replace(/\s+/g, ' ').slice(0, 1400);
          out += `• ${d.title || u}\n${u}\n${body}\n`;
        }
      } catch (e) { /* bỏ qua 1 link lỗi */ }
    }
    if (out) return out.slice(0, 3500);
  }

  // 2) Câu hỏi cần thông tin -> search web.
  if (INFO_HINT.test(q)) {
    const key = q.toLowerCase().slice(0, 140);
    const c = CACHE.get(key);
    if (c && (Date.now() - c.t) < TTL_MS) return c.v;
    let out = '';
    try {
      const r = await scraper.search({ q, platform: 'web', limit: 5 });
      if (r && r.ok && Array.isArray(r.results)) {
        out = r.results.slice(0, 5).map(x => `• ${x.title || ''}\n${x.url || ''}\n${String(x.snippet || '').slice(0, 220)}`).join('\n');
      }
    } catch (e) { /* worker/web có thể tạm chặn -> bỏ qua */ }
    const v = out ? out.slice(0, 3500) : '';
    CACHE.set(key, { t: Date.now(), v });
    return v;
  }

  return '';
}

module.exports = { gather };
