import { useEffect, useState } from "react";
import { listInvoices, type Invoice } from "../lib/api";

export function InvoiceList() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    void listInvoices().then((r) => {
      setInvoices(r.invoices);
      setTotal(r.total);
    });
  }, []);

  return (
    <section>
      <h1>Invoices</h1>
      <table data-testid="invoice-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id}>
              <td>{i.customer}</td>
              <td>{i.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <span>Grand total</span> <strong data-testid="list-total">{total.toFixed(2)}</strong>
      </p>
    </section>
  );
}
