/**
 * audit.middleware.js — Audit trail cho mọi request API.
 *
 * Ghi vào bảng `audit_log`: thời gian, phương thức, đường dẫn, IP,
 * người dùng (nếu có token), mã trạng thái, thời lượng, và body tóm tắt.
 *
 * Thiết kế: fire-and-forget (không block response), bỏ qua các path nhạy cảm
 * (auth, logs) và không ghi password/key trong body.
 */

const db = require('../config/db');
const jwt = require('jsonwebtoken');
const { redactObject } = require('../utils/pii');

// Các path không cần audit (tránh spam + không lộ token trong log)
const SKIP_PATHS = [
  '/api/health',
  '/api/admin/logs',
  '/api/models/stream',
  '/api/services/iptv/proxy',
];

function auditMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    try {
      const path = req.originalUrl || req.url || '';
      if (SKIP_PATHS.some(p => path.startsWith(p))) return;

      // Lấy ma_nguoi_dung từ token nếu có (không throw khi token hết hạn)
      let maNguoiDung = null;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const payload = jwt.decode(authHeader.split(' ')[1]);
          maNguoiDung = payload && (payload.id || payload.ma_nguoi_dung) || null;
        } catch (e) { /* token invalid → bỏ qua */ }
      }

      const taiLieu = JSON.stringify(redactObject(req.body) || {}).substring(0, 2000);

      db.run(
        `INSERT INTO audit_log (phuong_thuc, duong_dan, dia_chi_ip, ma_nguoi_dung, ma_trang_thai, thoi_luong_ms, tai_lieu)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.method, path.substring(0, 500), req.ip || req.socket?.remoteAddress || null, maNguoiDung,
         res.statusCode, Date.now() - start, taiLieu],
        () => {}
      );
    } catch (e) {
      console.error('[audit] Ghi log thất bại:', e.message);
    }
  });

  next();
}

module.exports = { auditMiddleware };
