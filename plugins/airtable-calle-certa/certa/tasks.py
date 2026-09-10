"""The words CALL-E is given, and the things it is told not to do.

The task text is the product's whole surface to the person who answers. They
did not apply for anything, did not ask to be called, and owe the caller
nothing. So the text discloses first, asks only what consent covers, and treats
a refusal as a finished call rather than an obstacle.

`TASK_SPEC_VERSION` is part of the consent token. Editing anything in this
module that changes what is said must bump it, which invalidates every consent
gathered under the previous wording. That is the mechanism, not a convention:
consent to be asked three questions is not consent to be asked a fourth.

Each entry in `PROHIBITIONS` is asserted present by `tests/test_tasks.py`, so
a prohibition cannot be quietly dropped from the text during an edit.
"""

from __future__ import annotations

from .types import ConsentedEmployerContact

# Bump on any change to the spoken content below. See module docstring.
TASK_SPEC_VERSION = "voe-employer-v1"

# The only three facts this workflow may collect.
PERMITTED_QUESTIONS = (
    "whether the person is currently employed there",
    "their job title",
    "their start date or length of service",
)

PROHIBITIONS = (
    "Do not ask about salary, pay, compensation, bonuses or any financial detail.",
    "Do not ask for an opinion about the person, their performance, their conduct "
    "or their character.",
    "Do not ask about anything other than employment status, job title, and start "
    "date or length of service.",
    "Do not argue, pressure, persuade, or repeat a request after someone has "
    "declined. A refusal ends the call.",
    "Do not offer or request expedited, priority or special handling.",
    "Do not leave the applicant's name or any detail of this request on a "
    "voicemail, an answering machine, or with a person who will not identify "
    "their role.",
    "Do not state or imply that the person is obliged to answer.",
    "Do not give legal, financial, immigration or employment advice.",
)


class TaskError(Exception):
    """A task could not be built for this contact."""


def build_task(contact: ConsentedEmployerContact, *, requester_name: str) -> str:
    """Render the natural-language task for one consented employer contact.

    `requester_name` is the organisation on whose behalf the call is made. It is
    disclosed on the call because a verification call from an unnamed party is
    indistinguishable from a pretexting attempt.
    """
    if not requester_name.strip():
        raise TaskError(
            "requester_name is required: an undisclosed caller asking about an "
            "employee is a pretexting call, not a verification"
        )
    if not contact.applicant_name.strip():
        raise TaskError(
            f"{contact.request_id}: the applicant's name is required, because "
            "employment cannot be verified without naming the person"
        )

    questions = "\n".join(f"  - {q}" for q in PERMITTED_QUESTIONS)
    prohibitions = "\n".join(f"  - {p}" for p in PROHIBITIONS)

    return f"""\
Call {contact.employer_name} to verify employment for a named person.

Say this first, before asking anything, as soon as a person is on the line:
that this is an automated employment verification call on behalf of \
{requester_name}, regarding {contact.applicant_name}, who has given written \
consent for this contact; and ask whether they are the right person to confirm \
employment details.

Ask to reach human resources, payroll, or the office that handles employment
verifications. If an automated menu answers, choose the option for human
resources, employment verification, or payroll, and use the keypad where the
menu requires it.

Establish only these three facts about {contact.applicant_name}:
{questions}

Read back what you heard once, to confirm you recorded it correctly.

Do not:
{prohibitions}

If the person declines to confirm anything, or asks you to submit the request
in writing, thank them and end the call. A refusal is a complete and acceptable
outcome of this call, not a failure to work around.

If you do not reach a person who can speak to employment records, end the call
without leaving details, and report that the employer was not reached."""


def prohibitions_present(task: str) -> list[str]:
    """Return any prohibition missing from a rendered task. Empty means all present.

    Compared on whitespace-collapsed text, so re-wrapping the paragraph cannot
    silently drop a prohibition past this check.
    """
    flat_task = " ".join(task.split())
    return [p for p in PROHIBITIONS if " ".join(p.split()) not in flat_task]
