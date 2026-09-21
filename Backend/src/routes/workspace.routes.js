const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authMiddleware, adminMiddleware } = require('../middleware/auth.middleware');

const rootDir = path.resolve(__dirname, '..', '..', '..');

// File nhạy cảm — user thường KHÔNG được đọc (chống lộ API key trong .env, DB, log...)
const SENSITIVE_FILE_PATTERNS = [
  /\.env(\b|$)/i,        // .env, .env.production...
  /\.db(-wal|-shm)?$/i,  // SQLite + WAL/SHM
  /\.sqlite/i,
  /\.log$/i,
  /DANH_SACH_API_KEY/i
];
function isSensitivePath(relPath) {
  const normalized = String(relPath || '').replace(/\\/g, '/');
  return SENSITIVE_FILE_PATTERNS.some(re => re.test(normalized));
}

function resolveWorkspacePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('Missing file path');
  }

  const fullPath = path.resolve(rootDir, relativePath);
  const relative = path.relative(rootDir, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('File path must remain inside the workspace');
    error.statusCode = 403;
    throw error;
  }
  return fullPath;
}

// P2-20(10): chỉ admin được liệt kê cây file + giới hạn depth/limit qua query
// (chống quét cây khổng lồ làm treo server). FE App.jsx fetchFileTree đã gửi
// authHeaders (token user — user phải có phan_quyen='admin' mới xem được).
router.get('/files', authMiddleware, adminMiddleware, (req, res) => {
  const maxDepth = Math.min(Math.max(parseInt(req.query.depth, 10) || 8, 1), 8);
  const maxItems = Math.min(Math.max(parseInt(req.query.limit, 10) || 2000, 100), 5000);
  let count = 0;
  let truncated = false;
  function scanDir(dirPath, relativeDir = '', depth = 0) {
    if (depth > maxDepth || truncated) return [];
    let items;
    try {
      items = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const result = [];

    for (const item of items) {
      if (count >= maxItems) { truncated = true; break; }
      if (item.name === 'node_modules' || item.name === '.git' || item.name === 'dist' || item.name === '.archive_scripts') continue;

      const itemRelPath = path.join(relativeDir, item.name);
      const fullPath = path.join(dirPath, item.name);

      if (item.isDirectory()) {
        count++;
        result.push({
          name: item.name,
          path: itemRelPath,
          type: 'folder',
          children: scanDir(fullPath, itemRelPath, depth + 1)
        });
      } else {
        if (isSensitivePath(itemRelPath)) continue;
        count++;
        result.push({
          name: item.name,
          path: itemRelPath,
          type: 'file'
        });
      }
    }
    return result;
  }

  try {
    const fileTree = scanDir(rootDir);
    if (truncated) res.setHeader('X-Truncated', 'true');
    res.json(fileTree);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Helper: validate path không thoát khỏi rootDir (chống path traversal)
function safePath(rootDir, relPath) {
  if (relPath.includes('\0')) return null;
  const fullPath = path.resolve(rootDir, relPath);
  const relative = path.relative(rootDir, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
return fullPath;
}

router.get('/file-content', [authMiddleware, adminMiddleware], (req, res) => {
  const relPath = req.query.path;
  if (!relPath) return res.status(400).json({ error: 'Missing file path' });

  const rootDir = path.join(__dirname, '..', '..', '..');
  const fullPath = safePath(rootDir, relPath);
  if (!fullPath) return res.status(403).json({ error: 'Path không hợp lệ (path traversal detected)' });
  if (isSensitivePath(relPath)) return res.status(403).json({ error: 'Không cho phép đọc file nhạy cảm (.env, db, log...).' });

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    res.json({ path: relPath, content });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/file-content', [authMiddleware, adminMiddleware], (req, res) => {
  const { path: relPath, content } = req.body;
  if (!relPath) return res.status(400).json({ error: 'Missing file path' });

  const rootDir = path.join(__dirname, '..', '..', '..');
  const fullPath = safePath(rootDir, relPath);
  if (!fullPath) return res.status(403).json({ error: 'Path không hợp lệ (path traversal detected)' });

  try {
    fs.writeFileSync(fullPath, content, 'utf-8');
    res.json({ success: true, path: relPath });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

module.exports = router;
