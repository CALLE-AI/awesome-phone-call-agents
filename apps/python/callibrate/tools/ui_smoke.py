"""Drive the real console and the real public page in Chromium.

The pytest suite proves the transactions. This proves a person can reach them.
It signs in, opens every view, selects a record, reads the rendered call goal,
runs a verification, watches the record change, resolves the decision that a
second verification creates, and reports a failed referral from the public page.
Any console error or failed network request fails the run.

    python tools/ui_smoke.py              # throwaway server on a free port
    python tools/ui_smoke.py https://...  # or an already-running deployment
    python tools/ui_smoke.py --demo       # play the guided walkthrough instead

Screenshots land in docs/screenshots/, which is what the film is cut from.
"""

from __future__ import annotations

import os
import pathlib
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

from playwright.sync_api import ConsoleMessage, Request, sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "screenshots"
VIEWPORT = {"width": 1600, "height": 1000}
USERNAME = os.environ.get("CBR_CURATOR_USERNAME", "judge")
PASSWORD = os.environ.get("CBR_CURATOR_PASSWORD", "callibrate-demo-2026")

problems: list[str] = []


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def wait_for(url: str, timeout: float = 40.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, OSError):
            time.sleep(0.3)
    raise SystemExit(f"server never became ready at {url}")


def start_server(database: pathlib.Path, port: int | None = None) -> tuple[subprocess.Popen, str]:
    """A throwaway server on a fresh database.

    Fresh on purpose: the seeded directory is only created when the database is
    empty, so a second run against a kept file starts with the queue the first
    run emptied, and the walkthrough finds no record left to call about.
    """
    database.parent.mkdir(parents=True, exist_ok=True)
    database.unlink(missing_ok=True)
    port = port or free_port()
    environment = {
        **os.environ,
        "CBR_DATABASE_PATH": str(database),
        "CBR_ENVIRONMENT": "development",
        "CBR_CALLER_MODE": "pilot",
        "CBR_BOOTSTRAP_SAMPLE_DATA": "true",
        # A sandbox is demonstrated many times a day; spacing is proven in pytest.
        "CBR_MINIMUM_CALL_INTERVAL_DAYS": "0",
        "CBR_ALLOWED_HOSTS": "localhost,127.0.0.1,testserver",
    }
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "callibrate.api:app", "--port", str(port)],
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    wait_for(f"{base}/health")
    return process, base


def watch(page) -> None:
    def on_console(message: ConsoleMessage) -> None:
        # The session probe on a cold load is a 401 by design; everything else
        # the console reports is a defect.
        if "401" in message.text:
            return
        if message.type in {"error", "warning"}:
            problems.append(f"console {message.type}: {message.text}")

    def on_failed(request: Request) -> None:
        problems.append(f"request failed: {request.method} {request.url}")

    page.on("console", on_console)
    page.on("requestfailed", on_failed)
    page.on(
        "response",
        lambda response: problems.append(f"HTTP {response.status} {response.url}")
        if response.status >= 400 and "/api/" in response.url and response.status != 401
        else None,
    )


def shot(page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=False)


def run_console(page, base: str) -> None:
    page.goto(base, wait_until="networkidle")
    page.fill("input[name=username]", USERNAME)
    page.fill("input[name=password]", PASSWORD)
    shot(page, "01-signin")
    page.click("button[type=submit]")
    page.wait_for_selector(".rig", timeout=15000)
    shot(page, "02-queue")

    # Select the stale pantry record and read the goal that would be sent.
    page.click('.queue-item:has-text("Weekly grocery pickup")')
    page.wait_for_selector(".goal", timeout=10000)
    goal = page.inner_text(".goal")
    if "automated assistant" not in goal:
        problems.append("the rendered call goal does not contain the AI disclosure")
    if "read the WHOLE" not in goal.replace("say the WHOLE", "read the WHOLE"):
        problems.append("the rendered call goal does not contain the readback rule")
    shot(page, "03-contract")

    before = page.inner_text(".record-row .v")
    page.click("#call-button")
    page.wait_for_selector(".verdict", timeout=40000)
    verdict = page.inner_text(".verdict .name")
    after = page.inner_text(".record-row .v")
    if verdict != "AUTO APPLIED":
        problems.append(f"expected AUTO APPLIED from the default pilot scenario, saw {verdict!r}")
    if before == after:
        problems.append("the record did not change after an applied verification")
    shot(page, "04-verified")

    page.click('.tab[data-view="decisions"]')
    page.wait_for_selector(".decision", timeout=10000)
    shot(page, "05-decisions")
    page.click(".decision-actions .approve, .decision-actions .button.approve")
    page.wait_for_timeout(1200)

    page.click('.tab[data-view="directory"]')
    page.wait_for_selector("table tbody tr", timeout=10000)
    shot(page, "06-directory")

    page.click('.tab[data-view="ledger"]')
    page.wait_for_selector(".event", timeout=10000)
    chip = page.inner_text("#ledger-chip")
    if "intact" not in chip:
        problems.append(f"ledger chip reads {chip!r}")
    if "broken" in page.inner_text(".panel-head .chip").lower():
        problems.append("the evidence ledger does not verify")
    shot(page, "07-ledger")


def run_public(page, base: str) -> None:
    page.goto(f"{base}/find", wait_until="networkidle")
    page.wait_for_selector(".result", timeout=15000)
    shot(page, "08-public")
    page.click("[data-verify]")
    page.wait_for_selector(".verify-strip", timeout=10000)
    shot(page, "09-verifying")
    page.wait_for_function(
        "() => document.querySelector('.verify-strip .step.done, .verify-strip .step.stopped')"
        " && document.querySelectorAll('.verify-strip .step.active').length === 0",
        timeout=60000,
    )
    outcome = page.inner_text(".verify-strip .body")
    if "could not" in outcome or "refused" in outcome:
        problems.append(f"the public verification did not complete: {outcome}")
    shot(page, "10-verified-public")

    page.click(".result-actions .button.ghost")
    page.wait_for_selector("#form-dialog[open]", timeout=8000)
    page.click("#form-dialog-submit")
    page.wait_for_timeout(1500)
    shot(page, "11-reported")


def run_demo(page, base: str) -> None:
    page.goto(f"{base}/?demo=1", wait_until="networkidle")
    page.wait_for_function("() => window.callibrateDemo && window.callibrateDemo.finished", timeout=300000)
    failures = page.evaluate("() => window.callibrateDemo.failures")
    for failure in failures:
        problems.append(f"walkthrough beat failed: {failure}")


def main() -> int:
    arguments = [item for item in sys.argv[1:]]
    demo = "--demo" in arguments
    arguments = [item for item in arguments if item != "--demo"]
    external = arguments[0] if arguments else ""

    process = None
    database = ROOT / "data" / "ui-smoke.db"
    if not external:
        process, base = start_server(database)
    else:
        base = external.rstrip("/")

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(viewport=VIEWPORT, device_scale_factor=2)
            page = context.new_page()
            watch(page)
            if demo:
                run_demo(page, base)
            else:
                run_console(page, base)
                run_public(page, base)
            context.close()
            browser.close()
    finally:
        if process is not None:
            process.terminate()
            process.wait(timeout=10)

    if problems:
        print("FAILED")
        for problem in dict.fromkeys(problems):
            print(f"  - {problem}")
        return 1
    print(f"OK — screenshots in {SHOTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
