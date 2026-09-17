import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Download, Volume2, Mic, RotateCw, Loader2, Clock, Type, Hash, User, MapPin } from 'lucide-react';

const VN_VOICES = [
  { id: 'vi-VN-HoaiMyNeural', label: 'Hoài Mỹ', gender: 'Nữ', region: 'Bắc', color: 'rose' },
  { id: 'vi-VN-NamMinhNeural', label: 'Nam Minh', gender: 'Nam', region: 'Nam', color: 'blue' },
  { id: 'vi-VN-DuyAnhNeural', label: 'Duy Anh', gender: 'Nam', region: 'Bắc', color: 'cyan' },
  { id: 'vi-VN-HaSanhNeural', label: 'Đà Sanh', gender: 'Nữ', region: 'Nam', color: 'violet' },
  { id: 'vi-VN-MinhAnhNeural', label: 'Minh Anh', gender: 'Nữ', region: 'Bắc', color: 'pink' },
  { id: 'vi-VN-ThuyMinhNeural', label: 'Thùy Minh', gender: 'Nữ', region: 'Nam', color: 'teal' },
  { id: 'vi-VN-ThiTuyetNeural', label: 'Thị Tuyết', gender: 'Nữ', region: 'Bắc', color: 'amber' },
  { id: 'vi-VN-VanHanhNeural', label: 'Vân Hân', gender: 'Nữ', region: 'Nam', color: 'emerald' },
  { id: 'vi-VN-VanMinhNeural', label: 'Văn Minh', gender: 'Nam', region: 'Bắc', color: 'indigo' },
  { id: 'vi-VN-CaoVietNeural', label: 'Cao Việt', gender: 'Nam', region: 'Nam', color: 'orange' },
];

const QUICK_SAMPLES = [
  { label: 'Chào mừng', text: 'Xin chào, tôi là AI Rexi, trợ lý ảo thông minh của bạn.' },
  { label: 'Bản tin', text: 'Hôm nay thời tiết Hà Nội ổn định, nền kinh tế tăng trưởng 6.5% so với quý trước.' },
  { label: 'Giới thiệu', text: 'Dự án AI Rexi đang phát triển rất tốt với hơn 10 tính năng AI tích hợp.' },
  { label: 'Quảng cáo', text: 'Giảm giá sốc 50% tất cả sản phẩm! Chỉ còn 3 ngày, nhanh tay đặt hàng ngay!' },
];

const VOICE_COLORS = {
  rose: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-300', ring: 'ring-rose-500/40' },
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-300', ring: 'ring-blue-500/40' },
  cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-300', ring: 'ring-cyan-500/40' },
  violet: { bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-300', ring: 'ring-violet-500/40' },
  pink: { bg: 'bg-pink-500/10', border: 'border-pink-500/30', text: 'text-pink-300', ring: 'ring-pink-500/40' },
  teal: { bg: 'bg-teal-500/10', border: 'border-teal-500/30', text: 'text-teal-300', ring: 'ring-teal-500/40' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-300', ring: 'ring-amber-500/40' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-300', ring: 'ring-emerald-500/40' },
  indigo: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-300', ring: 'ring-indigo-500/40' },
  orange: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-300', ring: 'ring-orange-500/40' },
};

export default function StudioTab({ API_BASE, authToken, showToast }) {
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('vi-VN-HoaiMyNeural');
  const [rate, setRate] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [history, setHistory] = useState([]);
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(null);
  const audioRef = useRef(null);
  const previewAudioRef = useRef(null);
  const textareaRef = useRef(null);

  const selectedVoice = VN_VOICES.find(v => v.id === voice);

  const formatRate = (v) => v >= 0 ? `+${v}%` : `${v}%`;
  const formatPitch = (v) => v >= 0 ? `+${v}Hz` : `${v}Hz`;

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const estimatedSeconds = Math.ceil(wordCount * 0.4);

  const handlePreviewVoice = async (voiceId) => {
    if (previewingVoice === voiceId) {
      if (previewAudioRef.current) { previewAudioRef.current.pause(); }
      setPreviewingVoice(null);
      return;
    }
    setPreviewingVoice(voiceId);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_BASE}/services/tts`, {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify({ text: 'Xin chào, đây là giọng nói mẫu.', voice: voiceId, rate: '+0%', pitch: '+0Hz' }),
      });
      const data = await res.json();
      if (data.success && data.audio) {
        const url = 'data:audio/mp3;base64,' + data.audio;
        if (previewAudioRef.current) { previewAudioRef.current.pause(); }
        previewAudioRef.current = new Audio(url);
        previewAudioRef.current.onended = () => setPreviewingVoice(null);
        previewAudioRef.current.onerror = () => setPreviewingVoice(null);
        previewAudioRef.current.play();
      } else {
        setPreviewingVoice(null);
      }
    } catch { setPreviewingVoice(null); }
  };

  const handleGenerate = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setAudioUrl(null);
    setPlaying(false);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_BASE}/services/tts`, {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify({
          text: text.trim(),
          voice,
          rate: formatRate(rate),
          pitch: formatPitch(pitch),
        }),
      });
      const data = await res.json();
      if (data.success && data.audio) {
        const url = 'data:audio/mp3;base64,' + data.audio;
        setAudioUrl(url);
        setHistory(prev => [{
          text: text.trim().substring(0, 60),
          voice: selectedVoice?.label || voice,
          time: new Date().toLocaleTimeString('vi-VN'),
          url
        }, ...prev].slice(0, 10));
        showToast('Tạo audio thành công!', 'success');
      } else {
        showToast(data.error || 'TTS không khả dụng', 'error');
      }
    } catch (err) {
      showToast('Lỗi: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); } else { audioRef.current.play(); }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `rexi_tts_${Date.now()}.mp3`;
    a.click();
  };

  const playHistoryItem = (item) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setAudioUrl(item.url);
    setPlaying(false);
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onended = () => setPlaying(false);
      audioRef.current.onplay = () => setPlaying(true);
      audioRef.current.onpause = () => setPlaying(false);
    }
  }, [audioUrl]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleGenerate();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [text, voice, rate, pitch]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full w-full overflow-hidden bg-white">
      {/* Left Panel - Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
<div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
           <div className="flex items-center gap-3">
             <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
               <Volume2 size={18} className="text-white" />
             </div>
             <div>
               <h1 className="text-sm font-bold text-slate-800">TTS Studio</h1>
               <p className="text-[10px] text-slate-500">Chuyển văn bản thành giọng nói tiếng Việt</p>
             </div>
           </div>
           <div className="flex items-center gap-2">
             {history.length > 0 && (
               <button
                 onClick={() => setShowVoicePanel(!showVoicePanel)}
                 className={`md:hidden px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${showVoicePanel ? 'bg-cyan-50 text-cyan-600' : 'bg-slate-50 text-slate-600 hover:text-slate-700'}`}
               >
                 Lịch sử ({history.length})
               </button>
             )}
           </div>
         </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Text Input Section */}
<div className="space-y-3">
             <div className="flex items-center justify-between">
               <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                 <Type size={12} className="text-cyan-500" />
                 Nội dung văn bản
               </label>
              <div className="flex items-center gap-3 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><Hash size={10} />{charCount}/1000</span>
                <span className="flex items-center gap-1"><Type size={10} />{wordCount} từ</span>
                <span className="flex items-center gap-1"><Clock size={10} />~{estimatedSeconds}s</span>
              </div>
            </div>
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Nhập nội dung cần chuyển thành giọng nói..."
                className="w-full h-40 p-4 bg-[#12131a] border border-white/10 rounded-2xl text-sm text-slate-200 placeholder-slate-500 outline-none resize-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 transition-all font-sans leading-relaxed"
                maxLength={1000}
              />
            </div>

{/* Quick Samples */}
             <div className="flex gap-2 flex-wrap">
               {QUICK_SAMPLES.map((sample, i) => (
                 <button
                   key={i}
                   onClick={() => setText(sample.text)}
                   className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-[11px] text-slate-600 hover:text-cyan-600 hover:border-cyan-300 hover:bg-cyan-50 transition-all"
                 >
                   {sample.label}
                 </button>
               ))}
             </div>
          </div>

{/* Voice Selector - Compact Cards */}
           <div className="space-y-2">
             <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
               <Mic size={12} className="text-cyan-500" />
               Chọn giọng đọc
             </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
{VN_VOICES.map(v => {
                 const vc = VOICE_COLORS[v.color];
                 const isSelected = voice === v.id;
                 const isPreviewing = previewingVoice === v.id;
                 return (
                   <button
                     key={v.id}
                     onClick={() => setVoice(v.id)}
                     className={`relative p-3 rounded-xl text-left transition-all border group ${
                       isSelected
                         ? `${vc.bg} ${vc.border} ring-2 ${vc.ring}`
                         : 'bg-slate-50 border-slate-200 hover:border-slate-300 hover:bg-slate-100'
                     }`}
                   >
                     {isSelected && (
                       <span className={`absolute top-1.5 right-1.5 w-4 h-4 rounded-full ${vc.bg} flex items-center justify-center`}>
                         <span className={`text-[8px] ${vc.text}`}>✓</span>
                       </span>
                     )}
                     <div className="flex items-center gap-2 mb-1.5">
                       <div className={`w-7 h-7 rounded-lg ${vc.bg} flex items-center justify-center`}>
                         <User size={12} className={vc.text} />
                       </div>
                       <div className="min-w-0 flex-1">
                         <div className={`text-[11px] font-semibold truncate ${isSelected ? vc.text : 'text-slate-700'}`}>
                           {v.label}
                         </div>
                       </div>
                       <button
                         onClick={(e) => { e.stopPropagation(); handlePreviewVoice(v.id); }}
                         className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                           isPreviewing
                             ? 'bg-red-500/20 text-red-400'
                             : `${vc.bg} ${vc.text} opacity-0 group-hover:opacity-100`
                         }`}
                         title={isPreviewing ? 'Dừng' : 'Nghe thử'}
                       >
                         {isPreviewing ? <Pause size={10} /> : <Play size={10} className="ml-0.5" />}
                       </button>
                     </div>
                     <div className="flex items-center gap-1.5">
                       <span className={`text-[9px] px-1.5 py-0.5 rounded-md ${vc.bg} ${vc.text}`}>
                         {v.gender}
                       </span>
                       <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-white/5 text-slate-500 flex items-center gap-0.5">
                         <MapPin size={7} />{v.region}
                       </span>
                     </div>
                   </button>
                 );
               })}
            </div>
          </div>

{/* Controls - Rate & Pitch */}
           <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
               <div className="flex items-center justify-between">
                 <label className="text-xs font-semibold text-slate-500">Tốc độ</label>
                 <span className="text-[11px] text-cyan-600 font-mono bg-cyan-50/10 px-2 py-0.5 rounded-md">{formatRate(rate)}</span>
               </div>
               <input type="range" min={-50} max={50} value={rate} onChange={e => setRate(parseInt(e.target.value))}
                 className="w-full h-2 bg-slate-100 rounded-full appearance-none cursor-pointer accent-cyan-500" />
               <div className="flex justify-between text-[9px] text-slate-600">
                 <span>Chậm</span><span>Bình thường</span><span>Nhanh</span>
               </div>
             </div>
             <div className="space-y-2">
               <div className="flex items-center justify-between">
                 <label className="text-xs font-semibold text-slate-500">Cao độ</label>
                 <span className="text-[11px] text-purple-600 font-mono bg-purple-50/10 px-2 py-0.5 rounded-md">{formatPitch(pitch)}</span>
               </div>
               <input type="range" min={-50} max={50} value={pitch} onChange={e => setPitch(parseInt(e.target.value))}
                 className="w-full h-2 bg-slate-100 rounded-full appearance-none cursor-pointer accent-purple-500" />
               <div className="flex justify-between text-[9px] text-slate-600">
                 <span>Thấp</span><span>Bình thường</span><span>Cao</span>
               </div>
             </div>
           </div>

{/* Generate Button */}
           <button
             onClick={handleGenerate}
             disabled={loading || !text.trim()}
             className="w-full py-4 rounded-2xl bg-[#4a7dff] hover:bg-[#3d6ae6] text-white font-bold text-sm shadow-lg shadow-[#4a7dff]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2.5 active:scale-[0.98]"
           >
             {loading ? (
               <><Loader2 size={18} className="animate-spin" /> Đang tạo audio...</>
             ) : (
               <><Volume2 size={18} /> Chuyển Thành Giọng Nói</>
             )}
           </button>

{/* Audio Player */}
           {audioUrl && (
             <div className="p-5 bg-slate-50 border border-emerald-200 rounded-2xl space-y-3">
               <audio ref={audioRef} src={audioUrl} preload="auto" className="hidden" />
               <div className="flex items-center gap-3">
                 <button
                   onClick={handlePlayPause}
                   className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/30 transition-all shrink-0"
                 >
                   {playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
                 </button>
                 <div className="flex-1 min-w-0">
                   <div className="text-sm font-semibold text-emerald-600">Audio đã tạo</div>
                   <div className="text-[10px] text-slate-500 truncate">
                     {selectedVoice?.label} • {formatRate(rate)} • {formatPitch(pitch)}
                   </div>
                 </div>
                 <button
                   onClick={handleDownload}
                   className="px-4 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-600 text-xs font-bold flex items-center gap-1.5 hover:bg-emerald-500/30 transition-all active:scale-95"
                 >
                   <Download size={14} /> Tải MP3
                 </button>
               </div>
             </div>
           )}
        </div>
      </div>

{/* Right Panel - History */}
       <div className={`w-64 border-l border-slate-200 bg-slate-50 flex flex-col ${showVoicePanel ? 'max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:w-72 max-md:bg-slate-50' : 'max-md:hidden'}`}>
         <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
           <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Lịch sử</h3>
           {history.length > 0 && (
             <button
               onClick={() => setHistory([])}
               className="text-[10px] text-slate-500 hover:text-slate-600 flex items-center gap-1 transition-colors"
             >
               <RotateCw size={10} /> Xóa
             </button>
           )}
         </div>
         <div className="flex-1 overflow-y-auto p-3 space-y-2">
           {history.length === 0 ? (
             <div className="text-center py-8">
               <Clock size={24} className="text-slate-500 mx-auto mb-2" />
               <p className="text-[10px] text-slate-500">Chưa có lịch sử</p>
               <p className="text-[9px] text-slate-600 mt-1">Audio đã tạo sẽ xuất hiện ở đây</p>
             </div>
           ) : (
             history.map((h, i) => (
               <button
                 key={i}
                 onClick={() => playHistoryItem(h)}
                 className="w-full p-3 rounded-xl bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-left transition-all group"
               >
                 <div className="text-[11px] text-slate-400 truncate group-hover:text-white transition-colors">{h.text}</div>
                 <div className="flex items-center justify-between mt-1.5">
                   <span className="text-[9px] text-slate-500">{h.voice}</span>
                   <span className="text-[9px] text-slate-600">{h.time}</span>
                 </div>
               </button>
             ))
           )}
         </div>
       </div>
    </div>
  );
}
