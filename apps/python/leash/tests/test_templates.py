"""The call script is a frozen artifact. These tests are what make that mechanical.

CALL-E screens task text at create time and can refuse to place the call (HTTP 422).
Two earlier drafts of this project were refused. The wording that was accepted is
pinned here by hash, because the screen is undocumented, unversioned, and has no page
to watch -- an edit would only surface as a refusal, potentially while filming, with
no run-time recovery.

If you are reading this because the SHA test just failed: you changed the script the
platform accepted. Either revert, or re-verify against the live API with a real create
that reaches `queued` and update the pin in the same commit as the new evidence.
"""
import re

import pytest

from leash import templates


FROZEN_SHA256 = "4e971382408307404e8938186b01f2d50f98dac2abb56cee0eeade1c2b7dfce8"


def test_template_matches_the_wording_the_platform_accepted():
    assert templates.template_sha256() == FROZEN_SHA256
    assert templates.TASK_TEMPLATE_SHA256 == FROZEN_SHA256


def test_template_has_exactly_two_slots():
    """Guards against a slot creeping back in. An earlier draft had a third, {CODE},
    and it is precisely what got that draft refused."""
    assert set(templates.SLOTS) == {"JOB_ID", "MINUTES"}
    assert set(re.findall(r"\{(\w+)\}", templates.TASK_TEMPLATE)) == {"JOB_ID", "MINUTES"}


def test_rendered_task_carries_no_refused_register():
    assert templates.BANNED.search(templates.render_task("nightly-tidy", "12")) is None


@pytest.mark.parametrize(
    "job_id",
    ["ok", "way-too-long-for-slot", "LEASH-0001", "has space", "punct!", "", "-lead"],
)
def test_malformed_job_id_is_rejected_before_rendering(job_id):
    with pytest.raises(ValueError):
        templates.render_task(job_id, "12")


@pytest.mark.parametrize("minutes", ["-1", "12.5", "abcd", "", "1234"])
def test_malformed_minutes_is_rejected_before_rendering(minutes):
    with pytest.raises(ValueError):
        templates.render_task("nightly-tidy", minutes)


@pytest.mark.parametrize(
    "smuggled",
    [
        "otp-1234",       # one-time-code register
        "pin-0000",       # credential register
        "alarm-9",        # emergency register
    ],
)
def test_a_slot_value_cannot_smuggle_a_refused_word_into_the_task(smuggled):
    """The guard runs on the RENDERED string, not the template, so a well-formed slot
    value carrying a refused word is still caught."""
    with pytest.raises(templates.TaskRefused):
        templates.render_task(smuggled, "12")


def test_the_call_never_mentions_a_credential_or_a_secret():
    """The distinguishing design claim: containment happens on our side of the wire,
    and CALL-E is never asked to handle a credential. If this fails, that claim in the
    README has become false.

    Note "code repository" is fine and is in the script -- what must never appear is a
    credential, a secret, or a code the caller is asked to recite. Both refused drafts
    of this project died on exactly those.
    """
    task = templates.render_task("nightly-tidy", "12").lower()
    forbidden = (
        "credential", "token", "oauth", "password", "passcode",
        "confirmation code", "verification code", "access code", "one-time code",
        "revoke", "revocation",
    )
    for word in forbidden:
        assert word not in task, "the call script must never say %r" % word


def test_polarity_never_leaks_into_the_call_script():
    """'continue' is not approval. If an approval word appears in what we say aloud,
    the design has been misread -- and a reviewer will collapse this into an approval
    gate, which is the one thing it is not."""
    task = templates.render_task("nightly-tidy", "12").lower()
    for word in ("approve", "approval", "authorise", "authorize", "sign-off", "permission"):
        assert word not in task
