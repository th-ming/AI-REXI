/**
 * NHẮC VIỆC THÔNG MINH — scheduler quét mỗi 30 giây
 * Khi tới giờ nhắc → tạo thông báo trong bảng thong_bao (app hiện badge đỏ).
 */
const crypto = require('crypto');
const db = require('../config/db');

// Đảm bảo bảng tồn tại
try {
  db.run('CREATE TABLE IF NOT EXISTS lich_nhac (ma_nhac TEXT PRIMARY KEY, ma_nguoi_dung TEXT NOT NULL, noi_dung TEXT NOT NULL, thoi_gian TEXT NOT NULL, da_nhac INTEGER DEFAULT 0, ngay_tao TEXT DEFAULT CURRENT_TIMESTAMP)');
  db.run('CREATE TABLE IF NOT EXISTS thong_bao (ma_tb TEXT PRIMARY KEY, ma_nguoi_dung TEXT NOT NULL, noi_dung TEXT NOT NULL, da_doc INTEGER DEFAULT 0, ngay_tao TEXT DEFAULT CURRENT_TIMESTAMP)');
} catch (e) { console.log('[Reminder] init:', e.message); }

function startReminderScheduler() {
  setInterval(() => {
    try {
      const nowIso = new Date().toISOString();
      db.all("SELECT ma_nhac, ma_nguoi_dung, noi_dung FROM lich_nhac WHERE da_nhac = 0 AND thoi_gian <= ?", [nowIso], (err, rows) => {
        if (err || !rows || !rows.length) return;
        for (const row of rows) {
          try {
            const ma = crypto.randomUUID();
            db.run('INSERT INTO thong_bao (ma_tb, ma_nguoi_dung, noi_dung) VALUES (?, ?, ?)',
              [ma, row.ma_nguoi_dung, '⏰ Nhắc việc: ' + row.noi_dung]);
            db.run('UPDATE lich_nhac SET da_nhac = 1 WHERE ma_nhac = ?', [row.ma_nhac]);
            console.log(`[Reminder] Nhắc ${row.ma_nguoi_dung}: ${row.noi_dung}`);
          } catch (e) { /* tiếp tục nhắc khác */ }
        }
      });
    } catch (e) { /* scheduler không được chết */ }
  }, 30000).unref();
}

module.exports = { startReminderScheduler };
