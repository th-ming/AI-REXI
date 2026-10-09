/**
 * video-worker.js — Render worker chạy LOCAL (máy user), mở tunnel ra ngoài.
 * Rexi (cloud) gọi vào đây để render video nặng (không OOM vì chạy máy thật).
 *
 * Chạy:  node video-worker.js        (cần cài sẵn deps của Backend)
 * Env:   WORKER_PORT (mặc định 8099), WORKER_TOKEN (tuỳ chọn)
 *
 * API:
 *   GET  /health                      -> { ok:true, browser }
 *   POST /render  { html,width,height,fps,duration }  -> { success, video(base64), size, frames }
 */
const express = require('express');
const videoRenderer = require('./src/services/videoRenderer');

const app = express();
app.use(express.json({ limit: '4mb' }));

const PORT = Number(process.env.WORKER_PORT || 8099);
const TOKEN = (process.env.WORKER_TOKEN || '').trim();

function auth(req, res, next) {
  if (!TOKEN) return next();
  const t = (req.headers['x-worker-token'] || req.query.token || '').trim();
  if (t !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/health', async (req, res) => {
  let browser = null;
  try { browser = (await videoRenderer.probeBrowser()).label; } catch (e) { browser = 'error: ' + e.message; }
  res.json({ ok: true, browser, ts: Date.now() });
});

app.post('/render', auth, async (req, res) => {
  try {
    const { html, width, height, fps, duration } = req.body || {};
    if (!html || !String(html).trim()) return res.status(400).json({ error: 'Thiếu html' });
    const out = await videoRenderer.renderComposition({
      html,
      width: Math.min(Math.max(parseInt(width, 10) || 1920, 320), 1920),
      height: Math.min(Math.max(parseInt(height, 10) || 1080, 240), 1080),
      fps: Math.min(Math.max(parseInt(fps, 10) || 30, 1), 60),
      duration: Math.min(Math.max(parseFloat(duration) || 5, 1), 60),
    });
    res.json({ success: true, video: out.buffer.toString('base64'), size: out.buffer.length, frames: out.frames, browser: out.browser });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e && e.message || e) });
  }
});

app.listen(PORT, () => console.log('[video-worker] listening on ' + PORT));
