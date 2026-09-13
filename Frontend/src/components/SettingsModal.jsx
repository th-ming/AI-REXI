import { API_BASE } from '../config';
import React, { useState, useEffect } from 'react';
import { X, Settings, Eye, EyeOff, RefreshCw, Zap } from 'lucide-react';

const FALLBACK_PROVIDERS = {
  gemini: { name: 'Google Gemini', placeholder: 'AIzaSy...', defaultBaseUrl: '' },
  openai: { name: 'OpenAI GPT-4o / O3', placeholder: 'sk-proj-...', defaultBaseUrl: 'https://api.openai.com/v1' },
  claude: { name: 'Anthropic Claude 3.5', placeholder: 'sk-ant-...', defaultBaseUrl: '' },
  deepseek: { name: 'DeepSeek AI (V3/R1)', placeholder: 'sk-...', defaultBaseUrl: 'https://api.deepseek.com/v1' },
  groq: { name: 'Groq Cloud (Fast Llama)', placeholder: 'gsk_...', defaultBaseUrl: 'https://api.groq.com/openai/v1' },
  github: { name: 'GitHub Models (Free)', placeholder: 'ghp_...', defaultBaseUrl: 'https://models.inference.ai.azure.com' },
  opencode: { name: 'OpenCode Agent Engine', placeholder: 'Internal Engine', defaultBaseUrl: '' },
  custom: { name: 'Custom Endpoint / OpenRouter', placeholder: 'sk-or-v1-...', defaultBaseUrl: 'https://openrouter.ai/api/v1' }
};

export default function SettingsModal({
  settingsOpen, setSettingsOpen,
  provider, setProvider, modelName, setModelName,
  apiKey, setApiKey, baseUrl, setBaseUrl
}) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [dynamicProviders, setDynamicProviders] = useState([]);
  const [loadingProviders, setLoadingProviders] = useState(false);

  // Fetch danh sách Nhà Cung Cấp động từ API khi mở Modal
  useEffect(() => {
    if (settingsOpen) {
      fetchProviders();
    }
  }, [settingsOpen]);

  const fetchProviders = async () => {
    setLoadingProviders(true);
    try {
      const res = await fetch(`${API_BASE}/models/providers`);
      const data = await res.json();
      if (data.success && Array.isArray(data.providers)) {
        setDynamicProviders(data.providers);
      }
    } catch (e) {
      console.warn('Load providers failed, fallback static:', e.message);
    } finally {
      setLoadingProviders(false);
    }
  };

  const handleProviderChange = (newProv) => {
    setProvider(newProv);
    localStorage.setItem('rexi_provider', newProv);

    // Auto-fill Base URL theo provider — LUÔN set (kể cả rỗng) để không dính URL cũ của provider trước
    const provInfo = FALLBACK_PROVIDERS[newProv];
    const nextBase = provInfo?.defaultBaseUrl || '';
    setBaseUrl(nextBase);
    localStorage.setItem('rexi_base_url', nextBase);

    // KHÔNG gợi ý model mẫu — để hệ thống tự chọn model working đầu tiên của provider
  };

  const handleClearKey = () => {
    setApiKey('');
    try { localStorage.removeItem('rexi_api_key'); } catch {}
  };

  if (!settingsOpen) return null;

  const providerList = dynamicProviders.length > 0
    ? dynamicProviders.map(p => ({ key: p.ma_nha_cung_cap, name: p.ten_hien_thi, placeholder: p.placeholder, canKey: p.can_api_key }))
    : Object.entries(FALLBACK_PROVIDERS).map(([k, v]) => ({ key: k, name: v.name, placeholder: v.placeholder, canKey: v.placeholder !== 'Internal Engine' }));

  // Ưu tiên placeholder của provider ĐỘNG từ server, fallback mới tới static
  const dynInfo = dynamicProviders.find(p => p.ma_nha_cung_cap === provider);
  const currentInfo = {
    placeholder: dynInfo?.placeholder || FALLBACK_PROVIDERS[provider]?.placeholder || '',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSettingsOpen(false)}>
      <div className="bg-[#1a1b24] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Settings size={18} className="text-cyan-400" /> Cài Đặt Hệ Thống AI Rexi
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={fetchProviders} title="Tải lại danh sách Provider" className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white">
              <RefreshCw size={14} className={loadingProviders ? 'animate-spin text-cyan-400' : ''} />
            </button>
            <button onClick={() => setSettingsOpen(false)} className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"><X size={16} /></button>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-400">Nhà cung cấp AI (Tự động cập nhật)</label>
              {loadingProviders && <span className="text-[10px] text-cyan-400 animate-pulse">Đang cập nhật...</span>}
            </div>
            <select
              value={provider}
              onChange={e => handleProviderChange(e.target.value)}
              className="w-full px-3 py-2.5 bg-[#0d0e11] border border-white/10 rounded-xl text-sm text-white outline-none focus:border-cyan-500/50 cursor-pointer"
            >
              {providerList.map(p => (
                <option key={p.key} value={p.key} className="bg-[#1e1f20] text-slate-200">
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 mb-1 block">Model AI (Mô hình)</label>
            <input
              type="text"
              value={modelName}
              onChange={e => { setModelName(e.target.value); localStorage.setItem('rexi_model', e.target.value); }}
              placeholder="vd: tên model có trong danh sách..."
              className="w-full px-3 py-2.5 bg-[#0d0e11] border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500/50 font-mono"
            />
          </div>

          {provider !== 'opencode' && (
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1 block">API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); localStorage.setItem('rexi_api_key', e.target.value); }}
                  placeholder={currentInfo.placeholder || 'Nhập API Key...'}
                  className="w-full px-3 py-2.5 bg-[#0d0e11] border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500/50 pr-10"
                />
                <button type="button" onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {apiKey ? (
                <button type="button" onClick={handleClearKey}
                  className="mt-1 text-[10px] text-rose-400/80 hover:text-rose-300">
                  Xóa key đã lưu khỏi máy này
                </button>
              ) : null}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-400 mb-1 block">Base URL Endpoint (Địa chỉ API)</label>
            <input
              type="text"
              value={baseUrl}
              onChange={e => { setBaseUrl(e.target.value); localStorage.setItem('rexi_base_url', e.target.value); }}
              placeholder={
                provider === 'gemini' ? 'Không cần điền — Gemini dùng API Key trực tiếp'
                : provider === 'claude' ? 'Không cần điền — Claude dùng API Key trực tiếp'
                : provider === 'opencode' ? 'Internal engine — không cần URL'
                : 'https://api.openai.com/v1'
              }
              className="w-full px-3 py-2.5 bg-[#0d0e11] border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500/50 font-mono"
            />
            {(provider === 'gemini' || provider === 'claude' || provider === 'opencode') && (
              <p className="text-[10px] text-slate-500 mt-1">Provider này dùng API Key trực tiếp, không cần Base URL</p>
            )}
          </div>

          <button
            onClick={() => setSettingsOpen(false)}
            className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-sm rounded-xl shadow-lg transition-all flex items-center justify-center gap-1.5"
          >
            <Zap size={15} /> Lưu Cài Đặt
          </button>
        </div>
      </div>
    </div>
  );
}

