export const PHONE_PROPERTY_OPTIONS = [
  { label: "Phone", value: "phone" },
  { label: "Mobile phone", value: "mobilephone" },
];

const CRM_OBJECT_TYPES = {
  "0-1": "contact",
  "0-3": "deal",
};

export function readObjectContext(context = {}) {
  const crm = context.crm || {};
  return {
    objectId: String(crm.objectId || ""),
    objectType: CRM_OBJECT_TYPES[String(crm.objectTypeId || "")] || "",
    portalId: context.portal && context.portal.id ? String(context.portal.id) : "",
  };
}

export function buildCardCallParameters({ objectContext, callTask, phoneProperty, requestId }) {
  const objectType = String(objectContext.objectType || "").trim();
  if (objectType !== "contact" && objectType !== "deal") {
    throw new Error("The App Card requires a supported contact or deal context.");
  }
  return {
    source_object_id: objectContext.objectId,
    source_object_type: objectType,
    call_task: String(callTask || "").trim(),
    phone_property: String(phoneProperty || "phone").trim() || "phone",
    request_id: String(requestId || "").trim(),
    confirmed: true,
  };
}

export function buildCardServerlessRequest(input) {
  const parameters = buildCardCallParameters(input);
  return {
    parameters,
    propertiesToSend: [parameters.phone_property],
  };
}

function createCardRequestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `card-${globalThis.crypto.randomUUID()}`;
  }
  return `card-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function nextCardRequestId(currentRequestId, event, requestIdFactory = createCardRequestId) {
  const current = String(currentRequestId || "").trim();
  if (event === "begin") {
    if (current) return current;
    const created = String(requestIdFactory() || "").trim();
    if (!created) throw new Error("Card request ID generation failed.");
    return created;
  }
  if (event === "ambiguous_error") return current;
  if (event === "cancel" || event === "terminal") return "";
  throw new Error(`Unsupported Card request ID event: ${event}.`);
}

export function buildCallSummary(result = {}) {
  if (result.call_id) {
    return `CALL-E call ${result.call_id} is ${result.status || "queued"} for ${result.masked_phone || "[phone]"}.`;
  }
  if (result.error) {
    return `${result.status || "failed"}: ${result.error}`;
  }
  return result.status || "No CALL-E call was created.";
}

export function readServerlessBody(result) {
  if (!result) {
    return {};
  }
  if (typeof result.body === "string") {
    try {
      return JSON.parse(result.body);
    } catch {
      return {};
    }
  }
  if (result.body && typeof result.body === "object") {
    return result.body;
  }
  if (typeof result === "object") {
    return result;
  }
  return {};
}
