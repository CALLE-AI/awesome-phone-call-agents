"""No escaped markup and no raw entity survives into the page's own prose.

Act 07 shipped `&lt;code&gt;python -m firstbell --work-file examples/absences-oneroster.csv&lt;/code&gt;`
to a reader, on the section the page labels read this one first, and it shipped it for days.
The cause was one wrong helper: the loop that renders the limits list escaped its strings with
`esc`, and two of those strings carry commands a reader is meant to run. It now uses
`esc_code`, which escapes first and then promotes backticks, so the data holds no markup at
all and nothing raw can get through.

`tests/test_markup_escaping.py` did not see it. That file is about injection, which is the
other half of the same subject: it proves a hostile value cannot escape its attribute. This
one proves an honest value did not get escaped twice. Both directions matter and neither
implies the other.

Written as a rule about the built page rather than about the builder, because the builder has
several escaping paths and a reader meets only the result. A gate anchored on one function
would have to be remembered every time another is added.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
PAGE = APP / "out" / "index.html"

# Tags the page really does render, so seeing them escaped means somebody escaped twice.
TAGS = ("code", "a", "strong", "em", "p", "li", "ul", "div", "dt", "dd", "span", "h2", "h3")

# Inside these, escaped markup is the whole point: the page quotes its own source and its own
# ledger rows, and a `<code>` shown as text there is a deliberate example rather than a defect.
QUOTING = re.compile(r"<pre\b.*?</pre>|<script\b.*?</script>|<style\b.*?</style>", re.S | re.I)


def _page() -> str:
    if not PAGE.exists():
        pytest.skip("no built page; run tools/judge_page.py with --receipts first")
    return PAGE.read_text(encoding="utf-8", errors="replace")


def _prose() -> str:
    """The page with the regions that legitimately quote markup taken out."""
    return QUOTING.sub(" ", _page())


def test_no_tag_the_page_renders_also_appears_escaped_in_its_prose():
    """`&lt;code&gt;` in prose is a command a reader cannot copy and cannot run."""
    body = _prose()
    found = []
    for tag in TAGS:
        for pattern in (f"&lt;{tag}&gt;", f"&lt;/{tag}&gt;"):
            if pattern in body:
                where = body.index(pattern)
                found.append(f"{pattern} near: "
                             + re.sub(r"\s+", " ", body[max(0, where - 60):where + 60]))
    assert not found, (
        "these render as literal angle brackets instead of as markup, which means a string "
        "carrying markup went through an escaper that escapes everything. `esc_code` escapes "
        "and then promotes backticks, which is the way to carry a command in prose:\n  "
        + "\n  ".join(found))


def test_no_html_entity_survives_as_text():
    """`&amp;#8217;` is an apostrophe a reader sees the machinery of.

    Caught in the same act and by the same cause: a typographic entity written into a string
    that was then escaped, so the ampersand became an entity and the entity became text.
    """
    body = _prose()
    doubled = re.findall(r"&amp;(?:#\d+|#x[0-9a-fA-F]+|[a-z]{2,10});", body)
    assert not doubled, (
        "these entities were escaped after they were written, so a reader sees the entity "
        f"rather than the character: {sorted(set(doubled))}. Write the character itself, or "
        "let the escaper produce the entity, but never both")


def test_the_commands_act_07_names_are_real_markup_and_runnable_shape():
    """The two commands in the limits list, which are the ones this gate was written for.

    Checked for being markup rather than text, and for still looking like commands after the
    fix, because a fix that rendered `<code></code>` around nothing would pass the rule above.
    """
    body = _page()
    commands = re.findall(r"<code>(python[^<]*)</code>", body)
    assert commands, "no python command renders as code on this page at all"

    wanted = ("python -m firstbell --work-file examples/absences-oneroster.csv",
              "python tools/adopt_call_records.py")
    for one in wanted:
        assert any(one in found for found in commands), (
            f"{one!r} is not on the page as real markup. Act 07 tells a reader to run it, so "
            f"it has to be copyable. What is there: {commands}")

    # And the file each command names has to exist, because a command in a code tag looks
    # exactly as authoritative whether or not it can run.
    for found in commands:
        for token in found.split():
            if token.startswith("examples/") or token.startswith("tools/"):
                assert (APP / token).is_file(), (
                    f"the page tells a reader to run {found!r} and {token} is not in the "
                    "repository")


def test_no_markdown_emphasis_reaches_the_page_as_punctuation():
    """`**Needs the built page.**` was on the page twenty-six times, asterisks included.

    Found while fixing act 07, by the same reading: the mutation table is lifted out of
    `evidence/MUTATIONS.md`, and `esc_code` was written to promote the backticks in that
    file and nothing else. Its own docstring gives the reason it should have covered this
    too, that rendering markdown literally puts a row of stray punctuation on the page for
    every mutation. Twenty-six rows carried the marker and every one of them showed it.

    The rule is about the page rather than about the marker, because the next thing lifted
    out of a markdown file will carry whichever syntax its author reached for.

    Not one asterisk, rather than no pair of them. The first version of this gate matched
    `**...**` and `*...*`, and a mutation walked through it: with the bold pass removed and
    the italic pass left in, `**Needs the built page.**` renders as
    `*<em>Needs the built page.</em>*`, which is neither shape. It measured zero on a page
    carrying twenty-six stray asterisks. The page's prose holds none at all when the
    renderer is right, so that is what this asks, and it covers every partial promotion
    including the ones nobody has written yet. Style and script blocks are cut out above,
    which is where the CSS reset's own asterisks live.
    """
    body = _prose()
    stray = [re.sub(r"\s+", " ", body[max(0, m.start() - 50):m.start() + 50])
             for m in re.finditer(r"\*", body)]
    assert not stray, (
        f"{len(stray)} asterisk(s) reached the page. Markdown lifted out of a source file "
        "went through an escaper that does not know that syntax, or knows only part of "
        "it:\n  " + "\n  ".join(sorted(set(stray))[:6]))


def test_the_limits_data_carries_no_markup_of_its_own():
    """The source half of the same rule, and the half that stops it coming back.

    The gates above are about the built page, which a clean checkout does not have. This one
    reads the builder, so it runs everywhere and it names the actual mistake: markup written
    into a string that an escaper is going to see.
    """
    source = (APP / "tools" / "judge_page.py").read_text(encoding="utf-8")
    start = source.index("    limits = [")
    end = source.index("    for limit, closes in limits:")
    block = source[start:end]
    stray = re.findall(r"</?(?:code|strong|em|a|span)\b[^>]*>|&#\d+;", block)
    assert not stray, (
        f"the limits data carries markup: {sorted(set(stray))}. It is escaped on the way out, "
        "so markup here becomes visible angle brackets on the page. Use backticks for a "
        "command; `esc_code` turns those into real code tags")
    assert "`" in block, (
        "no backtick left in the limits data, so either the commands have gone or somebody "
        "put the markup back another way")
    assert html.unescape(block) == block, (
        "the limits data holds an escaped sequence, which will be escaped again on the way "
        "to the page")


def test_every_table_on_the_page_is_named_and_every_header_says_which_way_it_runs():
    """Five tables, and until this was written not one of them had a name.

    A reader using a screen reader meets tables by name, and these were announced as
    "table" five times over: the identifiers, the pairs, the compliance rows and the two
    mutation tables. The headers had no `scope`, which browsers infer inside a `thead` and
    stop inferring the moment a stylesheet turns rows into blocks, which is what the
    narrow layout does here.

    The caption is visually hidden rather than printed, because every one of these tables
    already has a sentence above it doing that job for a reader who can see it.
    """
    markup = _page()
    tables = re.findall(r"<table\b[^>]*>", markup)
    assert tables, "the page renders no tables at all, which is not a state it has ever had"

    named = re.findall(r"<table\b[^>]*>\s*<caption", markup)
    assert len(named) == len(tables), (
        f"{len(tables)} tables and {len(named)} captions: a table with no caption is "
        "announced by its size and nothing else")

    heads = re.findall(r"<th\b[^>]*>", markup)
    assert heads, "the page renders no header cells"
    unscoped = [head for head in heads if "scope=" not in head]
    assert not unscoped, (
        f"{len(unscoped)} of {len(heads)} header cells do not say which way they run: "
        + ", ".join(sorted(set(unscoped))[:3]))
