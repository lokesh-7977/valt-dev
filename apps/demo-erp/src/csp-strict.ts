// Plain TS (no React, no inline script or style) for the strict-CSP page.
const formEl = document.getElementById("csp-form") as HTMLFormElement;
const statusEl = document.getElementById("csp-status") as HTMLParagraphElement;

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = new FormData(formEl);
  // PLANTED BUG (C2): amount is rounded before it is sent, so "12.50" arrives as 13.
  const body = {
    customer: String(data.get("customer") ?? ""),
    amount: Math.round(Number(data.get("amount"))),
    due_date: "2026-10-30",
  };
  void fetch("/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer demo" },
    body: JSON.stringify(body),
  }).then((res) => {
    statusEl.textContent = res.ok ? "Order saved" : "Order failed";
  });
});

export {};
