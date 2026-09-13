// ─────────────────────────────────────────────────────────────
// ROUTING TELEMETRY — thống kê hoạt động định tuyến
// Ghi nhận mỗi lần route/fallback/health để admin xem được:
// - Provider nào hay được chọn nhất
// - Fallback bao nhiêu lần, từ đâu sang đâu
// - Model nào chậm / hay lỗi
// Lưu trong bộ nhớ (đủ cho dashboard) + tuỳ chọn ghi DB.
// ─────────────────────────────────────────────────────────────
'use strict';

const MAX_EVENTS = 500;

const _state = {
  events: [],          // [{ ts, type, provider, model, from, to, ms, ok }]
  byProvider: {},      // provider -> { count, fallbackCount, totalMs, errors }
  byCategory: {},      // category -> count
  totals: { routed: 0, fallbacks: 0, errors: 0 },
  startedAt: Date.now(),
};

function _record(ev) {
  _state.events.push(ev);
  if (_state.events.length > MAX_EVENTS) _state.events.shift();

  const p = ev.provider || 'unknown';
  if (!_state.byProvider[p]) _state.byProvider[p] = { count: 0, fallbackCount: 0, totalMs: 0, errors: 0 };
  const stat = _state.byProvider[p];
  stat.count++;
  if (ev.ms) stat.totalMs += ev.ms;
  if (ev.from) { stat.fallbackCount++; _state.totals.fallbacks++; }
  if (ev.ok === false) { stat.errors++; _state.totals.errors++; }

  if (ev.category) {
    if (!_state.byCategory[ev.category]) _state.byCategory[ev.category] = 0;
    _state.byCategory[ev.category]++;
  }
  _state.totals.routed++;
}

// Ghi nhận 1 lần route thành công
function recordRoute({ provider, model, category, ms, userTier }) {
  _record({ ts: Date.now(), type: 'route', provider, model, category, ms, ok: true, userTier });
}

// Ghi nhận 1 lần fallback (provider A lỗi → B)
function recordFallback({ from, to, model, reason }) {
  _record({ ts: Date.now(), type: 'fallback', provider: to, from, model, ok: true, reason });
}

// Ghi nhận lỗi
function recordError({ provider, model, reason }) {
  _record({ ts: Date.now(), type: 'error', provider, model, ok: false, reason });
}

// Ghi nhận health check
function recordHealth(results) {
  for (const r of results || []) {
    _record({ ts: Date.now(), type: 'health', provider: r.provider, ok: r.ok, ms: r.ms });
  }
}

// Lấy báo cáo cho admin
function getReport() {
  const providers = Object.entries(_state.byProvider)
    .map(([name, s]) => ({
      provider: name,
      count: s.count,
      fallbackCount: s.fallbackCount,
      avgMs: s.count ? Math.round(s.totalMs / s.count) : 0,
      errors: s.errors,
      errorRate: s.count ? Math.round((s.errors / s.count) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totals: _state.totals,
    providers,
    byCategory: _state.byCategory,
    recentEvents: _state.events.slice(-20).reverse(),
    uptimeMs: Date.now() - _state.startedAt,
  };
}

// Reset (test)
function reset() {
  _state.events = [];
  _state.byProvider = {};
  _state.byCategory = {};
  _state.totals = { routed: 0, fallbacks: 0, errors: 0 };
  _state.startedAt = Date.now();
}

module.exports = {
  recordRoute, recordFallback, recordError, recordHealth, getReport, reset,
};
