export const SOURCING_RETENTION_DAYS = 30;

export function sourcingRetentionCutoff(now = new Date()): string {
  return new Date(now.getTime() - SOURCING_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
