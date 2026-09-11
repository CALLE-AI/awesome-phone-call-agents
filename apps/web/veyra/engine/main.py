"""Re-export so `uvicorn main:app --reload` works from engine/ directly, without the
`app.` package prefix. The actual FastAPI app lives in app/main.py — see that file for
the real routes and README.md for what each module does."""

from app.main import app

__all__ = ["app"]
