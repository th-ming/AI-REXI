/**
 * opencutBridge.js — cầu nối Rexi agent ↔ extension trình duyệt người dùng.
 *
 * Luồng: Extension (chạy trên opencut.app) mở WebSocket tới server → giữ 1 kết nối.
 * Agent gọi tool opencut_act → sendCommand() → đẩy lệnh xuống extension → extension
 * thao tác DOM trong tab OpenCut → trả kết quả ngược lại.
 */
const clients = new Set();
let seq = 0;
const pending = new Map();

function setWSS(wss, opts = {}) {
  wss.on('connection', (ws, req) => {
    if (typeof opts.verify === 'function') {
      try { if (!opts.verify(ws, req)) { try { ws.close(4001, 'Unauthorized'); } catch (e) {} return; } }
      catch (e) { try { ws.close(4001, 'Unauthorized'); } catch (e2) {} return; }
    }
    clients.add(ws);
    try { ws.send(JSON.stringify({ type: 'hello', ok: true, clients: clients.size })); } catch (e) {}

    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (msg && msg.type === 'result' && msg.id != null) {
        const p = pending.get(msg.id);
        if (p) { clearTimeout(p.timer); pending.delete(msg.id); p.resolve(msg); }
      } else if (msg && msg.type === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch (e) {}
      }
    });
    const drop = () => clients.delete(ws);
    ws.on('close', drop);
    ws.on('error', drop);
  });
}

function connectedCount() { return clients.size; }

function firstClient() { for (const c of clients) return c; return null; }

function sendCommand(action, args = {}, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const ws = firstClient();
    if (!ws) {
      return resolve({ success: false, error: 'Chưa có extension kết nối. Mở https://opencut.app và bật extension Rexi OpenCut Bridge (đã đăng nhập rexiai.bot.cd).' });
    }
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); resolve({ success: false, error: 'Timeout: extension không phản hồi cho "' + action + '"' }); }, timeoutMs);
    pending.set(id, { resolve, timer });
    try { ws.send(JSON.stringify({ type: 'cmd', id, action, args })); }
    catch (e) { clearTimeout(timer); pending.delete(id); resolve({ success: false, error: 'Gửi lệnh lỗi: ' + e.message }); }
  });
}

module.exports = { setWSS, sendCommand, connectedCount };
