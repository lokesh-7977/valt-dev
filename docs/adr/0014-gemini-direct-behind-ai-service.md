# 0014. Call Gemini directly through the google-genai SDK, behind an AIService layer

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team (hackathon backend + AI)

## Context

The team is entering a Google DeepMind hackathon. The problem statement arrives on the day, and
the model is Gemini. The backend needs text, image, audio and PDF input, structured JSON output,
and streaming, and it has to adapt to an unknown problem in a few hours. ADR 0004 picked LangChain
as the LLM layer. Gemini-native features (inline multimodal parts, `response_json_schema`, and
new models on the day they ship) come to the `google-genai` SDK first. Going through LangChain
means one more abstraction to debug at 3 a.m.

## Decision

We will call Gemini through `google-genai` (async client), and only from
`services/gemini/client.py`. Everything else depends on the provider-neutral `ModelClient`
protocol and `AIService` in `services/ai/`. Prompts are registered `PromptTemplate`s
(`prompts/`) with an optional Pydantic output model. Generic endpoints `/analyze`, `/generate`,
`/generate/stream`, `/process` and `/upload` sit under `/api/v1`.

LangChain, LangGraph and CrewAI (ADR 0004–0006) stay in the optional `ai` extra. Use them when a
feature needs graphs, retrieval or multi-agent crews. A LangGraph node can call `AIService`.

## Alternatives considered

- **LangChain `ChatGoogleGenerativeAI`**: it adds a layer between us and Gemini's multimodal and
  schema features, it lags new SDK releases, and it brings heavier dependencies into the image.
- **Vertex AI SDK**: needs GCP project IAM setup. An AI Studio API key is faster on the day.
  `google-genai` also supports Vertex (`vertexai=True`) if we need to switch.
- **Raw REST**: we would have to rebuild retries, streaming and typing ourselves.

## Consequences

### Positive

- Gemini features are available as soon as the SDK ships them. There is one file to read when
  something breaks.
- Tests use a fake `ModelClient`, so CI never calls Gemini or needs a key.
- Every SDK or network failure becomes a stable error code (`ai_unavailable`, `ai_rate_limited`,
  `ai_timeout`, `ai_blocked`, `ai_bad_request`, `ai_invalid_output`, `ai_upstream_error`).

### Negative / risks

- Uploads go inline and are capped at `API_MAX_UPLOAD_MB` (default 20 MB). Larger media needs the
  Gemini Files API.
- Uploads are stored on local disk, which is per instance and ephemeral on Cloud Run. For the demo,
  deploy with `--max-instances=1` or add a GCS `FileStorage`.
- Users can inject instructions into the prompt. User text is wrapped in `<user_input>` tags and
  the system prompt tells the model to treat it as data. That lowers the risk but does not remove
  it. No tools run with user-controlled arguments.

### Follow-ups

- A GCS `FileStorage` if files must survive restarts.
- Files API upload for media over 20 MB.
- Evals (`/ai-eval`) for the domain tasks once the problem is known.
