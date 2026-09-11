"""Crash-safety proof: kill -9 the dispatcher process mid-mobilization,
restart against the same ledger file, and assert zero duplicate dials and
zero lost confirmations.

This runs the dispatcher in a real subprocess so SIGKILL is a true,
un-catchable process kill -- not a simulated exception -- matching the
methodology used for the KV-store project's crash-safety tests.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

WORKER_SCRIPT = """
import asyncio
import os
import sys
import time

sys.path.insert(0, {repo_root!r})

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.types import Need
from mobilize.sim.population import generate_population
from mobilize.transports.simulated import SimulatedTransport

async def main():
    donors = generate_population(300, seed=7)
    transport = SimulatedTransport(donors, seed=7, min_latency_s=0.3, max_latency_s=1.5)
    pool = [d.candidate for d in donors]
    need = Need(label="O-negative blood needed", count=3, deadline_minutes=60,
                location="City Hospital", max_calls=40)
    ledger = Ledger({ledger_path!r})

    def on_progress(event, data):
        if event == "wave_dispatch":
            with open({marker_path!r}, "w") as f:
                f.write("wave_dispatched")
        print(event, data, flush=True)

    result = await mobilize(need, pool, transport, ledger=ledger, on_progress=on_progress,
                             mobilization_id="mob_crashtest")
    print("COMPLETED", result.filled, result.calls_used, flush=True)

asyncio.run(main())
"""


def _run_worker(ledger_path: str, marker_path: str, timeout: float) -> subprocess.Popen:
    script = WORKER_SCRIPT.format(repo_root=REPO_ROOT, ledger_path=ledger_path, marker_path=marker_path)
    venv_python = os.path.join(REPO_ROOT, ".venv", "bin", "python3")
    python_bin = venv_python if os.path.exists(venv_python) else sys.executable
    return subprocess.Popen(
        [python_bin, "-c", script],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def test_kill_minus_9_mid_dispatch_then_resume_no_duplicates_no_losses():
    with tempfile.TemporaryDirectory() as tmp:
        ledger_path = os.path.join(tmp, "ledger.jsonl")
        marker_path = os.path.join(tmp, "wave_dispatched.marker")

        # First run: kill it the instant it has dispatched wave 0, before any
        # results have been recorded -- the worst case for double-dialing.
        proc = _run_worker(ledger_path, marker_path, timeout=10)
        deadline = time.time() + 10
        while not os.path.exists(marker_path) and time.time() < deadline:
            time.sleep(0.02)
        assert os.path.exists(marker_path), "worker never reached wave dispatch before timeout"

        time.sleep(0.05)  # let the dispatch loop log a couple of entries
        proc.send_signal(signal.SIGKILL)
        proc.wait(timeout=5)
        assert proc.returncode != 0  # confirms it was actually killed mid-flight, not finished

        assert os.path.exists(ledger_path)
        with open(ledger_path) as f:
            lines_after_crash = [json.loads(line) for line in f if line.strip()]
        dispatched_after_crash = {e["candidate_id"] for e in lines_after_crash if e["kind"] == "dispatched"}
        assert len(dispatched_after_crash) > 0, "expected at least one dispatch logged before the kill"

        # Second run: same ledger file, same mobilization_id. It must not
        # re-dial anyone already in the ledger, and must eventually fill.
        from mobilize.core.ledger import Ledger

        ledger = Ledger(ledger_path)
        already = {c for c in dispatched_after_crash if ledger.already_dispatched("mob_crashtest", c)}
        assert already == dispatched_after_crash

        resume_proc = _run_worker(ledger_path, marker_path, timeout=30)
        out, _ = resume_proc.communicate(timeout=30)

        with open(ledger_path) as f:
            final_entries = [json.loads(line) for line in f if line.strip()]

        dispatched_candidates = [e["candidate_id"] for e in final_entries if e["kind"] == "dispatched"]
        result_candidates = [e["candidate_id"] for e in final_entries if e["kind"] == "result"]

        # The critical assertion: no candidate was ever dispatched twice,
        # even though the process was killed and the dispatcher restarted
        # cold against the same ledger file.
        assert len(dispatched_candidates) == len(set(dispatched_candidates)), (
            f"duplicate dispatch detected after crash+restart: {dispatched_candidates}"
        )
        # No confirmation recorded before the crash was lost.
        pre_crash_results = {e["candidate_id"] for e in lines_after_crash if e["kind"] == "result"}
        assert pre_crash_results.issubset(set(result_candidates))

        assert "COMPLETED True" in out, f"mobilization did not complete successfully on resume:\\n{out}"
