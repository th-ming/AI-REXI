const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { stripAnsi } = require('../utils/stripAnsi');
const { generateEdgeTTSNode } = require('./edgeTTS');
const { assertPublicUrlAsync } = require('../utils/urlSafety');
const { safeExec } = require('../utils/safeExec');

// ========== TOOL REGISTRY ==========
// Thêm tool mới chỉ cần thêm 1 object vào đây, AI tự hiểu và dùng!
const TOOL_REGISTRY = [
  {
    name: 'browser_navigate',
    description: 'Mở trình duyệt đến URL bất kỳ. Dùng để xem web, YouTube, TikTok, TV online, opencut edit video...',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL cần mở' } }, required: ['url'] }
  },
  {
    name: 'browser_click',
    description: 'Click chuột tại vị trí (x,y) trên trang web',
    parameters: { type: 'object', properties: { x: { type: 'number', description: 'Tọa độ X' }, y: { type: 'number', description: 'Tọa độ Y' } }, required: ['x', 'y'] }
  },
  {
    name: 'browser_type',
    description: 'Gõ text vào ô input trên web',
    parameters: { type: 'object', properties: { text: { type: 'string', description: 'Nội dung cần gõ' } }, required: ['text'] }
  },
  {
    name: 'browser_act',
    description: 'Dùng AI thực hiện hành động phức tạp trên web (click nút, điền form, đọc nội dung...)',
    parameters: { type: 'object', properties: { instruction: { type: 'string', description: 'Mô tả hành động cần làm' } }, required: ['instruction'] }
  },
  {
    name: 'browser_screenshot',
    description: 'Chụp màn hình browser để kiểm tra kết quả',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'process_word',
    description: 'Đọc/xử lý file Word (.docx). Dùng để phân tích, chỉnh sửa văn bản',
    parameters: { type: 'object', properties: { filePath: { type: 'string', description: 'Đường dẫn file Word' }, instruction: { type: 'string', description: 'Cần làm gì với file?' } }, required: ['filePath', 'instruction'] }
  },
  {
    name: 'create_word',
    description: 'Tạo file Word mới với nội dung chỉ định',
    parameters: { type: 'object', properties: { content: { type: 'string', description: 'Nội dung file' }, outputPath: { type: 'string', description: 'Đường dẫn lưu file' } }, required: ['content', 'outputPath'] }
  },
  {
    name: 'execute_command',
    description: 'Chạy lệnh terminal/CMD. Dùng để chạy script, build code, cài đặt...',
    parameters: { type: 'object', properties: { command: { type: 'string', description: 'Câu lệnh cần chạy' } }, required: ['command'] }
  },
  {
    name: 'run_code',
    description: 'Chạy code Python / JavaScript / Bash và trả về kết quả stdout. Dùng khi người dùng yêu cầu tính toán, xử lý dữ liệu, tạo script.',
    parameters: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['python', 'javascript', 'bash'], description: 'Ngôn ngữ code' },
        code: { type: 'string', description: 'Code cần chạy' }
      },
      required: ['language', 'code']
    }
  },
  {
    name: 'search_web',
    description: 'Tìm kiếm thông tin trên internet',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Từ khóa tìm kiếm' } }, required: ['query'] }
  },
  {
    name: 'web_analyze',
    description: 'Phân tích website từ URL: đọc nội dung, chụp screenshot, đánh giá SEO, design, tốc độ. Dùng khi user muốn đánh giá 1 website.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL website cần phân tích' } }, required: ['url'] }
  },
  {
    name: 'text_to_speech',
    description: 'Tạo giọng nói tiếng Việt từ văn bản, trả về file audio. Hỗ trợ 10 giọng nói (Nam/Nữ, Bắc/Nam), điều chỉnh tốc độ và cao độ.',
    parameters: { type: 'object', properties: { 
      text: { type: 'string', description: 'Nội dung cần đọc' }, 
      voice: { type: 'string', description: 'Giọng đọc: vi-VN-HoaiMyNeural (Nữ/Bắc), vi-VN-NamMinhNeural (Nam/Nam), vi-VN-DuyAnhNeural (Nam/Bắc), vi-VN-ThuyMinhNeural (Nữ/Nam)...', default: 'vi-VN-HoaiMyNeural' },
      rate: { type: 'string', description: 'Tốc độ: +20% hoặc -10%', default: '+0%' },
      pitch: { type: 'string', description: 'Cao độ giọng: +10% hoặc -5%', default: '+0%' }
    }, required: ['text'] }
  }
];

// ========== EXECUTE TOOL ==========
const browserStream = require('./browserStream');
const { Document, Packer, Paragraph } = require('docx');

async function executeTool(toolName, args) {
  console.log('[Agent] Tool: ' + toolName, JSON.stringify(args));
  switch (toolName) {
    case 'browser_navigate': {
      // FIX SECURITY: chặn URL nội bộ (SSRF) trước khi mở browser (P2-18: bản async có resolve DNS)
      const checkNav = await assertPublicUrlAsync(args.url);
      if (!checkNav.ok) return { error: checkNav.reason };
      if (!browserStream.browser) await browserStream.launch();
      return await browserStream.navigate(args.url);
    }
    case 'browser_click':
      return await browserStream.click(args.x, args.y);
    case 'browser_type':
      return await browserStream.type(args.text);
    case 'browser_act':
      if (!browserStream.browser) await browserStream.launch();
      return await browserStream.act(args.instruction);
    case 'browser_screenshot':
      if (!browserStream.page) return { error: 'Browser chưa mở' };
      const buf = await browserStream.page.screenshot({ type: 'jpeg', quality: 70 });
      return { screenshot: 'data:image/jpeg;base64,' + buf.toString('base64') };
    case 'process_word': {
      const content = fs.readFileSync(args.filePath, 'utf-8');
      const result = await callAI('Xử lý: ' + args.instruction + '\n\nNội dung:\n' + content);
      if (args.savePath && result && !result.startsWith('Lỗi AI:')) {
        fs.writeFileSync(args.savePath, result, 'utf-8');
        return { result, savedTo: args.savePath };
      }
      return { result };
    }
    case 'create_word': {
      const d = new Document({ sections: [{ children: args.content.split('\n').map(l => new Paragraph({ text: l })) }] });
      const buffer = await Packer.toBuffer(d);
      const outputDir = path.dirname(args.outputPath);
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(args.outputPath, buffer);
      return { success: true, path: args.outputPath, size: buffer.length };
    }
    case 'execute_command': {
      // FIX PROD: dùng safeExec — timeout + cắt output + chặn lệnh hủy diệt
      const r = await safeExec(args.command, { timeout: 30000, strict: true });
      return { success: r.success, stdout: stripAnsi(r.stdout).trim(), stderr: stripAnsi(r.stderr).trim(), timedOut: r.timedOut };
    }
    case 'run_code': {
      const { runCode } = require('./codeRunner');
      return await runCode(args.language, args.code);
    }
    case 'search_web': {
      return await searchWebTool(args.query);
    }
    case 'web_analyze': {
      const url = args.url;
      if (!url) return { error: 'Thiếu URL' };
      // FIX SECURITY: chặn URL nội bộ (SSRF) trước khi phân tích website (P2-18: bản async có resolve DNS)
      const checkUrl = await assertPublicUrlAsync(url);
      if (!checkUrl.ok) return { error: checkUrl.reason };
      if (!browserStream.browser) await browserStream.launch();
      const page = browserStream.page || (await browserStream.browser.newPage());
      const startTime = Date.now();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const loadTime = Date.now() - startTime;
        const title = await page.title();
        const metaDesc = await page.$eval('meta[name="description"]', el => el.content).catch(() => '(không có)');
        const metaKeywords = await page.$eval('meta[name="keywords"]', el => el.content).catch(() => '(không có)');
        const h1Count = await page.$$eval('h1', els => els.length);
        const h2Count = await page.$$eval('h2', els => els.length);
        const imgNoAlt = await page.$$eval('img:not([alt]), img[alt=""]', els => els.length);
        const totalImages = await page.$$eval('img', els => els.length);
        const links = await page.$$eval('a[href]', els => els.length);
        const bodyText = await page.$eval('body', el => el.innerText.substring(0, 3000));
        const buf = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false });
        const screenshot = 'data:image/jpeg;base64,' + buf.toString('base64');
        const htmlSize = await page.content().then(c => c.length);
        return {
          title, metaDesc, metaKeywords, h1Count, h2Count,
          imgNoAlt, totalImages, links, loadTime, htmlSize,
          bodyText, screenshot,
          score: {
            seo: h1Count > 0 && metaDesc !== '(không có)' ? 'Tốt' : 'Cần cải thiện',
            speed: loadTime < 2000 ? 'Nhanh' : loadTime < 5000 ? 'Trung bình' : 'Chậm',
            accessibility: imgNoAlt === 0 ? 'Tốt' : 'Có ' + imgNoAlt + ' ảnh thiếu alt'
          }
        };
      } catch (err) {
        return { error: 'Lỗi phân tích: ' + err.message };
      }
    }
    case 'text_to_speech': {
      // FIX PROD: dùng Edge TTS Thuần Node.js (WebSocket tới Microsoft) — KHÔNG cần Python,
      // chạy được cả trên Render (trước đây dùng python3 trên Linux → lỗi trên server).
      const VALID_TTS_VOICES = [
        'vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural', 'vi-VN-DuyAnhNeural',
        'vi-VN-HaSanhNeural', 'vi-VN-MinhAnhNeural', 'vi-VN-ThuyMinhNeural',
        'vi-VN-ThiTuyetNeural', 'vi-VN-VanHanhNeural', 'vi-VN-VanMinhNeural',
        'vi-VN-CaoVietNeural'
      ];
      const voiceName = VALID_TTS_VOICES.includes(args.voice) ? args.voice : 'vi-VN-HoaiMyNeural';
      const validRate = args.rate && /^[+-]\d+%$/.test(args.rate) ? args.rate : '+0%';
      const validPitch = args.pitch && /^[+-]\d+Hz$/.test(args.pitch) ? args.pitch : '+0Hz';
      const cleanedText = (args.text || '').replace(/"/g, '\\"').substring(0, 1000);
      if (!cleanedText.trim()) return { error: 'Văn bản trống' };
      try {
        const outFile = path.join(__dirname, '..', '..', 'temp', 'tts_' + Date.now() + '.mp3');
        const audioBuffer = await generateEdgeTTSNode(voiceName, cleanedText, validRate, validPitch);
        if (!audioBuffer || audioBuffer.length === 0) return { error: 'TTS không tạo được âm thanh' };
        fs.writeFileSync(outFile, audioBuffer);
        return { success: true, audioFile: outFile, voice: voiceName };
      } catch (err) {
        return { error: 'TTS lỗi: ' + (err.message || err) };
      }
    }
    default:
      return { error: "Tool '" + toolName + "' chưa được implement" };
  }
}

// ========== SEARCH WEB TOOL ==========
// Tìm kiếm web không cần API key:
//  1. DuckDuckGo Instant Answer API (api.duckduckgo.com — JSON, free, no key)
//  2. Fallback: scrape kết quả html.duckduckgo.com (đỡ rủi ro IA trả rỗng)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function searchWebTool(query) {
  if (!query || !String(query).trim()) return { results: [] };
  const q = String(query).trim();
  try {
    // 1) DDG Instant Answer — trả abstract + related topics (JSON sạch)
    const iaUrl = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(q) + '&format=json&no_html=1&skip_disambig=1';
    const iaRes = await fetch(iaUrl, { headers: { 'User-Agent': UA } });
    if (iaRes.ok) {
      const ia = await iaRes.json();
      const results = [];
      if (ia.AbstractText) results.push({ type: 'abstract', title: ia.Heading || q, snippet: ia.AbstractText, url: ia.AbstractURL || '' });
      if (ia.Answer && ia.AnswerType !== '') results.push({ type: 'answer', title: 'Câu trả lời', snippet: String(ia.Answer), url: '' });
      if (Array.isArray(ia.RelatedTopics)) {
        for (const t of ia.RelatedTopics) {
          if (!t || typeof t !== 'object') continue;
          if (t.Topics && Array.isArray(t.Topics)) {
            for (const sub of t.Topics) {
              if (sub && sub.Text) results.push({ type: 'related', title: sub.FirstURL || '', snippet: sub.Text, url: sub.FirstURL || '' });
            }
          } else if (t.Text) {
            results.push({ type: 'related', title: t.FirstURL || '', snippet: t.Text, url: t.FirstURL || '' });
          }
        }
      }
      if (results.length) return { results: results.slice(0, 8), source: 'duckduckgo-ia' };
    }
  } catch (e) {
    console.warn('[Agent][search] DDG IA fail:', e.message);
  }

  try {
    // 2) Fallback: HTML scrape html.duckduckgo.com
    const htmlRes = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA } });
    if (!htmlRes.ok) return { results: [] };
    const html = await htmlRes.text();
    const out = [];
    const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null && out.length < 8) {
      out.push({
        type: 'result',
        title: m[2].replace(/<[^>]+>/g, '').trim(),
        snippet: m[3].replace(/<[^>]+>/g, '').trim(),
        url: m[1]
      });
    }
    return { results: out, source: 'duckduckgo-html' };
  } catch (e) {
    console.warn('[Agent][search] DDG HTML fail:', e.message);
    return { results: [] };
  }
}

// ========== CALL AI ==========
async function callAI(prompt, m) {
  const { spawn } = require('child_process');
  const OPENCODE_BIN = process.env.OPENCODE_BIN_PATH || path.join(process.env.USERPROFILE || '', '.opencode', 'bin', 'opencode.exe');
  // Model mặc định: nvidia gemma-4-31b-it — key có sẵn trong auth.json opencode, chạy được, context 200k
  const model = m || 'nvidia/google/gemma-4-31b-it';

  // Thử OpenCode binary trước (miễn phí) — --pure bỏ plugins nặng (project 71k file → build chậm)
  if (fs.existsSync(OPENCODE_BIN)) {
    return new Promise((resolve) => {
      const proc = spawn(OPENCODE_BIN, ['run', prompt, '--auto', '--model', model, '--pure', '--title', 'agent-task'], {
        timeout: 300000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, LANG: 'en_US.UTF-8', NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb', CLICOLOR: '0', CLICOLOR_FORCE: '0' }
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += stripAnsi(d.toString()); });
      proc.stderr.on('data', d => { stderr += stripAnsi(d.toString()); });
      proc.on('close', () => resolve(stdout.trim() || stderr.trim() || 'Lỗi AI: Không có phản hồi.'));
      proc.on('error', () => resolve('Lỗi AI: Không tìm thấy OpenCode binary.'));
    });
  }

  // FALLBACK: OmniRoute Free AI Gateway (đã cài trong skills/omniroute) — không cần API key
  // endpoint: http://localhost:20128/v1/chat/completions (có thể override bằng OMNIROUTE_BASE_URL)
  const omniBase = (process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128/v1').replace(/\/$/, '');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const omniRes = await fetch(omniBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: (process.env.OMNIROUTE_MODEL || 'pollinations/gpt-5') + '',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048
      })
    });
    clearTimeout(timer);
    if (omniRes.ok) {
      const data = await omniRes.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text) return text.trim();
    }
  } catch (e) {
    console.warn('[Agent][callAI] OmniRoute fallback fail:', e.message);
  }

  return 'Lỗi AI: Không có nguồn AI khả dụng (OpenCode chưa cài / OmniRoute chưa chạy).';
}

module.exports = { executeTool, TOOL_REGISTRY, callAI, searchWebTool };

