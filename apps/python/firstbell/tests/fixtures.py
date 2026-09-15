"""Phone numbers used in tests. All fictional, none ever dialled.

The submission repository's PR checklist requires: "Phone numbers are masked in
documentation and test fixtures unless they are clearly fictional." So every number in
the test suite is drawn from a block that cannot be assigned to a real subscriber.

  * `+1 555 01xx` is reserved for fictional use in the North American Numbering Plan.
  * `+91 555 ...` uses a leading digit that is not allocated to Indian mobile or landline
    subscribers, whose national numbers begin 6 to 9 for mobile. It still carries the +91
    country code, so it exercises the India and Tamil resolution paths.

Nothing here reaches the network in any case: the tests run against `calle_double`, which
dials nobody. The numbers are fictional so that the diff is clean, not because the tests
would otherwise place a call.
"""

# India, for locale and fallback-chain tests. Not assignable to a subscriber.
IN_A = "+915550000001"
IN_B = "+915550000002"
IN_C = "+915550000003"
IN_D = "+915550000004"
IN_FALLBACK = "+915550000009"

# Australia and Sri Lanka, for language and prefix-resolution tests.
AU = "+61455500000"
LK = "+94555000000"

# Not in the supported-region table at all, for unsupported_region tests.
UNSUPPORTED = "+99912345678"


def india(n: int) -> str:
    """A fictional Indian number, stable for a given n."""
    return f"+91555{n:07d}"


def nanp(n: int) -> str:
    """A number from the NANP block reserved for fiction, +1 555 01xx."""
    if not 0 <= n <= 99:
        raise ValueError("the fictional NANP block is 555-0100 to 555-0199")
    return f"+1555{100 + n:04d}"
