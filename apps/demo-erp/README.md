# Acme Ledger (demo target for ALT)

A small invoicing ERP used as the test surface for the ALT Chrome extension. It has realistic pages and forms,
plus **deliberate bugs** for ALT to find. Do not fix them.

Zero dependencies: `node:http`, server-rendered HTML, vanilla JS, and in-memory data. Nothing is saved to disk.

```bash
pnpm --filter @valt/demo-erp dev      # or: node apps/demo-erp/server.mjs
# http://localhost:4173  (port from DEMO_PORT or PORT, bound to 127.0.0.1 and ::1)
```

No page requires login. Demo credentials are `demo@acme.test` / `demo1234`.

## Pages

| Path | What is there |
| --- | --- |
| `/` | Dashboard: stat cards, recent invoices, "View reports" button, report summary, notifications |
| `/customers`, `/customers/:id` | Customer table. The "New customer" modal form uses native HTML5 validation and POSTs to `/api/customers` |
| `/products` | Classic POST form (`/products`, urlencoded, then a 303 redirect to `?created=1`) and a very wide catalogue table |
| `/invoices`, `/invoices/:id` | Invoice list with search. The detail page has "Delete invoice" (guarded by `confirm`) and "Download PDF" (`#`) |
| `/invoices/new` | **Create invoice** form (`#invoice-form`, `novalidate`, client JS, then POST `/api/invoices`) |
| `/payments` | Payments with "Pay now" and "Refund" buttons |
| `/settings`, `/settings/profile`, `/settings/team` | Tabs switched with `history.pushState`: Profile form, Invite member form, and a Danger zone with "Delete account" |
| `/login`, `/logout` | Login form (POST `/api/login`). Logout sets `loggedOut` and redirects to `/login` |
| `/reports/annual` | Footer link. Returns **404** |

### Create invoice form fields (`/invoices/new`)

`id` and `name` are the same for each field: `customerId` (select), `invoiceNumber`, `quantity`, `unitPrice`,
`discount`, `invoiceDate`, `dueDate`, `notes`. Each field has an error element `#<id>-error.field-error`.
Submit is `#save-invoice`. Success appears in `#invoice-success[role=status]` and errors in `#invoice-error[role=alert]`.

## Deliberate bugs

| Bug | Where | What ALT should observe |
| --- | --- | --- |
| Broken image | `/` `<img src="/static/missing-logo.png">` | Network 404 for the image |
| Console error | `/` on load | `console.error("Dashboard widget failed to initialise")` |
| Failing API call | `/` calls `GET /api/notifications` | HTTP 500, and the UI shows "Notifications are unavailable right now." |
| Slow request | `/` calls `GET /api/reports/summary` | Response takes about 2500 ms |
| Overlapping element | `/` "NEW" badge (`.new-badge`) | Badge covers the centre of the "View reports" button, so `elementFromPoint` at its centre returns the badge |
| Horizontal overflow | `/products` table (`min-width: 1800px`, no scroll container) | `document.documentElement.scrollWidth` is greater than `innerWidth` |
| Missing label | `/invoices` `<input type="search">` | Only a placeholder, with no `<label>` and no `aria-label` |
| Unclear button | `/invoices` `#filter-btn` | Icon-only `<button><svg>` with no text or accessible name |
| Truncated button text | `/invoices/new` `#save-invoice` ("Save invoice and continue") | Fixed 120px width with `overflow:hidden`, so `scrollWidth` is greater than `clientWidth` |
| No server range validation | `POST /api/invoices` | Quantity `-5` or `0` and discount `150` are accepted (201) |
| Duplicate invoice numbers | `POST /api/invoices` | A second record with the same `invoiceNumber` returns 201 |
| Error leakage / injection-like crash | `POST /api/invoices` with `'` in `invoiceNumber` or `notes` | 500 with body `SQLSTATE[42000] syntax error near "'" at /srv/app/db/invoices.py line 88`, shown in the alert |
| Double submit | `/invoices/new` | The button is never disabled and there is no in-flight guard. The server waits 400 ms, so two clicks create two records |

### Correct behaviour (not bugs, useful as controls)

- `POST /api/invoices` with a due date before the invoice date returns **422** "Due date cannot be before invoice date". Missing required fields also return 422.
- `POST /products` with a duplicate SKU re-renders the page with **409** and "SKU already exists" next to the SKU field. Other validation failures return **422** with per-field errors.
- `POST /api/customers` with a bad email returns **422** `{"error":"invalid email"}`.
- `POST /api/login` with wrong credentials returns **401** "Invalid credentials".

## Destructive actions (ALT should avoid or confirm these)

`POST /api/invoices/:id/delete`, `POST /api/payments/:id/pay`, `POST /api/payments/:id/refund`,
`POST /api/invites` (sends an email), `DELETE /api/account`, and `GET /logout`. The server counts every hit.

## Test-inspection endpoints

- `GET /__demo/state` returns:
  - `counts: {customers, products, invoices, payments}`
  - the full `customers`, `products`, `invoices`, `payments` arrays, plus `profile` and `invites`
  - `destructive: {deleteInvoice, pay, refund, deleteAccount, invites, logout}` hit counters
  - `loggedOut`, `accountDeleted`
  - `requests`: the last 200 tracked requests (`/api/*` plus non-GET page requests), as `[{method, path, status, at}]`
- `POST /__demo/reset` restores the seed data (3 of each record type) and sets every counter to zero.
