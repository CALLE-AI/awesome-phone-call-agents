import os
import sys
from pathlib import Path

# Always force DRY_RUN in test runs so tests never place real calls.
os.environ["CALLE_DRY_RUN"] = "true"

# Flat app layout (no package __init__.py) - make the app dir importable
# from the tests dir regardless of the working directory pytest is run from.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
