"""The two guards that stand between a bearer key and the wrong host, and between a
typo and a stranger's phone.

Both of these were found in review rather than by me, and both were real:

  - `--base-url` was an operator-supplied string, and the CALL-E bearer key was sent to
    whatever it named. A default is a suggestion; anything able to influence that value
    redirected a live credential and the request still looked ordinary.
  - The E.164 pattern was written `{6,14}`, which admits a seven-digit destination. The
    comment directly above it said "8-15 digits total", so the code and its own
    documentation disagreed, and the code was the wrong one.

Neither had a test. They do now.
"""
import pytest

from leash import supervisor
from leash.supervisor import Supervisor, UntrustedOrigin


KEY = "iams_live_not_a_real_key"


# --------------------------------------------------------------------------------------
# the key goes to exactly one place
# --------------------------------------------------------------------------------------

def test_the_official_origin_is_accepted():
    assert Supervisor(KEY).base_url == supervisor.CALLE_ORIGIN
    assert Supervisor(KEY, base_url=supervisor.CALLE_ORIGIN + "/").base_url == supervisor.CALLE_ORIGIN


@pytest.mark.parametrize(
    "hostile",
    [
        "https://api.heycall-e.com.evil.test",   # suffix that reads as the real host
        "https://evil.test/api.heycall-e.com",   # real host in the path, not the origin
        "https://api-heycall-e.com",             # hyphen for a dot
        "http://api.heycall-e.com",              # right host, downgraded to plaintext
        "https://attacker.example",
        "https://user:pw@evil.test",
        "ftp://api.heycall-e.com",
        "not-a-url",
    ],
)
def test_the_key_is_never_sent_to_another_origin(hostile):
    with pytest.raises(UntrustedOrigin):
        Supervisor(KEY, base_url=hostile)


@pytest.mark.parametrize("empty", ["", None])
def test_an_empty_base_url_falls_back_to_the_official_origin(empty):
    """Deliberate, and worth pinning because the alternative is arguable.

    An empty value usually means a caller's variable did not resolve. Raising would
    surface that bug louder, but the fallback direction here is the safe one: the key
    goes to CALL-E and nowhere else. A silent fallback to the *official* origin cannot
    leak a credential; only a fallback to an attacker-supplied one could, and that is
    what the test above forbids.
    """
    assert Supervisor(KEY, base_url=empty).base_url == supervisor.CALLE_ORIGIN


def test_loopback_is_refused_unless_explicitly_requested():
    """The fake server is the only caller that may ask for this, and it carries a
    placeholder key. Everything else must fail construction."""
    with pytest.raises(UntrustedOrigin):
        Supervisor(KEY, base_url="http://127.0.0.1:8080")


@pytest.mark.parametrize("local", ["http://127.0.0.1:53219", "http://localhost:9", "http://[::1]:80"])
def test_loopback_is_accepted_when_explicitly_requested(local):
    assert Supervisor("placeholder", base_url=local, allow_loopback=True).base_url == local.rstrip("/")


def test_loopback_permission_does_not_open_the_door_to_remote_hosts():
    """allow_loopback must widen the allowlist by exactly loopback, and nothing else."""
    with pytest.raises(UntrustedOrigin):
        Supervisor(KEY, base_url="http://evil.test", allow_loopback=True)
    with pytest.raises(UntrustedOrigin):
        Supervisor(KEY, base_url="https://127.0.0.1.evil.test", allow_loopback=True)


def test_the_key_never_appears_in_the_repr():
    assert KEY not in repr(Supervisor(KEY))
    assert "redacted" in repr(Supervisor(KEY))


# --------------------------------------------------------------------------------------
# the phone floor
# --------------------------------------------------------------------------------------

@pytest.mark.parametrize(
    "number",
    [
        "+1234567",        # seven digits: what the old {6,14} pattern let through
        "+123456",
        "+1",              # the deliberate pre-flight sentinel
        "+0123456789",     # E.164 forbids a leading zero on the country code
        "+1234567890123456",  # sixteen digits, one past the standard's maximum
        "1234567890",      # no plus
        "+44 7700 900123",  # spaces
        "+44-7700-900123",  # hyphens
        "",
    ],
)
def test_a_number_that_is_not_strict_e164_is_rejected(number):
    assert supervisor._E164.match(number) is None


@pytest.mark.parametrize(
    "number",
    [
        "+12345678",           # the floor: eight digits
        "+447700900123",    # Ofcom drama range, reserved for fiction
        "+15555550142",        # reserved-for-fiction US number
        "+123456789012345",    # the ceiling: fifteen digits
    ],
)
def test_a_strict_e164_number_is_accepted(number):
    assert supervisor._E164.match(number) is not None


def test_the_pattern_agrees_with_the_comment_above_it():
    """The original defect was not the bound itself but that the code and the sentence
    describing it disagreed. Eight to fifteen digits, inclusive, and nothing else."""
    for digits in range(1, 20):
        candidate = "+1" + "2" * (digits - 1)
        expected = 8 <= digits <= 15
        assert bool(supervisor._E164.match(candidate)) is expected, candidate
