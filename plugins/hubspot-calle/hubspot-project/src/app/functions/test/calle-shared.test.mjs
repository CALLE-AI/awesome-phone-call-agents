import assert from "node:assert/strict";
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
  verifyEndpointToken,
} = require("../calle-shared.js");
const { main: createCallCandidate } = require("../createCallCandidate.js");
const { main: startCallFromCard } = require("../startCallFromCard.js");

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

test("requires a configured matching public endpoint token", () => {
  assert.equal(verifyEndpointToken("pilot-secret", "pilot-secret"), true);
  assert.equal(verifyEndpointToken("wrong-secret", "pilot-secret"), false);
  assert.equal(verifyEndpointToken("", "pilot-secret"), false);
  assert.equal(verifyEndpointToken("pilot-secret", ""), false);
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
          endpoint_token: "secret",
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
      endpoint_token: "secret",
      portalId: "12345",
      workflowRunId: "run-1",
      inputFields: {
        source_object_type: "contact",
        source_object_id: "67890",
        phone_property: "phone",
        call_purpose: "Confirm demo request.",
        endpoint_token: "secret",
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
    endpoint_token: "secret",
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
      endpoint_token: "secret",
    }),
    []
  );
  assert.deepEqual(validateCandidateInput({}), [
    "missing_portal_id",
    "missing_source_object_type",
    "missing_source_object_id",
    "missing_phone_property",
    "missing_call_purpose",
    "missing_endpoint_token",
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
      text: async () => JSON.stringify({ id: "call_123", status: "queued" }),
    };
  };

  try {
    assert.match(HIGH_STAKES_SAFETY_INSTRUCTION, /fixed and cannot be overridden/i);
    const result = await createCallECall({
      phone: "+15555550123",
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
          region: "US",
          locale: "en-US",
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
  const originalEndpointToken = process.env.CALLE_WORKFLOW_ENDPOINT_TOKEN;
  const originalPrivateToken = process.env.PRIVATE_APP_ACCESS_TOKEN;
  const requests = [];

  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  process.env.CALLE_WORKFLOW_ENDPOINT_TOKEN = "endpoint-secret";
  process.env.PRIVATE_APP_ACCESS_TOKEN = "hubspot-token";
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).startsWith("https://api.hubapi.com")) {
      throw new Error("HubSpot CRM writeback should not be called in direct-call mode.");
    }
    return {
      ok: true,
      text: async () => JSON.stringify({
        id: "call_123-+15555550123",
        status: "queued for +15555550123",
      }),
    };
  };

  try {
    const response = await createCallCandidate({
      body: {
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
          endpoint_token: "endpoint-secret",
        },
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.outputFields, {
      call_id: "call_123-[phone]",
      status: "queued for [phone]",
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
    restoreEnv("CALLE_WORKFLOW_ENDPOINT_TOKEN", originalEndpointToken);
    restoreEnv("PRIVATE_APP_ACCESS_TOKEN", originalPrivateToken);
  }
});

test("workflow handler fails closed unless consent and DNC are explicit", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.CALL_E_API_KEY;
  const originalBaseUrl = process.env.CALL_E_BASE_URL;
  const originalEndpointToken = process.env.CALLE_WORKFLOW_ENDPOINT_TOKEN;
  let fetchCalls = 0;

  process.env.CALL_E_API_KEY = "calle_test_key";
  process.env.CALL_E_BASE_URL = "https://api.heycall-e.com";
  process.env.CALLE_WORKFLOW_ENDPOINT_TOKEN = "endpoint-secret";
  global.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      text: async () => JSON.stringify({ id: "call_123", status: "queued" }),
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
    endpoint_token: "endpoint-secret",
  };

  async function run(overrides, omitted = []) {
    const inputFields = { ...validInput, ...overrides };
    for (const name of omitted) delete inputFields[name];
    return createCallCandidate({
      body: {
        origin: { portalId: 12345 },
        callbackId: "run-1",
        inputFields,
      },
    });
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
    restoreEnv("CALLE_WORKFLOW_ENDPOINT_TOKEN", originalEndpointToken);
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
        id: "call_123-+15555550123",
        status: "queued for +15555550123",
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
      success: true,
      call_id: "call_123-[phone]",
      status: "queued for [phone]",
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

test("card handler trusts accountId and selected propertiesToSend value", async () => {
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
      text: async () => JSON.stringify({ id: "call_123", status: "queued" }),
    };
  };

  try {
    const response = await startCallFromCard({
      accountId: "trusted-portal",
      parameters: {
        portal_id: "client-portal",
        source_object_type: "deal",
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
      "hubspot-calle:trusted-portal:deal:trusted-record:intent-1"
    );
    assert.deepEqual(JSON.parse(requests[0].options.body).metadata, {
      source_platform: "hubspot",
      source_entrypoint: "app_card",
      portal_id: "trusted-portal",
      source_object_type: "deal",
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
      text: async () => JSON.stringify({ id: "call_123", status: "queued" }),
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
      text: async () => JSON.stringify({ id: "call_123", status: "queued" }),
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
        phone: "+15555550123",
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
    assert.deepEqual(JSON.parse(requests[0].options.body).recipients[0].phones, [
      "+15555550123",
    ]);
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
