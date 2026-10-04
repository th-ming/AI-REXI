import React, { useState, useEffect } from 'react';
import { Loader2, ExternalLink, GraduationCap, RefreshCw } from 'lucide-react';

// OpenMAIC (THU-MAIC, MIT) — "Open Multi-Agent Interactive Classroom":
// lớp học ảo immersive với nhiều AI agent đóng vai trò giáo viên/học sinh.
// open.maic.chat CẤM iframe (X-Frame-Options: SAMEORIGIN + CSP frame-ancestors
// 'self' — đã verify) → đi qua backend proxy /api/classroom (strip frame headers
// + rewrite URL). Token qua ?token= vì iframe không gửi được Authorization header.
const OPENMAIC_URL = 'https://open.maic.chat/';

export default function ClassroomTab() {
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [proxySrc, setProxySrc] = useState('');

  useEffect(() => {
    try {
      const token = localStorage.getItem('rexi_token') || '';
      setProxySrc(`/api/services/classroom/?token=${encodeURIComponent(token)}`);
    } catch (e) {
      setProxySrc('/api/services/classroom/');
    }
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 25000);
    return () => clearTimeout(t);
  }, [reloadKey]);

  return (
    <div className="flex h-full w-full flex-col bg-[#0d0e11]">
      <div className="flex items-center justify-between bg-[#181920] px-4 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <GraduationCap size={18} className="text-teal-400" />
          <div>
            <h2 className="text-xs font-bold text-white">Lớp Học AI — OpenMAIC</h2>
            <p className="text-[10px] text-slate-500">Lớp học tương tác đa agent: giáo viên AI, học sinh AI, thảo luận nhóm</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReloadKey(k => k + 1)}
            className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-card)] border border-white/10 text-[11px] text-slate-300 hover:text-white hover:bg-white/10 transition-all flex items-center gap-1"
            title="Tải lại lớp học"
          >
            <RefreshCw size={12} /> Tải lại
          </button>
          <a
            href={OPENMAIC_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1.5 rounded-lg bg-teal-500/15 text-teal-300 border border-teal-500/30 text-[11px] font-medium hover:bg-teal-500/25 transition-all flex items-center gap-1"
            title="Mở OpenMAIC trong tab mới (đăng nhập đầy đủ hơn)"
          >
            <ExternalLink size={12} /> Tab mới
          </a>
        </div>
      </div>
      <div className="flex-1 relative bg-black">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d0e11]">
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={22} className="text-teal-400 animate-spin" />
              <span className="text-xs text-slate-500">Đang tải Lớp Học AI...</span>
            </div>
          </div>
        )}
        {proxySrc ? (
          <iframe
            key={reloadKey}
            src={proxySrc}
            title="Lớp Học AI — OpenMAIC"
            className="w-full h-full border-0"
            allow="autoplay; fullscreen; clipboard-write; microphone; camera"
            onLoad={() => setLoading(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
