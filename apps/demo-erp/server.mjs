// Acme Ledger — a small invoicing ERP used as the demo target for ALT.
// Zero dependencies: node:http + server-rendered HTML + in-memory data.
// Several bugs are DELIBERATE (see README.md). Do not "fix" them.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.DEMO_PORT || process.env.PORT) || 4173;
const HOST = '127.0.0.1';
const STATIC = {
  '/static/app.css': ['text/css; charset=utf-8', readFileSync(new URL('./static/app.css', import.meta.url))],
  '/static/app.js': ['text/javascript; charset=utf-8', readFileSync(new URL('./static/app.js', import.meta.url))],
};

// ---------------------------------------------------------------- data ----
function seed() {
  return {
    customers: [
      { id: 1, name: 'Acme Technologies Pvt Ltd', email: 'accounts@acmetech.example', phone: '9876543210', gstin: '27AAPFU0939F1ZV', city: 'Mumbai' },
      { id: 2, name: 'Globex India', email: 'billing@globex.example', phone: '9123456780', gstin: '29AABCG1234K1Z5', city: 'Bengaluru' },
      { id: 3, name: 'Initech Solutions', email: 'finance@initech.example', phone: '9988776655', gstin: '', city: 'Pune' },
    ],
    products: [
      { id: 1, name: 'Cloud Hosting (monthly)', sku: 'CLD-HOST-01', price: 4999, stock: 120, category: 'Services', hsn: '998315', taxRate: 18, reorderLevel: 0, warehouse: 'N/A', supplier: 'In-house', updatedAt: '2026-08-01' },
      { id: 2, name: 'Wireless Keyboard', sku: 'KB-WL-200', price: 1299.5, stock: 45, category: 'Hardware', hsn: '847160', taxRate: 18, reorderLevel: 10, warehouse: 'Pune WH-2', supplier: 'Logi Distributors', updatedAt: '2026-08-12' },
      { id: 3, name: '27" 4K Monitor', sku: 'MON-27-4K', price: 23999, stock: 8, category: 'Hardware', hsn: '852852', taxRate: 28, reorderLevel: 5, warehouse: 'Mumbai WH-1', supplier: 'DisplayCo', updatedAt: '2026-09-02' },
    ],
    invoices: [
      { id: 1, number: 'INV-0001', customerId: 1, quantity: 2, unitPrice: 4999, discount: 0, invoiceDate: '2026-08-01', dueDate: '2026-08-31', notes: 'Hosting for August', status: 'Paid' },
      { id: 2, number: 'INV-0002', customerId: 2, quantity: 10, unitPrice: 1299.5, discount: 5, invoiceDate: '2026-08-15', dueDate: '2026-09-14', notes: '', status: 'Sent' },
      { id: 3, number: 'INV-0003', customerId: 3, quantity: 1, unitPrice: 23999, discount: 0, invoiceDate: '2026-09-10', dueDate: '', notes: '', status: 'Draft' },
    ],
    payments: [
      { id: 1, invoiceId: 1, amount: 9998, method: 'UPI', date: '2026-08-20', status: 'Completed' },
      { id: 2, invoiceId: 2, amount: 12345.25, method: 'Bank transfer', date: '', status: 'Pending' },
      { id: 3, invoiceId: 3, amount: 23999, method: 'Card', date: '', status: 'Pending' },
    ],
    profile: { displayName: 'Demo User', email: 'demo@acme.test', timezone: 'Asia/Kolkata' },
    invites: [],
    destructive: { deleteInvoice: 0, pay: 0, refund: 0, deleteAccount: 0, invites: 0, logout: 0 },
    requests: [],
    loggedOut: false,
    accountDeleted: false,
  };
}
let db = seed();

const nextId = (rows) => rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const customerName = (id) => db.customers.find((c) => c.id === id)?.name ?? 'Unknown customer';
const invoiceTotal = (i) => Math.round(i.quantity * i.unitPrice * (1 - (i.discount || 0) / 100) * 100) / 100;
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

// ------------------------------------------------------------- layout ----
const NAV = [['/', 'Dashboard'], ['/customers', 'Customers'], ['/products', 'Products'], ['/invoices', 'Invoices'], ['/payments', 'Payments'], ['/settings', 'Settings']];

function layout(title, active, body, clientFn) {
  const nav = NAV.map(([href, label]) =>
    `<li><a href="${href}"${href === active ? ' class="active" aria-current="page"' : ''}>${label}</a></li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Acme Ledger</title><link rel="stylesheet" href="/static/app.css"><script src="/static/app.js"></script></head>
<body><div class="shell">
<aside class="sidebar"><a class="brand" href="/">Acme Ledger</a><nav aria-label="Main"><ul>${nav}</ul></nav><a class="signout" href="/logout">Sign out</a></aside>
<div class="main"><main id="content"><h1>${esc(title)}</h1>
${body}
</main><footer class="footer">© 2026 Acme Ledger · <a href="/reports/annual">Annual report</a></footer></div></div>
<div id="toast" class="toast" aria-live="polite" hidden></div>
${clientFn ? `<script>(${clientFn.toString()})();</script>` : ''}
</body></html>`;
}

const invoiceRows = (list) => list.map((i) => `<tr><td><a href="/invoices/${i.id}">${esc(i.number)}</a></td><td>${esc(customerName(i.customerId))}</td>
<td>${esc(i.invoiceDate)}</td><td>${esc(i.dueDate || '—')}</td><td class="num">${inr(invoiceTotal(i))}</td><td><span class="status">${esc(i.status)}</span></td></tr>`).join('');
const invoiceTable = (list, id) => `<table class="table" id="${id}"><thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Due</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>${invoiceRows(list)}</tbody></table>`;

// -------------------------------------------------------------- pages ----
function dashboardClient() {
  console.error('Dashboard widget failed to initialise'); // deliberate console error
  fetch('/api/notifications') // deliberate: always 500
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((d) => { document.getElementById('notifications').textContent = d.items.length + ' new notifications'; })
    .catch(() => { document.getElementById('notifications').textContent = 'Notifications are unavailable right now.'; });
  fetch('/api/reports/summary') // deliberate: ~2500 ms slow
    .then((r) => r.json())
    .then((d) => { document.getElementById('summary').textContent = `${d.invoices} invoices · ${d.billedFormatted} billed · ${d.outstandingFormatted} outstanding`; });
  document.getElementById('view-reports').addEventListener('click', () => document.getElementById('summary-panel').scrollIntoView({ behavior: 'smooth' }));
}

function dashboardPage() {
  const outstanding = db.invoices.filter((i) => i.status !== 'Paid').reduce((s, i) => s + invoiceTotal(i), 0);
  const cards = [['Customers', db.customers.length], ['Products', db.products.length], ['Invoices', db.invoices.length], ['Payments', db.payments.length], ['Outstanding', inr(outstanding)]]
    .map(([l, v]) => `<div class="card"><span class="card-label">${l}</span><strong>${v}</strong></div>`).join('');
  const recent = [...db.invoices].sort((a, b) => b.id - a.id).slice(0, 5);
  return layout('Dashboard', '/', `
<img class="logo" src="/static/missing-logo.png" alt="Acme Ledger logo" width="140" height="36">
<div class="cards" id="stats">${cards}</div>
<div class="toolbar"><div class="badge-wrap"><button type="button" class="btn" id="view-reports">View reports</button><span class="new-badge">NEW</span></div>
<a class="btn btn-primary" href="/invoices/new">New invoice</a></div>
<section class="panel" id="summary-panel"><h2>Report summary</h2><p id="summary">Loading summary…</p></section>
<section class="panel"><h2>Notifications</h2><p id="notifications">Loading…</p></section>
<section class="panel"><h2>Recent invoices</h2>${invoiceTable(recent, 'recent-invoices')}</section>`, dashboardClient);
}

function customersClient() {
  const modal = document.getElementById('customer-modal');
  const form = document.getElementById('customer-form');
  const err = document.getElementById('customer-error');
  const tbody = document.querySelector('#customers-table tbody');
  document.getElementById('new-customer').addEventListener('click', () => {
    form.reset(); err.hidden = true; modal.hidden = false; document.getElementById('cust-name').focus();
  });
  document.getElementById('cancel-customer').addEventListener('click', () => { modal.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.hidden = true; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await acme.api('POST', '/api/customers', Object.fromEntries(new FormData(form)));
    if (r.status === 201) {
      const c = r.data.customer;
      tbody.insertAdjacentHTML('beforeend', `<tr><td><a href="/customers/${c.id}">${acme.esc(c.name)}</a></td><td>${acme.esc(c.email)}</td><td>${acme.esc(c.phone)}</td><td>${acme.esc(c.gstin)}</td><td>${acme.esc(c.city)}</td></tr>`);
      modal.hidden = true;
      acme.toast('Customer created');
    } else {
      acme.show(err, r.data.error || `Could not create customer (${r.status})`);
    }
  });
}

function customersPage() {
  const rows = db.customers.map((c) => `<tr><td><a href="/customers/${c.id}">${esc(c.name)}</a></td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${esc(c.gstin)}</td><td>${esc(c.city)}</td></tr>`).join('');
  return layout('Customers', '/customers', `
<div class="toolbar"><button type="button" class="btn btn-primary" id="new-customer">New customer</button></div>
<table class="table" id="customers-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>GSTIN</th><th>City</th></tr></thead><tbody>${rows}</tbody></table>
<div class="modal" id="customer-modal" role="dialog" aria-modal="true" aria-labelledby="customer-modal-title" hidden>
  <h2 id="customer-modal-title">New customer</h2>
  <form id="customer-form">
    <div id="customer-error" class="alert alert-error" role="alert" hidden></div>
    <div class="field"><label for="cust-name">Name</label><input id="cust-name" name="name" required maxlength="80" autocomplete="organization"></div>
    <div class="field"><label for="cust-email">Email</label><input id="cust-email" name="email" type="email" required autocomplete="email"></div>
    <div class="field"><label for="cust-phone">Phone</label><input id="cust-phone" name="phone" type="tel" pattern="[0-9]{10}" title="10 digit phone number" autocomplete="tel"></div>
    <div class="field"><label for="cust-gstin">GSTIN</label><input id="cust-gstin" name="gstin" pattern="[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}" title="15 character GSTIN, e.g. 27AAPFU0939F1ZV"><p class="hint">Optional. 15 characters, e.g. 27AAPFU0939F1ZV</p></div>
    <div class="actions"><button type="button" class="btn" id="cancel-customer">Cancel</button><button type="submit" class="btn btn-primary">Create customer</button></div>
  </form>
</div>`, customersClient);
}

function customerDetailPage(c) {
  const invs = db.invoices.filter((i) => i.customerId === c.id);
  return layout(c.name, '/customers', `
<p><a href="/customers">← All customers</a></p>
<section class="panel"><h2>Customer details</h2><dl class="details">
<dt>Email</dt><dd>${esc(c.email)}</dd><dt>Phone</dt><dd>${esc(c.phone || '—')}</dd><dt>GSTIN</dt><dd>${esc(c.gstin || '—')}</dd><dt>City</dt><dd>${esc(c.city || '—')}</dd></dl></section>
<section class="panel"><h2>Invoices</h2>${invs.length ? invoiceTable(invs, 'customer-invoices') : '<p>No invoices yet.</p>'}</section>`);
}

function productsPage({ created = false, errors = {}, values = {} } = {}) {
  const rows = db.products.map((p) => `<tr><td>${p.id}</td><td>${esc(p.name)}</td><td>${esc(p.sku)}</td><td>${esc(p.category)}</td><td>${esc(p.hsn)}</td>
<td class="num">${inr(p.price)}</td><td class="num">${p.taxRate}%</td><td class="num">${p.stock}</td><td class="num">${p.reorderLevel}</td><td>${esc(p.warehouse)}</td>
<td>${esc(p.supplier)}</td><td>${esc(p.updatedAt)}</td><td><span class="status">${p.stock > p.reorderLevel ? 'In stock' : 'Reorder'}</span></td></tr>`).join('');
  const field = (id, name, label, attrs) => `<div class="field"><label for="${id}">${label}</label>
<input id="${id}" name="${name}" ${attrs} value="${esc(values[name])}"${errors[name] ? ` aria-invalid="true" aria-describedby="${id}-error"` : ''}>
${errors[name] ? `<p class="field-error" id="${id}-error">${esc(errors[name])}</p>` : ''}</div>`;
  return layout('Products', '/products', `
${created ? '<div class="alert alert-success" role="status">Product created successfully.</div>' : ''}
${Object.keys(errors).length ? '<div class="alert alert-error" role="alert">Please fix the errors below.</div>' : ''}
<section class="panel"><h2>Add product</h2>
<form id="product-form" method="post" action="/products"><div class="grid-2">
${field('product-name', 'name', 'Product name', 'required')}
${field('product-sku', 'sku', 'SKU', 'required maxlength="12"')}
${field('product-price', 'price', 'Price (₹)', 'type="number" min="0" step="0.01" required')}
${field('product-stock', 'stock', 'Stock', 'type="number" min="0" step="1" required')}
</div><div class="actions"><button type="submit" class="btn btn-primary">Add product</button></div></form></section>
<h2>Catalogue</h2>
<table class="table table-wide" id="products-table"><thead><tr><th>ID</th><th>Name</th><th>SKU</th><th>Category</th><th>HSN code</th><th class="num">Price</th><th class="num">Tax rate</th>
<th class="num">Stock</th><th class="num">Reorder level</th><th>Warehouse</th><th>Supplier</th><th>Last updated</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function invoicesClient() {
  const search = document.querySelector('input[type="search"]');
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    for (const tr of document.querySelectorAll('#invoices-table tbody tr')) tr.hidden = !tr.textContent.toLowerCase().includes(q);
  });
  document.getElementById('filter-btn').addEventListener('click', () => { search.value = ''; search.dispatchEvent(new Event('input')); });
}

function invoicesPage() {
  // Deliberate: search input has only a placeholder (no label / aria-label); icon button has no accessible name.
  return layout('Invoices', '/invoices', `
<div class="toolbar"><input type="search" placeholder="Search invoices…">
<button type="button" class="btn icon-btn" id="filter-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg></button>
<a class="btn btn-primary" href="/invoices/new">New invoice</a></div>
${invoiceTable(db.invoices, 'invoices-table')}`, invoicesClient);
}

function newInvoiceClient() {
  const form = document.getElementById('invoice-form');
  const ok = document.getElementById('invoice-success');
  const bad = document.getElementById('invoice-error');
  // Deliberate: no in-flight guard and the submit button is never disabled -> double submit creates duplicates.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ok.hidden = true; bad.hidden = true;
    let firstInvalid = null;
    for (const el of form.querySelectorAll('input, select, textarea')) {
      const errEl = document.getElementById(el.id + '-error');
      if (el.required && !el.value.trim()) { // only checks "non-empty"
        el.setAttribute('aria-invalid', 'true');
        errEl.textContent = form.querySelector(`label[for="${el.id}"]`).textContent + ' is required';
        errEl.hidden = false;
        firstInvalid = firstInvalid || el;
      } else {
        el.removeAttribute('aria-invalid'); errEl.textContent = ''; errEl.hidden = true;
      }
    }
    if (firstInvalid) { firstInvalid.focus(); return; }
    const r = await acme.api('POST', '/api/invoices', Object.fromEntries(new FormData(form)));
    if (r.status === 201) {
      acme.show(ok, `Invoice ${r.data.invoice.number} saved successfully`);
      form.reset();
    } else {
      acme.show(bad, r.data.error || `Could not save invoice (${r.status})`);
    }
  });
}

function newInvoicePage() {
  const options = db.customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const f = (id, label, control) => `<div class="field"><label for="${id}">${label}</label>${control}<p class="field-error" id="${id}-error" hidden></p></div>`;
  return layout('Create invoice', '/invoices', `
<form id="invoice-form" class="form-card" novalidate>
<div class="alert alert-success" id="invoice-success" role="status" hidden></div>
<div class="alert alert-error" id="invoice-error" role="alert" hidden></div>
${f('customerId', 'Customer', `<select id="customerId" name="customerId" required><option value="">Select a customer…</option>${options}</select>`)}
<div class="grid-2">
${f('invoiceNumber', 'Invoice number', '<input id="invoiceNumber" name="invoiceNumber" type="text" required maxlength="20" placeholder="INV-0001">')}
${f('quantity', 'Quantity', '<input id="quantity" name="quantity" type="number" required min="1" max="1000" step="1">')}
${f('unitPrice', 'Unit price (₹)', '<input id="unitPrice" name="unitPrice" type="number" required min="0" step="0.01">')}
${f('discount', 'Discount %', '<input id="discount" name="discount" type="number" min="0" max="100">')}
${f('invoiceDate', 'Invoice date', '<input id="invoiceDate" name="invoiceDate" type="date" required>')}
${f('dueDate', 'Due date', '<input id="dueDate" name="dueDate" type="date">')}
</div>
${f('notes', 'Notes', '<textarea id="notes" name="notes" maxlength="500" rows="4"></textarea>')}
<div class="actions"><a class="btn" href="/invoices">Cancel</a><button type="submit" class="btn btn-primary btn-save" id="save-invoice">Save invoice and continue</button></div>
</form>`, newInvoiceClient);
}

function invoiceDetailClient() {
  const btn = document.getElementById('delete-invoice');
  btn.addEventListener('click', async () => {
    if (!confirm('Delete this invoice?')) return;
    const r = await acme.api('POST', `/api/invoices/${btn.dataset.id}/delete`);
    if (r.ok) { acme.toast('Invoice deleted'); setTimeout(() => { location.href = '/invoices'; }, 600); }
    else acme.show(document.getElementById('detail-error'), r.data.error || 'Could not delete invoice');
  });
}

function invoiceDetailPage(i) {
  return layout(`Invoice ${i.number}`, '/invoices', `
<p><a href="/invoices">← All invoices</a></p>
<div class="alert alert-error" id="detail-error" role="alert" hidden></div>
<section class="panel"><dl class="details">
<dt>Customer</dt><dd><a href="/customers/${i.customerId}">${esc(customerName(i.customerId))}</a></dd>
<dt>Status</dt><dd><span class="status">${esc(i.status)}</span></dd><dt>Invoice date</dt><dd>${esc(i.invoiceDate)}</dd><dt>Due date</dt><dd>${esc(i.dueDate || '—')}</dd>
<dt>Quantity</dt><dd>${i.quantity}</dd><dt>Unit price</dt><dd>${inr(i.unitPrice)}</dd><dt>Discount</dt><dd>${i.discount || 0}%</dd>
<dt>Total</dt><dd><strong>${inr(invoiceTotal(i))}</strong></dd><dt>Notes</dt><dd>${esc(i.notes || '—')}</dd></dl></section>
<div class="toolbar"><a class="btn" href="#">Download PDF</a><button type="button" class="btn btn-danger" id="delete-invoice" data-id="${i.id}">Delete invoice</button></div>`, invoiceDetailClient);
}

function paymentsClient() {
  document.getElementById('payments-table').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const r = await acme.api('POST', `/api/payments/${btn.dataset.id}/${btn.dataset.action}`);
    if (r.ok) {
      document.getElementById('status-' + btn.dataset.id).textContent = r.data.payment.status;
      acme.toast(btn.dataset.action === 'pay' ? 'Payment completed' : 'Payment refunded');
    } else acme.toast(r.data.error || 'Action failed');
  });
}

function paymentsPage() {
  const rows = db.payments.map((p) => {
    const inv = db.invoices.find((i) => i.id === p.invoiceId);
    return `<tr><td>PAY-${String(p.id).padStart(4, '0')}</td><td>${inv ? `<a href="/invoices/${inv.id}">${esc(inv.number)}</a>` : '—'}</td><td class="num">${inr(p.amount)}</td>
<td>${esc(p.method)}</td><td>${esc(p.date || '—')}</td><td><span class="status" id="status-${p.id}">${esc(p.status)}</span></td>
<td><button type="button" class="btn btn-primary btn-sm" data-action="pay" data-id="${p.id}">Pay now</button> <button type="button" class="btn btn-danger btn-sm" data-action="refund" data-id="${p.id}">Refund</button></td></tr>`;
  }).join('');
  return layout('Payments', '/payments', `
<table class="table" id="payments-table"><thead><tr><th>Reference</th><th>Invoice</th><th class="num">Amount</th><th>Method</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`, paymentsClient);
}

function settingsClient() {
  const names = ['profile', 'team'];
  const fromPath = () => (location.pathname.endsWith('/team') ? 'team' : 'profile');
  function show(name, push) {
    for (const n of names) {
      document.getElementById('tab-' + n).setAttribute('aria-selected', String(n === name));
      document.getElementById('panel-' + n).hidden = n !== name;
    }
    if (push) history.pushState({ tab: name }, '', '/settings/' + name);
  }
  for (const n of names) document.getElementById('tab-' + n).addEventListener('click', () => show(n, true));
  window.addEventListener('popstate', () => show(fromPath(), false));

  const wire = (formId, method, url, okMsg, statusId, errId, after) => {
    const form = document.getElementById(formId);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = document.getElementById(statusId); const bad = document.getElementById(errId);
      ok.hidden = true; bad.hidden = true;
      const r = await acme.api(method, url, Object.fromEntries(new FormData(form)));
      if (r.ok) { acme.show(ok, okMsg); if (after) after(form); } else acme.show(bad, r.data.error || `Request failed (${r.status})`);
    });
  };
  wire('profile-form', 'PUT', '/api/profile', 'Profile updated', 'profile-status', 'profile-error');
  wire('invite-form', 'POST', '/api/invites', 'Invite sent', 'invite-status', 'invite-error', (f) => f.reset());
  document.getElementById('delete-account').addEventListener('click', async () => {
    const r = await acme.api('DELETE', '/api/account');
    acme.toast(r.ok ? 'Account scheduled for deletion' : 'Could not delete account');
  });
}

function settingsPage(tab) {
  const p = db.profile;
  const tz = ['Asia/Kolkata', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC']
    .map((z) => `<option${z === p.timezone ? ' selected' : ''}>${z}</option>`).join('');
  const team = [['Demo User', 'demo@acme.test', 'Admin'], ...db.invites.map((i) => ['(invited)', i.email, i.role])]
    .map(([n, e, r]) => `<tr><td>${esc(n)}</td><td>${esc(e)}</td><td>${esc(r)}</td></tr>`).join('');
  return layout('Settings', '/settings', `
<div class="tabs" role="tablist">
<button type="button" class="tab" role="tab" id="tab-profile" aria-controls="panel-profile" aria-selected="${tab === 'profile'}">Profile</button>
<button type="button" class="tab" role="tab" id="tab-team" aria-controls="panel-team" aria-selected="${tab === 'team'}">Team</button></div>
<section class="panel" role="tabpanel" id="panel-profile" aria-labelledby="tab-profile"${tab === 'profile' ? '' : ' hidden'}>
<form id="profile-form">
<div class="alert alert-success" id="profile-status" role="status" hidden></div><div class="alert alert-error" id="profile-error" role="alert" hidden></div>
<div class="field"><label for="profile-name">Display name</label><input id="profile-name" name="displayName" required value="${esc(p.displayName)}"></div>
<div class="field"><label for="profile-email">Email</label><input id="profile-email" name="email" type="email" value="${esc(p.email)}"></div>
<div class="field"><label for="profile-timezone">Timezone</label><select id="profile-timezone" name="timezone">${tz}</select></div>
<div class="actions"><button type="submit" class="btn btn-primary">Save changes</button></div></form></section>
<section class="panel" role="tabpanel" id="panel-team" aria-labelledby="tab-team"${tab === 'team' ? '' : ' hidden'}>
<h2>Team members</h2><table class="table" id="team-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${team}</tbody></table>
<h2 style="margin-top:20px">Invite member</h2>
<form id="invite-form">
<div class="alert alert-success" id="invite-status" role="status" hidden></div><div class="alert alert-error" id="invite-error" role="alert" hidden></div>
<div class="grid-2"><div class="field"><label for="invite-email">Email</label><input id="invite-email" name="email" type="email" required></div>
<div class="field"><label for="invite-role">Role</label><select id="invite-role" name="role"><option>Viewer</option><option>Editor</option><option>Admin</option></select></div></div>
<div class="actions"><button type="submit" class="btn btn-primary">Send invite</button></div></form></section>
<section class="panel danger-zone"><h2>Danger zone</h2><p class="hint">Permanently delete this account and all of its data.</p>
<button type="button" class="btn btn-danger" id="delete-account">Delete account</button></section>`, settingsClient);
}

function loginClient() {
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = document.getElementById('login-status'); const bad = document.getElementById('login-error');
    ok.hidden = true; bad.hidden = true;
    const r = await acme.api('POST', '/api/login', Object.fromEntries(new FormData(form)));
    if (r.ok) { acme.show(ok, 'Signed in. Redirecting…'); setTimeout(() => { location.href = '/'; }, 500); }
    else acme.show(bad, r.data.error || 'Sign in failed');
  });
}

function loginPage() {
  return layout('Sign in', '', `
${db.loggedOut ? '<div class="alert alert-success" role="status">You have been signed out.</div>' : ''}
<section class="panel login-card"><form id="login-form">
<div class="alert alert-success" id="login-status" role="status" hidden></div><div class="alert alert-error" id="login-error" role="alert" hidden></div>
<div class="field"><label for="login-email">Email</label><input id="login-email" name="email" type="email" required autocomplete="username"></div>
<div class="field"><label for="login-password">Password</label><input id="login-password" name="password" type="password" required autocomplete="current-password"></div>
<p class="hint">Demo account: demo@acme.test / demo1234</p>
<div class="actions"><button type="submit" class="btn btn-primary">Sign in</button></div></form></section>`, loginClient);
}

const notFoundPage = () => layout('Page not found', '', '<p>The page you were looking for does not exist.</p><p><a href="/">Back to dashboard</a></p>');

// --------------------------------------------------------------- http ----
function send(res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
const redirect = (res, location, status = 303) => send(res, status, '', 'text/plain', { Location: location });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

// ---------------------------------------------------------------- api ----
async function createInvoice(req, res) {
  const b = await readJson(req);
  if (!b) return json(res, 400, { error: 'invalid JSON' });
  await sleep(400); // artificial latency so double-submit is observable
  const missing = ['customerId', 'invoiceNumber', 'quantity', 'unitPrice', 'invoiceDate'].filter((k) => str(b[k]) === '');
  if (missing.length) return json(res, 422, { error: `Missing required field: ${missing[0]}`, fields: missing });
  const number = str(b.invoiceNumber);
  const notes = str(b.notes);
  if (number.includes("'") || notes.includes("'")) {
    // DELIBERATE BUG: unescaped quote "breaks the SQL" and internals leak into the response.
    return json(res, 500, { error: 'SQLSTATE[42000] syntax error near "\'" at /srv/app/db/invoices.py line 88' });
  }
  const customerId = Number(b.customerId);
  if (!db.customers.some((c) => c.id === customerId)) return json(res, 422, { error: 'Unknown customer' });
  const quantity = Number(b.quantity);
  const unitPrice = Number(b.unitPrice);
  const discount = str(b.discount) === '' ? 0 : Number(b.discount);
  if (![quantity, unitPrice, discount].every(Number.isFinite)) return json(res, 422, { error: 'Quantity, unit price and discount must be numbers' });
  if (unitPrice < 0) return json(res, 422, { error: 'Unit price cannot be negative' });
  // DELIBERATE BUG: no range checks for quantity (<=0 accepted) or discount (>100 accepted).
  const invoiceDate = str(b.invoiceDate);
  const dueDate = str(b.dueDate);
  if (!DATE_RE.test(invoiceDate) || (dueDate && !DATE_RE.test(dueDate))) return json(res, 422, { error: 'Dates must be YYYY-MM-DD' });
  if (dueDate && dueDate < invoiceDate) return json(res, 422, { error: 'Due date cannot be before invoice date' });
  // DELIBERATE BUG: no uniqueness check on invoice number.
  const invoice = { id: nextId(db.invoices), number, customerId, quantity, unitPrice, discount, invoiceDate, dueDate, notes, status: 'Draft' };
  db.invoices.push(invoice);
  return json(res, 201, { invoice });
}

async function handleApi(req, res, path) {
  const m = req.method;
  let match;
  if (m === 'GET' && path === '/api/notifications') return json(res, 500, { error: 'Notification service unavailable' });
  if (m === 'GET' && path === '/api/reports/summary') {
    await sleep(2500);
    const billed = db.invoices.reduce((s, i) => s + invoiceTotal(i), 0);
    const outstanding = db.invoices.filter((i) => i.status !== 'Paid').reduce((s, i) => s + invoiceTotal(i), 0);
    return json(res, 200, { invoices: db.invoices.length, billed, outstanding, billedFormatted: inr(billed), outstandingFormatted: inr(outstanding) });
  }
  if (m === 'POST' && path === '/api/customers') {
    const b = await readJson(req);
    if (!b) return json(res, 400, { error: 'invalid JSON' });
    const c = { name: str(b.name), email: str(b.email), phone: str(b.phone), gstin: str(b.gstin).toUpperCase(), city: str(b.city) };
    if (!c.name || c.name.length > 80) return json(res, 422, { error: 'Name is required (max 80 characters)' });
    if (!EMAIL_RE.test(c.email)) return json(res, 422, { error: 'invalid email' });
    if (c.phone && !/^[0-9]{10}$/.test(c.phone)) return json(res, 422, { error: 'invalid phone' });
    if (c.gstin && !GSTIN_RE.test(c.gstin)) return json(res, 422, { error: 'invalid GSTIN' });
    const customer = { id: nextId(db.customers), ...c };
    db.customers.push(customer);
    return json(res, 201, { customer });
  }
  if (m === 'GET' && path === '/api/invoices') return json(res, 200, { invoices: db.invoices });
  if (m === 'POST' && path === '/api/invoices') return createInvoice(req, res);
  if (m === 'POST' && (match = path.match(/^\/api\/invoices\/(\d+)\/delete$/))) {
    db.destructive.deleteInvoice++;
    const idx = db.invoices.findIndex((i) => i.id === Number(match[1]));
    if (idx < 0) return json(res, 404, { error: 'Invoice not found' });
    db.invoices.splice(idx, 1);
    return json(res, 200, { deleted: true });
  }
  if (m === 'POST' && (match = path.match(/^\/api\/payments\/(\d+)\/(pay|refund)$/))) {
    const action = match[2];
    db.destructive[action]++;
    const payment = db.payments.find((p) => p.id === Number(match[1]));
    if (!payment) return json(res, 404, { error: 'Payment not found' });
    if (action === 'pay') {
      if (payment.status === 'Completed') return json(res, 409, { error: 'Payment already completed' });
      Object.assign(payment, { status: 'Completed', date: today() });
    } else {
      if (payment.status !== 'Completed') return json(res, 409, { error: 'Only completed payments can be refunded' });
      payment.status = 'Refunded';
    }
    return json(res, 200, { payment });
  }
  if (m === 'PUT' && path === '/api/profile') {
    const b = await readJson(req);
    if (!b) return json(res, 400, { error: 'invalid JSON' });
    if (!str(b.displayName)) return json(res, 422, { error: 'Display name is required' });
    if (str(b.email) && !EMAIL_RE.test(str(b.email))) return json(res, 422, { error: 'invalid email' });
    db.profile = { displayName: str(b.displayName), email: str(b.email), timezone: str(b.timezone) || db.profile.timezone };
    return json(res, 200, { profile: db.profile });
  }
  if (m === 'POST' && path === '/api/invites') {
    db.destructive.invites++;
    const b = await readJson(req);
    if (!b) return json(res, 400, { error: 'invalid JSON' });
    const role = str(b.role) || 'Viewer';
    if (!EMAIL_RE.test(str(b.email))) return json(res, 422, { error: 'invalid email' });
    if (!['Viewer', 'Editor', 'Admin'].includes(role)) return json(res, 422, { error: 'invalid role' });
    const invite = { email: str(b.email), role, sentAt: new Date().toISOString() };
    db.invites.push(invite);
    return json(res, 201, { invite });
  }
  if (m === 'DELETE' && path === '/api/account') {
    db.destructive.deleteAccount++;
    db.accountDeleted = true;
    return json(res, 200, { deleted: true });
  }
  if (m === 'POST' && path === '/api/login') {
    const b = await readJson(req);
    if (!b) return json(res, 400, { error: 'invalid JSON' });
    if (str(b.email).toLowerCase() === 'demo@acme.test' && b.password === 'demo1234') {
      db.loggedOut = false;
      return json(res, 200, { user: { email: 'demo@acme.test', displayName: db.profile.displayName } });
    }
    return json(res, 401, { error: 'Invalid credentials' });
  }
  return json(res, 404, { error: 'not found' });
}

// ------------------------------------------------------------- router ----
async function handleProductPost(req, res) {
  const form = new URLSearchParams(await readBody(req));
  const values = { name: str(form.get('name')), sku: str(form.get('sku')), price: str(form.get('price')), stock: str(form.get('stock')) };
  const errors = {};
  if (!values.name) errors.name = 'Product name is required';
  if (!values.sku) errors.sku = 'SKU is required';
  else if (values.sku.length > 12) errors.sku = 'SKU must be at most 12 characters';
  const price = Number(values.price);
  if (values.price === '' || !Number.isFinite(price) || price < 0) errors.price = 'Price must be a number, 0 or more';
  const stock = Number(values.stock);
  if (values.stock === '' || !Number.isInteger(stock) || stock < 0) errors.stock = 'Stock must be a whole number, 0 or more';
  let status = 422;
  if (!errors.sku && db.products.some((p) => p.sku.toLowerCase() === values.sku.toLowerCase())) {
    errors.sku = 'SKU already exists';
    if (Object.keys(errors).length === 1) status = 409;
  }
  if (Object.keys(errors).length) return send(res, status, productsPage({ errors, values }));
  db.products.push({ id: nextId(db.products), name: values.name, sku: values.sku, price, stock, category: 'Uncategorised', hsn: '—',
    taxRate: 18, reorderLevel: 0, warehouse: '—', supplier: '—', updatedAt: today() });
  return redirect(res, '/products?created=1');
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;
  let match;

  if (path.startsWith('/api/')) return handleApi(req, res, path);
  if (path === '/__demo/state' && m === 'GET') {
    const { customers, products, invoices, payments } = db;
    return json(res, 200, {
      counts: { customers: customers.length, products: products.length, invoices: invoices.length, payments: payments.length },
      customers, products, invoices, payments, profile: db.profile, invites: db.invites,
      destructive: db.destructive, loggedOut: db.loggedOut, accountDeleted: db.accountDeleted, requests: db.requests,
    });
  }
  if (path === '/__demo/reset' && m === 'POST') { db = seed(); return json(res, 200, { reset: true }); }
  if (STATIC[path]) return send(res, 200, STATIC[path][1], STATIC[path][0]);
  if (path.startsWith('/static/')) return send(res, 404, 'Not found', 'text/plain'); // includes the deliberate missing-logo.png
  if (path === '/products' && m === 'POST') return handleProductPost(req, res);
  if (m !== 'GET' && m !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain', { Allow: 'GET' });

  if (path === '/') return send(res, 200, dashboardPage());
  if (path === '/customers') return send(res, 200, customersPage());
  if ((match = path.match(/^\/customers\/(\d+)$/))) {
    const c = db.customers.find((x) => x.id === Number(match[1]));
    return c ? send(res, 200, customerDetailPage(c)) : send(res, 404, notFoundPage());
  }
  if (path === '/products') return send(res, 200, productsPage({ created: url.searchParams.get('created') === '1' }));
  if (path === '/invoices') return send(res, 200, invoicesPage());
  if (path === '/invoices/new') return send(res, 200, newInvoicePage());
  if ((match = path.match(/^\/invoices\/(\d+)$/))) {
    const i = db.invoices.find((x) => x.id === Number(match[1]));
    return i ? send(res, 200, invoiceDetailPage(i)) : send(res, 404, notFoundPage());
  }
  if (path === '/payments') return send(res, 200, paymentsPage());
  if (path === '/settings' || path === '/settings/profile') return send(res, 200, settingsPage('profile'));
  if (path === '/settings/team') return send(res, 200, settingsPage('team'));
  if (path === '/login') return send(res, 200, loginPage());
  if (path === '/logout') { db.destructive.logout++; db.loggedOut = true; return redirect(res, '/login', 302); }
  return send(res, 404, notFoundPage()); // includes the footer's /reports/annual
}

function handler(req, res) {
  const path = new URL(req.url, 'http://localhost').pathname;
  const tracked = path.startsWith('/api/') || (req.method !== 'GET' && !path.startsWith('/__demo/'));
  if (tracked) {
    res.on('finish', () => {
      db.requests.push({ method: req.method, path, status: res.statusCode, at: new Date().toISOString() });
      if (db.requests.length > 200) db.requests.splice(0, db.requests.length - 200);
    });
  }
  route(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'internal error' });
  });
}

const servers = [http.createServer(handler).listen(PORT, HOST, () => console.log(`Acme Ledger demo running at http://localhost:${PORT}`))];
// Also listen on IPv6 loopback so "localhost" works when it resolves to ::1 (best effort).
const v6 = http.createServer(handler);
v6.on('error', () => {});
v6.listen(PORT, '::1');
servers.push(v6);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const s of servers) s.close(); process.exit(0); });
