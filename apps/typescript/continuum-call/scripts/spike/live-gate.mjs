const OFFICIAL_ORIGIN = "https://api.heycall-e.com";

function inCallingWindow(now, timeZone, start, end) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Shared fail-closed gate for raw Phase-0 scripts. Returning a decision instead
 * of throwing lets the scripts emit a useful dry report without any network.
 */
export function checkNamedLiveGate({ experimentId, base, phone, apiKey }) {
  const failures = [];
  if (process.env.SPIKE_LIVE !== "1") failures.push("SPIKE_LIVE_NOT_1");
  if (process.env.SPIKE_STOP !== "0") failures.push("SPIKE_STOP_NOT_EXPLICITLY_0");
  if (!apiKey) failures.push("CALLE_API_KEY_MISSING");
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) failures.push("PHONE_NOT_E164");

  let url = null;
  try {
    url = new URL(base);
  } catch {
    failures.push("BAD_BASE_URL");
  }
  if (
    !url ||
    url.protocol !== "https:" ||
    url.origin !== OFFICIAL_ORIGIN ||
    !["", "/"].includes(url.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    failures.push("NON_OFFICIAL_HTTPS_ORIGIN");
  }

  if (process.env.CALLE_LIVE_EXPERIMENT !== experimentId) {
    failures.push("WRONG_NAMED_EXPERIMENT");
  }
  const expectedConfirmation =
    `CONFIRM_${experimentId}_ONE_ALLOWLISTED_CALL`;
  if (process.env.CALLE_LIVE_CONFIRMATION !== expectedConfirmation) {
    failures.push("EXPERIMENT_CONFIRMATION_MISSING");
  }
  const allowlist = new Set(
    (process.env.CALLE_LIVE_ALLOWLIST || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!allowlist.has(phone)) failures.push("PHONE_NOT_IN_EXPLICIT_ALLOWLIST");
  if (process.env.CALLE_LIVE_CONSENT !== "1") failures.push("CONSENT_NOT_RECORDED");
  if (process.env.CALLE_LIVE_MAX_CALLS !== "1") failures.push("MAX_CALLS_MUST_EQUAL_1");
  const budget = Number(process.env.CALLE_LIVE_BUDGET_REMAINING);
  if (!Number.isInteger(budget) || budget < 1) failures.push("NO_EXPLICIT_BUDGET");

  const timeZone = process.env.CALLE_LIVE_TIMEZONE || "";
  const start = Number(process.env.CALLE_LIVE_WINDOW_START);
  const end = Number(process.env.CALLE_LIVE_WINDOW_END);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > 23 ||
    end < 0 ||
    end > 23
  ) {
    failures.push("INVALID_CALLING_WINDOW");
  } else {
    try {
      if (!timeZone || !inCallingWindow(new Date(), timeZone, start, end)) {
        failures.push("OUTSIDE_CALLING_WINDOW");
      }
    } catch {
      failures.push("INVALID_IANA_TIMEZONE");
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    experiment_id: experimentId,
    expected_confirmation: expectedConfirmation,
  };
}
