import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    fontFamily: {
      sans: ["var(--font-sans)", "sans-serif"],
    },
    extend: {
      colors: {
        canvas: "#f3f3f3",
        card: "#ffffff",
        ink: "#0d0d0d",
        mute: "#5e5e5e",
        line: "#ebebeb",
        accent: "#0d0d0d",
        critical: "#de1135",
        follow: "#ed6c02",
        safe: "#06c167",
        unaccounted: "#c4841d",
        live: "#1a73e8",
      },
      boxShadow: {
        card: "0 1px 2px rgba(13,13,13,0.04), 0 8px 24px rgba(13,13,13,0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
