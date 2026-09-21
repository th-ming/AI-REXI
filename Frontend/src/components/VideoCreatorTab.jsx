import React, { useState, useEffect } from 'react';
import {
  Video, Download, Loader2, Code,
  Sparkles, Check, ArrowLeft, ArrowRight, Info,
  Monitor, Smartphone, Square, Play, Palette, Type, Layers
} from 'lucide-react';

const FORMATS = [
  { id: 'landscape', label: '16:9', desc: 'YouTube, Facebook', icon: Monitor, w: 1920, h: 1080 },
  { id: 'square', label: '1:1', desc: 'Instagram, TikTok', icon: Square, w: 1080, h: 1080 },
  { id: 'portrait', label: '9:16', desc: 'Reels, Shorts', icon: Smartphone, w: 1080, h: 1920 },
];

const GSAP_CDN = '<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>';

const EASY_TEMPLATES = [
  {
    id: 'title-slide',
    name: 'Tiêu Đề & Phụ Đề',
    desc: 'Fade-in title + subtitle trên nền tối',
    category: 'intro',
    fields: [
      { key: 'title', label: 'Tiêu đề chính', placeholder: 'VD: Chào mừng đến với AI Rexi', default: 'Chào mừng đến với AI Rexi' },
      { key: 'subtitle', label: 'Phụ đề', placeholder: 'VD: Video được tạo hoàn toàn miễn phí', default: 'Video được tạo hoàn toàn miễn phí' },
    ],
    build: (f, dur) => `<meta charset="UTF-8">${GSAP_CDN}
<div style="width:100%;height:100%;background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Segoe UI',sans-serif;text-align:center;padding:60px;">
  <h1 id="ts-title" class="clip" data-start="0" data-duration="${dur}" data-track-index="0"
    style="font-size:72px;font-weight:800;background:linear-gradient(90deg,#00d2ff,#3a7bd5);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin:0 0 24px;">
    ${escapeHtml(f.title)}</h1>
  <p id="ts-sub" class="clip" data-start="0.4" data-duration="${dur - 0.4}" data-track-index="1"
    style="font-size:28px;color:#94a3b8;letter-spacing:2px;margin:0;">
    ${escapeHtml(f.subtitle)}</p>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.from('#ts-title', { opacity: 0, y: 50, duration: 0.8, ease: 'power3.out' }, 0);
  tl.from('#ts-sub', { opacity: 0, y: 30, duration: 0.6, ease: 'power3.out' }, 0.4);
  window.__timelines = window.__timelines || {};
  window.__timelines['title-slide'] = tl;
</script>`
  },
  {
    id: 'gradient-bg',
    name: 'Nền Gradient',
    desc: 'Gradient chạy + title nổi bật',
    category: 'promo',
    fields: [
      { key: 'title', label: 'Nội dung chính', placeholder: 'VD: SALE 50% HÔM NAY', default: 'SALE 50% HÔM NAY' },
    ],
    build: (f, dur) => `<meta charset="UTF-8">${GSAP_CDN}
<div id="gb-bg" style="width:100%;height:100%;background:linear-gradient(45deg,#ee7752,#e73c7e,#23a6d5,#23d5ab);background-size:400% 400%;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',sans-serif;">
  <h1 id="gb-title" class="clip" data-start="0" data-duration="${dur}" data-track-index="0"
    style="font-size:64px;font-weight:900;color:white;text-shadow:0 4px 20px rgba(0,0,0,0.3);text-align:center;padding:40px;margin:0;">
    ${escapeHtml(f.title)}</h1>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.fromTo('#gb-bg', { backgroundPosition: '0% 50%' }, { backgroundPosition: '100% 50%', duration: ${dur}, ease: 'none', repeat: -1 }, 0);
  tl.from('#gb-title', { opacity: 0, scale: 0.8, duration: 0.8, ease: 'back.out(1.7)' }, 0.3);
  window.__timelines = window.__timelines || {};
  window.__timelines['gradient-bg'] = tl;
</script>`
  },
  {
    id: 'text-reveal',
    name: 'Hiện Chữ Dần',
    desc: '3 dòng chữ stagger fade-in từ dưới lên',
    category: 'promo',
    fields: [
      { key: 'line1', label: 'Dòng 1', placeholder: 'VD: Sản phẩm mới ra mắt', default: 'Sản phẩm mới ra mắt' },
      { key: 'line2', label: 'Dòng 2', placeholder: 'VD: Giảm giá 30%', default: 'Giảm giá 30%' },
      { key: 'line3', label: 'Dòng 3', placeholder: 'VD: Chỉ trong tuần này!', default: 'Chỉ trong tuần này!' },
    ],
    build: (f, dur) => `<meta charset="UTF-8">${GSAP_CDN}
<div style="width:100%;height:100%;background:radial-gradient(circle at 50% 30%,#1e1b4b,#0a0a0a);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Segoe UI',sans-serif;text-align:center;padding:60px;">
  <h1 id="tr-l1" class="clip" data-start="0" data-duration="${dur}" data-track-index="0"
    style="font-size:56px;font-weight:800;color:#fff;margin:0 0 16px;">${escapeHtml(f.line1)}</h1>
  <h2 id="tr-l2" class="clip" data-start="0.5" data-duration="${dur - 0.5}" data-track-index="1"
    style="font-size:40px;font-weight:600;color:#60a5fa;margin:0 0 16px;">${escapeHtml(f.line2)}</h2>
  <p id="tr-l3" class="clip" data-start="1" data-duration="${dur - 1}" data-track-index="2"
    style="font-size:24px;color:#94a3b8;margin:0;">${escapeHtml(f.line3)}</p>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.from('#tr-l1', { opacity: 0, y: 40, duration: 0.7, ease: 'power3.out' }, 0);
  tl.from('#tr-l2', { opacity: 0, y: 40, duration: 0.7, ease: 'power3.out' }, 0.5);
  tl.from('#tr-l3', { opacity: 0, y: 40, duration: 0.7, ease: 'power3.out' }, 1);
  window.__timelines = window.__timelines || {};
  window.__timelines['text-reveal'] = tl;
</script>`
  },
  {
    id: 'card-grid',
    name: '3 Thẻ Tính Năng',
    desc: '3 thẻ pop-in stagger',
    category: 'intro',
    fields: [
      { key: 'card1', label: 'Thẻ 1 — tiêu đề', placeholder: 'VD: 🚀 Nhanh', default: '🚀 Nhanh' },
      { key: 'card1d', label: 'Thẻ 1 — mô tả', placeholder: 'VD: Tốc độ vượt trội', default: 'Tốc độ vượt trội' },
      { key: 'card2', label: 'Thẻ 2 — tiêu đề', placeholder: 'VD: 🔒 An toàn', default: '🔒 An toàn' },
      { key: 'card2d', label: 'Thẻ 2 — mô tả', placeholder: 'VD: Bảo mật tuyệt đối', default: 'Bảo mật tuyệt đối' },
      { key: 'card3', label: 'Thẻ 3 — tiêu đề', placeholder: 'VD: ✨ Hiện đại', default: '✨ Hiện đại' },
      { key: 'card3d', label: 'Thẻ 3 — mô tả', placeholder: 'VD: Công nghệ mới nhất', default: 'Công nghệ mới nhất' },
    ],
    build: (f, dur) => `<meta charset="UTF-8">${GSAP_CDN}
<div style="width:100%;height:100%;background:#111827;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',sans-serif;padding:60px;">
  <div style="display:flex;gap:40px;">
    <div id="cg-c1" class="clip" data-start="0" data-duration="${dur}" data-track-index="0"
      style="background:linear-gradient(135deg,#1e3a5f,#0f172a);border-radius:20px;padding:40px;width:280px;text-align:center;border:1px solid #334155;">
      <h3 style="color:#fff;font-size:24px;margin:0 0 8px;">${escapeHtml(f.card1)}</h3>
      <p style="color:#94a3b8;font-size:14px;margin:0;">${escapeHtml(f.card1d)}</p>
    </div>
    <div id="cg-c2" class="clip" data-start="0.2" data-duration="${dur - 0.2}" data-track-index="1"
      style="background:linear-gradient(135deg,#1e3a5f,#0f172a);border-radius:20px;padding:40px;width:280px;text-align:center;border:1px solid #334155;">
      <h3 style="color:#fff;font-size:24px;margin:0 0 8px;">${escapeHtml(f.card2)}</h3>
      <p style="color:#94a3b8;font-size:14px;margin:0;">${escapeHtml(f.card2d)}</p>
    </div>
    <div id="cg-c3" class="clip" data-start="0.4" data-duration="${dur - 0.4}" data-track-index="2"
      style="background:linear-gradient(135deg,#1e3a5f,#0f172a);border-radius:20px;padding:40px;width:280px;text-align:center;border:1px solid #334155;">
      <h3 style="color:#fff;font-size:24px;margin:0 0 8px;">${escapeHtml(f.card3)}</h3>
      <p style="color:#94a3b8;font-size:14px;margin:0;">${escapeHtml(f.card3d)}</p>
    </div>
  </div>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.from('#cg-c1', { opacity: 0, scale: 0.7, y: 30, duration: 0.5, ease: 'back.out(1.7)' }, 0);
  tl.from('#cg-c2', { opacity: 0, scale: 0.7, y: 30, duration: 0.5, ease: 'back.out(1.7)' }, 0.2);
  tl.from('#cg-c3', { opacity: 0, scale: 0.7, y: 30, duration: 0.5, ease: 'back.out(1.7)' }, 0.4);
  window.__timelines = window.__timelines || {};
  window.__timelines['card-grid'] = tl;
</script>`
  },
  {
    id: 'countdown',
    name: 'Đếm Ngược',
    desc: 'Số lớn pop-in + message fade',
    category: 'promo',
    fields: [
      { key: 'number', label: 'Số đếm', placeholder: 'VD: 3', default: '3' },
      { key: 'message', label: 'Thông báo', placeholder: 'VD: BẮT ĐẦU!', default: 'BẮT ĐẦU!' },
    ],
    build: (f, dur) => `<meta charset="UTF-8">${GSAP_CDN}
<div style="width:100%;height:100%;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',sans-serif;">
  <div style="text-align:center;">
    <div id="cd-num" class="clip" data-start="0" data-duration="${dur}" data-track-index="0"
      style="font-size:200px;font-weight:900;background:linear-gradient(135deg,#00d2ff,#3a7bd5);-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1;">
      ${escapeHtml(f.number)}</div>
    <div id="cd-msg" class="clip" data-start="0.8" data-duration="${dur - 0.8}" data-track-index="1"
      style="font-size:36px;color:#fff;font-weight:700;letter-spacing:4px;margin-top:20px;">
      ${escapeHtml(f.message)}</div>
  </div>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.from('#cd-num', { opacity: 0, scale: 0.3, duration: 0.6, ease: 'back.out(2)' }, 0);
  tl.to('#cd-num', { scale: 1.15, duration: 0.15, ease: 'power2.in', yoyo: true, repeat: 1 }, 0.6);
  tl.from('#cd-msg', { opacity: 0, y: 20, duration: 0.5, ease: 'power3.out' }, 0.8);
  window.__timelines = window.__timelines || {};
  window.__timelines['countdown'] = tl;
</script>`
  },
  {
    id: 'news-ticker',
    name: 'Bản Tin Chạy',
    desc: 'Breaking news style — headline + scrolling ticker',
    category: 'intro',
    fields: [
      { key: 'headline', label: 'Tiêu đề chính', placeholder: 'VD: TIN NÓNG HÔM NAY', default: 'TIN NÓNG HÔM NAY' },
      { key: 'ticker', label: 'Dòng tin chạy', placeholder: 'VD: Thị trường tăng trưởng 5% trong quý này', default: 'Thị trường tăng trưởng 5% trong quý này' },
    ],
    build: (f, dur) => `<meta charset="UTF-8">${GSAP_CDN}
<div style="width:100%;height:100%;background:linear-gradient(135deg,#0f0f23,#1a1a3e);display:flex;flex-direction:column;justify-content:center;font-family:'Segoe UI',sans-serif;overflow:hidden;">
  <div id="nt-head" class="clip" data-start="0" data-duration="${dur}" data-track-index="0"
    style="padding:40px 60px 20px;">
    <h1 style="font-size:48px;font-weight:900;color:#fff;margin:0;">${escapeHtml(f.headline)}</h1>
  </div>
  <div id="nt-bar" class="clip" data-start="0.3" data-duration="${dur - 0.3}" data-track-index="1"
    style="background:#dc2626;padding:16px 0;overflow:hidden;margin:0 60px;border-radius:8px;">
    <div id="nt-ticker" style="font-size:24px;color:#fff;font-weight:600;letter-spacing:1px;white-space:nowrap;display:inline-block;">
      ${escapeHtml(f.ticker)}&nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(f.ticker)}&nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(f.ticker)}</div>
  </div>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.from('#nt-head', { opacity: 0, x: -50, duration: 0.5, ease: 'power3.out' }, 0);
  tl.from('#nt-bar', { scaleX: 0, transformOrigin: 'left', duration: 0.4, ease: 'power3.out' }, 0.3);
  tl.to('#nt-ticker', { x: '-33.33%', duration: ${dur - 1}, ease: 'none', repeat: -1 }, 0.7);
  window.__timelines = window.__timelines || {};
  window.__timelines['news-ticker'] = tl;
</script>`
  },
  {
    id: 'quote-card',
    name: 'Thẻ Trích Dẫn',
    desc: 'Quote nổi bật + author fade-in',
    category: 'intro',
    fields: [
      { key: 'quote', label: 'Câu nói', placeholder: 'VD: Thành công là tổng của nỗ lực hàng ngày', default: 'Thành công là tổng của nỗ lực hàng ngày' },
      { key: 'author', label: 'Tác giả', placeholder: 'VD: Aristotle', default: 'Aristotle' },
    ],
    build: (f, dur) => `<meta charset="UTF-8">${GSAP_CDN}
<div style="width:100%;height:100%;background:linear-gradient(135deg,#1a1a2e,#e94560);display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',sans-serif;padding:60px;">
  <div style="max-width:800px;text-align:center;">
    <div id="qc-mark" class="clip" data-start="0" data-duration="${dur}" data-track-index="0"
      style="font-size:120px;color:rgba(255,255,255,0.15);line-height:1;margin-bottom:-30px;">\u201C</div>
    <p id="qc-text" class="clip" data-start="0.3" data-duration="${dur - 0.3}" data-track-index="1"
      style="font-size:32px;color:#fff;font-style:italic;line-height:1.5;margin:0 0 24px;">
      ${escapeHtml(f.quote)}</p>
    <p id="qc-author" class="clip" data-start="0.8" data-duration="${dur - 0.8}" data-track-index="2"
      style="font-size:20px;color:rgba(255,255,255,0.7);font-weight:600;margin:0;">
      — ${escapeHtml(f.author)}</p>
  </div>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.from('#qc-mark', { opacity: 0, scale: 0.5, duration: 0.5, ease: 'back.out(1.7)' }, 0);
  tl.from('#qc-text', { opacity: 0, y: 30, duration: 0.7, ease: 'power3.out' }, 0.3);
  tl.from('#qc-author', { opacity: 0, y: 20, duration: 0.5, ease: 'power3.out' }, 0.8);
  window.__timelines = window.__timelines || {};
  window.__timelines['quote-card'] = tl;
</script>`
  },
];

const CATEGORIES = [
  { id: 'all', label: 'Tất cả', icon: Layers },
  { id: 'intro', label: 'Giới thiệu', icon: Sparkles },
  { id: 'promo', label: 'Quảng cáo', icon: Palette },
];

function escapeHtml(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
  return btoa(binary);
}

export default function VideoCreatorTab({ API_BASE, authToken, showToast }) {
  const [step, setStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState(EASY_TEMPLATES[0]);
  const [fields, setFields] = useState(() => {
    const t = EASY_TEMPLATES[0];
    return t.fields.reduce((acc, f) => ({ ...acc, [f.key]: f.default }), {});
  });
  const [html, setHtml] = useState(() => EASY_TEMPLATES[0].build(EASY_TEMPLATES[0].fields.reduce((acc, f) => ({ ...acc, [f.key]: f.default }), {}), 5));
  const [format, setFormat] = useState('landscape');
  const [duration, setDuration] = useState(5);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState('');
    const [videoUrl, setVideoUrl] = useState(null);
    const [downloaded, setDownloaded] = useState(false);
  const [videoSize, setVideoSize] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advHtml, setAdvHtml] = useState('');
  const [status, setStatus] = useState(null);
  const [category, setCategory] = useState('all');
  const [previewTemplate, setPreviewTemplate] = useState(null);

  const selectedFormat = FORMATS.find(f => f.id === format);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const headers = {};
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch(`${API_BASE}/services/video/status`, { headers, credentials: 'include' });
        const data = await res.json();
        if (data.success) setStatus(data);
      } catch { setStatus(null); }
    };
    checkStatus();
  }, [API_BASE, authToken]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (step === 3 && !rendering && !videoUrl) handleRender();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, rendering, videoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const rebuildHtml = (tpl, flds, dur) => {
    const merged = tpl.fields.reduce((acc, f) => ({ ...acc, [f.key]: flds[f.key] ?? f.default }), {});
    return tpl.build(merged, dur ?? duration);
  };

  const pickTemplate = (tpl) => {
    const defaults = tpl.fields.reduce((acc, f) => ({ ...acc, [f.key]: f.default }), {});
    setSelectedTemplate(tpl);
    setFields(defaults);
    setHtml(rebuildHtml(tpl, defaults, duration));
    setVideoUrl(null);
    setStep(2);
    setPreviewTemplate(null);
  };

  const openPreview = (tpl) => {
    setPreviewTemplate(tpl);
  };

  const updateField = (key, value) => {
    const next = { ...fields, [key]: value };
    setFields(next);
    setHtml(rebuildHtml(selectedTemplate, next, duration));
    setVideoUrl(null);
  };

  const handleRender = async () => {
    if (!html.trim()) return;
    setRendering(true);
    setRenderProgress('Đang gửi nội dung đến server...');
    setVideoUrl(null);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      setRenderProgress('Đang render video... (mất 30-60 giây)');
      const res = await fetch(`${API_BASE}/services/video/render`, {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify({ html, width: selectedFormat.w, height: selectedFormat.h, fps: 30, duration })
      });
      if (res.status === 404 || res.status === 410) {
        setRenderProgress('');
        showToast('Link render đã hết hạn (server restart) — render lại nhé.', 'error');
        return;
      }
      const data = await res.json();
      if (data.success && data.video) {
        const url = 'data:video/mp4;base64,' + data.video;
        setVideoUrl(url);
        setVideoSize(data.size);
        setRenderProgress('');
        setStep(4);
        showToast(`Video render thành công! (${(data.size / 1024 / 1024).toFixed(1)}MB)`, 'success');
      } else {
        setRenderProgress('');
        showToast(data.error || 'Render thất bại', 'error');
      }
    } catch (err) {
      setRenderProgress('');
      showToast('Lỗi: ' + err.message, 'error');
    } finally {
      setRendering(false);
    }
  };

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `rexi_video_${Date.now()}.mp4`;
    a.click();
    setDownloaded(true);
    showToast('Đã tải video MP4!', 'success');
  };

  const startOver = () => {
    setStep(1);
    setVideoUrl(null);
    setRenderProgress('');
  };

  useEffect(() => {
    if (!videoUrl || downloaded) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [videoUrl, downloaded]);

  const previewSrc = `data:text/html;base64,${utf8ToBase64(showAdvanced ? advHtml || html : html)}`;
  const ready = status?.ready === true;
  const filteredTemplates = category === 'all' ? EASY_TEMPLATES : EASY_TEMPLATES.filter(t => t.category === category);

  const STEPS = [
    { n: 1, label: 'Chọn mẫu', icon: Palette },
    { n: 2, label: 'Nhập nội dung', icon: Type },
    { n: 3, label: 'Xem & Render', icon: Play },
    { n: 4, label: 'Tải video', icon: Download },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-white overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
<div className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center">
             <Video size={18} className="text-[#4a7dff]" />
           </div>
           <div>
             <h1 className="text-sm font-bold text-slate-800">Tạo Video</h1>
             <p className="text-[10px] text-slate-500">Tạo video HTML animation đẹp mắt</p>
           </div>
        </div>
        {/* Format Selector */}
        <div className="flex items-center gap-1 p-1 bg-slate-50 rounded-xl border border-slate-200">
          {FORMATS.map(f => {
            const Icon = f.icon;
            return (
              <button
                key={f.id}
                onClick={() => setFormat(f.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  format === f.id
                    ? 'bg-[#4a7dff]/20 text-[#4a7dff] border border-[#4a7dff]/30'
                    : 'text-slate-800 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon size={12} />
                <span className="hidden sm:inline">{f.label}</span>
              </button>
            );
          })}
        </div>
        {/* Duration Selector */}
        <div className="flex items-center gap-1 p-1 bg-slate-50 rounded-xl border border-slate-200">
          {[5, 10, 15, 30].map(d => (
            <button
              key={d}
              onClick={() => setDuration(d)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                duration === d
                  ? 'bg-[#4a7dff]/20 text-[#4a7dff] border border-[#4a7dff]/30'
                  : 'text-slate-800 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {d}s
            </button>
          ))}
        </div>
      </div>

{/* Step Indicator */}
        <div className="flex items-center justify-center gap-1 px-4 py-2.5 border-b border-slate-200 bg-slate-50">
          {STEPS.map((s, i) => {
            return (
              <React.Fragment key={s.n}>
                {i > 0 && <div className={`w-8 h-px ${step > s.n ? 'bg-[#4a7dff]/60' : 'bg-slate-200/10'}`} />}
                <button
                  onClick={() => s.n < step && setStep(s.n)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    step === s.n
                      ? 'bg-[#4a7dff]/15 text-[#4a7dff] border border-[#4a7dff]/30'
                      : step > s.n
                        ? 'text-emerald-400 hover:bg-slate-100'
                        : 'text-slate-600'
                  }`}
                  title={s.n < step ? 'Quay lại bước này' : s.label}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                    step > s.n ? 'bg-emerald-500 text-white' : step === s.n ? 'bg-[#4a7dff] text-white' : 'bg-slate-200/10 text-slate-500'
                  }`}>
                    {step > s.n ? '✓' : s.n}
                  </span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>

      {/* Status Warning */}
      {status && !ready && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-start gap-2">
          <Info size={13} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-amber-200/80 leading-relaxed">
            Chưa cấu hình render video (thiếu ffmpeg hoặc Chrome/Chromium). Trên server: chạy <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[9px]">npx playwright install chromium</code> trong Backend. Bạn vẫn xem được preview.
          </p>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {/* Step 1: Pick Template */}
        {step === 1 && (
          <div className="p-5 max-w-5xl mx-auto">
            <div className="text-center mb-5">
              <h2 className="text-lg font-bold text-white">Chọn mẫu video</h2>
              <p className="text-[11px] text-slate-500 mt-1">Bấm chọn mẫu — sau đó điền nội dung của bạn</p>
            </div>

            {/* Category Filter */}
            <div className="flex items-center justify-center gap-2 mb-5">
              {CATEGORIES.map(c => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-medium transition-all ${
                      category === c.id
                        ? 'bg-[#4a7dff]/15 text-[#4a7dff] border border-[#4a7dff]/30'
                        : 'bg-slate-50 text-slate-800 border border-slate-200 hover:text-slate-900 hover:border-slate-300'
                    }`}
                  >
                    <Icon size={12} />
                    {c.label}
                  </button>
                );
              })}
            </div>

            {/* Template Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTemplates.map(t => {
                const previewHtml = t.build(t.fields.reduce((a, f) => ({ ...a, [f.key]: f.default }), {}), duration);
                const previewSrc = `data:text/html;base64,${utf8ToBase64(previewHtml)}`;
                return (
                  <button
                    key={t.id}
                    onClick={() => openPreview(t)}
                    className={`group rounded-2xl overflow-hidden border transition-all text-left active:scale-[0.98] ${
                      selectedTemplate.id === t.id
                        ? 'border-[#4a7dff]/60 ring-2 ring-[#4a7dff]/30 shadow-lg shadow-[#4a7dff]/10'
                        : 'border-slate-200 hover:border-[#4a7dff]/40 hover:shadow-lg hover:shadow-[#4a7dff]/5'
                    }`}
                  >
                    {/* Video Preview */}
                    <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
                      <iframe
                        src={previewSrc}
                        className="w-full h-full border-0 pointer-events-none"
                        sandbox="allow-scripts"
                        loading="lazy"
                        title={t.name}
                      />
                      {/* Play Button Overlay */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/30">
                        <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-xl">
                          <Play size={24} className="text-gray-900 ml-1" fill="currentColor" />
                        </div>
                      </div>
                      {/* Duration Badge */}
                      <span className="absolute bottom-2 right-2 px-2 py-0.5 bg-slate-900/75 rounded text-[10px] text-white font-medium">0:{String(duration).padStart(2, '0')}</span>
                      {/* Selected Badge */}
                      {selectedTemplate.id === t.id && (
                        <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#4a7dff] text-white text-xs font-bold flex items-center justify-center shadow-lg">✓</span>
                      )}
                    </div>
                    {/* Info */}
                    <div className="px-4 py-3 bg-slate-50">
                      <p className="text-xs font-bold text-slate-800">{t.name}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{t.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

<div className="flex justify-center mt-6">
               <button
                 onClick={() => setStep(2)}
                 className="px-8 py-3 rounded-xl bg-gradient-to-r from-[#4a7dff] to-[#3d6ae6] hover:from-[#3d6ae6] hover:to-[#4a7dff] text-white font-bold text-sm shadow-lg shadow-[4a7dff]/20 transition-all flex items-center gap-2 active:scale-95"
               >
                 Chọn mẫu này <ArrowRight size={16} />
               </button>
             </div>
          </div>
        )}

        {/* Step 2: Edit Fields */}
        {step === 2 && (
          <div className="p-5 max-w-2xl mx-auto">
<div className="flex items-center justify-between mb-4">
               <div>
                 <h2 className="text-base font-bold text-slate-800">Nhập nội dung</h2>
                 <p className="text-[11px] text-slate-500 mt-0.5">
                   Mẫu: <span className="text-[#4a7dff]">{selectedTemplate.name}</span>
                 </p>
               </div>
               <button onClick={() => setStep(1)} className="text-[11px] text-slate-400 hover:text-slate-800 flex items-center gap-1 transition-colors">
                 <ArrowLeft size={12} /> Đổi mẫu
               </button>
             </div>
            <div className="space-y-3">
{selectedTemplate.fields.map(f => (
                 <div key={f.key} className="space-y-1.5">
                   <label className="text-[11px] font-semibold text-slate-600">{f.label}</label>
                   <input
                     type="text"
                     value={fields[f.key] ?? f.default}
                     onChange={e => updateField(f.key, e.target.value)}
                     placeholder={f.placeholder}
                     className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-500 outline-none focus:border-[#4a7dff]/50 focus:ring-2 focus:ring-[4a7dff]/10 transition-all"
                   />
                 </div>
               ))}
            </div>
<div className="flex justify-between mt-6">
               <button onClick={() => setStep(1)} className="px-5 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold transition-all flex items-center gap-2 active:scale-95">
                 <ArrowLeft size={14} /> Quay lại
               </button>
               <button onClick={() => setStep(3)} className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#4a7dff] to-[#3d6ae6] hover:from-[#3d6ae6] hover:to-[#4a7dff] text-white text-xs font-bold shadow-lg shadow-[4a7dff]/20 transition-all flex items-center gap-2 active:scale-95">
                 Xem trước <ArrowRight size={14} />
               </button>
             </div>
          </div>
        )}

        {/* Step 3: Preview & Render */}
        {step === 3 && (
          <div className="p-5 max-w-4xl mx-auto">
<div className="flex items-center justify-between mb-3">
               <div>
                 <h2 className="text-base font-bold text-slate-800">Xem trước video</h2>
                 <p className="text-[11px] text-slate-500 mt-0.5">
                   {selectedFormat.label} • {selectedFormat.w}×{selectedFormat.h}
                 </p>
               </div>
               <button onClick={() => setStep(2)} className="text-[11px] text-slate-400 hover:text-slate-800 flex items-center gap-1 transition-colors">
                 <ArrowLeft size={12} /> Sửa nội dung
               </button>
             </div>

{/* Preview */}
             <div className="rounded-2xl overflow-hidden bg-slate-50 border border-slate-200 shadow-2xl">
               <div style={{ aspectRatio: `${selectedFormat.w}/${selectedFormat.h}` }}>
                 <iframe
                   src={previewSrc}
                   className="w-full h-full border-0"
                   sandbox="allow-scripts"
                   title="Preview"
                   style={{ pointerEvents: 'none' }}
                 />
               </div>
             </div>

{/* Render Controls */}
             <div className="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-200">
               {renderProgress ? (
                 <div className="flex items-center gap-3">
                   <Loader2 size={18} className="animate-spin text-[4a7dff]" />
                   <span className="text-sm text-[4a7dff]">{renderProgress}</span>
                 </div>
               ) : videoUrl ? (
                 <div className="flex items-center gap-4">
                   <div className="w-16 h-10 rounded-lg overflow-hidden bg-slate-50 border border-slate-200 shrink-0">
                     <video src={videoUrl} className="w-full h-full object-cover" muted />
                   </div>
                   <div className="flex-1 min-w-0">
                     <p className="text-sm font-bold text-emerald-300">Video đã render xong!</p>
                     <p className="text-[10px] text-slate-500">{selectedFormat.label} • {selectedFormat.w}×{selectedFormat.h} • {(videoSize / 1024 / 1024).toFixed(1)}MB</p>
                   </div>
                   <button onClick={handleDownload} className="px-5 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-1.5 hover:bg-emerald-500/30 transition-all active:scale-95">
                     <Download size={14} /> Tải MP4
                   </button>
                 </div>
               ) : (
                 <div className="flex items-center justify-between flex-wrap gap-3">
                   <p className="text-[11px] text-slate-500">Sẵn sàng render. Bấm nút để tạo file MP4 (mất 30-60 giây).</p>
                   <button
                     onClick={handleRender}
                     disabled={rendering}
                     className="px-8 py-3 rounded-xl bg-gradient-to-r from-[#4a7dff] to-[#3d6ae6] hover:from-[#3d6ae6] hover:to-[#4a7dff] text-white font-bold text-sm shadow-lg shadow-[4a7dff]/20 disabled:opacity-50 transition-all flex items-center gap-2 active:scale-95"
                   >
                     {rendering ? <Loader2 size={16} className="animate-spin" /> : <Video size={16} />}
                     {rendering ? 'Đang render...' : 'Render MP4'}
                   </button>
                 </div>
               )}
             </div>
          </div>
        )}

{/* Step 4: Done */}
         {step === 4 && (
           <div className="p-8 max-w-md mx-auto text-center">
             <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mb-4">
               <Check size={32} className="text-emerald-400" />
             </div>
              <h2 className="text-lg font-bold text-slate-800">Video đã xong!</h2>
              <p className="text-[11px] text-slate-500 mt-1.5">
                Bấm nút bên dưới để tải file MP4 về thư mục Downloads.
              </p>
              {!downloaded && (
                <p className="text-[11px] text-amber-600 mt-2 flex items-center justify-center gap-1.5">
                  <Info size={12} /> Video chỉ tồn tại trong phiên này — hãy tải về máy trước khi rời trang.
                </p>
              )}
             <div className="mt-5 space-y-2.5">
               <button
                 onClick={handleDownload}
                 className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 active:scale-95"
               >
                 <Download size={16} /> Tải video MP4
               </button>
               <button
                 onClick={startOver}
                 className="w-full py-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold transition-all active:scale-95"
               >
                 Tạo video khác
               </button>
             </div>
           </div>
         )}
      </div>

{/* Footer - Advanced HTML */}
       <div className="border-t border-slate-200 bg-slate-50">
         <button
           onClick={() => setShowAdvanced(!showAdvanced)}
           className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] text-slate-800 hover:text-slate-600 transition-colors"
         >
           <Code size={11} /> {showAdvanced ? 'Ẩn code' : 'Chế độ code (nâng cao)'}
         </button>
         {showAdvanced && (
           <div className="px-4 pb-3 flex gap-2">
             <div className="flex-1">
               <textarea
                 value={advHtml || html}
                 onChange={e => { setAdvHtml(e.target.value); }}
                 rows={6}
                 className="w-full p-3 bg-slate-900 text-green-300 font-mono text-[11px] leading-relaxed outline-none resize-none border border-slate-200 rounded-xl placeholder-slate-500"
                 placeholder="Dán HTML của bạn vào đây..."
                 spellCheck={false}
               />
             </div>
             <button
               onClick={() => { if (advHtml.trim()) setHtml(advHtml); setStep(3); }}
               className="self-end px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#4a7dff] to-[#3d6ae6] hover:from-[#3d6ae6] hover:to-[#4a7dff] text-white text-xs font-bold shadow-lg shadow-[4a7dff]/20 transition-all active:scale-95"
             >
               Dùng code này
             </button>
           </div>
         )}
       </div>

{/* Preview Modal */}
       {previewTemplate && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50" style={{transition:'background-color .2s'}} onClick={() => setPreviewTemplate(null)}>
           <div className="bg-slate-50 rounded-2xl border border-slate-200 shadow-2xl w-[90vw] max-w-4xl overflow-hidden" onClick={e => e.stopPropagation()}>
             {/* Modal Header */}
             <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
               <div>
                 <h3 className="text-sm font-bold text-slate-800">{previewTemplate.name}</h3>
                 <p className="text-[10px] text-slate-500">{previewTemplate.desc}</p>
               </div>
               <button onClick={() => setPreviewTemplate(null)} className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-800 transition-all">
                 ✕
               </button>
             </div>
             {/* Preview Area */}
             <div className="p-5">
               <div className="rounded-xl overflow-hidden bg-slate-50 border border-slate-200" style={{ aspectRatio: '16/9' }}>
                 <iframe
                   src={`data:text/html;base64,${utf8ToBase64(previewTemplate.build(previewTemplate.fields.reduce((a, f) => ({ ...a, [f.key]: f.default }), {}), duration))}`}
                   className="w-full h-full border-0"
                   sandbox="allow-scripts"
                   title={previewTemplate.name}
                 />
               </div>
             </div>
             {/* Modal Footer */}
             <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200">
               <p className="text-[10px] text-slate-500">Thời lượng: {duration}s • {selectedFormat.label} ({selectedFormat.w}×{selectedFormat.h})</p>
               <div className="flex gap-2">
                 <button onClick={() => setPreviewTemplate(null)} className="px-4 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-300 text-xs font-semibold transition-all">
                   Đóng
                 </button>
                 <button onClick={() => pickTemplate(previewTemplate)} className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#4a7dff] to-[#3d6ae6] hover:from-[#3d6ae6] hover:to-[#4a7dff] text-white text-xs font-bold shadow-lg shadow-[4a7dff]/20 transition-all flex items-center gap-1.5">
                   Chọn mẫu này <ArrowRight size={14} />
                 </button>
               </div>
             </div>
           </div>
         </div>
       )}
    </div>
  );
}
