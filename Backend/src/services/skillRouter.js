// ─────────────────────────────────────────────────────────────
// SKILL ROUTER — tự chọn ĐÚNG skill theo câu hỏi
// Thay vì nhét 5 skills đầu tiên vào prompt, router này đọc
// toàn bộ skills đang kích hoạt, khớp nội dung câu hỏi với
// tiêu đề/mô tả skill → chỉ inject 1-3 skills liên quan nhất.
// ─────────────────────────────────────────────────────────────
'use strict';

const path = require('path');
const fs = require('fs');

function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

// Map từ khóa → skill (không dấu). Ưu tiên khớp từ khóa đặc thù.
const SKILL_KEYWORDS = [
  { skill: 'ppt',        keywords: /(thuyet trinh|powerpoint|slide|slides|presentation|pptx)/i },
  { skill: 'slides',     keywords: /(thuyet trinh|slide|presentation)/i },
  { skill: 'frontend-design', keywords: /(thiet ke web|frontend|landing page|giao dien web|ui web|web design)/i },
  { skill: 'image-to-code',   keywords: /(anh sang code|image to code|chuyen anh thanh code|mockup)/i },
  { skill: 'design',     keywords: /(thiet ke|logo|brand|thuong hieu|nhan dien)/i },
  { skill: 'banner-design',   keywords: /(banner|quang cao|ad |poster)/i },
  { skill: 'brand',      keywords: /(thuong hieu|brand identity|nhan dien thuong hieu)/i },
  { skill: 'color-expert',    keywords: /(mau sac|phoi mau|palette|color)/i },
  { skill: 'code-review',     keywords: /(review code|danh gia code|kiem tra code|code quality)/i },
  { skill: 'deploy-to-vercel',keywords: /(deploy|vercel|dang web|hosting)/i },
  { skill: 'ssh',        keywords: /(ssh|remote server|ket noi server)/i },
  { skill: 'screenshot', keywords: /(chup man hinh|screenshot|screenshot)/i },
  { skill: 'docx',       keywords: /(word|docx|van ban word)/i },
  { skill: 'pdf',        keywords: /(pdf|chuyen sang pdf)/i },
  { skill: 'excel',      keywords: /(excel|bang tinh|spreadsheet|xlsx)/i },
  { skill: 'video',      keywords: /(video|lam video|edit video|cat video)/i },
  { skill: 'tts',        keywords: /(giong noi|text to speech|tts|doc van ban)/i },
  { skill: 'vietnamese-tts',  keywords: /(giong noi tieng viet|tts tieng viet)/i },
  { skill: 'iptv',       keywords: /(truyen hinh|iptv|kenh tv|live tv)/i },
  { skill: 'youtube',    keywords: /(youtube|tai video|video youtube)/i },
  { skill: 'translation',keywords: /(dich|translate|phien dich)/i },
  { skill: 'prompt-optimizer', keywords: /(toi uu prompt|viet prompt|prompt engineering|sua prompt)/i },
  { skill: 'prompt-jailbreak', keywords: /(jailbreak|vo qua|bypass gioi han)/i },
  { skill: 'writing',    keywords: /(viet bai|content|bai viet|seo|copywriting)/i },
  { skill: 'marketing',  keywords: /(marketing|quang cao|ban hang|sale|content marketing)/i },
  { skill: 'business',   keywords: /(hop dong|doanh nghiep|kinh doanh|startup|ke hoach kinh doanh)/i },
  { skill: 'education',  keywords: /(bai giang|giao duc|hoc tap|on thi|luyen thi)/i },
  { skill: 'health',     keywords: /(suc khoe|dinh duong|thuc don|bai tap|gym)/i },
  { skill: 'email',      keywords: /(email|thu dien tu|gui mail)/i },
  { skill: 'resume',     keywords: /(cv|so yeu ly lich|resume|xin viec)/i },
  { skill: 'ai-artist',  keywords: /(anh ai|ve tranh|ai art|generate image|tao anh)/i },
  { skill: 'code',       keywords: /(code|lap trinh|javascript|python|java|html|css|react|api|backend|frontend|database|sql|debug|sua loi)/i },
  { skill: 'analysis',   keywords: /(phan tich|tom tat|danh gia|nghien cuu|thong ke)/i },
];

const MAX_SKILLS_INJECT = 3; // inject tối đa 3 skill liên quan nhất

/**
 * Chọn skill phù hợp cho câu hỏi.
 * @param {string} question
 * @param {Array<{ten_ky_nang:string,tieu_de:string,mo_ta:string}>} allSkills skills đang kích hoạt trong DB
 * @returns {Array} danh sách skill khớp (tối đa MAX_SKILLS_INJECT)
 */
function pickSkills(question, allSkills = []) {
  const q = stripDiacritics(String(question || ''));
  const scored = [];

  for (const rule of SKILL_KEYWORDS) {
    if (rule.keywords.test(q)) {
      // Tìm skill thật trong DB có tên khớp (gần đúng)
      const norm = stripDiacritics(rule.skill);
      const found = (allSkills || []).filter(s => {
        const name = stripDiacritics(s.ten_ky_nang || '');
        return name === norm || name.includes(norm) || norm.includes(name);
      });
      if (found.length) {
        for (const f of found) scored.push({ skill: f, score: 100 });
      } else {
        // Skill không có trong DB nhưng có keyword → vẫn ghi nhận (để log)
        scored.push({ skill: { ten_ky_nang: rule.skill, tieu_de: rule.skill, mo_ta: '' }, score: 80, notInDb: true });
      }
    }
  }

  // Dedup + sort theo score
  const seen = new Set();
  const unique = [];
  for (const s of scored) {
    const key = s.skill.ten_ky_nang;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }
  unique.sort((a, b) => b.score - a.score);
  return unique.slice(0, MAX_SKILLS_INJECT).map(s => s.skill);
}

/**
 * Load skills từ DB + đọc nội dung SKILL.md, trả prompt sẵn.
 * @param {string} question
 * @param {Array<{ten_ky_nang:string,tieu_de:string,mo_ta:string}>} allSkills
 * @returns {Promise<string>} prompt đã inject skill liên quan
 */
async function buildSkillPrompt(question, allSkills = []) {
  const picked = pickSkills(question, allSkills);
  if (!picked.length) return '';

  const blocks = [];
  for (const skill of picked) {
    const possiblePaths = [
      path.join(__dirname, '..', '..', 'skills', skill.ten_ky_nang, 'SKILL.md'),
      path.join(process.env.USERPROFILE || process.env.HOME, '.agents', 'skills', skill.ten_ky_nang, 'SKILL.md'),
      path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'config', 'skills', skill.ten_ky_nang, 'SKILL.md'),
    ];
    let content = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try { content = fs.readFileSync(p, 'utf8'); break; } catch (e) {}
      }
    }
    if (content) {
      const trimmed = content.replace(/\s+/g, ' ').trim();
      blocks.push(`🎯 **${skill.tieu_de}** (${skill.ten_ky_nang}):\n${trimmed.substring(0, 1500)}`);
    } else {
      blocks.push(`🎯 **${skill.tieu_de}**: ${skill.mo_ta || skill.ten_ky_nang}`);
    }
  }
  if (!blocks.length) return '';
  return `\n\n📚 **KỸ NĂNG CHUYÊN DỤNG ĐƯỢC CHỌN CHO CÂU NÀY:**\n` + blocks.join('\n\n---\n\n');
}

module.exports = { pickSkills, buildSkillPrompt, SKILL_KEYWORDS };
