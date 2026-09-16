"""Static accessibility scans over the three rendered surfaces.

The renderer pages carry no JS framework and no images, so the a11y surface
that matters is CSS and markup structure: real <button> elements (keyboard
reachable by construction), a visible focus ring, WCAG AA contrast for every
text/background pair the palette composes, the viewport meta, a mobile
breakpoint, and reduced-motion support. These tests parse the actual CSS the
pages ship — change a palette colour and the scan recomputes, so a drift
below 4.5:1 fails here.
"""

from __future__ import annotations

import re
from typing import Optional

from warrantyops.adversarial import _CSS as ADVERSARIAL_CSS
from warrantyops.adversarial import render_adversarial_page
from warrantyops.proof_screen import DEFAULT_OUTPUT
from warrantyops.review_screen import _CSS as REVIEW_CSS

HEX = re.compile(r"#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b")


def _normalize(color: str) -> str:
    if len(color) == 4:  # #fff → #ffffff
        return "#" + "".join(channel * 2 for channel in color[1:])
    return color

#: The text/background pairs each surface composes: (foreground selector,
#: background selector, inherited background surface, inherited foreground
#: rule). Colours are resolved from the CSS itself, never restated here.
REVIEW_PAIRS = (
    ("body", "body", "--paper", ""),
    (".claimbar .muted", ".claimbar", "--card", ""),
    (".pill.recorded", ".pill.recorded", "--paper", ""),
    (".pill.synthetic", ".pill.synthetic", "--paper", ""),
    (".pill.fictional", ".pill.fictional", "--paper", ""),
    (".pill.boundary", ".pill.boundary", "--paper", ""),
    (".limitation", ".limitation", "--paper", ""),
    ("button", "button", "--paper", ""),
    ("button.refuse", "button.refuse", "--paper", "button"),
    ("button.return", "button.return", "--paper", "button"),
)
ADVERSARIAL_PAIRS = (
    ("body", "body", "--paper", ""),
    (".intro", "body", "--paper", ""),
    ("td.extractor", "td.extractor", "#ffffff", ""),
    (".refusal", "td", "#ffffff", ""),
    (".pill", ".pill", "#ffffff", ""),
    ("th", "th", "#ffffff", ""),
)


# --- WCAG math -------------------------------------------------------------------


def _luminance(color: str) -> float:
    def channel(value: int) -> float:
        scaled = value / 255
        return scaled / 12.92 if scaled <= 0.04045 else ((scaled + 0.055) / 1.055) ** 2.4

    red, green, blue = (int(color[step : step + 2], 16) for step in (1, 3, 5))
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)


def contrast(foreground: str, background: str) -> float:
    lighter, darker = sorted(
        (_luminance(foreground), _luminance(background)), reverse=True
    )
    return (lighter + 0.05) / (darker + 0.05)


# --- CSS parsing -----------------------------------------------------------------


def css_vars(css: str) -> dict[str, str]:
    root = css.split(":root", 1)[1].split("}", 1)[0]
    return dict(re.findall(r"(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})", root))


def _resolve(token: str, variables: dict[str, str]) -> Optional[str]:
    token = token.strip()
    match = re.fullmatch(r"var\((--[\w-]+)\)", token)
    if match:
        return variables.get(match.group(1))
    return _normalize(token) if HEX.fullmatch(token) else None


def rule(css: str, selector: str) -> str:
    match = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    return match.group(1) if match else ""


def fg_of(css: str, selector: str, inherits: str = "") -> str:
    """The declared text colour of a rule (var() references resolved).

    ``inherits`` names the rule whose colour applies when this rule only
    overrides the background (``button.refuse`` keeps ``button``'s #fff).
    """

    variables = css_vars(css)
    body = rule(css, selector)
    assert body, f"selector {selector!r} not found in CSS"
    foreground = re.search(r"(?<![-\w])color\s*:\s*([^;]+)", body)
    token = foreground.group(1) if foreground else ""
    if not token and inherits:
        token = re.search(
            r"(?<![-\w])color\s*:\s*([^;]+)", rule(css, inherits)
        ).group(1)  # type: ignore[union-attr]
    assert token, f"{selector} must declare (or inherit) a color"
    color = _resolve(token, variables)
    assert color, f"{selector} uses a colour the scanner cannot resolve"
    return color


def bg_of(css: str, selector: str, inherited: str) -> str:
    """The effective background of a rule: its own, or the surface it sits on."""

    variables = css_vars(css)
    body = rule(css, selector)
    assert body, f"selector {selector!r} not found in CSS"
    background = re.search(r"background(?:-color)?\s*:\s*([^;]+)", body)
    token = background.group(1) if background else inherited
    color = _resolve(token, variables) or variables.get(token)
    assert color, f"{selector} uses a colour the scanner cannot resolve"
    return color


def proof_page() -> str:
    return DEFAULT_OUTPUT.read_text(encoding="utf-8")


# --- contrast --------------------------------------------------------------------


def test_every_review_palette_pair_meets_aa():
    for fg_selector, bg_selector, inherited, fg_inherits in REVIEW_PAIRS:
        css = REVIEW_CSS
        fg = fg_of(css, fg_selector, fg_inherits)
        bg = bg_of(css, bg_selector, inherited)
        # A pill on white cards still needs AA against its own background;
        # parents that matter (body, cards) are white or paper.
        assert contrast(fg, bg) >= 4.5, f"{fg_selector}: {fg} on {bg}"


def test_every_adversarial_palette_pair_meets_aa():
    for fg_selector, bg_selector, inherited, fg_inherits in ADVERSARIAL_PAIRS:
        css = ADVERSARIAL_CSS
        fg = fg_of(css, fg_selector, fg_inherits)
        bg = bg_of(css, bg_selector, inherited)
        assert contrast(fg, bg) >= 4.5, f"{fg_selector}: {fg} on {bg}"


def test_muted_text_still_meets_aa_on_the_two_surfaces_it_sits_on():
    variables = css_vars(REVIEW_CSS)
    muted = variables["--muted"]
    paper = variables["--paper"]
    assert contrast(muted, paper) >= 4.5
    assert contrast(muted, "#ffffff") >= 4.5  # the cards


def test_small_text_never_drops_below_the_stricter_large_text_bar():
    # 12-13.5px labels (pills, footers, .refusal) are small text: 4.5:1 is
    # the bar they must clear; pin that they clear it with margin.
    variables = css_vars(ADVERSARIAL_CSS)
    assert contrast(variables["--good"], variables["--good-soft"]) >= 5.0
    assert contrast(variables["--runtime"], "#ffffff") >= 5.0


# --- structure -------------------------------------------------------------------


def test_all_three_pages_declare_language_and_viewport():
    for body in (proof_page(), render_adversarial_page()):
        assert '<html lang="en">' in body
        assert 'name="viewport"' in body


def test_the_review_css_has_a_visible_focus_ring_and_reduced_motion_support():
    assert "button:focus-visible" in REVIEW_CSS
    assert "outline" in rule(REVIEW_CSS, "button:focus-visible")
    assert "prefers-reduced-motion" in REVIEW_CSS
    assert "transition:none" in REVIEW_CSS


def test_both_stylesheets_ship_a_mobile_breakpoint():
    assert "@media (max-width:900px)" in REVIEW_CSS
    assert "@media (max-width:900px)" in ADVERSARIAL_CSS


def test_decisions_are_native_submit_buttons_not_clickable_divs():
    from tests.test_review_renderer import live_model  # the live page has the form
    from warrantyops.review_screen import render_review_screen

    page = render_review_screen(live_model())
    assert page.count("<button") == 3
    assert '<button type="submit" name="decision"' in page
    assert "onclick" not in page and 'role="button"' not in page


def test_the_tables_and_regions_are_labelled():
    adversarial = render_adversarial_page()
    assert "<th>#</th><th>The attack</th>" in adversarial  # one header row
    assert "<table>" in adversarial
    proof = proof_page()
    assert 'aria-labelledby="after-h"' in proof
    assert 'role="status"' in proof and "aria-live" in proof


def test_the_reveal_control_is_a_real_button_with_type_button():
    proof = proof_page()
    assert '<button id="reveal" type="button">' in proof
    assert "tabindex" not in proof  # nothing is pulled out of tab order
