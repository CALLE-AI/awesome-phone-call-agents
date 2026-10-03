import sys
from pathlib import Path

# Lets `python -m pytest apps/python/rebuttal-dispute-call/tests` work from any directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
