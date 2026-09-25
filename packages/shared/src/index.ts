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
