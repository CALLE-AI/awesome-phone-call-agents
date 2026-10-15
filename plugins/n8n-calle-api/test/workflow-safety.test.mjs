import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL(
  "../examples/calle-ivr-quality-create-and-wait.workflow.json",
  import.meta.url,
);
const manifestPath = new URL("../manifest.json", import.meta.url);
const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function codeFor(nodeName) {
  const node = workflow.nodes.find((candidate) => candidate.name === nodeName);
  assert.ok(node, `Missing workflow node: ${nodeName}`);
  assert.equal(node.type, "n8n-nodes-base.code");
  return node.parameters.jsCode;
}

async function runCodeNode(nodeName, inputItems = [], helpers = {}, globals = {}) {
  const input = {
    all: () => structuredClone(inputItems),
    first: () => structuredClone(inputItems[0]),
  };
  const execute = new AsyncFunction(
    "$input",
    "helpers",
    "Date",
    "setTimeout",
    "$env",
    codeFor(nodeName),
  );
  return execute(
    input,
    helpers,
    globals.Date ?? Date,
    globals.setTimeout ?? setTimeout,
    { CALL_E_API_KEY: "test_api_key", ...(globals.env ?? {}) },
  );
}

test("Demo Result View redacts phone numbers from every displayed field", async () => {
  const primaryPhone = "+14155550100";
  const returnedPhone = "+442071838750";
  const errorPhone = "+61293744000";
  const [output] = await runCodeNode("Demo Result View", [
    {
      json: {
        callItemId: "ivr_sample_001",
        phone: primaryPhone,
        task: "Inspect the authorized IVR.",
        metadataSent: { contact_phone: primaryPhone },
        metadataReturned: {
          callback_phone: returnedPhone,
          numeric_phone: 14155550100,
          phone: { countryCode: 1, nationalNumber: 4155550100 },
        },
        ok: false,
        callId: "call_123",
        callStatus: "failed",
        recipientStatus: "failed",
        latestAttemptStatus: "failed",
        failureCode: "provider_error",
        failureMessage: `Provider rejected ${returnedPhone}`,
        statusSignals: { failed: true },
        summary: null,
        transcriptTurns: [],
        structuredResult: null,
        rawCallResult: {
          metadata: { contact_phone: primaryPhone },
          recipients: [{ phones: [returnedPhone] }],
        },
        apiError: {
          name: "Error",
          message: `CALL-E API request failed for ${errorPhone}`,
        },
      },
    },
  ]);

  const serialized = JSON.stringify(output.json);
  for (const phone of [primaryPhone, returnedPhone, errorPhone]) {
    assert.equal(serialized.includes(phone), false, `Leaked phone number: ${phone}`);
  }
  assert.equal(output.json.maskedPhone, "+14****00");
  assert.equal(output.json.metadataSent.contact_phone, "+14****00");
  assert.equal(output.json.metadataReturned.callback_phone, "+44****50");
  assert.equal(output.json.metadataReturned.numeric_phone, "****");
  assert.deepEqual(output.json.metadataReturned.phone, {
    countryCode: "****",
    nationalNumber: "****",
  });
  assert.match(output.json.apiError.message, /\+61\*{4}00/);
});

test("API failure messages do not stringify unredacted response bodies", async () => {
  const responsePhone = "+14155550100";
  assert.doesNotMatch(
    codeFor("Create CALL-E Call and Wait"),
    /JSON\.stringify\(body\)/,
  );
  const [output] = await runCodeNode(
    "Create CALL-E Call and Wait",
    [
      {
        json: {
          calleConfig: {
            pollIntervalSeconds: 5,
            waitTimeoutMinutes: 4,
          },
          createInput: { phone: responsePhone },
          idempotencyKey: "test-key",
          callItemId: "ivr_sample_001",
        },
      },
    ],
    {
      httpRequest: async () => ({
        statusCode: 400,
        statusMessage: "Bad Request",
        body: { error: `Invalid phone ${responsePhone}` },
      }),
    },
  );
  assert.equal(output.json.ok, false);
  assert.equal(output.json.apiError.message.includes(responsePhone), false);
  assert.match(output.json.apiError.message, /Response body omitted/);
});

test("Create CALL-E Call and Wait rejects a successful response without a documented call ID", async () => {
  const [output] = await runCodeNode(
    "Create CALL-E Call and Wait",
    [
      {
        json: {
          calleConfig: {
            pollIntervalSeconds: 5,
            waitTimeoutMinutes: 4,
          },
          createInput: { phone: "+14155550100" },
          idempotencyKey: "test-key",
          callItemId: "ivr_sample_001",
        },
      },
    ],
    {
      httpRequest: async () => ({
        statusCode: 202,
        statusMessage: "Accepted",
        body: { id: "job_123", status: "completed", result_status: "available" },
      }),
    },
  );

  assert.equal(output.json.ok, false);
  assert.match(output.json.apiError.message, /documented call ID/);
});

test("CALL-E credentials and host never travel in workflow data", () => {
  const configCode = codeFor("CALL-E Config");
  const createCode = codeFor("Create CALL-E Call and Wait");

  assert.doesNotMatch(configCode, /\bapiKey\b/);
  assert.doesNotMatch(configCode, /\bbaseUrl\b/);
  assert.match(createCode, /\$env\.CALL_E_API_KEY/);
  assert.match(createCode, /const CALL_E_BASE_URL = "https:\/\/api\.heycall-e\.com"/);
  assert.doesNotMatch(createCode, /calleConfig\?\.apiKey/);
  assert.doesNotMatch(createCode, /calleConfig\?\.baseUrl/);
});

test("Create CALL-E Call and Wait requires the deployment secret before dialing", async () => {
  let requestAttempted = false;

  await assert.rejects(
    () =>
      runCodeNode(
        "Create CALL-E Call and Wait",
        [
          {
            json: {
              calleConfig: { pollIntervalSeconds: 5, waitTimeoutMinutes: 4 },
              createInput: { phone: "+14155550100" },
              idempotencyKey: "test-key",
              callItemId: "ivr_sample_001",
            },
          },
        ],
        {
          httpRequest: async () => {
            requestAttempted = true;
            throw new Error("must not request without a secret");
          },
        },
        { env: { CALL_E_API_KEY: "" } },
      ),
    /CALL_E_API_KEY/,
  );
  assert.equal(requestAttempted, false);
});

test("idempotency key changes when canonical call intent changes", async () => {
  const config = {
    pollIntervalSeconds: 5,
    waitTimeoutMinutes: 4,
  };
  const baseTask = {
    callItemId: "ivr_sample_001",
    phone: "+14155550100",
    region: "US",
    locale: "en-US",
    task: "Call the authorized IVR and record the opening menu.",
    metadata: { lead_id: "lead-123", campaign: "qa" },
    calleConfig: config,
  };

  const [original] = await runCodeNode("Build CALL-E Request Payload", [{ json: baseTask }]);
  const [editedTask] = await runCodeNode("Build CALL-E Request Payload", [
    { json: { ...baseTask, task: "Call the authorized IVR and request a callback." } },
  ]);
  const [editedPhone] = await runCodeNode("Build CALL-E Request Payload", [
    { json: { ...baseTask, phone: "+14155550101" } },
  ]);

  assert.notEqual(original.json.idempotencyKey, editedTask.json.idempotencyKey);
  assert.notEqual(original.json.idempotencyKey, editedPhone.json.idempotencyKey);
});

test("the Code-node polling timeout stays below the stock runner task limit", async () => {
  const [configured] = await runCodeNode("CALL-E Config");
  assert.equal(configured.json.calleConfig.waitTimeoutMinutes, 4);

  const validConfig = {
    pollIntervalSeconds: 5,
    waitTimeoutMinutes: 4,
  };
  await assert.doesNotReject(() =>
    runCodeNode("Validate CALL-E Config", [{ json: { calleConfig: validConfig } }]),
  );
  await assert.rejects(
    () =>
      runCodeNode("Validate CALL-E Config", [
        {
          json: {
            calleConfig: { ...validConfig, waitTimeoutMinutes: 5 },
          },
        },
      ]),
    /cannot exceed 4 minutes/,
  );
  await assert.rejects(
    () =>
      runCodeNode("Validate CALL-E Config", [
        {
          json: {
            calleConfig: { ...validConfig, pollIntervalSeconds: 31 },
          },
        },
      ]),
    /between 1 and 30 seconds/,
  );
});

test("polling stays within its deadline when the final interval is partial", async () => {
  let now = 0;
  const sleepDurations = [];
  const requestTimeouts = [];
  const [output] = await runCodeNode(
    "Create CALL-E Call and Wait",
    [
      {
        json: {
          calleConfig: {
            pollIntervalSeconds: 29,
            waitTimeoutMinutes: 4,
          },
          createInput: { phone: "+14155550100" },
          idempotencyKey: "test-key",
          callItemId: "ivr_sample_001",
        },
      },
    ],
    {
      httpRequest: async (options) => {
        requestTimeouts.push(options.timeout);
        return {
          statusCode: 200,
          statusMessage: "OK",
          body: { id: "call_123", status: "in_progress", result_status: "pending" },
        };
      },
    },
    {
      Date: { now: () => now },
      setTimeout: (resolve, milliseconds) => {
        sleepDurations.push(milliseconds);
        now += milliseconds;
        resolve();
      },
    },
  );

  assert.equal(output.json.ok, false);
  assert.match(output.json.apiError.message, /Timed out waiting/);
  assert.equal(now, 4 * 60 * 1000);
  assert.ok(sleepDurations.at(-1) < 29 * 1000);
  assert.ok(
    requestTimeouts.every(
      (timeout) => Number.isFinite(timeout) && timeout > 0 && timeout <= 30 * 1000,
    ),
  );
  assert.equal(output.json.rawCallResult.id, "call_123");
  assert.equal(output.json.idempotencyKey, "test-key");
});

test("builds one v2 destination and a closed scalar schema without inventing routing hints", async () => {
  const item = {
    json: {
      callItemId: "ivr_sample_001", phone: "+14155550100",
      task: "Inspect the authorized IVR; report unknown when evidence is missing.",
      metadata: { campaign: "qa" }, calleConfig: {},
    },
  };
  const [first] = await runCodeNode("Build CALL-E Request Payload", [item]);
  const [replay] = await runCodeNode("Build CALL-E Request Payload", [item]);
  const body = first.json.createInput;
  assert.equal(body.phone, item.json.phone);
  assert.equal(Object.hasOwn(body, "recipients"), false);
  assert.equal(Object.hasOwn(body, "recipient_result_schema"), false);
  assert.equal(Object.hasOwn(body, "region"), false);
  assert.equal(Object.hasOwn(body, "locale"), false);
  assert.equal(body.result_schema.additionalProperties, false);
  assert.ok(Object.values(body.result_schema.properties).every((field) => field.type === "string"));
  assert.deepEqual(first, replay);
});

test("Calls v2 waits beyond telephone completion and preserves an empty available result", async () => {
  const requests = [];
  const final = { id: "call_123", status: "completed", result_status: "available", result: {}, error: null, transcript: [] };
  const responses = [
    { ...final, status: "queued", result_status: "pending", result: null },
    { ...final, result_status: "pending", result: null },
    final,
  ];
  const [output] = await runCodeNode("Create CALL-E Call and Wait", [{
    json: { createInput: { phone: "+14155550100" }, idempotencyKey: "business-key", calleConfig: {} },
  }], {
    httpRequest: async (options) => {
      requests.push(options);
      return { statusCode: options.method === "POST" ? 202 : 200, body: responses.shift() };
    },
  }, { setTimeout: (resolve) => resolve() });
  assert.equal(output.json.ok, true);
  assert.deepEqual(output.json.rawCallResult, final);
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ["POST", "https://api.heycall-e.com/v2/calls"],
    ["GET", "https://api.heycall-e.com/v2/calls/call_123"],
    ["GET", "https://api.heycall-e.com/v2/calls/call_123"],
  ]);
  assert.ok(requests.every((request) => request.disableFollowRedirect === true));
  assert.equal(requests[0].headers["Idempotency-Key"], "business-key");
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1);
});

test("final unavailable results do not become technical failures or trigger another call", async () => {
  let requestCount = 0;
  const call = { id: "call_123", status: "completed", result_status: "unavailable", call_outcome: "no_answer", result: null, error: null, transcript: [] };
  const [created] = await runCodeNode("Create CALL-E Call and Wait", [{
    json: { createInput: { phone: "+14155550100" }, idempotencyKey: "business-key" },
  }], { httpRequest: async () => { requestCount += 1; return { statusCode: 202, body: call }; } });
  const [parsed] = await runCodeNode("Parse CALL-E Result", [created]);
  assert.equal(requestCount, 1);
  assert.equal(created.json.ok, true);
  assert.equal(parsed.json.resultStatus, "unavailable");
  assert.equal(parsed.json.statusSignals.no_answer, true);
  assert.equal(parsed.json.statusSignals.failed, false);
  assert.equal(parsed.json.structuredResult, null);
  const [displayed] = await runCodeNode("Demo Result View", [parsed]);
  const [summary] = await runCodeNode("Execution Summary", [displayed]);
  assert.equal(summary.json.availableResultCount, 0);
  assert.equal(summary.json.unavailableResultCount, 1);
  assert.equal(summary.json.failedCount, 0);
});

test("v2 parsing separates the API ID, Billing ID, transcript, result and technical error", async () => {
  const transcript = [{ speaker: "user", offset_seconds: 1, text: "The menu is clear." }];
  const [available] = await runCodeNode("Parse CALL-E Result", [{ json: {
    ok: true,
    rawCallResult: { id: "call_api", call_id: "billing_id", status: "completed", call_outcome: "completed", result_status: "available", result: { summary: "Clear menu" }, error: null, transcript },
  } }]);
  assert.equal(available.json.callId, "call_api");
  assert.equal(available.json.billingCallId, "billing_id");
  assert.deepEqual(available.json.transcriptTurns, transcript);
  assert.equal(available.json.summary, "Clear menu");
  assert.equal(available.json.statusSignals.answered, true);
  const [failed] = await runCodeNode("Parse CALL-E Result", [{ json: {
    rawCallResult: { id: "call_api", call_id: null, status: "failed", result_status: "not_applicable", result: null, transcript: [], error: { code: "call_failed", message: "Provider failure" } },
  } }]);
  assert.equal(failed.json.billingCallId, null);
  assert.equal(failed.json.failureCode, "call_failed");
  assert.equal(failed.json.statusSignals.failed, true);
});

test("a poll failure keeps the accepted API ID and never falls back to a second POST", async () => {
  const requests = [];
  const accepted = { id: "call_accepted", status: "queued", result_status: "pending" };
  const [output] = await runCodeNode("Create CALL-E Call and Wait", [{ json: {
    createInput: { phone: "+14155550100" }, idempotencyKey: "business-key",
  } }], { httpRequest: async (request) => {
    requests.push(request);
    if (request.method === "POST") return { statusCode: 202, body: accepted };
    throw new Error("Temporary network error");
  } }, { setTimeout: (resolve) => resolve() });
  assert.equal(output.json.ok, false);
  assert.equal(output.json.rawCallResult.id, accepted.id);
  assert.equal(output.json.idempotencyKey, "business-key");
  assert.deepEqual(requests.map(({ method }) => method), ["POST", "GET"]);
});

test("the shipped placeholder tasks fail validation before reaching the call node", async () => {
  await assert.rejects(
    () => runCodeNode("Phone/Task List", [{ json: { calleConfig: {} } }]),
    /Replace the placeholder phone number/,
  );
});

test("missing keys stop before dialing and invalid result readiness does not report success", async () => {
  let requests = 0;
  const helpers = { httpRequest: async () => {
    requests += 1;
    return { statusCode: 202, body: { id: "call_123", result_status: "unknown_status" } };
  } };
  await assert.rejects(
    () => runCodeNode("Create CALL-E Call and Wait", [{ json: { createInput: {} } }], helpers),
    /stable Idempotency-Key/,
  );
  assert.equal(requests, 0);
  const [output] = await runCodeNode("Create CALL-E Call and Wait", [{ json: {
    createInput: { phone: "+14155550100" }, idempotencyKey: "business-key",
  } }], helpers);
  assert.equal(requests, 1);
  assert.equal(output.json.ok, false);
  assert.match(output.json.apiError.message, /documented call ID and result_status/);
});

test("manifest describes the workflow safety gates and masked output", () => {
  const safety = manifest.safety.join(" ");
  assert.match(safety, /inactive.*Manual Trigger/i);
  assert.match(safety, /E\.164.*placeholder/i);
  assert.match(safety, /own or are explicitly authorized/i);
  assert.match(safety, /mask.*metadata.*API errors/i);
});

test("Execution Summary trusts the already masked result contract", () => {
  const summaryCode = codeFor("Execution Summary");
  assert.doesNotMatch(summaryCode, /function maskPhone/);
  assert.match(summaryCode, /maskedPhone:\s*item\.json\.maskedPhone/);
});

test("sticky notes wrap their assigned nodes below the text area", () => {
  const groupSpecs = [
    {
      note: "Start and configure note",
      contentHeight: 288,
      nodes: ["Manual Trigger", "CALL-E Config", "Validate CALL-E Config"],
    },
    {
      note: "Prepare call batches note",
      contentHeight: 288,
      nodes: ["Phone/Task List", "Loop Over Calls"],
    },
    {
      note: "Create request note",
      contentHeight: 288,
      nodes: ["Build CALL-E Request Payload", "Create CALL-E Call and Wait"],
    },
    {
      note: "Parse results note",
      contentHeight: 288,
      nodes: ["Parse CALL-E Result", "Demo Result View"],
    },
    {
      note: "Summarize execution note",
      contentHeight: 256,
      nodes: ["Execution Summary"],
    },
  ];
  const nodesByName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const stickyNotes = workflow.nodes.filter(
    (node) => node.type === "n8n-nodes-base.stickyNote",
  );
  const executableNodes = workflow.nodes.filter(
    (node) => node.type !== "n8n-nodes-base.stickyNote",
  );
  const nodeWidth = 120;
  const nodeHeight = 120;
  const outerPadding = 24;
  const textGap = 32;
  const assignedNodes = new Set();
  const violations = [];

  const rectanglesOverlap = (left, right) =>
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;

  for (const spec of groupSpecs) {
    const note = nodesByName.get(spec.note);
    assert.ok(note, `Missing sticky note: ${spec.note}`);
    const [noteX, noteY] = note.position;
    const noteRight = noteX + note.parameters.width;
    const noteBottom = noteY + note.parameters.height;

    for (const nodeName of spec.nodes) {
      const node = nodesByName.get(nodeName);
      assert.ok(node, `Missing executable node: ${nodeName}`);
      assignedNodes.add(nodeName);
      const [nodeX, nodeY] = node.position;

      if (nodeX < noteX + outerPadding) {
        violations.push(`${nodeName} lacks left padding in ${spec.note}`);
      }
      if (nodeX + nodeWidth > noteRight - outerPadding) {
        violations.push(`${nodeName} lacks right padding in ${spec.note}`);
      }
      if (nodeY < noteY + spec.contentHeight + textGap) {
        violations.push(`${nodeName} overlaps the text area in ${spec.note}`);
      }
      if (nodeY + nodeHeight > noteBottom - outerPadding) {
        violations.push(`${nodeName} lacks bottom padding in ${spec.note}`);
      }
    }
  }

  for (const node of executableNodes) {
    if (!assignedNodes.has(node.name)) {
      violations.push(`Executable node is not assigned to a sticky note: ${node.name}`);
    }
  }

  for (let index = 0; index < stickyNotes.length; index += 1) {
    const note = stickyNotes[index];
    const [noteX, noteY] = note.position;
    const noteRect = {
      x: noteX,
      y: noteY,
      width: note.parameters.width,
      height: note.parameters.height,
    };

    for (const otherNote of stickyNotes.slice(index + 1)) {
      const [otherX, otherY] = otherNote.position;
      const otherRect = {
        x: otherX,
        y: otherY,
        width: otherNote.parameters.width,
        height: otherNote.parameters.height,
      };
      if (rectanglesOverlap(noteRect, otherRect)) {
        violations.push(`Sticky notes overlap: ${note.name} -> ${otherNote.name}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
