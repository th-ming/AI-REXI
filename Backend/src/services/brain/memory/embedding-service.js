/**
 * AI REXI BRAIN — EMBEDDING SERVICE (Vector Understanding)
 *
 * Chuyển văn bản thành VECTOR (embedding) bằng Gemini `gemini-embedding-001`
 * (dim 3072, miễn phí, chạy bằng key Gemini trong khoa_api).
 * Dùng để "hiểu theo NGHĨA" thay vì chỉ khớp từ khóa — như ChatGPT/Gemini.
 *
 * - getEmbedding(text): trả vector, có cache trong bộ nhớ, fallback null khi lỗi
 * - cosineSimilarity(a, b): độ tương đồng 2 vector (0..1)
 * - Bảng `memory_embedding` lưu vector của từng memory (ma_bo_nho → vector JSON)
 */

const db = require('../../../config/db');
const { decryptKey } = require('../../../utils/cryptoKeys');

const GEMINI_EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 3072;

// Tạo bảng nếu chưa có (an toàn khi server chạy lần đầu)
try {
  db.run(`CREATE TABLE IF NOT EXISTS memory_embedding (
    ma_bo_nho TEXT PRIMARY KEY,
    vector TEXT NOT NULL,
    ngay_tao TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
} catch (e) { console.log('[Embedding] init table error:', e.message); }

// Cache vector theo nội dung (tránh gọi API lặp)
const cache = new Map();
const CACHE_MAX = 500;

// Cache API key Gemini 5 phút (tránh SELECT mỗi lần embed; key xoay thì trễ tối đa 5p)
let _keyCache = { value: null, ts: 0 };
const KEY_TTL_MS = 5 * 60 * 1000;

async function getGeminiKey() {
  if (_keyCache.value && (Date.now() - _keyCache.ts) < KEY_TTL_MS) return _keyCache.value;
  const raw = await new Promise((resolve) => {
    db.get("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'gemini'", [], (err, row) => {
      if (err || !row || !row.gia_tri_khoa) return resolve(null);
      resolve(row.gia_tri_khoa);
    });
  });
  if (!raw) return null;
  let key = null;
  try {
    key = decryptKey(raw).trim() || null;
  } catch (e) {
    console.log('[Embedding] decryptKey error:', e.message);
    key = String(raw).trim() || null;
  }
  if (key) _keyCache = { value: key, ts: Date.now() };
  return key;
}

// POST embed có timeout + retry (lỗi mạng thoáng qua không làm mất vector ngay)
async function postEmbed(clean, key, timeoutMs = 15000) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text: clean }] } }),
      signal: AbortSignal.timeout(timeoutMs)
    }
  );
}

async function getEmbedding(text) {
  const clean = String(text || '').trim().slice(0, 3000);
  if (!clean) return null;
  const cacheKey = clean.length + ':' + clean.slice(0, 80);
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  try {
    const key = await getGeminiKey();
    if (!key) {
      console.log('[Embedding] getEmbedding: vec=null (chua_cai_key_gemini)');
      return null;
    }
    let resp = null;
    let lastErr = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        resp = await postEmbed(clean, key);
        break;
      } catch (e) {
        lastErr = e.message;
        console.log(`[Embedding] getEmbedding: thu ${attempt}/2 loi mang:`, e.message);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (!resp) {
      console.log('[Embedding] getEmbedding: vec=null (fetch_that_bai_2_lan):', lastErr);
      return null;
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.log(`[Embedding] getEmbedding: vec=null (HTTP ${resp.status}):`, String(body).slice(0, 160));
      // Key sai/thu hồi thì xóa cache key để lần sau đọc lại key mới từ DB
      if (resp.status === 400 || resp.status === 401 || resp.status === 403) _keyCache = { value: null, ts: 0 };
      return null;
    }
    const j = await resp.json();
    const v = j.embedding && j.embedding.values;
    if (Array.isArray(v) && v.length >= 64) {
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(cacheKey, v);
      return v;
    }
    console.log('[Embedding] getEmbedding: vec=null (response_thieu_vector, dim=' + (Array.isArray(v) ? v.length : 'none') + ')');
    return null;
  } catch (e) {
    console.log('[Embedding] getEmbedding error:', e.message);
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Lưu/làm mới vector của 1 memory (fire-and-forget — không block luồng chính)
async function saveMemoryEmbedding(maBoNho, content) {
  if (!maBoNho || !content) return;
  try {
    const vec = await getEmbedding(content);
    if (!vec) return;
    await new Promise((resolve) => {
      db.run(
        "INSERT INTO memory_embedding (ma_bo_nho, vector) VALUES (?, ?) ON CONFLICT(ma_bo_nho) DO UPDATE SET vector = excluded.vector, ngay_tao = CURRENT_TIMESTAMP",
        [maBoNho, JSON.stringify(vec)],
        () => resolve()
      );
    });
  } catch (e) { console.log('[Embedding] saveMemoryEmbedding error:', e.message); }
}

// Xóa vector khi xóa memory
function deleteMemoryEmbedding(maBoNho) {
  if (!maBoNho) return;
  db.run("DELETE FROM memory_embedding WHERE ma_bo_nho = ?", [maBoNho], () => {});
}

module.exports = {
  getEmbedding,
  cosineSimilarity,
  saveMemoryEmbedding,
  deleteMemoryEmbedding,
  GEMINI_EMBED_MODEL,
  EMBED_DIM,
};
