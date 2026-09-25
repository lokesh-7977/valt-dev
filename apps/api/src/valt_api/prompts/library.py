"""Generic, problem-agnostic tasks. Add domain tasks in a new module (e.g. prompts/domain.py)
and import it from prompts/__init__.py."""

from typing import Literal

from pydantic import BaseModel, Field

from valt_api.prompts.base import PromptTemplate, register

_ASSISTANT = "You are a precise assistant. Be factual and concise. If unsure, say so."


# ---- Output models (become Gemini response schemas; field descriptions guide the model) ----


class Entity(BaseModel):
    name: str
    type: str = Field(description="person, organization, place, date, amount, product, other")


class AnalysisResult(BaseModel):
    summary: str = Field(description="2-4 sentence summary of the input")
    key_points: list[str] = Field(description="Most important findings, max 7")
    entities: list[Entity] = Field(default_factory=list)
    sentiment: Literal["positive", "neutral", "negative", "mixed"] | None = None
    recommended_actions: list[str] = Field(
        default_factory=list, description="Concrete next steps for the user, most important first"
    )
    confidence: float = Field(ge=0, le=1, description="How confident you are in this analysis")


class ExtractedField(BaseModel):
    name: str
    value: str | None = Field(description="null when the input does not contain it")
    confidence: float = Field(ge=0, le=1)


class Extraction(BaseModel):
    fields: list[ExtractedField]


class Classification(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)
    reasoning: str = Field(description="One sentence")


class Transcript(BaseModel):
    language: str = Field(description="BCP-47 code, e.g. en, hi")
    text: str
    summary: str


class Answer(BaseModel):
    answer: str
    supporting_quotes: list[str] = Field(
        default_factory=list, description="Verbatim quotes from the input backing the answer"
    )
    answerable: bool = Field(description="false if the input does not contain the answer")


# ---- Tasks ----

ANALYZE = register(
    PromptTemplate(
        name="analyze",
        description="General analysis of any text/image/audio/document input.",
        system=_ASSISTANT,
        instruction="Analyze the provided input. {instructions}",
        output_model=AnalysisResult,
        defaults={"instructions": ""},
    )
)

register(
    PromptTemplate(
        name="summarize",
        description="Summarize the input.",
        system=_ASSISTANT,
        instruction="Summarize the provided input as {style}.",
        defaults={"style": "a short paragraph followed by 3-5 bullet points"},
    )
)

register(
    PromptTemplate(
        name="extract",
        description="Extract named fields from the input (forms, receipts, reports...).",
        system=_ASSISTANT + " Never invent values.",
        instruction="Extract these fields from the provided input: {fields}.",
        output_model=Extraction,
    )
)

register(
    PromptTemplate(
        name="classify",
        description="Classify the input into one of the given labels.",
        system=_ASSISTANT,
        instruction="Classify the provided input into exactly one of: {labels}.",
        output_model=Classification,
        temperature=0.0,
    )
)

register(
    PromptTemplate(
        name="describe_image",
        description="Describe the attached image(s).",
        system=_ASSISTANT,
        instruction="Describe the attached image(s) in {detail} detail. {focus}",
        defaults={"detail": "moderate", "focus": ""},
    )
)

register(
    PromptTemplate(
        name="transcribe",
        description="Transcribe attached audio and summarize it.",
        system=_ASSISTANT,
        instruction="Transcribe the attached audio verbatim, then summarize it.",
        output_model=Transcript,
        temperature=0.0,
    )
)

register(
    PromptTemplate(
        name="qa",
        description="Answer a question using only the provided input (docs, PDFs, text).",
        system=_ASSISTANT + " Answer only from the provided input.",
        instruction="Question: {question}",
        output_model=Answer,
        temperature=0.0,
    )
)
