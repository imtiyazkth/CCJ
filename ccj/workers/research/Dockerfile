# CCJ Research Worker — Dockerfile
# Python 3.12 slim, non-root user, no dev dependencies in prod

FROM python:3.12-slim AS base

# Security: run as non-root
RUN addgroup --system ccj && adduser --system --ingroup ccj ccj

WORKDIR /app

# Install system deps for asyncpg
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Dependencies ──────────────────────────────────────────────

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# ── Application ───────────────────────────────────────────────

COPY app/ ./app/

# Create artifact storage dir owned by ccj
RUN mkdir -p /app/artifacts && chown -R ccj:ccj /app

USER ccj

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
