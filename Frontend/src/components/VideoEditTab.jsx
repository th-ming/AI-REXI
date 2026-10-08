import React, { useState, useRef } from 'react';
import { Loader2, UploadCloud, Wand2, Download, Film, Scissors, Type, Music, Crop, Gauge, Volume2, Image as ImageIcon } from 'lucide-react';

const OPS = [
  { id: 'trim', label: 'Cắt (trim)', icon: <Scissors size={15} /> },
  { id: 'concat', label: 'Ghép nhiều clip', icon: <Film size={15} /> },
  { id: 'add_text', label: 'Chèn chữ', icon: <Type size={15} /> },
  { id: 'add_audio', label: 'Chèn nhạc', icon: <Music size={15} /> },
  { id: 'resize', label: 'Đổi tỉ lệ', icon: <Crop size={15} /> },
  { id: 'speed', label: 'Đổi tốc độ', icon: <Gauge size={15} /> },
  { id: 'extract_audio', label: 'Tách âm thanh', icon: <Volume2 size={15} /> },
  { id: 'thumbnail', label: 'Ảnh bìa', icon: <ImageIcon size={15} /> },
];

const field = 'w-full rounded-lg bg-black/30 border border-white/10 text-[12.5px] text-slate-100 px-3 py-2 focus:outline-none focus:border-cyan-400/50 placeholder:text-slate-600';
const label = 'text-[11px] font-semibold text-slate-400 mb-1 block';

export default function VideoEditTab({ authToken, showToast }) {
  const [url, setUrl] = useState('');
  const [upPath, setUpPath] = useState('');
  const [upName, setUpName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [op, setOp] = useState('trim');
  const [p, setP] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const set = (k, v) => setP(prev => ({ ...prev, [k]: v }));
  const inputSrc = upPath || url.trim();

  const onPickFile = async (f) => {
    if (!f || !authToken) return;
    setUploading(true); setErr('');
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await fetch('/api/services/video/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + authToken }, body: fd });
      const d = await r.json();
      if (d && d.path) { setUpPath(d.path); setUpName(d.name); }
      else setErr('Upload lỗi: ' + (d.error || r.status));
    } catch (e) { setErr('Upload lỗi: ' + e.message); }
    setUploading(false);
  };

  const buildArgs = () => {
    const base = { operation: op };
    if (op === 'concat') {
      const list = [inputSrc, ...(String(p.extra || '').split('\n').map(s => s.trim()).filter(Boolean))].filter(Boolean);
      base.inputs = list;
    } else {
      base.input = inputSrc;
    }
    if (op === 'trim') { base.start = p.start; base.duration = p.duration; }
    if (op === 'add_text') { base.text = p.text; base.position = p.position || 'bottom'; base.color = p.color || 'white'; base.fontSize = Number(p.fontSize) || undefined; }
    if (op === 'add_audio') { base.audio = p.audio; base.mix = p.mix != null && p.mix !== '' ? Number(p.mix) : undefined; }
    if (op === 'resize') { base.width = Number(p.width) || 1080; base.height = Number(p.height) || 1920; }
    if (op === 'speed') { base.speed = Number(p.speed) || 1.5; }
    if (op === 'thumbnail') { base.at = p.at || '1'; }
    return base;
  };

  const run = async () => {
    if (!authToken) { showToast && showToast('Cần đăng nhập', 'error'); return; }
    if (op === 'concat' ? !inputSrc && !p.extra : !inputSrc) { setErr('Chưa có nguồn video (URL hoặc file).'); return; }
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await fetch('/api/services/video/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
        body: JSON.stringify(buildArgs())
      });
      const d = await r.json();
      if (d && d.success) setResult(d);
      else setErr('Lỗi: ' + (d.error || r.status));
    } catch (e) { setErr('Lỗi mạng: ' + e.message); }
    setBusy(false);
  };

  const mediaUrl = result ? `${result.url}?token=${encodeURIComponent(authToken || '')}` : '';

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-3xl mx-auto">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-100 mb-1"><Wand2 size={18} className="text-cyan-400" /> Dựng Video</h2>
        <p className="text-[11.5px] text-slate-500 mb-5">Cắt · ghép · chèn chữ/nhạc · đổi tỉ lệ/tốc độ · tách âm thanh — chạy trên server, không cần cài gì. (Đây là bản "edit bằng lệnh", khác OpenCut kéo-thả.)</p>

        {/* Nguồn */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 mb-4">
          <span className={label}>Nguồn video</span>
          <input className={field} placeholder="Dán URL video (https://...mp4)" value={url} onChange={e => { setUrl(e.target.value); setUpPath(''); }} />
          <div className="flex items-center gap-3 mt-2.5">
            <button onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-slate-200 text-[12px] font-semibold hover:bg-white/10 disabled:opacity-50">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />} Tải file lên
            </button>
            <input ref={fileRef} type="file" accept="video/*,audio/*,image/*" className="hidden" onChange={e => onPickFile(e.target.files[0])} />
            {upName && <span className="text-[11.5px] text-emerald-300 truncate">✓ {upName}</span>}
          </div>
        </div>

        {/* Thao tác */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 mb-4">
          <span className={label}>Thao tác</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {OPS.map(o => (
              <button key={o.id} onClick={() => setOp(o.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-[11.5px] font-semibold transition-all ${op === o.id ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-100' : 'bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.07]'}`}>
                {o.icon} {o.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {op === 'trim' && (<>
              <div><span className={label}>Bắt đầu (ss hoặc mm:ss)</span><input className={field} placeholder="0:05" value={p.start || ''} onChange={e => set('start', e.target.value)} /></div>
              <div><span className={label}>Độ dài</span><input className={field} placeholder="0:30" value={p.duration || ''} onChange={e => set('duration', e.target.value)} /></div>
            </>)}
            {op === 'concat' && (<>
              <div className="col-span-2"><span className={label}>Thêm clip (mỗi dòng 1 URL)</span><textarea rows={3} className={field} placeholder="https://...mp4&#10;https://...mp4" value={p.extra || ''} onChange={e => set('extra', e.target.value)} /></div>
            </>)}
            {op === 'add_text' && (<>
              <div className="col-span-2"><span className={label}>Nội dung chữ</span><input className={field} placeholder="Xin chào" value={p.text || ''} onChange={e => set('text', e.target.value)} /></div>
              <div><span className={label}>Vị trí</span>
                <select className={field} value={p.position || 'bottom'} onChange={e => set('position', e.target.value)}><option value="top">Trên</option><option value="center">Giữa</option><option value="bottom">Dưới</option></select>
              </div>
              <div><span className={label}>Màu (vd white, yellow)</span><input className={field} placeholder="white" value={p.color || ''} onChange={e => set('color', e.target.value)} /></div>
            </>)}
            {op === 'add_audio' && (<>
              <div className="col-span-2"><span className={label}>Nhạc (URL mp3)</span><input className={field} placeholder="https://...mp3" value={p.audio || ''} onChange={e => set('audio', e.target.value)} /></div>
              <div><span className={label}>Âm lượng nhạc (0–1)</span><input className={field} placeholder="0.3" value={p.mix || ''} onChange={e => set('mix', e.target.value)} /></div>
            </>)}
            {op === 'resize' && (<>
              <div><span className={label}>Rộng</span><input className={field} placeholder="1080" value={p.width || ''} onChange={e => set('width', e.target.value)} /></div>
              <div><span className={label}>Cao</span><input className={field} placeholder="1920" value={p.height || ''} onChange={e => set('height', e.target.value)} /></div>
            </>)}
            {op === 'speed' && (<>
              <div><span className={label}>Hệ số tốc độ (vd 1.5)</span><input className={field} placeholder="1.5" value={p.speed || ''} onChange={e => set('speed', e.target.value)} /></div>
            </>)}
            {op === 'thumbnail' && (<>
              <div><span className={label}>Lấy ảnh tại (giây)</span><input className={field} placeholder="1" value={p.at || ''} onChange={e => set('at', e.target.value)} /></div>
            </>)}
          </div>

          <button onClick={run} disabled={busy}
            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-400/50 text-cyan-100 text-[13px] font-bold hover:bg-cyan-500/30 disabled:opacity-50 transition-all">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Dựng video
          </button>
          {err && <p className="mt-3 text-[12px] text-rose-300">{err}</p>}
        </div>

        {/* Kết quả */}
        {result && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.05] p-4">
            <p className="text-[12.5px] text-emerald-200 mb-2">✓ Xong ({Math.round((result.sizeBytes || 0) / 1024)} KB)</p>
            {(result.fileName || '').endsWith('.mp4') && <video controls src={mediaUrl} className="w-full rounded-lg mb-3 bg-black" />}
            {((result.fileName || '').endsWith('.jpg') || (result.fileName || '').endsWith('.png')) && <img src={mediaUrl} alt="result" className="w-full rounded-lg mb-3" />}
            <a href={mediaUrl} download={result.fileName} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-400/50 text-emerald-100 text-[12.5px] font-semibold hover:bg-emerald-500/30 transition-all">
              <Download size={14} /> Tải về
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
