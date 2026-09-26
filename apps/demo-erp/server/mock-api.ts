import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";

// demo-erp's fake backend. Runs as Vite middleware in both `dev` and `preview`.
type Invoice = { id: string; customer: string; total: number; [key: string]: unknown };

const invoices: Invoice[] = [];
let nextId = 1;

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c.toString("utf8")));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createInvoice(req: IncomingMessage, res: ServerResponse) {
  let input: Record<string, unknown>;
  try {
    input = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
  } catch {
    return json(res, 400, { error: "Invalid JSON" });
  }
  const quantity = Number(input.quantity ?? 0);
  const unitPrice = Number(input.unit_price ?? 0);
  const discount = Number(input.discount ?? 0);

  // PLANTED BUG demo-09 (C10): the 500 response exposes a stack trace.
  if (quantity > 100) {
    const err = new Error("Quantity limit exceeded");
    return json(res, 500, { error: err.message, stack: err.stack });
  }
  // PLANTED BUG demo-08 (C8): weekend due dates are rejected only here, never in the form.
  const due = typeof input.due_date === "string" ? new Date(`${input.due_date}T00:00:00Z`) : null;
  if (due && [0, 6].includes(due.getUTCDay())) {
    return json(res, 422, { error: "Due date must be a weekday" });
  }

  const total = Math.round(quantity * unitPrice * (1 - discount / 100) * 100) / 100;
  const invoice: Invoice = {
    id: `inv_${nextId++}`,
    customer: String(input.customer ?? ""),
    email: input.email,
    quantity,
    unit_price: unitPrice,
    discount,
    due_date: input.due_date,
    // PLANTED BUG demo-06 (C5): notes are silently cut to 200 characters.
    notes: typeof input.notes === "string" ? input.notes.slice(0, 200) : input.notes,
    total,
  };
  invoices.push(invoice);
  // PLANTED BUG demo-04 (C3): an internal field leaks into the response.
  return json(res, 201, { ...invoice, internal_margin: 0.42 });
}

export const STRICT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'";

const handler: Connect.NextHandleFunction = (req, res, next) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/csp-strict.html") res.setHeader("Content-Security-Policy", STRICT_CSP);
  switch (`${req.method} ${url.pathname}`) {
    case "POST /api/invoices":
      void createInvoice(req, res);
      return;
    case "GET /api/invoices":
      // PLANTED BUG demo-10: the grand total sums gross amounts, ignoring discounts.
      return json(res, 200, {
        invoices,
        total: invoices.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0),
      });
    case "GET /api/probe/json":
      return json(res, 200, { ok: true, value: 42 });
    case "GET /api/probe/stream":
      res.setHeader("content-type", "text/plain");
      void (async () => {
        for (let i = 1; i <= 5; i++) {
          res.write(`chunk ${i}\n`);
          await sleep(100);
        }
        res.end();
      })();
      return;
    case "GET /api/probe/slow":
      void sleep(2000).then(() => json(res, 200, { slow: true }));
      return;
    case "GET /api/probe/error":
      return json(res, 500, { error: "Probe failure" });
    default:
      return next();
  }
};

export function mockApi(): Plugin {
  return {
    name: "demo-erp-mock-api",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
