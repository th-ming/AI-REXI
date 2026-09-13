/**
 * AI REXI BRAIN — ENTITY EXTRACTOR (Phase 1: NLP Core)
 *
 * Trích xuất thông tin quan trọng từ tin nhắn tiếng Việt bằng vntk:
 *  - NER (Nhận dạng thực thể có tên: người, địa điểm, tổ chức)
 *  - Tokenizer (tách từ ghép tiếng Việt)
 *  - Regex fallback: SĐT, email, URL, ngày giờ, nghề, nơi ở, sở thích...
 *
 * Chi phí: 100% local (CRF model), KHÔNG gọi LLM — tiết kiệm quota.
 *
 * OUTPUT:
 * {
 *   name, phone, email, job, company, location, date, dates[], urls[],
 *   preferences: [], dislikes: [], facts: [], custom: []
 * }
 */

const { wordTokenizer, ner } = require('vntk');

const tokenizer = wordTokenizer();
const nerTagger = ner();

// ─── BỘ TỪ ĐIỂN BỔ TRỢ ──────────────────────────────────────────
// Bổ sung giúp vntk vì các danh sách này không nằm trong model CRF

// Nghề nghiệp phổ biến VN + quốc tế (key không dấu để khớp chuẩn hoá)
const JOB_DICT = {
  'developer': 'Lập trình viên', 'programmer': 'Lập trình viên', 'coder': 'Lập trình viên',
  'lap trinh vien': 'Lập trình viên', 'dev': 'Lập trình viên', 'devops': 'DevOps Engineer',
  'ky su phan mem': 'Kỹ sư phần mềm', 'software engineer': 'Kỹ sư phần mềm',
  'engineer': 'Kỹ sư', 'ky su': 'Kỹ sư', 'ky su xay dung': 'Kỹ sư xây dựng',
  'designer': 'Nhà thiết kế', 'thiet ke do hoa': 'Nhà thiết kế đồ họa', 'ui/ux': 'UI/UX Designer',
  'giao vien': 'Giáo viên', 'teacher': 'Giáo viên', 'giang vien': 'Giảng viên', 'lecturer': 'Giảng viên',
  'bac si': 'Bác sĩ', 'doctor': 'Bác sĩ', 'nha si': 'Nha sĩ', 'y ta': 'Y tá',
  'sinh vien': 'Sinh viên', 'student': 'Sinh viên', 'hoc sinh': 'Học sinh',
  'freelancer': 'Freelancer', 'tu do': 'Freelancer',
  'giam doc': 'Giám đốc', 'manager': 'Quản lý', 'tong giam doc': 'Tổng giám đốc',
  'ceo': 'CEO', 'cto': 'CTO', 'founder': 'Nhà sáng lập', 'sang lap': 'Nhà sáng lập',
  'truong phong': 'Trưởng phòng', 'lead': 'Team Lead', 'team lead': 'Team Lead',
  'nhan vien': 'Nhân viên', 'staff': 'Nhân viên', 'sales': 'Nhân viên kinh doanh',
  'kinh doanh': 'Kinh doanh', 'business owner': 'Chủ doanh nghiệp',
  'marketing': 'Marketing', 'digital marketing': 'Digital Marketing',
  'content creator': 'Content Creator', 'content': 'Content Creator',
  'nha van': 'Nhà văn', 'writer': 'Nhà văn', 'bien tap vien': 'Biên tập viên', 'editor': 'Biên tập viên',
  'streamer': 'Streamer', 'youtuber': 'YouTuber', 'youtube': 'YouTuber', 'vlogger': 'Vlogger',
  'tiktoker': 'TikToker',
  'data analyst': 'Data Analyst', 'analyst': 'Nhà phân tích dữ liệu',
  'data scientist': 'Nhà khoa học dữ liệu', 'khoa hoc du lieu': 'Nhà khoa học dữ liệu',
  'tester': 'QA/QC', 'qa': 'QA Engineer',
  'quan ly du an': 'Quản lý dự án', 'project manager': 'Quản lý dự án',
  'product manager': 'Product Manager',
  'nha bao': 'Nhà báo', 'phong vien': 'Phóng viên',
  'chef': 'Đầu bếp', 'dau bep': 'Đầu bếp',
  'assistant': 'Trợ lý', 'ke toan': 'Kế toán', 'accountant': 'Kế toán',
  'luat su': 'Luật sư', 'lawyer': 'Luật sư'
};

// Công ty / tổ chức nổi tiếng (key không dấu)
const COMPANY_DICT = {
  'fpt': 'FPT', 'vingroup': 'Vingroup', 'vinamilk': 'Vinamilk', 'viettel': 'Viettel',
  'vnpt': 'VNPT', 'agribank': 'Agribank', 'techcombank': 'Techcombank',
  'vietcombank': 'Vietcombank', 'vpbank': 'VPBank', 'mbbank': 'MBBank',
  'sacombank': 'Sacombank', 'shopee': 'Shopee', 'lazada': 'Lazada', 'tiki': 'Tiki',
  'grab': 'Grab', 'vng': 'VNG', 'google': 'Google', 'microsoft': 'Microsoft',
  'apple': 'Apple', 'facebook': 'Meta (Facebook)', 'meta': 'Meta',
  'amazon': 'Amazon', 'sony': 'Sony', 'tesla': 'Tesla', 'xiaomi': 'Xiaomi',
  'samsung': 'Samsung', 'lg': 'LG'
};

// Tỉnh/thành VN — fallback khi NER bỏ sót (không dấu)
const VIETNAM_PROVINCES = [
  'ha noi', 'hai phong', 'da nang', 'tp.hcm', 'tphcm', 'sai gon', 'can tho', 'da lat',
  'hai duong', 'hung yen', 'thai binh', 'nam dinh', 'ninh binh', 'thanh hoa',
  'nghe an', 'ha tinh', 'quang binh', 'quang tri', 'quang nam', 'quang ngai',
  'quang ninh', 'binh dinh', 'phu yen', 'khanh hoa', 'ninh thuan', 'binh thuan',
  'kon tum', 'gia lai', 'dak lak', 'dak nong', 'lam dong', 'phu tho', 'son la',
  'lai chau', 'dien bien', 'thai nguyen', 'lang son', 'cao bang', 'tuyen quang',
  'ha giang', 'yen bai', 'vinh phuc', 'bac giang', 'bac kan', 'bac ninh',
  'hoa binh', 'vinh long', 'an giang', 'tien giang', 'ben tre', 'tra vinh',
  'dong thap', 'long an', 'ca mau', 'soc trang', 'bac lieu', 'hau giang',
  'kien giang', 'tay ninh', 'binh phuoc', 'binh duong', 'dong nai', 'vung tau'
];

// Trigger từ khóa (key không dấu, khớp trên bản chuẩn hoá không dấu)
const PREF_TRIGGERS = ['thich', 'yeu', 'dam me', 'me', 'so thich', 'prefer', 'like', 'love'];
const DISLIKE_TRIGGERS = ['khong thich', 'ghet', 'dislike', 'hate', 'khong ua'];
const FACT_TRIGGERS = ['co', 'dang co', 'so huu', 'dang lam', 'dang hoc', 'dang theo', 'du dinh', 'se', 'chuan bi'];

// ─── HELPERS ────────────────────────────────────────────────────

function normalizeText(text) {
  if (!text) return '';
  return String(text).replace(/\s+/g, ' ').trim();
}

/** Bỏ dấu tiếng Việt → dạng ASCII để khớp từ điển. */
function removeDiacritics(str) {
  if (!str) return '';
  const map = {
    'àáảãạăằắẳẵặâầấẩẫậ': 'a', 'èéẻẽẹêềếểễệ': 'e',
    'ìíỉĩị': 'i', 'òóỏõọôồốổỗộơờớởỡợ': 'o',
    'ùúủũụưừứửữự': 'u', 'ỳýỷỹỵ': 'y',
    'đ': 'd', 'ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ': 'A',
    'ÈÉẺẼẸÊỀẾỂỄỆ': 'E', 'ÌÍỈĨỊ': 'I',
    'ÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ': 'O',
    'ÙÚỦŨỤƯỪỨỬỮỰ': 'U', 'ỲÝỶỸỴ': 'Y', 'Đ': 'D'
  };
  let out = '';
  for (const ch of str) {
    let replaced = false;
    for (const [group, target] of Object.entries(map)) {
      if (group.includes(ch)) { out += target; replaced = true; break; }
    }
    if (!replaced) out += ch;
  }
  return out;
}

/** Chuẩn hoá tên tiếng Việt: viết hoa chữ đầu mỗi từ, bỏ ký tự lạ. */
function cleanName(raw) {
  if (!raw) return null;
  const s = String(raw)
    .replace(/[.,;:!?()[\]„""''«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || s.length < 2 || s.length > 50) return null;
  if (/\d/.test(s)) return null;
  const words = s.split(' ');
  if (words.length > 4) return null;
  return words.map(w => {
    const lower = w.toLowerCase();
    if (!lower) return w;
    return lower.charAt(0).toLocaleUpperCase('vi') + lower.slice(1);
  }).join(' ');
}

/** Gộp token NER liền cùng loại → tên thực thể đầy đủ. */
function mergeEntityTokens(words, nerLabels) {
  const result = [];
  for (let i = 0; i < words.length; i++) {
    const label = nerLabels[i];
    if (!label || label === 'O') continue;
    const type = label.replace('B-', '').replace('I-', '');
    if (label.startsWith('B-')) {
      result.push({ type, value: words[i] });
    } else if (label.startsWith('I-') && result.length && result[result.length - 1].type === type) {
      result[result.length - 1].value += ' ' + words[i];
    }
  }
  return result.map(e => ({ type: e.type, value: cleanName(e.value) })).filter(e => e.value);
}

// ─── MAIN EXTRACTION ────────────────────────────────────────────

function extractEntities(text) {
  const entities = {
    name: null,
    phone: null,
    email: null,
    company: null,
    job: null,
    location: null,
    date: null,
    dates: [],
    urls: [],
    preferences: [],
    dislikes: [],
    facts: [],
    custom: []
  };

  if (!text || String(text).length < 3) return entities;

  const normalized = normalizeText(text);
  const flat = removeDiacritics(normalized).toLowerCase();

  // ── 1. Regex: SĐT, email, URL, ngày ──
  const phoneMatch = normalized.match(/(?:\+84|0)[3|5|7|8|9][0-9]{8}/g);
  if (phoneMatch) entities.phone = phoneMatch[0];

  const emailMatch = normalized.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (emailMatch) entities.email = emailMatch[0];

  const urlMatch = normalized.match(/https?:\/\/[^\s]+/gi);
  if (urlMatch) entities.urls = urlMatch.slice(0, 3);

  const datePatterns = [
    /(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/g,
    /(?:ngay\s+)?(\d{1,2})\s+thang\s+(\d{1,2})(?:,\s*(\d{4}))?/gi
  ];
  for (const p of datePatterns) {
    let m;
    while ((m = p.exec(normalized)) !== null) entities.dates.push(m[0].replace(/\s/g, ''));
  }
  if (entities.dates.length) entities.date = entities.dates[0];

  // ── 2. vntk NER (truyền chuỗi, không phải mảng) ──
  let nerNamed = [];
  try {
    const nerOut = nerTagger.tag(normalized);
    if (nerOut && nerOut.length) {
      const words = nerOut.map(t => t[0]);
      const labels = nerOut.map(t => t[3]);
      nerNamed = mergeEntityTokens(words, labels);
    }
  } catch (e) {
    console.warn('[Brain][NLP] vntk error:', e.message);
  }

  const nerNames = nerNamed.filter(e => e.type === 'PER').map(e => e.value);
  const nerLocs = nerNamed.filter(e => e.type === 'LOC').map(e => e.value);
  const nerOrgs = nerNamed.filter(e => e.type === 'ORG').map(e => e.value);

  // Lọc thực thể "nhiễu" (NER có thể gán nhầm cho từ thường, thú cưng...)
  const noiseWords = /(?:chó|ch[oó]|mèo|cún|chó con|con|một|tên|là|cái|mấy|còn|ngôi|nhà|xe|em đi|đây|thằng|năm\s|vừa rồi)/i;
  const companyLike = /(?:software|inc|corp|jsc|company|group|bank|trường|đại học|viện|học viện)/i;
  const SHORT_ENG = /^(hi|hello|ok|no|yes|hi there|i am|thank|sir|madam)\s*$/i;
  const pickNER = (arr, type) => {
    for (const v of arr) {
      if (noiseWords.test(v)) continue;
      if (v.length < 3) continue; // tên thực sự phải >= 3 ký tự
      if (type === 'LOC' && companyLike.test(v)) continue;
      if (SHORT_ENG.test(v)) continue;
      return v;
    }
    return null;
  };
  const goodName = pickNER(nerNames, 'PER');
  const goodLoc = pickNER(nerLocs, 'LOC');
  const goodOrg = pickNER(nerOrgs, 'ORG');

  if (goodName && !entities.name) entities.name = goodName;
  if (goodLoc && !entities.location) entities.location = goodLoc;
  if (goodOrg && !entities.company) entities.company = goodOrg;

// ── 3. Tên bổ sung qua patterns thường gặp (khớp bản có dấu) ──
  if (!entities.name) {
    const namePatterns = [
      /(?:tôi|mình|em)\s+tên\s+là\s+([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+){0,2})/i,
      /(?:tôi|mình|em)\s+được\s+gọi\s+là\s+([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+){0,2})/i,
      /(?:hi|chào|hello|xin chào)\s*,?\s*(?:tôi|mình|em|i)\s+(?:tên\s+)?(?:là|am|is)\s+([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+){0,2})/i,
      /(?:i am|i'm|i am|toi la|tôi là|anh là|chị là)\s+([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+){0,2})/i,
      /call\s+me\s+([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+){0,2})/i
    ];
    const banned = ['a', 'an', 'cái', 'đó', 'này', 'khi', 'xin', 'nhưng', 'làm', 'đi', 'về', 'được', 'mình', 'bạn', 'em', 'anh', 'chị', 'chó', 'mèo',
      'giáo viên', 'bác sĩ', 'kỹ sư', 'sinh viên', 'lập trình viên', 'developer', 'manager', 'giáo viên toán'];
    for (const pat of namePatterns) {
      const m = normalized.match(pat);
      if (m && m[1] && m.index < 80) {
        const n = cleanName(m[1]);
        if (n && !banned.includes(n.toLowerCase())) {
          entities.name = n;
          break;
        }
      }
    }
  }

  // ── 4. Nghề nghiệp (chặt nối flat, key dict chuẩn hoá không dấu) ──
  if (!entities.job) {
    for (const [key, val] of Object.entries(JOB_DICT)) {
      const flatKey = removeDiacritics(key).toLowerCase();
      const esc = flatKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[\\s.,;!?])${esc}(?=[\\s.,;!?]|$)`, 'i');
      if (re.test(flat)) { entities.job = val; break; }
    }
  }
  if (!entities.job) {
    const jobPatterns = [
      /(?:làm\s+nghề\s+|nghề nghiệp(?:\s+của\s+tôi)?\s*[là]?\s+)\s*([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+){0,2})/i,
      /(?:tôi\s+chuyên\s+về)\s+([^\.,!?\n]{2,40})/i,
    ];
    for (const pat of jobPatterns) {
      const m = normalized.match(pat);
      if (m && m[1] && !/\d/.test(m[1]) && m[1].length < 40) {
        entities.job = cleanName(m[1]);
        break;
      }
    }
  }

  // ── 5. Company (khớp bản không dấu) ──
  if (!entities.company) {
    for (const [key, val] of Object.entries(COMPANY_DICT)) {
      const flatKey = removeDiacritics(key).toLowerCase();
      const esc = flatKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[\\s.,;!?])${esc}(?=[\\s.,;!?]|$)`, 'i');
      if (re.test(flat)) { entities.company = val; break; }
    }
  }

  // ── 6. Location ──
  if (!entities.location) {
    for (const p of VIETNAM_PROVINCES) {
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[\\s.,;!?])${esc}(?=[\\s.,;!?]|$)`, 'i');
      if (re.test(flat)) {
        const pretty = p.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        entities.location = pretty;
        break;
      }
    }
  }
  if (!entities.location) {
    const locPatterns = [
      /(?:ở|tại|sống ở|đang ở|đang sống ở|đến từ|tới từ)\s+([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+){0,2})/i
    ];
    for (const pat of locPatterns) {
      const m = normalized.match(pat);
      if (m && m[1] && m[1].length > 3 && m[1].length < 30 &&
          !/^(tôi|bạn|mình|anh|chị|em|đó|này|rồi)/.test(m[1])) {
        entities.location = cleanName(m[1]);
        break;
      }
    }
  }

// ── 7. Preferences (khớp không dấu, lấy nội dung từ bản gốc có dấu) ──
  const prefTokens = new Set();
  for (const trig of PREF_TRIGGERS) {
    const esc = trig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:toi\\s+)?(?:${esc})\\s+([a-z0-9]{2,40}(?:\\s+[a-z0-9]{1,40})*)`, 'gi');
    let m;
    while ((m = re.exec(flat)) !== null) {
      const rawP = normalized.substr(m.index + m[0].length - m[1].length, m[1].length);
      let p = rawP.trim();
      p = p.replace(/[.,;!?]+$/, '').split(/\s+(?:và|với|nhưng)\s+/)[0].trim();
      if (p.length >= 2 && !/^(toi|ban|em|chi|anh|minh)\b/i.test(p) && !/(không thích|ghét)/i.test(p)) {
        prefTokens.add(p);
      }
    }
  }
  entities.preferences = [...prefTokens].slice(0, 6);

  // ── 8. Dislikes ──
  const dislikeSet = new Set();
  for (const trig of DISLIKE_TRIGGERS) {
    const esc = trig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:toi\\s+)?(?:${esc})\\s+([a-z0-9]{2,40}(?:\\s+[a-z0-9]{1,40})*)`, 'gi');
    let m;
    while ((m = re.exec(flat)) !== null) {
      const rawD = normalized.substr(m.index + m[0].length - m[1].length, m[1].length);
      let d = rawD.trim().replace(/[.,;!?]+$/, '');
      if (d.length >= 2 && !/^(?:toi|ban)\b/i.test(d)) dislikeSet.add(d);
    }
  }
  entities.dislikes = [...dislikeSet].slice(0, 4);

  // ── 9. Facts ──
  const factSet = new Set();
  for (const trig of FACT_TRIGGERS) {
    const esc = trig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:toi\\s+)?(?:${esc})\\s+([a-z0-9]{3,60}(?:\\s+[a-z0-9]{1,60})*)`, 'gi');
    let m;
    while ((m = re.exec(flat)) !== null) {
      const rawF = normalized.substr(m.index + m[0].length - m[1].length, m[1].length);
      let f = rawF.trim().replace(/[.,;!?]+$/, '');
      f = f.split(/\s+(?:và|với|nhưng|rồi)\s+/)[0].trim();
      if (f.length >= 4 && !/(^| )toi( |$)/i.test(f)) factSet.add(f);
    }
  }
  entities.facts = [...factSet].slice(0, 5);

  // ── 10. Custom entities (ORG, MISC...) ──
  entities.custom = nerNamed.filter(e => !['PER', 'LOC'].includes(e.type));

  // Cleanup
  for (const k of ['dates', 'urls', 'preferences', 'dislikes', 'facts', 'custom']) {
    if (Array.isArray(entities[k])) entities[k] = entities[k].filter(v => !!v);
  }

  return entities;
}

// ─── EXPORT ─────────────────────────────────────────────────────
module.exports = {
  extractEntities,
  cleanName,
  normalizeText,
  removeDiacritics,
  JOB_DICT,
  COMPANY_DICT,
  VIETNAM_PROVINCES
};