"""The suite opts in to the shared development secret, the same way a developer must.

Set before any test module imports `call_analyzer.main`, which builds the app — and
therefore reads settings — at import time. If this line is deleted the suite fails to
collect, which is the guard in `settings.py` working.
"""
import os

os.environ.setdefault("CALL_ANALYZER_ENV", "test")
