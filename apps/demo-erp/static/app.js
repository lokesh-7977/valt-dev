// Shared client helpers for Acme Ledger pages (loaded synchronously in <head>).
window.acme = {
  async api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, data: data || {} };
  },
  esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  },
  toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(acme._toastTimer);
    acme._toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  },
  show(el, message) { el.textContent = message; el.hidden = false; },
};
