from __future__ import annotations

from .processing import Processor
from .settings import Settings


def process_analysis(analysis_id: str) -> None:
    """RQ entry point. All dependencies are reconstructed from worker environment."""
    settings = Settings.from_env()
    Processor(settings).process(analysis_id)

