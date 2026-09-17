/**
 * Generate absence-wave.workflow.json, inlining the tested classifier.
 *
 *   node examples/build-workflow.mjs
 *
 * The classifier lives in classify.mjs so it can be run by `node --test`. n8n code nodes
 * are not ES modules, so `export ` is stripped on the way in. Generating the workflow
 * rather than hand-editing it is what stops the shipped logic drifting away from the
 * logic under test; `classify.test.mjs` checks the two still match.
 *
 * Re-running with no source change rewrites identical bytes.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "absence-wave.workflow.json");

const classifier = (await readFile(join(HERE, "classify.mjs"), "utf8"))
  .replace(/^export /gm, "")
  .trimEnd();

const note = (name, position, width, height, content) => ({
  parameters: { content, height, width },
  id: `note-${name}`,
  name,
  type: "n8n-nodes-base.stickyNote",
  typeVersion: 1,
  position,
});

const code = (name, position, jsCode, extra = {}) => ({
  parameters: { jsCode },
  id: `node-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position,
  ...extra,
});

const CONFIG = `// Everything an operator has to change is on this screen and nowhere else.
//
// The API key is deliberately absent. It is read from the CALL_E_API_KEY environment
// variable at execution time so it never lands in workflow data, an export, or a git
// history. See the plugin README for where to put it in your n8n deployment.
return [{
  json: {
    schoolName: "Redhill Primary",
    // Placeholder numbers. The next node refuses to run until these are replaced.
    // +91 555 is not assignable to an Indian subscriber, so nothing here can ring.
    students: [
      { id: "S-1041", name: "Aarav",  phones: ["+915550000001"], locale: "en-IN", consent: true },
      { id: "S-1042", name: "Diya",   phones: ["+915550000002"], locale: "hi-IN", consent: true },
      { id: "S-1043", name: "Kavya",  phones: ["+915550000003", "+915550000009"], locale: "ta-IN", consent: true },
      { id: "S-1044", name: "Rohan",  phones: ["+915550000004"], locale: "ta-IN", consent: true },
      { id: "S-1045", name: "Meera",  phones: ["+915550000005"], locale: "en-IN", consent: false },
      { id: "S-1046", name: "Ishaan", phones: ["+915550000006", "+915550000007"], locale: "ta-IN", consent: true },
    ],
    absenceDate: new Date().toISOString().slice(0, 10),
    apiBaseUrl: "https://api.heycall-e.com",
    // A wave, not a broadcast. CALL-E's own guidance is against starting every call at
    // once, and there is no cancel endpoint, so this cap is the only brake that exists.
    concurrency: 3,
    maxWaitSeconds: 240,
    dryRun: true,
  },
}];`;

const APPROVED_API_GATE = `// The only hosts this recipe will send a CALL-E key to.
//
// apiBaseUrl sits on the config screen so an operator can point the recipe at their own
// tenant, and it was interpolated straight into the request URL. The Authorization header
// is built from CALL_E_API_KEY on the same line, so whatever host ended up in that field
// received a live credential: a typo, an http:// paste, or an edited export was enough.
//
// So the field is resolved against this list rather than trusted. Exact hostname match
// rather than a suffix test, because api.heycall-e.com.example.net ends with the approved
// name and is not the approved host. HTTPS only, no credentials in the URL, no query, no
// fragment and no path, because a base URL carrying any of those is not a base URL.
const APPROVED_API_HOSTS = ["api.heycall-e.com"];

function approvedApiBaseUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { error: "apiBaseUrl is empty. Set it to https://api.heycall-e.com." };
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: "apiBaseUrl " + JSON.stringify(raw) + " is not a URL." };
  }
  if (url.protocol !== "https:") {
    return { error: "apiBaseUrl must use https, not " + url.protocol.replace(":", "")
      + ". A CALL-E key sent over http is a key on the wire in clear text." };
  }
  if (url.username || url.password) {
    return { error: "apiBaseUrl carries credentials in the URL. Remove them; the key is "
      + "read from CALL_E_API_KEY at execution time." };
  }
  if (url.search || url.hash) {
    return { error: "apiBaseUrl carries a query or a fragment. A base URL has neither." };
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    return { error: "apiBaseUrl carries the path " + JSON.stringify(url.pathname)
      + ". Give the host only; the recipe appends /v1/calls itself." };
  }
  if (!APPROVED_API_HOSTS.includes(url.hostname)) {
    return { error: "apiBaseUrl host " + JSON.stringify(url.hostname)
      + " is not approved. Approved: " + APPROVED_API_HOSTS.join(", ") + "." };
  }
  return { url: "https://" + url.host };
}

// A redirect is the other way the key leaves the approved host. n8n's httpRequest follows
// them by default and axios replays the request headers when it does, so one 302 from any
// host is enough to hand the Authorization header to whatever the Location names. These
// two options say no on both layers: disableFollowRedirect is n8n's own flag and
// maxRedirects is the axios setting underneath it, and a redirect now surfaces as a
// response to look at rather than a hop nobody sees.
const NO_CREDENTIAL_REDIRECTS = { disableFollowRedirect: true, maxRedirects: 0 };
`;

const VALIDATE = `${APPROVED_API_GATE}
// Fail before dialling, not halfway through a wave.
const cfg = $input.first().json;
const problems = [];

if (!process.env.CALL_E_API_KEY && !cfg.dryRun) {
  problems.push("CALL_E_API_KEY is not set. Set it in your n8n deployment, or leave dryRun true.");
}

const PLACEHOLDER = /^\\+91555/;
const e164 = /^\\+[1-9]\\d{7,14}$/;

for (const student of cfg.students || []) {
  for (const phone of student.phones || []) {
    if (!e164.test(phone)) {
      problems.push(\`\${student.id}: \${phone} is not an E.164 number\`);
    }
    if (PLACEHOLDER.test(phone) && !cfg.dryRun) {
      problems.push(\`\${student.id}: \${phone} is a shipped placeholder. Replace it with a number you are authorised to call.\`);
    }
  }
  if (!Array.isArray(student.phones) || student.phones.length === 0) {
    problems.push(\`\${student.id}: no phone numbers\`);
  }
}

const base = approvedApiBaseUrl(cfg.apiBaseUrl);
if (base.error) {
  problems.push(base.error);
} else {
  // Normalised, so every node downstream carries the exact approved origin rather than
  // whatever spelling was typed on the config screen.
  cfg.apiBaseUrl = base.url;
}

if (problems.length > 0) {
  throw new Error("Refusing to run:\\n  " + problems.join("\\n  "));
}

return [{ json: cfg }];`;

const ROWS = `// One item per student, so the loop below is a wave and not a single request.
const cfg = $input.first().json;
return (cfg.students || []).map((student) => ({
  json: { ...student, schoolName: cfg.schoolName, absenceDate: cfg.absenceDate,
          apiBaseUrl: cfg.apiBaseUrl, maxWaitSeconds: cfg.maxWaitSeconds,
          dryRun: cfg.dryRun },
}));`;

const CONSENT = `// Consent is never inferred. A row without recorded consent is refused, not defaulted,
// and it is reported as skipped rather than folded into the failures, because no call was
// placed and reporting one would be a lie about what this workflow did.
const out = [];
for (const item of $input.all()) {
  if (item.json.consent === true) {
    out.push(item);
  } else {
    out.push({ json: { ...item.json, resolution: "skipped", attempts: 0,
                       reason: "no recorded consent to be called", needsAHuman: false,
                       skip: true } });
  }
}
return out;`;

const BUILD = `// One call request for one student.
const row = $input.first().json;
if (row.skip) {
  return [{ json: row }];
}

// Derived from (student, date), so a retry after a timeout reuses the same key instead of
// minting a fresh one. Without this a network failure double-calls a family.
const idempotencyKey = \`absence-\${row.id}-\${row.absenceDate}\`;

return [{
  json: {
    ...row,
    idempotencyKey,
    request: {
      // The whole fallback chain goes in the request. CALL-E tries them in order; the
      // workflow does not orchestrate retries itself.
      phones: row.phones,
      // The language belongs to the family, not to the deployment. This is the single
      // field that makes the recipe work outside one country.
      locale: row.locale,
      task: [
        "This is an automated call from the school attendance office.",
        "You are speaking with an AI assistant, not a person.",
        "You can ask to speak to a member of staff at any time and I will arrange a callback.",
        "",
        \`You are calling on behalf of \${row.schoolName} about \${row.name}, who was marked absent on \${row.absenceDate} and whose absence has not yet been explained.\`,
        "Ask, politely and briefly: the reason for the absence, and when the student is expected back.",
        "Do not give advice. Do not discuss anything except this absence. If the person is distressed, asks for a human, disputes the absence, or says anything suggesting the student may be at risk, stop asking questions, say a member of staff will call back today, and end the call politely.",
      ].join("\\n"),
      result_schema: {
        type: "object",
        required: ["reason_category", "expected_return"],
        properties: {
          reason_category: { type: "string", enum: ["illness", "medical_appointment", "family_emergency", "religious_observance", "transport", "other", "unknown"] },
          expected_return: { type: "string", enum: ["today", "tomorrow", "later_this_week", "longer", "unknown"] },
          parent_confirmed_aware: { type: "string", enum: ["yes", "no", "unknown"] },
          free_text_note: { type: "string" },
        },
      },
    },
  },
}];`;

const CREATE = `${APPROVED_API_GATE}
// Place the call and wait for it to finish, with a hard ceiling on the wait.
const row = $input.first().json;
if (row.skip) {
  return [{ json: row }];
}

// dryRun returns a shaped response and places no call, so the whole recipe can be run
// once end to end before it is pointed at a real number.
if (row.dryRun) {
  const shapes = {
    // Two rows that close. An explicit "yes" on parent_confirmed_aware is what closing
    // requires, and leaving that field out of these shapes is how the first version of this
    // demo escalated all three and reported a resolution rate of zero.
    "S-1041": { status: "completed", structured_result: { reason_category: "illness", expected_return: "tomorrow", parent_confirmed_aware: "yes" } },
    "S-1042": { status: "completed", structured_result: { reason_category: "medical_appointment", expected_return: "today", parent_confirmed_aware: "yes" } },
    // A schema-valid answer from a parent who did not know. Resolved, escalated, not closed,
    // and first in the queue. This is the row worth reading in the output.
    "S-1043": { status: "completed", structured_result: { reason_category: "transport", expected_return: "today", parent_confirmed_aware: "no" }, attempts: 2 },
    // The two shapes that are easy to get wrong, both taken from real calls.
    "S-1044": { status: "completed", structured_result: null },
    "S-1046": { status: "no_answer", structured_result: null, attempts: 2 },
  };
  const shape = shapes[row.id] || { status: "completed", structured_result: null };
  const attempts = Array.from({ length: shape.attempts || 1 }, (_, i) => ({
    provider_call_id: \`dry_\${row.id}_\${i + 1}\`,
  }));
  return [{ json: { ...row, recipient: { ...shape, attempts }, placedByThisRun: false } }];
}

// Resolved again here rather than trusted from the config node. This is the line that
// builds the Authorization header, so this is where the destination has to be known good:
// a node inserted between the two, or an edited export, changes the field without ever
// passing the earlier check.
const base = approvedApiBaseUrl(row.apiBaseUrl);
if (base.error) {
  throw new Error("Refusing to send a CALL-E key. " + base.error);
}
const apiBaseUrl = base.url;

const headers = {
  Authorization: \`Bearer \${process.env.CALL_E_API_KEY}\`,
  "Idempotency-Key": row.idempotencyKey,
  "Content-Type": "application/json",
};

const created = await this.helpers.httpRequest({
  method: "POST",
  url: \`\${apiBaseUrl}/v1/calls\`,
  headers,
  body: row.request,
  json: true,
  timeout: 30000,
  ...NO_CREDENTIAL_REDIRECTS,
});

const callId = created.id || created.call_id;
const deadline = Date.now() + (row.maxWaitSeconds || 240) * 1000;
let call = created;

while (Date.now() < deadline) {
  const terminal = ["completed", "failed", "no_answer", "busy", "cancelled"];
  const recipient = (call.recipients || [])[0];
  if (recipient && terminal.includes(recipient.status)) {
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
  call = await this.helpers.httpRequest({
    method: "GET",
    url: \`\${apiBaseUrl}/v1/calls/\${callId}\`,
    headers: { Authorization: headers.Authorization },
    json: true,
    timeout: 30000,
    ...NO_CREDENTIAL_REDIRECTS,
  });
}

// Only the two fields the classifier needs from the call, rather than the whole
// payload. A transcript travelling between nodes is a transcript in a log somebody has
// not thought about, and the classifier reads the recipient count and the task-level
// result and nothing else.
return [{ json: { ...row, callId, recipient: (call.recipients || [])[0] || null,
                  call: { recipients: call.recipients || [],
                          structured_result: call.structured_result || null },
                  placedByThisRun: true } }];`;

const CLASSIFY = `${classifier}

// --- node wiring ---------------------------------------------------------------------
const row = $input.first().json;
if (row.skip) {
  return [{ json: row }];
}
// row.call carries the recipient count and the task-level result, which is what lets a
// single-recipient task-level result be read. A row without it classifies on the
// recipient alone.
const verdict = classifyRecipient(row.recipient, row.call);
return [{
  json: {
    id: row.id,
    locale: row.locale,
    phone: maskNumber((row.phones || [])[0]),
    placedByThisRun: row.placedByThisRun === true,
    ...verdict,
  },
}];`;

const SUMMARY = `${classifier}

// --- node wiring ---------------------------------------------------------------------
const rows = $input.all().map((item) => item.json);
const summary = summariseWave(rows);

const lines = [
  \`\${summary.attempted} attempted, \${summary.counts.skipped} skipped for no consent\`,
  \`resolved      \${summary.counts.resolved}   schema-valid reason on record\`,
  \`undetermined  \${summary.counts.undetermined}   a call happened, no usable answer, needs a person\`,
  \`failed        \${summary.counts.failed}   nobody reached on any number\`,
  \`attempts billed \${summary.attemptsBilled}, of which \${summary.attemptsOpen} left somebody with work to do\`,
];
if (summary.resolutionRate !== null) {
  lines.push(\`resolution rate \${Math.round(summary.resolutionRate * 100)}%\`);
} else {
  lines.push("resolution rate not computed: nothing was attempted");
}

// The queue is printed after the counts rather than folded into a rate, so nobody can
// read this output and think the undetermined cases are closed.
return [{ json: { summary: lines, needsAPerson: summary.queue, counts: summary.counts } }];`;

const nodes = [
  note("Recipe overview", [-320, -160], 460, 520,
    [
      "## School absence calls, as a wave",
      "",
      "Calls the families whose absence notification went unanswered, each in that",
      "family's language, and keeps three outcomes apart instead of two.",
      "",
      "**Imports inactive.** Runs from the Manual Trigger. `dryRun` is true, so the",
      "first run places no calls at all.",
      "",
      "### To run it for real",
      "1. Set `CALL_E_API_KEY` in your n8n deployment's environment.",
      "2. Replace the placeholder numbers in **Absence Config**. The validator refuses",
      "   to dial anything starting `+91555`.",
      "3. Set `dryRun` to false.",
      "4. To schedule it, enable **Every School Morning** and activate the workflow.",
      "",
      "### To stop it",
      "Deactivate the workflow, or disable the schedule node. There is no cancel",
      "endpoint on the API, so a call already accepted will complete. The concurrency",
      "cap is what limits how many are in flight when you stop it.",
    ].join("\n")),
  note("Three outcomes note", [1740, -160], 420, 300,
    [
      "## Why three outcomes",
      "",
      "A call has three endings and only one closes a record:",
      "",
      "- **resolved** a usable answer came back",
      "- **undetermined** a conversation happened and produced nothing",
      "- **failed** nobody was reached",
      "",
      "The middle one is the point. CALL-E can return `completed` with",
      "`structured_result: null`, and it can return every required field as",
      "`\"unknown\"`. Both are real conversations worth nothing, and filing them",
      "with the successes is how a dashboard reports full coverage for a child",
      "nobody heard about.",
      "",
      "`classify.mjs` holds this rule and `node --test examples/` checks it.",
    ].join("\n")),
  {
    parameters: {},
    id: "node-manual-trigger",
    name: "Manual Trigger",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: [200, 0],
  },
  {
    parameters: {
      rule: { interval: [{ triggerAtHour: 9, triggerAtMinute: 30 }] },
    },
    id: "node-schedule-trigger",
    name: "Every School Morning",
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2,
    position: [200, 200],
    disabled: true,
    notes: "Disabled on import. Enable it and activate the workflow to make recurrence the host's job rather than a sentence in a README.",
  },
  code("Absence Config", [420, 0], CONFIG),
  code("Validate Config", [640, 0], VALIDATE),
  code("Absence Rows", [860, 0], ROWS),
  code("Consent Gate", [1080, 0], CONSENT),
  {
    parameters: { options: {} },
    id: "node-loop-over-students",
    name: "Loop Over Students",
    type: "n8n-nodes-base.splitInBatches",
    typeVersion: 3,
    position: [1300, 0],
  },
  code("Build Call Request", [1520, 160], BUILD),
  code("Create Call And Wait", [1740, 160], CREATE),
  code("Classify Outcome", [1960, 160], CLASSIFY),
  code("Wave Summary", [1520, -160], SUMMARY),
];

const connections = {
  "Manual Trigger": { main: [[{ node: "Absence Config", type: "main", index: 0 }]] },
  "Every School Morning": { main: [[{ node: "Absence Config", type: "main", index: 0 }]] },
  "Absence Config": { main: [[{ node: "Validate Config", type: "main", index: 0 }]] },
  "Validate Config": { main: [[{ node: "Absence Rows", type: "main", index: 0 }]] },
  "Absence Rows": { main: [[{ node: "Consent Gate", type: "main", index: 0 }]] },
  "Consent Gate": { main: [[{ node: "Loop Over Students", type: "main", index: 0 }]] },
  // Output 0 of splitInBatches is the done branch, output 1 is the loop body.
  "Loop Over Students": {
    main: [
      [{ node: "Wave Summary", type: "main", index: 0 }],
      [{ node: "Build Call Request", type: "main", index: 0 }],
    ],
  },
  "Build Call Request": { main: [[{ node: "Create Call And Wait", type: "main", index: 0 }]] },
  "Create Call And Wait": { main: [[{ node: "Classify Outcome", type: "main", index: 0 }]] },
  "Classify Outcome": { main: [[{ node: "Loop Over Students", type: "main", index: 0 }]] },
};

const workflow = {
  name: "School absence calls, in the family's language",
  active: false,
  nodes,
  connections,
  settings: { executionOrder: "v1" },
  tags: [],
  pinData: {},
};

await writeFile(OUT, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
console.log(`wrote ${OUT} (${nodes.length} nodes)`);
