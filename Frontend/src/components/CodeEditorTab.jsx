import React from 'react';
import { t, getLang } from '../i18n';
import { Play, Save, Eye } from 'lucide-react';

export default function CodeEditorTab({
  selectedFile, fileContent = '', setFileContent,
  savingFile, handleSaveFile, liveHtml = '', setLiveHtml
}) {
  const lang = getLang();
  return (
    <div className="flex h-full w-full">
      {/* Code Editor Left */}
      <div className="w-1/2 h-full border-r border-white/5 flex flex-col bg-[#131417]">
        <div className="p-3 border-b border-white/5 flex items-center justify-between bg-[#181920]">
          <span className="text-xs font-mono text-cyan-400 font-semibold">{selectedFile || 'Workspace Code Editor'}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setLiveHtml?.(fileContent)}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium flex items-center gap-1">
              <Play size={12} /> Chạy Preview
            </button>
            {selectedFile && (
              <button onClick={handleSaveFile} disabled={savingFile}
                className="px-3 py-1 bg-cyan-500 hover:bg-cyan-400 text-white rounded-lg text-xs font-medium flex items-center gap-1">
                <Save size={12} /> {savingFile ? 'Đang lưu...' : 'Lưu File'}
              </button>
            )}
          </div>
        </div>
        <textarea
          value={fileContent}
          onChange={e => setFileContent?.(e.target.value)}
          placeholder={t(lang, 'phCode')}
          className="flex-1 p-4 bg-[#0d0e11] font-mono text-xs text-slate-200 outline-none resize-none"
        />
      </div>
      {/* Live Preview Right */}
      <div className="w-1/2 h-full flex flex-col bg-[#1e1f20]">
        <div className="p-3 border-b border-white/5 flex items-center justify-between bg-[#181920]">
          <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
            <Eye size={14} className="text-cyan-400" /> Live HTML/CSS Preview
          </span>
          <button onClick={() => setLiveHtml?.('')} className="text-[10px] text-slate-500 hover:text-rose-400">Xóa</button>
        </div>
        {liveHtml ? (
          <iframe srcDoc={liveHtml} className="flex-1 bg-white" title="Live Preview" />
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
            Nhập HTML/CSS bên trái rồi nhấn "Chạy Preview"
          </div>
        )}
      </div>
    </div>
  );
}
