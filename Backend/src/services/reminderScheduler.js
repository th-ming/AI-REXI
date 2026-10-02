/**
 * NHẮC VIỆC THÔNG MINH — scheduler tạo thông báo khi tới giờ nhắc.
 * Khi tới giờ nhắc → tạo thông báo trong bảng thong_bao (app hiện badge đỏ).
 *
 * 2/10/2026 (tối ưu quota Neon): trước đây poll DB mỗi 30s → Neon không bao giờ
 * scale-to-zero (tốn ~180 CU-h/tháng, sát hạn free 191.9). Nay dùng ADAPTIVE:
 *  - không có nhắc nào sắp tới → nghỉ tối đa 10 phút (Neon ngủ, tiết kiệm quota)
 *  - có nhắc sắp tới → dậy đúng lúc (tối thiểu 30s) để nhắc kịp
 * An toàn: mọi lỗi DB đều bắt, không làm chết scheduler/server.
 */
const crypto = require('crypto');
const db = require('../config/db');

// Đảm bảo bảng tồn tại
try {
  db.run('CREATE TABLE IF NOT EXISTS lich_nhac (ma_nhac TEXT PRIMARY KEY, ma_nguoi_dung TEXT NOT NULL, noi_dung TEXT NOT NULL, thoi_gian TEXT NOT NULL, da_nhac INTEGER DEFAULT 0, ngay_tao TEXT DEFAULT CURRENT_TIMESTAMP)');
  db.run('CREATE TABLE IF NOT EXISTS thong_bao (ma_tb TEXT PRIMARY KEY, ma_nguoi_dung TEXT NOT NULL, noi_dung TEXT NOT NULL, da_doc INTEGER DEFAULT 0, ngay_tao TEXT DEFAULT CURRENT_TIMESTAMP)');
} catch (e) { console.log('[Reminder] init:', e.message); }

const NO_REMINDER_DELAY_MS = 10 * 60 * 1000; // nghỉ tối đa 10' → Neon scale-to-zero
const MIN_DELAY_MS = 30 * 1000;              // luôn chờ tối thiểu 30s (tránh vòng lặp nóng)
const ERROR_DELAY_MS = 60 * 1000;

function dbAll(sql, params = []) {
  return new Promise((resolve) => db.all(sql, params, (err, rows) => resolve(err ? [] : (rows || []))));
}
function dbRun(sql, params = []) {
  return new Promise((resolve) => db.run(sql, params, () => resolve()));
}

function startReminderScheduler() {
  let timer = null;

  async function sweep() {
    let nextDelay = NO_REMINDER_DELAY_MS;
    try {
      // 1) Xử lý các nhắc đã tới hạn
      const nowIso = new Date().toISOString();
      const due = await dbAll(
        "SELECT ma_nhac, ma_nguoi_dung, noi_dung FROM lich_nhac WHERE da_nhac = 0 AND thoi_gian <= ?",
        [nowIso]
      );
      for (const row of due) {
        try {
          const ma = crypto.randomUUID();
          await dbRun('INSERT INTO thong_bao (ma_tb, ma_nguoi_dung, noi_dung) VALUES (?, ?, ?)',
            [ma, row.ma_nguoi_dung, '⏰ Nhắc việc: ' + row.noi_dung]);
          await dbRun('UPDATE lich_nhac SET da_nhac = 1 WHERE ma_nhac = ?', [row.ma_nhac]);
          console.log(`[Reminder] Nhắc ${row.ma_nguoi_dung}: ${row.noi_dung}`);
        } catch (e) { /* tiếp tục nhắc khác */ }
      }

      // 2) Hẹn lần chạy kế: có nhắc sắp tới → dậy đúng lúc; không → nghỉ tối đa 10'
      const nxt = await dbAll("SELECT MIN(thoi_gian) AS next FROM lich_nhac WHERE da_nhac = 0");
      const nextIso = nxt && nxt[0] && nxt[0].next;
      if (nextIso) {
        const nextMs = new Date(nextIso).getTime();
        if (!isNaN(nextMs)) {
          const diff = nextMs - Date.now();
          if (diff > 0 && diff + 1000 < nextDelay) nextDelay = diff + 1000;
        }
      }
    } catch (e) {
      nextDelay = ERROR_DELAY_MS;
    }
    timer = setTimeout(sweep, Math.max(MIN_DELAY_MS, nextDelay));
    if (timer.unref) timer.unref();
  }

  sweep();
}

module.exports = { startReminderScheduler };
