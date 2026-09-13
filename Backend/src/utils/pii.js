/**
 * pii.js — PII (Personally Identifiable Information) Redaction Utility
 *
 * Che giấu thông tin nhạy cảm trong log, output chat, audit trail.
 * Hỗ trợ: SĐT Việt Nam, Email, Tên, CMND/CCCD, Thẻ tín dụng, API Keys.
 */

// Regex patterns cho PII phổ biến
const PATTERNS = {
  // SĐT Việt Nam: 0xxxxxxxxx hoặc +84xxxxxxxxx (10-11 số)
  phone: /(?:\+84|0)[3|5|7|8|9][0-9]{8}/g,
  
  // Email
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  
  // CMND (9 số) / CCCD (12 số)
  idCard: /\b\d{9}\b|\b\d{12}\b/g,
  
  // Thẻ tín dụng (13-19 số, nhóm 4)
  creditCard: /\b(?:\d[ -]*?){13,19}\b/g,
  
  // API Key patterns (sk-, pk_,Bearer, sk_live, sk_test, etc.)
  apiKey: /(?:sk|pk|rk|rk_live|rk_test|sk_live|sk_test|api[_-]?key|access[_-]?token|secret[_-]?key)['\s:=]+([a-zA-Z0-9_\-]{20,})/gi,
  
  // JWT tokens
  jwt: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  
  // UUID
  uuid: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  
  // IPv4
  ipv4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  
  // Password in URL (user:pass@host)
  passwordInUrl: /(?<=:)[^:@\s]+(?=@)/g,
  
  // Authorization header values
  authHeader: /Bearer\s+[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.?[A-Za-z0-9\-_=]*/gi,
};

/**
 * Redact PII từ một chuỗi văn bản
 * @param {string} text - Văn bản cần redact
 * @param {Object} options - Tùy chọn
 * @param {string[]} options.exclude - Danh sách pattern names KHÔNG redact
 * @param {string} options.maskChar - Ký tự mask (mặc định: '*')
 * @param {number} options.visibleChars - Số ký tự giữ lại đầu/cuối (mặc định: 2)
 * @returns {string} Văn bản đã redact
 */
function redactPII(text, options = {}) {
  if (!text || typeof text !== 'string') return text;
  
  const { exclude = [], maskChar = '*', visibleChars = 2 } = options;
  let result = text;
  
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    if (exclude.includes(name)) continue;
    
    result = result.replace(pattern, (match) => {
      // Giữ lại một số ký tự để debug
      if (match.length <= visibleChars * 2) {
        return maskChar.repeat(match.length);
      }
      const prefix = match.substring(0, visibleChars);
      const suffix = match.substring(match.length - visibleChars);
      const middle = maskChar.repeat(match.length - visibleChars * 2);
      return prefix + middle + suffix;
    });
  }
  
  return result;
}

/**
 * Redact PII từ object (đệ quy)
 * @param {any} obj - Object/Array/String cần redact
 * @param {Object} options - Tùy chọn giống redactPII
 * @returns {any} Object đã redact
 */
function redactObject(obj, options = {}) {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    return redactPII(obj, options);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item, options));
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact nhạy cảm keys ngay cả khi không khớp pattern
      const sensitiveKeys = ['password', 'mat_khau', 'credential', 'token', 'api_key', 'apikey', 'key', 'secret', 'gia_tri_khoa', 'authorization', 'cookie', 'session'];
      if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
        result[key] = typeof value === 'string' ? maskString(value) : '[REDACTED]';
      } else {
        result[key] = redactObject(value, options);
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * Mask toàn bộ string (dùng cho password, secret)
 */
function maskString(str, visibleChars = 2) {
  if (!str || str.length <= visibleChars * 2) return '*'.repeat(str?.length || 8);
  const prefix = str.substring(0, visibleChars);
  const suffix = str.substring(str.length - visibleChars);
  return prefix + '*'.repeat(str.length - visibleChars * 2) + suffix;
}

/**
 * Middleware Express để redact PII từ request/response body trong log
 */
function piiRedactionMiddleware(options = {}) {
  return (req, res, next) => {
    // Redact request body trước khi log
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = (...args) => {
      originalLog(...args.map(arg => redactObject(arg, options)));
    };
    console.error = (...args) => {
      originalError(...args.map(arg => redactObject(arg, options)));
    };
    
    res.on('finish', () => {
      console.log = originalLog;
      console.error = originalError;
    });
    
    next();
  };
}

module.exports = {
  redactPII,
  redactObject,
  maskString,
  piiRedactionMiddleware,
  PATTERNS,
};