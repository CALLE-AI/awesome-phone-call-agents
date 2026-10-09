"""A value the page drops inside an HTML attribute has to be escaped on the way in.

`player.js` builds the transcript in the browser and `judge_page.py` builds the same markup
at build time, so one string has two writers. Only one of them was careful. The client-side
one put `this.call.locale` straight into `lang="..."`, so a locale carrying a double quote
would have closed the attribute and opened whatever followed it. Nothing in this suite
noticed for as long as the bug existed, because nothing in this suite read that file.

This is a source check and not a browser test, so it cannot say the page is safe. What it
says is narrower and worth having: the one shape that went wrong cannot come back unseen. A
value concatenated into an attribute without going through the escaper fails here, and so
does an escaper that has quietly stopped escaping the quote, which would leave the first
check passing while it protected nothing.
"""
from __future__ import annotations

import re
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "tools" / "site"

# `attr="' + value + '` inside a single-quoted JavaScript string: the value lands between the
# quotes of an HTML attribute. The capture is everything up to the next `+`, which is the
# expression producing it.
ATTRIBUTE_CONCAT = re.compile(r"""[a-zA-Z-]+="'\s*\+\s*([^+]+?)\s*\+""")

# The same hole spelled as a template literal, `attr="${value}"`. There is none in the tree
# today. It is here because the refactor from one form to the other is the ordinary way a
# check like this stops covering the thing it was written for.
ATTRIBUTE_TEMPLATE = re.compile(r"""[a-zA-Z-]+="\$\{([^}]+)\}""")


def test_every_value_put_into_an_attribute_by_a_site_script_is_escaped():
    """The defect, stated as the rule it broke."""
    checked = 0

    for path in sorted(SITE.glob("*.js")):
        source = path.read_text(encoding="utf-8")
        for pattern in (ATTRIBUTE_CONCAT, ATTRIBUTE_TEMPLATE):
            for match in pattern.finditer(source):
                expression = match.group(1).strip()
                checked += 1
                assert expression.startswith("esc("), (
                    f"{path.name} puts `{expression}` inside an HTML attribute without "
                    "escaping it; a value with a double quote in it closes the attribute"
                )

    assert checked, (
        "no site script builds an attribute in either form this gate can read, so it "
        "measured nothing; the markup moved and this check has to move with it"
    )


def test_the_escaper_the_other_check_trusts_still_escapes_the_quote():
    """A guard that trusts a helper is worth what the helper does, not what it is called.

    Narrowing `esc` to the three angle-and-ampersand characters would leave every assertion
    above passing and put the attribute break straight back.
    """
    source = (SITE / "player.js").read_text(encoding="utf-8")

    definition = re.search(r"const esc = .*", source)
    assert definition, "esc has been renamed or moved, so this check is reading nothing"

    escaped = re.search(r"replace\(/\[([^\]]+)\]/g", definition.group(0))
    assert escaped, f"esc no longer replaces a character class: {definition.group(0)}"

    for character in ("&", "<", ">", '"'):
        assert character in escaped.group(1), (
            f"esc has stopped escaping {character!r}, which the attribute check above "
            "assumes it does"
        )

    table = re.search(r"const AMP = \{(.+?)\};", source)
    assert table, "the replacement table has moved, so this check is reading nothing"
    for character in ("&", "<", ">", '"'):
        assert f"'{character}'" in table.group(1), (
            f"esc matches {character!r} but has no replacement for it, so it would "
            "substitute undefined into the markup"
        )
