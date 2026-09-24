import type { HealthResponse } from "@valt/shared";

/**
 * Base URL for the FastAPI service.
 *
 * On the server we talk to it directly; in the browser we go through the
 * Next.js rewrite at /api/py so there is no cross-origin request.
 */
const baseUrl =
  typeof window === "undefined"
    ? `${process.env.API_INTERNAL_URL ?? "http://localhost:8000"}/api`
    : "/api/py";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

export function getHealth() {
  return apiFetch<HealthResponse>("/health");
}
