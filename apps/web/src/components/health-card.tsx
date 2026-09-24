import { getHealth } from "@/lib/api";

export async function HealthCard() {
  let body: string;

  try {
    const health = await getHealth();
    body = `${health.status} · ${health.service} v${health.version}`;
  } catch {
    body = "unreachable — is the FastAPI service running on :8000?";
  }

  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="text-xs font-medium uppercase tracking-wide opacity-60">API health</div>
      <div className="mt-1 font-mono text-sm">{body}</div>
    </div>
  );
}
