import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef7ff",
          100: "#d9edff",
          500: "#2f6fed",
          600: "#2258c4",
          700: "#1c469b",
        },
      },
    },
  },
  plugins: [],
};

export default config;
