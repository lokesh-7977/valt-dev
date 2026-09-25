FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

RUN useradd --create-home --uid 10001 app

# Dependencies first for layer caching.
COPY pyproject.toml ./
COPY src ./src
RUN pip install .

# Everything else the runtime needs (alembic.ini, migrations/) — filtered by .dockerignore.
COPY . .

USER app
EXPOSE 8000

# Cloud Run injects PORT; docker-compose overrides this command for --reload.
CMD ["sh", "-c", "exec uvicorn valt_api.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
