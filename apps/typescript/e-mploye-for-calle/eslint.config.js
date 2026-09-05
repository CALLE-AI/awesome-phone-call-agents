import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "data", "*.timestamp-*.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["server/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: {
      globals: {
        AbortController: "readonly",
        Request: "readonly",
        Response: "readonly",
        URL: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  { rules: { "@typescript-eslint/no-explicit-any": "off" } },
);
