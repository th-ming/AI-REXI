/**
 * scrape.routes.js — Data Scraper Kit API (mount /api/scrape).
 *
 * ADDITIVE + GUARDED: mọi endpoint trả {ok:true,...} hoặc {ok:false,error:...},
 * bọc try/catch + rateLimit → không bao giờ 500-crash server.
 *
 *   GET  /api/scrape/status          → trạng thái worker + danh sách site hỗ trợ
 *   POST /api/scrape/info  {url}     → metadata (worker yt-dlp → fallback web)
 *   POST /api/scrape/page  {url}     → readable text
 *   POST /api/scrape/comments {url,max} → bình luận (worker)
 *   POST /api/scrape/batch {urls[]}  → tuần tự tối đa 10 url
 *   POST /api/scrape/download {url}  → URL media trực tiếp + headers (không proxy bytes)
 *   POST /api/scrape/channel {url,limit,today} → liệt kê video kênh/playlist (worker /list)
 *   POST /api/scrape/ingest {source,title,text|items} → nạp vào RAG (tiết kiệm token)
 *   POST /api/scrape/ask {question,source?} → truy vấn RAG, trả chunk liên quan
 *   POST /api/scrape/pipeline {urls[],channel?,question?} → crawl + nạp RAG + trả chunk/answer
 */

'use strict';

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { rateLimit } = require('../middleware/rateLimit');
const { getJWTSecret } = require('../middleware/auth.middleware');
const db = require('../config/db');
const scraper = require('../services/scraper');

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error: String(error || 'lỗi không xác định') });
}

// optionalAuth: gắn req.user nếu token hợp lệ; KHÔNG chặn khi thiếu/sai token
// (endpoint scrape vẫn public; RAG scope dùng user thật nếu đăng nhập, else 'scrape-public').
function optionalAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return next();
  let decoded;
  try { decoded = jwt.verify(h.split(' ')[1], getJWTSecret()); } catch (e) { return next(); }
  db.get(
    "SELECT phan_quyen, trang_thai, token_version FROM nguoi_dung WHERE ma_nguoi_dung = ?",
    [decoded.id],
    (err, row) => {
      if (!err && row && row.trang_thai !== 'banned' && (decoded.tv || 0) >= (row.token_version || 0)) {
        decoded.role = row.phan_quyen;
        decoded.phan_quyen = row.phan_quyen;
        req.user = decoded;
      }
      next();
    }
  );
}

function scopeOf(req) {
  return (req.user && req.user.id) || 'scrape-public';
}

// GET /status — public, nhẹ (dùng cho FE + healthcheck).
router.get('/status', rateLimit({ windowMs: 60000, max: 120 }), (req, res) => {
  try {
    res.json(scraper.status());
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// POST /info
router.post('/info', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return fail(res, 400, 'Thiếu url.');
    const r = await scraper.info(url);
    const out = { ok: true, source: r.source, data: r.data };
    if (r.note) out.note = r.note;
    res.json(out);
  } catch (e) {
    fail(res, 400, e.message);
  }
});

// POST /page
router.post('/page', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return fail(res, 400, 'Thiếu url.');
    const r = await scraper.page(url);
    res.json({ ok: true, source: r.source, data: r.data });
  } catch (e) {
    fail(res, 400, e.message);
  }
});

// POST /comments
router.post('/comments', rateLimit({ windowMs: 60000, max: 15 }), async (req, res) => {
  try {
    const { url, max } = req.body || {};
    if (!url) return fail(res, 400, 'Thiếu url.');
    const r = await scraper.comments(url, max);
    res.json({ ok: true, source: r.source, count: r.count, data: r.data });
  } catch (e) {
    fail(res, 400, e.message);
  }
});

// POST /batch
router.post('/batch', rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
  try {
    const { urls } = req.body || {};
    if (!Array.isArray(urls) || !urls.length) return fail(res, 400, 'Thiếu mảng urls.');
    const r = await scraper.batch(urls);
    res.json(r);
  } catch (e) {
    fail(res, 400, e.message);
  }
});

// POST /download
router.post('/download', rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return fail(res, 400, 'Thiếu url.');
    const r = await scraper.download(url);
    res.json(r);
  } catch (e) {
    fail(res, 400, e.message);
  }
});

// POST /channel — liệt kê video kênh/playlist (worker /list). today=true → chỉ video đăng hôm nay.
router.post('/channel', rateLimit({ windowMs: 60000, max: 15 }), async (req, res) => {
  try {
    const { url, limit, today } = req.body || {};
    if (!url) return fail(res, 400, 'Thiếu url.');
    const r = await scraper.channel(url, { limit, today });
    res.json(r);
  } catch (e) {
    fail(res, 400, e.message);
  }
});

// POST /ingest — chunk text/items → nạp vào RAG store đang có (tiết kiệm token khi chat).
router.post('/ingest', rateLimit({ windowMs: 60000, max: 20 }), optionalAuth, async (req, res) => {
  try {
    const { source, title, text, items } = req.body || {};
    if (!(text && String(text).trim()) && !Array.isArray(items)) return fail(res, 400, 'Cần "text" hoặc "items".');
    const r = await scraper.ingest({ source, title, text, items }, scopeOf(req));
    res.json(r);
  } catch (e) {
    fail(res, 400, e.message);
  }
});

// POST /ask — truy vấn RAG, trả các chunk liên quan (chỉ feed chunk đó cho model).
router.post('/ask', rateLimit({ windowMs: 60000, max: 30 }), optionalAuth, async (req, res) => {
  try {
    const { question, source, limit } = req.body || {};
    if (!question) return fail(res, 400, 'Thiếu question.');
    const r = await scraper.ask({ question, source, limit }, scopeOf(req));
    res.json(r);
  } catch (e) {
    fail(res, 400, e.message);
  }
});

// POST /pipeline — crawl (urls/channel) → nạp RAG → trả chunk (hoặc top chunks khi có question).
router.post('/pipeline', rateLimit({ windowMs: 60000, max: 10 }), optionalAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.channel && !(Array.isArray(body.urls) && body.urls.length)) {
      return fail(res, 400, 'Cần "urls" (mảng) hoặc "channel".');
    }
    const r = await scraper.pipeline(body, scopeOf(req));
    res.json(r);
  } catch (e) {
    fail(res, 400, e.message);
  }
});

module.exports = router;
