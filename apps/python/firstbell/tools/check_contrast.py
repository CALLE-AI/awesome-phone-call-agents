"""Measure every text-on-ground pair the page declares, and fail if any is below AA.

Two things this gate does that an eyeballed palette does not.

It parses `oklch()`. A checker that only understands hex silently skips every modern colour
and then reports that nothing failed, which reads identically to a pass. So the count of
pairs it could not measure is printed on every run and any value above zero is a failure,
not a footnote.

It measures both grounds. The page is paper except where a call is playing, and a colour
that passes on paper can fail in the theatre. Every semantic token is checked against both.

    python tools/check_contrast.py            # measure and report
    python tools/check_contrast.py --strict   # exit 1 if anything fails or is unmeasured
"""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path

CSS = Path(__file__).resolve().parent / "site" / "page.css"

# Which token sits on which ground, and what size it is used at. AA is 4.5 for body text and
# 3.0 for text at 24px or 19px bold, so a pair's target depends on where it is actually used.
# Getting this list wrong is the easy way to pass a gate that means nothing, so each entry
# names the place in the page it describes.
PAIRS: list[tuple[str, str, float, str]] = [
    # token,            ground,            min,  where
    ("--ink",           "--paper",         4.5,  "body copy on paper"),
    ("--ink-2",         "--paper",         4.5,  "secondary prose, table cells"),
    ("--ink-3",         "--paper",         4.5,  "captions, turn timestamps"),
    ("--ink-4",         "--paper",         3.0,  "disabled and decorative only"),
    ("--resolved",      "--paper",         4.5,  "the word resolved, on paper"),
    ("--undetermined",  "--paper",         4.5,  "the word undetermined, on paper"),
    ("--failed",        "--paper",         4.5,  "the word failed, on paper"),
    ("--link",          "--paper",         4.5,  "links in running prose"),
    # The surfaces the redesign introduced. Each of these ink tokens is a scoped re-cut:
    # `--ink-3` becomes `--lit-ink-3` inside a panel and `--ink` becomes `--royal-ink` on
    # the royal plate, so measuring the base token against paper says nothing about the
    # pair a reader actually looks at. The tool prints an ALIAS line for any re-cut no row
    # below measures, which is how these were found missing.
    ("--ink-2",         "--sage",          4.5,  "prose inside a sage panel"),
    ("--lit-ink-3",     "--sage",          4.5,  "small print inside a sage panel"),
    ("--ink",           "--brand-field",   4.5,  "the two-minute path, the lead cell"),
    ("--lit-ink-3",     "--brand-field",   4.5,  "small print on the brand field"),
    ("--link",          "--brand-field",   4.5,  "the three destinations"),
    ("--royal-ink",     "--royal",         4.5,  "headings on the royal plate"),
    ("--royal-ink-2",   "--royal",         4.5,  "body and links on the royal plate"),
    ("--royal-ink-3",   "--royal",         4.5,  "small print on the royal plate"),
    ("--ink",           "--card",          4.5,  "the register, the stat cells"),
    ("--lit-ink-3",     "--card",          4.5,  "the register's small print"),
]


def oklch_to_srgb(L: float, C: float, h_deg: float) -> tuple[float, float, float]:
    """OKLCH to linear sRGB, by Bjorn Ottosson's matrices."""
    h = math.radians(h_deg)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )


def relative_luminance(rgb_linear: tuple[float, float, float]) -> float:
    r, g, b = (min(max(c, 0.0), 1.0) for c in rgb_linear)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def hex_luminance(value: str) -> float:
    v = value.lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    parts = [int(v[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in parts]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


OKLCH = re.compile(r"oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)", re.I)
HEXV = re.compile(r"#[0-9a-fA-F]{3,8}\b")


def luminance(value: str) -> float | None:
    """None means this checker did not understand the colour, which is never a pass."""
    m = OKLCH.search(value)
    if m:
        L = float(m.group(1))
        if "%" in value.split(",")[0] and L > 1:
            L /= 100
        return relative_luminance(oklch_to_srgb(L, float(m.group(2)), float(m.group(3))))
    h = HEXV.search(value)
    if h:
        return hex_luminance(h.group(0))
    return None


def in_gamut(value: str) -> bool:
    m = OKLCH.search(value)
    if not m:
        return True
    rgb = oklch_to_srgb(float(m.group(1)), float(m.group(2)), float(m.group(3)))
    return all(-0.0005 <= c <= 1.0005 for c in rgb)


def hex_of(value: str) -> str | None:
    """One token as the six hex digits a `<meta>` can carry, or None.

    `theme-color` takes a colour a browser understood before oklch existed, and the page's
    ground is `oklch(0.973 0.006 75)`. Typing the hex beside it makes two values for one
    colour and nothing to notice when the paper is re-cut, so it is computed here, next to
    the matrices that already turn that token into light, rather than in the page builder.
    """
    m = OKLCH.search(value)
    if not m:
        found = HEXV.search(value)
        return found.group(0).upper() if found else None
    L = float(m.group(1))
    if "%" in value.split(",")[0] and L > 1:
        L /= 100
    channels = []
    for linear in oklch_to_srgb(L, float(m.group(2)), float(m.group(3))):
        linear = min(max(linear, 0.0), 1.0)
        # The transfer function, which the luminance path above deliberately does not apply:
        # a ratio is computed on linear light and a hex string is encoded light.
        encoded = 12.92 * linear if linear <= 0.0031308 else 1.055 * linear ** (1 / 2.4) - 0.055
        channels.append(round(encoded * 255))
    return "#{:02X}{:02X}{:02X}".format(*channels)


def blocks(css: str) -> dict[str, dict[str, str]]:
    """Custom properties per selector.

    A flat regex over the whole file reads the last declaration of each name, and `.theatre`
    redeclares `--ink`, `--link` and the three outcome states as aliases of their dark
    equivalents. Reading those as the paper values reported six pairs unmeasured and one
    false failure, so this parser keeps the scopes apart.
    """
    # Comments come out first. Left in, the selector capture swallows the comment block above
    # each rule and ":root" is never the key, which reports every pair unmeasured: the exact
    # shape of failure this gate exists to refuse.
    clean = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out: dict[str, dict[str, str]] = {}
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", clean):
        decls = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", body))
        if decls:
            key = sel.strip().splitlines()[-1].strip()
            out.setdefault(key, {}).update({k: v.strip() for k, v in decls.items()})
    return out


def tokens(css: str) -> dict[str, str]:
    """Every real value is declared in :root. Other scopes only rename them."""
    return blocks(css).get(":root", {})


def alias_targets(css: str) -> list[tuple[str, str, str]]:
    """(scope, token, target) for every override that is a bare var() reference."""
    found = []
    for sel, decls in blocks(css).items():
        if sel == ":root":
            continue
        for name, value in decls.items():
            m = re.fullmatch(r"var\(\s*(--[\w-]+)\s*\)", value)
            if m:
                found.append((sel, name, m.group(1)))
    return found


def ratio(a: float, b: float) -> float:
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def main() -> int:
    strict = "--strict" in sys.argv
    if not CSS.exists():
        print(f"no stylesheet at {CSS}")
        return 1
    tk = tokens(CSS.read_text(encoding="utf-8"))

    failures: list[str] = []
    unmeasured: list[str] = []
    gamut: list[str] = []
    rows: list[tuple[str, str, str, float, float, str]] = []

    for token, ground, need, where in PAIRS:
        fg_raw, bg_raw = tk.get(token), tk.get(ground)
        if fg_raw is None or bg_raw is None:
            unmeasured.append(f"{token} on {ground}: token not declared")
            continue
        fg, bg = luminance(fg_raw), luminance(bg_raw)
        if fg is None or bg is None:
            bad = token if fg is None else ground
            unmeasured.append(f"{token} on {ground}: could not parse {bad} = {tk[bad]!r}")
            continue
        for name, raw in ((token, fg_raw), (ground, bg_raw)):
            if not in_gamut(raw) and name not in gamut:
                gamut.append(name)
        r = ratio(fg, bg)
        verdict = "AAA" if r >= 7 else "AA" if r >= need else "FAIL"
        if verdict == "FAIL":
            failures.append(f"{token} on {ground} is {r:.2f}, needs {need} ({where})")
        rows.append((token, ground, where, r, need, verdict))

    width = max(len(t) for t, *_ in rows) if rows else 10
    print(f"{'token':<{width}}  {'ground':<14} {'ratio':>6} {'need':>5}  verdict  where")
    for token, ground, where, r, need, verdict in sorted(rows, key=lambda x: x[3]):
        print(f"{token:<{width}}  {ground:<14} {r:6.2f} {need:5.1f}  {verdict:<7}  {where}")

    print(f"\nmeasured {len(rows)} pairs, {len(failures)} failing, "
          f"{len(unmeasured)} unmeasured, {len(gamut)} outside sRGB")
    for line in failures:
        print(f"  FAIL      {line}")
    for line in unmeasured:
        print(f"  UNMEASURED {line}")
    for name in gamut:
        print(f"  GAMUT     {name} = {tk[name]} clips in sRGB")

    # An unmeasured pair is a failure. It is the outcome that looks like a pass and is not,
    # and it is the specific way a colour gate gets to be green while the page fails AA.
    checked = {t for t, _g, _n, _w in PAIRS}
    dangling = [f"{sel} {name} -> {target}, which no pair measures"
                for sel, name, target in alias_targets(CSS.read_text(encoding="utf-8"))
                if name in checked and target not in checked]
    for line in dangling:
        print(f"  ALIAS     {line}")

    bad = bool(failures or unmeasured or gamut or dangling)
    if strict and bad:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
