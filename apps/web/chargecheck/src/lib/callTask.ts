import { Station, ConnectorType } from "./types";

/**
 * The recipient result schema, built to the documented CALL-E schema
 * constraints (docs.heycall-e.com/calls#structured-results):
 *   - supported: type, properties, required, enum, nested object, simple
 *     array.items, description, additionalProperties: false
 *   - unsupported: $ref, oneOf/anyOf/allOf, recursive schemas
 * We avoid the reserved recipient-result field names the docs call out
 * (summary, status, transcript, call_id, timing fields).
 */
export function buildRecipientResultSchema(connector: ConnectorType) {
  return {
    type: "object",
    required: [
      "operational",
      "available_chargers",
      "total_chargers",
      "requested_connector_available",
      "queue_present",
      "estimated_wait_minutes",
      "price_per_kwh",
      "payment_requirements",
      "accessibility",
      "notes",
      "answered_by",
    ],
    properties: {
      operational: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description:
          "Whether the station's EV chargers are currently operational, per the person on the call. Use unknown if not confirmed.",
      },
      available_chargers: {
        type: "integer",
        description:
          "Number of chargers reported as available right now. Use -1 if not stated.",
      },
      total_chargers: {
        type: "integer",
        description: "Total number of chargers at the station, if stated. Use -1 if not stated.",
      },
      requested_connector_available: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description: `Whether a working ${connector} connector is available right now. Use unknown if not confirmed.`,
      },
      queue_present: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description: "Whether there is currently a queue or a vehicle waiting.",
      },
      estimated_wait_minutes: {
        type: "integer",
        description: "Estimated wait in minutes if a queue exists. Use -1 if unknown or not applicable.",
      },
      price_per_kwh: {
        type: "string",
        description: "The current charging price as stated on the call, or an empty string if not mentioned.",
      },
      payment_requirements: {
        type: "string",
        description:
          "Any app, membership, or specific payment method required to use the charger, or an empty string if none was mentioned.",
      },
      accessibility: {
        type: "string",
        description: "Whether the charger is accessible right now (open, blocked, under construction, etc.).",
      },
      notes: {
        type: "string",
        description: "Any other relevant detail, uncertainty, or contradiction the recipient mentioned.",
      },
      answered_by: {
        type: "string",
        enum: ["human", "ivr", "voicemail", "unknown"],
        description:
          "Classify the final endpoint. If an IVR transfers the call to a person, use human.",
      },
    },
    additionalProperties: false,
  } as const;
}

export function buildTask(station: Station, connector: ConnectorType): string {
  return [
    `Call ${station.name} (${station.address}) to check whether a working ${connector} charger is currently available there for a driver who may arrive shortly — the connector type is the single most important thing to confirm, do not drop it even when paraphrasing or summarizing the request. If you reach a general support line rather than the station itself, ask specifically about the ${connector} charger at this address, not chargers in general.`,
    `Introduce yourself briefly and disclose you are an AI assistant calling on behalf of a driver, e.g. "Hi, I'm an AI assistant calling to check whether a ${connector} charger at [address] is currently operational and available for a customer who may be arriving shortly."`,
    `Find out, in this order of importance: (1) is a ${connector} connector specifically available right now — ask this explicitly by name, do not just ask about "the chargers" generically, (2) are the chargers at this location currently operational, (3) how many chargers total are available right now, (4) is there a queue or wait, (5) the current charging price, (6) any app/membership/payment method required, (7) whether the charger is accessible right now, (8) any temporary issue the driver should know about.`,
    `Ask only the questions still needed given what has already been said — do not repeat a question the recipient already answered.`,
    `If the chargers are reported down or out of service, do not continue asking about price or payment.`,
    `Never invent an answer. If the recipient is uncertain or gives contradictory information, record that in notes instead of resolving it yourself.`,
  ].join(" ");
}
