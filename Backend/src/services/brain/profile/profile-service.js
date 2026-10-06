/**
 * Rexi AI BRAIN — PROFILE ENGINE (Phase 3: Hồ sơ người dùng)
 *
 * Xây dựng hồ sơ người dùng "tích luỹ" từ nhiều lần trò chuyện.
 * Khác memory: profile = bức tranh cấu trúc tổng quan, merge và cập nhật
 * liên tục, KHÔNG lưu nhiều mẩu rời lặp lại.
 *
 * Lưu trữ: 1 dòng JSON trong bảng `bo_nho_dai_han` (loai = 'profile').
 * Chi phí: 100% local.
 */

const db = require('../../../config/db');

// ─── PROMISE HELPERS (adapter callback-based) ───────────────────
function run(sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function(err) { err ? reject(err) : resolve(); })
  );
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}

// ─── SCHEMA ─────────────────────────────────────────────────────
function emptyProfile() {
  return {
    full_name: null,
    phone: null,
    email: null,
    job: null,
    company: null,
    location: null,
    preferences: [],
    dislikes: [],
    language: 'vi',
    interactionPreferences: {},   // giọng văn, cách trả lời...
    stats: { total_conversations: 0, total_messages: 0, last_active: null, created_at: null },
    updated_at: null
  };
}

// ─── LOAD ───────────────────────────────────────────────────────
async function getProfile(userId) {
  if (!userId) return emptyProfile();
  try {
    const row = await get(
      "SELECT noi_dung FROM bo_nho_dai_han WHERE ma_nguoi_dung = ? AND loai = 'profile' ORDER BY ngay_tao DESC LIMIT 1",
      [userId]
    );
    if (!row || !row.noi_dung) return emptyProfile();
    const parsed = JSON.parse(row.noi_dung);
    return { ...emptyProfile(), ...parsed };
  } catch (e) {
    return emptyProfile();
  }
}

// ─── MERGE ENTITY → PROFILE ─────────────────────────────────────
function mergeEntityIntoProfile(profile, entities) {
  if (!entities) return profile;
  if (entities.name) profile.full_name = entities.name;
  if (entities.phone) profile.phone = entities.phone;
  if (entities.email) profile.email = entities.email;
  if (entities.job) profile.job = entities.job;
  if (entities.company) profile.company = entities.company;
  if (entities.location) profile.location = entities.location;

  for (const p of entities.preferences || []) {
    if (!profile.preferences.includes(p)) profile.preferences.push(p);
  }
  for (const d of entities.dislikes || []) {
    if (!profile.dislikes.includes(d)) profile.dislikes.push(d);
  }
  // giới hạn tránh phình
  if (profile.preferences.length > 40) profile.preferences = profile.preferences.slice(-40);
  if (profile.dislikes.length > 40) profile.dislikes = profile.dislikes.slice(-40);
  return profile;
}

// ─── UPSERT PROFILE ─────────────────────────────────────────────
async function saveProfile(userId, profile) {
  if (!userId) return false;
  profile.updated_at = new Date().toISOString();
  const payload = JSON.stringify(profile);
  try {
    const existing = await get(
      "SELECT ma_bo_nho FROM bo_nho_dai_han WHERE ma_nguoi_dung = ? AND loai = 'profile' LIMIT 1",
      [userId]
    );
    if (existing) {
      await run(
        "UPDATE bo_nho_dai_han SET noi_dung = ?, ngay_tao = CURRENT_TIMESTAMP WHERE ma_bo_nho = ?",
        [payload, existing.ma_bo_nho]
      );
    } else {
      const maBoNho = 'profile_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      await run(
        "INSERT INTO bo_nho_dai_han (ma_bo_nho, ma_nguoi_dung, loai, noi_dung, do_uu_tien) VALUES (?, ?, 'profile', ?, 8)",
        [maBoNho, userId, payload]
      );
    }
    return true;
  } catch (e) {
    console.error('[Brain][Profile] save error:', e.message);
    return false;
  }
}

// ─── UPDATE TỪ 1 TIN NHẮN ───────────────────────────────────────
async function updateProfileFromMessage(userId, entities) {
  if (!userId || !entities) return emptyProfile();
  const profile = await getProfile(userId);
  mergeEntityIntoProfile(profile, entities);
  profile.stats.total_messages = (profile.stats.total_messages || 0) + 1;
  profile.stats.last_active = new Date().toISOString();
  if (!profile.stats.created_at) profile.stats.created_at = profile.stats.last_active;
  await saveProfile(userId, profile);
  return profile;
}

async function startConversation(userId) {
  const p = await getProfile(userId);
  p.stats.total_conversations = (p.stats.total_conversations || 0) + 1;
  await saveProfile(userId, p);
  return p;
}

// ─── PHP PROMPT ─────────────────────────────────────────────────
function formatProfileForPrompt(profile) {
  if (!profile) return '';
  const parts = [];
  if (profile.full_name) parts.push(`Tên: ${profile.full_name}`);
  if (profile.phone) parts.push(`SĐT: ${profile.phone}`);
  if (profile.email) parts.push(`Email: ${profile.email}`);
  if (profile.job) parts.push(`Nghề: ${profile.job}`);
  if (profile.company) parts.push(`Công ty: ${profile.company}`);
  if (profile.location) parts.push(`Nơi ở: ${profile.location}`);
  if (profile.preferences && profile.preferences.length) parts.push(`Thích: ${profile.preferences.slice(0, 8).join(', ')}`);
  if (profile.dislikes && profile.dislikes.length) parts.push(`Không thích: ${profile.dislikes.slice(0, 5).join(', ')}`);
  if (!parts.length) return '';
  return '\n\n👤 HỒ SƠ NGƯỜI DÙNG:\n' + parts.map(p => `- ${p}`).join('\n');
}

module.exports = {
  getProfile,
  saveProfile,
  updateProfileFromMessage,
  mergeEntityIntoProfile,
  startConversation,
  formatToPromptText: formatProfileForPrompt,
  emptyProfile
};