/**
 * Rexi AI BRAIN — SENTIMENT + INTENT CLASSIFIER (Phase 1: NLP Core)
 *
 * Phân tích tiếng Việt KHÔNG gọi LLM:
 *  - Sentiment: từ điển + negator + intensifier
 *  - Intent: 12 nhóm mệnh quan để chọn hành vi phản hồi
 *
 * Chi phí: 100% local.
 */

const { removeDiacritics, tokenize } = require('./tokenizer-utils');

// ─── TỪ ĐIỂN CẢM XÚC (key không dấu) ───────────────────────────
const POSITIVE_LEXICON = {
  'thich': 2, 'yeu': 2, 'vui': 2, 'vui ve': 2, 'happy': 2, 'happ': 2,
  'tuyet voi': 3, 'great': 3, 'amazing': 3, 'awesome': 3, 'excellent': 3,
  'dep': 2, 'xinh': 2, 'tuyet': 2, 'gioi': 2, 'nhanh': 1, 'tien ich': 2,
  'cam on': 2, 'thank': 2, 'thanks': 2, 'thank you': 2, 'sung suong': 3,
  'han hanh': 2, 'cuoi': 2, 'hehe': 1, 'haha': 1, 'on': 1, 'ok': 1, 'oke': 1,
  'okay': 1, 'tot': 1, 'hop ly': 1, 'tue': 2
};

const NEGATIVE_LEXICON = {
  'ghet': -3, 'khong thich': -2, 'hate': -3, 'buon': -2, 'lo': -2, 'lo lang': -2,
  'so': -2, 'kho chiu': -2, 'tuc': -2, 'gian': -2, 'that vong': -3, 'te': -2,
  'xau': -2, 'toi te': -2, 'that bai': -3, 'fail': -3, 'loi': -1, 'bug': -2,
  'met': -1, 'stress': -2, 'bi quan': -1, 'chang': -1, 'kho': -1
};

// Negator đảo chiều điểm
const NEGATIONS = ['khong', 'chang', 'chang co', 'khong he'];

// STAR cứ làm hỗn loạn: dùng từ điển nguyên bản

/**
 * Phân tích cảm xúc văn bản tiếng Việt.
 * Return { score, label, degree, keywords }
 */
function analyzeSentiment(rawText) {
  if (!rawText) return { score: 0, label: 'neutral', degree: 'khong', keywords: [] };

  const flat = removeDiacritics(rawText).toLowerCase();
  const tokens = tokenize(rawText);
  let score = 0;
  let negated = false;
  const found = [];

  for (const rawTok of tokens) {
    const tok = removeDiacritics(rawTok).toLowerCase();
    if (NEGATIONS.includes(tok)) {
      negated = !negated;
      continue;
    }
    let weight;
    if (POSITIVE_LEXICON[tok] !== undefined) {
      weight = POSITIVE_LEXICON[tok];
      found.push(rawTok);
    } else if (NEGATIVE_LEXICON[tok] !== undefined) {
      weight = NEGATIVE_LEXICON[tok];
      found.push(rawTok);
    }
    if (weight !== undefined) {
      score += negated ? -weight : weight;
      negated = false;
    }
  }

  let degree = 'khong';
  if (Math.abs(score) >= 4) degree = 'cao';
  else if (Math.abs(score) >= 2) degree = 'trung';
  else if (score !== 0) degree = 'nhe';

  const label = score > 0 ? 'positive' : (score < 0 ? 'negative' : 'neutral');

  return { score, label, degree, keywords: found.slice(0, 6) };
}

// ─── INTENT CLASSIFIER ──────────────────────────────────────────
const INTENT_PATTERNS = {
  chao_hoi: [
    /^\s*(xin chao|chao|hello|hi|hey|chao buoi)\b/i,
    /^\s*(good morning|good afternoon|good evening)\b/i
  ],
  tam_biet: [
    /tam biet|bye\b|goodbye|hen gap lai|chan hang/i
  ],
  cau_hoi: [
    /\b(?:la gi|ai|sao|tim dau|nao|bao gio|nhu the nao|the nao|khong the nao)\b/i,
    /(?:cho.*biet|biet khong|tim hieu|giai thich|dien gai)/i,
    /\?/,
    /(?:duoc khong|co the|co the khong|cach nao)\b/i
  ],
  yeu_cau_hang_dong: [
    /(?:hay|giup|nhieu|vui long|tao|lam|toan|toan soan gui goi|mo|thuc hien)/i,
    /(?:create|make|write|generate|send|please|do)\b/i
  ],
  chia_se: [
    /chia se|tam su|noi chuyen|phai truyen/i
  ],
  phan_nan: [
    /\b(?:loi|bug|error|problem|slow|bad|fail|sai|cham|te qua|do qua|kho chiu|tu gan|that bai)\b/i,
    /(?:hong hon|hong di|hong\s)/i,
    /khong (?:hieu|duoc|ho tro|theo)\b/i
  ],
  khen_ngoi: [
    /(?:tuyet voi|hay qua|lam gi|gioi|thong minh|nhanh qua|ok\b|cam on)/i,
    /(?:great|nice|good|cool|awesome|thanks)/i
  ],
  yeu_cau_thong_tin: [
    /(?:tu van|gioi thieu|goi y|de xuat|tim hieu)/i,
    /(?:recommend|suggest|advice|tell me|information)/i
  ],
  yes_no: [
    /^\s*(co|dung|duoc|ok\b|ung|to|vang|yes\b|no\b|khong)\b/i
  ],
  tom_tat: [
    /(?:tom tat|ket luan|summary|recap|nhac lai|nho lai)/i
  ],
  scheduling: [
    /(?:cuoc hop|lich|hen|deadline|ke hoach|project|cong viec)/i
  ],
  chia_buon: [
    /(?:chia buon|buon qua|met qua|stress|met moi)/i
  ]
};

function detectIntent(text) {
  if (!text) return { action: 'khong_ro', confidence: 0 };
  const t = removeDiacritics(text).toLowerCase().trim();

  const ordered = [
    ['tam_biet', INTENT_PATTERNS.tam_biet],
    ['chao_hoi', INTENT_PATTERNS.chao_hoi],
    ['phan_nan', INTENT_PATTERNS.phan_nan],
    ['khen_ngoi', INTENT_PATTERNS.khen_ngoi],
    ['scheduling', INTENT_PATTERNS.scheduling],
    ['chia_buon', INTENT_PATTERNS.chia_buon],
    ['cau_hoi', INTENT_PATTERNS.cau_hoi],
    ['yeu_cau_hang_dong', INTENT_PATTERNS.yeu_cau_hang_dong],
    ['yeu_cau_thong_tin', INTENT_PATTERNS.yeu_cau_thong_tin],
    ['tom_tat', INTENT_PATTERNS.tom_tat],
    ['yes_no', INTENT_PATTERNS.yes_no]
  ];

  for (const [action, pats] of ordered) {
    for (const re of pats) {
      if (re && re.test && re.test(t)) return { action, confidence: 0.8 };
    }
  }
  return { action: 'hoi_thoai', confidence: 0.4 };
}

module.exports = {
  analyzeSentiment,
  detectIntent,
  INTENT_PATTERNS,
  POSITIVE_LEXICON,
  NEGATIVE_LEXICON
};