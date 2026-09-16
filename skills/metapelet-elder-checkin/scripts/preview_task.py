#!/usr/bin/env python3
"""Print CALL-E task preview (no call). Run from repo root or app dir."""

import json
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[3] / "apps" / "python" / "metapelet-checkin"
sys.path.insert(0, str(APP))

from task_builder import preview_plan  # noqa: E402

REQ = APP / "example_request.json"


def main() -> None:
    request = json.loads(REQ.read_text(encoding="utf-8"))
    plan = preview_plan(request)
    sys.stdout.buffer.write(json.dumps(plan, ensure_ascii=False, indent=2).encode("utf-8"))
    sys.stdout.buffer.write(b"\n")


if __name__ == "__main__":
    main()
