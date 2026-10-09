import { CalleClient } from "@call-e/calle";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { fixtureCall } from "./fixtures.ts";
import { terminal } from "./workflow.ts";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The only production module that knows about CALL-E, credentials, replay files or recording. */
export class PhoneAdapter {
  client: any;
  directory: string;
  liveTransport: boolean;
  constructor(client?: any, directory = resolve("data/recordings")) {
    this.directory = directory;
    this.liveTransport = client === undefined || client === null;
    this.client =
      client ??
      (process.env.CALLE_API_KEY
        ? new CalleClient({
            apiKey: process.env.CALLE_API_KEY,
            fetch: (r) => fetch(r, { signal: AbortSignal.timeout(25000) }),
          })
        : null);
  }
  settings(used: number) {
    const cap = Number(process.env.MAX_LIVE_CALLS || 4);
    return {
      app: "last-crate",
      liveEnabled: process.env.LIVE_CALLS_ENABLED === "true" && !!this.client,
      hasKey: !!this.client,
      roleplay: process.env.LIVE_ROLEPLAY !== "false",
      used,
      cap: Number.isInteger(cap) && cap >= 0 ? cap : 0,
      recordings: this.list(),
    };
  }
  assertAllowed(input: any) {
    if (!this.settings(0).liveEnabled)
      throw Error(
        "Live calls are disabled. Configure the key, allowlist and LIVE_CALLS_ENABLED in .env.",
      );
    const allowed = (process.env.CALLE_ALLOWED_PHONES || "")
      .split(",")
      .map((x) => x.trim());
    if (
      ![
        input.phone,
        ...input.partners
          .filter((p: any) => p.approved)
          .map((p: any) => p.phone),
      ].every((p) => allowed.includes(p))
    )
      throw Error(
        "Each live contact must be on CALLE_ALLOWED_PHONES. No calls placed.",
      );
  }
  path(id: string) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw Error("Invalid recording ID.");
    return resolve(this.directory, id + ".json");
  }
  read(id: string) {
    const local = this.path(id);
    const bundled = new URL(
      "./response-fixtures/recorded-route-rejection.json",
      import.meta.url,
    );
    const bundle = JSON.parse(
      readFileSync(existsSync(local) ? local : bundled, "utf8"),
    );
    if (bundle.id !== id) throw Error("Recording not found.");
    if (
      bundle.version !== 1 ||
      bundle.provenance !== "live-recording" ||
      !Array.isArray(bundle.calls)
    )
      throw Error("Unsupported recording format.");
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          clockMinute: bundle.clockMinute,
          input: bundle.input,
          calls: bundle.calls,
          error: bundle.error,
        }),
      )
      .digest("hex");
    if (hash !== bundle.sha256)
      throw Error(
        "Recording integrity check failed. Restore the captured file.",
      );
    return bundle;
  }
  list() {
    const bundled = new URL(
      "./response-fixtures/recorded-route-rejection.json",
      import.meta.url,
    );
    const ids = existsSync(bundled)
      ? [JSON.parse(readFileSync(bundled, "utf8")).id]
      : [];
    if (existsSync(this.directory))
      ids.push(
        ...readdirSync(this.directory)
          .filter((f) => /^[a-zA-Z0-9-]+\.json$/.test(f))
          .map((f) => f.slice(0, -5)),
      );
    return [...new Set(ids)].flatMap((id) => {
      try {
        const b = this.read(String(id));
        return [
          {
            id: b.id,
            createdAt: b.createdAt,
            state: b.state,
            provenance: b.provenance,
            callCount: b.calls.length,
          },
        ];
      } catch {
        return [];
      }
    });
  }
  async execute({ run, step, save, reserve, fixtureDelay = 2200 }: any) {
    const capture = () => {
      try {
        this.record(run);
      } catch {
        run.recordingError =
          "Snapshot export failed; the original result remains in SQLite.";
        save();
      }
    };
    if (step.result) return step.result;
    if (run.input.mode === "fixture") {
      await delay(fixtureDelay);
      if (run.input.replayId) {
        const bundle = this.read(run.input.replayId);
        const recorded = bundle.calls.find((c: any) => c.role === step.role);
        if (!recorded?.result) {
          if (bundle.error)
            throw Object.assign(new Error(bundle.error.message), {
              code: bundle.error.code,
            });
          throw Error(
            "This recording has no completed response for this stage. Replay never creates a live replacement.",
          );
        }
        step.result = structuredClone(recorded.result);
        step.provenance = "live-recording-replay";
      } else {
        step.result = fixtureCall(
          step.role,
          run.input,
          run.offer,
          run.selected,
        );
        step.provenance = "synthetic-template";
      }
      step.id = step.result.id;
      step.status = step.result.status;
      save();
      return step.result;
    }
    if (!this.client)
      throw Error(
        "CALL-E key unavailable. Restore configuration and resume the saved call.",
      );
    if (!step.id) {
      reserve(step.key);
      const call = await this.client.calls.create(step.request, {
        idempotencyKey: step.key,
      });
      step.id = call.id;
      step.status = call.status;
      step.provenance = "live-api";
      save();
      if (terminal(call.status)) {
        step.result = call;
        save();
        capture();
        return call;
      }
    }
    const until = Date.now() + 180000;
    while (Date.now() < until) {
      const call = await this.client.calls.get(step.id);
      step.status = call.status;
      save();
      if (terminal(call.status)) {
        step.result = call;
        save();
        capture();
        return call;
      }
      await delay(5000);
    }
    throw Error(
      "The call is still unresolved. Resume checks the saved call ID; it will not redial.",
    );
  }
  record(run: any) {
    if (
      !this.liveTransport ||
      run.input.mode !== "live" ||
      (!run.calls.some((c: any) => c.result) && !run.providerError)
    )
      return;
    mkdirSync(this.directory, { recursive: true });
    // Redact known contacts and conversational identifiers consistently in input, quotes and turns.
    const replacements: [string, string][] = [
      [run.input.address, "Recorded collection address"],
      [run.input.donor, "Recorded bakery"],
      ...run.input.partners.map((p: any, i: number) => [
        p.name,
        `Recorded partner ${i + 1}`,
      ]),
      [run.input.phone, "+12025550101"],
      ...run.input.partners.map((p: any, i: number) => [
        p.phone,
        `+1202555010${i + 2}`,
      ]),
    ];
    const redact = (value: any): any => {
      if (typeof value === "string") {
        for (const [from, to] of replacements
          .filter(([s]) => s)
          .sort((a, b) => b[0].length - a[0].length))
          value = value.split(from).join(to);
        return value
          .replace(/iams_live_[\w-]+/g, "[REDACTED]")
          .replace(
            /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
            "[email withheld]",
          );
      }
      if (Array.isArray(value)) return value.map(redact);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, redact(v)]),
        );
      return value;
    };
    const calls = run.calls
      .filter((c: any) => c.result)
      .map((c: any) => ({
        role: c.role,
        result: redact({
          id: c.result.id,
          status: c.result.status,
          taskCompleted: c.result.taskCompleted,
          structuredResult: c.result.structuredResult,
          completionConfidence: c.result.completionConfidence,
          summary: c.result.summary,
          evidence: c.result.evidence,
          recipients: c.result.recipients,
          failureCode: c.result.failureCode,
          failureMessage: c.result.failureMessage,
        }),
      }));
    const content = {
      clockMinute: run.matchClock ?? null,
      input: redact({ ...run.input, mode: "fixture" }),
      calls,
      error: run.providerError ? redact(run.providerError) : null,
    };
    const bundle = {
      version: 1,
      id: run.id,
      provenance: "live-recording",
      state: run.state,
      createdAt: new Date().toISOString(),
      clockMinute: run.matchClock ?? null,
      privacy:
        "Known inputs and email addresses redacted. Stored privately; free-form speech still needs review before public sharing.",
      ...content,
      sha256: createHash("sha256")
        .update(JSON.stringify(content))
        .digest("hex"),
    };
    const path = this.path(run.id);
    writeFileSync(path + ".tmp", JSON.stringify(bundle, null, 2));
    renameSync(path + ".tmp", path);
  }
}
