import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Compile the exact scheduler functions with only storage/provider boundaries
// replaced. No Next server, credentials, files containing records, or network.
const source = await readFile(new URL("../lib/calle/schedule.ts", import.meta.url), "utf8");
const selected = source.slice(source.indexOf("async function claimDueCall"), source.indexOf("async function finishClaim"))
  + source.slice(source.indexOf("export async function runDueScheduledCalls")).replace(/^export /, "");
const compiled = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;

function fixture(mode: "unknown" | "accepted" | "rejected" | "reservation_unknown") {
  let calls = 0;
  let schedule = { version: 1, calls: ["first", "second"].map((id, index) => ({
    id, scheduledFor: `2026-09-15T00:0${index}:00Z`, status: "pending", sealedRequest: {
      destinationE164: "+12025550100", purpose: `Distinct approved purpose ${index}`, idempotencyKey: id,
    },
  })) };
  const context = {
    Date,
    mutate: async (operation: (value: typeof schedule) => unknown) => operation(schedule),
    writeSchedule: async (value: typeof schedule) => { schedule = value; },
    scheduledCallDispatchDecision: () => "due",
    writeCallLog: async () => {},
    open: (request: unknown) => request,
    reserveOutboundCall: async () => ({ state: mode === "reservation_unknown" ? "unknown" : "reserved" }),
    recordOutboundCallResult: async () => {},
    finishClaim: async (id: string, result: { status: string }) => { schedule.calls.find(call => call.id === id)!.status = result.status; },
    callFailureCode: () => "synthetic",
    isDefinitiveCalleRejection: (error: { definitive?: boolean }) => error.definitive === true,
    createCalleCall: async () => {
      calls++;
      if (calls === 1 && ["unknown", "rejected"].includes(mode)) throw { definitive: mode === "rejected" };
      return { callId: `call_synthetic_${calls}` };
    },
  };
  const run = runInNewContext(`${compiled}\nrunDueScheduledCalls`, context) as (secret: string, now: Date) => Promise<{ processed: number }>;
  return { run, calls: () => calls, statuses: () => schedule.calls.map(call => call.status) };
}

for (const mode of ["unknown", "reservation_unknown"] as const) {
  test(`${mode} stops this pass and the next automatic poll before a conflicting call`, async () => {
    const state = fixture(mode);
    const now = new Date("2026-09-15T00:02:00Z");
    assert.equal((await state.run("synthetic-only", now)).processed, 1);
    assert.equal((await state.run("synthetic-only", now)).processed, 0);
    assert.equal(state.calls(), mode === "unknown" ? 1 : 0);
    assert.deepEqual(state.statuses(), ["unknown", "pending"]);
  });
}

for (const mode of ["accepted", "rejected"] as const) {
  test(`known ${mode} outcomes retain normal scheduled progress`, async () => {
    const state = fixture(mode);
    assert.equal((await state.run("synthetic-only", new Date())).processed, 2);
    assert.equal(state.calls(), 2);
    assert.deepEqual(state.statuses(), [mode, "accepted"]);
  });
}
