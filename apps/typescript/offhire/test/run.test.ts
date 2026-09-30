import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { demoRentals, fixtureCall } from "../src/core/fixtures";
import {
  cancelPrepared,
  loadRun,
  prepareRun,
  refreshRun,
  submitRun,
  maskPhone,
  withLock,
  type Settings,
} from "../src/run";
const now = new Date();
const input = {
  ...demoRentals("unit")[0],
  phone: "+12025550123",
  authorizedContact: true,
  isTest: true,
};
const settings: Settings = {
  apiKey: "not-a-real-api-key",
  enabled: true,
  authorized: true,
  phone: input.phone,
  expiresAt: new Date(now.getTime() + 600000).toISOString(),
};
async function temporary(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "offhire-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function fake() {
  let lost = false;
  let accepted: string | null = null;
  let lastBody = "";
  let lastKey = "";
  const requests: { method: string; body: string; key: string | null }[] = [];
  const transport = async (req: Request) => {
    assert.equal(new URL(req.url).origin, "https://api.heycall-e.com");
    const body = req.method === "POST" ? await req.text() : "";
    const key = req.headers.get("idempotency-key");
    requests.push({ method: req.method, body, key });
    if (req.method === "POST") {
      if (accepted) {
        assert.equal(body, lastBody);
        assert.equal(key, lastKey);
      } else {
        accepted = "call_test";
        lastBody = body;
        lastKey = key!;
      }
      if (lost) {
        lost = false;
        throw new TypeError("simulated response loss");
      }
    }
    const f = fixtureCall(input, "confirmed", accepted || "call_test");
    const terminal = req.method === "GET";
    return Response.json(
      {
        id: f.id,
        object: "call_task",
        status: terminal ? "completed" : "queued",
        task: "fictional test",
        recipients: [
          {
            id: "r",
            phones: [input.phone],
            region: "US",
            locale: "en",
            status: terminal ? "completed" : "pending",
            structured_result: null,
            summary: null,
            attempts: terminal
              ? [
                  {
                    id: "a",
                    phone: input.phone,
                    status: "completed",
                    started_at: now.toISOString(),
                    completed_at: now.toISOString(),
                    summary: null,
                    transcript_turns:
                      f.recipients[0].attempts[0].transcriptTurns,
                    provider_call_id: "p",
                    failure_code: null,
                    failure_message: null,
                  },
                ]
              : [],
          },
        ],
        structured_result: terminal ? f.structuredResult : null,
        summary: null,
        task_completed: terminal ? true : null,
        completion_confidence: null,
        evidence: [],
        metadata: {},
        failure_code: null,
        failure_message: null,
        created_at: now.toISOString(),
        completed_at: terminal ? now.toISOString() : null,
      },
      { status: req.method === "POST" ? 201 : 200 },
    );
  };
  return {
    requests,
    transport,
    loseNext: () => {
      lost = true;
    },
  };
}
test("default CLI demonstration never needs credentials or a call", () => {
  const run = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts"], {
    encoding: "utf8",
    env: { ...process.env, CALLE_API_KEY: "", OFFHIRE_LIVE_ENABLED: "false" },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /No phone calls or network requests/);
  assert.match(run.stdout, /reported_off_rent/);
  assert.match(run.stdout, /unconfirmed/);
});
test("preview writes frozen private request without key or network", () =>
  temporary(async (dir) => {
    const r = await prepareRun(input, dir, now);
    assert.equal(r.state, "prepared");
    assert.equal(r.callId, null);
    assert.equal(r.requestJson, (await loadRun(dir)).requestJson);
    assert.equal((await stat(path.join(dir, "run.json"))).mode & 0o777, 0o600);
    assert.doesNotMatch(
      await readFile(path.join(dir, "run.json"), "utf8"),
      /not-a-real-api-key/,
    );
    await assert.rejects(() => prepareRun(input, dir), /already contains/);
  }));
test("missing opt-in, wrong destination, digest, expired grant fail before SDK", () =>
  temporary(async (dir) => {
    const r = await prepareRun(input, dir, now);
    const f = fake();
    for (const s of [
      { ...settings, enabled: false },
      { ...settings, authorized: false },
      { ...settings, phone: "+12025550124" },
      { ...settings, expiresAt: "2000-01-01T00:00:00Z" },
    ])
      await assert.rejects(() =>
        submitRun(dir, s, r.digest, false, f.transport, now),
      );
    await assert.rejects(() =>
      submitRun(dir, settings, "wrong", false, f.transport, now),
    );
    assert.equal(f.requests.length, 0);
  }));
test("real business records are outside this live-roleplay CLI boundary", () =>
  temporary(async (dir) => {
    await assert.rejects(
      () => prepareRun({ ...input, isTest: false }, dir),
      /roleplay/,
    );
  }));
test("SDK create is runtime-invoked then saved ID reconciles through GET", () =>
  temporary(async (dir) => {
    const r = await prepareRun(input, dir, now);
    const f = fake();
    const sent = await submitRun(
      dir,
      settings,
      r.digest,
      false,
      f.transport,
      now,
    );
    assert.equal(sent.callId, "call_test");
    assert.equal(sent.state, "queued");
    assert.equal(
      JSON.parse(f.requests[0].body).recipients[0].phones[0],
      input.phone,
    );
    assert.ok(JSON.parse(f.requests[0].body).result_schema);
    const done = await refreshRun(
      dir,
      { apiKey: settings.apiKey },
      f.transport,
    );
    assert.equal(done.decision?.billing, "reported_off_rent");
    assert.deepEqual(
      f.requests.map((r) => r.method),
      ["POST", "GET"],
    );
    await assert.rejects(
      () => submitRun(dir, settings, r.digest, false, f.transport),
      /already has/,
    );
    assert.equal(f.requests.length, 2);
  }));
test("uncertain recovery sends exactly the same body/key and requires explicit command", () =>
  temporary(async (dir) => {
    const r = await prepareRun(input, dir, now);
    const f = fake();
    f.loseNext();
    const uncertain = await submitRun(
      dir,
      settings,
      r.digest,
      false,
      f.transport,
      now,
    );
    assert.equal(uncertain.state, "dispatch_uncertain");
    assert.equal(uncertain.callId, null);
    await assert.rejects(
      () => submitRun(dir, settings, r.digest, false, f.transport, now),
      /recover/,
    );
    const recovered = await submitRun(
      dir,
      settings,
      r.digest,
      true,
      f.transport,
      now,
    );
    assert.equal(recovered.callId, "call_test");
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests[0], f.requests[1]);
    assert.equal(recovered.idempotencyKey, r.idempotencyKey);
  }));
test("expired uncertain operation cannot create a replacement", () =>
  temporary(async (dir) => {
    const r = await prepareRun(input, dir, now);
    const f = fake();
    f.loseNext();
    await submitRun(dir, settings, r.digest, false, f.transport, now);
    await assert.rejects(
      () =>
        submitRun(
          dir,
          settings,
          r.digest,
          true,
          f.transport,
          new Date(now.getTime() + 3600000),
        ),
      /expired/,
    );
    assert.equal(f.requests.length, 1);
  }));
test("one filesystem lock blocks simultaneous processes for same run", () =>
  temporary(async (dir) => {
    await prepareRun(input, dir);
    await withLock(dir, async () => {
      await assert.rejects(() => withLock(dir, async () => true), /locked/);
    });
  }));
test("cancellation only affects an unsubmitted plan", () =>
  temporary(async (dir) => {
    await prepareRun(input, dir);
    assert.equal((await cancelPrepared(dir)).state, "canceled");
    await assert.rejects(() => cancelPrepared(dir), /cannot be canceled/);
  }));
test("masked destination never repeats full phone", () => {
  assert.equal(maskPhone("+12025550123"), "+••••0123");
  assert.equal(maskPhone(""), "not configured");
});

test("malformed create success without ID stays recoverable as uncertain", () =>
  temporary(async (dir) => {
    const r = await prepareRun(input, dir, now);
    const f = fake();
    const transport = async (request: Request) => {
      const response = await f.transport(request);
      const body = await response.json();
      delete body.id;
      return Response.json(body, { status: 201 });
    };
    const result = await submitRun(
      dir,
      settings,
      r.digest,
      false,
      transport,
      now,
    );
    assert.equal(result.state, "dispatch_uncertain");
    assert.equal(result.callId, null);
    assert.equal(
      (await submitRun(dir, settings, r.digest, true, f.transport, now)).callId,
      "call_test",
    );
  }));
test("saved recipient scope must still match frozen SDK request", () =>
  temporary(async (dir) => {
    const r = await prepareRun(input, dir, now);
    r.rental.phone = "+12025550124";
    await writeFile(path.join(dir, "run.json"), JSON.stringify(r));
    await assert.rejects(() => loadRun(dir), /scope/);
  }));
