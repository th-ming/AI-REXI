-- ============================================================
-- Rexi AI — PostgreSQL Schema (Supabase / Render)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. NGUOI DUNG
CREATE TABLE IF NOT EXISTS nguoi_dung (
    ma_nguoi_dung    VARCHAR(64) PRIMARY KEY,
    email            VARCHAR(255) NOT NULL UNIQUE,
    mat_khau_ma_hoa  VARCHAR(255) NOT NULL,
    ten_day_du       VARCHAR(255),
    anh_dai_dien     TEXT,
    cai_dat_ca_nhan  JSONB DEFAULT '{}',
    ngay_tao         TIMESTAMPTZ DEFAULT NOW(),
    ngay_cap_nhat    TIMESTAMPTZ DEFAULT NOW(),
    phan_quyen       VARCHAR(20) DEFAULT 'user',
    trang_thai       VARCHAR(20) DEFAULT 'active',
    otp_code         VARCHAR(10),
    otp_expiry       BIGINT
);

-- 2. THU MUC DU AN
CREATE TABLE IF NOT EXISTS thu_muc_du_an (
    ma_thu_muc       VARCHAR(64) PRIMARY KEY,
    ma_nguoi_dung    VARCHAR(64) REFERENCES nguoi_dung(ma_nguoi_dung),
    ten_thu_muc      VARCHAR(255) NOT NULL,
    duong_dan_may_tinh TEXT NOT NULL,
    link_git         TEXT,
    ngay_tao         TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CUOC HOI THOAI
CREATE TABLE IF NOT EXISTS cuoc_hoi_thoai (
    ma_hoi_thoai     VARCHAR(64) PRIMARY KEY,
    ma_nguoi_dung    VARCHAR(64) REFERENCES nguoi_dung(ma_nguoi_dung),
    ma_thu_muc       VARCHAR(64) REFERENCES thu_muc_du_an(ma_thu_muc),
    tieu_de          VARCHAR(255) DEFAULT 'Tro chuyen moi',
    ten_mo_hinh_ai   VARCHAR(100) NOT NULL DEFAULT 'gemini-3.6-flash',
    trang_thai       VARCHAR(50) DEFAULT 'dang_mo',
    ngay_tao         TIMESTAMPTZ DEFAULT NOW(),
    ngay_cap_nhat    TIMESTAMPTZ DEFAULT NOW(),
    ngay_xoa         TIMESTAMPTZ
);

-- 4. TIN NHAN
CREATE TABLE IF NOT EXISTS tin_nhan (
    ma_tin_nhan      VARCHAR(64) PRIMARY KEY,
    ma_hoi_thoai     VARCHAR(64) REFERENCES cuoc_hoi_thoai(ma_hoi_thoai) ON DELETE CASCADE,
    vai_tro          VARCHAR(50) NOT NULL,
    noi_dung         TEXT NOT NULL,
    ngay_gui         TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CAC BUOC XU LY
CREATE TABLE IF NOT EXISTS cac_buoc_xu_ly (
    ma_buoc          VARCHAR(64) PRIMARY KEY,
    ma_tin_nhan      VARCHAR(64) REFERENCES tin_nhan(ma_tin_nhan) ON DELETE CASCADE,
    ma_ky_nang       VARCHAR(64),
    so_thu_tu_buoc   INT NOT NULL,
    suy_nghi_noi_bo  TEXT,
    ten_cong_cu      VARCHAR(100),
    tham_so_truyen_vao JSONB,
    ket_qua_cong_cu  TEXT,
    thoi_gian_chay_ms INT,
    ngay_tao         TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TAI LIEU DAU RA
CREATE TABLE IF NOT EXISTS tai_lieu_dau_ra (
    ma_tai_lieu      VARCHAR(64) PRIMARY KEY,
    ma_hoi_thoai     VARCHAR(64) REFERENCES cuoc_hoi_thoai(ma_hoi_thoai) ON DELETE CASCADE,
    ten_file         VARCHAR(255) NOT NULL,
    duong_dan_file   TEXT NOT NULL,
    tom_tat_noi_dung TEXT,
    phien_ban        INT DEFAULT 1,
    ngay_tao         TIMESTAMPTZ DEFAULT NOW(),
    ngay_cap_nhat    TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TIEN TRINH CHAY NGAM
CREATE TABLE IF NOT EXISTS tien_trinh_chay_ngam (
    ma_tien_trinh    VARCHAR(64) PRIMARY KEY,
    ma_hoi_thoai     VARCHAR(64) REFERENCES cuoc_hoi_thoai(ma_hoi_thoai) ON DELETE CASCADE,
    cau_lenh         TEXT NOT NULL,
    trang_thai       VARCHAR(50) DEFAULT 'dang_chay',
    id_tien_trinh_os INT,
    duong_dan_log    TEXT,
    ngay_bat_dau     TIMESTAMPTZ DEFAULT NOW(),
    ngay_ket_thuc    TIMESTAMPTZ
);

-- 8. KHOA API
CREATE TABLE IF NOT EXISTS khoa_api (
    ma_khoa          VARCHAR(64) PRIMARY KEY,
    ma_nguoi_dung    VARCHAR(64) REFERENCES nguoi_dung(ma_nguoi_dung),
    ten_nha_cung_cap VARCHAR(100) NOT NULL,
    gia_tri_khoa     TEXT NOT NULL,
    ngay_tao         TIMESTAMPTZ DEFAULT NOW()
);

-- 9. DANH GIA CAU TRA LOI
CREATE TABLE IF NOT EXISTS danh_gia_cau_tra_loi (
    ma_danh_gia      VARCHAR(64) PRIMARY KEY,
    ma_tin_nhan      VARCHAR(64) UNIQUE REFERENCES tin_nhan(ma_tin_nhan) ON DELETE CASCADE,
    loai_danh_gia    VARCHAR(20) NOT NULL,
    chi_tiet_gop_y   TEXT,
    ngay_tao         TIMESTAMPTZ DEFAULT NOW()
);

-- 10. LUOT SU DUNG TOKEN
CREATE TABLE IF NOT EXISTS luot_su_dung_token (
    ma_thong_ke      VARCHAR(64) PRIMARY KEY,
    ma_hoi_thoai     VARCHAR(64) REFERENCES cuoc_hoi_thoai(ma_hoi_thoai) ON DELETE CASCADE,
    so_token_gui     INT DEFAULT 0,
    so_token_nhan    INT DEFAULT 0,
    chi_phi_uoc_tinh DECIMAL(10,6) DEFAULT 0,
    ngay_ghi_nhan    TIMESTAMPTZ DEFAULT NOW()
);

-- 11. LUU TRU FILE CODE
CREATE TABLE IF NOT EXISTS luu_tru_file_code (
    ma_file          VARCHAR(64) PRIMARY KEY,
    ma_thu_muc       VARCHAR(64) REFERENCES thu_muc_du_an(ma_thu_muc) ON DELETE CASCADE,
    ten_file         VARCHAR(255) NOT NULL,
    duong_dan_tuong_doi TEXT NOT NULL,
    ma_hash_noi_dung VARCHAR(64),
    kich_thuoc_byte  INT,
    ngay_cap_nhat    TIMESTAMPTZ DEFAULT NOW()
);

-- 12. KY NANG
CREATE TABLE IF NOT EXISTS ky_nang (
    ma_ky_nang       VARCHAR(64) PRIMARY KEY,
    ten_ky_nang      VARCHAR(100) NOT NULL UNIQUE,
    tieu_de          VARCHAR(150) NOT NULL,
    mo_ta            TEXT,
    duong_dan_tep_tin TEXT,
    trang_thai       VARCHAR(50) DEFAULT 'kich_hoat',
    ngay_tao         TIMESTAMPTZ DEFAULT NOW()
);

-- 13. HOI THOAI KY NANG
CREATE TABLE IF NOT EXISTS hoi_thoai_ky_nang (
    ma_hoi_thoai     VARCHAR(64) REFERENCES cuoc_hoi_thoai(ma_hoi_thoai) ON DELETE CASCADE,
    ma_ky_nang       VARCHAR(64) REFERENCES ky_nang(ma_ky_nang) ON DELETE CASCADE,
    PRIMARY KEY (ma_hoi_thoai, ma_ky_nang)
);

-- 14. BO NHO DAI HAN
CREATE TABLE IF NOT EXISTS bo_nho_dai_han (
    ma_bo_nho        VARCHAR(64) PRIMARY KEY,
    ma_nguoi_dung    VARCHAR(64) REFERENCES nguoi_dung(ma_nguoi_dung),
    loai             VARCHAR(50) DEFAULT 'thong_tin_user',
    noi_dung         TEXT NOT NULL,
    ngay_tao         TIMESTAMPTZ DEFAULT NOW()
);

-- 15. TIN NHAN GHIM
CREATE TABLE IF NOT EXISTS tin_nhan_ghim (
    ma_tin_nhan      VARCHAR(64) REFERENCES tin_nhan(ma_tin_nhan) ON DELETE CASCADE,
    ma_hoi_thoai     VARCHAR(64) REFERENCES cuoc_hoi_thoai(ma_hoi_thoai) ON DELETE CASCADE,
    ngay_ghim        TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (ma_tin_nhan, ma_hoi_thoai)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cuoc_hoi_thoai_nguoi_dung ON cuoc_hoi_thoai(ma_nguoi_dung);
CREATE INDEX IF NOT EXISTS idx_tin_nhan_hoi_thoai ON tin_nhan(ma_hoi_thoai);
CREATE INDEX IF NOT EXISTS idx_tin_nhan_ngay_gui ON tin_nhan(ngay_gui);
CREATE INDEX IF NOT EXISTS idx_khoa_api_nguoi_dung ON khoa_api(ma_nguoi_dung);

-- Seed admin user
INSERT INTO nguoi_dung (ma_nguoi_dung, email, mat_khau_ma_hoa, ten_day_du, phan_quyen)
SELECT 'u1111111-1111-1111-1111-111111111111', 'admin@rexi.ai', '$2a$10$dummy', 'Admin Rexi', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM nguoi_dung WHERE ma_nguoi_dung = 'u1111111-1111-1111-1111-111111111111');
