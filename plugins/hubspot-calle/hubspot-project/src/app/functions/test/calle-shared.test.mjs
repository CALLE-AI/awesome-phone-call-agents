import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  HIGH_STAKES_SAFETY_INSTRUCTION,
  buildCandidateId,
  buildIdempotencyKey,
  buildCandidatePayload,
  createCallECall,
  isE164Phone,
  maskPhoneNumbers,
  readWorkflowInput,
  validateCandidateInput,
  verifyHubSpotV3Signature,
} = require("../calle-shared.js");
const { main: createCallCandidate } = require("../createCallCandidate.js");
const { main: startCallFromCard } = require("../startCallFromCard.js");

const HUBSPOT_CLIENT_SECRET = "hubspot-client-secret";
const HUBSPOT_WORKFLOW_ACTION_URL = "https://example.hs-sites.com/hs/serverless/calle/create-call";

function signedWorkflowContext(body, overrides = {}) {
  const method = String(overrides.method || "POST").toUpperCase();
  const uri = overrides.uri || HUBSPOT_WORKFLOW_ACTION_URL;
  const timestamp = String(overrides.timestamp || Date.now());
  const signature = createHmac("sha256", HUBSPOT_CLIENT_SECRET)
    .update(`${method}${uri}${JSON.stringify(body)}${timestamp}`, "utf8")
    .digest("base64");
  return {
    method,
    body,
    headers: {
      "x-hubspot-signature-v3": signature,
      "x-hubspot-request-timestamp": timestamp,
      ...(overrides.headers || {}),
    },
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("validates E.164 phone numbers only", () => {
  assert.equal(isE164Phone("+15555550123"), true);
  assert.equal(isE164Phone("+442071838750"), true);
  assert.equal(isE164Phone("5555550123"), false);
  assert.equal(isE164Phone("+0123456789"), false);
  assert.equal(isE164Phone("+1555"), false);
  assert.equal(isE164Phone("+1555555012345678"), false);
});

test("masks phone numbers in summaries and errors", () => {
  const value = "Call +15555550123, (555) 555-0123, 5555550123, or +44 20 7183 8750.";

  assert.equal(
    maskPhoneNumbers(value),
    "Call [phone], [phone], [phone], or [phone]."
  );
});

test("masks every supplied invalid destination value", () => {
  for (const phone of ["5555550123", "tel:555*555*0123 ext ???"]) {
    const payload = buildCandidatePayload({
      portalId: "12345",
      objectType: "contact",
      objectId: "67890",
      workflowRunId: "run-1",
      phone,
      phoneProperty: "phone",
      callPurpose: "Confirm demo request.",
      consentAllowed: true,
      doNotCall: false,
    });

    assert.equal(payload.status, "invalid_phone");
    assert.equal(payload.maskedPhone, "[phone]");
    assert.doesNotMatch(payload.error.message, new RegExp(phone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("builds stable candidate and idempotency identifiers", () => {
  assert.equal(
    buildCandidateId({
      portalId: "12345",
      objectType: "contact",
      objectId: "67890",
      workflowRunId: "run-1",
    }),
    "hubspot:12345:contact:67890:run-1"
  );
  assert.equal(
    buildIdempotencyKey({
      portalId: "12345",
      candidateId: "hubspot:12345:contact:67890:run-1",
    }),
    "hubspot-calle:12345:hubspot:12345:contact:67890:run-1"
  );
});

test("builds a review-only candidate payload for valid high-intent records", () => {
  const payload = buildCandidatePayload({
    portalId: "12345",
    objectType: "contact",
    objectId: "67890",
    workflowRunId: "run-1",
    phone: "+15555550123",
    phoneProperty: "phone",
    callPurpose: "Confirm demo request and qualification fit.",
    ownerId: "321",
    consentAllowed: true,
    doNotCall: false,
  });

  assert.equal(payload.status, "candidate");
  assert.equal(payload.liveCallAllowed, false);
  assert.equal(payload.maskedPhone, "[phone]");
  assert.equal(payload.error, null);
  assert.equal(payload.candidateId, "hubspot:12345:contact:67890:run-1");
});

test("skips candidate creation when the record has no valid callable phone", () => {
  assert.equal(
    buildCandidatePayload({
      portalId: "12345",
      objectType: "contact",
      objectId: "67890",
      workflowRunId: "run-1",
      phone: "",
      phoneProperty: "phone",
      callPurpose: "Confirm demo request.",
      ownerId: "321",
      consentAllowed: true,
      doNotCall: false,
    }).status,
    "missing_phone"
  );

  assert.equal(
    buildCandidatePayload({
      portalId: "12345",
      objectType: "contact",
      objectId: "67890",
      workflowRunId: "run-1",
      phone: "555-555-0123",
      phoneProperty: "phone",
      callPurpose: "Confirm demo request.",
      ownerId: "321",
      consentAllowed: true,
      doNotCall: false,
    }).status,
    "invalid_phone"
  );
});

test("blocks records that are not approved for phone contact", () => {
  const noConsent = buildCandidatePayload({
    portalId: "12345",
    objectType: "contact",
    objectId: "67890",
    workflowRunId: "run-1",
    phone: "+15555550123",
    phoneProperty: "phone",
    callPurpose: "Confirm demo request.",
    ownerId: "321",
    consentAllowed: false,
    doNotCall: false,
  });
  const doNotCall = buildCandidatePayload({
    portalId: "12345",
    objectType: "contact",
    objectId: "67890",
    workflowRunId: "run-1",
    phone: "+15555550123",
    phoneProperty: "phone",
    callPurpose: "Confirm demo request.",
    ownerId: "321",
    consentAllowed: true,
    doNotCall: true,
  });

  assert.equal(noConsent.status, "consent_required");
  assert.equal(doNotCall.status, "do_not_call");
  assert.equal(noConsent.liveCallAllowed, false);
  assert.equal(doNotCall.liveCallAllowed, false);
});

test("validates HubSpot v3 workflow signatures and rejects stale or changed requests", () => {
  const body = { callbackId: "run-1", inputFields: { phone_property: "phone" } };
  const now = Date.now();
  const context = signedWorkflowContext(body, { timestamp: now });
  const request = {
    headers: context.headers,
    method: context.method,
    uri: HUBSPOT_WORKFLOW_ACTION_URL,
    body,
    clientSecret: HUBSPOT_CLIENT_SECRET,
    now,
  };

  assert.equal(verifyHubSpotV3Signature(request), true);
  assert.equal(verifyHubSpotV3Signature({ ...request, body: { ...body, callbackId: "changed" } }), false);
  assert.equal(verifyHubSpotV3Signature({ ...request, clientSecret: "" }), false);
  assert.equal(verifyHubSpotV3Signature({ ...request, now: now + 300_001 }), false);
});

test("normalizes HubSpot workflow envelope values for validation", () => {
  assert.deepEqual(
    readWorkflowInput({
      body: {
        origin: {
          portalId: 12345,
        },
        callbackId: "run-1",
        inputFields: {
          source_object_type: "contact",
          source_object_id: "67890",
          phone_property: "phone",
          call_purpose: "Confirm demo request.",
        },
      },
    }),
    {
      origin: {
        portalId: 12345,
      },
      callbackId: "run-1",
      source_object_type: "contact",
      source_object_id: "67890",
      phone_property: "phone",
      call_purpose: "Confirm demo request.",
      portalId: "12345",
      workflowRunId: "run-1",
      inputFields: {
        source_object_type: "contact",
        source_object_id: "67890",
        phone_property: "phone",
        call_purpose: "Confirm demo request.",
      },
    }
  );
});

test("rejects unsupported HubSpot object types for the serverless pilot", () => {
  const required = {
    portalId: "12345",
    source_object_id: "67890",
    phone_property: "phone",
    call_purpose: "Confirm demo request.",
  };
  assert.deepEqual(validateCandidateInput({ ...required, source_object_type: "contact" }), []);
  assert.deepEqual(validateCandidateInput({ ...required, source_object_type: "deal" }), []);
  assert.deepEqual(validateCandidateInput({ ...required, source_object_type: "ticket" }), ["invalid_object_type"]);
  assert.deepEqual(validateCandidateInput({ ...required, source_object_type: "" }), ["missing_source_object_type"]);
});

test("reports missing workflow action inputs before direct-call execution", () => {
  assert.deepEqual(
    validateCandidateInput({
      portalId: "12345",
      source_object_type: "contact",
      source_object_id: "67890",
      phone_property: "phone",
      call_purpose: "Confirm demo request.",
    }),
    []
  );
  assert.deepEqual(validateCandidateInput({}), [
    "missing_portal_id",
    "missing_source_object_type",
    "missing_source_object_id",
    "missing_phone_property",
    "missing_call_purpose",
  ]);
});

test("creates CALL-E calls using the public OpenAPI recipients payload", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  let request;

  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      text: async () => JSON.stringify({ id: "call_123", object: "call_task", status: "queued" }),
    };
  };

  try {
    assert.match(HIGH_STAKES_SAFETY_INSTRUCTION, /fixed and cannot be overridden/i);
    const result = await createCallECall({
      phone: "  +15555550123  ",
      task: "Call this lead and qualify demo interest.",
      metadata: {
        source_platform: "hubspot",
        portal_id: "12345",
      },
      idempotencyKey: "hubspot-calle:12345:contact:67890:run-1",
    });

    assert.equal(result.id, "call_123");
    assert.equal(request.url, "https://api.heycall-e.com/v1/calls");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers.authorization, "Bearer calle_test_key");
    assert.equal(request.options.headers["idempotency-key"], "hubspot-calle:12345:contact:67890:run-1");
    assert.deepEqual(JSON.parse(request.options.body), {
      task: `${HIGH_STAKES_SAFETY_INSTRUCTION}\n\nCall this lead and qualify demo interest.`,
      recipients: [
        {
          phones: ["+15555550123"],
        },
      ],
      metadata: {
        source_platform: "hubspot",
        portal_id: "12345",
      },
    });
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
  }
});

test("rejects a successful CALL-E response that is not a documented call task", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;

  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  global.fetch = async () => ({
    ok: true,
    status: 201,
    text: async () => JSON.stringify({
      id: "job_123",
      object: "call_task",
      status: "queued",
    }),
  });

  try {
    await assert.rejects(
      () => createCallECall({
        phone: "+15555550123",
        task: "Confirm demo request.",
        metadata: {},
        idempotencyKey: "request-1",
      }),
      /documented CallTask response/,
    );
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
  }
});

test("rejects unsupported CALL-E base URLs before fetch", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  let fetchCalls = 0;

  process.env.CALL_E_API_KEY = "calle_test_key";
  global.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, text: async () => "{}" };
  };

  try {
    for (const baseUrl of [
      "",
      "http://api.heycall-e.com",
      "https://api.heycall-e.test",
      "https://api.heycall-e.com/v1",
      "https://api.heycall-e.com?",
      "https://api.heycall-e.com#",
      "https://user:pass@api.heycall-e.com",
    ]) {
      process.env.CALL_E_BASE_URL = baseUrl;
      await assert.rejects(
        () => createCallECall({
          phone: "+15555550123",
          task: "Confirm demo request.",
          metadata: {},
          idempotencyKey: "request-1",
        }),
        /CALL_E_BASE_URL/
      );
    }
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
  }
});

test("workflow handler creates a direct CALL-E call without HubSpot CRM writeback", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  const originalClientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const originalActionUrl = process.env.HUBSPOT_WORKFLOW_ACTION_URL;
  const originalPrivateToken = process.env.PRIVATE_APP_ACCESS_TOKEN;
  const requests = [];

  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  process.env.HUBSPOT_CLIENT_SECRET = HUBSPOT_CLIENT_SECRET;
  process.env.HUBSPOT_WORKFLOW_ACTION_URL = HUBSPOT_WORKFLOW_ACTION_URL;
  process.env.PRIVATE_APP_ACCESS_TOKEN = "hubspot-token";
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).startsWith("https://api.hubapi.com")) {
      throw new Error("HubSpot CRM writeback should not be called in direct-call mode.");
    }
    return {
      ok: true,
      text: async () => JSON.stringify({
        id: "call_123",
        object: "call_task",
        status: "queued",
      }),
    };
  };

  try {
    const body = {
      origin: { portalId: 12345 },
      callbackId: "run-1",
      inputFields: {
        source_object_type: "contact",
        source_object_id: "67890",
        phone: "+15555550123",
        phone_property: "phone",
        call_purpose: "Call this lead and qualify demo interest.",
        consent_allowed: "true",
        do_not_call: "false",
      },
    };
    const response = await createCallCandidate(signedWorkflowContext(body));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.outputFields, {
      call_id: "call_123",
      status: "queued",
      masked_phone: "[phone]",
      error: "",
    });
    assert.deepEqual(
      requests.map((request) => request.url),
      ["https://api.heycall-e.com/v1/calls"]
    );
    assert.equal(
      JSON.parse(requests[0].options.body).task,
      `${HIGH_STAKES_SAFETY_INSTRUCTION}\n\nCall this lead and qualify demo interest.`
    );
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
    restoreEnv("HUBSPOT_CLIENT_SECRET", originalClientSecret);
    restoreEnv("HUBSPOT_WORKFLOW_ACTION_URL", originalActionUrl);
    restoreEnv("PRIVATE_APP_ACCESS_TOKEN", originalPrivateToken);
  }
});

test("workflow handler rejects invalid HubSpot signatures before provider lookup", async () => {
  const originalFetch = global.fetch;
  const originalClientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const originalActionUrl = process.env.HUBSPOT_WORKFLOW_ACTION_URL;
  let fetchCalls = 0;

  process.env.HUBSPOT_CLIENT_SECRET = HUBSPOT_CLIENT_SECRET;
  process.env.HUBSPOT_WORKFLOW_ACTION_URL = HUBSPOT_WORKFLOW_ACTION_URL;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Provider lookup must not run for an invalid HubSpot signature.");
  };

  try {
    const body = {
      origin: { portalId: 12345 },
      callbackId: "run-1",
      inputFields: {
        source_object_type: "contact",
        source_object_id: "67890",
        phone: "+15555550123",
        phone_property: "phone",
        call_purpose: "Confirm demo request.",
        consent_allowed: "true",
        do_not_call: "false",
      },
    };
    const context = signedWorkflowContext(body, {
      headers: { "x-hubspot-signature-v3": "invalid-signature" },
    });
    const response = await createCallCandidate(context);

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.outputFields.status, "unauthorized");
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
    restoreEnv("HUBSPOT_CLIENT_SECRET", originalClientSecret);
    restoreEnv("HUBSPOT_WORKFLOW_ACTION_URL", originalActionUrl);
  }
});

test("workflow handler fails closed unless consent and DNC are explicit", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  const originalClientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const originalActionUrl = process.env.HUBSPOT_WORKFLOW_ACTION_URL;
  let fetchCalls = 0;

  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  process.env.HUBSPOT_CLIENT_SECRET = HUBSPOT_CLIENT_SECRET;
  process.env.HUBSPOT_WORKFLOW_ACTION_URL = HUBSPOT_WORKFLOW_ACTION_URL;
  global.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      text: async () => JSON.stringify({ id: "call_123", object: "call_task", status: "queued" }),
    };
  };

  const validInput = {
    source_object_type: "contact",
    source_object_id: "67890",
    phone: "+15555550123",
    phone_property: "phone",
    call_purpose: "Confirm demo request.",
    consent_allowed: true,
    do_not_call: false,
  };

  async function run(overrides, omitted = []) {
    const inputFields = { ...validInput, ...overrides };
    for (const name of omitted) delete inputFields[name];
    return createCallCandidate(signedWorkflowContext({
      origin: { portalId: 12345 },
      callbackId: "run-1",
      inputFields,
    }));
  }

  try {
    const missingConsent = await run({}, ["consent_allowed"]);
    const falseConsent = await run({ consent_allowed: false });
    const missingDnc = await run({}, ["do_not_call"]);
    const malformedDnc = await run({ do_not_call: "not-known" });

    assert.equal(missingConsent.body.outputFields.status, "consent_required");
    assert.equal(falseConsent.body.outputFields.status, "consent_required");
    assert.equal(missingDnc.body.outputFields.status, "dnc_status_required");
    assert.equal(malformedDnc.body.outputFields.status, "dnc_status_required");
    assert.equal(fetchCalls, 0);

    const valid = await run({ consent_allowed: "true", do_not_call: "false" });
    assert.equal(valid.body.outputFields.status, "queued");
    assert.equal(fetchCalls, 1);
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
    restoreEnv("HUBSPOT_CLIENT_SECRET", originalClientSecret);
    restoreEnv("HUBSPOT_WORKFLOW_ACTION_URL", originalActionUrl);
  }
});

test("workflow handler preserves CALL-E retry classification and idempotency", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  const originalClientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const originalActionUrl = process.env.HUBSPOT_WORKFLOW_ACTION_URL;
  const idempotencyKeys = [];

  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  process.env.HUBSPOT_CLIENT_SECRET = HUBSPOT_CLIENT_SECRET;
  process.env.HUBSPOT_WORKFLOW_ACTION_URL = HUBSPOT_WORKFLOW_ACTION_URL;
  const body = {
    origin: { portalId: 12345 },
    callbackId: "run-retry-1",
    inputFields: {
      source_object_type: "contact",
      source_object_id: "67890",
      phone: "+15555550123",
      phone_property: "phone",
      call_purpose: "Confirm demo request.",
      consent_allowed: "true",
      do_not_call: "false",
    },
  };

  try {
    global.fetch = async (_url, options) => {
      idempotencyKeys.push(options.headers["idempotency-key"]);
      return {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({
          code: "rate_limit_exceeded",
          message: "Retry this CALL-E request.",
        }),
      };
    };
    const retryable = await createCallCandidate(signedWorkflowContext(body));
    assert.equal(retryable.statusCode, 429);
    assert.equal(retryable.body.outputFields.status, "rate_limit_exceeded");

    global.fetch = async (_url, options) => {
      idempotencyKeys.push(options.headers["idempotency-key"]);
      return {
        ok: false,
        status: 422,
        text: async () => JSON.stringify({
          code: "invalid_request",
          message: "The CALL-E request is invalid.",
        }),
      };
    };
    const deterministic = await createCallCandidate(signedWorkflowContext(body));
    assert.equal(deterministic.statusCode, 422);
    assert.equal(deterministic.body.outputFields.status, "invalid_request");
    assert.equal(idempotencyKeys.length, 2);
    assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
    restoreEnv("HUBSPOT_CLIENT_SECRET", originalClientSecret);
    restoreEnv("HUBSPOT_WORKFLOW_ACTION_URL", originalActionUrl);
  }
});

test("card handler starts a CALL-E call from the current CRM record without HubSpot writeback", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  const requests = [];

  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({
        id: "call_123",
        object: "call_task",
        status: "queued",
      }),
    };
  };

  try {
    const response = await startCallFromCard({
      accountId: "12345",
      parameters: {
        source_object_type: "contact",
        source_object_id: "67890",
        phone_property: "phone",
        call_task: "Qualify demo interest.",
        request_id: "intent-1",
        confirmed: true,
      },
      propertiesToSend: { phone: "+15555550123", mobilephone: "" },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      retry_same_intent: false,
      success: true,
      call_id: "call_123",
      status: "queued",
      masked_phone: "[phone]",
      error: "",
    });
    assert.deepEqual(
      requests.map((request) => request.url),
      ["https://api.heycall-e.com/v1/calls"]
    );
    assert.deepEqual(JSON.parse(requests[0].options.body).metadata, {
      source_platform: "hubspot",
      source_entrypoint: "app_card",
      portal_id: "12345",
      source_object_type: "contact",
      source_object_id: "67890",
      phone_property: "phone",
    });
    assert.equal(
      JSON.parse(requests[0].options.body).task,
      `${HIGH_STAKES_SAFETY_INSTRUCTION}\n\nQualify demo interest.`
    );
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
  }
});

test("card handler requires a request ID before provider lookup", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not run");
  };

  try {
    const response = await startCallFromCard({
      accountId: "12345",
      parameters: {
        source_object_type: "contact",
        source_object_id: "67890",
        phone_property: "phone",
        call_task: "Qualify demo interest.",
        confirmed: true,
      },
      propertiesToSend: { phone: "+15555550123", mobilephone: "" },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.status, "missing_request_id");
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("card handler rejects unsupported phone properties before provider lookup", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not run");
  };

  try {
    const response = await startCallFromCard({
      accountId: "12345",
      parameters: {
        source_object_type: "contact",
        source_object_id: "67890",
        phone_property: "custom_phone",
        call_task: "Qualify demo interest.",
        request_id: "intent-1",
        confirmed: true,
      },
      propertiesToSend: { phone: "+15555550123", mobilephone: "" },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.status, "invalid_phone_property");
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("card handler trusts accountId and selected Contact propertiesToSend value", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  const requests = [];

  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({ id: "call_123", object: "call_task", status: "queued" }),
    };
  };

  try {
    const response = await startCallFromCard({
      accountId: "trusted-portal",
      parameters: {
        portal_id: "client-portal",
        source_object_type: "contact",
        source_object_id: "trusted-record",
        phone_property: "mobilephone",
        call_task: "Qualify demo interest.",
        request_id: "intent-1",
        confirmed: true,
      },
      propertiesToSend: { mobilephone: "+15555550123", phone: "" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      requests[0].options.headers["idempotency-key"],
      "hubspot-calle:trusted-portal:contact:trusted-record:intent-1"
    );
    assert.deepEqual(JSON.parse(requests[0].options.body).metadata, {
      source_platform: "hubspot",
      source_entrypoint: "app_card",
      portal_id: "trusted-portal",
      source_object_type: "contact",
      source_object_id: "trusted-record",
      phone_property: "mobilephone",
    });
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
  }
});

test("card handler keeps idempotency stable per intent and distinct across intents", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  const idempotencyKeys = [];

  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  global.fetch = async (_url, options = {}) => {
    idempotencyKeys.push(options.headers["idempotency-key"]);
    return {
      ok: true,
      text: async () => JSON.stringify({ id: "call_123", object: "call_task", status: "queued" }),
    };
  };

  async function start(requestId) {
    return startCallFromCard({
      accountId: "12345",
      parameters: {
        source_object_type: "contact",
        source_object_id: "67890",
        phone_property: "phone",
        call_task: "Qualify demo interest.",
        request_id: requestId,
        confirmed: true,
      },
      propertiesToSend: { phone: "+15555550123", mobilephone: "" },
    });
  }

  try {
    await start("intent-1");
    await start("intent-1");
    await start("intent-2");

    assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
    assert.notEqual(idempotencyKeys[1], idempotencyKeys[2]);
    assert.match(idempotencyKeys[0], /:intent-1$/);
    assert.match(idempotencyKeys[2], /:intent-2$/);
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
  }
});

test("card handler uses official private context without a HubSpot CRM fetch", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  const requests = [];

  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      text: async () => JSON.stringify({ id: "call_123", object: "call_task", status: "queued" }),
    };
  };

  try {
    const response = await startCallFromCard({
      accountId: "trusted-account",
      parameters: {
        source_object_id: "67890",
        source_object_type: "contact",
        phone_property: "phone",
        phone: "+18888888888",
        portal_id: "client-portal",
        call_task: "Qualify demo interest.",
        request_id: "intent-1",
        confirmed: true,
      },
      propertiesToSend: {
        phone: "  +15555550123  ",
        mobilephone: "+16666660123",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(requests.map((request) => request.url), [
      "https://api.heycall-e.com/v1/calls",
    ]);
    assert.equal(
      requests[0].options.headers["idempotency-key"],
      "hubspot-calle:trusted-account:contact:67890:intent-1"
    );
    assert.deepEqual(JSON.parse(requests[0].options.body).recipients[0], {
      phones: ["+15555550123"],
    });
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
  }
});

test("card handler requires explicit confirmation and a trusted account ID", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not run");
  };

  const baseContext = {
    accountId: "12345",
    parameters: {
      source_object_id: "67890",
      source_object_type: "contact",
      phone_property: "phone",
      call_task: "Qualify demo interest.",
      request_id: "intent-1",
      confirmed: true,
    },
    propertiesToSend: { phone: "+15555550123", mobilephone: "" },
  };

  try {
    const unconfirmed = await startCallFromCard({
      ...baseContext,
      parameters: { ...baseContext.parameters, confirmed: false },
    });
    const missingAccount = await startCallFromCard({
      ...baseContext,
      accountId: "",
    });

    assert.equal(unconfirmed.statusCode, 400);
    assert.equal(unconfirmed.body.status, "confirmation_required");
    assert.equal(missingAccount.statusCode, 400);
    assert.equal(missingAccount.body.status, "missing_account_id");
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("card handler uses only the selected property from propertiesToSend", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not run");
  };

  try {
    const response = await startCallFromCard({
      accountId: "12345",
      parameters: {
        source_object_id: "67890",
        source_object_type: "contact",
        phone_property: "phone",
        phone: "+15555550123",
        call_task: "Qualify demo interest.",
        request_id: "intent-1",
        confirmed: true,
      },
      propertiesToSend: {
        phone: "",
        mobilephone: "+16666660123",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, "missing_phone");
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("card handler marks network, response-read, and response-parse failures ambiguous", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  const baseContext = {
    accountId: "12345",
    parameters: {
      source_object_id: "67890",
      source_object_type: "contact",
      phone_property: "phone",
      call_task: "Qualify demo interest.",
      request_id: "intent-1",
      confirmed: true,
    },
    propertiesToSend: { phone: "+15555550123", mobilephone: "" },
  };
  const failureFetches = [
    async () => {
      throw new Error("network failed");
    },
    async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error("read failed");
      },
    }),
    async () => ({ ok: true, status: 200, text: async () => "not-json" }),
  ];

  try {
    for (const fetchImplementation of failureFetches) {
      global.fetch = fetchImplementation;
      const response = await startCallFromCard(baseContext);

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, false);
      assert.equal(response.body.retry_same_intent, true);
      assert.equal(response.body.masked_phone, "[phone]");
      assert.doesNotMatch(response.body.error, /\+15555550123/);
    }
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
  }
});

test("card handler marks parsed provider rejection deterministic", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  global.fetch = async () => ({
    ok: false,
    status: 422,
    text: async () => JSON.stringify({
      code: "invalid_request",
      message: "Provider rejected the request.",
    }),
  });

  try {
    const response = await startCallFromCard({
      accountId: "12345",
      parameters: {
        source_object_id: "67890",
        source_object_type: "contact",
        phone_property: "phone",
        call_task: "Qualify demo interest.",
        request_id: "intent-1",
        confirmed: true,
      },
      propertiesToSend: { phone: "+15555550123", mobilephone: "" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, false);
    assert.equal(response.body.retry_same_intent, false);
    assert.equal(response.body.status, "invalid_request");
    assert.match(response.body.error, /Provider rejected/);
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
  }
});

test("card handler preserves retryable CALL-E provider outcomes for the same intent", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  const idempotencyKeys = [];
  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  global.fetch = async (_url, options) => {
    idempotencyKeys.push(options.headers["idempotency-key"]);
    return {
      ok: false,
      status: 503,
      text: async () => JSON.stringify({
        code: "provider_unavailable",
        message: "CALL-E provider unavailable.",
      }),
    };
  };
  const context = {
    accountId: "12345",
    parameters: {
      source_object_id: "67890",
      source_object_type: "contact",
      phone_property: "phone",
      call_task: "Qualify demo interest.",
      request_id: "intent-retry-1",
      confirmed: true,
    },
    propertiesToSend: { phone: "+15555550123", mobilephone: "" },
  };

  try {
    const first = await startCallFromCard(context);
    const second = await startCallFromCard(context);

    assert.equal(first.statusCode, 200);
    assert.equal(first.body.status, "provider_unavailable");
    assert.equal(first.body.retry_same_intent, true);
    assert.equal(second.body.retry_same_intent, true);
    assert.equal(idempotencyKeys.length, 2);
    assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
  } finally {
    global.fetch = originalFetch;
    restoreEnv("CALL_E_API_KEY", originalApiKey);
    restoreEnv("CALL_E_BASE_URL", originalBaseUrl);
  }
});
