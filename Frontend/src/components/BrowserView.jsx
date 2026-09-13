import { apiFetch } from '../config';
import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, X, RefreshCw, Search, Loader2, Zap, Bot } from 'lucide-react';


export default function BrowserView({ onClose }) {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const intentionalCloseRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState('https://www.google.com');
  const [status, setStatus] = useState('disconnected');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const frameCountRef = useRef(0);
  const lastFrameTimeRef = useRef(Date.now());
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastFrameTimeRef.current) / 1000;
      setFps(Math.round(frameCountRef.current / elapsed));
      frameCountRef.current = 0;
      lastFrameTimeRef.current = now;
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const connectWS = () => {
    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // Đảm bảo kết nối trực tiếp đến backend WebSocket port 5000 nếu dev mode hoặc giữ nguyên host khi proxy
    const host = window.location.port === '5173' ? 'localhost:5000' : window.location.host;
    // P0-03: WS browser yêu cầu JWT — gửi kèm token đăng nhập qua query (server verifyClient)
    const token = localStorage.getItem('rexi_token') || '';
    const wsUrl = `${wsProto}://${host}/api/services/browser/stream?token=${encodeURIComponent(token)}`;
    intentionalCloseRef.current = false;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      reconnectAttemptsRef.current = 0;
      setConnected(true);
      setStatus('connected');
    };

    wsRef.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'frame' && msg.data && canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, canvasRef.current.width, canvasRef.current.height);
            frameCountRef.current++;
          };
          img.src = msg.data;
        }
      } catch {
      }
    };

    wsRef.current.onclose = () => {
      setConnected(false);
      // Auto-reconnect nếu không phải đóng có chủ đích (tránh "không bấm được/frozen" khi stream đứt)
      if (!intentionalCloseRef.current && reconnectAttemptsRef.current < 5) {
        reconnectAttemptsRef.current += 1;
        setStatus('connecting');
        setTimeout(() => {
          if (!intentionalCloseRef.current) connectWS();
        }, 1500);
      } else {
        setStatus('disconnected');
      }
    };

    wsRef.current.onerror = (err) => {
      console.error('[WS Error]', err);
    };
  };

  const disconnectWS = () => {
    intentionalCloseRef.current = true;
    reconnectAttemptsRef.current = 0;
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    setConnected(false);
    setStatus('disconnected');
  };

  const launchBrowser = async (initialUrl) => {
    setLoading(true);
    setStatus('launching');
    try {
      await apiFetch('/services/browser/launch', {
        method: 'POST',
        body: JSON.stringify({ url: initialUrl }),
      });
      connectWS();
      setStatus('connected');
    } catch (e) {
      setStatus('error');
      console.error('Launch error:', e);
    } finally {
      setLoading(false);
    }
  };

  const navigate = async () => {
    if (!url.trim()) return;
    if (!connected) {
      await launchBrowser(url.trim());
      return;
    }
    setStatus('navigating');
    try {
      await apiFetch('/services/browser/navigate', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim() }),
      });
      setStatus('connected');
    } catch (e) {
      setStatus('error');
      console.error('Navigate error:', e);
    }
  };

  const closeBrowser = async () => {
    try {
      await apiFetch('/services/browser/close', { method: 'POST' });
    } catch (e) {
      console.error('Close error:', e);
    }
    disconnectWS();
    setStatus('disconnected');
  };

  const handleCanvasClick = (e) => {
    if (!connected) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = 1280 / rect.width;
    const scaleY = 720 / rect.height;
    apiFetch('/services/browser/click', {
      method: 'POST',
      body: JSON.stringify({ x: Math.round(x * scaleX), y: Math.round(y * scaleY) }),
    }).catch(console.error);
  };

  const handleCanvasDoubleClick = (e) => {
    if (!connected) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = 1280 / rect.width;
    const scaleY = 720 / rect.height;
    apiFetch('/services/browser/click', {
      method: 'POST',
      body: JSON.stringify({ x: Math.round(x * scaleX), y: Math.round(y * scaleY) }),
    }).catch(console.error);
  };

  const handleKeyDown = (e) => {
    if (!connected) return;
    if (['Tab', 'F5', 'F11', 'F12'].includes(e.key)) {
      e.preventDefault();
    }
    apiFetch('/services/browser/key', {
      method: 'POST',
      body: JSON.stringify({ key: e.key }),
    }).catch(console.error);
  };

  const handleScroll = (e) => {
    if (!connected) return;
    e.preventDefault();
    apiFetch('/services/browser/scroll', {
      method: 'POST',
      body: JSON.stringify({ deltaX: e.deltaX, deltaY: e.deltaY }),
    }).catch(console.error);
  };

  const runAIAction = async () => {
    if (!aiInstruction.trim()) return;
    setAiLoading(true);
    try {
      await apiFetch('/services/browser/act', {
        method: 'POST',
        body: JSON.stringify({ instruction: aiInstruction }),
      });
      setAiInstruction('');
    } catch (e) {
      console.error('AI action error:', e);
      alert('AI action failed: ' + e.message);
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    // Không tự launch khi mở tab (đỡ tốn RAM Chromium) — user bấm Go/Khởi động thì navigate() sẽ launch
    return () => {
      disconnectWS();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statusColors = {
    disconnected: 'text-slate-500',
    launching: 'text-amber-400',
    connecting: 'text-cyan-400',
    connected: 'text-emerald-400',
    navigating: 'text-cyan-400',
    error: 'text-rose-400',
  };

  const statusLabels = {
    disconnected: 'Đã ngắt kết nối',
    launching: 'Đang khởi động Chrome...',
    connecting: 'Đang kết nối stream...',
    connected: 'Đang chạy',
    navigating: 'Đang tải trang...',
    error: 'Lỗi',
  };

  return (
    <div className="flex h-full bg-[#0f1014] text-white font-sans">
      <div className="w-72 flex flex-col border-r border-white/5 bg-[#131417] overflow-hidden">
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot size={20} className="text-cyan-400" />
            <span className="font-bold text-sm">Browser Agent</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="p-3 border-b border-white/5">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && navigate()}
                placeholder="Nhập URL..."
                className="w-full pl-8 pr-3 py-2 bg-[#0d0e11] border border-white/10 rounded-lg text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50"
              />
            </div>
            <button
              onClick={navigate}
              disabled={loading || !url.trim()}
              className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {loading ? '...' : connected ? 'Go' : 'Khởi động'}
            </button>
          </div>
        </div>

        <div className="px-3 py-2 border-b border-white/5">
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${
              status === 'connected' ? 'bg-emerald-400 animate-pulse' :
              status === 'launching' || status === 'navigating' ? 'bg-amber-400 animate-pulse' :
              status === 'error' ? 'bg-rose-400' : 'bg-slate-500'
            }`} />
            <span className={statusColors[status]}>{statusLabels[status]}</span>
          </div>
          {connected && (
            <div className="mt-1 text-[10px] text-slate-500 flex justify-between">
              <span>FPS: {fps}</span>
              <span>1280×720</span>
            </div>
          )}
        </div>

        <div className="p-3 border-b border-white/5">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-300 mb-2">
            <Zap size={14} className="text-amber-400" />
            AI Action (Stagehand)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runAIAction()}
              placeholder="VD: Đăng nhập Facebook, Tìm kiếm 'AI news'..."
              className="flex-1 px-3 py-2 bg-[#0d0e11] border border-white/10 rounded-lg text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-amber-500/50"
            />
            <button
              onClick={runAIAction}
              disabled={aiLoading || !connected}
              className="px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1"
            >
              {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            </button>
          </div>
          <p className="text-[10px] text-slate-500 mt-1">Dùng ngôn ngữ tự nhiên. AI sẽ điều khiển browser.</p>
        </div>

        <div className="p-3 border-b border-white/5">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Thao tác nhanh</p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: 'Google', url: 'https://google.com' },
              { label: 'YouTube', url: 'https://youtube.com' },
              { label: 'Facebook', url: 'https://facebook.com' },
              { label: 'GitHub', url: 'https://github.com' },
            ].map(site => (
              <button
                key={site.label}
                onClick={() => { setUrl(site.url); navigate(); }}
                disabled={loading || !connected}
                className="py-1.5 text-xs rounded bg-white/5 hover:bg-white/10 disabled:opacity-50 transition-colors"
              >
                {site.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 flex-1 overflow-y-auto text-[10px] text-slate-500">
          <p className="uppercase tracking-wider mb-2">Phím tắt</p>
          <div className="space-y-1 font-mono">
            <div className="flex justify-between"><span>Click</span><span>Chuột trái</span></div>
            <div className="flex justify-between"><span>Double-click</span><span>Click trái ×2</span></div>
            <div className="flex justify-between"><span>Scroll</span><span>Cuộn chuột</span></div>
            <div className="flex justify-between"><span>Type</span><span>Gõ trực tiếp</span></div>
            <div className="flex justify-between"><span>Enter</span><span>Submit/Go</span></div>
            <div className="flex justify-between"><span>Backspace</span><span>Xóa</span></div>
            <div className="flex justify-between"><span>Tab</span><span>Chuyển focus</span></div>
            <div className="flex justify-between"><span>Escape</span><span>Hủy</span></div>
          </div>
        </div>

        <div className="p-3 border-t border-white/5 space-y-2">
          <button
            onClick={() => { setUrl('about:blank'); navigate(); }}
            disabled={loading || !connected}
            className="w-full py-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={12} className="inline-block mr-1" /> Làm mới trang
          </button>
          <button
            onClick={closeBrowser}
            disabled={loading}
            className="w-full py-2 text-xs rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 disabled:opacity-50 transition-colors"
          >
            <X size={12} className="inline-block mr-1" /> Đóng Chrome
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="h-10 px-4 flex items-center justify-between border-b border-white/5 bg-[#131417]">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              {connected ? 'Live Stream' : 'Chưa kết nối'}
            </span>
            {connected && <span className="text-[10px] text-slate-500 px-2 py-0.5 rounded bg-white/5">1280 × 720</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => canvasRef.current?.requestFullscreen()}
              className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              title="Toàn màn hình"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 relative overflow-hidden bg-black">
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
              margin: '0 auto',
              cursor: connected ? 'default' : 'not-allowed',
            }}
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            onWheel={handleScroll}
            onKeyDown={handleKeyDown}
            tabIndex={0}
          />
          
          {!connected && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white">
              <Loader2 size={48} className="animate-spin text-cyan-400 mb-4" />
              <p className="text-slate-400">Nhấn "Go" để khởi động Chrome</p>
              <p className="text-xs text-slate-500 mt-2">Chrome sẽ mở trong background và stream về đây</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}