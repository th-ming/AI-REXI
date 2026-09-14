/**
 * readOnlySqlite — mở file SQLite chỉ-đọc để đọc dữ liệu (dùng cho import-sqlite).
 * Ưu tiên `node:sqlite` builtin (Node >= 22.5, không cần native build) —
 * trên Render linux sqlite3 npm có thể fail GLIBC (binary compiled glibc mới hơn).
 * API tối giản: { all(sql, params) -> Promise<rows[]>, columnsOf?..., close() }
 */
function openReadOnlySqlite(filePath) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const ds = new DatabaseSync(filePath, { readOnly: true });
    return {
      driver: 'node:sqlite',
      all(sql, params = []) {
        return new Promise((resolve, reject) => {
          try {
            const stmt = ds.prepare(sql);
            resolve(stmt.all(...params));
          } catch (e) { reject(e); }
        });
      },
      close() { try { ds.close(); } catch (_) {} },
    };
  } catch (e) {
    const sqlite3 = require('sqlite3');
    const src = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY);
    return {
      driver: 'sqlite3',
      openErr: e.message,
      all(sql, params = []) {
        return new Promise((resolve, reject) => {
          src.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
        });
      },
      close() { try { src.close(); } catch (_) {} },
    };
  }
}

module.exports = { openReadOnlySqlite };
