/**
 * opencutBridge.js — cầu nối Rexi agent ↔ extension trình duyệt (HTTP polling).
 *
 * Lý do dùng polling thay WebSocket: nhiều WebSocketServer có `path` trên cùng 1 HTTP
 * server đè nhau (ws abort 400 khi path không khớp) → tránh hẳn bằng HTTP thường.
 *
 * Luồng:
 *  - Agent gọi tool opencut_act → enqueue(action, args) → chờ kết quả (timeout).
 *  - Extension (background) poll /api/opencut-bridge/poll mỗi ~1.5s → nhận lệnh.
 *  - Extension thao tác tab OpenCut → POST /api/opencut-bridge/result {id, result}.
 */

const queue = [];          // lệnh chờ extension lấy
const pending = new Map(); // id -> { resolve, timer }
let seq = 0;
let lastPollTs = 0;        // lần cuối extension poll
let lastPollHasTab = false; // extension báo có tab OpenCut

function enqueue(action, args = {}, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const id = ++seq;
    queue.push({ id, action, args, ts: Date.now() });
    const timer = setTimeout(() => {
      pending.delete(id);
      // xoá khỏi queue nếu chưa ai lấy
      const i = queue.findIndex(c => c.id === id);
      if (i >= 0) queue.splice(i, 1);
      resolve({ success: false, error: 'Timeout: extension không phản hồi cho "' + action + '". Kiểm tra đã cài/mở extension + tab opencut.app chưa.' });
    }, timeoutMs);
    pending.set(id, { resolve, timer });
  });
}

// Extension gọi để lấy lệnh (và báo còn sống / có tab)
function poll(hasTab) {
  lastPollTs = Date.now();
  lastPollHasTab = !!hasTab;
  const cmds = queue.splice(0, queue.length);
  return cmds;
}

function submitResult(msg) {
  if (!msg || msg.id == null) return { ok: false };
  lastPollTs = Date.now();
  const p = pending.get(msg.id);
  if (!p) return { ok: false, note: 'id không còn chờ (đã timeout?)' };
  clearTimeout(p.timer);
  pending.delete(msg.id);
  p.resolve(msg.result && typeof msg.result === 'object' ? msg.result : { success: false, error: 'result rỗng' });
  return { ok: true };
}

function status() {
  return {
    connected: (Date.now() - lastPollTs) < 8000,
    lastPollAgoSec: lastPollTs ? Math.round((Date.now() - lastPollTs) / 1000) : null,
    hasTab: lastPollHasTab,
    queued: queue.length,
    inFlight: pending.size,
  };
}

module.exports = { enqueue, poll, submitResult, status };
