"""The two shipped classifiers have to agree, and nothing checked that they did.

There are two of these. `dispatch/scheduler._classify` is what the Python app runs, and
`plugins/firstbell-absence-calls/examples/classify.mjs` is what an n8n deployment runs. The
recipe's own tests check the JavaScript against itself, and `README.md` promises the
workflow cannot drift from the module it is generated from. That promise is about the
workflow JSON and the module beside it, and it held. What nothing held was the module
against the Python it is a port of.

They diverged on the branch this whole entry is built around. A call where every required
field came back unknown carried the safeguarding flag in Python and did not in JavaScript,
so the same call sorted to the top of one queue and into the middle of the other, and was
counted in one safeguarding total and not in the other. The JavaScript also had no
equivalent of `dispatch.validation.problems`, so a result carrying a value outside the enum
was `resolved` there and `undetermined` here: the surface with no check behind it was the
one closing records.

This runs the JavaScript for real, over fixtures that reach every branch, and compares the
three fields that decide what happens to a family: the resolution, the escalation, and
whether a person has to look at it. Wording is deliberately not compared. The two surfaces
speak to different readers and are allowed to say it differently.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from dispatch import Escalation, Resolution, WaveDispatcher, WorkItem
from firstbell.domain import RESULT_SCHEMA, safeguarding_escalation

APP = Path(__file__).resolve().parent.parent
CLASSIFIER = (APP.parent.parent.parent / "plugins" / "firstbell-absence-calls"
              / "examples" / "classify.mjs")

# One recipient per branch, written once and fed to both surfaces.
#
# The status here is the recipient's, because that is what the JavaScript is handed. The
# Python side is handed a whole call, so each of these is wrapped below.
CASES: list[tuple[str, dict]] = [
    ("a schema-valid answer with an explicit confirmation", {
        "status": "completed",
        "attempts": [{"provider_call_id": "pc_1", "phone": "+915550000001"}],
        "structured_result": {"parent_confirmed_aware": "yes",
                              "reason_category": "illness",
                              "expected_return": "tomorrow"},
    }),
    ("a schema-valid answer where the parent did not confirm", {
        "status": "completed",
        "attempts": [{"provider_call_id": "pc_2", "phone": "+915550000002"}],
        "structured_result": {"parent_confirmed_aware": "no",
                              "reason_category": "illness",
                              "expected_return": "tomorrow"},
    }),
    ("a schema-valid answer with the confirmation field left out entirely", {
        "status": "completed",
        "attempts": [{"provider_call_id": "pc_3", "phone": "+915550000003"}],
        "structured_result": {"reason_category": "transport",
                              "expected_return": "today"},
    }),
    ("every required field unknown", {
        "status": "completed",
        "attempts": [{"provider_call_id": "pc_4", "phone": "+915550000004"}],
        "structured_result": {"reason_category": "unknown",
                              "expected_return": "unknown"},
    }),
    ("every required field unknown, but the parent confirmed", {
        "status": "completed",
        "attempts": [{"provider_call_id": "pc_5", "phone": "+915550000005"}],
        "structured_result": {"parent_confirmed_aware": "yes",
                              "reason_category": "unknown",
                              "expected_return": "unknown"},
    }),
    ("one unknown field among answered ones", {
        "status": "completed",
        "attempts": [{"provider_call_id": "pc_6", "phone": "+915550000006"}],
        "structured_result": {"parent_confirmed_aware": "yes",
                              "reason_category": "illness",
                              "expected_return": "unknown"},
    }),
    ("a value outside the enum", {
        "status": "completed",
        "attempts": [{"provider_call_id": "pc_7", "phone": "+915550000007"}],
        "structured_result": {"reason_category": "CATASTROPHIC",
                              "expected_return": "tomorrow"},
    }),
    ("a required field absent", {
        "status": "completed",
        "attempts": [{"provider_call_id": "pc_8", "phone": "+915550000008"}],
        "structured_result": {"reason_category": "illness"},
    }),
    ("a required field null", {
        "status": "completed",
        "attempts": [{"provider_call_id": "pc_9", "phone": "+915550000009"}],
        "structured_result": {"reason_category": "illness", "expected_return": None},
    }),
    ("a completed call with no structured result", {
        "status": "completed",
        "attempts": [{"provider_call_id": "pc_10", "phone": "+915550000010"}],
        "structured_result": None,
    }),
]

DRIVER = """
import { classifyRecipient } from CLASSIFIER_URL;
const cases = JSON.parse(process.argv[2]);
console.log(JSON.stringify(cases.map((recipient) => {
  const out = classifyRecipient(recipient);
  return { resolution: out.resolution, escalation: out.escalation,
           needsAHuman: out.needsAHuman };
})));
"""


def _javascript_verdicts(tmp_path: Path) -> list[dict]:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not on PATH, so the JavaScript surface cannot be run")
    if not CLASSIFIER.exists():
        pytest.skip(f"the n8n recipe is not in this checkout: {CLASSIFIER}")

    driver = tmp_path / "parity-driver.mjs"
    driver.write_text(
        DRIVER.replace("CLASSIFIER_URL", json.dumps(CLASSIFIER.as_uri())),
        encoding="utf-8",
    )
    proc = subprocess.run(
        [node, str(driver), json.dumps([case for _name, case in CASES])],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        "the JavaScript classifier could not be run, so this comparison measured "
        f"nothing: {proc.stdout} {proc.stderr}"
    )
    return json.loads(proc.stdout)


def _python_verdicts() -> list[dict]:
    dispatcher = WaveDispatcher(
        client=None, task_builder=lambda i: "x", result_schema=RESULT_SCHEMA,
        escalate=safeguarding_escalation,
    )
    out = []
    for index, (_name, recipient) in enumerate(CASES):
        call = {"id": f"call_{index}", "status": "completed", "recipients": [recipient]}
        result = dispatcher._classify(
            WorkItem(id=f"S-{index}", phones=("+915550000001",)), call)
        out.append({
            "resolution": result.resolution.value,
            "escalation": result.escalation.value,
            "needsAHuman": result.needs_a_human,
        })
    return out


def test_the_two_shipped_classifiers_reach_the_same_verdict(tmp_path):
    """Same recipient, both surfaces, the three fields that decide what happens next."""
    js = _javascript_verdicts(tmp_path)
    py = _python_verdicts()
    assert len(js) == len(py) == len(CASES)

    disagreements = [
        f"  {name}: python {p}, javascript {j}"
        for (name, _case), p, j in zip(CASES, py, js) if p != j
    ]
    assert not disagreements, (
        "the two shipped classifiers disagree about the same call, so a school running "
        "the n8n recipe and a school running the Python app get different answers about "
        "the same child: " + " | ".join(disagreements)
    )


def test_the_fixture_set_actually_reaches_every_verdict_this_is_meant_to_catch():
    """A parity check over fixtures that all land in one bucket compares nothing.

    Three of these branches are the ones that were broken, so the set has to be shown to
    contain them rather than assumed to.
    """
    py = _python_verdicts()
    seen = {(v["resolution"], v["escalation"]) for v in py}
    for expected in [
        (Resolution.RESOLVED.value, Escalation.NONE.value),
        (Resolution.RESOLVED.value, Escalation.SAFEGUARDING.value),
        (Resolution.UNDETERMINED.value, Escalation.SAFEGUARDING.value),
        (Resolution.UNDETERMINED.value, Escalation.NONE.value),
    ]:
        assert expected in seen, f"no fixture produces {expected}; the set is {sorted(seen)}"
