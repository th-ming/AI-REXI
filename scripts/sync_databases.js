/**
 * Rexi AI — Database Sync Tool
 * Syncs data between SQLite, SQL Server, and PostgreSQL
 * Usage: node scripts/sync_databases.js --from=sqlite --to=sqlserver
 *        node scripts/sync_databases.js --from=sqlserver --to=postgresql
 *        node scripts/sync_databases.js --all (sync all to all)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const args = {};
process.argv.slice(2).forEach(a => {
  const [k, v] = a.replace('--', '').split('=');
  args[k] = v || true;
});

const TABLES = [
  'nguoi_dung', 'thu_muc_du_an', 'cuoc_hoi_thoai', 'tin_nhan',
  'khoa_api', 'ky_nang', 'hoi_thoai_ky_nang', 'bo_nho_dai_han',
  'danh_gia_cau_tra_loi', 'luot_su_dung_token', 'tai_lieu_dau_ra',
  'tien_trinh_chay_ngam', 'luu_tru_file_code', 'tin_nhan_ghim',
  'cac_buoc_xu_ly'
];

async function getAdapter(type) {
  if (type === 'sqlite') {
    const Database = require('better-sqlite3');
    const db = new Database(require('path').join(__dirname, '..', 'Database', 'tro_ly_ai.db'));
    db.pragma('journal_mode = WAL');
    return {
      type: 'sqlite',
      tables: () => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name),
      columns: (table) => db.prepare(`PRAGMA table_info("${table}")`).all().map(r => r.name),
      query: (sql) => db.prepare(sql).all(),
      run: (sql) => db.prepare(sql).run(),
      close: () => db.close(),
      escape: (v) => v === null ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`
    };
  }
  if (type === 'sqlserver') {
    const sql = require('mssql/msnodesqlv8');
    const host = process.env.SQLSERVER_HOST || '.\\SQLEXPRESS';
    const dbName = process.env.SQLSERVER_DB || 'AI REXI';
    const pool = await sql.connect({
      connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${host};Database={${dbName}};Trusted_Connection=yes;`
    });
    return {
      type: 'sqlserver',
      tables: async () => (await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'")).recordset.map(r => r.TABLE_NAME),
      columns: async (table) => (await pool.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${table}' ORDER BY ORDINAL_POSITION`)).recordset.map(r => r.COLUMN_NAME),
      query: async (sql) => (await pool.request().query(sql)).recordset,
      run: async (sql) => { await pool.request().query(sql); },
      close: () => pool.close(),
      escape: (v) => v === null ? 'NULL' : typeof v === 'number' ? v : `N'${String(v).replace(/'/g, "''")}'`
    };
  }
  if (type === 'postgresql') {
    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'ai_rexi',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    return {
      type: 'postgresql',
      tables: async () => (await pool.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public'")).rows.map(r => r.tablename),
      columns: async (table) => (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${table}' ORDER BY ordinal_position`)).rows.map(r => r.column_name),
      query: async (sql) => (await pool.query(sql)).rows,
      run: async (sql) => { await pool.query(sql); },
      close: () => pool.end(),
      escape: (v) => v === null ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`
    };
  }
  throw new Error('Unknown DB type: ' + type);
}

async function syncTable(from, to, table) {
  console.log(`\n[${table}] Reading from ${from.type}...`);
  try {
    // Check table exists in source
    const srcTables = await from.tables();
    if (!srcTables.includes(table)) { console.log(`[${table}] Not found in source, skipping`); return; }

    const rows = await from.query(`SELECT * FROM "${table}"`);
    if (rows.length === 0) { console.log(`[${table}] No data`); return; }

    // Check table exists in target
    const dstTables = await to.tables();
    if (!dstTables.includes(table)) { console.log(`[${table}] Not found in target, skipping`); return; }

    // Get common columns only
    const srcCols = Object.keys(rows[0]);
    const dstCols = await to.columns(table);
    const commonCols = srcCols.filter(c => dstCols.includes(c)).filter(c => c !== '_sync_at');

    if (commonCols.length === 0) { console.log(`[${table}] No common columns`); return; }

    const colList = commonCols.map(c => `"${c}"`).join(', ');
    const pk = commonCols[0];

    console.log(`[${table}] ${rows.length} rows -> writing to ${to.type} (cols: ${commonCols.join(', ')})...`);

    for (const row of rows) {
      const values = commonCols.map(c => to.escape(row[c])).join(', ');
      try {
        await to.run(`INSERT INTO "${table}" (${colList}) VALUES (${values})`);
      } catch (err) {
        const msg = err.message || '';
        if (msg.includes('UNIQUE') || msg.includes('PRIMARY') || msg.includes('PK') || msg.includes('duplicate') || msg.includes('23505')) {
          // Upsert
          const pkVal = to.escape(row[pk]);
          const sets = commonCols.filter(c => c !== pk).map(c => `"${c}"=${to.escape(row[c])}`).join(', ');
          if (sets) {
            try { await to.run(`UPDATE "${table}" SET ${sets} WHERE "${pk}"=${pkVal}`); }
            catch (e2) { console.log(`  - ${row[pk]}: update failed: ${(e2.message || '').slice(0, 80)}`); }
          }
        } else {
          console.log(`  - ${row[pk]}: ${msg.slice(0, 80)}`);
        }
      }
    }
    console.log(`[${table}] Done`);
  } catch (err) {
    console.log(`[${table}] Error: ${(err.message || '').slice(0, 100)}`);
  }
}

async function main() {
  console.log('=== Rexi AI Database Sync ===\n');

  const fromType = args.from || 'sqlite';
  const toType = args.to || 'sqlserver';

  if (args.all) {
    const types = [];
    if (require('fs').existsSync(require('path').join(__dirname, '..', 'Database', 'tro_ly_ai.db'))) types.push('sqlite');
    if (process.env.SQLSERVER_HOST) types.push('sqlserver');
    if (process.env.PGHOST) types.push('postgresql');
    for (let i = 0; i < types.length; i++) {
      for (let j = i + 1; j < types.length; j++) {
        console.log(`\n========== ${types[i]} -> ${types[j]} ==========`);
        const from = await getAdapter(types[i]);
        const to = await getAdapter(types[j]);
        for (const t of TABLES) await syncTable(from, to, t);
        from.close(); to.close();
      }
    }
  } else {
    console.log(`Syncing: ${fromType} -> ${toType}`);
    const from = await getAdapter(fromType);
    const to = await getAdapter(toType);
    for (const t of TABLES) await syncTable(from, to, t);
    from.close(); to.close();
  }

  console.log('\n=== Sync Complete ===');
}

main().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
