import { getHealth } from "@/lib/api";

export async function HealthCard() {
  let ok = false;
  let body: string;

  try {
    const health = await getHealth();
    ok = health.status === "ok";
    body = `${health.service} v${health.version}`;
  } catch {
    body = "Unreachable. Is the FastAPI service running on :8000?";
  }

  return (
    <div className="rounded-2xl bg-card p-6 text-card-foreground shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-callout font-semibold">API health</span>
        <span className="inline-flex items-center gap-1.5 text-footnote text-muted-foreground">
          <span
            aria-hidden
            className={`size-2 rounded-full ${ok ? "bg-success" : "bg-destructive"}`}
          />
          {ok ? "Operational" : "Offline"}
        </span>
      </div>
      <p className="mt-2 font-mono text-footnote text-muted-foreground">{body}</p>
    </div>
  );
}
