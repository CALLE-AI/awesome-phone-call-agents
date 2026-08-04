export const localDatabaseUrl =
  "postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose";

export function resolveDatabaseUrl(
  value: string | undefined,
  nodeEnvironment: "development" | "test" | "production" = "development",
) {
  const resolved = value?.trim();

  if (resolved) {
    return resolved;
  }

  if (nodeEnvironment === "production") {
    throw new Error(
      "DATABASE_URL is required in production; the local database fallback is never used",
    );
  }

  return localDatabaseUrl;
}
