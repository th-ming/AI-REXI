/**
 * RATE LIMIT — giới hạn số yêu cầu theo IP (in-memory, không cần thêm dependency)
 */
const hits = new Map();

function rateLimit({ windowMs = 60000, max = 60, message = 'Quá nhiều yêu cầu liên tiếp. Vui lòng chờ một chút rồi thử lại.' } = {}) {
  return (req, res, next) => {
    // P1-07: key theo user đăng nhập (chống 1 IP NAT chia quota oan + user không ké quota nhau),
    // khách chưa login thì rơi về IP (cần trust proxy để IP đúng sau proxy)
    const key = (req.user && req.user.id) || req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Dọn dẹp entry cũ mỗi phút (unref để không giữ process)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) {
    if (now > v.resetAt) hits.delete(k);
  }
}, 60000).unref();

module.exports = { rateLimit };
