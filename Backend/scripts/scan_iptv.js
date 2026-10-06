/**
 * IPTV Scanner - Quét toàn bộ kênh IPTV, thống kê quốc gia, kiểm tra online/offline
 * 
 * Chạy: node scripts/scan_iptv.js [--check] [--country=VN] [--limit=100]
 * 
 * --check    : Kiểm tra trạng thái online/offline (mất thời gian với nhiều kênh)
 * --country  : Lọc quốc gia cụ thể (VD: VN, US, ALL)
 * --limit    : Giới hạn số kênh cần check (mặc định không giới hạn)
 * --export   : Xuất danh sách kênh ra CSV (không cần check)
 */
const fs = require('fs');
const path = require('path');

const CONFIG = {
  concurrency: 30,
  timeout: 6000,
  indexUrl: 'https://iptv-org.github.io/iptv/index.m3u',
  apiCountriesUrl: 'https://iptv-org.github.io/api/countries.json',
  outputDir: path.join(__dirname, '..', 'scan_results'),
};

const args = process.argv.slice(2);
const SHOULD_CHECK = args.includes('--check');
const EXPORT_ALL = args.includes('--export');
const countryFilter = args.find(a => a.startsWith('--country='))?.split('=')[1]?.toUpperCase() || null;
const limitFilter = Math.abs(parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1])) || 0;

// ─── FETCH HELPER ─────────────────────────────────────────────
async function fetchUrl(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function parseM3U(text) {
  const channels = [];
  const lines = text.split('\n');
  let current = null;
  const seen = new Set();

  for (const rawLine of lines) {
    const line = rawLine.replace('\r', '').trim();
    if (!line || line.startsWith('#EXTVLCOPT') || line.startsWith('#KODIPROP') || line.startsWith('#EXTM3U')) continue;

    if (line.startsWith('#EXTINF:')) {
      const lastComma = line.lastIndexOf(',');
      const rawName = lastComma >= 0 ? line.substring(lastComma + 1).trim() : 'Unknown';
      const name = rawName.replace(/\s+/g, ' ').trim();

      if (/(geo-blocked|not 24\/7|offline|discontinued|blocked|dead)/i.test(name)) {
        current = null;
        continue;
      }

      const logoMatch = line.match(/tvg-logo="([^"]+)"/);
      const groupMatch = line.match(/group-title="([^"]+)"/);
      const countryMatch = line.match(/tvg-country="([^"]+)"/);
      const idMatch = line.match(/tvg-id="[^"]*\.([a-z]{2})"/i);

      let countryCode = '';
      if (countryMatch) countryCode = countryMatch[1].split(',')[0].trim().toUpperCase();
      else if (idMatch) countryCode = idMatch[1].toUpperCase();

      current = {
        name,
        logo: logoMatch ? logoMatch[1] : '',
        group: groupMatch ? groupMatch[1] : '',
        country: countryCode || 'UNKNOWN',
      };
    } else if (line.startsWith('http') && current) {
      const url = line.split(/[\s"'\r\n]/)[0].trim();
      const key = url + '|' + current.name;
      if (!seen.has(key)) {
        seen.add(key);
        channels.push({ ...current, url });
      }
      current = null;
    }
  }
  return channels;
}

function checkStatus(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const lib = url.startsWith('https:') ? require('https') : require('http');
    const req = lib.get(url, { timeout: CONFIG.timeout, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      const latency = Date.now() - start;
      const ok = res.statusCode >= 200 && res.statusCode < 400;
      res.resume();
      res.on('end', () => resolve({ status: ok ? 'ONLINE' : 'OFFLINE', code: res.statusCode, latency }));
    });
    req.on('error', () => resolve({ status: 'OFFLINE', code: -1, latency: Date.now() - start }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', code: null, latency: CONFIG.timeout }); });
  });
}

async function checkAll(channels, concurrency) {
  const results = [];
  const queue = [...channels];
  let done = 0;
  const total = queue.length;
  const startTime = Date.now();

  console.log(`\n[CHECK] ${total} kênh, ${concurrency} song song...\n`);

  const worker = async () => {
    while (queue.length > 0) {
      const ch = queue.shift();
      const r = await checkStatus(ch.url);
      results.push({ ...ch, ...r });
      done++;
      const pct = ((done / total) * 100).toFixed(1);
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const eta = done > 0 ? Math.round((elapsed / done) * (total - done)) : 0;
      const barLen = 30;
      const filled = Math.round((done / total) * barLen);
      const bar = '▓'.repeat(filled) + '░'.repeat(barLen - filled);
      process.stdout.write(`\r  ${bar} ${done}/${total} ${pct}% | ${elapsed}s | ~${eta}s | [${r.status}]          `);
    }
  };

  const workers = Array(Math.min(concurrency, Math.max(1, total))).fill(null).map(() => worker());
  await Promise.all(workers);

  process.stdout.write('\n');
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Hoàn thành ${done} kênh / ${elapsed}s`);
  return results;
}

function exportCSV(rows, filePath) {
  const header = 'Country,Group,Name,URL,Status,HTTP_Code,Latency_ms';
  const lines = rows.map(r =>
    `"${(r.country||'')}","${(r.group||'')}","${(r.name||'').replace(/"/g,'""')}","${r.url||''}","${r.status||''}","${r.code||''}","${r.latency||0}"`
  );
  fs.writeFileSync(filePath, [header, ...lines].join('\n'), 'utf-8');
  return filePath;
}

// ─── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║     IPTV SCANNER - Rexi AI         ║');
  console.log('╚══════════════════════════════════════╝\n');

  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];

  // 1. Lấy danh sách quốc gia
  console.log('[1/3] Lấy danh sách quốc gia...');
  let countries = [];
  try {
    const resp = await fetch(CONFIG.apiCountriesUrl, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) {
      const data = await resp.json();
      countries = data.map(c => ({ code: c.code.toUpperCase(), name: c.name, flag: c.flag || '' }));
      console.log(`  -> ${countries.length} quốc gia có M3U`);
    }
  } catch (e) {
    console.log(`  -> Lỗi: ${e.message}`);
  }

  // 2. Tải toàn bộ index M3U
  console.log('\n[2/3] Tải index.m3u...');
  let allChannels = [];
  try {
    const text = await fetchUrl(CONFIG.indexUrl, 60000);
    allChannels = parseM3U(text);
    console.log(`  -> Tổng: ${allChannels.length.toLocaleString()} kênh`);
  } catch (e) {
    console.log(`  -> Lỗi: ${e.message}`);
    return;
  }

  // Thống kê
  const byCountry = {};
  const byGroup = {};
  for (const c of allChannels) {
    byCountry[c.country] = (byCountry[c.country] || 0) + 1;
    byGroup[c.group] = (byGroup[c.group] || 0) + 1;
  }
  const countryEntries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]);
  const groupEntries = Object.entries(byGroup).sort((a, b) => b[1] - a[1]);

  console.log(`\n┌─────────────────────────────────────┐`);
  console.log(`│ 📊 THỐNG KÊ TỔNG QUAN               │`);
  console.log(`├─────────────────────────────────────┤`);
  console.log(`│ Tổng kênh:   ${allChannels.length.toString().padStart(8)}              │`);
  console.log(`│ Số quốc gia: ${countryEntries.length.toString().padStart(8)}              │`);
  console.log(`│ Danh mục:    ${groupEntries.length.toString().padStart(8)}              │`);
  console.log(`└─────────────────────────────────────┘`);

  console.log('\n🌍 Top 20 Quốc gia nhiều kênh nhất:');
  countryEntries.slice(0, 20).forEach(([code, count], i) => {
    const flag = countries.find(c => c.code === code)?.flag || '';
    const name = countries.find(c => c.code === code)?.name || code;
    console.log(`   ${String(i+1).padStart(2)}. ${flag? flag+' ':'  '}${code.padEnd(4)} ${count.toString().padStart(6)} kênh  (${name})`);
  });

  console.log('\n📂 Top 10 Danh mục:');
  groupEntries.slice(0, 10).forEach(([group, count], i) => {
    console.log(`   ${String(i+1).padStart(2)}. ${group.padEnd(30)} ${count.toString().padStart(5)} kênh`);
  });

  // Lưu thống kê JSON
  const statsPath = path.join(CONFIG.outputDir, `iptv_stats_${timestamp}.json`);
  const stats = {
    scanned_at: new Date().toISOString(),
    total_channels: allChannels.length,
    total_countries: countryEntries.length,
    total_categories: groupEntries.length,
    countries: Object.fromEntries(countryEntries),
    categories: Object.fromEntries(groupEntries),
  };
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf-8');
  console.log(`\n📄 Stats JSON: ${statsPath}`);

  // 3. Xuất toàn bộ danh sách ra CSV (nếu --export)
  if (EXPORT_ALL) {
    const csvPath = path.join(CONFIG.outputDir, `all_channels_${timestamp}.csv`);
    exportCSV(allChannels.map(c => ({ ...c, status: 'NOT_CHECKED', code: '', latency: 0 })), csvPath);
    console.log(`📄 Tất cả kênh CSV: ${csvPath}`);
  }

  // 4. Kiểm tra trạng thái (nếu --check)
  if (SHOULD_CHECK) {
    let target = allChannels;
    if (countryFilter) {
      target = target.filter(c => c.country === countryFilter);
      console.log(`\n--> Lọc theo ${countryFilter}: ${target.length} kênh`);
    }
    if (limitFilter > 0 && target.length > limitFilter) {
      target = target.slice(0, limitFilter);
      console.log(`--> Giới hạn: ${limitFilter} kênh`);
    }

    const results = await checkAll(target, CONFIG.concurrency);
    const online = results.filter(r => r.status === 'ONLINE');
    const offline = results.filter(r => r.status === 'OFFLINE');
    const timeout = results.filter(r => r.status === 'TIMEOUT');

    console.log('\n═══════════════════════════════');
    console.log('   KẾT QUẢ KIỂM TRA');
    console.log('═══════════════════════════════');
    const total = results.length;
    const onlinePct = ((online.length / total) * 100).toFixed(1);
    const offlinePct = ((offline.length / total) * 100).toFixed(1);
    const timeoutPct = ((timeout.length / total) * 100).toFixed(1);
    console.log(`   Online:     ${String(online.length).padStart(5)}  (${onlinePct}%)`);
    console.log(`   Offline:    ${String(offline.length).padStart(5)}  (${offlinePct}%)`);
    console.log(`   Timeout:    ${String(timeout.length).padStart(5)}  (${timeoutPct}%)`);
    console.log(`   Tổng:       ${results.length.toString().padStart(5)}`);
    console.log(`   Latency TB: ${Math.round(online.reduce((s,r) => s + r.latency, 0) / (online.length || 1))}ms`);

    // Export CSV Chi tiết
    const csvPath = path.join(CONFIG.outputDir, `iptv_check_${timestamp}.csv`);
    exportCSV(results, csvPath);
    console.log(`\n📄 Kết quả CSV: ${csvPath}`);

    // Top kênh nhanh nhấtnhất
    console.log('\n⚡ Top 10 kênh nhanh nhất (latency thấp nhất):');
    online.sort((a,b) => a.latency - b.latency).slice(0, 10).forEach((r, i) => {
      console.log(`   ${String(i+1).padStart(2)}. ${r.latency.toString().padStart(4)}ms | ${r.country.padEnd(4)} | ${r.name.substring(0, 50)}`);
    });

    // Kiểm tra kênh offline theo quốc gia
    console.log('\n❌ Kênh offline theo quốc gia:');
    const offlineByCountry = {};
    for (const r of offline) {
      offlineByCountry[r.country] = (offlineByCountry[r.country] || 0) + 1;
    }
    Object.entries(offlineByCountry)
      .sort((a,b) => b[1] - a[1])
      .slice(0, 15)
      .forEach(([code, count], i) => {
        console.log(`   ${String(i+1).padStart(2)}. ${code.padEnd(5)} ${count} kênh offline`);
      });
  } else {
    console.log('\n💡 Thêm --check để kiểm tra trạng thái từng kênh.');
    console.log('   node scripts/scan_iptv.js --check --country=VN --limit=100');
    console.log('   node scripts/scan_iptv.js --check --limit=500   (500 kênh đầu)');
    console.log('   node scripts/scan_iptv.js --export              (xuất CSV toàn bộ)');
  }
}

main().catch(err => {
  console.error('\n[ERROR]', err.message);
  process.exit(1);
});