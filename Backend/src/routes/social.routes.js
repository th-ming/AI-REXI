/**
 * social.routes.js — /api/social
 *
 * SCAFFOLD connectors cho X (Twitter) / TikTok / Instagram.
 * Mọi endpoint trả JSON sạch và KHÔNG BAO GIỜ crash. Khi env chưa cấu hình →
 * 503 { ok:false, error:"not_configured" }. Khi không có token user → không lộ lỗi.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const social = require('../services/social');
const { authMiddleware, getJWTSecret } = require('../middleware/auth.middleware');

function notConfigured(res) {
  return res.status(503).json({ ok: false, error: 'not_configured' });
}

// Auth tuỳ chọn: đọc user id từ ?token= (dùng cho điều hướng browser, không gửi
// được Authorization header) hoặc Authorization: Bearer. Lỗi → coi như ẩn danh.
function optionalUserId(req) {
  try {
    let token = req.query && req.query.token;
    const h = req.headers.authorization;
    if (!token && h && h.startsWith('Bearer ')) token = h.slice(7);
    if (!token) return null;
    const decoded = jwt.verify(token, getJWTSecret());
    return decoded && decoded.id ? decoded.id : null;
  } catch (_) {
    return null;
  }
}

function emptyStatus() {
  const platforms = {};
  for (const p of social.PLATFORMS) {
    platforms[p] = { configured: social.isConfigured(p), connected: false, account: null };
  }
  return { ok: true, platforms };
}

// GET /api/social/status
router.get('/status', async (req, res) => {
  try {
    const userId = optionalUserId(req);
    const platforms = {};
    for (const p of social.PLATFORMS) {
      const configured = social.isConfigured(p);
      let connected = false;
      let account = null;
      if (userId) {
        const row = await social.getToken(userId, p).catch(() => null);
        if (row && row.access_token) {
          connected = true;
          account = row.account || null;
        }
      }
      platforms[p] = { configured, connected, account };
    }
    res.json({ ok: true, platforms });
  } catch (e) {
    console.error('[social] status error:', e.message);
    res.json(emptyStatus());
  }
});

// GET /api/social/:platform/connect → redirect tới provider authorize URL
router.get('/:platform/connect', (req, res) => {
  const { platform } = req.params;
  if (!social.PLATFORMS.includes(platform)) {
    return res.status(404).json({ ok: false, error: 'unknown_platform' });
  }
  if (!social.isConfigured(platform)) return notConfigured(res);
  try {
    const userId = optionalUserId(req);
    const started = social.startConnect(platform, userId);
    if (!started || !started.url) return notConfigured(res);
    return res.redirect(started.url);
  } catch (e) {
    console.error('[social] connect error:', e.message);
    return res.status(500).json({ ok: false, error: 'connect_failed' });
  }
});

// GET /api/social/:platform/callback → đổi code lấy token, lưu, redirect về FE
router.get('/:platform/callback', async (req, res) => {
  const { platform } = req.params;
  const fe = social.frontendUrl();
  const fail = (code) => res.redirect(`${fe}/?social_error=${encodeURIComponent(String(code || 'failed'))}`);

  if (!social.PLATFORMS.includes(platform)) return fail('unknown_platform');
  if (!social.isConfigured(platform)) return fail('not_configured');

  const { code, state, error } = req.query;
  if (error) return fail(error);
  if (!code) return fail('no_code');

  try {
    const stateData = social.consumeState(state);
    const tok = await social.exchangeCode(platform, code, stateData);
    if (stateData && stateData.userId) {
      await social.saveToken(stateData.userId, platform, tok);
    }
    return res.redirect(`${fe}/?social_connected=${encodeURIComponent(platform)}`);
  } catch (e) {
    console.error('[social] callback error:', e.message);
    return fail(e.message);
  }
});

// POST /api/social/:platform/post (auth) → đăng bằng token đã lưu
router.post('/:platform/post', authMiddleware, async (req, res) => {
  const { platform } = req.params;
  if (!social.PLATFORMS.includes(platform)) {
    return res.status(404).json({ ok: false, error: 'unknown_platform' });
  }
  if (!social.isConfigured(platform)) return notConfigured(res);

  const { text, media_url } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ ok: false, error: 'text_required' });
  }

  try {
    const row = await social.getToken(req.user.id, platform);
    if (!row || !row.access_token) {
      return res.status(400).json({ ok: false, error: 'not_connected' });
    }
    const result = await social.publish(platform, row, { text, mediaUrl: media_url });
    return res.json({ ok: true, id: result.id, url: result.url });
  } catch (e) {
    console.error('[social] post error:', `${platform}: ${e.message}`);
    return res.status(502).json({ ok: false, error: e.message });
  }
});

module.exports = router;
