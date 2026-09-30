/**
 * Arc design tokens as JS literals.
 *
 * THE ONLY PLACE outside CSS where an Arc colour may be written as a hex.
 * BRANDING.md section 0 bans hardcoded colour in components, and everything
 * that can use a token class or `var(--…)` still must.
 *
 * This module exists for one reason: Clerk parses `appearance.variables` as
 * colours in JavaScript, so `var(--bg)` does not resolve there - it silently
 * breaks Clerk's theming. Any other JS consumer that cannot read CSS custom
 * properties belongs here too.
 *
 * These values MUST stay in sync with the `:root` block in app/globals.css.
 * If a palette value changes there, change it here in the same commit.
 */
export const token = {
  // palette
  bone: "#FBFAF7",
  paper: "#FFFFFF",
  ink: "#141118",
  graphite: "#6C6676",
  hairline: "#E8E4EF",
  lilac: "#DCD8FB",
  lilacDeep: "#A79BF2",
  blush: "#FBC7E6",
  blushDeep: "#F08FCE",
  butter: "#FAEDA1",
  butterDeep: "#F2D64F",

  // status
  danger: "#C4356B",
  dangerBg: "#FBE4EE",
  success: "#1F7A5C",
  warning: "#8A5A00",

  // shape
  radiusCard: "24px",
  radiusControl: "12px",
  radiusPill: "999px",

  // the one shadow
  shadowCard:
    "0 1px 2px rgba(20, 17, 24, 0.04), 0 8px 32px rgba(20, 17, 24, 0.06)",
} as const

/** Semantic aliases, mirroring the CSS layer. */
export const semantic = {
  bg: token.bone,
  surface: token.paper,
  text: token.ink,
  textMuted: token.graphite,
  border: token.hairline,
  primary: token.ink,
  primaryFg: token.paper,
  accent: token.butter,
  focus: token.lilacDeep,
} as const
