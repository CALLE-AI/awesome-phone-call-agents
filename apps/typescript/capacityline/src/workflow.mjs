export const requirement = {
  partNumber: "EP-220",
  quantity: 6000,
  needBy: "2026-08-11",
  maxUnitPrice: 84,
  currency: "USD",
  requiredCertifications: ["IATF 16949", "ISO 9001"],
};

export const officialCalleBaseUrl = "https://api.heycall-e.com";

export function requireOfficialCalleBaseUrl(configured = process.env.CALLE_BASE_URL) {
  const candidate = configured?.trim() || officialCalleBaseUrl;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("CALLE_BASE_URL must be the official CALL-E HTTPS origin.");
  }
  if (
    url.origin !== officialCalleBaseUrl ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("CALLE_BASE_URL must be the official CALL-E HTTPS origin.");
  }
  return officialCalleBaseUrl;
}

export function parseLiveRecipients(raw) {
  if (!raw) throw new Error("CAPACITYLINE_RECIPIENTS_JSON is required for live mode.");
  const recipients = JSON.parse(raw);
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 8) {
    throw new Error("Provide between one and eight authorized recipients.");
  }
  const e164 = /^\+[1-9]\d{7,14}$/;
  if (recipients.some((item) => !item || typeof item.id !== "string" || !e164.test(item.phone))) {
    throw new Error("Every recipient needs an id and valid E.164 phone number.");
  }
  if (new Set(recipients.map(({ phone }) => phone)).size !== recipients.length) {
    throw new Error("Duplicate destination phone numbers are not allowed.");
  }
  return recipients;
}

export const recipientResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "availability_status",
    "quantity_available",
    "earliest_ship_date",
    "unit_price",
    "currency",
    "origin_country",
    "certifications",
    "respondent_title",
    "authority_confirmed",
    "evidence_quote",
  ],
  properties: {
    availability_status: {
      type: "string",
      enum: ["available", "partial", "unavailable", "unknown"],
    },
    quantity_available: { type: "integer", minimum: -1 },
    earliest_ship_date: { type: "string" },
    unit_price: { type: "number", minimum: -1 },
    currency: { type: "string" },
    origin_country: { type: "string" },
    certifications: { type: "array", items: { type: "string" } },
    respondent_title: { type: "string" },
    authority_confirmed: { type: "boolean" },
    evidence_quote: { type: "string" },
  },
};

export function buildTask() {
  return [
    "You are CapacityLine, an AI supply recovery assistant.",
    "Identify yourself as an AI, state the buyer and purpose, and ask permission to continue.",
    `Confirm live capacity for ${requirement.quantity} units of ${requirement.partNumber} by ${requirement.needBy}.`,
    `Confirm unit price in ${requirement.currency} under ${requirement.maxUnitPrice}, origin, certifications (${requirement.requiredCertifications.join(", ")}), respondent title, and authority.`,
    "Read the material terms back once.",
    "Do not place an order, promise payment, disclose another supplier, or imply that a contract exists.",
    "Respect refusal immediately. Return unknown instead of guessing and ground facts in the transcript.",
  ].join(" ");
}

export function buildPayload(recipients) {
  return {
    task: buildTask(),
    recipients: recipients.map(({ phone, region, locale }) => ({
      phones: [phone],
      region,
      locale,
    })),
    resultSchema: {
      type: "object",
      required: ["completed_count"],
      properties: { completed_count: { type: "integer", minimum: 0 } },
    },
    recipientResultSchema,
    metadata: {
      workflow: "capacityline_supply_recovery",
      supplier_ids: recipients.map(({ id }) => id),
      human_approval_required: true,
    },
  };
}

export function maskPhone(phone) {
  return `${phone.slice(0, 3)}••••••${phone.slice(-2)}`;
}
