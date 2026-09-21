const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');

// FIX PROD: Secret được giải quyết động: env → global.__JWT_SECRET (tự tạo + lưu DB bởi init-db.js).
// BẢO MẬT: Trong production, nếu không có secret ổn định (env hoặc đã lưu DB) → THROW để tránh
// secret random mỗi lần khởi động khiến mọi token bị vô hiệu + tránh secret dễ đoán.
// (Trong dev vẫn fallback random để server khởi động nhanh khi chưa cấu hình.)
function getJWTSecret() {
  const envSecret = process.env.JWT_SECRET;
  if (envSecret) return envSecret;
  if (global.__JWT_SECRET) return global.__JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET bắt buộc phải được cấu hình (env JWT_SECRET hoặc lưu trong DB) khi chạy ở môi trường production.');
  }
  return 'dev-only-secret-' + crypto.randomBytes(16).toString('hex');
}

// Middleware kiểm tra đã đăng nhập chưa
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error('[authMiddleware] Missing or invalid Authorization header:', authHeader);
        return res.status(401).json({ 
            error: 'Yêu cầu đăng nhập.',
            code: 'LOGIN_REQUIRED'
        });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, getJWTSecret());
        // FIX SECURITY: user bị khoá (banned) KHÔNG được dùng token tiếp (kể cả token cũ)
        db.get(
            "SELECT phan_quyen, trang_thai, token_version FROM nguoi_dung WHERE ma_nguoi_dung = ?", [decoded.id], (err, row) => {
          if (err) {
            console.error('[authMiddleware] DB Error:', err.message);
            return res.status(500).json({ error: 'Lỗi CSDL' });
          }
          if (row && row.trang_thai === 'banned') {
            console.error('[authMiddleware] Banned user attempted access:', decoded.id);
            return res.status(403).json({ error: 'Tài khoản của bạn đã bị khoá.', code: 'ACCOUNT_BANNED' });
          }
          // FIX L6: token cũ phát hành trước lần đăng xuất gần nhất → vô hiệu
          if (row && (decoded.tv || 0) < (row.token_version || 0)) {
            return res.status(401).json({ error: 'Phiên đã đăng xuất trên thiết bị này.', code: 'SESSION_REVOKED' });
          }
          // Gắn thêm role từ DB phòng trường hợp token cũ chưa update role mới
          if (row) {
            decoded.role = row.phan_quyen;
            decoded.phan_quyen = row.phan_quyen;
          }
          req.user = decoded; // Gắn thông tin user (id, role) vào request
          next();
        });
    } catch (ex) {
        console.error('[authMiddleware] Token verify fail:', ex.message);
        res.status(401).json({ 
            error: 'Token không hợp lệ hoặc đã hết hạn.',
            code: 'INVALID_TOKEN'
        });
    }
}

// Middleware kiểm tra có phải admin không
function adminMiddleware(req, res, next) {
    if (req.user && (req.user.role === 'admin' || req.user.phan_quyen === 'admin')) {
        next();
    } else {
        console.error('[adminMiddleware] Access denied for user:', req.user);
        res.status(403).json({ error: 'Bạn không có quyền thực hiện hành động này.' });
    }
}

// Middleware kiểm tra giới hạn cho khách (chưa đăng nhập)
// P3-fix(audit): CHỈ ĐỌC — không gán biến session ở đây (gán = session dirty =
// saveUninitialized:false không chặn được nữa → lại tạo row cho mọi request).
// Counter khởi tạo/ghi thật khi user gửi tin nhắn (chat.routes.js).
function guestMiddleware(req, res, next) {
    if (!req.session) req.session = {};
    const messageCount = req.session.messageCount || 0;
    const agentTaskCount = req.session.agentTaskCount || 0;

    // Giới hạn 10 tin nhắn chat cho người chưa đăng nhập
    if (messageCount >= 10) {
      return res.status(401).json({
        error: 'Bạn đã dùng hết 10 tin nhắn cho tài khoản khách. Hãy đăng nhập để chat không giới hạn.',
        code: 'LOGIN_REQUIRED',
        remaining: { messages: 0, agentTasks: Math.max(0, 3 - agentTaskCount) }
      });
    }
    // LƯU Ý: Không increment messageCount ở đây! Chỉ increment khi POST tin nhắn chat thành công.
    next();
}

// Middleware cho guest dùng Agent Mode (giới hạn 3 tasks)
function guestAgentMiddleware(req, res, next) {
    if (!req.session) req.session = {};
    const agentTaskCount = req.session.agentTaskCount || 0;

    if (agentTaskCount >= 3) {
      return res.status(401).json({
            error: 'Bạn đã dùng hết 3 Agent Mode cho tài khoản khách. Đăng nhập để dùng Agent Mode không giới hạn.',
            code: 'AGENT_LIMIT_REACHED',
            remaining: { messages: Math.max(0, 10 - (req.session.messageCount || 0)), agentTasks: 0 }
        });
    }
    next();
}

// API check guest limits
function getGuestLimits(req) {
    const session = req.session || {};
    return {
        messages: {
            used: session.messageCount || 0,
            limit: 10,
            remaining: Math.max(0, 10 - (session.messageCount || 0))
        },
        agentTasks: {
            used: session.agentTaskCount || 0,
            limit: 3,
            remaining: Math.max(0, 3 - (session.agentTaskCount || 0))
        }
    };
}

module.exports = { authMiddleware, adminMiddleware, guestMiddleware, guestAgentMiddleware, getGuestLimits, getJWTSecret };