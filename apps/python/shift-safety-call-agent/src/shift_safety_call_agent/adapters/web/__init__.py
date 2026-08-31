"""Local-only FastAPI adapter, imported only when web dependencies are present."""

from shift_safety_call_agent.adapters.web.app import create_app

__all__ = ["create_app"]
