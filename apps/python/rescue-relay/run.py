#!/usr/bin/env python3
"""One-process launcher. Reads .env as data, never executes it as shell code."""
from __future__ import annotations
import os
from pathlib import Path
import uvicorn
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
if __name__ == '__main__':
    os.chdir(ROOT)
    load_dotenv(ROOT / '.env', override=False)
    try:
        port = int(os.getenv('PORT', '8000'))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise SystemExit('PORT must be an integer between 1 and 65535.')
    # In-process coordination tasks require ONE worker. Do not use --reload live.
    uvicorn.run('app:app', host=os.getenv('HOST', '127.0.0.1'), port=port, workers=1)
