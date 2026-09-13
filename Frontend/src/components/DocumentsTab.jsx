import React, { useState, useEffect, useRef } from 'react';
import { FileText, Upload, Loader2, Trash2, RefreshCw, File, CheckCircle2 } from 'lucide-react';

export default function DocumentsTab({ API_BASE, authToken, showToast }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/services/documents`, {
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
      });
      const data = await res.json();
      if (data.success) setDocuments(data.documents || []);
      else setError(data.error || 'Không tải được danh sách.');
    } catch (e) {
      setError('Lỗi kết nối: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const uploadFile = async (file) => {
    if (!file) return;
    if (uploading) return;
    setUploading(true); setError('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/services/documents/upload`, {
        method: 'POST',
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
        body: fd
      });
      const data = await res.json();
      if (data.success) {
        showToast?.('✅ Đã thêm "' + file.name + '" vào bộ não! AI giờ hiểu nội dung file.', 'success');
        load();
      } else {
        setError(data.error || 'Upload thất bại.');
      }
    } catch (e) {
      setError('Lỗi kết nối: ' + e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeDoc = async (id, name) => {
    if (!window.confirm(`Xóa tài liệu "${name}" khỏi bộ não?`)) return;
    try {
      const res = await fetch(`${API_BASE}/services/documents/${id}`, {
        method: 'DELETE',
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        showToast?.('🗑️ Đã xóa tài liệu.', 'success');
        load();
      } else setError(data.error || 'Xóa thất bại.');
    } catch (e) {
      setError('Lỗi kết nối: ' + e.message);
    }
  };

  const fmtSize = (n) => {
    if (!n) return '';
    if (n < 1024) return n + ' ký tự';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  };

  return (
    <div className="h-full flex flex-col p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center gap-2">
        <FileText size={18} className="text-emerald-400" />
        <h2 className="text-lg font-semibold text-white">Đọc &amp; Hiểu File (RAG)</h2>
      </div>
      <p className="text-sm text-gray-400">
        Đưa <b>PDF / Word (.docx) / TXT</b> vào — Rexi tự đọc, hiểu theo nghĩa và trả lời dựa trên nội dung file. Hỏi bằng cách diễn đạt khác vẫn tìm ra. 📚
      </p>

      {/* Upload */}
      <div
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${dragOver ? 'border-emerald-400 bg-emerald-500/10' : 'border-gray-600 hover:border-emerald-500'}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) uploadFile(f); }}
      >
        <input ref={fileRef} type="file" accept=".txt,.md,.csv,.json,.pdf,.docx" className="hidden"
          onChange={(e) => uploadFile(e.target.files?.[0])} />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-emerald-400">
            <Loader2 size={20} className="animate-spin" /> Đang đọc &amp; vector hóa file...
          </div>
        ) : (
          <>
            <Upload size={28} className="mx-auto text-emerald-400 mb-2" />
            <p className="text-sm text-gray-300">Bấm hoặc kéo thả file vào đây</p>
            <p className="text-xs text-gray-500 mt-1">Hỗ trợ: PDF, DOCX, TXT, MD, CSV, JSON (tối đa 20MB)</p>
          </>
        )}
      </div>

      {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{error}</div>}

      {/* Danh sách */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">Tài liệu đã thêm ({documents.length})</h3>
        <button onClick={load} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
          <RefreshCw size={12} /> Làm mới
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-gray-500" /></div>
      ) : documents.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          <File size={32} className="mx-auto mb-2 opacity-40" />
          Chưa có tài liệu nào. Thêm file để AI hiểu nội dung của bạn!
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((d) => (
            <div key={d.ma_tai_lieu} className="flex items-center gap-3 bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
              <FileText size={18} className="text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{d.ten_file}</p>
                <p className="text-xs text-gray-500">
                  {d.loai_file?.toUpperCase()} · {fmtSize(d.so_ky_tu)} · {d.ngay_tao}
                </p>
              </div>
              <button onClick={() => removeDoc(d.ma_tai_lieu, d.ten_file)}
                className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400" title="Xóa">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-gray-500 bg-gray-800/40 border border-gray-700 rounded-lg p-3">
        <p className="flex items-center gap-1 mb-1"><CheckCircle2 size={12} className="text-emerald-400" /> <b>Cách dùng:</b></p>
        <p>1. Upload file → Rexi tự đọc + vector hóa (vài giây).</p>
        <p>2. Quay lại chat, hỏi bất kỳ câu nào liên quan nội dung file — kể cả diễn đạt khác từ.</p>
        <p>3. Trả lời sẽ dựa chính xác trên tài liệu của bạn.</p>
      </div>
    </div>
  );
}
