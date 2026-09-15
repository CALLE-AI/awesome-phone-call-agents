"""Where the production credential is allowed to go, and where it is not.

`CALLE_BASE_URL` exists so the shipped `CalleClient` can speak real HTTP to the bundled
double. That is how this project runs offline, and it is how a reviewer exercises it
without spending credits. The same variable is the reason a live key can leave the
building: a machine that has just placed a real call still has `CALLE_API_KEY` exported,
and the next command that points the base URL somewhere else hands the key to whatever is
listening there.

Two separate failures are locked here, because they fail in different directions.

The first is disclosure: the key must not be sent to an untrusted origin at all. The
second is bookkeeping: the origin check that decides whether a run counts as `live` used
to compare hostnames, so `http://api.heycall-e.com` answered yes. That run puts the bearer
token on the wire in plaintext, and it would have been written into a receipt as an
ordinary live call, which is the one place a reader trusts without checking.
"""

from __future__ import annotations

import pytest

from firstbell.cli import (
    LIVE_KEY_PREFIX,
    PRODUCTION_HOST,
    TRUSTED_ORIGIN,
    RunMode,
    _origin,
    main,
)

WORK = "examples/absences.csv"
LIVE_KEY = LIVE_KEY_PREFIX + "SENTINELdeadbeef0123456789"


def _run_live(monkeypatch, *, key: str, base_url: str | None):
    monkeypatch.setenv("CALLE_API_KEY", key)
    if base_url is None:
        monkeypatch.delenv("CALLE_BASE_URL", raising=False)
    else:
        monkeypatch.setenv("CALLE_BASE_URL", base_url)
    return main(["--work-file", WORK, "--live", "--yes-i-mean-it", "--limit", "1"])


# ---------------------------------------------------------------------------
# Disclosure: the key goes to one origin and nowhere else.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("elsewhere", [
    "http://127.0.0.1:8787",              # the bundled double, run as a real server
    "https://api.heycall-e.com.evil.test",  # a suffix that a hostname check would miss
    "http://api.heycall-e.com",           # the right host, the wrong scheme
    "https://staging.heycall-e.com",      # same company, still not the trusted origin
])
def test_a_live_key_is_refused_to_every_origin_but_the_trusted_one(monkeypatch, elsewhere):
    with pytest.raises(SystemExit) as caught:
        _run_live(monkeypatch, key=LIVE_KEY, base_url=elsewhere)

    message = str(caught.value)
    assert "Refusing to send a live CALL-E key" in message
    assert elsewhere in message, "the refusal has to name the destination it refused"
    assert TRUSTED_ORIGIN in message, "and the one destination that would be allowed"
    # The refusal must not quote the credential back at whoever is reading the terminal.
    assert LIVE_KEY not in message


def test_the_refusal_names_the_throwaway_key_the_double_documents(monkeypatch):
    """A guard that only says no teaches nothing.

    The double's own start-up banner already tells the operator to export
    `iams_test_anything`. Before this guard that was advice; the refusal is where it
    becomes the instruction, so the next thing the reader types is the correct thing.
    """
    with pytest.raises(SystemExit) as caught:
        _run_live(monkeypatch, key=LIVE_KEY, base_url="http://127.0.0.1:8787")
    assert "iams_test_anything" in str(caught.value)


def test_a_throwaway_key_may_go_to_the_double(monkeypatch, capsys):
    """The guard is about the credential, not about the destination.

    Refusing every non-production base URL would break the offline path this repository
    is built on and the no-credit path a reviewer needs, so what is locked here is that a
    key which is not a production key is still allowed to leave.

    Port 1 has nothing on it, so the run cannot succeed and this test does not pretend to
    care whether it does. The assertion is about which failure happens: reaching the
    transport means the client was built and allowed to try, and the credential refusal
    means it never got that far. Only the second one is a regression.

    The first draft of this test asserted that the run raised. It does not: a connection
    that dies before an answer is a call whose outcome is unknown, and this app is built
    to record that rather than to crash on it. The test was wrong about the code, so the
    test changed.
    """
    exit_code = _run_live(monkeypatch, key="iams_test_anything", base_url="http://127.0.0.1:1")
    printed = capsys.readouterr().out

    assert isinstance(exit_code, int), "the guard raised SystemExit on a throwaway key"
    assert "Refusing to send a live CALL-E key" not in printed, (
        "a throwaway key was stopped by the credential guard, which only exists to stop "
        "production keys; the offline and no-credit reviewer paths both run this way"
    )
    # Proof it got past the guard and all the way to the socket, rather than being
    # allowed through and then stopped by something else on the way.
    assert "CalleConnectionError" in printed


def test_the_guard_does_not_stand_between_a_live_key_and_production(monkeypatch):
    """The other half of the branch.

    Without this, deleting the origin comparison and refusing everything would still pass
    the tests above, and the entry would ship a tool that can never place a real call.
    """
    import firstbell.cli as cli

    seen: dict[str, object] = {}

    class _Recording:
        def __init__(self, **kwargs):
            seen.update(kwargs)
            raise RuntimeError("stop here: construction is the thing under test")

    monkeypatch.setattr(cli, "CalleClient", _Recording, raising=False)
    monkeypatch.setitem(
        __import__("sys").modules, "calle",
        type("m", (), {"CalleClient": _Recording})(),
    )
    with pytest.raises(RuntimeError, match="stop here"):
        _run_live(monkeypatch, key=LIVE_KEY, base_url=None)

    assert seen["base_url"] == TRUSTED_ORIGIN
    assert seen["api_key"] == LIVE_KEY


# ---------------------------------------------------------------------------
# Bookkeeping: what a receipt is allowed to call `live`.
# ---------------------------------------------------------------------------

def test_a_plaintext_downgrade_is_not_a_live_run():
    downgraded = RunMode(live=True, base_url=f"http://{PRODUCTION_HOST}")
    assert downgraded.reached_production is False
    assert downgraded.label == "live-nonproduction"
    assert "No phone will ring" in downgraded.banner()


@pytest.mark.parametrize("equivalent", [
    TRUSTED_ORIGIN,
    TRUSTED_ORIGIN + "/",
    f"https://{PRODUCTION_HOST}:443",
    f"HTTPS://{PRODUCTION_HOST.upper()}",
])
def test_urls_that_mean_the_trusted_origin_are_read_as_it(equivalent):
    """An explicit :443, a trailing slash and a shouted scheme are the same place.

    Compared as raw strings these are four different values, and a run against any of
    them would have been filed as non-production: a true live call recorded as though it
    had reached a double. The normalisation is what makes the comparison safe to make on
    the whole origin rather than on the hostname alone.
    """
    assert _origin(equivalent) == TRUSTED_ORIGIN
    assert RunMode(live=True, base_url=equivalent).reached_production is True


@pytest.mark.parametrize("nonsense", [None, "", "not-a-url", "api.heycall-e.com", "://x"])
def test_an_unparseable_base_url_is_never_the_trusted_origin(nonsense):
    """Fail closed on garbage.

    `urlparse` answers rather than raising for almost anything, so a bare hostname with no
    scheme parses to an empty host and an empty scheme. Anything this function cannot
    resolve to both a scheme and a host is not an origin, and is certainly not the trusted
    one.
    """
    assert _origin(nonsense) == ""
    assert _origin(nonsense) != TRUSTED_ORIGIN


# Assembled from parts rather than written out. Written whole, the first of these is the exact
# shape `test_no_committed_file_carries_anything_shaped_like_a_key` scans every tracked file
# for, and this file would need adding to an exemption to hold it. The last time a file was
# exempted so it could hold the shape it describes, three real identifiers moved in behind the
# exemption. A concatenation costs nothing and keeps the scanner pointed at this file too.
_TAIL = "SENTINELdeadbeef0123456789"

@pytest.mark.parametrize("key, why", [
    ("iams_" + "prod_" + _TAIL, "a production prefix this code has never seen"),
    ("sk_" + "live_" + _TAIL, "a key issued in another vendor's format"),
    ("eyJhbGciOiJIUzI1NiJ9." + _TAIL, "a bare token with no recognised prefix"),
    (_TAIL, "no prefix and no structure"),
])
def test_a_key_this_code_does_not_recognise_is_treated_as_a_real_one(monkeypatch, key, why):
    """The guard used to name the danger. Naming the danger only stops the danger you named.

    Its first version refused a key beginning `iams_live_` and sent everything else, so its
    protection lasted exactly as long as that one format. A key issued under a different
    prefix, an older one, or no prefix, all went to whatever host `CALLE_BASE_URL` happened
    to name, which is the variable that exists so this can be pointed at a double.

    It is an allowlist now. Leaving for anywhere but production takes a key that says it is a
    throwaway, and everything else is assumed to be somebody's real credential. Each of the
    four below reaches the network under the old rule and is refused under this one.
    """
    with pytest.raises(SystemExit) as caught:
        _run_live(monkeypatch, key=key, base_url="http://127.0.0.1:1")

    message = str(caught.value)
    assert "Refusing to send a live CALL-E key" in message, (
        f"{why} was sent to an origin that is not production"
    )
    assert key not in message, "the refusal prints the credential it is protecting"
