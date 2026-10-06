/**
 * Rexi AI BRAIN — MEMORY SIMILARITY (Phase 2: Memory Layer)
 *
 * Đo độ tương đồng giữa 2 chuỗi tiếng Việt để chống trùng lặp memory.
 * Dùng Jaccard trên từ-bag (không dấu) + trọng số keyword.
 * Chi phí: 100% local (không gọi LLM).
 */

const { tokenize, removeDiacritics } = require('../nlp/tokenizer-utils');

const STOP_OVERLAP_TRESHOLD = 0.55; // trên ngưỡng này là "giống nhau"

function tokenBag(text) {
  const toks = tokenize(text);
  return toks
    .map(t => removeDiacritics(t).toLowerCase())
    .filter(t => t.length > 1);
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

/** Jaccard trên unigram + bigram — bắt tốt hơn câu trùng ý khác từ. */
function similarity(a, b) {
  if (!a || !b) return 0;
  const flatA = removeDiacritics(a).toLowerCase();
  const flatB = removeDiacritics(b).toLowerCase();
  if (flatA === flatB) return 1;

  const bagA = tokenBag(a);
  const bagB = tokenBag(b);
  if (bagA.length === 0 || bagB.length === 0) return 0;

  // bigram của từ (n-gram mức từ)
  const bigrams = (arr) => {
    const out = [];
    for (let i = 0; i < arr.length - 1; i++) out.push(arr[i] + ' ' + arr[i + 1]);
    return out;
  };
  const bgA = bigrams(bagA);
  const bgB = bigrams(bagB);

  const jU = jaccard(bagA, bagB);
  const jB = jaccard(bgA, bgB);
  // 70% uni + 30% bi để cân bằng chính xác
  return Math.min(1, jU * 0.7 + jB * 0.3);
}

function isDuplicateMemory(existing, candidate) {
  if (!existing || !candidate) return false;
  const sim = similarity(existing, candidate);
  return sim >= STOP_OVERLAP_TRESHOLD;
}

module.exports = { similarity, isDuplicateMemory, tokenBag };