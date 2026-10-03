const E164 = /^\+[1-9]\d{6,14}$/;

interface Route {
  prefix: string;
  region: string;
  locale: string;
}

// A subset of CALL-E's published regions, longest prefix first.
const ROUTES: Route[] = [
  { prefix: "+971", region: "AE", locale: "en-AE" },
  { prefix: "+65", region: "SG", locale: "en-SG" },
  { prefix: "+60", region: "MY", locale: "en-MY" },
  { prefix: "+61", region: "AU", locale: "en-AU" },
  { prefix: "+44", region: "GB", locale: "en-GB" },
  { prefix: "+1", region: "US", locale: "en-US" },
];

export type RouteCheck =
  | { ok: true; region: string; locale: string }
  | { ok: false; reason: string };

export function routeFor(phone: string): RouteCheck {
  if (!E164.test(phone)) {
    return { ok: false, reason: "Phone number must be E.164, for example +6591234567." };
  }
  if (phone.startsWith("+62")) {
    return {
      ok: false,
      reason: "CALL-E currently refuses calls to Indonesia (+62). Use a number in a supported region such as Singapore or Malaysia.",
    };
  }
  const route = ROUTES.find((r) => phone.startsWith(r.prefix));
  if (!route) {
    return { ok: false, reason: "This demo only dials SG, MY, US, AU, GB, and AE numbers." };
  }
  return { ok: true, region: route.region, locale: route.locale };
}

export function maskPhone(phone: string): string {
  const route = ROUTES.find((r) => phone.startsWith(r.prefix));
  const prefix = route?.prefix ?? phone.slice(0, 3);
  return `${prefix} ••• ${phone.slice(-4)}`;
}
