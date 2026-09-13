/**
 * Scheduler — IPTV Auto Scan + Memory TTL Cleanup
 */
const { exec } = require('child_process');
const path = require('path');
const db = require('./config/db');

const SCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày
const SCAN_SCRIPT = path.join(__dirname, '..', 'scripts', 'scan_full.js');
const MEMORY_TTL_DAYS = parseInt(process.env.MEMORY_TTL_DAYS || '30', 10);
const MEMORY_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 ngày

let iptvTimer = null;
let memoryTimer = null;

function runScan() {
  console.log('[IPTV Scheduler] Running auto scan...');
  const cmd = `node "${SCAN_SCRIPT}" --auto`;
  const cp = exec(cmd, { timeout: 3600000 }, (err, stdout, stderr) => {
    if (err) console.error('[IPTV Scheduler] Scan failed:', err.message);
    else console.log('[IPTV Scheduler] Scan completed');
  });
  cp.stdout?.on('data', d => process.stdout.write(d));
  cp.stderr?.on('data', d => process.stderr.write(d));
}

async function cleanupOldMemories() {
  console.log('[Memory TTL] Cleaning up memories older than', MEMORY_TTL_DAYS, 'days...');
  try {
    const cutoff = new Date(Date.now() - MEMORY_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const result = await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM bo_nho_dai_han 
         WHERE ngay_tao < ? 
         AND do_uu_tien < 7 
         AND loai NOT IN ('thong_tin_user', 'quan_trong')`,
        [cutoff],
        function(err) {
          if (err) return reject(err);
          resolve({ deleted: this.changes });
        }
      );
    });
    console.log('[Memory TTL] Cleaned up', result.deleted, 'old memories');
  } catch (err) {
    console.error('[Memory TTL] Cleanup failed:', err.message);
  }
}

function startScheduler() {
  // ⚠️ KHÔNG tự scan khi khởi động mặc định — scan đầy đủ 9.500+ kênh
  // làm nghẽn CPU/network khiến server chậm và API timeout.
  // Chỉ tự scan lần đầu khi bật IPTV_AUTO_SCAN=1 (hoặc người dùng bấm nút Scan thủ công).
  const autoScan = process.env.IPTV_AUTO_SCAN === '1';
  const firstDelay = 60 * 1000;

  console.log(`[IPTV Scheduler] Auto-scan every 7 days. First scan: ${autoScan ? 'sau ' + (firstDelay/1000) + 's' : 'TẮT (bật IPTV_AUTO_SCAN=1 để tự scan)'}`);

  if (autoScan) {
    setTimeout(() => {
      runScan();
      iptvTimer = setInterval(runScan, SCAN_INTERVAL_MS);
    }, firstDelay);
  }

  // Memory TTL Cleanup — chạy mỗi 24h, lần đầu sau 5 phút
  setTimeout(() => {
    cleanupOldMemories();
    memoryTimer = setInterval(cleanupOldMemories, MEMORY_CLEANUP_INTERVAL_MS);
  }, 5 * 60 * 1000);
  console.log(`[Memory TTL] Auto-cleanup every 24h for memories > ${MEMORY_TTL_DAYS} days (priority < 7)`);
}

function stopScheduler() {
  if (iptvTimer) { clearInterval(iptvTimer); iptvTimer = null; }
  if (memoryTimer) { clearInterval(memoryTimer); memoryTimer = null; }
}

module.exports = { startScheduler, stopScheduler, runScan, cleanupOldMemories };