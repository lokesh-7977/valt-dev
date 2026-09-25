# Frontend playbook (hackathon)

This is a product shell for any multimodal AI workflow: Input (text, file, image, voice) →
Processing → Results → Recommended action. When the problem statement lands, change the config,
the copy, and the result view. The engine and the components stay as they are. Backend side:
[docs/api/ai-backend.md](../api/ai-backend.md). Visual rules:
[design-system/valt/MASTER.md](../../design-system/valt/MASTER.md).

```bash
pnpm --filter @valt/web dev     # http://localhost:3000 (the API must be on :8000)
```

Open `/kit` in dev to see every component live, then copy from `src/app/kit/kit-gallery.tsx`.

## Layout

```
apps/web/src/
  config/
    site.ts              name, tagline, nav, home-page copy   ← edit first
    workflows.tsx        workflow = copy + limits + run() + Result view   ← edit second
  app/                   routes: / (home), /analyze, /dashboard, /kit (dev only)
  components/
    ui/                  shadcn primitives, tuned to MASTER (44px controls, 12px radius)
    layout/              SiteHeader (desktop nav + mobile sheet), PageContainer, PageHeader, Section
    feedback/            EmptyState, ErrorState, LoadingState, skeletons
    inputs/              FileDropzone, FilePreviewList, ImageUpload (+ camera), AudioRecorder (→ WAV)
    workflow/            AiWorkflow (orchestrator), MultimodalInput (RHF + Zod), WorkflowProgress
    ai/                  ProcessingScreen, result blocks, JsonView, StreamingText
    results/             AnalysisResultView (the result screen for the generic /analyze)
    dashboard/           StatCard/StatGrid, ListGroup (inset list), StatusBadge
  lib/
    api.ts               the only way to call FastAPI (envelope, ApiError, abort signals, SSE)
    errors.ts            backend error code → user-facing title/description/retryable
    queries/ai.ts        TanStack Query keys, queryOptions, and mutation hooks
    workflow/            useAiWorkflow engine, Zod input schema, WorkflowConfig types
  hooks/                 useAudioRecorder, useGenerateStream
```

Data flow: component → `lib/api.ts` → `/api/py/v1/*` (Next rewrite) → FastAPI. Components never
call `fetch` directly and contain no domain logic.

## Adapting it on the day

**1. Rebrand (5 min).** In `config/site.ts`, set the name, tagline, description, nav, and home
copy.

**2. Change the workflow (15 min).** In `config/workflows.tsx`:

```tsx
export const triageWorkflow: WorkflowConfig<ProcessResponse<Triage>> = {
  id: "triage",
  title: "Triage an incident",
  description: "…",
  input: { modes: ["text", "image", "audio"], textLabel: "What happened?", /* limits, examples */ },
  stages: { upload: "Uploading evidence", analyze: "Assessing severity", analyzeHints: [...], finalize: "…" },
  run: ({ text, fileIds, signal }) =>
    processTask<Triage>({ task: "triage", text, file_ids: fileIds }, signal),
  Result: TriageResult,
};
```

- `modes` sets which input tabs show. Drop the ones the problem doesn't need.
- `run` is the only place that knows about the backend. It can chain calls, for example
  `/process` and then `/generate`.
- Until a custom view exists, set `Result: ({ result }) => <JsonView value={result.output} />`.

**3. Result screen (30 to 60 min).** Copy `components/results/analysis-result.tsx`. Compose it from
`RecommendedActions`, `KeyPoints`, `ConfidenceMeter`, `FactList`, `TagList`, `StatCard`, and
`JsonView`. Put the recommended action near the top, because it's the payoff of the demo.

**4. New page.** Create `app/<route>/page.tsx` (server component, with `PageContainer` and
`PageHeader`) plus a small `"use client"` wrapper that renders `<AiWorkflow config={…} />`. You need
the wrapper because configs hold functions, which can't cross the server/client boundary. Then add
the route to `siteConfig.nav`.

**5. New backend fields.** Change `schemas.py` and `packages/shared/src/index.ts` together.

## Built-in behaviours

- **Validation:** a Zod schema is built from the workflow limits: at least one input, file size,
  file count, text length. Errors show inline under the field.
- **Processing:** the real stages are upload (with an "n of m" count) and analyze. The screen also
  shows an elapsed timer, rotating hints, and a Cancel button that aborts the request. Retry skips
  files that already uploaded.
- **Errors:** every backend `code` maps to friendly copy in `lib/errors.ts`, with Try again only
  when retrying helps. A backend that's down shows "Can't reach the server". Every error card shows
  the request id.
- **Audio:** recordings are converted in the browser to 16 kHz mono WAV, the format Gemini reads
  most reliably. This works in Chrome and Safari.
- **Toasts:** `import { toast } from "sonner"` and call `toast.success(...)` or
  `toast.error(...)`. The toaster is already mounted.
- **Streaming:** the `useGenerateStream()` hook returns `{ text, status, start, stop }`. Render
  `text` with `<StreamingText text={text} streaming={...} />`.
- **Dark mode** follows the OS, and every component uses tokens only. Layouts are verified at 320,
  375, and 1280px wide with no horizontal scroll.

## Rules that keep it fast

- Don't use raw hex colours or `text-sm`-style sizes. Use tokens and type roles (`text-callout`,
  `text-muted-foreground`).
- Don't call `fetch` in components. Add a function to `lib/api.ts`.
- Don't auto-retry AI calls (`mutations.retry` is `false` by default), because each retry is a
  billed call.
- Render model output as text, or use `JsonView` for structured output. Never pass model output to
  `dangerouslySetInnerHTML`.
