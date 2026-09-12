/**
 * Design tokens, extracted from the supplied product screenshot (section 19/43).
 *
 * Tokens, not components: the web app renders them as CSS custom properties and
 * React Native consumes the same objects directly, so the two clients cannot
 * drift apart. Values were measured off the screenshot rather than invented —
 * the pale blue-tinted page, the near-black pill button, the hairline borders
 * and the generous card radii are the design's signature and are preserved.
 */

export const colors = {
  /** Page background: a very light blue-tinted neutral, not pure white. */
  background: '#f4f7fb',
  /** Cards, the composer, and the main panel. */
  surface: '#ffffff',
  surfaceMuted: '#fafbfd',
  /** Hairline borders — light enough to read as a seam, not a line. */
  border: '#e4e9f2',
  borderStrong: '#d3dae6',

  textPrimary: '#14181f',
  textSecondary: '#59636f',
  textMuted: '#8b95a3',
  textPlaceholder: '#9aa3b0',

  /** The near-black primary action (the "New Chat" pill). */
  primary: '#17191d',
  primaryHover: '#2a2d33',
  primaryText: '#ffffff',

  /** The circular send button. */
  send: '#4b5563',
  sendHover: '#374151',

  /** Status colours for task states. */
  success: '#0f9d76',
  successSoft: '#e6f6f1',
  warning: '#b45309',
  warningSoft: '#fdf3e7',
  danger: '#c0392f',
  dangerSoft: '#fdeceb',
  info: '#2563eb',
  infoSoft: '#eaf0fe',
  /** The small teal marker beside an active recent item. */
  active: '#14b8a6',

  focusRing: '#2563eb',
  overlay: 'rgba(17, 20, 26, 0.45)',
} as const;

/** Dark theme. The screenshot is a light design; this keeps parity without inventing a new look. */
export const darkColors = {
  ...colors,
  background: '#0d1016',
  surface: '#161a21',
  surfaceMuted: '#1b2029',
  border: '#252b35',
  borderStrong: '#333a46',
  textPrimary: '#f2f5f9',
  textSecondary: '#a8b2c0',
  textMuted: '#78828f',
  textPlaceholder: '#6b7280',
  primary: '#f2f5f9',
  primaryHover: '#dfe4ea',
  primaryText: '#14181f',
  send: '#8b95a3',
  sendHover: '#a8b2c0',
  successSoft: '#0e2a22',
  warningSoft: '#2b2113',
  dangerSoft: '#2c1715',
  infoSoft: '#141f38',
} as const;

/** 4px base scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
  '4xl': 64,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 12,
  xl: 16,
  '2xl': 20,
  pill: 999,
} as const;

export const typography = {
  fontFamily:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  size: {
    xs: 12,
    sm: 13,
    base: 15,
    md: 16,
    lg: 18,
    xl: 22,
    '2xl': 28,
    /** The hero line: "Let Dial make the call for you". */
    '3xl': 36,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeight: {
    tight: 1.2,
    snug: 1.35,
    normal: 1.55,
  },
} as const;

/** Deliberately soft — the design leans on borders, not drop shadows. */
export const shadows = {
  none: 'none',
  sm: '0 1px 2px rgba(20, 24, 31, 0.04)',
  md: '0 2px 8px rgba(20, 24, 31, 0.06)',
  lg: '0 8px 24px rgba(20, 24, 31, 0.08)',
  focus: '0 0 0 3px rgba(37, 99, 235, 0.35)',
} as const;

export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export const motion = {
  fast: '120ms',
  base: '180ms',
  slow: '280ms',
  easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
} as const;

export const layout = {
  sidebarWidth: 264,
  contentMaxWidth: 1120,
  composerMaxWidth: 1100,
} as const;

/** Maps a task state to its status colour pair. */
export type StatusTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger';

export const STATE_TONES: Record<string, StatusTone> = {
  created: 'neutral',
  interpreting: 'active',
  needs_user_input: 'warning',
  researching: 'active',
  candidates_ready: 'active',
  planning_calls: 'active',
  calling: 'active',
  collecting_results: 'active',
  comparing: 'active',
  awaiting_confirmation: 'warning',
  executing_action: 'active',
  completed: 'success',
  partially_completed: 'warning',
  failed: 'danger',
  canceled: 'neutral',
};

export function toneColors(tone: StatusTone, dark = false) {
  const c = dark ? darkColors : colors;
  switch (tone) {
    case 'success':
      return { fg: c.success, bg: c.successSoft };
    case 'warning':
      return { fg: c.warning, bg: c.warningSoft };
    case 'danger':
      return { fg: c.danger, bg: c.dangerSoft };
    case 'active':
      return { fg: c.info, bg: c.infoSoft };
    default:
      return { fg: c.textSecondary, bg: c.surfaceMuted };
  }
}

/** Emits the light/dark token blocks the web app drops into its global stylesheet. */
export function cssVariables(): string {
  const toVars = (palette: Record<string, string>) =>
    Object.entries(palette)
      .map(([key, value]) => `  --color-${kebab(key)}: ${value};`)
      .join('\n');

  const scale = (prefix: string, values: Record<string, number | string>) =>
    Object.entries(values)
      .map(([key, value]) => `  --${prefix}-${key}: ${typeof value === 'number' ? `${value}px` : value};`)
      .join('\n');

  return [
    ':root {',
    toVars(colors as unknown as Record<string, string>),
    scale('space', spacing as unknown as Record<string, number>),
    scale('radius', radius as unknown as Record<string, number>),
    scale('text', typography.size as unknown as Record<string, number>),
    `  --font-sans: ${typography.fontFamily};`,
    `  --shadow-sm: ${shadows.sm};`,
    `  --shadow-md: ${shadows.md};`,
    `  --shadow-lg: ${shadows.lg};`,
    `  --sidebar-width: ${layout.sidebarWidth}px;`,
    `  --content-max: ${layout.contentMaxWidth}px;`,
    `  --motion-base: ${motion.base};`,
    `  --easing: ${motion.easing};`,
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    toVars(darkColors as unknown as Record<string, string>).replace(/^/gm, '  '),
    '  }',
    '}',
    '',
    ':root[data-theme="dark"] {',
    toVars(darkColors as unknown as Record<string, string>),
    '}',
  ].join('\n');
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
