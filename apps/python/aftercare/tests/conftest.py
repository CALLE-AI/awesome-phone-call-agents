"""Force a no-call test environment before any app import."""

from __future__ import annotations

import os

os.environ["APP_ENV"] = "test"
os.environ["DRY_RUN_DEFAULT"] = "true"
os.environ["ENABLE_SCHEDULER"] = "false"
os.environ["ENABLE_EMBEDDING_BACKFILL"] = "false"
os.environ["JWT_SECRET"] = "test-jwt-secret-value-at-least-32-chars"
os.environ["CALLE_API_KEY"] = "test_calle_key"
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/aftercare_test",
)
os.environ["TRUSTED_HOSTS"] = '["*"]'
os.environ["CORS_ORIGINS"] = '["http://localhost:3000"]'
