/**
 * sanitize.js — XSS-safe HTML helpers (P2-14 Chat XSS, P2-15 README XSS).
 *
 * - sanitizeHtml / sanitizeMarkdown: chạy DOMPurify (browser) với allowlist tag
 *   cơ bản + FORBID các tag nguy hiểm (form/script/iframe/meta/...).
 * - isSafeHttpUrl / safeHref / escapeAttr / mdToHtml: hàm THUẦN (không cần DOM)
 *   → test được bằng `node -e` (xem cuối file).
 */
import DOMPurify from 'dompurify';
import { marked } from 'marked';

// ─── DOMPurify config: allowlist tag cơ bản, giữ class/target/rel/small ───
const PURIFY_CFG = {
  ADD_TAGS: ['small'],
  ADD_ATTR: ['target', 'rel', 'class'],
  FORBID_TAGS: [
    'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed',
    'applet', 'form', 'input', 'button', 'textarea', 'select', 'option',
    'meta', 'link', 'base', 'noscript', 'template', 'slot', 'title',
  ],
};

/** Sanitize HTML thô (giữ tag trình bày cơ bản, chặn event handler / javascript: / form...). */
export function sanitizeHtml(dirty) {
  if (!dirty) return '';
  try {
    return DOMPurify.sanitize(String(dirty), PURIFY_CFG);
  } catch {
    return '';
  }
}

/** Render markdown (marked) rồi sanitize — dùng cho bubble chat assistant/admin. */
export function sanitizeMarkdown(md) {
  if (!md) return '';
  let html = '';
  try {
    html = marked.parse(String(md), { breaks: true });
  } catch {
    html = String(md);
  }
  return sanitizeHtml(html);
}

// ─── URL helpers (THUẦN — không cần DOM, test được bằng node) ───

/** Bỏ whitespace/control chars (kẻ tấn công dùng `java<tab>script:` để lách check scheme). */
export function stripCtrlChars(u) {
  // Không dùng regex escape (dễ bị ghi sai thành ký tự control thật) — lọc theo charCode.
  return String(u || '').split('').filter((c) => c.charCodeAt(0) > 32 && c.charCodeAt(0) !== 127).join('');
}

/**
 * Chỉ cho phép http/https (absolute) hoặc URL tương đối / #fragment.
 * Chặn: javascript:, data:, vbscript:, file:, blob: (kể cả lách bằng control chars / hoa thường).
 */
export function isSafeHttpUrl(u) {
  const raw = String(u || '').trim();
  if (!raw) return false;
  if (/^\\\\/.test(raw)) return false; // UNC path
  if (/["<>]/.test(raw)) return false; // `"`/`<>` không bao giờ hợp lệ khi chưa encode — chặn attr breakout từ gốc
  const nospace = stripCtrlChars(raw);
  const schemeMatch = nospace.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    return scheme === 'http' || scheme === 'https';
  }
  return true; // URL tương đối (./img.png, /path, #frag, plain) — an toàn
}

export function safeHref(u, fallback = '') {
  return isSafeHttpUrl(u) ? String(u) : fallback;
}

/** Escape cho nội dung chèn vào attribute HTML (chặn attr breakout qua `"`). */
export function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── mdToHtml (THUẦN — chuyển từ GitHubTrending.jsx, đã harden P2-15) ───
// Thứ tự: escape & < > " TRƯỚC, rồi mới thay link/img (URL qua isSafeHttpUrl + escapeAttr).
export function mdToHtml(md) {
  if (!md) return '';
  let html = String(md)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) =>
    `<pre class="bg-black/40 rounded-lg p-3 my-2 overflow-x-auto text-[11px] leading-relaxed"><code>${code.trim()}</code></pre>`);
  // headings
  html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>')
    .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
    .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>');
  // blockquote
  html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
  // images — URL không an toàn → drop tag, chỉ giữ alt text
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
    const url = String(src).replace(/&quot;/g, '"').trim();
    if (!isSafeHttpUrl(url)) return escapeAttr(alt);
    return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" class="max-w-full rounded-lg my-2" loading="lazy" />`;
  });
  // links — URL không an toàn → render text thường (không <a>)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, href) => {
    const url = String(href).replace(/&quot;/g, '"').trim();
    if (!isSafeHttpUrl(url)) return `${text}`;
    return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="text-cyan-400 hover:underline">${text}</a>`;
  });
  // bold + italic + inline code
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-white/10 rounded px-1 py-0.5 text-[10px]">$1</code>');
  // lists
  html = html.replace(/^(\s*)[-*] (.*)$/gm, '$1<li>$2</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul class="list-disc pl-4 my-2 space-y-0.5">$1</ul>');
  html = html.replace(/^(\s*)\d+\. (.*)$/gm, '$1<li>$2</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ol class="list-decimal pl-4 my-2 space-y-0.5">$1</ol>');
  // horizontal rules
  html = html.replace(/^---$/gm, '<hr class="my-3 border-white/10" />');
  // paragraphs (lines not consumed by blocks)
  html = html.split(/\n\n+/).map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|img)/.test(trimmed)) return trimmed;
    return `<p class="my-1.5 text-[12px] leading-relaxed">${trimmed}</p>`;
  }).join('\n');
  return html;
}
