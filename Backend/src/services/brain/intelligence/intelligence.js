/**
 * Rexi AI BRAIN — INTELLIGENCE (Phase 5: Adaptive Response)
 *
 * Xây dựng response adaptive:
 *  1. Gắn entity (extractEntities) → xác định ai đang nói, thông tin họ hỏi
 *  2. Phân tích cảm xúc (analyzeSentiment) → gắn cảm xúc vào response
 *  3. Đoán intent (detectIntent) → chọn behavior
 *  4. Gắn context (buildContext) → hiểu ngữ cảnh phiên trò chuyện
 *  5. Gắn profile (getProfile) → thông tin người dùng
 *  6. Gắn memory (loadSmartMemory) → tìm kiếm memory
 *  7. Gắn entity (extractEntities) → thông tin người dùng
 *  8. Xây dựng response template (adaptive response)
 *
 * Chi phí: 100% local (không gọi LLM).
 */

const { extractEntities, normalizeText, cleanName } = require('../nlp/entity-extractor');
const { analyzeSentiment, detectIntent } = require('../nlp/sentiment-intent');
const { buildContext, getSessions } = require('../context/context');
const { getProfile, updateProfileFromMessage, saveProfile, formatToPromptText } = require('../profile/profile-service');
const { loadSmartMemory, getMemoryStats, saveMemoryAuto } = require('../memory/memory-service');

// ─── ADAPTIVE RESPONSE ──────────────────────────────────

/**
 * Build full context cho intelligence.
 * Trả về: { profile, context, memory, sentiment, intent, entities }
 */
function buildFullContext(userId, message) {
  const profile = getProfile(userId);
  const context = buildContext(userId, [message]);
  const smartMem = loadSmartMemory(userId, message.text).text;
  const stats = getMemoryStats(userId);
  const sentiment = analyzeSentiment(message.text);
  const intent = detectIntent(message.text);
  const entities = extractEntities(message.text);

  return {
    profile,
    context,
    memory: smartMem,
    memoryStats: stats,
    sentiment,
    intent,
    entities
  };
}

/**
 * Xây dựng response adaptive dựa trên ngữ cảnh.
 *
 * Trả về:
 * { text, response, intent, sentiment, entities }
 */
function generateAdaptiveResponse(context) {
  if (!context || !context.entities) {
    return {
      text: 'Xin chào! Tôi là Rexi AI.',
      response: 'Xin chào! Tôi là Rexi AI, hệ thống đang hoạt động.',
      intent: 'chao_hoi',
      sentiment: { score: 0, label: 'neutral', degree: 'khong', keywords: [] },
      entities: {}
    };
  }

  const { profile, sentiment, intent, entities, memory, memoryStats, context: ctx } = context;

  // ── Lựa chọn greeting ──
  let greeting = '';
  if (sentiment.label === 'positive' && sentiment.score > 0) {
    greeting = `Xin chào ${entities.name || 'chúng ta'}! Tôi thấy ${sentiment.label} nhé.`;
  } else if (sentiment.label === 'negative') {
    greeting = `Xin chào ${entities.name || 'chúng ta'}. Tôi nhận thấy bạn đang ${sentiment.label}.`;
  } else {
    greeting = `Xin chào ${entities.name || 'chúng ta'}!`;
  }

  // ── Lựa chọn response dựa trên intent ──
  let responseTemplate = '';
  let responseAction = intent.action;

  switch (intent.action) {
    case 'chao_hoi':
      responseTemplate = `Xin chào! Tôi hiện đang tự học và học hỏi. Tôi có thể giúp bạn về ${profile.job || 'nhiều việc'}.`;
      break;
    case 'tam_biet':
      responseTemplate = `Rất vui được gặp bạn. Xin chúc bạn may mắn trong hành trình ${profile.job || 'học tập'}.`;
      break;
    case 'phan_nan':
      responseTemplate = `Xin lỗi nếu tôi gặp khó khăn. Tôi sẽ tập trung giải quyết vấn đề đó.`;
      break;
    case 'khen_ngoi':
      responseTemplate = `Cảm ơn bạn đã khen ngợi! Điều này tạo động lực cho tôi. Bạn có thể hỏi thêm điều gì?`;
      break;
    case 'yeu_cau_hang_dong':
      responseTemplate = `Rất vui được hỗ trợ bạn! Tôi đang tìm hiểu ${entities.job || 'công việc'} của bạn và chuẩn bị trả lời chi tiết.`;
      break;
    case 'scheduling':
      responseTemplate = `Tôi hiểu bạn muốn đặt lịch. Hiện tại tôi có thể hỗ trợ bạn theo ${profile.job || 'nhiều khía cạnh'}.`;
      break;
    case 'chia_buon':
      responseTemplate = `Mình hiểu bạn đang cảm thấy buồn. Tôi rất sẵn lòng giúp bạn chia sẻ và tìm cách phù hợp.`;
      break;
    case 'cau_hoi':
      responseTemplate = `Câu hỏi của bạn. Tôi đang tìm hiểu câu hỏi đó. Bạn vui lòng cho tôi thêm chi tiết nhé.`;
      break;
    default:
      responseTemplate = `Tôi hiểu bạn đang hỏi: "${entities.name || entities.job || entities.location}".`;
  }

  // ── Gắn ngữ cảnh ──
  const contextSummary = ctx.topic ? `Đề cập: "${ctx.topic}"` : '';
  const userSummary = `Bạn là ${profile.full_name || 'người dùng'}. ${profile.company || ''} ${profile.location || ''}`;

  let fullResponse = greeting + '\n\n' + responseTemplate;
  if (contextSummary) fullResponse += '\n\n💡 ' + contextSummary;
  if (profile.phone) fullResponse += `\n📞 SĐT: ${profile.phone}`;
  if (profile.preferences && profile.preferences.length) fullResponse += `\n🎯 Sở thích: ${profile.preferences.slice(0, 3).join(', ')}`;
  if (memoryStats.total > 0) fullResponse += `\n🧠 Đã có ${memoryStats.total} memory lưu. Tích hợp bộ nhớ vào câu trả lời.`;

  // ── Gắn entity ──
  const enrichedEntity = {
    name: entities.name,
    job: entities.job,
    company: entities.company,
    location: entities.location,
    preferences: entities.preferences,
    dislikes: entities.dislikes,
    facts: entities.facts
  };

  return {
    text: fullResponse,
    response: fullResponse,
    intent: intent.action,
    sentiment,
    entities: enrichedEntity,
    profile: profile
  };
}

module.exports = {
  buildFullContext,
  generateAdaptiveResponse,
  getProfile,
  formatToPromptText,
  updateProfileFromMessage,
  loadSmartMemory,
  saveMemoryAuto,
  getMemoryStats
};