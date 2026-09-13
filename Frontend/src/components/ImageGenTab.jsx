import React, { useState } from 'react';
import { Sparkles, Loader2, Download, Copy, Check, Trash2 } from 'lucide-react';

export default function ImageGenTab({ API_BASE, authToken, showToast, imageModels = [] }) {
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [picked, setPicked] = useState(''); // ''=Gemini builtin, else 'provider||model'
  const [size, setSize] = useState('1024x1024');

  const generate = async () => {
    if (!prompt.trim()) { setError('Vui lòng nhập mô tả ảnh cần tạo.'); return; }
    setLoading(true); setError(''); setImage('');
    try {
      if (picked) {
        const [provider, model] = picked.split('||');
        const res = await fetch(`${API_BASE}/media/image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}) },
          body: JSON.stringify({ prompt: prompt.trim(), provider, model, size })
        });
        const data = await res.json();
        const first = data.images && data.images[0];
        if (data.success && first) { setImage(first.url || first.b64); showToast?.('✅ Tạo ảnh thành công!', 'success'); }
        else setError(data.error || 'Tạo ảnh thất bại — provider này có thể không nhận model đã chọn.');
        return;
      }
      const res = await fetch(`${API_BASE}/services/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ prompt: prompt.trim() })
      });
      const data = await res.json();
      if (data.success && data.image) {
        setImage(data.image);
        showToast?.('✅ Tạo ảnh thành công!', 'success');
      } else {
        setError(data.error || 'Tạo ảnh thất bại.');
      }
    } catch (e) {
      setError('Lỗi kết nối: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    if (!image) return;
    const a = document.createElement('a');
    a.href = image;
    a.download = 'rexi_image_' + Date.now() + '.png';
    a.click();
  };

  const copyImage = async () => {
    if (!image) return;
    try {
      const blob = await (await fetch(image)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      // Fallback: copy base64
      try { await navigator.clipboard.writeText(image); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e2) {}
    }
  };

  const clear = () => { setImage(''); setError(''); setPrompt(''); };

  return (
    <div className="h-full flex flex-col p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center gap-2">
        <Sparkles size={18} className="text-indigo-400" />
        <h2 className="text-lg font-bold text-slate-100">Tạo Ảnh AI</h2>
        <span className="text-[10px] text-slate-500">Mặc định Gemini free — hoặc chọn model ảnh từ các router (UnoRouter SD checkpoints, v.v...)</span>
      </div>

      <div className="bg-[#1e1f20] border border-white/10 rounded-2xl p-4 space-y-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } }}
          placeholder="Mô tả ảnh bạn muốn tạo... Ví dụ: một chú mèo dễ thương đội mũ chef đang nấu ăn trong bếp hiện đại, phong cách anime"
          className="w-full min-h-[90px] bg-[#131416] border border-white/10 rounded-xl p-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 resize-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="bg-[#131416] border border-white/10 rounded-xl px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50 max-w-[280px]"
            title="Model tạo ảnh (mặc định: Gemini builtin)"
          >
            <option value="">🖼️ Gemini (builtin — nhanh, free)</option>
            {imageModels.map(m => (
              <option key={`${m.provider}|${m.id}`} value={`${m.provider}||${m.id}`}>
                {m.provider.toUpperCase()} — {m.name || m.id}{m.status === 'needs_balance' || m.type === 'paid' ? ' 🔒' : ''}
              </option>
            ))}
          </select>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="bg-[#131416] border border-white/10 rounded-xl px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50"
          >
            <option value="1024x1024">1024×1024</option>
            <option value="512x512">512×512</option>
          </select>
          {imageModels.length === 0 && <span className="text-[10px] text-slate-500">Chưa quét được model ảnh nào — chọn thêm sau lượt quét</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 transition-all"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? 'Đang tạo ảnh...' : 'Tạo ảnh'}
          </button>
          {image && (
            <>
              <button onClick={download} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#26282b] hover:bg-[#2f3236] text-slate-200 text-xs border border-white/10 transition-all">
                <Download size={14} /> Tải ảnh
              </button>
              <button onClick={copyImage} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#26282b] hover:bg-[#2f3236] text-slate-200 text-xs border border-white/10 transition-all">
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />} {copied ? 'Đã copy' : 'Copy'}
              </button>
              <button onClick={clear} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#26282b] hover:bg-[#2f3236] text-slate-400 text-xs border border-white/10 transition-all">
                <Trash2 size={14} /> Xóa
              </button>
            </>
          )}
        </div>
        <p className="text-[10px] text-slate-500">💡 Lưu ý: ảnh tạo từ Gemini free tier, nếu gặp lỗi "hết quota" thì đợi vài phút thử lại.</p>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-10 text-slate-400 space-y-2">
          <Loader2 size={32} className="animate-spin text-indigo-400" />
          <p className="text-xs">Gemini đang vẽ... thường mất 10-20 giây</p>
        </div>
      )}

      {image && !loading && (
        <div className="flex justify-center">
          <img src={image} alt="Kết quả tạo ảnh" className="max-w-full max-h-[55vh] rounded-2xl border border-white/10 shadow-2xl" />
        </div>
      )}

      {!image && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 space-y-2 py-10">
          <div className="text-5xl mb-2">🖼️</div>
          <p className="text-sm">Mô tả bằng chữ ở trên, bấm <b>Tạo ảnh</b> là có ảnh AI ngay.</p>
          <p className="text-[10px] max-w-md">Ví dụ gợi ý: "phong cảnh núi rừng lúc hoàng hôn, màu cam tím", "robot làm bánh trong tiệm bánh, pixel art"...</p>
        </div>
      )}
    </div>
  );
}
