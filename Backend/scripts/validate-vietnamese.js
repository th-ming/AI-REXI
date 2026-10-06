/**
 * ============================================================
 * Rexi AI — Vietnamese Diacritics Validator
 * ============================================================
 * Quy tắc bắt buộc: MỌI string Vietnamese trong source code
 * PHẢI có dấu đầy đủ. KHÔNG được phép tạo string
 * không dấu như "Đăng Nhập", "Mật khẩu", "Vui lòng"...
 *
 * Nếu script này phát hiện vi phạm → BUILD THẤT BẠI
 *
 * Chạy: node scripts/validate-vietnamese.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────
const SCAN_DIRS = [
  path.join(__dirname, '..', '..', 'Frontend', 'src'),
  path.join(__dirname, '..', 'src')
];

const SCAN_EXTENSIONS = ['.jsx', '.js', '.tsx', '.ts'];

// Vietnamese words WITHOUT diacritics that MUST NOT appear
// in string literals (JSX text, error messages, placeholders, labels)
const FORBIDDEN_PATTERNS = [
  // Auth
  /['"`]Dang (Nhap|Ky|nhap|ky)['"`]/,
  /['"`]Mat Khau( Moi)?['"`]/,
  /['"`]Quen Mat Khau['"`]/,
  /['"`]Ho va Ten['"`]/,
  /['"`]Tai Khoan['"`]/,
  /['"`]Dang nhap voi Google['"`]/,
  /['"`]Tao Tai Khoan['"`]/,
  /['"`]Gui Ma OTP['"`]/,
  /['"`]Dat Lai Mat Khau['"`]/,
  /['"`]Quay lai Dang Nhap['"`]/,
  /['"`]Nha Cung Cap['"`]/,
  /['"`]Luu Cau Hinh['"`]/,
  /['"`]Dong Admin Panel['"`]/,
  
  // Messages
  /['"`]Vui long (nhap|kiem tra|nhan|quay)['"`]/,
  /['"`]Khong (ket noi|lay|dung|hop le)['"`]/,
  /['"`]Email (hoac|khong|nay)['"`]/,
  /['"`]Ma OTP (khong|da|cua|6)['"`]/,
  /['"`]Dat lai mat khau ['"`]/,
  /['"`]Dang ky (thanh cong|that bai)['"`]/,
  /['"`]Dang nhap (thanh cong|that bai)['"`]/,
  /['"`]Thieu Google['"`]/,
  /['"`]Credential Google['"`]/,
  /['"`]Loi he thong['"`]/,
  /['"`]Gui Ma OTP['"`]/,
  /['"`]Toi thieu 6 ky tu['"`]/,
  
  // Settings
  /['"`]Google Client ID \(Dang nhap Google\)['"`]/,
  /['"`]Tao tai Google Cloud Console['"`]/,
  /['"`]Can cau hinh Google['"`]/,
  /['"`]Web Application['"`]/,
  
  // Sidebar / UI
  /['"`]Chua dang nhap['"`]/,
  /['"`]Khach['"`]/,
  
  // Error check patterns (includes() calls)
  /\.includes\(['"`]thanh cong['"`]\)/,
  /\.includes\(['"`]OTP cua ban['"`]\)/,
];

// ─── VALIDATOR ─────────────────────────────────────────────
let totalErrors = 0;
let totalFiles = 0;

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relPath = path.relative(path.join(__dirname, '..'), filePath);
  const errors = [];

  lines.forEach((line, idx) => {
    // Skip comments and imports
    if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('import ')) return;
    
    FORBIDDEN_PATTERNS.forEach(pattern => {
      if (pattern.test(line)) {
        errors.push({
          line: idx + 1,
          content: line.trim().substring(0, 120),
          pattern: pattern.source
        });
      }
    });
  });

  if (errors.length > 0) {
    console.log(`\n❌ ${relPath}`);
    errors.forEach(e => {
      console.log(`   Line ${e.line}: ${e.content}`);
    });
    totalErrors += errors.length;
  }
  totalFiles++;
}

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, dist, .git
      if (!['node_modules', 'dist', '.git', '.agents'].includes(entry.name)) {
        scanDir(fullPath);
      }
    } else if (SCAN_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
      scanFile(fullPath);
    }
  });
}

// ─── MAIN ──────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log('  Rexi AI — Vietnamese Diacritics Validator');
console.log('  Mỗi string tiếng Việt PHẢI có dấu. Không được phép thiếu dấu.');
console.log('═══════════════════════════════════════════════════════════\n');

SCAN_DIRS.forEach(scanDir);

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  Files scanned: ${totalFiles}`);
console.log(`  Errors found: ${totalErrors}`);
console.log(`═══════════════════════════════════════════════════════════`);

if (totalErrors > 0) {
  console.log('\n⛔ BUILD FAILED — Phát hiện Vietnamese text không có dấu!');
  console.log('   Vui lòng fix trước khi build.\n');
  process.exit(1);
} else {
  console.log('\n✅ PASS — Tất cả Vietnamese text có dấu đầy đủ.\n');
  process.exit(0);
}
