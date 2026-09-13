/**
 * Agent Engine Service — chạy Agent Mode qua 2 engine: opencode hoặc DeepSeek Harness (dsh).
 * Được dùng bởi chat.routes.js (cả 2 endpoint messages + messages/stream).
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { stripAnsi, AnsiStreamCleaner } = require('../utils/stripAnsi');

// ── opencode ──────────────────────────────────────────────
const OPENCODE_BIN_PATH = process.env.OPENCODE_BIN_PATH ||
  (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.opencode', 'bin', 'opencode.exe') : '');
const IS_OPENCODE_AVAILABLE = fs.existsSync(OPENCODE_BIN_PATH);

// ── DeepSeek Harness (dsh) ────────────────────────────────
// Ưu tiên: dsh trong PATH (đã cài global), fallback: npx
function findDshCmd() {
  if (process.env.DSH_BIN_PATH && fs.existsSync(process.env.DSH_BIN_PATH)) return process.env.DSH_BIN_PATH;
  const candidates = [
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'npm-global', 'dsh.cmd') : null,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'dsh.cmd') : null,
  ];
  for (const c of candidates) { if (c && fs.existsSync(c)) return c; }
  return 'dsh'; // nếu trong PATH thì dùng trực tiếp
}
const DSH_BIN = findDshCmd();
const DSH_PATCH_FILE = path.join(__dirname, '..', 'config', 'dsh-agent-patch.yml');
const DSH_SETTINGS = path.join(process.env.USERPROFILE || '', '.dsh', 'settings.yaml');
const IS_DSH_AVAILABLE = fs.existsSync(DSH_PATCH_FILE) && fs.existsSync(DSH_SETTINGS);

const NO_COLOR_ENV = { ...process.env, LANG: 'en_US.UTF-8', NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb', CLICOLOR: '0', CLICOLOR_FORCE: '0' };

// P2-20(4): quote arg kiểu Windows cho cmd.exe. Prompt của user (chứa `"`, `&`,
// `|`, `^`, `%`...) mà ném thẳng vào argv của cmd.exe sẽ gãy parse, thậm chí
// thoát quote → tiêm lệnh. quoteWinArg bọc quote + nhân đôi `"` trong chuỗi.
// (Bỏ hẳn cmd.exe không được: file .cmd/.bat trên Windows bắt buộc chạy qua shell.)
function quoteWinArg(a) {
  const s = String(a ?? '');
  if (!s) return '""';
  if (!/[\s"`&|<>^%!]/.test(s)) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// Spawn qua cmd.exe một cách an toàn (shell:false tường minh, /d bỏ autorun).
function spawnViaCmd(bin, args, opts) {
  const cmdLine = ['/d', '/s', '/c', [bin, ...args].map(quoteWinArg).join(' ')];
  return spawn(process.env.COMSPEC || 'cmd.exe', cmdLine, { ...opts, shell: false });
}

function isCmdShim(bin) {
  const b = String(bin || '').toLowerCase();
  return b.endsWith('.cmd') || b.endsWith('.bat');
}

/**
 * Kiểm tra engine có sẵn không.
 * @param {'opencode'|'dsh'} engine
 */
function isEngineAvailable(engine) {
  if (engine === 'dsh') return IS_DSH_AVAILABLE;
  return IS_OPENCODE_AVAILABLE;
}

/**
 * Chạy agent engine, gom stdout/stderr.
 * @param {'opencode'|'dsh'} engine
 * @param {string} prompt
 * @param {string} modelName  (chỉ opencode dùng)
 * @param {string} cwd
 * @param {object} extraEnv  (vd { XKIRO_API_KEY })
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function runAgentEngine(engine, prompt, modelName, cwd, extraEnv = {}) {
  return new Promise((resolve) => {
    const env = { ...NO_COLOR_ENV, ...extraEnv };
    const rootDir = cwd || path.join(__dirname, '..', '..', '..');
    let args, bin;

    if (engine === 'dsh') {
      // dsh --profile headless --patch <file> "<prompt>"
      bin = DSH_BIN;
      args = ['--profile', 'headless', '--patch', DSH_PATCH_FILE, prompt];
    } else {
      // opencode run "<prompt>" -m <model> --auto --pure --title agent-task
      // Model phải có đủ prefix provider (vd: xkiro/deepseek/...) để opencode route đúng.
      // Frontend gửi model_name có thể chỉ là 'deepseek/deepseek-v4-pro' → tự thêm xkiro/.
      const rawModel = (modelName || '').trim();
      const knownProviders = /^(xkiro|nvidia|groq|mistral|cerebras|gemini|openrouter|cohere|agentrouter|bai|kiosapi|unorouter|opencode)\//i;
      const opencodeModel = knownProviders.test(rawModel)
        ? rawModel
        : rawModel.includes('/')
          ? 'xkiro/' + rawModel
          : 'xkiro/deepseek/deepseek-v4-pro';
      bin = OPENCODE_BIN_PATH;
      args = ['run', prompt, '-m', opencodeModel, '--auto', '--pure', '--title', 'agent-task'];
    }

    let proc;
    if (engine === 'dsh' && isCmdShim(bin)) {
      // Windows: file .cmd/.bat phải chạy qua shell, không spawn trực tiếp được
      proc = spawnViaCmd(bin, args, { cwd: rootDir, timeout: 300000, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } else {
      proc = spawn(bin, args, { cwd: rootDir, timeout: 300000, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    }
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += stripAnsi(d.toString()); });
    proc.stderr.on('data', (d) => { stderr += stripAnsi(d.toString()); });
    proc.on('error', (e) => resolve({ code: -1, stdout, stderr: e.message }));
    proc.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

/**
 * Chạy agent engine với stream SSE (dùng cho /messages/stream).
 * @param {'opencode'|'dsh'} engine
 * @param {string} prompt
 * @param {string} modelName
 * @param {string} cwd
 * @param {object} extraEnv
 * @param {(payload:object)=>void} sendSSE
 * @param {()=>void} endStream
 * @returns {()=>void} hàm hủy (kill process)
 */
function runAgentEngineStream(engine, prompt, modelName, cwd, extraEnv, sendSSE, endStream) {
  const env = { ...NO_COLOR_ENV, ...extraEnv };
  const rootDir = cwd || path.join(__dirname, '..', '..', '..');
  let args, bin;

  if (engine === 'dsh') {
    bin = DSH_BIN;
    args = ['--profile', 'headless', '--patch', DSH_PATCH_FILE, prompt];
  } else {
    // Model phải có đủ prefix provider (vd: xkiro/deepseek/...) để opencode route đúng.
    const rawModel = (modelName || '').trim();
    const knownProviders = /^(xkiro|nvidia|groq|mistral|cerebras|gemini|openrouter|cohere|agentrouter|bai|kiosapi|unorouter|opencode)\//i;
    const opencodeModel = knownProviders.test(rawModel)
      ? rawModel
      : rawModel.includes('/')
        ? 'xkiro/' + rawModel
        : 'xkiro/deepseek/deepseek-v4-pro';
    bin = OPENCODE_BIN_PATH;
    args = ['run', prompt, '-m', opencodeModel, '--auto', '--pure', '--title', 'agent-task'];
  }

  let proc;
  if (engine === 'dsh' && isCmdShim(bin)) {
    proc = spawnViaCmd(bin, args, { cwd: rootDir, timeout: 300000, env, stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    proc = spawn(bin, args, { cwd: rootDir, timeout: 300000, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  }
  let stdout = '';
  let stderr = '';
  const cleaner = new AnsiStreamCleaner();
  proc.stdout.on('data', (data) => {
    const cleaned = cleaner.push(data.toString());
    if (cleaned) { stdout += cleaned; sendSSE({ type: 'token', text: cleaned }); }
  });
  proc.stderr.on('data', (data) => { stderr += stripAnsi(data.toString()); });
  proc.on('error', () => { sendSSE({ type: 'error', message: 'Lỗi khởi động Agent process.' }); endStream(); });
  proc.on('close', (code) => {
    const flushed = cleaner.flush();
    if (flushed) stdout += flushed;
    let finalText;
    if (code !== 0) { finalText = stdout.trim() || stderr.trim() || `[Agent Error] Process exited with code ${code}`; }
    else { finalText = stdout.trim() || "Tôi đã tự động thực thi các câu lệnh và cập nhật tệp tin thành công cho bạn."; }
    sendSSE({ type: 'done', noi_dung: finalText });
    endStream();
  });
  return () => { try { if (!proc.killed) proc.kill(); } catch (e) {} };
}

/**
 * Tự chọn engine theo độ phức tạp của task.
 * - Task ngắn/đơn giản → dsh (nhanh hơn ~30%)
 * - Task dài/nhiều bước/phức tạp → opencode (ổn định hơn)
 * - Nếu engine được chọn không có sẵn → fallback sang cái còn lại.
 * @param {string} prompt
 * @param {'opencode'|'dsh'|'auto'|undefined} requested
 * @returns {'opencode'|'dsh'}
 */
function pickEngine(prompt, requested) {
  const req = String(requested || '').trim().toLowerCase();
  if (req === 'opencode' || req === 'dsh') {
    // Người dùng chọn tay: nếu engine đó có sẵn → dùng, không thì đổi
    if (req === 'opencode' && IS_OPENCODE_AVAILABLE) return 'opencode';
    if (req === 'dsh' && IS_DSH_AVAILABLE) return 'dsh';
    return IS_OPENCODE_AVAILABLE ? 'opencode' : 'dsh';
  }
  // Chế độ AUTO: phân loại độ phức tạp
  const text = String(prompt || '');
  const complexHints = /(viết (lại|mới)|tạo (mới|toàn bộ)|refactor|tái cấu trúc|nhiều file|tích hợp|thiết kế hệ thống|kiến trúc|sửa lỗi ở|fix bug|debug|test|deploy|database|api mới|full|hoàn chỉnh|đầy đủ)/i;
  const isComplex = text.length > 400 || complexHints.test(text);
  // dsh nhanh hơn cho task ngắn; opencode ổn định cho task dài
  const want = isComplex ? 'opencode' : 'dsh';
  if (want === 'dsh' && IS_DSH_AVAILABLE) return 'dsh';
  if (want === 'opencode' && IS_OPENCODE_AVAILABLE) return 'opencode';
  return IS_OPENCODE_AVAILABLE ? 'opencode' : 'dsh';
}

module.exports = {
  OPENCODE_BIN_PATH, IS_OPENCODE_AVAILABLE,
  DSH_BIN, DSH_PATCH_FILE, IS_DSH_AVAILABLE,
  isEngineAvailable, pickEngine, runAgentEngine, runAgentEngineStream,
  quoteWinArg, // export để test (P2-20(4))
};
