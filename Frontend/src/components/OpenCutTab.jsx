import React, { useState, useRef } from 'react';
import { RefreshCw, ExternalLink, Clapperboard, Loader2, AlertTriangle } from 'lucide-react';
import { OPENCUT_URL } from '../config';

export default function OpenCutTab({ showToast }) {
  const [url, setUrl] = useState(() => OPENCUT_URL);
  const [inputUrl, setInputUrl] = useState(OPENCUT_URL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [key, setKey] = useState(0);
  const iframeRef = useRef(null);

  const handleReload = () => {
    setError(false);
    setLoading(true);
    setKey(k => k + 1);
  };

  const handleOpenNewTab = () => {
    window.open(url, '_blank', 'noopener');
    showToast?.('Đã mở OpenCut trong tab mới', 'success');
  };

  const handleError = () => {
    setLoading(false);
    setError(true);
  };

  const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg-main)]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-card)] border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shrink-0">
            <Clapperboard size={14} className="text-white" />
          </span>
          <span className="text-xs font-bold text-[var(--text-main)] whitespace-nowrap">OpenCut Editor</span>
          <form
            className="flex-1 min-w-0"
            onSubmit={(e) => { e.preventDefault(); setUrl(inputUrl.trim() || OPENCUT_URL); handleReload(); }}
          >
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="URL OpenCut server (vd: http://localhost:3000)"
              className="w-full bg-[var(--bg-main)] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] placeholder-slate-500 outline-none focus:border-cyan-500/40 font-mono"
            />
          </form>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleReload}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-all"
            title="Tải lại"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleOpenNewTab}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-all"
            title="Mở tab mới"
          >
            <ExternalLink size={14} />
          </button>
        </div>
      </div>

      {/* Iframe or placeholder */}
      <div className="flex-1 relative bg-[var(--bg-main)]">
        {error || (loading && isLocalhost) ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--bg-main)] z-10 p-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center">
              <Clapperboard size={28} className="text-white" />
            </div>
            <div className="text-center max-w-md">
              <h3 className="text-base font-bold text-[var(--text-main)] mb-2">OpenCut Editor</h3>
              <p className="text-sm text-slate-500 mb-4">
                OpenCut là app chỉnh sửa video chạy local. Cần cài và khởi động server trước khi dùng.
              </p>
              <div className="bg-[var(--bg-card)] border border-white/10 rounded-xl p-4 text-left mb-4">
                <p className="text-xs font-semibold text-slate-300 mb-2">Bước 1 — Cài OpenCut:</p>
                <code className="block text-xs bg-[var(--bg-main)] border border-white/10 rounded-lg px-3 py-2 font-mono text-[var(--text-main)] mb-3">
                  git clone https://github.com/nichochar/opencut.git<br/>
                  cd opencut/apps/web && bun install
                </code>
                <p className="text-xs font-semibold text-slate-300 mb-2">Bước 2 — Chạy server:</p>
                <code className="block text-xs bg-[var(--bg-main)] border border-white/10 rounded-lg px-3 py-2 font-mono text-[var(--text-main)]">
                  bun dev
                </code>
                <p className="text-xs text-slate-400 mt-2">Server sẽ chạy tại http://localhost:3000</p>
              </div>
              <div className="flex items-center gap-2 justify-center text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                <AlertTriangle size={14} />
                <span>Nhập URL server OpenCut ở thanh trên rồi nhấn Enter</span>
              </div>
            </div>
          </div>
        ) : loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--bg-main)] z-10">
            <Loader2 size={22} className="text-cyan-500 animate-spin" />
            <p className="text-xs text-slate-500">Đang tải OpenCut...</p>
          </div>
        ) : null}
        <iframe
          ref={iframeRef}
          key={key}
          src={url}
          title="OpenCut"
          className="w-full h-full border-0"
          allow="clipboard-write; fullscreen"
          onLoad={() => setLoading(false)}
          onError={handleError}
        />
      </div>
    </div>
  );
}
