#!/usr/bin/env node

const live = process.env.CALLE_LIVE_CALLS === "true";
const errors = [];
const warnings = [];

function exactHttpsOrigin(value, label) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      errors.push(`${label} must be an exact HTTPS origin: ${value}`);
    }
  } catch {
    errors.push(`${label} is not a valid absolute origin: ${value}`);
  }
}

if (live) {
  if (process.env.CALLE_KILL_SWITCH === "true") errors.push("kill switch is active while live calling is enabled");
  if (process.env.CALLE_LIVE_INTENT_REQUIRED !== "true") errors.push("CALLE_LIVE_INTENT_REQUIRED must be true in live mode");
  if (process.env.CALLE_LIVE_LOOPBACK_ONLY !== "true" && !process.env.CALLE_OPERATOR_TOKEN) {
    errors.push("non-loopback live mode requires CALLE_OPERATOR_TOKEN");
  }
  if (!process.env.CALLE_API_KEY) errors.push("CALLE_API_KEY is required in live mode");
  if (!process.env.CALLE_WEBHOOK_SECRET) errors.push("CALLE_WEBHOOK_SECRET is required in live mode");
  if (!process.env.CALLE_APPROVED_PROVIDER_ORIGINS && !process.env.CALLE_BASE_URL) {
    errors.push("an approved CALL-E provider origin is required in live mode");
  }
} else {
  warnings.push("live calling is disabled; readiness is validating fail-closed demo/dry-run posture");
}

for (const origin of (process.env.CALLE_APPROVED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
  exactHttpsOrigin(origin, "credentialed origin");
}
for (const origin of (process.env.CALLE_APPROVED_PROVIDER_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
  exactHttpsOrigin(origin, "provider origin");
}

for (const warning of warnings) console.log(`[CALL-E READINESS] WARN: ${warning}`);
if (errors.length) {
  console.error("[CALL-E READINESS] FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("[CALL-E READINESS] PASS");
