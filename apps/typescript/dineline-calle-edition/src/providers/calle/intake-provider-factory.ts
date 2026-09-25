import { CalleIntakeProvider } from "./calle-intake-provider.js";
import { CALLE_BOUNDED_TIMEOUT_MS } from "./calle-sdk-provider.js";
import { FixturePreferenceIntakeProvider } from "./fixture-intake-provider.js";
import type { PreferenceIntakeProvider } from "./intake-types.js";
import { parseAllowedPhoneNumbers } from "./phone-allowlist.js";

export function createPreferenceIntakeProvider(
  environment: NodeJS.ProcessEnv = process.env,
): PreferenceIntakeProvider {
  const mode = environment.DINELINE_CALL_MODE ?? "fixture";

  if (mode === "fixture") {
    return new FixturePreferenceIntakeProvider("complete");
  }

  if (mode !== "real") {
    throw new Error(`Unsupported DINELINE_CALL_MODE: ${mode}`);
  }

  if (environment.DINELINE_ALLOW_REAL_INTAKE_CALLS !== "true") {
    throw new Error(
      "Real intake mode requires DINELINE_ALLOW_REAL_INTAKE_CALLS=true",
    );
  }

  return new CalleIntakeProvider({
    apiKey: environment.CALLE_API_KEY ?? "",
    allowRealCalls: true,
    allowedPhoneNumbers: parseAllowedPhoneNumbers(
      environment.DINELINE_ALLOWED_INTAKE_PHONES,
      "DINELINE_ALLOWED_INTAKE_PHONES",
    ),
    timeoutMs: CALLE_BOUNDED_TIMEOUT_MS,
  });
}
