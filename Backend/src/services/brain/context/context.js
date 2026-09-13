/**
 * AI REXI BRAIN — CONTEXT ENGINE (Phase 4: Context Engine)
 *
 * Theo dõi ngữ cảnh phiên chat, tracking topics, detect topic transition.
 *
 * Store: JSON file on disk.
 *
 * Chi phí: local.
 */

const fs = require('fs');
const path = require('path');
const { tokenize, removeDiacritics } = require('../nlp/tokenizer-utils');
const { extractEntities } = require('../nlp/entity-extractor');
const db = require('../../../config/db');

const DB_DIR = path.join(__dirname, '..', '..', '..', '..', 'Database');
const SESSION_FILE = path.join(DB_DIR, 'sessions.json');

const MAX_SESSIONS = 50;

// ─── PROMISE HELPERS (adapter callback-based) ─────────────────
function dbRun(sql, params = []) { return new Promise((res, rej) => db.run(sql, params, (e) => e ? rej(e) : res())); }

// ─── (Bước 3.3) Migrate sessions.json → DB ─────────────────────
// Gọi 1 lần khi server khởi động: đẩy dữ liệu file cũ lên bảng context_sessions
// rồi xoá file để từ nay chỉ dùng DB (bền trên Render — file hệ thống không ổn định).
async function migrateSessionsFileToDb() {
  try {
    let fileData = {};
    try { fileData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch (e) { fileData = {}; }
    const keys = Object.keys(fileData);
    if (keys.length === 0) return { migrated: 0 };
    let migrated = 0;
    for (const k of keys) {
      await dbRun(
        `INSERT INTO context_sessions (ma_nguoi_dung, du_lieu) VALUES (?, ?)
         ON CONFLICT(ma_nguoi_dung) DO UPDATE SET du_lieu = excluded.du_lieu, ngay_cap_nhat = CURRENT_TIMESTAMP`,
        [k, JSON.stringify(fileData[k])]
      );
      migrated++;
    }
    try { fs.unlinkSync(SESSION_FILE); } catch (e) {}
    console.log(`[Brain][Context] Migrated ${migrated} sessions → DB, xoá sessions.json`);
    return { migrated };
  } catch (e) {
    console.error('[Brain][Context] Migrate sessions → DB thất bại (giữ file fallback):', e.message);
    return { migrated: 0 };
  }
}

// Đảm bảo bảng context_sessions tồn tại (dùng khi chạy ngoài server/init-db)
let contextTableEnsured = false;
async function ensureContextTable() {
  if (contextTableEnsured) return true;
  try {
    await dbRun(`CREATE TABLE IF NOT EXISTS context_sessions (
      ma_nguoi_dung TEXT PRIMARY KEY,
      du_lieu TEXT NOT NULL,
      ngay_cap_nhat TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    contextTableEnsured = true;
    return true;
  } catch (e) {
    return false;
  }
}

// Đọc toàn bộ sessions từ DB (async)
async function loadSessionsFromDb() {
  try {
    await ensureContextTable();
    const rows = await new Promise((res, rej) =>
      db.all('SELECT ma_nguoi_dung, du_lieu FROM context_sessions', [], (e, r) => e ? rej(e) : res(r || []))
    );
    const out = {};
    for (const r of rows) {
      try { out[r.ma_nguoi_dung] = JSON.parse(r.du_lieu); } catch (e) {}
    }
    return out;
  } catch (e) {
    return null; // DB chưa sẵn sàng → gọi bên gọi quyết định fallback
  }
}

// Ghi toàn bộ sessions lên DB (async, fire-and-forget)
async function persistSessionsToDb(sessions) {
  try {
    await ensureContextTable();
    for (const [userId, data] of Object.entries(sessions || {})) {
      await dbRun(
        `INSERT INTO context_sessions (ma_nguoi_dung, du_lieu) VALUES (?, ?)
         ON CONFLICT(ma_nguoi_dung) DO UPDATE SET du_lieu = excluded.du_lieu, ngay_cap_nhat = CURRENT_TIMESTAMP`,
        [userId, JSON.stringify(data)]
      );
    }
  } catch (e) {
    console.error('[Brain][Context] Persist sessions → DB thất bại:', e.message);
  }
}

// getSessions: ưu tiên DB (nếu có) → fallback file (lần đầu / DB lỗi)
let dbSessionsLoaded = false;
let dbSessionsCache = {};

async function preloadSessionsFromDb() {
  if (dbSessionsLoaded) return dbSessionsCache;
  const fromDb = await loadSessionsFromDb();
  if (fromDb) {
    dbSessionsCache = fromDb;
    dbSessionsLoaded = true;
  }
  return dbSessionsCache;
}

function getSessions() {
  if (dbSessionsLoaded) return dbSessionsCache;
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveSessions(sessions) {
  dbSessionsCache = sessions;
  dbSessionsLoaded = true;
  // Ghi file fallback (để dev/xem trực tiếp) + đẩy lên DB (bền vững)
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2)); } catch (e) {}
  persistSessionsToDb(sessions);
}

function createSession(userId) {
  const sessions = getSessions();
  if (!sessions[userId]) {
    sessions[userId] = {
      created: Date.now(),
      last_message: null,
      messages: [],
      topics: [],
      last_topic: null
    };
    saveSessions(sessions);
    return sessions[userId];
  }
  return sessions[userId];
}

function detectTopic(text) {
  // CHỦ ĐỀ TIẾNG VIỆT — chuẩn hoá không dấu để khớp cả câu có dấu / không dấu
  const TOPICS = [
    { topic: 'chao_hoi',      keys: ['xin chao', 'chao', 'hello', 'hi', 'alo', 'chao ban', 'chao buoi sang', 'chao buoi toi', 'chao buoi chieu', 'chao mung'] },
    { topic: 'tam_biet',      keys: ['tam biet', 'bye', 'goodbye', 'hen gap lai', 'chao tam biet', 'di day', 'toi di truoc'] },
    { topic: 'cam_on',        keys: ['cam on', 'thanks', 'thank you', 'thank', 'cam ta'] },
    { topic: 'xin_loi',       keys: ['xin loi', 'sorry', 'toi xin loi', 'that xin loi'] },
    { topic: 'hoi_tham',      keys: ['khoe khong', 'ban khoe', 'ban the nao', 'how are you', 'song tot', 'cua ban'] },
    { topic: 'cong_viec',     keys: ['cong viec', 'lam viec', 'nghe nghiep', 'job', 'work', 'cong ty', 'du an', 'deadline', 'hop', 'tang ca', 'nghi viec'] },
    { topic: 'hoc_tap',       keys: ['hoc tap', 'hoc', 'bai tap', 'mon hoc', 'truong', 'dai hoc', 'ky thi', 'thi', 'diem', 'lop hoc', 'gia su'] },
    { topic: 'gia_dinh',      keys: ['gia dinh', 'bo me', 'vo', 'chong', 'con cai', 'anh chi em', 'ong ba', 'nha cua', 'cuoi hoi'] },
    { topic: 'suc_khoe',      keys: ['suc khoe', 'benh', 'om', 'kham', 'bac si', 'thuoc', 'dau dau', 'met moi', 'tap the duc', 'giam can', 'an uong', 'health'] },
    { topic: 'tai_chinh',     keys: ['tien', 'luong', 'gia', 'mua', 'ban', 'vay', 'no', 'tiet kiem', 'dau tu', 'co phieu', 'ngan hang', 'chuyen tien', 'hoa don', 'thue'] },
    { topic: 'thoi_tiet',     keys: ['thoi tiet', 'mua', 'nang', 'bao', 'lanh', 'nong', 'nhiet do', 'du bao', 'am ap', 'gio'] },
    { topic: 'an_uong',       keys: ['an gi', 'mon an', 'com', 'ca phe', 'nha hang', 'do an', 'thuc an', 'ngon', 'am thuc', 'di an'] },
    { topic: 'du_lich',       keys: ['du lich', 'di choi', 'ky nghi', 'bien', 'nui', 'tour', 'khach san', 've may bay', 'di pho', 'tham quan'] },
    { topic: 'cong_nghe',     keys: ['may tinh', 'dien thoai', 'phan mem', 'app', 'website', 'internet', 'ai', 'code', 'lap trinh', 'game', 'bug', 'thiet bi'] },
    { topic: 'the_thao',      keys: ['bong da', 'bong ro', 'cau long', 'tennis', 'gym', 'chay bo', 'da bong', 'doi bong', 'giai dau', 'the thao'] },
    { topic: 'thoi_su',       keys: ['tin tuc', 'thoi su', 'chinh tri', 'xay ra', 'su kien', 'news', 'vua moi'] },
    { topic: 'tro_chuyen',    keys: ['cau chuyen', 'ke chuyen', 'tam su', 'chia se', 'noi chuyen', 'tro chuyen'] },
    { topic: 'hoi_thong_tin', keys: ['giup toi', 'chi toi', 'huong dan', 'cach', 'lam sao', 'lam the nao', 'cho toi biet', 'tim hieu', 'tra loi', 'giai thich', 'bao nhieu', 'khi nao', 'o dau', 'ai'] },
  ];
  if (!text) return null;
  const flat = removeDiacritics(String(text)).toLowerCase();
  for (const { topic, keys } of TOPICS) {
    if (keys.some(k => flat.includes(k))) return topic;
  }
  return null;
}
function updateTopic(sessions, message) {
  const session = sessions[message.userId];
  if (!session) return null;
  const topic = detectTopic(message.text);
  if (topic) {
    if (!session.topics.includes(topic)) {
      session.topics.push(topic);
    }
    session.last_topic = topic;
    session.last_message = message.text;
    session.last_message_time = Date.now();
    saveSessions(sessions);
    return topic;
  }
  return null;
}

function buildContext(userId, latestMessages) {
  const sessions = getSessions();
  const session = sessions[userId];
  if (!session) return { conversation: [], topic: null, entities: [], memory: [] };

  const recent = (latestMessages || []).slice(-8);
  const topic = session.last_topic || null;

  return {
    conversation: recent,
    topic: topic,
    entity: {
      name: latestMessages.find(m => m.entities && m.entities.name)?.entities?.name || null,
      job: latestMessages.find(m => m.entities && m.entities.job)?.entities?.job || null,
      company: latestMessages.find(m => m.entities && m.entities.company)?.entities?.company || null,
      location: latestMessages.find(m => m.entities && m.entities.location)?.entities?.location || null,
    },
    metadata: {
      messageCount: session.messages.length,
      lastTopic: topic,
      sessionCreated: session.created,
      lastMessageTime: session.last_message_time
    }
  };
}

module.exports = {
  getSessions,
  saveSessions,
  createSession,
  detectTopic,
  updateTopic,
  buildContext,
  migrateSessionsFileToDb,
  preloadSessionsFromDb,
  loadSessionsFromDb
};