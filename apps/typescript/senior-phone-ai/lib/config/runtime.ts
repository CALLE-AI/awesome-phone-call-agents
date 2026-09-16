export type RuntimeMode = "preview" | "live";

export type ServerEnvironment = Readonly<Record<string, string | undefined>>;

export function parseRuntimeMode(environment: ServerEnvironment): RuntimeMode {
  const value = environment.SENIOR_PHONE_AI_MODE?.trim();
  if (value === undefined || value === "" || value === "preview") return "preview";
  if (value === "live") return "live";
  throw new Error("SENIOR_PHONE_AI_MODE must be either preview or live");
}

export function readSecret(name: string, environment: ServerEnvironment): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for this server-side integration`);
  if (value.length < 16) throw new Error(`${name} must not be a placeholder or short test value`);
  return value;
}
