import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0c0a08",
          900: "#131110",
          850: "#1a1714",
          800: "#221f1b",
          700: "#2e2a24",
          600: "#3d3830",
          500: "#4c463c",
        },
        paper: {
          100: "#f5f0e7",
          200: "#e7ddcc",
          300: "#c9bda6",
          400: "#a79b86",
          500: "#7f7566",
        },
        accent: {
          DEFAULT: "#e0964e",
          soft: "#f0b478",
          dim: "#a86e39",
        },
        good: {
          DEFAULT: "#84ad6c",
          soft: "#a3c78d",
        },
        warn: {
          DEFAULT: "#d99a3c",
          soft: "#e6b869",
        },
        bad: {
          DEFAULT: "#c8735f",
          soft: "#d99080",
        },
      },
      fontFamily: {
        serif: ["Georgia", "Cambria", "Times New Roman", "serif"],
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
        winner: "0 0 0 1px rgba(224,150,78,0.35), 0 12px 40px -16px rgba(224,150,78,0.28)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out both",
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
