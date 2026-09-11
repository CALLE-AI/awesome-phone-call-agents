/**
 * The free counter probes need a destination that is well formed but sits in a
 * region the account cannot call. Such a request passes payload validation,
 * reaches the planner, and is refused there, which is what makes the rate-limit
 * counter readable without connecting anything.
 *
 * The number is deliberately not baked in. It is a real, dialable line in
 * somebody's country, and if coverage for that region is switched on the probe
 * stops being refused and starts ringing a stranger's phone. Choosing it is the
 * operator's decision, taken once, in their own environment.
 *
 *   CALLE_UNSUPPORTED_PHONE   E.164, a number you control
 *   CALLE_UNSUPPORTED_REGION  ISO country code, defaults to PE
 *   CALLE_UNSUPPORTED_LOCALE  defaults to es-PE
 */

export type Destination = { phones: string[]; region: string; locale: string };

export function unsupportedDestination(): Destination {
  const phone = process.env.CALLE_UNSUPPORTED_PHONE ?? "";
  if (phone === "") {
    throw new Error(
      "CALLE_UNSUPPORTED_PHONE is not set.\n" +
        "These probes read the rate-limit counter by sending a well-formed request to a\n" +
        "region this account cannot call, so the planner refuses it and nothing is dialled.\n" +
        "Set it to a number you control, in a region CALL-E does not serve, and check that\n" +
        "the region is still unsupported before running. If coverage arrives, the probe\n" +
        "will place a real call to that number.",
    );
  }
  return {
    phones: [phone],
    region: process.env.CALLE_UNSUPPORTED_REGION ?? "PE",
    locale: process.env.CALLE_UNSUPPORTED_LOCALE ?? "es-PE",
  };
}
