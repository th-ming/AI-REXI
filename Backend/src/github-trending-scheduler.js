/**
 * GitHub Trending Daily Scheduler
 *
 * Chạy mỗi 24h để scrape github.com/trending và cache vào CSDL.
 * FIX PROD: dùng adapter db.js (SQLite local / PostgreSQL trên Render) thay vì
 * better-sqlite3 file cứng — trước đây trên Render sẽ tự tạo file DB rỗng riêng,
 * dữ liệu trending/saved/starred bị tách khỏi DB chính và mất mỗi lần redeploy.
 */
const Groq = require('groq-sdk');
const db = require('./config/db');
const { decryptKey } = require('./utils/cryptoKeys');

const FETCH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 giờ

const isSqlite = db.type === 'sqlite';
const NOW = () => (isSqlite ? "datetime('now', 'localtime')" : 'NOW()');

let timer = null;

// ─── Promise helpers cho adapter (callback-based) ─────────────
function runQ(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this && this.changes != null ? this.changes : 0); }));
}
function getQ(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}
function allQ(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
}

// ─── DB Init ──────────────────────────────────────────────────
// Các bảng (trending_cache, trending_notifications, repo_summaries,
// star_snapshots, saved_repos, starred_repos) được tạo bởi src/init-db.js khi
// server khởi động — KHÔNG tạo lại ở đây (tránh trùng schema, hỗ trợ Postgres).
function initDB() {
  console.log('[GitHub Scheduler] DB ready (schema từ init-db, adapter ' + db.type + ')');
  return true;
}

// ─── Scraping Function ────────────────────────────────────
async function scrapeTrending(language = '', since = 'daily') {
  let url = 'https://github.com/trending';
  if (language) url += `/${encodeURIComponent(language)}`;
  url += `?since=${since}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) throw new Error(`GitHub Trending fetch failed: ${response.status}`);

  const html = await response.text();
  const repos = [];
  const rows = html.split(/class="Box-row/).slice(1);

  for (const row of rows) {
    try {
      // Repo name — find /owner/repo href (skip login/sponsors)
      const allHrefs = [...row.matchAll(/href="\/([^"]+)"/g)];
      let fullName = '';
      for (const m of allHrefs) {
        const candidate = m[1].replace(/^\/+/, '');
        const parts = candidate.split('/');
        if (parts.length === 2 && !candidate.includes('login') && !candidate.includes('signup') && !candidate.includes('sponsors')) {
          fullName = candidate;
          break;
        }
      }
      if (!fullName) continue;

      // Description — single <p> contains everything, description is at the end
      const allParas = [...row.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
      let description = '';
      for (const p of allParas) {
        const text = p[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (text.length > 5) {
          const nameParts = fullName.split('/');
          const repoLabel = `${nameParts[0]} / ${nameParts[1]}`;
          const idx = text.indexOf(repoLabel);
          if (idx >= 0) {
            description = text.substring(idx + repoLabel.length).trim();
          } else {
            description = text;
          }
        }
      }

      const langMatch = row.match(/itemprop="programmingLanguage">\s*(.*?)\s*</);
      const languageName = langMatch ? langMatch[1].trim() : '';

      const starsTodayMatch = row.match(/([\d,]+)\s+stars?\s+(today|this week|this month)/i);
      const starsGained = starsTodayMatch ? parseInt(starsTodayMatch[1].replace(/,/g, '')) : 0;
      const period = starsTodayMatch ? starsTodayMatch[2] : '';

      let totalStars = 0;
      const starsLinkMatch = row.match(/href="[^"]*\/stargazers"[\s\S]*?<\/a>/);
      if (starsLinkMatch) {
        const noSvg = starsLinkMatch[0].replace(/<svg[\s\S]*?<\/svg>/g, '');
        const numInLink = noSvg.match(/>\s*([\d,]+)\s*<\/a>/);
        if (numInLink) totalStars = parseInt(numInLink[1].replace(/,/g, ''));
      }

      let forks = 0;
      const forksLinkMatch = row.match(/href="[^"]*\/forks"[\s\S]*?<\/a>/);
      if (forksLinkMatch) {
        const noSvg = forksLinkMatch[0].replace(/<svg[\s\S]*?<\/svg>/g, '');
        const numInLink = noSvg.match(/>\s*([\d,]+)\s*<\/a>/);
        if (numInLink) forks = parseInt(numInLink[1].replace(/,/g, ''));
      }

      const builtByMatch = row.match(/Built by([\s\S]*?)<\/div>/);
      const contributors = [];
      if (builtByMatch) {
        const avatarMatches = builtByMatch[1].matchAll(/alt="@([^"]+)"/g);
        for (const m of avatarMatches) contributors.push(m[1]);
      }

      repos.push({
        rank: repos.length + 1,
        full_name: fullName,
        owner: fullName.split('/')[0],
        name: fullName.split('/')[1],
        description,
        language: languageName,
        stars: totalStars,
        forks,
        stars_gained: starsGained,
        period,
        url: `https://github.com/${fullName}`,
        contributors: contributors.slice(0, 5),
      });
    } catch (e) {
      continue;
    }
  }

  return repos;
}

// ─── Cache to DB ──────────────────────────────────────────
async function cacheRepos(language, since, repos) {
  try {
    await runQ(`
      INSERT INTO trending_cache (language, since, repos_json, fetched_at)
      VALUES (?, ?, ?, ${NOW()})
      ON CONFLICT(language, since) DO UPDATE SET
        repos_json = excluded.repos_json,
        fetched_at = excluded.fetched_at
    `, [language, since, JSON.stringify(repos)]);
    return true;
  } catch (e) {
    console.error('[GitHub Scheduler] Cache write error:', e.message);
    return false;
  }
}

// ─── Read from Cache ──────────────────────────────────────
async function getCachedRepos(language = '', since = 'daily') {
  try {
    const row = await getQ(
      'SELECT repos_json, fetched_at FROM trending_cache WHERE language = ? AND since = ?',
      [language, since]
    );
    if (!row) return null;
    return { repos: JSON.parse(row.repos_json), fetched_at: row.fetched_at };
  } catch (e) {
    return null;
  }
}

// ─── Get Cache Status ─────────────────────────────────────
async function getCacheStatus() {
  try {
    const rows = await allQ('SELECT language, since, fetched_at FROM trending_cache ORDER BY fetched_at DESC');
    return { cached: rows.length, repos: rows };
  } catch (e) {
    return { cached: 0, repos: [] };
  }
}

// ─── Refresh All Cached Languages ─────────────────────────
async function refreshAllCaches() {
  console.log('[GitHub Scheduler] Starting daily refresh...');

  // Lấy danh sách language + since đang cache
  const cached = await allQ('SELECT DISTINCT language, since FROM trending_cache').catch(() => []);

  // Luôn refresh daily cho tất cả (language = '') và các ngôn ngữ đã cache
  const tasks = [
    { language: '', since: 'daily' },
    { language: '', since: 'weekly' },
    ...cached.filter(c => c.language !== '').map(c => ({ language: c.language, since: c.since })),
  ];

  let successCount = 0;
  let failCount = 0;

  for (const task of tasks) {
    try {
      const repos = await scrapeTrending(task.language, task.since);
      await detectNewRepos(task.language, task.since, repos);
      await cacheRepos(task.language, task.since, repos);
      successCount++;
      console.log(`[GitHub Scheduler] ✓ Cached ${task.language || 'all'} (${task.since}): ${repos.length} repos`);

      // Delay giữa mỗi request để tránh rate limit
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      failCount++;
      console.error(`[GitHub Scheduler] ✗ Failed ${task.language || 'all'} (${task.since}):`, e.message);
    }
  }

  console.log(`[GitHub Scheduler] Refresh complete: ${successCount} success, ${failCount} failed`);
  await cleanupNotifications();
  await snapshotSavedRepoStars();
  await sendDailyDigest();
}

// ─── Scheduler ────────────────────────────────────────────
function startGitHubScheduler() {
  if (!initDB()) {
    console.error('[GitHub Scheduler] Cannot start - DB init failed');
    return;
  }

  const enabled = process.env.ENABLE_GITHUB_SCHEDULER !== 'false';
  console.log(`[GitHub Scheduler] Status: ${enabled ? 'ENABLED' : 'DISABLED'}`);

  if (!enabled) return;

  // Chạy lần đầu sau 30s khi server khởi động
  setTimeout(() => {
    refreshAllCaches();
  }, 30 * 1000);

  // Sau đó chạy mỗi 24h
  timer = setInterval(() => {
    refreshAllCaches();
  }, FETCH_INTERVAL_MS);

  console.log('[GitHub Scheduler] Will refresh every 24h');
}

function stopGitHubScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[GitHub Scheduler] Stopped');
  }
}

// ─── Notifications (DB-backed) ─────────────────────────────
async function getUnreadCount() {
  try {
    const row = await getQ('SELECT COUNT(*) AS c FROM trending_notifications WHERE is_read = 0');
    return row ? Number(row.c || 0) : 0;
  } catch (e) {
    return 0;
  }
}

async function getNotifications(limit = 20, unreadOnly = false) {
  try {
    const sql = unreadOnly
      ? 'SELECT * FROM trending_notifications WHERE is_read = 0 ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM trending_notifications ORDER BY created_at DESC LIMIT ?';
    return await allQ(sql, [limit]);
  } catch (e) {
    return [];
  }
}

async function markAsRead(ids = null) {
  try {
    if (Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      return await runQ(`UPDATE trending_notifications SET is_read = 1 WHERE id IN (${placeholders})`, ids);
    }
    return await runQ('UPDATE trending_notifications SET is_read = 1 WHERE is_read = 0');
  } catch (e) {
    return 0;
  }
}

// ─── AI Summary Generation via Groq (cached in DB) ─────────
let _groqClient = null;
async function getGroqClient() {
  if (_groqClient) return _groqClient;
  try {
    let key = process.env.GROQ_API_KEY;
    if (!key || key === 'YOUR_GROQ_API_KEY_HERE') {
      try {
        const row = await getQ("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'groq'");
        if (row && row.gia_tri_khoa) key = decryptKey(row.gia_tri_khoa).trim();
      } catch (e) { /* ignore */ }
    }
    if (!key) return null;
    _groqClient = new Groq({ apiKey: key });
    return _groqClient;
  } catch (e) {
    console.error('[GitHub Scheduler] Groq init failed:', e.message);
    return null;
  }
}

async function getCachedSummary(fullName) {
  try {
    const row = await getQ('SELECT summary FROM repo_summaries WHERE full_name = ?', [fullName]);
    return row ? row.summary : '';
  } catch (e) {
    return '';
  }
}

async function saveSummary(fullName, summary, language = '') {
  if (!summary) return false;
  try {
    await runQ(`
      INSERT INTO repo_summaries (full_name, summary, language, updated_at)
      VALUES (?, ?, ?, ${NOW()})
      ON CONFLICT(full_name) DO UPDATE SET
        summary = excluded.summary,
        language = excluded.language,
        updated_at = excluded.updated_at
    `, [fullName, summary, language]);
    return true;
  } catch (e) {
    return false;
  }
}

async function generateRepoSummaries(repos) {
  const groq = await getGroqClient();
  if (!groq) {
    console.log('[GitHub Scheduler] No Groq client, skipping AI summaries');
    return repos;
  }
  console.log('[GitHub Scheduler] Generating AI summaries for ' + repos.length + ' repos...');
  for (let i = 0; i < repos.length; i += 5) {
    const batch = repos.slice(i, i + 5);
    const promises = batch.map(async (repo) => {
      if (repo.ai_summary) return repo;
      const cached = await getCachedSummary(repo.full_name);
      if (cached) {
        repo.ai_summary = cached;
        return repo;
      }
      try {
        const prompt = 'You are a tech-savvy assistant. Given this GitHub repo info, write a SHORT Vietnamese summary (2-3 sentences max) explaining what this project does and why it is trending. Be concise and practical.\n\nRepo: ' + repo.full_name + '\nDescription: ' + (repo.description || 'No description') + '\nLanguage: ' + (repo.language || 'Unknown') + '\nStars: ' + (repo.stars || 0) + '\nTopics: ' + ((repo.topics || []).join(', ') || 'None') + '\n\nWrite ONLY the summary text, no prefix or formatting:';
        const response = await groq.chat.completions.create({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 150,
          temperature: 0.3,
        });
        const summary = response.choices[0] && response.choices[0].message && response.choices[0].message.content;
        if (summary) {
          repo.ai_summary = summary.trim();
          await saveSummary(repo.full_name, repo.ai_summary, repo.language || '');
        }
      } catch (e) {
        console.error('[GitHub Scheduler] Summary failed for ' + repo.full_name + ':', e.message);
      }
    });
    await Promise.all(promises);
    if (i + 5 < repos.length) await new Promise(r => setTimeout(r, 500));
  }
  console.log('[GitHub Scheduler] AI summaries generated: ' + repos.filter(r => r.ai_summary).length + '/' + repos.length);
  return repos;
}

// ─── Star snapshots for saved repos ────────────────────────
async function snapshotSavedRepoStars() {
  try {
    const saved = await allQ('SELECT full_name FROM saved_repos');
    if (!saved.length) return;
    for (const { full_name } of saved) {
      try {
        const [owner, name] = full_name.split('/');
        const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
          headers: { 'User-Agent': 'AI-REXI-Admin' },
        });
        if (!res.ok) continue;
        const data = await res.json();
        const today = new Date().toISOString().slice(0, 10);
        await runQ(`
          INSERT INTO star_snapshots (full_name, stars, created_at)
          VALUES (?, ?, ?)
          ON CONFLICT(full_name, created_at) DO UPDATE SET stars = excluded.stars
        `, [full_name, data.stargazers_count || 0, today]);
        await new Promise(r => setTimeout(r, 500));
      } catch (e) { /* skip */ }
    }
    console.log('[GitHub Scheduler] Star snapshots updated for ' + saved.length + ' saved repos');
  } catch (e) {
    console.error('[GitHub Scheduler] snapshotSavedRepoStars error:', e.message);
  }
}

// ─── Digest (Telegram + Email) ─────────────────────────────
let _nodemailer = null;
function getNodemailer() {
  try {
    if (!_nodemailer) _nodemailer = require('nodemailer');
    return _nodemailer;
  } catch (e) {
    return null;
  }
}

async function getTelegramConfig() {
  try {
    const bot = await getQ("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'telegram_bot'");
    const chat = await getQ("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'telegram_chat'");
    if (bot && bot.gia_tri_khoa && chat && chat.gia_tri_khoa) {
      return { botToken: decryptKey(bot.gia_tri_khoa).trim(), chatId: decryptKey(chat.gia_tri_khoa).trim() };
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function getEmailConfig() {
  try {
    const host = await getQ("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'smtp_host'");
    const user = await getQ("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'smtp_user'");
    const pass = await getQ("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'smtp_pass'");
    const from = await getQ("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'smtp_from'");
    const to = await getQ("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'smtp_to'");
    if (host && user && pass && to) {
      return {
        host: decryptKey(host.gia_tri_khoa).trim(),
        user: decryptKey(user.gia_tri_khoa).trim(),
        pass: decryptKey(pass.gia_tri_khoa).trim(),
        from: from ? decryptKey(from.gia_tri_khoa).trim() : decryptKey(user.gia_tri_khoa).trim(),
        to: decryptKey(to.gia_tri_khoa).trim(),
      };
    }
  } catch (e) { /* ignore */ }
  return null;
}

function formatDigestText(repos) {
  const top = repos.slice(0, 10);
  let text = '🔥 GitHub Trending hôm nay\n\n';
  top.forEach((r, i) => {
    text += `${i + 1}. ${r.full_name} (+${r.stars_gained || 0}★)\n`;
    if (r.description) text += `   ${r.description.slice(0, 80)}\n`;
    text += `   ${r.url}\n\n`;
  });
  return text;
}

async function sendTelegramDigest(text) {
  const cfg = await getTelegramConfig();
  if (!cfg) return false;
  try {
    const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: 'HTML' }),
    });
    return res.ok;
  } catch (e) {
    console.error('[GitHub Scheduler] Telegram digest failed:', e.message);
    return false;
  }
}

async function sendEmailDigest(repos) {
  const cfg = await getEmailConfig();
  const nm = getNodemailer();
  if (!cfg || !nm) return false;
  try {
    const transporter = nm.createTransport({
      host: cfg.host,
      port: 587,
      secure: false,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    const top = repos.slice(0, 15);
    const html = `<h2>🔥 GitHub Trending hôm nay</h2><ol>` + top.map(r =>
      `<li><b>${r.full_name}</b> (+${r.stars_gained || 0}★) — ${(r.description || '').slice(0, 120)}<br><a href="${r.url}">${r.url}</a></li>`
    ).join('') + `</ol>`;
    await transporter.sendMail({
      from: cfg.from,
      to: cfg.to,
      subject: `GitHub Trending ${new Date().toLocaleDateString('vi-VN')}`,
      html,
    });
    return true;
  } catch (e) {
    console.error('[GitHub Scheduler] Email digest failed:', e.message);
    return false;
  }
}

async function sendDailyDigest() {
  console.log('[GitHub Scheduler] Sending daily digest...');
  try {
    const cached = await getCachedRepos('', 'daily');
    if (!cached || !cached.repos || !cached.repos.length) return;
    const text = formatDigestText(cached.repos);
    await sendTelegramDigest(text);
    await sendEmailDigest(cached.repos);
    console.log('[GitHub Scheduler] Digest sent');
  } catch (e) {
    console.error('[GitHub Scheduler] sendDailyDigest error:', e.message);
  }
}

// --- Detect New Repos (compare with cache) ---
async function detectNewRepos(language, since, newRepos) {
  try {
    const cached = await getCachedRepos(language, since);
    if (!cached || !cached.repos) return;
    const oldNames = new Set(cached.repos.map(r => r.full_name));
    const newOnes = newRepos.filter(r => !oldNames.has(r.full_name));
    if (newOnes.length === 0) return;
    console.log('[GitHub Scheduler] Found ' + newOnes.length + ' new repos for ' + (language || 'all') + ' (' + since + ')');
    for (const repo of newOnes) {
      try {
        await runQ('INSERT INTO trending_notifications (full_name, owner, name, description, language, stars, stars_gained, period, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [repo.full_name, repo.owner, repo.name, repo.description || '', repo.language || '', repo.stars || 0, repo.stars_gained || 0, repo.period || '', repo.url || '']);
      } catch (e) { /* skip duplicate */ }
    }
  } catch (e) {
    console.error('[GitHub Scheduler] detectNewRepos error:', e.message);
  }
}

// --- Cleanup Old Notifications (keep last 100) ---
async function cleanupNotifications() {
  try {
    await runQ('DELETE FROM trending_notifications WHERE id NOT IN (SELECT id FROM trending_notifications ORDER BY created_at DESC LIMIT 100)');
  } catch (e) { /* ignore */ }
}

// --- Load notifications from DB ---
async function loadNotificationsFromDB() {
  try {
    return await allQ('SELECT * FROM trending_notifications ORDER BY created_at DESC LIMIT 50');
  } catch (e) { return []; }
}

module.exports = {
  startGitHubScheduler,
  stopGitHubScheduler,
  scrapeTrending,
  cacheRepos,
  getCachedRepos,
  getCacheStatus,
  refreshAllCaches,
  generateRepoSummaries,
  getUnreadCount,
  getNotifications,
  markAsRead,
  getCachedSummary,
  saveSummary,
  snapshotSavedRepoStars,
  sendDailyDigest,
  getTelegramConfig,
  getEmailConfig,
};
