import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  /**
   * Three React Compiler rules, downgraded from error to warning.
   *
   * Stated here rather than as scattered per-line disables, so the judgement
   * is in one reviewable place and can be argued with.
   *
   * `purity` flags Date.now() inside functions declared in a component body.
   * Ours are call-timing helpers reached only from onClick - they never run
   * during render - but the compiler cannot prove the call site, so it assumes
   * the worst. Correct to warn about in general; a false positive here.
   *
   * `set-state-in-effect` flags reading client-only state after mount:
   * localStorage, location.hash, IntersectionObserver, matchMedia. None of
   * those exist during server rendering, so the value CANNOT be computed in
   * the initial state without breaking SSR or causing a hydration mismatch.
   * The extra render pass the rule objects to is the price of that pattern,
   * not a mistake in it.
   *
   * Warnings, not off: if one of these ever fires somewhere it IS a bug, it
   * should still be visible.
   */
  {
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  /**
   * Test harnesses only. A probe component writes a hook's return value out
   * of the render so assertions can reach it - which react-hooks objects to
   * on principle, and is right to in component code. Scoped to tests/ rather
   * than allowed everywhere.
   */
  {
    files: ["tests/**"],
    rules: {
      "react-hooks/globals": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
