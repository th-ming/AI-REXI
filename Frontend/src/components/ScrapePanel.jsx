import React, { useState, useEffect } from 'react';
import { X, Download, Copy, Check, Loader2, Link2, FileText, MessageSquare, Layers, AlertTriangle, Play, Tv, Database, Upload, Search } from 'lucide-react';
import { API_BASE } from '../config';

/**
 * ScrapePanel — "Cào dữ liệu" (Data Scraper Kit). ADDITIVE.
 * Trích xuất info / nội dung / bình luận / media từ link (YouTube, TikTok, Instagram,
 * X, Facebook... qua yt-dlp worker; + web thường). Modal dark card + cyan accent.
 *
 * Tabs: "Cào link" (cũ) · "Kênh / Hôm nay" (list video kênh/playlist) · "RAG" (nạp + hỏi RAG).
 */
export default function ScrapePanel({ open, onClose, token }) {
  const [tab, setTab] = useState('link');

  // ── Tab "Cào link" (giữ nguyên) ──
  const [input, setInput] = useState('');
  const [maxComments, setMaxComments] = useState(30);
  const [loading, setLoading] = useState('');
  const [result, setResult] = useState(null);
  const [meta, setMeta] = useState(null); // { action, source, count }
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const [copied, setCopied] = useState(false);

  // ── Tab "Kênh / Hôm nay" ──
  const [channelUrl, setChannelUrl] = useState('');
  const [channelLimit, setChannelLimit] = useState(20);
  const [onlyToday, setOnlyToday] = useState(false);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelResult, setChannelResult] = useState(null);
  const [channelError, setChannelError] = useState('');

  // ── Tab "Tìm kiếm" ──
  const [searchQ, setSearchQ] = useState('');
  const [searchPlatform, setSearchPlatform] = useState('web');
  const [searchLimit, setSearchLimit] = useState(10);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [searchMsg, setSearchMsg] = useState('');
  const [searchRow, setSearchRow] = useState('');

  // ── Tab "RAG" ──
  const [ragQuestion, setRagQuestion] = useState('');
  const [ragSource, setRagSource] = useState('');
  const [ragLoading, setRagLoading] = useState('');
  const [ragAsk, setRagAsk] = useState(null);
  const [ragMsg, setRagMsg] = useState('');
  const [ragError, setRagError] = useState('');

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

  const runChannel = async () => {
    if (channelLoading) return;
    setChannelError('');
    setChannelResult(null);
    if (!channelUrl.trim()) { setChannelError('Dán link kênh/playlist (bắt đầu bằng http).'); return; }
    setChannelLoading(true);
    try {
      const res = await fetch(`${API_BASE}/scrape/channel`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ url: channelUrl.trim(), limit: Number(channelLimit) || 20, today: onlyToday }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      setChannelResult(data);
    } catch (e) {
      setChannelError(e.message || 'Lỗi không xác định.');
    } finally {
      setChannelLoading(false);
    }
  };

  const runSearch = async () => {
    if (searchLoading) return;
    setSearchError(''); setSearchResult(null); setSearchMsg('');
    if (!searchQ.trim()) { setSearchError('Nhập từ khoá tìm kiếm.'); return; }
    setSearchLoading(true);
    try {
      const res = await fetch(`${API_BASE}/scrape/search`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ q: searchQ.trim(), platform: searchPlatform, limit: Number(searchLimit) || 10 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      setSearchResult(data);
    } catch (e) {
      setSearchError(e.message || 'Lỗi không xác định.');
    } finally {
      setSearchLoading(false);
    }
  };

  const scrapeChannelFromSearch = async (r) => {
    setSearchError(''); setSearchMsg(''); setSearchRow(`ch:${r.url}`);
    try {
      const res = await fetch(`${API_BASE}/scrape/channel`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ url: r.url, limit: Number(channelLimit) || 20 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      setSearchMsg(`Đã cào kênh: ${data.count} video · ${data.platform || ''}`);
    } catch (e) {
      setSearchError(e.message || 'Lỗi cào kênh.');
    } finally {
      setSearchRow('');
    }
  };

  const ingestSearch = async (r) => {
    setSearchError(''); setSearchMsg(''); setSearchRow(`rag:${r.url}`);
    try {
      const res = await fetch(`${API_BASE}/scrape/ingest`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          source: `search:${r.platform || 'web'}:${r.url}`,
          title: r.title || r.url,
          text: [r.title && `# ${r.title}`, r.url && `Link: ${r.url}`, r.snippet].filter(Boolean).join('\n'),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      setSearchMsg(`Đã nạp vào RAG: ${data.chunks} chunk · doc ${String(data.doc_id).slice(0, 8)}…`);
    } catch (e) {
      setSearchError(e.message || 'Lỗi nạp RAG.');
    } finally {
      setSearchRow('');
    }
  };

  // Kết quả "mới nhất có thể nạp" — ưu tiên kênh, rồi link.
  const ingestible = () => {
    if (channelResult && Array.isArray(channelResult.items)) {
      return {
        source: `channel:${channelResult.platform || 'site'}:${channelUrl.trim().slice(0, 60)}`,
        title: `Kênh ${channelUrl.trim().slice(0, 80)}${onlyToday ? ' (hôm nay)' : ''}`,
        items: channelResult.items,
      };
    }
    if (!result) return null;
    const a = meta?.action;
    if (a === 'comments' && Array.isArray(result.data)) {
      const text = result.data.map((c) => `[${c.author}] ${c.text}`).join('\n');
      return { source: `comments:${firstUrl().slice(0, 60)}`, title: `Bình luận ${firstUrl().slice(0, 80)}`, text };
    }
    if (a === 'batch' && Array.isArray(result.results)) {
      return {
        source: `batch:${urlList().length} urls`,
        title: `Hàng loạt (${result.results.length})`,
        items: result.results.map((r) => ({ title: r.data?.title || r.url, url: r.url, description: r.data?.description })),
      };
    }
    const d = result.data || {};
    const text = [d.title && `# ${d.title}`, d.uploader && `Kênh: ${d.uploader}`, d.description, d.text].filter(Boolean).join('\n');
    if (!text || text.trim().length < 10) return null;
    return { source: `${a || 'scrape'}:${firstUrl().slice(0, 60)}`, title: d.title || firstUrl().slice(0, 80), text };
  };

  const ingestToRag = async () => {
    if (ragLoading) return;
    setRagError(''); setRagMsg(''); setRagAsk(null);
    const payload = ingestible();
    if (!payload) { setRagError('Chưa có kết quả để nạp — hãy cào link hoặc kênh trước.'); return; }
    setRagLoading('ingest');
    try {
      const res = await fetch(`${API_BASE}/scrape/ingest`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      setRagMsg(`Đã nạp vào RAG: ${data.chunks} chunk · doc ${String(data.doc_id).slice(0, 8)}… (nguồn: ${data.source})`);
      if (!ragSource) setRagSource(String(data.source || '').slice(0, 60));
    } catch (e) {
      setRagError(e.message || 'Lỗi không xác định.');
    } finally {
      setRagLoading('');
    }
  };

  const askRag = async () => {
    if (ragLoading) return;
    setRagError(''); setRagMsg(''); setRagAsk(null);
    if (!ragQuestion.trim()) { setRagError('Nhập câu hỏi.'); return; }
    setRagLoading('ask');
    try {
      const body = { question: ragQuestion.trim() };
      if (ragSource.trim()) body.source = ragSource.trim();
      const res = await fetch(`${API_BASE}/scrape/ask`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      setRagAsk(data);
    } catch (e) {
      setRagError(e.message || 'Lỗi không xác định.');
    } finally {
      setRagLoading('');
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

  const Tab = ({ id, icon, label }) => (
    <button
      onClick={() => setTab(id)}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors border-b-2 ${tab === id ? 'text-cyan-300 border-cyan-400 bg-white/5' : 'text-slate-400 border-transparent hover:text-slate-200'}`}
    >
      {icon}{label}
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

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-white/5">
          <Tab id="link" icon={<Link2 size={13} />} label="Cào link" />
          <Tab id="search" icon={<Search size={13} />} label="Tìm kiếm" />
          <Tab id="channel" icon={<Tv size={13} />} label="Kênh / Hôm nay" />
          <Tab id="rag" icon={<Database size={13} />} label="RAG" />
        </div>

        {/* ─────────── TAB: CÀO LINK ─────────── */}
        {tab === 'link' && (
          <>
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

            <div className="flex flex-wrap gap-2">
              <Btn action="info" icon={<FileText size={13} />} label="Lấy thông tin" accent="bg-cyan-600 hover:bg-cyan-500" />
              <Btn action="page" icon={<FileText size={13} />} label="Cào nội dung" accent="bg-sky-600 hover:bg-sky-500" />
              <Btn action="comments" icon={<MessageSquare size={13} />} label="Lấy bình luận" accent="bg-indigo-600 hover:bg-indigo-500" />
              <Btn action="batch" icon={<Layers size={13} />} label="Hàng loạt" accent="bg-violet-600 hover:bg-violet-500" />
              <Btn action="download" icon={<Download size={13} />} label="Link tải" accent="bg-teal-600 hover:bg-teal-500" />
            </div>

            {error && (
              <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

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

                {!comments && !batchResults && (
                  <pre className="flex-1 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] text-emerald-300 font-mono whitespace-pre-wrap max-h-[45vh]">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </>
        )}

        {/* ─────────── TAB: TÌM KIẾM ─────────── */}
        {tab === 'search' && (
          <>
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                <Search size={12} className="text-cyan-400" /> Tìm kênh / từ khoá (Web · YouTube · TikTok)
              </label>
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                placeholder="vd: rexi game, @kenh, chủ đề..."
                className="w-full bg-[#131417] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/40"
              />
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
                <span className="flex items-center gap-2">
                  Nền tảng:
                  <select
                    value={searchPlatform}
                    onChange={(e) => setSearchPlatform(e.target.value)}
                    className="bg-[#131417] border border-white/10 rounded-lg px-2 py-0.5 text-slate-200 outline-none"
                  >
                    <option value="web">Web</option>
                    <option value="youtube">YouTube</option>
                    <option value="tiktok">TikTok</option>
                  </select>
                </span>
                <span className="flex items-center gap-2">
                  Số kết quả:
                  <input
                    type="number" min={1} max={25} value={searchLimit}
                    onChange={(e) => setSearchLimit(e.target.value)}
                    className="w-16 bg-[#131417] border border-white/10 rounded-lg px-2 py-0.5 text-slate-200 outline-none"
                  />
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={runSearch}
                disabled={searchLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50"
              >
                {searchLoading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                Tìm kiếm
              </button>
            </div>

            {searchError && (
              <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>{searchError}</span>
              </div>
            )}
            {searchMsg && (
              <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">{searchMsg}</div>
            )}

            {searchResult && (
              <div className="flex-1 min-h-0 flex flex-col gap-2">
                <span className="text-[11px] text-slate-400">
                  Nền tảng: <span className="text-cyan-300 font-mono">{searchResult.platform}</span> · nguồn{' '}
                  <span className="text-cyan-300 font-mono">{searchResult.source}</span> · <span className="text-slate-300">{searchResult.count}</span> kết quả
                </span>
                <div className="overflow-auto rounded-xl border border-white/10 max-h-[45vh]">
                  <table className="w-full text-[11px] text-slate-300">
                    <thead className="bg-[#131417] text-slate-400 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-medium">Tiêu đề</th>
                        <th className="text-left px-2 py-1.5 font-medium">Link</th>
                        <th className="text-left px-2 py-1.5 font-medium">Nền tảng</th>
                        <th className="text-right px-2 py-1.5 font-medium">Hành động</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(searchResult.results || []).map((r, i) => (
                        <tr key={i} className="border-t border-white/5">
                          <td className="px-2 py-1.5">
                            <div className="text-slate-200">{r.title || '—'}</div>
                            {r.snippet ? <div className="text-[10px] text-slate-500 line-clamp-2">{r.snippet}</div> : null}
                          </td>
                          <td className="px-2 py-1.5 max-w-[220px]">
                            <a href={r.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline font-mono break-all">{r.url}</a>
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-slate-400">{r.platform || ''}</td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap">
                            <button
                              onClick={() => scrapeChannelFromSearch(r)}
                              disabled={!!searchRow}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-white bg-teal-600 hover:bg-teal-500 disabled:opacity-50"
                            >
                              {searchRow === `ch:${r.url}` ? <Loader2 size={10} className="animate-spin" /> : <Tv size={10} />}
                              Cào kênh này
                            </button>
                            <button
                              onClick={() => ingestSearch(r)}
                              disabled={!!searchRow}
                              className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                            >
                              {searchRow === `rag:${r.url}` ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                              Nạp RAG
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!(searchResult.results || []).length && (
                        <tr><td colSpan={4} className="px-2 py-3 text-center text-slate-500">Không có kết quả.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ─────────── TAB: KÊNH / HÔM NAY ─────────── */}
        {tab === 'channel' && (
          <>
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                <Tv size={12} className="text-cyan-400" /> Link kênh / playlist (YouTube tốt nhất — site khác best-effort)
              </label>
              <input
                value={channelUrl}
                onChange={(e) => setChannelUrl(e.target.value)}
                placeholder="https://www.youtube.com/@channelname  hoặc  /channel/UC..."
                className="w-full bg-[#131417] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/40 font-mono"
              />
              <div className="flex items-center gap-4 text-[11px] text-slate-400">
                <span className="flex items-center gap-2">
                  Số video:
                  <input
                    type="number" min={1} max={100} value={channelLimit}
                    onChange={(e) => setChannelLimit(e.target.value)}
                    className="w-16 bg-[#131417] border border-white/10 rounded-lg px-2 py-0.5 text-slate-200 outline-none"
                  />
                </span>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={onlyToday} onChange={(e) => setOnlyToday(e.target.checked)} className="accent-cyan-500" />
                  Chỉ video đăng hôm nay
                </label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={runChannel}
                disabled={channelLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50"
              >
                {channelLoading ? <Loader2 size={13} className="animate-spin" /> : <Tv size={13} />}
                Liệt kê video
              </button>
            </div>

            {channelError && (
              <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>{channelError}</span>
              </div>
            )}

            {channelResult && (
              <div className="flex-1 min-h-0 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">
                    Nguồn: <span className="text-cyan-300 font-mono">{channelResult.platform || '—'}</span> · <span className="text-slate-300">{channelResult.count}</span> video
                    {channelResult.today_filtered ? <span className="text-amber-300"> · chỉ hôm nay</span> : null}
                  </span>
                </div>
                <div className="overflow-auto rounded-xl border border-white/10 max-h-[45vh]">
                  <table className="w-full text-[11px] text-slate-300">
                    <thead className="bg-[#131417] text-slate-400 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-medium">Tiêu đề</th>
                        <th className="text-left px-2 py-1.5 font-medium">Kênh</th>
                        <th className="text-left px-2 py-1.5 font-medium">Ngày</th>
                        <th className="text-right px-2 py-1.5 font-medium">Views</th>
                      </tr>
                    </thead>
                    <tbody>
                      {channelResult.items.map((it, i) => (
                        <tr key={i} className="border-t border-white/5">
                          <td className="px-2 py-1.5">
                            {it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">{it.title || it.url}</a> : (it.title || '—')}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-slate-400">{it.uploader || ''}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{it.published || ''}</td>
                          <td className="px-2 py-1.5 text-right text-slate-400">{it.view_count != null ? it.view_count : ''}</td>
                        </tr>
                      ))}
                      {!channelResult.items.length && (
                        <tr><td colSpan={4} className="px-2 py-3 text-center text-slate-500">Không có video.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ─────────── TAB: RAG ─────────── */}
        {tab === 'rag' && (
          <>
            <p className="text-[11px] text-slate-400">
              Nạp kết quả cào (link/kênh) vào RAG đang có của app → chat trả lời dựa trên dữ liệu này mà
              chỉ dùng vài chunk liên quan (tiết kiệm token). Đăng nhập để RAG vào đúng tài khoản của bạn.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={ingestToRag}
                disabled={!!ragLoading || !ingestible()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                title={ingestible() ? 'Nạp kết quả gần nhất' : 'Cào link/kênh trước'}
              >
                {ragLoading === 'ingest' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Nạp kết quả vào RAG {ingestible() ? '' : '(chưa có kết quả)'}
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                <Database size={12} className="text-cyan-400" /> Hỏi từ RAG
              </label>
              <input
                value={ragQuestion}
                onChange={(e) => setRagQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') askRag(); }}
                placeholder="Hỏi về dữ liệu vừa nạp…"
                className="w-full bg-[#131417] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/40"
              />
              <div className="flex items-center gap-2">
                <input
                  value={ragSource}
                  onChange={(e) => setRagSource(e.target.value)}
                  placeholder="Lọc theo nguồn (tuỳ chọn)"
                  className="flex-1 bg-[#131417] border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 placeholder-slate-500 outline-none"
                />
                <button
                  onClick={askRag}
                  disabled={!!ragLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50"
                >
                  {ragLoading === 'ask' ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />}
                  Hỏi
                </button>
              </div>
            </div>

            {ragError && (
              <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>{ragError}</span>
              </div>
            )}
            {ragMsg && (
              <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">{ragMsg}</div>
            )}

            {ragAsk && (
              <div className="flex-1 min-h-0 flex flex-col gap-2">
                <span className="text-[11px] text-slate-400">Chunk liên quan: <span className="text-slate-300">{ragAsk.count}</span></span>
                <div className="overflow-auto rounded-xl border border-white/10 divide-y divide-white/5 max-h-[45vh]">
                  {(ragAsk.chunks || []).map((c, i) => (
                    <div key={i} className="px-3 py-2 text-[11px]">
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span className="font-mono truncate">{c.doc}</span>
                        <span className="text-cyan-400">score {c.score}</span>
                      </div>
                      <div className="text-slate-300 whitespace-pre-wrap mt-1">{c.text}</div>
                    </div>
                  ))}
                  {!(ragAsk.chunks || []).length && (
                    <div className="px-3 py-3 text-center text-slate-500 text-[11px]">Không tìm thấy chunk liên quan.</div>
                  )}
                </div>
              </div>
            )}
          </>
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
