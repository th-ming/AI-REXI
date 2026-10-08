/**
 * social.js — Social posting connectors (X/Twitter, TikTok, Instagram)
 *
 * SCAFFOLD: các connector này CHỈ hoạt động khi env key được cấu hình.
 * Chưa cấu hình → isConfigured() = false → route trả 503 { ok:false, error:"not_configured" }.
 * Tuyệt đối KHÔNG ảnh hưởng tính năng khác: module chỉ được require, và bảng
 * social_oauth_tokens được tạo guarded (IF NOT EXISTS) — nếu lỗi cũng không ném ra.
 *
 * Token lưu per-user qua bảng social_oauth_tokens (mã hoá bằng utils/cryptoKeys,
 * cùng pattern với google_oauth_tokens trong auth.routes.js).
 */
const crypto = require('crypto');
const db = require('../config/db');
const { encryptKey, decryptKey } = require('../utils/cryptoKeys');

const PLATFORMS = ['x', 'tiktok', 'instagram'];

// ─── Token storage (guarded — không bao giờ làm vỡ startup) ──────────────────
db.run(`CREATE TABLE IF NOT EXISTS social_oauth_tokens (
    ma_nguoi_dung TEXT NOT NULL,
    platform TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    account TEXT,
    meta TEXT,
    ngay_cap_nhat TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ma_nguoi_dung, platform)
)`, () => {});

// ─── Config ─────────────────────────────────────────────────────────────────
function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function getConfig(platform) {
  const fe = frontendUrl();
  if (platform === 'x') {
    return {
      clientId: process.env.X_CLIENT_ID || '',
      clientSecret: process.env.X_CLIENT_SECRET || '',
      redirectUri: process.env.X_REDIRECT_URI || `${fe}/api/social/x/callback`,
      scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    };
  }
  if (platform === 'tiktok') {
    return {
      clientKey: process.env.TIKTOK_CLIENT_KEY || '',
      clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
      redirectUri: process.env.TIKTOK_REDIRECT_URI || `${fe}/api/social/tiktok/callback`,
      scopes: ['user.info.basic', 'video.publish', 'video.upload'],
    };
  }
  if (platform === 'instagram') {
    return {
      appId: process.env.META_APP_ID || '',
      appSecret: process.env.META_APP_SECRET || '',
      redirectUri: process.env.META_REDIRECT_URI || `${fe}/api/social/instagram/callback`,
      scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement', 'business_management'],
    };
  }
  return null;
}

function isConfigured(platform) {
  const c = getConfig(platform);
  if (!c) return false;
  if (platform === 'x') return !!(c.clientId && c.clientSecret);
  if (platform === 'tiktok') return !!(c.clientKey && c.clientSecret);
  if (platform === 'instagram') return !!(c.appId && c.appSecret);
  return false;
}

// ─── OAuth state + PKCE store (in-memory, TTL 10 phút) ──────────────────────
const stateStore = new Map();
const STATE_TTL = 10 * 60 * 1000;

function pruneStates() {
  const now = Date.now();
  for (const [k, v] of stateStore) {
    if (now - v.ts > STATE_TTL) stateStore.delete(k);
  }
}

function makeState(payload) {
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, { ...payload, ts: Date.now() });
  return state;
}

function consumeState(state) {
  pruneStates();
  if (!state) return null;
  const v = stateStore.get(state);
  if (v) stateStore.delete(state);
  return v || null;
}

function generatePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ─── Authorize URL ──────────────────────────────────────────────────────────
function buildAuthorizeUrl(platform, state, opts = {}) {
  const c = getConfig(platform);
  if (!c) return null;
  if (platform === 'x') {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: c.clientId,
      redirect_uri: c.redirectUri,
      scope: c.scopes.join(' '),
      state,
      code_challenge: opts.codeChallenge || '',
      code_challenge_method: 'S256',
    });
    return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  }
  if (platform === 'tiktok') {
    const params = new URLSearchParams({
      client_key: c.clientKey,
      response_type: 'code',
      scope: c.scopes.join(','),
      redirect_uri: c.redirectUri,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  }
  if (platform === 'instagram') {
    const params = new URLSearchParams({
      client_id: c.appId,
      redirect_uri: c.redirectUri,
      state,
      scope: c.scopes.join(','),
      response_type: 'code',
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  }
  return null;
}

/**
 * Bắt đầu luồng connect: sinh state (+ PKCE cho X) và trả URL authorize.
 * userId (nếu có) được nhét vào state để callback gắn token đúng user.
 */
function startConnect(platform, userId) {
  const c = getConfig(platform);
  if (!c) return null;
  const pkce = platform === 'x' ? generatePkce() : {};
  const state = makeState({ platform, userId: userId || null, codeVerifier: pkce.verifier || null });
  const url = buildAuthorizeUrl(platform, state, { codeChallenge: pkce.challenge });
  if (!url) return null;
  return { url, state };
}

// ─── Code → token ───────────────────────────────────────────────────────────
async function exchangeCode(platform, code, stateData) {
  const c = getConfig(platform);
  if (!c) throw new Error('not_configured');

  if (platform === 'x') {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: c.redirectUri,
      client_id: c.clientId,
      code_verifier: (stateData && stateData.codeVerifier) || '',
    });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (c.clientSecret) {
      headers.Authorization = 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
    }
    const r = await fetch('https://api.twitter.com/2/oauth2/token', { method: 'POST', headers, body });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) throw new Error(data.error_description || data.error || `x_token_${r.status}`);
    let account = null;
    try {
      const me = await fetch('https://api.twitter.com/2/users/me', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      }).then((x) => x.json());
      account = me?.data?.username || null;
    } catch (_) { /* ignore */ }
    return { access_token: data.access_token, refresh_token: data.refresh_token, scope: data.scope, account };
  }

  if (platform === 'tiktok') {
    const body = new URLSearchParams({
      client_key: c.clientKey,
      client_secret: c.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: c.redirectUri,
    });
    const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) throw new Error(data.error_description || data.error || `tiktok_token_${r.status}`);
    let account = null;
    try {
      const info = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      }).then((x) => x.json());
      account = info?.data?.user?.display_name || data.open_id || null;
    } catch (_) { /* ignore */ }
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      scope: data.scope,
      account: account || data.open_id || null,
      meta: { open_id: data.open_id || null },
    };
  }

  if (platform === 'instagram') {
    // 1) code → short-lived user token
    const qs = new URLSearchParams({
      client_id: c.appId,
      client_secret: c.appSecret,
      redirect_uri: c.redirectUri,
      code,
    });
    const r = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${qs.toString()}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) throw new Error(data.error?.message || `instagram_token_${r.status}`);
    let token = data.access_token;
    // 2) đổi sang long-lived token (~60 ngày)
    try {
      const ll = await fetch(
        `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(c.appId)}&client_secret=${encodeURIComponent(c.appSecret)}&fb_exchange_token=${encodeURIComponent(token)}`
      ).then((x) => x.json());
      if (ll && ll.access_token) token = ll.access_token;
    } catch (_) { /* ignore */ }
    // 3) tìm IG Business account id từ page đầu tiên
    let igUserId = null;
    let account = null;
    try {
      const pages = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${encodeURIComponent(token)}`).then((x) => x.json());
      const page = pages?.data?.[0];
      if (page) {
        account = page.name || null;
        const ig = await fetch(`https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${encodeURIComponent(token)}`).then((x) => x.json());
        igUserId = ig?.instagram_business_account?.id || null;
      }
    } catch (_) { /* ignore */ }
    return { access_token: token, account, meta: { igUserId } };
  }

  throw new Error('unknown_platform');
}

// ─── Publish ────────────────────────────────────────────────────────────────
async function publish(platform, tokenRow, { text, mediaUrl }) {
  if (!tokenRow || !tokenRow.access_token) throw new Error('not_connected');
  const access = decryptKey(tokenRow.access_token);
  const content = String(text || '').trim();
  if (!content && !mediaUrl) throw new Error('empty_post');

  if (platform === 'x') {
    const r = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content.slice(0, 280) }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.data?.id) throw new Error(data.detail || data.title || `x_post_${r.status}`);
    return { id: data.data.id, url: `https://twitter.com/i/web/status/${data.data.id}` };
  }

  if (platform === 'tiktok') {
    // Content Posting API — TikTok không nhận text-only, cần media_url.
    if (!mediaUrl) throw new Error('media_url_required');
    const r = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_info: { title: content.slice(0, 2200) },
        source_info: { source: 'PULL_FROM_URL', video_url: mediaUrl },
      }),
    });
    const data = await r.json().catch(() => ({}));
    const errCode = data?.error?.code;
    if (!r.ok || (errCode && errCode !== 'ok')) throw new Error(data?.error?.message || `tiktok_post_${r.status}`);
    return { id: data.data?.publish_id || null, url: null };
  }

  if (platform === 'instagram') {
    let meta = {};
    try { meta = tokenRow.meta ? JSON.parse(tokenRow.meta) : {}; } catch (_) { meta = {}; }
    const igUserId = meta.igUserId;
    if (!igUserId) throw new Error('ig_user_id_missing');
    if (!mediaUrl) throw new Error('media_url_required');
    const create = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ image_url: mediaUrl, caption: content.slice(0, 2200), access_token: access }),
    }).then((x) => x.json());
    if (!create.id) throw new Error(create.error?.message || 'instagram_media_failed');
    const pub = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: create.id, access_token: access }),
    }).then((x) => x.json());
    if (!pub.id) throw new Error(pub.error?.message || 'instagram_publish_failed');
    return { id: pub.id, url: null };
  }

  throw new Error('unknown_platform');
}

// ─── Token persistence helpers ──────────────────────────────────────────────
function saveToken(userId, platform, data) {
  return new Promise((resolve) => {
    if (!userId) return resolve(false);
    db.get(
      'SELECT refresh_token FROM social_oauth_tokens WHERE ma_nguoi_dung = ? AND platform = ?',
      [userId, platform],
      (err, row) => {
        if (err) { console.error('[social] saveToken read error:', err.message); return resolve(false); }
        const keepRefresh = data.refresh_token || (row && row.refresh_token) || null;
        db.run(
          `INSERT INTO social_oauth_tokens (ma_nguoi_dung, platform, access_token, refresh_token, account, meta)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(ma_nguoi_dung, platform) DO UPDATE SET
             access_token = excluded.access_token,
             refresh_token = COALESCE(excluded.refresh_token, social_oauth_tokens.refresh_token),
             account = excluded.account,
             meta = excluded.meta,
             ngay_cap_nhat = CURRENT_TIMESTAMP`,
          [
            userId,
            platform,
            data.access_token ? encryptKey(data.access_token) : null,
            keepRefresh ? encryptKey(keepRefresh) : null,
            data.account || null,
            data.meta ? JSON.stringify(data.meta) : null,
          ],
          (e) => { if (e) console.error('[social] saveToken error:', e.message); resolve(!e); }
        );
      }
    );
  });
}

function getToken(userId, platform) {
  return new Promise((resolve) => {
    if (!userId) return resolve(null);
    db.get(
      'SELECT * FROM social_oauth_tokens WHERE ma_nguoi_dung = ? AND platform = ?',
      [userId, platform],
      (err, row) => resolve(err ? null : row)
    );
  });
}

module.exports = {
  PLATFORMS,
  getConfig,
  isConfigured,
  startConnect,
  consumeState,
  exchangeCode,
  publish,
  saveToken,
  getToken,
  frontendUrl,
};
