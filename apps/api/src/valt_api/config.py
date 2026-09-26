import tempfile
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment or a local .env file."""

    model_config = SettingsConfigDict(env_prefix="API_", env_file=".env", extra="ignore")

    env: str = "development"
    cors_origins: list[str] = ["http://localhost:3000"]
    service_name: str = "valt-api"

    # Logging: JSON lines (Cloud Logging friendly) in deployed envs, plain text locally.
    log_level: str = "INFO"
    log_json: bool = False

    # Postgres (ADR 0011): postgresql+psycopg://user:pass@host:5432/db
    # None → the API starts, but database-backed endpoints return 503.
    database_url: str | None = None
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_echo: bool = False

    # Gemini (ADR 0014). None → the API starts, but AI endpoints return 503.
    # Also read as GEMINI_API_KEY, or API_LLM_API_KEY / API_LLM_MODEL (infra/gcp/deploy.sh).
    gemini_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("API_GEMINI_API_KEY", "GEMINI_API_KEY", "API_LLM_API_KEY"),
    )
    gemini_model: str = Field(
        default="gemini-3.8-flash",
        validation_alias=AliasChoices("API_GEMINI_MODEL", "API_LLM_MODEL"),
    )
    gemini_timeout_s: float = 90.0
    gemini_max_retries: int = 2  # SDK-level retries on 429/5xx

    # Live QA agent (ADR 0016). Needs the `qa` extra + Chromium; otherwise /qa returns 503.
    qa_model: str = "gemini-3.8-flash"
    qa_allowed_hosts: list[str] = ["localhost:8001", "127.0.0.1:8001"]
    qa_max_steps: int = 15
    qa_run_timeout_s: float = 120.0
    qa_debounce_ms: int = 1500
    qa_screen_width: int = 1440
    qa_screen_height: int = 900
    qa_keep_screenshots: int = 3  # older screenshots are dropped from the model history
    qa_headless: bool = True

    # Uploads. Local disk by default — ephemeral and per-instance on Cloud Run.
    upload_dir: Path = Path(tempfile.gettempdir()) / "valt-uploads"
    max_upload_mb: int = 20
    max_files_per_request: int = 10


@lru_cache
def get_settings() -> Settings:
    return Settings()
