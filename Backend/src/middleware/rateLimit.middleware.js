const jwt = require('jsonwebtoken');
const { getJWTSecret } = require('./auth.middleware');

const requestCounts = new Map();
const WINDOW_MS = 60 * 1000; // 1 minute window

// FIX memory leak: dọn entries hết hạn định kỳ (trước đây Map không bao giờ được xóa)
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of requestCounts.entries()) {
    if (now > rec.resetTime) requestCounts.delete(ip);
  }
}, WINDOW_MS);
const MAX_REQUESTS_PER_MINUTE = 100; // Relax limit to 100 requests per minute for normal users

function rateLimitMiddleware(req, res, next) {
  // Check if request carries an admin token to bypass rate limit
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, getJWTSecret());
      if (decoded && decoded.role === 'admin') {
        return next(); // Bỏ qua rate limit hoàn toàn cho Admin
      }
    } catch (e) {
      // Token lỗi hoặc hết hạn thì áp dụng rate limit bình thường
    }
  }

  // P1-07: req.ip đã đúng client thật nhờ app.set('trust proxy', 1) (Express chỉ tin XFF từ
  // proxy hop được trust — client không tự đặt X-Forwarded-For để bypass được khi proxy append IP thật).
  // Không đọc trực tiếp header X-Forwarded-For ở đây (chống bypass rate limit).
  // Key theo user đăng nhập nếu có (middleware này chạy trước auth nên thường rơi về IP — đúng như cũ).
  const ip = (req.user && req.user.id) || req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  const now = Date.now();

  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return next();
  }

  const record = requestCounts.get(ip);
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + WINDOW_MS;
    return next();
  }

  record.count += 1;
  if (record.count > MAX_REQUESTS_PER_MINUTE) {
    return res.status(429).json({
      error: 'Quá nhiều yêu cầu trong thời gian ngắn (Rate Limit Exceeded). Vui lòng đợi 1 phút.'
    });
  }

  next();
}

module.exports = {
  rateLimitMiddleware
};

