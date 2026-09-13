// ─────────────────────────────────────────────────────────────
// TEST: modelRouter (phân loại + chọn model) & intentRouter
// ─────────────────────────────────────────────────────────────
'use strict';

const modelRouter = require('../../src/services/modelRouter');
const { detectIntent } = require('../../src/services/intentRouter');

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}

(async () => {
  console.log('\n=== MODEL ROUTER: phân loại câu hỏi ===');

  // Phân loại (không cần gọi API — dùng classify trực tiếp)
  const cases = [
    ['2+2 bang may?', 'math'],
    ['viet code javascript tinh tong', 'code'],
    ['tai sao troi mua? giai thich chi tiet', 'complex'],
    ['tại sao trời mưa? giải thích chi tiết', 'complex'],
    ['dich cau nay sang tieng anh', 'translate'],
    ['dịch câu này sang tiếng anh', 'translate'],
    ['viet bai van ve que huong', 'writing'],
    ['viết bài văn về quê hương', 'writing'],
    ['xin chao ban khoe khong', 'general'],
    ['hinh anh nay noi gi', 'vision'],
    ['1+1', 'deep'], // thinkingLevel deep
  ];
  for (const [text, expected] of cases) {
    const opts = expected === 'deep' ? { thinkingLevel: 'deep' } : {};
    const got = modelRouter.classify(text, opts);
    assert(got === expected, `classify("${text.slice(0, 30)}...") = ${got} (expect ${expected})`);
  }

  console.log('\n=== MODEL ROUTER: chọn model (candidates có sẵn) ===');
  const route = await modelRouter.pickRoute('viet code javascript tinh tong', {});
  assert(route.candidates.length > 0, 'code route có candidates');
  assert(route.candidates[0].provider === 'opencode', 'code route ưu tiên opencode free');
  assert(/big-pickle|hy3|free/i.test(route.candidates[0].model), 'code route chọn model code free');

  const route2 = await modelRouter.pickRoute('xin chao', {});
  assert(route2.candidates[0].provider === 'opencode', 'general route ưu tiên opencode free');

  console.log('\n=== MODEL ROUTER: health check loại provider hỏng ===');
  // Giả lập: cohere hỏng
  modelRouter.setHealth([
    { provider: 'cohere', ok: false },
    { provider: 'xkiro', ok: true },
    { provider: 'mistral', ok: true },
  ]);
  const translateRoute = await modelRouter.pickRoute('dich cau nay sang tieng anh', {});
  assert(!translateRoute.candidates.some(c => c.provider === 'cohere'), 'cohere hỏng bị loại khỏi translate route');
  assert(translateRoute.candidates[0].provider === 'opencode', 'translate fallback sang opencode free (cohere hỏng bị né)');
  modelRouter.setHealth([]); // reset

  console.log('\n=== INTENT ROUTER ===');
  const i1 = detectIntent('tạo ảnh con mèo dễ thương');
  assert(i1.intent === 'image' && i1.tab === 'image', `"tạo ảnh..." → image (got ${i1.intent})`);
  const i2 = detectIntent('xem kênh VTV1');
  assert(i2.intent === 'iptv', `"xem kênh" → iptv (got ${i2.intent})`);
  const i3 = detectIntent('đọc file PDF này giúp tôi');
  assert(i3.intent === 'documents', `"đọc file" → documents (got ${i3.intent})`);
  const i4 = detectIntent('chuyển văn bản này thành giọng nói');
  assert(i4.intent === 'tts', `"thành giọng nói" → tts (got ${i4.intent})`);
  const i5 = detectIntent('2+2 bằng mấy?');
  assert(i5.intent === null, `"2+2" → không có intent (got ${i5.intent})`);
  const i6 = detectIntent('mo trang web google.com');
  assert(i6.intent === 'browser', `"mở trang web" → browser (got ${i6.intent})`);
  const i7 = detectIntent('viet code website ban hang');
  assert(i7.intent === 'code', `"viết code website" → code (got ${i7.intent})`);

  console.log(`\n─── KẾT QUẢ: ${pass} đạt ✓  ${fail} lỗi ✗ ───`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
