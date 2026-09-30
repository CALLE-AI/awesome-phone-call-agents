import { CalleAPIError, CalleConnectionError, type Call } from "@call-e/calle";
import { describe, expect, it } from "vitest";
import { calleClientOptions } from "../src/calle/endpoint.js";
import { creationRefused, MAX_LIVE_CALL_MINUTES, toLine, type CallPort } from "../src/calle/ports.js";
import { loadDay } from "../src/core/day.js";
import { CallLedger } from "../src/core/ledger.js";
import { maskPhonesDeep, maskPhonesInText } from "../src/core/redact.js";
import { RouteEngine, type EngineOptions } from "../src/engine/engine.js";
import { FieldRegistry } from "../src/field/registry.js";
import { FieldSession, type FieldSetup, type FieldStop } from "../src/field/session.js";
import { FIELD_CONSENT, parseFieldStart } from "../src/field/setup.js";
import { isLoopbackHost, loadLiveConfig } from "../src/server/config.js";
import { RepeatCallError, RunController } from "../src/server/run.js";

// Safety rules from review: the queue stops on ambiguity, keys stay on approved
// origins, the shared live day stays on loopback, phone numbers are masked, and
// each destination is called at most once a day. No network, no calls.

const refused = () => new CalleAPIError({ code: "call_not_ready", message: "Region not ready for +14155550199", status: 422 });
const ambiguous = () => new CalleConnectionError("socket hang up while calling +14155550199");

function port(start: CallPort["start"], poll: CallPort["poll"] = async () => ({ lines: [], final: null })): CallPort & { starts: string[] } {
  const starts: string[] = [];
  return {
    mode: "live",
    starts,
    start: async (request, now) => {
      starts.push(request.stopId);
      return start(request, now);
    },
    poll,
  };
}

function fieldRoute(callPort: CallPort, ledger = new CallLedger(), phones = ["+14155550101", "+14155550102"]) {
  let now = Date.UTC(2026, 8, 14, 9, 0);
  const stops: FieldStop[] = phones.map((phone, i) => ({
    id: `s${i + 1}`,
    order: `#T${i + 1}`,
    customer: `Customer ${i + 1}`,
    label: "",
    phone,
    region: "US",
    cash: "",
    lat: 40.7 + 0.018 + i * 0.002,
    lng: -74,
    codAmount: null,
    serviceMinutes: 3,
    windowEnd: null,
    firstTime: false,
    gated: false,
  }));
  const setup: FieldSetup = {
    merchant: "Test Shop",
    language: "English",
    callAheadMinutes: 30,
    speedKmh: 20,
    testCall: true,
    utcOffsetMinutes: 0,
    stops,
    rider: { lat: 40.7, lng: -74 },
    locationSource: "drag",
  };
  const session = new FieldSession("field-test", setup, callPort, () => now, {
    allowed: (phone) => !ledger.calledToday(phone, 0),
    record: (phone) => ledger.record(phone, 0),
  });
  return { session, advance: (minutes: number) => (now += minutes * 60_000) };
}

describe("the live queue stops on ambiguity", () => {
  it("classifies only CALL-E 4xx refusals as definitely not placed", () => {
    expect(creationRefused(refused())).toBe(true);
    expect(creationRefused(new CalleAPIError({ code: "rate_limited", message: "", status: 429 }))).toBe(true);
    expect(creationRefused(ambiguous())).toBe(false);
    expect(creationRefused(new CalleAPIError({ code: "server_error", message: "", status: 503 }))).toBe(false);
    expect(creationRefused(new CalleAPIError({ code: "timeout", message: "", status: 408 }))).toBe(false);
    expect(creationRefused(new CalleAPIError({ code: "conflict", message: "", status: 409 }))).toBe(false);
    expect(creationRefused(new Error("fetch failed"))).toBe(false);
  });

  it("route: an ambiguous creation stops all further calls instead of calling the next stop", async () => {
    const callPort = port(async () => {
      throw ambiguous();
    });
    const { session, advance } = fieldRoute(callPort);
    for (let i = 0; i < 5; i++) {
      await session.tick();
      advance(1);
    }
    expect(callPort.starts).toEqual(["s1"]);
    expect(session.callsHalted).toContain("did not confirm");
    expect(JSON.stringify(session.log)).not.toContain("+14155550199");
  });

  it("route: a definite refusal moves on to the next stop", async () => {
    const callPort = port(async () => {
      throw refused();
    });
    const { session, advance } = fieldRoute(callPort);
    for (let i = 0; i < 3; i++) {
      await session.tick();
      advance(1);
    }
    expect(callPort.starts).toEqual(["s1", "s2"]);
    expect(session.callsHalted).toBeNull();
    expect(session.calls[0].result).not.toContain("+14155550199");
  });

  it("route: a call that never reaches a terminal status keeps the line busy and stops the queue", async () => {
    const callPort = port(async () => ({ callId: "call_stuck" }));
    const { session, advance } = fieldRoute(callPort);
    await session.tick();
    advance(MAX_LIVE_CALL_MINUTES + 1);
    await session.tick();
    await session.tick();
    expect(session.lineBusy).toBe(true);
    expect(session.callsHalted).toContain("has not finished");
    expect(callPort.starts).toEqual(["s1"]);
  });

  it("demo day: an ambiguous creation stops the queue for the rest of the day", async () => {
    const { day, travel } = loadDay();
    const callPort = port(async () => {
      throw ambiguous();
    });
    const options: EngineOptions = { day, travel, runId: "test", routeCall: (stop) => ({ port: callPort, target: { phone: stop.phone, region: "US" } }) };
    const engine = new RouteEngine(options);
    for (let now = 0; now <= 240 && !engine.done; now += 0.5) await engine.advance(now);
    expect(callPort.starts).toHaveLength(1);
    expect(engine.callsHalted).not.toBeNull();
    expect(engine.events.some((event) => event.type === "calls_halted")).toBe(true);
  });

  it("demo day: a live call past the time limit stops the queue without freeing the line", async () => {
    const { day, travel } = loadDay();
    const callPort = port(async () => ({ callId: "call_stuck" }));
    const engine = new RouteEngine({ day, travel, runId: "test", routeCall: (stop) => ({ port: callPort, target: { phone: stop.phone, region: "US" } }) });
    for (let now = 0; now <= 120; now += 0.5) await engine.advance(now);
    expect(callPort.starts).toHaveLength(1);
    expect(engine.callsHalted).toContain("has not finished");
  });
});

describe("credentials only go to approved origins", () => {
  it("uses the CALL-E default when no override is set", () => {
    expect(calleClientOptions("real-key")).toEqual({ apiKey: "real-key" });
  });

  it("allows the approved HTTPS origin", () => {
    expect(calleClientOptions("real-key", "https://api.heycall-e.com/")).toEqual({ apiKey: "real-key", baseUrl: "https://api.heycall-e.com" });
  });

  it("refuses to send a real key to a fake, plain-HTTP or look-alike origin", () => {
    expect(() => calleClientOptions("real-key", "http://127.0.0.1:4010")).toThrow(/not an approved/);
    expect(() => calleClientOptions("real-key", "http://api.heycall-e.com")).toThrow(/not an approved/);
    expect(() => calleClientOptions("real-key", "https://api.heycall-e.com.evil.example")).toThrow(/not an approved/);
    expect(() => calleClientOptions("real-key", "not a url")).toThrow(/valid URL/);
  });

  it("lets only dummy keys reach a local fake", () => {
    expect(calleClientOptions("dummy-local", "http://127.0.0.1:4010/")).toEqual({ apiKey: "dummy-local", baseUrl: "http://127.0.0.1:4010" });
  });
});

describe("the shared live day stays on loopback", () => {
  const { day } = loadDay();
  const env = { ROUTEREADY_LIVE: "1", CALLE_API_KEY: "real-key", LIVE_TARGETS: "s2=+14155550102@US" };

  it("recognises loopback hosts", () => {
    for (const host of ["127.0.0.1", "localhost", "::1", "[::1]", "127.0.0.5"]) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ["0.0.0.0", "192.168.1.4", "example.com", "127.0.0.1.example.com"]) expect(isLoopbackHost(host)).toBe(false);
  });

  it("turns live calls off when the server listens beyond loopback", () => {
    expect(loadLiveConfig(env, day, "127.0.0.1").config).not.toBeNull();
    const open = loadLiveConfig(env, day, "0.0.0.0");
    expect(open.config).toBeNull();
    expect(open.problem).toContain("loopback");
  });

  it("turns live calls off when a real key would go to an unapproved origin", () => {
    expect(loadLiveConfig({ ...env, CALLE_BASE_URL: "http://127.0.0.1:4010" }, day, "127.0.0.1").config).toBeNull();
  });
});

describe("phone numbers are masked in provider text", () => {
  it("masks numbers in transcripts and errors, in any common format", () => {
    expect(maskPhonesInText("Call me back on +1 415 555 0123 please")).toBe("Call me back on +141****0123 please");
    expect(maskPhonesInText("recipient (415) 555-0123 unreachable")).toBe("recipient 415****0123 unreachable");
    expect(maskPhonesInText("+8801712345678")).toBe("+880****5678");
  });

  it("leaves times, dates, amounts, order numbers and ids alone", () => {
    const text = "Ready at 13:30 on 2026-09-14, Tk 1,250, order #RR5101, call_123456789012, 2026-09-12T04:01:00Z";
    expect(maskPhonesInText(text)).toBe(text);
  });

  it("masks streamed transcript lines as they arrive", () => {
    expect(toLine("Callee said: my number is +14155550123", 0)?.text).toBe("my number is +141****0123");
  });

  it("masks every string in a saved artifact", () => {
    const artifact = { recipients: [{ phones: ["+14155550123"], summary: "Reached +14155550123" }], createdAt: "2026-09-12T04:00:00Z", score: 0.9 };
    expect(maskPhonesDeep(artifact)).toEqual({ recipients: [{ phones: ["+141****0123"], summary: "Reached +141****0123" }], createdAt: "2026-09-12T04:00:00Z", score: 0.9 });
  });
});

describe("each destination is called at most once a day", () => {
  it("rejects two stops with the same number on one route", () => {
    const stop = { customer: "A", phone: "+14155550123", region: "US", lat: 40.71, lng: -74.01 };
    const parsed = parseFieldStart({ apiKey: "dummy-key", consent: FIELD_CONSENT, rider: { lat: 40.7, lng: -74 }, stops: [stop, { ...stop, customer: "B", phone: "+1 415 555 0123" }] });
    expect(parsed.ok).toBe(false);
  });

  it("rejects LIVE_TARGETS that give two stops the same number", () => {
    const { day } = loadDay();
    const env = { ROUTEREADY_LIVE: "1", CALLE_API_KEY: "real-key", LIVE_TARGETS: "s2=+14155550102@US,s3=+14155550102@US" };
    expect(loadLiveConfig(env, day, "127.0.0.1").problem).toContain("once a day");
  });

  it("does not call a number another route already called today", async () => {
    const ledger = new CallLedger(() => Date.UTC(2026, 8, 14, 9, 0));
    ledger.record("+14155550101", 0);
    const callPort = port(async () => ({ callId: "call_x" }));
    const { session } = fieldRoute(callPort, ledger);
    await session.tick(); // s1 is skipped
    await session.tick(); // the next customer is due on the following tick
    expect(callPort.starts).toEqual(["s2"]);
    expect(session.states.get("s1")?.note).toContain("already called today");
  });

  it("remembers numbers per local day and only as hashes", () => {
    let now = Date.UTC(2026, 8, 14, 17, 0);
    const ledger = new CallLedger(() => now);
    ledger.record("+14155550101", 360);
    expect(ledger.calledToday("+14155550101", 360)).toBe(true);
    expect(ledger.alreadyCalled(["+14155550101", "+14155550102"], 360)).toEqual(["+141****0101"]);
    expect(JSON.stringify([...(ledger as unknown as { days: Map<string, Set<string>> }).days.values()].map((set) => [...set]))).not.toContain("4155550101");
    now += 8 * 60 * 60_000; // past midnight in Dhaka
    expect(ledger.calledToday("+14155550101", 360)).toBe(false);
  });

  it("demo day: a live start with a number already called today needs approval", async () => {
    const loaded = loadDay();
    const ledger = new CallLedger();
    ledger.record("+14155550102", -new Date().getTimezoneOffset());
    const live = { apiKey: "dummy-key", baseUrl: "http://127.0.0.1:9", language: "English", targets: new Map([["s2", { phone: "+14155550102", region: "US" }]]) };
    const controller = new RunController(loaded, live, ledger);
    await expect(controller.start("live", "fast")).rejects.toBeInstanceOf(RepeatCallError);
    await controller.start("live", "fast", true);
    controller.stop();
    expect(controller.snapshot().mode).toBe("live");
  });

  it("calls an already-called number only when the visitor approved the repeat", async () => {
    const ledger = new CallLedger();
    ledger.record("+14155550101", 0);
    const starts: string[] = [];
    const registry = new FieldRegistry(
      () => ({ mode: "live", start: async (request) => (starts.push(request.stopId), { callId: "call_x" }), poll: async () => ({ lines: [], final: null as Call | null }) }),
      ledger,
    );
    const body = {
      apiKey: "dummy-key",
      consent: FIELD_CONSENT,
      rider: { lat: 40.7, lng: -74 },
      callAheadMinutes: 30,
      stops: [{ customer: "A", phone: "+14155550101", region: "US", lat: 40.72, lng: -74 }],
    };
    const parsed = parseFieldStart(body);
    if (!parsed.ok) throw new Error(parsed.error);

    const plain = registry.create(parsed.apiKey, parsed.setup).session;
    await plain.tick();
    expect(starts).toEqual([]);

    const approved = registry.create(parsed.apiKey, parsed.setup, new Set(["+14155550101"])).session;
    await approved.tick();
    expect(starts).toEqual(["s1"]);
  });
});
