// background.js — giữ WebSocket tới Rexi, chuyển lệnh agent → tab OpenCut.
const WS_URL = 'wss://rexiai.bot.cd/api/opencut-bridge';

let ws = null;
let port = null;      // long-lived port từ content-opencut (tab OpenCut)
let token = null;
let status = 'idle';
let reconnectTimer = null;

function log(...a) { try { console.log('[RexiBridge]', ...a); } catch (e) {} }

function connect() {
  if (!token) { status = 'no-token'; return; }
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  try { ws = new WebSocket(WS_URL + '?token=' + encodeURIComponent(token)); }
  catch (e) { status = 'error'; log('ws create err', e); scheduleReconnect(); return; }

  ws.onopen = () => { status = 'connected'; log('WS connected'); };
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type === 'cmd') {
      if (port) {
        try { port.postMessage({ type: 'cmd', id: msg.id, action: msg.action, args: msg.args || {} }); }
        catch (e) { sendResult(msg.id, { success: false, error: 'port gửi lỗi: ' + e.message }); }
      } else {
        sendResult(msg.id, { success: false, error: 'Chưa có tab OpenCut mở. Hãy mở https://opencut.app.' });
      }
    }
  };
  ws.onclose = () => { status = 'disconnected'; log('WS closed'); scheduleReconnect(); };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 3000);
}

function sendResult(id, result) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify({ type: 'result', id, ...result })); } catch (e) {}
  }
}

// Token đẩy từ content-rexi (đọc localStorage rexiai.bot.cd)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'token' && msg.token) {
    if (msg.token !== token) {
      token = msg.token;
      chrome.storage.local.set({ rexi_token: token });
      if (ws) { try { ws.close(); } catch (e) {} ws = null; }
      connect();
    }
    sendResponse && sendResponse({ ok: true, status });
  } else if (msg && msg.type === 'getStatus') {
    sendResponse && sendResponse({ status, hasToken: !!token, hasTab: !!port });
  }
  return true;
});

// Port dài hạn từ tab OpenCut
chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== 'opencut') return;
  port = p;
  status = status === 'connected' ? 'connected' : status;
  p.onMessage.addListener((m) => {
    if (m && m.type === 'result') sendResult(m.id, m.result || { success: true });
  });
  p.onDisconnect.addListener(() => { if (port === p) port = null; });
});

// Khởi động: nạp token đã lưu
chrome.storage.local.get(['rexi_token'], (r) => {
  if (r && r.rexi_token) { token = r.rexi_token; connect(); }
});
