const {
  buildDirectCallIdempotencyKey,
  buildCandidatePayload,
  createCallECall,
  jsonResponse,
  maskPhoneNumbers,
  readWorkflowInput,
  validateCandidateInput,
  verifyEndpointToken,
} = require("./calle-shared");

exports.main = async (context) => {
  const input = readWorkflowInput(context);
  const validationErrors = validateCandidateInput(input);
  if (validationErrors.length > 0) {
    return jsonResponse(400, {
      success: false,
      outputFields: {
        call_id: "",
        status: validationErrors[0],
        masked_phone: "",
        error: `Invalid CALL-E workflow input: ${validationErrors.join(", ")}.`,
      },
    });
  }

  if (!verifyEndpointToken(input.endpoint_token, process.env.CALLE_WORKFLOW_ENDPOINT_TOKEN)) {
    return jsonResponse(401, {
      success: false,
      outputFields: {
        call_id: "",
        status: "unauthorized",
        masked_phone: "",
        error: "The CALL-E workflow endpoint token is missing or invalid.",
      },
    });
  }

  const candidate = buildCandidatePayload({
    portalId: input.portalId || input.portal_id,
    objectType: input.source_object_type,
    objectId: input.source_object_id,
    workflowRunId: input.workflowRunId || input.workflow_run_id,
    phone: input.phone,
    phoneProperty: input.phone_property,
    callPurpose: input.call_task || input.call_purpose,
    ownerId: "",
    consentAllowed: input.consent_allowed,
    doNotCall: input.do_not_call,
  });

  if (candidate.status !== "candidate") {
    return jsonResponse(200, {
      success: true,
      outputFields: {
        call_id: "",
        status: candidate.status,
        masked_phone: candidate.maskedPhone,
        error: candidate.error ? candidate.error.message : "",
      },
    });
  }

  const workflowRunId = candidate.workflowRunId || "manual";
  const idempotencyKey = buildDirectCallIdempotencyKey({
    portalId: candidate.portalId,
    objectType: candidate.objectType,
    objectId: candidate.objectId,
    workflowRunId,
  });
  let call;
  try {
    call = await createCallECall({
      phone: input.phone,
      task: candidate.callPurpose,
      idempotencyKey,
      metadata: {
        source_platform: "hubspot",
        portal_id: candidate.portalId,
        source_object_type: candidate.objectType,
        source_object_id: candidate.objectId,
        workflow_run_id: workflowRunId,
        phone_property: candidate.phoneProperty,
      },
    });
  } catch (error) {
    return jsonResponse(502, {
      success: false,
      outputFields: {
        call_id: "",
        status: "failed",
        masked_phone: candidate.maskedPhone,
        error: maskPhoneNumbers(error.message, [input.phone]),
      },
    });
  }

  return jsonResponse(200, {
    success: true,
    outputFields: {
      call_id: maskPhoneNumbers(call.id || call.call_id || "", [input.phone]),
      status: maskPhoneNumbers(call.status || "queued", [input.phone]),
      masked_phone: candidate.maskedPhone,
      error: "",
    },
  });
};
