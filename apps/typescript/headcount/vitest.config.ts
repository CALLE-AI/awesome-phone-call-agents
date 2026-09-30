import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["vendor/core/tests/**/*.test.ts"],
  },
});
