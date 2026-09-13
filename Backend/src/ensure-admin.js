const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./config/db');

let ADMIN_SEED = null;
// FIX PROD: ưu tiên cấu hình từ env (ADMIN_EMAIL + ADMIN_PASSWORD) — dùng được trên Render,
// không phụ thuộc file 'D:/AI REXI/...' chỉ tồn tại trên máy local.
const isProd = process.env.NODE_ENV === 'production';
const envEmail = (process.env.ADMIN_EMAIL || '').trim();
const envPassword = (process.env.ADMIN_PASSWORD || '').trim();
if (envEmail && envPassword) {
  ADMIN_SEED = {
    email: envEmail,
    mat_khau_ma_hoa_hash: bcrypt.hashSync(envPassword, 10),
    ten_day_du: (process.env.ADMIN_NAME || 'Admin').trim()
  };
  console.log('[ADMIN-SEED] Admin seed từ env (ADMIN_EMAIL)');
} else if (!isProd) {
  // Dev-only: thử file seed local, nếu không có thì seed tạm bằng email dev.
  // Mật khẩu KHÔNG hardcode — được sinh ngẫu nhiên + in ra 1 lần DUY NHẤT
  // tại thời điểm tạo admin (trong ensureAdmin), không log ở boot thường.
  try {
    ADMIN_SEED = require('D:/AI REXI/Database/admin-seed.js');
  } catch (e) {
    ADMIN_SEED = { email: 'admin@rexi.local', mat_khau_ma_hoa_hash: null, ten_day_du: 'Administrator (dev)' };
    console.warn('[ADMIN-SEED] Dev: không có ADMIN_EMAIL/ADMIN_PASSWORD env và không có admin-seed.js — sẽ seed admin tạm khi DB chưa có admin nào.');
  }
} else {
  // P0-02: production thiếu env → THROW để server KHÔNG boot với tài khoản mặc định.
  // (server.js require module này ở top-level → throw ở đây crash process với message rõ ràng.)
  throw new Error('[ADMIN-SEED] NODE_ENV=production nhưng thiếu ADMIN_EMAIL hoặc ADMIN_PASSWORD — từ chối khởi động. Hãy cấu hình 2 biến môi trường này (render.yaml đã khai báo ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME sync:false).');
}

/**
 * Đảm bảo tài khoản admin cố định luôn tồn tại trong DB.
 * Chạy mỗi lần server khởi động.
 */
function ensureAdmin() {
    return new Promise((resolve, reject) => {
        if (!ADMIN_SEED) {
            console.log('[ADMIN-SEED] Skipped: no seed config');
            return resolve();
        }
        // Lấy adapter thực tế (có thể là SQLite/SQLServer/PostgreSQL)
        const dbInstance = db.constructor.name === 'SQLiteAdapter' ? db.db : db;

        // Kiểm tra đối tượng DB có method get không (SQLite)
        const query = typeof dbInstance.get === 'function'
            ? dbInstance.get.bind(dbInstance)
            : null;

        if (!query) {
            // Fallback: nếu không phải SQLite, dùng Promise nhưng không chặn startup
            console.log('[ADMIN-SEED] Skipped: non-SQLite DB detected');
            return resolve();
        }

        dbInstance.get(
            "SELECT ma_nguoi_dung FROM nguoi_dung WHERE phan_quyen = 'admin' LIMIT 1",
            [],
            (err, existingAdmin) => {
                if (err) {
                    console.error('[ADMIN-SEED] Query error:', err);
                    return resolve(); // Không chặn startup
                }

                // P0-02: chỉ seed khi CHƯA CÓ admin nào — boot thường không đụng gì,
                // không bao giờ log password ở boot thường.
                if (existingAdmin) {
                    console.log('[ADMIN-SEED] Admin đã tồn tại — bỏ qua seed.');
                    return resolve();
                }

                dbInstance.get(
                    "SELECT ma_nguoi_dung, email, phan_quyen FROM nguoi_dung WHERE email = ?",
                    [ADMIN_SEED.email],
                    (err2, user) => {
                        if (err2) {
                            console.error('[ADMIN-SEED] Query error:', err2);
                            return resolve(); // Không chặn startup
                        }

                        if (user) {
                            // DB chưa có admin nào nhưng đã có user trùng email seed → nâng quyền, KHÔNG reset password
                            console.log('[ADMIN-SEED] Nâng quyền admin cho user hiện có:', ADMIN_SEED.email);
                            dbInstance.run(
                                "UPDATE nguoi_dung SET phan_quyen = 'admin' WHERE email = ?",
                                [ADMIN_SEED.email],
                                () => resolve()
                            );
                        } else {
                            // Tạo admin mới
                            const maUser = crypto.randomUUID();
                            // SECURITY: dùng hash có sẵn nếu đã được cấu hình (env/seed), không hash lại lần nữa
                            // Nếu chưa có hash (dev fallback) → tạo mật khẩu ngẫu nhiên + hash, in ra 1 LẦN DUY NHẤT tại đây
                            let hashedPassword;
                            if (ADMIN_SEED.mat_khau_ma_hoa_hash) {
                                hashedPassword = ADMIN_SEED.mat_khau_ma_hoa_hash; // đã là bcrypt hash
                            } else {
                                const seedPassword = crypto.randomBytes(12).toString('base64url');
                                hashedPassword = bcrypt.hashSync(seedPassword, 10);
                                console.warn('[ADMIN-SEED] ⚠️ Mật khẩu admin dev ngẫu nhiên (CHỈ HIỆN 1 LẦN — đăng nhập và đổi ngay trong Admin Panel): ' + seedPassword);
                            }

                            console.log('[ADMIN-SEED] Creating admin:', ADMIN_SEED.email);
                            dbInstance.run(
                                "INSERT INTO nguoi_dung (ma_nguoi_dung, email, mat_khau_ma_hoa, ten_day_du, phan_quyen, anh_dai_dien) VALUES (?, ?, ?, ?, 'admin', ?)",
                                [maUser, ADMIN_SEED.email, hashedPassword, ADMIN_SEED.ten_day_du, null],
                                (err3) => {
                                    if (err3) {
                                        console.error('[ADMIN-SEED] Create error:', err3);
                                    } else {
                                        console.log('[ADMIN-SEED] Admin created:', ADMIN_SEED.email);
                                    }
                                    resolve();
                                }
                            );
                        }
                    }
                );
            }
        );
    });
                    }

// ─── Guest user cố định ─────────────────────────────────
// Khách chưa đăng nhập vẫn cần một bản ghi nguoi_dung hợp lệ
// để cuoc_hoi_thoai.ma_nguoi_dung thỏa FK fk_hoi_thoai_user.
const GUEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const GUEST_EMAIL = 'guest@rexi.local';

function ensureGuestUser() {
    return new Promise((resolve) => {
        const dbInstance = db.constructor.name === 'SQLiteAdapter' ? db.db : db;
        const query = typeof dbInstance.get === 'function' ? dbInstance.get.bind(dbInstance) : null;
        if (!query) return resolve();

        dbInstance.get(
            "SELECT ma_nguoi_dung FROM nguoi_dung WHERE ma_nguoi_dung = ?",
            [GUEST_USER_ID],
            (err, row) => {
                if (err) {
                    console.error('[GUEST-SEED] Query error:', err);
                    return resolve();
                }
                if (row) return resolve();

                const hashedPassword = bcrypt.hashSync('guest-no-login', 10);
                dbInstance.run(
                    "INSERT INTO nguoi_dung (ma_nguoi_dung, email, mat_khau_ma_hoa, ten_day_du, phan_quyen, anh_dai_dien) VALUES (?, ?, ?, ?, 'guest', ?)",
                    [GUEST_USER_ID, GUEST_EMAIL, hashedPassword, 'Khách', null],
                    (err2) => {
                        if (err2) {
                            // Có thể email guest đã tồn tại với UUID khác — thử khớp theo email
                            dbInstance.get(
                                "SELECT ma_nguoi_dung FROM nguoi_dung WHERE email = ?",
                                [GUEST_EMAIL],
                                (err3, existing) => {
                                    if (!err3 && existing) console.log('[GUEST-SEED] Matched existing guest:', existing.ma_nguoi_dung);
                                    else console.error('[GUEST-SEED] Create error:', err2 && err2.message);
                                    resolve();
                                }
                            );
                        } else {
                            console.log('[GUEST-SEED] Guest user ready:', GUEST_EMAIL);
                            resolve();
                        }
                    }
                );
            }
        );
    });
                    }

module.exports = { ensureAdmin, ensureGuestUser, GUEST_USER_ID };
