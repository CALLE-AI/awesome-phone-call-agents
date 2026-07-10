const {
  buildCandidatePayload,
  buildDirectCallIdempotencyKey,
  createCallECall,
  isSupportedObjectType,
  jsonResponse,
  maskPhoneNumbers,
  normalizeObjectType,
} = require("./calle-shared");

function cardResponse(statusCode, body) {
  return jsonResponse(statusCode, { retry_same_intent: false, ...body });
}

exports.main = async (context) => {
  const parameters = context.parameters || {};
  const propertiesToSend = context.propertiesToSend && typeof context.propertiesToSend === "object"
    ? context.propertiesToSend
    : {};
  const portalId = String(context.accountId || "").trim();
  const objectType = normalizeObjectType(parameters.source_object_type || parameters.objectType);
  const objectId = String(parameters.source_object_id || parameters.objectId || "").trim();
  const phoneProperty = String(parameters.phone_property || parameters.phoneProperty || "phone").trim().toLowerCase() || "phone";
  const callTask = String(parameters.call_task || parameters.callTask || "").trim();
  const requestId = String(parameters.request_id || parameters.requestId || "").trim();

  if (!portalId) {
    return cardResponse(400, { success: false, call_id: "", status: "missing_account_id", masked_phone: "", error: "HubSpot accountId is required." });
  }
  if (!objectId) {
    return cardResponse(400, { success: false, call_id: "", status: "missing_source_object_id", masked_phone: "", error: "source_object_id is required." });
  }
  if (!isSupportedObjectType(objectType)) {
    return cardResponse(400, { success: false, call_id: "", status: "invalid_object_type", masked_phone: "", error: "source_object_type must be contact or deal." });
  }
  if (!callTask) {
    return cardResponse(400, { success: false, call_id: "", status: "missing_call_task", masked_phone: "", error: "A CALL-E task is required." });
  }
  if (!requestId) {
    return cardResponse(400, { success: false, call_id: "", status: "missing_request_id", masked_phone: "", error: "A Card request ID is required." });
  }
  if (phoneProperty !== "phone" && phoneProperty !== "mobilephone") {
    return cardResponse(400, { success: false, call_id: "", status: "invalid_phone_property", masked_phone: "", error: "Phone property must be phone or mobilephone." });
  }
  if (parameters.confirmed !== true) {
    return cardResponse(400, { success: false, call_id: "", status: "confirmation_required", masked_phone: "", error: "Explicit Card confirmation is required." });
  }

  const phone = String(propertiesToSend[phoneProperty] || "");
  const candidate = buildCandidatePayload({
    portalId,
    objectType,
    objectId,
    workflowRunId: requestId,
    phone,
    phoneProperty,
    callPurpose: callTask,
    ownerId: "",
    consentAllowed: true,
    doNotCall: false,
  });

  if (candidate.status !== "candidate") {
    return cardResponse(200, {
      success: false,
      call_id: "",
      status: candidate.status,
      masked_phone: candidate.maskedPhone,
      error: candidate.error ? candidate.error.message : "",
    });
  }

  const idempotencyKey = buildDirectCallIdempotencyKey({
    portalId,
    objectType,
    objectId,
    workflowRunId: candidate.workflowRunId,
  });
  let call;
  try {
    call = await createCallECall({
      phone,
      task: candidate.callPurpose,
      idempotencyKey,
      metadata: {
        source_platform: "hubspot",
        source_entrypoint: "app_card",
        portal_id: portalId,
        source_object_type: objectType,
        source_object_id: objectId,
        phone_property: phoneProperty,
      },
    });
  } catch (error) {
    return cardResponse(502, {
      success: false,
      call_id: "",
      status: "failed",
      masked_phone: candidate.maskedPhone,
      error: maskPhoneNumbers(error.message, [phone]),
      retry_same_intent: error.retrySameIntent === true,
    });
  }

  return cardResponse(200, {
    success: true,
    call_id: maskPhoneNumbers(call.id || call.call_id || "", [phone]),
    status: maskPhoneNumbers(call.status || "queued", [phone]),
    masked_phone: candidate.maskedPhone,
    error: "",
  });
};
