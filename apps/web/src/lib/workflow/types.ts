import type { UploadedFile } from "@valt/shared";
import type { ComponentType } from "react";

export type InputMode = "text" | "file" | "image" | "audio";

/** What the user submits. Files are uploaded by the workflow engine before `run` is called. */
export interface WorkflowInput {
  text: string;
  files: File[];
}

export interface RunContext {
  text: string;
  fileIds: string[];
  files: UploadedFile[];
  signal: AbortSignal;
}

export interface WorkflowConfig<TResult> {
  id: string;
  title: string;
  description: string;
  input: {
    modes: InputMode[];
    textLabel: string;
    textPlaceholder: string;
    /** MIME types or extensions for the generic file mode, e.g. ["application/pdf", ".txt"]. */
    accept: string[];
    maxFiles: number;
    maxFileMb: number;
    submitLabel: string;
    /** One-click sample inputs for demos. */
    examples?: { label: string; text: string }[];
  };
  stages: {
    upload: string;
    analyze: string;
    /** Rotating status lines while the model works (shown every few seconds). */
    analyzeHints: string[];
    finalize: string;
  };
  /** Call the backend. Keep domain logic here (or in lib/), never in components. */
  run: (ctx: RunContext) => Promise<TResult>;
  /** Renders a successful result. */
  Result: ComponentType<{ result: TResult; input: WorkflowInput; onReset: () => void }>;
}
