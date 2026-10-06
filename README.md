# REXI-AI

Dự Án Trợ Lý Rexi AI (Rexi AI Assistant).

---

## 📁 Cấu Trúc Thư Mục Dự Án

```text
D:\AI REXI\
├── .agents/                  # Skills & officecli configs
├── Backend/                  # Node.js/Express API
├── Database/                 # SQLite + thiết kế DB
├── Frontend/                 # React + Vite
└── README.md
```

---

## 🚀 Hướng Dẫn Nhanh

```powershell
# Backend
cd D:\AI REXI\Backend
npm install
node init_db.js
node server.js

# Frontend
cd D:\AI REXI\Frontend
npm install
npm run dev
```

---

## 🌐 Deploy Production (Render)

- Backend + Frontend build gộp 1 service: `https://ai-rexi-backend.onrender.com` (Render free — cold start 30–60s).
- DB: PostgreSQL (Supabase free, session pooler + ssl). Biến môi trường & cách xoay mật khẩu: xem [`docs/PROD-ENV.md`](docs/PROD-ENV.md).
- Kiểm tra nhanh: `GET /api/health` → `db_type:"postgresql"`, `db:"connected"`.

## 🔗 Remote Git

```
origin	https://github.com/th-ming/REXI-AI.git (fetch)
origin	https://github.com/th-ming/REXI-AI.git (push)
```

## 📤 Push Code Mẫu

```powershell
cd D:\AI REXI
git add .
git commit -m "chore: update Rexi AI"
git push origin main
```
```
