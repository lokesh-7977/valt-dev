import type { DiscoveredForm, NetworkEvent, TestCase, TestExecution, TestStatus } from "@valt/shared";
import { h, reconcile, setAttr, setText, show, type Child } from "../dom.ts";
import { EXPECT_LABEL, OUTCOME_LABEL, caseKindLabel, describeValue, duration, humanize, pathOf, plural } from "../format.ts";
import { icon, type IconName } from "../icons.ts";
import type { Model, View } from "../types.ts";
import { chevron, emptyState, sourceBadge } from "./common.ts";

type RowStatus = TestStatus | "queued";

const STATUS: Record<RowStatus, { label: string; icon: IconName }> = {
  pass: { label: "Pass", icon: "circle-check" },
  unexpected: { label: "Unexpected (unverified)", icon: "triangle-alert" },
  inconclusive: { label: "Inconclusive", icon: "circle-help" },
  skipped: { label: "Skipped", icon: "circle-minus" },
  error: { label: "Error", icon: "circle-x" },
  queued: { label: "Queued", icon: "clock" },
};

type Filter = "all" | "unexpected";

interface Row {
  c: TestCase;
  exec: TestExecution | null;
  status: RowStatus;
}

interface Group {
  formId: string;
  form: DiscoveredForm | null;
  rows: Row[];
}

function statusChip(status: RowStatus): HTMLElement {
  const s = STATUS[status];
  return h("span", { class: "chip", "data-status": status }, icon(s.icon, 14), s.label);
}

// ---------- evidence ----------

function section(title: string, ...children: Child[]): HTMLElement {
  return h("div", { class: "ev-section" }, h("p", { class: "sub-title" }, title), ...children);
}

function requestLine(r: NetworkEvent): HTMLElement {
  const failed = r.status === 0 || r.status >= 400;
  return h(
    "li",
    { class: "mono break", "data-failed": failed ? "true" : null },
    `${r.method} ${pathOf(r.url)} → `,
    h("strong", null, r.status === 0 ? `failed${r.error ? ` (${r.error})` : ""}` : String(r.status)),
    ` · ${duration(r.durationMs)}`,
  );
}

function evidence(row: Row, form: DiscoveredForm | null): HTMLElement[] {
  const x = row.exec;
  if (!x) return [];
  const ev = x.evidence;
  const labelOf = (key: string): string => form?.fields.find((f) => f.key === key)?.label || key;
  const applied = new Map<string, string>();
  for (const step of x.steps) {
    if (step.type === "fill" && step.fieldKey && step.applied !== undefined && step.applied !== step.value) {
      applied.set(step.fieldKey, step.applied);
    }
  }

  const parts: HTMLElement[] = [];
  parts.push(h("p", { class: "t-callout ev-reason" }, x.result.reason));
  parts.push(
    h(
      "dl",
      { class: "kv" },
      h("dt", null, "Expected"),
      h("dd", null, EXPECT_LABEL[x.expectation]),
      h("dt", null, "Observed"),
      h("dd", null, OUTCOME_LABEL[x.outcome]),
      h("dt", null, "Took"),
      h("dd", null, duration(x.finishedAt - x.startedAt)),
      h("dt", null, "Planned by"),
      h("dd", null, sourceBadge(row.c.source)),
    ),
  );
  if (row.c.rationale) parts.push(section("Why this case", h("p", { class: "t-footnote" }, row.c.rationale)));

  const values = Object.entries(x.values);
  if (values.length) {
    parts.push(
      section(
        "Values entered",
        h(
          "ul",
          { class: "values" },
          ...values.map(([key, raw]) => {
            const v = describeValue(raw);
            const tested = key === x.fieldKey;
            const app = applied.get(key);
            return h(
              "li",
              { class: "value-row", "data-tested": tested ? "true" : null },
              h("span", { class: "value-key" }, labelOf(key), tested ? h("span", { class: "tested" }, "Under test") : null),
              h(
                "span",
                { class: "value-val" },
                h("span", { class: v.empty ? "muted" : "mono break" }, v.empty ? `(${v.text})` : v.text),
                v.note ? h("span", { class: "muted" }, ` · ${v.note}`) : null,
                app !== undefined
                  ? h("span", { class: "muted" }, ` · browser kept “${describeValue(app, 24).text}”`)
                  : null,
              ),
            );
          }),
        ),
      ),
    );
  }

  if (ev.validationMessages.length) {
    parts.push(
      section(
        "Validation messages",
        h(
          "ul",
          { class: "plain t-footnote" },
          ...ev.validationMessages.map((vm) =>
            h("li", null, vm.fieldKey ? h("strong", null, `${labelOf(vm.fieldKey)}: `) : null, vm.message),
          ),
        ),
      ),
    );
  } else if (x.expectation === "reject") {
    parts.push(section("Validation messages", h("p", { class: "t-footnote muted" }, "None shown.")));
  }

  if (ev.messages.length) {
    const tone = { success: "Success", error: "Error", neutral: "Message" } as const;
    parts.push(
      section(
        "Page messages",
        h("ul", { class: "plain t-footnote" }, ...ev.messages.map((pm) => h("li", null, h("strong", null, `${tone[pm.tone]}: `), pm.text))),
      ),
    );
  }

  const others = ev.network.length - ev.mutatingRequests.length;
  if (ev.mutatingRequests.length || others > 0) {
    parts.push(
      section(
        "Requests",
        ev.mutatingRequests.length
          ? h("ul", { class: "plain t-footnote requests" }, ...ev.mutatingRequests.map(requestLine))
          : h("p", { class: "t-footnote muted" }, "No create, update or delete requests."),
        others > 0 ? h("p", { class: "t-footnote muted" }, `${plural(others, "other request")} (reads, assets).`) : null,
      ),
    );
  }

  if (ev.consoleErrors.length) {
    parts.push(
      section(
        "Console errors",
        h("ul", { class: "plain t-footnote" }, ...ev.consoleErrors.map((c) => h("li", { class: "mono break" }, c.message))),
      ),
    );
  }

  if (ev.notes.length) {
    parts.push(section("Notes", h("ul", { class: "plain t-footnote" }, ...ev.notes.map((n) => h("li", null, n)))));
  }

  if (x.steps.length) {
    parts.push(
      h(
        "details",
        { class: "steps" },
        h("summary", { class: "steps-summary" }, chevron(), `Steps (${x.steps.length})`),
        h(
          "ol",
          { class: "step-list t-footnote" },
          ...x.steps.map((st) => {
            const what = st.fieldKey ? labelOf(st.fieldKey) : st.selector ?? "";
            const val = st.value !== undefined ? ` = ${describeValue(st.value, 32).text}` : "";
            return h(
              "li",
              { "data-ok": st.ok ? "true" : "false" },
              h("span", { class: "step-type" }, humanize(st.type)),
              h("span", { class: "break" }, ` ${what}${val}${st.detail ? ` · ${st.detail}` : ""}`),
              st.ok ? null : h("strong", { class: "step-fail" }, " · failed"),
            );
          }),
        ),
      ),
    );
  }
  return parts;
}

// ---------- rows ----------

function rowSig(r: Row): string {
  return `${r.status}|${r.exec?.id ?? ""}|${r.c.title}`;
}

function caseHead(r: Row): Child[] {
  return [
    h("span", { class: "case-title" }, r.c.title),
    h(
      "span",
      { class: "case-meta" },
      statusChip(r.status),
      h("span", { class: "t-footnote muted" }, `${caseKindLabel(r.c.kind)} · ${EXPECT_LABEL[r.c.expectation].replace("Should be ", "expects ")}`),
    ),
  ];
}

function createRow(r: Row, form: DiscoveredForm | null): HTMLElement {
  const li = h("li", { class: "case", "data-status": r.status });
  fillRow(li, r, form);
  return li;
}

function fillRow(li: HTMLElement, r: Row, form: DiscoveredForm | null): void {
  li.dataset.status = r.status;
  if (!r.exec) {
    li.replaceChildren(h("div", { class: "case-static" }, h("span", { class: "case-head" }, ...caseHead(r))));
    return;
  }
  let d = li.querySelector<HTMLDetailsElement>(":scope > details");
  if (!d) {
    d = h("details", { class: "case-details" }, h("summary", { class: "row-summary case-summary" }), h("div", { class: "case-body" }));
    li.replaceChildren(d);
  }
  const summary = d.querySelector(":scope > summary");
  summary?.replaceChildren(h("span", { class: "case-head" }, ...caseHead(r)), chevron());
  const bodyEl = d.querySelector<HTMLElement>(":scope > .case-body");
  if (bodyEl && bodyEl.dataset.exec !== r.exec.id) {
    bodyEl.dataset.exec = r.exec.id;
    bodyEl.replaceChildren(...evidence(r, form));
  }
}

// ---------- view ----------

function buildGroups(m: Model): Group[] {
  const s = m.snapshot;
  if (!s) return [];
  const latest = new Map<string, TestExecution>();
  for (const x of s.executions) {
    const prev = latest.get(x.caseId);
    if (!prev || x.finishedAt >= prev.finishedAt) latest.set(x.caseId, x);
  }
  const forms = new Map(s.forms.map((f) => [f.id, f]));
  const groups = new Map<string, Group>();
  for (const f of s.forms) groups.set(f.id, { formId: f.id, form: f, rows: [] });
  for (const c of s.cases) {
    let g = groups.get(c.formId);
    if (!g) {
      g = { formId: c.formId, form: forms.get(c.formId) ?? null, rows: [] };
      groups.set(c.formId, g);
    }
    const exec = latest.get(c.id) ?? null;
    g.rows.push({ c, exec, status: exec ? exec.result.status : "queued" });
  }
  return [...groups.values()].filter((g) => g.rows.length > 0);
}

export function createTests(): View {
  let filter: Filter = "all";
  let lastModel: Model | null = null;

  const allBtn = h("button", { class: "seg", type: "button", "aria-pressed": "true" }, "All");
  const unexpectedCount = h("span", { class: "seg-count" });
  const unexBtn = h(
    "button",
    { class: "seg", type: "button", "aria-pressed": "false" },
    icon("triangle-alert", 14),
    "Unexpected",
    unexpectedCount,
  );
  const setFilter = (f: Filter): void => {
    filter = f;
    setAttr(allBtn, "aria-pressed", f === "all" ? "true" : "false");
    setAttr(unexBtn, "aria-pressed", f === "unexpected" ? "true" : "false");
    if (lastModel) render(lastModel);
  };
  allBtn.addEventListener("click", () => setFilter("all"));
  unexBtn.addEventListener("click", () => setFilter("unexpected"));
  const toolbar = h("div", { class: "seg-group", role: "group", "aria-label": "Filter test cases" }, allBtn, unexBtn);

  const list = h("div", { class: "groups" });
  const empty = emptyState("tests", "No tests planned yet", "ALT plans edge cases for every form it finds, then runs them here.");
  const noUnexpected = h("p", { class: "t-footnote muted filter-empty" }, "Nothing unexpected so far.");
  const el = h("div", { class: "tab-content" }, empty, toolbar, noUnexpected, list);

  function render(m: Model): void {
    lastModel = m;
    const all = buildGroups(m);
    const total = all.reduce((n, g) => n + g.rows.length, 0);
    const unexpected = all.reduce((n, g) => n + g.rows.filter((r) => r.status === "unexpected").length, 0);
    setText(unexpectedCount, String(unexpected));
    show(empty, total === 0);
    show(toolbar, total > 0);
    const groups =
      filter === "unexpected"
        ? all.map((g) => ({ ...g, rows: g.rows.filter((r) => r.status === "unexpected") })).filter((g) => g.rows.length > 0)
        : all;
    show(noUnexpected, total > 0 && filter === "unexpected" && groups.length === 0);

    reconcile(list, groups, {
      key: (g) => g.formId,
      create: (g) => {
        const summaryText = h("span", { class: "row-main" });
        const d = h(
          "details",
          { class: "group form-group", open: true },
          h("summary", { class: "row-summary" }, h("span", { class: "row-icon" }, icon("text-cursor", 18)), summaryText, chevron()),
          h("ol", { class: "cases" }),
        );
        fillGroup(d, g);
        return d;
      },
      update: fillGroup,
    });
  }

  function fillGroup(d: HTMLElement, g: Group): void {
    const main = d.querySelector(":scope > summary > .row-main");
    const run = g.rows.filter((r) => r.exec).length;
    const unex = g.rows.filter((r) => r.status === "unexpected").length;
    const meta = [g.form?.routeKey, `${run}/${g.rows.length} run`, unex ? `${unex} unexpected` : null].filter(Boolean).join(" · ");
    if (main) {
      const title = main.firstElementChild ?? main.appendChild(h("span", { class: "row-title" }));
      const sub = main.children[1] ?? main.appendChild(h("span", { class: "row-sub" }));
      setText(title, g.form?.name || "Untitled form");
      setText(sub, meta);
    }
    const ol = d.querySelector<HTMLElement>(":scope > ol");
    if (!ol) return;
    reconcile(ol, g.rows, {
      key: (r) => r.c.id,
      sig: rowSig,
      create: (r) => createRow(r, g.form),
      update: (li, r) => fillRow(li, r, g.form),
    });
  }

  return { el, render };
}
