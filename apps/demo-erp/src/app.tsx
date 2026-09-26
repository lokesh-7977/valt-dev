import { Toast, useToast } from "./components/toast";
import { Link, usePathname } from "./router";
import { InvoiceList } from "./routes/invoice-list";
import { InvoiceNew } from "./routes/invoice-new";

export function App() {
  const path = usePathname();
  const [toastText, toast] = useToast();
  return (
    <div className="shell">
      <nav>
        <strong>demo-erp</strong>
        <Link to="/invoices/new" testId="nav-new">
          New invoice
        </Link>
        <Link to="/invoices" testId="nav-list">
          Invoices
        </Link>
      </nav>
      <main>{path === "/invoices" ? <InvoiceList /> : <InvoiceNew toast={toast} />}</main>
      <Toast text={toastText} />
    </div>
  );
}
