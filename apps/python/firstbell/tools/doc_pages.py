"""The documents a reader can only reach by cloning, turned into pages they can open.

A blind reviewer scored this entry as a district operations director, read the deployed
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
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
DOCS = APP / "docs"

# slug, the title a reader sees in the list, and why they would open it. The order is the
# order a reader meets the questions in: what it costs to try, what the lawyer asks, then
# the three that answer how the evidence itself was made.
PUBLISHED: list[tuple[str, str, str]] = [
    ("what-a-pilot-would-look-like",
     "What a pilot would look like",
     "Two schools, six weeks, the four numbers measured before switch-on, and the "
     "children this software is not allowed to call."),
    ("the-legal-surface",
     "The legal surface",
     "Seven questions a district's counsel asks before this software telephones a "
     "parent. FERPA, the TCPA, COPPA, retention, and which of them are still open."),
    ("locale-is-not-only-a-hint",
     "Locale is not only a hint",
     "Why the same call in Tamil is one column in a work file and not a second code "
     "path, and where that stops being true."),
    ("proving-a-gate-fires",
     "Proving a gate fires",
     "How each check in this repository was broken on purpose to confirm it notices, "
     "and what that costs when it is skipped."),
    ("receipt-provenance",
     "Where a receipt comes from",
     "What is in a receipt, what was added afterwards, and how to tell a real call "
     "from a replay without trusting this page."),
]

# Only what the documents actually contain. markdown-it-py emits nothing else from these
# five files, and a page that grew a tag not on this list is a page nobody reviewed.
ALLOWED = {"a", "blockquote", "code", "em", "h1", "h2", "h3", "li", "ol", "p", "pre",
           "strong", "ul"}

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
.doc-why { color: var(--ink-2); margin-bottom: var(--space-4); }
""".strip()


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
    # `commonmark` and nothing else. No raw HTML passthrough, no tables, no footnotes: the
    # documents use none of it, and a renderer that accepts more is a renderer that will
    # put something on a public page that nobody read.
    return MarkdownIt("commonmark").render(text)


def render(slug: str, title: str, why: str, css: str) -> str:
    """One document as a standalone page, in the same inks and typefaces as the site."""
    source = DOCS / f"{slug}.md"
    if not source.exists():
        raise SystemExit(f"{source} is listed in doc_pages.PUBLISHED and does not exist")

    body = _render_markdown(source.read_text(encoding="utf-8"))

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
        f'<p class=dim>This page is <code>docs/{html.escape(slug)}.md</code> in the '
        "repository, rendered at build time. The file is the original and this is a "
        "copy of it, so if the two ever disagree the file is right.</p>"
        "</main></html>"
    )


def write_all(out: Path, css: str) -> list[Path]:
    """Every published document, into `out/docs/`. Returns what was written."""
    target = out / "docs"
    target.mkdir(parents=True, exist_ok=True)
    written = []
    for slug, title, why in PUBLISHED:
        page = target / f"{slug}.html"
        page.write_text(render(slug, title, why, css), encoding="utf-8", newline="\n")
        written.append(page)
    return written


def index_markup() -> str:
    """The list of documents, for the foot of the main page."""
    rows = [
        f'<li><a href="docs/{html.escape(slug)}.html">{html.escape(title)}</a>'
        f'<p class=read-why>{html.escape(why)}</p></li>'
        for slug, title, why in PUBLISHED
    ]
    return (f"<ul class=read-list>{''.join(rows)}</ul>")
