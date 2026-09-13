const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth.middleware');
const { executeTool, TOOL_REGISTRY, callAI } = require('../services/agentService');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');

// FIX SECURITY: agent routes thực thi lệnh/browser/file -> bắt buộc admin (trước đây không auth = RCE)
router.use(authMiddleware);
router.use(adminMiddleware);

// ========== AGENT TOOL CHAT API ==========
// Đây là API cho AI Agent tự động gọi tools, tự kiểm tra, tự sửa lỗi

router.post('/chat', async (req, res) => {
  try {
    const { message, model } = req.body;
    if (!message) return res.status(400).json({ error: 'Thiếu message' });
    const { runInternalAgent } = require('../services/internalAgent');
    const result = await runInternalAgent(message, { model });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ========== DANH SÁCH TOOLS ==========
router.get('/tools', (req, res) => {
  res.json({ tools: TOOL_REGISTRY.map(t => ({ name: t.name, description: t.description })) });
});

// ========== THỰC THI 1 TOOL ==========
router.post('/execute', async (req, res) => {
  try {
    const { tool, args } = req.body;
    if (!tool) return res.status(400).json({ error: 'Thiếu tên tool' });
    const result = await executeTool(tool, args || {});
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== PROCESS FILE ==========
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const upload = multer({ dest: path.join(__dirname, '..', '..', 'temp') });

router.post('/process-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Chưa upload file' });
    const { instruction } = req.body;
    
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let result;

    if (ext === '.pdf') {
      // PDF → trích text bằng pdf-parse (chạy CPU)
      const dataBuffer = fs.readFileSync(filePath);
      const pdf = new PDFParse({ data: dataBuffer });
      const parsed = await pdf.getText({});
      await pdf.destroy();
      const text = (parsed.text || '').trim() || '[Không trích được chữ — PDF có thể là ảnh scan hoặc bị mã hóa]';
      const maxChars = 50000;
      const content = text.length > maxChars ? text.substring(0, maxChars) + '\n...[đã cắt, toàn bộ dài ' + text.length + ' ký tự]' : text;
      result = { result: await callAI((instruction || 'Phân tích nội dung file PDF này') + '\n\nNội dung PDF:\n' + content) };
    } else if (ext === '.docx') {
      // DOCX → trích text bằng mammoth
      const parsed = await mammoth.extractRawText({ path: filePath });
      const text = (parsed.value || '').trim() || '[Không trích được chữ trong DOCX]';
      result = { result: await callAI((instruction || 'Phân tích nội dung file Word này') + '\n\nNội dung DOCX:\n' + text) };
    } else if (ext === '.doc' || ext === '.docx_old') {
      result = await executeTool('process_word', { filePath, instruction: instruction || 'Phân tích nội dung file này' });
    } else {
      const content = fs.readFileSync(filePath, 'utf-8');
      result = { result: await callAI(instruction + '\n\nNội dung file:\n' + content) };
    }

    // Dọn file tạm
    try { fs.unlinkSync(filePath); } catch {}
    
    res.json({ success: true, result: result.result || result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== WEB ANALYZE ==========
router.post('/web-analyze', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Thiếu URL' });
    const result = await executeTool('web_analyze', { url });
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;