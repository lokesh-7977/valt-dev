/**
 * Types shared between the Next.js app and the FastAPI service.
 * Keep these in sync with apps/api/src/valt_api/schemas.py.
 */

export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
}

export interface Item {
  id: number;
  name: string;
  description: string | null;
}

export interface ItemCreate {
  name: string;
  description?: string | null;
}
