import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Shield, UserX, Server, Database, Activity,
  RefreshCw, Home, MessageSquare, Trash2,
  Lock, Unlock, ChevronLeft, ChevronRight, Search, AlertTriangle,
  CheckCircle, XCircle, Crown, User as UserIcon
} from 'lucide-react';
import { apiFetch } from './config';
import GitHubTrending from './components/GitHubTrending';

// ─── Helper: API call với token ───────────────────────────

// ─── Badge Role ───────────────────────────────────────────
function RoleBadge({ role }) {
  return role === 'admin' ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
      <Crown size={11} /> Quản Trị Viên
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
      <UserIcon size={11} /> Người Dùng
    </span>
  );
}

// ─── Badge Status ─────────────────────────────────────────
function StatusBadge({ status }) {
  return status === 'banned' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
      <XCircle size={10} /> Bị khoá
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
      <CheckCircle size={10} /> Hoạt động
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color, subtext }) {
  return (
    <div className="p-4 bg-[#181920] rounded-2xl border border-white/8 shadow flex items-center gap-4">
      <div className={`p-2.5 rounded-xl ${color.bg} ${color.text} border ${color.border}`}>
        <Icon size={20} />
      </div>
      <div>
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">{label}</p>
        <p className={`text-xl font-bold ${color.text}`}>{value ?? '...'}</p>
        {subtext && <p className="text-[10px] text-slate-500 mt-0.5">{subtext}</p>}
      </div>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  const colors = type === 'success'
    ? 'bg-emerald-900/90 border-emerald-500/40 text-emerald-200'
    : 'bg-rose-900/90 border-rose-500/40 text-rose-200';

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-2xl text-sm font-medium backdrop-blur ${colors} animate-fade-in`}>
      {type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
      {message}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
export default function AdminPage() {
  const token = localStorage.getItem('rexi_token') || '';
  let currentUser = null;
  try {
    const storedUser = localStorage.getItem('rexi_user');
    currentUser = storedUser ? JSON.parse(storedUser) : null;
  } catch {
    // storage hỏng → coi như chưa đăng nhập (redirect ở dưới)
    currentUser = null;
  }

  // Redirect nếu chưa đăng nhập hoặc không phải admin
  useEffect(() => {
    if (!token || !currentUser || currentUser.phan_quyen !== 'admin') {
      window.location.href = '/';
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [actionLoading, setActionLoading] = useState({});

  // Pagination & Search
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // AI Models Management State
  const [providers, setProviders] = useState([]);
  const [allModelsByProvider, setModelsByProvider] = useState({});
  const [providersLoading, setProvidersLoading] = useState(false);
  const [syncingProvider, setSyncingProvider] = useState(null);
  const [newProviderName, setNewProviderName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');

  const showToast = (message, type = 'success') => setToast({ message, type });

  // ── Fetch Users ──────────────────────────────────────────
  const fetchUsers = useCallback(async (p = page, s = search) => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(`/auth/users?page=${p}&limit=10&search=${encodeURIComponent(s)}`, token);
      // Support both {users, totalPages} and flat array
      if (Array.isArray(data)) {
        setUsers(data);
        setTotalPages(1);
        setTotalUsers(data.length);
      } else {
        setUsers(data.users || []);
        setTotalPages(data.totalPages || 1);
        setTotalUsers(data.totalUsers || 0);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, page, search]);

  // ── Fetch Stats ──────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await apiFetch('/auth/stats', token);
      setStats(data);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchUsers(page, search);
    fetchStats();
  }, [page, search]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Đổi Role ─────────────────────────────────────────────
  const changeRole = async (userId, newRole) => {
    setActionLoading(p => ({ ...p, [`role_${userId}`]: true }));
    try {
      await apiFetch(`/auth/users/${userId}/role`, token, {
        method: 'PUT',
        body: JSON.stringify({ phan_quyen: newRole }),
      });
      showToast(`Đã đổi quyền thành ${newRole === 'admin' ? 'Quản Trị Viên' : 'Người Dùng'}`);
      fetchUsers(page, search);
      fetchStats();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`role_${userId}`]: false }));
    }
  };

  // ── Khoá / Mở khoá ───────────────────────────────────────
  const changeStatus = async (userId, newStatus) => {
    setActionLoading(p => ({ ...p, [`status_${userId}`]: true }));
    try {
      await apiFetch(`/auth/users/${userId}/status`, token, {
        method: 'PUT',
        body: JSON.stringify({ trang_thai: newStatus }),
      });
      showToast(newStatus === 'banned' ? 'Đã khoá tài khoản.' : 'Đã mở khoá tài khoản.');
      fetchUsers(page, search);
      fetchStats();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setActionLoading(p => ({ ...p, [`status_${userId}`]: false }));
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  // ── AI Models Functions ──────────────────────────────────
  const fetchProviders = useCallback(async () => {
    setProvidersLoading(true);
    try {
      // FIX: /models/admin/providers thay vì /admin/providers (route nằm trong models.routes.js)
      const data = await apiFetch('/models/admin/providers', token);
      if (data.success) setProviders(data.providers);
    } catch (e) { showToast('Lỗi tải providers: ' + e.message, 'error'); }
    finally { setProvidersLoading(false); }
  }, [token]);

  const fetchAdminModels = useCallback(async (prov) => {
    try {
      // FIX: /models/admin/models thay vì /admin/models
      const url = prov ? `/models/admin/models?provider=${encodeURIComponent(prov)}` : '/models/admin/models';
      const data = await apiFetch(url, token);
      if (data.success && data.models) {
        if (prov) {
          setModelsByProvider(prev => ({...prev, [prov]: data.models}));
        } else {
          const grouped = {};
          data.models.forEach(m => {
            if (!grouped[m.ma_nha_cung_cap]) grouped[m.ma_nha_cung_cap] = [];
            grouped[m.ma_nha_cung_cap].push(m);
          });
          setModelsByProvider(grouped);
        }
      }
    } catch { /* ignore */ }
  }, [token]);

  const handleAddProvider = async () => {
    if (!newProviderName.trim() || !newApiKey.trim()) return;
    setSyncingProvider(newProviderName.trim());
    try {
      // FIX: /models/admin/providers thay vì /admin/providers
      const provData = await apiFetch(`/models/admin/providers/${newProviderName.trim()}`, token, {
        method: 'PUT',
        body: JSON.stringify({ ten_hien_thi: newProviderName.trim(), base_url: '', can_api_key: 1, placeholder: 'API Key', thu_tu: 0, kich_hoat: 1 })
      });
      if (!provData.success) throw new Error(provData.error || 'Lỗi lưu provider');
      // FIX: /models/admin/models/sync thay vì /admin/models/sync
      const syncRes = await apiFetch('/models/admin/models/sync', token, {
        method: 'POST',
        body: JSON.stringify({ provider: newProviderName.trim(), api_key: newApiKey.trim() })
      });
      showToast(`Đã quét ${syncRes.count || 0} models từ ${newProviderName.trim()}`, 'success');
      fetchProviders();
      fetchAdminModels(newProviderName.trim());
      setNewProviderName(''); setNewApiKey('');
    } catch (e) { showToast('Lỗi: ' + e.message, 'error'); }
    finally { setSyncingProvider(null); }
  };

  const handleSyncProvider = async (prov) => {
    setSyncingProvider(prov);
    try {
      // FIX: /models/admin/models/sync thay vì /admin/models/sync
      const syncRes = await apiFetch('/models/admin/models/sync', token, {
        method: 'POST',
        body: JSON.stringify({ provider: prov, api_key: '' })
      });
      showToast(`Đã quét models cho ${prov}`, syncRes.success ? 'success' : 'error');
      fetchAdminModels(prov);
    } catch (e) { showToast('Lỗi sync: ' + e.message, 'error'); }
    finally { setSyncingProvider(null); }
  };

  const toggleModelOnHome = async (modelId, currentStatus, providerId) => {
    try {
      // FIX: /models/admin/models thay vì /admin/models
      // provider lấy từ dòng model đang hiển thị (modelId không phải lúc nào cũng có dạng provider/id)
      const data = await apiFetch(`/models/admin/models`, token, {
        method: 'POST',
        body: JSON.stringify({ ma_model: modelId, ma_nha_cung_cap: providerId || 'gemini', ten_hien_thi: modelId, kich_hoat: currentStatus ? 0 : 1 })
      });
      if (data.success) {
        showToast(`Model ${currentStatus ? 'đã ẩn' : 'đã hiện'} trên trang chủ`, 'success');
        // Refresh all providers
        Object.keys(allModelsByProvider).forEach(p => fetchAdminModels(p));
      }
    } catch (e) { showToast('Lỗi: ' + e.message, 'error'); }
  };

  const deleteModel = async (modelId) => {
    try {
      // FIX: /models/admin/models thay vì /admin/models
      await apiFetch(`/models/admin/models/${encodeURIComponent(modelId)}`, token, { method: 'DELETE' });
      showToast('Đã xóa model', 'success');
      Object.keys(allModelsByProvider).forEach(p => fetchAdminModels(p));
    } catch (e) { showToast('Lỗi xóa: ' + e.message, 'error'); }
  };

  if (!token || !currentUser || currentUser.phan_quyen !== 'admin') {
    return null; // Đang redirect
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col">
      {/* ── TOPBAR ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-[#181920]/95 backdrop-blur border-b border-amber-500/20 flex items-center justify-between px-6 py-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <Shield size={22} />
          </div>
          <div>
            <h1 className="text-base font-bold text-amber-400 leading-tight">Admin Control Panel</h1>
            <p className="text-[11px] text-slate-500">AI REXI — Quản Trị Hệ Thống</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
            <Crown size={12} />
            <span className="font-semibold truncate max-w-[130px]">
              {currentUser.ten_day_du || currentUser.email}
            </span>
          </div>
          <button
            onClick={() => { fetchUsers(page, search); fetchStats(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-300 hover:text-white transition-colors"
          >
            <RefreshCw size={13} />
            <span className="hidden sm:inline">Làm mới</span>
          </button>
          <a
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-xs text-cyan-300 hover:text-cyan-200 transition-colors"
          >
            <Home size={13} />
            <span className="hidden sm:inline">Về trang chủ</span>
          </a>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">
        {/* ── STATS GRID ───────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={Users} label="Tổng User" value={statsLoading ? '...' : stats?.tong_user} color={{ bg: 'bg-indigo-500/15', text: 'text-indigo-300', border: 'border-indigo-500/20' }} />
          <StatCard icon={Crown} label="Quản Trị Viên" value={statsLoading ? '...' : stats?.tong_admin} color={{ bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-500/20' }} />
          <StatCard icon={Lock} label="Bị Khoá" value={statsLoading ? '...' : stats?.tong_bi_khoa} color={{ bg: 'bg-rose-500/15', text: 'text-rose-300', border: 'border-rose-500/20' }} />
          <StatCard icon={MessageSquare} label="Hội Thoại" value={statsLoading ? '...' : stats?.tong_hoi_thoai} color={{ bg: 'bg-cyan-500/15', text: 'text-cyan-300', border: 'border-cyan-500/20' }} />
          <StatCard icon={Activity} label="Tin Nhắn" value={statsLoading ? '...' : stats?.tong_tin_nhan} color={{ bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/20' }} />
          <StatCard icon={Trash2} label="Thùng Rác" value={statsLoading ? '...' : stats?.tong_xoa_mem} color={{ bg: 'bg-slate-500/15', text: 'text-slate-300', border: 'border-slate-500/20' }} />
        </div>

        {/* ── USERS TABLE ──────────────────────────────────── */}
        <div className="bg-[#181920] rounded-2xl border border-white/8 shadow overflow-hidden">
          {/* Table Header */}
          <div className="px-5 py-3 bg-white/5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Users size={15} className="text-amber-400" />
              Danh Sách Người Dùng
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-semibold border border-amber-500/30">
                {totalUsers}
              </span>
            </span>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="admin-search"
                  name="admin-search"
                  type="text"
                  placeholder="Tìm email, tên..."
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 w-48"
                />
              </div>
              <button type="submit" className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded-lg font-semibold transition-colors">
                Tìm
              </button>
              {search && (
                <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }} className="px-2 py-1.5 bg-white/5 hover:bg-white/10 text-slate-400 text-xs rounded-lg transition-colors">
                  ✕
                </button>
              )}
            </form>
          </div>

          {/* Loading */}
          {loading && (
            <div className="text-center py-16 text-slate-400 text-sm flex flex-col items-center gap-3">
              <RefreshCw size={22} className="animate-spin text-amber-400" />
              Đang tải danh sách người dùng...
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-center py-16 text-rose-400 text-sm px-6 flex flex-col items-center gap-2">
              <Shield size={22} className="text-rose-500" />
              {error}
            </div>
          )}

          {/* Table */}
          {!loading && !error && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left table-fixed">
                  <thead className="bg-[#13151a] border-b border-white/10">
                    <tr>
                      <th className="px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider">Người Dùng</th>
                      <th className="px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider">Quyền</th>
                      <th className="px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider">Trạng Thái</th>
                      <th className="px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider">Ngày Đăng Ký</th>
                      <th className="px-5 py-3 text-slate-400 font-semibold text-xs uppercase tracking-wider text-center">Hành Động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-slate-500 text-xs">
                          Không tìm thấy người dùng nào.
                        </td>
                      </tr>
                    ) : users.map(user => {
                      const isSelf = user.ma_nguoi_dung === currentUser.ma_nguoi_dung;
                      const isBanned = user.trang_thai === 'banned';
                      const isAdmin = user.phan_quyen === 'admin';
                      const roleLoading = actionLoading[`role_${user.ma_nguoi_dung}`];
                      const statusLoading = actionLoading[`status_${user.ma_nguoi_dung}`];

                      return (
                        <tr key={user.ma_nguoi_dung} className={`hover:bg-white/4 transition-colors ${isBanned ? 'opacity-60' : ''}`}>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500/40 to-indigo-500/40 border border-white/10 flex items-center justify-center shrink-0 text-xs font-bold text-white">
                                {(user.ten_day_du || user.email || '?')[0].toUpperCase()}
                              </div>
                              <div>
                                <div className="font-medium text-slate-200 text-sm flex items-center gap-1.5">
                                  {user.ten_day_du || 'Chưa cập nhật'}
                                  {isSelf && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">Bạn</span>}
                                </div>
                                <div className="text-xs text-slate-500 mt-0.5">{user.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <RoleBadge role={user.phan_quyen} />
                          </td>
                          <td className="px-5 py-3.5">
                            <StatusBadge status={user.trang_thai || 'active'} />
                          </td>
                          <td className="px-5 py-3.5 text-slate-400 font-mono text-xs">
                            {(() => { const d = user.ngay_tao ? new Date(user.ngay_tao) : null; return d && !isNaN(d) ? d.toLocaleString('vi-VN') : '—'; })()}
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center justify-center gap-2">
                              {/* Nút đổi role */}
                              {!isSelf && (
                                <button
                                  onClick={() => changeRole(user.ma_nguoi_dung, isAdmin ? 'user' : 'admin')}
                                  disabled={roleLoading}
                                  title={isAdmin ? 'Hạ xuống User' : 'Nâng lên Admin'}
                                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 min-w-[90px] justify-center whitespace-nowrap ${
                                    isAdmin
                                      ? 'bg-slate-500/20 hover:bg-slate-500/30 text-slate-300 border border-slate-500/30'
                                      : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30'
                                  }`}
                                >
                                  {roleLoading ? <RefreshCw size={11} className="animate-spin" /> : isAdmin ? <UserX size={11} /> : <Crown size={11} />}
                                  {isAdmin ? 'Hạ quyền' : 'Nâng quyền'}
                                </button>
                              )}

                              {/* Nút khoá / mở khoá */}
                              {!isSelf && (
                                <button
                                  onClick={() => changeStatus(user.ma_nguoi_dung, isBanned ? 'active' : 'banned')}
                                  disabled={statusLoading}
                                  title={isBanned ? 'Mở khoá' : 'Khoá tài khoản'}
                                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 min-w-[85px] justify-center whitespace-nowrap ${
                                    isBanned
                                      ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30'
                                      : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30'
                                  }`}
                                >
                                  {statusLoading ? <RefreshCw size={11} className="animate-spin" /> : isBanned ? <Unlock size={11} /> : <Lock size={11} />}
                                  {isBanned ? 'Mở khoá' : 'Khoá'}
                                </button>
                              )}

                              {isSelf && (
                                <span className="text-xs text-slate-600 italic">—</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    Trang {page}/{totalPages} · {totalUsers} người dùng
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      const pg = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                      return (
                        <button
                          key={pg}
                          onClick={() => setPage(pg)}
                          className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${
                            pg === page
                              ? 'bg-amber-600 text-white'
                              : 'bg-white/5 hover:bg-white/10 text-slate-400'
                          }`}
                        >
                          {pg}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 disabled:opacity-30 transition-colors"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* AI MODELS MANAGEMENT */}
        <div className="bg-[#181920] rounded-2xl border border-white/8 shadow overflow-hidden">
          <div className="px-5 py-3 bg-white/5 border-b border-white/10 flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Server size={15} className="text-cyan-400" /> Quản Lý AI Models
            </span>
            <button onClick={() => { fetchProviders(); Object.keys(allModelsByProvider).forEach(p => fetchAdminModels(p)); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-300 hover:text-white transition-colors">
              <RefreshCw size={13} /> Làm mới
            </button>
          </div>
          <div className="p-5 space-y-5">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[150px]">
                <label className="block text-[10px] text-slate-500 mb-1 font-semibold uppercase">Provider</label>
                <input type="text" value={newProviderName} onChange={e => setNewProviderName(e.target.value)}
                  placeholder="gemini, openai, groq..."
                  className="w-full px-3 py-2 bg-[#131417] border border-white/10 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div className="flex-[2] min-w-[200px]">
                <label className="block text-[10px] text-slate-500 mb-1 font-semibold uppercase">API Key</label>
                <input type="text" value={newApiKey} onChange={e => setNewApiKey(e.target.value)}
                  placeholder="Nhập API Key..."
                  className="w-full px-3 py-2 bg-[#131417] border border-white/10 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50" />
              </div>
              <button onClick={handleAddProvider} disabled={!newProviderName.trim() || !newApiKey.trim() || syncingProvider}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5">
                <Database size={13} /> {syncingProvider ? 'Đang quét...' : 'Lưu & Quét Model'}
              </button>
            </div>
            <div id="ai-models-list">
              {providersLoading ? (
                <div className="text-center py-8 text-slate-500 text-xs">Đang tải providers...</div>
              ) : (
                <div className="space-y-4">
                  {providers.map((p) => (
                    <div key={p.ma_nha_cung_cap} className="bg-[#131417] rounded-xl border border-white/8 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-white/5 border-b border-white/8">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-cyan-300">{p.ten_hien_thi}</span>
                          <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 text-[9px] font-mono">{p.ma_nha_cung_cap}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] ${p.kich_hoat ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-500/10 text-slate-400'}`}>
                            {p.kich_hoat ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <button onClick={() => handleSyncProvider(p.ma_nha_cung_cap)}
                          disabled={syncingProvider === p.ma_nha_cung_cap}
                          className="px-2.5 py-1.5 bg-purple-600/80 hover:bg-purple-500 disabled:opacity-40 text-white text-[10px] font-semibold rounded-lg transition-colors flex items-center gap-1">
                          <RefreshCw size={11} className={syncingProvider === p.ma_nha_cung_cap ? 'animate-spin' : ''} />
                          {syncingProvider === p.ma_nha_cung_cap ? 'Đang quét...' : 'Quét Model'}
                        </button>
                      </div>
                      <div className="p-2 space-y-1">
                        {(allModelsByProvider[p.ma_nha_cung_cap] || []).length === 0 ? (
                          <div className="text-center py-4 text-slate-500 text-[10px]">Nhấn "Quét Model" để tải danh sách.</div>
                        ) : (
                          allModelsByProvider[p.ma_nha_cung_cap].map((model) => (
                            <div key={model.ma_model} className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
                              title={`${model.ten_hien_thi}\nProvider: ${model.ma_nha_cung_cap}\nType: ${model.loai}\nUpdated: ${model.ngay_cap_nhat || 'N/A'}`}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${model.kich_hoat ? 'bg-emerald-400' : 'bg-slate-600'}`}></span>
                                <span className="text-xs text-slate-300 truncate">{model.ten_hien_thi}</span>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => toggleModelOnHome(model.ma_model, model.kich_hoat, model.ma_nha_cung_cap || p.ma_nha_cung_cap)}
                                  className="p-1.5 rounded-lg hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition-colors" title={model.kich_hoat ? 'Ẩn khỏi trang chủ' : 'Hiện lên trang chủ'}>
                                  <span className="text-xs">{model.kich_hoat ? '↓' : '↑'}</span>
                                </button>
                                <button onClick={() => deleteModel(model.ma_model)}
                                  className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition-colors" title="Xóa model">✕</button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                  {providers.length === 0 && (
                    <div className="text-center py-10 text-slate-500 text-xs">Chưa có provider. Nhập tên + key ở trên.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* GITHUB TRENDING */}
        <GitHubTrending token={token} />
      </main>

      {/* ── TOAST ────────────────────────────────────────── */}
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
