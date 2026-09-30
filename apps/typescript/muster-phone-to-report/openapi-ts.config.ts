import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "docs/api/openapi.yaml",
  output: "packages/api-client/src/generated",
  plugins: [
    { name: "@hey-api/client-fetch", bundle: true, throwOnError: false },
    "@hey-api/typescript",
    "@hey-api/sdk",
  ],
});
