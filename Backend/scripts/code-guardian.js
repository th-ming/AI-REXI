/**
 * Rexi AI Code Guardian
 * Quét tất cả file, phát hiện và xóa file rác,
 * kiểm tra Vietnamese diacritics, báo cáo chất lượng code.
 *
 * Chạy: node scripts/code-guardian.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'Backend');

function findJunkFiles(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  const walk = (d) => {
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          if (!['node_modules', 'dist', '.git', '.agents', 'build'].includes(e.name)) walk(full);
        } else {
          const name = e.name;
          const ext = path.extname(name);
          const rel = path.relative(ROOT, full).replace(/\\/g, '/');
          if (rel.includes('node_modules/')) continue;
          if (ext === '.log' || name.endsWith('.log')) { found.push({ path: full, reason: 'Log file', size: fs.statSync(full).size }); continue; }
          if (['.tmp', '.bak', '.old', '.swp', '.swo', '.cache', '.orig'].includes(ext)) { found.push({ path: full, reason: 'Tệp tạm', size: fs.statSync(full).size }); continue; }
          if (['Thumbs.db', '.DS_Store', 'desktop.ini'].includes(name)) { found.push({ path: full, reason: 'Tệp hệ thống', size: fs.statSync(full).size }); continue; }
          if (name === '.archive_scripts') { found.push({ path: full, reason: 'Thư mục lưu trữ cũ', size: 0, isDir: true }); continue; }

          const relRoot = path.relative(ROOT, full).replace(/\\/g, '/');
          const inRoot = !relRoot.includes('/');

          if (inRoot) {
            if (ext === '.js' && (name.startsWith('patch_') || name.startsWith('fix_') || name.startsWith('test_') || name.startsWith('debug_') || name.startsWith('temp_') || name.startsWith('apply_'))) { found.push({ path: full, reason: 'Script patch/debug cũ ở root', size: fs.statSync(full).size }); continue; }
            if (ext === '.jsx' && !name.startsWith('App') && !name.startsWith('main')) { found.push({ path: full, reason: 'Component rác ở root', size: fs.statSync(full).size }); continue; }
          }

          const relBackend = path.relative(BACKEND, full).replace(/\\/g, '/');
          if (!relBackend.includes('/') && ext === '.js') {
            const junkNames = ['db_patch.js', 'gen_auth.js', 'init_db.js', 'patch_db.js', 'check_db.js', 'migrate_db.js'];
            if (junkNames.includes(name)) { found.push({ path: full, reason: 'Script migration cũ', size: fs.statSync(full).size }); continue; }
            if (name.startsWith('fix_') || name.startsWith('test_') || name.startsWith('debug_') || name.startsWith('temp_') || name.startsWith('patch_') || name.startsWith('apply_')) { found.push({ path: full, reason: 'Script tạm / debug', size: fs.statSync(full).size }); continue; }
          }
          if (relBackend === 'src/server.js' && fs.statSync(full).size === 0) { found.push({ path: full, reason: 'Tệp rỗng', size: 0 }); continue; }
        }
      }
    } catch (e) {}
  };
  walk(dir);
  return found;
}

function checkVietnamese(dir) {
  const errors = [];
  const exts = ['.jsx', '.js', '.tsx', '.ts'];
  const patterns = [
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
    /['"`]Vui long (nhap|kiem tra|nhan|quay)['"`]/,
    /['"`]Khong (ket noi|lay|dung|hop le)['"`]/,
    /['"`]Email (hoac|khong|nay)['"`]/,
    /['"`]Ma OTP (khong|da|cua|6)['"`]/,
    /['"`]Dat lai mat khau ['"`]/,
    /['"`]Dang ky (thanh cong|that bai)['"`]/,
    /['"`]Dang nhap (thanh cong|that bai)['"`]/,
    /['"`]Thieu Google['"`]/,
    /['"`]Loi he thong['"`]/,
    /['"`]Toi thieu 6 ky tu['"`]/,
    /['"`]Google Client ID \(Dang nhap Google\)['"`]/,
    /['"`]Tao tai Google Cloud Console['"`]/,
    /['"`]Chua dang nhap['"`]/,
    /['"`]Co loi xay ra['"`]/,
    /['"`]Co the['"`]/,
    /['"`]Khong tim thay['"`]/,
    /['"`]Dang xu ly['"`]/,
    /['"`]Xac nhan['"`]/,
    /['"`]Hop le['"`]/,
    /['"`]Khong hop le['"`]/,
    /['"`]Da ton tai['"`]/,
    /\.includes\(['"`]thanh cong['"`]\)/,
    /\.includes\(['"`]OTP cua ban['"`]\)/,
  ];
  const walk = (d) => {
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          if (!['node_modules', 'dist', '.git', '.agents', 'build'].includes(e.name)) walk(full);
        } else if (exts.some(x => e.name.endsWith(x))) {
          const rel = path.relative(ROOT, full).replace(/\\/g, '/');
          if (rel.includes('node_modules/')) continue;
          try {
            const content = fs.readFileSync(full, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('import ')) return;
              patterns.forEach(p => {
                if (p.test(line)) errors.push({ file: rel, line: idx + 1, content: line.trim().substring(0, 120) });
              });
            });
          } catch (e) {}
        }
      }
    } catch (e) {}
  };
  walk(dir);
  return errors;
}

function fmt(b) {
  if (b === 0) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

console.log('');
console.log('============================================================');
console.log('  Rexi AI CODE GUARDIAN — Người Giám Sát Code');
console.log('============================================================');

console.log('\n[1/3] Đang quét file rác...');
const junk = findJunkFiles(ROOT);
let totalSize = 0;
junk.forEach(f => totalSize += f.size);

if (junk.length > 0) {
  console.log('  Tìm thấy ' + junk.length + ' file rác (' + fmt(totalSize) + '):');
  junk.forEach(f => {
    const r = path.relative(ROOT, f.path).replace(/\\/g, '/');
    const tag = f.isDir ? '[THƯ MỤC]' : '[' + fmt(f.size) + ']';
    console.log('    ' + tag + ' ' + r + ' — ' + f.reason);
  });

  console.log('\n  Đang xóa...');
  let deleted = 0;
  junk.forEach(f => {
    try {
      if (f.isDir) {
        fs.rmSync(f.path, { recursive: true, force: true });
      } else {
        fs.unlinkSync(f.path);
      }
      deleted++;
    } catch (e) {}
  });
  console.log('  Đã xóa ' + deleted + '/' + junk.length + ' file rác.');
} else {
  console.log('  Không có file rác nào!');
}

console.log('\n[2/3] Kiểm tra Vietnamese diacritics...');
const vnErr = checkVietnamese(ROOT);
if (vnErr.length > 0) {
  console.log('  [!] Tìm thấy ' + vnErr.length + ' lỗi:');
  vnErr.forEach(e => console.log('    ' + e.file + ':' + e.line + ': ' + e.content));
} else {
  console.log('  Tất cả Vietnamese text có dấu đầy đủ. OK!');
}

console.log('\n[3/3] Báo cáo tổng hợp...');
console.log('  ------------------------------------------------');
console.log('  File rác tìm thấy:    ' + junk.length);
console.log('  File đã xóa:          ' + (junk.length > 0 ? 'Có' : 'Không'));
console.log('  Tổng dung lượng rác:  ' + fmt(totalSize));
console.log('  Lỗi Viet diacritics:  ' + vnErr.length);
console.log('  ------------------------------------------------');

if (vnErr.length > 0) {
  console.log('\n⛔ PHÁT HIỆN VI PHẠM — KHÔNG ĐƯỢC BUILD!');
  process.exit(1);
} else {
  console.log('\n✅ TẤT CẢ OK — SẴN SÀNG BUILD!');
  process.exit(0);
}
