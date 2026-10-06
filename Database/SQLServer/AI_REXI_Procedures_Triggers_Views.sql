USE AI_REXI;
GO

-- ============================================================
-- 1. TRIGGERS (Tự động cập nhật ngay_cap_nhat khi UPDATE)
-- ============================================================

-- Trigger cập nhật ngày cho nguoi_dung
IF OBJECT_ID('trg_UpdateNguoiDung_NgayCapNhat', 'TR') IS NOT NULL
    DROP TRIGGER trg_UpdateNguoiDung_NgayCapNhat;
GO

CREATE TRIGGER trg_UpdateNguoiDung_NgayCapNhat
ON nguoi_dung
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE nguoi_dung
    SET ngay_cap_nhat = SYSDATETIME()
    FROM nguoi_dung u
    INNER JOIN inserted i ON u.ma_nguoi_dung = i.ma_nguoi_dung;
END;
GO

-- Trigger cập nhật ngày cho cuoc_hoi_thoai
IF OBJECT_ID('trg_UpdateCuocHoiThoai_NgayCapNhat', 'TR') IS NOT NULL
    DROP TRIGGER trg_UpdateCuocHoiThoai_NgayCapNhat;
GO

CREATE TRIGGER trg_UpdateCuocHoiThoai_NgayCapNhat
ON cuoc_hoi_thoai
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE cuoc_hoi_thoai
    SET ngay_cap_nhat = SYSDATETIME()
    FROM cuoc_hoi_thoai h
    INNER JOIN inserted i ON h.ma_hoi_thoai = i.ma_hoi_thoai;
END;
GO

-- Trigger tự động tạo record token khi tạo cuộc hội thoại mới
IF OBJECT_ID('trg_AutoCreateTokenUsage', 'TR') IS NOT NULL
    DROP TRIGGER trg_AutoCreateTokenUsage;
GO

CREATE TRIGGER trg_AutoCreateTokenUsage
ON cuoc_hoi_thoai
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO luot_su_dung_token (ma_thong_ke, ma_hoi_thoai, so_token_gui, so_token_nhan, chi_phi_uoc_tinh)
    SELECT 
        NEWID(),
        i.ma_hoi_thoai,
        0,
        0,
        0.0
    FROM inserted i;
END;
GO


-- ============================================================
-- 2. VIEWS (Báo cáo & Thống kê tổng hợp)
-- ============================================================

-- View thống kê chi tiết cuộc hội thoại & tổng số tin nhắn
IF OBJECT_ID('vw_ThongKeHoiThoai', 'V') IS NOT NULL
    DROP VIEW vw_ThongKeHoiThoai;
GO

CREATE VIEW vw_ThongKeHoiThoai AS
SELECT 
    h.ma_hoi_thoai,
    h.tieu_de,
    h.ten_mo_hinh_ai,
    h.trang_thai,
    u.ten_day_du AS ten_nguoi_dung,
    u.email,
    COUNT(t.ma_tin_nhan) AS tong_so_tin_nhan,
    ISNULL(SUM(k.so_token_gui + k.so_token_nhan), 0) AS tong_token_su_dung,
    ISNULL(SUM(k.chi_phi_uoc_tinh), 0) AS tong_chi_phi,
    h.ngay_tao,
    h.ngay_cap_nhat
FROM cuoc_hoi_thoai h
INNER JOIN nguoi_dung u ON h.ma_nguoi_dung = u.ma_nguoi_dung
LEFT JOIN tin_nhan t ON h.ma_hoi_thoai = t.ma_hoi_thoai
LEFT JOIN luot_su_dung_token k ON h.ma_hoi_thoai = k.ma_hoi_thoai
WHERE h.ngay_xoa IS NULL
GROUP BY 
    h.ma_hoi_thoai, h.tieu_de, h.ten_mo_hinh_ai, h.trang_thai,
    u.ten_day_du, u.email, h.ngay_tao, h.ngay_cap_nhat;
GO

-- View danh sách tin nhắn chi tiết kèm thông tin kỹ năng xử lý
IF OBJECT_ID('vw_ChiTietTinNhanVaCongCu', 'V') IS NOT NULL
    DROP VIEW vw_ChiTietTinNhanVaCongCu;
GO

CREATE VIEW vw_ChiTietTinNhanVaCongCu AS
SELECT 
    t.ma_tin_nhan,
    t.ma_hoi_thoai,
    t.vai_tro,
    t.noi_dung,
    t.ngay_gui,
    b.so_thu_tu_buoc,
    b.suy_nghi_noi_bo,
    b.ten_cong_cu,
    b.thoi_gian_chay_ms
FROM tin_nhan t
LEFT JOIN cac_buoc_xu_ly b ON t.ma_tin_nhan = b.ma_tin_nhan;
GO


-- ============================================================
-- 3. STORED PROCEDURES (Nghiệp vụ hệ thống)
-- ============================================================

-- Stored Procedure: Tạo cuộc hội thoại mới
IF OBJECT_ID('sp_TaoCuocHoiThoaiMoi', 'P') IS NOT NULL
    DROP PROCEDURE sp_TaoCuocHoiThoaiMoi;
GO

CREATE PROCEDURE sp_TaoCuocHoiThoaiMoi
    @ma_nguoi_dung NVARCHAR(64),
    @ma_thu_muc NVARCHAR(64) = NULL,
    @tieu_de NVARCHAR(500) = N'Trò chuyện mới',
    @ten_mo_hinh_ai NVARCHAR(100) = 'gemini-2.5-flash',
    @ma_hoi_thoai_moi NVARCHAR(64) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @ma_hoi_thoai_moi = NEWID();

    INSERT INTO cuoc_hoi_thoai (ma_hoi_thoai, ma_nguoi_dung, ma_thu_muc, tieu_de, ten_mo_hinh_ai, trang_thai)
    VALUES (@ma_hoi_thoai_moi, @ma_nguoi_dung, @ma_thu_muc, @tieu_de, @ten_mo_hinh_ai, 'dang_mo');
END;
GO

-- Stored Procedure: Gửi tin nhắn và lưu vết token
IF OBJECT_ID('sp_GuiTinNhanVaCapNhatToken', 'P') IS NOT NULL
    DROP PROCEDURE sp_GuiTinNhanVaCapNhatToken;
GO

CREATE PROCEDURE sp_GuiTinNhanVaCapNhatToken
    @ma_hoi_thoai NVARCHAR(64),
    @vai_tro NVARCHAR(20),
    @noi_dung NVARCHAR(MAX),
    @so_token_gui INT = 0,
    @so_token_nhan INT = 0,
    @chi_phi FLOAT = 0.0,
    @ma_tin_nhan_moi NVARCHAR(64) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @ma_tin_nhan_moi = NEWID();

    -- 1. Lưu tin nhắn
    INSERT INTO tin_nhan (ma_tin_nhan, ma_hoi_thoai, vai_tro, noi_dung)
    VALUES (@ma_tin_nhan_moi, @ma_hoi_thoai, @vai_tro, @noi_dung);

    -- 2. Cập nhật lượt sử dụng token
    UPDATE luot_su_dung_token
    SET 
        so_token_gui = so_token_gui + @so_token_gui,
        so_token_nhan = so_token_nhan + @so_token_nhan,
        chi_phi_uoc_tinh = chi_phi_uoc_tinh + @chi_phi,
        ngay_ghi_nhan = SYSDATETIME()
    WHERE ma_hoi_thoai = @ma_hoi_thoai;

    -- 3. Trigger tự cập nhật ngay_cap_nhat cho cuộc hội thoại
    UPDATE cuoc_hoi_thoai 
    SET ngay_cap_nhat = SYSDATETIME()
    WHERE ma_hoi_thoai = @ma_hoi_thoai;
END;
GO

PRINT 'Triggers, Views & Stored Procedures for Rexi AI — Done!';
GO
