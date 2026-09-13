/**
 * ytdlpService.js — Xem YouTube không quảng cáo (giống Premium free)
 *
 * Dùng yt-dlp (Python, đã cài sẵn trong hệ thống) để:
 *  - Search video trên YouTube
 *  - Lấy thông tin video + URL stream trực tiếp (không quảng cáo, không tracking)
 *  - Tải audio (mp3) về máy để Tóm tắt AI
 *
 * Cách dùng: gọi hàm, trả Promise<object>. Nếu yt-dlp lỗi → throw Error có message rõ.
 */

const { execFile } = require('child_process');
const path = require('path');

// Lệnh python: thử python, python3, py
const PYTHON_CANDIDATES = process.env.YTDLP_PYTHON
  ? [process.env.YTDLP_PYTHON]
  : ['python', 'python3', 'py'];

let pythonBin = null;

function findPython() {
  if (pythonBin) return Promise.resolve(pythonBin);
  return new Promise((resolve) => {
    let idx = 0;
    const tryNext = () => {
      if (idx >= PYTHON_CANDIDATES.length) {
        pythonBin = null;
        return resolve(null);
      }
      const bin = PYTHON_CANDIDATES[idx++];
      execFile(bin, ['-c', 'import yt_dlp; print(yt_dlp.version.__version__)'], { timeout: 10000 }, (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          pythonBin = bin;
          console.log(`[yt-dlp] Using ${bin} (yt_dlp ${stdout.trim()})`);
          return resolve(bin);
        }
        tryNext();
      });
    };
    tryNext();
  });
}

const HELPER_SCRIPT = path.join(__dirname, 'ytdlp_helper.py');

/**
 * Chạy helper python với action + args → trả JSON.
 * Helper luôn in JSON ở DÒNG CUỐI stdout (yt-dlp có thể in log ra stdout
 * dù đã noprogress — nên parse dòng cuối cùng để luôn an toàn).
 */
function runHelper(action, args = [], timeoutMs = 30000) {
  return new Promise(async (resolve, reject) => {
    const bin = await findPython();
    if (!bin) {
      return reject(new Error('Không tìm thấy Python + yt_dlp. Cài: pip install yt-dlp'));
    }
    execFile(bin, [HELPER_SCRIPT, action, ...args], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error((stderr || stdout || err.message).slice(0, 300)));
      }
      const lines = String(stdout || '').trim().split('\n').filter(l => l.trim());
      const lastLine = lines[lines.length - 1] || '';
      try {
        const data = JSON.parse(lastLine);
        if (data.error) return reject(new Error(data.error));
        resolve(data);
      } catch (e) {
        reject(new Error('yt-dlp trả dữ liệu không hợp lệ: ' + stdout.slice(0, 200)));
      }
    });
  });
}

/**
 * Search video YouTube.
 * @param {string} query từ khóa
 * @param {number} limit số kết quả (mặc định 12)
 * @returns {Promise<Array>} [{id, title, author, duration, views, thumbnails}]
 */
async function searchVideos(query, limit = 12) {
  if (!query || !query.trim()) throw new Error('Thiếu từ khóa tìm kiếm');
  const data = await runHelper('search', [query.trim(), String(limit || 12)], 45000);
  return data.videos || [];
}

/**
 * Lấy thông tin video + URL stream trực tiếp.
 * @param {string} url hoặc videoId (YouTube URL / ID)
 * @returns {Promise<Object>} {id, title, author, duration, views, description, stream_url}
 */
async function getVideoStream(urlOrId) {
  if (!urlOrId) throw new Error('Thiếu URL/ID video');
  const data = await runHelper('stream', [urlOrId], 45000);
  return data;
}

/**
 * Tải audio (mp3) của video về máy — dùng cho tính năng Tóm tắt AI.
 * @param {string} urlOrId URL hoặc videoId
 * @param {string} outPath đường dẫn file đích (không đuôi, helper tự thêm .mp3)
 * @returns {Promise<Object>} {ok, title, file}
 */
async function downloadAudio(urlOrId, outPath, timeoutMs = 150000) {
  if (!urlOrId) throw new Error('Thiếu URL/ID video');
  const data = await runHelper('audio', [urlOrId, outPath], timeoutMs);
  return data;
}

module.exports = { searchVideos, getVideoStream, downloadAudio };
