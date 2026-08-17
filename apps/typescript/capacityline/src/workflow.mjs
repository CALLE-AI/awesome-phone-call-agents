export const requirement = {
  partNumber: "EP-220",
  quantity: 6000,
  needBy: "2026-08-11",
  maxUnitPrice: 84,
  currency: "USD",
  requiredCertifications: ["IATF 16949", "ISO 9001"],
};

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
