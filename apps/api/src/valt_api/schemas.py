from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Keep in sync with packages/shared/src/index.ts.
# Every response is wrapped in the envelope from valt_api.core.responses.


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str
    ai: Literal["configured", "not_configured"]


class ReadinessResponse(BaseModel):
    status: Literal["ready"] = "ready"
    database: Literal["ok"] = "ok"


def _strip(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("must not be blank")
    return v


class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)

    _name = field_validator("name")(_strip)


class ItemUpdate(BaseModel):
    """Partial update. Omitted fields are unchanged."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return None if v is None else _strip(v)


class Item(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime


# ---- Files ----


class UploadedFile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str = Field(description="Pass in file_ids to the AI endpoints.")
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime


# ---- AI ----

MAX_TEXT_CHARS = 100_000
MAX_FILES = 10


class Usage(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None


class AIInput(BaseModel):
    """Shared input shape: any mix of text and uploaded files."""

    text: str | None = Field(default=None, max_length=MAX_TEXT_CHARS)
    file_ids: list[str] = Field(
        default_factory=list,
        max_length=MAX_FILES,
        description="Ids from POST /api/v1/upload (images, audio, PDFs, ...).",
    )

    def has_input(self) -> bool:
        return bool((self.text and self.text.strip()) or self.file_ids)


class AnalyzeRequest(AIInput):
    instructions: str | None = Field(
        default=None, max_length=5000, description="Extra guidance, e.g. 'focus on risks'."
    )
    output_schema: dict[str, Any] | None = Field(
        default=None,
        description="JSON Schema for the result. Omit to get the default AnalysisResult shape.",
    )

    @model_validator(mode="after")
    def _needs_input(self) -> "AnalyzeRequest":
        if not self.has_input():
            raise ValueError("provide text or file_ids")
        return self


class AnalyzeResponse(BaseModel):
    result: dict[str, Any] | list[Any]
    model: str
    usage: Usage | None = None


class GenerateRequest(AIInput):
    """Either a raw `prompt` or a registered `template` (+ `variables`)."""

    prompt: str | None = Field(default=None, max_length=MAX_TEXT_CHARS)
    template: str | None = Field(default=None, max_length=100)
    variables: dict[str, str] = Field(default_factory=dict)
    system: str | None = Field(default=None, max_length=10_000)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_output_tokens: int | None = Field(default=None, ge=1, le=65_536)

    @model_validator(mode="after")
    def _prompt_xor_template(self) -> "GenerateRequest":
        if (self.prompt is None) == (self.template is None):
            raise ValueError("provide exactly one of prompt or template")
        if self.prompt is not None and not self.prompt.strip():
            raise ValueError("prompt must not be blank")
        return self


class GenerateResponse(BaseModel):
    text: str
    model: str
    usage: Usage | None = None


class ProcessRequest(AIInput):
    task: str = Field(max_length=100, description="A task name from GET /api/v1/tasks.")
    variables: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _needs_input(self) -> "ProcessRequest":
        if not self.has_input():
            raise ValueError("provide text or file_ids")
        return self


class ProcessResponse(BaseModel):
    task: str
    output: dict[str, Any] | str = Field(
        description="Object for tasks with an output schema, string otherwise."
    )
    model: str
    usage: Usage | None = None


class TaskInfo(BaseModel):
    name: str
    description: str
    variables: list[str]
    required_variables: list[str]
    output_schema: dict[str, Any] | None


# ---- Live QA agent (ADR 0015) ----

QARunStatus = Literal[
    "running",
    "passed",
    "bug_found",
    "inconclusive",
    "stopped",
    "needs_confirmation",
    "blocked",
    "error",
]
QATrigger = Literal["manual", "save"]
QAVerdict = Literal["bug", "pass", "inconclusive"]


class QAScenario(BaseModel):
    id: str
    title: str
    goal: str
    start_url: str


class QARunRequest(BaseModel):
    scenario_id: str = Field(default="signup_empty_password", max_length=100)


class QASaveHookRequest(BaseModel):
    """Sent by the editor (or sample_app/watch.py) on every save."""

    path: str | None = Field(default=None, max_length=500)
    scenario_id: str | None = Field(default=None, max_length=100)


class QASaveHookResponse(BaseModel):
    scheduled: bool
    debounce_ms: int


class QAStopResponse(BaseModel):
    stopped: bool
    run_id: str | None


class QARunInfo(BaseModel):
    run_id: str
    scenario_id: str
    trigger: QATrigger
    status: QARunStatus
    started_at: datetime


# SSE payloads for GET /qa/events (event names: step, interrupt, done, error).


class QAStepEvent(BaseModel):
    run_id: str
    index: int
    kind: Literal["run_started", "action", "blocked"]
    action: str | None = None
    intent: str | None = None
    args: dict[str, Any] | None = None
    url: str | None = None
    screenshot_png_b64: str | None = None
    note: str | None = None
    run: QARunInfo | None = Field(default=None, description="Set only when kind is run_started.")


class QAInterruptEvent(BaseModel):
    run_id: str
    reason: Literal["safety_confirmation"] = "safety_confirmation"
    explanation: str


class QADoneEvent(BaseModel):
    run: QARunInfo
    verdict: QAVerdict
    summary: str
    findings: list[str]
    steps: int
    duration_ms: int
    usage: Usage | None = None
