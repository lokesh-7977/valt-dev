import type {
  AnalysisResult,
  AnalyzeRequest,
  AnalyzeResponse,
  ApiErrorBody,
  ApiResponse,
  GenerateRequest,
  GenerateResponse,
  GenerateStreamEvent,
  HealthResponse,
  PageMeta,
  ProcessRequest,
  ProcessResponse,
  QARunInfo,
  QARunRequest,
  QASaveHookRequest,
  QASaveHookResponse,
  QAScenario,
  QAStopResponse,
  QAStreamEvent,
  TaskInfo,
  UploadedFile,
} from "@valt/shared";

/**
 * Base URL for the FastAPI service.
 *
 * On the server we talk to it directly; in the browser we go through the
 * Next.js rewrite at /api/py so there is no cross-origin request.
 */
const baseUrl =
  typeof window === "undefined"
    ? `${process.env.API_INTERNAL_URL ?? "http://localhost:8000"}/api/v1`
    : "/api/py/v1";

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

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; meta: PageMeta | null }> {
  const res = await send(path, init);
  if (res.status === 204) return { data: undefined as T, meta: null };

  let body: ApiResponse<T> | undefined;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    // Non-JSON (proxy error page, network hiccup) — fall through to a generic error.
  }

  if (!body || !res.ok || !body.success) throw toApiError(res, body);
  return { data: body.data, meta: body.meta };
}

function send(path: string, init?: RequestInit): Promise<Response> {
  // FormData needs the browser-generated multipart boundary, so no JSON Content-Type.
  const json = !(init?.body instanceof FormData);
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    cache: "no-store",
  });
}

function toApiError(res: Response, body?: ApiResponse<unknown>): ApiError {
  const err = body && !body.success ? body.error : undefined;
  return new ApiError(
    res.status,
    err?.code ?? "http_error",
    err?.message ?? `Request failed (${res.status})`,
    err?.details ?? null,
    err?.request_id ?? res.headers.get("X-Request-ID"),
  );
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

// ---- AI ----
// Every helper takes an optional AbortSignal so the UI can offer Cancel.

export function uploadFile(
  file: File | Blob,
  opts: { filename?: string; signal?: AbortSignal } = {},
) {
  const form = new FormData();
  form.append("file", file, opts.filename ?? (file instanceof File ? file.name : "upload"));
  return apiFetch<UploadedFile>("/upload", { method: "POST", body: form, signal: opts.signal });
}

function post<T>(path: string, body: unknown, signal?: AbortSignal) {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body), signal });
}

export function analyze<T = AnalysisResult>(req: AnalyzeRequest, signal?: AbortSignal) {
  return post<AnalyzeResponse<T>>("/analyze", req, signal);
}

export function processTask<T = Record<string, unknown> | string>(
  req: ProcessRequest,
  signal?: AbortSignal,
) {
  return post<ProcessResponse<T>>("/process", req, signal);
}

export function generate(req: GenerateRequest, signal?: AbortSignal) {
  return post<GenerateResponse>("/generate", req, signal);
}

export function listTasks() {
  return apiFetch<TaskInfo[]>("/tasks");
}

/**
 * Stream POST /generate/stream. Yields parsed SSE events; pass an AbortSignal to cancel.
 * Setup errors (validation, AI not configured) throw ApiError before any event.
 */
export async function* generateStream(
  req: GenerateRequest,
  signal?: AbortSignal,
): AsyncGenerator<GenerateStreamEvent> {
  const res = await send("/generate/stream", {
    method: "POST",
    body: JSON.stringify(req),
    signal,
  });
  yield* readSse<GenerateStreamEvent>(res);
}

/** Turn a streaming Response into parsed `{event, data}` SSE events. Comment lines are skipped. */
async function* readSse<T>(res: Response): AsyncGenerator<T> {
  if (!res.ok || !res.body) {
    let body: ApiResponse<unknown> | undefined;
    try {
      body = (await res.json()) as ApiResponse<unknown>;
    } catch {
      // non-JSON error
    }
    throw toApiError(res, body);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) yield { event, data: JSON.parse(data) } as T;
    }
  }
}

// ---- Live QA agent (ADR 0016) ----

export function listQaScenarios() {
  return apiFetch<QAScenario[]>("/qa/scenarios");
}

export function startQaRun(req: QARunRequest = {}) {
  return post<QARunInfo>("/qa/runs", req);
}

export function stopQaRun() {
  return post<QAStopResponse>("/qa/runs/stop", {});
}

/** Same call the editor makes on save: cancels the current run, starts a new one after a debounce. */
export function triggerQaSave(req: QASaveHookRequest = {}) {
  return post<QASaveHookResponse>("/qa/save-hook", req);
}

/** Long-lived SSE subscription covering every QA run. Abort the signal to disconnect. */
export async function* qaEvents(signal?: AbortSignal): AsyncGenerator<QAStreamEvent> {
  const res = await send("/qa/events", { method: "GET", signal });
  yield* readSse<QAStreamEvent>(res);
}
