// media.routes.js — tạo ảnh / đọc text (TTS) qua provider OpenAI-compatible.
// Model non-chat (modality=image|tts|stt) do scanner đăng ký từ catalog; đây là
// endpoint thực thi thật. Provider nào không hỗ trợ /images|/audio sẽ trả lỗi rõ.
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth.middleware');
const { decryptKey } = require('../utils/cryptoKeys');
const { PROVIDER_ENDPOINTS } = require('../model-scanner.scheduler');

const allQ = (sql, params = []) => new Promise((resolve, reject) =>
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));

// prefix "provider/model" (vd unoserver/dreamshaper-xl) hoặc model trần + ?provider=
function splitModel(raw, providerHint) {
  const s = String(raw || '').trim();
  const slash = s.indexOf('/');
  if (s.includes(':free') && slash > 0) { // vd meta/llama... giữ nguyên, provider từ hint
    if (providerHint) return { provider: providerHint, model: s };
  }
  if (providerHint) return { provider: providerHint, model: s };
  if (slash > 0 && PROVIDER_ENDPOINTS[s.slice(0, slash).toLowerCase()]) {
    return { provider: s.slice(0, slash).toLowerCase(), model: s.slice(slash + 1) };
  }
  return { provider: null, model: s };
}

async function getApiKey(provider) {
  const rows = await allQ("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = ? AND gia_tri_khoa IS NOT NULL AND TRIM(gia_tri_khoa) <> '' LIMIT 1", [provider.toLowerCase()]);
  if (!rows.length) return null;
  try { return decryptKey(rows[0].gia_tri_khoa).trim() || null; } catch { return rows[0].gia_tri_khoa; }
}

async function baseUrlFor(provider) {
  const ep = PROVIDER_ENDPOINTS[provider];
  if (ep && ep.endpoint) return ep.endpoint.replace(/\/models\/?$/, '');
  const rows = await allQ('SELECT base_url FROM ai_providers WHERE LOWER(ma_nha_cung_cap) = ? LIMIT 1', [provider.toLowerCase()]);
  if (rows[0] && rows[0].base_url) return rows[0].base_url.replace(/\/$/, '') + (rows[0].base_url.endsWith('/v1') ? '' : '/v1');
  throw new Error(`Provider ${provider} không có base URL`);
}

async function callUpstream(url, key, body, timeoutMs = 120000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* ảnh to vẫn JSON hợp lệ */ }
  if (!res.ok) {
    const msg = (json && (json.error?.message || json.error?.msg || json.message || json.detail)) || text.slice(0, 300);
    const err = new Error(msg); err.status = res.status; err.bodyText = text; throw err;
  }
  if (!json) { const err = new Error('Upstream trả dữ liệu không hợp lệ'); err.status = 502; throw err; }
  return json;
}

// ─── POST /api/media/image — tạo ảnh ────────────────────────────
// N7: response_format 'url' → URL upstream hết hạn nhanh, history lưu URL là chết ảnh
// → ưu tiên b64_json (nhúng data-URL luôn); provider từ chối b64 → retry 'url'
router.post('/image', authMiddleware, async (req, res) => {
  try {
    const { prompt, model, provider, size, n } = req.body || {};
    if (!String(prompt || '').trim()) return res.status(400).json({ success: false, error: 'Thiếu prompt' });
    const { provider: pKey, model: modelId } = splitModel(model, (provider || '').toLowerCase() || null);
    if (!pKey || !modelId) return res.status(400).json({ success: false, error: 'Chọn model tạo ảnh trước (provider/model)' });
    const key = await getApiKey(pKey) || process.env[`${pKey.toUpperCase()}_API_KEY`] || null;
    if (!key && PROVIDER_ENDPOINTS[pKey]?.auth !== 'none') return res.status(400).json({ success: false, error: `Provider ${pKey} chưa có API key` });
    const base = await baseUrlFor(pKey);
    const bodyFor = (fmt) => ({
      model: modelId, prompt, n: Math.min(parseInt(n) > 0 ? parseInt(n) : 1, 4), size: size || '1024x1024', response_format: fmt,
    });
    let json;
    try {
      json = await callUpstream(`${base}/images/generations`, key, bodyFor('b64_json'));
    } catch (b64Err) {
      if (b64Err && b64Err.status === 400) {
        json = await callUpstream(`${base}/images/generations`, key, bodyFor('url'));
      } else { throw b64Err; }
    }
    const items = (json.data || []).map(d => ({ url: d.url || null, b64: d.b64_json ? `data:image/png;base64,${d.b64_json}` : null })).filter(d => d.url || d.b64);
    if (!items.length) return res.status(502).json({ success: false, error: 'Upstream không trả ảnh nào', raw: JSON.stringify(json).slice(0, 400) });
    res.json({ success: true, provider: pKey, model: modelId, images: items, revised_prompt: json.data?.[0]?.revised_prompt || null });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

// ─── POST /api/media/speech — text-to-speech ────────────────────
router.post('/speech', authMiddleware, async (req, res) => {
  try {
    const { text, model, voice, provider } = req.body || {};
    if (!String(text || '').trim()) return res.status(400).json({ success: false, error: 'Thiếu text' });
    const { provider: pKey, model: modelId } = splitModel(model, (provider || '').toLowerCase() || null);
    if (!pKey || !modelId) return res.status(400).json({ success: false, error: 'Chọn model TTS trước (provider/model)' });
    const textTrim = String(text);
    // N7: không cắt text im lặng — báo rõ khi vượt giới hạn upstream (4000 ký tự)
    if (textTrim.length > 4000) {
      return res.status(400).json({ success: false, error: `Text quá dài: ${textTrim.length} ký tự (giới hạn upstream 4000). Hãy tách ngắn lại hoặc rút gọn.` });
    }
    const key = await getApiKey(pKey);
    if (!key && PROVIDER_ENDPOINTS[pKey]?.auth !== 'none') return res.status(400).json({ success: false, error: `Provider ${pKey} chưa có API key` });
    const base = await baseUrlFor(pKey);
    const upstream = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, input: textTrim, voice: voice || 'alloy', response_format: 'mp3' }),
      signal: AbortSignal.timeout(90000),
    });
    if (!upstream.ok) {
      const t = await upstream.text();
      return res.status(upstream.status).json({ success: false, error: t.slice(0, 300) });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (!buf.length) return res.status(502).json({ success: false, error: 'Upstream trả audio rỗng' });
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    res.send(buf);
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message || String(e) });
  }
});

module.exports = router;
