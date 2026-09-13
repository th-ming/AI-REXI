/**
 * URL SAFETY UTILITIES - chống SSRF (P2-18 harden).
 * Dùng chung cho các route thực hiện fetch tới URL do client cung cấp.
 *
 * - isPrivateHostname / assertPublicUrl: SYNC (kiểm tra literal: IPv4 thường +
 *   hex/octal/decimal, IPv6 ULA/link-local/mapped, hostname nội bộ, `@` đáng ngờ).
 *   Giữ nguyên chữ ký cũ để không gãy caller (isValidYouTubeUrl, redirect-hop...).
 * - assertPublicUrlAsync / isHostPrivateAsync: ASYNC — resolve DNS rồi check IP
 *   kết quả (chống DNS-rebinding / domain trỏ vào nội bộ). Caller async
 *   (iptv/proxy, youtube/proxy, agentService, browserStream) DÙNG BẢN NÀY.
 */
const dns = require('dns').promises;

// ─── IPv4 helpers ────────────────────────────────────────────

/** Chuẩn hoá IPv4 viết tắt (hex/octal/decimal, số nguyên 32-bit) về dotted. Trả null nếu không phải dạng IP. */
function normalizeIPv4(host) {
  const h = String(host || '').trim();
  if (!h) return null;
  // Số nguyên 32-bit duy nhất: 2130706433 / 0x7f000001 / 017700000001
  if (/^(0x[0-9a-f]+|0[0-7]*|\d+)$/i.test(h) && !h.includes('.')) {
    let n;
    if (/^0x/i.test(h)) n = parseInt(h, 16);
    else if (/^0\d+$/.test(h) && /^[0-7]+$/.test(h)) n = parseInt(h, 8);
    else if (/^\d+$/.test(h)) n = parseInt(h, 10);
    else return null;
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return '0.0.0.0'; // tràn → coi như nội bộ
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  const parts = h.split('.');
  if (parts.length !== 4) return null;
  const out = [];
  for (const p of parts) {
    if (!p) return null;
    let v = null;
    if (/^0x[0-9a-f]+$/i.test(p)) v = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) v = parseInt(p, 8);
    else if (/^\d+$/.test(p)) v = parseInt(p, 10);
    else return null;
    if (v < 0 || v > 255) return '0.0.0.0'; // octet tràn (vd 999) → coi như nội bộ
    out.push(v);
  }
  return out.join('.');
}

function isPrivateIPv4(dotted) {
  const p = String(dotted).split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b, c] = p;
  if (a === 0) return true;                                    // 0.0.0.0/8
  if (a === 10) return true;                                   // 10/8
  if (a === 127) return true;                                  // loopback
  if (a === 169 && b === 254) return true;                     // link-local / metadata cloud
  if (a === 172 && b >= 16 && b <= 31) return true;            // 172.16/12
  if (a === 192 && b === 168) return true;                     // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;           // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true;        // benchmark
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24 + TEST-NET-1
  if (a === 203 && b === 0 && c === 113) return true;          // TEST-NET-3
  if (a === 192 && b === 88 && c === 99) return true;          // 6to4 relay (deprecated)
  if (a >= 224) return true;                                   // multicast & reserved
  return false;
}

// ─── IPv6 helpers ────────────────────────────────────────────

function hextet0(ip) {
  const first = String(ip).split(':')[0] || '';
  if (!/^[0-9a-f]{1,4}$/i.test(first)) return null;
  return parseInt(first, 16);
}

/** true nếu literal IPv6 thuộc dải nội bộ/đặc biệt (loopback, ULA fc00::/7, link-local, multicast...). */
function isPrivateIPv6(h) {
  let ip = String(h || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!ip || !ip.includes(':')) return false;
  if (ip === '::1' || ip === '::') return true;
  // IPv4-mapped dạng hex ::ffff:7f00:1 → 32 bit cuối là IPv4
  let m = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) {
    const n = (parseInt(m[1], 16) << 16) + parseInt(m[2], 16);
    return isPrivateIPv4([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  // IPv4-mapped dạng dotted ::ffff:127.0.0.1
  m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const n = normalizeIPv4(m[1]);
    return n ? isPrivateIPv4(n) : true;
  }
  const x0 = hextet0(ip);
  if (x0 === null) {
    // Dạng nén bắt đầu bằng '::' (vd ::ffff:...) không khớp trên → xét thủ công
    if (/^::/.test(ip)) {
      // ::<ipv4 dotted> (compatible, deprecated nhưng vẫn route local)
      const tail = ip.slice(2);
      if (tail.includes('.')) {
        const n = normalizeIPv4(tail);
        return n ? isPrivateIPv4(n) : true;
      }
      return true; // ::anything còn lại (unspecified)
    }
    return true; // parse không được → chặn cho chắc
  }
  if ((x0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (x0 >= 0xfc00 && x0 <= 0xfdff) return true; // fc00::/7 ULA
  if (x0 >= 0xfe80 && x0 <= 0xfebf) return true; // fe80::/10 link-local
  if (x0 === 0 && /^0{0,4}(:0{0,4}){1,7}$/.test(ip)) return true; // :: (unspecified)
  if (x0 === 0x2001) {
    const second = (ip.split(':')[1] || '').toLowerCase();
    if (second === 'db8') return true; // 2001:db8::/32 documentation
  }
  return false;
}

// ─── Hostname check (SYNC — literal only) ────────────────────

// Kiểm tra hostname có thuộc mạng nội bộ / private / reserved hay không
function isPrivateHostname(hostname) {
  if (!hostname) return true;
  const h = String(hostname).toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h === '::1' || h === '::' || h === '0.0.0.0') return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata.google' || h === 'instance-data') return true;

  // IPv6 literal (chứa ':')
  if (h.includes(':')) return isPrivateIPv6(h);

  // IPv4 literal + biến thể hex/octal/int (0x7f.0.0.1, 2130706433, 0177.0.0.1...)
  const norm = normalizeIPv4(h);
  if (norm) return isPrivateIPv4(norm);
  // Trông như IP nhưng parse hỏng (vd 999.1.1.1, 0xZZ) → chặn
  if (/^[0-9a-fx.]+$/i.test(h) && /[0-9]/.test(h) && h.includes('.')) return true;

  // Còn lại: hostname là domain - cho phép (DNS check ở bản async)
  return false;
}

/** Phát hiện userinfo đáng ngờ kiểu `evil.com@169.254.169.254` (credential chứa host/IP). */
function hasSuspiciousUserinfo(parsed) {
  try {
    const user = String(parsed.username || '');
    const pass = String(parsed.password || '');
    if (!user && !pass) return false;
    const blob = (user + ' ' + pass).trim();
    // userinfo chứa host/IP (có dấu chấm / là IP literal) → gần như chắc chắn là trick `@`
    if (blob.includes('.') || blob.includes(':')) return true;
    const n = normalizeIPv4(blob);
    if (n) return true;
    return false;
  } catch {
    return true;
  }
}

// Kiểm tra toàn bộ URL: protocol hợp lệ + không trỏ nội bộ (SYNC — không resolve DNS)
function assertPublicUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return { ok: false, reason: 'URL không hợp lệ' };
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return { ok: false, reason: 'URL không hợp lệ' }; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, reason: 'Chỉ cho phép http/https' };
  if (hasSuspiciousUserinfo(parsed)) return { ok: false, reason: 'URL chứa thông tin xác thực đáng ngờ (@)' };
  if (isPrivateHostname(parsed.hostname)) return { ok: false, reason: 'Không cho phép kết nối tới địa chỉ nội bộ' };
  return { ok: true };
}

// ─── DNS-aware check (ASYNC) ─────────────────────────────────

/** Resolve hostname → tất cả IP. Trả [] nếu không phân giải được. */
async function resolveHostIPs(hostname) {
  try {
    const recs = await dns.lookup(String(hostname), { all: true });
    return (recs || []).map((r) => r.address).filter(Boolean);
  } catch {
    return [];
  }
}

/** true nếu hostname (literal hoặc domain đã resolve) là nội bộ. */
async function isHostPrivateAsync(hostname) {
  const h = String(hostname || '');
  if (!h) return true;
  if (isPrivateHostname(h)) return true; // literal / tên đặc biệt → chặn ngay
  const bare = h.replace(/^\[/, '').replace(/\]$/, '');
  if (bare.includes(':') || normalizeIPv4(bare)) return true; // literal lọt lưới → chặn
  const ips = await resolveHostIPs(h);
  if (!ips.length) return true; // fail-closed: không phân giải được (DNS-rebinding?) → chặn
  for (const ip of ips) {
    if (ip.includes(':')) { if (isPrivateIPv6(ip)) return true; }
    else {
      const n = normalizeIPv4(ip);
      if (!n || isPrivateIPv4(n)) return true;
    }
  }
  return false;
}

/** Bản async của assertPublicUrl: sync-check + resolve DNS rồi check IP kết quả. */
async function assertPublicUrlAsync(rawUrl) {
  const base = assertPublicUrl(rawUrl);
  if (!base.ok) return base;
  let host;
  try { host = new URL(rawUrl).hostname; } catch { return { ok: false, reason: 'URL không hợp lệ' }; }
  if (await isHostPrivateAsync(host)) return { ok: false, reason: 'Hostname phân giải tới địa chỉ nội bộ (hoặc không phân giải được)' };
  return { ok: true };
}

module.exports = { isPrivateHostname, assertPublicUrl, assertPublicUrlAsync, isHostPrivateAsync, normalizeIPv4, resolveHostIPs };
