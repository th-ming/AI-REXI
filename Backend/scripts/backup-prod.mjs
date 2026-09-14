// scripts/backup-prod.mjs — Tải bản dump SQLite từ prod REXI (PG->export) về Database/backups/,
// verify bằng node:sqlite, xoay vòng giữ 8 bản mới nhất.
// Chong plaintext: tai ADMIN_EMAIL + ADMIN_PASSWORD tu env (khong hardcode).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.REXI_BASE || 'https://ai-rexi-backend.onrender.com').replace(/\/$/, '');
const EMAIL = process.env.ADMIN_EMAIL || process.env.REXI_ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD || process.env.REXI_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('Thieu env ADMIN_EMAIL/ADMIN_PASSWORD'); process.exit(2); }
const OUT_DIR = path.join(__dirname, '..', '..', 'Database', 'backups');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function wake() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(30000) });
      if (r.ok) { const j = await r.json().catch(() => ({})); if (j.db === 'connected' || j.status === 'ok' || j.db_type) return r.status; }
    } catch (_) {}
    await sleep(4000);
  }
  throw new Error('Backend khong wake duoc trong ~2 phut');
}
async function login() {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: EMAIL, password: PASSWORD }), signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!j.token) throw new Error ('login fail: ' + JSON.stringify(j).slice(0, 160));
  return j.token;
}
async function main() {
  await wake();
  const tok = await login();
  const r = await fetch(BASE + '/api/admin/export-db', { headers: { Authorization: 'Bearer ' + tok }, signal: AbortSignal.timeout(240000) });
  if (!r.ok) throw new Error('export-db HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200));
  const buf = Buffer.from(await r.arrayBuffer());
  const magic = buf.slice(0, 15).toString();
  if (!magic.startsWith('SQLite format 3')) throw new Error('Khong phai file SQLite (magic="' + magic + '")');
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const file = path.join(OUT_DIR, 'rexi_backup_' + stamp + '.db');
  fs.writeFileSync(file, buf);
  let report = { file: path.basename(file), bytes: buf.length };
  try {
    const sq = new DatabaseSync(file, { readOnly: true });
    const tbls = sq.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r2 => r2.name);
    const counts = {};
    for (const t of ['nguoi_dung', 'ai_models', 'khoa_api', 'cuoc_hoi_thoai', 'tin_nhan', 'iptv_channels', 'bo_nho_dai_han']) {
      if (tbls.includes(t)) counts[t] = sq.prepare('SELECT COUNT(*) c FROM "' + t + '"').get().c;
    }
    sq.close();
    report.tables = tbls.length;
    report.counts = counts;
  } catch (e) { report.verify_error = String(e.message || e); }
  const cur = fs.readdirSync(OUT_DIR).filter(f => /^rexi_backup_.*\.db$/.test(f)).sort().reverse();
  for (const old of cur.slice(8)) { try { fs.unlinkSync(path.join(OUT_DIR, old)); } catch (_) {} }
  console.log('BACKUP_OK ' + JSON.stringify(report));
}
main().catch(e => { console.error('BACKUP_FAIL ' + String(e.message || e)); process.exit(1); });
