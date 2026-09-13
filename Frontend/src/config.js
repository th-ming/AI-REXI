/**
 * API Configuration — single source of truth
 * 
 * All API calls use the '/api' prefix which works in both:
 * - Development: Vite proxy forwards /api/* → http://localhost:5000
 * - Production: Backend serves frontend from dist/ and handles /api/* directly
 */

export const API_BASE = '/api';

/**
 * OpenCut editor URL (Next.js dev server default port 3000).
 * Override with env var VITE_OPENCUT_URL at build time.
 */
export const OPENCUT_URL = import.meta.env.VITE_OPENCUT_URL || 'http://localhost:3000';

/**
 * Centralized fetch wrapper with auth token support.
 * 
 * @param {string} path - API endpoint path (without /api prefix), e.g. '/auth/users'
 * @param {string|null} token - Bearer token for authentication
 * @param {RequestInit} options - Additional fetch options
 * @returns {Promise<any>} Parsed JSON response
 */
export async function apiFetch(path, token, options = {}) {
  // Hỗ trợ cả 2 cách gọi: apiFetch(path, options) và apiFetch(path, token, options)
  if (typeof token === 'object' && token !== null) {
    options = token;
    token = null;
  }
  // Tự động lấy token từ localStorage nếu không truyền (fix: trước đây gọi apiFetch(path, {headers}) sai signature)
  if (!token && typeof localStorage !== 'undefined') {
    token = localStorage.getItem('rexi_token');
  }
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Token hết hạn / không hợp lệ → báo app mở lại màn hình đăng nhập (thay vì chết lặng)
    if (res.status === 401 && token && (data.code === 'INVALID_TOKEN' || data.code === 'LOGIN_REQUIRED')) {
      try {
        window.dispatchEvent(new CustomEvent('rexi_session_expired', { detail: data.error }));
      } catch {}
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

/**
 * Lightweight fetch wrapper WITHOUT token (for public endpoints).
 * 
 * @param {string} path - API endpoint path (without /api prefix)
 * @param {RequestInit} options - Additional fetch options
 * @returns {Promise<any>} Parsed JSON response
 */
export async function apiFetchPublic(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
