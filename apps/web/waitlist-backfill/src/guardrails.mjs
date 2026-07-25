/**
 * Pre-flight guardrails for outbound waitlist calls.
 *
 * Every check returns a decision object rather than throwing, because the audit trail is the
 * product: an operator has to be able to answer "why was this person not called?" months later.
 *
 * Design principles implemented here (see ../../../docs/design-principles.md):
 *   P2 explicit intent      -> requireLiveIntent()
 *   P3 do not guess values  -> checkQuietHours() refuses when the timezone is unknown
 *   P4 no timezone guessing -> resolveTimeZone() accepts ONLY an explicit IANA zone
 *   P6 cancellation         -> isCancelled hook threaded through the run loop
 *   P8 side effects         -> every decision carries a machine-readable reason code
 */

/** E.164: a leading +, a non-zero country digit, then 7-14 more digits. */
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Advice-giving phrasing an automated caller must not read out. The boundary the repo asks for
 * (medical/legal/financial/emergency) is enforced on the operator-supplied message, because that
 * is the only free text that reaches the callee.
 */
const BOUNDARY_PATTERNS = [
  // The dosage alternative sits outside the leading \b on purpose: in "400mg" there is no word
  // boundary before the "mg", so folding it into the group below would silently never match.
  { code: "medical_advice", re: /\d+\s?(?:mg|ml|mcg)\b|\b(?:diagnos\w+|prescrib\w+|dosage|symptoms? (?:mean|indicate)|you should (?:take|stop taking))\b/i },
  { code: "legal_advice", re: /\b(you (?:should|must) (?:sue|plead|sign)|legal(?:ly)? (?:advice|obligated)|waive your right)\b/i },
  { code: "financial_advice", re: /\b(invest\w* in|guaranteed returns?|you should (?:buy|sell) (?:shares|stock|crypto))\b/i },
  { code: "emergency_handling", re: /\b(call 9-?1-?1|emergency services|this is an emergency|life[- ]threatening)\b/i },
];

export function isE164(value) {
  return typeof value === "string" && E164.test(value);
}

/**
 * Mask a phone number for logs and summaries: keep the country code and the last two digits.
 * `+15555550100` -> `+1********00`
 */
export function maskPhone(value) {
  if (typeof value !== "string" || value.length < 5) return "***";
  const cc = value.slice(0, 2);
  const tail = value.slice(-2);
  return `${cc}${"*".repeat(Math.max(0, value.length - 4))}${tail}`;
}

/**
 * P4: the timezone must be supplied explicitly as an IANA identifier.
 *
 * Deliberately NOT accepted: country code, dialling prefix, locale, language, UTC offset, or an
 * abbreviation like "EST". Those all look like answers and are all wrong somewhere — "+1" spans
 * six zones, "EST" is ambiguous between North America and Australia, and a UTC offset cannot
 * survive a daylight-saving boundary. An unknown zone is a refusal, not a guess.
 */
export function resolveTimeZone(explicitZone) {
  if (typeof explicitZone !== "string" || explicitZone.trim() === "") {
    return { ok: false, code: "timezone_missing", detail: "No IANA timezone supplied." };
  }
  const zone = explicitZone.trim();
  if (/^(UTC|GMT)?[+-]\d{1,2}(:\d{2})?$/i.test(zone) || /^[A-Z]{2,5}$/.test(zone)) {
    return {
      ok: false,
      code: "timezone_not_iana",
      detail: `"${zone}" is an offset or abbreviation, not an IANA zone. Use e.g. "America/New_York".`,
    };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    return { ok: false, code: "timezone_unknown", detail: `"${zone}" is not a known IANA timezone.` };
  }
  return { ok: true, zone };
}

/** Local wall-clock parts in an IANA zone. Uses Intl, so the DST rules are the platform's. */
export function localTimeIn(zone, at) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    weekday: get("weekday"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/**
 * Quiet hours are evaluated in the CONTACT's zone, never the server's.
 * `window` is `{ startMinute, endMinute, days }` where days are 3-letter English weekday names.
 */
export function checkQuietHours(contact, policy, at) {
  const tz = resolveTimeZone(contact.timeZone);
  if (!tz.ok) return { allowed: false, ...tz };

  const local = localTimeIn(tz.zone, at);
  if (Array.isArray(policy.days) && !policy.days.includes(local.weekday)) {
    return {
      allowed: false,
      code: "outside_calling_days",
      detail: `${local.weekday} is not a permitted calling day in ${tz.zone}.`,
    };
  }
  if (local.minutes < policy.startMinute || local.minutes >= policy.endMinute) {
    return {
      allowed: false,
      code: "quiet_hours",
      detail: `Local time ${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")} `
        + `in ${tz.zone} is outside ${fmtMinutes(policy.startMinute)}-${fmtMinutes(policy.endMinute)}.`,
    };
  }
  return { allowed: true, code: "within_calling_window", zone: tz.zone, localTime: local };
}

function fmtMinutes(m) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Consent must be on file, un-revoked, and scoped to this kind of call. */
export function checkConsent(contact, scope) {
  const c = contact.consent;
  if (!c || !c.grantedAt) {
    return { allowed: false, code: "no_consent_on_file", detail: "No recorded consent for this contact." };
  }
  if (c.revokedAt) {
    return { allowed: false, code: "consent_revoked", detail: `Consent revoked at ${c.revokedAt}.` };
  }
  if (Array.isArray(c.scopes) && !c.scopes.includes(scope)) {
    return {
      allowed: false,
      code: "consent_scope_mismatch",
      detail: `Consent covers [${c.scopes.join(", ")}], not "${scope}".`,
    };
  }
  return { allowed: true, code: "consent_ok" };
}

/** No more than `maxCalls` completed calls to one contact inside a rolling window. */
export function checkFrequencyCap(history, contactId, policy, at) {
  const since = at.getTime() - policy.windowHours * 3600_000;
  const recent = history.filter((h) => h.contactId === contactId && Date.parse(h.at) >= since);
  if (recent.length >= policy.maxCalls) {
    return {
      allowed: false,
      code: "frequency_cap",
      detail: `${recent.length} call(s) in the last ${policy.windowHours}h reaches the cap of ${policy.maxCalls}.`,
    };
  }
  return { allowed: true, code: "under_frequency_cap", recentCalls: recent.length };
}

/** The operator's message is the only free text that reaches a callee. Keep it inside the lines. */
export function checkContentBoundaries(message) {
  for (const { code, re } of BOUNDARY_PATTERNS) {
    const m = re.exec(message ?? "");
    if (m) {
      return {
        allowed: false,
        code: `boundary_${code}`,
        detail: `Message contains "${m[0]}". This app books appointment slots; it must not give `
          + `medical, legal or financial advice, or handle emergencies.`,
      };
    }
  }
  return { allowed: true, code: "content_ok" };
}

/**
 * P2: live calling requires intent that names the specific slot. A boolean flag is too easy to
 * set by accident (and too easy for an agent to set on a user's behalf); echoing the slot id
 * means the caller had to know what they were authorising.
 */
export function requireLiveIntent(request, slot) {
  if (request.mode !== "live") {
    return { allowed: false, code: "preview_mode", detail: "Preview mode: no calls are placed." };
  }
  if (request.confirmSlotId !== slot.id) {
    return {
      allowed: false,
      code: "intent_not_confirmed",
      detail: `Live mode requires confirmSlotId === "${slot.id}".`,
    };
  }
  return { allowed: true, code: "live_intent_confirmed" };
}

/**
 * Run every check for one contact. Order matters only for which reason surfaces first; all of
 * them are cheap, so the first failure wins and the rest are skipped.
 */
export function evaluateContact({ contact, slot, policy, history, at, message }) {
  const checks = [];
  const record = (name, r) => {
    checks.push({ check: name, ...r });
    return r.allowed;
  };

  if (!isE164(contact.phone)) {
    record("e164", { allowed: false, code: "invalid_phone", detail: "Phone is not valid E.164." });
    return { callable: false, reason: checks.at(-1), checks };
  }
  const ordered = [
    ["consent", () => checkConsent(contact, policy.consentScope)],
    ["content_boundaries", () => checkContentBoundaries(message)],
    ["quiet_hours", () => checkQuietHours(contact, policy.quietHours, at)],
    ["frequency_cap", () => checkFrequencyCap(history, contact.id, policy.frequency, at)],
  ];
  for (const [name, fn] of ordered) {
    if (!record(name, fn())) return { callable: false, reason: checks.at(-1), checks };
  }
  return { callable: true, reason: checks.at(-1), checks };
}
