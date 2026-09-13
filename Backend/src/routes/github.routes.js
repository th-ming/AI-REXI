/**
 * GitHub Trending Routes
 * 
 * GET    /api/admin/github/trending          - Lấy danh sách trending repos
 * GET    /api/admin/github/search            - Tìm kiếm repos theo keyword
 * GET    /api/admin/github/repo/:owner/:name - Chi tiết 1 repo
 * GET    /api/admin/github/saved             - Danh sách repos đã lưu
 * POST   /api/admin/github/saved             - Lưu 1 repo
 * DELETE /api/admin/github/saved/:owner/:name - Bỏ lưu 1 repo
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const { authMiddleware, adminMiddleware } = require('../middleware/auth.middleware');
const { rateLimit } = require('../middleware/rateLimit');
const { decryptKey } = require('../utils/cryptoKeys');

router.use(authMiddleware);
router.use(adminMiddleware);

const {
  getCachedRepos, getCacheStatus, scrapeTrending, cacheRepos,
  getUnreadCount, getNotifications, markAsRead, generateRepoSummaries,
  getCachedSummary, saveSummary, snapshotSavedRepoStars, sendDailyDigest,
  getTelegramConfig, getEmailConfig,
} = require('../github-trending-scheduler');

const GITHUB_API = 'https://api.github.com';
let GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_KEY || '';

// FIX PROD: dùng chung adapter db.js (SQLite local / PostgreSQL trên Render) thay vì
// better-sqlite3 file cứng — trước đây saved/starred repos nằm trong file DB riêng,
// tách khỏi DB chính + bị xóa mỗi lần redeploy trên Render.
const db = require('../config/db');

// Promise helpers cho adapter (callback-based)
const runQ = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this && this.changes != null ? this.changes : 0); }));
const getQ = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const allQ = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));

// Load GitHub token từ DB (adapter bất đồng bộ — load lazy qua promise)
let tokenLoadPromise = null;
function ensureGithubToken() {
  if (GITHUB_TOKEN) return Promise.resolve(GITHUB_TOKEN);
  if (!tokenLoadPromise) {
    tokenLoadPromise = getQ("SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = 'github'")
      .then(row => { if (row && row.gia_tri_khoa) GITHUB_TOKEN = decryptKey(row.gia_tri_khoa).trim(); return GITHUB_TOKEN; })
      .catch(() => GITHUB_TOKEN);
  }
  return tokenLoadPromise;
}

async function githubFetch(path, token) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'AI-REXI-Admin',
  };
  const authToken = token || (await ensureGithubToken());
  if (authToken) headers['Authorization'] = `token ${authToken}`;
  
  const res = await fetch(`${GITHUB_API}${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ─── Trending Repos (scrape github.com/trending) ────────────
router.get('/trending', async (req, res) => {
  try {
    const { language = '', since = 'daily' } = req.query;
    
    let url = `https://github.com/trending`;
    if (language) url += `/${encodeURIComponent(language)}`;
    url += `?since=${since}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    
    if (!response.ok) throw new Error(`GitHub Trending fetch failed: ${response.status}`);
    
    const html = await response.text();
    
    // Parse trending repos from HTML
    const repos = [];
    const rows = html.split(/class="Box-row"/).slice(1);
    
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
        
        // Language
        const langMatch = row.match(/itemprop="programmingLanguage">\s*(.*?)\s*</);
        const languageName = langMatch ? langMatch[1].trim() : '';
        
        // Stars gained (e.g. "2,657 stars today" or "496 stars this week")
        const starsTodayMatch = row.match(/([\d,]+)\s+stars?\s+(today|this week|this month)/i);
        const starsGained = starsTodayMatch ? parseInt(starsTodayMatch[1].replace(/,/g, '')) : 0;
        const period = starsTodayMatch ? starsTodayMatch[2] : '';
        
        // Total stars — get the number between last > and </a> in stargazers link
        let totalStars = 0;
        const starsLinkMatch = row.match(/href="[^"]*\/stargazers"[\s\S]*?<\/a>/);
        if (starsLinkMatch) {
          const noSvg = starsLinkMatch[0].replace(/<svg[\s\S]*?<\/svg>/g, '');
          const numInLink = noSvg.match(/>\s*([\d,]+)\s*<\/a>/);
          if (numInLink) totalStars = parseInt(numInLink[1].replace(/,/g, ''));
        }
        
        // Forks — get the number between last > and </a> in forks link
        let forks = 0;
        const forksLinkMatch = row.match(/href="[^"]*\/forks"[\s\S]*?<\/a>/);
        if (forksLinkMatch) {
          const noSvg = forksLinkMatch[0].replace(/<svg[\s\S]*?<\/svg>/g, '');
          const numInLink = noSvg.match(/>\s*([\d,]+)\s*<\/a>/);
          if (numInLink) forks = parseInt(numInLink[1].replace(/,/g, ''));
        }
        
        // Built by (avatars)
        const builtByMatch = row.match(/Built by([\s\S]*?)<\/div>/);
        const contributors = [];
        if (builtByMatch) {
          const avatarMatches = builtByMatch[1].matchAll(/alt="@([^"]+)"/g);
          for (const m of avatarMatches) {
            contributors.push(m[1]);
          }
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
    
    // Enrich with GitHub API data (topics + better description) — top 15 only
    const toEnrich = repos.slice(0, 15);
    await Promise.allSettled(toEnrich.map(async (repo) => {
      try {
        const data = await githubFetch(`/repos/${repo.owner}/${repo.name}`);
        repo.description = data.description || repo.description;
        repo.topics = data.topics || [];
        repo.homepage = data.homepage || '';
        repo.license = data.license?.spdx_id || '';
        repo.stars = data.stargazers_count || repo.stars;
        repo.forks = data.forks_count || repo.forks;
        repo.open_issues = data.open_issues_count || 0;
        repo.watchers = data.watchers_count || 0;
        repo.size = data.size || 0;
        repo.created_at = data.created_at || '';
        repo.updated_at = data.updated_at || '';
        repo.pushed_at = data.pushed_at || '';
      } catch (e) { /* skip */ }
    }));
    
    // Generate AI summaries for repos that don't have one yet
    const reposNeedingSummary = repos.filter(r => !r.ai_summary);
    if (reposNeedingSummary.length > 0) {
      try {
        await generateRepoSummaries(reposNeedingSummary);
      } catch (e) {
        console.error('[GitHub Trending] AI summary generation failed:', e.message);
      }
    }
    
    res.json({ success: true, repos, since, language });
  } catch (error) {
    console.error('[GitHub Trending Error]', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Search Repos ───────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const { q, sort = 'stars', order = 'desc', per_page = 20, page = 1 } = req.query;
    
    if (!q) return res.status(400).json({ success: false, error: 'Missing query parameter "q"' });
    
    const data = await githubFetch(
      `/search/repositories?q=${encodeURIComponent(q)}&sort=${sort}&order=${order}&per_page=${per_page}&page=${page}`
    );
    
    const repos = data.items.map(r => ({
      id: r.id,
      full_name: r.full_name,
      owner: r.owner.login,
      name: r.name,
      description: r.description || '',
      language: r.language || '',
      stars: r.stargazers_count,
      forks: r.forks_count,
      open_issues: r.open_issues_count,
      watchers: r.watchers_count,
      url: r.html_url,
      homepage: r.homepage || '',
      topics: r.topics || [],
      created_at: r.created_at,
      updated_at: r.updated_at,
      pushed_at: r.pushed_at,
      license: r.license?.spdx_id || 'None',
      archived: r.archived,
      fork: r.fork,
    }));
    
    res.json({
      success: true,
      total_count: data.total_count,
      repos,
      page: Number(page),
      per_page: Number(per_page),
    });
  } catch (error) {
    console.error('[GitHub Search Error]', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Danh sách repos đã lưu ─────────────────────────────────
router.get('/saved', async (req, res) => {
  try {
    const rows = await allQ('SELECT * FROM saved_repos ORDER BY saved_at DESC');
    res.json({ success: true, repos: rows });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ─── Lưu 1 repo ─────────────────────────────────────────────
router.post('/saved', async (req, res) => {
  const {
    full_name, owner, name, description, language,
    stars = 0, forks = 0, stars_gained = 0, period = '', url
  } = req.body || {};

  if (!full_name) return res.status(400).json({ success: false, error: 'Missing full_name' });

  try {
    await runQ(`
      INSERT INTO saved_repos (full_name, owner, name, description, language, stars, forks, stars_gained, period, url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(full_name) DO UPDATE SET
        description = excluded.description,
        language = excluded.language,
        stars = excluded.stars,
        forks = excluded.forks,
        stars_gained = excluded.stars_gained,
        period = excluded.period,
        url = excluded.url
    `, [full_name, owner || full_name.split('/')[0], name || full_name.split('/')[1],
      description || '', language || '', stars, forks, stars_gained, period, url || `https://github.com/${full_name}`]);
    res.json({ success: true, message: `Đã lưu ${full_name}` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Bỏ lưu 1 repo ──────────────────────────────────────────
router.delete('/saved/:owner/:name', async (req, res) => {
  const fullName = `${req.params.owner}/${req.params.name}`;
  try {
    const changes = await runQ('DELETE FROM saved_repos WHERE full_name = ?', [fullName]);
    res.json({ success: true, deleted: changes > 0 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Repo Detail ────────────────────────────────────────────
router.get('/repo/:owner/:name', async (req, res) => {
  try {
    const { owner, name } = req.params;
    const data = await githubFetch(`/repos/${owner}/${name}`);
    
    // README (base64) + contributors + latest release — best effort, don't fail the whole call
    let readme = '', readmeBase64 = false;
    let contributors = [], latestRelease = null, totalStars;
    await Promise.allSettled([
      (async () => {
        try {
          const rm = await githubFetch(`/repos/${owner}/${name}/readme`);
          if (rm && rm.content) { readme = rm.content; readmeBase64 = true; }
        } catch (e) { /* no readme */ }
      })(),
      (async () => {
        try {
          const c = await githubFetch(`/repos/${owner}/${name}/contributors?per_page=10&anon=1`);
          contributors = (c || []).map(u => ({ login: u.login || 'anonymous', avatar_url: u.avatar_url, contributions: u.contributions }));
        } catch (e) { /* skip */ }
      })(),
      (async () => {
        try {
          const rel = await githubFetch(`/repos/${owner}/${name}/releases/latest`);
          latestRelease = { tag_name: rel.tag_name, name: rel.name, published_at: rel.published_at, body: rel.body };
        } catch (e) { /* no release */ }
      })(),
    ]);
    try {
      const st = await githubFetch(`/repos/${owner}/${name}/stargazers?per_page=1&page=1`);
      totalStars = Array.isArray(st) ? st.length : 0;
    } catch (e) { totalStars = data.stargazers_count; }

    const aiSummary = await getCachedSummary(data.full_name);

    res.json({
      success: true,
      repo: {
        id: data.id,
        full_name: data.full_name,
        description: data.description || '',
        language: data.language || '',
        stars: data.stargazers_count,
        forks: data.forks_count,
        open_issues: data.open_issues_count,
        watchers: data.watchers_count,
        size: data.size,
        url: data.html_url,
        homepage: data.homepage || '',
        topics: data.topics || [],
        created_at: data.created_at,
        updated_at: data.updated_at,
        pushed_at: data.pushed_at,
        license: data.license?.name || 'None',
        default_branch: data.default_branch,
        archived: data.archived,
        owner_avatar: data.owner?.avatar_url || '',
        owner_html_url: data.owner?.html_url || '',
        readme,
        readme_base64: readmeBase64,
        contributors,
        latest_release: latestRelease,
        ai_summary: aiSummary || '',
      },
    });
  } catch (error) {
    console.error('[GitHub Repo Error]', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Star growth history ───────────────────────────────────
router.get('/stars/:owner/:name/history', async (req, res) => {
  const fullName = `${req.params.owner}/${req.params.name}`;
  try {
    const rows = await allQ('SELECT stars, created_at FROM star_snapshots WHERE full_name = ? ORDER BY created_at ASC', [fullName]);
    res.json({ success: true, points: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Export saved repos ────────────────────────────────────
// P2-20(11): resolve GitHub token — ưu tiên token user gửi kèm (header
// x-github-token hoặc ?github_token=), không thì mới dùng server token.
// (Authorization header là JWT Rexi, KHÔNG phải GitHub token nên không dùng.)
async function resolveGithubToken(req) {
  const userToken = String(req.headers['x-github-token'] || req.query.github_token || '').trim();
  if (userToken) return userToken;
  return ensureGithubToken();
}

router.get('/export/saved', rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
  const { format = 'json' } = req.query;
  try {
    const rows = await allQ('SELECT * FROM saved_repos ORDER BY saved_at DESC');
    const filename = `github-saved-${new Date().toISOString().slice(0, 10)}`;
    if (format === 'csv') {
      const headers = ['full_name', 'owner', 'name', 'description', 'language', 'stars', 'forks', 'stars_gained', 'period', 'url', 'saved_at'];
      const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send('\uFEFF' + csv);
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    return res.send(JSON.stringify(rows, null, 2));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Export starred repos ──────────────────────────────────
router.get('/export/starred', rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
  try {
    const { format = 'json' } = req.query;
    const ghToken = await resolveGithubToken(req);
    const response = await fetch('https://api.github.com/user/starred?per_page=100&sort=created&direction=desc', {
      headers: {
        'Authorization': `token ${ghToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'AI-REXI-Admin',
      },
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const data = await response.json();
    const rows = data.map(r => ({
      full_name: r.full_name, owner: r.owner.login, name: r.name,
      description: r.description || '', language: r.language || '',
      stars: r.stargazers_count, forks: r.forks_count, url: r.html_url,
      starred_at: r.created_at,
    }));
    const filename = `github-starred-${new Date().toISOString().slice(0, 10)}`;
    if (format === 'csv') {
      const headers = ['full_name', 'owner', 'name', 'description', 'language', 'stars', 'forks', 'url', 'starred_at'];
      const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send('\uFEFF' + csv);
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    return res.send(JSON.stringify(rows, null, 2));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Digest config status + manual trigger ─────────────────
router.get('/digest/status', async (req, res) => {
  const tg = await getTelegramConfig();
  const em = await getEmailConfig();
  res.json({
    success: true,
    telegram: !!tg,
    email: !!em,
    telegram_chat: tg ? tg.chatId : '',
    email_to: em ? em.to : '',
  });
});

router.post('/digest/send', async (req, res) => {
  try {
    await sendDailyDigest();
    res.json({ success: true, message: 'Digest triggered' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/stars/snapshot', async (req, res) => {
  try {
    await snapshotSavedRepoStars();
    res.json({ success: true, message: 'Star snapshots updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Trending Notifications ─────────────────────────────────
router.get('/notifications', async (req, res) => {
  try {
    const { limit = 20, unread_only = '0' } = req.query;
    const notifications = await getNotifications(Number(limit), unread_only === '1');
    const unread_count = await getUnreadCount();
    res.json({ success: true, notifications, unread_count });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/notifications/unread-count', async (req, res) => {
  try {
    const count = await getUnreadCount();
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/notifications/read', async (req, res) => {
  try {
    const { ids } = req.body || {};
    await markAsRead(ids || null);
    res.json({ success: true, message: 'Marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// --- GitHub Star/Unstar (requires GitHub PAT with repo scope) ---

// Check if a repo is starred — ALWAYS verify with GitHub API, then sync local DB
router.get('/starred/:owner/:name', async (req, res) => {
  try {
    const { owner, name } = req.params;
    const fullName = `${owner}/${name}`;
    await ensureGithubToken();

    // Always check GitHub API first (source of truth)
    if (GITHUB_TOKEN) {
      try {
        const response = await fetch(`https://api.github.com/user/starred/${owner}/${name}`, {
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'AI-REXI-Admin' },
        });
        const isStarredOnGithub = response.status === 204;

        // Sync DB với GitHub (nguồn sự thật)
        if (isStarredOnGithub) {
          await runQ("INSERT INTO starred_repos (full_name, owner, name) VALUES (?, ?, ?) ON CONFLICT(full_name) DO NOTHING", [fullName, owner, name]);
        } else {
          await runQ("DELETE FROM starred_repos WHERE full_name = ?", [fullName]);
        }

        return res.json({ success: true, starred: isStarredOnGithub });
      } catch {}
    }

    // Fallback: DB only (no GitHub token)
    const row = await getQ("SELECT id FROM starred_repos WHERE full_name = ?", [fullName]).catch(() => null);
    res.json({ success: true, starred: !!row });
  } catch (error) {
    res.json({ success: true, starred: false });
  }
});

// Batch check starred repos — 1 API call instead of N
router.post('/starred/batch', async (req, res) => {
  try {
    const { repos } = req.body || {}; // [{owner, name}, ...]
    if (!Array.isArray(repos) || repos.length === 0) {
      return res.json({ success: true, starred: {} });
    }

    await ensureGithubToken();
    const result = {};

    // Fetch all user's starred repos from GitHub (max 100)
    if (GITHUB_TOKEN) {
      try {
        const response = await fetch('https://api.github.com/user/starred?per_page=100&sort=created&direction=desc', {
          headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'AI-REXI-Admin' },
        });
        if (response.ok) {
          const starred = await response.json();
          const starredSet = new Set(starred.map(r => r.full_name.toLowerCase()));

          for (const repo of repos) {
            const fullName = `${repo.owner}/${repo.name}`;
            const isStarred = starredSet.has(fullName.toLowerCase());
            result[fullName] = isStarred;

            // Sync DB với GitHub
            if (isStarred) {
              await runQ("INSERT INTO starred_repos (full_name, owner, name) VALUES (?, ?, ?) ON CONFLICT(full_name) DO NOTHING", [fullName, repo.owner, repo.name]);
            } else {
              await runQ("DELETE FROM starred_repos WHERE full_name = ?", [fullName]);
            }
          }
          return res.json({ success: true, starred: result });
        }
      } catch {}
    }

    // Fallback: DB only
    for (const repo of repos) {
      const fullName = `${repo.owner}/${repo.name}`;
      const row = await getQ("SELECT id FROM starred_repos WHERE full_name = ?", [fullName]).catch(() => null);
      result[fullName] = !!row;
    }
    res.json({ success: true, starred: result });
  } catch (error) {
    res.json({ success: true, starred: {} });
  }
});

// Star a repo — hybrid: save local + try GitHub API
router.post('/star', async (req, res) => {
  try {
    const { owner, name } = req.body || {};
    if (!owner || !name) return res.status(400).json({ success: false, error: 'Missing owner or name' });
    const fullName = `${owner}/${name}`;
    // Save locally
    await runQ("INSERT INTO starred_repos (full_name, owner, name) VALUES (?, ?, ?) ON CONFLICT(full_name) DO NOTHING", [fullName, owner, name]);
    // Also try GitHub API (best effort)
    await ensureGithubToken();
    if (GITHUB_TOKEN) {
      try {
        const r = await fetch(`https://api.github.com/user/starred/${owner}/${name}`, {
          method: 'PUT', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'AI-REXI-Admin', 'Content-Length': '0' }
        });
        return res.json({ success: true, starred: true, github: r.status === 204, message: `Starred ${fullName}` });
      } catch {}
    }
    res.json({ success: true, starred: true, github: false, message: `Starred ${fullName} (local)` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Unstar a repo — hybrid: remove local + try GitHub API
router.delete('/star/:owner/:name', async (req, res) => {
  try {
    const { owner, name } = req.params;
    const fullName = `${owner}/${name}`;
    // Remove locally
    await runQ("DELETE FROM starred_repos WHERE full_name = ?", [fullName]);
    // Also try GitHub API (best effort)
    await ensureGithubToken();
    if (GITHUB_TOKEN) {
      try {
        await fetch(`https://api.github.com/user/starred/${owner}/${name}`, {
          method: 'DELETE', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'AI-REXI-Admin' }
        });
      } catch {}
    }
    res.json({ success: true, starred: false, message: `Unstarred ${fullName}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all starred repos for the authenticated user
router.get('/starred', async (req, res) => {
  try {
    await ensureGithubToken();
    if (!GITHUB_TOKEN) {
      return res.json({ success: true, repos: [], error: 'No GitHub token configured' });
    }
    const response = await fetch('https://api.github.com/user/starred?per_page=100&sort=created&direction=desc', {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'AI-REXI-Admin',
      },
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const data = await response.json();
    const repos = data.map(r => ({
      full_name: r.full_name,
      owner: r.owner.login,
      name: r.name,
      description: r.description || '',
      language: r.language || '',
      stars: r.stargazers_count,
      forks: r.forks_count,
      url: r.html_url,
      topics: r.topics || [],
      starred_at: r.created_at,
    }));
    res.json({ success: true, repos, count: repos.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

