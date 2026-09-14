"""Export the verified read-only fixture as a static site for public judging."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from .deploy import build_demo_app


ROUTES = {
    "/": "index.html",
    "/board": "board/index.html",
    "/board/rows": "board/rows/index.html",
    "/review": "review/index.html",
    "/review/rows": "review/rows/index.html",
    "/support": "support/index.html",
    "/support/rows": "support/rows/index.html",
    "/reports": "reports/index.html",
    "/reports/table": "reports/table/index.html",
    "/healthz": "healthz/index.html",
    "/api/v1/status": "api/v1/status/index.html",
}


def export_static_demo(output_dir: Path | str, *, db_path: Path | str) -> list[Path]:
    """Render every public read route without exposing an action or credential."""
    destination = Path(output_dir)
    if destination.exists() and any(destination.iterdir()):
        raise RuntimeError(f"static demo destination is not empty: {destination}")
    destination.mkdir(parents=True, exist_ok=True)

    client = TestClient(
        build_demo_app(db_path),
        base_url="https://positive-contact.example",
    )
    written: list[Path] = []
    for route, relative in ROUTES.items():
        response = client.get(route)
        response.raise_for_status()
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if route in {"/healthz", "/api/v1/status"}:
            target.write_text(
                json.dumps(response.json(), indent=2) + "\n", encoding="utf-8"
            )
        else:
            target.write_text(response.text, encoding="utf-8")
        written.append(target)

    headers = destination / "_headers"
    headers.write_text(
        "/*\n"
        "  X-Content-Type-Options: nosniff\n"
        "  X-Frame-Options: DENY\n"
        "  Referrer-Policy: no-referrer\n"
        "/healthz/*\n"
        "  Content-Type: application/json; charset=utf-8\n"
        "/api/v1/status/*\n"
        "  Content-Type: application/json; charset=utf-8\n",
        encoding="utf-8",
    )
    written.append(headers)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    with TemporaryDirectory(prefix="positive-contact-static-") as temporary:
        written = export_static_demo(
            args.out,
            db_path=Path(temporary) / "demo.db",
        )
    print(f"exported {len(written)} read-only files to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
