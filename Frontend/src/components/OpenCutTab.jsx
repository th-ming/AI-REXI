import React, { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { OPENCUT_URL } from '../config';

export default function OpenCutTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [key, setKey] = useState(0);

  const reload = () => { setError(false); setLoading(true); setKey(k => k + 1); };

  return (
    <div className="relative h-full w-full bg-[var(--bg-main)]">
      {loading && !error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Loader2 size={22} className="text-cyan-500 animate-spin" />
          <p className="text-xs text-slate-500">Đang tải OpenCut...</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center p-6">
          <p className="text-sm text-slate-300">Không tải được OpenCut.</p>
          <button
            onClick={reload}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 text-xs font-semibold hover:bg-cyan-500/25 transition-all"
          >
            <RefreshCw size={13} /> Thử lại
          </button>
        </div>
      )}
      <iframe
        key={key}
        src={OPENCUT_URL}
        title="OpenCut"
        className="w-full h-full border-0"
        allow="clipboard-write; fullscreen; camera; microphone; autoplay"
        onLoad={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true); }}
      />
    </div>
  );
}
