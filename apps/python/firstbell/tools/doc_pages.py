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

# slug, the title a reader sees in the list, and why they would open it. The order is the
# order a reader meets the questions in: what it costs to try, what the lawyer asks, then
# the three that answer how the evidence itself was made.
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
    ("the-legal-surface",
     "docs/the-legal-surface.md",
     "The legal surface",
     "Seven questions a district's counsel asks before this software telephones a "
     "parent. FERPA, the TCPA, COPPA, retention, and which of them are still open."),
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
     "eleven recorded production responses. Two ways to mount it, and the three things "
     "about it that are not true."),
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

    Three endings, and the third is the one worth arguing about. A link to another
    published document becomes that page. A link to a file in the tree becomes the file on
    the forge, if the build was told where the tree is. A link to a file in the tree with
    no forge known stops being a link and keeps its text, because every link text in these
    documents is already the path in backticks: a reader loses a click and learns the same
    thing, where inventing a URL would send them somewhere that does not exist.
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
    # `commonmark` and nothing else. No raw HTML passthrough, no tables, no footnotes: the
    # documents use none of it, and a renderer that accepts more is a renderer that will
    # put something on a public page that nobody read.
    return MarkdownIt("commonmark").render(text)


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
