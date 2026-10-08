// content-rexi.js — chạy trên rexiai.bot.cd, đọc token đăng nhập và đẩy cho background.
function pushToken() {
  try {
    const t = localStorage.getItem('rexi_token');
    if (t) {
      chrome.storage.local.set({ rexi_token: t });
      chrome.runtime.sendMessage({ type: 'token', token: t }, () => { void chrome.runtime.lastError; });
    }
  } catch (e) {}
}
pushToken();
setInterval(pushToken, 15000);
