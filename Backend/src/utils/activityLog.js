/**
 * NHẬT KÝ HOẠT ĐỘNG — ghi log hành động người dùng vào bảng nhat_ky
 */
const crypto = require('crypto');
const db = require('../config/db');

// Đảm bảo bảng tồn tại
try {
  db.run('CREATE TABLE IF NOT EXISTS nhat_ky (ma_ky TEXT PRIMARY KEY, ma_nguoi_dung TEXT, hanh_dong TEXT NOT NULL, chi_tiet TEXT, ngay_tao TEXT DEFAULT CURRENT_TIMESTAMP)');
} catch (e) { console.log('[Log] init:', e.message); }

function logActivity(userId, action, detail) {
  try {
    const ma = crypto.randomUUID();
    db.run('INSERT INTO nhat_ky (ma_ky, ma_nguoi_dung, hanh_dong, chi_tiet) VALUES (?, ?, ?, ?)',
      [ma, userId || 'guest', action, String(detail || '').substring(0, 500)]);
  } catch (e) { /* log không bao giờ chặn request */ }
}

module.exports = { logActivity };
