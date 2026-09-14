import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
