"""`THIRD-PARTY-NOTICES.md` has to describe the dependencies that are actually installed.

The rules require that an entrant "must be authorized to use them in accordance with any
terms and conditions or licensing requirements of the tool", and the notices file is where
this project answers that. It was answering it wrongly: the runtime table named two of the
eight packages a `pip install -r requirements.txt` actually brings in, and then said
"nothing else is required at runtime", which was a claim about a dependency tree nobody had
resolved. The development table named one of nine, and the omission with the most
consequence is `lottie`, the only copyleft licence anywhere near this repository.

A licence file is the kind of document that is written once and then quietly outlives the
tree it describes. So the tables are measured here against the metadata of the
distributions that are installed, and against the lock file that pins the browser gates,
rather than being trusted.
"""
from __future__ import annotations

import importlib.metadata as metadata
import json
import re
from pathlib import Path

from packaging.requirements import Requirement

APP = Path(__file__).resolve().parent.parent
NOTICES = APP / "THIRD-PARTY-NOTICES.md"
LOCK = APP / "tools" / "gates" / "package-lock.json"

# What a licence looks like when it is not copyleft. AGPL, GPL, LGPL and MPL are all
# absent on purpose: this is the set the notices file claims the browser gates stay
# inside, so a dependency that arrives under anything else has to be written down before
# the suite goes green again.
PERMISSIVE = {
    "MIT", "ISC", "0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause",
    "(MIT OR CC0-1.0)", "BlueOak-1.0.0", "Python-2.0",
}


def notices() -> str:
    return NOTICES.read_text(encoding="utf-8")


def declared_licence(dist: metadata.Distribution) -> str:
    """What a distribution says its licence is, in the order the metadata prefers.

    Three fields can carry it and packages disagree about which to use. `attrs` and `idna`
    fill in `License-Expression` and nothing else; `h11` and `httpx` fill in `License`;
    `certifi` fills in both. Reading only one of them reports a licence as missing when it
    is sitting in the next field down.
    """
    meta = dist.metadata
    expression = meta.get("License-Expression")
    if expression:
        return expression.strip()
    plain = (meta.get("License") or "").strip()
    if plain and "\n" not in plain and len(plain) < 40:
        return plain
    for classifier in meta.get_all("Classifier") or ():
        if classifier.startswith("License ::"):
            return classifier.split("::")[-1].strip()
    return ""


def runtime_closure() -> dict[str, metadata.Distribution]:
    """Every distribution a `pip install -r requirements.txt` leaves behind.

    Walked from the pinned names outward, following each distribution's own declared
    requirements and dropping the ones whose marker does not apply here. Extras are not
    followed: none is requested, so following them would list packages this project never
    installs.
    """
    found: dict[str, metadata.Distribution] = {}

    def walk(name: str) -> None:
        key = name.lower().replace("_", "-")
        if key in found:
            return
        found[key] = metadata.distribution(name)
        for raw in found[key].requires or ():
            requirement = Requirement(raw)
            if requirement.marker and not requirement.marker.evaluate({"extra": ""}):
                continue
            walk(requirement.name)

    for line in (APP / "requirements.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            walk(Requirement(line).name)
    return found


def test_the_runtime_table_names_every_package_that_gets_installed() -> None:
    text = notices()
    missing = [name for name in runtime_closure() if f"`{name}`" not in text]
    assert not missing, (
        "these packages are installed by requirements.txt and its dependencies but have no "
        "row in THIRD-PARTY-NOTICES.md, which is the file that answers the rule about being "
        "authorized to use every tool:\n  " + "\n  ".join(sorted(missing)))


def test_the_runtime_table_states_the_installed_version_and_licence() -> None:
    rows = {}
    for line in notices().splitlines():
        cells = [cell.strip().strip("`") for cell in line.split("|")]
        if len(cells) >= 6 and cells[1]:
            rows[cells[1].lower().replace("_", "-")] = (cells[2], cells[4])

    wrong = []
    for name, dist in runtime_closure().items():
        if name not in rows:
            continue
        stated_version, stated_licence = rows[name]
        if stated_version != dist.version:
            wrong.append(f"{name}: the file says {stated_version} and {dist.version} is "
                         "installed")
        licence = declared_licence(dist)
        # `calle-ai` is the one package with nothing to compare against. The file says so
        # at length, and a row that had to match an empty string would fail forever.
        if licence and licence not in stated_licence:
            wrong.append(f"{name}: the file says {stated_licence!r} and the installed "
                         f"metadata says {licence!r}")
    assert not wrong, ("THIRD-PARTY-NOTICES.md disagrees with what is installed:\n  "
                       + "\n  ".join(wrong))


def test_the_browser_gates_carry_nothing_copyleft() -> None:
    """The notices file says all 84 are permissive. This is what makes that a measurement.

    Read from `package-lock.json`, which is tracked, rather than from `node_modules/`,
    which is not. A check that could only run after an `npm install` would report nothing
    on a fresh clone and the absence would read as a pass.
    """
    packages = json.loads(LOCK.read_text(encoding="utf-8"))["packages"]
    named = {path: entry for path, entry in packages.items() if path}
    unexpected = {path.rsplit("node_modules/", 1)[-1]: entry.get("license", "none declared")
                  for path, entry in named.items()
                  if entry.get("license") not in PERMISSIVE}
    assert not unexpected, (
        "the notices file says every browser-gate dependency is permissive, and these are "
        "not in that set:\n  "
        + "\n  ".join(f"{name}: {licence}" for name, licence in sorted(unexpected.items())))

    stated = re.search(r"resolves (\d+) more", notices())
    assert stated, "the notices file no longer states how many the lock file resolves"
    # The lock file's own root entry is this project rather than a dependency, and the
    # sentence names the pinned package separately from the count.
    assert int(stated.group(1)) == len(named) - 1, (
        f"the notices file says the lock file resolves {stated.group(1)} beyond "
        f"puppeteer-core and it resolves {len(named) - 1}")


def test_the_copyleft_dependency_is_named_wherever_it_is_pinned() -> None:
    """`lottie` is AGPL and this repository is MIT, so the two files have to agree.

    Dropping the dependency and leaving the note would describe an exposure that no longer
    exists. Keeping the dependency and dropping the note is the failure that matters: a
    reviewer of an MIT repository would meet the import with nothing written about it.
    """
    pinned = "lottie==" in (APP / "requirements-dev.txt").read_text(encoding="utf-8")
    described = "AGPL-3.0-or-later" in notices()
    assert pinned == described, (
        "requirements-dev.txt pins lottie and THIRD-PARTY-NOTICES.md says nothing about "
        "AGPL" if pinned else
        "THIRD-PARTY-NOTICES.md explains an AGPL dependency that requirements-dev.txt no "
        "longer pins")
