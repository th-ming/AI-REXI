/**
 * safeExec.js — Wrapper an toàn cho child_process.exec / execSync.
 *
 * Giải quyết các rủi ro khi chạy lệnh hệ thống:
 *  - Giới hạn timeout (không treo mãi)
 *  - Cắt output quá dài (tránh tốn RAM / lộ dữ liệu nhạy cảm)
 *  - Chặn lệnh hủy diệt (destructive) khi được bật strict mode
 *  - Circuit breaker: ngăn chặn lặp lại lệnh thất bại liên tục
 *  - Orphan process tracking: theo dõi và cleanup tiến trình con
 *  - Trả kết quả chuẩn: { success, code, stdout, stderr, timedOut }
 */

const { exec, execSync } = require('child_process');
const crypto = require('crypto');

const DEFAULT_TIMEOUT = 30000;   // 30s
const MAX_OUTPUT = 200 * 1024;   // 200KB

// Lệnh nguy hiểm không bao giờ nên chạy qua agent (chỉ khi strict=true)
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf\s+(\/|\/[*]|[$]|~\b)/i,      // rm -rf /, /*, $var
  /\bformat\s+[a-z]:/i,                     // format C:
  /\bdel\s+\/f\s+\/s\s+[a-z]:\\/i,          // del /f /s C:\
  /\bdiskpart\b/i,
  /\bshutdown\s+\/s\b/i,
  /\bmkfs\./i,
  /\bdd\s+if=.*of=\/dev\//i,
  /\bmaster\s*:\s*replication/i,            // vô tình dừng replication DB
];

// Circuit Breaker state
const circuitBreaker = {
  failures: new Map(),
  threshold: 5,          // số lần thất bại trước khi mở breaker
  resetTimeout: 60000,   // 1 phút sau đó thử lại
  isOpen: (key) => {
    const state = circuitBreaker.failures.get(key);
    if (!state) return false;
    if (state.count >= circuitBreaker.threshold) {
      if (Date.now() - state.lastFailure > circuitBreaker.resetTimeout) {
        // Half-open: cho phép 1 request thử
        return false;
      }
      return true;
    }
    return false;
  },
  recordFailure: (key) => {
    const state = circuitBreaker.failures.get(key) || { count: 0, lastFailure: 0 };
    state.count++;
    state.lastFailure = Date.now();
    circuitBreaker.failures.set(key, state);
  },
  recordSuccess: (key) => {
    circuitBreaker.failures.delete(key);
  },
};

// Orphan process tracking
const activeProcesses = new Set();

function trackProcess(child) {
  activeProcesses.add(child);
  child.on('close', () => activeProcesses.delete(child));
  child.on('error', () => activeProcesses.delete(child));
}

function killAllOrphanProcesses() {
  for (const child of activeProcesses) {
    try { child.kill('SIGKILL'); } catch (e) {}
  }
  activeProcesses.clear();
}

// Graceful shutdown
process.on('SIGTERM', killAllOrphanProcesses);
process.on('SIGINT', killAllOrphanProcesses);

function truncate(str, max = MAX_OUTPUT) {
  if (typeof str !== 'string') return '';
  return str.length > max ? str.substring(0, max) + `\n…[truncated ${str.length - max} chars]` : str;
}

/**
 * Chạy lệnh an toàn (async). Trả { success, code, stdout, stderr, timedOut }.
 * @param {string} command  Lệnh cần chạy
 * @param {object} opts     { timeout, maxOutput, strict, env, cwd, circuitKey }
 */
function safeExec(command, opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const maxOutput = opts.maxOutput || MAX_OUTPUT;
  const strict = opts.strict === true;
  // P2-20(7): key = hash FULL command. Trước đây substring(0,50) → 2 lệnh khác nhau
  // mà chung 50 ký tự đầu (vd cùng prefix dài) sẽ chia sẻ breaker oan / né breaker.
  const circuitKey = opts.circuitKey || ('cmd:' + crypto.createHash('sha256').update(String(command)).digest('hex'));

  // Circuit breaker check
  if (circuitBreaker.isOpen(circuitKey)) {
    return Promise.resolve({
      success: false,
      code: null,
      stdout: '',
      stderr: `CIRCUIT_OPEN: Lệnh bị chặn do thất bại liên tục (${circuitBreaker.threshold} lần). Thử lại sau ${circuitBreaker.resetTimeout/1000}s.`,
      timedOut: false,
      circuitOpen: true
    });
  }

  return new Promise((resolve) => {
    if (strict && DESTRUCTIVE_PATTERNS.some(p => p.test(command))) {
      return resolve({ success: false, code: null, stdout: '', stderr: 'BLOCKED: lệnh nguy hiểm bị chặn bởi safeExec.', timedOut: false });
    }
    let timedOut = false;
    const child = exec(command, {
      timeout,
      maxBuffer: maxOutput + 1024,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb', ...(opts.env || {}) },
      ...(opts.cwd ? { cwd: opts.cwd } : {})
    }, (err, stdout, stderr) => {
      if (err) {
        circuitBreaker.recordFailure(circuitKey);
      } else {
        circuitBreaker.recordSuccess(circuitKey);
      }
      resolve({
        success: !err,
        code: err && err.code != null ? err.code : 0,
        stdout: truncate(stdout || '', maxOutput),
        stderr: truncate(stderr || '', maxOutput),
        timedOut
      });
    });
    trackProcess(child);
    child.on('error', () => { timedOut = false; });
    const killTimer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch (e) {} }, timeout + 1000);
    child.on('close', () => clearTimeout(killTimer));
  });
}

/**
 * Chạy lệnh an toàn (sync). Ném exception giống execSync nhưng đã bị chặn strict.
 */
function safeExecSync(command, opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const maxOutput = opts.maxOutput || MAX_OUTPUT;
  const strict = opts.strict === true;
  if (strict && DESTRUCTIVE_PATTERNS.some(p => p.test(command))) {
    const e = new Error('BLOCKED: lệnh nguy hiểm bị chặn bởi safeExec.');
    e.code = 'BLOCKED';
    throw e;
  }
  return execSync(command, {
    timeout,
    maxBuffer: maxOutput + 1024,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb', ...(opts.env || {}) },
    ...(opts.cwd ? { cwd: opts.cwd } : {})
  });
}

module.exports = { safeExec, safeExecSync, truncate, DESTRUCTIVE_PATTERNS, DEFAULT_TIMEOUT, MAX_OUTPUT, circuitBreaker, killAllOrphanProcesses };
