// ─────────────────────────────────────────────────────────────
// INTENT ROUTER — nhận diện ý định của câu chat → đề xuất tab/service
// Khi người dùng gõ "tạo ảnh con mèo", "xem VTV1", "đọc file này"...
// hệ thống tự biết nên chuyển sang tab nào (frontend) hoặc dùng
// service nào (backend).
// ─────────────────────────────────────────────────────────────
'use strict';

function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

// Bảng intent: pattern (không dấu, word-boundary) → tab + hành động gợi ý
// LƯU Ý M1: text đầu vào đã stripDiacritics → pattern chứa dấu không bao giờ match.
const INTENTS = [
  {
    id: 'image',
    tab: 'image',
    label: 'Tạo ảnh AI',
    patterns: /(\btao (anh|hinh anh)\b|\bve (mot |buc |mot buc )?anh\b|\bve buc tranh\b|\bhinh anh ai\b|\banh con\b|\blogo cho\b|\bbackground cho\b|\banh nen\b|\bgenerate (an )?image\b|\bdraw (an? |the )?image\b|\bmake (an )?image\b|\bcreate (an )?image\b)/i,
  },
  {
    id: 'iptv',
    tab: 'iptv',
    label: 'Xem truyền hình',
    patterns: /(\bxem (kenh |)?(tv|tivi|truyen hinh|vtv\d*|thvl\d*|htv\d*|hn1|vtc\d*|viettv)\b|\bmo (kenh|tv|tivi|truyen hinh)\b|\bkenh (vtv|thvl|htv|hn1|vtc|viettv)\b|\btruyen hinh\b|\bxem truc tiep kenh\b|\blive tv\b|\bwatch tv\b|\bturn on (the )?tv\b)/i,
  },
  {
    id: 'documents',
    tab: 'documents',
    label: 'Đọc & hiểu file',
    patterns: /(\bdoc (file|tai lieu|pdf|word|txt|van ban)\b|\btom tat (file|tai lieu|pdf|word)\b|\bhieu (file|tai lieu)\b|\bphan tich (file|pdf|tai lieu)\b|\bsummarize (this )?(file|pdf|document)\b|\bread (the )?(file|pdf|document)\b)/i,
  },
  {
    id: 'youtube',
    tab: 'youtube',
    label: 'YouTube',
    patterns: /(\byoutube\b|\bvideo youtube\b|\bxem video (khong quang cao|tren youtube)\b|\btai video youtube\b|\bdownload youtube\b|\btai video\b)/i,
  },
  {
    id: 'tts',
    tab: 'tts',
    label: 'Chuyển giọng nói',
    patterns: /(\bchuyen (van ban|text|chu) thanh giong\b|\bdoc (van ban|text) thanh tieng\b|\btts\b|\btext to speech\b|\bgiong noi\b|\bchuyen chu thanh giong\b)/i,
  },
  {
    id: 'video',
    tab: 'video',
    label: 'Tạo video',
    patterns: /(\btao video\b|\blam video\b|\bvideo tu (anh|hinh|mau)\b|\bcreate a video\b|\bmake a video\b|\bvideo creator\b)/i,
  },
  {
    id: 'opencut',
    tab: 'opencut',
    label: 'Edit video',
    patterns: /(\bcat video\b|\bedit video\b|\bchinh sua video\b|\bmontage\b|\bdung video\b|\bopencut\b)/i,
  },
  {
    id: 'code',
    tab: 'code',
    label: 'Code & Preview',
    patterns: /(\bcode giup\b|\bviet (code|trang web|web|html|website)\b|\btao (web|trang web|website)\b|\bcode editor\b|\bpreview html\b|\blam website\b|\bxay dung website\b)/i,
  },
  {
    id: 'games',
    tab: 'games',
    label: 'Game Zone',
    patterns: /(\bchoi (game|tro choi)\b|\bgame\b|\btro choi\b|\bminigame\b|\bhtml5 game\b|\bplay (a )?game\b)/i,
  },
  {
    id: 'browser',
    tab: 'browser',
    label: 'Browser Agent',
    patterns: /(\bmo (trang web|website|url|web|trang)\b|\btruy cap (web|website|trang web)\b|\bdieu khien trinh duyet\b|\bbrowser agent\b|\bmo (web|website|trang web)\b)/i,
  },
  {
    id: 'agent',
    tab: 'chat',
    label: 'Agent Mode',
    patterns: /(\bthuc thi\b|\bchay (lenh|script|code nay)\b|\btu dong thuc hien\b|\bagent mode\b|\bexecutes? (this )?(code|script|task)\b)/i,
  },
];

/**
 * Nhận diện ý định.
 * @param {string} text
 * @returns {{ intent: string|null, tab: string|null, label: string|null, confidence: 'high'|'medium'|'none' }}
 */
function detectIntent(text) {
  const t = stripDiacritics(String(text || '')).toLowerCase();
  for (const intent of INTENTS) {
    const m = intent.patterns.exec(t);
    if (m) {
      const matched = m[0].trim().length;
      if (matched < 3) continue;
      return {
        intent: intent.id,
        tab: intent.tab,
        label: intent.label,
        confidence: matched >= 12 ? 'high' : 'medium',
      };
    }
  }
  return { intent: null, tab: null, label: null, confidence: 'none' };
}

module.exports = { detectIntent, INTENTS };
