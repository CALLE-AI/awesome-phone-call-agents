"""Frozen call script, its slots, and the guards that keep both safe.

LEASH speaks to a human exactly once per lease, and this module is the only place
that decides what it says.

WHY THE TEMPLATE IS FROZEN
--------------------------
CALL-E screens task text at create time and can refuse to place the call at all
(HTTP 422). Two earlier drafts of this project were refused outright:

  1. A framing that described an in-progress hazard and positioned the call as the
     response to it. Refused: "revise the request so it is clearly non-emergency and
     does not rely on this call for urgent safety response."
  2. A draft that read a confirmation code aloud and asked the person to repeat it,
     and asked whether to keep or release an access credential. Refused: "I can't
     place a call that involves confirmation-code readback or decisions about keeping
     or releasing an access credential."

The wording below is the version that was accepted, and it was verified by two live
calls (see README, Live verification). The screen is undocumented and unversioned,
so any edit re-rolls it, and a refusal cannot be recovered from at run time. The
template is therefore pinned by SHA-256 in tests/test_templates.py.

Note what the call does NOT do, and why. It never mentions a credential, a token, or
a code. It asks one question about a background job. Revocation is this supervisor's
own response to "stop" -- it happens on our side of the wire, and CALL-E is never
asked to handle a credential.

POLARITY
--------
The call cannot grant anything. "continue" is not permission; it is the absence of a
release, and policy.py requires twelve conditions to hold before it is honoured.
"stop" requires one. So does silence, a machine answering, an unreadable result, or
this process dying. The words approve / authorise / sign-off never appear in this
package, in the task text, or in the schema -- if they ever do, the polarity has
leaked and the design has been misread.
"""
import hashlib
import re

#: SHA-256 of TASK_TEMPLATE, pinned in tests. Any edit breaks the build on purpose.
TASK_TEMPLATE_SHA256 = "4e971382408307404e8938186b01f2d50f98dac2abb56cee0eeade1c2b7dfce8"

#: Substitution slots. Every value is regex-validated before rendering, so no
#: caller-, agent-, or config-supplied free text can ever reach the task string.
SLOTS = {
    # Lowercase deliberately. On a live call the voice agent read the uppercase id
    # "LEASH-0001" out character by character -- "capitalized L, capitalized E,
    # capitalized A, capitalized S, capitalized H, dash, zero, zero, zero, one" --
    # which burned roughly twenty seconds at the top of the call. A lowercase
    # hyphenated name is spoken as words. The template itself is unchanged and its
    # hash still pins it; only the accepted shape of a slot VALUE is narrower here.
    "JOB_ID": r"^[a-z0-9][a-z0-9-]{3,11}$",
    "MINUTES": r"^[0-9]{1,3}$"
}

TASK_TEMPLATE = (
    "You are an automated voice assistant placing a routine software housekeeping call about a background job. This is a scheduled administrative call. There is no time pressure and this call is not about any person's situation. If this call does not connect, nothing changes and the job simply stays paused.\n"
    "\n"
    "Open with exactly these words: \"Hello, this is an automated assistant and this call is transcribed. I am calling about background job {JOB_ID}.\"\n"
    "\n"
    "Then say: \"The job has paused before its final step, and it has changed nothing so far. Its final step would rewrite the history of its own practice code repository, and that step cannot be undone afterwards. The job will stay paused for another {MINUTES} minutes.\"\n"
    "\n"
    "Then ask exactly this question and nothing else: \"Should the job continue, or should it stop?\"\n"
    "\n"
    "When they answer, repeat their choice back to them in one short sentence and ask them to confirm it is right. For example: \"So the job should stop. Is that correct?\" Ask this only once.\n"
    "\n"
    "Then ask: \"In one sentence, why?\"\n"
    "\n"
    "Then say: \"Thank you, that is all I needed. This call is finished.\" and end the call.\n"
    "\n"
    "Rules for you: The only two valid answers are \"continue\" and \"stop\". If the person says anything else, hesitates, or asks you to decide for them, do not press them and do not guess \u2014 move on to the next question. Do not offer opinions, advice or recommendations of any kind. If the person raises any topic other than this job, say you are not able to help with that and end the call politely. Do not ask for and do not accept any personal or account information of any kind. If a recording or an answering machine picks up, do not leave a message; end the call."
)

#: Registers that CALL-E's content screen has refused, plus the categories its Terms
#: of Service prohibit (emergency, safety-critical, critical infrastructure, high-risk
#: financial). Checked against the RENDERED string, not the template, so a slot value
#: can never smuggle one in.
BANNED = re.compile(
    r"emergency|urgent|immediate|alarm|danger|hazard|safety|unsafe|injur|trapped|distress|"
    r"duress|medical|patient|crisis|rescue|evacuat|incident|outage|on-call|critical|police|"
    r"ambulance|hospital|legal advice|payment|refund|transfer|invoice|credit card|"
    r"credential|verification code|confirmation code|access code|one.time code|OTP|"
    r"\bPIN\b|password|passcode|security code|read.back the (code|digits)",
    re.IGNORECASE,
)


class TaskRefused(ValueError):
    """Raised locally instead of letting a refusable task reach the API."""


def assert_task_is_clean(task: str) -> str:
    """Refuse to dial if the rendered task carries a refused register.

    This runs before every create. It is a local mirror of a remote policy we cannot
    see, so it is deliberately over-broad: a false positive costs a rename, a false
    negative costs a refused call with no run-time recovery.
    """
    hit = BANNED.search(task)
    if hit:
        raise TaskRefused(
            "refusing to dial: rendered task contains %r at offset %d"
            % (hit.group(0), hit.start())
        )
    return task


def render_task(job_id: str, minutes: str) -> str:
    """Render the frozen template. Rejects any slot value that is not exact-format."""
    values = {"JOB_ID": str(job_id), "MINUTES": str(minutes)}
    for name, pattern in SLOTS.items():
        if not re.fullmatch(pattern, values[name]):
            raise ValueError("slot %s=%r does not match %s" % (name, values[name], pattern))
    return assert_task_is_clean(TASK_TEMPLATE.format(**values))


def template_sha256() -> str:
    """Hash of the template as it exists in this checkout."""
    return hashlib.sha256(TASK_TEMPLATE.encode("utf-8")).hexdigest()
