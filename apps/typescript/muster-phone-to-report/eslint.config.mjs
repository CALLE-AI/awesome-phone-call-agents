import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-demo/**",
      "**/dist-types/**",
      "**/.build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "packages/api-client/src/generated/**",
      "memory-bank/**",
      "docs/spikes/**",
      "tools/spikes/**",
      "tests/fixtures/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    rules: {
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@muster/*/src", "@muster/*/src/**", "@muster/*/dist", "@muster/*/dist/**"],
              message: "Cross-workspace imports must use an exported public entry point.",
            },
            {
              group: [
                "**/packages/*/src",
                "**/packages/*/src/**",
                "**/apps/*/src",
                "**/apps/*/src/**",
              ],
              message: "Relative cross-workspace source imports are forbidden.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/{domain,application}/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@nestjs/**",
                "@prisma/**",
                "pg-boss",
                "pino",
                "@opentelemetry/**",
                "react",
                "vite",
              ],
              message: "Framework and vendor packages belong outside inner layers.",
            },
            {
              group: ["@muster/*/src", "@muster/*/src/**", "@muster/*/dist", "@muster/*/dist/**"],
              message: "Cross-workspace imports must use an exported public entry point.",
            },
          ],
        },
      ],
    },
  },
);
