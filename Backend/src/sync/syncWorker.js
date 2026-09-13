/**
 * SYNC WORKER 3-WAY
 * Poll _sync_queue, đồng bộ thay đổi sang SQL Server + PostgreSQL
 * P1-fix(audit): dùng db adapter chung (sqlite/PG) — trước đây require('sqlite3') raw
 * → chết trên Render (PostgreSQL). Worker chỉ chạy khi DB chính là SQLite (đúng bản chất
 * "poll queue từ SQLite đẩy sang 2 DB khác"); PG-primary không cần sync chính nó.
 */
const db = require('../config/db');

// Whitelist các bảng được phép sync — chống SQL injection qua table_name
const VALID_TABLES = new Set([
  'nguoi_dung',
  'cuoc_hoi_thoai',
  'tin_nhan',
  'khoa_api',
  'ky_nang',
  'bo_nho_dai_han',
  'ai_providers',
  'ai_models',
  'thu_muc_du_an',
  'luu_tru_file_code',
  'tai_lieu_dau_ra',
  'cac_buoc_xu_ly',
  'luot_su_dung_token',
  'tien_trinh_chay_ngam',
  'danh_gia_cau_tra_loi',
  'hoi_thoai_ky_nang',
  'model_scan_cache',
  'provider_scan_log',
  'iptv_scan_log',
  'iptv_channels',
  'iptv_notifications',
  'repo_summaries',
  'saved_repos',
  'star_snapshots',
  'starred_repos',
  'trending_cache',
  'trending_notifications',
  'app_settings',
  '_sync_log',
  '_sync_queue',
  'context_sessions',
  'sessions_store',
]);

function isValidTable(table) {
  return VALID_TABLES.has(table);
}

let mssqlPool = null;
let pgPool = null;
let mssqlReady = false;
let pgReady = false;

async function initConnections() {
  const DB_MODE = (process.env.DB_MODE || 'single').toLowerCase();
  const hasMssql = process.env.SQLSERVER_HOST || (DB_MODE === 'parallel');
  const hasPg = process.env.PGHOST || (DB_MODE === 'parallel');

  if (hasMssql) {
    try {
      const authType = (process.env.SQLSERVER_AUTH || 'windows').toLowerCase();
      const config = authType === 'sa' ? {
        server: process.env.SQLSERVER_HOST || 'localhost',
        port: parseInt(process.env.SQLSERVER_PORT) || 1433,
        database: process.env.SQLSERVER_DB || 'AI REXI',
        user: process.env.SQLSERVER_USER || 'sa',
        password: process.env.SQLSERVER_PASS || '',
        options: { encrypt: false, trustServerCertificate: true }
      } : {
        connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${process.env.SQLSERVER_HOST || '.\\SQLEXPRESS'};Database={${process.env.SQLSERVER_DB || 'AI REXI'}};Trusted_Connection=yes;`
      };
      const sqlMod = authType === 'sa' ? require('mssql') : require('mssql/msnodesqlv8');
      mssqlPool = await sqlMod.connect(config);
      mssqlReady = true;
      console.log('[SyncWorker] SQL Server connected');
    } catch (e) { console.log('[SyncWorker] SQL Server unavailable:', e.message); }
  }

  if (hasPg) {
    try {
      const { Pool } = require('pg');
      pgPool = new Pool({
        host: process.env.PGHOST || 'localhost', port: parseInt(process.env.PGPORT) || 5432,
        database: process.env.PGDATABASE || 'ai_rexi', user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || '',
        ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
      });
      pgReady = true;
      console.log('[SyncWorker] PostgreSQL connected');
    } catch (e) { console.log('[SyncWorker] PostgreSQL unavailable:', e.message); }
  }

  if (!mssqlReady && !pgReady) {
    console.log('[SyncWorker] Standby mode (SQLite-only). Set DB_MODE=parallel or SQLSERVER_HOST/PGHOST env to enable sync.');
  }
}

async function syncToSqlServer(table, operation, rowId, rowData) {
  if (!mssqlReady || !mssqlPool) return { skipped: true };
  if (!isValidTable(table)) return { success: false, error: `Invalid table: ${table}` };
  const data = JSON.parse(rowData || '{}');
  try {
    if (operation === 'DELETE') {
      const idCol = Object.keys(data)[0] || 'id';
      await mssqlPool.request().input('rid', data[idCol] || rowId).query(`DELETE FROM ${table} WHERE ${idCol} = @rid`);
    } else {
      const keys = Object.keys(data);
      const req = mssqlPool.request();
      keys.forEach((k, i) => req.input(`p${i}`, data[k]));
      const cols = keys.join(', ');
      const params = keys.map((k, i) => `@p${i}`).join(', ');
      await req.query(`MERGE ${table} AS target USING (SELECT ${params}) AS source (${cols}) ON target.${keys[0]} = source.${keys[0]} WHEN MATCHED THEN UPDATE SET ${keys.map((k,i) => `target.${k}=source.${k}`).join(', ')} WHEN NOT MATCHED THEN INSERT (${cols}) VALUES (${params});`);
    }
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
}

async function syncToPostgres(table, operation, rowId, rowData) {
  if (!pgReady || !pgPool) return { skipped: true };
  if (!isValidTable(table)) return { success: false, error: `Invalid table: ${table}` };
  const data = JSON.parse(rowData || '{}');
  try {
    if (operation === 'DELETE') {
      const idCol = Object.keys(data)[0] || 'id';
      await pgPool.query(`DELETE FROM ${table} WHERE ${idCol} = $1`, [data[idCol] || rowId]);
    } else {
      const keys = Object.keys(data);
      const cols = keys.join(', ');
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const updateSet = keys.map(k => `${k} = EXCLUDED.${k}`).join(', ');
      await pgPool.query(`INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT (${keys[0]}) DO UPDATE SET ${updateSet}`, keys.map(k => data[k]));
    }
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
}

function logSync(table, operation, rowId, targetDb, status, error) {
  db.run("INSERT INTO _sync_log (table_name, operation, row_id, target_db, status, error) VALUES (?, ?, ?, ?, ?, ?)", [table, operation, rowId, targetDb, status, error || null]);
}

// Adapter dạng promise cho các query trong worker
const allQ = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
const runQ = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));

async function processQueue() {
  // DB chính là PostgreSQL (Render) → không có queue SQLite để poll, bỏ qua.
  if (db.type !== 'sqlite') return;
  let rows;
  try { rows = await allQ("SELECT * FROM _sync_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 50", []); }
  catch (err) { console.error('[SyncWorker] Queue read error:', err.message); return; }
  if (!rows || rows.length === 0) return;
  for (const job of rows) {
    const { id, table_name, operation, row_id, row_data } = job;
    const mssqlResult = await syncToSqlServer(table_name, operation, row_id, row_data);
    if (!mssqlResult.skipped) logSync(table_name, operation, row_id, 'sqlserver', mssqlResult.success ? 'success' : 'error', mssqlResult.error);
    const pgResult = await syncToPostgres(table_name, operation, row_id, row_data);
    if (!pgResult.skipped) logSync(table_name, operation, row_id, 'postgresql', pgResult.success ? 'success' : 'error', pgResult.error);
    const hasError = (!mssqlResult.skipped && !mssqlResult.success) || (!pgResult.skipped && !pgResult.success);
    try {
      await runQ("UPDATE _sync_queue SET status = ?, error = ?, retry_count = retry_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [hasError ? 'error' : 'synced', hasError ? (mssqlResult.error || pgResult.error) : null, id]);
    } catch (e) { console.error('[SyncWorker] Queue update error:', e.message); }
  }
}

let intervalHandle = null;
function startWorker(intervalMs = 2000) {
  // Worker này chỉ có nghĩa khi DB chính là SQLite (local). PG-primary bỏ qua.
  if (db.type !== 'sqlite') {
    console.log('[SyncWorker] Skipped — DB chính không phải SQLite.');
    return Promise.resolve();
  }
  return initConnections().then(() => {
    console.log(`[SyncWorker] Started. Polling every ${intervalMs}ms.`);
    intervalHandle = setInterval(processQueue, intervalMs);
  }).catch(err => { console.error('[SyncWorker] Failed to start:', err.message); setTimeout(() => startWorker(intervalMs), 10000); });
}
function stopWorker() { if (intervalHandle) clearInterval(intervalHandle); if (mssqlPool) mssqlPool.close(); if (pgPool) pgPool.end(); console.log('[SyncWorker] Stopped.'); }

module.exports = { startWorker, stopWorker, processQueue };
