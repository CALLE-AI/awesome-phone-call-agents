import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@muster/application": fileURLToPath(
        new URL("./packages/application/src/index.ts", import.meta.url),
      ),
      "@muster/api-client/simulator-live": fileURLToPath(
        new URL("./packages/api-client/src/simulator-live-client.ts", import.meta.url),
      ),
      "@muster/api-client": fileURLToPath(
        new URL("./packages/api-client/src/index.ts", import.meta.url),
      ),
      "@muster/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url),
      ),
      "@muster/domain": fileURLToPath(new URL("./packages/domain/src/index.ts", import.meta.url)),
      "@muster/infrastructure-postgres": fileURLToPath(
        new URL("./packages/infrastructure-postgres/src/index.ts", import.meta.url),
      ),
      "@muster/infrastructure-local-evidence": fileURLToPath(
        new URL("./packages/infrastructure-local-evidence/src/index.ts", import.meta.url),
      ),
      "@muster/infrastructure-jobs": fileURLToPath(
        new URL("./packages/infrastructure-jobs/src/index.ts", import.meta.url),
      ),
      "@muster/infrastructure-calle": fileURLToPath(
        new URL("./packages/infrastructure-calle/src/index.ts", import.meta.url),
      ),
      "@muster/infrastructure-twilio-simulator": fileURLToPath(
        new URL("./packages/infrastructure-twilio-simulator/src/index.ts", import.meta.url),
      ),
      "@muster/observability/simulator-host": fileURLToPath(
        new URL("./packages/observability/src/simulator-host.ts", import.meta.url),
      ),
      "@muster/observability": fileURLToPath(
        new URL("./packages/observability/src/index.ts", import.meta.url),
      ),
      "@muster/simulator-host": fileURLToPath(
        new URL("./apps/simulator-host/src/index.ts", import.meta.url),
      ),
      "@muster/testing": fileURLToPath(new URL("./packages/testing/src/index.ts", import.meta.url)),
    },
  },
  test: {
    name: "foundation",
    globalSetup:
      process.env["MUSTER_SKIP_POSTGRES_GLOBAL_SETUP"] === "1"
        ? []
        : ["./packages/testing/src/postgres-test-container.ts"],
    include: [
      "packages/{domain,application,infrastructure-postgres,infrastructure-jobs,infrastructure-calle,infrastructure-twilio-simulator,observability}/src/**/*.test.ts",
      "packages/infrastructure-local-evidence/src/**/*.test.ts",
      "packages/api-client/src/**/*.test.ts",
      "packages/testing/src/**/*.test.ts",
      "apps/{api,worker,simulator-host}/src/**/*.test.ts",
      "apps/web/src/**/*.test.tsx",
      "tests/e2e/**/*.integration.test.ts",
      "tools/{architecture,openapi,toolchain}/**/*.test.ts",
      "tools/simulator/**/*.test.ts",
    ],
    exclude: [".build/**", "node_modules/**"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
  },
});
