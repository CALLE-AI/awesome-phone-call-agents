import sys
from pathlib import Path

# Lets `pytest` run here without an editable install first.
sys.path.insert(0, str(Path(__file__).resolve().parent))
