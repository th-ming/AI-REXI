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

// Bảng intent: pattern (không dấu) → tab + hành động gợi ý
const INTENTS = [
  {
    id: 'image',
    tab: 'image',
    label: 'Tạo ảnh AI',
    patterns: /(tao anh|ve (mot |buc )?anh|generate image|draw |ve buc tranh|tao hinh anh|hinh anh ai|vẽ ảnh|tạo ảnh|draw an? image|make an image|create an image|anh con|logo cho|background cho|ảnh nền)/i,
  },
  {
    id: 'iptv',
    tab: 'iptv',
    label: 'Xem truyền hình',
    patterns: /(xem (kenh|tv|tivi|truyen hinh)|mo (kenh|tv|tivi)|kenh (vtv|thvl|htv|hn1|vtc|viettv)|truyền hình|xem trực tiếp kênh|channels?|live tv|watch tv)/i,
  },
  {
    id: 'documents',
    tab: 'documents',
    label: 'Đọc & hiểu file',
    patterns: /(doc (file|tai lieu|pdf|word|txt|vb)|tom tat (file|tai lieu|pdf|word)|hiểu (file|tài liệu)|đọc file|đọc pdf|phân tích (file|pdf|tài liệu)|summarize (this )?(file|pdf|document)|read (the )?(file|pdf|document))/i,
  },
  {
    id: 'youtube',
    tab: 'youtube',
    label: 'YouTube',
    patterns: /(youtube|video youtube|xem video (khong quang cao|trên youtube)|tai video youtube|download youtube|tải video)/i,
  },
  {
    id: 'tts',
    tab: 'tts',
    label: 'Chuyển giọng nói',
    patterns: /(chuyen (van ban|text|chữ) thanh giong|doc (van ban|text) thanh tieng|tts|text to speech|giong noi|giọng nói|chuyển chữ thành giọng)/i,
  },
  {
    id: 'video',
    tab: 'video',
    label: 'Tạo video',
    patterns: /(tao video|lam video|video tu (anh|hinh|mau)|create a video|make a video|video creator)/i,
  },
  {
    id: 'opencut',
    tab: 'opencut',
    label: 'Edit video',
    patterns: /(cat video|edit video|chinh sua video|montage|dựng video|opencut)/i,
  },
  {
    id: 'code',
    tab: 'code',
    label: 'Code & Preview',
    patterns: /(code giup|viet (code|trang web|web|html|website)|tao (web|trang web|website)|code editor|preview html|làm website|xây dựng website)/i,
  },
  {
    id: 'games',
    tab: 'games',
    label: 'Game Zone',
    patterns: /(choi (game|tro choi)|game|trò chơi|minigame|html5 game)/i,
  },
  {
    id: 'browser',
    tab: 'browser',
    label: 'Browser Agent',
    patterns: /(mo (trang web|website|url|web|trang) ?(giup)?|truy cap (web|website|trang web)|dieu khien trinh duyet|browser agent|mở (web|website|trang web))/i,
  },
  {
    id: 'agent',
    tab: 'chat',
    label: 'Agent Mode',
    patterns: /(thuc thi|chay (lenh|script|code nay)|tự động thực hiện|agent mode|executes? (this )?(code|script|task))/i,
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
      const matched = m[0].length;
      return {
        intent: intent.id,
        tab: intent.tab,
        label: intent.label,
        confidence: matched >= 12 ? 'high' : matched >= 6 ? 'medium' : 'none',
      };
    }
  }
  return { intent: null, tab: null, label: null, confidence: 'none' };
}

module.exports = { detectIntent, INTENTS };
