// background.js — poll lệnh từ Rexi, chuyển xuống tab OpenCut, trả kết quả.
const API = 'https://rexiai.bot.cd/api/services/opencut-bridge';

let port = null;      // long-lived port từ content-opencut (tab OpenCut)
let token = null;
let pollTimer = null;

function log(...a) { try { console.log('[RexiBridge]', ...a); } catch (e) {} }
function authHeaders() { return { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }; }

async function postResult(id, result) {
  if (!token) return;
  try { await fetch(API + '/result', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ id, result }) }); }
  catch (e) {}
}

function handleCmd(c) {
  if (c.action === 'screenshot') { captureShot(c.id); return; }
  if (!port) { postResult(c.id, { success: false, error: 'Chưa có tab OpenCut mở. Hãy mở https://opencut.app.' }); return; }
  try { port.postMessage({ type: 'cmd', id: c.id, action: c.action, args: c.args || {} }); }
  catch (e) { postResult(c.id, { success: false, error: 'port gửi lỗi: ' + e.message }); }
}

function captureShot(id) {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) { postResult(id, { success: false, error: 'Không tìm thấy tab đang mở' }); return; }
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          postResult(id, { success: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'capture lỗi' });
        } else {
          postResult(id, { success: true, screenshot: dataUrl });
        }
      });
    });
  } catch (e) { postResult(id, { success: false, error: String(e && e.message || e) }); }
}

async function pollOnce() {
  if (!token) return;
  try {
    const r = await fetch(API + '/poll', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ hasTab: !!port }) });
    if (r.ok) {
      const d = await r.json();
      for (const c of (d.commands || [])) handleCmd(c);
    } else if (r.status === 401) {
      token = null; // token hết hạn → chờ content-rexi đẩy lại
    }
  } catch (e) {}
}

function loop() { if (pollTimer) clearInterval(pollTimer); pollOnce(); pollTimer = setInterval(pollOnce, 1500); }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'token' && msg.token) {
    const changed = msg.token !== token;
    token = msg.token;
    chrome.storage.local.set({ rexi_token: token });
    if (changed) { log('token received'); loop(); }
    sendResponse && sendResponse({ ok: true });
  } else if (msg && msg.type === 'getStatus') {
    fetch(API + '/status', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => sendResponse && sendResponse({ hasToken: !!token, hasTab: !!port, ...d }))
      .catch(() => sendResponse && sendResponse({ hasToken: !!token, hasTab: !!port }));
    return true;
  }
  return true;
});

chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== 'opencut') return;
  port = p;
  p.onMessage.addListener((m) => { if (m && m.type === 'result') postResult(m.id, m.result || { success: true }); });
  p.onDisconnect.addListener(() => { if (port === p) port = null; });
});

chrome.storage.local.get(['rexi_token'], (r) => { if (r && r.rexi_token) { token = r.rexi_token; loop(); } });
