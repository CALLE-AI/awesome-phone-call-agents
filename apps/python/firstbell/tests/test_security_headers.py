"""The policy the page is served with is checked against the page it governs.

`tools/gates/csp-check.mjs` opens the built page in Chrome under these exact headers and
reports what the browser refused. That catches a policy that is too narrow, which is the
failure a reader sees. It cannot catch a policy that is too wide: a header granting an
origin the page stopped using, or falling back to `'unsafe-inline'`, refuses nothing and
passes a browser check while granting more than the page needs. Those are the ones here.

Both halves matter and neither replaces the other. A policy that agrees with the page and
refuses nothing can still be a policy that permits everything.

These read `out/vercel.json`, which the build writes beside the page, so they skip on a
checkout where the page has not been built. That skip is declared in
`GATES_THAT_CANNOT_ALWAYS_RUN`.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
PAGE = APP / "out" / "index.html"
CONFIG = APP / "out" / "vercel.json"

# Every header the deployment is supposed to set. Named here rather than counted, because a
# count would go on passing while the wrong seven were present.
REQUIRED_HEADERS = {
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "X-Frame-Options",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
}


def _headers() -> dict[str, str]:
    if not CONFIG.exists() or not PAGE.exists():
        pytest.skip("no built page and policy; run tools/judge_page.py with --receipts first")
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    rules = config["headers"]
    assert len(rules) == 1, (
        f"the config carries {len(rules)} header rules; these gates read the first one and "
        "would silently stop covering the rest"
    )
    assert rules[0]["source"] == "/(.*)", (
        f"the header rule matches {rules[0]['source']!r}, so some paths under out/ are "
        "served with no policy at all"
    )
    return {h["key"]: h["value"] for h in rules[0]["headers"]}


def _page() -> str:
    """The built page, or the same skip `_headers` would have taken.

    Three tests read `PAGE` as their first statement, so on a fresh clone they raised
    `FileNotFoundError` instead of skipping, and the suite reported five failures where the
    README promises two skips. The guard existed and was in `_headers`, which those three
    reached only afterwards. Measured on a clean `git clone`: 5 failed, 313 passed.
    """
    if not PAGE.exists():
        pytest.skip("no built page; run tools/judge_page.py with --receipts first")
    return PAGE.read_text(encoding="utf-8")


def _directives() -> dict[str, list[str]]:
    policy = _headers()["Content-Security-Policy"]
    out: dict[str, list[str]] = {}
    for chunk in policy.split(";"):
        parts = chunk.split()
        if parts:
            out[parts[0]] = parts[1:]
    return out


def test_every_header_the_deployment_promises_is_in_the_config():
    """The header set is named, not counted.

    Vercel sends what this file says and nothing else, so a header dropped here is a header
    the deployment stops sending, silently and with no other symptom.
    """
    present = set(_headers())
    missing = REQUIRED_HEADERS - present
    assert not missing, f"the deployment would send no {', '.join(sorted(missing))}"


def test_the_policy_closes_what_the_page_never_does():
    """Directives set to 'none' are the load-bearing half of this policy.

    An allowlist is only as good as its base. Without `default-src 'none'` every directive
    not written down falls back to permitting nothing named, and CSP's default for an
    unlisted directive is to allow. The page places no network call, submits no form and is
    never framed, so these say so.
    """
    directives = _directives()
    for name in ("default-src", "connect-src", "object-src", "form-action",
                 "frame-ancestors", "base-uri"):
        assert directives.get(name) == ["'none'"], (
            f"{name} is {directives.get(name)}, not closed; the page does not use it, so "
            "there is nothing to trade for opening it"
        )


def test_the_policy_never_falls_back_to_permitting_everything():
    """The three ways a Content-Security-Policy quietly stops being one.

    `'unsafe-inline'` in script-src makes every hash beside it decorative, since a browser
    that sees both ignores the inline keyword only in the presence of a hash or nonce for
    scripts, and honours it for styles. A bare `*`, or `http:`, grants an origin nobody
    chose. Each of these passes a browser check without a murmur, which is exactly why a
    browser check is not the only gate here.
    """
    policy = _headers()["Content-Security-Policy"]
    assert "'unsafe-inline'" not in policy, (
        "the policy permits arbitrary inline code, which makes every hash in it decorative"
    )
    assert "http://" not in policy, "the policy names a plaintext origin"
    for name, sources in _directives().items():
        assert "*" not in sources, f"{name} permits any origin at all"
        assert not any(s.endswith(":") and s not in ("data:",) for s in sources), (
            f"{name} permits a whole scheme: {sources}"
        )
    assert "data:" not in " ".join(_directives().get("script-src", [])), (
        "script-src permits data: URLs, which is a way to run code the page never contained"
    )


def test_the_policy_names_no_origin_the_page_does_not_reach():
    """A granted origin the page stopped using is a grant nobody is watching.

    Third-party origins move: a font host changes, a CDN is dropped, and the allowance for
    it stays behind because nothing breaks when it does. Every origin in the policy has to
    still appear in the page that policy governs.
    """
    page = _page()
    granted = {s for sources in _directives().values() for s in sources
               if s.startswith("https://")}
    assert granted, "the policy grants no origin at all, which no longer matches this page"

    orphans = [origin for origin in sorted(granted) if origin not in page]
    assert not orphans, (
        "the policy grants " + ", ".join(orphans) + ", which the built page never mentions; "
        "an origin outliving its use is an allowance nobody is watching"
    )


def test_every_inline_block_in_the_page_is_covered_by_a_hash():
    """The hashes are recomputed here from the page, not read back from the policy.

    The build derives the policy from the page, so the two agree by construction. That is
    worth nothing on its own: a build that hashed the wrong bytes would produce a policy
    that agrees perfectly with its own mistake. This reads the shipped page independently
    and checks the digests it computes are the digests being granted.
    """
    page = _page()
    style_src = " ".join(_directives().get("style-src", []))
    script_src = " ".join(_directives().get("script-src", []))

    blocks = re.findall(r"<style\b[^>]*>(.*?)</style>", page, re.S)
    assert blocks, "the page carries no inline stylesheet, so this gate is checking nothing"
    for block in blocks:
        digest = base64.b64encode(hashlib.sha256(block.encode("utf-8")).digest()).decode()
        assert f"'sha256-{digest}'" in style_src, (
            f"a {len(block)} byte inline stylesheet has no matching hash in style-src, so "
            "the browser will refuse it and the page will render unstyled"
        )

    handlers = [b for _, _, b in re.findall(r"""\son([a-z]+)=(["'])(.*?)\2""", page, re.S)]
    for handler in handlers:
        digest = base64.b64encode(hashlib.sha256(handler.encode("utf-8")).digest()).decode()
        assert f"'sha256-{digest}'" in script_src, (
            f"the inline handler {handler!r} has no matching hash in script-src"
        )
    if handlers:
        assert "'unsafe-hashes'" in script_src, (
            "the page carries an inline event handler and script-src has no 'unsafe-hashes', "
            "so its hash cannot match in an attribute position and the handler is refused"
        )


def test_the_only_inline_handler_is_the_one_that_loads_the_fonts():
    """`'unsafe-hashes'` is a concession, so what it buys is written down and checked.

    The keyword lets a hash match in an attribute position. It grants nothing by itself, but
    it widens where a hash counts, and a second handler arriving would be granted the same
    way with nobody deciding to. There is one, it flips a print stylesheet to all once the
    fonts land, and it is the reason the page paints on fallbacks instead of blanking.
    """
    page = _page()
    handlers = [(n, b) for n, _, b in re.findall(r"""\son([a-z]+)=(["'])(.*?)\2""", page, re.S)]
    assert handlers == [("load", "this.media='all'")], (
        f"the page's inline handlers are {handlers}, which is not the single font-loading "
        "handler this policy was written around"
    )


def test_every_page_the_deployment_serves_is_covered_by_the_one_policy():
    """`/(.*)` means every page, and until a security pass ran, it meant one.

    The rule above reads `index.html`. The build now emits five document pages beside it,
    each carrying a small stylesheet `index.html` does not have, and the header is set on
    `/(.*)` rather than on `/index.html`. A policy derived from the first page is correct
    for the first page and refuses the styles on the other five, which is a reader getting
    the legal surface as unstyled text.

    Nothing had broken when this was written. The point is that nothing was watching: the
    gate that would have caught it was scoped to one file, and the whole argument here is
    that a claim without the thing that checks it is worth nothing.
    """
    # No skip of its own. `_directives` reads the policy through `_headers`, which is the
    # one place in this file that decides whether there is a built page to check, and the
    # register in test_claims.py records that reason once for the whole file.
    style_src = " ".join(_directives().get("style-src", []))
    script_src = " ".join(_directives().get("script-src", []))

    out = APP / "out"
    pages = sorted(out.rglob("*.html"))
    assert len(pages) > 1, (
        "the build emitted one page. If the document pages were dropped on purpose, this "
        "gate should be changed deliberately rather than left passing on a smaller site."
    )

    for page in pages:
        markup = page.read_text(encoding="utf-8")
        where = page.relative_to(out).as_posix()

        for block in re.findall(r"<style\b[^>]*>(.*?)</style>", markup, re.S):
            digest = base64.b64encode(hashlib.sha256(block.encode("utf-8")).digest()).decode()
            assert f"'sha256-{digest}'" in style_src, (
                f"{where} carries a {len(block)} byte inline stylesheet with no hash in "
                f"style-src, so a reader gets that page unstyled"
            )

        for _, value in re.findall(r"""\sstyle=(["'])(.*?)\1""", markup, re.S):
            digest = base64.b64encode(hashlib.sha256(value.encode("utf-8")).digest()).decode()
            assert f"'sha256-{digest}'" in style_src, (
                f"{where} carries the style attribute {value!r} with no matching hash"
            )

        for _, _, handler in re.findall(r"""\son([a-z]+)=(["'])(.*?)\2""", markup, re.S):
            digest = base64.b64encode(
                hashlib.sha256(handler.encode("utf-8")).digest()).decode()
            assert f"'sha256-{digest}'" in script_src, (
                f"{where} carries the inline handler {handler!r} with no matching hash"
            )

        # A document page runs nothing. The policy would refuse an unhashed script anyway,
        # and a refused script is a page that half works rather than one that says why.
        if where.startswith("docs/"):
            assert "<script" not in markup, (
                f"{where} carries a script tag. Document pages are rendered markdown and "
                f"have nothing to run."
            )
