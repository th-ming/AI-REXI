/**
 * AI REXI BRAIN — TOKENIZER UTILS + STOPWORDS VIỆT (Phase 1: NLP Core)
 *
 * Công cụ chuẩn hoá văn bản tiếng Việt:
 *  - removeDiacritics: bỏ dấu (khớp từ điển không dấu)
 *  - tokenize: tách token bằng vntk wordTokenizer + bỏ stopword
 *  - extractKeywords: top-K từ khoá quan trọng (tần suất TF)
 *
 * Chi phí: 100% local.
 */

const { wordTokenizer } = require('vntk');

const tokenizer = wordTokenizer();

// Dấu → ánh xạ không dấu (giữ nguyên độ dài từng ký tự => index 1:1)
const DIACRITIC_MAP = {
  'à': 'a', 'á': 'a', 'ả': 'a', 'ã': 'a', 'ạ': 'a',
  'ă': 'a', 'ằ': 'a', 'ắ': 'a', 'ẳ': 'a', 'ẵ': 'a', 'ặ': 'a',
  'â': 'a', 'ầ': 'a', 'ấ': 'a', 'ẩ': 'a', 'ẫ': 'a', 'ậ': 'a',
  'è': 'e', 'é': 'e', 'ẻ': 'e', 'ẽ': 'e', 'ẹ': 'e',
  'ê': 'e', 'ề': 'e', 'ế': 'e', 'ể': 'e', 'ễ': 'e', 'ệ': 'e',
  'ì': 'i', 'í': 'i', 'ỉ': 'i', 'ĩ': 'i', 'ị': 'i',
  'ò': 'o', 'ó': 'o', 'ỏ': 'o', 'õ': 'o', 'ọ': 'o',
  'ô': 'o', 'ồ': 'o', 'ố': 'o', 'ổ': 'o', 'ỗ': 'o', 'ộ': 'o',
  'ơ': 'o', 'ờ': 'o', 'ớ': 'o', 'ở': 'o', 'ỡ': 'o', 'ợ': 'o',
  'ù': 'u', 'ú': 'u', 'ủ': 'u', 'ũ': 'u', 'ụ': 'u',
  'ư': 'u', 'ừ': 'u', 'ứ': 'u', 'ử': 'u', 'ữ': 'u', 'ự': 'u',
  'ỳ': 'y', 'ý': 'y', 'ỷ': 'y', 'ỹ': 'y', 'ỵ': 'y',
  'đ': 'd',
  'À': 'A', 'Á': 'A', 'Ả': 'A', 'Ã': 'A', 'Ạ': 'A',
  'Ă': 'A', 'Ằ': 'A', 'Ắ': 'A', 'Ẳ': 'A', 'Ẵ': 'A', 'Ặ': 'A',
  'Â': 'A', 'Ầ': 'A', 'Ấ': 'A', 'Ẩ': 'A', 'Ẫ': 'A', 'Ậ': 'A',
  'È': 'E', 'É': 'E', 'Ẻ': 'E', 'Ẽ': 'E', 'Ẹ': 'E',
  'Ê': 'E', 'Ề': 'E', 'Ế': 'E', 'Ể': 'E', 'Ễ': 'E', 'Ệ': 'E',
  'Ì': 'I', 'Í': 'I', 'Ỉ': 'I', 'Ĩ': 'I', 'Ị': 'I',
  'Ò': 'O', 'Ó': 'O', 'Ỏ': 'O', 'Õ': 'O', 'Ọ': 'O',
  'Ô': 'O', 'Ồ': 'O', 'Ố': 'O', 'Ổ': 'O', 'Ỗ': 'O', 'Ộ': 'O',
  'Ơ': 'O', 'Ờ': 'O', 'Ớ': 'O', 'Ở': 'O', 'Ỡ': 'O', 'Ợ': 'O',
  'Ù': 'U', 'Ú': 'U', 'Ủ': 'U', 'Ũ': 'U', 'Ụ': 'U',
  'Ư': 'U', 'Ừ': 'U', 'Ứ': 'U', 'Ử': 'U', 'Ữ': 'U', 'Ự': 'U',
  'Ỳ': 'Y', 'Ý': 'Y', 'Ỷ': 'Y', 'Ỹ': 'Y', 'Ỵ': 'Y',
  'Đ': 'D'
};

// Stopwords tiếng Việt — từ nối, đại từ, trợ từ không mang nghĩa khoá
const STOPWORDS_VI = [
  // đại từ
  'tôi', 'mình', 'bạn', 'anh', 'chị', 'em', 'chú', 'cô', 'ta', 'tớ',
  'chúng', 'chúng ta', 'chúng tôi', 'các', 'những', 'này', 'đó', 'kia', 'ấy',
  'ai', 'gì', 'đâu', 'nào', 'bao', 'bấy',
  // trợ từ / quan hệ từ
  'và', 'với', 'của', 'là', 'có', 'tại', 'trong', 'trên', 'dưới', 'ngoài',
  'không', 'không phải', 'chẳng', 'được', 'sẽ', 'đã', 'đang', 'vừa', 'mới',
  'lại', 'còn', 'cũng', 'rồi', 'thì', 'như', 'nhưng', 'hoặc', 'hay', 'nếu',
  'vì', 'cho', 'để', 'từ', 'tới', 'ra', 'vào', 'lên', 'xuống', 'về',
  'cái', 'một', 'những', 'đây', 'đó', 'kia', 'ấy', 'bây giờ', 'lắm', 'quá',
  // liên từ + mở rộng câu hỏi
  'à', 'ạ', 'nhé', 'nha', 'nhỉ', 'thế', 'sao', 'thế nào', 'như nào',
  'ok', 'đúng', 'vậy', 'thì', 'mà', 'thôi',
  // english stopwords
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'could', 'may', 'might', 'can', 'shall', 'i', 'you', 'he', 'she', 'it',
  'we', 'they', 'this', 'that', 'these', 'those', 'my', 'your', 'his',
  'her', 'its', 'our', 'their', 'on', 'of', 'to', 'from', 'with', 'and',
  'or', 'but', 'if', 'for', 'in', 'at', 'by', 'about', 'so', 'not', 'no'
].filter(s => s.length > 0).sort((a, b) => b.length - a.length); // dài trước (ưu tiên ghép)

// Bộ đếm: cần ripple stopwords theo từ khối — vị trí hữu ích với wordSent loại bỏ trợ từ dài (VD "không phải" là 1 token thật)

const NOISE_WORDS = new Set([
  'lắm', 'quá', 'nhé', 'nha', 'thật', 'xong', 'típ', 'đi', 'liền', 'chứ',
  'luôn', 'mà', 'ạ', 'ỗi', 'ôi', 'ồ', 'ơ', 'uh', 'oke', 'okie', 'skđ'
]);

/**
 * Bỏ dấu giữ index 1:1 với chuỗi gốc.
 */
function removeDiacritics(str) {
  if (!str) return '';
  let out = '';
  for (const ch of String(str)) {
    out += DIACRITIC_MAP[ch] !== undefined ? DIACRITIC_MAP[ch] : ch;
  }
  return out;
}

/** Chuẩn hoá: gộp khoảng trắng, trim, bỏ ký tự điều khiển. */
function normalize(text) {
  if (!text) return '';
  return String(text).replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Kiểm tra token có phải stopword (không dấu) không. */
function isStopword(word, flat) {
  const w = removeDiacritics(word).toLowerCase();
  if (NOISE_WORDS.has(w)) return true;
  return STOPWORDS_VI.some(sw => removeDiacritics(sw).toLowerCase() === w || w === sw);
}

/**
 * Tách từ bằng vntk → array token (từ ghép được bảo lưu).
 */
function tokenize(text) {
  if (!text) return [];
  try {
    const t = tokenizer.tag(normalize(text));
    return Array.isArray(t) ? t : [];
  } catch (e) {
    // fallback: tách theo khoảng trắng
    return normalize(text).split(/\s+/).filter(Boolean);
  }
}

/**
 * Trích token liên quan (bỏ stopword, giữ từ ≥ 2 ký tự).
 */
function contentTokens(text) {
  const flatLower = removeDiacritics(text).toLowerCase();
  return tokenize(text).filter(t =>
    t && t.length >= 2 && !/^\d+$/.test(t) && !isStopword(t, flatLower)
  );
}

/**
 * Trích keywords (tần suất TF) cho việc search memory context.
 * Trả về array tối đa `max` từ khoá.
 */
function extractKeywords(text, max = 6) {
  const toks = contentTokens(text);
  const freq = {};
  for (const t of toks) {
    const key = removeDiacritics(t).toLowerCase();
    freq[key] = (freq[key] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k]) => k);
}

/** N-gram có cleaned text để tính similarity. */
function tokenBag(text) {
  return tokenize(text).map(t => removeDiacritics(t).toLowerCase()).filter(t => t.length > 1);
}

module.exports = {
  removeDiacritics,
  normalize,
  tokenize,
  contentTokens,
  extractKeywords,
  tokenBag,
  isStopword,
  STOPWORDS_VN: STOPWORDS_VI,
  DIACRITIC_MAP
};