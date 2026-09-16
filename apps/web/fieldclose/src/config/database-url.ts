export const localDatabaseUrl =
  "postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose";

export const verifiedDatabaseSslMode = "verify-full" as const;

function isLoopbackHostname(hostname: string) {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "");

  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }

  const octets = normalized.split(".");

  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => {
      if (!/^\d{1,3}$/u.test(octet)) {
        return false;
      }

      const value = Number(octet);
      return value >= 0 && value <= 255;
    })
  );
}

export function resolveDatabaseSslMode(value: string) {
  const databaseUrl = new URL(value);

  return isLoopbackHostname(databaseUrl.hostname)
    ? (false as const)
    : verifiedDatabaseSslMode;
}

export function resolveDatabaseUrl(
  value: string | undefined,
  nodeEnvironment: "development" | "test" | "production" = "development",
) {
  const resolved = value?.trim();

  if (resolved) {
    if (
      nodeEnvironment === "production" &&
      resolveDatabaseSslMode(resolved) === verifiedDatabaseSslMode
    ) {
      const sslModes = new URL(resolved).searchParams.getAll("sslmode");

      if (
        sslModes.length !== 1 ||
        sslModes[0]?.toLowerCase() !== verifiedDatabaseSslMode
      ) {
        throw new Error(
          "A non-loopback production DATABASE_URL must require certificate-verified TLS with sslmode=verify-full",
        );
      }
    }

    return resolved;
  }

  if (nodeEnvironment === "production") {
    throw new Error(
      "DATABASE_URL is required in production; the local database fallback is never used",
    );
  }

  return localDatabaseUrl;
}
