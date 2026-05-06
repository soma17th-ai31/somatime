# SomaMeet backend — production-ish Docker image (v3.20).
# Single-stage Python 3.11-slim. Runs as a non-root user. Migrations are
# applied on container start so that swapping persistent SQLite or Postgres
# storage Just Works. The default CMD is uvicorn on :8000; override it for
# one-off jobs (e.g. `docker run --rm somameet-backend python -m pytest`).

# syntax=docker/dockerfile:1.6
FROM python:3.11-slim AS base

# Layer-friendly Python defaults: no .pyc files, unbuffered stdout/stderr,
# no pip cache or version banners during install.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Seoul

# Minimal system deps. tzdata for the explicit Asia/Seoul TZ above; everything
# else (uvicorn, sqlalchemy, alembic) is pure-Python from PyPI.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so application code changes don't bust the layer.
COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/requirements.txt

# Copy the rest of the backend source.
COPY . /app

# Default location for the SQLite database when DATABASE_URL is unset. The
# directory is created up-front so a host bind-mount can persist the file.
RUN mkdir -p /app/data \
    && addgroup --system app \
    && adduser --system --ingroup app app \
    && chown -R app:app /app

USER app

EXPOSE 8000

# Lightweight liveness probe. Hits the existing /api/health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).status == 200 else 1)" || exit 1

# Apply migrations then start the API. Override CMD for tests / shells.
# Note: invoke alembic via `python -m alembic.config` to match Procfile (the
# `alembic` console-script is not always on PATH for non-pip-install contexts).
CMD ["sh", "-c", "python -m alembic.config upgrade head && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"]
