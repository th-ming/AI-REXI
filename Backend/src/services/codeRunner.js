/**
 * AI REXI — CODE RUNNER (Chạy code trong chat — ADMIN ONLY ở tầng route)
 * Chỉ hỗ trợ Python / JavaScript. Bash/sh bị CHẶN HOÀN TOÀN.
 * - Python: chạy qua execFile('python', [file]) với env whitelist tối thiểu + timeout + giới hạn output.
 * - JavaScript: chạy trong vm sandbox với realm RỖNG hoàn toàn (không require/process/
 *   child_process/Buffer, chặn cả eval/Function-from-string) — thay thế cách cũ
 *   execFile(process.execPath, ['-e', src]) vốn cho phép require('child_process') = RCE.
 * LƯU Ý: KHÔNG cô lập hệ thống hoàn toàn (python vẫn chạy local) — route
 * /exec-code BẮT BUỘC qua [authMiddleware, adminMiddleware].
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const MAX_OUTPUT = 50000;   // giới hạn output 50KB
const TIMEOUT = 15000;      // 15 giây tối đa
const MAX_CODE = 20000;     // giới hạn input 20KB

// Env whitelist tối thiểu cho tiến trình con (thay vì {...process.env} lộ toàn bộ secret)
function minimalEnv() {
  const env = { PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0' };
  for (const k of ['PATH', 'SYSTEMROOT', 'SYSTEMDRIVE', 'TEMP', 'TMP', 'LANG', 'HOME']) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return env;
}

function execP(bin, args, out) {
  return new Promise((resolve) => {
    const child = execFile(bin, args, {
      timeout: TIMEOUT,
      maxBuffer: MAX_OUTPUT + 1024 * 1024,
      windowsHide: true,
      env: minimalEnv()
    }, (err, stdout, stderr) => {
      out.stdout = String(stdout || '').substring(0, MAX_OUTPUT);
      out.stderr = String(stderr || '').substring(0, MAX_OUTPUT);
      if (err) {
        out.exitCode = err.code === null ? 'killed' : err.code;
        out.timedOut = !!err.killed || err.signal === 'SIGTERM' || (err.code === null && !err.killed && err.signal);
        if (!out.stderr) out.stderr = String(err.message || err).substring(0, 500);
      } else {
        out.exitCode = 0;
      }
      resolve();
    });
  });
}

// Chạy JS đồng bộ trong vm sandbox — realm CÔNG LẠCH, KHÔNG host object.
// P0-01b (audit): sandbox cũ đưa Math/JSON/Date... của host vào context → object
// mang prototype của host realm → `this.constructor.constructor('return process')()`
// chạm được Function của host → escape. Giờ: context rỗng hoàn toàn (kể cả console),
// code tự tạo mọi thứ trong realm riêng (escape chain dẫn về realm rỗng → null);
// kết quả kéo ra bằng JSON string (primitive) — không object nào vượt boundary.
// Sandbox vẫn cho phép code tính toán/log kết quả như trước.
async function runJSInSandbox(src, out) {
  const prelude = [
    '"use strict";',
    'const __logs=[];',
    'const __fmt=(...a)=>a.map(x=>{try{return typeof x==="string"?x:JSON.stringify(x);}catch(e){return String(x);}}).join(" ");',
    'const console={log:(...a)=>__logs.push(__fmt(...a)),info:(...a)=>__logs.push(__fmt(...a)),warn:(...a)=>__logs.push(__fmt(...a)),error:(...a)=>__logs.push(__fmt(...a)),debug:(...a)=>__logs.push(__fmt(...a))};',
    'let __result;',
    'try{',
    `__result=await (async function(){${src}\n})();`,
    '}catch(e){__result=undefined;__logs.push("THROWN:"+((e&&e.message)||String(e)));}',
    'return JSON.stringify({logs:__logs.slice(0,200),result:__result===undefined?null:{ok:1,v:__result===null?null:String(__result)}})',
  ].join('\n');
  try {
    // Realm rỗng + chặn eval/Function từ string → mọi escape chain chết trong realm rỗng.
    const raw = await vm.runInNewContext(
      `(async()=>{${prelude}})()`,
      vm.createContext({}, { codeGeneration: { strings: false, wasm: false } }),
      { timeout: TIMEOUT }
    );
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = { logs: [], result: null }; }
    if (parsed && Array.isArray(parsed.logs) && parsed.logs.length) {
      out.stdout = parsed.logs.join('\n').substring(0, MAX_OUTPUT);
    }
    if (parsed && parsed.result && parsed.result.ok) {
      const rv = parsed.result.v === null ? 'null' : parsed.result.v;
      out.stdout = ((out.stdout ? out.stdout + '\n' : '') + rv).substring(0, MAX_OUTPUT);
    }
    const thrown = (parsed && Array.isArray(parsed.logs)) ? parsed.logs.filter(l => String(l).startsWith('THROWN:')) : [];
    if (thrown.length) {
      out.exitCode = 1;
      out.stderr = thrown.map(l => String(l).slice(8)).join('\n').substring(0, 500);
      if (/timed out/i.test(out.stderr)) out.timedOut = true;
    } else {
      out.exitCode = 0;
    }
  } catch (e) {
    out.exitCode = 1;
    out.stderr = String((e && e.message) || e).substring(0, 500);
    if (/timed out/i.test(out.stderr)) out.timedOut = true;
  }
}

async function runCode(language, code) {
  if (!code || !String(code).trim()) return { error: 'Code trống. Vui lòng nhập code để chạy.' };
  if (String(code).length > MAX_CODE) return { error: `Code quá dài (tối đa ${MAX_CODE} ký tự).` };
  const lang = String(language || 'js').toLowerCase();
  const out = { language: lang, stdout: '', stderr: '', exitCode: null, timedOut: false };
  const src = String(code);
  const tmp = path.join(os.tmpdir(), 'rexicode_' + Date.now() + '_' + Math.floor(Math.random() * 1000));

  try {
    if (lang === 'python' || lang === 'py') {
      const f = tmp + '.py';
      fs.writeFileSync(f, src);
      await execP('python', [f], out);
      try { fs.unlinkSync(f); } catch (e) {}
    } else if (lang === 'javascript' || lang === 'js' || lang === 'node' || lang === 'nodejs') {
      // Sandbox vm — KHÔNG dùng node -e (cho phép require child_process = RCE)
      await runJSInSandbox(src, out);
    } else if (lang === 'bash' || lang === 'sh' || lang === 'shell') {
      // P0-01: chặn hoàn toàn bash/sh
      return { error: 'Bash/sh đã bị vô hiệu hoá vì lý do bảo mật. Chỉ hỗ trợ: python, javascript (node).' };
    } else {
      return { error: 'Chỉ hỗ trợ ngôn ngữ: python, javascript (node).' };
    }
  } catch (e) {
    out.stderr = String(e.message || e).substring(0, 500);
  }
  return out;
}

module.exports = { runCode, MAX_OUTPUT, TIMEOUT, MAX_CODE };
