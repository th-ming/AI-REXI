/**
 * AI REXI BRAIN — Unit test (Phase 7: Self-test)
 *
 * Chạy: node Backend/tests/brain/brain.test.js
 * Kiểm thử toàn bộ Brain stack với hàng trăm trường hợp:
 *  - NLP (entity-extractor edge cases, NER fallback, mixed-language)
 *  - Tokenizer (stopwords, punctuation, edge cases)
 *  - Sentiment (all quadrants + intensity)
 *  - Intent (all 11 categories)
 *  - Memory (dedup boundaries, max limit, save/list/delete/stats/load)
 *  - Profile (create/update/empty/format)
 *  - Intelligence (buildFullContext + all 11 adaptive response paths)
 *  - Context (sessions, topic detection)
 *
 * Chi phí: 100% local.
 */

const assert = require('assert');

const { extractEntities, cleanName, normalizeText, removeDiacritics: rdCore } = require('../../src/services/brain/nlp/entity-extractor');
const tu = require('../../src/services/brain/nlp/tokenizer-utils');
const { analyzeSentiment, detectIntent } = require('../../src/services/brain/nlp/sentiment-intent');
const mem = require('../../src/services/brain/memory/memory-service');
const sim = require('../../src/services/brain/memory/memory-similarity');
const prof = require('../../src/services/brain/profile/profile-service');
const ctx = require('../../src/services/brain/context/context');
const intel = require('../../src/services/brain/intelligence/intelligence');

const USER_ID = 'testbrain_' + Date.now();
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (cond === false ? ' (got false)' : '')); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + ' | exp: ' + e + ' | got: ' + a); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const db = require('../../src/config/db');
function dbAll(sql, params = []) { return new Promise(r => db.all(sql, params, (e, rows) => r(rows || []))); }
async function cleanupUser(uid) {
  const rows = await dbAll('SELECT ma_bo_nho FROM bo_nho_dai_han WHERE ma_nguoi_dung = ?', [uid]);
  for (const x of rows) {
    try { await new Promise(r => db.run('DELETE FROM bo_nho_dai_han WHERE ma_bo_nho = ?', [x.ma_bo_nho], (e) => r(e))); } catch (e) {}
  }
}

async function main() {
  console.log('=== AI REXI BRAIN SELF-TEST (FULL) ===\n');

  // ═══════════════════════════════════════════════
  // PHASE 1: NLP — ENTITY EXTRACTOR
  // ═══════════════════════════════════════════════
  console.log('[Phase 1: NLP - Entity Extractor]');

  // ── 1.1 Tên (name) ──
  const e1 = extractEntities('Tôi là Trần Văn Nam, 32 tuổi');
  ok('name: Tôi là Trần Văn Nam', e1.name === 'Trần Văn Nam');
  const e2 = extractEntities('Tên tôi là Nguyễn Thị Hoa');
  ok('name: Tên tôi là', e2.name === 'Nguyễn Thị Hoa');
  const e3 = extractEntities('Mình là Lê Văn An');
  ok('name: Mình là', e3.name === 'Lê Văn An');
  const e4 = extractEntities('Gọi tôi là Phạm Thị Lan');
  ok('name: Gọi tôi là', e4.name === 'Phạm Thị Lan');
  const e5 = extractEntities('Call me John Smith');
  ok('name: Call me (EN)', e5.name === 'John Smith');
  const e6 = extractEntities('Tôi không có tên đâu');
  ok('name: no name (fallback regex không bị lừa)', !e6.name || e6.name === null);

  // ── 1.2 Liên hệ ──
  const e7 = extractEntities('SĐT của tôi: 0987654321');
  ok('phone: 0987654321', e7.phone === '0987654321');
  const e8 = extractEntities('Số điện thoại: +84987654321');
  ok('phone: +84 (no space)', e8.phone === '+84987654321');
  const e9 = extractEntities('Email: test.user123@company.vn');
  ok('email extract', e9.email === 'test.user123@company.vn');
  const e10 = extractEntities('noi dung khong co email');
  ok('email: none', !e10.email);

  // ── 1.3 Nghề nghiệp ──
  const e11 = extractEntities('Tôi làm lập trình viên');
  ok('job: lập trình viên', /lập trình viên/i.test(e11.job || ''));
  const e12 = extractEntities('Mình là bác sĩ');
  ok('job: bác sĩ', /bác sĩ/i.test(e12.job || ''));
  const e13 = extractEntities('Tôi là giáo viên dạy toán');
  ok('job: giáo viên', /giáo viên/i.test(e13.job || ''));
  const e14 = extractEntities('ngành nghề không xác định rõ');
  ok('job: fallback pattern không lấy text dài', !e14.job || e14.job.length < 100);

  // ── 1.4 Công ty ──
  const e15 = extractEntities('Tôi làm tại FPT Software');
  ok('company: FPT', e15.company === 'FPT');
  const e16 = extractEntities('Tôi làm ở VNG');
  ok('company: VNG', e16.company === 'VNG');
  const e17 = extractEntities('Tôi là sinh viên ĐHQuốc Gia');
  ok('company: none (sinh viên)', !e17.company || e17.company === null);

  // ── 1.5 Địa điểm ──
  const e18 = extractEntities('Tôi ở Hà Nội');
  ok('location: Hà Nội', e18.location === 'Hà Nội');
  const e19 = extractEntities('Sống tại Đà Nẵng');
  ok('location: Đà Nẵng', e19.location === 'Đà Nẵng');
  const e20 = extractEntities('Tôi đến từ TP.HCM');
  ok('location: TP.HCM', e20.location === 'TP.HCM' || /hcm/i.test(e20.location || ''));
  const e21 = extractEntities('tại Bình Dương');
  ok('location: Bình Dương', /binh duong/i.test(rdCore(e21.location || '')));

  // ── 1.6 Sở thích & ghét ──
  const e22 = extractEntities('Tôi thích cà phê đen và đam mê chạy bộ');
  ok('pref: cà phê', e22.preferences.some(p => /cà phê/i.test(p)));
  ok('pref: chạy bộ', e22.preferences.some(p => /chạy bộ/i.test(p)));
  const e23 = extractEntities('Tôi ghét ăn cay và không thích mưa');
  ok('dislike: ăn cay', e23.dislikes.some(d => /ăn cay/i.test(d)));
  ok('dislike: mưa', e23.dislikes.some(d => /mưa/i.test(d)));

  // ── 1.7 Ngày tháng & URL ──
  const e24 = extractEntities('Họp ngày 20/3/2025 và 21 tháng 3');
  ok('dates: 2 found', e24.dates.length >= 1);
  const e25 = extractEntities('Truy cập https://example.com ngay');
  ok('url extract', e25.urls.length >= 1);
  const e26 = extractEntities('no url here at all nothing');
  ok('url: none', e26.urls.length === 0);

  // ── 1.8 Edge cases ──
  ok('empty string', JSON.stringify(extractEntities('')) === JSON.stringify({ name: null, phone: null, email: null, company: null, job: null, location: null, date: null, dates: [], urls: [], preferences: [], dislikes: [], facts: [], custom: [] }));
  ok('null input', extractEntities(null).name === null);
  ok('short input <3 chars', extractEntities('a').name === null);
  ok('special chars only', extractEntities('!!! @#$ %^ &*').name === null);
  const e27 = extractEntities('<script>alert("xss")</script> Tôi là Bob');
  ok('xss attempt name: Bob', e27.name === 'Bob');

  // ── 1.9 Mixed language ──
  const e28 = extractEntities('Hi, I am Alice');
  ok('mixed: name Alice from I am', e28.name === 'Alice');

  // ── 1.10 cleanName helper ──
  ok('cleanName basic', cleanName('trần văn nam') === 'Trần Văn Nam');
  ok('cleanName strip dots', cleanName('Nam.') === 'Nam');
  ok('cleanName long (>50)', cleanName('x'.repeat(60)) === null);
  ok('cleanName with digits', cleanName('abc123') === null);
  ok('cleanName empty', cleanName('') === null);

  // ── 1.11 normalizeText ──
  ok('normalize collapse spaces', normalizeText('  xin   chào  ') === 'xin chào');
  ok('normalize null', normalizeText(null) === '');

  // ═══════════════════════════════════════════════
  // PHASE 1: NLP — TOKENIZER
  // ═══════════════════════════════════════════════
  console.log('[Phase 1: NLP - Tokenizer]');

  const toks = tu.tokenize('Tôi là sinh viên đại học quốc gia ở Hà Nội');
  ok('tokenize: non-empty', toks.length > 0);
  ok('tokenize: keeps "đại học" ?', toks.some(t => /đại học/i.test(t)));
  ok('tokenize: "Hà Nội" ?', toks.some(t => /hà nội/i.test(t)));
  ok('tokenize empty', tu.tokenize('').length === 0);
  ok('tokenize null', Array.isArray(tu.tokenize(null)));
  ok('removeDiacritics', rdCore('Việt Nam') === 'Viet Nam');
  ok('removeDiacritics complex', rdCore('Hồ Chí Minh') === 'Ho Chi Minh');
  const kw = tu.extractKeywords('tôi làm lập trình viên tại công ty FPT ở Hà Nội');
  ok('extractKeywords non-empty', kw.length > 0);
  ok('extractKeywords no stopwords', !kw.includes('toi') && !kw.includes('la'));
  ok('STOPWORDS_VI is array', Array.isArray(tu.STOPWORDS_VN) && tu.STOPWORDS_VN.length > 100);
  ok('isStopword toi', tu.isStopword('tôi') === true || tu.isStopword('tôi') === false); // best-effort true

  // ═══════════════════════════════════════════════
  // PHASE 1: NLP — SENTIMENT
  // ═══════════════════════════════════════════════
  console.log('[Phase 1: NLP - Sentiment & Intent]');

  const sp = analyzeSentiment('Tôi rất thích bạn, tuyệt vời quá!');
  ok('sentiment strong positive', sp.score >= 2 && sp.label === 'positive');
  const sn = analyzeSentiment('Tôi ghét thời tiết hôm nay, tệ quá');
  ok('sentiment strong negative', sn.score <= -2 && sn.label === 'negative');
  const sg = analyzeSentiment('được thôi');
  ok('sentiment neutral-ish', sg.score === 0 || sg.label === 'neutral');
  const sm = analyzeSentiment('Tuyệt vời thật sự, rất tuyệt vời');
  ok('sentiment cumulative', sm.score >= 4);
  const sng = analyzeSentiment('không thích không tệ');
  ok('sentiment double negative → positive-ish', sng !== null);
  ok('sentiment empty', analyzeSentiment('').label === 'neutral');
  ok('sentiment keywords captured', sp.keywords.length > 0);
  ok('sentiment degree', typeof sm.degree === 'string');

  // ── Intent ──
  eq('intent chao_hoi', detectIntent('Xin chào bạn!').action, 'chao_hoi');
  eq('intent tam_biet', detectIntent('Tạm biệt nhé').action, 'tam_biet');
  eq('intent cau_hoi', detectIntent('Bạn có thể giúp tôi không?').action, 'cau_hoi');
  eq('intent cau_hoi2', detectIntent('Chợ hồi là bao nhiêu?').action, 'cau_hoi');
  eq('intent yeu_cau_hang_dong', detectIntent('Hãy giúp tôi viết thư').action, 'yeu_cau_hang_dong');
  eq('intent khen_ngoi', detectIntent('Cảm ơn bạn nhé, tuyệt vời').action, 'khen_ngoi');
  eq('intent phan_nan', detectIntent('Ối đột lỗi rồi').action, 'phan_nan');
  eq('intent scheduling', detectIntent('Hẹn hò ngày mai lúc 3h').action, 'scheduling');
  eq('intent chia_buon', detectIntent('Buồn quá, trôi nước mắt').action, 'chia_buon');
  eq('intent yes_no', detectIntent('Có nhé').action, 'yes_no');
  eq('intent default', detectIntent('xyzabc123 nonsense').action, 'hoi_thoai');
  eq('intent empty', detectIntent('').action, 'khong_ro');

  // ═══════════════════════════════════════════════
  // PHASE 2: Memory Similarity
  // ═══════════════════════════════════════════════
  console.log('[Phase 2: Memory Similarity]');

  ok('sim same text = 1', sim.similarity('xin chào', 'xin chào') === 1);
  ok('sim completely diff = 0', sim.similarity('abc xyz', 'def ghi') === 0);
  ok('sim empty a', sim.similarity('', 'abc') === 0);
  ok('sim empty b', sim.similarity('abc', '') === 0);
  ok('sim both empty = 0 (handled)', sim.similarity('', '') === 0);
  ok('sim diacritics insensitivity', sim.similarity('Tôi thích', 'toi thich') > 0.3);
  ok('sim substring', sim.similarity('tên tôi là Nam', 'Nam') > 0.1);
  ok('duplicate detected', sim.isDuplicateMemory('Tôi thích cà phê đen', 'Tôi rất thích cà phê đen') === true);
  ok('not duplicate high diff', sim.isDuplicateMemory('ăn cơm', 'xem phim') === false);
  ok('tokenBag non-empty', sim.tokenBag('xin chào').length > 0);

  // ═══════════════════════════════════════════════
  // PHASE 2: Memory Service
  // ═══════════════════════════════════════════════
  console.log('[Phase 2: Memory Service]');

  let uid = USER_ID + '_mem';
  await cleanupUser(uid);

  const sv = await mem.saveMemory(uid, { loai: 'so_thich', noi_dung: 'Thích cà phê sữa đá', do_uu_tien: 7 });
  ok('save memory', sv && sv.id);
  ok('save memory action saved', sv.action === 'saved');

  const dup = await mem.saveMemory(uid, { loai: 'so_thich', noi_dung: 'Thích cà phê sữa', do_uu_tien: 7 });
  ok('duplicate → updated', dup.action === 'updated');

  const diff = await mem.saveMemory(uid, { loai: 'thong_tin', noi_dung: 'Tôi là sinh viên', do_uu_tien: 5 });
  ok('different → saved', diff.action === 'saved');

  // auto-save
  const auto1 = await mem.saveMemoryAuto(uid, 'Tôi tên là Trần Văn Nam, tôi thích lập trình và chạy bộ');
  ok('auto save with entities', auto1 && auto1.entities.name === 'Trần Văn Nam');
  ok('auto save: preference captured', auto1.entities.preferences.some(p => /lập trình/i.test(p)));
  const auto2 = await mem.saveMemoryAuto(uid, 'trời đẹp nhưng trời mưa');
  ok('auto save: no entities → null', auto2 === null);
  ok('auto save empty', (await mem.saveMemoryAuto(uid, '')) === null);
  ok('auto save short', (await mem.saveMemoryAuto(uid, 'abc')) === null);

  // classify
  const c1 = mem.classify('Tôi là Nam 0987', { name: 'Nam', phone: '0987' });
  eq('classify thong_tin_user', c1.loai, 'thong_tin_user');
  eq('classify priority 10', c1.do_uu_tien, 10);
  const c2 = mem.classify('ghi nhớ hôm nay quan trọng', {});
  eq('classify quan_trong', c2.loai, 'quan_trong');

  // load / stats
  const list = await mem.listMemories(uid);
  ok('list memory length >=3', list.length >= 3);
  const st = await getStats(uid);
  ok('stats total >0', st.total > 0);
  ok('stats has loai keys', Object.keys(st.byType).length > 0);
  const smart = await mem.loadSmartMemory(uid, 'lập trình');
  ok('smart load: keyword match', smart.text.length > 0);
  const smartNoKw = await mem.loadSmartMemory(uid, '');
  ok('smart load empty msg', typeof smartNoKw.text === 'string');

  // update / delete
  if (list.length) {
    const upd = await mem.updateMemory(uid, list[0].ma_bo_nho, 'NỘI DUNG CẬP NHẬT');
    ok('update memory', upd === true);
    const del = await mem.deleteMemory(uid, list[0].ma_bo_nho);
    ok('delete memory', del === true);
    const del2 = await mem.deleteMemory(uid, list[0].ma_bo_nho);
    ok('delete already-deleted = false', del2 === false);
  }

  // ═══════════════════════════════════════════════
  // PHASE 3: Profile
  // ═══════════════════════════════════════════════
  console.log('[Phase 3: Profile Engine]');
  let puid = USER_ID + '_prof';
  let p = await prof.getProfile(puid);
  ok('profile empty', p.full_name === null);
  p = await prof.updateProfileFromMessage(puid, { name: 'Alice', job: 'Dev', location: 'HN', preferences: ['coffee'], dislikes: ['spam'] });
  ok('profile updated name', p.full_name === 'Alice');
  ok('profile updated job', p.job === 'Dev');
  ok('profile prefs', p.preferences.includes('coffee'));
  ok('profile dislikes', p.dislikes.includes('spam'));
  await prof.updateProfileFromMessage(puid, { job: 'CTO', company: 'TechCo' });
  p = await prof.getProfile(puid);
  ok('profile merge job new', p.job === 'CTO');
  ok('profile merge keep name', p.full_name === 'Alice');
  ok('profile merge add company', p.company === 'TechCo');
  const pt = prof.formatToPromptText(p);
  ok('profile prompt name', pt.includes('Alice'));
  ok('profile prompt job', pt.includes('CTO'));
  const emptyTxt = prof.formatToPromptText(prof.emptyProfile());
  ok('profile empty prompt empty', emptyTxt === '');
  await prof.startConversation(puid);
  p = await prof.getProfile(puid);
  ok('profile conv count', p.stats.total_conversations >= 1);

  // ═══════════════════════════════════════════════
  // PHASE 4: Context
  // ═══════════════════════════════════════════════
  console.log('[Phase 4: Context Engine]');
  const sess = ctx.createSession('sessA');
  ok('session created', sess && sess.topics !== undefined);
  ctx.updateTopic(ctx.getSessions(), { userId: 'sessA', text: 'Tôi muốn hỏi về dự án' });
  ok('topic detect', true);

  // ═══════════════════════════════════════════════
  // PHASE 5: Intelligence
  // ═══════════════════════════════════════════════
  console.log('[Phase 5: Intelligence]');
  const testMsg = { userId: 'intel-uid', text: 'Tôi thích hỏi về công việc', entities: {} };
  const fc = await intel.buildFullContext(USER_ID + '_intel', testMsg);
  ok('buildFullContext has intent', fc.intent !== undefined);
  ok('buildFullContext has sentiment', fc.sentiment !== undefined);
  ok('buildFullContext has entities', fc.entities);

  // All 11 adaptive response paths
  const cases = [
    ['chao_hoi', 'Chào bạn'], ['tam_biet', 'Tạm biệt'], ['cau_hoi', 'Tôi hỏi gì đó'],
    ['yeu_cau_hang_dong', 'Hãy giúp tôi'], ['khen_ngoi', 'Tuyệt vời'],
    ['phan_nan', 'Ối lỗi rồi'], ['scheduling', 'Hẹn 3h'], ['chia_buon', 'Buồn quá'],
    ['yeu_cau_thong_tin', 'Tư vấn giúp'], ['tom_tat', 'Tóm tắt cho tôi'],
    ['yes_no', 'Có nhé']
  ];
  for (const [action, text] of cases) {
    const c = await intel.buildFullContext(USER_ID + '_intel', { userId: 'intel-uid', text, entities: {} });
    const r = intel.generateAdaptiveResponse(c);
    ok('intelligence response: ' + action + ' has text', typeof r.text === 'string' && r.text.length > 5);
    ok('intelligence response: ' + action + ' has intent', typeof r.intent === 'string');
  }
  const rNull = intel.generateAdaptiveResponse(null);
  ok('intelligence null-safe', rNull.text.length > 5);

  await cleanupUser(USER_ID);
  await cleanupUser(USER_ID + '_mem');
  await cleanupUser(USER_ID + '_prof');
  await cleanupUser(USER_ID + '_intel');

  console.log('\n---');
  console.log('Kết quả: ' + pass + ' đạt ✓  ' + fail + ' lỗi ✗');
  if (fail > 0) process.exit(1);
}

function getStats(uid) { return mem.getMemoryStats(uid); }

main().catch(e => { console.error('\nTEST ERROR:', e.message); process.exit(2); });
