// Every request carries credentials so the extension's redaction has something to redact.
// Browsers drop a Cookie header from fetch, but the page still passes it, so the hook sees it.
const authHeaders = {
  "content-type": "application/json",
  authorization: "Bearer demo",
  cookie: "session=demo-session",
  "x-api-key": "demo-key-123",
};

export type Invoice = {
  id: string;
  customer: string;
  total: number;
  [key: string]: unknown;
};

export async function createInvoice(
  body: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch("/api/invoices", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

export async function listInvoices(): Promise<{ invoices: Invoice[]; total: number }> {
  const res = await fetch("/api/invoices", { headers: authHeaders });
  return (await res.json()) as { invoices: Invoice[]; total: number };
}
