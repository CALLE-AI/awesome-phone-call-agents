// Proves the verification core is self-consistent and usable in isolation:
// parse -> detect -> decide, plus the PII-safe pattern normaliser. No I/O.

import { describe, expect, it } from "vitest";
import {
  decide,
  detect,
  parseTranscript,
  normalizePattern,
  assertPatternPiiClean,
  type GateInput,
} from "../src/index.js";
import type { TranscriptTurn } from "../src/index.js";

const TZ = "America/New_York";

const turns: TranscriptTurn[] = [
  { offset_seconds: 0, speaker: "bot", text: "What day and time?" },
  { offset_seconds: 4, speaker: "user", text: "Thursday at 3... no wait, make it 3:30." },
  { offset_seconds: 8, speaker: "bot", text: "Noted." },
];

describe("verity-verification-core (extracted)", () => {
  it("parse → detect → decide catches a self-correction and BLOCKs", () => {
    const parsed = parseTranscript(turns, { businessTz: TZ, callCreatedAt: "2026-09-07T18:00:00Z" });
    expect(parsed.correction_events).toHaveLength(1);
    expect(parsed.resolved_targets[0]?.time).toBe("15:30");

    const intended_value = {
      appointment_date: parsed.resolved_targets[0]!.date,
      appointment_time: "15:00",
      timezone: TZ,
      service_type: "haircut",
    };
    const ambiguity = detect({ parsed, intent: "reschedule", intended_value, original_hold_value: intended_value });
    expect(ambiguity.flags).toContain("self_correction_unresolved");

    const input: GateInput = {
      intent: "reschedule",
      intended_value,
      original_hold: {
        hold_id: "h1",
        slot_id: "s1",
        value: intended_value,
        expires_at: "2027-01-01T00:00:00Z",
      },
      calle: {
        status: "completed",
        task_completed: true,
        completion_confidence: { score: 0.9, label: "high" },
        structured_result: { appointment_time: "15:00" },
      },
      parsed,
      ambiguity,
      matched_fixtures: [],
      slot_recheck: { slot_id: "s1", held_by_hold_id: "h1", available: false, sandbox_ok: true },
      now: "2026-09-07T18:05:00Z",
    };
    const d = decide(input);
    expect(d.decision).toBe("BLOCK");
    expect(["self_correction", "claim_parse_mismatch"]).toContain(d.reason_code);
    expect(d.ghost_booking_prevented).toBe(true);
    expect(d.repair_target?.appointment_time).toBe("15:30");
  });

  it("a clean confirmed transcript ALLOWs", () => {
    const clean: TranscriptTurn[] = [
      { offset_seconds: 0, speaker: "bot", text: "Tuesday, September 8th at 9:00 AM. Does that work?" },
      { offset_seconds: 3, speaker: "user", text: "Yes, 9 works, see you then." },
    ];
    const parsed = parseTranscript(clean, { businessTz: TZ, callCreatedAt: "2026-09-07T17:00:00Z" });
    const intended_value = {
      appointment_date: "2026-09-08",
      appointment_time: "09:00",
      timezone: TZ,
      service_type: "haircut",
    };
    const ambiguity = detect({ parsed, intent: "confirm", intended_value, original_hold_value: intended_value });
    const d = decide({
      intent: "confirm",
      intended_value,
      original_hold: { hold_id: "h", slot_id: "s", value: intended_value, expires_at: "2027-01-01T00:00:00Z" },
      calle: { status: "completed", task_completed: true, completion_confidence: { score: 0.95, label: "high" }, structured_result: null },
      parsed,
      ambiguity,
      matched_fixtures: [],
      slot_recheck: { slot_id: "s", held_by_hold_id: "h", available: false, sandbox_ok: true },
      now: "2026-09-07T17:05:00Z",
    });
    expect(d).toMatchObject({ decision: "ALLOW", reason_code: "allow_clean" });
  });

  it("normalizePattern strips PII and the validator agrees", () => {
    const { pattern } = normalizePattern("Dana Lewis, September 10, +12025550123 — 3 o'clock... no wait, 3:30.");
    expect(pattern).toMatch(/<NAME>/);
    expect(pattern).toMatch(/<DATE>/);
    expect(pattern).toMatch(/<PHONE>/);
    expect(() => assertPatternPiiClean(pattern)).not.toThrow();
  });
});
