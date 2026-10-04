import React, { useState, useRef, useEffect } from 'react';
import { Search, Play, Loader2, ArrowLeft, MonitorPlay, Clock, Eye, Sparkles, FileText, ChevronDown, ChevronUp , Subtitles, Download, AlertTriangle, ThumbsUp, ThumbsDown, Share2} from 'lucide-react';
import Hls from 'hls.js';
import { API_BASE } from '../config';

// Danh mục trending (tự động tải khi mở tab — không cần gõ từ khóa)
const CATEGORIES = ['nhạc trẻ 2026', 'viral', 'phim chiếu rạp', 'bóng đá highlight', 'công nghệ mới', 'kiến thức hữu ích'];

function fmtDuration(sec) {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtViews(n) {
  if (!n) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}tr lượt xem`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k lượt xem`;
  return `${n} lượt xem`;
}

// Render markdown tóm tắt (đơn giản: header, bullet, in đậm) thành JSX
function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split('\n');
  const elements = [];
  let list = [];
  const flushList = (key) => {
    if (list.length) {
      elements.push(
        <ul key={key} className="space-y-1.5 my-2">
          {list.map((li, i) => (
            <li key={i} className="flex gap-2 text-[12px] text-slate-300 leading-relaxed">
              <span className="text-red-400 mt-1 shrink-0">▸</span>
              <span>{li}</span>
            </li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) { flushList('ul' + idx); return; }
    if (line.startsWith('### ')) {
      flushList('ul' + idx);
      elements.push(<h4 key={idx} className="text-[12px] font-bold text-white mt-3 mb-1">{line.slice(4)}</h4>);
    } else if (line.startsWith('## ')) {
      flushList('ul' + idx);
      elements.push(<h3 key={idx} className="text-[13px] font-extrabold text-red-300 mt-4 mb-1">{line.slice(3)}</h3>);
    } else if (line.startsWith('# ')) {
      flushList('ul' + idx);
      elements.push(<h2 key={idx} className="text-[15px] font-extrabold text-white mt-1 mb-2">{line.slice(2)}</h2>);
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      list.push(line.replace(/^[-•]\s*/, ''));
    } else if (/^\d+\.\s/.test(line)) {
      flushList('ul' + idx);
      elements.push(<p key={idx} className="text-[12px] text-slate-300 leading-relaxed my-1">{line}</p>);
    } else {
      flushList('ul' + idx);
      elements.push(<p key={idx} className="text-[12px] text-slate-300 leading-relaxed my-1">{line}</p>);
    }
  });
  flushList('ul-final');
  return elements;
}

export default function YouTubeTab({ API_BASE: _api, authToken, showToast }) {
  const [query, setQuery] = useState('');
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // video đang xem
  const [streamLoading, setStreamLoading] = useState(false);
  const [isHlsStream, setIsHlsStream] = useState(false); // stream_url là m3u (Chromium cần hls.js)
  const [activeCat, setActiveCat] = useState(null);
  // Tóm tắt AI
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState(null); // { title, transcript, summary }
  const [summaryStep, setSummaryStep] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [showSrt, setShowSrt] = useState(false);
  const [liked, setLiked] = useState(false); // nút Thích cục bộ (không cần server)
  const [descOpen, setDescOpen] = useState(false); // mở rộng mô tả
  const videoRef = useRef(null);
  const [engineReady, setEngineReady] = useState(null);
  const [engineNote, setEngineNote] = useState('');

  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('rexi_token');
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  const handleSearch = async (e, preset) => {
    e?.preventDefault?.();
    const q = (preset !== undefined ? preset : query).trim();
    if (!q) return;
    if (preset !== undefined) setQuery(preset);
    setLoading(true);
    setError(null);
    setSelected(null);
    setSummary(null);
    try {
      const res = await fetch(`${API_BASE}/services/youtube/search?q=${encodeURIComponent(q)}&limit=16`, { headers: headers() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Lỗi tìm kiếm');
      setVideos(data.videos || []);
      if ((data.videos || []).length === 0) setError('Không tìm thấy video nào.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCategory = (cat) => {
    setActiveCat(cat);
    handleSearch(null, cat);
  };

  // Tự động tải danh mục đầu tiên khi mở tab (thay cho màn hình trống)
  useEffect(() => {
    if (!activeCat && videos.length === 0) handleSearch(null, CATEGORIES[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/services/youtube/status?_=${Date.now()}`, { headers: headers(), cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        setEngineReady(!!(data.success && data.ready));
        setEngineNote(data.note || (data.success && !data.ready ? 'Engine yt-dlp chưa tải xong. Thử tải lại trang sau ít phút.' : ''));
      } catch {
        if (!cancelled) {
          // Lỗi thoáng chốc (Render restart / mạng) — tự thử lại thay vì khóa banner vĩnh viễn
          if (retries < 3) {
            retries += 1;
            setEngineNote(`Không kiểm tra được engine YouTube — tự thử lại (${retries}/3)...`);
            setTimeout(() => { if (!cancelled) check(); }, 4000);
            return;
          }
          setEngineReady(false);
          setEngineNote('Không kiểm tra được engine YouTube. Có thể cần đăng nhập.');
        }
      }
    };
    check();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Dò stream có phải HLS m3u không — worker có thể trả manifest khi video không có mp4 progressive.
  // Range 0-63: worker proxy forward Range nên chỉ tải 64 bytes, không kéo nguyên video.
  const probeHls = async (url) => {
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-63' } });
      const txt = await res.text();
      return txt.trimStart().startsWith('#EXTM3U');
    } catch {
      return false;
    }
  };

  const handlePlay = async (video) => {
    setSelected(video);
    setStreamLoading(true);
    setError(null);
    setSummary(null);
    setIsHlsStream(false);
    try {
      const res = await fetch(`${API_BASE}/services/youtube/stream?url=${encodeURIComponent(video.id)}`, { headers: headers() });
      // 4/10: proxy/Vercel có thể trả non-JSON (vd 502 "An error occurred...") khi
      // upstream quá lâu — đọc text trước, parse thủ công để báo lỗi thân thiện.
      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Server phản hồi không hợp lệ (HTTP ${res.status}). Thử bấm phát lại sau ít giây.`);
      }
      if (!data.success) throw new Error(data.error || 'Không phát được video');
      setSelected((prev) => ({ ...prev, stream_url: data.stream_url, description: data.description }));
      setStreamLoading(false);
      const _tok = (() => { try { return localStorage.getItem('rexi_token') || ''; } catch { return ''; } })();
      const pUrl = `${API_BASE}/services/youtube/proxy?url=${encodeURIComponent(data.stream_url)}${_tok ? `&token=${encodeURIComponent(_tok)}` : ''}`;
      setIsHlsStream(await probeHls(pUrl));
    } catch (err) {
      setError('Lỗi phát video: ' + err.message);
      setStreamLoading(false);
    }
  };

  const handleSummarize = async () => {
    if (!selected || summarizing) return;
    setSummarizing(true);
    setSummary(null);
    setShowTranscript(false);
    setShowSrt(false);
    setSummaryStep('Đang tải audio từ video...');
    try {
      const res = await fetch(`${API_BASE}/services/youtube/summarize`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ url: selected.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Không tóm tắt được video');
      setSummary({ title: data.title || selected.title, transcript: data.transcript || '', summary: data.summary || '', srt: data.srt || '' });
      if (!data.summary) setError('Video không có lời thoại để tóm tắt.');
    } catch (err) {
      setError('Lỗi tóm tắt: ' + err.message);
    } finally {
      setSummarizing(false);
      setSummaryStep('');
    }
  };

  const handleBack = () => {
    if (videoRef.current) { try { videoRef.current.pause(); videoRef.current.removeAttribute('src'); videoRef.current.load(); } catch (e) { console.warn('[rexi] video cleanup failed', e); } }
    setIsHlsStream(false);
    setSelected(null);
    setSummary(null);
    setShowTranscript(false);
    setShowSrt(false);
  };

  const downloadSrt = () => {
    if (!summary?.srt) return;
    const a = document.createElement('a');
    a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(summary.srt);
    a.download = `${(selected?.title || 'youtube').replace(/[^\w\d]+/g, '_').slice(0, 60)}.srt`;
    a.click();
  };

  // Dùng proxy backend để tránh CORS
  // P2-19d: proxy yêu cầu auth — <video> không gửi header nên kèm token qua ?token=
  const _ytToken = (() => { try { return localStorage.getItem('rexi_token') || ''; } catch { return ''; } })();
  const proxyUrl = selected?.stream_url
    ? `${API_BASE}/services/youtube/proxy?url=${encodeURIComponent(selected.stream_url)}${_ytToken ? `&token=${encodeURIComponent(_ytToken)}` : ''}`
    : '';

  // Chia sẻ: copy link YouTube gốc
  const shareVideo = async () => {
    if (!selected) return;
    const url = `https://www.youtube.com/watch?v=${selected.id}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast?.('Đã copy link video!');
    } catch {
      showToast?.(url);
    }
  };

  // HLS m3u: Chromium không chơi trực tiếp — gắn hls.js (như IPTV)
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isHlsStream || !proxyUrl) return undefined;
    let hls = null;
    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: false });
      hls.loadSource(proxyUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.ERROR, (evt, data) => {
        if (data.fatal) setError('Luồng HLS lỗi. Thử video khác.');
      });
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = proxyUrl; // Safari native HLS
    } else {
      setError('Trình duyệt không hỗ trợ luồng HLS.');
    }
    return () => { if (hls) { try { hls.destroy(); } catch (e) { console.warn('[rexi] hls cleanup failed', e); } } };
  }, [isHlsStream, proxyUrl]);

  return (
    <div className="flex flex-col h-full w-full bg-[#0d0e11] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#181920] border-b border-white/5 shrink-0">
        <span className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-500/30 flex items-center justify-center shrink-0">
          <MonitorPlay size={16} className="text-red-400" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-white">YouTube Free</p>
          <p className="text-[10px] text-emerald-400/80">Không quảng cáo · Không đăng nhập · Không theo dõi</p>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-red-600/15 border border-red-500/25 text-[9px] font-semibold text-red-300 shrink-0">
          + Tóm tắt AI
        </span>
      </div>

      {engineReady === false && (
        <div className="mx-4 mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5 shrink-0">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold mb-0.5">YouTube chưa sẵn sàng trên server</p>
            <p className="text-amber-300/80">{engineNote || 'Engine yt-dlp chưa tải xong. Thử tải lại trang sau ít phút.'}</p>
          </div>
        </div>
      )}

      {engineReady !== false && (
      <div id="yt-scroll" className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {!selected ? (
          <>
            {/* Search Box */}
            <form onSubmit={handleSearch} className="max-w-2xl mx-auto">
              <div className="flex items-center gap-2 bg-[#181920] border border-white/10 focus-within:border-red-500/40 rounded-2xl px-4 py-2.5 shadow-xl transition-colors">
                <Search size={16} className="text-slate-500 shrink-0" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm video, nhạc, phim, bài giảng... (không quảng cáo)"
                  className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none"
                />
                <button
                  type="submit"
                  disabled={loading || !query.trim()}
                  className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0"
                >
                  {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                  {loading ? 'Đang tìm...' : 'Tìm'}
                </button>
              </div>

              {/* Danh mục trending */}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleCategory(c)}
                    className={`px-2.5 py-1 rounded-full border text-[10px] transition-all ${
                      activeCat === c
                        ? 'bg-red-600/20 border-red-500/40 text-red-300 font-semibold'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10 hover:border-red-500/30'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </form>

            {error && (
              <div className="max-w-2xl mx-auto mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {error}
              </div>
            )}

            {/* Video Grid — kiểu YouTube: card không viền, avatar kênh tròn */}
            {loading && videos.length === 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-6 max-w-[1600px] mx-auto mt-5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="aspect-video rounded-xl bg-white/10" />
                    <div className="flex gap-2.5 mt-2.5">
                      <div className="w-9 h-9 rounded-full bg-white/10 shrink-0" />
                      <div className="flex-1 space-y-2 pt-0.5">
                        <div className="h-3 rounded bg-white/10 w-11/12" />
                        <div className="h-3 rounded bg-white/10 w-2/3" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {videos.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-6 max-w-[1600px] mx-auto mt-5">
                {videos.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => handlePlay(v)}
                    className="group text-left"
                  >
                    <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
                      {v.thumb ? (
                        <img src={v.thumb} alt={v.title} className="w-full h-full object-cover group-hover:scale-105 group-hover:rounded-none transition-all duration-300" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-red-900/40 to-[#181920]">
                          <Play size={28} className="text-slate-600" />
                        </div>
                      )}
                      <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[11px] font-medium text-white">
                        {fmtDuration(v.duration)}
                      </span>
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity">
                        <span className="w-11 h-11 rounded-full bg-black/70 flex items-center justify-center">
                          <Play size={18} className="text-white ml-0.5" fill="currentColor" />
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2.5 mt-2.5">
                      <span className="w-9 h-9 rounded-full bg-gradient-to-tr from-red-600 to-rose-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
                        {(v.author || 'Y').trim().charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-100 line-clamp-2 leading-snug">{v.title}</p>
                        <p className="text-xs text-slate-400 mt-1 truncate">{v.author}</p>
                        <p className="text-xs text-slate-400">
                          {v.views > 0 ? fmtViews(v.views) : ''}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!loading && videos.length === 0 && !error && (
              <div className="max-w-2xl mx-auto mt-10 text-center">
                <MonitorPlay size={44} className="mx-auto text-slate-700" />
                <p className="text-sm text-slate-500 mt-3 font-medium">Xem YouTube không quảng cáo, hoàn toàn miễn phí</p>
                <p className="text-[11px] text-slate-600 mt-1">Gõ từ khóa ở trên để bắt đầu. Dùng chính backend yt-dlp — không ads, không tracking.</p>
              </div>
            )}
          </>
        ) : (
          /* Player View — kiểu trang xem YouTube: cột chính + Up tiếp theo */
          <div className="max-w-[1700px] mx-auto flex flex-col lg:flex-row gap-5">
          <div className="flex-1 min-w-0">
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-3 transition-colors"
            >
              <ArrowLeft size={14} /> Quay lại kết quả
            </button>

            <div className="aspect-video bg-black rounded-xl overflow-hidden border border-white/10 shadow-2xl">
              {streamLoading ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                  <Loader2 size={28} className="text-red-400 animate-spin" />
                  <p className="text-xs text-slate-400">Đang lấy luồng video...</p>
                </div>
              ) : proxyUrl ? (
                <video
                  ref={videoRef}
                  src={isHlsStream ? undefined : proxyUrl}
                  controls
                  autoPlay
                  playsInline
                  className="w-full h-full bg-black"
                  onError={() => { if (!isHlsStream) setError('Không phát được video qua proxy. Thử video khác.'); }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <p className="text-xs text-slate-500">Đang chuẩn bị phát...</p>
                </div>
              )}
            </div>

            {error && selected && (
              <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {error}
              </div>
            )}

            <h2 className="text-base font-bold text-white mt-3 leading-snug">{selected.title}</h2>
            {/* Info line kiểu YouTube: views • thời lượng ngay dưới title (fmtViews đã kèm "lượt xem") */}
            <p className="text-xs text-slate-400 mt-1">
              {selected.views > 0 ? fmtViews(selected.views) : ''}
              {selected.duration ? `${selected.views > 0 ? ' • ' : ''}${fmtDuration(selected.duration)}` : ''}
            </p>
            {/* Hàng kênh + hành động kiểu YouTube */}
            <div className="flex flex-wrap items-center gap-3 mt-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-10 h-10 rounded-full bg-gradient-to-tr from-red-600 to-rose-500 flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {(selected.author || 'Y').trim().charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{selected.author}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={handleSummarize}
                  disabled={summarizing}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-xs font-bold shadow transition-all"
                >
                  {summarizing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {summarizing ? 'Đang tóm tắt...' : 'Tóm tắt AI'}
                </button>
                {/* Like/dislike ghép 1 pill kiểu YouTube */}
                <div className="flex items-center rounded-full bg-white/10 overflow-hidden">
                  <button
                    onClick={() => setLiked(!liked)}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-all border-r border-white/10 ${liked ? 'text-black bg-white' : 'text-white hover:bg-white/10'}`}
                  >
                    <ThumbsUp size={13} fill={liked ? 'currentColor' : 'none'} /> Thích
                  </button>
                  <button className="px-3.5 py-2 text-white hover:bg-white/10 transition-all" title="Không thích">
                    <ThumbsDown size={13} />
                  </button>
                </div>
                <button
                  onClick={shareVideo}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-all"
                >
                  <Share2 size={13} /> Chia sẻ
                </button>
              </div>
            </div>
            {summarizing && summaryStep && (
              <p className="text-[11px] text-slate-400 animate-pulse mt-2">{summaryStep}</p>
            )}
            {/* Hộp mô tả kiểu YouTube — bấm để mở rộng */}
            {selected.description && (
              <div
                className="mt-3 p-3 rounded-xl bg-white/5 hover:bg-white/[0.08] cursor-pointer transition-colors"
                onClick={() => setDescOpen(!descOpen)}
              >
                <p className={`text-xs text-slate-300 leading-relaxed whitespace-pre-wrap ${descOpen ? '' : 'line-clamp-2'}`}>
                  {selected.description}
                </p>
                <p className="text-[11px] text-slate-500 mt-1 font-semibold">{descOpen ? 'Ẩn bớt' : '...xem thêm'}</p>
              </div>
            )}

              {/* Kết quả tóm tắt */}
              {summary && summary.summary && (
                <div className="mt-4 rounded-2xl bg-[#181920] border border-red-500/20 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-red-600/15 to-rose-600/10 border-b border-white/5">
                    <Sparkles size={14} className="text-red-400" />
                    <span className="text-[11px] font-bold text-white flex-1">Tóm tắt AI — {summary.title}</span>
                    {summary.transcript && (
                      <button
                        onClick={() => setShowTranscript(!showTranscript)}
                        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white transition-colors"
                      >
                        <FileText size={11} />
                        {showTranscript ? 'Ẩn transcript' : 'Xem transcript'}
                        {showTranscript ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </button>
                    )}
                    {summary.srt && (
                      <>
                        <button
                          onClick={() => setShowSrt(!showSrt)}
                          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white transition-colors"
                        >
                          <Subtitles size={11} />
                          {showSrt ? 'Ẩn phụ đề' : 'Xem phụ đề'}
                          {showSrt ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        </button>
                        <button
                          onClick={downloadSrt}
                          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white transition-colors"
                          title="Tải file .srt"
                        >
                          <Download size={11} /> SRT
                        </button>
                      </>
                    )}
                  </div>
                  <div className="px-4 py-3 max-h-80 overflow-y-auto">
                    {renderMarkdown(summary.summary)}
                    {showTranscript && summary.transcript && (
                      <div className="mt-3 pt-3 border-t border-white/5">
                        <p className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">Transcript</p>
                        <p className="text-[11px] text-slate-400 leading-relaxed">{summary.transcript}</p>
                      </div>
                    )}
                    {showSrt && summary.srt && (
                      <div className="mt-3 pt-3 border-t border-white/5">
                        <p className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">Phụ đề SRT (timestamp)</p>
                        <pre className="text-[10px] text-slate-500 font-mono leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">{summary.srt}</pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {/* Cột Up tiếp theo kiểu YouTube */}
            <aside className="w-full lg:w-[360px] shrink-0">
              <p className="text-sm font-bold text-white mb-2.5">Up tiếp theo</p>
              <div className="flex flex-col gap-2.5">
                {videos.filter((v) => v.id !== selected?.id).map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setLiked(false);
                      setDescOpen(false);
                      handlePlay(v);
                      document.getElementById('yt-scroll')?.scrollTo({ top: 0 });
                    }}
                    className="group flex gap-2 text-left"
                  >
                    <div className="relative w-40 shrink-0 aspect-video rounded-lg overflow-hidden bg-black">
                      {v.thumb ? (
                        <img src={v.thumb} alt={v.title} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-red-900/40 to-[#181920]">
                          <Play size={20} className="text-slate-600" />
                        </div>
                      )}
                      <span className="absolute bottom-1 right-1 px-1 py-px rounded bg-black/80 text-[10px] font-medium text-white">
                        {fmtDuration(v.duration)}
                      </span>
                    </div>
                    <div className="min-w-0 py-0.5">
                      <p className="text-xs font-semibold text-slate-100 line-clamp-2 leading-snug">{v.title}</p>
                      <p className="text-[11px] text-slate-400 mt-1 truncate">{v.author}</p>
                      <p className="text-[11px] text-slate-400">{v.views > 0 ? fmtViews(v.views) : ''}</p>
                    </div>
                  </button>
                ))}
              </div>
            </aside>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
