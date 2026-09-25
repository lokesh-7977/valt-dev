"""Alembic environment.

Runs migrations with psycopg in *sync* mode (same `postgresql+psycopg://` URL the app uses async),
which avoids event-loop issues and works identically on Windows, macOS, Linux, and Cloud Run.
"""

from logging.config import fileConfig
from typing import Any

from alembic import context
from sqlalchemy import engine_from_config, pool

import valt_api.db.models  # noqa: F401  — registers every model on Base.metadata
from valt_api.config import get_settings
from valt_api.db.base import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# An explicit URL (tests, CLI -x) wins; otherwise use the app setting.
if not config.get_main_option("sqlalchemy.url"):
    url = get_settings().database_url
    if not url:
        raise RuntimeError("API_DATABASE_URL is not set")
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))

target_metadata = Base.metadata

# Tables owned by other tools; never create/drop them from autogenerate (ADR 0011).
EXTERNAL_TABLES = {"checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations"}


def include_name(name: str | None, type_: str, parent_names: Any) -> bool:
    if type_ == "table":
        return name not in EXTERNAL_TABLES
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_name=include_name,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_name=include_name,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
