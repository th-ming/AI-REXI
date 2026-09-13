import React, { useState } from 'react';
import { RefreshCw, ExternalLink, Clapperboard, Loader2 } from 'lucide-react';
import { OPENCUT_URL } from '../config';

export default function OpenCutTab({ showToast }) {
  const [url, setUrl] = useState(() => OPENCUT_URL);
  const [inputUrl, setInputUrl] = useState(OPENCUT_URL);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState(0);

  const handleReload = () => {
    setLoading(true);
    setKey(k => k + 1);
  };

  const handleOpenNewTab = () => {
    window.open(url, '_blank', 'noopener');
    showToast?.('Đã mở OpenCut trong tab mới', 'success');
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#0d0e11]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#181920] border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shrink-0">
            <Clapperboard size={14} className="text-white" />
          </span>
          <span className="text-xs font-bold text-white whitespace-nowrap">OpenCut Editor</span>
          <form
            className="flex-1 min-w-0"
            onSubmit={(e) => { e.preventDefault(); setUrl(inputUrl.trim() || OPENCUT_URL); handleReload(); }}
          >
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="URL OpenCut server (vd: http://localhost:3000)"
              className="w-full bg-[#0d0e11] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/40 font-mono"
            />
          </form>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleReload}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-all"
            title="Tải lại"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleOpenNewTab}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-all"
            title="Mở tab mới"
          >
            <ExternalLink size={14} />
          </button>
        </div>
      </div>

      {/* Iframe */}
      <div className="flex-1 relative bg-black">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0d0e11] z-10">
            <Loader2 size={22} className="text-cyan-400 animate-spin" />
            <p className="text-xs text-slate-500">Đang tải OpenCut...</p>
            <p className="text-[10px] text-slate-600">
              Chưa chạy server? Mở terminal: <span className="font-mono text-cyan-400">cd D:/repos/OpenCut/apps/web && bun dev</span>
            </p>
          </div>
        )}
        <iframe
          key={key}
          src={url}
          title="OpenCut"
          className="w-full h-full border-0"
          allow="clipboard-write; fullscreen"
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
}
