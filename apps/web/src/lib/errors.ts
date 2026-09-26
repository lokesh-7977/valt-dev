import { ApiError } from "@/lib/api";

export interface UserFacingError {
  title: string;
  description: string;
  /** Whether "Try again" makes sense without changing the input. */
  retryable: boolean;
  requestId: string | null;
}

// Keyed by the backend's stable error codes (docs/api/conventions.md). Adjust copy here, not in UI.
const BY_CODE: Record<string, Omit<UserFacingError, "requestId">> = {
  ai_unavailable: {
    title: "AI is offline",
    description: "The AI service isn't configured right now. Try again in a moment.",
    retryable: true,
  },
  qa_unavailable: {
    title: "QA browser not installed",
    description: "Install the API's qa extra and run `python -m playwright install chromium`.",
    retryable: false,
  },
  ai_rate_limited: {
    title: "Busy right now",
    description: "We hit a usage limit. Wait a few seconds and try again.",
    retryable: true,
  },
  ai_timeout: {
    title: "That took too long",
    description: "The analysis timed out. Try again, or use a smaller file.",
    retryable: true,
  },
  ai_upstream_error: {
    title: "Something went wrong on our side",
    description: "The AI provider had a hiccup. Try again.",
    retryable: true,
  },
  ai_invalid_output: {
    title: "Couldn't read the result",
    description: "The AI returned something unexpected. Try again.",
    retryable: true,
  },
  ai_blocked: {
    title: "Can't analyze this input",
    description: "The content was flagged by safety filters. Try different input.",
    retryable: false,
  },
  ai_bad_request: {
    title: "Can't process this input",
    description: "The file may be corrupted or in an unsupported format.",
    retryable: false,
  },
  payload_too_large: {
    title: "File too large",
    description: "Use a smaller file and try again.",
    retryable: false,
  },
  unsupported_media_type: {
    title: "Unsupported file type",
    description: "Use an image, audio file, PDF, or text document.",
    retryable: false,
  },
  validation_error: {
    title: "Check your input",
    description: "Some of the input isn't valid.",
    retryable: false,
  },
};

const UNREACHABLE: Omit<UserFacingError, "requestId"> = {
  title: "Can't reach the server",
  description: "Check your connection and try again.",
  retryable: true,
};

export function toUserError(error: unknown): UserFacingError {
  // No API envelope (proxy error page, backend down) → treat as unreachable.
  if (error instanceof ApiError && error.code === "http_error" && error.status >= 500) {
    return { ...UNREACHABLE, requestId: error.requestId };
  }
  if (error instanceof ApiError) {
    const known = BY_CODE[error.code];
    return {
      ...(known ?? {
        title: "Something went wrong",
        description: error.message,
        retryable: error.status >= 500 || error.status === 429,
      }),
      requestId: error.requestId,
    };
  }
  return { ...UNREACHABLE, requestId: null };
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
