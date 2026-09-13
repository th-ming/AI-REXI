/**
 * AI REXI Multi-Database Adapter
 * Supports: sqlite | sqlserver | postgresql
 * Mode: single | parallel
 */
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '..', '..', '.env');
if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });

const DB_TYPE = (process.env.DB_TYPE || 'sqlite').toLowerCase();
const DB_MODE = (process.env.DB_MODE || 'single').toLowerCase();
const log = (msg) => console.log('[DB] ' + msg);

// ─── SQLite ────────────────────────────────────────────────
class SQLiteAdapter {
  constructor() {
    this.type = 'sqlite';
    this.ready = false;
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.join(__dirname, '..', '..', '..', 'Database', 'tro_ly_ai.db');
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) log('SQLite error: ' + err.message);
      else { log('SQLite connected: ' + dbPath); this.ready = true; this._init(); }
    });
  }
  _init() { this.db.run("PRAGMA foreign_keys = ON;"); }
  // P2-20(9): hết 5s mà DB chưa ready → gọi cb với Error RÕ RÀNG (trước đây gọi cb()
  // mù → query chạy trên connection chưa mở, treo/lỗi khó hiểu).
  _wait(cb) {
    if (this.ready) return cb(null);
    let done = false;
    const check = setInterval(() => {
      if (this.ready) { done = true; clearInterval(check); clearTimeout(timer); cb(null); }
    }, 50);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      clearInterval(check);
      cb(new Error('SQLite chưa sẵn sàng sau 5s (file DB bị khoá hoặc không mở được)'));
    }, 5000);
  }
  get(sql, params = [], cb) { this._wait((waitErr) => { if (waitErr) return cb(waitErr); this.db.get(sql, params, cb); }); }
  all(sql, params = [], cb) { this._wait((waitErr) => { if (waitErr) return cb(waitErr); this.db.all(sql, params, cb); }); }
  run(sql, params = [], cb) {
    if (typeof params === 'function') { cb = params; params = []; }
    this._wait((waitErr) => { if (waitErr) { if (cb) cb.call(this, waitErr); return; } this.db.run(sql, params, function(err) { if (cb) cb.call(this, err); }); });
  }
  exec(sql, cb) { this._wait((waitErr) => { if (waitErr) { if (cb) cb(waitErr); return; } this.db.exec(sql, (err) => { if (cb) cb(err); }); }); }
  /**
   * Thực thi công việc trong 1 transaction (BEGIN/COMMIT/ROLLBACK).
   * work(tx) nhận tx = { run, get, all } promise-based, tất cả chạy trên cùng 1 connection
   * → crash giữa chừng sẽ rollback tự động (không để DB nửa vời).
   */
  async withTransaction(work) {
    await new Promise((resolve, reject) => {
      const start = () => this.db.run('BEGIN', (err) => err ? reject(err) : resolve());
      if (this.ready) return start();
      const check = setInterval(() => { if (this.ready) { clearInterval(check); start(); } }, 50);
      setTimeout(() => { clearInterval(check); start(); }, 5000);
    });
    const tx = {
      run: (sql, params = []) => new Promise((res, rej) => this.db.run(sql, params, function(err) { err ? rej(err) : res(this && this.changes != null ? this.changes : 0); })),
      get: (sql, params = []) => new Promise((res, rej) => this.db.get(sql, params, (err, row) => err ? rej(err) : res(row))),
      all: (sql, params = []) => new Promise((res, rej) => this.db.all(sql, params, (err, rows) => err ? rej(err) : res(rows || []))),
    };
    try {
      await work(tx);
      await new Promise((resolve, reject) => this.db.run('COMMIT', (err) => err ? reject(err) : resolve()));
    } catch (e) {
      await new Promise((r) => this.db.run('ROLLBACK', () => r()));
      throw e;
    }
  }
  close(cb) { if (this.db) this.db.close(cb); }
}

// ─── SQL Server ────────────────────────────────────────────
class SQLServerAdapter {
  constructor() {
    this.type = 'sqlserver';
    this.pool = null;
    this.queue = [];
    this.mssql = null;
    this._connect();
  }
  async _connect() {
    const authType = (process.env.SQLSERVER_AUTH || 'windows').toLowerCase();
    try {
    if (authType === 'sa') {
      const sql = require('mssql');
      this.mssql = sql;
      this.pool = await sql.connect({
          server: process.env.SQLSERVER_HOST || 'localhost',
          port: parseInt(process.env.SQLSERVER_PORT) || 1433,
          database: process.env.SQLSERVER_DB || 'AI REXI',
          user: process.env.SQLSERVER_USER || 'sa',
          password: process.env.SQLSERVER_PASS || '',
          options: { encrypt: false, trustServerCertificate: true }
        });
        log('SQL Server connected (SA)');
      } else {
        const sql = require('mssql/msnodesqlv8');
        this.mssql = sql;
        const hosts = [
          process.env.SQLSERVER_HOST || '.\\SQLEXPRESS',
          '(localdb)\\MSSQLLocalDB',
          'localhost\\SQLEXPRESS',
          'localhost'
        ];
        const dbNames = [process.env.SQLSERVER_DB || 'AI REXI', 'AI_REXI'];
        let connected = false;
        let lastErr = null;

        for (const h of hosts) {
          for (const d of dbNames) {
            try {
              this.pool = await sql.connect({
                connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${h};Database={${d}};Trusted_Connection=yes;`
              });
              log(`SQL Server connected successfully to [${h}] database [${d}]`);
              connected = true;
              break;
            } catch (e) {
              lastErr = e;
            }
          }
          if (connected) break;
        }

        if (!connected) {
          throw lastErr || new Error('Không thể kết nối tới các instance SQL Server local.');
        }
      }
    } catch (err) {
      log('SQL Server connection failed: ' + err.message + ' — Auto-switching to SQLite adapter');
      this.fallback = new SQLiteAdapter();
      this.ready = true;
      this._drain();
      return;
    }
    this._drain();
  }
  _transform(sql, params) {
    let idx = 0;
    let q = sql.replace(/\?/g, () => `@rxi_p${idx++}`);
    // Convert SQLite LIMIT OFFSET syntax to MS SQL Server dialect
    if (q.toUpperCase().includes('LIMIT')) {
      if (/LIMIT\s+@rxi_p\d+\s+OFFSET\s+@rxi_p\d+/i.test(q)) {
        q = q.replace(/LIMIT\s+(@rxi_p\d+)\s+OFFSET\s+(@rxi_p\d+)/i, 'OFFSET $2 ROWS FETCH NEXT $1 ROWS ONLY');
      } else if (/LIMIT\s+@rxi_p\d+/i.test(q)) {
        q = q.replace(/LIMIT\s+(@rxi_p\d+)/i, 'OFFSET 0 ROWS FETCH NEXT $1 ROWS ONLY');
      } else if (/LIMIT\s+(\d+)\s+OFFSET\s+(\d+)/i.test(q)) {
        q = q.replace(/LIMIT\s+(\d+)\s+OFFSET\s+(\d+)/i, 'OFFSET $2 ROWS FETCH NEXT $1 ROWS ONLY');
      } else if (/LIMIT\s+(\d+)/i.test(q)) {
        q = q.replace(/LIMIT\s+(\d+)/i, 'OFFSET 0 ROWS FETCH NEXT $1 ROWS ONLY');
      }
    }
    const req = this.pool.request();
    if (Array.isArray(params)) {
      const mssql = this.mssql || require('mssql');
      params.forEach((p, i) => req.input(`rxi_p${i}`, p === null ? mssql.NVarChar : typeof p === 'number' ? (Number.isInteger(p) ? mssql.Int : mssql.Float) : mssql.NVarChar, p));
    }
    return { req, sql: q };
  }
  _exec(sql, params, cb, mode) {
    if (this.fallback) {
      if (mode === 'get') this.fallback.get(sql, params, cb);
      else if (mode === 'all') this.fallback.all(sql, params, cb);
      else this.fallback.run(sql, params, cb);
      return;
    }
    if (!this.pool) { this.queue.push([sql, params, cb, mode]); return; }
    const { req, sql: q } = this._transform(sql, params);
    req.query(q).then(r => {
      if (mode === 'get') cb(null, r.recordset[0] || null);
      else if (mode === 'all') cb(null, r.recordset || []);
      else if (cb) cb.call({ changes: r.rowsAffected ? r.rowsAffected.reduce((a, b) => a + b, 0) : 0 }, null);
    }).catch(cb || (() => {}));
  }
  _drain() { this.queue.forEach(([s, p, cb, m]) => this._exec(s, p, cb, m)); this.queue = []; }
  get(sql, params = [], cb) { this._exec(sql, params, cb, 'get'); }
  all(sql, params = [], cb) { this._exec(sql, params, cb, 'all'); }
  run(sql, params = [], cb) {
    if (typeof params === 'function') { cb = params; params = []; }
    this._exec(sql, params, cb, 'run');
  }
  close() { if (this.pool) this.pool.close(); }
}

// ─── PostgreSQL ────────────────────────────────────────────
class PostgreSQLAdapter {
  constructor() {
    this.type = 'postgresql';
    this.pool = null;
    this.queue = [];
    this._connect();
  }
  async _connect(retries = 3) {
    let lastErr = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const { Pool } = require('pg');
        // Đóng pool cũ (nếu retry) trước khi tạo mới — tránh rò rỉ connection
        if (this.pool) { try { await this.pool.end(); } catch (_) {} this.pool = null; }
        this.pool = new Pool({
          host: process.env.PGHOST || 'localhost',
          port: parseInt(process.env.PGPORT) || 5432,
          database: process.env.PGDATABASE || 'ai_rexi',
          user: process.env.PGUSER || 'postgres',
          password: process.env.PGPASSWORD || '',
          ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
        });
        await this.pool.query('SELECT 1');
        log('PostgreSQL connected');
        this._drain(null);
        return;
      } catch (err) {
        lastErr = err;
        log(`PostgreSQL connect attempt ${attempt}/${retries} failed: ${err.message}`);
        try { if (this.pool) await this.pool.end(); } catch (_) {}
        this.pool = null;
        if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1))); // 1s, 2s
      }
    }
    // P1-08: sau 3 lần fail — đóng pool, fallback SQLite + drain queue với lỗi rõ (không để treo)
    log('PostgreSQL failed after ' + retries + ' attempts: ' + (lastErr && lastErr.message) + ' — fallback SQLiteAdapter');
    try { if (this.pool) await this.pool.end(); } catch (_) {}
    this.pool = null;
    try {
      this.fallback = new SQLiteAdapter();
    } catch (e) {
      log('PostgreSQL fallback SQLite failed: ' + e.message);
    }
    this._drain(lastErr || new Error('PostgreSQL not connected'));
  }
  _exec(sql, params, cb, mode) {
    // P1-08: đã fallback SQLite → ủy thác (SQLiteAdapter tự chờ ready)
    if (this.fallback) {
      if (mode === 'get') this.fallback.get(sql, params, cb);
      else if (mode === 'all') this.fallback.all(sql, params, cb);
      else if (mode === 'exec') this.fallback.exec(sql, cb);
      else this.fallback.run(sql, params, cb);
      return;
    }
    if (!this.pool) { this.queue.push([sql, params, cb, mode]); return; }
    // mode 'exec': chạy trực tiếp (simple protocol — hỗ trợ multi-statement, không thay ?)
    if (mode === 'exec') {
      this.pool.query(sql).then(() => { if (cb) cb(null); }).catch(cb || (() => {}));
      return;
    }
    let idx = 0;
    const text = sql.replace(/\?/g, () => `$${++idx}`);
    const values = Array.isArray(params) ? params : [];
    this.pool.query(text, values).then(r => {
      if (mode === 'get') cb(null, r.rows[0] || null);
      else if (mode === 'all') cb(null, r.rows || []);
      else if (cb) cb.call({ changes: r.rowCount || 0 }, null);
    }).catch(cb || (() => {}));
  }
  _drain(drainErr) {
    const q = this.queue;
    this.queue = [];
    // P1-08: có lỗi (hết retry, không fallback được) → trả lỗi cho từng callback đang chờ,
    // không để request treo vĩnh viễn. Bình thường (connect OK / đã fallback) → chạy lại qua _exec.
    if (drainErr && !this.fallback) {
      q.forEach(([s, p, cb]) => { try { if (cb) cb(drainErr); } catch (_) {} });
      return;
    }
    q.forEach(([s, p, cb, m]) => this._exec(s, p, cb, m));
  }
  get(sql, params = [], cb) { this._exec(sql, params, cb, 'get'); }
  all(sql, params = [], cb) { this._exec(sql, params, cb, 'all'); }
  run(sql, params = [], cb) {
    if (typeof params === 'function') { cb = params; params = []; }
    this._exec(sql, params, cb, 'run');
  }
  exec(sql, cb) {
    if (this.fallback) { this.fallback.exec(sql, cb); return; }
    if (!this.pool) { this.queue.push([sql, [], cb, 'exec']); return; }
    this.pool.query(sql).then(() => { if (cb) cb(null); }).catch(cb || (() => {}));
  }
  /**
   * Transaction trên 1 connection cố định (pool.connect) — BEGIN/COMMIT/ROLLBACK
   * không bị rò rỉ qua các connection khác của pool.
   */
  async withTransaction(work) {
    // P1-08: đã fallback SQLite → ủy thác transaction cho SQLiteAdapter
    if (this.fallback) return this.fallback.withTransaction(work);
    let client;
    try {
      if (!this.pool) throw new Error('PostgreSQL not connected');
      client = await this.pool.connect();
      const q = (text, values) => {
        let i = 0;
        return client.query(text.replace(/\?/g, () => `$${++i}`), values || []);
      };
      const tx = {
        run: async (sql, params = []) => (await q(sql, params)).rowCount || 0,
        get: async (sql, params = []) => (await q(sql, params)).rows[0] || null,
        all: async (sql, params = []) => (await q(sql, params)).rows || [],
      };
      await client.query('BEGIN');
      await work(tx);
      await client.query('COMMIT');
      client.release();
      client = null;
    } catch (e) {
      if (client) { try { await client.query('ROLLBACK'); } catch (_) {} try { client.release(); } catch (_) {} }
      throw e;
    }
  }
  close() { if (this.pool) this.pool.end(); }
}

// ─── Parallel ──────────────────────────────────────────────
class ParallelAdapter {
  constructor(adapters) {
    this.adapters = adapters.filter(a => a.pool || a.ready || a.type === 'sqlite');
    this.type = 'parallel';
    log('Parallel mode: ' + this.adapters.map(a => a.type).join(' + '));
  }
  get(sql, params = [], cb) { this.adapters[0].get(sql, params, cb); }
  all(sql, params = [], cb) { this.adapters[0].all(sql, params, cb); }
  run(sql, params = [], cb) {
    let n = 0, err = null;
    const ctx = { changes: 0 };
    const done = () => { n++; if (n >= this.adapters.length && cb) cb.call(ctx, err); };
    this.adapters.forEach(a => a.run(sql, params, function(e) { if (e) err = e; else ctx.changes += this.changes || 0; done(); }));
  }
  exec(sql, cb) { this.adapters[0].exec(sql, cb); }
  close() { this.adapters.forEach(a => a.close()); }
}

// ─── Factory (sync) ────────────────────────────────────────
function createDatabase() {
  if (DB_MODE === 'parallel') {
    const list = [new SQLiteAdapter(), new SQLServerAdapter()];
    try { list.push(new PostgreSQLAdapter()); } catch (e) {}
    return new ParallelAdapter(list);
  }
  if (DB_TYPE === 'sqlserver') {
    const a = new SQLServerAdapter();
    return a;
  }
  if (DB_TYPE === 'postgresql') {
    try { return new PostgreSQLAdapter(); } catch (e) {}
    log('PostgreSQL unavailable, using SQLite');
  }
  return new SQLiteAdapter();
}

module.exports = createDatabase();
