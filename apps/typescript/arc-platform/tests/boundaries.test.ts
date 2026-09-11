import { describe, it, expect } from "vitest";
import { buildTask, buildStandaloneTask, type CallTarget, type CampaignContext } from "@/lib/calle-media";

/**
 * The CALL-E contribution rules require a call-placing agent to carry rules for
 * medical, legal, financial and emergency content. This one carried none: the
 * prompt constrained tone, the opening, the read-back and the close, and said
 * nothing about what the agent must refuse.
 *
 * These pin the boundary onto BOTH prompt paths, because there are two and only
 * one of them is obvious.
 */
const target: CallTarget = { name: "City FM 89", type: "station", channel: "radio" };
const ctx: CampaignContext = { advertiser: "Zeb Modest Wear", market: "Karachi", currency: "PKR" };

const paths: [string, () => string][] = [
  ["campaign call", () => buildTask(ctx, target)],
  ["standalone enquiry", () => buildStandaloneTask(target)],
];

describe.each(paths)("content boundaries: %s", (_label, build) => {
  const task = build();

  it("refuses medical, legal and financial advice", () => {
    expect(task).toMatch(/medical, legal, financial or investment advice/i);
  });

  it("ends the call on an emergency rather than staying on script", () => {
    expect(task).toMatch(/emergency/i);
    expect(task).toMatch(/local emergency services/i);
  });

  it("never collects payment or identity details", () => {
    expect(task).toMatch(/payment details, card numbers, bank details/i);
  });

  it("cannot commit to a booking", () => {
    expect(task).toMatch(/not authorised to agree a contract/i);
  });

  /* The boundary sits beside the disclosure. The read-back gate is a separate
     thing and must survive untouched. */
  it("leaves the read-back gate intact", () => {
    expect(task).toMatch(/read it back|digit by digit|reading it back/i);
  });
});
