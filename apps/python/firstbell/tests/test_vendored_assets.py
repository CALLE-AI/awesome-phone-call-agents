"""Third-party code that reaches a reader has to be declared, pinned and unchanged.

One file ships to the browser that nobody here wrote: the Lottie player that runs the figure
in act 03. It is vendored rather than loaded from a CDN, because this page derives its
Content-Security-Policy from its own bytes and a third origin in the request path of a page
about children is a dependency nobody here can revoke.

Vendoring moves the risk rather than removing it. A file in a repository can be edited, and a
minified library is the last place anybody would notice. So the manifest records the digest of
the exact bytes, and these tests fail if the file and the record disagree.

The escaping gate deliberately does not read this directory. That gate asks whether each
attribute write in an authored script is escaped, which is a question about code somebody here
wrote and can fix. Running the same regex over somebody else's compiled output produces a
finding nobody can act on, and an exemption list inside the gate would be the beginning of the
end of it. The structure answers instead: authored scripts sit in `tools/site`, vendored code
sits in `tools/site/vendor`, and each is held to the rule that fits it.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
VENDOR = APP / "tools" / "site" / "vendor"
MANIFEST = VENDOR / "VENDOR.json"


def _assets() -> list[dict]:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))["assets"]


def test_every_vendored_file_is_declared():
    """A file that arrived without a record is the one nobody chose."""
    declared = {a["file"] for a in _assets()}
    on_disk = {p.name for p in VENDOR.iterdir() if p.name != "VENDOR.json"}
    assert on_disk == declared, (
        f"undeclared: {sorted(on_disk - declared)}; declared but absent: "
        f"{sorted(declared - on_disk)}"
    )


def test_every_vendored_file_is_the_bytes_that_were_recorded():
    """The pin. A library that changed without its version changing fails here."""
    wrong = []
    for asset in _assets():
        path = VENDOR / asset["file"]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != asset["sha256"]:
            wrong.append(f"{asset['file']}: recorded {asset['sha256'][:16]}, found {digest[:16]}")
    assert not wrong, (
        "vendored bytes do not match the manifest:\n  " + "\n  ".join(wrong)
        + "\nIf the change was deliberate, bump the version and the digest together."
    )


def test_every_vendored_file_names_a_version_a_licence_and_a_source():
    """Three things a reviewer asks about somebody else's code, all present or none of it."""
    missing = []
    for asset in _assets():
        for field in ("package", "version", "url", "licence", "why", "fetched"):
            if not str(asset.get(field) or "").strip():
                missing.append(f"{asset['file']} has no {field}")
        url = asset.get("url", "")
        version = asset.get("version", "")
        if version and url and version not in url:
            missing.append(
                f"{asset['file']} is pinned at {version} and its url does not name that "
                f"version, so refetching it would not get the same file: {url}"
            )
    assert not missing, "\n  ".join([""] + missing)


def test_the_escaping_gate_does_not_read_the_vendor_directory():
    """The reason this file exists, asserted rather than left to a comment.

    If somebody moves vendored code back beside the authored scripts, the escaping gate
    starts reporting findings in compiled third-party output that nobody can act on, and the
    usual next step is to add an exemption to that gate. This makes the move fail here first.
    """
    source = (APP / "tests" / "test_markup_escaping.py").read_text(encoding="utf-8")
    assert 'SITE.glob("*.js")' in source, (
        "the escaping gate no longer reads tools/site/*.js, so the split this file assumes "
        "may no longer hold. Check that vendored code is still out of its way."
    )
    assert not re.search(r"rglob|vendor", source), (
        "the escaping gate has started walking subdirectories or naming the vendor "
        "directory. Authored scripts and vendored code are held to different rules on "
        "purpose; merging them ends with an exemption list inside the gate."
    )
