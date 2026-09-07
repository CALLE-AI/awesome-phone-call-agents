import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import application from "../fixtures/demo-application.json" with { type: "json" };
import clarifications from "../fixtures/demo-clarifications.json" with { type: "json" };
import type { Clarification } from "../lib/types";

// Keep test applications and sessions out of the developer's data directory.
const project = process.cwd();
const sandbox = await mkdtemp(path.join(tmpdir(), "clarity-routes-"));
await cp(path.join(project, "fixtures"), path.join(sandbox, "fixtures"), {
  recursive: true,
  filter: (source) => !source.endsWith("golden-run.json"),
});
process.chdir(sandbox);
const { POST: analyze } = await import("../app/api/analyze/route");
const { POST: call } = await import("../app/api/call/route");
const { createSession, getSession } = await import("../lib/session");

const originalMode = process.env.DEMO_MODE;
const originalPhone = process.env.DEMO_PHONE_E164;
process.env.DEMO_MODE = "replay";
process.env.DEMO_PHONE_E164 = "+15555550100";

after(async () => {
  process.chdir(project);
  if (originalMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = originalMode;
  if (originalPhone === undefined) delete process.env.DEMO_PHONE_E164;
  else process.env.DEMO_PHONE_E164 = originalPhone;
  await rm(sandbox, { recursive: true, force: true });
});

function request(body: unknown) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("the example never inherits an environment recipient or browser-supplied phone", async () => {
  const response = await analyze(request({ ...application, candidatePhone: "+15555550100" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.candidatePhone, null);
  const session = await getSession(result.sessionId);
  assert.equal(session?.application.candidatePhone, undefined);
});

test("analysis resolves the number from the submitted application text", async () => {
  const response = await analyze(request({
    ...application,
    resume: `${application.resume}\nPhone: +15555550100`,
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).candidatePhone, "+15555550100");
});

test("a live session with an old demo fallback cannot call a number absent from its text", async () => {
  const session = await createSession({
    application: { ...application, candidatePhone: "+15555550100" },
    clarifications: clarifications as Clarification[],
  });
  const response = await call(request({ sessionId: session.id, phone: "+15555550100" }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /No phone number was found/);
  assert.equal((await getSession(session.id))?.callId, null);
});

test("a replay session works without a recipient", async () => {
  const session = await createSession({
    application,
    clarifications: clarifications as Clarification[],
    replay: true,
  });
  const response = await call(request({ sessionId: session.id }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).replay, true);
});

test("malformed JSON values return client errors instead of throwing", async () => {
  for (const body of [null, [], { resume: 42 }, { candidateName: {} }]) {
    assert.equal((await analyze(request(body))).status, 400);
  }
  for (const body of [null, [], {}, { sessionId: 42 }, { sessionId: "../private" }]) {
    assert.equal((await call(request(body))).status, 400);
  }
});

test("session lookup cannot read a JSON file outside the data directory", async () => {
  await writeFile(path.join(sandbox, "private.json"), JSON.stringify({ id: "private" }));
  assert.equal(await getSession("../private"), null);
});
