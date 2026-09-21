const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { safeExec } = require('../utils/safeExec');
const db = require('../config/db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth.middleware');
const { GUEST_USER_ID } = require('../ensure-admin');
const { logActivity } = require('../utils/activityLog');
const { Shell } = require('node-powershell');
const { isPrivateHostname, assertPublicUrlAsync } = require('../utils/urlSafety');
const { rateLimit } = require('../middleware/rateLimit');
const { decryptKey } = require('../utils/cryptoKeys');
const multer = require('multer');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { generateEdgeTTSNode } = require('../services/edgeTTS');
const { searchVideos, getVideoStream, downloadAudio } = require('../services/ytdlpService');
const ytdlp = require('../services/ytdlpService');
const { PDFParse } = require('pdf-parse');
const ragService = require('../services/ragService');
const videoRenderer = require('../services/videoRenderer');

// QA 18/9: tạo ảnh qua OpenRouter (models image-output:free) — chen giữa Gemini và
// provider miễn phí trong chain của /generate-image. Trả { success, image, provider }.
async function generateImageOpenRouter(prompt) {
  try {
    const keyRows = await new Promise((resolve) => {
      db.all("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'openrouter' AND gia_tri_khoa IS NOT NULL AND TRIM(gia_tri_khoa) <> ''", [], (e, rows) => resolve(rows || []));
    });
    if (!keyRows.length) return { success: false, error: 'Không có key OpenRouter trong DB' };
    let orKey = '';
    try { orKey = decryptKey(keyRows[0].gia_tri_khoa).trim(); } catch (e) { orKey = ''; }
    if (!orKey) return { success: false, error: 'Giải mã key OpenRouter thất bại' };
    const MODELS = ['google/gemini-2.5-flash-image-preview:free', 'qwen/qwen-2.5-vl-72b-instruct:free'];
    let lastErr = '';
    for (const model of MODELS) {
      try {
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${orKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: `Generate an image: ${prompt}` }] }),
          signal: AbortSignal.timeout(120000)
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) { lastErr = `HTTP ${resp.status}: ${String(data?.error?.message || '').slice(0, 120)}`; continue; }
        const msg = data?.choices?.[0]?.message || {};
        const content = Array.isArray(msg.content) ? msg.content : [];
        const imgPart = content.find(p => (p.type === 'image_url' && p.image_url?.url));
        const b64 = msg.images?.[0]?.image_url?.url || imgPart?.image_url?.url || null;
        if (b64 && /^data:image\//.test(b64)) {
          return { success: true, image: b64, mimeType: b64.slice(5, b64.indexOf(';')), provider: 'openrouter' };
        }
        lastErr = `${model} không trả ảnh${typeof msg.content === 'string' ? ' (trả text)' : ''}`;
      } catch (e) { lastErr = e.message; }
    }
    return { success: false, error: lastErr || 'OpenRouter không trả ảnh' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Multer: Lưu file audio tạm thời vào thư mục temp
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', '..', 'temp')),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.webm';
      cb(null, `caption_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // P2-20(5): 50MB → 25MB max (multer này chỉ dùng cho /transcribe)
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/webm', 'audio/mp3', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/x-wav', 'audio/x-m4a'];
    if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file audio (mp3, wav, webm, m4a, ogg, mp4)'), false);
    }
  }
});

// Khởi tạo Groq client
// NOTE FOR AI AGENTS & DEVELOPERS: API Key của Groq được lưu trữ trực tiếp trong Cơ sở dữ liệu SQLite
// ở bảng `khoa_api` (cột `ten_nha_cung_cap` = 'groq', đã mã hóa). Hàm getGroqClient() sẽ ưu tiên lấy từ DB
// nếu file .env không có `GROQ_API_KEY`. Vì vậy key đã sẵn có trong DB mà không cần khai báo trong .env!
const getGroqClient = async () => {
  let key = process.env.GROQ_API_KEY;
  if (!key || key === 'YOUR_GROQ_API_KEY_HERE') {
    key = await new Promise((resolve) => {
      db.get("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'groq'", [], (err, row) => {
        if (err || !row || !row.gia_tri_khoa) return resolve(null);
        resolve(decryptKey(row.gia_tri_khoa).trim());
      });
    });
  }
  if (!key) return null;
  return new Groq({ apiKey: key });
};

// P2-20(5): bọc promise thêm timeout (Groq SDK không phải lúc nào cũng nhận AbortSignal)
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error((label || 'Yêu cầu') + ` quá thời gian (${Math.round(ms / 1000)}s). Vui lòng thử lại với file ngắn hơn.`)), ms)),
  ]);
}

// Khởi tạo Gemini client (key từ DB — bảng khoa_api, ten_nha_cung_cap = 'gemini')
// Dùng làm FALLBACK khi Groq hết quota/lỗi — đảm bảo Tóm tắt AI luôn hoạt động.
const getGeminiClient = async () => {
  let key = process.env.GEMINI_API_KEY;
  if (!key || key === 'YOUR_GEMINI_API_KEY_HERE') {
    key = await new Promise((resolve) => {
      db.get("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'gemini'", [], (err, row) => {
        if (err || !row || !row.gia_tri_khoa) return resolve(null);
        resolve(decryptKey(row.gia_tri_khoa).trim());
      });
    });
  }
  if (!key) return null;
  return new GoogleGenerativeAI(key);
};

// Office packages
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx');
const PptxGenJS = require('pptxgenjs');
const { PDFDocument } = require('pdf-lib');

// ─── P1-09: kiểm tra chủ sở hữu cuộc hội thoại (admin bypass) ───
// Trả null nếu được phép; trả { status, error } nếu bị chặn (404/403/500).
function assertConvOwner(maHoiThoai, req) {
  return new Promise((resolve) => {
    if (req.user && (req.user.role === 'admin' || req.user.phan_quyen === 'admin')) return resolve(null);
    const expectedOwner = req.user ? req.user.id : GUEST_USER_ID;
    db.get("SELECT ma_nguoi_dung FROM cuoc_hoi_thoai WHERE ma_hoi_thoai = ? AND ngay_xoa IS NULL", [maHoiThoai], (err, row) => {
      if (err) return resolve({ status: 500, error: err.message });
      if (!row) return resolve({ status: 404, error: 'Không tìm thấy cuộc hội thoại.' });
      if (row.ma_nguoi_dung !== expectedOwner) return resolve({ status: 403, error: 'Không có quyền truy cập cuộc hội thoại này.' });
      resolve(null);
    });
  });
}

// Skills API — Lấy skills đang kích hoạt (public dành cho chat)
router.get('/skills', authMiddleware, (req, res) => {
  db.all("SELECT * FROM ky_nang WHERE trang_thai = 'kich_hoat'", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Skills API — Lấy TẤT CẢ skills (kể cả bị tắt) — dành cho Admin quản lý
router.get('/skills/all', authMiddleware, (req, res) => {
  db.all("SELECT * FROM ky_nang ORDER BY trang_thai DESC, ten_ky_nang ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Skills API — Toggle bật/tắt một skill (Admin only)
router.put('/skills/:id/toggle', [authMiddleware, adminMiddleware], (req, res) => {
  const { id } = req.params;
  const { trang_thai } = req.body;
  if (!trang_thai || !['kich_hoat', 'vo_hieu'].includes(trang_thai)) {
    return res.status(400).json({ success: false, error: 'trang_thai phải là "kich_hoat" hoặc "vo_hieu"' });
  }
  db.run('UPDATE ky_nang SET trang_thai = ? WHERE ma_ky_nang = ?', [trang_thai, id], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (this.changes === 0) return res.status(404).json({ success: false, error: 'Không tìm thấy kỹ năng' });
    // P1-13: ghi nhật ký ai toggle skill nào
    logActivity(req.user && req.user.id, 'toggle_skill', `${id} -> ${trang_thai}`);
    res.json({ success: true, message: `Đã ${trang_thai === 'kich_hoat' ? 'bật' : 'tắt'} kỹ năng`, trang_thai });
  });
});

// Live Desktop API - Cho mọi user đã đăng nhập (TỐI ƯU HIỆU NĂNG)
// Live Desktop API - Cho mọi user đã đăng nhập (TỐI ƯU HIỆU NĂNG)
const DESKTOP_ONLY_LOCAL = (res) => {
  if (process.platform !== 'win32') {
    res.status(501).json({ success: false, error: 'Remote Desktop chỉ khả dụng khi backend chạy trên Windows local — trên server web tính năng này tắt.' });
    return true;
  }
  return false;
};
router.get('/desktop/screenshot', [authMiddleware, adminMiddleware], async (req, res) => {
  if (DESKTOP_ONLY_LOCAL(res)) return;
  const { spawnSync } = require('child_process');
  const path = require('path');
  const fs = require('fs');

  const psScript = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $bitmap.Size)
$ms = New-Object System.IO.MemoryStream
$bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bytes = $ms.ToArray()
$graphics.Dispose()
$bitmap.Dispose()
$ms.Dispose()
[System.Convert]::ToBase64String($bytes)
`;

  try {
    const tempScript = path.join(require('os').tmpdir(), 'screenshot_' + Date.now() + '.ps1');
    fs.writeFileSync(tempScript, psScript, 'utf8');

    const result = spawnSync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', tempScript
    ], { encoding: 'utf8', timeout: 10000 });

    try { fs.unlinkSync(tempScript); } catch {}

    if (result.error) {
      throw new Error(result.error.message);
    }
    if (result.status !== 0) {
      throw new Error(result.stderr || 'PowerShell exit code: ' + result.status);
    }

    const base64Image = result.stdout.trim();
    if (!base64Image) {
      throw new Error('Empty screenshot data');
    }

    const imgBuffer = Buffer.from(base64Image, 'base64');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': imgBuffer.length });
    res.end(imgBuffer);
  } catch (error) {
    res.status(500).json({ error: 'Lỗi chụp màn hình: ' + error.message });
  }
});

router.post('/desktop/click', [authMiddleware, adminMiddleware], (req, res) => {
  if (DESKTOP_ONLY_LOCAL(res)) return;
  const { x_percent, y_percent } = req.body;
  
  // VALIDATE LINH HOẠT: chấp nhận cả số và string number, chặn string chữ
  const x = Number(x_percent);
  const y = Number(y_percent);
  
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ error: 'x_percent và y_percent phải là số (ví dụ: 0.5)' });
  }
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    return res.status(400).json({ error: 'Giá trị percent phải từ 0.0 đến 1.0' });
  }
  
  const psClick = `
    Add-Type -AssemblyName System.Windows.Forms
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $targetX = [int]($screen.Width * ${x})
    $targetY = [int]($screen.Height * ${y})
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($targetX, $targetY)
    $signature = '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);'
    $type = Add-Type -MemberDefinition $signature -Name "Win32MouseEvent" -Namespace "Win32Functions" -PassThru
    $type::mouse_event(0x0002, 0, 0, 0, 0)
    $type::mouse_event(0x0004, 0, 0, 0, 0)
  `;

  exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psClick.replace(/\n/g, ' ')}"`, { timeout: 3000 }, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Không thể điều khiển chuột: ' + err.message });
    }
    res.json({ success: true, x_percent, y_percent });
  });
});

// Weather API
router.get('/external/weather', authMiddleware, async (req, res) => {
  const city = req.query.city || 'Hanoi';
  try {
    const resp = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json();
    if (!data.current_condition || !data.current_condition[0]) {
      throw new Error('Invalid response format');
    }
    const current = data.current_condition[0];
    res.json({
      success: true,
      city: city,
      temp_C: current.temp_C || 'N/A',
      humidity: current.humidity || 'N/A',
      windspeedKmph: current.windspeedKmph || 'N/A',
      weatherDesc: (current.weatherDesc && current.weatherDesc[0]?.value) || 'N/A',
      uvIndex: current.uvIndex || 'N/A',
      source: 'wttr.in'
    });
  } catch (err) {
    res.json({
      success: false,
      error: 'Không thể lấy dữ liệu thời tiết: ' + err.message,
      source: 'error'
    });
  }
});

// Stocks API
router.get('/external/stocks/:symbol', authMiddleware, async (req, res) => {
  const { symbol } = req.params;
  try {
    const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol.toUpperCase()}?interval=1d&range=1mo`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json();
    if (!data.chart?.result?.[0]) {
      throw new Error('No data available');
    }
    const result = data.chart.result[0];
    const quote = result.indicators.quote[0];
    const prices = quote.close.filter(p => p !== null);
    
    if (prices.length < 2) {
      return res.json({ success: true, symbol: symbol.toUpperCase(), currentPrice: prices[0]?.toFixed(2) || 'N/A', change: '0', changePercent: '0', prices, recommendation: 'FLAT ➡️', source: 'Yahoo Finance' });
    }
    
    const currentPrice = prices[prices.length - 1];
    const prevPrice = prices[prices.length - 2];
    const change = currentPrice - prevPrice;
    const changePercent = ((change / prevPrice) * 100).toFixed(2);
    
    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      currentPrice: currentPrice.toFixed(2),
      change: change.toFixed(2),
      changePercent: changePercent,
      prices: prices.slice(-15),
      recommendation: currentPrice > prevPrice ? 'UP 📈' : (currentPrice < prevPrice ? 'DOWN 📉' : 'FLAT ➡️'),
      source: 'Yahoo Finance'
    });
  } catch (err) {
    res.json({
      success: false,
      error: 'Không thể lấy dữ liệu chứng khoán: ' + err.message,
      symbol: symbol.toUpperCase(),
      source: 'error'
    });
  }
});

// Vietnamese TTS API - Edge TTS WebSocket thuần Node (fallback Python edge-tts)
// VERIFY 17/9/2026 (voices/list thật của Microsoft): vi-VN chỉ còn 2 giọng — 8 giọng cũ
// (DuyAnh, HaSanh, MinhAnh, ThuyMinh, ThiTuyet, VanHanh, VanMinh, CaoViet) đã bị MS rút
// khỏi Edge TTS → WS đóng ngay 'No audio chunks' → rơi fallback Python chết trên Render.
const VIETNAMESE_TTS_VOICES = [
  { id: 'vi-VN-HoaiMyNeural', label: 'Hoài Mỹ (Nữ, Bắc)', gender: 'Nữ', region: 'Bắc' },
  { id: 'vi-VN-NamMinhNeural', label: 'Nam Minh (Nam, Nam)', gender: 'Nam', region: 'Nam' }
];
const VALID_TTS_VOICES = VIETNAMESE_TTS_VOICES.map(v => v.id);

// ── VieNeu-TTS v3 Turbo (20/9/2026) ─────────────────────────────────────────
// Engine OpenAI-compatible tự host (máy local có model): VIENEU_BASE_URL trỏ tới
// `python -m apps.openai_speech` (port 8000). 25 preset giọng Việt 48kHz + cloning.
// Không cấu hình env → app tự dùng edge-tts như cũ. Render free không chạy nổi model.
const VIENEU_BASE_URL = (process.env.VIENEU_BASE_URL || '').trim().replace(/\/$/, '');
const VIENEU_API_KEY = (process.env.VIENEU_API_KEY || 'not-needed').trim();
const VIENEU_TIMEOUT_MS = Number(process.env.VIENEU_TIMEOUT_MS || 120000);

// Preset voices của VieNeu v3 Turbo (GET /v1/voices) — dùng khi server không gọi được /v1/voices
const VIENEU_PRESET_VOICES = [
  'Adam bựa', 'Trúc Ly', 'Anh Khôi', 'Mai Anh', 'Minh Quân Pro', 'Thùy Dung', 'Thiền Tâm Đức',
  'Ngọc Huyền', 'Quang Sơn', 'Ngọc Trân',
  'Minh Đức', 'Phạm Tuyên', 'Xuân Vĩnh', 'Thanh Bình', 'Ngọc Linh', 'Đoan Trang', 'Quỳnh Anh', 'Mạnh Dũng',
  'Thái Sơn', 'Thục Đoan', 'Minh Triết', 'Mỹ Duyên', 'Đức Trí', 'Kim Thanh', 'Adam'
];
const VIENEU_DEFAULT_VOICE = 'Minh Quân Pro';

async function fetchVieNeuVoices() {
  try {
    const res = await fetch(`${VIENEU_BASE_URL}/v1/voices`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data?.data) && data.data.length) return data.data.map(v => String(v.id || v.name));
  } catch {}
  return null;
}

// Gọi VieNeu OpenAI-compatible POST /v1/audio/speech → Buffer WAV
async function generateVieNeuTTS(text, voice, { sampleRate } = {}) {
  const body = {
    model: 'vieneu-v3-turbo',
    voice: voice || VIENEU_DEFAULT_VOICE,
    input: String(text || ''),
    response_format: 'wav',
  };
  if (sampleRate) body.sample_rate = sampleRate;
  const res = await fetch(`${VIENEU_BASE_URL}/v1/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(VIENEU_API_KEY && VIENEU_API_KEY !== 'not-needed' ? { Authorization: `Bearer ${VIENEU_API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(VIENEU_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`VieNeu HTTP ${res.status}${detail ? ': ' + detail.substring(0, 200) : ''}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('VieNeu trả về audio rỗng');
  return buf;
}

// Map voice Edge cũ (user đã lưu trong localStorage) → giọng VieNeu gần tương đương
const VIENEU_VOICE_ALIAS = {
  'vi-VN-HoaiMyNeural': 'Trúc Ly',
  'vi-VN-NamMinhNeural': 'Minh Quân Pro',
};

// GET: Lấy danh sách giọng nói TTS tiếng Việt
// VieNeu active (env VIENEU_BASE_URL) → trả 25 preset giọng v3 Turbo; ngược lại 2 giọng Edge.
router.get('/tts/voices', async (req, res) => {
  const { lang } = req.query;
  if (lang && lang !== 'vi') return res.json({ success: true, voices: [], default: null });
  if (VIENEU_BASE_URL) {
    const ids = (await fetchVieNeuVoices()) || VIENEU_PRESET_VOICES;
    return res.json({
      success: true,
      engine: 'vieneu',
      voices: ids.map(id => ({ id, label: id })),
      default: ids.includes(VIENEU_DEFAULT_VOICE) ? VIENEU_DEFAULT_VOICE : ids[0],
    });
  }
  return res.json({ success: true, engine: 'edge-tts', voices: VIETNAMESE_TTS_VOICES, default: 'vi-VN-HoaiMyNeural' });
});

// GET: Kiểm tra trạng thái TTS service
router.get('/tts/status', async (req, res) => {
  let edgeTtsAvailable = false;
  try {
    edgeTtsAvailable = await new Promise((resolve) => {
      const spawn = require('child_process').spawn;
      const proc = spawn('python', ['-c', 'import edge_tts; print("ok")'], { timeout: 10000 });
      let ok = false;
      proc.stdout.on('data', d => { if (d.toString().trim() === 'ok') ok = true; });
      proc.on('close', () => resolve(ok));
      proc.on('error', () => resolve(false));
    });
  } catch {
    // edge-tts not available
  }
  res.json({
    success: true,
    edge_tts: edgeTtsAvailable,
    voices: VIETNAMESE_TTS_VOICES.length,
    fallback: 'Web Speech API (browser)'
  });
});

// ═══════════════════════════════════════════════════════════════════
// Engine Edge TTS Thuần Node.js — dùng chung từ src/services/edgeTTS.js
// (WebSocket trực tiếp tới Microsoft Edge TTS, không cần Python)
// ═══════════════════════════════════════════════════════════════════

// Chạy edge-tts Python làm phương án dự phòng
async function runEdgeTtsPython(voiceName, trimmedText, validRate, validPitch, tempFile) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (e) {}
    const proc = spawn('python', [
      '-m', 'edge_tts',
      '--voice', voiceName,
      '--text', trimmedText,
      '--rate', validRate,
      '--pitch', validPitch,
      '--write-media', tempFile
    ], { timeout: 15000 });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(tempFile)) resolve();
      else reject(new Error(stderr || 'Python edge-tts failed'));
    });
    proc.on('error', (err) => reject(err));
  });
}

router.post('/tts', rateLimit({ windowMs: 60000, max: 30 }), authMiddleware, async (req, res) => {
  const { text, voice, rate, pitch } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Văn bản không được để trống' });
  }

  const maxLength = 1000;
  const trimmedText = text.trim().substring(0, maxLength);
  const voiceInput = String(voice || '').trim();

  // Ưu tiên số 1 khi cấu hình: VieNeu v3 Turbo (tự host, 48kHz) — voice là tên preset có dấu
  // (nhận cả voice Edge cũ qua alias, cả giọng clone đã enroll trên server VieNeu)
  if (VIENEU_BASE_URL) {
    try {
      const vnVoice = VIENEU_VOICE_ALIAS[voiceInput]
        || (voiceInput && !VALID_TTS_VOICES.includes(voiceInput) ? voiceInput : VIENEU_DEFAULT_VOICE);
      const wavBuffer = await generateVieNeuTTS(trimmedText, vnVoice);
      const base64Audio = wavBuffer.toString('base64');
      return res.json({
        success: true,
        audio: base64Audio,
        format: 'wav',
        engine: 'vieneu',
        voice: vnVoice,
        voice_label: vnVoice,
        text_length: trimmedText.length
      });
    } catch (vnErr) {
      console.warn('[TTS] VieNeu failed, falling back to Edge TTS:', vnErr.message);
    }
  }

  // Edge TTS (Microsoft) — 2 giọng còn sống; voice lạ → Hoài Mỹ
  const voiceName = VALID_TTS_VOICES.includes(voiceInput) ? voiceInput : 'vi-VN-HoaiMyNeural';
  const validRate = rate && /^[+-]\d+%$/.test(rate) ? rate : '+0%';
  const validPitch = pitch && /^[+-]\d+Hz$/.test(pitch) ? pitch : '+0Hz';

  try {
    let audioBuffer;

    // Gọi trực tiếp Edge TTS WebSocket thuần Node.js (Siêu nhanh 300ms, không cần Python)
    try {
      audioBuffer = await generateEdgeTTSNode(voiceName, trimmedText, validRate, validPitch);
    } catch (wsErr) {
      console.warn('[TTS] Pure Node.js WebSocket failed, trying Python fallback:', wsErr.message);
      // Dự phòng: Thử gọi Python nếu WebSocket gặp sự cố
      const tempFile = path.join(__dirname, '..', '..', `tts_${Date.now()}.mp3`);
      await runEdgeTtsPython(voiceName, trimmedText, validRate, validPitch, tempFile);
      if (fs.existsSync(tempFile)) {
        audioBuffer = fs.readFileSync(tempFile);
        try { fs.unlinkSync(tempFile); } catch(e) {}
      }
    }

    if (audioBuffer && audioBuffer.length > 0) {
      const base64Audio = audioBuffer.toString('base64');
      return res.json({
        success: true,
        audio: base64Audio,
        format: 'mp3',
        engine: 'edge-tts',
        voice: voiceName,
        voice_label: VIETNAMESE_TTS_VOICES.find(v => v.id === voiceName)?.label || voiceName,
        rate: validRate,
        pitch: validPitch,
        text_length: trimmedText.length
      });
    }

    throw new Error('Không thể tạo âm thanh TTS');
  } catch (err) {
    console.error('[TTS] Error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Lỗi phát âm thanh: ' + err.message,
      note: 'Dịch vụ giọng nói Microsoft Edge TTS tạm thời gián đoạn.'
    });
  }
});
const getCountryFlag = (code) => {
  if (!code || code.length !== 2) return '🌐';
  const codePoints = code.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
};

// ============================================================
// HLS Stream Proxy — tránh CORS khi trình duyệt load stream
// Browser gọi: /api/services/iptv/proxy?url=<encoded_stream_url>
// Backend fetch về rồi chuyển tiếp với CORS headers mở
// ============================================================
// P2-19d: proxy yêu cầu đăng nhập. <video>/hls.js không gửi được Authorization
// header → cho phép token qua ?token= (bridge sang header cho authMiddleware).
// FE đã gửi token vào URL proxy (App.jsx playHlsStream, YouTubeTab proxyUrl);
// playlist m3u8 rewrite giữ lại token cho các segment con (qsToken).
function proxyAuth(req, res, next) {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  return authMiddleware(req, res, next);
}

router.get('/iptv/proxy', rateLimit({ windowMs: 60000, max: 120 }), proxyAuth, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(url);
    // P2-18: check async (literal + DNS resolve) thay vì isPrivateHostname sync
    const check = await assertPublicUrlAsync(targetUrl);
    if (!check.ok) {
      const code = (check.reason === 'URL không hợp lệ' || check.reason === 'Chỉ cho phép http/https') ? 400 : 403;
      return res.status(code).json({ error: check.reason });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }

  try {
    // Chống SSRF qua redirect: kiểm tra lại địa chỉ mỗi bước (tối đa 5 hops)
    let effectiveUrl = targetUrl;
    let upstream;
    for (let hop = 0; hop <= 5; hop++) {
      upstream = await fetch(effectiveUrl, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': new URL(targetUrl).origin + '/',
          'Origin': new URL(targetUrl).origin
        },
        signal: AbortSignal.timeout(15000)
      });
      if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
        const nextUrl = new URL(upstream.headers.get('location'), effectiveUrl).toString();
        const hopCheck = await assertPublicUrlAsync(nextUrl);
        if (!hopCheck.ok) {
          return res.status(403).json({ error: 'Internal network access is not allowed (redirect)' });
        }
        effectiveUrl = nextUrl;
        continue;
      }
      break;
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Content-Type', contentType);
    res.status(upstream.status);

    // Nếu là file .m3u8 playlist thì rewrite các URL → tuyệt đối qua proxy
    if (contentType.toLowerCase().includes('mpegurl') || effectiveUrl.toLowerCase().endsWith('.m3u8')) {
      let body = await upstream.text();
      // Chuẩn hoá CRLF -> LF (một số server dùng CRLF, regex rewrite sẽ miss)
      if (body.includes('\r\n')) body = body.replace(/\r\n/g, '\n');

      const base = effectiveUrl.substring(0, effectiveUrl.lastIndexOf('/') + 1);
      const origin = new URL(effectiveUrl).origin;
      const toAbsolute = (u) => {
        if (/^https?:\/\//i.test(u)) return u;
        if (u.startsWith('/')) return origin + u;
        return base + u;
      };
      // Giữ ?token= cho segment con (nếu client gọi proxy kèm token qua query)
      const qsToken = req.query.token ? `&token=${encodeURIComponent(req.query.token)}` : '';
      const toProxy = (u) => `${req.protocol}://${req.get('host')}/api/services/iptv/proxy?url=${encodeURIComponent(toAbsolute(u))}${qsToken}`;
      // 1) Rewrite dòng URI thường (segment, variant playlist)
      body = body.replace(/^(?!#)([^\r\n]+)$/gm, (line) => {
        line = line.trim();
        if (!line) return line;
        return toProxy(line);
      });
      // 2) Rewrite URI nằm TRONG dòng #EXT-X-MAP / #EXT-X-KEY / #EXT-X-MEDIA
      //    (init segments fMP4, AES keys, audio/subtitle renditions) — nếu không
      //    proxy, trình duyệt fetch trực tiếp cross-origin → CORS chặn → mất audio.
      body = body.replace(/^(#EXT-X-(?:MAP|KEY|MEDIA)):([^\r\n]*)$/gim, (whole, tag, attrs) => {
        return tag + ':' + attrs.replace(/URI="([^"]*)"/gi, (m, u) => `URI="${toProxy(u)}"`);
      });
      return res.send(body);
    }

    // Dữ liệu nhị phân (ts segments, etc.) — pipe thẳng
    const buffer = await upstream.arrayBuffer();
    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[IPTV Proxy] Error:', err.message);
    return res.status(502).json({ error: 'Proxy upstream error: ' + err.message });
  }
});

// IPTV Channels API
router.get('/iptv/channels', async (req, res) => {
  const { country, category, limit = 1500 } = req.query;
  try {
    const availableCategories = [
      'news', 'sports', 'entertainment', 'music', 'movies',
      'documentary', 'animation', 'kids', 'general', 'education',
      'religion', 'science', 'business', 'shop'
    ];
    
    const COUNTRY_CODE_MAP = { 'GB': 'uk', 'UK': 'uk' };
    
    let url = 'https://iptv-org.github.io/iptv/index.m3u';
    
    if (country && country !== 'all' && country.trim()) {
      const mappedCode = COUNTRY_CODE_MAP[country.toUpperCase()] || country.toLowerCase();
      url = `https://iptv-org.github.io/iptv/countries/${mappedCode}.m3u`;
    } else if (category && availableCategories.includes(category.toLowerCase())) {
      url = `https://iptv-org.github.io/iptv/categories/${category.toLowerCase()}.m3u`;
    } else if (category && category.trim() && !availableCategories.includes(category.toLowerCase())) {
      return res.json({ success: false, error: `Category '${category}' kh\u00f4ng t\u1ed3n t\u1ea1i. Categories c\u00f3 s\u1eb5n: ${availableCategories.join(', ')}` });
    }
      
    let resp;
    try {
      resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(20000)
      });
    } catch (err) {
      console.log('[IPTV] Fetch M3U url error, trying index fallback:', err.message);
      resp = await fetch('https://iptv-org.github.io/iptv/index.m3u', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(20000)
      }).catch(() => null);
    }
    
    let text = '';
    if (resp && resp.ok) {
      text = await resp.text();
    }
    
    const channels = [];
    const seenUrls = new Set();
    const seenNames = new Set();

    if (text && text.length > 50) {
      const lines = text.split('\n');
      let currentChannel = null;

      for (const rawLine of lines) {
        const line = rawLine.replace('\r', '').trim();
        if (!line || line.startsWith('#EXTVLCOPT') || line.startsWith('#KODIPROP') || line.startsWith('#EXTM3U')) continue;
        
        if (line.startsWith('#EXTINF:')) {
          const lastComma = line.lastIndexOf(',');
          const name = lastComma >= 0 ? line.substring(lastComma + 1).trim() : 'Kênh Truyền Hình';

          // Bỏ qua các kênh đã được đánh dấu là Geo-blocked, Not 24/7, Offline, Blocked trong danh sách M3U
          if (/geo-blocked|not 24\/7|offline|discontinued|blocked|dead/i.test(name)) {
            currentChannel = null;
            continue;
          }

          const logoMatch = line.match(/tvg-logo="([^"]+)"/);
          const logo = logoMatch ? logoMatch[1] : '';
          const groupMatch = line.match(/group-title="([^"]+)"/);
          const group = groupMatch ? groupMatch[1] : '';

          const countryMatch = line.match(/tvg-country="([^"]+)"/);
          let countryCode = '';
          if (countryMatch) {
            countryCode = countryMatch[1].split(',')[0].trim().toUpperCase();
          } else {
            const idMatch = line.match(/tvg-id="[^"]*\.([a-z]{2})"/i);
            if (idMatch) countryCode = idMatch[1].toUpperCase();
          }
          
          currentChannel = { name, logo, group, country: countryCode };
        } else if (line.startsWith('http') && currentChannel) {
          const cleanUrl = line.split(/[\s"'\r\n]/)[0].trim();
          
          if (
            cleanUrl && 
            (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) && 
            !seenUrls.has(cleanUrl)
          ) {
            seenUrls.add(cleanUrl);
            currentChannel.url = cleanUrl;
            currentChannel.name = currentChannel.name.replace(/\s+/g, ' ').trim();
            channels.push(currentChannel);
          }
          currentChannel = null;
        }
      }
    }

    // Lọc kênh nước ngoài khi filter quốc gia — chỉ bỏ kênh rõ ràng không phải VN
    if (country && country !== 'all' && country.trim()) {
      const targetCode = country.toUpperCase();
      const FOREIGN_BLACKLIST = /uniquely thai|lao sv|lao-thai|laos thai|thai tv|hmong tv|rtm asean|mnb world|vietnamese american|us viet|phoenix viet|little saigon|tea tv/i;
      const filtered = channels.filter(ch => {
        if (ch.country === targetCode) return true;
        if (ch.country && ch.country !== targetCode) return false;
        if (ch.name && FOREIGN_BLACKLIST.test(ch.name)) return false;
        return true;
      });
      channels.length = 0;
      channels.push(...filtered);
    }

    // Bổ sung các kênh Truyền Hình Việt Nam trực tiếp (VTV, VTC, Tỉnh Thành)
    if (!category && (!country || country.toUpperCase() === 'VN')) {
      const vnDirectChannels = [
        // VTV — nguồn FPTPlay (đang sống 100%)
        { name: 'VTV1 HD - Thời Sự 24/7', logo: 'https://i.imgur.com/mgp6RAU.png', group: 'News', country: 'VN', url: 'https://live-a.fptplay53.net/live/media/vtv1/live247-hls-avc/index.m3u8' },
        { name: 'VTV2 HD - Khoa Học & Giáo Dục', logo: 'https://i.imgur.com/mgp6RAU.png', group: 'Education', country: 'VN', url: 'https://live-a.fptplay53.net/live/media/vtv2/live247-hls-avc/index.m3u8' },
        { name: 'VTV3 HD - Giải Trí & Thể Thao', logo: 'https://i.imgur.com/efrauLr.png', group: 'Entertainment', country: 'VN', url: 'https://live.fptplay53.net/live/media/vtv3/live247-hls-avc/index.m3u8' },
        { name: 'VTV4 HD - Đối Ngoại Quốc Tế', logo: 'https://i.imgur.com/mgp6RAU.png', group: 'General', country: 'VN', url: 'https://live-a.fptplay53.net/live/media/vtv4/live247-hls-avc/index.m3u8' },
        { name: 'VTV5 HD - Tiếng Dân Tộc', logo: 'https://i.imgur.com/mgp6RAU.png', group: 'General', country: 'VN', url: 'https://live-a.fptplay53.net/live/media/vtv5/live247-hls-avc/index.m3u8' },
        { name: 'VTV5 Tây Nam Bộ HD', logo: 'https://i.imgur.com/mgp6RAU.png', group: 'General', country: 'VN', url: 'https://live-a.fptplay53.net/live/media/vtv5tnb/live-hls-avc/index.m3u8' },
        { name: 'VTV5 Tây Nguyên HD', logo: 'https://i.imgur.com/mgp6RAU.png', group: 'General', country: 'VN', url: 'https://vips-livecdn.fptplay.net/live/media/vtv5tn/live-hls-avc/index.m3u8' },
        { name: 'VTV6 HD - Kênh Thanh Thiếu Niên', logo: 'https://i.imgur.com/mgp6RAU.png', group: 'Entertainment', country: 'VN', url: 'https://live-a.fptplay53.net/live/media/vtv6/live247-hls-avc/index.m3u8' },
        { name: 'VTV7 HD - Kênh Giáo Dục Quốc Gia', logo: 'https://i.imgur.com/mgp6RAU.png', group: 'Education', country: 'VN', url: 'https://live-a.fptplay53.net/live/media/vtv7/live247-hls-avc/index.m3u8' },
        { name: 'VTV9 HD - Kênh Nam Bộ', logo: 'https://i.imgur.com/mgp6RAU.png', group: 'General', country: 'VN', url: 'https://live-a.fptplay53.net/live/media/vtv9/live247-hls-avc/index.m3u8' },
        { name: 'VTV10 HD - Kênh Đa Nền Tảng', logo: 'https://i.imgur.com/mgp6RAU.png', group: 'General', country: 'VN', url: 'https://live-a.fptplay53.net/live/media/vtv10/live247-hls-avc/index.m3u8' },
        // Các đài khác — nguồn vtvprime (đang sống)
        { name: 'ANTV - Truyền Hình Công An Nhân Dân', logo: 'https://i.imgur.com/mgp6RAU.png', group: 'News', country: 'VN', url: 'https://liveh12.vtvprime.vn/hls/ANNINHTV/index.m3u8' },
        { name: 'QPVN - Quốc Phòng Việt Nam HD', logo: 'https://i.imgur.com/mgp6RAU.png', group: 'News', country: 'VN', url: 'https://liveh12.vtvprime.vn/hls/QPTV/index.m3u8' },
        { name: 'SCTV2 HD', logo: 'https://i.imgur.com/efrauLr.png', group: 'Entertainment', country: 'VN', url: 'https://liveh12.vtvprime.vn/hls/SCTV2/index.m3u8' },
        { name: 'HTV Key - Kênh Chìa Khóa Vàng', logo: 'https://i.imgur.com/efrauLr.png', group: 'Entertainment', country: 'VN', url: 'https://liveh12.vtvprime.vn/hls/HTVKey/index.m3u8' },
        // Kênh Tỉnh Thành
        { name: 'Cần Thơ TV1 (1080p)', logo: '', group: 'General', country: 'VN', url: 'https://live.canthotv.vn/live/tv/chunklist.m3u8' },
        { name: 'Cần Thơ TV3 (1080p)', logo: '', group: 'General', country: 'VN', url: 'https://live.canthotv.vn/cs3/tv/chunklist.m3u8' },
        { name: 'Đồng Tháp TV1 (720p)', logo: '', group: 'General', country: 'VN', url: 'https://liveh34.vtvprime.vn/hls/DONGTHAPTV/index.m3u8' },
        { name: 'Thái Nguyên TV (720p)', logo: '', group: 'General', country: 'VN', url: 'https://streaming.thainguyentv.vn/hls/livestream.m3u8' },
        // Kênh quốc tế liên quan VN
        { name: 'TVB Vietnam (1080p)', logo: '', group: 'Entertainment', country: 'VN', url: 'https://amg01868-amg01868c3-tvbanywhere-us-4491.playouts.now.amagi.tv/playlist/amg01868-tvbusa-tvbvietnam-tvbanywhereus/playlist.m3u8' },
      ];

      for (const ch of vnDirectChannels) {
        if (!seenUrls.has(ch.url)) {
          seenUrls.add(ch.url);
          channels.unshift(ch);
        }
      }
    }

    const { search } = req.query;
    let result = channels;
    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      result = channels.filter(ch => ch.name.toLowerCase().includes(q));
    }

    res.json({ success: true, count: result.length, categories: availableCategories, channels: result });
  } catch (err) {
    res.json({ success: false, error: 'L\u1ed7i k\u1ebft n\u1ed1i IPTV: ' + (err.message || 'Timeout ho\u1eb7c server kh\u00f4ng ph\u1ea3n h\u1ed3i') });
  }
});


// Map code -> tên quốc gia
const countryNames = {
  'VN': 'Vietnam', 'US': 'United States', 'GB': 'United Kingdom', 'FR': 'France',
  'DE': 'Germany', 'IT': 'Italy', 'ES': 'Spain', 'JP': 'Japan', 'KR': 'South Korea',
  'CN': 'China', 'RU': 'Russia', 'BR': 'Brazil', 'MX': 'Mexico', 'CA': 'Canada',
  'AU': 'Australia', 'IN': 'India', 'TH': 'Thailand', 'PH': 'Philippines',
  'ID': 'Indonesia', 'MY': 'Malaysia', 'SG': 'Singapore', 'HK': 'Hong Kong',
  'TW': 'Taiwan', 'NZ': 'New Zealand', 'ZA': 'South Africa', 'NG': 'Nigeria',
  'KE': 'Kenya', 'EG': 'Egypt', 'TR': 'Turkey', 'SA': 'Saudi Arabia',
  'AE': 'United Arab Emirates', 'IL': 'Israel', 'PK': 'Pakistan', 'BD': 'Bangladesh',
  'NL': 'Netherlands', 'BE': 'Belgium', 'CH': 'Switzerland', 'AT': 'Austria',
  'SE': 'Sweden', 'NO': 'Norway', 'DK': 'Denmark', 'FI': 'Finland',
  'PL': 'Poland', 'CZ': 'Czech Republic', 'HU': 'Hungary', 'RO': 'Romania',
  'GR': 'Greece', 'PT': 'Portugal', 'IE': 'Ireland', 'AR': 'Argentina',
  'CL': 'Chile', 'CO': 'Colombia', 'PE': 'Peru', 'VE': 'Venezuela',
  'CU': 'Cuba', 'PR': 'Puerto Rico', 'DO': 'Dominican Republic', 'JM': 'Jamaica',
  'TN': 'Tunisia', 'MA': 'Morocco', 'DZ': 'Algeria', 'LY': 'Libya',
  'QA': 'Qatar', 'BH': 'Bahrain', 'KW': 'Kuwait', 'OM': 'Oman',
  'JO': 'Jordan', 'LB': 'Lebanon', 'SY': 'Syria', 'IQ': 'Iraq',
  'IR': 'Iran', 'AF': 'Afghanistan', 'UZ': 'Uzbekistan', 'KZ': 'Kazakhstan',
  'TJ': 'Tajikistan', 'KG': 'Kyrgyzstan', 'TM': 'Turkmenistan', 'MN': 'Mongolia',
  'LA': 'Laos', 'KH': 'Cambodia', 'MM': 'Myanmar', 'VG': 'British Virgin Islands',
  'VI': 'U.S. Virgin Islands', 'TC': 'Turks and Caicos', 'BS': 'Bahamas',
  'BM': 'Bermuda', 'KY': 'Cayman Islands', 'AI': 'Anguilla', 'AG': 'Antigua and Barbuda',
  'KN': 'Saint Kitts and Nevis', 'LC': 'Saint Lucia', 'VC': 'Saint Vincent and the Grenadines',
  'GD': 'Grenada', 'BZ': 'Belize', 'HT': 'Haiti', 'TT': 'Trinidad and Tobago',
  'GY': 'Guyana', 'SR': 'Suriname', 'EC': 'Ecuador', 'BO': 'Bolivia',
  'PY': 'Paraguay', 'UY': 'Uruguay', 'FM': 'Micronesia', 'PW': 'Palau',
  'FJ': 'Fiji', 'SB': 'Solomon Islands', 'VU': 'Vanuatu', 'WS': 'Samoa',
  'KI': 'Kiribati', 'TO': 'Tonga', 'PG': 'Papua New Guinea', 'BT': 'Bhutan',
  'NP': 'Nepal', 'SL': 'Sierra Leone', 'LR': 'Liberia', 'GH': 'Ghana',
  'CI': 'Côte d\'Ivoire', 'SN': 'Senegal', 'ML': 'Mali', 'BJ': 'Benin',
  'BF': 'Burkina Faso', 'NE': 'Niger', 'TD': 'Chad', 'CF': 'Central African Republic',
  'CM': 'Cameroon', 'GA': 'Gabon', 'CG': 'Republic of the Congo', 'CD': 'Democratic Republic of the Congo',
  'AO': 'Angola', 'ZM': 'Zambia', 'ZW': 'Zimbabwe', 'MW': 'Malawi',
  'MZ': 'Mozambique', 'BW': 'Botswana', 'NA': 'Namibia', 'LS': 'Lesotho',
  'SZ': 'Eswatini', 'MU': 'Mauritius', 'SC': 'Seychelles', 'MG': 'Madagascar',
  'GM': 'Gambia', 'GW': 'Guinea-Bissau', 'GN': 'Guinea', 'ET': 'Ethiopia',
  'SO': 'Somalia', 'DJ': 'Djibouti', 'ER': 'Eritrea', 'SD': 'Sudan',
  'SS': 'South Sudan', 'UG': 'Uganda', 'RW': 'Rwanda', 'BI': 'Burundi',
  'TZ': 'Tanzania', 'AL': 'Albania', 'BA': 'Bosnia and Herzegovina', 'HR': 'Croatia',
  'ME': 'Montenegro', 'RS': 'Serbia', 'MK': 'North Macedonia', 'SI': 'Slovenia',
  'SK': 'Slovakia', 'UA': 'Ukraine', 'BY': 'Belarus', 'MD': 'Moldova',
  'LT': 'Lithuania', 'LV': 'Latvia', 'EE': 'Estonia', 'IS': 'Iceland',
  'LU': 'Luxembourg', 'MT': 'Malta', 'CY': 'Cyprus', 'PS': 'Palestine',
  'AM': 'Armenia', 'AZ': 'Azerbaijan', 'GE': 'Georgia', 'AD': 'Andorra',
  'MC': 'Monaco', 'LI': 'Liechtenstein', 'SM': 'San Marino', 'VA': 'Vatican City'
};

// IPTV Countries list - 250+ quốc gia với Mã Quốc Gia (English) + Cờ
router.get('/iptv/countries', async (req, res) => {
  try {
    let countryList = [];
    try {
      const resp = await fetch('https://iptv-org.github.io/api/countries.json', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000)
      });
      if (resp.ok) {
        const data = await resp.json();
        countryList = data.map(c => ({
          code: c.code.toUpperCase(),
          name: c.name,
          flag: (c.flag && !c.flag.includes('?')) ? c.flag : getCountryFlag(c.code)
        }));
      }
    } catch (e) {
      console.log('[IPTV] Lỗi fetch countries API, dùng fallback:', e.message);
    }

    if (!countryList.length) {
      countryList = Object.entries(countryNames).map(([code, name]) => ({
        code,
        name,
        flag: getCountryFlag(code)
      }));
    }

    // Ghim VN lên đầu, sau đó sắp xếp theo Tên Quốc Gia (A-Z)
    countryList.sort((a, b) => {
      if (a.code === 'VN') return -1;
      if (b.code === 'VN') return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ success: true, count: countryList.length, countries: countryList });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ------------------- OFFICE API: DOCX / PPTX / PDF -------------------

// POST /api/office/generate-docx - Tạo file Word từ text (Markdown -> DOCX)
// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE FREE: Xem YouTube không quảng cáo — như Premium free
// ─────────────────────────────────────────────────────────────────────────────
// 20/9/2026: engine đã đổi sang youtube-dl-exec (npm, binary yt-dlp tự tải lúc
// npm install) — KHÔNG cần Python nữa. Sửa lỗi "YouTube chết trên Render free".
router.get('/youtube/status', authMiddleware, async (req, res) => {
  try {
    const st = await ytdlp.getStatus();
    res.json({
      success: true,
      ...st,
      ffmpegPath: ffmpegPath || null,
      note: !st.ready ? 'Binary yt-dlp chưa tải (npm install lại để postinstall tải binary).' : undefined,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/youtube/search', authMiddleware, async (req, res) => {
  const { q, limit } = req.query;
  if (!q) return res.status(400).json({ error: 'Thiếu từ khóa (q)' });
  try {
    const videos = await searchVideos(q, parseInt(limit, 10) || 12);
    res.json({ success: true, videos });
  } catch (e) {
    console.error('[YouTube] Search error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/youtube/stream', authMiddleware, async (req, res) => {
  const { url } = req.query;
  if (!url || !isValidYouTubeUrl(url)) return res.status(400).json({ success: false, error: 'URL/ID video không hợp lệ (chỉ hỗ trợ YouTube).' });
  try {
    const info = await getVideoStream(url);
    res.json({ success: true, ...info });
  } catch (e) {
    console.error('[YouTube] Stream error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Proxy stream video (chống CORS + SSRF) — copy pattern từ iptv/proxy
router.get('/youtube/proxy', rateLimit({ windowMs: 60000, max: 120 }), proxyAuth, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(url);
    // P2-18: check async (literal + DNS resolve) thay vì isPrivateHostname sync
    const check = await assertPublicUrlAsync(targetUrl);
    if (!check.ok) {
      const code = (check.reason === 'URL không hợp lệ' || check.reason === 'Chỉ cho phép http/https') ? 400 : 403;
      return res.status(code).json({ error: check.reason });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }

  try {
    let effectiveUrl = targetUrl;
    let upstream;
    for (let hop = 0; hop <= 5; hop++) {
      upstream = await fetch(effectiveUrl, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Referer': 'https://www.youtube.com/',
          'Origin': 'https://www.youtube.com',
        },
        signal: AbortSignal.timeout(15000)
      });
      if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
        const nextUrl = new URL(upstream.headers.get('location'), effectiveUrl).toString();
        const hopCheck = await assertPublicUrlAsync(nextUrl);
        if (!hopCheck.ok) {
          return res.status(403).json({ error: 'Internal network access is not allowed (redirect)' });
        }
        effectiveUrl = nextUrl;
        continue;
      }
      break;
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Content-Type', contentType);
    res.status(upstream.status);

    const buffer = await upstream.arrayBuffer();
    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[YouTube Proxy] Error:', err.message);
    return res.status(502).json({ error: 'Proxy upstream error: ' + err.message });
  }
});

// TÓM TẮT VIDEO AI: tải audio → Groq Whisper (STT) → Groq LLM → Markdown
// ─────────────────────────────────────────────────────────────────────────────
// Tóm tắt một video YouTube chỉ bằng 1 câu hỏi. Dây chuyền:
//   yt-dlp (audio mp3) → Groq whisper-large-v3 (transcript) → llama-3.3-70b (tóm tắt VN)
// TÓM TẮT VIDEO AI: tải audio → STT (Groq Whisper → fallback Gemini) → LLM (Groq → fallback Gemini)
// ─────────────────────────────────────────────────────────────────────────────
// Tóm tắt một video YouTube chỉ bằng 1 câu hỏi. Dây chuyền:
//   yt-dlp (audio mp3 ≤10 phút) → Groq whisper-large-v3 / Gemini (transcript) → LLM (tóm tắt VN)
// Chỉ cho phép URL YouTube hợp lệ — chặn file:// (đọc file cục bộ!), SSRF, host nội bộ
function isValidYouTubeUrl(url) {
  const s = String(url || '').trim();
  if (!s) return false;
  // Video ID thuần (11 ký tự) — dùng phổ biến trong app
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return true;
  let u;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return false;
  if (isPrivateHostname(u.hostname)) return false;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') {
    return /^\/[A-Za-z0-9_-]{11}/.test(u.pathname);
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    return /^\/(watch|shorts|live|embed)/.test(u.pathname);
  }
  return false;
}

function buildSummaryPrompt(text) {
  return `Bạn là chuyên gia tóm tắt video chuyên nghiệp. Dưới đây là transcript (lời thoại) của một video YouTube. Hãy tóm tắt bằng TIẾNG VIỆT theo đúng định dạng Markdown sau (chỉ trả nội dung, không thêm lời dẫn):

# 📝 Tóm tắt video

## 🎯 Ý chính
- <3-5 gạch đầu dòng nêu nội dung cốt lõi>

## 📌 Điểm nổi bật
- <các thông tin/quan điểm quan trọng>

## 💡 Kết luận / Bài học
- <kết luận rút ra từ video>

Transcript:
"""
${text.slice(0, 20000)}
"""`;
}

// STT qua Groq Whisper (có timeout 90s — tránh treo vô hạn khi Groq bận)
async function transcribeWithGroq(groq, audioPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const transcription = await groq.audio.transcriptions.create({
      file: await Groq.toFile(
        fs.createReadStream(audioPath),
        path.basename(audioPath),
        { type: 'audio/mpeg' }
      ),
      model: 'whisper-large-v3',
      response_format: 'verbose_json',
    }, { signal: controller.signal });
    return {
      text: String(transcription?.text || '').trim(),
      segments: Array.isArray(transcription?.segments)
        ? transcription.segments.map(s => ({
            start: Number(s.start || 0),
            end: Number(s.end || 0),
            text: String(s.text || '').trim()
          }))
        : []
    };
  } finally {
    clearTimeout(timer);
  }
}

// Chuyển segments -> nội dung file SRT (phụ đề timestamp chuẩn)
function segmentsToSrt(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  const fmt = (sec) => {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), secs = s % 60;
    const ms = Math.floor((sec - Math.floor(sec)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };
  return segments.map((seg, i) => {
    const text = (seg.text || '').trim();
    if (!text) return null;
    return `${i + 1}\n${fmt(seg.start)} --> ${fmt(seg.end)}\n${text}`;
  }).filter(Boolean).join('\n\n');
}

// STT qua Gemini (fallback khi Groq lỗi/hết quota)
async function transcribeWithGemini(genAI, audioPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const b64 = fs.readFileSync(audioPath).toString('base64');
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'audio/mpeg', data: b64 } },
          { text: 'Hãy chuyển toàn bộ lời thoại trong audio này thành văn bản. Chỉ trả về văn bản lời thoại, không thêm gì khác.' }
        ]
      }]
    }, { signal: controller.signal });
    return String(result.response.text() || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

// Tóm tắt bằng Groq llama (có timeout)
async function summarizeWithGroq(groq, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: buildSummaryPrompt(text) }],
      temperature: 0.4,
      max_tokens: 1800,
    }, { signal: controller.signal });
    return String(res?.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    console.error('[YouTube] Groq LLM summarize error:', e.message);
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// Tóm tắt bằng Gemini (fallback)
async function summarizeWithGemini(genAI, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(buildSummaryPrompt(text), { signal: controller.signal });
    return String(result.response.text() || '').trim();
  } catch (e) {
    console.error('[YouTube] Gemini LLM summarize error:', e.message);
    return '';
  } finally {
    clearTimeout(timer);
  }
}

router.post('/youtube/summarize', authMiddleware, async (req, res) => {
  const { url } = req.body || {};
  if (!url || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ success: false, error: 'URL/ID video không hợp lệ (chỉ hỗ trợ YouTube).' });
  }

  let audioPath = null;
  try {
    // Tên file duy nhất — tránh đụng nhau giữa 2 request đồng thời
    const outPath = path.join(tempDir, `ytsum_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const dl = await downloadAudio(url, outPath);
    audioPath = dl && dl.file;

    if (!audioPath || !fs.existsSync(audioPath)) {
      return res.status(500).json({ success: false, error: 'Không tải được audio của video. Thử video khác.' });
    }

    const groq = await getGroqClient();
    if (!groq) {
      return res.status(503).json({
        success: false,
        error: 'CHUA_CO_KEY',
        message: 'Cần GROQ_API_KEY trong bảng khoa_api để dùng Tóm tắt AI.'
      });
    }

    // ── Bước 1: Nhận diện giọng nói (Groq → fallback Gemini) ──
    let transcript = '';
    let sttSource = '';
    let srt = '';
    try {
      const groqRes = await transcribeWithGroq(groq, audioPath);
      transcript = groqRes.text;
      srt = segmentsToSrt(groqRes.segments);
      sttSource = 'groq';
    } catch (e) {
      console.log('[YouTube] Groq STT fail, fallback Gemini:', e.message);
    }
    if (!transcript) {
      const gemini = await getGeminiClient(); // lấy lazily — chỉ khi cần fallback
      if (gemini) {
        try {
          transcript = await transcribeWithGemini(gemini, audioPath);
          sttSource = 'gemini';
        } catch (e2) {
          console.error('[YouTube] Gemini STT fail:', e2.message);
        }
      }
    }
    if (!transcript) {
      return res.status(502).json({ success: false, error: 'Không nhận diện được giọng nói (cả Groq lẫn Gemini đều lỗi). Thử video khác.' });
    }

    // ── Bước 2: Tóm tắt bằng LLM (Groq → fallback Gemini) ──
    // P1-11: summarizeWithGroq là async → phải await, bọc try/catch, validate string
    let summary = '';
    try {
      summary = await summarizeWithGroq(groq, transcript);
    } catch (e) {
      console.error('[YouTube] Groq summarize throw:', e.message);
      summary = '';
    }
    if (typeof summary !== 'string') summary = '';
    if (!summary) {
      try {
        const gemini = await getGeminiClient();
        if (gemini) summary = await summarizeWithGemini(gemini, transcript);
      } catch (e) {
        console.error('[YouTube] Gemini summarize throw:', e.message);
      }
      if (typeof summary !== 'string') summary = '';
    }

    res.json({ success: true, title: dl?.title || '', transcript, summary, srt, stt_source: sttSource });
  } catch (err) {
    console.error('[YouTube] Summarize error:', err.message);
    res.status(500).json({ success: false, error: 'Lỗi tóm tắt video. Vui lòng thử lại.' });
  } finally {
    // Dọn đúng file của request này (không đụng file của request khác)
    if (audioPath && fs.existsSync(audioPath)) {
      try { fs.unlinkSync(audioPath); } catch (e) { /* ignore */ }
    }
  }
});

router.post('/office/generate-docx', authMiddleware, async (req, res) => {
  const { title, content } = req.body;
  if (!content) return res.status(400).json({ error: 'Thiếu nội dung văn bản' });
  if (content.length > 50000) return res.status(400).json({ error: 'Nội dung quá dài (tối đa 50,000 ký tự)' });

  try {

    // Phân tích content thành các đoạn
    const lines = content.split('\n').filter(l => l.trim());
    const children = [];

    // Tiêu đề chính
    if (title) {
      children.push(
        new Paragraph({
          text: title,
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6 } }
        })
      );
    }

    // Xử lý từng dòng
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Phát hiện table (dòng có |)
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const cells = trimmed.split('|').filter(c => c.trim());
        if (cells.length > 1) {
          children.push(
            new Table({
              rows: [
                new TableRow({
                  children: cells.map(c => new TableCell({
                    children: [new Paragraph({ text: c.trim(), alignment: AlignmentType.CENTER })],
                    width: { size: 100 / cells.length, type: WidthType.PERCENTAGE },
                    borders: { top: { style: BorderStyle.SINGLE }, bottom: { style: BorderStyle.SINGLE }, left: { style: BorderStyle.SINGLE }, right: { style: BorderStyle.SINGLE } }
                  }))
                })
              ]
            })
          );
          continue;
        }
      }

      // Phát hiện bullet (- hoặc *)
      if (trimmed.match(/^[-*]\s/)) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: trimmed.replace(/^[-*]\s*/, ''), size: 22 })],
            bullet: { level: 0 },
            spacing: { after: 100 }
          })
        );
        continue;
      }

      // Phát hiện numbered (1., 2.,...)
      if (trimmed.match(/^\d+\.\s/)) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: trimmed.replace(/^\d+\.\s*/, ''), size: 22 })],
            numbering: { reference: 'default-numbering', level: 0 },
            spacing: { after: 100 }
          })
        );
        continue;
      }

      // Phát hiện heading (# ## ###)
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const levelMap = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6 };
        children.push(
          new Paragraph({
            text: headingMatch[2],
            heading: levelMap[level] || HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          })
        );
        continue;
      }

      // Văn bản thường
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed, size: 22 })],
          spacing: { after: 120 },
          alignment: AlignmentType.JUSTIFIED
        })
      );
    }

    const doc = new Document({
      title: title || 'Tài liệu AI Rexi',
      description: 'Được tạo bởi AI Rexi Office Generator',
      styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
      sections: [{ children, properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } } }]
    });

    const buffer = await Packer.toBuffer(doc);
    const base64 = buffer.toString('base64');

    res.json({
      success: true,
      data: base64,
      format: 'docx',
      filename: `${(title || 'Tai_lieu_AIRexi').replace(/[^a-zA-Z0-9_]/g, '_')}.docx`,
      size: buffer.length
    });
  } catch (err) {
    console.error('[Office] DOCX Error:', err.message);
    res.status(500).json({ success: false, error: 'Lỗi tạo DOCX: ' + err.message });
  }
});

// POST /api/office/generate-pptx - Tạo file PowerPoint (pptxgenjs)
router.post('/office/generate-pptx', authMiddleware, async (req, res) => {
  const { title, slides } = req.body;
  if (!slides || !Array.isArray(slides) || slides.length === 0 || slides.length > 50) {
    return res.status(400).json({ error: 'Thiếu danh sách slide (slides: [{title, content}])' });
  }

  try {
    const pres = new PptxGenJS();

    // Slide 1: Tiêu đề
    const slide1 = pres.addSlide();
    slide1.addText(title || 'Bài thuyết trình AI Rexi', { x: 0.5, y: 1, w: 9, h: 2, fontSize: 36, color: 'FFFFFF', bold: true, align: 'center' });
    slide1.addText('Được tạo bởi AI Rexi Office Generator', { x: 0.5, y: 3.2, w: 9, h: 0.8, fontSize: 16, color: 'AAAAAA', align: 'center' });
    slide1.background = { color: '1E1E2E' };

    // Các slide nội dung
    for (const slide of slides) {
      const s = pres.addSlide();
      s.background = { color: '1E1E2E' };
      
      // Tiêu đề slide
      s.addText(slide.title || '', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, color: '89B4FA', bold: true });
      
      // Nội dung
      const contentLines = (slide.content || '').split('\n').filter(l => l.trim());
      let yPos = 1.4;
      for (const line of contentLines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ')) {
          s.addText('• ' + trimmed.substring(2), { x: 0.7, y: yPos, w: 8.5, h: 0.4, fontSize: 16, color: 'CDD6F4' });
        } else {
          s.addText(trimmed, { x: 0.5, y: yPos, w: 8.8, h: 0.5, fontSize: 16, color: 'CDD6F4' });
        }
        yPos += 0.45;
      }
    }

    const buffer = await pres.write({ outputType: 'nodebuffer' });
    const base64 = buffer.toString('base64');

    res.json({
      success: true,
      data: base64,
      format: 'pptx',
      filename: `${(title || 'Bai_thuyet_trinh_AIRexi').replace(/[^a-zA-Z0-9_]/g, '_')}.pptx`,
      slides_count: slides.length + 1,
      size: buffer.length
    });
  } catch (err) {
    console.error('[Office] PPTX Error:', err.message);
    res.status(500).json({ success: false, error: 'Lỗi tạo PPTX: ' + err.message });
  }
});

// POST /api/office/process-pdf - Xử lý PDF (merge, split, info)
router.post('/office/process-pdf', authMiddleware, async (req, res) => {
  const { action, base64_pdf } = req.body;
  if (!base64_pdf) return res.status(400).json({ error: 'Thiếu file PDF (base64_pdf)' });

  try {
    const pdfBytes = Buffer.from(base64_pdf, 'base64');
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    if (action === 'info') {
      res.json({
        success: true,
        action: 'info',
        pages: doc.getPageCount(),
        title: doc.getTitle() || 'Untitled',
        author: doc.getAuthor() || 'Unknown',
        subject: doc.getSubject() || '',
        keywords: doc.getKeywords() || '',
        creator: doc.getCreator() || 'AI Rexi PDF Processor'
      });
    } else if (action === 'extract' || action === 'extract-text') {
      // Trích xuất toàn bộ nội dung chữ trong PDF (chạy CPU, không cần GPU)
      const pdf = new PDFParse({ data: pdfBytes });
      const parsed = await pdf.getText({});
      await pdf.destroy();
      let fullText = (parsed.text || '').trim();
      let ocrUsed = false;
      // Fallback OCR: PDF ảnh/scan (pdf-parse trả rỗng) -> gọi LightOnOCR local (port 8099)
      if (fullText.length < 20) {
        try {
          // Dùng FormData + Blob built-in của Node (fetch xử lý native, tự set boundary)
          const form = new FormData();
          form.append('file', new Blob([Buffer.from(pdfBytes)], { type: 'application/pdf' }), 'scan.pdf');
          const ocrRes = await fetch('http://127.0.0.1:8099/ocr', {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(120000) // tránh treo vĩnh viễn khi OCR server chậm/chết
          });
          if (ocrRes.ok) {
            const ocrJson = await ocrRes.json();
            if (ocrJson.text && ocrJson.text.trim().length > fullText.length) {
              fullText = ocrJson.text.trim();
              ocrUsed = true;
            }
          }
        } catch (ocrErr) {
          console.warn('[Office] OCR fallback unavailable:', ocrErr.message);
        }
      }
      const maxChars = parseInt(req.body.max_chars, 10) || 50000;
      const truncated = fullText.length > maxChars;
      res.json({
        success: true,
        action: 'extract',
        pages: doc.getPageCount(),
        chars: fullText.length,
        truncated,
        ocr_used: ocrUsed,
        text: truncated ? fullText.substring(0, maxChars) : fullText
      });
    } else {
      res.json({
        success: false,
        action: action || 'unknown',
        error: `Hành động '${action || 'unknown'}' chưa được hỗ trợ. Hỗ trợ: info, extract`
      });
    }
  } catch (err) {
    console.error('[Office] PDF Error:', err.message);
    res.status(500).json({ success: false, error: 'Lỗi xử lý PDF: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LIVE CAPTION: Nhận diện giọng nói từ video bằng Groq Whisper + Dịch Tiếng Việt
// ─────────────────────────────────────────────────────────────────────────────
// LIVE CAPTION: Nhận diện giọng nói từ video bằng Groq Whisper + Dịch Tiếng Việt
// ─────────────────────────────────────────────────────────────────────────────
const tempDir = path.join(__dirname, '..', '..', 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

// I5: dọn file temp cũ >1h — server restart/crash giữa render/upload làm file kẹt lại,
// RAM 512MB trên Render không đủ chứa rác tích tụ (ytdl audio + render mp4 + upload)
function cleanupOldTemp() {
  const dirs = [tempDir, path.join(tempDir, 'video')];
  const now = Date.now();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (e) { continue; }
    for (const name of entries) {
      const p = path.join(dir, name);
      try {
        const st = fs.statSync(p);
        const isRecent = now - st.mtimeMs < 60 * 60 * 1000;
        if (!isRecent) fs.rmSync(p, { recursive: true, force: true });
      } catch (e) { /* file biến mất giữa chừng — bỏ qua */ }
    }
  }
}
cleanupOldTemp();
setInterval(cleanupOldTemp, 60 * 60 * 1000).unref();

router.post('/transcribe', authMiddleware, upload.single('audio'), async (req, res) => {
  const audioFile = req.file;
  const srcLang = req.body.lang || 'auto';

  if (!audioFile) {
    return res.status(400).json({ success: false, error: 'Không nhận được file audio.' });
  }
  const tmpPath = audioFile.path;

  try {
    const groq = await getGroqClient();
    if (!groq) {
      return res.status(503).json({
        success: false,
        error: 'CHUA_CO_KEY',
        message: 'Cần thêm GROQ_API_KEY vào file .env hoặc bảng khoa_api để dùng tính năng Phụ Đề AI. Lấy key miễn phí tại: https://console.groq.com'
      });
    }

    // Gọi Groq Whisper API để nhận diện giọng nói (+ timeout 60s — P2-20(5))
    // Sử dụng FormData để đảm bảo Groq nhận đúng file với metadata
    // Groq SDK 1.x expects an object payload, not a `form-data` instance.
    // Convert the Multer file stream with Groq.toFile() so the SDK can build
    // a compatible multipart request (this also supports browser WebM chunks).
    const transcription = await withTimeout(groq.audio.transcriptions.create({
      file: await Groq.toFile(
        fs.createReadStream(tmpPath),
        path.basename(tmpPath),
        { type: audioFile.mimetype || 'application/octet-stream' }
      ),
      model: 'whisper-large-v3',
      response_format: 'json',
      ...(srcLang !== 'auto' ? { language: srcLang } : {})
    }), 60000, 'Nhận diện giọng nói');

    const originalText = typeof transcription === 'string'
      ? transcription.trim()
      : String(transcription?.text || '').trim();
    if (!originalText) {
      return res.json({ success: true, text: '', original: '' });
    }

    // Dịch sang Tiếng Việt qua Google Translate (miễn phí, không cần key)
    let vietnameseText = originalText;
    try {
      const translateRes = await fetch(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${srcLang === 'auto' ? 'auto' : srcLang}&tl=vi&dt=t&q=${encodeURIComponent(originalText)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      const translateData = await translateRes.json();
      if (translateData?.[0]?.[0]?.[0]) {
        vietnameseText = translateData[0].map(s => s?.[0] || '').join('');
      }
    } catch (transErr) {
      console.log('[Transcribe] Translate fallback error:', transErr.message);
    }

    res.json({ success: true, text: vietnameseText, original: originalText });

  } catch (err) {
    console.error('[Transcribe] Error:', err.message);
    const isTimeout = /quá thời gian/i.test(err.message || '');
    res.status(isTimeout ? 504 : 500).json({ success: false, error: 'Lỗi nhận diện giọng nói: ' + err.message });
  } finally {
    // P2-20(5): xóa file temp TRONG finally — mọi đường return/throw đều dọn
    try { if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
  }
});

// ========== BROWSER STREAM ROUTES ==========
const browserStream = require('../services/browserStream');

router.post('/browser/launch', authMiddleware, async (req, res) => {
  try {
    const { url } = req.body;
    // P2-18: chặn URL nội bộ kể cả khi launch kèm URL (browserStream.navigate không tự check)
    if (url && url !== 'about:blank') {
      const check = await assertPublicUrlAsync(url);
      if (!check.ok) return res.status(403).json({ success: false, error: check.reason });
    }
    const result = await browserStream.launch({ url: url || 'about:blank' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/browser/navigate', authMiddleware, async (req, res) => {
  try {
    const { url } = req.body;
    // P2-18: browserStream.navigate() không check SSRF → check ở route (đã có auth)
    const check = await assertPublicUrlAsync(url);
    if (!check.ok) return res.status(403).json({ success: false, error: check.reason });
    const result = await browserStream.navigate(url);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/browser/click', authMiddleware, async (req, res) => {
  try {
    const { x, y } = req.body;
    const result = await browserStream.click(x, y);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/browser/type', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    const result = await browserStream.type(text);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/browser/key', authMiddleware, async (req, res) => {
  try {
    const { key } = req.body;
    const result = await browserStream.key(key);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/browser/scroll', authMiddleware, async (req, res) => {
  try {
    const { deltaX, deltaY } = req.body;
    const result = await browserStream.scroll(deltaX, deltaY);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/browser/close', authMiddleware, async (req, res) => {
  try {
    await browserStream.close();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/browser/status', authMiddleware, (req, res) => {
  res.json(browserStream.getStatus());
});

// POST: AI Action (Stagehand) — điều khiển browser bằng ngôn ngữ tự nhiên
router.post('/browser/act', authMiddleware, async (req, res) => {
  try {
    const { instruction } = req.body;
    if (!instruction || !instruction.trim()) {
      return res.status(400).json({ success: false, error: 'Thiếu chỉ dẫn (instruction)' });
    }
    const result = await browserStream.act(instruction);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HYPERFRAMES VIDEO RENDERER — HTML → MP4 via HyperFrames CLI
// ─────────────────────────────────────────────────────────────────────────────
const { execSync, spawn } = require('child_process');
const { safeExecSync } = require('../utils/safeExec');
const ffmpegPath = require('ffmpeg-static');

// Temp dir for video renders
const videoTempDir = path.join(__dirname, '..', '..', 'temp', 'video');
if (!fs.existsSync(videoTempDir)) fs.mkdirSync(videoTempDir, { recursive: true });

// GET: Check HyperFrames availability
router.get('/video/status', authMiddleware, async (req, res) => {
  try {
    // Check ffmpeg
    const ffmpegOk = ffmpegPath && fs.existsSync(ffmpegPath);
    // Check hyperframes CLI
    let hfVersion = null;
    try {
      hfVersion = safeExecSync('npx hyperframes info --json', { timeout: 15000, encoding: 'utf8' });
    } catch {}
    // Check Chrome/Puppeteer
    let chromeOk = false;
    try {
      const puppeteerCache = path.join(process.env.USERPROFILE || '', '.cache', 'puppeteer');
      chromeOk = fs.existsSync(puppeteerCache);
    } catch {}

    // QA 17/9: engine render chính giờ là Playwright + ffmpeg (videoRenderer).
    // Kiểm tra thật bằng cách launch browser thử, không đoán theo thư mục cache.
    let playwrightOk = false;
    let playwrightBrowser = null;
    let playwrightError = null;
    if (videoRenderer.isAvailable()) {
      try {
        const probe = await videoRenderer.probeBrowser();
        playwrightOk = true;
        playwrightBrowser = probe.label;
      } catch (e) { playwrightError = String(e.message || e).slice(0, 200); }
    }
    res.json({
      success: true,
      engine: playwrightOk ? 'playwright' : 'hyperframes',
      ffmpeg: ffmpegOk,
      ffmpegPath: ffmpegPath || null,
      hyperframes: !!hfVersion,
      chrome: chromeOk,
      playwright: playwrightOk,
      playwrightBrowser,
      playwrightError,
      ready: ffmpegOk && playwrightOk
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// POST: Render HTML composition → MP4
// P2-20(6): rate-limit 3 render/giờ/user (sau auth để key theo user) + giới hạn
// duration ≤ 30s + width ≤ 1920 (chống đốt CPU/RAM bằng job khổng lồ).
router.post('/video/render', authMiddleware, rateLimit({ windowMs: 3600000, max: 3, message: 'Bạn đã render 3 video trong giờ này. Vui lòng chờ thêm rồi thử lại.' }), async (req, res) => {
  const { html, width, height, fps, duration } = req.body;
  if (!html || !html.trim()) {
    return res.status(400).json({ error: 'Thiếu nội dung HTML composition' });
  }
  if (html.length > 500000) {
    return res.status(400).json({ error: 'HTML quá dài (tối đa 500KB)' });
  }
  const compWidth = Math.min(Math.max(parseInt(width, 10) || 1920, 320), 1920);
  const compHeight = Math.min(Math.max(parseInt(height, 10) || 1080, 240), 1080);
  const compDuration = Math.min(Math.max(parseFloat(duration) || 5, 1), 30);

  const renderId = `render_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const projectDir = path.join(videoTempDir, renderId);
  const outputFile = path.join(projectDir, 'output.mp4');
  const fpsArgMain = Math.min(Math.max(parseInt(fps, 10) || 30, 1), 60);

  // ─── ĐƯỜNG CHÍNH (QA 17/9): renderer Playwright + ffmpeg của mình ───
  // `hyperframes render` cần browser riêng và chết ở phase capture (Network.enable timeout).
  if (videoRenderer.isAvailable()) {
    try {
      const out = await videoRenderer.renderComposition({
        html, width: compWidth, height: compHeight, fps: fpsArgMain, duration: compDuration,
      });
      console.log(`[Video Render] playwright OK — ${out.frames} frames / ${(out.ms / 1000).toFixed(1)}s (${out.browser})`);
      return res.json({
        success: true,
        video: out.buffer.toString('base64'),
        format: 'mp4',
        size: out.buffer.length,
        width: compWidth,
        height: compHeight,
        duration: compDuration,
        fps: fpsArgMain,
        frames: out.frames,
        renderMs: out.ms,
        engine: 'playwright',
        renderId,
      });
    } catch (eRender) {
      console.error('[Video Render] playwright engine lỗi → thử hyperframes:', eRender.message);
    }
  }

  try {
    // Create project directory
    fs.mkdirSync(projectDir, { recursive: true });

    // Write index.html composition (HyperFrames compatible)
    // (compWidth/compHeight/compDuration đã clamp ở đầu route — P2-20(6))
    const compId = 'main';
    // QA 17/9: hyperframes lint báo missing_gsap_script vì <script src> của template
    // nằm trong <body>; đồng thời timeline_id_mismatch vì template tự đăng ký
    // window.__timelines['<id-template>'] trong khi composition id là 'main'.
    // → hoist script CDN (https) lên <head> và gán lại timeline cho 'main'.
    let bodyHtml = html;
    const hoisted = [];
    bodyHtml = html.replace(/<script\s+src="(https:\/\/[^"\s>]+)"\s*>\s*<\/script>/gi, (m, src) => {
      hoisted.push(src);
      return '';
    });
    const headScripts = hoisted.map(src => `  <script src="${src}"></script>`).join('\n');
    const compositionHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
${headScripts}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: ${compWidth}px; height: ${compHeight}px; overflow: hidden; background: #000; }
  </style>
</head>
<body>
  <div data-composition-id="${compId}" data-width="${compWidth}" data-height="${compHeight}" data-start="0" data-duration="${compDuration}">
    ${bodyHtml}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    (function () {
      var own = Object.keys(window.__timelines).filter(function (k) { return k !== '${compId}'; });
      window.__timelines['${compId}'] = own.length ? window.__timelines[own[0]] : { compositions: [] };
    })();
  </script>
</body>
</html>`;
    fs.writeFileSync(path.join(projectDir, 'index.html'), compositionHtml, 'utf8');

    // Build render command
    // fps từ client phải là số nguyên 1-60 (spawn shell:true nối chuỗi → chặn command injection)
    const fpsArg = Math.min(Math.max(parseInt(fps, 10) || 30, 1), 60);

    // Set FFmpeg/FFprobe path in env for hyperframes
    const env = { ...process.env };
    // FIX PROD: bỏ đường dẫn Windows cứng — dùng ffmpeg-static (npm) + path.delimiter (; trên Windows, : trên Linux/Render)
    const ffmpegDir = ffmpegPath ? path.dirname(ffmpegPath) : '';
    env.FFMPEG_PATH = ffmpegPath || '';
    env.PATH = ffmpegDir ? `${ffmpegDir}${path.delimiter}${env.PATH || ''}` : env.PATH;

    // Run hyperframes render (dimensions set in HTML, not CLI flags)
    const args = [
      'hyperframes', 'render',
      projectDir,
      '-o', outputFile,
      '--fps', String(fpsArg),
    ];

    const result = await new Promise((resolve, reject) => {
      const proc = spawn('npx', args, {
        cwd: projectDir,
        env,
        timeout: 120000, // 2 minutes max
        shell: true
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputFile)) {
          resolve({ success: true, outputFile });
        } else {
          reject(new Error(`Render failed (code ${code}): ${stderr || stdout}`));
        }
      });
      proc.on('error', (err) => {
        reject(new Error(`Render error: ${err.message}`));
      });
    });

    // Read output file and return as base64
    if (fs.existsSync(outputFile)) {
      const videoBuffer = fs.readFileSync(outputFile);
      const base64Video = videoBuffer.toString('base64');
      const fileSize = videoBuffer.length;

      // Cleanup project dir
      try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch(e) {}

      res.json({
        success: true,
        video: base64Video,
        format: 'mp4',
        size: fileSize,
        width: compWidth,
        height: compHeight,
        duration: compDuration,
        fps: fpsArg,
        renderId
      });
    } else {
      throw new Error('Output file not found after render');
    }
  } catch (err) {
    // Cleanup on error
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch(e) {}
    console.error('[Video Render] Error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Lỗi render video: ' + err.message,
      note: 'Cần cài FFmpeg và Chrome/Puppeteer. Chạy: npx hyperframes doctor'
    });
  }
});

// POST: Preview HTML composition (return HTML for iframe preview)
router.post('/video/preview', authMiddleware, (req, res) => {
  const { html, width, height } = req.body;
  if (!html) return res.status(400).json({ error: 'Thiếu HTML' });

  const previewHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: ${width || 1920}px; height: ${height || 1080}px; overflow: hidden; background: #000; transform-origin: top left; }
  </style>
</head>
<body>
${html}
</body>
</html>`;

  res.json({ success: true, html: previewHtml, width: width || 1920, height: height || 1080 });
});

// POST: Save composition to workspace for later editing
router.post('/video/save', authMiddleware, (req, res) => {
  const { html, name } = req.body;
  if (!html) return res.status(400).json({ error: 'Thiếu HTML' });

  const safeName = (name || `composition_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  const saveDir = path.join(__dirname, '..', '..', 'temp', 'video', 'compositions');
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

  const filePath = path.join(saveDir, `${safeName}.html`);
  fs.writeFileSync(filePath, html, 'utf8');

  res.json({ success: true, path: filePath, name: safeName });
});


// ─── TẠO ẢNH AI (Gemini Image) ─────────────────────────────────
// ─── Provider ảnh DỰ PHÒNG miễn phí (không cần API key) ───
// QA 17/9: quota Gemini cạn là tính năng tạo ảnh chết hẳn. Pollinations (Flux)
// trả ảnh trực tiếp qua URL, không cần key → dùng làm đường lui cho /generate-image.
async function generateImageFallback(prompt, size = 1024) {
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(String(prompt).slice(0, 800))}?width=${size}&height=${size}&nologo=true&model=flux`;
    const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!r.ok) return { success: false, error: `Provider dự phòng HTTP ${r.status}` };
    const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!mime.startsWith('image/')) return { success: false, error: 'Provider dự phòng không trả ảnh' };
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return { success: false, error: 'Provider dự phòng trả ảnh rỗng' };
    return { success: true, image: `data:${mime};base64,${buf.toString('base64')}`, mimeType: mime, provider: 'pollinations' };
  } catch (e) {
    console.log('[generate-image] fallback error:', e.message);
    return { success: false, error: e.message };
  }
}

router.post('/generate-image', authMiddleware, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.json({ success: false, error: 'Vui lòng nhập mô tả ảnh cần tạo.' });
  }
  const cleanPrompt = prompt.trim().slice(0, 1000);
  try {
    const keyRow = await new Promise((resolve) => {
      db.get("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'gemini'", [], (err, row) => resolve(row));
    });
    // P1-12: key lưu mã hóa — phải decryptKey; key rỗng thì báo chưa cài (không gọi API với ciphertext)
    let gemKey = '';
    try {
      gemKey = keyRow && keyRow.gia_tri_khoa ? decryptKey(keyRow.gia_tri_khoa).trim() : '';
    } catch (e) {
      console.log('[generate-image] decryptKey error:', e.message);
      gemKey = '';
    }
    if (!gemKey) {
      // QA 18/9: không có key Gemini → thử OpenRouter (image free) rồi tới provider miễn phí
      const or1 = await generateImageOpenRouter(cleanPrompt);
      if (or1.success) return res.json(or1);
      const fb = await generateImageFallback(cleanPrompt);
      return res.json(fb);
    }
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(gemKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: cleanPrompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] }
      }),
      signal: AbortSignal.timeout(60000)
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = data.error?.message || ('HTTP ' + resp.status);
      // QA 17/9: 429 = hết quota key free → tự chuyển provider ảnh miễn phí thay vì
      // trả lỗi cứng (trước đây tính năng tạo ảnh chết hẳn khi quota Gemini cạn).
      if (resp.status === 429 || resp.status === 503) {
        // QA 18/9: hết quota Gemini → thử OpenRouter (image free) trước khi rơi provider miễn phí
        const or2 = await generateImageOpenRouter(cleanPrompt);
        if (or2.success) return res.json(or2);
        const fb = await generateImageFallback(cleanPrompt);
        if (fb.success) return res.json(fb);
        return res.json({ success: false, error: '⚠️ Gemini hết quota, OpenRouter và provider dự phòng cũng lỗi (OR: ' + String(or2.error || '').slice(0, 80) + ' | FB: ' + String(fb.error || '').slice(0, 80) + ')' });
      }
      const friendly = resp.status === 400
        ? '⚠️ Gemini từ chối nội dung này (bộ lọc an toàn). Vui lòng mô tả khác.'
        : (resp.status === 429 ? '⚠️ Gemini đang TẠM HẾT QUOTA (rate limit). Vui lòng thử lại sau vài phút.' : 'Lỗi Gemini: ' + msg);
      return res.json({ success: false, error: friendly });
    }
    const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (part && part.inlineData && part.inlineData.data) {
      const mime = part.inlineData.mimeType || 'image/png';
      return res.json({ success: true, image: `data:${mime};base64,${part.inlineData.data}`, mimeType: mime, provider: 'gemini' });
    }
    // Gemini trả rỗng (bộ lọc/khoá model) → thử OpenRouter rồi tới đường dự phòng
    const orEmpty = await generateImageOpenRouter(cleanPrompt);
    if (orEmpty.success) return res.json(orEmpty);
    const fbEmpty = await generateImageFallback(cleanPrompt);
    return res.json(fbEmpty);
  } catch (e) {
    console.log('[generate-image] ERROR:', e.message);
    const orErr = await generateImageOpenRouter(cleanPrompt);
    if (orErr.success) return res.json(orErr);
    const fb = await generateImageFallback(cleanPrompt);
    if (fb.success) return res.json(fb);
    return res.json({ success: false, error: 'Lỗi kết nối Gemini: ' + e.message });
  }
});


// ========== RAG — ĐỌC & HIỂU FILE (PDF/Word/TXT) ==========
// Upload file → trích xuất text → vector hóa → AI trả lời dựa trên nội dung file
const ragUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

router.post('/documents/upload', authMiddleware, ragUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Vui lòng chọn file để upload.' });
    const ext = (req.file.originalname.match(/\.(txt|md|csv|json|js|py|jsx|ts|tsx|html|css|sql|sh|xml|yml|yaml|ini|log|xlsx|pdf|docx)$/i) || [])[1];
    if (!ext) return res.status(400).json({ error: 'Chỉ hỗ trợ: TXT, MD, CSV, JSON, XLSX, PDF, DOCX, code files... Vui lòng chọn file khác.' });
    const result = await ragService.saveDocument(req.user.id, req.file.originalname, req.file.buffer);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true, ...result });
  } catch (e) {
    console.log('[RAG] upload error:', e.message);
    res.status(500).json({ error: 'Lỗi xử lý file: ' + e.message });
  }
});

router.get('/documents', authMiddleware, async (req, res) => {
  try {
    const docs = await ragService.listDocuments(req.user.id);
    res.json({ success: true, documents: docs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/documents/:id', authMiddleware, async (req, res) => {
  try {
    const ok = await ragService.deleteDocument(req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Không tìm thấy tài liệu.' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== CHẠY CODE TRONG CHAT (sandbox, ADMIN ONLY — P0-01) ==========
router.post('/exec-code', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { language, code } = req.body;
    if (!code || !String(code).trim()) return res.status(400).json({ error: 'Code trống.' });
    const { runCode } = require('../services/codeRunner');
    const result = await runCode(language, code);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi chạy code: ' + e.message });
  }
});

// ========== EXPORT HỘI THOẠI (TXT / DOCX) ==========
router.get('/conversations/:id/export', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    // P1-09: chặn IDOR — chỉ chủ sở hữu (hoặc admin) mới được export
    const ownerErr = await assertConvOwner(id, req);
    if (ownerErr) return res.status(ownerErr.status).json({ error: ownerErr.error });
    const fmt = (req.query.format || 'txt').toLowerCase();
    const conv = await new Promise((resolve) => db.get('SELECT tieu_de FROM cuoc_hoi_thoai WHERE ma_hoi_thoai = ?', [id], (e, r) => resolve(r)));
    const msgs = await new Promise((resolve) => db.all("SELECT vai_tro, noi_dung, ngay_gui FROM tin_nhan WHERE ma_hoi_thoai = ? ORDER BY ngay_gui ASC", [id], (e, r) => resolve(r || [])));
    if (!msgs.length) return res.status(404).json({ error: 'Không có tin nhắn trong hội thoại.' });
    const title = (conv && conv.tieu_de) || 'Hội thoại';
    const lines = msgs.map(m => `[${(m.vai_tro === 'user' ? 'Bạn' : 'Rexi')} - ${(m.ngay_gui || '').substring(0, 19)}]\n${m.noi_dung}\n`);
    const text = `HỘI THOẠI: ${title}\n${'='.repeat(40)}\n\n` + lines.join('\n');
    if (fmt === 'docx') {
      const { Document, Packer, Paragraph } = require('docx');
      const doc = new Document({
        sections: [{
          children: [
            new Paragraph({ text: `HỘI THOẠI: ${title}`, heading: 'Heading1' }),
            ...msgs.map(m => new Paragraph({
              children: [
                { text: (m.vai_tro === 'user' ? '👤 Bạn' : '🤖 Rexi') + ' (' + (m.ngay_gui || '').substring(0, 19) + '):\n', bold: true },
                { text: String(m.noi_dung || '') }
              ]
            }))
          ]
        }]
      });
      const buf = await Packer.toBuffer(doc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="hoi_thoai_${id.substring(0, 8)}.docx"`);
      return res.send(Buffer.from(buf));
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hoi_thoai_${id.substring(0, 8)}.txt"`);
    res.send(text);
  } catch (e) {
    res.status(500).json({ error: 'Lỗi export: ' + e.message });
  }
});

// ========== CHIA SẺ HỘI THOẠI (link) ==========
router.post('/conversations/:id/share', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    // P1-09: chặn IDOR — chỉ chủ sở hữu (hoặc admin) mới được tạo link chia sẻ
    const ownerErr = await assertConvOwner(id, req);
    if (ownerErr) return res.status(ownerErr.status).json({ error: ownerErr.error });
    const crypto = require('crypto');
    const token = crypto.randomBytes(6).toString('hex');
    // P2-20(8): bảng chia_se_hoi_thoai đã tạo ở init-db.js — không CREATE ở đây nữa
    await new Promise((resolve) => db.run('INSERT INTO chia_se_hoi_thoai (ma_chia_se, ma_hoi_thoai) VALUES (?, ?)', [token, id], resolve));
    res.json({ success: true, share_token: token, share_url: `/api/services/share/${token}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Public — xem hội thoại chia sẻ (không cần đăng nhập)
router.get('/share/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const row = await new Promise((resolve) => db.get('SELECT ma_hoi_thoai FROM chia_se_hoi_thoai WHERE ma_chia_se = ?', [token], (e, r) => resolve(r)));
    if (!row) return res.status(404).json({ error: 'Link chia sẻ không tồn tại hoặc đã hết hạn.' });
    const msgs = await new Promise((resolve) => db.all("SELECT vai_tro, noi_dung, ngay_gui FROM tin_nhan WHERE ma_hoi_thoai = ? ORDER BY ngay_gui ASC", [row.ma_hoi_thoai], (e, r) => resolve(r || [])));
    res.json({ success: true, messages: msgs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== THỐNG KÊ CÁ NHÂN ==========
router.get('/stats/me', authMiddleware, async (req, res) => {
  try {
    const uid = req.user ? req.user.id : 'guest';
    const convCount = await new Promise((resolve) => db.get("SELECT COUNT(*) c FROM cuoc_hoi_thoai WHERE ma_nguoi_dung = ?", [uid], (e, r) => resolve(r ? r.c : 0)));
    const msgCount = await new Promise((resolve) => db.get("SELECT COUNT(*) c FROM tin_nhan tn JOIN cuoc_hoi_thoai ch ON ch.ma_hoi_thoai = tn.ma_hoi_thoai WHERE ch.ma_nguoi_dung = ?", [uid], (e, r) => resolve(r ? r.c : 0)));
    const userMsgs = await new Promise((resolve) => db.get("SELECT COUNT(*) c FROM tin_nhan tn JOIN cuoc_hoi_thoai ch ON ch.ma_hoi_thoai = tn.ma_hoi_thoai WHERE ch.ma_nguoi_dung = ? AND tn.vai_tro = 'user'", [uid], (e, r) => resolve(r ? r.c : 0)));
    const aiMsgs = await new Promise((resolve) => db.get("SELECT COUNT(*) c FROM tin_nhan tn JOIN cuoc_hoi_thoai ch ON ch.ma_hoi_thoai = tn.ma_hoi_thoai WHERE ch.ma_nguoi_dung = ? AND tn.vai_tro = 'assistant'", [uid], (e, r) => resolve(r ? r.c : 0)));
    const perDay = await new Promise((resolve) => db.all("SELECT date(tn.ngay_gui) ngay, COUNT(*) c FROM tin_nhan tn JOIN cuoc_hoi_thoai ch ON ch.ma_hoi_thoai = tn.ma_hoi_thoai WHERE ch.ma_nguoi_dung = ? AND tn.vai_tro = 'user' GROUP BY date(tn.ngay_gui) ORDER BY ngay DESC LIMIT 7", [uid], (e, r) => resolve(r || [])));
    res.json({ success: true, stats: { tong_hoi_thoai: convCount, tong_tin_nhan: msgCount, tin_cua_ban: userMsgs, tin_cua_ai: aiMsgs, '7_ngay_gan_nhat': perDay } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== NHẮC VIỆC THÔNG MINH ==========
// P2-20(8): bảng lich_nhac/thong_bao đã tạo ở init-db.js — bỏ IIFE CREATE rải rác.

router.post('/reminders', authMiddleware, async (req, res) => {
  try {
    const { noi_dung, thoi_gian } = req.body;
    if (!noi_dung || !thoi_gian) return res.status(400).json({ error: 'Thiếu nội dung hoặc thời gian nhắc.' });
    const crypto = require('crypto');
    const ma = crypto.randomUUID();
    await new Promise((resolve) => db.run('INSERT INTO lich_nhac (ma_nhac, ma_nguoi_dung, noi_dung, thoi_gian) VALUES (?, ?, ?, ?)', [ma, req.user.id, noi_dung, thoi_gian], resolve));
    res.json({ success: true, ma_nhac: ma, noi_dung, thoi_gian });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/reminders', authMiddleware, async (req, res) => {
  try {
    const rows = await new Promise((resolve) => db.all('SELECT ma_nhac, noi_dung, thoi_gian, da_nhac FROM lich_nhac WHERE ma_nguoi_dung = ? ORDER BY thoi_gian ASC', [req.user.id], (e, r) => resolve(r || [])));
    res.json({ success: true, reminders: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/reminders/:id', authMiddleware, async (req, res) => {
  try {
    await new Promise((resolve) => db.run('DELETE FROM lich_nhac WHERE ma_nhac = ? AND ma_nguoi_dung = ?', [req.params.id, req.user.id], resolve));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const rows = await new Promise((resolve) => db.all('SELECT ma_tb, noi_dung, ngay_tao FROM thong_bao WHERE ma_nguoi_dung = ? AND da_doc = 0 ORDER BY ngay_tao DESC LIMIT 20', [req.user.id], (e, r) => resolve(r || [])));
    res.json({ success: true, notifications: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== NHẬT KÝ HOẠT ĐỘNG (bảo mật) ==========
// P2-20(8): bảng nhat_ky đã tạo ở init-db.js — bỏ IIFE CREATE rải rác.

router.get('/admin/logs', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const rows = await new Promise((resolve) => db.all('SELECT ma_nguoi_dung, hanh_dong, chi_tiet, ngay_tao FROM nhat_ky ORDER BY ngay_tao DESC LIMIT 100', [], (e, r) => resolve(r || [])));
    res.json({ success: true, logs: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
