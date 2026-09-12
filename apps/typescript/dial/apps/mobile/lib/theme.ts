/**
 * The same tokens the web app uses, expressed for React Native.
 * Kept as a local module because Metro should not have to resolve a TS package
 * at runtime for something this small — but the values are identical, and a
 * change to the palette belongs in both places.
 */
export const colors = {
  background: '#f6f7fb',
  surface: '#ffffff',
  surfaceMuted: '#f8f9fc',
  border: '#e6e9f0',
  borderStrong: '#d0d6e2',
  textPrimary: '#0f1420',
  textSecondary: '#59636f',
  // Was #8b95a3 -- 3.03:1 on white, which fails WCAG AA for the labels and
  // timestamps it was being used for.
  textMuted: '#626a77',
  textPlaceholder: '#8b95a3',
  // Indigo 600: 6.29:1 against white in both directions, so it works as a
  // button fill with white text and as a selected-tab tint.
  primary: '#4f46e5',
  primaryHover: '#4338ca',
  primaryText: '#ffffff',
  brandSoft: '#eef2ff',
  brandBorder: '#c7d2fe',
  send: '#4f46e5',
  success: '#036b4a',
  successSoft: '#e6f6f1',
  warning: '#92400e',
  warningSoft: '#fdf3e7',
  danger: '#b02a20',
  dangerSoft: '#fdeceb',
  info: '#1d4ed8',
  infoSoft: '#eaf0fe',
  active: '#0d9488',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 10, lg: 14, xl: 18, pill: 999 };
export const text = {
  xs: 12,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 30,
};

/**
 * Elevation, matching the web's two-layer shadows: a tight contact shadow plus
 * a wider ambient one. React Native takes them separately per platform.
 */
export const elevation = {
  card: {
    shadowColor: '#0f1420',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;

export const STATE_TONE: Record<string, { bg: string; fg: string }> = {
  completed: { bg: colors.successSoft, fg: colors.success },
  partially_completed: { bg: colors.warningSoft, fg: colors.warning },
  failed: { bg: colors.dangerSoft, fg: colors.danger },
  canceled: { bg: colors.surfaceMuted, fg: colors.textSecondary },
  needs_user_input: { bg: colors.warningSoft, fg: colors.warning },
  awaiting_confirmation: { bg: colors.warningSoft, fg: colors.warning },
};

export function toneFor(state: string) {
  return STATE_TONE[state] ?? { bg: colors.infoSoft, fg: colors.info };
}

export const LIVE_STATES = new Set([
  'created',
  'interpreting',
  'researching',
  'candidates_ready',
  'planning_calls',
  'calling',
  'collecting_results',
  'comparing',
  'executing_action',
]);
