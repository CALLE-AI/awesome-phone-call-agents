import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeEvent } from "./ingest/normalize.js";
import { pickOptions } from "./policy/options.js";
import {
  enforceHouseDark,
  isPlaceholderPhone,
  shouldRing,
} from "./policy/shouldRing.js";
import { buildCallIntent } from "./calle/intent.js";
import { toDecision, optionFromTranscript } from "./map/toDecision.js";
import { TriggerIdSchema } from "./schemas.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = path.join(root, "fixtures");

const FIXTURE_FILES = [
  "stuck_support_acme.json",
  "agent_needs_decision_acme.json",
  "sla_risk_globex.json",
  "health_onboarding_initech.json",
] as const;

describe("normalize — all 4 fixtures", () => {
  for (const file of FIXTURE_FILES) {
    it(`normalizes ${file}`, () => {
      const raw = JSON.parse(readFileSync(path.join(fixturesDir, file), "utf8"));
      const event = normalizeEvent(raw);
      expect(TriggerIdSchema.parse(event.trigger_id)).toBe(raw.trigger_id);
      expect(event.account.id).toBeTruthy();
      expect(event.cs_owner.e164).toBe("+15555550100");
      expect(event.cs_owner.opt_in_phone).toBe(true);
      expect(event.brief.length).toBeGreaterThan(20);
      expect(event.event_id).toMatch(/^evt_/);
    });
  }
});

describe("policy matrix", () => {
  const raw = JSON.parse(
    readFileSync(path.join(fixturesDir, "stuck_support_acme.json"), "utf8"),
  );
  const event = normalizeEvent(raw);

  it("rings on dress rehearsal for high severity opt-in owner", () => {
    const result = shouldRing({
      event,
      owner: event.cs_owner,
      mode: "dress_rehearsal",
      now: new Date("2026-08-01T15:00:00"),
    });
    expect(result.ring).toBe(true);
    expect(result.hold).toBe(false);
  });

  it("HOLD on opt-out", () => {
    const result = shouldRing({
      event,
      owner: { ...event.cs_owner, opt_in_phone: false },
      mode: "dress_rehearsal",
    });
    expect(result.hold).toBe(true);
    expect(result.reason).toBe("opt_out");
  });

  it("HOLD on low severity", () => {
    const result = shouldRing({
      event: { ...event, severity: "low" },
      owner: event.cs_owner,
      mode: "dress_rehearsal",
    });
    expect(result.reason).toBe("severity_below_threshold");
  });

  it("house dark HOLD only on curtain-up", () => {
    const night = new Date("2026-08-01T23:30:00");
    const dress = shouldRing({
      event,
      owner: event.cs_owner,
      mode: "dress_rehearsal",
      now: night,
      houseDark: { start: "22:00", end: "07:00" },
    });
    expect(dress.ring).toBe(true);
    expect(dress.note).toMatch(/house dark/i);

    const live = shouldRing({
      event,
      owner: { ...event.cs_owner, e164: "+14155552671" },
      mode: "curtain_up",
      now: night,
      houseDark: { start: "22:00", end: "07:00" },
    });
    expect(live.hold).toBe(true);
    expect(live.reason).toBe("house_dark");
  });

  it("curtain-up HOLD on placeholder phone", () => {
    const result = shouldRing({
      event,
      owner: event.cs_owner,
      mode: "curtain_up",
      now: new Date("2026-08-01T15:00:00"),
    });
    expect(result.reason).toBe("placeholder_phone");
  });

  it("dedupe HOLD when cue already rung", () => {
    const result = shouldRing({
      event,
      owner: { ...event.cs_owner, e164: "+14155552671" },
      mode: "curtain_up",
      now: new Date("2026-08-01T15:00:00"),
      recentCueKeys: new Set([`stuck_support:${event.account.id}`]),
    });
    expect(result.reason).toBe("already_cued");
  });

  it("owner_budget HOLD when CS owner already at max live rings", () => {
    const result = shouldRing({
      event,
      owner: { ...event.cs_owner, e164: "+14155552671" },
      mode: "curtain_up",
      now: new Date("2026-08-01T15:00:00.000Z"),
      recentOwnerRingCount: 2,
      ownerMaxRings: 2,
    });
    expect(result.hold).toBe(true);
    expect(result.reason).toBe("owner_budget");
  });

  it("enforceHouseDark overnight window (UTC)", () => {
    expect(
      enforceHouseDark(new Date("2026-08-01T23:00:00.000Z"), {
        start: "22:00",
        end: "07:00",
        timezone: "UTC",
      }),
    ).toBe(true);
    expect(
      enforceHouseDark(new Date("2026-08-01T03:00:00.000Z"), {
        start: "22:00",
        end: "07:00",
        timezone: "UTC",
      }),
    ).toBe(true);
    expect(
      enforceHouseDark(new Date("2026-08-01T12:00:00.000Z"), {
        start: "22:00",
        end: "07:00",
        timezone: "UTC",
      }),
    ).toBe(false);
  });

  it("house dark uses owner timezone, not machine-local", () => {
    // 06:30 UTC = 23:30 previous evening in America/Los_Angeles (PDT)
    const utcMorning = new Date("2026-08-02T06:30:00.000Z");
    const liveLa = shouldRing({
      event,
      owner: { ...event.cs_owner, e164: "+14155552671" },
      mode: "curtain_up",
      now: utcMorning,
      houseDark: {
        start: "22:00",
        end: "07:00",
        timezone: "America/Los_Angeles",
      },
    });
    expect(liveLa.hold).toBe(true);
    expect(liveLa.reason).toBe("house_dark");
    expect(liveLa.note).toMatch(/America\/Los_Angeles/);

    // Same instant in Tokyo (15:30) is outside 22:00–07:00
    const liveTokyo = shouldRing({
      event,
      owner: { ...event.cs_owner, e164: "+14155552671" },
      mode: "curtain_up",
      now: utcMorning,
      houseDark: {
        start: "22:00",
        end: "07:00",
        timezone: "Asia/Tokyo",
      },
    });
    expect(liveTokyo.ring).toBe(true);
    expect(liveTokyo.hold).toBe(false);
  });

  it("invalid house-dark timezone fails closed on curtain-up", () => {
    const result = shouldRing({
      event,
      owner: { ...event.cs_owner, e164: "+14155552671" },
      mode: "curtain_up",
      now: new Date("2026-08-01T15:00:00.000Z"),
      houseDark: {
        start: "22:00",
        end: "07:00",
        timezone: "Not/A_Real_Zone",
      },
    });
    expect(result.hold).toBe(true);
    expect(result.reason).toBe("house_dark");
  });

  it("detects placeholder phones", () => {
    expect(isPlaceholderPhone("+15555550100")).toBe(true);
    expect(isPlaceholderPhone("+14155552671")).toBe(false);
  });
});

describe("normalize — stdin event shape", () => {
  it("accepts AccountEvent JSON without fixture_id", () => {
    const sample = JSON.parse(
      readFileSync(path.join(root, "events/sample_stuck_support.json"), "utf8"),
    );
    const event = normalizeEvent(sample);
    expect(event.event_id).toBe("evt_sample_stuck_support_001");
    expect(event.trigger_id).toBe("stuck_support");
    expect(event.metadata.source).toBe("stdin_sample");
  });
});

describe("intent — Stage Manager language", () => {
  it("identifies as Stage Manager, never customer, closed-set 1/2/3", () => {
    const raw = JSON.parse(
      readFileSync(path.join(fixturesDir, "stuck_support_acme.json"), "utf8"),
    );
    const event = normalizeEvent(raw);
    const intent = buildCallIntent(event, event.cs_owner.e164);
    expect(intent.persona).toBe("Stage Manager");
    expect(intent.never_call_customer).toBe(true);
    expect(intent.task).toMatch(/Stage Manager/);
    expect(intent.task).toMatch(/never call the (end )?customer/i);
    expect(intent.options).toHaveLength(3);
    expect(intent.options.map((o) => o.option_id)).toEqual(["1", "2", "3"]);
    expect(intent.result_schema).toMatchObject({
      required: expect.arrayContaining(["option_id", "decision", "decision_label"]),
    });
    const decisionProp = (
      intent.result_schema as {
        properties?: { decision?: { enum?: string[] } };
      }
    ).properties?.decision;
    expect(decisionProp?.enum).toEqual([
      "take_over_chat",
      "assign_se",
      "snooze_2h",
    ]);
    expect(intent.task).toMatch(/take_over_chat \| assign_se \| snooze_2h/);
  });

  it("pickOptions covers all triggers", () => {
    for (const id of TriggerIdSchema.options) {
      const opts = pickOptions(id);
      expect(opts).toHaveLength(3);
    }
  });
});

describe("toDecision mapping", () => {
  it("maps structured option_id", () => {
    const raw = JSON.parse(
      readFileSync(path.join(fixturesDir, "sla_risk_globex.json"), "utf8"),
    );
    const event = normalizeEvent(raw);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, event.cs_owner.e164, options);
    const result = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      callRunId: "call_test",
      taskCompleted: true,
      expectedStageCode: "9999",
      structured: {
        option_id: "2",
        decision: "page_backup",
        decision_label: "Page backup CS/SE",
        stage_code: "9999",
        identity_confirmed: true,
      },
    });
    expect(result.option_id).toBe("2");
    expect(result.decision).toBe("page_backup");
    expect(result.mode).toBe("curtain_up");
  });

  it("dress rehearsal defaults to option 1", () => {
    const raw = JSON.parse(
      readFileSync(path.join(fixturesDir, "health_onboarding_initech.json"), "utf8"),
    );
    const event = normalizeEvent(raw);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, event.cs_owner.e164, options);
    const result = toDecision({
      event,
      intent,
      options,
      mode: "dress_rehearsal",
    });
    expect(result.option_id).toBe("1");
    expect(result.decision).toBe("book_se_session");
    expect(result.call_run_id).toBe("dress_rehearsal");
    expect(result.notes_short).toMatch(/Stage code would be/);
  });

  it("HOLD maps to option_id hold", () => {
    const raw = JSON.parse(
      readFileSync(path.join(fixturesDir, "stuck_support_acme.json"), "utf8"),
    );
    const event = normalizeEvent(raw);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, event.cs_owner.e164, options);
    const result = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      holdReason: "house_dark",
    });
    expect(result.option_id).toBe("hold");
    expect(result.decision).toBe("hold");
  });

  it("maps failureCode voicemail to no_answer (prefer SDK over summary)", () => {
    const raw = JSON.parse(
      readFileSync(path.join(fixturesDir, "stuck_support_acme.json"), "utf8"),
    );
    const event = normalizeEvent(raw);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, event.cs_owner.e164, options);
    const result = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      callRunId: "call_vm",
      structured: null,
      failureCodes: ["voicemail"],
      callSummary: "Something unrelated that does not mention the V-word.",
      taskCompleted: false,
    });
    expect(result.decision).toBe("no_answer");
    expect(result.option_id).toBe("unknown");
  });

  it("maps voicemail summary to no_answer when no failureCode", () => {
    const raw = JSON.parse(
      readFileSync(path.join(fixturesDir, "stuck_support_acme.json"), "utf8"),
    );
    const event = normalizeEvent(raw);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, event.cs_owner.e164, options);
    const result = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      callRunId: "call_vm",
      structured: null,
      callSummary:
        "The call reached voicemail, so no CS decision was obtained from Maya.",
      taskCompleted: false,
    });
    expect(result.decision).toBe("no_answer");
    expect(result.decision_label).toMatch(/voicemail/i);
    expect(result.option_id).toBe("unknown");
  });
});

describe("optionFromTranscript — gated capture", () => {
  const options = pickOptions("stuck_support");

  const cases: Array<{ name: string; texts: string[]; expectId: string | null }> = [
    {
      name: "rejects embedded count (3 other fires)",
      texts: ["Sorry, what? I have 3 other fires right now"],
      expectId: null,
    },
    {
      name: "accepts uh, one",
      texts: ["uh, one"],
      expectId: "1",
    },
    {
      name: "accepts two please",
      texts: ["two please"],
      expectId: "2",
    },
    {
      name: "accepts the second one",
      texts: ["I'll take the second one"],
      expectId: "2",
    },
    {
      name: "accepts option 3",
      texts: ["option 3"],
      expectId: "3",
    },
    {
      name: "accepts bare 1",
      texts: ["1"],
      expectId: "1",
    },
    {
      name: "prefers last confident hit over earlier noise",
      texts: ["I have 3 other tickets", "okay one"],
      expectId: "1",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const hit = optionFromTranscript(c.texts, options);
      expect(hit?.option_id ?? null).toBe(c.expectId);
    });
  }
});
