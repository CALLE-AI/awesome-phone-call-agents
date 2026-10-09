/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    fontFamily: {
      sans: ['"IBM Plex Sans"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      mono: ['"IBM Plex Mono"', 'ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
    },
    extend: {
      colors: {
        ground: '#f4f4f1',
        surface: '#ffffff',
        strip: '#fafaf8',
        active: '#f7f8fb',
        border: '#e3e3df',
        divider: '#ecece8',
        edge: '#d9d9d4',
        text: '#17181c',
        muted: '#5d5f66',
        faint: '#8a8b91',
        null: '#a3a4a9',
        accent: { DEFAULT: '#2b4c8c', tint: '#e7edf8', hover: '#1f3a6e' },
        verified: { DEFAULT: '#2f8a5b', text: '#1f5a3b', tint: '#dff0e5', banner: '#eef6f0', border: '#cfe5d6' },
        partial: { DEFAULT: '#9a6a12', tint: '#fff7dc' },
        rejected: { DEFAULT: '#9a2f2f', tint: '#fbeaea' },
        // The left rail is graphite so the working surface reads as the document and the
        // navigation recedes — the Linear/Palantir move. Everything on it is defined here so a
        // page never has to guess a rail colour.
        rail: {
          DEFAULT: '#16181d', raised: '#1e2128', edge: '#2a2e37',
          text: '#c9ccd4', muted: '#7f848f', active: '#ffffff', tint: '#232833',
        },
        // Incident priority, 1 (life safety) to 5 (routine). Named by meaning, not by hue, so a
        // component never encodes the scale itself.
        p1: { DEFAULT: '#b3261e', tint: '#fdeceb', text: '#8c1d18' },
        p2: { DEFAULT: '#b5551a', tint: '#fdf0e6', text: '#8a4114' },
        p3: { DEFAULT: '#9a6a12', tint: '#fff7dc', text: '#6f4d0d' },
        p4: { DEFAULT: '#2b4c8c', tint: '#e7edf8', text: '#22406f' },
        p5: { DEFAULT: '#5d5f66', tint: '#f1f1ef', text: '#4a4c52' },
      },
      fontSize: {
        11: ['11px', '1.4'],
        12: ['12px', '1.4'],
        13: ['13px', '1.45'],
        14: ['14px', '1.4'],
        15: ['15px', '1.45'],
        20: ['20px', '1.2'],
        22: ['22px', '1.2'],
        26: ['26px', '1.1'],
      },
      borderRadius: {
        DEFAULT: '6px',
        pill: '4px',
      },
      boxShadow: {
        none: 'none',
        activeRow: 'inset 2px 0 0 #2b4c8c',
        railRow: 'inset 2px 0 0 #ffffff',
        panel: '0 1px 2px rgba(16,18,22,0.04), 0 4px 12px rgba(16,18,22,0.06)',
        toast: '0 8px 28px rgba(16,18,22,0.16)',
      },
      keyframes: {
        pulseDot: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideIn: { from: { opacity: '0', transform: 'translateX(12px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        // A light bar on a moving unit. Real vehicles alternate; so does this.
        beaconL: { '0%, 49%': { opacity: '1' }, '50%, 100%': { opacity: '0.15' } },
        beaconR: { '0%, 49%': { opacity: '0.15' }, '50%, 100%': { opacity: '1' } },
      },
      animation: {
        pulseDot: 'pulseDot 1.2s ease-in-out infinite',
        fadeIn: 'fadeIn 150ms ease-out',
        slideIn: 'slideIn 180ms cubic-bezier(0.22,1,0.36,1)',
        beaconL: 'beaconL 900ms steps(1,end) infinite',
        beaconR: 'beaconR 900ms steps(1,end) infinite',
      },
    },
  },
  plugins: [],
}
