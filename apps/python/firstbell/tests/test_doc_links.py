"""A citation on the published site has to lead somewhere a reader can read.

The six documents on the evidence site are committed markdown rendered at build time,
which is the reason a reader opening the page and a reader opening the file cannot be
shown different text. It is also the reason their links were wrong: they are written for
the repository tree, so `receipt-provenance.md` sits beside the file and
`../evidence/MUTATIONS.md` sits one directory above it. Served unchanged, all eight of
those were 404s on the deployment. The gate suite opened every one of these pages and
never followed a link off one, so fifteen passing gates said nothing about it.

`tools/gates/run.mjs` now follows every link on every built page. This file covers the
part a browser cannot: what the rewriter does with a target that is not published, which
is the branch where a wrong answer would be a link to a URL nobody has.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP / "tools"))

import doc_pages  # noqa: E402

FORGE = "https://github.com/CALLE-AI/awesome-phone-call-agents"


def test_a_link_to_another_published_document_becomes_that_page():
    body = '<a href="receipt-provenance.md">where a receipt comes from</a>'
    assert doc_pages.relink(body, "docs/proving-a-gate-fires.md", None) == (
        '<a href="receipt-provenance.html">where a receipt comes from</a>')


def test_a_published_document_reached_from_outside_docs_still_resolves():
    """`calle_double/README.md` is published and does not live in `docs/`.

    The mapping is on the source path rather than the slug for exactly this: the offline
    CALL-E documents itself beside its own code, because copying it into `docs/` would
    make two documents that drift.
    """
    body = '<a href="../calle_double/README.md">the double</a>'
    assert 'href="the-offline-calle.html"' in doc_pages.relink(
        body, "docs/locale-is-not-only-a-hint.md", None)


def test_a_file_in_the_tree_becomes_the_file_on_the_forge_when_one_is_known():
    body = '<a href="../evidence/MUTATIONS.md"><code>../evidence/MUTATIONS.md</code></a>'
    out = doc_pages.relink(body, "docs/proving-a-gate-fires.md", FORGE)
    assert f'href="{FORGE}/blob/HEAD/apps/python/firstbell/evidence/MUTATIONS.md"' in out


def test_a_directory_in_the_tree_uses_the_forge_path_for_a_directory():
    """`blob` on a directory is a 404 on GitHub, which is the failure being fixed."""
    body = '<a href="../"><code>apps/python/firstbell</code></a>'
    out = doc_pages.relink(body, "calle_double/README.md", FORGE)
    assert f'href="{FORGE}/tree/HEAD/apps/python/firstbell"' in out


def test_a_file_in_the_tree_stops_being_a_link_when_no_forge_is_known():
    """The third ending, and the one worth arguing about.

    Guessing the URL would publish a link to a repository that may not exist yet, which
    is the failure this project keeps writing down: a surface that looks complete and is
    not. Every link text in these documents is already the path in backticks, so dropping
    the anchor costs a reader a click and tells them the same thing.
    """
    body = '<a href="../evidence/README.md"><code>../evidence/README.md</code></a>'
    out = doc_pages.relink(body, "docs/receipt-provenance.md", None)
    assert out == "<code>../evidence/README.md</code>"
    assert "href" not in out


def test_an_external_link_and_a_fragment_are_left_alone():
    body = ('<a href="https://www.fcc.gov/document/x">the order</a>'
            '<a href="#the-queue">the queue</a>')
    assert doc_pages.relink(body, "docs/the-legal-surface.md", FORGE) == body


def test_an_anchor_on_a_rewritten_link_survives():
    body = '<a href="receipt-provenance.md#what-is-added">what is added</a>'
    assert 'href="receipt-provenance.html#what-is-added"' in doc_pages.relink(
        body, "docs/proving-a-gate-fires.md", None)


def test_a_link_that_leaves_the_repository_is_refused_rather_than_published():
    with pytest.raises(SystemExit) as caught:
        doc_pages.relink('<a href="../../../../../secrets.md">x</a>',
                         "docs/receipt-provenance.md", FORGE)
    assert "leaves the repository" in str(caught.value)


def test_no_published_document_still_carries_a_link_written_for_the_tree():
    """The measurement, over the documents themselves rather than over a fixture.

    A relative href on a built page is either a page beside it or a 404, and this is the
    check that no seventh document arrives carrying the same eight defects. It runs with
    no forge known, which is the harder of the two: with one, every unresolved path
    quietly becomes a plausible URL.
    """
    offenders = []
    for slug, path, title, why in doc_pages.PUBLISHED:
        markup = doc_pages.render(slug, path, title, why, "", None)
        for href in re.findall(r'href="([^"]+)"', markup):
            if href.startswith(("http://", "https://", "mailto:", "data:", "#")):
                continue
            if href == "../index.html":  # the link back to the evidence page
                continue
            if href.endswith(".md") or "../" in href:
                offenders.append(f"{path} -> {href}")
    assert not offenders, (
        "these hrefs are written for the repository tree and would 404 on the "
        "deployment: " + "; ".join(offenders))


def test_the_foot_of_each_page_reaches_the_file_it_was_rendered_from():
    """With a forge known, the one link a reader wants from a rendered copy.

    Each page says it is a copy and the file is the original. Saying that without a way
    to reach the original is an instruction to clone the repository, which is the reader
    these pages exist for.
    """
    slug, path, title, why = doc_pages.PUBLISHED[0]
    markup = doc_pages.render(slug, path, title, why, "", FORGE)
    assert f'href="{FORGE}/blob/HEAD/apps/python/firstbell/{path}"' in markup
    plain = doc_pages.render(slug, path, title, why, "", None)
    assert FORGE not in plain and f"<code>{path}</code>" in plain
