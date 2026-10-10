import React from 'react';
import { tx } from '../i18n-sweep';
import { getLang } from '../i18n';
import { Monitor, RefreshCw, AlertCircle } from 'lucide-react';

export default function DesktopTab({ desktopScreenshot, desktopLoading, desktopError, fetchDesktopScreenshot }) {
  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-slate-300 flex items-center gap-2">
          <Monitor size={16} className="text-cyan-400" /> Remote Desktop Viewer
        </span>
        <button onClick={fetchDesktopScreenshot} disabled={desktopLoading}
          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1">
          <RefreshCw size={12} className={desktopLoading ? "animate-spin" : ""} />
          {desktopLoading ? tx(getLang(), 'Đang chụp...') : tx(getLang(), 'Chụp màn hình')}
        </button>
      </div>
      <div className="flex-1 bg-[#0d0e11] rounded-xl border border-white/5 overflow-hidden flex items-center justify-center">
        {desktopError ? (
          <div className="text-center text-red-400">
            <AlertCircle size={48} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">{tx(getLang(), 'Lỗi chụp màn hình: ')} {desktopError}</p>
          </div>
        ) : desktopScreenshot ? (
          <img src={desktopScreenshot} alt="Desktop Screenshot" className="max-w-full max-h-full object-contain" />
        ) : (
          <div className="text-center text-slate-500">
            <Monitor size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">{tx(getLang(), 'Nhấn "Chụp màn hình" để xem desktop')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
