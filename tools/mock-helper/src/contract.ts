import type { Bug, CapturedSubmit, ContractRow } from "@valt/protocol";

export const SCREENSHOT_URL = "http://127.0.0.1:7777/assets/screenshots/invoice-new.png";

type Submit = CapturedSubmit["payload"];

const asObject = (body: unknown): Record<string, unknown> => {
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return {};
    }
  }
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
};

const show = (v: unknown): string =>
  v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);

const NUMERIC = new Set(["number", "range", "output"]);

/** Same value across layers? Numeric UI fields must arrive as numbers (else C2). */
function sameValue(fieldType: string, ui: string, other: unknown): boolean {
  if (NUMERIC.has(fieldType) && ui.trim() !== "" && !Number.isNaN(Number(ui))) {
    return typeof other === "number" && Number(ui) === other;
  }
  return show(other) === ui;
}

const TITLES: Record<string, (field: string) => string> = {
  C1: (f) => `${f} shown in the UI is missing from the request`,
  C2: (f) => `${f} changed between the UI and the request`,
  C4: () => "UI reported success while the server failed",
  C6: (f) => `${f} in the UI differs from the server response`,
};

/**
 * Naive contract check: join form fields with the last non-GET request and its response by key.
 * Returns the rows plus a bug for the first mismatch.
 */
export function buildContract(submit: Submit): { rows: ContractRow[]; bug: Bug | null } {
  const writes = submit.requests.filter((r) => r.method.toUpperCase() !== "GET");
  const req = writes.at(-1) ?? submit.requests.at(-1);
  const reqBody = asObject(req?.reqBody);
  const resBody = asObject(req?.resBody);
  const rows: ContractRow[] = [];
  let first: { row: ContractRow; selector: string } | null = null;

  for (const field of submit.form.fields) {
    const ui = field.value;
    const inRequest = field.name in reqBody;
    const inResponse = field.name in resBody;
    let code: string | undefined;
    if (field.type === "output") {
      // Computed UI values (totals) are checked against the response only.
      if (inResponse && !sameValue(field.type, ui, resBody[field.name])) code = "C6";
    } else if (!inRequest) {
      code = "C1";
    } else if (!sameValue(field.type, ui, reqBody[field.name])) {
      code = "C2";
    }
    const row: ContractRow = {
      field: field.name,
      uiValue: ui,
      requestValue: show(reqBody[field.name]),
      responseValue: show(resBody[field.name]),
      ok: code === undefined,
      ...(code ? { code } : {}),
    };
    rows.push(row);
    if (code && !first) first = { row, selector: field.selector };
  }

  const toast = submit.uiAfter.toasts.find((t) => /saved|success/i.test(t));
  if (req && req.status >= 400 && toast) {
    const row: ContractRow = {
      field: "status",
      uiValue: toast,
      requestValue: "",
      responseValue: String(req.status),
      ok: false,
      code: "C4",
    };
    rows.push(row);
    if (!first) first = { row, selector: submit.form.selector };
  }

  if (!first) return { rows, bug: null };
  const { row, selector } = first;
  const code = row.code ?? "C2";
  const bug: Bug = {
    bugId: `mock-${submit.submitId}-${row.field}`,
    fingerprint: `${submit.route}:${row.field}:${code}`,
    title: (TITLES[code] ?? TITLES.C2!)(row.field),
    severity: code === "C4" ? "critical" : "high",
    layer: "ui_api",
    checkCode: code,
    pageUrl: submit.pageUrl,
    route: submit.route,
    anchor: { selector },
    steps: [`Open ${submit.route}`, "Fill in the form", "Submit it"],
    expected: `${row.field} is "${row.uiValue}" in the UI, the request and the response`,
    actual: `request: "${row.requestValue}", response: "${row.responseValue}"`,
    evidence: {
      screenshotUrl: SCREENSHOT_URL,
      request: req?.reqBody,
      response: req?.resBody,
      highlightKeys: [row.field],
    },
    env: "localhost",
    status: "open",
  };
  return { rows, bug };
}
