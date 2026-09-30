import { token, semantic } from "@/lib/tokens"

/**
 * Clerk appearance for Arc, light.
 *
 * Values are literals from lib/tokens.ts, not `var(--…)`: Clerk parses
 * `appearance.variables` as colours in JavaScript, where a CSS custom
 * property never resolves. Using literals in `elements` too keeps one rule
 * for the whole object rather than two.
 *
 * `baseTheme: dark` is deliberately gone - Clerk's default is light, which is
 * now the base per BRANDING.md section 0.
 *
 * The Clerk card itself is stripped to nothing: transparent, no border, no
 * shadow, no padding. AuthShell draws the real card so the tuner strip can sit
 * flush inside it and the radius/shadow come from the Arc tokens.
 */
export const arcClerkAppearance = {
  variables: {
    colorBackground: semantic.surface,
    colorInputBackground: semantic.surface,
    colorInputText: semantic.text,
    colorPrimary: semantic.primary,
    colorText: semantic.text,
    colorTextSecondary: semantic.textMuted,
    colorDanger: token.danger,
    colorNeutral: semantic.text,
    borderRadius: token.radiusControl,
    fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  },
  elements: {
    rootBox: { width: "100%" },
    // Clerk v7 wraps the card in cardBox, which carries the real border,
    // shadow and radius. Stripping `card` alone leaves a nested box visible
    // inside ours, so both are flattened.
    cardBox: {
      background: "transparent",
      border: "none",
      boxShadow: "none",
      borderRadius: 0,
      width: "100%",
    },
    card: {
      background: "transparent",
      border: "none",
      boxShadow: "none",
      borderRadius: 0,
      padding: 0,
      width: "100%",
    },
    header: { marginBottom: "4px" },
    headerTitle: {
      color: semantic.text,
      fontFamily: "var(--font-gabarito), ui-sans-serif, system-ui, sans-serif",
      fontSize: "1.25rem",
      fontWeight: 600,
      letterSpacing: "-0.01em",
    },
    headerSubtitle: { color: semantic.textMuted, fontSize: "0.875rem" },

    // Matches Button primary in /dev/ui: --ink fill, --paper text, no shadow.
    formButtonPrimary: {
      background: semantic.primary,
      color: semantic.primaryFg,
      fontSize: "0.875rem",
      fontWeight: 500,
      height: "40px",
      padding: "0 16px",
      borderRadius: token.radiusControl,
      // !important: Clerk's own button shadow is more specific than the
      // appearance object, and section 4 allows no shadow on buttons.
      boxShadow: "none !important",
      textTransform: "none",
      "&:hover": { background: semantic.primary, opacity: 0.85 },
      // Focus ring lives in globals.css - Emotion's unlayered styles beat
      // anything set here. See the "Clerk focus rings" block.
    },

    // Matches the Input primitive: h-10, radius-control, hairline border,
    // 2px lilac-deep focus ring at 2px offset.
    formFieldInput: {
      background: semantic.surface,
      border: `1px solid ${semantic.border}`,
      color: semantic.text,
      borderRadius: token.radiusControl,
      // Clerk sizes its inputs at 36px; the Input primitive is h-10.
      height: "40px !important",
      minHeight: "40px",
      padding: "0 14px",
      fontSize: "1rem",
      boxShadow: "none",
      // Focus ring: see globals.css, "Clerk focus rings".
    },
    formFieldLabel: {
      color: semantic.textMuted,
      fontSize: "0.75rem",
      fontWeight: 500,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    },

    // Reads as the ghost Button primitive: no fill and no visible border until
    // hover, which tints to --lilac. Clerk zeroes the border-width on this
    // element anyway, so `none` is stated rather than left to chance.
    socialButtonsBlockButton: {
      background: "transparent",
      border: "none",
      color: semantic.text,
      borderRadius: token.radiusControl,
      height: "40px !important",
      minHeight: "40px",
      boxShadow: "none !important",
      "&:hover": { background: token.lilac },
      // Focus ring: see globals.css, "Clerk focus rings".
    },
    socialButtonsBlockButtonText: { color: semantic.text, fontWeight: 500 },

    // Clerk's footer ships its own fill and top border; ours is the card.
    footer: {
      background: "transparent",
      border: "none",
      boxShadow: "none",
      padding: "16px 0 0",
      "& + *": { background: "transparent" },
    },
    footerAction: { background: "transparent", border: "none" },
    footerPages: { background: "transparent" },
    main: { gap: "16px" },
    dividerLine: { background: semantic.border },
    dividerText: { color: semantic.textMuted, fontSize: "0.75rem" },
    formFieldInputShowPasswordButton: { color: semantic.textMuted },
    identityPreviewText: { color: semantic.text },
    identityPreviewEditButton: { color: semantic.text },
    footerActionText: { color: semantic.textMuted },
    footerActionLink: {
      color: semantic.text,
      fontWeight: 500,
      textDecoration: "underline",
      textUnderlineOffset: "4px",
    },
    formResendCodeLink: { color: semantic.text },
    otpCodeFieldInput: {
      border: `1px solid ${semantic.border}`,
      color: semantic.text,
      borderRadius: token.radiusControl,
    },
    /* ------------------------------------------------------------------
       Error surfaces.

       Clerk returns structured errors - code, message, long_message - and
       <SignUp /> renders them itself; nothing here ever swallowed them. What
       they lacked was weight: field errors were danger-coloured text at the
       body size, and a form-level failure (a rejected password, a taken
       email, a failed CAPTCHA) arrived as an unstyled line that read as
       chrome rather than as the reason.

       These now match the Input primitive's aria-invalid state: a danger
       border on the offending field, danger text beneath it, and form-level
       errors in a --danger-bg panel so they cannot be mistaken for a caption.
       ------------------------------------------------------------------ */
    formFieldErrorText: {
      color: token.danger,
      fontSize: "0.875rem",
      fontWeight: 500,
      marginTop: "6px",
    },
    formFieldWarningText: { color: token.warning, fontSize: "0.875rem" },
    // Input's error state is driven by aria-invalid; Clerk marks the field
    // with data-invalid, so the same border lands in both.
    formFieldInputGroup: { borderRadius: token.radiusControl },
    alert: {
      background: token.dangerBg,
      border: "none",
      borderRadius: token.radiusControl,
      padding: "12px 14px",
      color: token.danger,
    },
    alertText: { color: token.danger, fontSize: "0.875rem", fontWeight: 500 },
    formFieldSuccessText: { color: token.success, fontSize: "0.875rem" },
  },
} as const

/**
 * UserButton, styled to match the primitives: the avatar is a --bone disc with
 * a hairline ring, and the popover is a --paper card with radius-card and the
 * one shadow. Same literal-values rule as above - Clerk parses these in JS.
 */
export const arcUserButtonAppearance = {
  variables: {
    colorBackground: semantic.surface,
    colorText: semantic.text,
    colorTextSecondary: semantic.textMuted,
    colorPrimary: semantic.primary,
    borderRadius: token.radiusControl,
    fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  },
  elements: {
    userButtonAvatarBox: {
      width: "32px",
      height: "32px",
      border: `1px solid ${semantic.border}`,
      background: token.bone,
    },
    userButtonPopoverCard: {
      background: semantic.surface,
      border: `1px solid ${semantic.border}`,
      borderRadius: token.radiusCard,
      boxShadow: token.shadowCard,
    },
    userButtonPopoverActionButton: { color: semantic.text },
    userButtonPopoverActionButtonText: { color: semantic.text },
    userButtonPopoverFooter: { display: "none" },
  },
} as const

/**
 * UserProfile, for /settings/account.
 *
 * Variables only, deliberately. arcClerkAppearance strips Clerk's card to
 * nothing because AuthShell draws its own around the sign-in form; UserProfile
 * has no such wrapper, and flattening it there would leave the navigation and
 * the panels sharing one undivided surface. So the colours, the radius and the
 * typeface are ours and the structure stays Clerk's.
 *
 * Same literal-values rule as above - Clerk parses these in JavaScript, where
 * a `var(--…)` never resolves.
 */
export const arcUserProfileAppearance = {
  variables: {
    colorBackground: semantic.surface,
    colorInputBackground: semantic.surface,
    colorInputText: semantic.text,
    colorPrimary: semantic.primary,
    colorText: semantic.text,
    colorTextSecondary: semantic.textMuted,
    colorDanger: token.danger,
    colorNeutral: semantic.text,
    borderRadius: token.radiusControl,
    fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  },
  elements: {
    rootBox: { width: "100%" },
    cardBox: {
      width: "100%",
      border: `1px solid ${semantic.border}`,
      borderRadius: token.radiusCard,
      boxShadow: token.shadowCard,
    },
    // "Secured by Clerk" - the same line hidden on the UserButton popover.
    footer: { display: "none" },
  },
} as const
