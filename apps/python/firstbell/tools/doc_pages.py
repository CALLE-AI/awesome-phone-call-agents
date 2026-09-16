"""The documents a reader can only reach by cloning, turned into pages they can open.

Somebody came to this entry as a district operations director, read the deployed
page, and wrote: `docs/the-legal-surface.md` "answers the seven questions my counsel asks
[...] It is the document that decides whether I pilot. It is linked from nowhere a buyer
goes. I grepped the deployed HTML: FERPA 0 hits, TCPA 0, COPPA 0". They were right. The
deployed site had twenty-three links and every one was an anchor into itself.

These pages exist so that a reader who will not clone a repository can still read the parts
of it that decide whether the software is usable in a school. Nothing here is written for
the site: each page is one committed markdown file rendered, so the version a reader opens
and the version in the tree cannot drift.

The set is a list rather than a glob. A document that lands in `docs/` should not appear on
a public site because somebody saved a file there.
"""
from __future__ import annotations

import html
import json
import posixpath
import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
DOCS = APP / "docs"

# Where this application sits inside the repository. A link in a committed document is
# written for the tree, so resolving one means knowing that `../evidence/MUTATIONS.md`
# from `docs/` is this path plus `evidence/MUTATIONS.md` and not a path on a web server.
APP_IN_REPO = "apps/python/firstbell"
REPO = APP.parents[2]
if REPO / APP_IN_REPO != APP:  # pragma: no cover - a moved application, caught at build
    raise SystemExit(
        f"doc_pages expects this app at {APP_IN_REPO} inside the repository and found it "
        f"at {APP}. Every link in every published document resolves through that path, so "
        "the constant has to move with the directory.")

# How many recorded production responses the offline CALL-E is checked against, read out
# of the record that does the checking. This card typed "eleven" while the page it links to
# says 11 one screen down and `evidence/api-shape.json` counts them, which is three places
# for one number and only one of them able to notice a twelfth response arriving. Nothing is
# printed when the record cannot be read: a card that has lost its evidence should describe
# the checking rather than quantify it.
_SHAPE = APP / "evidence" / "api-shape.json"
try:
    RESPONSES_COMPARED: int | str = int(
        json.loads(_SHAPE.read_text(encoding="utf-8"))["responses_compared"])
except (OSError, ValueError, TypeError, KeyError):  # pragma: no cover - a missing record
    RESPONSES_COMPARED = "the"


# slug, the title a reader sees in the list, and why they would open it. The order is the
# order a reader meets the questions in: what it costs to try, what it costs to feed,
# what counsel asks and the record that answers counsel, then the four that say how the
# evidence itself was made.
# Four fields: the slug the page is served under, the file it is rendered from relative
# to the app root, the title, and the one line saying why a reader should open it. The
# path is spelled out rather than derived from the slug, because the most reusable piece
# of this entry documents itself next to its own code and copying it into docs/ would
# make two documents that drift.
PUBLISHED: list[tuple[str, str, str, str]] = [
    ("what-a-pilot-would-look-like",
     "docs/what-a-pilot-would-look-like.md",
     "What a pilot would look like",
     "Two schools, six weeks, the four numbers measured before switch-on, and the "
     "children this software is not allowed to call."),
    ("the-money-in-full",
     "docs/the-money-in-full.md",
     "The money, in full",
     "Why the headline figure is a ceiling and not a saving, what the safeguarding rule "
     "costs at the grade it lands on, and the rate above which this software costs a "
     "district money."),
    ("district-ingest",
     "docs/district-ingest.md",
     "The file your district already exports",
     "OneRoster, Clever or a header nobody here has seen, read without editing it. The "
     "two columns no export carries, what filling them costs, and why three children in "
     "one house are one telephone call."),
    ("the-legal-surface",
     "docs/the-legal-surface.md",
     "The legal surface",
     "Seven questions a district's counsel asks before this software telephones a "
     "parent. FERPA, the TCPA, retention, and which four of them are still open."),
    ("consent-record",
     "docs/consent-record.md",
     "The consent record",
     "A column that says yes is not a record of permission. The shape of one, the eight "
     "checks a call passes before a telephone rings, and the three decisions that stay "
     "with the district."),
    ("locale-is-not-only-a-hint",
     "docs/locale-is-not-only-a-hint.md",
     "Locale is not only a hint",
     "Why the same call in Tamil is one column in a work file and not a second code "
     "path, and where that stops being true."),
    ("proving-a-gate-fires",
     "docs/proving-a-gate-fires.md",
     "Proving a gate fires",
     "How each check in this repository was broken on purpose to confirm it notices, "
     "and what that costs when it is skipped."),
    ("receipt-provenance",
     "docs/receipt-provenance.md",
     "Where a receipt comes from",
     "What is in a receipt, what was added afterwards, and how to tell a real call "
     "from a replay without trusting this page."),
    ("the-offline-calle",
     "calle_double/README.md",
     "The offline CALL-E, and how to take it",
     "A CALL-E that dials nobody, written from the published API and checked against "
     f"{RESPONSES_COMPARED} recorded production responses. Two ways to mount it, and the "
     "three things about it that are not true."),
]

# A document under `docs/` that is deliberately not on the site, and the reason. The list
# above is a list rather than a glob on purpose, and the price of that is silence: two
# documents a district reviewer needs, the export format and the consent record, sat
# unpublished for as long as they existed while the legal surface cited both by name, and
# nothing anywhere recorded whether that was a decision or an oversight. It was an
# oversight. Empty is the right state today, and an entry here is a decision somebody
# wrote down rather than a file nobody noticed.
WITHHELD: dict[str, str] = {}


# Only what the documents actually contain, and a page that grew a tag not on this list
# is a page nobody reviewed. The set sat here for as long as this file existed with
# nothing reading it: a comment describing a check reads exactly like a check, and the
# renderer would have published any tag markdown-it cared to emit. `_render_markdown`
# now refuses one.
ALLOWED = {"a", "blockquote", "code", "em", "h1", "h2", "h3", "li", "ol", "p", "pre",
           "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"}

# One block, small on purpose. Everything else a document is set in comes from page.css,
# byte for byte the same stylesheet the main page carries, so the two are one publication
# rather than a site and its appendix.
DOC_CSS = """
.doc { max-width: 44rem; margin: 0 auto; padding: var(--space-5) var(--space-4); }
.doc h1 { margin-bottom: var(--space-3); }
.doc h2 { margin-top: var(--space-4); }
.doc pre { overflow-x: auto; }
/* A filename or a citation set in code is one unbreakable token, and at 390px one
 * of them in `receipt-provenance` set the paragraph's minimum width and pushed the
 * whole document seven pixels past the viewport. `anywhere` breaks it only when it
 * will not fit alone, which is the case this is for. */
.doc code { overflow-wrap: anywhere; }
.doc blockquote { margin: 0 0 1.1rem; padding-left: var(--space-3);
                  border-left: 2px solid var(--line); color: var(--ink-2); }
.doc-back { display: block; margin-bottom: var(--space-4); }
/* Tables come from page.css and are set exactly as the ones on the main page. What is
 * true only here is that they sit in a prose column, so they take the paragraph's bottom
 * margin: without it the sentence underneath starts on the last rule. A table whose first
 * column is a term rather than a value sets that column in the label face, because the
 * header that would have said so is the one this build takes off. */
.doc table { margin: 0 0 1.1rem; }
.doc td[data-term] {
  font-family: var(--ui); font-size: var(--size-2); font-weight: 600;
  /* A floor rather than a width. The auto layout gives this column whatever the prose
   * column does not want, which was 86px in the pilot document: `Who is not called` came
   * out on three lines beside a paragraph on three, and the longest one-line term in
   * these documents needs 112px. A fixed 9rem then held the money table to three lines a
   * row where its two number columns had 300px they were not using. A floor fixes the
   * first case and lets the second have the room. */
  min-width: 9rem;
}

/* Under 38rem there is no table. A four-column table in a prose column has 85px a
 * column at 390px, which is narrower than `guardian_phone`, and the two ways out of that
 * are both worse than stacking: breaking inside the words prints `FORMA / T` and
 * `firstb / ell`, and a scroll container hides half the columns behind a gesture with
 * nothing on the page to say so. So each row becomes a block and each cell prints the
 * name of its column in front of itself, which is what the main page does with call
 * identifiers under the same pressure. The label is `data-label`, written into the
 * markup at build time, because these pages carry no script and a stylesheet cannot read
 * a header cell.
 *
 * The names are not lost to a screen reader: `content` on a pseudo-element is announced,
 * and it is the same string the header carried. */
@media (max-width: 38rem) {
  .doc thead { display: none; }
  .doc table, .doc tbody, .doc tr, .doc td { display: block; }
  .doc tr { border-top: 1px solid var(--line-strong); padding: 0.5rem 0; }
  .doc tbody tr:first-child { border-top: 0; }
  .doc td { padding: 0.2rem 0; border-bottom: 0; }
  .doc td[data-label]::before {
    content: attr(data-label); display: block;
    font-family: var(--ui); font-size: var(--size-0); letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--ink-3);
  }
  /* A term has no column name to print, because it is the name of the row. Stacked, it
   * is the heading of the block rather than a cell beside one, and the width that kept it
   * on one line beside a paragraph has no paragraph to sit beside. */
  .doc td[data-term] { width: auto; margin-bottom: 0.15rem; }
}
.doc-why { color: var(--ink-2); margin-bottom: var(--space-4); }
""".strip()


# markdown-it emits exactly this shape and nothing nests inside an anchor in these
# documents, so one pattern reaches every link on every page.
_LINK = re.compile(r'<a href="([^"]+)">(.*?)</a>', re.S)


def _repo_path(doc_path: str, href: str) -> str:
    """A link written for the tree, resolved to a path from the repository root."""
    here = posixpath.dirname(f"{APP_IN_REPO}/{doc_path}")
    resolved = posixpath.normpath(posixpath.join(here, href))
    if resolved.startswith(".."):
        raise SystemExit(
            f"{doc_path} links to {href!r}, which leaves the repository. A published page "
            "cannot carry a link to a file nobody reading it has.")
    return resolved


def relink(body: str, doc_path: str, repo_url: str | None, ref: str = "HEAD") -> str:
    """Every repository link in a rendered document, pointed at something a reader can open.

    These documents are committed markdown first and pages second, so their links are
    written for the tree: `receipt-provenance.md` beside them, `../evidence/MUTATIONS.md`
    above them. Served unchanged, all eight of them were 404s on the deployment, which is
    the same defect that put these documents on a site in the first place, one level down.
    A judge following a citation out of the legal surface got an error page.

    Four endings, and the fourth was missing. A link to another published document
    becomes that page. A link to a file in the tree becomes the file on the forge, if the
    build was told where the tree is. A link to a file in the tree with no forge known
    stops being a link and keeps its text, because every link text in these documents is
    already the path in backticks: a reader loses a click and learns the same thing, where
    inventing a URL would send them somewhere that does not exist.

    And a link to a file that is not in the tree stops the build. That ending was absent,
    which meant a citation to a path nobody had written produced a well-formed forge URL
    that will 404 for as long as the page is up. The `tree` or `blob` decision asked
    whether the target was a directory and never asked whether it was there, so the one
    check on the way out was checking the shape of the URL rather than the existence of
    the thing it names. A page whose entire argument is that its citations resolve cannot
    publish one that does not, and refusing at build time is the only ending that a reader
    never has to discover.
    """
    def one(match: re.Match[str]) -> str:
        href, text = match.group(1), match.group(2)
        if href.startswith(("http://", "https://", "mailto:", "#")):
            return match.group(0)
        anchor = ""
        if "#" in href:
            href, fragment = href.split("#", 1)
            anchor = "#" + fragment
        target = _repo_path(doc_path, href)
        for slug, path, _title, _why in PUBLISHED:
            if f"{APP_IN_REPO}/{path}" == target:
                return f'<a href="{slug}.html{anchor}">{text}</a>'
        if not (REPO / target).exists():
            raise SystemExit(
                f"{doc_path} links {href!r}, which resolves to {target} and is not in the "
                "tree.\n"
                "A forge URL was being built for it, which is a well-formed link to a "
                "page that will never exist.\n"
                "Fix the link in the document, or add the file, before publishing."
            )
        if repo_url:
            kind = "tree" if (REPO / target).is_dir() else "blob"
            base = repo_url.rstrip("/")
            return f'<a href="{base}/{kind}/{ref}/{target}{anchor}">{text}</a>'
        return text

    return _LINK.sub(one, body)


def _render_markdown(text: str) -> str:
    """One committed document as HTML, or a refusal that says what to install.

    Rendered rather than retyped, and rendered at build time rather than committed, so a
    correction to the markdown reaches the deployed page on the next build. The import is
    local and the error is explicit: a page builder that quietly produced a site with no
    documents on it would be the same failure the reviewer found, arrived at a second way.
    """
    try:
        from markdown_it import MarkdownIt
    except ImportError:  # pragma: no cover - exercised by the message, not by the suite
        raise SystemExit(
            "markdown-it-py is needed to publish docs/ as pages and is not installed.\n"
            "  pip install -r requirements-dev.txt\n"
            "It is a dev dependency: running firstbell itself does not need it."
        )
    # `commonmark` and tables, and nothing else. No raw HTML passthrough, no footnotes:
    # the documents use neither, and a renderer that accepts more is a renderer that will
    # put something on a public page that nobody read.
    #
    # Tables are on because six of these documents contain them and the renderer did not.
    # The pipes went out as prose: the pilot document opened its Shape section with a
    # paragraph reading "| | | |---|---| | Scale | Two schools in one district." and on for
    # eleven rows, on the page the money card sends a reader to. It answered 200, its
    # contrast passed, its links resolved, and every check in this repository agreed,
    # because not one of them had ever compared the shape of a document against the shape
    # of the page made from it.
    body = MarkdownIt("commonmark").enable("table").render(text)
    body = _shape_tables(body)
    unknown = sorted(set(re.findall("<([a-z0-9]+)[ >]", body)) - ALLOWED)
    if unknown:
        raise SystemExit(
            f"a published document rendered to {', '.join(unknown)}, which is not in "
            "doc_pages.ALLOWED.\n"
            "Either the document grew a construction nobody reviewed, or a renderer rule "
            "was turned on without deciding how the tag is set.\n"
            "Add it to ALLOWED with a style for it, or take it out of the document."
        )
    return body


def _shape_tables(body: str) -> str:
    """Every table given what it needs to survive a telephone screen.

    Two jobs, both of which happen before the markup is written, because these pages carry
    no script and a stylesheet cannot read a header cell.

    A header whose cells are all empty comes off. There is no way to write a table with no
    header row, so a document that wants a column of terms and a column of meanings writes
    `| | |` and gets two empty cells, which print as a rule and a band of nothing above the
    first term.

    And every body cell is told the name of its column. At 390px a four-column table has
    85px a column, which is narrower than `guardian_phone`. Breaking inside the word fits
    the viewport and prints `FORMA / T` and `firstb / ell`, which is not a table anybody
    can read. The stacked form the main page already uses for call identifiers needs each
    cell to carry its own label, and it is written here rather than in the document, so the
    markdown stays a table a person can edit.

    A column with no name in the header is the row's own term, not a value: `the-money-in-
    full` names its second and third columns and leaves the first blank, because the first
    is what the row is about. That cell is marked rather than labelled, and the marker is
    what the stylesheet sets in the label face and stacks first.
    """
    def label_cells(table: str, heads: list[str]) -> str:
        def row(match: re.Match[str]) -> str:
            column = iter(range(len(heads)))

            def cell(inner: re.Match[str]) -> str:
                index = next(column, None)
                if index is None:
                    return inner.group(0)
                name = heads[index]
                if name:
                    return f'<td data-label="{name}">{inner.group(1)}</td>'
                if index == 0:
                    return f"<td data-term>{inner.group(1)}</td>"
                return inner.group(0)

            return re.sub("<td>(.*?)</td>", cell, match.group(0), flags=re.S)

        return re.sub("<tr>(.*?)</tr>", row, table, flags=re.S)

    def announce(table: str) -> str:
        """The roles a table loses the moment a stylesheet makes it blocks.

        `display: block` on a row or a cell takes the implicit table role with it, so the
        stacked form under 38rem is a run of divs to a screen reader: no row, no column,
        no header association. The main page carries these attributes on the identifier
        table for exactly this reason and these pages had the same treatment without them.
        """
        for tag, role in (("<table>", "<table role=table>"),
                          ("<thead>", "<thead role=rowgroup>"),
                          ("<tbody>", "<tbody role=rowgroup>"),
                          ("<tr>", "<tr role=row>")):
            table = table.replace(tag, role)
        table = re.sub("<th>", "<th scope=col role=columnheader>", table)
        return re.sub("<td( |>)", r"<td role=cell" + chr(92) + "1", table)

    def one(match: re.Match[str]) -> str:
        table = match.group(0)
        # Inside the header row rather than across the table, because <th[^>]*> matches
        # <thead> as well and the first cell of an empty header then comes back as the
        # markup between them rather than as nothing.
        head = re.search("<thead>(.*?)</thead>", table, re.S)
        cells = re.findall("<th[^>]*>(.*?)</th>", head.group(1), re.S) if head else []
        if not cells:
            return announce(table)
        heads = [html.escape(html.unescape(re.sub("<[^>]+>", "", cell)).strip(), quote=True)
                 for cell in cells]
        if not any(heads):
            table = re.sub("<thead>(.*?)</thead>", "", table, flags=re.S)
        return announce(label_cells(table, heads))

    return re.sub("<table>(.*?)</table>", one, body, flags=re.S)


def render(slug: str, path: str, title: str, why: str, css: str,
           repo_url: str | None = None, ref: str = "HEAD") -> str:
    """One document as a standalone page, in the same inks and typefaces as the site."""
    source = APP / path
    if not source.exists():
        raise SystemExit(f"{source} is listed in doc_pages.PUBLISHED and does not exist")

    body = relink(_render_markdown(source.read_text(encoding="utf-8")), path, repo_url, ref)

    # The document already opens with its own h1. Two would be a page with two titles.
    heading = f"<h1>{html.escape(title)}</h1>"
    if body.lstrip().startswith("<h1>"):
        heading = body[body.index("<h1>"):body.index("</h1>") + 5]
        body = body[body.index("</h1>") + 5:]

    return (
        "<!doctype html><html lang=en>"
        "<meta charset=utf-8>"
        '<meta name=viewport content="width=device-width,initial-scale=1">'
        f"<title>{html.escape(title)}: firstbell</title>"
        f'<meta name=description content="{html.escape(why, quote=True)}">'
        '<link rel=icon href="data:,">'
        f"<style>{css}</style>"
        f"<style>{DOC_CSS}</style>"
        '<main class=doc>'
        '<a class=doc-back href="../index.html">Back to the evidence page</a>'
        f"{heading}"
        f'<p class=doc-why>{html.escape(why)}</p>'
        f"{body}"
        f'<p class=dim>This page is {_source_markup(path, repo_url, ref)} in the '
        "repository, rendered at build time. The file is the original and this is a "
        "copy of it, so if the two ever disagree the file is right.</p>"
        "</main></html>"
    )


def _source_markup(path: str, repo_url: str | None, ref: str) -> str:
    """The foot line naming the file, as a link to it when the build knows the tree."""
    name = f"<code>{html.escape(path)}</code>"
    if not repo_url:
        return name
    base = repo_url.rstrip("/")
    return f'<a href="{base}/blob/{ref}/{APP_IN_REPO}/{path}">{name}</a>'


def write_all(out: Path, css: str, repo_url: str | None = None,
              ref: str = "HEAD") -> list[Path]:
    """Every published document, into `out/docs/`. Returns what was written."""
    target = out / "docs"
    target.mkdir(parents=True, exist_ok=True)
    written = []
    for slug, path, title, why in PUBLISHED:
        page = target / f"{slug}.html"
        page.write_text(render(slug, path, title, why, css, repo_url, ref),
                        encoding="utf-8", newline="\n")
        written.append(page)
    return written


def index_markup() -> str:
    """The list of documents, for the foot of the main page."""
    rows = [
        f'<li><a href="docs/{html.escape(slug)}.html">{html.escape(title)}</a>'
        f'<p class=read-why>{html.escape(why)}</p></li>'
        for slug, _path, title, why in PUBLISHED
    ]
    return (f"<ul class=read-list>{''.join(rows)}</ul>")
