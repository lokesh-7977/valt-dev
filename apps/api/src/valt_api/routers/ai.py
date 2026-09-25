"""Generic AI endpoints. Domain features usually become a new task in prompts/ (then call
/process) or a new router that uses AIServiceDep directly."""

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from valt_api.core.responses import AI_ERROR_RESPONSES, ApiResponse, ok
from valt_api.core.sse import sse_response, stream_tokens
from valt_api.deps import AIServiceDep
from valt_api.prompts import get_prompt, list_prompts
from valt_api.prompts.library import ANALYZE, AnalysisResult
from valt_api.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    GenerateRequest,
    GenerateResponse,
    ProcessRequest,
    ProcessResponse,
    TaskInfo,
    Usage,
)
from valt_api.services.ai import AIService, GenerationOptions, Prepared, StructuredResult
from valt_api.services.ai import Usage as AIUsage

router = APIRouter(tags=["ai"], responses=AI_ERROR_RESPONSES)


def _usage(u: AIUsage | None) -> Usage | None:
    return Usage.model_validate(u) if u is not None else None


@router.get("/tasks", response_model=ApiResponse[list[TaskInfo]])
async def list_tasks() -> ApiResponse[list[TaskInfo]]:
    """Registered prompt templates, usable as `task` in /process or `template` in /generate."""
    return ok(
        [
            TaskInfo(
                name=t.name,
                description=t.description,
                variables=t.variables,
                required_variables=t.required_variables,
                output_schema=t.output_model.model_json_schema() if t.output_model else None,
            )
            for t in list_prompts()
        ]
    )


@router.post("/analyze", response_model=ApiResponse[AnalyzeResponse])
async def analyze(payload: AnalyzeRequest, ai: AIServiceDep) -> ApiResponse[AnalyzeResponse]:
    """Multimodal input → structured JSON. Pass `output_schema` to choose the shape."""
    prepared = await ai.prepare(
        ANALYZE,
        variables={"instructions": payload.instructions or ""},
        text=payload.text,
        file_ids=payload.file_ids,
    )
    if payload.output_schema is not None:
        res = await ai.json(prepared.parts, payload.output_schema, prepared.options)
        return ok(AnalyzeResponse(result=res.data, model=res.model, usage=_usage(res.usage)))
    out = await ai.structured(prepared.parts, AnalysisResult, prepared.options)
    return ok(
        AnalyzeResponse(
            result=out.value.model_dump(mode="json"), model=out.model, usage=_usage(out.usage)
        )
    )


async def _prepare_generate(payload: GenerateRequest, ai: AIService) -> Prepared:
    overrides = GenerationOptions(
        system=payload.system,
        temperature=payload.temperature,
        max_output_tokens=payload.max_output_tokens,
    )
    if payload.template is not None:
        return await ai.prepare(
            get_prompt(payload.template),
            variables=payload.variables,
            text=payload.text,
            file_ids=payload.file_ids,
            overrides=overrides,
        )
    parts = await ai.build_parts(
        instruction=payload.prompt, text=payload.text, file_ids=payload.file_ids
    )
    return Prepared(parts=parts, options=overrides)


@router.post("/generate", response_model=ApiResponse[GenerateResponse])
async def generate(payload: GenerateRequest, ai: AIServiceDep) -> ApiResponse[GenerateResponse]:
    """Free-form text generation from a prompt or a template."""
    prepared = await _prepare_generate(payload, ai)
    res = await ai.text(prepared.parts, prepared.options)
    return ok(GenerateResponse(text=res.text, model=res.model, usage=_usage(res.usage)))


@router.post(
    "/generate/stream",
    response_class=StreamingResponse,
    responses={
        200: {"content": {"text/event-stream": {}}, "description": "SSE: token*, done|error"}
    },
)
async def generate_stream(
    payload: GenerateRequest, ai: AIServiceDep, request: Request
) -> StreamingResponse:
    """Same body as /generate, streamed as SSE. Validation/config errors still return the JSON
    envelope; failures mid-stream arrive as an `error` event."""
    prepared = await _prepare_generate(payload, ai)
    model = prepared.options.model or ai.default_model
    return sse_response(
        stream_tokens(
            ai.stream(prepared.parts, prepared.options),
            done={"model": model},
            request_id=getattr(request.state, "request_id", None),
        )
    )


@router.post("/process", response_model=ApiResponse[ProcessResponse])
async def process(payload: ProcessRequest, ai: AIServiceDep) -> ApiResponse[ProcessResponse]:
    """Run a registered task (see GET /tasks) on text and/or files."""
    prepared = await ai.prepare(
        get_prompt(payload.task),
        variables=payload.variables,
        text=payload.text,
        file_ids=payload.file_ids,
    )
    res = await ai.run(prepared)
    output = res.value.model_dump(mode="json") if isinstance(res, StructuredResult) else res.text
    return ok(
        ProcessResponse(task=payload.task, output=output, model=res.model, usage=_usage(res.usage))
    )
