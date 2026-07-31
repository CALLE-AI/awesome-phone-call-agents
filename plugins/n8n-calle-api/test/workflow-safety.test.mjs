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
    codeFor(nodeName),
  );
  return execute(
    input,
    helpers,
    globals.Date ?? Date,
    globals.setTimeout ?? setTimeout,
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
            apiKey: "test_api_key",
            baseUrl: "https://api.heycall-e.com",
            pollIntervalSeconds: 5,
            waitTimeoutMinutes: 4,
          },
          createInput: { recipients: [{ phones: [responsePhone] }] },
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
            apiKey: "test_api_key",
            baseUrl: "https://api.heycall-e.com",
            pollIntervalSeconds: 5,
            waitTimeoutMinutes: 4,
          },
          createInput: { recipients: [{ phones: ["+14155550100"] }] },
          idempotencyKey: "test-key",
          callItemId: "ivr_sample_001",
        },
      },
    ],
    {
      httpRequest: async () => ({
        statusCode: 201,
        statusMessage: "Created",
        body: { id: "job_123", object: "call_task", status: "completed" },
      }),
    },
  );

  assert.equal(output.json.ok, false);
  assert.match(output.json.apiError.message, /documented call ID/);
});

test("the Code-node polling timeout stays below the stock runner task limit", async () => {
  const [configured] = await runCodeNode("CALL-E Config");
  assert.equal(configured.json.calleConfig.waitTimeoutMinutes, 4);

  const validConfig = {
    apiKey: "test_api_key",
    baseUrl: "https://api.heycall-e.com",
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
            apiKey: "test_api_key",
            baseUrl: "https://api.heycall-e.com",
            pollIntervalSeconds: 29,
            waitTimeoutMinutes: 4,
          },
          createInput: { recipients: [{ phones: ["+14155550100"] }] },
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
          body: { id: "call_123", object: "call_task", status: "in_progress" },
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
