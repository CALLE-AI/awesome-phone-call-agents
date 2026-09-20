// File: src/lib/__tests__/security.test.ts
// Reviewer-gating fixes: E.164, base-url allowlist, phone masking/scrubbing.
import { describe, it, expect, afterEach } from "vitest";
import { env } from "@/lib/env";
import { isE164, maskPhone, scrubPhones, normalizeCallTask, type FairPrices } from "@/lib/normalize";
import type { CallTask, CallRecipient } from "@/lib/calle-types";
import fair from "../../../data/fair-prices.json";

const FAIR = fair as FairPrices;

describe("isE164 — accept/reject", () => {
  it("accepts valid E.164 numbers", () => {
    expect(isE164("+15125550142")).toBe(true);
    expect(isE164("+442071838750")).toBe(true);
    expect(isE164("+2348012345678")).toBe(true);
  });

  it("rejects invalid or garbage numbers", () => {
    expect(isE164("")).toBe(false);
    expect(isE164("+1512")).toBe(false); // too short
    expect(isE164("15125550142")).toBe(false); // no leading +
    expect(isE164("+05125550142")).toBe(false); // leading zero country digit
    expect(isE164("+1-512-555-0142")).toBe(false); // punctuation
    expect(isE164("not-a-phone")).toBe(false);
  });
});

describe("env.calleBaseUrlChecked — approved-origin allowlist", () => {
  afterEach(() => {
    delete process.env.CALLE_BASE_URL;
  });

  it("accepts the approved HTTPS CALL-E origin", () => {
    process.env.CALLE_BASE_URL = "https://api.heycall-e.com";
    expect(env.calleBaseUrlChecked()).toBe("https://api.heycall-e.com");
  });

  it("accepts any https subdomain of heycall-e.com", () => {
    process.env.CALLE_BASE_URL = "https://eu.heycall-e.com";
    expect(env.calleBaseUrlChecked()).toBe("https://eu.heycall-e.com");
  });

  it("defaults to the approved origin when unset", () => {
    expect(env.calleBaseUrlChecked()).toBe("https://api.heycall-e.com");
  });

  it("rejects an http:// origin", () => {
    process.env.CALLE_BASE_URL = "http://api.heycall-e.com";
    expect(() => env.calleBaseUrlChecked()).toThrow(/not an approved HTTPS CALL-E origin/);
  });

  it("rejects a non-heycall-e.com host", () => {
    process.env.CALLE_BASE_URL = "https://evil.example.com";
    expect(() => env.calleBaseUrlChecked()).toThrow(/not an approved HTTPS CALL-E origin/);
  });

  it("rejects a lookalike host that only contains heycall-e.com", () => {
    process.env.CALLE_BASE_URL = "https://heycall-e.com.evil.example";
    expect(() => env.calleBaseUrlChecked()).toThrow(/not an approved HTTPS CALL-E origin/);
  });
});

describe("maskPhone — display masking", () => {
  it("masks the middle, keeps country+area and last two", () => {
    expect(maskPhone("+15125550142")).toBe("+1512•••0142");
  });

  it("returns bullets for unparseable input", () => {
    expect(maskPhone("")).toBe("•••");
    expect(maskPhone(null)).toBe("•••");
    expect(maskPhone("garbage")).toBe("•••");
  });
});

describe("scrubPhones — free-text scrubbing", () => {
  it("replaces E.164-like substrings with their masked form", () => {
    const out = scrubPhones("call failed for +15125550142 after 3 tries");
    expect(out).toBe("call failed for +1512•••0142 after 3 tries");
    expect(out).not.toContain("+15125550142");
  });

  it("returns empty string for null/undefined", () => {
    expect(scrubPhones(null)).toBe("");
    expect(scrubPhones(undefined)).toBe("");
  });
});

describe("normalized output never leaks a full E.164", () => {
  function recipient(over: Partial<CallRecipient>): CallRecipient {
    return {
      name: "Test Clinic",
      phone: "+15125550142",
      status: "completed",
      summary: "reached the desk at +15125550142 and got a quote",
      structured_result: null,
      attempts: [],
      ...over,
    };
  }
  function taskWith(recipients: CallRecipient[]): CallTask {
    return {
      id: "call_test",
      status: "completed",
      structured_result: null,
      task_completed: true,
      completion_confidence: { score: 0.86, label: "high" },
      recipients,
    };
  }

  it("masks the phone field and scrubs the summary", () => {
    const n = normalizeCallTask(taskWith([recipient({})]), FAIR, "72148");
    const row = n.results[0];
    expect(row.phone).toBe("+1512•••0142");
    expect(row.summary).not.toContain("+15125550142");
    expect(JSON.stringify(n)).not.toMatch(/\+15125550142/);
  });

  it("masks the name when it falls back to the raw phone", () => {
    const n = normalizeCallTask(taskWith([recipient({ name: undefined, summary: undefined })]), FAIR, "72148");
    const row = n.results[0];
    expect(row.name).toBe("+1512•••0142");
    expect(JSON.stringify(n)).not.toMatch(/\+15125550142/);
  });

  it("scrubs phones from transcript-derived quoted_verbatim, includes, and excludes", () => {
    const leaky = recipient({
      name: "Leaky Imaging",
      phone: "+15125550142",
      summary: "quoted a price",
      structured_result: {
        quote_given: true,
        outcome: "quoted",
        cash_price: 400,
        currency: "USD",
        price_basis: "all_inclusive",
        includes: ["scan", "call us back at +15125550199 to confirm"],
        excludes: ["nothing, reach billing at +14155550188"],
        requires_consult_first: false,
        estimate_valid_days: 30,
        earliest_appointment_days: 3,
        cpt_or_code_confirmed: "72148",
        quoted_verbatim: "our cash price is four hundred dollars, callback +15125550170",
      },
      attempts: [
        {
          status: "completed",
          transcript_turns: [
            { offset_seconds: 12, speaker: "clinic", text: "our cash price is four hundred dollars, callback +15125550170" },
          ],
        },
      ],
    });
    const n = normalizeCallTask(taskWith([leaky]), FAIR, "72148");
    const s = JSON.stringify(n);
    // No full E.164 anywhere in the serialized client payload.
    expect(s).not.toMatch(/\+1512555019[0-9]/);
    expect(s).not.toMatch(/\+1512555017[0-9]/);
    expect(s).not.toMatch(/\+1415555018[0-9]/);
    expect(s).not.toMatch(/\+15125550142/);
    // The row still ranks (traceable quote) and shows the masked verbatim.
    const row = n.results.find((r) => r.ranked);
    expect(row?.quoted_verbatim).toContain("•••");
  });
});
