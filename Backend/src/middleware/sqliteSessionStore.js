/**
 * sqliteSessionStore.js — Session store bền vững trên DB (không dùng MemoryStore).
 *
 * Vấn đề MemoryStore:
 *  - Session mất khi restart server (user phải đăng nhập lại, guest quota reset)
 *  - Rò rỉ bộ nhớ trên server chạy lâu (Render free tier)
 *
 * Giải pháp: lưu session vào bảng `sessions_store` (SQLite local / PostgreSQL trên Render)
 * thông qua db adapter hiện có — KHÔNG cần cài thêm package (connect-sqlite3...).
 *
 * Kế thừa express-session.Store (EventEmitter) — đúng interface get/set/destroy/touch.
 */
const session = require('express-session');
const db = require('../config/db');

// Kế thừa session.Store (không phải EventEmitter trần!) — Store cung cấp
// createSession/regenerate cần khi express-session inflate session từ cookie.
// (Audit-2: trước đây extends EventEmitter → inflate cookie cũ crash
//  "store.createSession is not a function".)
class SqliteSessionStore extends session.Store {
  constructor() {
    super();
  }

  get(sid, cb) {
    db.get('SELECT du_lieu, expires_at FROM sessions_store WHERE sid = ?', [sid], (err, row) => {
      // DB lỗi → coi như chưa có session (giữ app sống thay vì 500)
      if (err) return cb && cb(null, null);
      if (!row) return cb && cb(null, null);
      try {
        // Không phục vụ session đã hết hạn (trước đây chờ tới lượt dọn hourly mới mất)
        if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
          db.run('DELETE FROM sessions_store WHERE sid = ?', [sid], () => {});
          return cb && cb(null, null);
        }
        cb(null, JSON.parse(row.du_lieu));
      } catch (e) { cb(null, null); }
    });
  }

  set(sid, sess, cb) {
    const expires = sess && sess.cookie && sess.cookie.expires
      ? new Date(sess.cookie.expires).toISOString()
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.run(
      `INSERT INTO sessions_store (sid, du_lieu, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET du_lieu = excluded.du_lieu, expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP`,
      [sid, JSON.stringify(sess), expires],
      // DB lỗi → log + coi như xong (giữ request sống, session sẽ tạo lại)
      (err) => { if (err) console.warn('[SessionStore] set lỗi:', err.message); cb && cb(null); }
    );
  }

  destroy(sid, cb) {
    db.run('DELETE FROM sessions_store WHERE sid = ?', [sid], (err) => {
      if (err) console.warn('[SessionStore] destroy lỗi:', err.message);
      cb && cb(null);
    });
  }

  touch(sid, sess, cb) {
    const expires = sess && sess.cookie && sess.cookie.expires
      ? new Date(sess.cookie.expires).toISOString()
      : null;
    if (expires) {
      db.run('UPDATE sessions_store SET expires_at = ? WHERE sid = ?', [expires, sid], (err) => {
        if (err) console.warn('[SessionStore] touch lỗi:', err.message);
        cb && cb(null);
      });
    } else if (cb) cb(null);
  }

  length(cb) {
    db.get('SELECT COUNT(*) AS c FROM sessions_store', [], (err, row) => cb && cb(err, row ? row.c : 0));
  }

  clear(cb) {
    db.run('DELETE FROM sessions_store', [], (err) => cb && cb(err || null));
  }
}

// Dọn session hết hạn định kỳ (tránh DB phình to)
setInterval(() => {
  db.run('DELETE FROM sessions_store WHERE expires_at < ?', [new Date().toISOString()], () => {});
}, 60 * 60 * 1000); // mỗi giờ

module.exports = { SqliteSessionStore };
