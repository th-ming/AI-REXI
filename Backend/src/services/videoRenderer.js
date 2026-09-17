/**
 * videoRenderer — render composition HTML → MP4 bằng Playwright + ffmpeg-static.
 *
 * TẠI SAO KHÔNG DÙNG `hyperframes render` (QA 17/9/2026):
 *   CLI hyperframes cần browser riêng (`~/.cache/hyperframes/chrome/...`) và trên máy QA
 *   nó chết ở phase capture: "Network.enable timed out" → kẹt 0/150 frame, không bao giờ
 *   ra file. Cách này chỉ cần Playwright + ffmpeg (đều đã có trong dependencies) và tự
 *   điều khiển timeline GSAP theo từng frame nên kết quả tất định, dễ chẩn đoán.
 *
 * Cách chạy: mỗi frame → seek timeline tới đúng mốc thời gian → screenshot (JPEG) →
 * pipe thẳng vào ffmpeg (image2pipe) → mp4 (h264, yuv420p, faststart).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch (e) { ffmpegPath = null; }

const CHROME_CANDIDATES_WIN = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const CHROME_CANDIDATES_POSIX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
];

// Danh sách cách launch để thử lần lượt (bundled Chromium của Playwright trước, rồi Chrome hệ thống).
function launchCandidates() {
  const list = [{ label: 'playwright-chromium' }];
  const envPath = process.env.VIDEO_CHROME_PATH || process.env.CHROME_PATH || '';
  if (envPath && fs.existsSync(envPath)) list.push({ label: 'env-chrome', executablePath: envPath });
  for (const p of (process.platform === 'win32' ? CHROME_CANDIDATES_WIN : CHROME_CANDIDATES_POSIX)) {
    if (fs.existsSync(p)) list.push({ label: 'system:' + path.basename(p), executablePath: p });
  }
  // Chrome kênh chính thức (Playwright tự tìm) — dùng khi máy có Chrome cài sẵn
  if (process.platform === 'win32') list.push({ label: 'channel-chrome', channel: 'chrome' });
  return list;
}

function isAvailable() {
  return !!ffmpegPath && fs.existsSync(ffmpegPath);
}

// Ráp HTML composition: hoist <script src https> lên <head> + gán timeline template cho composition 'main'.
function buildCompositionHtml({ html, compId = 'main', width, height, duration }) {
  const hoisted = [];
  const body = String(html || '').replace(/<script\s+src="(https:\/\/[^"\s>]+)"\s*>\s*<\/script>/gi, (m, src) => {
    hoisted.push(src);
    return '';
  });
  const headScripts = hoisted.map(src => `  <script src="${src}"></script>`).join('\n');
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
${headScripts}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
  </style>
</head>
<body>
  <div data-composition-id="${compId}" data-width="${width}" data-height="${height}" data-start="0" data-duration="${duration}">
    ${body}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    (function () {
      var own = Object.keys(window.__timelines).filter(function (k) { return k !== '${compId}'; });
      window.__timelines['${compId}'] = own.length ? window.__timelines[own[0]] : { compositions: [] };
      own.forEach(function (k) { try { delete window.__timelines[k]; } catch (e) {} });
    })();
  </script>
</body>
</html>`;
}

async function launchBrowser(chromium) {
  const errors = [];
  for (const cand of launchCandidates()) {
    const opts = {
      headless: true,
      timeout: 60000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
        '--allow-file-access-from-files',
        '--autoplay-policy=no-user-gesture-required',
      ],
    };
    if (cand.executablePath) opts.executablePath = cand.executablePath;
    if (cand.channel) opts.channel = cand.channel;
    try {
      const browser = await chromium.launch(opts);
      return { browser, label: cand.label };
    } catch (e) {
      errors.push(`${cand.label}: ${String(e.message || e).split('\n')[0].slice(0, 120)}`);
    }
  }
  throw new Error('Không khởi động được Chrome/Chromium — ' + errors.join(' | '));
}

/**
 * @param {object} o
 * @param {string} o.html      HTML composition (từ client)
 * @param {number} o.width
 * @param {number} o.height
 * @param {number} o.fps
 * @param {number} o.duration  giây
 * @returns {Promise<{buffer:Buffer, frames:number, ms:number, browser:string}>}
 */
async function renderComposition({ html, width = 1280, height = 720, fps = 30, duration = 5 }) {
  if (!isAvailable()) throw new Error('ffmpeg-static chưa cài — không render được video');
  const { chromium } = require('playwright');

  const t0 = Date.now();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rexi-render-'));
  const htmlFile = path.join(workDir, 'index.html');
  const outFile = path.join(workDir, 'output.mp4');
  fs.writeFileSync(htmlFile, buildCompositionHtml({ html, width, height, duration }), 'utf8');

  const totalFrames = Math.max(1, Math.min(Math.round(duration * fps), 1800));
  const frameDelayMs = 1000 / fps;

  let browser;
  try {
    const launched = await launchBrowser(chromium);
    browser = launched.browser;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(60000);
    await page.goto('file://' + htmlFile.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 });
    // Chờ GSAP (nếu có) + font ổn định trước khi chụp frame đầu
    await page.waitForFunction(() => window.__timelines !== undefined, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);

    const ff = spawn(ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outFile,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });

    let ffErr = '';
    ff.stderr.on('data', d => { ffErr += d.toString(); });
    const ffDone = new Promise((resolve, reject) => {
      ff.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${ffErr.slice(0, 200)}`)));
      ff.on('error', reject);
    });

    // 1 listener 'error' duy nhất (gắn mỗi frame sẽ vượt MaxListeners → warning rác)
    let ffStdinError = null;
    ff.stdin.on('error', (e) => { ffStdinError = e; });
    const writeFrame = (buf) => new Promise((resolve, reject) => {
      if (ffStdinError) return reject(ffStdinError);
      if (ff.stdin.write(buf)) return resolve();
      ff.stdin.once('drain', resolve);
    });

    for (let i = 0; i < totalFrames; i++) {
      const t = i / fps;
      await page.evaluate((tt) => {
        const tls = window.__timelines || {};
        Object.keys(tls).forEach((k) => {
          const tl = tls[k];
          if (tl && typeof tl.pause === 'function' && typeof tl.time === 'function') {
            tl.pause();
            tl.time(Math.min(tt, typeof tl.duration === 'function' ? (tl.duration() || tt) : tt));
          }
        });
        // CSS animation/transition: đóng băng theo thời điểm frame
        if (document.getAnimations) {
          document.getAnimations().forEach((a) => {
            try { a.pause(); a.currentTime = tt * 1000; } catch (e) { /* ignore */ }
          });
        }
      }, t);
      // Cho layout/paint kịp cập nhật trước khi chụp
      await new Promise(r => setTimeout(r, 12));
      const shot = await page.screenshot({ type: 'jpeg', quality: 88 });
      await writeFrame(shot);
      if (i % 15 === 0) await new Promise(r => setTimeout(r, Math.max(0, frameDelayMs - 12) / 6));
    }

    ff.stdin.end();
    await ffDone;
    await browser.close();
    browser = null;

    const buffer = fs.readFileSync(outFile);
    if (!buffer.length) throw new Error('ffmpeg trả file rỗng');
    return { buffer, frames: totalFrames, ms: Date.now() - t0, browser: launched.label };
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { /* ignore */ } }
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

// Kiểm tra thật: launch browser rồi đóng ngay (dùng cho GET /video/status).
async function probeBrowser() {
  const { chromium } = require('playwright');
  const launched = await launchBrowser(chromium);
  try { await launched.browser.close(); } catch (e) { /* ignore */ }
  return { label: launched.label };
}

module.exports = { renderComposition, isAvailable, buildCompositionHtml, probeBrowser };
