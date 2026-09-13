/**
 * AI REXI BRAIN — RAG SERVICE (Đọc & hiểu FILE)
 *
 * Người dùng đưa file TXT/PDF/DOCX vào → mình trích xuất nội dung,
 * chia chunk, vector hóa bằng Gemini embedding → khi hỏi, tìm chunk
 * gần nghĩa nhất và đưa vào context để AI trả lời dựa trên file
 * (giống ChatGPT bản Pro / RAG).
 *
 * - extractFileText(buffer, filename): TXT / PDF / DOCX → text
 * - saveDocument(userId, filename, buffer): lưu + vector hóa
 * - listDocuments(userId): danh sách file của user
 * - deleteDocument(userId, id): xóa file + vector
 * - searchDocuments(userId, query, limit): tìm chunk gần nghĩa nhất
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const { getEmbedding, cosineSimilarity } = require('./brain/memory/embedding-service');

const CHUNK_SIZE = 900;   // ký tự mỗi chunk (vừa context, vừa embedding)
const CHUNK_OVERLAP = 120;

// ─── Bảng lưu tài liệu ────────────────────────────────────────────
try {
  db.run(`CREATE TABLE IF NOT EXISTS tai_lieu_rag (
    ma_tai_lieu TEXT PRIMARY KEY,
    ma_nguoi_dung TEXT NOT NULL,
    ten_file TEXT NOT NULL,
    loai_file TEXT,
    noi_dung TEXT NOT NULL,
    ngay_tao TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS tai_lieu_rag_chunk (
    ma_chunk TEXT PRIMARY KEY,
    ma_tai_lieu TEXT NOT NULL,
    vector TEXT NOT NULL,
    noi_dung TEXT NOT NULL,
    thu_tu INTEGER DEFAULT 0
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_rag_chunk_doc ON tai_lieu_rag_chunk (ma_tai_lieu)');
} catch (e) { console.log('[RAG] init table error:', e.message); }

// ─── Trích xuất text từ file (hỗ trợ nhiều định dạng) ─────────────
async function extractFileText(buffer, filename) {
  const ext = (path.extname(filename || '') || '').toLowerCase();
  try {
    if (ext === '.txt' || ext === '.md' || ext === '.js' || ext === '.py' || ext === '.html' || ext === '.css' || ext === '.jsx' || ext === '.ts' || ext === '.tsx' || ext === '.sql' || ext === '.sh' || ext === '.xml' || ext === '.yml' || ext === '.yaml' || ext === '.ini' || ext === '.log') {
      return buffer.toString('utf8');
    }
    if (ext === '.csv') return formatCsv(buffer.toString('utf8'));
    if (ext === '.json') return formatJson(buffer.toString('utf8'));
    if (ext === '.xlsx') return await extractXlsx(buffer);
    if (ext === '.pdf') {
      const parsed = await PDFParse(buffer);
      return parsed.text || '';
    }
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }
    // File không hỗ trợ → thử đọc như text
    return buffer.toString('utf8');
  } catch (e) {
    console.log('[RAG] extract error:', e.message);
    return '';
  }
}

// ─── CSV → dạng bảng dễ hiểu cho AI ───────────────────────────────
function formatCsv(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) return '';
  // Parser đơn giản hỗ trợ dấu ngoặc kép
  const parseRow = (line) => {
    const out = [];
    let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const rows = lines.map(parseRow);
  return rows.map((r, i) => `Hàng ${i + 1}: ${r.join(' | ')}`).join('\n');
}

// ─── JSON → format đẹp, gọn (xử lý mảng lớn) ──────────────────────
function formatJson(text) {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      if (data.length && typeof data[0] === 'object' && data[0] !== null) {
        // Mảng đối tượng → dạng bảng
        const keys = Object.keys(data[0]);
        return data.map((item, i) => `Mục ${i + 1}: ` + keys.map(k => `${k}=${JSON.stringify(item[k] ?? '')}`).join(', ')).join('\n');
      }
      return data.map((item, i) => `Mục ${i + 1}: ${JSON.stringify(item)}`).join('\n');
    }
    return JSON.stringify(data, null, 2).substring(0, 100000);
  } catch (e) {
    return text; // không phải JSON hợp lệ → giữ nguyên
  }
}

// ─── XLSX → text (dùng Python zipfile+XML, robust hơn unzip shell) ─
async function extractXlsx(buffer) {
  const os = require('os');
  const { execFile } = require('child_process');
  const tmpFile = path.join(os.tmpdir(), 'rag_' + Date.now() + '.xlsx');
  const tmpScript = path.join(os.tmpdir(), 'rag_xlsx_' + Date.now() + '.py');
  fs.writeFileSync(tmpFile, buffer);
  const script = `
import sys, zipfile, re, xml.etree.ElementTree as ET
fn = sys.argv[1]
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
try:
    z = zipfile.ZipFile(fn)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall('m:si', ns):
            shared.append(''.join(t.text or '' for t in si.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')))
    sheetname = next((n for n in z.namelist() if re.match(r'xl/worksheets/sheet\\d+\\.xml', n)), None)
    if not sheetname:
        print(''); sys.exit(0)
    root = ET.fromstring(z.read(sheetname))
    rows = []
    for row in root.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'):
        cells = []
        for c in row.findall('m:c', ns):
            v = c.find('m:v', ns)
            is_ = c.find('m:is', ns)
            t = c.get('t')
            val = ''
            if is_ is not None:
                val = ''.join(tt.text or '' for tt in is_.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t'))
            elif v is not None and v.text:
                val = shared[int(v.text)] if t == 's' else v.text
            cells.append(val.strip())
        if any(cells):
            rows.append(' | '.join(cells))
    print('\\n'.join('Hàng %d: %s' % (i + 1, r) for i, r in enumerate(rows)))
    sys.exit(0)
except Exception as e:
    print(''); sys.exit(1)
`;
  fs.writeFileSync(tmpScript, script);
  try {
    const out = await new Promise((resolve) => {
      execFile('python', [tmpScript, tmpFile], { timeout: 20000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (err, stdout) => resolve(stdout || ''));
    });
    return out.substring(0, 100000);
  } catch (e) {
    console.log('[RAG] xlsx error:', e.message);
    return '';
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) {}
    try { fs.unlinkSync(tmpScript); } catch (e) {}
  }
}

// ─── Chia text thành chunk có overlap ─────────────────────────────
function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const nextNewline = clean.indexOf('\n', end);
      const nextSpace = clean.indexOf(' ', end);
      const cut = nextNewline > 0 && nextNewline < end + 200 ? nextNewline : (nextSpace > 0 && nextSpace < end + 200 ? nextSpace : end);
      if (cut > start) end = cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks;
}

// ─── Lưu tài liệu + vector hóa từng chunk ─────────────────────────
async function saveDocument(userId, filename, buffer) {
  const crypto = require('crypto');
  const maTaiLieu = crypto.randomUUID();
  const ext = (path.extname(filename || '') || '').toLowerCase();
  const noiDung = await extractFileText(buffer, filename);
  if (!noiDung || noiDung.trim().length < 10) {
    return { error: 'Không đọc được nội dung file (định dạng không hỗ trợ hoặc file trống).' };
  }

  await new Promise((resolve) => {
    db.run(
      "INSERT INTO tai_lieu_rag (ma_tai_lieu, ma_nguoi_dung, ten_file, loai_file, noi_dung) VALUES (?, ?, ?, ?, ?)",
      [maTaiLieu, userId, filename, ext, noiDung],
      () => resolve()
    );
  });

  // Vector hóa từng chunk (fire-and-forget — không chặn response)
  const chunks = chunkText(noiDung);
  (async () => {
    let order = 0;
    for (const chunk of chunks) {
      const vec = await getEmbedding(chunk);
      if (!vec) continue;
      const maChunk = crypto.randomUUID();
      await new Promise((resolve) => {
        db.run(
          "INSERT INTO tai_lieu_rag_chunk (ma_chunk, ma_tai_lieu, vector, noi_dung, thu_tu) VALUES (?, ?, ?, ?, ?)",
          [maChunk, maTaiLieu, JSON.stringify(vec), chunk, order],
          () => resolve()
        );
      });
      order++;
    }
  })().catch(() => {});

  return { ma_tai_lieu: maTaiLieu, ten_file: filename, so_ky_tu: noiDung.length, so_chunk: chunks.length };
}

function listDocuments(userId) {
  return new Promise((resolve) => {
    db.all(
      "SELECT ma_tai_lieu, ten_file, loai_file, length(noi_dung) AS so_ky_tu, ngay_tao FROM tai_lieu_rag WHERE ma_nguoi_dung = ? ORDER BY ngay_tao DESC",
      [userId],
      (err, rows) => resolve(rows || [])
    );
  });
}

function deleteDocument(userId, maTaiLieu) {
  return new Promise((resolve) => {
    db.run("DELETE FROM tai_lieu_rag_chunk WHERE ma_tai_lieu = ?", [maTaiLieu], () => {
      db.run("DELETE FROM tai_lieu_rag WHERE ma_tai_lieu = ? AND ma_nguoi_dung = ?", [maTaiLieu, userId], (err) => {
        resolve(!err);
      });
    });
  });
}

// ─── Tìm chunk gần nghĩa nhất với câu hỏi ─────────────────────────
async function searchDocuments(userId, query, limit = 3) {
  try {
    const qVec = await getEmbedding(query);
    if (!qVec) return [];
    const rows = await new Promise((resolve) => {
      db.all(
        `SELECT c.ma_chunk, c.ma_tai_lieu, c.vector, c.noi_dung, d.ten_file
         FROM tai_lieu_rag_chunk c
         JOIN tai_lieu_rag d ON d.ma_tai_lieu = c.ma_tai_lieu
         WHERE d.ma_nguoi_dung = ?`,
        [userId],
        (err, r) => resolve(r || [])
      );
    });
    const scored = [];
    for (const row of rows) {
      let v;
      try { v = JSON.parse(row.vector); } catch (e) { continue; }
      const sim = cosineSimilarity(qVec, v);
      if (sim >= 0.30) scored.push({ ...row, sim });
    }
    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, limit).map(r => ({
      ma_tai_lieu: r.ma_tai_lieu,
      ten_file: r.ten_file,
      noi_dung: r.noi_dung,
      do_tuong_dong: Math.round(r.sim * 100) / 100
    }));
  } catch (e) {
    console.log('[RAG] search error:', e.message);
    return [];
  }
}

// ─── Backfill vector cho file cũ chưa có chunk (gọi khi cần) ──────
async function backfillMissingChunks() {
  try {
    const docs = await new Promise((resolve) => {
      db.all("SELECT ma_tai_lieu, ma_nguoi_dung, noi_dung FROM tai_lieu_rag", [], (err, r) => resolve(r || []));
    });
    for (const doc of docs) {
      const hasChunks = await new Promise((resolve) => {
        db.get("SELECT COUNT(*) AS c FROM tai_lieu_rag_chunk WHERE ma_tai_lieu = ?", [doc.ma_tai_lieu], (err, r) => resolve(r ? r.c : 0));
      });
      if (hasChunks === 0 && doc.noi_dung) {
        const chunks = chunkText(doc.noi_dung);
        const crypto = require('crypto');
        let order = 0;
        for (const chunk of chunks) {
          const vec = await getEmbedding(chunk);
          if (!vec) continue;
          await new Promise((resolve) => {
            db.run(
              "INSERT INTO tai_lieu_rag_chunk (ma_chunk, ma_tai_lieu, vector, noi_dung, thu_tu) VALUES (?, ?, ?, ?, ?)",
              [crypto.randomUUID(), doc.ma_tai_lieu, JSON.stringify(vec), chunk, order],
              () => resolve()
            );
          });
          order++;
        }
      }
    }
    console.log('[RAG] backfill xong');
  } catch (e) { console.log('[RAG] backfill error:', e.message); }
}

module.exports = {
  extractFileText,
  chunkText,
  saveDocument,
  listDocuments,
  deleteDocument,
  searchDocuments,
  backfillMissingChunks
};
