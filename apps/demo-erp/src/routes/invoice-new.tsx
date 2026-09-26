import { useState, type FormEvent } from "react";
import type { ToastApi } from "../components/toast";
import { createInvoice } from "../lib/api";

type Form = {
  customer: string;
  email: string;
  quantity: string;
  unit_price: string;
  discount: string;
  due_date: string;
  notes: string;
  card_number: string;
};

const initial: Form = {
  customer: "Acme Corp",
  email: "billing@acme.test",
  quantity: "3",
  unit_price: "100.00",
  discount: "10",
  due_date: "2026-10-30",
  notes: "",
  card_number: "4111111111111111",
};

function computeTotal(f: Form): number {
  const gross = Number(f.quantity) * Number(f.unit_price);
  return Math.round(gross * (1 - Number(f.discount) / 100) * 100) / 100;
}

// PLANTED BUGS (fixtures/bugs.json): demo-01 discount dropped, demo-02 quantity sent as a
// string, demo-03 unit_price rounded.
function buildPayload(f: Form): Record<string, unknown> {
  return {
    customer: f.customer,
    email: f.email,
    quantity: f.quantity,
    unit_price: Math.round(Number(f.unit_price)),
    due_date: f.due_date,
    notes: f.notes,
    card_number: f.card_number,
  };
}

const fields: Array<{ key: keyof Form; label: string; type: string }> = [
  { key: "customer", label: "Customer", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "quantity", label: "Quantity", type: "number" },
  { key: "unit_price", label: "Unit price", type: "number" },
  { key: "discount", label: "Discount %", type: "number" },
  { key: "due_date", label: "Due date", type: "date" },
  { key: "card_number", label: "Card number", type: "text" },
];

export function InvoiceNew({ toast }: { toast: ToastApi }) {
  const [form, setForm] = useState<Form>(initial);
  const [total, setTotal] = useState<number>(computeTotal(initial));
  const [error, setError] = useState<string | null>(null);

  const update = (key: keyof Form, value: string) => {
    const next = { ...form, [key]: value };
    setForm(next);
    setTotal(computeTotal(next));
  };

  // PLANTED BUG demo-07: the response total is never read back into `total`.
  // PLANTED BUG demo-05: the SPA Save path (`checkStatus: false`) ignores the response status.
  const save = async (checkStatus: boolean) => {
    setError(null);
    const { status, data } = await createInvoice(buildPayload(form));
    if (checkStatus && status >= 400) {
      setError(typeof data === "object" && data && "error" in data ? String(data.error) : "Failed");
      toast.show("Could not save invoice");
      return;
    }
    toast.show("Saved invoice");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save(true);
  };

  return (
    <section>
      <h1>New invoice</h1>
      <form data-testid="invoice-form" onSubmit={onSubmit} noValidate>
        {fields.map((f) => (
          <label key={f.key} htmlFor={f.key}>
            <span>{f.label}</span>
            <input
              id={f.key}
              name={f.key}
              data-testid={f.key}
              type={f.type}
              value={form[f.key]}
              onChange={(e) => update(f.key, e.target.value)}
              aria-invalid={error && f.key === "due_date" ? true : undefined}
              aria-describedby={error && f.key === "due_date" ? "due_date-error" : undefined}
            />
          </label>
        ))}
        {error && (
          <p id="due_date-error" className="field-error" data-testid="due_date-error">
            {error}
          </p>
        )}
        <label htmlFor="notes">
          <span>Notes</span>
          <textarea
            id="notes"
            name="notes"
            data-testid="notes"
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
          />
        </label>
        <p className="total-row">
          <span>Total</span>{" "}
          <output data-testid="total" htmlFor="quantity unit_price discount">
            {total.toFixed(2)}
          </output>
        </p>
        <div className="actions">
          <button type="submit" data-testid="submit">
            Submit
          </button>
          <button type="button" data-testid="save" onClick={() => void save(false)}>
            Save
          </button>
        </div>
      </form>
    </section>
  );
}
