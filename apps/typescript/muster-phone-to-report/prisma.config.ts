import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migration credentials are intentionally distinct from runtime DATABASE_URL bindings.
    url: env("MIGRATION_DATABASE_URL"),
  },
});
