export type RealtimeErrorDiagnostic = Readonly<{
  code: string;
}>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

export function describeRealtimeError(value: unknown): RealtimeErrorDiagnostic {
  const outer = asRecord(value);
  const nested = asRecord(outer?.error);
  const candidates = [nested?.code, nested?.type, outer?.code, outer?.type];
  const code = candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0);
  return { code: typeof code === "string" ? code.slice(0, 80) : "unknown" };
}
