import type { ApiErrorBody, ApiResponse, HealthResponse, PageMeta } from "@valt/shared";

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

/** Error thrown for any non-success API response. `code` is stable; `message` is user-safe. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorBody["error"]["details"] = null,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<{ data: T; meta: PageMeta | null }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });

  if (res.status === 204) return { data: undefined as T, meta: null };

  let body: ApiResponse<T> | undefined;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    // Non-JSON (proxy error page, network hiccup) — fall through to a generic error.
  }

  if (!body || !res.ok || !body.success) {
    const err = body && !body.success ? body.error : undefined;
    throw new ApiError(
      res.status,
      err?.code ?? "http_error",
      err?.message ?? `Request failed (${res.status})`,
      err?.details ?? null,
      err?.request_id ?? res.headers.get("X-Request-ID"),
    );
  }

  return { data: body.data, meta: body.meta };
}

/** Call the API and return the unwrapped `data`. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request<T>(path, init)).data;
}

/** Call a paginated endpoint and return `data` plus `meta` (next_cursor). */
export function apiFetchPage<T>(path: string, init?: RequestInit) {
  return request<T[]>(path, init);
}

export function getHealth() {
  return apiFetch<HealthResponse>("/health");
}
