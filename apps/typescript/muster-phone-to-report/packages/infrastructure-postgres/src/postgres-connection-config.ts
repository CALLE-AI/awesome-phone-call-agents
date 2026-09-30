const configurationError = (): TypeError =>
  new TypeError("Invalid PostgreSQL configuration: DATABASE_URL");

export function validatePostgresConnectionString(connectionString: string): string {
  if (connectionString.length === 0 || connectionString !== connectionString.trim()) {
    throw configurationError();
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw configurationError();
  }

  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hostname.length === 0 ||
    parsed.username.length === 0 ||
    parsed.password.length === 0 ||
    parsed.pathname.length <= 1
  ) {
    throw configurationError();
  }

  return connectionString;
}
