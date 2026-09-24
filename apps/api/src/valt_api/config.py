from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment or a local .env file."""

    model_config = SettingsConfigDict(env_prefix="API_", env_file=".env", extra="ignore")

    env: str = "development"
    cors_origins: list[str] = ["http://localhost:3000"]
    service_name: str = "valt-api"


@lru_cache
def get_settings() -> Settings:
    return Settings()
