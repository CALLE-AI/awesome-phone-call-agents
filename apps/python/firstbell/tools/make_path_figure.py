"""The path one absence row takes, drawn once, for a reader who has not read the code.

Two people came to this entry cold, found it tiring, and could not follow the
sequence: which gate comes first, what the call is allowed to ask, and where a safeguarding
escalation attaches. All of that is in `README.md` and in `dispatch/scheduler.py`, in prose,
spread over screens. One picture answers it at a glance, and `docs/images/README.md` is the
directory that exists because the rules for this event let a judge "choose to judge based
solely on the text description, images, and video".

That directory has a rule: everything in it is generated from the repository rather than
typed by hand, because a caption nobody produced from the thing it describes goes stale the
moment either one changes. This script is how this drawing obeys it.

  Colours come from `page.css` through `video_facts.palette()`, so the diagram is the same
  ink as the page and the film, and a re-cut palette moves all three.

  The safeguarding window is read from `firstbell.domain.SAFEGUARDING_CALLBACK_MINUTES`
  rather than typed, and it is labelled as the default it is. Thirty minutes is this
  project's number and no district has agreed to it.

  Running twice writes the same bytes, and `--check` says so, so the drawing cannot depend
  on when somebody happened to build it.

The text is baked into the SVG here, which the page's own figure is not allowed to do. The
reason is the reverse of the reason there: this one is read on GitHub, in a markdown file,
where there is no HTML to put labels in and no @font-face to load, so every family is
declared with the widest fallback chain and the drawing has to survive whatever the reader's
browser reaches for. It also carries a `title` and a `desc`, which is what a screen reader
gets, and the desc is the whole diagram in a sentence rather than a decoration's alt text.

  python tools/make_path_figure.py            # write it
  python tools/make_path_figure.py --check     # rebuild and report drift
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from xml.sax.saxutils import escape

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
sys.path.insert(0, str(APP / "tools"))

import video_facts  # noqa: E402

from firstbell.domain import SAFEGUARDING_CALLBACK_MINUTES  # noqa: E402

W, H = 480, 1008
OUT = APP / "docs" / "images" / "the-path-of-one-absence.svg"

# No @font-face reaches an SVG inside a markdown file, so each family is declared with the
# fallback the reader will actually get. The page's own faces are named first for the one
# case where this is opened next to the page.
BODY = "'neue-haas-grotesk-text', 'ui-fallback', Arial, Helvetica, sans-serif"
DISPLAY = "'neue-haas-grotesk-display', 'ui-display-fallback', Arial, Helvetica, sans-serif"
MONO = "'azeret-mono', 'mono-fallback', Consolas, ui-monospace, monospace"

TITLE = "The path of one unexplained school absence through firstbell"

DESC = (
    "A row from a school's nightly absence export meets a gate on consent and then on "
    "voice reachability: a family with no recorded consent is never dialled and no call is "
    "owed, and a family the telephone cannot reach is not dialled either but goes to a "
    "person to be reached another way. A row that passes both gets a short spoken "
    "instruction in the family's own language, with the disclosure that the caller is "
    "automated spoken first: the reason for the absence, the expected return, and a check "
    "that the person answering knew the student was absent, and nothing else. CALL-E then "
    "places the call under a cap on families rather than on requests, one idempotency key "
    "for each row, polled until the call reaches a terminal status. The answer comes back "
    "as exactly one of three endings. Resolved: a schema-valid answer came back, and "
    "nobody looks again. Undetermined: the call happened and no usable answer came back, "
    "so a person owns it. Failed: nobody was reached on any number, so a person owns it "
    "too. A safeguarding escalation is a second axis that can attach to resolved or to "
    "undetermined, because only an explicit yes closes a record; it sends the case to the "
    "top of a person's queue. A failed call carries no answer to read, so it cannot "
    "escalate."
)


def _text(x: int, y: int, body: str, *, fill: str, size: int = 16,
          family: str = BODY, weight: str | None = None, anchor: str | None = None,
          spacing: str | None = None) -> str:
    bits = [f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}"']
    if family != BODY:
        bits.append(f'font-family="{family}"')
    if anchor:
        bits.append(f'text-anchor="{anchor}"')
    if weight:
        bits.append(f'font-weight="{weight}"')
    if spacing:
        bits.append(f'letter-spacing="{spacing}"')
    return " ".join(bits) + f">{escape(body)}</text>"


def _rect(x: int, y: int, w: int, h: int, *, fill: str, stroke: str | None = None,
          width: float = 1, dashed: bool = False) -> str:
    bits = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}"']
    if stroke:
        bits.append(f'stroke="{stroke}" stroke-width="{width}"')
        if dashed:
            bits.append('stroke-dasharray="6 4"')
    return " ".join(bits) + "/>"


def _arrow(path: str, *, stroke: str, marker: str) -> str:
    return (f'<path d="{path}" fill="none" stroke="{stroke}" stroke-width="2" '
            f'marker-end="url(#{marker})"/>')


def build() -> str:
    """The drawing, top to bottom, in the order the program takes it.

    The layout is fixed rather than computed. A solver would move every box when one label
    changed a word, and the whole value of this file is that it produces the same bytes
    twice. What is not fixed is the ink and the one number in it.
    """
    p = video_facts.palette()
    ink, ink2, ink3 = p["ink"], p["ink-2"], p["ink-3"]
    paper, card, line = p["paper"], p["card"], p["line-strong"]
    flag = p["undetermined"]   # the page marks a safeguarding row with this, so this does

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" '
        f'aria-labelledby="absence-path-title absence-path-desc" font-family="{BODY}">',
        f'<title id="absence-path-title">{escape(TITLE)}</title>',
        f'<desc id="absence-path-desc">{escape(DESC)}</desc>',
        "<defs>",
        f'<marker id="ar" markerWidth="12" markerHeight="9" refX="12" refY="4.5" '
        f'orient="auto" markerUnits="userSpaceOnUse">'
        f'<polygon points="0 0, 12 4.5, 0 9" fill="{ink3}"/></marker>',
        f'<marker id="ar-mark" markerWidth="12" markerHeight="9" refX="12" refY="4.5" '
        f'orient="auto" markerUnits="userSpaceOnUse">'
        f'<polygon points="0 0, 12 4.5, 0 9" fill="{flag}"/></marker>',
        "</defs>",
        # A canvas, not a transparency. GitHub renders a README in a dark theme as readily
        # as a light one, and a diagram of dark ink on nothing at all disappears into the
        # dark one. The paper is the page's paper.
        f'<rect x="0" y="0" width="{W}" height="{H}" fill="{paper}"/>',
        '<g id="flow">',
        _arrow("M48 92 V124", stroke=ink3, marker="ar"),
        _arrow("M248 164 H358 A8 8 0 0 1 366 172 V196", stroke=ink3, marker="ar"),
        _arrow("M48 204 V320", stroke=ink3, marker="ar"),
        _arrow("M48 412 V444", stroke=ink3, marker="ar"),
        _arrow("M48 536 V776 A8 8 0 0 0 56 784 H76", stroke=ink3, marker="ar"),
        _arrow("M48 600 H76", stroke=ink3, marker="ar"),
        _arrow("M48 692 H76", stroke=ink3, marker="ar"),
        # The second axis. It leaves resolved and undetermined and it does not leave
        # failed, because a call that reached nobody has no answer to read a rule against.
        _arrow("M416 600 H440 A8 8 0 0 1 448 608 V872", stroke=flag, marker="ar-mark"),
        _arrow("M416 692 H424 A8 8 0 0 1 432 700 V872", stroke=flag, marker="ar-mark"),
        "</g>",
        _text(60, 268, "BOTH YES", fill=ink2, family=MONO, spacing="0.06em"),
        _text(352, 152, "EITHER NO", fill=ink2, family=MONO, anchor="end",
              spacing="0.06em"),

        _rect(20, 16, 440, 76, fill=card, stroke=line),
        _text(36, 60, "One absence row", fill=ink, size=20, family=DISPLAY, weight="500"),
        _text(216, 48, "A nightly export, or a file.", fill=ink2),
        _text(216, 72, "Stale or reused: refused.", fill=ink2),

        _rect(20, 124, 228, 80, fill=card, stroke=ink, width=2),
        _text(36, 164, "Consent, then voice", fill=ink, size=20, family=DISPLAY,
              weight="500"),
        _text(36, 188, "In that order.", fill=ink2),

        _rect(272, 196, 188, 92, fill=paper, stroke=ink3, dashed=True),
        _text(288, 228, "Not dialled", fill=ink, size=20, family=DISPLAY, weight="500"),
        _text(288, 252, "No consent, no call.", fill=ink2),
        _text(288, 276, "No voice, a person.", fill=ink2),

        _rect(20, 320, 440, 92, fill=card, stroke=line),
        _text(36, 372, "The instruction", fill=ink, size=20, family=DISPLAY, weight="500"),
        _text(216, 348, "In the family's own language.", fill=ink2),
        _text(216, 372, "The disclosure comes first.", fill=ink2),
        _text(216, 396, "Two questions and a check.", fill=ink2),

        _rect(20, 444, 440, 92, fill=card, stroke=line),
        _text(36, 496, "CALL-E places it", fill=ink, size=20, family=DISPLAY, weight="500"),
        _text(216, 472, "A cap on families, not requests.", fill=ink2),
        _text(216, 496, "One key for each row.", fill=ink2),
        _text(216, 520, "Polled to the end.", fill=ink2),
    ]

    # The three endings, in the order the office cares about, each with who owns it next.
    endings = [
        (564, "resolved", "A schema-valid answer came back.", "NOBODY", p["resolved"]),
        (656, "undetermined", "The call happened. No usable answer.", "A PERSON",
         p["undetermined"]),
        (748, "failed", "Nobody was reached on any number.", "A PERSON", p["failed"]),
    ]
    for top, name, why, who, colour in endings:
        out += [
            _rect(76, top, 340, 72, fill=colour),
            _text(92, top + 32, name, fill=paper, size=24, family=DISPLAY, weight="500"),
            _text(92, top + 56, why, fill=paper),
            _text(400, top + 32, who, fill=paper, family=MONO, anchor="end",
                  spacing="0.08em"),
        ]

    # The window is the project's own default and the label says so. A number printed
    # without its provenance is how a reader takes a default for their district's policy,
    # which the run summary refuses to let happen and this must not undo.
    out += [
        _rect(20, 872, 440, 120, fill=card, stroke=flag, width=2),
        _text(36, 900, f"SAFEGUARDING, DEFAULT {SAFEGUARDING_CALLBACK_MINUTES} MINUTES",
              fill=ink2, family=MONO, spacing="0.08em"),
        _text(36, 928, "Only an explicit yes closes it.", fill=ink, size=20,
              family=DISPLAY, weight="500"),
        _text(36, 952, "Anything else goes to the top of a person's queue.", fill=ink2),
        _text(36, 976, "A failed call has no answer, so it cannot escalate.", fill=ink2),
        "</svg>",
    ]
    return "\n".join(out) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(OUT))
    parser.add_argument("--check", action="store_true",
                        help="rebuild and report drift instead of writing")
    args = parser.parse_args()

    path = Path(args.out)
    drawing = build().encode("utf-8")

    if args.check:
        # Absent is not the same as changed. This one is committed, unlike the page's
        # figure, so absent here means somebody deleted it, which is worth saying plainly
        # rather than reporting as a drift.
        if not path.exists():
            print(f"cannot be measured: {path} does not exist. This drawing is committed, "
                  "so run this script without --check and commit what it writes.")
            return 3
        if path.read_bytes() != drawing:
            print(f"changed: {path.name} is not what this script writes today. Re-run "
                  "without --check and commit the result.")
            return 1
        print("the path figure is current")
        return 0

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(drawing)
    print(f"svg      {path.relative_to(APP)}  {len(drawing) / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
