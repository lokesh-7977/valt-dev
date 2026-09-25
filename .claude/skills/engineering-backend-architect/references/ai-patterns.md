# AI Patterns (LangChain + LangGraph + CrewAI)

Dependencies (pin in `pyproject.toml`; upgrade together). Verified 2026-09-25 with langchain 1.4.2,
langchain-core 1.6.5, langgraph 1.2.12, langgraph-checkpoint-postgres 3.1.2, crewai 1.15.22:

```
langchain            # init_chat_model
langchain-core
langchain-<provider> # e.g. langchain-openai / langchain-anthropic
langgraph
langgraph-checkpoint-postgres  # production checkpointer
crewai
```

## 1. Model factory — one source of truth for both stacks

```python
# valt_api/ai/llm.py
from crewai import LLM
from langchain.chat_models import init_chat_model
from langchain_core.language_models import BaseChatModel

from valt_api.config import Settings, get_settings


class LLMNotConfiguredError(RuntimeError):
    pass


def _require(settings: Settings) -> tuple[str, str, str]:
    if not (settings.llm_provider and settings.llm_model and settings.llm_api_key):
        raise LLMNotConfiguredError("set API_LLM_PROVIDER, API_LLM_MODEL and API_LLM_API_KEY")
    return settings.llm_provider, settings.llm_model, settings.llm_api_key.get_secret_value()


def get_chat_model(*, temperature: float | None = None) -> BaseChatModel:
    """LangChain chat model for graphs, chains, and structured output."""
    s = get_settings()
    provider, model, key = _require(s)
    return init_chat_model(
        model,
        model_provider=provider,
        api_key=key,
        temperature=s.llm_temperature if temperature is None else temperature,
        max_tokens=s.llm_max_tokens,
        timeout=s.llm_timeout_s,
        max_retries=2,
    )


def get_crew_llm(*, temperature: float | None = None) -> LLM:
    """CrewAI LLM (LiteLLM under the hood) pointed at the same provider/model."""
    s = get_settings()
    provider, model, key = _require(s)
    return LLM(
        model=f"{provider}/{model}",  # LiteLLM naming; matches for openai/anthropic, check others
        api_key=key,
        temperature=s.llm_temperature if temperature is None else temperature,
        max_tokens=s.llm_max_tokens,
        timeout=s.llm_timeout_s,
    )
```

## 2. Structured output — no graph needed

```python
from pydantic import BaseModel, Field


class Triage(BaseModel):
    category: str = Field(description="one of: billing, bug, feature, other")
    urgent: bool


async def triage(text: str) -> Triage:
    model = get_chat_model(temperature=0).with_structured_output(Triage)
    result = await model.ainvoke(
        [("system", "Classify the support message."), ("human", text)]
    )
    assert isinstance(result, Triage)
    return result
```

## 3. Tools — shared logic, two thin wrappers

```python
# valt_api/ai/tools/docs.py
from crewai.tools import tool as crew_tool
from langchain_core.tools import tool


async def _search_docs(query: str, limit: int = 5) -> list[dict[str, str]]:
    ...  # the real implementation, read-only


@tool
async def search_docs(query: str) -> list[dict[str, str]]:
    """Search VALT's knowledge base. Returns title, url and snippet for each hit."""
    return await _search_docs(query)


@crew_tool("Search docs")
def search_docs_crew(query: str) -> str:
    """Search VALT's knowledge base and return matching snippets."""
    import asyncio

    return str(asyncio.run(_search_docs(query)))  # CrewAI tools run in a worker thread
```

The docstring is the tool description the model sees — make it say when to use the tool and what
comes back.

## 4. LangGraph graph with tools, checkpointer, and an approval interrupt

```python
# valt_api/ai/graphs/chat.py
from typing import Annotated, Any, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AnyMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from valt_api.ai.llm import get_chat_model
from valt_api.ai.tools.docs import search_docs

TOOLS = [search_docs]


class ChatState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]


def build_graph(
    checkpointer: BaseCheckpointSaver[Any], *, model: BaseChatModel | None = None
) -> CompiledStateGraph:
    llm = (model or get_chat_model()).bind_tools(TOOLS)

    async def agent(state: ChatState) -> dict[str, Any]:
        return {"messages": [await llm.ainvoke(state["messages"])]}

    g = StateGraph(ChatState)
    g.add_node("agent", agent)
    g.add_node("tools", ToolNode(TOOLS))
    g.add_edge(START, "agent")
    g.add_conditional_edges("agent", tools_condition)  # → "tools" or END
    g.add_edge("tools", "agent")
    return g.compile(checkpointer=checkpointer)
```

### Human approval before a side effect

```python
from langgraph.types import interrupt


async def send_report(state: ReportState) -> dict[str, Any]:
    decision = interrupt({"kind": "approve_send", "draft": state["draft"]})
    if decision != "approve":
        return {"status": "cancelled"}
    await mailer.send(state["draft"])
    return {"status": "sent"}
```

Resume on the next request with `Command(resume="approve")` as the graph input and the same
`thread_id`. The node re-runs from its start, so code **before** `interrupt()` must be idempotent.

## 5. CrewAI crew as one LangGraph node

```python
# valt_api/ai/crews/research.py
from crewai import Agent, Crew, Process, Task
from pydantic import BaseModel

from valt_api.ai.llm import get_crew_llm
from valt_api.ai.tools.docs import search_docs_crew


class ResearchBrief(BaseModel):
    summary: str
    key_points: list[str]
    sources: list[str]


async def run_research_crew(topic: str) -> ResearchBrief:
    llm = get_crew_llm()
    researcher = Agent(
        role="Researcher",
        goal="Collect accurate, sourced facts about {topic}",
        backstory="Careful analyst who cites every claim.",
        tools=[search_docs_crew],
        llm=llm,
        allow_delegation=False,
    )
    writer = Agent(
        role="Writer",
        goal="Turn research into a concise brief",
        backstory="Technical writer who favours short, plain sentences.",
        llm=llm,
        allow_delegation=False,
    )
    gather = Task(
        description="Research {topic}. List facts with their source URLs.",
        expected_output="Bullet list of facts, each with a source URL.",
        agent=researcher,
    )
    brief = Task(
        description="Write a brief on {topic} from the research.",
        expected_output="Summary, key points, and sources.",
        agent=writer,
        context=[gather],
        output_pydantic=ResearchBrief,
    )
    crew = Crew(agents=[researcher, writer], tasks=[gather, brief], process=Process.sequential)
    out = await crew.kickoff_async(inputs={"topic": topic})
    if not isinstance(out.pydantic, ResearchBrief):
        raise RuntimeError("research crew returned no structured brief")
    return out.pydantic
```

```python
# in a graph module
async def research(state: ReportState) -> dict[str, Any]:
    brief = await run_research_crew(state["topic"])
    return {"research": brief.model_dump()}  # store plain data in graph state
```

## 6. SSE run endpoint

```python
# valt_api/schemas.py — mirror these in packages/shared
from pydantic import BaseModel, Field, model_validator


class RunRequest(BaseModel):
    thread_id: str = Field(min_length=1, max_length=100)
    message: str | None = Field(default=None, max_length=20_000)
    resume: str | None = None  # answer to an interrupt

    @model_validator(mode="after")
    def one_of(self) -> "RunRequest":
        if (self.message is None) == (self.resume is None):
            raise ValueError("send exactly one of message or resume")
        return self
```

```python
# valt_api/routers/chat.py
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessageChunk, BaseMessage, HumanMessage
from langgraph.types import Command

from valt_api.routers.threads import ChatGraphDep
from valt_api.schemas import RunRequest

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)


def sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def text_of(msg: BaseMessage) -> str:
    if isinstance(msg.content, str):
        return msg.content
    return "".join(b.get("text", "") for b in msg.content if isinstance(b, dict))


async def stream_run(graph: Any, graph_input: Any, config: dict[str, Any]) -> AsyncIterator[str]:
    interrupted = False
    try:
        async for mode, chunk in graph.astream(
            graph_input, config, stream_mode=["messages", "updates"]
        ):
            if mode == "messages":
                msg, _meta = chunk
                if isinstance(msg, AIMessageChunk) and (text := text_of(msg)):
                    yield sse("token", {"text": text})
            elif "__interrupt__" in chunk:
                interrupted = True
                yield sse("interrupt", {"value": chunk["__interrupt__"][0].value})
            else:
                for node in chunk:
                    yield sse("step", {"node": node, "status": "done"})
        if not interrupted:
            state = await graph.aget_state(config)
            yield sse("done", {"message": text_of(state.values["messages"][-1])})
    except Exception:
        logger.exception("run failed", extra={"thread_id": config["configurable"]["thread_id"]})
        yield sse("error", {"message": "The run failed. Please try again."})


@router.post("/runs")
async def create_run(body: RunRequest, graph: ChatGraphDep) -> StreamingResponse:
    config = {"configurable": {"thread_id": body.thread_id}, "recursion_limit": 25}
    graph_input: Any = (
        Command(resume=body.resume)
        if body.resume is not None
        else {"messages": [HumanMessage(body.message or "")]}
    )
    return StreamingResponse(
        stream_run(graph, graph_input, config),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

## 7. Testing graphs without real LLM calls

```python
# tests/fakes.py
import json
from collections.abc import Iterator
from typing import Any

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGenerationChunk


class FakeToolModel(GenericFakeChatModel):
    """GenericFakeChatModel that supports bind_tools and streams tool calls.

    The stock fake drops tool_calls when streaming a message with empty content, which breaks
    graphs run via astream(stream_mode="messages") such as the SSE endpoint.
    """

    def bind_tools(self, tools: Any, **kwargs: Any) -> "FakeToolModel":  # type: ignore[override]
        return self

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        msg = self._generate(messages, stop=stop, **kwargs).generations[0].message
        chunk = AIMessageChunk(
            content=msg.content,
            id=msg.id,
            tool_call_chunks=[
                {"name": tc["name"], "args": json.dumps(tc["args"]), "id": tc["id"], "index": i}
                for i, tc in enumerate(getattr(msg, "tool_calls", []) or [])
            ],
        )
        yield ChatGenerationChunk(message=chunk)


def fake_model(*replies: str | AIMessage) -> FakeToolModel:
    msgs = [r if isinstance(r, AIMessage) else AIMessage(content=r) for r in replies]
    return FakeToolModel(messages=iter(msgs))
```

```python
# tests/test_chat_graph.py
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver

from valt_api.ai.graphs.chat import build_graph
from tests.fakes import fake_model


async def test_tool_call_then_answer() -> None:
    model = fake_model(
        AIMessage(content="", tool_calls=[{"name": "search_docs", "args": {"query": "x"}, "id": "1"}]),
        "final answer",
    )
    graph = build_graph(InMemorySaver(), model=model)
    config = {"configurable": {"thread_id": "t1"}}
    out = await graph.ainvoke({"messages": [HumanMessage("hi")]}, config)
    assert out["messages"][-1].content == "final answer"
    assert any(m.type == "tool" for m in out["messages"])
```

Patch `_search_docs` in tests (e.g. `monkeypatch`) so tools don't hit real stores.
