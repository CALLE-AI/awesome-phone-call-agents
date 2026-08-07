export const localDatabaseUrl =
  "postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose";

export function resolveDatabaseUrl(value: string | undefined) {
  return value?.trim() || localDatabaseUrl;
}
