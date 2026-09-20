import {
  CALLE_BOUNDED_TIMEOUT_MS,
  CalleSdkProvider,
} from "./calle-sdk-provider.js";
import { FixtureBookingProvider } from "./fixture-provider.js";
import { parseAllowedPhoneNumbers } from "./phone-allowlist.js";
import type { BookingCallProvider } from "./types.js";

export function createBookingCallProvider(
  environment: NodeJS.ProcessEnv = process.env,
): BookingCallProvider {
  const mode = environment.DINELINE_CALL_MODE ?? "fixture";

  if (mode === "fixture") {
    return new FixtureBookingProvider("confirmed");
  }

  if (mode !== "real") {
    throw new Error(`Unsupported DINELINE_CALL_MODE: ${mode}`);
  }

  if (environment.DINELINE_ALLOW_REAL_CALLS !== "true") {
    throw new Error("Real mode requires DINELINE_ALLOW_REAL_CALLS=true");
  }

  return new CalleSdkProvider({
    apiKey: environment.CALLE_API_KEY ?? "",
    allowRealCalls: true,
    allowedPhoneNumbers: parseAllowedPhoneNumbers(
      environment.DINELINE_ALLOWED_BOOKING_PHONES,
      "DINELINE_ALLOWED_BOOKING_PHONES",
    ),
    timeoutMs: CALLE_BOUNDED_TIMEOUT_MS,
  });
}
