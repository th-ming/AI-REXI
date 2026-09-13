/**
 * Admin IPTV Monitor Routes
 *
 * GET  /api/admin/iptv/status       - Trạng thái scan mới nhất
 * GET  /api/admin/iptv/stats        - Thống kê tổng hợp (theo quốc gia, danh mục)
 * GET  /api/admin/iptv/channels     - Danh sách kênh (filter: country, status, search, page)
 * GET  /api/admin/iptv/countries    - Danh sách quốc gia có kênh + flag + số lượng
 * GET  /api/admin/iptv/scan-history - Lịch sử các lần scan
 * GET  /api/admin/iptv/changes      - Kênh mới/mất giữa 2 lần scan gần nhất
 * POST /api/admin/iptv/scan-now     - Kích hoạt scan thủ công
 *
 * FIX PROD: dùng adapter db.js (SQLite local / PostgreSQL trên Render) thay vì
 * better-sqlite3 file cứng — trước đây trên Render đọc file DB riêng rỗng, IPTV
 * monitor không thấy dữ liệu của DB chính.
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { authMiddleware, adminMiddleware } = require('../middleware/auth.middleware');
const db = require('../config/db');

// FIX SECURITY/SQL: escape LIKE wildcard chars
function escapeLike(str) {
  return String(str || '').replace(/[\\%_]/g, (m) => '\\' + m);
}

const dbNow = () => (db.type === 'sqlite' ? "datetime('now')" : 'NOW()');

// Promise helpers cho adapter (callback-based)
const runQ = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this && this.changes != null ? this.changes : 0); }));
const getQ = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const allQ = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));

// Các bảng IPTV được tạo bởi src/init-db.js khi server khởi động — không tạo lại ở đây.
function ensureSchema() { return true; }

// Kiểm tra bảng tồn tại (chạy được cả SQLite lẫn PostgreSQL)
async function tableExists(name) {
  try { await getQ(`SELECT 1 FROM ${name} LIMIT 1`); return true; } catch (e) { return false; }
}

const NO_DATA = { success: true, no_data: true, message: 'Chưa có dữ liệu scan. Hãy bấm nút "Quét kênh" để bắt đầu lần đầu tiên.' };

function getFlag(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0)));
}

// /import-sqlite: BỎ QUA gate toàn router — route tự có importBootstrapGate (empty-DB bootstrap) rồi mới tới auth.
router.use((req, res, next) => {
  if (req.path === '/import-sqlite') return next();
  authMiddleware(req, res, () => adminMiddleware(req, res, next));
});

// ─── Trạng thái scan ─────────────────────────────────────────
router.get('/status', async (req, res) => {
  if (!(await tableExists('iptv_channels'))) return res.json({ success: true, status: 'no_data', lastScan: null, online: 0, total: 0 });

  const lastScan = await getQ("SELECT * FROM iptv_scan_log WHERE status='done' ORDER BY id DESC LIMIT 1").catch(() => null);
  const totalOnline = await getQ("SELECT COUNT(*) as cnt FROM iptv_channels WHERE status='online' AND last_checked IS NOT NULL").catch(() => ({ cnt: 0 }));
  const totalAll = await getQ("SELECT COUNT(*) as cnt FROM iptv_channels WHERE last_checked IS NOT NULL").catch(() => ({ cnt: 0 }));
  const running = await getQ("SELECT * FROM iptv_scan_log WHERE status='running' ORDER BY id DESC LIMIT 1").catch(() => null);

  res.json({
    success: true,
    last_scan: lastScan || null,
    is_running: !!running,
    running_since: running?.started_at || null,
    total_online: totalOnline?.cnt || 0,
    total_channels: totalAll?.cnt || 0,
  });
});

// ─── Thống kê ────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  if (!(await tableExists('iptv_channels'))) return res.json(NO_DATA);

  const totalOnline = (await getQ("SELECT COUNT(*) as cnt FROM iptv_channels WHERE status='online' AND last_checked IS NOT NULL").catch(() => ({ cnt: 0 })))?.cnt || 0;
  const totalAll = (await getQ("SELECT COUNT(*) as cnt FROM iptv_channels WHERE last_checked IS NOT NULL").catch(() => ({ cnt: 0 })))?.cnt || 0;
  const countriesScanned = (await getQ("SELECT COUNT(DISTINCT country) as cnt FROM iptv_channels WHERE last_checked IS NOT NULL").catch(() => ({ cnt: 0 })))?.cnt || 0;

  const byCountry = await allQ(`
    SELECT country, MIN(country_name) as name,
      COUNT(*) as total,
      SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) as online,
      SUM(CASE WHEN status='offline' THEN 1 ELSE 0 END) as offline,
      ROUND(AVG(CASE WHEN latency_ms > 0 THEN CAST(latency_ms AS REAL) ELSE NULL END)) as avg_latency
    FROM iptv_channels WHERE last_checked IS NOT NULL
    GROUP BY country ORDER BY total DESC
  `).catch(() => []);

  const byGroup = await allQ(`
    SELECT group_name, COUNT(*) as total,
      SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) as online
    FROM iptv_channels WHERE last_checked IS NOT NULL
    GROUP BY group_name ORDER BY total DESC
  `).catch(() => []);

  res.json({
    success: true,
    summary: {
      total_online: totalOnline,
      total_all: totalAll,
      countries_scanned: countriesScanned,
      online_pct: totalAll > 0 ? ((totalOnline / totalAll) * 100).toFixed(1) : '0',
    },
    by_country: byCountry,
    by_group: byGroup,
  });
});

// ─── Danh sách kênh (phân trang + filter) ────────────────────
router.get('/channels', async (req, res) => {
  if (!(await tableExists('iptv_channels'))) return res.json(NO_DATA);

  const { country, status, category, search, page = 1, limit = 100 } = req.query;
  const pg = Math.max(1, parseInt(page));
  const lm = Math.min(500, Math.max(10, parseInt(limit) || 100));
  const offset = (pg - 1) * lm;

  const clauses = ['last_checked IS NOT NULL'];
  const params = [];

  if (country) { clauses.push('country = ?'); params.push(country.toUpperCase()); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (category) { clauses.push('group_name = ?'); params.push(category); }
  if (search) { clauses.push("channel_name LIKE ? ESCAPE '\\'"); params.push(`%${escapeLike(search)}%`); }

  const whereClause = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const total = (await getQ(`SELECT COUNT(*) as cnt FROM iptv_channels ${whereClause}`, params).catch(() => ({ cnt: 0 })))?.cnt || 0;

  const rows = await allQ(`
    SELECT * FROM iptv_channels ${whereClause}
    ORDER BY status DESC, latency_ms ASC LIMIT ? OFFSET ?
  `, [...params, lm, offset]).catch(() => []);

  res.json({ success: true, total, page: pg, limit: lm, channels: rows });
});

// ─── Danh sách quốc gia (đầy đủ 250 nước + số lượng kênh) ────
router.get('/countries', async (req, res) => {
  if (!(await tableExists('iptv_channels'))) {
    // Fallback: trả về 250 quốc gia từ file data nếu DB chưa có
    try {
      const dataFile = path.join(__dirname, '..', '..', '..', 'Frontend', 'src', 'data', 'iptvCountries.js');
      const raw = fs.readFileSync(dataFile, 'utf-8');
      const match = raw.match(/export const ALL_IPTV_COUNTRIES = (\[[\s\S]*?\])/);
      if (match) {
        const countries = JSON.parse(match[1].replace(/'/g, '"'));
        return res.json({
          success: true,
          count: countries.length,
          note: '(chưa có dữ liệu scan)',
          countries: countries.map(c => ({
            code: c.code,
            name: c.name,
            flag: getFlag(c.code),
            total: 0,
            online: 0,
            offline: 0,
            avg_latency: 0,
          })).sort((a, b) => a.name.localeCompare(b.name)),
        });
      }
    } catch (e) { /* fallback */ }
    return res.json({ success: false, error: 'No data' });
  }

  const dbCountries = await allQ(`
    SELECT country, MIN(country_name) as name,
      COUNT(*) as total,
      SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) as online,
      SUM(CASE WHEN status='offline' THEN 1 ELSE 0 END) as offline,
      ROUND(AVG(CASE WHEN latency_ms > 0 THEN CAST(latency_ms AS REAL) ELSE NULL END)) as avg_latency
    FROM iptv_channels WHERE last_checked IS NOT NULL
    GROUP BY country ORDER BY total DESC
  `).catch(() => []);

  // Lấy danh sách đầy đủ 250 quốc gia từ frontend data
  let allCountries = [];
  try {
    const dataFile = path.join(__dirname, '..', '..', '..', 'Frontend', 'src', 'data', 'iptvCountries.js');
    const raw = fs.readFileSync(dataFile, 'utf-8');
    const match = raw.match(/export const ALL_IPTV_COUNTRIES = (\[[\s\S]*?\])/);
    if (match) {
      allCountries = JSON.parse(match[1].replace(/'/g, '"'));
    }
  } catch (e) {}

  // Merge: tất cả quốc gia, có data xanh k có = 0
  const merged = allCountries.map(ac => {
    const found = dbCountries.find(dc => dc.country === ac.code);
    return {
      code: ac.code,
      name: ac.name,
      flag: getFlag(ac.code),
      total: found?.total || 0,
      online: found?.online || 0,
      offline: found?.offline || 0,
      avg_latency: found?.avg_latency || 0,
    };
  });

  merged.sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));

  res.json({ success: true, count: merged.length, countries: merged });
});

// ─── Lịch sử scan ───────────────────────────────────────────────
router.get('/scan-history', async (req, res) => {
  if (!(await tableExists('iptv_scan_log'))) return res.json(NO_DATA);

  const history = await allQ(`
    SELECT id, started_at, finished_at, status, total_channels, online_channels, offline_channels, new_channels, lost_channels
    FROM iptv_scan_log ORDER BY id DESC LIMIT 20
  `).catch(() => []);

  res.json({ success: true, history });
});

// ─── Kênh mới / mất ──────────────────────────────────────────
router.get('/changes', async (req, res) => {
  if (!(await tableExists('iptv_channels'))) return res.json(NO_DATA);

  const lastScan = await getQ("SELECT id FROM iptv_scan_log WHERE status='done' ORDER BY id DESC LIMIT 1").catch(() => null);
  const prevScan = lastScan ? await getQ("SELECT id FROM iptv_scan_log WHERE status='done' AND id < ? ORDER BY id DESC LIMIT 1", [lastScan.id]).catch(() => null) : null;

  if (!lastScan || !prevScan) {
    return res.json({ success: true, need_more_scans: true, message: 'Cần ít nhất 2 lần scan để so sánh' });
  }

  const nowOnline = await allQ("SELECT url, channel_name, country, group_name FROM iptv_channels WHERE status='online' AND scan_id = ?", [lastScan.id]).catch(() => []);
  const prevOnline = await allQ("SELECT url, channel_name, country, group_name FROM iptv_channels WHERE status='online' AND scan_id = ?", [prevScan.id]).catch(() => []);

  const nowSet = new Set(nowOnline.map(r => r.url));
  const prevSet = new Set(prevOnline.map(r => r.url));

  const newChans = nowOnline.filter(r => !prevSet.has(r.url));
  const lostChans = prevOnline.filter(r => !nowSet.has(r.url));

  res.json({
    success: true,
    scan_now: lastScan.id,
    scan_prev: prevScan.id,
    new_count: newChans.length,
    lost_count: lostChans.length,
    new_channels: newChans.slice(0, 200),
    lost_channels: lostChans.slice(0, 200),
  });
});

// ─── Thêm kênh mới ──────────────────────────────────────────
router.post('/channels', async (req, res) => {
  if (!(await tableExists('iptv_channels'))) return res.json(NO_DATA);

  const { channel_name, name, url, logo, group_name, group, country, country_name, status, latency_ms } = req.body;
  const chName = (channel_name || name || '').trim();
  const grp = (group_name || group || '').trim();
  const ctry = (country || '').toUpperCase().trim();
  const st = ['online', 'offline', 'unknown'].includes(status) ? status : 'unknown';

  if (!chName || !url) return res.json({ success: false, error: 'Cần nhập tên kênh và URL' });
  if (!/^https?:\/\//.test(url)) return res.json({ success: false, error: 'URL phải bắt đầu bằng http:// hoặc https://' });

  const dup = await getQ('SELECT id FROM iptv_channels WHERE url = ?', [url]).catch(() => null);
  if (dup) return res.json({ success: false, error: 'Kênh với URL này đã tồn tại' });

  let id = 0;
  if (db.type === 'postgresql') {
    const r = await getQ(`INSERT INTO iptv_channels (country, country_name, group_name, channel_name, url, logo, status, latency_ms, last_checked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${dbNow()}) RETURNING id`, [ctry || 'XX', country_name || '', grp, chName, url, logo || '', st, parseInt(latency_ms) || 0]);
    id = r.id;
  } else {
    await runQ(`INSERT INTO iptv_channels (country, country_name, group_name, channel_name, url, logo, status, latency_ms, last_checked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${dbNow()})`, [ctry || 'XX', country_name || '', grp, chName, url, logo || '', st, parseInt(latency_ms) || 0]);
    const r = await getQ('SELECT last_insert_rowid() AS id');
    id = r.id;
  }

  res.json({ success: true, id, message: 'Đã thêm kênh thành công' });
});

// ─── Cập nhật kênh ──────────────────────────────────────────
router.put('/channels/:id', async (req, res) => {
  if (!(await tableExists('iptv_channels'))) return res.json(NO_DATA);

  const id = parseInt(req.params.id);
  if (!id) return res.json({ success: false, error: 'ID không hợp lệ' });

  const row = await getQ('SELECT * FROM iptv_channels WHERE id = ?', [id]).catch(() => null);
  if (!row) return res.json({ success: false, error: 'Không tìm thấy kênh' });

  const { channel_name, name, url, logo, group_name, group, country, country_name, status, latency_ms } = req.body;
  const chName = (channel_name || name || row.channel_name || '').trim();
  const grp = (group_name || group || row.group_name || '').trim();
  const ctry = (country !== undefined && country !== null && country !== '') ? String(country).toUpperCase() : row.country;
  const cName = country_name !== undefined ? country_name : row.country_name;
  const st = ['online', 'offline', 'unknown'].includes(status) ? status : row.status;
  const newUrl = (url || row.url || '').trim();
  const lat = latency_ms !== undefined ? (parseInt(latency_ms) || 0) : row.latency_ms;

  if (!chName || !newUrl) return res.json({ success: false, error: 'Cần nhập tên kênh và URL' });

  if (newUrl !== row.url) {
    const dup = await getQ('SELECT id FROM iptv_channels WHERE url = ? AND id != ?', [newUrl, id]).catch(() => null);
    if (dup) return res.json({ success: false, error: 'Kênh với URL này đã tồn tại' });
  }

  await runQ(`
    UPDATE iptv_channels SET channel_name=?, url=?, logo=?, group_name=?, country=?, country_name=?, status=?, latency_ms=?, last_checked=${dbNow()} WHERE id=?
  `, [chName, newUrl, logo !== undefined ? logo : row.logo, grp, ctry, cName || '', st, lat, id]);

  res.json({ success: true, message: 'Đã cập nhật kênh' });
});

// ─── Xóa kênh ──────────────────────────────────────────────
router.delete('/channels/:id', async (req, res) => {
  if (!(await tableExists('iptv_channels'))) return res.json(NO_DATA);

  const id = parseInt(req.params.id);
  if (!id) return res.json({ success: false, error: 'ID không hợp lệ' });

  const row = await getQ('SELECT id FROM iptv_channels WHERE id = ?', [id]).catch(() => null);
  if (!row) return res.json({ success: false, error: 'Không tìm thấy kênh' });

  await runQ('DELETE FROM iptv_channels WHERE id = ?', [id]);
  res.json({ success: true, message: 'Đã xóa kênh' });
});

// ─── Export M3U / JSON / CSV ────────────────────────────────
router.get('/channels/export/:format', async (req, res) => {
  if (!(await tableExists('iptv_channels'))) return res.json(NO_DATA);

  const { format } = req.params;
  const { country, status, search, category } = req.query;
  const clauses = ['last_checked IS NOT NULL'];
  const params = [];
  if (country) { clauses.push('country = ?'); params.push(country.toUpperCase()); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (category) { clauses.push('group_name = ?'); params.push(category); }
  if (search) { clauses.push("channel_name LIKE ? ESCAPE '\\'"); params.push(`%${escapeLike(search)}%`); }
  const whereClause = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = await allQ(`SELECT * FROM iptv_channels ${whereClause} ORDER BY country, group_name, channel_name`, params).catch(() => []);

  const stamp = Date.now();
  if (format === 'm3u') {
    const body = '#EXTM3U\n' + rows.map(ch =>
      `#EXTINF:-1${ch.logo ? ` tvg-logo="${ch.logo}"` : ''} tvg-id="${(ch.country || 'xx').toLowerCase()}${ch.id}" tvg-name="${ch.channel_name}" group-title="${ch.group_name || 'Unknown'}",${ch.channel_name}\n${ch.url}`
    ).join('\n');
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader('Content-Disposition', `attachment; filename=iptv-channels-${stamp}.m3u`);
    return res.send(body);
  }
  if (format === 'csv') {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'id,name,url,logo,country,group,status,ping_ms,last_checked\n';
    const body = header + rows.map(ch =>
      [ch.id, esc(ch.channel_name), esc(ch.url), esc(ch.logo), esc(ch.country), esc(ch.group_name), ch.status, ch.latency_ms || '', ch.last_checked || ''].join(',')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=iptv-channels-${stamp}.csv`);
    return res.send(body);
  }
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=iptv-channels-${stamp}.json`);
    return res.json({ success: true, count: rows.length, exported_at: new Date().toISOString(), channels: rows });
  }
  res.json({ success: false, error: "Định dạng không hợp lệ. Hỗ trợ: m3u, json, csv" });
});

// ─── Notifications ────────────────────────────────────────────
router.get('/notifications', async (req, res) => {
  if (!(await tableExists('iptv_notifications'))) return res.json({ success: true, unread: 0, notifications: [] });

  const { limit = 30 } = req.query;
  const rows = await allQ('SELECT * FROM iptv_notifications ORDER BY created_at DESC LIMIT ?', [parseInt(limit)]).catch(() => []);
  const unread = (await getQ('SELECT COUNT(*) as c FROM iptv_notifications WHERE is_read = 0').catch(() => ({ c: 0 })))?.c || 0;
  res.json({ success: true, unread, notifications: rows });
});

router.put('/notifications/read-all', async (req, res) => {
  if (!(await tableExists('iptv_notifications'))) return res.json({ success: true });
  await runQ('UPDATE iptv_notifications SET is_read = 1 WHERE is_read = 0');
  res.json({ success: true, message: 'Đã đánh dấu tất cả đã đọc' });
});

router.put('/notifications/:id/read', async (req, res) => {
  if (!(await tableExists('iptv_notifications'))) return res.json({ success: true });
  const id = parseInt(req.params.id);
  if (!id) return res.json({ success: false, error: 'ID không hợp lệ' });
  await runQ('UPDATE iptv_notifications SET is_read = 1 WHERE id = ?', [id]);
  res.json({ success: true });
});

router.delete('/notifications/:id', async (req, res) => {
  if (!(await tableExists('iptv_notifications'))) return res.json({ success: true });
  const id = parseInt(req.params.id);
  if (!id) return res.json({ success: false, error: 'ID không hợp lệ' });
  await runQ('DELETE FROM iptv_notifications WHERE id = ?', [id]);
  res.json({ success: true });
});

// ─── Kích hoạt scan thủ công ────────────────────────────────────
router.post('/scan-now', async (req, res) => {
  res.json({ success: true, message: 'Scan started! Check /status in 20s.' });

  // Tạo notification "đang scan"
  try {
    if (await tableExists('iptv_notifications')) {
      await runQ("INSERT INTO iptv_notifications (type, title, message) VALUES (?, ?, ?)", ['scan_started', 'Bắt đầu quét', 'Đã kích hoạt quét kênh thủ công. Quá trình quét có thể mất vài phút...']);
    }
  } catch {}

  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'scan_full.js');
  const cp = exec(`node "${scriptPath}" --auto`, { timeout: 600000 }, (err, stdout, stderr) => {
    if (err) console.error('[Admin Scan] Error:', err.message);
    else console.log('[Admin Scan] OK');
  });
  cp.stdout?.on('data', d => process.stdout.write(d));
  cp.stderr?.on('data', d => process.stderr.write(d));
});

// ─── Audit logs (bước 2.5) ─────────────────────────────────────
// GET /api/admin/logs — Xem log request API (audit trail)
// Filter: ?search=&method=&page=&limit=&from=&to=
router.get('/logs', async (req, res) => {
  if (!(await tableExists('audit_log'))) return res.json({ success: true, logs: [], total: 0, no_data: true });

  const { search = '', method = '', page = 1, limit = 50, from = '', to = '' } = req.query;
  const pg = Math.max(1, parseInt(page) || 1);
  const lm = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset = (pg - 1) * lm;

  const where = [];
  const params = [];
  if (search) {
    where.push('(duong_dan LIKE ? OR dia_chi_ip LIKE ? OR COALESCE(ma_nguoi_dung,\'\') LIKE ?)');
    params.push(`%${escapeLike(search)}%`, `%${escapeLike(search)}%`, `%${escapeLike(search)}%`);
  }
  if (method) { where.push('phuong_thuc = ?'); params.push(method.toUpperCase()); }
  if (from) { where.push('thoi_gian >= ?'); params.push(from); }
  if (to) { where.push('thoi_gian <= ?'); params.push(to); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  try {
    const row = await getQ(`SELECT COUNT(*) AS c FROM audit_log ${whereSql}`, params);
    const total = row ? (row.c || row.count || 0) : 0;
    const logs = await allQ(
      `SELECT id, thoi_gian, phuong_thuc, duong_dan, dia_chi_ip, ma_nguoi_dung, ma_trang_thai, thoi_luong_ms, tai_lieu
       FROM audit_log ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, lm, offset]
    );
    res.json({ success: true, logs: logs || [], total, page: pg, limit: lm, totalPages: Math.max(1, Math.ceil(total / lm)) });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Lỗi đọc audit log: ' + e.message });
  }
});

// ─── Cleanup (dọn dữ liệu cũ) ─────────────────────────────────────
// POST /api/admin/cleanup
// Body: { days?: number } — xóa audit_log, model_scan_cache, _sync_log cũ hơn N ngày (mặc định 30)
router.post('/cleanup', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.body.days || '30', 10));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const results = {};
    const runQ = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this && this.changes != null ? this.changes : 0); }));

    try { results.audit_log = await runQ('DELETE FROM audit_log WHERE thoi_gian < ?', [cutoff]); } catch (e) { results.audit_log = 'skip'; }
    try { results.model_scan_cache = await runQ('DELETE FROM model_scan_cache WHERE thoi_gian_quet < ?', [cutoff]); } catch (e) { results.model_scan_cache = 'skip'; }
    try { results._sync_log = await runQ('DELETE FROM _sync_log WHERE synced_at < ?', [cutoff]); } catch (e) { results._sync_log = 'skip'; }

    res.json({ success: true, days, cutoff, results });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Cleanup failed: ' + e.message });
  }
});

// ─── Import DB (migrate local SQLite → DB mới, vd Postgres trên Render) ─────
// POST /api/admin/import-sqlite   body: { db_b64 } (file .db base64, <= ~25MB)
// Idempotent: ON CONFLICT DO NOTHING — chạy lại không nhân bản dữ liệu.
// Bootstrap: DB chưa có user nào (PG mới tinh) → cho import khi body.bootstrap_key
// trùng ADMIN_PASSWORD (chưa seed admin trên PG được vì ensure-admin skip non-SQLite — chống trứng-gà).
const importBootstrapGate = (req, res, next) => {
  getQ('SELECT COUNT(*) AS n FROM nguoi_dung')
    .then((row) => {
      const n = Number(row && row.n != null ? row.n : (Object.values(row || {})[0] || 0));
      console.log('[IMPORT-gate] nguoi_dung count =', n);
      if (!n && req.body && req.body.bootstrap_key && req.body.bootstrap_key === (process.env.ADMIN_PASSWORD || '').trim()) {
        console.log('[IMPORT] Bootstrap mode: DB trống + bootstrap_key hop le — bo qua admin auth.');
        return next();
      }
      return authMiddleware(req, res, () => adminMiddleware(req, res, next));
    })
    .catch((e) => {
      console.warn('[IMPORT-gate] COUNT fail:', e && e.message);
      return authMiddleware(req, res, () => adminMiddleware(req, res, next));
    });
};
router.post('/import-sqlite', importBootstrapGate, async (req, res) => {
  const fsx = require('fs');
  const os = require('os');
  try {
    const b64 = req.body && req.body.db_b64;
    if (!b64 || typeof b64 !== 'string') return res.status(400).json({ success: false, error: 'Thiếu db_b64 (file SQLite base64)' });
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length || buf.slice(0, 15).toString('latin1').indexOf('SQLite format 3') !== 0) {
      return res.status(400).json({ success: false, error: 'Base64 không phải file SQLite hợp lệ' });
    }
    const tmp = require('path').join(os.tmpdir(), 'rexi_import_' + Date.now() + '.db');
    fsx.writeFileSync(tmp, buf);
    const runQ = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this && this.changes != null ? this.changes : 0); }));
    const allQ = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
    const sqlite3 = require('sqlite3');
    const src = new sqlite3.Database(tmp, sqlite3.OPEN_READONLY);
    const srcAll = (sql, params = []) => new Promise((resolve, reject) => src.all(sql, params, (e, r) => e ? reject(e) : resolve(r || [])));
    const report = {};
    try {
      const tables = (await srcAll("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).map(r => r.name);
      const SKIP = new Set(['_sync_queue', '_sync_log', 'sqlite_sequence']);
      const prio = ['ai_providers', 'nguoi_dung', 'ky_nang', 'app_settings', 'ai_models', 'cuoc_hoi_thoai', 'tin_nhan', 'khoa_api', 'bo_nho_dai_han', 'model_scan_cache', 'provider_scan_log', 'sessions_store'];
      tables.sort((a, b) => (prio.indexOf(a) + 1 || 99) - (prio.indexOf(b) + 1 || 99));
      for (const t of tables) {
        if (SKIP.has(t)) continue;
        try {
          const colsSrc = (await srcAll(`PRAGMA table_info("${t}")`)).map(c => c.name);
          let colsTgt;
          if (db.type === 'postgresql') {
            colsTgt = (await allQ("SELECT column_name AS name FROM information_schema.columns WHERE table_name = ? AND table_schema = current_schema()", [t])).map(c => c.name);
          } else {
            colsTgt = (await allQ(`PRAGMA table_info("${t}")`)).map(c => c.name);
          }
          const common = colsSrc.filter(c => colsTgt.includes(c));
          if (!common.length) { report[t] = 'skip (không có cột chung)'; continue; }
          const rows = await srcAll(`SELECT ${common.map(c => `"${c}"`).join(', ')} FROM "${t}"`);
          let ok = 0, errN = 0, firstErr = null;
          const collist = common.map(c => `"${c}"`).join(', ');
          for (const row of rows) {
            const vals = common.map(c => (row[c] === undefined ? null : row[c]));
            try { await runQ(`INSERT INTO "${t}" (${collist}) VALUES (${common.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`, vals); ok++; }
            catch (e) { errN++; if (!firstErr) firstErr = String(e.message).slice(0, 140); }
          }
          report[t] = `${ok}/${rows.length}` + (errN ? ` (lỗi ${errN}: ${firstErr})` : '');
        } catch (e) { report[t] = 'ERR ' + String(e.message).slice(0, 140); }
      }
    } finally {
      try { src.close(); } catch (_) {}
      try { fsx.unlinkSync(tmp); } catch (_) {}
    }
    res.json({ success: true, target: db.type, report });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e.message || e).slice(0, 300) });
  }
});

module.exports = router;
