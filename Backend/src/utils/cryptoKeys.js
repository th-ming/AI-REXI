/**
 * cryptoKeys.js — Mã hóa API key khi lưu vào DB (encrypt-at-rest)
 *
 * Dùng AES-256-GCM. Master key lấy từ env ENC_KEY (32 bytes hex).
 * Nếu chưa có ENC_KEY → dùng hàm băm của JWT_SECRET (fallback, chỉ cho dev).
 * Quy ước lưu: `enc:v1:<iv hex>:<tag hex>:<ciphertext hex>`
 */
const crypto = require('crypto');

function getMasterKey() {
  if (process.env.ENC_KEY) {
    const buf = Buffer.from(process.env.ENC_KEY, 'hex');
    if (buf.length === 32) return buf;
    if (process.env.NODE_ENV === 'production') {
      console.error('[cryptoKeys] ENC_KEY không hợp lệ (phải là 32 bytes hex) — fallback từ JWT_SECRET.');
    }
  }
  // Fallback: băm JWT_SECRET (ổn định giữa restart — tương thích render.yaml chưa set ENC_KEY)
  // PROD KHUYÊN DÙNG: set ENC_KEY riêng (32 bytes hex) để tách biệt khoá mã hoá với JWT.
  if (!process.env.ENC_KEY && process.env.NODE_ENV === 'production') {
    console.warn('[cryptoKeys] CẢNH BÁO: prod chưa cấu hình ENC_KEY — đang dùng khoá dẫn xuất từ JWT_SECRET. Nên set ENC_KEY (32 bytes hex) trong biến môi trường.');
  }
  const base = process.env.JWT_SECRET || 'ai-rexi-dev-fallback-key';
  return crypto.createHash('sha256').update(base).digest();
}

const PREFIX = 'enc:v1:';

/**
 * Mã hóa một chuỗi (API key). Trả về chuỗi có prefix `enc:v1:`.
 */
function encryptKey(plaintext) {
  if (plaintext == null) return plaintext;
  if (typeof plaintext !== 'string') plaintext = String(plaintext);
  if (plaintext.startsWith(PREFIX)) return plaintext; // đã mã hóa
  const iv = crypto.randomBytes(12);
  const key = getMasterKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}

/**
 * Giải mã chuỗi đã mã hóa (có prefix `enc:v1:`). Chuỗi không có prefix → trả nguyên (tương thích key cũ).
 */
function decryptKey(payload) {
  if (payload == null) return payload;
  if (typeof payload !== 'string') payload = String(payload);
  if (!payload.startsWith(PREFIX)) return payload; // key cũ chưa mã hóa
  const parts = payload.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return payload;
  const [ivHex, tagHex, dataHex] = parts;
  const key = getMasterKey();
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
  } catch (e) {
    console.error('[cryptoKeys] decrypt failed:', e.message);
    return payload;
  }
}

module.exports = { encryptKey, decryptKey, getMasterKey };
