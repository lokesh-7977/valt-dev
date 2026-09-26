import type { DiscoveredField, DiscoveredForm } from "@valt/shared";

/** Test fixtures shaped like what content/discover.ts produces for the demo invoice form. */

export function field(p: Partial<DiscoveredField> & Pick<DiscoveredField, "key">): DiscoveredField {
  return {
    selector: `#${p.key}`,
    tag: "input",
    type: "text",
    name: p.key,
    label: p.key,
    labelSource: "label-for",
    placeholder: null,
    autocomplete: null,
    inputMode: null,
    required: false,
    readOnly: false,
    min: null,
    max: null,
    step: null,
    minLength: null,
    maxLength: null,
    pattern: null,
    options: null,
    context: null,
    semantic: "text",
    semanticSource: "heuristic",
    unique: false,
    ...p,
  };
}

export function invoiceForm(over: Partial<DiscoveredForm> = {}): DiscoveredForm {
  return {
    id: "inv00001",
    routeKey: "/invoices/new",
    pageUrl: "http://localhost:4173/invoices/new",
    selector: "#invoice-form",
    name: "invoice-form",
    fields: [
      field({
        key: "customerId",
        tag: "select",
        type: "select-one",
        label: "Customer",
        required: true,
        semantic: "select_entity",
        options: [
          { value: "", label: "Select a customer…" },
          { value: "1", label: "Acme Technologies Pvt Ltd" },
          { value: "2", label: "Globex India" },
        ],
      }),
      field({ key: "invoiceNumber", label: "Invoice number", required: true, maxLength: 20, placeholder: "INV-0001", semantic: "identifier", unique: true }),
      field({ key: "quantity", type: "number", label: "Quantity", required: true, min: "1", max: "1000", step: "1", semantic: "quantity" }),
      field({ key: "unitPrice", type: "number", label: "Unit price (₹)", required: true, min: "0", step: "0.01", semantic: "currency_amount" }),
      field({ key: "discount", type: "number", label: "Discount %", min: "0", max: "100", semantic: "percentage" }),
      field({ key: "invoiceDate", type: "date", label: "Invoice date", required: true, semantic: "date" }),
      field({ key: "dueDate", type: "date", label: "Due date", semantic: "date" }),
      field({ key: "notes", tag: "textarea", type: "textarea", label: "Notes", maxLength: 500, semantic: "description" }),
    ],
    submit: { selector: "#save-invoice", label: "Save invoice and continue" },
    method: "post",
    action: null,
    novalidate: true,
    inModal: false,
    reach: [],
    category: "create",
    purpose: "Create invoice",
    isLogin: false,
    destructive: false,
    destructiveReason: null,
    enrichment: "heuristic",
    ...over,
  };
}
