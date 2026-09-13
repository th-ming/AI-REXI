// ─────────────────────────────────────────────────────────────
// TEST NÂNG CAO: quotaManager + user-tier + latency + telemetry + skillRouter
// ─────────────────────────────────────────────────────────────
'use strict';

const quota = require('../../src/services/quotaManager');
const telemetry = require('../../src/services/telemetry');
const modelRouter = require('../../src/services/modelRouter');
const { pickSkills } = require('../../src/services/skillRouter');

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}

(async () => {
  console.log('\n=== QUOTA MANAGER ===');
  quota.reset();
  assert(!quota.isQuotaExceeded('gemini'), 'gemini chưa vượt quota ban đầu');
  for (let i = 0; i < 5; i++) quota.recordUse('gemini');
  assert(quota.isQuotaExceeded('gemini'), 'gemini vượt quota sau 5 lần');
  assert(quota.remaining('gemini') === 0, 'gemini còn 0 lượt');
  assert(!quota.isQuotaExceeded('xkiro'), 'xkiro không bị giới hạn');
  assert(quota.remaining('unknown') === Infinity, 'provider không có rule → vô hạn');

  console.log('\n=== QUOTA FILTER ===');
  const candidates = [
    { provider: 'gemini', model: 'x' },
    { provider: 'xkiro', model: 'y' },
  ];
  const filtered = quota.filterByQuota(candidates);
  assert(filtered.length === 1 && filtered[0].provider === 'xkiro', 'filterByQuota loại gemini hết quota');
  quota.reset();

  console.log('\n=== USER TIER ===');
  assert(modelRouter.providerAllowedForTier('xkiro', 'guest'), 'guest được xkiro');
  assert(modelRouter.providerAllowedForTier('nvidia', 'guest'), 'guest CŨNG được nvidia (công bằng)');
  assert(modelRouter.providerAllowedForTier('nvidia', 'user'), 'user được nvidia');
  assert(modelRouter.providerAllowedForTier('gemini', 'admin'), 'admin được tất cả');

  console.log('\n=== LATENCY ===');
  modelRouter.recordLatency('groq', 200);
  modelRouter.recordLatency('groq', 400);
  assert(modelRouter.getLatency('groq') === 300, 'latency trung bình groq = 300ms');
  assert(modelRouter.getLatency('nvidia') === null, 'chưa đo nvidia → null');

  console.log('\n=== TELEMETRY ===');
  telemetry.reset();
  telemetry.recordRoute({ provider: 'xkiro', model: 'm1', category: 'code', userTier: 'admin' });
  telemetry.recordRoute({ provider: 'groq', model: 'm2', category: 'general', userTier: 'user' });
  telemetry.recordFallback({ from: 'cohere', to: 'xkiro', model: 'm1', reason: 'test' });
  telemetry.recordError({ provider: 'cohere', model: 'm3', reason: 'quota' });
  const rep = telemetry.getReport();
  assert(rep.totals.routed === 4, `tổng route = 4 (2 route + 1 fallback + 1 error) (got ${rep.totals.routed})`);
  assert(rep.totals.fallbacks === 1, 'fallback = 1');
  assert(rep.totals.errors === 1, 'error = 1');
  assert(rep.providers.length === 3, '3 provider có thống kê (xkiro, groq, cohere)');
  assert(rep.byCategory.code === 1 && rep.byCategory.general === 1, 'thống kê theo category');
  telemetry.reset();

  console.log('\n=== SKILL ROUTER ===');
  const skills = [
    { ten_ky_nang: 'ppt', tieu_de: 'PowerPoint', mo_ta: '' },
    { ten_ky_nang: 'frontend-design', tieu_de: 'Design', mo_ta: '' },
    { ten_ky_nang: 'code-review', tieu_de: 'Review', mo_ta: '' },
    { ten_ky_nang: 'vietnamese-tts', tieu_de: 'TTS', mo_ta: '' },
    { ten_ky_nang: 'deploy-to-vercel', tieu_de: 'Deploy', mo_ta: '' },
  ];
  const p1 = pickSkills('lam slide thuyet trinh', skills).map(s => s.ten_ky_nang);
  assert(p1.includes('ppt'), 'slide → chọn ppt');
  const p2 = pickSkills('review code giup toi', skills).map(s => s.ten_ky_nang);
  assert(p2.includes('code-review'), 'review code → chọn code-review');
  const p3 = pickSkills('deploy len vercel', skills).map(s => s.ten_ky_nang);
  assert(p3.includes('deploy-to-vercel'), 'deploy vercel → chọn deploy-to-vercel');
  const p4 = pickSkills('xin chao', skills);
  assert(p4.length === 0, 'câu thường → không chọn skill');

  console.log(`\n─── KẾT QUẢ NÂNG CAO: ${pass} đạt ✓  ${fail} lỗi ✗ ───`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
