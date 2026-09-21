import React, { useState, useEffect } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';

export default function GameFrame({ src, title, name, reloadKey = 0 }) {
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    setLoading(true);
    setTimedOut(false);
    if (!src) return;
    const t = setTimeout(() => setTimedOut(true), 15000);
    return () => clearTimeout(t);
  }, [src, reloadKey]);

  return (
    <div className="flex-1 relative bg-black">
      {loading && !timedOut && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d0e11]">
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={22} className="text-purple-500 animate-spin" />
            <span className="text-xs text-slate-500">Đang tải {name}...</span>
          </div>
        </div>
      )}
      {timedOut && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#0d0e11] p-8">
          <AlertTriangle size={28} className="text-amber-400" />
          <p className="text-sm font-semibold text-slate-200">Không tải được {name}</p>
          <p className="text-xs text-slate-500 text-center max-w-xs">File game có thể bị chặn hoặc thiếu. Thử tải lại hoặc mở trong tab mới.</p>
        </div>
      )}
      <iframe
        key={`${src}-${reloadKey}`}
        src={src}
        title={title}
        className="w-full h-full border-0"
        allow="autoplay; fullscreen"
        onLoad={() => setLoading(false)}
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    </div>
  );
}
