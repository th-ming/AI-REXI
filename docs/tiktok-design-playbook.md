# TikTok Design-Style Playbook — học từ 4 kênh

Ngày: 2026-09-15. Nguồn: cover + keyframes + caption + playCount THẬT lấy qua TikTok
server-render embed (`/embed/@user` → playAddr/coverUrl/desc/playCount) + `r.jina.ai` cho
video page. Sample: **code_candy 12 video** (đủ 8 mp4 tải về + cắt frame), **chon.artist
13**, **nghiamecongnghe 10**. **designgrids: age-gate (audience controls) → anonymous bị
CAPTCHA/400, KHÔNG xem được** (chi tiết ở cuối).

---

## 1. code_candy — "sweet in-browser code" (29.8K follower / 277K like)

**Thể loại:** front-end CSS/JS micro-interaction demo. Có site `codecandyland.com` (React
SPA, theme tối `#1B0B24`, font Baloo+Jakarta+JetBrains Mono, bán "free drops / premium
bundles"). 100% caption là tiếng Anh + hashtag `#coding #programming #css #html #javascript`.

**TEMPLATE COVER (nhất quán 100%), khung dọc 9:16 chia 2 tầng:**
- Trên ~55%: **mockup UI thật** chạy hiệu ứng, trên nền đen/tối. Góc TRÊN-TRÁI có **tiêu đề
  in hoa màu trắng + glow nhẹ**: `BUTTON HOVER EFFECTS PT.4`, `LOGIN / SIGNUP ANIMATION #2`,
  `EXPANDING RADIAL MENU`, `ANIMATED ADD CART BUTTON`, `PASSWORD STRENGTH`, `NAVIGATION BAR #2`,
  `PROFESSIONAL PORTFOLIO #1`, `EXPANDING SIDEBAR`, `SOCIAL MEDIA POP UP`, `ORDER BUTTON`,
  `Expanding Nav Panels`, `Interactive Campfire Animation`.
- Dưới ~40-45%: **cửa sổ code editor giả VS Code** — 3 chấm đỏ/vàng/xanh góc trái, tab tên
  file (`navigation.css`, `sidebar.css`, `addtocart.css`…), **đánh số dòng 1→n**, cú pháp tô
  màu (keyword hồng, số/hàm xanh lá, comment xám). Code THẬT, copy chạy được.
- Accent color duy nhất: **lime/neon xanh** cho nhãn active (`Home`). Còn lại dark-on-dark.

**ĐỘNG (từ keyframes 8 video):** mỗi video = 1 hiệu ứng loop. Cấu trúc 0→3s: trạng thái idle
→ hover/click → biến dạng (transform/scale/clip-path/mask radial-gradient) → về idle. Timing
`cubic-bezier(.22,1,.36,1)` ~550-700ms. KHÔNG có voice, KHÔNG có mặt người — chỉ màn hình +
cursor. Đọc caption = CTA mồi: "Free full code link in bio 🫡", "Link in bio", câu hỏi tương
tác "Thoughts on this nav bar? Better than the last one or nah?".

**View distribution:** 1.1M ("Which?") → 431K → 228K → đường dài 11-50K. Video ngắn (≤60s),
hook = hiệu ứng chạy NGAY frame 1, không intro.

---

## 2. chon.artist — graphic design tiếng Việt (24.9K follower / 209K like)

**Thể loại:** designer VN, chia sẻ **kinh nghiệm/thủ pháp thiết kế đồ họa**. Caption tiếng
Việt, hashtag `#thietkedohoa #graphicdesign #design #designer #chonartist #typography`.

**TEMPLATE COVER (thống nhất brand):** mọi ô đều có **header "Chon / @chon.artist / Follow me"
+ icon MXH** ở trên, **mũi tên "→" góc trái-dưới + "2026" góc phải-dưới**. Nội dung giữa:
- **Dòng "Do & Don't" nối series:** `Một số phương pháp thiết kế hay ho… P1`, `Những lưu ý để
  thiết kế tốt hơn P1/P2`, `Các mẹo vặt khi thiết kế P4-P7` — mỗi cái kèm **cặp ảnh so sánh ✗
  đỏ / ✓ xanh** chỉ lỗi bố cục (gradient sai hướng, card lệch, chữ quá nhỏ, lưới lệch hàng,
  biểu đồ đáy sai…). Đây là **ngôn ngữ thị giác chủ lực: Sai-vs-Đúng trực quan.**
- Chủ đề phụ: redesign icon iOS theo gu (`(26)`), poster **Quốc khánh 2/9** (đỏ + sao vàng +
  bồ câu), hợp tác **Chùa Thiên Quang / Đền Hùng** (dự án bản sắc dân tộc, credit Designer:
  Chon / Director), tutorial **font** (`Chương 1: Serif Font A B C`, `Cách lựa chọn font chữ
  hợp lý` + minh họa thang cỡ `aaaaa aaa aa a`), tranh **vẽ tay ẩm thực Việt** (phở, bánh mì).

**View:** 742K → 187K → 123K → đuôi 4-70K. Video = carousel ảnh / quy trình sketch→final
("Quá trình từ Sketch đến Final").

---

## 3. nghiamecongnghe — UX "cheat sheet" carousel (mới tinh, 256 follower / 4.6K like)

**Thể loại:** UX/UI tips tiếng Việt, dạng **carousel nhiều slide** ("Vuốt sang trái…"). Đây
chính là format GẦN REXI nhất (UX + app + tiếng Việt).

**TEMPLATE CARD (rigid system), nền SÁNG (trắng→xám rất nhạt loang pastel), 9:16:**
- Đầu card: **2 badge pill**: `🔥 NÓNG HỔI CỘNG ĐỒNG` + category `UI CHEAT SHEET` /
  `DO & DON'T UX`.
- **Tiêu đề in đậm, 1 CỤM TỪ tô màu accent** (cyan/cam/vàng/xanh lá theo bài): e.g.
  "6 Kiểu **Floating Action Button (FAB)** Biến Hóa Sáng Tạo", "Thiết Kế Bảng Giá **Pricing
  Table** Tăng Chuyển Đổi", "Quy Tắc Cỡ Chữ Tối Thiểu **16px**…".
- **Mockup iPhone màn hình ĐEN ở giữa**, quanh nó các **pill-label tối + emoji icon** ghi
  tip: `⚠ Nút Xóa Phải Màu Đỏ`, `3 Giây / Hoàn Tất 1 Chạm`, `🔒 Bảo Mật 256-Bit SSL`,
  `+35% / Tương Tác Tăng`, `5 Giây / Tự Biến Mất`.
- **Footer thanh tối bo góc**: CTA vuốt ("↻ Vuốt sang trái để khám phá trọn bộ 6 mẫu…") +
  **@handle tô màu accent**.
- Pattern nội dung: **con số "6 Kiểu / 6 Module / 6 Màn Hình"** (listicle), **số liệu tâm lý
  học** ("80% khách chọn gói năm", "+35% tương tác"). Chủ đề: FAB, Dynamic Island, pricing,
  empty state, toast/snackbar, bottom sheet vs modal, 16px input, fintech card, checkout.

**View:** mọi bài dẹt 0-2K — kênh chưa bùng (mới + follower thấp) dù template đã rất chuẩn.

---

## 4. designgrids — KHÔNG xem được (age-gate)

Bật **"audience controls"/giới hạn tuổi** → server TikTok chặn mọi route ẩn danh:
- `/embed/@designgrids` → HTTP 400 / shell rỗng (0 desc/play/cover).
- `r.jina.ai` → trả trang **"This page maybe requiring CAPTCHA"**.
- Google/Bing/Startpage/Mojeek qua captcha hoặc 0 kết quả TikTok.
- urlebird/countik/exolyt → login-wall / dead.

**Muốn học kênh này cần 1 trong 2:** (a) user mở trong app/logged-in rồi **chụp 2-3 screenshot
lưới video** (tôi transcription ảnh được ngay), hoặc (b) đưa **link 1 video** cụ thể của nó.
Không có 1 trong 2 thì coi như bất khả thi anonymous — đây là giới hạn nền tảng, không phải
lười.

---

## 5. CÔNG THỨC CHUNG (điểm hội tụ của 3 kênh đã xem)

1. **Cover là hệ thống, không phải ảnh ngẫu nhiên.** Mỗi kênh có 1 khung cố định (brand
   header/màu/chỗ đặt tiêu đề) → nhận diện tức thì trên grid 9 ô.
2. **Hook = kết quả thị giác, không phải lời nói.** Frame 1 đã là sản phẩm chạy thật
   (code_candy), hoặc đã là ✗/✓ đập vào mắt (chon), hoặc đã là mockup + tip pill (nghiame).
3. **Listicle + con số**: "PT.4", "#1/#2", "P1…P7", "6 Kiểu…". Tạo series + lý do follow.
4. **Value framing**: cheat sheet / do-don't / before-after / "link full code in bio". Người
   xem thấy "vài phút nữa mình làm được cái này".
5. **Accent discipline**: dark theme + ĐÚNG 1 màu neon (code_candy lime, nghiame cyan/cam),
   HOẶC light theme + 1 chữ tô màu trong tiêu đề (nghiame, chon). Không bao giờ rainbow.
6. **CTA cuối** nhất quán: follow / swipe / link-in-bio, màu accent.
7. **Không mặt người, không voice** (code_candy, nghiame) → dễ scale, làm bằng screen-record
   + carousel; chon có voice-over/tutorial nhưng vẫn không lộ mặt.

## 6. GỢI Ý ÁP DỤNG CHO @thienhodev / REXI (đang 150 follower, video ế)

Đường dẫn @thienhodev hiện tại: quay màn hình chat REXI trần ("Tạo con bot trên REXI") — hook
yếu, không có hệ thống cover. Công thức ghép đáng thử:
- **Lấy khung card của nghiamecongnghe** (badge + tiêu đề đậm 1 từ accent + mockup giữa + pill
  tips emoji + footer CTA) → làm **cover series** "REXI Cheat Sheet" cho từng tính năng, nhưng
  nền **TỐI neon style code_candy** cho hợp brand AI.
- **Nội dung = hiệu ứng THẬT của REXI chạy ngay frame 1** (prompt→trả lời, tạo bot, IPTV quét
  kênh…), kiểu code_candy "link in bio".
- **Dòng Do & Don't kiểu chon**: "AI trả lời SAI vì prompt của bạn ✗ / fix ✓" — cực hợp để
  market 1 trợ lý AI, tạo series P1 P2.
- Con số + kết quả: "6 cách dùng REXI thay 1 thư ký", "+50% nhanh hơn gõ tay".

## 15/9 Tá»I â€” FORENSIC RULES from REAL covers (vision dissected 6 nghiame + 6 chon + 6 code_candy originals)
### NGHIAME (n01-n06) â€” carousel giÃ¡o dá»¥c UX, template 6-vÃ¹ng Cá» Äá»ŠNH:
1. Ná»n KEM #f2f0eb phá»§ lÆ°á»›i cháº¥m má» (dot ~1.3px, bÆ°á»›c 30px). KHÃ”NG glass, KHÃ”NG mesh gradient.
2. Header: pill ÄEN bo trÃ²n "â— TÃŠN KÃŠNH" (cháº¥m = accent mÃ u) + pill TRáº®NG viá»n má»ng tag thá»ƒ loáº¡i ("âœ¦ UI CHEAT SHEET" / "â—‰ DO & DON'T UX") â€” tag Ä‘á»•i theo series.
3. Title sans Ä‘áº­m 2 dÃ²ng, ~66px; KEYWORD highlight báº±ng KHá»I Ná»€N MÃ€U (cyan nháº¡t) kiá»ƒu marker, KHÃ”NG underline cong, KHÃ”NG text mÃ u.
4. Sub 1-2 dÃ²ng xÃ¡m nhá». Phone mÃ n Tá»I Ä‘áº·t giá»¯a, sau lÆ°ng cÃ³ quáº§ng radial mÃ u accent.
5. Ä‘Ãºng 3 annotation pills bay quanh phone: icon ná»n mÃ u (bo gÃ³c) + cá»¥m tá»« Title Case, format " Keyword / giáº£i thÃ­ch" â€” má»—i pill 1 Ã½ duy nháº¥t.
6. Footer: thanh ÄEN full-width "âŠ• Vuá»‘t sang trÃ¡i Ä‘á»ƒ â€¦ â†’" + @handle mÃ u accent.
7. MÃƒ MÃ€U NGá»® NGHÄ¨A: Ä‘á» = danger, cyan = info, xanh lÃ¡ = benefit, cam = rule. Äá»•i accent = ra series má»›i.
8. Tá»· lá»‡ chá»¯: title 28-32/493 â‰ˆ 61-70 @1080; sub ~12â†’26; pill ~10-11â†’22-24. Khoáº£ng thá»Ÿ lá»›n quanh mockup.
### CHON (ch01-ch06):
1. Ná»€N TRáº®NG/off-white Sáº CH (mÃ¬nh tá»«ng lÃ m ná»n tá»‘i kÃ­nh = SAI). KhÃ´ng border náº·ng.
2. Header: avatar nhá» + "ChÃ²n / @chon.artist" TRÃI; pháº£i "Follow me" button + 1 hÃ ng icon SNS (facebook/tiktok/instagram).
3. Giá»¯a trang: PILL mÃ u pastel nháº¡t chá»©a chá»§ Ä‘á»; dÆ°á»›i "P 1".
4. Ná»™i dung = SO SÃNH THá»Š GIÃC âœ—/âœ“: 2 cá»™t, má»—i cá»™t CÃ“ MOCKUP GROSS (alignment/spacing/contrastâ€¦) + vÃ²ng trÃ²n Äá»Ž âœ— / XANH âœ“ to náº±m trÃªn gÃ³c. KHÃ”NG dÃ¹ng bullet text giáº£i thÃ­ch.
5. Footer: Ã´ vuÃ´ng bo gÃ³c chá»©a â†’ trÃ¡i, "2026" pháº£i. Repetition tuyá»‡t Ä‘á»‘i giá»¯a cÃ¡c slide.
6. Gradient thanh mÃ u tÆ°Æ¡i (xanh dÆ°Æ¡ng/tÃ­m/há»“ng/cam/lÃ¡) trÃªn khá»‘i minh há»a; ná»n trung tÃ­nh Ä‘áº©y chá»§ thá»ƒ.
### CODE_CANDY (cc01-06):
1. Title: sans CONDENSED (kiá»ƒu Impact) ÄEN TRáº®NG viáº¿t hoa + GLOW text-shadow, Ä‘áº·t trÃªn ná»n DEMO (khÃ´ng bar riÃªng).
2. Má»—i video = demo 3 lá»›p: (a) preview UI THáº¬T cháº¡y animation (split half tráº¯ng/Ä‘en cho tháº¥y cáº£ 2 theme), (b) con trá» chuá»™t click, (c) EDITOR GIáº¢ mini: header 3 cháº¥m mac + tÃªn file X.css + ÄÃšNG code CSS sinh ra demo Ä‘Ã³, comment tiáº¿ng Anh giáº£i thÃ­ch. KHÃ”NG pháº£i VS Code Ä‘áº§y Ä‘á»§ activity bar â€” chÃ­nh lÃ  window tá»‘i giáº£n ná»•i lá»nh trÃªn ná»n demo.
3. Code ngáº¯n ~15-22 dÃ²ng, cubic-bezier tháº­t, comments /* nhÆ° nÃ y */.
4. ToÃ n bá»™ Anh ngá»¯. Handle chá»‰ á»Ÿ cuá»‘i.
