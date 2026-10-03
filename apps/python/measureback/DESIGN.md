---
name: MeasureBack
description: A kitchen instrument for reading recipe measurements and their source words.
colors:
  paper: "#f1f3f0"
  ink: "#292b28"
  muted: "#65675f"
  line: "#d7d8d0"
  accent: "#c83c22"
  accent-deep: "#a62f18"
  screen: "#e8eca8"
  screen-ink: "#323b22"
  white: "#fff"
  quiet: "#ecece5"
  instrument: "#e4e5dd"
  control-border: "#b8bab0"
typography:
  display:
    fontFamily: "MB, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(36px, 4vw, 57px)"
    fontWeight: 650
    lineHeight: 1.03
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "MB, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.13
    letterSpacing: "-0.035em"
  title:
    fontFamily: "MB, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "-0.025em"
  body:
    fontFamily: "MB, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "MB, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 550
    lineHeight: 1.5
  reading:
    fontFamily: "MB, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(80px, 8vw, 116px)"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.035em"
rounded:
  tag: "4px"
  field: "5px"
  stepper: "6px"
  control: "7px"
  navigation: "8px"
  sheet: "14px"
  instrument: "18px"
spacing:
  compact: "8px"
  small: "12px"
  related: "16px"
  section: "24px"
  columns: "26px"
  spacious: "32px"
  page: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
  button-primary-hover:
    backgroundColor: "{colors.accent-deep}"
  button-subtle:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
  text-field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "11px 12px"
    width: "100%"
  stage-navigation:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.navigation}"
  stage-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    padding: "13px 18px"
  time-tag:
    backgroundColor: "#e5e9d8"
    textColor: "#455131"
    rounded: "{rounded.tag}"
    padding: "2px 7px"
  recipe-sheet:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "24px 27px 16px"
  measurement-instrument:
    backgroundColor: "{colors.instrument}"
    textColor: "{colors.ink}"
    rounded: "{rounded.instrument}"
    padding: "25px 26px 18px"
  measurement-display:
    backgroundColor: "{colors.screen}"
    textColor: "{colors.screen-ink}"
    rounded: "{rounded.control}"
    padding: "19px 25px 15px"
---

# Design System: MeasureBack

## Overview

**Creative North Star: "The Kitchen Scale"**

MeasureBack borrows the readable surfaces and deliberate controls of a domestic kitchen scale. Cool pale gray provides the working ground; a yellow inset display gives quantities a distinct place; vermilion marks actions. A white recipe sheet and plain source quotations keep the surrounding material easy to read.

The visual language is compact and practical. Large numerals make a measurement legible at a glance, while units, formulas, status text and the cook's words explain what the number means. The instrument metaphor comes from geometry, contrast and controls. There are no simulated brushed textures or decorative photographs.

**Key Characteristics:**

- Pale working surfaces with one yellow measurement display.
- Self-hosted Atkinson typography and tabular quantities.
- Soft instrument depth beside a flat recipe sheet.
- Direct action labels, visible source words and explicit uncertainty.
- One brief readout transition with a reduced-motion alternative.

## Colors

The palette combines cool domestic surfaces with the slightly green cast of a kitchen scale display. Frontmatter is the normative token list; the CSS variable names match it where the implementation exposes a custom property.

### Primary

- **Vermilion** (`accent`) marks the primary action, highlighted heading words, tertiary actions, keyboard focus and text caret.
- **Deep Vermilion** (`accent-deep`) is the primary button's hover surface.

### Secondary

- **Butter Display** (`screen`) belongs to the measurement readout and text selection.
- **Display Ink** (`screen-ink`) supplies text within that colored display, keeping its foreground within the same hue family.

### Neutral

- **Cool Gray Ground** (`paper`) is the page background.
- **Charcoal** (`ink`) is the main text and selected navigation surface.
- **Muted Charcoal** (`muted`) is secondary copy on light neutral surfaces.
- **Divider Gray** (`line`) separates rows and defines the recipe sheet.
- **White Sheet** (`white`) supports the ingredient ledger and form fields.
- **Quiet Gray** (`quiet`) is the hover surface for unselected stages.
- **Scale Casing** (`instrument`) gives the measurement instrument its material body.
- **Control Edge** (`control-border`) outlines subtle buttons.

Unresolved quantities use a burnt orange text treatment; quantities requiring a human decision use ochre. Both also have text labels. Error feedback uses its own pale red surface and dark red text. These local states are not additional brand accents.

**The Readable State Rule.** Color reinforces a written state; it never replaces the status, unit or recovery instruction.

## Typography

**Display and body font:** Atkinson Hyperlegible Next, self-hosted from `web/fonts/AtkinsonHyperlegibleNext.ttf` under the CSS family alias `MB`. The fallback stack is Helvetica Neue, Arial and sans-serif. The font face declares variable weights from 200 through 800 and uses `font-display: swap`.

The same face carries headings, controls, reading copy and quantities. Numeric hierarchy supplies the instrument character without introducing a decorative monospace family.

### Hierarchy

- **Display:** the main heading, with balanced wrapping and the most compact tracking.
- **Headline:** larger section introductions; it becomes slightly smaller on narrow screens.
- **Title:** ordinary section headings. The recipe title is a distinct intermediate size (26px, or 25px on mobile).
- **Body:** the page baseline. Supporting descriptions, transcript turns and ingredient names use smaller sizes according to density; source quotations are larger (23px) and more open (1.3 line height).
- **Label:** form labels and compact metadata. Uppercase instrument and ledger labels use restrained positive tracking, with the final compact labels set to 12px.
- **Reading:** large quantity numerals with `font-variant-numeric: tabular-nums`. Units sit on the same baseline at a smaller size. The formula, serving count, multiplier and ledger quantities also use tabular numerals.

**The Number and Unit Rule.** Keep the quantity, its unit and its explanation distinct in scale but visibly connected. A question mark is meaningful unresolved data, not an icon.

Long readings switch to a smaller wrapping treatment. At the mobile breakpoint, ordinary readings use a responsive range from 64px to 84px; long readings use 36px. Do not let a long amount push the instrument wider than its column.

## Layout

The page uses a centered maximum width (1440px) with generous desktop side gutters (48px). The recurring two-column working grid gives the instrument slightly less width than the recipe sheet (`0.86fr 1.14fr`). The primary working gap is 26px; supporting sections use wider separation according to their content.

Related controls stay close. Dividers and increased spacing separate major tasks. Rows are dense enough for comparison, while the source quotation has a dedicated open area immediately adjacent to the reading. Text measures are local to their purpose: instrument explanations stop at 50 characters and call introduction copy at 47 characters. Long formulas, evidence and quotations wrap within their containers.

At 1050px and below, side gutters reduce to 28px, working gaps tighten and the short header note disappears. At 760px and below, side gutters reduce to 18px and working, review, transcript and call sections become one column. The three stage controls stay in one row with their sequence markers above their text. Form fields retain two columns, with explicitly full-width fields spanning both. The transcript remains vertically scrollable.

The print view retains the recipe sheet and method, suppresses interactive setup and navigation, and avoids splitting ingredient rows. These are rendering rules for the current workbench; future surfaces should adopt the shared spacing and hierarchy without copying its entire page composition.

## Elevation & Depth

Depth distinguishes the instrument casing and its inset screen. The white recipe sheet uses a fine border with no ambient shadow. Supporting text sections stay on the page ground. Subtle controls use an inset line rather than a floating effect.

### Shadow Vocabulary

- **Instrument body:** `0 12px 28px -20px #383b32` supplies a small, soft physical lift beneath the casing.
- **Inset display:** `inset 0 2px 5px #323b221f` seats the yellow field inside the instrument.
- **Subtle control edge:** `inset 0 0 0 1px #b8bab0` is a stroke, not elevation.

**The Instrument Depth Rule.** Reserve ambient lift and inset depth for the measuring instrument. Use a border or a divider to organize ordinary content.

## Shapes

Small corners distinguish control types without turning every element into a pill. Fields and evidence disclosures have tighter corners; primary buttons and the screen share a control radius; stage navigation is a joined segmented strip. The recipe sheet is gently rounded, and the instrument has a softer outer casing.

Circles carry actual sequence markers and small state indicators. Calibration ticks are straight vector-like marks with a repeating long/short cadence. SVG icons use open paths, no fill and consistent line weight. Runtime action icons use a 24-unit view box and a 1.7 stroke at 17px; the brand and phone mark use their own existing sizes. Arrows and action symbols are authored SVG, not font glyph substitutes.

## Components

### Buttons

Direct labels describe what the action does. The primary variant uses Vermilion, white text, medium-heavy weight (650), a minimum height of 44px and generous horizontal separation before an optional arrow. Hover darkens its surface. The subtle variant keeps a transparent background, an inset Control Edge stroke and a pale hover surface.

Tertiary actions are smaller text buttons in Vermilion; hover adds an underline with a visible offset. Disabled buttons lower opacity to 0.45 and show a disabled cursor. Keyboard focus uses a Vermilion outline (3px) separated from the control (4px). Background state transitions last 150ms. There is no separate authored active transform.

### Inputs / Fields

Persistent text labels sit above white fields with a fine gray border and compact corners. Fields inherit the same font as the rest of the interface, use 14px input text and gain the shared external focus ring. The caret is Vermilion; placeholder text has its own muted color and full opacity.

Checkboxes use Vermilion and sit beside wrapped consent text. The serving slider uses a muted green track accent beside an explicit numeric stepper. Error feedback is a full-width message with written recovery guidance. Asynchronous status copy is kept near the control it describes.

### Navigation

Conversation stages form one bordered strip. Each button combines a real sequence number with a label. Charcoal fill and white text mark `aria-pressed="true"`; unselected controls have a quiet hover fill. Every stage is at least 48px tall. On small screens the marker and text stack without collapsing the stages into a hidden menu.

### Chips / Tags

The time tag is a small, passive green-tinted duration label. It is not a filter or action. The tag does not imply that a duration changes when servings change.

### Cards / Containers

The recipe sheet uses a white surface, fine Divider Gray border and sheet radius. Its heading, serving controls and ingredient rows form one ledger. Rows are separated by thin rules rather than separate cards. The amount is right-aligned with tabular numerals; original quantities and source affordances use smaller secondary text.

An ingredient button expands its source quotation in a quiet inset disclosure and selects the corresponding instrument reading. Hover changes the ingredient name to Vermilion. Status text remains visible even when evidence is collapsed.

### Measurement Instrument

The instrument combines its casing, status, inset yellow readout, formula, selected quotation and primary next action. The unknown state retains a question mark; supported values replace it with a measured quantity. Source words and any correction accompany the changed reading.

A changed reading gets a single 300ms blur-to-clear transition using `cubic-bezier(.16,1,.3,1)`. The value is present throughout; this is not a loading animation. Reduced-motion preference removes animation and transitions and turns smooth scrolling off.

### Browser Surfaces

Selection uses the yellow display palette. Scrollbars use a muted green thumb over the page ground with thin native width. Links have a 4px underline offset. A visible skip link provides direct keyboard access to the recipe. These details belong to the visual system alongside the drawn controls.

## Do's and Don'ts

### Do

- Do keep quantities, units, source quotations and written status close enough to inspect together.
- Do use tabular numerals for amounts, serving counts, formulas and multipliers.
- Do preserve a clear difference between the inset measurement instrument and the flat ingredient ledger.
- Do retain visible keyboard focus, persistent field labels and reduced-motion behavior.
- Do let long quantities and source text wrap without widening their column.

### Don't

- Don't imply certainty through color or a large number when the measurement is unresolved.
- Don't turn ingredient rows or transcript turns into separate floating cards.
- Don't add fake brushed textures, decorative photography or unrelated technical motifs.
- Don't substitute Unicode arrows or emoji for the authored SVG icon system.
- Don't reuse the measurement transition as an entrance effect on every section.
