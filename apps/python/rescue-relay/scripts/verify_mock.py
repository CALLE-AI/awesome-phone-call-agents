#!/usr/bin/env python3
"""Run the isolated backend regression suite; never uses a live provider."""
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]
if __name__=='__main__':
    raise SystemExit(subprocess.call([sys.executable,'-m','pytest','-q','tests'],cwd=ROOT))
