// ═══════════════════════════════════════════════════════════
// AI REXI OS - Master Web Suite (Auto-Synced & Reloaded)
// ═══════════════════════════════════════════════════════════
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Menu,
  X,
  Settings,
  Layers,
  Bot, Code,
  Trash2,
  Database,
  Search,
  Check,
  AlertTriangle,
  Folder,
  Mic,
  Download,
  Cpu,
  FileCode,
  ChevronDown,
  Zap,
  MessageSquare,
  RefreshCw,
  Monitor,
  Tv,
  Eye,
  ChevronUp,
  Terminal,
  Shield,
  GitBranch,
  EyeOff,
  Video,
  BookOpen,
  Clapperboard,
  MonitorPlay,
  Gamepad2,
  FileText,
  Languages
} from 'lucide-react';
import { getLang, setLang, t } from './i18n';
import Hls from 'hls.js';

// Components
import { API_BASE, apiFetch } from './config';
import Sidebar from './components/Sidebar';
import ChatTab from './components/ChatTab';
import CodeEditorTab from './components/CodeEditorTab';
import IPTVTab from './components/IPTVTab';
import SettingsModal from './components/SettingsModal';
import SkillsModal from './components/SkillsModal';
import AdminPanel from './AdminPanel';
import StudioTab from './components/StudioTab';
import VideoCreatorTab from './components/VideoCreatorTab';
import OpenCutTab from './components/OpenCutTab';
import ImageGenTab from './components/ImageGenTab';
import DocumentsTab from './components/DocumentsTab';
import YouTubeTab from './components/YouTubeTab';
import GameTab from './components/GameTab';
import BrowserView from './components/BrowserView';
import HelpModal from './components/HelpModal';


// (marked/highlight render markdown nằm trong Frontend/src/utils/sanitize.js — ChatTab dùng sanitizeMarkdown)

// Popover UI Chẩn Trận & Chọn Model Đẳng Cấp Chuyên Nghiệp (Glassmorphism & Grouped)
const ModelSelectorPopover = ({ availableModels, modelName, setModelName, setProvider }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeModelObj = useMemo(() => {
    // 🤖 Auto: hiển thị chế độ tự chọn model thông minh
    if (modelName === 'auto') return { id: 'auto', name: 'Auto (tự chọn thông minh)', provider: 'xkiro', type: 'free' };
    // 🔄 Ưu tiên model thật đang được chọn; nếu model cũ đã bị xóa (không còn trong danh sách mới)
    // → KHÔNG hiển thị model giả/cũ — tự chọn model thật đầu tiên (hoặc trạng thái 'đang tải')
    const found = availableModels.find(m => m.id === modelName);
    if (found) return found;
    if (availableModels.length > 0) return availableModels[0];
    return { id: modelName || '', name: modelName || 'Đang tải model...', provider: '', type: 'free' };
  }, [availableModels, modelName]);

  const groupedModels = useMemo(() => {
    const map = {};
    const filtered = availableModels.filter(m => {
      const query = search.toLowerCase().trim();
      if (!query) return true;
      return (m.name || '').toLowerCase().includes(query) ||
             (m.id || '').toLowerCase().includes(query) ||
             (m.provider || '').toLowerCase().includes(query);
    });

    filtered.forEach(m => {
      const pKey = (m.providerName || m.provider || 'AI Provider').toUpperCase();
      if (!map[pKey]) map[pKey] = [];
      map[pKey].push(m);
    });
    return map;
  }, [availableModels, search]);

  const selectModel = (m) => {
    setModelName(m.id);
    localStorage.setItem('rexi_model', m.id);
    if (m.provider) {
      setProvider(m.provider);
      localStorage.setItem('rexi_provider', m.provider);
    }
    setOpen(false);
  };

  const getProviderBadge = (providerName) => {
    const p = (providerName || '').toLowerCase();
    if (p.includes('gemini') || p.includes('google')) return { bg: 'bg-blue-500/10 border-blue-500/30 text-blue-400', IconComp: Bot };
    if (p.includes('groq')) return { bg: 'bg-amber-500/10 border-amber-500/30 text-amber-400', IconComp: Zap };
    if (p.includes('deepseek')) return { bg: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400', IconComp: Cpu };
    if (p.includes('kira')) return { bg: 'bg-rose-500/10 border-rose-500/30 text-rose-400', IconComp: Shield };
    if (p.includes('opencode')) return { bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400', IconComp: Settings };
    if (p.includes('openai') || p.includes('gpt')) return { bg: 'bg-purple-500/10 border-purple-500/30 text-purple-400', IconComp: Sparkles };
    return { bg: 'bg-slate-500/10 border-slate-500/30 text-slate-300', IconComp: Sparkles };
  };

  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#181a20] via-[#15161c] to-[#121318] border border-blue-500/40 hover:border-blue-400/70 shadow-lg text-xs font-medium text-slate-200 transition-all cursor-pointer group hover:scale-[1.02] active:scale-[0.98]"
      >
        <span className="flex items-center gap-1.5 truncate max-w-[170px] sm:max-w-[240px]">
          <Zap size={14} className="text-cyan-400" />
          <span className="font-bold text-cyan-100 truncate">{activeModelObj.name || activeModelObj.id}</span>
          {(activeModelObj.status === 'needs_balance' || activeModelObj.type === 'paid') && (
            <span className="text-[9px] font-extrabold rounded-md bg-amber-500/20 text-amber-300 uppercase border border-amber-500/30 shrink-0" title="Model tồn tại nhưng key hiện tại thiếu tiền/quyền"><Lock size={10} /></span>
          )}
          <span className="px-1.5 py-0.5 text-[9px] font-extrabold rounded-md bg-cyan-500/20 text-cyan-300 uppercase border border-cyan-500/30 shrink-0">
            {(activeModelObj.provider || 'AI').toUpperCase()}
          </span>
        </span>
        <ChevronDown size={14} className={`text-slate-400 group-hover:text-cyan-300 transition-transform duration-200 ${open ? 'rotate-180 text-cyan-400' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-[340px] sm:w-[380px] max-h-[460px] bg-[#12141c] border border-cyan-500/50 rounded-2xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95)] z-[9999999] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
          <div className="p-3 border-b border-white/10 bg-[#171922] flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                <Cpu size={14} className="text-cyan-400 animate-pulse" /> Chọn Mô Hình AI (Model Selector)
              </span>
              <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20">
                {availableModels.length} Models
              </span>
            </div>
            
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm kiếm model hoặc provider (Gemini, Groq...)"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-[#16171d] text-xs text-slate-100 pl-8 pr-3 py-1.5 rounded-xl border border-white/10 focus:border-cyan-400 outline-none placeholder:text-slate-500 transition-all"
                autoFocus
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-3 custom-scrollbar">
            {/* 🤖 AUTO — tự chọn model thông minh theo độ khó câu hỏi */}
            <button
              type="button"
              onClick={() => selectModel({ id: 'auto', provider: 'xkiro' })}
              className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition-all mb-1 ${
                modelName === 'auto'
                  ? 'bg-gradient-to-r from-indigo-500/30 to-cyan-500/20 border border-indigo-500/50 text-indigo-200 font-semibold'
                  : 'bg-gradient-to-r from-indigo-500/10 to-cyan-500/5 border border-indigo-500/20 text-slate-300 hover:text-white hover:border-indigo-500/40'
              }`}
            >
              <span className="flex items-center gap-2">
                <span>🤖</span>
                <span>Auto — Tự chọn model thông minh</span>
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 uppercase shrink-0">VIP</span>
            </button>
            {Object.keys(groupedModels).length > 0 ? (
              Object.entries(groupedModels).map(([providerGroup, models]) => {
                const badge = getProviderBadge(providerGroup);
                return (
                  <div key={providerGroup} className="space-y-1">
                    <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <badge.IconComp size={12} />
                      <span className="text-slate-300">{providerGroup}</span>
                      <span className="ml-auto text-[9px] opacity-60">({models.length})</span>
                    </div>

                    <div className="space-y-1">
                      {models.map(m => {
                        const isSelected = m.id === modelName;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => selectModel(m)}
                            className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition-all ${
                              isSelected
                                ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-200 font-semibold shadow-inner'
                                : 'hover:bg-white/5 border border-transparent text-slate-300 hover:text-white'
                            }`}
                          >
                            <div className="flex flex-col min-w-0 pr-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs truncate">{m.name || m.id}</span>
                                {(m.status === 'needs_balance' || m.type === 'paid') && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold shrink-0" title="Model tồn tại nhưng key hiện tại thiếu tiền/quyền — nạp tiền là dùng được">🔒 trả phí</span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-500 font-mono truncate">{m.id}</span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {isSelected && (
                                <Check size={14} className="text-cyan-400 font-bold ml-1" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-6 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                <AlertTriangle size={20} className="text-amber-400" />
                <span>Không tìm thấy model nào phù hợp với từ khóa "{search}"</span>
              </div>
            )}
          </div>

          <div className="p-2 border-t border-white/10 bg-[#0e0f15] text-[10px] text-slate-400 flex items-center justify-between">
            <span className="flex items-center gap-1"><Zap size={11} className="text-cyan-400" /> Tự động chuyển Provider</span>
            <span className="text-cyan-400 font-mono">AI REXI OS</span>
          </div>
        </div>
      )}
    </div>
  );
};



// FAB menu item (icon + label + description)
const FabItem = ({ item, activeTab, onPick }) => (
  <button
    onClick={onPick}
    className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
      activeTab === item.tab
        ? 'bg-cyan-50 text-cyan-600 border border-cyan-200 shadow-sm font-bold'
        : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
    }`}
  >
    <span className={item.color}>{item.icon}</span>
    <div className="flex flex-col items-start whitespace-nowrap">
      <span>{item.label}</span>
      {item.desc && <span className="text-[9px] text-slate-400 font-normal">{item.desc}</span>}
    </div>
  </button>
);




const AI_SPECIALTIES = [
  { id: 'general', name: 'Trợ Lý Toàn Năng' },
  { id: 'business', name: 'Doanh Nghiệp & Hợp Đồng' },
  { id: 'marketing', name: 'Content Marketing' },
  { id: 'education', name: 'Phân Tích Chuyên Sâu' },
  { id: 'health', name: 'Sức Khỏe & Dinh Dưỡng' },
  { id: 'coder', name: 'Lập Trình & Architect' }
];





export default function App() {
  const [lang, setLangState] = useState(getLang());
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [superToolsOpen, setSuperToolsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [showPassword, setShowPassword] = useState(false);
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotStep, setForgotStep] = useState('login');
  const [showForgotNewPassword, setShowForgotNewPassword] = useState(false);
  const [forgotMessage, setForgotMessage] = useState('');
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || localStorage.getItem('rexi_activeTab') || 'chat'); // 'chat' | 'code' | 'files' | 'iptv' | 'desktop'
  const handleSetActiveTab = (tab) => { setActiveTab(tab); localStorage.setItem('rexi_activeTab', tab); };
  const [filesDrawerOpen, setFilesDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [fabOpen, setFabOpen] = useState(false);

  // AI Configuration State
  const [provider, setProvider] = useState(() => localStorage.getItem('rexi_provider') || 'xkiro');
  const [reasoning, setReasoning] = useState(false); // 🧠 Suy luận sâu
  const [modelName, setModelName] = useState(() => localStorage.getItem('rexi_model') || 'mistralai/mistral-small-2603');
  const lastAutoSwapRef = useRef(''); // chống toast đúp khi nhiều nguồn refresh model cùng lúc
  const [apiKey, setApiKey] = useState(() => {
    // P2-23: key KHÔNG nằm localStorage (plaintext + XSS đọc được) — chỉ sessionStorage (đóng tab là mất)
    const saved = sessionStorage.getItem('rexi_api_key') || '';
    const token = localStorage.getItem('rexi_token') || '';
    // Tự động dọn dẹp key hỏng/key nhầm JWT token để luôn luôn tự cập nhật theo Key chuẩn của Admin từ CSDL
    if (saved && (saved.startsWith('AQ..') || saved === token || saved.length > 200)) {
      sessionStorage.removeItem('rexi_api_key');
      localStorage.removeItem('rexi_api_key'); // dọn sót từ bản cũ (trước P2-23)
      return '';
    }
    return saved;
  });
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('rexi_base_url') || '');
  const [availableModels, setAvailableModels] = useState([]); // load động từ /api/models — chỉ model chat
  const [allModels, setAllModels] = useState([]); // mọi modality (chat/image/tts/stt/embed)
  const [aiSpecialty, setAiSpecialty] = useState('general');
  const [executionMode, setExecutionMode] = useState('chat'); // 'chat' | 'agent'
  const [agentEngine, setAgentEngine] = useState('auto'); // 'auto' | 'opencode' | 'dsh'
  const [chatModeOpen, setChatModeOpen] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState('standard'); // 'standard' | 'deep'
  const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('rexi_theme_v2') || 'storeify');

  // Workspace Files State
  const [fileTree, setFileTree] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [savingFile, setSavingFile] = useState(false);

  // Attachment & Voice State
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [listening, setListening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [speakingMsgId, setSpeakingMsgId] = useState(null);

  // TTS Settings
  const [ttsVoice, setTtsVoice] = useState(() => localStorage.getItem('rexi_tts_voice') || 'vi-VN-HoaiMyNeural');
  const [ttsRate] = useState(() => localStorage.getItem('rexi_tts_rate') || '+0%');
  const [ttsPitch] = useState(() => localStorage.getItem('rexi_tts_pitch') || '+0%');
  const [ttsVoices, setTtsVoices] = useState([]);
  const [, setTtsVoicesLoading] = useState(true);
  const [ttsUsingServer, setTtsUsingServer] = useState(() => {
    const saved = localStorage.getItem('rexi_tts_mode');
    return saved === 'server' && !!localStorage.getItem('rexi_token');
  });
  const ttsServerBrokenRef = useRef(false); // P3: server TTS lỗi tạm thời → fallback browser cho phiên, KHÔNG ghi đè setting user

  // Skills List from Database
  const [dbSkills, setDbSkills] = useState([]);

  // IPTV State
  const [iptvChannels, setIptvChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [iptvCategory, setIptvCategory] = useState('news');
  const [iptvSearch, setIptvSearch] = useState('');
  const [iptvTab, setIptvTab] = useState('category'); // 'category' | 'country'
  const [iptvCountry, setIptvCountry] = useState('VN');
  const [iptvSubtitleOn, setIptvSubtitleOn] = useState(false);
  const [iptvEmbeddedSubs, setIptvEmbeddedSubs] = useState([]); // track phụ đề nhúng của kênh (đồng bộ 100%)
  const iptvVideoRef = useRef(null);
  const hlsRef = useRef(null);

  // Desktop Remote State
  const [desktopScreenshot, setDesktopScreenshot] = useState(null);
  const [desktopLoading, setDesktopLoading] = useState(false);
  const [desktopError, setDesktopError] = useState(null);

  // Guest Limits State
  const [guestLimits, setGuestLimits] = useState({ messages: { used: 0, limit: 10, remaining: 10 }, agentTasks: { used: 0, limit: 3, remaining: 3 } });

  // Live Canvas state
  const [liveHtml, setLiveHtml] = useState('');

  // Super Tools State (Exec, Git, Memory)
  const [execCommand, setExecCommand] = useState('');
  const [execOutput, setExecOutput] = useState('');
  const [gitStatus, setGitStatus] = useState(null);
  const [gitDiff, setGitDiff] = useState('');
  const [memories, setMemories] = useState([]);
  const [newMemory, setNewMemory] = useState('');

  // Rate Limit Toast
  const [, setRateLimitToast] = useState('');
  const rateLimitTimerRef = useRef(null);

  // General Toast
  const [toastMsg, setToastMsg] = useState('');
  const [toastType, setToastType] = useState('success');
  const toastTimerRef = useRef(null);
  const showToast = (msg, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    setToastType(type);
    toastTimerRef.current = setTimeout(() => setToastMsg(''), 3000);
  };


  // Auth Token
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('rexi_token') || null);

  // User Profile
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('rexi_user'));
      if (saved && saved.ma_nguoi_dung) return saved;
      return null;
    } catch { return null; }
  });
  const authHeaders = () => {
    const h = { 'Content-Type': 'application/json' };
    if (authToken) h['Authorization'] = `Bearer ${authToken}`;
    return h;
  };


  // Fetch danh sách toàn bộ model động đang hoạt động từ backend từ TẤT CẢ nhà cung cấp
  const fetchAvailableModels = async () => {
    try {
      const data = await apiFetch('/models');
      if (data.success && data.models) {
        let allArr = [];
        Object.entries(data.models).forEach(([pKey, list]) => {
          if (Array.isArray(list)) {
            list.forEach(m => {
              allArr.push({ ...m, provider: m.provider || pKey });
            });
          }
        });
        setAllModels(allArr);
        const chatArr = allArr.filter(m => (m.modality || 'chat') === 'chat');
        setAvailableModels(chatArr);
        if (chatArr.length > 0) {
          const currentExist = chatArr.find(m => m.id === modelName);
          if (!currentExist) {
            // 🔄 THUẬT TOÁN BẢO TOÀN PHIÊN (Safe Swap): model đang chọn vừa bị lượt quét mới
            // xóa/thay thế → KHÔNG đổi model âm thầm. Chọn model thay thế gần nhất:
            // 1) Ưu tiên model CÙNG nhà cung cấp (giữ đúng ý định người dùng)
            // 2) Nếu nhà cung cấp cũng biến mất → model đầu tiên còn sống
            // Rồi báo rõ cho người dùng bằng toast (bỏ qua nếu chưa từng chọn model = lần đầu mở).
            const oldSelected = availableModels.find(m => m.id === modelName);
            const oldProviderName = (oldSelected ? oldSelected.provider : '') || (modelName.split('/')[0] || '');
            const sameProvider = chatArr.find(m => String(m.provider || '').toLowerCase() === String(oldProviderName).toLowerCase());
            const replacement = sameProvider || chatArr[0];
            setModelName(replacement.id);
            if (replacement.provider) setProvider(replacement.provider);
            localStorage.setItem('rexi_model', replacement.id);
            // Toast đúng 1 lần cho mỗi model bị thay (chống đúp khi SSE + interval + event chạy cùng lúc)
            if (modelName && lastAutoSwapRef.current !== modelName) {
              lastAutoSwapRef.current = modelName;
              showToast(`⚠️ ${modelName} không còn khả dụng sau lượt quét — tự chuyển sang ${replacement.id}`, 'info');
            }
          }
        }
      } else {
        setAvailableModels([]);
      }
    } catch {
      setAvailableModels([]);
    }
  };

  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authFullName, setAuthFullName] = useState('');

  // Handle Google OAuth redirect (runs in popup OR main window)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleToken = params.get('google_token');
    const googleUser = params.get('user');
    const googleError = params.get('error');

    if (googleToken && googleUser) {
      try {
        const user = JSON.parse(decodeURIComponent(googleUser));
        setAuthToken(googleToken);
        localStorage.setItem('rexi_token', googleToken);
        setCurrentUser(user);
        localStorage.setItem('rexi_user', JSON.stringify(user));
        window.history.replaceState({}, document.title, '/');
        // Nếu đang ở popup → đóng popup, parent sẽ detect token qua storage event
        if (window.opener) {
          window.close();
        } else {
          showToast('Đăng nhập Google thành công!');
        }
      } catch (e) {
        console.error('[Auth] Failed to parse Google user:', e);
        if (window.opener) window.close();
      }
    } else if (googleError) {
      if (!window.opener) alert('Đăng nhập Google thất bại: ' + googleError);
      window.history.replaceState({}, document.title, '/');
      if (window.opener) window.close();
    }
  }, []);

  const chatScrollRef = useRef(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // Hiện/ẩn 2 nút cuộn lên-xuống theo vị trí cuộn
  const handleChatScroll = (e) => {
    const el = e.currentTarget;
    const distFromTop = el.scrollTop;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollTop(distFromTop > 220);
    setShowScrollBottom(distFromBottom > 220);
  };

  const scrollToTopSmooth = () => {
    chatScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToBottomSmooth = () => {
    const el = chatScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };
  const fileInputRef = useRef(null);

   useEffect(() => {
    const fetchTtsVoices = async () => {
      try {
        const res = await fetch(`${API_BASE}/services/tts/voices`, {
          headers: authHeaders(),
          credentials: 'include'
        });
        const data = await res.json();
        if (data.success && data.voices) {
          setTtsVoices(data.voices);
        }
      } catch {
        console.log('[TTS] Could not fetch voices, using defaults');
      } finally {
        setTtsVoicesLoading(false);
      }
    };
    fetchTtsVoices();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Token hết hạn → xóa token cũ, mở màn hình đăng nhập để user đăng nhập lại
  useEffect(() => {
    const onSessionExpired = () => {
      localStorage.removeItem('rexi_token');
      localStorage.removeItem('rexi_user');
      setAuthToken('');
      setCurrentUser(null);
      setAuthModalOpen(true);
      showToast('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'error');
    };
    window.addEventListener('rexi_session_expired', onSessionExpired);
    return () => window.removeEventListener('rexi_session_expired', onSessionExpired);
  }, []);

  // Đổi identity (login/logout/chuyển tài khoản) → bỏ conv đang mở + xóa list cũ.
  // Conv cũ thuộc identity cũ (guest conv gắn session cũ, user conv của tài khoản cũ)
  // → giữ lại sẽ gửi tin vào conv không còn quyền (403) hoặc hiện nhầm lịch sử người khác.
  const authIdRef = useRef(undefined);
  useEffect(() => {
    const id = currentUser
      ? (currentUser.ma_nguoi_dung || currentUser.id || currentUser.email || 'user')
      : null;
    if (authIdRef.current === undefined) { authIdRef.current = id; return; }
    if (authIdRef.current !== id) {
      authIdRef.current = id;
      setActiveConvId(null);
      setConversations([]);
    }
  }, [currentUser]);

  // Listen for token changes from Google OAuth popup
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'rexi_token' && e.newValue) {
        setAuthToken(e.newValue);
        const savedUser = localStorage.getItem('rexi_user');
        if (savedUser) {
          try { setCurrentUser(JSON.parse(savedUser)); } catch {}
        }
        showToast('Đăng nhập Google thành công!');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('rexi_theme_v2', currentTheme);
  }, [currentTheme]);

  // Đóng FAB menu overlay khi đổi tab
  useEffect(() => {
    setFabOpen(false);
  }, [activeTab]);

  useEffect(() => {
    fetchConversations();
    fetchFileTree();
    fetchDbSkills();
    fetchGitStatus();
    fetchMemories();
    fetchAvailableModels();
    if (!currentUser) fetchGuestLimits();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Khi có model mới được đăng tải hoặc quét xong từ Admin Panel → load lại danh sách model ở Menu Header Trang Chủ
  useEffect(() => {
    fetchAvailableModels();

    const handleModelsPublished = () => {
      fetchAvailableModels();
    };
    window.addEventListener('rexi_models_published', handleModelsPublished);
    return () => window.removeEventListener('rexi_models_published', handleModelsPublished);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // SSE: tự động cập nhật danh sách model khi backend scan xong hoặc Admin cập nhật
  useEffect(() => {
    const evtSource = new EventSource(`${API_BASE.replace('/api', '')}/api/models/stream`);
    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('[SSE] Model scan/update complete:', data);
        fetchAvailableModels();
      } catch {}
    };
    evtSource.onerror = () => {};
    return () => evtSource.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 🔄 Auto-refresh danh sách model mỗi 60s — đảm bảo tab đang mở vẫn tự cập nhật model mới
  // khi Admin quét xong (không cần F5, không phụ thuộc duy nhất vào SSE)
  useEffect(() => {
    fetchAvailableModels();
    const timer = setInterval(fetchAvailableModels, 60000);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchGuestLimits = async () => {
    try {
      const data = await apiFetch('/chat/guest-limits');
      if (data.success && data.limits && data.limits.messages) {
        setGuestLimits(data.limits);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (activeConvId) {
      fetchMessages(activeConvId);
    } else {
      setMessages([]);
    }
  }, [activeConvId]); // eslint-disable-line react-hooks/exhaustive-deps

useEffect(() => {
     if (chatScrollRef.current) {
       const el = chatScrollRef.current;
       const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
       if (nearBottom) {
         el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
       }
     }
   }, [messages, loading]);

  const fetchConversations = async () => {
    try {
      const data = await apiFetch('/chat/conversations', { headers: authHeaders() });
      setConversations(data);
      if (data.length > 0 && !activeConvId) {
        setActiveConvId(data[0].ma_hoi_thoai);
      }
    } catch (e) { console.log(e); }
  };

  const fetchMessages = async (convId) => {
    try {
      const data = await apiFetch(`/chat/conversations/${convId}/messages`, { headers: authHeaders() });
      setMessages(data);
    } catch (e) { console.log(e); }
  };

  const fetchFileTree = async () => {
    try {
      const data = await apiFetch('/workspace/files', { headers: authHeaders() });
      setFileTree(data);
    } catch (e) { console.log(e); }
  };

  const fetchDbSkills = async () => {
    try {
      const data = await apiFetch('/services/skills', { headers: authHeaders() });
      setDbSkills(data);
    } catch (e) { console.log(e); }
  };

  const fetchGitStatus = async () => {
    try {
      const data = await apiFetch('/chat/git/status', { headers: authHeaders() });
      setGitStatus(data);
    } catch (e) { console.log(e); }
  };

  const fetchMemories = async () => {
    try {
      const data = await apiFetch('/chat/memory', { headers: authHeaders() });
      setMemories(data);
    } catch (e) { console.log(e); }
  };

  const fetchIPTV = async (cat, country, search) => {
    try {
      let url = '/services/iptv/channels?';
      if (country) url += `country=${country}&`;
      else if (cat) url += `category=${cat}&`;
      if (search) url += `search=${encodeURIComponent(search)}`;
      const data = await apiFetch(url, { headers: authHeaders() });
      if (data.channels) {
        setIptvChannels(data.channels);
        if (data.channels.length > 0) setSelectedChannel(data.channels[0]);
      }
    } catch (e) { console.log(e); }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (iptvTab === 'category') fetchIPTV(iptvCategory, null, iptvSearch);
      else if (iptvCountry) fetchIPTV(null, iptvCountry, iptvSearch);
      else fetchIPTV(iptvCategory || 'news', null, iptvSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [iptvSearch, iptvCategory, iptvCountry, iptvTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // HLS.js player for IPTV
  const playHlsStream = useCallback((url) => {
    const video = iptvVideoRef.current;
    if (!video) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    setIptvEmbeddedSubs([]);
    // Hàm đọc track phụ đề với delay (hls.js populate subtitleTracks chậm hơn MANIFEST_PARSED)
    const readEmbeddedSubs = (hls) => {
      setTimeout(() => {
        try {
          // Chỉ áp dụng nếu hls này vẫn là instance đang phát (tránh race khi đổi kênh nhanh)
          if (hlsRef.current !== hls) return;
          const subs = (hls.subtitleTracks || []).map(s => ({ id: s.id, name: s.name || s.lang || 'Phụ đề' }));
          if (subs.length) setIptvEmbeddedSubs(subs);
        } catch { /* ignore */ }
      }, 1200);
    };
    if (url.includes('youtube') || url.includes('youtu.be')) {
      // youtube: fallback handled in JSX
      return;
    }
    // Chơi qua proxy same-origin (đã có sẵn /api/services/iptv/proxy) để
    // video.captureStream() lấy được audio track → Phụ Đề AI hoạt động được
    // P2-19d: proxy giờ yêu cầu auth — <video>/hls.js không gửi được Authorization
    // header nên kèm token qua ?token= (backend bridge sang header).
    const _proxyToken = localStorage.getItem('rexi_token') || '';
    const streamUrl = `${API_BASE}/services/iptv/proxy?url=${encodeURIComponent(url)}${_proxyToken ? `&token=${encodeURIComponent(_proxyToken)}` : ''}`;
    let fallbackTried = false;
    const attachFallback = () => {
      // Fallback: proxy lỗi → thử phát trực tiếp URL gốc (giữ kênh chạy như trước)
      fallbackTried = true;
      try { hlsRef.current?.destroy(); } catch { /* ignore */ }
      hlsRef.current = null;
      if (Hls.isSupported()) {
        const fb = new Hls({ enableWorker: false });
        fb.loadSource(url);
        fb.attachMedia(video);
        fb.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
          readEmbeddedSubs(fb);
        });
        fb.on(Hls.Events.SUBTITLE_TRACKS_LOADED, () => readEmbeddedSubs(fb));
        hlsRef.current = fb;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.play().catch(() => {});
      }
    };
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
        readEmbeddedSubs(hls);
      });
      hls.on(Hls.Events.SUBTITLE_TRACKS_LOADED, () => readEmbeddedSubs(hls));
      hls.on(Hls.Events.ERROR, (evt, data) => {
        if (data.fatal && !fallbackTried) attachFallback();
      });
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.play().catch(() => {});
      video.onerror = () => {
        if (!fallbackTried) attachFallback();
      };
    }
  }, [iptvVideoRef, hlsRef]);

  useEffect(() => {
    if (selectedChannel) playHlsStream(selectedChannel.url);
  }, [selectedChannel, playHlsStream]);

  const fetchDesktopScreenshot = async () => {
    setDesktopLoading(true);
    setDesktopError(null);
    try {
      // Dùng fetch trực tiếp vì response là ảnh blob (apiFetch parse JSON nên không dùng được)
      const res = await fetch(`${API_BASE}/services/desktop/screenshot?t=${Date.now()}`, {
        headers: authHeaders(),
        credentials: 'include'
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setDesktopScreenshot(url);
      } else {
        setDesktopScreenshot(null);
        setDesktopError(res.status === 401
          ? 'Cần đăng nhập để dùng Remote Desktop.'
          : `Lỗi chụp màn hình (${res.status}). Thử lại sau.`);
      }
    } catch (e) {
      setDesktopScreenshot(null);
      setDesktopError(e.message || 'Không thể kết nối');
    } finally { setDesktopLoading(false); }
  };

  const fetchGitDiff = async () => {
    try {
      const d = await apiFetch('/chat/git/diff', { headers: authHeaders() });
      setGitDiff(d.diff || '');
    } catch {}
  };

  useEffect(() => {
    if (activeTab === 'iptv' && iptvChannels.length === 0) fetchIPTV('news');
    if (activeTab === 'desktop') fetchDesktopScreenshot();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewConversation = async () => {
    // Nếu cuộc trò chuyện hiện tại chưa có tin nhắn nào → không cho tạo thêm
    if (activeConvId && messages.length === 0) {
      return; // Đã có cuộc trò chuyện trống, không tạo thêm
    }
    try {
      const data = await apiFetch('/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ tieu_de: 'Trò chuyện mới', ten_mo_hinh_ai: modelName })
      });
      setConversations(prev => [data, ...prev]);
      setActiveConvId(data.ma_hoi_thoai);
      setMessages([]);
    } catch (e) { console.error(e); }
  };

  const handleDeleteConversation = async (id, e) => {
    e.stopPropagation();
    try {
      await apiFetch(`/chat/conversations/${id}`, { method: 'DELETE', headers: authHeaders() });
      setConversations(prev => prev.filter(c => c.ma_hoi_thoai !== id));
      if (activeConvId === id) setActiveConvId(null);
    } catch (e) { console.error(e); }
  };

  // Đính kèm file: ảnh → downscale (giữ vision, chặn base64 khổng lồ phình prompt/DB);
  // file text → đọc text cắt 15k ký tự; binary khác → từ chối (PDF dùng nút PDF riêng).
  const MAX_IMAGE_DIM = 1568;
  const MAX_IMAGE_OUT = 4 * 1024 * 1024; // base64 ảnh sau xử lý
  const MAX_TEXT_IN = 100 * 1024; // text đầu vào
  const MAX_TEXT_SEND = 15000; // text gửi vào prompt

  const downscaleImage = (dataUrl) => new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          let q = 0.85, out = cv.toDataURL('image/jpeg', q);
          while (out.length > MAX_IMAGE_OUT && q > 0.4) { q -= 0.15; out = cv.toDataURL('image/jpeg', q); }
          resolve(out.length <= MAX_IMAGE_OUT ? out : null);
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch { resolve(null); }
  });

  const handleFileSelect = (e) => {
    Array.from(e.target.files || []).forEach((file) => {
      const reader = new FileReader();
      const isImage = (file.type || '').startsWith('image/');
      const isText = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded))/.test(file.type || '')
        || /\.(txt|md|csv|json|js|ts|py|java|html?|css|xml|log|ini|cfg)$/i.test(file.name || '');
      if (isImage) {
        if (file.size > 15 * 1024 * 1024) { showToast?.(`Ảnh ${file.name} quá lớn (>15MB), bỏ qua.`, 'error'); return; }
        reader.readAsDataURL(file);
        reader.onload = async () => {
          const small = await downscaleImage(String(reader.result || ''));
          if (!small) { showToast?.(`Không xử lý được ảnh ${file.name}.`, 'error'); return; }
          setAttachedFiles(p => [...p, { name: file.name, isImage: true, dataUrl: small }]);
        };
      } else if (isText) {
        if (file.size > MAX_TEXT_IN) { showToast?.(`File ${file.name} quá lớn (>100KB), bỏ qua.`, 'error'); return; }
        reader.readAsText(file);
        reader.onload = () => {
          const t = String(reader.result || '');
          const cut = t.length > MAX_TEXT_SEND ? t.slice(0, MAX_TEXT_SEND) + `\n...[đã cắt, file dài ${t.length} ký tự]` : t;
          setAttachedFiles(p => [...p, { name: file.name, isImage: false, isBinary: false, textContent: cut }]);
        };
      } else {
        showToast?.(`Không hỗ trợ file ${file.name} ở đây (PDF dùng nút 📄, ảnh/text mới đính kèm được).`, 'error');
      }
    });
    e.target.value = '';
  };

  const handleSendMessage = async (textToSend) => {
    let text = textToSend || inputText;
    if (!text.trim() && attachedFiles.length === 0) return;
    if (loading) return;

    // ─── INTENT ROUTER: nhận diện ý định câu chat → tự mở tab phù hợp ───
    // Chỉ auto-chuyển tab khi chưa bật Agent Mode và câu có ý định rõ ràng (high confidence)
    if (executionMode !== 'agent' && attachedFiles.length === 0) {
      try {
        const intentRes = await apiFetch('/chat/intent', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ noi_dung: text })
        });
        if (intentRes && intentRes.success && intentRes.confidence === 'high' && intentRes.tab && intentRes.tab !== 'chat') {
          handleSetActiveTab(intentRes.tab);
          showToast(`Đã chuyển sang: ${intentRes.label}`, 'info');
          return;
        }
      } catch (e) { /* intent lỗi không chặn chat */ }
    }

    if (attachedFiles.length > 0) {
      attachedFiles.forEach(f => {
        text += f.isImage ? `\n\n![${f.name}](${f.dataUrl})` :
          f.isBinary ? `\n\n[File: ${f.name}](${f.dataUrl})` :
          `\n\n\`\`\`${f.name}\n${f.textContent}\n\`\`\``;
      });
    }

    let convId = activeConvId;
    if (!convId) {
      try {
        const data = await apiFetch('/chat/conversations', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ tieu_de: text.replace(/!\[.*?\]\(.*?\)/g, '').substring(0, 30), ten_mo_hinh_ai: modelName })
        });
        convId = data.ma_hoi_thoai;
        setActiveConvId(convId);
        setConversations(prev => [data, ...prev]);
      } catch (e) {
        console.error('[Chat] Không tạo được hội thoại:', e);
        convId = null;
      }
    }

    // Double-check: nếu vẫn chưa có convId (có thể do race condition), báo lỗi thay vì gửi vào path rỗng
    if (!convId) {
      setMessages(prev => [...prev, {
        ma_tin_nhan: Date.now().toString(),
        vai_tro: 'assistant',
        noi_dung: '⚠️ Không thể tạo cuộc trò chuyện. Vui lòng thử lại.'
      }]);
      setLoading(false);
      return;
    }

    const tempUserMsg = { ma_tin_nhan: Date.now().toString(), vai_tro: 'user', noi_dung: text };
    setMessages(prev => [...prev, tempUserMsg]);
    setInputText('');
    setAttachedFiles([]);
    setLoading(true);
    let streamStarted = false;
    const streamMsgId = 'stream_' + Date.now();

    try {
      // Dùng fetch trực tiếp (không qua apiFetch) vì cần đọc SSE stream từ Response
      const res = await fetch(`${API_BASE}/chat/conversations/${convId}/messages/stream`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          vai_tro: 'user',
          noi_dung: text,
          provider: provider,
          client_api_key: apiKey,
          model_name: modelName,
          base_url: baseUrl,
          mode: aiSpecialty,
          execution_mode: executionMode,
          agent_engine: agentEngine,
          thinking_level: reasoning ? 'deep' : 'normal'
        })
      });

      // Rate Limit (429) — middleware trả JSON trước khi vào SSE handler
      if (res.status === 429) {
        setRateLimitToast('Quá nhiều yêu cầu trong thời gian ngắn (Rate Limit Exceeded). Vui lòng đợi 1 phút.');
        if (rateLimitTimerRef.current) clearTimeout(rateLimitTimerRef.current);
        rateLimitTimerRef.current = setTimeout(() => setRateLimitToast(''), 5000);
        return;
      }

      // Guest limit / yêu cầu đăng nhập (401) — middleware trả JSON
      if (res.status === 401) {
        const errorData = await res.json().catch(() => ({}));
        // Token không hợp lệ / hết hạn → xóa token cũ + mở lại màn hình đăng nhập
        if (errorData.code === 'INVALID_TOKEN') {
          window.dispatchEvent(new CustomEvent('rexi_session_expired', { detail: errorData.error }));
          return;
        }
        if (errorData.code === 'LOGIN_REQUIRED' || errorData.code === 'AGENT_LIMIT_REACHED') {
          const isAgentLimit = errorData.code === 'AGENT_LIMIT_REACHED';
          setMessages(prev => [...prev.filter(m => m.ma_tin_nhan !== tempUserMsg.ma_tin_nhan), tempUserMsg, {
            ma_tin_nhan: Date.now().toString(),
            vai_tro: 'assistant',
            noi_dung: isAgentLimit
                ? `🔒 **Đã hết lượt Agent Mode.**\n\nBạn đã dùng hết **3 lượt** Agent cho tài khoản khách.\n\nĐăng nhập để:\n✅ Agent Mode không giới hạn\n✅ Chat không giới hạn\n✅ Lưu lịch sử & Memory`
                : `🔒 **Đã hết lượt chat.**\n\nBạn đã dùng hết **10 tin nhắn** cho tài khoản khách.\n\nĐăng nhập để:\n✅ Chat không giới hạn\n✅ Agent Mode không giới hạn\n✅ Lưu lịch sử & Memory`
          }]);
          fetchGuestLimits();
          setTimeout(() => setAuthModalOpen(true), 500);
        }
        return;
      }

      // Fallback: response không phải SSE (backend trả JSON lỗi khác) → xử lý JSON
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        if (res.ok) {
          const aiMsg = await res.json();
          setMessages(prev => [...prev.filter(m => m.ma_tin_nhan !== tempUserMsg.ma_tin_nhan), tempUserMsg, aiMsg]);
          fetchConversations();
          if (!currentUser) fetchGuestLimits();
        } else {
          setMessages(prev => [...prev.filter(m => m.ma_tin_nhan !== tempUserMsg.ma_tin_nhan), tempUserMsg, {
            ma_tin_nhan: Date.now().toString(), vai_tro: 'assistant',
            noi_dung: `⚠️ Lỗi Server (${res.status}). Hãy kiểm tra Backend đã chạy chưa và API Key trong mục Cài Đặt!`
          }]);
        }
        return;
      }

      // ---- Đọc SSE stream: hiển thị token theo thời gian thực ----
      streamStarted = true;
      let aiText = '';
      let finalMaTinNhan = streamMsgId;
      setMessages(prev => [...prev.filter(m => m.ma_tin_nhan !== tempUserMsg.ma_tin_nhan), tempUserMsg, { ma_tin_nhan: streamMsgId, vai_tro: 'assistant', noi_dung: '' }]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      const updateAI = (t) => setMessages(prev => prev.map(m => m.ma_tin_nhan === streamMsgId ? { ...m, noi_dung: t } : m));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop();
        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith('data: ')) continue;
          let payload;
          try { payload = JSON.parse(line.slice(6)); } catch { continue; }
          if (payload.type === 'route') {
            // Định tuyến: hiển thị provider/model hệ thống tự chọn
            const cat = payload.category || 'auto';
            const routeBadge = `📡 **Định tuyến (Auto):** ${(payload.provider || '').toUpperCase()} → \`${payload.model || ''}\` (loại: ${cat})`;
            aiText += '\n\n<small>' + routeBadge + '</small>\n\n';
            updateAI(aiText);
          }
          else if (payload.type === 'token') { aiText += payload.text; updateAI(aiText); }
          else if (payload.type === 'status') { if (!aiText) updateAI(payload.message); }
          else if (payload.type === 'error') { aiText = aiText ? aiText + '\n\n⚠️ ' + payload.message : payload.message; updateAI(aiText); }
          else if (payload.type === 'done') { finalMaTinNhan = payload.ma_tin_nhan || finalMaTinNhan; if (payload.noi_dung) { aiText = payload.noi_dung; updateAI(aiText); } }
        }
      }

      // Cập nhật ma_tin_nhan cuối (khớp DB) + làm sạch thông báo lỗi hệ thống & suy luận nháp
      setMessages(prev => prev.map(m => {
        if (m.ma_tin_nhan !== streamMsgId) return m;
        let finalText = aiText;
        if (finalText && /Here'?s a thinking process:/i.test(finalText)) {
          const finalMatch = finalText.match(/(?:Output matches draft|Final Output|Output):\s*([✅\s\S]+)$/i);
          if (finalMatch && finalMatch[1]) finalText = finalMatch[1].replace(/^[✅\s]+/, '').trim();
          else {
            const draftMatch = finalText.match(/Draft:\s*"([^"]+)"/i);
            if (draftMatch && draftMatch[1]) finalText = draftMatch[1].trim();
          }
        }
        if (finalText && (finalText.includes('The filename, directory name') || finalText.includes('syntax is incorrect'))) {
          finalText = `Xin chào **${currentUser?.ten_day_du || 'USER'}**! Tôi là **AI Rexi Assistant**.\n\nHệ thống đã sẵn sàng 100% với bộ **35+ Skills Agent**, Quản Lý Files Workspace, Live IPTV & Remote Desktop Control. Bạn muốn tôi làm gì giúp bạn?`;
        }
        return { ...m, ma_tin_nhan: finalMaTinNhan, noi_dung: finalText };
      }));
      fetchConversations();
      if (!currentUser) fetchGuestLimits();
    } catch {
      if (streamStarted) {
        setMessages(prev => prev.map(m => m.ma_tin_nhan === streamMsgId ? { ...m, noi_dung: (m.noi_dung || '') + '\n\n⚠️ Kết nối stream bị ngắt.' } : m));
      } else {
        setMessages(prev => [...prev, {
          ma_tin_nhan: Date.now().toString(),
          vai_tro: 'assistant',
          noi_dung: `⚠️ Không thể kết nối tới Server Backend. Hãy kiểm tra Backend đã chạy chưa và API Key trong mục Cài Đặt!`
        }]);
      }
    } finally {
      setLoading(false);
    }
  };

  const recognitionRef = useRef(null);
  const [voiceTranscript, setVoiceTranscript] = useState('');

  const startVoice = async () => {
    // Nếu đang nghe → bấm lại để DỪNG
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      showToast('Đã dừng ghi âm — chữ đã vào ô chat, bấm gửi nhé!', 'info');
      return;
    }
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert("Trình duyệt không hỗ trợ Web Speech API.");
      return;
    }
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const r = new SR();
      recognitionRef.current = r;
      r.lang = 'vi-VN';
      r.interimResults = true;
      r.continuous = true;
      // Dùng biến local để tránh stale-closure khi đọc transcript trong onend
      let recognizedText = '';
      r.onstart = () => { setListening(true); setVoiceTranscript(''); };
      r.onend = () => {
        setListening(false);
        recognitionRef.current = null;
        if (recognizedText && recognizedText.trim()) {
          showToast('🎙️ Đã chuyển giọng nói thành chữ — bấm gửi nhé!', 'info');
        }
        setVoiceTranscript('');
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed') alert("Cấp quyền Micro cho trình duyệt để sử dụng.");
        setListening(false);
        recognitionRef.current = null;
        setVoiceTranscript('');
      };
      r.onresult = (e) => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
        }
        recognizedText = text;
        setVoiceTranscript(text);
        setInputText(text);
      };
      r.start();
    } catch { alert("Cấp quyền Micro cho trình duyệt để sử dụng."); }
  };

  const speakText = (text, id) => {
    const cleanText = text.replace(/<[^>]*>/g, '').replace(/[*#`_]/g, '').trim();
    if (!cleanText) return;

    // Nếu đang đọc tin nhắn này thì dừng
    if (speakingMsgId === id) {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setSpeakingMsgId(null);
      return;
    }

    // Dừng bất kỳ đọc nào đang chạy
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    const useServerTTS = ttsUsingServer && !ttsServerBrokenRef.current && cleanText.length <= 2000;

    if (useServerTTS) {
      // Dùng Backend TTS (edge-tts, chất lượng cao)
      setSpeakingMsgId(id);
      setTtsUsingServer(true);
      fetch(`${API_BASE}/services/tts`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          text: cleanText,
          voice: ttsVoice,
          rate: ttsRate,
          pitch: ttsPitch
        })
      })
        .then(r => r.json())
        .then(data => {
          if (data.success && data.audio) {
            const audio = new Audio('data:audio/mp3;base64,' + data.audio);
            audio.play().catch(e => {
              console.warn('[Audio Play Error]:', e.message);
              setSpeakingMsgId(null);
            });
            audio.onended = () => setSpeakingMsgId(null);
            audio.onerror = () => setSpeakingMsgId(null);
          } else {
            throw new Error(data.error || 'TTS server failed');
          }
        })
        .catch(err => {
          console.warn('[TTS] Server failed, falling back to browser (setting user giữ nguyên):', err.message);
          ttsServerBrokenRef.current = true; // tạm tắt server TTS cho phiên này, không ghi đè localStorage
          speakBrowser(cleanText, id);
        });
    } else {
      speakBrowser(cleanText, id);
    }
  };

  const speakBrowser = (text, id) => {
    if ('speechSynthesis' in window) {
      setSpeakingMsgId(id);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'vi-VN';
      utterance.rate = 1.0;
      utterance.onend = () => setSpeakingMsgId(null);
      window.speechSynthesis.speak(utterance);
    }
  };

  const copyToClipboard = (text, id) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      }).catch(() => {
        fallbackCopy(text, id);
      });
    } else {
      fallbackCopy(text, id);
    }
  };
  const fallbackCopy = (text, id) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      console.warn('Copy failed');
    }
  };

  const exportMd = () => {
    const title = conversations.find(c => c.ma_hoi_thoai === activeConvId)?.tieu_de || 'rexi_chat';
    const md = messages.map(m => `### ${m.vai_tro === 'user' ? '👤 Bạn' : '🤖 Rexi'}\n${m.noi_dung}`).join('\n\n---\n\n');
    // Giữ chữ Unicode (kể cả tiếng Việt) trong tên file, chỉ bỏ ký tự cấm của Windows
    const safeName = (title.replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '_') || 'rexi_chat').slice(0, 80);
    const blobUrl = URL.createObjectURL(new Blob([`# ${title}\n\n${md}`], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), {
      href: blobUrl,
      download: safeName + '.md'
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  };

  const handleOpenFile = async (fileRelPath) => {
    try {
      const data = await apiFetch(`/workspace/file-content?path=${encodeURIComponent(fileRelPath)}`, { headers: authHeaders() });
      setSelectedFile(fileRelPath);
      setFileContent(data.content);
      handleSetActiveTab('code');
    } catch (e) { console.error(e); }
  };

  const handleSaveFile = async () => {
    if (!selectedFile) return;
    setSavingFile(true);
    try {
      await apiFetch('/workspace/file-content', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: fileContent })
      });
      alert('Đã lưu tệp tin thành công!');
    } catch (e) { alert('Lỗi lưu file: ' + e.message); }
    finally { setSavingFile(false); }
  };

  const handleExecCommand = async () => {
    if (!execCommand.trim()) return;
    try {
      const data = await apiFetch('/chat/exec', {
        method: 'POST',
        headers: { ...authHeaders(), 'X-Exec-Confirm': 'yes' },
        body: JSON.stringify({ command: execCommand })
      });
      setExecOutput(data.stdout || data.stderr || data.error || 'Thực thi thành công.');
    } catch (e) { setExecOutput('Lỗi thực thi: ' + e.message); }
  };

  const handleAddMemory = async () => {
    if (!newMemory.trim()) return;
    try {
      await apiFetch('/chat/memory', {
        method: 'POST',
        body: JSON.stringify({ loai: 'thong_tin_user', noi_dung: newMemory })
      });
      setNewMemory('');
      fetchMemories();
    } catch (e) { console.error(e); }
  };



  const handleAuthSubmit = async () => {
    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
      const body = authMode === 'login'
        ? { email: authEmail, password: authPassword }
        : { email: authEmail, password: authPassword, ten_day_du: authFullName };

      const data = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (data.success && data.token) {
        setAuthToken(data.token);
        localStorage.setItem('rexi_token', data.token);
        if (data.user) {
          setCurrentUser(data.user);
          localStorage.setItem('rexi_user', JSON.stringify(data.user));
        }
        setAuthModalOpen(false);
      } else if (authMode === 'register' && data.success) {
        setAuthMode('login');
        alert('Đăng ký thành công! Vui lòng đăng nhập.');
      } else {
        alert(data.error || 'Đăng nhập thất bại');
      }
    } catch (e) {
      console.error('[Auth] Login failed:', e);
      // Nếu server trả lỗi cụ thể (vd sai mật khẩu) thì hiện lỗi đó thay vì thông báo chung
      alert(e.message && !e.message.includes('HTTP')
        ? e.message
        : 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng hoặc khởi động lại server AI Rexi.');
    }
  };



  // Google Sign-In Handler


  // Open Google OAuth popup → backend callback redirects popup to localhost:5173?google_token=...
  // Parent window detects token via storage event listener (useEffect above)
  const openGoogleOAuth = () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      alert('Google Client ID chưa cấu hình. Vui lòng thêm VITE_GOOGLE_CLIENT_ID vào file .env');
      return;
    }
    const redirectUri = `${window.location.origin}/api/auth/google/callback`;
    const scope = 'email profile';
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      prompt: 'select_account',
      access_type: 'offline'
    });
    
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    const width = 500, height = 600;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;
    
    window.open(
      googleAuthUrl,
      'google_oauth',
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,noopener,noreferrer`
    );
  };


  const renderTree = (nodes) => nodes.map(node => (
    <div key={node.path}>
      {node.type === 'folder' ? (
        <div className="mt-1">
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-slate-400 font-medium">
            <Folder size={13} className="text-amber-400" /><span>{node.name}</span>
          </div>
          {node.children && <div className="ml-3 border-l border-white/5 pl-2">{renderTree(node.children)}</div>}
        </div>
      ) : (
        <button
          onClick={() => handleOpenFile(node.path)}
          className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-xs text-left transition-colors ${selectedFile === node.path ? 'bg-cyan-500/20 text-cyan-300 font-medium' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
        >
          <FileCode size={12} className="text-cyan-400 shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
      )}
    </div>
  ));

  const filteredConvs = conversations.filter(c => 
    (c.tieu_de || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)] font-sans antialiased">
      

      {/* ═══════════════════ SIDEBAR NAVIGATION ═══════════════════ */}
      <Sidebar
        sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
        activeTab={activeTab} setActiveTab={handleSetActiveTab}
        conversations={conversations} filteredConvs={filteredConvs}
        searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        activeConvId={activeConvId} setActiveConvId={setActiveConvId}
        handleNewConversation={handleNewConversation}
        handleDeleteConversation={handleDeleteConversation}
        filesDrawerOpen={filesDrawerOpen} setFilesDrawerOpen={setFilesDrawerOpen}
        renderTree={renderTree} fileTree={fileTree}
         setSkillsOpen={setSkillsOpen} setSuperToolsOpen={setSuperToolsOpen} setHelpOpen={setHelpOpen}
        currentUser={currentUser} setCurrentUser={setCurrentUser} setAuthToken={setAuthToken}
        setAuthModalOpen={setAuthModalOpen} setSettingsOpen={setSettingsOpen}
        apiFetch={apiFetch} API_BASE={API_BASE} showToast={showToast} setConversations={setConversations}
      />

      {/* ═══════════════════ MAIN WORKSPACE AREA ═══════════════════ */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-main)]">
        
        {/* Guest Mode Banner */}
        {!currentUser && (
          <div className="bg-blue-500/10 border-b border-blue-500/25 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 text-xs text-blue-200/90">
                <span className="text-blue-400">👤</span>
                <span className="font-semibold text-blue-300">Chế độ Khách</span>
              </span>
              <span className="flex items-center gap-1.5 text-[11px]">
                <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold">{guestLimits.messages.remaining}</span>
                <span className="text-blue-200/60">/ {guestLimits.messages.limit} tin nhắn</span>
              </span>
              <span className="flex items-center gap-1.5 text-[11px]">
                <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold">{guestLimits.agentTasks.remaining}</span>
                <span className="text-blue-200/60">/ {guestLimits.agentTasks.limit} Agent tasks</span>
              </span>
            </div>
            <button 
              onClick={() => setAuthModalOpen(true)}
              className="text-[11px] font-semibold px-3 py-1 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 transition-all"
            >
              Đăng nhập →

            </button>
          </div>
        )}

        {/* Top Header Bar (Hiển thị ở mọi tab, trừ Browser) */}
        {activeTab !== 'browser' && (
        <header className="relative z-50 min-h-14 py-2 px-3 border-b border-white/5 flex flex-wrap items-center justify-between gap-2 bg-[var(--bg-sidebar)] backdrop-blur-md">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-xl hover:bg-white/10 text-slate-300 transition-colors shrink-0"
              >
                <Menu size={18} />
              </button>
            )}

            {/* Model & Specialty Selectors */}
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <ModelSelectorPopover
                availableModels={availableModels}
                modelName={modelName}
                setModelName={setModelName}
                setProvider={setProvider}
              />

              <select
                value={aiSpecialty}
                onChange={e => setAiSpecialty(e.target.value)}
                className="bg-[#131417] text-xs font-medium text-slate-300 border border-white/10 rounded-xl px-3 py-1.5 outline-none cursor-pointer hover:border-white/20 transition-all shrink-0 min-w-[170px]"
              >
                {AI_SPECIALTIES.map(s => (
                  <option key={s.id} value={s.id} className="bg-[#1e1f20] text-slate-200">
                    {s.name}
                  </option>
                ))}
              </select>



              <select
                value={thinkingLevel}
                onChange={e => setThinkingLevel(e.target.value)}
                className="bg-[#131417] text-xs text-slate-300 border border-white/10 rounded-xl px-2.5 py-1.5 outline-none cursor-pointer"
              >
                <option value="standard">Nhanh (Standard)</option>
                <option value="deep">Suy Luận Sâu (Deep Think)</option>
              </select>
            </div>
          </div>

          {/* Action Tools */}
          <div className="flex items-center gap-2">
            <button
              onClick={exportMd}
              className="px-2.5 py-1.5 rounded-xl bg-[#131417] border border-white/10 text-xs text-slate-300 hover:text-white flex items-center gap-1"
              title={t(lang, 'exportMd')}
            >
              <Download size={13} /> {lang === 'vi' ? 'Markdown' : 'Markdown'}
            </button>

            {/* Language Toggle — Đổi ngôn ngữ Việt/English */}
            <button
              onClick={() => { const next = lang === 'vi' ? 'en' : 'vi'; setLang(next); setLangState(next); }}
              title={lang === 'vi' ? 'Switch to English' : 'Chuyển sang tiếng Việt'}
              className="px-2.5 py-1.5 rounded-xl bg-[#131417] border border-white/10 text-xs text-slate-300 hover:text-cyan-400 hover:border-cyan-500/40 flex items-center gap-1 transition-all"
            >
              <Languages size={13} /> {lang === 'vi' ? 'EN' : 'VI'}
            </button>

            {/* TTS Voice Selector */}
            <div className="flex items-center gap-1.5">
              <select
                title="Chuyển đổi giọng nói thành server (edge-tts)"
                value={ttsUsingServer ? 'server' : 'browser'}
                onChange={e => {
                  const useServer = e.target.value === 'server';
                  setTtsUsingServer(useServer);
                  localStorage.setItem('rexi_tts_mode', useServer ? 'server' : 'browser');
                }}
                className="bg-[#131417] text-[10px] font-medium text-slate-300 border border-white/10 rounded-xl px-2 py-1 outline-none cursor-pointer hover:border-cyan-500/40 transition-all shrink-0"
              >
                <option value="browser" className="bg-[#1e1f20] text-slate-200">Trình duyệt (miễn phí)</option>
                <option value="server" className="bg-[#1e1f20] text-cyan-300">Server (edge-tts chất lượng cao)</option>
              </select>

              {ttsUsingServer && ttsVoices.length > 0 && (
                <select
                  title="Chọn giọng đọc tiếng Việt"
                  value={ttsVoice}
                  onChange={e => {
                    setTtsVoice(e.target.value);
                    localStorage.setItem('rexi_tts_voice', e.target.value);
                  }}
                  className="bg-[#131417] text-[10px] font-medium text-cyan-300 border border-cyan-500/30 rounded-xl px-2 py-1 outline-none cursor-pointer hover:border-cyan-400 transition-all shrink-0 max-w-[180px] truncate"
                >
                  {ttsVoices.map(v => (
                    <option key={v.id} value={v.id} className="bg-[#1e1f20] text-slate-200">
                      {v.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <select
              value={currentTheme}
              onChange={e => setCurrentTheme(e.target.value)}
              className="bg-[#131417] text-xs text-slate-300 border border-white/10 rounded-xl px-2.5 py-1.5 outline-none cursor-pointer"
            >
              <option value="tokyo-night">Tokyo Night</option>
              <option value="dracula">Dracula</option>
              <option value="catppuccin">Catppuccin</option>
              <option value="cyberpunk">Cyberpunk</option>
              <option value="nord">Nord</option>
              <option value="storeify">Storeify</option>
              <option value="light">Light</option>
            </select>
          </div>
        </header>
        )}

        {/* Tab Router Content */}
        <div className="flex-1 overflow-hidden relative">
          
          {/* TAB 1: AI CHAT WORKSPACE */}
          {activeTab === 'chat' && (
            <ChatTab
              messages={messages} inputText={inputText} setInputText={setInputText}
              loading={loading} attachedFiles={attachedFiles}
              executionMode={executionMode} setExecutionMode={setExecutionMode}
              agentEngine={agentEngine} setAgentEngine={setAgentEngine}
              chatModeOpen={chatModeOpen} setChatModeOpen={setChatModeOpen}
              listening={listening} voiceTranscript={voiceTranscript} copiedId={copiedId} speakingMsgId={speakingMsgId}
               handleSendMessage={handleSendMessage} startVoice={startVoice}
               speakText={speakText} copyToClipboard={copyToClipboard} lang={lang}
               ttsUsingServer={ttsUsingServer}
              fileInputRef={fileInputRef} handleFileSelect={handleFileSelect}
              chatScrollRef={chatScrollRef} handleChatScroll={handleChatScroll}
              showScrollTop={showScrollTop} showScrollBottom={showScrollBottom}
              scrollToTopSmooth={scrollToTopSmooth} scrollToBottomSmooth={scrollToBottomSmooth}
              currentUser={currentUser}
              reasoning={reasoning} setReasoning={setReasoning}
              onOpenFeature={handleSetActiveTab}
            />
          )}

          {/* TAB 2 & 3: CODE EDITOR & WORKSPACE FILES */}
          {(activeTab === 'code' || activeTab === 'files') && (
            <CodeEditorTab
              selectedFile={selectedFile} fileContent={fileContent}
              setFileContent={setFileContent} savingFile={savingFile}
              handleSaveFile={handleSaveFile} liveHtml={liveHtml}
              setLiveHtml={setLiveHtml}
            />
          )}

          {/* TAB 4: IPTV LIVE TV */}
          {activeTab === 'iptv' && (
            <IPTVTab
              iptvTab={iptvTab} setIptvTab={setIptvTab}
              iptvCategory={iptvCategory} setIptvCategory={setIptvCategory}
              iptvCountry={iptvCountry} setIptvCountry={setIptvCountry}
              iptvSearch={iptvSearch} setIptvSearch={setIptvSearch}
              iptvChannels={iptvChannels} selectedChannel={selectedChannel}
              setSelectedChannel={setSelectedChannel} fetchIPTV={fetchIPTV}
              iptvVideoRef={iptvVideoRef}
              iptvSubtitleOn={iptvSubtitleOn} setIptvSubtitleOn={setIptvSubtitleOn}
              iptvEmbeddedSubs={iptvEmbeddedSubs}
              hlsRef={hlsRef}
            />
          )}

          {/* TAB 5a: TTS STUDIO */}
          {activeTab === 'tts' && (
            <StudioTab
              API_BASE={API_BASE}
              authToken={authToken}
              showToast={showToast}
            />
          )}

          {/* TAB 5b: VIDEO CREATOR */}
          {activeTab === 'video' && (
            <VideoCreatorTab
              API_BASE={API_BASE}
              authToken={authToken}
              showToast={showToast}
            />
          )}

          {/* TAB 5d: TẠO ẢNH AI (Gemini Image) */}
          {activeTab === 'image' && (
            <ImageGenTab
              API_BASE={API_BASE}
              authToken={authToken}
              showToast={showToast}
              imageModels={allModels.filter(m => m.modality === 'image')}
            />
          )}

          {/* TAB: ĐỌC & HIỂU FILE (RAG) */}
          {activeTab === 'documents' && (
            <DocumentsTab
              API_BASE={API_BASE}
              authToken={authToken}
              showToast={showToast}
            />
          )}

          {/* TAB 5c: OPENCUT EDITOR */}
          {activeTab === 'opencut' && (
            <OpenCutTab
              showToast={showToast}
            />
          )}

          {/* TAB 5d: YOUTUBE FREE (không quảng cáo) */}
          {activeTab === 'youtube' && (
            <YouTubeTab
              authToken={authToken}
              showToast={showToast}
            />
          )}

          {/* TAB 5e: GAME ZONE (HTML5 games) */}
          {activeTab === 'games' && (
            <GameTab showToast={showToast} />
          )}

          {/* TAB 6: REMOTE DESKTOP CONTROL */}
          {activeTab === 'desktop' && (
            <div className="flex flex-col h-full w-full p-4 bg-[#0d0e11] space-y-3">
              <div className="flex items-center justify-between bg-[#181920] p-3 rounded-2xl border border-white/5">
                <div className="flex items-center gap-2">
                  <Monitor className="text-cyan-400" size={18} />
                  <span className="text-xs font-bold text-white">Chụp & Điều Khiển Màn Hình (Remote Desktop)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">Chụp màn hình qua PowerShell</span>
                  <button
                    onClick={fetchDesktopScreenshot}
                    disabled={desktopLoading}
                    className="px-3 py-1.5 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-medium flex items-center gap-1 hover:bg-cyan-500/30 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={desktopLoading ? 'animate-spin' : ''} />
                    {desktopLoading ? 'Đang chụp...' : 'Cập Nhật Màn Hình'}
                  </button>
                </div>
              </div>

              <div
                className="flex-1 border border-white/10 rounded-2xl bg-black overflow-hidden flex items-center justify-center cursor-crosshair"
                onClick={async (e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const xPct = ((e.clientX - rect.left) / rect.width).toFixed(4);
                  const yPct = ((e.clientY - rect.top) / rect.height).toFixed(4);
                  await apiFetch('/services/desktop/click', {
                    method: 'POST', headers: authHeaders(),
                    body: JSON.stringify({ x_percent: parseFloat(xPct), y_percent: parseFloat(yPct) })
                  });
                  setTimeout(fetchDesktopScreenshot, 600);
                }}
                title="Click vào ảnh để điều khiển chuột"
              >
                {desktopScreenshot ? (
                  <img src={desktopScreenshot} alt="Desktop" className="max-h-full max-w-full object-contain" />
                ) : desktopError ? (
                  <div className="text-center space-y-2">
                    <Monitor size={40} className="mx-auto text-red-500" />
                    <p className="text-xs text-red-400">{desktopError}</p>
                    <p className="text-[11px] text-slate-600">Nhấn "Cập Nhật Màn Hình" để thử lại</p>
                  </div>
                ) : (
                  <div className="text-center space-y-2">
                    <Monitor size={40} className="mx-auto text-slate-600" />
                    <p className="text-xs text-slate-500">Bấm nút &ldquo;Cập Nhật Màn Hình&rdquo; để chụp desktop</p>
                    <p className="text-[11px] text-slate-600">⚠️ Cần chạy backend trong cùng phiên Windows (không headless)</p>
                  </div>
                )}
              </div>
            </div>
          )}

           {/* TAB 6: BROWSER AGENT (Playwright + Stagehand) */}
          {activeTab === 'browser' && (
            <BrowserView token={authToken} currentUser={currentUser} onClose={() => setActiveTab('chat')} />
          )}

           {/* TAB 7: ADMIN PANEL */}
          {activeTab === 'admin' && currentUser?.phan_quyen === 'admin' && (
            <AdminPanel token={authToken} currentUser={currentUser} onClose={() => setActiveTab('chat')} />
          )}

        </div>
      </main>

      {/* ═══════════════════ SKILLS MODAL (DATABASE SKILLS) ═══════════════════ */}
      <SkillsModal skillsOpen={skillsOpen} setSkillsOpen={setSkillsOpen} dbSkills={dbSkills} />

      {/* Super Tools Modal (Exec, Git, Memory) */}
      {superToolsOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#181920] border border-white/10 rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <Zap className="text-amber-400" size={20} />
                <h3 className="text-sm font-bold text-white">Super Tools (Terminal Exec, Git & Memory)</h3>
              </div>
              <button onClick={() => setSuperToolsOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1 text-xs">
              {/* Terminal Exec */}
              <div className="space-y-2 bg-[#131417] p-3 rounded-xl border border-white/5">
                <h4 className="font-bold text-slate-200 flex items-center gap-1.5"><Terminal size={14} className="text-cyan-400" /> Terminal Exec</h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={execCommand}
                    onChange={e => setExecCommand(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleExecCommand()}
                    placeholder="Lệnh CLI (vd: dir, git status, node -v)..."
                    className="flex-1 bg-[#181920] border border-white/10 rounded-xl px-3 py-1.5 text-slate-200 outline-none font-mono"
                  />
                  <button onClick={handleExecCommand} className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-white rounded-xl font-medium">▶ Chạy</button>
                </div>
                {execOutput && (
                  <pre className="p-3 bg-black rounded-lg font-mono text-[11px] text-emerald-400 overflow-x-auto max-h-40 whitespace-pre-wrap">{execOutput}</pre>
                )}
              </div>

              {/* Git Manager */}
              <div className="space-y-2 bg-[#131417] p-3 rounded-xl border border-white/5">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-200 flex items-center gap-1.5"><GitBranch size={14} className="text-emerald-400" /> 🌿 Git Repository Manager</h4>
                  <button onClick={() => { fetchGitStatus(); fetchGitDiff(); }} className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1"><RefreshCw size={10} /> Refresh</button>
                </div>
                {gitStatus ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 p-2 bg-[#181920] rounded-lg">
                      <GitBranch size={12} className="text-emerald-400" />
                      <span className="text-emerald-300 font-mono font-bold">{gitStatus.branch}</span>
                      <span className="text-slate-400">| {gitStatus.changes?.length || 0} thay đổi</span>
                    </div>
                    {gitStatus.changes && gitStatus.changes.length > 0 && (
                      <div className="space-y-1 max-h-24 overflow-y-auto">
                        {gitStatus.changes.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 px-2 py-0.5 rounded font-mono text-[10px]">
                            <span className={c.startsWith('M') ? 'text-amber-400' : c.startsWith('?') ? 'text-slate-500' : 'text-emerald-400'}>{c.substring(0,2)}</span>
                            <span className="text-slate-300">{c.substring(3)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {gitDiff && (
                      <pre className="p-2 bg-black rounded-lg font-mono text-[10px] text-slate-300 overflow-x-auto max-h-32 whitespace-pre-wrap">{gitDiff.substring(0, 1500)}{gitDiff.length > 1500 ? '\n...[truncated]' : ''}</pre>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-500">Bấm Refresh để tải trạng thái Git...</p>
                )}
              </div>

              {/* Long-term Memory */}
              <div className="space-y-2 bg-[#131417] p-3 rounded-xl border border-white/5">
                <h4 className="font-bold text-slate-200 flex items-center gap-1.5"><Database size={14} className="text-purple-400" /> Bộ Nhớ Dài Hạn AI</h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMemory}
                    onChange={e => setNewMemory(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddMemory()}
                    placeholder="Ghi nhớ quy tắc, thông tin cá nhân..."
                    className="flex-1 bg-[#181920] border border-white/10 rounded-xl px-3 py-1.5 text-slate-200 outline-none"
                  />
                  <button onClick={handleAddMemory} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium">+ Lưu</button>
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {memories.length === 0 ? (
                    <p className="text-slate-500 text-center py-2">Chưa có bộ nhớ nào. Thêm quy tắc để AI ghi nhớ vĩnh viễn!</p>
                  ) : memories.map(m => (
                    <div key={m.ma_bo_nho} className="flex items-start gap-2 p-2 bg-[#181920] rounded-lg border border-white/5 group">
                      <span className="text-purple-400 shrink-0">•</span>
                      <span className="flex-1 text-slate-300">{m.noi_dung}</span>
                      <button
                        onClick={async () => {
                          await apiFetch(`/chat/memory/${m.ma_bo_nho}`, { method: 'DELETE', headers: authHeaders() });
                          fetchMemories();
                        }}
                        className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-300 shrink-0"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-white/5 flex justify-end">
              <button onClick={() => setSuperToolsOpen(false)} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-medium">Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════ USER AUTH MODAL ═══════════════════ */}
      {authModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#181920] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative">
            <button onClick={() => { setAuthModalOpen(false); setForgotStep('login'); setShowPassword(false); setShowForgotNewPassword(false); setForgotMessage(''); }} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={18} />
            </button>

            {forgotStep === 'request' ? (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white text-center">Quên Mật Khẩu</h3>
                <p className="text-xs text-slate-400 text-center">Nhập tài khoản để nhận mã OTP đặt lại mật khẩu.</p>
                <input type="text" value={authEmail} onChange={e => setAuthEmail(e.target.value)}
                  placeholder="Nhập tài khoản" className="w-full px-3 py-2.5 bg-[#131417] border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500/50" />
                {forgotMessage && <p className="text-xs text-cyan-300 text-center">{forgotMessage}</p>}
                <button type="button" onClick={async () => {
                  try {
                    const data = await apiFetch('/auth/forgot-password', {
                      method: 'POST', headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({ account: authEmail })
                    });
                    if (data.success) {
                      // Không bao giờ hiện OTP ra UI (kể cả otp_debug dev) — tránh lộ + tập thói quen xấu
                      setForgotMessage(data.message || 'Đã gửi mã OTP. Kiểm tra email/tin nhắn của bạn.');
                      setForgotStep('reset');
                    } else {
                      setForgotMessage(data.error || 'Không thể tạo mã OTP.');
                    }
                  } catch { setForgotMessage('Lỗi kết nối server.'); }
                }} className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-sm rounded-xl transition-all">Gửi OTP</button>
                <button type="button" onClick={() => { setForgotStep('login'); setForgotMessage(''); }} className="w-full text-xs text-slate-500 hover:text-white transition-colors">Quay lại Đăng Nhập</button>
              </div>
            ) : forgotStep === 'reset' ? (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white text-center">Đặt Lại Mật Khẩu</h3>
                {forgotMessage && <p className="text-xs text-cyan-300 text-center">{forgotMessage}</p>}
                <input type="text" inputMode="numeric" value={forgotOtp} onChange={e => setForgotOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Nhập OTP" className="w-full px-3 py-2.5 bg-[#131417] border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500/50" />
                <div className="relative">
                  <input type={showForgotNewPassword ? 'text' : 'password'} value={forgotNewPassword} onChange={e => setForgotNewPassword(e.target.value)}
                    placeholder="Mật khẩu mới" className="w-full px-3 py-2.5 pr-10 bg-[#131417] border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500/50" />
                  <button type="button" onClick={() => setShowForgotNewPassword(!showForgotNewPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white" aria-label={showForgotNewPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                    {showForgotNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button type="button" onClick={async () => {
                  try {
                    const data = await apiFetch('/auth/reset-password', {
                      method: 'POST', headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({ account: authEmail, otp_code: forgotOtp, new_password: forgotNewPassword })
                    });
                    if (data.success) {
                      setForgotMessage('Đặt lại mật khẩu thành công. Bạn có thể đăng nhập.');
                      setAuthPassword('');
                      setForgotOtp('');
                      setForgotNewPassword('');
                      setTimeout(() => { setForgotStep('login'); setForgotMessage(''); setAuthMode('login'); }, 1200);
                    } else {
                      setForgotMessage(data.error || 'OTP không đúng.');
                    }
                  } catch { setForgotMessage('Lỗi kết nối server.'); }
                }} className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-sm rounded-xl transition-all">Đặt lại mật khẩu</button>
                <button type="button" onClick={() => { setForgotStep('request'); setForgotMessage(''); }} className="w-full text-xs text-slate-500 hover:text-white transition-colors">Gửi lại OTP</button>
              </div>
            ) : (
              <div className="auth-login-wrapper">
                <div className="flex flex-col items-center pt-2 pb-2">
                  <img src="/rexi_cat_icon.png" alt="Logo" className="rexi-logo w-12 h-12 object-contain" />
                  <span className="text-xs text-white/50 font-semibold tracking-widest mt-1">AI Rexi</span>
                </div>

<div className="flex bg-white border border-slate-200 rounded-xl p-1 mb-5">
                   <button
                     onClick={() => setAuthMode('login')}
                     className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                       authMode === 'login' ? 'bg-[#4a7dff] hover:bg-[#3d6ae6] text-white' : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                     }`}
                   >
                     Đăng Nhập
                   </button>
                   <button
                     onClick={() => setAuthMode('register')}
                     className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                       authMode === 'register' ? 'bg-[#4a7dff] hover:bg-[#3d6ae6] text-white' : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                     }`}
                   >
                     Đăng Ký
                   </button>
                 </div>

                <form onSubmit={(e) => { e.preventDefault(); handleAuthSubmit(); }} className="space-y-3 text-xs">
                  {authMode === 'register' && (
                    <div>
                      <label className="block text-slate-400 font-medium mb-1">Họ và Tên</label>
                      <input type="text" value={authFullName} onChange={e => setAuthFullName(e.target.value)} placeholder="Nguyễn Văn A" className="w-full bg-[#131417] border border-white/10 rounded-xl p-2.5 text-slate-200 outline-none" />
                    </div>
                  )}
                  <div>
<label className="block text-slate-500 font-medium mb-1">Tài Khoản</label>
                     <input type="text" required value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="Nhập tài khoản" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-800 outline-none" />
                  </div>
                  <div>
<label className="block text-slate-500 font-medium mb-1">Mật Khẩu</label>
                     <div className="relative">
                       <input type={showPassword ? 'text' : 'password'} required value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="••••••••" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-800 outline-none pr-10" />
                       <button type="button" onClick={() => setShowPassword(!showPassword)}
                         className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                         {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                       </button>
                     </div>
                  </div>

<div className="flex justify-end mt-1">
                     <button type="button" onClick={() => { setForgotStep('request'); setForgotMessage(''); }} className="text-[10px] text-slate-500 hover:text-slate-600 transition-colors">
                       Quên Mật Khẩu?
                     </button>
                   </div>

<button type="submit" className="w-full py-3 mt-4 rounded-xl bg-[#4a7dff] hover:bg-[#3d6ae6] text-white font-bold text-xs shadow-lg shadow-[#4a7dff]/20 transition-all">
                     {authMode === 'login' ? 'Đăng Nhập' : 'Đăng Ký'}
                   </button>
                </form>

<div className="relative flex items-center my-4">
                   <div className="flex-1 h-px bg-slate-200"></div>
                   <span className="px-3 text-[10px] text-slate-500 font-medium">hoặc</span>
                   <div className="flex-1 h-px bg-slate-200"></div>
                 </div>

                 <button type="button" onClick={openGoogleOAuth} className="w-full py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium flex items-center justify-center gap-2 border border-slate-200 transition-all">
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                     <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                     <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                     <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                     <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                   </svg>
                   Đăng nhập với Google
                 </button>
              </div>
            )}
          </div>
        </div>
      )}


      {/* ═══════════════════ SETTINGS MODAL ═══════════════════ */}
      <SettingsModal
        settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen}
        provider={provider} setProvider={setProvider}
        modelName={modelName} setModelName={setModelName}
        apiKey={apiKey} setApiKey={setApiKey}
        baseUrl={baseUrl} setBaseUrl={setBaseUrl}
      />

      {/* ═══════════════════ FLOATING SPEED DIAL MENU (Hiển thị ở mọi tab, kể cả Admin) ═══════════════════ */}
      {(
        <>
          {fabOpen && (
            <div
              className="fixed inset-0 z-40 transition-opacity duration-300"
              style={{backgroundColor:'rgba(0,0,0,.08)'}}
              onClick={() => setFabOpen(false)}
            />
          )}

          <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 pointer-events-none">
            {/* Danh sách các công cụ hiện lên khi bấm mở (Có hỗ trợ cuộn nếu có nhiều tính năng) */}
            <div className={`
              flex flex-col gap-1 p-2 bg-white border border-slate-200 rounded-2xl shadow-xl transition-all duration-300 origin-bottom-right
              max-h-[70vh] overflow-y-auto pr-1.5 scrollbar-thin
              ${fabOpen
                ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
                : 'opacity-0 scale-75 translate-y-6 pointer-events-none'
              }
            `}>
              {/* Nhóm AI */}
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 px-3 pt-1 pb-1">Trí Tuệ AI</p>
              {[
                { tab: 'chat', icon: <MessageSquare size={17} />, label: 'Chat AI', color: 'text-cyan-400', desc: 'Trò chuyện với AI' },
                { tab: 'code', icon: <Code size={17} />, label: 'Editor & Preview', color: 'text-blue-400', desc: 'Code + xem trước HTML' },
                { tab: 'browser', icon: <Bot size={17} />, label: 'Browser Agent', color: 'text-purple-400', desc: 'AI điều khiển trình duyệt' },
              ].map(item => (
                <FabItem key={item.tab} item={item} activeTab={activeTab} onPick={() => { handleSetActiveTab(item.tab); setFabOpen(false); }} />
              ))}

              {/* Nhóm Sáng Tạo */}
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 px-3 pt-2 pb-1">🎨 Sáng Tạo</p>
              {[
                { tab: 'tts', icon: <Mic size={17} />, label: 'TTS Studio', color: 'text-cyan-400', desc: 'Chữ → giọng nói MP3' },
                { tab: 'documents', icon: <FileText size={17} />, label: 'Đọc & Hiểu File', color: 'text-emerald-400', desc: 'AI hiểu nội dung PDF/Word/TXT' },
                { tab: 'video', icon: <Video size={17} />, label: 'Video Creator', color: 'text-purple-400', desc: 'Tạo video từ mẫu' },
                { tab: 'opencut', icon: <Clapperboard size={17} />, label: 'OpenCut Editor', color: 'text-sky-400', desc: 'Edit video chuyên sâu' },
                { tab: 'youtube', icon: <MonitorPlay size={17} />, label: 'YouTube Free', color: 'text-red-400', desc: 'Xem video không quảng cáo' },
                { tab: 'games', icon: <Gamepad2 size={17} />, label: 'Game Zone', color: 'text-fuchsia-400', desc: 'Chơi game HTML5 miễn phí' },
              ].map(item => (
                <FabItem key={item.tab} item={item} activeTab={activeTab} onPick={() => { handleSetActiveTab(item.tab); setFabOpen(false); }} />
              ))}

              {/* Nhóm Giải Trí & Hệ Thống */}
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 px-3 pt-2 pb-1">📺 Giải Trí & Hệ Thống</p>
              {[
                { tab: 'iptv', icon: <Tv size={17} />, label: 'IPTV Truyền Hình', color: 'text-rose-400', desc: 'Xem TV trực tuyến' },
                { tab: 'files', icon: <Folder size={17} />, label: 'Workspace Files', color: 'text-amber-400', desc: 'Quản lý file dự án' },
                { tab: 'desktop', icon: <Monitor size={17} />, label: 'Remote Desktop', color: 'text-emerald-400', desc: 'Điều khiển màn hình' },
                ...(currentUser?.phan_quyen === 'admin' ? [{ tab: 'admin', icon: <Shield size={17} />, label: 'Quản Trị Viên', color: 'text-amber-400', desc: 'Bảng điều khiển admin' }] : []),
              ].map(item => (
                <FabItem key={item.tab} item={item} activeTab={activeTab} onPick={() => { handleSetActiveTab(item.tab); setFabOpen(false); }} />
              ))}

              {/* Trợ giúp */}
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-600 px-3 pt-2 pb-1">❓ Trợ Giúp</p>
              <button
                onClick={() => { setHelpOpen(true); setFabOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all text-slate-300 hover:text-white hover:bg-white/10"
              >
                <span className="text-sky-400"><BookOpen size={17} /></span>
                <div className="flex flex-col items-start whitespace-nowrap">
                  <span>Hướng Dẫn Sử Dụng</span>
                  <span className="text-[9px] text-slate-500">Học cách dùng mọi tính năng</span>
                </div>
              </button>

              {/* Đường phân cách */}
              <div className="h-px bg-white/10 my-0.5 mx-2" />

              {/* Nhóm Quick Tools (Modals) */}
              <button
                onClick={() => { setSkillsOpen(true); setFabOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium text-purple-300 hover:text-white hover:bg-purple-500/20 transition-all"
              >
                <Layers size={17} className="text-purple-400" />
                <span className="whitespace-nowrap">35+ Agent Skills</span>
              </button>

              <button
                onClick={() => { setSuperToolsOpen(true); setFabOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium text-amber-300 hover:text-white hover:bg-amber-500/20 transition-all"
              >
                <Zap size={17} className="text-amber-400" />
                <span className="whitespace-nowrap">Super Tools (CLI/Git)</span>
              </button>

              <button
                onClick={() => { setSettingsOpen(true); setFabOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-all"
              >
                <Settings size={17} className="text-slate-400" />
                <span className="whitespace-nowrap">Cài Đặt Hệ Thống</span>
              </button>
            </div>

            {/* Nút FAB chính - biểu tượng công cụ */}
            <button
              onClick={() => setFabOpen(!fabOpen)}
              className={`
                pointer-events-auto w-[48px] h-[48px] flex items-center justify-center rounded-full shadow-md transition-all duration-200
                ${fabOpen
                  ? 'bg-[#3d6ae6] hover:bg-[#2c52b2] text-white shadow-[#4a7dff]/30 scale-105'
                  : 'bg-[#4a7dff] hover:bg-[#3d6ae6] text-white shadow-[#4a7dff]/20'
                }
              `}
              title={fabOpen ? 'Thu gọn menu' : 'Mở thanh công cụ nhanh'}
            >
              <Zap size={20} className={`transition-all duration-200 ${fabOpen ? 'scale-110' : ''}`} />
            </button>
          </div>
        </>
      )}

      {/* ═══════════════════ HELP MODAL (HƯỚNG DẪN SỬ DỤNG) ═══════════════════ */}
      <HelpModal helpOpen={helpOpen} setHelpOpen={setHelpOpen} />

      {/* Toast Notification */}
      {toastMsg && (
        <div className={"fixed bottom-6 right-6 z-[9999] px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md border flex items-center gap-3 text-sm font-medium transition-all duration-300 animate-slide-up " + (toastType === 'success' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-200' : toastType === 'error' ? 'bg-rose-500/20 border-rose-500/30 text-rose-200' : 'bg-cyan-500/20 border-cyan-500/30 text-cyan-200')}>
          <span>{toastType === 'success' ? '✅' : toastType === 'error' ? '❌' : 'ℹ️'}</span>
          <span className="max-w-[440px] overflow-hidden text-ellipsis whitespace-nowrap">{toastMsg}</span>
          <button onClick={() => setToastMsg('')} className="ml-2 opacity-60 hover:opacity-100 transition-opacity">\u00D7</button>
        </div>
      )}
    </div>
  );
}
