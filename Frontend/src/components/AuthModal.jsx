import { API_BASE } from '../config';
import React, { useState } from 'react';
import { X, LogIn, UserPlus, Lock, Eye, EyeOff } from 'lucide-react';

export default function AuthModal({
  authModalOpen, setAuthModalOpen, authMode, setAuthMode,
  authEmail, setAuthEmail, authPassword, setAuthPassword,
  authFullName, setAuthFullName, handleAuthSubmit
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [forgotStep, setForgotStep] = useState('email');
  const [forgotMsg, setForgotMsg] = useState('');
  if (!authModalOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{backgroundColor:'rgba(0,0,0,.10)', transition:'background-color .2s'}} onClick={() => { setAuthModalOpen(false); setShowForgot(false); }}>
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()} style={{animation:'rx-press .15s ease'}}>
        {showForgot ? (
          <>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Lock size={16} className="text-blue-600" /> Quên Mật Khẩu
              </h2>
              <button onClick={() => setShowForgot(false)} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700"><X size={16} /></button>
            </div>
            {forgotStep === 'email' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">Nhập tài khoản email của bạn để nhận OTP đặt lại mật khẩu.</p>
                <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                  placeholder="Nhập email" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500/50" />
                {forgotMsg && <p className="text-xs text-emerald-600">{forgotMsg}</p>}
                <button onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
                      method: 'POST', headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({ email: forgotEmail })
                    });
                    const data = await res.json();
                    if (data.success) { setForgotMsg(data.otp_debug ? 'OTP đã được gửi! (debug: ' + data.otp_debug + ')' : 'Kiểm tra email để lấy OTP.'); setForgotStep('otp'); }
                    else { setForgotMsg(data.error || 'Không tìm thấy tài khoản.'); }
                  } catch { setForgotMsg('Lỗi kết nối server.'); }
                }} className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-sm rounded-xl transition-all">Gửi OTP</button>
              </div>
            )}
            {forgotStep === 'otp' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">Nhập OTP và mật khẩu mới.</p>
                <input type="text" value={otpCode} onChange={e => setOtpCode(e.target.value)}
                  placeholder="Nhập OTP" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500/50" />
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  placeholder="Mật khẩu mới" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500/50" />
                <button onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/auth/reset-password`, {
                      method: 'POST', headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({ email: forgotEmail, otp_code: otpCode, new_password: newPassword })
                    });
                    const data = await res.json();
                    if (data.success) { setForgotMsg('Đặt lại mật khẩu thành công! Đăng nhập lại.'); setTimeout(() => { setShowForgot(false); setAuthMode('login'); }, 1500); }
                    else { setForgotMsg(data.error || 'OTP không đúng hoặc đã hết hạn.'); }
                  } catch { setForgotMsg('Lỗi kết nối server.'); }
                }} className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-sm rounded-xl transition-all">Đặt lại mật khẩu</button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                {authMode === 'login' ? <Lock size={16} className="text-blue-600" /> : <UserPlus size={16} className="text-emerald-600" />}
                {authMode === 'login' ? 'Đăng Nhập' : 'Tạo Tài Khoản'}
              </h2>
              <button onClick={() => setAuthModalOpen(false)} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700"><X size={16} /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleAuthSubmit(); }} className="space-y-3">
              {authMode === 'register' && (
                <input type="text" value={authFullName} onChange={e => setAuthFullName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAuthSubmit()}
                  placeholder="Họ và tên" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500/50" />
              )}
              <input type="text" value={authEmail} onChange={e => setAuthEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAuthSubmit()}
                placeholder="Tài khoản (email)" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500/50" />
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={authPassword} onChange={e => setAuthPassword(e.target.value)}
                  placeholder="Mật khẩu" onKeyDown={e => e.key === 'Enter' && handleAuthSubmit()}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500/50 pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button type="submit"
                className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-sm rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-cyan-500/20">
                {authMode === 'login' ? <><LogIn size={14} />Đăng Nhập</> : <><UserPlus size={14} />Tạo Tài Khoản</>}
              </button>
            </form>
            <div className="mt-4 text-center">
              <button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} className="text-xs text-blue-600 hover:text-blue-700">
                {authMode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
              </button>
            </div>
            {authMode === 'login' && (
              <div className="mt-2 text-center">
                <button onClick={() => setShowForgot(true)} className="text-[10px] text-slate-400 hover:text-blue-600 transition-colors">
                  Quên Mật Khẩu?
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
