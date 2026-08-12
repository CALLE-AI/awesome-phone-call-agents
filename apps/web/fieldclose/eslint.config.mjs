import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".claude/**",
    ".next/**",
    ".next-e2e/**",
    ".next-verify/**",
    "coverage/**",
    "dist/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
