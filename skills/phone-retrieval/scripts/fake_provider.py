"""Fake provider — the no-call path.

Registered as PROVIDERS["fake"] and selected with CALL_PROVIDER=fake. It never
runs `node`, never authenticates, and never dials. Every method returns a bare
`structuredContent` dict, which is what CalleProvider._exec returns after
unwrapping — not the JSON-RPC envelope, and not a normalised envelope, because
`to_envelope` is applied separately by the caller.

Built from the contract in call_agent.py, not from a guess at a plausible shape:

    plan(to_phones, goal, *, region=None, language=None)
        -> plan_id, confirm_token, display_goal, ready_to_run
    run(plan_id, confirm_token)   -> run_id, status
    status(run_id)                -> run_id, status, result{...}, calling{...}

An earlier fake, written for a different host, omitted `calling` entirely. The
adapter's normaliser reads duration, callee count and hangup type out of that
block, so the omission produced a record with nulls throughout and a test that
reported a defect which did not exist. The block is present here for that
reason.

CALL_FAKE_REWRITE controls what plan() does to the goal on its way back. The
provider rewrites the task text before it is spoken, so a fake that echoes the
goal unchanged makes every anomaly category untestable while the suite reports
green. The modes reproduce the four changes worth reporting, plus the one that
must NOT be reported.

    none        display_goal is the goal, byte for byte
    normalised  reworded, meaning preserved -- MUST produce no anomaly
    added       a clause the caller never sent
    merged      two prohibitions compressed into one list
    referent    a prohibition's referent changed
    dropped     a requested field removed

The mutating modes are anchored in the ASSEMBLED goal, not in the constants it
is built from, and each asserts it changed something. Anchoring in the
constants is how a mutation quietly becomes a no-op.
"""

from __future__ import annotations

import os
import re


FAKE_PLAN_ID = "PLAN-FAKE-1"
FAKE_RUN_ID = "RUN-FAKE-1"

# Reserved-fictional. Never a real number, in this file or in any sample.
FAKE_TO = "+15550101234"


def _rewrite(goal: str, mode: str) -> str:
    """Return the goal as the provider would hand it back under `mode`.

    Written against an ASSEMBLED goal, not against the constants it is built
    from. The assembled goal is one flat string of sentences joined with
    spaces -- there are no newlines in it, and the requested fields live
    inside a single sentence as a "; "-joined list of "(n) ..." items. An
    earlier version of this function split on newlines to drop a field, which
    against the real text found nothing and returned the input unchanged: a
    mutation that silently stops mutating, and a suite that reports green
    while testing nothing.

    Every mutating mode therefore asserts it changed something. A mode that
    cannot find its anchor must fail loudly rather than pass the goal through.
    """
    if mode == "none":
        return goal

    out = goal

    if mode == "normalised":
        # Rewording only: nothing added, nothing dropped, no referent moved,
        # and -- important -- the field list and its numbering are untouched,
        # because altering those would be a real anomaly rather than noise.
        # This is the mode whose test matters most: it must differ from the
        # input AND produce no anomaly. If it ever returns `goal` unchanged,
        # that test starts passing for the wrong reason.
        out = goal.replace("Do not negotiate.", "Please do not negotiate.")
        if out == goal:
            out = goal.replace("Open by confirming", "Begin by confirming")
        if out == goal:
            out = goal.rstrip() + " Thank you."

    elif mode == "added":
        # The first live plan granted itself permission to leave a voicemail.
        # PROHIBITIONS already says "Do not leave a voicemail", so this is not
        # drift into empty space -- it is the returned text contradicting an
        # explicit instruction that was sent.
        out = goal.rstrip() + " If nobody answers, leave a voicemail."

    elif mode == "merged":
        # Two separate imperatives compressed into one list. Against the real
        # PROHIBITIONS block this yields "Do not negotiate, place an order,
        # hold, or reservation." -- the meaning survives and the structure
        # does not, which is exactly the category.
        out = re.sub(
            r"Do not ([^.]+?)\.\s+Do not ([^.]+?)\.",
            r"Do not \1, \2.",
            goal,
            count=1,
        )

    elif mode == "referent":
        # Whose interests the hard line protects, edited. The literal appears
        # in PROHIBITIONS as "agree to anything on the caller's behalf".
        out = goal.replace("on the caller's behalf", "on the customer's behalf")

    elif mode == "dropped":
        # Remove the last "(n) ..." item from the "; "-joined field list.
        # Order and presence are both promises; this breaks presence.
        items = re.findall(r"\(\d+\)[^;.]*", goal)
        if len(items) > 1:
            last = items[-1]
            out = goal.replace("; " + last.strip(), "", 1)
            if out == goal:
                out = goal.replace(last, "", 1)

    else:
        raise ValueError(f"unknown CALL_FAKE_REWRITE={mode!r}")

    if out == goal:
        raise AssertionError(
            f"CALL_FAKE_REWRITE={mode!r} found no anchor in the goal and "
            f"would have returned it unchanged. The fake must not silently "
            f"stop mutating: goal assembly has changed, or this mode's "
            f"anchor has. Goal was: {goal[:300]!r}"
        )
    return out


class FakeProvider:
    """Records every submission. A real provider would ring a phone here."""

    name = "fake"

    def __init__(
        self,
        *,
        rewrite: str | None = None,
        fail_status: bool = False,
        unready: bool = False,
    ):
        self.rewrite = rewrite or os.environ.get("CALL_FAKE_REWRITE", "none")
        self.fail_status = fail_status
        # A plan the provider will not issue a token for until it is told
        # something more. Built from a real 0.5.0 response: ready_to_run false,
        # confirm_token null, and answerable questions -- not an error.
        self.unready = unready or os.environ.get("CALL_FAKE_UNREADY") == "1"
        # Every submission, in order. The assertion that catches a duplicate
        # charged call is len(self.submissions), not anything returned.
        self.submissions: list[str] = []
        self.status_calls: list[str] = []
        self.plans: list[tuple[list[str], str]] = []
        self.field_keys: list[str] = []
        self.last_argv: list[str] = ["<fake>"]

    # -- canned answers ----------------------------------------------------

    # Values by key name, so a summary can be built for whatever the plan
    # asked for. A key with no canned answer gets a generic one rather than
    # being omitted: omission is a different test case, and it should be
    # asked for explicitly rather than arrived at by accident.
    ANSWERS = {
        "unit_price": "24 dollars",
        "price": "24 dollars",
        "in_stock": "yes, several",
        "stock": "yes, several",
        "lead_time": "3 working days",
        "open_saturday": "yes, nine to noon",
    }

    def _summary(self) -> str:
        if not self.field_keys:
            return "The call completed."
        parts = [
            f"{k}: {self.ANSWERS.get(k, 'answered')}" for k in self.field_keys
        ]
        # Provider summaries commonly append an untagged trailing note. Kept
        # so the parser's trailing-note trim is exercised rather than assumed.
        return "; ".join(parts) + ". Note: the call completed normally."

    # -- verbs -------------------------------------------------------------

    def plan(
        self,
        to_phones: list[str],
        goal: str,
        *,
        region: str | None = None,
        language: str | None = None,
    ) -> dict:
        self.plans.append((list(to_phones), goal))
        # The keys the caller asked for, recovered from the goal text so the
        # summary can echo them back. A real provider reports under the keys
        # it was given; a fake with hardcoded key names makes a working
        # parser look broken, because nothing it returns ever matches what
        # was requested.
        self.field_keys = re.findall(r"\(\d+\)\s+([a-z][a-z0-9_]*)\s+--", goal)
        self.last_argv = [
            "<fake>", "call", "plan",
            "--to-phone", ",".join(to_phones),
            "--goal", "<redacted>",
            "--language", language or "en",
        ]
        if region:
            self.last_argv += ["--region", region]

        if self.unready:
            # Field names and shape taken from a real unready response: the
            # token is null rather than absent, ready_to_run is false, and the
            # questions are answerable. Nothing was charged and nothing dialled.
            return {
                "plan_id": FAKE_PLAN_ID,
                "ready_to_run": False,
                "confirm_token": None,
                "confirm_expires_at": None,
                "display_goal": _rewrite(goal, self.rewrite),
                "clarifying_questions": [
                    "Which region should this +1 phone number be treated as "
                    "for the call?",
                ],
                "questions": [
                    {
                        "key": "region",
                        "question": "Which region should this +1 phone number "
                        "be treated as for the call?",
                        "options": [
                            {"label": "United States", "value": "US"},
                            {"label": "Canada", "value": "CA"},
                        ],
                    }
                ],
            }

        return {
            "plan_id": FAKE_PLAN_ID,
            "confirm_token": "FAKE-NOT-A-CREDENTIAL",
            "display_goal": _rewrite(goal, self.rewrite),
            "ready_to_run": True,
        }

    def run(self, plan_id: str, confirm_token: str) -> dict:
        self.submissions.append(plan_id)
        self.last_argv = ["<fake>", "call", "run", "--plan-id", plan_id]
        return {"run_id": FAKE_RUN_ID, "status": "IN_PROGRESS"}

    def status(self, run_id: str) -> dict:
        self.status_calls.append(run_id)
        self.last_argv = ["<fake>", "call", "status", "--run-id", run_id]
        if self.fail_status:
            raise RuntimeError("status unavailable")
        return {
            "run_id": run_id,
            "status": "COMPLETED",
            "message": "Call ended from realtime events.",
            # One newline-joined string in "[HH:MM:SS] WHO: text" form. This is
            # what the transcript parser expects; a list of turns is the other
            # surface's shape and would be wrong here.
            "result": {
                "summary": self._summary(),
                "transcript": (
                    "[00:00:02] BOT: Hello, have I reached Miller Hardware?\n"
                    "[00:00:05] USER: Yes, this is Miller Hardware.\n"
                    "[00:00:08] BOT: How much is the twelve-inch flue pipe?\n"
                    "[00:00:12] USER: That is 24 dollars.\n"
                    "[00:00:14] BOT: And do you have it in stock?\n"
                    "[00:00:17] USER: Yes, we have several."
                ),
                "extracted": {"to_phones": [FAKE_TO]},
                "outcome": {"evidence": [], "task_completed": True},
            },
            "calling": {
                "duration_seconds": 19,
                "callee_count": 1,
                "calls": [
                    {
                        "hangup_type": "ByAgent",
                        "call_start_time": "2026-01-01T00:00:00Z",
                        "call_end_time": "2026-01-01T00:00:19Z",
                    }
                ],
            },
        }
