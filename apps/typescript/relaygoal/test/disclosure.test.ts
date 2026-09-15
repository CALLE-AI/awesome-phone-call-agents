import { describe, expect, it } from "vitest";
import { findDisclosure } from "../src/core/disclosure";
import { scenarios } from "../src/scenarios";
import type { TranscriptTurn } from "../src/core/types";

describe("findDisclosure", () => {
  it("finds the agent's disclosure turn in every demo scenario that connected", () => {
    for (const [id, s] of Object.entries(scenarios)) {
      if (s.transcriptTurns.length === 0) continue;
      const d = findDisclosure(s.transcriptTurns);
      expect(d.disclosed, `scenario ${id}`).toBe(true);
      expect(d.turn?.speaker).toBe("bot");
    }
  });

  it("never credits the other party's words as the agent's disclosure", () => {
    const t: TranscriptTurn[] = [
      { offsetSeconds: 0, speaker: "bot", text: "Hi, what are your hours today?" },
      { offsetSeconds: 5, speaker: "user", text: "I'm an assistant here, we're open until six." },
    ];
    expect(findDisclosure(t).disclosed).toBe(false);
  });

  it("reports no disclosure on an empty transcript", () => {
    expect(findDisclosure([]).disclosed).toBe(false);
  });
});
