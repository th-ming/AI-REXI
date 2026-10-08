import React, { useState, useEffect } from 'react';
import { X, Download, Copy, Check, Loader2, Link2, FileText, MessageSquare, Layers, AlertTriangle, Play } from 'lucide-react';
import { API_BASE } from '../config';

/**
 * ScrapePanel — "Cào dữ liệu" (Data Scraper Kit). ADDITIVE.
 * Trích xuất info / nội dung / bình luận / media từ link (YouTube, TikTok, Instagram,
 * X, Facebook... qua yt-dlp worker; + web thường). Modal dark card + cyan accent.
 */
export default function ScrapePanel({ open, onClose, token }) {
  const [input, setInput] = useState('');
  const [maxComments, setMaxComments] = useState(30);
  const [loading, setLoading] = useState('');
  const [result, setResult] = useState(null);
  const [meta, setMeta] = useState(null); // { action, source, count }
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const [copied, setCopied] = useState(false);

  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  const firstUrl = () => input.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
  const urlList = () => input.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/scrape/status`, { headers: headers() });
        const data = await res.json().catch(() => ({}));
        if (alive) setStatus(data);
      } catch (e) {
        if (alive) setStatus({ ok: false, error: 'Không lấy được trạng thái.' });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const run = async (action) => {
    if (loading) return;
    setError('');
    setResult(null);
    setMeta(null);
    setCopied(false);

    const body = { url: firstUrl() };
    if (action === 'batch') {
      body.urls = urlList();
      delete body.url;
    }
    if (action === 'comments') body.max = Number(maxComments) || 30;

    if (action === 'batch') {
      if (!body.urls.length) { setError('Dán ít nhất 1 link (mỗi dòng 1 link).'); return; }
    } else if (!body.url) {
      setError('Dán 1 link hợp lệ (bắt đầu bằng http).');
      return;
    }

    setLoading(action);
    try {
      const res = await fetch(`${API_BASE}/scrape/${action}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResult(data);
      setMeta({ action, source: data.source || (action === 'batch' ? 'batch' : ''), count: data.count });
    } catch (e) {
      setError(e.message || 'Lỗi không xác định.');
    } finally {
      setLoading('');
    }
  };

  const copyResult = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError('Trình duyệt chặn clipboard — chọn tay để copy.');
    }
  };

  const Btn = ({ action, icon, label, accent }) => (
    <button
      onClick={() => run(action)}
      disabled={!!loading}
      title={label}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all text-white disabled:opacity-50 ${accent}`}
    >
      {loading === action ? <Loader2 size={13} className="animate-spin" /> : icon}
      {label}
    </button>
  );

  const comments = result && meta?.action === 'comments' && Array.isArray(result.data) ? result.data : null;
  const batchResults = result && meta?.action === 'batch' && Array.isArray(result.results) ? result.results : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#181920] border border-white/10 rounded-2xl w-full max-w-3xl p-6 space-y-4 shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <Download className="text-cyan-400" size={20} />
            <h3 className="text-sm font-bold text-white">Cào dữ liệu — Data Scraper Kit</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        {/* Trạng thái worker */}
        <div className="flex items-center gap-2 text-[11px]">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${status?.ytdlp_worker?.configured ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-amber-300 border-amber-500/30 bg-amber-500/10'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status?.ytdlp_worker?.configured ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {status?.ytdlp_worker?.configured ? 'yt-dlp worker: đã cấu hình' : 'yt-dlp worker: chưa cấu hình (chỉ đọc web)'}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-sky-300 border-sky-500/30 bg-sky-500/10">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" /> web: sẵn sàng
          </span>
        </div>

        {/* Input */}
        <div className="space-y-2">
          <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
            <Link2 size={12} className="text-cyan-400" /> Dán link (1 link/dòng — hỗ trợ dán nhiều cho "Hàng loạt")
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder={'https://www.youtube.com/watch?v=...\nhttps://www.tiktok.com/@user/video/...\nhttps://example.com'}
            className="w-full bg-[#131417] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/40 font-mono resize-y"
          />
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>Số bình luận:</span>
            <input
              type="number"
              min={1}
              max={100}
              value={maxComments}
              onChange={(e) => setMaxComments(e.target.value)}
              className="w-16 bg-[#131417] border border-white/10 rounded-lg px-2 py-0.5 text-slate-200 outline-none"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Btn action="info" icon={<FileText size={13} />} label="Lấy thông tin" accent="bg-cyan-600 hover:bg-cyan-500" />
          <Btn action="page" icon={<FileText size={13} />} label="Cào nội dung" accent="bg-sky-600 hover:bg-sky-500" />
          <Btn action="comments" icon={<MessageSquare size={13} />} label="Lấy bình luận" accent="bg-indigo-600 hover:bg-indigo-500" />
          <Btn action="batch" icon={<Layers size={13} />} label="Hàng loạt" accent="bg-violet-600 hover:bg-violet-500" />
          <Btn action="download" icon={<Download size={13} />} label="Link tải" accent="bg-teal-600 hover:bg-teal-500" />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Nguồn: <span className="text-cyan-300 font-mono">{meta?.source || '—'}</span>
                {meta?.count != null ? <> · <span className="text-slate-300">{meta.count}</span> mục</> : null}
                {result.note ? <> · <span className="text-amber-300">{result.note}</span></> : null}
              </span>
              <button
                onClick={copyResult}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10"
              >
                {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                {copied ? 'Đã copy' : 'Copy'}
              </button>
            </div>

            {/* Comments table */}
            {comments && (
              <div className="overflow-auto rounded-xl border border-white/10 max-h-[45vh]">
                <table className="w-full text-[11px] text-slate-300">
                  <thead className="bg-[#131417] text-slate-400 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Tác giả</th>
                      <th className="text-left px-2 py-1.5 font-medium">Nội dung</th>
                      <th className="text-right px-2 py-1.5 font-medium">Like</th>
                      <th className="text-left px-2 py-1.5 font-medium">Ngày</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comments.map((c, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="px-2 py-1.5 whitespace-nowrap text-cyan-300">{c.author}</td>
                        <td className="px-2 py-1.5">{c.text}</td>
                        <td className="px-2 py-1.5 text-right text-slate-400">{c.like_count}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{c.published || ''}</td>
                      </tr>
                    ))}
                    {!comments.length && (
                      <tr><td colSpan={4} className="px-2 py-3 text-center text-slate-500">Không có bình luận.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Batch list */}
            {batchResults && (
              <div className="overflow-auto rounded-xl border border-white/10 max-h-[45vh] divide-y divide-white/5">
                {batchResults.map((b, i) => (
                  <div key={i} className="px-3 py-2 text-[11px] flex items-center justify-between gap-2">
                    <span className="truncate text-slate-300 font-mono flex-1">{b.url}</span>
                    <span className={b.ok ? 'text-cyan-300' : 'text-rose-400'}>
                      {b.ok ? `${b.source} · ${b.data?.title || 'ok'}`.slice(0, 60) : b.error}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* JSON viewer (info / page / download) */}
            {!comments && !batchResults && (
              <pre className="flex-1 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] text-emerald-300 font-mono whitespace-pre-wrap max-h-[45vh]">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        )}

        <div className="pt-2 border-t border-white/5 flex justify-between items-center">
          <span className="text-[10px] text-slate-500 flex items-center gap-1">
            <Play size={10} /> Chỉ cào nội dung công khai — tôn trọng ToS/điều khoản của từng nền tảng.
          </span>
          <button onClick={onClose} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-medium">Đóng</button>
        </div>
      </div>
    </div>
  );
}
