// content-opencut.js — chạy trong tab opencut.app; nhận lệnh từ agent và thao tác DOM.
const port = chrome.runtime.connect({ name: 'opencut' });
port.postMessage({ type: 'hello' });

// Giữ service worker sống + poll lệnh liên tục (MV3 SW bị Chrome kill khi idle)
function pingPoll() { try { chrome.runtime.sendMessage({ type: 'pollNow' }, () => { void chrome.runtime.lastError; }); } catch (e) {} }
pingPoll();
setInterval(pingPoll, 1500);

function send(id, result) { try { port.postMessage({ type: 'result', id, result }); } catch (e) {} }

function findByText(t) {
  if (!t) return null;
  const want = String(t).trim().toLowerCase();
  const els = [...document.querySelectorAll('button,a,[role="button"],label,li,span,div')];
  return els.find(e => (e.innerText || '').trim().toLowerCase() === want)
      || els.find(e => (e.innerText || '').trim().toLowerCase().includes(want));
}

async function run(action, args) {
  switch (action) {
    case 'eval': {
      // eval trong isolated world — truy cập DOM OK (không vào biến JS của trang)
      // eslint-disable-next-line no-eval
      const v = await (async () => eval(args.code || ''))();
      let out = v;
      try { out = JSON.parse(JSON.stringify(v)); } catch (e) { out = String(v); }
      return { result: out };
    }
    case 'click': {
      const el = args.selector ? document.querySelector(args.selector) : findByText(args.text);
      if (!el) throw new Error('Không thấy phần tử: ' + (args.selector || args.text));
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { clicked: true, tag: el.tagName, text: (el.innerText || '').slice(0, 60) };
    }
    case 'type': {
      const el = args.selector ? document.querySelector(args.selector) : document.activeElement;
      if (!el) throw new Error('Không thấy ô nhập (selector/activeElement)');
      el.focus();
      if ('value' in el) {
        el.value = args.text || '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        document.execCommand('insertText', false, args.text || '');
      }
      return { typed: true };
    }
    case 'text':
      return { text: (document.body ? document.body.innerText : '').slice(0, 8000), url: location.href, title: document.title };
    case 'list': {
      const items = [...document.querySelectorAll('button,[role="button"],a')]
        .map(b => ({ tag: b.tagName, text: (b.innerText || '').trim().slice(0, 50), aria: b.getAttribute('aria-label') || '' }))
        .filter(x => x.text || x.aria).slice(0, 150);
      return { count: items.length, items };
    }
    case 'wait': {
      const ms = Math.max(0, Math.min(Number(args.ms) || 1000, 15000));
      await new Promise(r => setTimeout(r, ms));
      return { waited: ms };
    }
    default:
      throw new Error('action không hỗ trợ: ' + action);
  }
}

port.onMessage.addListener(async (m) => {
  if (!m || m.type !== 'cmd') return;
  try { const r = await run(m.action, m.args || {}); send(m.id, { success: true, ...r }); }
  catch (e) { send(m.id, { success: false, error: String(e && e.message || e) }); }
});

// Báo đã sẵn sàng (kèm trạng thái tab)
send('hello', { success: true, ready: true, url: location.href });
