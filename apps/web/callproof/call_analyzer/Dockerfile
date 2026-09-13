FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY call_analyzer ./call_analyzer
RUN pip install --no-cache-dir .

RUN useradd --create-home --uid 1000 callproof && \
    mkdir -p /data && chown callproof:callproof /data
USER callproof

EXPOSE 8001
CMD ["uvicorn", "call_analyzer.main:app", "--host", "0.0.0.0", "--port", "8001"]

