const supportedCallingRegions = [
  { prefix: "+968", region: "OM", locale: "en-OM" },
  { prefix: "+971", region: "AE", locale: "en-AE" },
  { prefix: "+254", region: "KE", locale: "en-KE" },
  { prefix: "+65", region: "SG", locale: "en-SG" },
  { prefix: "+60", region: "MY", locale: "en-MY" },
  { prefix: "+91", region: "IN", locale: "en-IN" },
  { prefix: "+61", region: "AU", locale: "en-AU" },
  { prefix: "+44", region: "GB", locale: "en-GB" },
  { prefix: "+84", region: "VN", locale: "vi-VN" },
  { prefix: "+49", region: "DE", locale: "de-DE" },
  { prefix: "+81", region: "JP", locale: "ja-JP" },
  { prefix: "+33", region: "FR", locale: "fr-FR" },
  { prefix: "+52", region: "MX", locale: "es-MX" },
  { prefix: "+55", region: "BR", locale: "pt-BR" },
  { prefix: "+62", region: "ID", locale: "en-ID" },
  { prefix: "+63", region: "PH", locale: "en-PH" },
  { prefix: "+1", region: "US", locale: "en-US" },
];

/** @param {string} phone */
export function resolveRecipientConfiguration(phone) {
  const match = supportedCallingRegions.find(({ prefix }) => phone.startsWith(prefix));
  return match ? { region: match.region, locale: match.locale } : null;
}

/** @param {string | undefined} value */
export function parseArrivalMinutes(value) {
  if (!value) return null;
  const match = value.trim().match(/(?:^|\s)(\d{1,2}):(\d{2})\s*(AM|PM)?(?:\s|$)/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (minutes > 59 || hours > (meridiem ? 12 : 23) || (meridiem && hours < 1)) return null;
  if (meridiem === "AM") hours %= 12;
  if (meridiem === "PM") hours = (hours % 12) + 12;
  return hours * 60 + minutes;
}

/**
 * @param {{viable?: boolean, provider_name?: string, arrival_time?: string, extra_cost?: number, confirmation_reference?: string} | null} result
 * @param {number} maximumCost
 * @param {number} deadlineMinutes
 */
export function isCompletedRecoveryOption(result, maximumCost, deadlineMinutes) {
  const arrivalMinutes = parseArrivalMinutes(result?.arrival_time);
  const cost = Number(result?.extra_cost);
  return Boolean(
    result?.viable
    && result.provider_name?.trim()
    && result.confirmation_reference?.trim()
    && arrivalMinutes !== null
    && arrivalMinutes < deadlineMinutes
    && Number.isFinite(cost)
    && cost >= 0
    && cost <= maximumCost,
  );
}
