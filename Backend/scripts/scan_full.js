/**
 * IPTV Production Scanner — quét toàn bộ 250 nước, check online, lưu CSDL
 *
 * node scripts/scan_full.js          # manual
 * node scripts/scan_full.js --auto   # auto (weekly scheduler)
 *
 * FIX PROD: dùng adapter db.js (SQLite local / PostgreSQL trên Render) thay vì
 * better-sqlite3 file cứng — trước đây trên Render ghi vào file DB riêng, dữ liệu
 * IPTV tách khỏi DB chính và mất mỗi lần redeploy.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const db = require('../src/config/db');

const isPg = db.type === 'postgresql';
const NOW = () => (isPg ? 'NOW()' : "datetime('now')");

const CONFIG = { concurrency: 30, fetchTimeout: 15000, checkTimeout: 8000, countriesUrl: 'https://iptv-org.github.io/api/countries.json' };
const COUNTRY_CODE_MAP = { 'UK': 'gb' };

// ─── Promise helpers cho adapter (callback-based) ─────────────
function runQ(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this && this.changes != null ? this.changes : 0); }));
}
function getQ(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}
function allQ(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
}

function initDB() {
  // Các bảng IPTV được tạo bởi src/init-db.js khi server khởi động — không tạo lại ở đây
  // (DDL SQLite không chạy được trên PostgreSQL).
  return true;
}

function parseM3U(txt, countryCode) {
  const channels = []; let cur = null; const seen = new Set();
  for (const raw of txt.split('\n')) {
    const line = raw.replace('\r', '').trim();
    if (!line || line.startsWith('#EXTVLCOPT') || line.startsWith('#KODIPROP') || line.startsWith('#EXTM3U')) continue;
    if (line.startsWith('#EXTINF:')) {
      const lastComma = line.lastIndexOf(',');
      const name = lastComma >= 0 ? line.substring(lastComma + 1).trim() : 'Unknown';
      if (/geo-blocked|not 24.?7|offline|discontinued|blocked|dead/i.test(name)) { cur = null; continue; }
      const logo = (line.match(/tvg-logo="([^"]+)"/) || [])[1] || '';
      const group = (line.match(/group-title="([^"]+)"/) || [])[1] || '';
      cur = { name: name.replace(/\s+/g, ' ').trim(), logo, group, country: countryCode };
    } else if (line.startsWith('http') && cur) {
      const url = line.split(/[\s"'\r\n]/)[0].trim();
      if (!seen.has(url+'|'+cur.name)) { seen.add(url+'|'+cur.name); channels.push({...cur, url}); }
      cur = null;
    }
  }
  return channels;
}

async function fetchM3U(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), CONFIG.fetchTimeout);
  try { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal }); clearTimeout(t); if (!r.ok) return null; return await r.text(); }
  catch { clearTimeout(t); return null; }
}

function checkStatus(url) {
  return new Promise(resolve => {
    const start = Date.now(), lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { timeout: CONFIG.checkTimeout, headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      const latency = Date.now() - start, ok = res.statusCode >= 200 && res.statusCode < 400;
      res.resume(); res.on('end', () => resolve({ status: ok ? 'online' : 'offline', code: res.statusCode, latency }));
    });
    req.on('error', () => resolve({ status: 'offline', code: -1, latency: Date.now() - start }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'timeout', code: null, latency: CONFIG.checkTimeout }); });
  });
}

async function main() {
  initDB();
  const isAuto = process.argv.includes('--auto');
  const startTime = new Date().toISOString();
  
  console.log('=== IPTV FULL SCAN' + (isAuto ? ' (AUTO)' : '') + ' ===');
  console.log('Start: ' + startTime + '\n');

  let scanId = 0;
  if (isPg) {
    const row = await getQ("INSERT INTO iptv_scan_log (started_at, status) VALUES (?, 'running') RETURNING id", [startTime]);
    scanId = row.id;
  } else {
    await runQ("INSERT INTO iptv_scan_log (started_at, status) VALUES (?, 'running')", [startTime]);
    const r = await getQ('SELECT last_insert_rowid() AS id');
    scanId = r.id;
  }

  // ─── 1. Fetch countries ───
  console.log('[1/4] Fetching countries...');
  const cntryRes = await fetch(CONFIG.countriesUrl, { signal: AbortSignal.timeout(15000) });
  const cntryData = await cntryRes.json();
  const countries = cntryData.map(c => ({ code: c.code.toUpperCase(), name: c.name, flag: c.flag || '' }));
  console.log(` -> ${countries.length} countries\n`);

  // ─── 2. Fetch M3U playlists ───
  console.log('[2/4] Fetching M3U playlists...');
  const fetchQueue = [...countries]; let done = 0; const total = fetchQueue.length;
  let allChannels = []; const fetchStart = Date.now();

  const fWorker = async () => {
    while (fetchQueue.length > 0) {
      const c = fetchQueue.shift();
      const code = COUNTRY_CODE_MAP[c.code] || c.code.toLowerCase();
      const txt = await fetchM3U(`https://iptv-org.github.io/iptv/countries/${code}.m3u`);
      const ch = txt ? parseM3U(txt, c.code) : [];
      allChannels.push(...ch); done++;
      if (ch.length > 0) console.log(`   ${c.flag||' '} ${c.code} ${String(ch.length).padStart(5)} ch | ${c.name}`);
    }
  };
  await Promise.all(Array(10).fill(null).map(() => fWorker()));
  console.log(` -> ${allChannels.length.toLocaleString()} channels (${((Date.now()-fetchStart)/1000).toFixed(1)}s)\n`);

  // ─── 3. Check online/offline ───
  console.log(`[3/4] Checking ${allChannels.length.toLocaleString()} channels...`);
  const checkQueue = [...allChannels]; let check = 0; let onlineCount = 0;
  const checkTotal = checkQueue.length; const checkStart = Date.now();

  const cWorker = async () => {
    while (checkQueue.length > 0) {
      const ch = checkQueue.shift();
      const r = await checkStatus(ch.url);
      if (r.status === 'online') onlineCount++;
      
      try {
        const existing = await getQ('SELECT id FROM iptv_channels WHERE url = ?', [ch.url]);
        const cInfo = countries.find(c => c.code === ch.country);
        if (!existing) {
          await runQ(`
            INSERT INTO iptv_channels (country, country_name, group_name, channel_name, url, logo, status, latency_ms, http_code, last_checked, last_online, scan_id)
            VALUES (?,?,?,?,?,?,?,?,?,${NOW()},?,?)`, [
            ch.country, cInfo?.name||'', ch.group, ch.name, ch.url, ch.logo,
            r.status, r.latency||0, r.code||0, r.status==='online' ? startTime : null, scanId]);
        } else {
          await runQ(`
            UPDATE iptv_channels SET status=?,latency_ms=?,http_code=?,last_checked=${NOW()},scan_id=?,
              last_online=CASE WHEN ? THEN ${NOW()} ELSE last_online END
            WHERE url=?`, [r.status, r.latency||0, r.code||0, scanId, r.status==='online'?1:0, ch.url]);
        }
      } catch(e) {}
      
      check++;
      if (check % 100 === 0 || check === checkTotal) {
        const el = Math.floor((Date.now() - checkStart) / 1000);
        const pct = ((check/checkTotal)*100).toFixed(1); process.stdout.write(`\r  ${check}/${checkTotal} ${pct}% | ${onlineCount} online (${((onlineCount/check)*100).toFixed(1)}%) | ${el}s  `);
      }
    }
  };
  await Promise.all(Array(CONFIG.concurrency).fill(null).map(() => cWorker()));
  process.stdout.write('\n');
  const checkTime = ((Date.now() - checkStart) / 1000).toFixed(0);
  console.log(`  Done: ${onlineCount.toLocaleString()} online / ${allChannels.length.toLocaleString()} (${((onlineCount/allChannels.length)*100).toFixed(1)}%) in ${checkTime}s\n`);

  // ─── 4. Diff (new/lost) ───
  let newCount = 0, lostCount = 0;
  const prevScan = await getQ("SELECT id FROM iptv_scan_log WHERE id < ? AND status='done' ORDER BY id DESC LIMIT 1", [scanId]).catch(() => null);
  if (prevScan) {
    const before = (await allQ(`SELECT url FROM iptv_channels WHERE status='online' AND scan_id = ?`, [prevScan.id])).map(r => r.url);
    const now = (await allQ(`SELECT url FROM iptv_channels WHERE status='online' AND scan_id = ?`, [scanId])).map(r => r.url);
    const beforeSet = new Set(before), nowSet = new Set(now);
    newCount = now.filter(u => !beforeSet.has(u)).length;
    lostCount = before.filter(u => !nowSet.has(u)).length;
    console.log(`[4/4] Diff: +${newCount} new, -${lostCount} lost channels`);
  }

  // ─── Finish ───
  const finishTime = new Date().toISOString();
  await runQ(`UPDATE iptv_scan_log SET status='done',finished_at=?,total_channels=?,online_channels=?,offline_channels=?,countries_scanned=?,new_channels=?,lost_channels=? WHERE id=?`,
    [finishTime, allChannels.length, onlineCount, allChannels.length - onlineCount, countries.length, newCount, lostCount, scanId]);
  console.log('\n  Saved scan #' + scanId);

  // ─── Tạo notification khi scan xong ───
  try {
    const notifType = (newCount > 0 || lostCount > 0) ? 'scan_changes' : 'scan_complete';
    const parts = [];
    parts.push(`${allChannels.length.toLocaleString()} kênh, ${onlineCount.toLocaleString()} online`);
    if (newCount > 0) parts.push(`+${newCount} mới`);
    if (lostCount > 0) parts.push(`-${lostCount} mất`);
    const msg = `Quét ${countries.length} quốc gia: ${parts.join(', ')}`;
    const data = JSON.stringify({ scan_id: scanId, total: allChannels.length, online: onlineCount, new: newCount, lost: lostCount, countries: countries.length });
    await runQ('INSERT INTO iptv_notifications (type, title, message, data) VALUES (?, ?, ?, ?)', [notifType, 'Scan hoàn tất', msg, data]);
    console.log('  Notification created');
  } catch (e) { console.error('  Notification error:', e.message); }
}

main().catch(async e => {
  console.error('FATAL:', e.message);
  try {
    await runQ("UPDATE iptv_scan_log SET status='failed',finished_at=" + NOW() + " WHERE status='running'");
    await runQ("INSERT INTO iptv_notifications (type, title, message, data) VALUES (?, ?, ?, ?)", ['scan_failed', 'Scan thất bại', e.message || 'Lỗi không xác định', '{}']);
  } catch {}
  process.exit(1);
});

// P2-audit: khi bị SIGTERM/SIGINT giữa chừng (deploy restart, exec timeout...)
// process chết không qua catch → record 'running' kẹt vĩnh viễn trong Admin Panel.
// Đóng record thành 'interrupted' trước khi thoát.
let shuttingDown = false;
async function markInterrupted(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[scan_full] Nhận ${signal} — đánh dấu scan là 'interrupted'`);
  try {
    const nowIso = new Date().toISOString();
    await runQ("UPDATE iptv_scan_log SET status='interrupted', finished_at=" + NOW() + " WHERE status='running'");
    console.log('[scan_full] Đã đóng record scan.');
  } catch (e) { console.error('[scan_full] Không đóng được record:', e.message); }
  process.exit(130);
}
process.on('SIGTERM', () => markInterrupted('SIGTERM'));
process.on('SIGINT', () => markInterrupted('SIGINT'));
