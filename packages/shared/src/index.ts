/**
 * Types shared between the Next.js app and the FastAPI service.
 * Keep these in sync with apps/api/src/valt_api/schemas.py and core/responses.py.
 */

// ---- Envelope (docs/api/conventions.md) ----

export interface PageMeta {
  limit: number;
  next_cursor: string | null;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: PageMeta | null;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details: Array<Record<string, unknown>> | null;
    request_id: string | null;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

// ---- Health ----

export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
  ai: "configured" | "not_configured";
}

export interface ReadinessResponse {
  status: "ready";
  database: "ok";
}

// ---- Items ----

export interface ItemCreate {
  name: string;
  description?: string | null;
}

export interface ItemUpdate {
  name?: string | null;
  description?: string | null;
}

export interface Item {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Files ----

export interface UploadedFile {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

// ---- AI ----

export interface Usage {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
}

/** Any mix of text and uploaded file ids (from POST /upload). */
export interface AIInput {
  text?: string | null;
  file_ids?: string[];
}

export interface AnalyzeRequest extends AIInput {
  instructions?: string | null;
  /** JSON Schema for `result`. Omit to get AnalysisResult. */
  output_schema?: Record<string, unknown> | null;
}

export interface AnalysisResult {
  summary: string;
  key_points: string[];
  entities: Array<{ name: string; type: string }>;
  sentiment: "positive" | "neutral" | "negative" | "mixed" | null;
  recommended_actions: string[];
  confidence: number;
}

export interface AnalyzeResponse<T = AnalysisResult> {
  result: T;
  model: string;
  usage: Usage | null;
}

/** Exactly one of `prompt` or `template`. */
export interface GenerateRequest extends AIInput {
  prompt?: string | null;
  template?: string | null;
  variables?: Record<string, string>;
  system?: string | null;
  temperature?: number | null;
  max_output_tokens?: number | null;
}

export interface GenerateResponse {
  text: string;
  model: string;
  usage: Usage | null;
}

export interface ProcessRequest extends AIInput {
  task: string;
  variables?: Record<string, string>;
}

export interface ProcessResponse<T = Record<string, unknown> | string> {
  task: string;
  output: T;
  model: string;
  usage: Usage | null;
}

export interface TaskInfo {
  name: string;
  description: string;
  variables: string[];
  required_variables: string[];
  output_schema: Record<string, unknown> | null;
}

/** SSE events from POST /generate/stream. */
export type GenerateStreamEvent =
  | { event: "token"; data: { text: string } }
  | { event: "done"; data: { model: string } }
  | { event: "error"; data: ApiErrorBody["error"] };

export * from "./alt";
