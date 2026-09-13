// ─── ĐA NGÔN NGỮ (vi/en) — module dịch giao diện ───
const translations = {
  vi: {
    brand: 'AI REXI OS',
    chatPlaceholder: "Gõ câu hỏi ở đây rồi bấm Enter — VD: 'Soạn giúp tôi kịch bản video...'",
    exportMd: 'Xuất Markdown',
    ttsBrowser: 'Trình duyệt (miễn phí)',
    ttsServer: 'Server (edge-tts chất lượng cao)',
    fast: '⚡ Nhanh (Standard)',
    deep: '🧠 Suy Luận Sâu (Deep Think)',
    guestMode: 'Chế độ Khách',
    login: 'Đăng nhập →',
    newChat: 'Trò chuyện mới',
    autoProvider: 'Tự động chuyển Provider',
    speak: 'Đọc',
    stop: 'Dừng',
    voiceInput: 'Nhập bằng giọng nói',
    reasoning: 'Suy luận sâu',
    send: 'Gửi',
  },
  en: {
    brand: 'AI REXI OS',
    chatPlaceholder: "Type your question here and press Enter — e.g. 'Write me a video script...'",
    exportMd: 'Export Markdown',
    ttsBrowser: 'Browser (free)',
    ttsServer: 'Server (edge-tts high quality)',
    fast: '⚡ Fast (Standard)',
    deep: '🧠 Deep Think',
    guestMode: 'Guest Mode',
    login: 'Login →',
    newChat: 'New chat',
    autoProvider: 'Auto provider switch',
    speak: 'Speak',
    stop: 'Stop',
    voiceInput: 'Voice input',
    reasoning: 'Deep thinking',
    send: 'Send',
  }
};

export function getLang() {
  try { return localStorage.getItem('rexi_lang') || 'vi'; } catch (e) { return 'vi'; }
}

export function setLang(l) {
  try { localStorage.setItem('rexi_lang', l); } catch (e) {}
}

export function t(lang, key) {
  return (translations[lang] && translations[lang][key]) || translations.vi[key] || key;
}

export const LANGS = ['vi', 'en'];
