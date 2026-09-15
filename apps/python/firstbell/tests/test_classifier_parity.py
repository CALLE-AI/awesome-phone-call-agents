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
# The status is the recipient's. Each case may also carry a third element, which is merged
# into the call the recipient is wrapped in, because one of the shapes that diverged is a
# property of the call rather than of the recipient: a task-level `structured_result` on a
# single-recipient call. A case with no third element gets an empty dict and behaves
# exactly as it did.
CASES: list[tuple] = [
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
    # The shape production actually produced, and the one that had no fixture: one
    # recipient, its own `structured_result` null, and the answer on the task. The
    # third element goes on the call rather than on the recipient because that is
    # where the API puts it.
    # Also absent until the shape check was written: a call that reached nobody. Both
    # surfaces have a branch for it and neither was compared on it.
    ("nobody reached on any number", {
        "status": "failed",
        "attempts": [{"provider_call_id": "pc_11", "phone": "+915550000011",
                      "status": "failed", "sip_code": "480"},
                     {"provider_call_id": "pc_12", "phone": "+915550000012",
                      "status": "failed", "sip_code": "486"}],
        "structured_result": None,
     }, {
        # The call status as well as the recipient's. The wrapper's default is a completed
        # call, and a completed call carrying a failed single recipient is a shape the API
        # does not produce: the Python classifier reads the call and the JavaScript reads
        # the recipient, so a contradiction between the two makes them disagree about a
        # call that does not exist. Setting both is what makes this fixture a real call.
        "status": "failed",
     }),
    ("one recipient, no result of its own, and the answer on the task", {
        "status": "completed",
        "attempts": [{"provider_call_id": "pc_task", "phone": "+915550000001"}],
        "structured_result": None,
     }, {
        "structured_result": {"parent_confirmed_aware": "yes",
                              "reason_category": "illness",
                              "expected_return": "today"},
     }),
]

DRIVER = """
import { classifyRecipient } from CLASSIFIER_URL;
const cases = JSON.parse(process.argv[2]);
// Handed whole calls rather than bare recipients, because one of the shapes the two
// surfaces can disagree on is a property of the call: a task-level structured_result on a
// single-recipient call. The Python side has always been handed the call, and handing the
// JavaScript side less than that is what let the disagreement hide.
console.log(JSON.stringify(cases.map((call) => {
  const out = classifyRecipient(call.recipients[0], call);
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
    wrapped = [
        {"id": f"call_{i}", "status": "completed", "recipients": [case[1]],
         **(case[2] if len(case) > 2 else {})}
        for i, case in enumerate(CASES)
    ]
    proc = subprocess.run(
        [node, str(driver), json.dumps(wrapped)],
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
    for index, case in enumerate(CASES):
        recipient, extra = case[1], (case[2] if len(case) > 2 else {})
        call = {"id": f"call_{index}", "status": "completed", "recipients": [recipient],
                **extra}
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
        f"  {case[0]}: python {p}, javascript {j}"
        for case, p, j in zip(CASES, py, js) if p != j
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


def test_the_fixture_set_contains_every_input_shape_the_two_can_disagree_on():
    """Coverage by what goes in, because the last gap was invisible to coverage by verdict.

    The test above selects fixtures by the verdict pair they produce. That cannot notice a
    missing input shape: a shape nobody wrote a fixture for produces no verdict, so it
    subtracts nothing from a set of verdicts that are already covered by other fixtures.
    One was missing, and it was the one that mattered.

    A single-recipient call can come back with the per-recipient `structured_result` null
    and the task-level field fully populated. Production produced exactly that.
    `dispatch/scheduler.py:_result_for` reads the task-level field in that case and the
    JavaScript did not, so the two surfaces returned resolved with nobody needed and
    undetermined with a person needed, for the same call. No fixture had that shape.

    So this asserts the shapes, by reading the fixtures rather than by running them. It is
    deliberately about the inputs and not the outputs: an assertion about outputs is what
    was already here.
    """
    shapes = set()
    for case in CASES:
        recipient = case[1]
        extra = case[2] if len(case) > 2 else {}
        own = recipient.get("structured_result", "absent") if isinstance(recipient, dict) else "absent"
        shapes.add((
            "connected" if isinstance(recipient, dict)
            and recipient.get("status") == "completed" else "not-connected",
            "own-result" if isinstance(own, dict) else "no-own-result",
            "task-result" if isinstance(extra.get("structured_result"), dict)
            else "no-task-result",
        ))

    required = {
        # The shape that diverged, and the reason this test exists.
        ("connected", "no-own-result", "task-result"),
        # The ordinary answered call.
        ("connected", "own-result", "no-task-result"),
        # A conversation that produced nothing anywhere.
        ("connected", "no-own-result", "no-task-result"),
        # Nobody reached.
        ("not-connected", "no-own-result", "no-task-result"),
    }
    missing = sorted(required - shapes)
    assert not missing, (
        "no fixture has these input shapes, so the two classifiers are not compared on "
        f"them at all: {missing}. The set present is {sorted(shapes)}"
    )


def test_a_single_recipient_task_level_result_is_read_by_both_surfaces(tmp_path):
    """Named separately, because a shape in the set is not the same as a shape agreed on.

    If both surfaces regressed together the parity test above would stay green, and the
    coverage test would stay green because the fixture is still there. This asserts the
    verdict itself: production sent a finished conversation with the answer on the task,
    and neither surface may route it to a person.
    """
    index = next((i for i, case in enumerate(CASES)
                  if len(case) > 2
                  and isinstance(case[2].get("structured_result"), dict)), None)
    assert index is not None, "the single-recipient task-level fixture has been removed"

    py = _python_verdicts()[index]
    js = _javascript_verdicts(tmp_path)[index]
    assert py["resolution"] == "resolved", (
        f"python routes a finished conversation with a task-level answer to {py}"
    )
    assert py["needsAHuman"] is False
    assert py == js, f"python {py}, javascript {js}"
