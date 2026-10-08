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
 */

'use strict';

const express = require('express');
const router = express.Router();
const { rateLimit } = require('../middleware/rateLimit');
const scraper = require('../services/scraper');

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error: String(error || 'lỗi không xác định') });
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

module.exports = router;
