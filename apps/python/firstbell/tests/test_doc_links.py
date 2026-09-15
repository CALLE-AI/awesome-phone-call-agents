"""A citation on the published site has to lead somewhere a reader can read.

The documents on the evidence site are committed markdown rendered at build time,
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


def test_a_citation_to_a_file_that_is_not_there_stops_the_build():
    """The link this build would have published, and now refuses to.

    `relink` decided between a `tree` and a `blob` URL by asking whether the target was a
    directory, and never asked whether it existed. A document citing a path nobody had
    written got a well-formed forge URL that 404s for as long as the page is up, and the
    only check on the way out was checking the shape of the URL rather than the existence
    of the thing it names. This entry's whole argument about its own citations is that
    they resolve, so the build stops instead.
    """
    import pytest
    with pytest.raises(SystemExit) as caught:
        doc_pages.relink(
            '<p><a href="docs/a-file-nobody-wrote.md"><code>nope</code></a></p>',
            "docs/the-legal-surface.md", FORGE)
    said = str(caught.value)
    assert "is not in the tree" in said
    assert "docs/a-file-nobody-wrote.md" in said
    assert "will never exist" in said, (
        "the refusal has to say what the consequence was, or the next person reads it as "
        "a strictness they can turn off")


def test_the_same_link_is_refused_even_with_no_forge_to_point_at():
    """The no-forge ending keeps the text, and a missing file is still missing.

    Falling through to plain text on a path that does not exist would be the quiet
    version of the same defect: the page would look fine and the citation would be to
    nothing at all.
    """
    import pytest
    with pytest.raises(SystemExit):
        doc_pages.relink(
            '<p><a href="../evidence/not-a-file.json"><code>nope</code></a></p>',
            "docs/the-legal-surface.md", None)


def test_a_link_to_a_file_that_is_there_still_becomes_a_forge_url():
    """The refusal must not have swallowed the ordinary case."""
    markup = doc_pages.relink(
        '<p><a href="../evidence/MUTATIONS.md"><code>ok</code></a></p>',
        "docs/the-legal-surface.md", FORGE)
    assert f'{FORGE}/blob/HEAD/apps/python/firstbell/evidence/MUTATIONS.md' in markup


# --- what a document's own shape survives on the way to a page -----------------------------
#
# A citation that resolves is half of it. The other half is that the document arrives
# looking like the document, and for four of these files it did not: their tables went out
# as paragraphs of pipe characters, because the renderer was built on commonmark and
# commonmark has no tables. `what-a-pilot-would-look-like` opened its Shape section with
# eleven rows of "| Scale | Two schools in one district. |" set as running prose, on the
# page the money card sends a reader to, and every gate in this repository passed: the page
# answered 200, its contrast held, its links resolved, its word count was high. Nothing had
# ever compared the shape of a document against the shape of the page made from it.


def rendered(path):
    """One committed document as the build renders it."""
    return doc_pages._render_markdown((doc_pages.APP / path).read_text(encoding="utf-8"))


def test_a_table_in_a_document_arrives_on_the_page_as_a_table():
    """Over the committed documents rather than a fixture, because a fixture would pass.

    The defect was not in the renderer's handling of a table. It was that nothing asked
    for one. A pipe row that reaches a reader inside a `<p>` is the whole failure, and it
    is visible in the built markup without a browser.
    """
    pipes, missing = [], []
    for _slug, path, _title, _why in doc_pages.PUBLISHED:
        body = rendered(path)
        for para in re.findall(r"<p>(.*?)</p>", body, re.S):
            if re.search(r"^[ ]*[|]", para, re.M):
                pipes.append(f"{path}: {para.strip()[:60]}")
        source = (doc_pages.APP / path).read_text(encoding="utf-8")
        if re.search(r"^[|]", source, re.M) and "<table" not in body:
            missing.append(path)
    assert not pipes, "a table reached the page as prose: " + "; ".join(pipes)
    assert not missing, (
        "these documents have table rows and rendered none: " + ", ".join(missing))


def test_every_cell_in_a_table_carries_the_name_of_its_column():
    """The label a stacked row prints on a telephone, written at build time.

    These pages carry no script and a stylesheet cannot read a header cell, so a four
    column table at 390px either stacks with each cell naming its own column or breaks
    inside the words. `FORMA / T` and `firstb / ell` was the second one.
    """
    body = doc_pages._render_markdown("""
| Format | Recognised by |
|---|---|
| `firstbell` | `id` and `phones` |
""")
    assert '<td role=cell data-label="Format"><code>firstbell</code></td>' in body
    assert '<td role=cell data-label="Recognised by">' in body
    # The roles go on with the labels, because the stylesheet that stacks these rows takes
    # the implicit ones off: `display: block` on a row is not a row to a screen reader.
    assert "<table role=table>" in body
    assert "<th scope=col role=columnheader>Format</th>" in body

    # And over the committed documents, where the shape is not a fixture's. A column with
    # a name in the header must carry that name on every one of its cells, because the
    # stacked row prints it and a cell that lost it prints a value with nothing saying
    # what it is. A column with no name in the header has none to print.
    wrong = []
    for _slug, path, _title, _why in doc_pages.PUBLISHED:
        for table in re.findall(r"<table[^>]*>(.*?)</table>", rendered(path), re.S):
            heads = [re.sub(r"<[^>]+>", "", head).strip()
                     for head in re.findall(r"<th(?![a-z])[^>]*>(.*?)</th>", table, re.S)]
            for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S):
                cells = re.findall(r"<td( [^>]*)?>", row)
                for index, cell in enumerate(cells):
                    named = index < len(heads) and bool(heads[index])
                    if named and f'data-label="{heads[index]}"' not in (cell or ""):
                        wrong.append(f"{path} column {index + 1} lost its name")
                    if not named and index == 0 and "data-term" not in (cell or ""):
                        wrong.append(f"{path} column 1 is not marked as the row's term")
    assert not wrong, "; ".join(sorted(set(wrong)))


def test_a_header_of_empty_cells_comes_off_and_the_first_column_becomes_a_term():
    """`| | |` is how a document writes a table with no header, and it is not one.

    Left alone it prints a rule and a band of nothing above the first term. The marker on
    the cell is what tells the stylesheet that the first column names the row rather than
    holding a value, so the header coming off and the marker going on are one change and
    not two. `the-money-in-full` needs both halves at once: it names its second and third
    columns and leaves the first blank, so its header stays and its first column is still
    a term.
    """
    body = doc_pages._render_markdown("""
| | |
|---|---|
| Scale | Two schools in one district |
""")
    assert "<thead" not in body
    assert "<td role=cell data-term>Scale</td>" in body
    assert "<td role=cell>Two schools in one district</td>" in body

    kept = doc_pages._render_markdown("""
| Role | Owns |
|---|---|
| Officer | The exclusion list |
""")
    assert "<thead" in kept and "data-term>" not in kept
    assert '<td role=cell data-label="Role">Officer</td>' in kept

    mixed = doc_pages._render_markdown("""
| | Net-new per 100 answered calls |
|---|---|
| Measured on the calls that rang | 0 |
""")
    assert "<thead" in mixed
    assert "<td role=cell data-term>Measured on the calls that rang</td>" in mixed
    assert '<td role=cell data-label="Net-new per 100 answered calls">0</td>' in mixed


def test_a_tag_no_style_was_written_for_stops_the_build():
    """The allowlist was a comment describing a check nobody had written.

    A set named ALLOWED sat in this module with nothing reading it, which reads exactly
    like a gate and is not one: any tag markdown-it cared to emit would have gone onto a
    public page unstyled. A thematic break is the cheapest proof, because commonmark emits
    `<hr>` for one and no document here has ever contained one.
    """
    with pytest.raises(SystemExit) as stopped:
        doc_pages._render_markdown("""
one paragraph

---

another paragraph
""")
    assert "hr" in str(stopped.value)
    assert "ALLOWED" in str(stopped.value)


def test_every_document_under_docs_is_published_or_withheld_with_a_reason():
    """Silence is the failure this catches.

    `docs/district-ingest.md` and `docs/consent-record.md` were cited by name from a page
    that could not reach them, for as long as both existed, and nothing recorded whether
    that was a decision. The list stays a list: a document is published, or it is named
    with the reason it is not.
    """
    published = {path for _slug, path, _title, _why in doc_pages.PUBLISHED}
    orphans = [
        md.name for md in sorted(doc_pages.DOCS.glob("*.md"))
        if f"docs/{md.name}" not in published
        and not doc_pages.WITHHELD.get(f"docs/{md.name}", "").strip()
    ]
    assert not orphans, (
        "these documents are in docs/ and are on no page and in no withheld register: "
        + ", ".join(orphans))
