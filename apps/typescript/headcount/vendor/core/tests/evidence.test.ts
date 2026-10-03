import { describe, expect, it } from "vitest";
import { linkEvidence } from "../src/evidence";

describe("evidence linker", () => {
  it("links a California VOE confirmation to the HR turn", () => {
    const linked = linkEvidence({
      structuredResult: {
        employment_confirmed: "yes",
        verifier_authority: "yes",
      },
      turns: [
        { speaker: "user", text: "Yes, I am authorized to confirm employment." },
        { speaker: "user", text: "Yes, Alex Rivera is employed here as Operations Coordinator." },
      ],
    });
    expect(linked.every((field) => field.supported)).toBe(true);
  });

  it("does not treat an honest unknown as an unsupported claim", () => {
    const linked = linkEvidence({
      structuredResult: { has_power: "unknown" },
      turns: [{ speaker: "user", text: "We already left." }],
    });
    expect(linked[0]?.supported).toBe(true);
  });

  it("marks a field unsupported when the transcript never said it", () => {
    const linked = linkEvidence({
      structuredResult: { has_power: "yes" },
      evidence: ["The recipient confirmed they have electricity."],
      turns: [{ speaker: "user", text: "We still have running water." }],
    });
    expect(linked[0]?.supported).toBe(false);
  });

  it("supports cooperative answers without dumping every evidence sentence into the claim", () => {
    const linked = linkEvidence({
      structuredResult: {
        safety_status: "safe",
        has_power: "yes",
        has_water: "yes",
      },
      evidence: [
        "The recipient said everyone in the household is safe.",
        "They have electricity and running water.",
      ],
      turns: [
        { speaker: "user", text: "Yes, everyone is safe. We're all here." },
        { speaker: "user", text: "We have electricity and running water." },
      ],
    });
    expect(linked.every((field) => field.supported)).toBe(true);
  });

  it("links a field to the supporting user turn", () => {
    const linked = linkEvidence({
      structuredResult: { has_water: "yes" },
      evidence: ["The recipient said they have running water."],
      turns: [
        { speaker: "bot", text: "Do you have running water?" },
        { speaker: "user", text: "Yes, we still have running water." },
      ],
    });
    expect(linked[0]?.supported).toBe(true);
    expect(linked[0]?.turn?.text).toMatch(/running water/i);
  });
});
