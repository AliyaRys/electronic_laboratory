# syntax=docker/dockerfile:1

# Backend image: pinned Python, uv frozen install, non-root runtime (ADR-013/014).
# The base image digest is pinned in docs/adr/README.md and re-verified before release.

# --- base: pinned Python + uv ------------------------------------------------
FROM python:3.15.2-slim@sha256:e97b88e416c3c01eb427b21fd8cd3ebf006e6ee38afcfcc3cae1c54ee2ab0a75 AS base

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# uv is pinned to the version selected by SPEC-03 (0.13.7), never `latest`.
RUN pip install --no-cache-dir uv==0.13.7

# --- build: resolve and install from the frozen lock --------------------------
FROM base AS build

WORKDIR /app

# Copy the workspace manifest and lock first for layer caching.
COPY pyproject.toml uv.lock .python-version ./
COPY backend ./backend

# Frozen install of runtime deps only (no dev group, no project install).
RUN uv sync --frozen --no-dev --no-install-project

# --- runtime ------------------------------------------------------------------
FROM python:3.15.2-slim@sha256:e97b88e416c3c01eb427b21fd8cd3ebf006e6ee38afcfcc3cae1c54ee2ab0a75 AS runtime

# Run as a non-root user (ADR-013).
RUN groupadd --system app && useradd --system --gid app --create-home appuser

WORKDIR /app

COPY --from=build /app/.venv /app/.venv
COPY backend ./backend
COPY pyproject.toml uv.lock .python-version ./
# The one-shot migration wrapper (release advisory lock).
COPY deploy/migrate_lock.py ./deploy/migrate_lock.py

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

USER appuser

EXPOSE 8000

# Migrations run as a separate one-shot service (profile "migrate"), never here.
CMD ["python", "-m", "uvicorn", "backend.src.interfaces.main:app", "--host", "0.0.0.0", "--port", "8000"]
