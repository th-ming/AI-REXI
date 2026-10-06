-- ============================================================
-- Rexi AI — SQL Server Database Schema
-- ============================================================

USE master;
GO

IF DB_ID('AI_REXI') IS NULL
    CREATE DATABASE AI_REXI;
GO

USE AI_REXI;
GO

-- ===================== 1. NGUOI DUNG =====================
CREATE TABLE nguoi_dung (
    ma_nguoi_dung   NVARCHAR(64)    PRIMARY KEY,
    email           NVARCHAR(255)   NOT NULL UNIQUE,
    mat_khau_ma_hoa NVARCHAR(255)   NOT NULL,
    ten_day_du      NVARCHAR(255),
    anh_dai_dien    NVARCHAR(500),
    cai_dat_ca_nhan NVARCHAR(MAX),
    ngay_tao        DATETIME2       DEFAULT SYSDATETIME(),
    ngay_cap_nhat   DATETIME2       DEFAULT SYSDATETIME(),
    phan_quyen      NVARCHAR(20)    DEFAULT 'user',
    trang_thai      NVARCHAR(20)    DEFAULT 'active',  -- Đã thêm: dùng cho Khoá/Mở khoá tài khoản
    otp_code        NVARCHAR(10),
    otp_expiry      BIGINT
);
GO

-- ===================== 2. THU MUC DU AN =====================
CREATE TABLE thu_muc_du_an (
    ma_thu_muc      NVARCHAR(64)    PRIMARY KEY,
    ma_nguoi_dung   NVARCHAR(64)    NOT NULL,
    ten_thu_muc     NVARCHAR(255)   NOT NULL,
    duong_dan_may_tinh NVARCHAR(500) NOT NULL,
    link_git        NVARCHAR(500),
    ngay_tao        DATETIME2       DEFAULT SYSDATETIME(),
    CONSTRAINT fk_du_an_user FOREIGN KEY (ma_nguoi_dung) REFERENCES nguoi_dung(ma_nguoi_dung)
);
GO

-- ===================== 3. CUOC HOI THOAI =====================
CREATE TABLE cuoc_hoi_thoai (
    ma_hoi_thoai    NVARCHAR(64)    PRIMARY KEY,
    ma_nguoi_dung   NVARCHAR(64)    NOT NULL,
    ma_thu_muc      NVARCHAR(64),
    tieu_de         NVARCHAR(500)   DEFAULT N'Tro chuyen moi',
    ten_mo_hinh_ai  NVARCHAR(100)   NOT NULL,
    trang_thai      NVARCHAR(20)    DEFAULT 'dang_mo',
    ngay_tao        DATETIME2       DEFAULT SYSDATETIME(),
    ngay_cap_nhat   DATETIME2       DEFAULT SYSDATETIME(),
    ngay_xoa        DATETIME2       NULL,
    CONSTRAINT fk_hoi_thoai_user FOREIGN KEY (ma_nguoi_dung) REFERENCES nguoi_dung(ma_nguoi_dung),
    CONSTRAINT fk_hoi_thoai_thu_muc FOREIGN KEY (ma_thu_muc) REFERENCES thu_muc_du_an(ma_thu_muc)
);
GO

CREATE INDEX idx_ht_nguoi_dung ON cuoc_hoi_thoai(ma_nguoi_dung);
CREATE INDEX idx_ht_ngay_xoa ON cuoc_hoi_thoai(ngay_xoa);
GO

-- ===================== 4. TIN NHAN =====================
CREATE TABLE tin_nhan (
    ma_tin_nhan     NVARCHAR(64)    PRIMARY KEY,
    ma_hoi_thoai    NVARCHAR(64)    NOT NULL,
    vai_tro         NVARCHAR(20)    NOT NULL,
    noi_dung        NVARCHAR(MAX)   NOT NULL,
    ngay_gui        DATETIME2       DEFAULT SYSDATETIME(),
    CONSTRAINT fk_tin_nhan_ht FOREIGN KEY (ma_hoi_thoai) REFERENCES cuoc_hoi_thoai(ma_hoi_thoai)
);
GO

CREATE INDEX idx_tn_ht ON tin_nhan(ma_hoi_thoai);
GO

-- ===================== 5. TIN NHAN GHIM =====================
CREATE TABLE tin_nhan_ghim (
    ma_tin_nhan     NVARCHAR(64)    PRIMARY KEY,
    ghi_chu         NVARCHAR(MAX),
    ngay_ghim       DATETIME2       DEFAULT SYSDATETIME(),
    CONSTRAINT fk_tn_ghim FOREIGN KEY (ma_tin_nhan) REFERENCES tin_nhan(ma_tin_nhan)
);
GO

-- ===================== 6. KY NANG =====================
CREATE TABLE ky_nang (
    ma_ky_nang      NVARCHAR(64)    PRIMARY KEY,
    ten_ky_nang     NVARCHAR(255)   NOT NULL,
    tieu_de         NVARCHAR(255)   NOT NULL,
    mo_ta           NVARCHAR(MAX),
    duong_dan_tep_tin NVARCHAR(500),
    trang_thai      NVARCHAR(20)    DEFAULT 'kich_hoat',
    ngay_tao        DATETIME2       DEFAULT SYSDATETIME()
);
GO

-- ===================== 7. HOI THOAI KY NANG (M-to-M) =====================
CREATE TABLE hoi_thoai_ky_nang (
    ma_hoi_thoai    NVARCHAR(64)    NOT NULL,
    ma_ky_nang      NVARCHAR(64)    NOT NULL,
    PRIMARY KEY (ma_hoi_thoai, ma_ky_nang),
    CONSTRAINT fk_htk_ht FOREIGN KEY (ma_hoi_thoai) REFERENCES cuoc_hoi_thoai(ma_hoi_thoai),
    CONSTRAINT fk_htk_kn FOREIGN KEY (ma_ky_nang) REFERENCES ky_nang(ma_ky_nang)
);
GO

-- ===================== 8. CAC BUOC XU LY =====================
CREATE TABLE cac_buoc_xu_ly (
    ma_buoc         NVARCHAR(64)    PRIMARY KEY,
    ma_tin_nhan     NVARCHAR(64)    NOT NULL,
    ma_ky_nang      NVARCHAR(64),
    so_thu_tu_buoc  INT             NOT NULL,
    suy_nghi_noi_bo NVARCHAR(MAX),
    ten_cong_cu     NVARCHAR(255),
    tham_so_truyen_vao NVARCHAR(MAX),
    ket_qua_cong_cu NVARCHAR(MAX),
    thoi_gian_chay_ms INT,
    ngay_tao        DATETIME2       DEFAULT SYSDATETIME(),
    CONSTRAINT fk_cbxl_tn FOREIGN KEY (ma_tin_nhan) REFERENCES tin_nhan(ma_tin_nhan),
    CONSTRAINT fk_cbxl_kn FOREIGN KEY (ma_ky_nang) REFERENCES ky_nang(ma_ky_nang)
);
GO

-- ===================== 9. KHOA API =====================
CREATE TABLE khoa_api (
    ma_khoa         NVARCHAR(64)    PRIMARY KEY,
    ma_nguoi_dung   NVARCHAR(64)    NOT NULL,
    ten_nha_cung_cap NVARCHAR(100)  NOT NULL,
    gia_tri_khoa    NVARCHAR(500)   NOT NULL,
    ngay_tao        DATETIME2       DEFAULT SYSDATETIME(),
    CONSTRAINT fk_ka_user FOREIGN KEY (ma_nguoi_dung) REFERENCES nguoi_dung(ma_nguoi_dung)
);
GO

-- ===================== 10. BO NHO DAI HAN =====================
CREATE TABLE bo_nho_dai_han (
    ma_bo_nho       NVARCHAR(64)    PRIMARY KEY,
    loai            NVARCHAR(50),
    noi_dung        NVARCHAR(MAX)   NOT NULL,
    do_uu_tien      INT             DEFAULT 5,
    ngay_tao        DATETIME2       DEFAULT SYSDATETIME()
);
GO

-- ===================== 11. LUOT SU DUNG TOKEN =====================
CREATE TABLE luot_su_dung_token (
    ma_thong_ke     NVARCHAR(64)    PRIMARY KEY,
    ma_hoi_thoai    NVARCHAR(64)    NOT NULL,
    so_token_gui    INT             DEFAULT 0,
    so_token_nhan   INT             DEFAULT 0,
    chi_phi_uoc_tinh FLOAT          DEFAULT 0.0,
    ngay_ghi_nhan   DATETIME2       DEFAULT SYSDATETIME(),
    CONSTRAINT fk_lsdt_ht FOREIGN KEY (ma_hoi_thoai) REFERENCES cuoc_hoi_thoai(ma_hoi_thoai)
);
GO

-- ===================== 12. DANH GIA CAU TRA LOI =====================
CREATE TABLE danh_gia_cau_tra_loi (
    ma_danh_gia     NVARCHAR(64)    PRIMARY KEY,
    ma_tin_nhan     NVARCHAR(64)    NOT NULL,
    loai_danh_gia   NVARCHAR(20)    NOT NULL,
    chi_tiet_gop_y  NVARCHAR(MAX),
    ngay_tao        DATETIME2       DEFAULT SYSDATETIME(),
    CONSTRAINT fk_dg_tn FOREIGN KEY (ma_tin_nhan) REFERENCES tin_nhan(ma_tin_nhan)
);
GO

-- ===================== 13. TAGS HOI THOAI =====================
CREATE TABLE tags_hoi_thoai (
    ma_hoi_thoai    NVARCHAR(64)    NOT NULL,
    tag             NVARCHAR(100)   NOT NULL,
    PRIMARY KEY (ma_hoi_thoai, tag),
    CONSTRAINT fk_tht_ht FOREIGN KEY (ma_hoi_thoai) REFERENCES cuoc_hoi_thoai(ma_hoi_thoai)
);
GO

-- ===================== 14. LUU TRU FILE CODE =====================
CREATE TABLE luu_tru_file_code (
    ma_file         NVARCHAR(64)    PRIMARY KEY,
    ma_thu_muc      NVARCHAR(64)    NOT NULL,
    ten_file        NVARCHAR(255)   NOT NULL,
    duong_dan_tuong_doi NVARCHAR(500) NOT NULL,
    ma_hash_noi_dung NVARCHAR(255),
    kich_thuoc_byte INT,
    ngay_cap_nhat   DATETIME2       DEFAULT SYSDATETIME(),
    CONSTRAINT fk_ltfc_tm FOREIGN KEY (ma_thu_muc) REFERENCES thu_muc_du_an(ma_thu_muc)
);
GO

-- ===================== 15. TAI LIEU DAU RA =====================
CREATE TABLE tai_lieu_dau_ra (
    ma_tai_lieu     NVARCHAR(64)    PRIMARY KEY,
    ma_hoi_thoai    NVARCHAR(64)    NOT NULL,
    ten_file        NVARCHAR(255)   NOT NULL,
    duong_dan_file  NVARCHAR(500)   NOT NULL,
    tom_tat_noi_dung NVARCHAR(MAX),
    phien_ban       INT             DEFAULT 1,
    ngay_tao        DATETIME2       DEFAULT SYSDATETIME(),
    ngay_cap_nhat   DATETIME2       DEFAULT SYSDATETIME(),
    CONSTRAINT fk_tldr_ht FOREIGN KEY (ma_hoi_thoai) REFERENCES cuoc_hoi_thoai(ma_hoi_thoai)
);
GO

-- ===================== 16. THU MUC HOI THOAI =====================
CREATE TABLE thu_muc_hoi_thoai (
    ma_thu_muc      NVARCHAR(64)    PRIMARY KEY,
    ten             NVARCHAR(255)   NOT NULL,
    mau_sac         NVARCHAR(20)    DEFAULT '#6366f1',
    bieu_tuong      NVARCHAR(10)    DEFAULT N'📁'
);
GO

-- ===================== 17. TIEN TRINH CHAY NGAM =====================
CREATE TABLE tien_trinh_chay_ngam (
    ma_tien_trinh   NVARCHAR(64)    PRIMARY KEY,
    ma_hoi_thoai    NVARCHAR(64)    NOT NULL,
    cau_lenh        NVARCHAR(MAX)   NOT NULL,
    trang_thai      NVARCHAR(20)    DEFAULT 'dang_chay',
    id_tien_trinh_os INT,
    duong_dan_log   NVARCHAR(500),
    ngay_bat_dau    DATETIME2       DEFAULT SYSDATETIME(),
    ngay_ket_thuc   DATETIME2       NULL,
    CONSTRAINT fk_ttcn_ht FOREIGN KEY (ma_hoi_thoai) REFERENCES cuoc_hoi_thoai(ma_hoi_thoai)
);
GO

-- ===================== 18. CRON TASKS =====================
CREATE TABLE cron_tasks (
    ma_task         NVARCHAR(64)    PRIMARY KEY,
    ten             NVARCHAR(255)   NOT NULL,
    cron_expr       NVARCHAR(50)    NOT NULL,
    lenh            NVARCHAR(MAX)   NOT NULL,
    kich_hoat       INT             DEFAULT 1,
    lan_chay_cuoi   DATETIME2       NULL
);
GO

-- ===================== SEED ADMIN USER =====================
IF NOT EXISTS (SELECT 1 FROM nguoi_dung WHERE ma_nguoi_dung = 'u1111111-1111-1111-1111-111111111111')
BEGIN
    INSERT INTO nguoi_dung (ma_nguoi_dung, email, mat_khau_ma_hoa, ten_day_du, phan_quyen)
    VALUES ('u1111111-1111-1111-1111-111111111111', 'user@rexi.ai', 'hashed_pass', N'Nguoi Dung Thu Nghiem', 'admin');

    INSERT INTO thu_muc_du_an (ma_thu_muc, ma_nguoi_dung, ten_thu_muc, duong_dan_may_tinh)
    VALUES ('w2222222-2222-2222-2222-222222222222', 'u1111111-1111-1111-1111-111111111111', 'Rexi AI Project', 'D:\Rexi AI');
END
GO

PRINT 'Rexi AI Database Schema — Hoan tat!';
GO
