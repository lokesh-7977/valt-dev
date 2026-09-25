from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment or a local .env file."""

    model_config = SettingsConfigDict(env_prefix="API_", env_file=".env", extra="ignore")

    env: str = "development"
    cors_origins: list[str] = ["http://localhost:3000"]
    service_name: str = "valt-api"

    # Postgres (ADR 0011): postgresql+psycopg://user:pass@host:5432/db
    # None → the API starts, but database-backed endpoints return 503.
    database_url: str | None = None
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_echo: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
